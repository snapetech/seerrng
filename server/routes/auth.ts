import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType, ServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { getRepository } from '@server/datasource';
import { LinkedAccount } from '@server/entity/LinkedAccount';
import { User } from '@server/entity/User';
import { startJobs } from '@server/job/schedule';
import {
  getAuthAccountAdmissionResource,
  runAuthAccountAdmission,
} from '@server/lib/authAccountAdmission';
import {
  captureConfigurationAuthority,
  runWithConfigurationAdmission,
  runWithConfigurationSnapshot,
  type ConfigurationAuthoritySnapshot,
} from '@server/lib/configurationAdmission';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { getJellyfinAuthAuthorityKey } from '@server/lib/mediaServerAuthority';
import {
  captureMediaServerUserAuthority,
  runWithMediaServerUserAuthority,
  type MediaServerUserAuthoritySnapshot,
} from '@server/lib/mediaServerUserAuthority';
import { verifyLocalPassword } from '@server/lib/passwordVerification';
import { Permission } from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import { getSettings } from '@server/lib/settings';
import {
  UserMutationActorUnauthorizedError,
  acquireAuthorizedUserSecurityMutation,
  isUserSessionCredentialVersionCurrent,
  runAuthorizedUserSecurityMutation,
  runUserSecurityMutation,
  type AuthorizedUserSecurityMutationLease,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { checkAvatarChanged } from '@server/routes/avatarproxy';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';
import AsyncLock from '@server/utils/asyncLock';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import {
  BoundedTaskQueue,
  BoundedTaskQueueFullError,
  mapWithConcurrency,
} from '@server/utils/concurrency';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { oidcSafeFetch } from '@server/utils/oidcHttp';
import { parseOidcIdentity } from '@server/utils/oidcIdentity';
import { parsePlexAccountIdentity } from '@server/utils/plexAccount';
import {
  getRateLimitKey,
  resolvesToLocalOrPrivateAddress,
} from '@server/utils/security';
import { normalizeUrlBase } from '@server/utils/serviceUrl';
import {
  parseBoundedString,
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import axios from 'axios';
import { createHash, createHmac } from 'crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import gravatarUrl from 'gravatar-url';
import net from 'net';
import * as openIdClient from 'openid-client';
import { MoreThan } from 'typeorm';
import validator from 'validator';

const authRoutes = Router();
const MAX_AUTH_TOKEN_LENGTH = 4096;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_URL_BASE_LENGTH = 512;
const MAX_RESET_GUID_LENGTH = 64;
const MAX_PORT = 65_535;
const MAX_PLEX_PIN_ID = 2_147_483_647;
const MAX_PLEX_PIN_CODE_LENGTH = 128;
export const MAX_OIDC_CALLBACK_URL_LENGTH = 8_192;
// A fixed, valid cost-12 hash keeps unknown-account and SSO-only failures on
// the same bcrypt path as local-account failures without storing a usable
// credential.
const DUMMY_LOGIN_PASSWORD_HASH =
  '$2b$12$TvIVLU3omWLxBO4nurmty.NhNjbAP3IiFNA6CfrvFp2K2he8VOqwm';
export const LOCAL_LOGIN_FAILURE_LIMIT = 10;
export const LOCAL_LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const localLoginAttemptLock = new AsyncLock();
const pendingPasswordResetDeliveries = new Set<Promise<void>>();
const pendingPasswordResetDeliveriesByUser = new Map<number, Promise<void>>();
let passwordResetDeliveryRecoveryRunning = false;
let passwordResetDeliveryRecoveryRequested = false;
export const PASSWORD_RESET_RESUME_BATCH_SIZE = 50;
export const PASSWORD_RESET_DELIVERY_CONCURRENCY = 4;
export const MAX_PASSWORD_RESET_DELIVERY_QUEUE = 100;
const passwordResetDeliveryQueue = new BoundedTaskQueue(
  PASSWORD_RESET_DELIVERY_CONCURRENCY,
  MAX_PASSWORD_RESET_DELIVERY_QUEUE
);

export const waitForPendingPasswordResetDeliveries =
  async (): Promise<void> => {
    await Promise.all([...pendingPasswordResetDeliveries]);
  };

const enqueuePasswordResetDelivery = (
  user: User | null,
  context: { email: string; ip?: string },
  delivery?: () => Promise<boolean>
): void => {
  if (user && pendingPasswordResetDeliveriesByUser.has(user.id)) {
    return;
  }

  // Unknown accounts have no external work and must not consume queue slots;
  // otherwise a distributed account-enumeration flood can starve real reset
  // deliveries even though the endpoint response remains indistinguishable.
  const task = (
    delivery ? passwordResetDeliveryQueue.run(delivery) : Promise.resolve(false)
  )
    .then((delivered) => {
      if (delivered) {
        logger.info('Successfully sent password reset link', {
          label: 'API',
          ip: context.ip,
          email: context.email,
        });
      }
    })
    .catch((error) => {
      if (error instanceof BoundedTaskQueueFullError) {
        schedulePasswordResetDeliveryRecovery();
        return;
      }
      logger.error('Password reset delivery task failed', {
        label: 'API',
        ip: context.ip,
        errorMessage:
          error instanceof Error ? error.message : 'Unknown delivery error',
      });
    })
    .finally(() => {
      pendingPasswordResetDeliveries.delete(task);
      if (user && pendingPasswordResetDeliveriesByUser.get(user.id) === task) {
        pendingPasswordResetDeliveriesByUser.delete(user.id);
      }
    });

  pendingPasswordResetDeliveries.add(task);
  if (user) {
    pendingPasswordResetDeliveriesByUser.set(user.id, task);
  }
};

export const resumePendingPasswordResetDeliveries = async (): Promise<void> => {
  const userRepository = getRepository(User);
  let afterId = 0;

  while (true) {
    const users = await userRepository
      .createQueryBuilder('user')
      .addSelect([
        'user.resetPasswordGuid',
        'user.resetPasswordDeliveryPending',
      ])
      .where('user.resetPasswordDeliveryPending = :pending', { pending: true })
      .andWhere('user.id > :afterId', { afterId })
      .orderBy('user.id', 'ASC')
      .take(PASSWORD_RESET_RESUME_BATCH_SIZE)
      .getMany();

    if (users.length === 0) {
      return;
    }

    await mapWithConcurrency(
      users,
      PASSWORD_RESET_DELIVERY_CONCURRENCY,
      async (candidate) => {
        try {
          await runUserSecurityMutation(candidate.id, async () => {
            const user = await userRepository
              .createQueryBuilder('user')
              .addSelect([
                'user.resetPasswordGuid',
                'user.resetPasswordDeliveryPending',
              ])
              .where('user.id = :id', { id: candidate.id })
              .getOne();

            // Another replica may have delivered this intent while this
            // process waited for the per-user admission lock.
            if (!user?.resetPasswordDeliveryPending) {
              return;
            }

            if (
              !user.resetPasswordGuid ||
              !user.recoveryLinkExpirationDate ||
              user.recoveryLinkExpirationDate <= new Date()
            ) {
              await userRepository.update(
                { id: user.id, resetPasswordDeliveryPending: true },
                { resetPasswordDeliveryPending: false }
              );
              return;
            }

            const delivery = await user.preparePasswordResetDelivery();
            if (delivery) {
              await delivery();
            } else {
              logger.warn('Password reset delivery remains pending', {
                label: 'API',
                userId: user.id,
                reason: 'Email delivery is not configured.',
              });
            }
          });
        } catch (error) {
          logger.error('Failed to resume a pending password reset delivery', {
            label: 'API',
            userId: candidate.id,
            errorMessage:
              error instanceof Error ? error.message : 'Unknown delivery error',
          });
        }
      }
    );

    afterId = users[users.length - 1].id;
    if (users.length < PASSWORD_RESET_RESUME_BATCH_SIZE) {
      return;
    }
  }
};

const schedulePasswordResetDeliveryRecovery = (): void => {
  passwordResetDeliveryRecoveryRequested = true;
  if (passwordResetDeliveryRecoveryRunning) {
    return;
  }

  passwordResetDeliveryRecoveryRunning = true;
  trackBackgroundTask('password reset delivery recovery', async () => {
    try {
      // A single bounded flag records additional saturation while recovery is
      // running. This avoids both lost wakeups and attacker-controlled waiter
      // growth while ensuring recovery never overlaps the live queue.
      while (passwordResetDeliveryRecoveryRequested) {
        passwordResetDeliveryRecoveryRequested = false;
        await passwordResetDeliveryQueue.waitForIdle();
        await resumePendingPasswordResetDeliveries();
      }
    } finally {
      passwordResetDeliveryRecoveryRunning = false;
      if (passwordResetDeliveryRecoveryRequested) {
        schedulePasswordResetDeliveryRecovery();
      }
    }
  });
};
const DEVICE_DELETE_REQUEST_OPTIONS = {
  timeout: 5_000,
  maxRedirects: 0,
  maxContentLength: 1024,
  maxBodyLength: 1024,
};

const parseLoginIdentifier = (
  value: unknown,
  fieldName = 'email'
): { value: string } | { error: string } =>
  parseBoundedString(value, {
    fieldName,
    maxLength: USER_SETTINGS_LIMITS.email,
  });

const parsePassword = (
  value: unknown,
  options: { required?: boolean } = {}
): { value: string | undefined } | { error: string } => {
  const parsed =
    options.required === false
      ? parseOptionalBoundedString(value, {
          fieldName: 'password',
          maxLength: USER_SETTINGS_LIMITS.password,
        })
      : parseBoundedString(value, {
          fieldName: 'password',
          maxLength: USER_SETTINGS_LIMITS.password,
        });

  if ('error' in parsed) {
    return parsed;
  }

  return { value: parsed.value };
};

const parseResetGuid = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'password reset token',
    maxLength: MAX_RESET_GUID_LENGTH,
  });

const parseRequestBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

export const establishAuthenticatedSession = (
  req: Pick<Request, 'session'>,
  userId: number,
  credentialVersion = 0
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      reject(new Error('Session is unavailable.'));
      return;
    }

    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      req.session.userId = userId;
      req.session.credentialVersion = credentialVersion;
      resolve();
    });
  });

const parseOptionalPort = (
  value: unknown,
  fieldName: string
): { value: number | undefined } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PORT
  ) {
    return { error: `${fieldName} must be an integer between 1 and 65535.` };
  }

  return { value };
};

const parseOptionalMediaServerType = (
  value: unknown
):
  | { value: MediaServerType.JELLYFIN | MediaServerType.EMBY | undefined }
  | {
      error: string;
    } => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  return value === MediaServerType.JELLYFIN || value === MediaServerType.EMBY
    ? { value }
    : { error: 'serverType must be Jellyfin or Emby.' };
};

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const PLEX_OAUTH_HTTP_OPTIONS = {
  timeout: 10_000,
} as const;

const getPlexOAuthHeaders = () => ({
  Accept: 'application/json',
  'X-Plex-Product': 'Seerr',
  'X-Plex-Client-Identifier': getExternalRuntimeConfig().clientId,
});

const plexLoginEnabled = (): boolean => {
  const settings = getSettings();
  return (
    settings.main.mediaServerType === MediaServerType.NOT_CONFIGURED ||
    (settings.main.mediaServerLogin &&
      settings.main.mediaServerType === MediaServerType.PLEX)
  );
};

const parsePlexPinId = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_PLEX_PIN_ID
    ? id
    : undefined;
};

const plexPinPollRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1_200,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

authRoutes.get('/me', isAuthenticated(), async (req, res) => {
  const userRepository = getRepository(User);
  if (!req.user) {
    return res.status(401).json({
      status: 401,
      error: 'Please sign in.',
    });
  }
  const user = await userRepository.findOneOrFail({
    where: { id: req.user.id },
  });
  await User.populateRequestCounts([user]);

  // check if email is required in settings and if user has an valid email
  const settings = await getSettings();
  if (
    settings.notifications.agents.email.options.userEmailRequired &&
    !validator.isEmail(user.email, { require_tld: false })
  ) {
    user.warnings.push('userEmailRequired');
    logger.warn(`User ${user.username} has no valid email address`);
  }

  return res.status(200).json(user.filter(true));
});

authRoutes.post('/plex/pin', authRateLimit, async (req, res, next) => {
  logger.info('Plex OAuth PIN request received', {
    label: 'Auth',
    route: 'plex/pin',
    ip: req.ip,
  });
  if (!plexLoginEnabled()) {
    return res.status(403).json({ error: 'Plex login is disabled' });
  }

  try {
    const response = await axios.post(
      'https://clients.plex.tv/api/v2/pins?strong=true',
      undefined,
      {
        headers: getPlexOAuthHeaders(),
        ...PLEX_OAUTH_HTTP_OPTIONS,
      }
    );
    const data = response.data as Record<string, unknown>;
    const id = parsePlexPinId(String(data.id ?? ''));
    const code = data.code;
    if (
      !id ||
      typeof code !== 'string' ||
      code.length === 0 ||
      code.length > MAX_PLEX_PIN_CODE_LENGTH
    ) {
      return next({ status: 502, message: 'Plex returned an invalid PIN.' });
    }

    logger.info('Plex OAuth PIN created', {
      label: 'Auth',
      route: 'plex/pin',
      pinId: id,
    });

    return res.status(200).json({
      id,
      code,
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    });
  } catch (e) {
    logger.error('Unable to create Plex OAuth PIN', {
      label: 'Auth',
      error: e instanceof Error ? e.message : String(e),
    });
    return next({ status: 502, message: 'Unable to contact Plex.' });
  }
});

authRoutes.get(
  '/plex/pin/:id',
  plexPinPollRateLimit,
  async (req, res, next) => {
    if (!plexLoginEnabled()) {
      return res.status(403).json({ error: 'Plex login is disabled' });
    }
    const pinId = parsePlexPinId(req.params.id);
    if (!pinId) {
      return res.status(400).json({ error: 'Invalid Plex PIN id.' });
    }
    const pinCode = parseBoundedString(req.query.code, {
      fieldName: 'Plex PIN code',
      maxLength: MAX_PLEX_PIN_CODE_LENGTH,
    });
    if ('error' in pinCode) {
      return res.status(400).json({ error: pinCode.error });
    }

    try {
      const response = await axios.get(
        `https://clients.plex.tv/api/v2/pins/${pinId}`,
        {
          headers: getPlexOAuthHeaders(),
          params: { code: pinCode.value },
          ...PLEX_OAUTH_HTTP_OPTIONS,
        }
      );
      const data = response.data as Record<string, unknown>;
      const authToken = data.authToken;
      if (typeof authToken === 'string' && authToken.length > 0) {
        logger.info('Plex OAuth PIN claimed', {
          label: 'Auth',
          route: 'plex/pin',
          pinId,
        });
      }
      return res.status(200).json({
        authToken:
          typeof authToken === 'string' &&
          authToken.length <= MAX_AUTH_TOKEN_LENGTH
            ? authToken
            : null,
        expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
      });
    } catch (e) {
      logger.warn('Unable to poll Plex OAuth PIN', {
        label: 'Auth',
        pinId,
        error: e instanceof Error ? e.message : String(e),
      });
      return next({ status: 502, message: 'Unable to contact Plex.' });
    }
  }
);

authRoutes.post('/plex', authRateLimit, async (req, res, next) => {
  logger.info('Plex auth exchange received', {
    label: 'Auth',
    route: 'plex',
    ip: req.ip,
  });
  const settings = getSettings();
  const userRepository = getRepository(User);
  const parsedBody = parseRequestBodyObject(req.body);
  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }
  const body = parsedBody.value;
  const authToken = parseBoundedString(body.authToken, {
    fieldName: 'Authentication token',
    maxLength: MAX_AUTH_TOKEN_LENGTH,
  });

  if ('error' in authToken) {
    return next({
      status: 400,
      message: authToken.error,
    });
  }

  if (
    settings.main.mediaServerType != MediaServerType.NOT_CONFIGURED &&
    (settings.main.mediaServerLogin === false ||
      settings.main.mediaServerType != MediaServerType.PLEX)
  ) {
    return res.status(403).json({ error: 'Plex login is disabled' });
  }
  try {
    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(authToken.value);
    const rawAccount = await plextv.getUser();
    const parsedAccount = parsePlexAccountIdentity(rawAccount, authToken.value);
    if ('error' in parsedAccount) {
      logger.error('Plex returned an invalid account identity', {
        label: 'Auth',
        ip: req.ip,
      });
      return next({ status: 502, message: parsedAccount.error });
    }
    const account = parsedAccount.value;
    const avatar =
      account.thumb ?? gravatarUrl(account.email, { default: 'mm', size: 200 });

    const plexAdmissionResources = [
      getAuthAccountAdmissionResource('plex', String(account.id)),
      getAuthAccountAdmissionResource('email', account.email.toLowerCase()),
    ];
    if (getSettings().main.mediaServerType === MediaServerType.NOT_CONFIGURED) {
      plexAdmissionResources.push(
        getAuthAccountAdmissionResource('plex', 'bootstrap-owner')
      );
    }

    // Resolve and update the canonical account under the same identity locks
    // used by imports and account linking. Different processes therefore
    // cannot both pass the initial lookup and create competing users.
    const user = await runAuthAccountAdmission(
      plexAdmissionResources,
      async () => {
        const activeSettings = getSettings();
        if (
          activeSettings.main.mediaServerType !==
            MediaServerType.NOT_CONFIGURED &&
          (activeSettings.main.mediaServerLogin === false ||
            activeSettings.main.mediaServerType !== MediaServerType.PLEX)
        ) {
          return undefined;
        }

        let admittedUser = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId = :id', { id: account.id })
          .orWhere('user.email = :email', {
            email: account.email.toLowerCase(),
          })
          .getOne();

        if (!admittedUser && !(await userRepository.count())) {
          admittedUser = new User({
            // The canonical owner ID is also a database-level bootstrap lock: two
            // concurrent first-login requests cannot both insert user 1 and become
            // administrators.
            id: 1,
            email: account.email,
            plexUsername: account.username,
            plexId: account.id,
            plexToken: account.authToken,
            permissions: Permission.ADMIN,
            avatar,
            userType: UserType.PLEX,
          });

          await userRepository.save(admittedUser);
        } else {
          const mainUser = await userRepository.findOneOrFail({
            select: { id: true, plexToken: true, plexId: true, email: true },
            where: { id: 1 },
          });
          const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

          if (
            account.id === mainUser.plexId ||
            (account.email === mainUser.email && !mainUser.plexId) ||
            (await mainPlexTv.checkUserAccess(account.id))
          ) {
            if (admittedUser) {
              if (!admittedUser.plexId) {
                logger.info(
                  'Found matching Plex user; updating user with Plex data',
                  {
                    label: 'API',
                    ip: req.ip,
                    email: admittedUser.email,
                    userId: admittedUser.id,
                    plexId: account.id,
                    plexUsername: account.username,
                  }
                );
              }

              admittedUser = await runUserSecurityMutation(
                admittedUser.id,
                async () => {
                  const activeUser = await userRepository.findOneByOrFail({
                    id: admittedUser!.id,
                  });
                  // Limit login refreshes to identity columns. Saving the entity
                  // loaded before checkUserAccess() would also write stale
                  // permissions changed while the provider request was in flight.
                  await userRepository.update(activeUser.id, {
                    plexToken: authToken.value,
                    plexId: account.id,
                    avatar,
                    email: account.email,
                    plexUsername: account.username,
                    userType: UserType.PLEX,
                  });
                  return userRepository.findOneByOrFail({ id: activeUser.id });
                }
              );
            } else if (!getSettings().main.newPlexLogin) {
              logger.warn(
                'Failed sign-in attempt by unimported Plex user with access to the media server',
                {
                  label: 'API',
                  ip: req.ip,
                  email: account.email,
                  plexId: account.id,
                  plexUsername: account.username,
                }
              );
              return undefined;
            } else {
              logger.info(
                'Sign-in attempt from Plex user with access to the media server; creating new Seerr user',
                {
                  label: 'API',
                  ip: req.ip,
                  email: account.email,
                  plexId: account.id,
                  plexUsername: account.username,
                }
              );
              admittedUser = new User({
                email: account.email,
                plexUsername: account.username,
                plexId: account.id,
                plexToken: account.authToken,
                permissions: getSettings().main.defaultPermissions,
                avatar,
                userType: UserType.PLEX,
              });

              await userRepository.save(admittedUser);
            }
          } else {
            logger.warn(
              'Failed sign-in attempt by Plex user without access to the media server',
              {
                label: 'API',
                ip: req.ip,
                email: account.email,
                plexId: account.id,
                plexUsername: account.username,
              }
            );
            return undefined;
          }
        }

        if (
          getSettings().main.mediaServerType ===
            MediaServerType.NOT_CONFIGURED &&
          admittedUser.id === 1
        ) {
          await runAuthorizedUserSecurityMutation(
            admittedUser.id,
            admittedUser.id,
            Permission.ADMIN,
            async () => {
              if (
                getSettings().main.mediaServerType !==
                MediaServerType.NOT_CONFIGURED
              ) {
                return;
              }
              await runWithConfigurationAdmission('plex', () =>
                settings.persistSection('main', (current) => ({
                  ...current,
                  mediaServerType: MediaServerType.PLEX,
                }))
              );
              startJobs();
            }
          );
        }

        return admittedUser;
      }
    );

    if (!user) {
      return next({ status: 403, message: 'Access denied.' });
    }

    await establishAuthenticatedSession(
      req,
      user.id,
      user.passwordChangedAt?.getTime() ?? 0
    );

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({ status: 403, message: 'Access denied.' });
    }
    logger.error('Something went wrong authenticating with Plex account', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
    });
    return next({
      status: 500,
      message: 'Unable to authenticate.',
    });
  }
});

