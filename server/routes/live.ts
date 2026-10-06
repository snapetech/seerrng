import { normalizeInfoHash } from '@server/api/downloadClients/types';
import liveDownloadMonitor, {
  LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION,
  type LiveDownloadUpdate,
} from '@server/lib/liveDownloads';
import { resolveLiveDownloadToken } from '@server/lib/liveDownloadTokens';
import { Permission } from '@server/lib/permissions';
import { Router } from 'express';

const HEARTBEAT_MS = 25_000;
/** Streams end periodically so a browser reconnects with its current IDs. */
const MAX_STREAM_MS = 30 * 60 * 1000;
const MAX_STREAMS_PER_USER = 8;
const MAX_STREAMS_TOTAL = 256;
const MAX_IDS_QUERY_LENGTH = 16_384;

const streamsByUser = new Map<number, number>();
let totalStreams = 0;

export interface LiveDownloadSubscriptionId {
  id: string;
  hash: string;
}

export const parseLiveDownloadIds = (
  value: unknown,
  userId: number,
  allowRawHashes = false
): LiveDownloadSubscriptionId[] => {
  if (
    typeof value !== 'string' ||
    value.length > MAX_IDS_QUERY_LENGTH ||
    !Number.isSafeInteger(userId) ||
    userId < 0
  ) {
    return [];
  }

  const ids = new Map<string, string>();
  for (const part of value.split(',')) {
    const tokenHash = resolveLiveDownloadToken(part, userId);
    const hash =
      tokenHash ?? (allowRawHashes ? normalizeInfoHash(part) : undefined);
    if (hash) {
      ids.set(tokenHash ? part : hash, hash);
      if (ids.size >= LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION) break;
    }
  }
  return [...ids].map(([id, hash]) => ({ id, hash }));
};

/**
 * Shape sent to browsers. Only administrators see which client reported a
 * download, matching how download titles are shown.
 */
export const toBrowserUpdate = (
  update: LiveDownloadUpdate,
  id: string,
  isAdmin: boolean
) => ({
  id,
  state: update.state,
  size: update.size,
  sizeLeft: update.sizeLeft,
  progress: update.progress,
  downloadRate: update.downloadRate,
  uploadRate: update.uploadRate,
  etaSeconds: update.etaSeconds,
  seeds: update.seeds,
  peers: update.peers,
  observedAt: update.observedAt,
  ...(isAdmin
    ? { clientName: update.clientName, message: update.message }
    : {}),
});

const liveRoutes = Router();

/**
 * Server-sent live progress for the opaque IDs the browser received with
 * authorized media responses. Administrators may also supply raw info hashes.
 * Unknown IDs are ignored, so callers can only subscribe to visible torrents.
 */
liveRoutes.get('/downloads', (req, res) => {
  const userId = req.user?.id ?? -1;
  const isAdmin = req.user?.hasPermission(Permission.ADMIN) ?? false;
  const ids = parseLiveDownloadIds(req.query.ids, userId, isAdmin);
  if (ids.length === 0) {
    return res
      .status(400)
      .json({ message: 'No valid live download IDs given.' });
  }
  if (!liveDownloadMonitor.hasEnabledClients()) {
    // 204 tells EventSource not to reconnect.
    return res.status(204).end();
  }

  const userStreams = streamsByUser.get(userId) ?? 0;
  if (
    userStreams >= MAX_STREAMS_PER_USER ||
    totalStreams >= MAX_STREAMS_TOTAL
  ) {
    res.setHeader('Retry-After', '30');
    return res.status(429).json({ message: 'Too many live progress streams.' });
  }

  streamsByUser.set(userId, userStreams + 1);
  totalStreams += 1;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // no-transform keeps the compression middleware from buffering events.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const idsByHash = new Map<string, string[]>();
  for (const { id, hash } of ids) {
    const hashIds = idsByHash.get(hash) ?? [];
    hashIds.push(id);
    idsByHash.set(hash, hashIds);
  }

  const unsubscribe = liveDownloadMonitor.subscribe(
    [...idsByHash.keys()],
    (updates, missingHashes) => {
      const payload: Record<string, unknown>[] = updates.flatMap((update) =>
        (idsByHash.get(update.hash) ?? []).map((id) =>
          toBrowserUpdate(update, id, isAdmin)
        )
      );
      for (const hash of missingHashes) {
        for (const id of idsByHash.get(hash) ?? []) {
          payload.push({ id, unavailable: true });
        }
      }
      if (payload.length > 0) {
        res.write(`event: downloads\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    }
  );

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const lifetime = setTimeout(() => res.end(), MAX_STREAM_MS);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
    const remaining = (streamsByUser.get(userId) ?? 1) - 1;
    if (remaining > 0) {
      streamsByUser.set(userId, remaining);
    } else {
      streamsByUser.delete(userId);
    }
    totalStreams = Math.max(0, totalStreams - 1);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
});

export default liveRoutes;
