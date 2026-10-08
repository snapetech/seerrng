// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import {
  acceptNativeCypressResults,
  acceptNativePlaywrightResults,
  buildBrowserEnvironment,
  createBuildBrowserStages,
  executeBrowserStage,
  executeCypressStage,
  executeProductionBuild,
  nativeCypressConfigSource,
  nativePlaywrightConfigSource,
} from '../tools/validation-engine/runtime/build-browser-stage.mjs';

const candidate = {
  repository: 'snapetech/seerrng',
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  lockSha256: 'c'.repeat(64),
  sourceSha256: 'd'.repeat(64),
};
const commandReceipt = (extra = {}) => ({
  status: 'passed',
  exitCode: 0,
  wallMs: 1,
  aborted: false,
  timedOut: false,
  signal: null,
  spawnError: null,
  lifecycle: { completed: true, cleanupVerified: true },
  ...extra,
});

async function fixture(t) {
  const scratchRoot = await mkdtemp(
    path.join(os.tmpdir(), 'seerrng-build-browser-test-')
  );
  t.after(() => rm(scratchRoot, { recursive: true, force: true }));
  const root = path.join(scratchRoot, 'source');
  const authoritativeRoot = path.join(scratchRoot, 'authoritative');
  await mkdir(path.join(root, 'cypress', 'e2e'), { recursive: true });
  await mkdir(path.join(root, 'playwright'), { recursive: true });
  await mkdir(authoritativeRoot);
  await writeFile(
    path.join(root, 'cypress', 'e2e', 'first.cy.ts'),
    'describe("fixture", () => {});'
  );
  await writeFile(
    path.join(root, 'cypress.config.ts'),
    'export default {e2e:{}};'
  );
  await writeFile(
    path.join(root, 'playwright', 'first.spec.ts'),
    'import { test } from "@playwright/test"; test("fixture", () => {});'
  );
  await writeFile(
    path.join(root, 'playwright.config.ts'),
    'export default {testDir:"./playwright"};'
  );
  const options = {
    root,
    authoritativeRoot,
    scratchRoot,
    fixtureRoot: path.join(scratchRoot, 'fixtures'),
    candidate,
    capacity: { configuredWorkers: 4 },
    inheritedEnv: { PATH: process.env.PATH ?? '' },
  };
  const plan = await createBuildBrowserStages(options);
  return { plan, options };
}

function nativeResult(plan, states = ['passed']) {
  const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
  const tests = states.map((state, i) => {
    counts[state] += 1;
    return {
      title: ['Fixture', `case ${i}`],
      state,
      duration: 10,
      displayError: null,
      attempts: state === 'pending' || state === 'skipped' ? [] : [{ state }],
    };
  });
  return {
    schema: 1,
    candidate,
    specs: plan.specs,
    native: {
      browserName: 'electron',
      cypressVersion: '16.0.0',
      totalDuration: 100,
      totalTests: tests.length,
      totalPassed: counts.passed,
      totalFailed: counts.failed,
      totalPending: counts.pending,
      totalSkipped: counts.skipped,
      runs: [
        {
          error: null,
          spec: {
            relative: plan.specs[0],
            absolute: path.join(plan.root, plan.specs[0]),
          },
          tests,
          stats: {
            tests: tests.length,
            passes: counts.passed,
            failures: counts.failed,
            pending: counts.pending,
            skipped: counts.skipped,
          },
        },
      ],
    },
  };
}

