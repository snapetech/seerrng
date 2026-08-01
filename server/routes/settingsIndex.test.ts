import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI, { MAX_PLEX_SHARED_USERS } from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import { getRepository } from '@server/datasource';
import { ScheduledJobLease } from '@server/entity/ScheduledJobLease';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { initI18n } from '@server/i18n';
import {
  isTrackedJobRunning,
  scheduledJobs,
  waitForActiveJobs,
} from '@server/job/schedule';
import { runWithConfigurationAdmission } from '@server/lib/configurationAdmission';
import DiscordAgent from '@server/lib/notifications/agents/discord';
import { Permission } from '@server/lib/permissions';
import { plexFullScanner } from '@server/lib/scanners/plex';
import {
  getSettings,
  type JellyfinSettings,
  type MainSettings,
  type PlexSettings,
} from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import { scheduleJob, type Spec } from 'node-schedule';
import request from 'supertest';
import settingsRoutes, {
  MAX_PLEX_CONNECTION_PROBES,
  MAX_PLEX_CONNECTION_PROBES_PER_DEVICE,
  MAX_PLEX_SERVER_DEVICES,
  deepLogValueStrings,
  filteredMainSettings,
  parseJellyfinSettingsBody,
  parseLogMessages,
  parsePlexSettingsBody,
  preparePlexServerDevices,
} from './settings';
import { persistNotificationAgent } from './settings/notifications';

setupTestDb();

let app: Express;

function createApp(
  user: User = new User({ id: 1, permissions: Permission.ADMIN })
) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }
  app.use('/settings', settingsRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  initI18n();
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  settings.plex.libraries = [
    { id: '1', name: 'Movies', enabled: false, type: 'movie' },
  ];
  settings.jellyfin.libraries = [
    { id: '2', name: 'Shows', enabled: false, type: 'show' },
  ];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  scheduledJobs.length = 0;
  mock.restoreAll();
});

