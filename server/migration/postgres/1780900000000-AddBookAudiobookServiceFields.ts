import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookAudiobookServiceFields1780900000000 implements MigrationInterface {
  name = 'AddBookAudiobookServiceFields1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" ADD "audiobookServiceId" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "audiobookExternalServiceId" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "audiobookExternalServiceSlug" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "audiobookExternalServiceSlug"`
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "audiobookExternalServiceId"`
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "audiobookServiceId"`
    );
  }
}
