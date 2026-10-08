// Copyright (c) snapetech and SeerrNG contributors.
// Pure controller-config-to-adaptive-schedule bridge primitives.
import { isIP } from 'node:net';

import { createDistributedAdaptiveSchedule } from './distributed-adaptive-scheduler.mjs';
import {
  createControllerConfig,
  evaluateThreadExpression,
} from './distributed-linux-config.mjs';
import { createDistributedNativeTaskRequest } from './distributed-native-adapter.mjs';

export const DISTRIBUTED_NODE_PROBE_SCHEMA =
  'seerrng-distributed-node-probe/v1';
export const DISTRIBUTED_CONTROLLER_NODE_ID = 'controller';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REMOTE_NODE_ID_PATTERN = /^node-(\d{2})$/u;
const MAX_NODE_PROBES = 100;
const REQUIRED_INPUT_KEYS = Object.freeze([
  'catalog',
  'controllerConfig',
  'onlineNodeProbes',
  'repositoryIdentitySha256',
  'timingProfile',
]);
const OPTIONAL_INPUT_KEYS = Object.freeze(['policy']);
const REQUIRED_PROBE_KEYS = Object.freeze([
  'adapterIds',
  'availableThreads',
  'candidateSha256',
  'catalogSha256',
  'cpuName',
  'environment',
  'ipAddress',
  'nodeId',
  'port',
  'schema',
]);

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, requiredKeys, optionalKeys, label) {
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required field ${key}`);
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}`);
    }
  }
}

function normalizeText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new TypeError(`${label} must not include surrounding whitespace`);
  }
  return value;
}

function normalizeSha256(value, label) {
  const normalized = normalizeText(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return normalized;
}

function normalizePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizePort(value, label) {
  const normalized = normalizePositiveInteger(value, label);
  if (normalized > 65_535) {
    throw new RangeError(`${label} must be at most 65535`);
  }
  return normalized;
}

function normalizeIpAddress(value, label) {
  const normalized = normalizeText(value, label);
  if (isIP(normalized) === 0) {
    throw new TypeError(`${label} must be a valid IP address`);
  }
  return normalized;
}

function normalizeAdapterIds(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }

  const normalized = value.map((entry, index) =>
    normalizeText(entry, `${label}[${index}]`)
  );
  const canonical = [...new Set(normalized)].sort(compareText);

  if (
    canonical.length !== normalized.length ||
    canonical.some((entry, index) => entry !== normalized[index])
  ) {
    throw new TypeError(`${label} must be unique and canonically sorted`);
  }

  return canonical;
}

function normalizeProbe(value, index) {
  const label = `onlineNodeProbes[${index}]`;
  assertPlainObject(value, label);
  assertExactKeys(value, REQUIRED_PROBE_KEYS, [], label);

  if (value.schema !== DISTRIBUTED_NODE_PROBE_SCHEMA) {
    throw new TypeError(`${label}.schema is unsupported`);
  }

  const nodeId = normalizeText(value.nodeId, `${label}.nodeId`);
  if (
    nodeId !== DISTRIBUTED_CONTROLLER_NODE_ID &&
    !REMOTE_NODE_ID_PATTERN.test(nodeId)
  ) {
    throw new TypeError(
      `${label}.nodeId must be controller or canonical node-## form`
    );
  }

  return {
    adapterIds: normalizeAdapterIds(value.adapterIds, `${label}.adapterIds`),
    availableThreads: normalizePositiveInteger(
      value.availableThreads,
      `${label}.availableThreads`
    ),
    candidateSha256: normalizeSha256(
      value.candidateSha256,
      `${label}.candidateSha256`
    ),
    catalogSha256: normalizeSha256(
      value.catalogSha256,
      `${label}.catalogSha256`
    ),
    cpuName: normalizeText(value.cpuName, `${label}.cpuName`),
    environment: normalizeText(value.environment, `${label}.environment`),
    ipAddress: normalizeIpAddress(value.ipAddress, `${label}.ipAddress`),
    nodeId,
    port: normalizePort(value.port, `${label}.port`),
  };
}

function normalizeOnlineNodeProbes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('onlineNodeProbes must be a non-empty array');
  }
  if (value.length > MAX_NODE_PROBES) {
    throw new RangeError(
      `onlineNodeProbes cannot contain more than ${MAX_NODE_PROBES} entries`
    );
  }

  const probes = value.map((entry, index) => normalizeProbe(entry, index));
  const nodeIds = new Set();
  const addresses = new Set();
  for (const probe of probes) {
    if (nodeIds.has(probe.nodeId)) {
      throw new Error(`duplicate online node identity: ${probe.nodeId}`);
    }
    nodeIds.add(probe.nodeId);

    const address = `${probe.ipAddress}:${probe.port}`;
    if (addresses.has(address)) {
      throw new Error(`duplicate online node address: ${address}`);
    }
    addresses.add(address);
  }

  if (!nodeIds.has(DISTRIBUTED_CONTROLLER_NODE_ID)) {
    throw new Error('the controller node probe is required');
  }

  return probes.sort((left, right) => compareText(left.nodeId, right.nodeId));
}

