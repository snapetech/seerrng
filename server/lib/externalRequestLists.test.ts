import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { ExternalRequestList } from '@server/entity/ExternalRequestList';
import {
  DuplicateMediaRequestError,
  MediaRequest,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  parseExternalRequestListUrl,
  parseGoodreadsToReadFeed,
  parseImdbWatchlistHtml,
  resolveGoodreadsItem,
  resolveImdbItem,
  syncExternalRequestList,
  type ExternalRequestListSyncAdapters,
} from '@server/lib/externalRequestLists';
import { setupTestDb } from '@server/test/db';

describe('external request list synchronization', () => {
  setupTestDb();

  afterEach(() => {
    mock.restoreAll();
  });

  it('accepts only supported public IMDb and Goodreads source URLs', () => {
    assert.deepEqual(
      parseExternalRequestListUrl(
        'https://www.imdb.com/user/ur12345678/watchlist/'
      ),
      {
        provider: 'imdb',
        sourceId: 'ur12345678',
        sourceUrl: 'https://www.imdb.com/user/ur12345678/watchlist/',
      }
    );
    assert.deepEqual(
      parseExternalRequestListUrl(
        'https://www.goodreads.com/user/show/1234567-example'
      ),
      {
        provider: 'goodreads',
        sourceId: 'goodreads:1234567:to-read',
        sourceUrl:
          'https://www.goodreads.com/review/list_rss/1234567?shelf=to-read',
      }
    );
    for (const url of [
      'http://www.imdb.com/user/ur12345678/watchlist/',
      'https://imdb.com.evil.example/user/ur12345678/watchlist/',
      'https://www.imdb.com/user/ur12345678/watchlist/?next=http://127.0.0.1',
      'https://www.goodreads.com/review/list_rss/1234567?shelf=read',
      'https://www.goodreads.com/review/list_rss/1234567?url=http://127.0.0.1',
    ]) {
      assert.equal(parseExternalRequestListUrl(url), undefined, url);
    }
  });

  it('parses IMDb and Goodreads source data into bounded request identities', async () => {
    assert.deepEqual(
      parseImdbWatchlistHtml(
        '<a href="/title/tt1234567/">Film</a><a href="/title/tt1234567/">Film</a>'
      ),
      [{ id: 'tt1234567' }]
    );
    assert.deepEqual(
      await parseGoodreadsToReadFeed(`
        <rss><channel><item>
          <book_id>123456</book_id>
          <title>Example Book</title>
          <author_name>Example Author</author_name>
          <isbn13>9780441478125</isbn13>
        </item></channel></rss>
      `),
      [
        {
          id: '123456',
          title: 'Example Book',
          author: 'Example Author',
          isbn13: '9780441478125',
        },
      ]
    );
  });

  it('resolves Goodreads ISBNs to a requestable Open Library work', async () => {
    const lookup = mock.method(
      OpenLibraryAPI.prototype,
      'searchBooks',
      async () =>
        ({
          numFound: 1,
          start: 0,
          docs: [
            {
              key: '/works/OL27448W',
              title: 'Example Book',
              isbn: ['9780441478125'],
              author_name: ['Example Author'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['searchBooks']>>
    );

    const result = await resolveGoodreadsItem({
      id: '123456',
      title: 'Example Book',
      author: 'Example Author',
      isbn13: '9780441478125',
    });

    assert.deepEqual(result?.request, {
      mediaType: MediaType.BOOK,
      mediaId: 'OL27448W',
      isbn13: '9780441478125',
      format: 'ebook',
    });
    assert.equal(lookup.mock.callCount(), 1);
    assert.equal(
      lookup.mock.calls[0]?.arguments[0]?.query,
      'isbn:9780441478125'
    );
  });

  it('resolves IMDb identities to a movie request', async () => {
    mock.method(
      TheMovieDb.prototype,
      'getByExternalId',
      async () =>
        ({
          movie_results: [{ id: 123 }],
          tv_results: [],
          person_results: [],
        }) as unknown as Awaited<ReturnType<TheMovieDb['getByExternalId']>>
    );

    assert.deepEqual(await resolveImdbItem('tt1234567'), {
      request: { mediaType: MediaType.MOVIE, mediaId: 123 },
    });
  });

  it('submits new IMDb entries as the list owner through MediaRequest.request', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const repository = getRepository(ExternalRequestList);
    const list = await repository.save(
      new ExternalRequestList({
        user,
        provider: 'imdb',
        sourceId: 'ur12345678',
        sourceUrl: 'https://www.imdb.com/user/ur12345678/watchlist/',
        processedItemIds: [],
      })
    );
    const requested: { body: unknown; userId: number; options: unknown[] }[] =
      [];
    let resolveCount = 0;
    const requestMock = mock.method(
      MediaRequest,
      'request',
      async (...args: Parameters<typeof MediaRequest.request>) => {
        requested.push({
          body: args[0],
          userId: args[1].id,
          options: args.slice(2),
        });
        return {} as MediaRequest;
      }
    );

    const adapters: ExternalRequestListSyncAdapters = {
      fetchImdbWatchlist: async () => [{ id: 'tt1234567' }],
      fetchGoodreadsToRead: async () => [],
      resolveImdbItem: async () => {
        resolveCount += 1;
        return {
          request: { mediaType: MediaType.MOVIE, mediaId: 123 },
        };
      },
      resolveGoodreadsItem: async () => undefined,
      requestMedia: (body, owner) => MediaRequest.request(body, owner),
      saveList: (record) => repository.save(record),
      now: () => new Date('2026-10-04T12:00:00.000Z'),
    };

    const firstSync = await syncExternalRequestList(list, user, adapters);
    const secondSync = await syncExternalRequestList(list, user, adapters);

    assert.equal(firstSync.requested, 1);
    assert.equal(firstSync.failed, 0);
    assert.equal(secondSync.requested, 0);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].userId, user.id);
    assert.deepEqual(requested[0].body, {
      mediaType: MediaType.MOVIE,
      mediaId: 123,
    });
    assert.deepEqual(requested[0].options, []);
    assert.equal(resolveCount, 1);
    assert.deepEqual(list.processedItemIds, ['tt1234567']);
    assert.equal(requestMock.mock.callCount(), 1);
  });

  it('records duplicate requests as processed without submitting again', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const repository = getRepository(ExternalRequestList);
    const list = await repository.save(
      new ExternalRequestList({
        user,
        provider: 'imdb',
        sourceId: 'ur12345678',
        sourceUrl: 'https://www.imdb.com/user/ur12345678/watchlist/',
        processedItemIds: [],
      })
    );
    const adapters: ExternalRequestListSyncAdapters = {
      fetchImdbWatchlist: async () => [{ id: 'tt9876543' }],
      fetchGoodreadsToRead: async () => [],
      resolveImdbItem: async () => ({
        request: { mediaType: MediaType.MOVIE, mediaId: 456 },
      }),
      resolveGoodreadsItem: async () => undefined,
      requestMedia: async () => {
        throw new DuplicateMediaRequestError('Already requested.');
      },
      saveList: (record) => repository.save(record),
      now: () => new Date('2026-10-04T12:00:00.000Z'),
    };

    const result = await syncExternalRequestList(list, user, adapters);

    assert.equal(result.alreadyRequested, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(list.processedItemIds, ['tt9876543']);
  });
});
