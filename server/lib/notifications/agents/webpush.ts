import { IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import MediaRequest from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import { defineMessages, getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import {
  getExternalNotificationAgent,
  getExternalRuntimeConfig,
} from '@server/lib/externalRuntimeConfig';
import { forEachNotificationUserBatch } from '@server/lib/notifications/userBatches';
import type { NotificationAgentConfig } from '@server/lib/settings';
import { NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import type { AvailableLocale } from '@server/types/languages';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import axios from 'axios';
import webpush from 'web-push';
import { Notification, shouldSendAdminNotification } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import {
  BaseAgent,
  NOTIFICATION_HTTP_OPTIONS,
  getMediaTypeLabel,
  getNotificationMediaUrl,
} from './agent';

const messages = defineMessages('notifications.agents.webpush', {
  autoRequested: 'Automatically submitted a new {quality}{mediaType} request.',
  approved: 'Your {quality}{mediaType} request has been approved.',
  autoApproved:
    'Automatically approved a new {quality}{mediaType} request from {userName}.',
  available: 'Your {quality}{mediaType} request is now available!',
  declined: 'Your {quality}{mediaType} request was declined.',
  failed: 'Failed to process {quality}{mediaType} request.',
  pending:
    'Approval required for a new {quality}{mediaType} request from {userName}.',
  issueCreated: 'A new {issueType} was reported by {userName}.',
  issueComment: '{userName} commented on the {issueType}.',
  issueResolved: 'The {issueType} was marked as resolved by {userName}!',
  issueReopened: 'The {issueType} was reopened by {userName}.',
  viewIssue: 'View Issue',
  viewMedia: 'View Media',
});

const WEB_PUSH_HTTP_OPTIONS = {
  ...NOTIFICATION_HTTP_OPTIONS,
  ...createSafeHttpRequestOptions(
    () => process.env.SEERR_ALLOW_PRIVATE_PUSH_ENDPOINTS === 'true',
    false
  ),
  // Subscription endpoints are user-controlled. Resolving them through an
  // HTTP proxy would move DNS resolution outside the guarded socket lookup and
  // reopen DNS-rebinding SSRF. Explicit false values also override any proxy
  // agents installed on Axios defaults by the application proxy setting.
  proxy: false as const,
  httpAgent: false,
  httpsAgent: false,
};
export const WEB_PUSH_DELIVERY_CONCURRENCY = 10;

interface PushNotificationPayload {
  notificationType: string;
  subject: string;
  message?: string;
  image?: string;
  actionUrl?: string;
  actionUrlTitle?: string;
  requestId?: number;
  pendingRequestsCount?: number;
  isAdmin?: boolean;
}

interface WebPushError extends Error {
  statusCode?: number;
  status?: number;
  body?: string | unknown;
  response?: {
    body?: string | unknown;
    status?: number;
  };
}

export const sendWebPushRequest = async (
  subscription: webpush.PushSubscription,
  payload: Buffer
): Promise<void> => {
  const request = webpush.generateRequestDetails(subscription, payload);

  await axios.request({
    ...WEB_PUSH_HTTP_OPTIONS,
    url: request.endpoint,
    method: request.method,
    headers: request.headers,
    data: request.body,
  });
};

class WebPushAgent
  extends BaseAgent<NotificationAgentConfig>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentConfig {
    if (this.settings) {
      return this.settings;
    }

    return getExternalNotificationAgent(NotificationAgentKey.WEBPUSH);
  }

  public buildPayload(
    type: Notification,
    payload: NotificationPayload,
    locale?: AvailableLocale
  ): PushNotificationPayload {
    const intl = getIntl(locale);
    const { embedPoster } = this.getSettings();

    const mediaType = payload.media
      ? getMediaTypeLabel(intl, payload.media.mediaType)
      : undefined;
    const is4k = payload.request?.is4k;
    const quality = is4k ? '4K ' : '';

    const issueType = payload.issue
      ? payload.issue.issueType !== IssueType.OTHER
        ? intl.formatMessage(globalMessages.issueTypeName, {
            type: IssueTypeName[payload.issue.issueType].toLowerCase(),
          })
        : intl.formatMessage(globalMessages.issue)
      : undefined;

    let message: string | undefined;
    switch (type) {
      case Notification.TEST_NOTIFICATION:
        message = payload.message;
        break;
      case Notification.MEDIA_AUTO_REQUESTED:
        message = intl.formatMessage(messages.autoRequested, {
          quality,
          mediaType,
        });
        break;
      case Notification.MEDIA_APPROVED:
        message = intl.formatMessage(messages.approved, {
          quality,
          mediaType,
        });
        break;
      case Notification.MEDIA_AUTO_APPROVED:
        message = intl.formatMessage(messages.autoApproved, {
          quality,
          mediaType,
          userName: payload.request?.requestedBy.displayName,
        });
        break;
      case Notification.MEDIA_AVAILABLE:
        message = intl.formatMessage(messages.available, {
          quality,
          mediaType,
        });
        break;
      case Notification.MEDIA_DECLINED:
        message = intl.formatMessage(messages.declined, {
          quality,
          mediaType,
        });
        break;
      case Notification.MEDIA_FAILED:
        message = intl.formatMessage(messages.failed, {
          quality,
          mediaType,
        });
        break;
      case Notification.MEDIA_PENDING:
        message = intl.formatMessage(messages.pending, {
          quality,
          mediaType,
          userName: payload.request?.requestedBy.displayName,
        });
        break;
      case Notification.ISSUE_CREATED:
        message = intl.formatMessage(messages.issueCreated, {
          issueType,
          userName: payload.issue?.createdBy.displayName,
        });
        break;
      case Notification.ISSUE_COMMENT:
        message = intl.formatMessage(messages.issueComment, {
          userName: payload.comment?.user.displayName,
          issueType,
        });
        break;
      case Notification.ISSUE_RESOLVED:
        message = intl.formatMessage(messages.issueResolved, {
          issueType,
          userName: payload.issue?.modifiedBy?.displayName,
        });
        break;
      case Notification.ISSUE_REOPENED:
        message = intl.formatMessage(messages.issueReopened, {
          issueType,
          userName: payload.issue?.modifiedBy?.displayName,
        });
        break;
      default:
        return {
          notificationType: Notification[type],
          subject: 'Unknown',
        };
    }

    const actionUrl = payload.issue
      ? `/issues/${payload.issue.id}`
      : payload.media
        ? getNotificationMediaUrl(payload)
        : undefined;

    const actionUrlTitle = actionUrl
      ? intl.formatMessage(
          payload.issue ? messages.viewIssue : messages.viewMedia
        )
      : undefined;

    return {
      notificationType: Notification[type],
      subject: payload.subject,
      message,
      image: embedPoster ? payload.image : undefined,
      requestId: payload.request?.id,
      actionUrl,
      actionUrlTitle,
      pendingRequestsCount: payload.pendingRequestsCount,
      isAdmin: payload.isAdmin,
    };
  }

  public shouldSend(): boolean {
    if (this.getSettings().enabled) {
      return true;
    }

    return false;
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const userRepository = getRepository(User);
    const userPushSubRepository = getRepository(UserPushSubscription);
    const settings = getExternalRuntimeConfig();

    const pushSubs: { sub: UserPushSubscription; locale?: AvailableLocale }[] =
      [];
    let deliveryFailed = false;

    const mainUser = await userRepository.findOne({ where: { id: 1 } });

    const requestRepository = getRepository(MediaRequest);

    const pendingRequestCount = await requestRepository.count({
      where: { status: MediaRequestStatus.PENDING },
    });

    const webPushNotification = async (
      pushSub: UserPushSubscription,
      notificationPayload: Buffer
    ): Promise<boolean> => {
      logger.debug('Sending web push notification', {
        label: 'Notifications',
        recipient: pushSub.user.displayName,
        type: Notification[type],
        subject: payload.subject,
      });

      try {
        await sendWebPushRequest(
          {
            endpoint: pushSub.endpoint,
            keys: {
              auth: pushSub.auth,
              p256dh: pushSub.p256dh,
            },
          },
          notificationPayload
        );
        return true;
      } catch (e) {
        const webPushError = e as WebPushError;
        const statusCode =
          webPushError.statusCode ||
          webPushError.status ||
          webPushError.response?.status;
        const errorMessage = webPushError.message || String(e);

        // RFC 8030: 410/404 are permanent failures, others are transient
        const isPermanentFailure = statusCode === 410 || statusCode === 404;

        logger.error(
          isPermanentFailure
            ? 'Error sending web push notification; removing invalid subscription'
            : 'Error sending web push notification (transient error, keeping subscription)',
          {
            label: 'Notifications',
            recipient: pushSub.user.displayName,
            type: Notification[type],
            subject: payload.subject,
            errorMessage,
            statusCode: statusCode || 'unknown',
          }
        );

        if (isPermanentFailure) {
          await userPushSubRepository.remove(pushSub);
          return true;
        }
        return false;
      }
    };

    if (
      payload.notifyUser &&
      // Check if user has webpush notifications enabled and fallback to true if undefined
      // since web push should default to true
      (payload.notifyUser.settings?.hasNotificationType(
        NotificationAgentKey.WEBPUSH,
        type
      ) ??
        true)
    ) {
      const notifySubs = await userPushSubRepository.find({
        where: { user: { id: payload.notifyUser.id } },
      });

      pushSubs.push(
        ...notifySubs.map((sub) => ({
          sub,
          locale: payload.notifyUser?.settings?.locale as AvailableLocale,
        }))
      );
    }

    if (
      payload.notifyAdmin ||
      type === Notification.MEDIA_APPROVED ||
      type === Notification.MEDIA_DECLINED
    ) {
      if (mainUser) {
        await forEachNotificationUserBatch(async (users) => {
          const manageUsers = users.filter(
            (user) =>
              // Check if user has webpush notifications enabled and fallback to true if undefined
              // since web push should default to true
              (user.settings?.hasNotificationType(
                NotificationAgentKey.WEBPUSH,
                type
              ) ??
                true) &&
              shouldSendAdminNotification(type, user, payload)
          );
          const allSubs =
            manageUsers.length > 0
              ? await userPushSubRepository
                  .createQueryBuilder('pushSub')
                  .leftJoinAndSelect('pushSub.user', 'user')
                  .leftJoinAndSelect('user.settings', 'settings')
                  .where('pushSub.userId IN (:...users)', {
                    users: manageUsers.map((user) => user.id),
                  })
                  .getMany()
              : [];

          if (allSubs.length === 0) {
            return;
          }

          webpush.setVapidDetails(
            `mailto:${mainUser.email}`,
            settings.vapidPublic,
            settings.vapidPrivate
          );

          const adminDeliveries = await mapWithConcurrency(
            allSubs,
            WEB_PUSH_DELIVERY_CONCURRENCY,
            async (sub) => {
              const locale = sub.user?.settings?.locale as AvailableLocale;
              const notificationBadgePayload = Buffer.from(
                JSON.stringify(
                  type === Notification.MEDIA_APPROVED ||
                    type === Notification.MEDIA_DECLINED
                    ? this.buildPayload(
                        type,
                        {
                          subject: payload.subject,
                          notifySystem: false,
                          notifyAdmin: true,
                          isAdmin: true,
                          pendingRequestsCount: pendingRequestCount,
                        },
                        locale
                      )
                    : this.buildPayload(
                        type,
                        type === Notification.MEDIA_PENDING
                          ? {
                              ...payload,
                              pendingRequestsCount: pendingRequestCount,
                            }
                          : payload,
                        locale
                      )
                ),
                'utf-8'
              );
              return webPushNotification(sub, notificationBadgePayload);
            }
          );
          deliveryFailed ||= adminDeliveries.some((delivered) => !delivered);
        });
      }
    }

    if (mainUser && pushSubs.length > 0) {
      webpush.setVapidDetails(
        `mailto:${mainUser.email}`,
        settings.vapidPublic,
        settings.vapidPrivate
      );

      if (type === Notification.MEDIA_PENDING) {
        payload = { ...payload, pendingRequestsCount: pendingRequestCount };
      }

      const pushDeliveries = await mapWithConcurrency(
        pushSubs,
        WEB_PUSH_DELIVERY_CONCURRENCY,
        async ({ sub, locale }) => {
          const notificationPayload = Buffer.from(
            JSON.stringify(this.buildPayload(type, payload, locale)),
            'utf-8'
          );
          return webPushNotification(sub, notificationPayload);
        }
      );
      deliveryFailed ||= pushDeliveries.some((delivered) => !delivered);
    }

    return !deliveryFailed;
  }
}

export default WebPushAgent;
