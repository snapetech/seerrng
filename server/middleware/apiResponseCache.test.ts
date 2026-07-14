import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';
import { apiResponseCache } from './apiResponseCache';

const createApp = (authenticated = true) => {
  const app = express();

  app.use((req, _res, next) => {
    if (authenticated) {
      req.user = { id: 1 } as NonNullable<typeof req.user>;
    }
    next();
  });
  app.use(apiResponseCache);
  app.get('/discover/books', (_req, res) => res.json({ results: [] }));
  app.get('/book/OL1W', (_req, res) => res.json({ id: 'OL1W' }));
  app.get('/settings/public', (_req, res) => res.json({ initialized: true }));
  app.get('/settings/discover', (_req, res) => res.json([]));
  app.get('/request/count', (_req, res) => res.json({ pending: 0 }));
  app.get('/discover/fails', (_req, res) =>
    res.status(500).json({ message: 'failed' })
  );

  return app;
};

describe('apiResponseCache', () => {
  it('marks authenticated discover responses as private browser-cacheable', async () => {
    const res = await request(createApp()).get('/discover/books');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /no-cache/);
    assert.equal(res.headers.vary, 'Cookie, Accept-Encoding');
  });

  it('preserves body-derived conditional ETags for unchanged discover rows', async () => {
    const app = createApp();
    const first = await request(app).get('/discover/books');
    const unchanged = await request(app)
      .get('/discover/books')
      .set('If-None-Match', first.headers.etag);

    assert.ok(first.headers.etag);
    assert.equal(unchanged.status, 304);
  });

  it('uses a shorter private cache for media details', async () => {
    const res = await request(createApp()).get('/book/OL1W');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /max-age=300/);
  });

  it('prevents stale public settings from being reused', async () => {
    const app = createApp(false);
    const res = await request(app).get('/settings/public');
    const revalidated = await request(app)
      .get('/settings/public')
      .set('If-None-Match', res.headers.etag);

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.equal(revalidated.status, 200);
  });

  it('revalidates mutable discover settings before reuse', async () => {
    const res = await request(createApp()).get('/settings/discover');

    assert.equal(res.status, 200);
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /no-cache/);
  });

  it('does not cache errors or unrelated operational routes', async () => {
    const app = createApp();
    const [failure, requestCount] = await Promise.all([
      request(app).get('/discover/fails'),
      request(app).get('/request/count'),
    ]);

    assert.equal(failure.status, 500);
    assert.equal(failure.headers['cache-control'], undefined);
    assert.equal(requestCount.status, 200);
    assert.equal(requestCount.headers['cache-control'], undefined);
  });
});
