import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type DVRSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import mediaRoutes, {
  MAX_TAUTULLI_WATCH_USER_IDS,
  parseTautulliPlexUserIds,
} from './media';

describe('Tautulli watch-user bounds', () => {
  it('validates, deduplicates, and caps provider IDs below SQL limits', () => {
    const values = [
      { user_id: 1 },
      { user_id: '1' },
      { user_id: -1 },
      { user_id: 'not-an-id' },
      ...Array.from(
        { length: MAX_TAUTULLI_WATCH_USER_IDS + 10 },
        (_, index) => ({ user_id: index + 2 })
      ),
    ];
    const ids = parseTautulliPlexUserIds(values);

    assert.strictEqual(ids.length, MAX_TAUTULLI_WATCH_USER_IDS);
    assert.deepStrictEqual(ids.slice(0, 3), [1, 2, 3]);
    assert.deepStrictEqual(parseTautulliPlexUserIds({}), []);
  });
});

let app: Express;

const removeBookMock = mock.method(
  ReadarrAPI.prototype,
  'removeBook',
  async () => undefined
);
const removeMovieMock = mock.fn(async (movieId: number) => {
  void movieId;
});
const removeSeriesMock = mock.fn(async (tvdbId: number) => {
  void tvdbId;
});
const getTvShowMock = mock.fn(
  async (options: Parameters<TheMovieDb['getTvShow']>[0]) => {
    void options;
    return { external_ids: { tvdb_id: 777 } } as Awaited<
      ReturnType<TheMovieDb['getTvShow']>
    >;
  }
);
const getMediaWatchStatsMock = mock.method(
  TautulliAPI.prototype,
  'getMediaWatchStats',
  async () => [
    { query_days: 0, total_time: 400, total_plays: 4 },
    { query_days: 7, total_time: 200, total_plays: 2 },
    { query_days: 30, total_time: 300, total_plays: 3 },
  ]
);
const getMediaWatchUsersMock = mock.method(
  TautulliAPI.prototype,
  'getMediaWatchUsers',
  async () => [
    {
      friendly_name: 'Admin',
      user_id: 1,
      user_thumb: '',
      username: 'admin',
      total_plays: 4,
      total_time: 400,
    },
  ]
);
for (const [prototype, method, implementation] of [
  [RadarrAPI.prototype, 'removeMovie', removeMovieMock],
  [SonarrAPI.prototype, 'removeSeries', removeSeriesMock],
  [TheMovieDb.prototype, 'getTvShow', getTvShowMock],
] as const) {
  Object.defineProperty(prototype, method, {
    configurable: true,
    get: () => implementation,
    set: () => undefined,
  });
}

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
  app.use('/media', mediaRoutes);
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
  removeBookMock.mock.resetCalls();
  removeBookMock.mock.mockImplementation(async () => undefined);
  removeMovieMock.mock.resetCalls();
  removeMovieMock.mock.mockImplementation(async () => undefined);
  removeSeriesMock.mock.resetCalls();
  removeSeriesMock.mock.mockImplementation(async () => undefined);
  getTvShowMock.mock.resetCalls();
  getMediaWatchStatsMock.mock.resetCalls();
  getMediaWatchUsersMock.mock.resetCalls();
  const settings = getSettings();
  settings.radarr = [
    {
      id: 30,
      name: 'Radarr',
      hostname: 'radarr.local',
      port: 7878,
      apiKey: 'radarr-key',
      useSsl: false,
      activeProfileId: 1,
      activeProfileName: 'Movies',
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
    {
      id: 40,
      name: 'Radarr 4K',
      hostname: 'radarr4k.local',
      port: 7878,
      apiKey: 'radarr-4k-key',
      useSsl: false,
      activeProfileId: 2,
      activeProfileName: 'Movies 4K',
      activeDirectory: '/movies-4k',
      minimumAvailability: 'released',
      tags: [],
      is4k: true,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
    },
  ];
  settings.sonarr = [
    {
      id: 50,
      name: 'Sonarr',
      hostname: 'sonarr.local',
      port: 8989,
      apiKey: 'sonarr-key',
      useSsl: false,
      activeProfileId: 1,
      activeProfileName: 'TV',
      activeDirectory: '/tv',
      seriesType: 'standard',
      animeSeriesType: 'anime',
      enableSeasonFolders: true,
      monitorNewItems: 'all',
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
    },
    {
      id: 60,
      name: 'Sonarr 4K',
      hostname: 'sonarr4k.local',
      port: 8989,
      apiKey: 'sonarr-4k-key',
      useSsl: false,
      activeProfileId: 2,
      activeProfileName: 'TV 4K',
      activeDirectory: '/tv-4k',
      seriesType: 'standard',
      animeSeriesType: 'anime',
      enableSeasonFolders: true,
      monitorNewItems: 'all',
      tags: [],
      is4k: true,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
    },
  ];
  settings.readarr = [
    {
      id: 10,
      name: 'Bookshelf',
      hostname: 'bookshelf.local',
      port: 8787,
      apiKey: 'ebook-key',
      useSsl: false,
      baseUrl: '',
      activeProfileId: 1,
      activeProfileName: 'Ebooks',
      activeDirectory: '/books',
      activeMetadataProfileId: 1,
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
      serviceType: 'ebook',
    },
    {
      id: 20,
      name: 'Audio Bookshelf',
      hostname: 'audiobooks.local',
      port: 8787,
      apiKey: 'audio-key',
      useSsl: false,
      baseUrl: '',
      activeProfileId: 2,
      activeProfileName: 'Audio',
      activeDirectory: '/audiobooks',
      activeMetadataProfileId: 2,
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

describe('GET /media', () => {
  it('rejects malformed list filter values', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/media?filter=pending&filter=available');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Filter must be a string/);
  });

  it('rejects unknown list sort values', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/media?sort=drop-table');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sort must be valid/);
  });

  it('filters media lists by media type before pagination', async () => {
    await getRepository(Media).save([
      new Media({
        tmdbId: 0,
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2026-01-03T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 123,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 456,
        mediaType: MediaType.TV,
        status: MediaStatus.PARTIALLY_AVAILABLE,
        mediaAddedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        mediaAddedAt: new Date('2025-12-31T00:00:00.000Z'),
      }),
    ]);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get(
      '/media?filter=allavailable&sort=mediaAdded&take=20&mediaType=movie,tv'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((item: { mediaType: string }) => item.mediaType),
      [MediaType.MOVIE, MediaType.TV]
    );
  });

  it('rejects malformed media type filters', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get('/media?mediaType=movie,invalid');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media type must be valid/);
  });

  it('denies media-list access without recent-view or request-management permission', async () => {
    const agent = await loginAs('friend@seerr.dev', 'test1234');
    const res = await agent.get(
      '/media?filter=allavailable&sort=mediaAdded&mediaType=movie,tv'
    );

    assert.strictEqual(res.status, 403);
  });

  it('returns only safe recent-media fields to recent-view users', async () => {
    const userRepository = getRepository(User);
    await userRepository.update(2, { permissions: Permission.RECENT_VIEW });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 999_001,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        mediaAddedAt: new Date('2026-02-01T00:00:00.000Z'),
        serviceId: 30,
        externalServiceId: 40,
        externalServiceSlug: 'private-release',
        ratingKey: 'private-rating-key',
        jellyfinMediaId: 'private-jellyfin-id',
      })
    );

    try {
      const agent = await loginAs('friend@seerr.dev', 'test1234');
      const res = await agent.get(
        '/media?filter=allavailable&sort=mediaAdded&mediaType=movie,tv'
      );

      assert.strictEqual(res.status, 200);
      const item = res.body.results.find(
        (result: { id: number }) => result.id === media.id
      );
      assert.ok(item);
      assert.deepStrictEqual(Object.keys(item).sort(), [
        'id',
        'mediaAddedAt',
        'mediaType',
        'status',
        'status4k',
        'tmdbId',
      ]);

      const denied = await agent.get('/media?filter=pending&sort=modified');
      assert.strictEqual(denied.status, 403);
    } finally {
      await userRepository.update(2, { permissions: Permission.REQUEST });
    }
  });
});

