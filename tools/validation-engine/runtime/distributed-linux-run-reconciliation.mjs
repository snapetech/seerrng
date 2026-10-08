// Copyright (c) snapetech and SeerrNG contributors.
// Independent disk-only reconciliation for one production Linux Mode 3 run.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  normalizeRequiredWorkerCapacityProof,
  verifyRequiredWorkerCapacityProof,
} from './cpu-capacity.mjs';
import {
  DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
  verifyDistributedAdaptiveSchedule,
} from './distributed-adaptive-scheduler.mjs';
import { evaluateThreadExpression } from './distributed-linux-config.mjs';
import {
  createDistributedNativeTaskRequest,
  verifyDistributedNativeTaskResult,
} from './distributed-native-adapter.mjs';
import { verifyDistributedShardRun } from './distributed-shard-executor.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

const HASH64 = /^[a-f0-9]{64}$/u;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REQUIRED_STAGES = Object.freeze([
  'repository',
  'codeql',
  'build',
  'browser',
]);
const FILE_ROLES = Object.freeze([
  'processLedger',
  'processLedgerSummary',
  'processStreams',
  'result',
  'runExpectations',
  'timings',
]);
const FILE_LIMITS = Object.freeze({
  processLedger: 128 * 1024 * 1024,
  processLedgerSummary: 1024 * 1024,
  processStreams: 512 * 1024 * 1024,
  result: 128 * 1024 * 1024,
  runExpectations: 16 * 1024 * 1024,
  timings: 64 * 1024 * 1024,
});
const MAX_TOTAL_EVIDENCE_BYTES = 768 * 1024 * 1024;
const STALE_TIMESTAMP_TOLERANCE_MS = 2_000;
const INVENTORY_IDENTITY_SCHEMA =
  'seerrng-distributed-native-inventory-identity/v1';
const EMPTY_ADAPTIVE_PROFILE_SHA256 = canonicalJsonSha256({
  schema: DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
  scopes: [],
});

function fail(message) {
  throw new Error(
    `Independent distributed Linux reconciliation failed: ${message}`
  );
}

function assert(condition, message) {
  if (!condition) fail(message);
}

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function plainObject(value, label) {
  assert(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `${label} must be a plain object`
  );
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  const wanted = [...expected].toSorted(compareText);
  assert(
    actual.every((key) => typeof key === 'string') &&
      actual.length === wanted.length &&
      actual.toSorted(compareText).every((key, index) => key === wanted[index]),
    `${label} has unexpected or missing fields`
  );
  return value;
}

function text(value, label) {
  assert(
    typeof value === 'string' &&
      value.length > 0 &&
      value === value.trim() &&
      value.normalize('NFC') === value,
    `Exact ${label} is required`
  );
  return value;
}

function token(value, label) {
  const normalized = text(value, label);
  assert(TOKEN.test(normalized), `Exact ${label} is required`);
  return normalized;
}

function digest(value, label) {
  assert(
    typeof value === 'string' && HASH64.test(value),
    `${label} must be a lowercase SHA-256 digest`
  );
  return value;
}

function gitObject(value, label) {
  assert(
    typeof value === 'string' && GIT_OBJECT.test(value),
    `${label} must be a Git object ID`
  );
  return value;
}

function safeInteger(value, label, minimum = 0) {
  assert(
    Number.isSafeInteger(value) && value >= minimum,
    `${label} must be a safe integer of at least ${minimum}`
  );
  return value;
}

function duration(value, label) {
  assert(
    Number.isFinite(value) && value >= 0,
    `${label} must be a finite nonnegative duration`
  );
  return value;
}

function approximatelyEqual(left, right) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= 5
  );
}

function counts(value, label) {
  plainObject(value, label);
  const normalized = {
    passed: safeInteger(value.passed, `${label} passed count`),
    failed: safeInteger(value.failed, `${label} failed count`),
    skipped: safeInteger(value.skipped, `${label} skipped count`),
  };
  safeInteger(
    normalized.passed + normalized.failed + normalized.skipped,
    `${label} total count`
  );
  return normalized;
}

function addCounts(left, right, label) {
  const total = {
    passed: left.passed + right.passed,
    failed: left.failed + right.failed,
    skipped: left.skipped + right.skipped,
  };
  return counts(total, label);
}

function requireDeepEqual(actual, expected, label) {
  assert(isDeepStrictEqual(actual, expected), `${label} differs`);
  return actual;
}

function canonicalPath(value) {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return canonicalPath(left) === canonicalPath(right);
}

function metadataIdentity(metadata) {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    changedAtMs: metadata.ctimeMs,
    bornAtMs: metadata.birthtimeMs,
  };
}

function readStableEvidenceFile({
  role,
  path,
  evidenceRoot,
  evidenceRootBirthtimeMs,
}) {
  assert(
    typeof path === 'string' && isAbsolute(path),
    `${role} evidence path must be absolute`
  );
  const absolute = resolve(path);
  assert(
    samePath(dirname(absolute), evidenceRoot),
    `${role} evidence path is stale or outside the current evidence directory`
  );
  let before;
  try {
    before = lstatSync(absolute);
  } catch (error) {
    fail(`${role} evidence file is missing: ${error.message}`);
  }
  assert(
    before.isFile() && !before.isSymbolicLink(),
    `${role} evidence is not an ordinary file`
  );
  assert(
    samePath(realpathSync(absolute), absolute),
    `${role} evidence path resolves through an untrusted link`
  );
  assert(
    before.size > 0 && before.size <= FILE_LIMITS[role],
    `${role} evidence exceeds its bounded size`
  );
  if (evidenceRootBirthtimeMs > 0)
    assert(
      before.mtimeMs + STALE_TIMESTAMP_TOLERANCE_MS >= evidenceRootBirthtimeMs,
      `${role} evidence is stale for this run directory`
    );
  const first = readFileSync(absolute);
  const middle = lstatSync(absolute);
  const second = readFileSync(absolute);
  const after = lstatSync(absolute);
  assert(
    isDeepStrictEqual(metadataIdentity(before), metadataIdentity(middle)) &&
      isDeepStrictEqual(metadataIdentity(middle), metadataIdentity(after)) &&
      first.equals(second),
    `${role} evidence changed while it was read`
  );
  const relativePath = relative(evidenceRoot, absolute).split(sep).join('/');
  assert(
    relativePath.length > 0 &&
      !relativePath.startsWith('../') &&
      !relativePath.includes('/'),
    `${role} evidence path is not a direct run artifact`
  );
  return {
    role,
    absolute,
    relativePath,
    bytes: first,
    metadata: metadataIdentity(after),
    sha256: sha256(first),
  };
}

function createEvidenceReader(value) {
  exactKeys(
    value,
    ['evidenceDirectory', 'expected', 'files'],
    'distributed Linux reconciliation input'
  );
  const directory = text(value.evidenceDirectory, 'evidence directory');
  assert(isAbsolute(directory), 'Evidence directory must be absolute');
  const evidenceRoot = resolve(directory);
  let rootMetadata;
  try {
    rootMetadata = lstatSync(evidenceRoot);
  } catch (error) {
    fail(`Evidence directory is missing: ${error.message}`);
  }
  assert(
    rootMetadata.isDirectory() && !rootMetadata.isSymbolicLink(),
    'Evidence directory is not an ordinary directory'
  );
  assert(
    samePath(realpathSync(evidenceRoot), evidenceRoot),
    'Evidence directory resolves through an untrusted link'
  );
  exactKeys(value.files, FILE_ROLES, 'pre-success evidence files');
  const pathIdentities = FILE_ROLES.map((role) =>
    canonicalPath(text(value.files[role], `${role} evidence path`))
  );
  assert(
    new Set(pathIdentities).size === FILE_ROLES.length,
    'Pre-success evidence paths contain a duplicate'
  );
  const entries = new Map();
  let totalBytes = 0;
  for (const role of FILE_ROLES) {
    const entry = readStableEvidenceFile({
      role,
      path: value.files[role],
      evidenceRoot,
      evidenceRootBirthtimeMs: rootMetadata.birthtimeMs,
    });
    totalBytes += entry.bytes.length;
    assert(
      Number.isSafeInteger(totalBytes) &&
        totalBytes <= MAX_TOTAL_EVIDENCE_BYTES,
      'Pre-success evidence exceeds the aggregate size bound'
    );
    entries.set(role, entry);
  }
  const json = (role, label) => {
    const entry = entries.get(role);
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
    } catch (error) {
      fail(`${label} is not UTF-8: ${error.message}`);
    }
    assert(source.endsWith('\n'), `${label} is not a complete durable record`);
    try {
      return JSON.parse(source);
    } catch (error) {
      fail(`${label} is not valid JSON: ${error.message}`);
    }
  };
  const assertStable = () => {
    for (const entry of entries.values()) {
      const metadata = lstatSync(entry.absolute);
      assert(
        metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          samePath(realpathSync(entry.absolute), entry.absolute) &&
          isDeepStrictEqual(metadataIdentity(metadata), entry.metadata),
        `${entry.role} evidence changed before reconciliation completed`
      );
      const reread = readFileSync(entry.absolute);
      assert(
        reread.length === entry.bytes.length &&
          sha256(reread) === entry.sha256 &&
          reread.equals(entry.bytes),
        `${entry.role} evidence changed before reconciliation completed`
      );
    }
  };
  const manifest = deepFreeze({
    schema: 'seerrng-distributed-linux-evidence-manifest/v1',
    files: [...entries.values()]
      .map((entry) => ({
        role: entry.role,
        path: entry.relativePath,
        bytes: entry.bytes.length,
        sha256: entry.sha256,
      }))
      .toSorted((left, right) => compareText(left.role, right.role)),
  });
  return { entries, json, assertStable, evidenceRoot, manifest };
}

