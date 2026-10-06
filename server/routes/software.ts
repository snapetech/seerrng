import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI, {
  type RomarrPlatform,
} from '@server/api/software/romarrng';
import type {
  SoftwareCatalogGame,
  SoftwareCatalogPlatform,
  SoftwareProviderActions,
} from '@server/api/software/types';
import dataSource, { getRepository } from '@server/datasource';
import SoftwareRequest, {
  type SoftwareRequestCategory,
  type SoftwareRequestProvider,
  type SoftwareRequestStatus,
} from '@server/entity/SoftwareRequest';
import SoftwareRequestStatusEvent from '@server/entity/SoftwareRequestStatusEvent';
import { User } from '@server/entity/User';
import { extractImageCacheUrls } from '@server/lib/imageCacheUrls';
import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import { isMediaCategoryEnabled } from '@server/lib/mediaCategories';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  approveSoftwareRequest,
  cancelSoftwareRequest,
  declineSoftwareRequest,
  hasSoftwareRequestAccess,
  isValidPcVariant,
  listSoftwareRequestAssets,
  notifySoftwareRequestStatus,
  refreshSoftwareRequest,
  refreshSoftwareRequests,
  retrySoftwareRequest,
  SoftwareProviderNotConfiguredError,
  SoftwareRequestConfirmationRequiredError,
  SoftwareRequestStateError,
  streamSoftwareRequestAsset,
  streamSoftwareRequestBundle,
  withdrawPendingSoftwareRequest,
  type PcGameVariant,
} from '@server/lib/softwareRequests';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { getHttpErrorDetails } from '@server/utils/httpError';
import { parsePageParams } from '@server/utils/pagination';
import axios from 'axios';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { In } from 'typeorm';

const softwareRoutes = Router();
const MAX_CATALOG_LIMIT = 50;
const CATALOG_PROVIDER_FETCH_LIMIT = 50;
const MAX_CATALOG_CURSOR_LENGTH = 20000;
const MAX_CATALOG_OFFSET = 10000;
const QUESTARR_CATALOG_IMAGE_ORIGIN = 'https://images.igdb.com';
type SoftwareCatalogApi = Pick<
  QuestarrNGAPI | ROMarrNGAPI,
  | 'getCatalogPlatforms'
  | 'searchCatalog'
  | 'searchCatalogPage'
  | 'getPopularCatalog'
  | 'getPopularCatalogPage'
  | 'getCatalogGame'
>;
const ACTIVE_STATUSES: SoftwareRequestStatus[] = [
  'pending',
  'approved',
  'searching',
  'downloading',
  'importing',
];
const softwareStatusFilters = [
  'all',
  'pending',
  'approved',
  'processing',
  'active',
  'incomplete',
  'attention',
  'completed',
  'unavailable',
  'requested',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
  'failed',
  'declined',
  'cancelled',
] as const;

const getStatusesForFilter = (
  filter: (typeof softwareStatusFilters)[number]
): SoftwareRequestStatus[] | undefined => {
  switch (filter) {
    case 'all':
      return undefined;
    case 'active':
      return ACTIVE_STATUSES;
    case 'attention':
      return ['failed', 'declined', 'cancelled'];
    case 'processing':
      return ['searching', 'downloading', 'importing'];
    case 'pending':
    case 'requested':
      return ['pending'];
    case 'approved':
      return ['approved'];
    case 'completed':
    case 'available':
      return ['available'];
    case 'searching':
    case 'downloading':
    case 'importing':
    case 'failed':
    case 'declined':
    case 'cancelled':
      return [filter];
    case 'incomplete':
    case 'unavailable':
    case 'library':
      return [];
  }
};

const isSoftwareCategoryEnabled = (
  category: SoftwareRequestCategory
): boolean => isMediaCategoryEnabled(category);