function nativePlaywrightResult(plan, states = ['expected']) {
  const stats = {
    expected: 0,
    flaky: 0,
    unexpected: 0,
    skipped: 0,
  };
  const tests = states.map((status) => {
    stats[status] += 1;
    const statuses =
      status === 'flaky'
        ? ['failed', 'passed']
        : status === 'unexpected'
          ? ['failed']
          : status === 'skipped'
            ? ['skipped']
            : ['passed'];
    return {
      timeout: 30_000,
      annotations: [],
      expectedStatus: 'passed',
      projectId: '',
      projectName: '',
      status,
      results: statuses.map((attemptStatus, retry) => ({
        workerIndex: 0,
        parallelIndex: 0,
        status: attemptStatus,
        duration: 10,
        errors: attemptStatus === 'failed' ? [{ message: 'fixture' }] : [],
        retry,
      })),
    };
  });
  return {
    config: {
      rootDir: path.join(plan.root, 'playwright'),
      metadata: {
        seerrngValidationEngine: {
          schema: 1,
          candidate,
          specs: plan.playwrightSpecs,
        },
      },
      projects: [
        {
          id: '',
          name: '',
          testDir: path.join(plan.root, 'playwright'),
        },
      ],
    },
    suites: [
      {
        title: path.basename(plan.playwrightSpecs[0]),
        file: path.basename(plan.playwrightSpecs[0]),
        specs: [
          {
            title: 'fixture',
            file: path.basename(plan.playwrightSpecs[0]),
            line: 1,
            column: 1,
            tests,
          },
        ],
        suites: [],
      },
    ],
    errors: [],
    stats: { ...stats, startTime: new Date(0).toISOString(), duration: 100 },
  };
}

const buildReceipt = (plan) => ({
  status: 'passed',
  candidate,
  root: plan.root,
  compileInvocations: 1,
});
const networkBoundaryProof = { isolated: true, deniesPrivateProviders: true };

test('native build descriptors compile once and discover both Stage 4 browser suites', async (t) => {
  const { plan } = await fixture(t);
  assert.deepEqual(
    plan.build.map(({ args }) => args),
    [['build'], ['bundle:check']]
  );
  assert(!plan.browser.args.includes('cypress:build'));
  assert.deepEqual(plan.cypressSpecs, ['cypress/e2e/first.cy.ts']);
  assert.deepEqual(plan.playwrightSpecs, ['playwright/first.spec.ts']);
  assert.deepEqual(plan.specs, plan.cypressSpecs);
  assert.deepEqual(plan.playwright.args.slice(-1), plan.playwrightSpecs);
  assert.equal(plan.server.args[0], 'start');
  assert.equal(plan.env.PORT, '5056');
  assert.equal(plan.env.WITH_MIGRATIONS, 'true');
  assert.equal(plan.env.E2E_TESTS, 'true');
  assert.equal(plan.env.PLAYWRIGHT_BASE_URL, plan.baseUrl);
});

test('inherited runtime/database/provider/cloud credentials are removed, not machine-specific', () => {
  const env = buildBrowserEnvironment(
    {
      PATH: 'native-path',
      HOME: 'home',
      DB_PASSWORD: 'secret',
      DATABASE_URL: 'secret',
      SEERR_EXTERNAL_CONFIG: 'live',
      CYPRESS_RECORD_KEY: 'secret',
      GITHUB_TOKEN: 'secret',
      TMDB_API_KEY: 'secret',
      NODE_OPTIONS: '--require unsafe',
      RUN_LIVE_AUTH_AUDIT: 'true',
      LIVE_QA_EMAIL: 'live',
      CYPRESS_ADMIN_PASSWORD: 'live',
      PLAYWRIGHT_BASE_URL: 'https://production.invalid',
    },
    '/owned/fixtures',
    5056
  );
  assert.equal(env.PATH, 'native-path');
  for (const key of [
    'DB_PASSWORD',
    'DATABASE_URL',
    'SEERR_EXTERNAL_CONFIG',
    'GITHUB_TOKEN',
    'TMDB_API_KEY',
    'NODE_OPTIONS',
    'LIVE_QA_EMAIL',
    'CYPRESS_ADMIN_PASSWORD',
    'PLAYWRIGHT_BASE_URL',
  ])
    assert(!Object.hasOwn(env, key), key);
  assert.equal(env.CYPRESS_RECORD_KEY, '');
  assert.equal(env.RUN_LIVE_AUTH_AUDIT, 'false');
});

