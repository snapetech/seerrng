// Copyright (c) snapetech and SeerrNG contributors.
// Terminal production lifecycle for the contained Linux distributed gate.
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
} from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  normalizeRequiredWorkerCapacityProof,
  verifyRequiredWorkerCapacityProof,
} from './cpu-capacity.mjs';
import {
  createAdaptiveTimingObservation,
  distributedAdaptivePolicySha256,
  updateAdaptiveTimingProfileBatch,
} from './distributed-adaptive-scheduler.mjs';
import {
  persistAdaptiveTimingProfileFile,
  readAdaptiveTimingProfileFile,
} from './distributed-adaptive-timing-profile-store.mjs';
import { DISTRIBUTED_CONTROLLER_NODE_ID } from './distributed-controller-adaptive-bridge.mjs';
import {
  createSupportedApplicationListing,
  evaluateThreadExpression,
} from './distributed-linux-config.mjs';
import {
  DISTRIBUTED_LINUX_HOST_PREPARATION_RECEIPT_SCHEMA,
  normalizeDistributedLinuxHostPreparationAdmission,
} from './distributed-linux-host-preparation.mjs';
import { resolveActiveLinuxConfig } from './distributed-linux-management.mjs';
import { distributedLinuxNodeId } from './distributed-linux-node-runner.mjs';
import { reconcileDistributedLinuxRunEvidence } from './distributed-linux-run-reconciliation.mjs';
import { executeDistributedLinuxStagedValidation } from './distributed-linux-staged-bridge.mjs';
import { createNativeStageContext } from './native-stage-context.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

const HASH64 = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTAINED_RUN_VERIFICATION = 'contained-run-verification.json';
const OPTION_KEYS = Object.freeze([
  'activeConfigMarkerPath',
  'applicationEntryId',
  'containment',
  'evidenceDirectory',
  'hostPreparation',
  'nativeContextOptions',
  'runAttempt',
  'runId',
  'runtimeApplicationKey',
  'signal',
  'sourceRoot',
  'timingPolicy',
  'timingProfilePath',
]);
const CONTAINMENT_KEYS = Object.freeze([
  'verifyDockerFixture',
  'verifyGitHistory',
  'verifyNetworkBoundary',
  'withDistributedNetwork',
  'withRepositoryIsolation',
]);
const NATIVE_CONTAINMENT_KEYS = Object.freeze([
  'verifyDockerFixture',
  'verifyGitHistory',
  'verifyNetworkBoundary',
  'withRepositoryIsolation',
]);

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

function exactKeys(value, allowed, label) {
  plainObject(value, label);
  const accepted = new Set(allowed);
  const unexpected = Reflect.ownKeys(value).filter(
    (key) => typeof key !== 'string' || !accepted.has(key)
  );
  if (unexpected.length)
    throw new Error(`${label} contains unsupported fields`);
  return value;
}

function text(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.normalize('NFC') !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function token(value, label) {
  const normalized = text(value, label);
  if (!TOKEN.test(normalized)) throw new Error(`Exact ${label} is required`);
  return normalized;
}

function absolutePath(value, label) {
  const path = text(value, label);
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  return normalize(path);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredCallback(value, label) {
  if (typeof value !== 'function')
    throw new Error(`${label} must be an explicit callback`);
  return value;
}

function normalizeOptions(value) {
  exactKeys(value, OPTION_KEYS, 'distributed Linux production options');
  const containmentValue = exactKeys(
    value.containment,
    CONTAINMENT_KEYS,
    'distributed Linux containment callbacks'
  );
  const containment = Object.fromEntries(
    CONTAINMENT_KEYS.map((name) => [
      name,
      requiredCallback(containmentValue[name], `Containment ${name}`),
    ])
  );
  const nativeContextOptions = exactKeys(
    value.nativeContextOptions ?? {},
    [
      'inherited',
      'operatorGithubLogin',
      'prerequisiteReferences',
      'requiredCapacityProof',
      'reviewedPrMetadata',
      'scratchParent',
      'stderr',
      'stdout',
    ],
    'native context options'
  );
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal))
    throw new Error('Production runner signal must be an AbortSignal');
  const timingPolicy = structuredClone(
    plainObject(value.timingPolicy ?? {}, 'adaptive timing policy')
  );
  return Object.freeze({
    activeConfigMarkerPath: absolutePath(
      value.activeConfigMarkerPath,
      'Active config marker path'
    ),
    applicationEntryId: text(value.applicationEntryId, 'application entry ID'),
    containment: Object.freeze(containment),
    evidenceDirectory: absolutePath(
      value.evidenceDirectory,
      'Production evidence directory'
    ),
    hostPreparation: normalizeDistributedLinuxHostPreparationAdmission(
      value.hostPreparation
    ),
    nativeContextOptions: { ...nativeContextOptions },
    runAttempt: positiveInteger(value.runAttempt ?? 1, 'Run attempt'),
    runId: token(value.runId, 'production run ID'),
    runtimeApplicationKey: token(
      value.runtimeApplicationKey,
      'runtime application key'
    ),
    signal: value.signal,
    sourceRoot: absolutePath(value.sourceRoot, 'Source root'),
    timingPolicy,
    timingProfilePath: absolutePath(
      value.timingProfilePath,
      'Adaptive timing profile path'
    ),
  });
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeDurableEvidenceFile(path, bytesValue) {
  const bytes = Buffer.isBuffer(bytesValue)
    ? bytesValue
    : Buffer.from(bytesValue);
  let descriptor = null;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    syncDirectory(dirname(path));
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch {
      // The exclusive create may have failed before this path existed.
    }
    throw error;
  }
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function readEvidenceFile(path) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`Evidence is not a regular file: ${basename(path)}`);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'])
    if (before[field] !== after[field])
      throw new Error(`Evidence changed while it was read: ${basename(path)}`);
  if (bytes.length !== after.size)
    throw new Error(`Evidence byte count changed: ${basename(path)}`);
  return bytes;
}

