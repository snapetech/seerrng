import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT ?? '5055';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const configDirectory =
  process.env.CONFIG_DIRECTORY ?? `${process.cwd()}/cypress/runtime-config`;

export default defineConfig({
  testDir: './playwright',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm cypress:start',
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      CONFIG_DIRECTORY: configDirectory,
      PORT: port,
    },
  },
});
