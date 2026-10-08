import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
import SteamAPI, {
  MAX_STEAM_GAMES_PER_SYNC,
  STEAM_OPENID_ENDPOINT,
  SteamLibraryUnavailableError,
} from '@server/api/software/steam';
import type { SoftwareCatalogGame } from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import GameLibraryAccount from '@server/entity/GameLibraryAccount';
import GameLibraryEntry, {
  type GameLibraryCategory,
  type GameLibraryStatus,
} from '@server/entity/GameLibraryEntry';
import SoftwareRequest from '@server/entity/SoftwareRequest';
import type { SharedGame } from '@server/lib/gameLibrary';
import {
  getSharedGameLibrary,
  isGameLibraryCategory,
  isGameLibraryStatus,
  markSteamOwnershipUnverified,
  normalizeGameTitle,
  serializeGameLibraryEntry,
  SharedGameLibraryLimitError,
  syncSteamLibrary,
} from '@server/lib/gameLibrary';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { parsePositiveRouteId } from '@server/utils/routeId';
import axios from 'axios';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { In, IsNull } from 'typeorm';

const gameLibraryRoutes = Router();
gameLibraryRoutes.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
gameLibraryRoutes.use(isAuthenticated());
gameLibraryRoutes.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
    skip: () =>
      process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  })
);

const STEAM_ID_PATTERN = /^[0-9]{17}$/;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const MAX_CATALOG_ID = 2_147_483_647;
const MAX_LIBRARY_PAGE_SIZE = 100;
const CATALOG_IMAGE_HOST = 'images.igdb.com';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const requireBrowserSession = (req: Request): boolean =>
  Boolean(req.user && req.session?.userId === req.user.id);

const isSafeCatalogImage = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === CATALOG_IMAGE_HOST &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/igdb/image/upload/')
    );
  } catch {
    return false;
  }
};

const catalogGameForLibrary = async (
  category: GameLibraryCategory,
  catalogId: number
): Promise<SoftwareCatalogGame> => {
  const settings = getSettings().softwareAcquisition;
  const provider =
    category !== 'game' && settings.emulationCatalogProvider === 'romarr'
      ? 'romarr'
      : 'questarr';
  const providerSettings = settings[provider];
  if (!providerSettings.hostname || !providerSettings.apiKey) {
    throw new Error(
      `${provider === 'romarr' ? 'ROMarrNG' : 'QuestarrNG'} is not configured.`
    );
  }
  const api =
    provider === 'romarr'
      ? new ROMarrNGAPI(providerSettings)
      : new QuestarrNGAPI(providerSettings);
  const game = await api.getCatalogGame(catalogId);
  if (
    !isRecord(game) ||
    game.igdbId !== catalogId ||
    typeof game.title !== 'string' ||
    !game.title.trim()
  ) {
    throw new Error('The catalog could not confirm this game. Search again.');
  }
  return {
    id: `igdb-${catalogId}`,
    igdbId: catalogId,
    title: game.title.trim().slice(0, 512),
    summary:
      typeof game.summary === 'string' ? game.summary.slice(0, 5000) : '',
    coverUrl: isSafeCatalogImage(game.coverUrl) ? game.coverUrl : '',
    releaseDate:
      typeof game.releaseDate === 'string' ? game.releaseDate.slice(0, 32) : '',
    platforms: Array.isArray(game.platforms)
      ? game.platforms
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 100)
      : [],
    platformOptions: Array.isArray(game.platformOptions)
      ? game.platformOptions
          .filter(
            (value): value is { id: number; name: string } =>
              isRecord(value) &&
              Number.isSafeInteger(value.id) &&
              typeof value.name === 'string'
          )
          .slice(0, 100)
      : [],
    genres: [],
  };
};

const cleanUserLabel = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 120 && !/[\r\n\0]/.test(value)
    ? value.trim()
    : undefined;

