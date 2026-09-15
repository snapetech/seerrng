import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { AddScopedDetailDisclosurePins1785200000000 } from './1785200000000-AddScopedDetailDisclosurePins';

test('PostgreSQL scoped detail disclosure pins migrate reversibly', async () => {
  const queries: string[] = [];
  const queryRunner = {
    query: async (query: string) => {
      queries.push(query);
    },
  } as QueryRunner;
  const migration = new AddScopedDetailDisclosurePins1785200000000();

  await migration.up(queryRunner);
  await migration.down(queryRunner);

  assert.deepStrictEqual(queries, [
    `ALTER TABLE "user_settings" ADD "detailDisclosurePins" text`,
    `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosurePins"`,
  ]);
});
