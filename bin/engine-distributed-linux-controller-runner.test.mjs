// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DISTRIBUTED_LINUX_APPLICATION_ADMISSION_SCHEMA,
  formatDistributedDependencyAdmission,
  runDistributedLinuxController,
} from '../tools/validation-engine/runtime/distributed-linux-controller-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  createControllerConfig,
  createNodeConfig,
  serializeNodeConfig,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA } from '../tools/validation-engine/runtime/distributed-linux-node-attestation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
  DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA,
  DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
  DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA,
  distributedLinuxControllerId,
  resolveDistributedLinuxTaskTimeoutBudget,
  startDistributedLinuxNodeRunner,
} from '../tools/validation-engine/runtime/distributed-linux-node-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
} from '../tools/validation-engine/runtime/distributed-node-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from './distributed-native-case-ledger-test-fixture.mjs';

const SHARED_KEY = 'a'.repeat(64);
const APPLICATION_ID = 'seerrng';
const APPLICATION_ROOT = resolve('focused-linux-controller-application');
const CONTROLLER_CPU = 'Focused Controller CPU';
const REMOTE_CPU = 'Focused Remote CPU';
const REPOSITORY_IDENTITY = 'b'.repeat(64);
const services = new Set();

afterEach(async () => {
  await Promise.allSettled([...services].map((service) => service.close()));
  services.clear();
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runtimeAttestation(remote) {
  const core = {
    schema: DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA,
    activeNodeConfigSha256: sha256(serializeNodeConfig(nodeConfig(remote))),
    runnerClosureSha256: sha256('focused-runner-closure'),
    nodeExecutableSha256: sha256('focused-node-executable'),
    nodeVersion: 'v24.21.0',
    platform: 'linux',
    architecture: 'x64',
  };
  return Object.freeze({
    ...core,
    attestationSha256: canonicalJsonSha256(core),
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  );
  return address.port;
}

function candidate() {
  const core = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: sha256('commit').slice(0, 40),
    treeSha: sha256('tree').slice(0, 40),
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: sha256('lockfile'),
  };
  return Object.freeze({
    ...core,
    candidateSha256: canonicalJsonSha256(core),
  });
}

function nativeTask(applicationId, adapterId, file) {
  const files = [file];
  return Object.freeze({
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({ applicationId, adapterId, files }),
    adapterId,
    files: Object.freeze(files),
  });
}

function catalog(taskCount = 4) {
  const candidateValue = candidate();
  const tasks = Array.from({ length: taskCount }, (_, index) =>
    nativeTask(
      APPLICATION_ID,
      'node-js',
      `bin/focused-${String(index + 1).padStart(2, '0')}.test.mjs`
    )
  ).toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: APPLICATION_ID,
    platform: 'linux',
    candidate: candidateValue,
    inventorySha256: sha256('focused-inventory'),
    tasks,
  };
  return Object.freeze({
    ...core,
    catalogSha256: canonicalJsonSha256(core),
  });
}

function passingResult(catalogValue, taskId) {
  const task = catalogValue.tasks.find((entry) => entry.taskId === taskId);
  assert.ok(task);
  const counts = { total: 1, active: 1 };
  const stdout = createNativeCaseReportFixture(task, counts);
  const stderr = '';
  const receipt = {
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
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: catalogValue.applicationId,
    candidateSha256: catalogValue.candidate.candidateSha256,
    catalogSha256: catalogValue.catalogSha256,
    taskId,
    adapterId: task.adapterId,
    files: [...task.files],
    status: 'passed',
    wallMs: 3,
    totals: { [task.adapterId]: counts },
    caseLedger: createNativeCaseLedgerFixture(task, counts),
    receipt,
  };
  return Object.freeze({
    ...core,
    resultSha256: canonicalJsonSha256(core),
  });
}

function controllerConfig(remoteNodes = [], changes = {}) {
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
    nodes: remoteNodes,
    sharedAuthenticationKey: SHARED_KEY,
    ...changes,
  });
}

function remoteConfig(port, overrides = {}) {
  return {
    nodeNumber: overrides.nodeNumber ?? '01',
    computerName: overrides.computerName ?? 'Focused remote node',
    ipAddress: overrides.ipAddress ?? '127.0.0.1',
    port,
    cpuName: overrides.cpuName ?? REMOTE_CPU,
    availableThreads: overrides.availableThreads ?? 2,
    threads: overrides.threads ?? 'n',
    minimumThreadCount: overrides.minimumThreadCount ?? 1,
  };
}

