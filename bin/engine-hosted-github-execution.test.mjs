import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  admitHostedGithubUnit as admitHostedGithubUnitCore,
  executeHostedTestLane as executeHostedTestLaneCore,
  loadHostedReceiptDirectory,
  materializeHostedVitestLane as materializeHostedVitestLaneCore,
  reconcileHostedGithubExecution,
  sealHostedGithubUnitReceipt as sealHostedGithubUnitReceiptCore,
  verifyHostedAdmissionDecision,
  verifyHostedGithubPlanContext,
  verifyHostedUnitReceipt,
} from '../tools/validation-engine/runtime/hosted-github-execution.mjs';
import { createHostedGithubPlan } from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
import {
  canonicalJsonSha256,
  createRunScopedLedger,
  createSuccessReceipt,
  recordSuccessfulWork,
  workKeySha256,
} from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const temporary = new Set();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const UNIT_CASE_ID = 'shard-01-of-04';
const CYPRESS_CASE_ID = 'shard-01-of-06';

function caseLane(plan, unitId, caseId, laneId) {
  const unit = plan.units.find((entry) => entry.id === unitId);
  const assignment = unit?.caseAssignments.find(
    (entry) => entry.caseId === caseId
  );
  const lane = assignment?.lanes.find((entry) => entry.id === laneId);
  if (!lane)
    throw new Error(`Missing fixture case lane: ${unitId}/${caseId}/${laneId}`);
  return lane;
}

function caseForFile(plan, unitId, laneId, file) {
  const unit = plan.units.find((entry) => entry.id === unitId);
  const matches = unit?.caseAssignments.filter((assignment) =>
    assignment.lanes.some(
      (lane) => lane.id === laneId && lane.files.includes(file)
    )
  );
  if (matches?.length !== 1)
    throw new Error(`Fixture file is not assigned exactly once: ${file}`);
  return matches[0].caseId;
}

function playwrightEnvironment(environment) {
  return {
    ...environment,
    CONFIG_DIRECTORY: path.join(
      environment.RUNNER_TEMP,
      'seerrng-playwright-runtime-config'
    ),
    PORT: '5055',
    PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:5055',
  };
}

function bindShardedCase(options) {
  const caseId =
    options.caseId ??
    (options.unitId === 'ci-unit-test'
      ? UNIT_CASE_ID
      : options.unitId === 'cypress-run'
        ? CYPRESS_CASE_ID
        : undefined);
  let environment = options.environment;
  if (
    options.unitId === 'cypress-run' &&
    environment &&
    !Object.hasOwn(environment, 'SEERRNG_ENGINE_CYPRESS_FILES')
  ) {
    environment = {
      ...environment,
      SEERRNG_ENGINE_CYPRESS_FILES: caseLane(
        options.plan,
        options.unitId,
        caseId,
        'cypress'
      ).files.join(','),
    };
  }
  if (
    options.unitId === 'ci-playwright' &&
    environment &&
    !Object.hasOwn(environment, 'PLAYWRIGHT_BASE_URL')
  ) {
    environment = playwrightEnvironment(environment);
  }
  return { ...options, ...(caseId ? { caseId } : {}), environment };
}

const admitHostedGithubUnit = (options) =>
  admitHostedGithubUnitCore(bindShardedCase(options));
const executeHostedTestLane = (options) =>
  executeHostedTestLaneCore(bindShardedCase(options));
const materializeHostedVitestLane = (options) =>
  materializeHostedVitestLaneCore(bindShardedCase(options));
const sealHostedGithubUnitReceipt = (options) =>
  sealHostedGithubUnitReceiptCore(bindShardedCase(options));

test.afterEach(() => {
  for (const directory of temporary)
    rmSync(directory, { recursive: true, force: true });
  temporary.clear();
});

function writeAbsolute(file, contents) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function write(root, file, contents) {
  writeAbsolute(path.join(root, file), contents);
}

function command(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], {
    ...(encoding === null ? {} : { encoding }),
    windowsHide: true,
  });
}

