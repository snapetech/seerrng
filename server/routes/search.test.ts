import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import searchRoutes from './search';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/search', searchRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

const mockPrivateMethod = mock.method as (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => unknown;
const mockPrivate = (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => mockPrivateMethod.call(mock, object, methodName, implementation);

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('GET /search', () => {
  it('rejects missing search queries before provider lookup', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Query must be a string/);
  });

  it('rejects oversized search queries', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent
      .get('/search/company')
      .query({ query: 'x'.repeat(257) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /256 characters or fewer/);
  });

  it('rejects array language parameters before provider lookup', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent
      .get('/search')
      .query({ query: 'matrix', language: ['en', 'fr'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Language must be a string/);
  });

  it('rejects blank keyword searches', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search/keyword').query({ query: '   ' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Query is required/);
  });

  it('returns global video, music, and book results together', async () => {
    mock.method(MusicBrainz.prototype, 'searchAlbum', async () => [
      {
        id: 'album-1',
        media_type: 'album',
        title: 'Global Album',
        score: 95,
        'primary-type': 'Album',
        'first-release-date': '2026-02-01',
        'artist-credit': [
          {
            name: 'Global Artist',
            artist: {
              id: 'artist-1',
              name: 'Global Artist',
              'sort-name': 'Artist, Global',
            },
          },
        ],
        posterPath: undefined,
      },
      {
        id: 'ALBUM-1',
        media_type: 'album',
        title: 'Global Album',
        score: 94,
        'primary-type': 'Album',
        'first-release-date': '2026-02-01',
        'artist-credit': [
          {
            name: 'Global Artist',
            artist: {
              id: 'artist-1',
              name: 'Global Artist',
              'sort-name': 'Artist, Global',
            },
          },
        ],
        posterPath: undefined,
      },
    ]);
    mock.method(MusicBrainz.prototype, 'searchArtist', async () => [
      {
        id: 'artist-1',
        media_type: 'artist',
        name: 'Global Artist',
        type: 'Group',
        'sort-name': 'Artist, Global',
        score: 90,
      },
    ]);
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint) => {
      const endpointString = endpoint as string;
      if (endpointString === '/search/multi') {
        return {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 100,
              media_type: 'movie',
              adult: false,
              backdrop_path: '/movie-backdrop.jpg',
              genre_ids: [18],
              original_language: 'en',
              original_title: 'Global Movie',
              overview: 'Movie result',
              popularity: 50,
              poster_path: '/movie-poster.jpg',
              release_date: '2026-01-01',
              title: 'Global Movie',
              video: false,
              vote_average: 7,
              vote_count: 10,
            },
          ],
        };
      }

      if (endpointString === '/search.json') {
        return {
          numFound: 1,
          start: 0,
          docs: [
            {
              key: '/works/OL123W',
              title: 'Global Book',
              author_name: ['Book Author'],
              first_publish_year: 2026,
              cover_i: 123,
              isbn: ['9780000000002'],
              edition_key: ['OL123M'],
            },
            {
              key: '/works/OL124W',
              title: 'Global Book',
              author_name: ['Book Author'],
              first_publish_year: 2026,
              cover_i: 124,
              isbn: ['9780000000004'],
              edition_key: ['OL124M'],
            },
          ],
        };
      }

      throw new Error(`Unexpected endpoint: ${endpointString}`);
    });
    mock.method(
      TmdbPersonMapper.prototype,
      'batchGetMappings',
      async () => ({})
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));

    await getRepository(MetadataAlbum).save(
      new MetadataAlbum({
        mbAlbumId: 'album-1',
        caaUrl: 'https://covers.example/album.jpg',
      })
    );
    const bookMedia = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media: bookMedia,
        provider: MediaIdentifierProvider.ISBN,
        value: '9780000000002',
        canonical: true,
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search').query({ query: 'global' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { mediaType: string }) => result.mediaType),
      ['movie', 'album', 'artist', 'book']
    );
    assert.equal(res.body.totalResults, 4);

    const album = res.body.results.find(
      (result: { mediaType: string }) => result.mediaType === 'album'
    );
    assert.equal(album.posterPath, 'https://covers.example/album.jpg');

    const book = res.body.results.find(
      (result: { mediaType: string }) => result.mediaType === 'book'
    );
    assert.equal(book.id, 'OL123W');
    assert.equal(book.isbn13, '9780000000002');
    assert.equal(book.mediaInfo.id, bookMedia.id);
    assert.equal(book.mediaInfo.status, MediaStatus.AVAILABLE);
  });

  it('keeps global book and music search active after the first page', async () => {
    let albumSearchOffset: number | undefined;
    let artistSearchOffset: number | undefined;
    let bookSearchPage: number | undefined;

    mock.method(
      MusicBrainz.prototype,
      'searchAlbum',
      async (options: unknown) => {
        const { offset } = options as { offset?: number };
        albumSearchOffset = offset;

        return [
          {
            id: 'album-page-2',
            media_type: 'album',
            title: 'Paged Album',
            score: 95,
            'primary-type': 'Album',
            'first-release-date': '2026-02-01',
            'artist-credit': [
              {
                name: 'Paged Artist',
                artist: {
                  id: 'artist-page-2',
                  name: 'Paged Artist',
                  'sort-name': 'Artist, Paged',
                },
              },
            ],
            posterPath: undefined,
          },
        ];
      }
    );
    mock.method(
      MusicBrainz.prototype,
      'searchArtist',
      async (options: unknown) => {
        const { offset } = options as { offset?: number };
        artistSearchOffset = offset;

        return [
          {
            id: 'artist-page-2',
            media_type: 'artist',
            name: 'Paged Artist',
            type: 'Group',
            'sort-name': 'Artist, Paged',
            score: 90,
          },
        ];
      }
    );
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint, options) => {
      const endpointString = endpoint as string;
      if (endpointString === '/search/multi') {
        return {
          page: 2,
          total_pages: 2,
          total_results: 20,
          results: [],
        };
      }

      if (endpointString === '/search.json') {
        bookSearchPage = Number(
          (options as { params?: { page?: string } })?.params?.page
        );

        return {
          numFound: 30,
          start: 20,
          docs: [
            {
              key: '/works/OLPAGE2W',
              title: 'Paged Book',
              author_name: ['Paged Author'],
              first_publish_year: 2026,
              cover_i: 456,
              isbn: ['9780000000003'],
              edition_key: ['OLPAGE2M'],
            },
          ],
        };
      }

      throw new Error(`Unexpected endpoint: ${endpointString}`);
    });
    mock.method(
      TmdbPersonMapper.prototype,
      'batchGetMappings',
      async () => ({})
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search').query({ query: 'paged', page: 2 });

    assert.strictEqual(res.status, 200);
    assert.equal(albumSearchOffset, 20);
    assert.equal(artistSearchOffset, 20);
    assert.equal(bookSearchPage, 2);
    assert.deepStrictEqual(
      res.body.results.map((result: { mediaType: string }) => result.mediaType),
      ['album', 'artist', 'book']
    );
  });

  it('returns an Open Library work directly by provider ID', async () => {
    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Left Hand of Darkness',
      description: 'A classic science fiction novel.',
      covers: [1234],
      authors: [{ author: { key: '/authors/OL1A' } }],
      first_publish_date: '1969',
    }));
    mock.method(OpenLibraryAPI.prototype, 'getWorkEditions', async () => ({
      size: 1,
      entries: [
        {
          key: '/books/OL1M',
          title: 'The Left Hand of Darkness',
          isbn_13: ['9780441478125'],
        },
      ],
    }));

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL45804W',
        canonical: true,
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent
      .get('/search')
      .query({ query: 'openlibrary:OL45804W' });

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.totalResults, 1);
    assert.equal(res.body.results[0].mediaType, 'book');
    assert.equal(res.body.results[0].id, 'OL45804W');
    assert.equal(res.body.results[0].isbn13, '9780441478125');
    assert.equal(res.body.results[0].mediaInfo.status, MediaStatus.PENDING);
  });

  it('returns book results directly by ISBN', async () => {
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async (options: unknown) => {
        assert.deepStrictEqual(options, {
          query: 'isbn:9780441478125',
          page: 1,
          limit: 20,
        });

        return {
          numFound: 1,
          start: 0,
          docs: [
            {
              key: '/works/OL45804W',
              title: 'The Left Hand of Darkness',
              author_name: ['Ursula K. Le Guin'],
              first_publish_year: 1969,
              isbn: ['9780441478125'],
              edition_key: ['OL1M'],
            },
          ],
        };
      }
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent
      .get('/search')
      .query({ query: 'isbn:9780441478125' });

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.totalResults, 1);
    assert.equal(res.body.results[0].mediaType, 'book');
    assert.equal(res.body.results[0].id, 'OL45804W');
    assert.equal(res.body.results[0].isbn13, '9780441478125');
  });

  it('returns a MusicBrainz release group directly by provider ID', async () => {
    mock.method(MusicBrainz.prototype, 'getReleaseGroupDetails', async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      media_type: 'album',
      title: 'Direct Album',
      score: 100,
      'primary-type': 'Album',
      'primary-type-id': 'f529b476-6e62-324f-b0aa-1f3e33d313fc',
      'type-id': 'f529b476-6e62-324f-b0aa-1f3e33d313fc',
      'first-release-date': '2026-05-01',
      releasedate: '2026-05-01',
      count: 1,
      'artist-credit': [
        {
          name: 'Direct Artist',
          artist: {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'Direct Artist',
            'sort-name': 'Artist, Direct',
          },
        },
      ],
      releases: [],
      posterPath: undefined,
    }));

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: '11111111-1111-1111-1111-111111111111',
        status: MediaStatus.PENDING,
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search').query({
      query: 'musicbrainz:11111111-1111-1111-1111-111111111111',
    });

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.totalResults, 1);
    assert.equal(res.body.results[0].mediaType, 'album');
    assert.equal(res.body.results[0].id, media.mbId);
    assert.equal(res.body.results[0].title, 'Direct Album');
    assert.equal(res.body.results[0].mediaInfo.status, MediaStatus.PENDING);
  });

  it('resolves a MusicBrainz release ID to its release group in search', async () => {
    mock.method(
      MusicBrainz.prototype,
      'getReleaseGroupDetails',
      async (options: unknown) => {
        const { releaseGroupId } = options as { releaseGroupId: string };

        if (releaseGroupId === '33333333-3333-3333-3333-333333333333') {
          throw new Error('not a release group');
        }

        assert.equal(releaseGroupId, '44444444-4444-4444-4444-444444444444');

        return {
          id: releaseGroupId,
          media_type: 'album',
          title: 'Resolved Album',
          score: 100,
          'primary-type': 'Album',
          'primary-type-id': 'f529b476-6e62-324f-b0aa-1f3e33d313fc',
          'type-id': 'f529b476-6e62-324f-b0aa-1f3e33d313fc',
          'first-release-date': '2026-05-02',
          releasedate: '2026-05-02',
          count: 1,
          'artist-credit': [
            {
              name: 'Resolved Artist',
              artist: {
                id: '55555555-5555-5555-5555-555555555555',
                name: 'Resolved Artist',
                'sort-name': 'Artist, Resolved',
              },
            },
          ],
          releases: [],
          posterPath: undefined,
        };
      }
    );
    mock.method(MusicBrainz.prototype, 'getReleaseGroup', async () => {
      return '44444444-4444-4444-4444-444444444444';
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent
      .get('/search')
      .query({ query: 'mbid:33333333-3333-3333-3333-333333333333' });

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.totalResults, 1);
    assert.equal(res.body.results[0].mediaType, 'album');
    assert.equal(
      res.body.results[0].id,
      '44444444-4444-4444-4444-444444444444'
    );
    assert.equal(res.body.results[0].title, 'Resolved Album');
  });

  it('keeps unmapped artists visible and suppresses TMDB-mapped duplicates', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint) => {
      const endpointString = endpoint as string;
      if (endpointString === '/search/multi') {
        return {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 500,
              media_type: 'person',
              adult: false,
              known_for: [],
              known_for_department: 'Sound',
              name: 'Mapped Singer',
              popularity: 20,
              profile_path: '/mapped.jpg',
            },
          ],
        };
      }

      if (endpointString === '/search.json') {
        return {
          numFound: 0,
          start: 0,
          docs: [],
        };
      }

      throw new Error(`Unexpected endpoint: ${endpointString}`);
    });
    mock.method(MusicBrainz.prototype, 'searchAlbum', async () => []);
    mock.method(MusicBrainz.prototype, 'searchArtist', async () => [
      {
        id: 'mapped-artist',
        media_type: 'artist',
        name: 'Mapped Singer',
        type: 'Person',
        'sort-name': 'Singer, Mapped',
        score: 99,
      },
      {
        id: 'unmapped-artist',
        media_type: 'artist',
        name: 'Unmapped Singer',
        type: 'Person',
        'sort-name': 'Singer, Unmapped',
        score: 98,
      },
    ]);
    mock.method(TmdbPersonMapper.prototype, 'batchGetMappings', async () => ({
      'mapped-artist': {
        personId: 500,
        profilePath: 'https://image.tmdb.org/t/p/w500/mapped.jpg',
      },
      'unmapped-artist': {
        personId: null,
        profilePath: null,
      },
    }));
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));

    await getRepository(MetadataArtist).save(
      new MetadataArtist({
        mbArtistId: 'mapped-artist',
        tmdbPersonId: '500',
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/search').query({ query: 'singer' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { mediaType: string; name: string }) => ({
        mediaType: result.mediaType,
        name: result.name,
      })),
      [
        { mediaType: 'person', name: 'Mapped Singer' },
        { mediaType: 'artist', name: 'Unmapped Singer' },
      ]
    );
  });
});