function getUserAvatarUrl(user: User): string {
  return `/avatarproxy/${user.jellyfinUserId}?v=${user.avatarVersion}`;
}

authRoutes.post('/jellyfin', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const initialJellyfinAuthorityKey = getJellyfinAuthAuthorityKey(settings);
  const initialMediaServerType = settings.main.mediaServerType;
  const userRepository = getRepository(User);
  const parsedBody = parseRequestBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ error: parsedBody.error });
  }
  const body = parsedBody.value as {
    username?: string;
    password?: string;
    hostname?: string;
    port?: number;
    urlBase?: string;
    useSsl?: boolean;
    email?: string;
    serverType?: number;
  };
  const username = parseLoginIdentifier(body.username, 'username');

  if ('error' in username) {
    return res.status(400).json({ error: username.error });
  }

  const password = parsePassword(body.password, { required: false });

  if ('error' in password) {
    return res.status(400).json({ error: password.error });
  }

  const email = parseOptionalBoundedString(body.email, {
    fieldName: 'email',
    maxLength: USER_SETTINGS_LIMITS.email,
  });

  if ('error' in email) {
    return res.status(400).json({ error: email.error });
  }

  const hostname = parseOptionalBoundedString(body.hostname, {
    fieldName: 'hostname',
    maxLength: MAX_HOSTNAME_LENGTH,
  });

  if ('error' in hostname) {
    return res.status(400).json({ error: hostname.error });
  }

  const urlBase = parseOptionalBoundedString(body.urlBase, {
    fieldName: 'urlBase',
    maxLength: MAX_URL_BASE_LENGTH,
  });

  if ('error' in urlBase) {
    return res.status(400).json({ error: urlBase.error });
  }

  const normalizedUrlBase = normalizeUrlBase(urlBase.value);
  if (urlBase.value && !normalizedUrlBase) {
    return res.status(400).json({ error: 'urlBase must be a relative path.' });
  }

  const port = parseOptionalPort(body.port, 'port');
  if ('error' in port) {
    return res.status(400).json({ error: port.error });
  }

  const useSsl = parseOptionalBodyBoolean(body.useSsl, 'useSsl');
  if ('error' in useSsl) {
    return res.status(400).json({ error: useSsl.error });
  }

  const serverType = parseOptionalMediaServerType(body.serverType);
  if ('error' in serverType) {
    return res.status(400).json({ error: serverType.error });
  }

  body.username = username.value;
  body.password = password.value;
  body.email = email.value;
  body.hostname = hostname.value;
  body.urlBase = normalizedUrlBase || undefined;
  body.port = port.value;
  body.useSsl = useSsl.value;
  body.serverType = serverType.value;

  //Make sure jellyfin login is enabled, but only if jellyfin && Emby is not already configured
  if (
    // media server not configured, allow login for setup
    settings.main.mediaServerType != MediaServerType.NOT_CONFIGURED &&
    (settings.main.mediaServerLogin === false ||
      // media server is neither jellyfin or emby
      (settings.main.mediaServerType !== MediaServerType.JELLYFIN &&
        settings.main.mediaServerType !== MediaServerType.EMBY))
  ) {
    return res.status(403).json({ error: 'Jellyfin login is disabled' });
  }

  if (settings.jellyfin.ip !== '' && body.hostname) {
    return res
      .status(409)
      .json({ error: 'Jellyfin hostname already configured' });
  } else if (settings.jellyfin.ip === '' && !body.hostname) {
    return res.status(400).json({ error: 'No hostname provided.' });
  }

  if (settings.jellyfin.ip === '' && body.hostname) {
    try {
      const parsedHostname = new URL(
        getHostname({
          useSsl: body.useSsl,
          ip: body.hostname,
          port: body.port,
          urlBase: body.urlBase,
        })
      ).hostname;

      if (
        process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS !== 'true' &&
        (await resolvesToLocalOrPrivateAddress(parsedHostname))
      ) {
        return res.status(400).json({
          error:
            'Jellyfin/Emby hostname must not resolve to a private address.',
        });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid hostname provided.' });
    }
  }

  let administratorSetupLease: AuthorizedUserSecurityMutationLease | undefined;

  try {
    const allowPrivateAddresses =
      settings.jellyfin.ip !== '' ||
      process.env.SEERR_ALLOW_PRIVATE_SETUP_HOSTS === 'true';
    const hostname =
      settings.jellyfin.ip !== ''
        ? getHostname()
        : getHostname({
            useSsl: body.useSsl,
            ip: body.hostname,
            port: body.port,
            urlBase: body.urlBase,
          });

    // Try to find deviceId that corresponds to jellyfin user, else generate a new one
    let user = await userRepository.findOne({
      where: { jellyfinUsername: body.username },
      select: { id: true, jellyfinDeviceId: true },
    });

    let deviceId = 'BOT_seerr';
    if (user && user.id === 1) {
      // Admin is always BOT_seerr
      deviceId = 'BOT_seerr';
    } else if (user && user.jellyfinDeviceId) {
      deviceId = user.jellyfinDeviceId;
    } else if (body.username) {
      deviceId = Buffer.from(`BOT_seerr_${body.username}`).toString('base64');
    }

    // First we need to attempt to log the user in to jellyfin
    const jellyfinserver = new JellyfinAPI(
      hostname ?? '',
      undefined,
      deviceId,
      allowPrivateAddresses
    );

    const ip = req.ip;
    let clientIp;

    if (ip) {
      if (net.isIPv4(ip)) {
        clientIp = ip;
      } else if (net.isIPv6(ip)) {
        clientIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
      }
    }

    const account = await jellyfinserver.login(
      body.username,
      body.password,
      clientIp
    );
    const jellyfinUserId = normalizeJellyfinGuid(account.User.Id);
    if (!jellyfinUserId) {
      logger.error('Jellyfin returned an invalid user ID', {
        label: 'Auth',
        ip: req.ip,
        jellyfinUsername: account.User.Name,
      });
      return next({
        status: 502,
        message: 'Media server returned an invalid user identity.',
      });
    }

    const jellyfinAdmissionResources = [
      getAuthAccountAdmissionResource('jellyfin', jellyfinUserId),
      getAuthAccountAdmissionResource(
        'email',
        (body.email || account.User.Name).toLowerCase()
      ),
    ];
    if (getSettings().main.mediaServerType === MediaServerType.NOT_CONFIGURED) {
      jellyfinAdmissionResources.push(
        getAuthAccountAdmissionResource('jellyfin', 'bootstrap-owner')
      );
    }

    return await runAuthAccountAdmission(
      jellyfinAdmissionResources,
      async () => {
        const activeSettings = getSettings();
        if (
          getJellyfinAuthAuthorityKey(activeSettings) !==
            initialJellyfinAuthorityKey ||
          (body.hostname && activeSettings.jellyfin.ip !== '') ||
          (activeSettings.main.mediaServerType !==
            MediaServerType.NOT_CONFIGURED &&
            (activeSettings.main.mediaServerLogin === false ||
              (activeSettings.main.mediaServerType !==
                MediaServerType.JELLYFIN &&
                activeSettings.main.mediaServerType !== MediaServerType.EMBY)))
        ) {
          return res.status(409).json({
            error: 'Media server configuration changed during login.',
          });
        }

        // Next let's see if the user already exists
        user = await userRepository.findOne({
          where: { jellyfinUserId },
        });

        const missingAdminUser = !user && (await userRepository.count()) === 0;
        if (
          missingAdminUser ||
          initialMediaServerType === MediaServerType.NOT_CONFIGURED
        ) {
          // Check if user is admin on jellyfin
          if (account.User.Policy.IsAdministrator === false) {
            throw new ApiError(403, ApiErrorCode.NotAdmin);
          }

          if (
            body.serverType !== MediaServerType.JELLYFIN &&
            body.serverType !== MediaServerType.EMBY
          ) {
            throw new ApiError(500, ApiErrorCode.NoAdminUser);
          }
          if (!missingAdminUser) {
            const setupActorId = req.user?.id ?? (user?.id === 1 ? user.id : 0);
            if (!setupActorId) {
              return res.status(403).json({
                error:
                  'An authenticated administrator is required to configure the media server.',
              });
            }

            try {
              administratorSetupLease =
                await acquireAuthorizedUserSecurityMutation(
                  setupActorId,
                  [setupActorId, 1],
                  Permission.ADMIN
                );
              req.user = administratorSetupLease.actor;
            } catch (error) {
              if (error instanceof UserMutationActorUnauthorizedError) {
                return res.status(403).json({
                  error:
                    'An authenticated administrator is required to configure the media server.',
                });
              }
              throw error;
            }

            const currentSettings = getSettings();
            if (
              currentSettings.jellyfin.ip !== '' ||
              currentSettings.main.mediaServerType !==
                MediaServerType.NOT_CONFIGURED
            ) {
              return res.status(409).json({
                error: 'Media server configuration changed during setup.',
              });
            }
          }
          if (missingAdminUser) {
            logger.info(
              'Sign-in attempt from Jellyfin user with access to the media server; creating initial admin user for Seerr',
              {
                label: 'API',
                ip: req.ip,
                jellyfinUsername: account.User.Name,
              }
            );

            // User doesn't exist, and there are no users in the database, we'll create the user
            // with admin permissions

            user = new User({
              id: 1,
              email: body.email || account.User.Name,
              jellyfinUsername: account.User.Name,
              jellyfinUserId,
              jellyfinDeviceId: deviceId,
              jellyfinAuthToken: account.AccessToken,
              permissions: Permission.ADMIN,
              userType:
                body.serverType === MediaServerType.JELLYFIN
                  ? UserType.JELLYFIN
                  : UserType.EMBY,
            });
            user.avatar = getUserAvatarUrl(user);

            // update() cannot claim a missing owner row. Persist the canonical ID
            // so first-time Jellyfin setup actually creates the administrator and
            // concurrent setup attempts contend on the database primary key.
            user = await userRepository.save(user);
          } else {
            logger.info(
              'Sign-in attempt from Jellyfin user with access to the media server; editing admin user for Seerr',
              {
                label: 'API',
                ip: req.ip,
                jellyfinUsername: account.User.Name,
              }
            );

            // User alread exist but settings.json is not configured, we'll edit the admin user

            user = await userRepository.findOne({
              where: { id: 1 },
            });
            if (!user) {
              throw new Error('Unable to find admin user to edit');
            }
            user.email = body.email || account.User.Name;
            user.jellyfinUsername = account.User.Name;
            user.jellyfinUserId = jellyfinUserId;
            user.jellyfinDeviceId = deviceId;
            user.jellyfinAuthToken = account.AccessToken;
            user.permissions = Permission.ADMIN;
            user.avatar = getUserAvatarUrl(user);
            user.userType =
              body.serverType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY;

            await userRepository.save(user);
          }

          // Create an API key on Jellyfin from this admin user
          const jellyfinClient = new JellyfinAPI(
            hostname,
            account.AccessToken,
            deviceId,
            allowPrivateAddresses
          );
          const apiKey = await jellyfinClient.createApiToken('Seerr');

          const serverName = await jellyfinserver.getServerName();

          await runWithConfigurationAdmission('jellyfin', () =>
            settings.persistChanges((current) => ({
              main: {
                ...current.main,
                mediaServerType: body.serverType!,
              },
              jellyfin: {
                ...current.jellyfin,
                name: serverName,
                serverId: account.User.ServerId,
                ip: body.hostname ?? '',
                port: body.port ?? 8096,
                urlBase: body.urlBase ?? '',
                useSsl: body.useSsl ?? false,
                apiKey,
              },
            }))
          );
          startJobs();
        }
        // User already exists, let's update their information
        else if (jellyfinUserId === user?.jellyfinUserId) {
          logger.info(
            `Found matching ${
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? ServerType.JELLYFIN
                : ServerType.EMBY
            } user; updating user with ${
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? ServerType.JELLYFIN
                : ServerType.EMBY
            }`,
            {
              label: 'API',
              ip: req.ip,
              jellyfinUsername: account.User.Name,
            }
          );
          user.avatar = getUserAvatarUrl(user);
          user.jellyfinUsername = account.User.Name;

          if (user.username === account.User.Name) {
            user.username = '';
          }

          user = await runUserSecurityMutation(user.id, async () => {
            const activeUser = await userRepository.findOneByOrFail({
              id: user!.id,
            });
            await userRepository.update(activeUser.id, {
              avatar: getUserAvatarUrl(activeUser),
              jellyfinUsername: account.User.Name,
              ...(activeUser.username === account.User.Name
                ? { username: '' }
                : {}),
            });
            return userRepository.findOneByOrFail({ id: activeUser.id });
          });
        } else if (!settings.main.newPlexLogin) {
          logger.warn(
            'Failed sign-in attempt by unimported Jellyfin user with access to the media server',
            {
              label: 'API',
              ip: req.ip,
              jellyfinUserId,
              jellyfinUsername: account.User.Name,
            }
          );
          return next({
            status: 403,
            message: 'Access denied.',
          });
        } else if (!user) {
          logger.info(
            'Sign-in attempt from Jellyfin user with access to the media server; creating new Seerr user',
            {
              label: 'API',
              ip: req.ip,
              jellyfinUsername: account.User.Name,
            }
          );

          user = new User({
            email: body.email || account.User.Name,
            jellyfinUsername: account.User.Name,
            jellyfinUserId,
            jellyfinDeviceId: deviceId,
            permissions: settings.main.defaultPermissions,
            userType:
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY,
          });
          user.avatar = getUserAvatarUrl(user);

          //initialize Jellyfin/Emby users with local login
          const passedExplicitPassword =
            body.password && body.password.length > 0;
          if (passedExplicitPassword) {
            await user.setPassword(body.password ?? '');
          }
          await userRepository.save(user);
        }

        if (user && user.jellyfinUserId) {
          try {
            const { changed } = await checkAvatarChanged(user);

            if (changed) {
              user.avatar = getUserAvatarUrl(user);
              await userRepository.update(user.id, { avatar: user.avatar });
              logger.debug('Avatar updated during login', {
                userId: user.id,
                jellyfinUserId: user.jellyfinUserId,
              });
            }
          } catch (error) {
            logger.error('Error handling avatar during login', {
              label: 'Auth',
              errorMessage: error.message,
            });
          }
        }

        if (
          initialMediaServerType !== MediaServerType.NOT_CONFIGURED &&
          getJellyfinAuthAuthorityKey() !== initialJellyfinAuthorityKey
        ) {
          return res.status(409).json({
            error: 'Media server configuration changed during login.',
          });
        }

        await establishAuthenticatedSession(
          req,
          user.id,
          user.passwordChangedAt?.getTime() ?? 0
        );

        return res.status(200).json(user?.filter() ?? {});
      }
    );
  } catch (e) {
    switch (e.errorCode) {
      case ApiErrorCode.InvalidUrl:
        logger.error(
          `The provided ${
            settings.main.mediaServerType === MediaServerType.JELLYFIN
              ? ServerType.JELLYFIN
              : ServerType.EMBY
          } is invalid or the server is not reachable.`,
          {
            label: 'Auth',
            error: e.errorCode,
            status: e.statusCode,
            hostname: getHostname({
              useSsl: body.useSsl,
              ip: body.hostname,
              port: body.port,
              urlBase: body.urlBase,
            }),
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.InvalidCredentials:
        logger.warn(
          'Failed sign-in attempt from user with incorrect Jellyfin credentials',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
              password: '__REDACTED__',
            },
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.NotAdmin:
        logger.warn(
          'Failed sign-in attempt from user without admin permissions',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
            },
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.NoAdminUser:
        logger.warn(
          'Failed sign-in attempt from user without admin permissions and no admin user exists',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
            },
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      default:
        logger.error(e.message, { label: 'Auth' });
        return next({
          status: 500,
          message: 'Something went wrong.',
        });
    }
  } finally {
    await administratorSetupLease?.release();
  }
});

authRoutes.post('/local', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const parsedBody = parseRequestBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ error: parsedBody.error });
  }
  const body = parsedBody.value;
  const email = parseLoginIdentifier(body.email);
  const password = parsePassword(body.password);

  if (!settings.main.localLogin) {
    return res.status(403).json({ error: 'Password sign-in is disabled.' });
  } else if ('error' in email || 'error' in password) {
    return res.status(400).json({
      error: 'You must provide both an email address and a password.',
    });
  }
  try {
    const normalizedEmail = email.value.toLowerCase();
    const admissionKey = createHash('sha256')
      .update(normalizedEmail)
      .digest('hex');
    const result = await localLoginAttemptLock.dispatch(admissionKey, () =>
      requestAdmissionCoordinator.run(
        [`auth:local-account:${admissionKey}`],
        async () => {
          const userRepository = getRepository(User);
          const user = await userRepository
            .createQueryBuilder('user')
            .select([
              'user.id',
              'user.email',
              'user.password',
              'user.passwordChangedAt',
              'user.plexId',
              'user.failedLoginAttempts',
              'user.lastFailedLoginAt',
              'user.loginBlockedUntil',
            ])
            .where('user.email = :email', { email: normalizedEmail })
            .getOne();

          const suppliedPassword = password.value ?? '';
          let passwordMatches: boolean;
          try {
            passwordMatches = await verifyLocalPassword(
              suppliedPassword,
              user?.password ?? DUMMY_LOGIN_PASSWORD_HASH
            );
          } catch (error) {
            if (error instanceof BoundedTaskQueueFullError) {
              return { authenticated: false, user, overloaded: true };
            }
            throw error;
          }
          const now = new Date();

          if (!user) {
            return { authenticated: false, user: undefined };
          }

          if (!passwordMatches) {
            if (
              user.loginBlockedUntil &&
              user.loginBlockedUntil.getTime() > now.getTime()
            ) {
              return { authenticated: false, user };
            }

            const lastFailureTime = user.lastFailedLoginAt?.getTime();
            const failuresInWindow =
              lastFailureTime !== undefined &&
              now.getTime() - lastFailureTime < LOCAL_LOGIN_FAILURE_WINDOW_MS
                ? (user.failedLoginAttempts ?? 0)
                : 0;
            const failedLoginAttempts = failuresInWindow + 1;
            await userRepository.update(user.id, {
              failedLoginAttempts,
              lastFailedLoginAt: now,
              loginBlockedUntil:
                failedLoginAttempts >= LOCAL_LOGIN_FAILURE_LIMIT
                  ? new Date(now.getTime() + LOCAL_LOGIN_FAILURE_WINDOW_MS)
                  : null,
            });
            return { authenticated: false, user };
          }

          if (
            (user.failedLoginAttempts ?? 0) !== 0 ||
            user.lastFailedLoginAt != null ||
            user.loginBlockedUntil != null
          ) {
            await userRepository.update(user.id, {
              failedLoginAttempts: 0,
              lastFailedLoginAt: null,
              loginBlockedUntil: null,
            });
          }

          return { authenticated: true, user };
        }
      )
    );

    if (result.overloaded) {
      logger.warn('Local password verification queue is full', {
        label: 'API',
        ip: req.ip,
      });
      return next({
        status: 503,
        message: 'Authentication is temporarily unavailable.',
      });
    }

    if (!result.authenticated || !result.user) {
      logger.warn('Failed sign-in attempt using invalid Seerr password', {
        label: 'API',
        ip: req.ip,
        email: email.value,
        userId: result.user?.id,
      });
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    await establishAuthenticatedSession(
      req,
      result.user.id,
      result.user.passwordChangedAt?.getTime() ?? 0
    );

    return res.status(200).json(result.user.filter());
  } catch (e) {
    logger.error('Something went wrong authenticating with Seerr password', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
      email: 'error' in email ? undefined : email.value,
    });
    return next({
      status: 500,
      message: 'Unable to authenticate.',
    });
  }
});

