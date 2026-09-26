import { NotificationOutbox } from '@server/entity/NotificationOutbox';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import {
  BoundedTaskQueue,
  BoundedTaskQueueFullError,
} from '@server/utils/concurrency';
import type { QueryRunner } from 'typeorm';
import type { NotificationAgent, NotificationPayload } from './agents/agent';
import type { NotificationOutboxIntent } from './outbox';
import {
  NOTIFICATION_OUTBOX_CLAIM_LEASE_MS,
  NOTIFICATION_OUTBOX_SCAN_BATCH_SIZE,
  claimNotificationOutboxRecord,
  completeNotificationOutboxRecord,
  createNotificationOutboxIntent,
  createNotificationOutboxRecord,
  getPendingNotificationOutboxRecords,
  hydrateNotificationOutboxPayload,
  markNotificationAgentDelivered,
  markNotificationOutboxAttemptFailed,
  renewNotificationOutboxClaim,
} from './outbox';

export enum Notification {
  NONE = 0,
  MEDIA_PENDING = 2,
  MEDIA_APPROVED = 4,
  MEDIA_AVAILABLE = 8,
  MEDIA_FAILED = 16,
  TEST_NOTIFICATION = 32,
  MEDIA_DECLINED = 64,
  MEDIA_AUTO_APPROVED = 128,
  ISSUE_CREATED = 256,
  ISSUE_COMMENT = 512,
  ISSUE_RESOLVED = 1024,
  ISSUE_REOPENED = 2048,
  MEDIA_AUTO_REQUESTED = 4096,
  SOFTWARE_AVAILABLE = 8192,
  SOFTWARE_STATUS = 16384,
}

export const hasNotificationType = (
  types: Notification | Notification[],
  value: number
): boolean => {
  let total: number;

  // If we are not checking any notifications, bail out and return true
  if (types === 0) {
    return true;
  }

  if (Array.isArray(types)) {
    // Combine all notification values into one
    total = types.reduce((a, v) => a + v, 0);
  } else {
    total = types;
  }

  // Test notifications don't need to be enabled
  if (!(value & Notification.TEST_NOTIFICATION)) {
    value += Notification.TEST_NOTIFICATION;
  }

  return !!(value & total);
};

export const getAdminPermission = (type: Notification): Permission => {
  switch (type) {
    case Notification.MEDIA_PENDING:
    case Notification.MEDIA_APPROVED:
    case Notification.MEDIA_AVAILABLE:
    case Notification.MEDIA_FAILED:
    case Notification.MEDIA_DECLINED:
    case Notification.MEDIA_AUTO_APPROVED:
    case Notification.SOFTWARE_AVAILABLE:
    case Notification.SOFTWARE_STATUS:
      return Permission.MANAGE_REQUESTS;
    case Notification.ISSUE_CREATED:
    case Notification.ISSUE_COMMENT:
    case Notification.ISSUE_RESOLVED:
    case Notification.ISSUE_REOPENED:
      return Permission.MANAGE_ISSUES;
    default:
      return Permission.ADMIN;
  }
};

export const shouldSendAdminNotification = (
  type: Notification,
  user: User,
  payload: NotificationPayload
): boolean => {
  return (
    user.id !== payload.notifyUser?.id &&
    user.hasPermission(getAdminPermission(type)) &&
    // Check if the user submitted this request (on behalf of themself OR another user)
    (type !== Notification.MEDIA_AUTO_APPROVED ||
      user.id !==
        (payload.request?.modifiedBy ?? payload.request?.requestedBy)?.id) &&
    // Check if the user created this issue
    (type !== Notification.ISSUE_CREATED ||
      user.id !== payload.issue?.createdBy.id) &&
    // Check if the user submitted this issue comment
    (type !== Notification.ISSUE_COMMENT ||
      user.id !== payload.comment?.user.id) &&
    // Check if the user resolved/reopened this issue
    ((type !== Notification.ISSUE_RESOLVED &&
      type !== Notification.ISSUE_REOPENED) ||
      user.id !== payload.issue?.modifiedBy?.id)
  );
};

export const NOTIFICATION_OUTBOX_RETRY_SCAN_INTERVAL_MS = 60_000;
export const NOTIFICATION_OUTBOX_DELIVERY_CONCURRENCY = 8;

interface DeferredNotification {
  record: Awaited<ReturnType<typeof createNotificationOutboxRecord>>;
  type: Notification;
  payload?: NotificationPayload;
}

export class NotificationManager {
  private activeAgents: { key: string; agent: NotificationAgent }[] = [];
  private activeOutboxDeliveries = new Set<number>();
  private deferredOutboxDeliveries = new Set<number>();
  private deferredNotifications = new WeakMap<
    QueryRunner,
    DeferredNotification[]
  >();
  private transactionalEnqueuesInProgress = 0;
  private outboxRetryTimer?: NodeJS.Timeout;
  private outboxScan?: Promise<void>;
  private outboxDeliveryQueue = new BoundedTaskQueue(
    NOTIFICATION_OUTBOX_DELIVERY_CONCURRENCY,
    NOTIFICATION_OUTBOX_SCAN_BATCH_SIZE -
      NOTIFICATION_OUTBOX_DELIVERY_CONCURRENCY
  );

