import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
  ServiceConfigurationError,
  getRequestMutationAdmissionKey,
  hasMediaRequestPermission,
  runWithRequestAdmission,
} from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type {
  BulkMediaRequestBody,
  BulkMediaRequestResponse,
  MediaRequestBody,
  RequestResultsResponse,
  RequestStatusDetailResponse,
  RequestStatusResultsResponse,
  RequestStatusUsersResponse,
} from '@server/interfaces/api/requestInterfaces';
import {
  isValidMusicBrainzResourceId,
  isValidOpenLibraryResourceId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryAuthorId,
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { hydrateMediaRequestRelations } from '@server/lib/mediaRequestHydration';
import { aliasDownloadId } from '@server/lib/mediaResponse';
import { Permission } from '@server/lib/permissions';
import requestDispatchManager from '@server/lib/requestDispatch';
import {
  RequestStatusStage,
  getRequestStatusHistory,
  getRequestStatusPage,
  recordRequestStatus,
} from '@server/lib/requestStatus';
import {
  REQUEST_STATUS_SORT_FIELDS,
  parseRequestStatusSort,
} from '@server/lib/requestStatusSort';
import { runWithCurrentServarrService } from '@server/lib/serviceAdmission';
import {
  UserMutationActorUnauthorizedError,
  acquireAuthorizedUserSecurityMutation,
  isUserCredentialVersionCurrent,
  runAuthorizedUserSecurityMutation,
  runUserSecurityMutation,
  runUserSecurityMutationWithActor,
  runUserSecurityReadWithActor,
  type AuthorizedUserSecurityMutationLease,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseOptionalPositiveInt,
  parsePageParams,
} from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { MAX_SERVARR_INSTANCES_PER_TYPE } from '@server/utils/servarrSettings';
import {
  parseOptionalAllowedString,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router, type Request } from 'express';

const requestRoutes = Router();
export const REQUEST_SERVICE_PROFILE_CONCURRENCY = 10;
const maxBulkRequestItems = 100;
const maxRequestIdValue = 1_000_000_000;
const maxRequestTags = 100;
const maxRequestRootFolderLength = 4096;
const maxRequestProfileNameLength = 512;
const maxBulkRequestItemTextLength = 512;
const maxSeasonCount = 500;
const maxSeasonNumber = 10_000;
const requestMediaTypeFilters = [
  'all',
  'movie',
  'tv',
  'music',
  'book',
] as const;
const requestStatusFilters = [
  'all',
  'approved',
  'processing',
  'pending',
  'unavailable',
  'failed',
  'completed',
  'available',
  'deleted',
] as const;
const requestTimelineStatusFilters = [
  'all',
  'active',
  'attention',
  'completed',
  ...Object.values(RequestStatusStage),
] as const;
const requestStatusBookFormatFilters = ['ebook', 'audiobook'] as const;
const requestStatusTimeFrames = ['7d', '1m', '6m', 'all'] as const;

const getRequestStatusStartDate = (
  timeFrame: (typeof requestStatusTimeFrames)[number] | undefined
): Date | undefined => {
  const days =
    timeFrame === '7d'
      ? 7
      : timeFrame === '1m'
        ? 30
        : timeFrame === '6m'
          ? 180
          : 0;
  return days > 0
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : undefined;
};

const getExpectedCredentialVersion = (
  req: Pick<Request, 'session' | 'user'>
): number | undefined =>
  req.session?.userId === req.user?.id
    ? (req.session.credentialVersion ?? 0)
    : undefined;
const requestSortFields = ['added', 'modified'] as const;
const requestSortDirections = ['asc', 'desc'] as const;
const getErrorLogFields = (error: unknown) => ({
  errorMessage: error instanceof Error ? error.message : 'Unknown error',
  errorStack: error instanceof Error ? error.stack : undefined,
});

const getRequestLogBody = (body: Partial<MediaRequestBody> | undefined) => ({
  mediaType: body?.mediaType,
  mediaId: body?.mediaId,
  is4k: body?.is4k,
  serverId: body?.serverId,
  profileId: body?.profileId,
  metadataProfileId: body?.metadataProfileId,
  format: body?.format,
  editionId: body?.editionId,
  hasIsbn13: !!body?.isbn13,
  authorId: body?.authorId,
  userId: body?.userId,
});

const protectRequestStatusDownloadId = <
  T extends { downloadId: string | null },
>(
  status: T
): T =>
  status.downloadId
    ? { ...status, downloadId: aliasDownloadId(status.downloadId) }
    : status;

const getBulkRequestLogBody = (
  body: Partial<BulkMediaRequestBody> | undefined
) => ({
  mediaType: body?.mediaType,
  itemCount: Array.isArray(body?.items) ? body.items.length : undefined,
  firstMediaIds: Array.isArray(body?.items)
    ? body.items.slice(0, 5).map((item) => item.mediaId)
    : undefined,
  serverId: body?.serverId,
  profileId: body?.profileId,
  metadataProfileId: body?.metadataProfileId,
  format: body?.format,
  userId: body?.userId,
});

const normalizeBulkRequestText = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeBulkRequestMediaId = (mediaType: MediaType, mediaId: string) => {
  if (mediaType === MediaType.BOOK) {
    return normalizeOpenLibraryWorkId(mediaId).toLocaleLowerCase();
  }

  return normalizeMusicBrainzId(mediaId);
};

const getBulkRequestDedupeKey = (
  mediaType: MediaType,
  item: BulkMediaRequestBody['items'][number]
) => {
  if (mediaType === MediaType.BOOK) {
    if (!item.isbn13 && !item.editionId && item.title) {
      return [
        'book-title-author',
        normalizeBulkRequestText(item.title),
        normalizeBulkRequestText(item.authorId),
      ].join('|');
    }

    return [
      normalizeBulkRequestMediaId(mediaType, item.mediaId),
      normalizeBulkRequestText(item.title),
      normalizeBulkRequestText(item.authorId),
      normalizeBulkRequestText(item.isbn13),
      normalizeBulkRequestText(item.editionId),
    ].join('|');
  }

  return normalizeBulkRequestMediaId(mediaType, item.mediaId);
};

const logRequestServiceProfileFailure = (
  serviceType: string,
  serviceId: number,
  serviceName: string | undefined,
  error: unknown
) => {
  logger.warn('Failed to load request service profiles', {
    label: 'Request',
    serviceType,
    serviceId,
    serviceName,
    ...getErrorLogFields(error),
  });
};

const logRequestValidationFailure = (
  action: string,
  error: { status: number; message: string },
  body: Partial<MediaRequestBody> | undefined,
  userId: number | undefined
) => {
  logger.warn('Rejected request payload during validation', {
    label: 'Request',
    action,
    status: error.status,
    message: error.message,
    requestBody: getRequestLogBody(body),
    userId,
  });
};

const parseRequestStatusAction = (
  status: unknown
): MediaRequestStatus | undefined => {
  switch (status) {
    case 'approve':
      return MediaRequestStatus.APPROVED;
    case 'decline':
      return MediaRequestStatus.DECLINED;
    default:
      return undefined;
  }
};

type RequestOptionValidationResult<T> =
  | { value: T }
  | { error: { status: number; message: string } };

const parseOptionalRequestOptionId = (
  value: unknown,
  fieldName: string,
  allowZero = false
): RequestOptionValidationResult<number | undefined> => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  const parsed = allowZero
    ? parseOptionalNonNegativeInteger(value, maxRequestIdValue)
    : parsePositiveRouteId(value, maxRequestIdValue);

  if (parsed === undefined) {
    return {
      error: {
        status: 400,
        message: `${fieldName} must be a ${
          allowZero ? 'non-negative' : 'positive'
        } integer no greater than ${maxRequestIdValue}.`,
      },
    };
  }

  return { value: parsed };
};

const parseRequestParamId = (value: unknown): number | undefined =>
  parsePositiveRouteId(value, maxRequestIdValue);

const parseOptionalRequestString = (
  value: unknown,
  fieldName: string,
  maxLength: number
): RequestOptionValidationResult<string | undefined> => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName,
    maxLength,
  });

  if ('error' in parsed) {
    return { error: { status: 400, message: parsed.error } };
  }

  return { value: parsed.value };
};

const parseOptionalBookFormat = (
  value: unknown
): RequestOptionValidationResult<
  'ebook' | 'audiobook' | 'both' | undefined
> => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  if (value === 'ebook' || value === 'audiobook' || value === 'both') {
    return { value };
  }

  return {
    error: {
      status: 400,
      message: 'format must be ebook, audiobook, or both.',
    },
  };
};

const parseOptionalRequestTags = (
  value: unknown
): RequestOptionValidationResult<number[] | undefined> => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  if (!Array.isArray(value)) {
    return {
      error: { status: 400, message: 'tags must be an array of integers.' },
    };
  }

  if (value.length > maxRequestTags) {
    return {
      error: {
        status: 400,
        message: `tags are limited to ${maxRequestTags} values.`,
      },
    };
  }

  const tags: number[] = [];

  for (const tag of value) {
    const parsed = parseOptionalNonNegativeInteger(tag, maxRequestIdValue);

    if (parsed === undefined || parsed === 0) {
      return {
        error: {
          status: 400,
          message: `tags must contain positive integers no greater than ${maxRequestIdValue}.`,
        },
      };
    }

    if (!tags.includes(parsed)) {
      tags.push(parsed);
    }
  }

  return { value: tags };
};