const disabledCategoryResponse = (
  res: Parameters<Parameters<typeof softwareRoutes.get>[1]>[1],
  category: SoftwareRequestCategory
) =>
  res.status(403).json({
    error: `${category === 'game' ? 'PC game' : `${category} emulation`} requests are disabled by the administrator.`,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

type CatalogFilters = {
  systemSlug?: string;
  pcPlatform?: 'windows' | 'linux' | 'macos';
  genre?: string;
  releaseYear?: number;
};

const parseCatalogFilters = (
  value: Record<string, unknown>,
  category: SoftwareRequestCategory
): CatalogFilters | null => {
  const systemSlug = value.system;
  const pcPlatform = value.platform;
  const genre = value.genre;
  const releaseYear = value.releaseYear;
  const parsedYear =
    releaseYear === undefined ? undefined : Number(releaseYear);
  if (
    (systemSlug !== undefined &&
      (category === 'game' ||
        typeof systemSlug !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(systemSlug))) ||
    (pcPlatform !== undefined &&
      (category !== 'game' ||
        (pcPlatform !== 'windows' &&
          pcPlatform !== 'linux' &&
          pcPlatform !== 'macos'))) ||
    (genre !== undefined &&
      (typeof genre !== 'string' ||
        genre.trim().length < 1 ||
        genre.trim().length > 64)) ||
    (releaseYear !== undefined &&
      (typeof releaseYear !== 'string' ||
        !/^[0-9]{4}$/.test(releaseYear) ||
        parsedYear === undefined ||
        !Number.isSafeInteger(parsedYear) ||
        parsedYear < 1950 ||
        parsedYear > 2200))
  ) {
    return null;
  }
  return {
    systemSlug: systemSlug as string | undefined,
    pcPlatform: pcPlatform as CatalogFilters['pcPlatform'],
    genre: typeof genre === 'string' ? genre.trim() : undefined,
    releaseYear: parsedYear,
  };
};

const isValidCatalogCursor = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_CATALOG_CURSOR_LENGTH &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);

const normalizeNextCatalogCursor = (
  value: unknown,
  currentCursor?: string
): string | null =>
  isValidCatalogCursor(value) && value !== currentCursor ? value : null;

const normalizeNextCatalogOffset = (
  value: unknown,
  currentOffset: number
): number | null =>
  Number.isSafeInteger(value) &&
  (value as number) > currentOffset &&
  (value as number) <= MAX_CATALOG_OFFSET
    ? (value as number)
    : null;

const parseCatalogQuery = (
  value: unknown
): {
  query: string;
  category: SoftwareRequestCategory;
  limit: number;
  cursor?: string;
  filters: CatalogFilters;
} | null => {
  if (!isRecord(value)) return null;
  const query = typeof value.q === 'string' ? value.q.trim() : '';
  const category = value.category;
  const limit = value.limit === undefined ? 24 : Number(value.limit);
  const cursor = value.cursor;
  if (
    !query ||
    query.length > 200 ||
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CATALOG_LIMIT ||
    (cursor !== undefined && !isValidCatalogCursor(cursor))
  ) {
    return null;
  }
  const filters = parseCatalogFilters(value, category);
  return filters
    ? {
        query,
        category,
        limit,
        ...(typeof cursor === 'string' ? { cursor } : {}),
        filters,
      }
    : null;
};

const normalizePlatformName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const gameOptions = (game: SoftwareCatalogGame) =>
  game.platformOptions.filter(
    (platform) =>
      Number.isSafeInteger(platform.id) &&
      platform.id > 0 &&
      typeof platform.name === 'string' &&
      platform.name.length > 0 &&
      platform.name.length <= 128
  );

const isSafeCatalogCoverUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === QUESTARR_CATALOG_IMAGE_ORIGIN &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const sanitizeGame = (game: SoftwareCatalogGame): SoftwareCatalogGame => ({
  id: `igdb-${game.igdbId}`,
  igdbId: game.igdbId,
  title: game.title.slice(0, 512),
  summary: typeof game.summary === 'string' ? game.summary.slice(0, 5000) : '',
  coverUrl: isSafeCatalogCoverUrl(game.coverUrl) ? game.coverUrl : '',
  releaseDate:
    typeof game.releaseDate === 'string' ? game.releaseDate.slice(0, 32) : '',
  steamAppId:
    typeof game.steamAppId === 'number' &&
    Number.isSafeInteger(game.steamAppId) &&
    game.steamAppId > 0
      ? game.steamAppId
      : null,
  platforms: Array.isArray(game.platforms)
    ? game.platforms
        .filter((platform): platform is string => typeof platform === 'string')
        .slice(0, 100)
        .map((platform) => platform.slice(0, 128))
    : [],
  platformOptions: gameOptions(game).slice(0, 100),
  genres: Array.isArray(game.genres)
    ? game.genres
        .filter((genre): genre is string => typeof genre === 'string')
        .slice(0, 40)
        .map((genre) => genre.slice(0, 128))
    : [],
  rating:
    typeof game.rating === 'number' &&
    Number.isFinite(game.rating) &&
    game.rating >= 0 &&
    game.rating <= 100
      ? Math.round(game.rating) / 10
      : null,
  publishers: Array.isArray(game.publishers)
    ? game.publishers
        .filter((name): name is string => typeof name === 'string')
        .slice(0, 20)
        .map((name) => name.slice(0, 128))
    : [],
  developers: Array.isArray(game.developers)
    ? game.developers
        .filter((name): name is string => typeof name === 'string')
        .slice(0, 20)
        .map((name) => name.slice(0, 128))
    : [],
  screenshots: Array.isArray(game.screenshots)
    ? game.screenshots.filter(isSafeCatalogCoverUrl).slice(0, 12)
    : [],
  videos: Array.isArray(game.videos)
    ? game.videos
        .filter(
          (video) =>
            video &&
            typeof video.videoId === 'string' &&
            /^[A-Za-z0-9_-]{11}$/.test(video.videoId)
        )
        .slice(0, 6)
        .map((video) => ({
          name: typeof video.name === 'string' ? video.name.slice(0, 120) : '',
          videoId: video.videoId,
        }))
    : [],
  timeToBeat:
    game.timeToBeat && typeof game.timeToBeat === 'object'
      ? {
          hastily: game.timeToBeat.hastily,
          normally: game.timeToBeat.normally,
          completely: game.timeToBeat.completely,
        }
      : null,
});

const isPcPlatformName = (value: string): boolean => {
  const name = normalizePlatformName(value);
  return (
    name === 'pc microsoft windows' ||
    name === 'pc linux' ||
    name === 'pc macintosh' ||
    name === 'microsoft windows' ||
    name === 'windows' ||
    name === 'linux' ||
    name === 'mac' ||
    name === 'macintosh'
  );
};

const isPcTargetPlatformName = (
  value: string,
  target: CatalogFilters['pcPlatform']
): boolean => {
  if (!target) return isPcPlatformName(value);
  const name = normalizePlatformName(value);
  if (target === 'windows') {
    return ['pc microsoft windows', 'microsoft windows', 'windows'].includes(
      name
    );
  }
  if (target === 'linux') return name === 'pc linux' || name === 'linux';
  return ['pc macintosh', 'mac', 'macintosh', 'macos'].includes(name);
};

const getEmulationPlatforms = async (): Promise<
  (RomarrPlatform & { group: 'retro' | 'modern' | null })[]
> => {
  const settings = getSettings().softwareAcquisition;
  if (!settings.romarr.hostname || !settings.romarr.apiKey) {
    throw new SoftwareProviderNotConfiguredError('ROMarrNG is not configured.');
  }
  const api = new ROMarrNGAPI(settings.romarr);
  const platforms = await api.getPlatforms();
  return platforms
    .filter(
      (platform) =>
        typeof platform.slug === 'string' &&
        /^[a-z0-9][a-z0-9_-]{0,63}$/.test(platform.slug) &&
        typeof platform.name === 'string' &&
        platform.name.length > 0
    )
    .map((platform) => ({
      ...platform,
      aliases: Array.isArray(platform.aliases)
        ? platform.aliases
            .filter(
              (alias): alias is string =>
                typeof alias === 'string' &&
                alias.length > 0 &&
                alias.length <= 128
            )
            .slice(0, 100)
        : [],
      group: settings.emulationSystemGroups[platform.slug] ?? null,
    }));
};

const systemMatchesGame = (
  system: RomarrPlatform,
  game: SoftwareCatalogGame
): { id: number; name: string } | undefined => {
  const names = new Set(
    [system.name, system.slug, ...(system.aliases ?? [])]
      .map(normalizePlatformName)
      .filter(Boolean)
  );
  return gameOptions(game).find((platform) =>
    names.has(normalizePlatformName(platform.name))
  );
};

const systemMatchesPlatform = (system: RomarrPlatform, name: string): boolean =>
  [system.name, system.slug, ...(system.aliases ?? [])].some(
    (candidate) =>
      normalizePlatformName(candidate) === normalizePlatformName(name)
  );

const getCatalogCategoryContext = async (
  api: SoftwareCatalogApi,
  category: SoftwareRequestCategory,
  filters: CatalogFilters
) => {
  const [platforms, systems] = await Promise.all([
    api.getCatalogPlatforms(),
    category === 'game'
      ? Promise.resolve([])
      : getEmulationPlatforms().then((all) =>
          all.filter(
            (system) =>
              system.group === category &&
              (!filters.systemSlug || system.slug === filters.systemSlug)
          )
        ),
  ]);
  const matches = (platform: SoftwareCatalogPlatform) =>
    category === 'game'
      ? isPcTargetPlatformName(platform.name, filters.pcPlatform)
      : systems.some((system) => systemMatchesPlatform(system, platform.name));
  return {
    platformIds: platforms
      .filter(matches)
      .map((platform) => platform.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .slice(0, 100),
    systems,
  };
};

type CatalogGameResult = SoftwareCatalogGame & {
  emulationSystems?: {
    slug: string;
    name: string;
    group: 'retro' | 'modern' | null;
    catalogPlatformId: number;
  }[];
};

const mapCategoryGames = (
  games: SoftwareCatalogGame[],
  category: SoftwareRequestCategory,
  systems: (RomarrPlatform & { group: 'retro' | 'modern' | null })[],
  filters: CatalogFilters
): CatalogGameResult[] => {
  const sanitized = games.map(sanitizeGame);
  if (category === 'game') {
    return sanitized.filter((game) =>
      game.platformOptions.some(({ name }) =>
        isPcTargetPlatformName(name, filters.pcPlatform)
      )
    );
  }
  return sanitized.flatMap((game) => {
    const systemsForGame = systems.flatMap((system) => {
      const platform = systemMatchesGame(system, game);
      return platform
        ? [
            {
              slug: system.slug,
              name: system.name,
              group: system.group,
              catalogPlatformId: platform.id,
            },
          ]
        : [];
    });
    return systemsForGame.length
      ? [{ ...game, emulationSystems: systemsForGame }]
      : [];
  });
};

type CatalogAvailability =
  'available' | 'owned' | 'tracked' | 'downloading' | 'missing' | 'unknown';

const addCatalogAvailability = async (
  results: CatalogGameResult[],
  category: SoftwareRequestCategory
): Promise<
  (CatalogGameResult & {
    availability: CatalogAvailability;
    steamOwned?: boolean;
    availableSystems?: string[];
  })[]
> => {
  if (!results.length) return [];
  try {
    if (category === 'game') {
      const ids = [...new Set(results.map((game) => game.igdbId))];
      const steamAppIds = [
        ...new Set(
          results
            .map((game) => game.steamAppId)
            .filter(
              (appId): appId is number =>
                typeof appId === 'number' &&
                Number.isSafeInteger(appId) &&
                appId > 0
            )
        ),
      ];
      const response = steamAppIds.length
        ? await getQuestarrApi().lookupLibrary(ids, steamAppIds)
        : await getQuestarrApi().lookupLibrary(ids);
      const statuses = new Map(
        response.games
          .filter((game) => Number.isSafeInteger(game.igdbId))
          .map((game) => [game.igdbId, game.status])
      );
      const deliverability = new Map(
        response.games
          .filter((game) => Number.isSafeInteger(game.igdbId))
          .map((game) => [game.igdbId, game.deliverable])
      );
      const steamOwnership = new Map(
        (response.steamGames ?? [])
          .filter((game) => Number.isSafeInteger(game.steamAppId))
          .map((game) => [game.steamAppId, game.owned])
      );
      return results.map((game) => {
        const status = statuses.get(game.igdbId);
        const deliverable = deliverability.get(game.igdbId);
        const availability: CatalogAvailability =
          status === 'owned' || status === 'playing' || status === 'completed'
            ? deliverable === false
              ? 'owned'
              : 'available'
            : status === 'downloading'
              ? 'downloading'
              : status === 'wanted'
                ? 'tracked'
                : status === undefined
                  ? 'missing'
                  : 'unknown';
        const steamOwned = game.steamAppId
          ? steamOwnership.get(game.steamAppId) === true
          : false;
        return {
          ...game,
          availability,
          ...(steamOwned ? { steamOwned: true } : {}),
        };
      });
    }

    const pairs = results.flatMap((game) =>
      (game.emulationSystems ?? []).map((system) => ({
        title: game.title,
        platform: system.slug,
      }))
    );
    if (pairs.length > 1000) {
      return results.map((game) => ({ ...game, availability: 'unknown' }));
    }
    const api = new ROMarrNGAPI(getSettings().softwareAcquisition.romarr);
    const chunks = Array.from(
      { length: Math.ceil(pairs.length / 100) },
      (_, i) => pairs.slice(i * 100, (i + 1) * 100)
    );
    const responses = await Promise.all(
      chunks.map((chunk) => api.lookupLibrary(chunk))
    );
    const complete = responses.every(
      (response) => response.ready && !response.partial
    );
    const matches = new Set(
      responses.flatMap((response) =>
        response.matches.map((match) => `${match.platform}\u0000${match.title}`)
      )
    );
    return results.map((game) => {
      const availableSystems = (game.emulationSystems ?? [])
        .filter((system) => matches.has(`${system.slug}\u0000${game.title}`))
        .map((system) => system.slug);
      return {
        ...game,
        availability: availableSystems.length
          ? 'available'
          : complete
            ? 'missing'
            : 'unknown',
        availableSystems,
      };
    });
  } catch (error) {
    logger.warn('Software library availability lookup failed', {
      ...getHttpErrorDetails(error),
      category,
    });
    return results.map((game) => ({ ...game, availability: 'unknown' }));
  }
};

const addTrackedRequestAvailability = async (
  results: Awaited<ReturnType<typeof addCatalogAvailability>>,
  category: SoftwareRequestCategory
) => {
  if (!results.length) return results;
  try {
    const requests = await getRepository(SoftwareRequest).find({
      where: {
        category,
        catalogId: In(results.map((game) => game.igdbId)),
        status: In([
          'pending',
          'approved',
          'searching',
          'downloading',
          'importing',
          'available',
        ]),
      },
    });
    return results.map((game) => {
      const tracked = requests.filter(
        (request) => request.catalogId === game.igdbId
      );
      const availableSystems = [
        ...new Set([
          ...(game.availableSystems ?? []),
          ...tracked
            .filter(
              (request) =>
                request.status === 'available' && request.platformSlug
            )
            .map((request) => request.platformSlug as string),
        ]),
      ];
      const statuses = tracked.map((request) => request.status);
      const availability: CatalogAvailability =
        game.availability === 'available' || statuses.includes('available')
          ? 'available'
          : game.availability === 'downloading' ||
              statuses.includes('downloading') ||
              statuses.includes('importing')
            ? 'downloading'
            : game.availability === 'tracked' ||
                statuses.includes('pending') ||
                statuses.includes('approved') ||
                statuses.includes('searching')
              ? 'tracked'
              : game.availability;
      return {
        ...game,
        availability,
        ...(category === 'game' ? {} : { availableSystems }),
      };
    });
  } catch (error) {
    logger.warn('Software request availability lookup failed', {
      ...getHttpErrorDetails(error),
      category,
    });
    return results;
  }
};

const catalogResultsWithAvailability = async (
  results: CatalogGameResult[],
  category: SoftwareRequestCategory
) =>
  addTrackedRequestAvailability(
    await addCatalogAvailability(results, category),
    category
  );

const getQuestarrApi = (): QuestarrNGAPI => {
  const settings = getSettings().softwareAcquisition.questarr;
  if (!settings.hostname || !settings.apiKey) {
    throw new SoftwareProviderNotConfiguredError(
      'QuestarrNG is not configured.'
    );
  }
  return new QuestarrNGAPI(settings);
};

const getCatalogProviderName = (category: SoftwareRequestCategory) =>
  category !== 'game' &&
  getSettings().softwareAcquisition.emulationCatalogProvider === 'romarr'
    ? 'ROMarrNG'
    : 'QuestarrNG';

const getCatalogApi = (
  category: SoftwareRequestCategory
): SoftwareCatalogApi => {
  const settings = getSettings().softwareAcquisition;
  if (category !== 'game' && settings.emulationCatalogProvider === 'romarr') {
    if (!settings.romarr.hostname || !settings.romarr.apiKey) {
      throw new SoftwareProviderNotConfiguredError(
        'ROMarrNG is not configured.'
      );
    }
    return new ROMarrNGAPI(settings.romarr);
  }
  return getQuestarrApi();
};

const serializeRequest = (
  request: SoftwareRequest,
  actions?: SoftwareProviderActions | null
) => ({
  id: request.id,
  requestedBy: request.requestedBy
    ? {
        id: request.requestedBy.id,
        displayName: request.requestedBy.displayName,
        avatar: request.requestedBy.avatar,
      }
    : null,
  approvedById: request.approvedById ?? null,
  category: request.category,
  provider: request.provider,
  status: request.status,
  title: request.title,
  summary: request.summary ?? null,
  coverUrl: request.coverUrl ?? null,
  catalogId: request.catalogId ?? null,
  actions: actions ?? null,
  platform: request.platformSlug
    ? {
        slug: request.platformSlug,
        name: request.platformName,
        catalogId: request.platformId ?? null,
      }
    : null,
  variant:
    request.operatingSystem && request.architecture
      ? {
          operatingSystem: request.operatingSystem,
          architecture: request.architecture,
        }
      : null,
  attempt: request.attempt,
  percent: request.percent ?? null,
  error: request.errorMessage ?? null,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const getRequestForViewer = async (id: number, userId: number) => {
  const request = await getRepository(SoftwareRequest).findOne({
    where: { id },
    relations: { requestedBy: true },
  });
  if (!request) return null;
  const user = await getRepository(User).findOneBy({ id: userId });
  if (!user || !hasSoftwareRequestAccess(request, user)) return null;
  return request;
};

const respondProviderError = (
  res: Parameters<Parameters<typeof softwareRoutes.get>[1]>[1],
  error: unknown
) => {
  if (error instanceof SoftwareProviderNotConfiguredError) {
    return res.status(503).json({ error: error.message });
  }
  if (axios.isAxiosError(error) && error.response?.status === 409) {
    return res.status(409).json({
      error:
        'The provider cannot cancel this request in its current state. Check the provider or download client.',
    });
  }
  logger.warn('Software acquisition provider request failed', {
    ...getHttpErrorDetails(error),
  });
  return res
    .status(502)
    .json({ error: 'Software acquisition provider is unavailable.' });
};

const respondEmulationCatalogUnavailable = (
  res: Parameters<Parameters<typeof softwareRoutes.get>[1]>[1],
  category: SoftwareRequestCategory,
  error: unknown,
  includeNotFound = true
): boolean => {
  const status =
    axios.isAxiosError(error) && Number(error.response?.status)
      ? Number(error.response?.status)
      : undefined;
  if (
    category === 'game' ||
    getCatalogProviderName(category) !== 'ROMarrNG' ||
    (status !== 503 && !(includeNotFound && status === 404))
  ) {
    return false;
  }
  res.status(503).json({
    error:
      'ROMarrNG’s emulation catalog is unavailable. Configure IGDB and the SeerrNG catalog contract in ROMarrNG, or select QuestarrNG as the emulation catalog source.',
  });
  return true;
};

softwareRoutes.use(isAuthenticated());

softwareRoutes.get('/catalog/systems', async (_req, res) => {
  try {
    return res.status(200).json({ results: await getEmulationPlatforms() });
  } catch (error) {
    return respondProviderError(res, error);
  }
});

softwareRoutes.get('/catalog/search', async (req, res) => {
  const parsed = parseCatalogQuery(req.query);
  if (!parsed) {
    return res.status(400).json({
      error: 'A valid category, search query, and limit are required.',
    });
  }
  if (!isSoftwareCategoryEnabled(parsed.category)) {
    return disabledCategoryResponse(res, parsed.category);
  }

  try {
    const api = getCatalogApi(parsed.category);
    const { platformIds, systems } = await getCatalogCategoryContext(
      api,
      parsed.category,
      parsed.filters
    );
    if (!platformIds.length) {
      return res.status(200).json({ results: [], nextCursor: null });
    }
    let games: SoftwareCatalogGame[];
    let nextCursor: string | null;
    let legacyCatalog = false;
    try {
      const page = await api.searchCatalogPage(
        parsed.query,
        parsed.limit,
        parsed.cursor,
        platformIds,
        parsed.filters.genre,
        parsed.filters.releaseYear
      );
      games = page.results;
      nextCursor = normalizeNextCatalogCursor(page.nextCursor, parsed.cursor);
    } catch (error) {
      if (
        (parsed.filters.genre || parsed.filters.releaseYear) &&
        axios.isAxiosError(error) &&
        error.response?.status === 404
      ) {
        return res.status(503).json({
          error: `Upgrade ${getCatalogProviderName(parsed.category)} to use software genre and year filters.`,
        });
      }
      if (
        parsed.category !== 'game' &&
        getCatalogProviderName(parsed.category) === 'ROMarrNG' &&
        !parsed.cursor &&
        !parsed.filters.genre &&
        !parsed.filters.releaseYear &&
        axios.isAxiosError(error) &&
        error.response?.status === 404
      ) {
        return res.status(503).json({
          error:
            'Upgrade ROMarrNG to the SeerrNG catalog contract or switch the emulation catalog source to QuestarrNG.',
        });
      }
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const canUseUnpagedFallback =
        status === 404 ||
        status === 405 ||
        (status !== undefined && status >= 500);
      if (
        parsed.cursor ||
        parsed.filters.genre ||
        parsed.filters.releaseYear ||
        !canUseUnpagedFallback
      ) {
        throw error;
      }
      // The unpaged catalog can still return useful results when the optional
      // paged endpoint is unavailable or rejects a search query.
      games = await api.searchCatalog(
        parsed.query,
        CATALOG_PROVIDER_FETCH_LIMIT
      );
      nextCursor = null;
      legacyCatalog = true;
    }
    const results = mapCategoryGames(
      games,
      parsed.category,
      systems,
      parsed.filters
    ).slice(0, legacyCatalog ? CATALOG_PROVIDER_FETCH_LIMIT : parsed.limit);
    enqueueImageCacheWarm(extractImageCacheUrls(results));
    return res.status(200).json({
      results: await catalogResultsWithAvailability(results, parsed.category),
      nextCursor,
    });
  } catch (error) {
    if (respondEmulationCatalogUnavailable(res, parsed.category, error)) {
      return;
    }
    return respondProviderError(res, error);
  }
});

softwareRoutes.get('/catalog/popular', async (req, res) => {
  const category = req.query.category;
  const limit = req.query.limit === undefined ? 24 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CATALOG_LIMIT ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_CATALOG_OFFSET
  ) {
    return res
      .status(400)
      .json({ error: 'A valid category and limit are required.' });
  }
  if (!isSoftwareCategoryEnabled(category)) {
    return disabledCategoryResponse(res, category);
  }
  const filters = parseCatalogFilters(req.query, category);
  if (!filters) {
    return res.status(400).json({ error: 'Invalid software catalog filters.' });
  }

  try {
    const api = getCatalogApi(category);
    const { platformIds, systems } = await getCatalogCategoryContext(
      api,
      category,
      filters
    );
    if (!platformIds.length) {
      return res.status(200).json({ results: [], nextOffset: null });
    }
    let games: SoftwareCatalogGame[];
    let nextOffset: number | null;
    let legacyCatalog = false;
    try {
      const page = await api.getPopularCatalogPage(
        limit,
        offset,
        platformIds,
        filters.genre,
        filters.releaseYear
      );
      games = page.results;
      nextOffset = normalizeNextCatalogOffset(page.nextOffset, offset);
    } catch (error) {
      if (
        (filters.genre || filters.releaseYear) &&
        axios.isAxiosError(error) &&
        error.response?.status === 404
      ) {
        return res.status(503).json({
          error: `Upgrade ${getCatalogProviderName(category)} to use software genre and year filters.`,
        });
      }
      if (
        category !== 'game' &&
        getCatalogProviderName(category) === 'ROMarrNG' &&
        offset === 0 &&
        !filters.genre &&
        !filters.releaseYear &&
        axios.isAxiosError(error) &&
        error.response?.status === 404
      ) {
        return res.status(503).json({
          error:
            'Upgrade ROMarrNG to the SeerrNG catalog contract or switch the emulation catalog source to QuestarrNG.',
        });
      }
      if (
        offset > 0 ||
        filters.genre ||
        filters.releaseYear ||
        !axios.isAxiosError(error) ||
        error.response?.status !== 404
      ) {
        throw error;
      }
      games = await api.getPopularCatalog(CATALOG_PROVIDER_FETCH_LIMIT);
      nextOffset = null;
      legacyCatalog = true;
    }
    const results = mapCategoryGames(games, category, systems, filters).slice(
      0,
      legacyCatalog ? CATALOG_PROVIDER_FETCH_LIMIT : limit
    );
    enqueueImageCacheWarm(extractImageCacheUrls(results));
    return res.status(200).json({
      results: await catalogResultsWithAvailability(results, category),
      nextOffset,
    });
  } catch (error) {
    if (respondEmulationCatalogUnavailable(res, category, error)) {
      return;
    }
    return respondProviderError(res, error);
  }
});

softwareRoutes.get('/catalog/games/:id', async (req, res) => {
  const category = req.query.category;
  const catalogId = Number(req.params.id);
  if (
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !/^[1-9]\d*$/.test(req.params.id) ||
    !Number.isSafeInteger(catalogId)
  ) {
    return res
      .status(400)
      .json({ error: 'A valid title and category are required.' });
  }
  if (!isSoftwareCategoryEnabled(category)) {
    return disabledCategoryResponse(res, category);
  }

  try {
    const api = getCatalogApi(category);
    if (
      category !== 'game' &&
      getCatalogProviderName(category) === 'ROMarrNG'
    ) {
      try {
        await api.getCatalogPlatforms();
      } catch (error) {
        if (respondEmulationCatalogUnavailable(res, category, error)) {
          return;
        }
        throw error;
      }
    }
    const [game, systems] = await Promise.all([
      api.getCatalogGame(catalogId),
      category === 'game' ? Promise.resolve([]) : getEmulationPlatforms(),
    ]);
    const result = mapCategoryGames(
      [game],
      category,
      systems.filter((system) => system.group === category),
      {}
    )[0];
    if (!result) {
      return res
        .status(404)
        .json({ error: 'Title not found in this category.' });
    }
    enqueueImageCacheWarm(extractImageCacheUrls([result]));
    return res.status(200).json({
      game: (await catalogResultsWithAvailability([result], category))[0],
    });
  } catch (error) {
    if (respondEmulationCatalogUnavailable(res, category, error, false)) {
      return;
    }
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return res.status(404).json({ error: 'Catalog title not found.' });
    }
    return respondProviderError(res, error);
  }
});

softwareRoutes.post('/', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const category = body.category;
  const catalogId = Number(body.catalogId);
  if (
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !Number.isSafeInteger(catalogId) ||
    catalogId <= 0
  ) {
    return res.status(400).json({
      error: 'A valid software category and catalog title are required.',
    });
  }
  if (!isSoftwareCategoryEnabled(category)) {
    return disabledCategoryResponse(res, category);
  }
  if (!req.user?.hasPermission(Permission.REQUEST)) {
    return res
      .status(403)
      .json({ error: 'You do not have permission to request software.' });
  }
  const softwareQuota = (await req.user.getQuota()).software;
  if (
    softwareQuota.restricted &&
    !req.user.hasPermission(Permission.MANAGE_REQUESTS)
  ) {
    return res.status(403).json({ error: 'SOFTWARE_QUOTA_EXCEEDED' });
  }

  const repository = getRepository(SoftwareRequest);
  try {
    const selectedGame = sanitizeGame(
      await getCatalogApi(category).getCatalogGame(catalogId)
    );
    let provider: SoftwareRequestProvider;
    let platformSlug: string | null = null;
    let platformName: string | null = null;
    let platformId: number | null = null;
    let variant: PcGameVariant | null = null;

    if (category === 'game') {
      if (!isValidPcVariant(body.variant)) {
        return res.status(400).json({
          error:
            'Choose an operating system and architecture for this PC game.',
        });
      }
      if (
        !selectedGame.platformOptions.some(({ name }) => isPcPlatformName(name))
      ) {
        return res
          .status(400)
          .json({ error: 'The selected title has no supported PC release.' });
      }
      provider = 'questarr';
      variant = body.variant;
    } else {
      const requestedSlug =
        typeof body.platformSlug === 'string' ? body.platformSlug : '';
      const systems = await getEmulationPlatforms();
      const system = systems.find(
        (item) => item.slug === requestedSlug && item.group === category
      );
      if (!system) {
        return res.status(400).json({
          error: 'Choose a system assigned to this emulation category.',
        });
      }
      const catalogPlatform = systemMatchesGame(system, selectedGame);
      if (!catalogPlatform) {
        return res
          .status(400)
          .json({ error: 'The selected title is not listed for this system.' });
      }
      provider = 'romarr';
      platformSlug = system.slug;
      platformName = system.name;
      platformId = catalogPlatform.id;
    }

    const query = repository
      .createQueryBuilder('request')
      .where('request.requestedById = :userId', { userId: req.user.id })
      .andWhere('request.catalogId = :catalogId', { catalogId })
      .andWhere('request.category = :category', { category })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [...ACTIVE_STATUSES, 'available'],
      });
    if (platformSlug)
      query.andWhere('request.platformSlug = :platformSlug', { platformSlug });
    if (variant) {
      query
        .andWhere('request.operatingSystem = :operatingSystem', {
          operatingSystem: variant.operatingSystem,
        })
        .andWhere('request.architecture = :architecture', {
          architecture: variant.architecture,
        });
    }
    if (await query.getOne()) {
      return res.status(409).json({
        error: 'You already have this title requested for the selected target.',
      });
    }

    const request = repository.create({
      requestedById: req.user.id,
      category,
      provider,
      status: 'pending',
      externalRequestId: `seerrng:software:${randomUUID()}`,
      catalogId,
      title: selectedGame.title,
      summary: selectedGame.summary,
      coverUrl: selectedGame.coverUrl,
      platformSlug,
      platformName,
      platformId,
      operatingSystem: variant?.operatingSystem ?? null,
      architecture: variant?.architecture ?? null,
      attempt: 0,
      errorMessage: null,
    });
    await repository.save(request);
    const eventRepository = getRepository(SoftwareRequestStatusEvent);
    await eventRepository.save(
      eventRepository.create({
        requestId: request.id,
        requestedById: request.requestedById,
        status: request.status,
        message: 'Request submitted.',
        fingerprint: `${request.status}:0`,
      })
    );

    const actor = await getRepository(User).findOneBy({ id: req.user.id });
    if (
      actor?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.AUTO_APPROVE],
        { type: 'or' }
      )
    ) {
      const approved = await approveSoftwareRequest(request, actor.id);
      return res.status(201).json({
        request: serializeRequest(approved.request),
        status: approved.status,
        assets: approved.assets,
      });
    }

    const hydrated = await repository.findOne({
      where: { id: request.id },
      relations: { requestedBy: true },
    });
    await notifySoftwareRequestStatus(hydrated ?? request, 'pending');
    return res
      .status(201)
      .json({ request: serializeRequest(hydrated ?? request) });
  } catch (error) {
    if (error instanceof SoftwareProviderNotConfiguredError) {
      return res.status(503).json({ error: error.message });
    }
    logger.error('Failed to create software request', {
      userId: req.user.id,
      ...getHttpErrorDetails(error),
    });
    return res
      .status(502)
      .json({ error: 'Software request could not be created.' });
  }
});

