// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application TS aliases.
import {
  executeNativeRepository,
  repositoryNativeCases,
} from '../tools/validation-engine/runtime/native-stage-context.mjs';
import { readNodeTapHierarchy } from '../tools/validation-engine/runtime/node-tap-hierarchy.mjs';
import { executePlan } from './local-validation.mjs';
const quiet = { write() {} };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const tapEscape = (input) =>
  String(input)
    .replaceAll('\\', '\\\\')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\v', '\\v')
    .replaceAll('#', '\\#');
const inspected = (input) =>
  inspect(input, { colors: false, breakLength: Infinity });
const tap = (failed = false) =>
  `TAP version 13\n# Subtest: native fixture\n${failed ? 'not ok' : 'ok'} 1 - native fixture\n  ---\n  duration_ms: 1\n  type: 'test'\n${failed ? "  error: 'native assertion'\n  failureType: 'testCodeFailure'\n" : ''}  ...\n1..1\n# tests 1\n# suites 0\n# pass ${failed ? 0 : 1}\n# fail ${failed ? 1 : 0}\n# cancelled 0\n# skipped 0\n# todo 0\n`;
const failedSourceTap = (
  root,
  sourceFile,
  { sourceOrdinal = 2, absoluteName = false } = {}
) => {
  const absolute = path.resolve(root, sourceFile),
    sourceName = tapEscape(
      absoluteName ? absolute : path.normalize(sourceFile)
    );
  return `TAP version 13
# Subtest: current repository has complete deterministic hosted ownership
not ok 1 - current repository has complete deterministic hosted ownership
  ---
  duration_ms: 1
  type: 'test'
  location: ${inspected(`${path.resolve(root, 'bin/engine-hosted-test-inventory.test.mjs')}:162:1`)}
  failureType: 'testCodeFailure'
  error: 'Symlink in hosted test discovery scope: gen-docs/node_modules'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: another complete tooling case
ok 2 - another complete tooling case
  ---
  duration_ms: 1
  type: 'test'
  ...
# Subtest: ${sourceName}
not ok ${sourceOrdinal} - ${sourceName}
  ---
  duration_ms: 1
  type: 'test'
  location: ${inspected(`${absolute}:1:1`)}
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..3
# tests 3
# suites 0
# pass 1
# fail 2
# cancelled 0
# skipped 0
# todo 0
`;
};
const failedToolingTap = (root) =>
  failedSourceTap(root, 'bin/engine-staged-validation.test.mjs');
