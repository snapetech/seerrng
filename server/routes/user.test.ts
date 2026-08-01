import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { LinkedAccount } from '@server/entity/LinkedAccount';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import { UserSettings } from '@server/entity/UserSettings';
import PreparedEmail from '@server/lib/email';
import { MAX_PERMISSION_VALUE, Permission } from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import type { EntityManager } from 'typeorm';
import authRoutes from './auth';
import userRoutes, {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  USER_REQUEST_DELETE_BATCH_SIZE,
  canMakePermissionsChange,
  isUniqueConstraintError,
  removeUserRequestsInBatches,
  runPushSubscriptionMutation,
} from './user';
import {
  PASSWORD_MUTATION_RATE_LIMIT,
  getPasswordMutationRateLimitKey,
} from './user/usersettings';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
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
  app.use('/user', userRoutes);
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

describe('User request deletion batching', () => {
  it('never materializes more than one fixed-size request batch', async () => {
    const remaining = Array.from(
      { length: USER_REQUEST_DELETE_BATCH_SIZE * 2 + 1 },
      (_, index) => ({ id: index + 1 })
    );
    const observedBatchSizes: number[] = [];
    const repository = {
      find: async (options: { take: number }) => {
        observedBatchSizes.push(options.take);
        return remaining.slice(0, options.take);
      },
      remove: async (requests: { id: number }[]) => {
        remaining.splice(0, requests.length);
        return requests;
      },
    };
    const manager = {
      getRepository: () => repository,
    } as unknown as EntityManager;

    await removeUserRequestsInBatches(manager, 42);

    assert.deepStrictEqual(observedBatchSizes, [250, 250, 250, 250]);
    assert.strictEqual(remaining.length, 0);
  });
});

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('User route input validation', () => {
  it('bounds authenticated password mutation attempts', () => {
    assert.deepStrictEqual(PASSWORD_MUTATION_RATE_LIMIT, {
      windowMs: 15 * 60 * 1000,
      limit: 10,
    });
    const actor = new User({ id: 42 });
    assert.strictEqual(
      getPasswordMutationRateLimitKey({ user: actor } as Parameters<
        typeof getPasswordMutationRateLimitKey
      >[0]),
      'user:42'
    );
  });

  it('allows administrators to delegate ordinary permissions', () => {
    const administrator = new User({
      id: 2,
      permissions: Permission.ADMIN,
    });

    assert.strictEqual(
      canMakePermissionsChange(
        Permission.MANAGE_USERS + Permission.MANAGE_SETTINGS,
        administrator
      ),
      true
    );
  });

  it('prevents delegated user managers from granting permissions they do not hold', async () => {
    const userRepository = getRepository(User);
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);

    assert.strictEqual(
      canMakePermissionsChange(Permission.MANAGE_USERS, manager),
      true
    );
    assert.strictEqual(
      canMakePermissionsChange(
        Permission.MANAGE_USERS + Permission.MANAGE_SETTINGS,
        manager
      ),
      false
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.put('/user').send({
      ids: [2],
      permissions: Permission.MANAGE_USERS + Permission.MANAGE_SETTINGS,
    });

    assert.strictEqual(res.status, 403);
    const persisted = await userRepository.findOneByOrFail({ id: 2 });
    assert.strictEqual(persisted.permissions, Permission.MANAGE_USERS);
  });

  it('prevents delegated managers from creating users with stronger default permissions', async () => {
    const userRepository = getRepository(User);
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);

    const settings = getSettings();
    const previousDefaultPermissions = settings.main.defaultPermissions;
    settings.main.defaultPermissions = Permission.MANAGE_SETTINGS;

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const res = await agent.post('/user').send({
        username: 'controlled-user',
        email: 'controlled-user@seerr.dev',
        password: 'controlled-password',
      });

      assert.strictEqual(res.status, 403);
      assert.match(res.body.message, /default access level/i);
      assert.strictEqual(
        await userRepository.existsBy({ email: 'controlled-user@seerr.dev' }),
        false
      );
    } finally {
      settings.main.defaultPermissions = previousDefaultPermissions;
    }
  });

  it('revalidates local-user creation authority at the commit boundary', async (t) => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const userRepository = getRepository(User);
    const administrator = await userRepository.findOneByOrFail({ id: 1 });
    const originalSetPassword = User.prototype.setPassword;
    let passwordPrepared!: () => void;
    let mutationAdmitted!: () => void;
    const passwordPreparedPromise = new Promise<void>((resolve) => {
      passwordPrepared = resolve;
    });
    const mutationAdmittedPromise = new Promise<void>((resolve) => {
      mutationAdmitted = resolve;
    });
    const setPasswordMock = mock.method(
      User.prototype,
      'setPassword',
      async function (this: User, password: string) {
        await originalSetPassword.call(this, password);
        passwordPrepared();
      }
    );
    t.after(() => setPasswordMock.mock.restore());

    const revocation = runUserSecurityMutation(administrator.id, async () => {
      mutationAdmitted();
      await passwordPreparedPromise;
      await userRepository.update(administrator.id, { permissions: 0 });
    });
    await mutationAdmittedPromise;

    const responsePromise = agent
      .post('/user')
      .send({
        username: 'revoked-create-user',
        email: 'revoked-create-user@seerr.dev',
        password: 'controlled-password',
      })
      .then((response) => response);
    await passwordPreparedPromise;
    await revocation;

    const response = await responsePromise;
    assert.strictEqual(response.status, 403);
    assert.match(response.body.message, /do not have permission/i);
    assert.strictEqual(
      await userRepository.existsBy({ email: 'revoked-create-user@seerr.dev' }),
      false
    );
  });

  it('requires the current password when users replace their own password', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/password').send({
      newPassword: 'replacement-password',
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /Current password is invalid/i);

    const userWithPassword = await getRepository(User).findOneOrFail({
      where: { id: 2 },
      select: ['id', 'password'],
    });
    assert.strictEqual(await userWithPassword.passwordMatch('test1234'), true);
    assert.strictEqual(
      await userWithPassword.passwordMatch('replacement-password'),
      false
    );
  });

  it('invalidates outstanding recovery links after a password change', async () => {
    const userRepository = getRepository(User);
    const user = new User({
      email: 'password-change@seerr.dev',
      username: 'password-change',
      avatar: 'https://example.com/avatar.png',
      permissions: Permission.REQUEST,
      userType: UserType.LOCAL,
    });
    await user.setPassword('current-password');
    user.resetPasswordGuid = 'outstanding-recovery-token';
    user.recoveryLinkExpirationDate = new Date(Date.now() + 60_000);
    await userRepository.save(user);

    const agent = await loginAs(user.email, 'current-password');
    const res = await agent.post(`/user/${user.id}/settings/password`).send({
      currentPassword: 'current-password',
      newPassword: 'replacement-password',
    });

    assert.strictEqual(res.status, 204);

    const persisted = await userRepository.findOneOrFail({
      where: { id: user.id },
      select: [
        'id',
        'password',
        'resetPasswordGuid',
        'recoveryLinkExpirationDate',
      ],
    });
    assert.strictEqual(persisted.resetPasswordGuid, null);
    assert.strictEqual(persisted.recoveryLinkExpirationDate, null);
    assert.strictEqual(
      await persisted.passwordMatch('replacement-password'),
      true
    );
  });

  it('allows only one concurrent self-service password change to win', async () => {
    const firstAgent = await loginAs('friend@seerr.dev', 'test1234');
    const secondAgent = await loginAs('friend@seerr.dev', 'test1234');
    const newPasswords = ['concurrent-change-one', 'concurrent-change-two'];

    const responses = await Promise.all(
      [firstAgent, secondAgent].map((agent, index) =>
        agent.post('/user/2/settings/password').send({
          currentPassword: 'test1234',
          newPassword: newPasswords[index],
        })
      )
    );

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [204, 403]
    );

    const persisted = await getRepository(User).findOneOrFail({
      where: { id: 2 },
      select: ['id', 'password'],
    });
    const matches = await Promise.all(
      newPasswords.map((password) => persisted.passwordMatch(password))
    );
    assert.strictEqual(matches.filter(Boolean).length, 1);
  });

  it('prevents delegated managers from taking over stronger non-admin accounts', async () => {
    const userRepository = getRepository(User);
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);

    const strongerUser = new User({
      email: 'stronger-user@seerr.dev',
      username: 'stronger-user',
      avatar: 'https://example.com/avatar.png',
      permissions: Permission.MANAGE_SETTINGS,
      userType: UserType.LOCAL,
    });
    await strongerUser.setPassword('stronger-password');
    await userRepository.save(strongerUser);

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const passwordRes = await agent
      .post(`/user/${strongerUser.id}/settings/password`)
      .send({ newPassword: 'manager-controlled-password' });
    const emailRes = await agent
      .post(`/user/${strongerUser.id}/settings/main`)
      .send({
        username: 'stronger-user',
        email: 'manager-controlled@seerr.dev',
      });

    assert.strictEqual(passwordRes.status, 403);
    assert.strictEqual(emailRes.status, 403);
    const persisted = await userRepository.findOneOrFail({
      where: { id: strongerUser.id },
      select: ['id', 'email', 'password'],
    });
    assert.strictEqual(persisted.email, 'stronger-user@seerr.dev');
    assert.strictEqual(
      await persisted.passwordMatch('stronger-password'),
      true
    );
    assert.strictEqual(
      await persisted.passwordMatch('manager-controlled-password'),
      false
    );
  });

  it('uses fresh manager authority for profile email changes and reads', async () => {
    const userRepository = getRepository(User);
    const strongerUser = await userRepository.save(
      new User({
        email: 'fresh-authority-target@seerr.dev',
        username: 'fresh-authority-target',
        avatar: 'https://example.com/fresh-authority-target.png',
        permissions: Permission.MANAGE_SETTINGS,
        userType: UserType.LOCAL,
      })
    );
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use(express.json());
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    await userRepository.update(1, { permissions: Permission.MANAGE_USERS });
    const updateResponse = await request(staleAuthorizationApp)
      .post(`/user/${strongerUser.id}/settings/main`)
      .send({
        username: 'taken-over',
        email: 'taken-over@seerr.dev',
      });
    assert.strictEqual(updateResponse.status, 403);

    await userRepository.update(1, { permissions: Permission.REQUEST });
    const readResponse = await request(staleAuthorizationApp).get(
      `/user/${strongerUser.id}/settings/main`
    );
    assert.strictEqual(readResponse.status, 403);
    assert.strictEqual(readResponse.body.email, undefined);

    const persisted = await userRepository.findOneByOrFail({
      id: strongerUser.id,
    });
    assert.strictEqual(persisted.email, 'fresh-authority-target@seerr.dev');
    assert.strictEqual(persisted.username, 'fresh-authority-target');
  });

  it('prevents delegated user managers from modifying administrator accounts', async () => {
    const userRepository = getRepository(User);
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);

    const secondaryAdmin = new User({
      email: 'secondary-admin@seerr.dev',
      username: 'secondary-admin',
      avatar: 'https://example.com/avatar.png',
      permissions: Permission.ADMIN,
      userType: UserType.LOCAL,
    });
    await secondaryAdmin.setPassword('secondary-password');
    await userRepository.save(secondaryAdmin);

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const generalRes = await agent
      .post(`/user/${secondaryAdmin.id}/settings/main`)
      .send({
        username: 'taken-over',
        email: 'attacker@seerr.dev',
      });
    const permissionsRes = await agent
      .post(`/user/${secondaryAdmin.id}/settings/permissions`)
      .send({ permissions: 0 });
    const directRes = await agent.put(`/user/${secondaryAdmin.id}`).send({
      username: 'taken-over',
      permissions: 0,
    });
    const bulkRes = await agent.put('/user').send({
      ids: [secondaryAdmin.id],
      permissions: 0,
    });

    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.PLEX;
    secondaryAdmin.userType = UserType.PLEX;
    secondaryAdmin.plexId = 12345;
    secondaryAdmin.plexUsername = 'secondary-admin';
    await userRepository.save(secondaryAdmin);
    const unlinkRes = await agent.delete(
      `/user/${secondaryAdmin.id}/settings/linked-accounts/plex`
    );
    const pushSubscription = await getRepository(UserPushSubscription).save(
      new UserPushSubscription({
        user: secondaryAdmin,
        endpoint: 'https://example.com/secondary-admin',
        auth: 'auth',
        p256dh: 'p256dh',
        userAgent: 'test',
      })
    );
    const deletePushRes = await agent.delete(
      `/user/${secondaryAdmin.id}/pushSubscription/${encodeURIComponent(
        pushSubscription.endpoint
      )}`
    );

    assert.strictEqual(generalRes.status, 403);
    assert.strictEqual(permissionsRes.status, 403);
    assert.strictEqual(directRes.status, 403);
    assert.strictEqual(bulkRes.status, 403);
    assert.strictEqual(unlinkRes.status, 403);
    assert.strictEqual(deletePushRes.status, 403);

    const persisted = await userRepository.findOneByOrFail({
      id: secondaryAdmin.id,
    });
    assert.strictEqual(persisted.email, 'secondary-admin@seerr.dev');
    assert.strictEqual(persisted.username, 'secondary-admin');
    assert.strictEqual(persisted.permissions, Permission.ADMIN);
    assert.strictEqual(persisted.plexId, 12345);
    assert.strictEqual(
      await getRepository(UserPushSubscription).existsBy({
        id: pushSubscription.id,
      }),
      true
    );
  });

  it('does not delete a user promoted to administrator during deletion', async () => {
    const userRepository = getRepository(User);
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);
    const target = await userRepository.save(
      new User({
        email: 'promotion-race@seerr.dev',
        username: 'promotion-race',
        avatar: 'https://example.com/promotion-race.png',
        permissions: Permission.REQUEST,
        userType: UserType.LOCAL,
      })
    );
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const originalTransaction = dataSource.transaction.bind(dataSource);
    let releaseTransaction: (() => void) | undefined;
    const transactionHeld = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let signalTransaction: (() => void) | undefined;
    const transactionEntered = new Promise<void>((resolve) => {
      signalTransaction = resolve;
    });
    const transactionTarget = dataSource as unknown as {
      transaction<T>(
        callback: (manager: EntityManager) => Promise<T>
      ): Promise<T>;
    };
    const transactionMock = mock.method(
      transactionTarget,
      'transaction',
      async <T>(callback: (manager: EntityManager) => Promise<T>) => {
        signalTransaction?.();
        await transactionHeld;
        return originalTransaction(callback);
      }
    );

    try {
      const deletion = agent.delete(`/user/${target.id}`).then((res) => res);
      await transactionEntered;
      target.permissions = Permission.ADMIN;
      await userRepository.save(target);
      releaseTransaction?.();
      const res = await deletion;

      assert.strictEqual(res.status, 405);
      const persisted = await userRepository.findOneByOrFail({ id: target.id });
      assert.strictEqual(persisted.permissions, Permission.ADMIN);
    } finally {
      releaseTransaction?.();
      transactionMock.mock.restore();
    }
  });

  it('rejects array search parameters on user list requests', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user').query({ q: ['admin', 'friend'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Search query must be a string/);
  });

  it('treats user search wildcard characters as literal text', async () => {
    const userRepository = getRepository(User);
    await userRepository.save(
      new User({
        email: 'percent%user@example.com',
        username: 'Percent User',
        permissions: Permission.REQUEST,
        avatar: '',
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const response = await agent.get('/user').query({ q: '%' });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      response.body.results.map(({ email }: { email: string }) => email),
      ['percent%user@example.com']
    );
  });

  it('rejects malformed includeIds on user list requests', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user').query({ includeIds: '1,nope' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /includeIds contains an invalid id/i);
  });

  it('uses fresh user-list authority and returns only requester selection fields', async () => {
    await getRepository(User).update(1, {
      permissions: Permission.MANAGE_REQUESTS,
    });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const response = await request(staleAuthorizationApp).get('/user');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.results.length >= 2);
    assert.ok(
      response.body.results.every(
        (user: Record<string, unknown>) =>
          JSON.stringify(Object.keys(user).sort()) ===
          JSON.stringify(['avatar', 'displayName', 'id', 'permissions'])
      )
    );
  });

  it('does not let request managers search hidden account identifiers', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(2, {
      permissions: Permission.MANAGE_REQUESTS,
    });

    try {
      const requestManager = await loginAs('friend@seerr.dev', 'test1234');
      const hiddenEmailSearch = await requestManager
        .get('/user')
        .query({ q: 'admin@seerr.dev' });
      const displayNameSearch = await requestManager
        .get('/user')
        .query({ q: 'admin' });
      const hiddenActivitySort = await requestManager
        .get('/user')
        .query({ sort: 'requests' });

      assert.strictEqual(hiddenEmailSearch.status, 200);
      assert.ok(
        hiddenEmailSearch.body.results.every(
          (user: { id: number }) => user.id !== 1
        )
      );
      assert.ok(
        displayNameSearch.body.results.some(
          (user: { id: number }) => user.id === 1
        )
      );
      assert.strictEqual(hiddenActivitySort.status, 403);

      const userManager = await loginAs('admin@seerr.dev', 'test1234');
      const administrativeSearch = await userManager
        .get('/user')
        .query({ q: 'admin@seerr.dev' });
      assert.ok(
        administrativeSearch.body.results.some(
          (user: { id: number }) => user.id === 1
        )
      );
    } finally {
      await userRepository.update(2, { permissions: Permission.REQUEST });
    }
  });

  it('returns 404 for malformed profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('returns only public display identity for an unprivileged foreign profile', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/user/1');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 1);
    assert.strictEqual(typeof res.body.displayName, 'string');
    assert.strictEqual(typeof res.body.avatar, 'string');
    assert.strictEqual(typeof res.body.createdAt, 'string');
    for (const field of [
      'email',
      'username',
      'plexUsername',
      'jellyfinUsername',
      'plexId',
      'jellyfinUserId',
      'permissions',
      'userType',
      'requestCount',
      'movieQuotaLimit',
      'movieQuotaDays',
      'tvQuotaLimit',
      'tvQuotaDays',
      'musicQuotaLimit',
      'musicQuotaDays',
      'bookQuotaLimit',
      'bookQuotaDays',
      'settings',
      'updatedAt',
    ]) {
      assert.strictEqual(res.body[field], undefined, `${field} was exposed`);
    }
  });

  it('returns 404 for malformed quota IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/quota');

    assert.strictEqual(res.status, 404);
  });

  it('requires both user and request management permission for foreign quota', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(2, {
      permissions: Permission.MANAGE_REQUESTS,
    });

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const requestManagerOnly = await agent.get('/user/1/quota');
      assert.strictEqual(requestManagerOnly.status, 403);

      await userRepository.update(2, {
        permissions: Permission.MANAGE_REQUESTS | Permission.MANAGE_USERS,
      });
      const allowed = await agent.get('/user/1/quota');
      assert.strictEqual(allowed.status, 200);

      await userRepository.update(2, {
        permissions: Permission.MANAGE_REQUESTS,
      });
      const revoked = await agent.get('/user/1/quota');
      assert.strictEqual(revoked.status, 403);
    } finally {
      await userRepository.update(2, { permissions: Permission.REQUEST });
    }
  });

  it('does not misreport quota calculation failures as missing users', async () => {
    const quotaMock = mock.method(User.prototype, 'getQuota', async () => {
      throw new Error('SQLITE_ERROR: private quota column missing');
    });

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const res = await agent.get('/user/1/quota');

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.message, 'Unable to calculate user quota.');
      assert.doesNotMatch(JSON.stringify(res.body), /SQLITE|private quota/i);
    } finally {
      quotaMock.mock.restore();
    }
  });

  it('returns 404 for malformed watchlist profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/watchlist');

    assert.strictEqual(res.status, 404);
  });

  it("does not use another user's Plex token after viewer permission revocation", async () => {
    const userRepository = getRepository(User);
    await userRepository.update(1, { permissions: Permission.REQUEST });
    await userRepository.update(2, { plexToken: 'target-plex-token' });
    const getWatchlist = mock.method(
      PlexTvAPI.prototype,
      'getWatchlist',
      async () => ({ items: [], totalSize: 0 }) as never
    );
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({
        id: 1,
        permissions: Permission.WATCHLIST_VIEW,
      });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const response = await request(staleAuthorizationApp).get(
        '/user/2/watchlist'
      );

      assert.strictEqual(response.status, 403);
      assert.strictEqual(getWatchlist.mock.callCount(), 0);
    } finally {
      getWatchlist.mock.restore();
    }
  });

  it('returns 404 for malformed settings profile IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/not-a-number/settings/main');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed password update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/password').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects invalid password update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/password').send({});

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /newPassword/i);
  });

  it('rejects malformed main settings bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/main').send([]);
    const localeRes = await agent.post('/user/1/settings/main').send({
      username: 'admin',
      email: 'admin@seerr.dev',
      locale: 'not-a-locale',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
    assert.strictEqual(localeRes.status, 400);
    assert.match(localeRes.body.message, /locale must be a supported locale/i);
  });

  it('rejects malformed notification settings bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/notifications').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects Discord mention injection in both settings endpoints', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const maliciousId = '123> @everyone <@456';
    const mainRes = await agent.post('/user/1/settings/main').send({
      username: 'admin',
      email: 'admin@seerr.dev',
      discordId: maliciousId,
    });
    const notificationRes = await agent
      .post('/user/1/settings/notifications')
      .send({ discordId: maliciousId, notificationTypes: {} });

    assert.strictEqual(mainRes.status, 400);
    assert.match(mainRes.body.message, /valid Discord user ID/i);
    assert.strictEqual(notificationRes.status, 400);
    assert.match(notificationRes.body.message, /valid Discord user ID/i);
  });

  it('rejects malformed quota and watchlist settings without mutation', async () => {
    const userRepository = getRepository(User);
    const before = await userRepository.findOneByOrFail({ id: 2 });
    const beforeQuota = before.movieQuotaLimit;
    const beforeWatchlistSync = before.settings?.watchlistSyncMovies;
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const quotaRes = await agent.post('/user/2/settings/main').send({
      username: 'friend',
      email: 'friend@seerr.dev',
      movieQuotaLimit: '7',
    });
    const watchlistRes = await agent.post('/user/2/settings/main').send({
      username: 'friend',
      email: 'friend@seerr.dev',
      watchlistSyncMovies: 'true',
    });

    assert.strictEqual(quotaRes.status, 400);
    assert.match(quotaRes.body.message, /movieQuotaLimit must be a valid/i);
    assert.strictEqual(watchlistRes.status, 400);
    assert.match(
      watchlistRes.body.message,
      /watchlistSyncMovies must be a boolean/i
    );
    const persisted = await userRepository.findOneByOrFail({ id: 2 });
    assert.strictEqual(persisted.movieQuotaLimit, beforeQuota);
    assert.strictEqual(
      persisted.settings?.watchlistSyncMovies,
      beforeWatchlistSync
    );
  });

  it('rejects malformed notification flags and masks', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const booleanRes = await agent
      .post('/user/2/settings/notifications')
      .send({ telegramSendSilently: 'true' });
    const maskRes = await agent.post('/user/2/settings/notifications').send({
      notificationTypes: { pushbullet: 8192 },
    });
    const unknownBitRes = await agent
      .post('/user/2/settings/notifications')
      .send({
        notificationTypes: { pushbullet: 1 },
      });
    const shapeRes = await agent.post('/user/2/settings/notifications').send({
      notificationTypes: [],
    });

    assert.strictEqual(booleanRes.status, 400);
    assert.match(
      booleanRes.body.message,
      /telegramSendSilently must be a boolean/i
    );
    assert.strictEqual(maskRes.status, 400);
    assert.match(maskRes.body.message, /notificationTypes\.pushbullet/i);
    assert.strictEqual(unknownBitRes.status, 400);
    assert.match(unknownBitRes.body.message, /notificationTypes\.pushbullet/i);
    assert.strictEqual(shapeRes.status, 400);
    assert.match(shapeRes.body.message, /notificationTypes must be an object/i);
  });

  it('rejects malformed push subscription bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/registerPushSubscription').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects non-canonical push subscription endpoint aliases', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const controlResponse = await agent
      .post('/user/registerPushSubscription')
      .send({
        endpoint: 'https://example.com/push\nsubscription',
        auth: 'control-auth',
        p256dh: 'control-key',
        userAgent: 'control-agent',
      });
    const fragmentResponse = await agent
      .post('/user/registerPushSubscription')
      .send({
        endpoint: 'https://example.com/push#subscription',
        auth: 'fragment-auth',
        p256dh: 'fragment-key',
        userAgent: 'fragment-agent',
      });

    assert.strictEqual(controlResponse.status, 400);
    assert.match(controlResponse.body.message, /control characters/i);
    assert.strictEqual(fragmentResponse.status, 400);
    assert.match(fragmentResponse.body.message, /fragment/i);
  });

  it('serializes concurrent registration of the same push endpoint', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const endpoint = 'https://example.com/concurrent-push-subscription';
    const [first, second] = await Promise.all([
      agent.post('/user/registerPushSubscription').send({
        endpoint,
        auth: 'first-auth',
        p256dh: 'first-key',
        userAgent: 'concurrent-test',
      }),
      agent.post('/user/registerPushSubscription').send({
        endpoint,
        auth: 'second-auth',
        p256dh: 'second-key',
        userAgent: 'concurrent-test',
      }),
    ]);

    assert.deepStrictEqual([first.status, second.status], [204, 204]);
    assert.strictEqual(
      await getRepository(UserPushSubscription).count({
        where: { endpoint, user: { id: 1 } },
      }),
      1
    );
  });

  it('rejects push registration when credentials rotate before admission', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 1 });
    const originalRun = requestAdmissionCoordinator.run.bind(
      requestAdmissionCoordinator
    );
    let rotated = false;
    requestAdmissionCoordinator.run = async (resourceKeys, callback) => {
      if (!rotated && resourceKeys.includes('user-security:user:1')) {
        rotated = true;
        await userRepository.update(1, {
          passwordChangedAt: new Date(
            (actor.passwordChangedAt?.getTime() ?? 0) + 1_000
          ),
        });
      }
      return originalRun(resourceKeys, callback);
    };

    const endpoint = 'https://example.com/stale-session-push';
    try {
      const response = await agent.post('/user/registerPushSubscription').send({
        endpoint,
        auth: 'stale-auth',
        p256dh: 'stale-key',
        userAgent: 'stale-agent',
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(
        await getRepository(UserPushSubscription).existsBy({ endpoint }),
        false
      );
    } finally {
      requestAdmissionCoordinator.run = originalRun;
    }
  });

  it('coordinates push subscription mutations across server instances', async () => {
    const originalRun = requestAdmissionCoordinator.run.bind(
      requestAdmissionCoordinator
    );
    const keySets: string[][] = [];
    requestAdmissionCoordinator.run = async (resourceKeys, callback) => {
      keySets.push(resourceKeys);
      return callback();
    };

    try {
      assert.strictEqual(
        await runPushSubscriptionMutation(42, async () => 'mutated'),
        'mutated'
      );
      assert.deepStrictEqual(keySets, [
        ['user-security:user:42'],
        ['push-subscription:user:42'],
      ]);
    } finally {
      requestAdmissionCoordinator.run = originalRun;
    }
  });

  it('caps push subscriptions per user', async () => {
    const user = await getRepository(User).findOneByOrFail({ id: 1 });
    const repository = getRepository(UserPushSubscription);
    await repository.save(
      Array.from(
        { length: MAX_PUSH_SUBSCRIPTIONS_PER_USER },
        (_, index) =>
          new UserPushSubscription({
            endpoint: `https://example.com/push-limit-${index}`,
            auth: `auth-${index}`,
            p256dh: `key-${index}`,
            userAgent: `agent-${index}`,
            user,
          })
      )
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/registerPushSubscription').send({
      endpoint: 'https://example.com/push-limit-overflow',
      auth: 'overflow-auth',
      p256dh: 'overflow-key',
      userAgent: 'overflow-agent',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /at most 25 push subscriptions/i);
    assert.strictEqual(
      await repository.count({ where: { user: { id: user.id } } }),
      MAX_PUSH_SUBSCRIPTIONS_PER_USER
    );
  });

  it('recognizes database-specific unique constraint errors', () => {
    assert.strictEqual(
      isUniqueConstraintError({ driverError: { code: '23505' } }),
      true
    );
    assert.strictEqual(
      isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' }),
      true
    );
    assert.strictEqual(
      isUniqueConstraintError({
        code: 'SQLITE_CONSTRAINT',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: user.email',
      }),
      true
    );
    assert.strictEqual(
      isUniqueConstraintError({
        code: 'SQLITE_CONSTRAINT',
        message: 'SQLITE_CONSTRAINT: NOT NULL constraint failed: user.email',
      }),
      false
    );
    assert.strictEqual(
      isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }),
      false
    );
  });

  it('rejects malformed push subscription endpoint params before lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const getRes = await agent.get('/user/1/pushSubscription/not-a-url');
    const deleteRes = await agent.delete('/user/1/pushSubscription/not-a-url');

    assert.strictEqual(getRes.status, 400);
    assert.match(getRes.body.message, /endpoint must be a valid URL/i);
    assert.strictEqual(deleteRes.status, 400);
    assert.match(deleteRes.body.message, /endpoint must be a valid URL/i);
  });

  it('revalidates cross-user push subscription access after manager demotion', async () => {
    const userRepository = getRepository(User);
    const subscriptionRepository = getRepository(UserPushSubscription);
    const target = await userRepository.findOneByOrFail({ id: 2 });
    const endpoint = 'https://example.com/revoked-manager-subscription';
    const subscription = await subscriptionRepository.save(
      new UserPushSubscription({
        user: target,
        endpoint,
        auth: 'revoked-auth',
        p256dh: 'revoked-key',
        userAgent: 'revoked-agent',
      })
    );
    await userRepository.update(1, { permissions: Permission.REQUEST });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );
    const path = `/user/2/pushSubscription/${encodeURIComponent(endpoint)}`;

    const readResponse = await request(staleAuthorizationApp).get(path);
    const deleteResponse = await request(staleAuthorizationApp).delete(path);

    assert.strictEqual(readResponse.status, 403);
    assert.strictEqual(deleteResponse.status, 403);
    assert.strictEqual(
      await subscriptionRepository.existsBy({ id: subscription.id }),
      true
    );
  });

  it('rejects unsafe push subscription endpoints before persistence or lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const credentialedRes = await agent
      .post('/user/registerPushSubscription')
      .send({
        endpoint: 'https://user:pass@push.example.com/sub',
        auth: 'auth',
        p256dh: 'p256dh',
      });
    const privateRes = await agent.post('/user/registerPushSubscription').send({
      endpoint: 'https://127.0.0.1/push',
      auth: 'auth',
      p256dh: 'p256dh',
    });
    const privateLookupRes = await agent.get(
      '/user/1/pushSubscription/https%3A%2F%2F127.0.0.1%2Fpush'
    );

    assert.strictEqual(credentialedRes.status, 400);
    assert.match(
      credentialedRes.body.message,
      /endpoint must not include credentials/i
    );
    assert.strictEqual(privateRes.status, 400);
    assert.match(
      privateRes.body.message,
      /endpoint must be a public HTTPS URL/i
    );
    assert.strictEqual(privateLookupRes.status, 400);
    assert.match(
      privateLookupRes.body.message,
      /endpoint must be a public HTTPS URL/i
    );
  });

  it('rejects malformed local user create bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('does not create an unusable user when password setup delivery fails', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.enabled = true;
    settings.main.applicationUrl = 'https://seerr.example';
    const sendMock = mock.method(PreparedEmail.prototype, 'send', async () => {
      throw new Error('mail transport unavailable');
    });

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const res = await agent.post('/user').send({
        username: 'undelivered-user',
        email: 'undelivered-user@seerr.dev',
      });

      assert.strictEqual(res.status, 500);
      assert.match(res.body.message, /Unable to deliver password setup link/i);
      assert.strictEqual(
        await getRepository(User).existsBy({
          email: 'undelivered-user@seerr.dev',
        }),
        false
      );
    } finally {
      sendMock.mock.restore();
    }
  });

  it('persists a recoverable password setup before waiting for SMTP', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.enabled = true;
    settings.main.applicationUrl = 'https://seerr.example';
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    let releaseDelivery: (() => void) | undefined;
    const sendMock = mock.method(
      PreparedEmail.prototype,
      'send',
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve;
        })
    );

    try {
      const responsePromise = agent
        .post('/user')
        .send({
          username: 'durable-setup-user',
          email: 'durable-setup-user@seerr.dev',
        })
        .then((response) => response);
      for (let attempt = 0; attempt < 200 && !releaseDelivery; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(releaseDelivery, 'SMTP delivery did not start');

      const pendingUser = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect([
          'user.password',
          'user.resetPasswordGuid',
          'user.resetPasswordDeliveryPending',
        ])
        .where('user.email = :email', {
          email: 'durable-setup-user@seerr.dev',
        })
        .getOneOrFail();
      assert.strictEqual(pendingUser.password, null);
      assert.ok(pendingUser.resetPasswordGuid);
      assert.strictEqual(pendingUser.resetPasswordDeliveryPending, true);

      releaseDelivery();
      const response = await responsePromise;
      assert.strictEqual(response.status, 201);

      const deliveredUser = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.resetPasswordDeliveryPending')
        .where('user.id = :id', { id: pendingUser.id })
        .getOneOrFail();
      assert.strictEqual(deliveredUser.resetPasswordDeliveryPending, false);
    } finally {
      releaseDelivery?.();
      sendMock.mock.restore();
    }
  });

  it('releases account admission before password setup email delivery settles', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.enabled = true;
    settings.main.applicationUrl = 'https://seerr.example';
    const firstAgent = await loginAs('admin@seerr.dev', 'test1234');
    const secondAgent = await loginAs('admin@seerr.dev', 'test1234');
    let releaseDelivery: (() => void) | undefined;
    const sendMock = mock.method(
      PreparedEmail.prototype,
      'send',
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve;
        })
    );

    try {
      const firstResponsePromise = firstAgent
        .post('/user')
        .send({
          username: 'admission-release-user',
          email: 'admission-release-user@seerr.dev',
        })
        .then((response) => response);
      for (let attempt = 0; attempt < 200 && !releaseDelivery; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(releaseDelivery, 'SMTP delivery did not start');

      let conflictTimeout: NodeJS.Timeout | undefined;
      const conflictResponse = await Promise.race([
        secondAgent
          .post('/user')
          .send({
            username: 'duplicate-admission-release-user',
            email: 'admission-release-user@seerr.dev',
            password: 'duplicate-password',
          })
          .then((response) => response),
        new Promise<never>((_resolve, reject) => {
          conflictTimeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Same-email conflict remained blocked behind SMTP delivery.'
                )
              ),
            1_000
          );
        }),
      ]).finally(() => clearTimeout(conflictTimeout));

      assert.strictEqual(conflictResponse.status, 409);
      releaseDelivery();
      assert.strictEqual((await firstResponsePromise).status, 201);
      assert.strictEqual(
        await getRepository(User).countBy({
          email: 'admission-release-user@seerr.dev',
        }),
        1
      );
    } finally {
      releaseDelivery?.();
      sendMock.mock.restore();
    }
  });

  it('rejects malformed user update bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user/2').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed Plex linked account bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post('/user/1/settings/linked-accounts/plex')
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('returns forbidden before provider calls when account linking is disabled', async () => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    const plexLookup = mock.method(PlexTvAPI.prototype, 'getUser');
    const jellyfinLogin = mock.method(JellyfinAPI.prototype, 'login');

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const [plexResponse, jellyfinResponse] = await Promise.all([
        agent
          .post('/user/2/settings/linked-accounts/plex')
          .send({ authToken: 'unused-token' }),
        agent.post('/user/2/settings/linked-accounts/jellyfin').send({
          username: 'unused-user',
          password: 'unused-password',
        }),
      ]);

      assert.strictEqual(plexResponse.status, 403);
      assert.strictEqual(jellyfinResponse.status, 403);
      assert.strictEqual(plexLookup.mock.callCount(), 0);
      assert.strictEqual(jellyfinLogin.mock.callCount(), 0);
    } finally {
      settings.main.mediaServerType = previousMediaServerType;
      plexLookup.mock.restore();
      jellyfinLogin.mock.restore();
    }
  });

  it('rejects Plex linking after the session credential changes in flight', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.PLEX;
    const userRepository = getRepository(User);
    const friendBefore = await userRepository.findOneByOrFail({ id: 2 });
    let providerStarted!: () => void;
    let releaseProvider!: () => void;
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const releaseProviderPromise = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const getUser = mock.method(PlexTvAPI.prototype, 'getUser', async () => {
      providerStarted();
      await releaseProviderPromise;
      return {
        id: 987654,
        email: friendBefore.email,
        username: 'replacement-plex-account',
        authToken: 'replacement-plex-token',
      } as never;
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    try {
      const responsePromise = agent
        .post('/user/2/settings/linked-accounts/plex')
        .send({ authToken: 'replacement-plex-token' })
        .then((response) => response);
      await providerStartedPromise;
      await userRepository.update(2, {
        passwordChangedAt: new Date(Date.now() + 1_000),
      });
      releaseProvider();

      const response = await responsePromise;
      assert.strictEqual(response.status, 403);
      const persisted = await userRepository.findOneByOrFail({ id: 2 });
      assert.strictEqual(persisted.plexId, friendBefore.plexId);
      assert.strictEqual(persisted.plexToken, friendBefore.plexToken);
    } finally {
      releaseProvider();
      getUser.mock.restore();
    }
  });

  it('rejects malformed Jellyfin linked account bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post('/user/1/settings/linked-accounts/jellyfin')
      .send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('canonicalizes Jellyfin identities when linking an account', async () => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    const loginMock = mock.method(
      JellyfinAPI.prototype,
      'login',
      async () =>
        ({
          User: {
            Id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
            Name: 'canonical-link-user',
          },
          AccessToken: 'linked-token',
        }) as never
    );

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const res = await agent
        .post('/user/2/settings/linked-accounts/jellyfin')
        .send({ username: 'canonical-link-user', password: 'password' });

      assert.strictEqual(res.status, 204);
      const persisted = await getRepository(User).findOneByOrFail({ id: 2 });
      assert.strictEqual(
        persisted.jellyfinUserId,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      );
    } finally {
      settings.main.mediaServerType = previousMediaServerType;
      loginMock.mock.restore();
    }
  });

  it('rejects a Jellyfin link when the configured server changes in flight', async (t) => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    const previousServerId = settings.jellyfin.serverId;
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    settings.jellyfin.serverId = 'original-server';
    let releaseLogin!: () => void;
    const heldLogin = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    let loginEntered!: () => void;
    const loginEnteredPromise = new Promise<void>((resolve) => {
      loginEntered = resolve;
    });
    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => {
      loginEntered();
      await heldLogin;
      return {
        User: {
          Id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          Name: 'stale-link-user',
        },
        AccessToken: 'stale-token',
      } as never;
    });
    t.after(() => {
      settings.main.mediaServerType = previousMediaServerType;
      settings.jellyfin.serverId = previousServerId;
      loginMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const responsePromise = agent
      .post('/user/2/settings/linked-accounts/jellyfin')
      .send({ username: 'stale-link-user', password: 'password' })
      .then((response) => response);
    await loginEnteredPromise;
    settings.jellyfin.serverId = 'replacement-server';
    releaseLogin();

    const response = await responsePromise;
    assert.strictEqual(response.status, 409);
    const persisted = await getRepository(User).findOneByOrFail({ id: 2 });
    assert.strictEqual(persisted.jellyfinUserId, null);
  });

  it('returns a controlled conflict for concurrent Jellyfin identity links', async (t) => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => ({
      User: {
        Id: '00112233445566778899aabbccddeeff',
        Name: 'shared-jellyfin-user',
        ServerId: 'server',
        ServerName: 'Server',
        Configuration: { GroupedFolders: [] },
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'shared-token',
    }));
    t.after(() => {
      settings.main.mediaServerType = previousMediaServerType;
      loginMock.mock.restore();
    });
    const [adminAgent, friendAgent] = await Promise.all([
      loginAs('admin@seerr.dev', 'test1234'),
      loginAs('friend@seerr.dev', 'test1234'),
    ]);

    const responses = await Promise.all([
      adminAgent
        .post('/user/1/settings/linked-accounts/jellyfin')
        .send({ username: 'shared', password: 'password' }),
      friendAgent
        .post('/user/2/settings/linked-accounts/jellyfin')
        .send({ username: 'shared', password: 'password' }),
    ]);

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [204, 422]
    );
  });

  it('rejects invalid Jellyfin identities returned while linking', async () => {
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    const loginMock = mock.method(
      JellyfinAPI.prototype,
      'login',
      async () =>
        ({
          User: { Id: 'not-a-guid', Name: 'invalid-link-user' },
          AccessToken: 'linked-token',
        }) as never
    );

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const res = await agent
        .post('/user/2/settings/linked-accounts/jellyfin')
        .send({ username: 'invalid-link-user', password: 'password' });

      assert.strictEqual(res.status, 502);
      assert.match(res.body.message, /invalid user identity/i);
      const persisted = await getRepository(User).findOneByOrFail({ id: 2 });
      assert.strictEqual(persisted.jellyfinUserId, null);
    } finally {
      settings.main.mediaServerType = previousMediaServerType;
      loginMock.mock.restore();
    }
  });

  it('serializes linked-account removals so one login method remains', async (t) => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const settings = getSettings();
    const previousMediaServerType = settings.main.mediaServerType;
    const previousOidcLogin = settings.main.oidcLogin;
    const previousProviders = settings.oidc.providers;
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    settings.main.oidcLogin = true;
    settings.oidc.providers = [
      {
        slug: 'first',
        name: 'First',
        clientId: 'first-client',
        clientSecret: 'first-secret',
        issuerUrl: 'https://first.example',
        newUserLogin: false,
      },
      {
        slug: 'second',
        name: 'Second',
        clientId: 'second-client',
        clientSecret: 'second-secret',
        issuerUrl: 'https://second.example',
        newUserLogin: false,
      },
    ];
    t.after(() => {
      settings.main.mediaServerType = previousMediaServerType;
      settings.main.oidcLogin = previousOidcLogin;
      settings.oidc.providers = previousProviders;
    });

    const userRepository = getRepository(User);
    const friend = await userRepository.findOneByOrFail({ id: 2 });
    await userRepository.update(friend.id, {
      password: null as unknown as string,
    });
    const linkedAccountRepository = getRepository(LinkedAccount);
    const accounts = await linkedAccountRepository.save([
      new LinkedAccount({
        user: friend,
        provider: 'first',
        sub: 'friend-first',
        username: 'friend',
      }),
      new LinkedAccount({
        user: friend,
        provider: 'second',
        sub: 'friend-second',
        username: 'friend',
      }),
    ]);

    const responses = await Promise.all(
      accounts.map((account) =>
        agent.delete(
          `/user/${friend.id}/settings/linked-accounts/${account.id}`
        )
      )
    );

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [204, 400]
    );
    assert.equal(
      await linkedAccountRepository.count({
        where: { user: { id: friend.id } },
      }),
      1
    );
  });

  it('rejects malformed linked-account IDs before database lookup', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const response = await agent.delete(
      '/user/2/settings/linked-accounts/not-an-id'
    );

    assert.equal(response.status, 404);
  });

  it('ignores linked accounts whose OIDC provider was removed', async (t) => {
    const settings = getSettings();
    const previousProviders = settings.oidc.providers;
    settings.oidc.providers = [];
    t.after(() => {
      settings.oidc.providers = previousProviders;
    });
    const friend = await getRepository(User).findOneByOrFail({ id: 2 });
    await getRepository(LinkedAccount).save(
      new LinkedAccount({
        user: friend,
        provider: 'removed-provider',
        sub: 'removed-provider-subject',
        username: 'stale-account',
      })
    );
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const response = await agent.get(
      `/user/${friend.id}/settings/linked-accounts`
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body, []);
  });

  it('rejects invalid settings permission payloads', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send({
      permissions: 'not-a-number',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects malformed settings permission bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('rejects unknown permission bits on settings permission updates', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send({
      permissions: MAX_PERMISSION_VALUE + 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects unknown permission bits below the maximum permission value', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/2/settings/permissions').send({
      permissions: 536870912,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('persists high-bit music and book request permissions', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const permissions =
      Permission.REQUEST_MUSIC +
      Permission.REQUEST_BOOK +
      Permission.AUTO_APPROVE_BOOK;
    const res = await agent
      .post('/user/2/settings/permissions')
      .send({ permissions });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.permissions, permissions);

    const user = await getRepository(User).findOneOrFail({
      where: { id: 2 },
    });
    assert.strictEqual(user.permissions, permissions);
    assert.strictEqual(user.hasPermission(Permission.REQUEST_MUSIC), true);
    assert.strictEqual(user.hasPermission(Permission.REQUEST_BOOK), true);
    assert.strictEqual(user.hasPermission(Permission.AUTO_APPROVE_BOOK), true);
  });

  it('rejects unknown permission bits on bulk permission updates', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send({
      ids: [2],
      permissions: MAX_PERMISSION_VALUE + 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('rejects unknown permission holes on bulk permission updates', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send({
      ids: [2],
      permissions: 536870912,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /permissions is invalid/i);
  });

  it('returns the updated users after a bulk permission update', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send({
      ids: [2],
      permissions: Permission.REQUEST,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body[0].id, 2);
    assert.strictEqual(res.body[0].permissions, Permission.REQUEST);
  });

  it('rechecks the grant ceiling after bulk-update actor demotion', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(1, {
      permissions: Permission.MANAGE_USERS,
    });
    const target = await userRepository.findOneByOrFail({ id: 2 });
    const originalTargetPermissions = target.permissions;
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use(express.json());
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const response = await request(staleAuthorizationApp)
      .put('/user')
      .send({
        ids: [target.id],
        permissions: Permission.ADMIN,
      });

    assert.strictEqual(response.status, 403);
    assert.strictEqual(
      (await userRepository.findOneByOrFail({ id: target.id })).permissions,
      originalTargetPermissions
    );
  });

  it('rejects malformed bulk permission bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put('/user').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('rejects malformed bulk permission user IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    for (const ids of [[[2]], ['2.5'], [null]]) {
      const res = await agent.put('/user').send({
        ids,
        permissions: Permission.REQUEST,
      });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /ids contains an invalid id/i);
    }
  });

  it('rejects malformed Plex import bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/import-from-plex').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('revalidates user-management authority before using the owner Plex token', async () => {
    await getRepository(User).update(1, {
      permissions: Permission.REQUEST,
    });
    const getUsers = mock.method(PlexTvAPI.prototype, 'getUsers', async () =>
      Promise.reject(new Error('provider must not be called'))
    );
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use(express.json());
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const response = await request(staleAuthorizationApp)
        .post('/user/import-from-plex')
        .send({ plexIds: [] });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(getUsers.mock.callCount(), 0);
    } finally {
      getUsers.mock.restore();
    }
  });

  it('does not import Plex users after the owner token changes in flight', async () => {
    const settings = getSettings();
    const previousMachineId = settings.plex.machineId;
    settings.plex.machineId = 'rotation-test-machine';
    const plexId = 8_765_499;
    const getUsers = mock.method(PlexTvAPI.prototype, 'getUsers', async () => {
      await runUserSecurityMutation(1, () =>
        getRepository(User)
          .update(1, { plexToken: 'rotated-during-import' })
          .then(() => undefined)
      );
      return {
        MediaContainer: {
          User: [
            {
              $: {
                id: String(plexId),
                title: 'Stale Plex Import',
                username: 'stale-plex-import',
                email: 'stale-plex-import@example.com',
                thumb: 'https://example.com/stale-plex.png',
              },
              Server: [
                {
                  $: {
                    id: '1',
                    serverId: '1',
                    machineIdentifier: 'rotation-test-machine',
                    name: 'Plex',
                    lastSeenAt: '0',
                    numLibraries: '1',
                    owned: '0',
                  },
                },
              ],
            },
          ],
        },
      } as never;
    });

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const response = await agent
        .post('/user/import-from-plex')
        .send({ plexIds: [String(plexId)] });

      assert.strictEqual(response.status, 409);
      assert.strictEqual(await getRepository(User).countBy({ plexId }), 0);
    } finally {
      settings.plex.machineId = previousMachineId;
      getUsers.mock.restore();
    }
  });

  it('admits only one Plex account import across different managers', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(2, { permissions: Permission.MANAGE_USERS });
    const secondManager = await userRepository.save(
      new User({
        email: 'second-manager@example.com',
        avatar: 'https://example.com/second-manager.png',
        permissions: Permission.MANAGE_USERS,
        userType: UserType.LOCAL,
      })
    );
    const settings = getSettings();
    settings.main.defaultPermissions = 0;
    settings.plex.machineId = 'shared-machine';
    let providerCalls = 0;
    let releaseProviderCalls!: () => void;
    const providerCallsStarted = new Promise<void>((resolve) => {
      releaseProviderCalls = resolve;
    });
    const getUsers = mock.method(PlexTvAPI.prototype, 'getUsers', async () => {
      providerCalls += 1;
      if (providerCalls === 2) releaseProviderCalls();
      await providerCallsStarted;
      return {
        MediaContainer: {
          User: [
            {
              $: {
                id: '8765432',
                title: 'Concurrent Import',
                username: 'concurrent-import',
                email: 'concurrent-import@example.com',
                thumb: 'https://example.com/concurrent.png',
              },
              Server: [
                {
                  $: {
                    id: '1',
                    serverId: '1',
                    machineIdentifier: 'shared-machine',
                    name: 'Plex',
                    lastSeenAt: '0',
                    numLibraries: '1',
                    owned: '0',
                  },
                },
              ],
            },
          ],
        },
      } as never;
    });
    const directActorApp = express();
    directActorApp.use(express.json());
    directActorApp.use(async (req, _res, next) => {
      const actorId = Number(req.header('X-Test-Actor'));
      req.user = await userRepository.findOneByOrFail({ id: actorId });
      next();
    });
    directActorApp.use('/user', userRoutes);
    directActorApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const responses = await Promise.all(
        [2, secondManager.id].map((actorId) =>
          request(directActorApp)
            .post('/user/import-from-plex')
            .set('X-Test-Actor', String(actorId))
            .send({ plexIds: ['8765432'] })
        )
      );

      assert.deepStrictEqual(
        responses.map((response) => response.status),
        [201, 201]
      );
      assert.strictEqual(
        responses.reduce((total, response) => total + response.body.length, 0),
        1
      );
      assert.strictEqual(await userRepository.countBy({ plexId: 8765432 }), 1);
      assert.strictEqual(
        await userRepository.countBy({
          email: 'concurrent-import@example.com',
        }),
        1
      );
    } finally {
      getUsers.mock.restore();
    }
  });

  it('prevents delegated managers from linking Plex to another local account', async () => {
    const userRepository = getRepository(User);
    const ownerBefore = await userRepository.findOneByOrFail({ id: 1 });
    const manager = await userRepository.findOneByOrFail({ id: 2 });
    manager.permissions = Permission.MANAGE_USERS;
    await userRepository.save(manager);

    const target = await userRepository.save(
      new User({
        email: 'protected-local@example.com',
        username: 'Protected Local',
        avatar: 'https://example.com/local.png',
        userType: UserType.LOCAL,
        permissions: Permission.REQUEST_MUSIC,
      })
    );
    const unrelated = await userRepository.save(
      new User({
        email: 'unrelated-plex@example.com',
        plexUsername: 'original-unrelated',
        plexId: 7654323,
        avatar: 'https://example.com/original-unrelated.png',
        userType: UserType.PLEX,
        permissions: 0,
      })
    );

    const settings = getSettings();
    const priorDefaultPermissions = settings.main.defaultPermissions;
    const priorMachineId = settings.plex.machineId;
    settings.main.defaultPermissions = 0;
    settings.plex.machineId = 'target-machine';

    const getUsersMock = mock.method(
      PlexTvAPI.prototype,
      'getUsers',
      async () =>
        ({
          MediaContainer: {
            User: [
              {
                $: {
                  id: '7654321',
                  title: 'Protected Local',
                  username: 'plex-protected',
                  email: target.email,
                  thumb: 'https://example.com/protected.png',
                },
                Server: [
                  {
                    $: {
                      id: '1',
                      serverId: '1',
                      machineIdentifier: 'target-machine',
                      name: 'Plex',
                      lastSeenAt: '0',
                      numLibraries: '1',
                      owned: '0',
                    },
                  },
                ],
              },
              {
                $: {
                  id: '7654322',
                  title: 'Owner',
                  username: 'attacker-controlled-owner',
                  email: ownerBefore.email,
                  thumb: 'https://example.com/attacker-owner.png',
                },
                Server: [],
              },
              {
                $: {
                  id: '7654323',
                  title: 'Unrelated',
                  username: 'changed-unrelated',
                  email: unrelated.email,
                  thumb: 'https://example.com/changed-unrelated.png',
                },
                Server: [],
              },
            ],
          },
        }) as never
    );

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const res = await agent.post('/user/import-from-plex').send({
        plexIds: ['7654321', '7654322'],
      });

      assert.strictEqual(res.status, 201);
      assert.deepStrictEqual(res.body, []);
      const persisted = await userRepository.findOneByOrFail({ id: target.id });
      assert.strictEqual(persisted.userType, UserType.LOCAL);
      assert.strictEqual(persisted.plexId, null);
      assert.strictEqual(persisted.plexUsername, null);
      assert.strictEqual(persisted.permissions, Permission.REQUEST_MUSIC);
      const ownerAfter = await userRepository.findOneByOrFail({ id: 1 });
      assert.strictEqual(ownerAfter.plexId, ownerBefore.plexId);
      assert.strictEqual(ownerAfter.plexUsername, ownerBefore.plexUsername);
      assert.strictEqual(ownerAfter.avatar, ownerBefore.avatar);
      const unrelatedAfter = await userRepository.findOneByOrFail({
        id: unrelated.id,
      });
      assert.strictEqual(unrelatedAfter.plexUsername, 'original-unrelated');
      assert.strictEqual(
        unrelatedAfter.avatar,
        'https://example.com/original-unrelated.png'
      );
    } finally {
      settings.main.defaultPermissions = priorDefaultPermissions;
      settings.plex.machineId = priorMachineId;
      getUsersMock.mock.restore();
    }
  });

  it('rejects malformed Jellyfin import bodies before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/import-from-jellyfin').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User body must be an object/i);
  });

  it('revalidates user-management authority before using the Jellyfin API key', async () => {
    await getRepository(User).update(1, {
      permissions: Permission.REQUEST,
    });
    const getUsers = mock.method(JellyfinAPI.prototype, 'getUsers', async () =>
      Promise.reject(new Error('provider must not be called'))
    );
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use(express.json());
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const response = await request(staleAuthorizationApp)
        .post('/user/import-from-jellyfin')
        .send({ jellyfinUserIds: [] });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(getUsers.mock.callCount(), 0);
    } finally {
      getUsers.mock.restore();
    }
  });

  it('does not import Jellyfin users after server credentials change in flight', async () => {
    const settings = getSettings();
    const previousApiKey = settings.jellyfin.apiKey;
    const jellyfinUserId = '44444444444444444444444444444444';
    settings.jellyfin.apiKey = 'initial-import-key';
    const getUsers = mock.method(
      JellyfinAPI.prototype,
      'getUsers',
      async () => {
        settings.jellyfin.apiKey = 'rotated-import-key';
        return {
          users: [
            {
              Name: 'Stale Jellyfin Import',
              ServerId: 'server',
              ServerName: 'Jellyfin',
              Id: jellyfinUserId,
              Configuration: { GroupedFolders: [] },
              Policy: { IsAdministrator: false },
            },
          ],
        } as never;
      }
    );

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const response = await agent
        .post('/user/import-from-jellyfin')
        .send({ jellyfinUserIds: [jellyfinUserId] });

      assert.strictEqual(response.status, 409);
      assert.strictEqual(
        await getRepository(User).countBy({ jellyfinUserId }),
        0
      );
    } finally {
      settings.jellyfin.apiKey = previousApiKey;
      getUsers.mock.restore();
    }
  });

  it('rejects malformed Jellyfin user IDs before provider calls', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post('/user/import-from-jellyfin')
      .send({ jellyfinUserIds: ['not-a-guid'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /jellyfinUserIds is invalid/i);
  });

  it('does not create a Jellyfin user missing from the provider response', async () => {
    const requestedId = '11111111111111111111111111111111';
    const providerId = '22222222222222222222222222222222';
    const getUsersMock = mock.method(
      JellyfinAPI.prototype,
      'getUsers',
      async () =>
        ({
          users: [
            {
              Name: 'Real Jellyfin User',
              ServerId: 'server',
              ServerName: 'Jellyfin',
              Id: providerId,
              Configuration: { GroupedFolders: [] },
              Policy: { IsAdministrator: false },
            },
          ],
        }) as never
    );

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const res = await agent
        .post('/user/import-from-jellyfin')
        .send({ jellyfinUserIds: [requestedId] });

      assert.strictEqual(res.status, 201);
      assert.deepStrictEqual(res.body, []);
      assert.strictEqual(getUsersMock.mock.callCount(), 1);
      assert.strictEqual(
        await getRepository(User).count({
          where: { jellyfinUserId: requestedId },
        }),
        0
      );
    } finally {
      getUsersMock.mock.restore();
    }
  });

  it('stores imported Jellyfin IDs in canonical form', async () => {
    const providerId = '33333333-3333-3333-3333-333333333333';
    const canonicalId = providerId.replaceAll('-', '');
    const getUsersMock = mock.method(
      JellyfinAPI.prototype,
      'getUsers',
      async () =>
        ({
          users: [
            {
              Name: 'Canonical Jellyfin User',
              ServerId: 'server',
              ServerName: 'Jellyfin',
              Id: providerId,
              Configuration: { GroupedFolders: [] },
              Policy: { IsAdministrator: false },
            },
          ],
        }) as never
    );

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const res = await agent
        .post('/user/import-from-jellyfin')
        .send({ jellyfinUserIds: [providerId] });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.length, 1);
      assert.strictEqual(
        await getRepository(User).count({
          where: { jellyfinUserId: canonicalId },
        }),
        1
      );
    } finally {
      getUsersMock.mock.restore();
    }
  });

  it('saves card text visibility settings per user', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const saveRes = await agent.post('/user/1/settings/card-text').send({
      movie: 'always',
      book: 'hover',
    });

    assert.strictEqual(saveRes.status, 200);
    assert.deepStrictEqual(saveRes.body, {
      movie: 'always',
      book: 'hover',
    });

    const getRes = await agent.get('/user/1/settings/card-text');
    assert.strictEqual(getRes.status, 200);
    assert.deepStrictEqual(getRes.body, {
      movie: 'always',
      book: 'hover',
    });

    const user = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    assert.strictEqual(user.settings?.cardTextVisibilityMovie, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityBook, 'hover');
  });

  it('saves card text visibility through main user settings without clearing other media types', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    await agent.post('/user/1/settings/card-text').send({
      movie: 'always',
      book: 'hover',
    });

    const saveRes = await agent.post('/user/1/settings/main').send({
      username: 'admin',
      email: 'admin@seerr.dev',
      cardTextVisibility: {
        tv: 'always',
        album: 'hover',
      },
    });

    assert.strictEqual(saveRes.status, 200);
    assert.deepStrictEqual(saveRes.body.cardTextVisibility, {
      movie: 'always',
      tv: 'always',
      album: 'hover',
      book: 'hover',
    });

    const user = await getRepository(User).findOneOrFail({
      where: { id: 1 },
    });
    assert.strictEqual(user.settings?.cardTextVisibilityMovie, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityTv, 'always');
    assert.strictEqual(user.settings?.cardTextVisibilityAlbum, 'hover');
    assert.strictEqual(user.settings?.cardTextVisibilityBook, 'hover');
  });

  it('creates general settings for the target user and updates admin-managed quotas', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const saveRes = await agent.post('/user/2/settings/main').send({
      username: 'friend',
      email: 'friend@seerr.dev',
      locale: 'en',
      movieQuotaLimit: 7,
      movieQuotaDays: 30,
    });

    assert.strictEqual(saveRes.status, 200);

    const target = await getRepository(User).findOneOrFail({
      where: { id: 2 },
    });
    const targetSettings = await getRepository(UserSettings).findOneOrFail({
      where: { user: { id: 2 } },
      relations: { user: true },
    });

    assert.strictEqual(target.movieQuotaLimit, 7);
    assert.strictEqual(target.movieQuotaDays, 30);
    assert.strictEqual(target.settings?.id, targetSettings.id);
    assert.strictEqual(targetSettings.user.id, 2);
  });

  it('preserves omitted general settings and clears only explicit values', async () => {
    const userRepository = getRepository(User);
    const target = await userRepository.findOneByOrFail({ id: 2 });
    target.movieQuotaLimit = 9;
    target.movieQuotaDays = 45;
    target.settings = new UserSettings({
      ...target.settings,
      user: target,
      locale: 'fr',
      discoverRegion: 'CA',
      streamingRegion: 'US',
      originalLanguage: 'ja',
      discordId: '12345678901234567',
      watchlistSyncMovies: true,
      watchlistSyncTv: true,
    });
    await userRepository.save(target);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const patchRes = await agent.post('/user/2/settings/main').send({
      username: 'renamed-friend',
      email: 'friend@seerr.dev',
      locale: 'de',
    });

    assert.strictEqual(patchRes.status, 200);
    let saved = await userRepository.findOneByOrFail({ id: 2 });
    assert.strictEqual(saved.settings?.locale, 'de');
    assert.strictEqual(saved.settings?.discoverRegion, 'CA');
    assert.strictEqual(saved.settings?.streamingRegion, 'US');
    assert.strictEqual(saved.settings?.originalLanguage, 'ja');
    assert.strictEqual(saved.settings?.discordId, '12345678901234567');
    assert.strictEqual(saved.settings?.watchlistSyncMovies, true);
    assert.strictEqual(saved.settings?.watchlistSyncTv, true);
    assert.strictEqual(saved.movieQuotaLimit, 9);
    assert.strictEqual(saved.movieQuotaDays, 45);

    const clearRes = await agent.post('/user/2/settings/main').send({
      username: 'renamed-friend',
      email: 'friend@seerr.dev',
      locale: null,
      discoverRegion: null,
      watchlistSyncMovies: null,
      movieQuotaLimit: null,
    });

    assert.strictEqual(clearRes.status, 200);
    saved = await userRepository.findOneByOrFail({ id: 2 });
    assert.strictEqual(saved.settings?.locale, '');
    assert.strictEqual(saved.settings?.discoverRegion, null);
    assert.strictEqual(saved.settings?.watchlistSyncMovies, null);
    assert.strictEqual(saved.settings?.watchlistSyncTv, true);
    assert.strictEqual(saved.movieQuotaLimit, null);
    assert.strictEqual(saved.movieQuotaDays, 45);
  });

  it('creates notification settings for the target user', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const saveRes = await agent.post('/user/2/settings/notifications').send({
      pushbulletAccessToken: 'target-token',
      notificationTypes: { pushbullet: 2 },
    });

    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.body.pushbulletAccessToken, '[REDACTED]');

    const targetSettings = await getRepository(UserSettings).findOneOrFail({
      where: { user: { id: 2 } },
      relations: { user: true },
    });

    assert.strictEqual(targetSettings.user.id, 2);
    assert.strictEqual(targetSettings.pushbulletAccessToken, 'target-token');
    assert.strictEqual(targetSettings.notificationTypes.pushbullet, 2);
  });

  it('preserves stored notification credentials when saving redacted values', async () => {
    const userRepository = getRepository(User);
    const target = await userRepository.findOneByOrFail({ id: 2 });
    target.settings = new UserSettings({
      ...target.settings,
      user: target,
      pushbulletAccessToken: 'stored-pushbullet-token',
      pushoverApplicationToken: 'stored-pushover-token',
      pushoverUserKey: 'stored-pushover-user-key',
      notificationTypes: { pushbullet: 2, pushover: 4 },
    });
    await userRepository.save(target);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const saveRes = await agent.post('/user/2/settings/notifications').send({
      pushbulletAccessToken: '[REDACTED]',
      pushoverApplicationToken: '[REDACTED]',
      pushoverUserKey: '[REDACTED]',
      notificationTypes: { pushover: 8 },
    });

    assert.strictEqual(saveRes.status, 200);
    const saved = await getRepository(UserSettings).findOneOrFail({
      where: { user: { id: 2 } },
    });
    assert.strictEqual(saved.pushbulletAccessToken, 'stored-pushbullet-token');
    assert.strictEqual(saved.pushoverApplicationToken, 'stored-pushover-token');
    assert.strictEqual(saved.pushoverUserKey, 'stored-pushover-user-key');
    assert.strictEqual(saved.notificationTypes.pushover, 8);
  });

  it('preserves omitted notification fields and clears only explicit values', async () => {
    const userRepository = getRepository(User);
    const target = await userRepository.findOneByOrFail({ id: 2 });
    target.settings = new UserSettings({
      ...target.settings,
      user: target,
      pgpKey: 'stored-pgp-key',
      pushoverSound: 'siren',
      telegramChatId: '-1234',
      telegramMessageThreadId: '42',
      telegramSendSilently: true,
      notificationTypes: { email: 2, telegram: 4 },
    });
    await userRepository.save(target);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const patchRes = await agent
      .post('/user/2/settings/notifications')
      .send({ notificationTypes: { email: 8 } });

    assert.strictEqual(patchRes.status, 200);
    let saved = await getRepository(UserSettings).findOneByOrFail({
      user: { id: 2 },
    });
    assert.strictEqual(saved.pgpKey, 'stored-pgp-key');
    assert.strictEqual(saved.pushoverSound, 'siren');
    assert.strictEqual(saved.telegramChatId, '-1234');
    assert.strictEqual(saved.telegramMessageThreadId, '42');
    assert.strictEqual(saved.telegramSendSilently, true);
    assert.strictEqual(saved.notificationTypes.email, 8);
    assert.strictEqual(saved.notificationTypes.telegram, 4);

    const clearRes = await agent.post('/user/2/settings/notifications').send({
      pushoverSound: null,
      telegramMessageThreadId: null,
      telegramSendSilently: null,
    });

    assert.strictEqual(clearRes.status, 200);
    saved = await getRepository(UserSettings).findOneByOrFail({
      user: { id: 2 },
    });
    assert.strictEqual(saved.pgpKey, 'stored-pgp-key');
    assert.strictEqual(saved.pushoverSound, null);
    assert.strictEqual(saved.telegramChatId, '-1234');
    assert.strictEqual(saved.telegramMessageThreadId, null);
    assert.strictEqual(saved.telegramSendSilently, null);
    assert.strictEqual(saved.notificationTypes.email, 8);
    assert.strictEqual(saved.notificationTypes.telegram, 4);
  });

  it("does not expose another user's notification credentials", async () => {
    const userRepository = getRepository(User);
    const target = await userRepository.findOneByOrFail({ id: 2 });
    target.settings = new UserSettings({
      ...target.settings,
      pushbulletAccessToken: 'target-pushbullet-secret',
      pushoverApplicationToken: 'target-pushover-secret',
      locale: 'en',
    });
    await userRepository.save(target);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/2');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.locale, 'en');
    assert.ok(!('pushbulletAccessToken' in res.body.settings));
    assert.ok(!('pushoverApplicationToken' in res.body.settings));
  });

  it('rejects invalid card text visibility values', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/card-text').send({
      album: 'sometimes',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /album must be "always" or "hover"/i);
  });

  it('rejects malformed card text visibility bodies', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/user/1/settings/card-text').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /User settings body must be an object/i);
  });

  it('returns empty watch data for a user without a Plex account', async () => {
    const settings = getSettings();
    settings.tautulli.hostname = 'tautulli.local';
    settings.tautulli.port = 8181;
    settings.tautulli.apiKey = 'test-key';

    const user = await getRepository(User).findOneByOrFail({ id: 2 });
    user.plexId = null;
    await getRepository(User).save(user);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/user/2/watch_data');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { recentlyWatched: [], playCount: 0 });
  });

  it("revalidates administrator authority before reading another user's Tautulli history", async () => {
    const settings = getSettings();
    settings.tautulli.hostname = 'tautulli.local';
    settings.tautulli.port = 8181;
    settings.tautulli.apiKey = 'test-key';
    await getRepository(User).update(1, {
      permissions: Permission.REQUEST,
    });
    const stats = mock.method(
      TautulliAPI.prototype,
      'getUserWatchStats',
      async () => ({ total_plays: 0, total_time: 0 })
    );
    const history = mock.method(
      TautulliAPI.prototype,
      'getUserWatchHistory',
      async () => []
    );
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/user', userRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const response = await request(staleAuthorizationApp).get(
        '/user/2/watch_data'
      );

      assert.strictEqual(response.status, 403);
      assert.strictEqual(stats.mock.callCount(), 0);
      assert.strictEqual(history.mock.callCount(), 0);
    } finally {
      stats.mock.restore();
      history.mock.restore();
    }
  });
});
