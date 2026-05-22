import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import type { BlocklistResultsResponse } from '@server/interfaces/api/blocklistInterfaces';
import { normalizeExternalMediaId } from '@server/lib/externalIds';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';
import { EntityNotFoundError, In, QueryFailedError } from 'typeorm';
import { z } from 'zod';

const blocklistRoutes = Router();
const maxBlocklistId = 1_000_000_000;
const maxBlocklistTextLength = 512;
const maxBlocklistedTagsLength = 4096;

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
  user: strictPositiveInteger.optional(),
  blocklistedTags: z.string().trim().max(maxBlocklistedTagsLength).optional(),
});

const blocklistGet = z.object({
  take: strictPositiveInteger.pipe(z.number().max(100)).default(25),
  skip: strictNonNegativeInteger.default(0),
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

blocklistRoutes.get(
  '/',
  isAuthenticated([Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST], {
    type: 'or',
  }),
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
        query = query.andWhere('blocklist.title like :title', {
          title: `%${search}%`,
        });
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
        results: filterEntityResponse(blocklistedItems),
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

blocklistRoutes.get(
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

      return res.status(200).send(filterEntityResponse(blocklistItem));
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({
          status: 404,
          message: e.message,
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
        values.tmdbId === undefined
      ) {
        return next({ status: 400, message: 'Missing tmdbId.' });
      }
      if (
        (values.mediaType === MediaType.MUSIC ||
          values.mediaType === MediaType.BOOK) &&
        !values.externalId
      ) {
        return next({ status: 400, message: 'Missing externalId.' });
      }

      await Blocklist.addToBlocklist({
        blocklistRequest: {
          ...values,
          user: req.user,
        },
      });

      return res.status(201).send();
    } catch (error) {
      if (!(error instanceof Error)) {
        return;
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

      const uniqueParts = [
        ...new Map(collection.parts.map((p) => [p.id, p])).values(),
      ];
      const partIds = uniqueParts.map((p) => p.id);
      if (partIds.length === 0) {
        return res.status(201).send();
      }

      await dataSource.transaction(async (em) => {
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
        const mediaByTmdbId = new Map(existingMedia.map((m) => [m.tmdbId, m]));

        await Promise.all(
          uniqueParts.map(async (part) => {
            if (blocklistByTmdbId.has(part.id)) {
              return;
            }

            let blocklist = new Blocklist({
              tmdbId: part.id,
              mediaType: MediaType.MOVIE,
              title: part.title,
              user: req.user,
            });

            try {
              await blocklistRepository.save(blocklist);
            } catch (error) {
              if (
                !(error instanceof QueryFailedError) ||
                error.driverError.errno !== 19
              ) {
                throw error;
              }
              const row = await blocklistRepository.findOne({
                where: { tmdbId: part.id, mediaType: MediaType.MOVIE },
              });
              if (!row) {
                throw error;
              }
              blocklist = row;
            }

            let media = mediaByTmdbId.get(part.id);
            if (!media) {
              media = new Media({
                tmdbId: part.id,
                status: MediaStatus.BLOCKLISTED,
                status4k: MediaStatus.BLOCKLISTED,
                mediaType: MediaType.MOVIE,
                blocklist: Promise.resolve(blocklist),
              });
            } else {
              media.status = MediaStatus.BLOCKLISTED;
              media.status4k = MediaStatus.BLOCKLISTED;
              media.blocklist = Promise.resolve(blocklist);
            }

            await mediaRepository.save(media);
          })
        );
      });

      return res.status(201).send();
    } catch (e) {
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

      await blocklisteRepository.remove(blocklistItem);

      const mediaRepository = getRepository(Media);

      let mediaItem: Media | null = null;
      if (mediaType === MediaType.MUSIC) {
        mediaItem = await mediaRepository.findOne({
          where: { mbId: lookup.externalId, mediaType },
        });
      } else if (mediaType === MediaType.BOOK) {
        const identifier = await getRepository(MediaIdentifier).findOne({
          where: {
            provider:
              blocklistItem.externalProvider ??
              MediaIdentifierProvider.OPENLIBRARY,
            value: lookup.externalId,
          },
          relations: { media: true },
        });
        mediaItem =
          identifier?.media.mediaType === mediaType ? identifier.media : null;
      } else {
        const tmdbId = lookup.tmdbId;
        if (!tmdbId) {
          return next({
            status: 400,
            message: 'Invalid blocklist identifier.',
          });
        }

        mediaItem = await mediaRepository.findOne({
          where: {
            tmdbId,
            mediaType,
          },
        });
      }

      if (mediaItem) {
        await mediaRepository.remove(mediaItem);
      }

      return res.status(204).send();
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({
          status: 404,
          message: e.message,
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

      await dataSource.transaction(async (em) => {
        const blocklistRepository = em.getRepository(Blocklist);
        const mediaRepository = em.getRepository(Media);

        await Promise.all(
          collection.parts.map(async (part) => {
            const blocklistItem = await blocklistRepository.findOne({
              where: { tmdbId: part.id, mediaType: MediaType.MOVIE },
            });

            if (blocklistItem) {
              await blocklistRepository.remove(blocklistItem);

              const mediaItem = await mediaRepository.findOne({
                where: { tmdbId: part.id, mediaType: MediaType.MOVIE },
              });

              if (mediaItem) {
                await mediaRepository.remove(mediaItem);
              }
            }
          })
        );
      });

      return res.status(204).send();
    } catch (e) {
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
