// Copyright (c) snapetech and SeerrNG contributors.
// Engine-owned outer/inner production lifecycle for Linux Mode 3 validation.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine modules share the repository-owned process runner.
import { runCommand } from '../../../bin/local-validation.mjs';
import {
  createRequiredWorkerCapacityProof,
  detectOperatorGithubLogin,
  normalizeRequiredWorkerCapacityProof,
} from './cpu-capacity.mjs';
import {
  persistAdaptiveTimingProfileFile,
  readAdaptiveTimingProfileFile,
} from './distributed-adaptive-timing-profile-store.mjs';
import {
  createSupportedApplicationListing,
  serializeControllerConfig,
} from './distributed-linux-config.mjs';
import { createDistributedLinuxHostAdapters } from './distributed-linux-host-adapters.mjs';
import {
  createDistributedLinuxHostContainment,
  createDistributedLinuxHostContainmentCallbacks,
  createDistributedLinuxProofParentConfig,
  createDistributedLinuxProofSocketAdapter,
  DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
  DISTRIBUTED_LINUX_HOST_FINAL_MARKER,
  DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA,
} from './distributed-linux-host-containment.mjs';
import {
  completeDistributedLinuxHostPreparation,
  DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
  distributedLinuxPrettyJsonBytes,
  distributedLinuxRawSha256,
  normalizeDistributedLinuxHostPreparationSeal,
} from './distributed-linux-host-preparation.mjs';
import { resolveActiveLinuxConfig } from './distributed-linux-management.mjs';
import { executeDistributedLinuxProductionRun } from './distributed-linux-production-runner.mjs';
import {
  createOwnedSourceSnapshot,
  disposeSourceSnapshot,
  findNativeExecutable,
  prepareMode3DependencyMountpoint,
  verifyMode3DependencyMountpoint,
  verifySourceSnapshot,
} from './native-stage-context.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_LINUX_HOST_PROFILE_FILE =
  'distributed-linux-host-profile.json';
export const DISTRIBUTED_LINUX_TIMING_PROFILE_FILE =
  'distributed-adaptive-timing-profile.json';
export const DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA =
  'seerrng-distributed-linux-contained-request/v2';
export const DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA =
  'seerrng-distributed-linux-host-profile/v1';

const PUBLIC_REQUEST_KEYS = Object.freeze([
  'activeConfigMarkerPath',
  'applicationEntryId',
  'logRoot',
  'runId',
  'runtimeApplicationKey',
  'signal',
  'sourceRoot',
  'stateRoot',
]);
const CONTAINED_REQUEST_KEYS = Object.freeze([
  'activeConfigMarkerPath',
  'applicationEntryId',
  'evidenceDirectory',
  'hostPreparation',
  'manifestPath',
  'operatorGithubLogin',
  'reviewBaseCommit',
  'requiredCapacityProof',
  'runId',
  'runtimeApplicationKey',
  'schema',
  'sourceRoot',
  'timingProfilePath',
  'timingProfileSeedPath',
]);
const HASH40 = /^[a-f0-9]{40}$/u;
const HASH64 = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROFILE_KEYS = Object.freeze([
  'images',
  'network',
  'resources',
  'schema',
  'volumes',
]);
const CONTAINED_REQUEST_SHA256_ENV = 'SEERR_MODE3_CONTAINED_REQUEST_SHA256';
const CONTAINER = Object.freeze({
  activeMarker: '/config/active-controller',
  candidate: '/app',
  config: '/config',
  configFile: '/config/controller.cfg',
  containedRequest: '/config/contained-request.json',
  gitEvidence: '/config/authenticated-git-closure.json',
  logRoot: '/run-logs',
  manifest: '/config/containment-manifest.json',
  proofConfig: '/config/proof-parent.json',
  proofParent: '/recipes/mode3-proof-parent.py',
  stateRoot: '/run-state',
  engineBin: '/run-state/engine-bin',
  timingProfile: '/run-state/adaptive-timing-profile.json',
  timingSeed: '/config/adaptive-timing-profile.json',
  tool: '/tools/prereqs',
});

const YAML_TOOL_WRAPPER_MODE = 0o500;
const YAML_TOOL_WRAPPERS = Object.freeze([
  Object.freeze({
    name: 'yamllint',
    bytes: Buffer.from(
      '#!/bin/sh\n# Relocated, read-only prerequisite venv: no global Python/default changes.\nexec /tools/prereqs/tools/python-venv/bin/python3 -m yamllint "$@"\n',
      'utf8'
    ),
  }),
  Object.freeze({
    name: 'yamale',
    bytes: Buffer.from(
      '#!/bin/sh\n# Relocated, read-only prerequisite venv: no global Python/default changes.\nexec /tools/prereqs/tools/python-venv/bin/python3 -m yamale.command_line "$@"\n',
      'utf8'
    ),
  }),
]);

export const DISTRIBUTED_LINUX_CONTAINED_ENGINE_BIN = CONTAINER.engineBin;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8');
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
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

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value).toSorted(compareText);
  const expected = [...keys].toSorted(compareText);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function text(value, label, maximum = 4096) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.normalize('NFC') !== value ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    // eslint-disable-next-line no-control-regex -- Values cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function token(value, label) {
  const result = text(value, label, 128);
  if (!TOKEN.test(result)) throw new Error(`Exact ${label} is required`);
  return result;
}

function absolutePath(value, label) {
  const result = text(value, label);
  if (!isAbsolute(result) || resolve(result) !== result)
    throw new Error(`${label} must be an absolute canonical path`);
  return result;
}

function containerAbsolutePath(value, label) {
  const result = text(value, label);
  if (
    !posix.isAbsolute(result) ||
    posix.normalize(result) !== result ||
    result.includes('\\')
  )
    throw new Error(`${label} must be an absolute canonical Linux path`);
  return result;
}

function existingDirectory(value, label) {
  const result = absolutePath(value, label);
  const metadata = lstatSync(result);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error(`${label} must be an ordinary directory`);
  return realpathSync(result);
}

function existingFile(value, label) {
  const result = absolutePath(value, label);
  const metadata = lstatSync(result);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
  return result;
}

