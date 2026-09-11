import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import PlexAPI, { type PlexLibraryItem } from '@server/api/plexapi';
import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  PLEX_SCAN_ITEM_CONCURRENCY,
  PLEX_SCAN_PAGE_SIZE,
  PlexScanner,
  dedupePlexRecentlyAddedItems,
  getBoundedPlexScanTotal,
  getPlexGuidCacheKey,
  preparePlexLibraryPageItems,
} from '.';

setupTestDb();

afterEach(() => {
  mock.restoreAll();
});

describe('Plex library page bounds', () => {
  it('caps oversized upstream pages before item processing', () => {
    const items = Array.from({ length: PLEX_SCAN_PAGE_SIZE + 10 }, (_, id) => ({
      ratingKey: String(id + 1),
    }));

    assert.strictEqual(
      preparePlexLibraryPageItems(items).length,
      PLEX_SCAN_PAGE_SIZE
    );
    assert.deepStrictEqual(preparePlexLibraryPageItems(null), []);
    assert.strictEqual(PLEX_SCAN_ITEM_CONCURRENCY, 10);
  });

  it('caps provider-declared scan totals and advances malformed totals safely', () => {
    assert.strictEqual(
      getBoundedPlexScanTotal(Number.MAX_SAFE_INTEGER, 0, 50),
      100_000
    );
    assert.strictEqual(getBoundedPlexScanTotal(0, 50, 50), 150);
    assert.strictEqual(getBoundedPlexScanTotal(75, 50, 25), 75);
  });

  it('keeps separate recent albums by the same artist', () => {
    const items = [
      {
        ratingKey: 'album-1',
        parentRatingKey: 'artist-1',
      },
      {
        ratingKey: 'album-2',
        parentRatingKey: 'artist-1',
      },
    ] as PlexLibraryItem[];

    assert.deepStrictEqual(
      dedupePlexRecentlyAddedItems(items, 'music').map(
        (item) => item.ratingKey
      ),
      ['album-1', 'album-2']
    );
  });
});

describe('getPlexGuidCacheKey', () => {
  it('isolates server-local rating keys by Plex machine identity', () => {
    const first = getPlexGuidCacheKey(
      {
        machineId: 'machine-one',
        ip: 'plex.local',
        port: 32400,
        useSsl: false,
      },
      '123'
    );
    const second = getPlexGuidCacheKey(
      {
        machineId: 'machine-two',
        ip: 'plex.local',
        port: 32400,
        useSsl: false,
      },
      '123'
    );

    assert.notStrictEqual(first, second);
    assert.match(first, /^plexguid:[a-f0-9]{64}$/);
    assert.strictEqual(first.includes('machine-one'), false);
  });

  it('uses the configured endpoint when a legacy server has no machine id', () => {
    const plain = getPlexGuidCacheKey(
      { ip: 'plex.local', port: 32400, useSsl: false },
      '123'
    );
    const tls = getPlexGuidCacheKey(
      { ip: 'plex.local', port: 32400, useSsl: true },
      '123'
    );
    const otherRatingKey = getPlexGuidCacheKey(
      { ip: 'plex.local', port: 32400, useSsl: false },
      '124'
    );

    assert.notStrictEqual(plain, tls);
    assert.notStrictEqual(plain, otherRatingKey);
  });
});

describe('Plex scanner configuration authority', () => {
  it('does not persist catalog results after the Plex endpoint changes', async () => {
    const settings = getSettings();
    settings.main = {
      ...settings.main,
      mediaServerType: MediaServerType.PLEX,
    };
    settings.radarr = [];
    settings.sonarr = [];
    settings.plex = {
      ...settings.plex,
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [
        { id: 'movies', name: 'Movies', enabled: true, type: 'movie' },
      ],
    };
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(PlexAPI.prototype, 'getLibraryContents', async () => {
      settings.plex = { ...settings.plex, ip: 'rotated-plex.local' };
      const item = {
        ratingKey: '991',
        title: 'Stale Plex Movie',
        guid: 'tmdb://991',
        addedAt: 1,
        updatedAt: 1,
        type: 'movie',
        Media: [{ videoResolution: '1080' }],
      } as PlexLibraryItem;
      return { items: [item], totalSize: 1 };
    });

    await new PlexScanner().run();

    assert.strictEqual(
      await getRepository(Media).findOne({ where: { tmdbId: 991 } }),
      null
    );
  });

  it('does not persist catalog results after the owner token changes', async () => {
    const settings = getSettings();
    settings.main = {
      ...settings.main,
      mediaServerType: MediaServerType.PLEX,
    };
    settings.radarr = [];
    settings.sonarr = [];
    settings.plex = {
      ...settings.plex,
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [
        { id: 'movies', name: 'Movies', enabled: true, type: 'movie' },
      ],
    };
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(PlexAPI.prototype, 'getLibraryContents', async () => {
      await runUserSecurityMutation(1, () =>
        getRepository(User)
          .update(1, { plexToken: 'rotated-during-scan' })
          .then(() => undefined)
      );
      return {
        items: [
          {
            ratingKey: '993',
            title: 'Stale Owner Movie',
            guid: 'tmdb://993',
            addedAt: 1,
            updatedAt: 1,
            type: 'movie',
            Media: [{ videoResolution: '1080' }],
          } as PlexLibraryItem,
        ],
        totalSize: 1,
      };
    });

    await new PlexScanner().run();

    assert.strictEqual(
      await getRepository(Media).findOne({ where: { tmdbId: 993 } }),
      null
    );
  });
});

