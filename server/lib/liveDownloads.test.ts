import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  DownloadClientAdapter,
  LiveTorrentStatus,
} from '@server/api/downloadClients/types';
import { DownloadClientError } from '@server/api/downloadClients/types';
import {
  LiveDownloadMonitor,
  type LiveDownloadUpdate,
} from '@server/lib/liveDownloads';
import type { DownloadClientSettings } from '@server/lib/settings';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

const status = (hash: string, progress = 0.5): LiveTorrentStatus => ({
  hash,
  state: 'downloading',
  size: 100,
  sizeLeft: 100 - progress * 100,
  progress,
  downloadRate: 1,
  uploadRate: 0,
  etaSeconds: 10,
  seeds: 1,
  peers: 1,
});

const client = (
  id: number,
  overrides: Partial<DownloadClientSettings> = {}
): DownloadClientSettings => ({
  id,
  name: `client-${id}`,
  type: 'qbittorrent',
  enabled: true,
  hostname: 'localhost',
  port: 8080,
  useSsl: false,
  baseUrl: '',
  username: '',
  password: '',
  ...overrides,
});

describe('LiveDownloadMonitor', () => {
  it('queries only subscribed hashes and delivers each subscriber its own', async () => {
    const queried: string[][] = [];
    const adapter: DownloadClientAdapter = {
      testConnection: async () => ({}),
      getTorrents: async (hashes) => {
        queried.push([...hashes].sort());
        return hashes.map((hash) => status(hash));
      },
    };
    const monitor = new LiveDownloadMonitor(
      () => ({ pollIntervalSeconds: 3, clients: [client(1)] }),
      () => adapter
    );

    const first: LiveDownloadUpdate[][] = [];
    const second: LiveDownloadUpdate[][] = [];
    const stopFirst = monitor.subscribe([HASH_A], (u) => first.push(u));
    const stopSecond = monitor.subscribe([HASH_B], (u) => second.push(u));
    monitor.stop(); // Drive polls manually.

    await monitor.pollOnce();
    assert.deepEqual(queried, [[HASH_A, HASH_B]]);
    assert.deepEqual(
      first.flat().map((u) => u.hash),
      [HASH_A]
    );
    assert.deepEqual(
      second.flat().map((u) => u.hash),
      [HASH_B]
    );
    assert.equal(first[0][0].clientName, 'client-1');

    stopFirst();
    stopSecond();
    assert.equal(monitor.subscriberCount, 0);
  });

  it('skips disabled clients and keeps working when one client fails', async () => {
    const calls: number[] = [];
    const monitor = new LiveDownloadMonitor(
      () => ({
        pollIntervalSeconds: 3,
        clients: [client(1), client(2), client(3, { enabled: false })],
      }),
      (settings) => ({
        testConnection: async () => ({}),
        getTorrents: async (hashes) => {
          calls.push(settings.id);
          if (settings.id === 1) {
            throw new DownloadClientError('bad password', 'auth');
          }
          return hashes.map((hash) => status(hash, 0.9));
        },
      })
    );

    const received: LiveDownloadUpdate[] = [];
    const stop = monitor.subscribe([HASH_A], (u) => received.push(...u));
    monitor.stop();
    await monitor.pollOnce();

    assert.deepEqual(calls.sort(), [1, 2]);
    assert.equal(received[0].clientId, 2);
    const health = monitor
      .getClientHealth()
      .sort((a, b) => a.clientId - b.clientId);
    assert.equal(health[0].ok, false);
    assert.equal(health[0].error, 'bad password');
    assert.equal(health[1].ok, true);
    stop();
  });

  it('does not poll without subscribers or without enabled clients', async () => {
    let calls = 0;
    const adapter: DownloadClientAdapter = {
      testConnection: async () => ({}),
      getTorrents: async () => {
        calls += 1;
        return [];
      },
    };
    const noClients = new LiveDownloadMonitor(
      () => ({ pollIntervalSeconds: 3, clients: [] }),
      () => adapter
    );
    assert.equal(noClients.hasEnabledClients(), false);
    const stop = noClients.subscribe([HASH_A], () => undefined);
    noClients.stop();
    await noClients.pollOnce();
    stop();

    const noSubscribers = new LiveDownloadMonitor(
      () => ({ pollIntervalSeconds: 3, clients: [client(1)] }),
      () => adapter
    );
    await noSubscribers.pollOnce();
    assert.equal(calls, 0);
  });

  it('reuses an adapter until its connection settings change', async () => {
    let created = 0;
    let password = 'one';
    const monitor = new LiveDownloadMonitor(
      () => ({ pollIntervalSeconds: 3, clients: [client(1, { password })] }),
      () => {
        created += 1;
        return {
          testConnection: async () => ({}),
          getTorrents: async () => [],
        };
      }
    );
    const stop = monitor.subscribe([HASH_A], () => undefined);
    monitor.stop();
    await monitor.pollOnce();
    await monitor.pollOnce();
    assert.equal(created, 1);
    password = 'two';
    await monitor.pollOnce();
    assert.equal(created, 2);
    stop();
  });

  it('clears live values when a subscribed torrent stops being reported', async () => {
    let isAvailable = true;
    const missing: string[] = [];
    const monitor = new LiveDownloadMonitor(
      () => ({ pollIntervalSeconds: 3, clients: [client(1)] }),
      () => ({
        testConnection: async () => ({}),
        getTorrents: async (hashes) =>
          isAvailable ? hashes.map((hash) => status(hash)) : [],
      })
    );
    const stop = monitor.subscribe([HASH_A], (_updates, missingHashes) => {
      missing.push(...missingHashes);
    });
    monitor.stop();

    await monitor.pollOnce();
    assert.deepEqual(missing, []);
    isAvailable = false;
    await monitor.pollOnce();

    assert.deepEqual(missing, [HASH_A]);
    stop();
  });
});