function requireDigest(value, label, expression = HASH64) {
  if (typeof value !== 'string' || !expression.test(value))
    throw new Error(`${label} must be an exact digest`);
  return value;
}

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} is required`);
  return value;
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function readStableFile(path, label) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`${label} must be an ordinary file`);
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error(`${label} changed while it was read`);
  return bytes;
}

export function verifyDistributedLinuxOuterSuccessEvidence({
  hostResult: hostResultValue,
  markerBytes: markerBytesValue,
  outerEvidenceDirectory: outerEvidenceDirectoryValue,
  runId: runIdValue,
}) {
  const hostResult = plainObject(hostResultValue, 'outer host result');
  const markerBytes = Buffer.from(markerBytesValue);
  if (!markerBytes.length || markerBytes.length > 16 * 1_048_576)
    throw new Error('Containment success marker is empty or oversized');
  const marker = plainObject(
    parseJsonBytes(markerBytes, 'Containment success marker'),
    'containment success marker'
  );
  const runId = token(runIdValue, 'public run ID');
  if (
    hostResult.schema !== DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA ||
    hostResult.runId !== runId ||
    hostResult.status !== 'passed' ||
    hostResult.resultReuse !== false ||
    !sameJson(marker, hostResult)
  )
    throw new Error(
      'Containment success marker differs from the returned outer host result'
    );
  const outerEvidence = exactKeys(
    hostResult.outerEvidence,
    [
      ...DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES.map(
        ({ hashField }) => hashField
      ),
      'schema',
      'verified',
    ],
    'outer evidence hash proof'
  );
  if (
    outerEvidence.schema !== DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA ||
    outerEvidence.verified !== true
  )
    throw new Error('Outer evidence hash proof is incomplete');
  const outerEvidenceDirectory = existingDirectory(
    outerEvidenceDirectoryValue,
    'Outer containment evidence directory'
  );
  for (const {
    fileName,
    hashField,
  } of DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES) {
    const expected = requireDigest(
      outerEvidence[hashField],
      `Outer evidence ${fileName} hash`
    );
    const observed = sha256(
      readStableFile(
        resolve(outerEvidenceDirectory, fileName),
        `Outer evidence ${fileName}`
      )
    );
    if (observed !== expected)
      throw new Error(`Outer evidence hash differs: ${fileName}`);
  }
  return Object.freeze({
    containmentMarkerSha256: sha256(markerBytes),
    outerEvidence: Object.freeze({ ...outerEvidence }),
  });
}

function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeExclusive(path, bytesValue, mode = 0o600) {
  const bytes = Buffer.isBuffer(bytesValue)
    ? bytesValue
    : Buffer.from(bytesValue);
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    mode
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncDirectory(dirname(path));
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function writeJsonExclusive(path, value) {
  return writeExclusive(path, distributedLinuxPrettyJsonBytes(value));
}

function createDirectoryExclusive(path) {
  mkdirSync(path, { mode: 0o700 });
  syncDirectory(dirname(path));
  return path;
}

/** Materialize the two Python-module shims required by chart-testing. */
export function createDistributedLinuxContainedYamlToolWrappers(
  binDirectoryValue = CONTAINER.engineBin
) {
  const binDirectory = absolutePath(
    binDirectoryValue,
    'Contained engine tool directory'
  );
  createDirectoryExclusive(binDirectory);
  const wrappers = {};
  for (const definition of YAML_TOOL_WRAPPERS) {
    const target = resolve(binDirectory, definition.name);
    writeExclusive(target, definition.bytes, YAML_TOOL_WRAPPER_MODE);
    if (process.platform !== 'win32') {
      chmodSync(target, YAML_TOOL_WRAPPER_MODE);
      const metadata = lstatSync(target);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        (metadata.mode & 0o777) !== YAML_TOOL_WRAPPER_MODE
      )
        throw new Error(
          `Contained YAML tool wrapper mode differs: ${definition.name}`
        );
    }
    if (!readStableFile(target, definition.name).equals(definition.bytes))
      throw new Error(
        `Contained YAML tool wrapper bytes differ: ${definition.name}`
      );
    wrappers[definition.name] = target;
  }
  return Object.freeze({
    binDirectory,
    wrappers: Object.freeze(wrappers),
  });
}

function normalizePublicRequest(value) {
  exactKeys(value, PUBLIC_REQUEST_KEYS, 'distributed public request');
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal))
    throw new Error('Distributed public signal must be an AbortSignal');
  return Object.freeze({
    activeConfigMarkerPath: existingFile(
      value.activeConfigMarkerPath,
      'Active controller marker'
    ),
    applicationEntryId: text(value.applicationEntryId, 'application entry ID'),
    logRoot: existingDirectory(value.logRoot, 'Log root'),
    runId: token(value.runId, 'run ID'),
    runtimeApplicationKey: token(
      value.runtimeApplicationKey,
      'runtime application key'
    ),
    signal: value.signal,
    sourceRoot: existingDirectory(value.sourceRoot, 'Source root'),
    stateRoot: existingDirectory(value.stateRoot, 'State root'),
  });
}

function normalizeContainedRequest(value) {
  exactKeys(value, CONTAINED_REQUEST_KEYS, 'contained request');
  if (value.schema !== DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA)
    throw new Error('Unsupported contained request schema');
  return Object.freeze({
    schema: value.schema,
    activeConfigMarkerPath: containerAbsolutePath(
      value.activeConfigMarkerPath,
      'Contained active marker'
    ),
    applicationEntryId: text(value.applicationEntryId, 'application entry ID'),
    evidenceDirectory: containerAbsolutePath(
      value.evidenceDirectory,
      'Contained evidence directory'
    ),
    hostPreparation: normalizeDistributedLinuxHostPreparationSeal(
      value.hostPreparation
    ),
    manifestPath: containerAbsolutePath(
      value.manifestPath,
      'Containment manifest'
    ),
    operatorGithubLogin:
      value.operatorGithubLogin === null
        ? null
        : token(value.operatorGithubLogin, 'operator GitHub login'),
    reviewBaseCommit: requireDigest(
      value.reviewBaseCommit,
      'Review base commit',
      HASH40
    ),
    requiredCapacityProof:
      value.requiredCapacityProof === null
        ? null
        : normalizeRequiredWorkerCapacityProof(value.requiredCapacityProof),
    runId: token(value.runId, 'run ID'),
    runtimeApplicationKey: token(
      value.runtimeApplicationKey,
      'runtime application key'
    ),
    sourceRoot: containerAbsolutePath(
      value.sourceRoot,
      'Contained source root'
    ),
    timingProfilePath: containerAbsolutePath(
      value.timingProfilePath,
      'Contained timing profile'
    ),
    timingProfileSeedPath: containerAbsolutePath(
      value.timingProfileSeedPath,
      'Contained timing seed'
    ),
  });
}

export function normalizeDistributedLinuxHostProfile(value) {
  exactKeys(value, PROFILE_KEYS, 'distributed Linux host profile');
  if (value.schema !== DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA)
    throw new Error('Unsupported distributed Linux host profile schema');
  exactKeys(
    value.images,
    ['daemon', 'fixture', 'helper'],
    'host profile images'
  );
  exactKeys(
    value.volumes,
    ['dependencies', 'prerequisites'],
    'host profile volumes'
  );
  for (const [name, image] of Object.entries(value.images)) {
    plainObject(image, `${name} image`);
    if (name === 'fixture') {
      exactKeys(
        image,
        ['command', 'containerPort', 'reference'],
        'fixture image'
      );
      if (!/@sha256:[a-f0-9]{64}$/u.test(image.reference ?? ''))
        throw new Error('Fixture image must use an immutable digest');
      if (!Array.isArray(image.command) || image.command.length === 0)
        throw new Error('Fixture image command is required');
    } else {
      exactKeys(
        image,
        name === 'daemon'
          ? ['entrypoint', 'id', 'reference', 'storageDriver']
          : ['id', 'reference'],
        `${name} image`
      );
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(image.id ?? '') ||
        !(
          image.reference === image.id ||
          /@sha256:[a-f0-9]{64}$/u.test(image.reference ?? '')
        )
      )
        throw new Error(`${name} image must use an immutable identity`);
    }
  }
  for (const [name, volume] of Object.entries(value.volumes))
    text(volume, `${name} volume`);
  plainObject(value.resources, 'host profile resources');
  plainObject(value.network, 'host profile network');
  return structuredClone(value);
}

function gitCommand(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], {
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function verifyCleanSourceCheckout(sourceRoot, { git = gitCommand } = {}) {
  requiredFunction(git, 'Git command adapter');
  const sourceStatus = git(sourceRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
  if (sourceStatus.length !== 0)
    throw new Error(
      'Public Mode 3 requires a clean source checkout with no staged, unstaged, or untracked changes'
    );
  return true;
}

function parseRemoteRefs(textValue) {
  const refs = textValue
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [oid, ref, extra] = line.split('\t');
      if (extra !== undefined || !HASH40.test(oid ?? '') || !ref)
        throw new Error('Authenticated remote ref output is invalid');
      return { oid, ref };
    })
    .toSorted(({ ref: left }, { ref: right }) => compareText(left, right));
  if (
    refs.length === 0 ||
    new Set(refs.map(({ ref }) => ref)).size !== refs.length ||
    refs.filter(({ ref }) => ref === 'HEAD').length !== 1
  )
    throw new Error('Authenticated remote ref closure is incomplete');
  return refs;
}

export function fetchAuthenticatedGitState(
  sourceRoot,
  { git = gitCommand } = {}
) {
  requiredFunction(git, 'Git command adapter');
  const branch = git(sourceRoot, ['symbolic-ref', '--short', 'HEAD']).trim();
  if (!branch || /[\s~^:?*[\\\]]/u.test(branch))
    throw new Error('Current published branch name is invalid');
  const repository = git(sourceRoot, [
    'config',
    '--get',
    'remote.origin.url',
  ]).trim();
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+(?:\.git)?$/u.test(
      repository
    )
  )
    throw new Error('Authenticated Git closure requires a GitHub origin');
  const query = [
    'ls-remote',
    'origin',
    'HEAD',
    `refs/heads/${branch}`,
    'refs/tags/*',
  ];
  const beforeText = git(sourceRoot, query);
  git(sourceRoot, ['fetch', '--prune', '--tags', 'origin']);
  const afterText = git(sourceRoot, query);
  if (beforeText !== afterText)
    throw new Error('Authenticated remote refs changed during closure');
  const remoteRefs = parseRemoteRefs(afterText);
  const commit = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
  if (
    !HASH40.test(commit) ||
    remoteRefs.filter(
      ({ oid, ref }) => ref === `refs/heads/${branch}` && oid === commit
    ).length !== 1
  )
    throw new Error('Current branch HEAD is not the exact published branch');
  const tree = git(sourceRoot, ['rev-parse', 'HEAD^{tree}']).trim();
  if (!HASH40.test(tree))
    throw new Error('Current published branch tree is invalid');
  if (
    git(sourceRoot, ['rev-parse', '--is-shallow-repository']).trim() !== 'false'
  )
    throw new Error('Authenticated Git closure cannot use shallow history');
  const originTags = remoteRefs.filter(
    ({ ref }) => ref.startsWith('refs/tags/') && !ref.endsWith('^{}')
  );
  const tagRefs = originTags
    .map(({ oid, ref }) => `${ref} ${oid}`)
    .toSorted(compareText);
  if (tagRefs.length === 0)
    throw new Error('Authenticated Git closure requires complete tags');
  const localTagRefs = git(sourceRoot, ['show-ref', '--tags'])
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [oid, ref, extra] = line.split(' ');
      if (
        extra !== undefined ||
        !HASH40.test(oid ?? '') ||
        !ref?.startsWith('refs/tags/')
      )
        throw new Error('Fetched local tag output is invalid');
      return { oid, ref };
    });
  if (new Set(localTagRefs.map(({ ref }) => ref)).size !== localTagRefs.length)
    throw new Error('Fetched local tag output is invalid');
  const localTags = new Map(localTagRefs.map(({ oid, ref }) => [ref, oid]));
  if (originTags.some(({ oid, ref }) => localTags.get(ref) !== oid))
    throw new Error(
      'Fetched local tags do not contain every authenticated origin tag at its exact object ID'
    );
  verifyCleanSourceCheckout(sourceRoot, { git });
  return Object.freeze({
    branch,
    cleanSourceVerified: true,
    commit,
    remoteRefs,
    repository,
    tagRefs,
    tree,
  });
}

function authenticatedGitEvidence(gitState, candidate, cleanSourceVerified) {
  return Object.freeze({
    schema: 1,
    repository: candidate.repository,
    branch: candidate.branch,
    commit: candidate.commit,
    tree: candidate.tree,
    lockSha256: candidate.lockSha256,
    fetchedUsing: 'authenticated Git fetch --tags',
    shallow: false,
    beforeAfterRemoteRefsVerified: true,
    publishedBranchVerified: true,
    authenticatedCloneVerified: true,
    cleanSourceVerified,
    observedAt: new Date().toISOString(),
    tagCount: gitState.tagRefs.length,
    tagRefs: gitState.tagRefs,
    remoteRefs: gitState.remoteRefs,
  });
}

function rebindControllerConfig(
  configValue,
  sourceRoot,
  frozenSourceRoot = sourceRoot
) {
  const config = structuredClone(configValue);
  const listing = createSupportedApplicationListing(config);
  if (!Array.isArray(listing.applications) || listing.applications.length === 0)
    throw new Error('Controller has no supported applications');
  const source = resolve(sourceRoot);
  const frozenSource = resolve(frozenSourceRoot);
  config.supportedApplications = config.supportedApplications.map(
    (application) => {
      const configured = application.profilePath;
      let relativePath;
      if (configured.startsWith('/app/'))
        relativePath = configured.slice('/app/'.length);
      else {
        const hostPath = resolve(configured);
        relativePath = relative(source, hostPath);
        if (
          !relativePath ||
          relativePath === '..' ||
          relativePath.startsWith(`..${sep}`) ||
          isAbsolute(relativePath)
        )
          throw new Error(
            'Application dependency profile is outside the source'
          );
      }
      const normalizedRelative = relative(
        source,
        resolve(source, relativePath)
      );
      if (
        !normalizedRelative ||
        normalizedRelative === '..' ||
        normalizedRelative.startsWith(`..${sep}`) ||
        isAbsolute(normalizedRelative)
      )
        throw new Error('Application dependency profile is outside the source');
      const hostProfile = resolve(frozenSource, normalizedRelative);
      const metadata = lstatSync(hostProfile);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error(
          'Application dependency profile is not an ordinary source file'
        );
      return {
        ...application,
        profilePath: `/app/${normalizedRelative.split(sep).join('/')}`,
      };
    }
  );
  return config;
}

function outerDaemonId(adapters) {
  return adapters.docker
    .run(['info', '--format', '{{json .ID}}'], { id: 'outer-daemon-profile' })
    .then((receipt) => {
      if (receipt.status !== 'passed' || receipt.exitCode !== 0)
        throw new Error('Outer Docker daemon identity could not be read');
      let value;
      try {
        value = JSON.parse(receipt.stdout.trim());
      } catch (error) {
        throw new Error('Outer Docker daemon identity is not JSON', {
          cause: error,
        });
      }
      return text(value, 'outer Docker daemon ID');
    });
}

function manifestArtifacts() {
  const production = `${CONTAINER.stateRoot}/production-evidence`;
  return [
    [
      'contained-run-verification',
      'contained-run-verification.json',
      `${production}/contained-run-verification.json`,
    ],
    [
      'callback-ledger',
      'containment-callbacks.jsonl',
      `${CONTAINER.logRoot}/containment-callbacks.jsonl`,
    ],
    [
      'nested-cleanup',
      'nested-cleanup.json',
      `${CONTAINER.stateRoot}/nested-cleanup.json`,
    ],
    [
      'proof-parent-ledger',
      'proof-parent-events.jsonl',
      `${CONTAINER.logRoot}/proof-parent-events.jsonl`,
    ],
    ['timing-profile', 'adaptive-timing-profile.json', CONTAINER.timingProfile],
    ['production-timings', 'timings.json', `${production}/timings.json`],
    [
      'production-result',
      'staged-validation-result.json',
      `${production}/staged-validation-result.json`,
    ],
    [
      'independent-reconciliation',
      'independent-reconciliation.json',
      `${production}/independent-reconciliation.json`,
    ],
    [
      'native-command-receipts',
      'native-command-receipts.jsonl',
      `${production}/native-command-receipts.jsonl`,
    ],
    [
      'native-process-ledger',
      'native-process-ledger.json',
      `${production}/native-process-ledger.json`,
    ],
    [
      'native-process-streams',
      'native-process-streams.json',
      `${production}/native-process-streams.json`,
    ],
    [
      'native-run-expectations',
      'native-run-expectations.json',
      `${production}/native-run-expectations.json`,
    ],
    [
      'host-preparation-receipt',
      'host-preparation-receipt.json',
      `${production}/host-preparation-receipt.json`,
    ],
    [
      'timing-observations',
      'adaptive-timing-observations.json',
      `${production}/adaptive-timing-observations.json`,
    ],
    [
      'timing-profile-update',
      'adaptive-timing-profile-update.json',
      `${production}/adaptive-timing-profile-update.json`,
    ],
    [
      'engine-stdout',
      'engine.stdout.log',
      `${CONTAINER.logRoot}/engine.stdout.log`,
    ],
    [
      'engine-stderr',
      'engine.stderr.log',
      `${CONTAINER.logRoot}/engine.stderr.log`,
    ],
  ].map(([role, fileName, containerPath]) => ({
    role,
    fileName,
    containerPath,
  }));
}

export function createDistributedLinuxHostLifecycleManifest({
  candidate,
  configDirectory,
  dependencyMountpoint,
  dependencyVolume,
  gitDirectory,
  gitEvidenceSha256,
  hostProfile,
  outerDaemonId: daemonId,
  outerEvidenceDirectory,
  parentScriptPath,
  parentScriptSha256,
  prerequisiteVolume,
  runId,
  runtimeApplicationKey,
  sourceDirectory,
  distributedEndpoints,
  operatorGithubLogin = null,
  requiredCapacityProof = null,
}) {
  const profile = normalizeDistributedLinuxHostProfile(hostProfile);
  const operator =
    operatorGithubLogin === null
      ? null
      : token(operatorGithubLogin, 'operator GitHub login');
  const capacityProof =
    requiredCapacityProof === null
      ? null
      : normalizeRequiredWorkerCapacityProof(requiredCapacityProof);
  const paths = {
    stateRoot: CONTAINER.stateRoot,
    logRoot: CONTAINER.logRoot,
    // The pinned Docker-in-Docker image declares /var/lib/docker as a volume.
    // Mount the owned daemon-data volume at that exact target so Docker does
    // not materialize an unplanned anonymous third volume at container create.
    daemonDataRoot: '/var/lib/docker',
    dockerSocket: `${CONTAINER.stateRoot}/docker/docker.sock`,
    daemonExecRoot: `${CONTAINER.stateRoot}/docker/exec`,
    daemonPidFile: `${CONTAINER.stateRoot}/docker/docker.pid`,
    helperReadyFile: `${CONTAINER.stateRoot}/helper-ready.json`,
    proofSocket: `${CONTAINER.stateRoot}/proof.sock`,
    daemonCpuMaxFile: '/sys/fs/cgroup/cpu.max',
    daemonMemoryMaxFile: '/sys/fs/cgroup/memory.max',
    daemonPidsMaxFile: '/sys/fs/cgroup/pids.max',
    snapshotDirectoryPrefix: 'seerrng-native-validation',
    snapshotSourceDirectory: 'source',
  };
  const evidence = {
    outerDirectory: outerEvidenceDirectory,
    callbackLogPath: `${CONTAINER.logRoot}/containment-callbacks.jsonl`,
    cleanupSchema: 'seerrng-mode3-nested-cleanup/v1',
    cleanupArtifactFileName: 'nested-cleanup.json',
    artifacts: manifestArtifacts(),
  };
  const network = {
    ...structuredClone(profile.network),
    repository: {
      mode: 'repository-loopback-only',
      unitId: 'native-repository',
      deniedExitCode: 7,
    },
    distributed: {
      mode: 'distributed-nodes-only',
      unitId: 'native-repository-distributed',
      runtimeApplicationKey,
      endpoints: structuredClone(distributedEndpoints),
    },
  };
  const inner = {
    parentScript: CONTAINER.proofParent,
    parentScriptSha256,
    configPath: CONTAINER.proofConfig,
    engineExecutable: '/usr/local/bin/node',
    engineArguments: [
      '/app/bin/run-local-validation.mjs',
      '--distributed-contained-run',
      '--request-file',
      CONTAINER.containedRequest,
    ],
    workingDirectory: CONTAINER.candidate,
    environment: {
      PATH: `${CONTAINER.engineBin}:${CONTAINER.tool}/tools/ct:${CONTAINER.tool}/tools/helm-docs:${CONTAINER.tool}/tools/lychee-musl/lychee-x86_64-unknown-linux-musl:${CONTAINER.tool}/dotnet9:/opt/codeql:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      HOME: `${CONTAINER.stateRoot}/home`,
      TMPDIR: '/tmp',
      CT_CONFIG_DIR: `${CONTAINER.tool}/tools/ct/etc`,
      GITHUB_ACTIONS: 'false',
      SEERR_MODE3_CONTAINED_RUN_ID: runId,
      ...(operator ? { SEERR_MODE3_OPERATOR_GITHUB_LOGIN: operator } : {}),
      ...(capacityProof
        ? {
            SEERR_MODE3_REQUIRED_CAPACITY_PROOF_SHA256:
              canonicalJsonSha256(capacityProof),
          }
        : {}),
    },
  };
  const base = {
    schema: DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
    runId,
    namePrefix: 'seerrng-mode3',
    ownershipLabelKey: 'org.seerrng.validation-owner',
    outerDaemonId: daemonId,
    candidate,
    dependencyMountpoint: structuredClone(dependencyMountpoint),
    images: {
      helper: structuredClone(profile.images.helper),
      daemon: structuredClone(profile.images.daemon),
    },
    inputs: {
      candidate: { type: 'bind', source: sourceDirectory, target: '/app' },
      config: { type: 'bind', source: configDirectory, target: '/config' },
      dependencies: {
        type: 'volume',
        source: dependencyVolume,
        target: '/app/node_modules',
      },
      git: { type: 'bind', source: gitDirectory, target: '/app/.git' },
      recipe: {
        type: 'bind',
        source: parentScriptPath,
        target: CONTAINER.proofParent,
      },
      tool: {
        type: 'volume',
        source: prerequisiteVolume,
        target: CONTAINER.tool,
      },
    },
    paths,
    resources: structuredClone(profile.resources),
    network,
    inner,
    gitHistory: {
      evidencePath: CONTAINER.gitEvidence,
      evidenceSha256: gitEvidenceSha256,
    },
    dockerFixture: {
      name: 'mode3-proof-fixture',
      imageReference: profile.images.fixture.reference,
      bindSource: `${CONTAINER.stateRoot}/fixture`,
      bindTarget: '/www',
      bridgeName: profile.network.bridgeName,
      containerPort: profile.images.fixture.containerPort,
      command: structuredClone(profile.images.fixture.command),
      payloadFileName: 'proof.txt',
      payloadText: `Mode 3 proof ${runId}`,
      payloadSha256: sha256(Buffer.from(`Mode 3 proof ${runId}`, 'utf8')),
    },
    evidence,
    proof: {
      leaseMaximumMs: 60 * 60 * 1000,
      readinessPollMs: 200,
      readinessTimeoutMs: 10 * 60 * 1000,
      binaries: {
        docker: '/usr/bin/docker',
        ip6tables: '/usr/sbin/ip6tables',
        ip6tablesRestore: '/usr/sbin/ip6tables-restore',
        iptables: '/usr/sbin/iptables',
        iptablesRestore: '/usr/sbin/iptables-restore',
        python: '/usr/bin/python3',
        setpriv: '/usr/bin/setpriv',
      },
    },
  };
  const proofParentConfig = createDistributedLinuxProofParentConfig({
    candidate: base.candidate,
    dockerFixture: base.dockerFixture,
    evidence: base.evidence,
    inner: base.inner,
    network: base.network,
    outerDaemonId: base.outerDaemonId,
    paths: base.paths,
    proof: base.proof,
    runId: base.runId,
  });
  return Object.freeze({
    manifest: Object.freeze({
      ...base,
      proofParentConfig: proofParentConfig.value,
    }),
    proofParentConfig,
  });
}

