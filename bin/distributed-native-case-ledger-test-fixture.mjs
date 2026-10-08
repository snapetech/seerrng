// Copyright (c) snapetech and SeerrNG contributors.
// Shared sealed case evidence for distributed-engine focused tests.
import { createHash } from 'node:crypto';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native focused-test fixtures exercise the source modules directly.
import { DISTRIBUTED_NATIVE_CASE_LEDGER_SCHEMA } from '../tools/validation-engine/runtime/distributed-native-case-ledger.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native focused-test fixtures exercise the source modules directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

function runnerSource(adapterId) {
  return adapterId === 'node-ts'
    ? 'server/test/index.mts'
    : adapterId === 'tooling'
      ? 'bin/run-tooling-tests.mjs'
      : 'node:test';
}

function fixtureInput(task, { active = 1, total = 1 } = {}) {
  if (
    !task ||
    typeof task.adapterId !== 'string' ||
    !Array.isArray(task.files) ||
    task.files.length === 0 ||
    !Number.isSafeInteger(active) ||
    !Number.isSafeInteger(total) ||
    active < 0 ||
    total < 1 ||
    active > total ||
    (task.adapterId === 'vitest' && total < task.files.length)
  )
    throw new Error(
      'Valid distributed native case-ledger fixture input required'
    );
  return { active, total };
}

export function createNativeCaseReportFixture(task, counts = {}) {
  const { active, total } = fixtureInput(task, counts);
  if (task.adapterId === 'vitest') {
    const results = task.files.map((file) => ({
      name: file,
      assertionResults: [],
    }));
    for (let index = 0; index < total; index += 1) {
      const sourceIndex = Math.min(index, task.files.length - 1);
      results[sourceIndex].assertionResults.push({
        fullName: `focused case ${index + 1}`,
        status: index < active ? 'passed' : 'skipped',
      });
    }
    return `${JSON.stringify({
      numTotalTests: total,
      numPassedTests: active,
      numFailedTests: 0,
      numPendingTests: total - active,
      success: true,
      testResults: results,
    })}\n`;
  }
  const lines = ['TAP version 13'];
  for (let index = 0; index < total; index += 1) {
    const ordinal = index + 1;
    const name = `focused case ${ordinal}`;
    lines.push(
      `# Subtest: ${name}`,
      `ok ${ordinal} - ${name}${index < active ? '' : ' # SKIP focused fixture'}`,
      '  ---',
      '  duration_ms: 1',
      "  type: 'test'",
      '  ...'
    );
  }
  lines.push(
    `1..${total}`,
    `# tests ${total}`,
    '# suites 0',
    `# pass ${active}`,
    '# fail 0',
    '# cancelled 0',
    `# skipped ${total - active}`,
    '# todo 0',
    ''
  );
  return lines.join('\n');
}

export function createNativeCaseLedgerFixture(task, counts = {}) {
  const { active, total } = fixtureInput(task, counts);
  const files = [...task.files];
  const report = createNativeCaseReportFixture(task, { active, total });
  const cases = Array.from({ length: total }, (_, index) => {
    const ordinal = index + 1;
    const name = `focused case ${ordinal}`;
    const source =
      task.adapterId === 'vitest'
        ? files[Math.min(index, files.length - 1)]
        : runnerSource(task.adapterId);
    const identity = {
      schema: 'seerrng-distributed-native-case-identity/v1',
      adapterId: task.adapterId,
      files,
      name,
      ordinal,
      source,
    };
    return {
      caseId: canonicalJsonSha256(identity),
      name,
      ordinal,
      source,
      status: index < active ? 'passed' : 'skipped',
    };
  });
  const core = {
    schema: DISTRIBUTED_NATIVE_CASE_LEDGER_SCHEMA,
    adapterId: task.adapterId,
    files,
    format:
      task.adapterId === 'vitest'
        ? 'vitest-json-cases-v1'
        : 'node-tap13-cases-v1',
    cases,
    counts: {
      active,
      failed: 0,
      passed: active,
      skipped: total - active,
      total,
    },
    reportBase64:
      task.adapterId === 'vitest'
        ? Buffer.from(report).toString('base64')
        : null,
    reportSha256: createHash('sha256').update(report).digest('hex'),
  };
  return { ...core, ledgerSha256: canonicalJsonSha256(core) };
}
