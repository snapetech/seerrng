import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import {
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { reconcileDistributedLinuxRunEvidence } from '../tools/validation-engine/runtime/distributed-linux-run-reconciliation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { DISTRIBUTED_SHARD_RUN_SCHEMA } from '../tools/validation-engine/runtime/distributed-shard-executor.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from './distributed-native-case-ledger-test-fixture.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJson(path, value) {
  writeFileSync(path, jsonBytes(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function passingReceipt(wallMs = 1, stdout = 'ok\n') {
  return {
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    spawnError: null,
    wallMs,
    stdout,
    stderr: '',
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: hash(Buffer.from(stdout)),
    stderrSha256: hash(Buffer.alloc(0)),
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
  };
}

function createCatalog(applicationId, candidate, taskCount = 1) {
  const tasks = Array.from({ length: taskCount }, (_, index) => {
    const files = [
      taskCount === 1
        ? 'server/example.test.ts'
        : `server/example-${String(index + 1).padStart(2, '0')}.test.ts`,
    ];
    return {
      schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
      taskId: distributedNativeTaskId({
        applicationId,
        adapterId: 'vitest',
        files,
      }),
      adapterId: 'vitest',
      files,
    };
  }).toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const candidateCore = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: candidate.commit,
    treeSha: candidate.tree,
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: candidate.lockSha256,
  };
  const nativeCandidate = {
    ...candidateCore,
    candidateSha256: canonicalJsonSha256(candidateCore),
  };
  const inventorySha256 = canonicalJsonSha256({
    schema: 'seerrng-distributed-native-inventory-identity/v1',
    applicationId,
    platform: 'linux',
    candidateSha256: nativeCandidate.candidateSha256,
    tasks,
  });
  const catalogCore = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId,
    platform: 'linux',
    candidate: nativeCandidate,
    inventorySha256,
    tasks,
  };
  return {
    ...catalogCore,
    catalogSha256: canonicalJsonSha256(catalogCore),
  };
}

function createSchedule(
  catalog,
  candidate,
  profile,
  { fleet = false, nodes = null } = {}
) {
  return createDistributedAdaptiveSchedule({
    tests: catalog.tasks.map((task) => ({
      id: task.taskId,
      fingerprint: task.taskId,
      applicationId: catalog.applicationId,
      laneId: 'repository-native',
      adapterId: task.adapterId,
      repositoryIdentitySha256: candidate.sourceSha256,
      dependencies: [],
    })),
    nodes:
      nodes ??
      (fleet
        ? [
            {
              id: 'controller',
              scope: {
                applicationId: catalog.applicationId,
                laneId: 'repository-native',
                adapterId: 'vitest',
                repositoryIdentitySha256: candidate.sourceSha256,
                environment: 'linux-x64',
                nodeId: 'controller',
                selectedN: 24,
              },
              adapterIds: ['vitest'],
              effectiveLogicalThreads: 12,
              concurrency: { mode: 'explicit', threads: 24 },
              currentLoadPermille: 0,
              memory: null,
              localInteractiveReserveThreads: 0,
              runsOnControllerHost: true,
              benchmark: { valid: true, performanceScorePermille: 100 },
            },
            {
              id: 'node-01',
              scope: {
                applicationId: catalog.applicationId,
                laneId: 'repository-native',
                adapterId: 'vitest',
                repositoryIdentitySha256: candidate.sourceSha256,
                environment: 'linux-x64',
                nodeId: 'node-01',
                selectedN: 6,
              },
              adapterIds: ['vitest'],
              effectiveLogicalThreads: 8,
              concurrency: { mode: 'explicit', threads: 6 },
              currentLoadPermille: 0,
              memory: null,
              localInteractiveReserveThreads: 0,
              runsOnControllerHost: false,
              benchmark: { valid: true, performanceScorePermille: 100 },
            },
          ]
        : [
            {
              id: 'controller',
              scope: {
                applicationId: catalog.applicationId,
                laneId: 'repository-native',
                adapterId: 'vitest',
                repositoryIdentitySha256: candidate.sourceSha256,
                environment: 'linux-x64',
                nodeId: 'controller',
                selectedN: 1,
              },
              adapterIds: ['vitest'],
              effectiveLogicalThreads: 2,
              concurrency: { mode: 'explicit', threads: 1 },
              currentLoadPermille: 0,
              memory: null,
              localInteractiveReserveThreads: 0,
              runsOnControllerHost: true,
              benchmark: { valid: true, performanceScorePermille: 100 },
            },
          ]),
    profile,
  });
}

function createNativeTaskResult(catalog, task) {
  const counts = { active: 1, total: 1 };
  const receipt = passingReceipt(
    3,
    createNativeCaseReportFixture(task, counts)
  );
  delete receipt.spawnError;
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: catalog.applicationId,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    taskId: task.taskId,
    adapterId: task.adapterId,
    files: task.files,
    status: 'passed',
    totals: { [task.adapterId]: counts },
    caseLedger: createNativeCaseLedgerFixture(task, counts),
    receipt,
    wallMs: receipt.wallMs,
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

function createRunReport(schedule, catalog, runId) {
  const outcomes = schedule.threadSlots
    .flatMap((slot) =>
      slot.tests.map((scheduled) => {
        const task = catalog.tasks.find(
          (entry) => entry.taskId === scheduled.id
        );
        return {
          sequence: scheduled.sequence,
          shardId: scheduled.id,
          nodeId: slot.nodeId,
          threadSlotId: slot.threadSlotId,
          status: 'passed',
          wallMs: 4,
          result: createNativeTaskResult(catalog, task),
          failureCode: null,
        };
      })
    )
    .toSorted((left, right) => left.sequence - right.sequence);
  const core = {
    schema: DISTRIBUTED_SHARD_RUN_SCHEMA,
    runId,
    applicationId: schedule.applicationId,
    scheduleSha256: schedule.scheduleSha256,
    testInventorySha256: schedule.testInventorySha256,
    startedAt: '2026-10-07T12:00:00.000Z',
    wallMs: 4,
    status: 'passed',
    outcomes,
    resultReuse: false,
  };
  return { ...core, reportSha256: canonicalJsonSha256(core) };
}

function createRepositoryEvidence({ catalog, schedule, report }) {
  const localReceipt = passingReceipt();
  localReceipt.stdoutLog = '/removed-scratch/repository.stdout.log';
  localReceipt.stderrLog = '/removed-scratch/repository.stderr.log';
  return {
    schema: 'seerrng-distributed-repository-evidence/v3',
    completed: true,
    localChecks: [
      {
        index: 0,
        name: 'repository-check',
        kind: 'check',
        receipt: localReceipt,
      },
    ],
    attemptedSteps: [{ index: 0, name: 'repository-check', kind: 'check' }],
    unexecutedSteps: [],
    attemptedShardIds: catalog.tasks.map((task) => task.taskId),
    unexecutedShardIds: [],
    duplicateShardIds: [],
    foreignShardIds: [],
    catalog,
    schedule,
    report,
    shards: clone(report.outcomes),
    onlineNodes: schedule.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      computerName:
        node.nodeId === 'controller' ? 'controller-host' : 'server-host',
      ipAddress: node.nodeId === 'controller' ? '127.0.0.1' : '192.168.10.9',
      port: 5443 + index,
      cpuName: node.nodeId === 'controller' ? 'test-cpu' : 'server-cpu',
      availableThreads: node.effectiveLogicalThreads,
      applicationId: catalog.applicationId,
      platform: catalog.platform,
      candidateSha256: catalog.candidate.candidateSha256,
      catalogSha256: catalog.catalogSha256,
      inventorySha256: catalog.inventorySha256,
      taskCount: catalog.tasks.length,
    })),
    offlineNodes: [],
    applicationAdmission: {
      schema: 'test-application-admission/v1',
      applicationId: catalog.applicationId,
      availableNodes: schedule.nodes.map(({ nodeId }) => ({ nodeId })),
      usableNodes: schedule.nodes.map(({ nodeId }) => ({ nodeId })),
      excludedNodes: [],
    },
    dependencyAdmission: null,
    resultReuse: false,
  };
}