const parseOptionalRequestSeasons = (
  value: unknown
): RequestOptionValidationResult<number[] | 'all' | undefined> => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  if (value === 'all') {
    return { value };
  }

  if (!Array.isArray(value)) {
    return {
      error: { status: 400, message: 'seasons must be an array or all.' },
    };
  }

  if (value.length > maxSeasonCount) {
    return {
      error: {
        status: 400,
        message: `seasons are limited to ${maxSeasonCount} values.`,
      },
    };
  }

  const seasons: number[] = [];

  for (const season of value) {
    const parsed = parseOptionalNonNegativeInteger(season, maxSeasonNumber);

    if (parsed === undefined) {
      return {
        error: {
          status: 400,
          message: `seasons must contain integers no greater than ${maxSeasonNumber}.`,
        },
      };
    }

    if (!seasons.includes(parsed)) {
      seasons.push(parsed);
    }
  }

  return { value: seasons };
};

const sanitizeMediaRequestBody = (
  body: unknown,
  options: { requireCreateIdentity?: boolean } = {}
): RequestOptionValidationResult<MediaRequestBody> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error: {
        status: 400,
        message: 'Request body must be an object.',
      },
    };
  }

  const bodyObject = body as Partial<Record<keyof MediaRequestBody, unknown>>;
  const mediaType = bodyObject.mediaType;

  if (
    mediaType !== undefined &&
    !Object.values(MediaType).includes(mediaType as MediaType)
  ) {
    return {
      error: { status: 400, message: 'mediaType is invalid.' },
    };
  }
  if (options.requireCreateIdentity && mediaType === undefined) {
    return {
      error: { status: 400, message: 'mediaType is required.' },
    };
  }

  if (bodyObject.is4k !== undefined && typeof bodyObject.is4k !== 'boolean') {
    return {
      error: {
        status: 400,
        message: 'is4k must be a boolean.',
      },
    };
  }

  if (mediaType === MediaType.MUSIC && bodyObject.mediaId !== undefined) {
    if (
      typeof bodyObject.mediaId !== 'string' ||
      !isValidMusicBrainzResourceId(normalizeMusicBrainzId(bodyObject.mediaId))
    ) {
      return {
        error: {
          status: 400,
          message: 'mediaId must be a valid MusicBrainz resource ID.',
        },
      };
    }
  } else if (mediaType === MediaType.MUSIC && options.requireCreateIdentity) {
    return {
      error: {
        status: 400,
        message: 'mediaId is required for music requests.',
      },
    };
  }

  if (mediaType === MediaType.BOOK) {
    const bookIds = [
      {
        field: 'mediaId',
        value: bodyObject.mediaId,
        normalize: normalizeOpenLibraryWorkId,
      },
      {
        field: 'editionId',
        value: bodyObject.editionId,
        normalize: normalizeOpenLibraryEditionId,
      },
      {
        field: 'authorId',
        value: bodyObject.authorId,
        normalize: normalizeOpenLibraryAuthorId,
      },
    ];
    for (const { field, value, normalize } of bookIds) {
      if (
        value !== undefined &&
        (typeof value !== 'string' ||
          !isValidOpenLibraryResourceId(normalize(value)))
      ) {
        return {
          error: {
            status: 400,
            message: `${field} must be a valid Open Library resource ID.`,
          },
        };
      }
    }
    if (options.requireCreateIdentity && bodyObject.mediaId === undefined) {
      return {
        error: {
          status: 400,
          message: 'mediaId is required for book requests.',
        },
      };
    }
  }

  if (mediaType === MediaType.MOVIE || mediaType === MediaType.TV) {
    const mediaId = parsePositiveRouteId(bodyObject.mediaId, maxRequestIdValue);
    if (bodyObject.mediaId !== undefined && mediaId === undefined) {
      return {
        error: {
          status: 400,
          message: 'mediaId must be a positive integer.',
        },
      };
    }
    if (options.requireCreateIdentity && mediaId === undefined) {
      return {
        error: {
          status: 400,
          message: 'mediaId is required for movie and series requests.',
        },
      };
    }
    if (bodyObject.tvdbId !== undefined) {
      const tvdbId = parsePositiveRouteId(bodyObject.tvdbId, maxRequestIdValue);
      if (tvdbId === undefined) {
        return {
          error: {
            status: 400,
            message: 'tvdbId must be a positive integer.',
          },
        };
      }
      bodyObject.tvdbId = tvdbId;
    }
    if (mediaId !== undefined) {
      bodyObject.mediaId = mediaId;
    }
  }

  const serverId = parseOptionalRequestOptionId(
    bodyObject.serverId,
    'serverId',
    true
  );
  if ('error' in serverId) {
    return serverId;
  }

  const profileId = parseOptionalRequestOptionId(
    bodyObject.profileId,
    'profileId',
    true
  );
  if ('error' in profileId) {
    return profileId;
  }

  const languageProfileId = parseOptionalRequestOptionId(
    bodyObject.languageProfileId,
    'languageProfileId',
    true
  );
  if ('error' in languageProfileId) {
    return languageProfileId;
  }

  const metadataProfileId = parseOptionalRequestOptionId(
    bodyObject.metadataProfileId,
    'metadataProfileId',
    true
  );
  if ('error' in metadataProfileId) {
    return metadataProfileId;
  }

  const userId = parseOptionalRequestOptionId(bodyObject.userId, 'userId');
  if ('error' in userId) {
    return userId;
  }

  const rootFolder = parseOptionalRequestString(
    bodyObject.rootFolder,
    'rootFolder',
    maxRequestRootFolderLength
  );
  if ('error' in rootFolder) {
    return rootFolder;
  }

  const profileName = parseOptionalRequestString(
    bodyObject.profileName,
    'profileName',
    maxRequestProfileNameLength
  );
  if ('error' in profileName) {
    return profileName;
  }

  const format = parseOptionalBookFormat(bodyObject.format);
  if ('error' in format) {
    return format;
  }

  const tags = parseOptionalRequestTags(bodyObject.tags);
  if ('error' in tags) {
    return tags;
  }

  const seasons = parseOptionalRequestSeasons(bodyObject.seasons);
  if ('error' in seasons) {
    return seasons;
  }
  if (
    options.requireCreateIdentity &&
    mediaType === MediaType.TV &&
    (seasons.value === undefined ||
      (Array.isArray(seasons.value) && seasons.value.length === 0))
  ) {
    return {
      error: {
        status: 400,
        message: 'seasons are required for series requests.',
      },
    };
  }

  const value = {
    ...body,
    is4k: bodyObject.is4k ?? false,
    serverId: serverId.value,
    profileId: profileId.value,
    profileName: profileName.value,
    rootFolder: rootFolder.value,
    languageProfileId: languageProfileId.value,
    metadataProfileId: metadataProfileId.value,
    format: format.value,
    userId: userId.value,
    tags: tags.value,
    seasons: seasons.value,
  } as MediaRequestBody;

  return {
    value,
  };
};

const sanitizeBulkMediaRequestBody = (
  body: BulkMediaRequestBody
): RequestOptionValidationResult<BulkMediaRequestBody> => {
  const sanitized = sanitizeMediaRequestBody({
    ...body,
    mediaId: 'bulk-placeholder',
  } as MediaRequestBody);

  if ('error' in sanitized) {
    return sanitized;
  }

  const sanitizedItems: BulkMediaRequestBody['items'] = [];
  const seenItems = new Set<string>();

  for (const item of body.items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return {
        error: {
          status: 400,
          message: 'items must contain request objects.',
        },
      };
    }

    const mediaId =
      typeof item.mediaId === 'string' ? item.mediaId.trim() : item.mediaId;
    if (typeof mediaId !== 'string') {
      return {
        error: { status: 400, message: 'mediaId must be a string.' },
      };
    }
    if (!mediaId) {
      return {
        error: { status: 400, message: 'mediaId is required.' },
      };
    }
    if (mediaId.length > maxBulkRequestItemTextLength) {
      return {
        error: {
          status: 400,
          message: `mediaId must be ${maxBulkRequestItemTextLength} characters or fewer.`,
        },
      };
    }
    if (
      body.mediaType === MediaType.MUSIC &&
      !isValidMusicBrainzResourceId(normalizeMusicBrainzId(mediaId))
    ) {
      return {
        error: {
          status: 400,
          message: 'mediaId must be a valid MusicBrainz resource ID.',
        },
      };
    }
    if (
      body.mediaType === MediaType.BOOK &&
      !isValidOpenLibraryResourceId(normalizeOpenLibraryWorkId(mediaId))
    ) {
      return {
        error: {
          status: 400,
          message: 'mediaId must be a valid Open Library resource ID.',
        },
      };
    }

    const title = parseOptionalRequestString(
      item.title,
      'title',
      maxBulkRequestItemTextLength
    );
    if ('error' in title) {
      return title;
    }

    const isbn13 = parseOptionalRequestString(
      item.isbn13,
      'isbn13',
      maxBulkRequestItemTextLength
    );
    if ('error' in isbn13) {
      return isbn13;
    }

    const editionId = parseOptionalRequestString(
      item.editionId,
      'editionId',
      maxBulkRequestItemTextLength
    );
    if ('error' in editionId) {
      return editionId;
    }

    const authorId = parseOptionalRequestString(
      item.authorId,
      'authorId',
      maxBulkRequestItemTextLength
    );
    if ('error' in authorId) {
      return authorId;
    }
    if (
      body.mediaType === MediaType.BOOK &&
      ((editionId.value !== undefined &&
        !isValidOpenLibraryResourceId(
          normalizeOpenLibraryEditionId(editionId.value)
        )) ||
        (authorId.value !== undefined &&
          !isValidOpenLibraryResourceId(
            normalizeOpenLibraryAuthorId(authorId.value)
          )))
    ) {
      return {
        error: {
          status: 400,
          message:
            'Book editionId and authorId must be valid Open Library resource IDs.',
        },
      };
    }

    const sanitizedItem = {
      mediaId,
      title: title.value,
      isbn13: isbn13.value,
      editionId: editionId.value,
      authorId: authorId.value,
    };
    const dedupeKey = getBulkRequestDedupeKey(body.mediaType, sanitizedItem);

    if (seenItems.has(dedupeKey)) {
      continue;
    }

    seenItems.add(dedupeKey);
    sanitizedItems.push(sanitizedItem);
  }

  return {
    value: {
      ...body,
      items: sanitizedItems,
      format: sanitized.value.format,
      serverId: sanitized.value.serverId,
      profileId: sanitized.value.profileId,
      profileName: sanitized.value.profileName,
      rootFolder: sanitized.value.rootFolder,
      metadataProfileId: sanitized.value.metadataProfileId,
      userId: sanitized.value.userId,
      tags: sanitized.value.tags,
    },
  };
};

