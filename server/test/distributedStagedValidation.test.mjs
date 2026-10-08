// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { runDistributedLinuxController } from '../../tools/validation-engine/runtime/distributed-linux-controller-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { createControllerConfig } from '../../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA } from '../../tools/validation-engine/runtime/distributed-linux-node-attestation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
  DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
} from '../../tools/validation-engine/runtime/distributed-linux-node-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
} from '../../tools/validation-engine/runtime/distributed-node-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { executeDistributedShardSchedule } from '../../tools/validation-engine/runtime/distributed-shard-executor.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { executeDistributedStagedValidation } from '../../tools/validation-engine/runtime/distributed-staged-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { canonicalJsonSha256 } from '../../tools/validation-engine/runtime/run-scoped-ledger.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { createStagedValidation } from '../../tools/validation-engine/runtime/staged-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from '../../bin/distributed-native-case-ledger-test-fixture.mjs';

const APPLICATION_ID = 'seerrng';
const APPLICATION_ROOT = resolve('focused-distributed-staged-application');
const SHARED_KEY = 'a'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function candidate() {
  return {
    repository: 'JohnCronk79/seerrng',
    commit: sha256('commit').slice(0, 40),
    tree: sha256('tree').slice(0, 40),
    lockSha256: sha256('lockfile'),
    sourceSha256: sha256('source'),
  };
}

function repositoryPlan() {
  return {
    root: APPLICATION_ROOT,
    inventory: [{ file: 'bin/focused.test.mjs', selected: true }],
    steps: [
      { name: 'Formatting', kind: 'check', command: 'node', args: [] },
      {
        name: 'Node JavaScript 1/1',
        kind: 'node-js',
        command: 'node',
        args: [],
      },
      { name: 'Lint', kind: 'check', command: 'node', args: [] },
    ],
  };
}

function binding(selectedCandidate = candidate()) {
  return createStagedValidation({
    runId: 'distributed-stage-integration',
    candidate: selectedCandidate,
    executionEnvironmentSha256: sha256('environment'),
    capacity: { configuredWorkers: 2, effectiveLogicalCpus: 2 },
    repositoryPlan: repositoryPlan(),
    codeqlPlan: {
      sourceIdentity: { sha256: selectedCandidate.sourceSha256 },
      artifacts: [],
      steps: [{ id: 'codeql-fixture' }],
    },
    buildBrowserPlan: {
      candidate: selectedCandidate,
      configuredWorkers: 2,
      cypressSpecs: ['cypress/e2e/focused.cy.ts'],
      playwrightSpecs: ['playwright/focused.spec.ts'],
      build: [{ id: 'build-fixture' }],
    },
  });
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

function stagedOptions({ events = [], isolateOperation } = {}) {
  return {
    executeRepository: async () => {
      events.push('original-repository');
      throw new Error('Original repository executor must be replaced');
    },
    withRepositoryIsolation:
      isolateOperation ??
      (async (operation, admission) => {
        events.push(`isolate:${admission.unitId}:enter`);
        const result = await operation();
        events.push(`isolate:${admission.unitId}:exit`);
        return result;
      }),
    run: async (command) => {
      events.push(`later:${command.id}`);
      throw new Error('Focused later-stage failure');
    },
    readFile: async () => '',
    writeArtifact: async () => {},
    verifySource: async () => {
      events.push('verify-source');
    },
  };
}

function nativeCandidate(selectedCandidate) {
  const core = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: selectedCandidate.commit,
    treeSha: selectedCandidate.tree,
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: selectedCandidate.lockSha256,
  };
  return { ...core, candidateSha256: canonicalJsonSha256(core) };
}

