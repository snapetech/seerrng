import ComicVineAPI from '@server/api/comicvine';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { Watchlist } from '@server/entity/Watchlist';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { mapComicVineVolumeDetails } from '@server/models/Comic';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { Router } from 'express';

const comicRoutes = Router();

comicRoutes.get('/:id', async (req, res, next) => {
  const comicVineId = parsePositiveRouteId(req.params.id);
  if (comicVineId === undefined) {
    return res.status(404).json({ status: 404, message: 'Comic not found' });
  }

  const { comicVineApiKey } = getSettings().main;
  if (!comicVineApiKey) {
    return next({
      status: 503,
      message: 'ComicVine is not configured on this server.',
    });
  }

  try {
    const comicVine = new ComicVineAPI(comicVineApiKey);
    const [volume, onUserWatchlist] = await Promise.all([
      comicVine.getVolume(comicVineId),
      req.user
        ? getRepository(Watchlist).exists({
            where: {
              externalId: String(comicVineId),
              mediaType: MediaType.COMIC,
              requestedBy: { id: req.user.id },
            },
          })
        : false,
    ]);
    if (!volume) {
      return res.status(404).json({ status: 404, message: 'Comic not found' });
    }

    const identifier = await getRepository(MediaIdentifier).findOne({
      where: {
        provider: MediaIdentifierProvider.COMICVINE,
        value: String(comicVineId),
      },
      relations: { media: true },
      relationLoadStrategy: 'query',
    });
    const media = identifier?.media
      ? (
          await hydrateMediaSummaryRelations([identifier.media], req.user, {
            includeIssues: true,
          })
        )[0]
      : undefined;

    const comicDetails = mapComicVineVolumeDetails(
      volume,
      media,
      onUserWatchlist
    );

    return res.status(200).json(filterEntityResponse(comicDetails, req.user));
  } catch (e) {
    logger.error('Failed to retrieve comic details', {
      label: 'Comic',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      comicVineId,
    });
    return next({ status: 500, message: 'Unable to retrieve comic details.' });
  }
});

export default comicRoutes;
