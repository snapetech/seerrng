import {
  baseRequestConfig,
  clampProgress,
  clientUrl,
  DownloadClientError,
  nonNegative,
  normalizeInfoHash,
  optionalCount,
  readSetCookie,
  safeMessage,
  type DownloadClientAdapter,
  type DownloadClientTestResult,
  type LiveTorrentState,
  type LiveTorrentStatus,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import axios from 'axios';

const TORRENT_FIELDS = [
  'state',
  'progress',
  'total_wanted',
  'total_done',
  'download_payload_rate',
  'upload_payload_rate',
  'eta',
  'num_seeds',
  'num_peers',
  'message',
];

interface DelugeTorrent {
  state?: string;
  progress?: number;
  total_wanted?: number;
  total_done?: number;
  download_payload_rate?: number;
  upload_payload_rate?: number;
  eta?: number;
  num_seeds?: number;
  num_peers?: number;
  message?: string;
}

interface DelugeResponse<T> {
  result?: T;
  error?: { message?: string; code?: number } | null;
  id?: number;
}

export const mapDelugeState = (torrent: DelugeTorrent): LiveTorrentState => {
  switch (torrent.state) {
    case 'Downloading':
      return (torrent.download_payload_rate ?? 0) === 0 &&
        (torrent.num_seeds ?? 0) === 0
        ? 'stalled'
        : 'downloading';
    case 'Seeding':
      return 'seeding';
    case 'Paused':
      return (torrent.progress ?? 0) >= 100 ? 'completed' : 'paused';
    case 'Checking':
    case 'Allocating':
    case 'Moving':
      return 'checking';
    case 'Queued':
      return (torrent.progress ?? 0) >= 100 ? 'seeding' : 'queued';
    case 'Error':
      return 'error';
    default:
      return 'unknown';
  }
};

export const mapDelugeTorrent = (
  hashKey: string,
  torrent: DelugeTorrent
): LiveTorrentStatus | undefined => {
  const hash = normalizeInfoHash(hashKey);
  if (!hash || !torrent || typeof torrent !== 'object') {
    return undefined;
  }
  const size = nonNegative(torrent.total_wanted);
  const sizeLeft = Math.max(0, size - nonNegative(torrent.total_done));
  const eta = torrent.eta;
  const state = mapDelugeState(torrent);

  return {
    hash,
    state,
    size,
    sizeLeft,
    progress: clampProgress(
      typeof torrent.progress === 'number'
        ? torrent.progress / 100
        : size > 0
          ? (size - sizeLeft) / size
          : 0
    ),
    downloadRate: nonNegative(torrent.download_payload_rate),
    uploadRate: nonNegative(torrent.upload_payload_rate),
    // Deluge reports 0 both for "done" and "unknown".
    etaSeconds:
      sizeLeft === 0
        ? 0
        : typeof eta === 'number' && Number.isFinite(eta) && eta > 0
          ? eta
          : null,
    seeds: optionalCount(torrent.num_seeds),
    peers: optionalCount(torrent.num_peers),
    message:
      state === 'error' && torrent.message !== 'OK'
        ? safeMessage(torrent.message)
        : undefined,
  };
};

export default class DelugeClient implements DownloadClientAdapter {
  private cookie?: string;
  private requestId = 0;

  constructor(private readonly settings: DownloadClientSettings) {}

  private jsonUrl(): string {
    return clientUrl(this.settings, '/json');
  }

  private async rawCall<T>(method: string, params: unknown[]) {
    this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
    const response = await axios.post<DelugeResponse<T>>(
      this.jsonUrl(),
      { method, params, id: this.requestId },
      {
        ...baseRequestConfig,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
      }
    );
    if (response.status !== 200 || !response.data) {
      throw new DownloadClientError(
        `Deluge returned HTTP ${response.status}.`,
        'protocol'
      );
    }
    return response;
  }

  private async login(): Promise<void> {
    this.cookie = undefined;
    const response = await this.rawCall<boolean>('auth.login', [
      this.settings.password ?? '',
    ]);
    if (response.data.result !== true) {
      throw new DownloadClientError(
        'Deluge rejected the Web UI password.',
        'auth'
      );
    }
    this.cookie = readSetCookie(
      response.headers as Record<string, unknown>,
      '_session_id'
    );
    await this.ensureDaemonConnection();
  }

  /**
   * The Deluge Web UI can be logged in while not connected to a daemon. Use
   * the first configured host, as the Web UI's own connection manager does.
   */
  private async ensureDaemonConnection(): Promise<void> {
    const connected = await this.call<boolean>('web.connected', [], false);
    if (connected) {
      return;
    }
    const hosts = await this.call<unknown[]>('web.get_hosts', [], false);
    const first = Array.isArray(hosts) ? hosts[0] : undefined;
    const hostId = Array.isArray(first) ? first[0] : undefined;
    if (typeof hostId !== 'string') {
      throw new DownloadClientError(
        'Deluge Web UI is not connected to a Deluge daemon.',
        'connection'
      );
    }
    await this.call('web.connect', [hostId], false);
  }

  private async call<T>(
    method: string,
    params: unknown[],
    retry = true
  ): Promise<T> {
    if (this.cookie === undefined && retry) {
      await this.login();
    }
    const response = await this.rawCall<T>(method, params);
    const error = response.data.error;
    if (error) {
      // Code 1 is "Not authenticated".
      if (error.code === 1 && retry) {
        await this.login();
        return this.call<T>(method, params, false);
      }
      throw new DownloadClientError(
        safeMessage(error.message) ?? 'Deluge returned an RPC error.',
        error.code === 1 ? 'auth' : 'protocol'
      );
    }
    return response.data.result as T;
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    await this.login();
    const version = await this.call<unknown>('daemon.info', []);
    return {
      version: typeof version === 'string' ? version.slice(0, 64) : undefined,
    };
  }

  public async getTorrents(hashes: string[]): Promise<LiveTorrentStatus[]> {
    if (hashes.length === 0) {
      return [];
    }
    const result = await this.call<unknown>('core.get_torrents_status', [
      { id: hashes },
      TORRENT_FIELDS,
    ]);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new DownloadClientError(
        'Deluge returned an invalid torrent list.',
        'protocol'
      );
    }
    return Object.entries(result as Record<string, DelugeTorrent>)
      .map(([hash, torrent]) => mapDelugeTorrent(hash, torrent))
      .filter((torrent): torrent is LiveTorrentStatus => !!torrent);
  }
}
