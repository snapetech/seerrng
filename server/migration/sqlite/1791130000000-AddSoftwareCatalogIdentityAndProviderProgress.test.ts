import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddSoftwareCatalogIdentityAndProviderProgress1791130000000 } from './1791130000000-AddSoftwareCatalogIdentityAndProviderProgress';

test('software catalog identity and provider progress migration backfills IGDB keys', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration =
    new AddSoftwareCatalogIdentityAndProviderProgress1791130000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "software_request" ("id" integer PRIMARY KEY, "catalogId" integer)'
    );
    await queryRunner.query(
      'CREATE TABLE "software_request_status_event" ("id" integer PRIMARY KEY)'
    );
    await queryRunner.query(
      'INSERT INTO "software_request" ("id", "catalogId") VALUES (1, 42)'
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        'SELECT "catalogProvider", "catalogKey", "providerStage", "failureCode" FROM "software_request" WHERE "id" = 1'
      ),
      [
        {
          catalogProvider: 'igdb',
          catalogKey: '42',
          providerStage: null,
          failureCode: null,
        },
      ]
    );
    const eventColumns = await queryRunner.query(
      'PRAGMA table_info("software_request_status_event")'
    );
    assert.deepEqual(
      eventColumns
        .filter((column: { name: string }) =>
          ['providerStage', 'failureCode'].includes(column.name)
        )
        .map((column: { name: string }) => column.name),
      ['providerStage', 'failureCode']
    );

    await migration.down(queryRunner);
    const requestColumns = await queryRunner.query(
      'PRAGMA table_info("software_request")'
    );
    assert.equal(
      requestColumns.some(
        (column: { name: string }) => column.name === 'catalogProvider'
      ),
      false
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
