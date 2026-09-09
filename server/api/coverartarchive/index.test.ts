import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import CoverArtArchive from '@server/api/coverartarchive';
import { getRepository } from '@server/datasource';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import { MAX_MUSICBRAINZ_BATCH_IDS } from '@server/lib/externalIds';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';
import axios from 'axios';

type CoverArtArchiveInternal = {
  fetchReleaseGroupMetadata: (albumId: string) => Promise<unknown>;
};

const redirectError = (status: number, location: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers: { location } },
  });

const mockFetchReleaseGroupMetadata = (
  implementation: (albumId: string) => Promise<unknown>
) =>
  (
    mock.method as (
      object: object,
      methodName: string,
      implementation: (albumId: string) => Promise<unknown>
    ) => { mock: { callCount: () => number } }
  )(CoverArtArchive.prototype, 'fetchReleaseGroupMetadata', implementation);

describe('CoverArtArchive metadata persistence', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('does not return fetched artwork before its cache row is persisted', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    const releaseId = '55f7c1d9-b4f4-4c8d-a578-7d98687c4e45';
    mockFetchReleaseGroupMetadata(async () => ({
      images: [
        {
          approved: true,
          front: true,
          id: 123,
          thumbnails: {},
        },
      ],
      release: `/release/${releaseId}`,
    }));

    const repository = getRepository(MetadataAlbum);
    const originalUpsert = repository.upsert.bind(repository);
    let releasePersistence: (() => void) | undefined;
    let persistenceStarted: (() => void) | undefined;
    const heldPersistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    mock.method(
      repository,
      'upsert',
      async (
        entityOrEntities: Parameters<typeof repository.upsert>[0],
        conflictPathsOrOptions: Parameters<typeof repository.upsert>[1]
      ) => {
        persistenceStarted?.();
        await heldPersistence;
        return originalUpsert(entityOrEntities, conflictPathsOrOptions);
      }
    );

    let settled = false;
    const resultPromise = new CoverArtArchive()
      .getCoverArt(albumId)
      .then((result) => {
        settled = true;
        return result;
      });
    await started;

    assert.strictEqual(settled, false);
    releasePersistence?.();
    const result = await resultPromise;

    const expectedUrl = `https://archive.org/download/mbid-${releaseId}/mbid-${releaseId}-123_thumb250.jpg`;
    assert.strictEqual(result.images[0]?.thumbnails[250], expectedUrl);
    assert.strictEqual(
      (await repository.findOneByOrFail({ mbAlbumId: albumId })).caaUrl,
      expectedUrl
    );
  });

  it('encodes untrusted upstream image identifiers in generated URLs', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    mockFetchReleaseGroupMetadata(async () => ({
      images: [
        {
          approved: true,
          front: true,
          id: '../unsafe?value',
          thumbnails: {},
        },
      ],
      release: '/release/../unsafe release',
    }));

    const result = await new CoverArtArchive().getCoverArt(albumId);
    const url = result.images[0]?.thumbnails[250];

    assert.ok(url);
    assert.strictEqual(new URL(url).origin, 'https://archive.org');
    assert.match(url, /unsafe%20release/);
    assert.match(url, /\.\.%2Funsafe%3Fvalue/);
  });

  it('rejects path-control MusicBrainz IDs before dispatch', async () => {
    const get = mockFetchReleaseGroupMetadata(async () => ({}));

    const result = await new CoverArtArchive().getCoverArt('../release/unsafe');

    assert.deepStrictEqual(result.images, []);
    assert.strictEqual(get.mock.callCount(), 0);
  });

  it('bounds and structurally validates upstream image collections', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    mockFetchReleaseGroupMetadata(async () => ({
      images: [
        null,
        { front: true, id: {} },
        ...Array.from({ length: 150 }, (_, index) => ({
          approved: 'yes',
          front: index === 0,
          id: index,
          ignored: 'provider-only',
        })),
      ],
      release: null,
      ignored: 'provider-only',
    }));

    const result = await new CoverArtArchive().getCoverArt(albumId);

    assert.strictEqual(result.release, `/release/${albumId}`);
    assert.strictEqual(result.images.length, 98);
    assert.deepStrictEqual(Object.keys(result.images[0] ?? {}).sort(), [
      'approved',
      'front',
      'id',
      'thumbnails',
    ]);
    assert.strictEqual(result.images[0]?.approved, false);
  });

  it('caches a negative result only for a confirmed 404', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    mockFetchReleaseGroupMetadata(async () => {
      throw Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        response: { status: 404 },
      });
    });

    const result = await new CoverArtArchive().getCoverArt(albumId);

    assert.deepStrictEqual(result.images, []);
    const metadata = await getRepository(MetadataAlbum).findOneBy({
      mbAlbumId: albumId,
    });
    assert.ok(metadata);
    assert.strictEqual(metadata?.caaUrl, null);
  });

  it('does not persist a negative cache result for a transient failure', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    mockFetchReleaseGroupMetadata(async () => {
      throw Object.assign(new Error('timeout of 10000ms exceeded'), {
        isAxiosError: true,
        code: 'ECONNABORTED',
      });
    });

    const result = await new CoverArtArchive().getCoverArt(albumId);

    assert.deepStrictEqual(result.images, []);
    const metadata = await getRepository(MetadataAlbum).findOneBy({
      mbAlbumId: albumId,
    });
    assert.strictEqual(metadata, null);
  });

  it('caps batch IDs and bounds concurrent cache-miss fetches', async () => {
    const archive = new CoverArtArchive();
    let active = 0;
    let peak = 0;
    let calls = 0;
    Object.defineProperty(archive, 'fetchCoverArt', {
      configurable: true,
      value: async (id: string) => {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return {
          images: [
            {
              approved: true,
              front: true,
              id,
              thumbnails: { 250: `https://images.example/${id}` },
            },
          ],
          release: `/release/${id}`,
        };
      },
    });
    const ids = Array.from(
      { length: MAX_MUSICBRAINZ_BATCH_IDS + 25 },
      (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
    );

    const result = await archive.batchGetCoverArt(ids);

    assert.strictEqual(calls, MAX_MUSICBRAINZ_BATCH_IDS);
    assert.ok(peak <= CoverArtArchive.BATCH_FETCH_CONCURRENCY);
    assert.strictEqual(Object.keys(result).length, MAX_MUSICBRAINZ_BATCH_IDS);
  });
});

