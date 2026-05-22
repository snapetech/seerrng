import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_IMAGE_CACHE_MAX_AGE,
  getImageCacheLastModified,
  getImageResponseContentType,
  parseCacheControlMaxAge,
  parseImageCacheFileMetadata,
} from './imageproxy';

describe('parseCacheControlMaxAge', () => {
  it('parses standard comma-delimited cache-control headers', () => {
    assert.equal(
      parseCacheControlMaxAge('public, max-age=31536000, immutable'),
      31536000
    );
  });

  it('parses max-age regardless of casing and spacing', () => {
    assert.equal(parseCacheControlMaxAge('PRIVATE,  MAX-AGE=7200'), 7200);
  });

  it('falls back to one day when max-age is missing or invalid', () => {
    assert.equal(parseCacheControlMaxAge(undefined), 86400);
    assert.equal(parseCacheControlMaxAge('no-cache'), 86400);
    assert.equal(parseCacheControlMaxAge('public, max-age=0'), 86400);
  });

  it('caps absurd upstream max-age values', () => {
    assert.equal(
      parseCacheControlMaxAge('public, max-age=999999999999'),
      MAX_IMAGE_CACHE_MAX_AGE
    );
  });
});

describe('getImageCacheLastModified', () => {
  it('derives last-modified from valid cache filename metadata', () => {
    assert.equal(getImageCacheLastModified(200000, 100, 12345), 100000);
  });

  it('falls back to now for invalid cache filename metadata', () => {
    assert.equal(getImageCacheLastModified(Number.NaN, 100, 12345), 12345);
    assert.equal(getImageCacheLastModified(200000, 0, 12345), 12345);
  });
});

describe('parseImageCacheFileMetadata', () => {
  it('parses bounded cache filename metadata', () => {
    assert.deepEqual(parseImageCacheFileMetadata('60.120.etag.webp', 90), {
      maxAge: 60,
      expireAt: 120,
      etag: 'etag',
      extension: 'webp',
      lastModified: -59880,
      revalidateAfter: 60090,
      isStale: false,
    });
  });

  it('rejects malformed cache filename metadata', () => {
    assert.equal(parseImageCacheFileMetadata('NaN.120.etag.webp'), null);
    assert.equal(parseImageCacheFileMetadata('60.NaN.etag.webp'), null);
    assert.equal(parseImageCacheFileMetadata('60.120..webp'), null);
    assert.equal(parseImageCacheFileMetadata('60.120.etag'), null);
    assert.equal(parseImageCacheFileMetadata('60.120.etag.webp.extra'), null);
    assert.equal(
      parseImageCacheFileMetadata(
        `${MAX_IMAGE_CACHE_MAX_AGE + 1}.120.etag.webp`
      ),
      null
    );
  });
});

describe('getImageResponseContentType', () => {
  it('uses canonical MIME types for cached image extensions', () => {
    assert.equal(getImageResponseContentType('jpg'), 'image/jpeg');
    assert.equal(getImageResponseContentType('jpeg'), 'image/jpeg');
    assert.equal(getImageResponseContentType('svg'), 'image/svg+xml');
    assert.equal(getImageResponseContentType('webp'), 'image/webp');
  });

  it('falls back safely for unknown or missing extensions', () => {
    assert.equal(getImageResponseContentType('custom'), 'image/custom');
    assert.equal(getImageResponseContentType(null), 'application/octet-stream');
  });
});