function normalizeExpected(value) {
  exactKeys(
    value,
    [
      'activeConfigPath',
      'applicationEntryId',
      'profileSha256',
      'runExpectationsSha256',
      'runId',
      'runtimeApplicationKey',
    ],
    'expected production run identities'
  );
  const activeConfigPath = text(
    value.activeConfigPath,
    'expected active config path'
  );
  assert(
    isAbsolute(activeConfigPath),
    'Expected active config path must be absolute'
  );
  return deepFreeze({
    activeConfigPath: resolve(activeConfigPath),
    applicationEntryId: text(
      value.applicationEntryId,
      'expected application entry ID'
    ),
    profileSha256: digest(
      value.profileSha256,
      'Expected timing profile identity'
    ),
    runExpectationsSha256: digest(
      value.runExpectationsSha256,
      'Expected native run expectations identity'
    ),
    runId: token(value.runId, 'expected production run ID'),
    runtimeApplicationKey: token(
      value.runtimeApplicationKey,
      'expected runtime application key'
    ),
  });
}

function normalizeCandidate(value) {
  exactKeys(
    value,
    ['commit', 'lockSha256', 'repository', 'sourceSha256', 'tree'],
    'staged candidate'
  );
  return {
    repository: text(value.repository, 'candidate repository'),
    commit: gitObject(value.commit, 'Candidate commit'),
    tree: gitObject(value.tree, 'Candidate tree'),
    lockSha256: digest(value.lockSha256, 'Candidate lockfile identity'),
    sourceSha256: digest(value.sourceSha256, 'Candidate source identity'),
  };
}

function uniqueTextList(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  const normalized = value.map((entry) => text(entry, `${label} entry`));
  assert(
    new Set(normalized).size === normalized.length,
    `${label} contains duplicates`
  );
  return normalized;
}

function normalizeExpectedCapacity(value) {
  exactKeys(
    value,
    [
      'availableLogicalCpus',
      'configuredWorkers',
      'effectiveLogicalCpus',
      'githubActions',
      'observedWorkerCount',
      'operatorGithubLogin',
      'policy',
      'quotaCpus',
      'visibleLogicalCpus',
    ],
    'expected native capacity'
  );
  const availableLogicalCpus = safeInteger(
    value.availableLogicalCpus,
    'expected available logical CPUs',
    1
  );
  const visibleLogicalCpus = safeInteger(
    value.visibleLogicalCpus,
    'expected visible logical CPUs',
    1
  );
  const quotaCpus = value.quotaCpus;
  assert(
    quotaCpus === null || (Number.isFinite(quotaCpus) && quotaCpus > 0),
    'Expected CPU quota is invalid'
  );
  const effectiveLogicalCpus = safeInteger(
    value.effectiveLogicalCpus,
    'expected effective logical CPUs',
    1
  );
  assert(
    effectiveLogicalCpus ===
      Math.min(
        availableLogicalCpus,
        visibleLogicalCpus,
        quotaCpus === null
          ? availableLogicalCpus
          : Math.max(1, Math.floor(quotaCpus))
      ),
    'Expected effective logical CPU calculation differs'
  );
  assert(
    value.operatorGithubLogin === null ||
      TOKEN.test(text(value.operatorGithubLogin, 'expected operator login')),
    'Expected operator login is invalid'
  );
  assert(
    typeof value.githubActions === 'boolean',
    'Expected GitHub Actions context must be boolean'
  );
  assert(
    value.observedWorkerCount === null,
    'Expected capacity must not invent observed workers'
  );
  const configuredWorkers = safeInteger(
    value.configuredWorkers,
    'expected configured workers',
    1
  );
  assert(configuredWorkers <= 256, 'Expected configured workers exceed limit');
  return {
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus,
    effectiveLogicalCpus,
    operatorGithubLogin: value.operatorGithubLogin,
    githubActions: value.githubActions,
    policy: text(value.policy, 'expected capacity policy'),
    configuredWorkers,
    observedWorkerCount: null,
  };
}

