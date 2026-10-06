import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrackRequests1791050000000 implements MigrationInterface {
  name = 'CreateTrackRequests1791050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "track_request" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "requestedById" integer NOT NULL,
        "modifiedById" integer,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "artist" varchar(255) NOT NULL,
        "title" varchar(255) NOT NULL,
        "recordingMbid" varchar(64),
        "source" varchar(16) NOT NULL DEFAULT 'manual',
        "wishlistItemId" varchar(64),
        "searchCount" integer NOT NULL DEFAULT 0,
        "lastMatchCount" integer NOT NULL DEFAULT 0,
        "lastError" varchar(512),
        "lastCheckedAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_track_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_track_request_modified_by" FOREIGN KEY ("modifiedById") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
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
