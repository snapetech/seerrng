import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatchlistExternalId1780600000000 implements MigrationInterface {
  name = 'AddWatchlistExternalId1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "watchlist" ADD "externalId" varchar`);
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_external_id" ON "watchlist" ("externalId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_watchlist_external_id"`);
    await queryRunner.query(`ALTER TABLE "watchlist" DROP COLUMN "externalId"`);
  }
}
