import BackIssueAPI from '@server/api/comics/backissue';
import KapowarrAPI, {
  KapowarrTaskRunningError,
} from '@server/api/comics/kapowarr';
import MylarAPI from '@server/api/comics/mylar';
import JellystatAPI from '@server/api/jellystat';
import LazyLibrarianAPI from '@server/api/lazylibrarian';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI, { isTautulliNoDataError } from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import type { MediaCategoryKey } from '@server/constants/mediaCategories';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import type {
  MediaListItem,
  MediaResultsResponse,
  MediaWatchDataResponse,
} from '@server/interfaces/api/mediaInterfaces';
import { runWithConfigurationAdmission } from '@server/lib/configurationAdmission';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  executeLibraryRemoval,
  libraryServiceType,
  resolveLibraryRemoval,
} from '@server/lib/libraryRemoval';
import { areMediaCategoriesEnabled } from '@server/lib/mediaCategories';
import { runMediaEntityMutation } from '@server/lib/mediaMutation';
import { Permission } from '@server/lib/permissions';
import {
  runWithServarrServiceAdmission,
  runWithServarrServiceCollectionMutationAdmission,
} from '@server/lib/serviceAdmission';
import { getSettings } from '@server/lib/settings';
import {
  UserMutationActorUnauthorizedError,
  runAuthorizedUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import {
  authorizedMutation,
  authorizedRouteAccess,
} from '@server/middleware/authorizedMutation';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePageParams } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalNonNegativeInteger,
  parseOptionalQueryBoolean,
} from '@server/utils/validation';
import { Router } from 'express';
import type { FindOneOptions, FindOptionsWhere } from 'typeorm';
import { EntityNotFoundError, In, IsNull, Not } from 'typeorm';

const mediaRoutes = Router();
const maxMediaId = 1_000_000_000;
const maxSeasonCount = 500;
const maxSeasonNumber = 10_000;
export const MAX_TAUTULLI_WATCH_USER_IDS = 500;
const MAX_PLEX_USER_ID = 2_147_483_647;
const mediaListFilters = [
  'available',
  'partial',
  'allavailable',
  'processing',
  'pending',
] as const;
const mediaListSorts = ['modified', 'mediaAdded'] as const;
const mediaListTypes: MediaType[] = [
  MediaType.MOVIE,
  MediaType.TV,
  MediaType.MUSIC,
  MediaType.BOOK,
  MediaType.COMIC,
  MediaType.MAGAZINE,
  MediaType.SPORTS,
];
const mediaFileFormats = ['ebook', 'audiobook', 'both'] as const;
const mediaListPermissions: Permission[] = [
  Permission.MANAGE_REQUESTS,
  Permission.RECENT_VIEW,
];
const mediaTypeCategories: Record<
  MediaType,
  { categories: MediaCategoryKey[]; mode?: 'all' | 'any' }
> = {
  [MediaType.MOVIE]: { categories: ['movie'] },
  [MediaType.TV]: { categories: ['tv'] },
  [MediaType.MUSIC]: { categories: ['music'] },
  [MediaType.BOOK]: { categories: ['ebook', 'audiobook'], mode: 'any' },
  [MediaType.COMIC]: { categories: ['comic'] },
  [MediaType.MAGAZINE]: { categories: ['magazine'] },
  [MediaType.SPORTS]: { categories: ['sports'] },
};
const isMediaTypeCategoryEnabled = (mediaType: MediaType): boolean => {
  const config = mediaTypeCategories[mediaType];
  return config
    ? areMediaCategoriesEnabled(config.categories, config.mode ?? 'all')
    : true;
};
const areAllMediaTypeCategoriesEnabled = (mediaType: MediaType): boolean => {
  const config = mediaTypeCategories[mediaType];
  return config ? areMediaCategoriesEnabled(config.categories) : true;
};

const projectMediaListItem = (media: Media): MediaListItem => ({
  id: media.id,
  mediaType: media.mediaType,
  tmdbId: media.tmdbId,
  status: media.status,
  status4k: media.status4k,
  ...(media.tvdbId != null ? { tvdbId: media.tvdbId } : {}),
  ...(media.imdbId != null ? { imdbId: media.imdbId } : {}),
  ...(media.mbId != null ? { mbId: media.mbId } : {}),
  ...(media.mediaAddedAt != null ? { mediaAddedAt: media.mediaAddedAt } : {}),
  ...(media.searchMetadata?.title ? { title: media.searchMetadata.title } : {}),
  ...(media.searchMetadata?.overview
    ? { overview: media.searchMetadata.overview }
    : {}),
  ...(media.searchMetadata?.posterPath
    ? { posterPath: media.searchMetadata.posterPath }
    : {}),
  ...(media.searchMetadata?.releaseDate
    ? { releaseDate: media.searchMetadata.releaseDate }
    : {}),
});

