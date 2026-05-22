import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlocklistExternalIds1780800000000 implements MigrationInterface {
  name = 'AddBlocklistExternalIds1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "externalId" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "externalProvider" character varying`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_blocklist_external_media_type" ON "blocklist" ("externalId", "mediaType")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_blocklist_external_media_type"`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP COLUMN "externalProvider"`
    );
    await queryRunner.query(`ALTER TABLE "blocklist" DROP COLUMN "externalId"`);
  }
}