function fixture({ zeroCaseNativeFile = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hosted-github-execution-'));
  temporary.add(root);
  const runnerTemp = mkdtempSync(
    path.join(tmpdir(), 'hosted-github-runner-temp-')
  );
  temporary.add(runnerTemp);
  const configDirectory = path.join(
    runnerTemp,
    'seerrng-cypress-runtime-config'
  );
  const playwrightConfigDirectory = path.join(
    runnerTemp,
    'seerrng-playwright-runtime-config'
  );
  for (const directory of [
    'server',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
    'cypress',
    'playwright',
    'gen-docs',
  ])
    mkdirSync(path.join(root, directory), { recursive: true });
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: {
        'security:council':
          'node scripts/check-workflow-boundaries.mjs && pnpm test:tooling && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh',
        'test:ci':
          'vitest run --reporter=default --reporter=junit --outputFile.junit=report.xml',
        'test:tooling': 'node bin/run-tooling-tests.mjs',
        'test:playwright': 'pnpm cypress:prepare && playwright test',
      },
    })
  );
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write(
    root,
    'vitest.config.mts',
    `import { engineVitestProjects } from './tools/validation-engine/runtime/vitest-binding.mjs';
    const include = [
      'server/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.vitest.test.ts',
    ];
    const exclude = ['node_modules/**', 'dist/**'];
    const alias = {
      'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts'),
    };
    const config = {
      test: {
        projects: engineVitestProjects({
          include,
          exclude,
          workers: capacity.configuredWorkers,
        }),
      },
    };
    export { alias, config };
    `
  );
  write(root, 'server/test/vitestNodeTest.ts', 'export const test = true;\n');
  write(
    root,
    'gen-docs/package.json',
    JSON.stringify({
      scripts: {
        'test:security': 'node --test scripts/image-size-security.test.mjs',
      },
    })
  );
  write(
    root,
    'cypress.config.ts',
    "import { defineConfig } from 'cypress'; export default defineConfig({ e2e: {} });\n"
  );
  write(
    root,
    'playwright.config.ts',
    `import { defineConfig } from '@playwright/test';
     const port = process.env.PORT ?? '5055';
     const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? \`http://127.0.0.1:\${port}\`;
     const configDirectory = process.env.CONFIG_DIRECTORY ?? \`\${process.cwd()}/cypress/runtime-config\`;
     export default defineConfig({
       testDir: './playwright', fullyParallel: false, workers: 1,
       use: { baseURL },
       webServer: {
         command: 'pnpm cypress:start', url: \`\${baseURL}/login\`,
         env: { CONFIG_DIRECTORY: configDirectory, PORT: port },
       },
     });\n`
  );
  write(
    root,
    'bin/run-tooling-tests.mjs',
    `import { spawnSync } from 'node:child_process';
     const portableTests = ['bin/tool.test.mjs'];
     const posixOnlyTests = ['deploy/posix.test.mjs'];
     const tests = process.platform === 'win32'
       ? portableTests
       : [...portableTests, ...posixOnlyTests];
     const workers = 2;
      spawnSync(
        process.execPath,
        [
          '--test',
          '--test-reporter=tap',
          \`--test-concurrency=\${workers}\`,
          ...tests,
        ],
        { stdio: 'inherit' }
      );
    `
  );
  write(root, 'server/native.test.ts', "import test from 'node:test';\n");
  write(root, 'server/extra.test.ts', "import { test } from 'vitest';\n");
  write(root, 'src/unit.test.tsx', "import { test } from 'vitest';\n");
  write(root, 'src/extra.test.tsx', "import { test } from 'vitest';\n");
  write(
    root,
    'src/native.test.mjs',
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('native one', () => assert.equal(1, 1));\n"
  );
  write(
    root,
    'server/native-two.test.mjs',
    zeroCaseNativeFile
      ? "import test from 'node:test'; void test;\n"
      : "import test from 'node:test'; import assert from 'node:assert/strict'; test('native two', () => assert.equal(2, 2));\n"
  );
  write(
    root,
    'server/native-three.test.mjs',
    "import test from 'node:test'; test('native three', () => {});\n"
  );
  write(
    root,
    'src/native-four.test.mjs',
    "import test from 'node:test'; test('native four', () => {});\n"
  );
  write(root, 'bin/tool.test.mjs', "import test from 'node:test';\n");
  write(root, 'deploy/posix.test.mjs', "import test from 'node:test';\n");
  write(
    root,
    'gen-docs/scripts/image-size-security.test.mjs',
    "import test from 'node:test'; test('docs security', () => {});\n"
  );
  for (const name of [
    'admin',
    'discover',
    'login',
    'profile',
    'request',
    'search',
    'settings',
  ])
    write(
      root,
      `cypress/e2e/${name}.cy.ts`,
      `describe('${name}', () => {});\n`
    );
  write(
    root,
    'playwright/settings.spec.ts',
    "import { test } from '@playwright/test'; test('settings', async () => {});\n"
  );
  const workflowFiles = {
    ci: '.github/workflows/ci.yml',
    codeql: '.github/workflows/codeql.yml',
    cypress: '.github/workflows/cypress.yml',
    testDocs: '.github/workflows/test-docs.yml',
    docsLinks: '.github/workflows/docs-link-check.yml',
    helm: '.github/workflows/lint-helm-charts.yml',
  };
  for (const [name, file] of Object.entries(workflowFiles))
    write(
      root,
      file,
      `name: ${name}\nsteps:\n  - uses: actions/checkout@${'1'.repeat(40)}\n`
    );
  command(root, ['init', '--initial-branch=main']);
  command(root, ['config', 'user.name', 'Engine Test']);
  command(root, ['config', 'user.email', 'engine@example.invalid']);
  command(root, ['config', 'core.autocrlf', 'false']);
  command(root, ['add', '.']);
  command(root, ['commit', '-m', 'fixture']);
  writeAbsolute(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify({
      clientId: 'engine-fixture',
      main: { applicationTitle: 'SeerrNG Engine Fixture' },
    })
  );
  writeAbsolute(
    path.join(playwrightConfigDirectory, 'settings.json'),
    JSON.stringify({
      clientId: 'engine-playwright-fixture',
      main: { applicationTitle: 'SeerrNG Playwright Fixture' },
    })
  );
  write(root, 'node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9.0\n');
  write(
    root,
    'gen-docs/node_modules/.pnpm/lock.yaml',
    'lockfileVersion: 9.0\n'
  );
  const eventFile = path.join(root, '.github-event.json');
  writeFileSync(
    eventFile,
    `${JSON.stringify({
      repository: {
        full_name: 'JohnCronk79/seerrng',
        default_branch: 'main',
      },
      pull_request: {
        base: { sha: 'f'.repeat(40) },
        head: { sha: 'e'.repeat(40) },
        body: 'Release note: engine fixture',
        title: 'Engine fixture pull request',
      },
    })}\n`
  );
  const candidate = {
    repository: 'JohnCronk79/seerrng',
    commit: command(root, ['rev-parse', 'HEAD']).trim(),
    tree: command(root, ['rev-parse', 'HEAD^{tree}']).trim(),
    lockSha256: hash(readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    sourceSha256: hash(
      command(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
    ),
  };
  const workflowHashes = Object.fromEntries(
    Object.entries(workflowFiles).map(([name, file]) => [
      name,
      hash(readFileSync(path.join(root, file))),
    ])
  );
  const plan = createHostedGithubPlan({
    candidate,
    event: {
      name: 'pull_request',
      runId: '12345',
      runAttempt: '1',
      executionSha: candidate.commit,
      headSha: 'e'.repeat(40),
      baseSha: 'f'.repeat(40),
      ref: 'refs/pull/42/merge',
      baseRef: 'main',
      actorType: 'User',
      pathFilterMode: 'changed-files',
    },
    changedFiles: ['.github/workflows/ci.yml'],
    workflowHashes,
    testInventory: createHostedTestInventory(root),
  });
  const environment = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: candidate.repository,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: candidate.commit,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_REF: 'refs/pull/42/merge',
    GITHUB_BASE_REF: 'main',
    CI: 'true',
    RUNNER_TEMP: runnerTemp,
    CONFIG_DIRECTORY: configDirectory,
    RUNNER_OS: process.platform,
    RUNNER_ARCH: process.arch,
    ImageOS: 'engine-fixture',
    ImageVersion: '1',
  };
  return { root, plan, environment, runnerTemp, configDirectory };
}

