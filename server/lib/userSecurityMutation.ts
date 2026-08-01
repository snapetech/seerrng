import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  Permission,
  PermissionCheckOptions,
} from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import AsyncLock from '@server/utils/asyncLock';
import { AsyncLocalStorage } from 'node:async_hooks';

const userSecurityMutationLock = new AsyncLock();
const userCredentialAuthorityContext = new AsyncLocalStorage<{
  actorId: number;
  expectedCredentialVersion?: number;
  isCurrent?: () => boolean;
  isActive: () => boolean;
}>();

export class UserMutationActorUnauthorizedError extends Error {
  public readonly status = 403;
}

export interface AuthorizedUserSecurityMutationLease {
  actor: User;
  release: () => Promise<void>;
}

export interface UserCredentialVersionOptions {
  expectedCredentialVersion?: number;
}

export const runWithUserCredentialVersionContext = <Result>(
  actorId: number,
  expectedCredentialVersion: number,
  callback: () => Result,
  isActive: () => boolean = () => true
): Result => {
  if (
    !Number.isSafeInteger(actorId) ||
    actorId <= 0 ||
    !Number.isSafeInteger(expectedCredentialVersion) ||
    expectedCredentialVersion < 0
  ) {
    throw new Error('A valid user credential context is required.');
  }

  return userCredentialAuthorityContext.run(
    { actorId, expectedCredentialVersion, isActive },
    callback
  );
};

export const runWithUserApiKeyAuthorityContext = <Result>(
  actorId: number,
  isCurrent: () => boolean,
  callback: () => Result,
  isActive: () => boolean = () => true
): Result => {
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new Error('A valid user API key context is required.');
  }

  return userCredentialAuthorityContext.run(
    { actorId, isCurrent, isActive },
    callback
  );
};

const isRequestCredentialAuthorityCurrent = (
  actorId: number,
  actor: User,
  explicitExpectedCredentialVersion?: number
): boolean => {
  const context = userCredentialAuthorityContext.getStore();
  const activeContext =
    context?.actorId === actorId && context.isActive() ? context : undefined;
  const expectedCredentialVersion =
    explicitExpectedCredentialVersion ??
    activeContext?.expectedCredentialVersion;

  return (
    isUserCredentialVersionCurrent(actor, expectedCredentialVersion) &&
    (activeContext?.isCurrent?.() ?? true)
  );
};

export const getUserCredentialVersion = (
  user: Pick<User, 'passwordChangedAt'>
): number => user.passwordChangedAt?.getTime() ?? 0;

export const isUserCredentialVersionCurrent = (
  user: Pick<User, 'passwordChangedAt'>,
  expectedCredentialVersion?: number
): boolean =>
  expectedCredentialVersion === undefined ||
  getUserCredentialVersion(user) === expectedCredentialVersion;

export const isUserSessionCredentialVersionCurrent = (
  user: Pick<User, 'passwordChangedAt'>,
  sessionCredentialVersion?: number
): boolean =>
  getUserCredentialVersion(user) === (sessionCredentialVersion ?? 0);

export const getUserSecurityMutationResource = (userId: number): string =>
  `user-security:user:${userId}`;

const runUserSecurityMutationUnchecked = <Result>(
  userIds: number | number[],
  callback: () => Promise<Result>
): Promise<Result> => {
  const requestedIds = Array.isArray(userIds) ? userIds : [userIds];
  if (
    requestedIds.length === 0 ||
    requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('A valid user ID is required for a security mutation.');
  }
  const ids = [...new Set(requestedIds)].sort((left, right) => left - right);

  const resources = ids.map(getUserSecurityMutationResource);
  const dispatch = (index: number): Promise<Result> =>
    index === resources.length
      ? callback()
      : userSecurityMutationLock.dispatch(resources[index], () =>
          dispatch(index + 1)
        );

  return requestAdmissionCoordinator.run(resources, () => dispatch(0));
};

export const runUserSecurityMutation = <Result>(
  userIds: number | number[],
  callback: () => Promise<Result>
): Promise<Result> => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const context = userCredentialAuthorityContext.getStore();

  return runUserSecurityMutationUnchecked(ids, async () => {
    if (context?.isActive() && ids.includes(context.actorId)) {
      const actor = await getRepository(User).findOneBy({
        id: context.actorId,
      });
      if (
        !actor ||
        !isRequestCredentialAuthorityCurrent(context.actorId, actor)
      ) {
        throw new UserMutationActorUnauthorizedError(
          'User credentials changed before admission.'
        );
      }
    }
    return callback();
  });
};

