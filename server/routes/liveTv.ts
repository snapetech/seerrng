import TunerrAPI, { TunerrError } from '@server/api/tunerr';
import { getRepository } from '@server/datasource';
import RecordingRequest, {
  ACTIVE_RECORDING_STATUSES,
} from '@server/entity/RecordingRequest';
import SportsFollow from '@server/entity/SportsFollow';
import {
  findAiringsInSnapshot,
  guideIndex,
} from '@server/lib/liveTv/guideIndex';
import {
  cancelRecording,
  type CreateRecordingInput,
  createRecordingRequest,
  declineRecording,
  isTunerrConfigured,
  RecordingRequestError,
  scheduleRecording,
} from '@server/lib/liveTv/recordings';
import { listSportsTeams } from '@server/lib/liveTv/sports';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import type { Response } from 'express';
import { Router } from 'express';
import { In } from 'typeorm';

const MAX_TITLES = 4;
const MAX_TITLE_LENGTH = 300;

const liveTvRoutes = Router();

const sendError = (res: Response, error: unknown) => {
  if (error instanceof RecordingRequestError) {
    return res.status(error.status).json({ message: error.message });
  }
  throw error;
};

/** Public view of a recording request; requester details stay minimal. */
export const recordingView = (request: RecordingRequest) => ({
  id: request.id,
  kind: request.kind,
  status: request.status,
  title: request.title,
  subTitle: request.subTitle ?? undefined,
  mediaType: request.mediaType ?? undefined,
  tmdbId: request.tmdbId ?? undefined,
  channel: request.channelId ?? undefined,
  channelName: request.channelName ?? undefined,
  startsAt: request.startsAt ?? undefined,
  endsAt: request.endsAt ?? undefined,
  completedCount: request.completedCount,
  failedCount: request.failedCount,
  lastError: request.lastError ?? undefined,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  requestedBy: request.requestedBy
    ? {
        id: request.requestedBy.id,
        displayName: request.requestedBy.displayName,
      }
    : undefined,
});

const parseTitles = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((title): title is string => typeof title === 'string')
    .map((title) => title.trim())
    .filter((title) => title.length > 0 && title.length <= MAX_TITLE_LENGTH)
    .slice(0, MAX_TITLES);
};

export const parseCreateRecordingBody = (
  body: unknown
): CreateRecordingInput | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid recording request.' };
  }
  const value = body as Record<string, unknown>;
  if (value.kind !== 'airing' && value.kind !== 'series') {
    return { error: 'Choose to record one airing or the series.' };
  }
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return { error: 'A title is required.' };
  }
  const channel =
    typeof value.channel === 'string' && value.channel.trim().length <= 255
      ? value.channel.trim() || undefined
      : undefined;
  const start =
    typeof value.start === 'string' && value.start.length <= 64
      ? value.start
      : undefined;
  const mediaType =
    value.mediaType === 'movie' || value.mediaType === 'tv'
      ? value.mediaType
      : undefined;
  const tmdbId =
    typeof value.tmdbId === 'number' &&
    Number.isSafeInteger(value.tmdbId) &&
    value.tmdbId > 0
      ? value.tmdbId
      : undefined;
  return { kind: value.kind, title, channel, start, mediaType, tmdbId };
};

liveTvRoutes.get('/status', (req, res) => {
  const configured = isTunerrConfigured();
  const guide = guideIndex.status();
  const isAdmin = req.user?.hasPermission(Permission.ADMIN) ?? false;
  if (configured && !guide.ready) {
    void guideIndex.get();
  }
  return res.status(200).json({
    configured,
    guideReady: guide.ready,
    canRequest: req.user?.hasPermission(Permission.REQUEST) ?? false,
    ...(isAdmin ? { guide } : {}),
  });
});

liveTvRoutes.get('/airings', async (req, res) => {
  if (!isTunerrConfigured()) {
    return res.status(200).json({ configured: false, airings: [] });
  }
  const titles = parseTitles(req.query.title);
  if (titles.length === 0) {
    return res.status(400).json({ message: 'A title is required.' });
  }
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20)
  );
  const snapshot = await guideIndex.get();
  if (!snapshot) {
    return res
      .status(200)
      .json({ configured: true, guideReady: false, airings: [] });
  }
  return res.status(200).json({
    configured: true,
    guideReady: true,
    airings: findAiringsInSnapshot(snapshot, titles, new Date(), limit),
  });
});

liveTvRoutes.get('/recordings', async (req, res) => {
  const user = req.user!;
  const canViewAll = user.hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const scopeAll = req.query.scope === 'all' && canViewAll;
  const activeOnly = req.query.filter === 'active';
  const take = Math.min(
    100,
    Math.max(1, Number.parseInt(String(req.query.take ?? '50'), 10) || 50)
  );
  const skip = Math.max(
    0,
    Number.parseInt(String(req.query.skip ?? '0'), 10) || 0
  );

  const [results, total] = await getRepository(RecordingRequest).findAndCount({
    where: {
      ...(scopeAll ? {} : { requestedById: user.id }),
      ...(activeOnly ? { status: In(ACTIVE_RECORDING_STATUSES) } : {}),
    },
    order: { createdAt: 'DESC' },
    take,
    skip,
  });

  return res.status(200).json({
    pageInfo: { total, take, skip },
    results: results.map(recordingView),
  });
});

