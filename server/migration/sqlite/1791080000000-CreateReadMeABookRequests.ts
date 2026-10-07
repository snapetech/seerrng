import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReadMeABookRequests1791080000000 implements MigrationInterface {
  name = 'CreateReadMeABookRequests1791080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "readmeabook_request" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "asin" varchar(20) NOT NULL,
        "title" varchar(512) NOT NULL,
        "author" varchar(512) NOT NULL,
        "narrator" varchar(512),
        "description" text,
        "coverArtUrl" varchar(2048),
        "durationMinutes" integer,
        "remoteId" varchar(128),
        "status" varchar(32) NOT NULL DEFAULT 'awaiting_approval',
        "statusMessage" text,
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_readmeabook_request_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_readmeabook_request_user_asin" ON "readmeabook_request" ("userId", "asin")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_readmeabook_request_user_asin"');
    await queryRunner.query('DROP TABLE "readmeabook_request"');
  }
}
