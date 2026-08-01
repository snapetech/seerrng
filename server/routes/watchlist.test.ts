import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier from '@server/entity/MediaIdentifier';
import {
  MediaRequest,
  runWithRequestAdmission,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { Watchlist } from '@server/entity/Watchlist';
import { Permission } from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import authRoutes from './auth';
import watchlistRoutes from './watchlist';

let app: Express;

const getAlbumMock = mock.method(
  ListenBrainzAPI.prototype,
  'getAlbum',
  async () =>
    ({
      release_group_mbid: 'watchlist-release-group',
      release_group_metadata: {
        release_group: {
          name: 'Watchlist Album',
        },
      },
    }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
);

const getWorkMock = mock.method(
  OpenLibraryAPI.prototype,
  'getWork',
  async () => ({
    key: '/works/OL45804W',
    title: 'The Left Hand of Darkness',
    description: 'A testable book.',
    covers: [1],
    authors: [{ author: { key: '/authors/OL1A' } }],
  })
);

const mediaRequestMock = mock.method(
  MediaRequest,
  'request',
  async () => new MediaRequest()
);

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
  app.use('/watchlist', watchlistRoutes);
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
  getAlbumMock.mock.resetCalls();
  getWorkMock.mock.resetCalls();
  mediaRequestMock.mock.resetCalls();
  mediaRequestMock.mock.mockImplementation(async () => new MediaRequest());
  getSettings().readarr = [];
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

describe('POST /watchlist', () => {
  it('rejects MusicBrainz path-control IDs before provider work', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const response = await agent.post('/watchlist').send({
      mediaType: MediaType.MUSIC,
      mbId: '../album?redirect=/account',
      title: 'Invalid album',
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(getAlbumMock.mock.callCount(), 0);
  });

  it('rejects Open Library path-control IDs before provider work', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const response = await agent.post('/watchlist').send({
      mediaType: MediaType.BOOK,
      externalId: '/works/../../search',
      title: 'Invalid book',
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(getWorkMock.mock.callCount(), 0);
  });

  it('rejects create and delete after the session credential changes', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneByOrFail({ id: 1 });
    const oldCredentialVersion = admin.passwordChangedAt?.getTime() ?? 0;
    await userRepository.update(1, {
      passwordChangedAt: new Date(oldCredentialVersion + 1_000),
      permissions: Permission.ADMIN,
    });
    const existing = await getRepository(Watchlist).save(
      new Watchlist({
        mediaType: MediaType.MUSIC,
        mbId: 'stale-session-delete',
        requestedBy: admin,
        title: 'Must remain',
      })
    );
    const staleSessionApp = express();
    staleSessionApp.use(express.json());
    staleSessionApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      req.session = {
        userId: 1,
        credentialVersion: oldCredentialVersion,
      } as typeof req.session;
      next();
    });
    staleSessionApp.use('/watchlist', watchlistRoutes);
    staleSessionApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const [createResponse, deleteResponse] = await Promise.all([
      request(staleSessionApp).post('/watchlist').send({
        mediaType: MediaType.MUSIC,
        mbId: 'stale-session-create',
        title: 'Must not be created',
      }),
      request(staleSessionApp).delete(
        '/watchlist/stale-session-delete?mediaType=music'
      ),
    ]);

    assert.strictEqual(createResponse.status, 403);
    assert.strictEqual(deleteResponse.status, 403);
    assert.strictEqual(getAlbumMock.mock.callCount(), 0);
    assert.ok(await getRepository(Watchlist).findOneBy({ id: existing.id }));
    assert.strictEqual(
      await getRepository(Watchlist).countBy({ mbId: 'stale-session-create' }),
      0
    );
  });

  it('returns forbidden when credentials rotate during watchlist admission', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const userRepository = getRepository(User);
    const actor = await userRepository.findOneByOrFail({ id: 1 });
    const originalRun = requestAdmissionCoordinator.run.bind(
      requestAdmissionCoordinator
    );
    let rotated = false;
    requestAdmissionCoordinator.run = async (resourceKeys, callback) => {
      if (!rotated && resourceKeys.includes('user-security:user:1')) {
        rotated = true;
        await userRepository.update(1, {
          passwordChangedAt: new Date(
            (actor.passwordChangedAt?.getTime() ?? 0) + 1_000
          ),
        });
      }
      return originalRun(resourceKeys, callback);
    };

    try {
      const response = await agent.post('/watchlist').send({
        mediaType: MediaType.MUSIC,
        mbId: 'rotated-watchlist-session',
        title: 'Must not be created',
      });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(
        await getRepository(Watchlist).existsBy({
          mbId: 'rotated-watchlist-session',
        }),
        false
      );
    } finally {
      requestAdmissionCoordinator.run = originalRun;
    }
  });

  it('rejects malformed watchlist create payloads before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: 'not-a-number',
      title: 'Bad Movie',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(await getRepository(Watchlist).count(), 0);
  });

  it('rejects non-integer watchlist tmdb IDs before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: '1.5',
      title: 'Bad Movie',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(await getRepository(Watchlist).count(), 0);
  });

  it('terminates the request when downstream code throws a non-error', async () => {
    const createMock = mock.method(Watchlist, 'createWatchlist', () =>
      Promise.reject('unexpected failure')
    );

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const res = await agent.post('/watchlist').send({
        mediaType: MediaType.MOVIE,
        tmdbId: 123456,
        title: 'Failure Test',
      });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.message, 'Unable to create watchlist.');
    } finally {
      createMock.mock.restore();
    }
  });

  it('auto-requests music watchlist items when music watchlist sync is enabled', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({
      watchlistSyncMusic: true,
    });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MUSIC,
      mbId: 'watchlist-release-group',
      title: 'Watchlist Album',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.mbId, 'watchlist-release-group');
    assert.strictEqual(getAlbumMock.mock.callCount(), 1);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 1);
    assert.deepStrictEqual(mediaRequestMock.mock.calls[0].arguments[0], {
      mediaId: 'watchlist-release-group',
      mediaType: MediaType.MUSIC,
    });
    assert.strictEqual(
      mediaRequestMock.mock.calls[0].arguments[2]?.isAutoRequest,
      true
    );
  });

  it('releases canonical admission before starting a nested auto-request', async () => {
    const canonicalKey = 'request-canonical:music:nested-lock-release';
    mediaRequestMock.mock.mockImplementation(async () =>
      runWithRequestAdmission([canonicalKey], async () => new MediaRequest())
    );

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({ watchlistSyncMusic: true });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    let timeout: NodeJS.Timeout | undefined;
    const response = await Promise.race([
      agent.post('/watchlist').send({
        mediaType: MediaType.MUSIC,
        mbId: 'nested-lock-release',
        title: 'Nested Lock Release',
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Nested watchlist auto-request deadlocked.')),
          1_000
        );
      }),
    ]).finally(() => clearTimeout(timeout));

    assert.strictEqual(response.status, 201);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 1);
  });

  it('does not auto-request music watchlist items when music watchlist sync is disabled', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.MUSIC,
      mbId: 'watchlist-release-group-disabled',
      title: 'Watchlist Album',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 0);
  });

  it('auto-requests book watchlist items when book watchlist sync is enabled', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({
      watchlistSyncBooks: true,
    });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.BOOK,
      externalId: 'OL45804W',
      title: 'The Left Hand of Darkness',
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(getWorkMock.mock.callCount(), 1);
    assert.strictEqual(mediaRequestMock.mock.callCount(), 1);
    assert.deepStrictEqual(mediaRequestMock.mock.calls[0].arguments[0], {
      mediaId: 'OL45804W',
      mediaType: MediaType.BOOK,
      format: 'ebook',
    });
    assert.strictEqual(
      mediaRequestMock.mock.calls[0].arguments[2]?.isAutoRequest,
      true
    );
  });

  it('auto-requests audiobook when only an audiobook Bookshelf default exists', async () => {
    getSettings().readarr = [
      {
        id: 20,
        name: 'Audio Bookshelf',
        hostname: 'audiobooks.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 2,
        activeProfileName: 'Audio',
        activeMetadataProfileId: 2,
        activeMetadataProfileName: 'Audio',
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

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    admin.settings = new UserSettings({
      watchlistSyncBooks: true,
    });
    await userRepository.save(admin);

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/watchlist').send({
      mediaType: MediaType.BOOK,
      externalId: 'OLAudioW',
      title: 'Audio Book',
    });

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(mediaRequestMock.mock.calls[0].arguments[0], {
      mediaId: 'OLAudioW',
      mediaType: MediaType.BOOK,
      format: 'audiobook',
    });
  });

  it('blocks duplicate book watchlist items by Open Library ID for the same user', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const body = {
      mediaType: MediaType.BOOK,
      externalId: '/works/OL123W',
      title: 'Duplicate Book',
    };

    const firstRes = await agent.post('/watchlist').send(body);
    const duplicateRes = await agent.post('/watchlist').send({
      ...body,
      externalId: 'ol123w',
    });

    assert.strictEqual(firstRes.status, 201);
    assert.strictEqual(firstRes.body.externalId, 'OL123W');
    assert.strictEqual(duplicateRes.status, 409);
  });

  it('serializes concurrent watchlist creation before external work repeats', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const body = {
      mediaType: MediaType.BOOK,
      externalId: 'OL45804W',
      title: 'Concurrent Book',
    };

    const responses = await Promise.all([
      agent.post('/watchlist').send(body),
      agent.post('/watchlist').send(body),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    assert.equal(getWorkMock.mock.callCount(), 1);
    assert.equal(await getRepository(Watchlist).count(), 1);
  });

  it('blocks duplicate music watchlist items by normalized MusicBrainz ID', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const body = {
      mediaType: MediaType.MUSIC,
      mbId: 'WATCHLIST-RELEASE-GROUP',
      title: 'Duplicate Album',
    };

    const firstRes = await agent.post('/watchlist').send(body);
    const duplicateRes = await agent.post('/watchlist').send({
      ...body,
      mbId: 'watchlist-release-group',
    });

    assert.strictEqual(firstRes.status, 201);
    assert.strictEqual(firstRes.body.mbId, 'watchlist-release-group');
    assert.strictEqual(duplicateRes.status, 409);
  });

  it('rolls back new music media when the watchlist insert fails', async () => {
    const mbId = 'watchlist-transaction-rollback';
    const subscriber: EntitySubscriberInterface<Watchlist> = {
      listenTo: () => Watchlist,
      beforeInsert: (event: InsertEvent<Watchlist>) => {
        if (event.entity.mbId === mbId) {
          throw new Error('forced watchlist insert failure');
        }
      },
    };
    dataSource.subscribers.push(subscriber);

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const response = await agent.post('/watchlist').send({
        mediaType: MediaType.MUSIC,
        mbId,
        title: 'Transactional Album',
      });

      assert.strictEqual(response.status, 500);
      assert.strictEqual(
        await getRepository(Media).existsBy({
          mediaType: MediaType.MUSIC,
          mbId,
        }),
        false
      );
      assert.strictEqual(
        await getRepository(Watchlist).existsBy({ mbId }),
        false
      );
    } finally {
      dataSource.subscribers.splice(
        dataSource.subscribers.indexOf(subscriber),
        1
      );
    }
  });

  it('rolls back new book media and its identifier when the watchlist insert fails', async () => {
    const externalId = 'OLWATCHLISTROLLBACKW';
    const mediaCountBefore = await getRepository(Media).countBy({
      mediaType: MediaType.BOOK,
    });
    const subscriber: EntitySubscriberInterface<Watchlist> = {
      listenTo: () => Watchlist,
      beforeInsert: (event: InsertEvent<Watchlist>) => {
        if (event.entity.externalId === externalId) {
          throw new Error('forced watchlist insert failure');
        }
      },
    };
    dataSource.subscribers.push(subscriber);

    try {
      const agent = await loginAs('admin@seerr.dev', 'test1234');
      const response = await agent.post('/watchlist').send({
        mediaType: MediaType.BOOK,
        externalId,
        title: 'Transactional Book',
      });

      assert.strictEqual(response.status, 500);
      assert.strictEqual(
        await getRepository(MediaIdentifier).existsBy({ value: externalId }),
        false
      );
      assert.strictEqual(
        await getRepository(Media).countBy({ mediaType: MediaType.BOOK }),
        mediaCountBefore
      );
      assert.strictEqual(
        await getRepository(Watchlist).existsBy({ externalId }),
        false
      );
    } finally {
      dataSource.subscribers.splice(
        dataSource.subscribers.indexOf(subscriber),
        1
      );
    }
  });
});