const validateExternalServiceConfiguration = (
  requestType: MediaType,
  serverId?: number | null,
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null,
  is4k = false
) => {
  const settings = getExternalRuntimeConfig();

  if (requestType === MediaType.MOVIE || requestType === MediaType.TV) {
    if (serverId === undefined || serverId === null) {
      return;
    }
    const selectedServer =
      requestType === MediaType.MOVIE
        ? settings.radarr.find(({ id }) => id === serverId)
        : settings.sonarr.find(({ id }) => id === serverId);
    if (!selectedServer) {
      throw new ServiceConfigurationError(
        `The selected ${
          requestType === MediaType.MOVIE ? 'Radarr' : 'Sonarr'
        } server no longer exists.`
      );
    }
    if (selectedServer.is4k !== is4k) {
      throw new ServiceConfigurationError(
        `The selected ${
          requestType === MediaType.MOVIE ? 'Radarr' : 'Sonarr'
        } server does not match the requested quality tier.`
      );
    }
    return;
  }

  if (requestType === MediaType.MUSIC) {
    if (serverId === undefined || serverId === null) {
      if (!settings.lidarr.some((lidarr) => lidarr.isDefault)) {
        throw new ServiceConfigurationError(
          'No default Lidarr server is configured for music requests.'
        );
      }

      return;
    }

    if (!settings.lidarr.some((lidarr) => lidarr.id === serverId)) {
      throw new ServiceConfigurationError(
        'The selected Lidarr server no longer exists.'
      );
    }
  }

  if (requestType === MediaType.BOOK) {
    const requestedFormat = bookFormat ?? 'ebook';

    if (serverId === undefined || serverId === null) {
      const hasDefaultEbook = settings.readarr.some(
        (readarr) =>
          readarr.isDefault && (readarr.serviceType ?? 'ebook') === 'ebook'
      );
      const hasDefaultAudiobook = settings.readarr.some(
        (readarr) => readarr.isDefault && readarr.serviceType === 'audiobook'
      );

      if (requestedFormat === 'both') {
        if (!hasDefaultEbook || !hasDefaultAudiobook) {
          throw new ServiceConfigurationError(
            'Both-format book requests require default ebook and audiobook Bookshelf services.'
          );
        }

        return;
      }

      if (
        (requestedFormat === 'ebook' && !hasDefaultEbook) ||
        (requestedFormat === 'audiobook' && !hasDefaultAudiobook)
      ) {
        throw new ServiceConfigurationError(
          `No default ${requestedFormat} Bookshelf server is configured for book requests.`
        );
      }

      return;
    }

    const selectedReadarr = settings.readarr.find(
      (readarr) => readarr.id === serverId
    );

    if (!selectedReadarr) {
      throw new ServiceConfigurationError(
        'The selected Bookshelf server no longer exists.'
      );
    }

    if (requestedFormat === 'both') {
      if ((selectedReadarr.serviceType ?? 'ebook') !== 'ebook') {
        throw new ServiceConfigurationError(
          'The selected Bookshelf server is configured for audiobook requests, not ebook requests.'
        );
      }
      if (
        !settings.readarr.some(
          (readarr) => readarr.isDefault && readarr.serviceType === 'audiobook'
        )
      ) {
        throw new ServiceConfigurationError(
          'Both-format book requests require a default audiobook Bookshelf service.'
        );
      }
      return;
    }

    const selectedReadarrServiceType = selectedReadarr.serviceType ?? 'ebook';

    if (selectedReadarrServiceType !== requestedFormat) {
      throw new ServiceConfigurationError(
        `The selected Bookshelf server is configured for ${selectedReadarrServiceType} requests, not ${requestedFormat} requests.`
      );
    }
  }
};

const hasBookFormat = (
  media: Media,
  format: 'ebook' | 'audiobook'
): boolean => {
  const serviceId =
    format === 'audiobook'
      ? media.audiobookExternalServiceId
      : media.externalServiceId;

  return serviceId !== null && serviceId !== undefined;
};

const inactiveMediaRequestStatuses = [
  MediaRequestStatus.DECLINED,
  MediaRequestStatus.FAILED,
  MediaRequestStatus.COMPLETED,
] as const;

const hasActiveOverlappingBookRequest = async (
  mediaId: number,
  format: 'ebook' | 'audiobook' | 'both' = 'ebook'
): Promise<boolean> => {
  let query = getRepository(MediaRequest)
    .createQueryBuilder('request')
    .where('request.media = :mediaId', { mediaId })
    .andWhere('request.status NOT IN (:...inactiveStatuses)', {
      inactiveStatuses: inactiveMediaRequestStatuses,
    });
  if (format === 'ebook') {
    query = query.andWhere(
      `COALESCE(request.bookFormat, 'ebook') IN ('ebook', 'both')`
    );
  } else if (format === 'audiobook') {
    query = query.andWhere(`request.bookFormat IN ('audiobook', 'both')`);
  }

  return query.getExists();
};

const getBulkCoveredReason = async (
  mediaType: MediaType.MUSIC | MediaType.BOOK,
  mediaId: string,
  format?: 'ebook' | 'audiobook' | 'both'
): Promise<string | undefined> => {
  if (mediaType === MediaType.MUSIC) {
    const normalizedMediaId = normalizeMusicBrainzId(mediaId);
    const media = await getRepository(Media).findOne({
      where: { mbId: normalizedMediaId, mediaType: MediaType.MUSIC },
    });

    if (media?.status === MediaStatus.BLOCKLISTED) {
      return 'This album is blocklisted.';
    }

    if (media?.status === MediaStatus.AVAILABLE) {
      return 'This album is already available.';
    }

    const hasActiveRequest = media
      ? await getRepository(MediaRequest)
          .createQueryBuilder('request')
          .where('request.media = :mediaId', { mediaId: media.id })
          .andWhere('request.status NOT IN (:...inactiveStatuses)', {
            inactiveStatuses: inactiveMediaRequestStatuses,
          })
          .getExists()
      : false;
    if (hasActiveRequest) {
      return 'Request for this album already exists.';
    }

    return undefined;
  }

  const normalizedOpenLibraryId = normalizeOpenLibraryWorkId(mediaId);
  const identifier = await getRepository(MediaIdentifier).findOne({
    where: {
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: normalizedOpenLibraryId,
    },
    relations: { media: true },
    relationLoadStrategy: 'query',
  });
  const media = identifier?.media;

  if (!media || media.mediaType !== MediaType.BOOK) {
    return undefined;
  }

  if (media.status === MediaStatus.BLOCKLISTED) {
    return 'This book is blocklisted.';
  }

  const requestedFormat = format ?? 'ebook';
  const ebookAvailable = hasBookFormat(media, 'ebook');
  const audiobookAvailable = hasBookFormat(media, 'audiobook');

  if (requestedFormat === 'ebook' && ebookAvailable) {
    return 'This ebook is already available.';
  }

  if (requestedFormat === 'audiobook' && audiobookAvailable) {
    return 'This audiobook is already available.';
  }

  if (requestedFormat === 'both' && (ebookAvailable || audiobookAvailable)) {
    return 'One or more requested book formats are already available.';
  }

  if (await hasActiveOverlappingBookRequest(media.id, requestedFormat)) {
    return 'Request for this book already exists.';
  }

  return undefined;
};

requestRoutes.get<
  Record<string, unknown>,
  RequestResultsResponse | { status: number; message: string }
