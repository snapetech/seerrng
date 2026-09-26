import ReadarrAPI, {
  type ReadarrBookLookupResult,
} from '@server/api/servarr/readarr';
import type { ReadarrSettings } from '@server/lib/settings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBookshelfBookDetails,
  getBookshelfMetadataSource,
  makeBookshelfAuthorId,
  makeBookshelfBookId,
  mapBookshelfBook,
  parseBookshelfAuthorId,
  parseBookshelfBookId,
} from './bookshelfCatalog';

describe('Bookshelf catalog identities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round trips provider-qualified foreign IDs with their service identity', () => {
    const id = makeBookshelfBookId(27, 'googlebooks:volume/a+b=');

    expect(parseBookshelfBookId(id)).toEqual({
      serviceId: 27,
      foreignBookId: 'googlebooks:volume/a+b=',
    });
    expect(parseBookshelfBookId('bookshelf:0:YWJj')).toBeUndefined();
    expect(parseBookshelfBookId('bookshelf:27:!bad')).toBeUndefined();
    const authorId = makeBookshelfAuthorId(
      27,
      'loc-author:abc',
      'Example Author'
    );
    expect(parseBookshelfAuthorId(authorId)).toEqual({
      serviceId: 27,
      foreignAuthorId: 'loc-author:abc',
      authorName: 'Example Author',
    });
  });

  it('maps source IDs and ISBN editions without coercing them to Open Library IDs', () => {
    const result: ReadarrBookLookupResult = {
      title: 'Example title',
      foreignBookId: 'loc:encoded-record',
      foreignEditionId: 'loc-edition:encoded',
      author: {
        foreignAuthorId: 'loc-author:encoded',
        authorName: 'Example author',
      },
      editions: [
        {
          foreignEditionId: 'loc-edition:encoded',
          title: 'Example title',
          isbn13: '9780306406157',
          monitored: true,
        },
      ],
    };
    const mapped = mapBookshelfBook(result, 4);

    expect(mapped.provider).toBe('bookshelf');
    expect(parseBookshelfBookId(mapped.id)?.foreignBookId).toBe(
      'loc:encoded-record'
    );
    expect(parseBookshelfAuthorId(mapped.authorId!)).toMatchObject({
      serviceId: 4,
      foreignAuthorId: 'loc-author:encoded',
      authorName: 'Example author',
    });
    expect(mapped.editionId).toBe('loc-edition:encoded');
    expect(mapped.isbn13).toBe('9780306406157');
  });

  it('keeps Europeana IDs opaque when wrapping them for Seerr details and authors', () => {
    const result: ReadarrBookLookupResult = {
      title: 'Escrita criativa da ideia ao texto',
      foreignBookId: 'europeana:LzIwMi9yZWNvcmQtMQ',
      foreignEditionId: 'europeana:LzIwMi9yZWNvcmQtMQ',
      author: {
        foreignAuthorId: 'europeana-author:UnViZW5zIE1hcmNoaW9uaQ',
        authorName: 'Rubens Marchioni',
      },
    };

    const mapped = mapBookshelfBook(result, 31);

    expect(parseBookshelfBookId(mapped.id)).toEqual({
      serviceId: 31,
      foreignBookId: 'europeana:LzIwMi9yZWNvcmQtMQ',
    });
    expect(parseBookshelfAuthorId(mapped.authorId!)).toMatchObject({
      serviceId: 31,
      foreignAuthorId: 'europeana-author:UnViZW5zIE1hcmNoaW9uaQ',
      authorName: 'Rubens Marchioni',
    });
    expect(mapped.metadataSource).toEqual({
      name: 'Europeana',
      url: 'https://www.europeana.eu/item/202/record-1',
    });
  });

  it('preserves NDL source attribution through the Bookshelf identity wrapper', () => {
    const recordId = 'R100000001-I11141124078689';
    const foreignBookId = `ndl:${Buffer.from(recordId).toString('base64url')}`;
    const result: ReadarrBookLookupResult = {
      title: '青い目の坊っちゃん',
      foreignBookId,
      author: {
        foreignAuthorId: 'ndl-author:44GT44KT44Gr44Gh44Gv',
        authorName: 'ジョン・ストッカー',
      },
    };

    const mapped = mapBookshelfBook(result, 12);

    expect(parseBookshelfBookId(mapped.id)?.foreignBookId).toBe(foreignBookId);
    expect(mapped.metadataSource).toEqual({
      name: 'NDL Search API',
      url: `https://ndlsearch.ndl.go.jp/books/${recordId}`,
    });
    expect(
      getBookshelfMetadataSource('ndl:aHR0cHM6Ly9leGFtcGxlLmNvbS9wYXRo')
    ).toBeUndefined();
  });

  it('resolves details only through the service encoded in the result ID', async () => {
    const details = await getBookshelfBookDetails(
      [],
      makeBookshelfBookId(9, 'googlebooks:volume-id')
    );

    expect(details).toBeUndefined();
  });

  it('uses the explicit work lookup for numeric Bookshelf book IDs', async () => {
    const lookupBook = vi
      .spyOn(ReadarrAPI.prototype, 'lookupBook')
      .mockImplementation(async (term) =>
        term === 'work:139773'
          ? [
              {
                title: 'The Fellowship of the Ring',
                foreignBookId: '139773',
                seriesTitle: 'The Lord of the Rings #1',
                author: {
                  foreignAuthorId: '1077326',
                  authorName: 'J.R.R. Tolkien',
                },
                editions: [],
              },
            ]
          : []
      );
    const server = {
      id: 9,
      name: 'BookshelfNG-Audiobooks',
      hostname: 'bookshelf.test',
      port: 8787,
      apiKey: 'test-key',
      useSsl: false,
      baseUrl: '',
      serviceType: 'audiobook',
    } as ReadarrSettings;

    const details = await getBookshelfBookDetails(
      [server],
      makeBookshelfBookId(server.id, '139773')
    );

    expect(lookupBook).toHaveBeenCalledOnce();
    expect(lookupBook).toHaveBeenCalledWith('work:139773');
    expect(details).toMatchObject({
      title: 'The Fellowship of the Ring',
      series: [{ title: 'The Lord of the Rings', position: '1' }],
    });
  });
});