test('fixture preparation reuses compiled-entity disk seeding without changing production runtime', async (t) => {
  const { plan } = await fixture(t);
  assert.equal(plan.prepare.command, process.execPath);
  assert.deepEqual(plan.prepare.args, ['dist/scripts/prepareTestDb.js']);
  assert.equal(plan.prepare.env.NODE_ENV, 'production');
  assert.equal(plan.prepare.env.WITH_MIGRATIONS, 'true');
  assert.equal(plan.prepare.env.CONFIG_DIRECTORY, plan.fixtureRoot);
  for (const command of [
    ...plan.build,
    plan.server,
    plan.browser,
    plan.playwright,
  ]) {
    assert.equal(command.env.NODE_ENV, 'production');
    assert.equal(command.env.WITH_MIGRATIONS, 'true');
    assert.equal(command.env.CONFIG_DIRECTORY, plan.fixtureRoot);
  }
  assert.equal(plan.env.NODE_ENV, 'production');
  assert(Object.isFrozen(plan.prepare.env));
});

test('production and fixture scopes fail closed on authoritative source or an existing fixture', async (t) => {
  const { options } = await fixture(t);
  await assert.rejects(
    createBuildBrowserStages({ ...options, root: options.authoritativeRoot }),
    /owned scratch/
  );
  await assert.rejects(createBuildBrowserStages(options), /EEXIST/);
  await assert.rejects(
    createBuildBrowserStages({
      ...options,
      candidate: { ...candidate, sourceSha256: null },
    }),
    /frozen candidate/
  );
});

test('after:run wrapper preserves original options, setup tasks, callback result, and after:run hooks', async (t) => {
  const { plan } = await fixture(t);
  const source = nativeCypressConfigSource(plan);
  assert(source.includes('...original, e2e: { ...original.e2e'));
  assert(
    source.includes('original.e2e?.setupNodeEvents?.(preserveOn, config)')
  );
  assert(
    source.includes('for (const handler of afterRun) await handler(native)')
  );
  assert(source.includes('return configured ?? config'));
  assert(!source.includes('retries:'));
  assert(!source.includes('supportFile:'));
});

test('Playwright wrapper preserves suite options while disabling its second server and binding scratch evidence', async (t) => {
  const { plan } = await fixture(t);
  const source = nativePlaywrightConfigSource(plan);
  assert(source.includes('...original, webServer: undefined'));
  assert(source.includes('...(original.metadata ?? {})'));
  assert(source.includes('...(original.use ?? {})'));
  assert(source.includes(JSON.stringify(plan.playwrightReport)));
  assert(source.includes(JSON.stringify(plan.playwrightOutput)));
  assert(source.includes(JSON.stringify(plan.baseUrl)));
  assert(source.includes('seerrngValidationEngine: engine'));
  assert(!source.includes('workers:'));
});

test('native Cypress ledger counts cases once and preserves attempts, failed cases and conditional skips', async (t) => {
  const { plan } = await fixture(t);
  const envelope = nativeResult(plan, [
    'passed',
    'failed',
    'pending',
    'skipped',
  ]);
  envelope.native.runs[0].tests[0].attempts.unshift({ state: 'failed' });
  const result = acceptNativeCypressResults(envelope, plan);
  assert.equal(result.status, 'failed');
  assert.equal(result.cases.length, 4);
  assert.equal(result.cases[0].retries, 1);
  assert.deepEqual(result.counts, {
    passed: 1,
    failed: 1,
    pending: 1,
    skipped: 1,
  });
  assert.equal(result.resultReuse, false);
});

test('native Playwright 1.63 ledger normalizes suite-root files and preserves retries, failures and skips', async (t) => {
  const { plan } = await fixture(t);
  const result = acceptNativePlaywrightResults(
    nativePlaywrightResult(plan, [
      'expected',
      'flaky',
      'unexpected',
      'skipped',
    ]),
    plan
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.cases.length, 4);
  assert.equal(result.cases[1].retries, 1);
  assert.deepEqual(result.counts, { passed: 2, failed: 1, skipped: 1 });
  assert.deepEqual(result.outcomes, {
    expected: 1,
    flaky: 1,
    unexpected: 1,
    skipped: 1,
  });
  assert.equal(result.skipReviewRequired, true);
  assert.equal(result.resultReuse, false);
});