liveTvRoutes.post('/recordings', async (req, res) => {
  const user = req.user!;
  if (!user.hasPermission(Permission.REQUEST)) {
    return res
      .status(403)
      .json({ message: 'You do not have permission to request recordings.' });
  }
  const input = parseCreateRecordingBody(req.body);
  if ('error' in input) {
    return res.status(400).json({ message: input.error });
  }
  try {
    const request = await createRecordingRequest(user, input);
    return res.status(201).json(recordingView(request));
  } catch (error) {
    return sendError(res, error);
  }
});

const loadRequest = async (rawId: string) => {
  const id = parseNonNegativeRouteId(rawId);
  if (id === undefined) return undefined;
  return getRepository(RecordingRequest).findOne({ where: { id } });
};

liveTvRoutes.post('/recordings/:id/approve', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  const request = await loadRequest(req.params.id);
  if (!request)
    return res.status(404).json({ message: 'Recording not found.' });
  if (request.status !== 'pending') {
    return res
      .status(409)
      .json({ message: 'Only pending recordings can be approved.' });
  }
  if (request.endsAt && new Date(request.endsAt) <= new Date()) {
    request.status = 'failed';
    request.lastError = 'The airing ended before the request was approved.';
    await getRepository(RecordingRequest).save(request);
    return res.status(409).json({ message: request.lastError });
  }
  try {
    return res
      .status(200)
      .json(recordingView(await scheduleRecording(request, req.user)));
  } catch (error) {
    return sendError(res, error);
  }
});

liveTvRoutes.post('/recordings/:id/decline', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  const request = await loadRequest(req.params.id);
  if (!request)
    return res.status(404).json({ message: 'Recording not found.' });
  try {
    return res
      .status(200)
      .json(recordingView(await declineRecording(request, req.user)));
  } catch (error) {
    return sendError(res, error);
  }
});

liveTvRoutes.delete('/recordings/:id', async (req, res) => {
  const user = req.user!;
  const request = await loadRequest(req.params.id);
  if (!request)
    return res.status(404).json({ message: 'Recording not found.' });
  const isOwner = request.requestedById === user.id;
  if (
    !user.hasPermission(Permission.MANAGE_REQUESTS) &&
    (!isOwner || !user.hasPermission(Permission.REQUEST))
  ) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  try {
    return res
      .status(200)
      .json(recordingView(await cancelRecording(request, user)));
  } catch (error) {
    return sendError(res, error);
  }
});

liveTvRoutes.get('/sports/teams', async (_req, res) => {
  if (!isTunerrConfigured()) {
    return res.status(200).json({ configured: false, teams: [] });
  }
  try {
    const report = await new TunerrAPI(getSettings().tunerr).getSportsReport();
    return res.status(200).json({
      configured: true,
      enabled: report.enabled !== false,
      teams: listSportsTeams(report),
    });
  } catch (error) {
    return res.status(502).json({
      message:
        error instanceof TunerrError
          ? error.message
          : 'Tunerr sports schedules could not be loaded.',
    });
  }
});

const followView = (follow: SportsFollow) => ({
  id: follow.id,
  dataset: follow.dataset,
  team: follow.team,
  createdAt: follow.createdAt,
});

liveTvRoutes.get('/sports/follows', async (req, res) => {
  const follows = await getRepository(SportsFollow).find({
    where: { userId: req.user!.id },
    order: { dataset: 'ASC', team: 'ASC' },
  });
  return res.status(200).json({ results: follows.map(followView) });
});

liveTvRoutes.post('/sports/follows', async (req, res) => {
  const user = req.user!;
  if (!user.hasPermission(Permission.REQUEST)) {
    return res
      .status(403)
      .json({ message: 'You do not have permission to request recordings.' });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const dataset =
    typeof body.dataset === 'string' ? body.dataset.trim().toLowerCase() : '';
  const team = typeof body.team === 'string' ? body.team.trim() : '';
  if (!/^[a-z0-9_-]{1,32}$/.test(dataset) || !team || team.length > 128) {
    return res.status(400).json({ message: 'Choose a team to follow.' });
  }
  const repository = getRepository(SportsFollow);
  const count = await repository.count({ where: { userId: user.id } });
  if (count >= 20) {
    return res.status(409).json({ message: 'You can follow up to 20 teams.' });
  }
  const existing = await repository.findOne({
    where: { userId: user.id, dataset, team },
  });
  if (existing) return res.status(200).json(followView(existing));
  const saved = await repository.save(
    new SportsFollow({ userId: user.id, dataset, team })
  );
  return res.status(201).json(followView(saved));
});

liveTvRoutes.delete('/sports/follows/:id', async (req, res) => {
  const id = parseNonNegativeRouteId(req.params.id);
  const repository = getRepository(SportsFollow);
  const follow =
    id === undefined
      ? null
      : await repository.findOne({ where: { id, userId: req.user!.id } });
  if (!follow) return res.status(404).json({ message: 'Not following.' });
  await repository.remove(follow);
  return res.status(204).end();
});

export default liveTvRoutes;
