import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  addJitter,
  buildRebuildArtifacts,
  buildSourceBook,
  chooseStrictMatch,
  parseRetryAfter,
  parseTags,
} from './bookshelf-hardcover-migration.mjs';

const writeJson = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, 'utf8'));

const runSqlite = async (dbPath, sql) =>
  new Promise((resolve, reject) => {
    const child = spawn('sqlite3', [dbPath, sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `sqlite3 exited ${code}`));
      }
    });
  });

const runCli = async (args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['deploy/bookshelf-hardcover-migration.mjs', ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

const withMockBookshelf = async (handler, testFn) => {
  const server = http.createServer(handler);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();

    return await testFn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const createMigrationDir = async () => {
  const migrationDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'bookshelf-hardcover-migration-')
  );

  await writeJson(path.join(migrationDir, 'migration-report.json'), {
    status: 'inventory_ready',
  });
  await writeJson(path.join(migrationDir, 'ebook-inventory.json'), {
    serviceType: 'ebook',
    books: [
      {
        Id: 1,
        Title: 'Example',
        AuthorName: 'Jane Doe',
        RootFolderPath: '/books',
        QualityProfileId: 1,
        MetadataProfileId: 2,
        Monitored: 1,
        Tags: '[7]',
      },
    ],
    editions: [],
    authors: [],
    qualityProfiles: [{ Id: 1, Name: 'eBook' }],
    metadataProfiles: [{ Id: 2, Name: 'Standard' }],
    tags: [{ Id: 7, Label: 'requested' }],
  });
  await writeJson(path.join(migrationDir, 'audiobook-inventory.json'), {
    serviceType: 'audiobook',
    books: [],
    editions: [],
    authors: [],
  });

  return migrationDir;
};

describe('bookshelf-hardcover-migration helpers', () => {
  it('builds source records with profile names and tag labels', () => {
    const source = buildSourceBook({
      inventory: {
        serviceType: 'ebook',
        qualityProfiles: [{ Id: 1, Name: 'eBook' }],
        metadataProfiles: [{ Id: 2, Name: 'Standard' }],
        tags: [{ Id: 7, Label: 'requested' }],
        editions: [],
        authors: [],
      },
      book: {
        Id: 10,
        Title: 'Example',
        AuthorName: 'Jane Doe',
        RootFolderPath: '/books',
        QualityProfileId: 1,
        MetadataProfileId: 2,
        Tags: '[7]',
      },
    });

    assert.deepEqual(source, {
      serviceType: 'ebook',
      id: 10,
      title: 'Example',
      author: 'Jane Doe',
      rootFolderPath: '/books',
      qualityProfileId: 1,
      qualityProfileName: 'eBook',
      metadataProfileId: 2,
      metadataProfileName: 'Standard',
      monitored: undefined,
      tags: '[7]',
      tagLabels: ['requested'],
      identifiers: [],
    });
  });

  it('builds source records from alternate Readarr export column names', () => {
    const source = buildSourceBook({
      inventory: {
        serviceType: 'ebook',
        qualityProfiles: [{ id: 3, name: 'Alternate Quality' }],
        metadataProfiles: [{ id: 4, name: 'Alternate Metadata' }],
        tags: [{ id: 8, label: 'object-tag' }],
        editions: [],
        authors: [{ id: 9, AuthorMetadataId: 10 }],
        authorMetadata: [{ id: 10, title: 'Fallback Author' }],
      },
      book: {
        id: 11,
        name: 'Alternate Title',
        AuthorId: 9,
        Path: '/alternate-books',
        quality_profile_id: 3,
        metadata_profile_id: 4,
        tags: '[{"id":8}]',
      },
    });

    assert.equal(source.title, 'Alternate Title');
    assert.equal(source.author, 'Fallback Author');
    assert.equal(source.rootFolderPath, '/alternate-books');
    assert.equal(source.qualityProfileId, 3);
    assert.equal(source.qualityProfileName, 'Alternate Quality');
    assert.equal(source.metadataProfileId, 4);
    assert.equal(source.metadataProfileName, 'Alternate Metadata');
    assert.deepEqual(source.tagLabels, ['object-tag']);
  });

  it('requires exact title and author for strict matches', () => {
    const decision = chooseStrictMatch({
      source: {
        title: 'Example',
        author: 'Jane Doe',
      },
      candidates: [
        {
          title: 'Example',
          author: {
            authorName: 'Jane Doe',
          },
        },
      ],
      identifier: '9780000000001',
    });

    assert.equal(decision.status, 'matched');
    assert.equal(decision.reason, 'identifier_exact_title_author');
  });

  it('blocks rebuild payloads missing required source fields', () => {
    const { rebuildPayload, rebuildBlocked } = buildRebuildArtifacts([
      {
        source: {
          title: 'Example',
          rootFolderPath: '',
          qualityProfileId: 0,
        },
        hardcover: {
          foreignBookId: 'book',
          author: {
            foreignAuthorId: 'author',
          },
          editions: [{ foreignEditionId: 'edition' }],
        },
      },
    ]);

    assert.equal(rebuildPayload.length, 0);
    assert.equal(rebuildBlocked.length, 1);
    assert.deepEqual(rebuildBlocked[0].missing, [
      'rootFolderPath',
      'qualityProfileId',
    ]);
  });

  it('parses tag IDs from arrays, JSON, and comma lists', () => {
    assert.deepEqual(parseTags([1, 2]), [1, 2]);
    assert.deepEqual(parseTags(['1', { id: 2 }, { TagId: 3 }]), [1, 2, 3]);
    assert.deepEqual(parseTags('[3,4]'), [3, 4]);
    assert.deepEqual(parseTags('[{"id":7},{"TagId":8}]'), [7, 8]);
    assert.deepEqual(parseTags('5, 6'), [5, 6]);
  });

  it('parses Retry-After header as seconds', () => {
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter('5'), 5000);
    assert.equal(parseRetryAfter('30'), 30000);
    assert.equal(parseRetryAfter('1'), 1000);
    assert.equal(parseRetryAfter(null), 0);
    assert.equal(parseRetryAfter(undefined), 0);
    assert.equal(parseRetryAfter(''), 0);
  });

  it('parses Retry-After header as HTTP-date', () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const ms = parseRetryAfter(futureDate);
    assert.ok(ms > 0, `Expected positive ms for future HTTP-date, got ${ms}`);
    // Should be roughly 10s (10000ms), allow ±5s tolerance for execution time
    assert.ok(ms <= 15000, `Expected <= 15000ms, got ${ms}`);
  });

  it('adds ±25% jitter to a delay', () => {
    const base = 10000;
    const results = Array.from({ length: 100 }, () => addJitter(base));
    const min = Math.min(...results);
    const max = Math.max(...results);

    // All results should be within 75%-125% of base (with rounding tolerance)
    assert.ok(min >= 7000, `Jitter minimum ${min} is below expected 7500`);
    assert.ok(max <= 13000, `Jitter maximum ${max} is above expected 12500`);

    // Results should actually vary (not constant)
    assert.ok(
      max - min > 0,
      `Jitter should produce variation: min=${min}, max=${max}`
    );
  });

  it('clamps jitter to non-negative values', () => {
    const base = 1;
    for (let i = 0; i < 50; i++) {
      const result = addJitter(base);
      assert.ok(
        result >= 0,
        `Jitter result ${result} is negative for base=${base}`
      );
    }
  });
});

