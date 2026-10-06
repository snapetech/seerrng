import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type TunerrSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import liveTvRoutes from './liveTv';

describe('Live TV routes behind the OpenAPI validator', () => {
  let app: Express;
  let previous: TunerrSettings;

  before(() => {
    previous = getSettings().tunerr;
    getSettings().tunerr = { ...previous, enabled: false, hostname: '' };
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
    app.use('/api/v1/live-tv', liveTvRoutes);
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
    getSettings().tunerr = previous;
  });

  it('accepts repeated titles and reports Live TV as unconfigured', async () => {
    const response = await request(app)
      .get('/api/v1/live-tv/airings')
      .query('title=The%20Matrix&title=Matrix&limit=5');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { configured: false, airings: [] });
  });

  it('requires a title', async () => {
    const response = await request(app).get('/api/v1/live-tv/airings');
    assert.equal(response.status, 400);
  });

  it('rejects an unknown recording kind before the route runs', async () => {
    const response = await request(app)
      .post('/api/v1/live-tv/recordings')
      .send({ kind: 'forever', title: 'News' });
    assert.equal(response.status, 400);
  });

  it('serves status and list endpoints', async () => {
    const status = await request(app).get('/api/v1/live-tv/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.canRequest, true);
    assert.equal('guide' in status.body, false);
  });

  it('reports a recording request when Live TV is not set up', async () => {
    const response = await request(app)
      .post('/api/v1/live-tv/recordings')
      .send({ kind: 'series', title: 'News' });
    assert.equal(response.status, 404);
  });
});