function nativeReceipt(task, counts) {
  const stdout = createNativeCaseReportFixture(task, counts);
  const stderr = '';
  return {
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    wallMs: 1,
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

function controllerCatalog(selectedCandidate, taskCount = 4) {
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const files = [
      `bin/focused-${String(index + 1).padStart(2, '0')}.test.mjs`,
    ];
    return {
      schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
      taskId: distributedNativeTaskId({
        applicationId: APPLICATION_ID,
        adapterId: 'node-js',
        files,
      }),
      adapterId: 'node-js',
      files,
    };
  }).toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: APPLICATION_ID,
    platform: 'linux',
    candidate: nativeCandidate(selectedCandidate),
    inventorySha256: sha256('controller-inventory'),
    tasks,
  };
  return { ...core, catalogSha256: canonicalJsonSha256(core) };
}

function passingNativeTaskResult(catalog, taskId) {
  const task = catalog.tasks.find((entry) => entry.taskId === taskId);
  assert.ok(task);
  const counts = { active: 1, total: 1 };
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: APPLICATION_ID,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    taskId,
    adapterId: task.adapterId,
    files: [...task.files],
    caseLedger: createNativeCaseLedgerFixture(task, counts),
    status: 'passed',
    wallMs: 1,
    totals: { [task.adapterId]: counts },
    receipt: nativeReceipt(task, counts),
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

async function distributedRun(selectedCandidate) {
  const nativeTask = {
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({
      applicationId: APPLICATION_ID,
      adapterId: 'node-js',
      files: ['bin/focused.test.mjs'],
    }),
    adapterId: 'node-js',
    files: ['bin/focused.test.mjs'],
  };
  const catalogCore = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: APPLICATION_ID,
    platform: 'linux',
    candidate: nativeCandidate(selectedCandidate),
    inventorySha256: sha256('inventory'),
    tasks: [nativeTask],
  };
  const catalog = {
    ...catalogCore,
    catalogSha256: canonicalJsonSha256(catalogCore),
  };
  const schedule = createDistributedAdaptiveSchedule({
    tests: [
      {
        id: nativeTask.taskId,
        fingerprint: nativeTask.taskId,
        applicationId: APPLICATION_ID,
        laneId: 'repository-native',
        adapterId: nativeTask.adapterId,
        repositoryIdentitySha256: selectedCandidate.sourceSha256,
        dependencies: [],
      },
    ],
    nodes: [
      {
        id: 'controller',
        scope: {
          applicationId: APPLICATION_ID,
          laneId: 'repository-native',
          adapterId: 'native-repository',
          repositoryIdentitySha256: selectedCandidate.sourceSha256,
          environment: 'linux',
          nodeId: 'controller',
          selectedN: 1,
        },
        adapterIds: [nativeTask.adapterId],
        effectiveLogicalThreads: 1,
        concurrency: { mode: 'explicit', threads: 1 },
        runsOnControllerHost: true,
        localInteractiveReserveThreads: 0,
      },
    ],
    profile: createAdaptiveTimingProfile(),
  });
  const expectations = {
    expectedApplicationId: schedule.applicationId,
    expectedProfileSha256: schedule.profileSha256,
    expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
    expectedScheduleSha256: schedule.scheduleSha256,
    expectedTestInventorySha256: schedule.testInventorySha256,
  };
  const runReport = await executeDistributedShardSchedule(schedule, {
    expectations,
    runId: 'distributed-stage-run',
    dispatch: async ({ shard }) => {
      const counts = { active: 1, total: 1 };
      const resultCore = {
        schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
        applicationId: APPLICATION_ID,
        candidateSha256: catalog.candidate.candidateSha256,
        catalogSha256: catalog.catalogSha256,
        taskId: shard.id,
        adapterId: nativeTask.adapterId,
        files: [...nativeTask.files],
        caseLedger: createNativeCaseLedgerFixture(nativeTask, counts),
        status: 'passed',
        wallMs: 1,
        totals: { [nativeTask.adapterId]: counts },
        receipt: nativeReceipt(nativeTask, counts),
      };
      return {
        shardId: shard.id,
        result: {
          ...resultCore,
          resultSha256: canonicalJsonSha256(resultCore),
        },
      };
    },
  });
  return {
    catalog,
    schedule,
    runReport,
    onlineNodes: [{ nodeId: 'controller' }],
    offlineNodes: [],
  };
}

