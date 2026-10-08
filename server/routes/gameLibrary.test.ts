import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import QuestarrNGAPI from '@server/api/software/questarrng';
import SteamAPI from '@server/api/software/steam';
import type { SoftwareCatalogGame } from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import GameLibraryAccount from '@server/entity/GameLibraryAccount';
import GameLibraryEntry from '@server/entity/GameLibraryEntry';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Request } from 'express';
import express, { type Express } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import gameLibraryRoutes from './gameLibrary';

setupTestDb();

const catalogGame: SoftwareCatalogGame = {
  id: 'igdb-42',
  igdbId: 42,
  title: 'Catalog Game',
  summary: 'A catalog summary.',
  coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg',
  releaseDate: '2025-01-01',
  platforms: ['PC (Microsoft Windows)'],
  platformOptions: [{ id: 6, name: 'PC (Microsoft Windows)' }],
  genres: ['Adventure'],
};

type TestSession = Record<string, unknown> & { userId: number };

const createApp = (
  userId = 2,
  sessionOverrides: Record<string, unknown> = {}
): { app: Express; session: TestSession } => {
  const session = {
    userId,
    credentialVersion: 0,
    ...sessionOverrides,
  } as TestSession;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session as unknown as Request['session'];
    next();
  });
  app.use(checkUser);
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
      validateRequests: true,
      validateResponses: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/game-library', gameLibraryRoutes);
  app.use(
    (
      error: { status?: number | string; message?: string },
      _req: express.Request,
      res: express.Response,
      // Express identifies error handlers by their four-argument signature.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res.status(Number(error.status ?? 500)).json({
        status: Number(error.status ?? 500),
        message: error.message,
      })
  );
  return { app, session };
};

const configureSettings = () => {
  const settings = getSettings();
  settings.main.applicationUrl = 'https://seerr.test';
  settings.main.apiKey = 'game-library-test-api-key';
  settings.softwareAcquisition = {
    romarr: {
      hostname: '127.0.0.1',
      port: 6868,
      useSsl: false,
      baseUrl: '',
      apiKey: 'romarr-test-key',
    },
    questarr: {
      hostname: '127.0.0.1',
      port: 3000,
      useSsl: false,
      baseUrl: '',
      apiKey: 'questarr-test-key',
    },
    emulationCatalogProvider: 'questarr',
    emulationSystemGroups: {},
    emulationPlatformMappings: {},
    steamApiKey: 'steam-server-test-key',
  };
};

const manualEntry = (values: Partial<GameLibraryEntry> = {}) =>
  getRepository(GameLibraryEntry).save(
    new GameLibraryEntry({
      userId: 2,
      externalKey: 'manual:test-game',
      catalogId: null,
      category: 'game',
      title: 'Test Game',
      summary: '',
      coverUrl: '',
      releaseDate: '',
      status: 'backlog',
      isOwned: false,
      steamAppId: null,
      steamOwned: false,
      playtimeMinutes: 0,
      storeName: '',
      platformName: '',
      shareWithHousehold: false,
      source: 'manual',
      lastSyncedAt: null,
      ...values,
    })
  );

beforeEach(() => configureSettings());
afterEach(() => mock.restoreAll());

