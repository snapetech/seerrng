import SportarrAPI from '@server/api/servarr/sportarr';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceCollectionMutationAdmission } from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import { getSettings, type SportarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseServarrConnectionSettings,
  parseSportarrSettings,
  preserveServarrApiKey,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import { Router } from 'express';

const sportarrRoutes = Router();

sportarrRoutes.get('/', (_req, res) => {
  res.status(200).json(redactSecrets(getSettings().sportarr));
});

sportarrRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseSportarrSettings(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sportarr',
      async () => {
        const historicalServiceIdMaximum =
          await getHistoricalServarrServiceIdMaximum('sportarr');
        const sportarr = await settings.persistSection(
          'sportarr',
          (current) => {
            assertServarrInstanceCapacity(current);
            const created: SportarrSettings = {
              ...parsed.value,
              isDefault: current.length === 0 || parsed.value.isDefault,
              id: allocateServarrServiceId(
                current.map(({ id }) => id),
                historicalServiceIdMaximum
              ),
            };
            return [
              ...current.map((instance) =>
                created.isDefault ? { ...instance, isDefault: false } : instance
              ),
              created,
            ];
          }
        );

        return res
          .status(201)
          .json(redactSecrets(sportarr[sportarr.length - 1]));
      }
    );
  })
);

sportarrRoutes.post<
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
      const parsed = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(
          req.body,
          getExternalRuntimeConfig().sportarr
        )
      );
      if ('error' in parsed) {
        return res.status(400).json({ message: parsed.error });
      }

      const api = new SportarrAPI({
        apiKey: parsed.value.apiKey,
        url: SportarrAPI.buildUrl(parsed.value, '/api'),
      });
      const systemStatus = await api.getSportarrSystemStatus();
      if (
        systemStatus.appName &&
        systemStatus.appName.trim().toLowerCase() !== 'sportarr'
      ) {
        return res.status(422).json({
          message:
            'This connection is not a Sportarr server. Check the address and API key.',
        });
      }

      // Sportarr's stable connection probe is an authenticated native-library
      // read. This also validates the API key on versions that omit appName.
      await api.getLibraryLeagues();

      return res.status(200).json({
        profiles: await api.getQualityProfiles(),
        urlBase: systemStatus.urlBase,
      });
    } catch (error) {
      logger.error('Failed to test Sportarr', {
        label: 'Sportarr',
        message: error instanceof Error ? error.message : String(error),
      });
      return next({ status: 502, message: 'Failed to connect to Sportarr' });
    }
  })
);

sportarrRoutes.put<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const id = parseNonNegativeRouteId(req.params.id);
    const current = settings.sportarr.find((instance) => instance.id === id);
    if (id === undefined || !current) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    const parsed = parseSportarrSettings(
      preserveServarrApiKey(req.body, current),
      current
    );
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sportarr',
      async () => {
        const saved = await settings.persistSection('sportarr', (instances) => {
          const otherDefault = instances.some(
            (instance) => instance.id !== id && instance.isDefault
          );
          const isDefault =
            parsed.value.isDefault || (current.isDefault && !otherDefault);
          return instances.map((instance) => {
            if (instance.id === id) {
              return {
                ...parsed.value,
                apiKey:
                  (req.body as { apiKey?: unknown }).apiKey === REDACTED_SECRET
                    ? instance.apiKey
                    : parsed.value.apiKey,
                id,
                isDefault,
              };
            }
            return isDefault ? { ...instance, isDefault: false } : instance;
          });
        });

        return res
          .status(200)
          .json(redactSecrets(saved.find((instance) => instance.id === id)));
      }
    );
  })
);

sportarrRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const id = parseNonNegativeRouteId(req.params.id);
    const current = settings.sportarr.find((instance) => instance.id === id);
    if (id === undefined || !current) {
      return res
        .status(404)
        .json({ status: 404, message: 'Settings instance not found' });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'sportarr',
      async () => {
        await assertServarrServiceCanBeRemoved('sportarr', id);
        await settings.persistSection('sportarr', (instances) => {
          const remaining = instances.filter((instance) => instance.id !== id);
          if (
            remaining.length &&
            !remaining.some((instance) => instance.isDefault)
          ) {
            remaining[0] = { ...remaining[0], isDefault: true };
          }
          return remaining;
        });
        return res.status(200).json(redactSecrets(current));
      }
    );
  })
);

export default sportarrRoutes;
