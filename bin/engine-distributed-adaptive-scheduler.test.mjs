import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  assessDistributedNodeCapacity,
  createAdaptiveTimingObservation,
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
  distributedAdaptivePolicySha256,
  estimateAdaptiveTestWork,
  MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES,
  MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS,
  MAX_DISTRIBUTED_NODE_THREADS,
  updateAdaptiveTimingProfile,
  updateAdaptiveTimingProfileBatch,
  verifyAdaptiveTimingObservation,
  verifyDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const repositoryIdentitySha256 = '9'.repeat(64);
const alternateRepositoryIdentitySha256 = '8'.repeat(64);

const scope = (
  environment,
  nodeId,
  {
    applicationId = 'seerrng',
    laneId = 'unit',
    adapterId = 'native-generic',
    repositoryIdentity = repositoryIdentitySha256,
    selectedN = 1,
  } = {}
) => ({
  applicationId,
  laneId,
  adapterId,
  repositoryIdentitySha256: repositoryIdentity,
  environment,
  nodeId,
  selectedN,
});

const timingTestEntry = (id, fingerprint = `${id}-v1`) => ({
  id,
  fingerprint,
});

const testEntry = (
  id,
  fingerprint = `${id}-v1`,
  {
    applicationId = 'seerrng',
    laneId = 'unit',
    adapterId = 'native-generic',
    repositoryIdentity = repositoryIdentitySha256,
    dependencies = [],
  } = {}
) => ({
  id,
  fingerprint,
  applicationId,
  laneId,
  adapterId,
  repositoryIdentitySha256: repositoryIdentity,
  dependencies,
});

const resultEntry = (id, durationMs, fingerprint = `${id}-v1`) => ({
  testId: id,
  fingerprint,
  durationMs,
  status: 'passed',
});

const observation = ({
  profile,
  selectedScope,
  runId,
  performanceScorePermille,
  results,
  inventory = results.map((result) => ({
    id: result.testId,
    fingerprint: result.fingerprint,
  })),
  candidateSha256 = 'a'.repeat(64),
  revision = 'candidate-revision-1',
  valid = true,
  complete = true,
  status = 'passed',
  benchmarkValid = true,
  runAttempt = 1,
  schema = 'seerrng-distributed-adaptive-observation/v2',
  policy = {},
  source = {},
}) =>
  createAdaptiveTimingObservation({
    schema,
    source: {
      applicationIsolationKeySha256: 'b'.repeat(64),
      brokerReconciliationInputSha256: 'c'.repeat(64),
      candidateSha256,
      executionBridgeSha256: 'd'.repeat(64),
      executionId: runId,
      policySha256: distributedAdaptivePolicySha256(policy),
      profileSha256: canonicalJsonSha256(profile),
      revision,
      runAttempt,
      scheduleTestInventorySha256: '2'.repeat(64),
      scheduleSha256: 'e'.repeat(64),
      submissionSha256: 'f'.repeat(64),
      terminalReconciliationSha256: '1'.repeat(64),
      ...source,
    },
    scope: selectedScope,
    valid,
    complete,
    status,
    benchmark: {
      valid: benchmarkValid,
      performanceScorePermille: benchmarkValid
        ? performanceScorePermille
        : null,
    },
    inventory,
    results,
  });

const observationExpectations = (sealedObservation) => ({
  expectedObservationSha256: sealedObservation.observationSha256,
});

const applyObservation = (profile, options, policy = {}) => {
  const sealedObservation = observation({ ...options, profile, policy });
  return updateAdaptiveTimingProfile(
    profile,
    sealedObservation,
    observationExpectations(sealedObservation),
    policy
  );
};

const node = ({
  id,
  selectedScope,
  threads,
  performanceScorePermille,
  concurrency = { mode: 'auto' },
  currentLoadPermille = 0,
  memory = null,
  localInteractiveReserveThreads,
  runsOnControllerHost = false,
  adapterIds = ['native-generic'],
}) => ({
  id,
  scope: { ...selectedScope, nodeId: id },
  adapterIds,
  effectiveLogicalThreads: threads,
  concurrency,
  currentLoadPermille,
  memory,
  localInteractiveReserveThreads,
  runsOnControllerHost,
  benchmark: {
    valid: true,
    performanceScorePermille,
  },
});

const scheduleExpectations = (schedule) => ({
  expectedApplicationId: schedule.applicationId,
  expectedProfileSha256: schedule.profileSha256,
  expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
  expectedScheduleSha256: schedule.scheduleSha256,
  expectedTestInventorySha256: schedule.testInventorySha256,
});

const scheduledTest = (schedule, testId) =>
  schedule.threadSlots
    .flatMap((threadSlot) => threadSlot.tests)
    .find((entry) => entry.id === testId);

const rehashSchedule = (schedule, mutate) => {
  const changed = structuredClone(schedule);
  mutate(changed);
  const unsigned = { ...changed };
  delete unsigned.scheduleSha256;
  changed.scheduleSha256 = canonicalJsonSha256(unsigned);
  return changed;
};

const rehashObservation = (sealedObservation, mutate) => {
  const changed = structuredClone(sealedObservation);
  mutate(changed);
  const unsigned = { ...changed };
  delete unsigned.observationSha256;
  changed.observationSha256 = canonicalJsonSha256(unsigned);
  return changed;
};

const refreshScheduleInventoryHash = (schedule) => {
  schedule.testInventorySha256 = canonicalJsonSha256(
    schedule.threadSlots
      .flatMap((threadSlot) => threadSlot.tests)
      .map((entry) => ({
        id: entry.id,
        fingerprint: entry.fingerprint,
        applicationId: schedule.applicationId,
        laneId: entry.laneId,
        adapterId: entry.adapterId,
        repositoryIdentitySha256: schedule.repositoryIdentitySha256,
        dependencies: entry.dependencies,
      }))
      .toSorted((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      )
  );
};

const continuousDependencyFixture = () => {
  const selectedScope = scope('linux-x64', 'node-a', {
    selectedN: 2,
  });
  const results = [
    resultEntry('unit/long.test.ts', 100),
    resultEntry('unit/short.test.ts', 10),
    resultEntry('unit/followup.test.ts', 10),
    resultEntry('unit/final.test.ts', 10),
  ];
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'continuous-green',
    performanceScorePermille: 100,
    results,
  }).profile;
  const tests = [
    testEntry('unit/final.test.ts', 'unit/final.test.ts-v1', {
      dependencies: ['unit/followup.test.ts'],
    }),
    testEntry('unit/followup.test.ts', 'unit/followup.test.ts-v1', {
      dependencies: ['unit/short.test.ts'],
    }),
    testEntry('unit/long.test.ts'),
    testEntry('unit/short.test.ts'),
  ];
  const nodes = [
    node({
      id: 'node-a',
      selectedScope,
      threads: 4,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 2 },
    }),
  ];
  return {
    profile,
    tests,
    nodes,
    schedule: createDistributedAdaptiveSchedule({ tests, nodes, profile }),
  };
};

