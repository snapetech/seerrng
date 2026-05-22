import GithubAPI from '@server/api/github';
import PushoverAPI from '@server/api/pushover';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { apiResponseCache } from '@server/middleware/apiResponseCache';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
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

router.use(checkUser);
router.use(apiResponseCache);

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

      if (commits.length) {
        const filteredCommits = commits.filter(
          (commit) => !commit.commit.message.includes('[skip ci]')
        );
        if (filteredCommits[0].sha !== commitTag) {
          updateAvailable = true;
        }

        const commitIndex = filteredCommits.findIndex(
          (commit) => commit.sha === commitTag
        );

        if (updateAvailable) {
          commitsBehind = commitIndex;
        }
      }
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
    const pushoverApi = new PushoverAPI();
    const token = parsePushoverToken(req.query.token);
    if ('error' in token) {
      return next({ status: 400, message: token.error });
    }

    try {
      const sounds = await pushoverApi.getSounds(token.value);
      res.status(200).json(sounds);
    } catch (e) {
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
router.use('/movie', isAuthenticated(), movieRoutes);
router.use('/tv', isAuthenticated(), tvRoutes);
router.use('/music', isAuthenticated(), musicRoutes);
router.use('/book', isAuthenticated(), bookRoutes);
router.use('/artist', isAuthenticated(), artistRoutes);
router.use('/association', isAuthenticated(), associationRoutes);
router.use('/author', isAuthenticated(), authorRoutes);
router.use('/media', isAuthenticated(), mediaRoutes);
router.use('/person', isAuthenticated(), personRoutes);
router.use('/collection', isAuthenticated(), collectionRoutes);
router.use('/service', isAuthenticated(), serviceRoutes);
router.use('/issue', isAuthenticated(), issueRoutes);
router.use('/issueComment', isAuthenticated(), issueCommentRoutes);
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

router.get('/backdrops', isAuthenticated(), async (req, res, next) => {
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
