import SlskdnAPI, { SlskdnError } from '@server/api/slskdn';
import { getRepository } from '@server/datasource';
import TrackRequest, {
  ACTIVE_TRACK_STATUSES,
} from '@server/entity/TrackRequest';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  getAlbumIssues,
  remediateAlbumIssues,
  toSongIdView,
} from '@server/lib/soulseek/libraryHealth';
import {
  TrackRequestError,
  canRequestTracks,
  cancelTrackRequest,
  createTrackRequests,
  declineTrackRequest,
  isSlskdnConfigured,
  startTrackSearch,
  type TrackInput,
} from '@server/lib/soulseek/trackRequests';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import type { Response } from 'express';
import { Router } from 'express';
import { In } from 'typeorm';

const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRACKS_PER_REQUEST = 50;
const MAX_SONGID_SOURCE = 2048;

/** SongID runs started by each user, so users can only read their own. */
const songIdOwners = new Map<string, number>();
const MAX_TRACKED_SONGID_RUNS = 2_000;

const soulseekRoutes = Router();

const sendError = (res: Response, error: unknown) => {
  if (error instanceof TrackRequestError) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error instanceof SlskdnError) {
    return res
      .status(error.kind === 'unsupported' ? 503 : 502)
      .json({ message: error.message });
  }
  throw error;
};

export const trackRequestView = (request: TrackRequest) => ({
  id: request.id,
  status: request.status,
  artist: request.artist,
  title: request.title,
  recordingMbid: request.recordingMbid ?? undefined,
  source: request.source,
  searchCount: request.searchCount,
  lastMatchCount: request.lastMatchCount,
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

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const parseTrackInputs = (
  body: unknown
): TrackInput[] | { error: string } => {
  const tracks =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { tracks?: unknown }).tracks
      : undefined;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { error: 'Add at least one track.' };
  }
  if (tracks.length > MAX_TRACKS_PER_REQUEST) {
    return { error: `Request up to ${MAX_TRACKS_PER_REQUEST} tracks at once.` };
  }
  const parsed: TrackInput[] = [];
  for (const track of tracks) {
    if (!track || typeof track !== 'object') {
      return { error: 'Each track needs an artist and title.' };
    }
    const value = track as Record<string, unknown>;
    const artist = text(value.artist, 255);
    const title = text(value.title, 255);
    if (!artist || !title) {
      return { error: 'Each track needs an artist and title.' };
    }
    const recordingMbid =
      typeof value.recordingMbid === 'string' &&
      MBID_PATTERN.test(value.recordingMbid)
        ? value.recordingMbid.toLowerCase()
        : undefined;
    const source = ['playlist', 'songid', 'manual'].includes(
      String(value.source)
    )
      ? String(value.source)
      : 'manual';
    parsed.push({ artist, title, recordingMbid, source });
  }
  return parsed;
};

soulseekRoutes.get('/status', async (req, res) => {
  const configured = isSlskdnConfigured();
  return res.status(200).json({
    configured,
    canRequest: req.user ? canRequestTracks(req.user) : false,
  });
});

soulseekRoutes.get('/track-requests', async (req, res) => {
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
  const [results, total] = await getRepository(TrackRequest).findAndCount({
    where: {
      ...(scopeAll ? {} : { requestedById: user.id }),
      ...(activeOnly ? { status: In(ACTIVE_TRACK_STATUSES) } : {}),
    },
    order: { createdAt: 'DESC' },
    take,
    skip,
  });
  return res.status(200).json({
    pageInfo: { total, take, skip },
    results: results.map(trackRequestView),
  });
});

soulseekRoutes.post('/track-requests', async (req, res) => {
  const user = req.user!;
  if (!canRequestTracks(user)) {
    return res
      .status(403)
      .json({ message: 'You do not have permission to request music.' });
  }
  const tracks = parseTrackInputs(req.body);
  if ('error' in tracks) {
    return res.status(400).json({ message: tracks.error });
  }
  try {
    const created = await createTrackRequests(user, tracks);
    return res.status(201).json({ results: created.map(trackRequestView) });
  } catch (error) {
    return sendError(res, error);
  }
});

const loadTrackRequest = async (rawId: string) => {
  const id = parseNonNegativeRouteId(rawId);
  if (id === undefined) return undefined;
  return getRepository(TrackRequest).findOne({ where: { id } });
};