function createStageResult({ candidate, repositoryEvidence, runId }) {
  const evidence = {
    'native-repository': {
      status: 'passed',
      cases: { passed: 1, failed: 0, skipped: 0 },
      caseLedgers: [],
      totals: { vitest: { active: 1, total: 1 } },
      commands: repositoryEvidence.localChecks.map(({ receipt }) => receipt),
      failures: [],
      repositoryEvidence,
      resultReuse: false,
    },
    'native-codeql': { status: 'passed' },
    'native-build': { status: 'passed' },
    'native-browser': { status: 'passed' },
    'pr-release-note-contract': { status: 'passed' },
  };
  const stages = ['repository', 'codeql', 'build', 'browser'];
  const stageCounts = {
    repository: { passed: 1, failed: 0, skipped: 0 },
    codeql: { passed: 0, failed: 0, skipped: 0 },
    build: { passed: 0, failed: 0, skipped: 0 },
    browser: { passed: 1, failed: 0, skipped: 0 },
  };
  const definitions = [
    { id: 'native-repository', lane: 'repository', wallMs: 5, start: 0 },
    { id: 'native-codeql', lane: 'codeql', wallMs: 2, start: 6 },
    { id: 'native-build', lane: 'build', wallMs: 3, start: 8 },
    { id: 'native-browser', lane: 'browser', wallMs: 4, start: 11 },
    {
      id: 'pr-release-note-contract',
      lane: 'repository',
      wallMs: 1,
      start: 5,
    },
  ];
  const results = definitions.map(({ id, lane, wallMs, start }) => {
    return {
      id,
      lane,
      slots: 1,
      files:
        id === 'native-repository'
          ? ['server/example.test.ts']
          : id === 'pr-release-note-contract'
            ? ['CHANGELOG.md']
            : [],
      runId,
      candidate,
      contractSha256: null,
      inputHashes: null,
      executionEnvironmentSha256: digest('e'),
      status: 'passed',
      reason: null,
      executed: true,
      wallMs,
      cpuMs: null,
      caseAttempts:
        id === 'pr-release-note-contract'
          ? { passed: 0, failed: 0, skipped: 0 }
          : stageCounts[lane],
      startOffsetMs: start,
      endOffsetMs: start + wallMs,
      scheduling: {},
      evidenceSha256: hash(Buffer.from(JSON.stringify(evidence[id]), 'utf8')),
    };
  });
  const lanes = stages.map((id) => {
    const units = results.filter((unit) => unit.lane === id);
    return {
      id,
      kind: id === 'build' ? 'compile' : 'check',
      required: true,
      status: 'passed',
      unitCount: units.length,
      unitsExecuted: units.length,
      unitWallMs: units.reduce((sum, unit) => sum + unit.wallMs, 0),
      spanWallMs:
        Math.max(...units.map((unit) => unit.endOffsetMs)) -
        Math.min(...units.map((unit) => unit.startOffsetMs)),
      cpuMs: null,
      caseAttempts: stageCounts[id],
    };
  });
  const aggregateCounts = lanes.reduce(
    (sum, lane) => ({
      passed: sum.passed + lane.caseAttempts.passed,
      failed: sum.failed + lane.caseAttempts.failed,
      skipped: sum.skipped + lane.caseAttempts.skipped,
    }),
    { passed: 0, failed: 0, skipped: 0 }
  );
  return {
    schemaVersion: 2,
    runId,
    candidate,
    executionEnvironmentSha256: digest('e'),
    mode: 'execute',
    status: 'passed',
    ok: true,
    stats: {
      unitsQueued: results.length,
      unitsExecuted: results.length,
      activeUnits: 0,
      peakActiveUnits: 1,
      reservedSlots: 0,
      peakReservedSlots: 1,
      configuredSlotCap: 1,
      caseAttempts: aggregateCounts,
      selectedFileCount: 2,
      executedFileCount: 2,
      osThreads: null,
      childCpuMs: null,
      wallMs: 15,
    },
    lanes,
    results,
    limitations: [],
    localStatus: 'passed',
    pendingRequired: [],
    applicability: [],
    nativeEvidence: evidence,
    capacity: {
      availableLogicalCpus: 2,
      visibleLogicalCpus: 2,
      quotaCpus: null,
      effectiveLogicalCpus: 2,
      operatorGithubLogin: null,
      configuredWorkers: 1,
      githubActions: false,
      policy: 'one-worker-less-than-effective-logical-cpus',
      observedWorkerCount: null,
    },
    resultReuse: false,
    distributedApplication: {
      runtimeApplicationKey: 'seerrng',
      configuredApplicationId: 'SeerrNG 3.48.3',
      dependencyProfilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
      supportedApplication: {
        entryId: '01',
        applicationId: 'SeerrNG 3.48.3',
        name: 'SeerrNG',
        profilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
      },
    },
  };
}

