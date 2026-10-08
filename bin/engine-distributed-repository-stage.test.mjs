// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_REPOSITORY_EVIDENCE_SCHEMA,
  executeDistributedRepositoryStage,
} from '../tools/validation-engine/runtime/distributed-repository-stage.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { executeDistributedShardSchedule } from '../tools/validation-engine/runtime/distributed-shard-executor.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from './distributed-native-case-ledger-test-fixture.mjs';

const APPLICATION_ID = 'seerrng';

function applicationAdmission() {
  const controller = {
    nodeId: 'controller',
    nodeNumber: 'controller',
    computerName: "John's laptop",
  };
  return {
    schema: 'seerrng-distributed-linux-application-admission/v1',
    applicationId: APPLICATION_ID,
    availableNodes: [controller],
    usableNodes: [controller],
    excludedNodes: [],
  };
}

function dependencyAdmission() {
  return {
    requirements: [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ],
    availableNodes: [
      {
        nodeId: 'controller',
        nodeNumber: 'controller',
        computerName: "John's laptop",
      },
      {
        nodeId: 'node-02',
        nodeNumber: '02',
        computerName: 'Outdated node',
      },
    ],
    usableNodes: [
      {
        nodeId: 'controller',
        nodeNumber: 'controller',
        computerName: "John's laptop",
      },
    ],
    excludedNodes: [
      {
        nodeId: 'node-02',
        nodeNumber: '02',
        computerName: 'Outdated node',
        missing: [{ name: 'pnpm', version: '10.24.0' }],
        mismatched: [
          {
            name: 'node',
            requiredVersion: '24.21.0',
            actualVersion: '22.0.0',
          },
        ],
      },
    ],
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stageCandidate(overrides = {}) {
  return {
    repository: 'JohnCronk79/seerrng',
    commit: sha256('commit').slice(0, 40),
    tree: sha256('tree').slice(0, 40),
    lockSha256: sha256('lockfile'),
    sourceSha256: sha256('source'),
    ...overrides,
  };
}

function nativeCandidate(candidate) {
  const core = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: candidate.commit,
    treeSha: candidate.tree,
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: candidate.lockSha256,
  };
  return {
    ...core,
    candidateSha256: canonicalJsonSha256(core),
  };
}

function task(adapterId, files) {
  return {
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({
      applicationId: APPLICATION_ID,
      adapterId,
      files,
    }),
    adapterId,
    files,
  };
}

function catalog(candidate) {
  const tasks = [
    task('node-js', ['bin/focused-a.test.mjs']),
    task('node-js', ['bin/focused-b.test.mjs']),
    task('tooling', [
      'bin/focused-tool-a.test.mjs',
      'bin/focused-tool-b.test.mjs',
    ]),
  ].toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: APPLICATION_ID,
    platform: 'linux',
    candidate: nativeCandidate(candidate),
    inventorySha256: sha256('inventory'),
    tasks,
  };
  return {
    ...core,
    catalogSha256: canonicalJsonSha256(core),
  };
}

function schedule(catalogValue, candidate) {
  return createDistributedAdaptiveSchedule({
    tests: catalogValue.tasks.map((entry) => ({
      id: entry.taskId,
      fingerprint: entry.taskId,
      applicationId: APPLICATION_ID,
      laneId: 'repository-native',
      adapterId: entry.adapterId,
      repositoryIdentitySha256: candidate.sourceSha256,
      dependencies: [],
    })),
    nodes: [
      {
        id: 'controller',
        scope: {
          applicationId: APPLICATION_ID,
          laneId: 'repository-native',
          adapterId: 'native-repository',
          repositoryIdentitySha256: candidate.sourceSha256,
          environment: 'linux',
          nodeId: 'controller',
          selectedN: 2,
        },
        adapterIds: ['node-js', 'tooling'],
        effectiveLogicalThreads: 2,
        concurrency: { mode: 'explicit', threads: 2 },
        runsOnControllerHost: true,
        localInteractiveReserveThreads: 0,
      },
    ],
    profile: createAdaptiveTimingProfile(),
  });
}

