import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  Permission,
  PermissionCheckOptions,
} from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  isUserSessionCredentialVersionCurrent,
  runWithUserApiKeyAuthorityContext,
  runWithUserCredentialVersionContext,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { getRateLimitKey } from '@server/utils/security';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';

const authenticatedRouteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
});

export const matchesApiKey = (
  provided: string,
  configured: string
): boolean => {
  const providedBytes = Buffer.from(provided);
  const configuredBytes = Buffer.from(configured);
  return (
    providedBytes.length === configuredBytes.length &&
    timingSafeEqual(providedBytes, configuredBytes)
  );
};

const checkUserImplementation: Middleware = async (req, res, next) => {
  const settings = getSettings();
  let user: User | undefined | null;

  const apiKey = req.header('X-API-Key');
  const apiKeyProvided = apiKey !== undefined;
  const isApiKeyCurrent = () =>
    apiKey !== undefined && matchesApiKey(apiKey, settings.main.apiKey);
  const apiKeyAuthenticated = isApiKeyCurrent();
  if (apiKeyAuthenticated) {
    const userRepository = getRepository(User);

    // API key access is a service-level credential. Keep it bound to the
    // owner account instead of allowing callers to impersonate arbitrary users.
    user = await userRepository.findOne({ where: { id: 1 } });
  } else if (!apiKeyProvided && req.session?.userId) {
    const userRepository = getRepository(User);

    user = await userRepository.findOne({
      where: { id: req.session.userId },
    });

    if (
      user &&
      !isUserSessionCredentialVersionCurrent(
        user,
        req.session.credentialVersion
      )
    ) {
      const staleUserId = user.id;
      user = null;
      req.session.destroy((error) => {
        if (error) {
          logger.error('Failed to destroy session with stale credentials', {
            label: 'Auth',
            error: error.message,
            userId: staleUserId,
          });
        }
      });
    }
  }

  if (user) {
    req.user = user;
  }

  req.locale = user?.settings?.locale
    ? user.settings.locale
    : settings.main.locale;

  if (user && apiKeyAuthenticated) {
    let credentialContextActive = true;
    const deactivateCredentialContext = () => {
      credentialContextActive = false;
    };
    res.once('finish', deactivateCredentialContext);
    res.once('close', deactivateCredentialContext);
    return runWithUserApiKeyAuthorityContext(
      user.id,
      isApiKeyCurrent,
      next,
      () => credentialContextActive
    );
  }

  if (user && req.session?.userId === user.id) {
    let credentialContextActive = true;
    const deactivateCredentialContext = () => {
      credentialContextActive = false;
    };
    res.once('finish', deactivateCredentialContext);
    res.once('close', deactivateCredentialContext);
    return runWithUserCredentialVersionContext(
      user.id,
      req.session.credentialVersion ?? 0,
      next,
      () => credentialContextActive
    );
  }

  next();
};

export const checkUser: Middleware = (req, res, next) => {
  authenticatedRouteRateLimit(req, res, () => {
    void Promise.resolve(checkUserImplementation(req, res, next)).catch(next);
  });
};

export const isAuthenticated = (
  permissions?: Permission | Permission[],
  options?: PermissionCheckOptions
): Middleware => {
  const authMiddleware: Middleware = (req, res, next) => {
    if (!req.user || !req.user.hasPermission(permissions ?? 0, options)) {
      res.status(403).json({
        status: 403,
        error: 'You do not have permission to access this endpoint',
      });
    } else {
      next();
    }
  };
  return (req, res, next) => {
    authenticatedRouteRateLimit(req, res, () => {
      authMiddleware(req, res, next);
    });
  };
};