test('timing observations are canonical, sealed, bounded, and deeply frozen', () => {
  const profile = createAdaptiveTimingProfile();
  const selectedScope = scope('linux-x64', 'node-standard');
  const results = [
    resultEntry('unit/b.test.ts', 20),
    resultEntry('unit/a.test.ts', 10),
  ];
  const sealed = observation({
    profile,
    selectedScope,
    runId: 'execution-1',
    performanceScorePermille: 100,
    results,
    inventory: [...results].reverse().map((result) => ({
      id: result.testId,
      fingerprint: result.fingerprint,
    })),
  });
  const reordered = observation({
    profile,
    selectedScope,
    runId: 'execution-1',
    performanceScorePermille: 100,
    results: [...results].reverse(),
  });
  assert.deepEqual(reordered, sealed);
  assert.deepEqual(
    sealed.inventory.map((entry) => entry.id),
    ['unit/a.test.ts', 'unit/b.test.ts']
  );
  assert.deepEqual(
    sealed.results.map((entry) => entry.testId),
    ['unit/a.test.ts', 'unit/b.test.ts']
  );
  assert.deepEqual(
    verifyAdaptiveTimingObservation(sealed, observationExpectations(sealed)),
    sealed
  );
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.source), true);
  assert.equal(Object.isFrozen(sealed.scope), true);
  assert.equal(Object.isFrozen(sealed.inventory), true);
  assert.equal(Object.isFrozen(sealed.inventory[0]), true);
  assert.equal(Object.isFrozen(sealed.results), true);
  assert.equal(Object.isFrozen(sealed.results[0]), true);
  assert.deepEqual(Object.keys(sealed.source).toSorted(), [
    'applicationIsolationKeySha256',
    'brokerReconciliationInputSha256',
    'candidateSha256',
    'executionBridgeSha256',
    'executionId',
    'policySha256',
    'profileSha256',
    'revision',
    'runAttempt',
    'scheduleSha256',
    'scheduleTestInventorySha256',
    'submissionSha256',
    'terminalReconciliationSha256',
  ]);
  assert.equal(
    sealed.observedInventorySha256,
    canonicalJsonSha256({
      schema: 'seerrng-distributed-adaptive-observed-inventory/v2',
      scope: sealed.scope,
      inventory: sealed.inventory,
    })
  );
  assert.notEqual(
    sealed.source.scheduleTestInventorySha256,
    sealed.observedInventorySha256
  );

  const observationInput = structuredClone(sealed);
  delete observationInput.observationSha256;
  delete observationInput.observedInventorySha256;
  assert.throws(
    () =>
      createAdaptiveTimingObservation({
        ...observationInput,
        unexpected: true,
      }),
    /fields are not canonical/
  );
  assert.throws(
    () =>
      observation({
        profile,
        selectedScope,
        runId: 'too-many-tests',
        performanceScorePermille: 100,
        inventory: Array.from(
          { length: MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS + 1 },
          () => timingTestEntry('unit/too-many.test.ts')
        ),
        results: [],
      }),
    /inventory limit/
  );
  assert.throws(
    () =>
      observation({
        profile,
        selectedScope,
        runId: 'too-many-bytes',
        performanceScorePermille: 100,
        results: [
          resultEntry(
            'unit/large.test.ts',
            1,
            'x'.repeat(MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES)
          ),
        ],
      }),
    /byte limit/
  );
});

