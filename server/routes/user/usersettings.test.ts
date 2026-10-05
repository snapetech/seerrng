import * as OpenApiValidator from 'express-openapi-validator';
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import path from 'node:path';
import request from 'supertest';
import userRoutes from '.';

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-link-user-001',
    Name: 'linkeduser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);

let app: Express;
const API_SPEC_PATH = path.resolve(process.cwd(), 'seerr-api.yml');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: true },
      proxy: true,
    })
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
  app.use('/auth', authRoutes);
  app.use(
    OpenApiValidator.middleware({
      apiSpec: API_SPEC_PATH,
      validateRequests: true,
    })
  );
  app.use('/user', isAuthenticated(), userRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  settings.main.localLogin = true;

  const res = await request(app)
    .post('/auth/local')
    .set('X-Forwarded-Proto', 'https')
    .send({ email, password });

  assert.strictEqual(res.status, 200);
  const setCookie = res.headers['set-cookie']?.[0];
  assert.ok(setCookie?.includes('; Secure'));
  const sessionCookie = setCookie.split(';', 1)[0];
  return { sessionCookie, userId: res.body.id as number };
}

describe('POST /user/:id/settings/linked-accounts/jellyfin/quickconnect', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    configureJellyfin();
  });

  it('links the account when the media server is Jellyfin', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );

    const res = await request(app)
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 1);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, 'jf-link-user-001');
    assert.strictEqual(user.userType, UserType.JELLYFIN);
  });

  it('returns 403 when the media server is Emby', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app)
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, null);
  });
});

describe('POST /user/:id/settings/theme', () => {
  it('starts on SeerrNG and preserves a newly saved account theme through later logins', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    const repository = getRepository(User);
    const initial = await repository.findOneOrFail({ where: { id: userId } });
    assert.equal(initial.settings?.themePalette ?? 'seerr', 'seerr');
    const response = await request(app)
      .post(`/user/${userId}/settings/theme`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ palette: 'aurora' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, { themePalette: 'aurora' });
    const secondLogin = await loginAs('demo@seerr.dev', 'test1234');
    const current = await request(app)
      .get('/auth/me')
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', secondLogin.sessionCookie);
    assert.equal(current.status, 200);
    assert.equal(current.body.settings.themePalette, 'aurora');
    const saved = await repository.findOneOrFail({ where: { id: userId } });
    assert.equal(saved.settings?.themePalette, 'aurora');
  });

  it('rejects malformed and unsupported choices without changing the saved theme', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    for (const body of [
      {},
      { palette: 'unknown' },
      { palette: 1 },
      { palette: 'classic', extra: true },
      { palette: 'x'.repeat(100) },
    ]) {
      const response = await request(app)
        .post(`/user/${userId}/settings/theme`)
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', sessionCookie)
        .send(body);
      assert.equal(response.status, 400);
    }
    const saved = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.equal(saved.settings?.themePalette ?? 'seerr', 'seerr');
  });

  it('does not allow one user to set another user theme', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    const response = await request(app)
      .post(`/user/${userId + 1}/settings/theme`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ palette: 'classic' });
    assert.equal(response.status, 403);
  });
});

describe('POST /user/:id/settings/advanced-theme', () => {
  it('saves validated overrides for the signed-in user and clears them on reset', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    const route = `/user/${userId}/settings/advanced-theme`;

    const saved = await request(app)
      .post(route)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({
        overrides: {
          '--theme-page-bg': '#123456',
          '--theme-page-spotlight-strength': 0.5,
        },
      });

    assert.strictEqual(saved.status, 200);
    assert.deepEqual(saved.body.advancedThemeOverrides, {
      '--theme-page-bg': '#123456',
      '--theme-page-spotlight-strength': 0.5,
    });

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
      relations: { settings: true },
    });
    assert.deepEqual(user.settings?.advancedThemeOverrides, {
      '--theme-page-bg': '#123456',
      '--theme-page-spotlight-strength': 0.5,
    });

    const invalid = await request(app)
      .post(route)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({
        overrides: { '--theme-page-bg': 'url(https://example.invalid)' },
      });
    assert.strictEqual(invalid.status, 400);

    const reset = await request(app)
      .post(route)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ overrides: null });
    assert.strictEqual(reset.status, 200);
    assert.strictEqual(reset.body.advancedThemeOverrides, null);
  });
});

describe('request root folder settings', () => {
  it('saves and returns per-service defaults, including long cross-platform paths', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    const route = `/user/${userId}/settings/main`;
    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    const requestRootFolders = {
      'radarr:0': '/media/Movies/David',
      'sonarr:2': 'D:\\Media\\Series\\David',
      'lidarr:3': '\\\\nas\\media\\Music',
      'comic-kapowarr:4': `/${'x'.repeat(4095)}`,
    };

    const saved = await request(app)
      .post(route)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie)
      .send({ username: user.username, requestRootFolders });

    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.requestRootFolders, requestRootFolders);

    const loaded = await request(app)
      .get(`/user/${userId}/settings/request-root-folders`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie);

    assert.strictEqual(loaded.status, 200);
    assert.deepEqual(loaded.body, requestRootFolders);
  });

  it('rejects invalid service keys and malformed or oversized paths', async () => {
    const { sessionCookie, userId } = await loginAs(
      'demo@seerr.dev',
      'test1234'
    );
    const route = `/user/${userId}/settings/main`;
    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    const invalidValues = [
      { 'plex:0': '/media/Movies' },
      { 'radarr:0': '' },
      { 'radarr:0': '/media/Movies\n' },
      { 'radarr:0': `/${'x'.repeat(4096)}` },
      Object.fromEntries(
        Array.from({ length: 101 }, (_, index) => [
          `radarr:${index}`,
          `/media/${index}`,
        ])
      ),
    ];

    for (const requestRootFolders of invalidValues) {
      const response = await request(app)
        .post(route)
        .set('X-Forwarded-Proto', 'https')
        .set('Cookie', sessionCookie)
        .send({ username: user.username, requestRootFolders });

      assert.strictEqual(response.status, 400);
    }
  });

  it('does not expose another user’s folder defaults to an ordinary user', async () => {
    const { sessionCookie } = await loginAs('friend@seerr.dev', 'test1234');
    const targetUser = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });

    const response = await request(app)
      .get(`/user/${targetUser.id}/settings/request-root-folders`)
      .set('X-Forwarded-Proto', 'https')
      .set('Cookie', sessionCookie);

    assert.strictEqual(response.status, 403);
  });
});
