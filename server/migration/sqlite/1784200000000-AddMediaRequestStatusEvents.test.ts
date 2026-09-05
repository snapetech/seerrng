import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddMediaRequestStatusEvents1784200000000 } from './1784200000000-AddMediaRequestStatusEvents';

test('SQLite request status event migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await new AddMediaRequestStatusEvents1784200000000().up(queryRunner);
    const table = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_request_status_event'`
    );
    assert.equal(table.length, 1);

    await queryRunner.query(
      `INSERT INTO "media_request_status_event" ("requestId", "requestedById", "mediaId", "mediaType", "stage", "fingerprint") VALUES (?, ?, ?, ?, ?, ?)`,
      [1, 2, 3, 'movie', 'requested', 'requested:0:unknown:unknown:unknown:0']
    );
    await assert.rejects(() =>
      queryRunner.query(
        `INSERT INTO "media_request_status_event" ("requestId", "requestedById", "mediaId", "mediaType", "stage", "fingerprint") VALUES (?, ?, ?, ?, ?, ?)`,
        [1, 2, 3, 'movie', 'requested', 'requested:0:unknown:unknown:unknown:0']
      )
    );

    await new AddMediaRequestStatusEvents1784200000000().down(queryRunner);
    const removed = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_request_status_event'`
    );
    assert.equal(removed.length, 0);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
