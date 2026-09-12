import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type IssueComment from '@server/entity/IssueComment';
import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { IntlInstance } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import {
  isValidOpenLibraryResourceId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import type { NotificationAgentConfig } from '@server/lib/settings';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import type { Notification } from '..';

export interface NotificationPayload {
  event?: string;
  subject: string;
  notifySystem: boolean;
  notifyAdmin: boolean;
  notifyUser?: User;
  media?: Media;
  mediaUrl?: string;
  image?: string;
  message?: string;
  extra?: { name: string; value: string }[];
  request?: MediaRequest;
  issue?: Issue;
  comment?: IssueComment;
  pendingRequestsCount?: number;
  isAdmin?: boolean;
}

export const NOTIFICATION_HTTP_OPTIONS = {
  ...createSafeHttpRequestOptions(
    () => process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS === 'true',
    false
  ),
  timeout: 10_000,
  maxBodyLength: 128 * 1024,
  maxContentLength: 128 * 1024,
};
export const CONFIGURABLE_NOTIFICATION_HTTP_OPTIONS = {
  ...NOTIFICATION_HTTP_OPTIONS,
  ...createSafeHttpRequestOptions(
    () => process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS === 'true',
    false,
    true
  ),
};
export const NOTIFICATION_DELIVERY_CONCURRENCY = 10;

export const truncateNotificationText = (
  value: string,
  maxLength: number
): string => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 0) {
    return '';
  }

  let output = '';
  for (const character of value) {
    if (output.length + character.length + 1 > maxLength) {
      break;
    }
    output += character;
  }
  return `${output}…`;
};

export const truncateNotificationUtf8 = (
  value: string,
  maxBytes: number
): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  if (maxBytes <= 0) {
    return '';
  }

  const omission = '…';
  const omissionBytes = Buffer.byteLength(omission, 'utf8');
  if (omissionBytes > maxBytes) {
    return '';
  }
  let output = '';
  let outputBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (outputBytes + characterBytes + omissionBytes > maxBytes) {
      break;
    }
    output += character;
    outputBytes += characterBytes;
  }
  return `${output}${omission}`;
};

const isSafeRelativeNotificationPath = (value: string): boolean => {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\r\n]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, 'https://seerr.invalid');
    const path = value.split(/[?#]/, 1)[0];
    return (
      parsed.origin === 'https://seerr.invalid' && parsed.pathname === path
    );
  } catch {
    return false;
  }
};

export const getMediaTypeLabel = (
  intl: IntlInstance,
  mediaType: Media['mediaType']
): string => {
  switch (mediaType) {
    case MediaType.MOVIE:
      return intl.formatMessage(globalMessages.movie);
    case MediaType.MUSIC:
      return intl.formatMessage(globalMessages.music);
    case MediaType.BOOK:
      return intl.formatMessage(globalMessages.book);
    default:
      return intl.formatMessage(globalMessages.series);
  }
};

export const getNotificationMediaUrl = (
  payload: Pick<NotificationPayload, 'media' | 'mediaUrl'>
): string | undefined => {
  if (payload.mediaUrl) {
    return isSafeRelativeNotificationPath(payload.mediaUrl)
      ? payload.mediaUrl
      : undefined;
  }

  if (!payload.media) {
    return undefined;
  }

  if (payload.media.mediaType === 'music') {
    const musicBrainzId = payload.media.mbId
      ? normalizeMusicBrainzId(payload.media.mbId)
      : undefined;
    return musicBrainzId
      ? `/music/${encodeURIComponent(musicBrainzId)}`
      : undefined;
  }

  if (payload.media.mediaType === 'book') {
    const openLibraryId = payload.media.identifiers?.find(
      (identifier) => identifier.provider === 'openlibrary'
    )?.value;

    const normalizedOpenLibraryId = openLibraryId
      ? normalizeOpenLibraryWorkId(openLibraryId)
      : undefined;
    return normalizedOpenLibraryId &&
      isValidOpenLibraryResourceId(normalizedOpenLibraryId)
      ? `/book/${encodeURIComponent(normalizedOpenLibraryId)}`
      : undefined;
  }

  return `/${payload.media.mediaType}/${payload.media.tmdbId}`;
};

export const getNotificationActionUrl = (
  payload: Pick<NotificationPayload, 'issue' | 'media' | 'mediaUrl'>,
  applicationUrl?: string
): string | undefined => {
  if (!applicationUrl) {
    return undefined;
  }

  if (payload.issue) {
    return `${applicationUrl}/issues/${payload.issue.id}`;
  }

  const mediaUrl = getNotificationMediaUrl(payload);

  return mediaUrl ? `${applicationUrl}${mediaUrl}` : undefined;
};

export abstract class BaseAgent<T extends NotificationAgentConfig> {
  protected settings?: T;
  public constructor(settings?: T) {
    this.settings = settings;
  }

  protected abstract getSettings(): T;
}

export interface NotificationAgent {
  shouldSend(): boolean;
  send(type: Notification, payload: NotificationPayload): Promise<boolean>;
}
