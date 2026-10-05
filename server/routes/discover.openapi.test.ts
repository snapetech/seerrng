import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import * as yaml from 'js-yaml';
import request from 'supertest';

const api = yaml.load(
  readFileSync(path.join(process.cwd(), 'seerr-api.yml'), 'utf8')
) as {
  paths: Record<
    string,
    {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { properties: Record<string, unknown> };
              };
            };
          };
        };
      };
    }
  >;
};

const createValidatedApp = (): Express => {
  const app = express();
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.get('/api/v1/discover/books', (req, res) =>
    res.status(200).json({ accepted: true, query: req.query })
  );
  app.use(
    (
      error: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res.status(error.status ?? 500).json({
        status: error.status ?? 500,
        message: error.message,
      })
  );
  return app;
};

describe('book discovery responseVersion OpenAPI contract', () => {
  it('does not inject ebook-only search filters into audiobook browse requests', async () => {
    const response = await request(createValidatedApp())
      .get('/api/v1/discover/books')
      .query({ format: 'audiobook' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.query.format, 'audiobook');
    assert.strictEqual(response.body.query.query, undefined);
    assert.strictEqual(response.body.query.subject, undefined);
  });

  it('accepts the current response contract and retains compatibility with v2', async () => {
    const app = createValidatedApp();

    for (const responseVersion of [2, 3]) {
      const response = await request(app)
        .get('/api/v1/discover/books')
        .query({ responseVersion });

      assert.strictEqual(
        response.status,
        200,
        `responseVersion ${responseVersion} was rejected: ${response.body.message}`
      );
      assert.strictEqual(response.body.accepted, true);
    }
  });

  it('rejects response contract versions that are not documented', async () => {
    const response = await request(createValidatedApp())
      .get('/api/v1/discover/books')
      .query({ responseVersion: 4 });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /responseVersion/);
  });
});

describe('movie discovery outage fallback OpenAPI contract', () => {
  it('documents stale results on movie discovery rather than generic search', () => {
    const movieDiscoveryProperties =
      api.paths['/discover/movies'].get.responses['200'].content[
        'application/json'
      ].schema.properties;
    const searchProperties =
      api.paths['/search'].get.responses['200'].content['application/json']
        .schema.properties;

    assert.deepStrictEqual(movieDiscoveryProperties.stale, {
      type: 'boolean',
      description:
        'True when saved results are served because TMDB is unavailable.',
    });
    assert.strictEqual(searchProperties.stale, undefined);
  });
});