softwareRoutes.get('/status', async (req, res) => {
  const { pageSize, skip } = parsePageParams(req.query, {
    take: 20,
    maxTake: 100,
  });
  const user = await getRepository(User).findOneBy({ id: req.user!.id });
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  const canViewAll = user.hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const repository = getRepository(SoftwareRequest);
  const requestedBy =
    req.query.requestedBy === undefined
      ? undefined
      : Number(req.query.requestedBy);
  const requestId =
    req.query.requestId === undefined ? undefined : Number(req.query.requestId);
  const rawFilter = req.query.filter;
  const rawCategory = req.query.category;
  if (
    rawFilter !== undefined &&
    (typeof rawFilter !== 'string' ||
      !softwareStatusFilters.includes(
        rawFilter as (typeof softwareStatusFilters)[number]
      ))
  ) {
    return res.status(400).json({ error: 'Invalid software status filter.' });
  }
  const filter = (rawFilter ?? 'all') as (typeof softwareStatusFilters)[number];
  const statuses = getStatusesForFilter(filter);
  if (
    rawCategory !== undefined &&
    (typeof rawCategory !== 'string' ||
      !['retro', 'modern', 'game'].includes(rawCategory))
  ) {
    return res.status(400).json({ error: 'Invalid software category.' });
  }
  const category = rawCategory as SoftwareRequestCategory | undefined;
  if (
    requestedBy !== undefined &&
    (!Number.isSafeInteger(requestedBy) || requestedBy <= 0)
  ) {
    return res.status(400).json({ error: 'Invalid requester id.' });
  }
  if (
    requestId !== undefined &&
    (!Number.isSafeInteger(requestId) || requestId <= 0)
  ) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }
  if (!canViewAll && requestedBy !== undefined && requestedBy !== user.id) {
    return res
      .status(403)
      .json({ error: 'Request view permission is required.' });
  }
  const query = repository
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .orderBy('request.createdAt', 'DESC')
    .skip(skip)
    .take(pageSize);
  if (requestedBy !== undefined) {
    query.where('request.requestedById = :userId', { userId: requestedBy });
  } else if (!canViewAll) {
    query.where('request.requestedById = :userId', { userId: user.id });
  }
  if (requestId !== undefined) {
    query.andWhere('request.id = :requestId', { requestId });
  }
  if (category !== undefined) {
    query.andWhere('request.category = :category', { category });
  }
  if (statuses?.length) {
    query.andWhere('request.status IN (:...statuses)', { statuses });
  } else if (statuses) {
    query.andWhere('1 = 0');
  }
  const [requests, total] = await query.getManyAndCount();
  const refreshedViews = await refreshSoftwareRequests(requests);
  const views = statuses
    ? refreshedViews.filter(({ status }) => statuses.includes(status))
    : refreshedViews;
  return res.status(200).json({
    results: views.map(
      ({ request, status, message, assets, actions, bundleName }) => ({
        request: serializeRequest(request, actions),
        status,
        message,
        assets: assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
          size: asset.size,
          url: `/api/v1/request/software/status/${request.id}/downloads/${encodeURIComponent(asset.id)}`,
          datVerified: asset.datVerified,
        })),
        bundle: bundleName
          ? {
              name: bundleName,
              url: `/api/v1/request/software/status/${request.id}/bundle`,
            }
          : null,
      })
    ),
    pageInfo: {
      pages: Math.ceil(total / pageSize),
      pageSize,
      results: requests.length,
      page: Math.floor(skip / pageSize) + 1,
    },
  });
});

