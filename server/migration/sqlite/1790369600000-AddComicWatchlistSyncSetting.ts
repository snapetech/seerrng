import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComicWatchlistSyncSetting1790369600000 implements MigrationInterface {
  name = 'AddComicWatchlistSyncSetting1790369600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "watchlistSyncComics" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "watchlistSyncComics"`
    );
  }
}
