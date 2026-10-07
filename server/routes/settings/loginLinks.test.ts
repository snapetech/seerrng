import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import UserLoginLink from '@server/entity/UserLoginLink';
import { getSettings } from '@server/lib/settings';
import router from '@server/routes';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import session from 'express-session';
import { createHash } from 'node:crypto';
import request from 'supertest';

describe('admin-generated sign-in links', () => {
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
  });

  const loginAs = async (email: string) => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.equal(response.status, 200);
    return agent;
  };

  const createForFriend = async () => {
    const admin = await loginAs('admin@seerr.dev');
    const target = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    const response = await admin
      .post('/api/v1/settings/login-links')
      .send({ userId: target.id });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return { admin, target, response };
  };

  it('stores only a token hash and consumes a link once for its selected user', async () => {
    const { admin, target, response } = await createForFriend();
    const token = response.body.token as string;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(response.headers['cache-control'], 'no-store');

    const metadata = await admin
      .get('/api/v1/settings/login-links')
      .query({ userId: target.id });
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.length, 1);
    assert.equal(metadata.body[0].token, undefined);
    assert.equal(metadata.body[0].tokenHash, undefined);

    const stored = await getRepository(UserLoginLink)
      .createQueryBuilder('loginLink')
      .addSelect('loginLink.tokenHash')
      .getOneOrFail();
    assert.equal(
      stored.tokenHash,
      createHash('sha256').update(token).digest('hex')
    );
    assert.notEqual(stored.tokenHash, token);

    const signedIn = request.agent(app);
    const accepted = await signedIn
      .post('/api/v1/auth/login-link')
      .send({ token });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.id, target.id);
    assert.equal((await signedIn.get('/api/v1/auth/me')).body.id, target.id);

    const replay = await request(app)
      .post('/api/v1/auth/login-link')
      .send({ token });
    assert.equal(replay.status, 403);
  });

  it('rejects revoked and expired links and prevents non-admin creation', async () => {
    const requester = await loginAs('friend@seerr.dev');
    const unauthorized = await requester
      .post('/api/v1/settings/login-links')
      .send({ userId: 1 });
    assert.equal(unauthorized.status, 403);

    const { admin, response } = await createForFriend();
    const revoked = await admin.post(
      `/api/v1/settings/login-links/${response.body.id}/revoke`
    );
    assert.equal(revoked.status, 200);
    const revokedUse = await request(app)
      .post('/api/v1/auth/login-link')
      .send({ token: response.body.token });
    assert.equal(revokedUse.status, 403);

    const expiredLink = await admin
      .post('/api/v1/settings/login-links')
      .send({ userId: 2 });
    assert.equal(expiredLink.status, 201);
    await getRepository(UserLoginLink).update(
      { id: expiredLink.body.id },
      { expiresAt: new Date(Date.now() - 1_000) }
    );
    const expiredUse = await request(app)
      .post('/api/v1/auth/login-link')
      .send({ token: expiredLink.body.token });
    assert.equal(expiredUse.status, 403);
  });
});