test('timing observation updates reject hostile rehashes and source-profile drift', () => {
  const profile = createAdaptiveTimingProfile();
  const selectedScope = scope('linux-x64', 'node-standard');
  const sealed = observation({
    profile,
    selectedScope,
    runId: 'execution-trusted',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  const changedDuration = rehashObservation(sealed, (changed) => {
    changed.results[0].durationMs = 1;
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedDuration,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedBridge = rehashObservation(sealed, (changed) => {
    changed.source.executionBridgeSha256 = '3'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedBridge,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedScheduleInventory = rehashObservation(sealed, (changed) => {
    changed.source.scheduleTestInventorySha256 = '6'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedScheduleInventory,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedObservedInventory = rehashObservation(sealed, (changed) => {
    changed.observedInventorySha256 = '5'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedObservedInventory,
        observationExpectations(changedObservedInventory)
      ),
    /trusted hash/
  );
  const changedProfile = rehashObservation(sealed, (changed) => {
    changed.source.profileSha256 = '4'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedProfile,
        observationExpectations(changedProfile)
      ),
    /another source profile/
  );
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        sealed,
        observationExpectations(sealed),
        { rollingQuantilePermille: 900 }
      ),
    /another update policy/
  );
  assert.deepEqual(profile, createAdaptiveTimingProfile());
});

test('timing observation batches update multiple scopes from one source profile atomically', () => {
  const profile = createAdaptiveTimingProfile();
  const observations = [
    observation({
      profile,
      selectedScope: scope('linux-x64', 'node-a'),
      runId: 'batch-green',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 20)],
    }),
    observation({
      profile,
      selectedScope: scope('linux-x64', 'node-b'),
      runId: 'batch-green',
      performanceScorePermille: 100,
      results: [
        resultEntry('unit/a.test.ts', 30),
        resultEntry('unit/b.test.ts', 40),
      ],
    }),
  ];
  const receipt = updateAdaptiveTimingProfileBatch(
    profile,
    observations,
    observations.map(observationExpectations)
  );

  assert.deepEqual(profile, createAdaptiveTimingProfile());
  assert.deepEqual(
    {
      accepted: receipt.accepted,
      reason: receipt.reason,
      updatedTests: receipt.updatedTests,
      observationCount: receipt.observationCount,
    },
    {
      accepted: true,
      reason: 'accepted',
      updatedTests: 3,
      observationCount: 2,
    }
  );
  assert.deepEqual(
    receipt.profile.scopes.map((entry) => ({
      nodeId: entry.nodeId,
      runIds: entry.acceptedRunIds,
      estimates: entry.tests.map((timing) => [
        timing.testId,
        timing.estimateWorkUnits,
      ]),
    })),
    [
      {
        nodeId: 'node-a',
        runIds: ['batch-green'],
        estimates: [['unit/a.test.ts', 2_000]],
      },
      {
        nodeId: 'node-b',
        runIds: ['batch-green'],
        estimates: [
          ['unit/a.test.ts', 3_000],
          ['unit/b.test.ts', 4_000],
        ],
      },
    ]
  );
});

test('timing observation batches reject mismatches, duplicates, and failures without partial updates', () => {
  const profile = createAdaptiveTimingProfile();
  const nodeA = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-a'),
    runId: 'batch-atomic',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 20)],
  });
  const nodeB = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-b'),
    runId: 'batch-atomic',
    performanceScorePermille: 100,
    results: [resultEntry('unit/b.test.ts', 30)],
  });
  const mismatchedRun = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-b'),
    runId: 'another-run',
    performanceScorePermille: 100,
    results: [resultEntry('unit/b.test.ts', 30)],
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfileBatch(
        profile,
        [nodeA, mismatchedRun],
        [nodeA, mismatchedRun].map(observationExpectations)
      ),
    /mismatched run provenance/
  );

  const wrongProfile = rehashObservation(nodeB, (changed) => {
    changed.source.profileSha256 = '4'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfileBatch(
        profile,
        [nodeA, wrongProfile],
        [nodeA, wrongProfile].map(observationExpectations)
      ),
    /another source profile/
  );

  const duplicateScope = updateAdaptiveTimingProfileBatch(
    profile,
    [nodeA, nodeA],
    [nodeA, nodeA].map(observationExpectations)
  );
  assert.deepEqual(
    {
      accepted: duplicateScope.accepted,
      reason: duplicateScope.reason,
      updatedTests: duplicateScope.updatedTests,
      observationCount: duplicateScope.observationCount,
      profile: duplicateScope.profile,
    },
    {
      accepted: false,
      reason: 'duplicate-scope',
      updatedTests: 0,
      observationCount: 2,
      profile,
    }
  );

  const failedNodeB = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-b'),
    runId: 'batch-atomic',
    performanceScorePermille: 100,
    results: [resultEntry('unit/b.test.ts', 1)],
    status: 'failed',
  });
  const failed = updateAdaptiveTimingProfileBatch(
    profile,
    [nodeA, failedNodeB],
    [nodeA, failedNodeB].map(observationExpectations)
  );
  assert.equal(failed.accepted, false);
  assert.equal(failed.reason, 'unsuccessful-run');
  assert.equal(failed.updatedTests, 0);
  assert.equal(failed.observationCount, 2);
  assert.deepEqual(failed.profile, profile);

  const invalidNodeA = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-a'),
    runId: 'batch-atomic',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 1)],
    valid: false,
  });
  const forwardRejection = updateAdaptiveTimingProfileBatch(
    profile,
    [failedNodeB, invalidNodeA],
    [failedNodeB, invalidNodeA].map(observationExpectations)
  );
  const reverseRejection = updateAdaptiveTimingProfileBatch(
    profile,
    [invalidNodeA, failedNodeB],
    [invalidNodeA, failedNodeB].map(observationExpectations)
  );
  assert.equal(forwardRejection.reason, 'invalid-run');
  assert.equal(reverseRejection.reason, forwardRejection.reason);

  assert.throws(
    () =>
      updateAdaptiveTimingProfileBatch(
        profile,
        Array(MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS + 1).fill(nodeA),
        Array(MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS + 1).fill(
          observationExpectations(nodeA)
        )
      ),
    /batch exceeds its count limit/
  );

  const hostileNodeB = structuredClone(nodeB);
  hostileNodeB.results[0].durationMs = 1;
  assert.throws(
    () =>
      updateAdaptiveTimingProfileBatch(
        profile,
        [failedNodeB, hostileNodeB],
        [observationExpectations(failedNodeB), observationExpectations(nodeB)]
      ),
    /trusted hash/
  );

  const existingProfile = applyObservation(profile, {
    selectedScope: scope('linux-x64', 'node-a'),
    runId: 'already-accepted',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 50)],
  }).profile;
  const repeatedRun = [
    observation({
      profile: existingProfile,
      selectedScope: scope('linux-x64', 'node-a'),
      runId: 'already-accepted',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 1)],
    }),
    observation({
      profile: existingProfile,
      selectedScope: scope('linux-x64', 'node-b'),
      runId: 'already-accepted',
      performanceScorePermille: 100,
      results: [resultEntry('unit/b.test.ts', 1)],
    }),
  ];
  const duplicateObservation = updateAdaptiveTimingProfileBatch(
    existingProfile,
    repeatedRun,
    repeatedRun.map(observationExpectations)
  );
  assert.equal(duplicateObservation.accepted, false);
  assert.equal(duplicateObservation.reason, 'duplicate-observation');
  assert.equal(duplicateObservation.updatedTests, 0);
  assert.equal(duplicateObservation.observationCount, 2);
  assert.deepEqual(duplicateObservation.profile, existingProfile);
  assert.deepEqual(profile, createAdaptiveTimingProfile());
});

test('single timing observation updates retain their original receipt contract', () => {
  const profile = createAdaptiveTimingProfile();
  const sealed = observation({
    profile,
    selectedScope: scope('linux-x64', 'node-standard'),
    runId: 'single-regression',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 25)],
  });
  const receipt = updateAdaptiveTimingProfile(
    profile,
    sealed,
    observationExpectations(sealed)
  );

  assert.deepEqual(Object.keys(receipt).toSorted(), [
    'accepted',
    'profile',
    'reason',
    'updatedTests',
  ]);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.reason, 'accepted');
  assert.equal(receipt.updatedTests, 1);
  assert.equal(receipt.profile.scopes[0].tests[0].estimateWorkUnits, 2_500);
});

