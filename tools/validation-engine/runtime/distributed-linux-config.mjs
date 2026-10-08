// Copyright (c) snapetech and SeerrNG contributors.
// Strict, human-readable Linux configuration for Mode 3 computers.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, isAbsolute, join } from 'node:path';

export const MAX_MODE3_CONFIG_BYTES = 128 * 1024;
export const MAX_MODE3_THREADS = 256;

const CONTROLLER_HEADER = [
  '# Test Suite Multi-Computer Controller Configuration',
  '# github username: Identifies the controller profile and config filename.',
  '# computer name: Gives the controller or node a descriptive name.',
  '# ip address: Identifies the controller or node on the network.',
  '# port: Selects the controller or node listening port.',
  '# cpu name: Records the automatically detected processor name.',
  '# available threads: Records the automatically detected hardware threads.',
  '# threads: Sets the controller-owned execution count or n expression.',
  '# minimum thread count: Sets the lower limit for evaluated threads.',
  '# supported applications: Records numbered app instances and controller-local profiles.',
  '# application requirements: Records resolved dependency name/version pairs.',
  '# node dependency availability: Records actual dependency name/version pairs.',
  '# shared authentication key: Authenticates the cluster and stays last.',
];
const NODE_HEADER = [
  '# Test Suite Multi-Computer Node Configuration',
  '# ip address: Identifies the controller or this node on the network.',
  '# port: Selects the controller or this node listening port.',
  '# computer name: Gives this node a descriptive name.',
  '# cpu name: Records the automatically detected processor name.',
  '# available threads: Records the automatically detected hardware threads.',
  '# selected applications: Records the numbered controller app instances selected here.',
  '# dependency availability: Records actual dependency name/version pairs on this node.',
  '# shared authentication key: Is added after the controller accepts the node.',
];
const HASH64 = /^[a-f0-9]{64}$/;
const NODE_NUMBER = /^(?:0[1-9]|[1-9][0-9])$/;
const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const DEPENDENCY_NAME = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;
const DEPENDENCY_PROFILE_FILENAME =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-test-suite-dependancies\.cfg$/;
const THREAD_EXPRESSION =
  /^(?:[1-9][0-9]*|(?:(?:[2-9]|[1-9][0-9]+)?n)(?:[+-][1-9][0-9]*)?)$/;
const GLOBAL_KEYS = [
  'github username',
  'computer name',
  'ip address',
  'port',
  'cpu name',
  'available threads',
  'threads',
  'minimum thread count',
];
const CONTROLLER_NODE_KEYS = [
  'computer name',
  'ip address',
  'port',
  'cpu name',
  'available threads',
  'threads',
  'minimum thread count',
];
const CONTROLLER_NODE_REQUIRED_KEYS = CONTROLLER_NODE_KEYS.slice(0, 5);
const NODE_LOCAL_KEYS = [
  'computer name',
  'ip address',
  'port',
  'cpu name',
  'available threads',
];
const CONTROLLER_REFERENCE_KEYS = ['ip address', 'port'];
const SECURITY_KEYS = ['shared authentication key'];
const CONTROLLER_MODEL_KEYS = ['global', 'nodes', 'sharedAuthenticationKey'];
const CONTROLLER_DEPENDENCY_MODEL_KEYS = [
  'supportedApplications',
  'applicationRequirements',
  'nodeDependencyAvailability',
];
const GLOBAL_MODEL_KEYS = [
  'githubUsername',
  'computerName',
  'ipAddress',
  'port',
  'cpuName',
  'availableThreads',
  'threads',
  'minimumThreadCount',
];
const CONTROLLER_NODE_MODEL_KEYS = [
  'nodeNumber',
  'computerName',
  'ipAddress',
  'port',
  'cpuName',
  'availableThreads',
  'threads',
  'minimumThreadCount',
];
const CONTROLLER_NODE_REQUIRED_MODEL_KEYS = CONTROLLER_NODE_MODEL_KEYS.slice(
  0,
  6
);
const NODE_MODEL_KEYS = ['controller', 'node', 'sharedAuthenticationKey'];
const NODE_DEPENDENCY_MODEL_KEYS = [
  'selectedApplications',
  'dependencyAvailability',
];
const CONTROLLER_REFERENCE_MODEL_KEYS = ['ipAddress', 'port'];
const NODE_LOCAL_MODEL_KEYS = [
  'nodeNumber',
  'computerName',
  'ipAddress',
  'port',
  'cpuName',
  'availableThreads',
];
const NODE_ENROLLMENT_REQUEST_KEYS = [...NODE_LOCAL_MODEL_KEYS, 'overwrite'];
const NODE_ENROLLMENT_DEPENDENCY_KEYS = [
  'selectedApplicationEntries',
  'dependencyAvailability',
];
const NODE_ENROLLMENT_ACCEPTED_RESPONSE_KEYS = [
  'status',
  'disposition',
  'nodeNumber',
  'sharedAuthenticationKey',
];
const NODE_ENROLLMENT_ACCEPTED_DEPENDENCY_KEYS = [
  'selectedApplications',
  'dependencyAvailability',
];
const NODE_ENROLLMENT_CONFLICT_RESPONSE_KEYS = [
  'status',
  'reason',
  'nodeNumber',
  'existingNode',
];
const NODE_ENROLLMENT_DISPOSITIONS = ['created', 'refreshed', 'overwritten'];
const NODE_ENROLLMENT_CONFLICT_REASONS = [
  'node-number-occupied',
  'node-ip-address-occupied',
];

// First contact intentionally trusts access to the operator's private network.
// The controller address is selected locally by the installer; enrollment
// carries no bootstrap key, pairing code, token, or certificate fingerprint.

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
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function requiredAndOptionalKeys(value, required, optional, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const unknown = actual.find(
    (key) => !required.includes(key) && !optional.includes(key)
  );
  if (unknown) throw new Error(`${label} requires its exact field set`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactText(value, label, maximum = 256) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Config values cross machines.
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function githubUsername(value) {
  exactText(value, 'github username', 39);
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value) ||
    value.includes('--')
  )
    throw new Error('GitHub username is invalid');
  return value;
}

function nodeNumber(value) {
  if (typeof value !== 'string' || !NODE_NUMBER.test(value))
    throw new Error('Node number must use two digits from 01 through 99');
  return value;
}

function ipAddress(value, label) {
  exactText(value, label, 64);
  if (isIP(value) === 0) throw new Error(`${label} must be an IP address`);
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(
      `${label} must be a positive integer not greater than ${maximum}`
    );
  return value;
}

