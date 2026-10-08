// Copyright (c) snapetech and SeerrNG contributors.
// Tamper-evident, attempt-local execution evidence for hosted engine work units.
import { createHash } from 'node:crypto';

export const RUN_SCOPED_WORK_IDENTITY_SCHEMA =
  'seerrng-run-scoped-work-identity/v1';
export const RUN_SCOPED_SUCCESS_RECEIPT_SCHEMA =
  'seerrng-run-scoped-success-receipt/v1';
export const RUN_SCOPED_SUCCESS_LEDGER_SCHEMA =
  'seerrng-run-scoped-success-ledger/v1';
const HASH40 = /^[a-f0-9]{40}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const IDENTITY_KEYS = [
  'candidate',
  'command',
  'dependencies',
  'planSha256',
  'run',
  'runner',
  'schema',
  'setup',
  'toolchain',
  'unit',
  'workflow',
];
const RUN_KEYS = ['provider', 'repository', 'runAttempt', 'runId'];
const CANDIDATE_KEYS = ['commit', 'repository', 'sourceSha256', 'tree'];
const UNIT_KEYS = [
  'caseInventorySha256',
  'definitionSha256',
  'id',
  'testInventorySha256',
];
const COMMAND_KEYS = ['args', 'cwd', 'environmentSha256', 'executable'];
const DEPENDENCY_KEYS = ['lockSha256', 'stateSha256'];
const TOOLCHAIN_KEYS = ['runtimeSha256', 'toolsSha256'];
const RUNNER_KEYS = ['environmentSha256', 'image'];
const SETUP_KEYS = ['configSha256', 'fixturesSha256', 'setupSha256'];
const WORKFLOW_KEYS = ['actionsSha256', 'workflowSha256'];
const RECEIPT_KEYS = [
  'evidence',
  'identity',
  'outcome',
  'receiptSha256',
  'schema',
  'workKeySha256',
];
const OUTCOME_KEYS = ['completed', 'exitCode', 'status'];
const EVIDENCE_KEYS = [
  'artifactManifestSha256',
  'caseResultsSha256',
  'resultSha256',
  'stderrSha256',
  'stdoutSha256',
];
const LEDGER_KEYS = ['entries', 'ledgerSha256', 'schema', 'scope'];
const SCOPE_KEYS = ['candidate', 'planSha256', 'run'];

