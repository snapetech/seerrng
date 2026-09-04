import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import type MusicBrainz from '@server/api/musicbrainz';
import type {
  MbAlbumDetails,
  MbRecordingDetails,
} from '@server/api/musicbrainz/interfaces';
import type { SpotifyPlaylistItems } from '@server/api/spotify';
import type { YouTubePlaylistItems } from '@server/api/youtube';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import {
  parsePlaylistUrl,
  default as playlistRoutes,
  resolveSpotifyPlaylist,
  resolveYouTubePlaylist,
} from './playlist';

const album: MbAlbumDetails = {
  id: 'album-id',
  title: 'Discovery',
  score: 100,
  media_type: 'album',
  'primary-type': 'Album',
  'first-release-date': '2001-03-07',
  'artist-credit': [
    {
      name: 'Daft Punk',
      artist: {
        id: 'artist-id',
        name: 'Daft Punk',
        'sort-name': 'Daft Punk',
      },
    },
  ],
  posterPath: undefined,
  'type-id': '',
  'primary-type-id': '',
  count: 0,
  releases: [],
  releasedate: '2001-03-07',
};

const recording: MbRecordingDetails = {
  id: 'recording-id',
  title: 'Around the World',
  score: 100,
  media_type: 'recording',
  'artist-credit': [
    {
      name: 'Daft Punk',
      artist: {
        id: 'artist-id',
        name: 'Daft Punk',
        'sort-name': 'Daft Punk',
      },
    },
  ],
  'first-release-date': '1997-01-01',
  releases: [
    {
      id: 'release-id',
      title: 'Discovery',
      status: 'Official',
      'first-release-date': '2001-03-07',
      'release-group': {
        id: 'album-id',
        title: 'Discovery',
        'primary-type': 'Album',
        'secondary-types': [],
      },
    },
  ],
};

describe('playlist resolution', () => {
  it('recognizes only supported playlist URL forms', () => {
    assert.deepEqual(
      parsePlaylistUrl('https://open.spotify.com/playlist/abc123'),
      {
        provider: 'spotify',
        id: 'abc123',
        url: 'https://open.spotify.com/playlist/abc123',
      }
    );
    assert.deepEqual(
      parsePlaylistUrl('https://www.youtube.com/playlist?list=PL123456'),
      {
        provider: 'youtube',
        id: 'PL123456',
        url: 'https://www.youtube.com/playlist?list=PL123456',
      }
    );
    assert.equal(
      parsePlaylistUrl('https://example.com/playlist/abc123'),
      undefined
    );
  });

  it('deduplicates Spotify tracks from the same album', async () => {
    const playlist: SpotifyPlaylistItems = {
      name: 'Favourites',
      url: 'https://open.spotify.com/playlist/abc123',
      tracks: [
        {
          title: 'One More Time',
          artists: ['Daft Punk'],
          albumTitle: 'Discovery',
          albumReleaseDate: '2001-03-07',
        },
        {
          title: 'Digital Love',
          artists: ['Daft Punk'],
          albumTitle: 'Discovery',
          albumReleaseDate: '2001-03-07',
        },
      ],
    };
    const fakeMusicBrainz = {
      searchAlbum: async () => [album],
    } as unknown as MusicBrainz;

    const result = await resolveSpotifyPlaylist(playlist, fakeMusicBrainz);
    assert.equal(result.totalItems, 2);
    assert.equal(result.matchedItems, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'album-id');
    assert.equal(result.items[0].sourceTitle, 'One More Time');
  });

  it('resolves a YouTube recording to a requestable release group', async () => {
    const playlist: YouTubePlaylistItems = {
      name: 'Videos',
      url: 'https://www.youtube.com/playlist?list=PL123456',
      tracks: [
        {
          title: 'Daft Punk - Around the World (Official Video)',
          sourceUrl: 'https://www.youtube.com/watch?v=video',
        },
      ],
    };
    const fakeMusicBrainz = {
      searchRecording: async () => [recording],
    } as unknown as MusicBrainz;

    const result = await resolveYouTubePlaylist(playlist, fakeMusicBrainz);
    assert.equal(result.matchedItems, 1);
    assert.equal(result.items[0].id, 'album-id');
    assert.equal(result.items[0].title, 'Discovery');
  });
});