export const parseTautulliPlexUserIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = new Set<number>();
  for (const item of value) {
    const rawId =
      item && typeof item === 'object' && 'user_id' in item
        ? (item as { user_id?: unknown }).user_id
        : undefined;
    const id =
      typeof rawId === 'number'
        ? rawId
        : typeof rawId === 'string' && /^\d+$/.test(rawId)
          ? Number(rawId)
          : undefined;
    if (
      typeof id === 'number' &&
      Number.isSafeInteger(id) &&
      id > 0 &&
      id <= MAX_PLEX_USER_ID
    ) {
      ids.add(id);
    }
    if (ids.size >= MAX_TAUTULLI_WATCH_USER_IDS) {
      break;
    }
  }

  return [...ids];
};

const parseMediaRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxMediaId);

const mediaStatusActions = [
  'available',
  'partial',
  'processing',
  'pending',
  'unknown',
] as const;
type MediaStatusAction = (typeof mediaStatusActions)[number];

const parseMediaStatusAction = (
  status: unknown
): MediaStatusAction | undefined =>
  typeof status === 'string' &&
  mediaStatusActions.includes(status as MediaStatusAction)
    ? (status as MediaStatusAction)
    : undefined;

const parseMediaTypes = (
  value: unknown
): { value?: MediaType[] } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (Array.isArray(value)) {
    return { error: 'Media type must be a string.' };
  }

  if (typeof value !== 'string') {
    return { error: 'Media type must be a string.' };
  }

  const types = value
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);

  if (!types.length) {
    return {};
  }

  const invalidType = types.find(
    (type): type is string => !mediaListTypes.includes(type as MediaType)
  );

  if (invalidType) {
    return { error: 'Media type must be valid.' };
  }

  return { value: [...new Set(types)] as MediaType[] };
};

const parseSeasonStatusUpdates = (
  seasons: unknown
): { seasons: { seasonNumber: number }[] } | { error: string } => {
  if (seasons === undefined || seasons === null) {
    return { seasons: [] };
  }

  if (!Array.isArray(seasons)) {
    return { error: 'seasons must be an array.' };
  }

  if (seasons.length > maxSeasonCount) {
    return { error: `seasons are limited to ${maxSeasonCount} values.` };
  }

  const parsedSeasons: { seasonNumber: number }[] = [];

  for (const season of seasons) {
    if (season === null || typeof season !== 'object') {
      return { error: 'seasons must contain season objects.' };
    }

    const seasonNumber = parseOptionalNonNegativeInteger(
      (season as { seasonNumber?: unknown }).seasonNumber,
      maxSeasonNumber
    );

    if (seasonNumber === undefined) {
      return {
        error: `seasonNumber must be an integer no greater than ${maxSeasonNumber}.`,
      };
    }

    if (!parsedSeasons.some((s) => s.seasonNumber === seasonNumber)) {
      parsedSeasons.push({ seasonNumber });
    }
  }

  return { seasons: parsedSeasons };
};

const parseOptionalMediaStatusBody = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (body === undefined || body === null) {
    return { value: {} };
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Media status body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

mediaRoutes.get(
  '/',
  isAuthenticated(mediaListPermissions, { type: 'or' }),
  authorizedRouteAccess(mediaListPermissions),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);

    const { pageSize, skip } = parsePageParams(req.query, {
      take: 20,
      maxTake: 100,
    });
    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: mediaListFilters,
      maxLength: 32,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }
    const parsedSort = parseOptionalAllowedString(req.query.sort, {
      fieldName: 'Sort',
      allowedValues: mediaListSorts,
      maxLength: 32,
    });
    if ('error' in parsedSort) {
      return next({ status: 400, message: parsedSort.error });
    }
    const parsedMediaTypes = parseMediaTypes(req.query.mediaType);
    if ('error' in parsedMediaTypes) {
      return next({ status: 400, message: parsedMediaTypes.error });
    }
    if (
      parsedMediaTypes.value?.some((type) => !isMediaTypeCategoryEnabled(type))
    ) {
      return res.status(404).json({ status: 404, message: 'Not found.' });
    }
    const enabledMediaTypes = mediaListTypes.filter(isMediaTypeCategoryEnabled);
    const filter = parsedFilter.value;
    const sort = parsedSort.value;

    if (
      !req.user?.hasPermission(Permission.MANAGE_REQUESTS) &&
      (filter !== 'allavailable' || sort !== 'mediaAdded')
    ) {
      return next({
        status: 403,
        message: 'Recent-media access only permits the recently added view.',
      });
    }

    let statusFilter = undefined;

    switch (filter) {
      case 'available':
        statusFilter = MediaStatus.AVAILABLE;
        break;
      case 'partial':
        statusFilter = MediaStatus.PARTIALLY_AVAILABLE;
        break;
      case 'allavailable':
        statusFilter = In([
          MediaStatus.AVAILABLE,
          MediaStatus.PARTIALLY_AVAILABLE,
        ]);
        break;
      case 'processing':
        statusFilter = MediaStatus.PROCESSING;
        break;
      case 'pending':
        statusFilter = MediaStatus.PENDING;
        break;
    }

    let sortFilter: FindOneOptions<Media>['order'] = {
      id: 'DESC',
    };

    switch (sort) {
      case 'modified':
        sortFilter = {
          updatedAt: 'DESC',
        };
        break;
      case 'mediaAdded':
        sortFilter = {
          mediaAddedAt: 'DESC',
        };
    }

    let whereClause: FindOptionsWhere<Media> | undefined;
    if (statusFilter || sort === 'mediaAdded') {
      whereClause = {};
      if (statusFilter) whereClause.status = statusFilter;
      if (sort === 'mediaAdded') whereClause.mediaAddedAt = Not(IsNull());
    }
    if (parsedMediaTypes.value?.length) {
      whereClause = whereClause ?? {};
      whereClause.mediaType =
        parsedMediaTypes.value.length === 1
          ? parsedMediaTypes.value[0]
          : In(parsedMediaTypes.value);
    } else if (enabledMediaTypes.length < mediaListTypes.length) {
      if (enabledMediaTypes.length === 0) {
        return res.status(200).json({
          pageInfo: {
            pages: 0,
            pageSize,
            results: 0,
            page: 1,
          },
          results: [],
        } as MediaResultsResponse);
      }
      whereClause = whereClause ?? {};
      whereClause.mediaType = In(enabledMediaTypes);
    }

    try {
      const [media, mediaCount] = await mediaRepository.findAndCount({
        order: sortFilter,
        where: whereClause,
        relations: { searchMetadata: true },
        take: pageSize,
        skip,
      });
      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(mediaCount / pageSize),
          pageSize,
          results: mediaCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: media.map(projectMediaListItem),
      } as MediaResultsResponse);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

