import OpenLibraryAPI from '@server/api/openlibrary';
import type { LidarrAlbumOptions } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type { RadarrMovieOptions } from '@server/api/servarr/radarr';
import RadarrAPI from '@server/api/servarr/radarr';
import type { ReadarrBookLookupResult } from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import type {
  AddSeriesOptions,
  SonarrSeries,
} from '@server/api/servarr/sonarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import WikidataAPI from '@server/api/wikidata';
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
  MediaRequest,
  getRequestMutationAdmissionKey,
  runWithRequestAdmission,
} from '@server/entity/MediaRequest';
import { RequestDispatchOutbox } from '@server/entity/RequestDispatchOutbox';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { normalizeValidIsbn } from '@server/lib/isbn';
import { runMediaEntityMutation } from '@server/lib/mediaMutation';
import notificationManager, { Notification } from '@server/lib/notifications';
import requestDispatchManager, {
  type RequestDispatchOutcome,
} from '@server/lib/requestDispatch';
import {
  ServarrServiceAuthorityChangedError,
  runWithServarrServiceAdmission,
  runWithServarrServiceCollectionAdmission,
  type ServarrServiceType,
} from '@server/lib/serviceAdmission';
import { type ReadarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { isEqual } from 'lodash';
import type {
  EntityManager,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber, In, Not } from 'typeorm';

const sanitizeDisplayName = (displayName: string): string => {
  return displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

const READARR_LOOKUP_RETRY_DELAYS_MS =
  process.env.NODE_ENV === 'test' ? [1, 1, 1] : [500, 1500, 3000];
const READARR_MAX_EXPANDED_LOOKUP_TERMS = 18;
const READARR_APPROVED_RETRY_BATCH_SIZE = 1;
const READARR_MIN_PROVIDER_RETRY_DELAY_MS = 1_000;
const READARR_MAX_PROVIDER_RETRY_DELAY_MS = 3_600_000;
const READARR_MAX_RECONCILIATION_BATCH_SIZE = 100;
export const READARR_FAILED_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000;
export const READARR_MAX_LOOKUP_RESULTS = 50;
export const READARR_LOOKUP_HYDRATION_CONCURRENCY = 5;
const activeReadarrDispatches = new Map<number, Promise<number | undefined>>();

interface RequestDispatchServiceSelection {
  serviceType: ServarrServiceType;
  serviceIds: number[];
}

const getRequestDispatchServiceSelection = (
  request: MediaRequest
): RequestDispatchServiceSelection => {
  const settings = getExternalRuntimeConfig();
  const uniqueIds = (ids: (number | undefined)[]) =>
    [...new Set(ids.filter((id): id is number => id !== undefined))].sort(
      (left, right) => left - right
    );

  if (request.type === MediaType.MOVIE) {
    const selected =
      request.serverId !== null && request.serverId >= 0
        ? settings.radarr.find(({ id }) => id === request.serverId)
        : settings.radarr.find(
            ({ isDefault, is4k }) => isDefault && is4k === request.is4k
          );
    return { serviceType: 'radarr', serviceIds: uniqueIds([selected?.id]) };
  }
  if (request.type === MediaType.TV) {
    const selected =
      request.serverId !== null && request.serverId >= 0
        ? settings.sonarr.find(({ id }) => id === request.serverId)
        : settings.sonarr.find(
            ({ isDefault, is4k }) => isDefault && is4k === request.is4k
          );
    return { serviceType: 'sonarr', serviceIds: uniqueIds([selected?.id]) };
  }
  if (request.type === MediaType.MUSIC) {
    const selected =
      request.serverId !== null && request.serverId >= 0
        ? settings.lidarr.find(({ id }) => id === request.serverId)
        : settings.lidarr.find(({ isDefault }) => isDefault);
    return { serviceType: 'lidarr', serviceIds: uniqueIds([selected?.id]) };
  }

  const format = request.bookFormat ?? 'ebook';
  const targetFormats =
    format === 'both'
      ? (['ebook', 'audiobook'] as const)
      : format === 'audiobook'
        ? (['audiobook'] as const)
        : (['ebook'] as const);
  const serviceIds = targetFormats.map((serviceType) => {
    const allowOverride = format !== 'both' || serviceType === 'ebook';
    if (allowOverride && request.serverId !== null && request.serverId >= 0) {
      return settings.readarr.find(({ id }) => id === request.serverId)?.id;
    }
    return settings.readarr.find(
      (service) =>
        service.isDefault && (service.serviceType ?? 'ebook') === serviceType
    )?.id;
  });
  return { serviceType: 'readarr', serviceIds: uniqueIds(serviceIds) };
};

const hasSameRequestDispatchServiceSelection = (
  left: RequestDispatchServiceSelection,
  right: RequestDispatchServiceSelection
): boolean =>
  left.serviceType === right.serviceType &&
  left.serviceIds.length === right.serviceIds.length &&
  left.serviceIds.every((id, index) => id === right.serviceIds[index]);

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const isTransientExternalError = (error: unknown): boolean => {
  let current: unknown = error;

  while (current) {
    const message =
      current instanceof Error ? current.message : String(current);

    if (
      /(?:status code|status)\s*(429|502|503|504)|\b(429|502|503|504)\b|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|timeout of \d+ms exceeded/i.test(
        message
      ) ||
      /500\.InternalServerError|InternalServerError/i.test(message)
    ) {
      return true;
    }

    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
};

const getRetryAfterMs = (error: unknown): number | undefined => {
  let current: unknown = error;

  while (current instanceof Error) {
    const response = (
      current as Error & {
        response?: { headers?: Record<string, string | string[] | undefined> };
      }
    ).response;
    const retryAfterHeader = response?.headers?.['retry-after'];
    const retryAfter = Array.isArray(retryAfterHeader)
      ? retryAfterHeader[0]
      : retryAfterHeader;

    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds)) {
        return Math.max(retryAfterSeconds * 1000, 0);
      }

      const retryAfterDate = Date.parse(retryAfter);
      if (!Number.isNaN(retryAfterDate)) {
        return Math.max(retryAfterDate - Date.now(), 0);
      }
    }

    current = current.cause;
  }

  return undefined;
};

export const clampReadarrProviderRetryDelay = (delayMs: number): number =>
  Math.min(
    READARR_MAX_PROVIDER_RETRY_DELAY_MS,
    Math.max(READARR_MIN_PROVIDER_RETRY_DELAY_MS, delayMs)
  );

const lookupReadarrBookWithRetry = async (
  readarr: ReadarrAPI,
  term: string,
  context: {
    mediaId: number;
    requestId: number;
    serviceType: 'ebook' | 'audiobook';
  }
): Promise<ReadarrBookLookupResult[]> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readarr.lookupBook(term);
    } catch (error) {
      if (
        !isTransientExternalError(error) ||
        attempt >= READARR_LOOKUP_RETRY_DELAYS_MS.length
      ) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `Bookshelf lookup failed for ${context.serviceType} term "${term}": ${errorMessage}`,
          { cause: error }
        );
      }

      const delayMs = READARR_LOOKUP_RETRY_DELAYS_MS[attempt];
      logger.warn('Bookshelf lookup failed transiently; retrying.', {
        label: 'Readarr',
        mediaId: context.mediaId,
        requestId: context.requestId,
        serviceType: context.serviceType,
        lookupTerm: term,
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        delayMs,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown lookup error',
      });

      await sleep(delayMs);
    }
  }
};

