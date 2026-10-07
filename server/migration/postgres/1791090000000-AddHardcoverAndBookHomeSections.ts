import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHardcoverAndBookHomeSections1791090000000 implements MigrationInterface {
  name = 'AddHardcoverAndBookHomeSections1791090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "external_request_list" ADD COLUMN "apiToken" text'
    );
    await queryRunner.query(
      'ALTER TABLE "user_settings" ADD COLUMN "discoverBookSections" text'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user_settings" DROP COLUMN "discoverBookSections"'
    );
    await queryRunner.query(
      'ALTER TABLE "external_request_list" DROP COLUMN "apiToken"'
    );
  }
}