function publicDependencies(overrides) {
  const value = plainObject(overrides, 'public lifecycle dependencies');
  return {
    createContainment: createDistributedLinuxHostContainment,
    createHostAdapters: createDistributedLinuxHostAdapters,
    createSnapshot: createOwnedSourceSnapshot,
    detectOperatorGithubLogin,
    disposeSnapshot: disposeSourceSnapshot,
    fetchGitState: fetchAuthenticatedGitState,
    persistTimingProfile: persistAdaptiveTimingProfileFile,
    prepareDependencyMountpoint: prepareMode3DependencyMountpoint,
    readTimingProfile: readAdaptiveTimingProfileFile,
    resolveActiveConfig: resolveActiveLinuxConfig,
    verifyCleanSource: verifyCleanSourceCheckout,
    verifyDependencyMountpoint: verifyMode3DependencyMountpoint,
    verifySnapshot: verifySourceSnapshot,
    ...value,
  };
}

function readHostProfile(stateRoot) {
  const path = existingFile(
    resolve(stateRoot, DISTRIBUTED_LINUX_HOST_PROFILE_FILE),
    'Distributed Linux host profile'
  );
  return normalizeDistributedLinuxHostProfile(
    parseJsonBytes(
      readStableFile(path, 'Distributed Linux host profile'),
      'Distributed Linux host profile'
    )
  );
}

