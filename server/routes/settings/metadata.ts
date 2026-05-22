import TheMovieDb from '@server/api/themoviedb';
import Tvdb from '@server/api/tvdb';
import {
  getSettings,
  MetadataProviderType,
  type MetadataSettings,
} from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

function getTestResultString(testValue: number): string {
  if (testValue === -1) return 'not tested';
  if (testValue === 0) return 'failed';
  return 'ok';
}

const metadataRoutes = Router();

const isMetadataProviderType = (
  value: unknown
): value is MetadataProviderType =>
  value === MetadataProviderType.TMDB || value === MetadataProviderType.TVDB;

const parseMetadataSettings = (
  value: unknown
): { value: MetadataSettings } | { error: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Invalid metadata settings.' };
  }

  const body = value as Partial<MetadataSettings>;

  if (!isMetadataProviderType(body.tv) || !isMetadataProviderType(body.anime)) {
    return { error: 'Invalid metadata provider.' };
  }

  return { value: { tv: body.tv, anime: body.anime } };
};

const parseMetadataTestBody = (
  value: unknown
): { value: { tmdb?: boolean; tvdb?: boolean } } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: {} };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Invalid metadata test settings.' };
  }

  const body = value as { tmdb?: unknown; tvdb?: unknown };

  if (
    (body.tmdb !== undefined && typeof body.tmdb !== 'boolean') ||
    (body.tvdb !== undefined && typeof body.tvdb !== 'boolean')
  ) {
    return { error: 'Metadata test flags must be booleans.' };
  }

  return { value: { tmdb: body.tmdb, tvdb: body.tvdb } };
};

metadataRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  res.status(200).json({
    tv: settings.metadataSettings.tv,
    anime: settings.metadataSettings.anime,
  });
});

metadataRoutes.put('/', async (req, res) => {
  const settings = getSettings();
  const parsedBody = parseMetadataSettings(req.body);

  if ('error' in parsedBody) {
    return res.status(400).json({ success: false, error: parsedBody.error });
  }

  const body = parsedBody.value;

  let tvdbTest = -1;
  let tmdbTest = -1;

  try {
    if (
      body.tv === MetadataProviderType.TVDB ||
      body.anime === MetadataProviderType.TVDB
    ) {
      tvdbTest = 0;
      const tvdb = await Tvdb.getInstance();
      await tvdb.test();
      tvdbTest = 1;
    }
  } catch (e) {
    logger.error('Failed to test metadata provider', {
      label: 'Metadata',
      message: e.message,
    });
  }

  try {
    if (
      body.tv === MetadataProviderType.TMDB ||
      body.anime === MetadataProviderType.TMDB
    ) {
      tmdbTest = 0;
      const tmdb = new TheMovieDb();
      await tmdb.getTvShow({ tvId: 1054 });
      tmdbTest = 1;
    }
  } catch (e) {
    logger.error('Failed to test metadata provider', {
      label: 'MetadataProvider',
      message: e.message,
    });
  }

  // If a test failed, return the test results
  if (tvdbTest === 0 || tmdbTest === 0) {
    return res.status(500).json({
      success: false,
      tests: {
        tvdb: getTestResultString(tvdbTest),
        tmdb: getTestResultString(tmdbTest),
      },
    });
  }

  settings.metadataSettings = {
    tv: body.tv,
    anime: body.anime,
  };
  await settings.save();

  res.status(200).json({
    success: true,
    tv: body.tv,
    anime: body.anime,
    tests: {
      tvdb: getTestResultString(tvdbTest),
      tmdb: getTestResultString(tmdbTest),
    },
  });
});

metadataRoutes.post('/test', async (req, res) => {
  let tvdbTest = -1;
  let tmdbTest = -1;

  try {
    const parsedBody = parseMetadataTestBody(req.body);

    if ('error' in parsedBody) {
      return res.status(400).json({ success: false, error: parsedBody.error });
    }

    const body = parsedBody.value;

    try {
      if (body.tmdb === true) {
        tmdbTest = 0;
        const tmdb = new TheMovieDb();
        await tmdb.getTvShow({ tvId: 1054 });
        tmdbTest = 1;
      }
    } catch (e) {
      logger.error('Failed to test metadata provider', {
        label: 'MetadataProvider',
        message: e.message,
      });
    }

    try {
      if (body.tvdb === true) {
        tvdbTest = 0;
        const tvdb = await Tvdb.getInstance();
        await tvdb.test();
        tvdbTest = 1;
      }
    } catch (e) {
      logger.error('Failed to test metadata provider', {
        label: 'MetadataProvider',
        message: e.message,
      });
    }

    const success = !(tvdbTest === 0 || tmdbTest === 0);
    const statusCode = success ? 200 : 500;

    return res.status(statusCode).json({
      success: success,
      tests: {
        tmdb: getTestResultString(tmdbTest),
        tvdb: getTestResultString(tvdbTest),
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      tests: {
        tmdb: getTestResultString(tmdbTest),
        tvdb: getTestResultString(tvdbTest),
      },
      error: e.message,
    });
  }
});

export default metadataRoutes;
