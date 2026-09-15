import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddScopedDetailDisclosurePins1785200000000 } from './1785200000000-AddScopedDetailDisclosurePins';

test('SQLite scoped detail disclosure pins migrate reversibly', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer)`
    );
    const migration = new AddScopedDetailDisclosurePins1785200000000();

    await migration.up(queryRunner);
    const columnsAfterUp = await queryRunner.query(
      `PRAGMA table_info("user_settings")`
    );
    assert.equal(
      columnsAfterUp.some(
        (column: { name: string }) => column.name === 'detailDisclosurePins'
      ),
      true
    );

    await migration.down(queryRunner);
    const columnsAfterDown = await queryRunner.query(
      `PRAGMA table_info("user_settings")`
    );
    assert.equal(
      columnsAfterDown.some(
        (column: { name: string }) => column.name === 'detailDisclosurePins'
      ),
      false
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
