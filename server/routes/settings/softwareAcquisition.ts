import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
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
  emulationSystemGroups: settings.emulationSystemGroups,
});

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

    const candidate = {
      romarr: romarr.value,
      questarr: questarr.value,
      emulationSystemGroups: emulationSystemGroups.value,
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

    try {
      if (provider === 'romarr') {
        const api = new ROMarrNGAPI(parsed.value);
        const handshake = await api.getHandshake();
        if (handshake.apiVersion !== 1 || handshake.service !== 'ROMarrNG') {
          return res
            .status(502)
            .json({
              error: 'ROMarrNG returned an unsupported integration contract.',
            });
        }
        const platforms = await api.getPlatforms();
        return res
          .status(200)
          .json({
            success: true,
            service: handshake.service,
            platformCount: platforms.length,
          });
      }

      const api = new QuestarrNGAPI(parsed.value);
      const handshake = await api.getHandshake();
      if (
        handshake.apiVersion !== 1 ||
        handshake.requestContractVersion !== 1 ||
        handshake.service !== 'QuestarrNG'
      ) {
        return res
          .status(502)
          .json({
            error: 'QuestarrNG returned an unsupported integration contract.',
          });
      }
      return res
        .status(200)
        .json({ success: true, service: handshake.service });
    } catch {
      return res
        .status(502)
        .json({
          error: `${provider === 'romarr' ? 'ROMarrNG' : 'QuestarrNG'} connection failed.`,
        });
    }
  })
);

export default softwareAcquisitionRoutes;
