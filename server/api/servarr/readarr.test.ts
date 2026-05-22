import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type {
  ReadarrBook,
  ReadarrBookOptions,
} from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';

type MockableReadarr = {
  get: (
    endpoint: string,
    options?: { params?: Record<string, unknown> }
  ) => Promise<unknown>;
  post: (
    endpoint: string,
    data?: Record<string, unknown>
  ) => Promise<ReadarrBook>;
};

const bookOptions: ReadarrBookOptions = {
  title: 'Test Book',
  foreignBookId: 'book-foreign-id',
  qualityProfileId: 1,
  metadataProfileId: 2,
  rootFolderPath: '/books',
  monitored: true,
  tags: [10],
  editions: [
    {
      foreignEditionId: 'edition-foreign-id',
      title: 'Test Book',
      isbn13: '9780000000001',
      monitored: true,
    },
  ],
  addOptions: {
    searchForNewBook: true,
  },
};

const existingBook = (overrides: Partial<ReadarrBook> = {}): ReadarrBook => ({
  id: 9,
  title: 'Test Book',
  titleSlug: 'test-book',
  foreignBookId: 'book-foreign-id',
  monitored: true,
  editions: [
    {
      foreignEditionId: 'edition-foreign-id',
      title: 'Test Book',
      isbn13: '9780000000001',
      monitored: true,
    },
  ],
  ...overrides,
});

describe('ReadarrAPI.getEditions', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches editions for a specific book', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [
        {
          foreignEditionId: 'edition-foreign-id',
          title: 'Test Book',
          isbn13: '9780000000001',
          monitored: true,
        },
      ]
    );

    const result = await api.getEditions(42);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(getMock.mock.calls[0].arguments[0], '/edition');
    assert.deepStrictEqual(getMock.mock.calls[0].arguments[1], {
      params: { bookId: 42 },
    });
  });
});

describe('ReadarrAPI.lookupAuthor', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('looks up authors by term', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [
        {
          foreignAuthorId: '656983',
          authorName: 'J.R.R. Tolkien',
        },
      ]
    );

    const result = await api.lookupAuthor('J.R.R. Tolkien');

    assert.strictEqual(result[0].foreignAuthorId, '656983');
    assert.strictEqual(getMock.mock.calls[0].arguments[0], '/author/lookup');
    assert.deepStrictEqual(getMock.mock.calls[0].arguments[1], {
      params: { term: 'J.R.R. Tolkien' },
    });
  });
});

describe('ReadarrAPI.getDevelopmentConfig', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches development config', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => ({
        id: 1,
        metadataSource: 'http://127.0.0.1:8790',
      })
    );

    const result = await api.getDevelopmentConfig();

    assert.strictEqual(result.metadataSource, 'http://127.0.0.1:8790');
    assert.strictEqual(
      getMock.mock.calls[0].arguments[0],
      '/config/development'
    );
  });
});

describe('ReadarrAPI.addBook', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('returns an existing monitored book without posting', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [existingBook()]
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => existingBook({ id: 10 })
    );

    const result = await api.addBook(bookOptions);

    assert.strictEqual(result.id, 9);
    assert.strictEqual(getMock.mock.calls.length, 1);
    assert.strictEqual(postMock.mock.calls.length, 0);
  });

  it('matches existing books with normalized ISBNs', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [
        existingBook({
          editions: [
            {
              foreignEditionId: 'other-edition-id',
              title: 'Test Book',
              isbn13: '978-0-000-00000-1',
              monitored: true,
            },
          ],
        }),
      ]
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => existingBook({ id: 10 })
    );

    const result = await api.addBook(bookOptions);

    assert.strictEqual(result.id, 9);
    assert.strictEqual(postMock.mock.calls.length, 0);
  });

  it('matches existing books with foreign edition IDs', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [
        existingBook({
          foreignBookId: 'different-book-id',
          editions: [
            {
              foreignEditionId: 'edition-foreign-id',
              title: 'Test Book',
              monitored: true,
            },
          ],
        }),
      ]
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => existingBook({ id: 10 })
    );

    const result = await api.addBook(bookOptions);

    assert.strictEqual(result.id, 9);
    assert.strictEqual(postMock.mock.calls.length, 0);
  });

  it('monitors and searches an existing unmonitored book', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const updatedBook = existingBook({ monitored: true });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [existingBook({ monitored: false })]
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => updatedBook
    );
    const putMock = mock.fn(async () => ({ data: updatedBook }));
    (
      api as unknown as {
        axios: { put: typeof putMock };
      }
    ).axios.put = putMock;

    const result = await api.addBook(bookOptions);

    assert.strictEqual(result.id, 9);
    assert.strictEqual(putMock.mock.calls.length, 1);
    assert.strictEqual(postMock.mock.calls.length, 1);
    assert.deepStrictEqual(postMock.mock.calls[0].arguments[1], {
      name: 'BookSearch',
      bookIds: [9],
    });
  });

  it('sends an empty editions array when monitoring an existing book without editions', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const updatedBook = existingBook({ monitored: true });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [existingBook({ monitored: false, editions: undefined })]
    );
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => updatedBook
    );
    const putMock = mock.fn(async () => ({ data: updatedBook }));
    (
      api as unknown as {
        axios: { put: typeof putMock };
      }
    ).axios.put = putMock;

    await api.addBook(bookOptions);

    const updatePayload = (
      putMock.mock.calls as unknown as {
        arguments: [string, { editions?: unknown[] }];
      }[]
    )[0].arguments[1];
    assert.deepStrictEqual(updatePayload.editions, []);
  });

  it('posts a new book when no existing match is found', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => []
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => existingBook({ id: 11 })
    );

    const result = await api.addBook(bookOptions);

    assert.strictEqual(result.id, 11);
    assert.strictEqual(postMock.mock.calls.length, 1);
    assert.strictEqual(postMock.mock.calls[0].arguments[0], '/book');
  });
});
