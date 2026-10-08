import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  addSupportedApplication,
  applyNodeEnrollmentRequest,
  applyNodeEnrollmentResponse,
  canonicalThreadExpression,
  compareDependencyAvailability,
  controllerConfigFilename,
  createControllerConfig,
  createDependencyProvisioningPlan,
  createNodeConfig,
  createNodeEnrollmentRequest,
  createNodeEnrollmentResponse,
  createSupportedApplicationListing,
  deleteSupportedApplication,
  enrollNodeInControllerConfigFile,
  evaluateNodeDependencyEligibility,
  evaluateThreadExpression,
  generateSharedAuthenticationKey,
  githubUsernameFromControllerConfigFilename,
  nodeConfigFilename,
  nodeNumberFromConfigFilename,
  parseApplicationDependencyProfile,
  parseControllerConfig,
  parseNodeConfig,
  persistAcceptedNodeEnrollmentResponse,
  persistControllerConfigFile,
  persistNodeConfigFile,
  readControllerConfigFile,
  readNodeConfigFile,
  serializeControllerConfig,
  serializeNodeConfig,
  setApplicationRequirements,
  setControllerNodeThreadPolicy,
  setControllerNodeThreadPolicyInFile,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';

const sharedKey = (character = 'a') => character.repeat(64);

const controllerGlobal = (changes = {}) => ({
  githubUsername: 'JohnCronk79',
  computerName: "John's Laptop",
  ipAddress: '192.168.10.20',
  port: 7443,
  cpuName: 'AMD Ryzen 9 7940HS',
  availableThreads: 16,
  threads: 'n-2',
  minimumThreadCount: 1,
  ...changes,
});

const controllerNode = (changes = {}) => ({
  nodeNumber: '01',
  computerName: "John's Laptop - VM1",
  ipAddress: '192.168.10.31',
  port: 7443,
  cpuName: 'AMD Ryzen 9 7940HS',
  availableThreads: 8,
  threads: 'n-1',
  minimumThreadCount: 1,
  ...changes,
});

const nodeConfig = (changes = {}) => ({
  controller: { ipAddress: '192.168.10.20', port: 7443 },
  node: {
    nodeNumber: '01',
    computerName: "John's Laptop - VM1",
    ipAddress: '192.168.10.31',
    port: 7443,
    cpuName: 'AMD Ryzen 9 7940HS',
    availableThreads: 8,
  },
  sharedAuthenticationKey: null,
  ...changes,
});

const enrollmentRequest = (changes = {}) => ({
  nodeNumber: '01',
  computerName: "John's Laptop - VM1",
  ipAddress: '192.168.10.31',
  port: 7443,
  cpuName: 'AMD Ryzen 9 7940HS',
  availableThreads: 8,
  overwrite: false,
  ...changes,
});

function assertPrivateMode(path) {
  if (process.platform !== 'win32')
    assert.equal(statSync(path).mode & 0o777, 0o600);
}

test('controller config is canonical, human-readable, and round-trips', () => {
  const config = createControllerConfig({
    global: controllerGlobal(),
    nodes: [
      controllerNode({
        nodeNumber: '02',
        computerName: 'Linux Server',
        ipAddress: '192.168.10.32',
        cpuName: 'Intel Xeon E-2288G',
        availableThreads: 16,
        threads: '2n',
      }),
      controllerNode(),
    ],
    sharedAuthenticationKey: sharedKey(),
  });
  const text = serializeControllerConfig(config);

  assert.match(
    text,
    /^# Test Suite Multi-Computer Controller Configuration\n# github username:/
  );
  const header = text.slice(0, text.indexOf('\n\n[Global Settings]'));
  for (const setting of [
    'github username',
    'computer name',
    'ip address',
    'port',
    'cpu name',
    'available threads',
    'threads',
    'minimum thread count',
    'shared authentication key',
  ])
    assert.match(header, new RegExp(`^# ${setting}:`, 'm'));
  assert.ok(text.indexOf('[Global Settings]') < text.indexOf('[Node 01]'));
  assert.ok(text.indexOf('[Node 01]') < text.indexOf('[Node 02]'));
  assert.ok(text.indexOf('[Node 02]') < text.indexOf('[Cluster Security]'));
  assert.equal(
    text.trimEnd().endsWith(`shared authentication key = ${sharedKey()}`),
    true
  );
  assert.deepEqual(parseControllerConfig(text), config);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.nodes), true);
  assert.equal(Object.isFrozen(config.nodes[0]), true);
});

