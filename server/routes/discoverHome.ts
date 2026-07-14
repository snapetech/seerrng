import { DiscoverSliderType } from '@server/constants/discover';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  DiscoverHomeManifest,
  DiscoverHomeRowDescriptor,
  DiscoverHomeStateItem,
  DiscoverHomeStateResponse,
} from '@server/interfaces/api/discoverHomeInterfaces';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { Router } from 'express';
import { In } from 'typeorm';
import { z } from 'zod';

const discoverHomeRoutes = Router();
const MAX_STATE_ITEMS = 100;
const MANIFEST_MAX_AGE_SECONDS = 60;
const ROW_MAX_AGE_SECONDS = 300;
const STATE_MAX_AGE_SECONDS = 30;

const hashRevision = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

const rowEndpoints: Partial<Record<number, string>> = {
  [DiscoverSliderType.RECENTLY_ADDED]:
    '/api/v1/media?filter=available&sort=mediaAdded',
  [DiscoverSliderType.RECENT_REQUESTS]: '/api/v1/request?sort=modified',
  [DiscoverSliderType.PLEX_WATCHLIST]: '/api/v1/discover/watchlist',
  [DiscoverSliderType.TRENDING]: '/api/v1/discover/trending',
  [DiscoverSliderType.POPULAR_MOVIES]: '/api/v1/discover/movies',
  [DiscoverSliderType.MOVIE_GENRES]: '/api/v1/genres/movie',
  [DiscoverSliderType.UPCOMING_MOVIES]: '/api/v1/discover/movies',
  [DiscoverSliderType.STUDIOS]: '/api/v1/studios',
  [DiscoverSliderType.POPULAR_TV]: '/api/v1/discover/tv',
  [DiscoverSliderType.TV_GENRES]: '/api/v1/genres/tv',
  [DiscoverSliderType.UPCOMING_TV]: '/api/v1/discover/tv',
  [DiscoverSliderType.NETWORKS]: '/api/v1/networks',
  [DiscoverSliderType.POPULAR_MUSIC]: '/api/v1/discover/music?sortBy=ranked',
  [DiscoverSliderType.POPULAR_BOOKS]: '/api/v1/discover/books?sortBy=ranked',
};

const getRowDescriptor = (
  slider: DiscoverSlider
): DiscoverHomeRowDescriptor => {
  const descriptor = {
    key: `slider-${slider.id}`,
    sliderId: slider.id,
    type: slider.type,
    title: slider.title,
    data: slider.data,
    endpoint: rowEndpoints[slider.type],
  };

  return { ...descriptor, descriptorRevision: hashRevision(descriptor) };
};

const getUserStateRevision = async (user: User): Promise<string> => {
  const [requestState, watchlistState] = await Promise.all([
    getRepository(MediaRequest)
      .createQueryBuilder('request')
      .leftJoin('request.media', 'media')
      .select('COUNT(request.id)', 'count')
      .addSelect('MAX(request.updatedAt)', 'requestUpdatedAt')
      .addSelect('MAX(media.updatedAt)', 'mediaUpdatedAt')
      .where('request.requestedBy = :userId', { userId: user.id })
      .getRawOne(),
    getRepository(Watchlist)
      .createQueryBuilder('watchlist')
      .leftJoin('watchlist.media', 'media')
      .select('COUNT(watchlist.id)', 'count')
      .addSelect('MAX(watchlist.updatedAt)', 'watchlistUpdatedAt')
      .addSelect('MAX(media.updatedAt)', 'mediaUpdatedAt')
      .where('watchlist.requestedBy = :userId', { userId: user.id })
      .getRawOne(),
  ]);

  return hashRevision({
    userId: user.id,
    userUpdatedAt: user.updatedAt,
    permissions: user.permissions,
    locale: user.settings?.locale,
    streamingRegion: user.settings?.streamingRegion,
    originalLanguage: user.settings?.originalLanguage,
    requestState,
    watchlistState,
  });
};

const setPrivateFreshnessHeaders = (res: Response, maxAgeSeconds: number) => {
  res.setHeader('Cache-Control', 'private, no-cache, stale-if-error=300');
  res.setHeader('Vary', 'Cookie, Accept-Encoding');
  res.setHeader('X-Discover-Freshness', String(maxAgeSeconds));
};