function selectApplication(config, entryId) {
  const matches = createSupportedApplicationListing(config).applications.filter(
    (application) => application.entryId === entryId
  );
  if (matches.length !== 1)
    throw new Error('Exactly one configured application entry is required');
  return matches[0];
}

function requiredCapacityProofForController(config, operatorGithubLogin) {
  if (config.global.threads !== '2n') return null;
  let proof;
  try {
    proof = createRequiredWorkerCapacityProof({
      operatorGithubLogin: config.global.githubUsername,
      expectedLogicalCpus: config.global.availableThreads,
    });
  } catch {
    return null;
  }
  if (operatorGithubLogin !== proof.operatorGithubLogin)
    throw new Error(
      'Required worker capacity proof operator differs from the authenticated checkout operator'
    );
  return proof;
}

function reviewBaseCommit(gitState) {
  const head = gitState.remoteRefs.find(({ ref }) => ref === 'HEAD');
  return requireDigest(head?.oid, 'Remote default branch commit', HASH40);
}

function parseProfileArtifact(path) {
  return readAdaptiveTimingProfileFile(path);
}

function preservedPreparationRoot(error, request, snapshot) {
  if (snapshot?.scratchRoot) return snapshot.scratchRoot;
  if (
    error?.preserveTemporary !== true ||
    typeof error.scratchRoot !== 'string'
  )
    return null;
  let candidate;
  try {
    candidate = absolutePath(error.scratchRoot, 'Preserved preparation root');
  } catch {
    return null;
  }
  const fromStateRoot = relative(request.stateRoot, candidate);
  if (
    !fromStateRoot ||
    fromStateRoot === '..' ||
    fromStateRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromStateRoot)
  )
    return null;
  return candidate;
}

