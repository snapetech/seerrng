import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AVATAR_FALLBACK_IMAGE,
  getImageCacheUrl,
  getImageErrorFallback,
  getInitialImageUrl,
  getTmdbPosterImageUrl,
  getTmdbPosterImageVariants,
  isRemoteAvatarCacheUrlAllowed,
} from './imageCache';

describe('poster artwork identity', () => {
  it('uses the same base URL for cards and compatible detail variants', () => {
    const path = '/poster.jpg?version=2';
    assert.equal(
      getTmdbPosterImageUrl(path),
      'https://image.tmdb.org/t/p/w342/poster.jpg?version=2'
    );
    assert.deepEqual(
      getTmdbPosterImageVariants(path),
      [342, 500, 780].map((width) => ({
        src: `https://image.tmdb.org/t/p/w${width}${path}`,
        width,
      }))
    );
  });

  it('preserves provider, edition, query, and explicit crop identities', () => {
    for (const src of [
      'https://artworks.thetvdb.com/banners/poster.jpg',
      'https://covers.openlibrary.org/b/id/123-L.jpg',
      'https://archive.org/download/album/cover_thumb250.jpg',
      'https://image.tmdb.org/t/p/w300_and_h450_face/poster.jpg',
      '/api/v1/book/OL123W/cover?mediaId=12&format=audiobook',
      '/imageproxy/tmdb/t/p/w342/poster.jpg',
      '/images/seerr_poster_not_found.png',
    ]) {
      assert.equal(getTmdbPosterImageUrl(src), src);
      assert.equal(getTmdbPosterImageVariants(src), undefined);
    }
    assert.equal(getTmdbPosterImageUrl(undefined), undefined);
    assert.equal(getTmdbPosterImageVariants(undefined), undefined);
    assert.notDeepEqual(
      getTmdbPosterImageVariants('/poster.jpg?version=1'),
      getTmdbPosterImageVariants('/poster.jpg?version=2')
    );
  });

  it('preserves resolved artist photos while supporting TMDB profile paths', () => {
    const artist = 'https://r2.theaudiodb.com/images/media/artist/thumb.jpg';
    assert.equal(getTmdbPosterImageUrl(artist, 'w600_and_h900_bestv2'), artist);
    assert.equal(
      getTmdbPosterImageUrl('/person.jpg', 'w600_and_h900_bestv2'),
      'https://image.tmdb.org/t/p/w600_and_h900_bestv2/person.jpg'
    );
  });
});

describe('getInitialImageUrl', () => {
  it('shows the bundled default while avatars load', () => {
    assert.equal(
      getInitialImageUrl('avatar', '/avatarproxy/remote?url=plex'),
      AVATAR_FALLBACK_IMAGE
    );
    assert.equal(
      getInitialImageUrl('tmdb', '/imageproxy/tmdb/poster.jpg'),
      '/imageproxy/tmdb/poster.jpg'
    );
  });
});

describe('getImageErrorFallback', () => {
  it('falls back failed avatars once without changing other image types', () => {
    assert.equal(
      getImageErrorFallback('avatar', 'https://plex.tv/users/1/avatar'),
      AVATAR_FALLBACK_IMAGE
    );
    assert.equal(getImageErrorFallback('avatar', AVATAR_FALLBACK_IMAGE), null);
    assert.equal(
      getImageErrorFallback('tmdb', 'https://example.com/poster.jpg'),
      null
    );
  });
});

describe('getImageCacheUrl', () => {
  it('rewrites supported image providers when image caching is enabled', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://image.tmdb.org/t/p/w300/poster.jpg',
        type: 'tmdb',
      }),
      '/imageproxy/tmdb/t/p/w300/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://artworks.thetvdb.com/banners/poster.jpg',
        type: 'tvdb',
      }),
      '/imageproxy/tvdb/banners/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        type: 'book',
      }),
      '/imageproxy/openlibrarycovers/b/id/123-L.jpg'
    );
  });

  it('rewrites supported image providers by URL even when the type is generic', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        type: 'tmdb',
      }),
      '/imageproxy/openlibrarycovers/b/id/123-L.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://coverartarchive.org/release/id/front-250',
        type: 'tmdb',
      }),
      '/imageproxy/coverartarchive/release/id/front-250'
    );
  });

  it('rewrites music provider variants', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://coverartarchive.org/release/id/front-250',
        type: 'music',
      }),
      '/imageproxy/coverartarchive/release/id/front-250'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://archive.org/download/artist/thumb.jpg',
        type: 'music',
      }),
      '/imageproxy/archiveorg/download/artist/thumb.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://r2.theaudiodb.com/images/media/artist/thumb.jpg',
        type: 'music',
      }),
      '/imageproxy/theaudiodb/images/media/artist/thumb.jpg'
    );
  });

  it('rewrites allowlisted remote avatar URLs', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://secure.gravatar.com/avatar/abc?d=mm',
        type: 'avatar',
      }),
      '/avatarproxy/remote?url=https%3A%2F%2Fsecure.gravatar.com%2Favatar%2Fabc%3Fd%3Dmm'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://plex.tv/users/abc/avatar?c=123',
        type: 'avatar',
      }),
      '/avatarproxy/remote?url=https%3A%2F%2Fplex.tv%2Fusers%2Fabc%2Favatar%3Fc%3D123'
    );
  });

  it('leaves local, disabled, and unsupported URLs untouched', () => {
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: '/images/local.png',
        type: 'tmdb',
      }),
      '/images/local.png'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: false,
        src: 'https://image.tmdb.org/t/p/w300/poster.jpg',
        type: 'tmdb',
      }),
      'https://image.tmdb.org/t/p/w300/poster.jpg'
    );
    assert.equal(
      getImageCacheUrl({
        cacheImages: true,
        src: 'https://example.com/avatar.png',
        type: 'avatar',
      }),
      'https://example.com/avatar.png'
    );
  });
});

describe('isRemoteAvatarCacheUrlAllowed', () => {
  it('accepts only safe avatar provider URLs', () => {
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('https://images.plex.tv/users/1/avatar'),
      true
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('https://plex.tv/users/1/avatar'),
      true
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('http://images.plex.tv/users/1/avatar'),
      false
    );
    assert.equal(
      isRemoteAvatarCacheUrlAllowed('https://example.com/avatar.png'),
      false
    );
  });
});