mediaRoutes.post<
  {
    id: string;
    status: 'available' | 'partial' | 'processing' | 'pending' | 'unknown';
  },
  Media
>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);
    const seasonRepository = getRepository(Season);
    const mediaId = parseMediaRouteId(req.params.id);
    if (!mediaId) {
      return next({ status: 404, message: 'Media does not exist.' });
    }
    const statusAction = parseMediaStatusAction(req.params.status);
    if (!statusAction) {
      return next({ status: 404, message: 'Media status does not exist.' });
    }

    const parsedBody = parseOptionalMediaStatusBody(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const body = parsedBody.value;

    const parsedIs4k = parseOptionalBodyBoolean(body.is4k, 'is4k');
    if ('error' in parsedIs4k) {
      return next({ status: 400, message: parsedIs4k.error });
    }
    const is4k = parsedIs4k.value ?? false;

    const initialMedia = await mediaRepository.findOne({
      where: { id: mediaId },
      relations: { identifiers: true },
    });
    if (!initialMedia || !isMediaTypeCategoryEnabled(initialMedia.mediaType)) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      return await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_REQUESTS,
        () =>
          runMediaEntityMutation(initialMedia, async () => {
            const media = await mediaRepository.findOne({
              where: { id: mediaId },
            });

            if (!media) {
              return next({ status: 404, message: 'Media does not exist.' });
            }

            switch (statusAction) {
              case 'available':
                media[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;

                if (media.mediaType === MediaType.TV) {
                  const expectedSeasons = parseSeasonStatusUpdates(
                    body.seasons
                  );
                  if ('error' in expectedSeasons) {
                    return next({
                      status: 400,
                      message: expectedSeasons.error,
                    });
                  }

                  for (const expectedSeason of expectedSeasons.seasons) {
                    let season = media.seasons.find(
                      (s) => s.seasonNumber === expectedSeason.seasonNumber
                    );

                    if (!season) {
                      // Create the season if it doesn't exist
                      season = seasonRepository.create({
                        seasonNumber: expectedSeason.seasonNumber,
                      });
                      media.seasons.push(season);
                    }

                    season[is4k ? 'status4k' : 'status'] =
                      MediaStatus.AVAILABLE;
                  }
                }
                break;
              case 'partial':
                if (media.mediaType === MediaType.MOVIE) {
                  return next({
                    status: 400,
                    message: 'Only series can be set to be partially available',
                  });
                }
                media[is4k ? 'status4k' : 'status'] =
                  MediaStatus.PARTIALLY_AVAILABLE;
                break;
              case 'processing':
                media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
                break;
              case 'pending':
                media[is4k ? 'status4k' : 'status'] = MediaStatus.PENDING;
                break;
              case 'unknown':
                media[is4k ? 'status4k' : 'status'] = MediaStatus.UNKNOWN;
                break;
              default:
                return next({
                  status: 404,
                  message: 'Media status does not exist.',
                });
            }

            await mediaRepository.save(media);

            return res.status(200).json(filterEntityResponse(media, req.user));
          })
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to modify media.',
        });
      }
      throw e;
    }
  }
);

