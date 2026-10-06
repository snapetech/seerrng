import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type SwipeSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import swipeRoutes from './swipe';

describe('Swipe routes behind the OpenAPI validator', () => {
  let app: Express;
  let previous: SwipeSettings;

  before(() => {
    previous = getSettings().swipe;
    getSettings().swipe = { ...previous, enabled: true, aiProvider: 'none' };
    app = express();
    app.use(express.json());
    app.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    app.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.REQUEST });
      next();
    });
    app.use('/api/v1/swipe', swipeRoutes);
    app.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );
  });

  after(() => {
    getSettings().swipe = previous;
  });

  it('rejects unknown media types and decisions', async () => {
    assert.equal(
      (await request(app).get('/api/v1/swipe/deck?mediaType=music')).status,
      400
    );
    assert.equal(
      (
        await request(app)
          .post('/api/v1/swipe/decisions')
          .send({ mediaType: 'movie', id: '1', decision: 'love' })
      ).status,
      400
    );
  });

  it('accepts a valid swipe that is not in the deck', async () => {
    const response = await request(app)
      .post('/api/v1/swipe/decisions')
      .send({ mediaType: 'movie', id: '1', decision: 'pass' });
    assert.equal(response.status, 404);
  });

  it('serves status', async () => {
    const response = await request(app).get('/api/v1/swipe/status');
    assert.equal(response.status, 200);
    assert.equal(response.body.aiRanking, false);
  });
});
