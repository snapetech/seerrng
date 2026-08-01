import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI, {
  MAX_PLEX_SHARED_USERS,
  plexUserHasServerAccess,
} from '@server/api/plextv';
import TautulliAPI, { isTautulliNoDataError } from '@server/api/tautulli';
import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type {
  QuotaResponse,
  UserRequestsResponse,
  UserResultsResponse,
  UserWatchDataResponse,
} from '@server/interfaces/api/userInterfaces';
import {
  getAuthAccountAdmissionResource,
  runAuthAccountAdmission,
} from '@server/lib/authAccountAdmission';
import {
  ConfigurationAuthorityChangedError,
  captureConfigurationAuthority,
  runWithConfigurationAdmission,
  runWithConfigurationSnapshot,
} from '@server/lib/configurationAdmission';
import { hydrateMediaRequestRelations } from '@server/lib/mediaRequestHydration';
import {
  MediaServerUserAuthorityChangedError,
  assertMediaServerUserAuthorityCurrent,
  type MediaServerUserAuthoritySnapshot,
} from '@server/lib/mediaServerUserAuthority';
import {
  MAX_PERMISSION_VALUE,
  Permission,
  isValidPermissionValue,
} from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import { getSettings } from '@server/lib/settings';
import {
  UserMutationActorUnauthorizedError,
  runAuthorizedUserSecurityMutation,
  runUserSecurityMutation,
  runUserSecurityMutationWithActor,
  runUserSecurityReadWithActor,
} from '@server/lib/userSecurityMutation';
import { getCombinedWatchlist } from '@server/lib/watchlist';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { authorizedRouteAccess } from '@server/middleware/authorizedMutation';
import AsyncLock from '@server/utils/asyncLock';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import {
  MAX_PAGINATION_OFFSET,
  parseNonNegativeInt,
  parsePageParams,
  parsePositiveInt,
} from '@server/utils/pagination';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  getRateLimitKey,
  hasAsciiControlCharacters,
  resolvesToLocalOrPrivateAddress,
} from '@server/utils/security';
import { escapeSqlLikePattern } from '@server/utils/sqlLike';
import {
  parseBoundedString,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import gravatarUrl from 'gravatar-url';
import { findIndex, sortBy } from 'lodash';
import type { EntityManager, FindOptionsWhere } from 'typeorm';
import { EntityNotFoundError, In, Not, Raw } from 'typeorm';
import userSettingsRoutes from './usersettings';

const router = Router();
const MAX_USER_SEARCH_QUERY_LENGTH = 200;
const MAX_USER_SORT_LENGTH = 40;

const parseOptionalUserQueryString = (
  value: unknown,
  fieldName: string,
  maxLength: number
) =>
  parseOptionalBoundedString(value, {
    fieldName,
    maxLength,
  });
const MAX_BULK_USER_IDS = 250;
const MAX_PROVIDER_IMPORT_IDS = 250;
export const USER_REQUEST_DELETE_BATCH_SIZE = 250;

export const removeUserRequestsInBatches = async (
  manager: EntityManager,
  userId: number
): Promise<void> => {
  const requestRepository = manager.getRepository(MediaRequest);

  for (;;) {
    const requests = await requestRepository.find({
      where: { requestedBy: { id: userId } },
      order: { id: 'ASC' },
      take: USER_REQUEST_DELETE_BATCH_SIZE,
    });
    if (!requests.length) {
      return;
    }

    await requestRepository.remove(requests, {
      chunk: USER_REQUEST_DELETE_BATCH_SIZE,
    });
  }
};
const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_KEY_LENGTH = 512;
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 25;
export const PUSH_SUBSCRIPTION_REGISTRATION_LIMIT = 30;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_USER_ID_VALUE = 1_000_000_000;
const MAX_WATCHLIST_PAGE = 500;
const pushSubscriptionMutationLock = new AsyncLock();
const pushSubscriptionRegistrationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: PUSH_SUBSCRIPTION_REGISTRATION_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `user:${req.user.id}` : getRateLimitKey(req),
});

export const runPushSubscriptionMutation = <T>(
  userId: number,
  callback: () => Promise<T>
): Promise<T> =>
  runUserSecurityMutation(userId, () =>
    requestAdmissionCoordinator.run([`push-subscription:user:${userId}`], () =>
      pushSubscriptionMutationLock.dispatch(
        `push-subscription:${userId}`,
        callback
      )
    )
  );

const runAuthorizedPushSubscriptionMutation = <T>(
  actorId: number,
  userId: number,
  callback: (actor: User) => Promise<T>
): Promise<T> =>
  runUserSecurityMutationWithActor(
    actorId,
    userId,
    Permission.MANAGE_USERS,
    (actor) =>
      requestAdmissionCoordinator.run(
        [`push-subscription:user:${userId}`],
        () =>
          pushSubscriptionMutationLock.dispatch(
            `push-subscription:${userId}`,
            () => callback(actor)
          )
      )
  );

class ProtectedAdministratorMutationError extends Error {}
class PushSubscriptionLimitError extends Error {}

export const isUniqueConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as {
    code?: unknown;
    message?: unknown;
    driverError?: { code?: unknown; message?: unknown };
  };
  const code = String(record.driverError?.code ?? record.code ?? '');
  const message = String(record.driverError?.message ?? record.message ?? '');
  return (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/i.test(message))
  );
};

const parseStringArray = (
  value: unknown,
  options: {
    fieldName: string;
    maxItems: number;
    maxItemLength: number;
    required?: boolean;
  }
): { value: string[] } | { error: string } => {
  if (value === undefined && options.required === false) {
    return { value: [] };
  }

  if (!Array.isArray(value) || value.length > options.maxItems) {
    return { error: `${options.fieldName} is invalid.` };
  }

  const parsedValues = new Set<string>();

  for (const item of value) {
    const parsed = parseBoundedString(item, {
      fieldName: options.fieldName,
      maxLength: options.maxItemLength,
    });

    if ('error' in parsed) {
      return parsed;
    }

    parsedValues.add(parsed.value);
  }

  return { value: [...parsedValues] };
};

const parsePositiveIntegerArray = (
  value: unknown,
  options: { fieldName: string; maxItems: number }
): { value: number[] } | { error: string } => {
  if (!Array.isArray(value) || value.length > options.maxItems) {
    return { error: `${options.fieldName} is invalid.` };
  }

  const parsedValues = new Set<number>();

  for (const item of value) {
    const parsedValue =
      typeof item === 'number'
        ? item
        : typeof item === 'string' && item.trim() !== ''
          ? Number(item)
          : undefined;
    const parsed = parseOptionalNonNegativeInteger(parsedValue);

    if (!parsed || parsed < 1) {
      return { error: `${options.fieldName} contains an invalid id.` };
    }

    parsedValues.add(parsed);
  }

  return { value: [...parsedValues] };
};

const parseUserRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, MAX_USER_ID_VALUE);

const parseOptionalIncludeUserIds = (
  value: unknown
): { value: number[] } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: [] };
  }

  const values = Array.isArray(value)
    ? value.flatMap((item) => String(item).split(','))
    : String(value).split(',');

  return parsePositiveIntegerArray(values, {
    fieldName: 'includeIds',
    maxItems: MAX_BULK_USER_IDS,
  });
};

const parseUserBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'User body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

const parseOptionalUserBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (body === undefined || body === null) {
    return { value: {} };
  }

  return parseUserBodyObject(body);
};

const validatePushSubscriptionEndpoint = async (
  endpoint: string
): Promise<{ value: string } | { error: string }> => {
  if (hasAsciiControlCharacters(endpoint)) {
    return { error: 'endpoint must not contain control characters.' };
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return { error: 'endpoint must be a valid URL.' };
  }

  if (parsedEndpoint.protocol !== 'https:') {
    return { error: 'endpoint must be an HTTPS URL.' };
  }

  if (parsedEndpoint.username || parsedEndpoint.password) {
    return { error: 'endpoint must not include credentials.' };
  }

  if (parsedEndpoint.hash) {
    return { error: 'endpoint must not include a fragment.' };
  }

  if (
    process.env.SEERR_ALLOW_PRIVATE_PUSH_ENDPOINTS !== 'true' &&
    (await resolvesToLocalOrPrivateAddress(parsedEndpoint.hostname))
  ) {
    return { error: 'endpoint must be a public HTTPS URL.' };
  }

  return { value: parsedEndpoint.toString() };
};

const parsePushSubscriptionBody = async (
  body: unknown
): Promise<
  | {
      value: Pick<
        UserPushSubscription,
        'auth' | 'endpoint' | 'p256dh' | 'userAgent'
      >;
    }
  | { error: string }
> => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const endpoint = parseBoundedString(parsedBody.value.endpoint, {
    fieldName: 'endpoint',
    maxLength: MAX_PUSH_ENDPOINT_LENGTH,
  });

  if ('error' in endpoint) {
    return endpoint;
  }

  const validatedEndpoint = await validatePushSubscriptionEndpoint(
    endpoint.value
  );
  if ('error' in validatedEndpoint) {
    return validatedEndpoint;
  }

  const auth = parseBoundedString(parsedBody.value.auth, {
    fieldName: 'auth',
    maxLength: MAX_PUSH_KEY_LENGTH,
  });

  if ('error' in auth) {
    return auth;
  }

  const p256dh = parseBoundedString(parsedBody.value.p256dh, {
    fieldName: 'p256dh',
    maxLength: MAX_PUSH_KEY_LENGTH,
  });

  if ('error' in p256dh) {
    return p256dh;
  }

  const userAgent = parseOptionalBoundedString(parsedBody.value.userAgent, {
    fieldName: 'userAgent',
    maxLength: MAX_USER_AGENT_LENGTH,
  });

  if ('error' in userAgent) {
    return userAgent;
  }

  return {
    value: {
      auth: auth.value,
      endpoint: validatedEndpoint.value,
      p256dh: p256dh.value,
      userAgent: userAgent.value ?? '',
    },
  };
};

const parsePushSubscriptionEndpointParam = async (
  value: unknown
): Promise<{ value: string } | { error: string }> => {
  const endpoint = parseBoundedString(value, {
    fieldName: 'endpoint',
    maxLength: MAX_PUSH_ENDPOINT_LENGTH,
  });

  if ('error' in endpoint) {
    return endpoint;
  }

  return validatePushSubscriptionEndpoint(endpoint.value);
};

