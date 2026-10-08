import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve application aliases.
import {
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve application aliases.
import {
  DISTRIBUTED_SHARD_RUN_SCHEMA,
  executeDistributedShardSchedule,
  verifyDistributedShardRun,
} from '../tools/validation-engine/runtime/distributed-shard-executor.mjs';

const repositoryIdentitySha256 = '1'.repeat(64);

function shard(id, dependencies = []) {
  return {
    id,
    fingerprint: `${id}-fingerprint`,
    applicationId: 'seerrng',
    laneId: 'repository',
    adapterId: 'native-test',
    repositoryIdentitySha256,
    dependencies,
  };
}

function node(id, threads) {
  return {
    id,
    scope: {
      applicationId: 'seerrng',
      laneId: 'repository',
      adapterId: 'native-test',
      repositoryIdentitySha256,
      environment: 'linux-x64',
      nodeId: id,
      selectedN: threads,
    },
    adapterIds: ['native-test'],
    effectiveLogicalThreads: threads,
    concurrency: { mode: 'explicit', threads },
    runsOnControllerHost: id === 'controller',
    localInteractiveReserveThreads: 0,
  };
}

function fixture({ shards = [shard('a'), shard('b'), shard('c')] } = {}) {
  const schedule = createDistributedAdaptiveSchedule({
    tests: shards,
    nodes: [node('controller', 2), node('node-01', 1)],
    profile: createAdaptiveTimingProfile(),
  });
  return {
    schedule,
    expectations: {
      expectedApplicationId: schedule.applicationId,
      expectedProfileSha256: schedule.profileSha256,
      expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
      expectedScheduleSha256: schedule.scheduleSha256,
      expectedTestInventorySha256: schedule.testInventorySha256,
    },
  };
}

function passingResult(shardId) {
  return {
    shardId,
    result: {
      resultSha256: createHash('sha256').update(shardId).digest('hex'),
      status: 'passed',
    },
  };
}

test('sealed assignments execute once and produce a closed passing report', async () => {
  const { schedule, expectations } = fixture();
  const seen = [];
  let tick = 0;
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'run-1',
    clock: () => 1_750_000_000_000,
    monotonic: () => tick++,
    dispatch: async (assignment) => {
      seen.push({
        shardId: assignment.shard.id,
        nodeId: assignment.nodeId,
        threadSlotId: assignment.threadSlotId,
      });
      return passingResult(assignment.shard.id);
    },
  });

  assert.equal(report.schema, DISTRIBUTED_SHARD_RUN_SCHEMA);
  assert.equal(report.status, 'passed');
  assert.equal(report.resultReuse, false);
  assert.equal(report.outcomes.length, 3);
  assert.deepEqual(
    report.outcomes.map(({ shardId, status }) => [shardId, status]),
    schedule.threadSlots
      .flatMap(({ tests }) => tests)
      .toSorted((left, right) => left.sequence - right.sequence)
      .map(({ id }) => [id, 'passed'])
  );
  assert.deepEqual(
    new Set(seen.map(({ shardId }) => shardId)),
    new Set(['a', 'b', 'c'])
  );
  assert.match(report.reportSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    verifyDistributedShardRun(report, {
      schedule,
      expectations,
      expectedReportSha256: report.reportSha256,
    }),
    report
  );
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.outcomes[0].result), true);
});

test('report verification rejects assignment and outcome tampering', async () => {
  const { schedule, expectations } = fixture();
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'run-tamper',
    dispatch: async ({ shard: selected }) => passingResult(selected.id),
  });
  const changedAssignment = structuredClone(report);
  changedAssignment.outcomes[0].nodeId = 'node-99';
  assert.throws(
    () =>
      verifyDistributedShardRun(changedAssignment, {
        schedule,
        expectations,
        expectedReportSha256: report.reportSha256,
      }),
    /sealed assignment/
  );
  const changedResult = structuredClone(report);
  changedResult.outcomes[0].result.status = 'altered';
  assert.throws(
    () =>
      verifyDistributedShardRun(changedResult, {
        schedule,
        expectations,
        expectedReportSha256: report.reportSha256,
      }),
    /report hash/
  );
});

test('one thread slot never overlaps its own shards', async () => {
  const shards = Array.from({ length: 8 }, (_, index) =>
    shard(`shard-${index + 1}`)
  );
  const { schedule, expectations } = fixture({ shards });
  const activeBySlot = new Map();
  let peak = 0;
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'run-sequential-slots',
    dispatch: async ({ shard: selected, threadSlotId }) => {
      const active = (activeBySlot.get(threadSlotId) ?? 0) + 1;
      activeBySlot.set(threadSlotId, active);
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      activeBySlot.set(threadSlotId, active - 1);
      return passingResult(selected.id);
    },
  });
  assert.equal(peak, 1);
  assert.equal(report.status, 'passed');
});

test('a shard failure aborts later work and never reassigns it', async () => {
  const shards = [
    shard('root'),
    shard('dependent', ['root']),
    shard('independent'),
    shard('later'),
  ];
  const { schedule, expectations } = fixture({ shards });
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'run-failed',
    dispatch: async ({ shard: selected }) => {
      if (selected.id === 'root') {
        const error = new Error('test detail stays outside the sealed report');
        error.code = 'ERR_TEST_SHARD';
        throw error;
      }
      await new Promise((resolve) => setImmediate(resolve));
      return passingResult(selected.id);
    },
  });

  assert.equal(report.status, 'incomplete');
  assert.equal(
    report.outcomes.find(({ shardId }) => shardId === 'root').failureCode,
    'ERR_TEST_SHARD'
  );
  assert.equal(
    report.outcomes.find(({ shardId }) => shardId === 'dependent').status,
    'not-run'
  );
  assert.equal(JSON.stringify(report).includes('test detail'), false);
  assert.equal(
    new Set(report.outcomes.map(({ shardId }) => shardId)).size,
    shards.length
  );
});

test('caller abort before launch closes every shard as not run', async () => {
  const { schedule, expectations } = fixture();
  const controller = new AbortController();
  controller.abort();
  let dispatches = 0;
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'run-aborted',
    signal: controller.signal,
    dispatch: async ({ shard: selected }) => {
      dispatches += 1;
      return passingResult(selected.id);
    },
  });
  assert.equal(dispatches, 0);
  assert.equal(report.status, 'incomplete');
  assert.equal(
    report.outcomes.every(
      ({ status, failureCode }) =>
        status === 'not-run' && failureCode === 'ERR_DISTRIBUTED_SHARD_ABORTED'
    ),
    true
  );
});

test('schedule bindings and dispatch identities fail closed', async () => {
  const { schedule, expectations } = fixture();
  await assert.rejects(
    executeDistributedShardSchedule(schedule, {
      expectations: {
        ...expectations,
        expectedScheduleSha256: 'f'.repeat(64),
      },
      runId: 'wrong-schedule',
      dispatch: async ({ shard: selected }) => passingResult(selected.id),
    }),
    /trusted hash/
  );
  const report = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'wrong-dispatch',
    dispatch: async () => passingResult('another-shard'),
  });
  assert.equal(report.status, 'incomplete');
  assert.equal(
    report.outcomes.some(
      ({ status, failureCode }) =>
        status === 'failed' && failureCode === 'ERR_DISTRIBUTED_SHARD_EXECUTION'
    ),
    true
  );
});
