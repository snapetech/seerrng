import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeWatchlistExternalIdToMediaType1790369500000 implements MigrationInterface {
  name = 'ScopeWatchlistExternalIdToMediaType1790369500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // externalId now also carries comic (ComicVine) watchlist identity
    // alongside book (Open Library), so the uniqueness check must be scoped
    // per media type to avoid cross-type collisions on the same string.
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "UNIQUE_USER_BOOK"`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "UNIQUE_USER_BOOK" UNIQUE ("externalId", "mediaType", "requestedById")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "UNIQUE_USER_BOOK"`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "UNIQUE_USER_BOOK" UNIQUE ("externalId", "requestedById")`
    );
  }
}
