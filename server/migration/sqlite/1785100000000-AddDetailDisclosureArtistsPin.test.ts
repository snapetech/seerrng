import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddDetailDisclosureArtistsPin1785100000000 } from './1785100000000-AddDetailDisclosureArtistsPin';

test('adds and removes the persistent Artists disclosure pin', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings" ("userId") VALUES (1)`
    );

    const migration = new AddDetailDisclosureArtistsPin1785100000000();
    await migration.up(queryRunner);
    assert.deepStrictEqual(
      await queryRunner.query(
        `SELECT "detailDisclosureArtistsPinned" FROM "user_settings" WHERE "userId" = 1`
      ),
      [{ detailDisclosureArtistsPinned: 0 }]
    );

    await migration.down(queryRunner);
    const remainingColumns = (
      await queryRunner.query(`PRAGMA table_info("user_settings")`)
    ).map((column: { name: string }) => column.name);
    assert.deepStrictEqual(remainingColumns, ['id', 'userId']);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
