import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import * as datasource from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import requestAdmissionCoordinator from './requestAdmission';
import {
  UserMutationActorUnauthorizedError,
  acquireAuthorizedUserSecurityMutation,
  getUserSecurityMutationResource,
  runAuthorizedUserSecurityMutation,
  runUserSecurityMutation,
  runUserSecurityMutationWithActor,
  runUserSecurityReadWithActor,
  runWithUserApiKeyAuthorityContext,
  runWithUserCredentialVersionContext,
} from './userSecurityMutation';

describe('runUserSecurityMutation', () => {
  it('deduplicates and orders cross-instance user resources', async () => {
    const run = mock.method(
      requestAdmissionCoordinator,
      'run',
      async (_resources: string[], callback: () => Promise<string>) =>
        callback()
    );

    const result = await runUserSecurityMutation([9, 3, 9], async () => 'ok');

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(run.mock.calls[0].arguments[0], [
      getUserSecurityMutationResource(3),
      getUserSecurityMutationResource(9),
    ]);
    run.mock.restore();
  });

  it('rejects empty or invalid resource sets', () => {
    for (const ids of [[], [0, Number.NaN], [1, Number.NaN]]) {
      assert.throws(
        () => runUserSecurityMutation(ids, async () => undefined),
        /valid user ID/
      );
    }
  });

  it('serializes mutations locally when advisory locks are unavailable', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runUserSecurityMutation(12, async () => {
      events.push('first-start');
      firstStarted();
      await releaseFirstPromise;
      events.push('first-end');
    });
    await firstStartedPromise;
    const second = runUserSecurityMutation(12, async () => {
      events.push('second');
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(events, ['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepStrictEqual(events, ['first-start', 'first-end', 'second']);
  });

  it('does not block reads behind an active mutation', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({ id: 12, permissions: Permission.MANAGE_USERS }),
    }));

    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runUserSecurityMutation(12, async () => {
      firstStarted();
      await releaseFirstPromise;
    });
    await firstStartedPromise;

    const read = runUserSecurityReadWithActor(
      12,
      12,
      Permission.MANAGE_USERS,
      async (actor) => actor.id
    );
    const observed = await Promise.race([
      read,
      new Promise<'timed-out'>((resolve) =>
        setTimeout(() => resolve('timed-out'), 100)
      ),
    ]);

    releaseFirst();
    await first;
    assert.strictEqual(observed, 12);
    await read;
    mock.restoreAll();
  });

  it('reloads the actor before admitting an authorized mutation', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({ id: 4, permissions: Permission.MANAGE_USERS }),
    }));

    const result = await runAuthorizedUserSecurityMutation(
      4,
      9,
      Permission.MANAGE_USERS,
      async (actor) => actor.id
    );

    assert.strictEqual(result, 4);
    mock.restoreAll();
  });

  it('rejects an actor whose authority was revoked before admission', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () => new User({ id: 4, permissions: 0 }),
    }));

    await assert.rejects(
      runAuthorizedUserSecurityMutation(
        4,
        9,
        Permission.MANAGE_USERS,
        async () => undefined
      ),
      UserMutationActorUnauthorizedError
    );
    mock.restoreAll();
  });

  it('rejects authorized and ownership mutations after credential rotation', async () => {
    const changedAt = new Date('2026-07-16T12:00:00.000Z');
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({
          id: 4,
          permissions: Permission.MANAGE_USERS,
          passwordChangedAt: changedAt,
        }),
    }));
    const options = {
      expectedCredentialVersion: changedAt.getTime() - 1,
    };

    await assert.rejects(
      runAuthorizedUserSecurityMutation(
        4,
        9,
        Permission.MANAGE_USERS,
        async () => undefined,
        options
      ),
      UserMutationActorUnauthorizedError
    );
    await assert.rejects(
      runUserSecurityMutationWithActor(
        4,
        4,
        Permission.MANAGE_USERS,
        async () => undefined,
        options
      ),
      UserMutationActorUnauthorizedError
    );
    mock.restoreAll();
  });

  it('propagates request credential context through asynchronous admission', async () => {
    const changedAt = new Date('2026-07-16T12:00:00.000Z');
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({
          id: 4,
          permissions: Permission.MANAGE_USERS,
          passwordChangedAt: changedAt,
        }),
    }));

    await assert.rejects(
      runWithUserCredentialVersionContext(
        4,
        changedAt.getTime() - 1,
        async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          return runAuthorizedUserSecurityMutation(
            4,
            4,
            Permission.MANAGE_USERS,
            async () => undefined
          );
        }
      ),
      UserMutationActorUnauthorizedError
    );
    await assert.rejects(
      runWithUserCredentialVersionContext(4, changedAt.getTime() - 1, () =>
        runUserSecurityMutation(4, async () => undefined)
      ),
      UserMutationActorUnauthorizedError
    );
    mock.restoreAll();
  });

  it('does not leak a completed request credential context into background work', async () => {
    const changedAt = new Date('2026-07-16T12:00:00.000Z');
    let active = true;
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({
          id: 4,
          permissions: Permission.MANAGE_USERS,
          passwordChangedAt: changedAt,
        }),
    }));

    const result = await runWithUserCredentialVersionContext(
      4,
      changedAt.getTime() - 1,
      async () => {
        active = false;
        await new Promise<void>((resolve) => setImmediate(resolve));
        return runAuthorizedUserSecurityMutation(
          4,
          4,
          Permission.MANAGE_USERS,
          async () => 'background-complete'
        );
      },
      () => active
    );

    assert.strictEqual(result, 'background-complete');
    mock.restoreAll();
  });

  it('rejects mutations after request API key authority changes', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () => new User({ id: 1, permissions: Permission.ADMIN }),
    }));
    let current = true;

    await assert.rejects(
      runWithUserApiKeyAuthorityContext(
        1,
        () => current,
        async () => {
          current = false;
          return runAuthorizedUserSecurityMutation(
            1,
            1,
            Permission.ADMIN,
            async () => undefined
          );
        }
      ),
      UserMutationActorUnauthorizedError
    );
    await assert.rejects(
      runWithUserApiKeyAuthorityContext(
        1,
        () => false,
        () => runUserSecurityMutation(1, async () => undefined)
      ),
      UserMutationActorUnauthorizedError
    );
    mock.restoreAll();
  });

  it('holds an authorized lease until explicit release', async () => {
    mock.method(datasource, 'getRepository', () => ({
      findOneBy: async () =>
        new User({ id: 4, permissions: Permission.MANAGE_USERS }),
    }));
    const lease = await acquireAuthorizedUserSecurityMutation(
      4,
      4,
      Permission.MANAGE_USERS
    );
    let secondAdmitted = false;
    const second = runUserSecurityMutation(4, async () => {
      secondAdmitted = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(lease.actor.id, 4);
    assert.strictEqual(secondAdmitted, false);
    await lease.release();
    await second;
    assert.strictEqual(secondAdmitted, true);
    mock.restoreAll();
  });
});
