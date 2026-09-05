import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaRequestStatusEvents1784200000000 implements MigrationInterface {
  name = 'AddMediaRequestStatusEvents1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_request_status_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestId" integer NOT NULL, "requestedById" integer NOT NULL, "mediaId" integer NOT NULL, "mediaType" varchar(16) NOT NULL, "stage" varchar(32) NOT NULL, "attempt" integer NOT NULL DEFAULT (0), "format" varchar(16), "service" varchar(128), "message" varchar(512), "percent" real, "size" real, "sizeLeft" real, "estimatedCompletionTime" datetime, "downloadCount" integer NOT NULL DEFAULT (0), "downloadId" varchar(512), "fingerprint" varchar(255) NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_media_request_status_event_fingerprint" UNIQUE ("requestId", "fingerprint"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_request_status_event_request_created" ON "media_request_status_event" ("requestId", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_request_status_event_user_created" ON "media_request_status_event" ("requestedById", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_request_status_event_stage" ON "media_request_status_event" ("stage")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_media_request_status_event_stage"`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_media_request_status_event_user_created"`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_media_request_status_event_request_created"`
    );
    await queryRunner.query(`DROP TABLE "media_request_status_event"`);
  }
}
