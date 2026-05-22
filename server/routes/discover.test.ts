import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import PlexTvAPI from '@server/api/plextv';
import { MediaType } from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import discoverRoutes from './discover';

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
  app.use('/discover', discoverRoutes);
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

before(() => {
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

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('GET /discover/movies', () => {
  it('rejects malformed movie genre IDs before provider lookup', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed genre IDs');
    });

    const agent = await login();
    const res = await agent.get('/discover/movies/genre/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed movie studio IDs before provider lookup', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed studio IDs');
    });

    const agent = await login();
    const res = await agent.get('/discover/movies/studio/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed movie keyword IDs before provider lookup', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed keyword IDs');
    });

    const agent = await login();
    const res = await agent.get('/discover/keyword/not-a-number/movies');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed discover language query values before provider lookup', async () => {
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed language');
    });

    const agent = await login();
    const res = await agent
      .get('/discover/movies/genre/28')
      .query({ language: ['en', 'fr'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Language must be a string/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('rejects malformed trending query enums before provider lookup', async () => {
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed trending enums');
    });

    const agent = await login();
    const res = await agent
      .get('/discover/trending')
      .query({ mediaType: 'series', timeWindow: 'hour' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media type must be valid/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('rejects malformed root movie discovery query parameters before provider lookup', async () => {
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed movie query');
    });

    const agent = await login();
    const arrayRes = await agent.get('/discover/movies?genre=28&genre=12');
    const dateRes = await agent.get(
      '/discover/movies?primaryReleaseDateGte=01/01/2026'
    );

    assert.strictEqual(arrayRes.status, 400);
    assert.match(arrayRes.body.message, /Invalid discovery query/);
    assert.strictEqual(dateRes.status, 400);
    assert.match(dateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('ranks default movie discovery by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/movie');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Thin Popular Movie',
            original_title: 'Thin Popular Movie',
            release_date: '2026-01-01',
            adult: false,
            video: false,
            popularity: 100,
            poster_path: '/thin.jpg',
            backdrop_path: '/thin-backdrop.jpg',
            vote_count: 1,
            vote_average: 4,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
          {
            id: 2,
            media_type: 'movie',
            title: 'Proven Movie',
            original_title: 'Proven Movie',
            release_date: '2025-01-01',
            adult: false,
            video: false,
            popularity: 20,
            poster_path: '/proven.jpg',
            backdrop_path: '/proven-backdrop.jpg',
            vote_count: 1000,
            vote_average: 8,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/movies');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Proven Movie', 'Thin Popular Movie']
    );
  });

  it('falls back to TMDB popularity sorting when an unsupported movie sort is requested', async () => {
    let callCount = 0;
    mockPrivate(
      ExternalAPI.prototype,
      'get',
      async (endpoint: unknown, options: unknown) => {
        const requestOptions = options as { params?: { sort_by?: string } };
        assert.strictEqual(endpoint, '/discover/movie');
        assert.strictEqual(requestOptions.params?.sort_by, 'popularity.desc');
        callCount += 1;

        return {
          page: 1,
          total_pages: 1,
          total_results: 0,
          results: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/movies?sortBy=unsupported');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(callCount, 1);
  });

  it('accepts shuffle seeds for root movie discovery', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/movie');

      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Seeded Movie',
            original_title: 'Seeded Movie',
            release_date: '2026-01-01',
            adult: false,
            video: false,
            popularity: 20,
            poster_path: '/seeded.jpg',
            backdrop_path: '/seeded-backdrop.jpg',
            vote_count: 100,
            vote_average: 7,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/movies?shuffleSeed=refresh-a');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].title, 'Seeded Movie');
  });

  it('changes root movie order for different shuffle seeds', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/movie');

      return {
        page: 1,
        total_pages: 1,
        total_results: 5,
        results: Array.from({ length: 5 }, (_, index) => ({
          id: index + 1,
          media_type: 'movie',
          title: `Movie ${index}`,
          original_title: `Movie ${index}`,
          release_date: '2026-01-01',
          adult: false,
          video: false,
          popularity: 20 - index,
          poster_path: `/movie-${index}.jpg`,
          backdrop_path: `/movie-${index}-backdrop.jpg`,
          vote_count: 100,
          vote_average: 7,
          genre_ids: [],
          overview: '',
          original_language: 'en',
        })),
      };
    });

    const agent = await login();
    const firstSeed = await agent.get('/discover/movies?shuffleSeed=refresh-a');
    const secondSeed = await agent.get(
      '/discover/movies?shuffleSeed=refresh-b'
    );

    assert.strictEqual(firstSeed.status, 200);
    assert.strictEqual(secondSeed.status, 200);
    assert.notDeepStrictEqual(
      firstSeed.body.results.map((result: { title: string }) => result.title),
      secondSeed.body.results.map((result: { title: string }) => result.title)
    );
  });

  it('accepts numeric query parser values for root movie discovery', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/movie');

      return {
        page: 1,
        total_pages: 1,
        total_results: 0,
        results: [],
      };
    });

    const agent = await login();
    const res = await agent
      .get('/discover/movies')
      .query({ page: 1, genre: 28, shuffleSeed: 'refresh-a' });

    assert.strictEqual(res.status, 200);
  });

  it('ranks movie genre discovery by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      if (endpoint === '/genre/movie/list') {
        return { genres: [{ id: 28, name: 'Action' }] };
      }

      assert.strictEqual(endpoint, '/discover/movie');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Thin Genre Movie',
            original_title: 'Thin Genre Movie',
            release_date: '2026-01-01',
            adult: false,
            video: false,
            popularity: 100,
            poster_path: '/thin.jpg',
            backdrop_path: '/thin-backdrop.jpg',
            vote_count: 1,
            vote_average: 4,
            genre_ids: [28],
            overview: '',
            original_language: 'en',
          },
          {
            id: 2,
            media_type: 'movie',
            title: 'Proven Genre Movie',
            original_title: 'Proven Genre Movie',
            release_date: '2025-01-01',
            adult: false,
            video: false,
            popularity: 20,
            poster_path: '/proven.jpg',
            backdrop_path: '/proven-backdrop.jpg',
            vote_count: 1000,
            vote_average: 8,
            genre_ids: [28],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/movies/genre/28');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Proven Genre Movie', 'Thin Genre Movie']
    );
  });

  it('ranks keyword movie discovery by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/keyword/999/movies');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Thin Keyword Movie',
            original_title: 'Thin Keyword Movie',
            release_date: '2026-01-01',
            adult: false,
            video: false,
            popularity: 100,
            poster_path: '/thin.jpg',
            backdrop_path: '/thin-backdrop.jpg',
            vote_count: 1,
            vote_average: 4,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
          {
            id: 2,
            media_type: 'movie',
            title: 'Proven Keyword Movie',
            original_title: 'Proven Keyword Movie',
            release_date: '2025-01-01',
            adult: false,
            video: false,
            popularity: 20,
            poster_path: '/proven.jpg',
            backdrop_path: '/proven-backdrop.jpg',
            vote_count: 1000,
            vote_average: 8,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/keyword/999/movies');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Proven Keyword Movie', 'Thin Keyword Movie']
    );
  });
});

