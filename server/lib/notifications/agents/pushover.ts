import { IssueStatus, IssueTypeName } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import { getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import {
  getExternalNotificationAgent,
  getExternalRuntimeConfig,
} from '@server/lib/externalRuntimeConfig';
import { forEachNotificationUserBatch } from '@server/lib/notifications/userBatches';
import type { NotificationAgentPushover } from '@server/lib/settings';
import { NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import type { AvailableLocale } from '@server/types/languages';
import { mapWithConcurrency } from '@server/utils/concurrency';
import {
  createSafeHttpRequestOptions,
  isSafeHttpUrl,
  redactSecrets,
} from '@server/utils/security';
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
  truncateNotificationText,
} from './agent';

interface PushoverImagePayload {
  attachment_base64: string;
  attachment_type: string;
}

interface PushoverPayload extends PushoverImagePayload {
  token: string;
  user: string;
  title: string;
  message: string;
  url: string;
  url_title: string;
  priority: number;
  html: number;
}

const maxPushoverAttachmentBytes = 5 * 1024 * 1024;
export const PUSHOVER_MESSAGE_LIMIT = 1_024;
export const PUSHOVER_TITLE_LIMIT = 250;
export const PUSHOVER_URL_LIMIT = 512;
export const PUSHOVER_URL_TITLE_LIMIT = 100;

export const escapePushoverHtmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const pushoverHtmlToPlainText = (value: string): string => {
  let text = '';
  let index = 0;
  let skipUntilClosingTag: 'script' | 'style' | undefined;

  while (index < value.length) {
    if (skipUntilClosingTag) {
      const closingTag = `</${skipUntilClosingTag}`;
      const closingIndex = value.toLowerCase().indexOf(closingTag, index);
      if (closingIndex === -1) {
        break;
      }
      index = closingIndex;
      skipUntilClosingTag = undefined;
    }

    if (value[index] !== '<') {
      text += value[index];
      index += 1;
      continue;
    }

    const tagEnd = value.indexOf('>', index + 1);
    if (tagEnd === -1) {
      break;
    }

    const tagName = value
      .slice(index + 1, tagEnd)
      .trim()
      .toLowerCase();
    if (tagName.startsWith('script') && /^(?:script)(?:\s|$)/.test(tagName)) {
      skipUntilClosingTag = 'script';
    } else if (
      tagName.startsWith('style') &&
      /^(?:style)(?:\s|$)/.test(tagName)
    ) {
      skipUntilClosingTag = 'style';
    }
    index = tagEnd + 1;
  }

  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
};

class PushoverAgent
  extends BaseAgent<NotificationAgentPushover>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentPushover {
    if (this.settings) {
      return this.settings;
    }

    return getExternalNotificationAgent(NotificationAgentKey.PUSHOVER);
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (
      settings.enabled &&
      settings.options.accessToken &&
      settings.options.userToken
    ) {
      return true;
    }

    return false;
  }

  private async getImagePayload(
    imageUrl: string
  ): Promise<Partial<PushoverImagePayload>> {
    try {
      if (!(await isSafeHttpUrl(imageUrl))) {
        logger.error('Invalid Pushover image URL', {
          label: 'Notifications',
        });
        return {};
      }

      const response = await axios.get(imageUrl, {
        ...createSafeHttpRequestOptions(false, true, true),
        maxContentLength: maxPushoverAttachmentBytes,
        maxRedirects: 3,
        responseType: 'arraybuffer',
        timeout: 10_000,
      });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const contentType = (
        response.headers['Content-Type'] || response.headers['content-type']
      )?.toString();

      return {
        attachment_base64: base64,
        attachment_type: contentType,
      };
    } catch (e) {
      logger.error('Error getting image payload', {
        label: 'Notifications',
        errorMessage: e.message,
        response: redactSecrets(e.response?.data),
      });
      return {};
    }
  }

  public async buildPayload(
    type: Notification,
    payload: NotificationPayload,
    locale?: AvailableLocale
  ): Promise<Partial<PushoverPayload>> {
    const intl = getIntl(locale);
    const { applicationUrl, applicationTitle } =
      getExternalRuntimeConfig().main;
    const { embedPoster } = this.getSettings();
    const escape = escapePushoverHtmlText;

    const title = truncateNotificationText(
      payload.event ?? payload.subject,
      PUSHOVER_TITLE_LIMIT
    );
    let message = payload.event ? `<b>${escape(payload.subject)}</b>` : '';
    let priority = 0;

    if (payload.message && !payload.comment) {
      message += `<small>${message ? '\n' : ''}${escape(
        payload.message
      )}</small>`;
    }

    if (payload.request) {
      message += `<small>\n\n<b>${escape(
        intl.formatMessage(globalMessages.requestedBy)
      )}:</b> ${escape(payload.request.requestedBy.displayName)}</small>`;

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
          priority = 1;
          break;
        case Notification.MEDIA_FAILED:
          status = intl.formatMessage(globalMessages.failed);
          priority = 1;
          break;
      }

      if (status) {
        message += `<small>\n<b>${escape(
          intl.formatMessage(globalMessages.requestStatus)
        )}:</b> ${escape(status)}</small>`;
      }
    } else if (payload.comment) {
      message += `<small>\n\n<b>${escape(
        intl.formatMessage(globalMessages.commentFrom, {
          userName: payload.comment.user.displayName,
        })
      )}:</b> ${escape(payload.comment.message)}</small>`;
    } else if (payload.issue) {
      message += `<small>\n\n<b>${escape(
        intl.formatMessage(globalMessages.reportedBy)
      )}:</b> ${escape(payload.issue.createdBy.displayName)}</small>`;
      message += `<small>\n<b>${escape(
        intl.formatMessage(globalMessages.issueType)
      )}:</b> ${escape(IssueTypeName[payload.issue.issueType])}</small>`;
      message += `<small>\n<b>${escape(
        intl.formatMessage(globalMessages.issueStatus)
      )}:</b> ${escape(
        payload.issue.status === IssueStatus.OPEN
          ? intl.formatMessage(globalMessages.open)
          : intl.formatMessage(globalMessages.resolved)
      )}</small>`;

      if (type === Notification.ISSUE_CREATED) {
        priority = 1;
      }
    }

    for (const extra of payload.extra ?? []) {
      message += `<small>\n<b>${escape(extra.name)}:</b> ${escape(
        extra.value
      )}</small>`;
    }

    let html = 1;
    if (message.length > PUSHOVER_MESSAGE_LIMIT) {
      message = truncateNotificationText(
        pushoverHtmlToPlainText(message),
        PUSHOVER_MESSAGE_LIMIT
      );
      html = 0;
    }

    const url = getNotificationActionUrl(payload, applicationUrl);
    const boundedUrl =
      url && url.length <= PUSHOVER_URL_LIMIT ? url : undefined;
    const url_title = boundedUrl
      ? truncateNotificationText(
          intl.formatMessage(getNotificationActionLabel(payload), {
            applicationTitle,
          }),
          PUSHOVER_URL_TITLE_LIMIT
        )
      : undefined;

    let attachment_base64;
    let attachment_type;
    if (embedPoster && payload.image) {
      const imagePayload = await this.getImagePayload(payload.image);
      if (imagePayload.attachment_base64 && imagePayload.attachment_type) {
        attachment_base64 = imagePayload.attachment_base64;
        attachment_type = imagePayload.attachment_type;
      }
    }

    return {
      title,
      message,
      url: boundedUrl,
      url_title,
      priority,
      html,
      attachment_base64,
      attachment_type,
    };
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();
    const endpoint = 'https://api.pushover.net/1/messages.json';

    // Send system notification
    if (
      payload.notifySystem &&
      hasNotificationType(type, settings.types ?? 0) &&
      settings.enabled &&
      settings.options.accessToken &&
      settings.options.userToken
    ) {
      logger.debug('Sending Pushover notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
      });

      try {
        const notificationPayload = await this.buildPayload(type, payload);

        await axios.post(
          endpoint,
          {
            ...notificationPayload,
            token: settings.options.accessToken,
            user: settings.options.userToken,
            sound: settings.options.sound,
          } as PushoverPayload,
          NOTIFICATION_HTTP_OPTIONS
        );
      } catch (e) {
        logger.error('Error sending Pushover notification', {
          label: 'Notifications',
          type: Notification[type],
          subject: payload.subject,
          errorMessage: e.message,
          response: redactSecrets(e.response?.data),
        });

        return false;
      }
    }

    if (payload.notifyUser) {
      if (
        payload.notifyUser.settings?.hasNotificationType(
          NotificationAgentKey.PUSHOVER,
          type
        ) &&
        payload.notifyUser.settings.pushoverApplicationToken &&
        payload.notifyUser.settings.pushoverUserKey &&
        (payload.notifyUser.settings.pushoverApplicationToken !==
          settings.options.accessToken ||
          payload.notifyUser.settings.pushoverUserKey !==
            settings.options.userToken)
      ) {
        logger.debug('Sending Pushover notification', {
          label: 'Notifications',
          recipient: payload.notifyUser.displayName,
          type: Notification[type],
          subject: payload.subject,
        });

        try {
          const notificationPayload = await this.buildPayload(
            type,
            payload,
            payload.notifyUser.settings?.locale as AvailableLocale
          );

          await axios.post(
            endpoint,
            {
              ...notificationPayload,
              token: payload.notifyUser.settings.pushoverApplicationToken,
              user: payload.notifyUser.settings.pushoverUserKey,
              sound: payload.notifyUser.settings.pushoverSound,
            } as PushoverPayload,
            NOTIFICATION_HTTP_OPTIONS
          );
        } catch (e) {
          logger.error('Error sending Pushover notification', {
            label: 'Notifications',
            recipient: payload.notifyUser.displayName,
            type: Notification[type],
            subject: payload.subject,
            errorMessage: e.message,
            response: redactSecrets(e.response?.data),
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
                NotificationAgentKey.PUSHOVER,
                type
              ) && shouldSendAdminNotification(type, user, payload)
          ),
          NOTIFICATION_DELIVERY_CONCURRENCY,
          async (user) => {
            if (
              user.settings?.pushoverApplicationToken &&
              user.settings?.pushoverUserKey &&
              user.settings.pushoverApplicationToken !==
                settings.options.accessToken &&
              user.settings.pushoverUserKey !== settings.options.userToken
            ) {
              logger.debug('Sending Pushover notification', {
                label: 'Notifications',
                recipient: user.displayName,
                type: Notification[type],
                subject: payload.subject,
              });

              try {
                const notificationPayload = await this.buildPayload(
                  type,
                  payload,
                  user.settings?.locale as AvailableLocale
                );

                await axios.post(
                  endpoint,
                  {
                    ...notificationPayload,
                    token: user.settings.pushoverApplicationToken,
                    user: user.settings.pushoverUserKey,
                  } as PushoverPayload,
                  NOTIFICATION_HTTP_OPTIONS
                );
              } catch (e) {
                logger.error('Error sending Pushover notification', {
                  label: 'Notifications',
                  recipient: user.displayName,
                  type: Notification[type],
                  subject: payload.subject,
                  errorMessage: e.message,
                  response: redactSecrets(e.response?.data),
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

export default PushoverAgent;