const isAddableReadarrBookLookupResult = (
  result: ReadarrBookLookupResult
): boolean => {
  return !!(
    result.foreignBookId &&
    result.title &&
    result.author?.foreignAuthorId &&
    Array.isArray(result.editions) &&
    result.editions.length > 0
  );
};

const parseReadarrAuthorName = (
  result: ReadarrBookLookupResult
): string | undefined => {
  const authorTitle = result.authorTitle?.trim();

  if (!authorTitle) {
    return undefined;
  }

  const titleIndex = authorTitle
    .toLocaleLowerCase()
    .lastIndexOf(result.title.toLocaleLowerCase());
  const rawAuthorName =
    titleIndex > 0 ? authorTitle.slice(0, titleIndex).trim() : authorTitle;
  const [lastName, ...firstNameParts] = rawAuthorName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!lastName) {
    return undefined;
  }

  return firstNameParts.length
    ? `${firstNameParts.join(' ')} ${lastName}`
    : lastName;
};

const hydrateSoftcoverLookupResults = async (
  readarr: ReadarrAPI,
  results: ReadarrBookLookupResult[],
  normalizedIsbn?: string
): Promise<ReadarrBookLookupResult[]> => {
  const authorCache = new Map<
    string,
    Promise<ReadarrBookLookupResult['author'] | undefined>
  >();

  return mapWithConcurrency(
    results.slice(0, READARR_MAX_LOOKUP_RESULTS),
    READARR_LOOKUP_HYDRATION_CONCURRENCY,
    async (result) => {
      if (isAddableReadarrBookLookupResult(result)) {
        return result;
      }

      if (result.author || !result.foreignEditionId) {
        return result;
      }

      const authorName = parseReadarrAuthorName(result);

      if (!authorName) {
        return result;
      }

      let pendingAuthor = authorCache.get(authorName);

      if (!pendingAuthor) {
        pendingAuthor = readarr
          .lookupAuthor(authorName)
          .then(([authorResult]) =>
            authorResult?.foreignAuthorId && authorResult.authorName
              ? {
                  foreignAuthorId: authorResult.foreignAuthorId,
                  authorName: authorResult.authorName,
                  id: authorResult.id,
                }
              : undefined
          );
        authorCache.set(authorName, pendingAuthor);
      }

      const author = await pendingAuthor;
      if (!author) {
        return result;
      }

      return {
        ...result,
        author,
        editions: [
          {
            foreignEditionId: result.foreignEditionId,
            title: result.title,
            isbn13: normalizedIsbn,
            monitored: true,
          },
        ],
      };
    }
  );
};

