import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it, mock } from 'node:test';

import { getRepository } from '@server/datasource';
import ReadMeABookRequest from '@server/entity/ReadMeABookRequest';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import axios, { type AxiosRequestConfig } from 'axios';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import session from 'express-session';
import request from 'supertest';
import router from './index';

describe('ReadMeABook routes', () => {
  let app: Express;

  before(() => {
    app = express();
    app.use(express.json());
    app.use(
      session({
        secret: 'test-secret',
        cookie: { secure: 'auto' },
        resave: false,
        saveUninitialized: false,
      })
    );
    app.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    app.use('/api/v1', router);
    app.use(
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
  });

  setupTestDb();

  beforeEach(() => {
    getSettings().main.localLogin = true;
    getSettings().readmeabook = {
      enabled: true,
      hostname: 'readmeabook.local',
      port: 3030,
      useSsl: false,
      baseUrl: '',
      apiKey: 'rmab_test_token_1234567890',
    };
  });

  const loginAs = async (email: string) => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.equal(response.status, 200);
    return agent;
  };

  it('proxies Audible search using the configured bearer token and normalizes results', async () => {
    let calledUrl = '';
    let calledAuthorization = '';
    mock.method(axios, 'request', async (config: AxiosRequestConfig) => {
      calledUrl = String(config.url);
      calledAuthorization = String(config.headers?.Authorization);
      return {
        status: 200,
        data: {
          success: true,
          query: 'The Left Hand of Darkness',
          results: [
            {
              asin: 'b00left01k',
              title: 'The Left Hand of Darkness',
              authors: [{ name: 'Ursula K. Le Guin' }],
              narrator: 'George Guidall',
              coverArtUrl: 'https://images.example/left-hand.jpg',
              durationMinutes: 514,
            },
            { asin: 'invalid', title: 'Incomplete result' },
          ],
        },
      };
    });

    const user = await loginAs('friend@seerr.dev');
    const response = await user.get('/api/v1/readmeabook/search').query({
      query: 'The Left Hand of Darkness',
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.match(calledUrl, /\/api\/audiobooks\/search\?query=/);
    assert.equal(calledAuthorization, 'Bearer rmab_test_token_1234567890');
    assert.deepEqual(response.body, [
      {
        asin: 'B00LEFT01K',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        narrator: 'George Guidall',
        description: null,
        coverArtUrl: 'https://images.example/left-hand.jpg',
        durationMinutes: 514,
        releaseDate: null,
        rating: null,
      },
    ]);
  });

  it('keeps request ownership local and exposes only safe remote status details', async () => {
    let currentRequest = 0;
    mock.method(axios, 'request', async (config: AxiosRequestConfig) => {
      if (config.method === 'POST') {
        return {
          status: 201,
          data: {
            success: true,
            request: { id: 'rmab-request-41', status: 'pending' },
          },
        };
      }
      currentRequest += 1;
      return {
        status: 200,
        data: {
          request: {
            id: 'rmab-request-41',
            status: 'downloading',
            statusMessage: 'Fetching release',
          },
          downloadHistory: [
            {
              status: 'completed',
              progress: 100,
              filePath: '/private/media/book.m4b',
            },
          ],
          jobs: [
            { type: 'search', status: 'completed', token: 'must-not-escape' },
          ],
        },
      };
    });

    const user = await loginAs('friend@seerr.dev');
    const created = await user.post('/api/v1/readmeabook/requests').send({
      asin: 'B00LEFT01K',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      durationMinutes: 514,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'awaiting_approval');

    const own = await user.get('/api/v1/readmeabook/requests');
    assert.equal(own.status, 200);
    assert.equal(own.body[0].id, created.body.id);
    assert.equal(own.body[0].remoteId, undefined);

    const admin = await loginAs('admin@seerr.dev');
    const approvalQueue = await admin.get('/api/v1/readmeabook/admin/requests');
    assert.equal(approvalQueue.status, 200);
    assert.equal(approvalQueue.body[0].user.username, 'friend');

    const approved = await admin.post(
      `/api/v1/readmeabook/admin/requests/${created.body.id}/approve`
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'pending');

    const remoteStatus = await user.get(
      `/api/v1/readmeabook/requests/${created.body.id}`
    );
    assert.equal(remoteStatus.status, 200, JSON.stringify(remoteStatus.body));
    assert.equal(remoteStatus.body.status, 'downloading');
    assert.equal(remoteStatus.body.statusMessage, 'Fetching release');
    assert.equal(remoteStatus.body.downloadHistory[0].progress, 100);
    assert.equal(remoteStatus.body.downloadHistory[0].filePath, undefined);
    assert.equal(remoteStatus.body.jobs[0].token, undefined);
    assert.equal(currentRequest, 1);

    const notOwned = await request(app).get(
      `/api/v1/readmeabook/requests/${created.body.id}`
    );
    assert.notEqual(notOwned.status, 200);
    assert.equal(
      await getRepository(ReadMeABookRequest).count({
        where: { id: created.body.id },
      }),
      1
    );
  });
});
