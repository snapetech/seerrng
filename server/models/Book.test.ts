import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_BOOK_ISBN_CANDIDATES,
  mapOpenLibrarySearchDoc,
  mapOpenLibraryWork,
} from '@server/models/Book';

const makeIsbn13 = (body: number): string => {
  const firstTwelve = `978${body.toString().padStart(9, '0')}`;
  const sum = firstTwelve
    .split('')
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );

  return `${firstTwelve}${(10 - (sum % 10)) % 10}`;
};

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

  it('bounds ISBN candidates returned from provider edition data', () => {
    const result = mapOpenLibraryWork(
      { key: '/works/OL123W', title: 'Test Book' },
      undefined,
      [
        {
          key: '/books/OL1M',
          isbn_13: Array.from(
            { length: MAX_BOOK_ISBN_CANDIDATES + 100 },
            (_, index) => makeIsbn13(index)
          ),
        },
      ]
    );

    assert.strictEqual(result.isbnCandidates?.length, MAX_BOOK_ISBN_CANDIDATES);
  });
});

describe('mapOpenLibrarySearchDoc', () => {
  it('normalizes uppercase Open Library search document prefixes', () => {
    const result = mapOpenLibrarySearchDoc({
      key: '/WORKS/ol456w',
      title: 'Search Book',
      publisher: ['Example Press', 'Second Publisher'],
    });

    assert.strictEqual(result.id, 'OL456W');
    assert.strictEqual(result.publisher, 'Example Press');
  });
});
