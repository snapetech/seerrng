import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import axios from 'axios';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI, { type SonarrSeries } from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import OverrideRule from '@server/entity/OverrideRule';
import { User } from '@server/entity/User';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceAdmission } from '@server/lib/serviceAdmission';
import type {
  AllSettings,
  LidarrSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { setupTestDb } from '@server/test/db';
import { MAX_SERVARR_INSTANCES_PER_TYPE } from '@server/utils/servarrSettings';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import serviceRoutes, {
  SONARR_LOOKUP_RATE_LIMIT,
  filterSonarrLookupResults,
} from './service';
import lidarrRoutes from './settings/lidarr';
import radarrRoutes from './settings/radarr';
import {
  DIAGNOSTIC_LOOKUP_HYDRATION_CONCURRENCY,
  MAX_DIAGNOSTIC_LOOKUP_RESULTS,
  default as readarrRoutes,
} from './settings/readarr';
import sonarrRoutes from './settings/sonarr';

let app: Express;

setupTestDb();

const baseServerSettings = {
  hostname: 'localhost',
  apiKey: 'test-key',
  useSsl: false,
  activeProfileId: 1,
  activeProfileName: 'Any',
  activeDirectory: '/data',
  tags: [10],
  is4k: false,
  syncEnabled: true,
  preventSearch: false,
  tagRequests: false,
  overrideRule: [],
  externalUrl: '',
};

function createApp(permissions = Permission.REQUEST_ADVANCED) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      hasPermission: (
        requiredPermissions: Permission | Permission[],
        options: PermissionCheckOptions = { type: 'and' }
      ) => {
        const values = Array.isArray(requiredPermissions)
          ? requiredPermissions
          : [requiredPermissions];

        return options.type === 'or'
          ? values.some((permission) => Boolean(permissions & permission))
          : values.every((permission) => Boolean(permissions & permission));
      },
    } as Express.Request['user'];
    next();
  });
  app.use('/service', serviceRoutes);
  app.use('/settings/radarr', radarrRoutes);
  app.use('/settings/sonarr', sonarrRoutes);
  app.use('/settings/lidarr', lidarrRoutes);
  app.use('/settings/readarr', readarrRoutes);
  app.use(
    (
      err: { status?: number | string; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(Number(err.status ?? 500))
        .json({ status: Number(err.status ?? 500), message: err.message });
    }
  );
  return app;
}

function createOpenApiApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1 } as Express.Request['user'];
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/settings/radarr', radarrRoutes);
  app.use('/api/v1/settings/sonarr', sonarrRoutes);
  app.use('/api/v1/settings/lidarr', lidarrRoutes);
  app.use('/api/v1/settings/readarr', readarrRoutes);
  app.use(
    (
      err: { status?: number | string; message?: string; errors?: unknown[] },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res.status(Number(err.status ?? 500)).json({
        status: Number(err.status ?? 500),
        message: err.message,
        errors: err.errors,
      });
    }
  );
  return app;
}

function makeLidarr(overrides: Partial<LidarrSettings> = {}): LidarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Lidarr',
    port: 8686,
    activeMetadataProfileId: 2,
    activeMetadataProfileName: 'Standard',
    isDefault: true,
    ...overrides,
  };
}

function makeRadarr(overrides: Partial<RadarrSettings> = {}): RadarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Radarr',
    port: 7878,
    minimumAvailability: 'released',
    isDefault: true,
    ...overrides,
  };
}

function makeSonarr(overrides: Partial<SonarrSettings> = {}): SonarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Sonarr',
    port: 8989,
    seriesType: 'standard',
    animeSeriesType: 'anime',
    enableSeasonFolders: true,
    monitorNewItems: 'all',
    isDefault: true,
    ...overrides,
  };
}

function makeReadarr(
  overrides: Partial<ReadarrSettings> = {}
): ReadarrSettings {
  return {
    ...baseServerSettings,
    id: overrides.id ?? 0,
    name: 'Bookshelf',
    port: 8787,
    activeMetadataProfileId: 2,
    activeMetadataProfileName: 'Standard',
    isDefault: true,
    serviceType: 'ebook',
    ...overrides,
  };
}

// `getTags` is an instance-bound arrow-function class field (see
// ServarrBase#getTags), not a prototype method, so it can't be replaced with
// `mock.method(SomeAPI.prototype, 'getTags', ...)`. Instead, intercept the
// underlying `/tag` HTTP call on the real axios instance each Servarr client
// creates, leaving everything else (e.g. `defaults.params.apikey`) untouched.
function mockServarrTagsEndpoint(tags: { id: number; label: string }[]) {
  const realCreate = axios.create.bind(axios);
  mock.method(axios, 'create', (config?: Parameters<typeof axios.create>[0]) => {
    const instance = realCreate(config);
    const realGet = instance.get.bind(instance);
    instance.get = ((url: string, requestConfig?: unknown) =>
      url === '/tag'
        ? Promise.resolve({ data: tags })
        : realGet(url, requestConfig as never)) as typeof instance.get;
    return instance;
  });
}

before(() => {
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  settings.radarr = [];
  settings.sonarr = [];
  settings.lidarr = [];
  settings.readarr = [];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
});