function publicFailure(error, request, snapshot) {
  return {
    schema: 'seerrng-distributed-linux-public-failure/v1',
    runId: request.runId,
    status: 'failed',
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    preservedPreparationRoot: preservedPreparationRoot(
      error,
      request,
      snapshot
    ),
  };
}

/** Execute the public Windows/Docker lifecycle and write success last. */
export async function executeDistributedLinuxPublicLifecycle(
  requestValue,
  dependencyOverrides = {}
) {
  const request = normalizePublicRequest(requestValue);
  const deps = publicDependencies(dependencyOverrides);
  const runDirectory = resolve(request.logRoot, request.runId);
  createDirectoryExclusive(runDirectory);
  let snapshot;
  try {
    request.signal?.throwIfAborted();
    const adapters = deps.createHostAdapters();
    const gitState = deps.fetchGitState(request.sourceRoot);
    snapshot = deps.createSnapshot(request.sourceRoot, {
      scratchParent: request.stateRoot,
    });
    if (
      snapshot.candidate.commit !== gitState.commit ||
      snapshot.candidate.tree !== gitState.tree ||
      snapshot.candidate.repository !== gitState.repository
    )
      throw new Error('Frozen candidate differs from authenticated Git state');
    if (
      gitState.cleanSourceVerified !== true ||
      deps.verifyCleanSource(request.sourceRoot) !== true
    )
      throw new Error('Public Mode 3 clean source verification is incomplete');
    const candidate = Object.freeze({
      repository: snapshot.candidate.repository,
      branch: gitState.branch,
      commit: snapshot.candidate.commit,
      tree: snapshot.candidate.tree,
      lockSha256: snapshot.candidate.lockSha256,
      sourceSha256: snapshot.candidate.sourceSha256,
    });
    const dependencyMountpoint = deps.prepareDependencyMountpoint(snapshot);
    const active = await deps.resolveActiveConfig(
      request.activeConfigMarkerPath,
      { expectedRole: 'controller' }
    );
    const detectedOperatorGithubLogin = deps.detectOperatorGithubLogin({
      sourceRoot: request.sourceRoot,
      environment: process.env,
    });
    const operatorGithubLogin =
      detectedOperatorGithubLogin === null
        ? null
        : token(detectedOperatorGithubLogin, 'operator GitHub login');
    const requiredCapacityProof = requiredCapacityProofForController(
      active.config,
      operatorGithubLogin
    );
    const application = selectApplication(
      active.config,
      request.applicationEntryId
    );
    const rebound = rebindControllerConfig(
      active.config,
      request.sourceRoot,
      snapshot.root
    );
    selectApplication(rebound, request.applicationEntryId);
    const distributedEndpoints = rebound.nodes.map((node) => ({
      host: node.ipAddress,
      port: node.port,
    }));
    if (distributedEndpoints.length === 0)
      throw new Error('Production Mode 3 requires at least one remote node');
    const hostProfile = readHostProfile(request.stateRoot);
    const timingProfilePath = resolve(
      request.stateRoot,
      DISTRIBUTED_LINUX_TIMING_PROFILE_FILE
    );
    const timingProfile = deps.readTimingProfile(timingProfilePath);
    const preparation = createDirectoryExclusive(
      resolve(snapshot.scratchRoot, 'host-preparation')
    );
    const gitEvidence = authenticatedGitEvidence(gitState, candidate, true);
    const gitEvidenceReceipt = writeExclusive(
      resolve(preparation, basename(CONTAINER.gitEvidence)),
      canonicalBytes(gitEvidence)
    );
    const timingSeedReceipt = writeExclusive(
      resolve(preparation, basename(CONTAINER.timingSeed)),
      Buffer.from(`${JSON.stringify(timingProfile, null, 2)}\n`)
    );
    const controllerConfigReceipt = writeExclusive(
      resolve(preparation, basename(CONTAINER.configFile)),
      Buffer.from(serializeControllerConfig(rebound), 'utf8')
    );
    const activeMarkerReceipt = writeExclusive(
      resolve(preparation, basename(CONTAINER.activeMarker)),
      Buffer.from(`${CONTAINER.configFile}\n`, 'utf8')
    );
    const parentScriptPath = resolve(
      snapshot.root,
      'tools/validation-engine/container/mode3-proof-parent.py'
    );
    const parentScriptSha256 = sha256(
      readStableFile(parentScriptPath, 'Proof parent script')
    );
    const outerEvidenceDirectory = resolve(runDirectory, 'containment');
    const daemonId = await outerDaemonId(adapters);
    const lifecycle = createDistributedLinuxHostLifecycleManifest({
      candidate,
      configDirectory: preparation,
      dependencyMountpoint,
      dependencyVolume: hostProfile.volumes.dependencies,
      gitDirectory: resolve(snapshot.root, '.git'),
      gitEvidenceSha256: gitEvidenceReceipt.sha256,
      hostProfile,
      outerDaemonId: daemonId,
      outerEvidenceDirectory,
      parentScriptPath,
      parentScriptSha256,
      prerequisiteVolume: hostProfile.volumes.prerequisites,
      runId: request.runId,
      runtimeApplicationKey: request.runtimeApplicationKey,
      sourceDirectory: snapshot.root,
      distributedEndpoints,
      operatorGithubLogin,
      requiredCapacityProof,
    });
    const proofConfigReceipt = writeExclusive(
      resolve(preparation, basename(CONTAINER.proofConfig)),
      Buffer.from(lifecycle.proofParentConfig.json, 'utf8')
    );
    if (proofConfigReceipt.sha256 !== lifecycle.proofParentConfig.sha256)
      throw new Error('Persisted proof parent config hash differs');
    const manifestReceipt = writeJsonExclusive(
      resolve(preparation, basename(CONTAINER.manifest)),
      lifecycle.manifest
    );
    const hostPreparation = normalizeDistributedLinuxHostPreparationSeal({
      schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
      inputs: [
        {
          role: 'controller-config',
          containerPath: CONTAINER.configFile,
          rawSha256: controllerConfigReceipt.sha256,
        },
        {
          role: 'active-controller-marker',
          containerPath: CONTAINER.activeMarker,
          rawSha256: activeMarkerReceipt.sha256,
        },
        {
          role: 'timing-profile-seed',
          containerPath: CONTAINER.timingSeed,
          rawSha256: timingSeedReceipt.sha256,
        },
        {
          role: 'authenticated-git-evidence',
          containerPath: CONTAINER.gitEvidence,
          rawSha256: gitEvidenceReceipt.sha256,
        },
        {
          role: 'proof-parent-config',
          containerPath: CONTAINER.proofConfig,
          rawSha256: proofConfigReceipt.sha256,
        },
        {
          role: 'proof-parent-script',
          containerPath: CONTAINER.proofParent,
          rawSha256: parentScriptSha256,
        },
        {
          role: 'containment-manifest',
          containerPath: CONTAINER.manifest,
          rawSha256: manifestReceipt.sha256,
        },
      ],
    });
    const containedRequest = normalizeContainedRequest({
      schema: DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA,
      activeConfigMarkerPath: CONTAINER.activeMarker,
      applicationEntryId: application.entryId,
      evidenceDirectory: `${CONTAINER.stateRoot}/production-evidence`,
      hostPreparation,
      manifestPath: CONTAINER.manifest,
      operatorGithubLogin,
      reviewBaseCommit: reviewBaseCommit(gitState),
      requiredCapacityProof,
      runId: request.runId,
      runtimeApplicationKey: request.runtimeApplicationKey,
      sourceRoot: CONTAINER.candidate,
      timingProfilePath: CONTAINER.timingProfile,
      timingProfileSeedPath: CONTAINER.timingSeed,
    });
    const containedRequestReceipt = writeJsonExclusive(
      resolve(preparation, basename(CONTAINER.containedRequest)),
      containedRequest
    );
    deps.verifyDependencyMountpoint(snapshot, dependencyMountpoint);
    const containment = deps.createContainment(lifecycle.manifest, {
      outer: adapters,
      preparationRequest: {
        containerPath: CONTAINER.containedRequest,
        rawSha256: containedRequestReceipt.sha256,
        value: containedRequest,
      },
    });
    const hostResult = await containment.executeHostLifecycle({
      signal: request.signal,
    });
    if (hostResult?.status !== 'passed' || hostResult.runId !== request.runId)
      throw new Error('Outer host containment did not return exact success');
    deps.verifyDependencyMountpoint(snapshot, dependencyMountpoint);
    const retainedProfilePath = resolve(
      outerEvidenceDirectory,
      'adaptive-timing-profile.json'
    );
    const updatedProfile = parseProfileArtifact(retainedProfilePath);
    const updatedProfileSha256 = canonicalJsonSha256(updatedProfile);
    if (updatedProfileSha256 !== hostResult.containedRun.updatedProfileSha256)
      throw new Error('Retained timing profile differs from contained success');
    const containmentMarker = readStableFile(
      resolve(outerEvidenceDirectory, DISTRIBUTED_LINUX_HOST_FINAL_MARKER),
      'Containment success marker'
    );
    const outerSuccess = verifyDistributedLinuxOuterSuccessEvidence({
      hostResult,
      markerBytes: containmentMarker,
      outerEvidenceDirectory,
      runId: request.runId,
    });
    await deps.persistTimingProfile(timingProfilePath, updatedProfile);
    if (
      canonicalJsonSha256(deps.readTimingProfile(timingProfilePath)) !==
      updatedProfileSha256
    )
      throw new Error('Host timing profile persistence failed readback');
    deps.verifySnapshot(snapshot);
    deps.disposeSnapshot(snapshot);
    snapshot = null;
    const result = Object.freeze({
      schema: 'seerrng-distributed-linux-public-success/v2',
      runId: request.runId,
      status: 'passed',
      applicationEntryId: application.entryId,
      runtimeApplicationKey: request.runtimeApplicationKey,
      containmentMarkerSha256: outerSuccess.containmentMarkerSha256,
      outerEvidence: outerSuccess.outerEvidence,
      updatedProfileSha256,
      hostPreparationCleanupVerified: true,
      resultReuse: false,
    });
    // No successful-path filesystem mutation may follow this write.
    writeJsonExclusive(
      resolve(runDirectory, DISTRIBUTED_LINUX_HOST_FINAL_MARKER),
      result
    );
    return result;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      writeJsonExclusive(
        resolve(runDirectory, 'failure.json'),
        publicFailure(failure, request, snapshot)
      );
    } catch (evidenceError) {
      throw new AggregateError(
        [failure, evidenceError],
        'Public Mode 3 lifecycle and failure evidence both failed',
        { cause: evidenceError }
      );
    }
    throw new Error(failure.message, { cause: error });
  }
}

