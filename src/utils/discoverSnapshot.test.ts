import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISCOVER_SNAPSHOT_FRESH_AGE,
  DISCOVER_SNAPSHOT_MAX_AGE,
  buildDiscoverCacheContextKey,
  buildDiscoverSnapshotKey,
  createDiscoverSnapshot,
  isDiscoverSnapshotFresh,
  readDiscoverSnapshot,
  writeDiscoverSnapshot,
} from './discoverSnapshot';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const context = {
  userId: 12,
  permissions: 32,
  discoverRegion: 'US',
  streamingRegion: 'US',
  originalLanguage: 'en',
};

describe('discover snapshots', () => {
  it('isolates cache keys by user and effective discover context', () => {
    const firstContext = buildDiscoverCacheContextKey(context);
    const otherUser = buildDiscoverCacheContextKey({
      ...context,
      userId: 13,
    });
    const otherRegion = buildDiscoverCacheContextKey({
      ...context,
      discoverRegion: 'CA',
    });

    assert.notEqual(firstContext, otherUser);
    assert.notEqual(firstContext, otherRegion);
    assert.notEqual(
      buildDiscoverSnapshotKey(firstContext, 'popular', '/discover', 'a=b'),
      buildDiscoverSnapshotKey(otherUser, 'popular', '/discover', 'a=b')
    );
  });

  it('preserves data and the randomized seed for the snapshot lifetime', () => {
    const storage = new MemoryStorage();
    const contextKey = buildDiscoverCacheContextKey(context);
    const key = buildDiscoverSnapshotKey(
      contextKey,
      'popular',
      '/api/v1/discover/movies'
    );
    const snapshot = createDiscoverSnapshot(contextKey, [{ id: 1 }], {
      now: 1_000,
      seed: 'stable-seed',
      manifestVersion: 'manifest-1',
      layoutRevision: 'layout-2',
      userStateRevision: 'state-3',
    });

    writeDiscoverSnapshot(storage, key, snapshot);

    assert.deepEqual(
      readDiscoverSnapshot<{ id: number }[]>(
        storage,
        key,
        contextKey,
        1_000 + DISCOVER_SNAPSHOT_MAX_AGE - 1
      ),
      snapshot
    );
    assert.equal(snapshot.metadata.seed, 'stable-seed');
    assert.equal(snapshot.metadata.manifestVersion, 'manifest-1');
  });

  it('distinguishes fresh snapshots from stale fallbacks', () => {
    const snapshot = createDiscoverSnapshot('context', [], { now: 10_000 });

    assert.equal(
      isDiscoverSnapshotFresh(
        snapshot,
        10_000 + DISCOVER_SNAPSHOT_FRESH_AGE - 1
      ),
      true
    );
    assert.equal(
      isDiscoverSnapshotFresh(snapshot, 10_000 + DISCOVER_SNAPSHOT_FRESH_AGE),
      false
    );
  });

  it('rejects expired and mismatched-context snapshots', () => {
    const storage = new MemoryStorage();
    const snapshot = createDiscoverSnapshot('user-1', ['cached'], { now: 0 });

    writeDiscoverSnapshot(storage, 'expired', snapshot);
    assert.equal(
      readDiscoverSnapshot(
        storage,
        'expired',
        'user-1',
        DISCOVER_SNAPSHOT_MAX_AGE
      ),
      undefined
    );
    assert.equal(storage.getItem('expired'), null);

    writeDiscoverSnapshot(storage, 'wrong-user', snapshot);
    assert.equal(
      readDiscoverSnapshot(storage, 'wrong-user', 'user-2', 1),
      undefined
    );
    assert.equal(storage.getItem('wrong-user'), null);
  });
});