describe('GET /media/:id/watch_data', () => {
  it('revalidates administrator authority before using Tautulli credentials', async () => {
    await getRepository(User).update(1, {
      permissions: Permission.REQUEST,
    });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/media', mediaRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const response = await request(staleAuthorizationApp).get(
      '/media/1/watch_data'
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(getMediaWatchStatsMock.mock.callCount(), 0);
    assert.strictEqual(getMediaWatchUsersMock.mock.callCount(), 0);
  });

  it('filters watcher entities at the response boundary', async () => {
    const settings = getSettings();
    settings.tautulli = {
      hostname: 'tautulli.local',
      port: 8181,
      apiKey: 'tautulli-key',
      useSsl: false,
    };
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 901,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        ratingKey: 'standard-key',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.get(`/media/${media.id}/watch_data`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.users.length, 1);
    assert.strictEqual(res.body.data.users[0].id, 1);
    assert.strictEqual(res.body.data.users[0].password, undefined);
    assert.strictEqual(res.body.data.users[0].plexToken, undefined);
    assert.strictEqual(res.body.data.users[0].settings, undefined);
    assert.deepStrictEqual(
      {
        playCount: res.body.data.playCount,
        playCount7Days: res.body.data.playCount7Days,
        playCount30Days: res.body.data.playCount30Days,
      },
      { playCount: 4, playCount7Days: 2, playCount30Days: 3 }
    );
  });
});

