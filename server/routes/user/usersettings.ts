import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import type {
  CardTextVisibility,
  UserSettingsCardTextResponse,
  UserSettingsGeneralResponse,
  UserSettingsNotificationsResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import { MAX_PERMISSION_VALUE, Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { ApiError } from '@server/types/error';
import { getHostname } from '@server/utils/getHostname';
import {
  isOwnProfile,
  isOwnProfileOrAdmin,
} from '@server/utils/profileMiddleware';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { redactSecrets } from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalBoolean,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { Router } from 'express';
import net from 'net';
import { Not } from 'typeorm';
import { canMakePermissionsChange } from '.';

const userSettingsRoutes = Router({ mergeParams: true });
const MAX_USER_SETTINGS_ID_VALUE = 1_000_000_000;
const MAX_LINKED_ACCOUNT_TOKEN_LENGTH = 4096;
const MAX_LINKED_ACCOUNT_USERNAME_LENGTH = 512;
const MAX_LINKED_ACCOUNT_PASSWORD_LENGTH = 512;
const isCardTextVisibility = (value: unknown): value is CardTextVisibility =>
  value === 'always' || value === 'hover';

const parseUserSettingsRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, MAX_USER_SETTINGS_ID_VALUE);

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

    const parsed = parseOptionalBoundedString(bodyObject[fieldName], {
      fieldName,
      maxLength,
    });

    if ('error' in parsed) {
      return parsed;
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
    value[fieldName] = parseOptionalNonNegativeInteger(
      bodyObject[fieldName],
      USER_SETTINGS_LIMITS.quota
    );
  }

  value.watchlistSyncMovies = parseOptionalBoolean(
    bodyObject.watchlistSyncMovies
  );
  value.watchlistSyncTv = parseOptionalBoolean(bodyObject.watchlistSyncTv);
  value.watchlistSyncMusic = parseOptionalBoolean(
    bodyObject.watchlistSyncMusic
  );
  value.watchlistSyncBooks = parseOptionalBoolean(
    bodyObject.watchlistSyncBooks
  );

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
): Partial<UserSettingsNotificationsResponse['notificationTypes']> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
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

  return allowedKeys.reduce<
    Partial<UserSettingsNotificationsResponse['notificationTypes']>
  >((parsed, key) => {
    const rawValue = value[key as keyof typeof value];

    if (typeof rawValue === 'number' && Number.isInteger(rawValue)) {
      parsed[key] = Math.max(0, Math.min(rawValue, 8191));
    }

    return parsed;
  }, {});
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
    notificationTypes: parseNotificationTypes(bodyObject.notificationTypes),
  };

  for (const [fieldName, maxLength] of boundedFields) {
    const parsed = parseOptionalBoundedString(bodyObject[fieldName], {
      fieldName,
      maxLength,
    });

    if ('error' in parsed) {
      return parsed;
    }

    parsedBody[fieldName] = parsed.value;
  }

  parsedBody.telegramSendSilently = parseOptionalBoolean(
    bodyObject.telegramSendSilently
  );

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
    } catch (e) {
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

    const user = await userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return next({ status: 404, message: 'User not found.' });
    }

    // "Owner" user settings cannot be modified by other users
    if (user.id === 1 && req.user?.id !== 1) {
      return next({
        status: 403,
        message: "You do not have permission to modify this user's settings.",
      });
    }

    const oldEmail = user.email;
    user.username = body.username;
    if (user.userType !== UserType.PLEX) {
      user.email = body.email || user.jellyfinUsername || user.email;
    }

    const existingUser = await userRepository.findOne({
      where: { email: user.email, id: Not(user.id) },
    });

    if (oldEmail !== user.email && existingUser) {
      throw new ApiError(400, ApiErrorCode.InvalidEmail);
    }

    // Update quota values only if the user has the correct permissions
    if (
      !req.user?.hasPermission(Permission.MANAGE_USERS) &&
      req.user?.id !== user.id
    ) {
      user.movieQuotaDays = body.movieQuotaDays;
      user.movieQuotaLimit = body.movieQuotaLimit;
      user.tvQuotaDays = body.tvQuotaDays;
      user.tvQuotaLimit = body.tvQuotaLimit;
      user.musicQuotaDays = body.musicQuotaDays;
      user.musicQuotaLimit = body.musicQuotaLimit;
      user.bookQuotaDays = body.bookQuotaDays;
      user.bookQuotaLimit = body.bookQuotaLimit;
    }

    if (!user.settings) {
      user.settings = new UserSettings({
        user: req.user,
        discordId: body.discordId,
        locale: body.locale,
        discoverRegion: body.discoverRegion,
        streamingRegion: body.streamingRegion,
        originalLanguage: body.originalLanguage,
        watchlistSyncMovies: body.watchlistSyncMovies,
        watchlistSyncTv: body.watchlistSyncTv,
        watchlistSyncMusic: body.watchlistSyncMusic,
        watchlistSyncBooks: body.watchlistSyncBooks,
        cardTextVisibilityMovie: body.cardTextVisibility?.movie,
        cardTextVisibilityTv: body.cardTextVisibility?.tv,
        cardTextVisibilityAlbum: body.cardTextVisibility?.album,
        cardTextVisibilityBook: body.cardTextVisibility?.book,
      });
    } else {
      user.settings.discordId = body.discordId;
      user.settings.locale = body.locale;
      user.settings.discoverRegion = body.discoverRegion;
      user.settings.streamingRegion = body.streamingRegion;
      user.settings.originalLanguage = body.originalLanguage;
      user.settings.watchlistSyncMovies = body.watchlistSyncMovies;
      user.settings.watchlistSyncTv = body.watchlistSyncTv;
      user.settings.watchlistSyncMusic = body.watchlistSyncMusic;
      user.settings.watchlistSyncBooks = body.watchlistSyncBooks;
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
          body.cardTextVisibility.book ?? user.settings.cardTextVisibilityBook;
      }
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
  } catch (e) {
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

      const user = await userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json(serializeCardTextVisibility(user.settings));
    } catch (e) {
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

    const user = await userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return next({ status: 404, message: 'User not found.' });
    }

    if (user.id === 1 && req.user?.id !== 1) {
      return next({
        status: 403,
        message: "You do not have permission to modify this user's settings.",
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
  } catch (e) {
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

      const user = await userRepository.findOne({
        where: { id: userId },
        select: ['id', 'password'],
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json({ hasPassword: !!user.password });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<
  { id: string },
  null,
  { currentPassword?: string; newPassword: string }
>('/password', isOwnProfileOrAdmin(), async (req, res, next) => {
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

    if (
      (user.id === 1 && req.user?.id !== 1) ||
      (user.hasPermission(Permission.ADMIN) &&
        user.id !== req.user?.id &&
        req.user?.id !== 1)
    ) {
      return next({
        status: 403,
        message: "You do not have permission to modify this user's password.",
      });
    }

    // If the user has the permission to manage users and they are not
    // editing themselves, we will just set the new password
    if (
      req.user?.hasPermission(Permission.MANAGE_USERS) &&
      req.user?.id !== user.id
    ) {
      await user.setPassword(body.newPassword);
      await userRepository.save(user);
      logger.debug('Password overriden by user.', {
        label: 'User Settings',
        userEmail: user.email,
        changingUser: req.user.email,
      });
      return res.status(204).send();
    }

    // If the user has a password, we need to check the currentPassword is correct
    if (
      user.password &&
      (!body.currentPassword ||
        !(await userWithPassword.passwordMatch(body.currentPassword)))
    ) {
      logger.debug(
        'Attempt to change password for user failed. Invalid current password provided.',
        { label: 'User Settings', userEmail: user.email }
      );
      return next({ status: 403, message: 'Current password is invalid.' });
    }

    await user.setPassword(body.newPassword);
    await userRepository.save(user);

    return res.status(204).send();
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

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
      return res.status(500).json({ message: 'Plex login is disabled' });
    }

    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(parsedBody.value.authToken);
    const account = await plextv.getUser();

    // Do not allow linking of an already linked account
    if (await userRepository.exist({ where: { plexId: account.id } })) {
      return res.status(422).json({
        message: 'This Plex account is already linked to a Seerr user',
      });
    }

    const user = req.user;

    // Emails do not match
    if (user.email !== account.email) {
      return res.status(422).json({
        message:
          'This Plex account is registered under a different email address.',
      });
    }

    // valid plex user found, link to current user
    user.userType = UserType.PLEX;
    user.plexId = account.id;
    user.plexUsername = account.username;
    user.plexToken = account.authToken;
    await userRepository.save(user);

    return res.status(204).send();
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
      return res.status(500).json({ message: 'Plex login is disabled' });
    }

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return res.status(404).json({ message: 'User not found.' });
      }

      const user = await userRepository
        .createQueryBuilder('user')
        .addSelect('user.password')
        .where({
          id: userId,
        })
        .getOne();

      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      if (user.id === 1) {
        return res.status(400).json({
          message:
            'Cannot unlink media server accounts for the primary administrator.',
        });
      }

      if (!user.email || !user.password) {
        return res.status(400).json({
          message: 'User does not have a local email or password set.',
        });
      }

      user.userType = UserType.LOCAL;
      user.plexId = null;
      user.plexUsername = null;
      user.plexToken = null;
      await userRepository.save(user);

      return res.status(204).send();
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
  }
);

userSettingsRoutes.post<{ username: string; password: string }>(
  '/linked-accounts/jellyfin',
  isOwnProfile(),
  async (req, res) => {
    const settings = getSettings();
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
        .status(500)
        .json({ message: 'Jellyfin/Emby login is disabled' });
    }

    // Do not allow linking of an already linked account
    if (
      await userRepository.exist({
        where: { jellyfinUsername: body.username },
      })
    ) {
      return res.status(422).json({
        message: 'The specified account is already linked to a Seerr user',
      });
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

      // Do not allow linking of an already linked account
      if (
        await userRepository.exist({
          where: { jellyfinUserId: account.User.Id },
        })
      ) {
        return res.status(422).json({
          message: 'The specified account is already linked to a Seerr user',
        });
      }

      const user = req.user;

      // valid jellyfin user found, link to current user
      user.userType =
        settings.main.mediaServerType === MediaServerType.EMBY
          ? UserType.EMBY
          : UserType.JELLYFIN;
      user.jellyfinUserId = account.User.Id;
      user.jellyfinUsername = account.User.Name;
      user.jellyfinAuthToken = account.AccessToken;
      user.jellyfinDeviceId = deviceId;
      await userRepository.save(user);

      return res.status(204).send();
    } catch (e) {
      logger.error('Failed to link account to user.', {
        label: 'API',
        ip: req.ip,
        error: e,
      });
      if (
        e instanceof ApiError &&
        e.errorCode === ApiErrorCode.InvalidCredentials
      ) {
        return res.status(401).json({ code: e.errorCode });
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
        .status(500)
        .json({ message: 'Jellyfin/Emby login is disabled' });
    }

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return res.status(404).json({ message: 'User not found.' });
      }

      const user = await userRepository
        .createQueryBuilder('user')
        .addSelect('user.password')
        .where({
          id: userId,
        })
        .getOne();

      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      if (user.id === 1) {
        return res.status(400).json({
          message:
            'Cannot unlink media server accounts for the primary administrator.',
        });
      }

      if (!user.email || !user.password) {
        return res.status(400).json({
          message: 'User does not have a local email or password set.',
        });
      }

      user.userType = UserType.LOCAL;
      user.jellyfinUserId = null;
      user.jellyfinUsername = null;
      user.jellyfinAuthToken = null;
      user.jellyfinDeviceId = null;
      await userRepository.save(user);

      return res.status(204).send();
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
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
            settings?.discord.enabled && settings.discord.options.enableMentions
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
    } catch (e) {
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

      const user = await userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      // "Owner" user settings cannot be modified by other users
      if (user.id === 1 && req.user?.id !== 1) {
        return next({
          status: 403,
          message: "You do not have permission to modify this user's settings.",
        });
      }

      if (!user.settings) {
        user.settings = new UserSettings({
          user: req.user,
          pgpKey: body.pgpKey,
          discordId: body.discordId,
          pushbulletAccessToken: body.pushbulletAccessToken,
          pushoverApplicationToken: body.pushoverApplicationToken,
          pushoverUserKey: body.pushoverUserKey,
          telegramChatId: body.telegramChatId,
          telegramMessageThreadId: body.telegramMessageThreadId,
          telegramSendSilently: body.telegramSendSilently,
          notificationTypes: body.notificationTypes,
        });
      } else {
        user.settings.pgpKey = body.pgpKey;
        user.settings.discordId = body.discordId;
        user.settings.pushbulletAccessToken = body.pushbulletAccessToken;
        user.settings.pushoverApplicationToken = body.pushoverApplicationToken;
        user.settings.pushoverUserKey = body.pushoverUserKey;
        user.settings.pushoverSound = body.pushoverSound;
        user.settings.telegramChatId = body.telegramChatId;
        user.settings.telegramMessageThreadId = body.telegramMessageThreadId;
        user.settings.telegramSendSilently = body.telegramSendSilently;
        user.settings.notificationTypes = Object.assign(
          {},
          user.settings.notificationTypes,
          body.notificationTypes
        );
      }

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
    } catch (e) {
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

      const user = await userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json({ permissions: user.permissions });
    } catch (e) {
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

    if (parsedPermissions === undefined) {
      return next({ status: 400, message: 'permissions is invalid.' });
    }

    try {
      const userId = parseUserSettingsRouteId(req.params.id);
      if (!userId) {
        return next({ status: 404, message: 'User not found.' });
      }

      const user = await userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      // "Owner" user permissions cannot be modified, and users cannot set their own permissions
      if (user.id === 1 || req.user?.id === user.id) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }

      if (!canMakePermissionsChange(parsedPermissions, req.user)) {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }
      user.permissions = parsedPermissions;

      await userRepository.save(user);

      return res.status(200).json({ permissions: user.permissions });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default userSettingsRoutes;
