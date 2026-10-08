// Copyright (c) snapetech and SeerrNG contributors.
// Normalized, hash-bound case evidence for one distributed native task.
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { readNodeTapHierarchy } from './node-tap-hierarchy.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_NATIVE_CASE_LEDGER_SCHEMA =
  'seerrng-distributed-native-case-ledger/v1';

const HASH64 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_CASES = 1_000_000;
const MAX_CASE_TEXT = 4096;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_BASE64_CHARACTERS = 4 * Math.ceil(MAX_REPORT_BYTES / 3);
const EXPLICIT_SKIP_STATUSES = new Set([
  'disabled',
  'pending',
  'skip',
  'skipped',
  'todo',
]);
const CASE_STATUSES = new Set(['failed', 'passed', 'skipped']);
const LEDGER_CORE_KEYS = [
  'adapterId',
  'cases',
  'counts',
  'files',
  'format',
  'reportBase64',
  'reportSha256',
  'schema',
];
const LEDGER_KEYS = [...LEDGER_CORE_KEYS, 'ledgerSha256'];
const CASE_KEYS = ['caseId', 'name', 'ordinal', 'source', 'status'];
const COUNT_KEYS = ['active', 'failed', 'passed', 'skipped', 'total'];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactText(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CASE_TEXT ||
    value !== value.trim() ||
    value.normalize('NFC') !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    })
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function normalizeFiles(value, label = 'distributed native case-ledger files') {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  const files = value.map((file) => {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      file.length > 1024 ||
      file !== file.trim() ||
      file.includes('\\') ||
      file.startsWith('/') ||
      file
        .split('/')
        .some((segment) => !segment || ['.', '..'].includes(segment))
    )
      throw new Error(`${label} contains an unsafe test path`);
    return file;
  });
  if (new Set(files).size !== files.length)
    throw new Error(`${label} contains duplicate test paths`);
  if (files.some((file, index) => file !== files.toSorted(compareText)[index]))
    throw new Error(`${label} must use canonical test-path order`);
  return files;
}

function sameFiles(left, right) {
  return (
    left.length === right.length &&
    left.every((file, index) => file === right[index])
  );
}

function reportDigest(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error('Distributed native case evidence bytes are required');
  return createHash('sha256').update(bytes).digest('hex');
}

function caseIdentity({ adapterId, files, name, ordinal, source }) {
  return canonicalJsonSha256({
    schema: 'seerrng-distributed-native-case-identity/v1',
    adapterId,
    files,
    name,
    ordinal,
    source,
  });
}

function countsFromCases(cases) {
  const passed = cases.filter(({ status }) => status === 'passed').length;
  const failed = cases.filter(({ status }) => status === 'failed').length;
  const skipped = cases.filter(({ status }) => status === 'skipped').length;
  return {
    active: passed + failed,
    failed,
    passed,
    skipped,
    total: cases.length,
  };
}

function canonicalCaseStatus(value, label) {
  const status = exactText(value, label);
  if (EXPLICIT_SKIP_STATUSES.has(status)) return 'skipped';
  if (!CASE_STATUSES.has(status))
    throw new Error(`${label} contains an unknown status`);
  return status;
}

function sealLedger({
  adapterId,
  cases,
  files,
  format,
  reportBase64,
  reportSha256,
}) {
  const core = {
    schema: DISTRIBUTED_NATIVE_CASE_LEDGER_SCHEMA,
    adapterId,
    files,
    format,
    cases,
    counts: countsFromCases(cases),
    reportBase64,
    reportSha256,
  };
  return verifyDistributedNativeCaseLedger({
    ...core,
    ledgerSha256: canonicalJsonSha256(core),
  });
}

function relativeVitestFile(root, value) {
  if (typeof value !== 'string' || !value)
    throw new Error('Vitest case evidence requires a source file');
  if (root === undefined) return value.split('\\').join('/');
  if (typeof root !== 'string' || !isAbsolute(root))
    throw new Error('Distributed native case ledger requires an absolute root');
  const child = relative(resolve(root), resolve(root, value))
    .split(sep)
    .join('/');
  if (!child || child === '..' || child.startsWith('../') || isAbsolute(child))
    throw new Error('Vitest case evidence escaped the requested source root');
  return child;
}

