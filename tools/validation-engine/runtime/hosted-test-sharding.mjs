// Copyright (c) snapetech and SeerrNG contributors.
// Deterministic hosted-case scheduling over the sealed test inventory.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { QUIET_TEST_FILES } from './vitest-binding.mjs';

const SCHEDULING_SCHEMA = 'seerrng-hosted-test-scheduling/v1';
const TIMING_PROFILE_SCHEMA = 'seerrng-hosted-test-timing-profile/v1';
const TIMING_PROFILE_PATH =
  'tools/validation-engine/hosted-test-timing-profile.json';
const ASSIGNMENT_ALGORITHM = 'deterministic-longest-processing-time/v1';
const MAXIMUM_CONCURRENT_CASES = 20;
const FIXED_CASES = 10;
const UNIT_SHARD_COUNT = 4;
const CYPRESS_SHARD_COUNT = 6;
const HASH40 = /^[a-f0-9]{40}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stableJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort(compareText);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error('Hosted scheduling values must be JSON data');
  return encoded;
};

function shardCases(count) {
  const width = Math.max(2, String(count).length);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const ordinal = String(index + 1).padStart(width, '0');
      return `shard-${ordinal}-of-${String(count).padStart(width, '0')}`;
    })
  );
}

export const HOSTED_UNIT_CASES = shardCases(UNIT_SHARD_COUNT);
export const HOSTED_CYPRESS_CASES = shardCases(CYPRESS_SHARD_COUNT);

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
  if (
    stableJson(Object.keys(value).sort(compareText)) !==
    stableJson([...expected].sort(compareText))
  )
    throw new Error(`${label} fields are not canonical`);
  return value;
}

function normalizedPath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Paths are serialized into a plan.
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function checkedSum(values, label) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total))
    throw new Error(`${label} exceeds safe range`);
  return total;
}

function timingProfile(value) {
  exactKeys(
    value,
    ['lanes', 'model', 'schema', 'source'],
    'hosted timing profile'
  );
  if (value.schema !== TIMING_PROFILE_SCHEMA)
    throw new Error('Unsupported hosted timing profile schema');
  exactKeys(
    value.source,
    [
      'capturedOn',
      'cypressJobId',
      'headSha',
      'repository',
      'unitJobId',
      'workflowRunId',
    ],
    'hosted timing profile source'
  );
  if (
    !/^[^/\s]+\/[^/\s]+$/.test(value.source.repository ?? '') ||
    !HASH40.test(value.source.headSha ?? '') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.source.capturedOn ?? '') ||
    !POSITIVE_DECIMAL.test(value.source.workflowRunId ?? '') ||
    !POSITIVE_DECIMAL.test(value.source.unitJobId ?? '') ||
    !POSITIVE_DECIMAL.test(value.source.cypressJobId ?? '')
  )
    throw new Error('Hosted timing profile source is invalid');
  exactKeys(
    value.model,
    [
      'cypressUnknownMethod',
      'githubLogicalCpusPerRunner',
      'nativeNodeFullWallMs',
      'nativeNodeMethod',
      'vitestOverheadMethod',
      'vitestUnknownMethod',
    ],
    'hosted timing profile model'
  );
  positiveInteger(
    value.model.githubLogicalCpusPerRunner,
    'hosted baseline logical CPUs'
  );
  positiveInteger(
    value.model.nativeNodeFullWallMs,
    'hosted native Node full wall time'
  );
  const expectedMethods = {
    cypressUnknownMethod: 'maximum-observed-spec-wall-duration',
    nativeNodeMethod: 'source-bytes-proportional-to-full-wall-time',
    vitestOverheadMethod: 'aggregate-non-test-duration-divided-by-file-count',
    vitestUnknownMethod: 'p95-observed-file-duration',
  };
  for (const [name, expected] of Object.entries(expectedMethods))
    if (value.model[name] !== expected)
      throw new Error(`Hosted timing profile ${name} is invalid`);
  exactKeys(value.lanes, ['cypress', 'vitest'], 'hosted timing profile lanes');
  for (const laneId of ['vitest', 'cypress']) {
    const lane = exactKeys(
      value.lanes[laneId],
      ['durationsMs', 'perFileOverheadMs', 'unknownFileDurationMs'],
      `hosted ${laneId} timing profile`
    );
    nonnegativeInteger(lane.perFileOverheadMs, `${laneId} per-file overhead`);
    positiveInteger(
      lane.unknownFileDurationMs,
      `${laneId} unknown-file duration`
    );
    plainObject(lane.durationsMs, `${laneId} file durations`);
    if (!Object.keys(lane.durationsMs).length)
      throw new Error(`Hosted ${laneId} timing profile is empty`);
    for (const [file, duration] of Object.entries(lane.durationsMs)) {
      normalizedPath(file, `${laneId} timing path`);
      nonnegativeInteger(duration, `${laneId} duration for ${file}`);
    }
  }
  return value;
}

