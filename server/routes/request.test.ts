import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  MAX_BOOK_REQUEST_IDENTIFIER_CANDIDATES,
  MediaRequest,
} from '@server/entity/MediaRequest';
import OverrideRule from '@server/entity/OverrideRule';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import requestDispatchManager from '@server/lib/requestDispatch';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { In } from 'typeorm';
import authRoutes from './auth';
import requestRoutes, { REQUEST_SERVICE_PROFILE_CONCURRENCY } from './request';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      cookie: { secure: 'auto' },
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
  app.use('/auth', authRoutes);
  app.use('/request', requestRoutes);
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

before(async () => {
  app = createApp();
});

beforeEach(() => {
  mock.method(MediaRequest, 'sendNotification', async () => undefined);
  mock.method(requestDispatchManager, 'enqueue', async () => undefined);
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

async function seedRequest(status = MediaRequestStatus.PENDING) {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);
  const requestRepo = getRepository(MediaRequest);

  const requestedBy = await userRepo.findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });

  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 12345,
      status: MediaStatus.UNKNOWN,
      status4k: MediaStatus.UNKNOWN,
    })
  );

  const created = await requestRepo.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status,
      media,
      requestedBy,
      is4k: false,
      updatedAt: new Date('2025-03-01T00:00:00.000Z'),
    })
  );

  return requestRepo.findOneOrFail({
    where: { id: created.id },
    relations: { requestedBy: true, modifiedBy: true },
  });
}

function createReadarrSettings(
  id: number,
  serviceType: 'ebook' | 'audiobook',
  isDefault = true
) {
  return {
    id,
    name: `${serviceType} Bookshelf`,
    hostname: `${serviceType}.local`,
    port: 8787,
    apiKey: `${serviceType}-key`,
    useSsl: false,
    activeProfileId: 22,
    activeProfileName: serviceType,
    activeMetadataProfileId: 33,
    activeMetadataProfileName: serviceType,
    activeDirectory: '/books',
    tags: [],
    is4k: false,
    isDefault,
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
    serviceType,
  };
}

function createLidarrSettings(id: number, isDefault = true) {
  return {
    id,
    name: 'Lidarr',
    hostname: 'lidarr.local',
    port: 8686,
    apiKey: 'lidarr-key',
    useSsl: false,
    activeProfileId: 20,
    activeProfileName: 'Music',
    activeMetadataProfileId: 30,
    activeMetadataProfileName: 'Standard',
    activeDirectory: '/music',
    tags: [],
    is4k: false,
    isDefault,
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
  };
}

function createRadarrSettings(id: number, isDefault = true) {
  return {
    id,
    name: 'Radarr',
    hostname: 'radarr.local',
    port: 7878,
    apiKey: 'radarr-key',
    useSsl: false,
    activeProfileId: 0,
    activeProfileName: 'Zero',
    activeDirectory: '/selected-movies',
    minimumAvailability: 'released' as const,
    tags: [7],
    is4k: false,
    isDefault,
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
  };
}

function createSonarrSettings(id: number, isDefault = true) {
  return {
    id,
    name: 'Sonarr',
    hostname: 'sonarr.local',
    port: 8989,
    apiKey: 'sonarr-key',
    useSsl: false,
    activeProfileId: 20,
    activeProfileName: 'TV',
    activeDirectory: '/tv',
    tags: [],
    is4k: false,
    isDefault,
    syncEnabled: true,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
    seriesType: 'standard' as const,
    animeSeriesType: 'anime' as const,
    activeAnimeProfileId: 20,
    activeAnimeProfileName: 'TV',
    activeAnimeDirectory: '/tv',
    activeAnimeLanguageProfileId: 1,
    activeLanguageProfileId: 1,
    animeTags: [],
    enableSeasonFolders: true,
    monitorNewItems: 'all' as const,
  };
}

describe('GET /request/count', () => {
  it('limits ordinary users to their own counts while managers see all requests', async () => {
    await seedRequest();

    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const adminMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 12346,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media: adminMedia,
        requestedBy: admin,
        is4k: false,
      })
    );

    const friendAgent = await loginAs('friend@seerr.dev', 'test1234');
    const friendCounts = await friendAgent.get('/request/count');
    assert.strictEqual(friendCounts.status, 200);
    assert.strictEqual(friendCounts.body.total, 1);
    assert.strictEqual(friendCounts.body.pending, 1);

    const adminAgent = await loginAs('admin@seerr.dev', 'test1234');
    const adminCounts = await adminAgent.get('/request/count');
    assert.strictEqual(adminCounts.status, 200);
    assert.strictEqual(adminCounts.body.total, 2);
    assert.strictEqual(adminCounts.body.pending, 2);
  });

  it('counts approved book requests by requested format availability', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });

    const ebookOnlyMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PARTIALLY_AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        externalServiceId: 101,
        audiobookExternalServiceId: null,
      })
    );
    const bothFormatsMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        externalServiceId: 201,
        audiobookExternalServiceId: 202,
      })
    );
    const missingFormatsMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const savedRequests = await requestRepo.save([
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.PENDING,
        media: ebookOnlyMedia,
        requestedBy,
        is4k: false,
        bookFormat: 'ebook',
      }),
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.PENDING,
        media: ebookOnlyMedia,
        requestedBy,
        is4k: false,
        bookFormat: 'both',
      }),
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.PENDING,
        media: bothFormatsMedia,
        requestedBy,
        is4k: false,
        bookFormat: 'both',
      }),
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.PENDING,
        media: missingFormatsMedia,
        requestedBy,
        is4k: false,
        bookFormat: 'audiobook',
      }),
    ]);
    await requestRepo.update(
      savedRequests.map((request) => request.id),
      { status: MediaRequestStatus.APPROVED }
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get('/request/count');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.book, 4);
    assert.strictEqual(res.body.approved, 4);
    assert.strictEqual(res.body.available, 2);
    assert.strictEqual(res.body.processing, 2);
  });

  it('reports failed requests so the status breakdown reconciles to total', async () => {
    await seedRequest(MediaRequestStatus.FAILED);
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent.get('/request/count');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 1);
    assert.strictEqual(res.body.failed, 1);
    assert.strictEqual(
      res.body.pending +
        res.body.approved +
        res.body.declined +
        res.body.failed +
        res.body.completed,
      res.body.total
    );
  });
});

describe('DELETE /request/:requestId', () => {
  it('allows the owner to delete their own pending request', async () => {
    const mediaRequest = await seedRequest();

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 204);
  });

  it('allows an admin to delete any pending request', async () => {
    const mediaRequest = await seedRequest();

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 204);
  });

  it('resets parent status when only failed request history remains', async () => {
    const user = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 54320,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const [, pendingRequest] = await getRepository(MediaRequest).save([
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.FAILED,
        media,
        requestedBy: user,
        is4k: false,
      }),
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: user,
        is4k: false,
      }),
    ]);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const response = await agent.delete(`/request/${pendingRequest.id}`);

    assert.strictEqual(response.status, 204);
    assert.strictEqual(
      (await getRepository(Media).findOneByOrFail({ id: media.id })).status,
      MediaStatus.UNKNOWN
    );
  });

  it('preserves deleted parent status when the last request is removed', async () => {
    const user = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 54319,
        status: MediaStatus.DELETED,
        status4k: MediaStatus.DELETED,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: user,
        is4k: false,
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const response = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(response.status, 204);
    const persisted = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.strictEqual(persisted.status, MediaStatus.DELETED);
    assert.strictEqual(persisted.status4k, MediaStatus.DELETED);
  });

  it('prevents a non-owner non-admin from deleting a pending request', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);

    // Create a request owned by admin, then try to delete as friend
    const owner = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });

    const media = await mediaRepo.save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 54321,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const mediaRequest = await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: owner,
        is4k: false,
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 401);
  });

  it('prevents the owner from deleting an approved request', async () => {
    const mediaRequest = await seedRequest(MediaRequestStatus.APPROVED);

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.delete(`/request/${mediaRequest.id}`);

    assert.strictEqual(res.status, 401);
  });

  it('returns 404 for a non-existent request', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete('/request/99999999');

    assert.strictEqual(res.status, 404);
  });

  it('returns 404 for malformed request IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete('/request/not-a-number');

    assert.strictEqual(res.status, 404);
  });
});