function port(value, label) {
  return positiveInteger(value, label, 65_535);
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function exactChoice(value, choices, label) {
  if (typeof value !== 'string' || !choices.includes(value))
    throw new Error(`${label} is invalid`);
  return value;
}

function optionalFieldGroup(value, fields, label) {
  const present = fields.filter((field) => Object.hasOwn(value, field));
  if (present.length !== 0 && present.length !== fields.length)
    throw new Error(`${label} fields must be supplied together`);
  return present.length === fields.length;
}

function applicationEntryId(value) {
  if (typeof value !== 'string' || !NODE_NUMBER.test(value))
    throw new Error(
      'Application entry ID must use two digits from 01 through 99'
    );
  return value;
}

function applicationId(value) {
  exactText(value, 'application ID', 128);
  if (/[[\]]/.test(value) || !/^\S(?:.*\S)?\s+\S*\d\S*$/.test(value))
    throw new Error(
      'Application ID must contain a product name followed by a version'
    );
  return value;
}

function applicationName(value) {
  return exactText(value, 'application name', 256);
}

function dependencyProfilePath(value) {
  exactText(value, 'dependency profile path', 4096);
  if (!isAbsolute(value))
    throw new Error('Dependency profile path must be absolute');
  if (!DEPENDENCY_PROFILE_FILENAME.test(basename(value)))
    throw new Error(
      'Dependency profile filename must use <appname>-test-suite-dependancies.cfg'
    );
  return value;
}

function dependencyName(value) {
  if (typeof value !== 'string' || !DEPENDENCY_NAME.test(value))
    throw new Error('Dependency name is invalid');
  return value;
}

function dependencyVersion(value) {
  return exactText(value, 'dependency version', 256);
}

function normalizeDependencies(value, label) {
  if (!Array.isArray(value) || value.length > 256)
    throw new Error(`${label} must be an array of at most 256 dependencies`);
  const dependencies = value
    .map((entry) => {
      exactKeys(entry, ['name', 'version'], `${label} entry`);
      return {
        name: dependencyName(entry.name),
        version: dependencyVersion(entry.version),
      };
    })
    .toSorted((left, right) => compareText(left.name, right.name));
  if (
    new Set(dependencies.map((entry) => entry.name)).size !==
    dependencies.length
  )
    throw new Error(`${label} contains a duplicate dependency name`);
  return dependencies;
}

function normalizeSelectedApplications(value, label = 'selected applications') {
  if (!Array.isArray(value) || value.length > 99)
    throw new Error(`${label} must be an array of at most 99 applications`);
  const applications = value
    .map((entry) => {
      exactKeys(entry, ['entryId', 'applicationId', 'name'], `${label} entry`);
      return {
        entryId: applicationEntryId(entry.entryId),
        applicationId: applicationId(entry.applicationId),
        name: applicationName(entry.name),
      };
    })
    .toSorted((left, right) => compareText(left.entryId, right.entryId));
  if (
    new Set(applications.map((entry) => entry.entryId)).size !==
    applications.length
  )
    throw new Error(`${label} contains a duplicate application entry ID`);
  return applications;
}

function normalizeSupportedApplications(value) {
  if (!Array.isArray(value) || value.length > 99)
    throw new Error(
      'Controller supported applications must be an array of at most 99'
    );
  const applications = value
    .map((entry) => {
      exactKeys(
        entry,
        ['entryId', 'applicationId', 'name', 'profilePath'],
        'supported application'
      );
      return {
        entryId: applicationEntryId(entry.entryId),
        applicationId: applicationId(entry.applicationId),
        name: applicationName(entry.name),
        profilePath: dependencyProfilePath(entry.profilePath),
      };
    })
    .toSorted((left, right) => compareText(left.entryId, right.entryId));
  if (
    new Set(applications.map((entry) => entry.entryId)).size !==
    applications.length
  )
    throw new Error(
      'Controller supported applications contain a duplicate application entry ID'
    );
  const identities = applications.map(
    (entry) => `${entry.applicationId}\0${entry.name}`
  );
  if (new Set(identities).size !== identities.length)
    throw new Error(
      'Controller supported applications contain a duplicate application ID and name'
    );
  return applications;
}

function normalizeApplicationRequirements(value, supportedApplications) {
  if (!Array.isArray(value) || value.length > 99)
    throw new Error(
      'Controller application requirements must be an array of at most 99'
    );
  const requirements = value
    .map((entry) => {
      exactKeys(
        entry,
        ['applicationId', 'dependencies'],
        'application requirements'
      );
      const id = applicationId(entry.applicationId);
      const dependencies = normalizeDependencies(
        entry.dependencies,
        `Application ${id} requirements`
      );
      if (dependencies.length === 0)
        throw new Error(`Application ${id} requirements cannot be empty`);
      return { applicationId: id, dependencies };
    })
    .toSorted((left, right) =>
      compareText(left.applicationId, right.applicationId)
    );
  if (
    new Set(requirements.map((entry) => entry.applicationId)).size !==
    requirements.length
  )
    throw new Error(
      'Controller application requirements contain a duplicate application ID'
    );
  const supportedIds = new Set(
    supportedApplications.map((entry) => entry.applicationId)
  );
  const requirementIds = new Set(
    requirements.map((entry) => entry.applicationId)
  );
  if ([...supportedIds].some((id) => !requirementIds.has(id)))
    throw new Error(
      'Every supported application ID must have a requirements section'
    );
  return requirements;
}

function normalizeNodeDependencyAvailability(value, nodes) {
  if (!Array.isArray(value) || value.length > 99)
    throw new Error(
      'Controller node dependency availability must be an array of at most 99'
    );
  const nodeNumbers = new Set(nodes.map((entry) => entry.nodeNumber));
  const availability = value
    .map((entry) => {
      exactKeys(
        entry,
        ['nodeNumber', 'dependencies'],
        'node dependency availability'
      );
      const number = nodeNumber(entry.nodeNumber);
      if (!nodeNumbers.has(number))
        throw new Error(
          `Node ${number} dependency availability has no enrolled node`
        );
      return {
        nodeNumber: number,
        dependencies: normalizeDependencies(
          entry.dependencies,
          `Node ${number} dependency availability`
        ),
      };
    })
    .toSorted((left, right) => compareText(left.nodeNumber, right.nodeNumber));
  if (
    new Set(availability.map((entry) => entry.nodeNumber)).size !==
    availability.length
  )
    throw new Error(
      'Controller node dependency availability contains a duplicate node number'
    );
  return availability;
}

function sharedAuthenticationKey(value, { optional = false } = {}) {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(
      'Shared authentication key must be exactly 64 lower-case hexadecimal characters'
    );
  return value;
}

export function canonicalThreadExpression(value) {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !THREAD_EXPRESSION.test(value)
  )
    throw new Error(
      'Threads must be a positive integer or a canonical n expression'
    );
  return value;
}

function normalizeControllerMachine(value, label) {
  requiredAndOptionalKeys(
    value,
    CONTROLLER_NODE_REQUIRED_MODEL_KEYS,
    ['threads', 'minimumThreadCount'],
    label
  );
  const hasThreads = Object.hasOwn(value, 'threads');
  const hasMinimum = Object.hasOwn(value, 'minimumThreadCount');
  if (hasThreads !== hasMinimum)
    throw new Error(
      `${label} threads and minimum thread count must be assigned together`
    );
  const unscheduled =
    !hasThreads ||
    (value.threads === null && value.minimumThreadCount === null);
  if (
    hasThreads &&
    !unscheduled &&
    (value.threads === null || value.minimumThreadCount === null)
  )
    throw new Error(
      `${label} threads and minimum thread count must be assigned together`
    );
  return {
    nodeNumber: nodeNumber(value.nodeNumber),
    computerName: exactText(value.computerName, `${label} computer name`),
    ipAddress: ipAddress(value.ipAddress, `${label} ip address`),
    port: port(value.port, `${label} port`),
    cpuName: exactText(value.cpuName, `${label} cpu name`, 512),
    availableThreads: positiveInteger(
      value.availableThreads,
      `${label} available threads`
    ),
    threads: unscheduled ? null : canonicalThreadExpression(value.threads),
    minimumThreadCount: unscheduled
      ? null
      : positiveInteger(
          value.minimumThreadCount,
          `${label} minimum thread count`,
          MAX_MODE3_THREADS
        ),
  };
}

function normalizeGlobal(value) {
  exactKeys(value, GLOBAL_MODEL_KEYS, 'controller global settings');
  return {
    githubUsername: githubUsername(value.githubUsername),
    computerName: exactText(value.computerName, 'controller computer name'),
    ipAddress: ipAddress(value.ipAddress, 'controller ip address'),
    port: port(value.port, 'controller port'),
    cpuName: exactText(value.cpuName, 'controller cpu name', 512),
    availableThreads: positiveInteger(
      value.availableThreads,
      'controller available threads'
    ),
    threads: canonicalThreadExpression(value.threads),
    minimumThreadCount: positiveInteger(
      value.minimumThreadCount,
      'controller minimum thread count',
      MAX_MODE3_THREADS
    ),
  };
}

function normalizeNodeLocal(value) {
  exactKeys(value, NODE_LOCAL_MODEL_KEYS, 'node settings');
  return {
    nodeNumber: nodeNumber(value.nodeNumber),
    computerName: exactText(value.computerName, 'node computer name'),
    ipAddress: ipAddress(value.ipAddress, 'node ip address'),
    port: port(value.port, 'node port'),
    cpuName: exactText(value.cpuName, 'node cpu name', 512),
    availableThreads: positiveInteger(
      value.availableThreads,
      'node available threads'
    ),
  };
}

export function createControllerConfig(value) {
  requiredAndOptionalKeys(
    value,
    CONTROLLER_MODEL_KEYS,
    CONTROLLER_DEPENDENCY_MODEL_KEYS,
    'controller config'
  );
  const hasDependencyConfiguration = optionalFieldGroup(
    value,
    CONTROLLER_DEPENDENCY_MODEL_KEYS,
    'Controller dependency configuration'
  );
  if (!Array.isArray(value.nodes) || value.nodes.length > 99)
    throw new Error('Controller config nodes must be an array of at most 99');
  const global = normalizeGlobal(value.global);
  const nodes = value.nodes
    .map((entry) => normalizeControllerMachine(entry, 'controller node'))
    .toSorted((left, right) => compareText(left.nodeNumber, right.nodeNumber));
  for (const [field, values] of [
    ['node number', nodes.map((entry) => entry.nodeNumber)],
    ['node ip address', nodes.map((entry) => entry.ipAddress)],
  ])
    if (new Set(values).size !== values.length)
      throw new Error(`Controller config contains a duplicate ${field}`);
  if (nodes.some((entry) => entry.ipAddress === global.ipAddress))
    throw new Error(
      'Controller and node ip addresses must identify different computers'
    );
  const config = {
    global,
    nodes,
    sharedAuthenticationKey: sharedAuthenticationKey(
      value.sharedAuthenticationKey
    ),
  };
  if (hasDependencyConfiguration) {
    const supportedApplications = normalizeSupportedApplications(
      value.supportedApplications
    );
    Object.assign(config, {
      supportedApplications,
      applicationRequirements: normalizeApplicationRequirements(
        value.applicationRequirements,
        supportedApplications
      ),
      nodeDependencyAvailability: normalizeNodeDependencyAvailability(
        value.nodeDependencyAvailability,
        nodes
      ),
    });
  }
  return deepFreeze(config);
}

