import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { runWithRequestAdmission } from '@server/entity/MediaRequest';
import type { BlocklistResultsResponse } from '@server/interfaces/api/blocklistInterfaces';
import {
  isValidExternalMediaId,
  normalizeExternalMediaId,
} from '@server/lib/externalIds';
import { Permission } from '@server/lib/permissions';
import {
  UserMutationActorUnauthorizedError,
  runAuthorizedUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { authorizedRouteAccess } from '@server/middleware/authorizedMutation';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { MAX_PAGINATION_OFFSET } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { escapeSqlLikePattern } from '@server/utils/sqlLike';
import { Router } from 'express';
import { EntityNotFoundError, In, QueryFailedError } from 'typeorm';
import { z } from 'zod';

const blocklistRoutes = Router();
const maxBlocklistId = 1_000_000_000;
const maxBlocklistTextLength = 512;
export const MAX_BLOCKLIST_COLLECTION_PARTS = 250;

const strictPositiveInteger = z.preprocess(
  (value) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(maxBlocklistId)
);
const strictNonNegativeInteger = z.preprocess(
  (value) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().nonnegative().max(maxBlocklistId)
);

export const blocklistAdd = z.object({
  tmdbId: strictPositiveInteger.optional(),
  externalId: z.string().trim().min(1).max(maxBlocklistTextLength).optional(),
  externalProvider: z.nativeEnum(MediaIdentifierProvider).optional(),
  mediaType: z.nativeEnum(MediaType),
  title: z.string().trim().max(maxBlocklistTextLength).optional(),
});

const blocklistCollectionParts = z
  .array(
    z.object({
      id: strictPositiveInteger,
      title: z.string().trim().min(1).max(maxBlocklistTextLength),
    })
  )
  .max(MAX_BLOCKLIST_COLLECTION_PARTS);

export const parseBlocklistCollectionParts = (parts: unknown) => {
  const parsed = blocklistCollectionParts.safeParse(parts);
  if (!parsed.success) {
    return {
      error: 'TMDB collection parts are invalid or too large.',
    } as const;
  }

  return {
    value: [...new Map(parsed.data.map((part) => [part.id, part])).values()],
  } as const;
};

const blocklistGet = z.object({
  take: strictPositiveInteger.pipe(z.number().max(100)).default(25),
  skip: strictNonNegativeInteger
    .pipe(z.number().max(MAX_PAGINATION_OFFSET))
    .default(0),
  search: z.string().trim().max(maxBlocklistTextLength).optional(),
  filter: z.enum(['all', 'manual', 'blocklistedTags']).optional(),
});

const parseBlocklistNumericId = (id: string): number | undefined =>
  parsePositiveRouteId(id, maxBlocklistId);

const parseBlocklistExternalId = (id: string): string | undefined => {
  const trimmed = id.trim();

  return trimmed.length > 0 && trimmed.length <= maxBlocklistTextLength
    ? trimmed
    : undefined;
};

const getBlocklistLookup = (id: string, mediaType: MediaType) => {
  if (mediaType === MediaType.MOVIE || mediaType === MediaType.TV) {
    const tmdbId = parseBlocklistNumericId(id);
    if (!tmdbId) {
      return;
    }

    return {
      tmdbId,
      mediaType,
    };
  }

  const externalId = parseBlocklistExternalId(id);
  if (!externalId) {
    return;
  }

  return {
    externalId: normalizeExternalMediaId(externalId, mediaType),
    mediaType,
  };
};

const isSupportedBlocklistType = (mediaType: unknown): mediaType is MediaType =>
  mediaType === MediaType.MOVIE ||
  mediaType === MediaType.TV ||
  mediaType === MediaType.MUSIC ||
  mediaType === MediaType.BOOK;

const getBlocklistAdmissionKey = (item: {
  mediaType: MediaType;
  tmdbId?: number;
  externalId?: string | null;
  externalProvider?: MediaIdentifierProvider | null;
}): string => {
  if (item.mediaType === MediaType.MUSIC) {
    return `request-canonical:music:${item.externalId ?? ''}`;
  }
  if (item.mediaType === MediaType.BOOK) {
    return `request-canonical:book:${
      item.externalProvider ?? MediaIdentifierProvider.OPENLIBRARY
    }:${item.externalId ?? ''}`;
  }
  return `request-media:${item.mediaType}:${item.tmdbId}`;
};

blocklistRoutes.get(
  '/',
  isAuthenticated([Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST], {
    type: 'or',
  }),
  authorizedRouteAccess([
    Permission.MANAGE_BLOCKLIST,
    Permission.VIEW_BLOCKLIST,
  ]),
  async (req, res, next) => {
    const parsedQuery = blocklistGet.safeParse(req.query);
    if (!parsedQuery.success) {
      return next({
        status: 400,
        message: 'Invalid blocklist query parameters.',
      });
    }
    const { take, skip, search, filter } = parsedQuery.data;

    try {
      let query = getRepository(Blocklist)
        .createQueryBuilder('blocklist')
        .leftJoinAndSelect('blocklist.user', 'user')
        .where('1 = 1'); // Allow use of andWhere later

      switch (filter) {
        case 'manual':
          query = query.andWhere('blocklist.blocklistedTags IS NULL');
          break;
        case 'blocklistedTags':
          query = query.andWhere('blocklist.blocklistedTags IS NOT NULL');
          break;
      }

      if (search) {
        query = query.andWhere(
          `LOWER(blocklist.title) LIKE :title ESCAPE '\\'`,
          {
            title: `%${escapeSqlLikePattern(search.toLowerCase())}%`,
          }
        );
      }

      const [blocklistedItems, itemsCount] = await query
        .orderBy('blocklist.createdAt', 'DESC')
        .take(take)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(itemsCount / take),
          pageSize: take,
          results: itemsCount,
          page: Math.ceil(skip / take) + 1,
        },
        results: filterEntityResponse(blocklistedItems, req.user),
      } as BlocklistResultsResponse);
    } catch (error) {
      logger.error('Something went wrong while retrieving blocklisted items', {
        label: 'Blocklist',
        errorMessage: error.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve blocklisted items.',
      });
    }
  }
);

