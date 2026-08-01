import GithubAPI from '@server/api/github';
import PushoverAPI from '@server/api/pushover';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import dataSource, { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import { User } from '@server/entity/User';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  UserMutationActorUnauthorizedError,
  runUserSecurityReadWithActor,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { apiResponseCache } from '@server/middleware/apiResponseCache';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { authorizedRouteAccess } from '@server/middleware/authorizedMutation';
import deprecatedRoute from '@server/middleware/deprecation';
import { mapProductionCompany } from '@server/models/Movie';
import { mapNetwork } from '@server/models/Tv';
import { mapWatchProviderDetails } from '@server/models/common';
import overrideRuleRoutes from '@server/routes/overrideRule';
import settingsRoutes from '@server/routes/settings';
import watchlistRoutes from '@server/routes/watchlist';
import {
  appDataPath,
  appDataPermissions,
  appDataStatus,
} from '@server/utils/appDataVolume';
import { getAppVersion, getCommitTag } from '@server/utils/appVersion';
import restartFlag from '@server/utils/restartFlag';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { getRateLimitKey } from '@server/utils/security';
import { isPerson } from '@server/utils/typeHelpers';
import {
  parseBoundedString,
  parseOptionalBoundedString,
  parseOptionalLanguage,
} from '@server/utils/validation';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import artistRoutes from './artist';
import associationRoutes from './association';
import authRoutes from './auth';
import authorRoutes from './author';
import blocklistRoutes from './blocklist';
import bookRoutes from './book';
import collectionRoutes from './collection';
import discoverRoutes, { createTmdbWithRegionLanguage } from './discover';
import { imageCacheWarmRateLimit, warmImageCache } from './imageproxy';
import issueRoutes from './issue';
import issueCommentRoutes from './issueComment';
import mediaRoutes from './media';
import movieRoutes from './movie';
import musicRoutes from './music';
import personRoutes from './person';
import requestRoutes from './request';
import searchRoutes from './search';
import serviceRoutes from './service';
import tvRoutes from './tv';
import user from './user';

const router = Router();
const maxTmdbId = 1_000_000_000;
const MAX_PUSHOVER_TOKEN_LENGTH = 256;
const MAX_WATCH_REGION_LENGTH = 16;

const parseTmdbRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxTmdbId);

const publicStatusRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
export const PUBLIC_BACKDROPS_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
export const EXTERNAL_METADATA_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 60,
} as const;
const publicBackdropsRateLimit = rateLimit({
  ...PUBLIC_BACKDROPS_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: getRateLimitKey,
});
const externalMetadataRateLimit = rateLimit({
  ...EXTERNAL_METADATA_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  keyGenerator: (req) => `user:${req.user!.id}`,
});

const parsePushoverToken = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'Pushover application token',
    maxLength: MAX_PUSHOVER_TOKEN_LENGTH,
  });

const parseWatchRegion = (value: unknown) =>
  parseOptionalBoundedString(value, {
    fieldName: 'Watch region',
    maxLength: MAX_WATCH_REGION_LENGTH,
  });

export const getCommitUpdateStatus = (
  commits: { sha: string; commit: { message: string } }[],
  commitTag: string
): { updateAvailable: boolean; commitsBehind: number } => {
  const relevantCommits = commits.filter(
    (commit) => !commit.commit.message.includes('[skip ci]')
  );

  if (relevantCommits.length === 0 || relevantCommits[0].sha === commitTag) {
    return { updateAvailable: false, commitsBehind: 0 };
  }

  const commitIndex = relevantCommits.findIndex(
    (commit) => commit.sha === commitTag
  );

  return {
    updateAvailable: true,
    // If the current commit is older than the fetched window, the exact count
    // is unknown but it is at least the number of relevant commits returned.
    commitsBehind: commitIndex >= 0 ? commitIndex : relevantCommits.length,
  };
};

router.use(checkUser);
router.use(apiResponseCache);

router.get('/status/ready', publicStatusRateLimit, async (_req, res) => {
  try {
    await dataSource.query('SELECT 1');
    return res.status(204).send();
  } catch {
    return res.status(503).send();
  }
});

router.get<Record<string, never>, StatusResponse>(
  '/status',
  publicStatusRateLimit,
  async (req, res) => {
    const githubApi = new GithubAPI();

    const currentVersion = getAppVersion();
    const commitTag = getCommitTag();
    let updateAvailable = false;
    let commitsBehind = 0;

    const branchMatch = currentVersion.match(/^main-/);

    if (branchMatch && commitTag !== 'local') {
      const commits = await githubApi.getSeerrCommits({
        branch: branchMatch[1],
      });

      ({ updateAvailable, commitsBehind } = getCommitUpdateStatus(
        commits,
        commitTag
      ));
    } else if (commitTag !== 'local') {
      const releases = await githubApi.getSeerrReleases();

      if (releases.length) {
        const latestVersion = releases[0];

        if (!latestVersion.name.includes(currentVersion)) {
          updateAvailable = true;
        }
      }
    }

    return res.status(200).json({
      version: getAppVersion(),
      commitTag: getCommitTag(),
      updateAvailable,
      commitsBehind,
      restartRequired: restartFlag.isSet(),
    });
  }
);