function normalizeRunExpectations(value, expected) {
  exactKeys(
    value,
    [
      'candidate',
      'capacity',
      'context',
      'executionEnvironmentSha256',
      'plan',
      'requiredCapacityProof',
      'requiredFleetProof',
      'resultReuse',
      'runId',
      'schema',
    ],
    'native run expectations'
  );
  assert(
    value.schema === 'seerrng-distributed-linux-run-expectations/v1' &&
      value.runId === expected.runId &&
      value.resultReuse === false,
    'Native run expectations identity differs'
  );
  const candidate = normalizeCandidate(value.candidate);
  const capacity = normalizeExpectedCapacity(value.capacity);
  const executionEnvironmentSha256 = digest(
    value.executionEnvironmentSha256,
    'Expected execution environment identity'
  );
  let requiredCapacityProof = null;
  if (value.requiredCapacityProof !== null) {
    try {
      requiredCapacityProof = normalizeRequiredWorkerCapacityProof(
        value.requiredCapacityProof
      );
      verifyRequiredWorkerCapacityProof(capacity, requiredCapacityProof);
    } catch (error) {
      fail(`Required worker capacity proof differs: ${error.message}`);
    }
  }
  let requiredFleetProof = null;
  if (value.requiredFleetProof !== null) {
    assert(
      requiredCapacityProof !== null,
      'Required fleet proof has no capacity proof authority'
    );
    exactKeys(
      value.requiredFleetProof,
      [
        'nodes',
        'requireAllConfiguredNodesOnline',
        'requireAtLeastOneShardPerNode',
        'requireNoConfiguredNodeExclusions',
        'schema',
      ],
      'required fleet proof'
    );
    assert(
      value.requiredFleetProof.schema ===
        'seerrng-distributed-linux-required-fleet-proof/v1' &&
        value.requiredFleetProof.requireAllConfiguredNodesOnline === true &&
        value.requiredFleetProof.requireNoConfiguredNodeExclusions === true &&
        value.requiredFleetProof.requireAtLeastOneShardPerNode === true &&
        Array.isArray(value.requiredFleetProof.nodes) &&
        value.requiredFleetProof.nodes.length >= 2,
      'Required fleet proof policy differs'
    );
    const nodes = value.requiredFleetProof.nodes.map((node, index) => {
      exactKeys(
        node,
        [
          'admittedThreads',
          'availableThreads',
          'computerName',
          'cpuName',
          'ipAddress',
          'minimumThreadCount',
          'nodeId',
          'nodeNumber',
          'port',
          'threadExpression',
        ],
        `required fleet node ${index + 1}`
      );
      const normalized = {
        nodeId: token(node.nodeId, 'required fleet node ID'),
        nodeNumber: text(node.nodeNumber, 'required fleet node number'),
        computerName: text(node.computerName, 'required fleet computer name'),
        ipAddress: text(node.ipAddress, 'required fleet IP address'),
        port: safeInteger(node.port, 'required fleet port', 1),
        cpuName: text(node.cpuName, 'required fleet CPU name'),
        availableThreads: safeInteger(
          node.availableThreads,
          'required fleet available threads',
          1
        ),
        threadExpression: text(
          node.threadExpression,
          'required fleet thread expression'
        ),
        minimumThreadCount: safeInteger(
          node.minimumThreadCount,
          'required fleet minimum thread count',
          1
        ),
        admittedThreads: safeInteger(
          node.admittedThreads,
          'required fleet admitted threads',
          1
        ),
      };
      assert(
        normalized.port <= 65535 &&
          normalized.admittedThreads ===
            evaluateThreadExpression(
              normalized.threadExpression,
              normalized.availableThreads,
              normalized.minimumThreadCount
            ),
        'Required fleet port or thread calculation differs'
      );
      if (index === 0)
        assert(
          normalized.nodeId === 'controller' &&
            normalized.nodeNumber === 'controller',
          'Required fleet controller identity differs'
        );
      else
        assert(
          /^(?:0[1-9]|[1-9]\d)$/u.test(normalized.nodeNumber) &&
            normalized.nodeId === `node-${normalized.nodeNumber}`,
          'Required fleet remote-node identity differs'
        );
      return normalized;
    });
    assert(
      nodes[0].nodeId === 'controller' &&
        nodes[0].nodeNumber === 'controller' &&
        nodes[0].availableThreads ===
          requiredCapacityProof.expectedLogicalCpus &&
        nodes[0].threadExpression === '2n' &&
        nodes[0].admittedThreads ===
          requiredCapacityProof.expectedConfiguredWorkers &&
        new Set(nodes.map(({ nodeId }) => nodeId)).size === nodes.length &&
        new Set(nodes.map(({ nodeNumber }) => nodeNumber)).size ===
          nodes.length &&
        new Set(nodes.map(({ ipAddress, port }) => `${ipAddress}:${port}`))
          .size === nodes.length,
      'Required configured fleet proof differs'
    );
    requiredFleetProof = {
      schema: value.requiredFleetProof.schema,
      nodes,
      requireAllConfiguredNodesOnline: true,
      requireNoConfiguredNodeExclusions: true,
      requireAtLeastOneShardPerNode: true,
    };
  }
  assert(
    (requiredCapacityProof === null) === (requiredFleetProof === null),
    'Required capacity and fleet proofs must be paired'
  );
  exactKeys(
    value.context,
    ['blockedRequired', 'pendingMetadata', 'resultReuse', 'stages', 'status'],
    'expected native context'
  );
  assert(
    value.context.status === 'ready' &&
      value.context.resultReuse === false &&
      Array.isArray(value.context.blockedRequired) &&
      value.context.blockedRequired.length === 0 &&
      Array.isArray(value.context.pendingMetadata),
    'Expected native context is not ready and complete'
  );
  requireDeepEqual(
    value.context.stages,
    REQUIRED_STAGES,
    'Expected native context stages'
  );
  exactKeys(value.plan, ['lanes', 'maxSlots', 'units'], 'expected native plan');
  const maxSlots = safeInteger(
    value.plan.maxSlots,
    'expected native plan slot cap',
    1
  );
  assert(
    maxSlots <= 256 && maxSlots === capacity.configuredWorkers,
    'Expected native plan slot cap differs from capacity'
  );
  assert(
    Array.isArray(value.plan.lanes) &&
      value.plan.lanes.length === REQUIRED_STAGES.length,
    'Expected native lane inventory is incomplete'
  );
  const lanes = value.plan.lanes.map((lane, index) => {
    exactKeys(
      lane,
      ['after', 'dependsOn', 'id', 'kind', 'prerequisites', 'required'],
      `expected native lane ${index + 1}`
    );
    const id = token(lane.id, `expected native lane ${index + 1} ID`);
    assert(
      id === REQUIRED_STAGES[index] &&
        typeof lane.required === 'boolean' &&
        Array.isArray(lane.prerequisites) &&
        lane.prerequisites.length === 0,
      'Expected native lane identity or readiness differs'
    );
    return {
      id,
      kind: text(lane.kind, `${id} lane kind`),
      required: lane.required,
      dependsOn: uniqueTextList(lane.dependsOn, `${id} lane dependencies`),
      after: uniqueTextList(lane.after, `${id} lane ordering`),
      prerequisites: [],
    };
  });
  const laneIds = lanes.map(({ id }) => id);
  assert(
    lanes.every((lane) =>
      [...lane.dependsOn, ...lane.after].every((id) => laneIds.includes(id))
    ),
    'Expected native lane dependency closure differs'
  );
  assert(
    Array.isArray(value.plan.units) &&
      value.plan.units.length >= REQUIRED_STAGES.length,
    'Expected native unit inventory is incomplete'
  );
  const units = value.plan.units.map((unit, index) => {
    exactKeys(
      unit,
      ['after', 'dependsOn', 'files', 'id', 'lane', 'reads', 'slots', 'writes'],
      `expected native unit ${index + 1}`
    );
    const id = token(unit.id, `expected native unit ${index + 1} ID`);
    const lane = token(unit.lane, `${id} lane`);
    assert(
      laneIds.includes(lane) && unit.slots === maxSlots,
      `Expected native unit ${id} lane or slots differ`
    );
    return {
      id,
      lane,
      slots: unit.slots,
      reads: uniqueTextList(unit.reads, `${id} reads`),
      writes: uniqueTextList(unit.writes, `${id} writes`),
      files: uniqueTextList(unit.files, `${id} files`),
      dependsOn: uniqueTextList(unit.dependsOn, `${id} dependencies`),
      after: uniqueTextList(unit.after, `${id} ordering`),
    };
  });
  const unitIds = units.map(({ id }) => id);
  assert(
    new Set(unitIds).size === unitIds.length &&
      REQUIRED_STAGES.every(
        (stage) =>
          units.filter(
            (unit) => unit.id === `native-${stage}` && unit.lane === stage
          ).length === 1
      ) &&
      units.every((unit) =>
        [...unit.dependsOn, ...unit.after].every((id) => unitIds.includes(id))
      ),
    'Expected native unit identity or dependency closure differs'
  );
  return deepFreeze({
    runId: value.runId,
    candidate,
    executionEnvironmentSha256,
    capacity,
    requiredCapacityProof,
    requiredFleetProof,
    context: structuredClone(value.context),
    plan: { maxSlots, lanes, units },
  });
}

function verifyApplicationBinding(result, expected) {
  const application = plainObject(
    result.distributedApplication,
    'distributed application binding'
  );
  const supported = plainObject(
    application.supportedApplication,
    'supported application binding'
  );
  assert(
    application.runtimeApplicationKey === expected.runtimeApplicationKey &&
      supported.entryId === expected.applicationEntryId &&
      application.configuredApplicationId === supported.applicationId &&
      application.dependencyProfilePath === supported.profilePath &&
      isAbsolute(application.dependencyProfilePath),
    'Distributed application binding differs from the expected run'
  );
  for (const [field, label] of [
    ['configuredApplicationId', 'configured application ID'],
    ['dependencyProfilePath', 'dependency profile path'],
    ['runtimeApplicationKey', 'runtime application key'],
  ])
    text(application[field], label);
  for (const [field, label] of [
    ['applicationId', 'supported application ID'],
    ['entryId', 'supported application entry ID'],
    ['name', 'supported application name'],
    ['profilePath', 'supported application profile path'],
  ])
    text(supported[field], label);
  return structuredClone(application);
}

