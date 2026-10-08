import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { createRequiredWorkerCapacityProof } from '../tools/validation-engine/runtime/cpu-capacity.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { executeDistributedLinuxProductionRun } from '../tools/validation-engine/runtime/distributed-linux-production-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA } from '../tools/validation-engine/runtime/distributed-linux-host-preparation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (character) => character.repeat(64);
const candidate = Object.freeze({
  repository: 'JohnCronk79/seerrng',
  commit: '1'.repeat(40),
  tree: '2'.repeat(40),
  lockSha256: digest('3'),
  sourceSha256: digest('4'),
});
const genericCapacity = Object.freeze({
  availableLogicalCpus: 2,
  visibleLogicalCpus: 2,
  quotaCpus: 2,
  effectiveLogicalCpus: 2,
  operatorGithubLogin: null,
  githubActions: false,
  policy: 'one-worker-less-than-effective-logical-cpus',
  configuredWorkers: 1,
  observedWorkerCount: null,
});

function repositoryEvidence(profile) {
  return {
    schema: 'seerrng-distributed-repository-evidence/v3',
    completed: true,
    localChecks: [],
    attemptedSteps: [],
    unexecutedSteps: [],
    attemptedShardIds: ['task-a'],
    unexecutedShardIds: [],
    duplicateShardIds: [],
    foreignShardIds: [],
    catalog: {
      applicationId: 'seerrng',
      candidate: { candidateSha256: digest('a') },
      catalogSha256: digest('b'),
      tasks: [{ taskId: 'task-a', adapterId: 'vitest', files: ['a.test.ts'] }],
    },
    schedule: {
      applicationId: 'seerrng',
      policySha256: canonicalJsonSha256({
        acceptedRunWindow: 32,
        coldStartDurationMs: 60_000,
        coldStartPerformanceScorePermille: 100,
        controllerReserveThreads: 1,
        fallbackQuantilePermille: 900,
        maximumSamplesPerTest: 9,
        rollingQuantilePermille: 750,
        unknownEstimateMultiplierPermille: 1_250,
      }),
      profileSha256: canonicalJsonSha256(profile),
      repositoryIdentitySha256: digest('c'),
      scheduleSha256: digest('d'),
      testInventorySha256: digest('e'),
      nodes: [
        {
          nodeId: 'controller',
          scope: { environment: 'linux-x64', nodeId: 'controller' },
          admittedThreads: 2,
          performanceScorePermille: 100,
        },
      ],
      threadSlots: [
        {
          nodeId: 'controller',
          threadSlotId: 'controller.thread-1',
          tests: [
            {
              adapterId: 'vitest',
              fingerprint: 'task-a',
              id: 'task-a',
              laneId: 'repository-native',
            },
          ],
        },
      ],
    },
    report: {
      reportSha256: digest('f'),
      status: 'passed',
      wallMs: 5,
    },
    shards: [
      {
        nodeId: 'controller',
        result: { wallMs: 3 },
        shardId: 'task-a',
        status: 'passed',
        threadSlotId: 'controller.thread-1',
        wallMs: 4,
      },
    ],
    onlineNodes: [],
    offlineNodes: [],
    applicationAdmission: {},
    dependencyAdmission: {},
    resultReuse: false,
  };
}

