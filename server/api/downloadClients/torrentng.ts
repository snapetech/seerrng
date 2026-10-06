import {
  baseRequestConfig,
  clampProgress,
  clientUrl,
  type DownloadClientAdapter,
  DownloadClientError,
  type DownloadClientTestResult,
  estimateEta,
  type LiveTorrentState,
  type LiveTorrentStatus,
  nonNegative,
  normalizeInfoHash,
  optionalCount,
  safeMessage,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import { mapWithConcurrency } from '@server/utils/concurrency';
import axios from 'axios';

const LOOKUP_CONCURRENCY = 4;

/** Subset of TorrentNG's `TorrentSummary` (webui/src/api/client.ts). */
interface TorrentNGSummary {
  hash?: string;
  size_bytes?: number;
  bytes_done?: number;
  amount_left?: number;
  down_rate?: number;
  up_rate?: number;
  is_active?: boolean;
  complete?: boolean;
  state?: number;
  peers_connected?: number;
  peers_complete?: number;
  message?: string;
  finalizing?: boolean;
}

/**
 * TorrentNG `state`: 0 idle, 1 active, 2 checking, 3 error, 4 metadata
 * pending, 5 queued (docs/API.md).
 */
export const mapTorrentNGState = (
  torrent: TorrentNGSummary
): LiveTorrentState => {
  if (torrent.state === 3) return 'error';
  if (torrent.state === 2) return 'checking';
  if (torrent.state === 4) return 'metadata';
  if (torrent.complete || torrent.finalizing) {
    return torrent.is_active ? 'seeding' : 'completed';
  }
  if (torrent.state === 5) return 'queued';
  if (!torrent.is_active) return 'paused';
  return (torrent.down_rate ?? 0) === 0 && (torrent.peers_complete ?? 0) === 0
    ? 'stalled'
    : 'downloading';
};

export const mapTorrentNGTorrent = (
  torrent: TorrentNGSummary
): LiveTorrentStatus | undefined => {
  const hash = normalizeInfoHash(torrent.hash);
  if (!hash) {
    return undefined;
  }
  const size = nonNegative(torrent.size_bytes);
  const sizeLeft = Math.min(
    size,
    typeof torrent.amount_left === 'number'
      ? nonNegative(torrent.amount_left)
      : Math.max(0, size - nonNegative(torrent.bytes_done))
  );
  const downloadRate = nonNegative(torrent.down_rate);
  const state = mapTorrentNGState(torrent);

  return {
    hash,
    state,
    size,
    sizeLeft,
    progress: clampProgress(size > 0 ? (size - sizeLeft) / size : 0),
    downloadRate,
    uploadRate: nonNegative(torrent.up_rate),
    etaSeconds: estimateEta(sizeLeft, downloadRate),
    seeds: optionalCount(torrent.peers_complete),
    peers: optionalCount(torrent.peers_connected),
    message: state === 'error' ? safeMessage(torrent.message) : undefined,
  };
};

export default class TorrentNGClient implements DownloadClientAdapter {
  constructor(private readonly settings: DownloadClientSettings) {}

  private headers(): Record<string, string> | undefined {
    return this.settings.password
      ? { Authorization: `Bearer ${this.settings.password}` }
      : undefined;
  }

  private async get<T>(path: string): Promise<{ status: number; data: T }> {
    const response = await axios.get<T>(clientUrl(this.settings, path), {
      ...baseRequestConfig,
      headers: this.headers(),
    });
    if (response.status === 401 || response.status === 403) {
      throw new DownloadClientError(
        'TorrentNG rejected the API token.',
        'auth'
      );
    }
    return response;
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    const health = await this.get<{ version?: unknown }>('/health');
    if (health.status !== 200) {
      throw new DownloadClientError(
        `TorrentNG health check returned HTTP ${health.status}.`,
        'connection'
      );
    }
    // /health is public; confirm the token can read torrents too.
    const list = await this.get<unknown>('/api/v1/torrents?limit=1');
    if (list.status !== 200) {
      throw new DownloadClientError(
        `TorrentNG returned HTTP ${list.status}.`,
        'protocol'
      );
    }
    const version = health.data?.version;
    return {
      version: typeof version === 'string' ? version.slice(0, 64) : undefined,
    };
  }

  public async getTorrents(hashes: string[]): Promise<LiveTorrentStatus[]> {
    const results = await mapWithConcurrency(
      hashes,
      LOOKUP_CONCURRENCY,
      async (hash) => {
        const response = await this.get<TorrentNGSummary>(
          `/api/v1/torrents/${encodeURIComponent(hash)}`
        );
        if (response.status === 404) {
          return undefined;
        }
        if (response.status !== 200 || !response.data) {
          throw new DownloadClientError(
            `TorrentNG returned HTTP ${response.status}.`,
            'protocol'
          );
        }
        return mapTorrentNGTorrent(response.data);
      }
    );
    return results.filter((torrent): torrent is LiveTorrentStatus => !!torrent);
  }
}
