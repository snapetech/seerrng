import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  persistControllerConfigFile,
  persistNodeConfigFile,
  readControllerConfigFile,
  readNodeConfigFile,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  activateAcceptedLinuxNodeEnrollment,
  configureLinuxController,
  createPendingLinuxNode,
  resolveActiveLinuxConfig,
} from '../tools/validation-engine/runtime/distributed-linux-management.mjs';

const SHARED_KEY = 'a'.repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-mode3-management-'));
  return {
    root,
    controllerPath: join(root, 'test-suite-multi-computer-JohnCronk79.cfg'),
    nodePath: join(root, 'test-suite-multi-computer-node-01.cfg'),
    markerPath: join(root, 'active-config'),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function hostProfileOptions({
  cpuName = 'AMD Ryzen 9 7940HS',
  availableThreads = 12,
} = {}) {
  return {
    platform: 'linux',
    availableParallelism: () => availableThreads,
    cpus: () =>
      Array.from({ length: availableThreads }, () => ({
        model: cpuName,
        speed: 4000,
        times: {},
      })),
  };
}

function controllerOperator(overrides = {}) {
  return {
    githubUsername: 'JohnCronk79',
    computerName: "John's laptop",
    ipAddress: '192.168.10.82',
    port: 62021,
    threads: '2n',
    minimumThreadCount: 1,
    ...overrides,
  };
}

function nodeOperator(overrides = {}) {
  return {
    nodeNumber: '01',
    computerName: 'Media server',
    ipAddress: '192.168.10.9',
    port: 62021,
    ...overrides,
  };
}

function acceptedResponse(overrides = {}) {
  return {
    status: 'accepted',
    disposition: 'created',
    nodeNumber: '01',
    sharedAuthenticationKey: SHARED_KEY,
    ...overrides,
  };
}

test('new controller configuration detects hardware, generates one key, and activates its exact path', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);

  const configured = configureLinuxController({
    configPath: paths.controllerPath,
    activeConfigMarkerPath: paths.markerPath,
    operator: controllerOperator(),
    hostProfileOptions: hostProfileOptions(),
  });

  assert.equal(configured.global.cpuName, 'AMD Ryzen 9 7940HS');
  assert.equal(configured.global.availableThreads, 12);
  assert.deepEqual(configured.nodes, []);
  assert.match(configured.sharedAuthenticationKey, /^[a-f0-9]{64}$/);
  assert.equal(
    readFileSync(paths.markerPath, 'utf8'),
    `${paths.controllerPath}\n`
  );
  const active = resolveActiveLinuxConfig(paths.markerPath, {
    expectedRole: 'controller',
  });
  assert.equal(active.role, 'controller');
  assert.equal(active.configPath, paths.controllerPath);
  assert.deepEqual(active.config, configured);
  if (process.platform !== 'win32') {
    assert.equal(statSync(paths.controllerPath).mode & 0o777, 0o600);
    assert.equal(statSync(paths.markerPath).mode & 0o777, 0o600);
  }
});

