import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import logger from '@server/logger';
import { mapCollection } from '@server/models/Collection';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { parseOptionalLanguage } from '@server/utils/validation';
import { Router } from 'express';

const collectionRoutes = Router();
const maxTmdbId = 1_000_000_000;

const parseCollectionRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxTmdbId);

collectionRoutes.get<{ id: string }>('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const collectionId = parseCollectionRouteId(req.params.id);
  if (!collectionId) {
    return next({ status: 404, message: 'Collection not found.' });
  }
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  try {
    const collection = await tmdb.getCollection({
      collectionId,
      language,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      collection.parts.map((part) => ({
        tmdbId: part.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json(mapCollection(collection, media));
  } catch (e) {
    logger.debug('Something went wrong retrieving collection', {
      label: 'API',
      errorMessage: e.message,
      collectionId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve collection.',
    });
  }
});

export default collectionRoutes;
