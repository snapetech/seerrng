import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDownloadRecoveryState1781500000000 implements MigrationInterface {
  name = 'AddDownloadRecoveryState1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "download_recovery_state" ("id" SERIAL NOT NULL, "serviceType" character varying NOT NULL, "serviceId" integer NOT NULL, "externalServiceId" integer, "queueId" integer NOT NULL, "downloadId" character varying NOT NULL, "releaseTitle" character varying, "lastSizeLeft" character varying NOT NULL DEFAULT '0', "lastProgressAt" timestamp with time zone NOT NULL DEFAULT now(), "retryCount" integer NOT NULL DEFAULT 0, "lastAction" character varying, "lastReason" character varying, "createdAt" timestamp with time zone NOT NULL DEFAULT now(), "updatedAt" timestamp with time zone NOT NULL DEFAULT now(), CONSTRAINT "PK_download_recovery_state" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_download_recovery_state_service_download" ON "download_recovery_state" ("serviceType", "serviceId", "downloadId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_download_recovery_state_service_download"`
    );
    await queryRunner.query(`DROP TABLE "download_recovery_state"`);
  }
}