describe('bookshelf-hardcover-migration CLI pipeline', () => {
  it('matches, rebuilds, applies, validates, and approves cutover with a Bookshelf-compatible API', async () => {
    const migrationDir = await createMigrationDir();
    const requests = [];
    const books = [];
    const tags = [];
    const handler = async (req, res) => {
      requests.push({ method: req.method, url: req.url });

      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Example',
              foreignBookId: 'hardcover-book',
              author: {
                foreignAuthorId: 'hardcover-author',
                authorName: 'Jane Doe',
              },
              editions: [
                {
                  foreignEditionId: 'hardcover-edition',
                  title: 'Example',
                  monitored: true,
                },
              ],
            },
          ])
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/qualityProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 11, name: 'eBook' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/metadataProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 22, name: 'Standard' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/rootfolder') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 33, path: '/books' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/tag') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(tags));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/tag') {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          const tag = { id: 44, ...JSON.parse(body) };
          tags.push(tag);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(tag));
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/book') {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          const addBook = JSON.parse(body);
          const book = { id: 55, title: addBook.title };
          books.push(book);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(book));
        });
        return;
      }

      if (req.method === 'PUT' && req.url === '/api/v1/book/monitor') {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          const monitorUpdate = JSON.parse(body);
          const ids = new Set(monitorUpdate.bookIds ?? []);
          for (const book of books) {
            if (ids.has(book.id)) {
              book.monitored = monitorUpdate.monitored;
            }
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(books.filter((book) => ids.has(book.id))));
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/config/development') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 1,
            metadataSource: 'https://hardcover.bookinfo.pro',
          })
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/book') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(books));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const env = {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
        HARDCOVER_VALIDATION_TERM: 'Example Jane Doe',
      };
      let result = await runCli([migrationDir], env);
      assert.equal(result.code, 0, result.stderr);

      result = await runCli(['--apply', migrationDir], env);
      assert.equal(result.code, 0, result.stderr);

      result = await runCli(['--validate', migrationDir], env);
      assert.equal(result.code, 0, result.stderr);

      result = await runCli(['--cutover-check', migrationDir], env);
      assert.equal(result.code, 0, result.stderr);
    });

    const rebuildPayload = await readJson(
      path.join(migrationDir, 'rebuild-payload.json')
    );
    const report = await readJson(
      path.join(migrationDir, 'migration-report.json')
    );
    const decision = await readJson(
      path.join(migrationDir, 'cutover-decision.json')
    );

    assert.equal(rebuildPayload[0].addBook.qualityProfileId, 1);
    assert.equal(rebuildPayload[0].addBook.tags.length, 0);
    assert.equal(report.status, 'validation_complete');
    assert.equal(report.applyCounts.applied, 1);
    assert.equal(report.validation.services[0].lookupTerm, 'Example Jane Doe');
    assert.equal(decision.ok, true);
    assert.ok(requests.some((request) => request.url === '/api/v1/tag'));
    assert.ok(
      requests.some((request) =>
        request.url.includes('/api/v1/book/lookup?term=Example+Jane+Doe')
      )
    );
  });

  it('resumes matching from service checkpoints', async () => {
    const migrationDir = await createMigrationDir();
    const ebookInventoryPath = path.join(migrationDir, 'ebook-inventory.json');
    const ebookInventory = await readJson(ebookInventoryPath);
    ebookInventory.books.push({
      Id: 2,
      Title: 'Second Example',
      AuthorName: 'Jane Doe',
      RootFolderPath: '/books',
      QualityProfileId: 1,
      MetadataProfileId: 2,
      Monitored: 1,
    });
    await writeJson(ebookInventoryPath, ebookInventory);
    await writeJson(path.join(migrationDir, 'ebook-match-checkpoint.json'), {
      version: 1,
      matched: [
        {
          source: {
            serviceType: 'ebook',
            id: 1,
            title: 'Example',
            author: 'Jane Doe',
            rootFolderPath: '/books',
            qualityProfileId: 1,
            metadataProfileId: 2,
            monitored: 1,
            identifiers: [],
          },
          lookupTerm: 'Example Jane Doe',
          reason: 'title_author_exact',
          hardcover: {
            title: 'Example',
            foreignBookId: 'hardcover-book-1',
            author: {
              foreignAuthorId: 'hardcover-author',
              authorName: 'Jane Doe',
            },
            editions: [{ foreignEditionId: 'hardcover-edition-1' }],
          },
        },
      ],
      unmatched: [],
      ambiguous: [],
    });

    const lookupTerms = [];
    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        lookupTerms.push(url.searchParams.get('term'));
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Second Example',
              foreignBookId: 'hardcover-book-2',
              author: {
                foreignAuthorId: 'hardcover-author',
                authorName: 'Jane Doe',
              },
              editions: [{ foreignEditionId: 'hardcover-edition-2' }],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const result = await runCli([migrationDir], {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
      });
      assert.equal(result.code, 0, result.stderr);
    });

    const matched = await readJson(
      path.join(migrationDir, 'matched-books.json')
    );
    assert.equal(matched.length, 2);
    assert.deepEqual(lookupTerms, ['Second Example Jane Doe']);
  });

  it('preserves applied books when regenerating reports for resume', async () => {
    const migrationDir = await createMigrationDir();
    const appliedBook = {
      source: { serviceType: 'ebook', id: 1 },
      serviceType: 'ebook',
      hardcoverBookId: 55,
      title: 'Example',
    };
    await writeJson(path.join(migrationDir, 'applied-books.json'), [
      appliedBook,
    ]);
    await writeJson(path.join(migrationDir, 'apply-failures.json'), [
      { source: { serviceType: 'ebook', id: 2 }, reason: 'previous failure' },
    ]);

    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Example',
              foreignBookId: 'hardcover-book',
              author: {
                foreignAuthorId: 'hardcover-author',
                authorName: 'Jane Doe',
              },
              editions: [{ foreignEditionId: 'hardcover-edition' }],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const result = await runCli([migrationDir], {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
      });
      assert.equal(result.code, 0, result.stderr);
    });

    assert.deepEqual(
      await readJson(path.join(migrationDir, 'applied-books.json')),
      [appliedBook]
    );
    assert.equal(
      (await readJson(path.join(migrationDir, 'apply-failures.json')))[0]
        .reason,
      'previous failure'
    );
  });

  it('retries validation lookup before failing a Hardcover target', async () => {
    const migrationDir = await createMigrationDir();
    await writeJson(path.join(migrationDir, 'applied-books.json'), []);
    let lookupCount = 0;
    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/config/development') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 1,
            metadataSource: 'https://hardcover.bookinfo.pro',
          })
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/book') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        lookupCount++;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify(lookupCount === 1 ? [] : [{ title: 'Example' }])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const result = await runCli(['--validate', migrationDir], {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
        HARDCOVER_VALIDATION_LOOKUP_RETRIES: '1',
        HARDCOVER_VALIDATION_LOOKUP_RETRY_DELAY_MS: '1',
      });
      assert.equal(result.code, 0, result.stderr);
    });

    const report = await readJson(
      path.join(migrationDir, 'migration-report.json')
    );
    assert.equal(report.status, 'validation_complete');
    assert.equal(report.validation.ok, true);
    assert.ok(lookupCount >= 2);
  });

  it('uses softcover lookup metadata to recover a Hardcover add payload', async () => {
    const migrationDir = await createMigrationDir();
    const appliedBooks = [];
    let hardcoverLookupTerms = [];

    const hardcoverHandler = async (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/qualityProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 11, name: 'eBook' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/metadataProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 22, name: 'Standard' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/rootfolder') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 33, path: '/books' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/tag') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const term = url.searchParams.get('term') ?? '';
        hardcoverLookupTerms.push(term);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify(
            term.includes('9780000000002')
              ? [
                  {
                    title: 'Recovered Title',
                    foreignBookId: 'hardcover-good',
                    author: {
                      foreignAuthorId: 'hardcover-author',
                      authorName: 'Jane Doe',
                    },
                    editions: [
                      {
                        foreignEditionId: 'hardcover-edition-good',
                        isbn13: '9780000000002',
                        title: 'Recovered Title',
                      },
                    ],
                  },
                ]
              : []
          )
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/book') {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          const addBook = JSON.parse(body);

          if (addBook.foreignBookId === 'hardcover-bad') {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify([
                {
                  propertyName: 'GoodreadsId',
                  errorMessage: 'A book with this ID was not found',
                  attemptedValue: 'hardcover-bad',
                },
              ])
            );
            return;
          }

          const book = {
            id: 77,
            title: addBook.title,
            foreignBookId: addBook.foreignBookId,
          };
          appliedBooks.push(book);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(book));
        });
        return;
      }

      if (req.method === 'PUT' && req.url === '/api/v1/book/monitor') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/book') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(appliedBooks));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    const softcoverHandler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Recovered Title',
              authorTitle: 'doe, jane Recovered Title',
              foreignBookId: 'softcover-book',
              foreignEditionId: 'softcover-edition',
              editions: [{ isbn13: '9780000000002' }],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await writeJson(path.join(migrationDir, 'rebuild-payload.json'), [
      {
        serviceType: 'ebook',
        source: {
          serviceType: 'ebook',
          id: 1,
          title: 'Original Title',
          author: 'Jane Doe',
          rootFolderPath: '/books',
          qualityProfileId: 1,
          qualityProfileName: 'eBook',
          metadataProfileId: 1,
          metadataProfileName: 'Standard',
          monitored: 1,
          identifiers: ['9780000000001'],
        },
        lookupTerm: 'Original Title Jane Doe',
        addBook: {
          title: 'Original Title',
          foreignBookId: 'hardcover-bad',
          author: {
            foreignAuthorId: 'hardcover-author',
            authorName: 'Jane Doe',
          },
          editions: [{ foreignEditionId: 'hardcover-edition-bad' }],
          qualityProfileId: 1,
          metadataProfileId: 1,
          rootFolderPath: '/books',
          monitored: true,
          tags: [],
          addOptions: { searchForNewBook: false },
        },
      },
    ]);

    await withMockBookshelf(softcoverHandler, async (softcoverBaseUrl) => {
      await withMockBookshelf(hardcoverHandler, async (hardcoverBaseUrl) => {
        const result = await runCli(['--apply', migrationDir], {
          HARDCOVER_EBOOK_API_KEY: 'key',
          HARDCOVER_EBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_AUDIOBOOK_API_KEY: 'key',
          HARDCOVER_AUDIOBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_SOFTCOVER_EBOOK_BASE_URL: softcoverBaseUrl,
          HARDCOVER_RATE_LIMIT_BATCH_SIZE: '100',
        });
        assert.equal(result.code, 0, result.stderr);
      });
    });

    const report = await readJson(
      path.join(migrationDir, 'migration-report.json')
    );
    assert.equal(report.applyCounts.applied, 1);
    assert.equal(report.applyCounts.failed, 0);
    assert.equal(appliedBooks[0].foreignBookId, 'hardcover-good');
    assert.ok(hardcoverLookupTerms.includes('isbn:9780000000002'));
  });

  it('uses OpenLibrary metadata to recover a native Hardcover add payload', async () => {
    const migrationDir = await createMigrationDir();
    const appliedBooks = [];
    const hardcoverLookupTerms = [];

    const hardcoverHandler = async (req, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/qualityProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 11, name: 'eBook' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/metadataProfile') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 22, name: 'Standard' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/rootfolder') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 33, path: '/books' }]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/tag') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const term = url.searchParams.get('term') ?? '';
        hardcoverLookupTerms.push(term);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify(
            term.includes('9780000000003')
              ? [
                  {
                    title: 'Open Recovered Title',
                    foreignBookId: 'hardcover-openlibrary-good',
                    author: {
                      foreignAuthorId: 'hardcover-openlibrary-author',
                      authorName: 'Jane Doe',
                    },
                    editions: [
                      {
                        foreignEditionId: 'hardcover-openlibrary-edition',
                        isbn13: '9780000000003',
                        title: 'Open Recovered Title',
                      },
                    ],
                  },
                ]
              : []
          )
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/book') {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          const addBook = JSON.parse(body);

          if (addBook.foreignBookId === 'hardcover-bad') {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify([
                {
                  propertyName: 'GoodreadsId',
                  errorMessage: 'A book with this ID was not found',
                  attemptedValue: 'hardcover-bad',
                },
              ])
            );
            return;
          }

          const book = {
            id: 88,
            title: addBook.title,
            foreignBookId: addBook.foreignBookId,
          };
          appliedBooks.push(book);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(book));
        });
        return;
      }

      if (req.method === 'PUT' && req.url === '/api/v1/book/monitor') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/book') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(appliedBooks));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    const openLibraryHandler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/search.json')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            numFound: 1,
            start: 0,
            docs: [
              {
                key: '/works/OL1W',
                title: 'Open Recovered Title',
                author_name: ['Jane Doe'],
                isbn: ['9780000000003'],
                edition_key: ['OL1M'],
              },
            ],
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await writeJson(path.join(migrationDir, 'rebuild-payload.json'), [
      {
        serviceType: 'ebook',
        source: {
          serviceType: 'ebook',
          id: 1,
          title: 'Original Title',
          author: 'Jane Doe',
          rootFolderPath: '/books',
          qualityProfileId: 1,
          qualityProfileName: 'eBook',
          metadataProfileId: 1,
          metadataProfileName: 'Standard',
          monitored: 1,
          identifiers: ['9780000000001'],
        },
        lookupTerm: 'Original Title Jane Doe',
        addBook: {
          title: 'Original Title',
          foreignBookId: 'hardcover-bad',
          author: {
            foreignAuthorId: 'hardcover-author',
            authorName: 'Jane Doe',
          },
          editions: [{ foreignEditionId: 'hardcover-edition-bad' }],
          qualityProfileId: 1,
          metadataProfileId: 1,
          rootFolderPath: '/books',
          monitored: true,
          tags: [],
          addOptions: { searchForNewBook: false },
        },
      },
    ]);

    await withMockBookshelf(openLibraryHandler, async (openLibraryBaseUrl) => {
      await withMockBookshelf(hardcoverHandler, async (hardcoverBaseUrl) => {
        const result = await runCli(['--apply', migrationDir], {
          HARDCOVER_EBOOK_API_KEY: 'key',
          HARDCOVER_EBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_AUDIOBOOK_API_KEY: 'key',
          HARDCOVER_AUDIOBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_OPENLIBRARY_BASE_URL: openLibraryBaseUrl,
          HARDCOVER_RATE_LIMIT_BATCH_SIZE: '100',
        });
        assert.equal(result.code, 0, result.stderr);
      });
    });

    const report = await readJson(
      path.join(migrationDir, 'migration-report.json')
    );
    assert.equal(report.applyCounts.applied, 1);
    assert.equal(report.applyCounts.failed, 0);
    assert.equal(appliedBooks[0].foreignBookId, 'hardcover-openlibrary-good');
    assert.ok(hardcoverLookupTerms.includes('isbn:9780000000003'));
  });

  it('uses OpenLibrary metadata to move unmatched inventory into the native rebuild payload', async () => {
    const migrationDir = await createMigrationDir();

    const hardcoverHandler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const term = url.searchParams.get('term') ?? '';
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify(
            term.includes('9780000000004')
              ? [
                  {
                    title: 'Open Inventory Title',
                    foreignBookId: 'hardcover-openlibrary-inventory',
                    author: {
                      foreignAuthorId: 'hardcover-openlibrary-author',
                      authorName: 'Jane Doe',
                    },
                    editions: [
                      {
                        foreignEditionId: 'hardcover-openlibrary-edition',
                        isbn13: '9780000000004',
                        title: 'Open Inventory Title',
                      },
                    ],
                  },
                ]
              : []
          )
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    const openLibraryHandler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/search.json')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            numFound: 1,
            start: 0,
            docs: [
              {
                key: '/works/OL2W',
                title: 'Open Inventory Title',
                author_name: ['Jane Doe'],
                isbn: ['9780000000004'],
              },
            ],
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(openLibraryHandler, async (openLibraryBaseUrl) => {
      await withMockBookshelf(hardcoverHandler, async (hardcoverBaseUrl) => {
        const result = await runCli([migrationDir], {
          HARDCOVER_EBOOK_API_KEY: 'key',
          HARDCOVER_EBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_AUDIOBOOK_API_KEY: 'key',
          HARDCOVER_AUDIOBOOK_BASE_URL: hardcoverBaseUrl,
          HARDCOVER_OPENLIBRARY_BASE_URL: openLibraryBaseUrl,
          HARDCOVER_RATE_LIMIT_BATCH_SIZE: '100',
        });
        assert.equal(result.code, 0, result.stderr);
      });
    });

    const matched = await readJson(
      path.join(migrationDir, 'matched-books.json')
    );
    const unmatched = await readJson(
      path.join(migrationDir, 'unmatched-books.json')
    );
    const rebuildPayload = await readJson(
      path.join(migrationDir, 'rebuild-payload.json')
    );

    assert.equal(matched.length, 1);
    assert.equal(unmatched.length, 0);
    assert.equal(matched[0].reason, 'openlibrary_recovery');
    assert.equal(
      rebuildPayload[0].addBook.foreignBookId,
      'hardcover-openlibrary-inventory'
    );
  });

  it('reconciles local shadow records to native Hardcover IDs without duplicating', async () => {
    const migrationDir = await createMigrationDir();
    const targetConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'bookshelf-hardcover-target-')
    );
    const dbPath = path.join(targetConfigDir, 'readarr.db');

    await runSqlite(
      dbPath,
      `
      CREATE TABLE AuthorMetadata (
        Id INTEGER PRIMARY KEY,
        ForeignAuthorId TEXT UNIQUE,
        TitleSlug TEXT,
        Name TEXT,
        SortName TEXT,
        NameLastFirst TEXT,
        SortNameLastFirst TEXT
      );
      CREATE TABLE Books (
        Id INTEGER PRIMARY KEY,
        AuthorMetadataId INTEGER,
        ForeignBookId TEXT UNIQUE,
        TitleSlug TEXT,
        Title TEXT,
        CleanTitle TEXT,
        LastInfoSync TEXT
      );
      CREATE TABLE Editions (
        Id INTEGER PRIMARY KEY,
        BookId INTEGER,
        ForeignEditionId TEXT UNIQUE,
        Isbn13 TEXT,
        Title TEXT,
        TitleSlug TEXT
      );
      INSERT INTO AuthorMetadata
        (Id, ForeignAuthorId, TitleSlug, Name, SortName, NameLastFirst, SortNameLastFirst)
      VALUES
        (1, 'local:ebook:jane-doe', 'local-jane-doe', 'Jane Doe', 'jane doe', 'Jane Doe', 'jane doe');
      INSERT INTO Books
        (Id, AuthorMetadataId, ForeignBookId, TitleSlug, Title, CleanTitle, LastInfoSync)
      VALUES
        (10, 1, 'local:ebook:1', 'local-ebook-1', 'Original Title', 'original title', '2026-01-01T00:00:00.000Z');
      INSERT INTO Editions
        (Id, BookId, ForeignEditionId, Isbn13, Title, TitleSlug)
      VALUES
        (20, 10, 'local:ebook:1:edition', NULL, 'Original Title', 'local-ebook-1-edition');
      `
    );

    await writeJson(path.join(migrationDir, 'applied-books.json'), [
      {
        source: {
          serviceType: 'ebook',
          id: 1,
          title: 'Original Title',
          author: 'Jane Doe',
          identifiers: ['9780000000005'],
        },
        serviceType: 'ebook',
        hardcoverBookId: 10,
        title: 'Original Title',
        foreignBookId: 'local:ebook:1',
        localDbImport: true,
      },
    ]);

    const hardcoverHandler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Original Title',
              foreignBookId: 'hardcover-native-book',
              author: {
                foreignAuthorId: 'hardcover-native-author',
                authorName: 'Jane Doe',
              },
              editions: [
                {
                  foreignEditionId: 'hardcover-native-edition',
                  isbn13: '9780000000005',
                  title: 'Original Title',
                },
              ],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(hardcoverHandler, async (hardcoverBaseUrl) => {
      const result = await runCli(['--reconcile-local', migrationDir], {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: hardcoverBaseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: hardcoverBaseUrl,
        HARDCOVER_EBOOK_CONFIG_DIR: targetConfigDir,
        HARDCOVER_OPENLIBRARY_RECOVERY: 'false',
      });
      assert.equal(result.code, 0, result.stderr);
    });

    const foreignBookId = (
      await runSqlite(dbPath, 'select ForeignBookId from Books where Id = 10;')
    ).trim();
    const foreignAuthorId = (
      await runSqlite(
        dbPath,
        'select ForeignAuthorId from AuthorMetadata where Id = 1;'
      )
    ).trim();
    const foreignEditionId = (
      await runSqlite(
        dbPath,
        'select ForeignEditionId from Editions where BookId = 10;'
      )
    ).trim();
    const reconciliation = await readJson(
      path.join(migrationDir, 'local-reconciliation-report.json')
    );
    const applied = await readJson(
      path.join(migrationDir, 'applied-books.json')
    );

    assert.equal(foreignBookId, 'hardcover-native-book');
    assert.equal(foreignAuthorId, 'hardcover-native-author');
    assert.equal(foreignEditionId, 'hardcover-native-edition');
    assert.equal(reconciliation[0].ok, true);
    assert.equal(applied[0].localDbImport, false);
    assert.equal(applied[0].reconciledFromLocal, true);
  });

  it('blocks cutover when validation has not completed cleanly', async () => {
    const migrationDir = await createMigrationDir();
    await writeJson(path.join(migrationDir, 'migration-report.json'), {
      status: 'apply_incomplete',
      validation: { ok: false },
      applyCounts: { applied: 0, failed: 1 },
    });
    await writeJson(path.join(migrationDir, 'apply-failures.json'), [
      { reason: 'target missing root folder' },
    ]);
    await writeJson(path.join(migrationDir, 'rebuild-blocked.json'), []);
    await writeJson(path.join(migrationDir, 'validation-report.json'), [
      { serviceType: 'ebook', ok: false },
    ]);

    const result = await runCli(['--cutover-check', migrationDir]);
    const decision = await readJson(
      path.join(migrationDir, 'cutover-decision.json')
    );

    assert.notEqual(result.code, 0);
    assert.equal(decision.ok, false);
    assert.deepEqual(decision.reasons, [
      'migration_status_apply_incomplete',
      'validation_not_ok',
      'apply_failures_present',
      'failed_service_validation_present',
    ]);
  });
});

