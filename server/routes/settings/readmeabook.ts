import ReadMeABookAPI from '@server/api/readmeabook';
import { Permission } from '@server/lib/permissions';
import { getSettings, type ReadMeABookSettings } from '@server/lib/settings';
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

export const parseReadMeABookSettings = (
  value: unknown,
  current: ReadMeABookSettings
): ParseResult<ReadMeABookSettings> => {
  if (!isRecord(value))
    return { error: 'ReadMeABook settings must be an object.' };
  const enabled = value.enabled ?? current.enabled;
  const useSsl = value.useSsl ?? current.useSsl;
  if (typeof enabled !== 'boolean' || typeof useSsl !== 'boolean') {
    return { error: 'Enabled and HTTPS must be true or false.' };
  }
  const hostnameInput = value.hostname ?? current.hostname;
  const hostname =
    typeof hostnameInput === 'string' && hostnameInput.length <= 255
      ? normalizeServiceHostname(hostnameInput)
      : '';
  if (hostnameInput !== '' && !hostname) {
    return { error: 'ReadMeABook hostname is invalid.' };
  }
  if (enabled && !hostname) {
    return { error: 'Enter the ReadMeABook hostname before enabling it.' };
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
  const baseUrlInput = value.baseUrl ?? current.baseUrl;
  if (typeof baseUrlInput !== 'string' || baseUrlInput.length > 512) {
    return { error: 'URL base is invalid.' };
  }
  const baseUrl = normalizeUrlBase(baseUrlInput);
  if (baseUrlInput.trim() && !baseUrl) return { error: 'URL base is invalid.' };

  let apiKey = current.apiKey;
  if (value.clearApiKey === true) apiKey = '';
  else if (
    typeof value.apiKey === 'string' &&
    value.apiKey !== REDACTED_SECRET &&
    value.apiKey !== ''
  ) {
    apiKey = value.apiKey;
  } else if (value.apiKey !== undefined && typeof value.apiKey !== 'string') {
    return { error: 'ReadMeABook API token is invalid.' };
  }
  if (apiKey.length > 4096 || /[\r\n\0]/.test(apiKey)) {
    return { error: 'ReadMeABook API token is invalid.' };
  }
  if (enabled && !apiKey)
    return { error: 'Enter the ReadMeABook API token before enabling it.' };
  return { value: { enabled, hostname, port, useSsl, baseUrl, apiKey } };
};

export const readMeABookSettingsView = (settings: ReadMeABookSettings) => ({
  ...settings,
  apiKey: settings.apiKey ? REDACTED_SECRET : '',
  apiKeyConfigured: Boolean(settings.apiKey),
});

const routes = Router();
routes.get('/', (_req, res) =>
  res.status(200).json(readMeABookSettingsView(getSettings().readmeabook))
);
routes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseReadMeABookSettings(req.body, settings.readmeabook);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const saved = await settings.persistSection('readmeabook', (current) => {
        const locked = parseReadMeABookSettings(req.body, current);
        if ('error' in locked) throw new Error(locked.error);
        return locked.value;
      });
      return res.status(200).json(readMeABookSettingsView(saved));
    } catch {
      return res
        .status(500)
        .json({ error: 'ReadMeABook settings could not be saved.' });
    }
  })
);
routes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseReadMeABookSettings(
      { ...(isRecord(req.body) ? req.body : {}), enabled: true },
      getSettings().readmeabook
    );
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      await new ReadMeABookAPI(parsed.value).listRequests();
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : 'ReadMeABook could not be reached.',
      });
    }
  })
);

export default routes;
