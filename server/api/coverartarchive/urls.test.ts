import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatCoverArtArchiveThumbnailUrl,
  getCoverArtArchiveThumbnailUrl,
} from './urls';

const releaseMbid = '55f7c1d9-b4f4-4c8d-a578-7d98687c4e45';

describe('Cover Art Archive thumbnail URLs', () => {
  it('uses the same archive object for known discovery and provider artwork', () => {
    const expected = `https://archive.org/download/mbid-${releaseMbid}/mbid-${releaseMbid}-123_thumb250.jpg`;

    assert.equal(getCoverArtArchiveThumbnailUrl(releaseMbid, 123), expected);
    assert.equal(
      formatCoverArtArchiveThumbnailUrl(releaseMbid, '123'),
      expected
    );
  });

  it('does not invent an archive object for invalid or missing identifiers', () => {
    for (const imageId of [
      undefined,
      null,
      '',
      '123',
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '../123',
    ]) {
      assert.equal(
        getCoverArtArchiveThumbnailUrl(releaseMbid, imageId),
        undefined
      );
    }

    for (const invalidRelease of [
      undefined,
      null,
      '',
      'release-not-a-uuid',
      `../${releaseMbid}`,
      `${releaseMbid}?version=2`,
    ]) {
      assert.equal(
        getCoverArtArchiveThumbnailUrl(invalidRelease, 123),
        undefined
      );
    }
  });

  it('preserves safe encoding of provider identifiers exactly once', () => {
    assert.equal(
      formatCoverArtArchiveThumbnailUrl('unsafe release', '../unsafe?value'),
      'https://archive.org/download/mbid-unsafe%20release/mbid-unsafe%20release-..%2Funsafe%3Fvalue_thumb250.jpg'
    );
  });
});
