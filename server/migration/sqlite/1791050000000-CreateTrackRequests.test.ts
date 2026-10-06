import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateTrackRequests1791050000000 } from './1791050000000-CreateTrackRequests';

test('creates track requests owned by users', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new CreateTrackRequests1791050000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" ("id") VALUES (1)');
    await migration.up(queryRunner);
    assert.equal(await queryRunner.hasTable('track_request'), true);

    await queryRunner.query(`
      INSERT INTO "track_request" ("requestedById", "artist", "title")
      VALUES (1, 'Band', 'Single')
    `);
    const [row] = await queryRunner.query(
      'SELECT "status", "source", "searchCount", "wishlistItemId" FROM "track_request"'
    );
    assert.deepEqual(row, {
      status: 'pending',
      source: 'manual',
      searchCount: 0,
      wishlistItemId: null,
    });

    await queryRunner.query('DELETE FROM "user" WHERE "id" = 1');
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS "count" FROM "track_request"'
    );
    assert.equal(count, 0);

    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasTable('track_request'), false);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
