import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecordingRequests1791040000000 implements MigrationInterface {
  name = 'CreateRecordingRequests1791040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "recording_request" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "requestedById" integer NOT NULL,
        "modifiedById" integer,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "title" varchar(512) NOT NULL,
        "subTitle" varchar(512),
        "mediaType" varchar(8),
        "tmdbId" integer,
        "channelId" varchar(255),
        "channelName" varchar(255),
        "startsAt" datetime,
        "endsAt" datetime,
        "tunerrRuleId" varchar(128),
        "completedCount" integer NOT NULL DEFAULT 0,
        "failedCount" integer NOT NULL DEFAULT 0,
        "lastError" varchar(512),
        "lastCheckedAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_recording_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_recording_request_modified_by" FOREIGN KEY ("modifiedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_recording_request_requester_created" ON "recording_request" ("requestedById", "createdAt")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_recording_request_status_created" ON "recording_request" ("status", "createdAt")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "recording_request"');
  }
}