function verifyStageAccounting(result, expected, expectations) {
  assert(result.schemaVersion === 2, 'Staged result schema differs');
  assert(result.runId === expected.runId, 'Staged result run ID differs');
  assert(result.mode === 'execute', 'Staged result is not an execution');
  assert(
    result.ok === true &&
      result.status === 'passed' &&
      result.localStatus === 'passed' &&
      result.resultReuse === false,
    'Four-stage result did not pass without reuse'
  );
  assert(
    Array.isArray(result.pendingRequired) &&
      result.pendingRequired.length === 0,
    'Four-stage result retains required pending work'
  );
  assert(
    Array.isArray(result.applicability),
    'Four-stage applicability evidence is missing'
  );
  const candidate = normalizeCandidate(result.candidate);
  requireDeepEqual(
    candidate,
    expectations.candidate,
    'Staged result/expected candidate'
  );
  assert(
    result.executionEnvironmentSha256 ===
      expectations.executionEnvironmentSha256,
    'Staged result execution environment differs'
  );
  requireDeepEqual(
    normalizeExpectedCapacity(result.capacity),
    expectations.capacity,
    'Staged result/context capacity'
  );
  const application = verifyApplicationBinding(result, expected);

  assert(
    Array.isArray(result.lanes) &&
      result.lanes.length === REQUIRED_STAGES.length,
    'Four-stage lane inventory is incomplete'
  );
  requireDeepEqual(
    result.lanes.map((lane) => lane.id),
    expectations.plan.lanes.map((lane) => lane.id),
    'Four-stage lane order'
  );
  for (const [index, lane] of result.lanes.entries()) {
    const expectedLane = expectations.plan.lanes[index];
    assert(
      lane.id === expectedLane.id &&
        lane.kind === expectedLane.kind &&
        lane.required === expectedLane.required,
      `Stage lane identity differs: ${expectedLane.id}`
    );
  }
  assert(Array.isArray(result.results), 'Four-stage unit results are missing');
  const ids = result.results.map((unit) => text(unit.id, 'stage unit ID'));
  assert(
    new Set(ids).size === ids.length,
    'Stage unit identities are duplicated'
  );
  requireDeepEqual(
    ids,
    expectations.plan.units.map((unit) => unit.id),
    'Expected/result unit identity closure'
  );
  for (const stage of REQUIRED_STAGES)
    assert(
      result.results.filter((unit) => unit.id === `native-${stage}`).length ===
        1,
      `Primary ${stage} stage result is missing or duplicated`
    );

  const evidence = plainObject(result.nativeEvidence, 'native stage evidence');
  requireDeepEqual(
    Object.keys(evidence).toSorted(compareText),
    [...ids].toSorted(compareText),
    'Native evidence/unit identity closure'
  );
  let cleanupReceipts = 0;
  const expectedUnits = new Map(
    expectations.plan.units.map((unit) => [unit.id, unit])
  );
  const verifyNestedCleanup = (value, seen = new Set()) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, 'lifecycle')
    ) {
      const lifecycle = plainObject(
        value.lifecycle,
        'native receipt lifecycle'
      );
      assert(
        lifecycle.spawned === true &&
          lifecycle.completed === true &&
          lifecycle.cleanupVerified === true &&
          lifecycle.cleanupError === null,
        'Native receipt cleanup evidence is incomplete'
      );
      if (Object.prototype.hasOwnProperty.call(value, 'aborted'))
        assert(value.aborted === false, 'Native receipt was aborted');
      if (Object.prototype.hasOwnProperty.call(value, 'timedOut'))
        assert(value.timedOut === false, 'Native receipt timed out');
      cleanupReceipts += 1;
    }
    for (const nested of Object.values(value))
      verifyNestedCleanup(nested, seen);
  };

  for (const unit of result.results) {
    const expectedUnit = expectedUnits.get(unit.id);
    assert(expectedUnit, `Unexpected stage unit: ${unit.id}`);
    assert(
      unit.lane === expectedUnit.lane && unit.slots === expectedUnit.slots,
      `Stage unit lane or slot demand differs: ${unit.id}`
    );
    assert(
      unit.status === 'passed' && unit.executed === true,
      `Stage unit did not pass: ${unit.id}`
    );
    assert(
      unit.runId === expected.runId,
      `Stage unit run ID differs: ${unit.id}`
    );
    requireDeepEqual(
      unit.candidate,
      candidate,
      `Stage unit candidate ${unit.id}`
    );
    assert(
      unit.executionEnvironmentSha256 ===
        expectations.executionEnvironmentSha256,
      `Stage unit execution environment differs: ${unit.id}`
    );
    safeInteger(unit.slots, `Stage unit ${unit.id} slots`, 1);
    assert(
      Array.isArray(unit.files),
      `Stage unit ${unit.id} files are missing`
    );
    assert(
      new Set(unit.files).size === unit.files.length &&
        unit.files.every((file) => typeof file === 'string'),
      `Stage unit ${unit.id} file inventory is invalid`
    );
    requireDeepEqual(
      unit.files,
      expectedUnit.files,
      `Stage unit ${unit.id} selected files`
    );
    duration(unit.wallMs, `Stage unit ${unit.id} wall time`);
    duration(unit.startOffsetMs, `Stage unit ${unit.id} start offset`);
    duration(unit.endOffsetMs, `Stage unit ${unit.id} end offset`);
    assert(
      unit.endOffsetMs >= unit.startOffsetMs,
      `Stage unit ${unit.id} timing is inverted`
    );
    assert(
      approximatelyEqual(unit.wallMs, unit.endOffsetMs - unit.startOffsetMs),
      `Stage unit ${unit.id} wall time differs from its offsets`
    );
    if (unit.cpuMs !== null)
      duration(unit.cpuMs, `Stage unit ${unit.id} CPU time`);
    const attempts = counts(
      unit.caseAttempts,
      `Stage unit ${unit.id} case attempts`
    );
    assert(attempts.failed === 0, `Stage unit ${unit.id} has failed cases`);
    const unitEvidence = plainObject(
      evidence[unit.id],
      `native evidence ${unit.id}`
    );
    assert(
      unitEvidence.status === 'passed' ||
        (unitEvidence.status === 'failed' && unitEvidence.advisory === true),
      `Native evidence is unresolved: ${unit.id}`
    );
    assert(
      unit.evidenceSha256 ===
        sha256(Buffer.from(JSON.stringify(unitEvidence), 'utf8')),
      `Native evidence hash differs: ${unit.id}`
    );
    verifyNestedCleanup(unitEvidence);
  }
  const resultById = new Map(result.results.map((unit) => [unit.id, unit]));
  for (const expectedUnit of expectations.plan.units) {
    const unit = resultById.get(expectedUnit.id);
    for (const dependencyId of [
      ...expectedUnit.dependsOn,
      ...expectedUnit.after,
    ])
      assert(
        unit.startOffsetMs >= resultById.get(dependencyId).endOffsetMs,
        `Stage unit ${unit.id} started before ${dependencyId} completed`
      );
    const lane = expectations.plan.lanes.find(
      ({ id }) => id === expectedUnit.lane
    );
    for (const precedingLane of lane.after)
      for (const producer of expectations.plan.units.filter(
        ({ lane: producerLane }) => producerLane === precedingLane
      ))
        assert(
          unit.startOffsetMs >= resultById.get(producer.id).endOffsetMs,
          `Stage lane ${lane.id} started before ${precedingLane} completed`
        );
  }

  let aggregateCounts = { passed: 0, failed: 0, skipped: 0 };
  for (const lane of result.lanes) {
    assert(
      lane.required === true && lane.status === 'passed',
      `Required ${lane.id} lane did not pass`
    );
    const units = result.results.filter((unit) => unit.lane === lane.id);
    const laneCounts = units.reduce(
      (sum, unit) =>
        addCounts(sum, unit.caseAttempts, `${lane.id} lane case attempts`),
      { passed: 0, failed: 0, skipped: 0 }
    );
    const spanWallMs =
      Math.max(...units.map((unit) => unit.endOffsetMs)) -
      Math.min(...units.map((unit) => unit.startOffsetMs));
    const cpuKnown = units.every((unit) => unit.cpuMs !== null);
    assert(
      lane.unitCount === units.length &&
        lane.unitsExecuted === units.length &&
        lane.unitWallMs === units.reduce((sum, unit) => sum + unit.wallMs, 0) &&
        lane.spanWallMs === spanWallMs &&
        lane.cpuMs ===
          (cpuKnown ? units.reduce((sum, unit) => sum + unit.cpuMs, 0) : null),
      `Stage lane accounting differs: ${lane.id}`
    );
    requireDeepEqual(
      counts(lane.caseAttempts, `${lane.id} lane case attempts`),
      laneCounts,
      `${lane.id} lane case accounting`
    );
    aggregateCounts = addCounts(
      aggregateCounts,
      laneCounts,
      'global stage case attempts'
    );
  }

  const stats = plainObject(result.stats, 'four-stage statistics');
  const selectedFiles = new Set(result.results.flatMap((unit) => unit.files))
    .size;
  const childCpuKnown = result.results.every((unit) => unit.cpuMs !== null);
  assert(
    stats.unitsQueued === result.results.length &&
      stats.unitsExecuted === result.results.length &&
      stats.activeUnits === 0 &&
      stats.reservedSlots === 0 &&
      stats.configuredSlotCap === expectations.plan.maxSlots &&
      safeInteger(stats.peakActiveUnits, 'peak active units', 1) <=
        result.results.length &&
      safeInteger(stats.peakReservedSlots, 'peak reserved slots', 1) <=
        stats.configuredSlotCap &&
      stats.selectedFileCount === selectedFiles &&
      stats.executedFileCount === selectedFiles &&
      stats.childCpuMs ===
        (childCpuKnown
          ? result.results.reduce((sum, unit) => sum + unit.cpuMs, 0)
          : null),
    'Global four-stage accounting differs'
  );
  requireDeepEqual(
    counts(stats.caseAttempts, 'global case attempts'),
    aggregateCounts,
    'Global case accounting'
  );
  duration(stats.wallMs, 'four-stage wall time');
  assert(
    result.results.every((unit) => unit.endOffsetMs <= stats.wallMs + 5),
    'Four-stage wall time does not contain its units'
  );
  return { application, candidate, cleanupReceipts };
}

