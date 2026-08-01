import assert from 'node:assert/strict';
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { LinkedAccount } from '@server/entity/LinkedAccount';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import PreparedEmail from '@server/lib/email';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import { waitForBackgroundTasks } from '@server/utils/backgroundTasks';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import fetchMock from 'fetch-mock';
import request from 'supertest';
import authRoutes, {
  LOCAL_LOGIN_FAILURE_LIMIT,
  LOCAL_LOGIN_FAILURE_WINDOW_MS,
  MAX_ACTIVE_OIDC_CORRELATIONS,
  MAX_OIDC_CALLBACK_URL_LENGTH,
  MAX_PASSWORD_RESET_DELIVERY_QUEUE,
  OIDC_HTTP_TIMEOUT_SECONDS,
  PASSWORD_RESET_DELIVERY_CONCURRENCY,
  isAllowedOidcAuthorizationUrl,
  parseOidcCallbackUrl,
  resumePendingPasswordResetDeliveries,
  waitForPendingPasswordResetDeliveries,
} from './auth';

describe('isAllowedOidcAuthorizationUrl', () => {
  it('only admits credential-free HTTPS URLs unless insecure OIDC is enabled', () => {
    assert.strictEqual(
      isAllowedOidcAuthorizationUrl(
        new URL('https://identity.example/authorize')
      ),
      true
    );
    assert.strictEqual(
      isAllowedOidcAuthorizationUrl(
        new URL('http://identity.example/authorize'),
        false
      ),
      false
    );
    assert.strictEqual(
      isAllowedOidcAuthorizationUrl(
        new URL('http://identity.example/authorize'),
        true
      ),
      true
    );
    assert.strictEqual(
      isAllowedOidcAuthorizationUrl(
        new URL('https://user:secret@identity.example/authorize')
      ),
      false
    );
    assert.strictEqual(
      isAllowedOidcAuthorizationUrl(new URL('javascript:alert(1)')),
      false
    );
  });
});

describe('parseOidcCallbackUrl', () => {
  it('accepts only bounded scalar absolute URLs', () => {
    assert.strictEqual(
      parseOidcCallbackUrl('https://seerr.example/login?code=one')?.hostname,
      'seerr.example'
    );
    assert.strictEqual(
      parseOidcCallbackUrl(['https://seerr.example/login']),
      undefined
    );
    assert.strictEqual(parseOidcCallbackUrl({}), undefined);
    assert.strictEqual(parseOidcCallbackUrl('/login?code=one'), undefined);
    assert.strictEqual(
      parseOidcCallbackUrl(
        `https://seerr.example/login?code=${'a'.repeat(
          MAX_OIDC_CALLBACK_URL_LENGTH
        )}`
      ),
      undefined
    );
  });
});

const emailMock = mock.method(PreparedEmail.prototype, 'send', async () => {
  return undefined;
}).mock;

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser('SECRET'));
  app.use(
    session({
      secret: 'test-secret',
      cookie: { secure: 'auto' },
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
  app.use('/auth', authRoutes);
  // Error handler matching how next({ status, error, message }) calls are handled
  app.use(
    (
      err: { status?: number; error?: string; message?: string },
      _req: express.Request,
      res: express.Response,
      // We must provide a next function for the function signature here even though its not used
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({
        status: err.status ?? 500,
        error: err.error,
        message: err.message,
      });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

afterEach(async () => {
  await waitForPendingPasswordResetDeliveries();
  await waitForBackgroundTasks();
  getSettings().reset();
});

setupTestDb();

/** Create a supertest agent that is logged in as the given user. */
async function authenticatedAgent(email: string, password: string) {
  const agent = request.agent(app);
  const settings = getSettings();
  settings.main.localLogin = true;

  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return agent;
}

describe('GET /auth/me', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await request(app).get('/auth/me');
    assert.strictEqual(res.status, 403);
  });

  it('returns the authenticated user', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    assert.strictEqual(res.body.displayName, 'admin');
  });

  it('does not fall back to a session after an explicit invalid API key', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(login.status, 200);

    const response = await agent
      .get('/auth/me')
      .set('X-API-Key', 'invalid-service-credential');

    assert.strictEqual(response.status, 403);
  });

  it('never returns credential or notification secrets', async () => {
    const userRepository = getRepository(User);
    const user = await userRepository.findOneByOrFail({ id: 1 });
    user.passwordChangedAt = new Date();
    user.recoveryLinkExpirationDate = new Date(Date.now() + 60_000);
    user.settings = new UserSettings({
      ...user.settings,
      pushbulletAccessToken: 'pushbullet-secret',
      pushoverApplicationToken: 'pushover-application-secret',
      pushoverUserKey: 'pushover-user-secret',
      locale: 'en',
    });
    await userRepository.save(user);

    const serializedUser = JSON.parse(JSON.stringify(user));
    const serializedSettings = JSON.parse(JSON.stringify(user.settings));
    assert.ok(!('settings' in serializedUser));
    assert.ok(!('passwordChangedAt' in serializedUser));
    assert.strictEqual(serializedSettings.locale, 'en');
    assert.ok(!('pushbulletAccessToken' in serializedSettings));
    assert.ok(!('pushoverApplicationToken' in serializedSettings));

    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');
    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.locale, 'en');
    assert.ok(!('passwordChangedAt' in res.body));
    assert.ok(!('recoveryLinkExpirationDate' in res.body));
    assert.ok(!('pushbulletAccessToken' in res.body.settings));
    assert.ok(!('pushoverApplicationToken' in res.body.settings));
    assert.ok(!('pushoverUserKey' in res.body.settings));
  });

  it('includes userEmailRequired warning when email is required but invalid', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.options.userEmailRequired = true;

    // Change the user's email to something invalid
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.email = 'not-an-email';
    await userRepo.save(user);

    // Log in with the changed email
    const agent = request.agent(app);
    settings.main.localLogin = true;
    const loginRes = await agent
      .post('/auth/local')
      .send({ email: 'not-an-email', password: 'test1234' });
    assert.strictEqual(loginRes.status, 200);

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.warnings.includes('userEmailRequired'));

    settings.notifications.agents.email.options.userEmailRequired = false;
  });

  it('invalidates authenticated sessions after a password change', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');
    const userRepository = getRepository(User);
    const user = await userRepository.findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    await user.setPassword('replacement-password');
    await userRepository.save(user);

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 403);
  });
});

