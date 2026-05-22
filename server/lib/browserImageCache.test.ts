import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BROWSER_IMAGE_CACHE_MAX_AGE,
  BROWSER_IMAGE_IMMUTABLE_CACHE_MAX_AGE,
  BROWSER_IMAGE_STALE_IF_ERROR,
  BROWSER_IMAGE_STALE_WHILE_REVALIDATE,
  doesBrowserImageEtagMatch,
  doesBrowserImageLastModifiedMatch,
  getBrowserImageCacheControl,
  getBrowserImageResponseHeaders,
  shouldSendBrowserImageNotModified,
} from './browserImageCache';

describe('getBrowserImageCacheControl', () => {
  it('uses the upstream max-age when it is below the browser cache cap', () => {
    const expected = `public, max-age=3600, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}`;

    assert.equal(getBrowserImageCacheControl(3600), expected);
  });

  it('caps browser freshness for long-lived upstream images', () => {
    const expected = `public, max-age=${BROWSER_IMAGE_CACHE_MAX_AGE}, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}`;

    assert.equal(getBrowserImageCacheControl(365 * 24 * 60 * 60), expected);
  });

  it('falls back to one day for invalid origin max-age values', () => {
    const expected = `public, max-age=86400, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}`;

    assert.equal(getBrowserImageCacheControl(Number.NaN), expected);
    assert.equal(getBrowserImageCacheControl(0), expected);
  });

  it('uses a longer immutable policy for versioned image URLs', () => {
    const expected = `public, max-age=${BROWSER_IMAGE_IMMUTABLE_CACHE_MAX_AGE}, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}, immutable`;

    assert.equal(
      getBrowserImageCacheControl(3600, { immutable: true }),
      expected
    );
  });
});

describe('getBrowserImageResponseHeaders', () => {
  it('returns shared browser and in-app cache metadata for hits', () => {
    assert.deepEqual(
      getBrowserImageResponseHeaders({
        cacheKey: 'abc123',
        cacheMiss: false,
        etag: '"etag-value"',
        lastModified: Date.UTC(2026, 0, 1),
        maxAge: 3600,
      }),
      {
        'Cache-Control': `public, max-age=3600, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}`,
        ETag: '"etag-value"',
        'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
        'OS-Cache-Key': 'abc123',
        'OS-Cache-Status': 'HIT',
        Vary: 'Accept-Encoding',
      }
    );
  });

  it('marks cache misses consistently', () => {
    assert.equal(
      getBrowserImageResponseHeaders({
        cacheKey: 'abc123',
        cacheMiss: true,
        etag: '"etag-value"',
        maxAge: 3600,
      })['OS-Cache-Status'],
      'MISS'
    );
  });

  it('can mark versioned image responses as immutable', () => {
    const expected: string = `public, max-age=${BROWSER_IMAGE_IMMUTABLE_CACHE_MAX_AGE}, stale-while-revalidate=${BROWSER_IMAGE_STALE_WHILE_REVALIDATE}, stale-if-error=${BROWSER_IMAGE_STALE_IF_ERROR}, immutable`;

    assert.equal(
      getBrowserImageResponseHeaders({
        cacheKey: 'abc123',
        cacheMiss: false,
        etag: '"etag-value"',
        immutable: true,
        maxAge: 3600,
      })['Cache-Control'],
      expected
    );
  });
});

describe('doesBrowserImageLastModifiedMatch', () => {
  it('matches fresh If-Modified-Since validators', () => {
    const lastModified = Date.UTC(2026, 0, 1, 0, 0, 0);

    assert.equal(
      doesBrowserImageLastModifiedMatch(
        'Thu, 01 Jan 2026 00:00:00 GMT',
        lastModified
      ),
      true
    );
    assert.equal(
      doesBrowserImageLastModifiedMatch(
        'Thu, 01 Jan 2026 00:00:01 GMT',
        lastModified
      ),
      true
    );
  });

  it('does not match stale or invalid If-Modified-Since validators', () => {
    const lastModified = Date.UTC(2026, 0, 1, 0, 0, 0);

    assert.equal(
      doesBrowserImageLastModifiedMatch(
        'Wed, 31 Dec 2025 23:59:59 GMT',
        lastModified
      ),
      false
    );
    assert.equal(
      doesBrowserImageLastModifiedMatch('not-a-date', lastModified),
      false
    );
  });
});

describe('doesBrowserImageEtagMatch', () => {
  it('matches exact and comma-delimited If-None-Match values', () => {
    assert.equal(doesBrowserImageEtagMatch('"abc"', '"abc"'), true);
    assert.equal(
      doesBrowserImageEtagMatch('"old", "abc", "other"', '"abc"'),
      true
    );
  });

  it('supports wildcard validators and header arrays', () => {
    assert.equal(doesBrowserImageEtagMatch('*', '"abc"'), true);
    assert.equal(doesBrowserImageEtagMatch(['"old"', '"abc"'], '"abc"'), true);
  });

  it('uses weak comparison for weak validators', () => {
    assert.equal(doesBrowserImageEtagMatch('W/"abc"', '"abc"'), true);
    assert.equal(doesBrowserImageEtagMatch('"abc"', 'W/"abc"'), true);
  });

  it('does not match absent or unrelated validators', () => {
    assert.equal(doesBrowserImageEtagMatch(undefined, '"abc"'), false);
    assert.equal(doesBrowserImageEtagMatch('"other"', '"abc"'), false);
  });

  it('ignores oversized or malformed validator headers', () => {
    assert.equal(
      doesBrowserImageEtagMatch(`${'"x",'.repeat(400)}"abc"`, '"abc"'),
      false
    );
    assert.equal(
      doesBrowserImageEtagMatch('"abc"\r\nX-Test: yes', '"abc"'),
      false
    );
  });
});

describe('shouldSendBrowserImageNotModified', () => {
  it('uses If-None-Match before If-Modified-Since when both are present', () => {
    const lastModified = Date.UTC(2026, 0, 1, 0, 0, 0);

    assert.equal(
      shouldSendBrowserImageNotModified({
        etag: '"abc"',
        ifModifiedSince: 'Thu, 01 Jan 2026 00:00:00 GMT',
        ifNoneMatch: '"different"',
        lastModified,
      }),
      false
    );
  });

  it('uses If-Modified-Since when If-None-Match is absent', () => {
    const lastModified = Date.UTC(2026, 0, 1, 0, 0, 0);

    assert.equal(
      shouldSendBrowserImageNotModified({
        etag: '"abc"',
        ifModifiedSince: 'Thu, 01 Jan 2026 00:00:00 GMT',
        ifNoneMatch: undefined,
        lastModified,
      }),
      true
    );
  });

  it('ignores oversized If-Modified-Since values', () => {
    const lastModified = Date.UTC(2026, 0, 1, 0, 0, 0);

    assert.equal(
      shouldSendBrowserImageNotModified({
        etag: '"abc"',
        ifModifiedSince: 'Thu, 01 Jan 2026 00:00:00 GMT'.padEnd(1025, ' '),
        ifNoneMatch: undefined,
        lastModified,
      }),
      false
    );
  });
});
