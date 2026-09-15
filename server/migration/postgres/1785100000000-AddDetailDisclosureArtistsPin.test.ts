import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { AddDetailDisclosureArtistsPin1785100000000 } from './1785100000000-AddDetailDisclosureArtistsPin';

test('adds and removes the persistent Artists disclosure pin', async () => {
  const statements: string[] = [];
  const queryRunner = {
    query: async (statement: string) => {
      statements.push(statement);
    },
  } as QueryRunner;
  const migration = new AddDetailDisclosureArtistsPin1785100000000();

  await migration.up(queryRunner);
  await migration.down(queryRunner);

  assert.deepStrictEqual(statements, [
    `ALTER TABLE "user_settings" ADD "detailDisclosureArtistsPinned" boolean NOT NULL DEFAULT false`,
    `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureArtistsPinned"`,
  ]);
});
