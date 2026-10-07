import ReadMeABookAPI, { ReadMeABookError } from '@server/api/readmeabook';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import ReadMeABookRequest from '@server/entity/ReadMeABookRequest';
import { User } from '@server/entity/User';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { authorizedRouteAccess } from '@server/middleware/authorizedMutation';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router, type NextFunction, type Response } from 'express';
import { In, MoreThan, Not } from 'typeorm';

const routes = Router();
const MAX_REQUEST_ID = 1_000_000_000;
const MAX_SEARCH_LENGTH = 160;

const record = (value: unknown): Record<string, unknown> | undefined =>
  !!value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const bounded = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
};
const requestView = (row: ReadMeABookRequest) => ({
  id: row.id,
  asin: row.asin,
  title: row.title,
  author: row.author,
  narrator: row.narrator ?? null,
  description: row.description ?? null,
  coverArtUrl: row.coverArtUrl ?? null,
  durationMinutes: row.durationMinutes ?? null,
  status: row.status,
  statusMessage: row.statusMessage ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const adminRequestView = (row: ReadMeABookRequest) => ({
  ...requestView(row),
  user: row.user
    ? { id: row.user.id, username: row.user.username, email: row.user.email }
    : null,
});
const api = () => new ReadMeABookAPI(getSettings().readmeabook);
const enabled = (_req: unknown, res: Response, next: NextFunction) => {
  if (!getSettings().readmeabook.enabled)
    return res.status(404).json({ message: 'ReadMeABook is not configured.' });
  return next();
};
routes.get('/status', (_req, res) =>
  res.status(200).json({ enabled: getSettings().readmeabook.enabled })
);
routes.use(enabled);

export const normalizeReadMeABookAudiobooks = (raw: unknown) => {
  const root = record(raw);
  const data = record(root?.data) ?? root;
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.audiobooks)
        ? data.audiobooks
        : Array.isArray(data?.books)
          ? data.books
          : Array.isArray(data?.items)
            ? data.items
            : [];
  return items.slice(0, 50).flatMap((item) => {
    const row = record(item);
    const asin = bounded(row?.asin, 20)?.toUpperCase();
    const title = bounded(row?.title, 512);
    const authors = Array.isArray(row?.authors)
      ? row.authors
          .map((author) =>
            typeof author === 'string'
              ? author
              : bounded(record(author)?.name, 512)
          )
          .filter((author): author is string => !!author)
          .join(', ')
      : undefined;
    const author = bounded(row?.author, 512) ?? bounded(authors, 512);
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !title || !author) return [];
    const image =
      bounded(row?.coverArtUrl, 2048) ??
      bounded(row?.coverArtURL, 2048) ??
      bounded(row?.cover, 2048);
    return [
      {
        asin,
        title,
        author,
        narrator: bounded(row?.narrator, 512) ?? null,
        description: bounded(row?.description, 8_000) ?? null,
        coverArtUrl: image && /^https:\/\//i.test(image) ? image : null,
        durationMinutes:
          Number.isSafeInteger(row?.durationMinutes) &&
          Number(row?.durationMinutes) > 0
            ? Number(row?.durationMinutes)
            : null,
        releaseDate: bounded(row?.releaseDate, 32) ?? null,
        rating:
          typeof row?.rating === 'number' && Number.isFinite(row.rating)
            ? row.rating
            : null,
      },
    ];
  });
};

const remoteIdFrom = (raw: unknown): string | undefined => {
  const root = record(raw);
  const request = record(root?.request) ?? record(root?.data) ?? root;
  const id = request?.id ?? request?.requestId;
  return typeof id === 'string' || typeof id === 'number'
    ? String(id).slice(0, 128)
    : undefined;
};
const remoteStatusFrom = (raw: unknown): string | undefined => {
  const root = record(raw);
  const request = record(root?.request) ?? record(root?.data) ?? root;
  return bounded(request?.status, 32);
};
const remoteDetailList = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) return [];
  const allowedFields = [
    'id',
    'type',
    'status',
    'title',
    'client',
    'downloadClient',
    'progress',
    'progressPercent',
    'speed',
    'message',
    'error',
    'createdAt',
    'updatedAt',
  ];
  return value.slice(0, 20).flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const safeDetails: Record<string, string | number> = {};
    for (const key of allowedFields) {
      const field = row[key];
      if (typeof field === 'string') {
        const text = bounded(field, 512);
        if (text) safeDetails[key] = text;
      } else if (typeof field === 'number' && Number.isFinite(field)) {
        safeDetails[key] = field;
      }
    }
    return [safeDetails];
  });
};
const remoteDetailsFrom = (raw: unknown) => {
  const root = record(raw);
  const data = record(root?.data) ?? root;
  const request = record(data?.request) ?? data;
  const history = data?.downloadHistory ?? request?.downloadHistory;
  const jobs = data?.jobs ?? request?.jobs;
  return {
    downloadHistory: remoteDetailList(history),
    jobs: remoteDetailList(jobs),
  };
};
const errorMessage = (error: unknown) =>
  error instanceof ReadMeABookError
    ? error.message
    : 'ReadMeABook could not process this request.';

