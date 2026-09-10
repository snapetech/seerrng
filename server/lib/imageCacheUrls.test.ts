import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractImageCacheUrls } from './imageCacheUrls';

describe('resolved poster warming', () => {
  it('keeps provider URLs intact without turning local covers into TMDB paths', () => {
    assert.deepEqual(
      extractImageCacheUrls([
        {
          mediaType: 'tv',
          posterPath: 'https://artworks.thetvdb.com/banners/poster.jpg',
        },
        { mediaType: 'movie', posterPath: '/api/v1/movie/1/cover' },
        { mediaType: 'tv', posterPath: '/imageproxy/tvdb/banners/poster.jpg' },
        {
          mediaType: 'movie',
          posterPath: '/images/seerr_poster_not_found.png',
        },
      ]),
      ['https://artworks.thetvdb.com/banners/poster.jpg']
    );
  });
});

describe('extractImageCacheUrls', () => {
  it('extracts warmable image URLs from nested media responses', () => {
    const urls = extractImageCacheUrls({
      results: [
        {
          mediaType: 'movie',
          posterPath: '/movie.jpg',
          backdropPath: '/movie-backdrop.jpg',
        },
        {
          mediaType: 'album',
          posterPath:
            'https://coverartarchive.org/release/release-id/front-250',
        },
        {
          mediaType: 'book',
          posterPath: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        },
        {
          tvdbId: 123,
          remotePoster: 'https://artworks.thetvdb.com/banners/poster.jpg',
        },
      ],
      graph: {
        edges: [
          {
            node: {
              mediaType: 'artist',
              artistThumb: 'https://archive.org/download/artist/thumb.jpg',
              artistBackdrop:
                'https://archive.org/download/artist/backdrop.jpg',
            },
          },
          {
            node: {
              mediaType: 'person',
              profilePath: '/person.jpg',
            },
          },
        ],
      },
    });

    assert.deepEqual(urls, [
      'https://image.tmdb.org/t/p/w342/movie.jpg',
      'https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/movie-backdrop.jpg',
      'https://coverartarchive.org/release/release-id/front-250',
      'https://covers.openlibrary.org/b/id/123-L.jpg',
      'https://artworks.thetvdb.com/banners/poster.jpg',
      'https://archive.org/download/artist/thumb.jpg',
      'https://archive.org/download/artist/backdrop.jpg',
      'https://image.tmdb.org/t/p/w600_and_h900_bestv2/person.jpg',
    ]);
  });

  it('deduplicates URLs and ignores unsupported relative paths', () => {
    const urls = extractImageCacheUrls({
      results: [
        {
          mediaType: 'album',
          posterPath: '/not-a-provider-path.jpg',
        },
        {
          mediaType: 'tv',
          posterPath: '/same.jpg',
        },
        {
          mediaType: 'tv',
          posterPath: '/same.jpg',
        },
      ],
    });

    assert.deepEqual(urls, ['https://image.tmdb.org/t/p/w342/same.jpg']);
  });

  it('ignores non-HTTP-like external image strings', () => {
    const urls = extractImageCacheUrls({
      mediaType: 'album',
      posterPath: 'httpx://coverartarchive.org/release/id/front-250',
      artistThumb: 'javascript:alert(1)',
    });

    assert.deepEqual(urls, []);
  });

  it('bounds traversal of deeply nested response bodies', () => {
    let nested: Record<string, unknown> = {
      mediaType: 'book',
      posterPath: 'https://covers.openlibrary.org/b/id/deep-L.jpg',
    };

    for (let i = 0; i < 20; i += 1) {
      nested = { child: nested };
    }

    assert.deepEqual(extractImageCacheUrls(nested), []);
  });

  it('bounds traversal of very wide response bodies', () => {
    const results = Array.from({ length: 250 }, (_, index) => ({
      mediaType: 'book',
      posterPath: `https://covers.openlibrary.org/b/id/${index}-L.jpg`,
    }));

    assert.equal(extractImageCacheUrls({ results }).length, 200);
  });
});
