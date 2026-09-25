import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import LazyLibrarianAPI from '@server/api/lazylibrarian';
import { MAX_SAFE_REMOTE_IMAGE_BYTES } from '@server/utils/safeRemoteImage';

describe('LazyLibrarianAPI.getMagazineCover', () => {
  afterEach(() => mock.restoreAll());

  it('fetches a validated magazine cover below the configured URL base', async () => {
    const api = new LazyLibrarianAPI({
      url: 'http://localhost:5299/lazy',
      apiKey: 'key',
    });
    const get = mock.fn(
      async (url: string, options?: Record<string, unknown>) => {
        assert.ok(url);
        assert.ok(options);
        return {
          data: Buffer.from('image-bytes'),
          headers: { 'content-type': 'image/jpeg; charset=binary' },
        };
      }
    );
    (
      api as unknown as {
        axios: { get: typeof get };
      }
    ).axios.get = get;

    const result = await api.getMagazineCover('A'.repeat(40));

    assert.deepStrictEqual(result, {
      imageBuffer: Buffer.from('image-bytes'),
      contentType: 'image/jpeg',
    });
    assert.strictEqual(
      get.mock.calls[0].arguments[0],
      'http://localhost:5299/lazy/cache/magazine/' + 'a'.repeat(40) + '.jpg'
    );
    const options = get.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.strictEqual(options.responseType, 'arraybuffer');
    assert.strictEqual(options.maxContentLength, MAX_SAFE_REMOTE_IMAGE_BYTES);
    assert.strictEqual(options.maxBodyLength, MAX_SAFE_REMOTE_IMAGE_BYTES);
    assert.deepStrictEqual(options.headers, { Accept: 'image/*' });
  });

  it('rejects unsafe cover IDs before making an upstream request', async () => {
    const api = new LazyLibrarianAPI({
      url: 'http://localhost:5299',
      apiKey: 'key',
    });
    const get = mock.fn(
      async (url: string, options?: Record<string, unknown>) => {
        assert.ok(url);
        assert.ok(options);
        return {
          data: Buffer.from('image-bytes'),
          headers: { 'content-type': 'image/jpeg' },
        };
      }
    );
    (
      api as unknown as {
        axios: { get: typeof get };
      }
    ).axios.get = get;

    await assert.rejects(api.getMagazineCover('../secret'), /invalid/i);
    assert.strictEqual(get.mock.callCount(), 0);
  });

  it('rejects non-raster cover responses', async () => {
    const api = new LazyLibrarianAPI({
      url: 'http://localhost:5299',
      apiKey: 'key',
    });
    const get = mock.fn(
      async (url: string, options?: Record<string, unknown>) => {
        assert.ok(url);
        assert.ok(options);
        return {
          data: Buffer.from('<svg/>'),
          headers: { 'content-type': 'image/svg+xml' },
        };
      }
    );
    (
      api as unknown as {
        axios: { get: typeof get };
      }
    ).axios.get = get;

    await assert.rejects(api.getMagazineCover('b'.repeat(32)), /raster image/i);
  });
});
