import RadarrAPI from '@server/api/servarr/radarr';
import { Permission } from '@server/lib/permissions';
import {
  runWithCurrentServarrService,
  runWithServarrServiceCollectionMutationAdmission,
} from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  assertServarrServiceCanChangeKind,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import type { RadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseRadarrSettings,
  parseServarrConnectionSettings,
  preserveServarrApiKey,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import { Router } from 'express';

const radarrRoutes = Router();

radarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.radarr));
});

radarrRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();

    const parsedRadarr = parseRadarrSettings(req.body);

    if ('error' in parsedRadarr) {
      return res.status(400).json({ message: parsedRadarr.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'radarr',
      async () => {
        const historicalServiceIdMaximum =
          await getHistoricalServarrServiceIdMaximum('radarr');
        const radarr = await settings.persistSection('radarr', (current) => {
          assertServarrInstanceCapacity(current);
          const newRadarr = {
            ...parsedRadarr.value,
            id: allocateServarrServiceId(
              current.map(({ id }) => id),
              historicalServiceIdMaximum
            ),
          };
          const existing = newRadarr.isDefault
            ? current.map((instance) => ({
                ...instance,
                isDefault:
                  instance.is4k === newRadarr.is4k ? false : instance.isDefault,
              }))
            : current;
          return [...existing, newRadarr];
        });
        const newRadarr = radarr[radarr.length - 1];

        return res.status(201).json(redactSecrets(newRadarr));
      }
    );
  })
);

radarrRoutes.post<
  undefined,
  Record<string, unknown>,
  ServarrConnectionSettings
>(
  '/test',
  authorizedMutation<
    undefined,
    Record<string, unknown>,
    ServarrConnectionSettings
  >(Permission.ADMIN, async (req, res, next) => {
    try {
      const parsedRadarr = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(req.body, getSettings().radarr)
      );

      if ('error' in parsedRadarr) {
        return res.status(400).json({ message: parsedRadarr.error });
      }

      const radarr = new RadarrAPI({
        apiKey: parsedRadarr.value.apiKey,
        url: RadarrAPI.buildUrl(parsedRadarr.value, '/api/v3'),
      });

      const urlBase = await radarr
        .getSystemStatus()
        .then((value) => value.urlBase)
        .catch(() => parsedRadarr.value.baseUrl);
      const profiles = await radarr.getProfiles();
      const folders = await radarr.getRootFolders();
      const tags = await radarr.getTags();

      return res.status(200).json({
        profiles,
        rootFolders: folders.map((folder) => ({
          id: folder.id,
          path: folder.path,
        })),
        tags,
        urlBase,
      });
    } catch (e) {
      logger.error('Failed to test Radarr', {
        label: 'Radarr',
        message: e.message,
      });

      next({ status: 500, message: 'Failed to connect to Radarr' });
    }
  })
);

radarrRoutes.put<{ id: string }, RadarrSettings, RadarrSettings>(
  '/:id',
  authorizedMutation<{ id: string }, RadarrSettings, RadarrSettings>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const radarrId = parseNonNegativeRouteId(req.params.id);
      if (radarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const radarrIndex = settings.radarr.findIndex((r) => r.id === radarrId);

      if (radarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'radarr',
        async () => {
          const currentRadarr = settings.radarr.find(
            (instance) => instance.id === radarrId
          );
          if (!currentRadarr) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          const admittedRadarr = parseRadarrSettings(
            preserveServarrApiKey(req.body, currentRadarr),
            currentRadarr
          );
          if ('error' in admittedRadarr) {
            return next({ status: 400, message: admittedRadarr.error });
          }
          if (currentRadarr.is4k !== admittedRadarr.value.is4k) {
            await assertServarrServiceCanChangeKind('radarr', radarrId);
          }
          const radarr = await settings.persistSection('radarr', (current) =>
            current.map((instance) => {
              if (instance.id === radarrId) {
                return {
                  ...admittedRadarr.value,
                  apiKey:
                    (req.body as { apiKey?: unknown }).apiKey ===
                    REDACTED_SECRET
                      ? instance.apiKey
                      : admittedRadarr.value.apiKey,
                  id: radarrId,
                } as RadarrSettings;
              }
              return admittedRadarr.value.isDefault &&
                instance.is4k === admittedRadarr.value.is4k
                ? { ...instance, isDefault: false }
                : instance;
            })
          );

          return res
            .status(200)
            .json(redactSecrets(radarr.find(({ id }) => id === radarrId)));
        }
      );
    }
  )
);

radarrRoutes.get<{ id: string }>(
  '/:id/profiles',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const radarrId = parseNonNegativeRouteId(req.params.id);
      if (radarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const profiles = await runWithCurrentServarrService(
        'radarr',
        radarrId,
        async (radarrSettings) =>
          new RadarrAPI({
            apiKey: radarrSettings.apiKey,
            url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
          }).getProfiles()
      );
      if (!profiles) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return res.status(200).json(
        profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
        }))
      );
    }
  )
);

radarrRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const radarrId = parseNonNegativeRouteId(req.params.id);
      if (radarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const radarrIndex = settings.radarr.findIndex((r) => r.id === radarrId);

      if (radarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'radarr',
        async () => {
          const removed = settings.radarr.find(
            (instance) => instance.id === radarrId
          );
          if (!removed) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          await assertServarrServiceCanBeRemoved('radarr', radarrId);
          await settings.persistSection('radarr', (current) =>
            current.filter(({ id }) => id !== radarrId)
          );

          return res.status(200).json(redactSecrets(removed));
        }
      );
    }
  )
);

export default radarrRoutes;
