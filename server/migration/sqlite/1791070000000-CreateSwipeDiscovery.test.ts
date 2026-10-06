import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateSwipeDiscovery1791070000000 } from './1791070000000-CreateSwipeDiscovery';

test('creates per-user swipe decisions and profiles', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new CreateSwipeDiscovery1791070000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" ("id") VALUES (1)');
    await migration.up(queryRunner);

    const insert = `INSERT INTO "swipe_decision" ("userId", "mediaType", "itemId", "title", "decision") VALUES (1, 'movie', '603', 'The Matrix', 'want')`;
    await queryRunner.query(insert);
    await assert.rejects(queryRunner.query(insert));
    await queryRunner.query(
      'INSERT INTO "swipe_profile" ("userId") VALUES (1)'
    );
    const [profile] = await queryRunner.query(
      'SELECT "tasteNotes", "seriesRequest", "bookFormat" FROM "swipe_profile"'
    );
    assert.deepEqual(profile, {
      tasteNotes: '',
      seriesRequest: 'first-season',
      bookFormat: 'audiobook',
    });

    await queryRunner.query('DELETE FROM "user" WHERE "id" = 1');
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS "count" FROM "swipe_decision"'
    );
    assert.equal(count, 0);

    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasTable('swipe_decision'), false);
    assert.equal(await queryRunner.hasTable('swipe_profile'), false);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