const sourceWrapperTap = (
  name,
  absoluteFile,
  { location = absoluteFile, passed = false, reportedOrdinal = 1 } = {}
) => {
  const reporterName = tapEscape(name),
    diagnostic = passed
      ? ''
      : `  location: ${inspected(`${location}:1:1`)}\n  failureType: 'testCodeFailure'\n  exitCode: 1\n  signal: ~\n  error: 'test failed'\n  code: 'ERR_TEST_FAILURE'\n`;
  return `TAP version 13\n# Subtest: ${reporterName}\n${passed ? 'ok' : 'not ok'} ${reportedOrdinal} - ${reporterName}\n  ---\n  duration_ms: 1\n  type: 'test'\n${diagnostic}  ...\n1..1\n# tests 1\n# suites 0\n# pass ${passed ? 1 : 0}\n# fail ${passed ? 0 : 1}\n# cancelled 0\n# skipped 0\n# todo 0\n`;
};
function fixture(t, mode = {}) {
  const scratchRoot = mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-native-accounting-')
  );
  t.after(() => rmSync(scratchRoot, { recursive: true, force: true }));
  const root = path.join(scratchRoot, 'source');
  mkdirSync(root);
  const plan = {
    root,
    steps: [
      {
        name: 'Vitest',
        kind: 'vitest',
        command: process.execPath,
        config: path.join(root, 'vitest.config.mts'),
        files: ['server/fixture.test.ts'],
        args: [
          '--config',
          '<temporary-vitest-config>',
          '--outputFile.json=<temporary-vitest-report>',
        ],
      },
      {
        name: 'Node',
        kind: 'node-js',
        command: process.execPath,
        files: ['bin/fixture.test.mjs'],
        args: [],
      },
      {
        name: 'Tooling',
        kind: 'tooling',
        command: process.execPath,
        files: mode.failedTooling
          ? [
              'bin/engine-hosted-test-inventory.test.mjs',
              'bin/engine-staged-validation.test.mjs',
            ]
          : ['bin/tooling.test.mjs'],
        args: [],
      },
    ],
  };
  const calls = [];
  let ordinal = 0;
  const nativeRun = async (command) => {
    calls.push(command.kind);
    assert.equal(
      command.env.NODE_OPTIONS,
      command.kind === 'tooling' ? '--test-reporter=tap' : undefined
    );
    const failed =
      (mode.failedVitest && command.kind === 'vitest') ||
      (mode.failedNode && command.kind === 'node-js') ||
      (mode.failedTooling && command.kind === 'tooling');
    if (command.kind === 'vitest' && !mode.missingReport) {
      const report = {
        success: !failed,
        numPassedTests: failed ? 0 : 1,
        numFailedTests: failed ? 1 : 0,
        numTotalTests: 1,
        testResults: [
          {
            name: path.join(root, 'server/fixture.test.ts'),
            assertionResults: [
              {
                fullName: 'native fixture',
                status: failed ? 'failed' : 'passed',
                failureMessages: failed ? ['native assertion'] : [],
              },
            ],
          },
        ],
      };
      if (mode.mutateReport) mode.mutateReport(report);
      const file = command.args
        .find((arg) => arg.startsWith('--outputFile.json='))
        .slice('--outputFile.json='.length);
      writeFileSync(
        file,
        mode.malformedReport ? '{bad' : JSON.stringify(report)
      );
    }
    const stdout =
      command.kind === 'vitest'
        ? 'native vitest stdout'
        : mode.failedTooling && command.kind === 'tooling'
          ? failedToolingTap(root)
          : tap(failed);
    const receipt = {
      id: command.name,
      status: failed ? 'failed' : 'passed',
      exitCode: failed ? 1 : 0,
      stdout,
      stderr: '',
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutSha256: sha(stdout),
      stderrSha256: sha(''),
      aborted: false,
      timedOut: false,
      signal: null,
      spawnError: null,
      wallMs: 1,
      lifecycle: { spawned: true, completed: true, cleanupVerified: true },
    };
    for (const stream of ['stdout', 'stderr']) {
      receipt[`${stream}Log`] = path.join(
        scratchRoot,
        `${ordinal}-${stream}.log`
      );
      writeFileSync(receipt[`${stream}Log`], receipt[stream]);
    }
    ordinal++;
    if (mode.mutateReceipt) mode.mutateReceipt(receipt, command);
    if (failed || receipt.timedOut || receipt.aborted)
      throw Object.assign(new Error('actual native exit'), { receipt });
    return receipt;
  };
  return { plan, calls, nativeRun, scratchRoot };
}
const options = (value) => ({
  ...value,
  stdout: quiet,
  stderr: quiet,
  inherited: {},
  workers: 2,
});

