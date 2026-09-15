import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import CoverArtArchive from '@server/api/coverartarchive';
import ExternalAPI from '@server/api/externalapi';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import PlexTvAPI from '@server/api/plextv';
import RadarrAPI from '@server/api/servarr/radarr';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { MediaSearchMetadata } from '@server/entity/MediaSearchMetadata';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings, type RadarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import { settlePromisesWithin } from '@server/utils/concurrency';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import discoverRoutes, {
  EXTERNAL_DISCOVER_RATE_LIMIT,
  GENRE_SLIDER_CONCURRENCY,
  MAX_GENRE_SLIDER_ITEMS,
} from './discover';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      cookie: { secure: 'auto' },
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
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

const createRadarrSettings = (id: number, is4k: boolean): RadarrSettings => ({
  id,
  name: is4k ? 'Radarr-4K' : 'Radarr-HD',
  hostname: 'radarr.test',
  port: is4k ? 7879 : 7878,
  apiKey: 'radarr-key',
  useSsl: false,
  baseUrl: '',
  activeProfileId: 1,
  activeProfileName: is4k ? 'Ultra-HD 4K' : 'HD-1080p',
  activeDirectory: is4k ? '/movies/4k' : '/movies/hd',
  tags: [],
  is4k,
  isDefault: true,
  externalUrl: '',
  syncEnabled: true,
  preventSearch: false,
  tagRequests: false,
  overrideRule: [],
  minimumAvailability: 'released',
});

describe('genre slider provider bounds', () => {
  it('bounds external music and book discovery fan-out', () => {
    assert.deepStrictEqual(EXTERNAL_DISCOVER_RATE_LIMIT, {
      windowMs: 60_000,
      limit: 30,
    });
  });

  it('caps upstream cardinality and outbound hydration concurrency', async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    mock.method(
      TheMovieDb.prototype,
      'getMovieGenres',
      async function (this: TheMovieDb) {
        this.getDiscoverMovies = async () => {
          calls += 1;
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => setImmediate(resolve));
          active -= 1;
          return { page: 1, total_pages: 1, total_results: 0, results: [] };
        };

        return Array.from({ length: MAX_GENRE_SLIDER_ITEMS + 10 }, (_, id) => ({
          id: id + 1,
          name: `Genre ${id + 1}`,
        }));
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/genreslider/movie');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, MAX_GENRE_SLIDER_ITEMS);
    assert.strictEqual(calls, MAX_GENRE_SLIDER_ITEMS);
    assert.ok(peak <= GENRE_SLIDER_CONCURRENCY);
  });
});

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

