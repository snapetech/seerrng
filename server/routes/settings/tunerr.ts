import TunerrAPI, { TunerrError } from '@server/api/tunerr';
import { guideIndex } from '@server/lib/liveTv/guideIndex';
import { Permission } from '@server/lib/permissions';
import { getSettings, type TunerrSettings } from '@server/lib/settings';
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

const port = (
  value: unknown,
  fallback: number,
  label: string
): ParseResult<number> => {
  const candidate = value ?? fallback;
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 1 &&
    candidate <= 65_535
    ? { value: candidate }
    : { error: `${label} must be between 1 and 65535.` };
};

export const parseTunerrSettings = (
  value: unknown,
  current: TunerrSettings
): ParseResult<TunerrSettings> => {
  if (!isRecord(value)) {
    return { error: 'Tunerr settings must be an object.' };
  }

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
    return { error: 'Tunerr hostname is invalid.' };
  }
  if (enabled && !hostname) {
    return { error: 'Enter the Tunerr hostname before enabling Live TV.' };
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

  const deckPort = port(value.deckPort, current.deckPort, 'Deck port');
  if ('error' in deckPort) return deckPort;
  const tunerPort = port(value.tunerPort, current.tunerPort, 'Tuner port');
  if ('error' in tunerPort) return tunerPort;

  const guideUrl = value.guideUrl ?? current.guideUrl;
  if (typeof guideUrl !== 'string' || guideUrl.length > 2048) {
    return { error: 'Guide URL is invalid.' };
  }
  if (guideUrl.trim()) {
    try {
      const parsed = new URL(guideUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return { error: 'Guide URL must be an http or https address.' };
    }
  }

  const guideHours = value.guideHours ?? current.guideHours;
  if (
    typeof guideHours !== 'number' ||
    !Number.isInteger(guideHours) ||
    guideHours < 6 ||
    guideHours > 336
  ) {
    return { error: 'Guide window must be 6–336 hours.' };
  }

  const username = value.username ?? current.username;
  if (
    typeof username !== 'string' ||
    username.length > 256 ||
    /[\r\n\0:]/.test(username)
  ) {
    return { error: 'Deck username is invalid.' };
  }

  let password = current.password;
  if (value.clearPassword === true) {
    password = '';
  } else if (
    typeof value.password === 'string' &&
    value.password !== REDACTED_SECRET &&
    value.password !== ''
  ) {
    password = value.password;
  } else if (
    value.password !== undefined &&
    typeof value.password !== 'string'
  ) {
    return { error: 'Deck password is invalid.' };
  }
  if (password.length > 2048 || /[\r\n\0]/.test(password)) {
    return { error: 'Deck password is invalid.' };
  }

  return {
    value: {
      enabled,
      hostname,
      useSsl,
      baseUrl,
      deckPort: deckPort.value,
      tunerPort: tunerPort.value,
      guideUrl: guideUrl.trim(),
      username,
      password,
      guideHours,
    },
  };
};

export const tunerrSettingsView = (settings: TunerrSettings) => ({
  ...settings,
  password: settings.password ? REDACTED_SECRET : '',
  passwordConfigured: Boolean(settings.password),
});

const tunerrRoutes = Router();

tunerrRoutes.get('/', (_req, res) => {
  res.status(200).json(tunerrSettingsView(getSettings().tunerr));
});

tunerrRoutes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseTunerrSettings(req.body, settings.tunerr);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const saved = await settings.persistSection('tunerr', (current) => {
        const locked = parseTunerrSettings(req.body, current);
        if ('error' in locked) throw new Error(locked.error);
        return locked.value;
      });
      guideIndex.clear();
      return res.status(200).json(tunerrSettingsView(saved));
    } catch {
      return res
        .status(500)
        .json({ error: 'Tunerr settings could not be saved.' });
    }
  })
);

tunerrRoutes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseTunerrSettings(
      { ...(isRecord(req.body) ? req.body : {}), enabled: true },
      getSettings().tunerr
    );
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const api = new TunerrAPI(parsed.value);
    const result: {
      deck: boolean;
      missingFeatures: string[];
      guide: boolean;
      error?: string;
      guideError?: string;
    } = { deck: false, missingFeatures: [], guide: false };

    try {
      const ruleset = await api.getRules();
      result.deck = true;
      result.missingFeatures = api.missingFeatures(ruleset);
    } catch (error) {
      result.error =
        error instanceof TunerrError
          ? error.message
          : 'The Tunerr deck could not be reached. Check the hostname and deck port.';
    }

    try {
      const stream = await api.openGuide();
      stream.destroy();
      result.guide = true;
    } catch (error) {
      result.guideError =
        error instanceof TunerrError
          ? error.message
          : 'The Tunerr guide could not be reached. Check the tuner port or guide URL.';
    }

    return res.status(result.deck && result.guide ? 200 : 502).json(result);
  })
);

export default tunerrRoutes;
