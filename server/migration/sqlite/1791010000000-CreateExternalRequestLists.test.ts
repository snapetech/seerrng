import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateExternalRequestLists1791010000000 } from './1791010000000-CreateExternalRequestLists';

test('external request list migration creates and removes its source table', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new CreateExternalRequestLists1791010000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await migration.up(queryRunner);

    assert.equal(await queryRunner.hasTable('external_request_list'), true);
    assert.equal(
      await queryRunner.hasColumn('external_request_list', 'processedItemIds'),
      true
    );
    assert.equal(
      await queryRunner.hasColumn('external_request_list', 'lastSyncError'),
      true
    );

    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasTable('external_request_list'), false);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
