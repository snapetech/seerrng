import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { NormalizeExternalMediaIds1781400000000 } from './1781400000000-NormalizeExternalMediaIds';

const createDataSource = () =>
  new DataSource({
    type: 'sqlite',
    database: ':memory:',
  });

test('SQLite external ID normalization migration canonicalizes dirty historical rows', async () => {
  const dataSource = await createDataSource().initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY, "mediaType" varchar, "mbId" varchar, "status" integer)`
    );
    await queryRunner.query(
      `CREATE TABLE "watchlist" ("id" integer PRIMARY KEY, "mediaType" varchar, "tmdbId" integer, "mbId" varchar, "externalId" varchar, "requestedById" integer)`
    );
    await queryRunner.query(
      `CREATE TABLE "blocklist" ("id" integer PRIMARY KEY, "mediaType" varchar, "tmdbId" integer, "externalId" varchar, "externalProvider" varchar)`
    );
    await queryRunner.query(
      `CREATE TABLE "media_identifier" ("id" integer PRIMARY KEY, "mediaId" integer, "provider" varchar, "value" varchar)`
    );
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY, "mediaId" integer)`
    );

    await queryRunner.query(
      `INSERT INTO "media" VALUES
        (1, 'music', ' ABC ', 5),
        (2, 'book', NULL, 5),
        (3, 'book', NULL, 1),
        (4, 'book', NULL, 1)`
    );
    await queryRunner.query(`INSERT INTO "media_request" VALUES (1, 4)`);
    await queryRunner.query(
      `INSERT INTO "watchlist" VALUES
        (1, 'music', NULL, ' ABC ', NULL, 7),
        (2, 'music', NULL, 'abc', NULL, 7),
        (3, 'book', NULL, NULL, '/WORKS/ol123w', 7),
        (4, 'book', NULL, NULL, 'OL123W', 7)`
    );
    await queryRunner.query(
      `INSERT INTO "blocklist" VALUES
        (1, 'music', 0, ' ABC ', NULL),
        (2, 'music', 0, 'abc', NULL),
        (3, 'book', 0, '978-0-441-47812-5', 'isbn'),
        (4, 'book', 0, '9780441478125', 'isbn'),
        (5, 'book', 0, '/WORKS/ol123w', 'openlibrary'),
        (6, 'book', 0, 'OL123W', 'openlibrary'),
        (7, 'book', 0, '/BOOKS/ol5m', 'openlibrary_edition'),
        (8, 'book', 0, 'OL5M', 'openlibrary_edition')`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" VALUES
        (1, 1, 'musicbrainz', ' ABC '),
        (2, 1, 'musicbrainz', 'abc'),
        (3, 2, 'openlibrary', '/WORKS/ol123w'),
        (4, 2, 'openlibrary', 'OL123W'),
        (5, 2, 'openlibrary_edition', '/BOOKS/ol5m'),
        (6, 2, 'openlibrary_edition', 'OL5M'),
        (7, 2, 'isbn', '978-0-441-47812-5'),
        (8, 2, 'isbn', '9780441478125'),
        (9, 3, 'isbn', '978-1-111-11111-1'),
        (10, 4, 'isbn', '9781111111111')`
    );

    await new NormalizeExternalMediaIds1781400000000().up(queryRunner);

    assert.deepEqual(await queryRunner.query(`SELECT "mbId" FROM "media"`), [
      { mbId: 'abc' },
      { mbId: null },
      { mbId: null },
      { mbId: null },
    ]);
    assert.deepEqual(
      await queryRunner.query(
        `SELECT COALESCE("mbId", "externalId") AS "id" FROM "watchlist" ORDER BY "id"`
      ),
      [{ id: 'OL123W' }, { id: 'abc' }]
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "externalId" FROM "blocklist" ORDER BY "externalId"`
      ),
      [
        { externalId: '9780441478125' },
        { externalId: 'OL123W' },
        { externalId: 'OL5M' },
        { externalId: 'abc' },
      ]
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "value" FROM "media_identifier" ORDER BY "value"`
      ),
      [
        { value: '9780441478125' },
        { value: '9781111111111' },
        { value: 'OL123W' },
        { value: 'OL5M' },
        { value: 'abc' },
      ]
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "mediaId" FROM "media_identifier" WHERE "value" = '9781111111111'`
      ),
      [{ mediaId: 4 }]
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