test('completed failed Vitest cases retain native receipts and run later independent Node/tooling owners', async (t) => {
  const value = fixture(t, { failedVitest: true });
  const receipt = await executeNativeRepository(value.plan, options(value));
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(value.calls, ['vitest', 'node-js', 'tooling']);
  assert.deepEqual(receipt.cases, { passed: 2, failed: 1, skipped: 0 });
  assert.equal(receipt.commands[0].exitCode, 1);
  assert(receipt.commands[0].nativeReport.sha256);
  assert.equal(
    receipt.caseLedgers[0].cases[0].failureMessages[0],
    'native assertion'
  );
  assert.equal(receipt.failures.length, 1);
});
test('completed failed Node cases preserve exact native failure diagnostics and do not hide later tooling', async (t) => {
  const value = fixture(t, { failedNode: true });
  const receipt = await executeNativeRepository(value.plan, options(value));
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.cases, { passed: 2, failed: 1, skipped: 0 });
  assert.deepEqual(value.calls, ['vitest', 'node-js', 'tooling']);
  assert.match(
    receipt.caseLedgers[1].cases[0].rawDiagnostic,
    /native assertion/
  );
});
test('completed failed tooling TAP preserves native cases when Node uses a source-file ordinal', async (t) => {
  const value = fixture(t, { failedTooling: true });
  const failedTap = failedToolingTap(value.plan.root);
  const receipt = await executeNativeRepository(value.plan, options(value));
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(value.calls, ['vitest', 'node-js', 'tooling']);
  assert.deepEqual(receipt.cases, { passed: 3, failed: 2, skipped: 0 });
  assert.equal(receipt.caseLedgers.length, 3);
  const tooling = receipt.caseLedgers[2];
  assert.equal(tooling.complete, true);
  assert.deepEqual(tooling.issues, []);
  assert.deepEqual(tooling.counts, { passed: 1, failed: 2, skipped: 0 });
  assert.deepEqual(
    tooling.cases
      .filter((entry) => entry.status === 'failed')
      .map((entry) => entry.leafName),
    [
      'current repository has complete deterministic hosted ownership',
      tapEscape(path.normalize('bin/engine-staged-validation.test.mjs')),
    ]
  );
  assert.match(tooling.cases[0].rawDiagnostic, /gen-docs\/node_modules/);
  assert.equal(tooling.cases[2].ordinal, 3);
  assert.match(tooling.cases[2].rawCompletion, /^not ok 2 - /);
  assert.match(tooling.cases[2].rawDiagnostic, /test failed/);
  const parseTooling = (stdout) =>
    repositoryNativeCases(
      {
        kind: 'tooling',
        cwd: value.plan.root,
        files: value.plan.steps[2].files,
      },
      { stdout },
      { collectFailures: true }
    );
  for (const invalid of [
    failedTap.replace(
      "  error: 'test failed'\n  code: 'ERR_TEST_FAILURE'",
      "  error: 'test failed'\n  code: 'UNBOUND_FAILURE'"
    ),
    failedTap.replace(
      `  location: ${inspected(`${path.resolve(value.plan.root, 'bin/engine-staged-validation.test.mjs')}:1:1`)}`,
      `  location: ${inspected(`${path.resolve(path.dirname(value.plan.root), 'outside', 'bin/engine-staged-validation.test.mjs')}:1:1`)}`
    ),
    failedTap.replace(
      `not ok 2 - ${tapEscape(path.normalize('bin/engine-staged-validation.test.mjs'))}`,
      `not ok 1 - ${tapEscape(path.normalize('bin/engine-staged-validation.test.mjs'))}`
    ),
    failedTap.replace('  exitCode: 1\n  signal: ~\n', ''),
  ])
    assert.throws(
      () => parseTooling(invalid),
      /Node case ordinal\/name mismatch/
    );
});
test('TypeScript Node source failures bind absolute names and supplied runner order', (t) => {
  const scratchRoot = mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-native-accounting-node-ts-')
  );
  t.after(() => rmSync(scratchRoot, { recursive: true, force: true }));
  const files = ['server/z-source.test.ts', 'server/a-source.test.ts'],
    stdout = failedSourceTap(scratchRoot, files[0], {
      sourceOrdinal: 1,
      absoluteName: true,
    }),
    command = { kind: 'node-ts', cwd: scratchRoot, files };
  const ledger = repositoryNativeCases(
    command,
    { stdout },
    { collectFailures: true }
  );
  assert.equal(ledger.complete, true);
  assert.equal(
    ledger.cases[2].leafName,
    tapEscape(path.resolve(scratchRoot, files[0]))
  );
  assert.match(ledger.cases[2].rawCompletion, /^not ok 1 - /);
  for (const invalid of [
    stdout.replace(
      `location: ${inspected(`${path.resolve(scratchRoot, files[0])}:1:1`)}`,
      `location: ${inspected(`${path.resolve(path.dirname(scratchRoot), 'outside', files[0])}:1:1`)}`
    ),
    stdout.replace(
      `not ok 1 - ${tapEscape(path.resolve(scratchRoot, files[0]))}`,
      `not ok 2 - ${tapEscape(path.resolve(scratchRoot, files[0]))}`
    ),
  ])
    assert.throws(
      () =>
        repositoryNativeCases(
          command,
          { stdout: invalid },
          { collectFailures: true }
        ),
      /Node case ordinal\/name mismatch/
    );
});
test('source wrappers remain root-bound when source and case ordinals coincide', (t) => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-native-accounting-source-wrapper-')
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = 'bin/source-wrapper.test.mjs',
    name = path.normalize(file),
    absoluteFile = path.resolve(root, file),
    command = { kind: 'tooling', cwd: root, files: [file] },
    valid = sourceWrapperTap(name, absoluteFile);
  assert.equal(
    repositoryNativeCases(command, { stdout: valid }, { collectFailures: true })
      .complete,
    true
  );
  for (const invalid of [
    sourceWrapperTap(name, absoluteFile, {
      location: path.resolve(path.dirname(root), 'outside', file),
    }),
    sourceWrapperTap(path.normalize('bin/unplanned.test.mjs'), absoluteFile),
  ])
    assert.throws(
      () =>
        repositoryNativeCases(
          command,
          { stdout: invalid },
          { collectFailures: true }
        ),
      /Node case ordinal\/name mismatch/
    );
  assert.throws(
    () =>
      repositoryNativeCases(
        command,
        { stdout: sourceWrapperTap(name, absoluteFile, { passed: true }) },
        { collectFailures: true }
      ),
    /Native source wrapper has no discovered cases/
  );
});
test('source binding reproduces Node TAP escaping independent of host platform', () => {
  const absoluteFile = String.raw`C:\source\bin\engine\#load.test.mjs`,
    report = sourceWrapperTap(absoluteFile, absoluteFile),
    ledger = readNodeTapHierarchy(Buffer.from(report), 'node:test', {
      sourceEntries: [{ name: absoluteFile, absoluteFile }],
    });
  assert.equal(ledger.complete, true);
  assert.deepEqual(ledger.issues, []);
  assert.equal(ledger.cases[0].leafName, tapEscape(absoluteFile));
  assert.equal(tapEscape('line\n\t#\\path'), 'line\\n\\t\\#\\\\path');
});
test('missing/malformed/off-source/duplicate/unclosed/zero-active native reports abort independent owners', async (t) => {
  for (const mode of [
    { failedVitest: true, missingReport: true },
    { failedVitest: true, malformedReport: true },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.numFailedTests = 2;
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults[0].name = '/outside.test.ts';
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults.push(r.testResults[0]);
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults[0].assertionResults[0].failureMessages = [];
      },
    },
    {
      mutateReport: (r) => {
        r.numPassedTests = 0;
        r.numTotalTests = 0;
        r.testResults[0].assertionResults = [];
      },
    },
  ]) {
    const value = fixture(t, mode);
    await assert.rejects(
      executeNativeRepository(value.plan, options(value)),
      (error) => error.repositoryEvidence.completed === false
    );
    assert.deepEqual(value.calls, ['vitest']);
  }
});
test('timeout/abort/log-hash drift/cleanup uncertainty are infrastructure, never counted test failures', async (t) => {
  for (const patch of [
    { timedOut: true },
    { aborted: true },
    { signal: 'SIGTERM' },
    { stdoutSha256: '0'.repeat(64) },
    { id: 'another command' },
    { lifecycle: { spawned: true, completed: true, cleanupVerified: false } },
  ]) {
    const value = fixture(t, {
      failedVitest: true,
      mutateReceipt: (r) => Object.assign(r, patch),
    });
    await assert.rejects(executeNativeRepository(value.plan, options(value)));
    assert.deepEqual(value.calls, ['vitest']);
  }
});
test('default public execution still fails fast before independent test owners', async (t) => {
  const value = fixture(t, { failedVitest: true });
  await assert.rejects(
    executePlan(value.plan, {
      stdout: quiet,
      stderr: quiet,
      inherited: {},
      workers: 2,
      executor: async (command, execution) => {
        const receipt = await value.nativeRun({
          ...command,
          env: execution.env,
        });
        return receipt.stdout;
      },
    }),
    /actual native exit/
  );
  assert.deepEqual(value.calls, ['vitest']);
});

test('later infrastructure failure preserves earlier native case evidence without running further owners', async (t) => {
  const value = fixture(t, {
    failedNode: true,
    mutateReceipt: (receipt, command) => {
      if (command.kind === 'node-js') receipt.timedOut = true;
    },
  });
  await assert.rejects(
    executeNativeRepository(value.plan, options(value)),
    (error) => {
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(error.repositoryEvidence.caseLedgers.length, 1);
      assert.deepEqual(error.repositoryEvidence.caseLedgers[0].counts, {
        passed: 1,
        failed: 0,
        skipped: 0,
      });
      assert.deepEqual(
        error.repositoryEvidence.unexecutedSteps.map((step) => step.name),
        ['Tooling']
      );
      return true;
    }
  );
  assert.deepEqual(value.calls, ['vitest', 'node-js']);
});
