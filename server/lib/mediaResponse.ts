import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type SeasonRequest from '@server/entity/SeasonRequest';
import type { User } from '@server/entity/User';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { issueLiveDownloadToken } from '@server/lib/liveDownloadTokens';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { createHmac } from 'node:crypto';

const projectPublicMediaRequest = (request: MediaRequest): MediaRequest =>
  ({
    // These fields describe availability and are required to keep duplicate
    // request controls and per-season/per-format status accurate. Ownership,
    // routing, service, and filesystem details are deliberately omitted.
    status: request.status,
    type: request.type,
    seasons: (request.seasons ?? []).map(
      (season) =>
        ({
          seasonNumber: season.seasonNumber,
          episodeNumbers: season.episodeNumbers,
        }) as SeasonRequest
    ),
    is4k: request.is4k,
    bookFormat: request.bookFormat,
    createdAt: request.createdAt,
  }) as MediaRequest;

/**
 * Request-list routes expose either the active user's records or all records
 * to request viewers/managers. Apply the same ownership boundary to requests
 * embedded in media payloads while retaining a non-identifying availability
 * projection for foreign requests.
 */
export const restrictMediaRequestsForUser = (
  media: Media | undefined,
  user: User | undefined
): Media | undefined => {
  if (!media?.requests) {
    return media;
  }

  const canViewAllRequests =
    user?.hasPermission([Permission.REQUEST_VIEW, Permission.MANAGE_REQUESTS], {
      type: 'or',
    }) ?? false;

  if (!canViewAllRequests) {
    media.requests = media.requests.map((request) =>
      request.requestedBy?.id === user?.id
        ? request
        : projectPublicMediaRequest(request)
    );
  }

  return media;
};

/**
 * Restricts user-owned relations embedded in media detail responses. Issue
 * routes allow ordinary users to read their own reports, while VIEW_ISSUES or
 * MANAGE_ISSUES grants access to reports from other users; media payloads must
 * enforce the same boundary instead of relying on the client to hide rows.
 */
export const restrictMediaIssuesForUser = (
  media: Media | undefined,
  user: User | undefined
): Media | undefined => {
  if (!media?.issues) {
    return media;
  }

  const canViewAllIssues =
    user?.hasPermission([Permission.VIEW_ISSUES, Permission.MANAGE_ISSUES], {
      type: 'or',
    }) ?? false;

  if (!canViewAllIssues) {
    media.issues = media.issues.filter(
      (issue) => issue.createdBy?.id === user?.id
    );
  }

  return media;
};

export const aliasDownloadId = (
  downloadId: string,
  secret = getSettings().sessionSecret
): string => createHmac('sha256', secret).update(downloadId).digest('hex');

const projectDownloadForNonAdmin = (
  item: DownloadingItem,
  userId: number | undefined
): DownloadingItem => {
  const liveDownloadToken =
    userId === undefined
      ? undefined
      : issueLiveDownloadToken(item.downloadId, userId);

  return {
    mediaType: item.mediaType,
    externalId: 0,
    size: item.size,
    sizeLeft: item.sizeLeft,
    status: item.status,
    timeLeft: item.timeLeft,
    estimatedCompletionTime: item.estimatedCompletionTime,
    title: '',
    // The client only uses this value to group episodes belonging to one
    // download. A one-way alias preserves that behavior without exposing the
    // downloader's queue or torrent identifier.
    downloadId: item.downloadId ? aliasDownloadId(item.downloadId) : '',
    ...(liveDownloadToken ? { liveDownloadToken } : {}),
    episode: item.episode
      ? ({
          seasonNumber: item.episode.seasonNumber,
          episodeNumber: item.episode.episodeNumber,
        } as DownloadingItem['episode'])
      : undefined,
  } as DownloadingItem;
};

/**
 * Removes backend routing identifiers and release details that the UI does
 * not expose at the caller's permission level.
 */
export const restrictMediaOperationalFieldsForUser = (
  media: Media | undefined,
  user: User | undefined
): Media | undefined => {
  if (!media) {
    return media;
  }

  const isAdmin = user?.hasPermission(Permission.ADMIN) ?? false;
  if (!isAdmin) {
    media.downloadStatus = (media.downloadStatus ?? []).map((item) =>
      projectDownloadForNonAdmin(item, user?.id)
    );
    media.downloadStatus4k = (media.downloadStatus4k ?? []).map((item) =>
      projectDownloadForNonAdmin(item, user?.id)
    );
    media.audiobookDownloadStatus = (media.audiobookDownloadStatus ?? []).map(
      (item) => projectDownloadForNonAdmin(item, user?.id)
    );
  }

  const canManageRequests =
    user?.hasPermission([Permission.ADMIN, Permission.MANAGE_REQUESTS], {
      type: 'or',
    }) ?? false;
  if (!canManageRequests) {
    for (const field of [
      'serviceUrl',
      'serviceUrl4k',
      'audiobookServiceUrl',
      'tautulliUrl',
      'tautulliUrl4k',
      'externalServiceSlug',
      'externalServiceSlug4k',
      'audiobookExternalServiceSlug',
      'ratingKey',
      'ratingKey4k',
      'jellyfinMediaId',
      'jellyfinMediaId4k',
    ] as const) {
      delete media[field];
    }
  }

  return media;
};

export const restrictMediaRelationsForUser = (
  media: Media | undefined,
  user: User | undefined
): Media | undefined => {
  restrictMediaRequestsForUser(media, user);
  restrictMediaIssuesForUser(media, user);
  restrictMediaOperationalFieldsForUser(media, user);
  return media;
};
