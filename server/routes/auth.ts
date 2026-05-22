import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType, ServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { startJobs } from '@server/job/schedule';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { checkAvatarChanged } from '@server/routes/avatarproxy';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';
import { getHostname } from '@server/utils/getHostname';
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
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import net from 'net';
import validator from 'validator';

const authRoutes = Router();
const MAX_AUTH_TOKEN_LENGTH = 4096;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_URL_BASE_LENGTH = 512;
const MAX_RESET_GUID_LENGTH = 64;
const MAX_PORT = 65_535;
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
  req: Request,
  userId: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      req.session.userId = userId;
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
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

authRoutes.get('/me', isAuthenticated(), async (req, res) => {
  const userRepository = getRepository(User);
  if (!req.user) {
    return res.status(500).json({
      status: 500,
      error: 'Please sign in.',
    });
  }
  const user = await userRepository.findOneOrFail({
    where: { id: req.user.id },
  });

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

authRoutes.post('/plex', authRateLimit, async (req, res, next) => {
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
    return res.status(500).json({ error: 'Plex login is disabled' });
  }
  try {
    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(authToken.value);
    const account = await plextv.getUser();

    // Next let's see if the user already exists
    let user = await userRepository
      .createQueryBuilder('user')
      .where('user.plexId = :id', { id: account.id })
      .orWhere('user.email = :email', {
        email: account.email.toLowerCase(),
      })
      .getOne();

    if (!user && !(await userRepository.count())) {
      user = new User({
        email: account.email,
        plexUsername: account.username,
        plexId: account.id,
        plexToken: account.authToken,
        permissions: Permission.ADMIN,
        avatar: account.thumb,
        userType: UserType.PLEX,
      });

      settings.main.mediaServerType = MediaServerType.PLEX;
      await settings.save();
      startJobs();

      await userRepository.save(user);
    } else {
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true, plexId: true, email: true },
        where: { id: 1 },
      });
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      if (!account.id) {
        logger.error('Plex ID was missing from Plex.tv response', {
          label: 'API',
          ip: req.ip,
          email: account.email,
          plexUsername: account.username,
        });

        return next({
          status: 500,
          message: 'Something went wrong. Try again.',
        });
      }

      if (
        account.id === mainUser.plexId ||
        (account.email === mainUser.email && !mainUser.plexId) ||
        (await mainPlexTv.checkUserAccess(account.id))
      ) {
        if (user) {
          if (!user.plexId) {
            logger.info(
              'Found matching Plex user; updating user with Plex data',
              {
                label: 'API',
                ip: req.ip,
                email: user.email,
                userId: user.id,
                plexId: account.id,
                plexUsername: account.username,
              }
            );
          }

          user.plexToken = authToken.value;
          user.plexId = account.id;
          user.avatar = account.thumb;
          user.email = account.email;
          user.plexUsername = account.username;
          user.userType = UserType.PLEX;

          await userRepository.save(user);
        } else if (!settings.main.newPlexLogin) {
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
          return next({
            status: 403,
            message: 'Access denied.',
          });
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
          user = new User({
            email: account.email,
            plexUsername: account.username,
            plexId: account.id,
            plexToken: account.authToken,
            permissions: settings.main.defaultPermissions,
            avatar: account.thumb,
            userType: UserType.PLEX,
          });

          await userRepository.save(user);
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
        return next({
          status: 403,
          message: 'Access denied.',
        });
      }
    }

    await establishAuthenticatedSession(req, user.id);

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
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
    return res.status(500).json({ error: 'Jellyfin login is disabled' });
  }

  if (settings.jellyfin.ip !== '' && body.hostname) {
    return res
      .status(500)
      .json({ error: 'Jellyfin hostname already configured' });
  } else if (settings.jellyfin.ip === '' && !body.hostname) {
    return res.status(500).json({ error: 'No hostname provided.' });
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

  try {
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
    const jellyfinserver = new JellyfinAPI(hostname ?? '', undefined, deviceId);

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

    // Next let's see if the user already exists
    user = await userRepository.findOne({
      where: { jellyfinUserId: account.User.Id },
    });

    const missingAdminUser = !user && !(await userRepository.count());
    if (
      missingAdminUser ||
      settings.main.mediaServerType === MediaServerType.NOT_CONFIGURED
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
      settings.main.mediaServerType = body.serverType;

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
          jellyfinUserId: account.User.Id,
          jellyfinDeviceId: deviceId,
          jellyfinAuthToken: account.AccessToken,
          permissions: Permission.ADMIN,
          userType:
            body.serverType === MediaServerType.JELLYFIN
              ? UserType.JELLYFIN
              : UserType.EMBY,
        });
        user.avatar = getUserAvatarUrl(user);

        await userRepository.save(user);
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
        user.jellyfinUserId = account.User.Id;
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
        deviceId
      );
      const apiKey = await jellyfinClient.createApiToken('Seerr');

      const serverName = await jellyfinserver.getServerName();

      settings.jellyfin.name = serverName;
      settings.jellyfin.serverId = account.User.ServerId;
      settings.jellyfin.ip = body.hostname ?? '';
      settings.jellyfin.port = body.port ?? 8096;
      settings.jellyfin.urlBase = body.urlBase ?? '';
      settings.jellyfin.useSsl = body.useSsl ?? false;
      settings.jellyfin.apiKey = apiKey;
      await settings.save();
      startJobs();
    }
    // User already exists, let's update their information
    else if (account.User.Id === user?.jellyfinUserId) {
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

      await userRepository.save(user);
    } else if (!settings.main.newPlexLogin) {
      logger.warn(
        'Failed sign-in attempt by unimported Jellyfin user with access to the media server',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUserId: account.User.Id,
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
        email: body.email,
        jellyfinUsername: account.User.Name,
        jellyfinUserId: account.User.Id,
        jellyfinDeviceId: deviceId,
        permissions: settings.main.defaultPermissions,
        userType:
          settings.main.mediaServerType === MediaServerType.JELLYFIN
            ? UserType.JELLYFIN
            : UserType.EMBY,
      });
      user.avatar = getUserAvatarUrl(user);

      //initialize Jellyfin/Emby users with local login
      const passedExplicitPassword = body.password && body.password.length > 0;
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
          await userRepository.save(user);
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

    await establishAuthenticatedSession(req, user.id);

    return res.status(200).json(user?.filter() ?? {});
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
  }
});

