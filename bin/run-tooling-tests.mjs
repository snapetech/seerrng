import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withGitBashOnPath } from './platform-tools.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { detectWorkerCapacity } from '../tools/validation-engine/runtime/cpu-capacity.mjs';

export function parseToolingWorkers(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
    throw new Error('Tooling options must be argument strings');
  if (args.length === 0) return undefined;
  if (args.length !== 1 || !/^--workers=[1-9]\d{0,2}$/.test(args[0]))
    throw new Error(
      'Tooling accepts only optional --workers=N (integer 1..256)'
    );
  const workers = Number(args[0].slice('--workers='.length));
  if (workers > 256)
    throw new Error('Tooling workers must be an integer 1..256');
  return workers;
}

const portableTests = [
  'bin/engine-browser-readiness.test.mjs',
  'bin/engine-cpu-capacity.test.mjs',
  'bin/engine-vitest-binding.test.mjs',
  'bin/engine-codeql-stage.test.mjs',
  'bin/engine-build-browser-stage.test.mjs',
  'bin/engine-staged-validation.test.mjs',
  'server/test/distributedStagedValidation.test.mjs',
  'bin/engine-pr-check-stages.test.mjs',
  'bin/engine-native-stage-context.test.mjs',
  'bin/engine-native-accounting.test.mjs',
  'bin/engine-native-process-ledger.test.mjs',
  'bin/engine-workflow-triggers.test.mjs',
  'bin/engine-github-binding.test.mjs',
  'bin/engine-hosted-github-execution.test.mjs',
  'bin/engine-hosted-test-inventory.test.mjs',
  'bin/engine-run-scoped-ledger.test.mjs',
  'bin/engine-controller-ordering.test.mjs',
  'bin/engine-distributed-adaptive-scheduler.test.mjs',
  'bin/engine-distributed-adaptive-timing-profile-store.test.mjs',
  'bin/engine-distributed-controller-adaptive-bridge.test.mjs',
  'bin/engine-distributed-linux-config.test.mjs',
  'bin/engine-distributed-linux-cli.test.mjs',
  'bin/engine-distributed-linux-controller-runner.test.mjs',
  'bin/engine-distributed-linux-host-adapters.test.mjs',
  'bin/engine-distributed-linux-host-containment.test.mjs',
  'bin/engine-distributed-linux-host-profile.test.mjs',
  'bin/engine-distributed-linux-installer.test.mjs',
  'bin/engine-distributed-linux-management.test.mjs',
  'bin/engine-distributed-linux-node-attestation.test.mjs',
  'bin/engine-distributed-linux-node-runner.test.mjs',
  'bin/engine-distributed-linux-production-runner.test.mjs',
  'bin/engine-distributed-linux-proof-parent.test.mjs',
  'bin/engine-distributed-linux-public-lifecycle.test.mjs',
  'bin/engine-distributed-linux-run-reconciliation.test.mjs',
  'bin/engine-distributed-linux-staged-bridge.test.mjs',
  'bin/engine-distributed-native-adapter.test.mjs',
  'bin/engine-distributed-node-enrollment-transport.test.mjs',
  'bin/engine-distributed-node-transport.test.mjs',
  'bin/engine-distributed-repository-stage.test.mjs',
  'bin/engine-distributed-shard-executor.test.mjs',
  'bin/engine-distributed-trusted-transport.test.mjs',
  'bin/engine-distributed-worker-bundle.test.mjs',
  'bin/engine-distributed-worker-image.test.mjs',
  'bin/local-validation.test.mjs',
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

const registeredToolingTests = new Set(portableTests);
const unregisteredEngineTests = readdirSync(
  fileURLToPath(new URL('.', import.meta.url))
)
  .filter((file) => /^engine-.*\.test\.mjs$/.test(file))
  .map((file) => `bin/${file}`)
  .filter((file) => !registeredToolingTests.has(file));
if (unregisteredEngineTests.length) {
  throw new Error(
    `Engine tooling suites are not registered: ${unregisteredEngineTests.join(', ')}`
  );
}

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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const workers =
    parseToolingWorkers(process.argv.slice(2)) ??
    detectWorkerCapacity({
      sourceRoot: resolve(fileURLToPath(new URL('..', import.meta.url))),
    }).configuredWorkers;

  if (process.platform === 'win32') {
    console.log(
      `Windows validation: running ${portableTests.length} portable tooling suites; ` +
        `${posixOnlyTests.length} POSIX filesystem/deployment suites remain mandatory in Linux CI.`
    );
  }

  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      `--test-concurrency=${workers}`,
      ...tests,
    ],
    {
      env: withGitBashOnPath(),
      stdio: 'inherit',
      windowsHide: true,
    }
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