describe('POST /auth/plex', () => {
  it('returns forbidden without contacting Plex when Plex login is disabled', async () => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    const getUser = mock.method(PlexTvAPI.prototype, 'getUser');

    try {
      const response = await request(app)
        .post('/auth/plex')
        .send({ authToken: 'unused-token' });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(getUser.mock.callCount(), 0);
    } finally {
      settings.main.mediaServerType = previousMediaServerType;
      getUser.mock.restore();
    }
  });

  it('does not revert permissions changed while Plex access is checked', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.PLEX;
    const userRepository = getRepository(User);
    let accessCheckStarted!: () => void;
    let releaseAccessCheck!: () => void;
    const accessCheckStartedPromise = new Promise<void>((resolve) => {
      accessCheckStarted = resolve;
    });
    const releaseAccessCheckPromise = new Promise<void>((resolve) => {
      releaseAccessCheck = resolve;
    });
    const getUserMock = mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async () => ({
        id: 2,
        uuid: 'friend',
        email: 'friend@seerr.dev',
        joined_at: '2026-01-01T00:00:00Z',
        username: 'friend',
        title: 'Friend',
        thumb: 'https://example.com/friend-avatar.png',
        hasPassword: true,
        authToken: 'refreshed-friend-token',
        subscription: {
          active: true,
          status: 'active',
          plan: 'lifetime',
          features: [],
        },
        roles: { roles: [] },
        entitlements: [],
      })
    ).mock;
    const checkAccessMock = mock.method(
      PlexTvAPI.prototype,
      'checkUserAccess',
      async () => {
        accessCheckStarted();
        await releaseAccessCheckPromise;
        return true;
      }
    ).mock;

    try {
      const loginPromise = request(app)
        .post('/auth/plex')
        .send({ authToken: 'refreshed-friend-token' })
        .then((response) => response);
      await accessCheckStartedPromise;
      await userRepository.update(2, { permissions: Permission.ADMIN });
      releaseAccessCheck();

      const response = await loginPromise;
      assert.strictEqual(response.status, 200);
      const persisted = await userRepository.findOneByOrFail({ id: 2 });
      assert.strictEqual(persisted.permissions, Permission.ADMIN);
    } finally {
      releaseAccessCheck();
      getUserMock.restore();
      checkAccessMock.restore();
    }
  });

  it('rejects an invalid Plex owner identity before creating user 1', async () => {
    const userRepository = getRepository(User);
    await userRepository.clear();
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    const getUserMock = mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async () =>
        ({
          id: -1,
          email: 'bootstrap-owner@seerr.dev',
          username: 'bootstrap-owner',
          authToken: 'bootstrap-token',
        }) as never
    );

    try {
      const res = await request(app)
        .post('/auth/plex')
        .send({ authToken: 'bootstrap-token' });

      assert.strictEqual(res.status, 502);
      assert.match(res.body.message, /invalid account identity/i);
      assert.strictEqual(await userRepository.count(), 0);
    } finally {
      getUserMock.mock.restore();
    }
  });

  it('claims the canonical owner ID during initial setup', async () => {
    const userRepository = getRepository(User);
    await userRepository.clear();

    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;

    const getUserMock = mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async () => ({
        id: 1234,
        uuid: 'bootstrap-owner',
        email: 'bootstrap-owner@seerr.dev',
        joined_at: '2026-01-01T00:00:00Z',
        username: 'bootstrap-owner',
        title: 'Bootstrap Owner',
        thumb: 'https://example.com/avatar.png',
        hasPassword: true,
        authToken: 'bootstrap-token',
        subscription: {
          active: true,
          status: 'active',
          plan: 'lifetime',
          features: [],
        },
        roles: { roles: [] },
        entitlements: [],
      })
    ).mock;

    try {
      const res = await request(app)
        .post('/auth/plex')
        .send({ authToken: 'bootstrap-token' });

      assert.strictEqual(res.status, 200);
      const users = await userRepository.find();
      assert.strictEqual(users.length, 1);
      assert.strictEqual(users[0].id, 1);
      assert.strictEqual(users[0].permissions, 2);
    } finally {
      getUserMock.restore();
      settings.main.mediaServerType = previousMediaServerType;
      await settings.save();
    }
  });

  it('keeps a failed Plex settings write recoverable after claiming the owner row', async () => {
    const userRepository = getRepository(User);
    await userRepository.clear();
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    const getUserMock = mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async () => ({
        id: 1234,
        uuid: 'bootstrap-owner',
        email: 'bootstrap-owner@seerr.dev',
        joined_at: '2026-01-01T00:00:00Z',
        username: 'bootstrap-owner',
        title: 'Bootstrap Owner',
        thumb: 'https://example.com/avatar.png',
        hasPassword: true,
        authToken: 'bootstrap-token',
        subscription: {
          active: true,
          status: 'active',
          plan: 'lifetime',
          features: [],
        },
        roles: { roles: [] },
        entitlements: [],
      })
    ).mock;
    const saveMock = mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    }).mock;

    try {
      const failed = await request(app)
        .post('/auth/plex')
        .send({ authToken: 'bootstrap-token' });

      assert.strictEqual(failed.status, 500);
      assert.strictEqual((await userRepository.find()).length, 1);
      assert.strictEqual(
        settings.main.mediaServerType,
        MediaServerType.NOT_CONFIGURED
      );

      saveMock.restore();
      const retried = await request(app)
        .post('/auth/plex')
        .send({ authToken: 'bootstrap-token' });

      assert.strictEqual(retried.status, 200);
      assert.strictEqual(settings.main.mediaServerType, MediaServerType.PLEX);
    } finally {
      getUserMock.restore();
      saveMock.restore();
    }
  });

  it('does not let a demoted Plex owner configure an existing instance', async (t) => {
    const userRepository = getRepository(User);
    await userRepository.update(1, { permissions: Permission.REQUEST });
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    const getUserMock = mock.method(
      PlexTvAPI.prototype,
      'getUser',
      async () =>
        ({
          id: 1,
          email: 'admin@seerr.dev',
          username: 'admin',
          authToken: 'demoted-owner-token',
        }) as never
    );
    t.after(() => getUserMock.mock.restore());

    const response = await request(app)
      .post('/auth/plex')
      .send({ authToken: 'demoted-owner-token' });

    assert.strictEqual(response.status, 403);
    assert.strictEqual(
      settings.main.mediaServerType,
      MediaServerType.NOT_CONFIGURED
    );
  });

  it('rejects malformed Plex login bodies before external auth', async () => {
    const res = await request(app).post('/auth/plex').send([]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Request body must be an object.');
  });
});