softwareRoutes.get('/status/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid software request id.' });
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  const view = await refreshSoftwareRequest(request);
  const history = await getRepository(SoftwareRequestStatusEvent).find({
    where: { requestId: request.id },
    order: { createdAt: 'ASC' },
  });
  return res.status(200).json({
    request: serializeRequest(view.request, view.actions),
    status: view.status,
    message: view.message,
    history,
    assets: view.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      url: `/api/v1/request/software/status/${request.id}/downloads/${encodeURIComponent(asset.id)}`,
      datVerified: asset.datVerified,
    })),
    bundle: view.bundleName
      ? {
          name: view.bundleName,
          url: `/api/v1/request/software/status/${request.id}/bundle`,
        }
      : null,
  });
});

softwareRoutes.delete('/status/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }

  const request = await getRepository(SoftwareRequest).findOneBy({ id });
  if (!request) {
    return res.status(404).json({ error: 'Software request not found.' });
  }

  const canManage = req.user!.hasPermission(Permission.MANAGE_REQUESTS);
  const isOwner = request.requestedById === req.user!.id;
  if (
    !canManage &&
    (!isOwner || !req.user!.hasPermission(Permission.REQUEST))
  ) {
    return res.status(404).json({ error: 'Software request not found.' });
  }

  try {
    await dataSource.transaction(async (manager) => {
      const current = await manager.findOneBy(SoftwareRequest, { id });
      if (!current) {
        return;
      }
      if (current.status !== 'cancelled') {
        throw new SoftwareRequestStateError(
          'Only cancelled software requests can be cleared.'
        );
      }

      await manager.delete(SoftwareRequestStatusEvent, { requestId: id });
      const deletion = await manager.delete(SoftwareRequest, {
        id,
        status: 'cancelled',
      });
      if (deletion.affected !== 1) {
        throw new SoftwareRequestStateError(
          'Only cancelled software requests can be cleared.'
        );
      }
    });
    return res.status(204).send();
  } catch (error) {
    if (error instanceof SoftwareRequestStateError) {
      return res.status(409).json({ error: error.message });
    }
    logger.error('Failed to clear cancelled software request', {
      label: 'Software Request',
      requestId: id,
      ...getHttpErrorDetails(error),
    });
    return res
      .status(500)
      .json({ error: 'Software request could not be cleared.' });
  }
});

