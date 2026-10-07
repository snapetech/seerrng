import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import LidarrAPI from '@server/api/servarr/lidarr';
import TheAudioDb from '@server/api/theaudiodb';
import { IssueStatus, IssueType } from '@server/constants/issue';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
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

// Successful ListenBrainz detail fixtures still ask MusicBrainz for taxonomy.
// Model an explicitly unavailable supplemental record, not a swallowed socket error.
function mockAlbumEnrichment(
  mbId: string,
  options: { taxonomy?: boolean; artwork?: boolean } = {}
) {
  const assertions: (() => void)[] = [];
  if (options.taxonomy !== false) {
    const taxonomy = mock.method(
      MusicBrainz.prototype,
      'getReleaseGroupDetails',
      async () => {
        throw new Error(
          '[MusicBrainz] Fixture release group unavailable: status code 404'
        );
      }
    );
    assertions.push(() =>
      assert.deepStrictEqual(
        taxonomy.mock.calls.map((call) => call.arguments),
        [[{ releaseGroupId: mbId }]]
      )
    );
  }
  if (options.artwork !== false) {
    const artwork = mock.method(
      CoverArtArchive.prototype,
      'getCoverArt',
      async () => ({ images: [], release: `/release/${mbId}` })
    );
    assertions.push(() =>
      assert.deepStrictEqual(
        artwork.mock.calls.map((call) => call.arguments),
        [[mbId]]
      )
    );
  }
  // Assert before afterEach restores spies; Vitest clears their call history.
  return () => {
    for (const assertion of assertions) {
      assertion();
    }
  };
}

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
    const assertEnrichment = mockAlbumEnrichment('release-group-id');
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
    assertEnrichment();
  });

  it('includes release labels when MusicBrainz exposes them', async () => {
    const assertEnrichment = mockAlbumEnrichment('release-group-id', {
      artwork: false,
    });
    const releaseId = '00000000-0000-0000-0000-000000000001';
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => ({
      caa_release_mbid: releaseId,
      recordings_release_mbid: '',
      release_group_mbid: 'release-group-id',
      type: 'Album',
      release_group_metadata: {
        release_group: {
          name: 'Labelled Album',
          date: '2024-01-01',
          caa_id: 0,
          caa_release_mbid: '',
          rels: [],
          type: 'Album',
        },
        release: {
          caa_id: 0,
          caa_release_mbid: releaseId,
          date: '2024-01-01',
          name: 'Labelled Album',
          rels: [],
          type: 'Album',
        },
        artist: {
          name: 'Labelled Artist',
          artist_credit_id: 0,
          artists: [],
        },
        tag: { artist: [], release_group: [] },
      },
      listening_stats: {
        artist_mbids: [],
        artist_name: 'Labelled Artist',
        caa_id: 0,
        caa_release_mbid: releaseId,
        from_ts: 0,
        last_updated: 0,
        listeners: [],
        release_group_mbid: 'release-group-id',
        release_group_name: 'Labelled Album',
        stats_range: '',
        to_ts: 0,
        total_listen_count: 0,
        total_user_count: 0,
      },
      mediums: [],
    }));
    mock.method(MusicBrainz.prototype, 'getReleaseLabels', async () => [
      'Example Records',
      'Example Records Publishing',
    ]);
    mock.method(CoverArtArchive.prototype, 'getCoverArt', async () => ({
      images: [],
    }));

    const agent = await login();
    const res = await agent.get('/music/release-group-id');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.body.recordLabel,
      'Example Records, Example Records Publishing'
    );
    assertEnrichment();
  });

  it('falls back to MusicBrainz when ListenBrainz has no album detail page', async (t) => {
    const settings = getSettings();
    const originalLidarr = settings.lidarr;
    settings.lidarr = [];
    t.after(() => {
      settings.lidarr = originalLidarr;
    });
    const assertEnrichment = mockAlbumEnrichment('release-group-id', {
      taxonomy: false,
    });
    const images = mock.method(
      TheAudioDb.prototype,
      'getArtistImages',
      async () => ({ artistThumb: null, artistBackground: null })
    );
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
    assert.deepStrictEqual(
      images.mock.calls.map((call) => call.arguments),
      [['artist-id']]
    );
    assertEnrichment();
  });

  it('returns the normalized MusicBrainz release-group rating and vote count', async () => {
    const audioRating = mock.method(
      TheAudioDb.prototype,
      'getAlbumRating',
      async () => {
        throw new Error('Fixture TheAudioDb rating unavailable');
      }
    );
    mock.method(
      MusicBrainz.prototype,
      'getReleaseGroupDetails',
      async () =>
        ({
          id: 'release-group-id',
          score: 100,
          media_type: 'album',
          title: 'Rated Album',
          'primary-type': 'Album',
          'first-release-date': '2024-02-03',
          'artist-credit': [],
          posterPath: undefined,
          'type-id': '',
          'primary-type-id': '',
          count: 0,
          releases: [],
          releasedate: '2024-02-03',
          rating: { value: 4.25, 'votes-count': 32 },
        }) as Awaited<ReturnType<MusicBrainz['getReleaseGroupDetails']>>
    );

    const agent = await login();
    const res = await agent.get('/music/release-group-id/rating');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      audioRating.mock.calls.map((call) => call.arguments),
      [['release-group-id']]
    );
    assert.deepStrictEqual(res.body, {
      rating: {
        score: 8.5,
        votes: 32,
        url: 'https://musicbrainz.org/release-group/release-group-id',
        source: 'musicbrainz',
      },
      ratings: [
        {
          score: 8.5,
          votes: 32,
          url: 'https://musicbrainz.org/release-group/release-group-id',
          source: 'musicbrainz',
        },
      ],
      failedSources: ['theaudiodb'],
    });
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
    const assertEnrichment = mockAlbumEnrichment('release-group-id');
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
    assertEnrichment();
  });

  it('returns every available Lidarr quality without exposing completed requests', async (t) => {
    const assertEnrichment = mockAlbumEnrichment('quality-release-group-id');
    const albums = mock.method(LidarrAPI.prototype, 'getAlbums', async () => [
      {
        id: 10,
        mbId: 'quality-release-group-id',
        foreignAlbumId: 'quality-release-group-id',
        title: 'Quality Album',
        monitored: true,
        artistId: 1,
        titleSlug: 'quality-album',
        profileId: 1,
        duration: 180000,
        albumType: 'Album',
        statistics: {
          trackFileCount: 0,
          trackCount: 1,
          totalTrackCount: 1,
          sizeOnDisk: 0,
          percentOfTracks: 0,
        },
      },
    ]);
    const tracks = mock.method(LidarrAPI.prototype, 'getTracks', async () => [
      {
        id: 1,
        albumId: 10,
        title: 'Quality Track',
        trackNumber: '1',
        absoluteTrackNumber: 1,
        mediumNumber: 1,
        hasFile: false,
        trackFileId: 0,
        foreignRecordingId: 'quality-recording-id',
      },
    ]);
    mock.method(ListenBrainzAPI.prototype, 'getAlbum', async () => ({
      release_group_mbid: 'quality-release-group-id',
      type: 'Album',
      release_group_metadata: {
        release_group: { name: 'Quality Album', date: '2024-01-01' },
        artist: { name: 'Quality Artist', artists: [] },
        tag: { artist: [], release_group: [] },
      },
      listening_stats: {
        total_listen_count: 0,
        total_user_count: 0,
        listeners: [],
      },
      mediums: [],
    }));

    const settings = getSettings();
    settings.lidarr = [
      {
        id: 1,
        name: 'Lidarr MP3',
        hostname: 'lidarr-mp3.local',
        port: 8686,
        apiKey: 'mp3-key',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'MP3',
        activeMetadataProfileId: 1,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music-mp3',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
      {
        id: 2,
        name: 'Lidarr FLAC',
        hostname: 'lidarr-flac.local',
        port: 8686,
        apiKey: 'flac-key',
        useSsl: false,
        activeProfileId: 2,
        activeProfileName: 'FLAC',
        activeMetadataProfileId: 1,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music-flac',
        tags: [],
        is4k: false,
        isDefault: false,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
    t.after(() => {
      settings.lidarr = [];
    });

    const user = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mbId: 'quality-release-group-id',
        mediaType: MediaType.MUSIC,
        status: MediaStatus.AVAILABLE,
        serviceId: 1,
        externalServiceId: 10,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        status: MediaRequestStatus.COMPLETED,
        media,
        requestedBy: user,
        is4k: false,
        serverId: 2,
        serviceTargets: [
          {
            serviceType: 'lidarr',
            format: 'music',
            serverId: 2,
            externalServiceId: 20,
            status: MediaStatus.AVAILABLE,
          },
        ],
      })
    );

    const agent = await login();
    const res = await agent.get('/music/quality-release-group-id');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      albums.mock.calls.map((call) => call.arguments),
      [[300], [300]]
    );
    assert.deepStrictEqual(
      tracks.mock.calls.map((call) => call.arguments),
      [
        [{ albumId: 10 }, 300],
        [{ albumId: 10 }, 300],
      ]
    );
    assert.deepStrictEqual(res.body.trackAvailability, { mp3: [], flac: [] });
    assert.deepStrictEqual(res.body.availableServices, [
      { serverId: 1, quality: 'MP3' },
      { serverId: 2, quality: 'FLAC' },
    ]);
    assert.strictEqual(res.body.mediaInfo.requests.length, 0);
    assertEnrichment();
  });

  it('hydrates independent request and issue trees without dropping detail state', async () => {
    const assertEnrichment = mockAlbumEnrichment('release-group-id');
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
    assertEnrichment();
  });
});
