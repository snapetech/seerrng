import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSwipeSeedScopes1791100000000 implements MigrationInterface {
  name = 'AddSwipeSeedScopes1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "swipe_profile" ADD COLUMN "seedScope" character varying(16) NOT NULL DEFAULT 'full'`
    );
    await queryRunner.query(
      'ALTER TABLE "swipe_profile" ADD COLUMN "favoriteSeeds" text'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "swipe_profile" DROP COLUMN "favoriteSeeds"'
    );
    await queryRunner.query(
      'ALTER TABLE "swipe_profile" DROP COLUMN "seedScope"'
    );
  }
}