function nativeReceipt(stdout = 'ok\n') {
  const stderr = '';
  return {
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    wallMs: 2,
    stdout,
    stderr,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
  };
}

function nativeResult(catalogValue, taskId, overrides = {}) {
  const selected = catalogValue.tasks.find((entry) => entry.taskId === taskId);
  assert.ok(selected);
  const defaultCounts =
    selected.adapterId === 'tooling'
      ? { active: 3, total: 4 }
      : selected.files[0].includes('-a.')
        ? { active: 2, total: 3 }
        : { active: 1, total: 1 };
  const effectiveCounts =
    overrides.totals?.[selected.adapterId] ?? defaultCounts;
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: APPLICATION_ID,
    candidateSha256: catalogValue.candidate.candidateSha256,
    catalogSha256: catalogValue.catalogSha256,
    taskId,
    adapterId: selected.adapterId,
    files: [...selected.files],
    status: 'passed',
    wallMs: 3,
    totals: { [selected.adapterId]: defaultCounts },
    caseLedger: createNativeCaseLedgerFixture(selected, effectiveCounts),
    receipt: nativeReceipt(
      createNativeCaseReportFixture(selected, effectiveCounts)
    ),
    ...overrides,
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

function expectations(scheduleValue) {
  return {
    expectedApplicationId: scheduleValue.applicationId,
    expectedProfileSha256: scheduleValue.profileSha256,
    expectedRepositoryIdentitySha256: scheduleValue.repositoryIdentitySha256,
    expectedScheduleSha256: scheduleValue.scheduleSha256,
    expectedTestInventorySha256: scheduleValue.testInventorySha256,
  };
}

async function distributedFixture(
  candidate,
  { failTaskId = null, resultFactory = nativeResult } = {}
) {
  const catalogValue = catalog(candidate);
  const scheduleValue = schedule(catalogValue, candidate);
  const runReport = await executeDistributedShardSchedule(scheduleValue, {
    expectations: expectations(scheduleValue),
    runId: 'repository-stage-run',
    dispatch: async ({ shard }) => {
      if (shard.id === failTaskId)
        throw Object.assign(new Error('focused shard failure'), {
          code: 'ERR_FOCUSED_SHARD',
        });
      return {
        shardId: shard.id,
        result: resultFactory(catalogValue, shard.id),
      };
    },
  });
  return {
    catalog: catalogValue,
    schedule: scheduleValue,
    runReport,
    onlineNodes: [{ nodeId: 'controller' }],
    offlineNodes: [],
    applicationAdmission: applicationAdmission(),
    dependencyAdmission: dependencyAdmission(),
  };
}

function repositoryPlan() {
  return {
    root: '/focused/repository',
    inventory: [{ file: 'bin/focused-a.test.mjs', selected: true }],
    steps: [
      { name: 'Formatting', kind: 'check', command: 'node', args: [] },
      {
        name: 'Node JavaScript 1/1',
        kind: 'node-js',
        command: 'node',
        args: [],
      },
      { name: 'Lint', kind: 'check', command: 'node', args: [] },
      { name: 'Types', kind: 'check', command: 'node', args: [] },
      {
        name: 'Platform-aware tooling',
        kind: 'tooling',
        command: 'node',
        args: [],
      },
    ],
  };
}

function localReceipt(step) {
  return {
    id: step.name,
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
    },
  };
}

function options(candidate, distributed, overrides = {}) {
  return {
    candidate,
    executeLocalCheck: async (step) => localReceipt(step),
    executeDistributedRun: async () => distributed,
    ...overrides,
  };
}

function rehashReport(report, mutate) {
  const changed = structuredClone(report);
  mutate(changed);
  const core = { ...changed };
  delete core.reportSha256;
  changed.reportSha256 = canonicalJsonSha256(core);
  return changed;
}