describe('GET /discover/tv', () => {
  it('rejects malformed series genre IDs before provider lookup', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed genre IDs');
    });

    const agent = await login();
    const res = await agent.get('/discover/tv/genre/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed network IDs before provider lookup', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed network IDs');
    });

    const agent = await login();
    const res = await agent.get('/discover/tv/network/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed root series discovery query parameters before provider lookup', async () => {
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for malformed series query');
    });

    const agent = await login();
    const languageRes = await agent.get('/discover/tv?language=en&language=fr');
    const dateRes = await agent.get('/discover/tv?firstAirDateLte=01/01/2026');

    assert.strictEqual(languageRes.status, 400);
    assert.match(languageRes.body.message, /Invalid discovery query/);
    assert.strictEqual(dateRes.status, 400);
    assert.match(dateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('ranks default series discovery by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 1,
            media_type: 'tv',
            name: 'Thin Popular Series',
            original_name: 'Thin Popular Series',
            origin_country: ['US'],
            first_air_date: '2026-01-01',
            popularity: 100,
            poster_path: '/thin.jpg',
            backdrop_path: '/thin-backdrop.jpg',
            vote_count: 1,
            vote_average: 4,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
          {
            id: 2,
            media_type: 'tv',
            name: 'Proven Series',
            original_name: 'Proven Series',
            origin_country: ['US'],
            first_air_date: '2025-01-01',
            popularity: 20,
            poster_path: '/proven.jpg',
            backdrop_path: '/proven-backdrop.jpg',
            vote_count: 1000,
            vote_average: 8,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/tv');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { name: string }) => result.name),
      ['Proven Series', 'Thin Popular Series']
    );
  });

  it('falls back to TMDB popularity sorting when an unsupported series sort is requested', async () => {
    let callCount = 0;
    mockPrivate(
      ExternalAPI.prototype,
      'get',
      async (endpoint: unknown, options: unknown) => {
        const requestOptions = options as { params?: { sort_by?: string } };
        assert.strictEqual(endpoint, '/discover/tv');
        assert.strictEqual(requestOptions.params?.sort_by, 'popularity.desc');
        callCount += 1;

        return {
          page: 1,
          total_pages: 1,
          total_results: 0,
          results: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/tv?sortBy=unsupported');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(callCount, 1);
  });

  it('accepts shuffle seeds for root series discovery', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [
          {
            id: 1,
            media_type: 'tv',
            name: 'Seeded Series',
            original_name: 'Seeded Series',
            origin_country: ['US'],
            first_air_date: '2026-01-01',
            popularity: 20,
            poster_path: '/seeded.jpg',
            backdrop_path: '/seeded-backdrop.jpg',
            vote_count: 100,
            vote_average: 7,
            genre_ids: [],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/tv?shuffleSeed=refresh-a');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].name, 'Seeded Series');
  });

  it('changes root series order for different shuffle seeds', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 5,
        results: Array.from({ length: 5 }, (_, index) => ({
          id: index + 1,
          media_type: 'tv',
          name: `Series ${index}`,
          original_name: `Series ${index}`,
          origin_country: ['US'],
          first_air_date: '2026-01-01',
          popularity: 20 - index,
          poster_path: `/series-${index}.jpg`,
          backdrop_path: `/series-${index}-backdrop.jpg`,
          vote_count: 100,
          vote_average: 7,
          genre_ids: [],
          overview: '',
          original_language: 'en',
        })),
      };
    });

    const agent = await login();
    const firstSeed = await agent.get('/discover/tv?shuffleSeed=refresh-a');
    const secondSeed = await agent.get('/discover/tv?shuffleSeed=refresh-b');

    assert.strictEqual(firstSeed.status, 200);
    assert.strictEqual(secondSeed.status, 200);
    assert.notDeepStrictEqual(
      firstSeed.body.results.map((result: { name: string }) => result.name),
      secondSeed.body.results.map((result: { name: string }) => result.name)
    );
  });

  it('accepts numeric query parser values for root series discovery', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/discover/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 0,
        results: [],
      };
    });

    const agent = await login();
    const res = await agent
      .get('/discover/tv')
      .query({ page: 1, network: 213, shuffleSeed: 'refresh-a' });

    assert.strictEqual(res.status, 200);
  });

  it('ranks series genre discovery by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      if (endpoint === '/genre/tv/list') {
        return { genres: [{ id: 18, name: 'Drama' }] };
      }

      assert.strictEqual(endpoint, '/discover/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 1,
            media_type: 'tv',
            name: 'Thin Genre Series',
            original_name: 'Thin Genre Series',
            origin_country: ['US'],
            first_air_date: '2026-01-01',
            popularity: 100,
            poster_path: '/thin.jpg',
            backdrop_path: '/thin-backdrop.jpg',
            vote_count: 1,
            vote_average: 4,
            genre_ids: [18],
            overview: '',
            original_language: 'en',
          },
          {
            id: 2,
            media_type: 'tv',
            name: 'Proven Genre Series',
            original_name: 'Proven Genre Series',
            origin_country: ['US'],
            first_air_date: '2025-01-01',
            popularity: 20,
            poster_path: '/proven.jpg',
            backdrop_path: '/proven-backdrop.jpg',
            vote_count: 1000,
            vote_average: 8,
            genre_ids: [18],
            overview: '',
            original_language: 'en',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/tv/genre/18');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { name: string }) => result.name),
      ['Proven Genre Series', 'Thin Genre Series']
    );
  });
});