const getOidcRedirectUrl = (req: Request) => {
  const applicationUrl = getSettings().main.applicationUrl;
  if (!applicationUrl) {
    return undefined;
  }

  const baseUrl = new URL(applicationUrl);
  const returnUrl =
    typeof req.query.returnUrl === 'string' ? req.query.returnUrl : '/login';

  const resolved = new URL(returnUrl, baseUrl);

  // Only allow same-origin return targets. This URL becomes the OIDC
  // redirect_uri, so an attacker-supplied absolute or protocol-relative
  // returnUrl (e.g. "https://evil.example" or "//evil.example") would
  // otherwise turn the login flow into an open redirect / authorization-code
  // leak whenever the provider's redirect allowlist is permissive.
  const allowedPaths = new Set(['/login', '/profile/settings/linked-accounts']);
  if (
    resolved.origin !== baseUrl.origin ||
    !allowedPaths.has(resolved.pathname) ||
    resolved.search ||
    resolved.hash
  ) {
    return new URL('/login', baseUrl);
  }

  return resolved;
};

const OIDC_CORRELATION_COOKIE_PREFIX = 'oidc-correlation-';
const OIDC_CORRELATION_COOKIE_PATH = '/api/v1/auth/oidc';
const OIDC_STATE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
export const OIDC_HTTP_TIMEOUT_SECONDS = 10;
export const MAX_ACTIVE_OIDC_CORRELATIONS = 8;

