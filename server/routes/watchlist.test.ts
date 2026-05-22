import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
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
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
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
});

describe('DELETE /watchlist/:mediaId', () => {
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
