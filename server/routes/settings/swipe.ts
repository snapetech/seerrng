import Anthropic from '@anthropic-ai/sdk';
import { Permission } from '@server/lib/permissions';
import {
  DEFAULT_SWIPE_AI_MODEL,
  getSettings,
  type SwipeSettings,
} from '@server/lib/settings';
import { clearSwipeDecks } from '@server/lib/swipe/deck';
import { testClaudeConnection } from '@server/lib/swipe/ranking';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { REDACTED_SECRET } from '@server/utils/security';
import { Router } from 'express';

type ParseResult<T> = { value: T } | { error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const parseSwipeSettings = (
  value: unknown,
  current: SwipeSettings
): ParseResult<SwipeSettings> => {
  if (!isRecord(value)) return { error: 'Swipe settings must be an object.' };

  const enabled = value.enabled ?? current.enabled;
  if (typeof enabled !== 'boolean') {
    return { error: 'Enabled must be true or false.' };
  }
  const aiProvider = value.aiProvider ?? current.aiProvider;
  if (aiProvider !== 'none' && aiProvider !== 'anthropic') {
    return { error: 'Choose a supported AI provider.' };
  }
  const aiModel = value.aiModel === undefined ? current.aiModel : value.aiModel;
  if (
    typeof aiModel !== 'string' ||
    aiModel.length > 100 ||
    !/^[a-z0-9][a-z0-9.\-:@]*$/i.test(aiModel || DEFAULT_SWIPE_AI_MODEL)
  ) {
    return { error: 'AI model ID is invalid.' };
  }
  const aiEffort = value.aiEffort ?? current.aiEffort;
  if (aiEffort !== 'low' && aiEffort !== 'medium' && aiEffort !== 'high') {
    return { error: 'Effort must be low, medium, or high.' };
  }

  let aiApiKey = current.aiApiKey;
  if (value.clearAiApiKey === true) {
    aiApiKey = '';
  } else if (
    typeof value.aiApiKey === 'string' &&
    value.aiApiKey !== REDACTED_SECRET &&
    value.aiApiKey !== ''
  ) {
    aiApiKey = value.aiApiKey.trim();
  } else if (
    value.aiApiKey !== undefined &&
    typeof value.aiApiKey !== 'string'
  ) {
    return { error: 'API key is invalid.' };
  }
  if (aiApiKey.length > 512 || /[\s\0]/.test(aiApiKey)) {
    return { error: 'API key is invalid.' };
  }
  if (aiProvider === 'anthropic' && !aiApiKey) {
    return { error: 'Enter an Anthropic API key to use AI ranking.' };
  }

  return {
    value: {
      enabled,
      aiProvider,
      aiApiKey,
      aiModel: aiModel.trim() || DEFAULT_SWIPE_AI_MODEL,
      aiEffort,
    },
  };
};

export const swipeSettingsView = (settings: SwipeSettings) => ({
  ...settings,
  aiApiKey: settings.aiApiKey ? REDACTED_SECRET : '',
  aiApiKeyConfigured: Boolean(settings.aiApiKey),
});

const swipeSettingsRoutes = Router();

swipeSettingsRoutes.get('/', (_req, res) => {
  res.status(200).json(swipeSettingsView(getSettings().swipe));
});

swipeSettingsRoutes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseSwipeSettings(req.body, settings.swipe);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const saved = await settings.persistSection('swipe', (current) => {
        const locked = parseSwipeSettings(req.body, current);
        if ('error' in locked) throw new Error(locked.error);
        return locked.value;
      });
      clearSwipeDecks();
      return res.status(200).json(swipeSettingsView(saved));
    } catch {
      return res
        .status(500)
        .json({ error: 'Swipe settings could not be saved.' });
    }
  })
);

swipeSettingsRoutes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseSwipeSettings(
      { ...(isRecord(req.body) ? req.body : {}), aiProvider: 'anthropic' },
      getSettings().swipe
    );
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      await testClaudeConnection(parsed.value);
      return res.status(200).json({ success: true });
    } catch (error) {
      const message =
        error instanceof Anthropic.AuthenticationError
          ? 'Anthropic rejected the API key.'
          : error instanceof Anthropic.NotFoundError
            ? 'That model ID was not found.'
            : error instanceof Anthropic.RateLimitError
              ? 'Anthropic is rate limiting this key. Try again shortly.'
              : error instanceof Anthropic.APIError
                ? `Anthropic returned HTTP ${error.status ?? 'error'}.`
                : error instanceof Error
                  ? error.message
                  : 'The AI provider could not be reached.';
      return res.status(502).json({ success: false, error: message });
    }
  })
);

export default swipeSettingsRoutes;
