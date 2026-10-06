import {
  baseRequestConfig,
  clampProgress,
  clientUrl,
  DownloadClientError,
  nonNegative,
  normalizeInfoHash,
  optionalCount,
  safeMessage,
  type DownloadClientAdapter,
  type DownloadClientTestResult,
  type LiveTorrentState,
  type LiveTorrentStatus,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import axios from 'axios';

const SESSION_HEADER = 'x-transmission-session-id';
const DEFAULT_RPC_BASE = '/transmission';

const TORRENT_FIELDS = [
  'hashString',
  'status',
  'error',
  'errorString',
  'sizeWhenDone',
  'leftUntilDone',
  'percentDone',
  'metadataPercentComplete',
  'rateDownload',
  'rateUpload',
  'eta',
  'peersSendingToUs',
  'peersConnected',
] as const;

interface TransmissionTorrent {
  hashString?: string;
  status?: number;
  error?: number;
  errorString?: string;
  sizeWhenDone?: number;
  leftUntilDone?: number;
  percentDone?: number;
  metadataPercentComplete?: number;
  rateDownload?: number;
  rateUpload?: number;
  eta?: number;
  peersSendingToUs?: number;
  peersConnected?: number;
}

interface TransmissionResponse<T> {
  result?: string;
  arguments?: T;
}

export const mapTransmissionState = (
  torrent: TransmissionTorrent
): LiveTorrentState => {
  if (torrent.error && torrent.error !== 0) {
    return 'error';
  }
  const done = (torrent.percentDone ?? 0) >= 1;
  switch (torrent.status) {
    case 0:
      return done ? 'completed' : 'paused';
    case 1:
    case 2:
      return 'checking';
    case 3:
      return 'queued';
    case 4:
      if ((torrent.metadataPercentComplete ?? 1) < 1) {
        return 'metadata';
      }
      return (torrent.rateDownload ?? 0) === 0 &&
        (torrent.peersSendingToUs ?? 0) === 0
        ? 'stalled'
        : 'downloading';
    case 5:
    case 6:
      return 'seeding';
    default:
      return 'unknown';
  }
};

export const mapTransmissionTorrent = (
  torrent: TransmissionTorrent
): LiveTorrentStatus | undefined => {
  const hash = normalizeInfoHash(torrent.hashString);
  if (!hash) {
    return undefined;
  }
  const size = nonNegative(torrent.sizeWhenDone);
  const sizeLeft = Math.min(size, nonNegative(torrent.leftUntilDone));
  const eta = torrent.eta;

  return {
    hash,
    state: mapTransmissionState(torrent),
    size,
    sizeLeft,
    progress: clampProgress(
      typeof torrent.percentDone === 'number'
        ? torrent.percentDone
        : size > 0
          ? (size - sizeLeft) / size
          : 0
    ),
    downloadRate: nonNegative(torrent.rateDownload),
    uploadRate: nonNegative(torrent.rateUpload),
    // Transmission uses -1 (not available) and -2 (unknown).
    etaSeconds:
      typeof eta === 'number' && Number.isFinite(eta) && eta >= 0 ? eta : null,
    seeds: optionalCount(torrent.peersSendingToUs),
    peers: optionalCount(torrent.peersConnected),
    message:
      torrent.error && torrent.error !== 0
        ? safeMessage(torrent.errorString)
        : undefined,
  };
};

export default class TransmissionClient implements DownloadClientAdapter {
  private sessionId?: string;

  constructor(private readonly settings: DownloadClientSettings) {}

  private rpcUrl(): string {
    return clientUrl(
      { ...this.settings, baseUrl: this.settings.baseUrl || DEFAULT_RPC_BASE },
      '/rpc'
    );
  }

  private async call<T>(
    method: string,
    args: Record<string, unknown>,
    retry = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.sessionId) {
      headers[SESSION_HEADER] = this.sessionId;
    }
    const response = await axios.post<TransmissionResponse<T>>(
      this.rpcUrl(),
      { method, arguments: args },
      {
        ...baseRequestConfig,
        headers,
        auth: this.settings.username
          ? {
              username: this.settings.username,
              password: this.settings.password ?? '',
            }
          : undefined,
      }
    );

    if (response.status === 409 && retry) {
      const sessionId = response.headers[SESSION_HEADER];
      if (typeof sessionId === 'string' && sessionId.length <= 256) {
        this.sessionId = sessionId;
        return this.call<T>(method, args, false);
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new DownloadClientError(
        'Transmission rejected the username or password.',
        'auth'
      );
    }
    if (response.status !== 200) {
      throw new DownloadClientError(
        `Transmission returned HTTP ${response.status}.`,
        'protocol'
      );
    }
    if (response.data?.result !== 'success' || !response.data.arguments) {
      throw new DownloadClientError(
        'Transmission returned an unsuccessful RPC result.',
        'protocol'
      );
    }
    return response.data.arguments;
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    this.sessionId = undefined;
    const session = await this.call<{ version?: unknown }>('session-get', {
      fields: ['version'],
    });
    return {
      version:
        typeof session.version === 'string'
          ? session.version.slice(0, 64)
          : undefined,
    };
  }

  public async getTorrents(hashes: string[]): Promise<LiveTorrentStatus[]> {
    if (hashes.length === 0) {
      return [];
    }
    const result = await this.call<{ torrents?: unknown }>('torrent-get', {
      fields: TORRENT_FIELDS,
      ids: hashes,
    });
    if (!Array.isArray(result.torrents)) {
      throw new DownloadClientError(
        'Transmission returned an invalid torrent list.',
        'protocol'
      );
    }
    return result.torrents
      .map((torrent) => mapTransmissionTorrent(torrent as TransmissionTorrent))
      .filter((torrent): torrent is LiveTorrentStatus => !!torrent);
  }
}