function verifyLocalReceipt(receipt, label) {
  plainObject(receipt, label);
  assert(
    receipt.status === 'passed' &&
      receipt.exitCode === 0 &&
      receipt.signal === null &&
      receipt.aborted === false &&
      receipt.timedOut === false &&
      receipt.spawnError === null,
    `${label} did not pass cleanly`
  );
  duration(receipt.wallMs, `${label} wall time`);
  const lifecycle = plainObject(receipt.lifecycle, `${label} lifecycle`);
  assert(
    lifecycle.spawned === true &&
      lifecycle.completed === true &&
      lifecycle.cleanupVerified === true &&
      lifecycle.cleanupError === null,
    `${label} cleanup did not complete`
  );
  return receipt;
}

function uniqueIds(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const ids = values.map((value) => text(value, `${label} identity`));
  assert(new Set(ids).size === ids.length, `${label} contains duplicates`);
  return ids;
}

function nodeIds(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  return uniqueIds(
    values.map((value) => plainObject(value, `${label} entry`).nodeId),
    label
  );
}

function scheduleAssignments(schedule) {
  return schedule.threadSlots
    .flatMap((slot) =>
      slot.tests.map((test) => ({
        sequence: test.sequence,
        shardId: test.id,
        nodeId: slot.nodeId,
        threadSlotId: slot.threadSlotId,
        adapterId: test.adapterId,
        fingerprint: test.fingerprint,
        laneId: test.laneId,
        dependencies: test.dependencies,
        estimateSource: test.estimateSource,
        estimatedWorkUnits: test.estimatedWorkUnits,
      }))
    )
    .toSorted((left, right) => left.sequence - right.sequence);
}

function verifyColdScheduleAllocation(
  schedule,
  assignments,
  requiredFleetProof
) {
  if (
    requiredFleetProof === null ||
    schedule.profileSha256 !== EMPTY_ADAPTIVE_PROFILE_SHA256
  )
    return;

  const nodes = schedule.nodes.filter(
    ({ admittedThreads }) => admittedThreads > 0
  );
  const adapterIds = nodes[0].adapterIds;
  const performanceScorePermille = nodes[0].performanceScorePermille;
  assert(
    nodes.every(
      (node) =>
        isDeepStrictEqual(node.adapterIds, adapterIds) &&
        node.performanceScorePermille === performanceScorePermille
    ),
    'Cold schedule nodes do not have equivalent capabilities and neutral timing scale'
  );
  const estimatedWorkUnits = assignments[0].estimatedWorkUnits;
  assert(
    assignments.every(
      (assignment) =>
        assignment.estimateSource === 'cold-start' &&
        assignment.estimatedWorkUnits === estimatedWorkUnits
    ),
    'Empty-profile schedule does not use equal cold-start estimates'
  );

  const admittedThreads = nodes.reduce(
    (total, node) => total + node.admittedThreads,
    0
  );
  assert(
    Number.isSafeInteger(admittedThreads) && admittedThreads > 0,
    'Cold schedule admitted capacity is invalid'
  );
  const shardCounts = new Map(nodes.map(({ nodeId }) => [nodeId, 0]));
  for (const assignment of assignments)
    shardCounts.set(
      assignment.nodeId,
      safeInteger(
        (shardCounts.get(assignment.nodeId) ?? 0) + 1,
        `Cold schedule ${assignment.nodeId} shard count`
      )
    );

  // Empty history, equal work, equivalent adapters, neutral timing, and the
  // dependency-free repository catalog reduce node choice to the scheduler's
  // assigned-shards/admitted-threads comparison plus canonical node-ID ties.
  const expectedShardCounts = new Map(nodes.map(({ nodeId }) => [nodeId, 0]));
  for (let index = 0; index < assignments.length; index += 1) {
    const selected = [...nodes].toSorted((left, right) => {
      const leftNumerator =
        expectedShardCounts.get(left.nodeId) * right.admittedThreads;
      const rightNumerator =
        expectedShardCounts.get(right.nodeId) * left.admittedThreads;
      assert(
        Number.isSafeInteger(leftNumerator) &&
          Number.isSafeInteger(rightNumerator),
        'Cold schedule deterministic allocation overflowed'
      );
      const difference = leftNumerator - rightNumerator;
      assert(
        Number.isSafeInteger(difference),
        'Cold schedule deterministic comparison overflowed'
      );
      return difference || compareText(left.nodeId, right.nodeId);
    })[0];
    expectedShardCounts.set(
      selected.nodeId,
      safeInteger(
        expectedShardCounts.get(selected.nodeId) + 1,
        `Expected cold schedule ${selected.nodeId} shard count`
      )
    );
  }
  for (const node of nodes)
    assert(
      shardCounts.get(node.nodeId) === expectedShardCounts.get(node.nodeId),
      `Cold schedule allocation differs from deterministic capacity-proportional placement: ${node.nodeId}`
    );
}

