import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- This focused contract test runs in native Node without application aliases.
import {
  createControllerAdaptiveSchedule,
  DISTRIBUTED_CONTROLLER_NODE_ID,
  DISTRIBUTED_NODE_PROBE_SCHEMA,
} from '../tools/validation-engine/runtime/distributed-controller-adaptive-bridge.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- This focused contract test runs in native Node without application aliases.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- This focused contract test runs in native Node without application aliases.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- This focused contract test runs in native Node without application aliases.
import { createControllerConfig } from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- This focused contract test runs in native Node without application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const COMMIT_SHA = '1'.repeat(40);
const TREE_SHA = '2'.repeat(40);
const LOCKFILE_SHA256 = '3'.repeat(64);
const REPOSITORY_IDENTITY_SHA256 = '4'.repeat(64);
const SHARED_AUTHENTICATION_KEY = '5'.repeat(64);
const ADAPTER_ID = 'node-js';

function createCatalog({
  commitSha = COMMIT_SHA,
  lockfileSha256 = LOCKFILE_SHA256,
  treeSha = TREE_SHA,
} = {}) {
  const candidateCore = {
    commitSha,
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256,
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    treeSha,
  };
  const candidate = {
    ...candidateCore,
    candidateSha256: canonicalJsonSha256(candidateCore),
  };
  const entries = Array.from({ length: 10 }, (_, index) => {
    const files = [
      `tests/shard-${String(index + 1).padStart(2, '0')}.test.mjs`,
    ];
    return {
      adapterId: ADAPTER_ID,
      files,
      schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
      taskId: distributedNativeTaskId({
        adapterId: ADAPTER_ID,
        applicationId: 'seerrng',
        files,
      }),
    };
  }).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const inventorySha256 = canonicalJsonSha256({
    applicationId: 'seerrng',
    entries,
    platform: 'linux',
    schema: 'seerrng-distributed-native-inventory-identity/v1',
  });
  const catalogCore = {
    applicationId: 'seerrng',
    candidate,
    inventorySha256,
    platform: 'linux',
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    tasks: entries,
  };

  return {
    ...catalogCore,
    catalogSha256: canonicalJsonSha256(catalogCore),
  };
}

function createConfig(overrides = {}) {
  const cpuNames = overrides.cpuNames ?? {
    controller: 'Laptop CPU',
    node01: 'Server CPU',
    node02: 'Offline CPU',
    node03: 'Unscheduled CPU',
  };

  return createControllerConfig({
    global: {
      availableThreads: 12,
      computerName: 'John laptop',
      cpuName: cpuNames.controller,
      githubUsername: 'JohnCronk79',
      ipAddress: '192.168.10.20',
      minimumThreadCount: 1,
      port: 49_100,
      threads: '2n',
    },
    nodes: [
      {
        availableThreads: 8,
        computerName: 'Media server',
        cpuName: cpuNames.node01,
        ipAddress: '192.168.10.30',
        minimumThreadCount: 1,
        nodeNumber: '01',
        port: 49_100,
        threads: 'n-2',
      },
      {
        availableThreads: 4,
        computerName: 'Sleeping laptop',
        cpuName: cpuNames.node02,
        ipAddress: '192.168.10.40',
        minimumThreadCount: 1,
        nodeNumber: '02',
        port: 49_100,
        threads: 'n',
      },
      {
        availableThreads: 4,
        computerName: 'Unscheduled laptop',
        cpuName: cpuNames.node03,
        ipAddress: '192.168.10.50',
        minimumThreadCount: null,
        nodeNumber: '03',
        port: 49_100,
        threads: null,
      },
    ],
    sharedAuthenticationKey: SHARED_AUTHENTICATION_KEY,
  });
}

function createProbes(catalog, { cpuNames = {} } = {}) {
  const common = {
    adapterIds: [ADAPTER_ID],
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    environment: 'linux-x64',
    schema: DISTRIBUTED_NODE_PROBE_SCHEMA,
  };

  return [
    {
      ...common,
      availableThreads: 12,
      cpuName: cpuNames.controller ?? 'Laptop CPU',
      ipAddress: '192.168.10.20',
      nodeId: DISTRIBUTED_CONTROLLER_NODE_ID,
      port: 49_100,
    },
    {
      ...common,
      availableThreads: 8,
      cpuName: cpuNames.node01 ?? 'Server CPU',
      ipAddress: '192.168.10.30',
      nodeId: 'node-01',
      port: 49_100,
    },
  ];
}

