import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalRequestLists1791010000000 implements MigrationInterface {
  name = 'CreateExternalRequestLists1791010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "external_request_list" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "provider" character varying(16) NOT NULL,
        "sourceId" character varying(64) NOT NULL,
        "sourceUrl" character varying(2048) NOT NULL,
        "processedItemIds" text,
        "lastSyncedAt" TIMESTAMP,
        "lastSyncError" text,
        CONSTRAINT "PK_external_request_list" PRIMARY KEY ("id"),
        CONSTRAINT "FK_external_request_list_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_external_request_list_user_source" ON "external_request_list" ("userId", "sourceId")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "IDX_external_request_list_user_source"'
    );
    await queryRunner.query('DROP TABLE "external_request_list"');
  }
}