describe('game library routes', () => {
  it('limits game library requests per user outside test mode', async () => {
    const testEnvironment = process.env as Record<string, string | undefined>;
    const previousNodeEnv = testEnvironment.NODE_ENV;
    const previousE2eTests = testEnvironment.E2E_TESTS;
    testEnvironment.NODE_ENV = 'production';
    delete testEnvironment.E2E_TESTS;

    try {
      const app = createApp().app;
      const statuses: number[] = [];
      for (let index = 0; index < 121; index += 1) {
        const response = await request(app)
          .get('/api/v1/game-library/steam/connect')
          .redirects(0);
        statuses.push(response.status);
      }

      assert.equal(statuses.filter((status) => status === 429).length, 1);
      assert.equal(statuses.filter((status) => status === 302).length, 120);
    } finally {
      if (previousNodeEnv === undefined) delete testEnvironment.NODE_ENV;
      else testEnvironment.NODE_ENV = previousNodeEnv;

      if (previousE2eTests === undefined) delete testEnvironment.E2E_TESTS;
      else testEnvironment.E2E_TESTS = previousE2eTests;
    }
  });

  it('keeps libraries private by default and groups only explicitly shared owned games', async () => {
    const ownerApp = createApp(2).app;
    const householdApp = createApp(3).app;
    const ownerEntry = await request(ownerApp)
      .post('/api/v1/game-library/manual')
      .send({ title: 'Shared Title', category: 'game', isOwned: true });
    const householdEntry = await request(householdApp)
      .post('/api/v1/game-library/manual')
      .send({
        title: 'Shared Title',
        category: 'game',
        isOwned: true,
        shareWithHousehold: true,
        status: 'playing',
        storeName: 'Steam',
      });

    assert.equal(ownerEntry.status, 201, JSON.stringify(ownerEntry.body));
    assert.equal(
      householdEntry.status,
      201,
      JSON.stringify(householdEntry.body)
    );
    assert.equal(ownerEntry.body.entry.shareWithHousehold, false);

    const ownerLibrary = await request(ownerApp).get('/api/v1/game-library');
    const privateSharedPage = await request(ownerApp)
      .get('/api/v1/game-library/shared')
      .query({ minOwners: 2 });
    assert.equal(ownerLibrary.status, 200, JSON.stringify(ownerLibrary.body));
    assert.equal(ownerLibrary.body.total, 1);
    assert.equal(privateSharedPage.status, 200);
    assert.equal(privateSharedPage.body.total, 0);

    const otherUserUpdate = await request(householdApp)
      .patch(`/api/v1/game-library/${ownerEntry.body.entry.id}`)
      .send({ status: 'completed' });
    assert.equal(otherUserUpdate.status, 404);

    const shared = await request(ownerApp)
      .patch(`/api/v1/game-library/${ownerEntry.body.entry.id}`)
      .send({ shareWithHousehold: true });
    assert.equal(shared.status, 200);
    const overlap = await request(ownerApp)
      .get('/api/v1/game-library/shared')
      .query({ minOwners: 2 });

    assert.equal(overlap.status, 200);
    assert.equal(overlap.body.total, 1);
    assert.equal(overlap.body.results[0].ownerCount, 2);
    assert.deepEqual(
      overlap.body.results[0].owners
        .map((owner: { displayName: string }) => owner.displayName)
        .sort(),
      ['demo', 'friend']
    );
    assert.equal('email' in overlap.body.results[0].owners[0], false);
  });

  it('preserves progress and privacy when a catalog title is added again', async () => {
    mock.method(
      QuestarrNGAPI.prototype,
      'getCatalogGame',
      async () => catalogGame
    );
    const existing = await manualEntry({
      externalKey: 'igdb:42',
      catalogId: 42,
      title: 'Old Catalog Title',
      status: 'completed',
      isOwned: true,
      shareWithHousehold: true,
    });
    const response = await request(createApp().app)
      .post('/api/v1/game-library')
      .send({ category: 'game', catalogId: 42 });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.entry.title, 'Catalog Game');
    assert.equal(response.body.entry.status, 'completed');
    assert.equal(response.body.entry.isOwned, true);
    assert.equal(response.body.entry.shareWithHousehold, true);
    assert.equal(response.body.entry.id, existing.id);

    const lookup = await request(createApp().app)
      .get('/api/v1/game-library/lookup')
      .query({ category: 'game', catalogId: 42 });
    assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
    assert.equal(lookup.body.entry.id, existing.id);
  });

  it('stores the validated catalog ID when adding a new catalog title', async () => {
    mock.method(
      QuestarrNGAPI.prototype,
      'getCatalogGame',
      async () => catalogGame
    );

    const response = await request(createApp().app)
      .post('/api/v1/game-library')
      .send({ category: 'game', catalogId: 42 });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.entry.catalogId, 42);
    assert.equal(response.body.entry.externalKey, 'igdb:42');
  });

  it('preserves unmatched library state when a title is linked with minimal input', async () => {
    mock.method(
      QuestarrNGAPI.prototype,
      'getCatalogGame',
      async () => catalogGame
    );
    const imported = await manualEntry({
      status: 'completed',
      isOwned: true,
      storeName: 'GOG',
      platformName: 'Linux',
      shareWithHousehold: true,
    });

    const response = await request(createApp().app)
      .post(`/api/v1/game-library/${imported.id}/match`)
      .send({ category: 'game', catalogId: 42 });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.entry.status, 'completed');
    assert.equal(response.body.entry.isOwned, true);
    assert.equal(response.body.entry.storeName, 'GOG');
    assert.equal(response.body.entry.platformName, 'Linux');
    assert.equal(response.body.entry.shareWithHousehold, true);
  });

  it('allows household sharing for a Steam-owned match and retains Steam facts', async () => {
    mock.method(
      QuestarrNGAPI.prototype,
      'getCatalogGame',
      async () => catalogGame
    );
    const imported = await manualEntry({
      externalKey: 'steam:413150',
      source: 'steam',
      steamAppId: 413150,
      steamOwned: true,
      playtimeMinutes: 125,
      status: 'playing',
      storeName: 'Steam',
      platformName: 'PC',
    });

    const response = await request(createApp().app)
      .post(`/api/v1/game-library/${imported.id}/match`)
      .send({
        category: 'game',
        catalogId: 42,
        status: 'playing',
        isOwned: false,
        storeName: 'Steam',
        platformName: 'PC',
        shareWithHousehold: true,
      });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.entry.shareWithHousehold, true);
    assert.equal(response.body.entry.steamOwned, true);
    assert.equal(response.body.entry.playtimeMinutes, 125);
    assert.equal(response.body.entry.storeName, 'Steam');
  });

  it('requires a signed-in browser session for changes, even with an API key', async () => {
    const app = createApp(1, { userId: undefined }).app;
    const apiKey = getSettings().main.apiKey;
    const response = await request(app)
      .post('/api/v1/game-library/manual')
      .set('X-Api-Key', apiKey)
      .send({ title: 'Private entry' });

    assert.equal(response.status, 403);
    assert.equal(
      await getRepository(GameLibraryEntry).count({
        where: { title: 'Private entry' },
      }),
      0
    );
  });

  it('starts a session-bound Steam OpenID redirect and rejects a mismatched callback state', async () => {
    const { app, session } = createApp();
    const start = await request(app).get('/api/v1/game-library/steam/connect');
    assert.equal(start.status, 302, JSON.stringify(start.body));
    const destination = new URL(start.headers.location);
    const state = destination.searchParams
      .get('openid.return_to')
      ?.split('state=')[1];
    assert.match(
      destination.origin + destination.pathname,
      /^https:\/\/steamcommunity\.com\/openid\/login$/
    );
    assert.equal(typeof session.steamOpenIdState, 'string');
    assert.equal(state, session.steamOpenIdState);

    const verify = mock.method(
      SteamAPI.prototype,
      'verifyOpenIdAssertion',
      async () => true
    );
    const callback = await request(app)
      .get('/api/v1/game-library/steam/callback')
      .query({ state: 'c'.repeat(64) });

    assert.equal(callback.status, 302);
    assert.match(callback.headers.location, /steam=error/);
    assert.equal(verify.mock.callCount(), 0);
    assert.equal(await getRepository(GameLibraryAccount).count(), 0);
  });

  it('verifies the Steam issuer and signed identity before linking, then consumes state once', async () => {
    const state = 'b'.repeat(64);
    const { app, session } = createApp(2, {
      steamOpenIdState: state,
      steamOpenIdStateCreatedAt: Date.now(),
    });
    const verify = mock.method(
      SteamAPI.prototype,
      'verifyOpenIdAssertion',
      async () => true
    );
    const steamId = '76561198000000002';
    const callbackQuery = {
      state,
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'id_res',
      'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
      'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
      'openid.return_to': `https://seerr.test/api/v1/game-library/steam/callback?state=${state}`,
      'openid.response_nonce': new Date()
        .toISOString()
        .replace(/\.\d{3}Z$/u, 'Z'),
      'openid.signed': 'claimed_id:identity:return_to:response_nonce',
    };

    const linked = await request(app)
      .get('/api/v1/game-library/steam/callback')
      .query(callbackQuery);
    assert.equal(linked.status, 302, JSON.stringify(linked.body));
    assert.match(linked.headers.location, /steam=connected/);
    assert.equal(
      await getRepository(GameLibraryAccount).count({ where: { userId: 2 } }),
      1
    );
    assert.equal(verify.mock.callCount(), 1);
    assert.equal(session.steamOpenIdState, undefined);

    const replay = await request(app)
      .get('/api/v1/game-library/steam/callback')
      .query(callbackQuery);
    assert.equal(replay.status, 302);
    assert.match(replay.headers.location, /steam=error/);
    assert.equal(verify.mock.callCount(), 1);
  });

  it('does not expose Steam identifiers and clears verified ownership when unlinked', async () => {
    await getRepository(GameLibraryAccount).save(
      new GameLibraryAccount({ userId: 2, steamId: '76561198000000002' })
    );
    const entry = await manualEntry({
      externalKey: 'steam:10',
      title: 'Imported Game',
      source: 'steam',
      steamAppId: 10,
      steamOwned: true,
      shareWithHousehold: true,
      playtimeMinutes: 180,
      storeName: 'Steam',
    });
    const app = createApp().app;

    const status = await request(app).get('/api/v1/game-library/steam/status');
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.connected, true);
    assert.equal('steamId' in status.body, false);
    assert.doesNotMatch(JSON.stringify(status.body), /76561198000000002/);

    const unlinked = await request(app).delete('/api/v1/game-library/steam');
    assert.equal(unlinked.status, 204);
    assert.equal(await getRepository(GameLibraryAccount).count(), 0);
    const retainedEntry = await getRepository(GameLibraryEntry).findOneByOrFail(
      { id: entry.id }
    );
    assert.equal(retainedEntry.steamOwned, false);
    assert.equal(retainedEntry.shareWithHousehold, false);
    assert.equal(retainedEntry.playtimeMinutes, 180);
    assert.equal(retainedEntry.storeName, '');
  });
});