function scopeFromPlan(plan) {
  return {
    run: {
      provider: 'github-actions',
      repository: plan.candidate.repository,
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
    },
    candidate: {
      repository: plan.candidate.repository,
      commit: plan.candidate.commit,
      tree: plan.candidate.tree,
      sourceSha256: plan.candidate.sourceSha256,
    },
    planSha256: plan.planSha256,
  };
}

function reseal(value, sealField) {
  const unsigned = structuredClone(value);
  delete unsigned[sealField];
  return { ...unsigned, [sealField]: canonicalJsonSha256(unsigned) };
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function writeVitestJunit(
  root,
  plan,
  {
    caseId = UNIT_CASE_ID,
    files,
    zeroFile = null,
    failureFile = null,
    allSkipped = false,
    allSkippedFile = null,
    partialSkippedFile = null,
  } = {}
) {
  const lane = caseLane(plan, 'ci-unit-test', caseId, 'vitest');
  files ??= lane.files;
  const suites = files.map((file) => {
    const tests = file === zeroFile ? 0 : file === partialSkippedFile ? 2 : 1;
    const failures = file === failureFile ? 1 : 0;
    const skipped =
      allSkipped || file === allSkippedFile || file === partialSkippedFile
        ? 1
        : 0;
    const active = tests - skipped;
    const body = [
      ...(active
        ? [`<testcase classname="${xmlEscape(file)}" name="passes">`]
        : []),
      ...(failures ? ['<failure message="failed" />'] : []),
      ...(active ? ['</testcase>'] : []),
      ...(skipped
        ? [
            `<testcase classname="${xmlEscape(file)}" name="skipped"><skipped /></testcase>`,
          ]
        : []),
    ].join('');
    return `<testsuite name="${xmlEscape(file)}" tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}">${body}</testsuite>`;
  });
  const total = files.reduce(
    (sum, file) =>
      sum + (file === zeroFile ? 0 : file === partialSkippedFile ? 2 : 1),
    0
  );
  const failures = files.filter((file) => file === failureFile).length;
  const report = path.join(root, 'report.xml');
  writeFileSync(
    report,
    `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${total}" failures="${failures}" errors="0">${suites.join('')}</testsuites>\n`
  );
  return report;
}

async function createUnitTestEvidence({
  root,
  plan,
  environment,
  receiptDir,
  caseId = UNIT_CASE_ID,
  evidenceRoot = root,
}) {
  mkdirSync(evidenceRoot, { recursive: true });
  const nodeReport = path.join(evidenceRoot, 'seerrng-engine-node-tests.json');
  await executeHostedTestLane({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    caseId,
    laneId: 'node-test-mjs',
    receiptDir,
    reportFile: nodeReport,
    environment,
    stdout: { write() {} },
    stderr: { write() {} },
  });
  return {
    junit: writeVitestJunit(evidenceRoot, plan, { caseId }),
    node: nodeReport,
  };
}

function writeCypressEvidence({
  root,
  plan,
  caseId = CYPRESS_CASE_ID,
  evidenceRoot = root,
  active = true,
}) {
  const specs = caseLane(plan, 'cypress-run', caseId, 'cypress').files;
  const runs = specs.map((spec) => {
    const state = active ? 'passed' : 'pending';
    return {
      spec: {
        relative: spec,
        absolute: path.join(root, ...spec.split('/')),
      },
      error: null,
      tests: [
        {
          title: ['fixture', spec],
          state,
          attempts: active ? [{ state: 'passed' }] : [],
          duration: active ? 1 : null,
          displayError: null,
        },
      ],
      stats: {
        passes: active ? 1 : 0,
        failures: 0,
        pending: active ? 0 : 1,
        skipped: 0,
        tests: 1,
      },
    };
  });
  mkdirSync(evidenceRoot, { recursive: true });
  const report = path.join(evidenceRoot, 'seerrng-engine-cypress-result.json');
  writeFileSync(
    report,
    `${JSON.stringify({
      schema: 'seerrng-hosted-cypress-result/v1',
      planSha256: plan.planSha256,
      unitId: 'cypress-run',
      caseId,
      specs,
      native: {
        status: 'finished',
        runs,
        totalPassed: active ? specs.length : 0,
        totalFailed: 0,
        totalPending: active ? 0 : specs.length,
        totalSkipped: 0,
        totalTests: specs.length,
        totalDuration: active ? specs.length : 0,
        browserName: 'Electron',
        cypressVersion: 'fixture',
      },
    })}\n`
  );
  return report;
}

function writePlaywrightEvidence({
  root,
  plan,
  environment,
  evidenceRoot = root,
  includeAmbientEnvironment = false,
}) {
  const lane = caseLane(plan, 'ci-playwright', 'default', 'playwright');
  const files = lane.files.map((file) => file.replace(/^playwright\//u, ''));
  mkdirSync(evidenceRoot, { recursive: true });
  const report = path.join(
    evidenceRoot,
    'seerrng-engine-playwright-result.json'
  );
  writeFileSync(
    report,
    `${JSON.stringify({
      config: {
        configFile: path.join(root, 'playwright.config.ts'),
        rootDir: path.join(root, 'playwright'),
        fullyParallel: false,
        workers: 1,
        webServer: {
          command: 'pnpm cypress:start',
          url: `${environment.PLAYWRIGHT_BASE_URL}/login`,
          env: {
            CONFIG_DIRECTORY: environment.CONFIG_DIRECTORY,
            PORT: environment.PORT,
            ...(includeAmbientEnvironment ? { HOME: '/unsafe' } : {}),
          },
        },
      },
      suites: files.map((file) => ({
        title: file,
        file,
        specs: [
          {
            title: 'fixture',
            ok: true,
            file,
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                results: [{ status: 'passed' }],
              },
            ],
          },
        ],
      })),
      errors: [],
      stats: {
        duration: 1,
        expected: files.length,
        skipped: 0,
        unexpected: 0,
        flaky: 0,
      },
    })}\n`
  );
  return report;
}

test('hosted admission is execute-only and rejects a finalized success', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  verifyHostedGithubPlanContext(root, plan, { environment });
  assert.throws(
    () =>
      admitHostedGithubUnitCore({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-unit-test',
        receiptDir: path.join(root, 'receipts-without-case'),
        environment,
      }),
    /Exact hosted engine case is required/
  );
  const first = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const { admission } = first;
  assert.equal(admission.caseId, UNIT_CASE_ID);
  assert.equal(first.decision.action, 'execute');
  assert.equal(first.decision.schema, 'seerrng-hosted-admission-decision/v2');
  assert.deepEqual(Object.keys(first.decision).toSorted(), [
    'action',
    'admissionSha256',
    'decisionSha256',
    'schema',
    'workKeySha256',
  ]);
  assert.equal(verifyHostedAdmissionDecision(first.decision), first.decision);
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-unit-test',
        receiptDir,
        environment,
      }),
    /already admitted; duplicate execution is not allowed/
  );
  const unitEvidence = await createUnitTestEvidence({
    root,
    plan,
    environment,
    receiptDir,
  });
  const { receipt } = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [unitEvidence.junit, unitEvidence.node],
    environment,
  });
  assert.equal(receipt.jobStatus, 'success');
  assert.equal(receipt.successReceipt.outcome.completed, true);
  assert.equal(verifyHostedUnitReceipt(receipt), receipt);
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-unit-test',
        receiptDir,
        environment,
      }),
    /already finalized; test-result reuse is disabled/
  );
  const tampered = structuredClone(receipt);
  tampered.evidence[0].bytes += 1;
  assert.throws(
    () => verifyHostedUnitReceipt(tampered),
    /seal or schema is invalid/
  );
  const tamperedDecision = structuredClone(first.decision);
  tamperedDecision.action = 'reuse-success';
  assert.throws(
    () => verifyHostedAdmissionDecision(tamperedDecision),
    /seal or schema is invalid/
  );
  assert.throws(
    () =>
      verifyHostedAdmissionDecision({
        ...first.decision,
        reusableSuccessReceiptSha256: receipt.successReceipt.receiptSha256,
      }),
    /exact field set/
  );
});