mediaRoutes.delete(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);
      const mediaId = parseMediaRouteId(req.params.id);
      if (!mediaId) {
        return next({ status: 404, message: 'Media not found' });
      }

      const initialMedia = await mediaRepository.findOneOrFail({
        where: { id: mediaId },
        relations: { identifiers: true },
      });
      if (!isMediaTypeCategoryEnabled(initialMedia.mediaType)) {
        return next({ status: 404, message: 'Media not found' });
      }
      return await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_REQUESTS,
        () =>
          runMediaEntityMutation(initialMedia, async () => {
            const media = await mediaRepository.findOneOrFail({
              where: { id: mediaId },
            });

            if (media.status === MediaStatus.BLOCKLISTED) {
              media.resetServiceData();
              await mediaRepository.save(media);
            } else {
              await mediaRepository.remove(media);
            }

            return res.status(204).send();
          })
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to modify media.',
        });
      }
      if (e instanceof EntityNotFoundError) {
        return res.status(204).send();
      }
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        mediaId: req.params.id,
        message: e.message,
      });
      next({ status: 500, message: 'Failed to delete media' });
    }
  }
);

mediaRoutes.get(
  '/:id/library',
  isAuthenticated(Permission.ADMIN),
  authorizedRouteAccess(Permission.ADMIN),
  async (req, res, next) => {
    const id = parseMediaRouteId(req.params.id);
    const media = id
      ? await getRepository(Media).findOne({
          where: { id },
          relations: { identifiers: true },
        })
      : null;
    if (!media) return next({ status: 404, message: 'Media not found.' });
    if (!isMediaTypeCategoryEnabled(media.mediaType))
      return next({ status: 404, message: 'Media not found.' });
    try {
      return await runWithServarrServiceCollectionMutationAdmission(
        libraryServiceType(media.mediaType, media.comicServiceType),
        async () => {
          const { plan } = await resolveLibraryRemoval(media);
          return res.json(plan);
        }
      );
    } catch (error) {
      return next({ status: 502, message: error.message });
    }
  }
);

mediaRoutes.delete(
  '/:id/library',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const id = parseMediaRouteId(req.params.id);
    if (
      !id ||
      typeof req.body?.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(req.body.token)
    )
      return next({
        status: 400,
        message: 'A current library confirmation is required.',
      });
    try {
      const repository = getRepository(Media);
      const initial = await repository.findOneOrFail({
        where: { id },
        relations: { identifiers: true },
      });
      if (!areAllMediaTypeCategoriesEnabled(initial.mediaType))
        return next({ status: 404, message: 'Media not found.' });
      return await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.ADMIN,
        () =>
          runMediaEntityMutation(initial, async () =>
            runWithServarrServiceCollectionMutationAdmission(
              libraryServiceType(initial.mediaType, initial.comicServiceType),
              async () => {
                const media = await repository.findOneOrFail({
                  where: { id },
                  relations: { identifiers: true, seasons: true },
                });
                const resolved = await resolveLibraryRemoval(media);
                let removed = 0;
                try {
                  await executeLibraryRemoval(
                    req.body.token,
                    resolved,
                    async (target, remaining) => {
                      removed++;
                      if (
                        media.mediaType === MediaType.MOVIE ||
                        media.mediaType === MediaType.TV
                      ) {
                        const is4k = target.quality === '4K';
                        if (
                          !remaining.some(
                            (copy) => copy.quality === target.quality
                          )
                        ) {
                          if (
                            media[is4k ? 'status4k' : 'status'] !==
                            MediaStatus.BLOCKLISTED
                          )
                            media[is4k ? 'status4k' : 'status'] =
                              MediaStatus.DELETED;
                          // Keep the media-server key solely as evidence for the next
                          // deletion reconciliation; playback is disabled by status.
                          media.resetServiceDataForResolution(is4k, true);
                          for (const season of media.seasons ?? [])
                            season[is4k ? 'status4k' : 'status'] =
                              MediaStatus.DELETED;
                        }
                      } else if (!remaining.length) {
                        media.status = MediaStatus.DELETED;
                        media.resetServiceData();
                      } else if (media.mediaType === MediaType.BOOK) {
                        if (
                          target.quality === 'Book' &&
                          !remaining.some((copy) => copy.quality === 'Book')
                        )
                          media.resetServiceDataForResolution(false);
                        if (
                          target.quality === 'Audiobook' &&
                          !remaining.some(
                            (copy) => copy.quality === 'Audiobook'
                          )
                        ) {
                          media.audiobookServiceId = null;
                          media.audiobookExternalServiceId = null;
                          media.audiobookExternalServiceSlug = null;
                        }
                        media.status = MediaStatus.PARTIALLY_AVAILABLE;
                      }
                      await repository.save(media);
                    }
                  );
                } catch {
                  return next({
                    status: 409,
                    message: removed
                      ? `${removed} library copy/copies were deleted before an error. Remaining copies were not deleted. Refresh and review a new confirmation.`
                      : 'Library verification changed or deletion failed. No successful deletions were recorded. Refresh and review a new confirmation.',
                  });
                }
                return res.status(204).send();
              }
            )
          )
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError)
        return next({
          status: 403,
          message: 'You no longer have permission to modify media.',
        });
      if (error instanceof EntityNotFoundError)
        return next({ status: 404, message: 'Media not found.' });
      return next({
        status: 502,
        message:
          'Unable to verify all library services. No deletion has started.',
      });
    }
  }
);