test('node admission applies configured threads, load, memory, and local reserve without hardware weighting', () => {
  const candidate = {
    ...node({
      id: 'developer-main',
      selectedScope: scope('windows-x64', 'desktop-fast'),
      threads: 16,
      performanceScorePermille: 200,
      concurrency: { mode: 'explicit', threads: 4 },
      runsOnControllerHost: true,
      currentLoadPermille: 250,
      memory: {
        availableBytes: 6_000,
        reserveBytes: 2_000,
        bytesPerThread: 1_000,
      },
      localInteractiveReserveThreads: 2,
    }),
    clockSpeedMhz: 9_999,
  };
  const admitted = assessDistributedNodeCapacity(candidate);
  assert.deepEqual(assessDistributedNodeCapacity(candidate), admitted);
  assert.equal(admitted.schema, 'seerrng-distributed-node-capacity/v3');
  assert.equal(admitted.concurrencyPolicy, 'explicit');
  assert.equal(admitted.configuredThreadBudget, 4);
  assert.equal(admitted.loadReservedThreads, 4);
  assert.equal(admitted.interactiveReservedThreads, 2);
  assert.equal(admitted.memoryLimitedThreads, 4);
  assert.equal(admitted.availableThreads, 4);
  assert.equal(admitted.admissionStatus, 'admitted');
  assert.equal(admitted.admittedThreads, 4);
  assert.equal(admitted.performanceScoreSource, 'timing-scale-neutral');
  assert.equal(admitted.performanceScorePermille, 100);
  assert.equal(admitted.capacityWeight, 400);
  assert.equal(Object.hasOwn(admitted, 'clockSpeedMhz'), false);
});

test('explicit threads permit intentional oversubscription while auto adapts', () => {
  const common = {
    id: 'node-a',
    selectedScope: scope('linux-x64', 'standard'),
    threads: 8,
    performanceScorePermille: 100,
    currentLoadPermille: 250,
    runsOnControllerHost: true,
  };
  const explicit = assessDistributedNodeCapacity(
    node({
      ...common,
      concurrency: { mode: 'explicit', threads: 16 },
    })
  );
  assert.equal(explicit.effectiveLogicalThreads, 8);
  assert.equal(explicit.availableThreads, 5);
  assert.equal(explicit.configuredThreadBudget, 16);
  assert.equal(explicit.admissionStatus, 'admitted');
  assert.equal(explicit.admissionReason, null);
  assert.equal(explicit.admittedThreads, 16);
  assert.equal(explicit.capacityWeight, 1_600);

  const maximum = assessDistributedNodeCapacity(
    node({
      ...common,
      threads: 1,
      concurrency: {
        mode: 'explicit',
        threads: MAX_DISTRIBUTED_NODE_THREADS,
      },
    })
  );
  assert.equal(maximum.admittedThreads, MAX_DISTRIBUTED_NODE_THREADS);
  assert.throws(
    () =>
      assessDistributedNodeCapacity(
        node({
          ...common,
          concurrency: {
            mode: 'explicit',
            threads: MAX_DISTRIBUTED_NODE_THREADS + 1,
          },
        })
      ),
    /cannot exceed 256/
  );

  const adaptive = assessDistributedNodeCapacity(node(common));
  assert.equal(adaptive.concurrencyPolicy, 'auto');
  assert.equal(adaptive.admissionStatus, 'admitted');
  assert.equal(adaptive.admittedThreads, 5);
  assert.equal(adaptive.capacityWeight, 500);

  const unavailable = assessDistributedNodeCapacity(
    node({
      ...common,
      currentLoadPermille: 1_000,
    })
  );
  assert.equal(unavailable.admissionStatus, 'unavailable');
  assert.equal(unavailable.admissionReason, 'no-current-capacity');
  assert.equal(unavailable.admittedThreads, 0);
});

test('controller-host placement alone controls the interactive reserve', () => {
  const selectedScope = scope('linux-x64', 'standard');
  const remote = assessDistributedNodeCapacity(
    node({
      id: 'remote-node',
      selectedScope,
      threads: 8,
      performanceScorePermille: 100,
      localInteractiveReserveThreads: 3,
      runsOnControllerHost: false,
    })
  );
  assert.equal(Object.hasOwn(remote, 'role'), false);
  assert.equal(remote.runsOnControllerHost, false);
  assert.equal(remote.interactiveReservedThreads, 0);
  assert.equal(remote.availableThreads, 8);

  const local = assessDistributedNodeCapacity(
    node({
      id: 'local-node',
      selectedScope,
      threads: 8,
      performanceScorePermille: 100,
      runsOnControllerHost: true,
    })
  );
  assert.equal(Object.hasOwn(local, 'role'), false);
  assert.equal(local.runsOnControllerHost, true);
  assert.equal(local.interactiveReservedThreads, 1);
  assert.equal(local.availableThreads, 7);
});

test('first run spreads tests across admitted node thread slots without hardware weighting', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const nodes = [
    {
      ...node({
        id: 'laptop-node',
        selectedScope,
        threads: 12,
        performanceScorePermille: 9_999,
        concurrency: { mode: 'explicit', threads: 24 },
      }),
      clockSpeedMhz: 9_999,
    },
    {
      ...node({
        id: 'server-node',
        selectedScope,
        threads: 8,
        performanceScorePermille: 1,
        concurrency: { mode: 'explicit', threads: 6 },
      }),
      benchmark: null,
      clockSpeedMhz: 1,
    },
  ];
  const tests = Array.from({ length: 10 }, (_, index) =>
    testEntry(`unit/test-${String(index + 1).padStart(2, '0')}.test.ts`)
  );
  const schedule = createDistributedAdaptiveSchedule({
    tests,
    nodes,
    profile: createAdaptiveTimingProfile(),
  });
  const changedHardwareHints = createDistributedAdaptiveSchedule({
    tests,
    nodes: [
      {
        ...nodes[0],
        benchmark: { valid: true, performanceScorePermille: 1 },
        clockSpeedMhz: 1,
      },
      {
        ...nodes[1],
        benchmark: { valid: true, performanceScorePermille: 9_999 },
        clockSpeedMhz: 9_999,
      },
    ],
    profile: createAdaptiveTimingProfile(),
  });
  assert.deepEqual(changedHardwareHints, schedule);
  assert.deepEqual(
    schedule.nodes.map((entry) => [
      entry.nodeId,
      entry.performanceScoreSource,
      entry.performanceScorePermille,
      entry.capacityWeight,
    ]),
    [
      ['laptop-node', 'timing-scale-neutral', 100, 2_400],
      ['server-node', 'timing-scale-neutral', 100, 600],
    ]
  );
  assert.equal(schedule.threadSlots.length, 30);
  assert.deepEqual(
    Object.fromEntries(
      schedule.nodes.map(({ nodeId }) => [
        nodeId,
        schedule.threadSlots
          .filter((threadSlot) => threadSlot.nodeId === nodeId)
          .reduce((count, threadSlot) => count + threadSlot.tests.length, 0),
      ])
    ),
    { 'laptop-node': 8, 'server-node': 2 }
  );
});

