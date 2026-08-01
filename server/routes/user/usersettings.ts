import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { getRepository } from '@server/datasource';
import { LinkedAccount } from '@server/entity/LinkedAccount';
import { User } from '@server/entity/User';
import { ALL_NOTIFICATIONS, UserSettings } from '@server/entity/UserSettings';
import type {
  CardTextVisibility,
  UserSettingsCardTextResponse,
  UserSettingsGeneralResponse,
  UserSettingsLinkedAccount,
  UserSettingsLinkedAccountResponse,
  UserSettingsNotificationsResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import {
  getAuthAccountAdmissionResource,
  runAuthAccountAdmission,
} from '@server/lib/authAccountAdmission';
import { getJellyfinAuthAuthorityKey } from '@server/lib/mediaServerAuthority';
import {
  MAX_PERMISSION_VALUE,
  Permission,
  isValidPermissionValue,
} from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import { getSettings } from '@server/lib/settings';
import {
  UserMutationActorUnauthorizedError,
  isUserSessionCredentialVersionCurrent,
  runAuthorizedUserSecurityMutation,
  runUserSecurityMutationWithActor,
  runUserSecurityReadWithActor,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { ApiError } from '@server/types/error';
import { isAvailableLocale } from '@server/types/languages';
import AsyncLock from '@server/utils/asyncLock';
import { normalizeDiscordSnowflake } from '@server/utils/discord';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { parsePlexAccountIdentity } from '@server/utils/plexAccount';
import {
  isOwnProfile,
  isOwnProfileOrAdmin,
} from '@server/utils/profileMiddleware';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  getRateLimitKey,
  preserveRedactedSecrets,
  redactSecrets,
} from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import net from 'net';
import { IsNull, Not, Raw, type FindOptionsWhere } from 'typeorm';
import { canMakePermissionsChange, isUniqueConstraintError } from '.';

const userSettingsRoutes = Router({ mergeParams: true });
const MAX_USER_SETTINGS_ID_VALUE = 1_000_000_000;
const MAX_LINKED_ACCOUNT_TOKEN_LENGTH = 4096;
const MAX_LINKED_ACCOUNT_USERNAME_LENGTH = 512;
const MAX_LINKED_ACCOUNT_PASSWORD_LENGTH = 512;
const authenticationMutationLock = new AsyncLock();
const runAuthenticationMutation = <T>(
  req: Pick<Request, 'session' | 'user'>,
  userId: number,
  callback: (actor: User) => Promise<T>
): Promise<T> => {
  const actorId = req.user!.id;
  return runUserSecurityMutationWithActor(
    actorId,
    userId,
    Permission.MANAGE_USERS,
    (actor) =>
      requestAdmissionCoordinator.run([`auth:user:${userId}`], () =>
        authenticationMutationLock.dispatch(userId, () => callback(actor))
      ),
    {
      expectedCredentialVersion:
        req.session?.userId === actorId
          ? (req.session.credentialVersion ?? 0)
          : undefined,
    }
  );
};
export const PASSWORD_MUTATION_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
} as const;
export const getPasswordMutationRateLimitKey = (req: Request): string =>
  req.user?.id ? `user:${req.user.id}` : getRateLimitKey(req);
const passwordMutationRateLimit = rateLimit({
  ...PASSWORD_MUTATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: getPasswordMutationRateLimitKey,
});
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const isCardTextVisibility = (value: unknown): value is CardTextVisibility =>
  value === 'always' || value === 'hover';

const parseUserSettingsRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, MAX_USER_SETTINGS_ID_VALUE);

const canModifyUser = (target: User, actor?: User): boolean =>
  !target.hasPermission(Permission.ADMIN) ||
  actor?.id === target.id ||
  actor?.id === 1;

const canModifyUserAuthentication = (target: User, actor?: User): boolean =>
  canModifyUser(target, actor) &&
  !!actor &&
  (actor.id === target.id ||
    actor.hasPermission(Permission.ADMIN) ||
    canMakePermissionsChange(target.permissions, actor));

const isSessionCredentialCurrent = (req: Request, actor: User): boolean =>
  req.session?.userId !== actor.id ||
  isUserSessionCredentialVersionCurrent(actor, req.session.credentialVersion);

const parseUserSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'User settings body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

const serializeCardTextVisibility = (
  settings?: UserSettings
): UserSettingsCardTextResponse => ({
  movie:
    settings?.cardTextVisibilityMovie === 'always' ||
    settings?.cardTextVisibilityMovie === 'hover'
      ? settings.cardTextVisibilityMovie
      : undefined,
  tv:
    settings?.cardTextVisibilityTv === 'always' ||
    settings?.cardTextVisibilityTv === 'hover'
      ? settings.cardTextVisibilityTv
      : undefined,
  album:
    settings?.cardTextVisibilityAlbum === 'always' ||
    settings?.cardTextVisibilityAlbum === 'hover'
      ? settings.cardTextVisibilityAlbum
      : undefined,
  book:
    settings?.cardTextVisibilityBook === 'always' ||
    settings?.cardTextVisibilityBook === 'hover'
      ? settings.cardTextVisibilityBook
      : undefined,
});

const parseCardTextVisibilityBody = (
  body: unknown
): { value: UserSettingsCardTextResponse } | { error: string } => {
  const parsedBody = parseUserSettingsBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const bodyObject = parsedBody.value;
  const value: UserSettingsCardTextResponse = {};

  for (const key of ['movie', 'tv', 'album', 'book'] as const) {
    const fieldValue = bodyObject[key];

    if (fieldValue == null) {
      continue;
    }

    if (!isCardTextVisibility(fieldValue)) {
      return { error: `${key} must be "always" or "hover".` };
    }

    value[key] = fieldValue;
  }

  return { value };
};

