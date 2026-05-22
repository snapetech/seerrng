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
} from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type {
  BulkMediaRequestBody,
  BulkMediaRequestResponse,
  MediaRequestBody,
  RequestResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseOptionalPositiveInt,
  parsePageParams,
} from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseOptionalAllowedString,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';

const requestRoutes = Router();
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
  'approved',
  'processing',
  'pending',
  'unavailable',
  'failed',
  'completed',
  'available',
  'deleted',
] as const;
const requestSortFields = ['modified'] as const;
const requestSortDirections = ['asc'] as const;

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
    case 'pending':
      return MediaRequestStatus.PENDING;
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
  body: unknown
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

  const value = {
    ...body,
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
    mediaId: '',
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
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null
) => {
  const settings = getSettings();

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
      throw new ServiceConfigurationError(
        'Both-format book requests must use separate default ebook and audiobook Bookshelf services.'
      );
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
  if (format === 'audiobook') {
    return (
      media.audiobookExternalServiceId !== null &&
      media.audiobookExternalServiceId !== undefined
    );
  }

  return (
    media.externalServiceId !== null && media.externalServiceId !== undefined
  );
};

const isRequestAvailable = (mediaRequest: MediaRequest): boolean => {
  if (!mediaRequest.media) {
    return false;
  }

  if (mediaRequest.type === MediaType.BOOK) {
    const bookFormat = mediaRequest.bookFormat ?? 'ebook';

    if (bookFormat === 'both') {
      return (
        hasBookFormat(mediaRequest.media, 'ebook') &&
        hasBookFormat(mediaRequest.media, 'audiobook')
      );
    }

    return hasBookFormat(mediaRequest.media, bookFormat);
  }

  if (mediaRequest.is4k) {
    return mediaRequest.media.status4k === MediaStatus.AVAILABLE;
  }

  return mediaRequest.media.status === MediaStatus.AVAILABLE;
};

const isActiveMediaRequest = (request: MediaRequest): boolean =>
  request.status !== MediaRequestStatus.DECLINED &&
  request.status !== MediaRequestStatus.FAILED &&
  request.status !== MediaRequestStatus.COMPLETED;

const hasActiveOverlappingBookRequest = (
  requests: MediaRequest[] | undefined,
  format: 'ebook' | 'audiobook' | 'both' = 'ebook'
): boolean => {
  const requestedFormats =
    format === 'both' ? (['ebook', 'audiobook'] as const) : ([format] as const);

  return (
    requests?.some((request) => {
      if (!isActiveMediaRequest(request)) {
        return false;
      }

      const existingBookFormat = request.bookFormat ?? 'ebook';
      const existingFormats =
        existingBookFormat === 'both'
          ? (['ebook', 'audiobook'] as const)
          : ([existingBookFormat] as const);

      return existingFormats.some((existingFormat) =>
        requestedFormats.includes(existingFormat)
      );
    }) ?? false
  );
};