function stagedResult(
  profile,
  { passed = true, capacity = genericCapacity } = {}
) {
  const evidence = repositoryEvidence(profile);
  const stageIds = ['repository', 'codeql', 'build', 'browser'];
  return {
    schemaVersion: 2,
    runId: 'production-run-1',
    candidate,
    executionEnvironmentSha256: digest('e'),
    mode: 'execute',
    status: passed ? 'passed' : 'failed',
    localStatus: passed ? 'passed' : 'failed',
    ok: passed,
    stats: { wallMs: 20 },
    lanes: stageIds.map((id, index) => ({
      id,
      kind: id,
      required: true,
      status: passed || index > 0 ? 'passed' : 'failed',
      unitCount: 1,
      unitsExecuted: 1,
      unitWallMs: index + 1,
      spanWallMs: index + 1,
      cpuMs: null,
      caseAttempts: { passed: 1, failed: 0, skipped: 0 },
    })),
    results: stageIds.map((lane, index) => ({
      id: `native-${lane}`,
      lane,
      slots: capacity.configuredWorkers,
      files: lane === 'repository' ? ['a.test.ts'] : [],
      runId: 'production-run-1',
      candidate,
      executionEnvironmentSha256: digest('e'),
      status: passed || index > 0 ? 'passed' : 'failed',
      wallMs: index + 1,
      startOffsetMs: index * 2,
      endOffsetMs: index * 2 + 1,
    })),
    pendingRequired: [],
    applicability: [],
    nativeEvidence: {
      'native-repository': {
        status: passed ? 'passed' : 'failed',
        repositoryEvidence: evidence,
      },
    },
    capacity,
    resultReuse: false,
  };
}

