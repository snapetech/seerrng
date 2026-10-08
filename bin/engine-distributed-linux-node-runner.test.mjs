// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
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
  DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS,
  DISTRIBUTED_LINUX_TASK_RESPONSE_OVERHEAD_MS,
  distributedLinuxControllerId,
  distributedLinuxNodeId,
  MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS,
  parseDistributedLinuxNodeApplicationBindings,
  resolveDistributedLinuxTaskTimeoutBudget,
  startDistributedLinuxNodeRunner,
} from '../tools/validation-engine/runtime/distributed-linux-node-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  createDistributedNativeTaskRequest,
  DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
  MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
  requestDistributedNodeJson,
} from '../tools/validation-engine/runtime/distributed-node-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
import {
  createNativeCaseLedgerFixture,
  createNativeCaseReportFixture,
} from './distributed-native-case-ledger-test-fixture.mjs';

const SHARED_KEY = 'a'.repeat(64);
const CPU_NAME = 'Focused Linux CPU';
const AVAILABLE_THREADS = 8;
const APPLICATION_ID = 'seerrng';
const APPLICATION_ROOT = resolve('focused-linux-node-application');
const services = new Set();

afterEach(async () => {
  await Promise.allSettled([...services].map((service) => service.close()));
  services.clear();
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runtimeAttestation(config) {
  const core = {
    schema: DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA,
    activeNodeConfigSha256: sha256(serializeNodeConfig(config)),
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

test('parses strict Linux node CLI application bindings without legacy runtime coupling', () => {
  const secondRoot = resolve('focused-linux-node-second-application');
  assert.deepEqual(
    parseDistributedLinuxNodeApplicationBindings([
      `seerrng=${APPLICATION_ROOT}`,
      `another=${secondRoot}`,
    ]),
    [
      { applicationId: 'seerrng', root: APPLICATION_ROOT },
      { applicationId: 'another', root: secondRoot },
    ]
  );
  assert.throws(
    () => parseDistributedLinuxNodeApplicationBindings(['missing-root=']),
    /must be ID=ROOT/
  );
  assert.throws(
    () => parseDistributedLinuxNodeApplicationBindings(['seerrng=relative']),
    /must be absolute/
  );
});

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

function enrolledConfig(port, overrides = {}) {
  const base = {
    controller: { ipAddress: '127.0.0.2', port: 40100 },
    node: {
      nodeNumber: '01',
      computerName: "John's laptop - VM1",
      ipAddress: '127.0.0.1',
      port,
      cpuName: CPU_NAME,
      availableThreads: AVAILABLE_THREADS,
    },
    sharedAuthenticationKey: SHARED_KEY,
  };
  return createNodeConfig({
    ...base,
    ...overrides,
    controller: { ...base.controller, ...overrides.controller },
    node: { ...base.node, ...overrides.node },
  });
}

function candidate(label = 'candidate') {
  const core = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: sha256(`${label}:commit`).slice(0, 40),
    treeSha: sha256(`${label}:tree`).slice(0, 40),
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: sha256(`${label}:lockfile`),
  };
  return Object.freeze({
    ...core,
    candidateSha256: canonicalJsonSha256(core),
  });
}

function nativeTask(applicationId, adapterId, files) {
  return Object.freeze({
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({ applicationId, adapterId, files }),
    adapterId,
    files: Object.freeze([...files]),
  });
}

function catalog(applicationId, candidateValue, tasks, label) {
  const ordered = [...tasks].toSorted((left, right) =>
    left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0
  );
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId,
    platform: 'linux',
    candidate: candidateValue,
    inventorySha256: sha256(`${label}:inventory`),
    tasks: ordered,
  };
  return Object.freeze({
    ...core,
    catalogSha256: canonicalJsonSha256(core),
  });
}

function passingResult(catalogValue, task) {
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
    taskId: task.taskId,
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

function fixtureCatalogs() {
  const candidateValue = candidate();
  const selected = nativeTask(APPLICATION_ID, 'node-js', [
    'bin/focused-a.test.mjs',
  ]);
  const second = nativeTask(APPLICATION_ID, 'vitest', [
    'src/focused-b.test.ts',
  ]);
  return {
    candidate: candidateValue,
    selected,
    full: catalog(APPLICATION_ID, candidateValue, [selected, second], 'full'),
    shard: catalog(APPLICATION_ID, candidateValue, [selected], 'shard'),
  };
}

async function startFixture(overrides = {}) {
  const port = overrides.port ?? (await availablePort());
  const config = overrides.config ?? enrolledConfig(port);
  const catalogs = overrides.catalogs ?? fixtureCatalogs();
  const calls = [];
  const service = await startDistributedLinuxNodeRunner({
    config,
    applications: [{ applicationId: APPLICATION_ID, root: APPLICATION_ROOT }],
    profileDetector:
      overrides.profileDetector ??
      (() => ({ cpuName: CPU_NAME, availableThreads: AVAILABLE_THREADS })),
    catalogDiscovery:
      overrides.catalogDiscovery ??
      ((root, options) => {
        assert.equal(root, APPLICATION_ROOT);
        assert.deepEqual(options, { applicationId: APPLICATION_ID });
        return catalogs.full;
      }),
    taskExecutor:
      overrides.taskExecutor ??
      (async (options) => {
        calls.push(options);
        return passingResult(catalogs.full, catalogs.selected);
      }),
    attestationFactory:
      overrides.attestationFactory ??
      (async (activeConfig) => runtimeAttestation(activeConfig)),
    ...(Object.hasOwn(overrides, 'withTaskIsolation')
      ? { withTaskIsolation: overrides.withTaskIsolation }
      : {}),
    ...(overrides.resultVerifier
      ? { resultVerifier: overrides.resultVerifier }
      : {}),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
    ...(overrides.taskTimeoutMs === undefined
      ? {}
      : { taskTimeoutMs: overrides.taskTimeoutMs }),
    ...(overrides.transportStarter
      ? { transportStarter: overrides.transportStarter }
      : {}),
    ...(overrides.transportOptions
      ? { transportOptions: overrides.transportOptions }
      : {}),
  });
  services.add(service);
  return { service, config, catalogs, calls };
}

function nodeRequest(service, kind, requestId, body, options = {}) {
  return requestDistributedNodeJson({
    address: service.host,
    port: service.port,
    sharedKey: SHARED_KEY,
    controllerId: service.controllerId,
    nodeId: service.nodeId,
    kind,
    requestId,
    body,
    timeoutMs: options.timeoutMs ?? 2000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

function probeBody(requestId, applicationIds = [APPLICATION_ID]) {
  return {
    schema: DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA,
    requestId,
    applicationIds,
  };
}

function taskBody(catalogs, requestId) {
  return {
    schema: DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA,
    requestId,
    applicationId: APPLICATION_ID,
    candidateSha256: catalogs.full.candidate.candidateSha256,
    catalogSha256: catalogs.full.catalogSha256,
    request: createDistributedNativeTaskRequest(
      catalogs.full,
      catalogs.selected.taskId
    ),
  };
}

test('exports bounded schemas and deterministic enrolled identities', () => {
  assert.equal(
    DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA,
    'seerrng-distributed-linux-node-probe-request/v1'
  );
  assert.equal(
    DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
    'seerrng-distributed-linux-node-probe-report/v3'
  );
  assert.equal(
    DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA,
    'seerrng-distributed-linux-node-task-request/v1'
  );
  assert.equal(
    DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
    'seerrng-distributed-linux-node-task-report/v2'
  );
  assert.equal(MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS, 64);
  assert.equal(distributedLinuxNodeId('01'), 'node-01');
  assert.equal(
    distributedLinuxControllerId({
      ipAddress: '127.0.0.2',
      port: 40100,
    }),
    distributedLinuxControllerId({
      ipAddress: '127.0.0.2',
      port: 40100,
    })
  );
  assert.throws(() => distributedLinuxNodeId('1'), /two-digit format/);
});

test('binds a native task beyond 30 seconds to longer handler and response budgets without waiting', async () => {
  const configuredTaskTimeoutMs = 30_001;
  const budget = resolveDistributedLinuxTaskTimeoutBudget(
    configuredTaskTimeoutMs
  );
  assert.deepEqual(budget, {
    taskTimeoutMs: configuredTaskTimeoutMs,
    handlerTimeoutMs:
      configuredTaskTimeoutMs + DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS,
    requestTimeoutMs:
      configuredTaskTimeoutMs +
      DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS +
      DISTRIBUTED_LINUX_TASK_RESPONSE_OVERHEAD_MS,
  });
  assert.ok(budget.handlerTimeoutMs > 30_000);
  assert.ok(budget.requestTimeoutMs > budget.handlerTimeoutMs);
  assert.ok(Object.isFrozen(budget));

  assert.deepEqual(resolveDistributedLinuxTaskTimeoutBudget(), {
    taskTimeoutMs: DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
    handlerTimeoutMs:
      DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS +
      DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS,
    requestTimeoutMs:
      DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS +
      DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS +
      DISTRIBUTED_LINUX_TASK_RESPONSE_OVERHEAD_MS,
  });
  for (const invalid of [0, 1.5, MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS + 1])
    assert.throws(
      () => resolveDistributedLinuxTaskTimeoutBudget(invalid),
      /must be an integer/
    );

  const starts = [];
  const { catalogs, calls } = await startFixture({
    taskTimeoutMs: configuredTaskTimeoutMs,
    transportStarter: async (options) => {
      starts.push(options);
      return {
        host: options.host,
        port: options.port,
        route: '/engine/v1/nodes/authenticated',
        close: async () => {},
      };
    },
  });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].handlerTimeoutMs, budget.handlerTimeoutMs);

  const requestId = 'task-timeout-budget';
  await starts[0].handler({
    kind: DISTRIBUTED_NODE_TASK_KIND,
    requestId,
    body: taskBody(catalogs, requestId),
    signal: new AbortController().signal,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeoutMs, configuredTaskTimeoutMs);

  await assert.rejects(
    startDistributedLinuxNodeRunner({
      transportOptions: { handlerTimeoutMs: 30_000 },
    }),
    /handlerTimeoutMs is runtime-owned/
  );
});

test('real localhost probe and task bind identity, clean catalog shard, and sealed result', async () => {
  const { service, config, catalogs, calls } = await startFixture();
  const probeId = 'probe-001';
  const probe = await nodeRequest(
    service,
    DISTRIBUTED_NODE_PROBE_KIND,
    probeId,
    probeBody(probeId)
  );
  assert.deepEqual(JSON.parse(JSON.stringify(probe.body)), {
    schema: DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
    requestId: probeId,
    node: {
      nodeId: 'node-01',
      nodeNumber: '01',
      computerName: "John's laptop - VM1",
      ipAddress: '127.0.0.1',
      port: service.port,
      cpuName: CPU_NAME,
      availableThreads: AVAILABLE_THREADS,
    },
    attestation: runtimeAttestation(config),
    applications: [
      {
        applicationId: APPLICATION_ID,
        status: 'available',
        platform: 'linux',
        candidateSha256: catalogs.full.candidate.candidateSha256,
        catalogSha256: catalogs.full.catalogSha256,
        inventorySha256: catalogs.full.inventorySha256,
        taskCount: 2,
      },
    ],
  });

  const taskId = 'task-001';
  const task = await nodeRequest(
    service,
    DISTRIBUTED_NODE_TASK_KIND,
    taskId,
    taskBody(catalogs, taskId)
  );
  assert.equal(task.body.schema, DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA);
  assert.equal(task.body.requestId, taskId);
  assert.equal(task.body.nodeId, 'node-01');
  assert.equal(task.body.applicationId, APPLICATION_ID);
  assert.equal(
    task.body.candidateSha256,
    catalogs.full.candidate.candidateSha256
  );
  assert.equal(task.body.catalogSha256, catalogs.full.catalogSha256);
  assert.equal(task.body.taskId, catalogs.selected.taskId);
  assert.equal(
    task.body.nodeAttestationSha256,
    runtimeAttestation(config).attestationSha256
  );
  assert.equal(task.body.result.resultSha256.length, 64);
  assert.equal(Object.hasOwn(task.body.result, 'label'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].root, APPLICATION_ROOT);
  assert.equal(calls[0].applicationId, APPLICATION_ID);
  assert.deepEqual(
    calls[0].allowedTaskIds,
    catalogs.full.tasks.map((entry) => entry.taskId)
  );
  assert.deepEqual(calls[0].expectedCandidate, catalogs.full.candidate);
  assert.deepEqual(
    calls[0].request,
    createDistributedNativeTaskRequest(catalogs.full, catalogs.selected.taskId)
  );
  assert.ok(calls[0].signal instanceof AbortSignal);

  for (const value of [service, probe.body, task.body]) {
    const encoded = JSON.stringify(value);
    assert.doesNotMatch(encoded, new RegExp(SHARED_KEY));
    assert.doesNotMatch(encoded, /sharedAuthenticationKey/);
  }
  assert.equal(config.sharedAuthenticationKey, SHARED_KEY);
});

test('task rejects nonlocal catalog, request, and envelope bindings before execution', async () => {
  const { service, catalogs, calls } = await startFixture();
  const cases = [
    {
      name: 'one-task catalog instead of stable full catalog',
      mutate: (body) => ({
        ...body,
        catalogSha256: catalogs.shard.catalogSha256,
      }),
    },
    {
      name: 'changed local file selection',
      mutate: (body) => ({
        ...body,
        request: { ...body.request, files: ['bin/not-local.test.mjs'] },
      }),
    },
    {
      name: 'changed candidate',
      mutate: (body) => ({ ...body, candidateSha256: sha256('another') }),
    },
    {
      name: 'mismatched envelope request ID',
      mutate: (body) => ({ ...body, requestId: 'another-request' }),
    },
    {
      name: 'extra network field',
      mutate: (body) => ({ ...body, command: 'pnpm test' }),
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const requestId = `rejected-${index}`;
    await assert.rejects(
      nodeRequest(
        service,
        DISTRIBUTED_NODE_TASK_KIND,
        requestId,
        entry.mutate(taskBody(catalogs, requestId))
      ),
      (error) => {
        assert.equal(error.statusCode, 500, entry.name);
        assert.doesNotMatch(error.message, new RegExp(SHARED_KEY));
        return true;
      }
    );
  }
  assert.equal(calls.length, 0);
});

test('optional task isolation surrounds only the native executor with exact frozen context', async () => {
  const sequence = [];
  let isolated = false;
  let isolationCalls = 0;
  let isolationContext;
  const fixture = fixtureCatalogs();
  const { service, catalogs, calls } = await startFixture({
    catalogs: fixture,
    taskExecutor: async (options) => {
      assert.equal(isolated, true);
      sequence.push('executor');
      calls.push(options);
      return passingResult(fixture.full, fixture.selected);
    },
    withTaskIsolation: async (operation, context) => {
      isolationCalls += 1;
      isolationContext = context;
      assert.equal(typeof operation, 'function');
      assert.deepEqual(Object.keys(context).toSorted(), [
        'application',
        'candidate',
        'signal',
        'task',
      ]);
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.application), true);
      assert.equal(Object.isFrozen(context.task), true);
      assert.equal(Object.isFrozen(context.candidate), true);
      assert.deepEqual(context.application, {
        applicationId: APPLICATION_ID,
        root: APPLICATION_ROOT,
      });
      assert.deepEqual(context.task, fixture.selected);
      assert.deepEqual(context.candidate, fixture.full.candidate);
      assert.ok(context.signal instanceof AbortSignal);
      isolated = true;
      sequence.push('isolate');
      try {
        return await operation();
      } finally {
        isolated = false;
        sequence.push('restore');
      }
    },
    resultVerifier: async (result) => {
      assert.equal(isolated, false);
      sequence.push('verify');
      return result;
    },
  });

  assert.equal(isolationCalls, 0);
  const probeId = 'isolation-probe';
  await nodeRequest(
    service,
    DISTRIBUTED_NODE_PROBE_KIND,
    probeId,
    probeBody(probeId)
  );
  assert.equal(isolationCalls, 0);

  const rejectedId = 'isolation-rejected';
  const rejectedBody = taskBody(catalogs, rejectedId);
  await assert.rejects(
    nodeRequest(service, DISTRIBUTED_NODE_TASK_KIND, rejectedId, {
      ...rejectedBody,
      request: {
        ...rejectedBody.request,
        files: ['bin/not-local.test.mjs'],
      },
    }),
    (error) => error.statusCode === 500
  );
  assert.equal(isolationCalls, 0);

  const taskId = 'isolation-task';
  await nodeRequest(
    service,
    DISTRIBUTED_NODE_TASK_KIND,
    taskId,
    taskBody(catalogs, taskId)
  );
  assert.equal(isolationCalls, 1);
  assert.deepEqual(sequence, ['isolate', 'executor', 'restore', 'verify']);
  assert.equal(calls.length, 1);
  assert.strictEqual(isolationContext.candidate, calls[0].expectedCandidate);
  assert.strictEqual(isolationContext.signal, calls[0].signal);
  assert.equal(isolationContext.task.taskId, calls[0].request.taskId);
  assert.equal(isolated, false);
});

test('task isolation dependency is validated before runner admission', async () => {
  await assert.rejects(
    startDistributedLinuxNodeRunner({ withTaskIsolation: true }),
    /task isolation must be a native callback/
  );
});

test('task isolation cannot skip or repeat the native executor', async (t) => {
  for (const entry of [
    {
      name: 'skips execution',
      isolate: async (_operation, context) =>
        passingResult(fixtureCatalogs().full, context.task),
    },
    {
      name: 'repeats execution',
      isolate: async (operation) => {
        await operation();
        return operation();
      },
    },
  ])
    await t.test(entry.name, async () => {
      const { service, catalogs, calls } = await startFixture({
        withTaskIsolation: entry.isolate,
      });
      const requestId = `isolation-${entry.name.replaceAll(' ', '-')}`;
      await assert.rejects(
        nodeRequest(
          service,
          DISTRIBUTED_NODE_TASK_KIND,
          requestId,
          taskBody(catalogs, requestId)
        ),
        (error) => error.statusCode === 500
      );
      assert.ok(calls.length <= 1);
    });
});

test('probe reports an unconfigured application without hiding the online node', async () => {
  const { service } = await startFixture();
  const requestId = 'probe-unknown';
  const probe = await nodeRequest(
    service,
    DISTRIBUTED_NODE_PROBE_KIND,
    requestId,
    probeBody(requestId, ['unknown'])
  );
  assert.deepEqual(JSON.parse(JSON.stringify(probe.body.applications)), [
    {
      applicationId: 'unknown',
      status: 'unavailable',
      reason: 'application-not-configured',
    },
  ]);
});

test('probe enforces its exact bounded schema and canonical application request', async () => {
  const { service } = await startFixture();
  const cases = [
    {
      requestId: 'probe-extra',
      body: { ...probeBody('probe-extra'), extra: true },
    },
    {
      requestId: 'probe-mismatch',
      body: probeBody('another-id'),
    },
    {
      requestId: 'probe-duplicates',
      body: probeBody('probe-duplicates', [APPLICATION_ID, APPLICATION_ID]),
    },
  ];
  for (const entry of cases)
    await assert.rejects(
      nodeRequest(
        service,
        DISTRIBUTED_NODE_PROBE_KIND,
        entry.requestId,
        entry.body
      ),
      (error) => error.statusCode === 500
    );
});

test('startup fails closed for pending enrollment, profile drift, and ambiguous bindings', async () => {
  const pending = enrolledConfig(40200, { sharedAuthenticationKey: null });
  await assert.rejects(
    startDistributedLinuxNodeRunner({
      config: pending,
      applications: [{ applicationId: APPLICATION_ID, root: APPLICATION_ROOT }],
    }),
    (error) => {
      assert.match(error.message, /has not completed enrollment/);
      assert.doesNotMatch(error.message, new RegExp(SHARED_KEY));
      return true;
    }
  );

  const config = enrolledConfig(40201);
  await assert.rejects(
    startDistributedLinuxNodeRunner({
      config,
      applications: [{ applicationId: APPLICATION_ID, root: APPLICATION_ROOT }],
      profileDetector: () => ({
        cpuName: 'Another CPU',
        availableThreads: AVAILABLE_THREADS,
      }),
    }),
    /host profile differs from its enrolled identity/
  );

  await assert.rejects(
    startDistributedLinuxNodeRunner({
      config,
      applications: [
        { applicationId: APPLICATION_ID, root: APPLICATION_ROOT },
        { applicationId: APPLICATION_ID, root: resolve('another-root') },
      ],
      profileDetector: () => ({
        cpuName: CPU_NAME,
        availableThreads: AVAILABLE_THREADS,
      }),
      attestationFactory: async (activeConfig) =>
        runtimeAttestation(activeConfig),
    }),
    /repeat an ID/
  );
});

test('active configuration routing requests the enrolled node role without exposing its key', async () => {
  const config = enrolledConfig(40202);
  const catalogs = fixtureCatalogs();
  const resolutions = [];
  const starts = [];
  let closed = false;
  const service = await startDistributedLinuxNodeRunner({
    activeConfigMarkerPath: '/run/seerrng-validation-engine/active-config',
    activeConfigResolver: (marker, options) => {
      resolutions.push({ marker, options });
      return {
        configPath: '/etc/seerrng-validation-engine/node.cfg',
        role: 'node',
        config,
      };
    },
    applications: [{ applicationId: APPLICATION_ID, root: APPLICATION_ROOT }],
    profileDetector: () => ({
      cpuName: CPU_NAME,
      availableThreads: AVAILABLE_THREADS,
    }),
    attestationFactory: async (activeConfig) =>
      runtimeAttestation(activeConfig),
    catalogDiscovery: () => catalogs.full,
    transportStarter: async (options) => {
      starts.push(options);
      return {
        host: config.node.ipAddress,
        port: config.node.port,
        route: '/engine/v1/nodes/authenticated',
        close: async () => {
          closed = true;
        },
      };
    },
  });
  services.add(service);
  assert.deepEqual(resolutions, [
    {
      marker: '/run/seerrng-validation-engine/active-config',
      options: { expectedRole: 'node' },
    },
  ]);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].sharedKey, SHARED_KEY);
  assert.equal(starts[0].host, config.node.ipAddress);
  assert.equal(starts[0].port, config.node.port);
  assert.equal(starts[0].nodeId, 'node-01');
  assert.equal(
    starts[0].controllerId,
    distributedLinuxControllerId(config.controller)
  );
  assert.deepEqual(starts[0].allowedKinds, [
    DISTRIBUTED_NODE_PROBE_KIND,
    DISTRIBUTED_NODE_TASK_KIND,
  ]);
  assert.equal(JSON.stringify(service).includes(SHARED_KEY), false);
  await service.close();
  assert.equal(closed, true);
});

test('shutdown aborts an active native task and closes the real localhost service', async () => {
  let startedResolve;
  const started = new Promise((resolveStarted) => {
    startedResolve = resolveStarted;
  });
  let executionAborted = false;
  const { service, catalogs } = await startFixture({
    taskExecutor: ({ signal }) =>
      new Promise((resolveTask, rejectTask) => {
        startedResolve();
        signal.addEventListener(
          'abort',
          () => {
            executionAborted = true;
            rejectTask(signal.reason ?? new Error('aborted'));
          },
          { once: true }
        );
      }),
  });
  const requestId = 'task-shutdown';
  const pending = nodeRequest(
    service,
    DISTRIBUTED_NODE_TASK_KIND,
    requestId,
    taskBody(catalogs, requestId),
    { timeoutMs: 5000 }
  );
  const rejected = assert.rejects(pending);
  await started;
  await service.close();
  services.delete(service);
  await rejected;
  assert.equal(executionAborted, true);
});

test('an invalid native result seal cannot cross the authenticated response boundary', async () => {
  const { service, catalogs } = await startFixture({
    taskExecutor: async () => ({
      ...passingResult(fixtureCatalogs().full, fixtureCatalogs().selected),
      resultSha256: sha256('invalid-seal'),
    }),
  });
  const requestId = 'task-invalid-result';
  await assert.rejects(
    nodeRequest(
      service,
      DISTRIBUTED_NODE_TASK_KIND,
      requestId,
      taskBody(catalogs, requestId)
    ),
    (error) => {
      assert.equal(error.statusCode, 500);
      assert.doesNotMatch(error.message, new RegExp(SHARED_KEY));
      return true;
    }
  );
});
