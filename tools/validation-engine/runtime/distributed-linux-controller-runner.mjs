// Copyright (c) snapetech and SeerrNG contributors.
// One-shot Linux Mode 3 controller bound to one exact application catalog.
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  createControllerAdaptiveSchedule,
  DISTRIBUTED_CONTROLLER_NODE_ID,
  DISTRIBUTED_NODE_PROBE_SCHEMA,
} from './distributed-controller-adaptive-bridge.mjs';
import {
  createControllerConfig,
  evaluateNodeDependencyAvailability,
  readApplicationDependencyProfileFile,
} from './distributed-linux-config.mjs';
import { detectLinuxHostProfile } from './distributed-linux-host-profile.mjs';
import { resolveActiveLinuxConfig } from './distributed-linux-management.mjs';
import { verifyDistributedLinuxNodeAttestation } from './distributed-linux-node-attestation.mjs';
import {
  DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
  DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA,
  DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
  DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA,
  distributedLinuxControllerId,
  distributedLinuxNodeId,
  resolveDistributedLinuxTaskTimeoutBudget,
} from './distributed-linux-node-runner.mjs';
import {
  createDistributedNativeTaskRequest,
  DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
  discoverDistributedNativeCatalog,
  executeDistributedNativeTask,
  verifyDistributedNativeTaskResult,
} from './distributed-native-adapter.mjs';
import {
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
  requestDistributedNodeJson,
} from './distributed-node-transport.mjs';
import { executeDistributedShardSchedule } from './distributed-shard-executor.mjs';

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONNECTIVITY_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_DISTRIBUTED_NODE_TIMEOUT',
]);
const MAX_APPLICATION_ROOT_BYTES = 4096;
const APPLICATION_NOT_CONFIGURED = 'application-not-configured';

