import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import router from './index';

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
  app.use('/api/v1', router);
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

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('Top-level API route validation', () => {
  it('rejects malformed keyword detail IDs before provider lookup', async () => {
    const agent = await login();
    const res = await agent.get('/api/v1/keyword/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects missing Pushover sound tokens before provider lookup', async () => {
    const agent = await login();
    const res = await agent.get(
      '/api/v1/settings/notifications/pushover/sounds'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Pushover application token/);
  });

  it('rejects oversized watch provider regions before provider lookup', async () => {
    const agent = await login();
    const res = await agent
      .get('/api/v1/watchproviders/movies')
      .query({ watchRegion: 'x'.repeat(17) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Watch region/);
  });
});