function harness(
  t,
  failure = null,
  { requiredProof = false, additionalNode = false } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-production-runner-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const evidenceDirectory = join(root, 'production-run-1');
  const timingProfilePath = join(root, 'timing-profile.json');
  const ledgerPath = join(root, 'source-native-ledger.jsonl');
  const nativeLogs = join(root, 'logs');
  mkdirSync(nativeLogs);
  const stdoutLog = join(nativeLogs, 'native-command-1.stdout.log');
  const stderrLog = join(nativeLogs, 'native-command-1.stderr.log');
  const stdoutBytes = Buffer.from('focused output\n', 'utf8');
  const stderrBytes = Buffer.alloc(0);
  writeFileSync(stdoutLog, stdoutBytes, { flag: 'wx' });
  writeFileSync(stderrLog, stderrBytes, { flag: 'wx' });
  const ledgerBytes = Buffer.from(
    `${JSON.stringify({ schema: 1, candidate: { sourceSha256: digest('a') } })}\n${JSON.stringify(
      {
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
        stdoutLog,
        stderrLog,
        stdoutBytes: stdoutBytes.length,
        stderrBytes: stderrBytes.length,
        stdoutSha256: hash(stdoutBytes),
        stderrSha256: hash(stderrBytes),
      }
    )}\n`,
    'utf8'
  );
  writeFileSync(ledgerPath, ledgerBytes, { flag: 'wx' });
  const events = [];
  const initialProfile = createAdaptiveTimingProfile();
  const preparationSources = [
    ['controller-config', '/config/controller.cfg'],
    ['active-controller-marker', '/config/active-controller'],
    ['timing-profile-seed', '/config/adaptive-timing-profile.json'],
    ['authenticated-git-evidence', '/config/authenticated-git-closure.json'],
    ['proof-parent-config', '/config/proof-parent.json'],
    ['proof-parent-script', '/recipes/mode3-proof-parent.py'],
    ['containment-manifest', '/config/containment-manifest.json'],
    ['contained-request', '/config/contained-request.json'],
  ].map(([role, containerPath]) => {
    const bytes = Buffer.from(`raw ${role}\n`, 'utf8');
    return { role, containerPath, bytes, rawSha256: hash(bytes) };
  });
  const preparationFiles = new Map(
    preparationSources.map(({ containerPath, bytes }) => [containerPath, bytes])
  );
  let durableProfile = structuredClone(initialProfile);
  let profilePersistCalls = 0;
  const application = {
    entryId: 'application-01',
    applicationId: 'SeerrNG 3.48.3',
    name: 'SeerrNG',
    profilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
  };
  const runCapacity = requiredProof
    ? Object.freeze({
        availableLogicalCpus: 12,
        visibleLogicalCpus: 12,
        quotaCpus: 12,
        effectiveLogicalCpus: 12,
        operatorGithubLogin: 'JohnCronk79',
        githubActions: false,
        policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
        configuredWorkers: 24,
        observedWorkerCount: null,
      })
    : genericCapacity;
  const active = {
    configPath: '/config/test-suite-multi-computer-user.cfg',
    role: 'controller',
    config: requiredProof
      ? {
          global: {
            githubUsername: 'JohnCronk79',
            computerName: "John's laptop",
            ipAddress: '192.168.10.82',
            port: 62021,
            cpuName: 'Focused laptop CPU',
            availableThreads: 12,
            threads: '2n',
            minimumThreadCount: 1,
          },
          nodes: [
            {
              nodeNumber: '01',
              computerName: "John's server",
              ipAddress: '192.168.10.9',
              port: 62021,
              cpuName: 'Focused server CPU',
              availableThreads: 8,
              threads: 'n-2',
              minimumThreadCount: 1,
            },
            ...(additionalNode
              ? [
                  {
                    nodeNumber: '02',
                    computerName: 'Additional worker',
                    ipAddress: '192.168.10.10',
                    port: 62021,
                    cpuName: 'Additional worker CPU',
                    availableThreads: 16,
                    threads: 'n',
                    minimumThreadCount: 1,
                  },
                ]
              : []),
          ],
          supportedApplications: [application],
        }
      : { supportedApplications: [application] },
  };
  const result = stagedResult(initialProfile, {
    passed: failure !== 'stage',
    capacity: runCapacity,
  });
  const containment = {
    verifyDockerFixture: async () => ({}),
    verifyGitHistory: async () => ({}),
    verifyNetworkBoundary: async () => ({}),
    withRepositoryIsolation: async (operation) => await operation(),
    withDistributedNetwork: async (operation) => {
      events.push('network:enter');
      try {
        return await operation();
      } finally {
        events.push('network:restored');
      }
    },
  };
  const options = {
    activeConfigMarkerPath: join(root, 'active-config'),
    applicationEntryId: application.entryId,
    containment,
    evidenceDirectory,
    hostPreparation: {
      schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
      inputs: preparationSources.map(({ role, containerPath, rawSha256 }) => ({
        role,
        containerPath,
        rawSha256,
      })),
    },
    runAttempt: 1,
    runId: 'production-run-1',
    runtimeApplicationKey: 'seerrng',
    sourceRoot: root,
    timingProfilePath,
    ...(requiredProof
      ? {
          nativeContextOptions: {
            operatorGithubLogin: 'JohnCronk79',
            requiredCapacityProof: createRequiredWorkerCapacityProof({
              operatorGithubLogin: 'JohnCronk79',
              expectedLogicalCpus: 12,
            }),
          },
        }
      : {}),
  };
  const dependencies = {
    createApplicationListing: () => ({ applications: [application] }),
    createNativeContext: async (_sourceRoot, nativeOptions) => {
      events.push('context:create');
      assert.equal(nativeOptions.runId, options.runId);
      for (const name of [
        'verifyDockerFixture',
        'verifyGitHistory',
        'verifyNetworkBoundary',
        'withRepositoryIsolation',
      ])
        assert.equal(nativeOptions[name], containment[name]);
      return {
        binding: {
          plan: {
            runId: 'production-run-1',
            candidate,
            executionEnvironmentSha256: digest('e'),
            maxSlots: runCapacity.configuredWorkers,
            lanes: ['repository', 'codeql', 'build', 'browser'].map(
              (id, index) => ({
                id,
                kind: id === 'build' ? 'compile' : 'check',
                required: true,
                dependsOn: [],
                after: index
                  ? [['repository', 'codeql', 'build', 'browser'][index - 1]]
                  : [],
                prerequisites: [],
              })
            ),
            units: ['repository', 'codeql', 'build', 'browser'].map((lane) => ({
              id: `native-${lane}`,
              lane,
              slots: runCapacity.configuredWorkers,
              reads: ['source-manifest'],
              writes: [
                lane === 'browser' ? 'scratch-browser' : `scratch-${lane}`,
              ],
              files: lane === 'repository' ? ['a.test.ts'] : [],
              dependsOn: lane === 'browser' ? ['native-build'] : [],
              after: [],
            })),
          },
          capacity: runCapacity,
          resultReuse: false,
        },
        report: {
          runId: 'production-run-1',
          status: 'ready',
          candidate,
          capacity: runCapacity,
          executionEnvironmentSha256: digest('e'),
          sourceManifest: { sha256: candidate.sourceSha256 },
          blockedRequired: [],
          pendingMetadata: [],
          stages: ['repository', 'codeql', 'build', 'browser'],
          resultReuse: false,
        },
        pendingMetadata: [],
        describeNativeProcessReceipts: () => ({
          file: ledgerPath,
          sha256: hash(ledgerBytes),
          records: 1,
          pending: [],
          cleanupVerified: true,
        }),
        cleanup: async () => {
          events.push('context:cleanup');
          if (failure === 'cleanup') throw new Error('Focused cleanup failure');
        },
      };
    },
    executeStagedValidation: async (_context, launch, bridgeDependencies) =>
      await bridgeDependencies.withDistributedNetwork(async () => {
        assert.equal(launch.controller.runId, options.runId);
        events.push('stages:four');
        return result;
      }),
    persistTimingProfile: async (path, profile) => {
      events.push('profile:persist');
      profilePersistCalls += 1;
      if (failure === 'persist')
        throw new Error('Focused profile persistence failure');
      durableProfile = structuredClone(profile);
      writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, {
        flag: 'wx',
      });
      return profile;
    },
    readEvidenceFile: (path) =>
      preparationFiles.has(path)
        ? preparationFiles.get(path)
        : readFileSync(path),
    readTimingProfile: async () => {
      events.push('profile:read');
      return structuredClone(durableProfile);
    },
    reconcileEvidence: async ({ files }) => {
      events.push('evidence:reconcile');
      assert.equal(existsSync(files.result), true);
      assert.equal(existsSync(files.timings), true);
      assert.equal(existsSync(files.processLedger), true);
      assert.equal(existsSync(files.processLedgerSummary), true);
      assert.equal(existsSync(files.processStreams), true);
      assert.equal(existsSync(files.runExpectations), true);
      if (failure === 'reconciliation')
        throw new Error('Focused reconciliation failure');
      const durableResult = JSON.parse(readFileSync(files.result, 'utf8'));
      return {
        schema: 'test-independent-reconciliation/v1',
        ok: true,
        status: 'passed',
        repositoryEvidence:
          durableResult.nativeEvidence['native-repository'].repositoryEvidence,
      };
    },
    resolveActiveConfig: async () => {
      events.push('config:resolve');
      return active;
    },
    writeEvidenceFile: (path, bytes) => {
      events.push(`write:${basename(path)}`);
      if (
        failure === 'contained-receipt' &&
        basename(path) === 'contained-run-verification.json'
      )
        throw new Error('Focused contained-run receipt failure');
      writeFileSync(path, bytes, { flag: 'wx' });
      return { bytes: bytes.length, sha256: hash(bytes) };
    },
  };
  if (failure === 'profile')
    dependencies.updateTimingProfileBatch = (_profile, observations) => ({
      profile: structuredClone(initialProfile),
      accepted: false,
      reason: 'focused-profile-failure',
      updatedTests: 0,
      observationCount: observations.length,
    });
  return {
    dependencies,
    events,
    getDurableProfile: () => structuredClone(durableProfile),
    getProfilePersistCalls: () => profilePersistCalls,
    initialProfile,
    options,
    preparationFiles,
  };
}