softwareRoutes.post('/status/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res
      .status(403)
      .json({ error: 'Request management permission is required.' });
  }
  const request = await getRepository(SoftwareRequest).findOneBy({ id });
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  try {
    const view = await approveSoftwareRequest(request, req.user.id);
    return res.status(200).json({
      request: serializeRequest(view.request, view.actions),
      status: view.status,
    });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError)
      return res.status(409).json({ error: error.message });
    return respondProviderError(res, error);
  }
});

softwareRoutes.post('/status/:id/decline', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res
      .status(403)
      .json({ error: 'Request management permission is required.' });
  }
  const request = await getRepository(SoftwareRequest).findOneBy({ id });
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  try {
    const declined = await declineSoftwareRequest(request, req.user.id);
    return res.status(200).json({ request: serializeRequest(declined) });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError)
      return res.status(409).json({ error: error.message });
    return res
      .status(500)
      .json({ error: 'Software request could not be declined.' });
  }
});

softwareRoutes.post('/status/:id/withdraw', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request || request.requestedById !== req.user!.id) {
    return res.status(404).json({ error: 'Software request not found.' });
  }
  if (!req.user!.hasPermission(Permission.REQUEST)) {
    return res.status(403).json({ error: 'Request permission is required.' });
  }
  try {
    const withdrawn = await withdrawPendingSoftwareRequest(request);
    return res.status(200).json({ request: serializeRequest(withdrawn) });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError)
      return res.status(409).json({ error: error.message });
    return res
      .status(500)
      .json({ error: 'Software request could not be withdrawn.' });
  }
});