test('controller update preserves the cluster key, enrolled nodes, and their thread policies', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const initial = configureLinuxController({
    configPath: paths.controllerPath,
    activeConfigMarkerPath: paths.markerPath,
    operator: controllerOperator(),
    hostProfileOptions: hostProfileOptions(),
  });
  const withNode = persistControllerConfigFile(paths.controllerPath, {
    global: initial.global,
    nodes: [
      {
        nodeNumber: '01',
        computerName: 'Media server',
        ipAddress: '192.168.10.9',
        port: 62021,
        cpuName: 'AMD Ryzen Embedded V3C14',
        availableThreads: 8,
        threads: 'n-2',
        minimumThreadCount: 1,
      },
    ],
    supportedApplications: [
      {
        entryId: '01',
        applicationId: 'SeerrNG 3.17.0',
        name: 'SeerrNG',
        profilePath: join(paths.root, 'seerrng-test-suite-dependancies.cfg'),
      },
    ],
    applicationRequirements: [
      {
        applicationId: 'SeerrNG 3.17.0',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    nodeDependencyAvailability: [
      {
        nodeNumber: '01',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    sharedAuthenticationKey: initial.sharedAuthenticationKey,
  });

  const updated = configureLinuxController({
    configPath: paths.controllerPath,
    activeConfigMarkerPath: paths.markerPath,
    operator: controllerOperator({
      computerName: 'Primary test controller',
      port: 62022,
      threads: 'n-1',
      minimumThreadCount: 2,
    }),
    allowExistingUpdate: true,
    hostProfileOptions: hostProfileOptions({
      cpuName: 'Updated CPU fact',
      availableThreads: 10,
    }),
  });

  assert.equal(
    updated.sharedAuthenticationKey,
    initial.sharedAuthenticationKey
  );
  assert.deepEqual(updated.nodes, withNode.nodes);
  assert.deepEqual(
    updated.supportedApplications,
    withNode.supportedApplications
  );
  assert.deepEqual(
    updated.applicationRequirements,
    withNode.applicationRequirements
  );
  assert.deepEqual(
    updated.nodeDependencyAvailability,
    withNode.nodeDependencyAvailability
  );
  assert.deepEqual(updated.global, {
    githubUsername: 'JohnCronk79',
    computerName: 'Primary test controller',
    ipAddress: '192.168.10.82',
    port: 62022,
    cpuName: 'Updated CPU fact',
    availableThreads: 10,
    threads: 'n-1',
    minimumThreadCount: 2,
  });
});

test('an existing controller is preserved unless update is explicitly allowed', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  configureLinuxController({
    configPath: paths.controllerPath,
    activeConfigMarkerPath: paths.markerPath,
    operator: controllerOperator(),
    hostProfileOptions: hostProfileOptions(),
  });
  const beforeConfig = readFileSync(paths.controllerPath);
  const beforeMarker = readFileSync(paths.markerPath);

  assert.throws(
    () =>
      configureLinuxController({
        configPath: paths.controllerPath,
        activeConfigMarkerPath: paths.markerPath,
        operator: controllerOperator({ computerName: 'Must not replace' }),
        hostProfileOptions: hostProfileOptions(),
      }),
    /allowExistingUpdate is required/
  );
  assert.deepEqual(readFileSync(paths.controllerPath), beforeConfig);
  assert.deepEqual(readFileSync(paths.markerPath), beforeMarker);
});

test('pending node configuration stays in memory with no key or thread policy', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const pending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions({
      cpuName: 'AMD Ryzen Embedded V3C14',
      availableThreads: 8,
    }),
  });

  assert.deepEqual(pending.controller, {
    ipAddress: '192.168.10.82',
    port: 62021,
  });
  assert.deepEqual(pending.node, {
    nodeNumber: '01',
    computerName: 'Media server',
    ipAddress: '192.168.10.9',
    port: 62021,
    cpuName: 'AMD Ryzen Embedded V3C14',
    availableThreads: 8,
  });
  assert.equal(pending.sharedAuthenticationKey, null);
  assert.equal(existsSync(paths.markerPath), false);
  assert.equal(existsSync(paths.nodePath), false);
});

