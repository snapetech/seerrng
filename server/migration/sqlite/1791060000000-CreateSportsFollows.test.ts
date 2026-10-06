import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateSportsFollows1791060000000 } from './1791060000000-CreateSportsFollows';

test('creates unique per-user team follows', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new CreateSportsFollows1791060000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" ("id") VALUES (1)');
    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "sports_follow" ("userId", "dataset", "team") VALUES (1, 'nfl', 'Denver Broncos')`
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "sports_follow" ("userId", "dataset", "team") VALUES (1, 'nfl', 'Denver Broncos')`
      )
    );
    await queryRunner.query('DELETE FROM "user" WHERE "id" = 1');
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS "count" FROM "sports_follow"'
    );
    assert.equal(count, 0);
    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasTable('sports_follow'), false);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
