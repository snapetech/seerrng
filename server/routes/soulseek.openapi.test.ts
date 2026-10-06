import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type SlskdnSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import soulseekRoutes from './soulseek';

describe('Soulseek routes behind the OpenAPI validator', () => {
  let app: Express;
  let previous: SlskdnSettings;

  before(() => {
    previous = getSettings().slskdn;
    getSettings().slskdn = { ...previous, enabled: false };
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
      req.user = new User({
        id: 1,
        permissions: Permission.MANAGE_REQUESTS | Permission.REQUEST,
      });
      next();
    });
    app.use('/api/v1/soulseek', soulseekRoutes);
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
    getSettings().slskdn = previous;
  });

  it('reports slskdN as not set up', async () => {
    const response = await request(app).get('/api/v1/soulseek/status');
    assert.equal(response.status, 200);
    assert.equal(response.body.configured, false);
  });

  it('validates track request bodies before the route runs', async () => {
    const empty = await request(app)
      .post('/api/v1/soulseek/track-requests')
      .send({ tracks: [] });
    assert.equal(empty.status, 400);

    const valid = await request(app)
      .post('/api/v1/soulseek/track-requests')
      .send({
        tracks: [{ artist: 'Band', title: 'Song', source: 'playlist' }],
      });
    assert.equal(
      valid.status,
      404,
      'passes validation, then reports not set up'
    );
  });

  it('rejects malformed album IDs', async () => {
    const response = await request(app).get(
      '/api/v1/soulseek/albums/not-an-id/issues'
    );
    assert.equal(response.status, 400);
  });

  it('accepts a SongID source', async () => {
    const response = await request(app)
      .post('/api/v1/soulseek/songid')
      .send({ source: 'Song that goes la la la' });
    assert.equal(response.status, 404);
  });
});
