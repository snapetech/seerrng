import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
import type {
  PcGameVariant,
  SoftwareAssetsResponse,
  SoftwareCatalogGame,
  SoftwareProviderRequest,
} from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import SoftwareRequest, {
  type SoftwareRequestProvider,
  type SoftwareRequestStatus,
} from '@server/entity/SoftwareRequest';
import SoftwareRequestStatusEvent from '@server/entity/SoftwareRequestStatusEvent';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { refreshTrackedSoftwareRequests } from '@server/lib/softwareRequests';
import logger from '@server/logger';
import { setupTestDb } from '@server/test/db';
import { AxiosError } from 'axios';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';
import softwareAcquisitionRoutes from './settings/softwareAcquisition';
import softwareRoutes from './software';

setupTestDb();

const pcGame: SoftwareCatalogGame = {
  id: 'igdb-42',
  igdbId: 42,
  title: 'Test Game',
  summary: 'A test game.',
  coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg',
  releaseDate: '2024-01-01',
  platforms: ['PC (Microsoft Windows)'],
  platformOptions: [{ id: 6, name: 'PC (Microsoft Windows)' }],
  genres: ['Adventure'],
};

const acceptedRequest = (
  externalRequestId: string,
  status: SoftwareProviderRequest['status'] = 'accepted'
): SoftwareProviderRequest => ({
  externalRequestId,
  status,
  deliverable: false,
});

const providerSettings = () => {
  const settings = getSettings();
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
    emulationSystemGroups: { nes: 'retro' },
    emulationPlatformMappings: {},
    steamApiKey: '',
  };
};

const createApp = (userId = 2, permissions = Permission.REQUEST): Express => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = new User({ id: userId, permissions });
    next();
  });
  app.use('/request/software', softwareRoutes);
  app.use(
    (
      error: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // Express identifies error handlers by their four-argument signature.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res.status(error.status ?? 500).json({
        status: error.status ?? 500,
        message: error.message,
      })
  );
  return app;
};

const createOpenApiValidatedApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = new User({ id: 2, permissions: Permission.REQUEST });
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/request/software', softwareRoutes);
  app.use(
    (
      error: { status?: number | string; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res.status(Number(error.status ?? 500)).json({
        status: Number(error.status ?? 500),
        message: error.message,
      })
  );
  return app;
};

const createOpenApiValidatedSettingsApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = new User({ id: 1, permissions: Permission.ADMIN });
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
      validateRequests: true,
      validateSecurity: false,
    })
  );
  app.use('/api/v1/settings/software-acquisition', softwareAcquisitionRoutes);
  app.use(
    (
      error: { status?: number | string; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) =>
      res.status(Number(error.status ?? 500)).json({
        status: Number(error.status ?? 500),
        message: error.message,
      })
  );
  return app;
};

const createSoftwareRequest = async (options: {
  category?: 'retro' | 'modern' | 'game';
  provider?: SoftwareRequestProvider;
  status?: SoftwareRequestStatus;
  requestedById?: number;
  externalRequestId?: string;
}) => {
  const repository = getRepository(SoftwareRequest);
  return repository.save(
    repository.create({
      requestedById: options.requestedById ?? 2,
      category: options.category ?? 'retro',
      provider: options.provider ?? 'romarr',
      status: options.status ?? 'failed',
      externalRequestId: options.externalRequestId ?? 'seerrng:software:test',
      catalogId: 42,
      catalogProvider: 'igdb',
      catalogKey: '42',
      title: 'Test Game',
      summary: null,
      coverUrl: null,
      platformSlug: 'nes',
      platformName: 'Nintendo Entertainment System',
      platformId: 130,
      operatingSystem: null,
      architecture: null,
      attempt: 1,
      providerStage: null,
      failureCode: null,
      errorMessage: null,
      lastCheckedAt: null,
    })
  );
};

beforeEach(() => {
  providerSettings();
  mock.method(QuestarrNGAPI.prototype, 'lookupLibrary', async () => ({
    games: [],
  }));
  mock.method(ROMarrNGAPI.prototype, 'lookupLibrary', async () => ({
    ready: true,
    partial: false,
    matches: [],
  }));
});

afterEach(() => {
  mock.restoreAll();
});