test('admission binds narrow generated setup and ignores caches and secrets', () => {
  const { root, plan, environment, configDirectory } = fixture();
  const baseline = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-baseline'),
    environment,
  }).admission;

  write(root, 'node_modules/.cache/bundler/state.bin', 'cache noise\n');
  write(root, '.next/cache/webpack/state.bin', 'build cache noise\n');
  writeAbsolute(
    path.join(configDirectory, 'logs/cypress.log'),
    'runtime log\n'
  );
  writeFileSync(
    path.join(root, '.git/description'),
    'irrelevant git metadata\n'
  );
  const noisy = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-noise'),
    environment: {
      ...environment,
      CYPRESS_RECORD_KEY: 'must-not-enter-a-receipt',
      STORE_PATH: '/irrelevant/pnpm/store',
    },
  }).admission;
  assert.equal(noisy.workKeySha256, baseline.workKeySha256);
  assert.equal(
    noisy.identity.setup.configSha256,
    baseline.identity.setup.configSha256
  );

  const differentTimezone = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-timezone'),
    environment: { ...environment, TZ: 'Pacific/Kiritimati' },
  }).admission;
  assert.notEqual(differentTimezone.workKeySha256, baseline.workKeySha256);

  writeAbsolute(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify({
      clientId: 'changed-after-admission',
      main: { applicationTitle: 'Changed behavior' },
    })
  );
  const changedSettings = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-settings'),
    environment,
  }).admission;
  assert.notEqual(changedSettings.workKeySha256, baseline.workKeySha256);
  assert.notEqual(
    changedSettings.identity.setup.configSha256,
    baseline.identity.setup.configSha256
  );
});

test('Cypress admission rejects runtime settings inside the source tree', () => {
  const { root, plan, environment } = fixture();
  const runnerTemp = root;
  const configDirectory = path.join(root, 'seerrng-cypress-runtime-config');
  writeAbsolute(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify({ clientId: 'source-tree-runtime' })
  );
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir: path.join(root, 'receipts-source-runtime'),
        environment: {
          ...environment,
          RUNNER_TEMP: runnerTemp,
          CONFIG_DIRECTORY: configDirectory,
        },
      }),
    /Cypress runtime config cannot be inside the source tree/
  );
});

test('Cypress admission rejects a symlinked runner-temp config boundary', () => {
  const { root, plan, environment, configDirectory } = fixture();
  const linkedConfig = mkdtempSync(
    path.join(tmpdir(), 'hosted-github-linked-cypress-config-')
  );
  temporary.add(linkedConfig);
  writeAbsolute(
    path.join(linkedConfig, 'settings.json'),
    JSON.stringify({ clientId: 'linked-runtime' })
  );
  rmSync(configDirectory, { recursive: true, force: true });
  symlinkSync(
    linkedConfig,
    configDirectory,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir: path.join(root, 'receipts-linked-runtime'),
        environment,
      }),
    /Unsafe symbolic-link Cypress runtime settings/
  );
});