test('node scheduler rejects every superseded sealed schema generation', () => {
  const selectedScope = scope('linux-x64', 'node-a');
  const tests = [testEntry('unit/a.test.ts')];
  const nodes = [
    node({
      id: 'node-a',
      selectedScope,
      threads: 4,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
  ];
  const profile = createAdaptiveTimingProfile();
  assert.throws(
    () =>
      observation({
        profile,
        selectedScope,
        runId: 'obsolete-observation',
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', 10)],
        schema: 'seerrng-distributed-adaptive-observation/v1',
      }),
    /Unsupported distributed adaptive observation schema/
  );
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests,
        nodes,
        profile: {
          schema: 'seerrng-distributed-adaptive-profile/v2',
          scopes: [],
        },
      }),
    /Unsupported distributed adaptive profile schema/
  );

  const schedule = createDistributedAdaptiveSchedule({
    tests,
    nodes,
    profile,
  });
  const obsoleteSchedule = rehashSchedule(schedule, (changed) => {
    changed.schema = 'seerrng-distributed-adaptive-schedule/v2';
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        obsoleteSchedule,
        scheduleExpectations(obsoleteSchedule)
      ),
    /Unsupported distributed adaptive schedule schema/
  );

  const obsoleteCapacity = rehashSchedule(schedule, (changed) => {
    changed.nodes[0].schema = 'seerrng-distributed-node-capacity/v2';
    changed.nodeCapacitiesSha256 = canonicalJsonSha256(changed.nodes);
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        obsoleteCapacity,
        scheduleExpectations(obsoleteCapacity)
      ),
    /Unsupported distributed node capacity schema/
  );
});

test('timing calibration is isolated by environment and node ID', () => {
  const windowsScope = scope('windows-x64', 'desktop-fast');
  const linuxScope = scope('linux-x64', 'github-standard');
  const first = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope: windowsScope,
    runId: 'windows-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 40)],
  });
  const second = applyObservation(first.profile, {
    selectedScope: linuxScope,
    runId: 'linux-1',
    performanceScorePermille: 200,
    results: [resultEntry('unit/a.test.ts', 30)],
  });
  assert.equal(second.profile.scopes.length, 2);
  assert.deepEqual(
    second.profile.scopes.map((entry) => [
      entry.environment,
      entry.nodeId,
      entry.tests[0].estimateWorkUnits,
    ]),
    [
      ['linux-x64', 'github-standard', 3_000],
      ['windows-x64', 'desktop-fast', 4_000],
    ]
  );
});

test('node-specific verified timing scopes drive placement without benchmark data', () => {
  const nodeAScope = scope('linux-x64', 'node-a');
  const nodeBScope = scope('linux-x64', 'node-b');
  const resultsA = [
    resultEntry('unit/a.test.ts', 10),
    resultEntry('unit/b.test.ts', 100),
  ];
  const resultsB = [
    resultEntry('unit/a.test.ts', 100),
    resultEntry('unit/b.test.ts', 10),
  ];
  const first = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope: nodeAScope,
    runId: 'node-a-timing-1',
    performanceScorePermille: 1,
    benchmarkValid: false,
    results: resultsA,
  });
  const profile = applyObservation(first.profile, {
    selectedScope: nodeBScope,
    runId: 'node-b-timing-1',
    performanceScorePermille: 1,
    benchmarkValid: false,
    results: resultsB,
  }).profile;
  const nodes = [
    {
      ...node({
        id: 'node-a',
        selectedScope: nodeAScope,
        threads: 4,
        performanceScorePermille: 9_999,
        concurrency: { mode: 'explicit', threads: 1 },
      }),
      benchmark: null,
    },
    {
      ...node({
        id: 'node-b',
        selectedScope: nodeBScope,
        threads: 4,
        performanceScorePermille: 1,
        concurrency: { mode: 'explicit', threads: 1 },
      }),
      benchmark: null,
    },
  ];
  const schedule = createDistributedAdaptiveSchedule({
    tests: [testEntry('unit/a.test.ts'), testEntry('unit/b.test.ts')],
    nodes,
    profile,
  });
  assert.deepEqual(
    schedule.threadSlots.map((threadSlot) => [
      threadSlot.nodeId,
      threadSlot.tests.map((entry) => [
        entry.id,
        entry.estimateSource,
        entry.predictedDurationMs,
      ]),
    ]),
    [
      ['node-a', [['unit/a.test.ts', 'profile', 10]]],
      ['node-b', [['unit/b.test.ts', 'profile', 10]]],
    ]
  );
});

test('timing scopes isolate repository, application, lane, adapter, environment, node ID, and selected N', () => {
  const scopes = [
    scope('linux-x64', 'node-standard'),
    scope('linux-x64', 'node-standard', { applicationId: 'other-app' }),
    scope('linux-x64', 'node-standard', { laneId: 'cypress' }),
    scope('linux-x64', 'node-standard', { adapterId: 'cypress-native' }),
    scope('linux-x64', 'node-standard', {
      repositoryIdentity: alternateRepositoryIdentitySha256,
    }),
    scope('windows-x64', 'node-standard'),
    scope('linux-x64', 'node-fast'),
    scope('linux-x64', 'node-standard', { selectedN: 2 }),
  ];
  let profile = createAdaptiveTimingProfile();
  for (const [index, selectedScope] of scopes.entries())
    profile = applyObservation(profile, {
      selectedScope,
      runId: `scope-${index}`,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 10 + index)],
    }).profile;
  assert.equal(profile.scopes.length, scopes.length);
  assert.deepEqual(
    scopes.map(
      (selectedScope) =>
        estimateAdaptiveTestWork(profile, {
          scope: selectedScope,
          test: timingTestEntry('unit/a.test.ts'),
        }).workUnits
    ),
    scopes.map((_, index) => (10 + index) * 100)
  );
});

