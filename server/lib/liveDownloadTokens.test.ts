import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LiveDownloadTokenRegistry } from '@server/lib/liveDownloadTokens';

const HASH = 'a'.repeat(40);

describe('LiveDownloadTokenRegistry', () => {
  it('issues stable IDs scoped to a user and torrent hash', () => {
    const registry = new LiveDownloadTokenRegistry();
    const token = registry.issue(HASH.toUpperCase(), 7);

    assert.ok(token);
    assert.match(token, /^ld1_[A-Za-z0-9_-]{32}$/);
    assert.equal(registry.issue(HASH, 7), token);
    assert.equal(registry.resolve(token, 7), HASH);
    assert.equal(registry.resolve(token, 8), undefined);
    assert.notEqual(registry.issue(HASH, 8), token);
  });

  it('rejects invalid hashes, users, and token forms', () => {
    const registry = new LiveDownloadTokenRegistry();

    assert.equal(registry.issue('SABnzbd_nzo_1', 7), undefined);
    assert.equal(registry.issue(HASH, -1), undefined);
    assert.equal(registry.issue(HASH, Number.NaN), undefined);
    assert.equal(registry.resolve(HASH, 7), undefined);
    assert.equal(registry.resolve('ld1_invalid', 7), undefined);
  });

  it('expires IDs after the configured lifetime', () => {
    let now = 100;
    const registry = new LiveDownloadTokenRegistry(
      () => now,
      () => 'ld1_00000000000000000000000000000000',
      500
    );
    const token = registry.issue(HASH, 7);

    assert.equal(registry.resolve(token, 7), HASH);
    now += 499;
    assert.equal(registry.resolve(token, 7), HASH);
    now += 501;
    assert.equal(registry.resolve(token, 7), undefined);
  });

  it('evicts the oldest ID when the registry reaches its bound', () => {
    let next = 0;
    const registry = new LiveDownloadTokenRegistry(
      () => 100,
      () => `ld1_${String(next++).padStart(32, '0')}`,
      500,
      1
    );
    const first = registry.issue(HASH, 7);
    const second = registry.issue('b'.repeat(40), 7);

    assert.equal(registry.resolve(first, 7), undefined);
    assert.equal(registry.resolve(second, 7), 'b'.repeat(40));
  });
});