export function createNodeConfig(value) {
  requiredAndOptionalKeys(
    value,
    NODE_MODEL_KEYS,
    NODE_DEPENDENCY_MODEL_KEYS,
    'node config'
  );
  const hasDependencyConfiguration = optionalFieldGroup(
    value,
    NODE_DEPENDENCY_MODEL_KEYS,
    'Node dependency configuration'
  );
  exactKeys(
    value.controller,
    CONTROLLER_REFERENCE_MODEL_KEYS,
    'node controller settings'
  );
  const controller = {
    ipAddress: ipAddress(
      value.controller.ipAddress,
      'node controller ip address'
    ),
    port: port(value.controller.port, 'node controller port'),
  };
  const node = normalizeNodeLocal(value.node);
  if (controller.ipAddress === node.ipAddress)
    throw new Error(
      'Controller and node ip addresses must identify different computers'
    );
  const config = {
    controller,
    node,
    sharedAuthenticationKey: sharedAuthenticationKey(
      value.sharedAuthenticationKey,
      { optional: true }
    ),
  };
  if (hasDependencyConfiguration)
    Object.assign(config, {
      selectedApplications: normalizeSelectedApplications(
        value.selectedApplications
      ),
      dependencyAvailability: normalizeDependencies(
        value.dependencyAvailability,
        'Node dependency availability'
      ),
    });
  return deepFreeze(config);
}

export function createNodeEnrollmentRequest(value) {
  requiredAndOptionalKeys(
    value,
    NODE_ENROLLMENT_REQUEST_KEYS,
    NODE_ENROLLMENT_DEPENDENCY_KEYS,
    'node enrollment request'
  );
  const hasDependencyReport = optionalFieldGroup(
    value,
    NODE_ENROLLMENT_DEPENDENCY_KEYS,
    'Node enrollment dependency report'
  );
  const node = normalizeNodeLocal(
    Object.fromEntries(NODE_LOCAL_MODEL_KEYS.map((key) => [key, value[key]]))
  );
  const request = {
    ...node,
    overwrite: exactBoolean(value.overwrite, 'Node enrollment overwrite'),
  };
  if (hasDependencyReport) {
    if (
      !Array.isArray(value.selectedApplicationEntries) ||
      value.selectedApplicationEntries.length > 99
    )
      throw new Error(
        'Node enrollment selected application entries must be an array of at most 99'
      );
    const selectedApplicationEntries = value.selectedApplicationEntries
      .map(applicationEntryId)
      .toSorted(compareText);
    if (
      new Set(selectedApplicationEntries).size !==
      selectedApplicationEntries.length
    )
      throw new Error(
        'Node enrollment selected application entries contain a duplicate'
      );
    Object.assign(request, {
      selectedApplicationEntries,
      dependencyAvailability: normalizeDependencies(
        value.dependencyAvailability,
        'Node enrollment dependency availability'
      ),
    });
  }
  return deepFreeze(request);
}

function nodeEnrollmentFacts(value) {
  const node = normalizeNodeLocal(value);
  return deepFreeze(node);
}

export function createNodeEnrollmentResponse(value) {
  plainObject(value, 'node enrollment response');
  if (value.status === 'accepted') {
    requiredAndOptionalKeys(
      value,
      NODE_ENROLLMENT_ACCEPTED_RESPONSE_KEYS,
      NODE_ENROLLMENT_ACCEPTED_DEPENDENCY_KEYS,
      'accepted node enrollment response'
    );
    const hasDependencyReport = optionalFieldGroup(
      value,
      NODE_ENROLLMENT_ACCEPTED_DEPENDENCY_KEYS,
      'Accepted node enrollment dependency report'
    );
    const response = {
      status: 'accepted',
      disposition: exactChoice(
        value.disposition,
        NODE_ENROLLMENT_DISPOSITIONS,
        'Node enrollment disposition'
      ),
      nodeNumber: nodeNumber(value.nodeNumber),
      sharedAuthenticationKey: sharedAuthenticationKey(
        value.sharedAuthenticationKey
      ),
    };
    if (hasDependencyReport)
      Object.assign(response, {
        selectedApplications: normalizeSelectedApplications(
          value.selectedApplications
        ),
        dependencyAvailability: normalizeDependencies(
          value.dependencyAvailability,
          'Accepted node dependency availability'
        ),
      });
    return deepFreeze(response);
  }
  if (value.status === 'conflict') {
    exactKeys(
      value,
      NODE_ENROLLMENT_CONFLICT_RESPONSE_KEYS,
      'conflicting node enrollment response'
    );
    const reason = exactChoice(
      value.reason,
      NODE_ENROLLMENT_CONFLICT_REASONS,
      'Node enrollment conflict reason'
    );
    const requestedNodeNumber = nodeNumber(value.nodeNumber);
    const existingNode = nodeEnrollmentFacts(value.existingNode);
    if (
      (reason === 'node-number-occupied' &&
        existingNode.nodeNumber !== requestedNodeNumber) ||
      (reason === 'node-ip-address-occupied' &&
        existingNode.nodeNumber === requestedNodeNumber)
    )
      throw new Error('Node enrollment conflict identity is inconsistent');
    return deepFreeze({
      status: 'conflict',
      reason,
      nodeNumber: requestedNodeNumber,
      existingNode,
    });
  }
  throw new Error('Node enrollment response status is invalid');
}

function dependencyListsEqual(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.name === right[index].name &&
        entry.version === right[index].version
    )
  );
}

function applicationRequirementsMap(config) {
  return new Map(
    (config.applicationRequirements ?? []).map((entry) => [
      entry.applicationId,
      entry.dependencies,
    ])
  );
}

export function createSupportedApplicationListing(controllerValue) {
  const config = createControllerConfig(controllerValue);
  const requirements = applicationRequirementsMap(config);
  return deepFreeze({
    applications: (config.supportedApplications ?? []).map((entry) => ({
      ...entry,
      requirements: requirements.get(entry.applicationId) ?? [],
    })),
  });
}

export function createSupportedApplicationListingResponse(value) {
  exactKeys(value, ['applications'], 'supported application listing');
  if (!Array.isArray(value.applications) || value.applications.length > 99)
    throw new Error(
      'Supported application listing must contain at most 99 applications'
    );
  const applications = value.applications
    .map((entry) => {
      exactKeys(
        entry,
        ['entryId', 'applicationId', 'name', 'profilePath', 'requirements'],
        'supported application listing entry'
      );
      return {
        entryId: applicationEntryId(entry.entryId),
        applicationId: applicationId(entry.applicationId),
        name: applicationName(entry.name),
        profilePath: dependencyProfilePath(entry.profilePath),
        requirements: normalizeDependencies(
          entry.requirements,
          `Application ${entry.applicationId} requirements`
        ),
      };
    })
    .toSorted((left, right) => compareText(left.entryId, right.entryId));
  if (
    new Set(applications.map((entry) => entry.entryId)).size !==
    applications.length
  )
    throw new Error(
      'Supported application listing contains a duplicate application entry ID'
    );
  for (const application of applications) {
    const peer = applications.find(
      (entry) =>
        entry !== application &&
        entry.applicationId === application.applicationId
    );
    if (
      peer &&
      !dependencyListsEqual(peer.requirements, application.requirements)
    )
      throw new Error(
        `Application ${application.applicationId} has conflicting requirements`
      );
  }
  return deepFreeze({ applications });
}