function requestedVitestFile(root, files, value) {
  const observed = relativeVitestFile(root, value);
  if (root !== undefined) return observed;
  const matches = files.filter(
    (file) => observed === file || observed.endsWith(`/${file}`)
  );
  if (matches.length !== 1)
    throw new Error('Vitest case report does not close the requested files');
  return matches[0];
}

function boundedReportBytes(value, label) {
  if (
    !Buffer.isBuffer(value) ||
    value.length === 0 ||
    value.length > MAX_REPORT_BYTES
  )
    throw new Error(`${label} must be nonempty and within the evidence bound`);
  return value;
}

function decodeReportBase64(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > MAX_REPORT_BASE64_CHARACTERS
  )
    throw new Error('Vitest case ledger requires retained report evidence');
  const bytes = boundedReportBytes(
    Buffer.from(value, 'base64'),
    'Vitest retained report'
  );
  if (bytes.toString('base64') !== value)
    throw new Error('Vitest retained report encoding is not canonical');
  return bytes;
}

function nodeSourceEntries(root, adapterId, files) {
  return files.map((file) => ({
    name:
      adapterId === 'node-ts' ? resolve(root, file) : file.split('/').join(sep),
    absoluteFile: resolve(root, file),
  }));
}

function nodeRunner(adapterId) {
  return adapterId === 'node-ts'
    ? 'server/test/index.mts'
    : adapterId === 'tooling'
      ? 'bin/run-tooling-tests.mjs'
      : 'node:test';
}

function createTapLedger({ adapterId, files, raw, sourceEntries }) {
  boundedReportBytes(raw, 'Native TAP case report');
  const marker = raw.indexOf(Buffer.from('TAP version 13'));
  if (marker < 0 || (marker > 0 && raw[marker - 1] !== 10))
    throw new Error('Actual distributed native TAP case ledger is absent');
  const tap = raw.subarray(marker);
  const runner = nodeRunner(adapterId);
  const parsed = readNodeTapHierarchy(tap, runner, { sourceEntries });
  if (
    !parsed.complete ||
    parsed.cases.length === 0 ||
    parsed.counts.failed !== 0
  )
    throw new Error(
      `Distributed native TAP case closure failed: ${parsed.issues.join('; ')}`
    );
  const cases = parsed.cases.map((entry, index) => {
    const name = exactText(entry.name, 'native TAP case name');
    const status = canonicalCaseStatus(entry.status, 'Native TAP case report');
    const ordinal = index + 1;
    return {
      caseId: caseIdentity({
        adapterId,
        files,
        name,
        ordinal,
        source: runner,
      }),
      name,
      ordinal,
      source: runner,
      status,
    };
  });
  return sealLedger({
    adapterId,
    cases,
    files,
    format: 'node-tap13-cases-v1',
    reportBase64: null,
    reportSha256: reportDigest(raw),
  });
}