describe('bookshelf-hardcover-migration rate-limit handling', () => {
  it('retries on 429 and succeeds after rate limit clears', async () => {
    const migrationDir = await createMigrationDir();
    let lookupCount = 0;
    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        lookupCount++;
        // First 2 requests are rate limited, 3rd succeeds
        if (lookupCount <= 2) {
          res.statusCode = 429;
          res.end('rate limited');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Example',
              foreignBookId: 'hardcover-book',
              author: {
                foreignAuthorId: 'hardcover-author',
                authorName: 'Jane Doe',
              },
              editions: [
                {
                  foreignEditionId: 'hardcover-edition',
                  title: 'Example',
                  monitored: true,
                },
              ],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const env = {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
        HARDCOVER_RATE_LIMIT_MAX_RETRIES: '5',
        HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS: '100',
      };
      const result = await runCli([migrationDir], env);
      assert.equal(result.code, 0, result.stderr);
    });

    const matched = await readJson(
      path.join(migrationDir, 'matched-books.json')
    );
    assert.equal(matched.length, 1);
    assert.equal(matched[0].hardcover.foreignBookId, 'hardcover-book');
  });

  it('fails after exhausting max retries on persistent 429', async () => {
    const migrationDir = await createMigrationDir();
    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        res.statusCode = 429;
        res.end('rate limited');
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const env = {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
        HARDCOVER_RATE_LIMIT_MAX_RETRIES: '1',
        HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS: '50',
        HARDCOVER_OPENLIBRARY_RECOVERY: 'false',
      };
      const result = await runCli([migrationDir], env);
      // Should exit 0 because unmatched books are not fatal
      assert.equal(result.code, 0, result.stderr);
    });

    const unmatched = await readJson(
      path.join(migrationDir, 'unmatched-books.json')
    );
    assert.equal(unmatched.length, 1);
    assert.ok(
      unmatched[0].reason === 'lookup_failed' ||
        unmatched[0].reason === 'missing_identifier_or_author'
    );
  });

  it('respects Retry-After header on 429 responses', async () => {
    const migrationDir = await createMigrationDir();
    let lookupCount = 0;
    const retryAfterSent = [];
    const handler = async (req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/api/v1/book/lookup')) {
        lookupCount++;
        if (lookupCount <= 1) {
          res.statusCode = 429;
          res.setHeader('Retry-After', '1');
          retryAfterSent.push(true);
          res.end('rate limited');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              title: 'Example',
              foreignBookId: 'hardcover-book',
              author: {
                foreignAuthorId: 'hardcover-author',
                authorName: 'Jane Doe',
              },
              editions: [
                {
                  foreignEditionId: 'hardcover-edition',
                  title: 'Example',
                  monitored: true,
                },
              ],
            },
          ])
        );
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    };

    await withMockBookshelf(handler, async (baseUrl) => {
      const env = {
        HARDCOVER_EBOOK_API_KEY: 'key',
        HARDCOVER_EBOOK_BASE_URL: baseUrl,
        HARDCOVER_AUDIOBOOK_API_KEY: 'key',
        HARDCOVER_AUDIOBOOK_BASE_URL: baseUrl,
        HARDCOVER_RATE_LIMIT_MAX_RETRIES: '3',
        HARDCOVER_RATE_LIMIT_BACKOFF_BASE_MS: '50',
      };
      const result = await runCli([migrationDir], env);
      assert.equal(result.code, 0, result.stderr);
    });

    const matched = await readJson(
      path.join(migrationDir, 'matched-books.json')
    );
    assert.equal(matched.length, 1);
    assert.ok(
      retryAfterSent.length > 0,
      'Retry-After header should have been sent'
    );
  });
});