function verifyNodeClosure(evidence, schedule, catalog, requiredFleetProof) {
  const scheduledNodeIds = uniqueIds(
    schedule.nodes.map((node) => node.nodeId),
    'scheduled nodes'
  ).toSorted(compareText);
  const onlineNodeIds = nodeIds(
    evidence.onlineNodes,
    'online node evidence'
  ).toSorted(compareText);
  requireDeepEqual(
    onlineNodeIds,
    scheduledNodeIds,
    'Online/scheduled node closure'
  );
  const offlineNodeIds = nodeIds(
    evidence.offlineNodes,
    'offline node evidence'
  );
  assert(
    offlineNodeIds.every((nodeId) => !scheduledNodeIds.includes(nodeId)),
    'Offline nodes overlap the schedule'
  );
  for (const node of evidence.onlineNodes)
    assert(
      node.applicationId === catalog.applicationId &&
        node.platform === catalog.platform &&
        node.candidateSha256 === catalog.candidate.candidateSha256 &&
        node.catalogSha256 === catalog.catalogSha256 &&
        node.inventorySha256 === catalog.inventorySha256 &&
        node.taskCount === catalog.tasks.length,
      `Online node ${node.nodeId} belongs to another repository inventory`
    );

  const applicationAdmission = plainObject(
    evidence.applicationAdmission,
    'application admission evidence'
  );
  assert(
    applicationAdmission.applicationId === catalog.applicationId,
    'Application admission belongs to another application'
  );
  const applicationUsable = nodeIds(
    applicationAdmission.usableNodes,
    'application-usable nodes'
  );
  const applicationAvailable = nodeIds(
    applicationAdmission.availableNodes,
    'application-available nodes'
  );
  const applicationExcluded = nodeIds(
    applicationAdmission.excludedNodes,
    'application-excluded nodes'
  );
  assert(
    applicationUsable.every((nodeId) =>
      applicationAvailable.includes(nodeId)
    ) &&
      applicationExcluded.every((nodeId) =>
        applicationAvailable.includes(nodeId)
      ) &&
      applicationUsable.every(
        (nodeId) => !applicationExcluded.includes(nodeId)
      ),
    'Application node admission sets overlap or do not close'
  );
  requireDeepEqual(
    [...applicationUsable, ...applicationExcluded].toSorted(compareText),
    applicationAvailable.toSorted(compareText),
    'Application node admission partition'
  );

  if (evidence.dependencyAdmission === null) {
    requireDeepEqual(
      applicationUsable.toSorted(compareText),
      scheduledNodeIds,
      'Application admission/schedule node closure'
    );
  } else {
    const dependencyAdmission = plainObject(
      evidence.dependencyAdmission,
      'dependency admission evidence'
    );
    const dependencyAvailable = nodeIds(
      dependencyAdmission.availableNodes,
      'dependency-available nodes'
    );
    const dependencyUsable = nodeIds(
      dependencyAdmission.usableNodes,
      'dependency-usable nodes'
    );
    const dependencyExcluded = nodeIds(
      dependencyAdmission.excludedNodes,
      'dependency-excluded nodes'
    );
    requireDeepEqual(
      dependencyUsable.toSorted(compareText),
      scheduledNodeIds,
      'Dependency admission/schedule node closure'
    );
    assert(
      dependencyUsable.every((nodeId) =>
        dependencyAvailable.includes(nodeId)
      ) &&
        dependencyExcluded.every((nodeId) =>
          dependencyAvailable.includes(nodeId)
        ) &&
        dependencyUsable.every(
          (nodeId) => !dependencyExcluded.includes(nodeId)
        ),
      'Dependency node admission sets overlap or do not close'
    );
    requireDeepEqual(
      [...dependencyUsable, ...dependencyExcluded].toSorted(compareText),
      dependencyAvailable.toSorted(compareText),
      'Dependency node admission partition'
    );
  }
  if (requiredFleetProof) {
    const expectedNodes = requiredFleetProof.nodes;
    const expectedNodeIds = expectedNodes.map(({ nodeId }) => nodeId);
    requireDeepEqual(
      scheduledNodeIds,
      [...expectedNodeIds].toSorted(compareText),
      'Required configured/scheduled fleet closure'
    );
    requireDeepEqual(
      onlineNodeIds,
      [...expectedNodeIds].toSorted(compareText),
      'Required configured/online fleet closure'
    );
    assert(
      evidence.offlineNodes.length === 0,
      'Required fleet contains an offline configured node'
    );
    requireDeepEqual(
      applicationAvailable.toSorted(compareText),
      [...expectedNodeIds].toSorted(compareText),
      'Required fleet application-available closure'
    );
    requireDeepEqual(
      applicationUsable.toSorted(compareText),
      [...expectedNodeIds].toSorted(compareText),
      'Required fleet application-usable closure'
    );
    assert(
      applicationExcluded.length === 0,
      'Required fleet contains an application-excluded node'
    );
    if (evidence.dependencyAdmission !== null) {
      const dependencyAdmission = evidence.dependencyAdmission;
      requireDeepEqual(
        nodeIds(
          dependencyAdmission.availableNodes,
          'required fleet dependency-available nodes'
        ).toSorted(compareText),
        [...expectedNodeIds].toSorted(compareText),
        'Required fleet dependency-available closure'
      );
      requireDeepEqual(
        nodeIds(
          dependencyAdmission.usableNodes,
          'required fleet dependency-usable nodes'
        ).toSorted(compareText),
        [...expectedNodeIds].toSorted(compareText),
        'Required fleet dependency-usable closure'
      );
      assert(
        dependencyAdmission.excludedNodes.length === 0,
        'Required fleet contains a dependency-excluded node'
      );
    }
    for (const expectedNode of expectedNodes) {
      const observedNode = evidence.onlineNodes.find(
        ({ nodeId }) => nodeId === expectedNode.nodeId
      );
      assert(
        observedNode?.computerName === expectedNode.computerName &&
          observedNode.ipAddress === expectedNode.ipAddress &&
          observedNode.port === expectedNode.port &&
          observedNode.cpuName === expectedNode.cpuName &&
          observedNode.availableThreads === expectedNode.availableThreads,
        `Required fleet configured identity differs: ${expectedNode.nodeId}`
      );
      const capacity = schedule.nodes.find(
        ({ nodeId }) => nodeId === expectedNode.nodeId
      );
      assert(
        capacity?.effectiveLogicalThreads === expectedNode.availableThreads &&
          capacity.configuredThreadBudget === expectedNode.admittedThreads &&
          capacity.admittedThreads === expectedNode.admittedThreads &&
          capacity.admissionStatus === 'admitted',
        `Required fleet capacity differs: ${expectedNode.nodeId}`
      );
      assert(
        schedule.threadSlots.some(
          (slot) => slot.nodeId === expectedNode.nodeId && slot.tests.length > 0
        ),
        `Required fleet node received no shard: ${expectedNode.nodeId}`
      );
    }
  }
}

function verifyRepositoryEvidence(
  result,
  expected,
  candidate,
  requiredFleetProof
) {
  const records = Object.entries(result.nativeEvidence).filter(
    ([, value]) => value?.repositoryEvidence !== undefined
  );
  assert(
    records.length === 1 && records[0][0] === 'native-repository',
    'Result must contain exactly one primary repository evidence record'
  );
  const evidence = plainObject(
    records[0][1].repositoryEvidence,
    'distributed repository evidence'
  );
  assert(
    evidence.schema === 'seerrng-distributed-repository-evidence/v3' &&
      evidence.completed === true &&
      evidence.resultReuse === false,
    'Distributed repository evidence is incomplete'
  );
  for (const [field, label] of [
    ['unexecutedSteps', 'unexecuted repository steps'],
    ['unexecutedShardIds', 'unexecuted shard identities'],
    ['duplicateShardIds', 'duplicate shard identities'],
    ['foreignShardIds', 'foreign shard identities'],
  ])
    assert(
      Array.isArray(evidence[field]) && evidence[field].length === 0,
      `Distributed repository evidence retains ${label}`
    );

  assert(
    Array.isArray(evidence.localChecks) &&
      Array.isArray(evidence.attemptedSteps),
    'Distributed local-check evidence is missing'
  );
  const attemptedSteps = evidence.attemptedSteps.map((step) => ({
    index: safeInteger(step.index, 'attempted repository step index'),
    name: text(step.name, 'attempted repository step name'),
    kind: text(step.kind, 'attempted repository step kind'),
  }));
  const localSteps = evidence.localChecks.map((check) => {
    const identity = {
      index: safeInteger(check.index, 'local repository step index'),
      name: text(check.name, 'local repository step name'),
      kind: text(check.kind, 'local repository step kind'),
    };
    verifyLocalReceipt(check.receipt, `Local repository check ${check.name}`);
    return identity;
  });
  assert(
    new Set(localSteps.map(({ index }) => index)).size === localSteps.length,
    'Local repository step indexes are duplicated'
  );
  requireDeepEqual(attemptedSteps, localSteps, 'Attempted/local step closure');

  const catalog = plainObject(evidence.catalog, 'distributed native catalog');
  assert(
    Array.isArray(catalog.tasks) && catalog.tasks.length > 0,
    'Distributed native catalog is empty'
  );
  createDistributedNativeTaskRequest(catalog, catalog.tasks[0].taskId);
  assert(
    catalog.applicationId === expected.runtimeApplicationKey &&
      catalog.candidate.commitSha === candidate.commit &&
      catalog.candidate.treeSha === candidate.tree &&
      catalog.candidate.lockfileSha256 === candidate.lockSha256,
    'Distributed catalog belongs to another application or candidate'
  );
  assert(
    catalog.inventorySha256 ===
      canonicalJsonSha256({
        schema: INVENTORY_IDENTITY_SCHEMA,
        applicationId: catalog.applicationId,
        platform: catalog.platform,
        candidateSha256: catalog.candidate.candidateSha256,
        tasks: catalog.tasks,
      }),
    'Distributed catalog inventory hash differs'
  );
  requireDeepEqual(
    catalog.tasks.map((task) => task.taskId),
    catalog.tasks.map((task) => task.taskId).toSorted(compareText),
    'Distributed catalog task order'
  );

  const scheduleValue = plainObject(
    evidence.schedule,
    'distributed adaptive schedule'
  );
  const expectations = {
    expectedApplicationId: catalog.applicationId,
    expectedProfileSha256: expected.profileSha256,
    expectedRepositoryIdentitySha256: candidate.sourceSha256,
    expectedScheduleSha256: digest(
      scheduleValue.scheduleSha256,
      'Distributed schedule identity'
    ),
    expectedTestInventorySha256: digest(
      scheduleValue.testInventorySha256,
      'Distributed schedule inventory identity'
    ),
  };
  const schedule = verifyDistributedAdaptiveSchedule(
    scheduleValue,
    expectations
  );
  digest(schedule.policySha256, 'Distributed schedule policy identity');
  const assignments = scheduleAssignments(schedule);
  const tasks = new Map(catalog.tasks.map((task) => [task.taskId, task]));
  assert(
    tasks.size === catalog.tasks.length,
    'Catalog task identities duplicate'
  );
  assert(
    assignments.length === tasks.size,
    'Distributed schedule does not close the catalog'
  );
  for (const [index, assignment] of assignments.entries()) {
    const task = tasks.get(assignment.shardId);
    assert(
      assignment.sequence === index + 1 &&
        task &&
        assignment.adapterId === task.adapterId &&
        assignment.fingerprint === task.taskId &&
        assignment.laneId === 'repository-native' &&
        Array.isArray(assignment.dependencies) &&
        assignment.dependencies.length === 0,
      `Distributed assignment changed catalog identity: ${assignment.shardId}`
    );
  }
  requireDeepEqual(
    assignments.map(({ shardId }) => shardId).toSorted(compareText),
    [...tasks.keys()].toSorted(compareText),
    'Catalog/schedule shard closure'
  );
  verifyColdScheduleAllocation(schedule, assignments, requiredFleetProof);

  const reportValue = plainObject(evidence.report, 'distributed shard report');
  const report = verifyDistributedShardRun(reportValue, {
    schedule,
    expectations,
    expectedReportSha256: digest(
      reportValue.reportSha256,
      'Distributed report identity'
    ),
  });
  assert(
    report.runId === expected.runId &&
      report.status === 'passed' &&
      report.resultReuse === false,
    'Distributed report did not pass for the expected run'
  );
  const aggregateCases = { active: 0, total: 0 };
  for (const [index, outcome] of report.outcomes.entries()) {
    const assignment = assignments[index];
    assert(
      outcome.status === 'passed' &&
        outcome.failureCode === null &&
        outcome.sequence === assignment.sequence &&
        outcome.shardId === assignment.shardId &&
        outcome.nodeId === assignment.nodeId &&
        outcome.threadSlotId === assignment.threadSlotId,
      `Distributed report changed assignment: ${assignment.shardId}`
    );
    const taskResult = verifyDistributedNativeTaskResult(outcome.result, {
      catalog,
      expectedCatalogSha256: catalog.catalogSha256,
      taskId: assignment.shardId,
    });
    const counts = taskResult.totals[taskResult.adapterId];
    aggregateCases.active += counts.active;
    aggregateCases.total += counts.total;
  }
  assert(
    Number.isSafeInteger(aggregateCases.active) &&
      Number.isSafeInteger(aggregateCases.total) &&
      aggregateCases.active >= 1 &&
      aggregateCases.active <= aggregateCases.total,
    'Distributed repository result has invalid aggregate case totals'
  );
  requireDeepEqual(
    evidence.shards,
    report.outcomes,
    'Shard/report outcome closure'
  );
  requireDeepEqual(
    evidence.attemptedShardIds,
    catalog.tasks.map((task) => task.taskId),
    'Attempted/catalog shard closure'
  );
  verifyNodeClosure(evidence, schedule, catalog, requiredFleetProof);
  return { evidence, catalog, schedule, report };
}

