import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import OpenLibraryAPI, {
  MAX_OPENLIBRARY_DESCRIPTION_LENGTH,
  MAX_OPENLIBRARY_EDITION_ISBNS,
  MAX_OPENLIBRARY_PAGE_SIZE,
  MAX_OPENLIBRARY_TITLE_LENGTH,
} from '@server/api/openlibrary';

describe('OpenLibraryAPI response bounds', () => {
  it('rejects path-control resource IDs before dispatch', async () => {
    const openLibrary = new OpenLibraryAPI();
    let dispatches = 0;
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => {
        dispatches += 1;
        return {};
      },
    });

    for (const operation of [
      () => openLibrary.getWork('../../search'),
      () => openLibrary.getWorkEditions('/works/../../search'),
      () => openLibrary.getEdition('OL1M?redirect=/account'),
      () => openLibrary.getAuthor('/authors/../../account'),
      () => openLibrary.getAuthorWorks('OL1A#fragment'),
    ]) {
      await assert.rejects(operation, /ID is invalid/i);
    }

    assert.strictEqual(dispatches, 0);
  });

  it('enforces search result bounds on provider responses', async () => {
    const openLibrary = new OpenLibraryAPI();
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => ({
        numFound: 1_000,
        start: 0,
        docs: Array.from({ length: 1_000 }, (_, index) => ({
          key: `/works/OL${index}W`,
          title: `Book ${index}`,
        })),
      }),
    });

    const response = await openLibrary.searchBooks({
      query: 'book',
      limit: 1_000,
    });

    assert.strictEqual(response.docs.length, MAX_OPENLIBRARY_PAGE_SIZE);
  });

  it('drops malformed search documents and bounds aggregate identifiers', async () => {
    const openLibrary = new OpenLibraryAPI();
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => ({
        numFound: 'invalid',
        start: -1,
        docs: [
          null,
          { key: '/works/OL1W' },
          {
            key: '/works/OL2W',
            title: 'x'.repeat(MAX_OPENLIBRARY_TITLE_LENGTH + 100),
            isbn: Array.from(
              { length: MAX_OPENLIBRARY_EDITION_ISBNS + 100 },
              (_, index) => String(index)
            ),
            publisher: ['Example Press', 42, 'Second Publisher'],
          },
        ],
      }),
    });

    const response = await openLibrary.searchBooks({ query: 'book' });

    assert.strictEqual(response.numFound, 0);
    assert.strictEqual(response.start, 0);
    assert.strictEqual(response.docs.length, 1);
    assert.strictEqual(
      response.docs[0].title.length,
      MAX_OPENLIBRARY_TITLE_LENGTH
    );
    assert.strictEqual(
      response.docs[0].isbn?.length,
      MAX_OPENLIBRARY_EDITION_ISBNS
    );
    assert.deepStrictEqual(response.docs[0].publisher, [
      'Example Press',
      'Second Publisher',
    ]);
  });

  it('bounds work text and drops malformed nested values', async () => {
    const openLibrary = new OpenLibraryAPI();
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => ({
        key: '/works/OL1W',
        title: 't'.repeat(MAX_OPENLIBRARY_TITLE_LENGTH + 100),
        description: {
          value: 'd'.repeat(MAX_OPENLIBRARY_DESCRIPTION_LENGTH + 100),
        },
        covers: [1, 'invalid', 2],
        authors: [null, { author: { key: '/authors/OL1A' } }],
        subjects: Array.from({ length: 500 }, (_, index) => `subject-${index}`),
      }),
    });

    const work = await openLibrary.getWork('OL1W');
    const description =
      typeof work.description === 'string'
        ? work.description
        : work.description?.value;

    assert.strictEqual(work.title.length, MAX_OPENLIBRARY_TITLE_LENGTH);
    assert.strictEqual(description?.length, MAX_OPENLIBRARY_DESCRIPTION_LENGTH);
    assert.deepStrictEqual(work.covers, [1, 2]);
    assert.deepStrictEqual(work.authors, [
      { author: { key: '/authors/OL1A' } },
    ]);
    assert.strictEqual(work.subjects?.length, 100);
  });

  it('bounds edition count and aggregate ISBN values', async () => {
    const openLibrary = new OpenLibraryAPI();
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => ({
        size: 1_000,
        entries: Array.from({ length: 1_000 }, (_, index) => ({
          key: `/books/OL${index}M`,
          isbn_13: Array.from({ length: 100 }, (_, isbn) => `${index}-${isbn}`),
          isbn_10: Array.from({ length: 100 }, (_, isbn) => `${isbn}`),
        })),
      }),
    });

    const response = await openLibrary.getWorkEditions('OL1W', 1_000);
    const isbnCount = response.entries.reduce(
      (total, edition) =>
        total + (edition.isbn_13?.length ?? 0) + (edition.isbn_10?.length ?? 0),
      0
    );

    assert.strictEqual(response.entries.length, MAX_OPENLIBRARY_PAGE_SIZE);
    assert.strictEqual(isbnCount, MAX_OPENLIBRARY_EDITION_ISBNS);
  });

  it('rejects invalid top-level provider resources', async () => {
    const openLibrary = new OpenLibraryAPI();
    Object.defineProperty(openLibrary, 'get', {
      configurable: true,
      value: async () => null,
    });

    await assert.rejects(openLibrary.getWork('OL1W'), /invalid work/i);
    await assert.rejects(openLibrary.getEdition('OL1M'), /invalid edition/i);
    await assert.rejects(openLibrary.getAuthor('OL1A'), /invalid author/i);
  });
});
