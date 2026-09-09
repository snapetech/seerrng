import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DISCOVER_SHELF_POSTER_CACHE_WARM_LIMIT,
  MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT,
  getImageUrls,
} from './useWarmImageCache';

describe('poster cache warming', () => {
  it('preserves resolved video artwork and skips authenticated local covers', () => {
    const src = 'https://artworks.thetvdb.com/banners/poster.jpg';
    assert.deepEqual(getImageUrls({ mediaType: 'tv', posterPath: src }, true), [
      src,
    ]);
    assert.deepEqual(
      getImageUrls(
        { mediaType: 'movie', posterPath: '/api/v1/movie/1/cover' },
        true
      ),
      []
    );
  });
  it('warms only poster sources when posterOnly is enabled', () => {
    assert.deepEqual(
      getImageUrls(
        {
          mediaType: 'movie',
          posterPath: '/movie.jpg',
          backdropPath: '/backdrop.jpg',
          profilePath: '/profile.jpg',
          artistBackdrop: 'https://example.test/artist-backdrop.jpg',
        },
        true
      ),
      ['https://image.tmdb.org/t/p/w342/movie.jpg']
    );
  });

  it('keeps the main and Discover section limits explicit', () => {
    assert.equal(MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT, 100);
    assert.equal(DISCOVER_SHELF_POSTER_CACHE_WARM_LIMIT, 50);
  });

  it('keeps album and book cover URLs eligible', () => {
    assert.deepEqual(
      getImageUrls(
        {
          mediaType: 'book',
          posterPath: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        },
        true
      ),
      ['https://covers.openlibrary.org/b/id/123-L.jpg']
    );
    assert.deepEqual(
      getImageUrls(
        {
          mediaType: 'artist',
          artistThumb: 'https://archive.org/artist/thumb.jpg',
        },
        true
      ),
      ['https://archive.org/artist/thumb.jpg']
    );
  });
});
