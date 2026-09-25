import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import type { SonarrSeries } from '@server/api/servarr/sonarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  ComicServiceOption,
  MagazineServiceOption,
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { Permission } from '@server/lib/permissions';
import { runWithCurrentServarrService } from '@server/lib/serviceAdmission';
import {
  UserMutationActorUnauthorizedError,
  isUserSessionCredentialVersionCurrent,
  runUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import {
  classifyBookshelfProvider,
  getBookshelfProviderNotice,
} from '@server/utils/bookshelfProvider';
import {
  parseNonNegativeRouteId,
  parsePositiveRouteId,
} from '@server/utils/routeId';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';

const serviceRoutes = Router();
const maxServiceRouteId = 1_000_000_000;
export const SONARR_LOOKUP_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
const sonarrLookupRateLimit = rateLimit({
  ...SONARR_LOOKUP_RATE_LIMIT,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
});

const SERVICE_DETAILS_PERMISSIONS = [
  Permission.REQUEST_ADVANCED,
  Permission.MANAGE_REQUESTS,
];

const canViewOperationalServiceDetails = (req: Request) =>
  req.user?.hasPermission(SERVICE_DETAILS_PERMISSIONS, { type: 'or' }) ?? false;

const runServiceSummaryRead = <Result>(
  req: Request,
  callback: (includeOperationalDetails: boolean) => Result | Promise<Result>
): Promise<Result> => {
  const actorId = req.user?.id;
  if (!actorId) {
    throw new UserMutationActorUnauthorizedError('Service actor is missing.');
  }
  const middlewareGrantedDetails = canViewOperationalServiceDetails(req);

  return runUserSecurityMutation(actorId, async () => {
    const actor = await getRepository(User).findOneBy({ id: actorId });
    if (!actor) {
      throw new UserMutationActorUnauthorizedError(
        'Service actor no longer exists.'
      );
    }

    if (
      req.session?.userId === actor.id &&
      !isUserSessionCredentialVersionCurrent(
        actor,
        req.session.credentialVersion
      )
    ) {
      throw new UserMutationActorUnauthorizedError(
        'Service credentials changed before admission.'
      );
    }

    return callback(
      middlewareGrantedDetails &&
        actor.hasPermission(SERVICE_DETAILS_PERMISSIONS, { type: 'or' })
    );
  });
};

const reportServiceSummaryReadError = (
  error: unknown,
  next: (error?: unknown) => void
) =>
  error instanceof UserMutationActorUnauthorizedError
    ? next({ status: 403, message: 'Access denied.' })
    : next(error);

const parseServiceRouteId = (id: unknown): number | undefined =>
  parseNonNegativeRouteId(id, maxServiceRouteId);

const parsePositiveServiceRouteId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, maxServiceRouteId);

export const filterSonarrLookupResults = (results: SonarrSeries[]) =>
  results.map(({ tvdbId, title, year, overview, remotePoster }) => ({
    tvdbId,
    title,
    year,
    overview,
    remotePoster,
  }));

const filterServiceServer = (
  server: ServiceCommonServer,
  includeOperationalDetails: boolean
): ServiceCommonServer => {
  if (includeOperationalDetails) {
    return server;
  }

  return {
    id: server.id,
    name: server.name,
    is4k: server.is4k,
    isAlt: server.isAlt,
    isDefault: server.isDefault,
    serviceType: server.serviceType,
  };
};

