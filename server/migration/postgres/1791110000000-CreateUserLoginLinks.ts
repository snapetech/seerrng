import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserLoginLinks1791110000000 implements MigrationInterface {
  name = 'CreateUserLoginLinks1791110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_login_link" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "createdById" integer NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_login_link" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_login_link_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_user_login_link_created_by" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
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
