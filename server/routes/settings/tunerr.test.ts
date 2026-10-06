import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultTunerrSettings } from '@server/lib/settings';
import {
  parseTunerrSettings,
  tunerrSettingsView,
} from '@server/routes/settings/tunerr';
import { REDACTED_SECRET } from '@server/utils/security';

const current = {
  ...defaultTunerrSettings(),
  enabled: true,
  hostname: 'tunerr',
  username: 'deck',
  password: 'saved',
};

describe('parseTunerrSettings', () => {
  it('keeps the saved password when the redacted value is returned', () => {
    const parsed = parseTunerrSettings(tunerrSettingsView(current), current);
    assert.ok('value' in parsed);
    assert.equal(parsed.value.password, 'saved');
  });

  it('clears the password on request', () => {
    const parsed = parseTunerrSettings({ clearPassword: true }, current);
    assert.ok('value' in parsed);
    assert.equal(parsed.value.password, '');
  });

  it('requires a hostname before Live TV is enabled', () => {
    const parsed = parseTunerrSettings(
      { enabled: true, hostname: '' },
      defaultTunerrSettings()
    );
    assert.ok('error' in parsed);
  });

  it('rejects invalid values', () => {
    for (const value of [
      { deckPort: 0 },
      { tunerPort: 70_000 },
      { guideUrl: 'ftp://guide' },
      { guideHours: 2 },
      { username: 'a:b' },
      { hostname: 'http://tunerr' },
      { baseUrl: 'https://x' },
    ]) {
      assert.ok(
        'error' in parseTunerrSettings(value, current),
        JSON.stringify(value)
      );
    }
  });

  it('redacts the password in the settings view', () => {
    const view = tunerrSettingsView(current);
    assert.equal(view.password, REDACTED_SECRET);
    assert.equal(view.passwordConfigured, true);
  });
});
