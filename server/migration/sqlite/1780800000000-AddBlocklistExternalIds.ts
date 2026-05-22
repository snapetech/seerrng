import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBlocklistExternalIds1780800000000 implements MigrationInterface {
  name = 'AddBlocklistExternalIds1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "blocklist" ADD "externalId" varchar`);
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "externalProvider" varchar`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_blocklist_external_media_type" ON "blocklist" ("externalId", "mediaType")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_blocklist_external_media_type"`);
    await queryRunner.query(`DROP INDEX "IDX_356721a49f145aa439c16e6b99"`);
    await queryRunner.query(`DROP INDEX "IDX_09b94c932e84635c5461f3c0a9"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "title" varchar, "tmdbId" integer NOT NULL, "blocklistedTags" varchar, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "userId" integer, "mediaId" integer, CONSTRAINT "UQ_81504e02db89b4c1e3152729fa6" UNIQUE ("tmdbId", "mediaType"), CONSTRAINT "REL_62b7ade94540f9f8d8bede54b9" UNIQUE ("mediaId"), CONSTRAINT "FK_5c8af2d0e83b3be6d250eccc19d" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_356721a49f145aa439c16e6b999" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_blocklist"("id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId") SELECT "id", "mediaType", "title", "tmdbId", "blocklistedTags", "createdAt", "userId", "mediaId" FROM "blocklist"`
    );
    await queryRunner.query(`DROP TABLE "blocklist"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_blocklist" RENAME TO "blocklist"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_356721a49f145aa439c16e6b99" ON "blocklist" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09b94c932e84635c5461f3c0a9" ON "blocklist" ("tmdbId")`
    );
  }
}