function containedDependencies(overrides) {
  const value = plainObject(overrides, 'contained lifecycle dependencies');
  return {
    createCallbacks: createDistributedLinuxHostContainmentCallbacks,
    executeProductionRun: executeDistributedLinuxProductionRun,
    persistTimingProfile: persistAdaptiveTimingProfileFile,
    runProofCommand: runDistributedLinuxProofClientCommand,
    readTimingProfile: readAdaptiveTimingProfileFile,
    runCommand,
    ...value,
  };
}

/** Run the fixed proof client with its canonical request on standard input. */
export function runDistributedLinuxProofClientCommand(args, options) {
  if (
    !Array.isArray(args) ||
    args.length < 1 ||
    args.some((argument) => typeof argument !== 'string' || !argument)
  )
    throw new Error('Proof client command requires exact arguments');
  exactKeys(options, ['id', 'input', 'timeoutMs'], 'proof client options');
  const id = token(options.id, 'proof client command ID');
  if (!Buffer.isBuffer(options.input) || options.input.length < 1)
    throw new Error('Proof client command input is required');
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 60_000
  )
    throw new Error('Proof client command timeout is invalid');
  const started = performance.now();
  const execution = spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    env: process.env,
    input: options.input,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  if (execution.error)
    throw new Error('Proof client command could not complete', {
      cause: execution.error,
    });
  const passed = execution.status === 0 && execution.signal === null;
  return Object.freeze({
    id,
    status: passed ? 'passed' : 'failed',
    exitCode: execution.status,
    signal: execution.signal,
    aborted: false,
    timedOut: false,
    stdout: execution.stdout,
    stderr: execution.stderr,
    wallMs: performance.now() - started,
    lifecycle: Object.freeze({
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    }),
  });
}

