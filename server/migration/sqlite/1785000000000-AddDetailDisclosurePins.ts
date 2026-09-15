import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetailDisclosurePins1785000000000 implements MigrationInterface {
  name = 'AddDetailDisclosurePins1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "detailDisclosureCastPinned" boolean NOT NULL DEFAULT (0)`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "detailDisclosureCrewPinned" boolean NOT NULL DEFAULT (0)`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "detailDisclosureSubjectTagsPinned" boolean NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureSubjectTagsPinned"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureCrewPinned"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosureCastPinned"`
    );
  }
}