test('Cypress admission and native evidence are bound to one exact shard', () => {
  const { root, plan, environment } = fixture();
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir: path.join(root, 'receipts-mismatched-specs'),
        environment: {
          ...environment,
          SEERRNG_ENGINE_CYPRESS_FILES: 'cypress/e2e/unplanned.cy.ts',
        },
      }),
    /specs do not match the planned shard/
  );

  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment,
  });
  assert.throws(
    () =>
      sealHostedGithubUnitReceipt({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        jobStatus: 'success',
        environment,
      }),
    /requires its exact hosted evidence set/
  );
  const evidence = writeCypressEvidence({ root, plan });
  const forged = JSON.parse(readFileSync(evidence, 'utf8'));
  forged.caseId = 'shard-02-of-06';
  writeFileSync(evidence, `${JSON.stringify(forged)}\n`);
  assert.throws(
    () =>
      sealHostedGithubUnitReceipt({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        jobStatus: 'success',
        evidenceFiles: [evidence],
        environment,
      }),
    /not bound to its unit\/case/
  );
});

test('Playwright admission and native evidence close the exact browser lane', () => {
  const { root, plan, environment: baseEnvironment } = fixture();
  const environment = playwrightEnvironment(baseEnvironment);
  const receiptDir = path.join(root, 'playwright-receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-playwright',
    receiptDir,
    environment,
  });
  const evidence = writePlaywrightEvidence({
    root,
    plan,
    environment,
    includeAmbientEnvironment: true,
  });
  assert.throws(
    () =>
      sealHostedGithubUnitReceipt({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-playwright',
        receiptDir,
        jobStatus: 'success',
        evidenceFiles: [evidence],
        environment,
      }),
    /hosted Playwright web-server environment requires its exact field set/
  );
  writePlaywrightEvidence({ root, plan, environment });
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-playwright',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [evidence],
    environment,
  });
  assert.deepEqual(sealed.receipt.caseResults.lanes[0], {
    id: 'playwright',
    proof: 'native-playwright-file-closure',
    files: ['playwright/settings.spec.ts'],
    fileCount: 1,
    tests: 1,
    active: 1,
    passed: 1,
    failures: 0,
    skipped: 0,
    reportSha256: hash(readFileSync(evidence)),
  });
});

test('a pending-only Cypress shard seals for aggregate active-test review', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment,
  });
  const evidence = writeCypressEvidence({ root, plan, active: false });
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [evidence],
    environment,
  });
  const cypress = sealed.receipt.caseResults.lanes[0];
  assert.equal(cypress.active, 0);
  assert.equal(cypress.pending, 1);
  assert.equal(cypress.failures, 0);
});

test('external Cypress log symlinks allow the admitted settings snapshot to seal', () => {
  const { root, plan, environment, configDirectory } = fixture();
  const receiptDir = path.join(root, 'receipts');
  const machineLogsTarget = mkdtempSync(
    path.join(tmpdir(), 'hosted-github-cypress-machine-logs-')
  );
  temporary.add(machineLogsTarget);
  mkdirSync(path.join(configDirectory, 'logs'), { recursive: true });
  symlinkSync(
    machineLogsTarget,
    path.join(configDirectory, 'logs/.machinelogs.json'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const admitted = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment,
  });
  write(root, '.next/cache/build-output.bin', 'normal build output\n');
  writeAbsolute(
    path.join(configDirectory, 'logs/server.log'),
    'normal runtime output\n'
  );
  const cypressEvidence = writeCypressEvidence({ root, plan });
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [cypressEvidence],
    environment: { ...environment, STORE_PATH: '/post-install/store' },
  });
  assert.equal(
    sealed.receipt.admissionSha256,
    admitted.admission.admissionSha256
  );
  assert.equal(sealed.receipt.workKeySha256, admitted.admission.workKeySha256);
  assert.equal(
    sealed.receipt.successReceipt.identity.setup.configSha256,
    admitted.admission.identity.setup.configSha256
  );
  const cypress = sealed.receipt.caseResults.lanes[0];
  assert.equal(cypress.proof, 'native-cypress-per-case-closure');
  assert.deepEqual(
    cypress.files,
    caseLane(plan, 'cypress-run', CYPRESS_CASE_ID, 'cypress').files
  );
  assert.equal(cypress.active, 1);
  assert.equal(cypress.failures, 0);

  writeAbsolute(
    path.join(configDirectory, 'settings.json'),
    JSON.stringify({ clientId: 'adversarial-change' })
  );
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        environment,
      }),
    /does not match current work identity/
  );
});

test('admission binds the installed dependency lock for the executing workspace', () => {
  const { root, plan, environment } = fixture();
  const docsBefore = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'test-docs-build',
    receiptDir: path.join(root, 'receipts-docs-before'),
    environment,
  }).admission;
  const rootBefore = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir: path.join(root, 'receipts-root-before'),
    environment,
  }).admission;

  write(
    root,
    'gen-docs/node_modules/.pnpm/lock.yaml',
    'lockfileVersion: 9.0\nsettings: changed\n'
  );
  const docsAfter = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'test-docs-build',
    receiptDir: path.join(root, 'receipts-docs-after'),
    environment,
  }).admission;
  const rootAfter = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir: path.join(root, 'receipts-root-after'),
    environment,
  }).admission;

  assert.notEqual(docsAfter.workKeySha256, docsBefore.workKeySha256);
  assert.equal(rootAfter.workKeySha256, rootBefore.workKeySha256);
});

test('release-note admission binds the exact event text used by the native step', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  const payload = JSON.parse(
    readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')
  );
  payload.pull_request.body = 'A changed release-note decision';
  writeFileSync(environment.GITHUB_EVENT_PATH, `${JSON.stringify(payload)}\n`);
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-release-notes',
        receiptDir,
        environment,
      }),
    /does not match current work identity/
  );
});

test('successful hosted work cannot be admitted a second time', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-release-notes',
        receiptDir,
        environment,
      }),
    /already finalized; test-result reuse is disabled/
  );
});