blocklistRoutes.get<{ id: string }>(
  '/:id',
  isAuthenticated([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  }),
  authorizedRouteAccess(Permission.MANAGE_BLOCKLIST),
  async (req, res, next) => {
    const mediaType = req.query.mediaType;
    if (!isSupportedBlocklistType(mediaType)) {
      return next({
        status: 400,
        message: 'Invalid or missing mediaType query parameter.',
      });
    }

    try {
      const blocklisteRepository = getRepository(Blocklist);
      const lookup = getBlocklistLookup(req.params.id, mediaType);
      if (!lookup) {
        return next({
          status: 400,
          message: 'Invalid blocklist identifier.',
        });
      }

      const blocklistItem = await blocklisteRepository.findOneOrFail({
        where: lookup,
      });

      return res
        .status(200)
        .send(filterEntityResponse(blocklistItem, req.user));
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({
          status: 404,
          message: 'Blocklisted item not found.',
        });
      }
      return next({ status: 500, message: e.message });
    }
  }
);

blocklistRoutes.post(
  '/',
  isAuthenticated([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  }),
  async (req, res, next) => {
    let logPayload: {
      externalId?: unknown;
      mediaType?: unknown;
      tmdbId?: unknown;
    } = {};

    try {
      const parsedBody = blocklistAdd.safeParse(req.body);
      if (!parsedBody.success) {
        return next({ status: 400, message: 'Invalid blocklist payload.' });
      }
      const values = {
        ...parsedBody.data,
        externalId: parsedBody.data.externalId
          ? normalizeExternalMediaId(
              parsedBody.data.externalId,
              parsedBody.data.mediaType,
              parsedBody.data.externalProvider
            )
          : undefined,
      };
      logPayload = {
        externalId: values.externalId,
        mediaType: values.mediaType,
        tmdbId: values.tmdbId,
      };

      if (
        (values.mediaType === MediaType.MOVIE ||
          values.mediaType === MediaType.TV) &&
        (values.tmdbId === undefined ||
          values.externalId !== undefined ||
          values.externalProvider !== undefined)
      ) {
        return next({ status: 400, message: 'Invalid screen media identity.' });
      }
      if (
        values.mediaType === MediaType.MUSIC &&
        (!values.externalId ||
          !isValidExternalMediaId(
            values.externalId,
            values.mediaType,
            values.externalProvider
          ) ||
          values.tmdbId !== undefined ||
          (values.externalProvider !== undefined &&
            values.externalProvider !== MediaIdentifierProvider.MUSICBRAINZ))
      ) {
        return next({ status: 400, message: 'Invalid music identity.' });
      }
      if (
        values.mediaType === MediaType.BOOK &&
        (!values.externalId ||
          !isValidExternalMediaId(
            values.externalId,
            values.mediaType,
            values.externalProvider
          ) ||
          values.tmdbId !== undefined ||
          (values.externalProvider !== undefined &&
            ![
              MediaIdentifierProvider.OPENLIBRARY,
              MediaIdentifierProvider.OPENLIBRARY_EDITION,
              MediaIdentifierProvider.ISBN,
            ].includes(values.externalProvider)))
      ) {
        return next({ status: 400, message: 'Invalid book identity.' });
      }

      await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_BLOCKLIST,
        (actor) =>
          runWithRequestAdmission([getBlocklistAdmissionKey(values)], () =>
            dataSource.transaction((em) =>
              Blocklist.addToBlocklist(
                {
                  blocklistRequest: {
                    ...values,
                    user: actor,
                  },
                },
                em
              )
            )
          )
      );

      return res.status(201).send();
    } catch (error) {
      if (!(error instanceof Error)) {
        logger.error('Unexpected non-error thrown while creating blocklist', {
          label: 'Blocklist',
          thrownValue: String(error),
        });
        return next({ status: 500, message: 'Unable to create blocklist.' });
      }

      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to manage the blocklist.',
        });
      }

      if (error instanceof z.ZodError) {
        return next({ status: 400, message: 'Invalid blocklist payload.' });
      }

      if (error instanceof QueryFailedError) {
        if (
          error.driverError.errno === 19 ||
          error.driverError.code === '23505'
        ) {
          return next({ status: 412, message: 'Item already blocklisted' });
        }

        logger.warn('Something wrong with data blocklist', {
          tmdbId: logPayload.tmdbId,
          externalId: logPayload.externalId,
          mediaType: logPayload.mediaType,
          label: 'Blocklist',
        });
        return next({ status: 409, message: 'Something wrong' });
      }

      return next({ status: 500, message: error.message });
    }
  }
);