function nodeConfig(remote) {
  return createNodeConfig({
    controller: { ipAddress: '127.0.0.2', port: 49_100 },
    node: {
      nodeNumber: remote.nodeNumber,
      computerName: remote.computerName,
      ipAddress: remote.ipAddress,
      port: remote.port,
      cpuName: remote.cpuName,
      availableThreads: remote.availableThreads,
    },
    sharedAuthenticationKey: SHARED_KEY,
  });
}

function baseRunOptions(config, catalogValue, overrides = {}) {
  let requestSequence = 0;
  return {
    config,
    applicationId: APPLICATION_ID,
    applicationRoot: APPLICATION_ROOT,
    repositoryIdentitySha256: REPOSITORY_IDENTITY,
    timingProfile: createAdaptiveTimingProfile(),
    runId: overrides.runId ?? 'focused-run-001',
    profileDetector: () => ({
      cpuName: CONTROLLER_CPU,
      availableThreads: 2,
    }),
    catalogDiscovery: (root, options) => {
      assert.equal(root, APPLICATION_ROOT);
      assert.deepEqual(options, { applicationId: APPLICATION_ID });
      return catalogValue;
    },
    localTaskExecutor: async ({ request }) =>
      passingResult(catalogValue, request.taskId),
    requestIdFactory: ({ kind }) => {
      requestSequence += 1;
      return `${kind}-${requestSequence}`;
    },
    ...overrides,
  };
}

function probeReport(configuredNode, catalogValue, requestId, overrides = {}) {
  return {
    schema: DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
    requestId,
    attestation: overrides.attestation ?? runtimeAttestation(configuredNode),
    node: {
      nodeId: `node-${configuredNode.nodeNumber}`,
      nodeNumber: configuredNode.nodeNumber,
      computerName: configuredNode.computerName,
      ipAddress: configuredNode.ipAddress,
      port: configuredNode.port,
      cpuName: configuredNode.cpuName,
      availableThreads: configuredNode.availableThreads,
    },
    applications: [
      {
        applicationId: APPLICATION_ID,
        status: 'available',
        platform: catalogValue.platform,
        candidateSha256:
          overrides.candidateSha256 ?? catalogValue.candidate.candidateSha256,
        catalogSha256: catalogValue.catalogSha256,
        inventorySha256:
          overrides.inventorySha256 ?? catalogValue.inventorySha256,
        taskCount: catalogValue.tasks.length,
      },
    ],
  };
}

test('runs one full catalog across controller and real authenticated node transport', async () => {
  const catalogValue = catalog();
  const port = await availablePort();
  const remote = remoteConfig(port);
  const controller = controllerConfig([remote]);
  const localCalls = [];
  const remoteCalls = [];
  const nodeService = await startDistributedLinuxNodeRunner({
    config: nodeConfig(remote),
    applications: [{ applicationId: APPLICATION_ID, root: APPLICATION_ROOT }],
    profileDetector: () => ({
      cpuName: REMOTE_CPU,
      availableThreads: 2,
    }),
    catalogDiscovery: () => catalogValue,
    attestationFactory: async () => runtimeAttestation(remote),
    taskExecutor: async ({ request }) => {
      remoteCalls.push(request.taskId);
      return passingResult(catalogValue, request.taskId);
    },
  });
  services.add(nodeService);

  const result = await runDistributedLinuxController(
    baseRunOptions(controller, catalogValue, {
      localTaskExecutor: async ({ request }) => {
        localCalls.push(request.taskId);
        return passingResult(catalogValue, request.taskId);
      },
    })
  );

  assert.equal(result.catalog.catalogSha256, catalogValue.catalogSha256);
  assert.equal(result.schedule.applicationId, APPLICATION_ID);
  assert.equal(result.runReport.status, 'passed');
  assert.equal(result.runReport.outcomes.length, catalogValue.tasks.length);
  assert.deepEqual(
    result.onlineNodes.map(({ nodeId }) => nodeId),
    ['controller', 'node-01']
  );
  assert.deepEqual(result.offlineNodes, []);
  assert.ok(localCalls.length > 0);
  assert.ok(remoteCalls.length > 0);
  assert.equal(
    localCalls.length + remoteCalls.length,
    catalogValue.tasks.length
  );
  assert.equal(
    new Set([...localCalls, ...remoteCalls]).size,
    catalogValue.tasks.length
  );
  assert.ok(
    result.onlineNodes.every(
      (entry) =>
        entry.candidateSha256 === catalogValue.candidate.candidateSha256 &&
        entry.catalogSha256 === catalogValue.catalogSha256 &&
        entry.inventorySha256 === catalogValue.inventorySha256
    )
  );
  assert.deepEqual(
    result.onlineNodes.find(({ nodeId }) => nodeId === 'node-01')
      .nodeAttestation,
    runtimeAttestation(remote)
  );
  assert.equal(JSON.stringify(result).includes(SHARED_KEY), false);
  assert.ok(Object.isFrozen(result));
});