interface OidcCorrelation {
  authorizationContext: string;
  codeVerifier: string;
  initiatingUserId: number | null;
  issuedAt: number;
  nonce: string;
  redirectUri: string;
  state: string;
}

type OidcProviderAuthority = Pick<
  ReturnType<typeof getSettings>['oidc']['providers'][number],
  'slug' | 'issuerUrl' | 'clientId' | 'clientSecret' | 'scopes'
>;

const hasSameOidcProviderAuthority = (
  current: OidcProviderAuthority,
  snapshot: OidcProviderAuthority
): boolean =>
  current.slug === snapshot.slug &&
  current.issuerUrl === snapshot.issuerUrl &&
  current.clientId === snapshot.clientId &&
  current.clientSecret === snapshot.clientSecret &&
  (current.scopes ?? 'openid profile email') ===
    (snapshot.scopes ?? 'openid profile email');

const getOidcAuthorizationContext = (
  provider: Pick<
    ReturnType<typeof getSettings>['oidc']['providers'][number],
    'slug' | 'issuerUrl' | 'clientId' | 'clientSecret' | 'scopes'
  >
): string =>
  // Key the digest so the browser-visible signed cookie cannot be used as an
  // offline oracle for a low-entropy client secret. Rotating any token-exchange
  // credential invalidates flows started under the prior provider authority.
  createHmac('sha256', getSettings().sessionSecret)
    .update(
      JSON.stringify([
        provider.slug,
        provider.issuerUrl,
        provider.clientId,
        provider.clientSecret,
        provider.scopes ?? 'openid profile email',
      ])
    )
    .digest('hex');

const oidcProviderClaimsAllowed = (
  provider: Pick<
    ReturnType<typeof getSettings>['oidc']['providers'][number],
    'requiredClaims'
  >,
  claims: Record<string, unknown>
): boolean =>
  (provider.requiredClaims ?? '')
    .split(' ')
    .filter(Boolean)
    .every((claim) => claims[claim] === true);

const getOidcCorrelationCookieName = (state: string): string | undefined =>
  OIDC_STATE_PATTERN.test(state)
    ? `${OIDC_CORRELATION_COOKIE_PREFIX}${state}`
    : undefined;

export const isAllowedOidcAuthorizationUrl = (
  url: URL,
  allowInsecure = process.env.OIDC_ALLOW_INSECURE === 'true'
): boolean =>
  url.username === '' &&
  url.password === '' &&
  (url.protocol === 'https:' || (allowInsecure && url.protocol === 'http:'));

export const parseOidcCallbackUrl = (value: unknown): URL | undefined => {
  const parsed = parseBoundedString(value, {
    fieldName: 'OIDC callback URL',
    maxLength: MAX_OIDC_CALLBACK_URL_LENGTH,
  });
  if ('error' in parsed) {
    return undefined;
  }

  try {
    return new URL(parsed.value);
  } catch {
    return undefined;
  }
};

