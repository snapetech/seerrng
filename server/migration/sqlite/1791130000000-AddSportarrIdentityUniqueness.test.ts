import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddSportarrIdentityUniqueness1791130000000 } from './1791130000000-AddSportarrIdentityUniqueness';

test('keeps Sportarr league identities unique across media records', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddSportarrIdentityUniqueness1791130000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "media_identifier" ("provider" varchar NOT NULL, "value" varchar NOT NULL)'
    );
    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("provider", "value") VALUES ('sportarr', 'lg-000142')`
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "media_identifier" ("provider", "value") VALUES ('sportarr', 'lg-000142')`
      )
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("provider", "value") VALUES ('sportarr', 'lg-000143')`
    );
    await migration.down(queryRunner);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
