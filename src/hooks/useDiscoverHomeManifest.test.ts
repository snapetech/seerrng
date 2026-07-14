import type { DiscoverHomeManifest } from '@server/interfaces/api/discoverHomeInterfaces';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isManifestCacheFresh,
  readManifestCache,
} from './useDiscoverHomeManifest';

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
}

const manifest: DiscoverHomeManifest = {
  version: 1,
  layoutRevision: 'layout-1',
  userStateRevision: 'state-1',
  generatedAt: new Date(0).toISOString(),
  freshness: {
    manifestMaxAgeSeconds: 60,
    rowMaxAgeSeconds: 300,
    stateMaxAgeSeconds: 30,
  },
  rows: [],
};

describe('Discover home manifest cache', () => {
  it('isolates compact manifest records by cache context', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'seerr-discover-manifest-v1:user-1',
      JSON.stringify({ contextKey: 'user-1', checkedAt: 1000, manifest })
    );

    assert.deepEqual(readManifestCache(storage, 'user-1')?.manifest, manifest);
    assert.equal(readManifestCache(storage, 'user-2'), undefined);
  });

  it('uses server-provided manifest freshness', () => {
    const record = { contextKey: 'user-1', checkedAt: 1000, manifest };

    assert.equal(isManifestCacheFresh(record, 60_999), true);
    assert.equal(isManifestCacheFresh(record, 61_000), false);
  });
});
