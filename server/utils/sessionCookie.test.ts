import express from 'express';
import session from 'express-session';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { getSessionTransportOptions } from './sessionCookie';

const createApp = (development = false) => {
  const app = express();
  const sessionTransportOptions = getSessionTransportOptions(development, true);
  app.use(
    session({
      secret: '01234567890123456789012345678901',
      resave: false,
      saveUninitialized: false,
      cookie: {
        ...sessionTransportOptions.cookie,
      },
      proxy: sessionTransportOptions.proxy,
    })
  );
  app.get('/', (req, res) => {
    req.session.userId = 1;
    res.json({ ok: true });
  });
  return app;
};

describe('getSessionTransportOptions', () => {
  it('requires HTTPS for session cookies', () => {
    assert.equal(getSessionTransportOptions(false, true).cookie.secure, true);
    assert.equal(getSessionTransportOptions(false, false).cookie.secure, true);
    assert.equal(getSessionTransportOptions(false, true).proxy, true);
  });

  it('allows the explicit HTTP fallback to remain transport-aware', () => {
    assert.equal(
      getSessionTransportOptions(false, true, true).cookie.secure,
      'auto'
    );
    assert.equal(
      getSessionTransportOptions(false, false, true).cookie.secure,
      'auto'
    );
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

  it('does not issue a session cookie over HTTP', async () => {
    const directResponse = await request(createApp()).get('/');
    assert.equal(directResponse.headers['set-cookie'], undefined);

    const response = await request(createApp())
      .get('/')
      .set('X-Forwarded-Proto', 'https');

    assert.match(response.get('Set-Cookie')?.[0] ?? '', /; Secure(?:;|$)/);
  });

  it('issues a non-Secure cookie only when the HTTP fallback is enabled', async () => {
    const response = await request(createApp(false)).get('/');
    assert.equal(response.headers['set-cookie'], undefined);

    const fallbackApp = express();
    const sessionTransportOptions = getSessionTransportOptions(
      false,
      true,
      true
    );
    fallbackApp.use(
      session({
        secret: '01234567890123456789012345678901',
        resave: false,
        saveUninitialized: false,
        cookie: sessionTransportOptions.cookie,
        proxy: sessionTransportOptions.proxy,
      })
    );
    fallbackApp.get('/', (req, res) => {
      req.session.userId = 1;
      res.json({ ok: true });
    });

    const fallbackResponse = await request(fallbackApp).get('/');
    assert.match(fallbackResponse.get('Set-Cookie')?.[0] ?? '', /HttpOnly/);
    assert.doesNotMatch(
      fallbackResponse.get('Set-Cookie')?.[0] ?? '',
      /; Secure(?:;|$)/
    );
  });
});