test('Cypress push success cannot be admitted a second time', () => {
  const { root, plan, environment } = fixture();
  const baseSha = 'd'.repeat(40);
  const pushPlan = createHostedGithubPlan({
    candidate: plan.candidate,
    event: {
      name: 'push',
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
      executionSha: plan.candidate.commit,
      headSha: plan.candidate.commit,
      baseSha,
      ref: 'refs/heads/main',
      baseRef: null,
      actorType: null,
      pathFilterMode: 'changed-files',
    },
    changedFiles: ['.github/workflows/cypress.yml'],
    workflowHashes: plan.workflowHashes,
    testInventory: plan.testInventory,
  });
  writeFileSync(
    environment.GITHUB_EVENT_PATH,
    `${JSON.stringify({
      repository: {
        full_name: plan.candidate.repository,
        default_branch: 'main',
      },
      before: baseSha,
      after: plan.candidate.commit,
      head_commit: { message: 'Push Cypress baseline' },
    })}\n`
  );
  const pushEnvironment = {
    ...environment,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
  };
  delete pushEnvironment.GITHUB_BASE_REF;
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan: pushPlan,
    expectedPlanSha256: pushPlan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment: pushEnvironment,
  });
  const cypressEvidence = writeCypressEvidence({
    root,
    plan: pushPlan,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan: pushPlan,
    expectedPlanSha256: pushPlan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [cypressEvidence],
    environment: pushEnvironment,
  });
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan: pushPlan,
        expectedPlanSha256: pushPlan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        environment: pushEnvironment,
      }),
    /already finalized; test-result reuse is disabled/
  );
});

test('finalized artifacts never authorize a second execution', async () => {
  for (const mode of [
    'missing-receipt',
    'missing-ledger',
    'failed',
    'tampered',
    'resealed-case-results',
  ]) {
    const { root, plan, environment } = fixture();
    const receiptDir = path.join(root, 'receipts');
    const admitted = admitHostedGithubUnit({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      environment,
    });
    const unitEvidence =
      mode === 'failed'
        ? null
        : await createUnitTestEvidence({
            root,
            plan,
            environment,
            receiptDir,
          });
    const sealed = sealHostedGithubUnitReceipt({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      jobStatus: mode === 'failed' ? 'failure' : 'success',
      evidenceFiles: unitEvidence
        ? [unitEvidence.junit, unitEvidence.node]
        : [],
      environment,
    });
    if (mode === 'missing-receipt') rmSync(sealed.paths.receipt);
    if (mode === 'missing-ledger') rmSync(sealed.paths.ledger);
    if (mode === 'tampered') {
      const receipt = JSON.parse(readFileSync(sealed.paths.receipt, 'utf8'));
      receipt.evidence.push({ name: 'forged', bytes: 1, sha256: hash('x') });
      writeFileSync(sealed.paths.receipt, `${JSON.stringify(receipt)}\n`);
    }
    if (mode === 'resealed-case-results') {
      const receipt = JSON.parse(readFileSync(sealed.paths.receipt, 'utf8'));
      receipt.caseResults.lanes[0].files[0] = 'src/forged.test.ts';
      writeFileSync(
        sealed.paths.receipt,
        `${JSON.stringify(reseal(receipt, 'receiptSha256'))}\n`
      );
    }
    assert.throws(
      () =>
        admitHostedGithubUnit({
          root,
          plan,
          expectedPlanSha256: plan.planSha256,
          unitId: 'ci-unit-test',
          receiptDir,
          environment,
        }),
      /already finalized; test-result reuse is disabled/,
      mode
    );
    assert.equal(admitted.decision.action, 'execute');
  }
});

test('distinct planned cases receive independent execute-only admissions', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'actions',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'actions',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  const distinct = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'javascript',
    receiptDir,
    environment,
  });
  assert.equal(distinct.decision.action, 'execute');
  assert.deepEqual(Object.keys(distinct.decision).toSorted(), [
    'action',
    'admissionSha256',
    'decisionSha256',
    'schema',
    'workKeySha256',
  ]);
});

test('hosted admission rejects a different attempt and plan hash', () => {
  const { root, plan, environment } = fixture();
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: '0'.repeat(64),
        unitId: 'ci-release-notes',
        receiptDir: path.join(root, 'receipts'),
        environment,
      }),
    /expected-plan hash mismatch/
  );
  assert.throws(
    () =>
      verifyHostedGithubPlanContext(root, plan, {
        environment: { ...environment, GITHUB_RUN_ATTEMPT: '2' },
      }),
    /GITHUB_RUN_ATTEMPT/
  );
});

test('Vitest materialization binds one admitted shard at exactly GitHub N', () => {
  const { root, plan, environment, runnerTemp } = fixture();
  const receiptDir = path.join(root, 'receipts');
  const outputFile = path.join(runnerTemp, 'seerrng-engine-vitest.config.mts');
  assert.throws(
    () =>
      materializeHostedVitestLane({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-unit-test',
        receiptDir,
        outputFile,
        environment,
      }),
    /Missing hosted admission/
  );
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  assert.throws(
    () =>
      materializeHostedVitestLane({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-unit-test',
        receiptDir,
        outputFile: path.join(root, 'unsafe-vitest.config.mts'),
        environment,
      }),
    /exact runner-temp path/
  );
  const result = materializeHostedVitestLane({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    outputFile,
    environment,
  });
  const expected = caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest');
  assert.equal(result.schema, 'seerrng-hosted-vitest-materialization/v1');
  assert.equal(result.caseId, UNIT_CASE_ID);
  assert.deepEqual(result.files, expected.files);
  assert.equal(result.filesSha256, expected.filesSha256);
  assert.ok(result.configuredWorkers > 0);
  assert.match(result.configSha256, /^[a-f0-9]{64}$/);
  const source = readFileSync(outputFile, 'utf8');
  assert.ok(source.includes(`files: ${JSON.stringify(expected.files)}`));
  assert.ok(
    source.includes(`maxWorkers: ${JSON.stringify(result.configuredWorkers)}`)
  );
  assert.match(source, /passWithNoTests: false/);
});

