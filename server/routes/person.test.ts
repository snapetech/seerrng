import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import personRoutes from './person';

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
  app.use('/person', personRoutes);
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

const castCredit = (
  id: number,
  title: string,
  voteAverage: number,
  voteCount: number
) => ({
  id,
  media_type: 'movie',
  original_language: 'en',
  episode_count: 0,
  overview: '',
  origin_country: [],
  original_name: '',
  vote_count: voteCount,
  name: '',
  popularity: 20,
  credit_id: `credit-${id}`,
  backdrop_path: `/${id}-backdrop.jpg`,
  release_date: '2025-01-01',
  first_air_date: '',
  vote_average: voteAverage,
  genre_ids: [],
  poster_path: `/${id}.jpg`,
  original_title: title,
  video: false,
  title,
  adult: false,
  character: 'Lead',
});

describe('GET /person/:id/combined_credits', () => {
  it('rejects malformed person IDs before provider calls', async () => {
    const getMock = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called');
    }) as ReturnType<typeof mock.method>;

    const agent = await login();
    const res = await agent.get('/person/not-a-number/combined_credits');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getMock.mock.callCount(), 0);
  });

  it('ranks person cast credits by TMDB quality signals', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      assert.strictEqual(endpoint, '/person/123/combined_credits');

      return {
        id: 123,
        cast: [
          castCredit(1, 'Thin Credit', 4, 1),
          castCredit(2, 'Proven Credit', 8, 1000),
        ],
        crew: [],
      };
    });

    const agent = await login();
    const res = await agent.get('/person/123/combined_credits');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.cast.map((result: { title: string }) => result.title),
      ['Proven Credit', 'Thin Credit']
    );
  });
});