async function login(email = 'admin@seerr.dev') {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('GET /discover/movies', () => {
  it('discovers locally available movies without contacting TMDB', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 456789,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 1,
        externalServiceId: 77,
      })
    );
    const metadataRepository = getRepository(MediaSearchMetadata);
    await metadataRepository.save(
      metadataRepository.create({
        mediaId: media.id,
        title: 'Local HD Movie',
        releaseDate: '2025',
        genres: 'Adventure',
        runtime: '105 minutes',
        searchText: 'local hd movie adventure',
      })
    );
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB must not be called for local availability');
    });

    const agent = await login();
    const res = await agent.get('/discover/movies?availability=hd');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalResults, 1);
    assert.strictEqual(res.body.results[0].id, 456789);
    assert.strictEqual(res.body.results[0].title, 'Local HD Movie');
    assert.match(res.body.results[0].posterPath, /\/movie\/456789\/cover/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('uses current Radarr file state and metadata for quality availability', async (t) => {
    const settings = getSettings();
    const priorRadarr = settings.radarr;
    settings.radarr = [createRadarrSettings(41, true)];
    await getRepository(Media).save([
      new Media({
        tmdbId: 710001,
        mediaType: MediaType.MOVIE,
        status4k: MediaStatus.AVAILABLE,
      }),
      new Media({
        tmdbId: 710002,
        mediaType: MediaType.MOVIE,
        status4k: MediaStatus.UNKNOWN,
      }),
    ]);
    const liveMovies = [
      {
        id: 81,
        title: 'Monitored Without File',
        originalTitle: 'Monitored Without File',
        year: 2025,
        overview: '',
        studio: '',
        runtime: 90,
        certification: '',
        genres: [],
        ratings: { votes: 0, value: 0 },
        isAvailable: false,
        monitored: true,
        tmdbId: 710001,
        imdbId: '',
        titleSlug: 'monitored-without-file',
        folderName: 'Monitored Without File',
        path: '/movies/4k/Monitored Without File',
        profileId: 1,
        qualityProfileId: 1,
        added: '2026-01-01',
        hasFile: false,
        tags: [],
      },
      {
        id: 82,
        title: 'Current 4K File',
        originalTitle: 'Current 4K File',
        year: 2026,
        overview: 'Available from Radarr.',
        studio: 'Test Studio',
        runtime: 101,
        certification: '',
        genres: ['Adventure'],
        ratings: { votes: 12, value: 7.5 },
        isAvailable: true,
        monitored: true,
        tmdbId: 710002,
        imdbId: 'tt710002',
        titleSlug: 'current-4k-file',
        folderName: 'Current 4K File',
        path: '/movies/4k/Current 4K File',
        profileId: 1,
        qualityProfileId: 1,
        added: '2026-01-02',
        hasFile: true,
        tags: [],
      },
    ];
    Object.defineProperty(RadarrAPI.prototype, 'getMovies', {
      configurable: true,
      get: () => async () => liveMovies,
      set: () => undefined,
    });
    t.after(() => {
      delete (RadarrAPI.prototype as Partial<RadarrAPI>).getMovies;
    });
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB must not be called for Radarr availability');
    });

    try {
      const agent = await login();
      const res = await agent.get('/discover/movies?availability=4k');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.totalResults, 1);
      assert.strictEqual(res.body.results[0].id, 710002);
      assert.strictEqual(res.body.results[0].title, 'Current 4K File');
      assert.match(
        res.body.results[0].posterPath,
        /serviceId=41&externalServiceId=82&is4k=true/
      );
      assert.strictEqual(
        res.body.results[0].mediaInfo.status4k,
        MediaStatus.AVAILABLE
      );
      assert.strictEqual(
        (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
        0
      );
    } finally {
      settings.radarr = priorRadarr;
    }
  });

  it('falls back to indexed movie availability when Radarr is unavailable', async (t) => {
    const settings = getSettings();
    const priorRadarr = settings.radarr;
    settings.radarr = [createRadarrSettings(42, false)];
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 710003,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const metadataRepository = getRepository(MediaSearchMetadata);
    await metadataRepository.save(
      metadataRepository.create({
        mediaId: media.id,
        title: 'Indexed HD Movie',
        releaseDate: '2026',
        genres: 'Adventure',
        runtime: '99 minutes',
        searchText: 'indexed hd movie adventure',
      })
    );
    Object.defineProperty(RadarrAPI.prototype, 'getMovies', {
      configurable: true,
      get: () => async () => {
        throw new Error('Radarr is unavailable');
      },
      set: () => undefined,
    });
    t.after(() => {
      delete (RadarrAPI.prototype as Partial<RadarrAPI>).getMovies;
    });

    try {
      const agent = await login();
      const res = await agent.get('/discover/movies?availability=hd');

      assert.strictEqual(res.status, 200);
      assert.ok(
        res.body.results.some(
          (result: { id: number; title: string }) =>
            result.id === 710003 && result.title === 'Indexed HD Movie'
        )
      );
    } finally {
      settings.radarr = priorRadarr;
    }
  });

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
    const impossibleDateRes = await agent.get(
      '/discover/movies?primaryReleaseDateGte=2026-02-30'
    );

    assert.strictEqual(arrayRes.status, 400);
    assert.match(arrayRes.body.message, /Invalid discovery query/);
    assert.strictEqual(dateRes.status, 400);
    assert.match(dateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(impossibleDateRes.status, 400);
    assert.match(impossibleDateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(
      (tmdbGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('uses TMDB movie search when a movie keyword search is supplied', async () => {
    mockPrivate(
      ExternalAPI.prototype,
      'get',
      async (endpoint: unknown, options: unknown) => {
        const requestOptions = options as {
          params?: { query?: string; page?: number };
        };
        assert.strictEqual(endpoint, '/search/movie');
        assert.strictEqual(requestOptions.params?.query, 'star trek');
        assert.strictEqual(requestOptions.params?.page, 1);

        return {
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 11,
              media_type: 'movie',
              title: 'Star Trek',
              original_title: 'Star Trek',
              release_date: '2009-05-08',
              adult: false,
              video: false,
              popularity: 50,
              poster_path: '/star-trek.jpg',
              backdrop_path: '/star-trek-backdrop.jpg',
              vote_count: 1000,
              vote_average: 7.4,
              genre_ids: [878],
              overview: '',
              original_language: 'en',
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/movies?search=star%20trek');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalResults, 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Star Trek']
    );
  });

  it('drops broad movie search results that do not contain every keyword', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/search/movie');

      const movie = {
        media_type: 'movie',
        release_date: '2026-01-01',
        adult: false,
        video: false,
        popularity: 20,
        poster_path: undefined,
        backdrop_path: undefined,
        vote_count: 100,
        vote_average: 7,
        genre_ids: [],
        overview: '',
        original_language: 'en',
      };

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            ...movie,
            id: 21,
            title: 'Star Trek',
            original_title: 'Star Trek',
          },
          {
            ...movie,
            id: 22,
            title: 'Star Warriors',
            original_title: 'Star Warriors',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/movies?search=star%20trek');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Star Trek']
    );
  });

  it('forwards a linked production country to TMDB movie discovery', async () => {
    mockPrivate(
      ExternalAPI.prototype,
      'get',
      async (endpoint: unknown, options: unknown) => {
        const requestOptions = options as {
          params?: { with_origin_country?: string };
        };
        assert.strictEqual(endpoint, '/discover/movie');
        assert.strictEqual(requestOptions.params?.with_origin_country, 'US');

        return {
          page: 1,
          total_pages: 1,
          total_results: 0,
          results: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/movies?country=US');

    assert.strictEqual(res.status, 200);
  });

  it('rejects malformed or excessive keyword fan-out before provider lookup', async () => {
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB should not be called for invalid keyword filters');
    });

    const agent = await login();
    const malformed = await agent
      .get('/discover/movies')
      .query({ keywords: '1,not-an-id' });
    const excessive = await agent.get('/discover/movies').query({
      keywords: Array.from({ length: 21 }, (_, index) => index + 1).join(','),
    });

    assert.strictEqual(malformed.status, 400);
    assert.match(malformed.body.message, /positive integer ids/);
    assert.strictEqual(excessive.status, 400);
    assert.match(excessive.body.message, /limited to 20 ids/);
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
    const repeatedFirstSeed = await agent.get(
      '/discover/movies?shuffleSeed=refresh-a'
    );

    assert.strictEqual(firstSeed.status, 200);
    assert.strictEqual(secondSeed.status, 200);
    assert.strictEqual(repeatedFirstSeed.status, 200);
    assert.deepStrictEqual(
      firstSeed.body.results.map((result: { title: string }) => result.title),
      repeatedFirstSeed.body.results.map(
        (result: { title: string }) => result.title
      )
    );
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

  it('discovers locally available 4K series without depending on TMDB page order', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 987654,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.PARTIALLY_AVAILABLE,
      })
    );
    const metadataRepository = getRepository(MediaSearchMetadata);
    await metadataRepository.save(
      metadataRepository.create({
        mediaId: media.id,
        title: 'Local 4K Series',
        alternateTitle: 'Local 4K Series',
        releaseDate: '2026-01-01',
        genres: 'Drama',
        runtime: '48 minutes',
        searchText: 'local 4k series drama',
      })
    );
    const tmdbGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('TMDB must not be called for local availability');
    });

    try {
      const agent = await login();
      const res = await agent.get('/discover/tv?availability=4k');

      assert.strictEqual(res.status, 200);
      assert.ok(
        res.body.results.some(
          (result: { id: number; name: string }) =>
            result.id === 987654 && result.name === 'Local 4K Series'
        )
      );
      assert.ok(
        (tmdbGet as { mock: { callCount: () => number } }).mock.callCount() ===
          0
      );
    } finally {
      await getRepository(Media).remove(media);
    }
  });

  it('forwards a linked production country to TMDB series discovery', async () => {
    mockPrivate(
      ExternalAPI.prototype,
      'get',
      async (endpoint: unknown, options: unknown) => {
        const requestOptions = options as {
          params?: { with_origin_country?: string };
        };
        assert.strictEqual(endpoint, '/discover/tv');
        assert.strictEqual(requestOptions.params?.with_origin_country, 'CA');

        return {
          page: 1,
          total_pages: 1,
          total_results: 0,
          results: [],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/tv?country=CA');

    assert.strictEqual(res.status, 200);
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
    const impossibleDateRes = await agent.get(
      '/discover/tv?firstAirDateLte=2026-13-01'
    );
    const networkRes = await agent.get('/discover/tv?network=0x10');

    assert.strictEqual(languageRes.status, 400);
    assert.match(languageRes.body.message, /Invalid discovery query/);
    assert.strictEqual(dateRes.status, 400);
    assert.match(dateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(impossibleDateRes.status, 400);
    assert.match(impossibleDateRes.body.message, /Invalid discovery query/);
    assert.strictEqual(networkRes.status, 400);
    assert.match(networkRes.body.message, /positive decimal identifier/);
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

  it('searches series when the root series discovery query includes search text', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/search/tv');

      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [
          {
            id: 2,
            media_type: 'tv',
            name: 'Search Result Series',
            original_name: 'Search Result Series',
            origin_country: ['US'],
            first_air_date: '2026-01-01',
            popularity: 20,
            poster_path: '/search-series.jpg',
            backdrop_path: '/search-series-backdrop.jpg',
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
    const res = await agent
      .get('/discover/tv')
      .query({ search: 'search result' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].name, 'Search Result Series');
  });

  it('drops broad series search results that do not contain every keyword', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/search/tv');

      const series = {
        media_type: 'tv',
        origin_country: ['US'],
        first_air_date: '2026-01-01',
        popularity: 20,
        poster_path: undefined,
        backdrop_path: undefined,
        vote_count: 100,
        vote_average: 7,
        genre_ids: [],
        overview: '',
        original_language: 'en',
      };

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            ...series,
            id: 31,
            name: 'Star Trek',
            original_name: 'Star Trek',
          },
          {
            ...series,
            id: 32,
            name: 'Star Stories',
            original_name: 'Star Stories',
          },
        ],
      };
    });

    const agent = await login();
    const res = await agent.get('/discover/tv?search=star%20trek');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { name: string }) => result.name),
      ['Star Trek']
    );
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
  it('uses the scanned local catalog for music availability filters', async () => {
    const settings = getSettings();
    const previousLidarr = settings.lidarr;
    settings.lidarr = [
      {
        id: 0,
        name: 'Lidarr MP3',
        activeProfileName: 'MP3',
      } as (typeof settings.lidarr)[number],
      {
        id: 1,
        name: 'Lidarr FLAC',
        activeProfileName: 'FLAC',
      } as (typeof settings.lidarr)[number],
    ];

    const searchAlbum = mock.method(MusicBrainz.prototype, 'searchAlbum');
    const getTopAlbums = mock.method(ListenBrainzAPI.prototype, 'getTopAlbums');
    const getFreshReleases = mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases'
    );

    try {
      const mediaRepository = getRepository(Media);
      const [mp3Album, flacAlbum] = await mediaRepository.save([
        new Media({
          tmdbId: 0,
          mbId: '11111111-1111-4111-8111-111111111111',
          mediaType: MediaType.MUSIC,
          status: MediaStatus.AVAILABLE,
          serviceId: 0,
          availableMusicServiceIds: [0],
        }),
        new Media({
          tmdbId: 0,
          mbId: '22222222-2222-4222-8222-222222222222',
          mediaType: MediaType.MUSIC,
          status: MediaStatus.AVAILABLE,
          serviceId: 1,
          availableMusicServiceIds: [1],
        }),
      ]);
      const metadataRepository = getRepository(MediaSearchMetadata);
      await metadataRepository.save([
        metadataRepository.create({
          mediaId: mp3Album.id,
          title: 'Fast MP3 Album',
          artist: 'Local Artist',
          releaseDate: '2025-06-07',
          genres: 'Rock, Alternative',
          albumType: 'Album',
          searchText: 'fast mp3 album local artist rock alternative',
        }),
        metadataRepository.create({
          mediaId: flacAlbum.id,
          title: 'FLAC Only Album',
          artist: 'Other Artist',
          releaseDate: '2024-01-02',
          genres: 'Pop',
          albumType: 'Album',
          searchText: 'flac only album other artist pop',
        }),
      ]);

      const agent = await login();
      const res = await agent
        .get('/discover/music')
        .query({ availability: 'mp3' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.totalResults, 1);
      assert.strictEqual(res.body.results[0].title, 'Fast MP3 Album');
      assert.strictEqual(
        res.body.results[0]['artist-credit'][0].name,
        'Local Artist'
      );
      assert.deepStrictEqual(res.body.results[0].availableQualities, ['MP3']);
      assert.strictEqual(searchAlbum.mock.callCount(), 0);
      assert.strictEqual(getTopAlbums.mock.callCount(), 0);
      assert.strictEqual(getFreshReleases.mock.callCount(), 0);
    } finally {
      settings.lidarr = previousLidarr;
    }
  });

  for (const sortBy of ['popular.week', 'release_date.desc']) {
    it(`reuses detail cover URLs for ${sortBy} without additional artwork lookups`, async () => {
      const releaseMbid = '55f7c1d9-b4f4-4c8d-a578-7d98687c4e45';
      const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
      const archive = new CoverArtArchive();
      Object.defineProperty(archive, 'fetchReleaseGroupMetadata', {
        value: async () => ({
          release: `/release/${releaseMbid}`,
          images: [{ id: 123, front: true, approved: true }],
        }),
      });
      const detailArtwork = await archive.getCoverArt(albumId);
      const getCoverArt = mock.method(
        CoverArtArchive.prototype,
        'getCoverArt',
        async () => {
          throw new Error('Discovery must not look up additional artwork');
        }
      );
      const cases = [
        {
          imageId: 123,
          releaseMbid,
          expected: `https://archive.org/download/mbid-${releaseMbid}/mbid-${releaseMbid}-123_thumb250.jpg`,
        },
        ...[undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(
          (imageId) => ({
            imageId,
            releaseMbid,
            expected: `https://coverartarchive.org/release/${releaseMbid}/front-250`,
          })
        ),
        {
          imageId: 123,
          releaseMbid: 'release-not-a-uuid',
          expected:
            'https://coverartarchive.org/release/release-not-a-uuid/front-250',
        },
        { imageId: 123, releaseMbid: '', expected: undefined },
      ];
      const albums = cases.map((entry, index) => ({
        artist_mbids: [`artist-cover-${index}`],
        artist_name: `Cover Artist ${index}`,
        caa_id: entry.imageId as number,
        caa_release_mbid: entry.releaseMbid,
        listen_count: 100 - index,
        release_group_mbid: index === 0 ? albumId : `album-cover-${index}`,
        release_group_name: `Cover Album ${index}`,
      }));
      mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
        payload: {
          count: albums.length,
          from_ts: 0,
          last_updated: 0,
          offset: 0,
          range: 'week',
          release_groups: albums,
          to_ts: 0,
        },
      }));
      mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
        payload: {
          releases: albums.map((album) => ({
            ...album,
            artist_credit_name: album.artist_name,
            release_date: '2026-05-01',
            release_group_primary_type: 'Album',
            release_group_secondary_type: '',
            release_mbid: album.caa_release_mbid,
            release_name: album.release_group_name,
            release_tags: [],
          })),
        },
      }));

      const agent = await login();
      const res = await agent.get('/discover/music').query({ sortBy });

      assert.equal(res.status, 200);
      assert.equal(res.body.results.length, cases.length);
      for (const [index, entry] of cases.entries()) {
        const album = res.body.results.find(
          (result: { title: string }) => result.title === `Cover Album ${index}`
        );
        assert.equal(album?.posterPath, entry.expected);
      }
      assert.equal(
        res.body.results.find((result: { id: string }) => result.id === albumId)
          ?.posterPath,
        detailArtwork.images[0]?.thumbnails[250]
      );
      assert.equal(getCoverArt.mock.callCount(), 0);
    });
  }

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

  it('rejects impossible music release dates before provider lookup', async () => {
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
      primaryReleaseDateGte: '2026-02-30',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /valid YYYY-MM-DD date/);
    assert.strictEqual(searchReleaseGroupsByTag.mock.callCount(), 0);
    assert.strictEqual(getFreshReleases.mock.callCount(), 0);
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
        assert.strictEqual(query, 'kind AND of AND blue');
        assert.strictEqual(limit, 100);
        assert.strictEqual(offset, 0);

        const fillerAlbum = {
          id: 'musicbrainz-release-group-filler',
          score: 10,
          media_type: 'album',
          title: 'Kind of Blue Filler',
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

  it('drops broad music results that do not contain every keyword', async () => {
    mock.method(
      MusicBrainz.prototype,
      'searchAlbum',
      async ({ query }: { query: string }) => {
        assert.strictEqual(query, 'microsoft AND windows');

        const album = {
          score: 100,
          media_type: 'album',
          'primary-type': 'Album',
          'primary-type-id': '',
          'type-id': '',
          'first-release-date': '2026',
          posterPath: undefined,
          count: 1,
          releases: [],
          releasedate: '2026',
          tags: [],
        };

        return [
          {
            ...album,
            id: 'relevant-album',
            title: 'Microsoft Windows Sounds',
            'artist-credit': [
              {
                name: 'System Artist',
                artist: {
                  id: 'system-artist',
                  name: 'System Artist',
                  'sort-name': 'System Artist',
                },
              },
            ],
          },
          {
            ...album,
            id: 'broad-album',
            title: 'Windows at Night',
            'artist-credit': [
              {
                name: 'Novel Band',
                artist: {
                  id: 'novel-band',
                  name: 'Novel Band',
                  'sort-name': 'Novel Band',
                },
              },
            ],
          },
        ];
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?query=microsoft%20windows');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Microsoft Windows Sounds']
    );
  });

  it('exposes every scanned Lidarr quality for discovery filtering', async () => {
    const settings = getSettings();
    const previousLidarr = settings.lidarr;
    settings.lidarr = [
      {
        id: 0,
        name: 'Lidarr MP3',
        activeProfileName: 'MP3',
      } as (typeof settings.lidarr)[number],
      {
        id: 2,
        name: 'Lidarr FLAC',
        activeProfileName: 'FLAC',
      } as (typeof settings.lidarr)[number],
    ];

    try {
      await getRepository(Media).save(
        new Media({
          tmdbId: 0,
          mbId: 'quality-available-album',
          mediaType: MediaType.MUSIC,
          status: MediaStatus.AVAILABLE,
          serviceId: 2,
          availableMusicServiceIds: [0, 2],
        })
      );
      mock.method(MusicBrainz.prototype, 'searchAlbum', async () => [
        {
          id: 'quality-available-album',
          title: 'Quality Available Album',
          score: 100,
          media_type: 'album',
          'primary-type': 'Album',
          'primary-type-id': '',
          'type-id': '',
          'first-release-date': '2026',
          posterPath: undefined,
          count: 1,
          releases: [],
          releasedate: '2026',
          tags: [],
          'artist-credit': [
            {
              name: 'Quality Artist',
              artist: {
                id: 'quality-artist',
                name: 'Quality Artist',
                'sort-name': 'Quality Artist',
              },
            },
          ],
        },
      ]);

      const agent = await login();
      const res = await agent.get('/discover/music?query=quality%20available');

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.results[0].availableQualities, [
        'MP3',
        'FLAC',
      ]);
    } finally {
      settings.lidarr = previousLidarr;
    }
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

  it('applies release type, genre, and year filters to music searches', async () => {
    mock.method(MusicBrainz.prototype, 'searchAlbum', async () => [
      {
        id: 'matching-album',
        score: 100,
        media_type: 'album',
        title: 'Matching Album',
        'primary-type': 'Album',
        'primary-type-id': '',
        'type-id': '',
        'first-release-date': '2024-06-01',
        'artist-credit': [],
        posterPath: undefined,
        count: 1,
        releases: [],
        releasedate: '2024-06-01',
        tags: [
          { count: 5, name: 'jazz' },
          { count: 4, name: 'blue' },
        ],
      },
      {
        id: 'wrong-year-album',
        score: 90,
        media_type: 'album',
        title: 'Wrong Year Album',
        'primary-type': 'Album',
        'primary-type-id': '',
        'type-id': '',
        'first-release-date': '2023-06-01',
        'artist-credit': [],
        posterPath: undefined,
        count: 1,
        releases: [],
        releasedate: '2023-06-01',
        tags: [{ count: 5, name: 'jazz' }],
      },
    ]);

    const agent = await login();
    const res = await agent.get('/discover/music').query({
      query: 'blue',
      genre: 'jazz',
      releaseType: 'Album',
      primaryReleaseDateGte: '2024-01-01',
      primaryReleaseDateLte: '2024-12-31',
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Matching Album']
    );
  });

  it('returns all-time ListenBrainz top albums for most-listened music discovery', async () => {
    const topAlbumsMock = mock.method(
      ListenBrainzAPI.prototype,
      'getTopAlbums',
      async ({ range }: { range: string }) => {
        assert.strictEqual(range, 'all_time');

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
                artist_mbids: ['artist-most-listened'],
                artist_name: 'Most Listened Artist',
                caa_id: 1,
                caa_release_mbid: 'release-most-listened',
                listen_count: 900,
                release_group_mbid: 'album-most-listened',
                release_group_name: 'Most Listened Album',
              },
              {
                artist_mbids: ['artist-second'],
                artist_name: 'Second Artist',
                caa_id: 2,
                caa_release_mbid: 'release-second',
                listen_count: 800,
                release_group_mbid: 'album-second',
                release_group_name: 'Second Album',
              },
            ],
          },
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=listen_count.desc');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(topAlbumsMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Most Listened Album', 'Second Album']
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

  it('keeps ranked music results when another source stalls', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 1,
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
    }));
    mock.method(
      ListenBrainzAPI.prototype,
      'getFreshReleases',
      async () => new Promise(() => {})
    );

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Charted Album']
    );
  });

  it('skips ListenBrainz chart albums without release group ids', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getTopAlbums', async () => ({
      payload: {
        count: 2,
        release_groups: [
          {
            artist_mbids: ['artist-missing'],
            artist_name: 'Missing Id Artist',
            caa_release_mbid: 'release-missing',
            listen_count: 6000,
            release_group_mbid: null as unknown as string,
            release_group_name: 'Missing Id Album',
          },
          {
            artist_mbids: ['artist-valid'],
            artist_name: 'Valid Artist',
            caa_release_mbid: 'release-valid',
            listen_count: 5000,
            release_group_mbid: 'album-valid',
            release_group_name: 'Valid Album',
          },
        ],
      },
    }));
    mock.method(ListenBrainzAPI.prototype, 'getFreshReleases', async () => ({
      payload: { releases: [] },
    }));

    const agent = await login();
    const res = await agent.get('/discover/music?sortBy=ranked');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Valid Album']
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
        serviceUrl: 'http://lidarr.internal/album/1',
        externalServiceSlug: 'other-user-album',
        ratingKey: 'plex-music-key',
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
    await getRepository(MediaRequest).save([
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy: otherUser,
        status: MediaRequestStatus.FAILED,
        is4k: false,
      }),
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy: otherUser,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      }),
    ]);

    const agent = await login('friend@seerr.dev');
    const res = await agent.get('/discover/music?releaseType=Album');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
    assert.strictEqual(res.body.results[0].mediaInfo.serviceUrl, undefined);
    assert.strictEqual(
      res.body.results[0].mediaInfo.externalServiceSlug,
      undefined
    );
    assert.strictEqual(res.body.results[0].mediaInfo.ratingKey, undefined);
    assert.deepStrictEqual(
      res.body.results[0].mediaInfo.requests.map(
        (mediaRequest: { status: number; requestedBy?: unknown }) => ({
          status: mediaRequest.status,
          requestedBy: mediaRequest.requestedBy,
        })
      ),
      [{ status: MediaRequestStatus.PENDING, requestedBy: undefined }]
    );
  });
});