test('engine executes one planned native Node shard at exactly GitHub N', async () => {
  const { root, plan, environment } = fixture();
  const reportFile = path.join(root, 'seerrng-engine-node-tests.json');
  const receiptDir = path.join(root, 'receipts');
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      laneId: 'node-test-mjs',
      receiptDir: path.join(root, 'missing-admission'),
      reportFile,
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /Missing hosted admission/
  );
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-i18n',
      laneId: 'node-test-mjs',
      receiptDir,
      reportFile,
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /not assigned/
  );
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const result = await executeHostedTestLane({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    laneId: 'node-test-mjs',
    receiptDir,
    reportFile,
    environment,
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.unitId, 'ci-unit-test');
  assert.equal(result.caseId, UNIT_CASE_ID);
  assert.deepEqual(
    result.files,
    caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'node-test-mjs').files
  );
  assert.equal(result.capacity.githubActions, true);
  assert.equal(
    result.capacity.configuredWorkers,
    result.capacity.effectiveLogicalCpus
  );
  assert.equal(result.caseLedger.counts.failed, 0);
  assert.ok(result.caseLedger.counts.passed >= 1);
  assert.deepEqual(
    result.caseLedger.reports.map(({ file }) => file),
    result.files
  );
  assert.ok(
    result.caseLedger.reports.every(
      ({ tests, reportSha256, wallMs }) =>
        tests > 0 &&
        /^[a-f0-9]{64}$/.test(reportSha256) &&
        Number.isFinite(wallMs) &&
        wallMs >= 0
    )
  );
  assert.equal(
    JSON.parse(readFileSync(reportFile, 'utf8')).inventorySha256,
    plan.testInventory.inventorySha256
  );
  const junit = writeVitestJunit(root, plan);
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [junit, reportFile],
    environment,
  });
  assert.deepEqual(
    sealed.receipt.caseResults.lanes.map((lane) => lane.proof),
    ['junit-file-closure', 'engine-json-per-file-closure']
  );
  assert.deepEqual(
    sealed.receipt.caseResults.lanes[0].files,
    caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest').files
  );
  assert.deepEqual(
    sealed.receipt.caseResults.lanes[1].files,
    caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'node-test-mjs').files
  );
});

test('engine rejects a planned native Node file with no observed cases', async () => {
  const { root, plan, environment } = fixture({ zeroCaseNativeFile: true });
  const receiptDir = path.join(root, 'receipts');
  const caseId = caseForFile(
    plan,
    'ci-unit-test',
    'node-test-mjs',
    'server/native-two.test.mjs'
  );
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    caseId,
    receiptDir,
    environment,
  });
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      caseId,
      laneId: 'node-test-mjs',
      receiptDir,
      reportFile: path.join(root, 'seerrng-engine-node-tests.json'),
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /server\/native-two\.test\.mjs: .*no observed registered test cases/
  );
});

test('unit receipt preserves a successful intentionally skipped Vitest case', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const unitEvidence = await createUnitTestEvidence({
    root,
    plan,
    environment,
    receiptDir,
  });
  const skippedFile = caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest')
    .files[0];
  writeVitestJunit(root, plan, { partialSkippedFile: skippedFile });
  const { receipt } = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [unitEvidence.junit, unitEvidence.node],
    environment,
  });
  const vitest = receipt.caseResults.lanes.find((lane) => lane.id === 'vitest');
  assert.equal(vitest.skipped, 1);
  assert.equal(vitest.active, 1);
  assert.equal(vitest.active + vitest.skipped, vitest.tests);
  assert.equal(verifyHostedUnitReceipt(receipt), receipt);
});

test('unit success rejects incomplete or tampered native evidence', async () => {
  const scenarios = [
    {
      name: 'missing Vitest suite',
      mutate({ root, plan }) {
        const files = caseLane(
          plan,
          'ci-unit-test',
          UNIT_CASE_ID,
          'vitest'
        ).files;
        writeVitestJunit(root, plan, { files: files.slice(1) });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'duplicate Vitest suite',
      mutate({ root, plan }) {
        const files = caseLane(
          plan,
          'ci-unit-test',
          UNIT_CASE_ID,
          'vitest'
        ).files;
        writeVitestJunit(root, plan, { files: [files[0], files[0]] });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'extra Vitest suite',
      mutate({ root, plan }) {
        const files = caseLane(
          plan,
          'ci-unit-test',
          UNIT_CASE_ID,
          'vitest'
        ).files;
        writeVitestJunit(root, plan, {
          files: [...files, 'src/unplanned.test.ts'],
        });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'zero-test Vitest suite',
      mutate({ root, plan }) {
        const file = caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest')
          .files[0];
        writeVitestJunit(root, plan, { zeroFile: file });
      },
      message: /not a complete success/,
    },
    {
      name: 'all-skipped Vitest lane',
      mutate({ root, plan }) {
        writeVitestJunit(root, plan, { allSkipped: true });
      },
      message: /contains no active tests/,
    },
    {
      name: 'failed Vitest suite',
      mutate({ root, plan }) {
        const file = caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest')
          .files[0];
        writeVitestJunit(root, plan, { failureFile: file });
      },
      message: /failed or errored tests/,
    },
    {
      name: 'tampered native Node result',
      mutate({ node }) {
        const result = JSON.parse(readFileSync(node, 'utf8'));
        result.unitId = 'forged-unit';
        writeFileSync(node, `${JSON.stringify(result)}\n`);
      },
      message: /not bound to its admission/,
    },
  ];

  for (const scenario of scenarios) {
    const { root, plan, environment } = fixture();
    const receiptDir = path.join(root, 'receipts');
    admitHostedGithubUnit({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      environment,
    });
    const evidence = await createUnitTestEvidence({
      root,
      plan,
      environment,
      receiptDir,
    });
    scenario.mutate({ root, plan, ...evidence });
    assert.throws(
      () =>
        sealHostedGithubUnitReceipt({
          root,
          plan,
          expectedPlanSha256: plan.planSha256,
          unitId: 'ci-unit-test',
          receiptDir,
          jobStatus: 'success',
          evidenceFiles: [evidence.junit, evidence.node],
          environment,
        }),
      scenario.message,
      scenario.name
    );
  }
});

test('unit success seals active and skipped Vitest counts', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const evidence = await createUnitTestEvidence({
    root,
    plan,
    environment,
    receiptDir,
  });
  const file = caseLane(plan, 'ci-unit-test', UNIT_CASE_ID, 'vitest').files[0];
  writeVitestJunit(root, plan, { partialSkippedFile: file });
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [evidence.junit, evidence.node],
    environment,
  });
  const result = sealed.receipt.caseResults.lanes.find(
    (lane) => lane.id === 'vitest'
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.active + result.skipped, result.tests);
  assert.equal(result.active, result.fileCount);
});