test('keeps the controller request alive beyond the native and node-handler budgets', async () => {
  const catalogValue = catalog();
  const remote = remoteConfig(49_104, { availableThreads: 8 });
  const taskTimeoutMs = 30_001;
  const budget = resolveDistributedLinuxTaskTimeoutBudget(taskTimeoutMs);
  const transportCalls = [];
  const localCalls = [];
  const result = await runDistributedLinuxController(
    baseRunOptions(controllerConfig([remote]), catalogValue, {
      taskTimeoutMs,
      localTaskExecutor: async (options) => {
        localCalls.push(options);
        return passingResult(catalogValue, options.request.taskId);
      },
      transportRequester: async (options) => {
        transportCalls.push(options);
        if (options.kind === DISTRIBUTED_NODE_PROBE_KIND)
          return {
            body: probeReport(remote, catalogValue, options.requestId),
          };
        assert.equal(options.kind, DISTRIBUTED_NODE_TASK_KIND);
        return {
          body: {
            schema: DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
            requestId: options.requestId,
            nodeId: 'node-01',
            applicationId: APPLICATION_ID,
            candidateSha256: catalogValue.candidate.candidateSha256,
            catalogSha256: catalogValue.catalogSha256,
            nodeAttestationSha256: runtimeAttestation(remote).attestationSha256,
            taskId: options.body.request.taskId,
            result: passingResult(catalogValue, options.body.request.taskId),
          },
        };
      },
    })
  );

  const taskCalls = transportCalls.filter(
    ({ kind }) => kind === DISTRIBUTED_NODE_TASK_KIND
  );
  assert.ok(taskCalls.length > 0);
  assert.ok(
    taskCalls.every(({ timeoutMs }) => timeoutMs === budget.requestTimeoutMs)
  );
  assert.ok(budget.requestTimeoutMs > budget.handlerTimeoutMs);
  assert.ok(budget.handlerTimeoutMs > budget.taskTimeoutMs);
  assert.ok(localCalls.length > 0);
  assert.ok(
    localCalls.every(({ timeoutMs }) => timeoutMs === budget.taskTimeoutMs)
  );
  assert.equal(result.runReport.status, 'passed');
});

test('excludes only recognized connectivity failures and executes every shard locally', async () => {
  const catalogValue = catalog(2);
  const remote = remoteConfig(49_101);
  const calls = [];
  const transportCalls = [];
  const result = await runDistributedLinuxController(
    baseRunOptions(controllerConfig([remote]), catalogValue, {
      transportRequester: async (options) => {
        transportCalls.push(options);
        throw Object.assign(new Error('connection refused'), {
          code: 'ECONNREFUSED',
        });
      },
      localTaskExecutor: async ({ request }) => {
        calls.push(request.taskId);
        return passingResult(catalogValue, request.taskId);
      },
    })
  );

  assert.equal(transportCalls.length, 1);
  assert.equal(transportCalls[0].kind, DISTRIBUTED_NODE_PROBE_KIND);
  assert.equal(transportCalls[0].sharedKey, SHARED_KEY);
  assert.equal(
    transportCalls[0].controllerId,
    distributedLinuxControllerId({ ipAddress: '127.0.0.2', port: 49_100 })
  );
  assert.equal(
    transportCalls[0].body.schema,
    DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA
  );
  assert.deepEqual(
    result.onlineNodes.map(({ nodeId }) => nodeId),
    ['controller']
  );
  assert.deepEqual(result.offlineNodes, [
    {
      nodeId: 'node-01',
      computerName: remote.computerName,
      ipAddress: remote.ipAddress,
      port: remote.port,
      failureCode: 'ECONNREFUSED',
    },
  ]);
  assert.equal(calls.length, catalogValue.tasks.length);
  assert.equal(result.runReport.status, 'passed');
});