const parseLocalUserBody = (
  body: unknown
):
  | {
      value: {
        avatar?: string;
        email: string;
        password?: string;
        username: string;
      };
    }
  | { error: string } => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const username = parseBoundedString(parsedBody.value.username, {
    fieldName: 'username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });

  if ('error' in username) {
    return username;
  }

  const email = parseOptionalBoundedString(parsedBody.value.email, {
    fieldName: 'email',
    maxLength: USER_SETTINGS_LIMITS.email,
  });

  if ('error' in email) {
    return email;
  }

  const password = parseOptionalBoundedString(parsedBody.value.password, {
    fieldName: 'password',
    maxLength: USER_SETTINGS_LIMITS.password,
  });

  if ('error' in password) {
    return password;
  }

  if (password.value !== undefined && password.value.length < 8) {
    return { error: 'password must be at least 8 characters long.' };
  }

  const avatar = parseOptionalBoundedString(parsedBody.value.avatar, {
    fieldName: 'avatar',
    maxLength: USER_SETTINGS_LIMITS.avatar,
  });

  if ('error' in avatar) {
    return avatar;
  }

  return {
    value: {
      avatar: avatar.value,
      email: email.value ?? username.value,
      password: password.value,
      username: username.value,
    },
  };
};

const parseUserUpdateBody = (
  body: unknown
):
  | {
      value: {
        permissions: number;
        username: string;
      };
    }
  | { error: string } => {
  const parsedBody = parseUserBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const username = parseBoundedString(parsedBody.value.username, {
    fieldName: 'username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });

  if ('error' in username) {
    return username;
  }

  const permissions = parseOptionalNonNegativeInteger(
    parsedBody.value.permissions,
    MAX_PERMISSION_VALUE
  );

  if (permissions === undefined || !isValidPermissionValue(permissions)) {
    return { error: 'permissions is invalid.' };
  }

  return { value: { permissions, username: username.value } };
};

const filterPushSubscription = (subscription: UserPushSubscription) => ({
  endpoint: subscription.endpoint,
  userAgent: subscription.userAgent,
  createdAt: subscription.createdAt,
});

router.get(
  '/',
  isAuthenticated([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS], {
    type: 'or',
  }),
  authorizedRouteAccess([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS]),
  async (req, res, next) => {
    try {
      const parsedIncludeIds = parseOptionalIncludeUserIds(
        req.query.includeIds
      );
      if ('error' in parsedIncludeIds) {
        return next({ status: 400, message: parsedIncludeIds.error });
      }
      const includeIds = parsedIncludeIds.value;
      const pageSize = parsePositiveInt(
        req.query.take,
        Math.max(10, includeIds.length),
        100
      );
      const skip = parseNonNegativeInt(
        req.query.skip,
        0,
        MAX_PAGINATION_OFFSET
      );
      const parsedQ = parseOptionalUserQueryString(
        req.query.q,
        'Search query',
        MAX_USER_SEARCH_QUERY_LENGTH
      );
      if ('error' in parsedQ) {
        return next({ status: 400, message: parsedQ.error });
      }
      const parsedSort = parseOptionalUserQueryString(
        req.query.sort,
        'Sort field',
        MAX_USER_SORT_LENGTH
      );
      if ('error' in parsedSort) {
        return next({ status: 400, message: parsedSort.error });
      }
      const parsedSortDirection = parseOptionalUserQueryString(
        req.query.sortDirection,
        'Sort direction',
        MAX_USER_SORT_LENGTH
      );
      if ('error' in parsedSortDirection) {
        return next({ status: 400, message: parsedSortDirection.error });
      }

      const q = escapeSqlLikePattern(parsedQ.value?.toLowerCase() ?? '');
      const sortParam = parsedSort.value;
      const sortDirectionQuery = parsedSortDirection.value?.toLowerCase();
      const canManageUsers =
        req.user?.hasPermission(Permission.MANAGE_USERS) ?? false;

      if (
        !canManageUsers &&
        sortParam !== undefined &&
        sortParam !== 'displayname'
      ) {
        return next({
          status: 403,
          message: 'This user sort is available only to user managers.',
        });
      }

      let sortDirection: 'ASC' | 'DESC';
      if (sortDirectionQuery === 'asc') {
        sortDirection = 'ASC';
      } else if (sortDirectionQuery === 'desc') {
        sortDirection = 'DESC';
      } else {
        switch (sortParam) {
          case 'displayname':
            sortDirection = 'ASC';
            break;
          case 'requests':
          case 'updated':
            sortDirection = 'DESC';
            break;
          case 'created':
          case 'usertype':
          case 'role':
          case undefined:
          default:
            sortDirection = 'ASC';
            break;
        }
      }

      let query = getRepository(User).createQueryBuilder('user');

      if (q) {
        query = canManageUsers
          ? query.where(
              `LOWER(user.username) LIKE :q ESCAPE '\\'
                OR LOWER(user.email) LIKE :q ESCAPE '\\'
                OR LOWER(user.plexUsername) LIKE :q ESCAPE '\\'
                OR LOWER(user.jellyfinUsername) LIKE :q ESCAPE '\\'`,
              { q: `%${q}%` }
            )
          : query.where(
              `LOWER(CASE
                WHEN user.username IS NOT NULL AND user.username != '' THEN user.username
                WHEN user.plexUsername IS NOT NULL AND user.plexUsername != '' THEN user.plexUsername
                WHEN user.jellyfinUsername IS NOT NULL AND user.jellyfinUsername != '' THEN user.jellyfinUsername
                ELSE user.email
              END) LIKE :q ESCAPE '\\'`,
              { q: `%${q}%` }
            );
      }

      if (includeIds.length > 0) {
        query.andWhereInIds(includeIds);
      }

      switch (sortParam) {
        case 'created':
          query = query.orderBy('user.createdAt', sortDirection);
          break;
        case 'updated':
          query = query.orderBy('user.updatedAt', sortDirection);
          break;
        case 'displayname':
          query = query
            .addSelect(
              `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
                CASE WHEN (user.plexUsername IS NULL OR user.plexUsername = '') THEN (
                  CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                    "user"."email"
                  ELSE
                    LOWER(user.jellyfinUsername)
                  END)
                ELSE
                  LOWER(user.plexUsername)
                END)
              ELSE
                LOWER(user.username)
              END`,
              'displayname_sort_key'
            )
            .orderBy('displayname_sort_key', sortDirection);
          break;
        case 'requests':
          query = query
            .addSelect((subQuery) => {
              return subQuery
                .select('COUNT(request.id)', 'request_count')
                .from(MediaRequest, 'request')
                .where('request.requestedBy.id = user.id');
            }, 'request_count')
            .orderBy('request_count', sortDirection);
          break;
        case 'usertype':
          query = query.orderBy('user.userType', sortDirection);
          break;
        case 'role':
          query = query
            .addSelect(
              `CASE
              WHEN user.id = 1 THEN 0
              WHEN (user.permissions & ${Permission.ADMIN}) != 0 THEN 1
              ELSE 2
            END`,
              'role_sort_key'
            )
            .orderBy('role_sort_key', sortDirection);
          break;
        default:
          query = query.orderBy('user.id', sortDirection);
          break;
      }

      const [users, userCount] = await query
        .take(pageSize)
        .skip(skip)
        .distinct(true)
        .getManyAndCount();

      if (canManageUsers) {
        await User.populateRequestCounts(users);
      }

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(userCount / pageSize),
          pageSize,
          results: userCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: canManageUsers
          ? User.filterMany(users, true)
          : users.map((user) => user.requesterFilter()),
      } as UserResultsResponse);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseLocalUserBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const settings = getSettings();

      const email = body.email;
      const userRepository = getRepository(User);
      const emailAdmissionResource = getAuthAccountAdmissionResource(
        'email',
        email.toLowerCase()
      );
      const outcome = await runAuthAccountAdmission(
        [emailAdmissionResource],
        async () => {
          const existingUser = await userRepository
            .createQueryBuilder('user')
            .where('user.email = :email', {
              email: email.toLowerCase(),
            })
            .getOne();

          if (existingUser) {
            return { type: 'exists' as const };
          }

          const passedExplicitPassword = !!body.password;
          const avatar = gravatarUrl(email, { default: 'mm', size: 200 });

          if (
            !passedExplicitPassword &&
            (!settings.notifications.agents.email.enabled ||
              !settings.main.applicationUrl)
          ) {
            throw new Error(
              'An application URL and email notifications are required for password setup links'
            );
          }

          const user = new User({
            email,
            avatar: body.avatar ?? avatar,
            username: body.username,
            password: body.password,
            permissions: 0,
            plexToken: '',
            userType: UserType.LOCAL,
          });

          if (passedExplicitPassword) {
            await user.setPassword(body.password ?? '');
            await runAuthorizedUserSecurityMutation(
              req.user!.id,
              req.user!.id,
              Permission.MANAGE_USERS,
              async (actor) => {
                const defaultPermissions =
                  getSettings().main.defaultPermissions;
                if (!canMakePermissionsChange(defaultPermissions, actor)) {
                  throw new UserMutationActorUnauthorizedError(
                    'The current user cannot grant the default access level.'
                  );
                }
                user.permissions = defaultPermissions;
                await userRepository.save(user);
              }
            );
            return { type: 'created' as const, user };
          } else {
            // Commit the user and a recoverable setup-link delivery marker in one
            // transaction before contacting SMTP. A generated plaintext password
            // cannot be recovered if the process dies after mail acceptance but
            // before its hash is saved.
            const preparedDelivery = await runAuthorizedUserSecurityMutation(
              req.user!.id,
              req.user!.id,
              Permission.MANAGE_USERS,
              async (actor) => {
                const defaultPermissions =
                  getSettings().main.defaultPermissions;
                if (!canMakePermissionsChange(defaultPermissions, actor)) {
                  throw new UserMutationActorUnauthorizedError(
                    'The current user cannot grant the default access level.'
                  );
                }
                user.permissions = defaultPermissions;
                return dataSource.transaction(async (manager) => {
                  await manager.save(user);
                  const delivery = await user.preparePasswordResetDelivery(
                    manager.getRepository(User)
                  );
                  if (!delivery) {
                    throw new Error('Unable to prepare password setup link');
                  }
                  return delivery;
                });
              }
            );
            return {
              type: 'created' as const,
              user,
              preparedDelivery,
            };
          }
        }
      );

      if (outcome.type === 'exists') {
        return next({
          status: 409,
          message: 'User already exists with submitted email.',
          errors: ['USER_EXISTS'],
        });
      }

      if ('preparedDelivery' in outcome && outcome.preparedDelivery) {
        // SMTP can take seconds. The account identity is already durable, so
        // do not hold a PostgreSQL admission connection or block a same-email
        // conflict check while waiting for the transport.
        const delivered = await outcome.preparedDelivery();
        if (!delivered) {
          // Preserve the synchronous API contract when the account still has
          // no usable login method. A concurrent password/provider link or a
          // newer recovery flow wins and prevents destructive cleanup.
          await runAuthAccountAdmission([emailAdmissionResource], () =>
            runUserSecurityMutation(outcome.user.id, async () => {
              const activeUser = await userRepository
                .createQueryBuilder('user')
                .addSelect([
                  'user.password',
                  'user.resetPasswordGuid',
                  'user.resetPasswordDeliveryPending',
                ])
                .leftJoinAndSelect('user.linkedAccounts', 'linkedAccounts')
                .where('user.id = :userId', { userId: outcome.user.id })
                .getOne();

              if (
                activeUser?.email.toLowerCase() === email.toLowerCase() &&
                !activeUser.password &&
                !activeUser.passwordChangedAt &&
                !activeUser.plexId &&
                !activeUser.jellyfinUserId &&
                activeUser.userType === UserType.LOCAL &&
                !activeUser.resetPasswordGuid &&
                !activeUser.resetPasswordDeliveryPending &&
                activeUser.linkedAccounts.length === 0
              ) {
                await userRepository.delete(activeUser.id);
              }
            })
          );
          throw new Error('Unable to deliver password setup link');
        }
      }

      return res.status(201).json(outcome.user.filter());
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message:
            'You do not have permission to create users with the default access level',
        });
      }
      if (isUniqueConstraintError(e)) {
        return next({
          status: 409,
          message: 'User already exists with submitted email.',
          errors: ['USER_EXISTS'],
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

router.post<
  never,
  unknown,
  {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string;
  }
>(
  '/registerPushSubscription',
  pushSubscriptionRegistrationRateLimit,
  async (req, res, next) => {
    const parsedBody = await parsePushSubscriptionBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      await runPushSubscriptionMutation(req.user!.id, () =>
        dataSource.transaction(
          async (transactionalEntityManager: EntityManager) => {
            const transactionalRepo =
              transactionalEntityManager.getRepository(UserPushSubscription);

            // Check for existing subscription by auth or endpoint within transaction
            const existingSubscription = await transactionalRepo.findOne({
              relations: { user: true },
              where: [
                { auth: body.auth, user: { id: req.user?.id } },
                { endpoint: body.endpoint, user: { id: req.user?.id } },
              ],
            });

            if (existingSubscription) {
              // If endpoint matches but auth is different, update with new keys (iOS refresh case)
              if (
                existingSubscription.endpoint === body.endpoint &&
                existingSubscription.auth !== body.auth
              ) {
                existingSubscription.auth = body.auth;
                existingSubscription.p256dh = body.p256dh;
                existingSubscription.userAgent = body.userAgent;

                await transactionalRepo.save(existingSubscription);

                logger.debug(
                  'Updated existing push subscription with new keys for same endpoint.',
                  { label: 'API' }
                );
                return;
              }

              logger.debug(
                'Duplicate subscription detected. Skipping registration.',
                { label: 'API' }
              );
              return;
            }

            // Clean up old subscriptions from the same device (userAgent) for this user
            // iOS can silently refresh endpoints, leaving stale subscriptions in the database
            // Only clean up if we're creating a new subscription (not updating an existing one)
            if (body.userAgent) {
              const staleSubscriptions = await transactionalRepo.find({
                relations: { user: true },
                where: {
                  userAgent: body.userAgent,
                  user: { id: req.user?.id },
                  // Only remove subscriptions with different endpoints (stale ones)
                  // Keep subscriptions that might be from different browsers/tabs
                  endpoint: Not(body.endpoint),
                },
              });

              if (staleSubscriptions.length > 0) {
                await transactionalRepo.remove(staleSubscriptions);
                logger.debug(
                  `Removed ${staleSubscriptions.length} stale push subscription(s) from same device.`,
                  { label: 'API' }
                );
              }
            }

            const subscriptionCount = await transactionalRepo.count({
              where: { user: { id: req.user?.id } },
            });
            if (subscriptionCount >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
              throw new PushSubscriptionLimitError();
            }

            const userPushSubscription = new UserPushSubscription({
              auth: body.auth,
              endpoint: body.endpoint,
              p256dh: body.p256dh,
              userAgent: body.userAgent,
              user: req.user,
            });

            await transactionalRepo.save(userPushSubscription);
          }
        )
      );

      return res.status(204).send();
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }

      if (error instanceof PushSubscriptionLimitError) {
        return next({
          status: 409,
          message: `A user can register at most ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} push subscriptions.`,
        });
      }

      if (isUniqueConstraintError(error)) {
        try {
          await runPushSubscriptionMutation(req.user!.id, () =>
            getRepository(UserPushSubscription).update(
              { endpoint: body.endpoint, user: { id: req.user?.id } },
              {
                auth: body.auth,
                p256dh: body.p256dh,
                userAgent: body.userAgent,
              }
            )
          );
          return res.status(204).send();
        } catch (fallbackError) {
          if (fallbackError instanceof UserMutationActorUnauthorizedError) {
            return next({ status: 403, message: 'Access denied.' });
          }
          // Fall through to the controlled error below.
        }
      }

      logger.error('Failed to register user push subscription', {
        label: 'API',
      });
      next({ status: 500, message: 'Failed to register subscription.' });
    }
  }
);

router.get<{ id: string }>(
  '/:id/pushSubscriptions',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User subscriptions not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const userPushSubs = await userPushSubRepository.find({
            relations: { user: true },
            where: { user: { id: userId } },
          });

          return res.status(200).json(userPushSubs.map(filterPushSubscription));
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      next({ status: 404, message: 'User subscriptions not found.' });
    }
  }
);

