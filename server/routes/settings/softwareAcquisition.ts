import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
import type { SoftwareProviderCapabilities } from '@server/api/software/types';
import { Permission } from '@server/lib/permissions';
import type {
  EmulationSystemGroup,
  SoftwareAcquisitionSettings,
  SoftwareProviderSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import {
  REDACTED_SECRET,
  preserveRedactedSecrets,
} from '@server/utils/security';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import axios from 'axios';
import { Router } from 'express';

const softwareAcquisitionRoutes = Router();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parseProviderSettings = (
  value: unknown,
  current: SoftwareProviderSettings,
  defaultPort: number
): { value: SoftwareProviderSettings } | { error: string } => {
  if (!isRecord(value))
    return { error: 'Provider settings must be an object.' };

  const hostnameValue = value.hostname ?? current.hostname;
  const hostname =
    typeof hostnameValue === 'string' && hostnameValue.length <= 255
      ? normalizeServiceHostname(hostnameValue)
      : '';
  if (hostnameValue !== '' && !hostname) {
    return { error: 'Provider hostname is invalid.' };
  }

  const port = value.port ?? current.port ?? defaultPort;
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return { error: 'Provider port must be between 1 and 65535.' };
  }

  const useSsl = value.useSsl ?? current.useSsl;
  if (typeof useSsl !== 'boolean') {
    return { error: 'Provider SSL setting must be a boolean.' };
  }

  const baseUrlValue = value.baseUrl ?? current.baseUrl;
  if (typeof baseUrlValue !== 'string' || baseUrlValue.length > 512) {
    return { error: 'Provider base path is invalid.' };
  }
  const baseUrl = normalizeUrlBase(baseUrlValue);
  if (baseUrlValue !== '' && !baseUrl) {
    return { error: 'Provider base path is invalid.' };
  }

  const apiKey = value.apiKey ?? current.apiKey;
  if (
    typeof apiKey !== 'string' ||
    apiKey.length > 2048 ||
    /[\r\n\0]/.test(apiKey)
  ) {
    return { error: 'Provider API key is invalid.' };
  }

  return { value: { hostname, port, useSsl, baseUrl, apiKey } };
};

const parseSystemGroups = (
  value: unknown,
  current: SoftwareAcquisitionSettings['emulationSystemGroups']
):
  | { value: SoftwareAcquisitionSettings['emulationSystemGroups'] }
  | { error: string } => {
  if (value === undefined) return { value: current };
  if (!isRecord(value) || Object.keys(value).length > 500) {
    return {
      error:
        'Emulation system groups must be an object of at most 500 systems.',
    };
  }

  const groups: Record<string, EmulationSystemGroup> = {};
  for (const [rawSlug, group] of Object.entries(value)) {
    const slug = rawSlug.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ||
      (group !== 'retro' && group !== 'modern')
    ) {
      return {
        error: 'Each system must have a valid slug and Retro or Modern group.',
      };
    }
    groups[slug] = group;
  }
  return { value: groups };
};

const settingsView = (settings: SoftwareAcquisitionSettings) => ({
  romarr: {
    ...settings.romarr,
    apiKey: settings.romarr.apiKey ? REDACTED_SECRET : '',
    apiKeyConfigured: Boolean(settings.romarr.apiKey),
  },
  questarr: {
    ...settings.questarr,
    apiKey: settings.questarr.apiKey ? REDACTED_SECRET : '',
    apiKeyConfigured: Boolean(settings.questarr.apiKey),
  },
  emulationCatalogProvider: settings.emulationCatalogProvider ?? 'questarr',
  emulationSystemGroups: settings.emulationSystemGroups,
  steamApiKey: settings.steamApiKey ? REDACTED_SECRET : '',
  steamApiKeyConfigured: Boolean(settings.steamApiKey),
});