const parsePageQuery = (req: Request) => {
  const rawLimit =
    req.query.limit === undefined ? '48' : String(req.query.limit);
  const rawOffset =
    req.query.offset === undefined ? '0' : String(req.query.offset);
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (
    !/^\d{1,3}$/.test(rawLimit) ||
    (req.query.limit !== undefined &&
      !['string', 'number'].includes(typeof req.query.limit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIBRARY_PAGE_SIZE ||
    !/^\d{1,7}$/.test(rawOffset) ||
    (req.query.offset !== undefined &&
      !['string', 'number'].includes(typeof req.query.offset)) ||
    !Number.isSafeInteger(offset) ||
    query.length > 120 ||
    (req.query.q !== undefined && typeof req.query.q !== 'string')
  ) {
    return undefined;
  }
  return { limit, offset, query };
};

const parseCatalogMutation = (
  value: unknown
):
  | {
      category: GameLibraryCategory;
      catalogId: number;
      status: GameLibraryStatus;
      isOwned: boolean;
      storeName: string;
      platformName: string;
      shareWithHousehold: boolean;
    }
  | undefined => {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([
    'category',
    'catalogId',
    'status',
    'isOwned',
    'storeName',
    'platformName',
    'shareWithHousehold',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  const catalogId = Number(value.catalogId);
  const storeName = cleanUserLabel(value.storeName ?? '');
  const platformName = cleanUserLabel(value.platformName ?? '');
  const status = value.status ?? 'backlog';
  const isOwned = value.isOwned ?? false;
  const shareWithHousehold = value.shareWithHousehold ?? false;
  if (
    !isGameLibraryCategory(value.category) ||
    !Number.isSafeInteger(catalogId) ||
    catalogId <= 0 ||
    catalogId > MAX_CATALOG_ID ||
    !isGameLibraryStatus(status) ||
    typeof isOwned !== 'boolean' ||
    typeof shareWithHousehold !== 'boolean' ||
    (shareWithHousehold && !isOwned) ||
    storeName === undefined ||
    platformName === undefined
  ) {
    return undefined;
  }
  return {
    category: value.category,
    catalogId,
    status,
    isOwned,
    storeName,
    platformName,
    shareWithHousehold,
  };
};

const parseCatalogMatchMutation = (
  value: unknown
):
  | {
      category: GameLibraryCategory;
      catalogId: number;
      status?: GameLibraryStatus;
      isOwned?: boolean;
      storeName?: string;
      platformName?: string;
      shareWithHousehold?: boolean;
    }
  | undefined => {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([
    'category',
    'catalogId',
    'status',
    'isOwned',
    'storeName',
    'platformName',
    'shareWithHousehold',
  ]);
  const catalogId = Number(value.catalogId);
  const storeName =
    value.storeName === undefined ? undefined : cleanUserLabel(value.storeName);
  const platformName =
    value.platformName === undefined
      ? undefined
      : cleanUserLabel(value.platformName);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    !isGameLibraryCategory(value.category) ||
    !Number.isSafeInteger(catalogId) ||
    catalogId <= 0 ||
    catalogId > MAX_CATALOG_ID ||
    (value.status !== undefined && !isGameLibraryStatus(value.status)) ||
    (value.isOwned !== undefined && typeof value.isOwned !== 'boolean') ||
    (value.shareWithHousehold !== undefined &&
      typeof value.shareWithHousehold !== 'boolean') ||
    (value.storeName !== undefined && storeName === undefined) ||
    (value.platformName !== undefined && platformName === undefined)
  ) {
    return undefined;
  }
  return {
    category: value.category,
    catalogId,
    ...(value.status === undefined ? {} : { status: value.status }),
    ...(value.isOwned === undefined ? {} : { isOwned: value.isOwned }),
    ...(storeName === undefined ? {} : { storeName }),
    ...(platformName === undefined ? {} : { platformName }),
    ...(value.shareWithHousehold === undefined
      ? {}
      : { shareWithHousehold: value.shareWithHousehold }),
  };
};

const parseManualMutation = (
  value: unknown
):
  | {
      category: GameLibraryCategory;
      title: string;
      status: GameLibraryStatus;
      isOwned: boolean;
      storeName: string;
      platformName: string;
      shareWithHousehold: boolean;
    }
  | undefined => {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([
    'category',
    'title',
    'status',
    'isOwned',
    'storeName',
    'platformName',
    'shareWithHousehold',
  ]);
  const category = value.category ?? 'game';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const status = value.status ?? 'backlog';
  const isOwned = value.isOwned ?? false;
  const storeName = cleanUserLabel(value.storeName ?? '');
  const platformName = cleanUserLabel(value.platformName ?? '');
  const shareWithHousehold = value.shareWithHousehold ?? false;
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    !isGameLibraryCategory(category) ||
    title.length === 0 ||
    title.length > 512 ||
    /[\r\n\0]/.test(title) ||
    !isGameLibraryStatus(status) ||
    typeof isOwned !== 'boolean' ||
    typeof shareWithHousehold !== 'boolean' ||
    (shareWithHousehold && !isOwned) ||
    storeName === undefined ||
    platformName === undefined
  ) {
    return undefined;
  }
  return {
    category,
    title,
    status,
    isOwned,
    storeName,
    platformName,
    shareWithHousehold,
  };
};

const saveCatalogEntry = async (
  userId: number,
  game: SoftwareCatalogGame,
  values: NonNullable<ReturnType<typeof parseCatalogMutation>>
) => {
  const externalKey = `igdb:${values.catalogId}`;
  return getRepository(GameLibraryEntry).manager.transaction(
    async (manager) => {
      const repository = manager.getRepository(GameLibraryEntry);
      let entry = await repository.findOneBy({ userId, externalKey });
      const matchingSteamEntries = (
        await repository.find({
          where: { userId, source: 'steam', catalogId: IsNull() },
        })
      ).filter(
        (candidate) =>
          normalizeGameTitle(candidate.title) === normalizeGameTitle(game.title)
      );
      const steamMatch =
        matchingSteamEntries.length === 1 ? matchingSteamEntries[0] : undefined;

      if (!entry && steamMatch) {
        entry = steamMatch;
        entry.externalKey = externalKey;
        entry.catalogId = values.catalogId;
        entry.source = 'manual';
      } else if (entry && steamMatch && entry.id !== steamMatch.id) {
        entry.steamAppId ??= steamMatch.steamAppId;
        entry.steamOwned ||= steamMatch.steamOwned;
        entry.playtimeMinutes = Math.max(
          entry.playtimeMinutes,
          steamMatch.playtimeMinutes
        );
        entry.isOwned ||= steamMatch.isOwned;
        entry.shareWithHousehold ||= steamMatch.shareWithHousehold;
        if (!entry.storeName) entry.storeName = steamMatch.storeName;
        if (!entry.platformName) entry.platformName = steamMatch.platformName;
        await repository.delete({ id: steamMatch.id, userId });
      }

      if (!entry) {
        entry = new GameLibraryEntry({
          userId,
          externalKey,
          catalogId: values.catalogId,
          category: values.category,
          title: game.title,
          summary: game.summary,
          coverUrl: game.coverUrl,
          releaseDate: game.releaseDate,
          status: values.status,
          isOwned: values.isOwned,
          steamAppId: null,
          steamOwned: false,
          playtimeMinutes: 0,
          storeName: values.storeName,
          platformName: values.platformName,
          shareWithHousehold: values.shareWithHousehold,
          source: 'manual',
          lastSyncedAt: null,
        });
      } else {
        // Adding a title that is already tracked refreshes catalog metadata
        // without resetting progress, ownership, or privacy choices.
        entry.category = values.category;
        entry.title = game.title;
        entry.summary = game.summary;
        entry.coverUrl = game.coverUrl;
        entry.releaseDate = game.releaseDate;
      }
      return repository.save(entry);
    }
  );
};

const steamSyncRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 4,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
});