describe('Settings route input validation', () => {
  it('revalidates administrator authority before applying settings', async () => {
    const settings = getSettings();
    const originalTitle = settings.main.applicationTitle;
    const userRepository = getRepository(User);
    let revocationStarted!: () => void;
    let releaseRevocation!: () => void;
    const revocationStartedPromise = new Promise<void>((resolve) => {
      revocationStarted = resolve;
    });
    const releaseRevocationPromise = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const revocation = runUserSecurityMutation(1, async () => {
      await userRepository.update(1, { permissions: Permission.REQUEST });
      revocationStarted();
      await releaseRevocationPromise;
    });
    await revocationStartedPromise;

    const responsePromise = request(app)
      .post('/settings/main')
      .send({ applicationTitle: 'Revoked administrator change' })
      .then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseRevocation();
    await revocation;

    const response = await responsePromise;
    assert.strictEqual(response.status, 403);
    assert.strictEqual(settings.main.applicationTitle, originalTitle);
  });

  it('bounds and tolerates malformed Plex server discovery candidates', () => {
    const devices = Array.from(
      { length: MAX_PLEX_SERVER_DEVICES + 1 },
      (_, i) => ({
        name: `Server ${i}`,
        product: 'Plex Media Server',
        productVersion: '1',
        platform: 'Linux',
        platformVersion: '1',
        device: 'Server',
        clientIdentifier: `server-${i}`,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        provides: ['server'],
        owned: true,
        connection:
          i === 0
            ? (undefined as never)
            : Array.from(
                { length: MAX_PLEX_CONNECTION_PROBES_PER_DEVICE + 5 },
                (_, connectionIndex) => ({
                  protocol: 'https',
                  address: '192.0.2.1',
                  port: 32400,
                  uri:
                    connectionIndex === 0
                      ? 'not a URL'
                      : `https://server-${i}-${connectionIndex}.example.com:32400`,
                  local: true,
                })
              ),
      })
    );

    const prepared = preparePlexServerDevices(devices);

    assert.strictEqual(prepared.length, MAX_PLEX_SERVER_DEVICES);
    assert.deepStrictEqual(prepared[0].connection, []);
    assert.ok(
      prepared.every(
        (device) =>
          device.connection.length <= MAX_PLEX_CONNECTION_PROBES_PER_DEVICE
      )
    );
    assert.ok(
      prepared.reduce((total, device) => total + device.connection.length, 0) <=
        MAX_PLEX_CONNECTION_PROBES
    );
    assert.ok(
      prepared.slice(1).every((device) => device.connection.length >= 1)
    );
  });

  it('returns the API key only to administrators', () => {
    const main = { ...getSettings().main, apiKey: 'service-api-key' };
    const administrator = new User({ permissions: Permission.ADMIN });
    const ordinaryUser = new User({ permissions: Permission.REQUEST });

    assert.equal(
      filteredMainSettings(administrator, main).apiKey,
      'service-api-key'
    );
    assert.equal(filteredMainSettings(ordinaryUser, main).apiKey, undefined);
  });

  it('returns a controlled response when Jellyfin is not configured', async () => {
    const settings = getSettings();
    settings.jellyfin.ip = '';
    settings.jellyfin.apiKey = '';

    const res = await request(app).get('/settings/jellyfin/users');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Jellyfin is not configured.');
  });

  it('does not use Jellyfin credentials removed before admission', async () => {
    const settings = getSettings();
    settings.jellyfin = {
      ...settings.jellyfin,
      ip: 'jellyfin.local',
      apiKey: 'stored-key',
    };
    const getUsersMock = mock.method(
      JellyfinAPI.prototype,
      'getUsers',
      async () => ({ users: [] })
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holder = runWithConfigurationAdmission('jellyfin', async () => {
      entered();
      await held;
    });
    await enteredPromise;

    const responsePromise = request(app)
      .get('/settings/jellyfin/users')
      .then((response) => response);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    settings.jellyfin = { ...settings.jellyfin, ip: '', apiKey: '' };
    release();

    const response = await responsePromise;
    await holder;
    assert.strictEqual(response.status, 400);
    assert.strictEqual(getUsersMock.mock.callCount(), 0);
  });

  it('filters Plex users without refetching the provider user list per user', async () => {
    const settings = getSettings();
    const priorMachineId = settings.plex.machineId;
    settings.plex.machineId = 'target-machine';

    const makeUser = (id: string, hasAccess: boolean) => ({
      $: {
        id,
        title: `User ${id}`,
        username: `user-${id}`,
        email: `plex-${id}@example.com`,
        thumb: `https://example.com/${id}.png`,
      },
      Server: hasAccess
        ? [
            {
              $: {
                id: '1',
                serverId: '1',
                machineIdentifier: 'target-machine',
                name: 'Plex',
                lastSeenAt: '0',
                numLibraries: '1',
                owned: '0',
              },
            },
          ]
        : [],
    });

    const getUsersMock = mock.method(
      PlexTvAPI.prototype,
      'getUsers',
      async () =>
        ({
          MediaContainer: {
            User: [makeUser('9001', true), makeUser('9002', false)],
          },
        }) as never
    );
    const checkUserAccessMock = mock.method(
      PlexTvAPI.prototype,
      'checkUserAccess',
      async () => {
        throw new Error('must not refetch users');
      }
    );

    try {
      const administrator = new User({
        id: 1,
        permissions: Permission.ADMIN,
      });
      const res = await request(createApp(administrator)).get(
        '/settings/plex/users'
      );

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(
        res.body.map((user: { id: string }) => user.id),
        ['9001']
      );
      assert.strictEqual(getUsersMock.mock.callCount(), 1);
      assert.strictEqual(checkUserAccessMock.mock.callCount(), 0);
    } finally {
      settings.plex.machineId = priorMachineId;
    }
  });

  it('bounds Plex shared-user SQL fanout', async () => {
    const settings = getSettings();
    const priorMachineId = settings.plex.machineId;
    settings.plex.machineId = 'target-machine';

    mock.method(
      PlexTvAPI.prototype,
      'getUsers',
      async () =>
        ({
          MediaContainer: {
            User: Array.from(
              { length: MAX_PLEX_SHARED_USERS + 1 },
              (_, index) => ({
                $: {
                  id: String(20_000 + index),
                  title: `User ${index}`,
                  username: `user-${index}`,
                  email: `bounded-plex-${index}@example.com`,
                  thumb: `https://example.com/${index}.png`,
                },
                Server: [
                  {
                    $: {
                      id: '1',
                      serverId: '1',
                      machineIdentifier: 'target-machine',
                      name: 'Plex',
                      lastSeenAt: '0',
                      numLibraries: '1',
                      owned: '0',
                    },
                  },
                ],
              })
            ),
          },
        }) as never
    );

    try {
      const administrator = new User({
        id: 1,
        permissions: Permission.ADMIN,
      });
      const res = await request(createApp(administrator)).get(
        '/settings/plex/users'
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.length, MAX_PLEX_SHARED_USERS);
    } finally {
      settings.plex.machineId = priorMachineId;
    }
  });

  it('rejects malformed persisted settings bodies before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const mainRes = await request(app).post('/settings/main').send([]);
    const networkRes = await request(app).post('/settings/network').send([]);
    const tautulliRes = await request(app).post('/settings/tautulli').send([]);

    assert.strictEqual(mainRes.status, 400);
    assert.match(mainRes.body.message, /Settings body must be an object/);
    assert.strictEqual(networkRes.status, 400);
    assert.match(networkRes.body.message, /Settings body must be an object/);
    assert.strictEqual(tautulliRes.status, 400);
    assert.match(tautulliRes.body.message, /Settings body must be an object/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed main settings values before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const appUrlRes = await request(app)
      .post('/settings/main')
      .send({ applicationUrl: 'javascript:alert(1)' });
    const credentialUrlRes = await request(app)
      .post('/settings/main')
      .send({ applicationUrl: 'https://user:secret@seerr.example.com' });
    const trailingUrlRes = await request(app)
      .post('/settings/main')
      .send({ youtubeUrl: 'https://youtube.com/' });
    const boolRes = await request(app)
      .post('/settings/main')
      .send({ localLogin: 'true' });
    const emptyTitleRes = await request(app)
      .post('/settings/main')
      .send({ applicationTitle: '' });
    const malformedTagsRes = await request(app)
      .post('/settings/main')
      .send({ blocklistedTags: '123,nope' });
    const excessiveTagsRes = await request(app)
      .post('/settings/main')
      .send({
        blocklistedTags: Array.from(
          { length: 101 },
          (_, index) => index + 1
        ).join(','),
      });
    const tagsLimitRes = await request(app)
      .post('/settings/main')
      .send({ blocklistedTagsLimit: 251 });
    const permissionsRes = await request(app)
      .post('/settings/main')
      .send({ defaultPermissions: 536870912 });
    const oidcRes = await request(app)
      .post('/settings/main')
      .send({ oidcLogin: 'true' });
    const localeRes = await request(app)
      .post('/settings/main')
      .send({ locale: 'not-a-locale' });

    assert.strictEqual(appUrlRes.status, 400);
    assert.match(
      appUrlRes.body.message,
      /applicationUrl must be a valid HTTP URL/
    );
    assert.strictEqual(credentialUrlRes.status, 400);
    assert.match(
      credentialUrlRes.body.message,
      /must not contain credentials, a query, or a fragment/
    );
    assert.strictEqual(trailingUrlRes.status, 400);
    assert.match(
      trailingUrlRes.body.message,
      /youtubeUrl must not end with a slash/
    );
    assert.strictEqual(boolRes.status, 400);
    assert.match(boolRes.body.message, /localLogin must be a boolean/);
    assert.strictEqual(emptyTitleRes.status, 400);
    assert.match(emptyTitleRes.body.message, /applicationTitle is required/);
    assert.strictEqual(malformedTagsRes.status, 400);
    assert.match(
      malformedTagsRes.body.message,
      /blocklistedTags must contain at most 100 valid keyword IDs/
    );
    assert.strictEqual(excessiveTagsRes.status, 400);
    assert.match(
      excessiveTagsRes.body.message,
      /blocklistedTags must contain at most 100 valid keyword IDs/
    );
    assert.strictEqual(tagsLimitRes.status, 400);
    assert.match(
      tagsLimitRes.body.message,
      /blocklistedTagsLimit must be a valid number/
    );
    assert.strictEqual(permissionsRes.status, 400);
    assert.match(
      permissionsRes.body.message,
      /defaultPermissions must be valid/
    );
    assert.strictEqual(oidcRes.status, 400);
    assert.match(oidcRes.body.message, /oidcLogin must be a boolean/);
    assert.strictEqual(localeRes.status, 400);
    assert.match(localeRes.body.message, /locale must be a supported locale/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('serializes OIDC enablement changes with admitted callbacks', async () => {
    const settings = getSettings();
    const originalOidcLogin = settings.main.oidcLogin;
    let release!: () => void;
    let admitted!: () => void;
    const entered = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const holder = runWithConfigurationAdmission('oidc', async () => {
      admitted();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await entered;

    try {
      let settled = false;
      const mutation = request(app)
        .post('/settings/main')
        .send({ oidcLogin: !originalOidcLogin })
        .then((response) => {
          settled = true;
          return response;
        });
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.strictEqual(settled, false);
      release();
      const response = await mutation;
      await holder;

      assert.strictEqual(response.status, 200);
      assert.strictEqual(settings.main.oidcLogin, !originalOidcLogin);
    } finally {
      release?.();
      await holder;
      settings.main.oidcLogin = originalOidcLogin;
    }
  });

  it('persists explicit clearing and canonicalizes blocklisted tags', async () => {
    const settings = getSettings();
    const original = structuredClone(settings.main);
    settings.main.applicationUrl = 'https://seerr.example';
    settings.main.youtubeUrl = 'https://youtube.example';
    settings.main.blocklistedTags = '1,2';
    const saveMock = mock.method(settings, 'save', async () => undefined);

    try {
      const res = await request(app).post('/settings/main').send({
        applicationUrl: '',
        youtubeUrl: null,
        blocklistedTags: '3, 3,4',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(settings.main.applicationUrl, '');
      assert.strictEqual(settings.main.youtubeUrl, '');
      assert.strictEqual(settings.main.blocklistedTags, '3,4');

      const clearRes = await request(app)
        .post('/settings/main')
        .send({ blocklistedTags: '' });
      assert.strictEqual(clearRes.status, 200);
      assert.strictEqual(settings.main.blocklistedTags, '');
      assert.strictEqual(saveMock.mock.callCount(), 2);
    } finally {
      settings.replaceSection('main', original);
    }
  });

  it('does not mass-assign hidden or unknown settings fields', async () => {
    const settings = getSettings();
    const originalApiKey = settings.main.apiKey;
    const originalMovieQuota = settings.main.defaultQuotas.movie.quotaLimit;

    try {
      const res = await request(app)
        .post('/settings/main')
        .send({
          apiKey: 'attacker-selected-api-key',
          unexpected: 'persisted',
          defaultQuotas: {
            movie: { quotaLimit: 1, unexpected: 'persisted' },
            unexpected: { quotaLimit: 1 },
          },
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(settings.main.apiKey, originalApiKey);
      assert.strictEqual(
        (settings.main as MainSettings & { unexpected?: unknown }).unexpected,
        undefined
      );
      assert.strictEqual(
        (
          settings.main.defaultQuotas.movie as {
            unexpected?: unknown;
          }
        ).unexpected,
        undefined
      );
      assert.strictEqual(
        (
          settings.main.defaultQuotas as MainSettings['defaultQuotas'] & {
            unexpected?: unknown;
          }
        ).unexpected,
        undefined
      );
    } finally {
      settings.main.apiKey = originalApiKey;
      settings.main.defaultQuotas.movie.quotaLimit = originalMovieQuota;
    }
  });

  it('allowlists media-server connection fields', () => {
    const plex: PlexSettings = {
      name: 'Stored Plex',
      machineId: 'stored-machine',
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [{ id: '1', name: 'Movies', enabled: true, type: 'movie' }],
    };
    const parsedPlex = parsePlexSettingsBody(
      {
        ip: 'new-plex.local',
        port: 32401,
        useSsl: true,
        name: 'Injected name',
        machineId: 'injected-machine',
        libraries: [],
        unexpected: 'persisted',
      },
      plex
    );
    assert.ok('value' in parsedPlex);
    assert.strictEqual(parsedPlex.value.name, 'Stored Plex');
    assert.strictEqual(parsedPlex.value.machineId, 'stored-machine');
    assert.deepStrictEqual(parsedPlex.value.libraries, plex.libraries);
    assert.strictEqual(
      (parsedPlex.value as PlexSettings & { unexpected?: unknown }).unexpected,
      undefined
    );

    const jellyfin: JellyfinSettings = {
      name: 'Stored Jellyfin',
      ip: 'jellyfin.local',
      port: 8096,
      useSsl: false,
      libraries: [{ id: '2', name: 'Shows', enabled: true, type: 'show' }],
      serverId: 'stored-server',
      apiKey: 'stored-key',
    };
    const parsedJellyfin = parseJellyfinSettingsBody(
      {
        ip: 'new-jellyfin.local',
        port: 8097,
        useSsl: true,
        apiKey: 'new-key',
        name: 'Injected name',
        serverId: 'injected-server',
        libraries: [],
        unexpected: 'persisted',
      },
      jellyfin
    );
    assert.ok('value' in parsedJellyfin);
    assert.strictEqual(parsedJellyfin.value.name, 'Stored Jellyfin');
    assert.strictEqual(parsedJellyfin.value.serverId, 'stored-server');
    assert.deepStrictEqual(parsedJellyfin.value.libraries, jellyfin.libraries);
    assert.strictEqual(
      (parsedJellyfin.value as JellyfinSettings & { unexpected?: unknown })
        .unexpected,
      undefined
    );
  });

  it('rejects malformed media-server connection fields', () => {
    const plex = getSettings().plex;
    assert.deepStrictEqual(
      parsePlexSettingsBody({ ip: 'plex.local', port: 0 }, plex),
      { error: 'port must be a valid port.' }
    );
    assert.deepStrictEqual(
      parsePlexSettingsBody({ ip: 'plex.local', useSsl: 'true' }, plex),
      { error: 'useSsl must be a boolean.' }
    );

    const jellyfin = getSettings().jellyfin;
    assert.deepStrictEqual(
      parseJellyfinSettingsBody(
        {
          ip: 'jellyfin.local',
          apiKey: 'key',
          urlBase: 'https://attacker.test',
        },
        jellyfin
      ),
      { error: 'urlBase must be a relative URL path.' }
    );
  });

  it('does not activate rejected Tautulli connection settings in memory', async () => {
    const settings = getSettings();
    const original = {
      hostname: 'stored-tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: 'stored-key',
    };
    settings.replaceSection('tautulli', { ...original });
    mock.method(TautulliAPI.prototype, 'getInfo', async () => {
      throw new Error('Connection rejected');
    });

    const res = await request(app).post('/settings/tautulli').send({
      hostname: 'rejected-tautulli.local',
      port: 8182,
      useSsl: true,
      apiKey: 'rejected-key',
    });

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(settings.tautulli, original);
  });

  it('persists clearing a configured Tautulli connection', async () => {
    const settings = getSettings();
    settings.tautulli = {
      hostname: 'stored-tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: 'stored-key',
    };
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const res = await request(app).post('/settings/tautulli').send({
      hostname: '',
      port: 8181,
      useSsl: false,
      urlBase: '',
      apiKey: '',
      externalUrl: '',
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(settings.tautulli.hostname, '');
    assert.strictEqual(settings.tautulli.apiKey, '');
    assert.strictEqual(saveMock.mock.callCount(), 1);
  });

  it('restores redacted Tautulli credentials only after admission', async () => {
    const settings = getSettings();
    settings.tautulli = {
      hostname: 'tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: 'initial-key',
    };
    mock.method(TautulliAPI.prototype, 'getInfo', async () => ({
      tautulli_version: '2.15.0',
    }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holder = runWithConfigurationAdmission('tautulli', async () => {
      entered();
      await held;
    });
    await enteredPromise;

    const responsePromise = request(app)
      .post('/settings/tautulli')
      .send({
        hostname: 'tautulli.local',
        port: 8181,
        useSsl: false,
        apiKey: '[REDACTED]',
      })
      .then((response) => response);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    settings.tautulli = { ...settings.tautulli, apiKey: 'rotated-key' };
    release();

    const response = await responsePromise;
    await holder;
    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.tautulli.apiKey, 'rotated-key');
  });

  it('restores redacted Jellyfin credentials only after admission', async () => {
    const settings = getSettings();
    settings.jellyfin = {
      ...settings.jellyfin,
      name: 'Jellyfin',
      ip: 'jellyfin.local',
      port: 8096,
      useSsl: false,
      serverId: 'server-id',
      apiKey: 'initial-key',
    };
    mock.method(JellyfinAPI.prototype, 'getSystemInfo', async () => ({
      Id: 'server-id',
      ServerName: 'Jellyfin',
    }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holder = runWithConfigurationAdmission('jellyfin', async () => {
      entered();
      await held;
    });
    await enteredPromise;

    const responsePromise = request(app)
      .post('/settings/jellyfin')
      .send({
        ip: 'jellyfin.local',
        port: 8096,
        useSsl: false,
        apiKey: '[REDACTED]',
      })
      .then((response) => response);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    settings.jellyfin = { ...settings.jellyfin, apiKey: 'rotated-key' };
    release();

    const response = await responsePromise;
    await holder;
    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.jellyfin.apiKey, 'rotated-key');
  });

  it('does not overwrite a Tautulli key rotated during connection testing', async () => {
    const settings = getSettings();
    settings.tautulli = {
      hostname: 'tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: 'initial-key',
    };
    mock.method(TautulliAPI.prototype, 'getInfo', async () => {
      settings.tautulli = { ...settings.tautulli, apiKey: 'rotated-key' };
      return { tautulli_version: '2.15.0' };
    });

    const response = await request(app).post('/settings/tautulli').send({
      hostname: 'tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: '[REDACTED]',
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.tautulli.apiKey, 'rotated-key');
  });

  it('does not overwrite a Jellyfin key rotated during connection testing', async () => {
    const settings = getSettings();
    settings.jellyfin = {
      ...settings.jellyfin,
      name: 'Jellyfin',
      ip: 'jellyfin.local',
      port: 8096,
      useSsl: false,
      serverId: 'server-id',
      apiKey: 'initial-key',
    };
    mock.method(JellyfinAPI.prototype, 'getSystemInfo', async () => {
      settings.jellyfin = { ...settings.jellyfin, apiKey: 'rotated-key' };
      return { Id: 'server-id', ServerName: 'Jellyfin' };
    });

    const response = await request(app).post('/settings/jellyfin').send({
      ip: 'jellyfin.local',
      port: 8096,
      useSsl: false,
      apiKey: '[REDACTED]',
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.jellyfin.apiKey, 'rotated-key');
  });

  it('restores live Tautulli settings when persistence fails', async () => {
    const settings = getSettings();
    const original = {
      hostname: 'stored-tautulli.local',
      port: 8181,
      useSsl: false,
      apiKey: 'stored-key',
    };
    settings.replaceSection('tautulli', { ...original });
    mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    });

    const res = await request(app).post('/settings/tautulli').send({
      hostname: '',
      port: 8181,
      useSsl: false,
      urlBase: '',
      apiKey: '',
      externalUrl: '',
    });

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(settings.tautulli, original);
  });

  it('rejects malformed main default quota settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const shapeRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: [] });
    const nestedShapeRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { movie: [] } });
    const quotaLimitRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { movie: { quotaLimit: 'nope' } } });
    const quotaDaysRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { book: { quotaDays: 10001 } } });

    assert.strictEqual(shapeRes.status, 400);
    assert.match(shapeRes.body.message, /defaultQuotas must be an object/);
    assert.strictEqual(nestedShapeRes.status, 400);
    assert.match(
      nestedShapeRes.body.message,
      /defaultQuotas.movie must be an object/
    );
    assert.strictEqual(quotaLimitRes.status, 400);
    assert.match(
      quotaLimitRes.body.message,
      /defaultQuotas.movie.quotaLimit must be a valid number/
    );
    assert.strictEqual(quotaDaysRes.status, 400);
    assert.match(
      quotaDaysRes.body.message,
      /defaultQuotas.book.quotaDays must be a valid number/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects unsafe Tautulli external URLs before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const res = await request(app).post('/settings/tautulli').send({
      externalUrl: 'javascript:alert(1)',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /externalUrl must be a valid HTTP URL/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects unsafe media server browser URLs before external work', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const plexRes = await request(app).post('/settings/plex').send({
      webAppUrl: 'javascript:alert(1)',
    });
    const jellyfinRes = await request(app).post('/settings/jellyfin').send({
      externalHostname: 'javascript:alert(1)',
    });
    const jellyfinResetRes = await request(app)
      .post('/settings/jellyfin')
      .send({
        jellyfinForgotPasswordUrl: 'javascript:alert(1)',
      });

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /webAppUrl must be a valid HTTP URL/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(
      jellyfinRes.body.message,
      /externalHostname must be a valid HTTP URL/
    );
    assert.strictEqual(jellyfinResetRes.status, 400);
    assert.match(
      jellyfinResetRes.body.message,
      /jellyfinForgotPasswordUrl must be a valid HTTP URL/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed network proxy settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const proxyShapeRes = await request(app)
      .post('/settings/network')
      .send({ proxy: [] });
    const proxyPortRes = await request(app)
      .post('/settings/network')
      .send({ proxy: { enabled: true, hostname: 'proxy.local', port: 70000 } });
    const proxyEnabledRes = await request(app)
      .post('/settings/network')
      .send({ proxy: { enabled: 'true' } });

    assert.strictEqual(proxyShapeRes.status, 400);
    assert.match(proxyShapeRes.body.message, /proxy must be an object/);
    assert.strictEqual(proxyPortRes.status, 400);
    assert.match(
      proxyPortRes.body.message,
      /proxy.port must be a valid number/
    );
    assert.strictEqual(proxyEnabledRes.status, 400);
    assert.match(
      proxyEnabledRes.body.message,
      /proxy.enabled must be a boolean/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('preserves omitted proxy fields and persists explicit clears', async () => {
    const settings = getSettings();
    const original = structuredClone(settings.network);
    settings.network.proxy = {
      enabled: false,
      hostname: 'proxy.local',
      port: 8080,
      useSsl: true,
      user: 'stored-user',
      password: 'stored-password',
      bypassFilter: 'localhost',
      bypassLocalAddresses: true,
    };
    const saveMock = mock.method(settings, 'save', async () => undefined);

    try {
      const enableRes = await request(app)
        .post('/settings/network')
        .send({ proxy: { enabled: true } });
      assert.strictEqual(enableRes.status, 200);
      assert.strictEqual(settings.network.proxy.hostname, 'proxy.local');
      assert.strictEqual(settings.network.proxy.port, 8080);
      assert.strictEqual(settings.network.proxy.useSsl, true);

      const clearRes = await request(app)
        .post('/settings/network')
        .send({
          proxy: {
            enabled: false,
            hostname: '',
            user: '',
            password: null,
            bypassFilter: '',
          },
        });
      assert.strictEqual(clearRes.status, 200);
      assert.strictEqual(settings.network.proxy.hostname, '');
      assert.strictEqual(settings.network.proxy.user, '');
      assert.strictEqual(settings.network.proxy.password, '');
      assert.strictEqual(settings.network.proxy.bypassFilter, '');
      assert.strictEqual(settings.network.proxy.port, 8080);
      assert.strictEqual(saveMock.mock.callCount(), 2);
    } finally {
      settings.replaceSection('network', original);
    }
  });

  it('rejects malformed network DNS and timeout settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const dnsShapeRes = await request(app)
      .post('/settings/network')
      .send({ dnsCache: [] });
    const dnsTtlRes = await request(app)
      .post('/settings/network')
      .send({ dnsCache: { forceMaxTtl: 999999 } });
    const timeoutRes = await request(app)
      .post('/settings/network')
      .send({ apiRequestTimeout: 999999 });

    assert.strictEqual(dnsShapeRes.status, 400);
    assert.match(dnsShapeRes.body.message, /dnsCache must be an object/);
    assert.strictEqual(dnsTtlRes.status, 400);
    assert.match(
      dnsTtlRes.body.message,
      /dnsCache.forceMaxTtl must be a valid number/
    );
    assert.strictEqual(timeoutRes.status, 400);
    assert.match(
      timeoutRes.body.message,
      /apiRequestTimeout must be a valid number/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('accepts the disabled DNS cache maximum TTL sentinel', async () => {
    const settings = getSettings();
    mock.method(settings, 'save', async () => undefined);

    const res = await request(app)
      .post('/settings/network')
      .send({ dnsCache: { enabled: false, forceMinTtl: 0, forceMaxTtl: -1 } });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.dnsCache.forceMaxTtl, -1);
  });

  it('rejects malformed media server settings bodies before external work', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const plexRes = await request(app).post('/settings/plex').send([]);
    const jellyfinRes = await request(app).post('/settings/jellyfin').send([]);

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Settings body must be an object/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Settings body must be an object/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('keeps Plex library GET requests read-only', async () => {
    const settings = getSettings();
    settings.plex.libraries[0].enabled = true;
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const res = await request(app)
      .get('/settings/plex/library')
      .query({ enable: settings.plex.libraries[0].id });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(settings.plex.libraries[0].enabled, true);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed Plex library update bodies', async () => {
    const syncMock = mock.method(
      PlexAPI.prototype,
      'syncLibraries',
      async () => []
    );
    const arrayRes = await request(app)
      .post('/settings/plex/library')
      .send({ sync: true, enable: ['1', '2'] });
    const res = await request(app)
      .post('/settings/plex/library')
      .send({ sync: 'yes' });

    assert.strictEqual(arrayRes.status, 400);
    assert.strictEqual(syncMock.mock.callCount(), 0);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be a boolean/);
  });

  it('keeps Jellyfin library GET requests read-only', async () => {
    const settings = getSettings();
    settings.jellyfin.libraries[0].enabled = true;
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const res = await request(app)
      .get('/settings/jellyfin/library')
      .query({ enable: settings.jellyfin.libraries[0].id });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(settings.jellyfin.libraries[0].enabled, true);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed Jellyfin library update bodies', async () => {
    const libraryMock = mock.method(
      JellyfinAPI.prototype,
      'getLibraries',
      async () => []
    );
    const arrayRes = await request(app)
      .post('/settings/jellyfin/library')
      .send({ sync: true, enable: ['1', '2'] });
    const res = await request(app)
      .post('/settings/jellyfin/library')
      .send({ sync: 'yes' });

    assert.strictEqual(arrayRes.status, 400);
    assert.strictEqual(libraryMock.mock.callCount(), 0);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be a boolean/);
  });

  it('rejects string scanner commands', async () => {
    const plexRes = await request(app)
      .post('/settings/plex/sync')
      .send({ start: 'true' });
    const jellyfinRes = await request(app)
      .post('/settings/jellyfin/sync')
      .send({ cancel: 'true' });

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Start must be a boolean/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Cancel must be a boolean/);
  });

  it('rejects malformed scanner command bodies', async () => {
    const plexRes = await request(app).post('/settings/plex/sync').send([]);
    const jellyfinRes = await request(app)
      .post('/settings/jellyfin/sync')
      .send([]);

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Settings body must be an object/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Settings body must be an object/);
  });

  it('coalesces and tracks manual scanner starts through completion', async () => {
    let releaseScan!: () => void;
    let markEntered!: () => void;
    const heldScan = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runMock = mock.method(plexFullScanner, 'run', () => {
      markEntered();
      return heldScan;
    });

    try {
      const [first, second] = await Promise.all([
        request(app).post('/settings/plex/sync').send({ start: true }),
        request(app).post('/settings/plex/sync').send({ start: true }),
      ]);
      await entered;

      assert.strictEqual(first.status, 200);
      assert.strictEqual(second.status, 200);
      assert.strictEqual(runMock.mock.callCount(), 1);
      assert.strictEqual(isTrackedJobRunning('Plex Full Library Scan'), true);

      let drained = false;
      const drain = waitForActiveJobs().then(() => {
        drained = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(drained, false);

      releaseScan();
      await drain;
      assert.strictEqual(isTrackedJobRunning('Plex Full Library Scan'), false);
    } finally {
      releaseScan();
      await waitForActiveJobs();
    }
  });

  it('rejects malformed metadata test bodies before provider calls', async () => {
    const arrayRes = await request(app)
      .post('/settings/metadatas/test')
      .send([]);
    const flagRes = await request(app)
      .post('/settings/metadatas/test')
      .send({ tmdb: 'true' });

    assert.strictEqual(arrayRes.status, 400);
    assert.match(arrayRes.body.error, /Invalid metadata test settings/);
    assert.strictEqual(flagRes.status, 400);
    assert.match(flagRes.body.error, /Metadata test flags must be booleans/);
  });

  it('rejects malformed log search values before reading logs', async () => {
    const res = await request(app).get(
      '/settings/logs?search=error&search=warn'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Search must be a string/);
  });

  it('rejects unknown log filters before reading logs', async () => {
    const res = await request(app).get('/settings/logs?filter=trace');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Filter must be valid/);
  });

  it('bounds and redacts parsed log records', () => {
    const validLine = JSON.stringify({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'error',
      message: 'failed with token',
      apiKey: 'super-secret',
    });
    const oversizedLine = JSON.stringify({
      level: 'error',
      message: 'x'.repeat(70 * 1024),
    });
    const malformedShape = JSON.stringify({
      level: 'error',
      message: { nested: 'not a string' },
    });

    const logs = parseLogMessages(
      [validLine, oversizedLine, malformedShape, 'not-json'].join('\n'),
      ['error']
    );

    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(logs[0].data, { apiKey: '[REDACTED]' });
  });

  it('bounds deep log search traversal', () => {
    let nested: Record<string, unknown> = { value: 'too-deep' };
    for (let i = 0; i < 20; i += 1) {
      nested = { nested };
    }

    const values = deepLogValueStrings(nested, 8, 5);

    assert.deepStrictEqual(values, []);
  });

  it('rejects malformed webhook notification bodies before persistence', async () => {
    const missingOptions = await request(app)
      .post('/settings/notifications/webhook')
      .send({ enabled: false, types: 0 });
    const stringEnabled = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: 'false',
        types: 0,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: '{}',
        },
      });
    const scalarPayload = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: false,
        types: 0,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: 'null',
        },
      });
    const oversizedAuthHeader = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: false,
        types: 0,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: '{}',
          authHeader: 'x'.repeat(4097),
        },
      });

    assert.strictEqual(missingOptions.status, 400);
    assert.match(
      missingOptions.body.message,
      /Webhook options must be an object/
    );
    assert.strictEqual(stringEnabled.status, 400);
    assert.match(stringEnabled.body.message, /Enabled must be a boolean/);
    assert.strictEqual(scalarPayload.status, 400);
    assert.match(scalarPayload.body.message, /root must be an object or array/);
    assert.strictEqual(oversizedAuthHeader.status, 400);
    assert.match(oversizedAuthHeader.body.message, /Auth header must be 4096/);
  });

  it('returns a recoverable payload when persisted webhook JSON is corrupt', async () => {
    const settings = getSettings();
    const originalPayload =
      settings.notifications.agents.webhook.options.jsonPayload;
    settings.notifications.agents.webhook.options.jsonPayload = 'corrupt';

    try {
      const res = await request(app).get('/settings/notifications/webhook');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.options.jsonPayload, '{}');
    } finally {
      settings.notifications.agents.webhook.options.jsonPayload =
        originalPayload;
    }
  });

  it('persists normalized webhook notification bodies', async () => {
    const res = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: false,
        embedPoster: true,
        types: 7,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: '{}',
          authHeader: 'Bearer test',
          customHeaders: [{ key: 'X-Test', value: 'ok' }],
          supportVariables: true,
        },
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.webhook.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.webhook.types, 7);
    assert.deepStrictEqual(
      getSettings().notifications.agents.webhook.options.customHeaders,
      [{ key: 'X-Test', value: 'ok' }]
    );
  });

  it('redacts and preserves webhook custom header values by header name', async () => {
    const settings = getSettings();
    settings.notifications.agents.webhook = {
      enabled: true,
      embedPoster: false,
      types: 1,
      options: {
        webhookUrl: 'https://example.com/webhook',
        jsonPayload: Buffer.from(JSON.stringify('{}')).toString('base64'),
        authHeader: 'Bearer stored-auth',
        customHeaders: [
          { key: 'X-First', value: 'first-secret' },
          { key: 'X-Second', value: 'second-secret' },
        ],
        supportVariables: false,
      },
    };

    const getRes = await request(app).get('/settings/notifications/webhook');
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.options.webhookUrl, '[REDACTED]');
    assert.strictEqual(getRes.body.options.authHeader, '[REDACTED]');
    assert.deepStrictEqual(getRes.body.options.customHeaders, [
      { key: 'X-First', value: '[REDACTED]' },
      { key: 'X-Second', value: '[REDACTED]' },
    ]);

    const saveRes = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: true,
        embedPoster: false,
        types: 1,
        options: {
          webhookUrl: '[REDACTED]',
          jsonPayload: '{}',
          authHeader: '[REDACTED]',
          customHeaders: [
            { key: 'X-Second', value: '[REDACTED]' },
            { key: 'X-First', value: '[REDACTED]' },
          ],
          supportVariables: false,
        },
      });

    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(
      settings.notifications.agents.webhook.options.webhookUrl,
      'https://example.com/webhook'
    );
    assert.deepStrictEqual(
      settings.notifications.agents.webhook.options.customHeaders,
      [
        { key: 'X-Second', value: 'second-secret' },
        { key: 'X-First', value: 'first-secret' },
      ]
    );
  });

  it('rejects malformed Gotify and ntfy notification bodies before persistence', async () => {
    const gotifyRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: 'false',
        types: 0,
        options: { url: 'https://example.com/gotify' },
      });
    const ntfyRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        types: '1',
        options: { url: 'https://example.com/ntfy' },
      });

    assert.strictEqual(gotifyRes.status, 400);
    assert.match(gotifyRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(ntfyRes.status, 400);
    assert.match(ntfyRes.body.message, /Notification types must be valid/);
  });

  it('rejects malformed Gotify and ntfy notification options before persistence', async () => {
    const gotifyTokenRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/gotify',
          token: 123,
          priority: 5,
        },
      });
    const gotifyPriorityRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/gotify',
          token: 'token',
          priority: 1001,
        },
      });
    const ntfyAuthRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/ntfy',
          topic: 'topic',
          authMethodToken: 'true',
        },
      });
    const gotifyLocaleRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/gotify',
          locale: 'not-a-locale',
        },
      });

    assert.strictEqual(gotifyTokenRes.status, 400);
    assert.match(gotifyTokenRes.body.message, /Gotify token must be a string/);
    assert.strictEqual(gotifyPriorityRes.status, 400);
    assert.match(
      gotifyPriorityRes.body.message,
      /Gotify priority must be an integer/
    );
    assert.strictEqual(ntfyAuthRes.status, 400);
    assert.match(
      ntfyAuthRes.body.message,
      /ntfy authMethodToken must be a boolean/
    );
    assert.strictEqual(gotifyLocaleRes.status, 400);
    assert.match(gotifyLocaleRes.body.message, /locale must be a supported/);
  });

  it('persists normalized Gotify and ntfy notification bodies', async () => {
    const gotifyRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        embedPoster: true,
        types: 3,
        options: {
          url: 'https://example.com/gotify',
          token: 'token',
          priority: 5,
          locale: 'en',
          unexpected: { retained: false },
        },
      });
    const ntfyRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        embedPoster: false,
        types: 4,
        options: {
          url: 'https://example.com/ntfy',
          topic: 'topic',
          locale: 'en',
          unexpected: { retained: false },
        },
      });

    assert.strictEqual(gotifyRes.status, 200);
    assert.strictEqual(ntfyRes.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.gotify.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.gotify.types, 3);
    assert.strictEqual(getSettings().notifications.agents.ntfy.enabled, false);
    assert.strictEqual(getSettings().notifications.agents.ntfy.types, 4);
    assert.deepStrictEqual(getSettings().notifications.agents.gotify.options, {
      url: 'https://example.com/gotify',
      token: 'token',
      priority: 5,
      locale: 'en',
    });
    assert.deepStrictEqual(getSettings().notifications.agents.ntfy.options, {
      url: 'https://example.com/ntfy',
      topic: 'topic',
      locale: 'en',
    });
  });

  it('rejects malformed Discord and Slack notification bodies before persistence', async () => {
    const discordRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: 'false',
        types: 0,
        options: { webhookUrl: 'https://example.com/discord' },
      });
    const slackRes = await request(app)
      .post('/settings/notifications/slack')
      .send({
        enabled: false,
        types: 0,
        options: { webhookUrl: 123 },
      });
    const discordOptionRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: false,
        types: 0,
        options: {
          webhookUrl: 'https://example.com/discord',
          botUsername: 123,
        },
      });

    assert.strictEqual(discordRes.status, 400);
    assert.match(discordRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(slackRes.status, 400);
    assert.match(slackRes.body.message, /Slack webhook URL must be a string/);
    assert.strictEqual(discordOptionRes.status, 400);
    assert.match(discordOptionRes.body.message, /botUsername must be a string/);
  });

  it('persists normalized Discord and Slack notification bodies', async () => {
    const discordRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: false,
        embedPoster: true,
        types: 5,
        options: {
          webhookUrl: 'https://example.com/discord',
          botUsername: 'Seerr',
          enableMentions: false,
          locale: 'en',
          useUserLocale: false,
          unexpected: { retained: false },
        },
      });
    const slackRes = await request(app)
      .post('/settings/notifications/slack')
      .send({
        enabled: false,
        embedPoster: false,
        types: 6,
        options: {
          webhookUrl: 'https://example.com/slack',
          locale: 'en',
          unexpected: { retained: false },
        },
      });

    assert.strictEqual(discordRes.status, 200);
    assert.strictEqual(slackRes.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.discord.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.discord.types, 5);
    assert.strictEqual(getSettings().notifications.agents.slack.enabled, false);
    assert.strictEqual(getSettings().notifications.agents.slack.types, 6);
    assert.deepStrictEqual(getSettings().notifications.agents.discord.options, {
      webhookUrl: 'https://example.com/discord',
      botUsername: 'Seerr',
      enableMentions: false,
      locale: 'en',
      useUserLocale: false,
    });
    assert.deepStrictEqual(getSettings().notifications.agents.slack.options, {
      webhookUrl: 'https://example.com/slack',
      locale: 'en',
    });
  });

  it('restores notification settings when persistence fails', async () => {
    const settings = getSettings();
    const original = settings.notifications;
    mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    });

    const res = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: false,
        embedPoster: false,
        types: 5,
        options: {
          webhookUrl: 'https://example.com/discord',
          enableMentions: false,
          locale: 'en',
          useUserLocale: false,
        },
      });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(settings.notifications, original);
  });

  it('restores redacted Discord and Slack URLs before validation', async () => {
    const settings = getSettings();
    settings.notifications.agents.discord.options.webhookUrl =
      'https://example.com/discord';
    settings.notifications.agents.slack.options.webhookUrl =
      'https://example.com/slack';

    const discordRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: true,
        embedPoster: false,
        types: 1,
        options: { webhookUrl: '[REDACTED]' },
      });
    const slackRes = await request(app)
      .post('/settings/notifications/slack')
      .send({
        enabled: true,
        embedPoster: false,
        types: 1,
        options: { webhookUrl: '[REDACTED]' },
      });

    assert.strictEqual(discordRes.status, 200);
    assert.strictEqual(slackRes.status, 200);
    assert.strictEqual(
      settings.notifications.agents.discord.options.webhookUrl,
      'https://example.com/discord'
    );
    assert.strictEqual(
      settings.notifications.agents.slack.options.webhookUrl,
      'https://example.com/slack'
    );
  });

  it('resolves redacted notification credentials from the persistence snapshot', async () => {
    const settings = getSettings();
    settings.notifications.agents.telegram.options.botAPI = 'rotated-token';

    await persistNotificationAgent('telegram', {
      enabled: false,
      embedPoster: false,
      types: 1,
      options: {
        botAPI: '[REDACTED]',
        chatId: 'chat',
        messageThreadId: '',
        sendSilently: false,
      },
    });

    assert.strictEqual(
      settings.notifications.agents.telegram.options.botAPI,
      'rotated-token'
    );
  });

  it('restores redacted notification credentials for test sends', async () => {
    const settings = getSettings();
    settings.notifications.agents.discord.options.webhookUrl =
      'https://example.com/discord';
    const sendMock = mock.method(
      DiscordAgent.prototype,
      'send',
      async () => true
    );
    const authenticatedApp = createApp(
      new User({
        id: 1,
        email: 'admin@seerr.dev',
        username: 'admin',
        permissions: Permission.ADMIN,
        settings: new UserSettings({ locale: 'en' }),
      })
    );

    const res = await request(authenticatedApp)
      .post('/settings/notifications/discord/test')
      .send({
        enabled: true,
        embedPoster: false,
        types: 1,
        options: { webhookUrl: '[REDACTED]' },
      });

    assert.strictEqual(res.status, 204, JSON.stringify(res.body));
    assert.strictEqual(sendMock.mock.callCount(), 1);
  });

  it('rejects malformed remaining notification bodies before persistence', async () => {
    const telegramRes = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: 'false',
        types: 0,
        options: {
          botAPI: 'token',
          chatId: 'chat',
          messageThreadId: '',
          sendSilently: false,
        },
      });
    const pushbulletRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        types: 0,
        options: { accessToken: 123 },
      });
    const pushoverRes = await request(app)
      .post('/settings/notifications/pushover')
      .send({
        enabled: false,
        types: '0',
        options: {
          accessToken: 'token',
          userToken: 'user',
          sound: 'pushover',
        },
      });
    const emailRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        types: 0,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: '587',
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });
    const webpushRes = await request(app)
      .post('/settings/notifications/webpush')
      .send({ enabled: false, types: 0 });

    assert.strictEqual(telegramRes.status, 400);
    assert.match(telegramRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(pushbulletRes.status, 400);
    assert.match(pushbulletRes.body.message, /accessToken must be a string/);
    assert.strictEqual(pushoverRes.status, 400);
    assert.match(pushoverRes.body.message, /Notification types must be valid/);
    assert.strictEqual(emailRes.status, 400);
    assert.match(
      emailRes.body.message,
      /smtpPort must be an integer between 1 and 65535/
    );
    assert.strictEqual(webpushRes.status, 400);
    assert.match(webpushRes.body.message, /Web push options must be an object/);
  });

  it('rejects oversized generic notification option values before saving', async () => {
    const tokenRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        types: 0,
        options: { accessToken: 'x'.repeat(4097) },
      });
    const portRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        types: 0,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 70000,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });

    assert.strictEqual(tokenRes.status, 400);
    assert.match(tokenRes.body.message, /accessToken must be 4096 characters/);
    assert.strictEqual(portRes.status, 400);
    assert.match(
      portRes.body.message,
      /smtpPort must be an integer between 1 and 65535/
    );
  });

  it('allowlists and bounds optional generic notification options', async () => {
    const accepted = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: false,
        types: 0,
        options: {
          botAPI: 'token',
          botUsername: 'seerr_bot',
          chatId: '',
          messageThreadId: '',
          sendSilently: false,
          unexpected: { retained: false },
        },
      });
    const invalidUsername = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: false,
        types: 0,
        options: {
          botAPI: 'token',
          botUsername: 123,
          chatId: '',
          messageThreadId: '',
          sendSilently: false,
        },
      });
    const oversizedChannel = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        types: 0,
        options: {
          accessToken: 'token',
          channelTag: 'x'.repeat(4097),
        },
      });

    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(invalidUsername.status, 400);
    assert.match(invalidUsername.body.message, /botUsername must be a string/);
    assert.strictEqual(oversizedChannel.status, 400);
    assert.match(oversizedChannel.body.message, /channelTag must be 4096/);
    assert.deepStrictEqual(
      getSettings().notifications.agents.telegram.options,
      {
        botAPI: 'token',
        botUsername: 'seerr_bot',
        chatId: '',
        messageThreadId: '',
        sendSilently: false,
      }
    );
  });

  it('accepts the email UI payload without notification types', async () => {
    const accepted = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        embedPoster: false,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          authUser: 'smtp-user',
          authPass: 'smtp-password',
          allowSelfSigned: false,
          senderName: 'Seerr',
          pgpPrivateKey: '',
          pgpPassword: '',
        },
      });
    const invalidTypes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        types: 'all',
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });

    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(invalidTypes.status, 400);
    assert.match(invalidTypes.body.message, /Notification types must be valid/);
    assert.strictEqual(
      getSettings().notifications.agents.email.options.authUser,
      'smtp-user'
    );
    assert.strictEqual(
      getSettings().notifications.agents.email.options.authPass,
      'smtp-password'
    );
  });

  it('persists normalized remaining notification bodies', async () => {
    const telegramRes = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: false,
        embedPoster: true,
        types: 8,
        options: {
          botAPI: 'token',
          chatId: 'chat',
          messageThreadId: '',
          sendSilently: false,
        },
      });
    const pushbulletRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        embedPoster: false,
        types: 9,
        options: { accessToken: 'token' },
      });
    const pushoverRes = await request(app)
      .post('/settings/notifications/pushover')
      .send({
        enabled: false,
        embedPoster: true,
        types: 10,
        options: {
          accessToken: 'token',
          userToken: 'user',
          sound: 'pushover',
        },
      });
    const emailRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        embedPoster: false,
        types: 11,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });
    const webpushRes = await request(app)
      .post('/settings/notifications/webpush')
      .send({
        enabled: false,
        embedPoster: true,
        types: 12,
        options: {},
      });

    assert.strictEqual(telegramRes.status, 200);
    assert.strictEqual(pushbulletRes.status, 200);
    assert.strictEqual(pushoverRes.status, 200);
    assert.strictEqual(emailRes.status, 200);
    assert.strictEqual(webpushRes.status, 200);
    assert.strictEqual(getSettings().notifications.agents.telegram.types, 8);
    assert.strictEqual(getSettings().notifications.agents.pushbullet.types, 9);
    assert.strictEqual(getSettings().notifications.agents.pushover.types, 10);
    assert.strictEqual(getSettings().notifications.agents.email.types, 11);
    assert.strictEqual(getSettings().notifications.agents.webpush.types, 12);
  });

  it('rejects oversized job IDs before lookup', async () => {
    const res = await request(app).post(
      `/settings/jobs/${'x'.repeat(129)}/run`
    );

    assert.strictEqual(res.status, 404);
  });

  it('does not invoke a job that already reports running', async () => {
    let invoked = false;
    scheduledJobs.push({
      id: 'radarr-scan',
      name: 'Radarr Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: '0 0 * * *',
      job: {
        invoke: () => {
          invoked = true;
        },
        nextInvocation: () => null,
      } as never,
      running: () => true,
    });

    const res = await request(app).post('/settings/jobs/radarr-scan/run');

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /already running/);
    assert.strictEqual(invoked, false);
  });

  it('reports and rejects control of a job leased by another instance', async () => {
    let invoked = false;
    let cancelled = false;
    scheduledJobs.push({
      id: 'radarr-scan',
      name: 'Radarr Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: '0 0 * * *',
      job: {
        invoke: () => {
          invoked = true;
        },
        nextInvocation: () => null,
      } as never,
      cancelFn: () => {
        cancelled = true;
      },
    });
    await getRepository(ScheduledJobLease).save(
      new ScheduledJobLease({
        name: 'scheduled-job:Radarr Scan',
        owner: 'another-instance',
        expiresAt: new Date(Date.now() + 60_000),
      })
    );

    const statusRes = await request(app).get('/settings/jobs');
    const runRes = await request(app).post('/settings/jobs/radarr-scan/run');
    const cancelRes = await request(app).post(
      '/settings/jobs/radarr-scan/cancel'
    );

    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body[0].running, true);
    assert.strictEqual(runRes.status, 409);
    assert.strictEqual(cancelRes.status, 409);
    assert.match(cancelRes.body.message, /another instance/);
    assert.strictEqual(invoked, false);
    assert.strictEqual(cancelled, false);
  });

  it('restores the active job schedule when persistence fails', async () => {
    const settings = getSettings();
    const previousSchedule = settings.jobs['radarr-scan'].schedule;
    const job = scheduleJob(previousSchedule, () => undefined);
    assert.ok(job);
    const originalReschedule = job.reschedule.bind(job);
    const rescheduleMock = mock.method(job, 'reschedule', (spec: Spec) =>
      originalReschedule(spec)
    );
    scheduledJobs.push({
      id: 'radarr-scan',
      name: 'Radarr Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: previousSchedule,
      job,
    });
    mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    });

    const res = await request(app)
      .post('/settings/jobs/radarr-scan/schedule')
      .send({ schedule: '0 15 * * *' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(rescheduleMock.mock.callCount(), 2);
    assert.strictEqual(settings.jobs['radarr-scan'].schedule, previousSchedule);
    assert.strictEqual(scheduledJobs[0].cronSchedule, previousSchedule);
    job.cancel();
  });

  it('toggles a scheduled job enabled setting', async () => {
    let cancelled = false;
    scheduledJobs.push({
      id: 'download-recovery',
      name: 'Download Recovery',
      type: 'process',
      interval: 'minutes',
      cronSchedule: '0 */5 * * * *',
      job: {
        cancel: () => {
          cancelled = true;
        },
        nextInvocation: () => null,
      } as never,
    });

    const res = await request(app)
      .post('/settings/jobs/download-recovery/enabled')
      .send({ enabled: false });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.enabled, false);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(getSettings().jobs['download-recovery'].enabled, false);
  });

  it('rejects oversized cache IDs before lookup', async () => {
    const res = await request(app).post(
      `/settings/cache/${'x'.repeat(129)}/flush`
    );

    assert.strictEqual(res.status, 404);
  });

  it('rejects prototype cache IDs instead of treating them as cache objects', async () => {
    const res = await request(app).post('/settings/cache/__proto__/flush');

    assert.strictEqual(res.status, 404);
    assert.match(res.body.message, /Cache not found/);
  });
});