test('rolled observation provenance remains replay-safe through its source-profile binding', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const policy = {
    acceptedRunWindow: 2,
    maximumSamplesPerTest: 2,
  };
  let profile = createAdaptiveTimingProfile();
  const sealedObservations = [];
  for (const runId of ['run-1', 'run-2', 'run-3']) {
    const sealedObservation = observation({
      profile,
      policy,
      selectedScope,
      runId,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
    });
    sealedObservations.push(sealedObservation);
    profile = updateAdaptiveTimingProfile(
      profile,
      sealedObservation,
      observationExpectations(sealedObservation),
      policy
    ).profile;
  }
  const [firstObservation, secondObservation] = sealedObservations;
  assert.deepEqual(profile.scopes[0].acceptedRunIds, ['run-2', 'run-3']);
  assert.equal(profile.schema, 'seerrng-distributed-adaptive-profile/v3');
  assert.equal(profile.scopes[0].acceptedObservations.length, 2);
  assert.deepEqual(profile.scopes[0].acceptedObservations[0], {
    observationId: canonicalJsonSha256({
      schema: 'seerrng-distributed-adaptive-observation-identity/v3',
      scope: selectedScope,
      runId: 'run-2',
      candidateSha256: 'a'.repeat(64),
      revision: 'candidate-revision-1',
      runAttempt: 1,
      scheduleSha256: 'e'.repeat(64),
      submissionSha256: 'f'.repeat(64),
      observationSha256: secondObservation.observationSha256,
    }),
    observationSha256: secondObservation.observationSha256,
    runId: 'run-2',
    candidateSha256: 'a'.repeat(64),
    revision: 'candidate-revision-1',
    runAttempt: 1,
    scheduleSha256: 'e'.repeat(64),
    submissionSha256: 'f'.repeat(64),
  });
  assert.deepEqual(
    profile.scopes[0].acceptedObservations.map(
      ({ runId, candidateSha256, revision }) => ({
        runId,
        candidateSha256,
        revision,
      })
    ),
    ['run-2', 'run-3'].map((runId) => ({
      runId,
      candidateSha256: 'a'.repeat(64),
      revision: 'candidate-revision-1',
    }))
  );
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        firstObservation,
        observationExpectations(firstObservation),
        policy
      ),
    /another source profile/
  );
  assert.deepEqual(profile.scopes[0].acceptedRunIds, ['run-2', 'run-3']);
  assert.equal(profile.scopes[0].acceptedObservations.length, 2);
});

test('only complete valid successful runs update timing history', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const empty = createAdaptiveTimingProfile();
  const passing = observation({
    profile: empty,
    selectedScope,
    runId: 'run-1',
    performanceScorePermille: 9_999,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  for (const patch of [
    { valid: false },
    { complete: false },
    { status: 'failed' },
  ]) {
    const ignored = applyObservation(empty, {
      selectedScope,
      runId: `ignored-${Object.keys(patch)[0]}`,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
      ...patch,
    });
    assert.equal(ignored.accepted, false);
    assert.deepEqual(ignored.profile, empty);
  }
  const failedTest = applyObservation(empty, {
    selectedScope,
    runId: 'failed-test',
    performanceScorePermille: 100,
    results: [{ ...resultEntry('unit/a.test.ts', 1), status: 'failed' }],
  });
  assert.equal(failedTest.accepted, false);
  assert.equal(failedTest.reason, 'unsuccessful-test');
  assert.deepEqual(failedTest.profile, empty);

  const accepted = updateAdaptiveTimingProfile(
    empty,
    passing,
    observationExpectations(passing)
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.updatedTests, 1);
  assert.equal(accepted.profile.scopes[0].tests[0].estimateWorkUnits, 10_000);
  const acceptedWithoutBenchmark = applyObservation(empty, {
    selectedScope,
    runId: 'run-without-benchmark',
    performanceScorePermille: 1,
    benchmarkValid: false,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  assert.equal(acceptedWithoutBenchmark.accepted, true);
  assert.equal(
    acceptedWithoutBenchmark.profile.scopes[0].tests[0].estimateWorkUnits,
    10_000
  );
  const duplicate = updateAdaptiveTimingProfile(
    accepted.profile,
    passing,
    observationExpectations(passing)
  );
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate-observation');
  assert.deepEqual(duplicate.profile, accepted.profile);
});

test('failed and partial observations cannot make a test appear artificially fast', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const initial = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
  const failed = applyObservation(initial, {
    selectedScope,
    runId: 'failed-2',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 1)],
    status: 'failed',
  });
  const partial = applyObservation(initial, {
    selectedScope,
    runId: 'partial-2',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 1)],
    complete: false,
  });
  assert.deepEqual(failed.profile, initial);
  assert.deepEqual(partial.profile, initial);
  assert.equal(
    estimateAdaptiveTestWork(initial, {
      scope: selectedScope,
      test: timingTestEntry('unit/a.test.ts'),
    }).workUnits,
    10_000
  );
});

test('new and changed tests receive conservative fallback estimates', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
  const policy = {
    coldStartDurationMs: 100,
    coldStartPerformanceScorePermille: 10,
  };
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: selectedScope,
        test: timingTestEntry('unit/b.test.ts'),
      },
      policy
    ),
    { workUnits: 12_500, source: 'new-test' }
  );
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: selectedScope,
        test: timingTestEntry('unit/a.test.ts', 'a-v2'),
      },
      policy
    ),
    { workUnits: 10_000, source: 'changed-test' }
  );
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: scope('macos-arm64', 'unknown'),
        test: timingTestEntry('unit/a.test.ts'),
      },
      policy
    ),
    { workUnits: 1_000, source: 'cold-start' }
  );
});

test('rolling calibration is bounded and robust against a single extreme sample', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  let profile = createAdaptiveTimingProfile();
  const durations = [100, 101, 99, 100, 10_000, 102, 98, 100, 101, 99];
  for (const [index, durationMs] of durations.entries()) {
    profile = applyObservation(
      profile,
      {
        selectedScope,
        runId: `green-${index}`,
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', durationMs)],
      },
      { maximumSamplesPerTest: 9 }
    ).profile;
  }
  const timing = profile.scopes[0].tests[0];
  assert.equal(timing.samplesWorkUnits.length, 9);
  assert.equal(timing.samplesWorkUnits.includes(1_000_000), true);
  assert.ok(timing.estimateWorkUnits >= 9_900);
  assert.ok(timing.estimateWorkUnits <= 10_200);
});

