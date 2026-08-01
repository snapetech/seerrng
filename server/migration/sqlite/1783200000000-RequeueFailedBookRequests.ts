import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RequeueFailedBookRequests1783200000000 implements MigrationInterface {
  name = 'RequeueFailedBookRequests1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT OR IGNORE INTO "request_dispatch_outbox" ("requestId", "attempts", "nextAttemptAt") SELECT "id", 0, CURRENT_TIMESTAMP FROM "media_request" WHERE "type" = 'book' AND "status" = 4`
    );
  }

  public async down(): Promise<void> {
    // Seeded dispatch records may have accumulated retry state by rollback time.
    // Removing them would discard valid pending work, so rollback is intentionally
    // non-destructive.
  }
}