test('green production lifecycle persists one profile and writes its contained-run receipt last', async (t) => {
  const fixture = harness(t);
  const outcome = await executeDistributedLinuxProductionRun(
    fixture.options,
    fixture.dependencies
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 'passed');
  assert.equal(fixture.getProfilePersistCalls(), 1);
  assert.equal(fixture.getDurableProfile().scopes.length, 1);
  assert.equal(existsSync(outcome.files.containedRunVerification), true);
  assert.equal(
    fixture.events.indexOf('network:restored') <
      fixture.events.indexOf('write:staged-validation-result.json'),
    true
  );
  assert.equal(
    fixture.events.indexOf('context:cleanup') <
      fixture.events.indexOf('evidence:reconcile'),
    true
  );
  assert.equal(
    fixture.events.indexOf('evidence:reconcile') <
      fixture.events.indexOf('profile:persist'),
    true
  );
  assert.equal(fixture.events.at(-1), 'write:contained-run-verification.json');
  const marker = JSON.parse(
    readFileSync(outcome.files.containedRunVerification, 'utf8')
  );
  assert.equal(marker.ok, true);
  assert.equal(marker.status, 'passed');
  assert.equal(
    marker.schema,
    'seerrng-distributed-linux-contained-run-success/v2'
  );
  const retainedLedger = readFileSync(outcome.files.processLedger);
  const retainedLedgerSummary = readFileSync(
    outcome.files.processLedgerSummary
  );
  const retainedStreams = readFileSync(outcome.files.processStreams);
  const retainedExpectations = readFileSync(outcome.files.runExpectations);
  const retainedHostPreparation = readFileSync(
    outcome.files.hostPreparationReceipt
  );
  const streamBundle = JSON.parse(retainedStreams.toString('utf8'));
  assert.equal(marker.processLedgerSha256, hash(retainedLedger));
  assert.equal(marker.processLedgerSummarySha256, hash(retainedLedgerSummary));
  assert.equal(marker.processStreamsSha256, hash(retainedStreams));
  assert.equal(marker.runExpectationsSha256, hash(retainedExpectations));
  assert.equal(
    marker.hostPreparationReceiptSha256,
    hash(retainedHostPreparation)
  );
  assert.deepEqual(
    JSON.parse(retainedHostPreparation).inputs.map(({ role }) => role),
    fixture.options.hostPreparation.inputs.map(({ role }) => role)
  );
  assert.equal(streamBundle.sourceLedgerSha256, hash(retainedLedger));
  assert.equal(streamBundle.recordCount, 1);
  assert.equal(streamBundle.streamCount, 2);
  assert.equal(
    Buffer.from(
      streamBundle.records[0].streams.stdout.contentBase64,
      'base64'
    ).toString('utf8'),
    'focused output\n'
  );
  assert.equal(
    Buffer.from(streamBundle.records[0].streams.stderr.contentBase64, 'base64')
      .length,
    0
  );
  assert.equal(
    marker.updatedProfileSha256,
    outcome.timingUpdate.updatedProfileSha256
  );
  const timingProfileBytes = readFileSync(fixture.options.timingProfilePath);
  assert.equal(marker.timingProfileFileSha256, hash(timingProfileBytes));
  assert.notEqual(marker.timingProfileFileSha256, marker.updatedProfileSha256);
});