export function createDependencyProvisioningPlanFromApplicationListing(
  listingValue,
  selectedEntryIds,
  { dependencyNameFilter = null } = {}
) {
  const listing = createSupportedApplicationListingResponse(listingValue);
  if (!Array.isArray(selectedEntryIds) || selectedEntryIds.length === 0)
    throw new Error(
      'At least one supported application entry must be selected'
    );
  const selectedIds = selectedEntryIds
    .map(applicationEntryId)
    .toSorted(compareText);
  if (new Set(selectedIds).size !== selectedIds.length)
    throw new Error('Selected application entries contain a duplicate');
  const byEntry = new Map(
    listing.applications.map((entry) => [entry.entryId, entry])
  );
  const selected = selectedIds.map((entryId) => {
    const application = byEntry.get(entryId);
    if (!application)
      throw new Error(`Supported application entry ${entryId} does not exist`);
    return application;
  });
  const dependencies = new Map();
  for (const application of selected)
    for (const dependency of application.requirements) {
      const existing = dependencies.get(dependency.name);
      if (existing && existing.version !== dependency.version)
        throw new Error(
          `Dependency ${dependency.name} has incompatible required versions ${existing.version} and ${dependency.version}`
        );
      dependencies.set(dependency.name, dependency);
    }
  let plannedDependencies = [...dependencies.values()].toSorted((left, right) =>
    compareText(left.name, right.name)
  );
  if (dependencyNameFilter !== null) {
    const name = dependencyName(dependencyNameFilter);
    const selectedDependency = dependencies.get(name);
    if (!selectedDependency)
      throw new Error(
        `Selected applications do not require dependency ${name}`
      );
    plannedDependencies = [selectedDependency];
  }
  return deepFreeze({
    selectedApplications: selected.map(
      ({ entryId, applicationId: id, name }) => ({
        entryId,
        applicationId: id,
        name,
      })
    ),
    dependencies: plannedDependencies,
  });
}

export function createDependencyProvisioningPlan(
  controllerValue,
  selectedEntryIds,
  options
) {
  return createDependencyProvisioningPlanFromApplicationListing(
    createSupportedApplicationListing(controllerValue),
    selectedEntryIds,
    options
  );
}

export function compareDependencyAvailability(planValue, availabilityValue) {
  exactKeys(
    planValue,
    ['selectedApplications', 'dependencies'],
    'dependency provisioning plan'
  );
  const selectedApplications = normalizeSelectedApplications(
    planValue.selectedApplications
  );
  const requirements = normalizeDependencies(
    planValue.dependencies,
    'Dependency provisioning requirements'
  );
  const availability = normalizeDependencies(
    availabilityValue,
    'Dependency availability'
  );
  const actual = new Map(availability.map((entry) => [entry.name, entry]));
  const required = new Set(requirements.map((entry) => entry.name));
  const missing = requirements.filter((entry) => !actual.has(entry.name));
  const mismatched = requirements
    .filter(
      (entry) =>
        actual.has(entry.name) &&
        actual.get(entry.name).version !== entry.version
    )
    .map((entry) => ({
      name: entry.name,
      requiredVersion: entry.version,
      actualVersion: actual.get(entry.name).version,
    }));
  const unexpected = availability.filter((entry) => !required.has(entry.name));
  return deepFreeze({
    status:
      missing.length === 0 && mismatched.length === 0 ? 'ready' : 'incomplete',
    selectedApplications,
    requirements,
    availability,
    missing,
    mismatched,
    unexpected,
  });
}

export function addSupportedApplication(
  controllerValue,
  { applicationId: idValue, name: nameValue, profilePath, dependencies }
) {
  const config = createControllerConfig(controllerValue);
  const id = applicationId(idValue);
  const name = applicationName(nameValue);
  const normalizedPath = dependencyProfilePath(profilePath);
  const normalizedDependencies = normalizeDependencies(
    dependencies,
    `Application ${id} requirements`
  );
  if (normalizedDependencies.length === 0)
    throw new Error(`Application ${id} requirements cannot be empty`);
  const supportedApplications = config.supportedApplications ?? [];
  if (
    supportedApplications.some(
      (entry) => entry.applicationId === id && entry.name === name
    )
  )
    throw new Error(`Application ${id} named ${name} is already supported`);
  const used = new Set(supportedApplications.map((entry) => entry.entryId));
  let entryId = null;
  for (let index = 1; index <= 99; index += 1) {
    const candidate = String(index).padStart(2, '0');
    if (!used.has(candidate)) {
      entryId = candidate;
      break;
    }
  }
  if (entryId === null)
    throw new Error('Controller already has 99 supported application entries');
  const applicationRequirements = config.applicationRequirements ?? [];
  const existingRequirements = applicationRequirements.find(
    (entry) => entry.applicationId === id
  );
  if (
    existingRequirements &&
    !dependencyListsEqual(
      existingRequirements.dependencies,
      normalizedDependencies
    )
  )
    throw new Error(
      `Application ${id} profile conflicts with its existing dependency requirements`
    );
  const controllerConfig = createControllerConfig({
    global: config.global,
    nodes: config.nodes,
    supportedApplications: [
      ...supportedApplications,
      { entryId, applicationId: id, name, profilePath: normalizedPath },
    ],
    applicationRequirements: existingRequirements
      ? applicationRequirements
      : [
          ...applicationRequirements,
          { applicationId: id, dependencies: normalizedDependencies },
        ],
    nodeDependencyAvailability: config.nodeDependencyAvailability ?? [],
    sharedAuthenticationKey: config.sharedAuthenticationKey,
  });
  return deepFreeze({
    controllerConfig,
    application: createSupportedApplicationListing(
      controllerConfig
    ).applications.find((entry) => entry.entryId === entryId),
  });
}

export function deleteSupportedApplication(controllerValue, entryIdValue) {
  const config = createControllerConfig(controllerValue);
  const entryId = applicationEntryId(entryIdValue);
  const supportedApplications = config.supportedApplications ?? [];
  const removed = supportedApplications.find(
    (entry) => entry.entryId === entryId
  );
  if (!removed)
    throw new Error(`Supported application entry ${entryId} does not exist`);
  const remaining = supportedApplications.filter(
    (entry) => entry.entryId !== entryId
  );
  const applicationRequirements = (config.applicationRequirements ?? []).filter(
    (entry) =>
      entry.applicationId !== removed.applicationId ||
      remaining.some(
        (application) => application.applicationId === removed.applicationId
      )
  );
  const controllerConfig = createControllerConfig({
    global: config.global,
    nodes: config.nodes,
    supportedApplications: remaining,
    applicationRequirements,
    nodeDependencyAvailability: config.nodeDependencyAvailability ?? [],
    sharedAuthenticationKey: config.sharedAuthenticationKey,
  });
  return deepFreeze({ controllerConfig, application: removed });
}

export function setApplicationRequirements(
  controllerValue,
  applicationIdValue,
  dependenciesValue
) {
  const config = createControllerConfig(controllerValue);
  const id = applicationId(applicationIdValue);
  const dependencies = normalizeDependencies(
    dependenciesValue,
    `Application ${id} requirements`
  );
  if (dependencies.length === 0)
    throw new Error(`Application ${id} requirements cannot be empty`);
  const applicationRequirements = [
    ...(config.applicationRequirements ?? []).filter(
      (entry) => entry.applicationId !== id
    ),
    { applicationId: id, dependencies },
  ];
  return createControllerConfig({
    global: config.global,
    nodes: config.nodes,
    supportedApplications: config.supportedApplications ?? [],
    applicationRequirements,
    nodeDependencyAvailability: config.nodeDependencyAvailability ?? [],
    sharedAuthenticationKey: config.sharedAuthenticationKey,
  });
}

export function setControllerNodeThreadPolicy(controllerValue, policyValue) {
  const config = createControllerConfig(controllerValue);
  exactKeys(
    policyValue,
    ['nodeNumber', 'threads', 'minimumThreadCount'],
    'controller node thread policy'
  );
  const {
    nodeNumber: nodeNumberValue,
    threads: threadsValue,
    minimumThreadCount,
  } = policyValue;
  const selectedNodeNumber = nodeNumber(nodeNumberValue);
  const threads = canonicalThreadExpression(threadsValue);
  const minimum = positiveInteger(
    minimumThreadCount,
    'Minimum thread count',
    MAX_MODE3_THREADS
  );
  if (!config.nodes.some((node) => node.nodeNumber === selectedNodeNumber))
    throw new Error(`Controller node ${selectedNodeNumber} is not enrolled`);

  const value = {
    global: config.global,
    nodes: config.nodes.map((node) =>
      node.nodeNumber === selectedNodeNumber
        ? { ...node, threads, minimumThreadCount: minimum }
        : node
    ),
    sharedAuthenticationKey: config.sharedAuthenticationKey,
  };
  if (Object.hasOwn(config, 'supportedApplications'))
    Object.assign(value, {
      supportedApplications: config.supportedApplications,
      applicationRequirements: config.applicationRequirements,
      nodeDependencyAvailability: config.nodeDependencyAvailability,
    });
  return createControllerConfig(value);
}

