import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyLiveDownload,
  getLiveDownloadSubscriptionId,
} from '@app/hooks/useLiveDownload';
import {
  type LiveDownload,
  LiveDownloadStore,
  isLiveDownloadToken,
  toInfoHash,
} from '@app/utils/liveDownloadStore';
import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';

const HASH = 'a'.repeat(40);

const live = (overrides: Partial<LiveDownload> = {}): LiveDownload => ({
  id: HASH,
  state: 'downloading',
  size: 1000,
  sizeLeft: 250,
  progress: 0.75,
  downloadRate: 50,
  uploadRate: 0,
  etaSeconds: 5,
  seeds: 3,
  peers: 4,
  observedAt: '2026-10-06T12:00:00.000Z',
  ...overrides,
});

const queueItem: DownloadingItem = {
  mediaType: MediaType.MOVIE,
  externalId: 1,
  size: 1000,
  sizeLeft: 900,
  status: 'downloading',
  timeLeft: '01:00:00',
  estimatedCompletionTime: new Date('2026-10-06T13:00:00.000Z'),
  title: 'Example.Release',
  downloadId: HASH.toUpperCase(),
};

describe('toInfoHash', () => {
  it('normalizes torrent hashes and rejects other download IDs', () => {
    assert.equal(toInfoHash(HASH.toUpperCase()), HASH);
    assert.equal(toInfoHash('SABnzbd_nzo_1'), undefined);
    assert.equal(toInfoHash(undefined), undefined);
  });
});

describe('live download subscription IDs', () => {
  it('uses the opaque token for users and raw hashes only for administrators', () => {
    const token = 'ld1_0123456789abcdefghijklmnopqrstuv';
    const userItem: DownloadingItem = {
      ...queueItem,
      downloadId: 'b'.repeat(64),
      liveDownloadToken: token,
    };
    const aliasedItem: DownloadingItem = {
      ...queueItem,
      // Non-admin downloadId values are 64-character HMAC aliases.
      downloadId: 'c'.repeat(64),
    };

    assert.equal(isLiveDownloadToken(token), true);
    assert.equal(getLiveDownloadSubscriptionId(userItem), token);
    assert.equal(getLiveDownloadSubscriptionId(aliasedItem), undefined);
    assert.equal(
      getLiveDownloadSubscriptionId(aliasedItem, true),
      'c'.repeat(64)
    );
  });
});

describe('LiveDownloadStore', () => {
  it('stores only subscribed IDs and notifies their listeners', () => {
    const store = new LiveDownloadStore();
    let notified = 0;
    const unsubscribe = store.subscribe(HASH, () => {
      notified += 1;
    });

    store.receive([live(), live({ id: 'b'.repeat(40) }), { bad: true }]);
    assert.equal(notified, 1);
    assert.equal(store.get(HASH)?.sizeLeft, 250);
    assert.equal(store.get('b'.repeat(40)), undefined);

    unsubscribe();
    assert.equal(store.get(HASH), undefined);
  });

  it('ignores non-array payloads', () => {
    const store = new LiveDownloadStore();
    store.subscribe(HASH, () => undefined);
    store.receive({ hash: HASH });
    assert.equal(store.get(HASH), undefined);
  });

  it('clears stale progress when the server marks an ID unavailable', () => {
    const store = new LiveDownloadStore();
    let notified = 0;
    store.subscribe(HASH, () => {
      notified += 1;
    });
    store.receive([live()]);
    store.receive([{ id: HASH, unavailable: true }]);

    assert.equal(store.get(HASH), undefined);
    assert.equal(notified, 2);
  });
});

describe('applyLiveDownload', () => {
  it('overlays live size, remaining bytes, and ETA', () => {
    const merged = applyLiveDownload(queueItem, live());
    assert.equal(merged.sizeLeft, 250);
    assert.equal(merged.status, 'downloading');
    assert.equal(merged.title, 'Example.Release');
    assert.equal(
      new Date(merged.estimatedCompletionTime).toISOString(),
      '2026-10-06T12:00:05.000Z'
    );
  });

  it('keeps the queue ETA when the client cannot estimate one', () => {
    const merged = applyLiveDownload(queueItem, live({ etaSeconds: null }));
    assert.equal(
      merged.estimatedCompletionTime,
      queueItem.estimatedCompletionTime
    );
  });

  it('returns the queue item unchanged without usable live data', () => {
    assert.equal(applyLiveDownload(queueItem, undefined), queueItem);
    assert.equal(applyLiveDownload(queueItem, live({ size: 0 })), queueItem);
  });
});
