import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { isOptionalCatalogPathEnabled } from './serviceAvailability';

describe('isOptionalCatalogPathEnabled', () => {
  it('hides optional catalogs without a configured backend service', () => {
    const availability = { musicEnabled: false, booksEnabled: false };

    strictEqual(
      isOptionalCatalogPathEnabled('/discover/music', availability),
      false
    );
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/books', availability),
      false
    );
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/audiobooks', availability),
      false
    );
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/movies', availability),
      true
    );
  });

  it('shows each optional catalog when its backend is configured', () => {
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/music', {
        musicEnabled: true,
        booksEnabled: false,
      }),
      true
    );
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/books', {
        musicEnabled: false,
        booksEnabled: true,
      }),
      true
    );
    strictEqual(
      isOptionalCatalogPathEnabled('/discover/audiobooks', {
        musicEnabled: false,
        booksEnabled: true,
      }),
      true
    );
  });
});