describe('software request routes', () => {
  it('filters software requests by category before pagination', async () => {
    await createSoftwareRequest({
      category: 'retro',
      externalRequestId: 'seerrng:software:category-retro',
    });
    await createSoftwareRequest({
      category: 'modern',
      externalRequestId: 'seerrng:software:category-modern',
    });
    await createSoftwareRequest({
      category: 'game',
      externalRequestId: 'seerrng:software:category-game',
    });

    const response = await request(createApp())
      .get('/request/software/status')
      .query({ category: 'modern', take: 1, skip: 0 });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results.length, 1);
    assert.strictEqual(response.body.results[0].request.category, 'modern');
    assert.strictEqual(response.body.pageInfo.pages, 1);
    assert.strictEqual(response.body.pageInfo.results, 1);
  });

  it('rejects unknown software request categories', async () => {
    const response = await request(createApp())
      .get('/request/software/status')
      .query({ category: 'arcade' });

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(response.body, {
      error: 'Invalid software category.',
    });
  });

  it('lets the requester clear a cancelled request and its status history', async () => {
    const saved = await createSoftwareRequest({
      status: 'cancelled',
      externalRequestId: 'seerrng:software:clear-cancelled',
    });
    await getRepository(SoftwareRequestStatusEvent).save({
      requestId: saved.id,
      requestedById: saved.requestedById,
      status: 'cancelled',
      message: 'The acquisition was cancelled.',
      percent: null,
      fingerprint: 'cancelled:clear-test',
      createdAt: new Date(),
    });

    const response = await request(createApp()).delete(
      `/request/software/status/${saved.id}`
    );

    assert.strictEqual(response.status, 204);
    assert.strictEqual(
      await getRepository(SoftwareRequest).countBy({ id: saved.id }),
      0
    );
    assert.strictEqual(
      await getRepository(SoftwareRequestStatusEvent).countBy({
        requestId: saved.id,
      }),
      0
    );
  });

  it('only lets request owners or managers clear cancelled requests', async () => {
    const cancelled = await createSoftwareRequest({
      status: 'cancelled',
      externalRequestId: 'seerrng:software:clear-owner',
    });
    const managerTarget = await createSoftwareRequest({
      status: 'cancelled',
      externalRequestId: 'seerrng:software:clear-manager',
    });
    const active = await createSoftwareRequest({
      status: 'searching',
      externalRequestId: 'seerrng:software:clear-active',
    });

    const outsiderResponse = await request(
      createApp(3, Permission.REQUEST)
    ).delete(`/request/software/status/${cancelled.id}`);
    const managerResponse = await request(
      createApp(1, Permission.MANAGE_REQUESTS)
    ).delete(`/request/software/status/${managerTarget.id}`);
    const activeResponse = await request(createApp()).delete(
      `/request/software/status/${active.id}`
    );

    assert.strictEqual(outsiderResponse.status, 404);
    assert.strictEqual(managerResponse.status, 204);
    assert.strictEqual(activeResponse.status, 409);
    assert.strictEqual(
      await getRepository(SoftwareRequest).countBy({ id: cancelled.id }),
      1
    );
    assert.strictEqual(
      await getRepository(SoftwareRequest).countBy({ id: active.id }),
      1
    );
  });

  it('reconciles tracked requests using the effective last-check order', async () => {
    const saved = await createSoftwareRequest({
      status: 'approved',
      externalRequestId: 'seerrng:software:reconciliation-order',
    });
    const refreshed: string[] = [];
    mock.method(
      ROMarrNGAPI.prototype,
      'getRequest',
      async (externalRequestId: string) => {
        refreshed.push(externalRequestId);
        return acceptedRequest(externalRequestId);
      }
    );

    await refreshTrackedSoftwareRequests();

    assert.deepStrictEqual(refreshed, [saved.externalRequestId]);
  });

  it('stores provider progress and safe failure codes in request history', async () => {
    const saved = await createSoftwareRequest({
      status: 'approved',
      externalRequestId: 'seerrng:software:progress-history',
    });
    let providerStatus: SoftwareProviderRequest = {
      ...acceptedRequest(saved.externalRequestId, 'downloading'),
      stage: 'downloading',
      percent: 38.5,
    };
    mock.method(
      ROMarrNGAPI.prototype,
      'getRequest',
      async () => providerStatus
    );

    const progress = await request(createApp()).get(
      `/request/software/status/${saved.id}`
    );
    assert.strictEqual(progress.status, 200);
    assert.strictEqual(progress.body.request.percent, 38.5);
    assert.strictEqual(progress.body.request.stage, 'downloading');
    assert.strictEqual(progress.body.history[0].percent, 38.5);
    assert.strictEqual(progress.body.history[0].providerStage, 'downloading');

    providerStatus = {
      ...acceptedRequest(saved.externalRequestId, 'failed'),
      stage: 'failed',
      percent: 143,
      failureCode: 'IMPORT_FAILED',
      failureMessage: 'A private path must not be shown to users.',
    };
    const failed = await request(createApp()).get(
      `/request/software/status/${saved.id}`
    );
    assert.strictEqual(failed.status, 200);
    assert.strictEqual(failed.body.request.percent, null);
    assert.strictEqual(failed.body.request.failureCode, 'IMPORT_FAILED');
    assert.strictEqual(
      failed.body.request.error,
      'The download could not be imported into the library.'
    );
    assert.doesNotMatch(JSON.stringify(failed.body), /private path/);
    assert.strictEqual(failed.body.history.length, 2);
    assert.strictEqual(failed.body.history[1].failureCode, 'IMPORT_FAILED');
  });

  it('marks PC titles already owned in QuestarrNG as available', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [pcGame],
      nextCursor: null,
    }));
    mock.method(QuestarrNGAPI.prototype, 'lookupLibrary', async () => ({
      games: [{ igdbId: 42, status: 'owned' }],
    }));

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results[0].availability, 'available');
  });

  it('redacts provider credentials from catalog availability error logs', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [pcGame],
      nextCursor: null,
    }));
    mock.method(QuestarrNGAPI.prototype, 'lookupLibrary', async () => {
      throw new Error('Provider rejected api_key=software-provider-secret');
    });
    const warnLog = mock.method(logger, 'warn', () => undefined);

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results[0].availability, 'unknown');
    assert.doesNotMatch(
      JSON.stringify(warnLog.mock.calls[0].arguments),
      /software-provider-secret/
    );
  });

  it('keeps unmatched ROM titles unknown when ROMarrNG has a partial library cache', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 130, name: 'Nintendo Entertainment System' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [
        {
          ...pcGame,
          platforms: ['Nintendo Entertainment System'],
          platformOptions: [{ id: 130, name: 'Nintendo Entertainment System' }],
        },
      ],
      nextCursor: null,
    }));
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
    ]);
    mock.method(ROMarrNGAPI.prototype, 'lookupLibrary', async () => ({
      ready: true,
      partial: true,
      matches: [],
    }));

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Test Game' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.results[0].availability, 'unknown');

    await createSoftwareRequest({ status: 'pending' });
    const tracked = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Test Game' });
    assert.strictEqual(tracked.body.results[0].availability, 'tracked');
  });

  it('returns a sanitized, shareable catalog detail for a PC game', async () => {
    const getGame = mock.method(
      QuestarrNGAPI.prototype,
      'getCatalogGame',
      async () => ({
        ...pcGame,
        steamAppId: 570,
        timeToBeat: {
          hastily: 1.5,
          normally: 24.25,
          completely: Number.POSITIVE_INFINITY,
        },
        coverUrl: 'https://evil.example/cover.jpg',
        rating: 87,
        screenshots: [
          'https://images.igdb.com/igdb/image/upload/screenshot.jpg',
          'https://evil.example/screenshot.jpg',
        ],
        videos: [
          { name: 'Trailer', videoId: 'abcdefghijk' },
          { name: 'Invalid', videoId: 'bad-id' },
        ],
      })
    );

    const response = await request(createOpenApiValidatedApp())
      .get('/api/v1/request/software/catalog/games/42')
      .query({ category: 'game' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(getGame.mock.calls[0].arguments[0], 42);
    assert.strictEqual(response.body.game.title, 'Test Game');
    assert.strictEqual(response.body.game.coverUrl, '');
    assert.strictEqual(response.body.game.rating, 8.7);
    assert.strictEqual(response.body.game.steamAppId, 570);
    assert.deepStrictEqual(response.body.game.timeToBeat, {
      hastily: 1.5,
      normally: 24.25,
    });
    assert.deepStrictEqual(response.body.game.screenshots, [
      'https://images.igdb.com/igdb/image/upload/screenshot.jpg',
    ]);
    assert.deepStrictEqual(response.body.game.videos, [
      { name: 'Trailer', videoId: 'abcdefghijk' },
    ]);
  });

  it('rejects a catalog detail outside the selected category', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogGame', async () => pcGame);
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
    ]);

    const response = await request(createApp())
      .get('/request/software/catalog/games/42')
      .query({ category: 'retro' });

    assert.strictEqual(response.status, 404);
  });

  it('rejects a malformed catalog detail ID before calling QuestarrNG', async () => {
    const getGame = mock.method(QuestarrNGAPI.prototype, 'getCatalogGame');

    const response = await request(createApp())
      .get('/request/software/catalog/games/42oops')
      .query({ category: 'game' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(getGame.mock.callCount(), 0);
  });

  it('blocks catalog access and new requests for a disabled software category', async () => {
    const settings = getSettings();
    const original = { ...settings.main.enabledMediaCategories };
    settings.main.enabledMediaCategories = { ...original, retro: false };

    try {
      const search = await request(createApp())
        .get('/request/software/catalog/search')
        .query({ category: 'retro', q: 'Test Game' });
      const create = await request(createApp()).post('/request/software').send({
        category: 'retro',
        catalogId: pcGame.igdbId,
        platformSlug: 'nes',
      });

      assert.strictEqual(search.status, 403);
      assert.match(search.body.error, /retro emulation requests are disabled/);
      assert.strictEqual(create.status, 403);
      assert.match(create.body.error, /retro emulation requests are disabled/);
    } finally {
      settings.main.enabledMediaCategories = original;
    }
  });

  it('serves and validates software provider settings at the documented URLs', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(QuestarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'QuestarrNG',
      version: '1.6.0',
      apiVersion: 1,
      requestContractVersion: 1,
      capabilities: {
        catalog: true,
        pcAcquisition: true,
        emulationAcquisition: false,
        requestActions: { retry: true, cancel: true },
        assetStreaming: true,
      },
    }));

    const settings = await request(app).get(
      '/api/v1/settings/software-acquisition'
    );
    const connection = await request(app)
      .post('/api/v1/settings/software-acquisition/test/questarr')
      .send({
        hostname: '127.0.0.1',
        port: 3000,
        useSsl: false,
        baseUrl: '',
        apiKey: 'questarr-test-key',
      });
    const oldCamelCasePath = await request(app).get(
      '/api/v1/settings/softwareAcquisition'
    );

    assert.strictEqual(settings.status, 200);
    assert.strictEqual(settings.body.emulationCatalogProvider, 'questarr');
    assert.strictEqual(connection.status, 200);
    assert.strictEqual(connection.body.service, 'QuestarrNG');
    assert.deepStrictEqual(connection.body.capabilities, {
      catalog: true,
      pcAcquisition: true,
      emulationAcquisition: false,
      requestActions: { retry: true, cancel: true },
      assetStreaming: true,
    });
    assert.strictEqual(oldCamelCasePath.status, 404);
  });

  it('redacts the Steam Web API key from software settings responses', async () => {
    const app = createOpenApiValidatedSettingsApp();
    getSettings().softwareAcquisition.steamApiKey = 'steam-private-test-key';

    const response = await request(app).get(
      '/api/v1/settings/software-acquisition'
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.steamApiKey, '[REDACTED]');
    assert.equal(response.body.steamApiKeyConfigured, true);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /steam-private-test-key/
    );
  });

  it('saves and clears the Steam Web API key without returning its value', async () => {
    const app = createOpenApiValidatedSettingsApp();
    const saved = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({ steamApiKey: 'steam-new-private-key' });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.steamApiKey, '[REDACTED]');
    assert.equal(saved.body.steamApiKeyConfigured, true);
    assert.equal(
      getSettings().softwareAcquisition.steamApiKey,
      'steam-new-private-key'
    );

    const cleared = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({ steamApiKey: '' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.steamApiKey, '');
    assert.equal(cleared.body.steamApiKeyConfigured, false);
  });

  it('accepts the current QuestarrNG handshake without optional capabilities', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(QuestarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'questarr',
      apiVersion: 1,
      requestContractVersion: 1,
    }));

    const response = await request(app)
      .post('/api/v1/settings/software-acquisition/test/questarr')
      .send({
        hostname: '127.0.0.1',
        port: 3000,
        useSsl: false,
        baseUrl: '',
        apiKey: 'questarr-test-key',
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.service, 'QuestarrNG');
    assert.strictEqual('capabilities' in response.body, false);
  });

  it('validates and persists the selected emulation catalog provider', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'ROMarrNG',
      version: '1.0.0',
      apiVersion: 1,
      requestContractVersion: 1,
      capabilities: {
        catalog: true,
        pcAcquisition: false,
        emulationAcquisition: true,
        requestActions: { retry: true, cancel: true },
        assetStreaming: true,
      },
    }));
    const response = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({
        emulationCatalogProvider: 'romarr',
        emulationSystemGroups: { nes: 'retro' },
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.emulationCatalogProvider, 'romarr');
    assert.strictEqual(
      getSettings().softwareAcquisition.emulationCatalogProvider,
      'romarr'
    );

    const invalid = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({ emulationCatalogProvider: 'unknown' });
    assert.strictEqual(invalid.status, 400);
  });

  it('previews unique platform matches and returns unmatched systems', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo Entertainment System',
        aliases: ['Nintendo'],
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
      {
        slug: 'unknown',
        name: 'Unlisted Console',
        media: 'rom',
        extensions: ['.rom'],
        max_size_mb: 16,
      },
    ]);
    mock.method(ROMarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 130, name: 'Nintendo Entertainment System' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);

    const response = await request(app).get(
      '/api/v1/settings/software-acquisition/platform-mapping/preview'
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.systems[0].status, 'automatic');
    assert.strictEqual(response.body.systems[0].automaticMatch.id, 130);
    assert.deepStrictEqual(response.body.unmatchedSystems, [
      { slug: 'unknown', name: 'Unlisted Console' },
    ]);
    assert.deepStrictEqual(response.body.unmatchedCatalogPlatforms, [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
  });

  it('requires ROMarrNG DAT catalog capability before selecting the DAT source', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'ROMarrNG',
      apiVersion: 1,
      requestContractVersion: 2,
      capabilities: {
        catalog: false,
        datCatalog: true,
        pcAcquisition: false,
        emulationAcquisition: true,
        requestActions: { retry: true, cancel: true },
        assetStreaming: true,
      },
    }));

    const response = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({ emulationCatalogProvider: 'romarr-dat' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.emulationCatalogProvider, 'romarr-dat');
  });

  it('requires ROMarrNG to advertise catalog support before selecting it', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'romarr',
      version: '0.9.0',
      apiVersion: 1,
    }));

    const response = await request(app)
      .put('/api/v1/settings/software-acquisition')
      .send({
        romarr: {
          hostname: '127.0.0.1',
          port: 6868,
          useSsl: false,
          baseUrl: '',
          apiKey: 'romarr-test-key',
        },
        emulationCatalogProvider: 'romarr',
      });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.error, /does not advertise.*IGDB catalog/i);
  });

  it('rejects a QuestarrNG handshake missing its required catalog contract', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(QuestarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'QuestarrNG',
      version: '1.6.0',
      apiVersion: 1,
      requestContractVersion: 1,
      capabilities: {
        catalog: false,
        pcAcquisition: true,
        emulationAcquisition: false,
        requestActions: { retry: true, cancel: true },
        assetStreaming: true,
      },
    }));

    const response = await request(app)
      .post('/api/v1/settings/software-acquisition/test/questarr')
      .send({
        hostname: '127.0.0.1',
        port: 3000,
        useSsl: false,
        baseUrl: '',
        apiKey: 'questarr-test-key',
      });

    assert.strictEqual(response.status, 502);
    assert.match(response.body.error, /unsupported integration contract/i);
  });

  it('reports API-key rejection without exposing provider response details', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(QuestarrNGAPI.prototype, 'getHandshake', async () => {
      throw Object.assign(new AxiosError('private provider body and key'), {
        response: { status: 401 },
      });
    });

    const response = await request(app)
      .post('/api/v1/settings/software-acquisition/test/questarr')
      .send({
        hostname: '127.0.0.1',
        port: 3000,
        useSsl: false,
        baseUrl: '',
        apiKey: 'questarr-test-key',
      });

    assert.strictEqual(response.status, 502);
    assert.match(response.body.error, /rejected the API key \(HTTP 401\)/);
    assert.match(response.body.error, /integration handshake/);
    assert.doesNotMatch(
      response.body.error,
      /private provider body|questarr-test-key/
    );
  });

  it('reports connection failures with the failing provider phase', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'romarr',
      apiVersion: 1,
      capabilities: {
        catalog: true,
        pcAcquisition: false,
        emulationAcquisition: true,
        requestActions: { retry: true, cancel: true },
        assetStreaming: true,
      },
    }));
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => {
      throw Object.assign(new AxiosError('private provider body'), {
        code: 'ECONNREFUSED',
      });
    });

    const response = await request(app)
      .post('/api/v1/settings/software-acquisition/test/romarr')
      .send({
        hostname: 'romarr.test',
        port: 6868,
        useSsl: false,
        baseUrl: '',
        apiKey: 'romarr-test-key',
      });

    assert.strictEqual(response.status, 502);
    assert.match(response.body.error, /ROMarrNG refused the connection/);
    assert.match(response.body.error, /platform list/);
    assert.match(response.body.error, /hostname and port/);
    assert.doesNotMatch(
      response.body.error,
      /private provider body|romarr-test-key/
    );
  });

  it('refreshes ROMarr systems while testing edited settings and reports the count', async () => {
    const app = createOpenApiValidatedSettingsApp();
    mock.method(ROMarrNGAPI.prototype, 'getHandshake', async () => ({
      service: 'romarr',
      version: 'test',
      apiVersion: 1,
    }));
    let forceFresh: boolean | undefined;
    mock.method(
      ROMarrNGAPI.prototype,
      'getPlatforms',
      async (skipCache = false) => {
        forceFresh = skipCache;
        return [
          {
            slug: 'nes',
            name: 'Nintendo Entertainment System',
            media: 'rom',
            extensions: ['.nes'],
            max_size_mb: 512,
          },
        ];
      }
    );

    const response = await request(app)
      .post('/api/v1/settings/software-acquisition/test/romarr')
      .send({
        hostname: 'romarr-edited.test',
        port: 6868,
        useSsl: false,
        baseUrl: '',
        apiKey: 'edited-romarr-key',
      });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(forceFresh, true);
    assert.strictEqual(response.body.apiVersion, 1);
    assert.strictEqual(response.body.platformCount, 1);
  });

  it('validates the ROMarr retry confirmation against the OpenAPI contract', async () => {
    const app = createOpenApiValidatedApp();
    const valid = await request(app)
      .post('/api/v1/request/software/status/999/retry')
      .send({ confirmNoExistingDownload: true });
    const invalid = await request(app)
      .post('/api/v1/request/software/status/999/retry')
      .send({ confirmNoExistingDownload: 'yes' });

    assert.strictEqual(valid.status, 404);
    assert.strictEqual(invalid.status, 400);
  });

  it('keeps recent console generations distinct in the modern catalog', async () => {
    const systems = [
      { slug: 'ps4', name: 'PlayStation 4', aliases: [], id: 48 },
      { slug: 'ps5', name: 'PlayStation 5', aliases: [], id: 167 },
      { slug: 'xboxone', name: 'Xbox One', aliases: [], id: 49 },
      {
        slug: 'series-x-s',
        name: 'Xbox Series X/S',
        aliases: ['Xbox Series X|S'],
        id: 169,
      },
    ];
    for (const system of systems) {
      getSettings().softwareAcquisition.emulationSystemGroups[system.slug] =
        'modern';
    }
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () =>
      systems.map((system) => ({
        ...system,
        media: 'package',
        extensions: ['.pkg'],
        max_size_mb: 524288,
      }))
    );
    const platforms = systems.map((system) => ({
      id: system.id,
      name: system.aliases[0] ?? system.name,
    }));
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      ...platforms,
      { id: 9, name: 'PlayStation 3' },
      { id: 12, name: 'Xbox 360' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    const search = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalogPage',
      async () => ({
        results: systems.map((system, index) => ({
          ...pcGame,
          igdbId: 200 + index,
          platforms: [platforms[index].name],
          platformOptions: [platforms[index]],
        })),
        nextCursor: null,
      })
    );
    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'modern', q: 'Test Game' });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      search.mock.calls[0].arguments[3],
      systems.map((system) => system.id)
    );
    assert.deepStrictEqual(
      response.body.results.map(
        (game: { emulationSystems: { slug: string }[] }) =>
          game.emulationSystems.map((system) => system.slug)
      ),
      systems.map((system) => [system.slug])
    );
  });

  it('preserves each recent-console target through approval and dispatch', async () => {
    const systems = [
      { slug: 'ps4', name: 'PlayStation 4', id: 48 },
      { slug: 'ps5', name: 'PlayStation 5', id: 167 },
      { slug: 'xboxone', name: 'Xbox One', id: 49 },
      { slug: 'series-x-s', name: 'Xbox Series X/S', id: 169 },
    ];
    for (const system of systems) {
      getSettings().softwareAcquisition.emulationSystemGroups[system.slug] =
        'modern';
    }
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () =>
      systems.map((system) => ({
        ...system,
        media: 'package',
        extensions: ['.pkg'],
        max_size_mb: 524288,
      }))
    );
    mock.method(QuestarrNGAPI.prototype, 'getCatalogGame', async () => ({
      ...pcGame,
      platformOptions: systems.map(({ id, name }) => ({ id, name })),
    }));
    mock.method(ROMarrNGAPI.prototype, 'getRequest', async () => {
      throw Object.assign(new Error('Request not found.'), {
        response: { status: 404 },
      });
    });
    const dispatched: {
      externalRequestId: string;
      platform: string;
      catalogId: number;
      platformId: number;
    }[] = [];
    mock.method(
      ROMarrNGAPI.prototype,
      'createRequest',
      async (
        externalRequestId: string,
        _title: string,
        platform: string,
        catalogId: number,
        platformId: number
      ) => {
        dispatched.push({
          externalRequestId,
          platform,
          catalogId,
          platformId,
        });
        return acceptedRequest(externalRequestId);
      }
    );
    for (const system of systems) {
      const created = await request(createApp())
        .post('/request/software')
        .send({
          category: 'modern',
          catalogId: pcGame.igdbId,
          platformSlug: system.slug,
        });
      assert.strictEqual(created.status, 201);
      const saved = await getRepository(SoftwareRequest).findOneByOrFail({
        id: created.body.request.id,
      });
      assert.strictEqual(saved.provider, 'romarr');
      assert.strictEqual(saved.platformSlug, system.slug);
      assert.strictEqual(saved.platformId, system.id);
      const approved = await request(
        createApp(1, Permission.MANAGE_REQUESTS)
      ).post(`/request/software/status/${saved.id}/approve`);
      assert.strictEqual(approved.status, 200);
      assert.deepStrictEqual(dispatched.at(-1), {
        externalRequestId: saved.externalRequestId,
        platform: system.slug,
        catalogId: pcGame.igdbId,
        platformId: system.id,
      });
    }
  });

  it('maps ROMarr aliases into the assigned emulation catalog', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 130, name: 'Nintendo Entertainment System' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [
        {
          ...pcGame,
          platforms: ['Nintendo Entertainment System'],
          platformOptions: [{ id: 130, name: 'Nintendo Entertainment System' }],
        },
      ],
      nextCursor: null,
    }));
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo',
        aliases: ['Nintendo Entertainment System'],
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
    ]);

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Test Game' });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body.results[0].emulationSystems, [
      {
        slug: 'nes',
        name: 'Nintendo',
        group: 'retro',
        catalogPlatformId: 130,
      },
    ]);
  });

  it('browses DAT titles, keeps DAT keys, and submits the same identity to ROMarrNG', async () => {
    getSettings().softwareAcquisition.emulationCatalogProvider = 'romarr-dat';
    getSettings().softwareAcquisition.emulationSystemGroups = { snes: 'retro' };
    const catalogKey = `dat-${'0'.repeat(64)}`;
    const datGame: SoftwareCatalogGame = {
      id: catalogKey,
      catalogProvider: 'dat',
      catalogId: catalogKey,
      title: 'Chrono Trigger',
      summary: '',
      coverUrl: '',
      releaseDate: '',
      platforms: ['Super Nintendo Entertainment System'],
      platformOptions: [
        { key: 'snes', name: 'Super Nintendo Entertainment System' },
      ],
      genres: [],
      source: 'DAT',
      dat: {
        name: 'Nintendo - Super Nintendo Entertainment System',
        version: '2026',
        entry: 'Chrono Trigger (USA)',
        variants: 2,
      },
    };
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'snes',
        name: 'Super Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.sfc'],
        max_size_mb: 32,
      },
    ]);
    mock.method(ROMarrNGAPI.prototype, 'getDatCatalogPlatforms', async () => ({
      results: [{ slug: 'snes', name: 'SNES', gameCount: 1 }],
      unmatchedDatNames: [],
    }));
    const searchDat = mock.method(
      ROMarrNGAPI.prototype,
      'searchDatCatalogPage',
      async () => ({ results: [datGame], nextCursor: null })
    );
    const browseDat = mock.method(
      ROMarrNGAPI.prototype,
      'browseDatCatalogPage',
      async () => ({ results: [datGame], nextOffset: 24 })
    );
    const getDatGame = mock.method(
      ROMarrNGAPI.prototype,
      'getDatCatalogGame',
      async () => datGame
    );

    const systems = await request(createApp()).get(
      '/request/software/catalog/systems'
    );
    const search = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Chrono Trigger' });
    const browse = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({ category: 'retro', limit: 24 });
    const detail = await request(createApp())
      .get(`/request/software/catalog/games/${catalogKey}`)
      .query({ category: 'retro', catalogProvider: 'dat' });

    assert.strictEqual(systems.status, 200);
    assert.strictEqual(systems.body.catalogProvider, 'dat');
    assert.deepStrictEqual(systems.body.catalogSystemSlugs, ['snes']);
    assert.strictEqual(search.status, 200);
    assert.strictEqual(search.body.results[0].catalogProvider, 'dat');
    assert.strictEqual(search.body.results[0].catalogId, catalogKey);
    assert.deepStrictEqual(search.body.results[0].emulationSystems, [
      {
        slug: 'snes',
        name: 'Super Nintendo Entertainment System',
        group: 'retro',
        catalogPlatformKey: 'snes',
      },
    ]);
    assert.deepStrictEqual(searchDat.mock.calls[0].arguments, [
      'Chrono Trigger',
      24,
      undefined,
      ['snes'],
    ]);
    assert.strictEqual(browse.status, 200);
    assert.strictEqual(browse.body.results[0].catalogId, catalogKey);
    assert.strictEqual(browse.body.nextOffset, 24);
    assert.deepStrictEqual(browseDat.mock.calls[0].arguments, [
      24,
      0,
      ['snes'],
    ]);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.game.catalogProvider, 'dat');
    assert.strictEqual(getDatGame.mock.calls.length, 1);

    const created = await request(createApp()).post('/request/software').send({
      category: 'retro',
      catalogProvider: 'dat',
      catalogKey,
      platformSlug: 'snes',
    });
    assert.strictEqual(created.status, 201);
    const saved = await getRepository(SoftwareRequest).findOneByOrFail({
      id: created.body.request.id,
    });
    assert.strictEqual(saved.catalogProvider, 'dat');
    assert.strictEqual(saved.catalogId, null);
    assert.strictEqual(saved.catalogKey, catalogKey);
    assert.strictEqual(saved.platformId, null);

    mock.method(ROMarrNGAPI.prototype, 'getRequest', async () => {
      throw Object.assign(new Error('Request not found.'), {
        response: { status: 404 },
      });
    });
    const dispatched: unknown[] = [];
    mock.method(
      ROMarrNGAPI.prototype,
      'createRequest',
      async (
        externalRequestId: string,
        title: string,
        platform: string,
        _catalogId?: number,
        _platformId?: number,
        identity?: { catalogKey: string; platformSlug: string }
      ) => {
        dispatched.push({ externalRequestId, title, platform, identity });
        return acceptedRequest(externalRequestId);
      }
    );
    const approval = await request(
      createApp(1, Permission.MANAGE_REQUESTS)
    ).post(`/request/software/status/${saved.id}/approve`);
    assert.strictEqual(approval.status, 200);
    assert.deepStrictEqual(dispatched[0], {
      externalRequestId: saved.externalRequestId,
      title: 'Chrono Trigger',
      platform: 'snes',
      identity: { catalogKey, platformSlug: 'snes' },
    });
  });

  it('passes ROM platform IDs and a search cursor to QuestarrNG', async () => {
    getSettings().softwareAcquisition.emulationSystemGroups.snes = 'retro';
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
      { id: 130, name: 'Nintendo Entertainment System' },
      { id: 19, name: 'Super Nintendo Entertainment System' },
    ]);
    const searchPage = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalogPage',
      async () => ({
        results: [
          {
            ...pcGame,
            igdbId: 100,
            platformOptions: [
              { id: 130, name: 'Nintendo Entertainment System' },
            ],
          },
        ],
        nextCursor: 'next-page+/=',
      })
    );
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
      {
        slug: 'snes',
        name: 'Super Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.sfc'],
        max_size_mb: 32,
      },
    ]);

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({
        category: 'retro',
        q: 'Test Game',
        limit: 1,
        cursor: 'prior.cursor+/=',
        system: 'nes',
        genre: 'Adventure',
        releaseYear: '1992',
      });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(searchPage.mock.calls[0].arguments, [
      'Test Game',
      1,
      'prior.cursor+/=',
      [130],
      'Adventure',
      1992,
    ]);
    assert.strictEqual(response.body.nextCursor, 'next-page+/=');
    assert.deepStrictEqual(
      response.body.results.map((game: { igdbId: number }) => game.igdbId),
      [100]
    );
  });

  it('uses unpaged game results when QuestarrNG paged search fails', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    const pagedSearch = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalogPage',
      async () => {
        throw Object.assign(new AxiosError('Bad gateway'), {
          response: { status: 502 },
        });
      }
    );
    const unpagedSearch = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalog',
      async () => [
        {
          ...pcGame,
          igdbId: 2650,
          id: 'igdb-2650',
          title: 'Prison Architect',
        },
      ]
    );

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Prison Architect' });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      response.body.results.map((game: SoftwareCatalogGame) => game.title),
      ['Prison Architect']
    );
    assert.strictEqual(response.body.nextCursor, null);
    assert.strictEqual(pagedSearch.mock.callCount(), 1);
    assert.deepStrictEqual(unpagedSearch.mock.calls[0].arguments, [
      'Prison Architect',
      50,
    ]);
  });

  it('does not hide QuestarrNG search transport errors with unpaged results', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => {
      throw new AxiosError('Network Error');
    });
    const unpagedSearch = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalog',
      async () => [pcGame]
    );

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Prison Architect' });

    assert.notStrictEqual(response.status, 200);
    assert.strictEqual(unpagedSearch.mock.callCount(), 0);
  });

  it('uses the selected ROMarr catalog for emulation and keeps Questarr for PC games', async () => {
    getSettings().softwareAcquisition.emulationCatalogProvider = 'romarr';
    const emulationGame = {
      ...pcGame,
      igdbId: 1300,
      platforms: ['Nintendo Entertainment System'],
      platformOptions: [{ id: 130, name: 'Nintendo Entertainment System' }],
    };
    mock.method(ROMarrNGAPI.prototype, 'getPlatforms', async () => [
      {
        slug: 'nes',
        name: 'Nintendo Entertainment System',
        media: 'rom',
        extensions: ['.nes'],
        max_size_mb: 16,
      },
    ]);
    mock.method(ROMarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 130, name: 'Nintendo Entertainment System' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    const romarrSearch = mock.method(
      ROMarrNGAPI.prototype,
      'searchCatalogPage',
      async () => ({ results: [emulationGame], nextCursor: null })
    );
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    const questarrSearch = mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalogPage',
      async () => ({ results: [pcGame], nextCursor: null })
    );

    const emulation = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Test Game' });
    const pc = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game' });

    assert.strictEqual(emulation.status, 200);
    assert.deepStrictEqual(romarrSearch.mock.calls[0].arguments[3], [130]);
    assert.strictEqual(emulation.body.results[0].igdbId, 1300);
    assert.strictEqual(pc.status, 200);
    assert.strictEqual(questarrSearch.mock.callCount(), 1);
    assert.strictEqual(pc.body.results[0].igdbId, pcGame.igdbId);
  });

  it('explains when the selected ROMarr catalog contract is unavailable', async () => {
    getSettings().softwareAcquisition.emulationCatalogProvider = 'romarr';
    const unavailable = Object.assign(new AxiosError('Not found'), {
      response: { status: 404 },
    });
    mock.method(ROMarrNGAPI.prototype, 'getCatalogPlatforms', async () => {
      throw unavailable;
    });

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'retro', q: 'Test Game' });

    assert.strictEqual(response.status, 503);
    assert.match(response.body.error, /configure IGDB/i);
    assert.match(response.body.error, /select QuestarrNG/i);
  });

  it('only returns catalog cover URLs from the IGDB image host', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [
        pcGame,
        {
          ...pcGame,
          igdbId: 2,
          coverUrl: 'https://images.igdb.com.attacker.test/cover.jpg',
        },
        {
          ...pcGame,
          igdbId: 3,
          coverUrl: 'https://127.0.0.1/cover.jpg',
        },
      ],
      nextCursor: null,
    }));

    const response = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game' });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      response.body.results.map((game: { coverUrl: string }) => game.coverUrl),
      [
        'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg',
        '',
        '',
      ]
    );
  });

  it('passes the next popular offset and PC platform IDs to QuestarrNG', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
      { id: 3, name: 'Linux' },
      { id: 130, name: 'Nintendo Entertainment System' },
    ]);
    const popularPage = mock.method(
      QuestarrNGAPI.prototype,
      'getPopularCatalogPage',
      async () => ({
        results: [
          {
            ...pcGame,
            platformOptions: [{ id: 3, name: 'Linux' }],
          },
        ],
        nextOffset: 48,
      })
    );

    const response = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({
        category: 'game',
        limit: 24,
        offset: 24,
        platform: 'linux',
        genre: 'Strategy',
        releaseYear: '2020',
      });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(popularPage.mock.calls[0].arguments, [
      24,
      24,
      [3],
      'Strategy',
      2020,
    ]);
    assert.strictEqual(response.body.nextOffset, 48);
  });

  it('rejects system and PC platform filters on the wrong categories', async () => {
    const game = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game', system: 'nes' });
    const retro = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({ category: 'retro', platform: 'linux' });

    assert.strictEqual(game.status, 400);
    assert.strictEqual(retro.status, 400);
  });

  it('rejects invalid catalog metadata filters', async () => {
    const invalidGenre = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game', genre: ' ' });
    const invalidYear = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({ category: 'game', releaseYear: '2020abc' });
    assert.strictEqual(invalidGenre.status, 400);
    assert.strictEqual(invalidYear.status, 400);
  });

  it('stops pagination when QuestarrNG returns a repeated cursor or offset', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => ({
      results: [pcGame],
      nextCursor: 'same.cursor+/=',
    }));
    mock.method(QuestarrNGAPI.prototype, 'getPopularCatalogPage', async () => ({
      results: [pcGame],
      nextOffset: 24,
    }));

    const searchResponse = await request(createApp())
      .get('/request/software/catalog/search')
      .query({
        category: 'game',
        q: 'Test Game',
        cursor: 'same.cursor+/=',
      });
    const popularResponse = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({ category: 'game', offset: 24 });

    assert.strictEqual(searchResponse.status, 200);
    assert.strictEqual(searchResponse.body.nextCursor, null);
    assert.strictEqual(popularResponse.status, 200);
    assert.strictEqual(popularResponse.body.nextOffset, null);
  });

  it('shows the complete legacy QuestarrNG window when paged endpoints are unavailable', async () => {
    mock.method(QuestarrNGAPI.prototype, 'getCatalogPlatforms', async () => [
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
    const unavailable = Object.assign(new AxiosError('Not found'), {
      response: { status: 404 },
    });
    mock.method(QuestarrNGAPI.prototype, 'searchCatalogPage', async () => {
      throw unavailable;
    });
    mock.method(QuestarrNGAPI.prototype, 'getPopularCatalogPage', async () => {
      throw unavailable;
    });
    const legacyGames = Array.from({ length: 50 }, (_, index) => ({
      ...pcGame,
      igdbId: index + 1,
    }));
    mock.method(
      QuestarrNGAPI.prototype,
      'searchCatalog',
      async () => legacyGames
    );
    mock.method(
      QuestarrNGAPI.prototype,
      'getPopularCatalog',
      async () => legacyGames
    );

    const searchResponse = await request(createApp())
      .get('/request/software/catalog/search')
      .query({ category: 'game', q: 'Test Game', limit: 24 });
    const popularResponse = await request(createApp())
      .get('/request/software/catalog/popular')
      .query({ category: 'game', limit: 24 });

    assert.strictEqual(searchResponse.status, 200);
    assert.strictEqual(searchResponse.body.results.length, 50);
    assert.strictEqual(searchResponse.body.nextCursor, null);
    assert.strictEqual(popularResponse.status, 200);
    assert.strictEqual(popularResponse.body.results.length, 50);
    assert.strictEqual(popularResponse.body.nextOffset, null);
  });

  it('persists the selected PC target and sends it to QuestarrNG on approval', async () => {
    const forbidden = await request(createApp(2, Permission.NONE))
      .post('/request/software')
      .send({
        category: 'game',
        catalogId: pcGame.igdbId,
        variant: { operatingSystem: 'linux', architecture: 'arm64' },
      });
    assert.strictEqual(forbidden.status, 403);

    mock.method(QuestarrNGAPI.prototype, 'getCatalogGame', async () => pcGame);
    const response = await request(createApp())
      .post('/request/software')
      .send({
        category: 'game',
        catalogId: pcGame.igdbId,
        variant: { operatingSystem: 'linux', architecture: 'arm64' },
      });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.request.status, 'pending');

    const saved = await getRepository(SoftwareRequest).findOneByOrFail({
      id: response.body.request.id,
    });
    assert.strictEqual(saved.operatingSystem, 'linux');
    assert.strictEqual(saved.architecture, 'arm64');

    const dispatched: unknown[] = [];
    mock.method(QuestarrNGAPI.prototype, 'getRequest', async () => {
      throw Object.assign(new Error('Request not found.'), {
        response: { status: 404 },
      });
    });
    mock.method(
      QuestarrNGAPI.prototype,
      'createRequest',
      async (
        externalRequestId: string,
        title: string,
        variant: PcGameVariant
      ) => {
        dispatched.push({ externalRequestId, title, variant });
        return acceptedRequest(externalRequestId);
      }
    );

    const approval = await request(
      createApp(1, Permission.MANAGE_REQUESTS)
    ).post(`/request/software/status/${saved.id}/approve`);

    assert.strictEqual(approval.status, 200);
    assert.deepStrictEqual(dispatched[0], {
      externalRequestId: saved.externalRequestId,
      title: 'Test Game',
      variant: { operatingSystem: 'linux', architecture: 'arm64' },
    });
  });

  it('keeps uncertain ROMarr retries failed until the requester confirms and dispatch succeeds', async () => {
    const saved = await createSoftwareRequest({});
    const storedUser = await getRepository(User).findOneByOrFail({ id: 3 });
    storedUser.permissions = Permission.REQUEST_VIEW;
    await getRepository(User).save(storedUser);

    mock.method(
      ROMarrNGAPI.prototype,
      'getRequest',
      async (externalRequestId: string) =>
        acceptedRequest(externalRequestId, 'failed')
    );
    const retryCalls: boolean[] = [];
    mock.method(
      ROMarrNGAPI.prototype,
      'retryRequest',
      async (externalRequestId: string, confirmNoExistingDownload = false) => {
        retryCalls.push(confirmNoExistingDownload);
        if (!confirmNoExistingDownload) {
          throw Object.assign(new Error('Confirmation is required.'), {
            response: {
              status: 409,
              data: {
                confirmationRequired: 'confirmNoExistingDownload',
              },
            },
          });
        }
        if (retryCalls.length === 2) {
          throw new Error('Temporary provider timeout.');
        }
        return acceptedRequest(externalRequestId, 'searching');
      }
    );

    const viewerResponse = await request(
      createApp(3, Permission.REQUEST_VIEW)
    ).post(`/request/software/status/${saved.id}/retry`);
    assert.strictEqual(viewerResponse.status, 403);

    const app = createApp();
    const confirmation = await request(app).post(
      `/request/software/status/${saved.id}/retry`
    );
    assert.strictEqual(confirmation.status, 409);
    assert.strictEqual(
      confirmation.body.confirmationRequired,
      'confirmNoExistingDownload'
    );

    const afterConfirmation = await getRepository(
      SoftwareRequest
    ).findOneByOrFail({ id: saved.id });
    assert.strictEqual(afterConfirmation.status, 'failed');
    assert.strictEqual(afterConfirmation.attempt, 1);

    const failedDispatch = await request(app)
      .post(`/request/software/status/${saved.id}/retry`)
      .send({ confirmNoExistingDownload: true });
    assert.strictEqual(failedDispatch.status, 502);
    const afterDispatchError = await getRepository(
      SoftwareRequest
    ).findOneByOrFail({ id: saved.id });
    assert.strictEqual(afterDispatchError.status, 'failed');
    assert.strictEqual(afterDispatchError.attempt, 1);

    const retried = await request(app)
      .post(`/request/software/status/${saved.id}/retry`)
      .send({ confirmNoExistingDownload: true });
    assert.strictEqual(retried.status, 200);
    assert.strictEqual(retried.body.status, 'searching');
    assert.deepStrictEqual(retryCalls, [false, true, true]);
  });

  it('lists same-origin downloads and streams them only to the requester', async () => {
    const saved = await createSoftwareRequest({
      provider: 'questarr',
      status: 'available',
      externalRequestId: 'seerrng:software:available',
    });
    mock.method(
      QuestarrNGAPI.prototype,
      'getRequest',
      async (externalRequestId: string) =>
        acceptedRequest(externalRequestId, 'available')
    );
    const assetResponse: SoftwareAssetsResponse = {
      assets: [
        {
          id: 'asset-1',
          name: 'Test Game.zip',
          size: 8,
          url: 'https://provider.example.test/private/download',
        },
      ],
      bundleSupported: false,
    };
    mock.method(
      QuestarrNGAPI.prototype,
      'getAssets',
      async () => assetResponse
    );
    mock.method(QuestarrNGAPI.prototype, 'streamAsset', async () => ({
      stream: Readable.from([Buffer.from('rom-data')]),
      contentLength: 8,
      contentType: 'application/octet-stream',
      rangeSupported: false,
      statusCode: 200,
    }));

    const ownerApp = createApp();
    const listing = await request(ownerApp).get(
      `/request/software/status/${saved.id}/downloads`
    );
    assert.strictEqual(listing.status, 200);
    assert.strictEqual(
      listing.body.results[0].url,
      `/api/v1/request/software/status/${saved.id}/downloads/asset-1`
    );

    const outsider = await request(createApp(3, Permission.REQUEST)).get(
      `/request/software/status/${saved.id}/downloads`
    );
    assert.strictEqual(outsider.status, 404);

    const download = await request(ownerApp).get(
      `/request/software/status/${saved.id}/downloads/asset-1`
    );
    assert.strictEqual(download.status, 200);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.strictEqual(download.body.toString('utf8'), 'rom-data');
    mock.method(
      QuestarrNGAPI.prototype,
      'streamAsset',
      async (_requestId: string, _assetId: string, range?: string) => {
        assert.strictEqual(range, 'bytes=4-7');
        return {
          stream: Readable.from([Buffer.from('data')]),
          contentLength: 4,
          contentType: 'application/octet-stream',
          rangeSupported: true,
          statusCode: 206,
          contentRange: 'bytes 4-7/8',
        };
      }
    );
    const resumed = await request(ownerApp)
      .get(`/request/software/status/${saved.id}/downloads/asset-1`)
      .set('Range', 'bytes=4-7');
    assert.strictEqual(resumed.status, 206);
    assert.strictEqual(resumed.headers['content-range'], 'bytes 4-7/8');
    assert.strictEqual(resumed.body.toString('utf8'), 'data');
    mock.method(QuestarrNGAPI.prototype, 'streamAsset', async () => ({
      stream: Readable.from([]),
      contentLength: 0,
      rangeSupported: true,
      statusCode: 416,
      contentRange: 'bytes */8',
    }));
    const invalidRange = await request(ownerApp)
      .get(`/request/software/status/${saved.id}/downloads/asset-1`)
      .set('Range', 'bytes=100-');
    assert.strictEqual(invalidRange.status, 416);
    assert.strictEqual(invalidRange.headers['content-range'], 'bytes */8');
  });

  it('streams Questarr bundles as request-scoped gzip downloads', async () => {
    const saved = await createSoftwareRequest({
      provider: 'questarr',
      status: 'available',
      externalRequestId: 'seerrng:software:bundle',
    });
    mock.method(
      QuestarrNGAPI.prototype,
      'getRequest',
      async (externalRequestId: string) =>
        acceptedRequest(externalRequestId, 'available')
    );
    mock.method(QuestarrNGAPI.prototype, 'getAssets', async () => ({
      assets: [
        { id: 'asset-1', name: 'part-1.zip', size: 4, url: '' },
        { id: 'asset-2', name: 'part-2.zip', size: 4, url: '' },
      ],
      bundleSupported: true,
      bundleName: 'Test Game.tar.gz',
    }));
    let streamCalls = 0;
    mock.method(
      QuestarrNGAPI.prototype,
      'streamBundle',
      async (externalRequestId: string) => {
        streamCalls += 1;
        assert.strictEqual(externalRequestId, saved.externalRequestId);
        return {
          stream: Readable.from([Buffer.from('gzip')]),
          filename: '../evil.exe',
          contentLength: -1,
          contentType: 'text/html',
          rangeSupported: true,
          statusCode: 206,
          contentRange: 'bytes 0-3/4',
        };
      }
    );

    const outsider = await request(createApp(3, Permission.REQUEST)).get(
      `/request/software/status/${saved.id}/bundle`
    );
    assert.strictEqual(outsider.status, 404);

    const download = await request(createApp())
      .get(`/request/software/status/${saved.id}/bundle`)
      .set('Range', 'bytes=0-3');
    assert.strictEqual(download.status, 200);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.match(
      decodeURIComponent(download.headers['content-disposition']),
      /\.\._evil\.exe\.tar\.gz/
    );
    assert.match(download.headers['content-type'], /^application\/gzip/);
    assert.strictEqual(download.headers['content-length'], undefined);
    assert.strictEqual(download.headers['accept-ranges'], undefined);
    assert.strictEqual(download.headers['content-range'], undefined);
    assert.strictEqual(download.body.toString('utf8'), 'gzip');
    assert.strictEqual(streamCalls, 1);
  });
});
