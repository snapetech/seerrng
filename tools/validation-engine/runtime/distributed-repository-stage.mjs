// Copyright (c) snapetech and SeerrNG contributors.
// Reconciles one repository stage from local checks and a sealed shard run.
import { verifyDistributedAdaptiveSchedule } from './distributed-adaptive-scheduler.mjs';
import {
  createDistributedNativeTaskRequest,
  verifyDistributedNativeTaskResult,
} from './distributed-native-adapter.mjs';
import { verifyDistributedShardRun } from './distributed-shard-executor.mjs';

export const DISTRIBUTED_REPOSITORY_EVIDENCE_SCHEMA =
  'seerrng-distributed-repository-evidence/v3';

const HASH64 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

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

function clone(value, label) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new Error(`${label} must be structured-cloneable`, { cause: error });
  }
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function gitObject(value, label) {
  if (typeof value !== 'string' || !GIT_OBJECT.test(value))
    throw new Error(`${label} must be a Git object ID`);
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

function addCount(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} exceeds safe integer accounting`);
  return value;
}

function normalizeCandidate(value) {
  plainObject(value, 'repository stage candidate');
  return deepFreeze({
    repository: text(value.repository, 'repository identity'),
    commit: gitObject(value.commit, 'repository candidate commit'),
    tree: gitObject(value.tree, 'repository candidate tree'),
    lockSha256: digest(
      value.lockSha256,
      'repository candidate lockfile identity'
    ),
    sourceSha256: digest(
      value.sourceSha256,
      'repository candidate source identity'
    ),
  });
}

function normalizePlan(value) {
  const plan = clone(plainObject(value, 'repository plan'), 'repository plan');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0)
    throw new Error('Repository plan requires native steps');
  plan.steps.forEach((step, index) => {
    plainObject(step, `repository step ${index}`);
    text(step.name, `repository step ${index} name`);
    text(step.kind, `repository step ${index} kind`);
  });
  return deepFreeze(plan);
}

function normalizeLocalReceipt(value, step) {
  const receipt = clone(
    plainObject(value, `local check ${step.name} receipt`),
    `local check ${step.name} receipt`
  );
  if (receipt.status !== 'passed' || receipt.exitCode !== 0)
    throw new Error(`Local repository check did not pass: ${step.name}`);
  if (Object.hasOwn(receipt, 'id') && receipt.id !== (step.id ?? step.name))
    throw new Error(`Local repository check identity changed: ${step.name}`);
  if (
    (Object.hasOwn(receipt, 'aborted') && receipt.aborted !== false) ||
    (Object.hasOwn(receipt, 'timedOut') && receipt.timedOut !== false) ||
    (Object.hasOwn(receipt, 'signal') && receipt.signal !== null)
  )
    throw new Error(`Local repository check was interrupted: ${step.name}`);
  if (
    Object.hasOwn(receipt, 'lifecycle') &&
    (receipt.lifecycle?.spawned !== true ||
      receipt.lifecycle?.completed !== true ||
      receipt.lifecycle?.cleanupVerified !== true)
  )
    throw new Error(`Local repository check did not close: ${step.name}`);
  return deepFreeze(receipt);
}

function scheduleExpectations(schedule, candidate) {
  plainObject(schedule, 'distributed repository schedule');
  return deepFreeze({
    expectedApplicationId: text(
      schedule.applicationId,
      'distributed repository application ID'
    ),
    expectedProfileSha256: digest(
      schedule.profileSha256,
      'distributed repository timing profile identity'
    ),
    expectedRepositoryIdentitySha256: candidate.sourceSha256,
    expectedScheduleSha256: digest(
      schedule.scheduleSha256,
      'distributed repository schedule identity'
    ),
    expectedTestInventorySha256: digest(
      schedule.testInventorySha256,
      'distributed repository test inventory identity'
    ),
  });
}

function requireExactlyOnce(actual, expected, label) {
  if (!Array.isArray(actual) || !Array.isArray(expected))
    throw new Error(`${label} requires identity arrays`);
  if (new Set(actual).size !== actual.length)
    throw new Error(`${label} contains duplicate identities`);
  const left = [...actual].toSorted(compareText);
  const right = [...expected].toSorted(compareText);
  if (
    left.length !== right.length ||
    left.some((identity, index) => identity !== right[index])
  )
    throw new Error(`${label} does not close exactly once`);
}

function assignments(schedule) {
  return schedule.threadSlots
    .flatMap((threadSlot) =>
      threadSlot.tests.map((shard) => ({
        sequence: shard.sequence,
        shardId: shard.id,
        nodeId: threadSlot.nodeId,
        threadSlotId: threadSlot.threadSlotId,
        adapterId: shard.adapterId,
        fingerprint: shard.fingerprint,
        laneId: shard.laneId,
        dependencies: shard.dependencies,
      }))
    )
    .toSorted((left, right) => left.sequence - right.sequence);
}

function assertCatalogBindings(catalog, schedule, scheduled) {
  if (schedule.applicationId !== catalog.applicationId)
    throw new Error('Distributed schedule belongs to another catalog');
  const tasks = new Map(catalog.tasks.map((task) => [task.taskId, task]));
  for (const shard of scheduled) {
    const task = tasks.get(shard.shardId);
    if (
      !task ||
      shard.adapterId !== task.adapterId ||
      shard.fingerprint !== task.taskId ||
      shard.laneId !== 'repository-native' ||
      shard.dependencies.length !== 0
    )
      throw new Error(
        `Distributed schedule changed catalog binding for ${shard.shardId}`
      );
  }
}

function rawShardIdentities(value) {
  if (!Array.isArray(value?.outcomes)) return [];
  return value.outcomes
    .map((outcome) => outcome?.shardId)
    .filter((shardId) => typeof shardId === 'string');
}

function identityDiagnostics(catalog, report) {
  const catalogIds = Array.isArray(catalog?.tasks)
    ? catalog.tasks
        .map((task) => task?.taskId)
        .filter((taskId) => typeof taskId === 'string')
    : [];
  const catalogSet = new Set(catalogIds);
  const outcomes = Array.isArray(report?.outcomes) ? report.outcomes : [];
  const reportIds = rawShardIdentities(report);
  const frequencies = new Map();
  for (const shardId of reportIds)
    frequencies.set(shardId, (frequencies.get(shardId) ?? 0) + 1);
  const attemptedShardIds = outcomes
    .filter(
      (outcome) => outcome?.status === 'passed' || outcome?.status === 'failed'
    )
    .map((outcome) => outcome?.shardId)
    .filter((shardId) => typeof shardId === 'string');
  const attemptedSet = new Set(attemptedShardIds);
  return {
    attemptedShardIds,
    unexecutedShardIds: catalogIds.filter(
      (shardId) => !attemptedSet.has(shardId)
    ),
    duplicateShardIds: [...frequencies]
      .filter(([, count]) => count > 1)
      .map(([shardId]) => shardId)
      .toSorted(compareText),
    foreignShardIds: [...new Set(reportIds)]
      .filter((shardId) => !catalogSet.has(shardId))
      .toSorted(compareText),
  };
}

function retained(value) {
  if (value === null || value === undefined) return null;
  try {
    return structuredClone(value);
  } catch {
    return { retained: false, reason: 'Evidence was not structured-cloneable' };
  }
}

function repositoryEvidence(state, completed) {
  const diagnostics = identityDiagnostics(state.catalog, state.report);
  const attemptedStepIndexes = new Set(
    state.localChecks.map(({ index }) => index)
  );
  const localStepIdentities = state.plan.steps
    .map((step, index) => ({ index, name: step.name, kind: step.kind }))
    .filter(({ kind }) => kind === 'check');
  return deepFreeze({
    schema: DISTRIBUTED_REPOSITORY_EVIDENCE_SCHEMA,
    completed,
    localChecks: retained(state.localChecks) ?? [],
    attemptedSteps: localStepIdentities.filter(({ index }) =>
      attemptedStepIndexes.has(index)
    ),
    unexecutedSteps: localStepIdentities.filter(
      ({ index }) => !attemptedStepIndexes.has(index)
    ),
    attemptedShardIds: completed
      ? state.catalog.tasks.map(({ taskId }) => taskId)
      : diagnostics.attemptedShardIds,
    unexecutedShardIds: completed ? [] : diagnostics.unexecutedShardIds,
    duplicateShardIds: completed ? [] : diagnostics.duplicateShardIds,
    foreignShardIds: completed ? [] : diagnostics.foreignShardIds,
    catalog: retained(state.catalog),
    schedule: retained(state.schedule),
    report: retained(state.report),
    shards: retained(state.shards) ?? [],
    onlineNodes: retained(state.onlineNodes) ?? [],
    offlineNodes: retained(state.offlineNodes) ?? [],
    applicationAdmission: retained(state.applicationAdmission),
    dependencyAdmission: retained(state.dependencyAdmission),
    resultReuse: false,
  });
}

function attachFailureEvidence(errorValue, state) {
  const error =
    errorValue instanceof Error
      ? errorValue
      : new Error('Distributed repository stage failed', {
          cause: errorValue,
        });
  if (state.applicationAdmission === null && error?.applicationAdmission)
    state.applicationAdmission = retained(error.applicationAdmission);
  if (state.dependencyAdmission === null && error?.dependencyAdmission)
    state.dependencyAdmission = retained(error.dependencyAdmission);
  const evidence = repositoryEvidence(state, false);
  try {
    error.repositoryEvidence = evidence;
    return error;
  } catch {
    return Object.assign(new Error(error.message, { cause: error }), {
      repositoryEvidence: evidence,
    });
  }
}

function validateCatalogCandidate(catalog, candidate) {
  plainObject(catalog, 'distributed repository catalog');
  if (!Array.isArray(catalog.tasks) || catalog.tasks.length === 0)
    throw new Error('Distributed repository catalog has zero tasks');
  createDistributedNativeTaskRequest(catalog, catalog.tasks[0]?.taskId);
  if (
    catalog.candidate.commitSha !== candidate.commit ||
    catalog.candidate.treeSha !== candidate.tree ||
    catalog.candidate.lockfileSha256 !== candidate.lockSha256
  )
    throw new Error(
      'Distributed catalog is not the exact committed repository candidate'
    );
}

/**
 * Execute local repository checks before delegating the test catalog. The
 * injected distributed callback owns transport and isolation; this compositor
 * owns candidate, identity, assignment, result, and accounting closure.
 */
export async function executeDistributedRepositoryStage(
  repositoryPlanValue,
  {
    candidate: candidateValue,
    executeLocalCheck,
    executeDistributedRun,
    signal,
  } = {}
) {
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error(
      'Distributed repository stage signal must be an AbortSignal'
    );
  for (const [callback, label] of [
    [executeLocalCheck, 'local check callback'],
    [executeDistributedRun, 'distributed run callback'],
  ])
    if (typeof callback !== 'function')
      throw new Error(`Distributed repository stage requires a ${label}`);

  const state = {
    plan: normalizePlan(repositoryPlanValue),
    localChecks: [],
    catalog: null,
    schedule: null,
    report: null,
    shards: [],
    onlineNodes: [],
    offlineNodes: [],
    applicationAdmission: null,
    dependencyAdmission: null,
  };
  const candidate = normalizeCandidate(candidateValue);

  try {
    signal?.throwIfAborted();
    for (const [index, step] of state.plan.steps.entries()) {
      if (step.kind !== 'check') continue;
      const record = { index, name: step.name, kind: step.kind, receipt: null };
      state.localChecks.push(record);
      let returned;
      try {
        returned = await executeLocalCheck(clone(step, 'local check step'), {
          index,
          signal,
        });
      } catch (error) {
        if (error?.receipt) record.receipt = retained(error.receipt);
        throw error;
      }
      record.receipt = retained(returned);
      record.receipt = normalizeLocalReceipt(returned, step);
      signal?.throwIfAborted();
    }

    const distributed = clone(
      plainObject(
        await executeDistributedRun({
          candidate,
          repositoryPlan: state.plan,
          signal,
        }),
        'distributed repository run'
      ),
      'distributed repository run'
    );
    state.catalog = distributed.catalog ?? null;
    state.schedule = distributed.schedule ?? null;
    state.report = distributed.runReport ?? null;
    state.onlineNodes = distributed.onlineNodes ?? [];
    state.offlineNodes = distributed.offlineNodes ?? [];
    state.applicationAdmission = distributed.applicationAdmission ?? null;
    state.dependencyAdmission = distributed.dependencyAdmission ?? null;

    validateCatalogCandidate(state.catalog, candidate);
    const expectations = scheduleExpectations(state.schedule, candidate);
    state.schedule = verifyDistributedAdaptiveSchedule(
      state.schedule,
      expectations
    );
    const scheduled = assignments(state.schedule);
    const catalogIds = state.catalog.tasks.map(({ taskId }) => taskId);
    requireExactlyOnce(
      scheduled.map(({ shardId }) => shardId),
      catalogIds,
      'Distributed schedule shard closure'
    );
    assertCatalogBindings(state.catalog, state.schedule, scheduled);

    state.report = verifyDistributedShardRun(state.report, {
      schedule: state.schedule,
      expectations,
      expectedReportSha256: digest(
        state.report?.reportSha256,
        'distributed repository report identity'
      ),
    });
    requireExactlyOnce(
      state.report.outcomes.map(({ shardId }) => shardId),
      catalogIds,
      'Distributed report shard closure'
    );

    const outcomeById = new Map(
      state.report.outcomes.map((outcome) => [outcome.shardId, outcome])
    );
    const totals = new Map();
    for (const assignment of scheduled) {
      const outcome = outcomeById.get(assignment.shardId);
      if (
        !outcome ||
        outcome.nodeId !== assignment.nodeId ||
        outcome.threadSlotId !== assignment.threadSlotId ||
        outcome.sequence !== assignment.sequence
      )
        throw new Error(
          `Distributed shard assignment changed: ${assignment.shardId}`
        );
      let result = retained(outcome.result);
      const shardEvidence = {
        shardId: assignment.shardId,
        nodeId: assignment.nodeId,
        threadSlotId: assignment.threadSlotId,
        sequence: assignment.sequence,
        status: outcome.status,
        wallMs: outcome.wallMs,
        failureCode: outcome.failureCode,
        result,
      };
      state.shards.push(shardEvidence);
      if (outcome.status === 'passed') {
        result = verifyDistributedNativeTaskResult(outcome.result, {
          catalog: state.catalog,
          expectedCatalogSha256: state.catalog.catalogSha256,
          taskId: assignment.shardId,
        });
        const counts = result.totals[assignment.adapterId];
        const prior = totals.get(assignment.adapterId) ?? {
          active: 0,
          total: 0,
        };
        totals.set(assignment.adapterId, {
          active: addCount(
            prior.active,
            counts.active,
            `${assignment.adapterId} active count`
          ),
          total: addCount(
            prior.total,
            counts.total,
            `${assignment.adapterId} total count`
          ),
        });
        shardEvidence.result = result;
      }
      deepFreeze(shardEvidence);
    }

    if (
      state.report.status !== 'passed' ||
      state.shards.some(({ status }) => status !== 'passed')
    )
      throw new Error('Distributed repository shard run is incomplete');

    const aggregate = [...totals.values()].reduce(
      (sum, value) => ({
        active: addCount(sum.active, value.active, 'repository active count'),
        total: addCount(sum.total, value.total, 'repository total count'),
      }),
      { active: 0, total: 0 }
    );
    if (aggregate.active < 1 || aggregate.active > aggregate.total)
      throw new Error('Distributed repository result has invalid case totals');
    const repositoryEvidenceValue = repositoryEvidence(state, true);
    return deepFreeze({
      status: 'passed',
      cases: {
        passed: aggregate.active,
        failed: 0,
        skipped: aggregate.total - aggregate.active,
      },
      caseLedgers: [],
      totals: Object.fromEntries(
        [...totals.entries()].toSorted(([left], [right]) =>
          compareText(left, right)
        )
      ),
      commands: state.localChecks.map(({ receipt }) => receipt),
      failures: [],
      repositoryEvidence: repositoryEvidenceValue,
      resultReuse: false,
    });
  } catch (error) {
    throw attachFailureEvidence(error, state);
  }
}