mediaRoutes.delete(
  '/:id/file',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);
      const mediaId = parseMediaRouteId(req.params.id);
      if (!mediaId) {
        return next({ status: 404, message: 'Media not found' });
      }
      const initialMedia = await mediaRepository.findOneOrFail({
        where: { id: mediaId },
        relations: { identifiers: true },
      });
      if (!isMediaTypeCategoryEnabled(initialMedia.mediaType)) {
        return next({ status: 404, message: 'Media not found' });
      }
      return await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_REQUESTS,
        () =>
          runMediaEntityMutation(initialMedia, async () => {
            const media = await mediaRepository.findOneOrFail({
              where: { id: mediaId },
            });

            const parsedIs4k = parseOptionalQueryBoolean(
              req.query.is4k,
              'is4k'
            );
            if ('error' in parsedIs4k) {
              return next({ status: 400, message: parsedIs4k.error });
            }
            const is4k = parsedIs4k.value ?? false;
            const isMovie = media.mediaType === MediaType.MOVIE;
            const isMusic = media.mediaType === MediaType.MUSIC;
            const isBook = media.mediaType === MediaType.BOOK;
            const isComic = media.mediaType === MediaType.COMIC;
            const isMagazine = media.mediaType === MediaType.MAGAZINE;
            const parsedBookFormat = parseOptionalAllowedString(
              req.query.format,
              {
                fieldName: 'Format',
                allowedValues: mediaFileFormats,
                maxLength: 16,
              }
            );
            if ('error' in parsedBookFormat) {
              return next({ status: 400, message: parsedBookFormat.error });
            }
            const bookFormat = parsedBookFormat.value ?? 'both';
            if (
              isBook &&
              !areMediaCategoriesEnabled(
                bookFormat === 'both' ? ['ebook', 'audiobook'] : [bookFormat]
              )
            ) {
              return next({ status: 404, message: 'Media not found.' });
            }

            const specificServiceId = is4k
              ? media.serviceId4k
              : media.serviceId;
            const selectionSettings = getExternalRuntimeConfig();
            const selectedServiceId =
              specificServiceId !== null && specificServiceId !== undefined
                ? specificServiceId
                : isMovie
                  ? selectionSettings.radarr.find(
                      (radarr) => radarr.isDefault && radarr.is4k === is4k
                    )?.id
                  : isMusic
                    ? selectionSettings.lidarr.find(
                        (lidarr) => lidarr.isDefault
                      )?.id
                    : isMagazine
                      ? selectionSettings.lazylibrarian.find(
                          (service) => service.isDefault
                        )?.id
                      : isBook || isComic
                        ? undefined
                        : selectionSettings.sonarr.find(
                            (sonarr) => sonarr.isDefault && sonarr.is4k === is4k
                          )?.id;
            const serviceType = isMovie
              ? ('radarr' as const)
              : isMusic
                ? ('lidarr' as const)
                : isBook
                  ? ('readarr' as const)
                  : isMagazine
                    ? ('lazylibrarian' as const)
                    : isComic
                      ? media.comicServiceType === 'kapowarr'
                        ? ('kapowarr' as const)
                        : ('mylar' as const)
                      : ('sonarr' as const);
            const serviceAdmissions = isBook
              ? [
                  ...(bookFormat !== 'audiobook' &&
                  media.serviceId !== null &&
                  media.serviceId !== undefined
                    ? [
                        {
                          serviceType: 'readarr' as const,
                          serviceId: media.serviceId,
                        },
                      ]
                    : []),
                  ...(bookFormat !== 'ebook' &&
                  media.audiobookServiceId !== null &&
                  media.audiobookServiceId !== undefined
                    ? [
                        {
                          serviceType: 'readarr' as const,
                          serviceId: media.audiobookServiceId,
                        },
                      ]
                    : []),
                ]
              : selectedServiceId !== undefined
                ? [{ serviceType, serviceId: selectedServiceId }]
                : [];

            return runWithServarrServiceAdmission(
              serviceAdmissions,
              async () => {
                const settings = getExternalRuntimeConfig();
                const serviceSettings = isMovie
                  ? settings.radarr.find(
                      (radarr) => radarr.id === selectedServiceId
                    )
                  : isMusic
                    ? settings.lidarr.find(
                        (lidarr) => lidarr.id === selectedServiceId
                      )
                    : isBook
                      ? undefined
                      : isMagazine
                        ? settings.lazylibrarian.find(
                            (service) => service.id === selectedServiceId
                          )
                        : isComic
                          ? media.comicServiceType === 'kapowarr'
                            ? settings.kapowarr.find(
                                (kapowarr) => kapowarr.id === selectedServiceId
                              )
                            : media.comicServiceType === 'backissue'
                              ? settings.backissue.find(
                                  (backissue) =>
                                    backissue.id === selectedServiceId
                                )
                              : settings.mylar.find(
                                  (mylar) => mylar.id === selectedServiceId
                                )
                          : settings.sonarr.find(
                              (sonarr) => sonarr.id === selectedServiceId
                            );

                const hasBookServiceLink =
                  isBook &&
                  ((media.serviceId !== null &&
                    media.serviceId !== undefined &&
                    media.externalServiceId !== null &&
                    media.externalServiceId !== undefined) ||
                    (media.audiobookServiceId !== null &&
                      media.audiobookServiceId !== undefined &&
                      media.audiobookExternalServiceId !== null &&
                      media.audiobookExternalServiceId !== undefined));

                if (!serviceSettings && !hasBookServiceLink) {
                  const serviceName = isMovie
                    ? 'Radarr'
                    : isMusic
                      ? 'Lidarr'
                      : isBook
                        ? 'Bookshelf'
                        : isMagazine
                          ? 'LazyLibrarian'
                          : isComic
                            ? media.comicServiceType === 'kapowarr'
                              ? 'Kapowarr'
                              : media.comicServiceType === 'backissue'
                                ? 'BackIssue'
                                : 'Mylar3'
                            : 'Sonarr';
                  logger.warn(
                    `There is no configured ${is4k ? '4K ' : ''}${serviceName} server for this media item.`,
                    {
                      label: 'Media Request',
                      mediaId: media.id,
                    }
                  );
                  return next({
                    status: 404,
                    message: `${serviceName} server not configured.`,
                  });
                }

                let service;
                if (isMovie) {
                  service = new RadarrAPI({
                    apiKey: serviceSettings!.apiKey,
                    url: RadarrAPI.buildUrl(serviceSettings!, '/api/v3'),
                  });
                } else if (isMusic) {
                  service = new LidarrAPI({
                    apiKey: serviceSettings!.apiKey,
                    url: LidarrAPI.buildUrl(serviceSettings!, '/api/v1'),
                  });
                } else if (isMagazine) {
                  service = new LazyLibrarianAPI({
                    apiKey: serviceSettings!.apiKey,
                    url: LazyLibrarianAPI.buildUrl(serviceSettings!),
                  });
                } else if (isComic) {
                  service =
                    media.comicServiceType === 'kapowarr'
                      ? new KapowarrAPI({
                          apiKey: serviceSettings!.apiKey,
                          url: KapowarrAPI.buildUrl(serviceSettings!),
                        })
                      : media.comicServiceType === 'backissue'
                        ? new BackIssueAPI({
                            apiKey: serviceSettings!.apiKey,
                            url: BackIssueAPI.buildUrl(serviceSettings!),
                          })
                        : new MylarAPI({
                            apiKey: serviceSettings!.apiKey,
                            url: MylarAPI.buildUrl(serviceSettings!),
                          });
                } else if (!isBook) {
                  service = new SonarrAPI({
                    apiKey: serviceSettings!.apiKey,
                    url: SonarrAPI.buildUrl(serviceSettings!, '/api/v3'),
                  });
                }

                if (isMovie) {
                  await (service as RadarrAPI).removeMovie(media.tmdbId);
                } else if (isMusic) {
                  if (!media.externalServiceId) {
                    throw new Error('Lidarr album ID not found');
                  }
                  const album = await (service as LidarrAPI).getAlbum(
                    { id: media.externalServiceId },
                    0
                  );
                  await (service as LidarrAPI).removeAlbum(
                    media.externalServiceId
                  );
                  const remainingAlbums = await (
                    service as LidarrAPI
                  ).getAlbumsByArtist(album.artistId, 0);
                  if (remainingAlbums.length === 0) {
                    await (service as LidarrAPI).removeArtist(album.artistId);
                  }
                } else if (isBook) {
                  const removeEbook = bookFormat !== 'audiobook';
                  const removeAudiobook = bookFormat !== 'ebook';
                  let removedBookFormat = false;
                  const bookRemovalErrors: unknown[] = [];

                  const updateBookStatus = async () => {
                    const hasRemainingBookServiceLink =
                      (media.serviceId !== null &&
                        media.serviceId !== undefined &&
                        media.externalServiceId !== null &&
                        media.externalServiceId !== undefined) ||
                      (media.audiobookServiceId !== null &&
                        media.audiobookServiceId !== undefined &&
                        media.audiobookExternalServiceId !== null &&
                        media.audiobookExternalServiceId !== undefined);

                    media.status = hasRemainingBookServiceLink
                      ? MediaStatus.PARTIALLY_AVAILABLE
                      : MediaStatus.DELETED;
                    await mediaRepository.save(media);
                  };

                  if (
                    removeEbook &&
                    media.serviceId !== null &&
                    media.serviceId !== undefined &&
                    media.externalServiceId !== null &&
                    media.externalServiceId !== undefined
                  ) {
                    try {
                      const ebookSettings = settings.readarr.find(
                        (readarr) => readarr.id === media.serviceId
                      );

                      if (!ebookSettings) {
                        throw new Error(
                          'Bookshelf ebook server not configured'
                        );
                      }

                      const ebookService = new ReadarrAPI({
                        apiKey: ebookSettings.apiKey,
                        url: ReadarrAPI.buildUrl(ebookSettings, '/api/v1'),
                        mediaType: 'ebook',
                      });
                      const ebook = await ebookService.getBook(
                        media.externalServiceId,
                        0
                      );
                      await ebookService.removeBook(media.externalServiceId);
                      if (ebook.authorId !== undefined) {
                        const remainingBooks =
                          await ebookService.getBooksByAuthor(
                            ebook.authorId,
                            0
                          );
                        if (remainingBooks.length === 0) {
                          await ebookService.removeAuthor(ebook.authorId);
                        }
                      }
                      removedBookFormat = true;
                      media.serviceId = null;
                      media.externalServiceId = null;
                      media.externalServiceSlug = null;
                      await updateBookStatus();
                    } catch (error) {
                      bookRemovalErrors.push(error);
                    }
                  }

                  if (
                    removeAudiobook &&
                    media.audiobookServiceId !== null &&
                    media.audiobookServiceId !== undefined &&
                    media.audiobookExternalServiceId !== null &&
                    media.audiobookExternalServiceId !== undefined
                  ) {
                    try {
                      const audiobookSettings = settings.readarr.find(
                        (readarr) => readarr.id === media.audiobookServiceId
                      );

                      if (!audiobookSettings) {
                        throw new Error(
                          'Bookshelf audiobook server not configured'
                        );
                      }

                      const audiobookService = new ReadarrAPI({
                        apiKey: audiobookSettings.apiKey,
                        url: ReadarrAPI.buildUrl(audiobookSettings, '/api/v1'),
                        mediaType: 'audiobook',
                      });
                      const audiobook = await audiobookService.getBook(
                        media.audiobookExternalServiceId,
                        0
                      );
                      await audiobookService.removeBook(
                        media.audiobookExternalServiceId
                      );
                      if (audiobook.authorId !== undefined) {
                        const remainingBooks =
                          await audiobookService.getBooksByAuthor(
                            audiobook.authorId,
                            0
                          );
                        if (remainingBooks.length === 0) {
                          await audiobookService.removeAuthor(
                            audiobook.authorId
                          );
                        }
                      }
                      removedBookFormat = true;
                      media.audiobookServiceId = null;
                      media.audiobookExternalServiceId = null;
                      media.audiobookExternalServiceSlug = null;
                      await updateBookStatus();
                    } catch (error) {
                      bookRemovalErrors.push(error);
                    }
                  }

                  if (bookRemovalErrors.length > 0) {
                    throw bookRemovalErrors[0];
                  }
                  if (!removedBookFormat) {
                    throw new Error('Bookshelf book ID not found');
                  }
                } else if (isComic) {
                  if (!media.externalServiceId) {
                    throw new Error('Comic backend ID not found');
                  }

                  try {
                    if (media.comicServiceType === 'kapowarr') {
                      await (service as KapowarrAPI).removeVolume(
                        media.externalServiceId
                      );
                    } else if (media.comicServiceType === 'backissue') {
                      await (service as BackIssueAPI).removeSeries(
                        media.externalServiceId
                      );
                    } else {
                      await (service as MylarAPI).removeComic(
                        media.externalServiceSlug ??
                          String(media.externalServiceId)
                      );
                    }
                  } catch (error) {
                    if (error instanceof KapowarrTaskRunningError) {
                      return next({
                        status: 409,
                        message:
                          'Kapowarr has a queued or running task for this comic. Wait for it to finish, then try again.',
                      });
                    }
                    throw error;
                  }
                } else if (isMagazine) {
                  if (!media.externalServiceSlug) {
                    throw new Error('LazyLibrarian magazine title not found');
                  }
                  await (service as LazyLibrarianAPI).removeMagazine(
                    media.externalServiceSlug
                  );
                } else {
                  const tmdb = new TheMovieDb();
                  const series = await tmdb.getTvShow({ tvId: media.tmdbId });
                  const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
                  if (!tvdbId) {
                    throw new Error('TVDB ID not found');
                  }
                  await (service as SonarrAPI).removeSeries(tvdbId);
                }

                if (isBook) {
                  // Book format links are saved as each backend removal succeeds.
                } else {
                  const deleted4k = is4k && !isMusic;
                  if (
                    media[deleted4k ? 'status4k' : 'status'] !==
                    MediaStatus.BLOCKLISTED
                  )
                    media[deleted4k ? 'status4k' : 'status'] =
                      MediaStatus.DELETED;
                  media.resetServiceDataForResolution(deleted4k, isMusic);
                  if (media.mediaType === MediaType.TV) {
                    for (const season of media.seasons) {
                      season[deleted4k ? 'status4k' : 'status'] =
                        MediaStatus.DELETED;
                    }
                  }
                  await mediaRepository.save(media);
                }

                return res.status(204).send();
              }
            );
          })
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to modify media.',
        });
      }
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Media not found' });
      }
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        mediaId: req.params.id,
        message: e.message,
      });
      next({ status: 404, message: 'Media not found' });
    }
  }
);