const applicationUrl = (): string | undefined => {
  const configured = getSettings().main.applicationUrl?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
};

const steamCallbackUrl = (baseUrl: string): string =>
  `${baseUrl}/api/v1/game-library/steam/callback`;

const stateMatches = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
};

const redirectToGames = (result: 'connected' | 'error'): string => {
  const baseUrl = applicationUrl();
  if (!baseUrl) return `/games?steam=${result}`;
  const destination = new URL('games', `${baseUrl}/`);
  destination.searchParams.set('steam', result);
  return destination.toString();
};

gameLibraryRoutes.get('/', async (req, res) => {
  const page = parsePageQuery(req);
  if (!page)
    return res.status(400).json({ error: 'Invalid game library filters.' });
  const status = req.query.status;
  const category = req.query.category;
  if (
    (status !== undefined &&
      (typeof status !== 'string' || !isGameLibraryStatus(status))) ||
    (category !== undefined && !isGameLibraryCategory(category))
  ) {
    return res.status(400).json({ error: 'Invalid game library filters.' });
  }
  const queryBuilder = getRepository(GameLibraryEntry)
    .createQueryBuilder('entry')
    .where('entry.userId = :userId', { userId: req.user!.id });
  if (typeof status === 'string') {
    queryBuilder.andWhere('entry.status = :status', { status });
  }
  if (typeof category === 'string') {
    queryBuilder.andWhere('entry.category = :category', { category });
  }
  if (page.query) {
    const escapedQuery = page.query
      .toLowerCase()
      .replace(/[!%_]/g, (character) => `!${character}`);
    queryBuilder.andWhere("LOWER(entry.title) LIKE :query ESCAPE '!'", {
      query: `%${escapedQuery}%`,
    });
  }
  const [entries, total] = await queryBuilder
    .orderBy('entry.title', 'ASC')
    .addOrderBy('entry.id', 'ASC')
    .skip(page.offset)
    .take(page.limit)
    .getManyAndCount();
  const catalogIds = [
    ...new Set(
      entries
        .map(({ catalogId }) => catalogId)
        .filter((id): id is number => id !== null)
    ),
  ];
  const requests = catalogIds.length
    ? await getRepository(SoftwareRequest).find({
        where: {
          requestedById: req.user!.id,
          category: In(['game', 'retro', 'modern']),
          catalogId: In(catalogIds),
        },
      })
    : [];
  const latestRequest = new Map<string, SoftwareRequest>();
  for (const request of requests) {
    if (request.catalogId === null) continue;
    const key = `${request.category}:${request.catalogId}`;
    const previous = latestRequest.get(key);
    if (!previous || request.createdAt > previous.createdAt) {
      latestRequest.set(key, request);
    }
  }
  return res.json({
    total,
    nextOffset:
      page.offset + entries.length < total
        ? page.offset + entries.length
        : null,
    results: entries.map((entry) => ({
      ...serializeGameLibraryEntry(entry),
      request: latestRequest.has(`${entry.category}:${entry.catalogId}`)
        ? {
            id: latestRequest.get(`${entry.category}:${entry.catalogId}`)!.id,
            status: latestRequest.get(`${entry.category}:${entry.catalogId}`)!
              .status,
          }
        : null,
    })),
  });
});