function canonicalJson(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new Error('Canonical engine data requires finite JSON numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object')
    throw new Error('Canonical engine data must contain JSON values only');
  if (seen.has(value))
    throw new Error('Canonical engine data cannot be cyclic');
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    const arrayKeys = Reflect.ownKeys(value).filter((key) => key !== 'length');
    if (
      arrayKeys.length !== value.length ||
      arrayKeys.some(
        (key) => typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)
      )
    )
      throw new Error('Canonical engine arrays must be dense JSON arrays');
    encoded = `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Canonical engine data requires plain objects');
    const objectKeys = Reflect.ownKeys(value);
    if (
      objectKeys.some(
        (key) =>
          typeof key !== 'string' ||
          !Object.prototype.propertyIsEnumerable.call(value, key)
      )
    )
      throw new Error('Canonical engine objects require JSON fields only');
    encoded = `{${objectKeys
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return encoded;
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function canonicalJsonSha256(value) {
  return sha256(canonicalJson(value));
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

function exactObject(value, label, expectedKeys) {
  plainObject(value, label);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const actual = ownKeys.toSorted();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactText(value, label, { allowDot = false } = {}) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Receipt fields cross process boundaries.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  if (!allowDot && value === '.') throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (!HASH64.test(value ?? '')) throw new Error(`Exact ${label} is required`);
  return value;
}

function repository(value, label) {
  exactText(value, label);
  if (
    !REPOSITORY.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function sourceDirectory(value) {
  exactText(value, 'command working directory', { allowDot: true });
  if (value === '.') return value;
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Command working directory must be source-relative');
  return value;
}

function runIdentity(value) {
  exactObject(value, 'run identity', RUN_KEYS);
  const run = {
    provider: value.provider,
    repository: repository(value.repository, 'run repository'),
    runId: value.runId,
    runAttempt: value.runAttempt,
  };
  if (run.provider !== 'github-actions')
    throw new Error('Run provider must be github-actions');
  if (
    typeof run.runId !== 'string' ||
    typeof run.runAttempt !== 'string' ||
    !POSITIVE_DECIMAL.test(run.runId) ||
    !POSITIVE_DECIMAL.test(run.runAttempt)
  )
    throw new Error('Exact workflow run ID and attempt are required');
  return run;
}

function candidateIdentity(value) {
  exactObject(value, 'candidate identity', CANDIDATE_KEYS);
  const candidate = {
    repository: repository(value.repository, 'candidate repository'),
    commit: value.commit,
    tree: value.tree,
    sourceSha256: digest(value.sourceSha256, 'candidate source hash'),
  };
  if (
    !HASH40.test(candidate.commit ?? '') ||
    !HASH40.test(candidate.tree ?? '')
  )
    throw new Error('Exact candidate commit and tree are required');
  return candidate;
}

function unitIdentity(value) {
  exactObject(value, 'unit identity', UNIT_KEYS);
  return {
    id: identifier(value.id, 'unit ID'),
    definitionSha256: digest(value.definitionSha256, 'unit definition hash'),
    testInventorySha256: digest(
      value.testInventorySha256,
      'test inventory hash'
    ),
    caseInventorySha256: digest(
      value.caseInventorySha256,
      'case inventory hash'
    ),
  };
}

function commandIdentity(value) {
  exactObject(value, 'command identity', COMMAND_KEYS);
  if (!Array.isArray(value.args))
    throw new Error('Exact command argument array is required');
  return {
    executable: exactText(value.executable, 'command executable'),
    args: value.args.map((argument) => {
      if (
        typeof argument !== 'string' ||
        argument.normalize('NFC') !== argument ||
        // eslint-disable-next-line no-control-regex -- Arguments are persisted in receipts.
        /[\x00-\x1f\x7f]/.test(argument)
      )
        throw new Error('Exact command argument strings are required');
      return argument;
    }),
    cwd: sourceDirectory(value.cwd),
    environmentSha256: digest(
      value.environmentSha256,
      'command environment hash'
    ),
  };
}

function dependencyIdentity(value) {
  exactObject(value, 'dependency identity', DEPENDENCY_KEYS);
  return {
    lockSha256: digest(value.lockSha256, 'dependency lock hash'),
    stateSha256: digest(value.stateSha256, 'dependency state hash'),
  };
}

function toolchainIdentity(value) {
  exactObject(value, 'toolchain identity', TOOLCHAIN_KEYS);
  return {
    toolsSha256: digest(value.toolsSha256, 'tools hash'),
    runtimeSha256: digest(value.runtimeSha256, 'runtime hash'),
  };
}

function runnerIdentity(value) {
  exactObject(value, 'runner identity', RUNNER_KEYS);
  return {
    image: exactText(value.image, 'runner image'),
    environmentSha256: digest(
      value.environmentSha256,
      'runner environment hash'
    ),
  };
}

function setupIdentity(value) {
  exactObject(value, 'setup identity', SETUP_KEYS);
  return {
    setupSha256: digest(value.setupSha256, 'setup hash'),
    fixturesSha256: digest(value.fixturesSha256, 'fixtures hash'),
    configSha256: digest(value.configSha256, 'config hash'),
  };
}

function workflowIdentity(value) {
  exactObject(value, 'workflow identity', WORKFLOW_KEYS);
  return {
    workflowSha256: digest(value.workflowSha256, 'workflow hash'),
    actionsSha256: digest(value.actionsSha256, 'actions hash'),
  };
}

function normalizeWorkIdentity(value) {
  exactObject(value, 'work identity', IDENTITY_KEYS);
  if (value.schema !== RUN_SCOPED_WORK_IDENTITY_SCHEMA)
    throw new Error('Unsupported work identity schema');
  const run = runIdentity(value.run);
  const candidate = candidateIdentity(value.candidate);
  if (run.repository !== candidate.repository)
    throw new Error('Run and candidate repositories must match');
  return {
    schema: RUN_SCOPED_WORK_IDENTITY_SCHEMA,
    run,
    candidate,
    planSha256: digest(value.planSha256, 'plan hash'),
    unit: unitIdentity(value.unit),
    command: commandIdentity(value.command),
    dependencies: dependencyIdentity(value.dependencies),
    toolchain: toolchainIdentity(value.toolchain),
    runner: runnerIdentity(value.runner),
    setup: setupIdentity(value.setup),
    workflow: workflowIdentity(value.workflow),
  };
}

export function createWorkIdentity(value) {
  return deepFreeze(normalizeWorkIdentity(value));
}

export function workKeySha256(value) {
  return canonicalJsonSha256(normalizeWorkIdentity(value));
}

function evidenceIdentity(value) {
  exactObject(value, 'success evidence', EVIDENCE_KEYS);
  return {
    resultSha256: digest(value.resultSha256, 'result hash'),
    stdoutSha256: digest(value.stdoutSha256, 'stdout hash'),
    stderrSha256: digest(value.stderrSha256, 'stderr hash'),
    artifactManifestSha256: digest(
      value.artifactManifestSha256,
      'artifact manifest hash'
    ),
    caseResultsSha256: digest(value.caseResultsSha256, 'case results hash'),
  };
}

function receiptHash(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.receiptSha256;
  return canonicalJsonSha256(unsigned);
}

export function createSuccessReceipt(value) {
  exactObject(value, 'success receipt input', ['evidence', 'identity']);
  const identity = normalizeWorkIdentity(value.identity);
  const receipt = {
    schema: RUN_SCOPED_SUCCESS_RECEIPT_SCHEMA,
    workKeySha256: canonicalJsonSha256(identity),
    identity,
    outcome: { status: 'success', exitCode: 0, completed: true },
    evidence: evidenceIdentity(value.evidence),
  };
  return deepFreeze({ ...receipt, receiptSha256: receiptHash(receipt) });
}

export function verifySuccessReceipt(value, expectedIdentity) {
  exactObject(value, 'success receipt', RECEIPT_KEYS);
  if (value.schema !== RUN_SCOPED_SUCCESS_RECEIPT_SCHEMA)
    throw new Error('Unsupported success receipt schema');
  const identity = normalizeWorkIdentity(value.identity);
  const key = canonicalJsonSha256(identity);
  if (value.workKeySha256 !== key)
    throw new Error('Success receipt work key does not match its identity');
  exactObject(value.outcome, 'success outcome', OUTCOME_KEYS);
  if (
    value.outcome.status !== 'success' ||
    value.outcome.exitCode !== 0 ||
    value.outcome.completed !== true
  )
    throw new Error('Only completed successful work can be recorded');
  const receipt = {
    schema: RUN_SCOPED_SUCCESS_RECEIPT_SCHEMA,
    workKeySha256: key,
    identity,
    outcome: { status: 'success', exitCode: 0, completed: true },
    evidence: evidenceIdentity(value.evidence),
  };
  const sealed = { ...receipt, receiptSha256: receiptHash(receipt) };
  if (value.receiptSha256 !== sealed.receiptSha256)
    throw new Error('Success receipt seal does not match its contents');
  if (
    expectedIdentity !== undefined &&
    canonicalJson(identity) !==
      canonicalJson(normalizeWorkIdentity(expectedIdentity))
  )
    throw new Error('Success receipt is not bound to the expected work');
  return deepFreeze(sealed);
}

function scopeIdentity(value) {
  exactObject(value, 'ledger scope', SCOPE_KEYS);
  const run = runIdentity(value.run);
  const candidate = candidateIdentity(value.candidate);
  if (run.repository !== candidate.repository)
    throw new Error('Run and candidate repositories must match');
  return {
    run,
    candidate,
    planSha256: digest(value.planSha256, 'plan hash'),
  };
}

function identityScope(identity) {
  return {
    run: identity.run,
    candidate: identity.candidate,
    planSha256: identity.planSha256,
  };
}

function assertScope(scope, identity) {
  if (canonicalJson(scope) !== canonicalJson(identityScope(identity)))
    throw new Error(
      'Work belongs to a different run attempt, candidate, or plan'
    );
}

function ledgerHash(ledger) {
  const unsigned = { ...ledger };
  delete unsigned.ledgerSha256;
  return canonicalJsonSha256(unsigned);
}

function sealLedger(scope, entries) {
  const ledger = {
    schema: RUN_SCOPED_SUCCESS_LEDGER_SCHEMA,
    scope,
    entries: [...entries].toSorted((left, right) =>
      left.workKeySha256 < right.workKeySha256 ? -1 : 1
    ),
  };
  return deepFreeze({ ...ledger, ledgerSha256: ledgerHash(ledger) });
}

export function createRunScopedLedger(scope) {
  return sealLedger(scopeIdentity(scope), []);
}

export function verifyRunScopedLedger(value) {
  exactObject(value, 'run-scoped ledger', LEDGER_KEYS);
  if (value.schema !== RUN_SCOPED_SUCCESS_LEDGER_SCHEMA)
    throw new Error('Unsupported run-scoped ledger schema');
  const scope = scopeIdentity(value.scope);
  if (!Array.isArray(value.entries))
    throw new Error('Run-scoped ledger entries must be an array');
  const entries = value.entries.map((entry) => verifySuccessReceipt(entry));
  const keys = entries.map((entry) => entry.workKeySha256);
  if (new Set(keys).size !== keys.length)
    throw new Error('Run-scoped ledger contains a duplicate work key');
  if (keys.some((key, index) => index > 0 && keys[index - 1] >= key))
    throw new Error('Run-scoped ledger entries are not canonically ordered');
  entries.forEach((entry) => assertScope(scope, entry.identity));
  const ledger = {
    schema: RUN_SCOPED_SUCCESS_LEDGER_SCHEMA,
    scope,
    entries,
  };
  const sealed = { ...ledger, ledgerSha256: ledgerHash(ledger) };
  if (value.ledgerSha256 !== sealed.ledgerSha256)
    throw new Error('Run-scoped ledger seal does not match its contents');
  return deepFreeze(sealed);
}

export function recordSuccessfulWork(ledgerValue, receiptValue) {
  const ledger = verifyRunScopedLedger(ledgerValue);
  const receipt = verifySuccessReceipt(receiptValue);
  assertScope(ledger.scope, receipt.identity);
  const existing = ledger.entries.find(
    (entry) => entry.workKeySha256 === receipt.workKeySha256
  );
  if (existing)
    throw new Error('Run-scoped ledger contains duplicate successful work');
  return sealLedger(ledger.scope, [...ledger.entries, receipt]);
}

export function mergeRunScopedLedgers(ledgerValues) {
  if (!Array.isArray(ledgerValues) || ledgerValues.length === 0)
    throw new Error('At least one run-scoped ledger is required');
  const ledgers = ledgerValues.map((ledger) => verifyRunScopedLedger(ledger));
  const scope = ledgers[0].scope;
  let merged = createRunScopedLedger(scope);
  for (const ledger of ledgers) {
    if (canonicalJson(ledger.scope) !== canonicalJson(scope))
      throw new Error('Cannot merge ledgers from different run scopes');
    for (const receipt of ledger.entries)
      merged = recordSuccessfulWork(merged, receipt);
  }
  return merged;
}

export function serializeSuccessReceipt(value) {
  return `${canonicalJson(verifySuccessReceipt(value))}\n`;
}

export function parseSuccessReceipt(value) {
  if (typeof value !== 'string')
    throw new Error('Serialized success receipt must be text');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Serialized success receipt is not valid JSON');
  }
  return verifySuccessReceipt(parsed);
}

export function serializeRunScopedLedger(value) {
  return `${canonicalJson(verifyRunScopedLedger(value))}\n`;
}

export function parseRunScopedLedger(value) {
  if (typeof value !== 'string')
    throw new Error('Serialized run-scoped ledger must be text');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Serialized run-scoped ledger is not valid JSON');
  }
  return verifyRunScopedLedger(parsed);
}