function dependencies(overrides) {
  const value = plainObject(overrides, 'production runner dependencies');
  const resolved = {
    createApplicationListing: createSupportedApplicationListing,
    createNativeContext: createNativeStageContext,
    createTimingObservation: createAdaptiveTimingObservation,
    executeStagedValidation: executeDistributedLinuxStagedValidation,
    persistTimingProfile: persistAdaptiveTimingProfileFile,
    readEvidenceFile,
    readTimingProfile: readAdaptiveTimingProfileFile,
    reconcileEvidence: reconcileDistributedLinuxRunEvidence,
    resolveActiveConfig: resolveActiveLinuxConfig,
    updateTimingProfileBatch: updateAdaptiveTimingProfileBatch,
    writeEvidenceFile: writeDurableEvidenceFile,
    ...value,
  };
  for (const name of [
    'createApplicationListing',
    'createNativeContext',
    'createTimingObservation',
    'executeStagedValidation',
    'persistTimingProfile',
    'readEvidenceFile',
    'readTimingProfile',
    'reconcileEvidence',
    'resolveActiveConfig',
    'updateTimingProfileBatch',
    'writeEvidenceFile',
  ])
    requiredCallback(resolved[name], `Production dependency ${name}`);
  return resolved;
}

function evidencePaths(directory) {
  const file = (name) => resolve(directory, name);
  return Object.freeze({
    failure: file('failure.json'),
    hostPreparationReceipt: file('host-preparation-receipt.json'),
    containedRunVerification: file(CONTAINED_RUN_VERIFICATION),
    processLedger: file('native-command-receipts.jsonl'),
    processLedgerSummary: file('native-process-ledger.json'),
    processStreams: file('native-process-streams.json'),
    runExpectations: file('native-run-expectations.json'),
    reconciliation: file('independent-reconciliation.json'),
    result: file('staged-validation-result.json'),
    timingObservations: file('adaptive-timing-observations.json'),
    timingProfileUpdate: file('adaptive-timing-profile-update.json'),
    timings: file('timings.json'),
  });
}

function createFreshEvidenceDirectory(directory) {
  const parent = dirname(directory);
  const parentMetadata = lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())
    throw new Error('Production evidence parent must be a real directory');
  const realParent = realpathSync(parent);
  mkdirSync(directory, { mode: 0o700 });
  if (realpathSync(dirname(directory)) !== realParent)
    throw new Error('Production evidence parent changed during creation');
  syncDirectory(parent);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJson(deps, path, value) {
  return deps.writeEvidenceFile(path, jsonBytes(value));
}

function readJson(deps, path, label) {
  const bytes = deps.readEvidenceFile(path);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function verifyHostPreparation(options, deps) {
  const inputs = options.hostPreparation.inputs.map((input) => {
    const observed = sha256(deps.readEvidenceFile(input.containerPath));
    if (observed !== input.rawSha256)
      throw new Error(`Host-preparation raw hash differs: ${input.role}`);
    return {
      role: input.role,
      containerPath: input.containerPath,
      rawSha256: observed,
    };
  });
  return Object.freeze({
    schema: DISTRIBUTED_LINUX_HOST_PREPARATION_RECEIPT_SCHEMA,
    runId: options.runId,
    status: 'passed',
    inputs,
    resultReuse: false,
  });
}

function resolveApplication(active, entryId, createApplicationListing) {
  plainObject(active, 'active controller configuration');
  if (active.role !== 'controller')
    throw new Error(
      'Production validation requires an active controller config'
    );
  const listing = createApplicationListing(active.config);
  if (!Array.isArray(listing?.applications))
    throw new Error('Active controller application listing is invalid');
  const matches = listing.applications.filter(
    (application) => application.entryId === entryId
  );
  if (matches.length !== 1)
    throw new Error(
      `Active controller config must contain exactly one ${entryId} application entry`
    );
  const { applicationId, name, profilePath } = matches[0];
  return structuredClone({ entryId, applicationId, name, profilePath });
}

const REQUIRED_STAGES = Object.freeze([
  'repository',
  'codeql',
  'build',
  'browser',
]);

function exactFieldSet(value, fields, label) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted(compareText);
  const expected = [...fields].toSorted(compareText);
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(`${label} has unexpected or missing fields`);
  return value;
}

function stringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !entry) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${label} must be a unique string array`);
  return [...value];
}

function requiredFleetProofForController(config, requiredCapacityProof) {
  if (requiredCapacityProof === null) return null;
  const machine = (nodeId, nodeNumber, value) => ({
    nodeId,
    nodeNumber,
    computerName: value.computerName,
    ipAddress: value.ipAddress,
    port: value.port,
    cpuName: value.cpuName,
    availableThreads: value.availableThreads,
    threadExpression: value.threads,
    minimumThreadCount: value.minimumThreadCount,
    admittedThreads: evaluateThreadExpression(
      value.threads,
      value.availableThreads,
      value.minimumThreadCount
    ),
  });
  const nodes = [
    machine(DISTRIBUTED_CONTROLLER_NODE_ID, 'controller', config.global),
    ...config.nodes.map((node) =>
      machine(distributedLinuxNodeId(node.nodeNumber), node.nodeNumber, node)
    ),
  ];
  if (
    nodes.length < 2 ||
    nodes[0].availableThreads !== requiredCapacityProof.expectedLogicalCpus ||
    nodes[0].admittedThreads !==
      requiredCapacityProof.expectedConfiguredWorkers ||
    new Set(nodes.map(({ nodeId }) => nodeId)).size !== nodes.length ||
    new Set(nodes.map(({ nodeNumber }) => nodeNumber)).size !== nodes.length ||
    new Set(nodes.map(({ ipAddress, port }) => `${ipAddress}:${port}`)).size !==
      nodes.length ||
    nodes.some(({ admittedThreads }) => admittedThreads < 1)
  )
    throw new Error('Required configured fleet capacity or identity differs');
  return Object.freeze({
    schema: 'seerrng-distributed-linux-required-fleet-proof/v1',
    nodes,
    requireAllConfiguredNodesOnline: true,
    requireNoConfiguredNodeExclusions: true,
    requireAtLeastOneShardPerNode: true,
  });
}

function createRunExpectations(context, options, activeConfig) {
  const binding = plainObject(context.binding, 'native stage binding');
  const plan = plainObject(binding.plan, 'native stage plan');
  const report = plainObject(context.report, 'native context report');
  const capacity = plainObject(binding.capacity, 'native stage capacity');
  const capacityFields = [
    'availableLogicalCpus',
    'configuredWorkers',
    'effectiveLogicalCpus',
    'githubActions',
    'observedWorkerCount',
    'operatorGithubLogin',
    'policy',
    'quotaCpus',
    'visibleLogicalCpus',
  ];
  exactFieldSet(capacity, capacityFields, 'native stage capacity');
  if (
    plan.runId !== options.runId ||
    report.runId !== options.runId ||
    !isDeepStrictEqual(plan.candidate, report.candidate) ||
    plan.executionEnvironmentSha256 !== report.executionEnvironmentSha256 ||
    !isDeepStrictEqual(capacity, report.capacity) ||
    plan.maxSlots !== capacity.configuredWorkers ||
    report.sourceManifest?.sha256 !== plan.candidate?.sourceSha256 ||
    report.status !== 'ready' ||
    report.resultReuse !== false ||
    binding.resultReuse !== false ||
    !isDeepStrictEqual(report.stages, REQUIRED_STAGES) ||
    !Array.isArray(report.blockedRequired) ||
    report.blockedRequired.length !== 0 ||
    !isDeepStrictEqual(context.pendingMetadata, report.pendingMetadata)
  )
    throw new Error('Native context identity or admission differs');
  digest(
    plan.executionEnvironmentSha256,
    'Native execution environment identity'
  );
  if (!Array.isArray(plan.lanes) || !Array.isArray(plan.units))
    throw new Error('Native stage plan inventory is incomplete');
  const lanes = plan.lanes.map((lane, index) => {
    exactFieldSet(
      lane,
      ['after', 'dependsOn', 'id', 'kind', 'prerequisites', 'required'],
      `native plan lane ${index + 1}`
    );
    if (
      lane.id !== REQUIRED_STAGES[index] ||
      typeof lane.kind !== 'string' ||
      typeof lane.required !== 'boolean' ||
      !Array.isArray(lane.prerequisites)
    )
      throw new Error('Native stage lane inventory differs');
    return {
      id: lane.id,
      kind: lane.kind,
      required: lane.required,
      dependsOn: stringArray(lane.dependsOn, `${lane.id} dependencies`),
      after: stringArray(lane.after, `${lane.id} ordering`),
      prerequisites: structuredClone(lane.prerequisites),
    };
  });
  const units = plan.units.map((unit, index) => {
    exactFieldSet(
      unit,
      ['after', 'dependsOn', 'files', 'id', 'lane', 'reads', 'slots', 'writes'],
      `native plan unit ${index + 1}`
    );
    if (
      typeof unit.id !== 'string' ||
      !unit.id ||
      !REQUIRED_STAGES.includes(unit.lane) ||
      !Number.isSafeInteger(unit.slots) ||
      unit.slots !== plan.maxSlots
    )
      throw new Error('Native stage unit inventory differs');
    return {
      id: unit.id,
      lane: unit.lane,
      slots: unit.slots,
      reads: stringArray(unit.reads, `${unit.id} reads`),
      writes: stringArray(unit.writes, `${unit.id} writes`),
      files: stringArray(unit.files, `${unit.id} files`),
      dependsOn: stringArray(unit.dependsOn, `${unit.id} dependencies`),
      after: stringArray(unit.after, `${unit.id} ordering`),
    };
  });
  const unitIds = units.map(({ id }) => id);
  if (
    units.length < REQUIRED_STAGES.length ||
    new Set(unitIds).size !== unitIds.length ||
    REQUIRED_STAGES.some(
      (stage) =>
        units.filter(
          (unit) => unit.id === `native-${stage}` && unit.lane === stage
        ).length !== 1
    ) ||
    units.some((unit) =>
      [...unit.dependsOn, ...unit.after].some((id) => !unitIds.includes(id))
    )
  )
    throw new Error('Native stage unit identity closure differs');
  const requiredCapacityProof =
    options.nativeContextOptions.requiredCapacityProof === undefined ||
    options.nativeContextOptions.requiredCapacityProof === null
      ? null
      : normalizeRequiredWorkerCapacityProof(
          options.nativeContextOptions.requiredCapacityProof
        );
  if (requiredCapacityProof)
    verifyRequiredWorkerCapacityProof(capacity, requiredCapacityProof);
  if (
    options.nativeContextOptions.operatorGithubLogin !== undefined &&
    options.nativeContextOptions.operatorGithubLogin !== null &&
    capacity.operatorGithubLogin !==
      options.nativeContextOptions.operatorGithubLogin
  )
    throw new Error('Native context operator identity differs');
  const requiredFleetProof = requiredFleetProofForController(
    activeConfig,
    requiredCapacityProof
  );
  return Object.freeze({
    schema: 'seerrng-distributed-linux-run-expectations/v1',
    runId: options.runId,
    candidate: structuredClone(plan.candidate),
    executionEnvironmentSha256: plan.executionEnvironmentSha256,
    capacity: structuredClone(capacity),
    requiredCapacityProof: requiredCapacityProof
      ? structuredClone(requiredCapacityProof)
      : null,
    requiredFleetProof: requiredFleetProof
      ? structuredClone(requiredFleetProof)
      : null,
    context: {
      status: report.status,
      stages: [...report.stages],
      blockedRequired: structuredClone(report.blockedRequired),
      pendingMetadata: structuredClone(report.pendingMetadata),
      resultReuse: report.resultReuse,
    },
    plan: {
      maxSlots: plan.maxSlots,
      lanes,
      units,
    },
    resultReuse: false,
  });
}

function requiredPendingMetadata(context, result) {
  const pending = [
    ...(Array.isArray(context.pendingMetadata) ? context.pendingMetadata : []),
    ...(Array.isArray(result.pendingRequired) ? result.pendingRequired : []),
  ];
  return pending.filter((entry) => entry?.required !== false);
}

function repositoryEvidenceFromResult(result) {
  const values = Object.values(
    plainObject(result.nativeEvidence, 'native stage evidence')
  )
    .map((entry) => entry?.repositoryEvidence)
    .filter((entry) => entry !== undefined);
  if (values.length !== 1)
    throw new Error(
      'Production result must contain exactly one distributed repository evidence record'
    );
  return plainObject(values[0], 'distributed repository evidence');
}

function timingEvidence(result, repositoryEvidence, runId) {
  if (!Array.isArray(result.lanes) || !Array.isArray(result.results))
    throw new Error('Production result has no complete four-stage timing data');
  const stageIds = new Set(result.lanes.map(({ id }) => id));
  for (const required of ['repository', 'codeql', 'build', 'browser'])
    if (!stageIds.has(required))
      throw new Error(`Production result is missing ${required} stage timing`);
  const shards = Array.isArray(repositoryEvidence.shards)
    ? repositoryEvidence.shards.map((shard) => ({
        nodeId: shard.nodeId,
        shardId: shard.shardId,
        status: shard.status,
        threadSlotId: shard.threadSlotId,
        wallMs: shard.wallMs,
      }))
    : [];
  const nodeTotals = new Map();
  for (const shard of shards) {
    const prior = nodeTotals.get(shard.nodeId) ?? {
      nodeId: shard.nodeId,
      shardCount: 0,
      shardWallMs: 0,
    };
    prior.shardCount += 1;
    prior.shardWallMs += shard.wallMs;
    nodeTotals.set(shard.nodeId, prior);
  }
  return {
    schema: 'seerrng-distributed-linux-production-timings/v1',
    runId,
    totalWallMs: result.stats?.wallMs,
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
        left.nodeId.localeCompare(right.nodeId)
      ),
      reportWallMs: repositoryEvidence.report?.wallMs,
      shards,
    },
    resultReuse: false,
  };
}

function parseProcessLedgerRecords(bytes, expectedCount) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('Native process receipt ledger is not UTF-8', {
      cause: error,
    });
  }
  if (!source.endsWith('\n'))
    throw new Error('Native process receipt ledger is not durably terminated');
  const lines = source.split('\n');
  lines.pop();
  if (lines.length < 2 || lines.some((line) => line.length === 0))
    throw new Error('Native process receipt ledger is incomplete');
  const values = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Native process receipt ledger record ${index + 1} is invalid JSON`,
        { cause: error }
      );
    }
  });
  const [header, ...records] = values;
  if (header?.schema !== 1 || !header.candidate)
    throw new Error('Native process receipt ledger header is invalid');
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 1 ||
    records.length !== expectedCount
  )
    throw new Error('Native process receipt ledger count differs');
  const ids = new Set();
  const paths = new Set();
  for (const [index, record] of records.entries()) {
    plainObject(record, `native process receipt ${index + 1}`);
    if (
      record.sequence !== index + 1 ||
      typeof record.id !== 'string' ||
      !record.id ||
      ids.has(record.id) ||
      typeof record.commandId !== 'string' ||
      !record.commandId
    )
      throw new Error('Native process receipt identity closure differs');
    ids.add(record.id);
    for (const stream of ['stdout', 'stderr']) {
      const path = absolutePath(
        record[`${stream}Log`],
        `Native process ${stream} log`
      );
      if (paths.has(path))
        throw new Error('Native process receipts reuse a stream log');
      paths.add(path);
      if (
        !Number.isSafeInteger(record[`${stream}Bytes`]) ||
        record[`${stream}Bytes`] < 0
      )
        throw new Error('Native process stream byte count is invalid');
      digest(record[`${stream}Sha256`], `Native process ${stream} stream hash`);
    }
  }
  return records;
}