test('keeps an online node available but unusable when this application is not configured', async () => {
  const catalogValue = catalog(2);
  const remote = remoteConfig(49_107);
  const calls = [];
  const transportCalls = [];
  const result = await runDistributedLinuxController(
    baseRunOptions(controllerConfig([remote]), catalogValue, {
      transportRequester: async (options) => {
        transportCalls.push(options);
        assert.equal(options.kind, DISTRIBUTED_NODE_PROBE_KIND);
        return {
          body: {
            schema: DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
            requestId: options.requestId,
            attestation: runtimeAttestation(remote),
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
                status: 'unavailable',
                reason: 'application-not-configured',
              },
            ],
          },
        };
      },
      localTaskExecutor: async ({ request }) => {
        calls.push(request.taskId);
        return passingResult(catalogValue, request.taskId);
      },
    })
  );

  assert.equal(transportCalls.length, 1);
  assert.equal(result.runReport.status, 'passed');
  assert.equal(calls.length, catalogValue.tasks.length);
  assert.deepEqual(
    result.onlineNodes.map(({ nodeId }) => nodeId),
    ['controller']
  );
  assert.deepEqual(result.offlineNodes, []);
  assert.equal(
    result.applicationAdmission.schema,
    DISTRIBUTED_LINUX_APPLICATION_ADMISSION_SCHEMA
  );
  assert.deepEqual(
    result.applicationAdmission.availableNodes.map(({ nodeId }) => nodeId),
    ['controller', 'node-01']
  );
  assert.deepEqual(
    result.applicationAdmission.usableNodes.map(({ nodeId }) => nodeId),
    ['controller']
  );
  assert.deepEqual(result.applicationAdmission.excludedNodes, [
    {
      nodeId: 'node-01',
      nodeNumber: '01',
      computerName: remote.computerName,
      ipAddress: remote.ipAddress,
      port: remote.port,
      cpuName: remote.cpuName,
      availableThreads: remote.availableThreads,
      applicationId: APPLICATION_ID,
      reason: 'application-not-configured',
    },
  ]);
});

test('fails closed for authentication, schema, and exact inventory mismatches', async (context) => {
  const catalogValue = catalog(2);
  const remote = remoteConfig(49_102);
  const config = controllerConfig([remote]);
  await context.test('authentication failure is not offline', async () => {
    await assert.rejects(
      runDistributedLinuxController(
        baseRunOptions(config, catalogValue, {
          transportRequester: async () => {
            throw Object.assign(new Error('HTTP 401'), {
              code: 'ERR_DISTRIBUTED_NODE_HTTP',
              statusCode: 401,
            });
          },
        })
      ),
      (error) =>
        error.code === 'ERR_DISTRIBUTED_NODE_HTTP' && error.statusCode === 401
    );
  });

  await context.test('malformed report is not offline', async () => {
    await assert.rejects(
      runDistributedLinuxController(
        baseRunOptions(config, catalogValue, {
          transportRequester: async () => ({ body: { schema: 'wrong' } }),
        })
      ),
      /unexpected or missing fields/
    );
  });

  await context.test('inventory mismatch is not admitted', async () => {
    await assert.rejects(
      runDistributedLinuxController(
        baseRunOptions(config, catalogValue, {
          transportRequester: async (options) => ({
            body: probeReport(remote, catalogValue, options.requestId, {
              inventorySha256: 'c'.repeat(64),
            }),
          }),
        })
      ),
      /application identity differs from the controller catalog/
    );
  });

  await context.test('candidate mismatch is not admitted', async () => {
    await assert.rejects(
      runDistributedLinuxController(
        baseRunOptions(config, catalogValue, {
          runId: 'focused-candidate-mismatch',
          transportRequester: async (options) => ({
            body: probeReport(remote, catalogValue, options.requestId, {
              candidateSha256: 'd'.repeat(64),
            }),
          }),
        })
      ),
      /application identity differs from the controller catalog/
    );
  });

  await context.test(
    'malformed runtime attestation is not admitted',
    async () => {
      const attestation = runtimeAttestation(remote);
      await assert.rejects(
        runDistributedLinuxController(
          baseRunOptions(config, catalogValue, {
            runId: 'focused-attestation-mismatch',
            transportRequester: async (options) => ({
              body: probeReport(remote, catalogValue, options.requestId, {
                attestation: {
                  ...attestation,
                  attestationSha256: 'e'.repeat(64),
                },
              }),
            }),
          })
        ),
        /attestation seal is invalid/
      );
    }
  );
});

