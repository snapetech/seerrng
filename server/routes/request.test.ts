import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import ReadarrAPI from '@server/api/servarr/readarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import requestRoutes from './request';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
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

describe('GET /request/count', () => {
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
  it('persists server and root folder changes to the database', async () => {
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
  });
});

describe('GET /request', () => {
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
  it('rejects malformed request bodies before request processing', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.post('/request').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Request body must be an object/i);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
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

  it('accepts zero-valued Lidarr service and profile overrides in music requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(0)];
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

  it('blocks book requests when the discovered ISBN is blocklisted', async (t) => {
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

  it('rejects unknown request status actions', async () => {
    const pending = await seedRequest(MediaRequestStatus.PENDING);
    const admin = await loginAs('admin@seerr.dev', 'test1234');
    const res = await admin.post(`/request/${pending.id}/not-a-status`);

    assert.strictEqual(res.status, 404);
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
        reason: 'ListenBrainz unavailable',
      },
    ]);
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
  });

  it('accepts zero-valued Lidarr service and profile overrides in bulk music requests', async (t) => {
    const settings = getSettings();
    settings.lidarr = [createLidarrSettings(0)];
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
    settings.readarr = [createReadarrSettings(0, 'ebook')];
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
    friend.musicQuotaLimit = 2;
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
        { mediaId: 'new-album', title: 'New Album' },
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
    assert.deepStrictEqual(res.body.failed, []);
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
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
