import SlskdnAPI, { SlskdnError } from '@server/api/slskdn';
import { Permission } from '@server/lib/permissions';
import { getSettings, type SlskdnSettings } from '@server/lib/settings';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { REDACTED_SECRET } from '@server/utils/security';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import { Router } from 'express';

type ParseResult<T> = { value: T } | { error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const parseSlskdnSettings = (
  value: unknown,
  current: SlskdnSettings
): ParseResult<SlskdnSettings> => {
  if (!isRecord(value)) return { error: 'slskdN settings must be an object.' };

  const enabled = value.enabled ?? current.enabled;
  if (typeof enabled !== 'boolean') {
    return { error: 'Enabled must be true or false.' };
  }

  const hostnameValue = value.hostname ?? current.hostname;
  const hostname =
    typeof hostnameValue === 'string' && hostnameValue.length <= 255
      ? normalizeServiceHostname(hostnameValue)
      : '';
  if (hostnameValue !== '' && !hostname) {
    return { error: 'slskdN hostname is invalid.' };
  }

  const port = value.port ?? current.port;
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return { error: 'Port must be between 1 and 65535.' };
  }

  const useSsl = value.useSsl ?? current.useSsl;
  if (typeof useSsl !== 'boolean') {
    return { error: 'HTTPS setting must be true or false.' };
  }

  const baseUrlValue = value.baseUrl ?? current.baseUrl;
  if (typeof baseUrlValue !== 'string' || baseUrlValue.length > 512) {
    return { error: 'URL base is invalid.' };
  }
  const baseUrl = normalizeUrlBase(baseUrlValue);
  if (baseUrlValue.trim() !== '' && !baseUrl) {
    return { error: 'URL base is invalid.' };
  }

  const searchFilter = value.searchFilter ?? current.searchFilter;
  if (
    typeof searchFilter !== 'string' ||
    searchFilter.length > 512 ||
    /[\r\n\0]/.test(searchFilter)
  ) {
    return { error: 'Search filter is invalid.' };
  }

  let apiKey = current.apiKey;
  if (value.clearApiKey === true) {
    apiKey = '';
  } else if (
    typeof value.apiKey === 'string' &&
    value.apiKey !== REDACTED_SECRET &&
    value.apiKey !== ''
  ) {
    apiKey = value.apiKey;
  } else if (value.apiKey !== undefined && typeof value.apiKey !== 'string') {
    return { error: 'API key is invalid.' };
  }
  if (apiKey.length > 2048 || /[\r\n\0]/.test(apiKey)) {
    return { error: 'API key is invalid.' };
  }

  if (enabled && (!hostname || !apiKey)) {
    return { error: 'Enter the slskdN hostname and API key before enabling.' };
  }

  return {
    value: {
      enabled,
      hostname,
      port,
      useSsl,
      baseUrl,
      apiKey,
      searchFilter: searchFilter.trim(),
    },
  };
};

export const slskdnSettingsView = (settings: SlskdnSettings) => ({
  ...settings,
  apiKey: settings.apiKey ? REDACTED_SECRET : '',
  apiKeyConfigured: Boolean(settings.apiKey),
});

const slskdnRoutes = Router();

slskdnRoutes.get('/', (_req, res) => {
  res.status(200).json(slskdnSettingsView(getSettings().slskdn));
});

slskdnRoutes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseSlskdnSettings(req.body, settings.slskdn);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const saved = await settings.persistSection('slskdn', (current) => {
        const locked = parseSlskdnSettings(req.body, current);
        if ('error' in locked) throw new Error(locked.error);
        return locked.value;
      });
      return res.status(200).json(slskdnSettingsView(saved));
    } catch {
      return res
        .status(500)
        .json({ error: 'slskdN settings could not be saved.' });
    }
  })
);

slskdnRoutes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseSlskdnSettings(
      { ...(isRecord(req.body) ? req.body : {}), enabled: false },
      getSettings().slskdn
    );
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    if (!parsed.value.hostname || !parsed.value.apiKey) {
      return res
        .status(400)
        .json({ error: 'Enter the slskdN hostname and API key.' });
    }
    const api = new SlskdnAPI(parsed.value);
    try {
      const version = await api.getVersion();
      const features = await api.getFeatures();
      return res.status(200).json({ success: true, version, features });
    } catch (error) {
      return res.status(502).json({
        success: false,
        error:
          error instanceof SlskdnError
            ? error.message
            : 'slskdN could not be reached.',
      });
    }
  })
);

export default slskdnRoutes;