test('loads the controller role from an active marker and keeps exact configuration routing', async () => {
  const catalogValue = catalog(2);
  const config = controllerConfig();
  const resolutions = [];
  const result = await runDistributedLinuxController({
    ...baseRunOptions(config, catalogValue),
    config: undefined,
    activeConfigMarkerPath: '/run/seerrng-validation-engine/active-config',
    activeConfigResolver: (marker, options) => {
      resolutions.push({ marker, options });
      return {
        configPath:
          '/etc/seerrng-validation-engine/test-suite-multi-computer-JohnCronk79.cfg',
        role: 'controller',
        config,
      };
    },
  });
  assert.deepEqual(resolutions, [
    {
      marker: '/run/seerrng-validation-engine/active-config',
      options: { expectedRole: 'controller' },
    },
  ]);
  assert.equal(result.runReport.status, 'passed');
  assert.deepEqual(
    result.onlineNodes.map(({ nodeId }) => nodeId),
    ['controller']
  );
});

test('sends an exact full-catalog task request and rejects changed task attestation binding', async () => {
  const catalogValue = catalog(2);
  const remote = remoteConfig(49_103, { availableThreads: 8 });
  const config = controllerConfig([remote]);
  const transportCalls = [];
  const result = await runDistributedLinuxController(
    baseRunOptions(config, catalogValue, {
      transportRequester: async (options) => {
        transportCalls.push(options);
        if (options.kind === DISTRIBUTED_NODE_PROBE_KIND)
          return {
            body: probeReport(remote, catalogValue, options.requestId),
          };
        assert.equal(options.kind, DISTRIBUTED_NODE_TASK_KIND);
        assert.equal(
          options.body.schema,
          DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA
        );
        assert.equal(options.body.catalogSha256, catalogValue.catalogSha256);
        assert.equal(
          options.body.request.candidateSha256,
          catalogValue.candidate.candidateSha256
        );
        return {
          body: {
            schema: DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
            requestId: options.requestId,
            nodeId: 'node-01',
            applicationId: APPLICATION_ID,
            candidateSha256: catalogValue.candidate.candidateSha256,
            catalogSha256: catalogValue.catalogSha256,
            nodeAttestationSha256: 'd'.repeat(64),
            taskId: options.body.request.taskId,
            result: passingResult(catalogValue, options.body.request.taskId),
          },
        };
      },
    })
  );
  assert.ok(
    transportCalls.some(({ kind }) => kind === DISTRIBUTED_NODE_TASK_KIND)
  );
  assert.equal(result.runReport.status, 'incomplete');
  assert.ok(
    result.runReport.outcomes.some(
      ({ failureCode, status }) =>
        status === 'failed' && failureCode === 'ERR_DISTRIBUTED_SHARD_EXECUTION'
    )
  );
});