describe('PUT /request/:requestId (movie)', () => {
  it('validates and preserves partial movie routing changes', async (t) => {
    const settings = getSettings();
    settings.radarr = [createRadarrSettings(3)];
    t.after(() => {
      settings.radarr = [];
    });
    const requestRepo = getRepository(MediaRequest);
    const mediaRequest = await seedRequest();

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MOVIE,
      serverId: 3,
      profileId: 7,
      rootFolder: '/updated/movies',
      tags: [1, 2],
    });

    assert.strictEqual(res.status, 200);

    const saved = await requestRepo.findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(saved.serverId, 3);
    assert.strictEqual(saved.profileId, 7);
    assert.strictEqual(saved.rootFolder, '/updated/movies');

    const partialResponse = await agent
      .put(`/request/${mediaRequest.id}`)
      .send({ mediaType: MediaType.MOVIE, rootFolder: '/partial/movies' });
    const invalidResponse = await agent
      .put(`/request/${mediaRequest.id}`)
      .send({ mediaType: MediaType.MOVIE, serverId: 99 });
    const partiallySaved = await requestRepo.findOneByOrFail({
      id: mediaRequest.id,
    });

    assert.strictEqual(partialResponse.status, 200);
    assert.strictEqual(invalidResponse.status, 400);
    assert.strictEqual(partiallySaved.serverId, 3);
    assert.strictEqual(partiallySaved.profileId, 7);
    assert.strictEqual(partiallySaved.rootFolder, '/partial/movies');
  });

  it('rejects request mutations after the session credential changes', async () => {
    const mediaRequest = await seedRequest();
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 1 });
    const oldCredentialVersion = actor.passwordChangedAt?.getTime() ?? 0;
    await userRepository.update(actor.id, {
      passwordChangedAt: new Date(oldCredentialVersion + 1_000),
    });
    const staleSessionApp = express();
    staleSessionApp.use(express.json());
    staleSessionApp.use((req, _res, next) => {
      req.user = new User({ id: actor.id, permissions: Permission.ADMIN });
      req.session = {
        userId: actor.id,
        credentialVersion: oldCredentialVersion,
      } as typeof req.session;
      next();
    });
    staleSessionApp.use('/request', requestRoutes);
    staleSessionApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const [editResponse, deleteResponse, approveResponse] = await Promise.all([
      request(staleSessionApp).put(`/request/${mediaRequest.id}`).send({
        mediaType: MediaType.MOVIE,
        serverId: 3,
        profileId: 7,
        rootFolder: '/must-not-change',
        tags: [],
      }),
      request(staleSessionApp).delete(`/request/${mediaRequest.id}`),
      request(staleSessionApp).post(`/request/${mediaRequest.id}/approve`),
    ]);

    assert.strictEqual(editResponse.status, 403);
    assert.strictEqual(deleteResponse.status, 401);
    assert.strictEqual(approveResponse.status, 403);
    let persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: mediaRequest.id,
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.PENDING);
    assert.notStrictEqual(persisted.rootFolder, '/must-not-change');

    await getRepository(MediaRequest).update(mediaRequest.id, {
      status: MediaRequestStatus.FAILED,
    });
    const retryResponse = await request(staleSessionApp).post(
      `/request/${mediaRequest.id}/retry`
    );
    assert.strictEqual(retryResponse.status, 403);
    persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: mediaRequest.id,
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.FAILED);
  });
});

describe('GET /request', () => {
  it('bounds service profile hydration concurrency', () => {
    assert.strictEqual(REQUEST_SERVICE_PROFILE_CONCURRENCY, 10);
  });

  it('hydrates profiles only for services referenced by the result page', async (t) => {
    const settings = getSettings();
    settings.radarr = [createRadarrSettings(30), createRadarrSettings(31)];
    const mediaRequest = await seedRequest();
    await getRepository(MediaRequest).update(mediaRequest.id, {
      serverId: 30,
      profileId: 5,
    });
    const profiles = mock.method(
      RadarrAPI.prototype,
      'getProfiles',
      async () => [{ id: 5, name: 'HD' }]
    );
    t.after(() => {
      profiles.mock.restore();
      settings.radarr = [];
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const response = await agent.get('/request');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(profiles.mock.callCount(), 1);
    assert.strictEqual(response.body.results[0].profileName, 'HD');
    assert.deepStrictEqual(response.body.serviceErrors.radarr, []);
  });

  it('does not use stored service credentials for ordinary request viewers', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      {
        id: 30,
        name: 'Radarr',
        hostname: 'radarr.local',
        port: 7878,
        apiKey: 'stored-secret',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        activeDirectory: '/movies',
        minimumAvailability: 'released',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const profiles = mock.method(
      RadarrAPI.prototype,
      'getProfiles',
      async () => [{ id: 5, name: 'HD' }]
    );
    t.after(() => {
      profiles.mock.restore();
      settings.radarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.get('/request');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(profiles.mock.callCount(), 0);
    assert.deepStrictEqual(response.body.serviceErrors.radarr, []);
  });

  it('does not expose backend media routing fields to an ordinary request owner', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      {
        id: 30,
        name: 'Private Radarr',
        hostname: 'radarr.internal',
        port: 7878,
        apiKey: 'stored-secret',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        activeDirectory: '/private/movies',
        minimumAvailability: 'released',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    t.after(() => {
      settings.radarr = [];
    });

    const seeded = await seedRequest();
    await getRepository(Media).update(seeded.media.id, {
      serviceId: 30,
      externalServiceId: 44,
      externalServiceSlug: 'private-release',
      ratingKey: 'private-rating-key',
      jellyfinMediaId: 'private-jellyfin-id',
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.get(`/request/${seeded.id}`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.media.serviceUrl, undefined);
    assert.strictEqual(response.body.media.externalServiceSlug, undefined);
    assert.strictEqual(response.body.media.ratingKey, undefined);
    assert.strictEqual(response.body.media.jellyfinMediaId, undefined);
    assert.strictEqual(response.body.media.serviceId, 30);
    assert.strictEqual(response.body.media.externalServiceId, 44);
  });

  it('revalidates request-view authority before list, count, and detail reads', async () => {
    const friendRequest = await seedRequest();
    await getRepository(User).update(1, { permissions: Permission.REQUEST });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.REQUEST_VIEW });
      next();
    });
    staleAuthorizationApp.use('/request', requestRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const listResponse = await request(staleAuthorizationApp)
      .get('/request')
      .query({ requestedBy: 2 });
    const countResponse = await request(staleAuthorizationApp).get(
      '/request/count'
    );
    const detailResponse = await request(staleAuthorizationApp).get(
      `/request/${friendRequest.id}`
    );

    assert.strictEqual(listResponse.status, 403);
    assert.strictEqual(countResponse.status, 200);
    assert.strictEqual(countResponse.body.total, 0);
    assert.strictEqual(detailResponse.status, 403);
  });

  it('accepts the default added sort used by the request list', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/request').query({
      filter: 'pending',
      mediaType: 'all',
      take: 10,
      sort: 'added',
      sortDirection: 'desc',
      skip: 0,
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.results));
  });

  it('accepts the recent requests slider query', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/request').query({
      filter: 'all',
      take: 10,
      sort: 'modified',
      sortDirection: 'desc',
      skip: 0,
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.results));
  });

  it('rejects malformed request list query filters', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .get('/request')
      .query({ mediaType: ['movie', 'tv'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media type must be a string/);
  });

  it('rejects unknown request list sort parameters', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/request').query({ sort: 'drop-table' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sort must be valid/);
  });

  it('marks audiobook-only book requests removable when the Bookshelf server exists', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 1,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/audiobooks',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];
    const originalGetProfiles = Object.getOwnPropertyDescriptor(
      ReadarrAPI.prototype,
      'getProfiles'
    );
    Object.defineProperty(ReadarrAPI.prototype, 'getProfiles', {
      set() {},
      get() {
        return async () => [{ id: 1, name: 'Audiobooks' }];
      },
      configurable: true,
    });
    t.after(() => {
      if (originalGetProfiles) {
        Object.defineProperty(
          ReadarrAPI.prototype,
          'getProfiles',
          originalGetProfiles
        );
      }
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        audiobookServiceId: 21,
        audiobookExternalServiceId: 210,
        audiobookExternalServiceSlug: 'audio-book',
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.COMPLETED,
        is4k: false,
        bookFormat: 'audiobook',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/request').query({ mediaType: 'book' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
    assert.strictEqual(res.body.results[0].canRemove, true);
  });

  it('does not mark both-format book requests removable when one linked Bookshelf server is missing', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(10, 'ebook')];
    const originalGetProfiles = Object.getOwnPropertyDescriptor(
      ReadarrAPI.prototype,
      'getProfiles'
    );
    Object.defineProperty(ReadarrAPI.prototype, 'getProfiles', {
      set() {},
      get() {
        return async () => [{ id: 22, name: 'Ebooks' }];
      },
      configurable: true,
    });
    t.after(() => {
      if (originalGetProfiles) {
        Object.defineProperty(
          ReadarrAPI.prototype,
          'getProfiles',
          originalGetProfiles
        );
      }
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.PARTIALLY_AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-book',
        audiobookServiceId: 20,
        audiobookExternalServiceId: 200,
        audiobookExternalServiceSlug: 'audio-book',
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.COMPLETED,
        is4k: false,
        bookFormat: 'both',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/request').query({ mediaType: 'book' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
    assert.strictEqual(res.body.results[0].canRemove, false);
  });
});