function createRunExpectations(result) {
  return {
    schema: 'seerrng-distributed-linux-run-expectations/v1',
    runId: result.runId,
    candidate: result.candidate,
    executionEnvironmentSha256: result.executionEnvironmentSha256,
    capacity: result.capacity,
    requiredCapacityProof: null,
    requiredFleetProof: null,
    context: {
      status: 'ready',
      stages: ['repository', 'codeql', 'build', 'browser'],
      blockedRequired: [],
      pendingMetadata: [],
      resultReuse: false,
    },
    plan: {
      maxSlots: result.capacity.configuredWorkers,
      lanes: result.lanes.map((lane, index, lanes) => ({
        id: lane.id,
        kind: lane.kind,
        required: lane.required,
        dependsOn: [],
        after: index ? [lanes[index - 1].id] : [],
        prerequisites: [],
      })),
      units: result.results.map((unit) => ({
        id: unit.id,
        lane: unit.lane,
        slots: unit.slots,
        reads: ['source-manifest'],
        writes: [
          unit.lane === 'browser' ? 'scratch-browser' : `scratch-${unit.lane}`,
        ],
        files: unit.files,
        dependsOn: unit.lane === 'browser' ? ['native-build'] : [],
        after:
          unit.id === 'pr-release-note-contract' ? ['native-repository'] : [],
      })),
    },
    resultReuse: false,
  };
}

function createTimingEvidence(result, repositoryEvidence, runId) {
  const nodeTotals = new Map();
  for (const shard of repositoryEvidence.shards) {
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
        left.nodeId.localeCompare(right.nodeId)
      ),
      reportWallMs: repositoryEvidence.report.wallMs,
      shards: repositoryEvidence.shards.map((shard) => ({
        nodeId: shard.nodeId,
        shardId: shard.shardId,
        status: shard.status,
        threadSlotId: shard.threadSlotId,
        wallMs: shard.wallMs,
      })),
    },
    resultReuse: false,
  };
}