router.get<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User subscription not found.' });
      }

      const endpoint = await parsePushSubscriptionEndpointParam(
        req.params.endpoint
      );
      if ('error' in endpoint) {
        return next({ status: 400, message: endpoint.error });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const userPushSub = await userPushSubRepository.findOneOrFail({
            relations: {
              user: true,
            },
            where: {
              user: { id: userId },
              endpoint: endpoint.value,
            },
          });

          return res.status(200).json(filterPushSubscription(userPushSub));
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      next({ status: 404, message: 'User subscription not found.' });
    }
  }
);

router.delete<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return res.status(204).send();
      }

      const endpoint = await parsePushSubscriptionEndpointParam(
        req.params.endpoint
      );
      if ('error' in endpoint) {
        return next({ status: 400, message: endpoint.error });
      }

      return await runAuthorizedPushSubscriptionMutation(
        req.user!.id,
        userId,
        async (actor) => {
          const userPushSub = await userPushSubRepository.findOne({
            relations: { user: true },
            where: {
              user: { id: userId },
              endpoint: endpoint.value,
            },
          });

          // If not found, just return 204 to prevent push disable failure
          // (rare scenario where user push sub does not exist)
          if (!userPushSub) {
            return res.status(204).send();
          }

          if (
            userPushSub.user.hasPermission(Permission.ADMIN) &&
            actor.id !== userPushSub.user.id &&
            actor.id !== 1
          ) {
            return next({
              status: 403,
              message:
                'You do not have permission to modify an administrator account.',
            });
          }

          await userPushSubRepository.remove(userPushSub);
          return res.status(204).send();
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      logger.error('Something went wrong deleting the user push subcription', {
        label: 'API',
        endpoint: req.params.endpoint?.slice(0, MAX_PUSH_ENDPOINT_LENGTH),
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'User push subcription not found',
      });
    }
  }
);