>('/', async (req, res, next) => {
  let requestReadLease: AuthorizedUserSecurityMutationLease | undefined;
  try {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 10,
      maxTake: 100,
    });
    const requestedBy = parseOptionalPositiveInt(req.query.requestedBy) ?? null;
    const parsedMediaType = parseOptionalAllowedString(req.query.mediaType, {
      fieldName: 'Media type',
      allowedValues: requestMediaTypeFilters,
      maxLength: 16,
    });
    if ('error' in parsedMediaType) {
      return next({ status: 400, message: parsedMediaType.error });
    }
    const mediaType = parsedMediaType.value ?? 'all';

    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: requestStatusFilters,
      maxLength: 32,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }
    const filter = parsedFilter.value;

    const parsedSort = parseOptionalAllowedString(req.query.sort, {
      fieldName: 'Sort',
      allowedValues: requestSortFields,
      maxLength: 32,
    });
    if ('error' in parsedSort) {
      return next({ status: 400, message: parsedSort.error });
    }
    const sort = parsedSort.value;

    const parsedSortDirection = parseOptionalAllowedString(
      req.query.sortDirection,
      {
        fieldName: 'Sort direction',
        allowedValues: requestSortDirections,
        maxLength: 8,
      }
    );
    if ('error' in parsedSortDirection) {
      return next({ status: 400, message: parsedSortDirection.error });
    }
    const sortDirectionParam = parsedSortDirection.value;

    let statusFilter: MediaRequestStatus[];

    switch (filter) {
      case 'approved':
      case 'processing':
        statusFilter = [MediaRequestStatus.APPROVED];
        break;
      case 'pending':
        statusFilter = [MediaRequestStatus.PENDING];
        break;
      case 'unavailable':
        statusFilter = [
          MediaRequestStatus.PENDING,
          MediaRequestStatus.APPROVED,
        ];
        break;
      case 'failed':
        statusFilter = [MediaRequestStatus.FAILED];
        break;
      case 'completed':
      case 'available':
      case 'deleted':
        statusFilter = [MediaRequestStatus.COMPLETED];
        break;
      default:
        statusFilter = [
          MediaRequestStatus.PENDING,
          MediaRequestStatus.APPROVED,
          MediaRequestStatus.DECLINED,
          MediaRequestStatus.FAILED,
          MediaRequestStatus.COMPLETED,
        ];
    }

    let mediaStatusFilter: MediaStatus[];

    switch (filter) {
      case 'available':
        mediaStatusFilter = [MediaStatus.AVAILABLE];
        break;
      case 'processing':
      case 'unavailable':
        mediaStatusFilter = [
          MediaStatus.UNKNOWN,
          MediaStatus.PENDING,
          MediaStatus.PROCESSING,
          MediaStatus.PARTIALLY_AVAILABLE,
        ];
        break;
      case 'deleted':
        mediaStatusFilter = [MediaStatus.DELETED];
        break;
      default:
        mediaStatusFilter = [
          MediaStatus.UNKNOWN,
          MediaStatus.PENDING,
          MediaStatus.PROCESSING,
          MediaStatus.PARTIALLY_AVAILABLE,
          MediaStatus.AVAILABLE,
          MediaStatus.DELETED,
        ];
    }

    let sortFilter: string;
    let sortDirection: 'ASC' | 'DESC';

    switch (sort) {
      case 'modified':
        sortFilter = 'request.updatedAt';
        break;
      default:
        sortFilter = 'request.id';
    }

    switch (sortDirectionParam) {
      case 'asc':
        sortDirection = 'ASC';
        break;
      default:
        sortDirection = 'DESC';
    }

    if (
      req.user?.hasPermission(
        [
          Permission.MANAGE_REQUESTS,
          Permission.REQUEST_VIEW,
          Permission.REQUEST_ADVANCED,
        ],
        { type: 'or' }
      )
    ) {
      try {
        requestReadLease = await acquireAuthorizedUserSecurityMutation(
          req.user.id,
          req.user.id,
          [
            Permission.MANAGE_REQUESTS,
            Permission.REQUEST_VIEW,
            Permission.REQUEST_ADVANCED,
          ],
          {
            expectedCredentialVersion: getExpectedCredentialVersion(req),
          }
        );
        req.user = requestReadLease.actor;
      } catch (error) {
        if (!(error instanceof UserMutationActorUnauthorizedError)) {
          throw error;
        }
      }
    }

    const canViewAllRequests =
      requestReadLease?.actor.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      ) ?? false;

    let query = getRepository(MediaRequest)
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.media', 'media')
      .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
      .leftJoinAndSelect('request.requestedBy', 'requestedBy')
      .where('request.status IN (:...requestStatus)', {
        requestStatus: statusFilter,
      })
      .andWhere(
        '((request.is4k = false AND media.status IN (:...mediaStatus)) OR (request.is4k = true AND media.status4k IN (:...mediaStatus)))',
        {
          mediaStatus: mediaStatusFilter,
        }
      );

    if (!canViewAllRequests) {
      if (requestedBy && requestedBy !== req.user?.id) {
        return next({
          status: 403,
          message: "You do not have permission to view this user's requests.",
        });
      }

      query = query.andWhere('requestedBy.id = :id', {
        id: req.user?.id,
      });
    } else if (requestedBy) {
      query = query.andWhere('requestedBy.id = :id', {
        id: requestedBy,
      });
    }

    switch (mediaType) {
      case 'all':
        break;
      case 'movie':
        query = query.andWhere('request.type = :type', {
          type: MediaType.MOVIE,
        });
        break;
      case 'tv':
        query = query.andWhere('request.type = :type', {
          type: MediaType.TV,
        });
        break;
      case 'music':
        query = query.andWhere('request.type = :type', {
          type: MediaType.MUSIC,
        });
        break;
      case 'book':
        query = query.andWhere('request.type = :type', {
          type: MediaType.BOOK,
        });
        break;
    }

    const [requestRows, requestCount] = await query
      .orderBy(sortFilter, sortDirection)
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();
    const requests = await hydrateMediaRequestRelations(requestRows, {
      includeMediaIdentifiers: true,
    });

    const canHydrateServiceProfiles =
      requestReadLease?.actor.hasPermission(
        [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
        { type: 'or' }
      ) ?? false;

    const settings = getExternalRuntimeConfig();
    const sonarrSettings = canHydrateServiceProfiles ? settings.sonarr : [];
    const radarrSettings = canHydrateServiceProfiles ? settings.radarr : [];
    const lidarrSettings = canHydrateServiceProfiles ? settings.lidarr : [];
    const readarrSettings = canHydrateServiceProfiles ? settings.readarr : [];
    const referencedProfileServiceIds = new Map<MediaType, Set<number>>();
    for (const item of requests) {
      if (
        !Number.isSafeInteger(item.serverId) ||
        !Number.isSafeInteger(item.profileId)
      ) {
        continue;
      }
      const serviceIds =
        referencedProfileServiceIds.get(item.type) ?? new Set<number>();
      serviceIds.add(item.serverId as number);
      referencedProfileServiceIds.set(item.type, serviceIds);
    }

    // Profile names are display-only. Do not fan out to configured services
    // that are not referenced by this result page.
    const sonarrServers = await mapWithConcurrency(
      sonarrSettings
        .filter((service) =>
          referencedProfileServiceIds.get(MediaType.TV)?.has(service.id)
        )
        .slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      REQUEST_SERVICE_PROFILE_CONCURRENCY,
      async (sonarrSetting) => {
        try {
          return {
            id: sonarrSetting.id,
            profiles: await runWithCurrentServarrService(
              'sonarr',
              sonarrSetting.id,
              async (current) =>
                new SonarrAPI({
                  apiKey: current.apiKey,
                  url: SonarrAPI.buildUrl(current, '/api/v3'),
                }).getProfiles()
            ).catch((error) => {
              logRequestServiceProfileFailure(
                'sonarr',
                sonarrSetting.id,
                sonarrSetting.name,
                error
              );
              return undefined;
            }),
          };
        } catch (error) {
          logRequestServiceProfileFailure(
            'sonarr',
            sonarrSetting.id,
            sonarrSetting.name,
            error
          );

          return { id: sonarrSetting.id, profiles: undefined };
        }
      }
    );

    const radarrServers = await mapWithConcurrency(
      radarrSettings
        .filter((service) =>
          referencedProfileServiceIds.get(MediaType.MOVIE)?.has(service.id)
        )
        .slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      REQUEST_SERVICE_PROFILE_CONCURRENCY,
      async (radarrSetting) => {
        try {
          return {
            id: radarrSetting.id,
            profiles: await runWithCurrentServarrService(
              'radarr',
              radarrSetting.id,
              async (current) =>
                new RadarrAPI({
                  apiKey: current.apiKey,
                  url: RadarrAPI.buildUrl(current, '/api/v3'),
                }).getProfiles()
            ).catch((error) => {
              logRequestServiceProfileFailure(
                'radarr',
                radarrSetting.id,
                radarrSetting.name,
                error
              );

              return undefined;
            }),
          };
        } catch (error) {
          logRequestServiceProfileFailure(
            'radarr',
            radarrSetting.id,
            radarrSetting.name,
            error
          );

          return { id: radarrSetting.id, profiles: undefined };
        }
      }
    );

    const lidarrServers = await mapWithConcurrency(
      lidarrSettings
        .filter((service) =>
          referencedProfileServiceIds.get(MediaType.MUSIC)?.has(service.id)
        )
        .slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      REQUEST_SERVICE_PROFILE_CONCURRENCY,
      async (lidarrSetting) => {
        try {
          return {
            id: lidarrSetting.id,
            profiles: await runWithCurrentServarrService(
              'lidarr',
              lidarrSetting.id,
              async (current) =>
                new LidarrAPI({
                  apiKey: current.apiKey,
                  url: LidarrAPI.buildUrl(current, '/api/v1'),
                }).getProfiles()
            ).catch((error) => {
              logRequestServiceProfileFailure(
                'lidarr',
                lidarrSetting.id,
                lidarrSetting.name,
                error
              );

              return undefined;
            }),
          };
        } catch (error) {
          logRequestServiceProfileFailure(
            'lidarr',
            lidarrSetting.id,
            lidarrSetting.name,
            error
          );

          return { id: lidarrSetting.id, profiles: undefined };
        }
      }
    );

    const readarrServers = await mapWithConcurrency(
      readarrSettings
        .filter((service) =>
          referencedProfileServiceIds.get(MediaType.BOOK)?.has(service.id)
        )
        .slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      REQUEST_SERVICE_PROFILE_CONCURRENCY,
      async (readarrSetting) => {
        try {
          return {
            id: readarrSetting.id,
            profiles: await runWithCurrentServarrService(
              'readarr',
              readarrSetting.id,
              async (current) =>
                new ReadarrAPI({
                  apiKey: current.apiKey,
                  url: ReadarrAPI.buildUrl(current, '/api/v1'),
                  mediaType: current.serviceType ?? 'ebook',
                }).getProfiles()
            ).catch((error) => {
              logRequestServiceProfileFailure(
                'readarr',
                readarrSetting.id,
                readarrSetting.name,
                error
              );

              return undefined;
            }),
          };
        } catch (error) {
          logRequestServiceProfileFailure(
            'readarr',
            readarrSetting.id,
            readarrSetting.name,
            error
          );

          return { id: readarrSetting.id, profiles: undefined };
        }
      }
    );

    // add profile names to the media requests, with undefined if not found
    let mappedRequests = requests.map((r) => {
      switch (r.type) {
        case MediaType.MOVIE: {
          const profileName = radarrServers
            .find((serverr) => serverr.id === r.serverId)
            ?.profiles?.find((profile) => profile.id === r.profileId)?.name;

          return {
            ...r,
            profileName,
          };
        }
        case MediaType.TV: {
          return {
            ...r,
            profileName: sonarrServers
              .find((serverr) => serverr.id === r.serverId)
              ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
          };
        }
        case MediaType.MUSIC: {
          return {
            ...r,
            profileName: lidarrServers
              .find((serverr) => serverr.id === r.serverId)
              ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
          };
        }
        case MediaType.BOOK: {
          return {
            ...r,
            profileName: readarrServers
              .find((serverr) => serverr.id === r.serverId)
              ?.profiles?.find((profile) => profile.id === r.profileId)?.name,
          };
        }
        default: {
          return {
            ...r,
            profileName: undefined,
          };
        }
      }
    });

    // add canRemove prop if user has permission
    if (requestReadLease?.actor.hasPermission(Permission.MANAGE_REQUESTS)) {
      mappedRequests = mappedRequests.map((r) => {
        switch (r.type) {
          case MediaType.MOVIE: {
            return {
              ...r,
              // check if the radarr server for this request is configured
              canRemove: radarrSettings.some(
                (server) =>
                  server.id ===
                  (r.is4k ? r.media.serviceId4k : r.media.serviceId)
              ),
            };
          }
          case MediaType.TV: {
            return {
              ...r,
              // check if the sonarr server for this request is configured
              canRemove: sonarrSettings.some(
                (server) =>
                  server.id ===
                  (r.is4k ? r.media.serviceId4k : r.media.serviceId)
              ),
            };
          }
          case MediaType.MUSIC: {
            return {
              ...r,
              canRemove: lidarrSettings.some(
                (server) => server.id === r.media.serviceId
              ),
            };
          }
          case MediaType.BOOK: {
            const hasEbookLink =
              r.media.serviceId !== null &&
              r.media.serviceId !== undefined &&
              r.media.externalServiceId !== null &&
              r.media.externalServiceId !== undefined;
            const hasAudiobookLink =
              r.media.audiobookServiceId !== null &&
              r.media.audiobookServiceId !== undefined &&
              r.media.audiobookExternalServiceId !== null &&
              r.media.audiobookExternalServiceId !== undefined;
            const canRemoveEbook =
              hasEbookLink &&
              readarrSettings.some((server) => server.id === r.media.serviceId);
            const canRemoveAudiobook =
              hasAudiobookLink &&
              readarrSettings.some(
                (server) => server.id === r.media.audiobookServiceId
              );

            return {
              ...r,
              canRemove:
                r.bookFormat === 'audiobook'
                  ? canRemoveAudiobook
                  : r.bookFormat === 'both'
                    ? (hasEbookLink || hasAudiobookLink) &&
                      (!hasEbookLink || canRemoveEbook) &&
                      (!hasAudiobookLink || canRemoveAudiobook)
                    : canRemoveEbook,
            };
          }
          default: {
            return {
              ...r,
              canRemove: false,
            };
          }
        }
      });
    }

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(requestCount / pageSize),
        pageSize,
        results: requestCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: filterEntityResponse(mappedRequests, req.user),
      serviceErrors: {
        radarr: radarrServers
          .filter((s) => !s.profiles)
          .map((s) => ({
            id: s.id,
            name:
              settings.radarr.find((r) => r.id === s.id)?.name ||
              `Radarr ${s.id}`,
          })),
        sonarr: sonarrServers
          .filter((s) => !s.profiles)
          .map((s) => ({
            id: s.id,
            name:
              settings.sonarr.find((r) => r.id === s.id)?.name ||
              `Sonarr ${s.id}`,
          })),
        lidarr: lidarrServers
          .filter((s) => !s.profiles)
          .map((s) => ({
            id: s.id,
            name:
              settings.lidarr.find((r) => r.id === s.id)?.name ||
              `Lidarr ${s.id}`,
          })),
        readarr: readarrServers
          .filter((s) => !s.profiles)
          .map((s) => ({
            id: s.id,
            name:
              settings.readarr.find((r) => r.id === s.id)?.name ||
              `Bookshelf ${s.id}`,
          })),
      },
    });
  } catch (e) {
    if (e instanceof ServiceConfigurationError) {
      return next({ status: 400, message: e.message });
    }

    logger.error('Failed to retrieve request list', {
      label: 'Request',
      ...getErrorLogFields(e),
      requestQuery: req.query,
    });

    next({
      status: 500,
      message: e instanceof Error ? e.message : 'Unable to retrieve requests.',
    });
  } finally {
    await requestReadLease?.release();
  }
});

