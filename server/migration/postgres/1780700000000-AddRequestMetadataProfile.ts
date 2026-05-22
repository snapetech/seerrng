import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestMetadataProfile1780700000000 implements MigrationInterface {
  name = 'AddRequestMetadataProfile1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "metadataProfileId" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "metadataProfileId"`
    );
  }
}
