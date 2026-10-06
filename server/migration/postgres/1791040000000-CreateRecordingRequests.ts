import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRecordingRequests1791040000000 implements MigrationInterface {
  name = 'CreateRecordingRequests1791040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "recording_request" (
        "id" SERIAL NOT NULL,
        "requestedById" integer NOT NULL,
        "modifiedById" integer,
        "kind" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "title" character varying(512) NOT NULL,
        "subTitle" character varying(512),
        "mediaType" character varying(8),
        "tmdbId" integer,
        "channelId" character varying(255),
        "channelName" character varying(255),
        "startsAt" TIMESTAMP WITH TIME ZONE,
        "endsAt" TIMESTAMP WITH TIME ZONE,
        "tunerrRuleId" character varying(128),
        "completedCount" integer NOT NULL DEFAULT 0,
        "failedCount" integer NOT NULL DEFAULT 0,
        "lastError" character varying(512),
        "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recording_request" PRIMARY KEY ("id"),
        CONSTRAINT "FK_recording_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_recording_request_modified_by" FOREIGN KEY ("modifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
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
