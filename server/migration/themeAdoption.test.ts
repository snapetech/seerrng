import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AdoptSeerrngTheme1791080000000 as PostgresAdoption } from './postgres/1791080000000-AdoptSeerrngTheme';
import { AdoptSeerrngTheme1791080000000 as SqliteAdoption } from './sqlite/1791080000000-AdoptSeerrngTheme';

const createLegacyDatabase = async (
  migrations = [] as (typeof SqliteAdoption)[]
) => {
  const database = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    migrations,
  }).initialize();
  await database.query(
    'CREATE TABLE "user_settings" ("id" integer PRIMARY KEY, "advancedThemeOverrides" text, "locale" varchar)'
  );
  return database;
};

test('both portable adoption migrations default new settings to SeerrNG', async () => {
  // Execute both portable SQL implementations on isolated SQLite. This does
  // not claim a PostgreSQL service/integration run.
  for (const Migration of [SqliteAdoption, PostgresAdoption]) {
    const database = await createLegacyDatabase();
    const runner = database.createQueryRunner();
    try {
      await new Migration().up(runner);
      await database.query('INSERT INTO "user_settings" ("id") VALUES (1)');
      assert.deepEqual(
        await database.query('SELECT "themePalette" FROM "user_settings"'),
        [{ themePalette: 'seerr' }]
      );
    } finally {
      await runner.release();
      await database.destroy();
    }
  }
});

test('upgrade switches all old themes once and preserves later choices and unrelated settings', async () => {
  for (const Migration of [SqliteAdoption, PostgresAdoption]) {
    const database = await createLegacyDatabase();
    const runner = database.createQueryRunner();
    const migration = new Migration();
    try {
      await database.query(
        'INSERT INTO "user_settings" VALUES (1, ?, ?), (2, ?, ?)',
        ['{"preset":"legacy"}', 'en', '{"--theme-page-bg":"#123456"}', 'fr']
      );
      await migration.up(runner);
      assert.deepEqual(
        await database.query('SELECT * FROM "user_settings" ORDER BY "id"'),
        [
          {
            id: 1,
            advancedThemeOverrides: null,
            locale: 'en',
            themePalette: 'seerr',
          },
          {
            id: 2,
            advancedThemeOverrides: null,
            locale: 'fr',
            themePalette: 'seerr',
          },
        ]
      );
      await database.query(
        'UPDATE "user_settings" SET "themePalette" = ?, "advancedThemeOverrides" = ? WHERE "id" = 1',
        ['aurora', '{"--theme-page-bg":"#abcdef"}']
      );
      await migration.up(runner);
      assert.deepEqual(
        await database.query(
          'SELECT "themePalette", "advancedThemeOverrides" FROM "user_settings" WHERE "id" = 1'
        ),
        [
          {
            themePalette: 'aurora',
            advancedThemeOverrides: '{"--theme-page-bg":"#abcdef"}',
          },
        ]
      );
      await migration.down(runner);
      assert.equal(
        await runner.hasColumn('user_settings', 'themePalette'),
        false
      );
      assert.deepEqual(
        await database.query(
          'SELECT "locale" FROM "user_settings" ORDER BY "id"'
        ),
        [{ locale: 'en' }, { locale: 'fr' }]
      );
    } finally {
      await runner.release();
      await database.destroy();
    }
  }
});

test('migration history prevents later upgrades from resetting a saved theme', async () => {
  const database = await createLegacyDatabase([SqliteAdoption]);
  try {
    await database.runMigrations();
    await database.query(
      'INSERT INTO "user_settings" ("id", "themePalette") VALUES (1, ?)',
      ['classic']
    );
    assert.equal((await database.runMigrations()).length, 0);
    assert.deepEqual(
      await database.query('SELECT "themePalette" FROM "user_settings"'),
      [{ themePalette: 'classic' }]
    );
  } finally {
    await database.destroy();
  }
});
