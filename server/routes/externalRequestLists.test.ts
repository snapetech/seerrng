import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';

import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import session from 'express-session';
import request from 'supertest';
import router from './index';

describe('external request list routes', () => {
  let app: Express;

  function createApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(
      session({
        secret: 'test-secret',
        cookie: { secure: 'auto' },
        resave: false,
        saveUninitialized: false,
      })
    );
    testApp.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    testApp.use('/api/v1', router);
    testApp.use(
      (
        error: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) =>
        res
          .status(error.status ?? 500)
          .json({ status: error.status ?? 500, message: error.message })
    );
    return testApp;
  }

  before(async () => {
    app = createApp();
  });

  setupTestDb();

  beforeEach(() => {
    getSettings().main.localLogin = true;
  });

  async function loginAs(email: string) {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.equal(response.status, 200);
    return agent;
  }

  it('creates a recurring list source for the signed-in user', async () => {
    const agent = await loginAs('friend@seerr.dev');
    const response = await agent.post('/api/v1/request/lists').send({
      url: 'https://www.imdb.com/user/ur12345678/watchlist/',
    });

    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.provider, 'imdb');
    assert.equal(
      response.body.sourceUrl,
      'https://www.imdb.com/user/ur12345678/watchlist/'
    );
    assert.equal(response.body.userId, undefined);
    assert.equal(response.body.processedItemIds, undefined);
  });

  it('rejects a public-list URL that could target a private network', async () => {
    const agent = await loginAs('friend@seerr.dev');
    const response = await agent
      .post('/api/v1/request/lists')
      .send({ url: 'http://127.0.0.1/admin' });

    assert.equal(response.status, 400);
  });

  it('does not expose another user’s configured sources', async () => {
    const requester = await loginAs('friend@seerr.dev');
    const created = await requester.post('/api/v1/request/lists').send({
      url: 'https://www.imdb.com/user/ur12345678/watchlist/',
    });
    assert.equal(created.status, 201);

    const duplicate = await requester.post('/api/v1/request/lists').send({
      url: 'https://imdb.com/user/ur12345678/watchlist',
    });
    assert.equal(duplicate.status, 409);

    const admin = await loginAs('admin@seerr.dev');
    const response = await admin.get('/api/v1/request/lists');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
    assert.equal(
      (await admin.delete(`/api/v1/request/lists/${created.body.id}`)).status,
      404
    );

    assert.equal(
      (await requester.delete(`/api/v1/request/lists/${created.body.id}`))
        .status,
      204
    );
  });
});
