import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSportsFollows1791060000000 implements MigrationInterface {
  name = 'CreateSportsFollows1791060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sports_follow" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "dataset" varchar(32) NOT NULL,
        "team" varchar(128) NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_sports_follow_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