describe('GET /discover/music', () => {
  it('rejects oversized music discovery queries before provider lookup', async () => {
    const searchAlbum = mock.method(MusicBrainz.prototype, 'searchAlbum');
    const getFreshReleases = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases'
    );

    const agent = await login();
    const res = await agent
      .get('/discover/music')
      .query({ query: 'x'.repeat(257) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchAlbum.mock.callCount(), 0);
    assert.strictEqual(getFreshReleases.mock.callCount(), 0);
  });

  it('rejects oversized music discovery filters before provider lookup', async () => {
    const searchReleaseGroupsByTag = mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag'
    );

    const agent = await login();
    const res = await agent
      .get('/discover/music')
      .query({ genre: 'x'.repeat(513) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchReleaseGroupsByTag.mock.callCount(), 0);
  });

  it('rejects malformed music release date filters before provider lookup', async () => {
    const searchReleaseGroupsByTag = mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag'
    );
    const getFreshReleases = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases'
    );

    const agent = await login();
    const res = await agent.get('/discover/music').query({
      genre: 'jazz',
      primaryReleaseDateGte: ['2026-01-01', '2026-02-01'],
    });

    assert.strictEqual(res.status, 400);
    assert.match(
      res.body.message,
      /Primary release date start must be a string/
    );
    assert.strictEqual(searchReleaseGroupsByTag.mock.callCount(), 0);
    assert.strictEqual(getFreshReleases.mock.callCount(), 0);
  });

  it('rejects non-ISO music release date filters', async () => {
    const searchReleaseGroupsByTag = mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag'
    );

    const agent = await login();
    const res = await agent.get('/discover/music').query({
      genre: 'jazz',
      primaryReleaseDateLte: '01/31/2026',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /YYYY-MM-DD/);
    assert.strictEqual(searchReleaseGroupsByTag.mock.callCount(), 0);
  });

  it('returns MusicBrainz album search results when a query is provided', async () => {
    const freshReleaseMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async () => {
        throw new Error('ListenBrainz should not be called for music search');
      }
    );
    const searchAlbumMock = mock.method(
      MusicBrainz.prototype,
      'searchAlbum',
      async ({
        query,
        limit,
        offset,
      }: {
        query: string;
        limit?: number;
        offset?: number;
      }) => {
        assert.strictEqual(query, 'kind of blue');
        assert.strictEqual(limit, 100);
        assert.strictEqual(offset, 0);

        const fillerAlbum = {
          id: 'musicbrainz-release-group-filler',
          score: 10,
          media_type: 'album',
          title: 'Filler',
          'primary-type': 'Album',
          'primary-type-id': '',
          'type-id': '',
          'first-release-date': '1958',
          'artist-credit': [
            {
              name: 'Miles Davis',
              artist: {
                id: 'artist-id',
                name: 'Miles Davis',
                'sort-name': 'Davis, Miles',
              },
            },
          ],
          posterPath: undefined,
          count: 1,
          releases: [],
          releasedate: '1958',
        };

        return [
          ...Array.from({ length: 20 }, (_, index) => ({
            ...fillerAlbum,
            id: `${fillerAlbum.id}-${index}`,
          })),
          {
            id: 'musicbrainz-release-group-id',
            score: 100,
            media_type: 'album',
            title: 'Kind of Blue',
            'primary-type': 'Album',
            'primary-type-id': '',
            'type-id': '',
            'first-release-date': '1959',
            'artist-credit': [
              {
                name: 'Miles Davis',
                artist: {
                  id: 'artist-id',
                  name: 'Miles Davis',
                  'sort-name': 'Davis, Miles',
                },
              },
            ],
            posterPath: undefined,
            count: 1,
            releases: [],
            releasedate: '1959',
          },
        ];
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/music?query=kind%20of%20blue&page=2'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleaseMock.mock.callCount(), 0);
    assert.strictEqual(searchAlbumMock.mock.callCount(), 1);
    assert.strictEqual(res.body.page, 2);
    assert.strictEqual(res.body.results[0].title, 'Kind of Blue');
  });

  it('pages and sorts music discovery results', async () => {
    let freshReleaseOffset: number | undefined;
    let freshReleaseCount: number | undefined;
    mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async ({ offset, count }: { offset: number; count: number }) => {
        freshReleaseOffset = offset;
        freshReleaseCount = count;

        return {
          payload: {
            releases: [
              ...Array.from({ length: 40 }, (_, index) => ({
                artist_credit_name: 'Window Filler Artist',
                artist_mbids: [`artist-filler-${index}`],
                caa_id: index,
                caa_release_mbid: `release-filler-${index}`,
                listen_count: 1,
                release_date: '2026-04-01',
                release_group_mbid: `album-filler-${index}`,
                release_group_primary_type: 'Album',
                release_group_secondary_type: '',
                release_mbid: `release-filler-${index}`,
                release_name: `Filler Album ${index}`,
                release_tags: [],
              })),
              {
                artist_credit_name: 'Later Artist',
                artist_mbids: ['artist-later'],
                caa_id: 1,
                caa_release_mbid: 'release-later',
                listen_count: 5,
                release_date: '2026-05-10',
                release_group_mbid: 'album-later',
                release_group_primary_type: 'Album',
                release_group_secondary_type: '',
                release_mbid: 'release-later',
                release_name: 'Later Album',
                release_tags: [],
              },
              {
                artist_credit_name: 'Earlier Artist',
                artist_mbids: ['artist-earlier'],
                caa_id: 2,
                caa_release_mbid: 'release-earlier',
                listen_count: 3,
                release_date: '2026-05-01',
                release_group_mbid: 'album-earlier',
                release_group_primary_type: 'EP',
                release_group_secondary_type: '',
                release_mbid: 'release-earlier',
                release_name: 'Earlier Album',
                release_tags: [],
              },
            ],
          },
        };
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/music?days=30&sortBy=release_date.asc&page=3'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleaseOffset, 0);
    assert.strictEqual(freshReleaseCount, 100);
    assert.strictEqual(res.body.page, 3);
    assert.strictEqual(res.body.totalPages, 3);
    assert.strictEqual(res.body.totalResults, 42);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Earlier Album', 'Later Album']
    );
  });

  it('returns ListenBrainz top albums for popular music discovery', async () => {
    const topAlbumsMock = mock.method(
      ListenBrainzAPI.prototype,
      'getTopAlbums',
      async ({
        range,
        offset,
        count,
      }: {
        range: string;
        offset: number;
        count: number;
      }) => {
        assert.strictEqual(range, 'week');
        assert.strictEqual(offset, 0);
        assert.strictEqual(count, 100);

        return {
          payload: {
            count: 2,
            from_ts: 0,
            last_updated: 0,
            offset: 0,
            range,
            to_ts: 0,
            release_groups: [
              {
                artist_mbids: ['artist-popular'],
                artist_name: 'Popular Artist',
                caa_id: 1,
                caa_release_mbid: 'release-popular',
                listen_count: 500,
                release_group_mbid: 'album-popular',
                release_group_name: 'Popular Album',
              },
              {
                artist_mbids: ['artist-second'],
                artist_name: 'Second Artist',
                caa_id: 2,
                caa_release_mbid: 'release-second',
                listen_count: 300,
                release_group_mbid: 'album-second',
                release_group_name: 'Second Album',
              },
            ],
          },
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=popular.week');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(topAlbumsMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Popular Album', 'Second Album']
    );
  });

  it('diversifies popular music chart discovery by artist', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 4,
        from_ts: 0,
        last_updated: 0,
        offset: 0,
        range: 'week',
        to_ts: 0,
        release_groups: [
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-a',
            listen_count: 9000,
            release_group_mbid: 'album-artist-one-a',
            release_group_name: 'Artist One Album A',
          },
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-b',
            listen_count: 8000,
            release_group_mbid: 'album-artist-one-b',
            release_group_name: 'Artist One Album B',
          },
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-c',
            listen_count: 7000,
            release_group_mbid: 'album-artist-one-c',
            release_group_name: 'Artist One Album C',
          },
          {
            artist_mbids: ['artist-two'],
            artist_name: 'Artist Two',
            caa_release_mbid: 'release-artist-two',
            listen_count: 1,
            release_group_mbid: 'album-artist-two',
            release_group_name: 'Artist Two Album',
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=popular.week');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results
        .slice(0, 3)
        .map((result: { title: string }) => result.title),
      ['Artist One Album A', 'Artist One Album B', 'Artist Two Album']
    );
  });

  it('ranks MusicBrainz genre discovery results by score and metadata', async () => {
    const searchByTagMock = mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag',
      async ({ tags }: { tags: string[] }) => {
        assert.deepStrictEqual(tags, ['jazz']);

        return {
          totalCount: 2,
          releaseGroups: [
            {
              id: 'album-low-score',
              score: 1,
              media_type: 'album',
              title: 'Low Score Album',
              'primary-type': 'Single',
              'first-release-date': '2026-05-01',
              'artist-credit': [
                {
                  name: 'Low Score Artist',
                  artist: {
                    id: 'artist-low-score',
                    name: 'Low Score Artist',
                    'sort-name': 'Low Score Artist',
                  },
                },
              ],
              posterPath: undefined,
            },
            {
              id: 'album-high-score',
              score: 100,
              media_type: 'album',
              title: 'High Score Album',
              'primary-type': 'Album',
              'first-release-date': '2025-05-01',
              'artist-credit': [
                {
                  name: 'High Score Artist',
                  artist: {
                    id: 'artist-high-score',
                    name: 'High Score Artist',
                    'sort-name': 'High Score Artist',
                  },
                },
              ],
              posterPath: 'https://cover.example/high-score.jpg',
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?genre=jazz&sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchByTagMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['High Score Album', 'Low Score Album']
    );
  });

  it('diversifies ranked MusicBrainz genre discovery results by artist', async () => {
    mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag',
      async ({ tags }: { tags: string[] }) => {
        assert.deepStrictEqual(tags, ['jazz']);

        return {
          totalCount: 4,
          releaseGroups: [
            {
              id: 'album-artist-one-a',
              score: 100,
              media_type: 'album',
              title: 'Artist One Album A',
              'primary-type': 'Album',
              'first-release-date': '2026-05-01',
              'artist-credit': [
                {
                  name: 'Artist One',
                  artist: {
                    id: 'artist-one',
                    name: 'Artist One',
                    'sort-name': 'Artist One',
                  },
                },
              ],
              posterPath: 'https://cover.example/one-a.jpg',
            },
            {
              id: 'album-artist-one-b',
              score: 90,
              media_type: 'album',
              title: 'Artist One Album B',
              'primary-type': 'Album',
              'first-release-date': '2026-04-01',
              'artist-credit': [
                {
                  name: 'Artist One',
                  artist: {
                    id: 'artist-one',
                    name: 'Artist One',
                    'sort-name': 'Artist One',
                  },
                },
              ],
              posterPath: 'https://cover.example/one-b.jpg',
            },
            {
              id: 'album-artist-one-c',
              score: 80,
              media_type: 'album',
              title: 'Artist One Album C',
              'primary-type': 'Album',
              'first-release-date': '2026-03-01',
              'artist-credit': [
                {
                  name: 'Artist One',
                  artist: {
                    id: 'artist-one',
                    name: 'Artist One',
                    'sort-name': 'Artist One',
                  },
                },
              ],
              posterPath: 'https://cover.example/one-c.jpg',
            },
            {
              id: 'album-artist-two',
              score: 1,
              media_type: 'album',
              title: 'Artist Two Album',
              'primary-type': 'Album',
              'first-release-date': '2025-01-01',
              'artist-credit': [
                {
                  name: 'Artist Two',
                  artist: {
                    id: 'artist-two',
                    name: 'Artist Two',
                    'sort-name': 'Artist Two',
                  },
                },
              ],
              posterPath: undefined,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?genre=jazz&sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results
        .slice(0, 3)
        .map((result: { title: string }) => result.title),
      ['Artist One Album A', 'Artist One Album B', 'Artist Two Album']
    );
  });

  it('ranks fresh music discovery results by listens, recency, and metadata', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Unknown Artist',
            artist_mbids: ['artist-obscure'],
            caa_id: 0,
            caa_release_mbid: '',
            listen_count: 1,
            release_date: '2026-05-01',
            release_group_mbid: 'album-obscure',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-obscure',
            release_name: 'Obscure Single',
            release_tags: [],
          },
          {
            artist_credit_name: 'Known Artist',
            artist_mbids: ['artist-known'],
            caa_id: 1,
            caa_release_mbid: 'release-known',
            listen_count: 100,
            release_date: '2026-04-25',
            release_group_mbid: 'album-known',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-known',
            release_name: 'Known Album',
            release_tags: [],
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get(
      '/discover/music?sortBy=ranked&releaseType=Album'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Known Album', 'Obscure Single']
    );
  });

  it('diversifies ranked fresh music discovery results by artist', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Artist One',
            artist_mbids: ['artist-one'],
            caa_id: 1,
            caa_release_mbid: 'release-artist-one-a',
            listen_count: 9000,
            release_date: '2026-05-01',
            release_group_mbid: 'album-artist-one-a',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-artist-one-a',
            release_name: 'Artist One Album A',
            release_tags: [],
          },
          {
            artist_credit_name: 'Artist One',
            artist_mbids: ['artist-one'],
            caa_id: 1,
            caa_release_mbid: 'release-artist-one-b',
            listen_count: 8000,
            release_date: '2026-04-01',
            release_group_mbid: 'album-artist-one-b',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-artist-one-b',
            release_name: 'Artist One Album B',
            release_tags: [],
          },
          {
            artist_credit_name: 'Artist One',
            artist_mbids: ['artist-one'],
            caa_id: 1,
            caa_release_mbid: 'release-artist-one-c',
            listen_count: 7000,
            release_date: '2026-03-01',
            release_group_mbid: 'album-artist-one-c',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-artist-one-c',
            release_name: 'Artist One Album C',
            release_tags: [],
          },
          {
            artist_credit_name: 'Artist Two',
            artist_mbids: ['artist-two'],
            caa_id: 1,
            caa_release_mbid: 'release-artist-two',
            listen_count: 1,
            release_date: '2026-02-01',
            release_group_mbid: 'album-artist-two',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-artist-two',
            release_name: 'Artist Two Album',
            release_tags: [],
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get(
      '/discover/music?sortBy=ranked&releaseType=Album'
    );

    assert.strictEqual(res.status, 200);
    const titles = res.body.results
      .slice(0, 3)
      .map((result: { title: string }) => result.title);

    assert.strictEqual(
      titles.filter((title: string) => title.startsWith('Artist One')).length,
      2
    );
    assert.ok(titles.includes('Artist Two Album'));
  });

  it('blends ListenBrainz charts and fresh releases for default ranked music discovery', async () => {
    const topAlbumsMock = mock.method(
      ListenBrainzAPI.prototype,
      'getTopAlbums',
      async () => ({
        payload: {
          count: 2,
          release_groups: [
            {
              artist_mbids: ['artist-charted'],
              artist_name: 'Charted Artist',
              caa_release_mbid: 'release-charted',
              listen_count: 5000,
              release_group_mbid: 'album-charted',
              release_group_name: 'Charted Album',
            },
          ],
        },
      })
    );
    const freshReleasesMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async () => ({
        payload: {
          releases: [
            {
              artist_credit_name: 'Fresh Artist',
              artist_mbids: ['artist-fresh'],
              caa_id: 1,
              caa_release_mbid: 'release-fresh',
              listen_count: 5,
              release_date: '2026-05-01',
              release_group_mbid: 'album-fresh',
              release_group_primary_type: 'Album',
              release_group_secondary_type: '',
              release_mbid: 'release-fresh',
              release_name: 'Fresh Album',
              release_tags: [],
            },
          ],
        },
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(topAlbumsMock.mock.callCount(), 1);
    assert.strictEqual(freshReleasesMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Charted Album', 'Fresh Album']
    );
  });

  it('accepts shuffle seeds for ranked music discovery', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 1,
        release_groups: [
          {
            artist_mbids: ['artist-charted'],
            artist_name: 'Charted Artist',
            caa_release_mbid: '',
            listen_count: 5000,
            release_group_mbid: 'album-charted',
            release_group_name: 'Charted Album',
          },
        ],
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: { releases: [] },
    }));

    const agent = await login();
    const res = await agent.get(
      '/discover/music?sortBy=ranked&shuffleSeed=refresh-a'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].title, 'Charted Album');
  });

  it('changes ranked music order for different shuffle seeds', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 5,
        release_groups: Array.from({ length: 5 }, (_, index) => ({
          artist_mbids: [`artist-${index}`],
          artist_name: `Artist ${index}`,
          caa_release_mbid: '',
          listen_count: 5000 - index,
          release_group_mbid: `album-${index}`,
          release_group_name: `Album ${index}`,
        })),
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: { releases: [] },
    }));

    const agent = await login();
    const firstSeed = await agent.get(
      '/discover/music?sortBy=ranked&shuffleSeed=refresh-a'
    );
    const secondSeed = await agent.get(
      '/discover/music?sortBy=ranked&shuffleSeed=refresh-b'
    );

    assert.strictEqual(firstSeed.status, 200);
    assert.strictEqual(secondSeed.status, 200);
    assert.notDeepStrictEqual(
      firstSeed.body.results.map((result: { title: string }) => result.title),
      secondSeed.body.results.map((result: { title: string }) => result.title)
    );
  });

  it('keeps richer metadata when ranked music sources return the same album', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 1,
        release_groups: [
          {
            artist_mbids: ['artist-duplicate'],
            artist_name: 'Duplicate Artist',
            caa_release_mbid: '',
            listen_count: 5000,
            release_group_mbid: 'album-duplicate',
            release_group_name: 'Duplicate Chart Album',
          },
        ],
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Duplicate Artist',
            artist_mbids: ['artist-duplicate'],
            caa_id: 1,
            caa_release_mbid: 'release-duplicate',
            listen_count: 25,
            release_date: '2026-05-01',
            release_group_mbid: 'album-duplicate',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-duplicate',
            release_name: 'Duplicate Fresh Album',
            release_tags: [],
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
    assert.strictEqual(res.body.results[0].title, 'Duplicate Chart Album');
    assert.strictEqual(res.body.results[0]['first-release-date'], '2026-05-01');
    assert.strictEqual(
      res.body.results[0].posterPath,
      'https://coverartarchive.org/release/release-duplicate/front-250'
    );
  });

  it('diversifies default ranked music discovery by artist', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 4,
        release_groups: [
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-a',
            listen_count: 9000,
            release_group_mbid: 'album-artist-one-a',
            release_group_name: 'Artist One Album A',
          },
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-b',
            listen_count: 8000,
            release_group_mbid: 'album-artist-one-b',
            release_group_name: 'Artist One Album B',
          },
          {
            artist_mbids: ['artist-one'],
            artist_name: 'Artist One',
            caa_release_mbid: 'release-artist-one-c',
            listen_count: 7000,
            release_group_mbid: 'album-artist-one-c',
            release_group_name: 'Artist One Album C',
          },
          {
            artist_mbids: ['artist-two'],
            artist_name: 'Artist Two',
            caa_release_mbid: 'release-artist-two',
            listen_count: 1,
            release_group_mbid: 'album-artist-two',
            release_group_name: 'Artist Two Album',
          },
        ],
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [],
      },
    }));

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results
        .slice(0, 3)
        .map((result: { title: string }) => result.title),
      ['Artist One Album A', 'Artist One Album B', 'Artist Two Album']
    );
  });

  it('uses fresh releases for ranked music discovery when charts are unavailable', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => {
      throw new Error('charts unavailable');
    });
    const freshReleasesMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async () => ({
        payload: {
          releases: [
            {
              artist_credit_name: 'Fresh Only Artist',
              artist_mbids: ['artist-fresh-only'],
              caa_id: 1,
              caa_release_mbid: 'release-fresh-only',
              listen_count: 25,
              release_date: '2026-05-01',
              release_group_mbid: 'album-fresh-only',
              release_group_primary_type: 'Album',
              release_group_secondary_type: '',
              release_mbid: 'release-fresh-only',
              release_name: 'Fresh Only Album',
              release_tags: [],
            },
          ],
        },
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleasesMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Fresh Only Album']
    );
  });

  it('uses chart albums for ranked music discovery when fresh releases are unavailable', async () => {
    const topAlbumsMock = mock.method(
      ListenBrainzAPI.prototype,
      'getTopAlbums',
      async () => ({
        payload: {
          count: 1,
          release_groups: [
            {
              artist_mbids: ['artist-chart-only'],
              artist_name: 'Chart Only Artist',
              caa_release_mbid: 'release-chart-only',
              listen_count: 5000,
              release_group_mbid: 'album-chart-only',
              release_group_name: 'Chart Only Album',
            },
          ],
        },
      })
    );
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => {
      throw new Error('fresh releases unavailable');
    });

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(topAlbumsMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Chart Only Album']
    );
  });

  it('falls back to MusicBrainz tags when ranked music sources are empty', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 0,
        release_groups: [],
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [],
      },
    }));
    const searchByTagMock = mock.method(
      MusicBrainz.prototype,
      'searchReleaseGroupsByTag',
      async ({ tags }: { tags: string[] }) => ({
        totalCount: 1,
        releaseGroups: [
          {
            id: `album-${tags[0]}`,
            score: 100,
            media_type: 'album',
            title: `${tags[0]} Album`,
            'primary-type': 'Album',
            'first-release-date': '2026-01-01',
            'artist-credit': [
              {
                name: `${tags[0]} Artist`,
                artist: {
                  id: `artist-${tags[0]}`,
                  name: `${tags[0]} Artist`,
                  'sort-name': `${tags[0]} Artist`,
                },
              },
            ],
            posterPath: `https://cover.example/${tags[0]}.jpg`,
          },
        ],
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchByTagMock.mock.callCount(), 4);
    assert.strictEqual(res.body.results.length, 4);
  });

  it('falls back to ranked music discovery when an unsupported sort is requested', async () => {
    const topAlbumsMock = mock.method(
      ListenBrainzAPI.prototype,
      'getTopAlbums',
      async () => {
        throw new Error('top albums should not be called for invalid sorts');
      }
    );
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Low Signal Artist',
            artist_mbids: ['artist-low-signal'],
            caa_id: 0,
            caa_release_mbid: '',
            listen_count: 1,
            release_date: '2026-05-01',
            release_group_mbid: 'album-low-signal',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-low-signal',
            release_name: 'Low Signal Single',
            release_tags: [],
          },
          {
            artist_credit_name: 'High Signal Artist',
            artist_mbids: ['artist-high-signal'],
            caa_id: 1,
            caa_release_mbid: 'release-high-signal',
            listen_count: 500,
            release_date: '2026-04-01',
            release_group_mbid: 'album-high-signal',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-high-signal',
            release_name: 'High Signal Album',
            release_tags: [],
          },
        ],
      },
    }));

    const agent = await login();
    const res = await agent.get(
      '/discover/music?sortBy=unsupported&releaseType=Album'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(topAlbumsMock.mock.callCount(), 0);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['High Signal Album', 'Low Signal Single']
    );
  });

  it('falls back to a seven day window when a wider ListenBrainz query fails', async () => {
    const freshReleaseMock = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async ({ days }: { days: number }) => {
        if (days > 7) {
          throw new Error('upstream failed');
        }

        return {
          payload: {
            releases: [
              {
                artist_credit_name: 'Fallback Artist',
                artist_mbids: ['artist-fallback'],
                caa_id: 1,
                caa_release_mbid: 'release-fallback',
                listen_count: 1,
                release_date: '2026-05-08',
                release_group_mbid: 'album-fallback',
                release_group_primary_type: 'Single',
                release_group_secondary_type: '',
                release_mbid: 'release-fallback',
                release_name: 'Fallback Album',
                release_tags: [],
              },
            ],
          },
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?days=90');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(freshReleaseMock.mock.callCount(), 2);
    assert.strictEqual(res.body.results[0].title, 'Fallback Album');
  });

  it('returns an empty result set when ListenBrainz is unavailable', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => {
      throw new Error('provider unavailable');
    });
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => {
      throw new Error('provider unavailable');
    });
    mock.method(MusicBrainz.prototype, 'searchReleaseGroupsByTag', async () => {
      throw new Error('fallback provider unavailable');
    });

    const agent = await login();
    const res = await agent.get('/discover/music?page=2');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 2);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('returns an empty result set when MusicBrainz search is unavailable', async () => {
    mock.method(MusicBrainz.prototype, 'searchAlbum', async () => {
      throw new Error('provider unavailable');
    });

    const agent = await login();
    const res = await agent.get('/discover/music?query=kind%20of%20blue');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('only exposes the current user watchlist state on music results', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: {
        releases: [
          {
            artist_credit_name: 'Watched By Someone Else',
            artist_mbids: ['artist-other-user'],
            caa_id: 1,
            caa_release_mbid: 'release-other-user',
            listen_count: 1,
            release_date: '2026-05-08',
            release_group_mbid: 'album-other-user',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: 'release-other-user',
            release_name: 'Other User Album',
            release_tags: [],
          },
        ],
      },
    }));

    const otherUser = await getRepository(User).save(
      new User({
        email: 'other-music-watchlist@example.com',
        username: 'other-music-watchlist',
        plexUsername: 'other-music-watchlist',
        userType: UserType.LOCAL,
        avatar: '',
      })
    );
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'album-other-user',
        mediaType: MediaType.MUSIC,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        mbId: 'album-other-user',
        mediaType: MediaType.MUSIC,
        title: 'Other User Album',
        requestedBy: otherUser,
        media,
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/music?releaseType=Album');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
  });
});