routes.get('/search', async (req, res) => {
  const query =
    typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (!query || query.length > MAX_SEARCH_LENGTH) {
    return res
      .status(400)
      .json({ message: 'Enter a search up to 160 characters.' });
  }
  try {
    const result = await api().search(query);
    return res.status(200).json(normalizeReadMeABookAudiobooks(result));
  } catch (error) {
    return res.status(502).json({ message: errorMessage(error) });
  }
});

routes.get('/discover', async (req, res) => {
  const section =
    typeof req.query.section === 'string' ? req.query.section : '';
  const subject =
    typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  if (!['popular', 'new', 'subject'].includes(section)) {
    return res
      .status(400)
      .json({ message: 'Choose a valid audiobook section.' });
  }
  if (
    section === 'subject' &&
    (!subject || subject.length > 64 || !/^[a-z0-9_ -]+$/i.test(subject))
  ) {
    return res
      .status(400)
      .json({ message: 'Choose a valid audiobook subject.' });
  }
  try {
    const raw =
      section === 'popular'
        ? await api().getPopularAudiobooks()
        : section === 'new'
          ? await api().getNewReleases()
          : await api().search(subject.replaceAll('_', ' '));
    return res.status(200).json(normalizeReadMeABookAudiobooks(raw));
  } catch (error) {
    return res.status(502).json({ message: errorMessage(error) });
  }
});

routes.get('/requests', async (req, res) => {
  const items = await getRepository(ReadMeABookRequest).find({
    where: { userId: req.user!.id },
    order: { createdAt: 'DESC' },
    take: 100,
  });
  return res.status(200).json(items.map(requestView));
});

routes.post('/requests', async (req, res) => {
  const user = await getRepository(User).findOne({
    where: { id: req.user!.id },
  });
  if (
    !user ||
    !user.hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
      type: 'or',
    })
  ) {
    return res
      .status(403)
      .json({ message: 'You do not have permission to request audiobooks.' });
  }
  const body = record(req.body);
  const asin = bounded(body?.asin, 20)?.toUpperCase();
  const title = bounded(body?.title, 512);
  const author = bounded(body?.author, 512);
  const narrator =
    body?.narrator == null ? undefined : bounded(body.narrator, 512);
  const description =
    body?.description == null ? undefined : bounded(body.description, 8_000);
  const image =
    body?.coverArtUrl == null ? undefined : bounded(body.coverArtUrl, 2048);
  const durationMinutes =
    body?.durationMinutes == null ? undefined : body.durationMinutes;
  if (
    !asin ||
    !/^[A-Z0-9]{10}$/.test(asin) ||
    !title ||
    !author ||
    (body?.narrator != null && !narrator) ||
    (body?.description != null && !description) ||
    (body?.coverArtUrl != null && (!image || !/^https:\/\//i.test(image))) ||
    (durationMinutes !== undefined &&
      (!Number.isSafeInteger(durationMinutes) ||
        Number(durationMinutes) < 1 ||
        Number(durationMinutes) > 100_000))
  ) {
    return res.status(400).json({ message: 'Select a valid audiobook.' });
  }

  const repository = getRepository(ReadMeABookRequest);
  const existing = await repository.findOne({
    where: { userId: user.id, asin },
  });
  if (
    existing &&
    !['failed', 'denied', 'cancelled'].includes(existing.status)
  ) {
    return res
      .status(409)
      .json({ message: 'This audiobook has already been requested.' });
  }
  const quotaDefaults = getSettings().main.defaultQuotas.book;
  const quotaLimit = user.hasPermission(Permission.MANAGE_USERS)
    ? 0
    : (user.bookQuotaLimit ?? quotaDefaults.quotaLimit ?? 0);
  if (quotaLimit > 0) {
    const quotaDate = new Date();
    const quotaDays = user.bookQuotaDays ?? quotaDefaults.quotaDays;
    if (quotaDays) quotaDate.setDate(quotaDate.getDate() - quotaDays);
    const [libraryRequests, audiobookRequests] = await Promise.all([
      getRepository(MediaRequest).count({
        where: {
          requestedBy: { id: user.id },
          type: MediaType.BOOK,
          status: Not(
            In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED])
          ),
          ...(quotaDays ? { createdAt: MoreThan(quotaDate) } : {}),
        },
      }),
      repository.count({
        where: {
          userId: user.id,
          status: Not(In(['failed', 'denied', 'cancelled'])),
          ...(quotaDays ? { createdAt: MoreThan(quotaDate) } : {}),
        },
      }),
    ]);
    if (libraryRequests + audiobookRequests >= quotaLimit) {
      return res
        .status(429)
        .json({ message: 'Your book request quota has been reached.' });
    }
  }

  const row: ReadMeABookRequest = Object.assign(
    existing ?? new ReadMeABookRequest(),
    {
      userId: user.id,
      user,
      asin,
      title,
      author,
      narrator: narrator ?? null,
      description: description ?? null,
      coverArtUrl: image ?? null,
      durationMinutes: durationMinutes == null ? null : Number(durationMinutes),
      remoteId: null as string | null,
      status: hasAutoApprovePermission(user.permissions, 'book')
        ? 'pending'
        : 'awaiting_approval',
      statusMessage: null,
      updatedAt: new Date(),
    }
  );
  try {
    if (row.status === 'pending') {
      const remote = await api().createRequest({
        asin,
        title,
        author,
        ...(narrator ? { narrator } : {}),
        ...(description ? { description } : {}),
        ...(image ? { coverArtUrl: image } : {}),
        ...(durationMinutes ? { durationMinutes } : {}),
      });
      row.remoteId = remoteIdFrom(remote) ?? null;
      row.status = remoteStatusFrom(remote) ?? 'pending';
    }
    const saved = await repository.save(row);
    return res.status(201).json(requestView(saved));
  } catch (error) {
    if (existing) {
      existing.status = 'failed';
      existing.statusMessage = errorMessage(error);
      existing.updatedAt = new Date();
      await repository.save(existing);
    }
    return res.status(502).json({ message: errorMessage(error) });
  }
});

