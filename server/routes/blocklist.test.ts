import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import blocklistRoutes, {
  MAX_BLOCKLIST_COLLECTION_PARTS,
  parseBlocklistCollectionParts,
} from './blocklist';

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

afterEach(() => {
  mock.restoreAll();
});

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
  it('revalidates blocklist authority before list and detail reads', async () => {
    const item = await getRepository(Blocklist).save(
      new Blocklist({
        mediaType: MediaType.MOVIE,
        tmdbId: 909090,
        title: 'Private blocklist entry',
      })
    );
    await getRepository(User).update(1, { permissions: Permission.REQUEST });
    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({ id: 1, permissions: Permission.ADMIN });
      next();
    });
    staleAuthorizationApp.use('/blocklist', blocklistRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const [listResponse, detailResponse] = await Promise.all([
      request(staleAuthorizationApp).get('/blocklist'),
      request(staleAuthorizationApp)
        .get(`/blocklist/${item.tmdbId}`)
        .query({ mediaType: MediaType.MOVIE }),
    ]);

    assert.strictEqual(listResponse.status, 403);
    assert.strictEqual(detailResponse.status, 403);
    assert.doesNotMatch(JSON.stringify(listResponse.body), /Private blocklist/);
  });

  it('bounds and validates TMDB collection parts before persistence', async () => {
    assert.deepStrictEqual(parseBlocklistCollectionParts([]), { value: [] });
    assert.ok(
      'error' in
        parseBlocklistCollectionParts([{ id: 'not-an-id', title: 'Malformed' }])
    );
    assert.ok(
      'error' in
        parseBlocklistCollectionParts(
          Array.from(
            { length: MAX_BLOCKLIST_COLLECTION_PARTS + 1 },
            (_, index) => ({ id: index + 1, title: `Movie ${index}` })
          )
        )
    );

    mock.method(
      TheMovieDb.prototype,
      'getCollection',
      async () =>
        ({
          id: 99,
          name: 'Oversized',
          parts: Array.from(
            { length: MAX_BLOCKLIST_COLLECTION_PARTS + 1 },
            (_, index) => ({ id: index + 1, title: `Movie ${index}` })
          ),
        }) as never
    );

    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist/collection/99');

    assert.strictEqual(res.status, 502);
    assert.match(res.body.message, /invalid or too large/i);
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
  });

  it('idempotently persists a bounded TMDB collection', async () => {
    mock.method(
      TheMovieDb.prototype,
      'getCollection',
      async () =>
        ({
          id: 98,
          name: 'Collection',
          parts: [
            { id: 9801, title: 'First movie' },
            { id: 9802, title: 'Second movie' },
          ],
        }) as never
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const first = await agent.post('/blocklist/collection/98');
    const repeated = await agent.post('/blocklist/collection/98');

    assert.strictEqual(first.status, 201);
    assert.strictEqual(repeated.status, 201);
    assert.strictEqual(await getRepository(Blocklist).count(), 2);
    assert.strictEqual(await getRepository(Media).count(), 2);
  });

  it('revalidates blocklist authority after collection lookup', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    let lookupStarted!: () => void;
    let releaseLookup!: () => void;
    const lookupStartedPromise = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    const releaseLookupPromise = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    mock.method(TheMovieDb.prototype, 'getCollection', async () => {
      lookupStarted();
      await releaseLookupPromise;
      return {
        id: 100,
        name: 'Revocation collection',
        parts: [{ id: 1001, title: 'Revoked movie' }],
      } as never;
    });

    const responsePromise = agent
      .post('/blocklist/collection/100')
      .then((response) => response);
    await lookupStartedPromise;
    await getRepository(User).update(1, {
      permissions: Permission.REQUEST,
    });
    releaseLookup();

    const response = await responsePromise;
    assert.strictEqual(response.status, 403);
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
    assert.strictEqual(await getRepository(Media).count(), 0);
  });

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

  it('rejects contradictory media identity shapes before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const [screen, music, book] = await Promise.all([
      agent.post('/blocklist').send({
        mediaType: MediaType.MOVIE,
        tmdbId: 123,
        externalId: 'not-used',
      }),
      agent.post('/blocklist').send({
        mediaType: MediaType.MUSIC,
        tmdbId: 123,
        externalId: 'music-id',
      }),
      agent.post('/blocklist').send({
        mediaType: MediaType.BOOK,
        externalId: 'OL123W',
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      }),
    ]);

    assert.deepStrictEqual(
      [screen.status, music.status, book.status],
      [400, 400, 400]
    );
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
    await assert.rejects(
      Blocklist.addToBlocklist({
        blocklistRequest: {
          mediaType: MediaType.BOOK,
          externalId: 'OL123W',
          externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
        },
      }),
      /identity is invalid/
    );
  });

  it('rejects malformed canonical external IDs before persistence', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const [music, book, isbn] = await Promise.all([
      agent.post('/blocklist').send({
        mediaType: MediaType.MUSIC,
        externalId: '../album?redirect=/account',
      }),
      agent.post('/blocklist').send({
        mediaType: MediaType.BOOK,
        externalId: '/works/../../search',
      }),
      agent.post('/blocklist').send({
        mediaType: MediaType.BOOK,
        externalId: '9780000000000',
        externalProvider: MediaIdentifierProvider.ISBN,
      }),
    ]);

    assert.deepStrictEqual(
      [music.status, book.status, isbn.status],
      [400, 400, 400]
    );
    assert.strictEqual(await getRepository(Blocklist).count(), 0);
    await assert.rejects(
      Blocklist.addToBlocklist({
        blocklistRequest: {
          mediaType: MediaType.MUSIC,
          externalId: '../album',
        },
      }),
      /identity is invalid/
    );
  });

  it('does not accept the automatic tag ownership marker from API input', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: 98765,
      title: 'Manual movie',
      blocklistedTags: ',123,',
    });

    assert.strictEqual(res.status, 201);
    const blocklistItem = await getRepository(Blocklist).findOneOrFail({
      where: { mediaType: MediaType.MOVIE, tmdbId: 98765 },
    });
    assert.strictEqual(blocklistItem.blocklistedTags, null);
  });

  it('assigns the authenticated user when blocklisting music by external id', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const res = await agent.post('/blocklist').send({
      mediaType: MediaType.MUSIC,
      externalId: 'MUSICBRAINZ-RELEASE-GROUP-ID',
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
    assert.strictEqual(
      blocklistItem.externalProvider,
      MediaIdentifierProvider.MUSICBRAINZ
    );
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

  it('admits only one concurrent screen blocklist entry', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const responses = await Promise.all([
      agent.post('/blocklist').send({
        mediaType: MediaType.MOVIE,
        tmdbId: 456789,
        title: 'Concurrent movie',
      }),
      agent.post('/blocklist').send({
        mediaType: MediaType.MOVIE,
        tmdbId: 456789,
        title: 'Concurrent movie',
      }),
    ]);

    assert.deepStrictEqual(
      responses.map((response) => response.status).sort(),
      [201, 412]
    );
    assert.strictEqual(
      await getRepository(Blocklist).countBy({
        mediaType: MediaType.MOVIE,
        tmdbId: 456789,
      }),
      1
    );
    assert.strictEqual(
      await getRepository(Media).countBy({
        mediaType: MediaType.MOVIE,
        tmdbId: 456789,
      }),
      1
    );
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
  it('searches titles case-insensitively with literal wildcard characters', async () => {
    await getRepository(Blocklist).save([
      new Blocklist({
        mediaType: MediaType.MOVIE,
        tmdbId: 880001,
        title: 'MiXeD 100%_Match',
      }),
      new Blocklist({
        mediaType: MediaType.MOVIE,
        tmdbId: 880002,
        title: 'Mixed 100 broad wildcard match',
      }),
    ]);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const response = await agent
      .get('/blocklist')
      .query({ search: 'mixed 100%_' });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      response.body.results.map(({ tmdbId }: { tmdbId: number }) => tmdbId),
      [880001]
    );
  });

  it('rejects malformed blocklist list query parameters', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const malformedTake = await agent.get('/blocklist?take=1.5');
    const repeatedSearch = await agent.get(
      '/blocklist?search=movie&search=show'
    );
    const excessiveOffset = await agent.get('/blocklist?skip=100001');

    assert.strictEqual(malformedTake.status, 400);
    assert.match(malformedTake.body.message, /Invalid blocklist query/);
    assert.strictEqual(repeatedSearch.status, 400);
    assert.match(repeatedSearch.body.message, /Invalid blocklist query/);
    assert.strictEqual(excessiveOffset.status, 400);
    assert.match(excessiveOffset.body.message, /Invalid blocklist query/);
  });

  it('rejects malformed numeric media identifiers', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');
    const lookup = await agent
      .get('/blocklist/not-a-number')
      .query({ mediaType: MediaType.MOVIE });

    assert.strictEqual(lookup.status, 400);
    assert.match(lookup.body.message, /invalid blocklist identifier/i);
  });

  it('returns stable not-found errors without ORM details', async () => {
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const [lookup, deletion] = await Promise.all([
      agent.get('/blocklist/987654321').query({ mediaType: MediaType.MOVIE }),
      agent
        .delete('/blocklist/987654321')
        .query({ mediaType: MediaType.MOVIE }),
    ]);

    for (const response of [lookup, deletion]) {
      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.message, 'Blocklisted item not found.');
      assert.doesNotMatch(
        JSON.stringify(response.body),
        /EntityNotFound|"where"|tmdbId/i
      );
    }
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
    assert.strictEqual(
      await getRepository(Media).count({
        where: {
          mediaType: MediaType.MUSIC,
          mbId: 'musicbrainz-delete-id',
        },
      }),
      0
    );
  });

  it('restores existing media instead of cascading its deletion', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 812345,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.PARTIALLY_AVAILABLE,
        serviceId: 7,
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const blocked = await agent.post('/blocklist').send({
      mediaType: MediaType.MOVIE,
      tmdbId: media.tmdbId,
      title: 'Existing Movie',
    });
    assert.strictEqual(blocked.status, 201);

    const blocklist = await getRepository(Blocklist).findOneOrFail({
      where: { tmdbId: media.tmdbId, mediaType: MediaType.MOVIE },
    });
    assert.strictEqual(blocklist.previousStatus, MediaStatus.AVAILABLE);
    assert.strictEqual(
      blocklist.previousStatus4k,
      MediaStatus.PARTIALLY_AVAILABLE
    );
    assert.strictEqual(blocklist.isMediaPlaceholder, false);

    const unblocked = await agent
      .delete(`/blocklist/${media.tmdbId}`)
      .query({ mediaType: MediaType.MOVIE });
    assert.strictEqual(unblocked.status, 204);

    const restored = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(restored.status, MediaStatus.AVAILABLE);
    assert.strictEqual(restored.status4k, MediaStatus.PARTIALLY_AVAILABLE);
    assert.strictEqual(restored.serviceId, 7);
    assert.strictEqual(
      await getRepository(Blocklist).count({
        where: { tmdbId: media.tmdbId, mediaType: MediaType.MOVIE },
      }),
      0
    );
  });

  it('preserves ambiguous legacy media rows when unblocking', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 812346,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.BLOCKLISTED,
        status4k: MediaStatus.BLOCKLISTED,
      })
    );
    await getRepository(Blocklist).save(
      new Blocklist({
        tmdbId: media.tmdbId,
        mediaType: MediaType.MOVIE,
        media,
        previousStatus: null,
        previousStatus4k: null,
        isMediaPlaceholder: null,
      })
    );
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const unblocked = await agent
      .delete(`/blocklist/${media.tmdbId}`)
      .query({ mediaType: MediaType.MOVIE });
    assert.strictEqual(unblocked.status, 204);

    const preserved = await getRepository(Media).findOneOrFail({
      where: { id: media.id },
    });
    assert.strictEqual(preserved.status, MediaStatus.UNKNOWN);
    assert.strictEqual(preserved.status4k, MediaStatus.UNKNOWN);
  });
});