function createVitestLedger({ files, report, bytes, root }) {
  plainObject(report, 'Vitest case report');
  boundedReportBytes(bytes, 'Vitest case report');
  if (!Array.isArray(report.testResults))
    throw new Error('Vitest case report requires exact file results');
  const results = report.testResults.map((result, index) => {
    plainObject(result, `Vitest file result ${index}`);
    if (!Array.isArray(result.assertionResults))
      throw new Error('Vitest case report assertion closure is missing');
    return {
      file: requestedVitestFile(root, files, result.name),
      assertions: result.assertionResults,
    };
  });
  const reportedFiles = results.map(({ file }) => file).toSorted(compareText);
  if (
    new Set(reportedFiles).size !== reportedFiles.length ||
    !sameFiles(reportedFiles, files)
  )
    throw new Error('Vitest case report does not close the requested files');
  const ordered = [...results].toSorted(({ file: left }, { file: right }) =>
    compareText(left, right)
  );
  const cases = [];
  for (const result of ordered) {
    if (result.assertions.length === 0)
      throw new Error('Vitest requested file has no discovered cases');
    for (const assertion of result.assertions) {
      plainObject(assertion, 'Vitest assertion result');
      const name = exactText(
        assertion.fullName ?? assertion.title,
        'Vitest case name'
      );
      const status = canonicalCaseStatus(
        assertion.status,
        'Vitest case report'
      );
      const ordinal = cases.length + 1;
      cases.push({
        caseId: caseIdentity({
          adapterId: 'vitest',
          files,
          name,
          ordinal,
          source: result.file,
        }),
        name,
        ordinal,
        source: result.file,
        status,
      });
    }
  }
  const counts = countsFromCases(cases);
  for (const [value, label] of [
    [report.numTotalTests, 'total'],
    [report.numPassedTests, 'passed'],
    [report.numFailedTests, 'failed'],
    [report.numPendingTests, 'pending'],
  ])
    safeInteger(value, `Vitest ${label} count`);
  if (
    counts.total !== report.numTotalTests ||
    counts.passed !== report.numPassedTests ||
    counts.failed !== report.numFailedTests ||
    counts.skipped !== report.numPendingTests ||
    report.success !== (counts.failed === 0) ||
    counts.failed !== 0
  )
    throw new Error('Vitest case report does not close its summary');
  return sealLedger({
    adapterId: 'vitest',
    cases,
    files,
    format: 'vitest-json-cases-v1',
    reportBase64: bytes.toString('base64'),
    reportSha256: reportDigest(bytes),
  });
}

export function createDistributedNativeVitestCaseLedger({
  files: filesValue,
  reportBase64,
} = {}) {
  const files = normalizeFiles(filesValue);
  const bytes = decodeReportBase64(reportBase64);
  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Retained Vitest case report is not valid JSON', {
      cause: error,
    });
  }
  return createVitestLedger({ files, report, bytes, root: undefined });
}

export function createDistributedNativeTapCaseLedger({
  adapterId: adapterIdValue,
  files: filesValue,
  report,
} = {}) {
  const adapterId = identifier(adapterIdValue, 'case-ledger adapter ID');
  const files = normalizeFiles(filesValue);
  if (!['node-js', 'node-ts', 'tooling'].includes(adapterId))
    throw new Error('Unsupported distributed native TAP case-ledger adapter');
  if (typeof report !== 'string')
    throw new Error('Native TAP case evidence requires report text');
  return createTapLedger({
    adapterId,
    files,
    raw: Buffer.from(report),
    sourceEntries: [],
  });
}

export function createDistributedNativeCaseLedger({
  adapterId: adapterIdValue,
  files: filesValue,
  root,
  stdout,
  vitestReport,
  vitestReportBytes,
} = {}) {
  const adapterId = identifier(adapterIdValue, 'case-ledger adapter ID');
  const files = normalizeFiles(filesValue);
  if (adapterId === 'vitest') {
    const bytes = Buffer.isBuffer(vitestReportBytes)
      ? vitestReportBytes
      : Buffer.from('');
    return createVitestLedger({
      files,
      report: vitestReport,
      bytes,
      root,
    });
  }

  if (!['node-js', 'node-ts', 'tooling'].includes(adapterId))
    throw new Error('Unsupported distributed native case-ledger adapter');
  if (typeof stdout !== 'string')
    throw new Error('Native TAP case evidence requires stdout text');
  const raw = Buffer.from(stdout);
  return createTapLedger({
    adapterId,
    files,
    raw,
    sourceEntries: nodeSourceEntries(root, adapterId, files),
  });
}

