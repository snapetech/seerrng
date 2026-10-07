import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it, mock } from 'node:test';

import { getRepository } from '@server/datasource';
import { ExternalRequestList } from '@server/entity/ExternalRequestList';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import axios from 'axios';
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

  it('validates and stores a private Hardcover token without exposing it', async () => {
    let calledAuthorization = '';
    mock.method(
      axios,
      'post',
      async (
        _url: string,
        body: unknown,
        config: { headers: Record<string, string> }
      ) => {
        assert.match(String((body as { query?: string }).query), /status_id/);
        calledAuthorization = config.headers.Authorization;
        return {
          status: 200,
          data: {
            data: {
              me: [
                {
                  user_books: [
                    {
                      book: {
                        id: 91,
                        title: 'The Dispossessed',
                        contributions: [
                          { author: { name: 'Ursula K. Le Guin' } },
                        ],
                        editions: [{ isbn_13: '9780061054884' }],
                      },
                    },
                  ],
                },
              ],
            },
          },
        };
      }
    );

    const agent = await loginAs('friend@seerr.dev');
    const connected = await agent
      .post('/api/v1/request/lists/hardcover')
      .send({ apiToken: 'Bearer hardcover_test_token_123456' });
    assert.equal(connected.status, 201, JSON.stringify(connected.body));
    assert.equal(connected.body.validatedBooks, 1);
    assert.equal(calledAuthorization, 'Bearer hardcover_test_token_123456');

    const lists = await agent.get('/api/v1/request/lists');
    assert.equal(lists.status, 200);
    assert.equal(lists.body[0].provider, 'hardcover');
    assert.equal(lists.body[0].apiToken, undefined);

    const stored = await getRepository(ExternalRequestList)
      .createQueryBuilder('list')
      .addSelect('list.apiToken')
      .getOneOrFail();
    assert.equal(stored.apiToken, 'hardcover_test_token_123456');
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