describe('POST /request', () => {
  it('uses an explicitly selected zero-valued screen service without a default', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      createRadarrSettings(0, false),
      { ...createRadarrSettings(1, false), is4k: true },
    ];
    const providerMediaIds: number[] = [];
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get:
        () =>
        async ({ movieId }: { movieId: number }) => {
          providerMediaIds.push(movieId);
          return {
            id: movieId,
            external_ids: {},
            keywords: { keywords: [] },
            genres: [],
            original_language: 'en',
          } as unknown as Awaited<ReturnType<TheMovieDb['getMovie']>>;
        },
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
      settings.radarr = [];
    });
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const selectedResponse = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 987_640,
      serverId: 0,
    });
    const unknownResponse = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 987_641,
      serverId: 99,
    });
    const wrongTierResponse = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 987_642,
      serverId: 1,
    });

    assert.strictEqual(selectedResponse.status, 201);
    assert.strictEqual(selectedResponse.body.serverId, 0);
    assert.strictEqual(selectedResponse.body.profileId, 0);
    assert.strictEqual(selectedResponse.body.rootFolder, '/selected-movies');
    assert.deepStrictEqual(selectedResponse.body.tags, [7]);
    assert.strictEqual(unknownResponse.status, 400);
    assert.match(unknownResponse.body.message, /does not exist/i);
    assert.strictEqual(wrongTierResponse.status, 400);
    assert.match(wrongTierResponse.body.message, /quality tier/i);
    assert.ok(providerMediaIds.length > 0);
    assert.ok(providerMediaIds.every((mediaId) => mediaId === 987_640));
  });

  it('applies the most specific matching override rule deterministically', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      {
        id: 30,
        name: 'Radarr',
        hostname: 'radarr.local',
        port: 7878,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        activeDirectory: '/default',
        minimumAvailability: 'released',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const overrideRepository = getRepository(OverrideRule);
    await overrideRepository.save([
      new OverrideRule({
        radarrServiceId: 30,
        genre: '18',
        rootFolder: '/general',
      }),
      new OverrideRule({
        radarrServiceId: 30,
        users: '2',
        genre: '18',
        rootFolder: '/specific',
        profileId: 0,
      }),
    ]);
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get: () => async () =>
        ({
          id: 987650,
          external_ids: {},
          keywords: { keywords: [] },
          genres: [{ id: 18, name: 'Drama' }],
          original_language: 'en',
        }) as unknown as Awaited<ReturnType<TheMovieDb['getMovie']>>,
      set: () => undefined,
    });
    t.after(async () => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
      settings.radarr = [];
      await overrideRepository.clear();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 987650,
    });

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.rootFolder, '/specific');
    assert.strictEqual(response.body.profileId, 0);
  });

  it('rejects request creation after the session credential changes', async (t) => {
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 1 });
    const oldCredentialVersion = actor.passwordChangedAt?.getTime() ?? 0;
    await userRepository.update(actor.id, {
      passwordChangedAt: new Date(oldCredentialVersion + 1_000),
    });
    let getMovieCalls = 0;
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get: () => async () => {
        getMovieCalls += 1;
        throw new Error('Provider must not be called for stale credentials.');
      },
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
    });
    const staleSessionApp = express();
    staleSessionApp.use(express.json());
    staleSessionApp.use((req, _res, next) => {
      req.user = new User({ id: actor.id, permissions: Permission.ADMIN });
      req.session = {
        userId: actor.id,
        credentialVersion: oldCredentialVersion,
      } as typeof req.session;
      next();
    });
    staleSessionApp.use('/request', requestRoutes);
    staleSessionApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );
    const beforeCount = await getRepository(MediaRequest).count();

    const [response, bulkResponse] = await Promise.all([
      request(staleSessionApp).post('/request').send({
        mediaType: MediaType.MOVIE,
        mediaId: 987654321,
      }),
      request(staleSessionApp)
        .post('/request/bulk')
        .send({
          mediaType: MediaType.MUSIC,
          items: [{ mediaId: 'stale-session-release-group' }],
        }),
    ]);

    assert.strictEqual(response.status, 403);
    assert.strictEqual(bulkResponse.status, 403);
    assert.strictEqual(getMovieCalls, 0);
    assert.strictEqual(await getRepository(MediaRequest).count(), beforeCount);
  });

  it('returns forbidden when a request session rotates during admission', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 2 });
    const originalRun = requestAdmissionCoordinator.run.bind(
      requestAdmissionCoordinator
    );
    let rotated = false;
    requestAdmissionCoordinator.run = async (resourceKeys, callback) => {
      if (!rotated && resourceKeys.includes('user-security:user:2')) {
        rotated = true;
        await userRepository.update(2, {
          passwordChangedAt: new Date(
            (actor.passwordChangedAt?.getTime() ?? 0) + 1_000
          ),
        });
      }
      return originalRun(resourceKeys, callback);
    };

    try {
      const response = await agent.post('/request').send({
        mediaType: MediaType.MOVIE,
        mediaId: 987654320,
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(await getRepository(MediaRequest).count(), 0);
    } finally {
      requestAdmissionCoordinator.run = originalRun;
    }
  });

  it('reloads permissions after an admitted concurrent revocation', async () => {
    const userRepository = getRepository(User);
    const friend = await userRepository.findOneByOrFail({ id: 2 });
    let revocationStarted!: () => void;
    let releaseRevocation!: () => void;
    const revocationStartedPromise = new Promise<void>((resolve) => {
      revocationStarted = resolve;
    });
    const releaseRevocationPromise = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    const revocation = runUserSecurityMutation(friend.id, async () => {
      await userRepository.update(friend.id, { permissions: 0 });
      revocationStarted();
      await releaseRevocationPromise;
    });
    await revocationStartedPromise;

    const rejectedRequest = assert.rejects(
      MediaRequest.request(
        { mediaType: MediaType.MOVIE, mediaId: 4999 },
        friend
      ),
      /do not have permission/i
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseRevocation();
    await revocation;

    await rejectedRequest;
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
    assert.strictEqual(await getRepository(Media).count(), 0);
  });

  it('serializes concurrent request admission so quotas cannot be exceeded', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    friend.musicQuotaLimit = 1;
    friend.musicQuotaDays = 7;
    await userRepo.save(friend);
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) =>
        ({
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: { name: releaseGroupId },
            artist: { name: 'Concurrent Artist' },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
      friend.musicQuotaLimit = undefined;
      friend.musicQuotaDays = undefined;
    });

    const results = await Promise.allSettled([
      MediaRequest.request(
        { mediaType: MediaType.MUSIC, mediaId: 'concurrent-album-one' },
        friend
      ),
      MediaRequest.request(
        { mediaType: MediaType.MUSIC, mediaId: 'concurrent-album-two' },
        friend
      ),
    ]);

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    );
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    assert.ok(rejection);
    assert.match(String(rejection.reason), /quota exceeded/i);
    assert.equal(await getRepository(MediaRequest).count(), 1);
  });

  it('serializes concurrent requests for the same media across users', async (t) => {
    const settings = getSettings();
    settings.radarr = [
      {
        id: 30,
        name: 'Radarr',
        hostname: 'radarr.local',
        port: 7878,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        activeDirectory: '/movies',
        minimumAvailability: 'released',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get: () => async () =>
        ({
          id: 550,
          external_ids: {},
          keywords: { keywords: [] },
          genres: [],
          original_language: 'en',
        }) as unknown as Awaited<ReturnType<TheMovieDb['getMovie']>>,
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
      settings.radarr = [];
    });

    const userRepository = getRepository(User);
    const firstUser = await userRepository.findOneByOrFail({ id: 2 });
    const secondUser = await userRepository.save(
      new User({
        email: 'concurrent-requester@seerr.dev',
        username: 'concurrent-requester',
        avatar: 'https://example.com/avatar.png',
        permissions: Permission.REQUEST,
        userType: UserType.LOCAL,
      })
    );

    const results = await Promise.allSettled([
      MediaRequest.request(
        { mediaType: MediaType.MOVIE, mediaId: 550, is4k: false },
        firstUser
      ),
      MediaRequest.request(
        { mediaType: MediaType.MOVIE, mediaId: 550 },
        secondUser
      ),
    ]);

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    );
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    assert.ok(rejection);
    assert.match(String(rejection.reason), /already exists/i);
    assert.equal(await getRepository(MediaRequest).count(), 1);
    assert.equal(await getRepository(Media).count(), 1);
  });

  it('shares media identity across concurrent standard and 4K requests', async (t) => {
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get: () => async () =>
        ({
          id: 551,
          external_ids: {},
          keywords: { keywords: [] },
          genres: [],
          original_language: 'en',
        }) as unknown as Awaited<ReturnType<TheMovieDb['getMovie']>>,
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
    });

    const userRepository = getRepository(User);
    const firstUser = await userRepository.findOneByOrFail({ id: 1 });
    const secondUser = await userRepository.save(
      new User({
        email: 'concurrent-4k-requester@seerr.dev',
        username: 'concurrent-4k-requester',
        avatar: 'https://example.com/avatar.png',
        permissions: Permission.ADMIN,
        userType: UserType.LOCAL,
      })
    );

    const results = await Promise.allSettled([
      MediaRequest.request(
        { mediaType: MediaType.MOVIE, mediaId: 551, is4k: false },
        firstUser
      ),
      MediaRequest.request(
        { mediaType: MediaType.MOVIE, mediaId: 551, is4k: true },
        secondUser
      ),
    ]);

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      2
    );
    assert.equal(await getRepository(MediaRequest).count(), 2);
    assert.equal(await getRepository(Media).count(), 1);
    const media = await getRepository(Media).findOneByOrFail({ tmdbId: 551 });
    assert.notEqual(media.status, MediaStatus.UNKNOWN);
    assert.notEqual(media.status4k, MediaStatus.UNKNOWN);
  });

  it('serializes different music releases resolving to one release group', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'shared-release-group',
          release_group_metadata: {
            release_group: { name: 'Shared Album' },
            artist: { name: 'Concurrent Artist' },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const userRepository = getRepository(User);
    const firstUser = await userRepository.findOneByOrFail({ id: 2 });
    const secondUser = await userRepository.save(
      new User({
        email: 'music-alias-requester@seerr.dev',
        username: 'music-alias-requester',
        avatar: 'https://example.com/avatar.png',
        permissions: Permission.REQUEST,
        userType: UserType.LOCAL,
      })
    );

    const results = await Promise.allSettled([
      MediaRequest.request(
        { mediaType: MediaType.MUSIC, mediaId: 'release-one' },
        firstUser
      ),
      MediaRequest.request(
        { mediaType: MediaType.MUSIC, mediaId: 'release-two' },
        secondUser
      ),
    ]);

    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    );
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    assert.ok(rejection);
    assert.match(String(rejection.reason), /already exists/i);
    assert.equal(await getRepository(MediaRequest).count(), 1);
    assert.equal(await getRepository(Media).count(), 1);
  });

  it('acquires canonical music admission before service admission', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'ordered-release-group',
          release_group_metadata: {
            release_group: { name: 'Ordered Album' },
            artist: { name: 'Ordered Artist' },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    const admittedResources: string[][] = [];
    const originalRun = requestAdmissionCoordinator.run.bind(
      requestAdmissionCoordinator
    );
    const observedRun: typeof requestAdmissionCoordinator.run = (
      resources,
      callback
    ) => {
      admittedResources.push(resources);
      return originalRun(resources, callback);
    };
    mock.method(requestAdmissionCoordinator, 'run', observedRun);
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const requester = await getRepository(User).findOneByOrFail({ id: 2 });
    await MediaRequest.request(
      { mediaType: MediaType.MUSIC, mediaId: 'ordered-release' },
      requester
    );

    const canonicalIndex = admittedResources.findIndex((resources) =>
      resources.includes('request-canonical:music:ordered-release-group')
    );
    const serviceIndex = admittedResources.findIndex((resources) =>
      resources.includes('service-config:lidarr:10')
    );
    assert.ok(canonicalIndex >= 0);
    assert.ok(serviceIndex > canonicalIndex);
  });

  it('rejects malformed request bodies before request processing', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Request body must be an object/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects missing and malformed create identities before provider calls', async (t) => {
    let movieLookups = 0;
    let tvLookups = 0;
    Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
      configurable: true,
      get: () => {
        movieLookups += 1;
        return async () => undefined as never;
      },
      set: () => undefined,
    });
    Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
      configurable: true,
      get: () => {
        tvLookups += 1;
        return async () => undefined as never;
      },
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getMovie;
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getTvShow;
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const responses = await Promise.all([
      agent.post('/request').send({ mediaId: 1 }),
      agent.post('/request').send({
        mediaType: MediaType.MOVIE,
        mediaId: 'not-an-id',
      }),
      agent.post('/request').send({
        mediaType: MediaType.TV,
        mediaId: 2,
      }),
      agent.post('/request').send({
        mediaType: MediaType.TV,
        mediaId: 2,
        seasons: [],
      }),
      agent.post('/request').send({
        mediaType: 'podcast',
        mediaId: 3,
      }),
    ]);

    assert.ok(responses.every(({ status }) => status === 400));
    assert.strictEqual(movieLookups, 0);
    assert.strictEqual(tvLookups, 0);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects Open Library path-control IDs before request processing', async () => {
    const getWork = mock.method(OpenLibraryAPI.prototype, 'getWork');
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/../../search',
      format: 'ebook',
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /valid Open Library resource ID/i);
    assert.strictEqual(getWork.mock.callCount(), 0);
  });

  it('rejects MusicBrainz path-control IDs before request processing', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: '../album?redirect=/account',
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /valid MusicBrainz resource ID/i);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('does not expose unexpected request-processing errors', async () => {
    const privateDiagnostic = 'SQLITE private_schema at 10.0.0.5';
    mock.method(MediaRequest, 'request', async () => {
      throw new Error(privateDiagnostic);
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 991,
      is4k: false,
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Unable to submit request.');
    assert.doesNotMatch(JSON.stringify(res.body), /private_schema|10\.0\.0\.5/);
  });

  it('rejects malformed advanced option payloads before request processing', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
      tags: [1, 'not-a-number'],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /tags must contain positive integers/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects non-boolean quality-tier flags before request processing', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.MOVIE,
      mediaId: 992,
      is4k: 'false',
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /is4k must be a boolean/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('reuses existing TV media when TMDB changes but TVDB matches', async (t) => {
    const settings = getSettings();
    settings.sonarr = [createSonarrSettings(10)];
    const existingMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 111,
        tvdbId: 222,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
      configurable: true,
      get: () => async () =>
        ({
          id: 333,
          external_ids: { tvdb_id: 222 },
          keywords: { results: [] },
          genres: [],
          original_language: 'en',
          seasons: [{ season_number: 1 }],
        }) as unknown as Awaited<ReturnType<TheMovieDb['getTvShow']>>,
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getTvShow;
      settings.sonarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.TV,
      mediaId: 333,
      seasons: [1],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.media.id, existingMedia.id);
    assert.strictEqual(res.body.media.tmdbId, 333);
    assert.strictEqual(res.body.media.tvdbId, 222);
    assert.strictEqual(await getRepository(Media).count(), 1);
  });

  it('excludes active TV seasons without blocking seasons from failed history', async (t) => {
    const settings = getSettings();
    settings.sonarr = [createSonarrSettings(10)];
    const requestedBy = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 334,
        tvdbId: 223,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save([
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            status: MediaRequestStatus.PENDING,
          }),
        ],
      }),
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy,
        status: MediaRequestStatus.FAILED,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 2,
            status: MediaRequestStatus.FAILED,
          }),
        ],
      }),
    ]);
    Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
      configurable: true,
      get: () => async () =>
        ({
          id: 334,
          external_ids: { tvdb_id: 223 },
          keywords: { results: [] },
          genres: [],
          original_language: 'en',
          seasons: [1, 2, 3].map((season_number) => ({ season_number })),
        }) as unknown as Awaited<ReturnType<TheMovieDb['getTvShow']>>,
      set: () => undefined,
    });
    t.after(() => {
      delete (TheMovieDb.prototype as Partial<TheMovieDb>).getTvShow;
      settings.sonarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.TV,
      mediaId: 334,
      seasons: [1, 2, 3],
    });

    assert.strictEqual(response.status, 201);
    assert.deepStrictEqual(
      response.body.seasons.map(
        ({ seasonNumber }: { seasonNumber: number }) => seasonNumber
      ),
      [2, 3]
    );
  });

  it('creates a pending music request with the resolved MusicBrainz release group', async (t) => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 10,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 20,
        activeProfileName: 'Music',
        activeMetadataProfileId: 30,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-id',
          release_group_metadata: {
            release_group: {
              name: 'Kind of Blue',
            },
            artist: {
              name: 'Miles Davis',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
      serverId: 10,
      profileId: 20,
      metadataProfileId: 30,
      rootFolder: '/music',
      tags: [1, 2],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, MediaType.MUSIC);
    assert.strictEqual(res.body.status, MediaRequestStatus.PENDING);
    assert.strictEqual(res.body.media.mbId, 'release-group-id');
    assert.strictEqual(res.body.serverId, 10);
    assert.strictEqual(res.body.profileId, 20);
    assert.strictEqual(res.body.metadataProfileId, 30);
    assert.strictEqual(res.body.rootFolder, '/music');
    assert.deepStrictEqual(res.body.tags, []);

    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { mbId: 'release-group-id', mediaType: MediaType.MUSIC },
      relations: { requests: true },
    });
    assert.strictEqual(savedMedia.status, MediaStatus.PENDING);
    assert.strictEqual(savedMedia.requests.length, 1);
  });

  it('rolls back an existing music status when the request insert fails', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const mbId = 'existing-music-request-rollback';
    const existingMedia = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId,
        mediaType: MediaType.MUSIC,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({ release_group_mbid: mbId }) as Awaited<
          ReturnType<ListenBrainzAPI['getAlbum']>
        >
    );
    const subscriber: EntitySubscriberInterface<MediaRequest> = {
      listenTo: () => MediaRequest,
      beforeInsert: (event: InsertEvent<MediaRequest>) => {
        if (event.entity.media.id === existingMedia.id) {
          throw new Error('forced existing-media request failure');
        }
      },
    };
    dataSource.subscribers.push(subscriber);
    t.after(() => {
      dataSource.subscribers.splice(
        dataSource.subscribers.indexOf(subscriber),
        1
      );
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: mbId,
    });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(
      (await getRepository(Media).findOneByOrFail({ id: existingMedia.id }))
        .status,
      MediaStatus.UNKNOWN
    );
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('accepts zero-valued Lidarr service and profile overrides in music requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(0, false)];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'zero-single-album',
          release_group_metadata: {
            release_group: {
              name: 'Zero Single Album',
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'zero-single-album',
      serverId: 0,
      profileId: 0,
      metadataProfileId: 0,
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.serverId, 0);
    assert.strictEqual(res.body.profileId, 0);
    assert.strictEqual(res.body.metadataProfileId, 0);
  });

  it('creates a music request when ListenBrainz album lookup fails for a valid release group', async (t) => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 10,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 20,
        activeProfileName: 'Music',
        activeMetadataProfileId: 30,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => {
        throw new Error('ListenBrainz unavailable');
      }
    );
    const getReleaseGroupDetailsMock = mock.method(
      MusicBrainz.prototype,
      'getReleaseGroupDetails',
      async () =>
        ({
          id: 'release-group-id',
          title: 'Kind of Blue',
          score: 100,
          media_type: 'album',
          'primary-type': 'Album',
          'first-release-date': '1959',
          'artist-credit': [],
          posterPath: undefined,
          'type-id': '',
          'primary-type-id': '',
          count: 1,
          releases: [],
          releasedate: '1959',
        }) as Awaited<ReturnType<MusicBrainz['getReleaseGroupDetails']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      getReleaseGroupDetailsMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'RELEASE-GROUP-ID',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, MediaType.MUSIC);
    assert.strictEqual(res.body.media.mbId, 'release-group-id');
  });

  it('allows a new music request after a previous request failed', async (t) => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 10,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 20,
        activeProfileName: 'Music',
        activeMetadataProfileId: 30,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'retry-album',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.FAILED,
        is4k: false,
      })
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'retry-album',
          release_group_metadata: {
            release_group: {
              name: 'Retry Album',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'retry-album',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.media.mbId, 'retry-album');
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('rejects music requests without a default Lidarr server', async (t) => {
    const settings = getSettings();
    settings.lidarr = [];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-no-lidarr',
          release_group_metadata: {
            release_group: {
              name: 'No Lidarr Album',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => getAlbumMock.mock.restore());

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /no default lidarr/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects music requests with an unknown Lidarr server override', async (t) => {
    const settings = getSettings();
    settings.lidarr = [];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-bad-lidarr',
          release_group_metadata: {
            release_group: {
              name: 'Bad Lidarr Album',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => getAlbumMock.mock.restore());

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
      serverId: 999,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /selected lidarr/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('creates a pending book request with normalized identifiers and format', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 11,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 22,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 33,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL45804W',
      editionId: '/books/OL1M',
      isbn13: '978-0-441-47812-5',
      format: 'audiobook',
      serverId: 11,
      profileId: 22,
      metadataProfileId: 33,
      rootFolder: '/books',
      tags: [4, 5],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, MediaType.BOOK);
    assert.strictEqual(res.body.status, MediaRequestStatus.PENDING);
    assert.strictEqual(res.body.bookFormat, 'audiobook');
    assert.strictEqual(res.body.serverId, 11);
    assert.strictEqual(res.body.profileId, 22);
    assert.strictEqual(res.body.metadataProfileId, 33);
    assert.strictEqual(res.body.rootFolder, '/books');
    assert.deepStrictEqual(res.body.tags, []);

    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { id: res.body.media.id },
      relations: { identifiers: true, requests: true },
    });
    assert.strictEqual(savedMedia.mediaType, MediaType.BOOK);
    assert.strictEqual(savedMedia.status, MediaStatus.PENDING);
    assert.strictEqual(savedMedia.requests.length, 1);
    assert.deepStrictEqual(
      savedMedia.identifiers
        .map((identifier) => ({
          provider: identifier.provider,
          value: identifier.value,
          canonical: identifier.canonical,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      [
        {
          provider: MediaIdentifierProvider.ISBN,
          value: '9780441478125',
          canonical: false,
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: 'OL45804W',
          canonical: true,
        },
        {
          provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
          value: 'OL1M',
          canonical: false,
        },
      ].sort((a, b) => a.provider.localeCompare(b.provider))
    );
  });

  it('rolls back new book media and identifiers when the request insert fails', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(11, 'ebook')];
    const openLibraryId = 'OLREQUESTROLLBACKW';
    const mediaCountBefore = await getRepository(Media).countBy({
      mediaType: MediaType.BOOK,
    });
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({ key: `/works/${openLibraryId}`, title: 'Rollback Book' }) as Awaited<
          ReturnType<OpenLibraryAPI['getWork']>
        >
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({ size: 0, entries: [] }) as Awaited<
          ReturnType<OpenLibraryAPI['getWorkEditions']>
        >
    );
    const subscriber: EntitySubscriberInterface<MediaRequest> = {
      listenTo: () => MediaRequest,
      beforeInsert: async (event: InsertEvent<MediaRequest>) => {
        if (
          event.entity.type === MediaType.BOOK &&
          (await event.manager.getRepository(MediaIdentifier).existsBy({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: openLibraryId,
          }))
        ) {
          throw new Error('forced request insert failure');
        }
      },
    };
    dataSource.subscribers.push(subscriber);
    t.after(() => {
      dataSource.subscribers.splice(
        dataSource.subscribers.indexOf(subscriber),
        1
      );
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: openLibraryId,
      format: 'ebook',
    });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(
      await getRepository(MediaIdentifier).existsBy({
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: openLibraryId,
      }),
      false
    );
    assert.strictEqual(
      await getRepository(Media).countBy({ mediaType: MediaType.BOOK }),
      mediaCountBefore
    );
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('caps provider-supplied book identifiers before locking and persistence', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(11, 'ebook')];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({ key: '/works/OL8106W', title: 'Identifier Flood' }) as Awaited<
          ReturnType<OpenLibraryAPI['getWork']>
        >
    );
    const makeIsbn13 = (index: number) => {
      const body = `978${String(index).padStart(9, '0')}`;
      const sum = body
        .split('')
        .reduce(
          (total, digit, digitIndex) =>
            total + Number(digit) * (digitIndex % 2 === 0 ? 1 : 3),
          0
        );
      return `${body}${(10 - (sum % 10)) % 10}`;
    };
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL8106M',
              isbn_13: Array.from({ length: 500 }, (_, index) =>
                makeIsbn13(index)
              ),
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL8106W',
      format: 'ebook',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      await getRepository(MediaIdentifier).count({
        where: { media: { id: res.body.media.id } },
      }),
      MAX_BOOK_REQUEST_IDENTIFIER_CANDIDATES
    );
  });

  it('rejects an audiobook request with an ebook-only Bookshelf server override', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 11,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 22,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 33,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL45804W',
      format: 'audiobook',
      serverId: 11,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not configured for audiobook/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects book requests with an unknown Bookshelf server override', async (t) => {
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL45804W',
      serverId: 999,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /selected bookshelf/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
    assert.strictEqual(
      await getRepository(MediaIdentifier).existsBy({
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL45804W',
      }),
      false
    );
    assert.strictEqual(
      await getRepository(Media).countBy({ mediaType: MediaType.BOOK }),
      0
    );
  });

  it('rejects both-format book requests without both default Bookshelf formats', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 11,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 22,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 33,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: '/works/OL45804W',
      format: 'both',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /default ebook and audiobook/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('uses an explicit ebook service with the default audiobook service for both formats', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      createReadarrSettings(0, 'ebook', false),
      createReadarrSettings(1, 'audiobook', true),
    ];
    const providerWorkIds: string[] = [];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) => {
        providerWorkIds.push(workId);
        return {
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: 'Both Format Book',
        } as Awaited<ReturnType<OpenLibraryAPI['getWork']>>;
      }
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}M`,
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const selectedResponse = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OLBOTH1W',
      format: 'both',
      serverId: 0,
    });
    const wrongTypeResponse = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OLBOTH2W',
      format: 'both',
      serverId: 1,
    });

    assert.strictEqual(selectedResponse.status, 201);
    assert.strictEqual(selectedResponse.body.serverId, 0);
    assert.strictEqual(selectedResponse.body.bookFormat, 'both');
    assert.strictEqual(wrongTypeResponse.status, 400);
    assert.match(wrongTypeResponse.body.message, /configured for ebook/i);
    assert.ok(providerWorkIds.every((workId) => !workId.includes('OLBOTH2W')));
  });

  it('blocks duplicate book requests that resolve to an existing ISBN', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate ISBN Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL999M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      isbn13: '9780441478125',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('allows a new book request after a previous request failed', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 21,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.FAILED,
        is4k: false,
        bookFormat: 'ebook',
      })
    );
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'Retry Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL45804W',
      isbn13: '9780441478125',
      format: 'ebook',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.bookFormat, 'ebook');
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('allows a complementary audiobook request when an ebook request already exists', async (t) => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Complementary Format Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL999M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      isbn13: '9780441478125',
      format: 'audiobook',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.bookFormat, 'audiobook');
    assert.strictEqual(await requestRepo.count(), 2);
  });

  it('blocks a both-formats book request when either format already has an active request', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'audiobook',
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate Both Format Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL999M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      isbn13: '9780441478125',
      format: 'both',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('blocks duplicate book requests when Open Library only returns ISBN-10', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate ISBN-10 Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL999M',
              isbn_10: ['0-441-47812-3'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('blocks duplicate book requests that resolve to an existing edition', async (t) => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const requestedBy = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const existingMedia = await mediaRepo.save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL45804W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
            value: 'OL1M',
            canonical: false,
          }),
        ],
      })
    );
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: existingMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL999W',
          title: 'Duplicate Edition Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL999W',
      editionId: 'OL1M',
    });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /request for this book already exists/i);
    assert.strictEqual(await requestRepo.count(), 1);
  });

  it('blocks music requests when the release group external id is blocklisted', async (t) => {
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'blocklisted-release-group',
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => getAlbumMock.mock.restore());

    await getRepository(Blocklist).save(
      new Blocklist({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        externalId: 'blocklisted-release-group',
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
        title: 'Blocked Album',
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.MUSIC,
      mediaId: 'listenbrainz-release-id',
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /album is blocklisted/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('blocks book requests when any discovered edition ISBN is blocklisted', async (t) => {
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL123W',
          title: 'Blocked Book',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 2,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780306406157'],
            },
            {
              key: '/books/OL2M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    await getRepository(Blocklist).save(
      new Blocklist({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        externalId: '9780441478125',
        externalProvider: MediaIdentifierProvider.ISBN,
        title: 'Blocked Book',
      })
    );

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send({
      mediaType: MediaType.BOOK,
      mediaId: 'OL123W',
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /book is blocklisted/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });
});

describe('PUT /request/:requestId', () => {
  const createTvRequest = async ({
    requestedBy,
    seasons,
    status = MediaRequestStatus.PENDING,
    tmdbId,
  }: {
    requestedBy: User;
    seasons: number[];
    status?: MediaRequestStatus;
    tmdbId: number;
  }) => {
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    return getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy,
        status,
        is4k: false,
        seasons: seasons.map(
          (seasonNumber) =>
            new SeasonRequest({
              seasonNumber,
              status: MediaRequestStatus.PENDING,
            })
        ),
      })
    );
  };

  it('does not allow an approved series request to be rewritten', async () => {
    const friend = await getRepository(User).findOneByOrFail({ id: 2 });
    const mediaRequest = await createTvRequest({
      requestedBy: friend,
      seasons: [1],
      status: MediaRequestStatus.APPROVED,
      tmdbId: 8101,
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.TV,
      seasons: [1, 2],
    });

    assert.strictEqual(res.status, 409);
    const persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: mediaRequest.id,
    });
    assert.deepStrictEqual(
      persisted.seasons.map((season) => season.seasonNumber),
      [1]
    );
  });

  it('does not transfer a request to a user without request permission', async () => {
    const owner = await getRepository(User).findOneByOrFail({ id: 2 });
    const target = await getRepository(User).save(
      new User({
        email: 'no-request-permission@seerr.dev',
        username: 'no-request-permission',
        avatar: 'https://example.com/avatar.png',
        permissions: Permission.NONE,
        userType: UserType.LOCAL,
      })
    );
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 8102,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: owner,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MOVIE,
      userId: target.id,
    });

    assert.strictEqual(res.status, 403);
    const persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: mediaRequest.id,
    });
    assert.strictEqual(persisted.requestedBy.id, owner.id);
  });

  it('blocks seasons from active requests but permits failed history on edit', async () => {
    const friend = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 8103,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const [first] = await getRepository(MediaRequest).save([
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy: friend,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            status: MediaRequestStatus.PENDING,
          }),
        ],
      }),
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy: friend,
        status: MediaRequestStatus.FAILED,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 3,
            status: MediaRequestStatus.FAILED,
          }),
        ],
      }),
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy: friend,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 2,
            status: MediaRequestStatus.PENDING,
          }),
        ],
      }),
    ]);
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent.put(`/request/${first.id}`).send({
      mediaType: MediaType.TV,
      seasons: [1, 2, 3],
    });

    assert.strictEqual(res.status, 200);
    const persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: first.id,
    });
    assert.deepStrictEqual(
      persisted.seasons.map((season) => season.seasonNumber),
      [1, 3]
    );
  });

  it('serializes concurrent series edits against the user quota', async () => {
    const userRepository = getRepository(User);
    const friend = await userRepository.findOneByOrFail({ id: 2 });
    friend.tvQuotaLimit = 3;
    friend.tvQuotaDays = 7;
    await userRepository.save(friend);
    const first = await createTvRequest({
      requestedBy: friend,
      seasons: [1],
      tmdbId: 8104,
    });
    const second = await createTvRequest({
      requestedBy: friend,
      seasons: [1],
      tmdbId: 8105,
    });
    const agent = await loginAs('friend@seerr.dev', 'test1234');

    const responses = await Promise.all([
      agent.put(`/request/${first.id}`).send({
        mediaType: MediaType.TV,
        seasons: [1, 2],
      }),
      agent.put(`/request/${second.id}`).send({
        mediaType: MediaType.TV,
        seasons: [1, 2],
      }),
    ]);

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 403]
    );
    const persisted = await getRepository(MediaRequest).findBy({
      id: In([first.id, second.id]),
    });
    assert.strictEqual(
      persisted.reduce((total, item) => total + item.seasons.length, 0),
      3
    );
  });

  it('rejects oversized request option strings on edit', async () => {
    const mediaRequest = await seedRequest();

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MOVIE,
      rootFolder: '/movies/'.padEnd(4097, 'x'),
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /rootFolder must be 4096 characters/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.rootFolder, null);
  });

  it('rejects attempts to change the media type of an existing request', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MOVIE,
      serverId: 123,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /media type cannot be changed/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.type, MediaType.BOOK);
    assert.strictEqual(persisted.serverId, null);
  });

  it('rejects book edits that point an audiobook request at an ebook Bookshelf server', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(11, 'ebook')];
    t.after(() => {
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.BOOK,
      format: 'audiobook',
      serverId: 11,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not audiobook requests/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.bookFormat, 'ebook');
    assert.strictEqual(persisted.serverId, null);
  });

  it('treats legacy Bookshelf servers without a service type as ebook servers on edit', async (t) => {
    const settings = getSettings();
    const legacyReadarr = createReadarrSettings(11, 'ebook');
    delete (legacyReadarr as { serviceType?: 'ebook' | 'audiobook' })
      .serviceType;
    settings.readarr = [legacyReadarr];
    t.after(() => {
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      serverId: 11,
      profileId: 22,
      metadataProfileId: 33,
      rootFolder: '/books',
    });

    assert.strictEqual(res.status, 200);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.bookFormat, 'ebook');
    assert.strictEqual(persisted.serverId, 11);
    assert.strictEqual(persisted.profileId, 22);
    assert.strictEqual(persisted.metadataProfileId, 33);
    assert.strictEqual(persisted.rootFolder, '/books');
  });

  it('rejects malformed request edit bodies before persistence', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Request body must be an object/i);
  });

  it('rejects music edits that point at a missing Lidarr server', async () => {
    const settings = getSettings();
    settings.lidarr = [];

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-edit',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MUSIC,
      serverId: 999,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /selected lidarr/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.serverId, null);
  });

  it('preserves music service routing when a partial edit omits server fields', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    t.after(() => {
      settings.lidarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-partial-edit',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const mediaRequest = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        serverId: 10,
        profileId: 20,
        metadataProfileId: 30,
        rootFolder: '/music',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.put(`/request/${mediaRequest.id}`).send({
      mediaType: MediaType.MUSIC,
      tags: [7, 8],
    });

    assert.strictEqual(res.status, 200);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: mediaRequest.id },
    });
    assert.strictEqual(persisted.serverId, 10);
    assert.strictEqual(persisted.profileId, 20);
    assert.strictEqual(persisted.metadataProfileId, 30);
    assert.strictEqual(persisted.rootFolder, '/music');
    assert.deepStrictEqual(persisted.tags, [7, 8]);
  });
});

describe('POST /request/:requestId/:status', () => {
  const cases = [
    { action: 'approve', expected: MediaRequestStatus.APPROVED },
    { action: 'decline', expected: MediaRequestStatus.DECLINED },
  ] as const;

  for (const { action, expected } of cases) {
    it(`transitions to ${action}d and records the acting user`, async () => {
      const repo = getRepository(MediaRequest);
      const pending = await seedRequest();
      const admin = await loginAs('admin@seerr.dev', 'test1234');

      const res = await admin.post(`/request/${pending.id}/${action}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, expected);
      assert.strictEqual(res.body.modifiedBy.id, 1);
      assert.strictEqual(res.body.modifiedBy.email, undefined);

      const persisted = await repo.findOneOrFail({
        where: { id: pending.id },
        relations: { modifiedBy: true },
      });

      assert.strictEqual(persisted.status, expected);
      assert.strictEqual(persisted.modifiedBy?.email, 'admin@seerr.dev');
      assert.ok(persisted.updatedAt > pending.updatedAt);
    });
  }

  it('preserves available media status when a pending request is declined', async () => {
    const requestedBy = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 8120,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const pending = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const response = await admin.post(`/request/${pending.id}/decline`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      (await getRepository(Media).findOneByOrFail({ id: media.id })).status,
      MediaStatus.AVAILABLE
    );
  });

  it('resets a declined TV season when only failed history remains', async () => {
    const requestedBy = await getRepository(User).findOneByOrFail({ id: 2 });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 8121,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        seasons: [
          new Season({
            seasonNumber: 1,
            status: MediaStatus.PENDING,
            status4k: MediaStatus.UNKNOWN,
          }),
        ],
      })
    );
    const [pending] = await getRepository(MediaRequest).save([
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            status: MediaRequestStatus.PENDING,
          }),
        ],
      }),
      new MediaRequest({
        type: MediaType.TV,
        media,
        requestedBy,
        status: MediaRequestStatus.FAILED,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            status: MediaRequestStatus.FAILED,
          }),
        ],
      }),
    ]);
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const response = await admin.post(`/request/${pending.id}/decline`);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      (
        await getRepository(Season).findOneByOrFail({
          media: { id: media.id },
          seasonNumber: 1,
        })
      ).status,
      MediaStatus.UNKNOWN
    );
  });

  it('rejects unknown request status actions', async () => {
    const pending = await seedRequest(MediaRequestStatus.PENDING);
    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.post(`/request/${pending.id}/not-a-status`);

    assert.strictEqual(res.status, 404);
  });

  for (const existingStatus of [
    MediaRequestStatus.APPROVED,
    MediaRequestStatus.DECLINED,
    MediaRequestStatus.FAILED,
    MediaRequestStatus.COMPLETED,
  ]) {
    it(`does not transition a request from status ${existingStatus}`, async () => {
      const existing = await seedRequest(existingStatus);
      const admin = await loginAs('admin@seerr.dev', 'test1234');

      const res = await admin.post(`/request/${existing.id}/approve`);

      assert.strictEqual(res.status, 409);
      const persisted = await getRepository(MediaRequest).findOneByOrFail({
        id: existing.id,
      });
      assert.strictEqual(persisted.status, existingStatus);
    });
  }

  it('allows only one concurrent terminal transition', async () => {
    const pending = await seedRequest(MediaRequestStatus.PENDING);
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const responses = await Promise.all([
      admin.post(`/request/${pending.id}/approve`),
      admin.post(`/request/${pending.id}/decline`),
    ]);

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 409]
    );
    const persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: pending.id,
    });
    assert.ok(
      persisted.status === MediaRequestStatus.APPROVED ||
        persisted.status === MediaRequestStatus.DECLINED
    );
  });

  it('rejects approving a book request with a stale Bookshelf server format', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(11, 'ebook')];
    t.after(() => {
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const pending = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'audiobook',
        serverId: 11,
      })
    );
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${pending.id}/approve`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /not audiobook requests/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: pending.id },
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.PENDING);
  });

  it('rejects approving a music request without a selected or default Lidarr server', async () => {
    const settings = getSettings();
    settings.lidarr = [];

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-no-default-approve',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const pending = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${pending.id}/approve`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /no default lidarr/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: pending.id },
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.PENDING);
  });

  it('rejects approving a both-format book request without both default Bookshelf formats', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(11, 'ebook')];
    t.after(() => {
      settings.readarr = [];
    });

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const pending = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'both',
      })
    );
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${pending.id}/approve`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /default ebook and audiobook/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: pending.id },
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.PENDING);
  });
});

describe('POST /request/:requestId/retry', () => {
  it('re-approves a failed request and records the acting user', async () => {
    const repo = getRepository(MediaRequest);
    const failed = await seedRequest(MediaRequestStatus.FAILED);
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${failed.id}/retry`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, MediaRequestStatus.APPROVED);
    assert.strictEqual(res.body.modifiedBy.id, 1);
    assert.strictEqual(res.body.modifiedBy.email, undefined);

    const persisted = await repo.findOneOrFail({
      where: { id: failed.id },
      relations: { modifiedBy: true },
    });

    assert.strictEqual(persisted.status, MediaRequestStatus.APPROVED);
    assert.strictEqual(persisted.modifiedBy?.email, 'admin@seerr.dev');
    assert.ok(persisted.updatedAt > failed.updatedAt);
  });

  it('allows only one concurrent retry of a failed request', async () => {
    const failed = await seedRequest(MediaRequestStatus.FAILED);
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const responses = await Promise.all([
      admin.post(`/request/${failed.id}/retry`),
      admin.post(`/request/${failed.id}/retry`),
    ]);

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [200, 409]
    );
    const persisted = await getRepository(MediaRequest).findOneByOrFail({
      id: failed.id,
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.APPROVED);
  });

  for (const status of [
    MediaRequestStatus.PENDING,
    MediaRequestStatus.APPROVED,
    MediaRequestStatus.DECLINED,
    MediaRequestStatus.COMPLETED,
  ]) {
    it(`does not retry a request in status ${status}`, async () => {
      const existing = await seedRequest(status);
      const admin = await loginAs('admin@seerr.dev', 'test1234');

      const res = await admin.post(`/request/${existing.id}/retry`);

      assert.strictEqual(res.status, 409);
      const persisted = await getRepository(MediaRequest).findOneByOrFail({
        id: existing.id,
      });
      assert.strictEqual(persisted.status, status);
      assert.strictEqual(persisted.modifiedBy, null);
    });
  }

  it('rejects retrying a failed music request with a stale Lidarr server', async () => {
    const settings = getSettings();
    settings.lidarr = [];

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-retry',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const failed = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy,
        status: MediaRequestStatus.FAILED,
        is4k: false,
        serverId: 999,
      })
    );
    const admin = await loginAs('admin@seerr.dev', 'test1234');

    const res = await admin.post(`/request/${failed.id}/retry`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /selected lidarr/i);

    const persisted = await getRepository(MediaRequest).findOneOrFail({
      where: { id: failed.id },
    });
    assert.strictEqual(persisted.status, MediaRequestStatus.FAILED);
  });
});

