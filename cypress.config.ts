import { defineConfig } from 'cypress';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const engineReportFile = process.env.SEERRNG_ENGINE_CYPRESS_REPORT;
const runnerTemp = process.env.RUNNER_TEMP;
let engineSpecs: string[] = [];

if (engineReportFile) {
  if (!runnerTemp || !isAbsolute(engineReportFile) || !isAbsolute(runnerTemp)) {
    throw new Error(
      'The hosted Cypress engine report requires absolute RUNNER_TEMP paths.'
    );
  }
  const reportRelative = relative(
    resolve(runnerTemp),
    resolve(engineReportFile)
  );
  if (
    !reportRelative ||
    reportRelative === '..' ||
    reportRelative.startsWith(`..${sep}`) ||
    isAbsolute(reportRelative)
  ) {
    throw new Error(
      'The hosted Cypress engine report must stay in RUNNER_TEMP.'
    );
  }
  const encodedSpecs = process.env.SEERRNG_ENGINE_CYPRESS_FILES;
  if (
    !encodedSpecs ||
    encodedSpecs.includes('\r') ||
    encodedSpecs.includes('\n') ||
    encodedSpecs.includes('\0')
  ) {
    throw new Error('Hosted Cypress specs require a safe comma-joined value.');
  }
  engineSpecs = encodedSpecs.split(',');
  if (
    engineSpecs.some(
      (file) =>
        !file ||
        file.includes('\\') ||
        file.includes(',') ||
        posix.isAbsolute(file) ||
        posix.normalize(file) !== file ||
        !file.startsWith('cypress/e2e/') ||
        file.endsWith('/')
    ) ||
    new Set(engineSpecs).size !== engineSpecs.length
  ) {
    throw new Error('Hosted Cypress specs are not safe normalized paths.');
  }
}

export default defineConfig({
  projectId: 'onnqy3',
  expose: {
    RUN_LIVE_AUTH_AUDIT: process.env.RUN_LIVE_AUTH_AUDIT === 'true',
    SEED_DATABASE: process.env.SEED_DATABASE === 'true',
  },
  e2e: {
    baseUrl: 'http://localhost:5055',
    setupNodeEvents(on) {
      if (engineReportFile) {
        on('after:run', async (results) => {
          const report = {
            schema: 'seerrng-hosted-cypress-result/v1',
            planSha256: process.env.SEERRNG_ENGINE_PLAN_SHA256 ?? '',
            unitId: process.env.SEERRNG_ENGINE_UNIT_ID ?? '',
            caseId: process.env.SEERRNG_ENGINE_CASE_ID ?? '',
            specs: engineSpecs,
            native: results,
          };
          await writeFile(
            engineReportFile,
            `${JSON.stringify(report, null, 2)}\n`,
            { encoding: 'utf8', flag: 'wx', mode: 0o600 }
          );
        });
      }
      on('task', {
        async seedDatabase() {
          await execFileAsync('pnpm', ['cypress:prepare'], {
            env: process.env,
          });
          return null;
        },
      });
    },
    video: true,
  },
  env: {
    ADMIN_EMAIL: 'admin@seerr.dev',
    ADMIN_PASSWORD: 'test1234',
    USER_EMAIL: 'demo@seerr.dev',
    USER_PASSWORD: 'test1234',
  },
  retries: {
    runMode: 2,
    openMode: 0,
  },
});