gameLibraryRoutes.get('/shared', async (req, res) => {
  const page = parsePageQuery(req);
  if (!page)
    return res.status(400).json({ error: 'Invalid shared game filters.' });
  let games: SharedGame[];
  try {
    games = await getSharedGameLibrary();
  } catch (error) {
    if (error instanceof SharedGameLibraryLimitError) {
      return res.status(503).json({ error: error.message });
    }
    throw error;
  }
  const rawMinOwners = req.query.minOwners;
  const minOwners = rawMinOwners === undefined ? 1 : Number(rawMinOwners);
  if (
    (rawMinOwners !== undefined &&
      !['string', 'number'].includes(typeof rawMinOwners)) ||
    !Number.isSafeInteger(minOwners) ||
    minOwners < 1 ||
    minOwners > 20
  ) {
    return res.status(400).json({ error: 'Invalid shared game filters.' });
  }
  const filtered = games.filter(
    (game) =>
      game.ownerCount >= minOwners &&
      (!page.query ||
        game.title.toLowerCase().includes(page.query.toLowerCase()))
  );
  const results = filtered.slice(page.offset, page.offset + page.limit);
  return res.json({
    total: filtered.length,
    nextOffset:
      page.offset + results.length < filtered.length
        ? page.offset + results.length
        : null,
    results,
  });
});

