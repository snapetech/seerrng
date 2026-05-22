import ListenBrainzAPI from '@server/api/listenbrainz';
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
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { normalizeValidIsbn } from '@server/lib/isbn';
import notificationManager, { Notification } from '@server/lib/notifications';
import { getSettings, type ReadarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isEqual, truncate } from 'lodash';
import type {
  EntityManager,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
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
const READARR_DISPATCH_RETRY_DELAYS_MS =
  process.env.NODE_ENV === 'test'
    ? [1, 1, 1]
    : [300_000, 900_000, 1_800_000, 3_600_000];
const READARR_MAX_EXPANDED_LOOKUP_TERMS = 18;
const READARR_APPROVED_RETRY_BATCH_SIZE = 1;
const readarrDispatchRetryTimers = new Map<
  number,
  { attempts: number; timer: NodeJS.Timeout }
>();

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

const clearReadarrDispatchRetry = (requestId: number): void => {
  const pendingRetry = readarrDispatchRetryTimers.get(requestId);

  if (pendingRetry) {
    clearTimeout(pendingRetry.timer);
    readarrDispatchRetryTimers.delete(requestId);
  }
};

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
  const authorCache = new Map<string, ReadarrBookLookupResult['author']>();

  return Promise.all(
    results.map(async (result) => {
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

      let author = authorCache.get(authorName);

      if (!author) {
        const [authorResult] = await readarr.lookupAuthor(authorName);

        if (!authorResult?.foreignAuthorId || !authorResult.authorName) {
          return result;
        }

        author = {
          foreignAuthorId: authorResult.foreignAuthorId,
          authorName: authorResult.authorName,
          id: authorResult.id,
        };
        authorCache.set(authorName, author);
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
    })
  );
};

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  private scheduleReadarrDispatchRetry(
    entity: MediaRequest,
    error: unknown
  ): void {
    const existingRetry = readarrDispatchRetryTimers.get(entity.id);
    const attempts = existingRetry ? existingRetry.attempts + 1 : 1;
    const delayMs =
      getRetryAfterMs(error) ??
      READARR_DISPATCH_RETRY_DELAYS_MS[
        Math.min(attempts - 1, READARR_DISPATCH_RETRY_DELAYS_MS.length - 1)
      ];

    if (existingRetry) {
      clearTimeout(existingRetry.timer);
    }

    const timer = setTimeout(() => {
      readarrDispatchRetryTimers.delete(entity.id);

      getRepository(MediaRequest)
        .findOne({
          where: {
            id: entity.id,
            type: MediaType.BOOK,
            status: MediaRequestStatus.APPROVED,
          },
        })
        .then(async (request) => {
          if (!request) {
            return;
          }

          await this.sendToReadarr(request);
        })
        .catch((retryError) => {
          logger.error('Error retrying Bookshelf request dispatch', {
            label: 'Media Request',
            requestId: entity.id,
            errorMessage:
              retryError instanceof Error
                ? retryError.message
                : String(retryError),
          });
        });
    }, delayMs);

    readarrDispatchRetryTimers.set(entity.id, { attempts, timer });

    logger.warn(
      'Bookshelf request hit a transient metadata limit; leaving request approved for retry.',
      {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        attempt: attempts,
        retryInMs: delayMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    );
  }

  public async retryApprovedReadarrRequests(
    limit = READARR_APPROVED_RETRY_BATCH_SIZE
  ): Promise<void> {
    const requestRepository = getRepository(MediaRequest);
    const requests = await requestRepository.find({
      where: {
        type: MediaType.BOOK,
        status: MediaRequestStatus.APPROVED,
      },
      order: { updatedAt: 'ASC' },
      take: limit,
    });

    for (const request of requests) {
      if (readarrDispatchRetryTimers.has(request.id)) {
        continue;
      }

      await this.sendToReadarr(request);
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

  private async notifyAvailableMovie(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    // Get fresh media state using event manager
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });
    }

    // Check availability using fresh media state
    if (
      !latestMedia ||
      latestMedia[entity.is4k ? 'status4k' : 'status'] !== MediaStatus.AVAILABLE
    ) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const movie = await tmdb.getMovie({
        movieId: entity.media.tmdbId,
      });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: `${entity.is4k ? '4K ' : ''}Movie Request Now Available`,
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`,
        message: truncate(movie.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        media: latestMedia,
        mediaUrl: `/movie/${latestMedia.tmdbId}`,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableSeries(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    // Get fresh media state with seasons using event manager
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }

    if (!latestMedia) {
      return;
    }

    // Check availability using fresh media state
    const requestedSeasons =
      entity.seasons?.map((entitySeason) => entitySeason.seasonNumber) ?? [];
    const availableSeasons = latestMedia.seasons.filter(
      (season) =>
        season[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE &&
        requestedSeasons.includes(season.seasonNumber)
    );
    const isMediaAvailable =
      availableSeasons.length > 0 &&
      availableSeasons.length === requestedSeasons.length;

    if (!isMediaAvailable) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const tv = await tmdb.getTvShow({ tvId: entity.media.tmdbId });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: `${entity.is4k ? '4K ' : ''}Series Request Now Available`,
        subject: `${tv.name}${
          tv.first_air_date ? ` (${tv.first_air_date.slice(0, 4)})` : ''
        }`,
        message: truncate(tv.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
        media: latestMedia,
        mediaUrl: `/tv/${latestMedia.tmdbId}`,
        extra: [
          {
            name: 'Requested Seasons',
            value: entity.seasons
              .map((season) => season.seasonNumber)
              .join(', '),
          },
        ],
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableMusic(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
      });
    }
    if (!latestMedia) {
      latestMedia = await getRepository(Media).findOne({
        where: { id: entity.media.id },
      });
    }

    if (!latestMedia || latestMedia.status !== MediaStatus.AVAILABLE) {
      return;
    }

    const mbId = latestMedia.mbId ?? entity.media.mbId;

    if (!mbId) {
      return;
    }

    try {
      const album = await new ListenBrainzAPI().getAlbum(mbId);
      const releaseGroup = album.release_group_metadata.release_group;
      const artistName = album.release_group_metadata.artist.name;

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Music Request Now Available',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${releaseGroup.name}${
          releaseGroup.date ? ` (${releaseGroup.date.slice(0, 4)})` : ''
        }`,
        message: artistName,
        media: latestMedia,
        mediaUrl: `/music/${mbId}`,
        image: album.caa_release_mbid
          ? `https://coverartarchive.org/release/${album.caa_release_mbid}/front-500`
          : undefined,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending music notification(s)', {
        label: 'Notifications',
        errorMessage: e instanceof Error ? e.message : String(e),
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableBook(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });
    }
    if (!latestMedia) {
      latestMedia = await getRepository(Media).findOne({
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });
    }

    if (!latestMedia || latestMedia.status !== MediaStatus.AVAILABLE) {
      return;
    }

    const openLibraryId = latestMedia.identifiers?.find(
      (identifier) =>
        identifier.provider === MediaIdentifierProvider.OPENLIBRARY
    )?.value;

    if (!openLibraryId) {
      return;
    }

    try {
      const work = await new OpenLibraryAPI().getWork(openLibraryId);
      const description =
        typeof work.description === 'string'
          ? work.description
          : work.description?.value;
      const coverId = work.covers?.[0];

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Book Request Now Available',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${work.title}${
          work.first_publish_date
            ? ` (${work.first_publish_date.match(/\d{4}/)?.[0]})`
            : ''
        }`,
        message: description
          ? truncate(description, {
              length: 500,
              separator: /\s/,
              omission: '…',
            })
          : undefined,
        media: latestMedia,
        mediaUrl: `/book/${openLibraryId}`,
        image: coverId
          ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
          : undefined,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending book notification(s)', {
        label: 'Notifications',
        errorMessage: e instanceof Error ? e.message : String(e),
        mediaId: entity.id,
      });
    }
  }

  public async sendToRadarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.MOVIE
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getSettings();
        if (settings.radarr.length === 0 && !settings.radarr[0]) {
          logger.info(
            'No Radarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
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
          return;
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
          return;
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
          return;
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

        // Run entity asynchronously so we don't wait for it on the UI side
        radarr
          .addMovie(radarrMovieOptions)
          .then(async (radarrMovie) => {
            // We grab media again here to make sure we have the latest version of it
            const media = await mediaRepository.findOne({
              where: { id: entity.media.id },
            });

            if (!media) {
              throw new Error('Media data not found');
            }

            media[entity.is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              radarrMovie.id;
            media[
              entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
            ] = radarrMovie.titleSlug;
            media[entity.is4k ? 'serviceId4k' : 'serviceId'] =
              radarrSettings?.id;
            await mediaRepository.save(media);
          })
          .catch(async () => {
            try {
              const requestRepository = getRepository(MediaRequest);

              if (entity.status !== MediaRequestStatus.FAILED) {
                entity.status = MediaRequestStatus.FAILED;
                await requestRepository.save(entity);
              }
            } catch (saveError) {
              logger.error('Failed to mark request as FAILED', {
                label: 'Media Request',
                requestId: entity.id,
                errorMessage:
                  saveError instanceof Error
                    ? saveError.message
                    : String(saveError),
              });
            }

            logger.warn(
              'Something went wrong sending movie request to Radarr, marking status as FAILED',
              {
                label: 'Media Request',
                requestId: entity.id,
                mediaId: entity.media.id,
                radarrMovieOptions,
              }
            );

            MediaRequest.sendNotification(
              entity,
              media,
              Notification.MEDIA_FAILED
            );
          })
          .finally(() => {
            radarr.clearCache({
              tmdbId: movie.id,
              externalId: entity.is4k
                ? media.externalServiceId4k
                : media.externalServiceId,
            });
          });
        logger.info('Sent request to Radarr', {
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

          MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
      }
    }
  }

  public async sendToSonarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status === MediaRequestStatus.APPROVED &&
      entity.type === MediaType.TV
    ) {
      try {
        const mediaRepository = getRepository(Media);
        const settings = getSettings();
        if (settings.sonarr.length === 0 && !settings.sonarr[0]) {
          logger.warn(
            'No Sonarr server configured, skipping request processing',
            {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
            }
          );
          return;
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
          return;
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
          return;
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

        // Run entity asynchronously so we don't wait for it on the UI side
        sonarr
          .addSeries(sonarrSeriesOptions)
          .then(async (sonarrSeries) => {
            // We grab media again here to make sure we have the latest version of it
            const media = await mediaRepository.findOne({
              where: { id: entity.media.id },
            });

            if (!media) {
              throw new Error('Media data not found');
            }

            media[entity.is4k ? 'externalServiceId4k' : 'externalServiceId'] =
              sonarrSeries.id;
            media[
              entity.is4k ? 'externalServiceSlug4k' : 'externalServiceSlug'
            ] = sonarrSeries.titleSlug;
            media[entity.is4k ? 'serviceId4k' : 'serviceId'] =
              sonarrSettings?.id;
            await mediaRepository.save(media);
          })
          .catch(async () => {
            try {
              const requestRepository = getRepository(MediaRequest);

              if (entity.status !== MediaRequestStatus.FAILED) {
                entity.status = MediaRequestStatus.FAILED;
                await requestRepository.save(entity);
              }
            } catch (saveError) {
              logger.error('Failed to mark request as FAILED', {
                label: 'Media Request',
                requestId: entity.id,
                errorMessage:
                  saveError instanceof Error
                    ? saveError.message
                    : String(saveError),
              });
            }

            logger.warn(
              'Something went wrong sending series request to Sonarr, marking status as FAILED',
              {
                label: 'Media Request',
                requestId: entity.id,
                mediaId: entity.media.id,
                sonarrSeriesOptions,
              }
            );

            MediaRequest.sendNotification(
              entity,
              media,
              Notification.MEDIA_FAILED
            );
          })
          .finally(() => {
            sonarr.clearCache({
              tvdbId,
              externalId: entity.is4k
                ? media.externalServiceId4k
                : media.externalServiceId,
              title: series.name,
            });
          });
        logger.info('Sent request to Sonarr', {
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

          MediaRequest.sendNotification(
            entity,
            media,
            Notification.MEDIA_FAILED
          );
        }
      }
    }
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
      const settings = getSettings();

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

      const searchResults = await lidarr.searchAlbumByMusicBrainzId(media.mbId);

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
        MediaRequest.sendNotification(entity, media, Notification.MEDIA_FAILED);
      }
    }
  }

  public async sendToReadarr(entity: MediaRequest): Promise<void> {
    if (
      entity.status !== MediaRequestStatus.APPROVED ||
      entity.type !== MediaType.BOOK
    ) {
      return;
    }

    try {
      const mediaRepository = getRepository(Media);
      const settings = getSettings();

      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { identifiers: true },
      });

      if (!media) {
        logger.error('Book media data not found', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
        });
        return;
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

      const openLibrary = new OpenLibraryAPI();
      const work = openLibraryId
        ? await openLibrary.getWork(openLibraryId)
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
        if (!openLibraryId) {
          return [];
        }

        const [editions, author] = await Promise.all([
          openLibrary.getWorkEditions(openLibraryId).catch(() => ({
            size: 0,
            entries: [],
          })),
          work?.authors?.[0]?.author.key
            ? openLibrary
                .getAuthor(
                  work.authors[0].author.key.replace(/^\/?authors\//, '')
                )
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
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
      clearReadarrDispatchRetry(entity.id);
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
        this.scheduleReadarrDispatchRetry(entity, e);
        return;
      }

      const requestRepository = getRepository(MediaRequest);
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });

      clearReadarrDispatchRetry(entity.id);
      entity.status = MediaRequestStatus.FAILED;
      await requestRepository.save(entity);

      logger.warn('Something went wrong sending book request to Bookshelf', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });

      if (media) {
        MediaRequest.sendNotification(entity, media, Notification.MEDIA_FAILED);
      }
    }
  }

  public async updateParentStatus(entity: MediaRequest): Promise<void> {
    const mediaRepository = getRepository(Media);
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
    const seasonRequestRepository = getRepository(SeasonRequest);
    const requestRepository = getRepository(MediaRequest);

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
      (media.mediaType === MediaType.MOVIE ||
        media.mediaType === MediaType.BOOK) &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] !== MediaStatus.DELETED
    ) {
      media[statusKey] = MediaStatus.UNKNOWN;
      await mediaRepository.save(media);
    }

    if (
      (media.mediaType === MediaType.MUSIC ||
        media.mediaType === MediaType.BOOK) &&
      entity.status === MediaRequestStatus.DECLINED &&
      media.status !== MediaStatus.DELETED
    ) {
      const activeCount = await requestRepository.count({
        where: {
          media: { id: media.id },
          status: In([
            MediaRequestStatus.PENDING,
            MediaRequestStatus.APPROVED,
            MediaRequestStatus.FAILED,
          ]),
          id: Not(entity.id),
        },
      });

      if (activeCount === 0) {
        media.status =
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
      const seasonRepository = getRepository(Season);
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
    const fullMedia = await manager.findOneOrFail(Media, {
      where: { id: entity.media.id },
      relations: { requests: true },
    });

    if (
      fullMedia.mediaType === MediaType.MUSIC ||
      fullMedia.mediaType === MediaType.BOOK
    ) {
      const hasActiveRequests = fullMedia.requests.some((request) =>
        [
          MediaRequestStatus.PENDING,
          MediaRequestStatus.APPROVED,
          MediaRequestStatus.FAILED,
        ].includes(request.status)
      );

      if (!hasActiveRequests && fullMedia.status !== MediaStatus.DELETED) {
        const cleanMedia = await manager.findOneOrFail(Media, {
          where: { id: entity.media.id },
        });

        cleanMedia.status =
          fullMedia.mediaType === MediaType.BOOK
            ? this.getBookStatusFromLinks(cleanMedia)
            : MediaStatus.UNKNOWN;

        await manager.save(cleanMedia);
      }

      return;
    }

    const needsStatusUpdate =
      !fullMedia.requests.some((request) => !request.is4k) &&
      fullMedia.status !== MediaStatus.AVAILABLE;

    const needs4kStatusUpdate =
      !fullMedia.requests.some((request) => request.is4k) &&
      fullMedia.status4k !== MediaStatus.AVAILABLE;

    if (needsStatusUpdate || needs4kStatusUpdate) {
      // Re-fetch WITHOUT requests to avoid cascade issues on save
      const cleanMedia = await manager.findOneOrFail(Media, {
        where: { id: entity.media.id },
      });

      if (needsStatusUpdate) {
        cleanMedia.status = MediaStatus.UNKNOWN;
      }
      if (needs4kStatusUpdate) {
        cleanMedia.status4k = MediaStatus.UNKNOWN;
      }

      await manager.save(cleanMedia);
    }
  }

  public async afterUpdate(event: UpdateEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToRadarr(event.entity as MediaRequest);
      await this.sendToSonarr(event.entity as MediaRequest);
      await this.sendToLidarr(event.entity as MediaRequest);
      await this.sendToReadarr(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to *arr in afterUpdate subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);

      if (event.entity.status === MediaRequestStatus.COMPLETED) {
        if (event.entity.media.mediaType === MediaType.MOVIE) {
          await this.notifyAvailableMovie(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.TV) {
          await this.notifyAvailableSeries(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.MUSIC) {
          await this.notifyAvailableMusic(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.BOOK) {
          await this.notifyAvailableBook(event.entity as MediaRequest, event);
        }
      }
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterUpdate subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public async afterInsert(event: InsertEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToRadarr(event.entity as MediaRequest);
      await this.sendToSonarr(event.entity as MediaRequest);
      await this.sendToLidarr(event.entity as MediaRequest);
      await this.sendToReadarr(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to *arr in afterInsert subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterInsert subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
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

  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
