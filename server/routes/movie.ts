import IMDBRadarrProxy from '@server/api/rating/imdbRadarrProxy';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import { type RatingResponse } from '@server/api/ratings';
import RadarrAPI from '@server/api/servarr/radarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Watchlist } from '@server/entity/Watchlist';
import { upsertMediaSearchMetadata } from '@server/lib/mediaSearchMetadata';
import { getSettings, type RadarrSettings } from '@server/lib/settings';
import { rankTmdbMovieResults } from '@server/lib/tmdbRank';
import logger from '@server/logger';
import { mapMovieDetails } from '@server/models/Movie';
import { mapMovieResult } from '@server/models/Search';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseNonNegativeInt,
  parseOptionalPositiveInt,
  parsePositiveInt,
} from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseOptionalBoundedString,
  parseOptionalLanguage,
} from '@server/utils/validation';
import { Router } from 'express';

const movieRoutes = Router();
const maxTmdbId = 1_000_000_000;
const maxShuffleSeedLength = 128;

const parseTmdbRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxTmdbId);

const getMovieCoverService = (
  media?: Media,
  is4k?: boolean
): { server: RadarrSettings; movieId: number; is4k: boolean } | undefined => {
  if (!media) {
    return undefined;
  }

  const settings = getSettings();
  const candidates =
    is4k === true
      ? [
          {
            serviceId: media.serviceId4k,
            externalServiceId: media.externalServiceId4k,
            is4k: true,
          },
        ]
      : is4k === false
        ? [
            {
              serviceId: media.serviceId,
              externalServiceId: media.externalServiceId,
              is4k: false,
            },
          ]
        : [
            {
              serviceId: media.serviceId,
              externalServiceId: media.externalServiceId,
              is4k: false,
            },
            {
              serviceId: media.serviceId4k,
              externalServiceId: media.externalServiceId4k,
              is4k: true,
            },
          ];

  for (const candidate of candidates) {
    if (
      candidate.serviceId === null ||
      candidate.serviceId === undefined ||
      candidate.externalServiceId === null ||
      candidate.externalServiceId === undefined
    ) {
      continue;
    }

    const server = settings.radarr.find(
      (radarr) => radarr.id === candidate.serviceId
    );

    if (server) {
      return {
        server,
        movieId: candidate.externalServiceId,
        is4k: candidate.is4k,
      };
    }
  }

  return undefined;
};

movieRoutes.get('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return next({ status: 404, message: 'Movie not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const tmdbMovie = await tmdb.getMovie({
      movieId,
      language,
    });

    const media = await Media.getMedia(tmdbMovie.id, MediaType.MOVIE, req.user);

    const onUserWatchlist = req.user
      ? await getRepository(Watchlist).exists({
          where: {
            tmdbId: movieId,
            mediaType: MediaType.MOVIE,
            requestedBy: { id: req.user.id },
          },
        })
      : false;

    const data = mapMovieDetails(tmdbMovie, media, onUserWatchlist);

    await upsertMediaSearchMetadata(media?.id, {
      title: data.title,
      alternateTitle: data.originalTitle,
      releaseDate: data.releaseDate,
      genres: data.genres.map((genre) => genre.name).join(', '),
      runtime: data.runtime ? `${data.runtime} minutes` : undefined,
      director: data.credits.crew
        .filter((credit) => credit.job === 'Director')
        .map((credit) => credit.name)
        .join(', '),
      writer: data.credits.crew
        .filter((credit) =>
          ['Writer', 'Screenplay', 'Story', 'Teleplay'].includes(credit.job)
        )
        .map((credit) => credit.name)
        .join(', '),
      studio: data.productionCompanies
        .map((company) => company.name)
        .join(', '),
      format: 'Movie',
      provider: 'TMDB',
      externalIds: [data.id, data.imdbId].filter(Boolean).join(' '),
    });

    // TMDB issue where it doesnt fallback to English when no overview is available in requested locale.
    if (!data.overview) {
      const tvEnglish = await tmdb.getMovie({ movieId });
      data.overview = tvEnglish.overview;
    }

    return res.status(200).json(filterEntityResponse(data, req.user));
  } catch (e) {
    logger.debug('Something went wrong retrieving movie', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie.',
    });
  }
});