gameLibraryRoutes.get('/lookup', async (req, res) => {
  const category = req.query.category;
  const catalogId =
    typeof req.query.catalogId === 'string' ||
    typeof req.query.catalogId === 'number'
      ? Number(req.query.catalogId)
      : NaN;
  if (
    !isGameLibraryCategory(category) ||
    !Number.isSafeInteger(catalogId) ||
    catalogId <= 0 ||
    catalogId > MAX_CATALOG_ID
  ) {
    return res.status(400).json({ error: 'Choose a valid catalog game.' });
  }
  const entry = await getRepository(GameLibraryEntry).findOneBy({
    userId: req.user!.id,
    externalKey: `igdb:${catalogId}`,
    category,
  });
  return res.json({
    entry: entry ? serializeGameLibraryEntry(entry) : null,
  });
});

gameLibraryRoutes.post('/', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const values = parseCatalogMutation(req.body);
  if (!values)
    return res
      .status(400)
      .json({ error: 'Choose a valid catalog game and library state.' });
  try {
    const game = await catalogGameForLibrary(values.category, values.catalogId);
    const entry = await saveCatalogEntry(req.user!.id, game, values);
    return res.status(200).json({ entry: serializeGameLibraryEntry(entry) });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return res.status(502).json({
        error: 'The game catalog could not confirm this title. Try again.',
      });
    }
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : 'The game could not be added to your library.',
    });
  }
});

gameLibraryRoutes.post('/manual', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const values = parseManualMutation(req.body);
  if (!values) {
    return res
      .status(400)
      .json({ error: 'Enter a valid game title and library state.' });
  }
  const normalizedTitle = normalizeGameTitle(values.title);
  if (!normalizedTitle) {
    return res
      .status(400)
      .json({ error: 'Enter a valid game title and library state.' });
  }
  const digest = createHash('sha256')
    .update(`${values.category}:${normalizedTitle}`)
    .digest('hex')
    .slice(0, 48);
  const externalKey = `manual:${digest}`;
  const repository = getRepository(GameLibraryEntry);
  const existing = await repository.findOneBy({
    userId: req.user!.id,
    externalKey,
  });
  if (existing) {
    return res.status(200).json({ entry: serializeGameLibraryEntry(existing) });
  }
  const entry = await repository.save(
    new GameLibraryEntry({
      userId: req.user!.id,
      externalKey,
      catalogId: null,
      category: values.category,
      title: values.title,
      summary: '',
      coverUrl: '',
      releaseDate: '',
      status: values.status,
      isOwned: values.isOwned,
      steamAppId: null,
      steamOwned: false,
      playtimeMinutes: 0,
      storeName: values.storeName,
      platformName: values.platformName,
      shareWithHousehold: values.shareWithHousehold,
      source: 'manual',
      lastSyncedAt: null,
    })
  );
  return res.status(201).json({ entry: serializeGameLibraryEntry(entry) });
});