serviceRoutes.get('/radarr', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, (includeOperationalDetails) => {
      const settings = getExternalRuntimeConfig();
      const filteredRadarrServers: ServiceCommonServer[] = settings.radarr.map(
        (radarr) =>
          filterServiceServer(
            {
              id: radarr.id,
              name: radarr.name,
              is4k: radarr.is4k,
              isAlt: radarr.is4k,
              isDefault: radarr.isDefault,
              activeDirectory: radarr.activeDirectory,
              activeProfileId: radarr.activeProfileId,
              activeTags: radarr.tags ?? [],
            },
            includeOperationalDetails
          )
      );

      return res.status(200).json(filteredRadarrServers);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get<{ radarrId: string }>(
  '/radarr/:radarrId',
  isAuthenticated(SERVICE_DETAILS_PERMISSIONS, { type: 'or' }),
  authorizedMutation<{ radarrId: string }>(
    SERVICE_DETAILS_PERMISSIONS,
    async (req, res, next) => {
      const radarrId = parseServiceRouteId(req.params.radarrId);
      if (radarrId === undefined) {
        return next({
          status: 404,
          message: 'Radarr server with provided ID  does not exist.',
        });
      }
      const details = await runWithCurrentServarrService(
        'radarr',
        radarrId,
        async (radarrSettings) => {
          const radarr = new RadarrAPI({
            apiKey: radarrSettings.apiKey,
            url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
          });
          const [profiles, rootFolders, tags] = await Promise.all([
            radarr.getProfiles(),
            radarr.getRootFolders(),
            radarr.getTags(),
          ]);
          return {
            server: {
              id: radarrSettings.id,
              name: radarrSettings.name,
              is4k: radarrSettings.is4k,
              isAlt: radarrSettings.is4k,
              isDefault: radarrSettings.isDefault,
              activeDirectory: radarrSettings.activeDirectory,
              activeProfileId: radarrSettings.activeProfileId,
              activeTags: radarrSettings.tags,
            },
            profiles: profiles.map((profile) => ({
              id: profile.id,
              name: profile.name,
            })),
            rootFolders: rootFolders.map((folder) => ({
              id: folder.id,
              freeSpace: folder.freeSpace,
              path: folder.path,
              totalSpace: folder.totalSpace,
            })),
            tags,
          } as ServiceCommonServerWithDetails;
        }
      );
      return details
        ? res.status(200).json(details)
        : next({
            status: 404,
            message: 'Radarr server with provided ID does not exist.',
          });
    }
  )
);

serviceRoutes.get('/sonarr', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, (includeOperationalDetails) => {
      const settings = getExternalRuntimeConfig();
      const filteredSonarrServers: ServiceCommonServer[] = settings.sonarr.map(
        (sonarr) =>
          filterServiceServer(
            {
              id: sonarr.id,
              name: sonarr.name,
              is4k: sonarr.is4k,
              isAlt: sonarr.is4k,
              isDefault: sonarr.isDefault,
              activeDirectory: sonarr.activeDirectory,
              activeProfileId: sonarr.activeProfileId,
              activeAnimeProfileId: sonarr.activeAnimeProfileId,
              activeAnimeDirectory: sonarr.activeAnimeDirectory,
              activeLanguageProfileId: sonarr.activeLanguageProfileId,
              activeAnimeLanguageProfileId: sonarr.activeAnimeLanguageProfileId,
              activeTags: [],
            },
            includeOperationalDetails
          )
      );

      return res.status(200).json(filteredSonarrServers);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get<{ sonarrId: string }>(
  '/sonarr/:sonarrId',
  isAuthenticated(SERVICE_DETAILS_PERMISSIONS, { type: 'or' }),
  authorizedMutation<{ sonarrId: string }>(
    SERVICE_DETAILS_PERMISSIONS,
    async (req, res, next) => {
      const sonarrId = parseServiceRouteId(req.params.sonarrId);
      if (sonarrId === undefined) {
        return next({
          status: 404,
          message: 'Sonarr server with provided ID does not exist.',
        });
      }

      try {
        const details = await runWithCurrentServarrService(
          'sonarr',
          sonarrId,
          async (sonarrSettings) => {
            const sonarr = new SonarrAPI({
              apiKey: sonarrSettings.apiKey,
              url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
            });
            const systemStatus = await sonarr.getSystemStatus();
            const sonarrMajorVersion = Number(
              systemStatus.version.split('.')[0]
            );
            const [profiles, rootFolders, languageProfiles, tags] =
              await Promise.all([
                sonarr.getProfiles(),
                sonarr.getRootFolders(),
                sonarrMajorVersion <= 3
                  ? sonarr.getLanguageProfiles()
                  : Promise.resolve(null),
                sonarr.getTags(),
              ]);
            return {
              server: {
                id: sonarrSettings.id,
                name: sonarrSettings.name,
                is4k: sonarrSettings.is4k,
                isAlt: sonarrSettings.is4k,
                isDefault: sonarrSettings.isDefault,
                activeDirectory: sonarrSettings.activeDirectory,
                activeProfileId: sonarrSettings.activeProfileId,
                activeAnimeProfileId: sonarrSettings.activeAnimeProfileId,
                activeAnimeDirectory: sonarrSettings.activeAnimeDirectory,
                activeLanguageProfileId: sonarrSettings.activeLanguageProfileId,
                activeAnimeLanguageProfileId:
                  sonarrSettings.activeAnimeLanguageProfileId,
                activeTags: sonarrSettings.tags,
                activeAnimeTags: sonarrSettings.animeTags,
              },
              profiles: profiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              })),
              rootFolders: rootFolders.map((folder) => ({
                id: folder.id,
                freeSpace: folder.freeSpace,
                path: folder.path,
                totalSpace: folder.totalSpace,
              })),
              languageProfiles,
              tags,
            } as ServiceCommonServerWithDetails;
          }
        );
        return details
          ? res.status(200).json(details)
          : next({
              status: 404,
              message: 'Sonarr server with provided ID does not exist.',
            });
      } catch (e) {
        return next({ status: 500, message: e.message });
      }
    }
  )
);

serviceRoutes.get('/lidarr', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, (includeOperationalDetails) => {
      const settings = getExternalRuntimeConfig();
      const filteredLidarrServers: ServiceCommonServer[] = settings.lidarr.map(
        (lidarr) =>
          filterServiceServer(
            {
              id: lidarr.id,
              name: lidarr.name,
              is4k: lidarr.is4k,
              isDefault: lidarr.isDefault,
              activeDirectory: lidarr.activeDirectory,
              activeProfileId: lidarr.activeProfileId,
              activeMetadataProfileId: lidarr.activeMetadataProfileId,
              activeTags: lidarr.tags ?? [],
            },
            includeOperationalDetails
          )
      );

      return res.status(200).json(filteredLidarrServers);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get('/comic', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, () => {
      const settings = getExternalRuntimeConfig();
      const comicServices: ComicServiceOption[] = [
        ...settings.mylar.map((mylar): ComicServiceOption => ({
          id: mylar.id,
          name: mylar.name,
          isDefault: mylar.isDefault,
          backendType: 'mylar',
        })),
        ...settings.kapowarr.map((kapowarr): ComicServiceOption => ({
          id: kapowarr.id,
          name: kapowarr.name,
          isDefault: kapowarr.isDefault,
          backendType: 'kapowarr',
        })),
      ];

      return res.status(200).json(comicServices);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get('/magazine', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, () => {
      const magazineServices: MagazineServiceOption[] =
        getExternalRuntimeConfig().lazylibrarian.map((service) => ({
          id: service.id,
          name: service.name,
          isDefault: service.isDefault,
        }));

      return res.status(200).json(magazineServices);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get('/readarr', async (req, res, next) => {
  try {
    return await runServiceSummaryRead(req, (includeOperationalDetails) => {
      const settings = getExternalRuntimeConfig();
      const filteredReadarrServers: ServiceCommonServer[] =
        settings.readarr.map((readarr) =>
          filterServiceServer(
            {
              id: readarr.id,
              name: readarr.name,
              is4k: readarr.is4k,
              isDefault: readarr.isDefault,
              activeDirectory: readarr.activeDirectory,
              activeProfileId: readarr.activeProfileId,
              activeMetadataProfileId: readarr.activeMetadataProfileId,
              activeTags: readarr.tags ?? [],
              serviceType: readarr.serviceType ?? 'ebook',
            },
            includeOperationalDetails
          )
        );

      return res.status(200).json(filteredReadarrServers);
    });
  } catch (error) {
    return reportServiceSummaryReadError(error, next);
  }
});

serviceRoutes.get<{ readarrId: string }>(
  '/readarr/:readarrId',
  isAuthenticated(SERVICE_DETAILS_PERMISSIONS, { type: 'or' }),
  authorizedMutation<{ readarrId: string }>(
    SERVICE_DETAILS_PERMISSIONS,
    async (req, res, next) => {
      const readarrId = parseServiceRouteId(req.params.readarrId);
      if (readarrId === undefined) {
        return next({
          status: 404,
          message: 'Bookshelf server with provided ID does not exist.',
        });
      }

      try {
        const details = await runWithCurrentServarrService(
          'readarr',
          readarrId,
          async (readarrSettings) => {
            const readarr = new ReadarrAPI({
              apiKey: readarrSettings.apiKey,
              url: ReadarrAPI.buildUrl(readarrSettings, '/api/v1'),
              mediaType: readarrSettings.serviceType ?? 'ebook',
            });
            const [profiles, metadataProfiles, rootFolders, tags, development] =
              await Promise.all([
                readarr.getProfiles(),
                readarr.getMetadataProfiles(),
                readarr.getRootFolders(),
                readarr.getTags(),
                readarr.getDevelopmentConfig().catch(() => undefined),
              ]);
            const provider = classifyBookshelfProvider(
              development?.metadataSource
            );
            return {
              server: {
                id: readarrSettings.id,
                name: readarrSettings.name,
                is4k: readarrSettings.is4k,
                isDefault: readarrSettings.isDefault,
                activeDirectory: readarrSettings.activeDirectory,
                activeProfileId: readarrSettings.activeProfileId,
                activeMetadataProfileId:
                  readarrSettings.activeMetadataProfileId,
                activeTags: readarrSettings.tags,
                serviceType: readarrSettings.serviceType ?? 'ebook',
                provider,
                providerNotice: getBookshelfProviderNotice(provider),
                legacyWarning: getBookshelfProviderNotice(provider),
                metadataSource: development?.metadataSource,
              },
              profiles: profiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              })),
              metadataProfiles: metadataProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              })),
              rootFolders: rootFolders.map((folder) => ({
                id: folder.id,
                freeSpace: folder.freeSpace,
                path: folder.path,
                totalSpace: folder.totalSpace,
              })),
              tags,
            } as ServiceCommonServerWithDetails;
          }
        );
        return details
          ? res.status(200).json(details)
          : next({
              status: 404,
              message: 'Bookshelf server with provided ID does not exist.',
            });
      } catch (e) {
        return next({ status: 500, message: e.message });
      }
    }
  )
);

serviceRoutes.get<{ lidarrId: string }>(
  '/lidarr/:lidarrId',
  isAuthenticated(SERVICE_DETAILS_PERMISSIONS, { type: 'or' }),
  authorizedMutation<{ lidarrId: string }>(
    SERVICE_DETAILS_PERMISSIONS,
    async (req, res, next) => {
      const lidarrId = parseServiceRouteId(req.params.lidarrId);
      if (lidarrId === undefined) {
        return next({
          status: 404,
          message: 'Lidarr server with provided ID does not exist.',
        });
      }

      try {
        const details = await runWithCurrentServarrService(
          'lidarr',
          lidarrId,
          async (lidarrSettings) => {
            const lidarr = new LidarrAPI({
              apiKey: lidarrSettings.apiKey,
              url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
            });
            const [profiles, metadataProfiles, rootFolders, tags] =
              await Promise.all([
                lidarr.getProfiles(),
                lidarr.getMetadataProfiles(),
                lidarr.getRootFolders(),
                lidarr.getTags(),
              ]);
            return {
              server: {
                id: lidarrSettings.id,
                name: lidarrSettings.name,
                is4k: lidarrSettings.is4k,
                isDefault: lidarrSettings.isDefault,
                activeDirectory: lidarrSettings.activeDirectory,
                activeProfileId: lidarrSettings.activeProfileId,
                activeMetadataProfileId: lidarrSettings.activeMetadataProfileId,
                activeTags: lidarrSettings.tags,
              },
              profiles: profiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              })),
              metadataProfiles: metadataProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
              })),
              rootFolders: rootFolders.map((folder) => ({
                id: folder.id,
                freeSpace: folder.freeSpace,
                path: folder.path,
                totalSpace: folder.totalSpace,
              })),
              tags,
            } as ServiceCommonServerWithDetails;
          }
        );
        return details
          ? res.status(200).json(details)
          : next({
              status: 404,
              message: 'Lidarr server with provided ID does not exist.',
            });
      } catch (e) {
        return next({ status: 500, message: e.message });
      }
    }
  )
);

