// Copyright (c) snapetech and SeerrNG contributors.
// Executes one sealed adaptive shard schedule without changing its assignments.
import { verifyDistributedAdaptiveSchedule } from './distributed-adaptive-scheduler.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_SHARD_RUN_SCHEMA = 'seerrng-distributed-shard-run/v1';

const HASH64 = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function token(value, label) {
  if (
    typeof value !== 'string' ||
    !TOKEN.test(value) ||
    value.normalize('NFC') !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}

function failureCode(error) {
  const value = error?.code;
  return typeof value === 'string' && TOKEN.test(value)
    ? value
    : 'ERR_DISTRIBUTED_SHARD_EXECUTION';
}

function validateDispatchResult(value, shardId) {
  exactKeys(value, ['result', 'shardId'], 'distributed shard dispatch result');
  if (token(value.shardId, 'distributed dispatch shard ID') !== shardId)
    throw new Error('Distributed dispatch returned another shard identity');
  const result = structuredClone(
    plainObject(value.result, 'distributed shard native result')
  );
  hash(result.resultSha256, 'Distributed shard native result hash');
  return result;
}

function scheduleExpectations(value) {
  exactKeys(
    value,
    [
      'expectedApplicationId',
      'expectedProfileSha256',
      'expectedRepositoryIdentitySha256',
      'expectedScheduleSha256',
      'expectedTestInventorySha256',
    ],
    'distributed shard schedule expectations'
  );
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative integer`);
  return value;
}

function exactInstant(value, label) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`${label} must be an exact UTC instant`);
  return value;
}

function completionRecords(schedule) {
  const records = new Map();
  for (const threadSlot of schedule.threadSlots)
    for (const shard of threadSlot.tests) {
      if (records.has(shard.id))
        throw new Error(
          'Distributed schedule assigns one shard more than once'
        );
      let complete;
      const promise = new Promise((resolve) => {
        complete = resolve;
      });
      records.set(shard.id, { complete, outcome: null, promise });
    }
  if (!records.size) throw new Error('Distributed schedule has zero shards');
  return records;
}

function notRunOutcome(shard, threadSlot, reason) {
  return {
    sequence: shard.sequence,
    shardId: shard.id,
    nodeId: threadSlot.nodeId,
    threadSlotId: threadSlot.threadSlotId,
    status: 'not-run',
    wallMs: 0,
    result: null,
    failureCode: reason,
  };
}

function normalizeRunOutcome(value, assignment) {
  exactKeys(
    value,
    [
      'failureCode',
      'nodeId',
      'result',
      'sequence',
      'shardId',
      'status',
      'threadSlotId',
      'wallMs',
    ],
    'distributed shard outcome'
  );
  const status = value.status;
  if (!['passed', 'failed', 'not-run'].includes(status))
    throw new Error('Distributed shard outcome status is invalid');
  const outcome = {
    sequence: nonnegativeInteger(
      value.sequence,
      'Distributed shard outcome sequence'
    ),
    shardId: token(value.shardId, 'distributed outcome shard ID'),
    nodeId: token(value.nodeId, 'distributed outcome node ID'),
    threadSlotId: token(
      value.threadSlotId,
      'distributed outcome thread-slot ID'
    ),
    status,
    wallMs: nonnegativeInteger(
      value.wallMs,
      'Distributed shard outcome wall time'
    ),
    result: value.result,
    failureCode: value.failureCode,
  };
  if (
    outcome.sequence !== assignment.sequence ||
    outcome.shardId !== assignment.shardId ||
    outcome.nodeId !== assignment.nodeId ||
    outcome.threadSlotId !== assignment.threadSlotId
  )
    throw new Error('Distributed shard outcome changed its sealed assignment');
  if (status === 'passed') {
    outcome.result = structuredClone(
      plainObject(value.result, 'distributed shard result')
    );
    hash(outcome.result.resultSha256, 'Distributed shard native result hash');
    if (value.failureCode !== null)
      throw new Error('Passing distributed shard has a failure code');
    outcome.failureCode = null;
  } else {
    if (value.result !== null)
      throw new Error('Non-passing distributed shard cannot carry a result');
    outcome.result = null;
    outcome.failureCode = token(
      value.failureCode,
      'distributed shard failure code'
    );
  }
  return outcome;
}

function scheduleAssignments(schedule) {
  return schedule.threadSlots
    .flatMap((threadSlot) =>
      threadSlot.tests.map((shard) => ({
        sequence: shard.sequence,
        shardId: shard.id,
        nodeId: threadSlot.nodeId,
        threadSlotId: threadSlot.threadSlotId,
      }))
    )
    .toSorted((left, right) => left.sequence - right.sequence);
}

export function verifyDistributedShardRun(
  value,
  {
    schedule: scheduleValue,
    expectations: expectationValue,
    expectedReportSha256,
  } = {}
) {
  const expectations = scheduleExpectations(expectationValue);
  const schedule = verifyDistributedAdaptiveSchedule(
    scheduleValue,
    expectations
  );
  const expectedReport = hash(
    expectedReportSha256,
    'Expected distributed shard report hash'
  );
  exactKeys(
    value,
    [
      'applicationId',
      'outcomes',
      'reportSha256',
      'resultReuse',
      'runId',
      'scheduleSha256',
      'schema',
      'startedAt',
      'status',
      'testInventorySha256',
      'wallMs',
    ],
    'distributed shard report'
  );
  if (value.schema !== DISTRIBUTED_SHARD_RUN_SCHEMA)
    throw new Error('Unsupported distributed shard report schema');
  if (!Array.isArray(value.outcomes))
    throw new Error('Distributed shard outcomes must be an array');
  const assignments = scheduleAssignments(schedule);
  if (value.outcomes.length !== assignments.length)
    throw new Error('Distributed shard report does not close its schedule');
  const outcomes = value.outcomes.map((outcome, index) =>
    normalizeRunOutcome(outcome, assignments[index])
  );
  const status = value.status;
  if (!['passed', 'incomplete'].includes(status))
    throw new Error('Distributed shard report status is invalid');
  const shouldPass = outcomes.every((outcome) => outcome.status === 'passed');
  if ((status === 'passed') !== shouldPass)
    throw new Error('Distributed shard report status contradicts its outcomes');
  if (value.resultReuse !== false)
    throw new Error('Distributed shard report cannot reuse prior results');
  const core = {
    schema: value.schema,
    runId: token(value.runId, 'distributed shard run ID'),
    applicationId: token(value.applicationId, 'distributed application ID'),
    scheduleSha256: hash(
      value.scheduleSha256,
      'Distributed shard schedule hash'
    ),
    testInventorySha256: hash(
      value.testInventorySha256,
      'Distributed shard inventory hash'
    ),
    startedAt: exactInstant(value.startedAt, 'Distributed shard start time'),
    wallMs: nonnegativeInteger(value.wallMs, 'Distributed shard run wall time'),
    status,
    outcomes,
    resultReuse: false,
  };
  if (
    core.applicationId !== schedule.applicationId ||
    core.scheduleSha256 !== schedule.scheduleSha256 ||
    core.testInventorySha256 !== schedule.testInventorySha256
  )
    throw new Error('Distributed shard report belongs to another schedule');
  const reportSha256 = hash(
    value.reportSha256,
    'Distributed shard report hash'
  );
  if (
    reportSha256 !== expectedReport ||
    reportSha256 !== canonicalJsonSha256(core)
  )
    throw new Error('Distributed shard report hash is invalid');
  return deepFreeze({ ...core, reportSha256 });
}

/**
 * Run every shard on its sealed node/thread-slot assignment. Thread slots run
 * concurrently; shards within one slot remain sequential. No reassignment,
 * retry, work stealing, or result reuse occurs in this MVP executor.
 */
export async function executeDistributedShardSchedule(
  scheduleValue,
  {
    expectations: expectationValue,
    dispatch,
    runId: runIdValue,
    signal,
    clock = Date.now,
    monotonic = performance.now.bind(performance),
  } = {}
) {
  if (typeof dispatch !== 'function')
    throw new Error('Distributed shard executor requires a dispatch callback');
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed shard executor signal must be an AbortSignal');
  if (typeof clock !== 'function' || typeof monotonic !== 'function')
    throw new Error('Distributed shard executor requires clocks');
  const runId = token(runIdValue, 'distributed shard run ID');
  const expectations = scheduleExpectations(expectationValue);
  const schedule = verifyDistributedAdaptiveSchedule(
    scheduleValue,
    expectations
  );
  const records = completionRecords(schedule);
  const controller = new AbortController();
  let callerAborted = signal?.aborted === true;
  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerAborted) controller.abort();

  const startedMs = clock();
  if (!Number.isSafeInteger(startedMs))
    throw new Error(
      'Distributed shard wall clock must return integer milliseconds'
    );
  const startedAt = new Date(startedMs).toISOString();
  const started = monotonic();
  if (!Number.isFinite(started))
    throw new Error('Distributed shard monotonic clock is invalid');

  const recordOutcome = (outcome) => {
    const record = records.get(outcome.shardId);
    if (!record || record.outcome)
      throw new Error('Distributed shard completion is duplicated or unknown');
    record.outcome = outcome;
    record.complete(outcome);
    return outcome;
  };

  const runThreadSlot = async (threadSlot) => {
    for (const shard of threadSlot.tests) {
      const dependencies = await Promise.all(
        shard.dependencies.map((dependency) => {
          const record = records.get(dependency);
          if (!record)
            throw new Error(
              'Distributed shard dependency is absent from the schedule'
            );
          return record.promise;
        })
      );
      if (dependencies.some(({ status }) => status !== 'passed')) {
        recordOutcome(
          notRunOutcome(shard, threadSlot, 'ERR_DISTRIBUTED_SHARD_DEPENDENCY')
        );
        continue;
      }
      if (controller.signal.aborted) {
        recordOutcome(
          notRunOutcome(
            shard,
            threadSlot,
            callerAborted
              ? 'ERR_DISTRIBUTED_SHARD_ABORTED'
              : 'ERR_DISTRIBUTED_SHARD_EARLIER_FAILURE'
          )
        );
        continue;
      }

      const shardStarted = monotonic();
      try {
        const result = validateDispatchResult(
          await dispatch({
            shard: deepFreeze(structuredClone(shard)),
            nodeId: threadSlot.nodeId,
            threadSlotId: threadSlot.threadSlotId,
            threadSlotIndex: threadSlot.threadSlotIndex,
            signal: controller.signal,
          }),
          shard.id
        );
        const finished = monotonic();
        if (!Number.isFinite(shardStarted) || !Number.isFinite(finished))
          throw new Error('Distributed shard monotonic clock is invalid');
        recordOutcome({
          sequence: shard.sequence,
          shardId: shard.id,
          nodeId: threadSlot.nodeId,
          threadSlotId: threadSlot.threadSlotId,
          status: 'passed',
          wallMs: Math.max(0, Math.round(finished - shardStarted)),
          result,
          failureCode: null,
        });
      } catch (error) {
        const finished = monotonic();
        recordOutcome({
          sequence: shard.sequence,
          shardId: shard.id,
          nodeId: threadSlot.nodeId,
          threadSlotId: threadSlot.threadSlotId,
          status: 'failed',
          wallMs:
            Number.isFinite(shardStarted) && Number.isFinite(finished)
              ? Math.max(0, Math.round(finished - shardStarted))
              : 0,
          result: null,
          failureCode: failureCode(error),
        });
        controller.abort();
      }
    }
  };

  try {
    await Promise.all(schedule.threadSlots.map(runThreadSlot));
  } finally {
    signal?.removeEventListener('abort', abortFromCaller);
  }
  const finished = monotonic();
  if (!Number.isFinite(finished))
    throw new Error('Distributed shard monotonic clock is invalid');
  const outcomes = [...records.values()]
    .map(({ outcome }) => outcome)
    .toSorted((left, right) => left.sequence - right.sequence);
  if (outcomes.some((outcome) => outcome === null))
    throw new Error('Distributed shard execution did not close every outcome');
  const status = outcomes.every(({ status }) => status === 'passed')
    ? 'passed'
    : 'incomplete';
  const core = {
    schema: DISTRIBUTED_SHARD_RUN_SCHEMA,
    runId,
    applicationId: schedule.applicationId,
    scheduleSha256: schedule.scheduleSha256,
    testInventorySha256: schedule.testInventorySha256,
    startedAt,
    wallMs: Math.max(0, Math.round(finished - started)),
    status,
    outcomes,
    resultReuse: false,
  };
  const report = {
    ...core,
    reportSha256: canonicalJsonSha256(core),
  };
  return verifyDistributedShardRun(report, {
    schedule,
    expectations,
    expectedReportSha256: report.reportSha256,
  });
}