describe('CoverArtArchive redirect chain resolution', () => {
  beforeEach(() => {
    mock.method(dns, 'lookup', async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
  });

  afterEach(() => mock.restoreAll());

  it('follows Cover Art Archive through archive.org to its CDN subdomain', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    const cdnUrl = 'https://dn710405.ca.archive.org/0/items/mbid-x/index.json';
    const calls: string[] = [];
    mock.method(axios, 'get', async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        throw redirectError(
          307,
          'https://archive.org/download/mbid-x/index.json'
        );
      }
      if (calls.length === 2) {
        throw redirectError(302, cdnUrl);
      }
      return { data: { images: [], release: `/release/${albumId}` } };
    });

    const archive = new CoverArtArchive() as unknown as CoverArtArchiveInternal;
    const result = await archive.fetchReleaseGroupMetadata(albumId);

    assert.deepStrictEqual(result, {
      images: [],
      release: `/release/${albumId}`,
    });
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2], cdnUrl);
  });

  it('refuses to follow a redirect outside Cover Art Archive/Internet Archive', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    mock.method(axios, 'get', async () => {
      throw redirectError(302, 'https://evil.example/steal-me.json');
    });

    const archive = new CoverArtArchive() as unknown as CoverArtArchiveInternal;

    await assert.rejects(
      archive.fetchReleaseGroupMetadata(albumId),
      /status code 302/
    );
  });

  it('gives up after too many redirects', async () => {
    const albumId = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
    let hop = 0;
    mock.method(axios, 'get', async () => {
      hop += 1;
      throw redirectError(
        302,
        `https://archive.org/download/mbid-x/hop-${hop}.json`
      );
    });

    const archive = new CoverArtArchive() as unknown as CoverArtArchiveInternal;

    await assert.rejects(
      archive.fetchReleaseGroupMetadata(albumId),
      /Too many redirects/
    );
  });
});
