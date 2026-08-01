import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import ListenBrainzAPI from '@server/api/listenbrainz';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import MetadataArtist from '@server/entity/MetadataArtist';
import type { User } from '@server/entity/User';
import {
  MAX_ASSOCIATION_PROVIDER_SIMILAR_ARTISTS,
  prepareAssociationSimilarArtists,
} from '@server/lib/associations';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import associationRoutes, { ASSOCIATION_RATE_LIMIT } from './association';
import authRoutes from './auth';

let app: Express;

describe('association provider bounds', () => {
  it('bounds authenticated association fan-out', () => {
    assert.deepStrictEqual(ASSOCIATION_RATE_LIMIT, {
      windowMs: 60_000,
      limit: 30,
    });
  });

  it('validates, deduplicates, and caps similar artist candidates', () => {
    const artists = prepareAssociationSimilarArtists([
      null,
      { artist_mbid: 123, name: 'Invalid', score: 1 },
      { artist_mbid: ' DUPLICATE ', name: 'First', score: 10, type: 'Group' },
      { artist_mbid: 'duplicate', name: 'Second', score: 9 },
      ...Array.from(
        { length: MAX_ASSOCIATION_PROVIDER_SIMILAR_ARTISTS + 100 },
        (_, index) => ({
          artist_mbid: `artist-${index}`,
          name: `Artist ${index}`,
          score: index,
          type: 'Person',
        })
      ),
    ]);

    assert.strictEqual(
      artists.length,
      MAX_ASSOCIATION_PROVIDER_SIMILAR_ARTISTS - 3
    );
    assert.deepStrictEqual(artists[0], {
      artist_mbid: 'duplicate',
      name: 'First',
      score: 10,
      type: 'Group',
      comment: '',
      gender: null,
      reference_mbid: '',
    });
    assert.ok(!artists.some((artist) => artist.artist_mbid === 'artist-500'));
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
  app.use('/association', associationRoutes);
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

const mockPrivateMethod = mock.method as (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => unknown;
const mockPrivate = (
  object: object,
  methodName: string,
  implementation: (...args: unknown[]) => unknown
) => mockPrivateMethod.call(mock, object, methodName, implementation);

async function login(email = 'admin@seerr.dev') {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

const movieResult = (id: number, title: string, vote: number) => ({
  id,
  media_type: 'movie',
  title,
  original_title: title,
  release_date: '2024-01-01',
  adult: false,
  video: false,
  popularity: 10,
  poster_path: `/${id}.jpg`,
  backdrop_path: `/${id}-bd.jpg`,
  vote_count: 100,
  vote_average: vote,
  genre_ids: [18],
  overview: '',
  original_language: 'en',
});

const movieDetail = {
  id: 123,
  title: 'Root Movie',
  genres: [{ id: 18, name: 'Drama' }],
  credits: {
    cast: [{ id: 9001, name: 'Lead Actor', order: 0, profile_path: '/a.jpg' }],
    crew: [
      {
        id: 7777,
        name: 'Famous Composer',
        job: 'Original Music Composer',
        department: 'Sound',
        profile_path: '/c.jpg',
      },
    ],
  },
};

const tvResult = (id: number, name: string, vote: number) => ({
  id,
  media_type: 'tv',
  name,
  original_name: name,
  first_air_date: '2024-01-01',
  origin_country: ['US'],
  original_language: 'en',
  popularity: 10,
  poster_path: `/${id}.jpg`,
  backdrop_path: `/${id}-bd.jpg`,
  vote_count: 100,
  vote_average: vote,
  genre_ids: [18],
  overview: '',
});

const tvDetail = {
  id: 321,
  name: 'Root Series',
  genres: [{ id: 18, name: 'Drama' }],
  aggregate_credits: {
    cast: [
      { id: 9002, name: 'Series Lead', order: 0, profile_path: '/tv-a.jpg' },
    ],
  },
  credits: {
    crew: [
      {
        id: 8888,
        name: 'Series Composer',
        job: 'Original Music Composer',
        department: 'Sound',
        profile_path: '/tv-c.jpg',
      },
    ],
  },
};

function mockTmdb() {
  mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
    if (endpoint === '/movie/123') {
      return movieDetail;
    }
    if (endpoint === '/movie/123/similar') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [movieResult(200, 'Similar Movie', 8)],
      };
    }
    if (endpoint === '/movie/123/recommendations') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [movieResult(300, 'Recommended Movie', 6)],
      };
    }
    throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
  });
}