softwareRoutes.post('/status/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid software request id.' });
  }
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request) {
    return res.status(404).json({ error: 'Software request not found.' });
  }
  const isOwner = request.requestedById === req.user!.id;
  if (
    !req.user!.hasPermission(Permission.MANAGE_REQUESTS) &&
    (!isOwner || !req.user!.hasPermission(Permission.REQUEST))
  ) {
    return res
      .status(403)
      .json({ error: 'Request management permission is required.' });
  }
  if (
    isRecord(req.body) &&
    req.body.confirmNoExistingDownload !== undefined &&
    typeof req.body.confirmNoExistingDownload !== 'boolean'
  ) {
    return res
      .status(400)
      .json({ error: 'Invalid cancellation confirmation.' });
  }
  const confirmNoExistingDownload =
    isRecord(req.body) && req.body.confirmNoExistingDownload === true;
  try {
    const cancelled = await cancelSoftwareRequest(
      request,
      confirmNoExistingDownload
    );
    return res.status(200).json({ request: serializeRequest(cancelled) });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError) {
      return res.status(409).json({ error: error.message });
    }
    if (
      isRecord(error) &&
      isRecord(error.response) &&
      isRecord(error.response.data) &&
      error.response.data.confirmationRequired === 'confirmNoExistingDownload'
    ) {
      return res.status(409).json({
        confirmationRequired: 'confirmNoExistingDownload',
        error:
          'The provider cannot confirm whether a previous download handoff started. Check the download queue and history before cancelling.',
      });
    }
    return respondProviderError(res, error);
  }
});

