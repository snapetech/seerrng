import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftwareRequests1790380000000 implements MigrationInterface {
  name = 'AddSoftwareRequests1790380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "software_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestedById" integer NOT NULL, "approvedById" integer, "category" varchar(16) NOT NULL, "provider" varchar(16) NOT NULL, "status" varchar(32) NOT NULL DEFAULT ('pending'), "externalRequestId" varchar(255) NOT NULL, "catalogId" integer, "title" varchar(512) NOT NULL, "summary" text, "coverUrl" varchar(2048), "platformSlug" varchar(64), "platformName" varchar(128), "platformId" integer, "operatingSystem" varchar(16), "architecture" varchar(16), "attempt" integer NOT NULL DEFAULT (0), "percent" real, "errorMessage" varchar(512), "lastCheckedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_software_request_provider_external_id" UNIQUE ("provider", "externalRequestId"), CONSTRAINT "FK_software_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE, CONSTRAINT "FK_software_request_approved_by" FOREIGN KEY ("approvedById") REFERENCES "user" ("id") ON DELETE SET NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_software_request_requester_created" ON "software_request" ("requestedById", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_software_request_status_created" ON "software_request" ("status", "createdAt")`
    );
    await queryRunner.query(
      `CREATE TABLE "software_request_status_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestId" integer NOT NULL, "requestedById" integer NOT NULL, "status" varchar(32) NOT NULL, "message" varchar(512), "percent" real, "fingerprint" varchar(255) NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_software_request_status_event_fingerprint" UNIQUE ("requestId", "fingerprint"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_software_request_status_event_request_created" ON "software_request_status_event" ("requestId", "createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_software_request_status_event_request_created"`
    );
    await queryRunner.query(`DROP TABLE "software_request_status_event"`);
    await queryRunner.query(`DROP INDEX "IDX_software_request_status_created"`);
    await queryRunner.query(
      `DROP INDEX "IDX_software_request_requester_created"`
    );
    await queryRunner.query(`DROP TABLE "software_request"`);
  }
}
