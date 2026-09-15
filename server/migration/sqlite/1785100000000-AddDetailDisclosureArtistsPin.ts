import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetailDisclosureArtistsPin1785100000000 implements MigrationInterface {
  name = 'AddDetailDisclosureArtistsPin1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD COLUMN "detailDisclosureArtistsPinned" boolean NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureArtistsPinned"`
    );
  }
}