gameLibraryRoutes.patch('/:id', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const id = parsePositiveRouteId(req.params.id, MAX_CATALOG_ID);
  const body = req.body;
  const allowed = new Set([
    'status',
    'isOwned',
    'storeName',
    'platformName',
    'shareWithHousehold',
  ]);
  if (
    !id ||
    !isRecord(body) ||
    Object.keys(body).length === 0 ||
    Object.keys(body).some((key) => !allowed.has(key))
  ) {
    return res
      .status(400)
      .json({ error: 'Choose valid game library changes.' });
  }
  const status = body.status;
  const storeName = cleanUserLabel(body.storeName);
  const platformName = cleanUserLabel(body.platformName);
  if (
    (status !== undefined && !isGameLibraryStatus(status)) ||
    (body.isOwned !== undefined && typeof body.isOwned !== 'boolean') ||
    (body.shareWithHousehold !== undefined &&
      typeof body.shareWithHousehold !== 'boolean') ||
    (body.storeName !== undefined && storeName === undefined) ||
    (body.platformName !== undefined && platformName === undefined)
  ) {
    return res
      .status(400)
      .json({ error: 'Choose valid game library changes.' });
  }
  const repository = getRepository(GameLibraryEntry);
  const entry = await repository.findOneBy({ id, userId: req.user!.id });
  if (!entry)
    return res.status(404).json({ error: 'Game not found in your library.' });
  if (status !== undefined) entry.status = status;
  if (body.isOwned !== undefined) entry.isOwned = body.isOwned as boolean;
  if (storeName !== undefined) entry.storeName = storeName;
  if (platformName !== undefined) entry.platformName = platformName;
  if (body.shareWithHousehold !== undefined) {
    const willBeOwned =
      (body.isOwned === undefined ? entry.isOwned : body.isOwned) ||
      entry.steamOwned;
    if (body.shareWithHousehold && !willBeOwned) {
      return res
        .status(400)
        .json({ error: 'Mark this game owned before sharing it.' });
    }
    entry.shareWithHousehold = body.shareWithHousehold as boolean;
  }
  if (body.isOwned === false && !entry.steamOwned) {
    entry.shareWithHousehold = false;
  }
  await repository.save(entry);
  return res.json({ entry: serializeGameLibraryEntry(entry) });
});

gameLibraryRoutes.post('/:id/match', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const id = parsePositiveRouteId(req.params.id, MAX_CATALOG_ID);
  const values = parseCatalogMatchMutation(req.body);
  if (!id || !values) {
    return res
      .status(400)
      .json({ error: 'Choose a valid catalog game match.' });
  }
  const repository = getRepository(GameLibraryEntry);
  const imported = await repository.findOneBy({ id, userId: req.user!.id });
  if (!imported)
    return res.status(404).json({ error: 'Game not found in your library.' });
  if (imported.catalogId !== null) {
    return res
      .status(409)
      .json({ error: 'This game is already linked to the catalog.' });
  }
  try {
    const game = await catalogGameForLibrary(values.category, values.catalogId);
    const matched = await repository.manager.transaction(async (manager) => {
      const entries = manager.getRepository(GameLibraryEntry);
      const duplicate = await entries.findOneBy({
        userId: req.user!.id,
        externalKey: `igdb:${values.catalogId}`,
      });
      if (duplicate && duplicate.id !== imported.id) {
        duplicate.steamAppId ??= imported.steamAppId;
        duplicate.steamOwned ||= imported.steamOwned;
        duplicate.playtimeMinutes = Math.max(
          duplicate.playtimeMinutes,
          imported.playtimeMinutes
        );
        duplicate.isOwned ||= imported.isOwned;
        duplicate.shareWithHousehold ||= imported.shareWithHousehold;
        if (!duplicate.storeName) duplicate.storeName = imported.storeName;
        if (!duplicate.platformName)
          duplicate.platformName = imported.platformName;
        duplicate.category = values.category;
        duplicate.title = game.title;
        duplicate.summary = game.summary;
        duplicate.coverUrl = game.coverUrl;
        duplicate.releaseDate = game.releaseDate;
        if (values.status !== undefined) duplicate.status = values.status;
        if (values.isOwned !== undefined) duplicate.isOwned = values.isOwned;
        if (values.storeName !== undefined)
          duplicate.storeName = values.storeName;
        if (values.platformName !== undefined)
          duplicate.platformName = values.platformName;
        if (values.shareWithHousehold !== undefined)
          duplicate.shareWithHousehold = values.shareWithHousehold;
        if (
          duplicate.shareWithHousehold &&
          !duplicate.isOwned &&
          !duplicate.steamOwned
        ) {
          throw new Error('Mark this game owned before sharing it.');
        }
        if (!duplicate.isOwned && !duplicate.steamOwned) {
          duplicate.shareWithHousehold = false;
        }
        await entries.save(duplicate);
        await entries.delete({ id: imported.id, userId: req.user!.id });
        return duplicate;
      }
      imported.externalKey = `igdb:${values.catalogId}`;
      imported.catalogId = values.catalogId;
      imported.category = values.category;
      imported.title = game.title;
      imported.summary = game.summary;
      imported.coverUrl = game.coverUrl;
      imported.releaseDate = game.releaseDate;
      imported.source = 'manual';
      if (values.status !== undefined) imported.status = values.status;
      if (values.isOwned !== undefined) imported.isOwned = values.isOwned;
      if (values.storeName !== undefined) {
        imported.storeName =
          values.storeName || (imported.steamOwned ? 'Steam' : '');
      } else if (!imported.storeName && imported.steamOwned) {
        imported.storeName = 'Steam';
      }
      if (values.platformName !== undefined) {
        imported.platformName = values.platformName;
      }
      if (values.shareWithHousehold !== undefined) {
        imported.shareWithHousehold = values.shareWithHousehold;
      }
      if (
        imported.shareWithHousehold &&
        !imported.isOwned &&
        !imported.steamOwned
      ) {
        throw new Error('Mark this game owned before sharing it.');
      }
      if (!imported.isOwned && !imported.steamOwned) {
        imported.shareWithHousehold = false;
      }
      return entries.save(imported);
    });
    return res.json({ entry: serializeGameLibraryEntry(matched) });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return res.status(502).json({
        error: 'The game catalog could not confirm this title. Try again.',
      });
    }
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : 'The game could not be linked to the catalog.',
    });
  }
});

