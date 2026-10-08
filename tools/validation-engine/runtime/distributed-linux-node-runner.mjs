// Copyright (c) snapetech and SeerrNG contributors.
// Linux Mode 3 node runner bound to enrolled configuration and local source.
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { createNodeConfig } from './distributed-linux-config.mjs';
import { detectLinuxHostProfile } from './distributed-linux-host-profile.mjs';
import { resolveActiveLinuxConfig } from './distributed-linux-management.mjs';
import {
  createDistributedLinuxNodeAttestation,
  verifyDistributedLinuxNodeAttestation,
} from './distributed-linux-node-attestation.mjs';
import {
  createDistributedNativeTaskRequest,
  DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
  discoverDistributedNativeCatalog,
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_REQUEST_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
  executeDistributedNativeTask,
  MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS,
  MAX_DISTRIBUTED_NATIVE_TASKS,
  verifyDistributedNativeTaskResult,
} from './distributed-native-adapter.mjs';
import {
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
  MAX_DISTRIBUTED_NODE_TIMEOUT_MS,
  startDistributedNodeTransportServer,
} from './distributed-node-transport.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA =
  'seerrng-distributed-linux-node-probe-request/v1';
export const DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA =
  'seerrng-distributed-linux-node-probe-report/v3';
export const DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA =
  'seerrng-distributed-linux-node-task-request/v1';
export const DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA =
  'seerrng-distributed-linux-node-task-report/v2';
export const MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS = 64;
// Native process timeout cleanup can consume six seconds on Linux; keep the
// enclosing handler alive long enough to verify and seal the final receipt.
export const DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS = 10_000;
export const DISTRIBUTED_LINUX_TASK_RESPONSE_OVERHEAD_MS = 5_000;

const HASH64 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NODE_NUMBER = /^(?:0[1-9]|[1-9][0-9])$/;
const MAX_APPLICATION_ROOT_BYTES = 4096;
const MAX_AVAILABLE_THREADS = 65_536;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
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

function boundedInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  return value;
}

export function resolveDistributedLinuxTaskTimeoutBudget(
  value = DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS
) {
  const taskTimeoutMs = boundedInteger(
    value,
    'Linux distributed native task timeout',
    MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS
  );
  const handlerTimeoutMs =
    taskTimeoutMs + DISTRIBUTED_LINUX_TASK_HANDLER_OVERHEAD_MS;
  const requestTimeoutMs =
    handlerTimeoutMs + DISTRIBUTED_LINUX_TASK_RESPONSE_OVERHEAD_MS;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs > MAX_DISTRIBUTED_NODE_TIMEOUT_MS
  )
    throw new Error(
      'Linux distributed task timeout budget exceeds the node transport limit'
    );
  return Object.freeze({ taskTimeoutMs, handlerTimeoutMs, requestTimeoutMs });
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

function gitObject(value, label) {
  if (typeof value !== 'string' || !GIT_OBJECT.test(value))
    throw new Error(`${label} must be a Git object ID`);
  return value;
}

function sameJson(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function normalizeTaskFiles(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISTRIBUTED_NATIVE_TASKS
  )
    throw new Error(`${label} must be a bounded nonempty array`);
  const files = value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      entry.length > 1024 ||
      entry.trim() !== entry ||
      entry.includes('\\') ||
      entry.startsWith('/') ||
      entry
        .split('/')
        .some((segment) => !segment || segment === '.' || segment === '..')
    )
      throw new Error(`${label} contains an unsafe path`);
    return entry;
  });
  if (new Set(files).size !== files.length)
    throw new Error(`${label} contains duplicate paths`);
  if (
    files.some((entry, index) => entry !== files.toSorted(compareText)[index])
  )
    throw new Error(`${label} must use canonical path order`);
  return files;
}

function normalizeCandidate(value, label) {
  exactKeys(
    value,
    [
      'candidateSha256',
      'commitSha',
      'lockfilePath',
      'lockfileSha256',
      'schema',
      'treeSha',
    ],
    label
  );
  if (value.schema !== DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA)
    throw new Error(`${label} uses an unsupported schema`);
  const core = {
    schema: value.schema,
    commitSha: gitObject(value.commitSha, `${label} commit`),
    treeSha: gitObject(value.treeSha, `${label} tree`),
    lockfilePath:
      value.lockfilePath === 'pnpm-lock.yaml'
        ? value.lockfilePath
        : (() => {
            throw new Error(`${label} uses another lockfile`);
          })(),
    lockfileSha256: digest(value.lockfileSha256, `${label} lockfile identity`),
  };
  const candidateSha256 = digest(
    value.candidateSha256,
    `${label} candidate identity`
  );
  if (candidateSha256 !== canonicalJsonSha256(core))
    throw new Error(`${label} candidate identity is invalid`);
  return { ...core, candidateSha256 };
}