test('controller config supports zero enrolled nodes and always requires its key', () => {
  const config = createControllerConfig({
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey('b'),
  });
  const text = serializeControllerConfig(config);
  assert.equal(text.includes('[Node '), false);
  assert.deepEqual(parseControllerConfig(text), config);
  assert.throws(
    () =>
      parseControllerConfig(
        text.slice(0, text.indexOf('\n[Cluster Security]'))
      ),
    /must end with \[Cluster Security\]/
  );
});

test('node config supports pre-enrollment and enrolled states', () => {
  const pending = createNodeConfig(nodeConfig());
  const pendingText = serializeNodeConfig(pending);
  assert.match(
    pendingText,
    /^# Test Suite Multi-Computer Node Configuration\n# ip address:/
  );
  const header = pendingText.slice(0, pendingText.indexOf('\n\n[Controller]'));
  for (const setting of [
    'ip address',
    'port',
    'computer name',
    'cpu name',
    'available threads',
    'shared authentication key',
  ])
    assert.match(header, new RegExp(`^# ${setting}:`, 'm'));
  assert.equal(pendingText.includes('[Cluster Security]'), false);
  assert.equal(
    pendingText.split(/\r?\n/).some((line) => line.startsWith('threads =')),
    false
  );
  assert.equal(pendingText.includes('minimum thread count'), false);
  assert.deepEqual(parseNodeConfig(pendingText), pending);

  const enrolled = createNodeConfig(
    nodeConfig({ sharedAuthenticationKey: sharedKey('c') })
  );
  const enrolledText = serializeNodeConfig(enrolled);
  assert.equal(
    enrolledText
      .trimEnd()
      .endsWith(`shared authentication key = ${sharedKey('c')}`),
    true
  );
  assert.deepEqual(parseNodeConfig(enrolledText), enrolled);
});

test('trusted-private-network first contact has no bootstrap credential', () => {
  const request = createNodeEnrollmentRequest(enrollmentRequest());
  assert.deepEqual(request, enrollmentRequest());
  assert.equal(Object.isFrozen(request), true);

  for (const [field, value] of [
    ['bootstrapKey', sharedKey()],
    ['pairingCode', '123456'],
    ['sharedAuthenticationKey', sharedKey()],
    ['certificateSha256', sharedKey()],
  ])
    assert.throws(
      () =>
        createNodeEnrollmentRequest({
          ...enrollmentRequest(),
          [field]: value,
        }),
      /exact field set/
    );
  assert.throws(
    () => createNodeEnrollmentRequest(enrollmentRequest({ overwrite: 1 })),
    /overwrite must be boolean/
  );
});

test('new node enrollment returns the controller shared key and no thread policy', () => {
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey('d'),
  });
  const outcome = applyNodeEnrollmentRequest(controller, enrollmentRequest());
  assert.deepEqual(outcome.response, {
    status: 'accepted',
    disposition: 'created',
    nodeNumber: '01',
    sharedAuthenticationKey: sharedKey('d'),
  });
  assert.equal(outcome.controllerConfig.nodes.length, 1);
  assert.equal(outcome.controllerConfig.nodes[0].threads, null);
  assert.equal(outcome.controllerConfig.nodes[0].minimumThreadCount, null);
  assert.equal(controller.nodes.length, 0);

  const enrolledNode = applyNodeEnrollmentResponse(
    createNodeConfig(nodeConfig()),
    outcome.response
  );
  assert.equal(enrolledNode.sharedAuthenticationKey, sharedKey('d'));
});

test('same node refreshes facts while preserving controller-owned thread policy', () => {
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    sharedAuthenticationKey: sharedKey('e'),
  });
  const outcome = applyNodeEnrollmentRequest(
    controller,
    enrollmentRequest({
      computerName: "John's Laptop - VM1 refreshed",
      port: 7555,
      cpuName: 'AMD Ryzen 9 7940HS virtual CPU',
      availableThreads: 12,
    })
  );
  assert.equal(outcome.response.status, 'accepted');
  assert.equal(outcome.response.disposition, 'refreshed');
  assert.equal(
    outcome.controllerConfig.nodes[0].computerName,
    "John's Laptop - VM1 refreshed"
  );
  assert.equal(outcome.controllerConfig.nodes[0].port, 7555);
  assert.equal(outcome.controllerConfig.nodes[0].availableThreads, 12);
  assert.equal(outcome.controllerConfig.nodes[0].threads, 'n-1');
  assert.equal(outcome.controllerConfig.nodes[0].minimumThreadCount, 1);
  assert.equal(controller.nodes[0].computerName, "John's Laptop - VM1");
});

