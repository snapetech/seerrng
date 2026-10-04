import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalRequestLists1791010000000 implements MigrationInterface {
  name = 'CreateExternalRequestLists1791010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "external_request_list" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "provider" varchar(16) NOT NULL,
        "sourceId" varchar(64) NOT NULL,
        "sourceUrl" varchar(2048) NOT NULL,
        "processedItemIds" text,
        "lastSyncedAt" datetime,
        "lastSyncError" text,
        CONSTRAINT "FK_external_request_list_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
