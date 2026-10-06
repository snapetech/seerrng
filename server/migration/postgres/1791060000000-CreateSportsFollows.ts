import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSportsFollows1791060000000 implements MigrationInterface {
  name = 'CreateSportsFollows1791060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sports_follow" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "dataset" character varying(32) NOT NULL,
        "team" character varying(128) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sports_follow" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sports_follow_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_sports_follow_identity" ON "sports_follow" ("userId", "dataset", "team")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "sports_follow"');
  }
}