function createInput(overrides = {}) {
  const catalog = overrides.catalog ?? createCatalog();
  return {
    catalog,
    controllerConfig: overrides.controllerConfig ?? createConfig(),
    onlineNodeProbes: overrides.onlineNodeProbes ?? createProbes(catalog),
    repositoryIdentitySha256: REPOSITORY_IDENTITY_SHA256,
    timingProfile: overrides.timingProfile ?? createAdaptiveTimingProfile(),
    ...(overrides.policy === undefined ? {} : { policy: overrides.policy }),
  };
}

function scheduledShardCounts(schedule) {
  return Object.fromEntries(
    schedule.nodes.map((node) => [
      node.nodeId,
      schedule.threadSlots
        .filter((threadSlot) => threadSlot.nodeId === node.nodeId)
        .reduce((total, threadSlot) => total + threadSlot.tests.length, 0),
    ])
  );
}

test('bridges controller thread policies into a sealed proportional first-run schedule', () => {
  const input = createInput();
  const schedule = createControllerAdaptiveSchedule(input);

  assert.equal(schedule.nodes.length, 2);
  assert.deepEqual(
    Object.fromEntries(
      schedule.nodes.map((node) => [
        node.nodeId,
        {
          admittedThreads: node.admittedThreads,
          configuredThreadBudget: node.configuredThreadBudget,
        },
      ])
    ),
    {
      'node-01': { admittedThreads: 6, configuredThreadBudget: 6 },
      controller: { admittedThreads: 24, configuredThreadBudget: 24 },
    }
  );
  assert.deepEqual(scheduledShardCounts(schedule), {
    'node-01': 2,
    controller: 8,
  });
  assert.equal(
    schedule.threadSlots.reduce(
      (total, threadSlot) => total + threadSlot.tests.length,
      0
    ),
    10
  );
  assert.deepEqual(
    schedule.threadSlots
      .flatMap((threadSlot) => threadSlot.tests.map((entry) => entry.id))
      .sort((left, right) => left.localeCompare(right)),
    input.catalog.tasks
      .map((entry) => entry.taskId)
      .sort((left, right) => left.localeCompare(right))
  );
  assert.ok(!schedule.nodes.some((node) => node.nodeId === 'node-02'));
  assert.match(schedule.scheduleSha256, /^[a-f0-9]{64}$/u);
});

test('ignores CPU descriptions when scheduling', () => {
  const catalog = createCatalog();
  const baseline = createControllerAdaptiveSchedule(
    createInput({
      catalog,
      controllerConfig: createConfig(),
      onlineNodeProbes: createProbes(catalog),
    })
  );
  const changedHints = createControllerAdaptiveSchedule(
    createInput({
      catalog,
      controllerConfig: createConfig({
        cpuNames: {
          controller: 'Different laptop description',
          node01: 'Different server description',
          node02: 'Different offline description',
          node03: 'Different unscheduled description',
        },
      }),
      onlineNodeProbes: createProbes(catalog, {
        cpuNames: {
          controller: 'Different laptop description',
          node01: 'Different server description',
        },
      }),
    })
  );

  assert.deepEqual(changedHints, baseline);
});

test('retains shard timing identity across source candidate changes', () => {
  const firstCatalog = createCatalog();
  const nextCatalog = createCatalog({
    commitSha: '6'.repeat(40),
    treeSha: '7'.repeat(40),
  });
  assert.notEqual(
    nextCatalog.candidate.candidateSha256,
    firstCatalog.candidate.candidateSha256
  );
  assert.notEqual(nextCatalog.catalogSha256, firstCatalog.catalogSha256);
  assert.deepEqual(
    nextCatalog.tasks.map((entry) => entry.taskId),
    firstCatalog.tasks.map((entry) => entry.taskId)
  );

  const firstSchedule = createControllerAdaptiveSchedule(
    createInput({
      catalog: firstCatalog,
      onlineNodeProbes: createProbes(firstCatalog),
    })
  );
  const nextSchedule = createControllerAdaptiveSchedule(
    createInput({
      catalog: nextCatalog,
      onlineNodeProbes: createProbes(nextCatalog),
    })
  );

  assert.deepEqual(nextSchedule, firstSchedule);
  assert.ok(
    firstSchedule.threadSlots.every((threadSlot) =>
      threadSlot.tests.every((entry) => entry.fingerprint === entry.id)
    )
  );
});