test('occupied node conflicts until explicit overwrite clears its thread policy', () => {
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    sharedAuthenticationKey: sharedKey('f'),
  });
  const replacement = enrollmentRequest({
    computerName: 'Replacement Server',
    ipAddress: '192.168.10.41',
    cpuName: 'Intel Xeon Replacement',
    availableThreads: 24,
  });
  const conflict = applyNodeEnrollmentRequest(controller, replacement);
  assert.deepEqual(conflict.response, {
    status: 'conflict',
    reason: 'node-number-occupied',
    nodeNumber: '01',
    existingNode: {
      nodeNumber: '01',
      computerName: "John's Laptop - VM1",
      ipAddress: '192.168.10.31',
      port: 7443,
      cpuName: 'AMD Ryzen 9 7940HS',
      availableThreads: 8,
    },
  });
  assert.equal('sharedAuthenticationKey' in conflict.response, false);
  assert.equal('threads' in conflict.response.existingNode, false);
  assert.equal(conflict.controllerConfig.nodes[0].threads, 'n-1');
  assert.deepEqual(
    createNodeEnrollmentResponse(conflict.response),
    conflict.response
  );
  assert.throws(
    () =>
      createNodeEnrollmentResponse({
        ...conflict.response,
        existingNode: {
          ...conflict.response.existingNode,
          nodeNumber: '02',
        },
      }),
    /conflict identity is inconsistent/
  );

  const overwritten = applyNodeEnrollmentRequest(controller, {
    ...replacement,
    overwrite: true,
  });
  assert.equal(overwritten.response.status, 'accepted');
  assert.equal(overwritten.response.disposition, 'overwritten');
  assert.equal(
    overwritten.controllerConfig.nodes[0].computerName,
    'Replacement Server'
  );
  assert.equal(
    overwritten.controllerConfig.nodes[0].ipAddress,
    '192.168.10.41'
  );
  assert.equal(overwritten.controllerConfig.nodes[0].threads, null);
  assert.equal(overwritten.controllerConfig.nodes[0].minimumThreadCount, null);

  assert.throws(
    () =>
      applyNodeEnrollmentResponse(
        createNodeConfig(nodeConfig()),
        conflict.response
      ),
    /cannot enroll a node/
  );
  assert.throws(
    () =>
      applyNodeEnrollmentResponse(createNodeConfig(nodeConfig()), {
        ...overwritten.response,
        nodeNumber: '02',
      }),
    /does not match this node number/
  );
});

test('refresh preserves dependency state while overwrite clears stale machine state', () => {
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
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    supportedApplications: [
      {
        ...selectedApplications[0],
        profilePath: join(tmpdir(), 'seerrng-test-suite-dependancies.cfg'),
      },
    ],
    applicationRequirements: [
      {
        applicationId: 'SeerrNG 3.17.0',
        dependencies: dependencyAvailability,
      },
    ],
    nodeDependencyAvailability: [
      { nodeNumber: '01', dependencies: dependencyAvailability },
    ],
    sharedAuthenticationKey: sharedKey('f'),
  });
  const refresh = applyNodeEnrollmentRequest(controller, {
    ...enrollmentRequest({ computerName: 'Refreshed server' }),
  });
  assert.equal(refresh.response.status, 'accepted');
  assert.equal(refresh.response.disposition, 'refreshed');
  assert.equal('selectedApplications' in refresh.response, false);
  assert.deepEqual(
    refresh.controllerConfig.nodeDependencyAvailability,
    controller.nodeDependencyAvailability
  );

  const existingNode = createNodeConfig({
    ...nodeConfig(),
    selectedApplications,
    dependencyAvailability,
  });
  const preserved = applyNodeEnrollmentResponse(existingNode, refresh.response);
  assert.deepEqual(preserved.selectedApplications, selectedApplications);
  assert.deepEqual(preserved.dependencyAvailability, dependencyAvailability);

  const outcome = applyNodeEnrollmentRequest(controller, {
    ...enrollmentRequest({
      computerName: 'Reconfigured server',
      ipAddress: '192.168.10.41',
    }),
    overwrite: true,
  });

  assert.equal(outcome.response.status, 'accepted');
  assert.equal(outcome.response.disposition, 'overwritten');
  assert.deepEqual(outcome.response.selectedApplications, []);
  assert.deepEqual(outcome.response.dependencyAvailability, []);
  assert.deepEqual(outcome.controllerConfig.nodeDependencyAvailability, []);
  const cleared = applyNodeEnrollmentResponse(existingNode, outcome.response);
  assert.deepEqual(cleared.selectedApplications, []);
  assert.deepEqual(cleared.dependencyAvailability, []);

  const replacementApplications = [
    {
      entryId: '02',
      applicationId: 'Radarr 6.0.4',
      name: 'Radarr 4K',
    },
  ];
  const replacementAvailability = [{ name: 'dotnet-sdk', version: '9.0.318' }];
  const replaced = applyNodeEnrollmentResponse(existingNode, {
    ...outcome.response,
    selectedApplications: replacementApplications,
    dependencyAvailability: replacementAvailability,
  });
  assert.deepEqual(replaced.selectedApplications, replacementApplications);
  assert.deepEqual(replaced.dependencyAvailability, replacementAvailability);
});

