import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftwareQuota1790390000000 implements MigrationInterface {
  name = 'AddSoftwareQuota1790390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "softwareQuotaLimit" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "softwareQuotaDays" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "softwareQuotaDays"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "softwareQuotaLimit"`
    );
  }
}
