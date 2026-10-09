import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { defaultTunerrSettings } from '@server/lib/settings';
import settingsRoutes from '@server/routes/settings';
import {
  parseTunerrSettings,
  tunerrSettingsView,
} from '@server/routes/settings/tunerr';
import { setupTestDb } from '@server/test/db';
import { REDACTED_SECRET } from '@server/utils/security';
import express from 'express';
import request from 'supertest';

setupTestDb();

const createApp = (permissions = Permission.ADMIN) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = new User({ id: 1, permissions });
    next();
  });
  app.use('/settings', settingsRoutes);
  return app;
};

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

  it('normalizes a safe optional address for Sportarr and accepts older settings', () => {
    const oldSettings = {
      ...current,
      sportarrBaseUrl: undefined,
    } as unknown as typeof current;
    const older = parseTunerrSettings(
      { enabled: true, hostname: 'tunerr' },
      oldSettings
    );
    assert.ok('value' in older);
    assert.equal(older.value.sportarrBaseUrl, '');

    const parsed = parseTunerrSettings(
      { sportarrBaseUrl: 'https://tunerr.local:5004/proxy/' },
      current
    );
    assert.ok('value' in parsed);
    assert.equal(
      parsed.value.sportarrBaseUrl,
      'https://tunerr.local:5004/proxy'
    );
  });

  it('rejects invalid values', () => {
    for (const value of [
      { deckPort: 0 },
      { tunerPort: 70_000 },
      { guideUrl: 'ftp://guide' },
      { guideUrl: 'http://user:pass@guide/guide.xml' },
      { guideUrl: 'http://guide/guide.xml#fragment' },
      { sportarrBaseUrl: 'ftp://tunerr.local' },
      { sportarrBaseUrl: 'http://user:pass@tunerr.local' },
      { sportarrBaseUrl: 'http://tunerr.local?token=secret' },
      { sportarrBaseUrl: 'http://tunerr.local/#fragment' },
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

describe('Tunerr-to-Sportarr settings routes', () => {
  beforeEach(async () => {
    await getRepository(User).update(1, { permissions: Permission.ADMIN });
  });

  it('requires an administrator for status and setup actions', async () => {
    await getRepository(User).update(1, { permissions: Permission.REQUEST });
    const app = createApp(Permission.REQUEST);
    const status = await request(app).get('/settings/tunerr/sportarr');
    const connect = await request(app).post(
      '/settings/tunerr/sportarr/connect'
    );

    assert.equal(status.status, 403);
    assert.equal(connect.status, 403);
  });

  it('keeps the integration optional when neither service is configured', async () => {
    const response = await request(createApp()).get(
      '/settings/tunerr/sportarr'
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      tunerr: {
        configured: false,
        sportsAutomation: 'unavailable',
      },
      sportarr: {
        configured: false,
        reachable: null,
        feeds: { linked: false },
      },
    });
  });
});