export const runAuthorizedUserSecurityMutation = <Result>(
  actorId: number,
  targetIds: number | number[],
  permission: Permission | Permission[],
  callback: (actor: User) => Promise<Result>,
  options: UserCredentialVersionOptions = {}
): Promise<Result> =>
  runUserSecurityMutationUnchecked(
    [actorId, ...(Array.isArray(targetIds) ? targetIds : [targetIds])],
    async () => {
      const actor = await getRepository(User).findOneBy({ id: actorId });
      if (
        !actor?.hasPermission(permission, { type: 'or' }) ||
        !isRequestCredentialAuthorityCurrent(
          actorId,
          actor,
          options.expectedCredentialVersion
        )
      ) {
        throw new UserMutationActorUnauthorizedError(
          'User mutation authority changed before admission.'
        );
      }
      return callback(actor);
    }
  );

export interface AuthorizedUserSecurityReadOptions extends UserCredentialVersionOptions {
  permissionCheckOptions?: PermissionCheckOptions;
  requirePermission?: boolean;
}

/**
 * Revalidates read authorization without holding the mutation lock while the
 * response is being prepared. Reads must observe current authority, but they
 * do not mutate credentials or permissions and must not block those mutations
 * for the lifetime of an HTTP response.
 */
export const runUserSecurityReadWithActor = async <Result>(
  actorId: number,
  targetIds: number | number[],
  permissionForOtherUsers: Permission | Permission[],
  callback: (actor: User) => Promise<Result>,
  options: AuthorizedUserSecurityReadOptions = {}
): Promise<Result> => {
  const targets = Array.isArray(targetIds) ? targetIds : [targetIds];
  const ids = [actorId, ...targets];
  if (
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    targets.length === 0
  ) {
    throw new Error('A valid user ID is required for a security read.');
  }

  const actor = await getRepository(User).findOneBy({ id: actorId });
  if (
    !actor ||
    !isRequestCredentialAuthorityCurrent(
      actorId,
      actor,
      options.expectedCredentialVersion
    ) ||
    ((options.requirePermission ||
      targets.some((targetId) => targetId !== actorId)) &&
      !actor.hasPermission(
        permissionForOtherUsers,
        options.permissionCheckOptions ?? { type: 'or' }
      ))
  ) {
    throw new UserMutationActorUnauthorizedError(
      'User read authority changed before access.'
    );
  }

  return callback(actor);
};

export const acquireAuthorizedUserSecurityMutation = async (
  actorId: number,
  targetIds: number | number[],
  permission: Permission | Permission[],
  options: UserCredentialVersionOptions = {}
): Promise<AuthorizedUserSecurityMutationLease> => {
  let releaseLock!: () => void;
  const releaseSignal = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let resolveActor!: (actor: User) => void;
  let rejectActor!: (error: unknown) => void;
  const actorPromise = new Promise<User>((resolve, reject) => {
    resolveActor = resolve;
    rejectActor = reject;
  });
  let acquisitionError: unknown;
  const completion = runAuthorizedUserSecurityMutation(
    actorId,
    targetIds,
    permission,
    async (actor) => {
      resolveActor(actor);
      await releaseSignal;
    },
    options
  ).catch((error) => {
    acquisitionError = error;
    rejectActor(error);
  });

  const actor = await actorPromise;
  let released = false;
  return {
    actor,
    release: async () => {
      if (!released) {
        released = true;
        releaseLock();
      }
      await completion;
      if (acquisitionError) {
        throw acquisitionError;
      }
    },
  };
};

export const runUserSecurityMutationWithActor = <Result>(
  actorId: number,
  targetIds: number | number[],
  permissionForOtherUsers: Permission | Permission[],
  callback: (actor: User) => Promise<Result>,
  options: UserCredentialVersionOptions = {}
): Promise<Result> => {
  const targets = Array.isArray(targetIds) ? targetIds : [targetIds];
  return runUserSecurityMutationUnchecked([actorId, ...targets], async () => {
    const actor = await getRepository(User).findOneBy({ id: actorId });
    if (
      !actor ||
      !isRequestCredentialAuthorityCurrent(
        actorId,
        actor,
        options.expectedCredentialVersion
      ) ||
      (targets.some((targetId) => targetId !== actorId) &&
        !actor.hasPermission(permissionForOtherUsers, { type: 'or' }))
    ) {
      throw new UserMutationActorUnauthorizedError(
        'User mutation authority changed before admission.'
      );
    }
    return callback(actor);
  });
};