test('an IP already assigned to another node remains a conflict', () => {
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [
      controllerNode(),
      controllerNode({
        nodeNumber: '02',
        computerName: 'Linux Server',
        ipAddress: '192.168.10.32',
      }),
    ],
    sharedAuthenticationKey: sharedKey(),
  });
  const outcome = applyNodeEnrollmentRequest(
    controller,
    enrollmentRequest({
      nodeNumber: '03',
      ipAddress: '192.168.10.32',
      overwrite: true,
    })
  );
  assert.equal(outcome.response.status, 'conflict');
  assert.equal(outcome.response.reason, 'node-ip-address-occupied');
  assert.equal(outcome.response.existingNode.nodeNumber, '02');
});

test('controller and node enrollment persistence is atomic and private', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mode3-linux-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controllerPath = join(
    directory,
    controllerConfigFilename('JohnCronk79')
  );
  const nodePath = join(directory, nodeConfigFilename('01'));
  const controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey('7'),
  });
  const pendingNode = createNodeConfig(nodeConfig());

  persistControllerConfigFile(controllerPath, controller);
  persistNodeConfigFile(nodePath, pendingNode);
  assert.deepEqual(readControllerConfigFile(controllerPath), controller);
  assert.deepEqual(readNodeConfigFile(nodePath), pendingNode);
  assertPrivateMode(controllerPath);
  assertPrivateMode(nodePath);

  const response = enrollNodeInControllerConfigFile(
    controllerPath,
    enrollmentRequest()
  );
  assert.equal(response.status, 'accepted');
  assert.equal(response.disposition, 'created');
  assert.equal(response.sharedAuthenticationKey, sharedKey('7'));
  const persistedController = readControllerConfigFile(controllerPath);
  assert.equal(persistedController.nodes.length, 1);
  assert.equal(persistedController.nodes[0].threads, null);

  const enrolledNode = persistAcceptedNodeEnrollmentResponse(
    nodePath,
    response
  );
  assert.equal(enrolledNode.sharedAuthenticationKey, sharedKey('7'));
  assert.deepEqual(readNodeConfigFile(nodePath), enrolledNode);
  assert.equal(
    readFileSync(nodePath, 'utf8')
      .trimEnd()
      .endsWith(`shared authentication key = ${sharedKey('7')}`),
    true
  );
  assertPrivateMode(controllerPath);
  assertPrivateMode(nodePath);
  assert.deepEqual(readdirSync(directory).toSorted(), [
    controllerConfigFilename('JohnCronk79'),
    nodeConfigFilename('01'),
  ]);
});

test('controller persistence lock prevents an enrollment race without rewriting config', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mode3-linux-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controllerPath = join(
    directory,
    controllerConfigFilename('JohnCronk79')
  );
  persistControllerConfigFile(controllerPath, {
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey('8'),
  });
  const before = readFileSync(controllerPath, 'utf8');
  const lockPath = `${controllerPath}.lock`;
  writeFileSync(lockPath, 'another installer owns this lock\n', {
    flag: 'wx',
    mode: 0o600,
  });

  assert.throws(
    () => enrollNodeInControllerConfigFile(controllerPath, enrollmentRequest()),
    /already being updated/
  );
  assert.equal(readFileSync(controllerPath, 'utf8'), before);
  assert.equal(
    readFileSync(lockPath, 'utf8'),
    'another installer owns this lock\n'
  );
});