function expectedTimingEvidence(result, repositoryEvidence, runId) {
  const nodeTotals = new Map();
  const shards = repositoryEvidence.shards.map((shard) => {
    const prior = nodeTotals.get(shard.nodeId) ?? {
      nodeId: shard.nodeId,
      shardCount: 0,
      shardWallMs: 0,
    };
    prior.shardCount += 1;
    prior.shardWallMs += shard.wallMs;
    nodeTotals.set(shard.nodeId, prior);
    return {
      nodeId: shard.nodeId,
      shardId: shard.shardId,
      status: shard.status,
      threadSlotId: shard.threadSlotId,
      wallMs: shard.wallMs,
    };
  });
  return {
    schema: 'seerrng-distributed-linux-production-timings/v1',
    runId,
    totalWallMs: result.stats.wallMs,
    stages: result.lanes.map((lane) => ({
      id: lane.id,
      spanWallMs: lane.spanWallMs,
      status: lane.status,
      unitWallMs: lane.unitWallMs,
      unitsExecuted: lane.unitsExecuted,
    })),
    units: result.results.map((unit) => ({
      endOffsetMs: unit.endOffsetMs,
      id: unit.id,
      lane: unit.lane,
      startOffsetMs: unit.startOffsetMs,
      status: unit.status,
      wallMs: unit.wallMs,
    })),
    distributed: {
      nodeTotals: [...nodeTotals.values()].toSorted((left, right) =>
        compareText(left.nodeId, right.nodeId)
      ),
      reportWallMs: repositoryEvidence.report.wallMs,
      shards,
    },
    resultReuse: false,
  };
}

function verifyTimingEvidence(value, result, repositoryEvidence, expected) {
  requireDeepEqual(
    value,
    expectedTimingEvidence(result, repositoryEvidence, expected.runId),
    'Durable timing evidence'
  );
  duration(value.totalWallMs, 'durable total wall time');
  for (const stage of value.stages) {
    duration(stage.spanWallMs, `${stage.id} timing span`);
    duration(stage.unitWallMs, `${stage.id} unit wall time`);
  }
  for (const unit of value.units) {
    duration(unit.wallMs, `${unit.id} timing wall time`);
    duration(unit.startOffsetMs, `${unit.id} timing start offset`);
    duration(unit.endOffsetMs, `${unit.id} timing end offset`);
    assert(
      unit.endOffsetMs >= unit.startOffsetMs,
      `Durable unit timing is inverted: ${unit.id}`
    );
  }
  for (const node of value.distributed.nodeTotals) {
    safeInteger(node.shardCount, `${node.nodeId} shard count`, 1);
    duration(node.shardWallMs, `${node.nodeId} shard wall time`);
  }
  duration(value.distributed.reportWallMs, 'distributed report wall time');
  assert(
    value.distributed.reportWallMs <= value.totalWallMs,
    'Distributed report wall time exceeds the containing four-stage run'
  );
  const repositoryUnit = value.units.find(
    ({ id }) => id === 'native-repository'
  );
  assert(repositoryUnit, 'Native repository timing evidence is missing');
  assert(
    repositoryUnit.wallMs <= value.totalWallMs,
    'Native repository unit wall time exceeds the containing four-stage run'
  );
  assert(
    value.distributed.reportWallMs <= repositoryUnit.wallMs,
    'Distributed report wall time exceeds the containing native repository unit'
  );
  return {
    totalWallMs: value.totalWallMs,
    stageCount: value.stages.length,
    unitCount: value.units.length,
    shardCount: value.distributed.shards.length,
  };
}