const getBulkCoveredReason = async (
  mediaType: MediaType.MUSIC | MediaType.BOOK,
  mediaId: string,
  format?: 'ebook' | 'audiobook' | 'both'
): Promise<string | undefined> => {
  if (mediaType === MediaType.MUSIC) {
    const media = await getRepository(Media).findOne({
      where: { mbId: mediaId, mediaType: MediaType.MUSIC },
      relations: { requests: true },
    });

    if (media?.status === MediaStatus.BLOCKLISTED) {
      return 'This album is blocklisted.';
    }

    if (media?.status === MediaStatus.AVAILABLE) {
      return 'This album is already available.';
    }

    if (media?.requests?.some(isActiveMediaRequest)) {
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
    relations: { media: { requests: true } },
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

  if (hasActiveOverlappingBookRequest(media.requests, requestedFormat)) {
    return 'Request for this book already exists.';
  }

  return undefined;
};

requestRoutes.get<
  Record<string, unknown>,
  RequestResultsResponse | { status: number; message: string }
>('/', async (req, res, next) => {
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

    let query = getRepository(MediaRequest)
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.media', 'media')
      .leftJoinAndSelect('request.seasons', 'seasons')
      .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
      .leftJoinAndSelect('request.requestedBy', 'requestedBy')
      .leftJoinAndSelect('media.identifiers', 'identifiers')
      .where('request.status IN (:...requestStatus)', {
        requestStatus: statusFilter,
      })
      .andWhere(
        '((request.is4k = false AND media.status IN (:...mediaStatus)) OR (request.is4k = true AND media.status4k IN (:...mediaStatus)))',
        {
          mediaStatus: mediaStatusFilter,
        }
      );

    if (
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      )
    ) {
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

    const [requests, requestCount] = await query
      .orderBy(sortFilter, sortDirection)
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();

    const settings = getSettings();

    // get all quality profiles for every configured sonarr server
    const sonarrServers = await Promise.all(
      settings.sonarr.map(async (sonarrSetting) => {
        try {
          const sonarr = new SonarrAPI({
            apiKey: sonarrSetting.apiKey,
            url: SonarrAPI.buildUrl(sonarrSetting, '/api/v3'),
          });

          return {
            id: sonarrSetting.id,
            profiles: await sonarr.getProfiles().catch((error) => {
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
      })
    );

    // get all quality profiles for every configured radarr server
    const radarrServers = await Promise.all(
      settings.radarr.map(async (radarrSetting) => {
        try {
          const radarr = new RadarrAPI({
            apiKey: radarrSetting.apiKey,
            url: RadarrAPI.buildUrl(radarrSetting, '/api/v3'),
          });

          return {
            id: radarrSetting.id,
            profiles: await radarr.getProfiles().catch((error) => {
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
      })
    );

    const lidarrServers = await Promise.all(
      settings.lidarr.map(async (lidarrSetting) => {
        try {
          const lidarr = new LidarrAPI({
            apiKey: lidarrSetting.apiKey,
            url: LidarrAPI.buildUrl(lidarrSetting, '/api/v1'),
          });

          return {
            id: lidarrSetting.id,
            profiles: await lidarr.getProfiles().catch((error) => {
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
      })
    );

    const readarrServers = await Promise.all(
      settings.readarr.map(async (readarrSetting) => {
        try {
          const readarr = new ReadarrAPI({
            apiKey: readarrSetting.apiKey,
            url: ReadarrAPI.buildUrl(readarrSetting, '/api/v1'),
          });

          return {
            id: readarrSetting.id,
            profiles: await readarr.getProfiles().catch((error) => {
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
      })
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
    if (req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
      mappedRequests = mappedRequests.map((r) => {
        switch (r.type) {
          case MediaType.MOVIE: {
            return {
              ...r,
              // check if the radarr server for this request is configured
              canRemove: radarrServers.some(
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
              canRemove: sonarrServers.some(
                (server) =>
                  server.id ===
                  (r.is4k ? r.media.serviceId4k : r.media.serviceId)
              ),
            };
          }
          case MediaType.MUSIC: {
            return {
              ...r,
              canRemove: lidarrServers.some(
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
              readarrServers.some((server) => server.id === r.media.serviceId);
            const canRemoveAudiobook =
              hasAudiobookLink &&
              readarrServers.some(
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
      results: filterEntityResponse(mappedRequests),
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
      const body = sanitizeMediaRequestBody(req.body);
      if ('error' in body) {
        logRequestValidationFailure(
          'create',
          body.error,
          req.body,
          req.user.id
        );
        return next(body.error);
      }

      const request = await MediaRequest.request(body.value, req.user);

      return res.status(201).json(filterEntityResponse(request));
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
          return next({ status: 500, message: error.message });
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
            error instanceof RequestPermissionError ||
            error instanceof QuotaRestrictedError
          ) {
            return next({ status: 403, message: error.message });
          }

          if (error instanceof ServiceConfigurationError) {
            return next({ status: 400, message: error.message });
          }

          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: error.message,
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
            req.user
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
            error instanceof RequestPermissionError ||
            error instanceof QuotaRestrictedError
          ) {
            return next({ status: 403, message: error.message });
          }

          if (error instanceof ServiceConfigurationError) {
            return next({ status: 400, message: error.message });
          }

          failed.push({
            mediaId: item.mediaId,
            title: item.title,
            reason: error.message,
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

      return res.status(207).json({ created, skipped, failed });
    } catch (error) {
      if (error instanceof Error) {
        return next({ status: 500, message: error.message });
      }

      return next({ status: 500, message: 'Unable to submit bulk request.' });
    }
  }
);

requestRoutes.get('/count', async (_req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const query = requestRepository
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.media', 'media');

    const totalCount = await query.getCount();

    const movieCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.MOVIE,
      })
      .getCount();

    const tvCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.TV,
      })
      .getCount();

    const musicCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.MUSIC,
      })
      .getCount();

    const bookCount = await query
      .where('request.type = :requestType', {
        requestType: MediaType.BOOK,
      })
      .getCount();

    const pendingCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.PENDING,
      })
      .getCount();

    const approvedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.APPROVED,
      })
      .getCount();

    const declinedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.DECLINED,
      })
      .getCount();

    const approvedRequests = await requestRepository.find({
      where: { status: MediaRequestStatus.APPROVED },
      relations: { media: true },
    });

    const availableCount = approvedRequests.filter(isRequestAvailable).length;
    const processingCount = approvedRequests.length - availableCount;

    const completedCount = await query
      .where('request.status = :requestStatus', {
        requestStatus: MediaRequestStatus.COMPLETED,
      })
      .getCount();

    return res.status(200).json({
      total: totalCount,
      movie: movieCount,
      tv: tvCount,
      music: musicCount,
      book: bookCount,
      pending: pendingCount,
      approved: approvedCount,
      declined: declinedCount,
      processing: processingCount,
      available: availableCount,
      completed: completedCount,
    });
  } catch (e) {
    logger.error('Something went wrong retrieving request counts', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Unable to retrieve request counts.' });
  }
});

requestRoutes.get('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const requestId = parseRequestParamId(req.params.requestId);
    if (!requestId) {
      return next({ status: 404, message: 'Request not found.' });
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
      request.requestedBy.id !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      )
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to view this request.',
      });
    }

    return res.status(200).json(filterEntityResponse(request));
  } catch (e) {
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

      const request = await requestRepository.findOne({
        where: {
          id: requestId,
        },
      });

      if (!request) {
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

      if (body.mediaType && body.mediaType !== request.type) {
        return next({
          status: 400,
          message: 'Request media type cannot be changed.',
        });
      }

      if (
        (request.requestedBy.id !== req.user?.id ||
          (request.type !== MediaType.TV &&
            !req.user?.hasPermission(Permission.REQUEST_ADVANCED))) &&
        !req.user?.hasPermission(Permission.MANAGE_REQUESTS)
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this request.',
        });
      }

      let requestUser = request.requestedBy;

      if (
        body.userId &&
        body.userId !== request.requestedBy.id &&
        !req.user?.hasPermission([
          Permission.MANAGE_USERS,
          Permission.MANAGE_REQUESTS,
        ])
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify the request user.',
        });
      } else if (body.userId) {
        requestUser = await userRepository.findOneOrFail({
          where: { id: body.userId },
        });
      }

      if (request.type === MediaType.MOVIE) {
        request.serverId = body.serverId as number;
        request.profileId = body.profileId as number;
        request.rootFolder = body.rootFolder as string;
        request.tags = body.tags;
        request.requestedBy = requestUser as User;

        await requestRepository.save(request);
      } else if (
        request.type === MediaType.MUSIC ||
        request.type === MediaType.BOOK
      ) {
        const nextServerId =
          body.serverId === undefined ? request.serverId : body.serverId;
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
        request.requestedBy = requestUser as User;
        if (request.type === MediaType.BOOK) {
          request.bookFormat = body.format ?? request.bookFormat ?? 'ebook';
        }

        await requestRepository.save(request);
      } else if (request.type === MediaType.TV) {
        const mediaRepository = getRepository(Media);
        if (
          req.user?.hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
        ) {
          request.serverId = body.serverId as number;
          request.profileId = body.profileId as number;
          request.rootFolder = body.rootFolder as string;
          request.languageProfileId = body.languageProfileId as number;
          request.tags = body.tags;
        }
        request.requestedBy = requestUser as User;

        const requestedSeasons =
          body.seasons === 'all' ? undefined : body.seasons;

        if (!requestedSeasons || requestedSeasons.length === 0) {
          throw new Error(
            'Missing seasons. If you want to cancel a series request, use the DELETE method.'
          );
        }

        // Get existing media so we can work with all the requests
        const media = await mediaRepository.findOneOrFail({
          where: { tmdbId: request.media.tmdbId, mediaType: MediaType.TV },
          relations: { requests: true },
        });

        // Get all requested seasons that are not part of this request we are editing
        const existingSeasons = media.requests
          .filter(
            (r) =>
              r.is4k === request.is4k &&
              r.id !== request.id &&
              r.status !== MediaRequestStatus.DECLINED &&
              r.status !== MediaRequestStatus.COMPLETED
          )
          .reduce((seasons, r) => {
            const combinedSeasons = r.seasons.map(
              (season) => season.seasonNumber
            );

            return [...seasons, ...combinedSeasons];
          }, [] as number[]);

        const filteredSeasons = requestedSeasons.filter(
          (rs) => !existingSeasons.includes(rs)
        );

        if (filteredSeasons.length === 0) {
          return next({
            status: 202,
            message: 'No seasons available to request',
          });
        }

        const newSeasons = requestedSeasons.filter(
          (sn) => !request.seasons.map((s) => s.seasonNumber).includes(sn)
        );

        request.seasons = request.seasons.filter((rs) =>
          filteredSeasons.includes(rs.seasonNumber)
        );

        if (newSeasons.length > 0) {
          logger.debug('Adding new seasons to request', {
            label: 'Media Request',
            newSeasons,
          });
          request.seasons.push(
            ...newSeasons.map(
              (ns) =>
                new SeasonRequest({
                  seasonNumber: ns,
                  status: MediaRequestStatus.PENDING,
                })
            )
          );
        }

        await requestRepository.save(request);
      }

      return res.status(200).json(filterEntityResponse(request));
    } catch (e) {
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

    const request = await requestRepository.findOneOrFail({
      where: { id: requestId },
      relations: { requestedBy: true, modifiedBy: true },
    });

    if (
      !req.user?.hasPermission(Permission.MANAGE_REQUESTS) &&
      (request.requestedBy.id !== req.user?.id ||
        request.status !== MediaRequestStatus.PENDING)
    ) {
      return next({
        status: 401,
        message: 'You do not have permission to delete this request.',
      });
    }

    await requestRepository.remove(request);

    return res.status(204).send();
  } catch (e) {
    logger.error('Something went wrong deleting a request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Request not found.' });
  }
});

requestRoutes.post<{
  requestId: string;
}>(
  '/:requestId/retry',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const requestId = parseRequestParamId(req.params.requestId);
      if (!requestId) {
        return next({ status: 404, message: 'Request not found.' });
      }

      const request = await requestRepository.findOneOrFail({
        where: { id: requestId },
        relations: { requestedBy: true, modifiedBy: true },
      });

      // this also triggers updating the parent media's status & sending to *arr
      validateExternalServiceConfiguration(
        request.type,
        request.serverId,
        request.bookFormat
      );

      request.status = MediaRequestStatus.APPROVED;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(filterEntityResponse(request));
    } catch (e) {
      if (e instanceof ServiceConfigurationError) {
        return next({ status: 400, message: e.message });
      }

      logger.error('Error processing request retry', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 404, message: 'Request not found.' });
    }
  }
);

requestRoutes.post<{
  requestId: string;
  status: 'pending' | 'approve' | 'decline';
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

      const request = await requestRepository.findOneOrFail({
        where: { id: requestId },
        relations: { requestedBy: true, modifiedBy: true },
      });

      if (newStatus === MediaRequestStatus.APPROVED) {
        validateExternalServiceConfiguration(
          request.type,
          request.serverId,
          request.bookFormat
        );
      }

      request.status = newStatus;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(filterEntityResponse(request));
    } catch (e) {
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