test('zero-active, missing, duplicate, off-source, fabricated-count and wrong-candidate reports fail', async (t) => {
  const { plan } = await fixture(t);
  assert.throws(
    () => acceptNativeCypressResults(nativeResult(plan, ['pending']), plan),
    /no active/
  );
  for (const mutate of [
    (report) => {
      report.native.runs = [];
    },
    (report) => {
      report.native.runs.push(report.native.runs[0]);
    },
    (report) => {
      report.native.runs[0].spec.absolute = path.join(
        plan.scratchRoot,
        'other.cy.ts'
      );
    },
    (report) => {
      report.native.totalTests += 1;
    },
    (report) => {
      report.candidate = { ...candidate, sourceSha256: 'e'.repeat(64) };
    },
    (report) => {
      report.native.runs[0].tests[0].attempts = [];
    },
  ]) {
    const envelope = nativeResult(plan);
    mutate(envelope);
    assert.throws(() => acceptNativeCypressResults(envelope, plan));
  }
});

test('Playwright missing, duplicate, off-source, fabricated, stale and zero-active reports fail', async (t) => {
  const { plan } = await fixture(t);
  assert.throws(
    () =>
      acceptNativePlaywrightResults(
        nativePlaywrightResult(plan, ['skipped']),
        plan
      ),
    /no active/
  );
  for (const mutate of [
    (report) => {
      report.suites = [];
    },
    (report) => {
      report.suites.push(structuredClone(report.suites[0]));
    },
    (report) => {
      report.suites[0].file = 'playwright/unplanned.spec.ts';
    },
    (report) => {
      report.suites[0].file = '../../outside.spec.ts';
    },
    (report) => {
      report.suites[0].specs[0].file = 'other.spec.ts';
    },
    (report) => {
      report.stats.expected += 1;
    },
    (report) => {
      report.config.metadata.seerrngValidationEngine.candidate = {
        ...candidate,
        sourceSha256: 'e'.repeat(64),
      };
    },
    (report) => {
      report.config.metadata.seerrngValidationEngine.specs = [
        'playwright/stale.spec.ts',
      ];
    },
    (report) => {
      report.config.rootDir = plan.scratchRoot;
    },
    (report) => {
      report.config.projects[0].testDir = plan.scratchRoot;
    },
    (report) => {
      report.errors.push({ message: 'collection failed' });
    },
    (report) => {
      report.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
  ]) {
    const report = nativePlaywrightResult(plan);
    mutate(report);
    assert.throws(() => acceptNativePlaywrightResults(report, plan));
  }
});

test('successful same-candidate build creates a receipt; command failures cannot continue', async (t) => {
  const { plan } = await fixture(t);
  await mkdir(path.join(plan.root, '.next'));
  await mkdir(path.join(plan.root, 'dist'));
  await writeFile(path.join(plan.root, '.next', 'BUILD_ID'), 'fixture');
  await writeFile(path.join(plan.root, 'dist', 'index.js'), 'fixture');
  const calls = [];
  const receipt = await executeProductionBuild(plan, {
    run: async (command) => {
      calls.push(command.id);
      return commandReceipt();
    },
    verifySource: async () => {},
  });
  assert.equal(receipt.compileInvocations, 1);
  assert.deepEqual(calls, ['production-build', 'production-bundle-check']);
  calls.length = 0;
  await assert.rejects(
    executeProductionBuild(plan, {
      run: async (command) => {
        calls.push(command.id);
        throw new Error('native build failed');
      },
      verifySource: async () => {},
    }),
    /native build failed/
  );
  assert.deepEqual(calls, ['production-build']);
});

test('browser rejects a missing/foreign build or unproved network before starting children', async (t) => {
  const { plan } = await fixture(t);
  let calls = 0;
  const api = {
    run: async () => {
      calls += 1;
    },
    startServer: async () => {
      calls += 1;
    },
    waitForReady: async () => {},
    verifySource: async () => {},
  };
  await assert.rejects(
    executeCypressStage(plan, undefined, api),
    /same-candidate/
  );
  await assert.rejects(
    executeCypressStage(
      plan,
      {
        ...buildReceipt(plan),
        candidate: { ...candidate, commit: 'f'.repeat(40) },
      },
      api
    ),
    /same-candidate/
  );
  await assert.rejects(
    executeCypressStage(plan, buildReceipt(plan), api),
    /network boundary/
  );
  assert.equal(calls, 0);
});

test('native browser reuses compile, exports fixture configuration, awaits readiness and closes server', async (t) => {
  const { plan } = await fixture(t);
  const calls = [];
  const api = {
    networkBoundaryProof,
    verifySource: async () => {},
    run: async (command) => {
      calls.push(command.id);
      if (command.id === 'cypress-fixture-external-config')
        return commandReceipt({
          stdout: '{"main":{},"plex":{},"radarr":[],"sonarr":[]}',
        });
      if (command.id === 'native-cypress') {
        assert.equal(
          JSON.parse(command.env.SEERR_EXTERNAL_CONFIG).radarr.length,
          0
        );
        await writeFile(plan.report, JSON.stringify(nativeResult(plan)));
      }
      return commandReceipt();
    },
    startServer: async () => {
      calls.push('start');
      return {
        stop: async () => {
          calls.push('stop');
        },
      };
    },
    waitForReady: async (url) => {
      assert.equal(url, plan.baseUrl);
      calls.push('ready');
    },
  };
  const result = await executeCypressStage(plan, buildReceipt(plan), api);
  assert.equal(result.status, 'passed');
  assert.equal(result.reusedCompile, true);
  assert.equal(result.compileInvocations, 0);
  assert.deepEqual(calls, [
    'cypress-fixture-prepare',
    'cypress-fixture-external-config',
    'start',
    'ready',
    'native-cypress',
    'stop',
  ]);
  await assert.rejects(readFile(plan.wrapper), /ENOENT/);
});

test('Stage 4 reuses one build, fixture and managed server while accounting Cypress and Playwright', async (t) => {
  const { plan } = await fixture(t);
  const calls = [];
  const api = {
    networkBoundaryProof,
    verifySource: async () => {},
    run: async (command) => {
      calls.push(command.id);
      if (command.id === 'cypress-fixture-external-config')
        return commandReceipt({ stdout: '{}' });
      if (command.id === 'native-cypress') {
        assert.equal(command.env.CONFIG_DIRECTORY, plan.fixtureRoot);
        assert.equal(command.env.PORT, '5056');
        assert.equal(command.env.PLAYWRIGHT_BASE_URL, plan.baseUrl);
        await writeFile(plan.report, JSON.stringify(nativeResult(plan)));
      }
      if (command.id === 'native-playwright')
        await writeFile(
          plan.playwrightReport,
          JSON.stringify(nativePlaywrightResult(plan))
        );
      return commandReceipt();
    },
    startServer: async (descriptor) => {
      calls.push('start');
      assert.equal(descriptor.env.CONFIG_DIRECTORY, plan.fixtureRoot);
      assert.equal(descriptor.env.PORT, '5056');
      assert.equal(descriptor.env.PLAYWRIGHT_BASE_URL, plan.baseUrl);
      return {
        stop: async () => {
          calls.push('stop');
        },
      };
    },
    waitForReady: async (url) => {
      assert.equal(url, plan.baseUrl);
      calls.push('ready');
    },
  };
  const result = await executeBrowserStage(plan, buildReceipt(plan), api);
  assert.equal(result.status, 'passed');
  assert.equal(result.reusedCompile, true);
  assert.equal(result.compileInvocations, 0);
  assert.deepEqual(result.counts, {
    passed: 2,
    failed: 0,
    pending: 0,
    skipped: 0,
  });
  assert.deepEqual(
    result.cases.map(({ framework }) => framework),
    ['cypress', 'playwright']
  );
  assert.deepEqual(calls, [
    'cypress-fixture-prepare',
    'cypress-fixture-external-config',
    'start',
    'ready',
    'native-cypress',
    'native-playwright',
    'stop',
  ]);
  await assert.rejects(readFile(plan.wrapper), /ENOENT/);
  await assert.rejects(readFile(plan.playwrightWrapper), /ENOENT/);
  assert(JSON.parse(await readFile(plan.report, 'utf8')));
  assert(JSON.parse(await readFile(plan.playwrightReport, 'utf8')));
});

test('readiness failure, abort and malformed native output still drain the managed server', async (t) => {
  const { plan } = await fixture(t);
  for (const mode of ['readiness', 'abort', 'malformed']) {
    const controller = new AbortController();
    let stopped = false;
    await assert.rejects(
      executeCypressStage(plan, buildReceipt(plan), {
        networkBoundaryProof,
        signal: controller.signal,
        verifySource: async () => {},
        run: async (command) => {
          if (command.id === 'cypress-fixture-external-config')
            return commandReceipt({ stdout: '{}' });
          if (command.id === 'native-cypress') {
            if (mode === 'abort') controller.abort(new Error('cancelled'));
            else await writeFile(plan.report, '{malformed');
          }
          return commandReceipt();
        },
        startServer: async () => ({
          stop: async () => {
            stopped = true;
          },
        }),
        waitForReady: async () => {
          if (mode === 'readiness') throw new Error('not ready');
        },
      })
    );
    assert(stopped);
    await assert.rejects(readFile(plan.wrapper), /ENOENT/);
  }
});

test('cleanup uncertainty cannot return a passed browser receipt', async (t) => {
  const { plan } = await fixture(t);
  await assert.rejects(
    executeCypressStage(plan, buildReceipt(plan), {
      networkBoundaryProof,
      verifySource: async () => {},
      run: async (command) => {
        if (command.id === 'cypress-fixture-external-config')
          return commandReceipt({ stdout: '{}' });
        if (command.id === 'native-cypress')
          await writeFile(plan.report, JSON.stringify(nativeResult(plan)));
        return commandReceipt();
      },
      startServer: async () => ({
        stop: async () => {
          throw new Error('surviving child');
        },
      }),
      waitForReady: async () => {},
    }),
    /cleanup did not complete/
  );
});

test('pre-existing build artifacts cannot manufacture a pass from an incomplete command receipt', async (t) => {
  const { plan } = await fixture(t);
  await mkdir(path.join(plan.root, '.next'));
  await mkdir(path.join(plan.root, 'dist'));
  await writeFile(path.join(plan.root, '.next', 'BUILD_ID'), 'stale');
  await writeFile(path.join(plan.root, 'dist', 'index.js'), 'stale');
  for (const receipt of [
    undefined,
    {},
    { exitCode: 0 },
    commandReceipt({ aborted: true }),
    commandReceipt({ timedOut: true }),
    commandReceipt({ signal: 'SIGTERM' }),
    commandReceipt({ wallMs: NaN }),
    commandReceipt({ lifecycle: { completed: false, cleanupVerified: true } }),
  ]) {
    await assert.rejects(
      executeProductionBuild(plan, {
        run: async () => receipt,
        verifySource: async () => {},
      }),
      /native command receipt/
    );
  }
});

test('passed native cases cannot conceal an invalid browser receipt; complete failed native cases are preserved', async (t) => {
  for (const nativeFailure of [false, true]) {
    const { plan } = await fixture(t);
    let stopped = false;
    const api = {
      networkBoundaryProof,
      verifySource: async () => {},
      startServer: async () => ({
        stop: async () => {
          stopped = true;
        },
      }),
      waitForReady: async () => {},
      run: async (command) => {
        if (command.id === 'cypress-fixture-external-config')
          return commandReceipt({ stdout: '{}' });
        if (command.id === 'native-cypress') {
          await writeFile(
            plan.report,
            JSON.stringify(
              nativeResult(plan, [nativeFailure ? 'failed' : 'passed'])
            )
          );
          if (nativeFailure)
            throw Object.assign(new Error('native assertion failed'), {
              receipt: commandReceipt({ status: 'failed', exitCode: 1 }),
            });
          return undefined;
        }
        return commandReceipt();
      },
    };
    if (nativeFailure) {
      const result = await executeCypressStage(plan, buildReceipt(plan), api);
      assert.equal(result.status, 'failed');
      assert.equal(result.counts.failed, 1);
      assert.equal(result.nativeCommandReceipt.exitCode, 1);
    } else
      await assert.rejects(
        executeCypressStage(plan, buildReceipt(plan), api),
        /native command receipt/
      );
    assert(stopped);
  }
});
