import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrackRequests1791050000000 implements MigrationInterface {
  name = 'CreateTrackRequests1791050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "track_request" (
        "id" SERIAL NOT NULL,
        "requestedById" integer NOT NULL,
        "modifiedById" integer,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "artist" character varying(255) NOT NULL,
        "title" character varying(255) NOT NULL,
        "recordingMbid" character varying(64),
        "source" character varying(16) NOT NULL DEFAULT 'manual',
        "wishlistItemId" character varying(64),
        "searchCount" integer NOT NULL DEFAULT 0,
        "lastMatchCount" integer NOT NULL DEFAULT 0,
        "lastError" character varying(512),
        "lastCheckedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_track_request" PRIMARY KEY ("id"),
        CONSTRAINT "FK_track_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_track_request_modified_by" FOREIGN KEY ("modifiedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_track_request_requester_created" ON "track_request" ("requestedById", "createdAt")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_track_request_status_created" ON "track_request" ("status", "createdAt")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "track_request"');
  }
}