test('runs local checks in order before reconciling one closed distributed run', async () => {
  const candidate = stageCandidate();
  const distributed = await distributedFixture(candidate);
  const events = [];
  const result = await executeDistributedRepositoryStage(repositoryPlan(), {
    candidate,
    executeLocalCheck: async (step) => {
      events.push(`local:${step.name}`);
      return localReceipt(step);
    },
    executeDistributedRun: async ({
      candidate: selected,
      repositoryPlan: plan,
    }) => {
      events.push('distributed');
      assert.equal(selected.sourceSha256, candidate.sourceSha256);
      assert.equal(plan.steps.length, 5);
      return distributed;
    },
  });

  assert.deepEqual(events, [
    'local:Formatting',
    'local:Lint',
    'local:Types',
    'distributed',
  ]);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.cases, { passed: 6, failed: 0, skipped: 2 });
  assert.deepEqual(result.totals, {
    'node-js': { active: 3, total: 4 },
    tooling: { active: 3, total: 4 },
  });
  assert.equal(result.commands.length, 3);
  assert.deepEqual(result.failures, []);
  assert.equal(result.resultReuse, false);
  assert.equal(
    result.repositoryEvidence.schema,
    DISTRIBUTED_REPOSITORY_EVIDENCE_SCHEMA
  );
  assert.equal(
    result.repositoryEvidence.schema,
    'seerrng-distributed-repository-evidence/v3'
  );
  assert.equal(result.repositoryEvidence.completed, true);
  assert.equal(result.repositoryEvidence.shards.length, 3);
  assert.deepEqual(result.repositoryEvidence.unexecutedShardIds, []);
  assert.deepEqual(
    result.repositoryEvidence.applicationAdmission,
    distributed.applicationAdmission
  );
  assert.deepEqual(
    result.repositoryEvidence.dependencyAdmission,
    distributed.dependencyAdmission
  );
  assert.equal(Object.isFrozen(result), true);
});

test('a local check failure launches zero shards and retains exact progress', async () => {
  const candidate = stageCandidate();
  let distributedCalls = 0;
  const seen = [];
  await assert.rejects(
    executeDistributedRepositoryStage(repositoryPlan(), {
      candidate,
      executeLocalCheck: async (step) => {
        seen.push(step.name);
        const receipt = localReceipt(step);
        if (step.name === 'Lint') {
          receipt.status = 'failed';
          receipt.exitCode = 1;
        }
        return receipt;
      },
      executeDistributedRun: async () => {
        distributedCalls += 1;
        return distributedFixture(candidate);
      },
    }),
    (error) => {
      assert.match(error.message, /did not pass: Lint/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal('cases' in error.repositoryEvidence, false);
      assert.deepEqual(
        error.repositoryEvidence.attemptedSteps.map(({ name }) => name),
        ['Formatting', 'Lint']
      );
      assert.deepEqual(
        error.repositoryEvidence.unexecutedSteps.map(({ name }) => name),
        ['Types']
      );
      assert.equal(error.repositoryEvidence.localChecks[1].receipt.exitCode, 1);
      assert.equal(error.repositoryEvidence.catalog, null);
      return true;
    }
  );
  assert.deepEqual(seen, ['Formatting', 'Lint']);
  assert.equal(distributedCalls, 0);
});

test('retains application and dependency admission when the distributed callback fails', async () => {
  const candidate = stageCandidate();
  const applicationEvidence = applicationAdmission();
  const dependencyEvidence = dependencyAdmission();
  await assert.rejects(
    executeDistributedRepositoryStage(repositoryPlan(), {
      candidate,
      executeLocalCheck: async (step) => localReceipt(step),
      executeDistributedRun: async () => {
        throw Object.assign(new Error('focused controller failure'), {
          applicationAdmission: applicationEvidence,
          dependencyAdmission: dependencyEvidence,
        });
      },
    }),
    (error) => {
      assert.match(error.message, /focused controller failure/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.deepEqual(
        error.repositoryEvidence.applicationAdmission,
        applicationEvidence
      );
      assert.deepEqual(
        error.repositoryEvidence.dependencyAdmission,
        dependencyEvidence
      );
      assert.deepEqual(
        error.repositoryEvidence.dependencyAdmission.excludedNodes[0].missing,
        [{ name: 'pnpm', version: '10.24.0' }]
      );
      assert.deepEqual(
        error.repositoryEvidence.dependencyAdmission.excludedNodes[0]
          .mismatched,
        [
          {
            name: 'node',
            requiredVersion: '24.21.0',
            actualVersion: '22.0.0',
          },
        ]
      );
      return true;
    }
  );
});

test('rejects a catalog that is not the exact staged commit, tree, and lockfile', async () => {
  const catalogCandidate = stageCandidate();
  const distributed = await distributedFixture(catalogCandidate);
  const selected = stageCandidate({
    commit: sha256('another-commit').slice(0, 40),
  });
  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(selected, distributed)
    ),
    (error) => {
      assert.match(error.message, /exact committed repository candidate/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(
        error.repositoryEvidence.catalog.catalogSha256,
        distributed.catalog.catalogSha256
      );
      return true;
    }
  );
});

test('binds the adaptive schedule to the staged source identity', async () => {
  const scheduledCandidate = stageCandidate();
  const distributed = await distributedFixture(scheduledCandidate);
  const selected = stageCandidate({ sourceSha256: sha256('another-source') });
  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(selected, distributed)
    ),
    (error) => {
      assert.match(error.message, /belongs to another repository/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(
        error.repositoryEvidence.schedule.repositoryIdentitySha256,
        scheduledCandidate.sourceSha256
      );
      return true;
    }
  );
});