function createProcessLedger(candidate) {
  const record = {
    sequence: 1,
    id: 'native-command-1',
    commandId: 'repository-check',
    role: 'command',
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    spawnError: null,
    wallMs: 1,
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
    stdoutLog: '/removed-scratch/native-command-1.stdout.log',
    stderrLog: '/removed-scratch/native-command-1.stderr.log',
    stdoutBytes: 3,
    stderrBytes: 0,
    stdoutSha256: hash(Buffer.from('ok\n')),
    stderrSha256: hash(Buffer.alloc(0)),
  };
  return Buffer.from(
    `${JSON.stringify({ schema: 1, candidate })}\n${JSON.stringify(record)}\n`,
    'utf8'
  );
}

function createProcessStreams(ledgerBytes) {
  const [, record] = ledgerBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  const contents = { stdout: Buffer.from('ok\n'), stderr: Buffer.alloc(0) };
  return {
    schema: 'seerrng-distributed-linux-process-streams/v1',
    sourceLedgerSha256: hash(ledgerBytes),
    recordCount: 1,
    streamCount: 2,
    records: [
      {
        sequence: record.sequence,
        id: record.id,
        commandId: record.commandId,
        streams: Object.fromEntries(
          ['stdout', 'stderr'].map((stream) => [
            stream,
            {
              fileName: `native-command-1.${stream}.log`,
              bytes: contents[stream].length,
              sha256: hash(contents[stream]),
              contentBase64: contents[stream].toString('base64'),
            },
          ])
        ),
      },
    ],
    resultReuse: false,
  };
}

function fixture(t, { fleet = false, nodes = null, taskCount } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-run-reconciliation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceDirectory = join(root, 'production-run-1');
  mkdirSync(evidenceDirectory);
  const runId = 'production-run-1';
  const candidate = {
    repository: 'JohnCronk79/seerrng',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    lockSha256: digest('c'),
    sourceSha256: digest('d'),
  };
  const profile = createAdaptiveTimingProfile();
  const catalog = createCatalog(
    'seerrng',
    candidate,
    taskCount ?? (fleet ? 30 : 1)
  );
  const schedule = createSchedule(catalog, candidate, profile, {
    fleet,
    nodes,
  });
  const report = createRunReport(schedule, catalog, runId);
  const repositoryEvidence = createRepositoryEvidence({
    catalog,
    schedule,
    report,
  });
  const result = createStageResult({ candidate, repositoryEvidence, runId });
  if (fleet) {
    result.capacity = {
      availableLogicalCpus: 12,
      visibleLogicalCpus: 12,
      quotaCpus: 12,
      effectiveLogicalCpus: 12,
      operatorGithubLogin: 'JohnCronk79',
      githubActions: false,
      policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
      configuredWorkers: 24,
      observedWorkerCount: null,
    };
    result.stats.configuredSlotCap = 24;
    for (const unit of result.results) unit.slots = 24;
  }
  const timings = createTimingEvidence(result, repositoryEvidence, runId);
  const paths = {
    processLedger: join(evidenceDirectory, 'native-command-receipts.jsonl'),
    processLedgerSummary: join(evidenceDirectory, 'native-process-ledger.json'),
    processStreams: join(evidenceDirectory, 'native-process-streams.json'),
    result: join(evidenceDirectory, 'staged-validation-result.json'),
    runExpectations: join(evidenceDirectory, 'native-run-expectations.json'),
    timings: join(evidenceDirectory, 'timings.json'),
  };
  writeJson(paths.result, result);
  const runExpectations = createRunExpectations(result);
  if (fleet) {
    runExpectations.requiredCapacityProof = {
      schema: 'seerrng-required-worker-capacity-proof/v1',
      operatorGithubLogin: 'JohnCronk79',
      expectedLogicalCpus: 12,
      expectedConfiguredWorkers: 24,
      githubActions: false,
      policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
    };
    runExpectations.requiredFleetProof = {
      schema: 'seerrng-distributed-linux-required-fleet-proof/v1',
      nodes: [
        {
          nodeId: 'controller',
          nodeNumber: 'controller',
          computerName: 'controller-host',
          ipAddress: '127.0.0.1',
          port: 5443,
          cpuName: 'test-cpu',
          availableThreads: 12,
          threadExpression: '2n',
          minimumThreadCount: 1,
          admittedThreads: 24,
        },
        {
          nodeId: 'node-01',
          nodeNumber: '01',
          computerName: 'server-host',
          ipAddress: '192.168.10.9',
          port: 5444,
          cpuName: 'server-cpu',
          availableThreads: 8,
          threadExpression: 'n-2',
          minimumThreadCount: 1,
          admittedThreads: 6,
        },
      ],
      requireAllConfiguredNodesOnline: true,
      requireNoConfiguredNodeExclusions: true,
      requireAtLeastOneShardPerNode: true,
    };
  }
  writeJson(paths.runExpectations, runExpectations);
  writeJson(paths.timings, timings);
  const ledgerBytes = createProcessLedger(candidate);
  writeFileSync(paths.processLedger, ledgerBytes);
  writeJson(paths.processStreams, createProcessStreams(ledgerBytes));
  writeJson(paths.processLedgerSummary, {
    schema: 'seerrng-distributed-linux-process-ledger/v1',
    records: 1,
    pending: [],
    cleanupVerified: true,
    sourceSha256: hash(ledgerBytes),
    evidenceSha256: hash(ledgerBytes),
    evidenceFile: paths.processLedger,
  });
  const input = {
    evidenceDirectory,
    files: paths,
    expected: {
      activeConfigPath: join(root, 'active-config'),
      applicationEntryId: '01',
      profileSha256: canonicalJsonSha256(profile),
      runExpectationsSha256: hash(jsonBytes(runExpectations)),
      runId,
      runtimeApplicationKey: 'seerrng',
    },
  };
  return { input, paths, result };
}