test('reconciliation requires every planned unit case and its success ledger', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  for (const unit of plan.units) {
    assert.equal(unit.applicable, true, unit.id);
    for (const caseId of unit.cases) {
      const executionEnvironment =
        unit.id === 'ci-playwright'
          ? playwrightEnvironment(environment)
          : environment;
      const evidenceRoot = path.join(
        root,
        'case-evidence',
        `${unit.id}--${caseId}`
      );
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: unit.id,
        caseId,
        receiptDir,
        environment: executionEnvironment,
      });
      const unitEvidence =
        unit.id === 'ci-unit-test'
          ? await createUnitTestEvidence({
              root,
              plan,
              environment: executionEnvironment,
              receiptDir,
              caseId,
              evidenceRoot,
            })
          : null;
      const cypressEvidence =
        unit.id === 'cypress-run'
          ? writeCypressEvidence({
              root,
              plan,
              caseId,
              evidenceRoot,
            })
          : null;
      const playwrightEvidence =
        unit.id === 'ci-playwright'
          ? writePlaywrightEvidence({
              root,
              plan,
              environment: executionEnvironment,
              evidenceRoot,
            })
          : null;
      const evidenceFiles = unitEvidence
        ? [unitEvidence.junit, unitEvidence.node]
        : cypressEvidence
          ? [cypressEvidence]
          : playwrightEvidence
            ? [playwrightEvidence]
            : [];
      sealHostedGithubUnitReceipt({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: unit.id,
        caseId,
        receiptDir,
        jobStatus: 'success',
        evidenceFiles,
        environment: executionEnvironment,
      });
      for (const evidenceFile of evidenceFiles) {
        const archived = path.join(
          receiptDir,
          `${unit.id}--${caseId}.evidence-${path.basename(evidenceFile)}`
        );
        assert.deepEqual(readFileSync(archived), readFileSync(evidenceFile));
      }
    }
  }
  writeFileSync(
    path.join(
      receiptDir,
      'ci-unit-test--shard-01-of-04.evidence-raw.receipt.json'
    ),
    '{"untrusted":true}\n'
  );
  const needs = Object.fromEntries([
    [
      'engine-plan',
      {
        result: 'success',
        outputs: {
          planSha256: plan.planSha256,
          runId: plan.event.runId,
          runAttempt: plan.event.runAttempt,
          executionSha: plan.event.executionSha,
          headSha: plan.event.headSha,
        },
      },
    ],
    ...plan.units.map((unit) => [
      unit.needsKey,
      { result: 'success', outputs: {} },
    ]),
  ]);
  const evidence = loadHostedReceiptDirectory(receiptDir);
  assert.equal(evidence.admissions.length, 20);
  const report = reconcileHostedGithubExecution(plan, needs, evidence);
  assert.equal(report.schema, 'seerrng-hosted-github-reconciliation/v2');
  assert.equal(report.status, 'passed');
  assert.equal(report.resultReuse, false);
  assert.equal(report.receipts.expected, 20);
  assert.equal(report.receipts.succeeded, 20);
  assert.equal(report.receipts.ledgerEntries, 20);
  assert.deepEqual(report.shardedLanes, [
    {
      id: 'vitest',
      cases: 4,
      files: 4,
      active: 4,
      status: 'passed',
    },
    {
      id: 'node-test-mjs',
      cases: 4,
      files: 4,
      active: 4,
      status: 'passed',
    },
    {
      id: 'cypress',
      cases: 6,
      files: 7,
      active: 7,
      status: 'passed',
    },
  ]);
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        receipts: evidence.receipts.slice(1),
      }),
    /receipt set does not close/
  );
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        admissions: evidence.admissions.slice(1),
      }),
    /admission set does not close/
  );
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        ledgers: [evidence.ledgers[1], ...evidence.ledgers.slice(1)],
      }),
    /duplicate work key/
  );

  const targetAdmission = evidence.admissions[0];
  const targetLedgerIndex = evidence.ledgers.findIndex(
    (ledger) =>
      ledger.entries[0]?.workKeySha256 === targetAdmission.workKeySha256
  );
  const alternateSuccess = createSuccessReceipt({
    identity: targetAdmission.identity,
    evidence: {
      resultSha256: '1'.repeat(64),
      stdoutSha256: '2'.repeat(64),
      stderrSha256: '3'.repeat(64),
      artifactManifestSha256: '4'.repeat(64),
      caseResultsSha256: '5'.repeat(64),
    },
  });
  const mismatchedLedger = recordSuccessfulWork(
    createRunScopedLedger(scopeFromPlan(plan)),
    alternateSuccess
  );
  const mismatchedLedgers = [...evidence.ledgers];
  mismatchedLedgers[targetLedgerIndex] = mismatchedLedger;
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        ledgers: mismatchedLedgers,
      }),
    /run ledger failed binding/
  );

  const forgedAdmission = structuredClone(targetAdmission);
  forgedAdmission.identity.unit.definitionSha256 = '6'.repeat(64);
  forgedAdmission.workKeySha256 = workKeySha256(forgedAdmission.identity);
  const resealedAdmission = reseal(forgedAdmission, 'admissionSha256');
  const forgedAdmissions = [...evidence.admissions];
  forgedAdmissions[0] = resealedAdmission;
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        admissions: forgedAdmissions,
      }),
    /does not match planned unit\/case/
  );
});
