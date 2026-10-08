// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { executeDistributedLinuxStagedValidation } from '../tools/validation-engine/runtime/distributed-linux-staged-bridge.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { createControllerConfig } from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases.
import { createStagedValidation } from '../tools/validation-engine/runtime/staged-validation.mjs';
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from './distributed-native-case-ledger-test-fixture.mjs';

const RUNTIME_APPLICATION_KEY = 'seerrng';
const CONFIGURED_APPLICATION_ID = 'SeerrNG 3.17.0';
const APPLICATION_ROOT = resolve('focused-distributed-linux-staged-bridge');
const PROFILE_PATH = resolve(
  'tools/validation-engine/setup/seerrng-test-suite-dependancies.cfg'
);
const CONTROLLER_CPU = 'Focused controller CPU';
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

function catalog(selectedCandidate) {
  const files = ['bin/focused.test.mjs'];
  const task = {
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({
      applicationId: RUNTIME_APPLICATION_KEY,
      adapterId: 'node-js',
      files,
    }),
    adapterId: 'node-js',
    files,
  };
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: RUNTIME_APPLICATION_KEY,
    platform: 'linux',
    candidate: nativeCandidate(selectedCandidate),
    inventorySha256: sha256('focused-inventory'),
    tasks: [task],
  };
  return { ...core, catalogSha256: canonicalJsonSha256(core) };
}