export function verifyDistributedNativeCaseLedger(
  value,
  { adapterId: expectedAdapterId, files: expectedFiles } = {}
) {
  exactKeys(value, LEDGER_KEYS, 'distributed native case ledger');
  if (value.schema !== DISTRIBUTED_NATIVE_CASE_LEDGER_SCHEMA)
    throw new Error('Unsupported distributed native case-ledger schema');
  const adapterId = identifier(value.adapterId, 'case-ledger adapter ID');
  const files = normalizeFiles(value.files);
  if (
    expectedAdapterId !== undefined &&
    adapterId !==
      identifier(expectedAdapterId, 'expected case-ledger adapter ID')
  )
    throw new Error('Distributed native case ledger has another adapter');
  if (
    expectedFiles !== undefined &&
    !sameFiles(
      files,
      normalizeFiles(expectedFiles, 'expected case-ledger files')
    )
  )
    throw new Error('Distributed native case ledger has another file set');
  const format = exactText(value.format, 'case-ledger report format');
  if (
    (adapterId === 'vitest' && format !== 'vitest-json-cases-v1') ||
    (adapterId !== 'vitest' && format !== 'node-tap13-cases-v1')
  )
    throw new Error('Distributed native case-ledger format is invalid');
  if (
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    value.cases.length > MAX_CASES
  )
    throw new Error('Distributed native case ledger must contain cases');
  const cases = value.cases.map((entry, index) => {
    exactKeys(entry, CASE_KEYS, `distributed native case ${index}`);
    const ordinal = safeInteger(entry.ordinal, `case ${index} ordinal`);
    if (ordinal !== index + 1)
      throw new Error('Distributed native cases require canonical ordinals');
    const name = exactText(entry.name, `case ${index} name`);
    const source = exactText(entry.source, `case ${index} source`);
    const status = exactText(entry.status, `case ${index} status`);
    if (!CASE_STATUSES.has(status))
      throw new Error('Distributed native case ledger has an unknown status');
    const caseId = digest(entry.caseId, `case ${index} identity`);
    if (caseId !== caseIdentity({ adapterId, files, name, ordinal, source }))
      throw new Error('Distributed native case identity is invalid');
    return { caseId, name, ordinal, source, status };
  });
  if (new Set(cases.map(({ caseId }) => caseId)).size !== cases.length)
    throw new Error('Distributed native case ledger contains duplicate cases');
  if (adapterId === 'vitest') {
    const sources = [...new Set(cases.map(({ source }) => source))].toSorted(
      compareText
    );
    if (!sameFiles(sources, files))
      throw new Error('Vitest case ledger does not close the requested files');
  } else {
    const expectedSource = nodeRunner(adapterId);
    if (cases.some(({ source }) => source !== expectedSource))
      throw new Error('Native TAP case ledger has another runner source');
  }
  exactKeys(value.counts, COUNT_KEYS, 'distributed native case-ledger counts');
  const actualCounts = Object.fromEntries(
    COUNT_KEYS.map((name) => [
      name,
      safeInteger(value.counts[name], `case-ledger ${name} count`),
    ])
  );
  const expectedCounts = countsFromCases(cases);
  if (
    COUNT_KEYS.some((name) => actualCounts[name] !== expectedCounts[name]) ||
    actualCounts.failed !== 0 ||
    actualCounts.total < 1 ||
    actualCounts.active + actualCounts.skipped !== actualCounts.total
  )
    throw new Error('Distributed native case-ledger counts do not close');
  const reportSha256 = digest(
    value.reportSha256,
    'distributed native case report hash'
  );
  let reportBase64 = null;
  if (adapterId === 'vitest') {
    const reportBytes = decodeReportBase64(value.reportBase64);
    if (reportDigest(reportBytes) !== reportSha256)
      throw new Error('Retained Vitest case report hash is invalid');
    reportBase64 = value.reportBase64;
  } else if (value.reportBase64 !== null)
    throw new Error('Native TAP case ledger cannot embed another report');
  const core = {
    schema: value.schema,
    adapterId,
    files,
    format,
    cases,
    counts: actualCounts,
    reportBase64,
    reportSha256,
  };
  const ledgerSha256 = digest(
    value.ledgerSha256,
    'distributed native case-ledger hash'
  );
  if (ledgerSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed native case-ledger hash is invalid');
  return deepFreeze({ ...core, ledgerSha256 });
}

export function isExplicitlySkippedDistributedNativeCaseLedger(value) {
  const ledger = verifyDistributedNativeCaseLedger(value);
  return (
    ledger.counts.active === 0 &&
    ledger.counts.skipped === ledger.counts.total &&
    ledger.cases.every(({ status }) => status === 'skipped')
  );
}