function rewriteResult(selected, mutate) {
  const result = readJson(selected.paths.result);
  mutate(result);
  writeJson(selected.paths.result, result);
  return result;
}

function rewriteExpectations(selected, mutate, { rebind = true } = {}) {
  const expectations = readJson(selected.paths.runExpectations);
  mutate(expectations);
  writeJson(selected.paths.runExpectations, expectations);
  if (rebind)
    selected.input.expected.runExpectationsSha256 = hash(
      jsonBytes(expectations)
    );
  return expectations;
}

function resealRepositoryEvidence(result) {
  const evidence = result.nativeEvidence['native-repository'];
  const report = evidence.repositoryEvidence.report;
  const reportCore = { ...report };
  delete reportCore.reportSha256;
  report.reportSha256 = canonicalJsonSha256(reportCore);
  const unit = result.results.find(({ id }) => id === 'native-repository');
  unit.evidenceSha256 = hash(Buffer.from(JSON.stringify(evidence), 'utf8'));
}

function moveColdShard(result, { fromNodeId, toNodeId }) {
  const repository =
    result.nativeEvidence['native-repository'].repositoryEvidence;
  const sourceSlot = repository.schedule.threadSlots.find(
    (slot) => slot.nodeId === fromNodeId && slot.tests.length > 0
  );
  const targetSlot = repository.schedule.threadSlots.find(
    (slot) => slot.nodeId === toNodeId && slot.tests.length === 0
  );
  assert.ok(sourceSlot);
  assert.ok(targetSlot);
  const [moved] = sourceSlot.tests.splice(0, 1);
  targetSlot.tests.push(moved);
  for (const slot of [sourceSlot, targetSlot]) {
    slot.predictedBusyMs = slot.tests.reduce(
      (total, testEntry) => total + testEntry.predictedDurationMs,
      0
    );
    slot.predictedFinishOffsetMs = slot.tests.reduce(
      (maximum, testEntry) =>
        Math.max(maximum, testEntry.predictedFinishOffsetMs),
      0
    );
  }
  repository.schedule.predictedWallMs = repository.schedule.threadSlots.reduce(
    (maximum, slot) => Math.max(maximum, slot.predictedFinishOffsetMs),
    0
  );
  const scheduleCore = { ...repository.schedule };
  delete scheduleCore.scheduleSha256;
  repository.schedule.scheduleSha256 = canonicalJsonSha256(scheduleCore);

  const outcome = repository.report.outcomes.find(
    ({ shardId }) => shardId === moved.id
  );
  assert.ok(outcome);
  outcome.nodeId = targetSlot.nodeId;
  outcome.threadSlotId = targetSlot.threadSlotId;
  repository.report.scheduleSha256 = repository.schedule.scheduleSha256;
  repository.shards = clone(repository.report.outcomes);
  resealRepositoryEvidence(result);
}

function rewriteLedger(selected, mutate) {
  const lines = readFileSync(selected.paths.processLedger, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  mutate(lines);
  const bytes = Buffer.from(
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8'
  );
  writeFileSync(selected.paths.processLedger, bytes);
  const summary = readJson(selected.paths.processLedgerSummary);
  summary.sourceSha256 = hash(bytes);
  summary.evidenceSha256 = hash(bytes);
  writeJson(selected.paths.processLedgerSummary, summary);
}

function rewriteProcessStreams(selected, mutate) {
  const streams = readJson(selected.paths.processStreams);
  mutate(streams);
  writeJson(selected.paths.processStreams, streams);
}

test('independently reconciles all durable pre-success evidence', (t) => {
  const selected = fixture(t);
  const result = reconcileDistributedLinuxRunEvidence(selected.input);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.runId, selected.input.expected.runId);
  assert.equal(result.repositoryEvidence.completed, true);
  assert.equal(result.evidenceManifest.files.length, 6);
  assert.match(result.evidenceManifestSha256, /^[a-f0-9]{64}$/u);
  assert.match(result.repositoryEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.cleanup.verified, true);
  assert.equal(result.cleanup.processReceiptCount, 1);
  assert.equal(result.cleanup.rawStreamCount, 2);
  assert.equal(result.timing.stageCount, 4);
});

