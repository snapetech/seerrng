import SlskdnAPI, { SlskdnError } from '@server/api/slskdn';
import { getRepository } from '@server/datasource';
import TrackRequest, {
  ACTIVE_TRACK_STATUSES,
} from '@server/entity/TrackRequest';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type SlskdnSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

export const MAX_ACTIVE_TRACK_REQUESTS_PER_USER = 50;
/** Give up on a wishlist search that has found nothing after this long. */
const SEARCH_GIVE_UP_MS = 14 * 24 * 60 * 60 * 1000;

export class TrackRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 502 | 503
  ) {
    super(message);
    this.name = 'TrackRequestError';
  }
}

export const isSlskdnConfigured = (
  settings: SlskdnSettings = getSettings().slskdn
) => settings.enabled && !!settings.hostname && !!settings.apiKey;

export const canRequestTracks = (user: User) =>
  user.hasPermission([Permission.REQUEST, Permission.REQUEST_MUSIC], {
    type: 'or',
  });

const canAutoApprove = (user: User) =>
  user.hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      Permission.AUTO_APPROVE,
      Permission.AUTO_APPROVE_MUSIC,
    ],
    { type: 'or' }
  );

/** The Soulseek search text for a track. Exposed for tests. */
export const trackSearchText = (artist: string, title: string) =>
  `${artist} ${title}`
    // Soulseek search ignores most punctuation and rejects some characters.
    .replace(/[^\p{L}\p{N}'&]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

export interface TrackInput {
  artist: string;
  title: string;
  recordingMbid?: string;
  source?: string;
}

const apiFor = () => new SlskdnAPI(getSettings().slskdn);

const toRequestError = (error: unknown, fallback: string) =>
  error instanceof TrackRequestError
    ? error
    : new TrackRequestError(
        error instanceof SlskdnError ? error.message : fallback,
        error instanceof SlskdnError && error.kind === 'unsupported' ? 503 : 502
      );

/** Adds the wishlist item in slskdN and marks the request searching. */
export const startTrackSearch = async (
  request: TrackRequest,
  approver: User
): Promise<TrackRequest> => {
  try {
    const item = await apiFor().createWishlistItem({
      searchText: trackSearchText(request.artist, request.title),
      filter: getSettings().slskdn.searchFilter,
    });
    request.wishlistItemId = item.id;
    request.status = 'searching';
    request.lastError = null;
  } catch (error) {
    throw toRequestError(error, 'slskdN could not be reached to search.');
  }
  request.modifiedBy = approver;
  return getRepository(TrackRequest).save(request);
};

export const createTrackRequests = async (
  user: User,
  tracks: TrackInput[]
): Promise<TrackRequest[]> => {
  if (!isSlskdnConfigured()) {
    throw new TrackRequestError('Soulseek requests are not set up.', 404);
  }
  const repository = getRepository(TrackRequest);
  const active = await repository.count({
    where: { requestedById: user.id, status: In(ACTIVE_TRACK_STATUSES) },
  });
  if (active + tracks.length > MAX_ACTIVE_TRACK_REQUESTS_PER_USER) {
    throw new TrackRequestError(
      `You can have up to ${MAX_ACTIVE_TRACK_REQUESTS_PER_USER} active track requests.`,
      409
    );
  }

  const created: TrackRequest[] = [];
  for (const track of tracks) {
    const duplicate = await repository.findOne({
      where: {
        requestedById: user.id,
        artist: track.artist,
        title: track.title,
        status: In(ACTIVE_TRACK_STATUSES),
      },
    });
    if (duplicate) {
      created.push(duplicate);
      continue;
    }
    created.push(
      await repository.save(
        new TrackRequest({
          requestedBy: user,
          requestedById: user.id,
          artist: track.artist,
          title: track.title,
          recordingMbid: track.recordingMbid ?? null,
          source: track.source ?? 'manual',
          status: 'pending',
        })
      )
    );
  }

  if (!canAutoApprove(user)) {
    return created;
  }
  const started: TrackRequest[] = [];
  for (const request of created) {
    if (request.status !== 'pending') {
      started.push(request);
      continue;
    }
    try {
      started.push(await startTrackSearch(request, user));
    } catch (error) {
      request.lastError =
        error instanceof Error ? error.message.slice(0, 500) : null;
      started.push(await repository.save(request));
    }
  }
  return started;
};

export const declineTrackRequest = async (
  request: TrackRequest,
  manager: User
) => {
  if (request.status !== 'pending') {
    throw new TrackRequestError('Only pending requests can be declined.', 409);
  }
  request.status = 'declined';
  request.modifiedBy = manager;
  return getRepository(TrackRequest).save(request);
};

export const cancelTrackRequest = async (request: TrackRequest, user: User) => {
  if (!ACTIVE_TRACK_STATUSES.includes(request.status)) {
    throw new TrackRequestError('This request is no longer active.', 409);
  }
  if (request.wishlistItemId) {
    try {
      await apiFor().deleteWishlistItem(request.wishlistItemId);
    } catch (error) {
      throw toRequestError(error, 'slskdN could not be reached to cancel.');
    }
  }
  request.status = 'cancelled';
  request.modifiedBy = user;
  return getRepository(TrackRequest).save(request);
};

export interface TrackSyncUpdate {
  status: TrackRequest['status'];
  searchCount: number;
  lastMatchCount: number;
  lastError?: string | null;
  removeWishlistItem: boolean;
}

/** Decides the next state from the wishlist item. Exposed for tests. */
export const nextTrackStatus = (
  request: Pick<TrackRequest, 'status' | 'createdAt'>,
  item:
    | {
        totalDownloadCount?: number;
        totalSearchCount?: number;
        lastMatchCount?: number;
      }
    | undefined,
  now: Date
): TrackSyncUpdate => {
  if (!item) {
    return {
      status: 'failed',
      searchCount: 0,
      lastMatchCount: 0,
      lastError: 'The slskdN wishlist entry was removed.',
      removeWishlistItem: false,
    };
  }
  const searchCount = item.totalSearchCount ?? 0;
  const lastMatchCount = item.lastMatchCount ?? 0;
  if ((item.totalDownloadCount ?? 0) > 0) {
    return {
      status: 'completed',
      searchCount,
      lastMatchCount,
      lastError: null,
      removeWishlistItem: false,
    };
  }
  if (
    now.getTime() - new Date(request.createdAt).getTime() >
    SEARCH_GIVE_UP_MS
  ) {
    return {
      status: 'failed',
      searchCount,
      lastMatchCount,
      lastError: 'No downloadable copy was found on Soulseek within two weeks.',
      removeWishlistItem: true,
    };
  }
  return {
    status: 'searching',
    searchCount,
    lastMatchCount,
    removeWishlistItem: false,
  };
};

let syncing = false;

export const syncTrackRequests = async (): Promise<void> => {
  if (syncing || !isSlskdnConfigured()) return;
  syncing = true;
  try {
    const repository = getRepository(TrackRequest);
    const requests = await repository.find({ where: { status: 'searching' } });
    if (requests.length === 0) return;
    const api = apiFor();
    const now = new Date();
    for (const request of requests) {
      if (!request.wishlistItemId) continue;
      const item = await api.getWishlistItem(request.wishlistItemId);
      const update = nextTrackStatus(request, item, now);
      if (update.removeWishlistItem) {
        await api.deleteWishlistItem(request.wishlistItemId);
      }
      request.status = update.status;
      request.searchCount = update.searchCount;
      request.lastMatchCount = update.lastMatchCount;
      if (update.lastError !== undefined) request.lastError = update.lastError;
      request.lastCheckedAt = now;
      await repository.save(request);
    }
  } catch (error) {
    logger.warn('Soulseek track request sync failed', {
      label: 'Soulseek',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    syncing = false;
  }
};