describe('POST /request/bulk', () => {
  it('rejects malformed bulk request envelopes', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const arrayRes = await agent.post('/request/bulk').send([]);

    assert.strictEqual(arrayRes.status, 400);
    assert.match(arrayRes.body.message, /Request body must be an object/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects bulk items without media IDs before creating requests', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [{ mediaId: '   ', title: 'Missing Album ID' }],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /mediaId is required/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('rejects Open Library path-control IDs in bulk requests', async () => {
    const getWork = mock.method(OpenLibraryAPI.prototype, 'getWork');
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      items: [{ mediaId: 'OL1W?redirect=/account' }],
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /valid Open Library resource ID/i);
    assert.strictEqual(getWork.mock.callCount(), 0);
  });

  it('rejects MusicBrainz path-control IDs in bulk requests', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const response = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [{ mediaId: 'album?redirect=/account' }],
    });

    assert.strictEqual(response.status, 400);
    assert.match(response.body.message, /valid MusicBrainz resource ID/i);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('rejects bulk item text that exceeds request limits', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [{ mediaId: 'album-id', title: 'x'.repeat(513) }],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /title must be 512 characters/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('creates music requests and returns skipped/failed item summaries', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const duplicateMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'duplicate-album',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media: duplicateMedia,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) => {
        if (releaseGroupId === 'failed-album') {
          throw new Error('ListenBrainz unavailable');
        }

        return {
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: {
              name: releaseGroupId,
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        } as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>;
      }
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [
        { mediaId: 'new-album', title: 'New Album' },
        { mediaId: 'duplicate-album', title: 'Duplicate Album' },
        { mediaId: 'failed-album', title: 'Failed Album' },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].media.mbId, 'new-album');
    assert.deepStrictEqual(res.body.skipped, [
      {
        mediaId: 'duplicate-album',
        title: 'Duplicate Album',
        reason: 'Request for this album already exists.',
      },
    ]);
    assert.deepStrictEqual(res.body.failed, [
      {
        mediaId: 'failed-album',
        title: 'Failed Album',
        reason: 'Unable to process item.',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(res.body), /ListenBrainz unavailable/);
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('dedupes repeated music bulk items before requesting metadata', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) =>
        ({
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: {
              name: releaseGroupId,
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [
        { mediaId: 'duplicate-new-album', title: 'Duplicate New Album' },
        { mediaId: 'duplicate-new-album', title: 'Duplicate New Album' },
        { mediaId: 'DUPLICATE-NEW-ALBUM', title: 'Duplicate New Album' },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].media.mbId, 'duplicate-new-album');
    assert.deepStrictEqual(res.body.skipped, []);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(getAlbumMock.mock.callCount(), 1);
    assert.strictEqual(await getRepository(MediaRequest).count(), 1);
  });

  it('creates music requests for processing albums without active requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'processing-album',
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 10,
        externalServiceId: 123,
        externalServiceSlug: 'processing-album',
      })
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) =>
        ({
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: {
              name: releaseGroupId,
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [{ mediaId: 'processing-album', title: 'Processing Album' }],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.skipped.length, 0);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].media.mbId, 'processing-album');
    assert.strictEqual(
      res.body.created[0].media.externalServiceSlug,
      undefined
    );
    assert.strictEqual(res.body.created[0].requestedBy.permissions, undefined);
    assert.strictEqual(res.body.created[0].requestedBy.userType, undefined);
  });

  it('accepts zero-valued Lidarr service and profile overrides in bulk music requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(0, false)];
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) =>
        ({
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: {
              name: releaseGroupId,
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      serverId: 0,
      profileId: 0,
      metadataProfileId: 0,
      items: [{ mediaId: 'zero-service-album', title: 'Zero Service Album' }],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].serverId, 0);
    assert.strictEqual(res.body.created[0].profileId, 0);
    assert.strictEqual(res.body.created[0].metadataProfileId, 0);
  });

  it('creates book requests and returns skipped item summaries', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(10, 'ebook')];
    const availableMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        externalServiceId: 123,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media: availableMedia,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'available-work',
        canonical: true,
      })
    );
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) =>
        ({
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: workId,
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}-edition`,
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      items: [
        {
          mediaId: 'new-work',
          title: 'New Work',
          authorId: 'OL1A',
          isbn13: '9780441478125',
          editionId: 'new-work-edition',
        },
        { mediaId: 'available-work', title: 'Available Work' },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].type, MediaType.BOOK);
    assert.strictEqual(res.body.created[0].bookFormat, 'ebook');
    assert.deepStrictEqual(res.body.skipped, [
      {
        mediaId: 'available-work',
        title: 'Available Work',
        reason: 'This ebook is already available.',
      },
    ]);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(await getRepository(MediaRequest).count(), 1);
  });

  it('dedupes repeated book bulk work IDs before resolving editions', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(10, 'ebook')];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) =>
        ({
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: workId,
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}-edition`,
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      items: [
        { mediaId: 'duplicate-book-work', title: 'Duplicate Book Work' },
        { mediaId: '/works/duplicate-book-work', title: 'Duplicate Book Work' },
        { mediaId: 'DUPLICATE-BOOK-WORK', title: 'Duplicate Book Work' },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].type, MediaType.BOOK);
    assert.deepStrictEqual(res.body.skipped, []);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(getWorkMock.mock.callCount(), 1);
    assert.strictEqual(getWorkEditionsMock.mock.callCount(), 1);
    assert.strictEqual(await getRepository(MediaRequest).count(), 1);
  });

  it('dedupes no-ISBN book bulk items by title and author', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(10, 'ebook')];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) =>
        ({
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: 'Deník malého poseroutky: psí život',
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}-edition`,
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      items: [
        {
          mediaId: 'OL44696722W',
          title: 'Deník malého poseroutky: psí život',
          authorId: 'OL2832500A',
        },
        {
          mediaId: 'OL44696721W',
          title: 'Denik maleho poseroutky: psi zivot',
          authorId: 'OL2832500A',
        },
        {
          mediaId: 'OL44696720W',
          title: 'Deník malého poseroutky: psí život',
          authorId: 'OL2832500A',
        },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.deepStrictEqual(res.body.skipped, []);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(getWorkMock.mock.callCount(), 1);
    assert.strictEqual(getWorkEditionsMock.mock.callCount(), 1);
    assert.strictEqual(await getRepository(MediaRequest).count(), 1);
  });

  it('accepts zero-valued Bookshelf service and profile overrides in bulk book requests', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(0, 'ebook', false)];
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) =>
        ({
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: workId,
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}-edition`,
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
    });

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      serverId: 0,
      profileId: 0,
      metadataProfileId: 0,
      items: [
        {
          mediaId: 'zero-book-work',
          title: 'Zero Book Work',
          authorId: 'OL1A',
          isbn13: '9780441478125',
          editionId: 'zero-book-work-edition',
        },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].serverId, 0);
    assert.strictEqual(res.body.created[0].profileId, 0);
    assert.strictEqual(res.body.created[0].metadataProfileId, 0);
  });

  it('does not count skipped music bulk items against quota', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    friend.musicQuotaLimit = 4;
    friend.musicQuotaDays = 7;
    await userRepo.save(friend);
    const duplicateMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'duplicate-album',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media: duplicateMedia,
        requestedBy: friend,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const failedMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'failed-album',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        media: failedMedia,
        requestedBy: friend,
        status: MediaRequestStatus.FAILED,
        is4k: false,
      })
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async (releaseGroupId: string) =>
        ({
          release_group_mbid: releaseGroupId,
          release_group_metadata: {
            release_group: {
              name: releaseGroupId,
            },
            artist: {
              name: 'Bulk Artist',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
      friend.musicQuotaLimit = undefined;
      friend.musicQuotaDays = undefined;
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [
        { mediaId: 'duplicate-album', title: 'Duplicate Album' },
        { mediaId: 'failed-album', title: 'Failed Album Retry' },
        { mediaId: 'new-album', title: 'New Album' },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.deepStrictEqual(
      res.body.created.map(
        (createdRequest: { media: { mbId: string } }) =>
          createdRequest.media.mbId
      ),
      ['failed-album', 'new-album']
    );
    assert.deepStrictEqual(res.body.skipped, [
      {
        mediaId: 'duplicate-album',
        title: 'Duplicate Album',
        reason: 'Request for this album already exists.',
      },
    ]);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(await getRepository(MediaRequest).count(), 4);
  });

  it('does not count skipped book bulk items against quota', async (t) => {
    const settings = getSettings();
    settings.readarr = [createReadarrSettings(10, 'ebook')];
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    friend.bookQuotaLimit = 2;
    friend.bookQuotaDays = 7;
    await userRepo.save(friend);
    const duplicateMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media: duplicateMedia,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'duplicate-work',
        canonical: true,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media: duplicateMedia,
        requestedBy: friend,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async (workId: string) =>
        ({
          key: `/works/${workId.replace(/^\/?works\//, '')}`,
          title: workId,
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async (workId: string) =>
        ({
          size: 1,
          entries: [
            {
              key: `/books/${workId.replace(/^\/?works\//, '')}-edition`,
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
      settings.readarr = [];
      friend.bookQuotaLimit = undefined;
      friend.bookQuotaDays = undefined;
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.BOOK,
      format: 'ebook',
      items: [
        { mediaId: 'duplicate-work', title: 'Duplicate Work' },
        {
          mediaId: 'new-work',
          title: 'New Work',
          authorId: 'OL1A',
          isbn13: '9780441478125',
          editionId: 'new-work-edition',
        },
      ],
    });

    assert.strictEqual(res.status, 207);
    assert.strictEqual(res.body.created.length, 1);
    assert.strictEqual(res.body.created[0].type, MediaType.BOOK);
    assert.strictEqual(res.body.created[0].bookFormat, 'ebook');
    assert.deepStrictEqual(res.body.skipped, [
      {
        mediaId: 'duplicate-work',
        title: 'Duplicate Work',
        reason: 'Request for this book already exists.',
      },
    ]);
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('rejects quota overage before creating any bulk requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(10)];
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    friend.musicQuotaLimit = 1;
    friend.musicQuotaDays = 7;
    await userRepo.save(friend);
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => {
        throw new Error('Bulk request should not fetch item metadata');
      }
    );
    t.after(() => {
      getAlbumMock.mock.restore();
      settings.lidarr = [];
    });

    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request/bulk').send({
      mediaType: MediaType.MUSIC,
      items: [
        { mediaId: 'quota-one', title: 'Quota One' },
        { mediaId: 'quota-two', title: 'Quota Two' },
      ],
    });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /music quota exceeded/i);
    assert.strictEqual(getAlbumMock.mock.callCount(), 0);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });
});