test('rejects a report that changes a sealed node or thread-slot assignment', async () => {
  const candidate = stageCandidate();
  const distributed = await distributedFixture(candidate);
  const changed = rehashReport(distributed.runReport, (report) => {
    report.outcomes[0].threadSlotId = 'controller.thread-99';
  });
  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(candidate, { ...distributed, runReport: changed })
    ),
    (error) => {
      assert.match(error.message, /sealed assignment/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(
        error.repositoryEvidence.report.outcomes[0].threadSlotId,
        'controller.thread-99'
      );
      return true;
    }
  );
});

test('failed and not-run shards produce incomplete evidence without case counts', async () => {
  const candidate = stageCandidate();
  const catalogValue = catalog(candidate);
  const distributed = await distributedFixture(candidate, {
    failTaskId: catalogValue.tasks[0].taskId,
  });
  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(candidate, distributed)
    ),
    (error) => {
      const evidence = error.repositoryEvidence;
      assert.match(error.message, /shard run is incomplete/);
      assert.equal(evidence.completed, false);
      assert.equal('cases' in evidence, false);
      assert.equal('totals' in evidence, false);
      assert.equal(
        evidence.shards.some(({ status }) => status === 'failed'),
        true
      );
      assert.equal(evidence.unexecutedShardIds.length > 0, true);
      assert.equal(evidence.report.status, 'incomplete');
      return true;
    }
  );
});

test('missing, duplicate, and foreign report identities fail closed with diagnostics', async (t) => {
  const candidate = stageCandidate();
  const distributed = await distributedFixture(candidate);
  const first = distributed.runReport.outcomes[0].shardId;
  const second = distributed.runReport.outcomes[1].shardId;
  const cases = [
    {
      name: 'missing',
      report: rehashReport(distributed.runReport, (report) => {
        report.outcomes.pop();
      }),
      check: (evidence) => assert.equal(evidence.unexecutedShardIds.length, 1),
    },
    {
      name: 'duplicate',
      report: rehashReport(distributed.runReport, (report) => {
        report.outcomes[1].shardId = first;
      }),
      check: (evidence) => {
        assert.deepEqual(evidence.duplicateShardIds, [first]);
        assert.equal(evidence.unexecutedShardIds.includes(second), true);
      },
    },
    {
      name: 'foreign',
      report: rehashReport(distributed.runReport, (report) => {
        report.outcomes[1].shardId = 'f'.repeat(64);
      }),
      check: (evidence) => {
        assert.deepEqual(evidence.foreignShardIds, ['f'.repeat(64)]);
        assert.equal(evidence.unexecutedShardIds.includes(second), true);
      },
    },
  ];

  for (const entry of cases)
    await t.test(entry.name, async () => {
      await assert.rejects(
        executeDistributedRepositoryStage(
          repositoryPlan(),
          options(candidate, { ...distributed, runReport: entry.report })
        ),
        (error) => {
          assert.equal(error.repositoryEvidence.completed, false);
          assert.equal('cases' in error.repositoryEvidence, false);
          entry.check(error.repositoryEvidence);
          return true;
        }
      );
    });
});

