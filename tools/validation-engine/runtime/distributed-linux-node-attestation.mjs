// Copyright (c) snapetech and SeerrNG contributors.
// Exact local runtime closure reported by a Linux Mode 3 node.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeNodeConfig } from './distributed-linux-config.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA =
  'seerrng-distributed-linux-node-attestation/v1';
export const DISTRIBUTED_LINUX_RUNNER_CLOSURE_SCHEMA =
  'seerrng-distributed-linux-runner-closure/v1';

const HASH64 = /^[a-f0-9]{64}$/;
const RUNTIME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NODE_VERSION =
  /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const NODE_ARCHITECTURES = new Set([
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc',
  'ppc64',
  'riscv64',
  's390',
  's390x',
  'x64',
]);
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(
  new URL('../../../', import.meta.url)
);
const RUNNER_ENTRY_FILES = Object.freeze([
  'bin/local-validation.mjs',
  'bin/platform-tools.mjs',
  'bin/run-local-validation.mjs',
]);
const RUNTIME_DIRECTORY = 'tools/validation-engine/runtime';
const READ_BUFFER_BYTES = 1024 * 1024;

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

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function runtimeToken(value, label) {
  if (typeof value !== 'string' || !RUNTIME_TOKEN.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function hashOrdinaryFile(filePath, label) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`${label} must be an ordinary nonsymlink file`);
  const noFollow =
    process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened))
      throw new Error(`${label} changed while being opened`);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let position = 0;
    while (position < opened.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position
      );
      if (bytesRead === 0) throw new Error(`${label} changed while being read`);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const closedOver = await handle.stat();
    const after = await lstat(filePath);
    if (!sameFile(opened, closedOver) || !sameFile(opened, after))
      throw new Error(`${label} changed while being read`);
    return Object.freeze({ bytes: opened.size, sha256: hash.digest('hex') });
  } finally {
    await handle.close();
  }
}

function posixRelative(repositoryRoot, filePath) {
  const value = relative(repositoryRoot, filePath).split(sep).join('/');
  if (
    !value ||
    value.startsWith('../') ||
    value === '..' ||
    value.startsWith('/')
  )
    throw new Error('Runner closure file escaped the repository root');
  return value;
}

async function runtimeModuleRelativePaths(runtimeRoot) {
  const entries = await readdir(runtimeRoot, { withFileTypes: true });
  const relativePaths = entries
    .filter((entry) => entry.name.endsWith('.mjs'))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(
          'Runner closure modules must be ordinary nonsymlink files'
        );
      return `${RUNTIME_DIRECTORY}/${entry.name}`;
    })
    .toSorted(compareText);
  if (relativePaths.length === 0)
    throw new Error('Runner closure requires runtime modules');
  return relativePaths;
}

async function runnerClosurePaths(repositoryRootValue) {
  const repositoryRoot = resolve(repositoryRootValue);
  const runtimeRoot = join(repositoryRoot, ...RUNTIME_DIRECTORY.split('/'));
  const runtimeFiles = await runtimeModuleRelativePaths(runtimeRoot);
  return {
    repositoryRoot,
    runtimeRoot,
    runtimeFiles,
    relativePaths: [...RUNNER_ENTRY_FILES, ...runtimeFiles].toSorted(
      compareText
    ),
  };
}

export async function computeDistributedLinuxRunnerClosureSha256({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
} = {}) {
  const closure = await runnerClosurePaths(repositoryRoot);
  const files = [];
  for (const relativePath of closure.relativePaths) {
    const filePath = join(closure.repositoryRoot, ...relativePath.split('/'));
    const facts = await hashOrdinaryFile(filePath, 'Runner closure file');
    files.push({
      relativePath: posixRelative(closure.repositoryRoot, filePath),
      bytes: facts.bytes,
      sha256: facts.sha256,
    });
  }
  const runtimeFilesAfterRead = await runtimeModuleRelativePaths(
    closure.runtimeRoot
  );
  if (
    runtimeFilesAfterRead.length !== closure.runtimeFiles.length ||
    runtimeFilesAfterRead.some(
      (relativePath, index) => relativePath !== closure.runtimeFiles[index]
    )
  )
    throw new Error('Runner closure changed while being attested');
  return canonicalJsonSha256({
    schema: DISTRIBUTED_LINUX_RUNNER_CLOSURE_SCHEMA,
    files,
  });
}

export function verifyDistributedLinuxNodeAttestation(value) {
  exactKeys(
    value,
    [
      'activeNodeConfigSha256',
      'architecture',
      'attestationSha256',
      'nodeExecutableSha256',
      'nodeVersion',
      'platform',
      'runnerClosureSha256',
      'schema',
    ],
    'Linux node runtime attestation'
  );
  if (value.schema !== DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA)
    throw new Error(
      'Linux node runtime attestation uses an unsupported schema'
    );
  const core = {
    schema: value.schema,
    activeNodeConfigSha256: digest(
      value.activeNodeConfigSha256,
      'Active Linux node config identity'
    ),
    runnerClosureSha256: digest(
      value.runnerClosureSha256,
      'Linux node runner closure identity'
    ),
    nodeExecutableSha256: digest(
      value.nodeExecutableSha256,
      'Linux node executable identity'
    ),
    nodeVersion: runtimeToken(value.nodeVersion, 'Linux node version'),
    platform: runtimeToken(value.platform, 'Linux node platform'),
    architecture: runtimeToken(value.architecture, 'Linux node architecture'),
  };
  if (!NODE_VERSION.test(core.nodeVersion))
    throw new Error('Linux node version is invalid');
  if (core.platform !== 'linux')
    throw new Error('Linux node platform must be linux');
  if (!NODE_ARCHITECTURES.has(core.architecture))
    throw new Error('Linux node architecture is unsupported');
  if (
    digest(value.attestationSha256, 'Linux node attestation identity') !==
    canonicalJsonSha256(core)
  )
    throw new Error('Linux node runtime attestation seal is invalid');
  return deepFreeze({ ...core, attestationSha256: value.attestationSha256 });
}

export async function createDistributedLinuxNodeAttestation(
  nodeConfig,
  {
    repositoryRoot = DEFAULT_REPOSITORY_ROOT,
    executablePath = process.execPath,
    nodeVersion = process.version,
    platform = process.platform,
    architecture = process.arch,
  } = {}
) {
  const activeNodeConfigSha256 = createHash('sha256')
    .update(serializeNodeConfig(nodeConfig), 'utf8')
    .digest('hex');
  const runnerClosureSha256 = await computeDistributedLinuxRunnerClosureSha256({
    repositoryRoot,
  });
  const executableTarget = await realpath(executablePath);
  const nodeExecutable = await hashOrdinaryFile(
    executableTarget,
    'Linux node executable'
  );
  const core = {
    schema: DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA,
    activeNodeConfigSha256,
    runnerClosureSha256,
    nodeExecutableSha256: nodeExecutable.sha256,
    nodeVersion: runtimeToken(nodeVersion, 'Linux node version'),
    platform: runtimeToken(platform, 'Linux node platform'),
    architecture: runtimeToken(architecture, 'Linux node architecture'),
  };
  return verifyDistributedLinuxNodeAttestation({
    ...core,
    attestationSha256: canonicalJsonSha256(core),
  });
}