export const DISTRIBUTED_LINUX_APPLICATION_ADMISSION_SCHEMA =
  'seerrng-distributed-linux-application-admission/v1';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} has unexpected or missing fields`);
  return value;
}

function exactText(value, label, maximum = 512) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Values cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function identifier(value, label) {
  const normalized = exactText(value, label, 128);
  if (!ID.test(normalized)) throw new Error(`Exact ${label} is required`);
  return normalized;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  return value;
}

function normalizeApplication(applicationIdValue, applicationRootValue) {
  const applicationId = identifier(
    applicationIdValue,
    'controller application ID'
  );
  const applicationRoot = exactText(
    applicationRootValue,
    'controller application root',
    MAX_APPLICATION_ROOT_BYTES
  );
  if (
    !isAbsolute(applicationRoot) ||
    resolve(applicationRoot) !== applicationRoot
  )
    throw new Error(
      'Controller application root must be an absolute normalized path'
    );
  return { applicationId, applicationRoot };
}

function normalizeProfile(value, config) {
  exactKeys(value, ['availableThreads', 'cpuName'], 'controller host profile');
  const profile = {
    cpuName: exactText(value.cpuName, 'controller CPU name'),
    availableThreads: positiveInteger(
      value.availableThreads,
      'controller available threads',
      65_536
    ),
  };
  if (
    profile.cpuName !== config.global.cpuName ||
    profile.availableThreads !== config.global.availableThreads
  )
    throw new Error(
      'Controller host profile differs from its configured identity'
    );
  return deepFreeze(profile);
}

function normalizeActiveConfig(value) {
  exactKeys(value, ['config', 'configPath', 'role'], 'active Linux config');
  if (value.role !== 'controller')
    throw new Error('Active Linux config is not a controller configuration');
  exactText(
    value.configPath,
    'active Linux config path',
    MAX_APPLICATION_ROOT_BYTES
  );
  return createControllerConfig(value.config);
}

async function loadConfig({
  config,
  activeConfigMarkerPath,
  activeConfigResolver,
}) {
  const direct = config !== undefined;
  const routed = activeConfigMarkerPath !== undefined;
  if (direct === routed)
    throw new Error(
      'Linux controller runner requires exactly one config or active config marker'
    );
  if (direct) return createControllerConfig(config);
  if (typeof activeConfigResolver !== 'function')
    throw new Error(
      'Linux controller runner requires an active config resolver'
    );
  return normalizeActiveConfig(
    await activeConfigResolver(activeConfigMarkerPath, {
      expectedRole: 'controller',
    })
  );
}

function adapterIds(catalog) {
  return [...new Set(catalog.tasks.map((task) => task.adapterId))].toSorted(
    compareText
  );
}

function createBridgeProbe({
  nodeId,
  ipAddress,
  port,
  cpuName,
  availableThreads,
  catalog,
}) {
  return deepFreeze({
    schema: DISTRIBUTED_NODE_PROBE_SCHEMA,
    nodeId,
    ipAddress,
    port,
    cpuName,
    availableThreads,
    environment: catalog.platform,
    adapterIds: adapterIds(catalog),
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
  });
}

function applicationEvidence(node, catalog, nodeAttestation = null) {
  const evidence = {
    nodeId: node.nodeId,
    computerName: node.computerName,
    ipAddress: node.ipAddress,
    port: node.port,
    cpuName: node.cpuName,
    availableThreads: node.availableThreads,
    applicationId: catalog.applicationId,
    platform: catalog.platform,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    inventorySha256: catalog.inventorySha256,
    taskCount: catalog.tasks.length,
  };
  if (nodeAttestation !== null) evidence.nodeAttestation = nodeAttestation;
  return deepFreeze(evidence);
}

function applicationAdmissionNode(node, nodeNumber) {
  return deepFreeze({
    nodeId: node.nodeId,
    nodeNumber,
    computerName: node.computerName,
    ipAddress: node.ipAddress,
    port: node.port,
    cpuName: node.cpuName,
    availableThreads: node.availableThreads,
  });
}

function normalizeRemoteProbeReport(
  value,
  { requestId, configuredNode, applicationId, catalog }
) {
  exactKeys(
    value,
    ['applications', 'attestation', 'node', 'requestId', 'schema'],
    `probe report for node-${configuredNode.nodeNumber}`
  );
  if (value.schema !== DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA)
    throw new Error('Remote node probe report uses an unsupported schema');
  if (identifier(value.requestId, 'remote probe request ID') !== requestId)
    throw new Error('Remote node probe request binding is invalid');
  const attestation = verifyDistributedLinuxNodeAttestation(value.attestation);
  exactKeys(
    value.node,
    [
      'availableThreads',
      'computerName',
      'cpuName',
      'ipAddress',
      'nodeId',
      'nodeNumber',
      'port',
    ],
    'remote probe node identity'
  );
  const expectedNodeId = distributedLinuxNodeId(configuredNode.nodeNumber);
  const node = {
    nodeId: identifier(value.node.nodeId, 'remote node ID'),
    nodeNumber: exactText(value.node.nodeNumber, 'remote node number'),
    computerName: exactText(value.node.computerName, 'remote computer name'),
    ipAddress: exactText(value.node.ipAddress, 'remote node IP address'),
    port: positiveInteger(value.node.port, 'remote node port', 65_535),
    cpuName: exactText(value.node.cpuName, 'remote CPU name'),
    availableThreads: positiveInteger(
      value.node.availableThreads,
      'remote available threads',
      65_536
    ),
  };
  if (
    node.nodeId !== expectedNodeId ||
    node.nodeNumber !== configuredNode.nodeNumber ||
    node.computerName !== configuredNode.computerName ||
    node.ipAddress !== configuredNode.ipAddress ||
    node.port !== configuredNode.port ||
    node.cpuName !== configuredNode.cpuName ||
    node.availableThreads !== configuredNode.availableThreads
  )
    throw new Error(
      `Remote ${expectedNodeId} identity differs from controller config`
    );

  if (!Array.isArray(value.applications) || value.applications.length !== 1)
    throw new Error(
      'Remote probe must report exactly the requested application'
    );
  const application = plainObject(
    value.applications[0],
    'remote probe application identity'
  );
  const applicationStatus = exactText(
    application.status,
    'remote application status'
  );
  if (applicationStatus === 'unavailable') {
    exactKeys(
      application,
      ['applicationId', 'reason', 'status'],
      'remote unavailable application evidence'
    );
    const reportedApplicationId = identifier(
      application.applicationId,
      'remote unavailable application ID'
    );
    if (
      reportedApplicationId !== applicationId ||
      application.reason !== APPLICATION_NOT_CONFIGURED
    )
      throw new Error(
        `Remote ${expectedNodeId} unavailable application evidence is invalid`
      );
    return deepFreeze({
      node,
      attestation,
      application: null,
      exclusion: {
        ...applicationAdmissionNode(node, configuredNode.nodeNumber),
        applicationId: reportedApplicationId,
        reason: APPLICATION_NOT_CONFIGURED,
      },
    });
  }
  if (applicationStatus !== 'available')
    throw new Error('Remote probe application status is unsupported');
  exactKeys(
    application,
    [
      'applicationId',
      'candidateSha256',
      'catalogSha256',
      'inventorySha256',
      'platform',
      'status',
      'taskCount',
    ],
    'remote probe application identity'
  );
  const normalizedApplication = {
    applicationId: identifier(
      application.applicationId,
      'remote application ID'
    ),
    status: 'available',
    platform: identifier(application.platform, 'remote application platform'),
    candidateSha256: digest(
      application.candidateSha256,
      'remote candidate identity'
    ),
    catalogSha256: digest(application.catalogSha256, 'remote catalog identity'),
    inventorySha256: digest(
      application.inventorySha256,
      'remote inventory identity'
    ),
    taskCount: positiveInteger(
      application.taskCount,
      'remote task count',
      65_536
    ),
  };
  if (
    normalizedApplication.applicationId !== applicationId ||
    normalizedApplication.platform !== catalog.platform ||
    normalizedApplication.candidateSha256 !==
      catalog.candidate.candidateSha256 ||
    normalizedApplication.catalogSha256 !== catalog.catalogSha256 ||
    normalizedApplication.inventorySha256 !== catalog.inventorySha256 ||
    normalizedApplication.taskCount !== catalog.tasks.length
  )
    throw new Error(
      `Remote ${expectedNodeId} application identity differs from the controller catalog`
    );
  return deepFreeze({ node, attestation, application: normalizedApplication });
}

function connectivityFailureCode(error) {
  const code = error?.code;
  return typeof code === 'string' && CONNECTIVITY_FAILURE_CODES.has(code)
    ? code
    : null;
}

function scheduleExpectations(schedule) {
  return deepFreeze({
    expectedApplicationId: schedule.applicationId,
    expectedProfileSha256: schedule.profileSha256,
    expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
    expectedScheduleSha256: schedule.scheduleSha256,
    expectedTestInventorySha256: schedule.testInventorySha256,
  });
}

function normalizeRemoteTaskReport(
  value,
  { requestId, nodeId, applicationId, catalog, taskId, nodeAttestationSha256 }
) {
  exactKeys(
    value,
    [
      'applicationId',
      'candidateSha256',
      'catalogSha256',
      'nodeId',
      'nodeAttestationSha256',
      'requestId',
      'result',
      'schema',
      'taskId',
    ],
    `task report from ${nodeId}`
  );
  if (value.schema !== DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA)
    throw new Error('Remote node task report uses an unsupported schema');
  if (
    identifier(value.requestId, 'remote task request ID') !== requestId ||
    identifier(value.nodeId, 'remote task node ID') !== nodeId ||
    identifier(value.applicationId, 'remote task application ID') !==
      applicationId ||
    digest(value.candidateSha256, 'remote task candidate identity') !==
      catalog.candidate.candidateSha256 ||
    digest(value.catalogSha256, 'remote task catalog identity') !==
      catalog.catalogSha256 ||
    digest(
      value.nodeAttestationSha256,
      'remote task node attestation identity'
    ) !== nodeAttestationSha256 ||
    digest(value.taskId, 'remote task identity') !== taskId
  )
    throw new Error('Remote node task report binding is invalid');
  return value.result;
}

function defaultRequestId({ kind }) {
  return `${kind}-${randomUUID()}`;
}

export function formatDistributedDependencyAdmission(admission) {
  const lines = [
    `Available Nodes: ${admission.availableNodes.length}`,
    `Usable Nodes: ${admission.usableNodes.length}`,
  ];
  for (const node of admission.excludedNodes) {
    lines.push(`Excluded Node ${node.nodeNumber} (${node.computerName}):`);
    for (const dependency of node.missing)
      lines.push(
        `  ${dependency.name}: required ${dependency.version}; installed not installed`
      );
    for (const dependency of node.mismatched)
      lines.push(
        `  ${dependency.name}: required ${dependency.requiredVersion}; installed ${dependency.actualVersion}`
      );
  }
  if (admission.excludedNodes.length)
    lines.push(
      'Continue using only usable nodes, or stop the test to install/update dependencies.'
    );
  return lines.join('\n');
}

export async function promptDistributedDependencyAdmission(
  admission,
  { input = process.stdin, output = process.stdout } = {}
) {
  if (!input?.isTTY || !output?.isTTY) return false;
  output.write(
    `${formatDistributedDependencyAdmission(admission)}\n\n` +
      '  1  Continue using only usable nodes\n' +
      '  2  Stop test to install/update dependencies\n\n'
  );
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question('Selection [1-2, default 2]: ');
    return answer.trim() === '1';
  } finally {
    prompt.close();
  }
}

function dependencyAdmission({ controllerConfig, online, requirements }) {
  const controllerOnline = online.find(
    ({ node }) => node.nodeId === DISTRIBUTED_CONTROLLER_NODE_ID
  );
  if (!controllerOnline)
    throw new Error('Dependency admission requires the controller node');
  const remoteOnline = online.filter(
    ({ node }) => node.nodeId !== DISTRIBUTED_CONTROLLER_NODE_ID
  );
  const nodeNumberById = new Map(
    controllerConfig.nodes.map((node) => [
      distributedLinuxNodeId(node.nodeNumber),
      node.nodeNumber,
    ])
  );
  const onlineNodeNumbers = remoteOnline.map(({ node }) =>
    nodeNumberById.get(node.nodeId)
  );
  const evaluated = evaluateNodeDependencyAvailability(
    controllerConfig,
    requirements,
    onlineNodeNumbers
  );
  const evaluationByNumber = new Map(
    evaluated.nodes.map((node) => [node.nodeNumber, node])
  );
  // The controller is already running the prepared application environment;
  // only remote nodes rely on enrolled dependency-availability reports.
  const controllerNode = {
    nodeId: controllerOnline.node.nodeId,
    nodeNumber: 'controller',
    computerName: controllerOnline.node.computerName,
  };
  const availableNodes = [
    controllerNode,
    ...remoteOnline.map(({ node }) => ({
      nodeId: node.nodeId,
      nodeNumber: nodeNumberById.get(node.nodeId),
      computerName: node.computerName,
    })),
  ];
  const usable = new Set(evaluated.eligibleNodeNumbers);
  const usableNodes = [
    controllerNode,
    ...availableNodes
      .filter(({ nodeId }) => nodeId !== DISTRIBUTED_CONTROLLER_NODE_ID)
      .filter((node) => usable.has(node.nodeNumber)),
  ];
  const excludedNodes = availableNodes
    .filter(({ nodeId }) => nodeId !== DISTRIBUTED_CONTROLLER_NODE_ID)
    .filter((node) => !usable.has(node.nodeNumber))
    .map((node) => ({
      ...node,
      missing: evaluationByNumber.get(node.nodeNumber).missing,
      mismatched: evaluationByNumber.get(node.nodeNumber).mismatched,
    }));
  return deepFreeze({
    requirements: evaluated.requirements,
    availableNodes,
    usableNodes,
    excludedNodes,
  });
}

function attachAdmissionEvidence(
  errorValue,
  { applicationAdmission, dependencyAdmission: dependencyEvidence }
) {
  const error =
    errorValue instanceof Error
      ? errorValue
      : new Error('Distributed Linux controller run failed', {
          cause: errorValue,
        });
  for (const [field, evidence] of [
    ['applicationAdmission', applicationAdmission],
    ['dependencyAdmission', dependencyEvidence],
  ]) {
    if (evidence === null) continue;
    try {
      error[field] = evidence;
    } catch {
      return Object.assign(new Error(error.message, { cause: error }), {
        applicationAdmission,
        ...(dependencyEvidence === null
          ? {}
          : { dependencyAdmission: dependencyEvidence }),
      });
    }
  }
  return error;
}

/**
 * Run one complete, immutable application catalog across the controller and
 * every reachable configured node that reports the exact application. An
 * authenticated node without that application remains available evidence but
 * is unusable for this run. Offline nodes are excluded only for recognized
 * connectivity failures; authentication, schema and identity drift fail.
 */
export async function runDistributedLinuxController({
  config,
  activeConfigMarkerPath,
  applicationId: applicationIdValue,
  applicationRoot: applicationRootValue,
  dependencyProfilePath,
  repositoryIdentitySha256: repositoryIdentityValue,
  timingProfile,
  policy,
  runId: runIdValue,
  signal,
  taskTimeoutMs: taskTimeoutValue = DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
  profileDetector = detectLinuxHostProfile,
  catalogDiscovery = discoverDistributedNativeCatalog,
  requestFactory = createDistributedNativeTaskRequest,
  localTaskExecutor = executeDistributedNativeTask,
  resultVerifier = verifyDistributedNativeTaskResult,
  activeConfigResolver = resolveActiveLinuxConfig,
  transportRequester = requestDistributedNodeJson,
  scheduleFactory = createControllerAdaptiveSchedule,
  scheduleExecutor = executeDistributedShardSchedule,
  requestIdFactory = defaultRequestId,
  dependencyProfileReader = readApplicationDependencyProfileFile,
  confirmDependencyExclusions = promptDistributedDependencyAdmission,
} = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Linux controller runner signal must be an AbortSignal');
  signal?.throwIfAborted();
  for (const [dependency, label] of [
    [profileDetector, 'profile detector'],
    [catalogDiscovery, 'catalog discovery'],
    [requestFactory, 'task request factory'],
    [localTaskExecutor, 'local task executor'],
    [resultVerifier, 'task result verifier'],
    [activeConfigResolver, 'active config resolver'],
    [transportRequester, 'node transport requester'],
    [scheduleFactory, 'adaptive schedule factory'],
    [scheduleExecutor, 'shard schedule executor'],
    [requestIdFactory, 'request ID factory'],
    [dependencyProfileReader, 'dependency profile reader'],
    [confirmDependencyExclusions, 'dependency exclusion confirmation'],
  ])
    if (typeof dependency !== 'function')
      throw new Error(`Linux controller runner requires a ${label}`);

  const { applicationId, applicationRoot } = normalizeApplication(
    applicationIdValue,
    applicationRootValue
  );
  const repositoryIdentitySha256 = digest(
    repositoryIdentityValue,
    'controller repository identity'
  );
  const runId = identifier(runIdValue, 'distributed controller run ID');
  const timeoutBudget =
    resolveDistributedLinuxTaskTimeoutBudget(taskTimeoutValue);
  const taskTimeoutMs = timeoutBudget.taskTimeoutMs;
  const controllerConfig = await loadConfig({
    config,
    activeConfigMarkerPath,
    activeConfigResolver,
  });
  const dependencyRequirements =
    dependencyProfilePath === undefined
      ? null
      : deepFreeze(await dependencyProfileReader(dependencyProfilePath));
  const profile = normalizeProfile(await profileDetector(), controllerConfig);
  const discoveredCatalog = await catalogDiscovery(applicationRoot, {
    applicationId,
  });
  let catalog;
  try {
    catalog = structuredClone(discoveredCatalog);
  } catch (error) {
    throw new Error('Controller catalog must be structured-cloneable', {
      cause: error,
    });
  }
  if (catalog?.applicationId !== applicationId)
    throw new Error('Controller catalog belongs to another application');
  const firstTaskId = catalog?.tasks?.[0]?.taskId;
  await requestFactory(catalog, firstTaskId);
  catalog = deepFreeze(catalog);
  signal?.throwIfAborted();

  const issuedRequestIds = new Set();
  const issueRequestId = (facts) => {
    const requestId = identifier(
      requestIdFactory(deepFreeze({ ...facts })),
      `${facts.kind} request ID`
    );
    if (issuedRequestIds.has(requestId))
      throw new Error(`Duplicate distributed request ID: ${requestId}`);
    issuedRequestIds.add(requestId);
    return requestId;
  };
  const transportControllerId = distributedLinuxControllerId({
    ipAddress: controllerConfig.global.ipAddress,
    port: controllerConfig.global.port,
  });
  const localNode = deepFreeze({
    nodeId: DISTRIBUTED_CONTROLLER_NODE_ID,
    computerName: controllerConfig.global.computerName,
    ipAddress: controllerConfig.global.ipAddress,
    port: controllerConfig.global.port,
    cpuName: profile.cpuName,
    availableThreads: profile.availableThreads,
  });
  const online = [
    {
      node: localNode,
      bridgeProbe: createBridgeProbe({ ...localNode, catalog }),
      evidence: applicationEvidence(localNode, catalog),
    },
  ];
  const applicationAvailableNodes = [
    applicationAdmissionNode(localNode, 'controller'),
  ];
  const applicationUsableNodes = [applicationAvailableNodes[0]];
  const applicationExcludedNodes = [];

  const probePromises = controllerConfig.nodes.map(async (configuredNode) => {
    const nodeId = distributedLinuxNodeId(configuredNode.nodeNumber);
    const requestId = issueRequestId({ kind: 'probe', nodeId });
    try {
      const response = await transportRequester({
        address: configuredNode.ipAddress,
        port: configuredNode.port,
        sharedKey: controllerConfig.sharedAuthenticationKey,
        controllerId: transportControllerId,
        nodeId,
        kind: DISTRIBUTED_NODE_PROBE_KIND,
        requestId,
        signal,
        body: {
          schema: DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA,
          requestId,
          applicationIds: [applicationId],
        },
      });
      const normalized = normalizeRemoteProbeReport(response?.body, {
        requestId,
        configuredNode,
        applicationId,
        catalog,
      });
      return {
        status: 'online',
        nodeId,
        configuredNode,
        normalized,
      };
    } catch (error) {
      const failureCode = connectivityFailureCode(error);
      if (failureCode === null) throw error;
      return {
        status: 'offline',
        evidence: deepFreeze({
          nodeId,
          computerName: configuredNode.computerName,
          ipAddress: configuredNode.ipAddress,
          port: configuredNode.port,
          failureCode,
        }),
      };
    }
  });
  const probeSettlements = await Promise.allSettled(probePromises);
  const rejectedProbe = probeSettlements.find(
    (settlement) => settlement.status === 'rejected'
  );
  if (rejectedProbe) throw rejectedProbe.reason;
  const offlineNodes = [];
  const remoteNodes = new Map();
  for (const settlement of probeSettlements) {
    const result = settlement.value;
    if (result.status === 'offline') {
      offlineNodes.push(result.evidence);
      continue;
    }
    const { configuredNode, normalized, nodeId } = result;
    const node = normalized.node;
    const admissionNode = applicationAdmissionNode(
      node,
      configuredNode.nodeNumber
    );
    applicationAvailableNodes.push(admissionNode);
    if (normalized.application === null) {
      applicationExcludedNodes.push(normalized.exclusion);
      continue;
    }
    applicationUsableNodes.push(admissionNode);
    const bridgeProbe = createBridgeProbe({ ...node, catalog });
    const evidence = applicationEvidence(node, catalog, normalized.attestation);
    online.push({ node, bridgeProbe, evidence });
    remoteNodes.set(
      nodeId,
      deepFreeze({
        configuredNode,
        node,
        nodeAttestationSha256: normalized.attestation.attestationSha256,
      })
    );
  }

  const applicationAdmissionResult = deepFreeze({
    schema: DISTRIBUTED_LINUX_APPLICATION_ADMISSION_SCHEMA,
    applicationId,
    availableNodes: applicationAvailableNodes.toSorted((left, right) =>
      compareText(left.nodeId, right.nodeId)
    ),
    usableNodes: applicationUsableNodes.toSorted((left, right) =>
      compareText(left.nodeId, right.nodeId)
    ),
    excludedNodes: applicationExcludedNodes.toSorted((left, right) =>
      compareText(left.nodeId, right.nodeId)
    ),
  });

  let dependencyAdmissionResult = null;
  try {
    let admittedOnline = online;
    if (dependencyRequirements !== null) {
      dependencyAdmissionResult = dependencyAdmission({
        controllerConfig,
        online,
        requirements: dependencyRequirements,
      });
      const summary = formatDistributedDependencyAdmission(
        dependencyAdmissionResult
      );
      if (dependencyAdmissionResult.excludedNodes.length > 0) {
        const continueRun = await confirmDependencyExclusions(
          dependencyAdmissionResult
        );
        if (continueRun !== true)
          throw new Error(
            `Test stopped so node dependencies can be installed or updated.\n${summary}`
          );
      }
      const usableNodeIds = new Set(
        dependencyAdmissionResult.usableNodes.map((node) => node.nodeId)
      );
      admittedOnline = online.filter(({ node }) =>
        usableNodeIds.has(node.nodeId)
      );
      for (const nodeId of remoteNodes.keys())
        if (!usableNodeIds.has(nodeId)) remoteNodes.delete(nodeId);
    }

    const schedule = await scheduleFactory({
      catalog,
      controllerConfig,
      onlineNodeProbes: admittedOnline.map(({ bridgeProbe }) => bridgeProbe),
      repositoryIdentitySha256,
      timingProfile,
      ...(policy === undefined ? {} : { policy }),
    });
    const expectations = scheduleExpectations(schedule);
    const allowedTaskIds = catalog.tasks.map((task) => task.taskId);

    const dispatch = async ({ shard, nodeId, signal: shardSignal }) => {
      const request = await requestFactory(catalog, shard.id);
      let unverifiedResult;
      if (nodeId === DISTRIBUTED_CONTROLLER_NODE_ID) {
        unverifiedResult = await localTaskExecutor({
          root: applicationRoot,
          applicationId,
          allowedTaskIds,
          expectedCandidate: catalog.candidate,
          request,
          signal: shardSignal,
          timeoutMs: taskTimeoutMs,
        });
      } else {
        const remote = remoteNodes.get(nodeId);
        if (!remote)
          throw new Error(`Schedule assigned a shard to unavailable ${nodeId}`);
        const requestId = issueRequestId({
          kind: 'task',
          nodeId,
          shardId: shard.id,
        });
        const response = await transportRequester({
          address: remote.configuredNode.ipAddress,
          port: remote.configuredNode.port,
          sharedKey: controllerConfig.sharedAuthenticationKey,
          controllerId: transportControllerId,
          nodeId,
          kind: DISTRIBUTED_NODE_TASK_KIND,
          requestId,
          signal: shardSignal,
          timeoutMs: timeoutBudget.requestTimeoutMs,
          body: {
            schema: DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA,
            requestId,
            applicationId,
            candidateSha256: catalog.candidate.candidateSha256,
            catalogSha256: catalog.catalogSha256,
            request,
          },
        });
        unverifiedResult = normalizeRemoteTaskReport(response?.body, {
          requestId,
          nodeId,
          applicationId,
          catalog,
          taskId: shard.id,
          nodeAttestationSha256: remote.nodeAttestationSha256,
        });
      }
      const result = await resultVerifier(unverifiedResult, {
        catalog,
        expectedCatalogSha256: catalog.catalogSha256,
        taskId: shard.id,
      });
      return deepFreeze({ shardId: shard.id, result });
    };
    const runReport = await scheduleExecutor(schedule, {
      expectations,
      dispatch,
      runId,
      signal,
    });

    return deepFreeze({
      catalog,
      schedule,
      runReport,
      onlineNodes: admittedOnline
        .map(({ evidence }) => evidence)
        .toSorted((left, right) => compareText(left.nodeId, right.nodeId)),
      offlineNodes: offlineNodes.toSorted((left, right) =>
        compareText(left.nodeId, right.nodeId)
      ),
      applicationAdmission: applicationAdmissionResult,
      ...(dependencyAdmissionResult === null
        ? {}
        : { dependencyAdmission: dependencyAdmissionResult }),
    });
  } catch (error) {
    throw attachAdmissionEvidence(error, {
      applicationAdmission: applicationAdmissionResult,
      dependencyAdmission: dependencyAdmissionResult,
    });
  }
}