function stableNativeLogBytes(pathValue, logRoot, deps, label) {
  const path = absolutePath(pathValue, label);
  const child = relative(logRoot, path);
  if (
    !child ||
    child === '..' ||
    child.startsWith('../') ||
    child.startsWith('..\\') ||
    isAbsolute(child) ||
    dirname(child) !== '.'
  )
    throw new Error(`${label} is outside the owned native log directory`);
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    realpathSync(path) !== path
  )
    throw new Error(`${label} is not an ordinary canonical file`);
  const bytes = deps.readEvidenceFile(path);
  const after = lstatSync(path);
  for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'])
    if (before[field] !== after[field])
      throw new Error(`${label} changed during collection`);
  if (bytes.length !== after.size)
    throw new Error(`${label} byte count changed during collection`);
  return bytes;
}

function collectNativeProcessStreams(records, ledgerPath, deps) {
  const scratchRoot = dirname(ledgerPath);
  const logRoot = resolve(scratchRoot, 'logs');
  const metadata = lstatSync(logRoot);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    realpathSync(logRoot) !== logRoot
  )
    throw new Error('Native process log root is not an ordinary directory');
  return records.map((record, index) => ({
    sequence: record.sequence,
    id: record.id,
    commandId: record.commandId,
    streams: Object.fromEntries(
      ['stdout', 'stderr'].map((stream) => {
        const bytes = stableNativeLogBytes(
          record[`${stream}Log`],
          logRoot,
          deps,
          `Native process receipt ${index + 1} ${stream} log`
        );
        if (
          bytes.length !== record[`${stream}Bytes`] ||
          sha256(bytes) !== record[`${stream}Sha256`]
        )
          throw new Error(
            `Native process receipt ${index + 1} ${stream} log differs`
          );
        return [
          stream,
          {
            fileName: basename(record[`${stream}Log`]),
            bytes: bytes.length,
            sha256: record[`${stream}Sha256`],
            contentBase64: bytes.toString('base64'),
          },
        ];
      })
    ),
  }));
}

