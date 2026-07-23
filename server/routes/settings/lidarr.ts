import LidarrAPI from '@server/api/servarr/lidarr';
import { Permission } from '@server/lib/permissions';
import {
  runWithCurrentServarrService,
  runWithServarrServiceCollectionMutationAdmission,
} from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseLidarrSettings,
  parseServarrConnectionSettings,
  preserveServarrApiKey,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import { Router } from 'express';

const lidarrRoutes = Router();

lidarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.lidarr));
});

lidarrRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();

    const parsedLidarr = parseLidarrSettings(req.body);

    if ('error' in parsedLidarr) {
      return res.status(400).json({ message: parsedLidarr.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'lidarr',
      async () => {
        const historicalServiceIdMaximum =
          await getHistoricalServarrServiceIdMaximum('lidarr');
        const lidarr = await settings.persistSection('lidarr', (current) => {
          assertServarrInstanceCapacity(current);
          const newLidarr = {
            ...parsedLidarr.value,
            id: allocateServarrServiceId(
              current.map(({ id }) => id),
              historicalServiceIdMaximum
            ),
          };
          const existing = newLidarr.isDefault
            ? current.map((instance) => ({ ...instance, isDefault: false }))
            : current;
          return [...existing, newLidarr];
        });
        const newLidarr = lidarr[lidarr.length - 1];

        return res.status(201).json(redactSecrets(newLidarr));
      }
    );
  })
);

lidarrRoutes.post<
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
      const parsedLidarr = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(req.body, getSettings().lidarr)
      );

      if ('error' in parsedLidarr) {
        return res.status(400).json({ message: parsedLidarr.error });
      }

      const lidarr = new LidarrAPI({
        apiKey: parsedLidarr.value.apiKey,
        url: LidarrAPI.buildUrl(parsedLidarr.value, '/api/v1'),
      });

      const urlBase = await lidarr
        .getSystemStatus()
        .then((value) => value.urlBase)
        .catch(() => parsedLidarr.value.baseUrl);
      const profiles = await lidarr.getProfiles();
      const metadataProfiles = await lidarr.getMetadataProfiles();
      const folders = await lidarr.getRootFolders();
      const tags = await lidarr.getTags();

      return res.status(200).json({
        profiles,
        metadataProfiles,
        rootFolders: folders.map((folder) => ({
          id: folder.id,
          path: folder.path,
        })),
        tags,
        urlBase,
      });
    } catch (e) {
      logger.error('Failed to test Lidarr', {
        label: 'Lidarr',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to connect to Lidarr' });
    }
  })
);

lidarrRoutes.put<{ id: string }, LidarrSettings, LidarrSettings>(
  '/:id',
  authorizedMutation<{ id: string }, LidarrSettings, LidarrSettings>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const lidarrId = parseNonNegativeRouteId(req.params.id);
      if (lidarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const lidarrIndex = settings.lidarr.findIndex((r) => r.id === lidarrId);

      if (lidarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'lidarr',
        async () => {
          const currentLidarr = settings.lidarr.find(
            (instance) => instance.id === lidarrId
          );
          if (!currentLidarr) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          const admittedLidarr = parseLidarrSettings(
            preserveServarrApiKey(req.body, currentLidarr),
            currentLidarr
          );
          if ('error' in admittedLidarr) {
            return next({ status: 400, message: admittedLidarr.error });
          }
          const lidarr = await settings.persistSection('lidarr', (current) =>
            current.map((instance) => {
              if (instance.id === lidarrId) {
                return {
                  ...admittedLidarr.value,
                  apiKey:
                    (req.body as { apiKey?: unknown }).apiKey ===
                    REDACTED_SECRET
                      ? instance.apiKey
                      : admittedLidarr.value.apiKey,
                  id: lidarrId,
                } as LidarrSettings;
              }
              return admittedLidarr.value.isDefault
                ? { ...instance, isDefault: false }
                : instance;
            })
          );

          return res
            .status(200)
            .json(redactSecrets(lidarr.find(({ id }) => id === lidarrId)));
        }
      );
    }
  )
);

lidarrRoutes.get<{ id: string }>(
  '/:id/profiles',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const lidarrId = parseNonNegativeRouteId(req.params.id);
      if (lidarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const profiles = await runWithCurrentServarrService(
        'lidarr',
        lidarrId,
        async (lidarrSettings) =>
          new LidarrAPI({
            apiKey: lidarrSettings.apiKey,
            url: LidarrAPI.buildUrl(lidarrSettings, '/api/v1'),
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

lidarrRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const settings = getSettings();
      const lidarrId = parseNonNegativeRouteId(req.params.id);
      if (lidarrId === undefined) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      const lidarrIndex = settings.lidarr.findIndex((r) => r.id === lidarrId);

      if (lidarrIndex === -1) {
        return next({ status: 404, message: 'Settings instance not found' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'lidarr',
        async () => {
          const removed = settings.lidarr.find(
            (instance) => instance.id === lidarrId
          );
          if (!removed) {
            return next({
              status: 404,
              message: 'Settings instance not found',
            });
          }
          await assertServarrServiceCanBeRemoved('lidarr', lidarrId);
          await settings.persistSection('lidarr', (current) => {
            const remaining = current.filter(({ id }) => id !== lidarrId);
            return removed.isDefault && remaining.length > 0
              ? remaining.map((instance, index) => ({
                  ...instance,
                  isDefault: index === 0,
                }))
              : remaining;
          });

          return res.status(200).json(redactSecrets(removed));
        }
      );
    }
  )
);

export default lidarrRoutes;