function appendJsonLine(path, value) {
  appendFileSync(path, canonicalBytes(value), { encoding: null, mode: 0o600 });
}

function findCypressBinary() {
  const root = '/root/.cache/Cypress';
  const matches = existsSync(root)
    ? readdirSync(root)
        .map((version) => resolve(root, version, 'Cypress/Cypress'))
        .filter((path) => {
          try {
            return lstatSync(path).isFile();
          } catch {
            return false;
          }
        })
    : [];
  if (matches.length !== 1)
    throw new Error('Exactly one immutable Cypress binary is required');
  return matches[0];
}

function optionalPrerequisite(path) {
  try {
    return lstatSync(path).isDirectory() ? path : undefined;
  } catch {
    return undefined;
  }
}

async function probeWithCommand(commandRunner, descriptor, signal) {
  const publicProbe = descriptor.kind === 'public-provider';
  const repositoryPublic = descriptor.kind === 'repository-public-denial';
  const target = publicProbe
    ? descriptor.endpoint.url
    : repositoryPublic
      ? 'https://1.1.1.1:443/'
      : `http://${descriptor.endpoint.host}:${descriptor.endpoint.port}/`;
  const args = [
    '--noproxy',
    '*',
    '--silent',
    '--show-error',
    '--connect-timeout',
    '2',
    '--max-time',
    '10',
    ...(publicProbe
      ? ['--output', '/dev/null', '--write-out', '%{http_code}']
      : []),
    target,
  ];
  try {
    return await commandRunner(
      { id: descriptor.kind, command: '/usr/bin/curl', args },
      {
        root: CONTAINER.candidate,
        env: process.env,
        signal,
        timeoutMs: 15_000,
        receipt: true,
      }
    );
  } catch (error) {
    if (error?.receipt) return error.receipt;
    throw error;
  }
}

function reviewedPrMetadata(baseCommit) {
  return async (candidate, { fixtureRoot }) => {
    const body = Buffer.from(
      'Reviewed local Mode 3 validation of the exact frozen candidate.\n',
      'utf8'
    );
    const bodyFile = resolve(fixtureRoot, 'local-review-body.txt');
    writeExclusive(bodyFile, body);
    return {
      source: 'proposed-reviewed',
      authorType: 'User',
      base: baseCommit,
      head: candidate.commit,
      headTree: candidate.tree,
      headSourceSha256: candidate.sourceSha256,
      bodyFile,
      bodySha256: sha256(body),
    };
  };
}