describe('GET /discover/books', () => {
  it('keeps completed book subject results when another subject stalls', async () => {
    const result = await settlePromisesWithin(
      [
        Promise.resolve({ numFound: 1, start: 0, docs: [] }),
        new Promise(() => {}),
      ],
      5
    );

    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0]?.status, 'fulfilled');
  });

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

  it('rejects unsupported book formats before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');

    const agent = await login();
    const res = await agent.get('/discover/books').query({ format: 'print' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Format must be valid/);
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
        assert.strictEqual(limit, 50);

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
          numFound: 1,
          start: 0,
          docs: [
            {
              key: '/works/OL-rating-sort',
              title: 'Rating Sort Book',
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=rating');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
  });

  it('combines book filters and applies the selected minimum rating', async () => {
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
        assert.strictEqual(
          query,
          '(title:"alpha" OR author:"alpha") AND (title:"beta" OR author:"beta") AND subject:science_fiction AND language:eng AND first_publish_year:2024'
        );
        assert.strictEqual(page, 1);
        assert.strictEqual(limit, 50);

        return {
          numFound: 2,
          start: 0,
          docs: [
            {
              key: '/works/OL-low-rating',
              title: 'Low Rating',
              author_name: ['Alpha Beta Writer'],
              ratings_average: 3.5,
            },
            {
              key: '/works/OL-high-rating',
              title: 'High Rating',
              author_name: ['Alpha Beta Writer'],
              ratings_average: 4.5,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books').query({
      query: 'alpha beta',
      subject: 'science_fiction',
      firstPublishYear: '2024',
      language: 'eng',
      minRating: '4.0',
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['High Rating']
    );
  });

  it('supports ascending book rating order within the provider result window', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ sort }: { sort?: string }) => {
        assert.strictEqual(sort, 'rating');

        return {
          numFound: 2,
          start: 0,
          docs: [
            {
              key: '/works/OL-high-rating',
              title: 'High Rating',
              ratings_average: 4.5,
            },
            {
              key: '/works/OL-low-rating',
              title: 'Low Rating',
              ratings_average: 2.5,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=rating.asc');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Low Rating', 'High Rating']
    );
  });

  it('supports ascending recommended book order', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ sort }: { sort?: string }) => {
        assert.strictEqual(sort, 'random');

        return {
          numFound: 2,
          start: 0,
          docs: [
            {
              key: '/works/OL-high-signal',
              title: 'High Signal',
              ratings_average: 4.8,
              ratings_count: 10000,
              edition_count: 100,
            },
            {
              key: '/works/OL-low-signal',
              title: 'Low Signal',
              ratings_average: 1,
              ratings_count: 1,
              edition_count: 1,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=ranked.asc');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Low Signal', 'High Signal']
    );
  });

  it('supports ascending book edition order within the provider result window', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ sort }: { sort?: string }) => {
        assert.strictEqual(sort, 'editions');

        return {
          numFound: 2,
          start: 0,
          docs: [
            {
              key: '/works/OL-many-editions',
              title: 'Many Editions',
              edition_count: 100,
            },
            {
              key: '/works/OL-few-editions',
              title: 'Few Editions',
              edition_count: 1,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=editions.asc');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Few Editions', 'Many Editions']
    );
  });

  it('keeps relevant book search order and drops hidden metadata-only matches', async () => {
    const searchBooksMock = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query, limit }: { query: string; limit?: number }) => {
        assert.strictEqual(
          query,
          '(title:"microsoft" OR author:"microsoft") AND (title:"windows" OR author:"windows") AND (title:"11" OR author:"11")'
        );
        assert.strictEqual(limit, 50);

        return {
          numFound: 3,
          start: 0,
          docs: [
            {
              key: '/works/OL-windows-guide',
              title: 'Windows 11 Guide',
              subject: ['Microsoft Windows'],
              ratings_count: 1,
            },
            {
              key: '/works/OL-publisher-only-novel',
              title: 'A Completely Unrelated Novel',
              publisher: ['Microsoft Press'],
              ratings_average: 5,
              ratings_count: 10000,
            },
            {
              key: '/works/OL-microsoft-reference',
              title: 'The Microsoft Windows 11 Reference',
              ratings_average: 5,
              ratings_count: 1000,
            },
          ],
        };
      }
    );

    const agent = await login();
    const res = await agent.get(
      '/discover/books?query=microsoft%20windows%2011'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(searchBooksMock.mock.callCount(), 1);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['The Microsoft Windows 11 Reference']
    );
  });

  it('rejects malformed book filter values before provider lookup', async () => {
    const searchBooks = mock.method(OpenLibraryAPI.prototype, 'searchBooks');
    const agent = await login();

    const invalidYear = await agent.get(
      '/discover/books?firstPublishYear=twenty'
    );
    const invalidLanguage = await agent.get('/discover/books?language=en');
    const invalidRating = await agent.get('/discover/books?minRating=4.2');

    assert.strictEqual(invalidYear.status, 400);
    assert.strictEqual(invalidLanguage.status, 400);
    assert.strictEqual(invalidRating.status, 400);
    assert.strictEqual(searchBooks.mock.callCount(), 0);
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

  it('uses one broad query for the default all-books feed', async () => {
    const seenQueries: string[] = [];
    const seenLimits: (number | undefined)[] = [];
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async ({ query, limit }: { query: string; limit?: number }) => {
        seenQueries.push(query);
        seenLimits.push(limit);

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
    assert.deepStrictEqual(seenQueries, ['*:*']);
    assert.deepStrictEqual(seenLimits, [50]);
    assert.strictEqual(res.body.results.length, 1);
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

  it('keeps distinct books from the broad default feed', async () => {
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
    assert.strictEqual(res.body.results.length, 4);
    assert.strictEqual(
      res.body.results.filter(
        (result: { author: string }) => result.author === 'Author One'
      ).length,
      3
    );
    assert.strictEqual(
      res.body.results.some(
        (result: { author: string }) => result.author === 'Author Two'
      ),
      true
    );
  });

  it('reports one sanitized structured context when Open Library is unavailable', async () => {
    const errorLog = mock.method(logger, 'error', () => undefined);
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => {
      throw new Error('provider unavailable');
    });

    const agent = await login();
    const res = await agent.get('/discover/books').query({
      page: 3,
      format: 'audiobook',
      query: 'space opera',
      sortBy: 'rating',
      subject: 'science_fiction',
      firstPublishYear: '2024',
      language: 'eng',
      minRating: '4.5',
    });

    assert.strictEqual(res.status, 503);
    assert.match(res.body.message, /Open Library.*unavailable/i);
    assert.strictEqual(errorLog.mock.callCount(), 1);
    const [, logContext] = errorLog.mock.calls[0].arguments as unknown as [
      string,
      Record<string, unknown>,
    ];
    const { errorStack, ...stableLogContext } = logContext;
    assert.strictEqual(typeof errorStack, 'string');
    assert.deepStrictEqual(stableLogContext, {
      label: 'Discover Books',
      errorMessage: 'provider unavailable',
      discoveryContext: {
        format: 'audiobook',
        keyword: 'space opera',
        page: 3,
        pageSize: 50,
        sort: 'rating',
        genre: 'science_fiction',
        firstPublishYear: '2024',
        language: 'eng',
        minRating: 4.5,
      },
    });
  });

  it('reports provider failure instead of an empty default book feed', async () => {
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 0,
      start: 0,
      docs: [],
    }));

    const agent = await login();
    const res = await agent.get('/discover/books?sortBy=ranked');

    assert.strictEqual(res.status, 503);
    assert.match(res.body.message, /Open Library.*timed out/i);
  });

  it('reports when a single Open Library request stalls', async () => {
    const errorLog = mock.method(logger, 'error', () => undefined);
    mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async () => new Promise(() => {})
    );

    const agent = await login();
    const res = await agent.get('/discover/books?subject=fiction');

    assert.strictEqual(res.status, 503);
    assert.match(res.body.message, /Open Library.*timed out/i);
    assert.strictEqual(errorLog.mock.callCount(), 1);
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
        serviceUrl: 'http://readarr.internal/book/1',
        externalServiceSlug: 'other-user-book',
        ratingKey: 'plex-book-key',
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

    const agent = await login('friend@seerr.dev');
    const res = await agent.get('/discover/books?query=other');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results[0].mediaInfo.watchlists.length, 0);
    assert.strictEqual(res.body.results[0].mediaInfo.serviceUrl, undefined);
    assert.strictEqual(
      res.body.results[0].mediaInfo.externalServiceSlug,
      undefined
    );
    assert.strictEqual(res.body.results[0].mediaInfo.ratingKey, undefined);
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

  it('paginates renderable local watchlist rows in stable insertion order', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.plexToken = null;
    await userRepository.save(admin);

    await getRepository(Watchlist).save([
      ...Array.from(
        { length: 22 },
        (_, index) =>
          new Watchlist({
            externalId: `OLPAGE${index}W`,
            mediaType: MediaType.BOOK,
            title: `Local Book ${index}`,
            requestedBy: admin,
          })
      ),
      new Watchlist({
        mediaType: MediaType.MOVIE,
        title: 'Incomplete Movie',
        requestedBy: admin,
      }),
      new Watchlist({
        mbId: '',
        mediaType: MediaType.MUSIC,
        title: 'Incomplete Album',
        requestedBy: admin,
      }),
    ]);

    const agent = await login();
    const response = await agent.get('/discover/watchlist?page=2');

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      response.body.results.map((item: { title: string }) => item.title),
      ['Local Book 20', 'Local Book 21']
    );
    assert.strictEqual(response.body.totalResults, 22);
    assert.strictEqual(response.body.totalPages, 2);
  });
});
