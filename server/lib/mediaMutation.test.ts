import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  getMediaAdmissionResources,
  getMediaMutationResource,
  runMediaMutation,
} from './mediaMutation';
import requestAdmissionCoordinator from './requestAdmission';

describe('runMediaMutation', () => {
  it('maps media identities to the scanner admission resources', () => {
    assert.deepStrictEqual(
      getMediaAdmissionResources(
        new Media({ id: 1, mediaType: MediaType.MOVIE, tmdbId: 42 })
      ),
      ['request-media:movie:42']
    );
    assert.deepStrictEqual(
      getMediaAdmissionResources(
        new Media({
          id: 2,
          mediaType: MediaType.MUSIC,
          tmdbId: 0,
          mbId: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        })
      ),
      ['request-canonical:music:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']
    );
    const book = new Media({ id: 3, mediaType: MediaType.BOOK, tmdbId: 0 });
    book.identifiers = [
      new MediaIdentifier({
        media: book,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL1W',
        canonical: true,
      }),
    ];
    assert.deepStrictEqual(getMediaAdmissionResources(book), [
      'request-canonical:book:openlibrary:OL1W',
    ]);
    const comic = new Media({ id: 4, mediaType: MediaType.COMIC, tmdbId: 0 });
    comic.identifiers = [
      new MediaIdentifier({
        media: comic,
        provider: MediaIdentifierProvider.COMICVINE,
        value: '4567',
        canonical: true,
      }),
    ];
    assert.deepStrictEqual(getMediaAdmissionResources(comic), [
      'request-canonical:comic:comicvine:4567',
    ]);
  });

  it('deduplicates and orders cross-instance media resources', async () => {
    const run = mock.method(
      requestAdmissionCoordinator,
      'run',
      async (_resources: string[], callback: () => Promise<string>) =>
        callback()
    );

    const result = await runMediaMutation([8, 2, 8], async () => 'ok');

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(run.mock.calls[0].arguments[0], [
      getMediaMutationResource(2),
      getMediaMutationResource(8),
    ]);
    run.mock.restore();
  });

  it('serializes same-row mutations locally', async () => {
    const events: string[] = [];
    let firstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runMediaMutation(5, async () => {
      events.push('first-start');
      firstStarted();
      await releaseFirstPromise;
      events.push('first-end');
    });
    await firstStartedPromise;
    const second = runMediaMutation(5, async () => {
      events.push('second');
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(events, ['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepStrictEqual(events, ['first-start', 'first-end', 'second']);
  });

  it('rejects empty or invalid resource sets', () => {
    for (const ids of [[], [0, Number.NaN], [1, Number.NaN]]) {
      assert.throws(
        () => runMediaMutation(ids, async () => undefined),
        /valid media ID/
      );
    }
  });
});
