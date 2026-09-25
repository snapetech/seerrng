import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapLazyLibrarianMagazine } from '@server/models/Magazine';

describe('mapLazyLibrarianMagazine', () => {
  it('routes valid LazyLibrarian covers through the configured service', () => {
    const coverId = 'a'.repeat(40);
    const magazine = mapLazyLibrarianMagazine(
      {
        title: 'The New Yorker',
        latestCover: `cache/magazine/${coverId}.jpg`,
      },
      [],
      undefined,
      3
    );

    assert.strictEqual(
      magazine.posterPath,
      `/api/v1/magazine/cover/3/${coverId}`
    );
  });

  it('does not expose unsafe or unconfigured LazyLibrarian cover paths', () => {
    const untrustedCover = mapLazyLibrarianMagazine(
      {
        title: 'The New Yorker',
        latestCover: 'cache/magazine/../../settings.json',
      },
      [],
      undefined,
      3
    );
    const unconfiguredCover = mapLazyLibrarianMagazine({
      title: 'The New Yorker',
      latestCover: `cache/magazine/${'a'.repeat(40)}.jpg`,
    });

    assert.strictEqual(untrustedCover.posterPath, undefined);
    assert.strictEqual(unconfiguredCover.posterPath, undefined);
  });
});
