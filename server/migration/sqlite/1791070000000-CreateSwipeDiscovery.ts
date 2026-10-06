import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSwipeDiscovery1791070000000 implements MigrationInterface {
  name = 'CreateSwipeDiscovery1791070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "swipe_decision" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "mediaType" varchar(8) NOT NULL,
        "itemId" varchar(64) NOT NULL,
        "title" varchar(512) NOT NULL,
        "decision" varchar(8) NOT NULL,
        "tags" varchar(1024),
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_swipe_decision_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_swipe_decision_identity" ON "swipe_decision" ("userId", "mediaType", "itemId")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_swipe_decision_user_created" ON "swipe_decision" ("userId", "createdAt")'
    );
    await queryRunner.query(`
      CREATE TABLE "swipe_profile" (
        "userId" integer PRIMARY KEY NOT NULL,
        "tasteNotes" varchar(1000) NOT NULL DEFAULT '',
        "seriesRequest" varchar(16) NOT NULL DEFAULT 'first-season',
        "bookFormat" varchar(16) NOT NULL DEFAULT 'audiobook',
        "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_swipe_profile_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "swipe_profile"');
    await queryRunner.query('DROP TABLE "swipe_decision"');
  }
}
