import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { CreateReadMeABookRequests1791080000000 } from './1791080000000-CreateReadMeABookRequests';
import { AddHardcoverAndBookHomeSections1791090000000 } from './1791090000000-AddHardcoverAndBookHomeSections';
import { AddSwipeSeedScopes1791100000000 } from './1791100000000-AddSwipeSeedScopes';
import { CreateUserLoginLinks1791110000000 } from './1791110000000-CreateUserLoginLinks';

test('Phase 7 SQLite migrations add reversible book, swipe, and login-link storage', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const runner = dataSource.createQueryRunner();
  const migrations = [
    new CreateReadMeABookRequests1791080000000(),
    new AddHardcoverAndBookHomeSections1791090000000(),
    new AddSwipeSeedScopes1791100000000(),
    new CreateUserLoginLinks1791110000000(),
  ];

  try {
    await runner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY NOT NULL)'
    );
    await runner.query('INSERT INTO "user" ("id") VALUES (1)');
    await runner.query(
      'CREATE TABLE "external_request_list" ("id" integer PRIMARY KEY NOT NULL)'
    );
    await runner.query(
      'CREATE TABLE "user_settings" ("id" integer PRIMARY KEY NOT NULL)'
    );
    await runner.query(
      'CREATE TABLE "swipe_profile" ("userId" integer PRIMARY KEY NOT NULL)'
    );

    for (const migration of migrations) await migration.up(runner);

    assert.equal(await runner.hasTable('readmeabook_request'), true);
    assert.equal(await runner.hasTable('user_login_link'), true);
    const requestColumns = await runner.query(
      'PRAGMA table_info("readmeabook_request")'
    );
    assert.ok(
      requestColumns.some(
        (column: { name: string }) => column.name === 'remoteId'
      )
    );
    for (const [table, column] of [
      ['external_request_list', 'apiToken'],
      ['user_settings', 'discoverBookSections'],
      ['swipe_profile', 'seedScope'],
      ['swipe_profile', 'favoriteSeeds'],
      ['user_login_link', 'tokenHash'],
    ]) {
      const columns = await runner.query(`PRAGMA table_info("${table}")`);
      assert.ok(
        columns.some((item: { name: string }) => item.name === column),
        `${table}.${column}`
      );
    }

    await runner.query(`
      INSERT INTO "readmeabook_request" ("userId", "asin", "title", "author")
      VALUES (1, 'B000000001', 'Test Book', 'Test Author')
    `);
    await assert.rejects(() =>
      runner.query(`
      INSERT INTO "readmeabook_request" ("userId", "asin", "title", "author")
      VALUES (1, 'B000000001', 'Duplicate Book', 'Test Author')
    `)
    );

    for (const migration of migrations.slice().reverse())
      await migration.down(runner);
    assert.equal(await runner.hasTable('readmeabook_request'), false);
    assert.equal(await runner.hasTable('user_login_link'), false);
    for (const [table, column] of [
      ['external_request_list', 'apiToken'],
      ['user_settings', 'discoverBookSections'],
      ['swipe_profile', 'seedScope'],
      ['swipe_profile', 'favoriteSeeds'],
    ]) {
      const columns = await runner.query(`PRAGMA table_info("${table}")`);
      assert.equal(
        columns.some((item: { name: string }) => item.name === column),
        false
      );
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
});
