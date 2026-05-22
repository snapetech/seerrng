import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookWatchlistSyncSetting1780400000000 implements MigrationInterface {
  name = 'AddBookWatchlistSyncSetting1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "watchlistSyncBooks" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "watchlistSyncBooks"`
    );
  }
}
