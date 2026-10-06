import { normalizeInfoHash } from '@server/api/downloadClients/types';
import liveDownloadMonitor, {
  LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION,
  type LiveDownloadUpdate,
} from '@server/lib/liveDownloads';
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

export const parseLiveDownloadIds = (value: unknown): string[] => {
  if (typeof value !== 'string' || value.length > MAX_IDS_QUERY_LENGTH) {
    return [];
  }
  const hashes = new Set<string>();
  for (const part of value.split(',')) {
    const hash = normalizeInfoHash(part);
    if (hash) {
      hashes.add(hash);
      if (hashes.size >= LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION) break;
    }
  }
  return [...hashes];
};

/**
 * Shape sent to browsers. Only administrators see which client reported a
 * download, matching how download titles are shown.
 */
export const toBrowserUpdate = (
  update: LiveDownloadUpdate,
  isAdmin: boolean
) => ({
  hash: update.hash,
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
 * Server-sent live progress for the info hashes the browser already received
 * from authorized request or media responses. Unknown or non-torrent IDs are
 * ignored, so only torrents the caller can name are reported.
 */
liveRoutes.get('/downloads', (req, res) => {
  const hashes = parseLiveDownloadIds(req.query.ids);
  if (hashes.length === 0) {
    return res.status(400).json({ message: 'No torrent download IDs given.' });
  }
  if (!liveDownloadMonitor.hasEnabledClients()) {
    // 204 tells EventSource not to reconnect.
    return res.status(204).end();
  }

  const userId = req.user?.id ?? -1;
  const userStreams = streamsByUser.get(userId) ?? 0;
  if (
    userStreams >= MAX_STREAMS_PER_USER ||
    totalStreams >= MAX_STREAMS_TOTAL
  ) {
    res.setHeader('Retry-After', '30');
    return res.status(429).json({ message: 'Too many live progress streams.' });
  }

  const isAdmin = req.user?.hasPermission(Permission.ADMIN) ?? false;
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

  const unsubscribe = liveDownloadMonitor.subscribe(hashes, (updates) => {
    res.write(
      `event: downloads\ndata: ${JSON.stringify(
        updates.map((update) => toBrowserUpdate(update, isAdmin))
      )}\n\n`
    );
  });

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
