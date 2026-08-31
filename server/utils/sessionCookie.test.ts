import express from 'express';
import session from 'express-session';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { getSessionTransportOptions } from './sessionCookie';

const createApp = (development = false) => {
  const app = express();
  app.use(
    session({
      secret: '01234567890123456789012345678901',
      resave: false,
      saveUninitialized: false,
      ...getSessionTransportOptions(development, true),
    })
  );
  app.get('/', (req, res) => {
    req.session.userId = 1;
    res.json({ ok: true });
  });
  return app;
};

describe('getSessionTransportOptions', () => {
  it('requires secure transport for session cookies', () => {
    assert.equal(getSessionTransportOptions(false, true).cookie.secure, true);
    assert.equal(getSessionTransportOptions(false, false).cookie.secure, true);
    assert.equal(getSessionTransportOptions(false, true).proxy, true);
  });

  it('keeps the remaining cookie protections in development and production', () => {
    assert.equal(getSessionTransportOptions(true, true).cookie.secure, true);
    assert.equal(
      getSessionTransportOptions(true, true).cookie.sameSite,
      'strict'
    );
    assert.equal(
      getSessionTransportOptions(true, false).cookie.sameSite,
      'lax'
    );
    assert.equal(getSessionTransportOptions(true, true).cookie.httpOnly, true);
    assert.equal(
      getSessionTransportOptions(true, true).cookie.maxAge,
      30 * 24 * 60 * 60 * 1_000
    );
    assert.equal(getSessionTransportOptions(true, true).proxy, false);
  });

  it('does not issue a session cookie over direct HTTP', async () => {
    const directResponse = await request(createApp()).get('/');
    assert.equal(directResponse.get('Set-Cookie'), undefined);

    const response = await request(createApp())
      .get('/')
      .set('X-Forwarded-Proto', 'https');

    assert.match(response.get('Set-Cookie')?.[0] ?? '', /; Secure(?:;|$)/);
  });
});
