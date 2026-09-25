import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMagazineQuota1790371100000 implements MigrationInterface {
  name = 'AddMagazineQuota1790371100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "magazineQuotaLimit" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "magazineQuotaDays" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "magazineQuotaDays"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "magazineQuotaLimit"`
    );
  }
}