test('production rejects mutation of every sealed preparation input before launch', async (t) => {
  for (const role of [
    'controller-config',
    'active-controller-marker',
    'timing-profile-seed',
    'authenticated-git-evidence',
    'proof-parent-config',
    'proof-parent-script',
    'containment-manifest',
    'contained-request',
  ]) {
    await t.test(role, async (t) => {
      const fixture = harness(t);
      const input = fixture.options.hostPreparation.inputs.find(
        (entry) => entry.role === role
      );
      fixture.preparationFiles.set(
        input.containerPath,
        Buffer.from(`mutated ${role}\n`, 'utf8')
      );
      await assert.rejects(
        executeDistributedLinuxProductionRun(
          fixture.options,
          fixture.dependencies
        ),
        new RegExp(`raw hash differs: ${role}`, 'u')
      );
      assert.ok(!fixture.events.includes('config:resolve'));
      assert.ok(!fixture.events.includes('context:create'));
    });
  }
});

test('required proof seals exact controller and Node 01 fleet capacity before execution', async (t) => {
  const fixture = harness(t, null, { requiredProof: true });
  const outcome = await executeDistributedLinuxProductionRun(
    fixture.options,
    fixture.dependencies
  );
  const expectations = JSON.parse(
    readFileSync(outcome.files.runExpectations, 'utf8')
  );
  assert.equal(expectations.runId, fixture.options.runId);
  assert.equal(expectations.capacity.configuredWorkers, 24);
  assert.deepEqual(
    expectations.requiredFleetProof.nodes.map(
      ({ nodeId, availableThreads, admittedThreads }) => ({
        nodeId,
        availableThreads,
        admittedThreads,
      })
    ),
    [
      {
        nodeId: 'controller',
        availableThreads: 12,
        admittedThreads: 24,
      },
      { nodeId: 'node-01', availableThreads: 8, admittedThreads: 6 },
    ]
  );
  assert.equal(
    expectations.requiredFleetProof.requireAtLeastOneShardPerNode,
    true
  );
});

