import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import { IssueStatus, IssueType } from '@server/constants/issue';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { MAX_MUSICBRAINZ_BATCH_IDS } from '@server/lib/externalIds';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import musicRoutes, {
  MAX_ALBUM_TRACKS,
  collectAlbumTrackArtists,
} from './music';

let app: Express;

describe('album track artist bounds', () => {
  it('validates, deduplicates, and caps provider track credits', () => {
    const artists = collectAlbumTrackArtists([
      {
        tracks: Array.from(
          { length: Math.ceil((MAX_MUSICBRAINZ_BATCH_IDS + 2) / 20) },
          (_, trackIndex) => ({
            artists: Array.from({ length: 20 }, (_, artistIndex) => {
              const index = trackIndex * 20 + artistIndex;
              if (index === 0) {
                return { artist_mbid: ' ABC ', artist_credit_name: 'First' };
              }
              if (index === 1) {
                return { artist_mbid: 'abc', artist_credit_name: 'Duplicate' };
              }
              if (index === 2) {
                return {
                  artist_mbid: 'bad',
                  artist_credit_name: 'x'.repeat(513),
                };
              }
              return {
                artist_mbid: `id-${index}`,
                artist_credit_name: `Artist ${index}`,
              };
            }),
          })
        ),
      },
    ]);

    assert.deepStrictEqual(artists[0], {
      artistId: 'abc',
      artistName: 'First',
    });
    assert.strictEqual(artists.length, MAX_MUSICBRAINZ_BATCH_IDS);
    assert.deepStrictEqual(collectAlbumTrackArtists({}), []);
  });

  it('stops scanning provider tracks at the global inspection limit', () => {
    const artists = collectAlbumTrackArtists([
      {
        tracks: [
          ...Array.from({ length: MAX_ALBUM_TRACKS }, () => ({ artists: [] })),
          {
            artists: [
              { artist_mbid: 'too-late', artist_credit_name: 'Too Late' },
            ],
          },
        ],
      },
    ]);

    assert.deepStrictEqual(artists, []);
  });
});

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
  app.use('/music', musicRoutes);
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

const albumDetails = {
  release_group_metadata: {
    artist: {
      artists: [
        {
          artist_mbid: 'artist-id',
          type: 'Group',
        },
      ],
    },
  },
};

describe('GET /music/:id artist lists', () => {
  it('rejects malformed album IDs before artist discography provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get(`/music/${'x'.repeat(129)}/artist-discography`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('rejects malformed artist discography slider flags before provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get(
      '/music/release-group-id/artist-discography?slider=yes'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Slider must be valid/);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('rejects malformed album IDs before similar artist provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get(`/music/${'x'.repeat(129)}/artist-similar`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('normalizes empty artist discography pagination', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => albumDetails
    );
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      releaseGroups: [],
    }));

    const agent = await login();
    const res = await agent.get(
      '/music/release-group-id/artist-discography?page=999999'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 500);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('normalizes empty similar artist pagination', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => albumDetails
    );
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      similarArtists: {
        artists: [],
      },
    }));

    const agent = await login();
    const res = await agent.get(
      '/music/release-group-id/artist-similar?page=999999'
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.page, 500);
    assert.strictEqual(res.body.totalPages, 1);
    assert.strictEqual(res.body.totalResults, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('sorts similar artists without mutating the cached provider response', async () => {
    const artists = Object.freeze([
      {
        artist_mbid: 'lower-score',
        name: 'Lower Score',
        score: 1,
        type: 'Group',
      },
      {
        artist_mbid: 'higher-score',
        name: 'Higher Score',
        score: 10,
        type: 'Group',
      },
    ]);
    mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => albumDetails
    );
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async () => ({
      similarArtists: { artists },
    }));
    mock.method(TheAudioDb.prototype, 'batchGetArtistImages', async () => ({}));

    const agent = await login();
    const res = await agent.get('/music/release-group-id/artist-similar');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map((artist: { id: string }) => artist.id),
      ['higher-score', 'lower-score']
    );
    assert.deepStrictEqual(
      artists.map((artist) => artist.artist_mbid),
      ['lower-score', 'higher-score']
    );
  });
});