function mockTmdbWithTv() {
  mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
    if (endpoint === '/tv/321') {
      return tvDetail;
    }
    if (endpoint === '/tv/321/similar') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [tvResult(400, 'Similar Series', 8)],
      };
    }
    if (endpoint === '/tv/321/recommendations') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [tvResult(500, 'Recommended Series', 6)],
      };
    }
    throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
  });
}

const artistDetails = (artistMbid: string, name: string, similarCount = 2) => ({
  artist: {
    area: 'US',
    artist_mbid: artistMbid,
    begin_year: 2000,
    mbid: artistMbid,
    name,
    rels: {},
    tag: { artist: [] },
    type: 'Person',
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
      type: index % 2 === 0 ? 'Person' : 'Group',
    })),
    topRecordingColor: { red: 0, green: 0, blue: 0 },
    topReleaseGroupColor: { red: 0, green: 0, blue: 0 },
  },
});

const albumDetails = {
  caa_id: 0,
  caa_release_mbid: '',
  listening_stats: { total_listen_count: 0, total_user_count: 0 },
  mediums: [],
  recordings_release_mbid: '',
  release_group_mbid: 'album-root',
  release_group_metadata: {
    artist: {
      artist_credit_id: 1,
      artists: [
        {
          area: 'US',
          artist_mbid: 'album-artist',
          begin_year: 2000,
          join_phrase: '',
          name: 'Album Artist',
          rels: {},
          type: 'Person',
        },
      ],
      name: 'Album Artist',
    },
    release: {
      caa_id: 0,
      caa_release_mbid: '',
      date: '2024-01-01',
      name: 'Root Album',
      rels: [],
      type: 'Album',
    },
    release_group: {
      caa_id: 0,
      caa_release_mbid: '',
      date: '2024-01-01',
      name: 'Root Album',
      rels: [],
      type: 'Album',
    },
    tag: { artist: [], release_group: [] },
  },
  type: 'Album',
};

function mockOpenLibraryBook() {
  mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
    if (endpoint === '/works/OLROOTW.json') {
      return {
        key: '/works/OLROOTW',
        title: 'Root Book',
        authors: [{ author: { key: '/authors/OLAUTHOR' } }],
      };
    }
    if (endpoint === '/authors/OLAUTHOR.json') {
      return {
        key: '/authors/OLAUTHOR',
        name: 'Book Author',
      };
    }
    if (endpoint === '/authors/OLAUTHOR/works.json') {
      return {
        size: 2,
        entries: [
          {
            key: '/works/OLROOTW',
            title: 'Root Book',
            first_publish_date: '2020',
          },
          {
            key: '/works/OLRELATEDW',
            title: 'Related Book',
            covers: [123],
            first_publish_date: '2024',
          },
        ],
      };
    }
    throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
  });
}