function copyProcessLedger(context, deps, paths) {
  const summary = plainObject(
    context.describeNativeProcessReceipts(),
    'native process receipt ledger'
  );
  const sourcePath = absolutePath(
    summary.file,
    'Native process receipt ledger'
  );
  const bytes = deps.readEvidenceFile(sourcePath);
  const sourceSha256 = sha256(bytes);
  if (summary.sha256 !== sourceSha256)
    throw new Error('Native process receipt ledger changed before collection');
  if (
    summary.cleanupVerified !== true ||
    !Array.isArray(summary.pending) ||
    summary.pending.length !== 0
  )
    throw new Error('Native process receipt ledger is not closed');
  const records = parseProcessLedgerRecords(bytes, summary.records);
  const streams = collectNativeProcessStreams(records, sourcePath, deps);
  const streamReceipt = writeJson(deps, paths.processStreams, {
    schema: 'seerrng-distributed-linux-process-streams/v1',
    sourceLedgerSha256: sourceSha256,
    recordCount: records.length,
    streamCount: records.length * 2,
    records: streams,
    resultReuse: false,
  });
  const ledgerReceipt = deps.writeEvidenceFile(paths.processLedger, bytes);
  const durableSummary = {
    schema: 'seerrng-distributed-linux-process-ledger/v1',
    records: summary.records,
    pending: [],
    cleanupVerified: true,
    sourceSha256,
    evidenceSha256: ledgerReceipt.sha256,
    evidenceFile: paths.processLedger,
  };
  const receipt = writeJson(deps, paths.processLedgerSummary, durableSummary);
  return { durableSummary, ledgerReceipt, receipt, streamReceipt };
}