type GeneralStringField =
  | 'username'
  | 'email'
  | 'discordId'
  | 'locale'
  | 'discoverRegion'
  | 'streamingRegion'
  | 'originalLanguage';

type NotificationStringField =
  | 'pgpKey'
  | 'discordId'
  | 'pushbulletAccessToken'
  | 'pushoverApplicationToken'
  | 'pushoverUserKey'
  | 'pushoverSound'
  | 'telegramChatId'
  | 'telegramMessageThreadId';

const parseOptionalDiscordId = (value: unknown) => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName: 'discordId',
    maxLength: USER_SETTINGS_LIMITS.discordId,
  });
  if ('error' in parsed || !parsed.value) {
    return parsed;
  }

  const normalized = normalizeDiscordSnowflake(parsed.value);
  return normalized
    ? { value: normalized }
    : { error: 'discordId must be a valid Discord user ID.' };
};

const parseGeneralSettingsBody = (
  body: unknown
):
  | {
      value: UserSettingsGeneralResponse;
    }
  | { error: string } => {
  const parsedBody = parseUserSettingsBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const bodyObject = parsedBody.value;
  const boundedFields: [GeneralStringField, number][] = [
    ['username', USER_SETTINGS_LIMITS.username],
    ['email', USER_SETTINGS_LIMITS.email],
    ['discordId', USER_SETTINGS_LIMITS.discordId],
    ['locale', USER_SETTINGS_LIMITS.locale],
    ['discoverRegion', USER_SETTINGS_LIMITS.region],
    ['streamingRegion', USER_SETTINGS_LIMITS.region],
    ['originalLanguage', USER_SETTINGS_LIMITS.language],
  ];
  const value: UserSettingsGeneralResponse = {};

  const username = parseBoundedString(bodyObject.username, {
    fieldName: 'username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });

  if ('error' in username) {
    return username;
  }

  value.username = username.value;

  for (const [fieldName, maxLength] of boundedFields) {
    if (fieldName === 'username') {
      continue;
    }

    if (!hasOwn(bodyObject, fieldName)) {
      continue;
    }

    const parsed =
      fieldName === 'discordId'
        ? parseOptionalDiscordId(bodyObject[fieldName])
        : parseOptionalBoundedString(bodyObject[fieldName], {
            fieldName,
            maxLength,
          });

    if ('error' in parsed) {
      return parsed;
    }

    if (
      fieldName === 'locale' &&
      parsed.value !== undefined &&
      !isAvailableLocale(parsed.value)
    ) {
      return { error: 'locale must be a supported locale.' };
    }

    value[fieldName] = parsed.value;
  }

  for (const fieldName of [
    'movieQuotaLimit',
    'movieQuotaDays',
    'tvQuotaLimit',
    'tvQuotaDays',
    'musicQuotaLimit',
    'musicQuotaDays',
    'bookQuotaLimit',
    'bookQuotaDays',
  ] as const) {
    const rawValue = bodyObject[fieldName];
    if (!hasOwn(bodyObject, fieldName)) {
      continue;
    }
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      value[fieldName] = undefined;
      continue;
    }

    const parsed = parseOptionalNonNegativeInteger(
      rawValue,
      USER_SETTINGS_LIMITS.quota
    );
    if (parsed === undefined) {
      return { error: `${fieldName} must be a valid non-negative integer.` };
    }
    value[fieldName] = parsed;
  }

  for (const fieldName of [
    'watchlistSyncMovies',
    'watchlistSyncTv',
    'watchlistSyncMusic',
    'watchlistSyncBooks',
  ] as const) {
    if (!hasOwn(bodyObject, fieldName)) {
      continue;
    }
    const parsed = parseOptionalBodyBoolean(bodyObject[fieldName], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    value[fieldName] = parsed.value;
  }

  if (bodyObject.cardTextVisibility) {
    const parsedCardTextVisibility = parseCardTextVisibilityBody(
      bodyObject.cardTextVisibility
    );

    if ('error' in parsedCardTextVisibility) {
      return parsedCardTextVisibility;
    }

    value.cardTextVisibility = parsedCardTextVisibility.value;
  }

  return { value };
};

const parseNotificationTypes = (
  value: unknown
):
  | {
      value: Partial<UserSettingsNotificationsResponse['notificationTypes']>;
    }
  | { error: string } => {
  if (value === undefined || value === null) {
    return { value: {} };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'notificationTypes must be an object.' };
  }

  const allowedKeys = [
    'email',
    'discord',
    'gotify',
    'ntfy',
    'pushbullet',
    'pushover',
    'slack',
    'telegram',
    'webhook',
    'webpush',
  ] as const;

  const parsed: Partial<
    UserSettingsNotificationsResponse['notificationTypes']
  > = {};
  for (const key of allowedKeys) {
    const rawValue = value[key as keyof typeof value];

    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    if (
      typeof rawValue !== 'number' ||
      !Number.isInteger(rawValue) ||
      rawValue < 0 ||
      (rawValue & ~ALL_NOTIFICATIONS) !== 0
    ) {
      return { error: `notificationTypes.${key} must be valid.` };
    }
    parsed[key] = rawValue;
  }

  return { value: parsed };
};

const parseNotificationsBody = (
  body: unknown
):
  | {
      value: UserSettingsNotificationsResponse;
    }
  | { error: string } => {
  const parsedBodyObject = parseUserSettingsBodyObject(body);

  if ('error' in parsedBodyObject) {
    return parsedBodyObject;
  }

  const bodyObject = parsedBodyObject.value;
  const notificationTypes = parseNotificationTypes(
    bodyObject.notificationTypes
  );
  if ('error' in notificationTypes) {
    return notificationTypes;
  }
  const boundedFields: [NotificationStringField, number][] = [
    ['pgpKey', USER_SETTINGS_LIMITS.pgpKey],
    ['discordId', USER_SETTINGS_LIMITS.discordId],
    ['pushbulletAccessToken', USER_SETTINGS_LIMITS.pushbulletAccessToken],
    ['pushoverApplicationToken', USER_SETTINGS_LIMITS.pushoverApplicationToken],
    ['pushoverUserKey', USER_SETTINGS_LIMITS.pushoverUserKey],
    ['pushoverSound', USER_SETTINGS_LIMITS.pushoverSound],
    ['telegramChatId', USER_SETTINGS_LIMITS.telegramChatId],
    ['telegramMessageThreadId', USER_SETTINGS_LIMITS.telegramMessageThreadId],
  ];
  const parsedBody: UserSettingsNotificationsResponse = {
    notificationTypes: notificationTypes.value,
  };

  for (const [fieldName, maxLength] of boundedFields) {
    if (!hasOwn(bodyObject, fieldName)) {
      continue;
    }

    const parsed =
      fieldName === 'discordId'
        ? parseOptionalDiscordId(bodyObject[fieldName])
        : parseOptionalBoundedString(bodyObject[fieldName], {
            fieldName,
            maxLength,
          });

    if ('error' in parsed) {
      return parsed;
    }

    parsedBody[fieldName] = parsed.value;
  }

  if (hasOwn(bodyObject, 'telegramSendSilently')) {
    const telegramSendSilently = parseOptionalBodyBoolean(
      bodyObject.telegramSendSilently,
      'telegramSendSilently'
    );
    if ('error' in telegramSendSilently) {
      return telegramSendSilently;
    }
    parsedBody.telegramSendSilently = telegramSendSilently.value;
  }

  return { value: parsedBody };
};

const parsePasswordBody = (
  body: unknown
):
  | { value: { currentPassword?: string; newPassword: string } }
  | { error: string } => {
  const parsedBody = parseUserSettingsBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const newPassword = parseBoundedString(parsedBody.value.newPassword, {
    fieldName: 'newPassword',
    maxLength: USER_SETTINGS_LIMITS.password,
  });

  if ('error' in newPassword) {
    return newPassword;
  }

  if (newPassword.value.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const currentPassword = parseOptionalBoundedString(
    parsedBody.value.currentPassword,
    {
      fieldName: 'currentPassword',
      maxLength: USER_SETTINGS_LIMITS.password,
    }
  );

  if ('error' in currentPassword) {
    return currentPassword;
  }

  return {
    value: {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    },
  };
};

const parsePlexLinkBody = (
  body: unknown
): { value: { authToken: string } } | { error: string } => {
  const parsedBody = parseUserSettingsBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const authToken = parseBoundedString(parsedBody.value.authToken, {
    fieldName: 'authToken',
    maxLength: MAX_LINKED_ACCOUNT_TOKEN_LENGTH,
  });

  if ('error' in authToken) {
    return authToken;
  }

  return { value: { authToken: authToken.value } };
};

const parseJellyfinLinkBody = (
  body: unknown
): { value: { username: string; password: string } } | { error: string } => {
  const parsedBody = parseUserSettingsBodyObject(body);

  if ('error' in parsedBody) {
    return parsedBody;
  }

  const username = parseBoundedString(parsedBody.value.username, {
    fieldName: 'username',
    maxLength: MAX_LINKED_ACCOUNT_USERNAME_LENGTH,
  });

  if ('error' in username) {
    return username;
  }

  const password = parseBoundedString(parsedBody.value.password, {
    fieldName: 'password',
    maxLength: MAX_LINKED_ACCOUNT_PASSWORD_LENGTH,
  });

  if ('error' in password) {
    return password;
  }

  return { value: { username: username.value, password: password.value } };
};

userSettingsRoutes.get<{ id: string }, UserSettingsGeneralResponse>(
  '/main',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const {
      main: { defaultQuotas },
    } = getSettings();
    const userRepository = getRepository(User);

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          return res.status(200).json({
            username: user.username,
            email: user.email,
            discordId: user.settings?.discordId,
            locale: user.settings?.locale,
            discoverRegion: user.settings?.discoverRegion,
            streamingRegion: user.settings?.streamingRegion,
            originalLanguage: user.settings?.originalLanguage,
            movieQuotaLimit: user.movieQuotaLimit,
            movieQuotaDays: user.movieQuotaDays,
            tvQuotaLimit: user.tvQuotaLimit,
            tvQuotaDays: user.tvQuotaDays,
            musicQuotaLimit: user.musicQuotaLimit,
            musicQuotaDays: user.musicQuotaDays,
            bookQuotaLimit: user.bookQuotaLimit,
            bookQuotaDays: user.bookQuotaDays,
            globalMovieQuotaDays: defaultQuotas.movie.quotaDays,
            globalMovieQuotaLimit: defaultQuotas.movie.quotaLimit,
            globalTvQuotaDays: defaultQuotas.tv.quotaDays,
            globalTvQuotaLimit: defaultQuotas.tv.quotaLimit,
            globalMusicQuotaDays: defaultQuotas.music.quotaDays,
            globalMusicQuotaLimit: defaultQuotas.music.quotaLimit,
            globalBookQuotaDays: defaultQuotas.book.quotaDays,
            globalBookQuotaLimit: defaultQuotas.book.quotaLimit,
            watchlistSyncMovies: user.settings?.watchlistSyncMovies,
            watchlistSyncTv: user.settings?.watchlistSyncTv,
            watchlistSyncMusic: user.settings?.watchlistSyncMusic,
            watchlistSyncBooks: user.settings?.watchlistSyncBooks,
            cardTextVisibility: serializeCardTextVisibility(user.settings),
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

userSettingsRoutes.post<
  { id: string },
  UserSettingsGeneralResponse,
  UserSettingsGeneralResponse
>('/main', isOwnProfileOrAdmin(), async (req, res, next) => {
  const userRepository = getRepository(User);
  const parsedBody = parseGeneralSettingsBody(req.body);

  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }

  const body = parsedBody.value;

  try {
    const userId = parseUserSettingsRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    const updateSettings = () =>
      runUserSecurityMutationWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async (actor) => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          if (!canModifyUser(user, actor)) {
            return next({
              status: 403,
              message:
                "You do not have permission to modify this user's settings.",
            });
          }

          const oldEmail = user.email;
          const nextEmail =
            user.userType !== UserType.PLEX && body.email
              ? body.email
              : user.email;

          if (
            nextEmail !== oldEmail &&
            !canModifyUserAuthentication(user, actor)
          ) {
            return next({
              status: 403,
              message:
                "You do not have permission to modify this user's email.",
            });
          }

          user.username = body.username;
          user.email = nextEmail;

          const existingUser = await userRepository.findOne({
            where: { email: user.email, id: Not(user.id) },
          });

          if (oldEmail !== user.email && existingUser) {
            throw new ApiError(400, ApiErrorCode.InvalidEmail);
          }

          // Update quota values only if the user has the correct permissions
          if (
            actor.hasPermission(Permission.MANAGE_USERS) &&
            actor.id !== user.id
          ) {
            for (const fieldName of [
              'movieQuotaDays',
              'movieQuotaLimit',
              'tvQuotaDays',
              'tvQuotaLimit',
              'musicQuotaDays',
              'musicQuotaLimit',
              'bookQuotaDays',
              'bookQuotaLimit',
            ] as const) {
              if (hasOwn(body, fieldName)) {
                Object.assign(user, { [fieldName]: body[fieldName] ?? null });
              }
            }
          }

          if (!user.settings) {
            user.settings = new UserSettings({ user });
          }

          for (const fieldName of [
            'discordId',
            'locale',
            'discoverRegion',
            'streamingRegion',
            'originalLanguage',
            'watchlistSyncMovies',
            'watchlistSyncTv',
            'watchlistSyncMusic',
            'watchlistSyncBooks',
          ] as const) {
            if (hasOwn(body, fieldName)) {
              Object.assign(user.settings, {
                [fieldName]:
                  fieldName === 'locale'
                    ? (body[fieldName] ?? '')
                    : (body[fieldName] ?? null),
              });
            }
          }

          if (body.cardTextVisibility) {
            user.settings.cardTextVisibilityMovie =
              body.cardTextVisibility.movie ??
              user.settings.cardTextVisibilityMovie;
            user.settings.cardTextVisibilityTv =
              body.cardTextVisibility.tv ?? user.settings.cardTextVisibilityTv;
            user.settings.cardTextVisibilityAlbum =
              body.cardTextVisibility.album ??
              user.settings.cardTextVisibilityAlbum;
            user.settings.cardTextVisibilityBook =
              body.cardTextVisibility.book ??
              user.settings.cardTextVisibilityBook;
          }

          const savedUser = await userRepository.save(user);

          return res.status(200).json({
            username: savedUser.username,
            discordId: savedUser.settings?.discordId,
            locale: savedUser.settings?.locale,
            discoverRegion: savedUser.settings?.discoverRegion,
            streamingRegion: savedUser.settings?.streamingRegion,
            originalLanguage: savedUser.settings?.originalLanguage,
            watchlistSyncMovies: savedUser.settings?.watchlistSyncMovies,
            watchlistSyncTv: savedUser.settings?.watchlistSyncTv,
            watchlistSyncMusic: savedUser.settings?.watchlistSyncMusic,
            watchlistSyncBooks: savedUser.settings?.watchlistSyncBooks,
            cardTextVisibility: serializeCardTextVisibility(savedUser.settings),
            email: savedUser.email,
          });
        }
      );

    return body.email
      ? await runAuthAccountAdmission(
          [getAuthAccountAdmissionResource('email', body.email.toLowerCase())],
          updateSettings
        )
      : await updateSettings();
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({
        status: 403,
        message: "You do not have permission to modify this user's settings.",
      });
    }
    if (e.errorCode) {
      return next({
        status: e.statusCode,
        message: e.errorCode,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

userSettingsRoutes.get<{ id: string }, UserSettingsCardTextResponse>(
  '/card-text',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          return res
            .status(200)
            .json(serializeCardTextVisibility(user.settings));
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

userSettingsRoutes.post<
  { id: string },
  UserSettingsCardTextResponse,
  UserSettingsCardTextResponse
>('/card-text', isOwnProfileOrAdmin(), async (req, res, next) => {
  const userRepository = getRepository(User);
  const parsedBody = parseCardTextVisibilityBody(req.body);

  if ('error' in parsedBody) {
    return next({ status: 400, message: parsedBody.error });
  }

  try {
    const userId = parseUserSettingsRouteId(req.params.id);
    if (!userId) {
      return next({ status: 404, message: 'User not found.' });
    }

    return await runUserSecurityMutationWithActor(
      req.user!.id,
      userId,
      Permission.MANAGE_USERS,
      async (actor) => {
        const user = await userRepository.findOne({
          where: { id: userId },
        });

        if (!user) {
          return next({ status: 404, message: 'User not found.' });
        }

        if (!canModifyUser(user, actor)) {
          return next({
            status: 403,
            message:
              "You do not have permission to modify this user's settings.",
          });
        }

        if (!user.settings) {
          user.settings = new UserSettings({ user });
        }

        const body = parsedBody.value;
        user.settings.cardTextVisibilityMovie =
          body.movie ?? user.settings.cardTextVisibilityMovie;
        user.settings.cardTextVisibilityTv =
          body.tv ?? user.settings.cardTextVisibilityTv;
        user.settings.cardTextVisibilityAlbum =
          body.album ?? user.settings.cardTextVisibilityAlbum;
        user.settings.cardTextVisibilityBook =
          body.book ?? user.settings.cardTextVisibilityBook;

        const savedUser = await userRepository.save(user);

        return res
          .status(200)
          .json(serializeCardTextVisibility(savedUser.settings));
      }
    );
  } catch (e) {
    if (e instanceof UserMutationActorUnauthorizedError) {
      return next({
        status: 403,
        message: "You do not have permission to modify this user's settings.",
      });
    }
    next({ status: 500, message: e.message });
  }
});

userSettingsRoutes.get<{ id: string }, { hasPassword: boolean }>(
  '/password',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOne({
            where: { id: userId },
            select: ['id', 'password'],
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          return res.status(200).json({ hasPassword: !!user.password });
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: "You do not have permission to modify this user's password.",
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<
  { id: string },
  null,
  { currentPassword?: string; newPassword: string }
>(
  '/password',
  passwordMutationRateLimit,
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const parsedBody = parsePasswordBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runAuthenticationMutation(req, userId, async (actor) => {
        const user = await userRepository.findOne({
          where: { id: userId },
        });

        const userWithPassword = await userRepository.findOne({
          select: ['id', 'password'],
          where: { id: userId },
        });

        if (!user || !userWithPassword) {
          return next({ status: 404, message: 'User not found.' });
        }

        if (!canModifyUserAuthentication(user, actor)) {
          return next({
            status: 403,
            message:
              "You do not have permission to modify this user's password.",
          });
        }

        // If the user has the permission to manage users and they are not
        // editing themselves, we will just set the new password
        if (
          actor.hasPermission(Permission.MANAGE_USERS) &&
          actor.id !== user.id
        ) {
          await user.setPassword(body.newPassword);
          const passwordUpdate = await userRepository.update(
            {
              id: user.id,
              permissions: Raw((alias) => `(${alias} & :adminPermission) = 0`, {
                adminPermission: Permission.ADMIN,
              }),
            },
            {
              password: user.password,
              passwordChangedAt: user.passwordChangedAt,
              failedLoginAttempts: 0,
              lastFailedLoginAt: null,
              loginBlockedUntil: null,
              resetPasswordGuid: null,
              recoveryLinkExpirationDate: null,
            }
          );
          if (passwordUpdate.affected !== 1) {
            return next({
              status: 403,
              message:
                "You do not have permission to modify this user's password.",
            });
          }
          logger.debug('Password overriden by user.', {
            label: 'User Settings',
            userEmail: user.email,
            changingUser: actor.email,
          });
          return res.status(204).send();
        }

        // If the user has a password, we need to check the currentPassword is correct
        if (
          userWithPassword.password &&
          (!body.currentPassword ||
            !(await userWithPassword.passwordMatch(body.currentPassword)))
        ) {
          logger.debug(
            'Attempt to change password for user failed. Invalid current password provided.',
            { label: 'User Settings', userEmail: user.email }
          );
          return next({
            status: 403,
            message: 'Current password is invalid.',
          });
        }

        await user.setPassword(body.newPassword);
        const passwordUpdate = await userRepository.update(
          {
            id: user.id,
            password: userWithPassword.password ?? IsNull(),
          },
          {
            password: user.password,
            passwordChangedAt: user.passwordChangedAt,
            failedLoginAttempts: 0,
            lastFailedLoginAt: null,
            loginBlockedUntil: null,
            resetPasswordGuid: null,
            recoveryLinkExpirationDate: null,
          }
        );

        if (passwordUpdate.affected !== 1) {
          return next({
            status: 409,
            message: 'Password changed during request. Try again.',
          });
        }

        return res.status(204).send();
      });
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<{ authToken: string }>(
  '/linked-accounts/plex',
  isOwnProfile(),
  async (req, res) => {
    const settings = getSettings();
    const userRepository = getRepository(User);
    const parsedBody = parsePlexLinkBody(req.body);

    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }

    if (!req.user) {
      return res.status(404).json({ code: ApiErrorCode.Unauthorized });
    }
    // Make sure Plex login is enabled
    if (settings.main.mediaServerType !== MediaServerType.PLEX) {
      return res.status(403).json({ message: 'Plex login is disabled' });
    }

    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(parsedBody.value.authToken);
    const rawAccount = await plextv.getUser();
    const parsedAccount = parsePlexAccountIdentity(
      rawAccount,
      parsedBody.value.authToken
    );
    if ('error' in parsedAccount) {
      return res.status(502).json({ message: parsedAccount.error });
    }
    const account = parsedAccount.value;
    try {
      return await runAuthAccountAdmission(
        [getAuthAccountAdmissionResource('plex', String(account.id))],
        () =>
          runAuthenticationMutation(req, req.user!.id, async (actor) => {
            if (!isSessionCredentialCurrent(req, actor)) {
              return res.status(403).json({ code: ApiErrorCode.Unauthorized });
            }
            if (getSettings().main.mediaServerType !== MediaServerType.PLEX) {
              return res
                .status(409)
                .json({ message: 'Media server configuration changed.' });
            }
            if (await userRepository.exist({ where: { plexId: account.id } })) {
              return res.status(422).json({
                message: 'This Plex account is already linked to a Seerr user',
              });
            }

            const user = await userRepository.findOneBy({ id: req.user!.id });
            if (!user) {
              return res.status(404).json({ code: ApiErrorCode.Unauthorized });
            }
            if (user.email !== account.email) {
              return res.status(422).json({
                message:
                  'This Plex account is registered under a different email address.',
              });
            }

            user.userType = UserType.PLEX;
            user.plexId = account.id;
            user.plexUsername = account.username;
            user.plexToken = account.authToken;
            await userRepository.save(user);

            return res.status(204).send();
          })
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).json({ code: ApiErrorCode.Unauthorized });
      }
      if (isUniqueConstraintError(error)) {
        return res.status(422).json({
          message: 'This Plex account is already linked to a Seerr user',
        });
      }
      throw error;
    }
  }
);

userSettingsRoutes.delete<{ id: string }>(
  '/linked-accounts/plex',
  isOwnProfileOrAdmin(),
  async (req, res) => {
    const settings = getSettings();
    const userRepository = getRepository(User);

    // Make sure Plex login is enabled
    if (settings.main.mediaServerType !== MediaServerType.PLEX) {
      return res.status(403).json({ message: 'Plex login is disabled' });
    }

    const userId = parseUserSettingsRouteId(req.params.id);
    if (!userId) {
      return res.status(404).json({ message: 'User not found.' });
    }

    try {
      return await runAuthenticationMutation(req, userId, async (actor) => {
        const user = await userRepository
          .createQueryBuilder('user')
          .addSelect('user.password')
          .leftJoinAndSelect('user.linkedAccounts', 'linkedAccounts')
          .where({ id: userId })
          .getOne();

        if (!user) {
          return res.status(404).json({ message: 'User not found.' });
        }

        if (!canModifyUserAuthentication(user, actor)) {
          return res.status(403).json({
            message:
              "You do not have permission to modify this user's account.",
          });
        }

        if (user.id === 1) {
          return res.status(400).json({
            message:
              'Cannot unlink media server accounts for the primary administrator.',
          });
        }

        if (!user.password && user.getActiveLinkedAccounts().length === 0) {
          return res.status(400).json({
            message:
              'User does not have a local password or other linked account.',
          });
        }

        user.userType = UserType.LOCAL;
        user.plexId = null;
        user.plexUsername = null;
        user.plexToken = null;
        await userRepository.save(user);

        return res.status(204).send();
      });
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).json({
          message: "You do not have permission to modify this user's account.",
        });
      }
      logger.error('Failed to unlink Plex account.', {
        label: 'User Settings',
        userId: req.params.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ message: 'Failed to unlink Plex account.' });
    }
  }
);

userSettingsRoutes.post<{ username: string; password: string }>(
  '/linked-accounts/jellyfin',
  isOwnProfile(),
  async (req, res) => {
    const settings = getSettings();
    const initialJellyfinAuthorityKey = getJellyfinAuthAuthorityKey(settings);
    const userRepository = getRepository(User);
    const parsedBody = parseJellyfinLinkBody(req.body);

    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }

    const body = parsedBody.value;

    if (!req.user) {
      return res.status(401).json({ code: ApiErrorCode.Unauthorized });
    }
    // Make sure jellyfin login is enabled
    if (
      settings.main.mediaServerType !== MediaServerType.JELLYFIN &&
      settings.main.mediaServerType !== MediaServerType.EMBY
    ) {
      return res
        .status(403)
        .json({ message: 'Jellyfin/Emby login is disabled' });
    }

    const hostname = getHostname();
    const deviceId = Buffer.from(
      req.user?.id === 1 ? 'BOT_seerr' : `BOT_seerr_${req.user.username ?? ''}`
    ).toString('base64');

    const jellyfinserver = new JellyfinAPI(hostname, undefined, deviceId);

    const ip = req.ip;
    let clientIp: string | undefined;
    if (ip) {
      if (net.isIPv4(ip)) {
        clientIp = ip;
      } else if (net.isIPv6(ip)) {
        clientIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
      }
    }

    try {
      const account = await jellyfinserver.login(
        body.username,
        body.password,
        clientIp
      );
      const jellyfinUserId = normalizeJellyfinGuid(account.User.Id);
      if (!jellyfinUserId) {
        return res.status(502).json({
          message: 'Media server returned an invalid user identity.',
        });
      }

      return await runAuthAccountAdmission(
        [getAuthAccountAdmissionResource('jellyfin', jellyfinUserId)],
        () =>
          runAuthenticationMutation(req, req.user!.id, async (actor) => {
            if (!isSessionCredentialCurrent(req, actor)) {
              return res.status(403).json({ code: ApiErrorCode.Unauthorized });
            }
            const activeSettings = getSettings();
            const activeMediaServerType = activeSettings.main.mediaServerType;
            if (
              getJellyfinAuthAuthorityKey(activeSettings) !==
                initialJellyfinAuthorityKey ||
              (activeMediaServerType !== MediaServerType.JELLYFIN &&
                activeMediaServerType !== MediaServerType.EMBY)
            ) {
              return res
                .status(409)
                .json({ message: 'Media server configuration changed.' });
            }
            if (
              await userRepository.exist({
                where: { jellyfinUserId },
              })
            ) {
              return res.status(422).json({
                message:
                  'The specified account is already linked to a Seerr user',
              });
            }

            const user = await userRepository.findOneBy({ id: req.user!.id });
            if (!user) {
              return res.status(404).json({ code: ApiErrorCode.Unauthorized });
            }
            if (getJellyfinAuthAuthorityKey() !== initialJellyfinAuthorityKey) {
              return res
                .status(409)
                .json({ message: 'Media server configuration changed.' });
            }
            user.userType =
              activeMediaServerType === MediaServerType.EMBY
                ? UserType.EMBY
                : UserType.JELLYFIN;
            user.jellyfinUserId = jellyfinUserId;
            user.jellyfinUsername = account.User.Name;
            user.jellyfinAuthToken = account.AccessToken;
            user.jellyfinDeviceId = deviceId;
            await userRepository.save(user);

            return res.status(204).send();
          })
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).json({ code: ApiErrorCode.Unauthorized });
      }
      logger.error('Failed to link account to user.', {
        label: 'API',
        ip: req.ip,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      if (
        e instanceof ApiError &&
        e.errorCode === ApiErrorCode.InvalidCredentials
      ) {
        return res.status(401).json({ code: e.errorCode });
      }
      if (isUniqueConstraintError(e)) {
        return res.status(422).json({
          message: 'The specified account is already linked to a Seerr user',
        });
      }

      return res.status(500).send();
    }
  }
);

userSettingsRoutes.delete<{ id: string }>(
  '/linked-accounts/jellyfin',
  isOwnProfileOrAdmin(),
  async (req, res) => {
    const settings = getSettings();
    const userRepository = getRepository(User);

    // Make sure jellyfin login is enabled
    if (
      settings.main.mediaServerType !== MediaServerType.JELLYFIN &&
      settings.main.mediaServerType !== MediaServerType.EMBY
    ) {
      return res
        .status(403)
        .json({ message: 'Jellyfin/Emby login is disabled' });
    }

    const userId = parseUserSettingsRouteId(req.params.id);
    if (!userId) {
      return res.status(404).json({ message: 'User not found.' });
    }

    try {
      return await runAuthenticationMutation(req, userId, async (actor) => {
        const user = await userRepository
          .createQueryBuilder('user')
          .addSelect('user.password')
          .leftJoinAndSelect('user.linkedAccounts', 'linkedAccounts')
          .where({ id: userId })
          .getOne();

        if (!user) {
          return res.status(404).json({ message: 'User not found.' });
        }

        if (!canModifyUserAuthentication(user, actor)) {
          return res.status(403).json({
            message:
              "You do not have permission to modify this user's account.",
          });
        }

        if (user.id === 1) {
          return res.status(400).json({
            message:
              'Cannot unlink media server accounts for the primary administrator.',
          });
        }

        if (!user.password && user.getActiveLinkedAccounts().length === 0) {
          return res.status(400).json({
            message:
              'User does not have a local password or other linked account.',
          });
        }

        user.userType = UserType.LOCAL;
        user.jellyfinUserId = null;
        user.jellyfinUsername = null;
        user.jellyfinAuthToken = null;
        user.jellyfinDeviceId = null;
        await userRepository.save(user);

        return res.status(204).send();
      });
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).json({
          message: "You do not have permission to modify this user's account.",
        });
      }
      logger.error('Failed to unlink Jellyfin/Emby account.', {
        label: 'User Settings',
        userId: req.params.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ message: 'Failed to unlink Jellyfin/Emby account.' });
    }
  }
);

userSettingsRoutes.get<{ id: string }, UserSettingsLinkedAccountResponse>(
  '/linked-accounts',
  isOwnProfileOrAdmin(),
  async (req, res) => {
    const settings = getSettings();
    const userRepository = getRepository(User);
    const userId = parseUserSettingsRouteId(req.params.id);
    if (!userId) {
      return res.status(404).send();
    }

    try {
      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.linkedAccounts', 'linkedAccounts')
            .where({ id: userId })
            .getOne();

          if (!user) {
            return res.status(404).send();
          }

          const linkedAccountInfo = user
            .getActiveLinkedAccounts()
            .slice(0, 100)
            .flatMap((acc) => {
              const provider = settings.oidc.providers.find(
                (configuredProvider) => configuredProvider.slug === acc.provider
              );
              if (!provider) return [];

              return [
                {
                  id: acc.id,
                  username: acc.username,
                  provider: {
                    slug: provider.slug,
                    name: provider.name,
                    logo: provider.logo,
                  },
                } satisfies UserSettingsLinkedAccount,
              ];
            });

          return res.status(200).json(linkedAccountInfo);
        }
      );
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).send();
      }
      throw error;
    }
  }
);

userSettingsRoutes.delete<{ id: string; acctId: string }>(
  '/linked-accounts/:acctId',
  isOwnProfileOrAdmin(),
  async (req, res) => {
    const settings = getSettings();
    const userRepository = getRepository(User);
    const linkedAccountsRepository = getRepository(LinkedAccount);
    const userId = parseUserSettingsRouteId(req.params.id);
    const acctId = parseUserSettingsRouteId(req.params.acctId);
    if (!userId || !acctId) {
      return res.status(404).send();
    }

    return runAuthenticationMutation(req, userId, async (actor) => {
      const user = await userRepository
        .createQueryBuilder('user')
        .addSelect('user.password')
        .leftJoinAndSelect('user.linkedAccounts', 'linkedAccounts')
        .where({ id: userId })
        .getOne();

      if (!user) {
        return res.status(404).send();
      }

      if (!canModifyUserAuthentication(user, actor)) {
        return res.status(403).send();
      }

      const remainingOidcCount = user
        .getActiveLinkedAccounts()
        .filter((account) => account.id !== acctId).length;
      const hasMediaServer =
        (settings.main.mediaServerType === MediaServerType.PLEX &&
          !!user.plexId) ||
        ([MediaServerType.JELLYFIN, MediaServerType.EMBY].includes(
          settings.main.mediaServerType
        ) &&
          !!user.jellyfinUserId);
      if (!user.password && remainingOidcCount === 0 && !hasMediaServer) {
        return res.status(400).json({
          message:
            'User does not have a local password or other linked account.',
        });
      }

      const condition: FindOptionsWhere<LinkedAccount> = {
        id: acctId,
        user: { id: userId },
      };

      if (await linkedAccountsRepository.exists({ where: condition })) {
        await linkedAccountsRepository.delete(condition);
        return res.status(204).send();
      }

      return res.status(404).send();
    }).catch((error) => {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).send();
      }
      throw error;
    });
  }
);