let timingProfileCache;

function hostedTimingProfile() {
  if (timingProfileCache) return timingProfileCache;
  const bytes = readFileSync(
    new URL('../hosted-test-timing-profile.json', import.meta.url)
  );
  const profile = timingProfile(JSON.parse(bytes.toString('utf8')));
  timingProfileCache = Object.freeze({
    profile,
    sha256: sha256(bytes),
  });
  return timingProfileCache;
}

export function createHostedSchedulingPolicy() {
  const timing = hostedTimingProfile();
  return {
    schema: SCHEDULING_SCHEMA,
    maximumConcurrentCases: MAXIMUM_CONCURRENT_CASES,
    totalCases: MAXIMUM_CONCURRENT_CASES,
    fixedCases: FIXED_CASES,
    assignmentAlgorithm: ASSIGNMENT_ALGORITHM,
    tieBreakers: ['file-path-ascending', 'shard-index-ascending'],
    allocations: [
      {
        unitId: 'ci-unit-test',
        caseIds: [...HOSTED_UNIT_CASES],
      },
      {
        unitId: 'cypress-run',
        caseIds: [...HOSTED_CYPRESS_CASES],
      },
    ],
    timingProfile: {
      path: TIMING_PROFILE_PATH,
      schema: timing.profile.schema,
      sha256: timing.sha256,
      source: structuredClone(timing.profile.source),
    },
  };
}

function laneById(testInventory, laneId) {
  const lane = testInventory.lanes.find((candidate) => candidate.id === laneId);
  if (!lane) throw new Error(`Missing hosted test lane: ${laneId}`);
  return lane;
}

function entryBytesByFile(testInventory) {
  return new Map(
    testInventory.entries.map((entry) => [entry.file, entry.bytes])
  );
}

function timingWeight(laneId, file) {
  const profile = hostedTimingProfile().profile.lanes[laneId];
  const duration = Object.hasOwn(profile.durationsMs, file)
    ? profile.durationsMs[file]
    : profile.unknownFileDurationMs;
  return checkedSum(
    [duration, profile.perFileOverheadMs],
    `${laneId} estimated file weight`
  );
}

function lptAssignments(
  files,
  cases,
  weightForFile,
  {
    schedulingWeight = (_file, weight) => weight,
    finalWeight = (weight) => weight,
  } = {}
) {
  if (files.length < cases.length)
    throw new Error('Hosted shard count exceeds its test-file count');
  const work = files
    .map((file) => ({
      file,
      weight: nonnegativeInteger(
        schedulingWeight(file, weightForFile(file)),
        `hosted estimated weight for ${file}`
      ),
    }))
    .toSorted(
      (left, right) =>
        right.weight - left.weight || compareText(left.file, right.file)
    );
  const shards = cases.map((caseId, index) => ({
    caseId,
    index,
    estimatedWeight: 0,
    files: [],
  }));
  for (const item of work) {
    const shard = shards.reduce((selected, candidate) => {
      if (candidate.estimatedWeight < selected.estimatedWeight)
        return candidate;
      if (
        candidate.estimatedWeight === selected.estimatedWeight &&
        candidate.index < selected.index
      )
        return candidate;
      return selected;
    });
    shard.files.push(item.file);
    shard.estimatedWeight = checkedSum(
      [shard.estimatedWeight, item.weight],
      `hosted shard weight for ${shard.caseId}`
    );
  }
  return shards.map(({ caseId, estimatedWeight, files: shardFiles }) => ({
    caseId,
    estimatedWeight: positiveInteger(
      finalWeight(estimatedWeight),
      `hosted final estimated weight for ${caseId}`
    ),
    files: shardFiles.toSorted(compareText),
  }));
}

function shardedLane(
  testInventory,
  laneId,
  cases,
  strategy,
  weightForFile,
  options
) {
  const lane = laneById(testInventory, laneId);
  return lptAssignments(lane.files, cases, weightForFile, options).map(
    ({ caseId, estimatedWeight, files }) => ({
      caseId,
      lane: {
        id: laneId,
        mode: 'shard',
        strategy,
        weightUnit: 'estimated-wall-ms',
        estimatedWeight,
        filesSha256: sha256(stableJson(files)),
        files,
      },
    })
  );
}