blocklistRoutes.post(
  '/collection/:id',
  isAuthenticated([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  }),
  async (req, res, next) => {
    try {
      const collectionId = parseBlocklistNumericId(req.params.id);
      if (!collectionId) {
        return next({ status: 400, message: 'Invalid collection ID.' });
      }

      const tmdb = new TheMovieDb();
      const collection = await tmdb.getCollection({
        collectionId,
        language: req.locale,
      });

      const parsedParts = parseBlocklistCollectionParts(collection.parts);
      if ('error' in parsedParts) {
        return next({ status: 502, message: parsedParts.error });
      }
      const uniqueParts = parsedParts.value;
      const partIds = uniqueParts.map((p) => p.id);
      if (partIds.length === 0) {
        return res.status(201).send();
      }

      await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_BLOCKLIST,
        (actor) =>
          runWithRequestAdmission(
            partIds.map((tmdbId) =>
              getBlocklistAdmissionKey({
                mediaType: MediaType.MOVIE,
                tmdbId,
              })
            ),
            () =>
              dataSource.transaction(async (em) => {
                const blocklistRepository = em.getRepository(Blocklist);
                const mediaRepository = em.getRepository(Media);

                const [existingBlocklists, existingMedia] = await Promise.all([
                  blocklistRepository.find({
                    where: { tmdbId: In(partIds), mediaType: MediaType.MOVIE },
                  }),
                  mediaRepository.find({
                    where: { tmdbId: In(partIds), mediaType: MediaType.MOVIE },
                  }),
                ]);
                const blocklistByTmdbId = new Map(
                  existingBlocklists.map((b) => [b.tmdbId, b])
                );
                const mediaByTmdbId = new Map(
                  existingMedia.map((m) => [m.tmdbId, m])
                );

                for (const part of uniqueParts) {
                  if (blocklistByTmdbId.has(part.id)) {
                    continue;
                  }

                  const candidate = new Blocklist({
                    tmdbId: part.id,
                    mediaType: MediaType.MOVIE,
                    title: part.title,
                    user: actor,
                  });
                  // PostgreSQL aborts a transaction after a unique violation,
                  // so catching Repository.save() here cannot recover the
                  // transaction. Ignore a concurrent insert at the statement
                  // boundary and then load the authoritative row instead.
                  await blocklistRepository
                    .createQueryBuilder()
                    .insert()
                    .into(Blocklist)
                    .values(candidate)
                    .orIgnore()
                    .execute();
                  const blocklist = await blocklistRepository.findOne({
                    where: { tmdbId: part.id, mediaType: MediaType.MOVIE },
                  });
                  if (!blocklist) {
                    throw new Error('Unable to persist collection blocklist.');
                  }

                  let media = mediaByTmdbId.get(part.id);
                  if (!media) {
                    blocklist.isMediaPlaceholder = true;
                    media = new Media({
                      tmdbId: part.id,
                      status: MediaStatus.BLOCKLISTED,
                      status4k: MediaStatus.BLOCKLISTED,
                      mediaType: MediaType.MOVIE,
                      blocklist: Promise.resolve(blocklist),
                    });
                  } else {
                    blocklist.previousStatus = media.status;
                    blocklist.previousStatus4k = media.status4k;
                    blocklist.isMediaPlaceholder = false;
                    media.status = MediaStatus.BLOCKLISTED;
                    media.status4k = MediaStatus.BLOCKLISTED;
                    media.blocklist = Promise.resolve(blocklist);
                  }

                  await blocklistRepository.save(blocklist);
                  await mediaRepository.save(media);
                }
              })
          )
      );

      return res.status(201).send();
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to manage the blocklist.',
        });
      }
      logger.error('Error blocklisting collection', {
        label: 'Blocklist',
        errorMessage: e.message,
        collectionId: req.params.id,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

blocklistRoutes.delete(
  '/:id',
  isAuthenticated([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  }),
  async (req, res, next) => {
    const mediaType = req.query.mediaType;
    if (!isSupportedBlocklistType(mediaType)) {
      return next({
        status: 400,
        message: 'Invalid or missing mediaType query parameter.',
      });
    }

    try {
      const lookup = getBlocklistLookup(req.params.id, mediaType);
      if (!lookup) {
        return next({
          status: 400,
          message: 'Invalid blocklist identifier.',
        });
      }

      const existing = await getRepository(Blocklist).findOneOrFail({
        where: lookup,
      });
      await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_BLOCKLIST,
        () =>
          runWithRequestAdmission([getBlocklistAdmissionKey(existing)], () =>
            dataSource.transaction(async (em) => {
              const blocklistItem = await em
                .getRepository(Blocklist)
                .findOneOrFail({ where: { id: existing.id } });
              await Blocklist.removeFromBlocklist(blocklistItem, em);
            })
          )
      );

      return res.status(204).send();
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to manage the blocklist.',
        });
      }
      if (e instanceof EntityNotFoundError) {
        return next({
          status: 404,
          message: 'Blocklisted item not found.',
        });
      }
      return next({ status: 500, message: e.message });
    }
  }
);

