import { spawnSync } from 'node:child_process';
import { withGitBashOnPath } from './platform-tools.mjs';

const portableTests = [
  'bin/check-current-batch-contract-lib.test.mjs',
  'bin/check-i18n-lib.test.mjs',
  'bin/extract-messages-lib.test.mjs',
  'bin/check-pr-template.test.mjs',
  'bin/check-refreshed-ui-style-lib.test.mjs',
  'bin/duplicate-detector/index.test.mjs',
  'bin/duplicate-detector/triage.test.mjs',
  'scripts/brace-expansion.security.test.mjs',
  'scripts/chart-workflow.test.mjs',
  'scripts/check-container-security.test.mjs',
  'scripts/bookshelf-media-move.test.mjs',
  'scripts/backissue-service.test.mjs',
  'scripts/check-helm-security.test.mjs',
  'scripts/check-workflow-boundaries.test.mjs',
  'scripts/release-notes.test.mjs',
  'scripts/latest-published-release-tag.test.mjs',
  'scripts/release-workflow.test.mjs',
  'scripts/watch-github-run.test.mjs',
  'scripts/wait-for-launchpad-ppa.test.mjs',
  'scripts/replace-server-import-aliases.test.mjs',
  'scripts/verify-container-manifest.test.mjs',
  'packaging/unraid/unraid-template.test.mjs',
];

const posixOnlyTests = [
  'deploy/bookshelf-hardcover-migration.test.mjs',
  'deploy/bookshelf-migration-lab.test.mjs',
  'deploy/install-bookshelf-backend.test.mjs',
  'packaging/scripts/aur-scripts.test.mjs',
  'packaging/smoke/package-smoke.test.mjs',
  'scripts/build-release-assets.test.mjs',
  'scripts/relink-plex-from-local-preferences.test.mjs',
  'scripts/store-copr-kerberos-openbao.test.mjs',
  'scripts/verify-live-deployment.test.mjs',
];

const tests =
  process.platform === 'win32'
    ? portableTests
    : [...portableTests, ...posixOnlyTests];

if (process.platform === 'win32') {
  console.log(
    `Windows validation: running ${portableTests.length} portable tooling suites; ` +
      `${posixOnlyTests.length} POSIX filesystem/deployment suites remain mandatory in Linux CI.`
  );
}

const result = spawnSync(process.execPath, ['--test', ...tests], {
  env: withGitBashOnPath(),
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