function normalizeCatalog(value, expectedApplicationId, label) {
  exactKeys(
    value,
    [
      'applicationId',
      'candidate',
      'catalogSha256',
      'inventorySha256',
      'platform',
      'schema',
      'tasks',
    ],
    label
  );
  if (value.schema !== DISTRIBUTED_NATIVE_CATALOG_SCHEMA)
    throw new Error(`${label} uses an unsupported schema`);
  const applicationId = identifier(
    value.applicationId,
    `${label} application ID`
  );
  if (applicationId !== expectedApplicationId)
    throw new Error(`${label} belongs to another application`);
  const candidate = normalizeCandidate(value.candidate, `${label} candidate`);
  const platform = identifier(value.platform, `${label} platform`);
  const inventorySha256 = digest(
    value.inventorySha256,
    `${label} inventory identity`
  );
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    value.tasks.length > MAX_DISTRIBUTED_NATIVE_TASKS
  )
    throw new Error(`${label} tasks must be a bounded nonempty array`);
  const tasks = value.tasks.map((task, index) => {
    const taskLabel = `${label} task ${index}`;
    exactKeys(task, ['adapterId', 'files', 'schema', 'taskId'], taskLabel);
    if (task.schema !== DISTRIBUTED_NATIVE_TASK_SCHEMA)
      throw new Error(`${taskLabel} uses an unsupported schema`);
    const adapterId = identifier(task.adapterId, `${taskLabel} adapter ID`);
    const files = normalizeTaskFiles(task.files, `${taskLabel} files`);
    const taskId = digest(task.taskId, `${taskLabel} identity`);
    if (taskId !== distributedNativeTaskId({ applicationId, adapterId, files }))
      throw new Error(`${taskLabel} identity is invalid`);
    return { schema: task.schema, taskId, adapterId, files };
  });
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length)
    throw new Error(`${label} contains duplicate task identities`);
  if (
    tasks.some(
      (task, index) =>
        task.taskId !==
        tasks.toSorted((left, right) => compareText(left.taskId, right.taskId))[
          index
        ].taskId
    )
  )
    throw new Error(`${label} tasks must use canonical identity order`);
  const taskFiles = tasks.flatMap((task) => task.files);
  if (new Set(taskFiles).size !== taskFiles.length)
    throw new Error(`${label} contains duplicate task paths`);
  const core = {
    schema: value.schema,
    applicationId,
    platform,
    candidate,
    inventorySha256,
    tasks,
  };
  const catalogSha256 = digest(
    value.catalogSha256,
    `${label} catalog identity`
  );
  if (catalogSha256 !== canonicalJsonSha256(core))
    throw new Error(`${label} catalog identity is invalid`);
  return deepFreeze({ ...core, catalogSha256 });
}

function normalizeApplications(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS
  )
    throw new Error(
      `Linux node applications must contain 1 through ${MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS} bindings`
    );
  const applications = value.map((binding, index) => {
    exactKeys(
      binding,
      ['applicationId', 'root'],
      `Linux node application binding ${index}`
    );
    const applicationId = identifier(
      binding.applicationId,
      `Linux node application binding ${index} ID`
    );
    const root = exactText(
      binding.root,
      `Linux node application ${applicationId} root`,
      MAX_APPLICATION_ROOT_BYTES
    );
    if (!isAbsolute(root) || resolve(root) !== root)
      throw new Error(
        `Linux node application ${applicationId} root must be an absolute normalized path`
      );
    return { applicationId, root };
  });
  if (
    new Set(applications.map(({ applicationId }) => applicationId)).size !==
    applications.length
  )
    throw new Error('Linux node application bindings repeat an ID');
  if (
    new Set(applications.map(({ root }) => root)).size !== applications.length
  )
    throw new Error('Linux node application bindings repeat a root');
  return applications.toSorted((left, right) =>
    compareText(left.applicationId, right.applicationId)
  );
}

export function parseDistributedLinuxNodeApplicationBindings(values) {
  if (!Array.isArray(values))
    throw new Error('Linux node application bindings must be an array');
  return values.map((value) => {
    if (typeof value !== 'string')
      throw new Error('Distributed application binding must be text');
    const separator = value.indexOf('=');
    if (separator < 1 || separator === value.length - 1)
      throw new Error('Distributed application binding must be ID=ROOT');
    const applicationId = identifier(
      value.slice(0, separator),
      'application ID'
    );
    const root = value.slice(separator + 1);
    if (!isAbsolute(root) || resolve(root) !== root)
      throw new Error(
        `Distributed application root must be absolute: ${applicationId}`
      );
    return { applicationId, root };
  });
}