router.get(
  '/status/appdata',
  isAuthenticated(Permission.ADMIN),
  authorizedRouteAccess(Permission.ADMIN),
  (_req, res) => {
    return res.status(200).json({
      appData: appDataStatus(),
      appDataPath: appDataPath(),
      appDataPermissions: appDataPermissions(),
    });
  }
);

router.use('/user', isAuthenticated(), user);
router.get('/settings/public', async (req, res) => {
  const settings = getSettings();

  if (!(req.user?.settings?.notificationTypes.webpush ?? true)) {
    return res
      .status(200)
      .json({ ...settings.fullPublicSettings, enablePushRegistration: false });
  } else {
    return res.status(200).json(settings.fullPublicSettings);
  }
});
router.get('/settings/discover', isAuthenticated(), async (_req, res) => {
  const sliderRepository = getRepository(DiscoverSlider);

  const sliders = await sliderRepository.find({ order: { order: 'ASC' } });

  return res.json(sliders);
});
router.get(
  '/settings/notifications/pushover/sounds',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const requestedUserId =
        req.query.userId === undefined
          ? undefined
          : parsePositiveRouteId(req.query.userId);
      if (req.query.userId !== undefined && !requestedUserId) {
        return next({ status: 400, message: 'Invalid user ID.' });
      }
      const actorId = req.user!.id;
      return await runUserSecurityReadWithActor(
        actorId,
        requestedUserId ?? actorId,
        Permission.ADMIN,
        async (actor) => {
          let rawToken: unknown;
          if (requestedUserId !== undefined) {
            const user = await getRepository(User).findOne({
              where: { id: requestedUserId },
            });
            if (!user) {
              return next({ status: 404, message: 'User not found.' });
            }
            rawToken = user.settings?.pushoverApplicationToken;
          } else {
            if (!actor.hasPermission(Permission.ADMIN)) {
              throw new UserMutationActorUnauthorizedError();
            }
            rawToken =
              getSettings().notifications.agents.pushover.options.accessToken;
          }

          const token = parsePushoverToken(rawToken);
          if ('error' in token) {
            return next({ status: 400, message: token.error });
          }

          const sounds = await new PushoverAPI().getSounds(token.value);
          return res.status(200).json(sounds);
        }
      );
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      logger.debug('Something went wrong retrieving Pushover sounds', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve Pushover sounds.',
      });
    }
  }
);
router.use('/settings', isAuthenticated(Permission.ADMIN), settingsRoutes);
router.use('/search', isAuthenticated(), searchRoutes);
router.use('/discover', isAuthenticated(), discoverRoutes);
router.use('/request', isAuthenticated(), requestRoutes);
router.use('/watchlist', isAuthenticated(), watchlistRoutes);
router.use('/blocklist', isAuthenticated(), blocklistRoutes);
router.use(
  '/blacklist',
  isAuthenticated(),
  deprecatedRoute({
    oldPath: '/api/v1/blacklist',
    newPath: '/api/v1/blocklist',
    sunsetDate: '2026-06-01',
  }),
  blocklistRoutes
);
router.use('/movie', isAuthenticated(), externalMetadataRateLimit, movieRoutes);
router.use('/tv', isAuthenticated(), externalMetadataRateLimit, tvRoutes);
router.use('/music', isAuthenticated(), externalMetadataRateLimit, musicRoutes);
router.use('/book', isAuthenticated(), bookRoutes);
router.use(
  '/artist',
  isAuthenticated(),
  externalMetadataRateLimit,
  artistRoutes
);
router.use('/association', isAuthenticated(), associationRoutes);
router.use('/author', isAuthenticated(), authorRoutes);
router.use('/media', isAuthenticated(), mediaRoutes);
router.use(
  '/person',
  isAuthenticated(),
  externalMetadataRateLimit,
  personRoutes
);
router.use(
  '/collection',
  isAuthenticated(),
  externalMetadataRateLimit,
  collectionRoutes
);
router.use('/service', isAuthenticated(), serviceRoutes);
router.use('/issue', isAuthenticated(), issueRoutes);
router.use('/issueComment', isAuthenticated(), issueCommentRoutes);
router.post(
  '/imageproxy/warm',
  isAuthenticated(),
  imageCacheWarmRateLimit,
  warmImageCache
);
router.use('/auth', authRoutes);
router.use(
  '/overrideRule',
  isAuthenticated(Permission.ADMIN),
  overrideRuleRoutes
);

router.get('/regions', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const regions = await tmdb.getRegions();

    return res.status(200).json(regions);
  } catch (e) {
    logger.debug('Something went wrong retrieving regions', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve regions.',
    });
  }
});