describe('GET /music/:id', () => {
  it('rejects malformed album detail IDs before provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get(`/music/${'x'.repeat(129)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('rejects path-control album IDs before provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get('/music/album%3Fredirect%3D%2Faccount');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('rejects malformed album artist IDs before provider lookup', async () => {
    const getAlbum = mock.method(ListenBrainzAPI.prototype, 'getAlbum');

    const agent = await login();
    const res = await agent.get(`/music/${'x'.repeat(129)}/artist`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAlbum.mock.callCount(), 0);
  });

  it('returns album details when optional ListenBrainz stats and tags are absent', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => ({
      release_group_mbid: 'release-group-id',
      type: 'Album',
      release_group_metadata: {
        release_group: {
          name: 'Sparse Album',
          date: '2024-01-01',
        },
        artist: {
          name: 'Sparse Artist',
          artists: [],
        },
      },
      mediums: [
        {
          tracks: [
            {
              name: 'Sparse Track',
              position: 1,
              length: 180000,
              recording_mbid: 'recording-id',
            },
          ],
        },
      ],
    }));

    const agent = await login();
    const res = await agent.get('/music/release-group-id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'release-group-id');
    assert.strictEqual(res.body.title, 'Sparse Album');
    assert.deepStrictEqual(res.body.tags.artist, []);
    assert.deepStrictEqual(res.body.stats.listeners, []);
    assert.deepStrictEqual(res.body.tracks[0].artists, []);
  });

  it('falls back to MusicBrainz when ListenBrainz has no album detail page', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => {
      throw new Error('[ListenBrainz] Failed to fetch album details: 404');
    });
    mock.method(MusicBrainz.prototype, 'getReleaseGroupDetails', async () => ({
      id: 'release-group-id',
      score: 100,
      media_type: 'album',
      title: 'MusicBrainz Album',
      'primary-type': 'Album',
      'first-release-date': '2024-02-03',
      'artist-credit': [
        {
          name: 'MusicBrainz Artist',
          artist: {
            id: 'artist-id',
            name: 'MusicBrainz Artist',
            'sort-name': 'Artist, MusicBrainz',
          },
        },
      ],
      posterPath: undefined,
      'type-id': '',
      'primary-type-id': '',
      count: 1,
      releases: [],
      releasedate: '2024-02-03',
      tags: [{ count: 5, name: 'jazz' }],
    }));

    const agent = await login();
    const res = await agent.get('/music/release-group-id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'release-group-id');
    assert.strictEqual(res.body.title, 'MusicBrainz Album');
    assert.strictEqual(res.body.artist.name, 'MusicBrainz Artist');
    assert.deepStrictEqual(res.body.tags.releaseGroup, [
      { count: 5, genreMbid: '', tag: 'jazz' },
    ]);
  });

  it('returns 404 when neither music detail provider has the album', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => {
      throw new Error('[ListenBrainz] Failed to fetch album details: 404');
    });
    mock.method(MusicBrainz.prototype, 'getReleaseGroupDetails', async () => {
      throw new Error(
        '[MusicBrainz] Failed to fetch release group details: Request failed with status code 404'
      );
    });

    const agent = await login();
    const res = await agent.get('/music/missing-release-group-id');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.message, 'Album not found');
  });

  it('filters saved media request users from music detail responses', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => ({
      release_group_mbid: 'release-group-id',
      type: 'Album',
      release_group_metadata: {
        release_group: {
          name: 'Saved Album',
          date: '2024-01-01',
        },
        artist: {
          name: 'Saved Artist',
          artists: [],
        },
        tag: {
          artist: [],
          release_group: [],
        },
      },
      listening_stats: {
        total_listen_count: 0,
        total_user_count: 0,
        listeners: [],
      },
      mediums: [],
    }));

    await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'release-group-id',
        mediaType: MediaType.MUSIC,
      })
    );

    const agent = await login();
    const res = await agent.get('/music/release-group-id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mediaInfo.mbId, 'release-group-id');
  });

  it('hydrates independent request and issue trees without dropping detail state', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => ({
      release_group_mbid: 'release-group-id',
      type: 'Album',
      release_group_metadata: {
        release_group: { name: 'Saved Album', date: '2024-01-01' },
        artist: { name: 'Saved Artist', artists: [] },
        tag: { artist: [], release_group: [] },
      },
      listening_stats: {
        total_listen_count: 0,
        total_user_count: 0,
        listeners: [],
      },
      mediums: [],
    }));

    const user = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'release-group-id',
        mediaType: MediaType.MUSIC,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: user,
        modifiedBy: user,
        is4k: false,
      })
    );
    await getRepository(Issue).save(
      new Issue({
        createdBy: user,
        issueType: IssueType.AUDIO,
        status: IssueStatus.OPEN,
        media,
        comments: [
          new IssueComment({ user, message: 'Independent issue comment' }),
        ],
      })
    );

    const agent = await login();
    const res = await agent.get('/music/release-group-id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mediaInfo.requests.length, 1);
    assert.strictEqual(res.body.mediaInfo.issues.length, 1);
    assert.strictEqual(
      res.body.mediaInfo.issues[0].comments[0].message,
      'Independent issue comment'
    );
  });
});
