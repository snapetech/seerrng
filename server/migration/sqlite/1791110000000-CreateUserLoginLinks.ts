import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserLoginLinks1791110000000 implements MigrationInterface {
  name = 'CreateUserLoginLinks1791110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_login_link" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "userId" integer NOT NULL,
        "createdById" integer NOT NULL,
        "tokenHash" varchar(64) NOT NULL,
        "expiresAt" datetime NOT NULL,
        "usedAt" datetime,
        "revokedAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_user_login_link_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_user_login_link_created_by" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_user_login_link_hash" ON "user_login_link" ("tokenHash")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_user_login_link_target_created" ON "user_login_link" ("userId", "createdAt")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_user_login_link_target_created"');
    await queryRunner.query('DROP INDEX "IDX_user_login_link_hash"');
    await queryRunner.query('DROP TABLE "user_login_link"');
  }
}
