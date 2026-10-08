// Copyright (c) snapetech and SeerrNG contributors.
// Linux configuration lifecycle for Mode 3 controllers and nodes.
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
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import {
  applyNodeEnrollmentResponse,
  createControllerConfig,
  createNodeConfig,
  generateSharedAuthenticationKey,
  githubUsernameFromControllerConfigFilename,
  nodeNumberFromConfigFilename,
  persistControllerConfigFile,
  persistNodeConfigFile,
  readControllerConfigFile,
  readNodeConfigFile,
} from './distributed-linux-config.mjs';
import { detectLinuxHostProfile } from './distributed-linux-host-profile.mjs';

const MAX_ACTIVE_CONFIG_MARKER_BYTES = 4097;
const CONTROLLER_OPERATOR_KEYS = [
  'githubUsername',
  'computerName',
  'ipAddress',
  'port',
  'threads',
  'minimumThreadCount',
];
const CONTROLLER_REFERENCE_KEYS = ['ipAddress', 'port'];
const NODE_OPERATOR_KEYS = ['nodeNumber', 'computerName', 'ipAddress', 'port'];

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
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function canonicalAbsolutePath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    value.trim() !== value ||
    // eslint-disable-next-line no-control-regex -- Paths cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(value) ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    !basename(value)
  )
    throw new Error(`${label} must be an absolute canonical file path`);
  return value;
}

function lstatOrNull(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertOrdinaryFile(metadata, label) {
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
}

function assertPrivateMode(metadata, label) {
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600)
    throw new Error(`${label} must use file mode 0600`);
}

function removeOwnedFile(filePath, identity, label) {
  const current = lstatOrNull(filePath);
  if (!current) return;
  if (!sameFile(identity, current))
    throw new Error(`${label} ownership changed before cleanup`);
  unlinkSync(filePath);
}