describe('POST /auth/jellyfin', () => {
  it('returns forbidden without contacting Jellyfin when login is disabled', async () => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.PLEX;
    const login = mock.method(JellyfinAPI.prototype, 'login');

    try {
      const response = await request(app).post('/auth/jellyfin').send({
        username: 'unused-user',
        password: 'unused-password',
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(login.mock.callCount(), 0);
    } finally {
      settings.main.mediaServerType = previousMediaServerType;
      login.mock.restore();
    }
  });

  it('rejects invalid provider user identities before account lookup', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    settings.jellyfin.ip = 'jellyfin.example.com';
    const loginMock = mock.method(
      JellyfinAPI.prototype,
      'login',
      async () =>
        ({
          User: { Id: 'not-a-guid', Name: 'invalid-provider-user' },
          AccessToken: 'token',
        }) as never
    );

    try {
      const res = await request(app).post('/auth/jellyfin').send({
        username: 'invalid-provider-user',
        password: 'password',
      });

      assert.strictEqual(res.status, 502);
      assert.match(res.body.message, /invalid user identity/i);
    } finally {
      loginMock.mock.restore();
    }
  });

  it('rejects malformed Jellyfin login bodies before external auth', async () => {
    const res = await request(app).post('/auth/jellyfin').send([]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Request body must be an object.');
  });

  it('rejects malformed Jellyfin setup port values before external auth', async () => {
    const res = await request(app).post('/auth/jellyfin').send({
      username: 'admin',
      hostname: 'jellyfin.example.com',
      port: 70000,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'port must be an integer between 1 and 65535.'
    );
  });

  it('rejects malformed Jellyfin setup TLS flags before external auth', async () => {
    const res = await request(app).post('/auth/jellyfin').send({
      username: 'admin',
      hostname: 'jellyfin.example.com',
      useSsl: 'yes',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'useSsl must be a boolean.');
  });

  it('rejects absolute Jellyfin setup URL bases before external auth', async () => {
    const res = await request(app).post('/auth/jellyfin').send({
      username: 'admin',
      hostname: 'jellyfin.example.com',
      urlBase: 'https://evil.example.com/jellyfin',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'urlBase must be a relative path.');
  });

  it('rejects unsupported Jellyfin setup server types before external auth', async () => {
    const res = await request(app).post('/auth/jellyfin').send({
      username: 'admin',
      hostname: 'jellyfin.example.com',
      serverType: 999,
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'serverType must be Jellyfin or Emby.');
  });

  it('creates the canonical owner during initial Jellyfin setup', async (t) => {
    const userRepository = getRepository(User);
    await userRepository.clear();
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.jellyfin.ip = '';
    const previousPrivateSetup = process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
    process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = 'true';
    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => ({
      User: {
        Id: '00112233445566778899aabbccddeeff',
        Name: 'bootstrap-jellyfin-owner',
        ServerId: 'bootstrap-server',
        ServerName: 'Bootstrap Server',
        Configuration: { GroupedFolders: [] },
        Policy: { IsAdministrator: true },
      },
      AccessToken: 'bootstrap-access-token',
    }));
    const tokenMock = mock.method(
      JellyfinAPI.prototype,
      'createApiToken',
      async () => 'bootstrap-api-key'
    );
    const nameMock = mock.method(
      JellyfinAPI.prototype,
      'getServerName',
      async () => 'Bootstrap Server'
    );
    t.after(() => {
      loginMock.mock.restore();
      tokenMock.mock.restore();
      nameMock.mock.restore();
      if (previousPrivateSetup === undefined) {
        delete process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
      } else {
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = previousPrivateSetup;
      }
    });

    const response = await request(app).post('/auth/jellyfin').send({
      username: 'bootstrap-jellyfin-owner',
      password: 'bootstrap-password',
      email: 'bootstrap-jellyfin-owner@seerr.dev',
      hostname: '127.0.0.1',
      port: 8096,
      useSsl: false,
      serverType: MediaServerType.JELLYFIN,
    });

    assert.strictEqual(response.status, 200);
    const users = await userRepository.find();
    assert.strictEqual(users.length, 1);
    assert.strictEqual(users[0].id, 1);
    assert.strictEqual(users[0].permissions, Permission.ADMIN);
    assert.strictEqual(
      users[0].jellyfinUserId,
      '00112233445566778899aabbccddeeff'
    );
    assert.strictEqual(settings.jellyfin.apiKey, 'bootstrap-api-key');
  });

  it('admits only one concurrent Jellyfin bootstrap configuration', async (t) => {
    const userRepository = getRepository(User);
    await userRepository.clear();
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.jellyfin.ip = '';
    const previousPrivateSetup = process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
    process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = 'true';
    let loginCalls = 0;
    let releaseLogins!: () => void;
    const loginsStarted = new Promise<void>((resolve) => {
      releaseLogins = resolve;
    });
    const loginMock = mock.method(
      JellyfinAPI.prototype,
      'login',
      async (username: string) => {
        loginCalls += 1;
        if (loginCalls === 2) releaseLogins();
        await loginsStarted;
        const first = username === 'first-bootstrap-admin';
        return {
          User: {
            Id: first
              ? '00112233445566778899aabbccddeeff'
              : 'ffeeddccbbaa99887766554433221100',
            Name: username,
            ServerId: first ? 'first-server' : 'second-server',
            ServerName: first ? 'First Server' : 'Second Server',
            Configuration: { GroupedFolders: [] },
            Policy: { IsAdministrator: true },
          },
          AccessToken: first ? 'first-token' : 'second-token',
        };
      }
    );
    const tokenMock = mock.method(
      JellyfinAPI.prototype,
      'createApiToken',
      async () => 'bootstrap-api-key'
    );
    const nameMock = mock.method(
      JellyfinAPI.prototype,
      'getServerName',
      async () => 'First Server'
    );
    t.after(() => {
      loginMock.mock.restore();
      tokenMock.mock.restore();
      nameMock.mock.restore();
      if (previousPrivateSetup === undefined) {
        delete process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
      } else {
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = previousPrivateSetup;
      }
    });

    const responses = await Promise.all(
      ['first-bootstrap-admin', 'second-bootstrap-admin'].map((username) =>
        request(app)
          .post('/auth/jellyfin')
          .send({
            username,
            password: 'bootstrap-password',
            email: `${username}@seerr.dev`,
            hostname: '127.0.0.1',
            port: 8096,
            useSsl: false,
            serverType: MediaServerType.JELLYFIN,
          })
      )
    );

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 409]
    );
    assert.strictEqual(await userRepository.count(), 1);
    const owner = await userRepository.findOneByOrFail({ id: 1 });
    assert.strictEqual(owner.permissions, Permission.ADMIN);
    assert.strictEqual(settings.main.mediaServerType, MediaServerType.JELLYFIN);
    assert.strictEqual(tokenMock.mock.callCount(), 1);
  });

  it('allows the canonical Jellyfin owner to recover a failed settings write', async (t) => {
    const userRepository = getRepository(User);
    await userRepository.clear();
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.jellyfin.ip = '';
    const previousPrivateSetup = process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
    process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = 'true';
    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => ({
      User: {
        Id: '11223344556677889900aabbccddeeff',
        Name: 'recoverable-jellyfin-owner',
        ServerId: 'recoverable-server',
        ServerName: 'Recoverable Server',
        Configuration: { GroupedFolders: [] },
        Policy: { IsAdministrator: true },
      },
      AccessToken: 'recoverable-access-token',
    }));
    const tokenMock = mock.method(
      JellyfinAPI.prototype,
      'createApiToken',
      async () => 'recoverable-api-key'
    );
    const nameMock = mock.method(
      JellyfinAPI.prototype,
      'getServerName',
      async () => 'Recoverable Server'
    );
    const persistMock = mock.method(settings, 'persistChanges', async () => {
      throw new Error('Disk write failed');
    });
    t.after(() => {
      loginMock.mock.restore();
      tokenMock.mock.restore();
      nameMock.mock.restore();
      persistMock.mock.restore();
      if (previousPrivateSetup === undefined) {
        delete process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
      } else {
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = previousPrivateSetup;
      }
    });
    const payload = {
      username: 'recoverable-jellyfin-owner',
      password: 'recoverable-password',
      email: 'recoverable-jellyfin-owner@seerr.dev',
      hostname: '127.0.0.1',
      port: 8096,
      useSsl: false,
      serverType: MediaServerType.JELLYFIN,
    };

    const failed = await request(app).post('/auth/jellyfin').send(payload);
    assert.strictEqual(failed.status, 500);
    assert.strictEqual((await userRepository.find()).length, 1);
    assert.strictEqual(
      settings.main.mediaServerType,
      MediaServerType.NOT_CONFIGURED
    );

    persistMock.mock.restore();
    const retried = await request(app).post('/auth/jellyfin').send(payload);
    assert.strictEqual(retried.status, 200);
    assert.strictEqual(settings.main.mediaServerType, MediaServerType.JELLYFIN);
    assert.strictEqual(settings.jellyfin.apiKey, 'recoverable-api-key');
  });

  it('requires an authenticated administrator to configure an existing instance', async (t) => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.jellyfin.ip = '';
    const previousPrivateSetup = process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
    process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = 'true';

    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => ({
      User: {
        Id: 'ffeeddccbbaa99887766554433221100',
        Name: 'attacker-admin',
        ServerId: 'attacker-server',
        ServerName: 'Attacker Server',
        Configuration: { GroupedFolders: [] },
        Policy: { IsAdministrator: true },
      },
      AccessToken: 'attacker-token',
    }));
    t.after(() => {
      loginMock.mock.restore();
      if (previousPrivateSetup === undefined) {
        delete process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
      } else {
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = previousPrivateSetup;
      }
    });

    const adminBefore = await getRepository(User).findOneByOrFail({ id: 1 });
    const res = await request(app).post('/auth/jellyfin').send({
      username: 'attacker-admin',
      password: 'attacker-password',
      hostname: '127.0.0.1',
      port: 8096,
      useSsl: false,
      serverType: MediaServerType.JELLYFIN,
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /authenticated administrator/i);

    const adminAfter = await getRepository(User).findOneByOrFail({ id: 1 });
    assert.strictEqual(adminAfter.email, adminBefore.email);
    assert.strictEqual(adminAfter.jellyfinUserId, adminBefore.jellyfinUserId);
  });

  it('revalidates administrator authority before existing-instance setup', async (t) => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.jellyfin.ip = '';
    const previousPrivateSetup = process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
    process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = 'true';
    const userRepository = getRepository(User);
    let providerLoginStarted!: () => void;
    let revocationAdmitted!: () => void;
    const providerLoginStartedPromise = new Promise<void>((resolve) => {
      providerLoginStarted = resolve;
    });
    const revocationAdmittedPromise = new Promise<void>((resolve) => {
      revocationAdmitted = resolve;
    });
    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => {
      providerLoginStarted();
      return {
        User: {
          Id: 'abcdefabcdefabcdefabcdefabcdefab',
          Name: 'replacement-owner',
          ServerId: 'replacement-server',
          ServerName: 'Replacement Server',
          Configuration: { GroupedFolders: [] },
          Policy: { IsAdministrator: true },
        },
        AccessToken: 'replacement-token',
      };
    });
    t.after(() => {
      loginMock.mock.restore();
      if (previousPrivateSetup === undefined) {
        delete process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS;
      } else {
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS = previousPrivateSetup;
      }
    });

    const revocation = runUserSecurityMutation(1, async () => {
      revocationAdmitted();
      await providerLoginStartedPromise;
      await userRepository.update(1, { permissions: Permission.REQUEST });
    });
    await revocationAdmittedPromise;
    const responsePromise = agent
      .post('/auth/jellyfin')
      .send({
        username: 'replacement-owner',
        password: 'replacement-password',
        hostname: '127.0.0.1',
        port: 8096,
        useSsl: false,
        serverType: MediaServerType.JELLYFIN,
      })
      .then((response) => response);

    await revocation;
    const response = await responsePromise;
    assert.strictEqual(response.status, 403);
    assert.match(response.body.error, /authenticated administrator/i);
    assert.strictEqual(loginMock.mock.callCount(), 1);
    assert.strictEqual(settings.jellyfin.ip, '');
  });
});

