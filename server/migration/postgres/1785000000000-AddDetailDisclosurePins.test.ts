import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { AddDetailDisclosurePins1785000000000 } from './1785000000000-AddDetailDisclosurePins';

test('PostgreSQL detail disclosure pins migrate reversibly', async () => {
  const statements: string[] = [];
  const queryRunner = {
    query: async (statement: string) => {
      statements.push(statement);
    },
  } as QueryRunner;
  const migration = new AddDetailDisclosurePins1785000000000();

  await migration.up(queryRunner);
  await migration.down(queryRunner);

  assert.deepStrictEqual(statements, [
    `ALTER TABLE "user_settings" ADD "detailDisclosureCastPinned" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "user_settings" ADD "detailDisclosureCrewPinned" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "user_settings" ADD "detailDisclosureSubjectTagsPinned" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureSubjectTagsPinned"`,
    `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureCrewPinned"`,
    `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureCastPinned"`,
  ]);
});