test('fresh run requirements distinguish available nodes from explicitly accepted usable nodes', async () => {
  const catalogValue = catalog(4);
  const first = remoteConfig(49_104);
  const second = remoteConfig(49_105, {
    nodeNumber: '02',
    computerName: 'Outdated remote node',
    ipAddress: '127.0.0.3',
  });
  const config = controllerConfig([first, second], {
    supportedApplications: [],
    applicationRequirements: [],
    nodeDependencyAvailability: [
      {
        nodeNumber: '01',
        dependencies: [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ],
      },
      {
        nodeNumber: '02',
        dependencies: [{ name: 'node', version: '22.0.0' }],
      },
    ],
  });
  const remoteById = new Map([
    ['node-01', first],
    ['node-02', second],
  ]);
  const transportCalls = [];
  const transportRequester = async (options) => {
    transportCalls.push(options);
    const remote = remoteById.get(options.nodeId);
    assert.ok(remote);
    if (options.kind === DISTRIBUTED_NODE_PROBE_KIND)
      return {
        body: probeReport(remote, catalogValue, options.requestId),
      };
    return {
      body: {
        schema: DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
        requestId: options.requestId,
        nodeId: options.nodeId,
        applicationId: APPLICATION_ID,
        candidateSha256: catalogValue.candidate.candidateSha256,
        catalogSha256: catalogValue.catalogSha256,
        nodeAttestationSha256: runtimeAttestation(remote).attestationSha256,
        taskId: options.body.request.taskId,
        result: passingResult(catalogValue, options.body.request.taskId),
      },
    };
  };
  let reads = 0;
  const confirmations = [];
  const result = await runDistributedLinuxController(
    baseRunOptions(config, catalogValue, {
      dependencyProfilePath: resolve(
        'focused-linux-controller-application/seerrng-test-suite-dependancies.cfg'
      ),
      dependencyProfileReader: () => {
        reads += 1;
        return [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ];
      },
      confirmDependencyExclusions: (admission) => {
        confirmations.push(admission);
        return true;
      },
      transportRequester,
    })
  );

  assert.equal(reads, 1);
  assert.equal(confirmations.length, 1);
  assert.deepEqual(
    result.dependencyAdmission.availableNodes.map(
      ({ nodeNumber }) => nodeNumber
    ),
    ['controller', '01', '02']
  );
  assert.deepEqual(
    result.dependencyAdmission.usableNodes.map(({ nodeNumber }) => nodeNumber),
    ['controller', '01']
  );
  assert.deepEqual(result.dependencyAdmission.excludedNodes[0].missing, [
    { name: 'pnpm', version: '10.24.0' },
  ]);
  assert.deepEqual(result.dependencyAdmission.excludedNodes[0].mismatched, [
    {
      name: 'node',
      requiredVersion: '24.21.0',
      actualVersion: '22.0.0',
    },
  ]);
  assert.match(
    formatDistributedDependencyAdmission(result.dependencyAdmission),
    /Available Nodes: 3[\s\S]*Usable Nodes: 2[\s\S]*required 10\.24\.0; installed not installed[\s\S]*required 24\.21\.0; installed 22\.0\.0/
  );
  assert.equal(
    transportCalls.some(
      ({ kind, nodeId }) =>
        kind === DISTRIBUTED_NODE_TASK_KIND && nodeId === 'node-02'
    ),
    false
  );
  assert.equal(result.runReport.status, 'passed');

  await assert.rejects(
    runDistributedLinuxController(
      baseRunOptions(config, catalogValue, {
        runId: 'focused-run-no-confirmation',
        dependencyProfilePath: resolve(
          'focused-linux-controller-application/seerrng-test-suite-dependancies.cfg'
        ),
        dependencyProfileReader: () => [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ],
        transportRequester,
      })
    ),
    (error) => {
      assert.match(
        error.message,
        /Test stopped so node dependencies can be installed or updated[\s\S]*Available Nodes: 3[\s\S]*Usable Nodes: 2/
      );
      assert.deepEqual(error.dependencyAdmission.excludedNodes[0].missing, [
        { name: 'pnpm', version: '10.24.0' },
      ]);
      assert.deepEqual(error.dependencyAdmission.excludedNodes[0].mismatched, [
        {
          name: 'node',
          requiredVersion: '24.21.0',
          actualVersion: '22.0.0',
        },
      ]);
      assert.equal(
        error.applicationAdmission.schema,
        DISTRIBUTED_LINUX_APPLICATION_ADMISSION_SCHEMA
      );
      return true;
    }
  );
});

test('fresh run requirements can continue on the prepared controller when no remote is usable', async () => {
  const catalogValue = catalog(2);
  const remote = remoteConfig(49_106);
  const config = controllerConfig([remote], {
    supportedApplications: [],
    applicationRequirements: [],
    nodeDependencyAvailability: [
      {
        nodeNumber: '01',
        dependencies: [{ name: 'node', version: '22.0.0' }],
      },
    ],
  });
  let confirmed = 0;
  const result = await runDistributedLinuxController(
    baseRunOptions(config, catalogValue, {
      dependencyProfilePath: resolve(
        'focused-linux-controller-application/seerrng-test-suite-dependancies.cfg'
      ),
      dependencyProfileReader: () => [{ name: 'node', version: '24.21.0' }],
      confirmDependencyExclusions: () => {
        confirmed += 1;
        return true;
      },
      transportRequester: async (options) => ({
        body: probeReport(remote, catalogValue, options.requestId),
      }),
    })
  );
  assert.equal(confirmed, 1);
  assert.deepEqual(
    result.dependencyAdmission.usableNodes.map(({ nodeId }) => nodeId),
    ['controller']
  );
  assert.equal(result.runReport.status, 'passed');
});
