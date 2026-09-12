import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type OpenLibraryAPI from '@server/api/openlibrary';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { resolveOpenLibraryIdentifiersForPlexAudiobook } from './bookIdentifierResolver';

const fakeOpenLibrary = (response: {
  numFound: number;
  start: number;
  docs: { key: string; title: string; isbn?: string[] }[];
}): OpenLibraryAPI =>
  ({
    searchBooks: async () => response,
  }) as unknown as OpenLibraryAPI;

describe('Plex audiobook identifier resolution', () => {
  it('does not persist an invalid Open Library ISBN beside a valid work ID', async () => {
    const identifiers = await resolveOpenLibraryIdentifiersForPlexAudiobook(
      'Charon - The Court of the Underworld',
      'Ada Sinclair',
      fakeOpenLibrary({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL123W',
            title: 'Charon - The Court of the Underworld',
            isbn: ['9781234567890'],
          },
        ],
      })
    );

    assert.deepStrictEqual(identifiers, [
      { provider: MediaIdentifierProvider.OPENLIBRARY, value: 'OL123W' },
    ]);
  });

  it('normalizes a valid ISBN-10 to the canonical ISBN-13 form', async () => {
    const identifiers = await resolveOpenLibraryIdentifiersForPlexAudiobook(
      'Example Book',
      'Example Author',
      fakeOpenLibrary({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL456W',
            title: 'Example Book',
            isbn: ['not-an-isbn', '0-306-40615-2'],
          },
        ],
      })
    );

    assert.deepStrictEqual(identifiers, [
      { provider: MediaIdentifierProvider.OPENLIBRARY, value: 'OL456W' },
      { provider: MediaIdentifierProvider.ISBN, value: '9780306406157' },
    ]);
  });

  it('rejects an unrelated Open Library top hit instead of persisting a wrong match', async () => {
    const identifiers = await resolveOpenLibraryIdentifiersForPlexAudiobook(
      'The Midnight Library',
      'Matt Haig',
      fakeOpenLibrary({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL999W',
            title: 'A Completely Unrelated Cookbook',
            isbn: ['9780000000002'],
          },
        ],
      })
    );

    assert.deepStrictEqual(identifiers, []);
  });

  it('accepts a match with a subtitle or edition suffix the query lacks', async () => {
    const identifiers = await resolveOpenLibraryIdentifiersForPlexAudiobook(
      'Dune',
      'Frank Herbert',
      fakeOpenLibrary({
        numFound: 1,
        start: 0,
        docs: [
          {
            key: '/works/OL42W',
            title: 'Dune (Unabridged)',
          },
        ],
      })
    );

    assert.deepStrictEqual(identifiers, [
      { provider: MediaIdentifierProvider.OPENLIBRARY, value: 'OL42W' },
    ]);
  });
});