test('newly enrolled controller nodes remain unscheduled until both thread settings are assigned', () => {
  const { threads, minimumThreadCount, ...registeredNode } = controllerNode();
  assert.equal(threads, 'n-1');
  assert.equal(minimumThreadCount, 1);
  const config = createControllerConfig({
    global: controllerGlobal(),
    nodes: [registeredNode],
    sharedAuthenticationKey: sharedKey(),
  });
  assert.equal(config.nodes[0].threads, null);
  assert.equal(config.nodes[0].minimumThreadCount, null);

  const text = serializeControllerConfig(config);
  const nodeSection = text.slice(
    text.indexOf('[Node 01]'),
    text.indexOf('[Cluster Security]')
  );
  assert.equal(
    nodeSection.split(/\r?\n/).some((line) => line.startsWith('threads =')),
    false
  );
  assert.equal(
    nodeSection
      .split(/\r?\n/)
      .some((line) => line.startsWith('minimum thread count =')),
    false
  );
  assert.match(
    nodeSection,
    /Configure Controller must assign threads and minimum thread count before scheduling/
  );
  assert.deepEqual(parseControllerConfig(text), config);

  assert.throws(
    () =>
      parseControllerConfig(
        text.replace(
          '# Configure Controller must assign threads and minimum thread count before scheduling.',
          'threads = n-1'
        )
      ),
    /threads and minimum thread count must be assigned together/
  );
  assert.throws(
    () =>
      createControllerConfig({
        global: controllerGlobal(),
        nodes: [{ ...registeredNode, threads: 'n-1' }],
        sharedAuthenticationKey: sharedKey(),
      }),
    /threads and minimum thread count must be assigned together/
  );
  assert.throws(
    () =>
      createControllerConfig({
        global: controllerGlobal(),
        nodes: [
          {
            ...registeredNode,
            threads: null,
            minimumThreadCount: 1,
          },
        ],
        sharedAuthenticationKey: sharedKey(),
      }),
    /threads and minimum thread count must be assigned together/
  );
});

test('controller-owned node thread policy updates one enrolled node atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-mode3-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const controllerPath = join(
    directory,
    controllerConfigFilename('JohnCronk79')
  );
  const { threads, minimumThreadCount, ...unassignedNode } = controllerNode();
  assert.equal(threads, 'n-1');
  assert.equal(minimumThreadCount, 1);
  const original = createControllerConfig({
    global: controllerGlobal(),
    nodes: [unassignedNode],
    supportedApplications: [],
    applicationRequirements: [],
    nodeDependencyAvailability: [],
    sharedAuthenticationKey: sharedKey('6'),
  });

  const updated = setControllerNodeThreadPolicy(original, {
    nodeNumber: '01',
    threads: 'n-2',
    minimumThreadCount: 2,
  });
  assert.deepEqual(updated.nodes[0], {
    ...unassignedNode,
    threads: 'n-2',
    minimumThreadCount: 2,
  });
  assert.equal(
    updated.sharedAuthenticationKey,
    original.sharedAuthenticationKey
  );
  assert.deepEqual(updated.supportedApplications, []);
  assert.equal(original.nodes[0].threads, null);

  assert.throws(
    () =>
      setControllerNodeThreadPolicy(original, {
        nodeNumber: '02',
        threads: 'n',
        minimumThreadCount: 1,
      }),
    /node 02 is not enrolled/i
  );
  assert.throws(
    () =>
      setControllerNodeThreadPolicy(original, {
        nodeNumber: '01',
        threads: '0',
        minimumThreadCount: 1,
      }),
    /Threads must be/
  );

  persistControllerConfigFile(controllerPath, original);
  const assigned = setControllerNodeThreadPolicyInFile(controllerPath, {
    nodeNumber: '01',
    threads: '2n',
    minimumThreadCount: 1,
  });
  assert.equal(assigned.threads, '2n');
  assert.equal(assigned.minimumThreadCount, 1);
  assert.deepEqual(readControllerConfigFile(controllerPath).nodes[0], assigned);
});

test('comments and Windows line endings are accepted without weakening keys', () => {
  const text = serializeControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    sharedAuthenticationKey: sharedKey(),
  })
    .replace(
      '[Global Settings]',
      '; This comment is intentionally ignored.\n[Global Settings]'
    )
    .replace('[Node 01]', '# Node description\n[Node 01]')
    .replaceAll('\n', '\r\n');
  const parsed = parseControllerConfig(text);
  assert.equal(parsed.global.computerName, "John's Laptop");
  assert.equal(parsed.nodes[0].computerName, "John's Laptop - VM1");
});