router.get('/languages', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const languages = await tmdb.getLanguages();

    return res.status(200).json(languages);
  } catch (e) {
    logger.debug('Something went wrong retrieving languages', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve languages.',
    });
  }
});

router.get<{ id: string }>(
  '/studio/:id',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdb = new TheMovieDb();
    const studioId = parseTmdbRouteId(req.params.id);
    if (!studioId) {
      return next({ status: 404, message: 'Studio not found.' });
    }

    try {
      const studio = await tmdb.getStudio(studioId);

      return res.status(200).json(mapProductionCompany(studio));
    } catch (e) {
      logger.debug('Something went wrong retrieving studio', {
        label: 'API',
        errorMessage: e.message,
        studioId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve studio.',
      });
    }
  }
);

router.get<{ id: string }>(
  '/network/:id',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdb = new TheMovieDb();
    const networkId = parseTmdbRouteId(req.params.id);
    if (!networkId) {
      return next({ status: 404, message: 'Network not found.' });
    }

    try {
      const network = await tmdb.getNetwork(networkId);

      return res.status(200).json(mapNetwork(network));
    } catch (e) {
      logger.debug('Something went wrong retrieving network', {
        label: 'API',
        errorMessage: e.message,
        networkId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve network.',
      });
    }
  }
);

router.get('/genres/movie', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const genres = await tmdb.getMovieGenres({
      language,
    });

    return res.status(200).json(genres);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie genres.',
    });
  }
});

router.get('/genres/tv', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const genres = await tmdb.getTvGenres({
      language,
    });

    return res.status(200).json(genres);
  } catch (e) {
    logger.debug('Something went wrong retrieving series genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series genres.',
    });
  }
});

router.get('/backdrops', publicBackdropsRateLimit, async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage();

  try {
    const data = (
      await tmdb.getAllTrending({
        page: 1,
        timeWindow: 'week',
      })
    ).results.filter((result) => !isPerson(result)) as (
      | TmdbMovieResult
      | TmdbTvResult
    )[];

    return res.status(200).json(
      data
        .map((result) => result.backdrop_path)
        .filter((backdropPath) => !!backdropPath)
        .slice(0, 8)
    );
  } catch (e) {
    logger.debug('Something went wrong retrieving backdrops', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve backdrops.',
    });
  }
});

router.get('/keyword/:keywordId', isAuthenticated(), async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage();
  const keywordId = parsePositiveRouteId(req.params.keywordId);
  if (!keywordId) {
    return next({ status: 404, message: 'Keyword not found.' });
  }

  try {
    const result = await tmdb.getKeywordDetails({
      keywordId,
    });

    return res.status(200).json(result);
  } catch (e) {
    logger.debug('Something went wrong retrieving keyword data', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve keyword data.',
    });
  }
});

router.get(
  '/watchproviders/regions',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage();

    try {
      const result = await tmdb.getAvailableWatchProviderRegions({});
      return res.status(200).json(result);
    } catch (e) {
      logger.debug('Something went wrong retrieving watch provider regions', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve watch provider regions.',
      });
    }
  }
);

router.get(
  '/watchproviders/movies',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage();
    const watchRegion = parseWatchRegion(req.query.watchRegion);
    if ('error' in watchRegion) {
      return next({ status: 400, message: watchRegion.error });
    }

    try {
      const result = await tmdb.getMovieWatchProviders({
        watchRegion: watchRegion.value ?? '',
      });

      return res.status(200).json(mapWatchProviderDetails(result));
    } catch (e) {
      logger.debug('Something went wrong retrieving movie watch providers', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie watch providers.',
      });
    }
  }
);

router.get('/watchproviders/tv', isAuthenticated(), async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage();
  const watchRegion = parseWatchRegion(req.query.watchRegion);
  if ('error' in watchRegion) {
    return next({ status: 400, message: watchRegion.error });
  }

  try {
    const result = await tmdb.getTvWatchProviders({
      watchRegion: watchRegion.value ?? '',
    });

    return res.status(200).json(mapWatchProviderDetails(result));
  } catch (e) {
    logger.debug('Something went wrong retrieving tv watch providers', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve tv watch providers.',
    });
  }
});

router.get(
  '/certifications/movie',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const certifications = await tmdb.getMovieCertifications();

      return res.status(200).json(certifications);
    } catch (e) {
      logger.error('Something went wrong retrieving movie certifications', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie certifications.',
      });
    }
  }
);

router.get('/certifications/tv', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const certifications = await tmdb.getTvCertifications();

    return res.status(200).json(certifications);
  } catch (e) {
    logger.debug('Something went wrong retrieving TV certifications', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve TV certifications.',
    });
  }
});

router.get('/', (_req, res) => {
  return res.status(200).json({
    api: 'Seerr API',
    version: '1.0',
  });
});

export default router;
