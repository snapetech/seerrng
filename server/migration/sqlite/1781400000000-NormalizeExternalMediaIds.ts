import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeExternalMediaIds1781400000000 implements MigrationInterface {
  name = 'NormalizeExternalMediaIds1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "watchlist"
       WHERE EXISTS (
         SELECT 1 FROM "watchlist" kept
         WHERE "watchlist"."id" > kept."id"
           AND "watchlist"."requestedById" = kept."requestedById"
           AND "watchlist"."mediaType" = kept."mediaType"
           AND (
             ("watchlist"."mediaType" = 'music'
               AND "watchlist"."mbId" IS NOT NULL
               AND kept."mbId" IS NOT NULL
               AND lower(trim("watchlist"."mbId")) = lower(trim(kept."mbId")))
             OR
             ("watchlist"."mediaType" = 'book'
               AND "watchlist"."externalId" IS NOT NULL
               AND kept."externalId" IS NOT NULL
               AND replace(replace(upper(trim("watchlist"."externalId")), '/WORKS/', ''), 'WORKS/', '') = replace(replace(upper(trim(kept."externalId")), '/WORKS/', ''), 'WORKS/', ''))
           )
       )`
    );
    await queryRunner.query(
      `DELETE FROM "blocklist"
       WHERE EXISTS (
         SELECT 1 FROM "blocklist" kept
         WHERE "blocklist"."id" > kept."id"
           AND "blocklist"."mediaType" = kept."mediaType"
           AND "blocklist"."externalId" IS NOT NULL
           AND kept."externalId" IS NOT NULL
           AND (
             ("blocklist"."mediaType" = 'music'
               AND lower(trim("blocklist"."externalId")) = lower(trim(kept."externalId")))
             OR
             ("blocklist"."mediaType" = 'book'
               AND COALESCE("blocklist"."externalProvider", 'openlibrary') = COALESCE(kept."externalProvider", 'openlibrary')
               AND CASE
                 WHEN COALESCE("blocklist"."externalProvider", 'openlibrary') = 'isbn' THEN upper(replace(replace(trim("blocklist"."externalId"), '-', ''), ' ', ''))
                 WHEN COALESCE("blocklist"."externalProvider", 'openlibrary') = 'openlibrary_edition' THEN replace(replace(upper(trim("blocklist"."externalId")), '/BOOKS/', ''), 'BOOKS/', '')
                 ELSE replace(replace(upper(trim("blocklist"."externalId")), '/WORKS/', ''), 'WORKS/', '')
               END = CASE
                 WHEN COALESCE(kept."externalProvider", 'openlibrary') = 'isbn' THEN upper(replace(replace(trim(kept."externalId"), '-', ''), ' ', ''))
                 WHEN COALESCE(kept."externalProvider", 'openlibrary') = 'openlibrary_edition' THEN replace(replace(upper(trim(kept."externalId")), '/BOOKS/', ''), 'BOOKS/', '')
                 ELSE replace(replace(upper(trim(kept."externalId")), '/WORKS/', ''), 'WORKS/', '')
               END)
           )
       )`
    );
    await queryRunner.query(
      `DELETE FROM "media_identifier" WHERE "id" NOT IN (
        SELECT MIN("id") FROM "media_identifier"
        GROUP BY
          "mediaId",
          "provider",
          CASE
            WHEN "provider" = 'musicbrainz' THEN lower(trim("value"))
            WHEN "provider" = 'isbn' THEN upper(replace(replace(trim("value"), '-', ''), ' ', ''))
            WHEN "provider" = 'openlibrary_edition' THEN replace(replace(upper(trim("value")), '/BOOKS/', ''), 'BOOKS/', '')
            WHEN "provider" = 'openlibrary' THEN replace(replace(upper(trim("value")), '/WORKS/', ''), 'WORKS/', '')
            ELSE trim("value")
          END
      )`
    );
    await queryRunner.query(
      `CREATE TEMP TABLE "tmp_ranked_book_identifier" AS
       SELECT
         "media_identifier"."id" AS "id",
         "media_identifier"."provider" AS "provider",
         CASE
           WHEN "media_identifier"."provider" = 'isbn' THEN upper(replace(replace(trim("media_identifier"."value"), '-', ''), ' ', ''))
           WHEN "media_identifier"."provider" = 'openlibrary_edition' THEN replace(replace(upper(trim("media_identifier"."value")), '/BOOKS/', ''), 'BOOKS/', '')
           WHEN "media_identifier"."provider" = 'openlibrary' THEN replace(replace(upper(trim("media_identifier"."value")), '/WORKS/', ''), 'WORKS/', '')
           ELSE trim("media_identifier"."value")
         END AS "normalizedValue",
         (
           CASE WHEN EXISTS (SELECT 1 FROM "media_request" WHERE "mediaId" = "media_identifier"."mediaId") THEN 4 ELSE 0 END +
           CASE "media"."status" WHEN 5 THEN 3 WHEN 3 THEN 2 WHEN 1 THEN 1 ELSE 0 END
         ) * 1000000000 - "media_identifier"."id" AS "score"
       FROM "media_identifier"
       INNER JOIN "media" ON "media"."id" = "media_identifier"."mediaId"
       WHERE "media"."mediaType" = 'book'
         AND "media_identifier"."provider" IN ('isbn', 'openlibrary', 'openlibrary_edition', 'readarr', 'bookshelf', 'audiobookshelf', 'hardcover')`
    );
    await queryRunner.query(
      `DELETE FROM "media_identifier"
       WHERE "id" IN (
         SELECT loser."id"
         FROM "tmp_ranked_book_identifier" loser
         INNER JOIN "tmp_ranked_book_identifier" kept
           ON kept."provider" = loser."provider"
          AND kept."normalizedValue" = loser."normalizedValue"
          AND kept."score" > loser."score"
       )`
    );
    await queryRunner.query(`DROP TABLE "tmp_ranked_book_identifier"`);
    await queryRunner.query(
      `UPDATE "media" SET "mbId" = lower(trim("mbId")) WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "watchlist" SET "mbId" = lower(trim("mbId")) WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "watchlist" SET "externalId" = replace(replace(upper(trim("externalId")), '/WORKS/', ''), 'WORKS/', '') WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = lower(trim("externalId")) WHERE "mediaType" = 'music' AND "externalId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = upper(replace(replace(trim("externalId"), '-', ''), ' ', '')) WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'isbn'`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = replace(replace(upper(trim("externalId")), '/BOOKS/', ''), 'BOOKS/', '') WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'openlibrary_edition'`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = replace(replace(upper(trim("externalId")), '/WORKS/', ''), 'WORKS/', '') WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'openlibrary'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = lower(trim("value")) WHERE "provider" = 'musicbrainz'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = upper(replace(replace(trim("value"), '-', ''), ' ', '')) WHERE "provider" = 'isbn'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = replace(replace(upper(trim("value")), '/BOOKS/', ''), 'BOOKS/', '') WHERE "provider" = 'openlibrary_edition'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = replace(replace(upper(trim("value")), '/WORKS/', ''), 'WORKS/', '') WHERE "provider" = 'openlibrary'`
    );
  }

  public async down(): Promise<void> {
    // Normalized IDs cannot be losslessly restored.
  }
}
