import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultSwipeSettings } from '@server/lib/settings';
import {
  parseSwipeSettings,
  swipeSettingsView,
} from '@server/routes/settings/swipe';
import { REDACTED_SECRET } from '@server/utils/security';

const current = defaultSwipeSettings();

describe('parseSwipeSettings', () => {
  it('requires a key for Anthropic and a model for OpenAI-compatible servers', () => {
    assert.ok(
      'error' in parseSwipeSettings({ aiProvider: 'anthropic' }, current)
    );
    assert.ok(
      'error' in
        parseSwipeSettings({ aiProvider: 'openai', aiModel: '' }, current)
    );
    const local = parseSwipeSettings(
      {
        aiProvider: 'openai',
        aiModel: 'llama3.1:8b',
        aiBaseUrl: 'http://ollama:11434/v1',
      },
      current
    );
    assert.ok('value' in local);
    assert.equal(local.value.aiBaseUrl, 'http://ollama:11434/v1');
  });

  it('defaults the Claude model and keeps a saved key', () => {
    const saved = parseSwipeSettings(
      { aiProvider: 'anthropic', aiApiKey: 'sk-ant', aiModel: '' },
      current
    );
    assert.ok('value' in saved);
    assert.equal(saved.value.aiModel, 'claude-opus-5-5');
    const again = parseSwipeSettings(
      swipeSettingsView(saved.value),
      saved.value
    );
    assert.ok('value' in again);
    assert.equal(again.value.aiApiKey, 'sk-ant');
    assert.equal(swipeSettingsView(saved.value).aiApiKey, REDACTED_SECRET);
  });

  it('rejects invalid values', () => {
    for (const value of [
      { aiProvider: 'gemini' },
      { aiEffort: 'max' },
      { aiBaseUrl: 'ftp://server' },
      { aiBaseUrl: 'http://user:pass@server' },
      { aiModel: 'bad model' },
    ]) {
      assert.ok(
        'error' in parseSwipeSettings(value, current),
        JSON.stringify(value)
      );
    }
  });
});
