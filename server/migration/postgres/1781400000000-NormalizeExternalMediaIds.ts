import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeExternalMediaIds1781400000000 implements MigrationInterface {
  name = 'NormalizeExternalMediaIds1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "watchlist" w USING "watchlist" kept
       WHERE w."id" > kept."id"
         AND w."requestedById" = kept."requestedById"
         AND w."mediaType" = kept."mediaType"
         AND (
           (w."mediaType" = 'music'
             AND w."mbId" IS NOT NULL
             AND kept."mbId" IS NOT NULL
             AND lower(trim(w."mbId")) = lower(trim(kept."mbId")))
           OR
           (w."mediaType" = 'book'
             AND w."externalId" IS NOT NULL
             AND kept."externalId" IS NOT NULL
             AND upper(regexp_replace(trim(w."externalId"), '^/?works/', '', 'i')) = upper(regexp_replace(trim(kept."externalId"), '^/?works/', '', 'i')))
         )`
    );
    await queryRunner.query(
      `DELETE FROM "blocklist" b USING "blocklist" kept
       WHERE b."id" > kept."id"
         AND b."mediaType" = kept."mediaType"
         AND b."externalId" IS NOT NULL
         AND kept."externalId" IS NOT NULL
         AND (
           (b."mediaType" = 'music'
             AND lower(trim(b."externalId")) = lower(trim(kept."externalId")))
           OR
           (b."mediaType" = 'book'
             AND COALESCE(b."externalProvider", 'openlibrary') = COALESCE(kept."externalProvider", 'openlibrary')
             AND CASE
               WHEN COALESCE(b."externalProvider", 'openlibrary') = 'isbn' THEN upper(regexp_replace(trim(b."externalId"), '[^0-9Xx]', '', 'g'))
               WHEN COALESCE(b."externalProvider", 'openlibrary') = 'openlibrary_edition' THEN upper(regexp_replace(trim(b."externalId"), '^/?books/', '', 'i'))
               ELSE upper(regexp_replace(trim(b."externalId"), '^/?works/', '', 'i'))
             END = CASE
               WHEN COALESCE(kept."externalProvider", 'openlibrary') = 'isbn' THEN upper(regexp_replace(trim(kept."externalId"), '[^0-9Xx]', '', 'g'))
               WHEN COALESCE(kept."externalProvider", 'openlibrary') = 'openlibrary_edition' THEN upper(regexp_replace(trim(kept."externalId"), '^/?books/', '', 'i'))
               ELSE upper(regexp_replace(trim(kept."externalId"), '^/?works/', '', 'i'))
             END)
         )`
    );
    await queryRunner.query(
      `DELETE FROM "media_identifier" mi USING "media_identifier" kept
       WHERE mi."id" > kept."id"
         AND mi."mediaId" = kept."mediaId"
         AND mi."provider" = kept."provider"
         AND CASE
           WHEN mi."provider" = 'musicbrainz' THEN lower(trim(mi."value"))
           WHEN mi."provider" = 'isbn' THEN upper(regexp_replace(trim(mi."value"), '[^0-9Xx]', '', 'g'))
           WHEN mi."provider" = 'openlibrary_edition' THEN upper(regexp_replace(trim(mi."value"), '^/?books/', '', 'i'))
           WHEN mi."provider" = 'openlibrary' THEN upper(regexp_replace(trim(mi."value"), '^/?works/', '', 'i'))
           ELSE trim(mi."value")
         END = CASE
           WHEN kept."provider" = 'musicbrainz' THEN lower(trim(kept."value"))
           WHEN kept."provider" = 'isbn' THEN upper(regexp_replace(trim(kept."value"), '[^0-9Xx]', '', 'g'))
           WHEN kept."provider" = 'openlibrary_edition' THEN upper(regexp_replace(trim(kept."value"), '^/?books/', '', 'i'))
           WHEN kept."provider" = 'openlibrary' THEN upper(regexp_replace(trim(kept."value"), '^/?works/', '', 'i'))
           ELSE trim(kept."value")
         END`
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT
           mi."id",
           row_number() OVER (
             PARTITION BY
               mi."provider",
               CASE
                 WHEN mi."provider" = 'isbn' THEN upper(regexp_replace(trim(mi."value"), '[^0-9Xx]', '', 'g'))
                 WHEN mi."provider" = 'openlibrary_edition' THEN upper(regexp_replace(trim(mi."value"), '^/?books/', '', 'i'))
                 WHEN mi."provider" = 'openlibrary' THEN upper(regexp_replace(trim(mi."value"), '^/?works/', '', 'i'))
                 ELSE trim(mi."value")
               END
             ORDER BY
               CASE WHEN EXISTS (SELECT 1 FROM "media_request" WHERE "mediaId" = mi."mediaId") THEN 4 ELSE 0 END +
               CASE media."status" WHEN 5 THEN 3 WHEN 3 THEN 2 WHEN 1 THEN 1 ELSE 0 END DESC,
               mi."id" ASC
           ) AS rn
         FROM "media_identifier" mi
         INNER JOIN "media" media ON media."id" = mi."mediaId"
         WHERE media."mediaType" = 'book'
           AND mi."provider" IN ('isbn', 'openlibrary', 'openlibrary_edition', 'readarr', 'bookshelf', 'audiobookshelf', 'hardcover')
       )
       DELETE FROM "media_identifier"
       WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1)`
    );
    await queryRunner.query(
      `UPDATE "media" SET "mbId" = lower(trim("mbId")) WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "watchlist" SET "mbId" = lower(trim("mbId")) WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "watchlist" SET "externalId" = upper(regexp_replace(trim("externalId"), '^/?works/', '', 'i')) WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = lower(trim("externalId")) WHERE "mediaType" = 'music' AND "externalId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = upper(regexp_replace(trim("externalId"), '[^0-9Xx]', '', 'g')) WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'isbn'`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = upper(regexp_replace(trim("externalId"), '^/?books/', '', 'i')) WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'openlibrary_edition'`
    );
    await queryRunner.query(
      `UPDATE "blocklist" SET "externalId" = upper(regexp_replace(trim("externalId"), '^/?works/', '', 'i')) WHERE "mediaType" = 'book' AND "externalId" IS NOT NULL AND COALESCE("externalProvider", 'openlibrary') = 'openlibrary'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = lower(trim("value")) WHERE "provider" = 'musicbrainz'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = upper(regexp_replace(trim("value"), '[^0-9Xx]', '', 'g')) WHERE "provider" = 'isbn'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = upper(regexp_replace(trim("value"), '^/?books/', '', 'i')) WHERE "provider" = 'openlibrary_edition'`
    );
    await queryRunner.query(
      `UPDATE "media_identifier" SET "value" = upper(regexp_replace(trim("value"), '^/?works/', '', 'i')) WHERE "provider" = 'openlibrary'`
    );
  }

  public async down(): Promise<void> {
    // Normalized IDs cannot be losslessly restored.
  }
}
