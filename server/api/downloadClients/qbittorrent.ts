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

/** qBittorrent reports this ETA when it cannot estimate completion. */
const QBIT_INFINITE_ETA = 8_640_000;

interface QBittorrentTorrent {
  hash?: string;
  state?: string;
  size?: number;
  total_size?: number;
  amount_left?: number;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  eta?: number;
  num_seeds?: number;
  num_leechs?: number;
}

export const mapQBittorrentState = (
  state: string | undefined
): LiveTorrentState => {
  switch (state) {
    case 'downloading':
    case 'forcedDL':
      return 'downloading';
    case 'stalledDL':
      return 'stalled';
    case 'queuedDL':
      return 'queued';
    case 'pausedDL':
    case 'stoppedDL':
      return 'paused';
    case 'metaDL':
    case 'forcedMetaDL':
      return 'metadata';
    case 'checkingDL':
    case 'checkingUP':
    case 'checkingResumeData':
    case 'allocating':
    case 'moving':
      return 'checking';
    case 'uploading':
    case 'stalledUP':
    case 'forcedUP':
    case 'queuedUP':
      return 'seeding';
    case 'pausedUP':
    case 'stoppedUP':
      return 'completed';
    case 'error':
    case 'missingFiles':
      return 'error';
    default:
      return 'unknown';
  }
};

export const mapQBittorrentTorrent = (
  torrent: QBittorrentTorrent
): LiveTorrentStatus | undefined => {
  const hash = normalizeInfoHash(torrent.hash);
  if (!hash) {
    return undefined;
  }
  const size = nonNegative(torrent.size ?? torrent.total_size);
  const sizeLeft = Math.min(size, nonNegative(torrent.amount_left));
  const eta = torrent.eta;

  return {
    hash,
    state: mapQBittorrentState(torrent.state),
    size,
    sizeLeft,
    progress: clampProgress(
      typeof torrent.progress === 'number'
        ? torrent.progress
        : size > 0
          ? (size - sizeLeft) / size
          : 0
    ),
    downloadRate: nonNegative(torrent.dlspeed),
    uploadRate: nonNegative(torrent.upspeed),
    etaSeconds:
      typeof eta === 'number' &&
      Number.isFinite(eta) &&
      eta >= 0 &&
      eta < QBIT_INFINITE_ETA
        ? eta
        : null,
    seeds: optionalCount(torrent.num_seeds),
    peers: optionalCount(torrent.num_leechs),
    message:
      torrent.state === 'missingFiles'
        ? safeMessage('Files are missing.')
        : undefined,
  };
};

export default class QBittorrentClient implements DownloadClientAdapter {
  private cookie?: string;

  constructor(private readonly settings: DownloadClientSettings) {}

  private url(path: string): string {
    return clientUrl(this.settings, path);
  }

  private origin(): string {
    return clientUrl({ ...this.settings, baseUrl: '' }, '');
  }

  private async login(): Promise<void> {
    const body = new URLSearchParams({
      username: this.settings.username ?? '',
      password: this.settings.password ?? '',
    });
    const response = await axios.post<string>(
      this.url('/api/v2/auth/login'),
      body.toString(),
      {
        ...baseRequestConfig,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // qBittorrent rejects logins whose Referer/Origin does not match.
          Referer: this.origin(),
          Origin: this.origin(),
        },
        responseType: 'text',
      }
    );

    if (response.status === 403) {
      throw new DownloadClientError(
        'qBittorrent temporarily banned this address after failed logins.',
        'auth'
      );
    }
    if (response.status !== 200 || String(response.data).trim() !== 'Ok.') {
      throw new DownloadClientError(
        'qBittorrent rejected the username or password.',
        'auth'
      );
    }

    const cookie = readSetCookie(
      response.headers as Record<string, unknown>,
      'SID'
    );
    // Some installs bypass authentication for local networks and return no
    // cookie; later requests then work without one.
    this.cookie = cookie;
  }

  private async get<T>(path: string, retry = true): Promise<T> {
    if (this.cookie === undefined) {
      await this.login();
    }
    const response = await axios.get<T>(this.url(path), {
      ...baseRequestConfig,
      headers: this.cookie ? { Cookie: this.cookie } : undefined,
    });

    if (response.status === 403 && retry) {
      this.cookie = undefined;
      return this.get<T>(path, false);
    }
    if (response.status !== 200) {
      throw new DownloadClientError(
        `qBittorrent returned HTTP ${response.status}.`,
        response.status === 403 ? 'auth' : 'protocol'
      );
    }
    return response.data;
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    this.cookie = undefined;
    const version = await this.get<string>('/api/v2/app/version');
    return {
      version:
        typeof version === 'string' ? version.trim().slice(0, 64) : undefined,
    };
  }

  public async getTorrents(hashes: string[]): Promise<LiveTorrentStatus[]> {
    if (hashes.length === 0) {
      return [];
    }
    const query = new URLSearchParams({ hashes: hashes.join('|') });
    const torrents = await this.get<unknown>(
      `/api/v2/torrents/info?${query.toString()}`
    );
    if (!Array.isArray(torrents)) {
      throw new DownloadClientError(
        'qBittorrent returned an invalid torrent list.',
        'protocol'
      );
    }
    return torrents
      .map((torrent) => mapQBittorrentTorrent(torrent as QBittorrentTorrent))
      .filter((torrent): torrent is LiveTorrentStatus => !!torrent);
  }
}
