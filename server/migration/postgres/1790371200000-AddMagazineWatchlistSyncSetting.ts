import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMagazineWatchlistSyncSetting1790371200000 implements MigrationInterface {
  name = 'AddMagazineWatchlistSyncSetting1790371200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "watchlistSyncMagazines" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "watchlistSyncMagazines"`
    );
  }
}