test('permits a generic empty-profile heterogeneous fleet without a required proof', (t) => {
  const selected = fixture(t, {
    taskCount: 4,
    nodes: [
      {
        id: 'controller',
        scope: {
          environment: 'linux-x64',
          nodeId: 'controller',
        },
        adapterIds: ['vitest'],
        effectiveLogicalThreads: 2,
        concurrency: { mode: 'explicit', threads: 1 },
        currentLoadPermille: 0,
        memory: null,
        localInteractiveReserveThreads: 0,
        runsOnControllerHost: true,
        benchmark: { valid: true, performanceScorePermille: 100 },
      },
      {
        id: 'node-heterogeneous',
        scope: {
          environment: 'linux-arm64',
          nodeId: 'node-heterogeneous',
        },
        adapterIds: ['node-test', 'vitest'],
        effectiveLogicalThreads: 8,
        concurrency: { mode: 'explicit', threads: 3 },
        currentLoadPermille: 0,
        memory: null,
        localInteractiveReserveThreads: 0,
        runsOnControllerHost: false,
        benchmark: { valid: true, performanceScorePermille: 250 },
      },
    ],
  });

  const result = reconcileDistributedLinuxRunEvidence(selected.input);
  const scheduleNodes = result.repositoryEvidence.schedule.nodes;

  assert.equal(result.requiredFleetProof, null);
  assert.deepEqual(
    scheduleNodes.map(({ nodeId, admittedThreads }) => ({
      nodeId,
      admittedThreads,
    })),
    [
      { nodeId: 'controller', admittedThreads: 1 },
      { nodeId: 'node-heterogeneous', admittedThreads: 3 },
    ]
  );
  assert.notDeepEqual(scheduleNodes[0].adapterIds, scheduleNodes[1].adapterIds);
  assert.equal(result.status, 'passed');
});

test('independently proves the configured controller and Node 01 both executed shards', (t) => {
  const selected = fixture(t, { fleet: true });
  const result = reconcileDistributedLinuxRunEvidence(selected.input);

  assert.equal(result.capacity.configuredWorkers, 24);
  assert.deepEqual(
    result.requiredFleetProof.nodes.map(({ nodeId, admittedThreads }) => ({
      nodeId,
      admittedThreads,
    })),
    [
      { nodeId: 'controller', admittedThreads: 24 },
      { nodeId: 'node-01', admittedThreads: 6 },
    ]
  );
  const usedNodes = new Set(
    result.repositoryEvidence.shards.map(({ nodeId }) => nodeId)
  );
  assert.deepEqual([...usedNodes].toSorted(), ['controller', 'node-01']);
});

test('rejects a coherently resealed 9:1 cold schedule for 24:6 capacity', (t) => {
  const selected = fixture(t, { fleet: true, taskCount: 10 });
  const original = readJson(selected.paths.result);
  const originalShards =
    original.nativeEvidence['native-repository'].repositoryEvidence.shards;
  assert.deepEqual(
    Object.fromEntries(
      ['controller', 'node-01'].map((nodeId) => [
        nodeId,
        originalShards.filter((shard) => shard.nodeId === nodeId).length,
      ])
    ),
    { controller: 8, 'node-01': 2 }
  );

  const result = rewriteResult(selected, (value) => {
    moveColdShard(value, {
      fromNodeId: 'node-01',
      toNodeId: 'controller',
    });
  });
  const repository =
    result.nativeEvidence['native-repository'].repositoryEvidence;
  writeJson(
    selected.paths.timings,
    createTimingEvidence(result, repository, result.runId)
  );
  assert.deepEqual(
    Object.fromEntries(
      ['controller', 'node-01'].map((nodeId) => [
        nodeId,
        repository.shards.filter((shard) => shard.nodeId === nodeId).length,
      ])
    ),
    { controller: 9, 'node-01': 1 }
  );

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Cold schedule allocation differs from deterministic capacity-proportional placement/u
  );
});

test('rejects a coherently resealed within-one-shard cold misallocation', (t) => {
  const selected = fixture(t, { fleet: true, taskCount: 11 });
  const original = readJson(selected.paths.result);
  const originalShards =
    original.nativeEvidence['native-repository'].repositoryEvidence.shards;
  assert.deepEqual(
    Object.fromEntries(
      ['controller', 'node-01'].map((nodeId) => [
        nodeId,
        originalShards.filter((shard) => shard.nodeId === nodeId).length,
      ])
    ),
    { controller: 9, 'node-01': 2 }
  );

  const result = rewriteResult(selected, (value) => {
    moveColdShard(value, {
      fromNodeId: 'controller',
      toNodeId: 'node-01',
    });
  });
  const repository =
    result.nativeEvidence['native-repository'].repositoryEvidence;
  writeJson(
    selected.paths.timings,
    createTimingEvidence(result, repository, result.runId)
  );
  assert.deepEqual(
    Object.fromEntries(
      ['controller', 'node-01'].map((nodeId) => [
        nodeId,
        repository.shards.filter((shard) => shard.nodeId === nodeId).length,
      ])
    ),
    { controller: 8, 'node-01': 3 }
  );

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Cold schedule allocation differs from deterministic capacity-proportional placement/u
  );
});

test('rejects a staged result changed after its durable write', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.runId = 'another-run';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /run ID differs/u
  );
});

test('rejects omission of an applicable supplemental unit', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.results = result.results.filter(
      ({ id }) => id !== 'pr-release-note-contract'
    );
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Expected\/result unit identity closure differs/u
  );
});