authRoutes.post('/local', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const parsedBody = parseRequestBodyObject(req.body);
  if ('error' in parsedBody) {
    return res.status(400).json({ error: parsedBody.error });
  }
  const body = parsedBody.value;
  const email = parseLoginIdentifier(body.email);
  const password = parsePassword(body.password);

  if (!settings.main.localLogin) {
    return res.status(500).json({ error: 'Password sign-in is disabled.' });
  } else if ('error' in email || 'error' in password) {
    return res.status(500).json({
      error: 'You must provide both an email address and a password.',
    });
  }
  try {
    const user = await userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.email', 'user.password', 'user.plexId'])
      .where('user.email = :email', { email: email.value.toLowerCase() })
      .getOne();

    if (!user || !(await user.passwordMatch(password.value ?? ''))) {
      logger.warn('Failed sign-in attempt using invalid Seerr password', {
        label: 'API',
        ip: req.ip,
        email: email.value,
        userId: user?.id,
      });
      return next({
        status: 403,
        message: 'Access denied.',
      });
    }

    await establishAuthenticatedSession(req, user.id);

    return res.status(200).json(user?.filter() ?? {});
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

    if (isJellyfinOrEmby) {
      const user = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect(['user.jellyfinUserId', 'user.jellyfinDeviceId'])
        .where('user.id = :id', { id: userId })
        .getOne();

      if (user?.jellyfinUserId && user.jellyfinDeviceId) {
        try {
          const baseUrl = getHostname();
          try {
            await axios.delete(`${baseUrl}/Devices`, {
              ...DEVICE_DELETE_REQUEST_OPTIONS,
              params: { Id: user.jellyfinDeviceId },
              headers: {
                'X-Emby-Authorization': `MediaBrowser Client="Seerr", Device="Seerr", DeviceId="seerr", Version="${
                  settings.main.mediaServerType === MediaServerType.EMBY
                    ? '1.0.0'
                    : getAppVersion()
                }", Token="${settings.jellyfin.apiKey}"`,
              },
            });
          } catch (error) {
            logger.error('Failed to delete Jellyfin device', {
              label: 'Auth',
              error: error instanceof Error ? error.message : 'Unknown error',
              userId: user.id,
              jellyfinUserId: user.jellyfinUserId,
            });
          }
        } catch (error) {
          logger.error('Failed to delete Jellyfin device', {
            label: 'Auth',
            error: error instanceof Error ? error.message : 'Unknown error',
            userId: user.id,
            jellyfinUserId: user.jellyfinUserId,
          });
        }
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

    const user = await userRepository
      .createQueryBuilder('user')
      .where('user.email = :email', { email: email.value.toLowerCase() })
      .getOne();

    if (user) {
      await user.resetPassword();
      await userRepository.save(user);
      logger.info('Successfully sent password reset link', {
        label: 'API',
        ip: req.ip,
        email: email.value,
      });
    } else {
      logger.error('Something went wrong sending password reset link', {
        label: 'API',
        ip: req.ip,
        email: email.value,
      });
    }

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
        guid: 'error' in guid ? undefined : guid.value,
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
        guid: guid.value,
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
        guid: guid.value,
        email: user.email,
      });
      return next({
        status: 500,
        message: 'Invalid password reset link.',
      });
    }
    user.recoveryLinkExpirationDate = null;
    await user.setPassword(password.value);
    await userRepository.save(user);
    logger.info('Successfully reset password', {
      label: 'API',
      ip: req.ip,
      guid,
      email: user.email,
    });

    return res.status(200).json({ status: 'ok' });
  }
);

export default authRoutes;
