import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { getSettings } from '@server/lib/settings';
import PlexAPI, { sanitizePlexMetadata } from './plexapi';

afterEach(() => {
  mock.restoreAll();
});

describe('Plex library synchronization', () => {
  it('preserves stored libraries when the provider fetch fails', async () => {
    const settings = getSettings();
    const original = {
      ...settings.plex,
      libraries: [
        { id: 'stored', name: 'Stored', enabled: true, type: 'movie' as const },
      ],
    };
    settings.replaceSection('plex', original);
    const saveMock = mock.method(settings, 'save', async () => undefined);
    const plex = new PlexAPI({ plexToken: 'token' });
    mock.method(plex, 'getLibraries', async () => {
      throw new Error('Provider unavailable');
    });

    await assert.rejects(plex.syncLibraries(), /Provider unavailable/);

    assert.strictEqual(settings.plex, original);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rolls back synchronized libraries when persistence fails', async () => {
    const settings = getSettings();
    const original = {
      ...settings.plex,
      libraries: [
        { id: 'stored', name: 'Stored', enabled: true, type: 'movie' as const },
      ],
    };
    settings.replaceSection('plex', original);
    mock.method(settings, 'save', async () => {
      throw new Error('Disk write failed');
    });
    const plex = new PlexAPI({ plexToken: 'token' });
    mock.method(plex, 'getLibraries', async () => [
      {
        key: 'new',
        title: 'New',
        type: 'show',
        agent: 'tv.plex.agents.series',
      },
    ]);

    await assert.rejects(
      plex.syncLibraries({ enabledLibraryIds: ['new'] }),
      /Disk write failed/
    );

    assert.strictEqual(settings.plex, original);
  });

  it('classifies artist libraries as music by default, and preserves a manual audiobook override across re-syncs', async () => {
    const settings = getSettings();
    settings.replaceSection('plex', {
      ...settings.plex,
      libraries: [
        {
          id: 'audiobooks',
          name: 'Audiobooks',
          enabled: true,
          type: 'book' as const,
        },
      ],
    });
    mock.method(settings, 'save', async () => undefined);
    const plex = new PlexAPI({ plexToken: 'token' });
    mock.method(plex, 'getLibraries', async () => [
      {
        key: 'music',
        title: 'Music',
        type: 'artist' as const,
        agent: 'tv.plex.agents.music',
      },
      {
        key: 'audiobooks',
        title: 'Audiobooks',
        type: 'artist' as const,
        agent: 'tv.plex.agents.music',
      },
    ]);

    const libraries = await plex.syncLibraries({
      enabledLibraryIds: ['music', 'audiobooks'],
    });

    const music = libraries.find((library) => library.id === 'music');
    const audiobooks = libraries.find((library) => library.id === 'audiobooks');

    assert.strictEqual(music?.type, 'music');
    // Plex reports both as 'artist' -- the manual reclassification
    // recorded for 'audiobooks' in settings must survive the re-sync.
    assert.strictEqual(audiobooks?.type, 'book');
  });
});

describe('Plex response normalization', () => {
  it('returns exact nested metadata without provider-only fields', () => {
    const metadata = sanitizePlexMetadata({
      ratingKey: 'movie',
      type: 'movie',
      title: 'Movie',
      guid: 'plex://movie/1',
      Guid: [{ id: 'tmdb://1', providerOnly: true }],
      Media: [
        {
          id: 1,
          width: 3840,
          height: 2160,
          providerOnly: true,
        },
      ],
      Children: {
        size: 1,
        Metadata: [
          {
            ratingKey: 'season',
            type: 'season',
            title: 'Season 1',
            guid: 'plex://season/1',
            providerOnly: true,
          },
        ],
        providerOnly: true,
      },
      accessToken: 'provider-secret',
      providerOnly: true,
    });

    assert.ok(metadata);
    assert.ok(!('providerOnly' in metadata));
    assert.ok(!('accessToken' in metadata));
    assert.deepStrictEqual(metadata.Guid, [{ id: 'tmdb://1' }]);
    assert.ok(!('providerOnly' in metadata.Media[0]));
    assert.ok(!('providerOnly' in metadata.Children!.Metadata[0]));
  });

  it('encodes metadata path identifiers and normalizes the response', async () => {
    const plex = new PlexAPI({ plexToken: 'token' });
    let endpoint = '';
    let requestOptions: unknown;
    Object.defineProperty(plex, 'get', {
      configurable: true,
      value: async (path: string, options: unknown) => {
        endpoint = path;
        requestOptions = options;
        return {
          MediaContainer: {
            Metadata: [
              {
                ratingKey: 'movie',
                type: 'movie',
                title: 'Movie',
                guid: 'plex://movie/1',
                providerOnly: true,
              },
            ],
          },
        };
      },
    });

    const metadata = await plex.getMetadata('../unsafe?query=true', {
      includeChildren: true,
    });

    assert.ok(!endpoint.includes('/../'));
    assert.ok(!endpoint.includes('?'));
    assert.deepStrictEqual(requestOptions, {
      params: { includeChildren: 1 },
    });
    assert.ok(!('providerOnly' in metadata));
  });
});