requestRoutes.post<never, MediaRequest, MediaRequestBody>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to request media.',
        });
      }
      const body = sanitizeMediaRequestBody(req.body, {
        requireCreateIdentity: true,
      });
      if ('error' in body) {
        logRequestValidationFailure(
          'create',
          body.error,
          req.body,
          req.user.id
        );
        return next(body.error);
      }

      const request = await MediaRequest.request(body.value, req.user, {
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      });

      return res.status(201).json(filterEntityResponse(request, req.user));
    } catch (error) {
      if (!(error instanceof Error)) {
        logger.error('Failed to submit media request', {
          label: 'Request',
          ...getErrorLogFields(error),
          requestBody: getRequestLogBody(req.body),
          userId: req.user?.id,
        });
        return next({ status: 500, message: 'Unable to submit request.' });
      }

      switch (error.constructor) {
        case UserMutationActorUnauthorizedError:
        case RequestPermissionError:
        case QuotaRestrictedError:
          return next({ status: 403, message: error.message });
        case DuplicateMediaRequestError:
          return next({ status: 409, message: error.message });
        case ServiceConfigurationError:
          return next({ status: 400, message: error.message });
        case NoSeasonsAvailableError:
          return next({ status: 202, message: error.message });
        case BlocklistedMediaError:
          return next({ status: 403, message: error.message });
        default:
          logger.error('Failed to submit media request', {
            label: 'Request',
            ...getErrorLogFields(error),
            requestBody: getRequestLogBody(req.body),
            userId: req.user?.id,
          });
          return next({ status: 500, message: 'Unable to submit request.' });
      }
    }
  }
);

requestRoutes.post<never, BulkMediaRequestResponse, BulkMediaRequestBody>(
  '/bulk',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to request media.',
        });
      }

      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body)
      ) {
        return next({
          status: 400,
          message: 'Request body must be an object.',
        });
      }

      if (
        req.body.mediaType !== MediaType.MUSIC &&
        req.body.mediaType !== MediaType.BOOK
      ) {
        return next({
          status: 400,
          message: 'Bulk requests only support music and books.',
        });
      }

      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return next({
          status: 400,
          message: 'At least one item is required.',
        });
      }

      if (req.body.items.length > maxBulkRequestItems) {
        return next({
          status: 400,
          message: `Bulk requests are limited to ${maxBulkRequestItems} items.`,
        });
      }

      const sanitizedBody = sanitizeBulkMediaRequestBody(req.body);
      if ('error' in sanitizedBody) {
        logRequestValidationFailure(
          'bulk-create',
          sanitizedBody.error,
          req.body,
          req.user.id
        );
        return next(sanitizedBody.error);
      }
      const body = sanitizedBody.value;

      logger.info('Bulk request received', {
        label: 'Request',
        requestBody: getBulkRequestLogBody(body),
        userId: req.user.id,
      });

      let requestUser = req.user;

      if (body.userId) {
        if (
          !req.user.hasPermission([
            Permission.MANAGE_USERS,
            Permission.MANAGE_REQUESTS,
          ])
        ) {
          return next({
            status: 403,
            message: 'You do not have permission to modify the request user.',
          });
        }

        requestUser = await getRepository(User).findOneOrFail({
          where: { id: body.userId },
        });
      }

      const created: MediaRequest[] = [];
      const skipped: BulkMediaRequestResponse['skipped'] = [];
      const failed: BulkMediaRequestResponse['failed'] = [];
      const requestableItems: BulkMediaRequestBody['items'] = [];

      for (const item of body.items) {
        if (!item.mediaId) {
          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: 'Missing media ID.',
          });
          continue;
        }

        try {
          const coveredReason = await getBulkCoveredReason(
            body.mediaType,
            item.mediaId,
            body.format
          );

          if (coveredReason) {
            skipped.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: coveredReason,
            });
            continue;
          }

          requestableItems.push(item);
        } catch (error) {
          if (!(error instanceof Error)) {
            failed.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: 'Unknown error.',
            });
            continue;
          }

          if (
            error instanceof DuplicateMediaRequestError ||
            error instanceof BlocklistedMediaError
          ) {
            skipped.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: error.message,
            });
            continue;
          }

          if (
            error instanceof UserMutationActorUnauthorizedError ||
            error instanceof RequestPermissionError ||
            error instanceof QuotaRestrictedError
          ) {
            return next({ status: 403, message: error.message });
          }

          if (error instanceof ServiceConfigurationError) {
            return next({ status: 400, message: error.message });
          }

          logger.error('Failed to evaluate bulk request item', {
            label: 'Request',
            ...getErrorLogFields(error),
            mediaType: body.mediaType,
            userId: req.user.id,
          });
          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: 'Unable to process item.',
          });
        }
      }

      const quotas = await requestUser.getQuota();
      const quota =
        body.mediaType === MediaType.MUSIC ? quotas.music : quotas.book;

      if (quota.limit && (quota.remaining ?? 0) < requestableItems.length) {
        return next({
          status: 403,
          message: `${body.mediaType === MediaType.MUSIC ? 'Music' : 'Book'} quota exceeded.`,
        });
      }

      for (const item of requestableItems) {
        try {
          const request = await MediaRequest.request(
            {
              mediaType: body.mediaType,
              mediaId: item.mediaId,
              format: body.format,
              isbn13: item.isbn13,
              editionId: item.editionId,
              authorId: item.authorId,
              serverId: body.serverId,
              profileId: body.profileId,
              profileName: body.profileName,
              rootFolder: body.rootFolder,
              metadataProfileId: body.metadataProfileId,
              userId: body.userId,
              tags: body.tags,
            },
            req.user,
            {
              expectedCredentialVersion: getExpectedCredentialVersion(req),
            }
          );

          created.push(request);
        } catch (error) {
          if (!(error instanceof Error)) {
            failed.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: 'Unknown error.',
            });
            continue;
          }

          if (
            error instanceof DuplicateMediaRequestError ||
            error instanceof BlocklistedMediaError
          ) {
            skipped.push({
              mediaId: item.mediaId,
              title: item.title,
              reason: error.message,
            });
            continue;
          }

          if (
            error instanceof UserMutationActorUnauthorizedError ||
            error instanceof RequestPermissionError ||
            error instanceof QuotaRestrictedError
          ) {
            return next({ status: 403, message: error.message });
          }

          if (error instanceof ServiceConfigurationError) {
            return next({ status: 400, message: error.message });
          }

          logger.error('Failed to submit bulk request item', {
            label: 'Request',
            ...getErrorLogFields(error),
            mediaType: body.mediaType,
            userId: req.user.id,
          });
          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: 'Unable to process item.',
          });
        }
      }

      logger.info('Bulk request completed', {
        label: 'Request',
        mediaType: body.mediaType,
        itemCount: body.items.length,
        requestableCount: requestableItems.length,
        createdCount: created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        createdRequestIds: created.slice(0, 50).map((request) => request.id),
        userId: req.user.id,
      });

      return res.status(207).json({
        created: filterEntityResponse(created, req.user),
        skipped,
        failed,
      });
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      logger.error('Failed to submit bulk media request', {
        label: 'Request',
        ...getErrorLogFields(error),
        userId: req.user?.id,
      });
      return next({ status: 500, message: 'Unable to submit bulk request.' });
    }
  }
);

