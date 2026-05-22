import TheMovieDb from '@server/api/themoviedb';
import Media from '@server/entity/Media';
import { rankTmdbPersonCredits } from '@server/lib/tmdbRank';
import logger from '@server/logger';
import {
  mapCastCredits,
  mapCrewCredits,
  mapPersonDetails,
} from '@server/models/Person';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { parseOptionalLanguage } from '@server/utils/validation';
import { Router } from 'express';

const personRoutes = Router();
const maxTmdbPersonId = 1_000_000_000;

const parsePersonRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxTmdbPersonId);

personRoutes.get('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const personId = parsePersonRouteId(req.params.id);
  if (!personId) {
    return next({ status: 404, message: 'Person not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const person = await tmdb.getPerson({
      personId,
      language,
    });
    return res.status(200).json(mapPersonDetails(person));
  } catch (e) {
    logger.debug('Something went wrong retrieving person', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve person.',
    });
  }
});

personRoutes.get('/:id/combined_credits', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const personId = parsePersonRouteId(req.params.id);
  if (!personId) {
    return next({ status: 404, message: 'Person not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const combinedCredits = await tmdb.getPersonCombinedCredits({
      personId,
      language,
    });
    const rankedCast = rankTmdbPersonCredits(combinedCredits.cast);
    const rankedCrew = rankTmdbPersonCredits(combinedCredits.crew);

    const castMedia = await Media.getRelatedMedia(
      req.user,
      rankedCast
        .filter((result) => result.media_type)
        .map((result) => ({
          tmdbId: result.id,
          mediaType: result.media_type!,
        }))
    );

    const crewMedia = await Media.getRelatedMedia(
      req.user,
      rankedCrew
        .filter((result) => result.media_type)
        .map((result) => ({
          tmdbId: result.id,
          mediaType: result.media_type!,
        }))
    );

    return res.status(200).json({
      cast: rankedCast
        .map((result) =>
          mapCastCredits(
            result,
            castMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult && item.character !== 'Thanks'),
      crew: rankedCrew
        .map((result) =>
          mapCrewCredits(
            result,
            crewMedia.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === result.media_type
            )
          )
        )
        .filter((item) => !item.adult && item.job !== 'Thanks'),
      id: combinedCredits.id,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving combined credits', {
      label: 'API',
      errorMessage: e.message,
      personId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve combined credits.',
    });
  }
});

export default personRoutes;