gameLibraryRoutes.delete('/steam', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  await markSteamOwnershipUnverified(req.user!.id);
  await getRepository(GameLibraryAccount).delete({ userId: req.user!.id });
  return res.status(204).end();
});

gameLibraryRoutes.delete('/:id', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const id = parsePositiveRouteId(req.params.id, MAX_CATALOG_ID);
  if (!id)
    return res.status(400).json({ error: 'Invalid game library entry.' });
  const result = await getRepository(GameLibraryEntry).delete({
    id,
    userId: req.user!.id,
  });
  if (!result.affected)
    return res.status(404).json({ error: 'Game not found in your library.' });
  return res.status(204).end();
});

gameLibraryRoutes.get('/steam/status', async (req, res) => {
  const account = await getRepository(GameLibraryAccount).findOneBy({
    userId: req.user!.id,
  });
  return res.json({
    connected: Boolean(account),
    lastSyncedAt: account?.lastSyncedAt ?? null,
    lastSyncCount: account?.lastSyncCount ?? 0,
    apiKeyConfigured: Boolean(getSettings().softwareAcquisition.steamApiKey),
  });
});

gameLibraryRoutes.get('/steam/connect', async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const baseUrl = applicationUrl();
  if (!baseUrl) {
    return res.status(400).json({
      error: 'Set the SeerrNG application URL before connecting Steam.',
    });
  }
  const state = randomBytes(32).toString('hex');
  req.session.steamOpenIdState = state;
  req.session.steamOpenIdStateCreatedAt = Date.now();
  const authorizationUrl = new URL(STEAM_OPENID_ENDPOINT);
  authorizationUrl.searchParams.set(
    'openid.ns',
    'http://specs.openid.net/auth/2.0'
  );
  authorizationUrl.searchParams.set('openid.mode', 'checkid_setup');
  authorizationUrl.searchParams.set(
    'openid.return_to',
    `${steamCallbackUrl(baseUrl)}?state=${state}`
  );
  authorizationUrl.searchParams.set('openid.realm', new URL(baseUrl).origin);
  authorizationUrl.searchParams.set(
    'openid.identity',
    'http://specs.openid.net/auth/2.0/identifier_select'
  );
  authorizationUrl.searchParams.set(
    'openid.claimed_id',
    'http://specs.openid.net/auth/2.0/identifier_select'
  );
  return res.redirect(authorizationUrl.toString());
});