requestRoutes.get('/count', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    return await runUserSecurityMutation(req.user!.id, async () => {
      const actor = await getRepository(User).findOneBy({ id: req.user!.id });
      if (
        !actor ||
        !isUserCredentialVersionCurrent(
          actor,
          getExpectedCredentialVersion(req)
        )
      ) {
        throw new UserMutationActorUnauthorizedError();
      }

      const countQuery = requestRepository
        .createQueryBuilder('request')
        .innerJoin('request.media', 'media')
        .innerJoin('request.requestedBy', 'requestedBy')
        .select('COUNT(*)', 'total')
        .addSelect(
          'SUM(CASE WHEN request.type = :movie THEN 1 ELSE 0 END)',
          'movie'
        )
        .addSelect('SUM(CASE WHEN request.type = :tv THEN 1 ELSE 0 END)', 'tv')
        .addSelect(
          'SUM(CASE WHEN request.type = :music THEN 1 ELSE 0 END)',
          'music'
        )
        .addSelect(
          'SUM(CASE WHEN request.type = :book THEN 1 ELSE 0 END)',
          'book'
        )
        .addSelect(
          'SUM(CASE WHEN request.status = :pending THEN 1 ELSE 0 END)',
          'pending'
        )
        .addSelect(
          'SUM(CASE WHEN request.status = :approved THEN 1 ELSE 0 END)',
          'approved'
        )
        .addSelect(
          'SUM(CASE WHEN request.status = :declined THEN 1 ELSE 0 END)',
          'declined'
        )
        .addSelect(
          'SUM(CASE WHEN request.status = :failed THEN 1 ELSE 0 END)',
          'failed'
        )
        .addSelect(
          'SUM(CASE WHEN request.status = :completed THEN 1 ELSE 0 END)',
          'completed'
        )
        .addSelect(
          `SUM(CASE WHEN request.status = :approved AND (
          (request.type = :book AND (
            (COALESCE(request.bookFormat, 'ebook') = 'both'
              AND media.externalServiceId IS NOT NULL
              AND media.audiobookExternalServiceId IS NOT NULL)
            OR (request.bookFormat = 'audiobook'
              AND media.audiobookExternalServiceId IS NOT NULL)
            OR (COALESCE(request.bookFormat, 'ebook') = 'ebook'
              AND media.externalServiceId IS NOT NULL)
          ))
          OR (request.type != :book AND request.is4k = :is4k
            AND media.status4k = :available)
          OR (request.type != :book AND request.is4k = :not4k
            AND media.status = :available)
        ) THEN 1 ELSE 0 END)`,
          'available'
        )
        .setParameters({
          movie: MediaType.MOVIE,
          tv: MediaType.TV,
          music: MediaType.MUSIC,
          book: MediaType.BOOK,
          pending: MediaRequestStatus.PENDING,
          approved: MediaRequestStatus.APPROVED,
          declined: MediaRequestStatus.DECLINED,
          failed: MediaRequestStatus.FAILED,
          completed: MediaRequestStatus.COMPLETED,
          is4k: true,
          not4k: false,
          available: MediaStatus.AVAILABLE,
        });

      if (
        !actor.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        countQuery.andWhere('requestedBy.id = :visibleUserId', {
          visibleUserId: actor.id,
        });
      }

      const counts =
        await countQuery.getRawOne<Record<string, string | number | null>>();

      const count = (key: string): number => Number(counts?.[key] ?? 0);
      const availableCount = count('available');
      const processingCount = count('approved') - availableCount;

      return res.status(200).json({
        total: count('total'),
        movie: count('movie'),
        tv: count('tv'),
        music: count('music'),
        book: count('book'),
        pending: count('pending'),
        approved: count('approved'),
        declined: count('declined'),
        failed: count('failed'),
        processing: processingCount,
        available: availableCount,
        completed: count('completed'),
      });
    });
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.error('Something went wrong retrieving request counts', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Unable to retrieve request counts.' });
  }
});

requestRoutes.get<
  Record<string, unknown>,
  RequestStatusResultsResponse | { status: number; message: string }
>('/status', async (req, res, next) => {
  try {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 25,
      maxTake: 100,
    });
    const requestedBy = parseOptionalPositiveInt(req.query.requestedBy);
    const parsedMediaType = parseOptionalAllowedString(req.query.mediaType, {
      fieldName: 'Media type',
      allowedValues: requestMediaTypeFilters,
      maxLength: 16,
    });
    if ('error' in parsedMediaType) {
      return next({ status: 400, message: parsedMediaType.error });
    }
    const parsedBookFormat = parseOptionalAllowedString(req.query.bookFormat, {
      fieldName: 'Book format',
      allowedValues: requestStatusBookFormatFilters,
      maxLength: 16,
    });
    if ('error' in parsedBookFormat) {
      return next({ status: 400, message: parsedBookFormat.error });
    }
    const selectedMediaType = parsedMediaType.value ?? 'all';
    const mediaType =
      parsedBookFormat.value && selectedMediaType === 'all'
        ? 'book'
        : selectedMediaType;
    if (parsedBookFormat.value && mediaType !== 'book') {
      return next({
        status: 400,
        message: 'Book format filtering requires mediaType=book.',
      });
    }
    const parsedFilter = parseOptionalAllowedString(
      req.query.filter ?? req.query.status,
      {
        fieldName: 'Status filter',
        allowedValues: requestTimelineStatusFilters,
        maxLength: 32,
      }
    );
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }
    const parsedSort = parseOptionalAllowedString(req.query.sort, {
      fieldName: 'Sort field',
      allowedValues: REQUEST_STATUS_SORT_FIELDS,
      maxLength: 32,
    });
    if ('error' in parsedSort) {
      return next({ status: 400, message: parsedSort.error });
    }
    const parsedSortDirection = parseOptionalAllowedString(
      req.query.sortDirection,
      {
        fieldName: 'Sort direction',
        allowedValues: ['asc', 'desc'] as const,
        maxLength: 8,
      }
    );
    if ('error' in parsedSortDirection) {
      return next({ status: 400, message: parsedSortDirection.error });
    }
    const parsedTimeFrame = parseOptionalAllowedString(req.query.timeFrame, {
      fieldName: 'Time frame',
      allowedValues: requestStatusTimeFrames,
      maxLength: 8,
    });
    if ('error' in parsedTimeFrame) {
      return next({ status: 400, message: parsedTimeFrame.error });
    }
    const { field: sort, direction: sortDirection } = parseRequestStatusSort(
      parsedSort.value,
      parsedSortDirection.value
    );

    const actorId = req.user!.id;
    return await runUserSecurityReadWithActor(
      actorId,
      requestedBy ?? actorId,
      [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
      async (actor) => {
        const canViewAllRequests = actor.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        );
        const page = await getRequestStatusPage({
          take: pageSize,
          skip,
          ownerId: canViewAllRequests ? (requestedBy ?? undefined) : actor.id,
          mediaType: mediaType === 'all' ? undefined : (mediaType as MediaType),
          bookFormat: parsedBookFormat.value,
          since: getRequestStatusStartDate(parsedTimeFrame.value ?? '7d'),
          filter: parsedFilter.value,
          sort,
          sortDirection,
        });

        return res.status(200).json({
          ...page,
          results: page.results.map(({ request, status }) => ({
            request: filterEntityResponse(request, actor),
            status: protectRequestStatusDownloadId(status),
          })),
        });
      },
      {
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      }
    );
  } catch (error) {
    if (error instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.error('Something went wrong retrieving request status', {
      label: 'API',
      ...getErrorLogFields(error),
    });
    return next({ status: 500, message: 'Unable to retrieve request status.' });
  }
});

