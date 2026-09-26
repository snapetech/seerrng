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
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
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
  coverUrl: 'https://images.example.test/cover.jpg',
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
    emulationSystemGroups: { nes: 'retro' },
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
  provider?: SoftwareRequestProvider;
  status?: SoftwareRequestStatus;
  requestedById?: number;
  externalRequestId?: string;
}) => {
  const repository = getRepository(SoftwareRequest);
  return repository.save(
    repository.create({
      requestedById: options.requestedById ?? 2,
      category: 'retro',
      provider: options.provider ?? 'romarr',
      status: options.status ?? 'failed',
      externalRequestId: options.externalRequestId ?? 'seerrng:software:test',
      catalogId: 42,
      title: 'Test Game',
      summary: null,
      coverUrl: null,
      platformSlug: 'nes',
      platformName: 'Nintendo Entertainment System',
      platformId: 130,
      operatingSystem: null,
      architecture: null,
      attempt: 1,
      errorMessage: null,
      lastCheckedAt: null,
    })
  );
};

beforeEach(() => {
  providerSettings();
});

afterEach(() => {
  mock.restoreAll();
});

describe('software request routes', () => {
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
      apiVersion: 1,
      requestContractVersion: 1,
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
    assert.strictEqual(connection.status, 200);
    assert.strictEqual(connection.body.service, 'QuestarrNG');
    assert.strictEqual(oldCamelCasePath.status, 404);
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

  it('maps ROMarr aliases into the assigned emulation catalog', async () => {
    mock.method(QuestarrNGAPI.prototype, 'searchCatalog', async () => [
      {
        ...pcGame,
        platforms: ['Nintendo Entertainment System'],
        platformOptions: [{ id: 130, name: 'Nintendo Entertainment System' }],
      },
    ]);
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
  });
});