describe('GET /discover/books', () => {
  it('rejects oversized book discovery queries before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');

    const agent = await login();
    const res = await agent
      .get('/discover/books')
      .query({ query: 'x'.repeat(257) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchBooks.mock.callCount(), 0);
  });

  it('rejects oversized book discovery subjects before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');

    const agent = await login();
    const res = await agent
      .get('/discover/books')
      .query({ subject: 'x'.repeat(513) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(searchBooks.mock.callCount(), 0);
  });

  it('uses the selected subject when browsing without a search query', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({
        query,
        page,
        limit,
      }: {
        query: string;
        page?: number;
        limit?: number;
      }) => {
        assert.strictEqual(query, 'subject:science_fiction');
        assert.strictEqual(page, 2);
        assert.strictEqual(limit, 20);

        return {
          numFound: 0,
          start: 20,
          docs: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/books?subject=science_fiction&page=2'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('returns mapped Open Library book discovery results', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL1W',
          title: 'Alpha Book',
          author_name: ['Writer One'],
          author_key: ['OL1A'],
          first_publish_year: 2024,
          cover_i: 123,
          isbn: ['9780000000001'],
          edition_key: ['OL1M'],
        },
      ],
    }));

    const agent = await login();
    const res = await agent.get('/discover/books?query=alpha');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalResults, 1);
    assert.strictEqual(res.body.results[0].mediaType, 'book');
    assert.strictEqual(res.body.results[0].title, 'Alpha Book');
  });

  it('passes Open Library sort options through for book discovery', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ sort }: { sort?: string }) => {
        assert.strictEqual(sort, 'rating');

        return {
          numFound: 0,
          start: 0,
          docs: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=rating');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
  });

  it('falls back to ranked book discovery when an unsupported sort is requested', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query, sort }: { query: string; sort?: string }) => {
        assert.strictEqual(query, 'subject:fiction');
        assert.strictEqual(sort, undefined);

        return {
          numFound: 2,
          start: 0,
          docs: [
            {
              key: '/works/OL-low-signal',
              title: 'Low Signal Book',
              first_publish_year: 2026,
              edition_count: 1,
              ratings_average: 3,
              ratings_count: 1,
              want_to_read_count: 1,
            },
            {
              key: '/works/OL-high-signal',
              title: 'High Signal Book',
              author_name: ['Known Writer'],
              first_publish_year: 2024,
              cover_i: 123,
              edition_count: 50,
              ratings_average: 4.5,
              ratings_count: 100,
              want_to_read_count: 500,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/books?subject=fiction&sortBy=unsupported'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['High Signal Book', 'Low Signal Book']
    );
  });

  it('ranks book discovery results by quality signals by default', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 2,
      start: 0,
      docs: [
        {
          key: '/works/OL-obscure',
          title: 'Obscure Book',
          first_publish_year: 2026,
          edition_count: 1,
          ratings_average: 3,
          ratings_count: 1,
          want_to_read_count: 1,
        },
        {
          key: '/works/OL-known',
          title: 'Known Book',
          author_name: ['Known Writer'],
          first_publish_year: 2024,
          cover_i: 123,
          edition_count: 50,
          ratings_average: 4.5,
          ratings_count: 100,
          want_to_read_count: 500,
        },
      ],
    }));

    const agent = await login();
    const res = await agent.get('/discover/books');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Known Book', 'Obscure Book']
    );
  });

  it('blends multiple subjects for the default recommended book feed', async () => {
    const seenQueries: string[] = [];
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query }: { query: string; limit?: number }) => {
        seenQueries.push(query);

        return {
          numFound: 1,
          start: 0,
          docs: [
            {
              key: `/works/${query.replace(/[^a-z_]/g, '')}`,
              title: query,
              cover_i: 1,
              edition_count: 10,
              ratings_average: 4,
              ratings_count: 10,
              want_to_read_count: 10,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(seenQueries.length, 12);
    assert.strictEqual(new Set(seenQueries).size, 12);
    assert.strictEqual(
      seenQueries.every((query) => query.startsWith('subject:')),
      true
    );
    assert.strictEqual(res.body.results.length > 1, true);
  });

  it('accepts shuffle seeds for ranked book discovery', async () => {
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query }: { query: string }) => ({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: `/works/${query.replace(/[^a-z_]/g, '')}`,
            title: query,
            cover_i: 1,
            edition_count: 10,
            ratings_average: 4,
            ratings_count: 10,
            want_to_read_count: 10,
          },
        ],
      })
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/books?sortBy=ranked&shuffleSeed=refresh-a'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length > 0, true);
  });

  it('changes ranked book order for different shuffle seeds', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 5,
      start: 0,
      docs: Array.from({ length: 5 }, (_, index) => ({
        key: `/works/book-${index}`,
        title: `Book ${index}`,
        author_name: [`Author ${index}`],
        author_key: [`AUTHOR${index}`],
        cover_i: 1,
        edition_count: 100 - index,
        ratings_average: 4,
        ratings_count: 100,
        want_to_read_count: 100,
      })),
    }));

    const agent = await login();
    const firstSeed = await agent.get(
      '/discover/books?sortBy=ranked&subject=fiction&shuffleSeed=refresh-a'
    );
    const secondSeed = await agent.get(
      '/discover/books?sortBy=ranked&subject=fiction&shuffleSeed=refresh-b'
    );

    assert.strictEqual(firstSeed.status, 200);
    assert.strictEqual(secondSeed.status, 200);
    assert.notDeepStrictEqual(
      firstSeed.body.results.map((result: { title: string }) => result.title),
      secondSeed.body.results.map((result: { title: string }) => result.title)
    );
  });

  it('diversifies the default recommended book feed by author', async () => {
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query }: { query: string }) => ({
        numFound: 3,
        start: 0,
        docs: [
          {
            key: `/works/${query.replace(/[^a-z_]/g, '')}-author-one-a`,
            title: `${query} Author One A`,
            author_name: ['Author One'],
            author_key: ['OLAUTHOR1A'],
            cover_i: 1,
            edition_count: 100,
            ratings_average: 5,
            ratings_count: 1000,
            want_to_read_count: 1000,
          },
          {
            key: `/works/${query.replace(/[^a-z_]/g, '')}-author-one-b`,
            title: `${query} Author One B`,
            author_name: ['Author One'],
            author_key: ['OLAUTHOR1A'],
            cover_i: 1,
            edition_count: 90,
            ratings_average: 5,
            ratings_count: 900,
            want_to_read_count: 900,
          },
          {
            key: `/works/${query.replace(/[^a-z_]/g, '')}-author-one-c`,
            title: `${query} Author One C`,
            author_name: ['Author One'],
            author_key: ['OLAUTHOR1A'],
            cover_i: 1,
            edition_count: 80,
            ratings_average: 5,
            ratings_count: 800,
            want_to_read_count: 800,
          },
          {
            key: `/works/${query.replace(/[^a-z_]/g, '')}-author-two`,
            title: `${query} Author Two`,
            author_name: ['Author Two'],
            author_key: ['OLAUTHOR2A'],
            cover_i: 1,
            edition_count: 1,
            ratings_average: 3,
            ratings_count: 1,
            want_to_read_count: 1,
          },
        ],
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 20);
    assert.strictEqual(
      res.body.results
        .slice(0, 4)
        .filter((result: { author: string }) => result.author === 'Author One')
        .length,
      2
    );
    assert.strictEqual(
      res.body.results.some(
        (result: { author: string }) => result.author === 'Author Two'
      ),
      true
    );
  });

  it('uses available subjects for the default book feed when one subject fails', async () => {
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query }: { query: string }) => {
        if (query === 'subject:fiction') {
          throw new Error('subject unavailable');
        }

        return {
          numFound: 1,
          start: 0,
          docs: [
            {
              key: `/works/${query.replace(/[^a-z_]/g, '')}`,
              title: query,
              cover_i: 1,
              edition_count: 10,
              ratings_average: 4,
              ratings_count: 10,
              want_to_read_count: 10,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length > 1, true);
    assert.strictEqual(
      res.body.results.some(
        (result: { title: string }) => result.title === 'subject:fiction'
      ),
      false
    );
  });

  it('returns an empty result set when Open Library is unavailable', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => {
      throw new Error('provider unavailable');
    });

    const agent = await login();
    const res = await agent.get('/discover/books?page=3');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 3);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('only exposes the current user watchlist state on book results', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL2W',
          title: 'Other User Book',
          author_name: ['Writer Two'],
          author_key: ['OL2A'],
          first_publish_year: 2025,
          cover_i: 456,
          isbn: ['9780000000002'],
          edition_key: ['OL2M'],
        },
      ],
    }));

    const otherUser = await getRepository(User).save(
      new User({
        email: 'other-book-watchlist@example.com',
        username: 'other-book-watchlist',
        plexUsername: 'other-book-watchlist',
        userType: UserType.LOCAL,
        avatar: '',
      })
    );
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL2W',
        canonical: true,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        externalId: 'OL2W',
        mediaType: MediaType.BOOK,
        title: 'Other User Book',
        requestedBy: otherUser,
        media,
      })
    );

    const agent = await login();
    const res = await agent.get('/discover/books?query=other');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
  });
});