soulseekRoutes.post('/track-requests/:id/approve', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  const request = await loadTrackRequest(req.params.id);
  if (!request) return res.status(404).json({ message: 'Request not found.' });
  if (request.status !== 'pending') {
    return res
      .status(409)
      .json({ message: 'Only pending requests can be approved.' });
  }
  try {
    return res
      .status(200)
      .json(trackRequestView(await startTrackSearch(request, req.user)));
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.post('/track-requests/:id/decline', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  const request = await loadTrackRequest(req.params.id);
  if (!request) return res.status(404).json({ message: 'Request not found.' });
  try {
    return res
      .status(200)
      .json(trackRequestView(await declineTrackRequest(request, req.user)));
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.delete('/track-requests/:id', async (req, res) => {
  const user = req.user!;
  const request = await loadTrackRequest(req.params.id);
  if (!request) return res.status(404).json({ message: 'Request not found.' });
  if (
    !user.hasPermission(Permission.MANAGE_REQUESTS) &&
    request.requestedById !== user.id
  ) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  try {
    return res
      .status(200)
      .json(trackRequestView(await cancelTrackRequest(request, user)));
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.get('/albums/:releaseGroupId/issues', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (!isSlskdnConfigured()) {
    return res.status(200).json({ configured: false, issues: [] });
  }
  const releaseGroupId = req.params.releaseGroupId;
  if (!MBID_PATTERN.test(releaseGroupId)) {
    return res.status(400).json({ message: 'Invalid album ID.' });
  }
  try {
    return res.status(200).json({
      configured: true,
      issues: await getAlbumIssues(releaseGroupId.toLowerCase()),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.post('/albums/:releaseGroupId/remediate', async (req, res) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (!isSlskdnConfigured()) {
    return res.status(404).json({ message: 'slskdN is not set up.' });
  }
  const releaseGroupId = req.params.releaseGroupId;
  const issueIds = (req.body as { issueIds?: unknown })?.issueIds;
  if (
    !MBID_PATTERN.test(releaseGroupId) ||
    !Array.isArray(issueIds) ||
    issueIds.length === 0 ||
    issueIds.length > 200 ||
    !issueIds.every((id) => typeof id === 'string' && id.length <= 128)
  ) {
    return res.status(400).json({ message: 'Choose issues to fix.' });
  }
  try {
    const result = await remediateAlbumIssues(
      releaseGroupId.toLowerCase(),
      issueIds as string[]
    );
    if (result.issueCount === 0) {
      return res
        .status(409)
        .json({ message: 'None of those issues can be fixed automatically.' });
    }
    return res.status(202).json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.post('/songid', async (req, res) => {
  const user = req.user!;
  if (!canRequestTracks(user)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (!isSlskdnConfigured()) {
    return res.status(404).json({ message: 'slskdN is not set up.' });
  }
  const source = text(
    (req.body as { source?: unknown })?.source,
    MAX_SONGID_SOURCE + 1
  );
  if (!source || source.length > MAX_SONGID_SOURCE) {
    return res
      .status(400)
      .json({ message: 'Paste a link or describe the song.' });
  }
  try {
    const run = await new SlskdnAPI(getSettings().slskdn).createSongIdRun(
      source
    );
    if (songIdOwners.size >= MAX_TRACKED_SONGID_RUNS) {
      const oldest = songIdOwners.keys().next().value;
      if (oldest) songIdOwners.delete(oldest);
    }
    songIdOwners.set(run.id, user.id);
    return res.status(202).json(await toSongIdView(run));
  } catch (error) {
    return sendError(res, error);
  }
});

soulseekRoutes.get('/songid/:id', async (req, res) => {
  const user = req.user!;
  const owner = songIdOwners.get(req.params.id);
  if (
    owner === undefined ||
    (owner !== user.id && !user.hasPermission(Permission.MANAGE_REQUESTS))
  ) {
    return res.status(404).json({ message: 'Identification not found.' });
  }
  try {
    const run = await new SlskdnAPI(getSettings().slskdn).getSongIdRun(
      req.params.id
    );
    if (!run) {
      return res.status(404).json({ message: 'Identification not found.' });
    }
    return res.status(200).json(await toSongIdView(run));
  } catch (error) {
    return sendError(res, error);
  }
});

export default soulseekRoutes;