router.get<{ id: string }>('/:id', async (req, res, next) => {
  try {
    const userRepository = getRepository(User);
    const userId = parseUserRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    const loadProfile = async (showPrivateFields: boolean) => {
      const user = await userRepository.findOneOrFail({
        where: { id: userId },
      });
      if (showPrivateFields) {
        await User.populateRequestCounts([user]);
      }
      return res
        .status(200)
        .json(showPrivateFields ? user.filter(true) : user.publicFilter(true));
    };

    if (req.user?.id === userId) {
      return await runUserSecurityReadWithActor(
        req.user.id,
        userId,
        Permission.MANAGE_USERS,
        () => loadProfile(true)
      );
    }
    if (req.user?.hasPermission(Permission.MANAGE_USERS)) {
      try {
        return await runUserSecurityReadWithActor(
          req.user.id,
          userId,
          Permission.MANAGE_USERS,
          () => loadProfile(true)
        );
      } catch (error) {
        if (!(error instanceof UserMutationActorUnauthorizedError)) {
          throw error;
        }
      }
    }
    return await loadProfile(false);
  } catch {
    next({ status: 404, message: 'User not found.' });
  }
});

router.get<{ jellyfinUserId: string }>(
  '/jellyfin/:jellyfinUserId',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const jellyfinUserId = normalizeJellyfinGuid(req.params.jellyfinUserId);
      if (!jellyfinUserId) {
        return next({ status: 400, message: 'Invalid Jellyfin User ID.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        req.user!.id,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOneOrFail({
            where: { jellyfinUserId },
          });
          await User.populateRequestCounts([user]);
          return res.status(200).json(user.filter(true));
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.use('/:id/settings', userSettingsRoutes);

router.get<{ id: string }, UserRequestsResponse>(
  '/:id/requests',
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 20,
      maxTake: 100,
    });

    try {
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        async () => {
          const user = await getRepository(User).findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          const [requestRows, requestCount] = await getRepository(MediaRequest)
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.media', 'media')
            .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
            .leftJoinAndSelect('request.requestedBy', 'requestedBy')
            .andWhere('requestedBy.id = :id', {
              id: user.id,
            })
            .orderBy('request.id', 'DESC')
            .take(pageSize)
            .skip(skip)
            .getManyAndCount();
          const requests = await hydrateMediaRequestRelations(requestRows);

          return res.status(200).json({
            pageInfo: {
              pages: Math.ceil(requestCount / pageSize),
              pageSize,
              results: requestCount,
              page: Math.ceil(skip / pageSize) + 1,
            },
            results: filterEntityResponse(requests, req.user),
          });
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      next({ status: 500, message: e.message });
    }
  }
);

export const canMakePermissionsChange = (
  permissions: number,
  user?: User
): boolean => {
  if (!user || !isValidPermissionValue(permissions)) {
    return false;
  }

  // ADMIN is an all-permissions role throughout authorization checks. Treat it
  // the same way here; otherwise an administrator could grant ADMIN itself but
  // not an ordinary permission such as MANAGE_SETTINGS. Delegated non-admin
  // managers remain limited to permission bits they explicitly hold.
  if (user.hasPermission(Permission.ADMIN)) {
    return true;
  }

  const requested = BigInt(permissions);
  const held = BigInt(user.permissions);

  return (requested & ~held) === 0n;
};

router.put<
  Record<string, never>,
  Partial<User>[],
  { ids: string[]; permissions: number }
