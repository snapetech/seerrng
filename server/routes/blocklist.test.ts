import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import blocklistRoutes from './blocklist';

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
  app.use('/blocklist', blocklistRoutes);
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

describe('POST /blocklist', () => {
  it('rejects malformed blocklist identifiers before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: 'not-a-number',
      title: 'Bad Movie',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
  });

  it('rejects non-integer blocklist tmdb IDs before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: '1.5',
      title: 'Bad Movie',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Invalid blocklist payload/);
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
  });

  it('rejects oversized external blocklist identifiers', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'x'.repeat(513),
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      title: 'Oversized Album',
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
  });

  it('assigns the authenticated user when blocklisting music by external id', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'MUSICBRAINZ-RELEASE-GROUP-ID',
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      title: 'Test Album',
    });

    assert.strictEqual(res.status, 201);

    const blocklistItem = await getRepository(Blocklist).findOneOrFail({
      where: {
        mediaType: MediaType.MUSIC,
        externalId: 'musicbrainz-release-group-id',
      },
      relations: { media: true },
    });

    assert.strictEqual(blocklistItem.user?.email, 'admin@seerr.dev');
    assert.strictEqual(blocklistItem.tmdbId, 0);
    assert.strictEqual(blocklistItem.media.status, MediaStatus.BLOCKLISTED);
    assert.strictEqual(
      blocklistItem.media.mbId,
      'musicbrainz-release-group-id'
    );
  });

  it('assigns the authenticated user and canonical identifier when blocklisting books', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.BOOK,
      externalId: '/works/ol123w',
      externalProvider: MediaIdentifierProvider.OPENLIBRARY,
      title: 'Test Book',
    });

    assert.strictEqual(res.status, 201);

    const blocklistItem = await getRepository(Blocklist).findOneOrFail({
      where: {
        mediaType: MediaType.BOOK,
        externalId: 'OL123W',
      },
      relations: { media: { identifiers: true } },
    });

    assert.strictEqual(blocklistItem.user?.email, 'admin@seerr.dev');
    assert.strictEqual(blocklistItem.tmdbId, 0);
    assert.strictEqual(blocklistItem.media.status, MediaStatus.BLOCKLISTED);
    assert.deepStrictEqual(
      blocklistItem.media.identifiers.map((identifier) => ({
        provider: identifier.provider,
        value: identifier.value,
        canonical: identifier.canonical,
      })),
      [
        {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: 'OL123W',
          canonical: true,
        },
      ]
    );
  });

  it('allows multiple music and book blocklist entries with tmdbId zero', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const requests = [
      {
        mediaType: MediaType.MUSIC,
        externalId: 'musicbrainz-release-group-one',
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
        title: 'First Album',
      },
      {
        mediaType: MediaType.MUSIC,
        externalId: 'musicbrainz-release-group-two',
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
        title: 'Second Album',
      },
      {
        mediaType: MediaType.BOOK,
        externalId: 'OL111W',
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
        title: 'First Book',
      },
      {
        mediaType: MediaType.BOOK,
        externalId: 'OL222W',
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
        title: 'Second Book',
      },
    ];

    for (const body of requests) {
      const res = await agent.post('/blocklist').send(body);
      assert.strictEqual(res.status, 201);
    }

    assert.strictEqual(
      await getRepository(Blocklist).count({
        where: { mediaType: MediaType.MUSIC },
      }),
      2
    );
    assert.strictEqual(
      await getRepository(Blocklist).count({
        where: { mediaType: MediaType.BOOK },
      }),
      2
    );
  });

  it('blocks duplicate external blocklist ids after normalization', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const music = await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'DUPLICATE-MUSIC-ID',
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      title: 'Duplicate Album',
    });
    const duplicateMusic = await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'duplicate-music-id',
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      title: 'Duplicate Album',
    });
    const book = await agent.post('/blocklist').send({
      mediaType: MediaType.BOOK,
      externalId: '/works/ol333w',
      externalProvider: MediaIdentifierProvider.OPENLIBRARY,
      title: 'Duplicate Book',
    });
    const duplicateBook = await agent.post('/blocklist').send({
      mediaType: MediaType.BOOK,
      externalId: 'OL333W',
      externalProvider: MediaIdentifierProvider.OPENLIBRARY,
      title: 'Duplicate Book',
    });

    assert.strictEqual(music.status, 201);
    assert.strictEqual(duplicateMusic.status, 412);
    assert.strictEqual(book.status, 201);
    assert.strictEqual(duplicateBook.status, 412);
  });

  it('links an existing book media row through its identifier', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL456W',
            canonical: true,
          }),
        ],
      })
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.BOOK,
      externalId: 'OL456W',
      externalProvider: MediaIdentifierProvider.OPENLIBRARY,
      title: 'Existing Book',
    });

    assert.strictEqual(res.status, 201);

    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
      relations: { blocklist: true },
    });

    assert.strictEqual(savedMedia.status, MediaStatus.BLOCKLISTED);
    assert.strictEqual((await savedMedia.blocklist).externalId, 'OL456W');
  });
});

describe('GET and DELETE /blocklist/:id', () => {
  it('rejects malformed blocklist list query parameters', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const malformedTake = await agent.get('/blocklist?take=1.5');
    const repeatedSearch = await agent.get(
      '/blocklist?search=movie&search=show'
    );

    assert.strictEqual(malformedTake.status, 400);
    assert.match(malformedTake.body.message, /Invalid blocklist query/);
    assert.strictEqual(repeatedSearch.status, 400);
    assert.match(repeatedSearch.body.message, /Invalid blocklist query/);
  });

  it('rejects malformed numeric media identifiers', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const lookup = await agent
      .get('/blocklist/not-a-number')
      .query({ mediaType: MediaType.MOVIE });

    assert.strictEqual(lookup.status, 400);
    assert.match(lookup.body.message, /invalid blocklist identifier/i);
  });

  it('uses external ids for music lookups and deletes', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'MUSICBRAINZ-DELETE-ID',
      externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      title: 'Delete Album',
    });

    const lookup = await agent
      .get('/blocklist/musicbrainz-delete-id')
      .query({ mediaType: MediaType.MUSIC });

    assert.strictEqual(lookup.status, 200);
    assert.strictEqual(lookup.body.externalId, 'musicbrainz-delete-id');

    const deleted = await agent
      .delete('/blocklist/musicbrainz-delete-id')
      .query({ mediaType: MediaType.MUSIC });

    assert.strictEqual(deleted.status, 204);

    const remaining = await getRepository(Blocklist).count({
      where: {
        mediaType: MediaType.MUSIC,
        externalId: 'musicbrainz-delete-id',
      },
    });

    assert.strictEqual(remaining, 0);
  });
});