userSettingsRoutes.get<{ id: string }, UserSettingsNotificationsResponse>(
  '/notifications',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const settings = getSettings()?.notifications.agents;

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          return res.status(200).json(
            redactSecrets({
              emailEnabled: settings.email.enabled,
              pgpKey: user.settings?.pgpKey,
              discordEnabled:
                settings?.discord.enabled &&
                settings.discord.options.enableMentions,
              discordEnabledTypes:
                settings?.discord.enabled &&
                settings.discord.options.enableMentions
                  ? settings.discord.types
                  : 0,
              discordId: user.settings?.discordId,
              pushbulletAccessToken: user.settings?.pushbulletAccessToken,
              pushoverApplicationToken: user.settings?.pushoverApplicationToken,
              pushoverUserKey: user.settings?.pushoverUserKey,
              pushoverSound: user.settings?.pushoverSound,
              telegramEnabled: settings.telegram.enabled,
              telegramBotUsername: settings.telegram.options.botUsername,
              telegramChatId: user.settings?.telegramChatId,
              telegramMessageThreadId: user.settings?.telegramMessageThreadId,
              telegramSendSilently: user.settings?.telegramSendSilently,
              webPushEnabled: settings.webpush.enabled,
              notificationTypes: user.settings?.notificationTypes ?? {},
            })
          );
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

userSettingsRoutes.post<{ id: string }, UserSettingsNotificationsResponse>(
  '/notifications',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const parsedBody = parseNotificationsBody(req.body);

    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityMutationWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async (actor) => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          if (!canModifyUser(user, actor)) {
            return next({
              status: 403,
              message:
                "You do not have permission to modify this user's settings.",
            });
          }

          const preservedBody = preserveRedactedSecrets(body, user.settings);

          if (!user.settings) {
            user.settings = new UserSettings({ user, notificationTypes: {} });
          }

          for (const fieldName of [
            'pgpKey',
            'discordId',
            'pushbulletAccessToken',
            'pushoverApplicationToken',
            'pushoverUserKey',
            'pushoverSound',
            'telegramChatId',
            'telegramMessageThreadId',
            'telegramSendSilently',
          ] as const) {
            if (hasOwn(preservedBody, fieldName)) {
              Object.assign(user.settings, {
                [fieldName]: preservedBody[fieldName] ?? null,
              });
            }
          }
          user.settings.notificationTypes = Object.assign(
            {},
            user.settings.notificationTypes,
            preservedBody.notificationTypes
          );

          await userRepository.save(user);

          return res.status(200).json(
            redactSecrets({
              pgpKey: user.settings.pgpKey,
              discordId: user.settings.discordId,
              pushbulletAccessToken: user.settings.pushbulletAccessToken,
              pushoverApplicationToken: user.settings.pushoverApplicationToken,
              pushoverUserKey: user.settings.pushoverUserKey,
              pushoverSound: user.settings.pushoverSound,
              telegramChatId: user.settings.telegramChatId,
              telegramMessageThreadId: user.settings.telegramMessageThreadId,
              telegramSendSilently: user.settings.telegramSendSilently,
              notificationTypes: user.settings.notificationTypes,
            })
          );
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: "You do not have permission to modify this user's settings.",
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.get<{ id: string }, { permissions?: number }>(
  '/permissions',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      return await runUserSecurityReadWithActor(
        req.user!.id,
        userId,
        Permission.MANAGE_USERS,
        async () => {
          const user = await userRepository.findOne({
            where: { id: userId },
          });

          if (!user) {
            return next({ status: 404, message: 'User not found.' });
          }

          return res.status(200).json({ permissions: user.permissions });
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

userSettingsRoutes.post<
  { id: string },
  { permissions?: number },
  { permissions: number }
>(
  '/permissions',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const parsedBody = parseUserSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return next({ status: 400, message: parsedBody.error });
    }
    const body = parsedBody.value;
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
      const userId = parseUserSettingsRouteId(req.params.id);
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

          if (!user) return 'missing' as const;

          // Administrators are protected from delegated managers, and users
          // cannot change their own permission set through this endpoint.
          if (!canModifyUser(user, actor) || actor.id === user.id) {
            return 'forbidden' as const;
          }

          if (!canMakePermissionsChange(parsedPermissions, actor)) {
            return 'grant-forbidden' as const;
          }
          const criteria: FindOptionsWhere<User> = {
            id: user.id,
            ...(actor.id !== 1 && {
              permissions: Raw((alias) => `(${alias} & :adminPermission) = 0`, {
                adminPermission: Permission.ADMIN,
              }),
            }),
          };
          const result = await userRepository.update(criteria, {
            permissions: parsedPermissions,
          });
          return result.affected === 1
            ? ('updated' as const)
            : ('forbidden' as const);
        }
      );

      if (outcome === 'missing') {
        return next({ status: 404, message: 'User not found.' });
      }
      if (outcome === 'forbidden') {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }
      if (outcome === 'grant-forbidden') {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }

      return res.status(200).json({ permissions: parsedPermissions });
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }
      next({ status: 500, message: e.message });
    }
  }
);

export default userSettingsRoutes;