test('excludes offline configured nodes and rejects an online node without a thread policy', () => {
  const catalog = createCatalog();
  const input = createInput({ catalog });
  const offlineSchedule = createControllerAdaptiveSchedule(input);
  assert.deepEqual(
    offlineSchedule.nodes.map((node) => node.nodeId),
    ['controller', 'node-01']
  );

  assert.throws(
    () =>
      createControllerAdaptiveSchedule({
        ...input,
        onlineNodeProbes: [
          ...input.onlineNodeProbes,
          {
            adapterIds: [ADAPTER_ID],
            availableThreads: 4,
            candidateSha256: catalog.candidate.candidateSha256,
            catalogSha256: catalog.catalogSha256,
            cpuName: 'Unscheduled CPU',
            environment: 'linux-x64',
            ipAddress: '192.168.10.50',
            nodeId: 'node-03',
            port: 49_100,
            schema: DISTRIBUTED_NODE_PROBE_SCHEMA,
          },
        ],
      }),
    /no assigned thread policy/u
  );
});

test('fails closed for malformed or stale node probes', async (context) => {
  const catalog = createCatalog();
  const input = createInput({ catalog });
  const cases = [
    {
      expected: /available thread count is stale/u,
      label: 'stale available thread count',
      mutate(probes) {
        probes[0].availableThreads = 11;
      },
    },
    {
      expected: /CPU description is stale/u,
      label: 'stale CPU description',
      mutate(probes) {
        probes[1].cpuName = 'Wrong CPU';
      },
    },
    {
      expected: /different candidate/u,
      label: 'stale candidate binding',
      mutate(probes) {
        probes[1].candidateSha256 = 'a'.repeat(64);
      },
    },
    {
      expected: /different catalog/u,
      label: 'stale catalog binding',
      mutate(probes) {
        probes[1].catalogSha256 = 'b'.repeat(64);
      },
    },
    {
      expected: /identity does not match/u,
      label: 'stale address identity',
      mutate(probes) {
        probes[1].ipAddress = '192.168.10.99';
      },
    },
    {
      expected: /not enrolled/u,
      label: 'unknown node identity',
      mutate(probes) {
        probes[1].nodeId = 'node-99';
      },
    },
    {
      expected: /duplicate online node identity/u,
      label: 'duplicate node identity',
      mutate(probes) {
        probes.push({ ...probes[1] });
      },
    },
    {
      expected: /controller node probe is required/u,
      label: 'missing controller probe',
      mutate(probes) {
        probes.shift();
      },
    },
    {
      expected: /must not include surrounding whitespace/u,
      label: 'node identity with surrounding whitespace',
      mutate(probes) {
        probes[1].nodeId = ' node-01';
      },
    },
    {
      expected: /canonical node-## form/u,
      label: 'raw node number identity',
      mutate(probes) {
        probes[1].nodeId = '01';
      },
    },
    {
      expected: /unsupported field clockSpeedMhz/u,
      label: 'retired CPU clock hint',
      mutate(probes) {
        probes[0].clockSpeedMhz = 5_000;
      },
    },
    {
      expected: /schema is unsupported/u,
      label: 'malformed probe schema',
      mutate(probes) {
        probes[0].schema = 'seerrng-distributed-node-probe/v0';
      },
    },
  ];

  for (const probeCase of cases) {
    await context.test(probeCase.label, () => {
      const probes = structuredClone(input.onlineNodeProbes);
      probeCase.mutate(probes);
      assert.throws(
        () =>
          createControllerAdaptiveSchedule({
            ...input,
            onlineNodeProbes: probes,
          }),
        probeCase.expected
      );
    });
  }
});
