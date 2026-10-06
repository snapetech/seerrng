import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSwipeDiscovery1791070000000 implements MigrationInterface {
  name = 'CreateSwipeDiscovery1791070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "swipe_decision" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "mediaType" character varying(8) NOT NULL,
        "itemId" character varying(64) NOT NULL,
        "title" character varying(512) NOT NULL,
        "decision" character varying(8) NOT NULL,
        "tags" character varying(1024),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_swipe_decision" PRIMARY KEY ("id"),
        CONSTRAINT "FK_swipe_decision_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
        "userId" integer NOT NULL,
        "tasteNotes" character varying(1000) NOT NULL DEFAULT '',
        "seriesRequest" character varying(16) NOT NULL DEFAULT 'first-season',
        "bookFormat" character varying(16) NOT NULL DEFAULT 'audiobook',
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_swipe_profile" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_swipe_profile_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "swipe_profile"');
    await queryRunner.query('DROP TABLE "swipe_decision"');
  }
}