test('required fleet proof derives every additional configured node without hardware literals', async (t) => {
  const fixture = harness(t, null, {
    requiredProof: true,
    additionalNode: true,
  });
  const outcome = await executeDistributedLinuxProductionRun(
    fixture.options,
    fixture.dependencies
  );
  const expectations = JSON.parse(
    readFileSync(outcome.files.runExpectations, 'utf8')
  );
  assert.deepEqual(
    expectations.requiredFleetProof.nodes.map(
      ({ nodeId, admittedThreads }) => ({ nodeId, admittedThreads })
    ),
    [
      { nodeId: 'controller', admittedThreads: 24 },
      { nodeId: 'node-01', admittedThreads: 6 },
      { nodeId: 'node-02', admittedThreads: 16 },
    ]
  );
});

for (const failure of [
  'stage',
  'reconciliation',
  'cleanup',
  'profile',
  'persist',
])
  test(`${failure} failure preserves evidence without a marker or unintended profile update`, async (t) => {
    const fixture = harness(t, failure);
    await assert.rejects(
      executeDistributedLinuxProductionRun(
        fixture.options,
        fixture.dependencies
      )
    );

    assert.equal(existsSync(fixture.options.evidenceDirectory), true);
    assert.equal(
      existsSync(
        join(
          fixture.options.evidenceDirectory,
          'contained-run-verification.json'
        )
      ),
      false
    );
    assert.equal(
      existsSync(join(fixture.options.evidenceDirectory, 'failure.json')),
      true
    );
    assert.deepEqual(fixture.getDurableProfile(), fixture.initialProfile);
    if (failure === 'persist')
      assert.equal(fixture.getProfilePersistCalls(), 1);
    else assert.equal(fixture.getProfilePersistCalls(), 0);
  });

test('production options reject a native worker override before launch', async (t) => {
  const fixture = harness(t);
  fixture.options.nativeContextOptions = { workerOverride: 24 };
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /native context options contains unsupported fields/u
  );
  assert.equal(existsSync(fixture.options.evidenceDirectory), false);
});

test('production options reject a non-AbortSignal before launch', async (t) => {
  const fixture = harness(t);
  fixture.options.signal = null;
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /signal must be an AbortSignal/u
  );
  assert.equal(existsSync(fixture.options.evidenceDirectory), false);
});

test('contained-run receipt failure preserves the accepted timing update without claiming success', async (t) => {
  const fixture = harness(t, 'contained-receipt');
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /contained-run receipt failure/u
  );

  assert.equal(fixture.getProfilePersistCalls(), 1);
  assert.equal(fixture.getDurableProfile().scopes.length, 1);
  assert.equal(
    existsSync(
      join(fixture.options.evidenceDirectory, 'contained-run-verification.json')
    ),
    false
  );
  assert.equal(
    existsSync(join(fixture.options.evidenceDirectory, 'failure.json')),
    true
  );
});