describe('Sonarr lookup response filtering', () => {
  it('bounds credentialed provider lookups per user', () => {
    assert.deepStrictEqual(SONARR_LOOKUP_RATE_LIMIT, {
      windowMs: 60_000,
      limit: 30,
    });
  });

  it('does not use Sonarr credentials after the session credential changes', async () => {
    const settings = getSettings();
    settings.sonarr = [makeSonarr()];
    await getRepository(User).update(1, {
      passwordChangedAt: new Date(Date.now() + 1_000),
    });
    let tmdbLookupCalls = 0;
    const originalGetTvShow = Object.getOwnPropertyDescriptor(
      TheMovieDb.prototype,
      'getTvShow'
    );
    Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
      configurable: true,
      get: () => async () => {
        tmdbLookupCalls += 1;
        return { name: 'Never Called' } as never;
      },
      set: () => undefined,
    });
    const sonarrLookup = mock.method(
      SonarrAPI.prototype,
      'getSeriesByTitle',
      async () => []
    );
    const staleSessionApp = express();
    staleSessionApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.REQUEST });
      req.session = {
        userId: 1,
        credentialVersion: 0,
      } as typeof req.session;
      next();
    });
    staleSessionApp.use('/service', serviceRoutes);
    staleSessionApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    try {
      const response = await request(staleSessionApp).get(
        '/service/sonarr/lookup/123'
      );

      assert.strictEqual(response.status, 403);
      assert.strictEqual(tmdbLookupCalls, 0);
      assert.strictEqual(sonarrLookup.mock.callCount(), 0);
    } finally {
      settings.sonarr = [];
      if (originalGetTvShow) {
        Object.defineProperty(
          TheMovieDb.prototype,
          'getTvShow',
          originalGetTvShow
        );
      } else {
        delete (TheMovieDb.prototype as Partial<TheMovieDb>).getTvShow;
      }
      sonarrLookup.mock.restore();
    }
  });

  it('does not expose Sonarr filesystem and operational fields', () => {
    const result = filterSonarrLookupResults([
      {
        tvdbId: 123,
        title: 'Example Series',
        year: 2026,
        overview: 'Overview',
        remotePoster: 'https://artworks.thetvdb.com/example.jpg',
        path: '/private/media/path',
        profileId: 42,
        tags: [7],
      } as SonarrSeries,
    ]);

    assert.deepStrictEqual(result, [
      {
        tvdbId: 123,
        title: 'Example Series',
        year: 2026,
        overview: 'Overview',
        remotePoster: 'https://artworks.thetvdb.com/example.jpg',
      },
    ]);
  });
});

describe('service operational detail authorization', () => {
  it('rejects service summaries after the session credential changes', async (t) => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 1 })];
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 1 });
    const oldCredentialVersion = actor.passwordChangedAt?.getTime() ?? 0;
    await userRepository.update(actor.id, {
      passwordChangedAt: new Date(oldCredentialVersion + 1_000),
    });
    t.after(() => {
      settings.radarr = [];
    });
    const staleSessionApp = express();
    staleSessionApp.use((req, _res, next) => {
      req.user = new User({
        id: actor.id,
        permissions: Permission.REQUEST_ADVANCED,
      });
      req.session = {
        userId: actor.id,
        credentialVersion: oldCredentialVersion,
      } as typeof req.session;
      next();
    });
    staleSessionApp.use('/service', serviceRoutes);
    staleSessionApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const response = await request(staleSessionApp).get('/service/radarr');

    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(response.body, {
      status: 403,
      message: 'Access denied.',
    });
  });

  it('uses persisted authority when filtering service summaries', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      makeRadarr({ id: 1, activeDirectory: '/radarr-secret' }),
    ];
    settings.sonarr = [
      makeSonarr({ id: 2, activeDirectory: '/sonarr-secret' }),
    ];
    settings.lidarr = [
      makeLidarr({ id: 3, activeDirectory: '/lidarr-secret' }),
    ];
    settings.readarr = [
      makeReadarr({ id: 4, activeDirectory: '/readarr-secret' }),
    ];
    const userRepository = getRepository(User);
    const originalActor = await userRepository.findOneByOrFail({ id: 1 });
    await userRepository.update(1, { permissions: Permission.REQUEST });
    t.after(async () => {
      settings.radarr = [];
      settings.sonarr = [];
      settings.lidarr = [];
      settings.readarr = [];
      await userRepository.update(1, {
        permissions: originalActor.permissions,
      });
    });
    const stalePermissionApp = createApp(Permission.REQUEST_ADVANCED);

    const responses = await Promise.all([
      request(stalePermissionApp).get('/service/radarr'),
      request(stalePermissionApp).get('/service/sonarr'),
      request(stalePermissionApp).get('/service/lidarr'),
      request(stalePermissionApp).get('/service/readarr'),
    ]);

    for (const response of responses) {
      assert.strictEqual(response.status, 200);
      assert.strictEqual('activeDirectory' in response.body[0], false);
      assert.strictEqual('activeProfileId' in response.body[0], false);
      assert.strictEqual('activeTags' in response.body[0], false);
    }
  });

  it('does not treat request-view permission as infrastructure access', async () => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 1 })];
    settings.sonarr = [makeSonarr({ id: 2 })];
    settings.lidarr = [makeLidarr({ id: 3 })];
    settings.readarr = [makeReadarr({ id: 4 })];
    const viewerApp = createApp(Permission.REQUEST_VIEW);

    const [summary, radarr, sonarr, lidarr, readarr] = await Promise.all([
      request(viewerApp).get('/service/radarr'),
      request(viewerApp).get('/service/radarr/1'),
      request(viewerApp).get('/service/sonarr/2'),
      request(viewerApp).get('/service/lidarr/3'),
      request(viewerApp).get('/service/readarr/4'),
    ]);

    assert.strictEqual(summary.status, 200);
    assert.strictEqual('activeDirectory' in summary.body[0], false);
    for (const response of [radarr, sonarr, lidarr, readarr]) {
      assert.strictEqual(response.status, 403);
    }
  });

  it('revalidates authority before using stored service credentials', async () => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 1 })];
    const userRepository = getRepository(User);
    let revocationStarted!: () => void;
    let releaseRevocation!: () => void;
    const revocationStartedPromise = new Promise<void>((resolve) => {
      revocationStarted = resolve;
    });
    const releaseRevocationPromise = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const profiles = mock.method(
      RadarrAPI.prototype,
      'getProfiles',
      async () => []
    );
    const revocation = runUserSecurityMutation(1, async () => {
      await userRepository.update(1, { permissions: Permission.REQUEST });
      revocationStarted();
      await releaseRevocationPromise;
    });
    await revocationStartedPromise;

    const responsePromise = request(app)
      .get('/service/radarr/1')
      .then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseRevocation();
    await revocation;

    const response = await responsePromise;
    assert.strictEqual(response.status, 403);
    assert.strictEqual(profiles.mock.callCount(), 0);
  });
});

