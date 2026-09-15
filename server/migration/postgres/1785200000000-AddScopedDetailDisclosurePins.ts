import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopedDetailDisclosurePins1785200000000 implements MigrationInterface {
  name = 'AddScopedDetailDisclosurePins1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "detailDisclosurePins" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "detailDisclosurePins"`
    );
  }
}
