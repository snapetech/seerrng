import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdoptSeerrngTheme1791080000000 implements MigrationInterface {
  name = 'AdoptSeerrngTheme1791080000000';

  async up(runner: QueryRunner): Promise<void> {
    // Never repeat the reset after a user has chosen their new default.
    if (await runner.hasColumn('user_settings', 'themePalette')) return;
    await runner.query(
      'ALTER TABLE "user_settings" ADD COLUMN "themePalette" varchar NOT NULL DEFAULT \'seerr\''
    );
    if (await runner.hasColumn('user_settings', 'advancedThemeOverrides')) {
      await runner.query(
        'UPDATE "user_settings" SET "advancedThemeOverrides" = NULL'
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "user_settings" DROP COLUMN "themePalette"'
    );
  }
}
