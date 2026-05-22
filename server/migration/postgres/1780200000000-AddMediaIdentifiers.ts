import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaIdentifiers1780200000000 implements MigrationInterface {
  name = 'AddMediaIdentifiers1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_identifier" ("id" SERIAL NOT NULL, "provider" character varying NOT NULL, "value" character varying NOT NULL, "canonical" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "mediaId" integer, CONSTRAINT "UNIQUE_MEDIA_IDENTIFIER" UNIQUE ("mediaId", "provider", "value"), CONSTRAINT "PK_media_identifier" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_identifier_provider_value" ON "media_identifier" ("provider", "value")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_identifier_mediaId" ON "media_identifier" ("mediaId")`
    );
    await queryRunner.query(
      `ALTER TABLE "media_identifier" ADD CONSTRAINT "FK_media_identifier_media" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'tmdb', "tmdbId"::text, true FROM "media" WHERE "tmdbId" IS NOT NULL AND "mediaType" IN ('movie', 'tv')`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'tvdb', "tvdbId"::text, false FROM "media" WHERE "tvdbId" IS NOT NULL`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'imdb', "imdbId", false FROM "media" WHERE "imdbId" IS NOT NULL`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'musicbrainz', "mbId", true FROM "media" WHERE "mbId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_identifier" DROP CONSTRAINT "FK_media_identifier_media"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_media_identifier_mediaId"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_media_identifier_provider_value"`
    );
    await queryRunner.query(`DROP TABLE "media_identifier"`);
  }
}
