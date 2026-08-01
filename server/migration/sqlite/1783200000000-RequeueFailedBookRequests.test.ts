import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { RequeueFailedBookRequests1783200000000 } from './1783200000000-RequeueFailedBookRequests';

test('SQLite failed book request migration seeds only missing failed books', async () => {
  const dataSource = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new RequeueFailedBookRequests1783200000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "type" varchar NOT NULL, "status" integer NOT NULL)`
    );
    await queryRunner.query(
      `CREATE TABLE "request_dispatch_outbox" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestId" integer NOT NULL UNIQUE, "attempts" integer NOT NULL DEFAULT (0), "nextAttemptAt" datetime)`
    );
    await queryRunner.query(
      `INSERT INTO "media_request" ("id", "type", "status") VALUES (1, 'book', 4), (2, 'book', 2), (3, 'movie', 4), (4, 'book', 4)`
    );
    await queryRunner.query(
      `INSERT INTO "request_dispatch_outbox" ("requestId", "attempts") VALUES (4, 7)`
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "requestId", "attempts" FROM "request_dispatch_outbox" ORDER BY "requestId"`
      ),
      [
        { requestId: 1, attempts: 0 },
        { requestId: 4, attempts: 7 },
      ]
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