function claimNewConfigPath(configPath, label) {
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(
      configPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600
    );
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error(
        `${label} already exists; allowExistingUpdate is required`,
        { cause: error }
      );
    throw error;
  }
  try {
    if (process.platform !== 'win32') fchmodSync(descriptor, 0o600);
    return fstatSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function persistConfig({
  configPath,
  allowExistingUpdate,
  label,
  value,
  persist,
}) {
  exactBoolean(allowExistingUpdate, 'allowExistingUpdate');
  const existing = lstatOrNull(configPath);
  if (existing) {
    assertOrdinaryFile(existing, label);
    if (!allowExistingUpdate)
      throw new Error(
        `${label} already exists; allowExistingUpdate is required`
      );
    return persist(configPath, value);
  }

  const claim = claimNewConfigPath(configPath, label);
  try {
    return persist(configPath, value);
  } catch (error) {
    try {
      removeOwnedFile(configPath, claim, `${label} claim`);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${label} failed and its new-file claim could not be cleaned up`,
        { cause: cleanupError }
      );
    }
    throw error;
  }
}

function syncParentDirectory(filePath) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(
    dirname(filePath),
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readActiveConfigMarkerText(markerPath) {
  const before = lstatSync(markerPath);
  assertOrdinaryFile(before, 'Active config marker');
  assertPrivateMode(before, 'Active config marker');
  if (before.size > MAX_ACTIVE_CONFIG_MARKER_BYTES)
    throw new Error('Active config marker exceeds its safe size limit');

  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(markerPath, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!sameFile(before, opened))
      throw new Error('Active config marker changed while it was opened');
    assertOrdinaryFile(opened, 'Active config marker');
    assertPrivateMode(opened, 'Active config marker');
    if (opened.size > MAX_ACTIVE_CONFIG_MARKER_BYTES)
      throw new Error('Active config marker exceeds its safe size limit');
    const text = readFileSync(descriptor, 'utf8');
    const after = fstatSync(descriptor);
    if (
      !sameFile(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs
    )
      throw new Error('Active config marker changed while it was read');
    const current = lstatSync(markerPath);
    if (!sameFile(opened, current))
      throw new Error('Active config marker was replaced while it was read');
    return text;
  } finally {
    closeSync(descriptor);
  }
}

function writeActiveConfigMarker(markerPathValue, configPathValue) {
  const markerPath = canonicalAbsolutePath(
    markerPathValue,
    'Active config marker path'
  );
  const configPath = canonicalAbsolutePath(configPathValue, 'Config path');
  if (markerPath === configPath)
    throw new Error('Active config marker path must differ from config path');
  const existing = lstatOrNull(markerPath);
  if (existing) assertOrdinaryFile(existing, 'Active config marker');

  const text = `${configPath}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_ACTIVE_CONFIG_MARKER_BYTES)
    throw new Error('Active config marker exceeds its safe size limit');
  const temporaryPath = join(
    dirname(markerPath),
    `.${basename(markerPath)}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`
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
    renameSync(temporaryPath, markerPath);
    renamed = true;
    chmodSync(markerPath, 0o600);
    syncParentDirectory(markerPath);
    if (readActiveConfigMarkerText(markerPath) !== text)
      throw new Error('Active config marker failed exact readback');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!renamed && temporaryIdentity)
      removeOwnedFile(
        temporaryPath,
        temporaryIdentity,
        'Active config marker temporary file'
      );
  }
}

function activeConfigPathFromMarker(markerPathValue) {
  const markerPath = canonicalAbsolutePath(
    markerPathValue,
    'Active config marker path'
  );
  const text = readActiveConfigMarkerText(markerPath);
  const match = text.match(/^([^\r\n]+)\n$/);
  if (!match)
    throw new Error(
      'Active config marker must contain exactly one absolute config path and a newline'
    );
  return canonicalAbsolutePath(match[1], 'Active config path');
}

function detectedProfile(hostProfileOptions) {
  return hostProfileOptions === undefined
    ? detectLinuxHostProfile()
    : detectLinuxHostProfile(hostProfileOptions);
}

export function configureLinuxController({
  configPath: configPathValue,
  activeConfigMarkerPath: markerPathValue,
  operator,
  allowExistingUpdate = false,
  hostProfileOptions,
}) {
  const configPath = canonicalAbsolutePath(
    configPathValue,
    'Controller config path'
  );
  const markerPath = canonicalAbsolutePath(
    markerPathValue,
    'Active config marker path'
  );
  exactKeys(operator, CONTROLLER_OPERATOR_KEYS, 'controller operator settings');
  exactBoolean(allowExistingUpdate, 'allowExistingUpdate');

  const existingMetadata = lstatOrNull(configPath);
  let existing = null;
  if (existingMetadata) {
    assertOrdinaryFile(existingMetadata, 'Controller config');
    if (!allowExistingUpdate)
      throw new Error(
        'Controller config already exists; allowExistingUpdate is required'
      );
    existing = readControllerConfigFile(configPath);
  }

  const profile = detectedProfile(hostProfileOptions);
  const configValue = {
    global: {
      ...operator,
      cpuName: profile.cpuName,
      availableThreads: profile.availableThreads,
    },
    nodes: existing?.nodes ?? [],
    sharedAuthenticationKey:
      existing?.sharedAuthenticationKey ?? generateSharedAuthenticationKey(),
  };
  if (existing && Object.hasOwn(existing, 'supportedApplications'))
    Object.assign(configValue, {
      supportedApplications: existing.supportedApplications,
      applicationRequirements: existing.applicationRequirements,
      nodeDependencyAvailability: existing.nodeDependencyAvailability,
    });
  const config = createControllerConfig(configValue);
  const persisted = persistConfig({
    configPath,
    allowExistingUpdate,
    label: 'Controller config',
    value: config,
    persist: persistControllerConfigFile,
  });
  writeActiveConfigMarker(markerPath, configPath);
  return persisted;
}

export function createPendingLinuxNode({
  configPath: configPathValue,
  controller,
  node,
  allowExistingUpdate = false,
  hostProfileOptions,
}) {
  const configPath = canonicalAbsolutePath(configPathValue, 'Node config path');
  exactKeys(controller, CONTROLLER_REFERENCE_KEYS, 'node controller settings');
  exactKeys(node, NODE_OPERATOR_KEYS, 'node operator settings');
  exactBoolean(allowExistingUpdate, 'allowExistingUpdate');
  const existingMetadata = lstatOrNull(configPath);
  let existingConfig = null;
  if (existingMetadata) {
    assertOrdinaryFile(existingMetadata, 'Node config');
    if (!allowExistingUpdate)
      throw new Error(
        'Node config already exists; allowExistingUpdate is required'
      );
    existingConfig = readNodeConfigFile(configPath);
  }
  const profile = detectedProfile(hostProfileOptions);
  const configValue = {
    controller,
    node: {
      ...node,
      cpuName: profile.cpuName,
      availableThreads: profile.availableThreads,
    },
    sharedAuthenticationKey: null,
  };
  if (existingConfig && Object.hasOwn(existingConfig, 'selectedApplications'))
    Object.assign(configValue, {
      selectedApplications: existingConfig.selectedApplications,
      dependencyAvailability: existingConfig.dependencyAvailability,
    });
  const config = createNodeConfig(configValue);
  if (
    nodeNumberFromConfigFilename(basename(configPath)) !==
    config.node.nodeNumber
  )
    throw new Error('Node config filename does not match its node number');
  return config;
}

export function activateAcceptedLinuxNodeEnrollment({
  configPath: configPathValue,
  activeConfigMarkerPath: markerPathValue,
  pendingConfig,
  allowExistingUpdate = false,
  response,
}) {
  const configPath = canonicalAbsolutePath(configPathValue, 'Node config path');
  const markerPath = canonicalAbsolutePath(
    markerPathValue,
    'Active config marker path'
  );
  exactBoolean(allowExistingUpdate, 'allowExistingUpdate');
  const pending = createNodeConfig(pendingConfig);
  if (
    nodeNumberFromConfigFilename(basename(configPath)) !==
    pending.node.nodeNumber
  )
    throw new Error('Node config filename does not match its node number');
  const enrolled = applyNodeEnrollmentResponse(pending, response);
  const persisted = persistConfig({
    configPath,
    allowExistingUpdate,
    label: 'Node config',
    value: enrolled,
    persist: persistNodeConfigFile,
  });
  writeActiveConfigMarker(markerPath, configPath);
  return persisted;
}

export function resolveActiveLinuxConfig(
  activeConfigMarkerPath,
  { expectedRole = null } = {}
) {
  if (![null, 'controller', 'node'].includes(expectedRole))
    throw new Error('Expected active config role must be controller or node');
  const configPath = activeConfigPathFromMarker(activeConfigMarkerPath);
  const filename = basename(configPath);

  let role;
  let config;
  if (/^test-suite-multi-computer-node-\d{2}\.cfg$/.test(filename)) {
    nodeNumberFromConfigFilename(filename);
    role = 'node';
    config = readNodeConfigFile(configPath);
    if (config.sharedAuthenticationKey === null)
      throw new Error('Active node config has not completed enrollment');
  } else {
    githubUsernameFromControllerConfigFilename(filename);
    role = 'controller';
    config = readControllerConfigFile(configPath);
  }
  if (expectedRole !== null && role !== expectedRole)
    throw new Error(`Active config role is ${role}, not ${expectedRole}`);
  return Object.freeze({ configPath, role, config });
}