const hasProviderCapabilities = (
  value: unknown
): value is SoftwareProviderCapabilities => {
  if (!isRecord(value) || !isRecord(value.requestActions)) return false;
  return (
    typeof value.catalog === 'boolean' &&
    typeof value.pcAcquisition === 'boolean' &&
    typeof value.emulationAcquisition === 'boolean' &&
    typeof value.requestActions.retry === 'boolean' &&
    typeof value.requestActions.cancel === 'boolean' &&
    typeof value.assetStreaming === 'boolean' &&
    (value.assetBundles === undefined ||
      typeof value.assetBundles === 'boolean') &&
    (value.datCatalog === undefined || typeof value.datCatalog === 'boolean')
  );
};

const isSupportedHandshake = (
  provider: 'romarr' | 'questarr',
  handshake: {
    service?: unknown;
    apiVersion?: unknown;
    requestContractVersion?: unknown;
    capabilities?: SoftwareProviderCapabilities;
  }
): boolean => {
  const service =
    typeof handshake.service === 'string'
      ? handshake.service.toLowerCase().replace(/[^a-z]/g, '')
      : '';
  const expectedServices =
    provider === 'romarr' ? ['romarr', 'romarrng'] : ['questarr', 'questarrng'];
  if (
    handshake.apiVersion !== 1 ||
    !expectedServices.includes(service) ||
    (handshake.requestContractVersion !== undefined &&
      handshake.requestContractVersion !== 1 &&
      handshake.requestContractVersion !== 2)
  ) {
    return false;
  }

  if (handshake.capabilities === undefined) return true;
  if (!hasProviderCapabilities(handshake.capabilities)) return false;
  const capabilities = handshake.capabilities;
  return provider === 'romarr'
    ? capabilities.emulationAcquisition === true
    : capabilities.catalog === true && capabilities.pcAcquisition === true;
};

const providerFailureMessage = (
  provider: 'romarr' | 'questarr',
  phase: 'integration handshake' | 'platform list',
  error: unknown
): string => {
  const service = provider === 'romarr' ? 'ROMarrNG' : 'QuestarrNG';
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return `${service} rejected the API key (HTTP ${status}) during the ${phase}.`;
    }
    if (status === 404) {
      return `${service} returned HTTP 404 during the ${phase}. Check the service version and base path.`;
    }
    if (typeof status === 'number') {
      return `${service} returned HTTP ${status} during the ${phase}.`;
    }
    if (error.code === 'ECONNREFUSED') {
      return `${service} refused the connection during the ${phase}. Check the hostname and port.`;
    }
    if (error.code === 'ENOTFOUND') {
      return `The ${service} hostname could not be resolved during the ${phase}.`;
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return `The connection to ${service} timed out during the ${phase}. Check its address and container network.`;
    }
  }
  return `${service} connection failed during the ${phase}. Check its address and API key.`;
};

softwareAcquisitionRoutes.get('/', (_req, res) => {
  res.status(200).json(settingsView(getSettings().softwareAcquisition));
});