test('thread expressions apply minimums and the 256-thread cap', () => {
  for (const expression of ['1', '16', 'n', 'n-1', '2n', '3n+2', '20n-7'])
    assert.equal(canonicalThreadExpression(expression), expression);

  assert.equal(evaluateThreadExpression('4', 8, 1), 4);
  assert.equal(evaluateThreadExpression('4', 8, 7), 7);
  assert.equal(evaluateThreadExpression('n', 8, 1), 8);
  assert.equal(evaluateThreadExpression('n-1', 8, 1), 7);
  assert.equal(evaluateThreadExpression('2n', 8, 1), 16);
  assert.equal(evaluateThreadExpression('3n+2', 8, 1), 26);
  assert.equal(evaluateThreadExpression('n-20', 8, 3), 3);
  assert.equal(evaluateThreadExpression('300', 8, 1), 256);
  assert.equal(evaluateThreadExpression('2n', 200, 1), 256);

  for (const expression of [
    '0',
    '-1',
    'N',
    '1n',
    '01n',
    '0n',
    'n + 1',
    'n+0',
    'n--1',
    '2.5n',
    '2n-',
  ])
    assert.throws(
      () => canonicalThreadExpression(expression),
      /positive integer or a canonical n expression/
    );
  assert.throws(() => evaluateThreadExpression('n', 0, 1), /Available threads/);
  assert.throws(
    () => evaluateThreadExpression('n', 8, 0),
    /Minimum thread count/
  );
  assert.throws(
    () => evaluateThreadExpression('n', 8, 257),
    /Minimum thread count/
  );
});

test('unknown and duplicate sections or settings fail closed', () => {
  const controllerText = serializeControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    sharedAuthenticationKey: sharedKey(),
  });
  assert.throws(
    () =>
      parseControllerConfig(
        controllerText.replace(
          "computer name = John's Laptop",
          "computer name = John's Laptop\ncomputer name = Other"
        )
      ),
    /repeats setting computer name/
  );
  assert.throws(
    () =>
      parseControllerConfig(
        controllerText.replace(
          'cpu name = AMD Ryzen 9 7940HS',
          'processor = AMD Ryzen 9 7940HS'
        )
      ),
    /unknown setting processor/
  );
  assert.throws(
    () =>
      parseControllerConfig(
        controllerText.replace(
          '\n[Cluster Security]',
          '\n[Node 01]\ncomputer name = Duplicate\n\n[Cluster Security]'
        )
      ),
    /repeats section \[Node 01\]/
  );
  assert.throws(
    () => parseControllerConfig(`${controllerText}# after the key\n`),
    /must be the final setting/
  );

  const pendingNodeText = serializeNodeConfig(nodeConfig());
  assert.throws(
    () =>
      parseNodeConfig(
        pendingNodeText.replace(
          'available threads = 8',
          'available threads = 8\nthreads = n-1'
        )
      ),
    /unknown setting threads/
  );
  assert.throws(
    () => parseNodeConfig(pendingNodeText.replace('[Node 01]', '[Node 00]')),
    /Unknown Mode 3 section/
  );
});

test('addresses, ports, node numbers, usernames, and keys are strict', () => {
  assert.throws(
    () =>
      createControllerConfig({
        global: controllerGlobal({ ipAddress: 'controller.lan' }),
        nodes: [],
        sharedAuthenticationKey: sharedKey(),
      }),
    /must be an IP address/
  );
  assert.throws(
    () =>
      createNodeConfig(
        nodeConfig({
          controller: { ipAddress: '192.168.10.20', port: 0 },
        })
      ),
    /node controller port/
  );
  assert.throws(
    () =>
      createNodeConfig(
        nodeConfig({ node: { ...nodeConfig().node, nodeNumber: '1' } })
      ),
    /two digits from 01 through 99/
  );
  assert.throws(
    () =>
      createControllerConfig({
        global: controllerGlobal({ githubUsername: '-john' }),
        nodes: [],
        sharedAuthenticationKey: sharedKey(),
      }),
    /GitHub username is invalid/
  );
  assert.throws(
    () =>
      createNodeConfig(nodeConfig({ sharedAuthenticationKey: sharedKey('A') })),
    /64 lower-case hexadecimal/
  );
  assert.throws(
    () =>
      createControllerConfig({
        global: controllerGlobal(),
        nodes: [controllerNode(), controllerNode({ nodeNumber: '02' })],
        sharedAuthenticationKey: sharedKey(),
      }),
    /duplicate node ip address/
  );
  assert.throws(
    () =>
      createNodeConfig(
        nodeConfig({
          node: { ...nodeConfig().node, ipAddress: '192.168.10.20' },
        })
      ),
    /different computers/
  );
});

