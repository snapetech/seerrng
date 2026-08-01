import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDownloadRecoveryState1781500000000 implements MigrationInterface {
  name = 'AddDownloadRecoveryState1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "download_recovery_state" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "serviceType" varchar NOT NULL, "serviceId" integer NOT NULL, "externalServiceId" integer, "queueId" integer NOT NULL, "downloadId" varchar NOT NULL, "releaseTitle" varchar, "lastSizeLeft" varchar NOT NULL DEFAULT ('0'), "lastProgressAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "retryCount" integer NOT NULL DEFAULT (0), "lastAction" varchar, "lastReason" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
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