// Fixture shapes below are taken from a real Plex server's responses for an
// 'artist'-type library (Plex has no separate wire-level type for music vs.
// audiobook libraries -- both report as 'artist', and the resolved
// MusicBrainz/ISBN id, when present, is on the singular `guid` field rather
// than the `Guid[]` array movie/show agents use).
describe('Plex music and audiobook library scanning', () => {
  it('resolves a music album via the MusicBrainz id on its guid field', async () => {
    const settings = getSettings();
    settings.main = { ...settings.main, mediaServerType: MediaServerType.PLEX };
    settings.radarr = [];
    settings.sonarr = [];
    settings.plex = {
      ...settings.plex,
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [{ id: 'music', name: 'Music', enabled: true, type: 'music' }],
    };
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(PlexAPI.prototype, 'getLibraryContents', async () => ({
      totalSize: 1,
      items: [
        {
          ratingKey: '60487',
          title: 'The Count of Monte Cristo',
          parentTitle: 'Alexandre Dumas',
          guid: 'mbid://cf988074-7ee4-4eb3-8a39-42b1467b2de7',
          addedAt: 1789059800,
          updatedAt: 1789059802,
          type: 'album',
          Media: [],
        } as PlexLibraryItem,
      ],
    }));
    mock.method(
      MusicBrainz.prototype,
      'getReleaseGroupDetails',
      async () => ({}) as never
    );

    await new PlexScanner().run();

    const media = await getRepository(Media).findOne({
      where: {
        mbId: 'cf988074-7ee4-4eb3-8a39-42b1467b2de7',
        mediaType: MediaType.MUSIC,
      },
    });

    assert.ok(media);
    assert.strictEqual(media?.ratingKey, '60487');
    assert.strictEqual(media?.status, MediaStatus.AVAILABLE);
  });

  it('resolves an audiobook via an Open Library title/author search when Plex has no matched id', async () => {
    const settings = getSettings();
    settings.main = { ...settings.main, mediaServerType: MediaServerType.PLEX };
    settings.radarr = [];
    settings.sonarr = [];
    settings.plex = {
      ...settings.plex,
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [
        { id: 'audiobooks', name: 'Audiobooks', enabled: true, type: 'book' },
      ],
    };
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(PlexAPI.prototype, 'getLibraryContents', async () => ({
      totalSize: 1,
      items: [
        {
          ratingKey: '59713',
          title: 'Charon - The Court of the Underworld',
          parentTitle: 'Ada Sinclair',
          // Plex's local (unmatched) agent -- no external id, the common
          // case for self-published/indie audiobooks on a real server.
          guid: 'local://59713',
          addedAt: 1789059680,
          updatedAt: 1789059680,
          type: 'album',
          Media: [],
        } as PlexLibraryItem,
      ],
    }));
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL123W',
          title: 'Charon - The Court of the Underworld',
          isbn: ['9781234567890'],
        },
      ],
    }));

    await new PlexScanner().run();

    const identifier = await getRepository(MediaIdentifier).findOne({
      where: { provider: MediaIdentifierProvider.OPENLIBRARY, value: 'OL123W' },
      relations: { media: true },
    });

    assert.ok(identifier);
    assert.strictEqual(identifier?.media.mediaType, MediaType.BOOK);
    assert.strictEqual(identifier?.media.ratingKey, '59713');
    assert.strictEqual(identifier?.media.status, MediaStatus.AVAILABLE);
  });

  it('falls back to Open Library when Plex exposes an invalid ISBN guid', async () => {
    const settings = getSettings();
    settings.main = { ...settings.main, mediaServerType: MediaServerType.PLEX };
    settings.radarr = [];
    settings.sonarr = [];
    settings.plex = {
      ...settings.plex,
      ip: 'plex.local',
      port: 32400,
      useSsl: false,
      libraries: [
        { id: 'audiobooks', name: 'Audiobooks', enabled: true, type: 'book' },
      ],
    };
    mock.method(PlexAPI.prototype, 'getLibraries', async () => []);
    mock.method(PlexAPI.prototype, 'getLibraryContents', async () => ({
      totalSize: 1,
      items: [
        {
          ratingKey: '59714',
          title: 'Example Book',
          parentTitle: 'Example Author',
          guid: 'isbn://9781234567890',
          addedAt: 1789059680,
          updatedAt: 1789059680,
          type: 'album',
          Media: [],
        } as PlexLibraryItem,
      ],
    }));
    mock.method(OpenLibraryAPI.prototype, 'searchBooks', async () => ({
      numFound: 1,
      start: 0,
      docs: [
        {
          key: '/works/OL456W',
          title: 'Example Book',
          isbn: ['9780306406157'],
        },
      ],
    }));

    await new PlexScanner().run();

    const identifier = await getRepository(MediaIdentifier).findOne({
      where: { provider: MediaIdentifierProvider.OPENLIBRARY, value: 'OL456W' },
      relations: { media: true },
    });

    assert.ok(identifier);
    assert.strictEqual(identifier?.media.ratingKey, '59714');
    assert.strictEqual(
      await getRepository(MediaIdentifier).findOne({
        where: {
          provider: MediaIdentifierProvider.ISBN,
          value: '9781234567890',
        },
      }),
      null
    );
  });
});
