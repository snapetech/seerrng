import SonarrAPI from '@server/api/servarr/sonarr';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceCollectionMutationAdmission } from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  assertServarrServiceCanChangeKind,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseServarrConnectionSettings,
  parseSonarrSettings,
  preserveServarrApiKey,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import { Router } from 'express';

const sonarrRoutes = Router();

sonarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.sonarr));
});

sonarrRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();

    const parsedSonarr = parseSonarrSettings(req.body);

    if ('error' in parsedSonarr) {
      return res.status(400).json({ message: parsedSonarr.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sonarr',
      async () => {
        const historicalServiceIdMaximum =
          await getHistoricalServarrServiceIdMaximum('sonarr');
        const sonarr = await settings.persistSection('sonarr', (current) => {
          assertServarrInstanceCapacity(current);
          const newSonarr = {
            ...parsedSonarr.value,
            id: allocateServarrServiceId(
              current.map(({ id }) => id),
              historicalServiceIdMaximum
            ),
          };
          const existing = newSonarr.isDefault
            ? current.map((instance) => ({
                ...instance,
                isDefault:
                  instance.is4k === newSonarr.is4k ? false : instance.isDefault,
              }))
            : current;
          return [...existing, newSonarr];
        });
        const newSonarr = sonarr[sonarr.length - 1];

        return res.status(201).json(redactSecrets(newSonarr));
      }
    );
  })
);

sonarrRoutes.post<
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
      const parsedSonarr = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(req.body, getSettings().sonarr)
      );

      if ('error' in parsedSonarr) {
        return res.status(400).json({ message: parsedSonarr.error });
      }

      const sonarr = new SonarrAPI({
        apiKey: parsedSonarr.value.apiKey,
        url: SonarrAPI.buildUrl(parsedSonarr.value, '/api/v3'),
      });

      const systemStatus = await sonarr.getSystemStatus();
      const sonarrMajorVersion = Number(systemStatus.version.split('.')[0]);

      const urlBase = systemStatus.urlBase;
      const profiles = await sonarr.getProfiles();
      const folders = await sonarr.getRootFolders();
      const languageProfiles =
        sonarrMajorVersion <= 3 ? await sonarr.getLanguageProfiles() : null;
      const tags = await sonarr.getTags();

      return res.status(200).json({
        profiles,
        rootFolders: folders.map((folder) => ({
          id: folder.id,
          path: folder.path,
        })),
        languageProfiles,
        tags,
        urlBase,
      });
    } catch (e) {
      logger.error('Failed to test Sonarr', {
        label: 'Sonarr',
        message: e.message,
      });

      next({ status: 500, message: 'Failed to connect to Sonarr' });
    }
  })
);

sonarrRoutes.put<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const sonarrId = parseNonNegativeRouteId(req.params.id);
    if (sonarrId === undefined) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    const sonarrIndex = settings.sonarr.findIndex((r) => r.id === sonarrId);

    if (sonarrIndex === -1) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sonarr',
      async () => {
        const currentSonarr = settings.sonarr.find(
          (instance) => instance.id === sonarrId
        );
        if (!currentSonarr) {
          return res
            .status(404)
            .json({ status: 404, message: 'Settings instance not found' });
        }
        const admittedSonarr = parseSonarrSettings(
          preserveServarrApiKey(req.body, currentSonarr),
          currentSonarr
        );
        if ('error' in admittedSonarr) {
          return res.status(400).json({ message: admittedSonarr.error });
        }
        if (currentSonarr.is4k !== admittedSonarr.value.is4k) {
          await assertServarrServiceCanChangeKind('sonarr', sonarrId);
        }
        const sonarr = await settings.persistSection('sonarr', (current) =>
          current.map((instance) => {
            if (instance.id === sonarrId) {
              return {
                ...admittedSonarr.value,
                apiKey:
                  (req.body as { apiKey?: unknown }).apiKey === REDACTED_SECRET
                    ? instance.apiKey
                    : admittedSonarr.value.apiKey,
                id: sonarrId,
              } as SonarrSettings;
            }
            return admittedSonarr.value.isDefault &&
              instance.is4k === admittedSonarr.value.is4k
              ? { ...instance, isDefault: false }
              : instance;
          })
        );

        return res
          .status(200)
          .json(redactSecrets(sonarr.find(({ id }) => id === sonarrId)));
      }
    );
  })
);

sonarrRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const sonarrId = parseNonNegativeRouteId(req.params.id);
    if (sonarrId === undefined) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    const sonarrIndex = settings.sonarr.findIndex((r) => r.id === sonarrId);

    if (sonarrIndex === -1) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sonarr',
      async () => {
        const removed = settings.sonarr.find(
          (instance) => instance.id === sonarrId
        );
        if (!removed) {
          return res
            .status(404)
            .json({ status: 404, message: 'Settings instance not found' });
        }
        await assertServarrServiceCanBeRemoved('sonarr', sonarrId);
        await settings.persistSection('sonarr', (current) =>
          current.filter(({ id }) => id !== sonarrId)
        );

        return res.status(200).json(redactSecrets(removed));
      }
    );
  })
);

export default sonarrRoutes;
