import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapOpenLibrarySearchDoc,
  mapOpenLibraryWork,
} from '@server/models/Book';

describe('mapOpenLibraryWork', () => {
  it('extracts and ranks unique ISBN candidates from editions', () => {
    const result = mapOpenLibraryWork(
      {
        key: '/works/OL123W',
        title: 'Test Book',
      },
      undefined,
      [
        {
          key: '/books/OL1M',
          title: 'Paperback',
          isbn_10: ['0-441-47812-3'],
          physical_format: 'Paperback',
        },
        {
          key: '/books/OL2M',
          title: 'Hardcover',
          isbn_13: ['978-0-679-78326-8'],
          physical_format: 'Hardcover',
        },
        {
          key: '/books/OL3M',
          title: 'Duplicate',
          isbn_13: ['9780441478125'],
        },
        {
          key: '/books/OL4M',
          title: 'Invalid',
          isbn_13: ['9780123456789'],
        },
      ]
    );

    assert.strictEqual(result.isbn13, '9780441478125');
    assert.strictEqual(result.editionId, 'OL1M');
    assert.deepStrictEqual(
      result.isbnCandidates?.map((candidate) => candidate.isbn),
      ['9780441478125', '9780679783268']
    );
  });

  it('normalizes uppercase Open Library work and edition prefixes', () => {
    const result = mapOpenLibraryWork(
      {
        key: '/WORKS/ol123w',
        title: 'Test Book',
      },
      undefined,
      [
        {
          key: '/BOOKS/ol1m',
          title: 'Paperback',
          isbn_10: ['0-441-47812-3'],
        },
      ]
    );

    assert.strictEqual(result.id, 'OL123W');
    assert.strictEqual(result.editionId, 'OL1M');
  });
});

describe('mapOpenLibrarySearchDoc', () => {
  it('normalizes uppercase Open Library search document prefixes', () => {
    const result = mapOpenLibrarySearchDoc({
      key: '/WORKS/ol456w',
      title: 'Search Book',
    });

    assert.strictEqual(result.id, 'OL456W');
  });
});