test('replaces only repository execution and isolates each local check outside the distributed callback', async () => {
  const selectedCandidate = candidate();
  const stagedBinding = binding(selectedCandidate);
  const events = [];
  let isolated = false;
  const options = stagedOptions({
    events,
    isolateOperation: async (operation, admission) => {
      assert.equal(isolated, false);
      assert.deepEqual(admission.candidate, selectedCandidate);
      assert.equal(admission.unitId, 'native-repository');
      isolated = true;
      events.push('isolate:enter');
      try {
        return await operation();
      } finally {
        isolated = false;
        events.push('isolate:exit');
      }
    },
  });
  const result = await executeDistributedStagedValidation(
    stagedBinding,
    options,
    {
      executeLocalCheck: async (step, { index }) => {
        assert.equal(isolated, true);
        events.push(`local:${index}:${step.name}`);
        return localReceipt(step);
      },
      executeDistributedRun: async ({
        candidate: runCandidate,
        repositoryPlan: plan,
      }) => {
        assert.equal(isolated, false);
        assert.deepEqual(runCandidate, selectedCandidate);
        assert.equal(plan.steps.length, 3);
        events.push('distributed');
        return distributedRun(selectedCandidate);
      },
    }
  );

  assert.equal(isolated, false);
  assert.equal(events.includes('original-repository'), false);
  assert.deepEqual(
    events.filter((entry) => /^(?:isolate|local|distributed)/.test(entry)),
    [
      'isolate:enter',
      'local:0:Formatting',
      'isolate:exit',
      'isolate:enter',
      'local:2:Lint',
      'isolate:exit',
      'distributed',
    ]
  );
  assert.equal(
    result.nativeEvidence['native-repository'].repositoryEvidence.completed,
    true
  );
  assert.deepEqual(result.nativeEvidence['native-repository'].cases, {
    passed: 1,
    failed: 0,
    skipped: 0,
  });
});