const parseOidcCorrelation = (value: unknown): OidcCorrelation | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Partial<OidcCorrelation>).authorizationContext ===
        'string' &&
      typeof (parsed as Partial<OidcCorrelation>).codeVerifier === 'string' &&
      ((parsed as Partial<OidcCorrelation>).initiatingUserId === null ||
        (Number.isSafeInteger(
          (parsed as Partial<OidcCorrelation>).initiatingUserId
        ) &&
          (parsed as Partial<OidcCorrelation>).initiatingUserId! > 0)) &&
      Number.isSafeInteger((parsed as Partial<OidcCorrelation>).issuedAt) &&
      (parsed as Partial<OidcCorrelation>).issuedAt! > 0 &&
      typeof (parsed as Partial<OidcCorrelation>).nonce === 'string' &&
      typeof (parsed as Partial<OidcCorrelation>).redirectUri === 'string' &&
      typeof (parsed as Partial<OidcCorrelation>).state === 'string'
    ) {
      return parsed as OidcCorrelation;
    }
  } catch {
    // Invalid signed correlation payloads are handled as failed authorization.
  }

  return undefined;
};

const pruneOidcCorrelationCookies = (req: Request, res: Response): void => {
  const correlations = Object.entries(
    req.signedCookies as Record<string, unknown>
  )
    .filter(([name]) => name.startsWith(OIDC_CORRELATION_COOKIE_PREFIX))
    .map(([name, value]) => ({
      name,
      issuedAt: parseOidcCorrelation(value)?.issuedAt ?? 0,
    }))
    .sort((left, right) => right.issuedAt - left.issuedAt);

  // Leave room for the new correlation. Clearing old or malformed signed
  // entries keeps the aggregate Cookie header below common proxy limits while
  // retaining several independently completable login attempts.
  for (const { name } of correlations.slice(MAX_ACTIVE_OIDC_CORRELATIONS - 1)) {
    res.clearCookie(name, { path: OIDC_CORRELATION_COOKIE_PATH });
  }
};