test('controller and node filenames are generated and validated', () => {
  assert.equal(
    controllerConfigFilename('JohnCronk79'),
    'test-suite-multi-computer-JohnCronk79.cfg'
  );
  assert.equal(
    githubUsernameFromControllerConfigFilename(
      'test-suite-multi-computer-snapetech.cfg'
    ),
    'snapetech'
  );
  assert.equal(
    nodeConfigFilename('01'),
    'test-suite-multi-computer-node-01.cfg'
  );
  assert.equal(
    nodeNumberFromConfigFilename('test-suite-multi-computer-node-99.cfg'),
    '99'
  );
  assert.throws(() => controllerConfigFilename('john--cronk'), /invalid/);
  assert.throws(() => nodeConfigFilename('00'), /01 through 99/);
  assert.throws(
    () => nodeNumberFromConfigFilename('test-suite-multi-computer-node-1.cfg'),
    /filename is invalid/
  );
});

test('shared authentication key generation produces one 256-bit lower-case key', () => {
  const first = generateSharedAuthenticationKey();
  const second = generateSharedAuthenticationKey();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test('object entry points reject fields that are not part of the config model', () => {
  assert.throws(
    () =>
      createControllerConfig({
        global: { ...controllerGlobal(), password: 'not-allowed' },
        nodes: [],
        sharedAuthenticationKey: sharedKey(),
      }),
    /exact field set/
  );
  assert.throws(
    () => createNodeConfig({ ...nodeConfig(), threads: 'n' }),
    /exact field set/
  );
});

test('application dependency profiles contain only strict name/version pairs', () => {
  assert.deepEqual(
    parseApplicationDependencyProfile(
      '[Dependencies]\nnode = 24.21.0\npnpm = 10.24.0\n'
    ),
    [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ]
  );
  assert.throws(
    () => parseApplicationDependencyProfile('[Tools]\nnode = 24.21.0\n'),
    /exactly one \[Dependencies\]/
  );
  assert.throws(
    () =>
      parseApplicationDependencyProfile(
        '[Dependencies]\nnode = 24.21.0\nnode = 22.0.0\n'
      ),
    /repeats setting node/
  );
});

test('controller config stores numbered instances separately from product/version requirements', () => {
  const base = createControllerConfig({
    global: controllerGlobal(),
    nodes: [controllerNode()],
    sharedAuthenticationKey: sharedKey(),
  });
  const dependencies = [
    { name: 'node', version: '24.21.0' },
    { name: 'pnpm', version: '10.24.0' },
  ];
  const first = addSupportedApplication(base, {
    applicationId: 'Sonarr 4.0.15',
    name: 'Sonarr HD',
    profilePath: join(tmpdir(), 'sonarr-test-suite-dependancies.cfg'),
    dependencies,
  });
  const second = addSupportedApplication(first.controllerConfig, {
    applicationId: 'Sonarr 4.0.15',
    name: 'Sonarr 4K',
    profilePath: join(tmpdir(), 'sonarr-test-suite-dependancies.cfg'),
    dependencies,
  });
  assert.equal(first.application.entryId, '01');
  assert.equal(second.application.entryId, '02');
  assert.equal(second.controllerConfig.applicationRequirements.length, 1);

  const text = serializeControllerConfig(second.controllerConfig);
  assert.match(text, /^\[Supported Applications\]$/m);
  assert.match(text, /^01 application id = Sonarr 4\.0\.15$/m);
  assert.match(text, /^02 name = Sonarr 4K$/m);
  assert.match(text, /^\[Application Sonarr 4\.0\.15 Requirements\]$/m);
  assert.deepEqual(parseControllerConfig(text), second.controllerConfig);
  assert.deepEqual(
    createSupportedApplicationListing(second.controllerConfig).applications.map(
      ({ entryId, applicationId, name }) => ({ entryId, applicationId, name })
    ),
    [
      {
        entryId: '01',
        applicationId: 'Sonarr 4.0.15',
        name: 'Sonarr HD',
      },
      {
        entryId: '02',
        applicationId: 'Sonarr 4.0.15',
        name: 'Sonarr 4K',
      },
    ]
  );

  const oneRemaining = deleteSupportedApplication(
    second.controllerConfig,
    '01'
  );
  assert.equal(oneRemaining.controllerConfig.applicationRequirements.length, 1);
  const noneRemaining = deleteSupportedApplication(
    oneRemaining.controllerConfig,
    '02'
  );
  assert.equal(
    noneRemaining.controllerConfig.applicationRequirements.length,
    0
  );
});

test('dependency planning deduplicates exact versions and rejects incompatible selections', () => {
  let config = createControllerConfig({
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey(),
  });
  config = addSupportedApplication(config, {
    applicationId: 'Sonarr 4.0.15',
    name: 'Sonarr HD',
    profilePath: join(tmpdir(), 'sonarr-test-suite-dependancies.cfg'),
    dependencies: [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ],
  }).controllerConfig;
  config = addSupportedApplication(config, {
    applicationId: 'Radarr 6.0.4',
    name: 'Radarr 4K',
    profilePath: join(tmpdir(), 'radarr-test-suite-dependancies.cfg'),
    dependencies: [
      { name: 'dotnet-sdk', version: '9.0.318' },
      { name: 'node', version: '24.21.0' },
    ],
  }).controllerConfig;
  assert.deepEqual(createDependencyProvisioningPlan(config, ['02', '01']), {
    selectedApplications: [
      {
        entryId: '01',
        applicationId: 'Sonarr 4.0.15',
        name: 'Sonarr HD',
      },
      {
        entryId: '02',
        applicationId: 'Radarr 6.0.4',
        name: 'Radarr 4K',
      },
    ],
    dependencies: [
      { name: 'dotnet-sdk', version: '9.0.318' },
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ],
  });

  const conflict = addSupportedApplication(config, {
    applicationId: 'Lidarr 3.0.2',
    name: 'Lidarr Music',
    profilePath: join(tmpdir(), 'lidarr-test-suite-dependancies.cfg'),
    dependencies: [{ name: 'node', version: '22.0.0' }],
  }).controllerConfig;
  assert.throws(
    () => createDependencyProvisioningPlan(conflict, ['01', '03']),
    /incompatible required versions 24\.21\.0 and 22\.0\.0/
  );
});

test('node dependency reports remain distinct from requirements and drive eligibility', () => {
  let controller = createControllerConfig({
    global: controllerGlobal(),
    nodes: [],
    sharedAuthenticationKey: sharedKey('9'),
  });
  controller = addSupportedApplication(controller, {
    applicationId: 'SeerrNG 3.17.0',
    name: 'SeerrNG',
    profilePath: join(tmpdir(), 'seerrng-test-suite-dependancies.cfg'),
    dependencies: [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.24.0' },
    ],
  }).controllerConfig;
  const outcome = applyNodeEnrollmentRequest(controller, {
    ...enrollmentRequest(),
    selectedApplicationEntries: ['01'],
    dependencyAvailability: [
      { name: 'node', version: '24.21.0' },
      { name: 'pnpm', version: '10.23.0' },
    ],
  });
  assert.deepEqual(outcome.response.selectedApplications, [
    {
      entryId: '01',
      applicationId: 'SeerrNG 3.17.0',
      name: 'SeerrNG',
    },
  ]);
  assert.deepEqual(outcome.controllerConfig.nodeDependencyAvailability, [
    {
      nodeNumber: '01',
      dependencies: [
        { name: 'node', version: '24.21.0' },
        { name: 'pnpm', version: '10.23.0' },
      ],
    },
  ]);
  const enrolledNode = applyNodeEnrollmentResponse(
    createNodeConfig(nodeConfig()),
    outcome.response
  );
  assert.deepEqual(enrolledNode.selectedApplications, [
    {
      entryId: '01',
      applicationId: 'SeerrNG 3.17.0',
      name: 'SeerrNG',
    },
  ]);
  assert.deepEqual(
    parseNodeConfig(serializeNodeConfig(enrolledNode)),
    enrolledNode
  );

  const eligibility = evaluateNodeDependencyEligibility(
    outcome.controllerConfig,
    'SeerrNG 3.17.0'
  );
  assert.deepEqual(eligibility.eligibleNodeNumbers, []);
  assert.deepEqual(eligibility.nodes[0].mismatched, [
    {
      name: 'pnpm',
      requiredVersion: '10.24.0',
      actualVersion: '10.23.0',
    },
  ]);
  const comparison = compareDependencyAvailability(
    createDependencyProvisioningPlan(outcome.controllerConfig, ['01']),
    outcome.response.dependencyAvailability
  );
  assert.equal(comparison.status, 'incomplete');
  assert.equal(comparison.mismatched.length, 1);

  const fresh = setApplicationRequirements(
    outcome.controllerConfig,
    'SeerrNG 3.17.0',
    [{ name: 'node', version: '24.21.0' }]
  );
  assert.deepEqual(
    evaluateNodeDependencyEligibility(fresh, 'SeerrNG 3.17.0')
      .eligibleNodeNumbers,
    ['01']
  );
});
