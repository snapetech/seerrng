import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import artistRoutes, {
  MAX_ARTIST_PROVIDER_RELEASE_GROUPS,
  MAX_ARTIST_RELEASE_GROUP_TYPES,
  MAX_DEFAULT_ARTIST_RELEASE_GROUPS,
} from './artist';
import authRoutes from './auth';

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
  app.use('/artist', artistRoutes);
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

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
  cacheManager.getCache('associations').flush();
});

setupTestDb();

async function login() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

const artistDetails = (similarCount: number) => ({
  artist: {
    area: 'US',
    artist_mbid: 'root-artist',
    begin_year: 2000,
    mbid: 'root-artist',
    name: 'Root Artist',
    rels: {},
    tag: { artist: [] },
    type: 'Group',
  },
  coverArt: '',
  listeningStats: { total_listen_count: 0, total_user_count: 0 },
  popularRecordings: [],
  releaseGroups: [],
  similarArtists: {
    artists: Array.from({ length: similarCount }, (_, index) => ({
      artist_mbid: `similar-${index + 1}`,
      name: `Similar Artist ${index + 1}`,
      score: 100 - index,
      type: 'Group',
    })),
    topRecordingColor: { red: 0, green: 0, blue: 0 },
    topReleaseGroupColor: { red: 0, green: 0, blue: 0 },
  },
});

describe('GET /artist/:id/similar', () => {
  it('rejects malformed artist IDs before association lookup', async () => {
    const getArtist = mock.method(ListenBrainzAPI.prototype, 'getArtist');

    const agent = await login();
    const res = await agent.get(`/artist/${'x'.repeat(129)}/similar`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getArtist.mock.callCount(), 0);
  });

  it('returns paginated similar artists from the association graph', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () =>
      artistDetails(3)
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));
    mock.method(TmdbPersonMapper.prototype, 'batchGetMappings', async () => []);

    const agent = await login();
    const res = await agent.get(
      '/artist/root-artist/similar?page=2&pageSize=1'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 2);
    assert.strictEqual(res.body.pageSize, 1);
    assert.strictEqual(res.body.totalPages, 3);
    assert.strictEqual(res.body.totalResults, 3);
    assert.deepStrictEqual(
      res.body.results.map((artist: { id: string; name: string }) => [
        artist.id,
        artist.name,
      ]),
      [['similar-2', 'Similar Artist 2']]
    );
  });

  it('normalizes invalid pagination input and caps page size', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () =>
      artistDetails(60)
    );
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));
    mock.method(TmdbPersonMapper.prototype, 'batchGetMappings', async () => []);

    const agent = await login();
    const res = await agent.get(
      '/artist/root-artist/similar?page=999999&pageSize=999'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 500);
    assert.strictEqual(res.body.pageSize, 50);
    assert.strictEqual(res.body.totalPages, 2);
    assert.strictEqual(res.body.totalResults, 60);
    assert.strictEqual(res.body.results.length, 0);
  });
});