>('/', isAuthenticated(Permission.MANAGE_USERS), async (req, res, next) => {
  const parsedBody = parseUserBodyObject(req.body);
  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }
  const body = parsedBody.value;

  const parsedIds = parsePositiveIntegerArray(body.ids, {
    fieldName: 'ids',
    maxItems: MAX_BULK_USER_IDS,
  });

  if ('error' in parsedIds) {
    return next({ status: 400, message: parsedIds.error });
  }
  if (parsedIds.value.length === 0) {
    return res.status(200).json([]);
  }

  const parsedPermissions = parseOptionalNonNegativeInteger(
    body.permissions,
    MAX_PERMISSION_VALUE
  );

  if (
    parsedPermissions === undefined ||
    !isValidPermissionValue(parsedPermissions)
  ) {
    return next({ status: 400, message: 'permissions is invalid.' });
  }

  try {
    if (!canMakePermissionsChange(parsedPermissions, req.user)) {
      return next({
        status: 403,
        message: 'You do not have permission to grant this level of access',
      });
    }

    const updatedUsers = await runAuthorizedUserSecurityMutation(
      req.user!.id,
      parsedIds.value,
      Permission.MANAGE_USERS,
      (actor) => {
        if (!canMakePermissionsChange(parsedPermissions, actor)) {
          throw new UserMutationActorUnauthorizedError(
            'The active user cannot grant these permissions.'
          );
        }

        return dataSource.transaction(async (manager) => {
          const userRepository = manager.getRepository(User);
          const users = await userRepository.find({
            where: { id: In(parsedIds.value) },
          });

          if (
            actor.id !== 1 &&
            users.some((user) => user.hasPermission(Permission.ADMIN))
          ) {
            throw new ProtectedAdministratorMutationError();
          }

          const criteria: FindOptionsWhere<User> = {
            id: In(users.map((user) => user.id)),
            ...(actor.id !== 1 && {
              permissions: Raw((alias) => `(${alias} & :adminPermission) = 0`, {
                adminPermission: Permission.ADMIN,
              }),
            }),
          };
          const result = await userRepository.update(criteria, {
            permissions: parsedPermissions,
          });

          if (result.affected !== users.length) {
            throw new ProtectedAdministratorMutationError();
          }

          return userRepository.find({
            where: { id: In(users.map((user) => user.id)) },
          });
        });
      }
    );

    return res
      .status(200)
      .json(User.filterMany(updatedUsers, req.user?.id === 1));
  } catch (e) {
    if (
      e instanceof ProtectedAdministratorMutationError ||
      e instanceof UserMutationActorUnauthorizedError
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to modify an administrator',
      });
    }
    next({ status: 500, message: e.message });
  }
});

router.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseUserUpdateBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const outcome = await runAuthorizedUserSecurityMutation(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async (actor) => {
          const user = await userRepository.findOne({ where: { id: userId } });
          if (!user) return { type: 'missing' as const };

          if (
            user.hasPermission(Permission.ADMIN) &&
            actor.id !== user.id &&
            actor.id !== 1
          ) {
            return { type: 'forbidden' as const };
          }

          if (!canMakePermissionsChange(body.permissions, actor)) {
            return { type: 'grant-forbidden' as const };
          }

          const criteria: FindOptionsWhere<User> = {
            id: user.id,
            ...(actor.id !== user.id &&
              actor.id !== 1 && {
                permissions: Raw(
                  (alias) => `(${alias} & :adminPermission) = 0`,
                  {
                    adminPermission: Permission.ADMIN,
                  }
                ),
              }),
          };
          const result = await userRepository.update(criteria, {
            username: body.username,
            permissions: body.permissions,
          });

          return result.affected === 1
            ? {
                type: 'updated' as const,
                user: await userRepository.findOneByOrFail({ id: user.id }),
              }
            : { type: 'forbidden' as const };
        }
      );

      if (outcome.type === 'missing') {
        return next({ status: 404, message: 'User not found.' });
      }
      if (outcome.type === 'forbidden') {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }
      if (outcome.type === 'grant-forbidden') {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }
      return res.status(200).json(outcome.user.filter());
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }
      next({
        status: 500,
        message:
          error instanceof Error ? error.message : 'Unable to update user.',
      });
    }
  }
);

router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }
      const outcome = await runAuthorizedUserSecurityMutation(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async (actor) => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) return { type: 'missing' as const };
          if (user.id === 1) return { type: 'owner' as const };
          if (user.hasPermission(Permission.ADMIN) && actor.id !== 1) {
            return { type: 'protected' as const };
          }

          await dataSource.transaction(async (manager) => {
            await removeUserRequestsInBatches(manager, user.id);
            const criteria: FindOptionsWhere<User> = {
              id: user.id,
              ...(actor.id !== 1 && {
                permissions: Raw(
                  (alias) => `(${alias} & :adminPermission) = 0`,
                  {
                    adminPermission: Permission.ADMIN,
                  }
                ),
              }),
            };
            const result = await manager.getRepository(User).delete(criteria);
            if (result.affected !== 1) {
              throw new ProtectedAdministratorMutationError();
            }
          });
          return { type: 'deleted' as const, user };
        }
      );

      if (outcome.type === 'missing') {
        return next({ status: 404, message: 'User not found.' });
      }
      if (outcome.type === 'owner') {
        return next({
          status: 405,
          message: 'This account cannot be deleted.',
        });
      }
      if (outcome.type === 'protected') {
        return next({
          status: 405,
          message: 'You cannot delete users with administrative privileges.',
        });
      }
      return res.status(200).json(outcome.user.filter());
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this user',
        });
      }
      if (e instanceof ProtectedAdministratorMutationError) {
        return next({
          status: 405,
          message: 'You cannot delete users with administrative privileges.',
        });
      }
      logger.error('Something went wrong deleting a user', {
        label: 'API',
        userId: req.params.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Something went wrong deleting the user',
      });
    }
  }
);