test('rejects a unit whose sealed lane, slots, or files changed', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const unit = result.results.find(
      ({ id }) => id === 'pr-release-note-contract'
    );
    unit.slots = 2;
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /lane or slot demand differs/u
  );
});

test('rejects result capacity that differs from the sealed native context', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.capacity.configuredWorkers = 2;
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /result\/context capacity differs/u
  );
});

test('rejects unit wall time that differs from its exact offset span', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.results[0].wallMs += 10;
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /wall time differs from its offsets/u
  );
});

test('rejects a dependent unit that starts before its producer completed', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const unit = result.results.find(
      ({ id }) => id === 'pr-release-note-contract'
    );
    unit.startOffsetMs = 0;
    unit.endOffsetMs = 1;
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /started before native-repository completed/u
  );
});

test('rejects a run-expectations artifact changed outside its sealed hash', (t) => {
  const selected = fixture(t);
  rewriteExpectations(
    selected,
    (expectations) => {
      expectations.plan.units[0].files.push('unsealed.test.ts');
    },
    { rebind: false }
  );

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /expectations file identity differs/u
  );
});

test('required fleet proof rejects a configured Node 01 that received no shard', (t) => {
  const selected = fixture(t);
  const requiredCapacityProof = {
    schema: 'seerrng-required-worker-capacity-proof/v1',
    operatorGithubLogin: 'JohnCronk79',
    expectedLogicalCpus: 12,
    expectedConfiguredWorkers: 24,
    githubActions: false,
    policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
  };
  const requiredCapacity = {
    availableLogicalCpus: 12,
    visibleLogicalCpus: 12,
    quotaCpus: 12,
    effectiveLogicalCpus: 12,
    operatorGithubLogin: 'JohnCronk79',
    githubActions: false,
    policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
    configuredWorkers: 24,
    observedWorkerCount: null,
  };
  rewriteResult(selected, (result) => {
    result.capacity = requiredCapacity;
    result.stats.configuredSlotCap = 24;
    for (const unit of result.results) unit.slots = 24;
  });
  rewriteExpectations(selected, (expectations) => {
    expectations.capacity = requiredCapacity;
    expectations.requiredCapacityProof = requiredCapacityProof;
    expectations.requiredFleetProof = {
      schema: 'seerrng-distributed-linux-required-fleet-proof/v1',
      nodes: [
        {
          nodeId: 'controller',
          nodeNumber: 'controller',
          computerName: "John's laptop",
          ipAddress: '192.168.10.82',
          port: 62021,
          cpuName: 'Laptop CPU',
          availableThreads: 12,
          threadExpression: '2n',
          minimumThreadCount: 1,
          admittedThreads: 24,
        },
        {
          nodeId: 'node-01',
          nodeNumber: '01',
          computerName: "John's server",
          ipAddress: '192.168.10.9',
          port: 62021,
          cpuName: 'Server CPU',
          availableThreads: 8,
          threadExpression: 'n-2',
          minimumThreadCount: 1,
          admittedThreads: 6,
        },
      ],
      requireAllConfiguredNodesOnline: true,
      requireNoConfiguredNodeExclusions: true,
      requireAtLeastOneShardPerNode: true,
    };
    expectations.plan.maxSlots = 24;
    for (const unit of expectations.plan.units) unit.slots = 24;
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /configured\/scheduled fleet closure differs/u
  );
});

test('rejects a missing durable evidence file', (t) => {
  const selected = fixture(t);
  unlinkSync(selected.paths.timings);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /timings evidence file is missing/u
  );
});

test('rejects duplicate evidence paths before reading roles', (t) => {
  const selected = fixture(t);
  const input = clone(selected.input);
  input.files.timings = input.files.result;

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(input),
    /paths contain a duplicate/u
  );
});

test('rejects a failed required stage even when the top-level label is green', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.lanes[0].status = 'failed';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Required repository lane did not pass/u
  );
});

test('rejects a shard outcome moved off its sealed node assignment', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.report.outcomes[0].nodeId = 'wrong-node';
    repository.shards[0].nodeId = 'wrong-node';
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /sealed assignment|changed assignment/u
  );
});

test('rejects a fully resealed distributed report with zero aggregate active cases', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    for (const outcome of repository.report.outcomes) {
      const task = repository.catalog.tasks.find(
        ({ taskId }) => taskId === outcome.shardId
      );
      assert.ok(task);
      const total = outcome.result.totals[task.adapterId].total;
      outcome.result.totals = {
        [task.adapterId]: { active: 0, total },
      };
      outcome.result.caseLedger = createNativeCaseLedgerFixture(task, {
        active: 0,
        total,
      });
      const resultCore = { ...outcome.result };
      delete resultCore.resultSha256;
      outcome.result.resultSha256 = canonicalJsonSha256(resultCore);
    }
    repository.shards = clone(repository.report.outcomes);
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /invalid aggregate case totals/u
  );
});