softwareRoutes.post('/status/:id/retry', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid software request id.' });
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  const isOwner = request.requestedById === req.user!.id;
  if (
    !req.user!.hasPermission(Permission.MANAGE_REQUESTS) &&
    (!isOwner || !req.user!.hasPermission(Permission.REQUEST))
  ) {
    return res
      .status(403)
      .json({ error: 'Request management permission is required.' });
  }
  if (
    isRecord(req.body) &&
    req.body.confirmNoExistingDownload !== undefined &&
    typeof req.body.confirmNoExistingDownload !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Invalid retry confirmation.' });
  }
  const confirmNoExistingDownload =
    isRecord(req.body) && req.body.confirmNoExistingDownload === true;
  try {
    const view = await retrySoftwareRequest(request, confirmNoExistingDownload);
    return res.status(200).json({
      request: serializeRequest(view.request, view.actions),
      status: view.status,
    });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError)
      return res.status(409).json({ error: error.message });
    if (error instanceof SoftwareRequestConfirmationRequiredError) {
      return res.status(409).json({
        confirmationRequired: 'confirmNoExistingDownload',
        error:
          'The provider cannot confirm whether the previous download started. Check the download queue and history before retrying.',
      });
    }
    return respondProviderError(res, error);
  }
});

softwareRoutes.get('/status/:id/downloads', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid software request id.' });
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  const view = await refreshSoftwareRequest(request);
  const assets = await listSoftwareRequestAssets(view.request);
  return res.status(200).json({
    results: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      url: `/api/v1/request/software/status/${request.id}/downloads/${encodeURIComponent(asset.id)}`,
      datVerified: asset.datVerified,
    })),
    bundle: view.bundleName
      ? {
          name: view.bundleName,
          url: `/api/v1/request/software/status/${request.id}/bundle`,
        }
      : null,
  });
});