function fullLane(testInventory, laneId) {
  const lane = laneById(testInventory, laneId);
  const bytes = entryBytesByFile(testInventory);
  return {
    id: laneId,
    mode: 'full',
    strategy: 'inventory-bytes-full/v1',
    weightUnit: 'source-bytes',
    estimatedWeight: checkedSum(
      lane.files.map((file) => {
        if (!bytes.has(file))
          throw new Error(`Missing inventory weight for ${file}`);
        return bytes.get(file);
      }),
      `${laneId} full-lane weight`
    ),
    filesSha256: sha256(stableJson(lane.files)),
    files: [...lane.files],
  };
}

function shardedCaseAssignments(unit, testInventory) {
  const lanes = new Map();
  if (unit.id === 'ci-unit-test') {
    if (
      stableJson(unit.cases) !== stableJson(HOSTED_UNIT_CASES) ||
      stableJson(unit.testLanes) !== stableJson(['vitest', 'node-test-mjs'])
    )
      throw new Error('Hosted unit-test shard contract drift');
    const bytes = entryBytesByFile(testInventory);
    const model = hostedTimingProfile().profile.model;
    const workers = model.githubLogicalCpusPerRunner;
    const quiet = new Set(QUIET_TEST_FILES);
    lanes.set(
      'vitest',
      shardedLane(
        testInventory,
        'vitest',
        unit.cases,
        'timing-profile-topology-lpt/v1',
        (file) => timingWeight('vitest', file),
        {
          schedulingWeight: (file, weight) =>
            quiet.has(file) ? weight * workers : weight,
          finalWeight: (weight) => Math.ceil(weight / workers),
        }
      )
    );
    const nativeLane = laneById(testInventory, 'node-test-mjs');
    const nativeBytes = checkedSum(
      nativeLane.files.map((file) => bytes.get(file)),
      'native Node aggregate source bytes'
    );
    const nativeWorkerMs =
      model.nativeNodeFullWallMs * model.githubLogicalCpusPerRunner;
    lanes.set(
      'node-test-mjs',
      shardedLane(
        testInventory,
        'node-test-mjs',
        unit.cases,
        'inventory-bytes-proportional-wall-lpt/v1',
        (file) => {
          if (!bytes.has(file))
            throw new Error(`Missing inventory weight for ${file}`);
          return Math.max(
            1,
            Math.round((bytes.get(file) * nativeWorkerMs) / nativeBytes)
          );
        },
        { finalWeight: (weight) => Math.ceil(weight / workers) }
      )
    );
  } else if (unit.id === 'cypress-run') {
    if (
      stableJson(unit.cases) !== stableJson(HOSTED_CYPRESS_CASES) ||
      stableJson(unit.testLanes) !== stableJson(['cypress'])
    )
      throw new Error('Hosted Cypress shard contract drift');
    lanes.set(
      'cypress',
      shardedLane(
        testInventory,
        'cypress',
        unit.cases,
        'timing-profile-lpt/v1',
        (file) => timingWeight('cypress', file)
      )
    );
  } else return null;

  return unit.cases.map((caseId, index) => {
    const caseLanes = unit.testLanes.map((laneId) => {
      const assignment = lanes.get(laneId)?.[index];
      if (!assignment || assignment.caseId !== caseId)
        throw new Error(
          `Missing hosted shard assignment: ${unit.id}/${caseId}`
        );
      return assignment.lane;
    });
    return {
      caseId,
      mode: 'shard',
      weightUnit: 'estimated-wall-ms',
      estimatedWeight: checkedSum(
        caseLanes.map((lane) => lane.estimatedWeight),
        `${unit.id}/${caseId} estimated weight`
      ),
      lanes: caseLanes,
    };
  });
}

export function createHostedCaseAssignments(unit, testInventory) {
  const sharded = shardedCaseAssignments(unit, testInventory);
  if (sharded) return sharded;
  return unit.cases.map((caseId) => {
    const lanes = unit.testLanes.map((laneId) =>
      fullLane(testInventory, laneId)
    );
    return {
      caseId,
      mode: 'full',
      weightUnit: lanes.length ? lanes[0].weightUnit : 'none',
      estimatedWeight: checkedSum(
        lanes.map((lane) => lane.estimatedWeight),
        `${unit.id}/${caseId} estimated weight`
      ),
      lanes,
    };
  });
}

