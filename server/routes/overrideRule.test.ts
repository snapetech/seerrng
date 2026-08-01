import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceCollectionMutationAdmission } from '@server/lib/serviceAdmission';
import {
  assertServarrServiceCanBeRemoved,
  ServarrServiceInUseError,
} from '@server/lib/serviceId';
import type {
  LidarrSettings,
  RadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import overrideRuleRoutes from './overrideRule';

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
  app.use('/overrideRule', overrideRuleRoutes);
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

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

beforeEach(() => {
  const settings = getSettings();
  settings.radarr = [{ id: 0 } as RadarrSettings, { id: 3 } as RadarrSettings];
  settings.sonarr = [{ id: 0 } as SonarrSettings];
  settings.lidarr = [{ id: 0 } as LidarrSettings];
});

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('Override rule route validation', () => {
  it('revalidates administrator authority before reading override rules', async () => {
    await getRepository(OverrideRule).save(
      new OverrideRule({ users: 'private-rule@seerr.dev' })
    );
    await getRepository(User).update(1, { permissions: Permission.REQUEST });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/overrideRule', overrideRuleRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) => res.status(err.status ?? 500).json(err)
    );

    const response = await request(staleAuthorizationApp).get('/overrideRule');

    assert.strictEqual(response.status, 403);
    assert.doesNotMatch(JSON.stringify(response.body), /private-rule/);
  });

  it('rejects malformed create bodies before persistence', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const res = await agent.post('/overrideRule').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Override rule body must be an object/i);
    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('rejects oversized rule strings before persistence', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const res = await agent
      .post('/overrideRule')
      .send({ users: 'x'.repeat(501) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /500 characters or fewer/);
    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('rejects malformed numeric rule fields before persistence', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const res = await agent
      .post('/overrideRule')
      .send({ profileId: '1', users: '1', radarrServiceId: 0 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Profile ID must be a valid ID/);
    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('rejects malformed or oversized override ID lists', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    for (const body of [
      { users: '1,not-a-user' },
      { genre: '0' },
      { keywords: '1,' },
      { tags: '-1' },
      {
        tags: Array.from({ length: 101 }, (_, index) => String(index)).join(
          ','
        ),
      },
    ]) {
      const response = await agent.post('/overrideRule').send(body);
      assert.strictEqual(response.status, 400);
      assert.match(response.body.message, /IDs|invalid ID/i);
    }

    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('canonicalizes valid override ID lists', async () => {
    const agent = await login();

    const response = await agent.post('/overrideRule').send({
      users: '2, 1,2',
      genre: '18,18',
      language: 'en|fr|en',
      keywords: '99',
      tags: '0, 7,7',
      profileId: 0,
      radarrServiceId: 0,
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.users, '2,1');
    assert.strictEqual(response.body.genre, '18');
    assert.strictEqual(response.body.language, 'en|fr');
    assert.strictEqual(response.body.keywords, '99');
    assert.strictEqual(response.body.tags, '0,7');
  });

  it('rejects semantically unusable and ambiguous rules', async () => {
    const agent = await login();
    const beforeCount = await getRepository(OverrideRule).count();

    const cases: [Record<string, unknown>, RegExp][] = [
      [{ users: '1', profileId: 1 }, /exactly one service/i],
      [
        { radarrServiceId: 999, users: '1', profileId: 1 },
        /service does not exist/i,
      ],
      [{ radarrServiceId: 0, profileId: 1 }, /at least one condition/i],
      [{ radarrServiceId: 0, users: '1' }, /at least one setting/i],
      [
        {
          radarrServiceId: 0,
          sonarrServiceId: 0,
          users: '1',
          profileId: 1,
        },
        /exactly one service/i,
      ],
      [
        { lidarrServiceId: 0, genre: '18', profileId: 1 },
        /only user conditions/i,
      ],
      [
        {
          radarrServiceId: 0,
          users: '1',
          profileId: 1,
          language: 'english',
        },
        /ISO 639-1/i,
      ],
      [
        {
          radarrServiceId: 0,
          users: '1',
          profileId: 1,
          profleId: 2,
        },
        /unknown override rule field/i,
      ],
    ];

    for (const [body, expectedError] of cases) {
      const response = await agent.post('/overrideRule').send(body);
      assert.strictEqual(response.status, 400);
      assert.match(response.body.message, expectedError);
    }

    assert.strictEqual(await getRepository(OverrideRule).count(), beforeCount);
  });

  it('returns a sanitized server error when persistence fails', async () => {
    const repository = getRepository(OverrideRule);
    mock.method(repository, 'save', async () => {
      throw new Error('SQLITE_ERROR: no such column: private_schema.secret');
    });
    const agent = await login();

    const res = await agent.post('/overrideRule').send({
      users: '1',
      profileId: 1,
      radarrServiceId: 0,
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Unable to process override rules.');
    assert.doesNotMatch(JSON.stringify(res.body), /private_schema|SQLITE/i);
  });

  it('prevents service deletion from racing a rule create', async () => {
    const repository = getRepository(OverrideRule);
    const save = repository.save.bind(repository);
    let releaseSave!: () => void;
    const heldSave = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saveEntered!: () => void;
    const saveEnteredPromise = new Promise<void>((resolve) => {
      saveEntered = resolve;
    });
    mock.method(repository, 'save', async (rule: OverrideRule) => {
      saveEntered();
      await heldSave;
      return save(rule);
    });
    const agent = await login();

    const create = Promise.resolve(
      agent.post('/overrideRule').send({
        users: '1',
        profileId: 1,
        radarrServiceId: 0,
      })
    );
    await saveEnteredPromise;

    let deletionEntered = false;
    const deletion = runWithServarrServiceCollectionMutationAdmission(
      'radarr',
      async () => {
        deletionEntered = true;
        await assertServarrServiceCanBeRemoved('radarr', 0);
        getSettings().radarr = [];
      }
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(deletionEntered, false);

    releaseSave();
    const response = await create;
    await assert.rejects(deletion, ServarrServiceInUseError);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(deletionEntered, true);
    assert.ok(getSettings().radarr.some(({ id }) => id === 0));
    assert.strictEqual(await repository.countBy({ radarrServiceId: 0 }), 1);
  });

  it('rejects malformed rule IDs before lookup on update', async () => {
    const agent = await login();

    const res = await agent
      .put('/overrideRule/not-a-number')
      .send({ users: '1' });

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed update bodies before persistence', async () => {
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({
        users: '1',
      })
    );
    const agent = await login();

    const res = await agent.put(`/overrideRule/${rule.id}`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Override rule body must be an object/i);
  });

  it('rejects malformed rule IDs before lookup on delete', async () => {
    const agent = await login();

    const res = await agent.delete('/overrideRule/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('allows explicit nulls to clear optional rule fields', async () => {
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({
        users: '1',
        genre: 'Action',
        language: 'en',
        profileId: 1,
        rootFolder: '/remaining',
        radarrServiceId: 0,
      })
    );

    const agent = await login();
    const res = await agent.put(`/overrideRule/${rule.id}`).send({
      users: null,
      genre: null,
      profileId: null,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.users, null);
    assert.strictEqual(res.body.genre, null);
    assert.strictEqual(res.body.profileId, null);
    assert.strictEqual(res.body.language, 'en');
    assert.strictEqual(res.body.rootFolder, '/remaining');
  });

  it('preserves fields omitted from a partial rule update', async () => {
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({
        users: '1,2',
        genre: '18',
        profileId: 7,
        radarrServiceId: 3,
      })
    );

    const agent = await login();
    const res = await agent
      .put(`/overrideRule/${rule.id}`)
      .send({ genre: '35' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.genre, '35');
    assert.strictEqual(res.body.users, '1,2');
    assert.strictEqual(res.body.profileId, 7);
    assert.strictEqual(res.body.radarrServiceId, 3);
  });

  it('rejects partial updates that make the persisted rule invalid', async () => {
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({
        users: '1',
        profileId: 7,
        radarrServiceId: 3,
      })
    );
    const agent = await login();

    const response = await agent
      .put(`/overrideRule/${rule.id}`)
      .send({ profileId: null });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /at least one setting/i);
    const persistedRule = await getRepository(OverrideRule).findOneByOrFail({
      id: rule.id,
    });
    assert.strictEqual(persistedRule.profileId, 7);
  });
});