describe('POST /auth/local', () => {
  beforeEach(() => {
    const settings = getSettings();
    settings.main.localLogin = true;
  });

  it('rejects malformed local login bodies before credential lookup', async () => {
    const res = await request(app).post('/auth/local').send([]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Request body must be an object.');
  });

  it('returns 200 and user data on valid credentials', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    // filter() strips sensitive fields like password
    assert.ok(!('password' in res.body));
  });

  it('returns 403 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'wrongpassword' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('blocks distributed password guessing without locking out the valid password', async () => {
    for (let attempt = 0; attempt < LOCAL_LOGIN_FAILURE_LIMIT; attempt++) {
      const failed = await request(app)
        .post('/auth/local')
        .send({ email: 'admin@seerr.dev', password: 'wrongpassword' });
      assert.strictEqual(failed.status, 403);
    }

    const blockedGuess = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'anotherwrongpassword' });
    assert.strictEqual(blockedGuess.status, 403);

    const recovered = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(recovered.status, 200);

    const userRepository = getRepository(User);
    const throttled = await userRepository
      .createQueryBuilder('user')
      .addSelect([
        'user.failedLoginAttempts',
        'user.lastFailedLoginAt',
        'user.loginBlockedUntil',
      ])
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(throttled.failedLoginAttempts, 0);
    assert.strictEqual(throttled.lastFailedLoginAt, null);
    assert.strictEqual(throttled.loginBlockedUntil, null);
  });

  it('counts concurrent password failures without lost updates', async () => {
    const failures = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app)
          .post('/auth/local')
          .send({ email: 'admin@seerr.dev', password: 'wrongpassword' })
      )
    );
    failures.forEach((response) => assert.strictEqual(response.status, 403));

    const user = await getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.failedLoginAttempts')
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(user.failedLoginAttempts, 3);
  });

  it('does not clear hidden throttle state during unrelated user saves', async () => {
    const failed = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'wrongpassword' });
    assert.strictEqual(failed.status, 403);

    const userRepository = getRepository(User);
    const ordinaryUser = await userRepository.findOneByOrFail({ id: 1 });
    assert.strictEqual(ordinaryUser.failedLoginAttempts, undefined);
    ordinaryUser.username = 'Unrelated profile update';
    await userRepository.save(ordinaryUser);

    const throttled = await userRepository
      .createQueryBuilder('user')
      .addSelect('user.failedLoginAttempts')
      .where('user.id = :id', { id: 1 })
      .getOneOrFail();
    assert.strictEqual(throttled.failedLoginAttempts, 1);
  });

  it('returns 403 for nonexistent user', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'nobody@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns 403 when local login is disabled', async () => {
    const settings = getSettings();
    settings.main.localLogin = false;

    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, 'Password sign-in is disabled.');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ password: 'test1234' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /email address and a password/);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /email address and a password/);
  });

  it('is case-insensitive for email', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'Admin@Seerr.Dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('allows the non-admin user to log in', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'friend@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('sets a session on successful login', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    // Session should persist — /me should succeed
    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 when not logged in', async () => {
    const res = await request(app).post('/auth/logout');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  it('destroys session and returns 200 when logged in', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    // Verify session is active
    const meBeforeRes = await agent.get('/auth/me');
    assert.strictEqual(meBeforeRes.status, 200);

    const logoutRes = await agent.post('/auth/logout');
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.status, 'ok');

    // Session should be invalidated — /me should fail
    const meAfterRes = await agent.get('/auth/me');
    assert.strictEqual(meAfterRes.status, 403);
  });

  it('destroys the local session before remote device cleanup completes', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    settings.jellyfin.ip = 'jellyfin.example.com';
    settings.jellyfin.port = 8096;
    settings.jellyfin.useSsl = false;
    settings.jellyfin.apiKey = 'logout-cleanup-api-key';
    await getRepository(User).update(1, {
      jellyfinUserId: '0123456789abcdef0123456789abcdef',
      jellyfinDeviceId: 'logout-device-id',
    });
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');
    let cleanupStarted!: () => void;
    const cleanupStartedPromise = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    let releaseCleanup!: () => void;
    const releaseCleanupPromise = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let deletedDeviceId: string | undefined;
    const deleteMock = mock.method(
      axios,
      'delete',
      async (
        _url: string,
        config?: { params?: { Id?: string } }
      ): Promise<{ status: number }> => {
        deletedDeviceId = config?.params?.Id;
        cleanupStarted();
        await releaseCleanupPromise;
        return { status: 204 };
      }
    );

    const logoutPromise = agent
      .post('/auth/logout')
      .then((response) => response);
    let timeout: NodeJS.Timeout | undefined;
    let identityRotation: Promise<void> | undefined;
    let identityRotationAdmitted = false;
    try {
      await cleanupStartedPromise;
      identityRotation = runUserSecurityMutation(1, async () => {
        identityRotationAdmitted = true;
        await getRepository(User).update(1, {
          jellyfinDeviceId: 'rotated-logout-device-id',
        });
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(identityRotationAdmitted, false);
      const logoutResponse = await Promise.race([
        logoutPromise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Local logout waited for remote cleanup.')),
            500
          );
        }),
      ]);

      assert.strictEqual(logoutResponse.status, 200);
      assert.strictEqual((await agent.get('/auth/me')).status, 403);
      assert.strictEqual(deletedDeviceId, 'logout-device-id');
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseCleanup();
      await waitForBackgroundTasks();
      await identityRotation;
      assert.strictEqual(identityRotationAdmitted, true);
      deleteMock.mock.restore();
    }
  });
});