router.post(
  '/import-from-plex',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseOptionalUserBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const parsedPlexIds = parseStringArray(parsedBody.value.plexIds, {
      fieldName: 'plexIds',
      maxItems: MAX_PROVIDER_IMPORT_IDS,
      maxItemLength: 32,
      required: false,
    });

    if ('error' in parsedPlexIds) {
      return next({ status: 400, message: parsedPlexIds.error });
    }

    try {
      const userRepository = getRepository(User);
      const plexIds = parsedPlexIds.value;
      const selectedPlexIds = new Set(plexIds);
      const importAuthority = await runAuthorizedUserSecurityMutation(
        req.user!.id,
        [req.user!.id, 1],
        Permission.MANAGE_USERS,
        (actor) =>
          runWithConfigurationAdmission('plex', async () => {
            const settings = getSettings();
            if (
              !canMakePermissionsChange(settings.main.defaultPermissions, actor)
            ) {
              throw new UserMutationActorUnauthorizedError();
            }

            const mainUser = await userRepository.findOneOrFail({
              select: { id: true, plexToken: true },
              where: { id: 1 },
            });
            return {
              configuration: captureConfigurationAuthority('plex', settings),
              machineId: settings.plex.machineId,
              owner: {
                userId: mainUser.id,
                type: 'plex',
                plexToken: mainUser.plexToken,
              } satisfies MediaServerUserAuthoritySnapshot,
            };
          })
      );
      const plexUsersResponse = await new PlexTvAPI(
        importAuthority.owner.plexToken ?? ''
      ).getUsers();
      const plexUsers = plexIds.length
        ? plexUsersResponse.MediaContainer.User.filter((user) =>
            selectedPlexIds.has(user.$.id)
          )
        : plexUsersResponse.MediaContainer.User.slice(0, MAX_PLEX_SHARED_USERS);
      const runWithImportAuthority = <Result>(
        targetUserIds: number[],
        callback: (actor: User) => Promise<Result>
      ): Promise<Result> =>
        runAuthorizedUserSecurityMutation(
          req.user!.id,
          [...targetUserIds, 1],
          Permission.MANAGE_USERS,
          (actor) =>
            runWithConfigurationSnapshot(
              importAuthority.configuration,
              async () => {
                await assertMediaServerUserAuthorityCurrent(
                  importAuthority.owner
                );
                return callback(actor);
              }
            )
        );
      const createdUsers: User[] = [];
      for (const rawUser of plexUsers) {
        const account = rawUser.$;
        const plexId = parsePositiveRouteId(account.id, MAX_USER_ID_VALUE);
        const plexEmail = parseBoundedString(account.email, {
          fieldName: 'Plex email',
          maxLength: USER_SETTINGS_LIMITS.email,
        });
        const plexUsername = parseOptionalBoundedString(account.username, {
          fieldName: 'Plex username',
          maxLength: USER_SETTINGS_LIMITS.username,
        });
        const plexAvatar = parseOptionalBoundedString(account.thumb, {
          fieldName: 'Plex avatar',
          maxLength: USER_SETTINGS_LIMITS.avatar,
        });

        if (
          plexId &&
          !('error' in plexEmail) &&
          !('error' in plexUsername) &&
          !('error' in plexAvatar)
        ) {
          const email = plexEmail.value;
          const username = plexUsername.value;
          const avatar =
            plexAvatar.value ??
            gravatarUrl(email, { default: 'mm', size: 200 });
          await runAuthAccountAdmission(
            [
              getAuthAccountAdmissionResource('email', email.toLowerCase()),
              getAuthAccountAdmissionResource('plex', String(plexId)),
            ],
            async () => {
              const user = await userRepository
                .createQueryBuilder('user')
                .where('user.plexId = :id', { id: plexId })
                .orWhere('user.email = :email', {
                  email: email.toLowerCase(),
                })
                .getOne();

              if (user) {
                await runWithImportAuthority([user.id], async (actor) => {
                  const activeUser = await userRepository.findOneBy({
                    id: user.id,
                  });
                  if (!activeUser) return;
                  const isOtherProtectedAdministrator =
                    activeUser.hasPermission(Permission.ADMIN) &&
                    actor.id !== 1 &&
                    actor.id !== activeUser.id;
                  const mayModifyExistingUser =
                    actor.id === 1 ||
                    actor.id === activeUser.id ||
                    canMakePermissionsChange(activeUser.permissions, actor);
                  if (isOtherProtectedAdministrator || !mayModifyExistingUser) {
                    return;
                  }

                  activeUser.avatar = avatar;
                  activeUser.email = email;
                  activeUser.plexUsername = username;

                  if (activeUser.userType === UserType.LOCAL) {
                    activeUser.userType = UserType.PLEX;
                    activeUser.plexId = plexId;
                  }
                  await userRepository.save(activeUser);
                });
              } else if (
                plexUserHasServerAccess(rawUser, importAuthority.machineId)
              ) {
                await runWithImportAuthority([], async (actor) => {
                  const defaultPermissions =
                    getSettings().main.defaultPermissions;
                  if (!canMakePermissionsChange(defaultPermissions, actor)) {
                    throw new UserMutationActorUnauthorizedError();
                  }
                  const newUser = new User({
                    plexUsername: username,
                    email,
                    permissions: defaultPermissions,
                    plexId,
                    plexToken: '',
                    avatar,
                    userType: UserType.PLEX,
                  });
                  await userRepository.save(newUser);
                  createdUsers.push(newUser);
                });
              }
            }
          );
        }
      }

      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to import users',
        });
      }
      if (
        e instanceof ConfigurationAuthorityChangedError ||
        e instanceof MediaServerUserAuthorityChangedError
      ) {
        return next({
          status: 409,
          message: 'Media server authority changed during user import.',
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/import-from-jellyfin',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const parsedBody = parseOptionalUserBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const parsedJellyfinUserIds = parseStringArray(
      parsedBody.value.jellyfinUserIds,
      {
        fieldName: 'jellyfinUserIds',
        maxItems: MAX_PROVIDER_IMPORT_IDS,
        maxItemLength: 128,
      }
    );

    if ('error' in parsedJellyfinUserIds) {
      return next({ status: 400, message: parsedJellyfinUserIds.error });
    }

    const jellyfinUserIds = new Set<string>();
    for (const rawJellyfinUserId of parsedJellyfinUserIds.value) {
      const jellyfinUserId = normalizeJellyfinGuid(rawJellyfinUserId);
      if (!jellyfinUserId) {
        return next({ status: 400, message: 'jellyfinUserIds is invalid.' });
      }
      jellyfinUserIds.add(jellyfinUserId);
    }

    try {
      const userRepository = getRepository(User);
      const createdUsers: User[] = [];
      const importAuthority = await runAuthorizedUserSecurityMutation(
        req.user!.id,
        [req.user!.id, 1],
        Permission.MANAGE_USERS,
        (actor) =>
          runWithConfigurationAdmission('jellyfin', async () => {
            const settings = getSettings();
            if (
              !canMakePermissionsChange(settings.main.defaultPermissions, actor)
            ) {
              throw new UserMutationActorUnauthorizedError();
            }

            const admin = await userRepository.findOneOrFail({
              where: { id: 1 },
              select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
              order: { id: 'ASC' },
            });
            return {
              configuration: captureConfigurationAuthority(
                'jellyfin',
                settings
              ),
              hostname: getHostname(),
              apiKey: settings.jellyfin.apiKey,
              owner: {
                userId: admin.id,
                type: 'jellyfin',
                jellyfinUserId: admin.jellyfinUserId,
                jellyfinDeviceId: admin.jellyfinDeviceId,
              } satisfies MediaServerUserAuthoritySnapshot,
            };
          })
      );
      const jellyfinClient = new JellyfinAPI(
        importAuthority.hostname,
        importAuthority.apiKey,
        importAuthority.owner.jellyfinDeviceId ?? ''
      );
      jellyfinClient.setUserId(importAuthority.owner.jellyfinUserId ?? '');
      const jellyfinUsers = await jellyfinClient.getUsers();
      const runWithImportAuthority = <Result>(
        callback: (actor: User) => Promise<Result>
      ): Promise<Result> =>
        runAuthorizedUserSecurityMutation(
          req.user!.id,
          [1],
          Permission.MANAGE_USERS,
          (actor) =>
            runWithConfigurationSnapshot(
              importAuthority.configuration,
              async () => {
                await assertMediaServerUserAuthorityCurrent(
                  importAuthority.owner
                );
                return callback(actor);
              }
            )
        );

      const jellyfinUsersById = new Map<
        string,
        (typeof jellyfinUsers.users)[number]
      >();
      for (const jellyfinUser of jellyfinUsers.users) {
        const jellyfinUserId = normalizeJellyfinGuid(jellyfinUser.Id);
        const jellyfinUsername = parseBoundedString(jellyfinUser.Name, {
          fieldName: 'Jellyfin username',
          maxLength: USER_SETTINGS_LIMITS.username,
        });
        if (jellyfinUserId && !('error' in jellyfinUsername)) {
          jellyfinUsersById.set(jellyfinUserId, {
            ...jellyfinUser,
            Id: jellyfinUserId,
            Name: jellyfinUsername.value,
          });
        }
      }

      for (const jellyfinUserId of jellyfinUserIds) {
        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);

        if (!jellyfinUser) {
          continue;
        }

        await runAuthAccountAdmission(
          [
            getAuthAccountAdmissionResource(
              'email',
              jellyfinUser.Name.toLowerCase()
            ),
            getAuthAccountAdmissionResource('jellyfin', jellyfinUserId),
          ],
          async () => {
            const user = await userRepository.findOne({
              select: ['id', 'jellyfinUserId'],
              where: [
                { jellyfinUserId },
                { email: jellyfinUser.Name.toLowerCase() },
              ],
            });

            if (!user) {
              await runWithImportAuthority(async (actor) => {
                const settings = getSettings();
                if (
                  !canMakePermissionsChange(
                    settings.main.defaultPermissions,
                    actor
                  )
                ) {
                  throw new UserMutationActorUnauthorizedError();
                }
                const newUser = new User({
                  jellyfinUsername: jellyfinUser.Name,
                  jellyfinUserId: jellyfinUser.Id,
                  jellyfinDeviceId: Buffer.from(
                    `BOT_seerr_${jellyfinUser.Name}`
                  ).toString('base64'),
                  email: jellyfinUser.Name,
                  permissions: settings.main.defaultPermissions,
                  avatar: `/avatarproxy/${jellyfinUser.Id}`,
                  userType:
                    settings.main.mediaServerType === MediaServerType.JELLYFIN
                      ? UserType.JELLYFIN
                      : UserType.EMBY,
                });

                await userRepository.save(newUser);
                createdUsers.push(newUser);
              });
            }
          }
        );
      }
      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to import users',
        });
      }
      if (
        e instanceof ConfigurationAuthorityChangedError ||
        e instanceof MediaServerUserAuthorityChangedError
      ) {
        return next({
          status: 409,
          message: 'Media server authority changed during user import.',
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

router.get<{ id: string }, QuotaResponse>(
  '/:id/quota',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);
      const userId = parseUserRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
        async () => {
          const user = await userRepository.findOneOrFail({
            where: { id: userId },
          });
          return res.status(200).json(await user.getQuota());
        },
        { permissionCheckOptions: { type: 'and' } }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'User not found.' });
      }

      logger.error('Failed to calculate user quota', {
        label: 'User',
        userId: req.params.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      next({ status: 500, message: 'Unable to calculate user quota.' });
    }
  }
);

