import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { afterEach, describe, it, mock } from 'node:test';

import type {
  ReadarrBook,
  ReadarrBookOptions,
} from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import axios from 'axios';

type MockableReadarr = {
  get: (
    endpoint: string,
    options?: { params?: Record<string, unknown> }
  ) => Promise<unknown>;
  post: (
    endpoint: string,
    data?: Record<string, unknown>,
    options?: { params?: Record<string, unknown> }
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

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }

  return body ? JSON.parse(body) : undefined;
};

const writeJson = (
  response: ServerResponse,
  status: number,
  body: unknown
): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
};

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

describe('ReadarrAPI.getBook', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches a specific book by ID', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => existingBook({ id: 42 })
    );

    const result = await api.getBook(42);

    assert.strictEqual(result.id, 42);
    assert.strictEqual(getMock.mock.calls[0].arguments[0], '/book/42');
  });
});

describe('ReadarrAPI.getBookCover', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches the first advertised relative cover path outside the API base path', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/base/api/v1',
      apiKey: 'key',
    });
    mock.method(api, 'getBook', async () =>
      existingBook({
        id: 42,
        images: [
          {
            coverType: 'cover',
            url: '/MediaCover/42/cover.jpg',
          },
        ],
      })
    );
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('image-bytes'),
      headers: { 'content-type': 'image/jpeg' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;

    const result = await api.getBookCover(42);

    assert.deepStrictEqual(result.imageBuffer, Buffer.from('image-bytes'));
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(
      (
        axiosGetMock.mock.calls as unknown as {
          arguments: [string];
        }[]
      )[0].arguments[0],
      'http://localhost:8787/base/MediaCover/42/cover.jpg'
    );
  });

  it('falls back to the standard Readarr-compatible cover path', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(api, 'getBook', async () => existingBook({ id: 42 }));
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('fallback-image'),
      headers: { 'content-type': 'image/png' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;

    const result = await api.getBookCover(42);

    assert.deepStrictEqual(result.imageBuffer, Buffer.from('fallback-image'));
    assert.strictEqual(
      (
        axiosGetMock.mock.calls as unknown as {
          arguments: [string];
        }[]
      )[0].arguments[0],
      'http://localhost:8787/MediaCover/42/cover.jpg'
    );
  });

  it('falls back to an advertised remote cover when local media cover is not an image', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(api, 'getBook', async () =>
      existingBook({
        id: 42,
        images: [
          {
            coverType: 'cover',
            url: '/MediaCover/Books/42/cover.jpeg?lastWrite=123',
            remoteUrl: 'https://assets.hardcover.app/book-cover.jpeg',
          },
        ],
      })
    );
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('login-page'),
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;
    const remoteGetMock = mock.method(axios, 'get', async () => ({
      data: Buffer.from('remote-book-image'),
      headers: { 'content-type': 'image/jpeg' },
    }));

    const result = await api.getBookCover(42);

    assert.deepStrictEqual(
      result.imageBuffer,
      Buffer.from('remote-book-image')
    );
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(
      remoteGetMock.mock.calls[0].arguments[0],
      'https://assets.hardcover.app/book-cover.jpeg'
    );
    assert.deepStrictEqual(remoteGetMock.mock.calls[0].arguments[1], {
      responseType: 'arraybuffer',
      headers: { Accept: 'image/*' },
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

describe('ReadarrAPI media type requests', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('scopes lookups and adds to the configured book format', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
      mediaType: 'audiobook',
    });
    const getMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => []
    );
    const postMock = mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'post',
      async () => existingBook({ id: 11 })
    );

    await api.lookupBook('isbn:9780000000001');
    await api.addBook(bookOptions);

    assert.deepStrictEqual(getMock.mock.calls[0].arguments[1], {
      params: {
        term: 'isbn:9780000000001',
        mediaType: 'audiobook',
      },
    });
    assert.deepStrictEqual(getMock.mock.calls[1].arguments[1], {
      params: { mediaType: 'audiobook' },
    });
    assert.deepStrictEqual(postMock.mock.calls[0].arguments[2], {
      params: { mediaType: 'audiobook' },
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
        apiKey: 'provider-secret',
        providerOnly: true,
      })
    );

    const result = await api.getDevelopmentConfig();

    assert.strictEqual(result.metadataSource, 'http://127.0.0.1:8790');
    assert.ok(!('apiKey' in result));
    assert.ok(!('providerOnly' in result));
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

  it('matches existing books with canonicalized Open Library work and edition IDs', async () => {
    const api = new ReadarrAPI({
      url: 'http://localhost:8787/api/v1',
      apiKey: 'key',
    });
    mock.method(
      ReadarrAPI.prototype as unknown as MockableReadarr,
      'get',
      async () => [
        existingBook({
          foreignBookId: '/works/ol123w',
          editions: [
            {
              foreignEditionId: '/books/ol456m',
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

    const result = await api.addBook({
      ...bookOptions,
      foreignBookId: 'OL123W',
      editions: [
        {
          foreignEditionId: 'OL456M',
          title: 'Test Book',
          monitored: true,
        },
      ],
    });

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

describe('ReadarrAPI Chaptarr compatibility', () => {
  it('uses the format facade, falls back to native lookup, and repairs monitoring/search state', async () => {
    const requests: {
      method: string;
      path: string;
      query: URLSearchParams;
      body: unknown;
    }[] = [];
    const lookupResult = {
      title: 'Dune',
      titleSlug: 'dune',
      foreignBookId: 'hc:123',
      mediaType: 'ebook' as const,
      author: {
        foreignAuthorId: 'hc:456',
        authorName: 'Frank Herbert',
      },
      editions: [
        {
          foreignEditionId: 'hc:789',
          title: 'Dune',
          isbn13: '9780000000001',
          monitored: true,
        },
      ],
    };
    const unmonitoredBook = {
      id: 42,
      ...lookupResult,
      monitored: false,
      ebookMonitored: false,
      addOptions: { searchForNewBook: false },
    };
    const monitoredBook = {
      ...unmonitoredBook,
      monitored: true,
      ebookMonitored: true,
      addOptions: { searchForNewBook: true },
    };
    let bookState = unmonitoredBook;
    const scopedBases = [
      '/readarr/hc/ebook/api/v1',
      '/readarr/gr/ebook/api/v1',
    ];
    const server = createServer((request, response) => {
      void (async () => {
        const parsedUrl = new URL(request.url ?? '/', 'http://localhost');
        const scopedBase = scopedBases.find((base) =>
          parsedUrl.pathname.startsWith(base)
        );
        const body = await readJsonBody(request);
        requests.push({
          method: request.method ?? 'GET',
          path: parsedUrl.pathname,
          query: parsedUrl.searchParams,
          body,
        });

        if (parsedUrl.pathname === '/api/v1/system/status') {
          writeJson(response, 200, {
            appName: 'Chaptarr',
            version: '0.9.911.0',
            urlBase: '',
          });
          return;
        }

        if (parsedUrl.pathname === '/api/v1/config/hardcover') {
          writeJson(response, 200, { enabled: false });
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/lookup`
        ) {
          writeJson(response, 200, []);
          return;
        }

        if (
          request.method === 'GET' &&
          parsedUrl.pathname === '/api/v1/book/lookup'
        ) {
          writeJson(response, 200, [lookupResult]);
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book`
        ) {
          writeJson(response, 200, []);
          return;
        }

        if (
          request.method === 'POST' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book`
        ) {
          writeJson(response, 201, 42);
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/42`
        ) {
          writeJson(response, 200, bookState);
          return;
        }

        if (
          request.method === 'PUT' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/42`
        ) {
          bookState = monitoredBook;
          writeJson(response, 202, 42);
          return;
        }

        if (
          request.method === 'POST' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/command`
        ) {
          writeJson(response, 201, {});
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/queue`
        ) {
          writeJson(response, 200, {
            page: 1,
            pageSize: 1000,
            totalRecords: 0,
            records: [],
          });
          return;
        }

        writeJson(response, 404, { message: 'not found' });
      })().catch(() => writeJson(response, 500, { message: 'handler failed' }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
      const api = new ReadarrAPI({
        url: `http://127.0.0.1:${address.port}/api/v1`,
        apiKey: 'key',
        mediaType: 'ebook',
      });

      const lookup = await api.lookupBook('dune');
      assert.strictEqual(lookup[0].foreignBookId, 'hc:123');

      const result = await api.addBook({
        ...bookOptions,
        title: 'Dune',
        foreignBookId: 'hc:123',
        mediaType: 'ebook',
      });
      assert.strictEqual(result.id, 42);
      assert.strictEqual(result.ebookMonitored, true);

      await api.getQueue();

      const scopedPaths = requests
        .filter(({ path }) => path.includes('/readarr/'))
        .map(({ path }) => path);
      assert.deepStrictEqual(scopedPaths, [
        '/readarr/gr/ebook/api/v1/book/lookup',
        '/readarr/hc/ebook/api/v1/book/lookup',
        '/readarr/gr/ebook/api/v1/book',
        '/readarr/gr/ebook/api/v1/book',
        '/readarr/gr/ebook/api/v1/book/42',
        '/readarr/gr/ebook/api/v1/book/42',
        '/readarr/gr/ebook/api/v1/book/42',
        '/readarr/gr/ebook/api/v1/command',
        '/readarr/gr/ebook/api/v1/queue',
      ]);

      const nativeLookup = requests.find(
        ({ path }) => path === '/api/v1/book/lookup'
      );
      assert.ok(nativeLookup);
      assert.strictEqual(nativeLookup.query.get('mediaType'), null);

      const post = requests.find(
        ({ method, path }) =>
          method === 'POST' && path === '/readarr/gr/ebook/api/v1/book'
      );
      assert.ok(post);
      assert.deepStrictEqual(
        (post.body as Record<string, unknown>).ebookMonitored,
        true
      );

      const update = requests.find(
        ({ method, path }) =>
          method === 'PUT' && path === '/readarr/gr/ebook/api/v1/book/42'
      );
      assert.ok(update);
      assert.deepStrictEqual(update.body, {
        id: 42,
        mediaType: 'ebook',
        monitored: true,
        ebookMonitored: true,
        addOptions: { searchForNewBook: true },
      });

      const queue = requests.find(({ path }) => path.endsWith('/queue'));
      assert.ok(queue);
      assert.strictEqual(queue.query.get('page'), '1');
      assert.strictEqual(queue.query.get('pageSize'), '1000');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('uses addressable native results when an older Chaptarr build has no ebook lookup index', async () => {
    const requests: {
      method: string;
      path: string;
      query: URLSearchParams;
      body: unknown;
    }[] = [];
    const nativeResult = {
      title: 'The War of the Worlds',
      foreignBookId: 'gr:3194841',
      mediaType: 'audiobook' as const,
      author: {
        foreignAuthorId: 'gr:880695',
        authorName: 'H.G. Wells',
      },
      editions: [
        {
          foreignEditionId: 'gr:8909',
          title: 'The War of the Worlds',
          monitored: true,
        },
      ],
    };
    let bookState = {
      ...nativeResult,
      id: 17,
      mediaType: 'ebook' as const,
      monitored: true,
      ebookMonitored: true,
      addOptions: { searchForNewBook: false },
    };
    const scopedBases = [
      '/readarr/gr/ebook/api/v1',
      '/readarr/hc/ebook/api/v1',
    ];
    const server = createServer((request, response) => {
      void (async () => {
        const parsedUrl = new URL(request.url ?? '/', 'http://localhost');
        const scopedBase = scopedBases.find((base) =>
          parsedUrl.pathname.startsWith(base)
        );
        const body = await readJsonBody(request);
        requests.push({
          method: request.method ?? 'GET',
          path: parsedUrl.pathname,
          query: parsedUrl.searchParams,
          body,
        });

        if (parsedUrl.pathname === '/api/v1/system/status') {
          writeJson(response, 200, {
            appName: 'Chaptarr',
            version: '0.9.911.0',
            urlBase: '',
          });
          return;
        }

        if (parsedUrl.pathname === '/api/v1/config/hardcover') {
          writeJson(response, 200, { enabled: false });
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/lookup`
        ) {
          writeJson(response, 200, []);
          return;
        }

        if (
          request.method === 'GET' &&
          parsedUrl.pathname === '/api/v1/book/lookup'
        ) {
          writeJson(response, 200, [nativeResult]);
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book`
        ) {
          writeJson(response, 200, []);
          return;
        }

        if (
          request.method === 'POST' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book`
        ) {
          writeJson(response, 201, bookState);
          return;
        }

        if (
          request.method === 'GET' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/17`
        ) {
          writeJson(response, 200, bookState);
          return;
        }

        if (
          request.method === 'PUT' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/book/17`
        ) {
          bookState = {
            ...bookState,
            ...(body as Record<string, unknown>),
            addOptions: { searchForNewBook: true },
          };
          writeJson(response, 202, bookState);
          return;
        }

        if (
          request.method === 'POST' &&
          scopedBase &&
          parsedUrl.pathname === `${scopedBase}/command`
        ) {
          writeJson(response, 201, {});
          return;
        }

        writeJson(response, 404, { message: 'not found' });
      })().catch(() => writeJson(response, 500, { message: 'handler failed' }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
      const api = new ReadarrAPI({
        url: `http://127.0.0.1:${address.port}/api/v1`,
        apiKey: 'key',
        mediaType: 'ebook',
      });

      const lookup = await api.lookupBook('the war of the worlds');
      assert.strictEqual(lookup[0].mediaType, 'ebook');
      assert.strictEqual(lookup[0].foreignBookId, nativeResult.foreignBookId);

      const result = await api.addBook({
        ...lookup[0],
        mediaType: 'ebook',
        monitored: true,
        qualityProfileId: 1,
        metadataProfileId: 2,
        rootFolderPath: '/ebooks',
        tags: [],
        addOptions: { searchForNewBook: true },
      });

      assert.strictEqual(result.id, 17);
      assert.strictEqual(result.mediaType, 'ebook');
      const post = requests.find(
        ({ method, path }) =>
          method === 'POST' && path === '/readarr/gr/ebook/api/v1/book'
      );
      assert.ok(post);
      assert.strictEqual(post.query.get('mediaType'), 'ebook');
      assert.strictEqual(
        (post.body as Record<string, unknown>).ebookMonitored,
        true
      );
      const update = requests.find(
        ({ method, path }) =>
          method === 'PUT' && path === '/readarr/gr/ebook/api/v1/book/17'
      );
      assert.ok(update);
      assert.deepStrictEqual(update.body, {
        id: 17,
        mediaType: 'ebook',
        monitored: true,
        ebookMonitored: true,
        addOptions: { searchForNewBook: true },
      });
      assert.ok(
        requests.some(
          ({ method, path }) =>
            method === 'POST' && path === '/readarr/gr/ebook/api/v1/command'
        )
      );
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
