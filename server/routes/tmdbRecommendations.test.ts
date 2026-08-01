import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import movieRoutes from './movie';
import tvRoutes from './tv';

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
  app.use('/movie', movieRoutes);
  app.use('/tv', tvRoutes);
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

const movieResults = [
  {
    id: 1,
    media_type: 'movie',
    title: 'Thin Recommended Movie',
    original_title: 'Thin Recommended Movie',
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
    title: 'Proven Recommended Movie',
    original_title: 'Proven Recommended Movie',
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
];

const tvResults = [
  {
    id: 1,
    media_type: 'tv',
    name: 'Thin Recommended Series',
    original_name: 'Thin Recommended Series',
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
    name: 'Proven Recommended Series',
    original_name: 'Proven Recommended Series',
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
];

describe('TMDB related media recommendations', () => {
  it('rejects malformed movie IDs before provider calls', async () => {
    const getMock = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called');
    }) as ReturnType<typeof mock.method>;

    const agent = await login();
    const res = await agent.get('/movie/not-a-number/recommendations');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getMock.mock.callCount(), 0);
  });

  it('ranks movie recommendations by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/movie/10/recommendations');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: movieResults,
      };
    });

    const agent = await login();
    const res = await agent.get('/movie/10/recommendations');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { title: string }) => result.title),
      ['Proven Recommended Movie', 'Thin Recommended Movie']
    );
  });

  it('rejects oversized movie recommendation shuffle seeds before provider calls', async () => {
    const getMock = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called');
    }) as ReturnType<typeof mock.method>;

    const agent = await login();
    const res = await agent
      .get('/movie/10/recommendations')
      .query({ shuffleSeed: 'x'.repeat(129) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /shuffle seed must be 128 characters/i);
    assert.strictEqual(getMock.mock.callCount(), 0);
  });

  it('uses seeded jitter for movie recommendations when a shuffle seed is provided', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/movie/10/recommendations');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: movieResults,
      };
    });

    const agent = await login();
    mock.method(Math, 'random', () => {
      throw new Error('Seeded ranking should not call Math.random');
    });

    const res = await agent
      .get('/movie/10/recommendations')
      .query({ shuffleSeed: 'refresh-a' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 2);
  });

  it('ranks series recommendations by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/tv/20/recommendations');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: tvResults,
      };
    });

    const agent = await login();
    const res = await agent.get('/tv/20/recommendations');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { name: string }) => result.name),
      ['Proven Recommended Series', 'Thin Recommended Series']
    );
  });

  it('rejects oversized series recommendation shuffle seeds before provider calls', async () => {
    const getMock = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called');
    }) as ReturnType<typeof mock.method>;

    const agent = await login();
    const res = await agent
      .get('/tv/20/recommendations')
      .query({ shuffleSeed: 'x'.repeat(129) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /shuffle seed must be 128 characters/i);
    assert.strictEqual(getMock.mock.callCount(), 0);
  });

  it('uses seeded jitter for series recommendations when a shuffle seed is provided', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/tv/20/recommendations');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: tvResults,
      };
    });

    const agent = await login();
    mock.method(Math, 'random', () => {
      throw new Error('Seeded ranking should not call Math.random');
    });

    const res = await agent
      .get('/tv/20/recommendations')
      .query({ shuffleSeed: 'refresh-a' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 2);
  });

  it('ranks similar series by quality signals within the TMDB page', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/tv/20/similar');

      return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: tvResults,
      };
    });

    const agent = await login();
    const res = await agent.get('/tv/20/similar');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((result: { name: string }) => result.name),
      ['Proven Recommended Series', 'Thin Recommended Series']
    );
  });

  it('rejects malformed series IDs before provider calls', async () => {
    const getMock = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called');
    }) as ReturnType<typeof mock.method>;

    const agent = await login();
    const res = await agent.get('/tv/not-a-number/similar');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getMock.mock.callCount(), 0);
  });
});
