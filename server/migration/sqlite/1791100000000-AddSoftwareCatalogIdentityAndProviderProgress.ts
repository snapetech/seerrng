import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftwareCatalogIdentityAndProviderProgress1791100000000 implements MigrationInterface {
  name = 'AddSoftwareCatalogIdentityAndProviderProgress1791100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "software_request" ADD COLUMN "catalogProvider" varchar(16) NOT NULL DEFAULT 'igdb'`
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" ADD COLUMN "catalogKey" varchar(128)'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" ADD COLUMN "providerStage" varchar(64)'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" ADD COLUMN "failureCode" varchar(64)'
    );
    await queryRunner.query(
      'UPDATE "software_request" SET "catalogKey" = CAST("catalogId" AS TEXT) WHERE "catalogId" IS NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request_status_event" ADD COLUMN "providerStage" varchar(64)'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request_status_event" ADD COLUMN "failureCode" varchar(64)'
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "software_request_status_event" DROP COLUMN "failureCode"'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request_status_event" DROP COLUMN "providerStage"'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" DROP COLUMN "failureCode"'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" DROP COLUMN "providerStage"'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" DROP COLUMN "catalogKey"'
    );
    await queryRunner.query(
      'ALTER TABLE "software_request" DROP COLUMN "catalogProvider"'
    );
  }
}