describe('POST /media/:id/:status', () => {
  it('rejects malformed media IDs before lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/media/not-a-number/available').send();

    assert.strictEqual(res.status, 404);
  });

  it('rejects unknown media status transitions', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 1,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/not-a-status`).send();

    assert.strictEqual(res.status, 404);

    const persisted = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(persisted.status, MediaStatus.PENDING);
  });

  it('rejects malformed season status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 2,
        mediaType: MediaType.TV,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/available`).send({
      seasons: [{ seasonNumber: 'not-a-number' }],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /seasonNumber must be an integer/i);
  });

  it('rejects malformed media status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 4,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post(`/media/${media.id}/available`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media status body must be an object/);

    const persisted = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(persisted.status, MediaStatus.PENDING);
  });

  it('rejects string is4k status update bodies', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 3,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .post(`/media/${media.id}/available`)
      .send({ is4k: 'true' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be a boolean/i);
  });
});

describe('DELETE /media/:id/file', () => {
  it('uses an explicitly linked zero-valued service instead of the default', async (t) => {
    const settings = getSettings();
    settings.radarr.unshift({
      ...settings.radarr[0],
      id: 0,
      name: 'Zero Radarr',
      hostname: 'zero-radarr.local',
      apiKey: 'zero-key',
      isDefault: false,
    });
    const observedServiceIds: number[] = [];
    const originalBuildUrl = RadarrAPI.buildUrl;
    const buildUrlMock = mock.method(
      RadarrAPI,
      'buildUrl',
      (
        server: Pick<
          DVRSettings,
          'id' | 'useSsl' | 'hostname' | 'port' | 'baseUrl'
        >,
        apiPath?: string
      ) => {
        observedServiceIds.push(server.id);
        return originalBuildUrl(server, apiPath);
      }
    );
    t.after(() => buildUrlMock.mock.restore());
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 1000,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        serviceId: 0,
        externalServiceId: 2000,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const response = await agent.delete(`/media/${media.id}/file`);

    assert.strictEqual(response.status, 204);
    assert.deepStrictEqual(observedServiceIds, [0]);
  });

  it('serializes a provider deletion with a concurrent status mutation', async () => {
    let deletionStarted!: () => void;
    let releaseDeletion!: () => void;
    const deletionStartedPromise = new Promise<void>((resolve) => {
      deletionStarted = resolve;
    });
    const releaseDeletionPromise = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    removeMovieMock.mock.mockImplementation(async () => {
      deletionStarted();
      await releaseDeletionPromise;
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 1001,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        serviceId: 30,
        externalServiceId: 3001,
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const deletion = agent
      .delete(`/media/${media.id}/file`)
      .then((response) => response);
    await deletionStartedPromise;
    let statusFinished = false;
    const statusMutation = agent
      .post(`/media/${media.id}/processing`)
      .send()
      .then((response) => {
        statusFinished = true;
        return response;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(statusFinished, false);
    releaseDeletion();
    const [deletionResponse, statusResponse] = await Promise.all([
      deletion,
      statusMutation,
    ]);
    assert.strictEqual(deletionResponse.status, 204);
    assert.strictEqual(statusResponse.status, 200);
    const persisted = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.strictEqual(persisted.status, MediaStatus.PROCESSING);
    assert.strictEqual(persisted.serviceId, null);
    assert.strictEqual(persisted.externalServiceId, null);
  });

  it('persists standard movie deletion without clearing the 4K service link', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 101,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.AVAILABLE,
        serviceId: 30,
        externalServiceId: 301,
        externalServiceSlug: 'movie',
        serviceId4k: 40,
        externalServiceId4k: 401,
        externalServiceSlug4k: 'movie-4k',
        ratingKey: 'standard-key',
        ratingKey4k: '4k-key',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file`);

    assert.strictEqual(res.status, 204);
    assert.strictEqual(removeMovieMock.mock.callCount(), 1);
    assert.strictEqual(removeMovieMock.mock.calls[0].arguments[0], 101);
    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.status, MediaStatus.DELETED);
    assert.strictEqual(updated.serviceId, null);
    assert.strictEqual(updated.externalServiceId, null);
    assert.strictEqual(updated.externalServiceSlug, null);
    assert.strictEqual(updated.ratingKey, null);
    assert.strictEqual(updated.status4k, MediaStatus.AVAILABLE);
    assert.strictEqual(updated.serviceId4k, 40);
    assert.strictEqual(updated.externalServiceId4k, 401);
    assert.strictEqual(updated.externalServiceSlug4k, 'movie-4k');
    assert.strictEqual(updated.ratingKey4k, '4k-key');
  });

  it('persists 4K series deletion and season state without clearing standard links', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 202,
        tvdbId: 777,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.AVAILABLE,
        serviceId: 50,
        externalServiceId: 501,
        serviceId4k: 60,
        externalServiceId4k: 601,
        seasons: [
          new Season({
            seasonNumber: 1,
            status: MediaStatus.AVAILABLE,
            status4k: MediaStatus.AVAILABLE,
          }),
        ],
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?is4k=true`);

    assert.strictEqual(res.status, 204);
    assert.strictEqual(removeSeriesMock.mock.callCount(), 1);
    assert.strictEqual(removeSeriesMock.mock.calls[0].arguments[0], 777);
    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.status, MediaStatus.AVAILABLE);
    assert.strictEqual(updated.serviceId, 50);
    assert.strictEqual(updated.externalServiceId, 501);
    assert.strictEqual(updated.status4k, MediaStatus.DELETED);
    assert.strictEqual(updated.serviceId4k, null);
    assert.strictEqual(updated.externalServiceId4k, null);
    assert.strictEqual(updated.seasons[0].status, MediaStatus.AVAILABLE);
    assert.strictEqual(updated.seasons[0].status4k, MediaStatus.DELETED);
  });

  it('rejects malformed is4k file deletion query values', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?is4k=yes`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /is4k must be valid/i);
    assert.strictEqual(removeBookMock.mock.callCount(), 0);
  });

  it('rejects unknown book format query values before deletion', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=pdf`);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Format must be valid/);
    assert.strictEqual(removeBookMock.mock.callCount(), 0);
  });

  it('removes only the ebook link when an audiobook link remains', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
        audiobookServiceId: 20,
        audiobookExternalServiceId: 200,
        audiobookExternalServiceSlug: 'audiobook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=ebook`);

    assert.strictEqual(res.status, 204);
    assert.strictEqual(removeBookMock.mock.callCount(), 1);
    assert.strictEqual(removeBookMock.mock.calls[0].arguments[0], 100);

    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.serviceId, null);
    assert.strictEqual(updated.externalServiceId, null);
    assert.strictEqual(updated.externalServiceSlug, null);
    assert.strictEqual(updated.audiobookServiceId, 20);
    assert.strictEqual(updated.audiobookExternalServiceId, 200);
    assert.strictEqual(updated.audiobookExternalServiceSlug, 'audiobook-slug');
    assert.strictEqual(updated.status, MediaStatus.PARTIALLY_AVAILABLE);
  });

  it('persists successful book format removals when another format fails', async () => {
    removeBookMock.mock.mockImplementation(async (bookId: number) => {
      if (bookId === 200) {
        throw new Error('Audiobook removal failed');
      }
    });

    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.AVAILABLE,
        serviceId: 10,
        externalServiceId: 100,
        externalServiceSlug: 'ebook-slug',
        audiobookServiceId: 20,
        audiobookExternalServiceId: 200,
        audiobookExternalServiceSlug: 'audiobook-slug',
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(`/media/${media.id}/file?format=both`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(removeBookMock.mock.callCount(), 2);
    assert.strictEqual(removeBookMock.mock.calls[0].arguments[0], 100);
    assert.strictEqual(removeBookMock.mock.calls[1].arguments[0], 200);

    const updated = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(updated.serviceId, null);
    assert.strictEqual(updated.externalServiceId, null);
    assert.strictEqual(updated.externalServiceSlug, null);
    assert.strictEqual(updated.audiobookServiceId, 20);
    assert.strictEqual(updated.audiobookExternalServiceId, 200);
    assert.strictEqual(updated.audiobookExternalServiceSlug, 'audiobook-slug');
    assert.strictEqual(updated.status, MediaStatus.PARTIALLY_AVAILABLE);
  });
});