export function evaluateNodeDependencyEligibility(
  controllerValue,
  applicationIdValue
) {
  const config = createControllerConfig(controllerValue);
  const id = applicationId(applicationIdValue);
  const requirements = (config.applicationRequirements ?? []).find(
    (entry) => entry.applicationId === id
  )?.dependencies;
  if (!requirements)
    throw new Error(`Application ${id} has no resolved requirements`);
  const evaluated = evaluateNodeDependencyAvailability(config, requirements);
  return deepFreeze({
    applicationId: id,
    ...evaluated,
  });
}

export function evaluateNodeDependencyAvailability(
  controllerValue,
  requirementsValue,
  nodeNumbersValue = null
) {
  const config = createControllerConfig(controllerValue);
  const requirements = normalizeDependencies(
    requirementsValue,
    'Run dependency requirements'
  );
  if (requirements.length === 0)
    throw new Error('Run dependency requirements cannot be empty');
  let selectedNodes = config.nodes;
  if (nodeNumbersValue !== null) {
    if (!Array.isArray(nodeNumbersValue))
      throw new Error('Available node numbers must be an array');
    const nodeNumbers = nodeNumbersValue.map(nodeNumber);
    if (new Set(nodeNumbers).size !== nodeNumbers.length)
      throw new Error('Available node numbers contain a duplicate');
    const selected = new Set(nodeNumbers);
    selectedNodes = config.nodes.filter((entry) =>
      selected.has(entry.nodeNumber)
    );
    if (selectedNodes.length !== selected.size)
      throw new Error('Available node numbers include an unenrolled node');
  }
  const availabilityByNode = new Map(
    (config.nodeDependencyAvailability ?? []).map((entry) => [
      entry.nodeNumber,
      entry.dependencies,
    ])
  );
  const nodes = selectedNodes.map((node) => {
    const availability = availabilityByNode.get(node.nodeNumber) ?? [];
    const comparison = compareDependencyAvailability(
      { selectedApplications: [], dependencies: requirements },
      availability
    );
    return {
      nodeNumber: node.nodeNumber,
      status: comparison.status,
      missing: comparison.missing,
      mismatched: comparison.mismatched,
    };
  });
  return deepFreeze({
    requirements,
    eligibleNodeNumbers: nodes
      .filter((node) => node.status === 'ready')
      .map((node) => node.nodeNumber),
    nodes,
  });
}

function enrollmentNode(request, { preservePolicy = null } = {}) {
  return {
    nodeNumber: request.nodeNumber,
    computerName: request.computerName,
    ipAddress: request.ipAddress,
    port: request.port,
    cpuName: request.cpuName,
    availableThreads: request.availableThreads,
    threads: preservePolicy?.threads ?? null,
    minimumThreadCount: preservePolicy?.minimumThreadCount ?? null,
  };
}

function enrollmentConflict(request, reason, existingNode, controllerConfig) {
  return deepFreeze({
    controllerConfig,
    response: createNodeEnrollmentResponse({
      status: 'conflict',
      reason,
      nodeNumber: request.nodeNumber,
      existingNode: Object.fromEntries(
        NODE_LOCAL_MODEL_KEYS.map((key) => [key, existingNode[key]])
      ),
    }),
  });
}

export function applyNodeEnrollmentRequest(controllerValue, requestValue) {
  const controllerConfig = createControllerConfig(controllerValue);
  const request = createNodeEnrollmentRequest(requestValue);
  const hasDependencyReport = Object.hasOwn(
    request,
    'selectedApplicationEntries'
  );
  const dependencyPlan = hasDependencyReport
    ? createDependencyProvisioningPlan(
        controllerConfig,
        request.selectedApplicationEntries
      )
    : null;
  const existingNumber = controllerConfig.nodes.find(
    (entry) => entry.nodeNumber === request.nodeNumber
  );
  const existingAddress = controllerConfig.nodes.find(
    (entry) =>
      entry.ipAddress === request.ipAddress &&
      entry.nodeNumber !== request.nodeNumber
  );
  const replacesExistingNode = Boolean(existingNumber && request.overwrite);

  if (existingAddress)
    return enrollmentConflict(
      request,
      'node-ip-address-occupied',
      existingAddress,
      controllerConfig
    );

  if (
    existingNumber &&
    !request.overwrite &&
    existingNumber.ipAddress !== request.ipAddress
  )
    return enrollmentConflict(
      request,
      'node-number-occupied',
      existingNumber,
      controllerConfig
    );

  let disposition = 'created';
  let enrolled;
  if (replacesExistingNode) {
    disposition = 'overwritten';
    enrolled = enrollmentNode(request);
  } else if (existingNumber) {
    // With no per-node credential, the trusted-LAN MVP recognizes a refresh by
    // the requested node number and its existing IP address. Other facts may
    // change, but controller-owned thread policy remains untouched.
    disposition = 'refreshed';
    enrolled = enrollmentNode(request, { preservePolicy: existingNumber });
  } else enrolled = enrollmentNode(request);

  const nodes = existingNumber
    ? controllerConfig.nodes.map((entry) =>
        entry.nodeNumber === request.nodeNumber ? enrolled : entry
      )
    : [...controllerConfig.nodes, enrolled];
  let nodeDependencyAvailability =
    controllerConfig.nodeDependencyAvailability ?? [];
  if (hasDependencyReport || replacesExistingNode) {
    nodeDependencyAvailability = nodeDependencyAvailability.filter(
      (entry) => entry.nodeNumber !== request.nodeNumber
    );
    if (hasDependencyReport)
      nodeDependencyAvailability.push({
        nodeNumber: request.nodeNumber,
        dependencies: request.dependencyAvailability,
      });
  }
  const updatedControllerValue = {
    global: controllerConfig.global,
    nodes,
    sharedAuthenticationKey: controllerConfig.sharedAuthenticationKey,
  };
  if (
    Object.hasOwn(controllerConfig, 'supportedApplications') ||
    hasDependencyReport
  )
    Object.assign(updatedControllerValue, {
      supportedApplications: controllerConfig.supportedApplications ?? [],
      applicationRequirements: controllerConfig.applicationRequirements ?? [],
      nodeDependencyAvailability,
    });
  const updatedControllerConfig = createControllerConfig(
    updatedControllerValue
  );
  const responseValue = {
    status: 'accepted',
    disposition,
    nodeNumber: request.nodeNumber,
    sharedAuthenticationKey: controllerConfig.sharedAuthenticationKey,
  };
  if (hasDependencyReport || replacesExistingNode)
    Object.assign(responseValue, {
      selectedApplications: hasDependencyReport
        ? dependencyPlan.selectedApplications
        : [],
      dependencyAvailability: hasDependencyReport
        ? request.dependencyAvailability
        : [],
    });
  const response = createNodeEnrollmentResponse(responseValue);
  return deepFreeze({
    controllerConfig: updatedControllerConfig,
    response,
  });
}

export function applyNodeEnrollmentResponse(nodeValue, responseValue) {
  const nodeConfig = createNodeConfig(nodeValue);
  const response = createNodeEnrollmentResponse(responseValue);
  if (response.status !== 'accepted')
    throw new Error('A conflicting enrollment response cannot enroll a node');
  if (response.nodeNumber !== nodeConfig.node.nodeNumber)
    throw new Error('Node enrollment response does not match this node number');
  const updatedNodeValue = {
    controller: nodeConfig.controller,
    node: nodeConfig.node,
    sharedAuthenticationKey: response.sharedAuthenticationKey,
  };
  if (Object.hasOwn(response, 'selectedApplications'))
    Object.assign(updatedNodeValue, {
      selectedApplications: response.selectedApplications,
      dependencyAvailability: response.dependencyAvailability,
    });
  else if (Object.hasOwn(nodeConfig, 'selectedApplications'))
    Object.assign(updatedNodeValue, {
      selectedApplications: nodeConfig.selectedApplications,
      dependencyAvailability: nodeConfig.dependencyAvailability,
    });
  return createNodeConfig(updatedNodeValue);
}

function parseDecimal(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value))
    throw new Error(`${label} must use canonical decimal digits`);
  const parsed = Number(value);
  return positiveInteger(parsed, label, maximum);
}

