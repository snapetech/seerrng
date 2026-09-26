import { IssueStatus, IssueTypeName } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import { getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import {
  getExternalNotificationAgent,
  getExternalRuntimeConfig,
} from '@server/lib/externalRuntimeConfig';
import { forEachNotificationUserBatch } from '@server/lib/notifications/userBatches';
import type { NotificationAgentTelegram } from '@server/lib/settings';
import { NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import type { AvailableLocale } from '@server/types/languages';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { redactSecrets } from '@server/utils/security';
import axios from 'axios';
import {
  Notification,
  hasNotificationType,
  shouldSendAdminNotification,
} from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import {
  BaseAgent,
  NOTIFICATION_DELIVERY_CONCURRENCY,
  NOTIFICATION_HTTP_OPTIONS,
  getNotificationActionLabel,
  getNotificationActionUrl,
} from './agent';

interface TelegramMessagePayload {
  text: string;
  parse_mode: string;
  chat_id: string;
  message_thread_id: string;
  disable_notification: boolean;
}

interface TelegramPhotoPayload {
  photo: string;
  caption: string;
  parse_mode: string;
  chat_id: string;
  message_thread_id: string;
  disable_notification: boolean;
}

export const TELEGRAM_MESSAGE_TEXT_LIMIT = 4_096;
export const TELEGRAM_PHOTO_CAPTION_LIMIT = 1_024;

export const escapeTelegramMarkdownText = (
  value: string | undefined,
  maxLength = Number.MAX_SAFE_INTEGER
): string => {
  const tokens: string[] = [];
  let length = 0;
  for (const character of value ?? '') {
    const escaped = /[_*[\]()~>#+=|{}.!-]/.test(character)
      ? `\\${character}`
      : character;
    if (length + escaped.length > maxLength) {
      while (tokens.length && length + 1 > maxLength) {
        length -= tokens.pop()!.length;
      }
      return maxLength > 0 ? `${tokens.join('')}…` : '';
    }
    tokens.push(escaped);
    length += escaped.length;
  }
  return tokens.join('');
};

const escapeTelegramMarkdownUrl = (value: string): string =>
  value.replace(/[\\)]/g, '\\$&');

class TelegramAgent
  extends BaseAgent<NotificationAgentTelegram>
  implements NotificationAgent
{
  private baseUrl = 'https://api.telegram.org/';

  protected getSettings(): NotificationAgentTelegram {
    if (this.settings) {
      return this.settings;
    }

    return getExternalNotificationAgent(NotificationAgentKey.TELEGRAM);
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (settings.enabled && settings.options.botAPI) {
      return true;
    }

    return false;
  }

  public buildPayload(
    type: Notification,
    payload: NotificationPayload,
    locale?: AvailableLocale
  ): Partial<TelegramMessagePayload | TelegramPhotoPayload> {
    const intl = getIntl(locale);
    const { applicationUrl, applicationTitle } =
      getExternalRuntimeConfig().main;
    const { embedPoster } = this.getSettings();
    const maxLength =
      embedPoster && payload.image
        ? TELEGRAM_PHOTO_CAPTION_LIMIT
        : TELEGRAM_MESSAGE_TEXT_LIMIT;

    let message = '';
    const appendEscaped = (
      prefix: string,
      value: string | undefined,
      suffix = '',
      valueLimit = Number.MAX_SAFE_INTEGER
    ) => {
      const available = Math.min(
        valueLimit,
        maxLength - message.length - prefix.length - suffix.length
      );
      if (available <= 0 || !value) {
        return;
      }
      message += `${prefix}${escapeTelegramMarkdownText(
        value,
        available
      )}${suffix}`;
    };

    /* eslint-disable no-useless-escape */
    appendEscaped(
      '\*',
      payload.event ? `${payload.event} - ${payload.subject}` : payload.subject,
      '\*',
      256
    );
    if (payload.message && !payload.comment) {
      appendEscaped('\n', payload.message, '', Math.max(1, maxLength - 512));
    }

    if (payload.request) {
      appendEscaped(
        `\n\n\*${escapeTelegramMarkdownText(
          intl.formatMessage(globalMessages.requestedBy)
        )}:\* `,
        payload.request.requestedBy.displayName
      );

      let status = '';
      switch (type) {
        case Notification.MEDIA_AUTO_REQUESTED:
          status =
            payload.media?.status === MediaStatus.PENDING
              ? intl.formatMessage(globalMessages.pendingApproval)
              : intl.formatMessage(globalMessages.processing);
          break;
        case Notification.MEDIA_PENDING:
          status = intl.formatMessage(globalMessages.pendingApproval);
          break;
        case Notification.MEDIA_APPROVED:
        case Notification.MEDIA_AUTO_APPROVED:
          status = intl.formatMessage(globalMessages.processing);
          break;
        case Notification.MEDIA_AVAILABLE:
          status = intl.formatMessage(globalMessages.available);
          break;
        case Notification.MEDIA_DECLINED:
          status = intl.formatMessage(globalMessages.declined);
          break;
        case Notification.MEDIA_FAILED:
          status = intl.formatMessage(globalMessages.failed);
          break;
      }

      if (status) {
        appendEscaped(
          `\n\*${escapeTelegramMarkdownText(
            intl.formatMessage(globalMessages.requestStatus)
          )}:\* `,
          status
        );
      }
    } else if (payload.comment) {
      appendEscaped(
        `\n\n\*${escapeTelegramMarkdownText(
          intl.formatMessage(globalMessages.commentFrom, {
            userName: payload.comment.user.displayName,
          })
        )}:\* `,
        payload.comment.message,
        '',
        Math.max(1, maxLength - 512)
      );
    } else if (payload.issue) {
      appendEscaped(
        `\n\n\*${escapeTelegramMarkdownText(
          intl.formatMessage(globalMessages.reportedBy)
        )}:\* `,
        payload.issue.createdBy.displayName
      );
      appendEscaped(
        `\n\*${escapeTelegramMarkdownText(
          intl.formatMessage(globalMessages.issueType)
        )}:\* `,
        IssueTypeName[payload.issue.issueType]
      );
      appendEscaped(
        `\n\*${escapeTelegramMarkdownText(
          intl.formatMessage(globalMessages.issueStatus)
        )}:\* `,
        payload.issue.status === IssueStatus.OPEN
          ? intl.formatMessage(globalMessages.open)
          : intl.formatMessage(globalMessages.resolved)
      );
    }

    for (const extra of payload.extra ?? []) {
      appendEscaped(
        `\n\*${escapeTelegramMarkdownText(extra.name, 128)}:\* `,
        extra.value,
        '',
        512
      );
    }

    const url = getNotificationActionUrl(payload, applicationUrl);

    if (url) {
      const link = `\n\n\[${escapeTelegramMarkdownText(
        intl.formatMessage(getNotificationActionLabel(payload), {
          applicationTitle,
        })
      )}\]\(${escapeTelegramMarkdownUrl(url)}\)`;
      if (message.length + link.length <= maxLength) {
        message += link;
      }
    }
    /* eslint-enable */

    return embedPoster && payload.image
      ? {
          photo: payload.image,
          caption: message,
          parse_mode: 'MarkdownV2',
        }
      : {
          text: message,
          parse_mode: 'MarkdownV2',
        };
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();
    const endpoint = `${this.baseUrl}bot${settings.options.botAPI}/${
      settings.embedPoster && payload.image ? 'sendPhoto' : 'sendMessage'
    }`;

    // Send system notification
    if (
      payload.notifySystem &&
      hasNotificationType(type, settings.types ?? 0) &&
      settings.options.chatId
    ) {
      logger.debug('Sending Telegram notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
      });

      try {
        const notificationPayload = this.buildPayload(type, payload);

        await axios.post(
          endpoint,
          {
            ...notificationPayload,
            chat_id: settings.options.chatId,
            message_thread_id: settings.options.messageThreadId,
            disable_notification: !!settings.options.sendSilently,
          } as TelegramMessagePayload | TelegramPhotoPayload,
          NOTIFICATION_HTTP_OPTIONS
        );
      } catch (e) {
        logger.error('Error sending Telegram notification', {
          label: 'Notifications',
          type: Notification[type],
          subject: payload.subject,
          errorMessage: e.message,
          response: redactSecrets(e?.response?.data),
        });

        return false;
      }
    }

    if (payload.notifyUser) {
      if (
        payload.notifyUser.settings?.hasNotificationType(
          NotificationAgentKey.TELEGRAM,
          type
        ) &&
        payload.notifyUser.settings?.telegramChatId &&
        payload.notifyUser.settings.telegramChatId !== settings.options.chatId
      ) {
        logger.debug('Sending Telegram notification', {
          label: 'Notifications',
          recipient: payload.notifyUser.displayName,
          type: Notification[type],
          subject: payload.subject,
        });

        try {
          const notificationPayload = this.buildPayload(
            type,
            payload,
            payload.notifyUser.settings?.locale as AvailableLocale
          );

          await axios.post(
            endpoint,
            {
              ...notificationPayload,
              chat_id: payload.notifyUser.settings.telegramChatId,
              message_thread_id:
                payload.notifyUser.settings.telegramMessageThreadId,
              disable_notification:
                !!payload.notifyUser.settings.telegramSendSilently,
            } as TelegramMessagePayload | TelegramPhotoPayload,
            NOTIFICATION_HTTP_OPTIONS
          );
        } catch (e) {
          logger.error('Error sending Telegram notification', {
            label: 'Notifications',
            recipient: payload.notifyUser.displayName,
            type: Notification[type],
            subject: payload.subject,
            errorMessage: e.message,
            response: redactSecrets(e?.response?.data),
          });

          return false;
        }
      }
    }

    if (payload.notifyAdmin) {
      let adminDeliveryFailed = false;
      await forEachNotificationUserBatch(async (users) => {
        const adminDeliveries = await mapWithConcurrency(
          users.filter(
            (user) =>
              user.settings?.hasNotificationType(
                NotificationAgentKey.TELEGRAM,
                type
              ) && shouldSendAdminNotification(type, user, payload)
          ),
          NOTIFICATION_DELIVERY_CONCURRENCY,
          async (user) => {
            if (
              user.settings?.telegramChatId &&
              user.settings.telegramChatId !== settings.options.chatId
            ) {
              logger.debug('Sending Telegram notification', {
                label: 'Notifications',
                recipient: user.displayName,
                type: Notification[type],
                subject: payload.subject,
              });

              try {
                const notificationPayload = this.buildPayload(
                  type,
                  payload,
                  user.settings?.locale as AvailableLocale
                );

                await axios.post(
                  endpoint,
                  {
                    ...notificationPayload,
                    chat_id: user.settings.telegramChatId,
                    message_thread_id: user.settings.telegramMessageThreadId,
                    disable_notification: !!user.settings?.telegramSendSilently,
                  } as TelegramMessagePayload | TelegramPhotoPayload,
                  NOTIFICATION_HTTP_OPTIONS
                );
              } catch (e) {
                logger.error('Error sending Telegram notification', {
                  label: 'Notifications',
                  recipient: user.displayName,
                  type: Notification[type],
                  subject: payload.subject,
                  errorMessage: e.message,
                  response: redactSecrets(e?.response?.data),
                });

                return false;
              }
            }
          }
        );
        adminDeliveryFailed ||= adminDeliveries.some(
          (delivered) => delivered === false
        );
      });
      if (adminDeliveryFailed) {
        return false;
      }
    }

    return true;
  }
}

export default TelegramAgent;