gameLibraryRoutes.get('/steam/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const expectedState = req.session?.steamOpenIdState;
  const createdAt = req.session?.steamOpenIdStateCreatedAt ?? 0;
  if (req.session) {
    req.session.steamOpenIdState = undefined;
    req.session.steamOpenIdStateCreatedAt = undefined;
  }
  if (
    !req.user ||
    req.session?.userId !== req.user.id ||
    !state ||
    !expectedState ||
    !stateMatches(state, expectedState) ||
    Date.now() - createdAt > OAUTH_STATE_TTL_MS ||
    Date.now() < createdAt
  ) {
    return res.redirect(redirectToGames('error'));
  }

  const baseUrl = applicationUrl();
  if (!baseUrl) return res.redirect(redirectToGames('error'));
  const assertion: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.query)) {
    if (
      name.startsWith('openid.') &&
      typeof value === 'string' &&
      value.length <= 4096
    ) {
      assertion[name] = value;
    }
  }
  const claimedId = assertion['openid.claimed_id'] ?? '';
  const steamId =
    /^https:\/\/steamcommunity\.com\/openid\/id\/([0-9]{17})$/.exec(
      claimedId
    )?.[1];
  const signed = (assertion['openid.signed'] ?? '').split(':');
  const responseNonce = assertion['openid.response_nonce'] ?? '';
  const nonceDate = Date.parse(responseNonce.slice(0, 20));
  const expectedReturnTo = `${steamCallbackUrl(baseUrl)}?state=${state}`;
  if (
    assertion['openid.ns'] !== 'http://specs.openid.net/auth/2.0' ||
    assertion['openid.mode'] !== 'id_res' ||
    assertion['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT ||
    assertion['openid.identity'] !== claimedId ||
    assertion['openid.return_to'] !== expectedReturnTo ||
    !steamId ||
    !STEAM_ID_PATTERN.test(steamId) ||
    !['claimed_id', 'identity', 'return_to', 'response_nonce'].every((name) =>
      signed.includes(name)
    ) ||
    !Number.isFinite(nonceDate) ||
    Date.now() - nonceDate > OAUTH_STATE_TTL_MS ||
    nonceDate > Date.now() + 60_000
  ) {
    return res.redirect(redirectToGames('error'));
  }

  try {
    const valid = await new SteamAPI('').verifyOpenIdAssertion(assertion);
    if (!valid) return res.redirect(redirectToGames('error'));
    const repository = getRepository(GameLibraryAccount);
    const existingOwner = await repository.findOneBy({ steamId });
    if (existingOwner && existingOwner.userId !== req.user.id) {
      return res.redirect(redirectToGames('error'));
    }
    const account = await repository.findOneBy({ userId: req.user.id });
    if (account && account.steamId !== steamId) {
      await markSteamOwnershipUnverified(req.user.id);
    }
    const linkedAccount =
      account ?? new GameLibraryAccount({ userId: req.user.id });
    linkedAccount.steamId = steamId;
    await repository.save(linkedAccount);
    return res.redirect(redirectToGames('connected'));
  } catch {
    logger.warn('Steam account verification failed', { userId: req.user.id });
    return res.redirect(redirectToGames('error'));
  }
});

gameLibraryRoutes.post('/steam/sync', steamSyncRateLimit, async (req, res) => {
  if (!requireBrowserSession(req)) {
    return res
      .status(403)
      .json({ error: 'A signed-in browser session is required.' });
  }
  const account = await getRepository(GameLibraryAccount).findOneBy({
    userId: req.user!.id,
  });
  if (!account)
    return res.status(409).json({ error: 'Connect your Steam account first.' });
  const apiKey = getSettings().softwareAcquisition.steamApiKey;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Steam library sync is not configured by an administrator.',
    });
  }
  try {
    const games = await new SteamAPI(apiKey).getOwnedGames(account.steamId);
    if (games.length > MAX_STEAM_GAMES_PER_SYNC) {
      return res
        .status(413)
        .json({ error: 'Steam returned too many games to sync safely.' });
    }
    return res.json(await syncSteamLibrary(req.user!.id, games));
  } catch (error) {
    if (error instanceof SteamLibraryUnavailableError) {
      return res.status(409).json({ error: error.message });
    }
    logger.warn('Steam game library sync failed', {
      userId: req.user!.id,
      ...(axios.isAxiosError(error)
        ? { status: error.response?.status, code: error.code }
        : {}),
    });
    return res.status(502).json({
      error: 'Steam could not return your game library. Try again later.',
    });
  }
});

export default gameLibraryRoutes;
