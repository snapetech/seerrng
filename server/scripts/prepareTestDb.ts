import { seedTestDb } from '@server/utils/seedTestDb';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

const repoRoot = path.join(__dirname, '../..');
const sourceSettingsPath = path.join(
  repoRoot,
  'cypress/config/settings.cypress.json'
);
const defaultTestConfigDirectory = path.join(
  repoRoot,
  'cypress/runtime-config'
);
const configDirectory =
  process.env.CONFIG_DIRECTORY || defaultTestConfigDirectory;
const targetSettingsPath = path.join(configDirectory, 'settings.json');
const liveSettingsPath = path.join(repoRoot, 'config/settings.json');

const readJson = (filePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

const hasConfiguredService = (settings: Record<string, unknown>): boolean =>
  ['radarr', 'sonarr', 'lidarr', 'readarr'].some((service) => {
    const value = settings[service];
    return Array.isArray(value) && value.length > 0;
  });

const isLiveConfigOverwrite = (): boolean =>
  path.resolve(targetSettingsPath) === path.resolve(liveSettingsPath);

const prepareDb = async () => {
  if (
    isLiveConfigOverwrite() &&
    existsSync(targetSettingsPath) &&
    hasConfiguredService(readJson(targetSettingsPath)) &&
    process.env.SEERR_ALLOW_LIVE_CONFIG_OVERWRITE !== 'true'
  ) {
    throw new Error(
      [
        'Refusing to overwrite live config/settings.json with Cypress settings.',
        'Set CONFIG_DIRECTORY to a test config directory, or set',
        'SEERR_ALLOW_LIVE_CONFIG_OVERWRITE=true if you intentionally want to reset live settings.',
      ].join(' ')
    );
  }

  mkdirSync(path.join(configDirectory, 'db'), { recursive: true });

  // Copy over test settings.json
  copyFileSync(sourceSettingsPath, targetSettingsPath);

  await seedTestDb({
    preserveDb: process.env.PRESERVE_DB === 'true',
    withMigrations: process.env.WITH_MIGRATIONS === 'true',
  });
};

prepareDb();