routes.get<{ id: string }>('/requests/:id', async (req, res) => {
  const id = parsePositiveRouteId(req.params.id, MAX_REQUEST_ID);
  if (!id) return res.status(404).json({ message: 'Request not found.' });
  const repository = getRepository(ReadMeABookRequest);
  const row = await repository.findOne({ where: { id, userId: req.user!.id } });
  if (!row) return res.status(404).json({ message: 'Request not found.' });
  if (!row.remoteId)
    return res
      .status(409)
      .json({ message: 'This request is waiting for approval.' });
  try {
    const remote = await api().getRequest(row.remoteId);
    row.status = remoteStatusFrom(remote) ?? row.status;
    const remoteRequest =
      record(record(remote)?.request) ??
      record(record(remote)?.data) ??
      record(remote);
    row.statusMessage = bounded(remoteRequest?.statusMessage, 512) ?? null;
    row.updatedAt = new Date();
    await repository.save(row);
    return res
      .status(200)
      .json({ ...requestView(row), ...remoteDetailsFrom(remote) });
  } catch (error) {
    return res.status(502).json({ message: errorMessage(error) });
  }
});

routes.get(
  '/admin/dashboard',
  authorizedRouteAccess(Permission.ADMIN),
  async (_req, res) => {
    try {
      const dashboard = await api().getAdminDashboard();
      return res.status(200).json(dashboard);
    } catch (error) {
      return res.status(502).json({ message: errorMessage(error) });
    }
  }
);

routes.get(
  '/admin/requests',
  authorizedRouteAccess(Permission.ADMIN),
  async (_req, res) => {
    const items = await getRepository(ReadMeABookRequest).find({
      where: { status: 'awaiting_approval' },
      relations: { user: true },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    return res.status(200).json(items.map(adminRequestView));
  }
);

routes.post<{ id: string }>(
  '/admin/requests/:id/approve',
  authorizedRouteAccess(Permission.ADMIN),
  async (req, res) => {
    const id = parsePositiveRouteId(req.params.id, MAX_REQUEST_ID);
    if (!id) return res.status(404).json({ message: 'Request not found.' });
    const repository = getRepository(ReadMeABookRequest);
    const row = await repository.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) return res.status(404).json({ message: 'Request not found.' });
    if (row.status !== 'awaiting_approval')
      return res
        .status(409)
        .json({ message: 'This request is no longer awaiting approval.' });
    try {
      const remote = await api().createRequest({
        asin: row.asin,
        title: row.title,
        author: row.author,
        ...(row.narrator ? { narrator: row.narrator } : {}),
        ...(row.description ? { description: row.description } : {}),
        ...(row.coverArtUrl ? { coverArtUrl: row.coverArtUrl } : {}),
        ...(row.durationMinutes
          ? { durationMinutes: row.durationMinutes }
          : {}),
      });
      row.remoteId = remoteIdFrom(remote) ?? null;
      row.status = remoteStatusFrom(remote) ?? 'pending';
      row.statusMessage = null;
      row.updatedAt = new Date();
      await repository.save(row);
      return res.status(200).json(adminRequestView(row));
    } catch (error) {
      return res.status(502).json({ message: errorMessage(error) });
    }
  }
);

routes.post<{ id: string }>(
  '/admin/requests/:id/deny',
  authorizedRouteAccess(Permission.ADMIN),
  async (req, res) => {
    const id = parsePositiveRouteId(req.params.id, MAX_REQUEST_ID);
    if (!id) return res.status(404).json({ message: 'Request not found.' });
    const repository = getRepository(ReadMeABookRequest);
    const row = await repository.findOne({
      where: { id, status: 'awaiting_approval' },
      relations: { user: true },
    });
    if (!row) return res.status(404).json({ message: 'Request not found.' });
    row.status = 'denied';
    row.updatedAt = new Date();
    await repository.save(row);
    return res.status(200).json(adminRequestView(row));
  }
);

export default routes;