// Regression coverage for the OpenAPI contract: `seerr-api.yml` gates every
// `/api/v1/*` request through `express-openapi-validator` before it reaches
// a route handler (see server/index.ts). The unit tests above call
// `parsePlaylistUrl`/`resolveSpotifyPlaylist`/`resolveYouTubePlaylist`
// directly and never go through that validator, so they could not have
// caught `seerr-api.yml` omitting every `/playlist/*` path (the validator
// 404s an undeclared path with `{ message: 'not found' }` before the
// request ever reaches `playlistRoutes` below). These tests boot the real
// validator against the real spec file to confirm each route is reachable.
describe('playlist routes behind the OpenAPI validator', () => {
  let app: Express;

  function createApp(): Express {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(
      session({
        secret: 'test-secret',
        cookie: { secure: 'auto' },
        resave: false,
        saveUninitialized: false,
      })
    );
    testApp.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
    testApp.use('/api/v1/auth', authRoutes);
    testApp.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    testApp.use('/api/v1/playlist', isAuthenticated(), playlistRoutes);
    testApp.use(
      (
        err: { status?: number; message?: string; errors?: unknown[] },
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) => {
        res.status(err.status ?? 500).json({
          status: err.status ?? 500,
          message: err.message,
          errors: err.errors,
        });
      }
    );
    return testApp;
  }

  before(async () => {
    app = createApp();
  });

  setupTestDb();

  async function loginAsAdmin() {
    const settings = getSettings();
    const priorLocalLogin = settings.main.localLogin;
    settings.main.localLogin = true;

    try {
      const agent = request.agent(app);
      const res = await agent
        .post('/api/v1/auth/local')
        .send({ email: 'admin@seerr.dev', password: 'test1234' });
      assert.strictEqual(res.status, 200);
      return agent;
    } finally {
      settings.main.localLogin = priorLocalLogin;
    }
  }

  it('GET /playlist/spotify/status reaches the handler', async () => {
    const agent = await loginAsAdmin();

    const res = await agent.get('/api/v1/playlist/spotify/status');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { connected: false, displayName: null });
  });

  it('POST /playlist/spotify/disconnect reaches the handler', async () => {
    const agent = await loginAsAdmin();

    const res = await agent.post('/api/v1/playlist/spotify/disconnect');

    assert.strictEqual(res.status, 204);
  });

  it('GET /playlist/spotify/connect reaches the handler (not an OpenAPI 404)', async () => {
    const agent = await loginAsAdmin();
    const priorClientId = getSettings().main.spotifyClientId;
    const priorClientSecret = getSettings().main.spotifyClientSecret;
    getSettings().main.spotifyClientId = '';
    getSettings().main.spotifyClientSecret = '';

    try {
      const res = await agent.get('/api/v1/playlist/spotify/connect');

      // Before seerr-api.yml declared this path, the OpenAPI validator
      // rejected it with a 404 before this handler ever ran. Reaching this
      // app-level 400 proves the request got past the validator.
      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /not configured by an administrator/);
    } finally {
      getSettings().main.spotifyClientId = priorClientId;
      getSettings().main.spotifyClientSecret = priorClientSecret;
    }
  });

  it('GET /playlist/spotify/callback reaches the handler', async () => {
    const agent = await loginAsAdmin();

    const res = await agent.get(
      '/api/v1/playlist/spotify/callback?state=unknown&code=unknown'
    );

    assert.strictEqual(res.status, 302);
    assert.match(res.headers.location, /\/discover\/music/);
  });

  it('POST /playlist/resolve reaches the handler', async () => {
    const agent = await loginAsAdmin();

    const res = await agent
      .post('/api/v1/playlist/resolve')
      .send({ url: 'not a playlist url' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /supported Spotify or YouTube playlist URL/);
  });
});