requestRoutes.get<
  Record<string, unknown>,
  RequestStatusUsersResponse | { status: number; message: string }
>('/status/users', async (req, res, next) => {
  try {
    if (!req.user) {
      return next({ status: 403, message: 'Access denied.' });
    }
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 100,
      maxTake: 100,
    });

    return await runUserSecurityReadWithActor(
      req.user!.id,
      req.user!.id,
      [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
      async () => {
        const [users, userCount] = await getRepository(User)
          .createQueryBuilder('user')
          .addSelect(
            `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
              CASE WHEN (user.plexUsername IS NULL OR user.plexUsername = '') THEN (
                CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                  "user"."email"
                ELSE
                  LOWER(user.jellyfinUsername)
                END)
              ELSE
                LOWER(user.plexUsername)
              END)
            ELSE
              LOWER(user.username)
            END`,
            'displayname_sort_key'
          )
          .orderBy('displayname_sort_key', 'ASC')
          .addOrderBy('user.id', 'ASC')
          .take(pageSize)
          .skip(skip)
          .getManyAndCount();

        return res.status(200).json({
          pageInfo: {
            pages: Math.ceil(userCount / pageSize),
            pageSize,
            results: userCount,
            page: Math.floor(skip / pageSize) + 1,
          },
          results: users.map((user) => ({
            id: user.id,
            displayName: user.displayName,
            avatar: user.avatar,
          })),
        });
      },
      {
        requirePermission: true,
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      }
    );
  } catch (error) {
    if (error instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.error('Something went wrong retrieving request status users', {
      label: 'API',
      ...getErrorLogFields(error),
    });
    return next({ status: 500, message: 'Unable to retrieve request users.' });
  }
});

requestRoutes.get<
  { requestId: string },
  RequestStatusDetailResponse | { status: number; message: string }
>('/status/:requestId', async (req, res, next) => {
  try {
    const requestId = parseRequestParamId(req.params.requestId);
    if (!requestId) {
      return next({ status: 404, message: 'Request not found.' });
    }

    const request = await getRepository(MediaRequest).findOne({
      where: { id: requestId },
      relations: {
        media: { identifiers: true, seasons: true },
        modifiedBy: true,
        requestedBy: true,
        seasons: true,
      },
    });
    if (!request) {
      return next({ status: 404, message: 'Request not found.' });
    }

    return await runUserSecurityReadWithActor(
      req.user!.id,
      request.requestedBy.id,
      [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
      async (actor) => {
        const canViewAllRequests = actor.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        );
        if (!canViewAllRequests && request.requestedBy.id !== actor.id) {
          return next({
            status: 403,
            message: 'You do not have permission to view this request.',
          });
        }

        const current = await recordRequestStatus(request.id);
        if (!current) {
          return next({ status: 404, message: 'Request not found.' });
        }
        const history = await getRequestStatusHistory(request.id);
        return res.status(200).json({
          request: filterEntityResponse(request, actor),
          current: protectRequestStatusDownloadId(current),
          history: {
            ...history,
            results: history.results.map(protectRequestStatusDownloadId),
          },
        });
      },
      {
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      }
    );
  } catch (error) {
    if (error instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.error('Something went wrong retrieving request status history', {
      label: 'API',
      ...getErrorLogFields(error),
    });
    return next({
      status: 500,
      message: 'Unable to retrieve request status history.',
    });
  }
});

requestRoutes.get('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const requestId = parseRequestParamId(req.params.requestId);
    if (!requestId) {
      return next({ status: 404, message: 'Request not found.' });
    }

    return await runUserSecurityMutation(req.user!.id, async () => {
      const actor = await getRepository(User).findOneBy({ id: req.user!.id });
      if (
        !actor ||
        !isUserCredentialVersionCurrent(
          actor,
          getExpectedCredentialVersion(req)
        )
      ) {
        throw new UserMutationActorUnauthorizedError();
      }
      const request = await requestRepository.findOneOrFail({
        where: { id: requestId },
        relations: {
          requestedBy: true,
          modifiedBy: true,
          media: { identifiers: true },
        },
      });

      if (
        request.requestedBy.id !== actor.id &&
        !actor.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this request.',
        });
      }

      return res.status(200).json(filterEntityResponse(request, req.user));
    });
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.debug('Failed to retrieve request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.put<{ requestId: string }>(
  '/:requestId',
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    try {
      const requestId = parseRequestParamId(req.params.requestId);
      if (!requestId) {
        return next({ status: 404, message: 'Request not found.' });
      }

      const sanitizedBody = sanitizeMediaRequestBody(req.body);
      if ('error' in sanitizedBody) {
        logRequestValidationFailure(
          'edit',
          sanitizedBody.error,
          req.body,
          req.user?.id
        );
        return next(sanitizedBody.error);
      }
      const body = sanitizedBody.value;
      const initialRequest = await requestRepository.findOne({
        where: { id: requestId },
        select: { id: true, status: true },
      });
      if (!initialRequest) {
        return next({ status: 404, message: 'Request not found.' });
      }
      if (initialRequest.status !== MediaRequestStatus.PENDING) {
        return next({
          status: 409,
          message: 'Only pending requests can be edited.',
        });
      }

      return await runUserSecurityMutationWithActor(
        req.user!.id,
        body.userId ?? req.user!.id,
        [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
        (actor) =>
          runWithRequestAdmission(
            [getRequestMutationAdmissionKey(requestId)],
            async () => {
              const request = await requestRepository.findOne({
                where: { id: requestId },
              });

              if (!request) {
                return next({ status: 404, message: 'Request not found.' });
              }

              if (request.status !== MediaRequestStatus.PENDING) {
                return next({
                  status: 409,
                  message: 'Only pending requests can be edited.',
                });
              }

              if (body.mediaType && body.mediaType !== request.type) {
                return next({
                  status: 400,
                  message: 'Request media type cannot be changed.',
                });
              }

              if (
                (request.requestedBy.id !== actor.id ||
                  (request.type !== MediaType.TV &&
                    !actor.hasPermission(Permission.REQUEST_ADVANCED))) &&
                !actor.hasPermission(Permission.MANAGE_REQUESTS)
              ) {
                return next({
                  status: 403,
                  message: 'You do not have permission to modify this request.',
                });
              }

              let requestUser = request.requestedBy;
              const changesRequestUser =
                body.userId !== undefined &&
                body.userId !== request.requestedBy.id;

              if (
                changesRequestUser &&
                !actor.hasPermission([
                  Permission.MANAGE_USERS,
                  Permission.MANAGE_REQUESTS,
                ])
              ) {
                return next({
                  status: 403,
                  message:
                    'You do not have permission to modify the request user.',
                });
              } else if (body.userId !== undefined) {
                const selectedUser = await userRepository.findOne({
                  where: { id: body.userId },
                });
                if (!selectedUser) {
                  return next({ status: 404, message: 'User not found.' });
                }
                requestUser = selectedUser;
              }

              return await runWithRequestAdmission(
                [`request-user:${requestUser.id}`],
                async () => {
                  if (
                    (changesRequestUser || request.type === MediaType.TV) &&
                    !hasMediaRequestPermission(
                      requestUser,
                      request.type,
                      request.is4k
                    )
                  ) {
                    return next({
                      status: 403,
                      message:
                        'The selected user does not have permission to request this media.',
                    });
                  }

                  if (request.type === MediaType.MOVIE) {
                    const nextServerId =
                      body.serverId === undefined
                        ? request.serverId
                        : body.serverId;
                    validateExternalServiceConfiguration(
                      request.type,
                      nextServerId,
                      null,
                      request.is4k
                    );
                    if (body.serverId !== undefined) {
                      request.serverId = body.serverId as number;
                    }
                    if (body.profileId !== undefined) {
                      request.profileId = body.profileId as number;
                    }
                    if (body.rootFolder !== undefined) {
                      request.rootFolder = body.rootFolder as string;
                    }
                    if (body.tags !== undefined) {
                      request.tags = body.tags;
                    }
                  } else if (
                    request.type === MediaType.MUSIC ||
                    request.type === MediaType.BOOK
                  ) {
                    const nextServerId =
                      body.serverId === undefined
                        ? request.serverId
                        : body.serverId;
                    const nextBookFormat =
                      request.type === MediaType.BOOK
                        ? (body.format ?? request.bookFormat ?? 'ebook')
                        : null;

                    validateExternalServiceConfiguration(
                      request.type,
                      nextServerId,
                      nextBookFormat
                    );

                    if (body.serverId !== undefined) {
                      request.serverId = body.serverId;
                    }
                    if (body.profileId !== undefined) {
                      request.profileId = body.profileId;
                    }
                    if (body.metadataProfileId !== undefined) {
                      request.metadataProfileId = body.metadataProfileId;
                    }
                    if (body.rootFolder !== undefined) {
                      request.rootFolder = body.rootFolder;
                    }
                    if (body.tags !== undefined) {
                      request.tags = body.tags;
                    }
                    if (request.type === MediaType.BOOK) {
                      request.bookFormat =
                        body.format ?? request.bookFormat ?? 'ebook';
                    }
                  } else if (request.type === MediaType.TV) {
                    const requestedSeasons =
                      body.seasons === 'all' ? undefined : body.seasons;
                    if (!requestedSeasons || requestedSeasons.length === 0) {
                      return next({
                        status: 400,
                        message:
                          'Missing seasons. Use DELETE to cancel a series request.',
                      });
                    }

                    const media = await getRepository(Media).findOneOrFail({
                      where: {
                        tmdbId: request.media.tmdbId,
                        mediaType: MediaType.TV,
                      },
                    });
                    const existingSeasons = new Set(
                      (
                        await getRepository(SeasonRequest)
                          .createQueryBuilder('requestedSeason')
                          .innerJoin(
                            'requestedSeason.request',
                            'existingRequest'
                          )
                          .innerJoin('existingRequest.media', 'existingMedia')
                          .select(
                            'DISTINCT requestedSeason.seasonNumber',
                            'seasonNumber'
                          )
                          .where('existingMedia.id = :mediaId', {
                            mediaId: media.id,
                          })
                          .andWhere('existingRequest.is4k = :is4k', {
                            is4k: request.is4k,
                          })
                          .andWhere('existingRequest.id != :requestId', {
                            requestId: request.id,
                          })
                          .andWhere(
                            'existingRequest.status NOT IN (:...inactiveStatuses)',
                            {
                              inactiveStatuses: inactiveMediaRequestStatuses,
                            }
                          )
                          .getRawMany<{
                            seasonNumber: number | string;
                          }>()
                      )
                        .map(({ seasonNumber }) => Number(seasonNumber))
                        .filter(Number.isSafeInteger)
                    );
                    const filteredSeasons = requestedSeasons.filter(
                      (seasonNumber) => !existingSeasons.has(seasonNumber)
                    );

                    if (filteredSeasons.length === 0) {
                      return next({
                        status: 202,
                        message: 'No seasons available to request',
                      });
                    }

                    const quotas = await requestUser.getQuota();
                    const existingAllowance = changesRequestUser
                      ? 0
                      : request.seasons.length;
                    if (
                      quotas.tv.limit &&
                      filteredSeasons.length >
                        (quotas.tv.remaining ?? 0) + existingAllowance
                    ) {
                      return next({
                        status: 403,
                        message: 'Series quota exceeded.',
                      });
                    }

                    if (
                      actor.hasPermission(
                        [
                          Permission.REQUEST_ADVANCED,
                          Permission.MANAGE_REQUESTS,
                        ],
                        { type: 'or' }
                      )
                    ) {
                      const nextServerId =
                        body.serverId === undefined
                          ? request.serverId
                          : body.serverId;
                      validateExternalServiceConfiguration(
                        request.type,
                        nextServerId,
                        null,
                        request.is4k
                      );
                      if (body.serverId !== undefined) {
                        request.serverId = body.serverId as number;
                      }
                      if (body.profileId !== undefined) {
                        request.profileId = body.profileId as number;
                      }
                      if (body.rootFolder !== undefined) {
                        request.rootFolder = body.rootFolder as string;
                      }
                      if (body.languageProfileId !== undefined) {
                        request.languageProfileId =
                          body.languageProfileId as number;
                      }
                      if (body.tags !== undefined) {
                        request.tags = body.tags;
                      }
                    }

                    const currentSeasonNumbers = new Set(
                      request.seasons.map((season) => season.seasonNumber)
                    );
                    const newSeasons = filteredSeasons.filter(
                      (seasonNumber) => !currentSeasonNumbers.has(seasonNumber)
                    );
                    request.seasons = request.seasons.filter((season) =>
                      filteredSeasons.includes(season.seasonNumber)
                    );
                    request.seasons.push(
                      ...newSeasons.map(
                        (seasonNumber) =>
                          new SeasonRequest({
                            seasonNumber,
                            status: MediaRequestStatus.PENDING,
                          })
                      )
                    );
                  }

                  if (changesRequestUser) {
                    const quotas = await requestUser.getQuota();
                    const quota =
                      request.type === MediaType.MOVIE
                        ? quotas.movie
                        : request.type === MediaType.MUSIC
                          ? quotas.music
                          : request.type === MediaType.BOOK
                            ? quotas.book
                            : undefined;
                    if (quota?.restricted) {
                      return next({
                        status: 403,
                        message: `${request.type} quota exceeded.`,
                      });
                    }
                  }

                  request.requestedBy = requestUser;
                  await requestRepository.save(request);
                  return res
                    .status(200)
                    .json(filterEntityResponse(request, req.user));
                }
              );
            }
          ),
        {
          expectedCredentialVersion: getExpectedCredentialVersion(req),
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this request.',
        });
      }
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      next({ status: 500, message: e.message });
    }
  }
);