function normalizeProfile(value, enrolled) {
  exactKeys(value, ['availableThreads', 'cpuName'], 'Linux node host profile');
  const profile = {
    cpuName: exactText(value.cpuName, 'Linux node CPU name'),
    availableThreads: boundedInteger(
      value.availableThreads,
      'Linux node available threads',
      MAX_AVAILABLE_THREADS
    ),
  };
  if (
    profile.cpuName !== enrolled.node.cpuName ||
    profile.availableThreads !== enrolled.node.availableThreads
  )
    throw new Error(
      'Linux node host profile differs from its enrolled identity'
    );
  return deepFreeze(profile);
}

function normalizeEnrolledConfig(value) {
  const config = createNodeConfig(value);
  if (config.sharedAuthenticationKey === null)
    throw new Error('Linux node configuration has not completed enrollment');
  return config;
}

function normalizeActiveConfig(value) {
  exactKeys(value, ['config', 'configPath', 'role'], 'active Linux config');
  if (value.role !== 'node')
    throw new Error('Active Linux config is not a node configuration');
  exactText(
    value.configPath,
    'active Linux config path',
    MAX_APPLICATION_ROOT_BYTES
  );
  return normalizeEnrolledConfig(value.config);
}

function controllerIdentity(controller) {
  exactKeys(
    controller,
    ['ipAddress', 'port'],
    'Linux node controller reference'
  );
  const seed = `${controller.ipAddress}\0${controller.port}`;
  return `controller-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

export function distributedLinuxNodeId(nodeNumber) {
  if (typeof nodeNumber !== 'string' || !NODE_NUMBER.test(nodeNumber))
    throw new Error('Linux node number must use two-digit format');
  return `node-${nodeNumber}`;
}

export function distributedLinuxControllerId(controller) {
  return controllerIdentity(controller);
}

function applicationSummary(catalog) {
  return deepFreeze({
    applicationId: catalog.applicationId,
    status: 'available',
    platform: catalog.platform,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    inventorySha256: catalog.inventorySha256,
    taskCount: catalog.tasks.length,
  });
}

function unavailableApplicationSummary(applicationId) {
  return deepFreeze({
    applicationId,
    status: 'unavailable',
    reason: 'application-not-configured',
  });
}

function normalizeRequestApplicationIds(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISTRIBUTED_LINUX_NODE_APPLICATIONS
  )
    throw new Error(
      'Linux node probe requires a bounded nonempty application list'
    );
  const ids = value.map((entry) => identifier(entry, 'probe application ID'));
  if (new Set(ids).size !== ids.length)
    throw new Error('Linux node probe application IDs must be unique');
  if (ids.some((entry, index) => entry !== ids.toSorted(compareText)[index]))
    throw new Error(
      'Linux node probe application IDs must use canonical order'
    );
  return ids;
}

function normalizeNativeRequest(value) {
  exactKeys(
    value,
    ['candidateSha256', 'files', 'schema', 'taskId'],
    'Linux node native task request'
  );
  if (value.schema !== DISTRIBUTED_NATIVE_TASK_REQUEST_SCHEMA)
    throw new Error(
      'Linux node native task request uses an unsupported schema'
    );
  return {
    schema: value.schema,
    candidateSha256: digest(
      value.candidateSha256,
      'Linux node native task request candidate identity'
    ),
    taskId: digest(value.taskId, 'Linux node native task request identity'),
    files: normalizeTaskFiles(
      value.files,
      'Linux node native task request files'
    ),
  };
}

function abortError() {
  return Object.assign(new Error('Linux node runner was aborted'), {
    name: 'AbortError',
    code: 'ERR_DISTRIBUTED_LINUX_NODE_ABORTED',
  });
}

function combineSignals(left, right) {
  if (left.aborted || right.aborted) return AbortSignal.abort(abortError());
  return AbortSignal.any([left, right]);
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
      'Linux node runner requires exactly one enrolled config or active config marker'
    );
  if (direct) return normalizeEnrolledConfig(config);
  if (typeof activeConfigResolver !== 'function')
    throw new Error('Linux node runner requires an active config resolver');
  const active = await activeConfigResolver(activeConfigMarkerPath, {
    expectedRole: 'node',
  });
  return normalizeActiveConfig(active);
}

export async function startDistributedLinuxNodeRunner({
  config,
  activeConfigMarkerPath,
  applications: applicationBindings,
  signal,
  taskTimeoutMs,
  profileDetector = detectLinuxHostProfile,
  catalogDiscovery = discoverDistributedNativeCatalog,
  requestFactory = createDistributedNativeTaskRequest,
  taskExecutor = executeDistributedNativeTask,
  withTaskIsolation,
  resultVerifier = verifyDistributedNativeTaskResult,
  activeConfigResolver = resolveActiveLinuxConfig,
  attestationFactory = createDistributedLinuxNodeAttestation,
  transportStarter = startDistributedNodeTransportServer,
  transportOptions = {},
} = {}) {
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Linux node runner signal must be an AbortSignal');
  signal?.throwIfAborted();
  for (const [dependency, label] of [
    [profileDetector, 'profile detector'],
    [catalogDiscovery, 'catalog discovery'],
    [requestFactory, 'task request factory'],
    [taskExecutor, 'task executor'],
    [resultVerifier, 'task result verifier'],
    [attestationFactory, 'runtime attestation factory'],
    [transportStarter, 'transport starter'],
  ])
    if (typeof dependency !== 'function')
      throw new Error(`Linux node runner requires a ${label}`);
  if (
    withTaskIsolation !== undefined &&
    typeof withTaskIsolation !== 'function'
  )
    throw new Error('Linux node task isolation must be a native callback');
  plainObject(transportOptions, 'Linux node transport options');
  for (const forbidden of [
    'allowedKinds',
    'controllerId',
    'handler',
    'handlerTimeoutMs',
    'host',
    'nodeId',
    'port',
    'sharedKey',
  ])
    if (Object.hasOwn(transportOptions, forbidden))
      throw new Error(
        `Linux node transport option ${forbidden} is runtime-owned`
      );

  const timeoutBudget = resolveDistributedLinuxTaskTimeoutBudget(taskTimeoutMs);

  const enrolled = await loadConfig({
    config,
    activeConfigMarkerPath,
    activeConfigResolver,
  });
  const profile = normalizeProfile(await profileDetector(), enrolled);
  const attestation = verifyDistributedLinuxNodeAttestation(
    await attestationFactory(enrolled)
  );
  const bindings = normalizeApplications(applicationBindings);
  const applications = new Map();
  for (const binding of bindings) {
    signal?.throwIfAborted();
    const catalog = normalizeCatalog(
      await catalogDiscovery(binding.root, {
        applicationId: binding.applicationId,
      }),
      binding.applicationId,
      `Linux node application ${binding.applicationId} catalog`
    );
    applications.set(
      binding.applicationId,
      deepFreeze({ ...binding, catalog })
    );
  }
  signal?.throwIfAborted();

  const nodeId = distributedLinuxNodeId(enrolled.node.nodeNumber);
  const controllerId = controllerIdentity(enrolled.controller);
  const shutdown = new AbortController();
  const node = deepFreeze({
    nodeId,
    nodeNumber: enrolled.node.nodeNumber,
    computerName: enrolled.node.computerName,
    ipAddress: enrolled.node.ipAddress,
    port: enrolled.node.port,
    cpuName: profile.cpuName,
    availableThreads: profile.availableThreads,
  });

  const handler = async (message) => {
    if (shutdown.signal.aborted) throw abortError();
    if (message.kind === DISTRIBUTED_NODE_PROBE_KIND) {
      exactKeys(
        message.body,
        ['applicationIds', 'requestId', 'schema'],
        'Linux node probe request'
      );
      if (message.body.schema !== DISTRIBUTED_LINUX_NODE_PROBE_REQUEST_SCHEMA)
        throw new Error('Linux node probe request uses an unsupported schema');
      const requestId = identifier(
        message.body.requestId,
        'Linux node probe request ID'
      );
      if (requestId !== message.requestId)
        throw new Error('Linux node probe request binding is invalid');
      const applicationIds = normalizeRequestApplicationIds(
        message.body.applicationIds
      );
      return deepFreeze({
        schema: DISTRIBUTED_LINUX_NODE_PROBE_REPORT_SCHEMA,
        requestId,
        node,
        attestation,
        applications: applicationIds.map((applicationId) => {
          const application = applications.get(applicationId);
          return application
            ? applicationSummary(application.catalog)
            : unavailableApplicationSummary(applicationId);
        }),
      });
    }

    if (message.kind !== DISTRIBUTED_NODE_TASK_KIND)
      throw new Error('Linux node runner received an unsupported request kind');
    exactKeys(
      message.body,
      [
        'applicationId',
        'candidateSha256',
        'catalogSha256',
        'request',
        'requestId',
        'schema',
      ],
      'Linux node task request'
    );
    if (message.body.schema !== DISTRIBUTED_LINUX_NODE_TASK_REQUEST_SCHEMA)
      throw new Error('Linux node task request uses an unsupported schema');
    const requestId = identifier(
      message.body.requestId,
      'Linux node task request ID'
    );
    if (requestId !== message.requestId)
      throw new Error('Linux node task request binding is invalid');
    const applicationId = identifier(
      message.body.applicationId,
      'Linux node task application ID'
    );
    const application = applications.get(applicationId);
    if (!application)
      throw new Error(`Linux node does not bind application ${applicationId}`);
    const request = normalizeNativeRequest(message.body.request);
    const advertisedTask = application.catalog.tasks.find(
      (task) => task.taskId === request.taskId
    );
    if (!advertisedTask || !sameJson(advertisedTask.files, request.files))
      throw new Error('Linux node task is outside its locally derived catalog');

    const candidateSha256 = digest(
      message.body.candidateSha256,
      'Linux node task candidate identity'
    );
    const catalogSha256 = digest(
      message.body.catalogSha256,
      'Linux node task catalog identity'
    );
    if (
      candidateSha256 !== application.catalog.candidate.candidateSha256 ||
      catalogSha256 !== application.catalog.catalogSha256 ||
      request.candidateSha256 !== candidateSha256
    )
      throw new Error(
        'Linux node task candidate or catalog binding is invalid'
      );
    const expectedRequest = await requestFactory(
      application.catalog,
      request.taskId
    );
    if (!sameJson(request, expectedRequest))
      throw new Error('Linux node task request differs from its local catalog');

    const executionSignal = combineSignals(message.signal, shutdown.signal);
    const allowedTaskIds = application.catalog.tasks.map((task) => task.taskId);
    let operationCalls = 0;
    const operation = () => {
      operationCalls += 1;
      if (operationCalls !== 1)
        throw new Error(
          'Task isolation invoked its native executor more than once'
        );
      return taskExecutor({
        root: application.root,
        applicationId,
        allowedTaskIds,
        expectedCandidate: application.catalog.candidate,
        request: expectedRequest,
        signal: executionSignal,
        timeoutMs: timeoutBudget.taskTimeoutMs,
      });
    };
    const isolationContext = Object.freeze({
      application: Object.freeze({
        applicationId,
        root: application.root,
      }),
      task: advertisedTask,
      candidate: application.catalog.candidate,
      signal: executionSignal,
    });
    // The reviewed host callback owns the child-isolation guarantee. Keeping
    // this hook around only the executor leaves transport and validation in the
    // long-lived node process without claiming that an arbitrary callback is
    // itself proof of isolation.
    const result = withTaskIsolation
      ? await withTaskIsolation(operation, isolationContext)
      : await operation();
    if (operationCalls !== 1)
      throw new Error('Task isolation did not invoke its native executor');
    const verified = await resultVerifier(result, {
      catalog: application.catalog,
      expectedCatalogSha256: application.catalog.catalogSha256,
      taskId: request.taskId,
    });
    return deepFreeze({
      schema: DISTRIBUTED_LINUX_NODE_TASK_REPORT_SCHEMA,
      requestId,
      nodeId,
      applicationId,
      candidateSha256,
      catalogSha256,
      nodeAttestationSha256: attestation.attestationSha256,
      taskId: request.taskId,
      result: verified,
    });
  };

  let service;
  try {
    service = await transportStarter({
      ...transportOptions,
      sharedKey: enrolled.sharedAuthenticationKey,
      controllerId,
      nodeId,
      allowedKinds: [DISTRIBUTED_NODE_PROBE_KIND, DISTRIBUTED_NODE_TASK_KIND],
      handler,
      handlerTimeoutMs: timeoutBudget.handlerTimeoutMs,
      host: enrolled.node.ipAddress,
      port: enrolled.node.port,
    });
  } catch (error) {
    shutdown.abort(abortError());
    throw error;
  }

  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    shutdown.abort(abortError());
    signal?.removeEventListener('abort', closeOnAbort);
    closePromise = Promise.resolve().then(() => service.close());
    return closePromise;
  };
  const closeOnAbort = () => void close().catch(() => {});
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  if (signal?.aborted) {
    await close();
    throw abortError();
  }

  return Object.freeze({
    controllerId,
    nodeId,
    host: service.host,
    port: service.port,
    route: service.route,
    profile,
    node,
    attestation,
    applications: deepFreeze(
      [...applications.values()].map(({ catalog }) =>
        applicationSummary(catalog)
      )
    ),
    close,
  });
}