authRoutes.get('/oidc/login/:slug', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const configuredProvider = settings.oidc.providers.find(
    (p) => p.slug === req.params.slug
  );
  // Settings objects are mutable. Keep an immutable-by-convention value
  // snapshot so later authority comparisons cannot be defeated by an
  // in-place configuration update changing both sides of the comparison.
  const provider = configuredProvider ? { ...configuredProvider } : undefined;

  if (!settings.main.oidcLogin || !provider) {
    return next({
      status: 403,
      error: ApiErrorCode.Unauthorized,
    });
  }

  const callbackUrl = getOidcRedirectUrl(req);
  if (!callbackUrl) {
    logger.error('OIDC login requires a configured application URL', {
      label: 'Auth',
      provider: provider.name,
      ip: req.ip,
    });
    return next({
      status: 503,
      error: ApiErrorCode.OidcAuthorizationFailed,
    });
  }

  let config: openIdClient.Configuration;
  try {
    config = await openIdClient.discovery(
      new URL(provider.issuerUrl),
      provider.clientId,
      provider.clientSecret,
      undefined,
      {
        timeout: OIDC_HTTP_TIMEOUT_SECONDS,
        [openIdClient.customFetch]: oidcSafeFetch,
        execute:
          process.env.OIDC_ALLOW_INSECURE === 'true'
            ? [openIdClient.allowInsecureRequests]
            : [],
      }
    );
  } catch (error) {
    logger.error('Failed OIDC provider discovery', {
      label: 'Auth',
      provider: provider.name,
      ip: req.ip,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return next({
      status: 500,
      error: ApiErrorCode.OidcProviderDiscoveryFailed,
    });
  }

  // Use of PKCE is backwards compatible even if the AS doesn't support it.
  const code_verifier = openIdClient.randomPKCECodeVerifier();
  const code_challenge =
    await openIdClient.calculatePKCECodeChallenge(code_verifier);

  const parameters: Record<string, string> = {
    redirect_uri: callbackUrl.toString(),
    scope: provider.scopes ?? 'openid profile email',
    code_challenge,
    code_challenge_method: 'S256',
  };

  // State prevents CSRF attacks
  const state = openIdClient.randomState();
  parameters.state = state;

  const nonce = openIdClient.randomNonce();
  parameters.nonce = nonce;
  const correlationCookieName = getOidcCorrelationCookieName(state);
  if (!correlationCookieName) {
    logger.error('OIDC client generated an invalid state value', {
      label: 'Auth',
      provider: provider.name,
      ip: req.ip,
    });
    return next({
      status: 500,
      error: ApiErrorCode.OidcAuthorizationFailed,
    });
  }

  let redirectUrl: URL;
  try {
    redirectUrl = openIdClient.buildAuthorizationUrl(config, parameters);
  } catch (error) {
    logger.error('Failed to build OIDC authorization URL', {
      label: 'Auth',
      provider: provider.name,
      ip: req.ip,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return next({
      status: 500,
      error: ApiErrorCode.OidcAuthorizationFailed,
    });
  }

  if (!isAllowedOidcAuthorizationUrl(redirectUrl)) {
    logger.error('OIDC authorization URL is not allowed', {
      label: 'Auth',
      provider: provider.name,
      ip: req.ip,
      protocol: redirectUrl.protocol,
      hasCredentials:
        redirectUrl.username !== '' || redirectUrl.password !== '',
    });
    return next({
      status: 500,
      error: ApiErrorCode.OidcAuthorizationFailed,
    });
  }

  // Do not persist correlation state until the complete authorization target
  // has been built and admitted. Failed or unsafe provider metadata must not
  // leave state cookies behind in the browser.
  pruneOidcCorrelationCookies(req, res);
  res.cookie(
    correlationCookieName,
    JSON.stringify({
      authorizationContext: getOidcAuthorizationContext(provider),
      codeVerifier: code_verifier,
      // A flow started as a login must stay a login, and a flow started as an
      // account link must return under the same actor. Otherwise a session
      // change between these requests can attach the provider identity to a
      // different local account.
      initiatingUserId: req.user?.id ?? null,
      issuedAt: Date.now(),
      nonce,
      redirectUri: callbackUrl.toString(),
      state,
    } satisfies OidcCorrelation),
    {
      httpOnly: true,
      path: OIDC_CORRELATION_COOKIE_PATH,
      secure: callbackUrl.protocol === 'https:',
      signed: true,
      sameSite: 'strict',
      maxAge: 10 * 60 * 1000,
    }
  );

  return res.status(200).json({
    redirectUrl,
  });
});

authRoutes.post(
  '/oidc/callback/:slug',
  authRateLimit,
  async (
    req: Request<{ slug: string }, never, { callbackUrl: string }>,
    res,
    next
  ) => {
    const settings = getSettings();
    const configuredProvider = settings.oidc.providers.find(
      (p) => p.slug === req.params.slug
    );
    const provider = configuredProvider ? { ...configuredProvider } : undefined;

    if (!settings.main.oidcLogin || !provider) {
      return next({
        status: 403,
        error: ApiErrorCode.Unauthorized,
      });
    }

    let redirectUrl: URL;
    let correlationCookieName: string | undefined;
    try {
      const parsedRedirectUrl = parseOidcCallbackUrl(req.body?.callbackUrl);
      if (!parsedRedirectUrl) {
        throw new Error('OIDC callback URL is invalid');
      }
      redirectUrl = parsedRedirectUrl;
      const callbackState = redirectUrl.searchParams.get('state');
      correlationCookieName = callbackState
        ? getOidcCorrelationCookieName(callbackState)
        : undefined;
      if (!correlationCookieName) {
        throw new Error('OIDC callback is missing a valid state parameter');
      }
    } catch (error) {
      logger.warn('Rejected invalid OIDC callback URL', {
        label: 'Auth',
        provider: provider.slug,
        ip: req.ip,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return next({
        status: 400,
        error: ApiErrorCode.OidcAuthorizationFailed,
      });
    }

    const correlation = parseOidcCorrelation(
      req.signedCookies[correlationCookieName]
    );
    if (!correlation) {
      logger.warn('Rejected OIDC callback without correlation cookie', {
        label: 'Auth',
        provider: provider.slug,
        ip: req.ip,
      });
      return next({
        status: 400,
        error: ApiErrorCode.OidcAuthorizationFailed,
      });
    }

    if (correlation.initiatingUserId !== (req.user?.id ?? null)) {
      logger.warn('Rejected OIDC callback under a different user context', {
        label: 'Auth',
        provider: provider.slug,
        ip: req.ip,
      });
      return next({
        status: 403,
        error: ApiErrorCode.Unauthorized,
      });
    }

    if (
      correlation.authorizationContext !== getOidcAuthorizationContext(provider)
    ) {
      logger.warn(
        'Rejected OIDC callback after provider configuration change',
        {
          label: 'Auth',
          provider: provider.slug,
          ip: req.ip,
        }
      );
      return next({
        status: 403,
        error: ApiErrorCode.Unauthorized,
      });
    }

    res.clearCookie(correlationCookieName, {
      path: OIDC_CORRELATION_COOKIE_PATH,
    });

    let config: openIdClient.Configuration;
    try {
      config = await openIdClient.discovery(
        new URL(provider.issuerUrl),
        provider.clientId,
        provider.clientSecret,
        undefined,
        {
          timeout: OIDC_HTTP_TIMEOUT_SECONDS,
          [openIdClient.customFetch]: oidcSafeFetch,
          execute:
            process.env.OIDC_ALLOW_INSECURE === 'true'
              ? [openIdClient.allowInsecureRequests]
              : [],
        }
      );
    } catch (error) {
      logger.error('Failed OIDC provider discovery', {
        label: 'Auth',
        provider: provider.name,
        ip: req.ip,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return next({
        status: 500,
        error: ApiErrorCode.OidcProviderDiscoveryFailed,
      });
    }

    try {
      const expectedUrl = new URL(correlation.redirectUri);
      if (
        redirectUrl.origin !== expectedUrl.origin ||
        redirectUrl.pathname !== expectedUrl.pathname
      ) {
        throw new Error('OIDC callback URL does not match the login request');
      }
    } catch (error) {
      logger.warn('Rejected invalid OIDC callback URL', {
        label: 'Auth',
        provider: provider.slug,
        ip: req.ip,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return next({
        status: 400,
        error: ApiErrorCode.OidcAuthorizationFailed,
      });
    }

    let tokens: openIdClient.TokenEndpointResponse &
      openIdClient.TokenEndpointResponseHelpers;
    try {
      tokens = await openIdClient.authorizationCodeGrant(config, redirectUrl, {
        pkceCodeVerifier: correlation.codeVerifier,
        expectedState: correlation.state,
        expectedNonce: correlation.nonce,
      });
    } catch (error) {
      logger.error('Failed OIDC authorization code grant', {
        label: 'Auth',
        provider: provider.name,
        ip: req.ip,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return next({
        status: 500,
        error: ApiErrorCode.OidcAuthorizationFailed,
      });
    }

    const claims = tokens.claims();
    if (claims == null) {
      logger.info('Failed OIDC login attempt', {
        cause:
          'Missing ID token in response. Provider does not support OpenID Connect.',
        ip: req.ip,
        provider: provider.name,
      });

      return next({
        status: 500,
        error: ApiErrorCode.OidcAuthorizationFailed,
      });
    }

    let fullUserInfo: openIdClient.IDToken & openIdClient.UserInfoResponse =
      claims;

    if (config.serverMetadata().userinfo_endpoint) {
      try {
        const userInfo = await openIdClient.fetchUserInfo(
          config,
          tokens.access_token,
          claims.sub
        );
        fullUserInfo = { ...claims, ...userInfo };
      } catch (error) {
        logger.error('Failed to fetch OIDC user info', {
          label: 'Auth',
          provider: provider.name,
          ip: req.ip,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return next({
          status: 500,
          error: ApiErrorCode.OidcAuthorizationFailed,
        });
      }
    }

    // Provider discovery, token exchange, and userinfo can all be slow. Admit
    // the resulting identity mutation only after external work, then hold OIDC
    // configuration authority through account linking/provisioning and session
    // establishment so a concurrent disable cannot leave a partially created
    // identity behind a rejected callback.
    return runWithConfigurationAdmission('oidc', async () => {
      const activeSettings = getSettings();
      const activeProvider = activeSettings.oidc.providers.find(
        (candidate) => candidate.slug === provider.slug
      );
      if (
        !activeSettings.main.oidcLogin ||
        !activeProvider ||
        !hasSameOidcProviderAuthority(activeProvider, provider)
      ) {
        return next({
          status: 403,
          error: ApiErrorCode.Unauthorized,
        });
      }

      // Validate that user meets required claims
      const hasRequiredClaims = oidcProviderClaimsAllowed(
        activeProvider,
        fullUserInfo
      );

      if (!hasRequiredClaims) {
        logger.info('Failed OIDC login attempt', {
          cause: 'Failed to validate required claims',
          ip: req.ip,
          requiredClaims: activeProvider.requiredClaims,
        });
        return next({
          status: 403,
          error: ApiErrorCode.Unauthorized,
        });
      }

      const parsedIdentity = parseOidcIdentity(
        fullUserInfo as Record<string, unknown>
      );
      if ('error' in parsedIdentity) {
        logger.warn('Rejected invalid OIDC identity claims', {
          label: 'Auth',
          provider: provider.slug,
          ip: req.ip,
        });
        return next({
          status: 502,
          error: ApiErrorCode.OidcAuthorizationFailed,
        });
      }
      const oidcIdentity = parsedIdentity.value;

      // Map identifier to linked account
      const userRepository = getRepository(User);
      const linkedAccountsRepository = getRepository(LinkedAccount);

      const oidcIdentityAdmissionResource = getAuthAccountAdmissionResource(
        'oidc',
        `${provider.slug}\0${oidcIdentity.sub}`
      );

      // If there is already a user logged in, handle account linking
      if (req.user != null) {
        const linkingUserId = req.user.id;
        try {
          return await runAuthAccountAdmission(
            [oidcIdentityAdmissionResource],
            () =>
              runUserSecurityMutation(linkingUserId, async () => {
                const currentSettings = getSettings();
                const currentProvider = currentSettings.oidc.providers.find(
                  (candidate) => candidate.slug === provider.slug
                );
                if (
                  !currentSettings.main.oidcLogin ||
                  !currentProvider ||
                  !hasSameOidcProviderAuthority(currentProvider, provider) ||
                  !oidcProviderClaimsAllowed(currentProvider, fullUserInfo)
                ) {
                  return next({
                    status: 403,
                    error: ApiErrorCode.Unauthorized,
                  });
                }

                const activeUser = await userRepository.findOneBy({
                  id: linkingUserId,
                });
                if (
                  !activeUser ||
                  (req.session?.userId === activeUser.id &&
                    !isUserSessionCredentialVersionCurrent(
                      activeUser,
                      req.session.credentialVersion
                    ))
                ) {
                  return next({
                    status: 403,
                    error: ApiErrorCode.Unauthorized,
                  });
                }

                const currentLinkedAccount =
                  await linkedAccountsRepository.findOne({
                    relations: { user: true },
                    where: {
                      provider: provider.slug,
                      sub: oidcIdentity.sub,
                    },
                  });
                if (
                  currentLinkedAccount != null &&
                  currentLinkedAccount.user.id !== activeUser.id
                ) {
                  logger.warn('Failed OIDC account linking attempt', {
                    cause: 'Account is already linked to a different user',
                    ip: req.ip,
                    provider: provider.slug,
                    currentUserId: activeUser.id,
                    linkedUserId: currentLinkedAccount.user.id,
                  });
                  return next({
                    status: 409,
                    error: ApiErrorCode.OidcAccountAlreadyLinked,
                  });
                }

                if (currentLinkedAccount == null) {
                  await linkedAccountsRepository.save(
                    new LinkedAccount({
                      user: activeUser,
                      provider: provider.slug,
                      sub: oidcIdentity.sub,
                      username: oidcIdentity.username ?? activeUser.displayName,
                    })
                  );
                }

                return res.sendStatus(204);
              })
          );
        } catch (error) {
          if (error instanceof UserMutationActorUnauthorizedError) {
            return next({
              status: 403,
              error: ApiErrorCode.Unauthorized,
            });
          }
          throw error;
        }
      }

      const oidcAdmissionResources = [oidcIdentityAdmissionResource];
      if (oidcIdentity.email != null) {
        oidcAdmissionResources.push(
          getAuthAccountAdmissionResource('email', oidcIdentity.email)
        );
      }

      const resolution = await runAuthAccountAdmission(
        oidcAdmissionResources,
        async () => {
          // Re-read the identity inside the admission boundary. This prevents
          // simultaneous first logins from creating competing users and prevents
          // a link removed during a slow provider call from authenticating from a
          // stale entity loaded before admission.
          const currentSettings = getSettings();
          const currentProvider = currentSettings.oidc.providers.find(
            (candidate) => candidate.slug === provider.slug
          );
          if (
            !currentSettings.main.oidcLogin ||
            !currentProvider ||
            !hasSameOidcProviderAuthority(currentProvider, provider)
          ) {
            return { kind: 'unauthorized' } as const;
          }

          if (!oidcProviderClaimsAllowed(currentProvider, fullUserInfo)) {
            return { kind: 'unauthorized' } as const;
          }

          const currentLinkedAccount = await linkedAccountsRepository.findOne({
            relations: { user: true },
            where: {
              provider: provider.slug,
              sub: oidcIdentity.sub,
            },
          });
          if (currentLinkedAccount) {
            return { kind: 'user', user: currentLinkedAccount.user } as const;
          }

          if (!currentProvider.newUserLogin) {
            return { kind: 'disabled' } as const;
          }
          if (oidcIdentity.email == null) {
            return { kind: 'missing-email' } as const;
          }

          const normalizedEmail = oidcIdentity.email;
          // Only auto-provision an account when the provider asserts the email is
          // verified. Without this an attacker whose IdP allows unverified emails
          // could self-provision an account under an arbitrary address.
          if (fullUserInfo.email_verified !== true) {
            logger.warn('Rejected OIDC sign-up with unverified email', {
              label: 'Auth',
              provider: provider.slug,
              ip: req.ip,
              email: normalizedEmail,
            });
            return { kind: 'unauthorized' } as const;
          }

          const existingUser = await userRepository.findOne({
            where: { email: normalizedEmail },
          });
          if (existingUser) {
            return { kind: 'unauthorized' } as const;
          }

          logger.info(`Creating user for ${normalizedEmail}`, {
            ip: req.ip,
            email: normalizedEmail,
          });

          const createdUser = new User({
            avatar:
              oidcIdentity.picture ??
              gravatarUrl(normalizedEmail, { default: 'mm', size: 200 }),
            username: oidcIdentity.username,
            email: normalizedEmail,
            permissions: currentSettings.main.defaultPermissions,
            plexToken: '',
            userType: UserType.LOCAL,
          });
          createdUser.linkedAccounts = [
            new LinkedAccount({
              user: createdUser,
              provider: provider.slug,
              sub: oidcIdentity.sub,
              username: oidcIdentity.username ?? normalizedEmail,
            }),
          ];
          await userRepository.save(createdUser);
          return { kind: 'user', user: createdUser } as const;
        }
      );

      if (resolution.kind !== 'user') {
        logger.debug('Failed OIDC sign-up attempt', {
          cause:
            resolution.kind === 'missing-email'
              ? 'User did not have an account, and was missing an associated email address.'
              : resolution.kind === 'disabled'
                ? 'User did not have an account, and new user login was disabled.'
                : 'OIDC provider authorization changed before account admission.',
        });
        return next({
          status: resolution.kind === 'missing-email' ? 400 : 403,
          error:
            resolution.kind === 'missing-email'
              ? ApiErrorCode.OidcMissingEmail
              : ApiErrorCode.Unauthorized,
        });
      }
      const user = resolution.user;

      const finalSettings = getSettings();
      const finalProvider = finalSettings.oidc.providers.find(
        (candidate) => candidate.slug === provider.slug
      );
      if (
        !finalSettings.main.oidcLogin ||
        !finalProvider ||
        !hasSameOidcProviderAuthority(finalProvider, provider) ||
        !oidcProviderClaimsAllowed(finalProvider, fullUserInfo)
      ) {
        return next({
          status: 403,
          error: ApiErrorCode.Unauthorized,
        });
      }

      // Set logged in session and return. Regenerate the session id first so a
      // fixated pre-login session cannot be promoted to an authenticated one,
      // matching the local/plex/jellyfin login handlers.
      await establishAuthenticatedSession(
        req,
        user.id,
        user.passwordChangedAt?.getTime() ?? 0
      );

      // Success!
      return res.sendStatus(204);
    });
  }
);

authRoutes.post('/logout', async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(200).json({ status: 'ok' });
    }

    const settings = getSettings();
    const isJellyfinOrEmby =
      settings.main.mediaServerType === MediaServerType.JELLYFIN ||
      settings.main.mediaServerType === MediaServerType.EMBY;

    let jellyfinDeviceCleanup:
      | {
          baseUrl: string;
          apiKey: string;
          serverType: MediaServerType;
          configurationAuthority: ConfigurationAuthoritySnapshot;
          userAuthority: MediaServerUserAuthoritySnapshot;
        }
      | undefined;
    if (isJellyfinOrEmby) {
      try {
        const userAuthority = await captureMediaServerUserAuthority(
          userId,
          'jellyfin'
        );
        if (userAuthority.jellyfinUserId && userAuthority.jellyfinDeviceId) {
          jellyfinDeviceCleanup = await runWithMediaServerUserAuthority(
            userAuthority,
            () =>
              runWithConfigurationAdmission('jellyfin', async () => {
                const currentSettings = getSettings();
                const currentServerType = currentSettings.main.mediaServerType;
                if (
                  currentServerType !== MediaServerType.JELLYFIN &&
                  currentServerType !== MediaServerType.EMBY
                ) {
                  return undefined;
                }
                return {
                  baseUrl: getHostname(currentSettings.jellyfin),
                  apiKey: currentSettings.jellyfin.apiKey,
                  serverType: currentServerType,
                  configurationAuthority: captureConfigurationAuthority(
                    'jellyfin',
                    currentSettings
                  ),
                  userAuthority,
                };
              })
          );
        }
      } catch (error) {
        logger.error('Failed to prepare Jellyfin device cleanup', {
          label: 'Auth',
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        });
      }
    }

    req.session?.destroy((err: Error | null) => {
      if (err) {
        logger.error('Failed to destroy session', {
          label: 'Auth',
          error: err.message,
          userId,
        });
        return next({ status: 500, message: 'Failed to destroy session.' });
      }

      if (jellyfinDeviceCleanup) {
        const cleanup = jellyfinDeviceCleanup;
        trackBackgroundTask('Jellyfin logout device cleanup', async () => {
          try {
            await runWithMediaServerUserAuthority(cleanup.userAuthority, () =>
              runWithConfigurationSnapshot(cleanup.configurationAuthority, () =>
                axios
                  .delete(`${cleanup.baseUrl}/Devices`, {
                    ...DEVICE_DELETE_REQUEST_OPTIONS,
                    params: {
                      Id: cleanup.userAuthority.jellyfinDeviceId,
                    },
                    headers: {
                      'X-Emby-Authorization': `MediaBrowser Client="Seerr", Device="Seerr", DeviceId="seerr", Version="${
                        cleanup.serverType === MediaServerType.EMBY
                          ? '1.0.0'
                          : getAppVersion()
                      }", Token="${cleanup.apiKey}"`,
                    },
                  })
                  .then(() => undefined)
              )
            );
          } catch (error) {
            logger.error('Failed to delete Jellyfin device', {
              label: 'Auth',
              error: error instanceof Error ? error.message : 'Unknown error',
              userId: cleanup.userAuthority.userId,
              jellyfinUserId: cleanup.userAuthority.jellyfinUserId,
            });
          }
        });
      }

      logger.debug('Successfully logged out user', {
        label: 'Auth',
        userId,
      });
      res.status(200).json({ status: 'ok' });
    });
  } catch (error) {
    logger.error('Error during logout process', {
      label: 'Auth',
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: req.session?.userId,
    });
    next({ status: 500, message: 'Error during logout process.' });
  }
});

authRoutes.post(
  '/reset-password',
  passwordResetRateLimit,
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const parsedBody = parseRequestBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const body = parsedBody.value;

    if (!body.email) {
      return next({
        status: 500,
        message: 'Email address required.',
      });
    }

    const email = parseLoginIdentifier(body.email);

    if ('error' in email) {
      return next({
        status: 500,
        message: email.error,
      });
    }

    const settings = getSettings();
    if (
      !settings.main.applicationUrl ||
      !settings.notifications.agents.email.enabled
    ) {
      return next({
        status: 503,
        message: 'Password reset email delivery is not configured.',
      });
    }

    const user = await userRepository
      .createQueryBuilder('user')
      .addSelect(['user.resetPasswordGuid', 'user.recoveryLinkExpirationDate'])
      .where('user.email = :email', { email: email.value.toLowerCase() })
      .getOne();

    // Do not wait for SMTP here. Awaiting a real delivery only for known users
    // makes response time an account-existence oracle. Both branches enqueue
    // an indistinguishable task and return after the same bounded lookup path.
    const delivery = user
      ? await user.preparePasswordResetDelivery()
      : await userRepository
          // Match the known-account write path without creating durable state.
          // This keeps the response boundary from becoming a database-write
          // timing oracle after delivery intent moved ahead of the response.
          .update({ id: -1 }, { resetPasswordDeliveryPending: false })
          .then(() => undefined);
    enqueuePasswordResetDelivery(
      user,
      {
        email: email.value,
        ip: req.ip,
      },
      delivery
    );

    return res.status(200).json({ status: 'ok' });
  }
);

authRoutes.post(
  '/reset-password/:guid',
  passwordResetRateLimit,
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const guid = parseResetGuid(req.params.guid);
    const parsedBody = parseRequestBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const password = parsePassword(parsedBody.value.password);

    if ('error' in password || !password.value || password.value.length < 8) {
      logger.warn('Failed password reset attempt using invalid new password', {
        label: 'API',
        ip: req.ip,
      });
      return next({
        status: 500,
        message: 'Password must be at least 8 characters long.',
      });
    }

    if ('error' in guid) {
      logger.warn('Failed password reset attempt using invalid recovery link', {
        label: 'API',
        ip: req.ip,
      });
      return next({
        status: 500,
        message: 'Invalid password reset link.',
      });
    }

    const user = await userRepository.findOne({
      where: { resetPasswordGuid: guid.value },
    });

    if (!user) {
      logger.warn('Failed password reset attempt using invalid recovery link', {
        label: 'API',
        ip: req.ip,
      });
      return next({
        status: 500,
        message: 'Invalid password reset link.',
      });
    }

    if (
      !user.recoveryLinkExpirationDate ||
      user.recoveryLinkExpirationDate <= new Date()
    ) {
      logger.warn('Failed password reset attempt using expired recovery link', {
        label: 'API',
        ip: req.ip,
        email: user.email,
      });
      return next({
        status: 500,
        message: 'Invalid password reset link.',
      });
    }
    await user.setPassword(password.value);

    // Claim and consume the recovery link in the same write that replaces the
    // password. A regular entity save leaves a window where concurrent reset
    // requests can both validate the same bearer token and whichever finishes
    // last controls the account.
    const resetResult = await userRepository.update(
      {
        id: user.id,
        resetPasswordGuid: guid.value,
        recoveryLinkExpirationDate: MoreThan(new Date()),
      },
      {
        password: user.password,
        passwordChangedAt: user.passwordChangedAt,
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        loginBlockedUntil: null,
        resetPasswordGuid: null,
        recoveryLinkExpirationDate: null,
        resetPasswordDeliveryPending: false,
      }
    );

    if (resetResult.affected !== 1) {
      logger.warn(
        'Failed password reset attempt using consumed recovery link',
        {
          label: 'API',
          ip: req.ip,
          email: user.email,
        }
      );
      return next({
        status: 500,
        message: 'Invalid password reset link.',
      });
    }

    logger.info('Successfully reset password', {
      label: 'API',
      ip: req.ip,
      email: user.email,
    });

    return res.status(200).json({ status: 'ok' });
  }
);

export default authRoutes;
