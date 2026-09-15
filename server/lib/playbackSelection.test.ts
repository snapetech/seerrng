import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import {
  isPlaybackQuality4k,
  resolvePlaybackCatalogItemIds,
} from '@server/lib/playbackSelection';
import type { PlaybackCatalogResponse } from '@server/models/Playback';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const movieCatalog = (rootItemId?: string): PlaybackCatalogResponse => ({
  mediaId: 4676,
  serverType: MediaServerType.PLEX,
  is4k: false,
  rootItem: rootItemId
    ? {
        id: rootItemId,
        title: 'Moana',
        index: 0,
        kind: 'movie',
        available: true,
      }
    : undefined,
  groups: [],
});

const musicCatalog = (
  is4k: boolean,
  itemIds: string[]
): PlaybackCatalogResponse => ({
  mediaId: 4677,
  serverType: MediaServerType.PLEX,
  is4k,
  groups: [
    {
      id: is4k ? 'flac-album' : 'mp3-album',
      title: 'Like a Prayer',
      index: 1,
      available: true,
      items: itemIds.map((id, index) => ({
        id,
        title: `Track ${index + 1}`,
        index: index + 1,
        parentIndex: 1,
        kind: 'track',
        available: true,
      })),
    },
  ],
});

describe('playback catalog selection', () => {
  it('accepts both validated boolean and raw string 4K query flags', () => {
    assert.strictEqual(isPlaybackQuality4k(true), true);
    assert.strictEqual(isPlaybackQuality4k('true'), true);
    assert.strictEqual(isPlaybackQuality4k(false), false);
    assert.strictEqual(isPlaybackQuality4k('false'), false);
  });

  it('uses the current movie catalog item when the browser sends a stale ID', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog('current-rating-key'),
        requestedItemIds: ['stale-rating-key'],
      }),
      ['current-rating-key']
    );
  });

  it('uses the current movie catalog item when nothing is selected', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog('current-rating-key'),
        requestedItemIds: [],
      }),
      ['current-rating-key']
    );
  });

  it('does not invent a movie item when the current catalog has none', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog(),
        requestedItemIds: ['stale-rating-key'],
      }),
      []
    );
  });

  it('translates a music selection into only the selected quality catalog', () => {
    const mp3Catalog = musicCatalog(false, ['mp3-1', 'mp3-2', 'mp3-3']);
    const flacCatalog = musicCatalog(true, ['flac-1', 'flac-2', 'flac-3']);

    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MUSIC,
        targetCatalog: flacCatalog,
        sourceCatalog: mp3Catalog,
        requestedItemIds: ['mp3-1', 'mp3-3'],
      }),
      ['flac-1', 'flac-3']
    );
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MUSIC,
        targetCatalog: mp3Catalog,
        sourceCatalog: flacCatalog,
        requestedItemIds: ['flac-2'],
      }),
      ['mp3-2']
    );
  });
});