function parseJsonLines(bytes, label) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
  assert(source.endsWith('\n'), `${label} is not durably terminated`);
  const lines = source.split('\n');
  lines.pop();
  assert(lines.length > 0, `${label} is empty`);
  assert(
    lines.every((line) => line.length > 0),
    `${label} has blank records`
  );
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`${label} record ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function verifyLedgerRecord(record, label) {
  plainObject(record, label);
  safeInteger(record.sequence, `${label} sequence`, 1);
  text(record.id, `${label} ID`);
  text(record.commandId, `${label} command ID`);
  assert(
    ['command', 'server'].includes(record.role),
    `${label} role is invalid`
  );
  assert(
    record.aborted === false &&
      record.timedOut === false &&
      record.spawnError === null,
    `${label} was interrupted`
  );
  duration(record.wallMs, `${label} wall time`);
  const lifecycle = plainObject(record.lifecycle, `${label} lifecycle`);
  assert(
    lifecycle.spawned === true &&
      lifecycle.completed === true &&
      lifecycle.cleanupVerified === true &&
      lifecycle.cleanupError === null,
    `${label} cleanup did not complete`
  );
  const passed =
    record.status === 'passed' &&
    record.exitCode === 0 &&
    record.signal === null;
  const advisoryFailure =
    record.role === 'command' &&
    record.status === 'failed' &&
    Number.isSafeInteger(record.exitCode) &&
    record.exitCode > 0 &&
    record.signal === null;
  const stoppedServer =
    record.role === 'server' &&
    record.status === 'stopped' &&
    ((record.exitCode === 0 && record.signal === null) ||
      (record.exitCode === null &&
        ['SIGTERM', 'SIGKILL'].includes(record.signal)));
  assert(
    passed || advisoryFailure || stoppedServer,
    `${label} terminal state is invalid`
  );
  for (const stream of ['stdout', 'stderr']) {
    text(record[`${stream}Log`], `${label} ${stream} log path`);
    safeInteger(record[`${stream}Bytes`], `${label} ${stream} bytes`);
    digest(record[`${stream}Sha256`], `${label} ${stream} hash`);
  }
}

function verifyProcessLedger(reader, summary, result) {
  const ledgerEntry = reader.entries.get('processLedger');
  assert(
    summary.schema === 'seerrng-distributed-linux-process-ledger/v1' &&
      summary.cleanupVerified === true &&
      Array.isArray(summary.pending) &&
      summary.pending.length === 0,
    'Durable process ledger summary is not closed'
  );
  safeInteger(summary.records, 'process ledger summary record count', 1);
  assert(
    summary.sourceSha256 === ledgerEntry.sha256 &&
      summary.evidenceSha256 === ledgerEntry.sha256,
    'Durable process ledger summary hash differs'
  );
  assert(
    typeof summary.evidenceFile === 'string' &&
      samePath(summary.evidenceFile, ledgerEntry.absolute),
    'Durable process ledger summary path differs'
  );
  const lines = parseJsonLines(ledgerEntry.bytes, 'native process ledger');
  const [header, ...records] = lines;
  exactKeys(header, ['candidate', 'schema'], 'native process ledger header');
  assert(header.schema === 1, 'Native process ledger schema differs');
  requireDeepEqual(
    header.candidate,
    result.candidate,
    'Process ledger candidate'
  );
  assert(
    records.length === summary.records,
    'Process ledger record count differs from its summary'
  );
  const ids = [];
  const sequences = [];
  for (const [index, record] of records.entries()) {
    verifyLedgerRecord(record, `Native process receipt ${index + 1}`);
    ids.push(record.id);
    sequences.push(record.sequence);
  }
  assert(
    new Set(ids).size === ids.length,
    'Process receipt IDs are duplicated'
  );
  requireDeepEqual(
    sequences.toSorted((left, right) => left - right),
    Array.from({ length: records.length }, (_, index) => index + 1),
    'Process receipt sequence closure'
  );
  return {
    recordCount: records.length,
    records,
    cleanupVerified: true,
    ledgerSha256: ledgerEntry.sha256,
  };
}

function verifyProcessStreams(value, ledgerSha256, ledgerRecords) {
  exactKeys(
    value,
    [
      'recordCount',
      'records',
      'resultReuse',
      'schema',
      'sourceLedgerSha256',
      'streamCount',
    ],
    'native process stream bundle'
  );
  assert(
    value.schema === 'seerrng-distributed-linux-process-streams/v1' &&
      value.resultReuse === false &&
      value.sourceLedgerSha256 === ledgerSha256 &&
      Array.isArray(value.records) &&
      value.recordCount === ledgerRecords.length &&
      value.records.length === ledgerRecords.length &&
      value.streamCount === ledgerRecords.length * 2,
    'Native process stream bundle is incomplete'
  );
  const fileNames = new Set();
  let streamCount = 0;
  for (const [index, bundled] of value.records.entries()) {
    exactKeys(
      bundled,
      ['commandId', 'id', 'sequence', 'streams'],
      `native process stream record ${index + 1}`
    );
    const ledger = ledgerRecords[index];
    assert(
      bundled.sequence === ledger.sequence &&
        bundled.id === ledger.id &&
        bundled.commandId === ledger.commandId,
      `Native process stream record ${index + 1} identity differs`
    );
    exactKeys(
      bundled.streams,
      ['stderr', 'stdout'],
      `native process stream record ${index + 1} streams`
    );
    for (const stream of ['stdout', 'stderr']) {
      const entry = bundled.streams[stream];
      exactKeys(
        entry,
        ['bytes', 'contentBase64', 'fileName', 'sha256'],
        `native process stream record ${index + 1} ${stream}`
      );
      const fileName = text(
        entry.fileName,
        `native process stream record ${index + 1} ${stream} file name`
      );
      assert(
        !fileName.includes('/') &&
          !fileName.includes('\\') &&
          fileName !== '.' &&
          fileName !== '..' &&
          !fileNames.has(fileName),
        'Native process stream file names are invalid or duplicated'
      );
      fileNames.add(fileName);
      assert(
        typeof entry.contentBase64 === 'string',
        `Native process stream record ${index + 1} ${stream} payload is missing`
      );
      const bytes = Buffer.from(entry.contentBase64, 'base64');
      assert(
        bytes.toString('base64') === entry.contentBase64,
        `Native process stream record ${index + 1} ${stream} payload is not canonical base64`
      );
      const expectedBytes = safeInteger(
        ledger[`${stream}Bytes`],
        `Native process receipt ${index + 1} ${stream} byte count`
      );
      const expectedSha256 = digest(
        ledger[`${stream}Sha256`],
        `Native process receipt ${index + 1} ${stream} hash`
      );
      assert(
        entry.bytes === expectedBytes &&
          bytes.length === expectedBytes &&
          entry.sha256 === expectedSha256 &&
          sha256(bytes) === expectedSha256,
        `Native process stream record ${index + 1} ${stream} content differs`
      );
      streamCount += 1;
    }
  }
  assert(
    streamCount === value.streamCount,
    'Native process stream count differs'
  );
  return { streamCount, verified: true };
}

/**
 * Reconcile a completed production run only from its durable pre-success files
 * and externally expected run/application/profile identities. The caller must
 * write this returned receipt before it writes any terminal success marker.
 */
export function reconcileDistributedLinuxRunEvidence(inputValue) {
  const reader = createEvidenceReader(inputValue);
  const expected = normalizeExpected(inputValue.expected);
  const result = reader.json('result', 'staged validation result');
  const timings = reader.json('timings', 'production timing evidence');
  const processLedgerSummary = reader.json(
    'processLedgerSummary',
    'native process ledger summary'
  );
  const processStreams = reader.json(
    'processStreams',
    'native process stream bundle'
  );
  assert(
    reader.entries.get('runExpectations').sha256 ===
      expected.runExpectationsSha256,
    'Native run expectations file identity differs'
  );
  const runExpectations = normalizeRunExpectations(
    reader.json('runExpectations', 'native run expectations'),
    expected
  );

  const stage = verifyStageAccounting(result, expected, runExpectations);
  const repository = verifyRepositoryEvidence(
    result,
    expected,
    stage.candidate,
    runExpectations.requiredFleetProof
  );
  const timing = verifyTimingEvidence(
    timings,
    result,
    repository.evidence,
    expected
  );
  const processes = verifyProcessLedger(reader, processLedgerSummary, result);
  const streams = verifyProcessStreams(
    processStreams,
    processes.ledgerSha256,
    processes.records
  );
  reader.assertStable();

  const evidenceManifestSha256 = canonicalJsonSha256(reader.manifest);
  const repositoryEvidenceSha256 = canonicalJsonSha256(repository.evidence);
  return deepFreeze({
    schema: 'seerrng-distributed-linux-run-reconciliation/v1',
    ok: true,
    status: 'passed',
    runId: expected.runId,
    activeConfigPath: expected.activeConfigPath,
    application: stage.application,
    candidate: stage.candidate,
    capacity: runExpectations.capacity,
    requiredFleetProof: runExpectations.requiredFleetProof,
    expectedUnitCount: runExpectations.plan.units.length,
    profileSha256: expected.profileSha256,
    policySha256: repository.schedule.policySha256,
    catalogSha256: repository.catalog.catalogSha256,
    scheduleSha256: repository.schedule.scheduleSha256,
    reportSha256: repository.report.reportSha256,
    repositoryEvidence: repository.evidence,
    repositoryEvidenceSha256,
    resultSha256: reader.entries.get('result').sha256,
    runExpectationsSha256: reader.entries.get('runExpectations').sha256,
    timingsSha256: reader.entries.get('timings').sha256,
    processLedgerSha256: processes.ledgerSha256,
    processLedgerSummarySha256: reader.entries.get('processLedgerSummary')
      .sha256,
    evidenceManifest: reader.manifest,
    evidenceManifestSha256,
    cleanup: {
      nativeReceiptCount: stage.cleanupReceipts,
      processReceiptCount: processes.recordCount,
      rawStreamCount: streams.streamCount,
      verified: true,
    },
    timing,
    resultReuse: false,
  });
}
