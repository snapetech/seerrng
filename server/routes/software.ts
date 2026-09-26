import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI, {
  type RomarrPlatform,
} from '@server/api/software/romarrng';
import type { SoftwareCatalogGame } from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import SoftwareRequest, {
  type SoftwareRequestCategory,
  type SoftwareRequestProvider,
  type SoftwareRequestStatus,
} from '@server/entity/SoftwareRequest';
import SoftwareRequestStatusEvent from '@server/entity/SoftwareRequestStatusEvent';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  approveSoftwareRequest,
  declineSoftwareRequest,
  hasSoftwareRequestAccess,
  isValidPcVariant,
  listSoftwareRequestAssets,
  refreshSoftwareRequest,
  refreshSoftwareRequests,
  retrySoftwareRequest,
  SoftwareProviderNotConfiguredError,
  SoftwareRequestConfirmationRequiredError,
  SoftwareRequestStateError,
  streamSoftwareRequestAsset,
  type PcGameVariant,
} from '@server/lib/softwareRequests';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { parsePageParams } from '@server/utils/pagination';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const softwareRoutes = Router();
const MAX_CATALOG_LIMIT = 50;
const ACTIVE_STATUSES: SoftwareRequestStatus[] = [
  'pending',
  'approved',
  'searching',
  'downloading',
  'importing',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parseCatalogQuery = (
  value: unknown
): {
  query: string;
  category: SoftwareRequestCategory;
  limit: number;
} | null => {
  if (!isRecord(value)) return null;
  const query = typeof value.q === 'string' ? value.q.trim() : '';
  const category = value.category;
  const limit = value.limit === undefined ? 24 : Number(value.limit);
  if (
    !query ||
    query.length > 200 ||
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CATALOG_LIMIT
  ) {
    return null;
  }
  return { query, category, limit };
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

const sanitizeGame = (game: SoftwareCatalogGame): SoftwareCatalogGame => ({
  id: `igdb-${game.igdbId}`,
  igdbId: game.igdbId,
  title: game.title.slice(0, 512),
  summary: typeof game.summary === 'string' ? game.summary.slice(0, 5000) : '',
  coverUrl:
    typeof game.coverUrl === 'string' &&
    /^https:\/\//i.test(game.coverUrl) &&
    game.coverUrl.length <= 2048
      ? game.coverUrl
      : '',
  releaseDate:
    typeof game.releaseDate === 'string' ? game.releaseDate.slice(0, 32) : '',
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

const getQuestarrApi = (): QuestarrNGAPI => {
  const settings = getSettings().softwareAcquisition.questarr;
  if (!settings.hostname || !settings.apiKey) {
    throw new SoftwareProviderNotConfiguredError(
      'QuestarrNG is not configured.'
    );
  }
  return new QuestarrNGAPI(settings);
};

const serializeRequest = (request: SoftwareRequest) => ({
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
  logger.warn('Software acquisition provider request failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return res
    .status(502)
    .json({ error: 'Software acquisition provider is unavailable.' });
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

  try {
    const api = getQuestarrApi();
    const games = (await api.searchCatalog(parsed.query, parsed.limit)).map(
      sanitizeGame
    );
    if (parsed.category === 'game') {
      return res.status(200).json({
        results: games.filter((game) =>
          game.platformOptions.some(({ name }) => isPcPlatformName(name))
        ),
      });
    }

    const systems = (await getEmulationPlatforms()).filter(
      (system) => system.group === parsed.category
    );
    const results = games.flatMap((game) => {
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
      return systemsForGame.length > 0
        ? [{ ...game, emulationSystems: systemsForGame }]
        : [];
    });
    return res.status(200).json({ results });
  } catch (error) {
    return respondProviderError(res, error);
  }
});

softwareRoutes.get('/catalog/popular', async (req, res) => {
  const category = req.query.category;
  const limit = req.query.limit === undefined ? 24 : Number(req.query.limit);
  if (
    (category !== 'retro' && category !== 'modern' && category !== 'game') ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CATALOG_LIMIT
  ) {
    return res
      .status(400)
      .json({ error: 'A valid category and limit are required.' });
  }

  try {
    const games = (await getQuestarrApi().getPopularCatalog(limit)).map(
      sanitizeGame
    );
    if (category === 'game') {
      return res.status(200).json({
        results: games.filter((game) =>
          game.platformOptions.some(({ name }) => isPcPlatformName(name))
        ),
      });
    }

    const systems = (await getEmulationPlatforms()).filter(
      (system) => system.group === category
    );
    const results = games.flatMap((game) => {
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
      return systemsForGame.length > 0
        ? [{ ...game, emulationSystems: systemsForGame }]
        : [];
    });
    return res.status(200).json({ results });
  } catch (error) {
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
  if (!req.user?.hasPermission(Permission.REQUEST)) {
    return res
      .status(403)
      .json({ error: 'You do not have permission to request software.' });
  }

  const repository = getRepository(SoftwareRequest);
  try {
    const selectedGame = sanitizeGame(
      await getQuestarrApi().getCatalogGame(catalogId)
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
    return res
      .status(201)
      .json({ request: serializeRequest(hydrated ?? request) });
  } catch (error) {
    if (error instanceof SoftwareProviderNotConfiguredError) {
      return res.status(503).json({ error: error.message });
    }
    logger.error('Failed to create software request', {
      userId: req.user.id,
      error: error instanceof Error ? error.message : String(error),
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
  const [requests, total] = await query.getManyAndCount();
  const views = await refreshSoftwareRequests(requests);
  return res.status(200).json({
    results: views.map(({ request, status, message, assets }) => ({
      request: serializeRequest(request),
      status,
      message,
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        url: `/api/v1/request/software/status/${request.id}/downloads/${encodeURIComponent(asset.id)}`,
      })),
    })),
    pageInfo: { pageSize, results: requests.length, total },
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
    request: serializeRequest(view.request),
    status: view.status,
    message: view.message,
    history,
    assets: view.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      url: `/api/v1/request/software/status/${request.id}/downloads/${encodeURIComponent(asset.id)}`,
    })),
  });
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
    return res
      .status(200)
      .json({ request: serializeRequest(view.request), status: view.status });
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
    return res
      .status(200)
      .json({ request: serializeRequest(view.request), status: view.status });
  } catch (error) {
    if (error instanceof SoftwareRequestStateError)
      return res.status(409).json({ error: error.message });
    if (error instanceof SoftwareRequestConfirmationRequiredError) {
      return res.status(409).json({
        confirmationRequired: 'confirmNoExistingDownload',
        error:
          'ROMarrNG cannot confirm whether the previous download started. Check the download queue and history before retrying.',
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
    })),
  });
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