function parseDocument(text, label) {
  if (typeof text !== 'string') throw new Error(`${label} must be text`);
  if (Buffer.byteLength(text, 'utf8') > MAX_MODE3_CONFIG_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  if (text.startsWith('\uFEFF') || /\r(?!\n)/.test(text))
    throw new Error(`${label} contains unsupported text encoding`);
  const sections = [];
  const sectionNames = new Set();
  let current = null;
  let lastContentLine = -1;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    lastContentLine = lineIndex;
    if (line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^[]+)\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1];
      if (sectionNames.has(name))
        throw new Error(`${label} repeats section [${name}]`);
      sectionNames.add(name);
      current = { name, lineIndex, settings: new Map() };
      sections.push(current);
      continue;
    }
    if (!current)
      throw new Error(`${label} contains a setting before its first section`);
    const equals = line.indexOf('=');
    if (equals < 1)
      throw new Error(
        `${label} contains an invalid setting on line ${lineIndex + 1}`
      );
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (!key || current.settings.has(key))
      throw new Error(`${label} repeats setting ${key || '<empty>'}`);
    current.settings.set(key, { value, lineIndex });
  }
  if (sections.length === 0) throw new Error(`${label} has no sections`);
  return { sections, lastContentLine };
}

function readSection(section, expectedKeys, label) {
  const actual = [...section.settings.keys()];
  const unknown = actual.find((key) => !expectedKeys.includes(key));
  if (unknown) throw new Error(`${label} contains unknown setting ${unknown}`);
  const missing = expectedKeys.find((key) => !section.settings.has(key));
  if (missing) throw new Error(`${label} is missing setting ${missing}`);
  return Object.fromEntries(
    expectedKeys.map((key) => [key, section.settings.get(key).value])
  );
}

function readControllerNodeSection(section, label) {
  const actual = [...section.settings.keys()];
  const unknown = actual.find((key) => !CONTROLLER_NODE_KEYS.includes(key));
  if (unknown) throw new Error(`${label} contains unknown setting ${unknown}`);
  const missing = CONTROLLER_NODE_REQUIRED_KEYS.find(
    (key) => !section.settings.has(key)
  );
  if (missing) throw new Error(`${label} is missing setting ${missing}`);
  const hasThreads = section.settings.has('threads');
  const hasMinimum = section.settings.has('minimum thread count');
  if (hasThreads !== hasMinimum)
    throw new Error(
      `${label} threads and minimum thread count must be assigned together`
    );
  return Object.fromEntries(
    [
      ...CONTROLLER_NODE_REQUIRED_KEYS,
      ...(hasThreads ? CONTROLLER_NODE_KEYS.slice(5) : []),
    ].map((key) => [key, section.settings.get(key).value])
  );
}

function readSecuritySection(document, section, label) {
  const settings = readSection(section, SECURITY_KEYS, label);
  const entry = section.settings.get('shared authentication key');
  if (entry.lineIndex !== document.lastContentLine)
    throw new Error('Shared authentication key must be the final setting');
  return sharedAuthenticationKey(settings['shared authentication key']);
}

function nodeSectionNumber(sectionName) {
  const match = sectionName.match(/^Node ((?:0[1-9]|[1-9][0-9]))$/);
  if (!match) throw new Error(`Unknown Mode 3 section [${sectionName}]`);
  return match[1];
}

function parseControllerMachineSection(section) {
  const number = nodeSectionNumber(section.name);
  const values = readControllerNodeSection(
    section,
    `controller [${section.name}]`
  );
  const scheduled = Object.hasOwn(values, 'threads');
  return {
    nodeNumber: number,
    computerName: values['computer name'],
    ipAddress: values['ip address'],
    port: parseDecimal(values.port, `${section.name} port`, 65_535),
    cpuName: values['cpu name'],
    availableThreads: parseDecimal(
      values['available threads'],
      `${section.name} available threads`
    ),
    threads: scheduled ? values.threads : null,
    minimumThreadCount: scheduled
      ? parseDecimal(
          values['minimum thread count'],
          `${section.name} minimum thread count`,
          MAX_MODE3_THREADS
        )
      : null,
  };
}

function parseApplicationEntriesSection(
  section,
  { includeProfilePath, label }
) {
  const expectedFields = includeProfilePath
    ? ['application id', 'name', 'profile path']
    : ['application id', 'name'];
  const entries = new Map();
  for (const [key, setting] of section.settings) {
    const match = key.match(/^(\d{2}) (application id|name|profile path)$/);
    if (!match || !expectedFields.includes(match[2]))
      throw new Error(`${label} contains unknown setting ${key}`);
    const entryId = applicationEntryId(match[1]);
    const fields = entries.get(entryId) ?? new Map();
    if (fields.has(match[2]))
      throw new Error(`${label} repeats ${entryId} ${match[2]}`);
    fields.set(match[2], setting.value);
    entries.set(entryId, fields);
  }
  return [...entries]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([entryId, fields]) => {
      const missing = expectedFields.find((field) => !fields.has(field));
      if (missing) throw new Error(`${label} is missing ${entryId} ${missing}`);
      const entry = {
        entryId,
        applicationId: fields.get('application id'),
        name: fields.get('name'),
      };
      if (includeProfilePath) entry.profilePath = fields.get('profile path');
      return entry;
    });
}

function parseDependenciesSection(section) {
  return [...section.settings].map(([name, setting]) => ({
    name,
    version: setting.value,
  }));
}

function controllerDependencySections(sections) {
  const supportedSection = sections.find(
    (section) => section.name === 'Supported Applications'
  );
  const requirements = [];
  const availability = [];
  const nodes = [];
  for (const section of sections) {
    if (section === supportedSection) continue;
    if (/^Node (?:0[1-9]|[1-9][0-9])$/.test(section.name)) {
      nodes.push(parseControllerMachineSection(section));
      continue;
    }
    const requirementsMatch = section.name.match(
      /^Application (.+) Requirements$/
    );
    if (requirementsMatch) {
      requirements.push({
        applicationId: requirementsMatch[1],
        dependencies: parseDependenciesSection(section),
      });
      continue;
    }
    const availabilityMatch = section.name.match(
      /^Node ((?:0[1-9]|[1-9][0-9])) Dependency Availability$/
    );
    if (availabilityMatch) {
      availability.push({
        nodeNumber: availabilityMatch[1],
        dependencies: parseDependenciesSection(section),
      });
      continue;
    }
    throw new Error(`Unknown Mode 3 section [${section.name}]`);
  }
  if (!supportedSection && (requirements.length || availability.length))
    throw new Error(
      'Controller dependency sections require [Supported Applications]'
    );
  return {
    nodes,
    ...(supportedSection
      ? {
          supportedApplications: parseApplicationEntriesSection(
            supportedSection,
            {
              includeProfilePath: true,
              label: 'controller [Supported Applications]',
            }
          ),
          applicationRequirements: requirements,
          nodeDependencyAvailability: availability,
        }
      : {}),
  };
}

export function parseControllerConfig(text) {
  const document = parseDocument(text, 'Controller config');
  const { sections } = document;
  if (sections[0].name !== 'Global Settings')
    throw new Error('Controller config must begin with [Global Settings]');
  if (sections.at(-1).name !== 'Cluster Security')
    throw new Error('Controller config must end with [Cluster Security]');
  const globalValues = readSection(
    sections[0],
    GLOBAL_KEYS,
    'controller [Global Settings]'
  );
  const sharedKey = readSecuritySection(
    document,
    sections.at(-1),
    'controller [Cluster Security]'
  );
  const dependencySections = controllerDependencySections(
    sections.slice(1, -1)
  );
  return createControllerConfig({
    global: {
      githubUsername: globalValues['github username'],
      computerName: globalValues['computer name'],
      ipAddress: globalValues['ip address'],
      port: parseDecimal(globalValues.port, 'controller port', 65_535),
      cpuName: globalValues['cpu name'],
      availableThreads: parseDecimal(
        globalValues['available threads'],
        'controller available threads'
      ),
      threads: globalValues.threads,
      minimumThreadCount: parseDecimal(
        globalValues['minimum thread count'],
        'controller minimum thread count',
        MAX_MODE3_THREADS
      ),
    },
    ...dependencySections,
    sharedAuthenticationKey: sharedKey,
  });
}