describe('DELETE /watchlist/:mediaId', () => {
  it('returns a stable message for a missing watchlist item', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(
      '/watchlist/missing-release-group?mediaType=music'
    );

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.message, 'Watchlist item not found.');
  });

  it('rejects malformed numeric watchlist IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete('/watchlist/not-a-number?mediaType=movie');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid mediaId/i);
  });

  it('rejects oversized external watchlist IDs', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent
      .delete(`/watchlist/${'x'.repeat(513)}`)
      .query({ mediaType: MediaType.MUSIC });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid mediaId/i);
  });

  it('deletes music watchlist items by MusicBrainz ID', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const watchlistRepository = getRepository(Watchlist);
    await watchlistRepository.save(
      new Watchlist({
        mediaType: MediaType.MUSIC,
        mbId: 'delete-release-group-id',
        title: 'Delete Album',
        requestedBy: admin,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(
      '/watchlist/delete-release-group-id?mediaType=music'
    );

    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      await watchlistRepository.exist({
        where: {
          mediaType: MediaType.MUSIC,
          mbId: 'delete-release-group-id',
          requestedBy: { id: admin.id },
        },
      }),
      false
    );
  });

  it('deletes book watchlist items by Open Library ID', async () => {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const watchlistRepository = getRepository(Watchlist);
    await watchlistRepository.save(
      new Watchlist({
        mediaType: MediaType.BOOK,
        externalId: 'OLdeleteW',
        title: 'Delete Book',
        requestedBy: admin,
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.delete(
      `/watchlist/${encodeURIComponent('/works/OLdeleteW')}?mediaType=book`
    );

    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      await watchlistRepository.exist({
        where: {
          mediaType: MediaType.BOOK,
          externalId: 'OLdeleteW',
          requestedBy: { id: admin.id },
        },
      }),
      false
    );
  });
});
