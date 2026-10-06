import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LiveDownloadSettings } from '@server/lib/settings';
import { parseLiveDownloadIds } from '@server/routes/live';
import {
  liveDownloadSettingsView,
  MAX_DOWNLOAD_CLIENTS,
  parseLiveDownloadSettings,
} from '@server/routes/settings/downloadClients';
import { REDACTED_SECRET } from '@server/utils/security';

const current: LiveDownloadSettings = {
  pollIntervalSeconds: 3,
  clients: [
    {
      id: 4,
      name: 'qBit',
      type: 'qbittorrent',
      enabled: true,
      hostname: 'qbittorrent',
      port: 8080,
      useSsl: false,
      baseUrl: '',
      username: 'admin',
      password: 'saved-secret',
    },
  ],
};

describe('parseLiveDownloadSettings', () => {
  it('keeps a saved password when the redacted value is sent back', () => {
    const view = liveDownloadSettingsView(current);
    assert.equal(view.clients[0].password, REDACTED_SECRET);

    const parsed = parseLiveDownloadSettings(view, current);
    assert.ok('value' in parsed);
    assert.equal(parsed.value.clients[0].password, 'saved-secret');
    assert.equal(parsed.value.clients[0].id, 4);
  });

  it('does not let a new client borrow another client password', () => {
    const parsed = parseLiveDownloadSettings(
      {
        clients: [
          {
            name: 'New',
            type: 'transmission',
            hostname: 'transmission',
            password: REDACTED_SECRET,
          },
        ],
      },
      current
    );
    assert.ok('value' in parsed);
    assert.equal(parsed.value.clients[0].password, '');
    assert.equal(parsed.value.clients[0].id, 5);
    assert.equal(parsed.value.clients[0].port, 9091);
  });

  it('clears a password on request and drops usernames for token clients', () => {
    const parsed = parseLiveDownloadSettings(
      {
        clients: [
          {
            ...current.clients[0],
            type: 'torrentng',
            clearPassword: true,
          },
        ],
      },
      current
    );
    assert.ok('value' in parsed);
    assert.equal(parsed.value.clients[0].password, '');
    assert.equal(parsed.value.clients[0].username, '');
  });

  it('rejects invalid input', () => {
    const cases: unknown[] = [
      { pollIntervalSeconds: 0 },
      { pollIntervalSeconds: 61 },
      { clients: [{ name: 'x', type: 'utorrent', hostname: 'h' }] },
      { clients: [{ name: 'x', type: 'deluge', hostname: 'http://h' }] },
      { clients: [{ name: 'x', type: 'deluge', hostname: 'h', port: 0 }] },
      { clients: [{ name: '', type: 'deluge', hostname: 'h' }] },
      {
        clients: Array.from({ length: MAX_DOWNLOAD_CLIENTS + 1 }, () => ({
          name: 'x',
          type: 'deluge',
          hostname: 'h',
        })),
      },
    ];
    for (const value of cases) {
      assert.ok(
        'error' in parseLiveDownloadSettings(value, current),
        JSON.stringify(value).slice(0, 80)
      );
    }
  });
});

describe('parseLiveDownloadIds', () => {
  it('keeps unique torrent hashes and drops other IDs', () => {
    const hash = 'A'.repeat(40);
    assert.deepEqual(
      parseLiveDownloadIds(`${hash},${hash.toLowerCase()},SABnzbd_nzo_1,,zz`),
      [hash.toLowerCase()]
    );
    assert.deepEqual(parseLiveDownloadIds(undefined), []);
    assert.deepEqual(parseLiveDownloadIds(['a']), []);
  });

  it('caps the number of hashes per stream', () => {
    const ids = Array.from({ length: 150 }, (_, index) =>
      index.toString(16).padStart(40, '0')
    ).join(',');
    assert.equal(parseLiveDownloadIds(ids).length, 100);
  });
});