test('connects the staged gate to the Linux controller without widening repository isolation', async () => {
  const selectedCandidate = candidate();
  const stagedBinding = binding(selectedCandidate);
  assert.deepEqual(
    stagedBinding.plan.lanes.map(({ id, after }) => ({ id, after })),
    [
      { id: 'repository', after: [] },
      { id: 'codeql', after: ['repository'] },
      { id: 'build', after: ['codeql'] },
      { id: 'browser', after: ['build'] },
    ]
  );

  const catalog = controllerCatalog(selectedCandidate);
  const remote = {
    nodeNumber: '01',
    computerName: 'Focused remote node',
    ipAddress: '127.0.0.1',
    port: 49_101,
    cpuName: 'Focused Remote CPU',
    availableThreads: 2,
    threads: 'n',
    minimumThreadCount: 1,
  };
  const config = createControllerConfig({
    global: {
      githubUsername: 'JohnCronk79',
      computerName: "John's laptop",
      ipAddress: '127.0.0.2',
      port: 49_100,
      cpuName: 'Focused Controller CPU',
      availableThreads: 2,
      threads: 'n',
      minimumThreadCount: 1,
    },
    nodes: [remote],
    sharedAuthenticationKey: SHARED_KEY,
  });
  const attestationCore = {
    schema: DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA,
    activeNodeConfigSha256: sha256('focused-active-node-config'),
    runnerClosureSha256: sha256('focused-runner-closure'),
    nodeExecutableSha256: sha256('focused-node-executable'),
    nodeVersion: 'v24.21.0',
    platform: 'linux',
    architecture: 'x64',
  };
  const nodeAttestation = Object.freeze({
    ...attestationCore,
    attestationSha256: canonicalJsonSha256(attestationCore),
  });
  const isolation = new AsyncLocalStorage();
  const events = [];
  const isolationAdmissions = [];
  const isolateOperation = async (operation, admission) => {
    assert.equal(isolation.getStore(), undefined);
    isolationAdmissions.push(admission);
    events.push('isolate:enter');
    return isolation.run(admission, async () => {
      try {
        return await operation();
      } finally {
        events.push('isolate:exit');
      }
    });
  };
  const options = stagedOptions({ events, isolateOperation });
  let catalogDiscoveryCalls = 0;
  let requestSequence = 0;
  let probeCalls = 0;
  let localTaskCalls = 0;
  let remoteTaskCalls = 0;

  const result = await executeDistributedStagedValidation(
    stagedBinding,
    options,
    {
      executeLocalCheck: async (step, { index }) => {
        assert.ok(isolation.getStore());
        events.push(`local-check:${index}:${step.name}`);
        return localReceipt(step);
      },
      executeDistributedRun: async ({
        candidate: runCandidate,
        repositoryPlan: plan,
        signal,
      }) => {
        assert.equal(isolation.getStore(), undefined);
        events.push('distributed:start');
        const controllerResult = await runDistributedLinuxController({
          config,
          applicationId: APPLICATION_ID,
          applicationRoot: plan.root,
          repositoryIdentitySha256: runCandidate.sourceSha256,
          timingProfile: createAdaptiveTimingProfile(),
          runId: 'distributed-stage-controller-run',
          signal,
          profileDetector: () => {
            assert.equal(isolation.getStore(), undefined);
            return {
              cpuName: 'Focused Controller CPU',
              availableThreads: 2,
            };
          },
          catalogDiscovery: (root, discoveryOptions) => {
            assert.equal(isolation.getStore(), undefined);
            assert.equal(root, APPLICATION_ROOT);
            assert.deepEqual(discoveryOptions, {
              applicationId: APPLICATION_ID,
            });
            catalogDiscoveryCalls += 1;
            events.push('catalog');
            return catalog;
          },
          localTaskExecutor: async ({ request, signal: taskSignal }) => {
            assert.equal(isolation.getStore(), undefined);
            return isolateOperation(
              async () => {
                assert.ok(isolation.getStore());
                localTaskCalls += 1;
                events.push(`local-task:${request.taskId}`);
                return passingNativeTaskResult(catalog, request.taskId);
              },
              {
                candidate: runCandidate,
                unitId: 'native-repository',
                signal: taskSignal,
              }
            );
          },
          transportRequester: async (request) => {
            assert.equal(isolation.getStore(), undefined);
            if (request.kind === DISTRIBUTED_NODE_PROBE_KIND) {
              probeCalls += 1;
              events.push('remote:probe');
              return {
                body: {
                  schema: DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
                  requestId: request.requestId,
                  attestation: nodeAttestation,
                  node: {
                    nodeId: 'node-01',
                    nodeNumber: remote.nodeNumber,
                    computerName: remote.computerName,
                    ipAddress: remote.ipAddress,
                    port: remote.port,
                    cpuName: remote.cpuName,
                    availableThreads: remote.availableThreads,
                  },
                  applications: [
                    {
                      applicationId: APPLICATION_ID,
                      status: 'available',
                      platform: catalog.platform,
                      candidateSha256: catalog.candidate.candidateSha256,
                      catalogSha256: catalog.catalogSha256,
                      inventorySha256: catalog.inventorySha256,
                      taskCount: catalog.tasks.length,
                    },
                  ],
                },
              };
            }
            assert.equal(request.kind, DISTRIBUTED_NODE_TASK_KIND);
            remoteTaskCalls += 1;
            events.push(`remote:task:${request.body.request.taskId}`);
            return {
              body: {
                schema: DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
                requestId: request.requestId,
                nodeId: 'node-01',
                applicationId: APPLICATION_ID,
                candidateSha256: catalog.candidate.candidateSha256,
                catalogSha256: catalog.catalogSha256,
                nodeAttestationSha256: nodeAttestation.attestationSha256,
                taskId: request.body.request.taskId,
                result: passingNativeTaskResult(
                  catalog,
                  request.body.request.taskId
                ),
              },
            };
          },
          requestIdFactory: ({ kind }) => {
            requestSequence += 1;
            return `${kind}-${requestSequence}`;
          },
        });
        assert.equal(isolation.getStore(), undefined);
        events.push('distributed:complete');
        return controllerResult;
      },
    }
  );

  assert.equal(catalogDiscoveryCalls, 1);
  assert.equal(probeCalls, 1);
  assert.ok(localTaskCalls > 0);
  assert.ok(remoteTaskCalls > 0);
  assert.equal(localTaskCalls + remoteTaskCalls, catalog.tasks.length);
  assert.deepEqual(
    result.nativeEvidence[
      'native-repository'
    ].repositoryEvidence.onlineNodes.find(({ nodeId }) => nodeId === 'node-01')
      .nodeAttestation,
    nodeAttestation
  );
  assert.equal(isolationAdmissions.length, 2 + localTaskCalls);
  for (const admission of isolationAdmissions) {
    assert.equal(admission.unitId, 'native-repository');
    assert.deepEqual(admission.candidate, selectedCandidate);
  }
  assert.equal(events.includes('original-repository'), false);
  assert.ok(events.indexOf('catalog') > events.indexOf('distributed:start'));
  assert.ok(events.indexOf('remote:probe') > events.indexOf('catalog'));
  assert.ok(
    events.indexOf('distributed:complete') <
      events.indexOf('later:codeql-fixture')
  );
  assert.ok(
    events.indexOf('later:codeql-fixture') <
      events.indexOf('later:build-fixture')
  );
  assert.deepEqual(
    result.results.map(({ id }) => id),
    ['native-repository', 'native-codeql', 'native-build', 'native-browser']
  );
  assert.equal(
    result.nativeEvidence['native-repository'].repositoryEvidence.completed,
    true
  );
  assert.deepEqual(result.nativeEvidence['native-repository'].cases, {
    passed: catalog.tasks.length,
    failed: 0,
    skipped: 0,
  });
});