const normalizeOpenLibraryAuthorId = (authorKey: string): string =>
  authorKey.replace(/^\/?authors\//i, '');

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  private getReadarrDispatchRetryDelay(
    entity: MediaRequest,
    error: unknown
  ): number | undefined {
    const providerRetryDelay = getRetryAfterMs(error);
    const retryAfterMs =
      providerRetryDelay === undefined
        ? undefined
        : clampReadarrProviderRetryDelay(providerRetryDelay);

    logger.warn(
      'Bookshelf request hit a transient metadata limit; leaving request in the durable dispatch queue.',
      {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        retryAfterMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    );

    return retryAfterMs;
  }

  public async retryApprovedReadarrRequests(
    limit = READARR_APPROVED_RETRY_BATCH_SIZE
  ): Promise<void> {
    const requestRepository = getRepository(MediaRequest);
    const boundedLimit =
      Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, READARR_MAX_RECONCILIATION_BATCH_SIZE)
        : READARR_APPROVED_RETRY_BATCH_SIZE;
    const requests = await requestRepository
      .createQueryBuilder('mediaRequest')
      .leftJoinAndSelect('mediaRequest.media', 'media')
      .leftJoinAndSelect('mediaRequest.requestedBy', 'requestedBy')
      .where('mediaRequest.type = :type', { type: MediaType.BOOK })
      .andWhere('mediaRequest.status = :status', {
        status: MediaRequestStatus.APPROVED,
      })
      .andWhere((query) => {
        const queued = query
          .subQuery()
          .select('1')
          .from(RequestDispatchOutbox, 'dispatch')
          .where('dispatch.requestId = mediaRequest.id')
          .getQuery();
        return `NOT EXISTS ${queued}`;
      })
      .orderBy('mediaRequest.updatedAt', 'ASC')
      .addOrderBy('mediaRequest.id', 'ASC')
      .take(boundedLimit)
      .getMany();

    for (const request of requests) {
      await requestDispatchManager.enqueue(request.id);
    }
  }

  private getBookStatusFromLinks(media: Media): MediaStatus {
    const hasEbook =
      media.serviceId !== null &&
      media.serviceId !== undefined &&
      media.externalServiceId !== null &&
      media.externalServiceId !== undefined;
    const hasAudiobook =
      media.audiobookServiceId !== null &&
      media.audiobookServiceId !== undefined &&
      media.audiobookExternalServiceId !== null &&
      media.audiobookExternalServiceId !== undefined;

    return hasEbook || hasAudiobook
      ? MediaStatus.AVAILABLE
      : MediaStatus.UNKNOWN;
  }

  private async enqueueRequestNotification(
    type: Notification,
    entity: MediaRequest,
    event: InsertEvent<MediaRequest> | UpdateEvent<MediaRequest>
  ): Promise<void> {
    await notificationManager.sendNotificationIntent(
      type,
      { kind: 'media-request', requestId: entity.id },
      event.queryRunner
    );
  }

  private isRequestMediaAvailable(entity: MediaRequest): boolean {
    return (
      entity.media[entity.is4k ? 'status4k' : 'status'] ===
      MediaStatus.AVAILABLE
    );
  }

  private async enqueueInsertedRequestNotifications(
    entity: MediaRequest,
    event: InsertEvent<MediaRequest>
  ): Promise<void> {
    if (entity.status === MediaRequestStatus.PENDING) {
      await this.enqueueRequestNotification(
        Notification.MEDIA_PENDING,
        entity,
        event
      );
      if (entity.isAutoRequest) {
        await this.enqueueRequestNotification(
          Notification.MEDIA_AUTO_REQUESTED,
          entity,
          event
        );
      }
      return;
    }
    if (entity.status === MediaRequestStatus.APPROVED) {
      await this.enqueueRequestNotification(
        this.isRequestMediaAvailable(entity)
          ? Notification.MEDIA_AVAILABLE
          : Notification.MEDIA_AUTO_APPROVED,
        entity,
        event
      );
      if (entity.isAutoRequest) {
        await this.enqueueRequestNotification(
          Notification.MEDIA_AUTO_REQUESTED,
          entity,
          event
        );
      }
    }
  }

  private async enqueueUpdatedRequestNotification(
    entity: MediaRequest,
    event: UpdateEvent<MediaRequest>
  ): Promise<void> {
    // Repository.update()/query-builder updates emit a partial object without
    // a stable request id or relations, so they cannot describe one durable
    // per-request notification intent.
    if (!Number.isSafeInteger(entity.id) || !entity.media) {
      return;
    }
    if (entity.status === event.databaseEntity?.status) {
      return;
    }
    if (entity.status === MediaRequestStatus.APPROVED) {
      await this.enqueueRequestNotification(
        this.isRequestMediaAvailable(entity)
          ? Notification.MEDIA_AVAILABLE
          : Notification.MEDIA_APPROVED,
        entity,
        event
      );
    } else if (entity.status === MediaRequestStatus.DECLINED) {
      await this.enqueueRequestNotification(
        Notification.MEDIA_DECLINED,
        entity,
        event
      );
    } else if (entity.status === MediaRequestStatus.COMPLETED) {
      await this.enqueueRequestNotification(
        Notification.MEDIA_AVAILABLE,
        entity,
        event
      );
    }
  }

  public async dispatchRequestById(
    requestId: number
  ): Promise<RequestDispatchOutcome> {
    return runWithRequestAdmission(
      [getRequestMutationAdmissionKey(requestId)],
      async () => {
        const request = await getRepository(MediaRequest).findOne({
          where: { id: requestId },
        });
        const isRetryableFailedBook =
          request?.type === MediaType.BOOK &&
          request.status === MediaRequestStatus.FAILED;
        if (
          !request ||
          (request.status !== MediaRequestStatus.APPROVED &&
            !isRetryableFailedBook)
        ) {
          return { delivered: true };
        }

        return runMediaEntityMutation(request.media, () =>
          this.dispatchWithServiceAuthority(request)
        );
      }
    );
  }

  private async dispatchWithServiceAuthority(
    request: MediaRequest
  ): Promise<RequestDispatchOutcome> {
    const selection = await runWithServarrServiceCollectionAdmission(
      getRequestDispatchServiceSelection(request).serviceType,
      async () => getRequestDispatchServiceSelection(request)
    );

    if (selection.serviceIds.length === 0) {
      return runWithServarrServiceCollectionAdmission(
        selection.serviceType,
        async () => {
          const current = getRequestDispatchServiceSelection(request);
          if (!hasSameRequestDispatchServiceSelection(selection, current)) {
            throw new ServarrServiceAuthorityChangedError(
              `${selection.serviceType} service selection changed during dispatch admission.`
            );
          }
          return this.dispatchApprovedRequest(request);
        }
      );
    }

    return runWithServarrServiceAdmission(
      selection.serviceIds.map((serviceId) => ({
        serviceType: selection.serviceType,
        serviceId,
      })),
      async () => {
        const current = getRequestDispatchServiceSelection(request);
        if (!hasSameRequestDispatchServiceSelection(selection, current)) {
          throw new ServarrServiceAuthorityChangedError(
            `${selection.serviceType} service selection changed during dispatch admission.`
          );
        }
        return this.dispatchApprovedRequest(request);
      }
    );
  }

  private async dispatchApprovedRequest(
    request: MediaRequest
  ): Promise<RequestDispatchOutcome> {
    if (request.type === MediaType.MOVIE) {
      return { delivered: await this.sendToRadarr(request) };
    }
    if (request.type === MediaType.TV) {
      return { delivered: await this.sendToSonarr(request) };
    }
    if (request.type === MediaType.MUSIC) {
      await this.sendToLidarr(request);
    } else if (request.type === MediaType.BOOK) {
      const retryAfterMs = await this.sendToReadarr(request);
      if (retryAfterMs !== undefined) {
        return { delivered: false, retryAfterMs };
      }
    } else {
      return { delivered: true };
    }
    const updated = await getRepository(MediaRequest).findOne({
      where: { id: request.id },
      select: { id: true, status: true },
    });
    return {
      delivered: !updated || updated.status !== MediaRequestStatus.APPROVED,
    };
  }

  private async enqueueRequestDispatch(
    entity: MediaRequest,
    event: InsertEvent<MediaRequest> | UpdateEvent<MediaRequest>
  ): Promise<void> {
    if (entity.status === MediaRequestStatus.APPROVED) {
      if (Number.isSafeInteger(entity.id) && entity.media) {
        await requestDispatchManager.enqueue(entity.id, event.queryRunner);
      }
      return;
    }
    if (entity.status !== undefined && Number.isSafeInteger(entity.id)) {
      await requestDispatchManager.cancel(entity.id, event.queryRunner);
    }
  }

  public async sendToRadarr(entity: MediaRequest): Promise<boolean> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.MOVIE
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getExternalRuntimeConfig();
        if (settings.radarr.length === 0 && !settings.radarr[0]) {
          logger.info(
            'No Radarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return false;
        }

        let radarrSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === entity.is4k
        );

        if (
          entity.serverId !== null &&
          entity.serverId >= 0 &&
          radarrSettings?.id !== entity.serverId
        ) {
          radarrSettings = settings.radarr.find(
            (radarr) => radarr.id === entity.serverId
          );
          logger.info(
            `Request has an override server: ${radarrSettings?.name}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (!radarrSettings) {
          logger.warn(
            `There is no default ${
              entity.is4k ? '4K ' : ''
            }Radarr server configured. Did you set any of your ${
              entity.is4k ? '4K ' : ''
            }Radarr servers as default?`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return false;
        }

        let rootFolder = radarrSettings.activeDirectory;
        let qualityProfile = radarrSettings.activeProfileId;
        let tags = radarrSettings.tags ? [...radarrSettings.tags] : [];

        if (
          entity.rootFolder &&
          entity.rootFolder !== '' &&
          entity.rootFolder !== radarrSettings.activeDirectory
        ) {
          rootFolder = entity.rootFolder;
          logger.info(`Request has an override root folder: ${rootFolder}`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
        }

        if (
          entity.profileId !== null &&
          entity.profileId !== undefined &&
          entity.profileId !== radarrSettings.activeProfileId
        ) {
          qualityProfile = entity.profileId;
          logger.info(
            `Request has an override quality profile ID: ${qualityProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (entity.tags && !isEqual(entity.tags, radarrSettings.tags)) {
          tags = entity.tags;
          logger.info(`Request has override tags`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tagIds: tags,
          });
        }

        const tmdb = new TheMovieDb();
        const radarr = new RadarrAPI({
          apiKey: radarrSettings.apiKey,
          url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
        });
        const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId });

        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (!media) {
          logger.error('Media data not found', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
          return false;
        }

        if (radarrSettings.tagRequests) {
          const radarrTags = await radarr.getTags();
          // old tags had space around the hyphen
          let userTag = radarrTags.find((v) =>
            v.label.startsWith(entity.requestedBy.id + ' - ')
          );
          // new tags do not have spaces around the hyphen, since spaces are not allowed anymore
          if (!userTag) {
            userTag = radarrTags.find((v) =>
              v.label.startsWith(entity.requestedBy.id + '-')
            );
          }
          if (!userTag) {
            logger.info(`Requester has no active tag. Creating new`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              newTag:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
            userTag = await radarr.createTag({
              label:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
          }
          if (userTag.id) {
            if (!tags?.find((v) => v === userTag?.id)) {
              tags?.push(userTag.id);
            }
          } else {
            logger.warn(`Requester has no tag and failed to add one`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              radarrServer: radarrSettings.hostname + ':' + radarrSettings.port,
            });
          }
        }

        if (
          media[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
        ) {
          logger.warn('Media already exists, marking request as COMPLETED', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });

          const requestRepository = getRepository(MediaRequest);
          entity.status = MediaRequestStatus.COMPLETED;
          await requestRepository.save(entity);
          return true;
        }

        const radarrMovieOptions: RadarrMovieOptions = {
          profileId: qualityProfile,
          qualityProfileId: qualityProfile,
          rootFolderPath: rootFolder,
          minimumAvailability: radarrSettings.minimumAvailability,
          title: movie.title,
          tmdbId: movie.id,
          year: Number(movie.release_date.slice(0, 4)),
          monitored: true,
          tags,
          searchNow: !radarrSettings.preventSearch,
        };

        try {
          const radarrMovie = await radarr.addMovie(radarrMovieOptions);
          const freshMedia = await mediaRepository.findOne({
            where: { id: entity.media.id },
          });
          if (!freshMedia) {
            throw new Error('Media data not found');
          }
          freshMedia[
            entity.is4k ? 'externalServiceId4k' : 'externalServiceId'
          ] = radarrMovie.id;
          freshMedia[
            entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
          ] = radarrMovie.titleSlug;
          freshMedia[entity.is4k ? 'serviceId4k' : 'serviceId'] =
            radarrSettings.id;
          await mediaRepository.save(freshMedia);
        } finally {
          radarr.clearCache({
            tmdbId: movie.id,
            externalId: entity.is4k
              ? media.externalServiceId4k
              : media.externalServiceId,
          });
        }
        logger.info('Sent request to Radarr', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return true;
      } catch (e) {
        const requestRepository = getRepository(MediaRequest);
        const mediaRepository = getRepository(Media);
        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (media) {
          entity.status = MediaRequestStatus.FAILED;
          await requestRepository.save(entity);

          logger.warn(
            'Failed to send movie request to Radarr due to connection or configuration error, marking status as FAILED',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              errorMessage: e.message,
            }
          );

          await MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
        return true;
      }
    }
    return true;
  }

  public async sendToSonarr(entity: MediaRequest): Promise<boolean> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.TV
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getExternalRuntimeConfig();
        if (settings.sonarr.length === 0 && !settings.sonarr[0]) {
          logger.warn(
            'No Sonarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return false;
        }

        let sonarrSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === entity.is4k
        );

        if (
          entity.serverId !== null &&
          entity.serverId >= 0 &&
          sonarrSettings?.id !== entity.serverId
        ) {
          sonarrSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === entity.serverId
          );
          logger.info(
            `Request has an override server: ${sonarrSettings?.name}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (!sonarrSettings) {
          logger.warn(
            `There is no default ${
              entity.is4k ? '4K ' : ''
            }Sonarr server configured. Did you set any of your ${
              entity.is4k ? '4K ' : ''
            }Sonarr servers as default?`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return false;
        }

        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (!media) {
          throw new Error('Media data not found');
        }

        if (
          media[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
        ) {
          logger.warn('Media already exists, marking request as COMPLETED', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });

          const requestRepository = getRepository(MediaRequest);
          entity.status = MediaRequestStatus.COMPLETED;
          entity.seasons.forEach((season) => {
            season.status = MediaRequestStatus.COMPLETED;
          });
          await requestRepository.save(entity);
          return true;
        }

        const tmdb = new TheMovieDb();
        const sonarr = new SonarrAPI({
          apiKey: sonarrSettings.apiKey,
          url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
        });
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;

        if (!tvdbId) {
          const requestRepository = getRepository(MediaRequest);
          await mediaRepository.remove(media);
          await requestRepository.remove(entity);
          throw new Error('TVDB ID not found');
        }

        let seriesType: SonarrSeries['seriesType'] = 'standard';

        // Change series type to anime if the anime keyword is present on tmdb
        if (
          series.keywords.results.some(
            (keyword) => keyword.id === ANIME_KEYWORD_ID
          )
        ) {
          seriesType = sonarrSettings.animeSeriesType ?? 'anime';
        }

        let rootFolder =
          seriesType === 'anime' && sonarrSettings.activeAnimeDirectory
            ? sonarrSettings.activeAnimeDirectory
            : sonarrSettings.activeDirectory;
        let qualityProfile =
          seriesType === 'anime' && sonarrSettings.activeAnimeProfileId
            ? sonarrSettings.activeAnimeProfileId
            : sonarrSettings.activeProfileId;
        let languageProfile =
          seriesType === 'anime' && sonarrSettings.activeAnimeLanguageProfileId
            ? sonarrSettings.activeAnimeLanguageProfileId
            : sonarrSettings.activeLanguageProfileId;
        let tags =
          seriesType === 'anime'
            ? sonarrSettings.animeTags
              ? [...sonarrSettings.animeTags]
              : []
            : sonarrSettings.tags
              ? [...sonarrSettings.tags]
              : [];

        if (
          entity.rootFolder &&
          entity.rootFolder !== '' &&
          entity.rootFolder !== rootFolder
        ) {
          rootFolder = entity.rootFolder;
          logger.info(`Request has an override root folder: ${rootFolder}`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
          });
        }

        if (
          entity.profileId !== null &&
          entity.profileId !== undefined &&
          entity.profileId !== qualityProfile
        ) {
          qualityProfile = entity.profileId;
          logger.info(
            `Request has an override quality profile ID: ${qualityProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (
          entity.languageProfileId !== null &&
          entity.languageProfileId !== undefined &&
          entity.languageProfileId !== languageProfile
        ) {
          languageProfile = entity.languageProfileId;
          logger.info(
            `Request has an override language profile ID: ${languageProfile}`,
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
        }

        if (entity.tags && !isEqual(entity.tags, tags)) {
          tags = entity.tags;
          logger.info(`Request has override tags`, {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tagIds: tags,
          });
        }

        if (sonarrSettings.tagRequests) {
          const sonarrTags = await sonarr.getTags();
          // old tags had space around the hyphen
          let userTag = sonarrTags.find((v) =>
            v.label.startsWith(entity.requestedBy.id + ' - ')
          );
          // new tags do not have spaces around the hyphen, since spaces are not allowed anymore
          if (!userTag) {
            userTag = sonarrTags.find((v) =>
              v.label.startsWith(entity.requestedBy.id + '-')
            );
          }
          if (!userTag) {
            logger.info(`Requester has no active tag. Creating new`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              newTag:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
            userTag = await sonarr.createTag({
              label:
                entity.requestedBy.id +
                '-' +
                sanitizeDisplayName(entity.requestedBy.displayName),
            });
          }
          if (userTag.id) {
            if (!tags?.find((v) => v === userTag?.id)) {
              tags?.push(userTag.id);
            }
          } else {
            logger.warn(`Requester has no tag and failed to add one`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              sonarrServer: sonarrSettings.hostname + ':' + sonarrSettings.port,
            });
          }
        }

        const sonarrSeriesOptions: AddSeriesOptions = {
          profileId: qualityProfile,
          languageProfileId: languageProfile,
          rootFolderPath: rootFolder,
          title: series.name,
          tvdbid: tvdbId,
          seasons: entity.seasons.map((season) => season.seasonNumber),
          seasonFolder: sonarrSettings.enableSeasonFolders,
          seriesType,
          tags,
          monitored: true,
          monitorNewItems: sonarrSettings.monitorNewItems,
          searchNow: !sonarrSettings.preventSearch,
        };

        try {
          const sonarrSeries = await sonarr.addSeries(sonarrSeriesOptions);
          const freshMedia = await mediaRepository.findOne({
            where: { id: entity.media.id },
          });
          if (!freshMedia) {
            throw new Error('Media data not found');
          }
          freshMedia[
            entity.is4k ? 'externalServiceId4k' : 'externalServiceId'
          ] = sonarrSeries.id;
          freshMedia[
            entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
          ] = sonarrSeries.titleSlug;
          freshMedia[entity.is4k ? 'serviceId4k' : 'serviceId'] =
            sonarrSettings.id;
          await mediaRepository.save(freshMedia);
        } finally {
          sonarr.clearCache({
            tvdbId,
            externalId: entity.is4k
              ? media.externalServiceId4k
              : media.externalServiceId,
            title: series.name,
          });
        }
        logger.info('Sent request to Sonarr', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return true;
      } catch (e) {
        const requestRepository = getRepository(MediaRequest);
        const mediaRepository = getRepository(Media);
        const media = await mediaRepository.findOne({
          where: { id: entity.media.id },
        });

        if (media) {
          entity.status = MediaRequestStatus.FAILED;
          await requestRepository.save(entity);

          logger.warn(
            'Failed to send series request to Sonarr due to connection or configuration error, marking status as FAILED',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              errorMessage: e.message,
            }
          );

          await MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
        return true;
      }
    }
    return true;
  }

  public async sendToLidarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status !== MediaRequestStatus.APPROVED ||
      entity.type !== MediaType.MUSIC
    ) {
      return;
    }

    try {
      const mediaRepository = getRepository(Media);
      const settings = getExternalRuntimeConfig();

      let lidarrSettings = settings.lidarr.find((lidarr) => lidarr.isDefault);

      if (
        entity.serverId !== null &&
        entity.serverId >= 0 &&
        lidarrSettings?.id !== entity.serverId
      ) {
        lidarrSettings = settings.lidarr.find(
          (lidarr) => lidarr.id === entity.serverId
        );
      }

      if (!lidarrSettings) {
        logger.warn('There is no default Lidarr server configured.', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      if (!media?.mbId) {
        logger.error('Music media data not found or missing mbId', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
      }

      if (media.status === MediaStatus.AVAILABLE) {
        logger.warn('Music already exists, marking request as COMPLETED', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });

        const requestRepository = getRepository(MediaRequest);
        entity.status = MediaRequestStatus.COMPLETED;
        await requestRepository.save(entity);
        return;
      }

      const lidarr = new LidarrAPI({
        apiKey: lidarrSettings.apiKey,
        url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
      });

      const mediaMbId = normalizeMusicBrainzId(media.mbId);
      const searchResults = await lidarr.searchAlbumByMusicBrainzId(mediaMbId);

      if (!searchResults?.length) {
        throw new Error('Album not found in Lidarr search');
      }

      const albumInfo = searchResults[0].album;
      const rootFolder = entity.rootFolder || lidarrSettings.activeDirectory;
      const qualityProfile = entity.profileId ?? lidarrSettings.activeProfileId;
      const metadataProfile =
        entity.metadataProfileId ?? lidarrSettings.activeMetadataProfileId ?? 1;
      const tags = entity.tags
        ? [...entity.tags]
        : [...(lidarrSettings.tags ?? [])];

      if (lidarrSettings.tagRequests) {
        let userTag = (await lidarr.getTags()).find((tag) =>
          tag.label.startsWith(`${entity.requestedBy.id} - `)
        );

        if (!userTag) {
          userTag = await lidarr.createTag({
            label: `${entity.requestedBy.id} - ${entity.requestedBy.displayName}`,
          });
        }

        if (userTag.id && !tags.includes(userTag.id)) {
          tags.push(userTag.id);
        }
      }

      const artistPath = `${rootFolder}/${albumInfo.artist.artistName}`;
      const addAlbumPayload: LidarrAlbumOptions = {
        title: albumInfo.title,
        disambiguation: albumInfo.disambiguation || '',
        overview: albumInfo.overview,
        artistId: albumInfo.artist.id,
        foreignAlbumId: albumInfo.foreignAlbumId,
        monitored: true,
        anyReleaseOk: true,
        profileId: qualityProfile,
        duration: albumInfo.duration || 0,
        albumType: albumInfo.albumType,
        secondaryTypes: [],
        mediumCount: albumInfo.mediumCount || 0,
        ratings: albumInfo.ratings,
        releaseDate: albumInfo.releaseDate,
        releases: [],
        genres: albumInfo.genres,
        media: [],
        artist: {
          status: albumInfo.artist.status,
          ended: albumInfo.artist.ended,
          artistName: albumInfo.artist.artistName,
          foreignArtistId: albumInfo.artist.foreignArtistId,
          tadbId: albumInfo.artist.tadbId || 0,
          discogsId: albumInfo.artist.discogsId || 0,
          overview: albumInfo.artist.overview,
          artistType: albumInfo.artist.artistType,
          disambiguation: albumInfo.artist.disambiguation,
          links: albumInfo.artist.links || [],
          images: albumInfo.artist.images || [],
          path: artistPath,
          qualityProfileId: qualityProfile,
          metadataProfileId: metadataProfile,
          monitored: true,
          monitorNewItems: 'none',
          rootFolderPath: rootFolder,
          genres: albumInfo.artist.genres || [],
          cleanName: albumInfo.artist.cleanName,
          sortName: albumInfo.artist.sortName,
          tags,
          added: albumInfo.artist.added || new Date().toISOString(),
          ratings: albumInfo.artist.ratings,
          id: albumInfo.artist.id,
        },
        images: albumInfo.images || [],
        links: albumInfo.links || [],
        addOptions: {
          searchForNewAlbum: true,
        },
      };

      const result = await lidarr.addAlbum(addAlbumPayload);

      media.externalServiceId = result.id;
      media.externalServiceSlug = result.titleSlug;
      media.serviceId = lidarrSettings.id;
      await mediaRepository.save(media);

      const requestRepository = getRepository(MediaRequest);
      entity.status = MediaRequestStatus.COMPLETED;
      await requestRepository.save(entity);

      logger.info('Sent request to Lidarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
      });
    } catch (e) {
      const requestRepository = getRepository(MediaRequest);
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      entity.status = MediaRequestStatus.FAILED;
      await requestRepository.save(entity);

      logger.warn('Something went wrong sending album request to Lidarr', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });

      if (media) {
        await MediaRequest.sendNotification(
          entity,
          media,
          Notification.MEDIA_FAILED
        );
      }
    }
  }

  public async sendToReadarr(
    entity: MediaRequest
  ): Promise<number | undefined> {
    if (entity.type !== MediaType.BOOK) {
      return;
    }

    if (
      entity.status !== MediaRequestStatus.APPROVED &&
      entity.status !== MediaRequestStatus.FAILED
    ) {
      return;
    }

    const activeDispatch = activeReadarrDispatches.get(entity.id);
    if (activeDispatch) {
      return activeDispatch;
    }

    const dispatch = this.dispatchReadarrRequest(entity);
    const trackedDispatch = dispatch.finally(() => {
      if (activeReadarrDispatches.get(entity.id) === trackedDispatch) {
        activeReadarrDispatches.delete(entity.id);
      }
    });
    activeReadarrDispatches.set(entity.id, trackedDispatch);

    return trackedDispatch;
  }

  private async dispatchReadarrRequest(
    entity: MediaRequest
  ): Promise<number | undefined> {
    try {
      const mediaRepository = getRepository(Media);
      const settings = getExternalRuntimeConfig();

      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });

      if (!media) {
        throw new Error('Book media data not found');
      }

      const requestedBookFormat = entity.bookFormat ?? 'ebook';
      const bookFormatAlreadyAvailable =
        media.status === MediaStatus.AVAILABLE &&
        (requestedBookFormat === 'audiobook'
          ? media.audiobookServiceId !== null &&
            media.audiobookExternalServiceId !== null
          : media.serviceId !== null && media.externalServiceId !== null);

      if (requestedBookFormat !== 'both' && bookFormatAlreadyAvailable) {
        logger.warn('Book already exists, marking request as COMPLETED', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });

        const requestRepository = getRepository(MediaRequest);
        entity.status = MediaRequestStatus.COMPLETED;
        await requestRepository.save(entity);
        return;
      }

      const openLibraryId = media.identifiers?.find(
        (identifier) =>
          identifier.provider === MediaIdentifierProvider.OPENLIBRARY
      )?.value;
      const isbn = media.identifiers?.find(
        (identifier) => identifier.provider === MediaIdentifierProvider.ISBN
      )?.value;

      if (!openLibraryId && !isbn) {
        throw new Error('Book request is missing lookup identifiers');
      }

      const normalizedOpenLibraryId = openLibraryId
        ? normalizeOpenLibraryWorkId(openLibraryId)
        : undefined;
      const openLibrary = new OpenLibraryAPI();
      const work = normalizedOpenLibraryId
        ? await openLibrary.getWork(normalizedOpenLibraryId)
        : undefined;
      const lookupTerms = [
        isbn,
        isbn ? `isbn:${isbn}` : undefined,
        work?.title,
      ].filter(
        (term, index, terms): term is string =>
          !!term && terms.indexOf(term) === index
      );

      if (!lookupTerms.length) {
        throw new Error('Book request is missing a Readarr lookup term');
      }

      const getExpandedLookupTerms = async () => {
        if (!normalizedOpenLibraryId) {
          return [];
        }

        const wikidata = new WikidataAPI();
        const [editions, author] = await Promise.all([
          openLibrary.getWorkEditions(normalizedOpenLibraryId).catch(() => ({
            size: 0,
            entries: [],
          })),
          work?.authors?.[0]?.author.key
            ? openLibrary
                .getAuthor(
                  normalizeOpenLibraryAuthorId(work.authors[0].author.key)
                )
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
        const wikidataTerms = work?.title
          ? await wikidata
              .getCanonicalBookTerms({
                title: work.title,
                authorName: author?.name,
              })
              .catch((error) => {
                logger.warn(
                  'Wikidata canonical book lookup failed; continuing Bookshelf lookup without translated title terms.',
                  {
                    label: 'Readarr',
                    mediaId: media.id,
                    requestId: entity.id,
                    openLibraryId: normalizedOpenLibraryId,
                    errorMessage:
                      error instanceof Error ? error.message : String(error),
                  }
                );

                return [];
              })
          : [];
        const editionIsbns = editions.entries
          .flatMap((edition) => [
            ...(edition.isbn_13 ?? []),
            ...(edition.isbn_10 ?? []),
          ])
          .map((editionIsbn) => normalizeValidIsbn(editionIsbn))
          .filter((editionIsbn): editionIsbn is string => !!editionIsbn);
        const expandedTerms = [
          work?.title && author?.name
            ? `${work.title} ${author.name}`
            : undefined,
          work?.title && author?.name
            ? `${author.name} ${work.title}`
            : undefined,
          ...wikidataTerms.flatMap((term) => [
            term.title,
            term.authorName ? `${term.title} ${term.authorName}` : undefined,
            term.authorName ? `${term.authorName} ${term.title}` : undefined,
            term.isbn13 ? `isbn:${term.isbn13}` : undefined,
            term.isbn13,
          ]),
          ...editionIsbns.flatMap((editionIsbn) => [
            `isbn:${editionIsbn}`,
            editionIsbn,
          ]),
        ];

        return expandedTerms
          .filter(
            (term, index, terms): term is string =>
              !!term &&
              !lookupTerms.includes(term) &&
              terms.indexOf(term) === index
          )
          .slice(0, READARR_MAX_EXPANDED_LOOKUP_TERMS);
      };
      const identifierRepository = getRepository(MediaIdentifier);
      const normalizedIsbn = normalizeValidIsbn(isbn);
      const existingIdentifierKeys = new Set(
        (media.identifiers ?? []).map(
          (identifier) => `${identifier.provider}:${identifier.value}`
        )
      );
      const getReadarrSettings = (
        serviceType: 'ebook' | 'audiobook',
        allowServerOverride: boolean
      ): ReadarrSettings | undefined => {
        if (
          allowServerOverride &&
          entity.serverId !== null &&
          entity.serverId !== undefined &&
          entity.serverId >= 0
        ) {
          const selectedReadarrSettings = settings.readarr.find(
            (readarr) => readarr.id === entity.serverId
          );

          if (
            selectedReadarrSettings &&
            (selectedReadarrSettings.serviceType ?? 'ebook') !== serviceType
          ) {
            throw new Error(
              `Selected Bookshelf server is not configured for ${serviceType}`
            );
          }

          return selectedReadarrSettings;
        }

        return settings.readarr.find(
          (readarr) =>
            readarr.isDefault &&
            (readarr.serviceType ?? 'ebook') === serviceType
        );
      };
      const dispatchFormat = async (
        serviceType: 'ebook' | 'audiobook',
        allowServerOverride: boolean
      ): Promise<string | undefined> => {
        const readarrSettings = getReadarrSettings(
          serviceType,
          allowServerOverride
        );

        if (!readarrSettings) {
          throw new Error(
            `No default Bookshelf server configured for ${serviceType}`
          );
        }

        const readarr = new ReadarrAPI({
          apiKey: readarrSettings.apiKey,
          url: ReadarrAPI.buildUrl(readarrSettings, '/api/v1'),
        });
        let searchResults: ReadarrBookLookupResult[] = [];
        let lookupTerm: string | undefined;

        const termsToTry = [...lookupTerms];
        let expandedLookupTermsAdded = false;
        let sawIncompleteLookupResult = false;

        for (let index = 0; index < termsToTry.length; index++) {
          const term = termsToTry[index];
          lookupTerm = term;
          searchResults = await lookupReadarrBookWithRetry(readarr, term, {
            mediaId: media.id,
            requestId: entity.id,
            serviceType,
          });
          searchResults = await hydrateSoftcoverLookupResults(
            readarr,
            searchResults,
            normalizedIsbn
          );

          const addableSearchResults = searchResults.filter(
            isAddableReadarrBookLookupResult
          );

          if (addableSearchResults.length) {
            searchResults = addableSearchResults;
            break;
          }

          if (searchResults.length) {
            sawIncompleteLookupResult = true;
            logger.warn(
              'Bookshelf lookup returned incomplete metadata; continuing fallback lookup.',
              {
                label: 'Readarr',
                mediaId: media.id,
                requestId: entity.id,
                serviceType,
                lookupTerm: term,
                resultCount: searchResults.length,
              }
            );
            searchResults = [];
          }

          if (index === termsToTry.length - 1 && !expandedLookupTermsAdded) {
            expandedLookupTermsAdded = true;
            const expandedTerms = await getExpandedLookupTerms();
            termsToTry.push(
              ...expandedTerms.filter((term) => !termsToTry.includes(term))
            );
          }
        }

        if (!searchResults?.length) {
          if (normalizedOpenLibraryId) {
            logger.warn(
              'Bookshelf lookup did not return provider-backed metadata for OpenLibrary work; OpenLibrary ids cannot be used as Bookshelf foreign ids.',
              {
                label: 'Readarr',
                mediaId: media.id,
                requestId: entity.id,
                serviceType,
                openLibraryId: normalizedOpenLibraryId,
                lookupTerms: termsToTry,
              }
            );
          }

          if (sawIncompleteLookupResult) {
            throw new Error(
              `Bookshelf returned incomplete book metadata for ${termsToTry.length} lookup terms. The Bookshelf/Readarr metadata provider may be unavailable.`
            );
          }

          throw new Error(
            `Book not found in Bookshelf search for ${termsToTry.join(', ')}`
          );
        }

        const bookInfo =
          searchResults.find((result) =>
            result.editions?.some(
              (edition) => normalizeValidIsbn(edition.isbn13) === normalizedIsbn
            )
          ) ?? searchResults[0];
        const rootFolder =
          allowServerOverride && entity.rootFolder
            ? entity.rootFolder
            : readarrSettings.activeDirectory;
        const qualityProfile =
          allowServerOverride &&
          entity.profileId !== null &&
          entity.profileId !== undefined
            ? entity.profileId
            : readarrSettings.activeProfileId;
        const metadataProfile =
          allowServerOverride &&
          entity.metadataProfileId !== null &&
          entity.metadataProfileId !== undefined
            ? entity.metadataProfileId
            : (readarrSettings.activeMetadataProfileId ?? 1);
        const tags =
          allowServerOverride && entity.tags
            ? [...entity.tags]
            : [...(readarrSettings.tags ?? [])];

        if (readarrSettings.tagRequests) {
          const readarrTags = await readarr.getTags();
          // old tags had space around the hyphen
          let userTag = readarrTags.find((v) =>
            v.label.startsWith(entity.requestedBy.id + ' - ')
          );
          // new tags do not have spaces around the hyphen, since spaces are not allowed anymore
          if (!userTag) {
            userTag = readarrTags.find((v) =>
              v.label.startsWith(entity.requestedBy.id + '-')
            );
          }
          if (!userTag) {
            logger.info(`Requester has no active tag. Creating new`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              newTag:
                entity.requestedBy.id + '-' + entity.requestedBy.displayName,
            });
            userTag = await readarr.createTag({
              label:
                entity.requestedBy.id + '-' + entity.requestedBy.displayName,
            });
          }
          if (userTag.id) {
            if (!tags?.find((v) => v === userTag?.id)) {
              tags?.push(userTag.id);
            }
          } else {
            logger.warn(`Requester has no tag and failed to add one`, {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              userId: entity.requestedBy.id,
              radarrServer:
                readarrSettings.hostname + ':' + readarrSettings.port,
            });
          }
        }

        const result = await readarr.addBook({
          ...bookInfo,
          monitored: true,
          qualityProfileId: qualityProfile,
          metadataProfileId: metadataProfile,
          rootFolderPath: rootFolder,
          tags,
          author: bookInfo.author
            ? {
                ...bookInfo.author,
                rootFolderPath: rootFolder,
                qualityProfileId: qualityProfile,
                metadataProfileId: metadataProfile,
                monitored: true,
                addOptions: {
                  monitor: 'none',
                  searchForMissingBooks: false,
                },
                manualAdd: true,
              }
            : bookInfo.author,
          editions: bookInfo.editions ?? [],
          addOptions: {
            searchForNewBook: true,
          },
        });

        if (serviceType === 'audiobook') {
          media.audiobookExternalServiceId = result.id ?? null;
          media.audiobookExternalServiceSlug =
            result.titleSlug ?? result.foreignBookId;
          media.audiobookServiceId = readarrSettings.id;
        } else {
          media.externalServiceId = result.id ?? null;
          media.externalServiceSlug = result.titleSlug ?? result.foreignBookId;
          media.serviceId = readarrSettings.id;
        }

        await mediaRepository.save(media);

        const resultIsbn = result.editions?.find(
          (edition) => edition.isbn13
        )?.isbn13;
        const normalizedResultIsbn = normalizeValidIsbn(resultIsbn);
        const identifierCandidates = [
          (result.foreignBookId ?? bookInfo.foreignBookId)
            ? {
                provider: MediaIdentifierProvider.READARR,
                value: result.foreignBookId ?? bookInfo.foreignBookId,
              }
            : undefined,
          normalizedResultIsbn
            ? {
                provider: MediaIdentifierProvider.ISBN,
                value: normalizedResultIsbn,
              }
            : undefined,
        ].filter(
          (
            identifier
          ): identifier is {
            provider: MediaIdentifierProvider;
            value: string;
          } => !!identifier
        );
        const existingCandidateIdentifiers = identifierCandidates.length
          ? await identifierRepository.find({
              where: identifierCandidates.map((identifier) => ({
                provider: identifier.provider,
                value: identifier.value,
              })),
              relations: { media: true },
            })
          : [];
        const existingCandidateKeys = new Set(
          existingCandidateIdentifiers.map(
            (identifier) => `${identifier.provider}:${identifier.value}`
          )
        );
        const identifiersToSave = identifierCandidates.filter((identifier) => {
          const key = `${identifier.provider}:${identifier.value}`;

          return (
            !existingIdentifierKeys.has(key) && !existingCandidateKeys.has(key)
          );
        });

        if (identifiersToSave.length) {
          await identifierRepository.insert(
            identifiersToSave.map(
              (identifier) =>
                ({
                  mediaId: media.id,
                  provider: identifier.provider,
                  value: identifier.value,
                  canonical: false,
                }) as unknown as MediaIdentifier
            )
          );
          identifiersToSave.forEach((identifier) =>
            existingIdentifierKeys.add(
              `${identifier.provider}:${identifier.value}`
            )
          );
        }

        return lookupTerm;
      };

      const targetFormats =
        requestedBookFormat === 'both'
          ? (['ebook', 'audiobook'] as const)
          : requestedBookFormat === 'audiobook'
            ? (['audiobook'] as const)
            : (['ebook'] as const);
      let lookupTerm: string | undefined;

      for (const serviceType of targetFormats) {
        if (
          serviceType === 'ebook' &&
          media.serviceId !== null &&
          media.externalServiceId !== null
        ) {
          continue;
        }

        if (
          serviceType === 'audiobook' &&
          media.audiobookServiceId !== null &&
          media.audiobookExternalServiceId !== null
        ) {
          continue;
        }

        lookupTerm = await dispatchFormat(
          serviceType,
          requestedBookFormat !== 'both' || serviceType === 'ebook'
        );
      }

      const requestRepository = getRepository(MediaRequest);
      entity.status = MediaRequestStatus.COMPLETED;
      await requestRepository.save(entity);

      logger.info('Sent request to Bookshelf', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        lookupTerm,
        bookFormat: requestedBookFormat,
      });
    } catch (e) {
      if (isTransientExternalError(e)) {
        return this.getReadarrDispatchRetryDelay(entity, e);
      }

      const wasAlreadyFailed = entity.status === MediaRequestStatus.FAILED;
      const requestRepository = getRepository(MediaRequest);
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      if (!wasAlreadyFailed) {
        entity.status = MediaRequestStatus.FAILED;
        await requestRepository.save(entity);
      }

      logger.warn(
        'Something went wrong sending book request to Bookshelf; retaining the failed request in the durable dispatch queue.',
        {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
          retryAfterMs: READARR_FAILED_RETRY_DELAY_MS,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );

      if (media && !wasAlreadyFailed) {
        await MediaRequest.sendNotification(
          entity,
          media,
          Notification.MEDIA_FAILED
        );
      }

      return READARR_FAILED_RETRY_DELAY_MS;
    }
  }

  public async updateParentStatus(
    manager: EntityManager,
    entity: MediaRequest
  ): Promise<void> {
    const mediaRepository = manager.getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: entity.media.id },
    });
    if (!media) {
      logger.error('Media data not found', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
      });
      return;
    }

    const statusKey = entity.is4k ? 'status4k' : 'status';
    const seasonRequestRepository = manager.getRepository(SeasonRequest);
    const requestRepository = manager.getRepository(MediaRequest);

    if (
      entity.status === MediaRequestStatus.APPROVED &&
      // Do not update the status if the item is already partially available or available
      media[statusKey] !== MediaStatus.AVAILABLE &&
      media[statusKey] !== MediaStatus.PARTIALLY_AVAILABLE &&
      media[statusKey] !== MediaStatus.PROCESSING
    ) {
      media[statusKey] = MediaStatus.PROCESSING;
      await mediaRepository.save(media);
    }

    if (
      media.mediaType !== MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] !== MediaStatus.AVAILABLE &&
      media[statusKey] !== MediaStatus.DELETED
    ) {
      const hasOtherActiveRequest = await requestRepository.exists({
        where: {
          media: { id: media.id },
          status: Not(
            In([
              MediaRequestStatus.DECLINED,
              MediaRequestStatus.FAILED,
              MediaRequestStatus.COMPLETED,
            ])
          ),
          is4k: entity.is4k,
          id: Not(entity.id),
        },
      });

      if (!hasOtherActiveRequest) {
        media[statusKey] =
          media.mediaType === MediaType.BOOK
            ? this.getBookStatusFromLinks(media)
            : MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
      }
    }

    /**
     * If the media type is TV, and we are declining a request,
     * we must check if its the only pending request and that
     * there the current media status is just pending (meaning no
     * other requests have yet to be approved)
     */
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] === MediaStatus.PENDING
    ) {
      const pendingCount = await requestRepository.count({
        where: {
          media: { id: media.id },
          status: MediaRequestStatus.PENDING,
          is4k: entity.is4k,
          id: Not(entity.id),
        },
      });

      if (pendingCount === 0) {
        // Re-fetch media without requests to avoid cascade issues
        const freshMedia = await mediaRepository.findOne({
          where: { id: media.id },
        });
        if (freshMedia) {
          freshMedia[statusKey] = MediaStatus.UNKNOWN;
          await mediaRepository.save(freshMedia);
        }
      }
    }

    // Reset season statuses when a TV request is declined
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED
    ) {
      const seasonRepository = manager.getRepository(Season);
      const actualSeasons = await seasonRepository.find({
        where: { media: { id: media.id } },
      });

      for (const seasonRequest of entity.seasons) {
        seasonRequest.status = MediaRequestStatus.DECLINED;
        await seasonRequestRepository.save(seasonRequest);

        const season = actualSeasons.find(
          (s) => s.seasonNumber === seasonRequest.seasonNumber
        );

        if (season && season[statusKey] === MediaStatus.PENDING) {
          const otherActiveRequests = await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.seasons', 'season')
            .where('request.mediaId = :mediaId', { mediaId: media.id })
            .andWhere('request.id != :requestId', { requestId: entity.id })
            .andWhere('request.is4k = :is4k', { is4k: entity.is4k })
            .andWhere('request.status NOT IN (:...statuses)', {
              statuses: [
                MediaRequestStatus.DECLINED,
                MediaRequestStatus.FAILED,
                MediaRequestStatus.COMPLETED,
              ],
            })
            .andWhere('season.seasonNumber = :seasonNumber', {
              seasonNumber: season.seasonNumber,
            })
            .getCount();

          if (otherActiveRequests === 0) {
            season[statusKey] = MediaStatus.UNKNOWN;
            await seasonRepository.save(season);
          }
        }
      }
    }

    // Approve child seasons if parent is approved
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.APPROVED
    ) {
      for (const season of entity.seasons) {
        season.status = MediaRequestStatus.APPROVED;
        await seasonRequestRepository.save(season);
      }
    }
  }

  public async handleRemoveParentUpdate(
    manager: EntityManager,
    entity: MediaRequest
  ): Promise<void> {
    const media = await manager.findOneOrFail(Media, {
      where: { id: entity.media.id },
    });
    const activeRequestWhere = {
      media: { id: media.id },
      status: Not(
        In([
          MediaRequestStatus.DECLINED,
          MediaRequestStatus.FAILED,
          MediaRequestStatus.COMPLETED,
        ])
      ),
    };
    const requestRepository = manager.getRepository(MediaRequest);

    if (
      media.mediaType === MediaType.MUSIC ||
      media.mediaType === MediaType.BOOK
    ) {
      const hasActiveRequests = await requestRepository.exists({
        where: activeRequestWhere,
      });

      if (
        !hasActiveRequests &&
        media.status !== MediaStatus.AVAILABLE &&
        media.status !== MediaStatus.DELETED
      ) {
        media.status =
          media.mediaType === MediaType.BOOK
            ? this.getBookStatusFromLinks(media)
            : MediaStatus.UNKNOWN;

        await manager.save(media);
      }

      return;
    }

    const [hasActiveStandardRequests, hasActive4kRequests] = await Promise.all([
      requestRepository.exists({
        where: { ...activeRequestWhere, is4k: false },
      }),
      requestRepository.exists({
        where: { ...activeRequestWhere, is4k: true },
      }),
    ]);
    const needsStatusUpdate =
      !hasActiveStandardRequests &&
      media.status !== MediaStatus.AVAILABLE &&
      media.status !== MediaStatus.DELETED;
    const needs4kStatusUpdate =
      !hasActive4kRequests &&
      media.status4k !== MediaStatus.AVAILABLE &&
      media.status4k !== MediaStatus.DELETED;

    if (needsStatusUpdate || needs4kStatusUpdate) {
      if (needsStatusUpdate) {
        media.status = MediaStatus.UNKNOWN;
      }
      if (needs4kStatusUpdate) {
        media.status4k = MediaStatus.UNKNOWN;
      }

      await manager.save(media);
    }
  }

  public async afterUpdate(event: UpdateEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    await this.enqueueUpdatedRequestNotification(
      event.entity as MediaRequest,
      event
    );
    await this.enqueueRequestDispatch(event.entity as MediaRequest, event);

    if (
      !Number.isSafeInteger((event.entity as MediaRequest).id) ||
      !(event.entity as MediaRequest).media
    ) {
      return;
    }

    await this.updateParentStatus(
      event.manager as EntityManager,
      event.entity as MediaRequest
    );
  }

  public async afterInsert(event: InsertEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    await this.enqueueInsertedRequestNotifications(
      event.entity as MediaRequest,
      event
    );
    await this.enqueueRequestDispatch(event.entity as MediaRequest, event);

    await this.updateParentStatus(
      event.manager as EntityManager,
      event.entity as MediaRequest
    );
  }

  public async afterRemove(event: RemoveEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    await this.handleRemoveParentUpdate(
      event.manager as EntityManager,
      event.entity as MediaRequest
    );
  }

  public afterTransactionCommit(event: TransactionCommitEvent): void {
    notificationManager.commitDeferredNotifications(event.queryRunner);
    requestDispatchManager.commit(event.queryRunner);
  }

  public afterTransactionRollback(event: TransactionRollbackEvent): void {
    notificationManager.rollbackDeferredNotifications(event.queryRunner);
    requestDispatchManager.rollback(event.queryRunner);
  }

  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