blocklistRoutes.delete(
  '/collection/:id',
  isAuthenticated([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  }),
  async (req, res, next) => {
    try {
      const collectionId = parseBlocklistNumericId(req.params.id);
      if (!collectionId) {
        return next({ status: 400, message: 'Invalid collection ID.' });
      }

      const tmdb = new TheMovieDb();
      const collection = await tmdb.getCollection({
        collectionId,
        language: req.locale,
      });

      const parsedParts = parseBlocklistCollectionParts(collection.parts);
      if ('error' in parsedParts) {
        return next({ status: 502, message: parsedParts.error });
      }
      const partIds = parsedParts.value.map((part) => part.id);
      if (partIds.length === 0) {
        return res.status(204).send();
      }
      await runAuthorizedUserSecurityMutation(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_BLOCKLIST,
        () =>
          runWithRequestAdmission(
            partIds.map((tmdbId) =>
              getBlocklistAdmissionKey({
                mediaType: MediaType.MOVIE,
                tmdbId,
              })
            ),
            () =>
              dataSource.transaction(async (em) => {
                const blocklistRepository = em.getRepository(Blocklist);
                const blocklistItems = await blocklistRepository.find({
                  where: { tmdbId: In(partIds), mediaType: MediaType.MOVIE },
                });
                for (const blocklistItem of blocklistItems) {
                  await Blocklist.removeFromBlocklist(blocklistItem, em);
                }
              })
          )
      );

      return res.status(204).send();
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You no longer have permission to manage the blocklist.',
        });
      }
      logger.error('Error unblocklisting collection', {
        label: 'Blocklist',
        errorMessage: e.message,
        collectionId: req.params.id,
      });
      return next({ status: 500, message: e.message });
    }
  }
);

export default blocklistRoutes;
