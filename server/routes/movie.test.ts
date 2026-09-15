import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import RadarrAPI from '@server/api/servarr/radarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getSettings, type RadarrSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import movieRoutes from './movie';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/movie', movieRoutes);
  return app;
}

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
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

describe('GET /movie/:id', () => {
  it('retains the TMDB poster for an available movie linked to Radarr', async () => {
    mockPrivate(ExternalAPI.prototype, 'get', async () => ({
      id: 100,
      adult: false,
      budget: 0,
      genres: [],
      videos: { results: [] },
      original_language: 'en',
      original_title: 'Test Movie',
      popularity: 0,
      production_companies: [],
      production_countries: [],
      release_date: '2026-01-01',
      release_dates: { results: [] },
      revenue: 0,
      spoken_languages: [],
      status: 'Released',
      title: 'Test Movie',
      video: false,
      vote_average: 0,
      vote_count: 0,
      backdrop_path: '/provider-backdrop.jpg',
      homepage: '',
      imdb_id: 'tt0000100',
      overview: 'A test movie.',
      poster_path: '/provider-poster.jpg',
      runtime: 90,
      tagline: '',
      credits: { cast: [], crew: [] },
      belongs_to_collection: null,
      external_ids: {},
      keywords: { keywords: [] },
      'watch/providers': { results: {} },
    }));
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 100,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
        serviceId: 9,
        externalServiceId: 44,
        externalServiceSlug: 'test-movie',
      })
    );

    const res = await request(app).get('/movie/100');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mediaInfo.id, media.id);
    assert.strictEqual(res.body.posterPath, '/provider-poster.jpg');
  });
});

describe('GET /movie/:id/cover', () => {
  it('serves linked Radarr covers through the configured service', async () => {
    const settings = getSettings();
    const priorRadarr = settings.radarr;
    settings.radarr = [
      {
        id: 9,
        name: 'Radarr',
        hostname: 'radarr.test',
        port: 7878,
        apiKey: 'radarr-key',
        useSsl: false,
        baseUrl: '',
        activeProfileId: 1,
        activeProfileName: 'Any',
        activeDirectory: '/movies',
        tags: [],
        is4k: false,
        isDefault: true,
        externalUrl: '',
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        minimumAvailability: 'released',
      },
    ];
    const getMovieCoverMock = mock.method(
      RadarrAPI.prototype,
      'getMovieCover',
      async () => ({
        imageBuffer: Buffer.from('movie-cover'),
        contentType: 'image/jpeg',
      })
    );
    const originalBuildUrl = RadarrAPI.buildUrl;
    const buildUrlMock = mock.method(
      RadarrAPI,
      'buildUrl',
      (server: RadarrSettings, path?: string) => originalBuildUrl(server, path)
    );

    try {
      const media = await getRepository(Media).save(
        new Media({
          tmdbId: 100,
          mediaType: MediaType.MOVIE,
          serviceId: 9,
          externalServiceId: 44,
          externalServiceSlug: 'test-movie',
        })
      );

      const res = await request(app).get(
        `/movie/100/cover?mediaId=${media.id}&is4k=false`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'image/jpeg');
      assert.deepStrictEqual(res.body, Buffer.from('movie-cover'));
      assert.strictEqual(getMovieCoverMock.mock.calls[0].arguments[0], 44);
      assert(
        buildUrlMock.mock.calls.some((call) => call.arguments[1] === '/api/v3')
      );
    } finally {
      settings.radarr = priorRadarr;
    }
  });

  it('serves a live Radarr discovery cover without persisted service links', async () => {
    const settings = getSettings();
    const priorRadarr = settings.radarr;
    settings.radarr = [
      {
        id: 9,
        name: 'Radarr-4K',
        hostname: 'radarr.test',
        port: 7879,
        apiKey: 'radarr-key',
        useSsl: false,
        baseUrl: '',
        activeProfileId: 1,
        activeProfileName: 'Ultra-HD 4K',
        activeDirectory: '/movies/4k',
        tags: [],
        is4k: true,
        isDefault: true,
        externalUrl: '',
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        minimumAvailability: 'released',
      },
    ];
    const getMovieCoverMock = mock.method(
      RadarrAPI.prototype,
      'getMovieCover',
      async () => ({
        imageBuffer: Buffer.from('live-movie-cover'),
        contentType: 'image/jpeg',
      })
    );

    try {
      const res = await request(app).get(
        '/movie/710002/cover?serviceId=9&externalServiceId=82&is4k=true'
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'image/jpeg');
      assert.deepStrictEqual(res.body, Buffer.from('live-movie-cover'));
      assert.strictEqual(getMovieCoverMock.mock.calls[0].arguments[0], 82);
    } finally {
      settings.radarr = priorRadarr;
    }
  });
});