function assertProbeMatchesConfiguration(probe, configured, label) {
  if (
    probe.ipAddress !== configured.ipAddress ||
    probe.port !== configured.port
  ) {
    throw new Error(`${label} identity does not match the controller config`);
  }
  if (probe.availableThreads !== configured.availableThreads) {
    throw new Error(
      `${label} available thread count is stale relative to the controller config`
    );
  }
  if (probe.cpuName !== configured.cpuName) {
    throw new Error(
      `${label} CPU description is stale relative to the controller config`
    );
  }
}

function normalizeCatalog(value) {
  let cloned;
  try {
    cloned = structuredClone(value);
  } catch (error) {
    throw new TypeError('catalog must be structured-cloneable', {
      cause: error,
    });
  }

  const firstShardId = cloned?.tasks?.[0]?.taskId;
  createDistributedNativeTaskRequest(cloned, firstShardId);
  return cloned;
}

function createShardTests(catalog, repositoryIdentitySha256) {
  const shardTests = catalog.tasks.map((entry) => {
    const shardId = entry.taskId;
    return {
      adapterId: entry.adapterId,
      applicationId: catalog.applicationId,
      dependencies: [],
      fingerprint: shardId,
      id: shardId,
      laneId: 'repository-native',
      repositoryIdentitySha256,
    };
  });

  const shardIds = new Set(shardTests.map((entry) => entry.id));
  if (shardIds.size !== catalog.tasks.length) {
    throw new Error('catalog shard identities are not one-to-one');
  }

  return shardTests;
}

function createSchedulerNodes(config, probes, catalog) {
  const configuredNodes = new Map(
    config.nodes.map((entry) => [entry.nodeNumber, entry])
  );

  return probes.map((probe) => {
    let configured;
    let runsOnControllerHost = false;

    if (probe.nodeId === DISTRIBUTED_CONTROLLER_NODE_ID) {
      configured = config.global;
      runsOnControllerHost = true;
    } else {
      const nodeNumber = REMOTE_NODE_ID_PATTERN.exec(probe.nodeId)?.[1];
      configured = configuredNodes.get(nodeNumber);
      if (configured === undefined) {
        throw new Error(`online node ${probe.nodeId} is not enrolled`);
      }
      if (
        configured.threads === null ||
        configured.minimumThreadCount === null
      ) {
        throw new Error(
          `online node ${probe.nodeId} has no assigned thread policy`
        );
      }
    }

    assertProbeMatchesConfiguration(
      probe,
      configured,
      `online node ${probe.nodeId}`
    );

    if (probe.candidateSha256 !== catalog.candidate.candidateSha256) {
      throw new Error(
        `online node ${probe.nodeId} is bound to a different candidate`
      );
    }
    if (probe.catalogSha256 !== catalog.catalogSha256) {
      throw new Error(
        `online node ${probe.nodeId} is bound to a different catalog`
      );
    }

    return {
      adapterIds: probe.adapterIds,
      concurrency: {
        mode: 'explicit',
        threads: evaluateThreadExpression(
          configured.threads,
          probe.availableThreads,
          configured.minimumThreadCount
        ),
      },
      effectiveLogicalThreads: probe.availableThreads,
      id: probe.nodeId,
      runsOnControllerHost,
      scope: {
        environment: probe.environment,
        nodeId: probe.nodeId,
      },
    };
  });
}

function assertShardClosure(schedule, shardTests) {
  const expected = shardTests.map((entry) => entry.id).sort(compareText);
  const actual = schedule.threadSlots
    .flatMap((threadSlot) => threadSlot.tests.map((entry) => entry.id))
    .sort(compareText);

  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      'adaptive schedule does not contain every catalog shard once'
    );
  }
}

export function createControllerAdaptiveSchedule(value) {
  assertPlainObject(value, 'bridge input');
  assertExactKeys(
    value,
    REQUIRED_INPUT_KEYS,
    OPTIONAL_INPUT_KEYS,
    'bridge input'
  );

  const config = createControllerConfig(value.controllerConfig);
  const probes = normalizeOnlineNodeProbes(value.onlineNodeProbes);
  const catalog = normalizeCatalog(value.catalog);
  const repositoryIdentitySha256 = normalizeSha256(
    value.repositoryIdentitySha256,
    'repositoryIdentitySha256'
  );
  const shardTests = createShardTests(catalog, repositoryIdentitySha256);
  const nodes = createSchedulerNodes(config, probes, catalog);
  const schedule = createDistributedAdaptiveSchedule({
    nodes,
    policy: value.policy ?? {},
    profile: value.timingProfile,
    tests: shardTests,
  });

  assertShardClosure(schedule, shardTests);
  return schedule;
}