  public registerAgents = (agents: NotificationAgent[]): void => {
    const totals = new Map<string, number>();
    for (const agent of agents) {
      const name = agent.constructor.name;
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    const occurrences = new Map<string, number>();
    this.activeAgents = agents.map((agent) => {
      const name = agent.constructor.name;
      const occurrence = occurrences.get(name) ?? 0;
      occurrences.set(name, occurrence + 1);
      return {
        key: totals.get(name) === 1 ? name : `${name}:${occurrence}`,
        agent,
      };
    });
    logger.info('Registered notification agents', { label: 'Notifications' });
  };

  private getTargetAgents = (): string[] => {
    const targets: string[] = [];
    for (const { key, agent } of this.activeAgents) {
      try {
        if (agent.shouldSend()) {
          targets.push(key);
        }
      } catch (error) {
        logger.error('Failed to evaluate notification agent settings', {
          label: 'Notifications',
          agent: agent.constructor.name,
          errorMessage:
            error instanceof Error ? error.message : 'Unknown agent error',
        });
      }
    }
    return targets;
  };

  private sendWithClaimHeartbeat = async (
    record: Awaited<ReturnType<typeof createNotificationOutboxRecord>>,
    claimToken: string,
    send: () => Promise<boolean>
  ): Promise<boolean> => {
    let heartbeatError: unknown;
    let pendingRenewal = Promise.resolve();
    const renew = (): void => {
      pendingRenewal = pendingRenewal
        .then(() => renewNotificationOutboxClaim(record, claimToken))
        .catch((error) => {
          heartbeatError ??= error;
        });
    };
    await renewNotificationOutboxClaim(record, claimToken);
    const timer = setInterval(
      renew,
      Math.max(1_000, Math.floor(NOTIFICATION_OUTBOX_CLAIM_LEASE_MS / 3))
    );
    timer.unref();
    try {
      const delivered = await send();
      await pendingRenewal;
      if (heartbeatError) {
        throw heartbeatError;
      }
      await renewNotificationOutboxClaim(record, claimToken);
      return delivered;
    } finally {
      clearInterval(timer);
      await pendingRenewal;
    }
  };

  private dispatchOutboxRecord = (
    record: Awaited<ReturnType<typeof createNotificationOutboxRecord>>,
    type: Notification,
    payload?: NotificationPayload
  ): void => {
    if (this.activeOutboxDeliveries.has(record.id)) {
      return;
    }
    this.activeOutboxDeliveries.add(record.id);

    trackBackgroundTask(`notification outbox ${record.id}`, async () => {
      try {
        await this.outboxDeliveryQueue.run(async () => {
          let claimToken: string | undefined;
          try {
            claimToken = await claimNotificationOutboxRecord(record);
            if (!claimToken) {
              return;
            }
            if (typeof Notification[record.type] !== 'string') {
              throw new Error('Notification outbox type is invalid.');
            }
            const deliveryPayload =
              payload ?? (await hydrateNotificationOutboxPayload(record));
            if (!deliveryPayload) {
              await completeNotificationOutboxRecord(record.id, claimToken);
              claimToken = undefined;
              return;
            }
            let failed = false;
            for (const target of record.targetAgents) {
              if (record.deliveredAgents.includes(target)) {
                continue;
              }
              const entry = this.activeAgents.find(({ key }) => key === target);
              if (!entry) {
                failed = true;
                continue;
              }

              let delivered = false;
              try {
                delivered = await this.sendWithClaimHeartbeat(
                  record,
                  claimToken,
                  () => entry.agent.send(type, deliveryPayload)
                );
              } catch (error) {
                logger.error('Notification agent delivery threw an error', {
                  label: 'Notifications',
                  agent: entry.agent.constructor.name,
                  outboxId: record.id,
                  errorMessage:
                    error instanceof Error
                      ? error.message
                      : 'Unknown notification error',
                });
              }
              if (delivered) {
                await markNotificationAgentDelivered(
                  record,
                  target,
                  claimToken
                );
              } else {
                failed = true;
              }
            }

            const complete = record.targetAgents.every((target) =>
              record.deliveredAgents.includes(target)
            );
            if (complete) {
              await completeNotificationOutboxRecord(record.id, claimToken);
              claimToken = undefined;
              return;
            }

            await markNotificationOutboxAttemptFailed(record, claimToken);
            claimToken = undefined;
            if (failed) {
              throw new Error(
                `Notification outbox ${record.id} has incomplete agent deliveries`
              );
            }
          } catch (error) {
            if (claimToken) {
              try {
                await markNotificationOutboxAttemptFailed(record, claimToken);
              } catch (finalizationError) {
                logger.error('Failed to release notification outbox claim', {
                  label: 'Notifications',
                  outboxId: record.id,
                  errorMessage:
                    finalizationError instanceof Error
                      ? finalizationError.message
                      : 'Unknown outbox finalization error',
                });
              }
            }
            throw error;
          }
        });
      } catch (error) {
        if (!(error instanceof BoundedTaskQueueFullError)) {
          throw error;
        }
      } finally {
        this.activeOutboxDeliveries.delete(record.id);
      }
    });
  };

  public resumePendingNotifications = async (
    respectRetryBackoff = false
  ): Promise<void> => {
    if (this.transactionalEnqueuesInProgress > 0) {
      return;
    }
    if (this.outboxScan) {
      return this.outboxScan;
    }
    const scan = (async () => {
      const records =
        await getPendingNotificationOutboxRecords(respectRetryBackoff);
      if (this.transactionalEnqueuesInProgress > 0) {
        return;
      }
      for (const record of records) {
        if (this.deferredOutboxDeliveries.has(record.id)) {
          continue;
        }
        this.dispatchOutboxRecord(record, record.type as Notification);
      }
    })();
    this.outboxScan = scan;
    try {
      await scan;
    } finally {
      this.outboxScan = undefined;
    }
  };

  public startOutboxRetryLoop = (): void => {
    if (this.outboxRetryTimer) {
      return;
    }
    this.outboxRetryTimer = setInterval(() => {
      trackBackgroundTask('notification outbox retry scan', () =>
        this.resumePendingNotifications(true)
      );
    }, NOTIFICATION_OUTBOX_RETRY_SCAN_INTERVAL_MS);
    this.outboxRetryTimer.unref();
  };

  public stopOutboxRetryLoop = (): void => {
    if (this.outboxRetryTimer) {
      clearInterval(this.outboxRetryTimer);
      this.outboxRetryTimer = undefined;
    }
  };

  public commitDeferredNotifications = (queryRunner: QueryRunner): void => {
    const deferred = this.deferredNotifications.get(queryRunner) ?? [];
    this.deferredNotifications.delete(queryRunner);
    for (const notification of deferred) {
      this.deferredOutboxDeliveries.delete(notification.record.id);
      this.dispatchOutboxRecord(
        notification.record,
        notification.type,
        notification.payload
      );
    }
  };

  public rollbackDeferredNotifications = (queryRunner: QueryRunner): void => {
    const deferred = this.deferredNotifications.get(queryRunner) ?? [];
    this.deferredNotifications.delete(queryRunner);
    for (const notification of deferred) {
      this.deferredOutboxDeliveries.delete(notification.record.id);
    }
  };

  public async sendNotification(
    type: Notification,
    payload: NotificationPayload,
    queryRunner?: QueryRunner
  ): Promise<void> {
    logger.info(`Sending notification(s) for ${Notification[type]}`, {
      label: 'Notifications',
      subject: payload.subject,
    });

    const targets = this.getTargetAgents();
    if (targets.length === 0) {
      return;
    }

    await this.persistNotification(
      type,
      targets,
      queryRunner,
      payload,
      undefined
    );
  }

  public async sendNotificationIntent(
    type: Notification,
    intent: NotificationOutboxIntent,
    queryRunner?: QueryRunner
  ): Promise<void> {
    logger.info(
      `Queueing durable notification intent for ${Notification[type]}`,
      {
        label: 'Notifications',
        intentKind: intent.kind,
      }
    );

    const targets = this.getTargetAgents();
    if (targets.length === 0) {
      return;
    }

    await this.persistNotification(
      type,
      targets,
      queryRunner,
      undefined,
      intent
    );
  }

  private async persistNotification(
    type: Notification,
    targets: string[],
    queryRunner: QueryRunner | undefined,
    payload: NotificationPayload | undefined,
    intent: NotificationOutboxIntent | undefined
  ): Promise<void> {
    const deferUntilCommit = Boolean(queryRunner?.isTransactionActive);
    if (deferUntilCommit) {
      this.transactionalEnqueuesInProgress += 1;
    }
    let record: Awaited<ReturnType<typeof createNotificationOutboxRecord>>;
    try {
      const repository = queryRunner?.manager.getRepository(NotificationOutbox);
      record = intent
        ? await createNotificationOutboxIntent(
            type,
            intent,
            targets,
            repository
          )
        : await createNotificationOutboxRecord(
            type,
            payload as NotificationPayload,
            targets,
            repository
          );
      if (deferUntilCommit && queryRunner) {
        this.deferredOutboxDeliveries.add(record.id);
        const deferred = this.deferredNotifications.get(queryRunner) ?? [];
        deferred.push({ record, type, payload });
        this.deferredNotifications.set(queryRunner, deferred);
        return;
      }
    } finally {
      if (deferUntilCommit) {
        this.transactionalEnqueuesInProgress -= 1;
      }
    }
    this.dispatchOutboxRecord(record, type, payload);
  }
}

const notificationManager = new NotificationManager();

export default notificationManager;