function passingTaskResult(catalogValue, taskId) {
  const task = catalogValue.tasks.find((entry) => entry.taskId === taskId);
  assert.ok(task);
  const counts = { active: 1, total: 1 };
  const stdout = createNativeCaseReportFixture(task, counts);
  const stderr = '';
  const receipt = {
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
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: RUNTIME_APPLICATION_KEY,
    candidateSha256: catalogValue.candidate.candidateSha256,
    catalogSha256: catalogValue.catalogSha256,
    taskId,
    adapterId: task.adapterId,
    files: [...task.files],
    status: 'passed',
    wallMs: 1,
    totals: { [task.adapterId]: counts },
    caseLedger: createNativeCaseLedgerFixture(task, counts),
    receipt,
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

function stagedBinding(selectedCandidate) {
  const repositoryPlan = {
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
    ],
  };
  return createStagedValidation({
    runId: 'focused-staged-bridge',
    candidate: selectedCandidate,
    executionEnvironmentSha256: sha256('environment'),
    capacity: { configuredWorkers: 2, effectiveLogicalCpus: 2 },
    repositoryPlan,
    codeqlPlan: {
      sourceIdentity: { sha256: selectedCandidate.sourceSha256 },
      artifacts: [],
      steps: [{ id: 'focused-codeql' }],
    },
    buildBrowserPlan: {
      candidate: selectedCandidate,
      configuredWorkers: 2,
      cypressSpecs: ['cypress/e2e/focused.cy.ts'],
      playwrightSpecs: ['playwright/focused.spec.ts'],
      build: [{ id: 'focused-build' }],
    },
  });
}

function controllerConfig() {
  return createControllerConfig({
    global: {
      githubUsername: 'JohnCronk79',
      computerName: "John's laptop",
      ipAddress: '127.0.0.2',
      port: 49_100,
      cpuName: CONTROLLER_CPU,
      availableThreads: 2,
      threads: 'n',
      minimumThreadCount: 1,
    },
    nodes: [],
    sharedAuthenticationKey: SHARED_KEY,
  });
}

function launch(application) {
  return {
    application,
    controller: {
      config: controllerConfig(),
      timingProfile: createAdaptiveTimingProfile(),
      runId: 'focused-controller-run',
    },
  };
}

function networkLease(events = []) {
  return async (operation, context) => {
    assert.deepEqual(context, {
      applicationId: RUNTIME_APPLICATION_KEY,
      applicationRoot: APPLICATION_ROOT,
      repositoryIdentitySha256: sha256('source'),
      runId: 'focused-controller-run',
      signal: undefined,
      unitId: 'native-repository-distributed',
    });
    assert.ok(Object.isFrozen(context));
    events.push('network:enter');
    const result = await operation();
    events.push('network:exit');
    return result;
  };
}

function preparedContext(selectedCandidate, events) {
  const executeRepositoryCheck = async (step, { index }) => {
    events.push(`local:${index}:${step.name}`);
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
  };
  return {
    binding: stagedBinding(selectedCandidate),
    options: {
      executeRepositoryCheck,
      executeRepository: async () => {
        throw new Error('Original repository executor must be replaced');
      },
      withRepositoryIsolation: async (operation) => operation(),
      run: async (command) => {
        events.push(`later:${command.id}`);
        throw new Error('Focused later-stage stop');
      },
      readFile: async () => '',
      writeArtifact: async () => {},
      verifySource: async () => events.push('verify-source'),
    },
  };
}

test('binds a prepared native context to the real Linux controller while keeping human and runtime IDs distinct', async () => {
  const selectedCandidate = candidate();
  const catalogValue = catalog(selectedCandidate);
  const events = [];
  const result = await executeDistributedLinuxStagedValidation(
    preparedContext(selectedCandidate, events),
    launch({
      runtimeApplicationKey: RUNTIME_APPLICATION_KEY,
      supportedApplication: {
        entryId: '01',
        applicationId: CONFIGURED_APPLICATION_ID,
        name: 'SeerrNG development',
        profilePath: PROFILE_PATH,
      },
    }),
    {
      withDistributedNetwork: networkLease(events),
      profileDetector: () => ({
        cpuName: CONTROLLER_CPU,
        availableThreads: 2,
      }),
      dependencyProfileReader: (profilePath) => {
        assert.equal(profilePath, PROFILE_PATH);
        events.push('dependency-profile');
        return [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ];
      },
      catalogDiscovery: (root, options) => {
        assert.equal(root, APPLICATION_ROOT);
        assert.deepEqual(options, { applicationId: RUNTIME_APPLICATION_KEY });
        assert.notEqual(options.applicationId, CONFIGURED_APPLICATION_ID);
        events.push('catalog');
        return catalogValue;
      },
      localTaskExecutor: async ({ root, applicationId, request }) => {
        assert.equal(root, APPLICATION_ROOT);
        assert.equal(applicationId, RUNTIME_APPLICATION_KEY);
        events.push(`task:${request.taskId}`);
        return passingTaskResult(catalogValue, request.taskId);
      },
    }
  );

  assert.deepEqual(result.distributedApplication, {
    runtimeApplicationKey: RUNTIME_APPLICATION_KEY,
    configuredApplicationId: CONFIGURED_APPLICATION_ID,
    dependencyProfilePath: PROFILE_PATH,
    supportedApplication: {
      entryId: '01',
      applicationId: CONFIGURED_APPLICATION_ID,
      name: 'SeerrNG development',
      profilePath: PROFILE_PATH,
    },
  });
  assert.equal(
    result.nativeEvidence['native-repository'].repositoryEvidence.completed,
    true
  );
  assert.deepEqual(result.nativeEvidence['native-repository'].cases, {
    passed: 1,
    failed: 0,
    skipped: 0,
  });
  assert.deepEqual(
    events.filter((entry) =>
      /^(?:local|network|dependency|catalog|task|later)/u.test(entry)
    ),
    [
      'local:0:Formatting',
      'network:enter',
      'dependency-profile',
      'catalog',
      `task:${catalogValue.tasks[0].taskId}`,
      'network:exit',
      'later:focused-codeql',
      'later:focused-build',
    ]
  );
  assert.ok(Object.isFrozen(result));
});

test('accepts an explicit runtime key and configured ID without conflating them', async () => {
  const selectedCandidate = candidate();
  const catalogValue = catalog(selectedCandidate);
  const result = await executeDistributedLinuxStagedValidation(
    preparedContext(selectedCandidate, []),
    launch({
      runtimeApplicationKey: RUNTIME_APPLICATION_KEY,
      configuredApplicationId: CONFIGURED_APPLICATION_ID,
      dependencyProfilePath: PROFILE_PATH,
    }),
    {
      withDistributedNetwork: networkLease(),
      profileDetector: () => ({
        cpuName: CONTROLLER_CPU,
        availableThreads: 2,
      }),
      dependencyProfileReader: () => [],
      catalogDiscovery: () => catalogValue,
      localTaskExecutor: async ({ request }) =>
        passingTaskResult(catalogValue, request.taskId),
    }
  );
  assert.equal(
    result.distributedApplication.runtimeApplicationKey,
    RUNTIME_APPLICATION_KEY
  );
  assert.equal(
    result.distributedApplication.configuredApplicationId,
    CONFIGURED_APPLICATION_ID
  );
  assert.equal(result.distributedApplication.supportedApplication, null);
});

test('fails closed when the host network lease skips or repeats the controller', async (t) => {
  const selectedCandidate = candidate();
  const catalogValue = catalog(selectedCandidate);
  const application = {
    runtimeApplicationKey: RUNTIME_APPLICATION_KEY,
    configuredApplicationId: CONFIGURED_APPLICATION_ID,
    dependencyProfilePath: PROFILE_PATH,
  };
  const controllerDependencies = {
    profileDetector: () => ({
      cpuName: CONTROLLER_CPU,
      availableThreads: 2,
    }),
    dependencyProfileReader: () => [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ],
    catalogDiscovery: () => catalogValue,
    localTaskExecutor: async ({ request }) =>
      passingTaskResult(catalogValue, request.taskId),
  };

  await t.test('skipped controller', async () => {
    const events = [];
    const result = await executeDistributedLinuxStagedValidation(
      preparedContext(selectedCandidate, events),
      launch(application),
      {
        ...controllerDependencies,
        withDistributedNetwork: async () => null,
      }
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.ok, false);
    assert.match(
      result.nativeEvidence['native-repository'].reason,
      /did not invoke the controller/u
    );
    assert.ok(events.includes('later:focused-codeql'));
  });

  await t.test('repeated controller', async () => {
    const events = [];
    const result = await executeDistributedLinuxStagedValidation(
      preparedContext(selectedCandidate, events),
      launch(application),
      {
        ...controllerDependencies,
        withDistributedNetwork: async (operation) => {
          const operationResult = await operation();
          await assert.rejects(operation, /more than once/u);
          return operationResult;
        },
      }
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.ok, false);
    assert.match(
      result.nativeEvidence['native-repository'].reason,
      /more than once/u
    );
    assert.ok(events.includes('later:focused-codeql'));
  });
});

test('fails closed on ambiguous IDs, caller-owned execution facts and unsupported dependencies', async (t) => {
  const selectedCandidate = candidate();
  const context = preparedContext(selectedCandidate, []);
  const application = {
    runtimeApplicationKey: RUNTIME_APPLICATION_KEY,
    configuredApplicationId: CONFIGURED_APPLICATION_ID,
    dependencyProfilePath: PROFILE_PATH,
  };
  for (const entry of [
    {
      name: 'human ID used as runtime key',
      launch: launch({
        ...application,
        runtimeApplicationKey: CONFIGURED_APPLICATION_ID,
      }),
      dependencies: {},
      error: /machine-safe identifier/u,
    },
    {
      name: 'caller application root override',
      launch: {
        ...launch(application),
        applicationRoot: APPLICATION_ROOT,
      },
      dependencies: {},
      error: /unexpected or missing fields/u,
    },
    {
      name: 'caller repository identity override',
      launch: {
        ...launch(application),
        controller: {
          ...launch(application).controller,
          repositoryIdentitySha256: selectedCandidate.sourceSha256,
        },
      },
      dependencies: {},
      error: /unexpected or missing fields/u,
    },
    {
      name: 'controller runner replacement',
      launch: launch(application),
      dependencies: {
        controllerRunner: async () => {},
        withDistributedNetwork: networkLease(),
      },
      error: /unexpected or missing fields/u,
    },
    {
      name: 'missing distributed network lease',
      launch: launch(application),
      dependencies: {},
      error: /unexpected or missing fields/u,
    },
  ])
    await t.test(entry.name, async () => {
      await assert.rejects(
        executeDistributedLinuxStagedValidation(
          context,
          entry.launch,
          entry.dependencies
        ),
        entry.error
      );
    });
});
