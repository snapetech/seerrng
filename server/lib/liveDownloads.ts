import { createDownloadClient } from '@server/api/downloadClients';
import {
  type DownloadClientAdapter,
  DownloadClientError,
  type LiveTorrentStatus,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export const LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION = 100;
export const LIVE_DOWNLOAD_MAX_TOTAL_HASHES = 1_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;

export interface LiveDownloadUpdate extends LiveTorrentStatus {
  clientId: number;
  clientName: string;
  observedAt: string;
}

export interface LiveDownloadClientHealth {
  clientId: number;
  ok: boolean;
  checkedAt: string;
  error?: string;
}

type Listener = (
  updates: LiveDownloadUpdate[],
  missingHashes: string[]
) => void;

interface Subscription {
  hashes: Set<string>;
  listener: Listener;
}

const fingerprint = (client: DownloadClientSettings): string =>
  JSON.stringify([
    client.type,
    client.hostname,
    client.port,
    client.useSsl,
    client.baseUrl,
    client.username,
    client.password,
  ]);

/**
 * Polls configured torrent clients for the info hashes that connected browsers
 * are currently displaying. Polling runs only while at least one subscriber is
 * connected and only for subscribed hashes.
 */
export class LiveDownloadMonitor {
  private readonly subscriptions = new Set<Subscription>();
  private readonly latest = new Map<string, LiveDownloadUpdate>();
  private readonly adapters = new Map<
    number,
    { fingerprint: string; adapter: DownloadClientAdapter }
  >();
  private readonly health = new Map<number, LiveDownloadClientHealth>();
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly loadClients: () => {
      pollIntervalSeconds: number;
      clients: DownloadClientSettings[];
    } = () => getSettings().liveDownloads,
    private readonly adapterFactory: (
      settings: DownloadClientSettings
    ) => DownloadClientAdapter = createDownloadClient
  ) {}

  public hasEnabledClients(): boolean {
    return this.enabledClients().length > 0;
  }

  public get subscriberCount(): number {
    return this.subscriptions.size;
  }

  public getClientHealth(): LiveDownloadClientHealth[] {
    return [...this.health.values()];
  }

  public subscribe(hashes: string[], listener: Listener): () => void {
    const subscription: Subscription = {
      hashes: new Set(
        hashes.slice(0, LIVE_DOWNLOAD_MAX_HASHES_PER_SUBSCRIPTION)
      ),
      listener,
    };
    this.subscriptions.add(subscription);

    const cached = [...subscription.hashes]
      .map((hash) => this.latest.get(hash))
      .filter((update): update is LiveDownloadUpdate => !!update);
    if (cached.length > 0) {
      this.deliver(subscription, cached, []);
    }

    if (!this.timer && !this.polling) {
      this.schedule(0);
    }

    return () => {
      this.subscriptions.delete(subscription);
      if (this.subscriptions.size === 0) {
        this.stop();
      }
    };
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.latest.clear();
  }

  /** Runs one poll immediately. Exposed for tests. */
  public async pollOnce(): Promise<void> {
    const hashes = this.subscribedHashes();
    const clients = this.enabledClients();
    if (hashes.length === 0) return;

    const previouslyAvailable = new Set(this.latest.keys());
    if (clients.length === 0) {
      this.latest.clear();
      for (const subscription of this.subscriptions) {
        const missing = [...subscription.hashes].filter((hash) =>
          previouslyAvailable.has(hash)
        );
        if (missing.length > 0) {
          this.deliver(subscription, [], missing);
        }
      }
      return;
    }

    const observedAt = new Date().toISOString();
    const results = await Promise.all(
      clients.map(async (client) => {
        try {
          const torrents = await this.adapterFor(client).getTorrents(hashes);
          this.health.set(client.id, {
            clientId: client.id,
            ok: true,
            checkedAt: observedAt,
          });
          return torrents.map((torrent): LiveDownloadUpdate => ({
            ...torrent,
            clientId: client.id,
            clientName: client.name,
            observedAt,
          }));
        } catch (error) {
          const message =
            error instanceof DownloadClientError
              ? error.message
              : 'The download client could not be reached.';
          const previous = this.health.get(client.id);
          if (!previous || previous.ok || previous.error !== message) {
            logger.warn('Live download progress unavailable', {
              label: 'Live Downloads',
              client: client.name,
              errorMessage: message,
            });
          }
          this.health.set(client.id, {
            clientId: client.id,
            ok: false,
            checkedAt: observedAt,
            error: message,
          });
          return [];
        }
      })
    );

    // The first client that reports a hash wins; the same torrent should not
    // normally be active in two clients.
    const merged = new Map<string, LiveDownloadUpdate>();
    for (const update of results.flat()) {
      if (!merged.has(update.hash)) {
        merged.set(update.hash, update);
      }
    }

    this.latest.clear();
    for (const [hash, update] of merged) {
      this.latest.set(hash, update);
    }

    for (const subscription of this.subscriptions) {
      const updates = [...subscription.hashes]
        .map((hash) => merged.get(hash))
        .filter((update): update is LiveDownloadUpdate => !!update);
      const missing = [...subscription.hashes].filter(
        (hash) => previouslyAvailable.has(hash) && !merged.has(hash)
      );
      if (updates.length > 0 || missing.length > 0) {
        this.deliver(subscription, updates, missing);
      }
    }
  }

  private deliver(
    subscription: Subscription,
    updates: LiveDownloadUpdate[],
    missingHashes: string[]
  ) {
    try {
      subscription.listener(updates, missingHashes);
    } catch (error) {
      logger.debug('Live download subscriber failed', {
        label: 'Live Downloads',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.polling = true;
      void this.pollOnce()
        .catch((error) => {
          logger.error('Live download poll failed', {
            label: 'Live Downloads',
            errorMessage: error instanceof Error ? error.message : error,
          });
        })
        .finally(() => {
          this.polling = false;
          if (this.subscriptions.size > 0) {
            this.schedule(this.intervalMs());
          }
        });
    }, delayMs);
    this.timer.unref?.();
  }

  private intervalMs(): number {
    const seconds = Number(this.loadClients().pollIntervalSeconds);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : 3000;
    return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms));
  }

  private enabledClients(): DownloadClientSettings[] {
    const clients = this.loadClients().clients ?? [];
    const enabled = clients.filter((client) => client.enabled);
    const ids = new Set(enabled.map((client) => client.id));
    for (const id of this.adapters.keys()) {
      if (!ids.has(id)) {
        this.adapters.delete(id);
        this.health.delete(id);
      }
    }
    return enabled;
  }

  private subscribedHashes(): string[] {
    const hashes = new Set<string>();
    for (const subscription of this.subscriptions) {
      for (const hash of subscription.hashes) {
        hashes.add(hash);
        if (hashes.size >= LIVE_DOWNLOAD_MAX_TOTAL_HASHES) {
          return [...hashes];
        }
      }
    }
    return [...hashes];
  }

  /** Reuses adapters so login sessions survive between polls. */
  private adapterFor(client: DownloadClientSettings): DownloadClientAdapter {
    const key = fingerprint(client);
    const existing = this.adapters.get(client.id);
    if (existing && existing.fingerprint === key) {
      return existing.adapter;
    }
    const adapter = this.adapterFactory(client);
    this.adapters.set(client.id, { fingerprint: key, adapter });
    return adapter;
  }
}

const liveDownloadMonitor = new LiveDownloadMonitor();

export default liveDownloadMonitor;
