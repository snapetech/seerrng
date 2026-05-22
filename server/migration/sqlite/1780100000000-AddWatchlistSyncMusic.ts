import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatchlistSyncMusic1780100000000 implements MigrationInterface {
  name = 'AddWatchlistSyncMusic1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "watchlistSyncMusic" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "watchlistSyncMusic"`
    );
  }
}
