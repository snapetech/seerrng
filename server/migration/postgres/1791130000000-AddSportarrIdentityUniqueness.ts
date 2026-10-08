import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSportarrIdentityUniqueness1791130000000 implements MigrationInterface {
  name = 'AddSportarrIdentityUniqueness1791130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_media_identifier_canonical_sportarr" ON "media_identifier" ("provider", "value") WHERE "provider" = 'sportarr'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_media_identifier_canonical_sportarr"`
    );
  }
}