function positiveDuration(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a finite nonnegative duration`);
  return Math.max(1, Math.ceil(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deriveTimingObservations({
  application,
  activeConfig,
  createTimingObservation,
  reconciliation,
  result,
  runAttempt,
  runId,
  runtimeApplicationKey,
  sourceProfile,
  timingPolicy,
}) {
  const evidence = plainObject(
    reconciliation.repositoryEvidence,
    'reconciled repository evidence'
  );
  if (evidence.completed !== true)
    throw new Error('Reconciled repository evidence is incomplete');
  const catalog = plainObject(evidence.catalog, 'reconciled catalog');
  const schedule = plainObject(evidence.schedule, 'reconciled schedule');
  const report = plainObject(evidence.report, 'reconciled shard report');
  if (report.status !== 'passed')
    throw new Error('Reconciled shard report did not pass');
  if (
    !Array.isArray(catalog.tasks) ||
    catalog.tasks.length === 0 ||
    !Array.isArray(schedule.threadSlots) ||
    !Array.isArray(schedule.nodes) ||
    !Array.isArray(evidence.shards)
  )
    throw new Error('Reconciled repository evidence has no timing inventory');

  const tasks = new Map(
    catalog.tasks.map((task) => [text(task.taskId, 'catalog task ID'), task])
  );
  if (tasks.size !== catalog.tasks.length)
    throw new Error('Reconciled catalog contains duplicate task identities');
  const nodes = new Map(
    schedule.nodes.map((node) => [text(node.nodeId, 'schedule node ID'), node])
  );
  if (nodes.size !== schedule.nodes.length)
    throw new Error('Reconciled schedule contains duplicate node identities');
  const assignments = new Map();
  for (const slot of schedule.threadSlots)
    for (const scheduled of slot.tests ?? []) {
      const id = text(scheduled.id, 'scheduled task ID');
      if (assignments.has(id))
        throw new Error('Reconciled schedule duplicates a task assignment');
      assignments.set(id, {
        nodeId: slot.nodeId,
        scheduled,
        threadSlotId: slot.threadSlotId,
      });
    }
  const shards = new Map(
    evidence.shards.map((shard) => [
      text(shard.shardId, 'reconciled shard ID'),
      shard,
    ])
  );
  if (shards.size !== evidence.shards.length)
    throw new Error('Reconciled evidence duplicates a shard result');
  const expectedIds = [...tasks.keys()].toSorted(compareText);
  for (const actual of [assignments, shards])
    if (
      actual.size !== expectedIds.length ||
      [...actual.keys()]
        .toSorted(compareText)
        .some((id, index) => id !== expectedIds[index])
    )
      throw new Error(
        'Reconciled timing inventory does not close exactly once'
      );

  const profileSha256 = canonicalJsonSha256(sourceProfile);
  if (schedule.profileSha256 !== profileSha256)
    throw new Error('Reconciled schedule belongs to another timing profile');
  const policySha256 = distributedAdaptivePolicySha256(timingPolicy);
  if (schedule.policySha256 !== policySha256)
    throw new Error('Reconciled schedule belongs to another timing policy');
  const repositoryIdentitySha256 = digest(
    schedule.repositoryIdentitySha256,
    'Schedule repository identity'
  );
  const candidateSha256 = digest(
    catalog.candidate?.candidateSha256,
    'Catalog candidate identity'
  );
  const reconciliationSha256 = canonicalJsonSha256(reconciliation);
  const source = {
    applicationIsolationKeySha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-application-isolation/v1',
      activeConfig,
      application,
      runtimeApplicationKey,
    }),
    brokerReconciliationInputSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-reconciliation-input/v1',
      catalogSha256: catalog.catalogSha256,
      reportSha256: report.reportSha256,
      scheduleSha256: schedule.scheduleSha256,
    }),
    candidateSha256,
    executionBridgeSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-execution-bridge/v1',
      applicationEntryId: application.entryId,
      candidateSha256,
      repositoryIdentitySha256,
      runId,
      runtimeApplicationKey,
    }),
    executionId: runId,
    policySha256,
    profileSha256,
    revision: text(result.candidate?.commit, 'candidate revision'),
    runAttempt,
    scheduleTestInventorySha256: digest(
      schedule.testInventorySha256,
      'Schedule test inventory identity'
    ),
    scheduleSha256: digest(schedule.scheduleSha256, 'Schedule identity'),
    submissionSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-schedule-submission/v1',
      applicationId: schedule.applicationId,
      runId,
      scheduleSha256: schedule.scheduleSha256,
      testInventorySha256: schedule.testInventorySha256,
    }),
    terminalReconciliationSha256: reconciliationSha256,
  };
  const groups = new Map();
  for (const id of expectedIds) {
    const task = tasks.get(id);
    const assignment = assignments.get(id);
    const shard = shards.get(id);
    if (
      shard.status !== 'passed' ||
      shard.nodeId !== assignment.nodeId ||
      shard.threadSlotId !== assignment.threadSlotId ||
      task.adapterId !== assignment.scheduled.adapterId
    )
      throw new Error('Reconciled shard timing changed its sealed assignment');
    const node = plainObject(
      nodes.get(assignment.nodeId),
      `schedule node ${assignment.nodeId}`
    );
    if (
      node.scope?.nodeId !== node.nodeId ||
      !Number.isSafeInteger(node.admittedThreads) ||
      node.admittedThreads < 1 ||
      !Number.isSafeInteger(node.performanceScorePermille) ||
      node.performanceScorePermille < 1
    )
      throw new Error('Reconciled node timing capacity is invalid');
    const scope = {
      applicationId: text(schedule.applicationId, 'schedule application ID'),
      laneId: text(assignment.scheduled.laneId, 'scheduled lane ID'),
      adapterId: text(task.adapterId, 'catalog adapter ID'),
      repositoryIdentitySha256,
      environment: text(node.scope.environment, 'node timing environment'),
      nodeId: text(node.nodeId, 'node timing ID'),
      selectedN: node.admittedThreads,
    };
    const key = canonicalJsonSha256(scope);
    const group = groups.get(key) ?? {
      benchmark: {
        valid: true,
        performanceScorePermille: node.performanceScorePermille,
      },
      inventory: [],
      results: [],
      scope,
    };
    group.inventory.push({ id, fingerprint: assignment.scheduled.fingerprint });
    group.results.push({
      durationMs: positiveDuration(
        shard.result?.wallMs ?? shard.wallMs,
        `Shard ${id} duration`
      ),
      fingerprint: assignment.scheduled.fingerprint,
      status: 'passed',
      testId: id,
    });
    groups.set(key, group);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([, group]) =>
      createTimingObservation({
        schema: 'seerrng-distributed-adaptive-observation/v2',
        source,
        scope: group.scope,
        valid: true,
        complete: true,
        status: 'passed',
        benchmark: group.benchmark,
        inventory: group.inventory,
        results: group.results,
      })
    );
}

function createFailure(error, runId) {
  return {
    schema: 'seerrng-distributed-linux-production-failure/v1',
    runId,
    status: 'failed',
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
  };
}

function assertGreenResult(result, context) {
  if (result?.ok !== true || result.status !== 'passed')
    throw new Error('Distributed four-stage validation did not pass');
  const pending = requiredPendingMetadata(context, result);
  if (pending.length)
    throw new Error('Distributed validation retains required pending metadata');
}

/**
 * Run one fresh, contained four-stage distributed validation lifecycle. The
 * independent reconciler is required and receives only durable evidence paths.
 */
export async function executeDistributedLinuxProductionRun(
  optionsValue,
  dependencyOverrides = {}
) {
  const options = normalizeOptions(optionsValue);
  const deps = dependencies(dependencyOverrides);
  createFreshEvidenceDirectory(options.evidenceDirectory);
  const paths = evidencePaths(options.evidenceDirectory);
  let context = null;
  let cleanupAttempted = false;

  const cleanup = async (error) => {
    if (!context || cleanupAttempted) return;
    cleanupAttempted = true;
    await context.cleanup(error);
  };

  try {
    const hostPreparation = verifyHostPreparation(options, deps);
    const hostPreparationReceipt = writeJson(
      deps,
      paths.hostPreparationReceipt,
      hostPreparation
    );
    const durableHostPreparation = readJson(
      deps,
      paths.hostPreparationReceipt,
      'Host-preparation receipt'
    );
    if (
      sha256(durableHostPreparation.bytes) !== hostPreparationReceipt.sha256 ||
      !isDeepStrictEqual(durableHostPreparation.value, hostPreparation)
    )
      throw new Error('Host-preparation receipt failed readback');
    const active = await deps.resolveActiveConfig(
      options.activeConfigMarkerPath,
      { expectedRole: 'controller' }
    );
    const application = resolveApplication(
      active,
      options.applicationEntryId,
      deps.createApplicationListing
    );
    const sourceProfile = await deps.readTimingProfile(
      options.timingProfilePath
    );
    const sourceProfileSha256 = canonicalJsonSha256(sourceProfile);

    context = await deps.createNativeContext(options.sourceRoot, {
      ...options.nativeContextOptions,
      runId: options.runId,
      signal: options.signal,
      ...Object.fromEntries(
        NATIVE_CONTAINMENT_KEYS.map((name) => [name, options.containment[name]])
      ),
    });
    if (typeof context?.cleanup !== 'function')
      throw new Error('Native context must provide cleanup');
    if (
      !Array.isArray(context.report?.blockedRequired) ||
      context.report.blockedRequired.length !== 0
    )
      throw new Error('Native context retains blocked required prerequisites');
    if (typeof context.describeNativeProcessReceipts !== 'function')
      throw new Error('Native context must expose its process receipt ledger');
    const runExpectations = createRunExpectations(
      context,
      options,
      active.config
    );
    const runExpectationsReceipt = writeJson(
      deps,
      paths.runExpectations,
      runExpectations
    );

    const result = await deps.executeStagedValidation(
      context,
      {
        application: {
          runtimeApplicationKey: options.runtimeApplicationKey,
          supportedApplication: application,
        },
        controller: {
          config: active.config,
          policy: options.timingPolicy,
          runId: options.runId,
          timingProfile: sourceProfile,
        },
      },
      { withDistributedNetwork: options.containment.withDistributedNetwork }
    );

    const repositoryEvidence = repositoryEvidenceFromResult(result);
    const timings = timingEvidence(result, repositoryEvidence, options.runId);
    const resultReceipt = writeJson(deps, paths.result, result);
    const timingsReceipt = writeJson(deps, paths.timings, timings);
    const ledgerCollection = copyProcessLedger(context, deps, paths);
    assertGreenResult(result, context);

    await cleanup(null);

    const reconciliation = await deps.reconcileEvidence({
      evidenceDirectory: options.evidenceDirectory,
      files: Object.freeze({
        processLedger: paths.processLedger,
        processLedgerSummary: paths.processLedgerSummary,
        processStreams: paths.processStreams,
        result: paths.result,
        runExpectations: paths.runExpectations,
        timings: paths.timings,
      }),
      expected: Object.freeze({
        activeConfigPath: active.configPath,
        applicationEntryId: application.entryId,
        profileSha256: sourceProfileSha256,
        runExpectationsSha256: runExpectationsReceipt.sha256,
        runId: options.runId,
        runtimeApplicationKey: options.runtimeApplicationKey,
      }),
    });
    if (reconciliation?.ok !== true || reconciliation.status !== 'passed')
      throw new Error(
        'Independent durable-evidence reconciliation did not pass'
      );
    plainObject(
      reconciliation.repositoryEvidence,
      'independently reconciled repository evidence'
    );
    const reconciliationReceipt = writeJson(
      deps,
      paths.reconciliation,
      reconciliation
    );
    const durableReconciliation = readJson(
      deps,
      paths.reconciliation,
      'Independent reconciliation receipt'
    );
    if (
      sha256(durableReconciliation.bytes) !== reconciliationReceipt.sha256 ||
      canonicalJsonSha256(durableReconciliation.value) !==
        canonicalJsonSha256(reconciliation)
    )
      throw new Error('Independent reconciliation receipt failed readback');

    const observations = deriveTimingObservations({
      application,
      activeConfig: active.config,
      createTimingObservation: deps.createTimingObservation,
      reconciliation: durableReconciliation.value,
      result,
      runAttempt: options.runAttempt,
      runId: options.runId,
      runtimeApplicationKey: options.runtimeApplicationKey,
      sourceProfile,
      timingPolicy: options.timingPolicy,
    });
    if (observations.length === 0)
      throw new Error('Reconciled run produced no timing observations');
    const observationsReceipt = writeJson(deps, paths.timingObservations, {
      schema: 'seerrng-distributed-linux-timing-observations/v1',
      runId: options.runId,
      observations,
    });
    const expectations = observations.map((observation) => ({
      expectedObservationSha256: observation.observationSha256,
    }));
    const timingUpdate = deps.updateTimingProfileBatch(
      sourceProfile,
      observations,
      expectations,
      options.timingPolicy
    );
    if (
      timingUpdate?.accepted !== true ||
      timingUpdate.observationCount !== observations.length
    )
      throw new Error(
        `Adaptive timing profile batch was not accepted: ${timingUpdate?.reason ?? 'unknown'}`
      );
    const updatedProfileSha256 = canonicalJsonSha256(timingUpdate.profile);
    await deps.persistTimingProfile(
      options.timingProfilePath,
      timingUpdate.profile
    );
    const persistedProfile = await deps.readTimingProfile(
      options.timingProfilePath
    );
    if (canonicalJsonSha256(persistedProfile) !== updatedProfileSha256)
      throw new Error('Persisted adaptive timing profile failed readback');
    const timingProfileFileSha256 = sha256(
      deps.readEvidenceFile(options.timingProfilePath)
    );
    const timingProfileUpdateReceipt = writeJson(
      deps,
      paths.timingProfileUpdate,
      {
        schema: 'seerrng-distributed-linux-timing-profile-update/v1',
        runId: options.runId,
        accepted: true,
        observationCount: observations.length,
        updatedTests: timingUpdate.updatedTests,
        sourceProfileSha256,
        updatedProfileSha256,
        profilePath: options.timingProfilePath,
      }
    );

    const marker = {
      schema: 'seerrng-distributed-linux-contained-run-success/v2',
      runId: options.runId,
      status: 'passed',
      ok: true,
      resultSha256: resultReceipt.sha256,
      timingsSha256: timingsReceipt.sha256,
      processLedgerSha256: ledgerCollection.ledgerReceipt.sha256,
      processLedgerSummarySha256: ledgerCollection.receipt.sha256,
      processStreamsSha256: ledgerCollection.streamReceipt.sha256,
      runExpectationsSha256: runExpectationsReceipt.sha256,
      hostPreparationReceiptSha256: hostPreparationReceipt.sha256,
      reconciliationSha256: reconciliationReceipt.sha256,
      observationsSha256: observationsReceipt.sha256,
      timingProfileUpdateSha256: timingProfileUpdateReceipt.sha256,
      timingProfileFileSha256,
      updatedProfileSha256,
      resultReuse: false,
    };
    writeJson(deps, paths.containedRunVerification, marker);

    return Object.freeze({
      activeConfigPath: active.configPath,
      application: Object.freeze(application),
      evidenceDirectory: options.evidenceDirectory,
      files: Object.freeze({
        containedRunVerification: paths.containedRunVerification,
        hostPreparationReceipt: paths.hostPreparationReceipt,
        processLedger: paths.processLedger,
        processLedgerSummary: paths.processLedgerSummary,
        processStreams: paths.processStreams,
        runExpectations: paths.runExpectations,
        reconciliation: paths.reconciliation,
        result: paths.result,
        timingObservations: paths.timingObservations,
        timingProfile: options.timingProfilePath,
        timingProfileUpdate: paths.timingProfileUpdate,
        timings: paths.timings,
      }),
      ok: true,
      runId: options.runId,
      status: 'passed',
      timingUpdate: Object.freeze({
        observationCount: observations.length,
        sourceProfileSha256,
        updatedProfileSha256,
        updatedTests: timingUpdate.updatedTests,
      }),
    });
  } catch (caught) {
    let error = caught instanceof Error ? caught : new Error(String(caught));
    error.preserveTemporary = true;
    if (!cleanupAttempted && context) {
      try {
        await cleanup(error);
      } catch (cleanupError) {
        error = new AggregateError(
          [error, cleanupError],
          'Production validation and native cleanup both failed'
        );
      }
    }
    try {
      writeJson(deps, paths.failure, createFailure(error, options.runId));
    } catch (evidenceError) {
      error = new AggregateError(
        [error, evidenceError],
        'Production validation failed and failure evidence could not be saved'
      );
    }
    throw error;
  }
}