describe('POST /auth/reset-password', () => {
  beforeEach(() => {
    emailMock.resetCalls();
    getSettings().main.applicationUrl = 'https://seerr.example';
    getSettings().notifications.agents.email.enabled = true;
  });

  it('rejects reset requests uniformly when email delivery is unavailable', async () => {
    getSettings().main.applicationUrl = '';

    const [known, unknown] = await Promise.all([
      request(app)
        .post('/auth/reset-password')
        .send({ email: 'admin@seerr.dev' }),
      request(app)
        .post('/auth/reset-password')
        .send({ email: 'unknown@seerr.dev' }),
    ]);

    assert.deepEqual([known.status, unknown.status], [503, 503]);
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('rejects malformed reset requests before user lookup', async () => {
    const res = await request(app).post('/auth/reset-password').send([]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Request body must be an object.');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('returns before SMTP delivery completes', async () => {
    let releaseDelivery: (() => void) | undefined;
    emailMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve;
        })
    );

    const responsePromise = request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    let timeout: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      responsePromise.then((response) => ({ response })),
      new Promise<{ timeout: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ timeout: true }), 500);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }

    for (let attempt = 0; attempt < 200 && !releaseDelivery; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    const deliveryStarted = releaseDelivery !== undefined;

    const duplicateResponse = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    assert.strictEqual(duplicateResponse.status, 200);
    assert.strictEqual(emailMock.callCount(), 1);
    const pendingUser = await getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordDeliveryPending')
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(pendingUser.resetPasswordDeliveryPending, true);

    // Hidden delivery state must survive ordinary saves of entities loaded
    // without the select:false column.
    const ordinaryUser = await getRepository(User).findOneByOrFail({
      id: pendingUser.id,
    });
    ordinaryUser.avatar = 'updated-while-delivery-is-pending';
    await getRepository(User).save(ordinaryUser);
    const afterOrdinarySave = await getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordDeliveryPending')
      .where('user.id = :id', { id: pendingUser.id })
      .getOneOrFail();
    assert.strictEqual(afterOrdinarySave.resetPasswordDeliveryPending, true);

    releaseDelivery?.();
    const completedResponse = await responsePromise;
    await waitForPendingPasswordResetDeliveries();

    assert.ok(deliveryStarted, 'SMTP delivery did not start');
    assert.ok('response' in outcome, 'response waited for SMTP delivery');
    assert.strictEqual(completedResponse.status, 200);
    assert.strictEqual(emailMock.callCount(), 1);
    const deliveredUser = await getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordDeliveryPending')
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(deliveredUser.resetPasswordDeliveryPending, false);
  });

  it('bounds concurrent live password reset deliveries', async (t) => {
    const userRepository = getRepository(User);
    const emails = Array.from(
      { length: PASSWORD_RESET_DELIVERY_CONCURRENCY + 2 },
      (_, index) => `reset-fanout-${index}@seerr.dev`
    );
    await userRepository.save(
      emails.map(
        (email, index) =>
          new User({
            email,
            username: `reset-fanout-${index}`,
            avatar: '',
            permissions: Permission.REQUEST,
            plexToken: '',
            userType: UserType.LOCAL,
          })
      )
    );
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];
    emailMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        })
    );
    t.after(() => {
      emailMock.mockImplementation(async () => undefined);
    });

    const responses = await Promise.all(
      emails.map((email) =>
        request(app).post('/auth/reset-password').send({ email })
      )
    );
    assert.ok(responses.every((response) => response.status === 200));
    assert.strictEqual(
      emailMock.callCount(),
      PASSWORD_RESET_DELIVERY_CONCURRENCY
    );

    while (emailMock.callCount() < emails.length) {
      releases.shift()?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (const release of releases) {
      release();
    }
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(emailMock.callCount(), emails.length);
    assert.strictEqual(maximumActive, PASSWORD_RESET_DELIVERY_CONCURRENCY);
  });

  it('delivers durable reset work rejected during queue saturation', async (t) => {
    const userRepository = getRepository(User);
    const total =
      PASSWORD_RESET_DELIVERY_CONCURRENCY +
      MAX_PASSWORD_RESET_DELIVERY_QUEUE +
      1;
    const emails = Array.from(
      { length: total },
      (_, index) => `reset-saturation-${index}@seerr.dev`
    );
    await userRepository.save(
      emails.map(
        (email, index) =>
          new User({
            email,
            username: `reset-saturation-${index}`,
            avatar: '',
            permissions: Permission.REQUEST,
            plexToken: '',
            userType: UserType.LOCAL,
          })
      )
    );
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];
    emailMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        })
    );
    t.after(() => {
      for (const release of releases) {
        release();
      }
      emailMock.mockImplementation(async () => undefined);
    });

    const responses = await Promise.all(
      emails.map((email) =>
        request(app).post('/auth/reset-password').send({ email })
      )
    );
    assert.ok(responses.every((response) => response.status === 200));
    assert.strictEqual(
      emailMock.callCount(),
      PASSWORD_RESET_DELIVERY_CONCURRENCY
    );

    for (let attempt = 0; attempt < total * 4; attempt += 1) {
      releases.shift()?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (emailMock.callCount() === total && active === 0) {
        break;
      }
    }
    await waitForPendingPasswordResetDeliveries();
    await waitForBackgroundTasks();

    assert.strictEqual(emailMock.callCount(), total);
    assert.strictEqual(active, 0);
    assert.strictEqual(maximumActive, PASSWORD_RESET_DELIVERY_CONCURRENCY);
    assert.strictEqual(
      await userRepository
        .createQueryBuilder('user')
        .where('user.email IN (:...emails)', { emails })
        .andWhere('user.resetPasswordDeliveryPending = :pending', {
          pending: true,
        })
        .getCount(),
      0
    );
  });

  it('resumes a durable pending reset delivery after restart', async () => {
    const userRepository = getRepository(User);
    const expiration = new Date(Date.now() + 60_000);
    await userRepository.update(
      { email: 'admin@seerr.dev' },
      {
        resetPasswordGuid: 'pending-reset-token',
        recoveryLinkExpirationDate: expiration,
        resetPasswordDeliveryPending: true,
      }
    );

    await resumePendingPasswordResetDeliveries();
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(emailMock.callCount(), 1);
    const user = await userRepository
      .createQueryBuilder('user')
      .addSelect([
        'user.resetPasswordGuid',
        'user.resetPasswordDeliveryPending',
      ])
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(user.resetPasswordGuid, 'pending-reset-token');
    assert.strictEqual(user.resetPasswordDeliveryPending, false);
  });

  it('coalesces concurrent startup recovery of the same reset delivery', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(
      { email: 'admin@seerr.dev' },
      {
        resetPasswordGuid: 'concurrent-pending-reset-token',
        recoveryLinkExpirationDate: new Date(Date.now() + 60_000),
        resetPasswordDeliveryPending: true,
      }
    );
    let releaseDelivery: (() => void) | undefined;
    emailMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve;
        })
    );

    const recoveries = Promise.all([
      resumePendingPasswordResetDeliveries(),
      resumePendingPasswordResetDeliveries(),
    ]);
    for (let attempt = 0; attempt < 200 && !releaseDelivery; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(releaseDelivery, 'reset delivery did not start');
    assert.strictEqual(emailMock.callCount(), 1);

    releaseDelivery();
    await recoveries;

    assert.strictEqual(emailMock.callCount(), 1);
    const user = await userRepository
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordDeliveryPending')
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(user.resetPasswordDeliveryPending, false);
  });

  it('discards expired pending reset deliveries on restart', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(
      { email: 'admin@seerr.dev' },
      {
        resetPasswordGuid: 'expired-pending-token',
        recoveryLinkExpirationDate: new Date(Date.now() - 60_000),
        resetPasswordDeliveryPending: true,
      }
    );

    await resumePendingPasswordResetDeliveries();
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(emailMock.callCount(), 0);
    const user = await userRepository
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordDeliveryPending')
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();
    assert.strictEqual(user.resetPasswordDeliveryPending, false);
  });

  it('returns 200 for a valid email', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 1);
  });

  it('returns 200 for nonexistent email (does not reveal user existence)', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'nonexistent@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('returns 500 when email is missing', async () => {
    const res = await request(app).post('/auth/reset-password').send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Email address required.');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('sets a resetPasswordGuid on the user', async () => {
    await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect(['user.resetPasswordGuid', 'user.recoveryLinkExpirationDate'])
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();

    assert.notStrictEqual(user.resetPasswordGuid, undefined);
    assert.notStrictEqual(user.resetPasswordGuid, null);
    assert.notStrictEqual(user.recoveryLinkExpirationDate, undefined);
    assert.strictEqual(emailMock.callCount(), 1);
  });

  it('preserves an existing recovery link when email delivery fails', async () => {
    const userRepo = getRepository(User);
    const user = await userRepo.findOneByOrFail({ email: 'admin@seerr.dev' });
    const previousExpiration = new Date(Date.now() + 60_000);
    user.resetPasswordGuid = 'previously-delivered-token';
    user.recoveryLinkExpirationDate = previousExpiration;
    await userRepo.save(user);
    emailMock.mockImplementationOnce(async () => {
      throw new Error('mail transport unavailable');
    });

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();

    assert.strictEqual(res.status, 200);
    const persisted = await userRepo.findOneOrFail({
      where: { id: user.id },
      select: ['id', 'resetPasswordGuid', 'recoveryLinkExpirationDate'],
    });
    assert.strictEqual(
      persisted.resetPasswordGuid,
      'previously-delivered-token'
    );
    assert.strictEqual(
      persisted.recoveryLinkExpirationDate?.getTime(),
      previousExpiration.getTime()
    );
  });

  it('sends only one valid link for concurrent reset requests', async () => {
    const responses = await Promise.all([
      request(app)
        .post('/auth/reset-password')
        .send({ email: 'admin@seerr.dev' }),
      request(app)
        .post('/auth/reset-password')
        .send({ email: 'admin@seerr.dev' }),
    ]);
    await waitForPendingPasswordResetDeliveries();

    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200]
    );
    assert.strictEqual(emailMock.callCount(), 1);

    const user = await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
      select: ['id', 'resetPasswordGuid', 'recoveryLinkExpirationDate'],
    });
    assert.ok(user.resetPasswordGuid);
    assert.ok(user.recoveryLinkExpirationDate);
  });

  it('reuses an unexpired recovery token instead of invalidating emailed links', async () => {
    const userRepository = getRepository(User);
    await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();
    const first = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
      select: ['id', 'resetPasswordGuid', 'recoveryLinkExpirationDate'],
    });

    await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });
    await waitForPendingPasswordResetDeliveries();
    const second = await userRepository.findOneOrFail({
      where: { id: first.id },
      select: ['id', 'resetPasswordGuid', 'recoveryLinkExpirationDate'],
    });

    assert.ok(first.resetPasswordGuid);
    assert.strictEqual(second.resetPasswordGuid, first.resetPasswordGuid);
    assert.strictEqual(
      second.recoveryLinkExpirationDate?.getTime(),
      first.recoveryLinkExpirationDate?.getTime()
    );
    assert.strictEqual(emailMock.callCount(), 2);
  });
});