test('timing history drives deterministic scheduling across node thread slots', () => {
  const nodeBScope = scope('linux-x64', 'node-b');
  const nodeAScope = scope('linux-x64', 'node-a', {
    selectedN: 2,
  });
  const results = [
    resultEntry('unit/a.test.ts', 100),
    resultEntry('unit/b.test.ts', 50),
    resultEntry('unit/c.test.ts', 50),
  ];
  const twoSlotProfile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope: nodeAScope,
    runId: 'green-n2',
    performanceScorePermille: 100,
    results,
  }).profile;
  const profile = applyObservation(twoSlotProfile, {
    selectedScope: nodeBScope,
    runId: 'green-n1',
    performanceScorePermille: 200,
    results: [
      resultEntry('unit/a.test.ts', 50),
      resultEntry('unit/b.test.ts', 25),
      resultEntry('unit/c.test.ts', 25),
    ],
  }).profile;
  const nodes = [
    node({
      id: 'node-a',
      selectedScope: nodeAScope,
      threads: 8,
      performanceScorePermille: 9_999,
      concurrency: { mode: 'explicit', threads: 2 },
    }),
    node({
      id: 'node-b',
      selectedScope: nodeBScope,
      threads: 8,
      performanceScorePermille: 1,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
  ];
  const tests = results.map((result) =>
    testEntry(result.testId, result.fingerprint)
  );
  const first = createDistributedAdaptiveSchedule({
    tests,
    nodes,
    profile,
  });
  const reordered = createDistributedAdaptiveSchedule({
    tests: [...tests].reverse(),
    nodes: [...nodes].reverse(),
    profile,
  });
  assert.deepEqual(reordered, first);
  assert.deepEqual(
    verifyDistributedAdaptiveSchedule(first, scheduleExpectations(first)),
    first
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.nodes), true);
  assert.equal(Object.isFrozen(first.nodes[0]), true);
  assert.equal(Object.isFrozen(first.threadSlots), true);
  assert.equal(Object.isFrozen(first.threadSlots[0].tests), true);
  assert.equal(Object.isFrozen(first.threadSlots[0].tests[0]), true);
  assert.equal(first.schema, 'seerrng-distributed-adaptive-schedule/v3');
  assert.equal(
    first.algorithm,
    'deterministic-heterogeneous-dependency-list/v1'
  );
  assert.equal(first.applicationId, 'seerrng');
  assert.equal(first.repositoryIdentitySha256, repositoryIdentitySha256);
  assert.deepEqual(
    first.nodes.map((entry) => [
      entry.nodeId,
      entry.admittedThreads,
      entry.capacityWeight,
    ]),
    [
      ['node-a', 2, 200],
      ['node-b', 1, 100],
    ]
  );
  assert.deepEqual(
    first.threadSlots.map((threadSlot) => [
      threadSlot.threadSlotId,
      threadSlot.tests.map((entry) => entry.id),
      threadSlot.predictedFinishOffsetMs,
    ]),
    [
      ['node-a.thread-1', ['unit/b.test.ts'], 50],
      ['node-a.thread-2', ['unit/c.test.ts'], 50],
      ['node-b.thread-1', ['unit/a.test.ts'], 50],
    ]
  );
  assert.equal(first.predictedWallMs, 50);
});

test('one test occupies one thread slot and cannot claim divisible thread speedup', () => {
  const selectedScope = scope('linux-x64', 'node-a', {
    selectedN: 4,
  });
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-n4',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
  const schedule = createDistributedAdaptiveSchedule({
    tests: [testEntry('unit/a.test.ts')],
    nodes: [
      node({
        id: 'node-a',
        selectedScope,
        threads: 8,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 4 },
      }),
    ],
    profile,
  });
  assert.equal(schedule.threadSlots.length, 4);
  assert.equal(schedule.threadSlots[0].predictedFinishOffsetMs, 100);
  assert.deepEqual(
    schedule.threadSlots.map((threadSlot) => threadSlot.tests.length),
    [1, 0, 0, 0]
  );
  assert.equal(schedule.predictedWallMs, 100);
});

test('one schedule cannot mix application or repository namespaces', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const nodes = [
    node({
      id: 'node-a',
      selectedScope,
      threads: 4,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
  ];
  const schedule = (tests) =>
    createDistributedAdaptiveSchedule({
      tests,
      nodes,
      profile: createAdaptiveTimingProfile(),
    });
  assert.throws(
    () =>
      schedule([
        testEntry('unit/a.test.ts'),
        testEntry('unit/b.test.ts', 'b-v1', {
          applicationId: 'another-app',
          dependencies: ['unit/a.test.ts'],
        }),
      ]),
    /exactly one application namespace/
  );
  assert.throws(
    () =>
      schedule([
        testEntry('unit/a.test.ts'),
        testEntry('unit/b.test.ts', 'b-v1', {
          repositoryIdentity: alternateRepositoryIdentitySha256,
          dependencies: ['unit/a.test.ts'],
        }),
      ]),
    /exactly one repository namespace/
  );
});

test('adapter eligibility excludes nodes that cannot run a test', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const schedule = createDistributedAdaptiveSchedule({
    tests: [
      testEntry('cypress/a.cy.ts', 'a-v1', {
        laneId: 'cypress',
        adapterId: 'cypress-native',
      }),
    ],
    nodes: [
      node({
        id: 'unit-only',
        selectedScope,
        threads: 4,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 1 },
        adapterIds: ['native-generic'],
      }),
      node({
        id: 'cypress-capable',
        selectedScope,
        threads: 4,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 1 },
        adapterIds: ['cypress-native'],
      }),
    ],
    profile: createAdaptiveTimingProfile(),
  });
  assert.deepEqual(
    schedule.threadSlots.map((threadSlot) => [
      threadSlot.nodeId,
      threadSlot.tests.map((entry) => entry.id),
    ]),
    [
      ['cypress-capable', ['cypress/a.cy.ts']],
      ['unit-only', []],
    ]
  );
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests: [
          testEntry('cypress/a.cy.ts', 'a-v1', {
            laneId: 'cypress',
            adapterId: 'cypress-native',
          }),
        ],
        nodes: [
          node({
            id: 'unit-only',
            selectedScope,
            threads: 4,
            performanceScorePermille: 100,
            concurrency: { mode: 'explicit', threads: 1 },
            adapterIds: ['native-generic'],
          }),
        ],
        profile: createAdaptiveTimingProfile(),
      }),
    /No admitted node supports adapter cypress-native/
  );
});