requestRoutes.delete('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const requestId = parseRequestParamId(req.params.requestId);
    if (!requestId) {
      return next({ status: 404, message: 'Request not found.' });
    }

    return await runUserSecurityMutationWithActor(
      req.user!.id,
      req.user!.id,
      Permission.MANAGE_REQUESTS,
      (actor) =>
        runWithRequestAdmission(
          [getRequestMutationAdmissionKey(requestId)],
          async () => {
            const request = await requestRepository.findOneOrFail({
              where: { id: requestId },
              relations: { requestedBy: true, modifiedBy: true },
            });

            if (
              !actor.hasPermission(Permission.MANAGE_REQUESTS) &&
              (request.requestedBy.id !== actor.id ||
                request.status !== MediaRequestStatus.PENDING)
            ) {
              return next({
                status: 401,
                message: 'You do not have permission to delete this request.',
              });
            }

            await requestRepository.remove(request);
            return res.status(204).send();
          }
        ),
      {
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      }
    );
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 401, message: 'Request user no longer exists.' });
    }
    logger.error('Something went wrong deleting a request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.post<{
  requestId: string;
}>('/:requestId/retry', isAuthenticated(), async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const requestId = parseRequestParamId(req.params.requestId);
    if (!requestId) {
      return next({ status: 404, message: 'Request not found.' });
    }

    const initialRequest = await requestRepository.findOne({
      where: { id: requestId },
      relations: { requestedBy: true },
    });
    if (!initialRequest) {
      return next({ status: 404, message: 'Request not found.' });
    }

    return await runUserSecurityMutationWithActor(
      req.user!.id,
      initialRequest.requestedBy.id,
      Permission.MANAGE_REQUESTS,
      (actor) =>
        runWithRequestAdmission(
          [getRequestMutationAdmissionKey(requestId)],
          async () => {
            const request = await requestRepository.findOneOrFail({
              where: { id: requestId },
              relations: { requestedBy: true, modifiedBy: true },
            });

            if (
              !actor.hasPermission(Permission.MANAGE_REQUESTS) &&
              (request.requestedBy.id !== actor.id ||
                !hasMediaRequestPermission(actor, request.type, request.is4k))
            ) {
              return next({
                status: 403,
                message: 'You do not have permission to retry this request.',
              });
            }

            const currentStatus = await recordRequestStatus(request.id);
            if (
              !currentStatus ||
              !currentStatus.retryable ||
              (currentStatus.stage !== RequestStatusStage.FAILED &&
                currentStatus.stage !== RequestStatusStage.UNAVAILABLE)
            ) {
              return next({
                status: 409,
                message: 'Only failed or unavailable requests can be retried.',
              });
            }

            // this also triggers updating the parent media's status & sending to *arr
            validateExternalServiceConfiguration(
              request.type,
              request.serverId,
              request.bookFormat,
              request.is4k
            );

            if (request.status === MediaRequestStatus.FAILED) {
              request.status = MediaRequestStatus.APPROVED;
            } else {
              // An unavailable request is already APPROVED in the legacy
              // request model. Refresh its event before re-enqueueing so the
              // previous terminal observation cannot mask this attempt.
              await recordRequestStatus(request.id, {
                resetTerminalOverride: true,
              });
              await requestDispatchManager.enqueue(request.id);
            }
            request.modifiedBy = actor;
            await requestRepository.save(request);

            return res
              .status(200)
              .json(filterEntityResponse(request, req.user));
          }
        ),
      {
        expectedCredentialVersion: getExpectedCredentialVersion(req),
      }
    );
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({
        status: 403,
        message: 'You do not have permission to retry this request.',
      });
    }
    if (e instanceof ServiceConfigurationError) {
      return next({ status: 400, message: e.message });
    }

    logger.error('Error processing request retry', {
      label: 'Media Request',
      message: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.post<{
  requestId: string;
  status: 'approve' | 'decline';
}>(
  '/:requestId/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const requestId = parseRequestParamId(req.params.requestId);
      if (!requestId) {
        return next({ status: 404, message: 'Request not found.' });
      }
      const newStatus = parseRequestStatusAction(req.params.status);
      if (!newStatus) {
        return next({ status: 404, message: 'Request not found.' });
      }

      return await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_REQUESTS,
        (actor) =>
          runWithRequestAdmission(
            [getRequestMutationAdmissionKey(requestId)],
            async () => {
              const request = await requestRepository.findOneOrFail({
                where: { id: requestId },
                relations: { requestedBy: true, modifiedBy: true },
              });

              if (request.status !== MediaRequestStatus.PENDING) {
                return next({
                  status: 409,
                  message: 'Only pending requests can be approved or declined.',
                });
              }

              if (newStatus === MediaRequestStatus.APPROVED) {
                validateExternalServiceConfiguration(
                  request.type,
                  request.serverId,
                  request.bookFormat,
                  request.is4k
                );
              }

              request.status = newStatus;
              request.modifiedBy = actor;
              await requestRepository.save(request);

              return res
                .status(200)
                .json(filterEntityResponse(request, req.user));
            }
          ),
        {
          expectedCredentialVersion: getExpectedCredentialVersion(req),
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to update this request.',
        });
      }
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      logger.error('Error processing request update', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 404, message: 'Request not found.' });
    }
  }
);

export default requestRoutes;
