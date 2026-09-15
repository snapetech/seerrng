import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import ListenBrainzAPI from '@server/api/listenbrainz';

describe('ListenBrainzAPI response normalization', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('rejects path-control MusicBrainz IDs before dispatch', async () => {
    const post = (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => { mock: { callCount: () => number } }
    )(ExternalAPI.prototype, 'post', async () => ({}));
    const api = new ListenBrainzAPI();

    await assert.rejects(() => api.getAlbum('../explore'));
    await assert.rejects(() => api.getArtist('artist?redirect=/account'));
    assert.strictEqual(post.mock.callCount(), 0);
  });

  it('caps requested and returned top albums and drops malformed records', async () => {
    let params: Record<string, string> | undefined;
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: (
          path: string,
          options?: { params?: Record<string, string> }
        ) => Promise<unknown>
      ) => unknown
    )(
      ExternalAPI.prototype,
      'get',
      async (_path: string, options?: { params?: Record<string, string> }) => {
        params = options?.params;
        return {
          payload: {
            count: Number.MAX_SAFE_INTEGER,
            release_groups: [
              null,
              { release_group_mbid: 'missing-name' },
              ...Array.from({ length: 150 }, (_, index) => ({
                artist_mbids: Array.from({ length: 50 }, () => 'artist'),
                artist_name: `Artist ${index}`,
                caa_id: index,
                caa_release_mbid: 'release',
                listen_count: 10,
                release_group_mbid: `group-${index}`,
                release_group_name: `Album ${index}`,
                ignored: 'provider-only',
              })),
            ],
          },
          ignored: 'provider-only',
        };
      }
    );

    const result = await new ListenBrainzAPI().getTopAlbums({ count: 500 });

    assert.strictEqual(params?.count, '100');
    assert.strictEqual(result.payload.count, 10_000_000);
    assert.strictEqual(result.payload.release_groups.length, 98);
    assert.strictEqual(
      result.payload.release_groups[0]?.artist_mbids.length,
      20
    );
    assert.deepStrictEqual(
      Object.keys(result.payload.release_groups[0] ?? {}).sort(),
      [
        'artist_mbids',
        'artist_name',
        'caa_id',
        'caa_release_mbid',
        'listen_count',
        'release_group_mbid',
        'release_group_name',
      ]
    );
  });

  it('normalizes top artists and malformed envelopes safely', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      payload: {
        artists: [
          null,
          { artist_mbid: 'id', artist_name: 'Name', listen_count: Infinity },
          { artist_mbid: '', artist_name: 'Missing ID' },
        ],
      },
    }));

    const result = await new ListenBrainzAPI().getTopArtists({});
    assert.deepStrictEqual(result.payload.artists, [
      { artist_mbid: 'id', artist_name: 'Name', listen_count: 0 },
    ]);

    mock.restoreAll();
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => null);
    assert.deepStrictEqual(
      (await new ListenBrainzAPI().getTopArtists({})).payload.artists,
      []
    );
  });

  it('bounds fresh releases and nested provider arrays', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      payload: {
        releases: Array.from({ length: 150 }, (_, index) => ({
          artist_credit_name: 'Artist',
          artist_mbids: Array.from({ length: 30 }, () => 'artist'),
          release_group_mbid: `group-${index}`,
          release_name: `Album ${index}`,
          release_tags: Array.from({ length: 80 }, () => 'tag'),
        })),
      },
    }));

    const result = await new ListenBrainzAPI().getFreshReleases({ count: 500 });

    assert.strictEqual(result.payload.releases.length, 100);
    assert.strictEqual(result.payload.releases[0]?.artist_mbids.length, 20);
    assert.strictEqual(result.payload.releases[0]?.release_tags.length, 50);
  });

  it('pages fresh releases locally in the requested order', async () => {
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      payload: {
        releases: Array.from({ length: 5 }, (_, index) => ({
          artist_credit_name: 'Artist',
          artist_mbids: ['artist'],
          release_date: `2026-09-0${index + 1}`,
          release_group_mbid: `group-${index}`,
          release_name: `Album ${index}`,
          release_tags: [],
        })),
      },
    }));

    const api = new ListenBrainzAPI();
    const ascending = await api.getFreshReleases({
      count: 2,
      offset: 1,
      order: 'asc',
    });
    const descending = await api.getFreshReleases({
      count: 2,
      offset: 1,
      order: 'desc',
    });

    assert.deepStrictEqual(
      ascending.payload.releases.map((release) => release.release_name),
      ['Album 1', 'Album 2']
    );
    assert.deepStrictEqual(
      descending.payload.releases.map((release) => release.release_name),
      ['Album 3', 'Album 2']
    );
  });
});