mediaRoutes.get<{ id: string }, MediaWatchDataResponse>(
  '/:id/watch_data',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const mediaId = parseMediaRouteId(req.params.id);
    if (!mediaId) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const media = await getRepository(Media).findOne({
      where: { id: mediaId },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }
    if (!isMediaTypeCategoryEnabled(media.mediaType)) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      return await runWithConfigurationAdmission('tautulli', async () => {
        const settings = getExternalRuntimeConfig().tautulli;
        if (!settings.hostname || !settings.port || !settings.apiKey) {
          return next({
            status: 404,
            message: 'Tautulli API not configured.',
          });
        }
        const tautulli = new TautulliAPI(settings);
        const userRepository = getRepository(User);

        const response: MediaWatchDataResponse = {};

        if (media.ratingKey) {
          const watchStats = await tautulli.getMediaWatchStats(media.ratingKey);
          const watchUsers = await tautulli.getMediaWatchUsers(media.ratingKey);
          const plexIds = parseTautulliPlexUserIds(watchUsers);
          const users = plexIds.length
            ? await userRepository
                .createQueryBuilder('user')
                .where('user.plexId IN (:...plexIds)', { plexIds })
                .getMany()
            : [];

          const playCount =
            watchStats.find((i) => i.query_days == 0)?.total_plays ?? 0;

          const playCount7Days =
            watchStats.find((i) => i.query_days == 7)?.total_plays ?? 0;

          const playCount30Days =
            watchStats.find((i) => i.query_days == 30)?.total_plays ?? 0;

          response.data = {
            users: users,
            playCount,
            playCount7Days,
            playCount30Days,
          };
        }

        if (media.ratingKey4k) {
          const watchStats4k = await tautulli.getMediaWatchStats(
            media.ratingKey4k
          );
          const watchUsers4k = await tautulli.getMediaWatchUsers(
            media.ratingKey4k
          );
          const plexIds4k = parseTautulliPlexUserIds(watchUsers4k);
          const users = plexIds4k.length
            ? await userRepository
                .createQueryBuilder('user')
                .where('user.plexId IN (:...plexIds)', { plexIds: plexIds4k })
                .getMany()
            : [];

          const playCount =
            watchStats4k.find((i) => i.query_days == 0)?.total_plays ?? 0;

          const playCount7Days =
            watchStats4k.find((i) => i.query_days == 7)?.total_plays ?? 0;

          const playCount30Days =
            watchStats4k.find((i) => i.query_days == 30)?.total_plays ?? 0;

          response.data4k = {
            users,
            playCount,
            playCount7Days,
            playCount30Days,
          };
        }

        return res.status(200).json(filterEntityResponse(response, req.user));
      });
    } catch (e) {
      if (isTautulliNoDataError(e)) {
        return res.status(200).json({});
      }

      logger.error('Something went wrong fetching media watch data', {
        label: 'API',
        errorMessage: e.message,
        mediaId: req.params.id,
      });
      next({ status: 500, message: 'Failed to fetch watch data.' });
    }
  })
);

mediaRoutes.get<{ id: string }>(
  '/:id/jellystat',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const mediaId = parseMediaRouteId(req.params.id);
    if (!mediaId) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const media = await getRepository(Media).findOne({
      where: { id: mediaId },
    });
    if (!media || !isMediaTypeCategoryEnabled(media.mediaType)) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const settings = getSettings().jellystat;
    if (!settings) {
      return next({ status: 404, message: 'Jellystat is not configured.' });
    }

    const jellyfinItemId = media.jellyfinMediaId;
    if (!jellyfinItemId) {
      return next({
        status: 404,
        message: 'This title is not linked to a Jellyfin item.',
      });
    }

    try {
      const playback = await new JellystatAPI(settings).getItemPlayback(
        jellyfinItemId
      );
      return res.status(200).json(playback);
    } catch (error) {
      return next({
        status: 502,
        message:
          error instanceof Error
            ? error.message
            : 'Could not read watch statistics from Jellystat.',
      });
    }
  })
);

export default mediaRoutes;
