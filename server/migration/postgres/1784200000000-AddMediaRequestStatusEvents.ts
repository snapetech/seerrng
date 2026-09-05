import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaRequestStatusEvents1784200000000 implements MigrationInterface {
  name = 'AddMediaRequestStatusEvents1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_request_status_event" ("id" SERIAL NOT NULL, "requestId" integer NOT NULL, "requestedById" integer NOT NULL, "mediaId" integer NOT NULL, "mediaType" character varying(16) NOT NULL, "stage" character varying(32) NOT NULL, "attempt" integer NOT NULL DEFAULT 0, "format" character varying(16), "service" character varying(128), "message" character varying(512), "percent" real, "size" real, "sizeLeft" real, "estimatedCompletionTime" TIMESTAMP WITH TIME ZONE, "downloadCount" integer NOT NULL DEFAULT 0, "downloadId" character varying(512), "fingerprint" character varying(255) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_media_request_status_event_fingerprint" UNIQUE ("requestId", "fingerprint"), CONSTRAINT "PK_media_request_status_event" PRIMARY KEY ("id"))`
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