describe('GET /association/:mediaType/:id', () => {
  it('rejects an unknown media type', async () => {
    const agent = await login();
    const res = await agent.get('/association/podcast/abc');
    assert.strictEqual(res.status, 400);
  });

  it('rejects non-numeric movie and tv ids', async () => {
    const agent = await login();
    const movieRes = await agent.get('/association/movie/not-a-number');
    const tvRes = await agent.get('/association/tv/not-a-number');

    assert.strictEqual(movieRes.status, 400);
    assert.strictEqual(tvRes.status, 400);
  });

  it('rejects non-positive and decimal movie and tv ids', async () => {
    const agent = await login();
    const negativeRes = await agent.get('/association/movie/-1');
    const decimalRes = await agent.get('/association/tv/1.5');

    assert.strictEqual(negativeRes.status, 400);
    assert.strictEqual(decimalRes.status, 400);
  });

  it('rejects oversized external association ids', async () => {
    const agent = await login();
    const res = await agent.get(`/association/book/${'x'.repeat(129)}`);

    assert.strictEqual(res.status, 400);
  });

  it('rejects malformed external association ids before provider lookup', async () => {
    const externalGet = mockPrivate(ExternalAPI.prototype, 'get', async () => {
      throw new Error('Provider should not be called for malformed IDs');
    });
    const externalPost = mockPrivate(
      ExternalAPI.prototype,
      'post',
      async () => {
        throw new Error('Provider should not be called for malformed IDs');
      }
    );
    const agent = await login();

    const artistRes = await agent.get('/association/artist/invalid!id');
    const albumRes = await agent.get('/association/album/invalid%3Fid');
    const bookRes = await agent.get('/association/book/invalid%23id');

    assert.strictEqual(artistRes.status, 400);
    assert.strictEqual(albumRes.status, 400);
    assert.strictEqual(bookRes.status, 400);
    assert.strictEqual(
      (externalGet as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
    assert.strictEqual(
      (externalPost as { mock: { callCount: () => number } }).mock.callCount(),
      0
    );
  });

  it('rejects malformed includeWeak query values', async () => {
    const agent = await login();
    const res = await agent.get('/association/movie/123?includeWeak=yes');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Include weak associations must be valid/);
  });

  it('returns same-medium similar and recommended edges for a movie', async () => {
    mockTmdb();
    const agent = await login();
    const res = await agent.get('/association/movie/123');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.root.title, 'Root Movie');

    const byType = res.body.edges.reduce(
      (acc: Record<string, number>, e: { type: string }) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
      },
      {}
    );
    assert.ok(byType.similar >= 1, 'expected at least one similar edge');
    assert.ok(
      byType.recommended >= 1,
      'expected at least one recommended edge'
    );
    // Higher-voted similar title should outrank the recommended one.
    assert.strictEqual(res.body.edges[0].node.id, 200);
  });

  it('emits a cross-medium shared-person edge for a mapped composer', async () => {
    await getRepository(MetadataArtist).save(
      new MetadataArtist({
        mbArtistId: 'mb-composer-1',
        tmdbPersonId: '7777',
        tmdbThumb: 'https://img/composer.jpg',
        tmdbUpdatedAt: new Date(),
      })
    );

    mockTmdb();
    const agent = await login();
    const res = await agent.get('/association/movie/123');

    assert.strictEqual(res.status, 200);
    const crossEdge = res.body.edges.find(
      (e: { type: string; node: { id: string } }) =>
        e.type === 'shared-person' && e.node.id === 'mb-composer-1'
    );
    assert.ok(crossEdge, 'expected a shared-person edge to the composer');
    assert.strictEqual(crossEdge.node.mediaType, 'artist');
    assert.match(crossEdge.reason, /scored this/);
  });

  it('returns same-medium and composer edges for a tv series', async () => {
    await getRepository(MetadataArtist).save(
      new MetadataArtist({
        mbArtistId: 'mb-series-composer',
        tmdbPersonId: '8888',
        tmdbUpdatedAt: new Date(),
      })
    );

    mockTmdbWithTv();
    const agent = await login();
    const res = await agent.get('/association/tv/321?includeWeak=true');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.root.title, 'Root Series');
    assert.ok(
      res.body.edges.some(
        (e: { type: string; node: { mediaType: string; id: number } }) =>
          e.type === 'similar' && e.node.mediaType === 'tv' && e.node.id === 400
      )
    );
    assert.ok(
      res.body.edges.some(
        (e: { type: string; node: { mediaType: string; id: string } }) =>
          e.type === 'shared-person' &&
          e.node.mediaType === 'artist' &&
          e.node.id === 'mb-series-composer'
      )
    );
  });

  it('returns similar artist edges for an artist and respects weak filtering', async () => {
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async (mbid: string) =>
      artistDetails(mbid, 'Root Artist', 12)
    );
    mock.method(TmdbPersonMapper.prototype, 'getMapping', async () => ({
      personId: null,
      profilePath: null,
    }));

    const agent = await login();
    const defaultRes = await agent.get('/association/artist/root-artist');
    const weakRes = await agent.get(
      '/association/artist/root-artist?includeWeak=true'
    );

    assert.strictEqual(defaultRes.status, 200);
    assert.strictEqual(defaultRes.body.root.title, 'Root Artist');
    assert.strictEqual(
      defaultRes.body.edges.some(
        (e: { type: string }) => e.type === 'shared-genre'
      ),
      false
    );
    assert.ok(
      weakRes.body.edges.some(
        (e: { type: string }) => e.type === 'shared-genre'
      )
    );
  });

  it('builds album associations from the root album artist', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => albumDetails
    );
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async (mbid: string) =>
      artistDetails(mbid, 'Album Artist', 2)
    );
    mock.method(TmdbPersonMapper.prototype, 'getMapping', async () => ({
      personId: null,
      profilePath: null,
    }));

    const agent = await login();
    const res = await agent.get('/association/album/album-root');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.root.title, 'Root Album');
    assert.ok(
      res.body.edges.some(
        (e: { type: string; node: { mediaType: string; name: string } }) =>
          e.type === 'similar' &&
          e.node.mediaType === 'artist' &&
          e.node.name === 'Similar Artist 1'
      )
    );
  });

  it('uses crew-specific reasons for music-to-screen associations', async () => {
    mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () => albumDetails
    );
    mock.method(ListenBrainzAPI.prototype, 'getArtist', async (mbid: string) =>
      artistDetails(mbid, 'Album Artist', 0)
    );
    mock.method(TmdbPersonMapper.prototype, 'getMapping', async () => ({
      personId: 4444,
      profilePath: null,
    }));
    mockPrivate(ExternalAPI.prototype, 'get', async (endpoint: unknown) => {
      if (endpoint === '/person/4444/combined_credits') {
        return {
          cast: [],
          crew: [
            {
              id: 900,
              media_type: 'movie',
              adult: false,
              genre_ids: [],
              original_language: 'en',
              original_title: 'Scored Movie',
              overview: '',
              popularity: 10,
              release_date: '2024-01-01',
              title: 'Scored Movie',
              video: false,
              vote_average: 7,
              vote_count: 20,
              backdrop_path: null,
              poster_path: '/scored.jpg',
              department: 'Sound',
              job: 'Original Music Composer',
            },
          ],
        };
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const agent = await login();
    const res = await agent.get('/association/album/album-root');

    assert.strictEqual(res.status, 200);
    assert.ok(
      res.body.edges.some(
        (e: { reason: string; node: { title?: string } }) =>
          e.node.title === 'Scored Movie' &&
          e.reason === 'Album Artist scored this'
      )
    );
  });

  it('returns same-author book associations', async () => {
    mockOpenLibraryBook();

    const relatedMedia = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.BOOK,
        serviceUrl: 'http://readarr.internal/book/2',
        externalServiceSlug: 'related-book',
        ratingKey: 'plex-related-book',
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media: relatedMedia,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OLRELATEDW',
        canonical: true,
      })
    );

    const agent = await login('friend@seerr.dev');
    const res = await agent.get('/association/book/OLROOTW');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.root.title, 'Root Book');
    assert.deepStrictEqual(
      res.body.edges.map(
        (edge: { type: string; reason: string; node: { id: string } }) => ({
          type: edge.type,
          reason: edge.reason,
          id: edge.node.id,
        })
      ),
      [
        {
          type: 'shared-person',
          reason: 'Also by Book Author',
          id: 'OLRELATEDW',
        },
      ]
    );
    assert.strictEqual(res.body.edges[0].node.mediaInfo.serviceUrl, undefined);
    assert.strictEqual(
      res.body.edges[0].node.mediaInfo.externalServiceSlug,
      undefined
    );
    assert.strictEqual(res.body.edges[0].node.mediaInfo.ratingKey, undefined);
  });

  it('applies the requested association limit independently', async () => {
    mockTmdb();
    const agent = await login();
    const limitedRes = await agent.get('/association/movie/123?limit=1');
    const fullRes = await agent.get('/association/movie/123');

    assert.strictEqual(limitedRes.status, 200);
    assert.strictEqual(fullRes.status, 200);
    assert.strictEqual(limitedRes.body.edges.length, 1);
    assert.ok(
      fullRes.body.edges.length > limitedRes.body.edges.length,
      'expected full response to include more results'
    );
  });

  it('hydrates association state separately for each user', async () => {
    mockTmdb();
    mock.method(Media, 'getRelatedMedia', async (user: User | undefined) => [
      {
        id: user?.id ?? 0,
        tmdbId: 200,
        mediaType: 'movie',
        status: user?.id ?? 0,
      } as Media,
    ]);

    const adminAgent = await login('admin@seerr.dev');
    const friendAgent = await login('friend@seerr.dev');
    const adminRes = await adminAgent.get('/association/movie/123');
    const friendRes = await friendAgent.get('/association/movie/123');

    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(friendRes.status, 200);
    assert.notStrictEqual(
      adminRes.body.edges[0].node.mediaInfo.id,
      friendRes.body.edges[0].node.mediaInfo.id
    );
  });

  it('rehydrates mutable media state on consecutive requests', async () => {
    mockTmdb();
    let mediaId = 1;
    mock.method(Media, 'getRelatedMedia', async () => [
      {
        id: mediaId,
        tmdbId: 200,
        mediaType: 'movie',
        status: 2,
      } as Media,
    ]);

    const agent = await login();
    const first = await agent.get('/association/movie/123');
    mediaId = 2;
    const second = await agent.get('/association/movie/123');

    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(first.body.edges[0].node.mediaInfo.id, 1);
    assert.strictEqual(second.body.edges[0].node.mediaInfo.id, 2);
  });
});