movieRoutes.get('/:id/cover', async (req, res) => {
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return res.status(404).send('Movie cover not found');
  }

  const mediaId = parseOptionalPositiveInt(req.query.mediaId, 1_000_000_000);
  const is4k =
    req.query.is4k === 'true'
      ? true
      : req.query.is4k === 'false'
        ? false
        : undefined;
  const explicitServiceId = parseNonNegativeInt(
    req.query.serviceId,
    -1,
    1_000_000_000
  );
  const explicitExternalServiceId = parseOptionalPositiveInt(
    req.query.externalServiceId,
    1_000_000_000
  );

  let coverService:
    { server: RadarrSettings; movieId: number; is4k: boolean } | undefined;

  if (
    explicitServiceId >= 0 &&
    explicitExternalServiceId !== undefined &&
    is4k !== undefined
  ) {
    const server = getSettings().radarr.find(
      (candidate) =>
        candidate.id === explicitServiceId && Boolean(candidate.is4k) === is4k
    );
    if (server) {
      coverService = {
        server,
        movieId: explicitExternalServiceId,
        is4k,
      };
    }
  }

  if (!coverService && mediaId) {
    const media = await getRepository(Media).findOne({
      where: { id: mediaId, mediaType: MediaType.MOVIE, tmdbId: movieId },
    });
    coverService = getMovieCoverService(media ?? undefined, is4k);
  }

  if (!coverService) {
    return res.status(404).send('Movie cover not found');
  }

  try {
    const radarrApi = new RadarrAPI({
      apiKey: coverService.server.apiKey,
      url: RadarrAPI.buildUrl(coverService.server, '/api/v3'),
    });
    const cover = await radarrApi.getMovieCover(coverService.movieId);

    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', cover.contentType);
    res.setHeader('Content-Length', cover.imageBuffer.length);
    return res.status(200).send(cover.imageBuffer);
  } catch (e) {
    logger.warn('Failed to retrieve Radarr cover fallback', {
      label: 'Movie',
      movieId,
      mediaId: mediaId ?? null,
      is4k: coverService.is4k,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(404).send('Movie cover not found');
  }
});

movieRoutes.get('/:id/recommendations', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return next({ status: 404, message: 'Movie not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const parsedShuffleSeed = parseOptionalBoundedString(req.query.shuffleSeed, {
    fieldName: 'Shuffle seed',
    maxLength: maxShuffleSeedLength,
  });
  if ('error' in parsedShuffleSeed) {
    return res
      .status(400)
      .json({ status: 400, message: parsedShuffleSeed.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const results = await tmdb.getMovieRecommendations({
      movieId,
      page: parsePositiveInt(req.query.page, 1, 500),
      language,
    });
    const rankedResults = rankTmdbMovieResults(
      results.results,
      parsedShuffleSeed.value
    );

    const media = await Media.getRelatedMedia(
      req.user,
      rankedResults.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: rankedResults.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving movie recommendations', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie recommendations.',
    });
  }
});

movieRoutes.get('/:id/similar', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return next({ status: 404, message: 'Movie not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const parsedShuffleSeed = parseOptionalBoundedString(req.query.shuffleSeed, {
    fieldName: 'Shuffle seed',
    maxLength: maxShuffleSeedLength,
  });
  if ('error' in parsedShuffleSeed) {
    return res
      .status(400)
      .json({ status: 400, message: parsedShuffleSeed.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const results = await tmdb.getMovieSimilar({
      movieId,
      page: parsePositiveInt(req.query.page, 1, 500),
      language,
    });
    const rankedResults = rankTmdbMovieResults(
      results.results,
      parsedShuffleSeed.value
    );

    const media = await Media.getRelatedMedia(
      req.user,
      rankedResults.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: rankedResults.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving similar movies', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve similar movies.',
    });
  }
});

/**
 * Endpoint backed by RottenTomatoes
 */
movieRoutes.get('/:id/ratings', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const rtapi = new RottenTomatoes();
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return next({ status: 404, message: 'Movie not found.' });
  }

  try {
    const movie = await tmdb.getMovie({
      movieId,
    });

    const rtratings = await rtapi.getMovieRatings(
      movie.title,
      Number(movie.release_date.slice(0, 4))
    );

    if (!rtratings) {
      return next({
        status: 404,
        message: 'Rotten Tomatoes ratings not found.',
      });
    }

    return res.status(200).json(rtratings);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie ratings', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie ratings.',
    });
  }
});

/**
 * Endpoint combining RottenTomatoes and IMDB
 */
movieRoutes.get('/:id/ratingscombined', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const rtapi = new RottenTomatoes();
  const imdbApi = new IMDBRadarrProxy();
  const movieId = parseTmdbRouteId(req.params.id);
  if (!movieId) {
    return next({ status: 404, message: 'Movie not found.' });
  }

  try {
    const movie = await tmdb.getMovie({
      movieId,
    });

    const rtratings = await rtapi.getMovieRatings(
      movie.title,
      Number(movie.release_date.slice(0, 4))
    );

    let imdbRatings;
    if (movie.imdb_id) {
      imdbRatings = await imdbApi.getMovieRatings(movie.imdb_id);
    }

    if (!rtratings && !imdbRatings) {
      return next({
        status: 404,
        message: 'No ratings found.',
      });
    }

    const ratings: RatingResponse = {
      ...(rtratings ? { rt: rtratings } : {}),
      ...(imdbRatings ? { imdb: imdbRatings } : {}),
    };

    return res.status(200).json(ratings);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie ratings', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie ratings.',
    });
  }
});

export default movieRoutes;
