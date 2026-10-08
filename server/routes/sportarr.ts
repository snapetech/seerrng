import SportarrAPI from '@server/api/servarr/sportarr';
import { getRepository } from '@server/datasource';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { Permission, hasPermission } from '@server/lib/permissions';
import { runWithCurrentServarrService } from '@server/lib/serviceAdmission';
import { isSportarrLeagueExternalId } from '@server/lib/sportarrIdentity';
import logger from '@server/logger';
import { mapSportarrLeague } from '@server/models/Sportarr';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseNonNegativeRouteId,
  parsePositiveRouteId,
} from '@server/utils/routeId';
import { Router } from 'express';

const sportarrRoutes = Router();

const getDefaultSportarrService = () => {
  const services = getExternalRuntimeConfig().sportarr;
  return services.find((service) => service.isDefault) ?? services[0];
};

const parseBoundedPage = (
  value: unknown,
  fallback: number,
  maximum: number
): number => {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : fallback;
};

sportarrRoutes.get('/:externalId', async (req, res) => {
  const externalId = req.params.externalId;
  if (!isSportarrLeagueExternalId(externalId)) {
    return res.status(404).json({ status: 404, message: 'League not found.' });
  }

  const requestedServiceId =
    req.query.serverId === undefined
      ? undefined
      : parseNonNegativeRouteId(req.query.serverId);
  if (req.query.serverId !== undefined && requestedServiceId === undefined) {
    return res
      .status(400)
      .json({ status: 400, message: 'Invalid Sportarr service ID.' });
  }

  if (
    requestedServiceId !== undefined &&
    !hasPermission(
      [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
      req.user?.permissions ?? 0,
      { type: 'or' }
    )
  ) {
    return res.status(403).json({
      status: 403,
      message: 'Advanced Request or Manage Requests permission is required.',
    });
  }

  const service =
    requestedServiceId === undefined
      ? getDefaultSportarrService()
      : getExternalRuntimeConfig().sportarr.find(
          (instance) => instance.id === requestedServiceId
        );
  if (requestedServiceId !== undefined && !service) {
    return res
      .status(404)
      .json({ status: 404, message: 'Sportarr service not found.' });
  }

  if (!service) {
    return res.status(503).json({
      status: 503,
      message: 'Connect Sportarr in Settings > Services to browse leagues.',
    });
  }

  try {
    const league = await runWithCurrentServarrService(
      'sportarr',
      service.id,
      async (current) =>
        new SportarrAPI({
          url: SportarrAPI.buildUrl(current, '/api'),
          apiKey: current.apiKey,
        }).getLeagueByExternalId(externalId)
    );
    if (!league) {
      return res
        .status(404)
        .json({ status: 404, message: 'League not found.' });
    }

    const identifier = await getRepository(MediaIdentifier).findOne({
      where: {
        provider: MediaIdentifierProvider.SPORTARR,
        value: externalId,
      },
      relations: { media: true },
      relationLoadStrategy: 'query',
    });
    const media = identifier?.media
      ? (await hydrateMediaSummaryRelations([identifier.media], req.user))[0]
      : undefined;

    return res
      .status(200)
      .json(
        filterEntityResponse(
          mapSportarrLeague(league, media, service.id),
          req.user
        )
      );
  } catch (error) {
    logger.warn('Failed to load Sportarr league details', {
      label: 'Sportarr',
      externalId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({
      status: 502,
      message: 'Sportarr is unavailable. Try again shortly.',
    });
  }
});

sportarrRoutes.get('/:externalId/events', async (req, res) => {
  const externalId = req.params.externalId;
  if (!isSportarrLeagueExternalId(externalId)) {
    return res.status(404).json({ status: 404, message: 'League not found.' });
  }

  const service = getDefaultSportarrService();
  if (!service) {
    return res.status(503).json({
      status: 503,
      message: 'Connect Sportarr in Settings > Services to view events.',
    });
  }

  const page = parseBoundedPage(req.query.page, 1, 1000);
  const pageSize = parseBoundedPage(req.query.pageSize, 50, 200);
  try {
    const result = await runWithCurrentServarrService(
      'sportarr',
      service.id,
      async (current) => {
        const api = new SportarrAPI({
          url: SportarrAPI.buildUrl(current, '/api'),
          apiKey: current.apiKey,
        });
        const league = (await api.getLibraryLeagues()).find(
          (item) => item.externalId === externalId
        );
        if (!league?.id || !league.monitored) {
          return {
            eventsAvailable: false,
            page,
            pageSize,
            totalRecords: 0,
            totalPages: 0,
            results: [],
          };
        }

        const events = await api.getLeagueEvents(league.id, page, pageSize);
        return {
          eventsAvailable: true,
          page: events.page,
          pageSize: events.pageSize,
          totalRecords: events.totalRecords,
          totalPages: events.totalPages,
          results: events.records,
        };
      }
    );
    return res.status(200).json(result);
  } catch (error) {
    logger.warn('Failed to load Sportarr league events', {
      label: 'Sportarr',
      externalId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return res.status(502).json({
      status: 502,
      message: 'Sportarr events are unavailable. Try again shortly.',
    });
  }
});

sportarrRoutes.get('/cover/:serviceId/:leagueId', async (req, res, next) => {
  const serviceId = parseNonNegativeRouteId(req.params.serviceId);
  const leagueId = parsePositiveRouteId(req.params.leagueId);
  const externalId = isSportarrLeagueExternalId(req.params.leagueId)
    ? req.params.leagueId
    : undefined;
  if (serviceId === undefined || (leagueId === undefined && !externalId)) {
    return res.status(404).json({ status: 404, message: 'Poster not found.' });
  }

  try {
    const cover = await runWithCurrentServarrService(
      'sportarr',
      serviceId,
      async (service) =>
        new SportarrAPI({
          url: SportarrAPI.buildUrl(service, '/api'),
          apiKey: service.apiKey,
        }).getLeagueCover(externalId ?? leagueId!)
    );
    if (!cover) {
      return res
        .status(404)
        .json({ status: 404, message: 'Poster not found.' });
    }
    return res
      .set('X-Content-Type-Options', 'nosniff')
      .set('Cache-Control', 'private, max-age=3600')
      .type(cover.contentType)
      .send(cover.imageBuffer);
  } catch {
    return next({ status: 404, message: 'Sportarr league poster not found.' });
  }
});

export default sportarrRoutes;
