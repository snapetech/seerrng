import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import express from 'express';
import http from 'node:http';
import request from 'supertest';
import {
  createRequestStatusProxy,
  getRequestStatusOrigin,
  getRequestStatusProxyPath,
} from './requestStatusProxy';

describe('Request Status same-origin proxy', () => {
  let upstream: http.Server;
  let origin: URL;

  before(async () => {
    upstream = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          path: req.url,
          cookie: req.headers.cookie,
        })
      );
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve)
    );
    const address = upstream.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test Request Status server did not bind to a TCP port.');
    }
    origin = new URL(`http://127.0.0.1:${address.port}`);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('maps only the bounded public status paths', () => {
    assert.strictEqual(getRequestStatusProxyPath('/request-status'), '/');
    assert.strictEqual(getRequestStatusProxyPath('/request-status/'), '/');
    assert.strictEqual(
      getRequestStatusProxyPath('/request-status/api/history?fresh=1'),
      '/api/history?fresh=1'
    );
    assert.strictEqual(
      getRequestStatusProxyPath('/request-status/webhook'),
      undefined
    );
    assert.strictEqual(getRequestStatusProxyPath('/requests'), undefined);
  });

  it('rejects external, credentialed, and path-bearing origins', () => {
    assert.throws(() => getRequestStatusOrigin('https://example.com'));
    assert.throws(() => getRequestStatusOrigin('http://user:pass@example.com'));
    assert.throws(() => getRequestStatusOrigin('http://example.com/status'));
  });

  it('forwards the Seerr session and query through the existing origin', async () => {
    const app = express();
    app.use('/request-status', createRequestStatusProxy(origin));

    const response = await request(app)
      .get('/request-status/api/history?fresh=1')
      .set('Cookie', 'connect.sid=example');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.path, '/api/history?fresh=1');
    assert.strictEqual(response.body.cookie, 'connect.sid=example');
  });

  it('does not expose other companion endpoints or mutation methods', async () => {
    const app = express();
    app.use('/request-status', createRequestStatusProxy(origin));

    const unknown = await request(app).get('/request-status/webhook');
    const mutation = await request(app).post('/request-status/api/history');

    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(mutation.status, 405);
  });
});