function exactLaneClosure(unit, testInventory) {
  for (const laneId of unit.testLanes) {
    const expected = laneById(testInventory, laneId).files;
    const assignments = unit.caseAssignments.map((entry) => {
      const lane = entry.lanes.find((candidate) => candidate.id === laneId);
      if (!lane)
        throw new Error(`Missing hosted case lane: ${unit.id}/${laneId}`);
      if (!lane.files.length)
        throw new Error(`Empty hosted case lane: ${unit.id}/${laneId}`);
      return lane;
    });
    const actual = assignments.flatMap((lane) => lane.files);
    for (const lane of assignments)
      if (
        !HASH64.test(lane.filesSha256 ?? '') ||
        lane.filesSha256 !== sha256(stableJson(lane.files))
      )
        throw new Error(`Hosted case lane file hash mismatch: ${laneId}`);
    if (
      actual.length !== expected.length ||
      new Set(actual).size !== expected.length ||
      stableJson(actual.toSorted(compareText)) !== stableJson(expected)
    )
      throw new Error(
        `Hosted case lane does not close exactly once: ${laneId}`
      );
  }
}

export function assertHostedSchedulingPlan({
  units,
  testInventory,
  scheduling,
}) {
  if (
    stableJson(scheduling) !== stableJson(createHostedSchedulingPolicy()) ||
    scheduling.totalCases !== MAXIMUM_CONCURRENT_CASES ||
    scheduling.maximumConcurrentCases !== MAXIMUM_CONCURRENT_CASES ||
    scheduling.fixedCases !== FIXED_CASES ||
    !HASH64.test(scheduling.timingProfile?.sha256 ?? '')
  )
    throw new Error(
      'Hosted scheduling policy does not match the sealed profile'
    );
  const unitTests = units.find((entry) => entry.id === 'ci-unit-test');
  const cypress = units.find((entry) => entry.id === 'cypress-run');
  if (
    !unitTests ||
    !cypress ||
    stableJson(unitTests.cases) !== stableJson(HOSTED_UNIT_CASES) ||
    stableJson(cypress.cases) !== stableJson(HOSTED_CYPRESS_CASES)
  )
    throw new Error('Hosted shard case IDs do not match the allocation');
  const totalCases = checkedSum(
    units.map((entry) => entry.cases.length),
    'hosted aggregate case count'
  );
  const fixedCases = totalCases - unitTests.cases.length - cypress.cases.length;
  if (totalCases !== MAXIMUM_CONCURRENT_CASES || fixedCases !== FIXED_CASES)
    throw new Error('Hosted aggregate case count must be exactly 20');

  for (const unit of units) {
    if (
      !Array.isArray(unit.caseAssignments) ||
      unit.caseAssignments.length !== unit.cases.length ||
      stableJson(unit.caseAssignments.map((entry) => entry.caseId)) !==
        stableJson(unit.cases)
    )
      throw new Error(`Hosted case assignments do not match ${unit.id}`);
    for (const assignment of unit.caseAssignments) {
      if (
        !['full', 'shard'].includes(assignment.mode) ||
        !['estimated-wall-ms', 'none', 'source-bytes'].includes(
          assignment.weightUnit
        ) ||
        !Number.isSafeInteger(assignment.estimatedWeight) ||
        assignment.estimatedWeight < 0 ||
        !Array.isArray(assignment.lanes) ||
        stableJson(assignment.lanes.map((lane) => lane.id)) !==
          stableJson(unit.testLanes) ||
        assignment.lanes.some(
          (lane) => lane.weightUnit !== assignment.weightUnit
        ) ||
        assignment.estimatedWeight !==
          checkedSum(
            assignment.lanes.map((lane) => lane.estimatedWeight),
            `${unit.id}/${assignment.caseId} asserted weight`
          )
      )
        throw new Error(`Invalid hosted case assignment: ${unit.id}`);
    }
    if (!unit.testLanes.length) {
      if (
        unit.caseAssignments.some(
          (entry) =>
            entry.lanes.length ||
            entry.weightUnit !== 'none' ||
            entry.estimatedWeight !== 0
        )
      )
        throw new Error(`Unexpected hosted case lane: ${unit.id}`);
      continue;
    }
    exactLaneClosure(unit, testInventory);
  }
  return scheduling;
}