serviceRoutes.get<{ tmdbId: string }>(
  '/sonarr/lookup/:tmdbId',
  sonarrLookupRateLimit,
  async (req, res, next) => {
    const tmdbId = parsePositiveServiceRouteId(req.params.tmdbId);
    if (!tmdbId) {
      return next({ status: 404, message: 'Series not found.' });
    }

    try {
      return await runUserSecurityMutation(req.user!.id, async () => {
        const actor = await getRepository(User).findOneBy({ id: req.user!.id });
        if (
          !actor ||
          (req.session?.userId === actor.id &&
            !isUserSessionCredentialVersionCurrent(
              actor,
              req.session.credentialVersion
            ))
        ) {
          throw new UserMutationActorUnauthorizedError();
        }

        const tv = await new TheMovieDb().getTvShow({
          tvId: tmdbId,
          language: 'en',
        });
        const sonarrId = getExternalRuntimeConfig().sonarr[0]?.id;
        if (sonarrId === undefined) {
          logger.error('No sonarr server has been setup', {
            label: 'Media Request',
          });
          return next({
            status: 404,
            message: 'No sonarr server has been setup',
          });
        }
        const response = await runWithCurrentServarrService(
          'sonarr',
          sonarrId,
          async (sonarrSettings) =>
            new SonarrAPI({
              apiKey: sonarrSettings.apiKey,
              url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
            }).getSeriesByTitle(tv.name)
        );
        if (!response) {
          return next({
            status: 404,
            message: 'No sonarr server has been setup',
          });
        }

        return res.status(200).json(filterSonarrLookupResults(response));
      });
    } catch (e) {
      if (e instanceof UserMutationActorUnauthorizedError) {
        return next({ status: 403, message: 'Access denied.' });
      }
      logger.error('Failed to fetch tvdb search results', {
        label: 'Media Request',
        message: e.message,
      });

      return next({
        status: 500,
        message: 'Something went wrong trying to fetch series information',
      });
    }
  }
);

export default serviceRoutes;