router.get<{ id: string }, UserWatchDataResponse>(
  '/:id/watch_data',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userId = parseUserRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    try {
      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.ADMIN,
        () =>
          runWithConfigurationAdmission('tautulli', async () => {
            const settings = getSettings().tautulli;

            if (!settings.hostname || !settings.port || !settings.apiKey) {
              return next({
                status: 404,
                message: 'Tautulli API not configured.',
              });
            }

            const user = await getRepository(User).findOneOrFail({
              where: { id: userId },
              select: { id: true, plexId: true },
            });

            if (!user.plexId) {
              return res
                .status(200)
                .json({ recentlyWatched: [], playCount: 0 });
            }

            const tautulli = new TautulliAPI(settings);

            const watchStats = await tautulli.getUserWatchStats(user);
            const watchHistory = await tautulli.getUserWatchHistory(user);

            const recentlyWatched = sortBy(
              await getRepository(Media).find({
                where: [
                  {
                    mediaType: MediaType.MOVIE,
                    ratingKey: In(
                      watchHistory
                        .filter((record) => record.media_type === 'movie')
                        .map((record) => record.rating_key)
                    ),
                  },
                  {
                    mediaType: MediaType.MOVIE,
                    ratingKey4k: In(
                      watchHistory
                        .filter((record) => record.media_type === 'movie')
                        .map((record) => record.rating_key)
                    ),
                  },
                  {
                    mediaType: MediaType.TV,
                    ratingKey: In(
                      watchHistory
                        .filter((record) => record.media_type === 'episode')
                        .map((record) => record.grandparent_rating_key)
                    ),
                  },
                  {
                    mediaType: MediaType.TV,
                    ratingKey4k: In(
                      watchHistory
                        .filter((record) => record.media_type === 'episode')
                        .map((record) => record.grandparent_rating_key)
                    ),
                  },
                ],
              }),
              [
                (media) =>
                  findIndex(
                    watchHistory,
                    (record) =>
                      (!!media.ratingKey &&
                        parseInt(media.ratingKey) ===
                          (record.media_type === 'movie'
                            ? record.rating_key
                            : record.grandparent_rating_key)) ||
                      (!!media.ratingKey4k &&
                        parseInt(media.ratingKey4k) ===
                          (record.media_type === 'movie'
                            ? record.rating_key
                            : record.grandparent_rating_key))
                  ),
              ]
            );

            return res.status(200).json({
              recentlyWatched,
              playCount: watchStats.total_plays,
            });
          })
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      if (isTautulliNoDataError(e)) {
        return res.status(200).json({ recentlyWatched: [], playCount: 0 });
      }

      logger.error('Something went wrong fetching user watch data', {
        label: 'API',
        errorMessage: e.message,
        userId: req.params.id,
      });
      next({
        status: 500,
        message: 'Failed to fetch user watch data.',
      });
    }
  }
);

router.get<{ id: string }, WatchlistResponse>(
  '/:id/watchlist',
  async (req, res, next) => {
    const userId = parseUserRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    const itemsPerPage = 20;
    const page = parsePositiveInt(req.query.page, 1, MAX_WATCHLIST_PAGE);

    try {
      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        [Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW],
        async () => {
          const user = await getRepository(User).findOneOrFail({
            where: { id: userId },
            select: ['id', 'plexToken'],
          });

          return res.json(
            await getCombinedWatchlist({
              userId: user.id,
              plexToken: user.plexToken,
              page,
              itemsPerPage,
            })
          );
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      throw error;
    }
  }
);

export default router;