describe('POST /auth/reset-password/:guid', () => {
  /** Trigger a password reset and return the guid. */
  async function getResetGuid(email: string): Promise<string> {
    getSettings().main.applicationUrl = 'https://seerr.example';
    getSettings().notifications.agents.email.enabled = true;
    await request(app).post('/auth/reset-password').send({ email });
    await waitForPendingPasswordResetDeliveries();

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordGuid')
      .where('user.email = :email', { email })
      .getOneOrFail();

    return user.resetPasswordGuid!;
  }

  it('resets password with a valid guid and password', async () => {
    const guid = await getResetGuid('admin@seerr.dev');
    await getRepository(User).update(
      { email: 'admin@seerr.dev' },
      {
        failedLoginAttempts: LOCAL_LOGIN_FAILURE_LIMIT,
        lastFailedLoginAt: new Date(),
        loginBlockedUntil: new Date(Date.now() + LOCAL_LOGIN_FAILURE_WINDOW_MS),
      }
    );

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');

    // Old password no longer works
    const oldLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(oldLogin.status, 403);

    // New password works
    const newLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'newpassword123' });
    assert.strictEqual(newLogin.status, 200);
  });

  it('returns 500 for an invalid guid', async () => {
    const res = await request(app)
      .post('/auth/reset-password/invalid-guid-here')
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('rejects oversized reset guids before lookup', async () => {
    const res = await request(app)
      .post(`/auth/reset-password/${'x'.repeat(65)}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('returns 500 when password is too short', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'short' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('never writes password reset bearer tokens to logs', async () => {
    const infoMock = mock.method(logger, 'info', () => logger).mock;
    const warnMock = mock.method(logger, 'warn', () => logger).mock;

    try {
      const guid = await getResetGuid('admin@seerr.dev');

      const invalid = await request(app)
        .post(`/auth/reset-password/${guid}`)
        .send({ password: 'short' });
      const valid = await request(app)
        .post(`/auth/reset-password/${guid}`)
        .send({ password: 'newpassword123' });

      assert.strictEqual(invalid.status, 500);
      assert.strictEqual(valid.status, 200);
      for (const call of [...infoMock.calls, ...warnMock.calls]) {
        assert.doesNotMatch(JSON.stringify(call.arguments), new RegExp(guid));
      }
    } finally {
      infoMock.restore();
      warnMock.restore();
    }
  });

  it('returns 500 when password is missing', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('rejects malformed reset confirmation bodies before password validation', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Request body must be an object.');
  });

  it('returns 500 for an expired recovery link', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // Expire the link
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.recoveryLinkExpirationDate = new Date('2020-01-01');
    await userRepo.save(user);

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('cannot reuse a guid after successful reset', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // First reset succeeds
    const first = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });
    assert.strictEqual(first.status, 200);

    // Second reset with same guid fails (recoveryLinkExpirationDate was cleared)
    const second = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'anotherpassword' });
    assert.strictEqual(second.status, 500);
  });

  it('allows only one concurrent reset to consume a guid', async () => {
    const guid = await getResetGuid('admin@seerr.dev');
    const passwords = ['concurrent-password-one', 'concurrent-password-two'];

    const responses = await Promise.all(
      passwords.map((password) =>
        request(app).post(`/auth/reset-password/${guid}`).send({ password })
      )
    );

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 500]
    );

    const persisted = await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
      select: ['id', 'password'],
    });
    const matchingPasswords = await Promise.all(
      passwords.map((password) => persisted.passwordMatch(password))
    );
    assert.strictEqual(
      matchingPasswords.filter(Boolean).length,
      1,
      'exactly one concurrent password must become active'
    );
  });
});

describe('OpenID Connect', () => {
  it('bounds OIDC provider requests', () => {
    assert.strictEqual(OIDC_HTTP_TIMEOUT_SECONDS, 10);
  });

  const OIDC_REDIRECT_URL = 'https://jellyseerr.example.com/login';

  // Default claims for new user registration tests
  const DEFAULT_CLAIMS = {
    sub: 'new-user-sub',
    email: 'newuser@example.com',
    email_verified: true,
  };

  // Claims for existing seeded user (friend@seerr.dev)
  const EXISTING_USER_CLAIMS = {
    sub: 'friend-oidc-sub',
    email: 'friend@seerr.dev',
  };

  function buildMockWellKnown(options?: { supportsPKCE?: boolean }) {
    return {
      issuer: 'https://example.com',
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
      userinfo_endpoint: 'https://example.com/userinfo',
      jwks_uri: 'https://example.com/.well-known/jwks.json',
      response_types_supported: [
        'code',
        'token',
        'id_token',
        'code token',
        'code id_token',
        'token id_token',
        'code token id_token',
        'none',
      ],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
      ...(options?.supportsPKCE
        ? { code_challenge_methods_supported: ['S256'] }
        : {}),
    };
  }

  /**
   * Performs the login + callback flow and returns the callback response.
   */
  async function performOidcCallback(
    agent?: ReturnType<typeof request.agent>,
    afterLogin?: () => void | Promise<void>
  ) {
    const client = agent ?? request(app);
    const loginResponse = await client
      .get('/auth/oidc/login/test')
      .set('Accept', 'application/json');

    assert.strictEqual(loginResponse.status, 200);

    const redirectUrl = new URL(loginResponse.body.redirectUrl);
    const state = redirectUrl.searchParams.get('state');
    const nonce = redirectUrl.searchParams.get('nonce');
    expectedNonce = nonce;

    const cookies = loginResponse.get('Set-Cookie');
    assert.notStrictEqual(cookies, undefined);
    const cookieHeader = cookies!.map((c) => c.split(';')[0]).join('; ');

    const callbackUrl = new URL(OIDC_REDIRECT_URL);
    callbackUrl.searchParams.set('code', '123456');
    if (state) callbackUrl.searchParams.set('state', state);

    await afterLogin?.();

    const response = await client
      .post('/auth/oidc/callback/test')
      .set('Accept', 'application/json')
      .set('Cookie', cookieHeader)
      .send({ callbackUrl: callbackUrl.toString() });

    return response;
  }

  let mockJwks: { keys: object[] };
  let signIdToken: (claims?: Record<string, unknown>) => Promise<string>;
  let expectedNonce: string | null = null;

  before(async () => {
    const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    mockJwks = { keys: [jwk] };

    signIdToken = (claims?: Record<string, unknown>) =>
      new SignJWT({ ...DEFAULT_CLAIMS, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://example.com')
        .setAudience('jellyseerr')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
  });

  beforeEach(() => {
    // configure test provider settings
    getSettings().load({
      main: {
        oidcLogin: true,
        applicationUrl: new URL(OIDC_REDIRECT_URL).origin,
      },
      oidc: {
        providers: [
          {
            slug: 'test',
            name: 'Test Provider',
            clientId: 'jellyseerr',
            clientSecret: 'abcdefg',
            issuerUrl: 'https://example.com',
            newUserLogin: true,
          },
        ],
      },
    });
  });

  async function setupFetchMock(options?: {
    supportsPKCE?: boolean;
    userinfoResponse?: Record<string, unknown>;
    idTokenClaims?: Record<string, unknown>;
    onUserInfo?: () => void | Promise<void>;
  }) {
    const wellKnown = buildMockWellKnown(options);
    const userinfo = options?.userinfoResponse ?? DEFAULT_CLAIMS;
    const idTokenClaims = options?.idTokenClaims;

    fetchMock.mockGlobal();
    // Clear any routes from a previous setup call so re-registering with new
    // claims (e.g. existing-user vs. new-user fixtures) actually takes effect;
    // fetch-mock keeps the first matching route otherwise.
    fetchMock.removeRoutes({ includeSticky: true });

    fetchMock.route(
      'https://example.com/.well-known/openid-configuration',
      wellKnown
    );
    fetchMock.route('https://example.com/.well-known/jwks.json', mockJwks);
    fetchMock.route('https://example.com/oauth/token', async () => ({
      access_token: 'abcdefg',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: await signIdToken({
        ...idTokenClaims,
        nonce: expectedNonce,
      }),
    }));
    fetchMock.route('https://example.com/userinfo', async () => {
      await options?.onUserInfo?.();
      return userinfo;
    });
  }

  describe('without PKCE support (uses state)', function () {
    before(async () => {
      await setupFetchMock({ supportsPKCE: false });
    });

    after(() => {
      fetchMock.hardReset();
    });

    it('login endpoint produces correct redirect URL', async function () {
      const response = await request(app)
        .get('/auth/oidc/login/test')
        .set('Accept', 'application/json');

      assert.match(response.headers['content-type'], /json/);
      assert.strictEqual(response.status, 200);
      assert.match(
        response.body.redirectUrl,
        /^https:\/\/example.com\/oauth\/authorize\?/
      );

      const params = new URL(response.body.redirectUrl);
      assert.strictEqual(params.searchParams.get('response_type'), 'code');
      assert.strictEqual(params.searchParams.get('client_id'), 'jellyseerr');
      assert.strictEqual(
        params.searchParams.get('scope'),
        'openid profile email'
      );
      assert.strictEqual(
        params.searchParams.get('redirect_uri'),
        OIDC_REDIRECT_URL
      );
      assert.ok(params.searchParams.get('state'));
      assert.ok(params.searchParams.get('nonce'));

      const correlationCookie = response
        .get('Set-Cookie')
        ?.find((cookie) => cookie.startsWith('oidc-correlation-'));
      assert.ok(correlationCookie);
      assert.match(
        correlationCookie,
        /(?:^|;) Path=\/api\/v1\/auth\/oidc(?:;|$)/
      );
    });

    it('restricts redirect URIs to known callback pages', async function () {
      const accepted = await request(app)
        .get('/auth/oidc/login/test')
        .query({ returnUrl: '/profile/settings/linked-accounts' });
      const rejectedPath = await request(app)
        .get('/auth/oidc/login/test')
        .query({ returnUrl: '/settings/main' });
      const rejectedOrigin = await request(app)
        .get('/auth/oidc/login/test')
        .query({ returnUrl: 'https://attacker.example/callback' });

      assert.strictEqual(
        new URL(accepted.body.redirectUrl).searchParams.get('redirect_uri'),
        'https://jellyseerr.example.com/profile/settings/linked-accounts'
      );
      assert.strictEqual(
        new URL(rejectedPath.body.redirectUrl).searchParams.get('redirect_uri'),
        OIDC_REDIRECT_URL
      );
      assert.strictEqual(
        new URL(rejectedOrigin.body.redirectUrl).searchParams.get(
          'redirect_uri'
        ),
        OIDC_REDIRECT_URL
      );
    });

    it('never derives an OIDC redirect URI from an attacker-controlled host', async function () {
      getSettings().main.applicationUrl = '';

      const response = await request(app)
        .get('/auth/oidc/login/test')
        .set('Host', 'attacker.example');

      assert.strictEqual(response.status, 503);
      assert.strictEqual(
        JSON.stringify(response.body).includes('attacker.example'),
        false
      );
      assert.strictEqual(response.get('Set-Cookie'), undefined);
    });

    it('rejects callbacks after the authorization context changes', async function () {
      await setupFetchMock({ supportsPKCE: false });

      const response = await performOidcCallback(undefined, () => {
        getSettings().oidc.providers[0].scopes = 'openid email';
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
    });

    it('callback endpoint successfully authorizes existing user', async function () {
      // Link the seeded friend user to the OIDC provider
      const userRepo = getRepository(User);
      const linkedAccountRepo = getRepository(LinkedAccount);

      const user = await userRepo.findOneOrFail({
        where: { email: 'friend@seerr.dev' },
      });

      const linkedAccount = new LinkedAccount({
        user,
        provider: 'test',
        sub: EXISTING_USER_CLAIMS.sub,
        username: 'friend',
      });
      await linkedAccountRepo.save(linkedAccount);

      // Setup mock to return the existing user's claims
      await setupFetchMock({
        supportsPKCE: false,
        idTokenClaims: EXISTING_USER_CLAIMS,
        userinfoResponse: EXISTING_USER_CLAIMS,
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 204);
      const clearedCorrelationCookie = response
        .get('Set-Cookie')
        ?.find((cookie) => cookie.startsWith('oidc-correlation-'));
      assert.ok(clearedCorrelationCookie);
      assert.match(
        clearedCorrelationCookie,
        /(?:^|;) Path=\/api\/v1\/auth\/oidc(?:;|$)/
      );
    });
  });

  describe('with PKCE support (uses state and PKCE)', function () {
    before(async () => {
      await setupFetchMock({ supportsPKCE: true });
    });

    after(() => {
      fetchMock.hardReset();
    });

    it('login endpoint includes both state and PKCE parameters', async function () {
      const response = await request(app)
        .get('/auth/oidc/login/test')
        .set('Accept', 'application/json');

      assert.strictEqual(response.status, 200);

      const params = new URL(response.body.redirectUrl);
      assert.ok(params.searchParams.get('state'));
      assert.ok(params.searchParams.get('nonce'));
      assert.ok(params.searchParams.get('code_challenge'));
      assert.strictEqual(
        params.searchParams.get('code_challenge_method'),
        'S256'
      );
    });

    it('callback endpoint successfully authorizes existing user', async function () {
      // Link the seeded friend user to the OIDC provider
      const userRepo = getRepository(User);
      const linkedAccountRepo = getRepository(LinkedAccount);

      const user = await userRepo.findOneOrFail({
        where: { email: 'friend@seerr.dev' },
      });

      const linkedAccount = new LinkedAccount({
        user,
        provider: 'test',
        sub: EXISTING_USER_CLAIMS.sub,
        username: 'friend',
      });
      await linkedAccountRepo.save(linkedAccount);

      // Setup mock to return the existing user's claims
      await setupFetchMock({
        supportsPKCE: true,
        idTokenClaims: EXISTING_USER_CLAIMS,
        userinfoResponse: EXISTING_USER_CLAIMS,
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 204);
    });
  });

  describe('new user registration', function () {
    before(async () => {
      await setupFetchMock({ supportsPKCE: false });
    });

    after(() => {
      fetchMock.hardReset();
    });

    it('creates a new user when newUserLogin is enabled', async function () {
      const settings = getSettings();
      settings.oidc.providers[0].newUserLogin = true;

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 204);

      // Verify user was created in the database
      const userRepo = getRepository(User);
      const createdUser = await userRepo.findOne({
        where: { email: DEFAULT_CLAIMS.email },
      });
      assert.notStrictEqual(createdUser, null);
      assert.strictEqual(createdUser!.email, DEFAULT_CLAIMS.email);

      // Verify linked account was created
      const linkedAccountRepo = getRepository(LinkedAccount);
      const createdLink = await linkedAccountRepo.findOne({
        where: { provider: 'test', sub: DEFAULT_CLAIMS.sub },
      });
      assert.notStrictEqual(createdLink, null);
    });

    it('rejects new user when newUserLogin is disabled', async function () {
      const settings = getSettings();
      settings.oidc.providers[0].newUserLogin = false;

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);

      // Verify no new user was created (only seeded users should exist)
      const userRepo = getRepository(User);
      const newUser = await userRepo.findOne({
        where: { email: DEFAULT_CLAIMS.email },
      });
      assert.strictEqual(newUser, null);
    });

    it('honors provider disablement while a callback is in flight', async function () {
      await setupFetchMock({
        supportsPKCE: false,
        onUserInfo: () => {
          const settings = getSettings();
          settings.replaceSection('oidc', {
            providers: settings.oidc.providers.map((provider) => ({
              ...provider,
              newUserLogin: false,
            })),
          });
        },
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(User).existsBy({ email: DEFAULT_CLAIMS.email }),
        false
      );
    });

    it('rejects a callback when provider credentials rotate in flight', async function () {
      await setupFetchMock({
        supportsPKCE: false,
        onUserInfo: () => {
          getSettings().oidc.providers[0].clientSecret = 'rotated-secret';
        },
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(User).existsBy({ email: DEFAULT_CLAIMS.email }),
        false
      );
    });

    it('rejects new user when email is missing', async function () {
      fetchMock.hardReset();

      const settings = getSettings();
      settings.oidc.providers[0].newUserLogin = true;

      // Setup mock without email in claims (explicitly set email to undefined to override DEFAULT_CLAIMS)
      await setupFetchMock({
        supportsPKCE: false,
        idTokenClaims: { sub: 'no-email-sub', email: undefined },
        userinfoResponse: { sub: 'no-email-sub' },
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, ApiErrorCode.OidcMissingEmail);
    });

    it('rejects new user when the email is not verified', async function () {
      fetchMock.hardReset();

      const settings = getSettings();
      settings.oidc.providers[0].newUserLogin = true;

      // Provider asserts an email address but has not verified ownership.
      await setupFetchMock({
        supportsPKCE: false,
        idTokenClaims: {
          sub: 'unverified-sub',
          email: 'unverified@example.com',
          email_verified: false,
        },
        userinfoResponse: {
          sub: 'unverified-sub',
          email: 'unverified@example.com',
          email_verified: false,
        },
      });

      const response = await performOidcCallback();

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);

      // No account should have been provisioned for the unverified address.
      const userRepo = getRepository(User);
      const newUser = await userRepo.findOne({
        where: { email: 'unverified@example.com' },
      });
      assert.strictEqual(newUser, null);
    });
  });

  describe('error handling', function () {
    it('rejects a callback after the provider secret rotates between requests', async function () {
      await setupFetchMock();

      const response = await performOidcCallback(undefined, () => {
        getSettings().oidc.providers[0].clientSecret = 'rotated-secret';
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(User).existsBy({ email: DEFAULT_CLAIMS.email }),
        false
      );
    });

    it('does not turn an anonymous login flow into an account link', async function () {
      await setupFetchMock({
        idTokenClaims: {
          sub: 'anonymous-flow-link-sub',
          email: 'friend@seerr.dev',
          email_verified: true,
        },
        userinfoResponse: {
          sub: 'anonymous-flow-link-sub',
          email: 'friend@seerr.dev',
          email_verified: true,
        },
      });
      const agent = request.agent(app);

      const response = await performOidcCallback(agent, async () => {
        getSettings().main.localLogin = true;
        const loginResponse = await agent
          .post('/auth/local')
          .send({ email: 'friend@seerr.dev', password: 'test1234' });
        assert.strictEqual(loginResponse.status, 200);
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(LinkedAccount).existsBy({
          provider: 'test',
          sub: 'anonymous-flow-link-sub',
        }),
        false
      );
    });

    it('does not link an OIDC flow after the authenticated actor changes', async function () {
      await setupFetchMock({
        idTokenClaims: {
          sub: 'changed-actor-link-sub',
          email: 'admin@seerr.dev',
          email_verified: true,
        },
        userinfoResponse: {
          sub: 'changed-actor-link-sub',
          email: 'admin@seerr.dev',
          email_verified: true,
        },
      });
      const agent = await authenticatedAgent('friend@seerr.dev', 'test1234');

      const response = await performOidcCallback(agent, async () => {
        const logoutResponse = await agent.post('/auth/logout');
        assert.strictEqual(logoutResponse.status, 200);
        const loginResponse = await agent
          .post('/auth/local')
          .send({ email: 'admin@seerr.dev', password: 'test1234' });
        assert.strictEqual(loginResponse.status, 200);
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(LinkedAccount).existsBy({
          provider: 'test',
          sub: 'changed-actor-link-sub',
        }),
        false
      );
    });

    it('rejects account linking after the session credential changes', async function () {
      const agent = await authenticatedAgent('friend@seerr.dev', 'test1234');
      await setupFetchMock({
        idTokenClaims: {
          sub: 'stale-session-link-sub',
          email: 'friend@seerr.dev',
          email_verified: true,
        },
        userinfoResponse: {
          sub: 'stale-session-link-sub',
          email: 'friend@seerr.dev',
          email_verified: true,
        },
        onUserInfo: async () => {
          await getRepository(User).update(
            { email: 'friend@seerr.dev' },
            { passwordChangedAt: new Date(Date.now() + 1_000) }
          );
        },
      });

      const response = await performOidcCallback(agent);

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
      assert.strictEqual(
        await getRepository(LinkedAccount).existsBy({
          provider: 'test',
          sub: 'stale-session-link-sub',
        }),
        false
      );
    });

    it('returns Unauthorized when OIDC login is disabled', async function () {
      const settings = getSettings();
      settings.main.oidcLogin = false;

      const response = await request(app)
        .get('/auth/oidc/login/test')
        .set('Accept', 'application/json');

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
    });

    it('returns Unauthorized for unknown provider', async function () {
      const response = await request(app)
        .get('/auth/oidc/login/unknown-provider')
        .set('Accept', 'application/json');

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, ApiErrorCode.Unauthorized);
    });

    it('rejects callback when correlation cookies are missing', async function () {
      await setupFetchMock();

      const callbackUrl = new URL(OIDC_REDIRECT_URL);
      callbackUrl.searchParams.set('code', '123456');
      callbackUrl.searchParams.set('state', 'somestate');

      // Send callback with no signed cookies at all
      const response = await request(app)
        .post('/auth/oidc/callback/test')
        .set('Accept', 'application/json')
        .send({ callbackUrl: callbackUrl.toString() });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        ApiErrorCode.OidcAuthorizationFailed
      );
    });

    it('rejects callback when the correlation cookie is tampered with', async function () {
      await setupFetchMock();

      const loginResponse = await request(app)
        .get('/auth/oidc/login/test')
        .set('Accept', 'application/json');

      assert.strictEqual(loginResponse.status, 200);

      const redirectUrl = new URL(loginResponse.body.redirectUrl);
      const state = redirectUrl.searchParams.get('state');

      const cookies = loginResponse.get('Set-Cookie');
      assert.notStrictEqual(cookies, undefined);
      const correlationCookie = cookies!.find((cookie) =>
        cookie.startsWith('oidc-correlation-')
      );
      assert.ok(correlationCookie);
      const cookieValue = correlationCookie.split(';')[0];
      const tamperedCookie = `${cookieValue.slice(0, -1)}${
        cookieValue.endsWith('a') ? 'b' : 'a'
      }`;

      const callbackUrl = new URL(OIDC_REDIRECT_URL);
      callbackUrl.searchParams.set('code', '123456');
      if (state) callbackUrl.searchParams.set('state', state);

      const response = await request(app)
        .post('/auth/oidc/callback/test')
        .set('Accept', 'application/json')
        .set('Cookie', tamperedCookie)
        .send({ callbackUrl: callbackUrl.toString() });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        ApiErrorCode.OidcAuthorizationFailed
      );
    });

    it('keeps concurrent login attempts independently correlated', async function () {
      await setupFetchMock();

      const firstLogin = await request(app).get('/auth/oidc/login/test');
      const secondLogin = await request(app).get('/auth/oidc/login/test');
      assert.strictEqual(firstLogin.status, 200);
      assert.strictEqual(secondLogin.status, 200);

      const firstAuthorizationUrl = new URL(firstLogin.body.redirectUrl);
      const secondAuthorizationUrl = new URL(secondLogin.body.redirectUrl);
      const firstCookie = firstLogin
        .get('Set-Cookie')!
        .find((cookie) => cookie.startsWith('oidc-correlation-'))!;
      const secondCookie = secondLogin
        .get('Set-Cookie')!
        .find((cookie) => cookie.startsWith('oidc-correlation-'))!;
      assert.ok(firstCookie);
      assert.ok(secondCookie);
      assert.notStrictEqual(
        firstCookie.split('=', 1)[0],
        secondCookie.split('=', 1)[0]
      );

      const performCallback = async (authorizationUrl: URL, cookie: string) => {
        expectedNonce = authorizationUrl.searchParams.get('nonce');
        const callbackUrl = new URL(OIDC_REDIRECT_URL);
        callbackUrl.searchParams.set('code', '123456');
        callbackUrl.searchParams.set(
          'state',
          authorizationUrl.searchParams.get('state')!
        );
        return request(app)
          .post('/auth/oidc/callback/test')
          .set('Cookie', cookie.split(';')[0])
          .send({ callbackUrl: callbackUrl.toString() });
      };

      const firstCallback = await performCallback(
        firstAuthorizationUrl,
        firstCookie
      );
      const secondCallback = await performCallback(
        secondAuthorizationUrl,
        secondCookie
      );

      assert.strictEqual(firstCallback.status, 204);
      assert.strictEqual(secondCallback.status, 204);
    });

    it('caps active correlation cookies without invalidating recent attempts', async function () {
      await setupFetchMock();
      const cookies = new Map<string, string>();
      const authorizationUrls: URL[] = [];

      const getCookieHeader = () =>
        [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      const applySetCookies = (setCookies: string[] | undefined) => {
        for (const setCookie of setCookies ?? []) {
          const [cookie] = setCookie.split(';', 1);
          const separator = cookie.indexOf('=');
          const name = cookie.slice(0, separator);
          const value = cookie.slice(separator + 1);
          if (value) {
            cookies.set(name, value);
          } else {
            cookies.delete(name);
          }
        }
      };

      for (
        let index = 0;
        index < MAX_ACTIVE_OIDC_CORRELATIONS + 2;
        index += 1
      ) {
        const loginRequest = request(app).get('/auth/oidc/login/test');
        const cookieHeader = getCookieHeader();
        if (cookieHeader) {
          loginRequest.set('Cookie', cookieHeader);
        }
        const loginResponse = await loginRequest;
        assert.strictEqual(loginResponse.status, 200);
        authorizationUrls.push(new URL(loginResponse.body.redirectUrl));
        applySetCookies(loginResponse.get('Set-Cookie'));
      }
      assert.strictEqual(cookies.size, MAX_ACTIVE_OIDC_CORRELATIONS);

      const performCallback = async (authorizationUrl: URL) => {
        expectedNonce = authorizationUrl.searchParams.get('nonce');
        const callbackUrl = new URL(OIDC_REDIRECT_URL);
        callbackUrl.searchParams.set('code', '123456');
        callbackUrl.searchParams.set(
          'state',
          authorizationUrl.searchParams.get('state')!
        );
        return request(app)
          .post('/auth/oidc/callback/test')
          .set('Cookie', getCookieHeader())
          .send({ callbackUrl: callbackUrl.toString() });
      };

      const oldestCallback = await performCallback(authorizationUrls[0]);
      assert.strictEqual(oldestCallback.status, 400);
      assert.strictEqual(
        oldestCallback.body.error,
        ApiErrorCode.OidcAuthorizationFailed
      );

      const newestCallback = await performCallback(
        authorizationUrls[authorizationUrls.length - 1]
      );
      assert.strictEqual(newestCallback.status, 204);
    });

    it('rejects a callback URL that differs from the issued redirect URI', async function () {
      await setupFetchMock();

      const loginResponse = await request(app).get('/auth/oidc/login/test');
      const redirectUrl = new URL(loginResponse.body.redirectUrl);
      expectedNonce = redirectUrl.searchParams.get('nonce');
      const cookies = loginResponse.get('Set-Cookie')!;
      const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
      const callbackUrl = new URL(
        'https://jellyseerr.example.com/settings/main'
      );
      callbackUrl.searchParams.set('code', '123456');
      callbackUrl.searchParams.set(
        'state',
        redirectUrl.searchParams.get('state')!
      );

      const response = await request(app)
        .post('/auth/oidc/callback/test')
        .set('Cookie', cookieHeader)
        .send({ callbackUrl: callbackUrl.toString() });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        ApiErrorCode.OidcAuthorizationFailed
      );
    });

    it('rejects malformed callback URLs', async function () {
      await setupFetchMock();

      const loginResponse = await request(app).get('/auth/oidc/login/test');
      const cookies = loginResponse.get('Set-Cookie')!;
      const response = await request(app)
        .post('/auth/oidc/callback/test')
        .set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '))
        .send({ callbackUrl: 'not a URL' });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        ApiErrorCode.OidcAuthorizationFailed
      );
    });
  });
});
