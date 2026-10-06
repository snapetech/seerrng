import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateRecordingRequests1791040000000 } from './1791040000000-CreateRecordingRequests';

test('creates recording requests owned by users', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new CreateRecordingRequests1791040000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" ("id") VALUES (1)');
    await migration.up(queryRunner);
    assert.equal(await queryRunner.hasTable('recording_request'), true);

    await queryRunner.query(`
      INSERT INTO "recording_request" ("requestedById", "kind", "title", "channelId")
      VALUES (1, 'airing', 'Evening News', 'news.1')
    `);
    const [row] = await queryRunner.query(
      'SELECT "status", "completedCount", "failedCount", "tunerrRuleId" FROM "recording_request"'
    );
    assert.deepEqual(row, {
      status: 'pending',
      completedCount: 0,
      failedCount: 0,
      tunerrRuleId: null,
    });

    await queryRunner.query('DELETE FROM "user" WHERE "id" = 1');
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS "count" FROM "recording_request"'
    );
    assert.equal(count, 0);

    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasTable('recording_request'), false);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