softwareAcquisitionRoutes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const current = getSettings().softwareAcquisition;
    if (!isRecord(req.body)) {
      return res
        .status(400)
        .json({ error: 'Software acquisition settings must be an object.' });
    }

    const romarr = parseProviderSettings(
      req.body.romarr ?? current.romarr,
      current.romarr,
      6868
    );
    if ('error' in romarr)
      return res.status(400).json({ error: `ROMarrNG: ${romarr.error}` });
    const questarr = parseProviderSettings(
      req.body.questarr ?? current.questarr,
      current.questarr,
      3000
    );
    if ('error' in questarr)
      return res.status(400).json({ error: `QuestarrNG: ${questarr.error}` });
    const emulationSystemGroups = parseSystemGroups(
      req.body.emulationSystemGroups,
      current.emulationSystemGroups
    );
    if ('error' in emulationSystemGroups) {
      return res.status(400).json({ error: emulationSystemGroups.error });
    }
    const emulationCatalogProvider =
      req.body.emulationCatalogProvider ??
      current.emulationCatalogProvider ??
      'questarr';
    if (
      emulationCatalogProvider !== 'questarr' &&
      emulationCatalogProvider !== 'romarr'
    ) {
      return res.status(400).json({
        error: 'Emulation catalog provider must be QuestarrNG or ROMarrNG.',
      });
    }

    const steamApiKey = req.body.steamApiKey ?? current.steamApiKey ?? '';
    if (
      typeof steamApiKey !== 'string' ||
      steamApiKey.length > 2048 ||
      /[\r\n\0]/.test(steamApiKey)
    ) {
      return res.status(400).json({ error: 'Steam Web API key is invalid.' });
    }

    if (emulationCatalogProvider === 'romarr') {
      if (!romarr.value.hostname || !romarr.value.apiKey) {
        return res.status(400).json({
          error:
            'Connect ROMarrNG and confirm its IGDB catalog capability before selecting it as the emulation catalog.',
        });
      }
      try {
        const handshake = await new ROMarrNGAPI(romarr.value).getHandshake();
        if (
          !isSupportedHandshake('romarr', handshake) ||
          handshake.capabilities?.catalog !== true
        ) {
          return res.status(400).json({
            error:
              'This ROMarrNG version does not advertise the SeerrNG IGDB catalog. Keep QuestarrNG selected or upgrade ROMarrNG.',
          });
        }
      } catch {
        return res.status(400).json({
          error:
            'ROMarrNG could not be reached to confirm its IGDB catalog capability.',
        });
      }
    }

    const candidate = {
      romarr: romarr.value,
      questarr: questarr.value,
      emulationCatalogProvider,
      emulationSystemGroups: emulationSystemGroups.value,
      steamApiKey,
    };
    const settings = getSettings();
    const saved = await settings.persistSection(
      'softwareAcquisition',
      (existing) =>
        preserveRedactedSecrets(
          candidate,
          existing
        ) as SoftwareAcquisitionSettings
    );

    return res.status(200).json(settingsView(saved));
  })
);

softwareAcquisitionRoutes.post(
  '/test/:provider',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const provider = req.params.provider;
    if (provider !== 'romarr' && provider !== 'questarr') {
      return res
        .status(404)
        .json({ error: 'Unknown software acquisition provider.' });
    }
    const current = getSettings().softwareAcquisition[provider];
    const parsed = parseProviderSettings(
      req.body,
      current,
      provider === 'romarr' ? 6868 : 3000
    );
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    if (!parsed.value.hostname || !parsed.value.apiKey) {
      return res
        .status(400)
        .json({ error: 'Provider hostname and API key are required.' });
    }

    let phase: 'integration handshake' | 'platform list' =
      'integration handshake';
    try {
      if (provider === 'romarr') {
        const api = new ROMarrNGAPI(parsed.value);
        const handshake = await api.getHandshake();
        if (!isSupportedHandshake('romarr', handshake)) {
          return res.status(502).json({
            error: 'ROMarrNG returned an unsupported integration contract.',
          });
        }
        phase = 'platform list';
        const platforms = await api.getPlatforms(true);
        return res.status(200).json({
          success: true,
          service: 'ROMarrNG',
          ...(handshake.version ? { version: handshake.version } : {}),
          apiVersion: handshake.apiVersion,
          ...(handshake.requestContractVersion !== undefined
            ? { requestContractVersion: handshake.requestContractVersion }
            : {}),
          ...(handshake.capabilities
            ? { capabilities: handshake.capabilities }
            : {}),
          platformCount: platforms.length,
        });
      }

      const api = new QuestarrNGAPI(parsed.value);
      const handshake = await api.getHandshake();
      if (!isSupportedHandshake('questarr', handshake)) {
        return res.status(502).json({
          error: 'QuestarrNG returned an unsupported integration contract.',
        });
      }
      return res.status(200).json({
        success: true,
        service: 'QuestarrNG',
        ...(handshake.version ? { version: handshake.version } : {}),
        apiVersion: handshake.apiVersion,
        requestContractVersion: handshake.requestContractVersion,
        ...(handshake.capabilities
          ? { capabilities: handshake.capabilities }
          : {}),
      });
    } catch (error) {
      return res.status(502).json({
        error: providerFailureMessage(provider, phase, error),
      });
    }
  })
);

export default softwareAcquisitionRoutes;