/** Execute only inside the capability-free helper child. */
export async function executeDistributedLinuxContainedLifecycle(
  requestFilePathValue,
  { signal, platform = process.platform, ...dependencyOverrides } = {}
) {
  if (platform !== 'linux')
    throw new Error('Contained Mode 3 lifecycle requires Linux');
  if (requestFilePathValue !== CONTAINER.containedRequest)
    throw new Error('Contained Mode 3 requires its fixed internal request');
  const requestFilePath = existingFile(
    requestFilePathValue,
    'Contained request file'
  );
  const requestBytes = readStableFile(
    requestFilePath,
    'Contained request file'
  );
  const requestRawSha256 = distributedLinuxRawSha256(requestBytes);
  if (
    requireDigest(
      process.env[CONTAINED_REQUEST_SHA256_ENV],
      'Contained request environment hash'
    ) !== requestRawSha256
  )
    throw new Error('Contained request raw hash differs');
  const request = normalizeContainedRequest(
    parseJsonBytes(requestBytes, 'Contained request file')
  );
  for (const [actual, expected] of [
    [request.activeConfigMarkerPath, CONTAINER.activeMarker],
    [request.evidenceDirectory, `${CONTAINER.stateRoot}/production-evidence`],
    [request.manifestPath, CONTAINER.manifest],
    [request.sourceRoot, CONTAINER.candidate],
    [request.timingProfilePath, CONTAINER.timingProfile],
    [request.timingProfileSeedPath, CONTAINER.timingSeed],
  ])
    if (actual !== expected)
      throw new Error('Contained request differs from fixed internal paths');
  const expectedPreparationPaths = new Map([
    ['controller-config', CONTAINER.configFile],
    ['active-controller-marker', CONTAINER.activeMarker],
    ['timing-profile-seed', CONTAINER.timingSeed],
    ['authenticated-git-evidence', CONTAINER.gitEvidence],
    ['proof-parent-config', CONTAINER.proofConfig],
    ['proof-parent-script', CONTAINER.proofParent],
    ['containment-manifest', CONTAINER.manifest],
  ]);
  const preparationBytes = new Map();
  for (const input of request.hostPreparation.inputs) {
    if (expectedPreparationPaths.get(input.role) !== input.containerPath)
      throw new Error(`Contained host-preparation path differs: ${input.role}`);
    const bytes = readStableFile(
      input.containerPath,
      `Contained host-preparation ${input.role}`
    );
    if (distributedLinuxRawSha256(bytes) !== input.rawSha256)
      throw new Error(`Contained host-preparation hash differs: ${input.role}`);
    preparationBytes.set(input.role, bytes);
  }
  const hostPreparation = completeDistributedLinuxHostPreparation(
    request.hostPreparation,
    {
      role: 'contained-request',
      containerPath: requestFilePath,
      rawSha256: requestRawSha256,
    }
  );
  if (process.env.SEERR_MODE3_CONTAINED_RUN_ID !== request.runId)
    throw new Error('Contained run environment identity differs');
  const manifest = parseJsonBytes(
    preparationBytes.get('containment-manifest'),
    'Containment manifest'
  );
  if (
    manifest.runId !== request.runId ||
    manifest.inner?.workingDirectory !== request.sourceRoot ||
    manifest.network?.distributed?.runtimeApplicationKey !==
      request.runtimeApplicationKey ||
    manifest.paths?.stateRoot !== process.env.SEERR_VALIDATION_STATE_DIR ||
    manifest.paths?.logRoot !== process.env.SEERR_VALIDATION_LOG_DIR
  )
    throw new Error('Contained request differs from its host manifest');
  const manifestOperatorGithubLogin =
    manifest.inner?.environment?.SEERR_MODE3_OPERATOR_GITHUB_LOGIN ?? null;
  if (manifestOperatorGithubLogin !== request.operatorGithubLogin)
    throw new Error(
      'Contained operator identity differs from its host manifest'
    );
  const expectedCapacityProofSha256 = request.requiredCapacityProof
    ? canonicalJsonSha256(request.requiredCapacityProof)
    : null;
  if (
    (manifest.inner?.environment?.SEERR_MODE3_REQUIRED_CAPACITY_PROOF_SHA256 ??
      null) !== expectedCapacityProofSha256
  )
    throw new Error(
      'Contained capacity proof policy differs from its host manifest'
    );
  const yamlToolWrappers = createDistributedLinuxContainedYamlToolWrappers();
  for (const [name, expected] of Object.entries(yamlToolWrappers.wrappers)) {
    const discovered = findNativeExecutable(name, process.env);
    if (discovered !== realpathSync(expected))
      throw new Error(`Contained YAML tool discovery differs: ${name}`);
  }
  const deps = containedDependencies(dependencyOverrides);
  createDirectoryExclusive(resolve(CONTAINER.stateRoot, 'home'));
  const seed = deps.readTimingProfile(request.timingProfileSeedPath);
  if (existsSync(request.timingProfilePath))
    throw new Error('Contained timing profile target must be new');
  await deps.persistTimingProfile(request.timingProfilePath, seed);
  const readiness = parseJsonBytes(
    readStableFile(manifest.paths.helperReadyFile, 'Helper readiness'),
    'Helper readiness'
  );
  if (!Number.isSafeInteger(readiness.parentPid) || readiness.parentPid < 1)
    throw new Error('Proof parent PID is absent from helper readiness');
  const proof = createDistributedLinuxProofSocketAdapter({
    runCommand: deps.runProofCommand,
    python: manifest.proof.binaries.python,
    scriptPath: manifest.inner.parentScript,
    socketPath: manifest.paths.proofSocket,
    parentPid: readiness.parentPid,
  });
  const callbacks = deps.createCallbacks(manifest, {
    fs: {
      readFile: async (path) => readStableFile(path, 'Containment evidence'),
      appendJsonLine: async (path, value) => appendJsonLine(path, value),
    },
    process: {
      probe: (descriptor) =>
        probeWithCommand(deps.runCommand, descriptor, signal),
    },
    proof,
  });
  const prerequisites = Object.fromEntries(
    [
      ['docsDependencies', `${CONTAINER.tool}/gen-docs/node_modules`],
      ['chartTestingConfig', `${CONTAINER.tool}/tools/ct/etc`],
    ]
      .map(([name, path]) => [name, optionalPrerequisite(path)])
      .filter(([, path]) => path !== undefined)
  );
  const codeqlRoot = optionalPrerequisite('/root/.codeql/packages');
  if (codeqlRoot) {
    const candidates = [];
    for (const owner of readdirSync(codeqlRoot)) {
      const ownerRoot = resolve(codeqlRoot, owner);
      if (!lstatSync(ownerRoot).isDirectory()) continue;
      for (const pack of readdirSync(ownerRoot)) {
        const packRoot = resolve(ownerRoot, pack);
        if (!lstatSync(packRoot).isDirectory()) continue;
        for (const version of readdirSync(packRoot)) {
          const versionRoot = resolve(packRoot, version);
          if (lstatSync(versionRoot).isDirectory())
            candidates.push(versionRoot);
        }
      }
    }
    const model = candidates.filter((path) =>
      basename(dirname(path)).includes('seerrng-codeql-models')
    );
    if (model.length === 1) prerequisites.codeqlModels = model[0];
  }
  const inherited = {
    ...process.env,
    CYPRESS_RUN_BINARY: findCypressBinary(),
  };
  const result = await deps.executeProductionRun({
    activeConfigMarkerPath: request.activeConfigMarkerPath,
    applicationEntryId: request.applicationEntryId,
    containment: callbacks,
    evidenceDirectory: request.evidenceDirectory,
    hostPreparation,
    nativeContextOptions: {
      inherited,
      operatorGithubLogin: request.operatorGithubLogin,
      prerequisiteReferences: prerequisites,
      requiredCapacityProof: request.requiredCapacityProof,
      reviewedPrMetadata: reviewedPrMetadata(request.reviewBaseCommit),
      scratchParent: CONTAINER.stateRoot,
      stderr: process.stderr,
      stdout: process.stdout,
    },
    runAttempt: 1,
    runId: request.runId,
    runtimeApplicationKey: request.runtimeApplicationKey,
    signal,
    sourceRoot: request.sourceRoot,
    timingProfilePath: request.timingProfilePath,
    timingPolicy: {},
  });
  if (result?.status !== 'passed' || result.runId !== request.runId)
    throw new Error(
      'Contained production lifecycle did not return exact success'
    );
  return result;
}