export function parseNodeConfig(text) {
  const document = parseDocument(text, 'Node config');
  const { sections } = document;
  if (sections[0].name !== 'Controller')
    throw new Error('Node config must begin with [Controller]');
  if (sections.length < 2 || sections.length > 5)
    throw new Error('Node config must contain exactly one [Node ##] section');
  const number = nodeSectionNumber(sections[1].name);
  const hasSecurity = sections.at(-1).name === 'Cluster Security';
  if (
    sections.some(
      (section, index) =>
        section.name === 'Cluster Security' && index !== sections.length - 1
    )
  )
    throw new Error('Enrolled node config must end with [Cluster Security]');
  const middle = sections.slice(2, hasSecurity ? -1 : undefined);
  const selectedSection = middle.find(
    (section) => section.name === 'Selected Applications'
  );
  const availabilitySection = middle.find(
    (section) => section.name === 'Dependency Availability'
  );
  if (
    middle.some(
      (section) =>
        !['Selected Applications', 'Dependency Availability'].includes(
          section.name
        )
    )
  )
    throw new Error(
      `Unknown Mode 3 section [${middle.find((section) => !['Selected Applications', 'Dependency Availability'].includes(section.name)).name}]`
    );
  if (Boolean(selectedSection) !== Boolean(availabilitySection))
    throw new Error(
      'Node selected applications and dependency availability sections must be supplied together'
    );
  const controllerValues = readSection(
    sections[0],
    CONTROLLER_REFERENCE_KEYS,
    'node [Controller]'
  );
  const nodeValues = readSection(
    sections[1],
    NODE_LOCAL_KEYS,
    `node [${sections[1].name}]`
  );
  const config = {
    controller: {
      ipAddress: controllerValues['ip address'],
      port: parseDecimal(controllerValues.port, 'node controller port', 65_535),
    },
    node: {
      nodeNumber: number,
      computerName: nodeValues['computer name'],
      ipAddress: nodeValues['ip address'],
      port: parseDecimal(nodeValues.port, 'node port', 65_535),
      cpuName: nodeValues['cpu name'],
      availableThreads: parseDecimal(
        nodeValues['available threads'],
        'node available threads'
      ),
    },
    sharedAuthenticationKey: hasSecurity
      ? readSecuritySection(
          document,
          sections.at(-1),
          'node [Cluster Security]'
        )
      : null,
  };
  if (selectedSection)
    Object.assign(config, {
      selectedApplications: parseApplicationEntriesSection(selectedSection, {
        includeProfilePath: false,
        label: 'node [Selected Applications]',
      }),
      dependencyAvailability: parseDependenciesSection(availabilitySection),
    });
  return createNodeConfig(config);
}

export function parseApplicationDependencyProfile(text) {
  const document = parseDocument(text, 'Application dependency profile');
  if (
    document.sections.length !== 1 ||
    document.sections[0].name !== 'Dependencies'
  )
    throw new Error(
      'Application dependency profile must contain exactly one [Dependencies] section'
    );
  const dependencies = normalizeDependencies(
    parseDependenciesSection(document.sections[0]),
    'Application dependency profile'
  );
  if (dependencies.length === 0)
    throw new Error('Application dependency profile cannot be empty');
  return deepFreeze(dependencies);
}

function machineLines(machine, { includeGithubUsername = false } = {}) {
  const lines = [];
  if (includeGithubUsername)
    lines.push(`github username = ${machine.githubUsername}`);
  lines.push(
    `computer name = ${machine.computerName}`,
    `ip address = ${machine.ipAddress}`,
    `port = ${machine.port}`,
    `cpu name = ${machine.cpuName}`,
    `available threads = ${machine.availableThreads}`
  );
  if (machine.threads === null)
    lines.push(
      '# Configure Controller must assign threads and minimum thread count before scheduling.'
    );
  else
    lines.push(
      `threads = ${machine.threads}`,
      `minimum thread count = ${machine.minimumThreadCount}`
    );
  return lines;
}

function supportedApplicationLines(application) {
  return [
    `${application.entryId} application id = ${application.applicationId}`,
    `${application.entryId} name = ${application.name}`,
    `${application.entryId} profile path = ${application.profilePath}`,
  ];
}

function selectedApplicationLines(application) {
  return [
    `${application.entryId} application id = ${application.applicationId}`,
    `${application.entryId} name = ${application.name}`,
  ];
}

function dependencyLines(dependencies) {
  return dependencies.map((entry) => `${entry.name} = ${entry.version}`);
}

export function serializeControllerConfig(value) {
  const config = createControllerConfig(value);
  const lines = [
    ...CONTROLLER_HEADER,
    '',
    '[Global Settings]',
    ...machineLines(config.global, { includeGithubUsername: true }),
  ];
  if (Object.hasOwn(config, 'supportedApplications')) {
    lines.push('', '[Supported Applications]');
    for (const application of config.supportedApplications)
      lines.push(...supportedApplicationLines(application));
    for (const requirements of config.applicationRequirements)
      lines.push(
        '',
        `[Application ${requirements.applicationId} Requirements]`,
        ...dependencyLines(requirements.dependencies)
      );
  }
  for (const node of config.nodes)
    lines.push('', `[Node ${node.nodeNumber}]`, ...machineLines(node));
  for (const availability of config.nodeDependencyAvailability ?? [])
    lines.push(
      '',
      `[Node ${availability.nodeNumber} Dependency Availability]`,
      ...dependencyLines(availability.dependencies)
    );
  lines.push(
    '',
    '[Cluster Security]',
    `shared authentication key = ${config.sharedAuthenticationKey}`
  );
  return `${lines.join('\n')}\n`;
}

export function serializeNodeConfig(value) {
  const config = createNodeConfig(value);
  const lines = [
    ...NODE_HEADER,
    '',
    '[Controller]',
    `ip address = ${config.controller.ipAddress}`,
    `port = ${config.controller.port}`,
    '',
    `[Node ${config.node.nodeNumber}]`,
    `computer name = ${config.node.computerName}`,
    `ip address = ${config.node.ipAddress}`,
    `port = ${config.node.port}`,
    `cpu name = ${config.node.cpuName}`,
    `available threads = ${config.node.availableThreads}`,
  ];
  if (Object.hasOwn(config, 'selectedApplications')) {
    lines.push('', '[Selected Applications]');
    for (const application of config.selectedApplications)
      lines.push(...selectedApplicationLines(application));
    lines.push(
      '',
      '[Dependency Availability]',
      ...dependencyLines(config.dependencyAvailability)
    );
  }
  if (config.sharedAuthenticationKey !== null)
    lines.push(
      '',
      '[Cluster Security]',
      `shared authentication key = ${config.sharedAuthenticationKey}`
    );
  return `${lines.join('\n')}\n`;
}

function parsedThreadExpression(value) {
  const expression = canonicalThreadExpression(value);
  if (!expression.includes('n'))
    return { coefficient: 0n, offset: BigInt(expression) };
  const match = expression.match(
    /^(?<coefficient>[0-9]+)?n(?:(?<operator>[+-])(?<offset>[0-9]+))?$/
  );
  const coefficient = BigInt(match.groups.coefficient ?? '1');
  const magnitude = BigInt(match.groups.offset ?? '0');
  return {
    coefficient,
    offset: match.groups.operator === '-' ? -magnitude : magnitude,
  };
}

export function evaluateThreadExpression(
  expression,
  availableThreads,
  minimumThreadCount
) {
  const available = positiveInteger(availableThreads, 'Available threads');
  const minimum = positiveInteger(
    minimumThreadCount,
    'Minimum thread count',
    MAX_MODE3_THREADS
  );
  const parsed = parsedThreadExpression(expression);
  const calculated = parsed.coefficient * BigInt(available) + parsed.offset;
  const boundedBelow =
    calculated < BigInt(minimum) ? BigInt(minimum) : calculated;
  const bounded =
    boundedBelow > BigInt(MAX_MODE3_THREADS)
      ? BigInt(MAX_MODE3_THREADS)
      : boundedBelow;
  return Number(bounded);
}

export function generateSharedAuthenticationKey() {
  return randomBytes(32).toString('hex');
}

export function controllerConfigFilename(value) {
  return `test-suite-multi-computer-${githubUsername(value)}.cfg`;
}

export function nodeConfigFilename(value) {
  return `test-suite-multi-computer-node-${nodeNumber(value)}.cfg`;
}

export function githubUsernameFromControllerConfigFilename(value) {
  exactText(value, 'controller config filename', 128);
  const match = value.match(/^test-suite-multi-computer-(.+)\.cfg$/);
  if (!match) throw new Error('Controller config filename is invalid');
  return githubUsername(match[1]);
}

export function nodeNumberFromConfigFilename(value) {
  exactText(value, 'node config filename', 128);
  const match = value.match(/^test-suite-multi-computer-node-(\d{2})\.cfg$/);
  if (!match) throw new Error('Node config filename is invalid');
  return nodeNumber(match[1]);
}