test('accepts one fully resealed explicit-skip task when durable aggregate coverage remains active', (t) => {
  const selected = fixture(t, { fleet: true });
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    const outcome = repository.report.outcomes[0];
    const task = repository.catalog.tasks.find(
      ({ taskId }) => taskId === outcome.shardId
    );
    assert.ok(task);
    const total = outcome.result.totals[task.adapterId].total;
    outcome.result.totals = {
      [task.adapterId]: { active: 0, total },
    };
    outcome.result.caseLedger = createNativeCaseLedgerFixture(task, {
      active: 0,
      total,
    });
    const resultCore = { ...outcome.result };
    delete resultCore.resultSha256;
    outcome.result.resultSha256 = canonicalJsonSha256(resultCore);
    repository.shards = clone(repository.report.outcomes);
    resealRepositoryEvidence(result);
  });

  const reconciliation = reconcileDistributedLinuxRunEvidence(selected.input);
  assert.equal(reconciliation.status, 'passed');
  assert.equal(
    reconciliation.repositoryEvidence.shards.filter(
      ({ result }) => result.caseLedger.counts.active === 0
    ).length,
    1
  );
});

test('rejects a fully resealed distributed report with an empty case ledger', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    const outcome = repository.report.outcomes[0];
    const ledger = outcome.result.caseLedger;
    ledger.cases = [];
    ledger.counts = {
      active: 0,
      failed: 0,
      passed: 0,
      skipped: 0,
      total: 0,
    };
    const ledgerCore = { ...ledger };
    delete ledgerCore.ledgerSha256;
    ledger.ledgerSha256 = canonicalJsonSha256(ledgerCore);
    outcome.result.totals = {
      [outcome.result.adapterId]: { active: 0, total: 0 },
    };
    const resultCore = { ...outcome.result };
    delete resultCore.resultSha256;
    outcome.result.resultSha256 = canonicalJsonSha256(resultCore);
    repository.shards = clone(repository.report.outcomes);
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /must contain cases/u
  );
});

test('rejects an available application node omitted from the admission partition', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.applicationAdmission.availableNodes.push({
      nodeId: 'orphan-node',
    });
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Application node admission partition differs/u
  );
});

test('rejects an available dependency node omitted from the admission partition', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.dependencyAdmission = {
      schema: 'test-dependency-admission/v1',
      availableNodes: [{ nodeId: 'controller' }, { nodeId: 'orphan-node' }],
      usableNodes: [{ nodeId: 'controller' }],
      excludedNodes: [],
    };
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Dependency node admission partition differs/u
  );
});

test('rejects incomplete durable timing evidence', (t) => {
  const selected = fixture(t);
  const timings = readJson(selected.paths.timings);
  timings.units.pop();
  writeJson(selected.paths.timings, timings);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Durable timing evidence differs/u
  );
});

test('rejects coherently resealed distributed timing outside the four-stage wall time', (t) => {
  const selected = fixture(t);
  const result = rewriteResult(selected, (value) => {
    const repository =
      value.nativeEvidence['native-repository'].repositoryEvidence;
    repository.report.wallMs = value.stats.wallMs + 1;
    resealRepositoryEvidence(value);
  });
  const repository =
    result.nativeEvidence['native-repository'].repositoryEvidence;
  writeJson(
    selected.paths.timings,
    createTimingEvidence(result, repository, result.runId)
  );

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Distributed report wall time exceeds the containing four-stage run/u
  );
});

test('rejects coherently resealed distributed timing outside the native repository unit', (t) => {
  const selected = fixture(t);
  const result = rewriteResult(selected, (value) => {
    const repositoryUnit = value.results.find(
      ({ id }) => id === 'native-repository'
    );
    assert.ok(repositoryUnit);
    const repository =
      value.nativeEvidence['native-repository'].repositoryEvidence;
    repository.report.wallMs = repositoryUnit.wallMs + 1;
    assert.ok(repository.report.wallMs <= value.stats.wallMs);
    resealRepositoryEvidence(value);
  });
  const repository =
    result.nativeEvidence['native-repository'].repositoryEvidence;
  writeJson(
    selected.paths.timings,
    createTimingEvidence(result, repository, result.runId)
  );

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Distributed report wall time exceeds the containing native repository unit/u
  );
});

test('rejects a process receipt whose cleanup did not complete', (t) => {
  const selected = fixture(t);
  rewriteLedger(selected, (lines) => {
    lines[1].lifecycle.cleanupVerified = false;
    lines[1].lifecycle.cleanupError = 'focused cleanup failure';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /cleanup did not complete/u
  );
});

test('rejects a raw process stream whose bytes differ from its ledger', (t) => {
  const selected = fixture(t);
  rewriteProcessStreams(selected, (streams) => {
    streams.records[0].streams.stdout.contentBase64 = Buffer.from(
      'tampered\n',
      'utf8'
    ).toString('base64');
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /stdout content differs/u
  );
});

test('rejects a raw process stream bundle bound to another ledger', (t) => {
  const selected = fixture(t);
  rewriteProcessStreams(selected, (streams) => {
    streams.sourceLedgerSha256 = digest('f');
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /stream bundle is incomplete/u
  );
});

test('rejects evidence with a timestamp predating the fresh run directory', (t) => {
  const selected = fixture(t);
  const stale = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(selected.paths.result, stale, stale);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /evidence is stale/u
  );
});