test('staging a node update preserves the existing enrolled config until activation', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const initialPending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions(),
  });
  activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: initialPending,
    response: acceptedResponse(),
  });
  const before = readFileSync(paths.nodePath);
  const beforeMarker = readFileSync(paths.markerPath);

  assert.throws(
    () =>
      createPendingLinuxNode({
        configPath: paths.nodePath,
        controller: { ipAddress: '192.168.10.82', port: 62021 },
        node: nodeOperator({ computerName: 'Must not replace' }),
        hostProfileOptions: hostProfileOptions(),
      }),
    /allowExistingUpdate is required/
  );
  assert.deepEqual(readFileSync(paths.nodePath), before);

  const replaced = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator({ computerName: 'Updated media server' }),
    allowExistingUpdate: true,
    hostProfileOptions: hostProfileOptions(),
  });
  assert.equal(replaced.node.computerName, 'Updated media server');
  assert.equal(replaced.sharedAuthenticationKey, null);
  assert.deepEqual(readFileSync(paths.nodePath), before);
  assert.deepEqual(readFileSync(paths.markerPath), beforeMarker);

  const activated = activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: replaced,
    allowExistingUpdate: true,
    response: acceptedResponse({ disposition: 'refreshed' }),
  });
  assert.equal(activated.node.computerName, 'Updated media server');
  assert.equal(activated.sharedAuthenticationKey, SHARED_KEY);
  assert.equal(
    readNodeConfigFile(paths.nodePath).node.computerName,
    'Updated media server'
  );
});

test('successful node reconfiguration preserves dependency selections unless the controller replaces them', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const selectedApplications = [
    {
      entryId: '01',
      applicationId: 'SeerrNG 3.17.0',
      name: 'SeerrNG',
    },
  ];
  const dependencyAvailability = [
    { name: 'node', version: '24.21.0' },
    { name: 'pnpm', version: '10.24.0' },
  ];
  const initialPending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions(),
  });
  activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: initialPending,
    response: acceptedResponse({
      selectedApplications,
      dependencyAvailability,
    }),
  });

  const pendingUpdate = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator({ computerName: 'Updated media server' }),
    allowExistingUpdate: true,
    hostProfileOptions: hostProfileOptions(),
  });
  assert.deepEqual(pendingUpdate.selectedApplications, selectedApplications);
  assert.deepEqual(
    pendingUpdate.dependencyAvailability,
    dependencyAvailability
  );

  const beforeConflict = readFileSync(paths.nodePath);
  const beforeConflictMarker = readFileSync(paths.markerPath);
  assert.throws(
    () =>
      activateAcceptedLinuxNodeEnrollment({
        configPath: paths.nodePath,
        activeConfigMarkerPath: paths.markerPath,
        pendingConfig: pendingUpdate,
        allowExistingUpdate: true,
        response: {
          status: 'conflict',
          reason: 'node-number-occupied',
          nodeNumber: '01',
          existingNode: {
            nodeNumber: '01',
            computerName: 'Other server',
            ipAddress: '192.168.10.10',
            port: 62021,
            cpuName: 'Other CPU',
            availableThreads: 4,
          },
        },
      }),
    /cannot enroll a node/
  );
  assert.deepEqual(readFileSync(paths.nodePath), beforeConflict);
  assert.deepEqual(readFileSync(paths.markerPath), beforeConflictMarker);

  const preserved = activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: pendingUpdate,
    allowExistingUpdate: true,
    response: acceptedResponse({ disposition: 'refreshed' }),
  });
  assert.deepEqual(preserved.selectedApplications, selectedApplications);
  assert.deepEqual(preserved.dependencyAvailability, dependencyAvailability);
  assert.deepEqual(readNodeConfigFile(paths.nodePath), preserved);

  const replacementApplications = [
    {
      entryId: '02',
      applicationId: 'Radarr 6.0.4',
      name: 'Radarr 4K',
    },
  ];
  const replacementAvailability = [{ name: 'dotnet-sdk', version: '9.0.318' }];
  const replacementPending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator({ computerName: 'Updated media server again' }),
    allowExistingUpdate: true,
    hostProfileOptions: hostProfileOptions(),
  });
  const replaced = activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: replacementPending,
    allowExistingUpdate: true,
    response: acceptedResponse({
      disposition: 'refreshed',
      selectedApplications: replacementApplications,
      dependencyAvailability: replacementAvailability,
    }),
  });
  assert.deepEqual(replaced.selectedApplications, replacementApplications);
  assert.deepEqual(replaced.dependencyAvailability, replacementAvailability);
});