function absoluteConfigPath(value, label) {
  exactText(value, label, 4096);
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute`);
  return value;
}

function sameFileObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertPrivateFileMode(metadata, label) {
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600)
    throw new Error(`${label} must use file mode 0600`);
}

function existingPrivateConfigMetadata(configPath, label) {
  const metadata = lstatSync(configPath);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
  if (metadata.size > MAX_MODE3_CONFIG_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  assertPrivateFileMode(metadata, label);
  return metadata;
}

function readPrivateConfigText(configPath, label) {
  const before = existingPrivateConfigMetadata(configPath, label);
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(configPath, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!sameFileObject(before, opened))
      throw new Error(`${label} changed while it was being opened`);
    if (!opened.isFile() || opened.size > MAX_MODE3_CONFIG_BYTES)
      throw new Error(`${label} is not a safe ordinary file`);
    assertPrivateFileMode(opened, label);
    const text = readFileSync(descriptor, 'utf8');
    const after = fstatSync(descriptor);
    if (
      !sameFileObject(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs
    )
      throw new Error(`${label} changed while it was being read`);
    const current = lstatSync(configPath);
    if (!sameFileObject(opened, current))
      throw new Error(`${label} was replaced while it was being read`);
    return text;
  } finally {
    closeSync(descriptor);
  }
}

export function readApplicationDependencyProfileFile(profilePathValue) {
  const profilePath = dependencyProfilePath(profilePathValue);
  const label = 'Application dependency profile';
  const before = lstatSync(profilePath);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
  if (before.size > MAX_MODE3_CONFIG_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(profilePath, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!sameFileObject(before, opened))
      throw new Error(`${label} changed while it was being opened`);
    if (!opened.isFile() || opened.size > MAX_MODE3_CONFIG_BYTES)
      throw new Error(`${label} is not a safe ordinary file`);
    const text = readFileSync(descriptor, 'utf8');
    const after = fstatSync(descriptor);
    if (
      !sameFileObject(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs
    )
      throw new Error(`${label} changed while it was being read`);
    const current = lstatSync(profilePath);
    if (!sameFileObject(opened, current))
      throw new Error(`${label} was replaced while it was being read`);
    return parseApplicationDependencyProfile(text);
  } finally {
    closeSync(descriptor);
  }
}

function assertControllerConfigPath(configPath, config) {
  const expected = controllerConfigFilename(config.global.githubUsername);
  if (basename(configPath) !== expected)
    throw new Error(`Controller config filename must be ${expected}`);
}

function assertNodeConfigPath(configPath, config) {
  const expected = nodeConfigFilename(config.node.nodeNumber);
  if (basename(configPath) !== expected)
    throw new Error(`Node config filename must be ${expected}`);
}

function syncParentDirectory(configPath) {
  if (process.platform === 'win32') return;
  const directoryDescriptor = openSync(
    dirname(configPath),
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
  );
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function removeOwnedTemporaryFile(targetPath, identity, label) {
  let current;
  try {
    current = lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!sameFileObject(identity, current))
    throw new Error(`${label} ownership changed before cleanup`);
  unlinkSync(targetPath);
}

function atomicWritePrivateConfig(configPath, text, label) {
  if (Buffer.byteLength(text, 'utf8') > MAX_MODE3_CONFIG_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  const temporaryPath = join(
    dirname(configPath),
    `.${basename(configPath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
  );
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let descriptor = null;
  let temporaryIdentity = null;
  let renamed = false;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    );
    temporaryIdentity = fstatSync(descriptor);
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, text, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    renameSync(temporaryPath, configPath);
    renamed = true;
    chmodSync(configPath, 0o600);
    syncParentDirectory(configPath);
    const readBack = readPrivateConfigText(configPath, label);
    if (readBack !== text)
      throw new Error(`${label} atomic write failed exact readback`);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!renamed && temporaryIdentity)
      removeOwnedTemporaryFile(
        temporaryPath,
        temporaryIdentity,
        `${label} temporary file`
      );
  }
}

function withConfigFileLock(configPath, label, operation) {
  const lockPath = `${configPath}.lock`;
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    );
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error(`${label} is already being updated`, { cause: error });
    throw error;
  }
  let lockIdentity = null;
  let result;
  let failure = null;
  try {
    lockIdentity = fstatSync(descriptor);
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    fsyncSync(descriptor);
    result = operation();
  } catch (error) {
    failure = error;
  }

  try {
    closeSync(descriptor);
    if (lockIdentity)
      removeOwnedTemporaryFile(lockPath, lockIdentity, `${label} lock`);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return result;
}

export function readControllerConfigFile(configPathValue) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  const config = parseControllerConfig(
    readPrivateConfigText(configPath, 'Controller config')
  );
  assertControllerConfigPath(configPath, config);
  return config;
}

export function readNodeConfigFile(configPathValue) {
  const configPath = absoluteConfigPath(configPathValue, 'Node config path');
  const config = parseNodeConfig(
    readPrivateConfigText(configPath, 'Node config')
  );
  assertNodeConfigPath(configPath, config);
  return config;
}

export function persistControllerConfigFile(configPathValue, value) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  const config = createControllerConfig(value);
  assertControllerConfigPath(configPath, config);
  return withConfigFileLock(configPath, 'Controller config', () => {
    atomicWritePrivateConfig(
      configPath,
      serializeControllerConfig(config),
      'Controller config'
    );
    return config;
  });
}

export function persistNodeConfigFile(configPathValue, value) {
  const configPath = absoluteConfigPath(configPathValue, 'Node config path');
  const config = createNodeConfig(value);
  assertNodeConfigPath(configPath, config);
  return withConfigFileLock(configPath, 'Node config', () => {
    atomicWritePrivateConfig(
      configPath,
      serializeNodeConfig(config),
      'Node config'
    );
    return config;
  });
}

export function addSupportedApplicationToControllerConfigFile(
  configPathValue,
  applicationValue
) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  exactKeys(
    applicationValue,
    ['applicationId', 'name', 'profilePath'],
    'supported application input'
  );
  const dependencies = readApplicationDependencyProfileFile(
    applicationValue.profilePath
  );
  return withConfigFileLock(configPath, 'Controller config', () => {
    const current = readControllerConfigFile(configPath);
    const outcome = addSupportedApplication(current, {
      ...applicationValue,
      dependencies,
    });
    atomicWritePrivateConfig(
      configPath,
      serializeControllerConfig(outcome.controllerConfig),
      'Controller config'
    );
    return outcome.application;
  });
}

export function deleteSupportedApplicationFromControllerConfigFile(
  configPathValue,
  entryIdValue
) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  return withConfigFileLock(configPath, 'Controller config', () => {
    const current = readControllerConfigFile(configPath);
    const outcome = deleteSupportedApplication(current, entryIdValue);
    atomicWritePrivateConfig(
      configPath,
      serializeControllerConfig(outcome.controllerConfig),
      'Controller config'
    );
    return outcome.application;
  });
}

export function setControllerNodeThreadPolicyInFile(
  configPathValue,
  policyValue
) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  return withConfigFileLock(configPath, 'Controller config', () => {
    const current = readControllerConfigFile(configPath);
    const updated = setControllerNodeThreadPolicy(current, policyValue);
    atomicWritePrivateConfig(
      configPath,
      serializeControllerConfig(updated),
      'Controller config'
    );
    return updated.nodes.find(
      (node) => node.nodeNumber === policyValue.nodeNumber
    );
  });
}

export function enrollNodeInControllerConfigFile(
  configPathValue,
  requestValue
) {
  const configPath = absoluteConfigPath(
    configPathValue,
    'Controller config path'
  );
  const request = createNodeEnrollmentRequest(requestValue);
  return withConfigFileLock(configPath, 'Controller config', () => {
    const controllerConfig = readControllerConfigFile(configPath);
    const outcome = applyNodeEnrollmentRequest(controllerConfig, request);
    if (outcome.response.status === 'accepted')
      atomicWritePrivateConfig(
        configPath,
        serializeControllerConfig(outcome.controllerConfig),
        'Controller config'
      );
    return outcome.response;
  });
}

export function persistAcceptedNodeEnrollmentResponse(
  configPathValue,
  responseValue
) {
  const configPath = absoluteConfigPath(configPathValue, 'Node config path');
  const response = createNodeEnrollmentResponse(responseValue);
  if (response.status !== 'accepted')
    throw new Error('A conflicting enrollment response cannot be persisted');
  return withConfigFileLock(configPath, 'Node config', () => {
    const nodeConfig = readNodeConfigFile(configPath);
    const enrolled = applyNodeEnrollmentResponse(nodeConfig, response);
    atomicWritePrivateConfig(
      configPath,
      serializeNodeConfig(enrolled),
      'Node config'
    );
    return enrolled;
  });
}