test('every passing shard result is reverified before any totals are admitted', async () => {
  const candidate = stageCandidate();
  let invalidated = false;
  const distributed = await distributedFixture(candidate, {
    resultFactory: (catalogValue, taskId) => {
      const result = nativeResult(catalogValue, taskId);
      if (!invalidated) {
        invalidated = true;
        result.totals[result.adapterId] = { active: 0, total: 0 };
        const core = { ...result };
        delete core.resultSha256;
        result.resultSha256 = canonicalJsonSha256(core);
      }
      return result;
    },
  });

  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(candidate, distributed)
    ),
    (error) => {
      assert.match(error.message, /active test coverage/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal('cases' in error.repositoryEvidence, false);
      assert.equal(error.repositoryEvidence.report.status, 'passed');
      assert.equal(error.repositoryEvidence.shards.length >= 1, true);
      return true;
    }
  );
});

test('complete repository evidence still requires active coverage when every task is explicitly skipped', async () => {
  const candidate = stageCandidate();
  const distributed = await distributedFixture(candidate, {
    resultFactory: (catalogValue, taskId) => {
      const selected = catalogValue.tasks.find(
        (entry) => entry.taskId === taskId
      );
      assert.ok(selected);
      const original = nativeResult(catalogValue, taskId);
      const total = original.totals[selected.adapterId].total;
      return nativeResult(catalogValue, taskId, {
        totals: { [selected.adapterId]: { active: 0, total } },
        caseLedger: createNativeCaseLedgerFixture(selected, {
          active: 0,
          total,
        }),
      });
    },
  });

  await assert.rejects(
    executeDistributedRepositoryStage(
      repositoryPlan(),
      options(candidate, distributed)
    ),
    (error) => {
      assert.match(error.message, /invalid case totals/);
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(error.repositoryEvidence.report.status, 'passed');
      assert.equal(
        error.repositoryEvidence.shards.every(
          ({ result }) => result.caseLedger.counts.active === 0
        ),
        true
      );
      return true;
    }
  );
});

test('repository evidence accepts one explicit-skip task when the complete run retains active coverage', async () => {
  const candidate = stageCandidate();
  let skippedTaskId;
  const distributed = await distributedFixture(candidate, {
    resultFactory: (catalogValue, taskId) => {
      skippedTaskId ??= taskId;
      if (taskId !== skippedTaskId) return nativeResult(catalogValue, taskId);
      const selected = catalogValue.tasks.find(
        (entry) => entry.taskId === taskId
      );
      assert.ok(selected);
      const original = nativeResult(catalogValue, taskId);
      const total = original.totals[selected.adapterId].total;
      return nativeResult(catalogValue, taskId, {
        totals: { [selected.adapterId]: { active: 0, total } },
        caseLedger: createNativeCaseLedgerFixture(selected, {
          active: 0,
          total,
        }),
      });
    },
  });

  const result = await executeDistributedRepositoryStage(
    repositoryPlan(),
    options(candidate, distributed)
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.cases.passed > 0, true);
  assert.equal(result.cases.skipped > 0, true);
  assert.equal(
    result.repositoryEvidence.shards.some(
      ({ result: taskResult }) => taskResult.caseLedger.counts.active === 0
    ),
    true
  );
});
