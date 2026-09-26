import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftwareRequests1790380000000 implements MigrationInterface {
  name = 'AddSoftwareRequests1790380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "software_request" ("id" SERIAL NOT NULL, "requestedById" integer NOT NULL, "approvedById" integer, "category" character varying(16) NOT NULL, "provider" character varying(16) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'pending', "externalRequestId" character varying(255) NOT NULL, "catalogId" integer, "title" character varying(512) NOT NULL, "summary" text, "coverUrl" character varying(2048), "platformSlug" character varying(64), "platformName" character varying(128), "platformId" integer, "operatingSystem" character varying(16), "architecture" character varying(16), "attempt" integer NOT NULL DEFAULT 0, "percent" real, "errorMessage" character varying(512), "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_software_request_provider_external_id" UNIQUE ("provider", "externalRequestId"), CONSTRAINT "PK_software_request" PRIMARY KEY ("id"), CONSTRAINT "FK_software_request_requested_by" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON DELETE CASCADE, CONSTRAINT "FK_software_request_approved_by" FOREIGN KEY ("approvedById") REFERENCES "user" ("id") ON DELETE SET NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_software_request_requester_created" ON "software_request" ("requestedById", "createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_software_request_status_created" ON "software_request" ("status", "createdAt")`
    );
    await queryRunner.query(
      `CREATE TABLE "software_request_status_event" ("id" SERIAL NOT NULL, "requestId" integer NOT NULL, "requestedById" integer NOT NULL, "status" character varying(32) NOT NULL, "message" character varying(512), "percent" real, "fingerprint" character varying(255) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_software_request_status_event_fingerprint" UNIQUE ("requestId", "fingerprint"), CONSTRAINT "PK_software_request_status_event" PRIMARY KEY ("id"))`
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