test('dependencies release continuously without a global stage barrier', () => {
  const { profile, schedule, tests, nodes } = continuousDependencyFixture();
  const reordered = createDistributedAdaptiveSchedule({
    tests: [...tests].reverse(),
    nodes,
    profile,
  });
  assert.deepEqual(reordered, schedule);

  const long = scheduledTest(schedule, 'unit/long.test.ts');
  const short = scheduledTest(schedule, 'unit/short.test.ts');
  const followup = scheduledTest(schedule, 'unit/followup.test.ts');
  const final = scheduledTest(schedule, 'unit/final.test.ts');
  assert.deepEqual(
    [
      [long.predictedStartOffsetMs, long.predictedFinishOffsetMs],
      [short.predictedStartOffsetMs, short.predictedFinishOffsetMs],
      [followup.predictedStartOffsetMs, followup.predictedFinishOffsetMs],
      [final.predictedStartOffsetMs, final.predictedFinishOffsetMs],
    ],
    [
      [0, 100],
      [0, 10],
      [10, 20],
      [20, 30],
    ]
  );
  assert.deepEqual(
    schedule.threadSlots.map((threadSlot) =>
      threadSlot.tests.map((entry) => entry.id)
    ),
    [
      ['unit/long.test.ts'],
      ['unit/short.test.ts', 'unit/followup.test.ts', 'unit/final.test.ts'],
    ]
  );
  assert.equal(schedule.predictedWallMs, 100);

  const selectedScope = scope('linux-x64', 'node-standard');
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests: [
          testEntry('unit/a.test.ts', 'a-v1', {
            dependencies: ['unit/b.test.ts'],
          }),
          testEntry('unit/b.test.ts', 'b-v1', {
            dependencies: ['unit/a.test.ts'],
          }),
        ],
        nodes: [
          node({
            id: 'node-a',
            selectedScope,
            threads: 4,
            performanceScorePermille: 100,
          }),
        ],
        profile: createAdaptiveTimingProfile(),
      }),
    /dependencies contain a cycle/
  );
});

test('schedule verifier rejects external bindings and hostile rehashes', () => {
  const { schedule } = continuousDependencyFixture();
  assert.deepEqual(
    verifyDistributedAdaptiveSchedule(schedule, scheduleExpectations(schedule)),
    schedule
  );

  for (const [field, value, message] of [
    ['expectedScheduleSha256', 'f'.repeat(64), /trusted hash/],
    ['expectedApplicationId', 'another-app', /another application/],
    [
      'expectedRepositoryIdentitySha256',
      alternateRepositoryIdentitySha256,
      /another repository/,
    ],
    ['expectedTestInventorySha256', 'f'.repeat(64), /another test inventory/],
    ['expectedProfileSha256', 'f'.repeat(64), /another timing profile/],
  ])
    assert.throws(
      () =>
        verifyDistributedAdaptiveSchedule(schedule, {
          ...scheduleExpectations(schedule),
          [field]: value,
        }),
      message
    );

  const dependencyBeforePredecessor = rehashSchedule(schedule, (changed) => {
    const followup = scheduledTest(changed, 'unit/followup.test.ts');
    followup.dependencies = ['unit/long.test.ts'];
    refreshScheduleInventoryHash(changed);
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        dependencyBeforePredecessor,
        scheduleExpectations(dependencyBeforePredecessor)
      ),
    /before its dependency/
  );

  const overlappingSlot = rehashSchedule(schedule, (changed) => {
    const final = scheduledTest(changed, 'unit/final.test.ts');
    final.predictedStartOffsetMs = 15;
    final.predictedFinishOffsetMs = 25;
    changed.threadSlots[1].predictedFinishOffsetMs = 25;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        overlappingSlot,
        scheduleExpectations(overlappingSlot)
      ),
    /overlap/
  );

  const incompatibleAdapter = rehashSchedule(schedule, (changed) => {
    changed.nodes[0].adapterIds = ['another-adapter'];
    changed.nodeCapacitiesSha256 = canonicalJsonSha256(changed.nodes);
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        incompatibleAdapter,
        scheduleExpectations(incompatibleAdapter)
      ),
    /incompatible adapter/
  );

  const duplicateSequence = rehashSchedule(schedule, (changed) => {
    scheduledTest(changed, 'unit/long.test.ts').sequence = 2;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        duplicateSequence,
        scheduleExpectations(duplicateSequence)
      ),
    /sequences must be contiguous/
  );

  const reversedSequenceTimeline = rehashSchedule(schedule, (changed) => {
    scheduledTest(changed, 'unit/long.test.ts').sequence = 4;
    scheduledTest(changed, 'unit/short.test.ts').sequence = 1;
    scheduledTest(changed, 'unit/followup.test.ts').sequence = 2;
    scheduledTest(changed, 'unit/final.test.ts').sequence = 3;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        reversedSequenceTimeline,
        scheduleExpectations(reversedSequenceTimeline)
      ),
    /sequence timeline is not canonical/
  );

  const wrongWall = rehashSchedule(schedule, (changed) => {
    changed.predictedWallMs = 99;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        wrongWall,
        scheduleExpectations(wrongWall)
      ),
    /predicted wall time is inconsistent/
  );

  const staleSeal = structuredClone(schedule);
  staleSeal.policySha256 = 'f'.repeat(64);
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        staleSeal,
        scheduleExpectations(schedule)
      ),
    /seal does not match/
  );
});

test('a distributed schedule preserves intentional explicit oversubscription', () => {
  const selectedScope = scope('linux-x64', 'node-standard');
  const schedule = createDistributedAdaptiveSchedule({
    tests: [testEntry('unit/a.test.ts')],
    nodes: [
      node({
        id: 'node-a',
        selectedScope,
        threads: 4,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 8 },
        currentLoadPermille: 500,
      }),
    ],
    profile: createAdaptiveTimingProfile(),
  });
  assert.equal(schedule.nodes[0].availableThreads, 2);
  assert.equal(schedule.nodes[0].configuredThreadBudget, 8);
  assert.equal(schedule.nodes[0].admittedThreads, 8);
  assert.equal(schedule.threadSlots.length, 8);
  assert.deepEqual(
    schedule.threadSlots.map((threadSlot) => threadSlot.tests.length),
    [1, 0, 0, 0, 0, 0, 0, 0]
  );
});