const etagMatches = (header: string | undefined, etag: string): boolean =>
  header
    ?.split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === etag.replace(/^W\//, '') || value === '*') ??
  false;

discoverHomeRoutes.get('/manifest', async (req, res) => {
  const sliders = await getRepository(DiscoverSlider).find({
    where: { enabled: true },
    order: { order: 'ASC' },
  });
  const rows = sliders.map(getRowDescriptor);
  const layoutRevision = hashRevision(rows);
  const userStateRevision = await getUserStateRevision(req.user!);
  // generatedAt changes between equivalent manifests, so use a weak validator
  // over the stable semantic revisions rather than claiming byte equality.
  const etag = `W/"${hashRevision({ layoutRevision, userStateRevision })}"`;

  setPrivateFreshnessHeaders(res, MANIFEST_MAX_AGE_SECONDS);
  res.setHeader('ETag', etag);
  if (etagMatches(req.header('If-None-Match'), etag)) {
    return res.status(304).end();
  }

  const manifest: DiscoverHomeManifest = {
    version: 1,
    layoutRevision,
    userStateRevision,
    generatedAt: new Date().toISOString(),
    freshness: {
      manifestMaxAgeSeconds: MANIFEST_MAX_AGE_SECONDS,
      rowMaxAgeSeconds: ROW_MAX_AGE_SECONDS,
      stateMaxAgeSeconds: STATE_MAX_AGE_SECONDS,
    },
    rows,
  };

  return res.json(manifest);
});

const numericItemSchema = z
  .object({
    mediaType: z.enum([MediaType.MOVIE, MediaType.TV]),
    id: z.number().int().positive().max(1_000_000_000),
  })
  .strict();
const externalItemSchema = z
  .object({
    mediaType: z.enum([MediaType.MUSIC, MediaType.BOOK]),
    id: z.string().trim().min(1).max(128),
  })
  .strict();
const stateBodySchema = z
  .object({
    items: z
      .array(z.union([numericItemSchema, externalItemSchema]))
      .min(1)
      .max(MAX_STATE_ITEMS),
  })
  .strict();

type StateInput = z.infer<typeof stateBodySchema>['items'][number];

const normalizeInput = (item: StateInput): StateInput => {
  if (item.mediaType === MediaType.MUSIC) {
    return { ...item, id: normalizeMusicBrainzId(item.id) };
  }
  if (item.mediaType === MediaType.BOOK) {
    return { ...item, id: normalizeOpenLibraryWorkId(item.id) };
  }
  return item;
};

const itemKey = (item: StateInput) => `${item.mediaType}:${item.id}`;

discoverHomeRoutes.post('/state', async (req, res) => {
  const parsed = stateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 400,
      message: 'Invalid Discover state item list.',
    });
  }

  const inputs = [
    ...new Map(
      parsed.data.items.map(normalizeInput).map((item) => [itemKey(item), item])
    ).values(),
  ];
  const tmdbInputs = inputs.filter(
    (item): item is Extract<StateInput, { id: number }> =>
      typeof item.id === 'number'
  );
  const musicIds = inputs
    .filter((item) => item.mediaType === MediaType.MUSIC)
    .map((item) => String(item.id));
  const bookIds = inputs
    .filter((item) => item.mediaType === MediaType.BOOK)
    .map((item) => String(item.id));
  const movieIds = tmdbInputs
    .filter((item) => item.mediaType === MediaType.MOVIE)
    .map((item) => item.id);
  const tvIds = tmdbInputs
    .filter((item) => item.mediaType === MediaType.TV)
    .map((item) => item.id);
  const watchlistWhere = [
    ...(movieIds.length
      ? [
          {
            requestedBy: { id: req.user!.id },
            mediaType: MediaType.MOVIE,
            tmdbId: In(movieIds),
          },
        ]
      : []),
    ...(tvIds.length
      ? [
          {
            requestedBy: { id: req.user!.id },
            mediaType: MediaType.TV,
            tmdbId: In(tvIds),
          },
        ]
      : []),
    ...(musicIds.length
      ? [
          {
            requestedBy: { id: req.user!.id },
            mediaType: MediaType.MUSIC,
            mbId: In(musicIds),
          },
        ]
      : []),
    ...(bookIds.length
      ? [
          {
            requestedBy: { id: req.user!.id },
            mediaType: MediaType.BOOK,
            externalId: In(bookIds),
          },
        ]
      : []),
  ];

  const mediaRepository = getRepository(Media);
  const [tmdbMedia, musicMedia, bookIdentifiers, watchlists] =
    await Promise.all([
      tmdbInputs.length
        ? mediaRepository.find({
            where: { tmdbId: In(tmdbInputs.map((item) => item.id)) },
          })
        : [],
      musicIds.length
        ? mediaRepository.find({ where: { mbId: In(musicIds) } })
        : [],
      bookIds.length
        ? getRepository(MediaIdentifier).find({
            where: {
              provider: MediaIdentifierProvider.OPENLIBRARY,
              value: In(bookIds),
            },
            relations: { media: true },
          })
        : [],
      getRepository(Watchlist).find({ where: watchlistWhere }),
    ]);
  const allMedia = [
    ...tmdbMedia,
    ...musicMedia,
    ...bookIdentifiers.map((identifier) => identifier.media),
  ];
  const mediaByKey = new Map<string, Media>();
  for (const media of allMedia) {
    if (
      media.mediaType === MediaType.MOVIE ||
      media.mediaType === MediaType.TV
    ) {
      mediaByKey.set(`${media.mediaType}:${media.tmdbId}`, media);
    } else if (media.mediaType === MediaType.MUSIC && media.mbId) {
      mediaByKey.set(
        `${media.mediaType}:${normalizeMusicBrainzId(media.mbId)}`,
        media
      );
    }
  }
  for (const identifier of bookIdentifiers) {
    mediaByKey.set(
      `${MediaType.BOOK}:${normalizeOpenLibraryWorkId(identifier.value)}`,
      identifier.media
    );
  }

  const mediaIds = [...new Set(allMedia.map((media) => media.id))];
  const requests = mediaIds.length
    ? await getRepository(MediaRequest).find({
        where: {
          requestedBy: { id: req.user!.id },
          media: { id: In(mediaIds) },
        },
        order: { updatedAt: 'DESC' },
      })
    : [];
  const requestByMediaId = new Map<number, MediaRequest>();
  for (const mediaRequest of requests) {
    if (!requestByMediaId.has(mediaRequest.media.id)) {
      requestByMediaId.set(mediaRequest.media.id, mediaRequest);
    }
  }
  const watchlistKeys = new Set(
    watchlists.map((item) =>
      item.mediaType === MediaType.MUSIC
        ? `${item.mediaType}:${normalizeMusicBrainzId(item.mbId ?? '')}`
        : item.mediaType === MediaType.BOOK
          ? `${item.mediaType}:${normalizeOpenLibraryWorkId(item.externalId ?? '')}`
          : `${item.mediaType}:${item.tmdbId}`
    )
  );

  const items: DiscoverHomeStateItem[] = inputs.map((input) => {
    const key = itemKey(input);
    const media = mediaByKey.get(key);
    const mediaRequest = media ? requestByMediaId.get(media.id) : undefined;
    return {
      key,
      mediaType: input.mediaType,
      id: input.id,
      media: media
        ? {
            id: media.id,
            status: media.status,
            status4k: media.status4k,
            updatedAt: media.updatedAt.toISOString(),
          }
        : null,
      request: mediaRequest
        ? {
            id: mediaRequest.id,
            status: mediaRequest.status,
            is4k: mediaRequest.is4k,
            updatedAt: mediaRequest.updatedAt.toISOString(),
          }
        : null,
      watchlisted: watchlistKeys.has(key),
    };
  });
  const response: DiscoverHomeStateResponse = {
    revision: hashRevision(items),
    generatedAt: new Date().toISOString(),
    items,
  };

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Accept-Encoding');
  return res.json(response);
});

export default discoverHomeRoutes;