describe('Radarr settings routes', () => {
  it('does not reuse a deleted service ID referenced by an override rule', async () => {
    await getRepository(OverrideRule).save(
      new OverrideRule({ radarrServiceId: 6 })
    );

    const response = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ name: 'Replacement Radarr' }));

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.id, 7);
    assert.strictEqual(getSettings().radarr[0].id, 7);
  });

  it('atomically rejects instances beyond the per-type ceiling', async () => {
    const settings = getSettings();
    settings.radarr = Array.from(
      { length: MAX_SERVARR_INSTANCES_PER_TYPE },
      (_, id) => makeRadarr({ id, name: `Radarr ${id}` })
    );

    const res = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ name: 'One Too Many' }));

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /maximum of 50 instances/i);
    assert.strictEqual(settings.radarr.length, MAX_SERVARR_INSTANCES_PER_TYPE);
  });

  it('does not delete or retier a service referenced by live routing state', async () => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 4 })];
    const user = await getRepository(User).findOneByOrFail({ id: 1 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 999_999_981,
        status: MediaStatus.PENDING,
      })
    );
    const activeRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: user,
        status: MediaRequestStatus.PENDING,
        serverId: 4,
        is4k: false,
      })
    );

    const deleteResponse = await request(app).delete('/settings/radarr/4');
    const retierResponse = await request(app)
      .put('/settings/radarr/4')
      .send(makeRadarr({ id: 4, is4k: true }));

    assert.strictEqual(deleteResponse.status, 409);
    assert.match(deleteResponse.body.message, /active request/i);
    assert.strictEqual(retierResponse.status, 409);
    assert.strictEqual(getSettings().radarr[0].is4k, false);

    await getRepository(MediaRequest).update(activeRequest.id, {
      status: MediaRequestStatus.COMPLETED,
    });
    const completedDelete = await request(app).delete('/settings/radarr/4');
    assert.strictEqual(completedDelete.status, 200);
  });

  it('requires override rules to be removed before their service', async () => {
    getSettings().radarr = [makeRadarr({ id: 8 })];
    const rule = await getRepository(OverrideRule).save(
      new OverrideRule({ radarrServiceId: 8 })
    );

    const blocked = await request(app).delete('/settings/radarr/8');
    assert.strictEqual(blocked.status, 409);
    assert.match(blocked.body.message, /override rule/i);
    assert.strictEqual(getSettings().radarr.length, 1);

    await getRepository(OverrideRule).remove(rule);
    const removed = await request(app).delete('/settings/radarr/8');
    assert.strictEqual(removed.status, 200);
  });

  it('rejects malformed Radarr settings bodies', async () => {
    const res = await request(app).post('/settings/radarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects malformed Servarr tag arrays before persistence', async () => {
    const nestedTagsRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ tags: [[2]] as unknown as number[] }));
    const decimalOverrideRuleRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ overrideRule: ['2.5'] as unknown as number[] }));

    assert.strictEqual(nestedTagsRes.status, 400);
    assert.match(nestedTagsRes.body.message, /tags contains an invalid value/i);
    assert.strictEqual(decimalOverrideRuleRes.status, 400);
    assert.match(
      decimalOverrideRuleRes.body.message,
      /overrideRule contains an invalid value/i
    );
    assert.strictEqual(getSettings().radarr.length, 0);
  });

  it('rejects unsafe external service URLs before persistence', async () => {
    const res = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ externalUrl: 'javascript:alert(1)' }));

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /externalUrl must be a valid HTTP URL/i);
    assert.strictEqual(getSettings().radarr.length, 0);
  });

  it('rejects malformed Servarr URL bases before persistence', async () => {
    const absoluteRes = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ baseUrl: 'https://evil.example/base' }));
    const queryRes = await request(app)
      .post('/settings/sonarr')
      .send(makeSonarr({ baseUrl: '/sonarr?redirect=1' }));
    const slashRes = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ baseUrl: '//evil.example/lidarr' }));

    assert.strictEqual(absoluteRes.status, 400);
    assert.match(absoluteRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(queryRes.status, 400);
    assert.match(queryRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(slashRes.status, 400);
    assert.match(slashRes.body.message, /baseUrl must be a relative path/i);
    assert.strictEqual(getSettings().radarr.length, 0);
    assert.strictEqual(getSettings().sonarr.length, 0);
    assert.strictEqual(getSettings().lidarr.length, 0);
  });

  it('normalizes valid Servarr URL bases before persistence', async () => {
    const res = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ baseUrl: 'bookshelf/' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(getSettings().readarr[0].baseUrl, '/bookshelf');
  });

  it('rejects string boolean Radarr payloads without changing defaults', async () => {
    getSettings().radarr = [makeRadarr({ id: 3, name: 'Primary Radarr' })];

    const res = await request(app)
      .post('/settings/radarr')
      .send(
        makeRadarr({
          name: 'String Boolean Radarr',
          isDefault: 'true' as unknown as boolean,
          is4k: 'false' as unknown as boolean,
        })
      );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be a boolean/i);
    assert.deepStrictEqual(
      getSettings().radarr.map(({ name, isDefault, is4k }) => ({
        name,
        isDefault,
        is4k,
      })),
      [{ name: 'Primary Radarr', isDefault: true, is4k: false }]
    );
  });

  it('restores Radarr defaults when persistence fails', async () => {
    const settings = getSettings();
    const original = [makeRadarr({ id: 3, name: 'Primary Radarr' })];
    settings.radarr = original;
    mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    });

    const res = await request(app)
      .post('/settings/radarr')
      .send(makeRadarr({ name: 'Rejected Radarr', isDefault: true }));

    assert.strictEqual(res.status, 500);
    assert.strictEqual(settings.radarr, original);
    assert.strictEqual(settings.radarr[0].isDefault, true);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().radarr = [makeRadarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/radarr/not-a-number')
      .send(makeRadarr({ name: 'Updated Radarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().radarr[0].name, 'Radarr');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().radarr = [makeRadarr({ id: 4 })];

    const res = await request(app).delete('/settings/radarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().radarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().radarr = [makeRadarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/radarr/0')
      .send(makeRadarr({ name: 'Updated Radarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().radarr[0].name, 'Updated Radarr');
  });

  it('restores redacted credentials only after service admission', async () => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 0, apiKey: 'initial-key' })];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holder = runWithServarrServiceAdmission(
      [{ serviceType: 'radarr', serviceId: 0 }],
      async () => {
        entered();
        await held;
      }
    );
    await enteredPromise;

    const responsePromise = request(app)
      .put('/settings/radarr/0')
      .send(
        makeRadarr({
          name: 'Queued Radarr Update',
          apiKey: '[REDACTED]',
        })
      )
      .then((response) => response);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    settings.radarr = [
      makeRadarr({ id: 0, apiKey: 'rotated-key', name: 'Rotated Radarr' }),
    ];
    release();

    const response = await responsePromise;
    await holder;
    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.radarr[0].name, 'Queued Radarr Update');
    assert.strictEqual(settings.radarr[0].apiKey, 'rotated-key');
  });

  it('does not overwrite a Servarr key rotated before the persistence callback', async () => {
    const settings = getSettings();
    settings.radarr = [makeRadarr({ id: 0, apiKey: 'initial-key' })];
    const persistSection = settings.persistSection.bind(settings);
    let intercepted = false;
    mock.method(
      settings,
      'persistSection',
      async <K extends keyof AllSettings>(
        section: K,
        update: AllSettings[K] | ((current: AllSettings[K]) => AllSettings[K])
      ): Promise<AllSettings[K]> => {
        if (!intercepted && section === 'radarr') {
          intercepted = true;
          settings.radarr = [
            makeRadarr({ id: 0, apiKey: 'rotated-key', name: 'Rotated' }),
          ];
        }
        return persistSection(section, update);
      }
    );

    const response = await request(app)
      .put('/settings/radarr/0')
      .send(
        makeRadarr({
          name: 'Updated Radarr',
          apiKey: '[REDACTED]',
        })
      );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(settings.radarr[0].name, 'Updated Radarr');
    assert.strictEqual(settings.radarr[0].apiKey, 'rotated-key');
  });

  it('tests a Radarr connection before the add form is complete', async () => {
    mock.method(RadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Radarr',
      version: '5.0.0.0',
      urlBase: '/radarr',
    }));
    mock.method(RadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'HD-1080p' },
    ]);
    mock.method(RadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 3,
        path: '/movies',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mockServarrTagsEndpoint([{ id: 4, label: 'requested' }]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/radarr/test')
      .send({
        hostname: 'radarr.local',
        port: 7878,
        apiKey: 'test-key',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.urlBase, '/radarr');
    assert.deepStrictEqual(res.body.profiles, [{ id: 1, name: 'HD-1080p' }]);
    assert.deepStrictEqual(res.body.rootFolders, [{ id: 3, path: '/movies' }]);
  });

  it('uses the stored API key when testing an existing Radarr', async () => {
    let apiKeyUsed: string | undefined;
    getSettings().radarr = [makeRadarr({ id: 7, apiKey: 'stored-key' })];
    mock.method(
      RadarrAPI.prototype,
      'getSystemStatus',
      async function (this: RadarrAPI) {
        const client = Reflect.get(this, 'axios') as {
          defaults: { params?: Record<string, string> };
        };
        apiKeyUsed = client.defaults.params?.apikey;
        return { appName: 'Radarr', version: '5.0.0.0', urlBase: '' };
      }
    );
    mock.method(RadarrAPI.prototype, 'getProfiles', async () => []);
    mock.method(RadarrAPI.prototype, 'getRootFolders', async () => []);
    mockServarrTagsEndpoint([]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/radarr/test')
      .send({
        id: 7,
        hostname: 'radarr.local',
        port: 7878,
        apiKey: '[REDACTED]',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(apiKeyUsed, 'stored-key');
  });
});

describe('Sonarr settings routes', () => {
  it('rejects malformed Sonarr settings bodies', async () => {
    const res = await request(app).post('/settings/sonarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects string boolean Sonarr payloads without changing defaults', async () => {
    getSettings().sonarr = [makeSonarr({ id: 3, name: 'Primary Sonarr' })];

    const res = await request(app)
      .post('/settings/sonarr')
      .send(
        makeSonarr({
          name: 'String Boolean Sonarr',
          isDefault: 'true' as unknown as boolean,
          is4k: 'false' as unknown as boolean,
        })
      );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be a boolean/i);
    assert.deepStrictEqual(
      getSettings().sonarr.map(({ name, isDefault, is4k }) => ({
        name,
        isDefault,
        is4k,
      })),
      [{ name: 'Primary Sonarr', isDefault: true, is4k: false }]
    );
  });

  it('rejects non-string Sonarr series type values', async () => {
    const res = await request(app)
      .post('/settings/sonarr')
      .send(
        makeSonarr({
          seriesType: ['standard'] as unknown as SonarrSettings['seriesType'],
        })
      );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /seriesType is invalid/);
    assert.strictEqual(getSettings().sonarr.length, 0);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().sonarr = [makeSonarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/sonarr/not-a-number')
      .send(makeSonarr({ name: 'Updated Sonarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().sonarr[0].name, 'Sonarr');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().sonarr = [makeSonarr({ id: 4 })];

    const res = await request(app).delete('/settings/sonarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().sonarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().sonarr = [makeSonarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/sonarr/0')
      .send(makeSonarr({ name: 'Updated Sonarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().sonarr[0].name, 'Updated Sonarr');
  });

  it('tests a Sonarr connection before the add form is complete', async () => {
    mock.method(SonarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Sonarr',
      version: '4.0.0.0',
      urlBase: '/sonarr',
    }));
    mock.method(SonarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'HD-1080p' },
    ]);
    mock.method(SonarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 3,
        path: '/tv',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mockServarrTagsEndpoint([{ id: 4, label: 'requested' }]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/sonarr/test')
      .send({
        hostname: 'sonarr.local',
        port: 8989,
        apiKey: 'test-key',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.urlBase, '/sonarr');
    assert.deepStrictEqual(res.body.profiles, [{ id: 1, name: 'HD-1080p' }]);
    assert.deepStrictEqual(res.body.rootFolders, [{ id: 3, path: '/tv' }]);
  });

  it('uses the stored API key when testing an existing Sonarr', async () => {
    let apiKeyUsed: string | undefined;
    getSettings().sonarr = [makeSonarr({ id: 7, apiKey: 'stored-key' })];
    mock.method(
      SonarrAPI.prototype,
      'getSystemStatus',
      async function (this: SonarrAPI) {
        const client = Reflect.get(this, 'axios') as {
          defaults: { params?: Record<string, string> };
        };
        apiKeyUsed = client.defaults.params?.apikey;
        return { appName: 'Sonarr', version: '4.0.0.0', urlBase: '' };
      }
    );
    mock.method(SonarrAPI.prototype, 'getProfiles', async () => []);
    mock.method(SonarrAPI.prototype, 'getRootFolders', async () => []);
    mockServarrTagsEndpoint([]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/sonarr/test')
      .send({
        id: 7,
        hostname: 'sonarr.local',
        port: 8989,
        apiKey: '[REDACTED]',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(apiKeyUsed, 'stored-key');
  });
});

describe('Lidarr settings routes', () => {
  it('rejects malformed Lidarr settings bodies', async () => {
    const res = await request(app).post('/settings/lidarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app)
      .put('/settings/lidarr/not-a-number')
      .send(makeLidarr({ name: 'Updated Lidarr' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().lidarr[0].name, 'Lidarr');
  });

  it('rejects malformed settings IDs before profile lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app).get(
      '/settings/lidarr/not-a-number/profiles'
    );

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().lidarr = [makeLidarr({ id: 4 })];

    const res = await request(app).delete('/settings/lidarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().lidarr.length, 1);
  });

  it('rejects malformed service detail IDs before external calls', async () => {
    const res = await request(app).get('/service/lidarr/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('updates settings instance zero', async () => {
    getSettings().lidarr = [makeLidarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/lidarr/0')
      .send(makeLidarr({ name: 'Updated Lidarr' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().lidarr[0].name, 'Updated Lidarr');
  });

  it('keeps only the newest default Lidarr server active', async () => {
    const first = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ name: 'Primary Lidarr', isDefault: true }));
    const second = await request(app)
      .post('/settings/lidarr')
      .send(makeLidarr({ name: 'Replacement Lidarr', isDefault: true }));

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().lidarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      [
        { id: 0, name: 'Primary Lidarr', isDefault: false },
        { id: 1, name: 'Replacement Lidarr', isDefault: true },
      ]
    );
  });

  it('promotes another Lidarr server when deleting the default', async () => {
    getSettings().lidarr = [
      makeLidarr({ id: 4, name: 'Primary Lidarr', isDefault: true }),
      makeLidarr({ id: 5, name: 'Backup Lidarr', isDefault: false }),
    ];

    const res = await request(app).delete('/settings/lidarr/4');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      getSettings().lidarr.map(({ id, name, isDefault }) => ({
        id,
        name,
        isDefault,
      })),
      [{ id: 5, name: 'Backup Lidarr', isDefault: true }]
    );
  });

  it('returns Lidarr service summaries with metadata profile and tags', async () => {
    getSettings().lidarr = [
      makeLidarr({
        id: 4,
        name: 'Music Backend',
        activeDirectory: '/music',
        activeProfileId: 11,
        activeMetadataProfileId: 22,
        tags: [3, 5],
      }),
    ];

    const res = await request(app).get('/service/lidarr');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 4,
        name: 'Music Backend',
        is4k: false,
        isDefault: true,
        activeDirectory: '/music',
        activeProfileId: 11,
        activeMetadataProfileId: 22,
        activeTags: [3, 5],
      },
    ]);
  });

  it('hides Lidarr operational details from users without service detail permissions', async () => {
    getSettings().lidarr = [
      makeLidarr({
        id: 4,
        name: 'Music Backend',
        activeDirectory: '/music',
        activeProfileId: 11,
        activeMetadataProfileId: 22,
        tags: [3, 5],
      }),
    ];

    const res = await request(createApp(Permission.REQUEST)).get(
      '/service/lidarr'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 4,
        name: 'Music Backend',
        is4k: false,
        isDefault: true,
      },
    ]);
  });

  it('tests a Lidarr connection before the add form is complete', async () => {
    mock.method(LidarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Lidarr',
      version: '2.0.0.0',
      urlBase: '/lidarr',
    }));
    mock.method(LidarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(LidarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 2, name: 'Standard' },
    ]);
    mock.method(LidarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 3,
        path: '/music',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mockServarrTagsEndpoint([{ id: 4, label: 'requested' }]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/lidarr/test')
      .send({
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.urlBase, '/lidarr');
    assert.deepStrictEqual(res.body.profiles, [{ id: 1, name: 'Standard' }]);
    assert.deepStrictEqual(res.body.metadataProfiles, [
      { id: 2, name: 'Standard' },
    ]);
    assert.deepStrictEqual(res.body.rootFolders, [{ id: 3, path: '/music' }]);
  });

  it('uses the stored API key when testing an existing Lidarr', async () => {
    let apiKeyUsed: string | undefined;
    getSettings().lidarr = [makeLidarr({ id: 7, apiKey: 'stored-key' })];
    mock.method(
      LidarrAPI.prototype,
      'getSystemStatus',
      async function (this: LidarrAPI) {
        const client = Reflect.get(this, 'axios') as {
          defaults: { params?: Record<string, string> };
        };
        apiKeyUsed = client.defaults.params?.apikey;
        return { appName: 'Lidarr', version: '2.0.0.0', urlBase: '' };
      }
    );
    mock.method(LidarrAPI.prototype, 'getProfiles', async () => []);
    mock.method(LidarrAPI.prototype, 'getMetadataProfiles', async () => []);
    mock.method(LidarrAPI.prototype, 'getRootFolders', async () => []);
    mockServarrTagsEndpoint([]);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/lidarr/test')
      .send({
        id: 7,
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: '[REDACTED]',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(apiKeyUsed, 'stored-key');
  });
});

describe('Bookshelf settings routes', () => {
  it('rejects malformed Bookshelf settings bodies', async () => {
    const res = await request(app).post('/settings/readarr').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /settings must be an object/i);
  });

  it('tests a Bookshelf connection before the add form is complete', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Bookshelf',
      version: '0.4.20.129',
      urlBase: '/bookshelf',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'https://api.hardcover.app',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 2, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 3,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/readarr/test')
      .send({
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.urlBase, '/bookshelf');
    assert.deepStrictEqual(res.body.profiles, [{ id: 1, name: 'eBook' }]);
    assert.deepStrictEqual(res.body.metadataProfiles, [
      { id: 2, name: 'Standard' },
    ]);
    assert.deepStrictEqual(res.body.rootFolders, [{ id: 3, path: '/books' }]);
  });

  it('uses the stored API key when testing an existing Bookshelf', async () => {
    let apiKeyUsed: string | undefined;
    getSettings().readarr = [makeReadarr({ id: 7, apiKey: 'stored-key' })];
    mock.method(
      ReadarrAPI.prototype,
      'getSystemStatus',
      async function (this: ReadarrAPI) {
        const client = Reflect.get(this, 'axios') as {
          defaults: { params?: Record<string, string> };
        };
        apiKeyUsed = client.defaults.params?.apikey;
        return {
          appName: 'Bookshelf',
          version: '0.4.20.129',
          urlBase: '',
        };
      }
    );
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'https://api.hardcover.app',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => []);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => []);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => []);

    const res = await request(createOpenApiApp())
      .post('/api/v1/settings/readarr/test')
      .send({
        id: 7,
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: '[REDACTED]',
        useSsl: false,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(apiKeyUsed, 'stored-key');
  });

  it('rejects malformed settings IDs before update lookup', async () => {
    getSettings().readarr = [makeReadarr({ id: 7 })];

    const res = await request(app)
      .put('/settings/readarr/not-a-number')
      .send(makeReadarr({ name: 'Updated Bookshelf' }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().readarr[0].name, 'Bookshelf');
  });

  it('rejects malformed settings IDs before delete lookup', async () => {
    getSettings().readarr = [makeReadarr({ id: 7 })];

    const res = await request(app).delete('/settings/readarr/not-a-number');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getSettings().readarr.length, 1);
  });

  it('updates settings instance zero', async () => {
    getSettings().readarr = [makeReadarr({ id: 0 })];

    const res = await request(app)
      .put('/settings/readarr/0')
      .send(makeReadarr({ name: 'Updated Bookshelf' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().readarr[0].name, 'Updated Bookshelf');
  });

  it('keeps separate default Bookshelf servers per book format', async () => {
    const first = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ name: 'Primary Bookshelf', isDefault: true }));
    const second = await request(app)
      .post('/settings/readarr')
      .send(
        makeReadarr({
          name: 'Replacement Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
        })
      );

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().readarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 0,
          name: 'Primary Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        },
        {
          id: 1,
          name: 'Replacement Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
        },
      ]
    );
  });

  it('keeps only the newest default Bookshelf server active for the same format', async () => {
    const first = await request(app)
      .post('/settings/readarr')
      .send(makeReadarr({ name: 'Primary Ebook Bookshelf', isDefault: true }));
    const second = await request(app)
      .post('/settings/readarr')
      .send(
        makeReadarr({
          name: 'Replacement Ebook Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        })
      );

    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);

    const servers = getSettings().readarr;
    assert.deepStrictEqual(
      servers.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 0,
          name: 'Primary Ebook Bookshelf',
          isDefault: false,
          serviceType: 'ebook',
        },
        {
          id: 1,
          name: 'Replacement Ebook Bookshelf',
          isDefault: true,
          serviceType: 'ebook',
        },
      ]
    );
  });

  it('promotes another Bookshelf server for the same format when deleting the default', async () => {
    getSettings().readarr = [
      makeReadarr({ id: 7, name: 'Primary Ebook', isDefault: true }),
      makeReadarr({ id: 8, name: 'Backup Ebook', isDefault: false }),
      makeReadarr({
        id: 9,
        name: 'Audio Bookshelf',
        isDefault: true,
        serviceType: 'audiobook',
      }),
    ];

    const res = await request(app).delete('/settings/readarr/7');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      getSettings().readarr.map(({ id, name, isDefault, serviceType }) => ({
        id,
        name,
        isDefault,
        serviceType,
      })),
      [
        {
          id: 8,
          name: 'Backup Ebook',
          isDefault: true,
          serviceType: 'ebook',
        },
        {
          id: 9,
          name: 'Audio Bookshelf',
          isDefault: true,
          serviceType: 'audiobook',
        },
      ]
    );
  });

  it('returns Bookshelf/Readarr service summaries with metadata profile and tags', async () => {
    getSettings().readarr = [
      makeReadarr({
        id: 7,
        name: 'Books Backend',
        activeDirectory: '/books',
        activeProfileId: 12,
        activeMetadataProfileId: 23,
        tags: [8, 13],
      }),
    ];

    const res = await request(app).get('/service/readarr');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 7,
        name: 'Books Backend',
        is4k: false,
        isDefault: true,
        activeDirectory: '/books',
        activeProfileId: 12,
        activeMetadataProfileId: 23,
        activeTags: [8, 13],
        serviceType: 'ebook',
      },
    ]);
  });

  it('diagnoses unreachable Bookshelf backends', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'backend_unreachable');
    assert.match(res.body.message, /ECONNREFUSED/);
  });

  it('rejects malformed Bookshelf diagnostic inputs before outbound calls', async () => {
    const getSystemStatus = mock.method(
      ReadarrAPI.prototype,
      'getSystemStatus',
      async () => ({ appName: 'Readarr', version: '1', urlBase: '' })
    );

    const oversizedTerm = await request(app)
      .post('/settings/readarr/diagnose')
      .send({ ...makeReadarr(), term: 'x'.repeat(513) });
    const stringBoolean = await request(app)
      .post('/settings/readarr/diagnose')
      .send({ ...makeReadarr(), testAdd: 'true' });

    assert.strictEqual(oversizedTerm.status, 400);
    assert.strictEqual(oversizedTerm.body.category, 'invalid_request');
    assert.strictEqual(stringBoolean.status, 400);
    assert.strictEqual(stringBoolean.body.category, 'invalid_request');
    assert.strictEqual(getSystemStatus.mock.callCount(), 0);
  });

  it('diagnoses empty Bookshelf lookups', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => []);

    const res = await request(app).post('/settings/readarr/diagnose').send({
      hostname: 'bookshelf.local',
      port: 8787,
      apiKey: 'test-key',
      useSsl: false,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'lookup_empty');
    assert.strictEqual(res.body.lookupCount, 0);
  });

  it('diagnoses incomplete Bookshelf lookups', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'Broken Result',
        foreignBookId: 'broken-id',
      },
    ]);

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr({ activeDirectory: '/books' }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'lookup_incomplete');
    assert.strictEqual(res.body.sample[0].authorPresent, false);
  });

  it('bounds Bookshelf diagnostic result hydration', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Bookshelf',
      version: '1',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'https://api.hardcover.app',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => []);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => []);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => []);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () =>
      Array.from(
        { length: MAX_DIAGNOSTIC_LOOKUP_RESULTS + 10 },
        (_, index) => ({
          title: `Book ${index}`,
          foreignBookId: `book-${index}`,
          foreignEditionId: `edition-${index}`,
          authorTitle: `Author ${index}, First Book ${index}`,
        })
      )
    );
    let active = 0;
    let peak = 0;
    let calls = 0;
    mock.method(ReadarrAPI.prototype, 'lookupAuthor', async (term: string) => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return [{ foreignAuthorId: term, authorName: term }];
    });

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send(makeReadarr());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(calls, MAX_DIAGNOSTIC_LOOKUP_RESULTS);
    assert.ok(peak <= DIAGNOSTIC_LOOKUP_HYDRATION_CONCURRENCY);
  });

  it('diagnoses add rejections after lookup succeeds', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'The Hobbit',
        foreignBookId: '1540236',
        author: {
          foreignAuthorId: '656983',
          authorName: 'J.R.R. Tolkien',
        },
        editions: [
          {
            foreignEditionId: '5907',
            title: 'The Hobbit',
            monitored: true,
          },
        ],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'addBook', async () => {
      throw new Error('[Readarr] Failed to add book: rejected');
    });

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send({
        ...makeReadarr({
          activeDirectory: '/books',
          activeMetadataProfileId: 1,
        }),
        testAdd: true,
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.category, 'backend_add_rejected');
    assert.match(res.body.message, /rejected/);
  });

  it('refuses diagnostic add selections not advertised by Bookshelf', async () => {
    mock.method(ReadarrAPI.prototype, 'getSystemStatus', async () => ({
      appName: 'Readarr',
      version: '0.4.20.129',
      urlBase: '',
    }));
    mock.method(ReadarrAPI.prototype, 'getDevelopmentConfig', async () => ({
      id: 1,
      metadataSource: 'http://127.0.0.1:8790',
    }));
    mock.method(ReadarrAPI.prototype, 'getProfiles', async () => [
      { id: 1, name: 'eBook' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getMetadataProfiles', async () => [
      { id: 1, name: 'Standard' },
    ]);
    mock.method(ReadarrAPI.prototype, 'getRootFolders', async () => [
      {
        id: 1,
        path: '/books',
        accessible: true,
        freeSpace: 1,
        totalSpace: 1,
        unmappedFolders: [],
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'The Hobbit',
        foreignBookId: '1540236',
        author: {
          foreignAuthorId: '656983',
          authorName: 'J.R.R. Tolkien',
        },
        editions: [
          {
            foreignEditionId: '5907',
            title: 'The Hobbit',
            monitored: true,
          },
        ],
      },
    ]);
    const addBook = mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async () => ({ id: 1 }) as never
    );

    const res = await request(app)
      .post('/settings/readarr/diagnose')
      .send({
        ...makeReadarr(),
        testAdd: true,
        activeDirectory: '/not-advertised',
        activeProfileId: 999,
        activeMetadataProfileId: 999,
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.category, 'invalid_request');
    assert.strictEqual(addBook.mock.callCount(), 0);
  });

  it('hides Bookshelf operational details from users without service detail permissions', async () => {
    getSettings().readarr = [
      makeReadarr({
        id: 7,
        name: 'Books Backend',
        activeDirectory: '/books',
        activeProfileId: 12,
        activeMetadataProfileId: 23,
        tags: [8, 13],
      }),
    ];

    const res = await request(createApp(Permission.REQUEST)).get(
      '/service/readarr'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, [
      {
        id: 7,
        name: 'Books Backend',
        is4k: false,
        isDefault: true,
        serviceType: 'ebook',
      },
    ]);
  });
});