describe('GET /discover/watchlist', () => {
  it('includes local book and music watchlist items for Plex users', async () => {
    mock.method(PlexTvAPI.prototype, 'getWatchlist', async () => ({
      totalSize: 1,
      items: [
        {
          ratingKey: 'plex-movie-key',
          title: 'Plex Movie',
          type: 'movie',
          tmdbId: 123,
        },
      ],
    }));

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.plexToken = 'plex-token';
    await userRepository.save(admin);

    const musicMedia = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'profile-release-group',
        mediaType: MediaType.MUSIC,
      })
    );
    await getRepository(Watchlist).save([
      new Watchlist({
        tmdbId: 123,
        mediaType: MediaType.MOVIE,
        title: 'Local Movie',
        requestedBy: admin,
        media: await getRepository(Media).save(
          new Media({
            tmdbId: 123,
            mediaType: MediaType.MOVIE,
          })
        ),
      }),
      new Watchlist({
        mbId: 'profile-release-group',
        mediaType: MediaType.MUSIC,
        title: 'Profile Album',
        requestedBy: admin,
        media: musicMedia,
      }),
      new Watchlist({
        externalId: 'OLprofileW',
        mediaType: MediaType.BOOK,
        title: 'Profile Book',
        requestedBy: admin,
        media: await getRepository(Media).save(
          new Media({
            tmdbId: 0,
            mediaType: MediaType.BOOK,
          })
        ),
      }),
    ]);

    const agent = await login();
    const res = await agent.get('/discover/watchlist');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map(
        (item: {
          title: string;
          mediaType: string;
          mbId?: string;
          externalId?: string;
        }) => ({
          title: item.title,
          mediaType: item.mediaType,
          mbId: item.mbId,
          externalId: item.externalId,
        })
      ),
      [
        {
          title: 'Local Movie',
          mediaType: 'movie',
          mbId: null,
          externalId: null,
        },
        {
          title: 'Profile Album',
          mediaType: 'music',
          mbId: 'profile-release-group',
          externalId: null,
        },
        {
          title: 'Profile Book',
          mediaType: 'book',
          mbId: null,
          externalId: 'OLprofileW',
        },
      ]
    );
    assert.strictEqual(res.body.totalResults, 3);
  });

  it('ignores incomplete local book and music watchlist rows when paginating', async () => {
    mock.method(
      PlexTvAPI.prototype,
      'getWatchlist',
      async (options: unknown) => {
        const { offset } = options as { offset?: number };
        assert.strictEqual(offset, 0);

        return {
          totalSize: 1,
          items: [
            {
              ratingKey: 'plex-movie-key',
              title: 'Plex Movie',
              type: 'movie',
              tmdbId: 123,
            },
          ],
        };
      }
    );

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.plexToken = 'plex-token';
    await userRepository.save(admin);

    await getRepository(Watchlist).save([
      new Watchlist({
        mediaType: MediaType.MUSIC,
        title: 'Broken Album',
        requestedBy: admin,
      }),
      new Watchlist({
        mediaType: MediaType.BOOK,
        title: 'Broken Book',
        requestedBy: admin,
      }),
      new Watchlist({
        externalId: 'OLvalidW',
        mediaType: MediaType.BOOK,
        title: 'Valid Book',
        requestedBy: admin,
      }),
    ]);

    const agent = await login();
    const res = await agent.get('/discover/watchlist');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((item: { title: string }) => item.title),
      ['Valid Book', 'Plex Movie']
    );
    assert.strictEqual(res.body.totalResults, 2);
    assert.strictEqual(res.body.totalPages, 1);
  });
});
