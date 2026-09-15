import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddDetailDisclosurePins1785000000000 } from './1785000000000-AddDetailDisclosurePins';

test('SQLite detail disclosure pins default to unpinned and migrate reversibly', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddDetailDisclosurePins1785000000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings" ("userId") VALUES (1)`
    );

    await migration.up(queryRunner);
    assert.deepStrictEqual(
      await queryRunner.query(
        `SELECT "detailDisclosureCastPinned", "detailDisclosureCrewPinned", "detailDisclosureSubjectTagsPinned" FROM "user_settings" WHERE "userId" = 1`
      ),
      [
        {
          detailDisclosureCastPinned: 0,
          detailDisclosureCrewPinned: 0,
          detailDisclosureSubjectTagsPinned: 0,
        },
      ]
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
