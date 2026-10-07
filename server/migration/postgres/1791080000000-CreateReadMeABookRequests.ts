import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReadMeABookRequests1791080000000 implements MigrationInterface {
  name = 'CreateReadMeABookRequests1791080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "readmeabook_request" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "asin" character varying(20) NOT NULL,
        "title" character varying(512) NOT NULL,
        "author" character varying(512) NOT NULL,
        "narrator" character varying(512),
        "description" text,
        "coverArtUrl" character varying(2048),
        "durationMinutes" integer,
        "remoteId" character varying(128),
        "status" character varying(32) NOT NULL DEFAULT 'awaiting_approval',
        "statusMessage" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_readmeabook_request" PRIMARY KEY ("id"),
        CONSTRAINT "FK_readmeabook_request_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