softwareRoutes.get('/status/:id/bundle', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid software request id.' });
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  const view = await refreshSoftwareRequest(request);
  if (!view.bundleName)
    return res
      .status(404)
      .json({ error: 'A download bundle is not available.' });

  try {
    const result = await streamSoftwareRequestBundle(view.request);
    const filename = (result.filename ?? view.bundleName)
      .replace(/[\\/\r\n\0"<>:|?*]/g, '_')
      .slice(0, 180);
    const headers: Record<string, string> = {
      'Content-Type': result.contentType ?? 'application/gzip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename || view.bundleName)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (result.contentLength !== undefined)
      headers['Content-Length'] = String(result.contentLength);
    if (result.rangeSupported) headers['Accept-Ranges'] = 'bytes';
    if (result.contentRange) headers['Content-Range'] = result.contentRange;
    res.status(result.statusCode).set(headers);
    result.stream.on('error', (error) => {
      logger.warn('Software bundle stream ended with an error', {
        requestId: request.id,
        provider: request.provider,
        error: error.message,
      });
      if (!res.headersSent) res.status(502);
      else res.destroy(error);
    });
    res.on('close', () => {
      if (!res.writableEnded) result.stream.destroy();
    });
    return result.stream.pipe(res);
  } catch {
    return res
      .status(502)
      .json({ error: 'Download bundle could not be streamed.' });
  }
});

softwareRoutes.get('/status/:id/downloads/:assetId', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: 'Invalid software request id.' });
  const request = await getRequestForViewer(id, req.user!.id);
  if (!request)
    return res.status(404).json({ error: 'Software request not found.' });
  const view = await refreshSoftwareRequest(request);
  const assets = await listSoftwareRequestAssets(view.request);
  const asset = assets.find((candidate) => candidate.id === req.params.assetId);
  if (!asset)
    return res.status(404).json({ error: 'Download copy not found.' });

  try {
    const range = req.header('range');
    const result = await streamSoftwareRequestAsset(view.request, asset, range);
    const filename = path.basename(asset.name).replace(/[\r\n"\\]/g, '_');
    const headers: Record<string, string> = {
      'Content-Type': result.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename || 'download'}"`,
      'Cache-Control': 'no-store',
    };
    if (result.contentLength !== undefined)
      headers['Content-Length'] = String(result.contentLength);
    if (result.rangeSupported) headers['Accept-Ranges'] = 'bytes';
    if (result.contentRange) headers['Content-Range'] = result.contentRange;
    res.status(result.statusCode).set(headers);
    result.stream.on('error', (error) => {
      logger.warn('Software download stream ended with an error', {
        requestId: request.id,
        provider: request.provider,
        error: error.message,
      });
      if (!res.headersSent) res.status(502);
      else res.destroy(error);
    });
    res.on('close', () => {
      if (!res.writableEnded) result.stream.destroy();
    });
    return result.stream.pipe(res);
  } catch {
    return res
      .status(502)
      .json({ error: 'Download copy could not be streamed.' });
  }
});

export default softwareRoutes;