describe('GET /artist/:id', () => {
  it('rejects malformed artist detail IDs before provider lookup', async () => {
    const getArtist = mock.method(ListenBrainzAPI.prototype, 'getArtist');

    const agent = await login();
    const res = await agent.get(`/artist/${'x'.repeat(129)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getArtist.mock.callCount(), 0);
  });

  it('rejects path-control artist IDs before provider lookup', async () => {
    const getArtist = mock.method(ListenBrainzAPI.prototype, 'getArtist');

    const agent = await login();
    const res = await agent.get('/artist/artist%3Fredirect%3D%2Faccount');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getArtist.mock.callCount(), 0);
  });

  it('rejects oversized album type filters before provider lookup', async () => {
    const getArtist = mock.method(ListenBrainzAPI.prototype, 'getArtist');
    const getWikipedia = mock.method(
      MusicBrainz.prototype,
      'getArtistWikipediaExtract'
    );

    const agent = await login();
    const res = await agent
      .get('/artist/root-artist')
      .query({ albumType: 'x'.repeat(129) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getArtist.mock.callCount(), 0);
    assert.strictEqual(getWikipedia.mock.callCount(), 0);
  });

  it('paginates all release groups when album type is All', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      artist: {
        area: 'US',
        artist_mbid: 'root-artist',
        begin_year: 2000,
        mbid: 'root-artist',
        name: 'Root Artist',
        rels: {},
        tag: { artist: [] },
        type: 'Group',
      },
      coverArt: '',
      listeningStats: { total_listen_count: 0, total_user_count: 0 },
      popularRecordings: [],
      similarArtists: {
        artists: [],
        topRecordingColor: { red: 0, green: 0, blue: 0 },
        topReleaseGroupColor: { red: 0, green: 0, blue: 0 },
      },
      releaseGroups: [
        {
          mbid: 'album-new',
          name: 'Newest Album',
          type: 'Album',
          date: '2024-01-01',
          artist_credit_name: 'Root Artist',
          artists: [],
          total_listen_count: 10,
        },
        {
          mbid: 'single-mid',
          name: 'Middle Single',
          type: 'Single',
          date: '2023-01-01',
          artist_credit_name: 'Root Artist',
          artists: [],
          total_listen_count: 9,
        },
        {
          mbid: 'ep-old',
          name: 'Oldest EP',
          type: 'EP',
          date: '2022-01-01',
          artist_credit_name: 'Root Artist',
          artists: [],
          total_listen_count: 8,
        },
      ],
    }));
    mock.method(
      MusicBrainz.prototype,
      'getArtistWikipediaExtract',
      async () => null
    );
    mock.method(TheAudioDb.prototype, 'getArtistImages', async () => null);

    const agent = await login();
    const res = await agent.get(
      '/artist/root-artist?albumType=All&page=2&pageSize=2'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.pagination, {
      page: 2,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      albumType: 'All',
    });
    assert.deepStrictEqual(
      res.body.releaseGroups.map(
        (releaseGroup: { id: string }) => releaseGroup.id
      ),
      ['ep-old']
    );
  });

  it('caps provider-defined release types and the default SQL hydration set', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      ...artistDetails(0),
      releaseGroups: Array.from({ length: 800 }, (_, index) => ({
        mbid: `release-${index}`,
        name: `Release ${index}`,
        type:
          index < 20 ? '__proto__' : `Provider Type ${Math.floor(index / 20)}`,
        date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
        artist_credit_name: 'Root Artist',
        artists: [],
        total_listen_count: 800 - index,
      })),
    }));
    mock.method(
      MusicBrainz.prototype,
      'getArtistWikipediaExtract',
      async () => null
    );
    mock.method(TheAudioDb.prototype, 'getArtistImages', async () => null);

    const agent = await login();
    const res = await agent.get('/artist/root-artist');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.body.releaseGroups.length,
      MAX_DEFAULT_ARTIST_RELEASE_GROUPS
    );
    assert.ok(
      Object.keys(res.body.typeCounts).length <= MAX_ARTIST_RELEASE_GROUP_TYPES
    );
    assert.ok(res.body.typeCounts.Other > 0);
  });

  it('does not expose unused raw ListenBrainz artist payloads', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getArtist',
      async () =>
        ({
          ...artistDetails(1),
          coverArt: 'https://provider.example/raw-cover',
          listeningStats: {
            total_listen_count: 10,
            total_user_count: 5,
            listeners: [{ user_name: 'listener-secret', listen_count: 10 }],
          },
          popularRecordings: [{ recording_name: 'unused-recording' }],
          unexpectedProviderField: 'must-not-cross-boundary',
        }) as never
    );
    mock.method(
      MusicBrainz.prototype,
      'getArtistWikipediaExtract',
      async () => null
    );
    mock.method(TheAudioDb.prototype, 'getArtistImages', async () => null);

    const agent = await login();
    const res = await agent.get('/artist/root-artist');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.artist, {
      name: 'Root Artist',
      area: 'US',
    });
    assert.ok(!('coverArt' in res.body));
    assert.ok(!('listeningStats' in res.body));
    assert.ok(!('popularRecordings' in res.body));
    assert.ok(!('similarArtists' in res.body));
    assert.ok(!('unexpectedProviderField' in res.body));
  });

  it('bounds and validates provider discography records before deduplication', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getArtist',
      async () =>
        ({
          ...artistDetails(0),
          releaseGroups: [
            null,
            { mbid: 'invalid', name: 123, artist_credit_name: 'Artist' },
            ...Array.from(
              { length: MAX_ARTIST_PROVIDER_RELEASE_GROUPS + 100 },
              (_, index) => ({
                mbid: `release-${index}`,
                name: `Release ${index}`,
                type: 'Album',
                date: '2026-01-01',
                artist_credit_name: 'Root Artist',
                artists:
                  index === 0
                    ? Array.from({ length: 1_000 }, () => ({ raw: 'unused' }))
                    : [],
                total_listen_count: index,
              })
            ),
          ],
        }) as never
    );
    mock.method(
      MusicBrainz.prototype,
      'getArtistWikipediaExtract',
      async () => null
    );
    mock.method(TheAudioDb.prototype, 'getArtistImages', async () => null);

    const agent = await login();
    const res = await agent.get(
      '/artist/root-artist?albumType=All&page=1&pageSize=1'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.body.pagination.totalItems,
      MAX_ARTIST_PROVIDER_RELEASE_GROUPS - 2
    );
    assert.strictEqual(res.body.releaseGroups.length, 1);
    assert.ok(!('artists' in res.body.releaseGroups[0]));
  });
});
