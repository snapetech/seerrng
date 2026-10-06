/**
 * Browser-side store for live torrent progress. One EventSource per tab
 * carries every info hash currently rendered; components read individual
 * hashes through `useLiveDownload`.
 */

export type LiveDownloadState =
  | 'downloading'
  | 'stalled'
  | 'queued'
  | 'paused'
  | 'checking'
  | 'metadata'
  | 'seeding'
  | 'completed'
  | 'error'
  | 'unknown';

export interface LiveDownload {
  hash: string;
  state: LiveDownloadState;
  size: number;
  sizeLeft: number;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  etaSeconds: number | null;
  seeds: number | null;
  peers: number | null;
  observedAt: string;
  clientName?: string;
  message?: string;
}

const INFO_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RECONNECT_DEBOUNCE_MS = 300;
const STREAM_URL = '/api/v1/live/downloads';

export const toInfoHash = (downloadId: unknown): string | undefined => {
  if (typeof downloadId !== 'string') return undefined;
  const hash = downloadId.trim().toLowerCase();
  return INFO_HASH_PATTERN.test(hash) ? hash : undefined;
};

type Listener = () => void;

const isLiveDownload = (value: unknown): value is LiveDownload => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.hash === 'string' &&
    typeof item.state === 'string' &&
    typeof item.size === 'number' &&
    typeof item.sizeLeft === 'number' &&
    typeof item.progress === 'number'
  );
};

export class LiveDownloadStore {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly values = new Map<string, LiveDownload>();
  private source?: EventSource;
  private sourceKey = '';
  /** Set when the server says live progress is unavailable (204/4xx). */
  private disabledKey?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly createSource: (url: string) => EventSource = (url) =>
      new EventSource(url, { withCredentials: true })
  ) {}

  public get = (hash: string): LiveDownload | undefined =>
    this.values.get(hash);

  public subscribe(hash: string, listener: Listener): () => void {
    let set = this.listeners.get(hash);
    if (!set) {
      set = new Set();
      this.listeners.set(hash, set);
      this.scheduleReconnect();
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(hash);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(hash);
        this.values.delete(hash);
        this.scheduleReconnect();
      }
    };
  }

  /** Applies a server `downloads` event payload. Exposed for tests. */
  public receive(payload: unknown): void {
    if (!Array.isArray(payload)) return;
    for (const item of payload) {
      if (!isLiveDownload(item) || !this.listeners.has(item.hash)) continue;
      this.values.set(item.hash, item);
      this.listeners.get(item.hash)?.forEach((listener) => listener());
    }
  }

  private scheduleReconnect(): void {
    if (typeof window === 'undefined') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, RECONNECT_DEBOUNCE_MS);
  }

  private connect(): void {
    const hashes = [...this.listeners.keys()].sort();
    const key = hashes.join(',');
    if (key === this.sourceKey && this.source) return;

    this.source?.close();
    this.source = undefined;
    this.sourceKey = key;
    if (
      !key ||
      key === this.disabledKey ||
      typeof EventSource === 'undefined'
    ) {
      return;
    }

    const source = this.createSource(
      `${STREAM_URL}?ids=${encodeURIComponent(key)}`
    );
    source.addEventListener('downloads', (event) => {
      try {
        this.receive(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // Ignore malformed events; the next poll replaces them.
      }
    });
    source.addEventListener('error', () => {
      // EventSource closes itself (readyState 2) for 204 and error statuses;
      // it retries on its own after network interruptions.
      if (source.readyState === 2 && this.source === source) {
        this.source = undefined;
        this.disabledKey = key;
      }
    });
    this.source = source;
  }
}

export const liveDownloadStore = new LiveDownloadStore();
