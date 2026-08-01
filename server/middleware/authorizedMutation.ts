import type { Permission } from '@server/lib/permissions';
import {
  UserMutationActorUnauthorizedError,
  acquireAuthorizedUserSecurityMutation,
  runAuthorizedUserSecurityMutation,
  runUserSecurityReadWithActor,
} from '@server/lib/userSecurityMutation';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import type { Request, RequestHandler } from 'express';

const authorizedScope = Symbol('authorized-user-security-scope');
type ScopedRequest = Request & { [authorizedScope]?: true };

export const authorizedRouteScope =
  (
    permission: Permission | Permission[],
    protectedUserIds: number[] = []
  ): RequestHandler =>
  async (req, res, next) => {
    const actorId = req.user?.id;
    if (!actorId) {
      return next({ status: 403, message: 'Access denied.' });
    }

    try {
      const lease = await acquireAuthorizedUserSecurityMutation(
        actorId,
        [actorId, ...protectedUserIds],
        permission,
        {
          expectedCredentialVersion:
            req.session?.userId === actorId
              ? (req.session.credentialVersion ?? 0)
              : undefined,
        }
      );
      req.user = lease.actor;
      (req as ScopedRequest)[authorizedScope] = true;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        trackBackgroundTask('authorized route admission release', () =>
          lease.release()
        );
      };
      res.once('finish', release);
      res.once('close', release);
      next();
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'Your permission changed before the operation was applied.',
        });
      }
      return next(error);
    }
  };

export const authorizedRouteAccess =
  (permission: Permission | Permission[]): RequestHandler =>
  async (req, _res, next) => {
    const actorId = req.user?.id;
    if (!actorId) {
      return next({ status: 403, message: 'Access denied.' });
    }

    try {
      const actor = await runUserSecurityReadWithActor(
        actorId,
        actorId,
        permission,
        async (currentActor) => currentActor,
        {
          requirePermission: true,
          expectedCredentialVersion:
            req.session?.userId === actorId
              ? (req.session.credentialVersion ?? 0)
              : undefined,
        }
      );
      req.user = actor;
      next();
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'Your permission changed before the operation was applied.',
        });
      }
      return next(error);
    }
  };

export const authorizedMutation =
  <
    Params = Record<string, string>,
    ResponseBody = unknown,
    RequestBody = unknown,
    RequestQuery = Request['query'],
    Locals extends Record<string, unknown> = Record<string, unknown>,
  >(
    permission: Permission | Permission[],
    handler: RequestHandler<
      Params,
      ResponseBody,
      RequestBody,
      RequestQuery,
      Locals
    >
  ): RequestHandler<Params, ResponseBody, RequestBody, RequestQuery, Locals> =>
  async (req, res, next) => {
    const actorId = req.user?.id;
    if (!actorId) {
      return next({ status: 403, message: 'Access denied.' });
    }

    if ((req as unknown as ScopedRequest)[authorizedScope]) {
      if (!req.user?.hasPermission(permission, { type: 'or' })) {
        return next({ status: 403, message: 'Access denied.' });
      }
      await handler(req, res, next);
      return;
    }

    try {
      await runAuthorizedUserSecurityMutation(
        actorId,
        actorId,
        permission,
        async (actor) => {
          req.user = actor;
          await handler(req, res, next);
        },
        {
          expectedCredentialVersion:
            req.session?.userId === actorId
              ? (req.session.credentialVersion ?? 0)
              : undefined,
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'Your permission changed before the operation was applied.',
        });
      }
      return next(error);
    }
  };
