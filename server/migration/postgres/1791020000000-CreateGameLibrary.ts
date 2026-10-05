import { CreateGameLibrary1791020000000 as SqliteGameLibraryMigration } from '@server/migration/sqlite/1791020000000-CreateGameLibrary';

export class CreateGameLibrary1791020000000 extends SqliteGameLibraryMigration {
  async up(queryRunner: import('typeorm').QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_library_entry" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "externalKey" character varying(80) NOT NULL,
        "catalogId" integer,
        "category" character varying(8) NOT NULL,
        "title" character varying(512) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "coverUrl" character varying(2048) NOT NULL DEFAULT '',
        "releaseDate" character varying(32) NOT NULL DEFAULT '',
        "status" character varying(16) NOT NULL DEFAULT 'backlog',
        "isOwned" boolean NOT NULL DEFAULT false,
        "steamAppId" integer,
        "steamOwned" boolean NOT NULL DEFAULT false,
        "playtimeMinutes" integer NOT NULL DEFAULT 0,
        "storeName" character varying(120) NOT NULL DEFAULT '',
        "platformName" character varying(120) NOT NULL DEFAULT '',
        "shareWithHousehold" boolean NOT NULL DEFAULT false,
        "source" character varying(8) NOT NULL DEFAULT 'manual',
        "lastSyncedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_library_entry" PRIMARY KEY ("id"),
        CONSTRAINT "FK_game_library_entry_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_game_library_entry_user_key" ON "game_library_entry" ("userId", "externalKey")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_game_library_entry_user_catalog" ON "game_library_entry" ("userId", "catalogId")'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_game_library_entry_household" ON "game_library_entry" ("shareWithHousehold", "catalogId", "steamAppId")'
    );

    await queryRunner.query(`
      CREATE TABLE "game_library_account" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "steamId" character varying(20) NOT NULL,
        "profileName" character varying(128) NOT NULL DEFAULT '',
        "lastSyncCount" integer NOT NULL DEFAULT 0,
        "lastSyncedAt" TIMESTAMP,
        "linkedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_library_account" PRIMARY KEY ("id"),
        CONSTRAINT "FK_game_library_account_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_game_library_account_user" ON "game_library_account" ("userId")'
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_game_library_account_steam_id" ON "game_library_account" ("steamId")'
    );
  }
}