test('accepted enrollment persists the returned cluster key before activating the node', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const pending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions(),
  });

  const enrolled = activateAcceptedLinuxNodeEnrollment({
    configPath: paths.nodePath,
    activeConfigMarkerPath: paths.markerPath,
    pendingConfig: pending,
    response: acceptedResponse(),
  });

  assert.equal(enrolled.sharedAuthenticationKey, SHARED_KEY);
  assert.equal(
    readNodeConfigFile(paths.nodePath).sharedAuthenticationKey,
    SHARED_KEY
  );
  assert.equal(readFileSync(paths.markerPath, 'utf8'), `${paths.nodePath}\n`);
  const active = resolveActiveLinuxConfig(paths.markerPath, {
    expectedRole: 'node',
  });
  assert.equal(active.role, 'node');
  assert.deepEqual(active.config, enrolled);
});

test('rejected or mismatched enrollment cannot create an active node marker', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const pending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions(),
  });

  assert.throws(
    () =>
      activateAcceptedLinuxNodeEnrollment({
        configPath: paths.nodePath,
        activeConfigMarkerPath: paths.markerPath,
        pendingConfig: pending,
        response: acceptedResponse({ nodeNumber: '02' }),
      }),
    /does not match this node number/
  );
  assert.equal(existsSync(paths.markerPath), false);
  assert.equal(existsSync(paths.nodePath), false);
});

test('active marker resolution fails closed instead of searching for another config', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const pending = createPendingLinuxNode({
    configPath: paths.nodePath,
    controller: { ipAddress: '192.168.10.82', port: 62021 },
    node: nodeOperator(),
    hostProfileOptions: hostProfileOptions(),
  });

  assert.throws(
    () => resolveActiveLinuxConfig(paths.markerPath),
    (error) => error?.code === 'ENOENT'
  );
  persistNodeConfigFile(paths.nodePath, pending);
  writeFileSync(paths.markerPath, `${paths.nodePath}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(paths.markerPath, 0o600);
  assert.throws(
    () => resolveActiveLinuxConfig(paths.markerPath),
    /has not completed enrollment/
  );
  writeFileSync(paths.markerPath, `${paths.nodePath}\n\n`, { mode: 0o600 });
  assert.throws(
    () => resolveActiveLinuxConfig(paths.markerPath),
    /exactly one absolute config path and a newline/
  );
});

test('canonical filenames and absolute paths are enforced without leaving claims behind', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const wrongControllerPath = join(paths.root, 'controller.cfg');
  assert.throws(
    () =>
      configureLinuxController({
        configPath: wrongControllerPath,
        activeConfigMarkerPath: paths.markerPath,
        operator: controllerOperator(),
        hostProfileOptions: hostProfileOptions(),
      }),
    /filename must be test-suite-multi-computer-JohnCronk79\.cfg/
  );
  assert.equal(existsSync(wrongControllerPath), false);
  assert.throws(
    () =>
      createPendingLinuxNode({
        configPath: 'test-suite-multi-computer-node-01.cfg',
        controller: { ipAddress: '192.168.10.82', port: 62021 },
        node: nodeOperator(),
        hostProfileOptions: hostProfileOptions(),
      }),
    /absolute canonical file path/
  );
});

test('active role expectations reject a valid config of the other role', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  configureLinuxController({
    configPath: paths.controllerPath,
    activeConfigMarkerPath: paths.markerPath,
    operator: controllerOperator(),
    hostProfileOptions: hostProfileOptions(),
  });
  assert.throws(
    () => resolveActiveLinuxConfig(paths.markerPath, { expectedRole: 'node' }),
    /Active config role is controller, not node/
  );
  assert.deepEqual(
    readControllerConfigFile(paths.controllerPath).global,
    controllerOperator({
      cpuName: 'AMD Ryzen 9 7940HS',
      availableThreads: 12,
    })
  );
});