test('fails closed when required native callbacks are absent', async () => {
  const stagedBinding = binding();
  const options = stagedOptions();
  const cases = [
    {
      label: 'repository isolation callback',
      options: { ...options, withRepositoryIsolation: undefined },
      callbacks: {
        executeLocalCheck: async () => {},
        executeDistributedRun: async () => {},
      },
    },
    {
      label: 'local check executor',
      options,
      callbacks: { executeDistributedRun: async () => {} },
    },
    {
      label: 'distributed run callback',
      options,
      callbacks: { executeLocalCheck: async () => {} },
    },
  ];
  for (const entry of cases)
    await assert.rejects(
      executeDistributedStagedValidation(
        stagedBinding,
        entry.options,
        entry.callbacks
      ),
      new RegExp(`requires a ${entry.label}`)
    );
});

test('rejects isolation wrappers that skip or repeat a local operation before LAN work', async (t) => {
  for (const entry of [
    {
      name: 'skipped operation',
      isolate: async () => localReceipt({ name: 'invented' }),
      message: /did not invoke its local check/,
    },
    {
      name: 'repeated operation',
      isolate: async (operation) => {
        await operation();
        return operation();
      },
      message: /invoked a local check more than once/,
    },
  ])
    await t.test(entry.name, async () => {
      let distributedCalls = 0;
      const result = await executeDistributedStagedValidation(
        binding(),
        stagedOptions({ isolateOperation: entry.isolate }),
        {
          executeLocalCheck: async (step) => localReceipt(step),
          executeDistributedRun: async () => {
            distributedCalls += 1;
            throw new Error('LAN callback must not start');
          },
        }
      );
      assert.equal(distributedCalls, 0);
      assert.match(
        result.nativeEvidence['native-repository'].reason,
        entry.message
      );
    });
});
