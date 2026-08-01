import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import { waitForBackgroundTasks } from '@server/utils/backgroundTasks';
import {
  enqueueImageCacheWarm,
  getImageCacheWarmPath,
  getImageCacheWarmProvider,
  getQueuedImageCacheWarmCount,
  isImageCacheWarmUrl,
  maxQueuedWarmUrls,
} from './imageCacheWarmer';

afterEach(() => {
  mock.restoreAll();
});

describe('getImageCacheWarmProvider', () => {
  it('maps all proxied image providers to warmable cache providers', () => {
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://image.tmdb.org/t/p/w300/poster.jpg')
      ),
      'tmdb'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://artworks.thetvdb.com/banners/poster.jpg')
      ),
      'tvdb'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://coverartarchive.org/release/id/front-250')
      ),
      'coverartarchive'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://archive.org/download/artist/thumb.jpg')
      ),
      'archiveorg'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://r2.theaudiodb.com/images/media/artist/thumb.jpg')
      ),
      'theaudiodb'
    );
    assert.equal(
      getImageCacheWarmProvider(
        new URL('https://covers.openlibrary.org/b/id/123-L.jpg')
      ),
      'openlibrarycovers'
    );
  });

  it('ignores unsupported image providers', () => {
    assert.equal(
      getImageCacheWarmProvider(new URL('https://example.com/image.jpg')),
      null
    );
  });
});

describe('getImageCacheWarmPath', () => {
  it('keeps query strings aligned with image proxy cache keys', () => {
    assert.equal(
      getImageCacheWarmPath(
        new URL('https://image.tmdb.org/t/p/w300/poster.jpg?version=2&lang=en')
      ),
      '/t/p/w300/poster.jpg?version=2&lang=en'
    );
  });
});

describe('isImageCacheWarmUrl', () => {
  it('accepts supported image provider URLs', () => {
    assert.equal(
      isImageCacheWarmUrl('https://image.tmdb.org/t/p/w300/poster.jpg'),
      true
    );
  });

  it('rejects malformed or unsupported warm URLs before queueing', () => {
    assert.equal(isImageCacheWarmUrl('not-a-url'), false);
    assert.equal(
      isImageCacheWarmUrl('http://image.tmdb.org/poster.jpg'),
      false
    );
    assert.equal(isImageCacheWarmUrl('https://example.com/poster.jpg'), false);
    assert.equal(
      isImageCacheWarmUrl('https://user:pass@image.tmdb.org/t/p/w300/a.jpg'),
      false
    );
    assert.equal(
      isImageCacheWarmUrl('https://image.tmdb.org//evil.example/a.jpg'),
      false
    );
    assert.equal(
      isImageCacheWarmUrl('https://image.tmdb.org/https://evil.example/a.jpg'),
      false
    );
  });

  it('rejects oversized warm URL paths before queueing', () => {
    assert.equal(
      isImageCacheWarmUrl(`https://image.tmdb.org/${'x'.repeat(2049)}`),
      false
    );
  });
});

describe('enqueueImageCacheWarm', () => {
  it('skips external cache warming in E2E test mode', () => {
    const settings = getSettings();
    const previousCacheImages = settings.main.cacheImages;
    const previousE2eFlag = process.env.E2E_TESTS;
    settings.main.cacheImages = true;
    process.env.E2E_TESTS = 'true';

    try {
      assert.strictEqual(
        enqueueImageCacheWarm([
          'https://image.tmdb.org/t/p/w300/e2e-isolation.jpg',
        ]),
        0
      );
      assert.strictEqual(getQueuedImageCacheWarmCount(), 0);
    } finally {
      settings.main.cacheImages = previousCacheImages;
      if (previousE2eFlag === undefined) {
        delete process.env.E2E_TESTS;
      } else {
        process.env.E2E_TESTS = previousE2eFlag;
      }
    }
  });

  it('registers cache writes for graceful shutdown draining', async () => {
    const settings = getSettings();
    const previousCacheImages = settings.main.cacheImages;
    settings.main.cacheImages = true;
    let releaseWrite: (() => void) | undefined;
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    mock.method(ImageProxy.prototype, 'getImage', () => heldWrite);

    try {
      assert.strictEqual(
        enqueueImageCacheWarm([
          'https://image.tmdb.org/t/p/w300/shutdown-drain.jpg',
        ]),
        1
      );

      let drained = false;
      const drain = waitForBackgroundTasks().then(() => {
        drained = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.strictEqual(drained, false);
      assert.strictEqual(getQueuedImageCacheWarmCount(), 1);

      releaseWrite?.();
      await drain;
      assert.strictEqual(getQueuedImageCacheWarmCount(), 0);
    } finally {
      releaseWrite?.();
      await waitForBackgroundTasks();
      settings.main.cacheImages = previousCacheImages;
    }
  });

  it('bounds the global warm queue under distinct-URL floods', async () => {
    const settings = getSettings();
    const previousCacheImages = settings.main.cacheImages;
    settings.main.cacheImages = true;
    mock.method(ImageProxy.prototype, 'getImage', async () => {
      throw new Error('Expected test cache miss');
    });

    try {
      let accepted = 0;
      for (let batch = 0; batch < 20; batch++) {
        accepted += enqueueImageCacheWarm(
          Array.from(
            { length: 80 },
            (_, index) =>
              `https://image.tmdb.org/t/p/w300/${batch}-${index}.jpg`
          )
        );
      }

      assert.strictEqual(accepted, maxQueuedWarmUrls);
      assert.strictEqual(getQueuedImageCacheWarmCount(), maxQueuedWarmUrls);

      for (
        let attempt = 0;
        attempt < 20 && getQueuedImageCacheWarmCount() > 0;
        attempt++
      ) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.strictEqual(getQueuedImageCacheWarmCount(), 0);
    } finally {
      settings.main.cacheImages = previousCacheImages;
    }
  });
});
