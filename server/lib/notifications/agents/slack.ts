import { IssueStatus, IssueTypeName } from '@server/constants/issue';
import { getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import {
  getExternalNotificationAgent,
  getExternalRuntimeConfig,
} from '@server/lib/externalRuntimeConfig';
import type { NotificationAgentSlack } from '@server/lib/settings';
import { NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import {
  createSafeHttpUrl,
  redactSecrets,
  stringifySafeHttpUrl,
} from '@server/utils/security';
import axios from 'axios';
import { Notification, hasNotificationType } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import {
  BaseAgent,
  CONFIGURABLE_NOTIFICATION_HTTP_OPTIONS,
  getNotificationActionLabel,
  getNotificationActionUrl,
} from './agent';

interface EmbedField {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  verbatim?: boolean;
}

interface TextItem {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
  verbatim?: boolean;
}

interface Element {
  type: 'button';
  text?: TextItem;
  action_id: string;
  url?: string;
  value?: string;
  style?: 'primary' | 'danger';
}

interface EmbedBlock {
  type: 'header' | 'actions' | 'section' | 'context';
  block_id?: 'section789';
  text?: TextItem;
  fields?: EmbedField[];
  accessory?: {
    type: 'image';
    image_url: string;
    alt_text: string;
  };
  elements?: (Element | TextItem)[];
}

interface SlackBlockEmbed {
  text: string;
  blocks: EmbedBlock[];
}

export const SLACK_HEADER_TEXT_LIMIT = 150;
export const SLACK_FIELD_LABEL_LIMIT = 256;
export const SLACK_FIELD_TEXT_LIMIT = 2_000;
export const SLACK_SECTION_TEXT_LIMIT = 3_000;
export const SLACK_FALLBACK_TEXT_LIMIT = 4_000;

const takeSlackText = (value: string, maxLength: number): string => {
  let output = '';
  for (const character of value) {
    if (output.length + character.length > maxLength) {
      break;
    }
    output += character;
  }
  return output;
};

const truncateSlackText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 0) {
    return '';
  }
  return `${takeSlackText(value, maxLength - 1)}…`;
};

export const escapeSlackMrkdwnText = (
  value: string,
  maxLength = Number.MAX_SAFE_INTEGER
): string => {
  let output = '';
  for (const character of value) {
    const escaped =
      character === '&'
        ? '&amp;'
        : character === '<'
          ? '&lt;'
          : character === '>'
            ? '&gt;'
            : character;
    if (output.length + escaped.length > maxLength) {
      return maxLength > 0 ? `${takeSlackText(output, maxLength - 1)}…` : '';
    }
    output += escaped;
  }
  return output;
};

const buildSlackField = (label: string, value: string): EmbedField => {
  const prefix = `*${escapeSlackMrkdwnText(label, SLACK_FIELD_LABEL_LIMIT)}*\n`;
  return {
    type: 'mrkdwn',
    text: `${prefix}${escapeSlackMrkdwnText(
      value,
      Math.max(0, SLACK_FIELD_TEXT_LIMIT - prefix.length)
    )}`,
    verbatim: true,
  };
};

class SlackAgent
  extends BaseAgent<NotificationAgentSlack>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentSlack {
    if (this.settings) {
      return this.settings;
    }

    return getExternalNotificationAgent(NotificationAgentKey.SLACK);
  }

  public buildEmbed(
    type: Notification,
    payload: NotificationPayload
  ): SlackBlockEmbed {
    const settings = this.getSettings();
    const intl = getIntl(settings.options.locale);
    const { applicationUrl, applicationTitle } =
      getExternalRuntimeConfig().main;
    const embedPoster = settings.embedPoster;

    const fields: EmbedField[] = [];

    if (payload.request) {
      fields.push(
        buildSlackField(
          intl.formatMessage(globalMessages.requestedBy),
          payload.request.requestedBy.displayName
        )
      );

      let status = '';
      switch (type) {
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
        fields.push(
          buildSlackField(
            intl.formatMessage(globalMessages.requestStatus),
            status
          )
        );
      }
    } else if (payload.comment) {
      fields.push(
        buildSlackField(
          intl.formatMessage(globalMessages.commentFrom, {
            userName: payload.comment.user.displayName,
          }),
          payload.comment.message
        )
      );
    } else if (payload.issue) {
      fields.push(
        buildSlackField(
          intl.formatMessage(globalMessages.reportedBy),
          payload.issue.createdBy.displayName
        ),
        buildSlackField(
          intl.formatMessage(globalMessages.issueType),
          IssueTypeName[payload.issue.issueType]
        ),
        buildSlackField(
          intl.formatMessage(globalMessages.issueStatus),
          payload.issue.status === IssueStatus.OPEN
            ? intl.formatMessage(globalMessages.open)
            : intl.formatMessage(globalMessages.resolved)
        )
      );
    }

    for (const extra of payload.extra ?? []) {
      fields.push(buildSlackField(extra.name, extra.value));
    }

    const blocks: EmbedBlock[] = [];

    if (payload.event) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*${escapeSlackMrkdwnText(
              payload.event,
              SLACK_SECTION_TEXT_LIMIT - 2
            )}*`,
            verbatim: true,
          },
        ],
      });
    }

    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: truncateSlackText(payload.subject, SLACK_HEADER_TEXT_LIMIT),
      },
    });

    if (payload.message) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: escapeSlackMrkdwnText(
            payload.message,
            SLACK_SECTION_TEXT_LIMIT
          ),
          verbatim: true,
        },
        accessory:
          embedPoster && payload.image
            ? {
                type: 'image',
                image_url: payload.image,
                alt_text: payload.subject,
              }
            : undefined,
      });
    }

    if (fields.length > 0) {
      blocks.push({
        type: 'section',
        fields,
      });
    }

    const url = getNotificationActionUrl(payload, applicationUrl);

    if (url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            action_id: 'open-in-seerr',
            type: 'button',
            url,
            text: {
              type: 'plain_text',
              text: intl.formatMessage(getNotificationActionLabel(payload), {
                applicationTitle,
              }),
            },
          },
        ],
      });
    }

    return {
      text: escapeSlackMrkdwnText(
        payload.event ?? payload.subject,
        SLACK_FALLBACK_TEXT_LIMIT
      ),
      blocks,
    };
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (settings.enabled && settings.options.webhookUrl) {
      return true;
    }

    return false;
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();

    if (
      !payload.notifySystem ||
      !hasNotificationType(type, settings.types ?? 0)
    ) {
      return true;
    }

    logger.debug('Sending Slack notification', {
      label: 'Notifications',
      type: Notification[type],
      subject: payload.subject,
    });

    const webhookUrl = await createSafeHttpUrl(settings.options.webhookUrl, {
      allowPrivateAddresses:
        process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS === 'true',
    });
    if (!webhookUrl) {
      logger.error('Invalid Slack webhook URL', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
      });
      return false;
    }

    try {
      await axios.post(
        stringifySafeHttpUrl(webhookUrl),
        this.buildEmbed(type, payload),
        CONFIGURABLE_NOTIFICATION_HTTP_OPTIONS
      );

      return true;
    } catch (e) {
      logger.error('Error sending Slack notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
        errorMessage: e.message,
        response: redactSecrets(e?.response?.data),
      });

      return false;
    }
  }
}

export default SlackAgent;
