// Copyright (c) snapetech and SeerrNG contributors.
// Generic host containment for the production distributed Linux validation gate.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { win32 } from 'node:path';
import path from 'node:path/posix';

import {
  completeDistributedLinuxHostPreparation,
  distributedLinuxPrettyJsonBytes,
  distributedLinuxRawSha256,
  normalizeDistributedLinuxHostPreparationSeal,
} from './distributed-linux-host-preparation.mjs';

export const DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA =
  'seerrng-distributed-linux-host-containment/v2';
export const DISTRIBUTED_LINUX_HOST_PLAN_SCHEMA =
  'seerrng-distributed-linux-host-plan/v3';
export const DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA =
  'seerrng-distributed-linux-host-result/v3';
export const DISTRIBUTED_LINUX_PROOF_PARENT_SCHEMA =
  'seerrng-distributed-linux-proof-parent/v1';
export const DISTRIBUTED_LINUX_HOST_FINAL_MARKER =
  'launch-result-verification.json';
export const DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA =
  'seerrng-distributed-linux-outer-evidence/v2';
export const DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES = Object.freeze(
  [
    ['host-plan.json', 'hostPlanSha256'],
    ['mountpoint-preflight.json', 'mountpointPreflightSha256'],
    ['volume-admission.json', 'volumeAdmissionSha256'],
    ['host-admission.json', 'hostAdmissionSha256'],
    ['terminal-inspection.json', 'terminalInspectionSha256'],
  ].map(([fileName, hashField]) => Object.freeze({ fileName, hashField }))
);

const HASH40 = /^[a-f0-9]{40}$/u;
const HASH64 = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SENSITIVE_ENVIRONMENT =
  /(?:secret|token|password|credential|api[_-]?key)/iu;
const UNSAFE_ENVIRONMENT =
  /^(?:BASH_ENV|ENV|GCONV_PATH|LD_LIBRARY_PATH|LD_PRELOAD|NODE_OPTIONS|NODE_PATH|PYTHONHOME|PYTHONPATH|SHELLOPTS)$/u;
const INPUT_KEYS = Object.freeze([
  'candidate',
  'config',
  'dependencies',
  'git',
  'recipe',
  'tool',
]);
const CONTAINMENT_CALLBACK_KEYS = Object.freeze([
  'verifyDockerFixture',
  'verifyGitHistory',
  'verifyNetworkBoundary',
  'withDistributedNetwork',
  'withRepositoryIsolation',
]);
const CONTAINED_ARTIFACT_HASH_FIELDS = Object.freeze({
  'production-result': 'resultSha256',
  'production-timings': 'timingsSha256',
  'native-command-receipts': 'processLedgerSha256',
  'native-process-ledger': 'processLedgerSummarySha256',
  'native-process-streams': 'processStreamsSha256',
  'native-run-expectations': 'runExpectationsSha256',
  'host-preparation-receipt': 'hostPreparationReceiptSha256',
  'independent-reconciliation': 'reconciliationSha256',
  'timing-observations': 'observationsSha256',
  'timing-profile-update': 'timingProfileUpdateSha256',
  'timing-profile': 'timingProfileFileSha256',
});
const PROOF_PARENT_TERMINAL_CLEANUP = Object.freeze({
  engineTerminateSeconds: 20,
  engineKillSeconds: 5,
  dockerInspectSeconds: 60,
  dockerRemoveSeconds: 60,
  dockerListSeconds: 30,
  proofServerStopSeconds: 5,
});
const PROOF_PARENT_TERMINAL_BUDGET_SECONDS = Object.values(
  PROOF_PARENT_TERMINAL_CLEANUP
).reduce((total, value) => total + value, 0);
const HELPER_STOP_GRACE_SECONDS = PROOF_PARENT_TERMINAL_BUDGET_SECONDS + 10;
const HOST_CLEANUP_COMMAND_TIMEOUT_MS = (HELPER_STOP_GRACE_SECONDS + 10) * 1000;
const DEPENDENCY_MOUNTPOINT_SCHEMA = 'seerrng-mode3-dependency-mountpoint/v1';
const MOUNTPOINT_PREFLIGHT_SCHEMA =
  'seerrng-distributed-linux-mountpoint-preflight/v1';
const LOCKED_INPUT_SCAN_SCHEMA =
  'seerrng-distributed-linux-locked-input-scan/v1';
const VOLUME_ADMISSION_SCHEMA = 'seerrng-distributed-linux-volume-admission/v2';
const MOUNTPOINT_PREFLIGHT_OUTPUT = 'mountpoint-preflight-ok';
const MOUNTPOINT_PREFLIGHT_RECONCILE_ATTEMPTS = 9;
const MOUNTPOINT_PREFLIGHT_RECONCILE_DELAY_MS = 250;
const MOUNTPOINT_PREFLIGHT_SCRIPT = [
  'test -f "$1/package.json"',
  'test -f "$1/pnpm-lock.yaml"',
  'test -f "$2/HEAD"',
  'test -f "$3/.modules.yaml"',
  'printf "%s\\n" "$4"',
].join(' && ');

/**
 * Create the fixed Unix-socket proof adapter used by the capability-free
 * engine child. Admission requests are deliberately not abortable: network
 * restoration must remain possible after the engine operation is cancelled.
 */
export function createDistributedLinuxProofSocketAdapter({
  runCommand,
  python,
  scriptPath,
  socketPath,
  parentPid,
  timeoutMs = 10_000,
  maximumBytes = 1_048_576,
}) {
  requiredFunction(runCommand, 'proof client command runner');
  const pythonPath = immutableImageBinary(python, 'proof client Python');
  const clientScript = containerPath(scriptPath, 'proof client script');
  const pathValue = containerPath(socketPath, 'proof socket path');
  positiveInteger(parentPid, 'proof parent PID');
  positiveInteger(timeoutMs, 'proof request timeout', 60_000);
  positiveInteger(maximumBytes, 'proof response byte limit', 16 * 1_048_576);
  return Object.freeze({
    async request(value) {
      plainObject(value, 'proof request');
      const payload = canonicalBytes(value);
      if (payload.byteLength > 16_384)
        throw new Error('Proof request exceeds the fixed request bound');
      const receipt = normalizeNativeReceipt(
        await runCommand(
          [pythonPath, clientScript, 'client', pathValue, String(parentPid)],
          {
            id: `proof-client-${value.op ?? 'unknown'}`,
            input: payload,
            timeoutMs,
          }
        ),
        'Proof client command'
      );
      const bytes = Buffer.from(receipt.stdout, 'utf8');
      if (!bytes.length || bytes.length > maximumBytes || bytes.at(-1) !== 0x0a)
        throw new Error('Proof client response is incomplete or oversized');
      let result;
      try {
        result = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new Error('Proof client response is not JSON', { cause: error });
      }
      return plainObject(result, 'proof response result');
    },
  });
}

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

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== keys.length ||
    actual
      .toSorted(compareText)
      .some((key, index) => key !== [...keys].toSorted(compareText)[index])
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
    // eslint-disable-next-line no-control-regex -- Runtime values cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function token(value, label, maximum = 128) {
  const normalized = text(value, label, maximum);
  if (!TOKEN.test(normalized)) throw new Error(`Exact ${label} is required`);
  return normalized;
}

function sha(value, label, pattern = HASH64) {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${label} must be a lowercase hexadecimal digest`);
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function positiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a positive finite number`);
  return value;
}

function port(value, label) {
  return positiveInteger(value, label, 65_535);
}

function ipv4Cidr(value, label) {
  const normalized = text(value, label);
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/u.exec(
    normalized
  );
  if (!match || isIP(match[1]) !== 4)
    throw new Error(`${label} must be an exact IPv4 CIDR`);
  const prefix = Number(match[2]);
  const address = match[1]
    .split('.')
    .reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
  const mask =
    prefix === 0 ? 0n : (2n ** BigInt(prefix) - 1n) << BigInt(32 - prefix);
  if ((address & mask) !== address)
    throw new Error(`${label} must use its canonical network address`);
  return Object.freeze({ text: normalized, address, mask, prefix });
}

function hostPath(value, label) {
  const normalized = text(value, label);
  if (!path.isAbsolute(normalized) && !win32.isAbsolute(normalized))
    throw new Error(`${label} must be absolute`);
  return normalized;
}

function resolveHostPath(root, ...segments) {
  const pathApi = path.isAbsolute(root) ? path : win32;
  return pathApi.resolve(root, ...segments);
}

function containerPath(value, label) {
  const normalized = text(value, label);
  if (
    !path.isAbsolute(normalized) ||
    path.normalize(normalized) !== normalized ||
    normalized.includes('\\') ||
    normalized.split('/').some((part) => part === '..')
  )
    throw new Error(`${label} must be an absolute normalized POSIX path`);
  return normalized;
}

function immutableImageBinary(value, label) {
  const normalized = containerPath(value, label);
  if (!/^\/usr\/(?:local\/)?s?bin\//u.test(normalized))
    throw new Error(`${label} must be in the immutable image`);
  return normalized;
}

function staysUnder(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    candidate !== root &&
    !relative.startsWith('../') &&
    !path.isAbsolute(relative)
  );
}

function pathsOverlap(left, right) {
  return left === right || staysUnder(left, right) || staysUnder(right, left);
}

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} is required`);
  return value;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function canonicalSha256(value) {
  return digest(canonicalBytes(value));
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function normalizeCandidate(value) {
  exactKeys(
    value,
    ['branch', 'commit', 'lockSha256', 'repository', 'sourceSha256', 'tree'],
    'host containment candidate'
  );
  return Object.freeze({
    repository: text(value.repository, 'candidate repository'),
    branch: text(value.branch, 'candidate branch'),
    commit: sha(value.commit, 'candidate commit', HASH40),
    tree: sha(value.tree, 'candidate tree', HASH40),
    lockSha256: sha(value.lockSha256, 'candidate lock hash'),
    sourceSha256: sha(value.sourceSha256, 'candidate source hash'),
  });
}

function normalizeDependencyMountpoint(value, candidate, inputs) {
  exactKeys(
    value,
    [
      'candidateCommit',
      'candidateSourceSha256',
      'candidateTree',
      'gitTreeVerified',
      'inheritedFileCount',
      'inheritedPathCount',
      'inheritedTopologySha256',
      'mountpointEmptyBeforeMount',
      'mountpointPath',
      'mountpointType',
      'onlyAddedPath',
      'relativePath',
      'schema',
      'sourceDirectory',
      'sourceManifestSha256',
    ],
    'dependency mountpoint proof'
  );
  const normalized = {
    schema: text(value.schema, 'dependency mountpoint schema'),
    sourceDirectory: hostPath(
      value.sourceDirectory,
      'dependency mountpoint source directory'
    ),
    mountpointPath: hostPath(
      value.mountpointPath,
      'dependency mountpoint path'
    ),
    relativePath: text(
      value.relativePath,
      'dependency mountpoint relative path'
    ),
    candidateCommit: sha(
      value.candidateCommit,
      'dependency mountpoint candidate commit',
      HASH40
    ),
    candidateTree: sha(
      value.candidateTree,
      'dependency mountpoint candidate tree',
      HASH40
    ),
    candidateSourceSha256: sha(
      value.candidateSourceSha256,
      'dependency mountpoint candidate source hash'
    ),
    sourceManifestSha256: sha(
      value.sourceManifestSha256,
      'dependency mountpoint source manifest hash'
    ),
    inheritedPathCount: positiveInteger(
      value.inheritedPathCount,
      'dependency mountpoint inherited path count'
    ),
    inheritedFileCount: positiveInteger(
      value.inheritedFileCount,
      'dependency mountpoint inherited file count'
    ),
    inheritedTopologySha256: sha(
      value.inheritedTopologySha256,
      'dependency mountpoint inherited topology hash'
    ),
    onlyAddedPath: text(
      value.onlyAddedPath,
      'dependency mountpoint only added path'
    ),
    mountpointType: text(value.mountpointType, 'dependency mountpoint type'),
    mountpointEmptyBeforeMount: value.mountpointEmptyBeforeMount,
    gitTreeVerified: value.gitTreeVerified,
  };
  if (
    normalized.schema !== DEPENDENCY_MOUNTPOINT_SCHEMA ||
    inputs.candidate.type !== 'bind' ||
    inputs.git.type !== 'bind' ||
    inputs.dependencies.type !== 'volume' ||
    normalized.sourceDirectory !== inputs.candidate.source ||
    normalized.relativePath !== 'node_modules' ||
    normalized.onlyAddedPath !== 'node_modules' ||
    normalized.mountpointPath !==
      resolveHostPath(normalized.sourceDirectory, normalized.relativePath) ||
    inputs.git.source !== resolveHostPath(normalized.sourceDirectory, '.git') ||
    inputs.git.target !== `${inputs.candidate.target}/.git` ||
    inputs.dependencies.target !==
      `${inputs.candidate.target}/${normalized.relativePath}` ||
    normalized.candidateCommit !== candidate.commit ||
    normalized.candidateTree !== candidate.tree ||
    normalized.candidateSourceSha256 !== candidate.sourceSha256 ||
    normalized.sourceManifestSha256 !== candidate.sourceSha256 ||
    normalized.inheritedFileCount > normalized.inheritedPathCount ||
    normalized.mountpointType !== 'directory' ||
    normalized.mountpointEmptyBeforeMount !== true ||
    normalized.gitTreeVerified !== true
  )
    throw new Error(
      'Dependency mountpoint proof differs from candidate topology'
    );
  return deepFreeze(normalized);
}

function normalizeImage(value, label, daemon = false) {
  exactKeys(
    value,
    daemon
      ? ['entrypoint', 'id', 'reference', 'storageDriver']
      : ['id', 'reference'],
    label
  );
  const reference = text(value.reference, `${label} reference`);
  const id = text(value.id, `${label} ID`);
  const referenceId = reference.startsWith('sha256:')
    ? reference
    : `sha256:${reference.split('@sha256:')[1] ?? ''}`;
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(id) ||
    !(
      reference === id ||
      /@sha256:[a-f0-9]{64}$/u.test(reference) ||
      /^sha256:[a-f0-9]{64}$/u.test(reference)
    ) ||
    referenceId !== id
  )
    throw new Error(`${label} must use an immutable digest`);
  return Object.freeze({
    reference,
    id,
    ...(daemon
      ? {
          entrypoint: (() => {
            const entrypoint = containerPath(
              value.entrypoint,
              `${label} entrypoint`
            );
            if (!/^\/usr\/(?:local\/)?s?bin\//u.test(entrypoint))
              throw new Error(
                `${label} entrypoint must be in the immutable image`
              );
            return entrypoint;
          })(),
          storageDriver: token(value.storageDriver, `${label} storage driver`),
        }
      : {}),
  });
}

function normalizeMount(value, label) {
  exactKeys(value, ['source', 'target', 'type'], label);
  if (!['bind', 'volume'].includes(value.type))
    throw new Error(`${label} type must be bind or volume`);
  const source =
    value.type === 'bind'
      ? hostPath(value.source, `${label} source`)
      : token(value.source, `${label} volume name`);
  if (/[,\r\n]/u.test(source))
    throw new Error(`${label} source cannot contain Docker mount separators`);
  return Object.freeze({
    type: value.type,
    source,
    target: containerPath(value.target, `${label} target`),
  });
}

function normalizeInputs(value) {
  exactKeys(value, INPUT_KEYS, 'host containment input mounts');
  const result = Object.fromEntries(
    INPUT_KEYS.map((name) => [
      name,
      normalizeMount(value[name], `${name} input mount`),
    ])
  );
  const targets = Object.values(result).map(({ target }) => target);
  if (new Set(targets).size !== targets.length)
    throw new Error('Host containment input mount targets must be unique');
  return Object.freeze(result);
}

function normalizePaths(value) {
  exactKeys(
    value,
    [
      'daemonCpuMaxFile',
      'daemonDataRoot',
      'daemonExecRoot',
      'daemonMemoryMaxFile',
      'daemonPidFile',
      'daemonPidsMaxFile',
      'dockerSocket',
      'helperReadyFile',
      'logRoot',
      'proofSocket',
      'snapshotDirectoryPrefix',
      'snapshotSourceDirectory',
      'stateRoot',
    ],
    'host containment paths'
  );
  const normalized = {
    stateRoot: containerPath(value.stateRoot, 'state root'),
    logRoot: containerPath(value.logRoot, 'log root'),
    daemonDataRoot: containerPath(value.daemonDataRoot, 'daemon data root'),
    dockerSocket: containerPath(value.dockerSocket, 'private Docker socket'),
    daemonExecRoot: containerPath(value.daemonExecRoot, 'daemon exec root'),
    daemonPidFile: containerPath(value.daemonPidFile, 'daemon PID file'),
    helperReadyFile: containerPath(value.helperReadyFile, 'helper ready file'),
    proofSocket: containerPath(value.proofSocket, 'proof socket'),
    daemonCpuMaxFile: containerPath(
      value.daemonCpuMaxFile,
      'daemon CPU readback file'
    ),
    daemonMemoryMaxFile: containerPath(
      value.daemonMemoryMaxFile,
      'daemon memory readback file'
    ),
    daemonPidsMaxFile: containerPath(
      value.daemonPidsMaxFile,
      'daemon PID readback file'
    ),
    snapshotDirectoryPrefix: token(
      value.snapshotDirectoryPrefix,
      'snapshot directory prefix'
    ),
    snapshotSourceDirectory: token(
      value.snapshotSourceDirectory,
      'snapshot source directory'
    ),
  };
  for (const [name, nested] of [
    ['Docker socket', normalized.dockerSocket],
    ['daemon exec root', normalized.daemonExecRoot],
    ['daemon PID file', normalized.daemonPidFile],
    ['helper ready file', normalized.helperReadyFile],
    ['proof socket', normalized.proofSocket],
  ])
    if (path.relative(normalized.stateRoot, nested).startsWith('..'))
      throw new Error(`${name} must stay under the state root`);
  if (normalized.stateRoot === normalized.logRoot)
    throw new Error('State and log roots must be distinct');
  return Object.freeze(normalized);
}

function normalizeResource(value, label, daemon = false) {
  exactKeys(
    value,
    daemon
      ? [
          'cpus',
          'expectedCpuMax',
          'expectedMemoryMax',
          'expectedPidsMax',
          'memoryBytes',
          'pidsLimit',
        ]
      : ['cpus', 'memoryBytes', 'pidsLimit', 'tmpfsBytes', 'tmpfsTarget'],
    label
  );
  return Object.freeze({
    cpus: positiveNumber(value.cpus, `${label} CPUs`),
    memoryBytes: positiveInteger(value.memoryBytes, `${label} memory bytes`),
    pidsLimit: positiveInteger(value.pidsLimit, `${label} PID limit`),
    ...(daemon
      ? {
          expectedCpuMax: text(
            value.expectedCpuMax,
            `${label} expected CPU maximum`
          ),
          expectedMemoryMax: text(
            value.expectedMemoryMax,
            `${label} expected memory maximum`
          ),
          expectedPidsMax: text(
            value.expectedPidsMax,
            `${label} expected PID maximum`
          ),
        }
      : {
          tmpfsBytes: positiveInteger(value.tmpfsBytes, `${label} tmpfs bytes`),
          tmpfsTarget: containerPath(
            value.tmpfsTarget,
            `${label} tmpfs target`
          ),
        }),
  });
}

function normalizeProbe(value, label, publicProbe) {
  exactKeys(
    value,
    publicProbe
      ? ['host', 'statusMaximum', 'statusMinimum', 'url']
      : ['expectedExitCode', 'host', 'port'],
    label
  );
  return Object.freeze(
    publicProbe
      ? {
          host: text(value.host, `${label} host`, 253),
          url: text(value.url, `${label} URL`),
          statusMinimum: positiveInteger(
            value.statusMinimum,
            `${label} minimum status`,
            599
          ),
          statusMaximum: positiveInteger(
            value.statusMaximum,
            `${label} maximum status`,
            599
          ),
        }
      : {
          host: text(value.host, `${label} host`, 253),
          port: port(value.port, `${label} port`),
          expectedExitCode: positiveInteger(
            value.expectedExitCode,
            `${label} expected exit code`,
            255
          ),
        }
  );
}

function normalizeEndpoint(value, label) {
  exactKeys(value, ['host', 'port'], label);
  const host = text(value.host, `${label} host`, 253);
  if (!isIP(host))
    throw new Error(`${label} host must be a literal IP address`);
  return Object.freeze({
    host,
    port: port(value.port, `${label} port`),
  });
}

function normalizeNetwork(value) {
  exactKeys(
    value,
    [
      'baselineDeniedCidrsV4',
      'baselineDeniedCidrsV6',
      'baselineMode',
      'bridgeAddress',
      'bridgeCidr',
      'bridgeName',
      'distributed',
      'dnsServers',
      'privateProbe',
      'publicProbe',
      'repository',
    ],
    'host containment network'
  );
  exactKeys(
    value.repository,
    ['deniedExitCode', 'mode', 'unitId'],
    'repository network policy'
  );
  exactKeys(
    value.distributed,
    ['endpoints', 'mode', 'runtimeApplicationKey', 'unitId'],
    'distributed network policy'
  );
  if (
    !Array.isArray(value.dnsServers) ||
    value.dnsServers.length < 1 ||
    !Array.isArray(value.baselineDeniedCidrsV4) ||
    value.baselineDeniedCidrsV4.length < 1 ||
    !Array.isArray(value.baselineDeniedCidrsV6) ||
    value.baselineDeniedCidrsV6.length < 1 ||
    !Array.isArray(value.distributed.endpoints) ||
    value.distributed.endpoints.length < 1
  )
    throw new Error('Complete network policy lists are required');
  const publicProbe = normalizeProbe(
    value.publicProbe,
    'public provider probe',
    true
  );
  if (publicProbe.statusMaximum < publicProbe.statusMinimum)
    throw new Error('Public provider status range is invalid');
  const bridgeCidr = ipv4Cidr(value.bridgeCidr, 'private bridge CIDR');
  const deniedV4 = value.baselineDeniedCidrsV4.map((entry, index) =>
    ipv4Cidr(entry, `IPv4 denied CIDR ${index}`)
  );
  if (
    !deniedV4.some(
      (denied) =>
        denied.prefix <= bridgeCidr.prefix &&
        (bridgeCidr.address & denied.mask) === denied.address
    )
  )
    throw new Error(
      'Private bridge CIDR must be covered by the baseline denial'
    );
  const distributedEndpoints = value.distributed.endpoints.map((entry, index) =>
    normalizeEndpoint(entry, `distributed endpoint ${index}`)
  );
  if (
    new Set(distributedEndpoints.map((entry) => `${entry.host}:${entry.port}`))
      .size !== distributedEndpoints.length
  )
    throw new Error('Distributed endpoints must be unique');
  return deepFreeze({
    baselineMode: token(value.baselineMode, 'baseline network mode'),
    bridgeAddress: text(value.bridgeAddress, 'private bridge address'),
    bridgeCidr: bridgeCidr.text,
    bridgeName: token(value.bridgeName, 'private bridge name'),
    dnsServers: value.dnsServers.map((entry, index) =>
      text(entry, `DNS server ${index}`, 253)
    ),
    baselineDeniedCidrsV4: deniedV4.map(({ text: cidr }) => cidr),
    baselineDeniedCidrsV6: value.baselineDeniedCidrsV6.map((entry, index) =>
      text(entry, `IPv6 denied CIDR ${index}`)
    ),
    publicProbe,
    privateProbe: normalizeProbe(
      value.privateProbe,
      'private provider probe',
      false
    ),
    repository: Object.freeze({
      mode: token(value.repository.mode, 'repository network mode'),
      unitId: token(value.repository.unitId, 'repository unit ID'),
      deniedExitCode: positiveInteger(
        value.repository.deniedExitCode,
        'repository denial exit code',
        255
      ),
    }),
    distributed: Object.freeze({
      mode: token(value.distributed.mode, 'distributed network mode'),
      unitId: token(value.distributed.unitId, 'distributed unit ID'),
      runtimeApplicationKey: token(
        value.distributed.runtimeApplicationKey,
        'distributed runtime application key'
      ),
      endpoints: distributedEndpoints,
    }),
  });
}

function normalizeInner(value) {
  exactKeys(
    value,
    [
      'configPath',
      'engineArguments',
      'engineExecutable',
      'environment',
      'parentScript',
      'parentScriptSha256',
      'workingDirectory',
    ],
    'engine-owned inner command'
  );
  if (
    !Array.isArray(value.engineArguments) ||
    value.engineArguments.some((entry) => typeof entry !== 'string')
  )
    throw new Error('Engine command arguments must be an array of strings');
  plainObject(value.environment, 'inner command environment');
  const environment = {};
  for (const [key, entry] of Object.entries(value.environment)) {
    if (
      !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(key) ||
      SENSITIVE_ENVIRONMENT.test(key) ||
      UNSAFE_ENVIRONMENT.test(key)
    )
      throw new Error('Inner command environment contains an unsafe key');
    environment[key] = text(entry, `inner environment ${key}`);
  }
  return deepFreeze({
    parentScript: containerPath(value.parentScript, 'proof parent script'),
    parentScriptSha256: sha(
      value.parentScriptSha256,
      'proof parent script hash'
    ),
    configPath: containerPath(value.configPath, 'proof parent config path'),
    engineExecutable: containerPath(
      value.engineExecutable,
      'engine child executable'
    ),
    engineArguments: value.engineArguments.map((entry, index) =>
      text(entry, `engine child argument ${index}`)
    ),
    workingDirectory: containerPath(
      value.workingDirectory,
      'inner working directory'
    ),
    environment,
  });
}

function normalizeGitHistory(value) {
  exactKeys(
    value,
    ['evidencePath', 'evidenceSha256'],
    'authenticated Git history evidence'
  );
  return Object.freeze({
    evidencePath: containerPath(
      value.evidencePath,
      'authenticated Git evidence path'
    ),
    evidenceSha256: sha(
      value.evidenceSha256,
      'authenticated Git evidence hash'
    ),
  });
}

function normalizeDockerFixture(value) {
  exactKeys(
    value,
    [
      'bindSource',
      'bindTarget',
      'bridgeName',
      'containerPort',
      'command',
      'imageReference',
      'name',
      'payloadFileName',
      'payloadSha256',
      'payloadText',
    ],
    'private Docker fixture'
  );
  const imageReference = text(value.imageReference, 'fixture image reference');
  if (!/@sha256:[a-f0-9]{64}$/u.test(imageReference))
    throw new Error('Fixture image must be digest-pinned');
  if (
    !Array.isArray(value.command) ||
    value.command.length < 1 ||
    value.command.some((entry) => typeof entry !== 'string' || !entry)
  )
    throw new Error('Fixture command must contain exact arguments');
  const payloadFileName = text(value.payloadFileName, 'fixture payload name');
  if (!SAFE_FILE.test(payloadFileName))
    throw new Error('Fixture payload must be a simple file name');
  const payloadText = text(value.payloadText, 'fixture payload text');
  const payloadSha256 = sha(value.payloadSha256, 'fixture payload hash');
  if (digest(Buffer.from(payloadText, 'utf8')) !== payloadSha256)
    throw new Error('Fixture payload hash differs');
  return Object.freeze({
    name: token(value.name, 'fixture name'),
    imageReference,
    bindSource: containerPath(value.bindSource, 'fixture bind source'),
    bindTarget: containerPath(value.bindTarget, 'fixture bind target'),
    bridgeName: token(value.bridgeName, 'fixture bridge name'),
    containerPort: port(value.containerPort, 'fixture container port'),
    command: value.command.map((entry, index) =>
      text(entry, `fixture command argument ${index}`)
    ),
    payloadFileName,
    payloadText,
    payloadSha256,
  });
}

function normalizeEvidence(value) {
  exactKeys(
    value,
    [
      'artifacts',
      'callbackLogPath',
      'cleanupArtifactFileName',
      'cleanupSchema',
      'outerDirectory',
    ],
    'host containment evidence'
  );
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1)
    throw new Error('At least one retained containment artifact is required');
  const artifacts = value.artifacts.map((entry, index) => {
    exactKeys(
      entry,
      ['containerPath', 'fileName', 'role'],
      `retained artifact ${index}`
    );
    const fileName = text(entry.fileName, `retained artifact ${index} name`);
    if (!SAFE_FILE.test(fileName))
      throw new Error('Retained artifact names must be simple file names');
    return Object.freeze({
      role: token(entry.role, `retained artifact ${index} role`),
      fileName,
      containerPath: containerPath(
        entry.containerPath,
        `retained artifact ${index} path`
      ),
    });
  });
  if (
    new Set(artifacts.map(({ fileName }) => fileName)).size !== artifacts.length
  )
    throw new Error('Retained artifact file names must be unique');
  if (new Set(artifacts.map(({ role }) => role)).size !== artifacts.length)
    throw new Error('Retained artifact roles must be unique');
  for (const role of [
    'callback-ledger',
    'contained-run-verification',
    'nested-cleanup',
    'proof-parent-ledger',
    ...Object.keys(CONTAINED_ARTIFACT_HASH_FIELDS),
  ])
    if (!artifacts.some((artifact) => artifact.role === role))
      throw new Error(`Required retained artifact role is absent: ${role}`);
  const cleanupArtifactFileName = text(
    value.cleanupArtifactFileName,
    'cleanup artifact file name'
  );
  if (!artifacts.some(({ fileName }) => fileName === cleanupArtifactFileName))
    throw new Error('Cleanup artifact must be retained by the outer lifecycle');
  if (
    artifacts.find(({ role }) => role === 'nested-cleanup')?.fileName !==
    cleanupArtifactFileName
  )
    throw new Error('Cleanup artifact role and name differ');
  if (
    artifacts.find(({ role }) => role === 'callback-ledger')?.containerPath !==
    value.callbackLogPath
  )
    throw new Error('Callback ledger artifact path differs');
  if (
    artifacts.some(
      ({ fileName }) => fileName === DISTRIBUTED_LINUX_HOST_FINAL_MARKER
    )
  )
    throw new Error(
      'The outer terminal marker cannot be copied from the helper'
    );
  return deepFreeze({
    outerDirectory: hostPath(value.outerDirectory, 'outer evidence directory'),
    callbackLogPath: containerPath(
      value.callbackLogPath,
      'containment callback log path'
    ),
    cleanupSchema: text(value.cleanupSchema, 'cleanup evidence schema'),
    cleanupArtifactFileName,
    artifacts,
  });
}

function normalizeProof(value) {
  exactKeys(
    value,
    ['binaries', 'leaseMaximumMs', 'readinessPollMs', 'readinessTimeoutMs'],
    'proof parent configuration'
  );
  exactKeys(
    value.binaries,
    [
      'docker',
      'ip6tables',
      'ip6tablesRestore',
      'iptables',
      'iptablesRestore',
      'python',
      'setpriv',
    ],
    'proof parent binaries'
  );
  const binaries = Object.fromEntries(
    Object.entries(value.binaries).map(([key, entry]) => {
      return [key, immutableImageBinary(entry, `proof binary ${key}`)];
    })
  );
  if (new Set(Object.values(binaries)).size !== Object.keys(binaries).length)
    throw new Error('Proof binaries must use distinct immutable paths');
  return deepFreeze({
    leaseMaximumMs: positiveInteger(
      value.leaseMaximumMs,
      'proof lease maximum',
      60 * 60 * 1000
    ),
    readinessPollMs: positiveInteger(
      value.readinessPollMs,
      'readiness poll interval',
      60_000
    ),
    readinessTimeoutMs: positiveInteger(
      value.readinessTimeoutMs,
      'readiness timeout',
      10 * 60 * 1000
    ),
    binaries,
  });
}

function buildProofParentConfig({
  candidate,
  dockerFixture,
  evidence,
  inner,
  network,
  outerDaemonId,
  paths,
  proof,
  runId,
}) {
  const cleanupArtifact = evidence.artifacts.find(
    ({ fileName }) => fileName === evidence.cleanupArtifactFileName
  ).containerPath;
  return deepFreeze({
    schema: DISTRIBUTED_LINUX_PROOF_PARENT_SCHEMA,
    runId,
    sourceSha256: candidate.sourceSha256,
    outerDaemonId,
    readinessTimeoutMs: proof.readinessTimeoutMs,
    binaries: {
      docker: proof.binaries.docker,
      ip6tables: proof.binaries.ip6tables,
      ip6tablesRestore: proof.binaries.ip6tablesRestore,
      iptables: proof.binaries.iptables,
      iptablesRestore: proof.binaries.iptablesRestore,
      setpriv: proof.binaries.setpriv,
    },
    paths: {
      stateRoot: paths.stateRoot,
      logRoot: paths.logRoot,
      dockerSocket: paths.dockerSocket,
      proofSocket: paths.proofSocket,
      helperReadyFile: paths.helperReadyFile,
      cleanupArtifact,
    },
    network: {
      baselineMode: network.baselineMode,
      repositoryMode: network.repository.mode,
      distributedMode: network.distributed.mode,
      repositoryUnitId: network.repository.unitId,
      distributedUnitId: network.distributed.unitId,
      leaseMaximumMs: proof.leaseMaximumMs,
      bridgeCidr: network.bridgeCidr,
      baselineDeniedCidrsV4: network.baselineDeniedCidrsV4,
      baselineDeniedCidrsV6: network.baselineDeniedCidrsV6,
      distributedEndpoints: network.distributed.endpoints,
    },
    dockerFixture: {
      name: dockerFixture.name,
      imageReference: dockerFixture.imageReference,
      bindSource: dockerFixture.bindSource,
      bindTarget: dockerFixture.bindTarget,
      bridgeName: dockerFixture.bridgeName,
      containerPort: dockerFixture.containerPort,
      command: dockerFixture.command,
      payloadFileName: dockerFixture.payloadFileName,
      payloadText: dockerFixture.payloadText,
      payloadSha256: dockerFixture.payloadSha256,
    },
    engine: {
      executable: inner.engineExecutable,
      arguments: inner.engineArguments,
      workingDirectory: inner.workingDirectory,
      environment: {
        ...inner.environment,
        DOCKER_HOST: `unix://${paths.dockerSocket}`,
        SEERR_VALIDATION_LOG_DIR: paths.logRoot,
        SEERR_VALIDATION_STATE_DIR: paths.stateRoot,
      },
    },
    cleanup: {
      schema: evidence.cleanupSchema,
      ...PROOF_PARENT_TERMINAL_CLEANUP,
      terminalBudgetSeconds: PROOF_PARENT_TERMINAL_BUDGET_SECONDS,
    },
  });
}

/** Build the only proof-parent config accepted by the host manifest. */
export function createDistributedLinuxProofParentConfig(value) {
  exactKeys(
    value,
    [
      'candidate',
      'dockerFixture',
      'evidence',
      'inner',
      'network',
      'outerDaemonId',
      'paths',
      'proof',
      'runId',
    ],
    'proof parent config inputs'
  );
  const normalized = {
    runId: token(value.runId, 'containment run ID'),
    outerDaemonId: text(value.outerDaemonId, 'outer Docker daemon ID'),
    candidate: normalizeCandidate(value.candidate),
    dockerFixture: normalizeDockerFixture(value.dockerFixture),
    evidence: normalizeEvidence(value.evidence),
    inner: normalizeInner(value.inner),
    network: normalizeNetwork(value.network),
    paths: normalizePaths(value.paths),
    proof: normalizeProof(value.proof),
  };
  if (normalized.dockerFixture.bridgeName !== normalized.network.bridgeName)
    throw new Error('Fixture and private daemon bridge names differ');
  if (
    !staysUnder(normalized.paths.stateRoot, normalized.dockerFixture.bindSource)
  )
    throw new Error('Fixture bind source must stay under writable state');
  if (
    !staysUnder(normalized.paths.logRoot, normalized.evidence.callbackLogPath)
  )
    throw new Error('Callback ledger must stay under writable logs');
  for (const artifact of normalized.evidence.artifacts)
    if (
      !staysUnder(normalized.paths.stateRoot, artifact.containerPath) &&
      !staysUnder(normalized.paths.logRoot, artifact.containerPath)
    )
      throw new Error('Retained artifacts must stay under writable outputs');
  const config = buildProofParentConfig(normalized);
  const bytes = canonicalBytes(config);
  return deepFreeze({
    value: config,
    json: bytes.toString('utf8'),
    sha256: digest(bytes),
  });
}

function normalizeManifest(value) {
  exactKeys(
    value,
    [
      'candidate',
      'dependencyMountpoint',
      'dockerFixture',
      'evidence',
      'gitHistory',
      'images',
      'inner',
      'inputs',
      'namePrefix',
      'network',
      'outerDaemonId',
      'ownershipLabelKey',
      'paths',
      'proof',
      'proofParentConfig',
      'resources',
      'runId',
      'schema',
    ],
    'distributed Linux host containment manifest'
  );
  if (value.schema !== DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA)
    throw new Error('Unsupported distributed Linux host containment schema');
  exactKeys(value.images, ['daemon', 'helper'], 'containment images');
  exactKeys(value.resources, ['daemon', 'helper'], 'containment resources');
  const inputs = normalizeInputs(value.inputs);
  const candidate = normalizeCandidate(value.candidate);
  const dependencyMountpoint = normalizeDependencyMountpoint(
    value.dependencyMountpoint,
    candidate,
    inputs
  );
  const paths = normalizePaths(value.paths);
  const immutableImageRoots = ['/bin', '/lib', '/lib64', '/sbin', '/usr'];
  for (const { target } of Object.values(inputs))
    if (
      target === '/' ||
      immutableImageRoots.some(
        (root) =>
          target === root ||
          target.startsWith(`${root}/`) ||
          root.startsWith(`${target}/`)
      )
    )
      throw new Error('Input mounts must not shadow immutable image binaries');
  for (const target of [paths.stateRoot, paths.logRoot])
    if (
      Object.values(inputs).some((input) => pathsOverlap(target, input.target))
    )
      throw new Error(
        'Writable output roots must not overlap read-only inputs'
      );
  const inner = normalizeInner(value.inner);
  if (inner.workingDirectory !== inputs.candidate.target)
    throw new Error(
      'Inner command must run from the read-only candidate mount'
    );
  if (path.relative(inputs.recipe.target, inner.parentScript).startsWith('..'))
    throw new Error('Proof parent script must stay under the recipe mount');
  if (path.relative(inputs.config.target, inner.configPath).startsWith('..'))
    throw new Error('Proof parent config must stay under the config mount');
  if (inputs.config.type !== 'bind' || inputs.recipe.type !== 'bind')
    throw new Error('Proof config and recipe inputs must be host bind mounts');
  const normalized = {
    schema: value.schema,
    runId: token(value.runId, 'containment run ID'),
    namePrefix: token(value.namePrefix, 'containment name prefix', 40),
    ownershipLabelKey: text(
      value.ownershipLabelKey,
      'containment ownership label key',
      128
    ),
    outerDaemonId: text(value.outerDaemonId, 'outer Docker daemon ID'),
    candidate,
    dependencyMountpoint,
    images: {
      helper: normalizeImage(value.images.helper, 'helper image'),
      daemon: normalizeImage(value.images.daemon, 'daemon image', true),
    },
    inputs,
    paths,
    resources: {
      helper: normalizeResource(value.resources.helper, 'helper resources'),
      daemon: normalizeResource(
        value.resources.daemon,
        'daemon resources',
        true
      ),
    },
    network: normalizeNetwork(value.network),
    inner,
    gitHistory: normalizeGitHistory(value.gitHistory),
    dockerFixture: normalizeDockerFixture(value.dockerFixture),
    evidence: normalizeEvidence(value.evidence),
    proof: normalizeProof(value.proof),
  };
  if (!staysUnder(inputs.config.target, normalized.gitHistory.evidencePath))
    throw new Error(
      'Authenticated Git evidence must stay under read-only config'
    );
  const generated = createDistributedLinuxProofParentConfig({
    candidate: normalized.candidate,
    dockerFixture: normalized.dockerFixture,
    evidence: normalized.evidence,
    inner,
    network: normalized.network,
    outerDaemonId: normalized.outerDaemonId,
    paths,
    proof: normalized.proof,
    runId: normalized.runId,
  });
  if (!sameJson(value.proofParentConfig, generated.value))
    throw new Error('Proof parent config differs from the host manifest');
  normalized.proofParentConfig = generated.value;
  normalized.inner = Object.freeze({
    ...inner,
    configSha256: generated.sha256,
  });
  return deepFreeze(normalized);
}

function volumeMount(source, target, readonly = false) {
  return [
    '--mount',
    `type=volume,src=${source},dst=${target}${readonly ? ',readonly' : ''}`,
  ];
}

function configuredMount(mount) {
  return [
    '--mount',
    `type=${mount.type},src=${mount.source},dst=${mount.target},readonly`,
  ];
}

function generatedNames(manifest, uniqueToken) {
  const unique = token(uniqueToken, 'unique containment token', 32);
  const stem = `${manifest.namePrefix}-${manifest.runId}-${unique}`;
  if (stem.length > 100)
    throw new Error('Containment name stem is too long for fresh Docker names');
  return Object.freeze({
    mountpointPreflight: `${stem}-mountpoint-preflight`,
    helper: `${stem}-helper`,
    daemon: `${stem}-dind`,
    state: `${stem}-state`,
    logs: `${stem}-logs`,
    daemonData: `${stem}-dind-data`,
  });
}

function bindSourceFile(mount, targetPath, label) {
  if (mount.type !== 'bind') throw new Error(`${label} must use a bind mount`);
  const relative = path.relative(mount.target, targetPath);
  if (relative.startsWith('../') || path.isAbsolute(relative))
    throw new Error(`${label} must stay under its configured bind target`);
  return relative
    ? resolveHostPath(mount.source, ...relative.split('/'))
    : mount.source;
}

function preparationInputByRole(preparation, role) {
  const input = preparation.inputs.find((entry) => entry.role === role);
  if (!input) throw new Error(`Host-preparation role is absent: ${role}`);
  return input;
}

function normalizePreparationRequest(value, manifestValue, manifest) {
  exactKeys(
    value,
    ['containerPath', 'rawSha256', 'value'],
    'contained host-preparation request'
  );
  const requestPath = containerPath(
    value.containerPath,
    'contained host-preparation request path'
  );
  const requestRawSha256 = sha(
    value.rawSha256,
    'contained host-preparation request hash'
  );
  const requestValue = plainObject(
    value.value,
    'contained host-preparation request value'
  );
  if (
    distributedLinuxRawSha256(distributedLinuxPrettyJsonBytes(requestValue)) !==
    requestRawSha256
  )
    throw new Error('Contained request value differs from its raw hash');
  const seal = normalizeDistributedLinuxHostPreparationSeal(
    requestValue.hostPreparation
  );
  const admission = completeDistributedLinuxHostPreparation(seal, {
    role: 'contained-request',
    containerPath: requestPath,
    rawSha256: requestRawSha256,
  });
  const manifestInput = preparationInputByRole(
    admission,
    'containment-manifest'
  );
  if (
    requestValue.manifestPath !== manifestInput.containerPath ||
    manifestInput.rawSha256 !==
      distributedLinuxRawSha256(distributedLinuxPrettyJsonBytes(manifestValue))
  )
    throw new Error('Containment manifest differs from its preparation seal');
  const fixedBindings = [
    [
      'active-controller-marker',
      requestValue.activeConfigMarkerPath,
      undefined,
    ],
    ['timing-profile-seed', requestValue.timingProfileSeedPath, undefined],
    [
      'authenticated-git-evidence',
      manifest.gitHistory.evidencePath,
      manifest.gitHistory.evidenceSha256,
    ],
    [
      'proof-parent-config',
      manifest.inner.configPath,
      manifest.inner.configSha256,
    ],
    [
      'proof-parent-script',
      manifest.inner.parentScript,
      manifest.inner.parentScriptSha256,
    ],
  ];
  for (const [role, expectedPath, expectedSha256] of fixedBindings) {
    const input = preparationInputByRole(admission, role);
    if (
      input.containerPath !== expectedPath ||
      (expectedSha256 !== undefined && input.rawSha256 !== expectedSha256)
    )
      throw new Error(`Host-preparation binding differs: ${role}`);
  }
  const requestArguments = manifest.inner.engineArguments;
  const requestFlagIndexes = requestArguments.flatMap((entry, index) =>
    entry === '--request-file' ? [index] : []
  );
  if (
    requestFlagIndexes.length !== 1 ||
    requestArguments[requestFlagIndexes[0] + 1] !== requestPath
  )
    throw new Error(
      'Engine request argument differs from the preparation seal'
    );
  const admissionFiles = admission.inputs.map((input) => {
    const mount =
      input.role === 'proof-parent-script'
        ? manifest.inputs.recipe
        : manifest.inputs.config;
    return Object.freeze({
      ...input,
      hostPath: bindSourceFile(
        mount,
        input.containerPath,
        `Host-preparation ${input.role}`
      ),
    });
  });
  return deepFreeze({
    admission,
    admissionFiles,
    requestPath,
    requestRawSha256,
  });
}

/**
 * Create the immutable, data-only Docker plan. No command is executed here.
 */
export function createDistributedLinuxHostContainmentPlan(
  manifestValue,
  { preparationRequest, uniqueToken } = {}
) {
  const manifest = normalizeManifest(manifestValue);
  const preparation = normalizePreparationRequest(
    preparationRequest,
    manifestValue,
    manifest
  );
  const names = generatedNames(manifest, uniqueToken);
  const ownership = Object.freeze({
    key: manifest.ownershipLabelKey,
    value: `${manifest.runId}.${uniqueToken}`,
  });
  const label = `${ownership.key}=${ownership.value}`;
  const mountpointPreflight = Object.freeze([
    'create',
    '--name',
    names.mountpointPreflight,
    '--label',
    label,
    '--user',
    '0:0',
    '--restart',
    'no',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--workdir',
    '/',
    ...configuredMount(manifest.inputs.candidate),
    ...configuredMount(manifest.inputs.git),
    ...configuredMount(manifest.inputs.dependencies),
    '--entrypoint',
    '/bin/sh',
    manifest.images.helper.reference,
    '-eu',
    '-c',
    MOUNTPOINT_PREFLIGHT_SCRIPT,
    'mountpoint-preflight',
    manifest.inputs.candidate.target,
    manifest.inputs.git.target,
    manifest.inputs.dependencies.target,
    MOUNTPOINT_PREFLIGHT_OUTPUT,
  ]);
  const volumes = Object.freeze(
    ['state', 'logs', 'daemonData'].map((role) =>
      Object.freeze({
        role,
        name: names[role],
        create: Object.freeze([
          'volume',
          'create',
          '--driver',
          'local',
          '--label',
          label,
          names[role],
        ]),
      })
    )
  );
  const helperMounts = INPUT_KEYS.flatMap((name) =>
    configuredMount(manifest.inputs[name])
  );
  helperMounts.push(
    ...volumeMount(names.state, manifest.paths.stateRoot),
    ...volumeMount(names.logs, manifest.paths.logRoot)
  );
  const helperEnvironment = {
    DOCKER_HOST: `unix://${manifest.paths.dockerSocket}`,
    SEERR_VALIDATION_STATE_DIR: manifest.paths.stateRoot,
    SEERR_VALIDATION_LOG_DIR: manifest.paths.logRoot,
  };
  const helper = Object.freeze([
    'create',
    '--name',
    names.helper,
    '--label',
    label,
    '--user',
    '0:0',
    '--init',
    '--restart',
    'no',
    '--network',
    'bridge',
    '--cpus',
    String(manifest.resources.helper.cpus),
    '--memory',
    String(manifest.resources.helper.memoryBytes),
    '--pids-limit',
    String(manifest.resources.helper.pidsLimit),
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--tmpfs',
    `${manifest.resources.helper.tmpfsTarget}:rw,nosuid,nodev,size=${manifest.resources.helper.tmpfsBytes}`,
    '--workdir',
    manifest.inner.workingDirectory,
    ...manifest.network.dnsServers.flatMap((server) => ['--dns', server]),
    ...Object.entries(helperEnvironment)
      .toSorted(([left], [right]) => compareText(left, right))
      .flatMap(([key, entry]) => ['--env', `${key}=${entry}`]),
    ...helperMounts,
    '--cap-add',
    'NET_ADMIN',
    '--cap-add',
    'SETPCAP',
    '--entrypoint',
    manifest.proof.binaries.python,
    manifest.images.helper.reference,
    manifest.inner.parentScript,
    manifest.inner.configPath,
    manifest.inner.configSha256,
    preparation.requestPath,
    preparation.requestRawSha256,
  ]);
  const daemonCommand = Object.freeze([
    'dockerd',
    `--host=unix://${manifest.paths.dockerSocket}`,
    `--data-root=${manifest.paths.daemonDataRoot}`,
    `--exec-root=${manifest.paths.daemonExecRoot}`,
    `--pidfile=${manifest.paths.daemonPidFile}`,
    `--storage-driver=${manifest.images.daemon.storageDriver}`,
    ...manifest.network.dnsServers.flatMap((server) => [`--dns=${server}`]),
    `--bip=${manifest.network.bridgeAddress}`,
    `--fixed-cidr=${manifest.network.bridgeCidr}`,
    '--userland-proxy=false',
  ]);
  const daemon = Object.freeze([
    'create',
    '--name',
    names.daemon,
    '--label',
    label,
    '--privileged',
    '--restart',
    'no',
    '--cpus',
    String(manifest.resources.daemon.cpus),
    '--memory',
    String(manifest.resources.daemon.memoryBytes),
    '--pids-limit',
    String(manifest.resources.daemon.pidsLimit),
    '--network',
    `container:${names.helper}`,
    ...volumeMount(names.state, manifest.paths.stateRoot),
    ...volumeMount(names.daemonData, manifest.paths.daemonDataRoot),
    '--env',
    'DOCKER_TLS_CERTDIR=',
    '--entrypoint',
    manifest.images.daemon.entrypoint,
    manifest.images.daemon.reference,
    ...daemonCommand,
  ]);
  const proofParentConfigBytes = canonicalBytes(manifest.proofParentConfig);
  return deepFreeze({
    schema: DISTRIBUTED_LINUX_HOST_PLAN_SCHEMA,
    manifest,
    names,
    ownership,
    volumes,
    mountpointPreflight,
    startMountpointPreflight: ['start', '--attach', names.mountpointPreflight],
    forceRemoveMountpointPreflight: [
      'rm',
      '--force',
      names.mountpointPreflight,
    ],
    mountpointPreflightOutput: MOUNTPOINT_PREFLIGHT_OUTPUT,
    helper,
    daemon,
    daemonCommand,
    proofParentConfig: {
      json: proofParentConfigBytes.toString('utf8'),
      sha256: digest(proofParentConfigBytes),
    },
    admissionFiles: preparation.admissionFiles,
    preparation: preparation.admission,
    startHelper: ['start', names.helper],
    startDaemon: ['start', names.daemon],
    waitHelper: ['wait', names.helper],
    stopHelper: [
      'stop',
      '--time',
      String(HELPER_STOP_GRACE_SECONDS),
      names.helper,
    ],
    stopDaemon: ['stop', '--time', '30', names.daemon],
    terminalCleanup: Object.freeze({
      proofParentBudgetSeconds: PROOF_PARENT_TERMINAL_BUDGET_SECONDS,
      helperStopGraceSeconds: HELPER_STOP_GRACE_SECONDS,
      hostCommandTimeoutMs: HOST_CLEANUP_COMMAND_TIMEOUT_MS,
    }),
    retainedAssets: true,
    resultReuse: false,
  });
}

function normalizeNativeReceipt(value, label) {
  plainObject(value, label);
  if (
    value.status !== 'passed' ||
    value.exitCode !== 0 ||
    value.signal ||
    value.aborted ||
    value.timedOut ||
    value.lifecycle?.completed !== true ||
    value.lifecycle?.cleanupVerified !== true ||
    typeof value.stdout !== 'string'
  )
    throw new Error(`${label} requires a complete passing native receipt`);
  return value;
}

function receiptEvidence(receipt) {
  return Object.freeze({
    id: receipt.id ?? null,
    status: receipt.status,
    exitCode: receipt.exitCode,
    wallMs: receipt.wallMs,
    stdoutSha256:
      receipt.stdoutSha256 ?? digest(Buffer.from(receipt.stdout ?? '')),
    stderrSha256:
      receipt.stderrSha256 ?? digest(Buffer.from(receipt.stderr ?? '')),
    lifecycle: receipt.lifecycle,
  });
}

function dockerMounts(inspect) {
  return Object.fromEntries(
    (inspect?.Mounts ?? []).map((mount) => [mount.Destination, mount])
  );
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function containsExactEnvironment(actual, expected) {
  if (!Array.isArray(actual)) return false;
  const expectedEntries = Object.entries(expected).map(
    ([key, value]) => `${key}=${value}`
  );
  return expectedEntries.every(
    (entry) => actual.filter((candidate) => candidate === entry).length === 1
  );
}

function verifyLocalVolume(volume, expectedName) {
  if (
    volume?.Name !== expectedName ||
    volume.Driver !== 'local' ||
    volume.Scope !== 'local' ||
    !(
      volume.Options === null ||
      (plainObject(volume.Options, 'local volume options') &&
        Object.keys(volume.Options).length === 0)
    ) ||
    typeof volume.Mountpoint !== 'string' ||
    !path.isAbsolute(volume.Mountpoint) ||
    path.normalize(volume.Mountpoint) !== volume.Mountpoint ||
    volume.Mountpoint.includes('\\') ||
    !volume.Mountpoint.endsWith(`/volumes/${expectedName}/_data`)
  )
    throw new Error(`Exact local volume differs: ${expectedName}`);
  return volume;
}

function verifyVolume(volume, expectedName, ownership) {
  verifyLocalVolume(volume, expectedName);
  if (volume.Labels?.[ownership.key] !== ownership.value)
    throw new Error(`Created local volume owner differs: ${expectedName}`);
  return volume;
}

function dockerDesktopWindowsBindSource(source) {
  if (
    process.platform !== 'win32' ||
    !win32.isAbsolute(source) ||
    win32.normalize(source) !== source
  )
    return null;
  const { root } = win32.parse(source);
  if (!/^[A-Za-z]:\\$/u.test(root) || source === root) return null;
  const relative = source.slice(root.length);
  if (
    !relative ||
    relative.split('\\').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  return `/run/desktop/mnt/host/${root[0].toLowerCase()}/${relative.replaceAll('\\', '/')}`;
}

function sameConfiguredBindSource(actual, expected) {
  if (actual === expected) return true;
  const dockerDesktopSource = dockerDesktopWindowsBindSource(expected);
  return dockerDesktopSource !== null && actual === dockerDesktopSource;
}

function pathContains(pathApi, ancestor, descendant) {
  if (
    typeof ancestor !== 'string' ||
    typeof descendant !== 'string' ||
    !pathApi.isAbsolute(ancestor) ||
    !pathApi.isAbsolute(descendant)
  )
    return false;
  const relative = pathApi.relative(ancestor, descendant);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

function configuredBindOverlaps(actual, expected) {
  if (
    pathContains(win32, actual, expected) ||
    pathContains(win32, expected, actual)
  )
    return true;
  const dockerDesktopSource = dockerDesktopWindowsBindSource(expected);
  return (
    dockerDesktopSource !== null &&
    (pathContains(path, actual, dockerDesktopSource) ||
      pathContains(path, dockerDesktopSource, actual))
  );
}

function verifyConfiguredReadOnlyMount(actual, expected) {
  if (
    actual?.Type !== expected.type ||
    actual.RW !== false ||
    (expected.type === 'volume'
      ? actual.Name !== expected.source
      : !sameConfiguredBindSource(actual.Source, expected.source))
  )
    throw new Error(`Read-only input mount differs: ${expected.target}`);
}

function verifyMountpointPreflightInspect(inspect, plan) {
  const { manifest, ownership } = plan;
  const mounts = dockerMounts(inspect);
  const expectedInputs = [
    manifest.inputs.candidate,
    manifest.inputs.git,
    manifest.inputs.dependencies,
  ];
  const expectedTargets = expectedInputs
    .map(({ target }) => target)
    .toSorted(compareText);
  const command = [
    '-eu',
    '-c',
    MOUNTPOINT_PREFLIGHT_SCRIPT,
    'mountpoint-preflight',
    manifest.inputs.candidate.target,
    manifest.inputs.git.target,
    manifest.inputs.dependencies.target,
    plan.mountpointPreflightOutput,
  ];
  if (
    !HASH64.test(inspect?.Id) ||
    inspect.Image !== manifest.images.helper.id ||
    inspect.Config?.Image !== manifest.images.helper.reference ||
    inspect.Config?.Labels?.[ownership.key] !== ownership.value ||
    inspect.Config?.User !== '0:0' ||
    inspect.Config?.WorkingDir !== '/' ||
    !sameArray(inspect.Config?.Entrypoint, ['/bin/sh']) ||
    !sameArray(inspect.Config?.Cmd, command) ||
    inspect.Path !== '/bin/sh' ||
    !sameArray(inspect.Args, command) ||
    inspect.HostConfig?.ReadonlyRootfs !== true ||
    inspect.HostConfig?.Privileged === true ||
    !sameArray(inspect.HostConfig?.CapDrop, ['ALL']) ||
    !sameArray(inspect.HostConfig?.SecurityOpt, ['no-new-privileges']) ||
    inspect.HostConfig?.NetworkMode !== 'none' ||
    inspect.HostConfig?.RestartPolicy?.Name !== 'no' ||
    !sameArray(Object.keys(mounts).toSorted(compareText), expectedTargets)
  )
    throw new Error('Dependency mountpoint preflight topology differs');
  for (const expected of expectedInputs)
    verifyConfiguredReadOnlyMount(mounts[expected.target], expected);
  return inspect;
}

function bindContainerRemovalToId(args, expectedName, containerId) {
  if (
    !Array.isArray(args) ||
    args.length < 2 ||
    args.at(-1) !== expectedName ||
    !HASH64.test(containerId)
  )
    throw new Error('Dependency mountpoint preflight removal cannot be bound');
  return Object.freeze([...args.slice(0, -1), containerId]);
}

function bindContainerStartToId(args, expectedName, containerId) {
  if (
    !Array.isArray(args) ||
    args.length < 2 ||
    args.at(-1) !== expectedName ||
    !HASH64.test(containerId)
  )
    throw new Error('Dependency mountpoint preflight start cannot be bound');
  return Object.freeze([...args.slice(0, -1), containerId]);
}

function verifyHelperInspect(inspect, plan) {
  const { manifest, names, ownership } = plan;
  const mounts = dockerMounts(inspect);
  const expectedTargets = [
    ...Object.values(manifest.inputs).map(({ target }) => target),
    manifest.paths.stateRoot,
    manifest.paths.logRoot,
  ].toSorted(compareText);
  const actualTargets = Object.keys(mounts).toSorted(compareText);
  const expectedEnvironment = {
    DOCKER_HOST: `unix://${manifest.paths.dockerSocket}`,
    SEERR_VALIDATION_STATE_DIR: manifest.paths.stateRoot,
    SEERR_VALIDATION_LOG_DIR: manifest.paths.logRoot,
  };
  const expectedTmpfs = `${manifest.resources.helper.tmpfsTarget}:rw,nosuid,nodev,size=${manifest.resources.helper.tmpfsBytes}`;
  if (
    !sameArray(actualTargets, expectedTargets) ||
    inspect?.Image !== manifest.images.helper.id ||
    inspect.Config?.Image !== manifest.images.helper.reference ||
    inspect.Config?.Labels?.[ownership.key] !== ownership.value ||
    inspect.Config?.User !== '0:0' ||
    inspect.HostConfig?.NanoCpus !== manifest.resources.helper.cpus * 1e9 ||
    inspect.HostConfig?.Memory !== manifest.resources.helper.memoryBytes ||
    inspect.HostConfig?.PidsLimit !== manifest.resources.helper.pidsLimit ||
    inspect.HostConfig?.ReadonlyRootfs !== true ||
    inspect.HostConfig?.Init !== true ||
    inspect.HostConfig?.Privileged === true ||
    !sameArray(inspect.HostConfig?.CapDrop, ['ALL']) ||
    !sameArray(inspect.HostConfig?.CapAdd, ['CAP_NET_ADMIN', 'CAP_SETPCAP']) ||
    !sameArray(inspect.HostConfig?.SecurityOpt, ['no-new-privileges']) ||
    inspect.HostConfig?.NetworkMode !== 'bridge' ||
    !sameArray(inspect.HostConfig?.Dns, manifest.network.dnsServers) ||
    inspect.HostConfig?.Tmpfs?.[manifest.resources.helper.tmpfsTarget] !==
      expectedTmpfs.split(':', 2)[1] ||
    inspect.HostConfig?.RestartPolicy?.Name !== 'no' ||
    inspect.Config?.WorkingDir !== manifest.inner.workingDirectory ||
    !containsExactEnvironment(inspect.Config?.Env, expectedEnvironment) ||
    !sameArray(inspect.Config?.Entrypoint, [manifest.proof.binaries.python]) ||
    inspect.Path !== manifest.proof.binaries.python ||
    !sameArray(inspect.Config?.Cmd, [
      manifest.inner.parentScript,
      manifest.inner.configPath,
      manifest.inner.configSha256,
      plan.preparation.inputs.at(-1).containerPath,
      plan.preparation.inputs.at(-1).rawSha256,
    ]) ||
    !sameArray(inspect.Args, inspect.Config.Cmd)
  )
    throw new Error('Privileged proof-parent helper topology differs');
  for (const expected of Object.values(manifest.inputs))
    verifyConfiguredReadOnlyMount(mounts[expected.target], expected);
  if (
    mounts[manifest.paths.stateRoot]?.Name !== names.state ||
    mounts[manifest.paths.stateRoot]?.RW !== true ||
    mounts[manifest.paths.logRoot]?.Name !== names.logs ||
    mounts[manifest.paths.logRoot]?.RW !== true
  )
    throw new Error('Writable helper output mounts differ');
  return inspect;
}

function verifyDaemonInspect(inspect, plan, helperId) {
  const { manifest, names, ownership } = plan;
  const mounts = dockerMounts(inspect);
  const networkModes = [`container:${names.helper}`, `container:${helperId}`];
  const tls = inspect?.Config?.Env?.filter((entry) =>
    entry.startsWith('DOCKER_TLS_CERTDIR=')
  );
  if (
    !networkModes.includes(inspect?.HostConfig?.NetworkMode) ||
    inspect.HostConfig?.Privileged !== true ||
    inspect.HostConfig?.NanoCpus !== manifest.resources.daemon.cpus * 1e9 ||
    inspect.HostConfig?.Memory !== manifest.resources.daemon.memoryBytes ||
    inspect.HostConfig?.PidsLimit !== manifest.resources.daemon.pidsLimit ||
    inspect.HostConfig?.RestartPolicy?.Name !== 'no' ||
    inspect.Image !== manifest.images.daemon.id ||
    inspect.Config?.Image !== manifest.images.daemon.reference ||
    inspect.Config?.Labels?.[ownership.key] !== ownership.value ||
    !sameArray(tls, ['DOCKER_TLS_CERTDIR=']) ||
    !sameArray(inspect.Config?.Entrypoint, [
      manifest.images.daemon.entrypoint,
    ]) ||
    inspect.Path !== manifest.images.daemon.entrypoint ||
    !sameArray(inspect.Config?.Cmd, plan.daemonCommand) ||
    !sameArray(inspect.Args, plan.daemonCommand) ||
    Object.keys(mounts).length !== 2 ||
    mounts[manifest.paths.stateRoot]?.Name !== names.state ||
    mounts[manifest.paths.stateRoot]?.RW !== true ||
    mounts[manifest.paths.daemonDataRoot]?.Name !== names.daemonData ||
    mounts[manifest.paths.daemonDataRoot]?.RW !== true
  )
    throw new Error('Private privileged daemon topology differs');
  const hosts = plan.daemonCommand.filter((entry) =>
    entry.startsWith('--host=')
  );
  if (
    hosts.length !== 1 ||
    hosts[0] !== `--host=unix://${manifest.paths.dockerSocket}` ||
    plan.daemonCommand.some((entry) => /tcp:\/\//u.test(entry)) ||
    !plan.daemonCommand.includes('--userland-proxy=false')
  )
    throw new Error('Private daemon must expose exactly one Unix socket');
  return inspect;
}

function verifyRunningContainer(inspect, label) {
  if (
    inspect?.State?.Running !== true ||
    inspect.State.OOMKilled !== false ||
    inspect.RestartCount !== 0
  )
    throw new Error(`${label} is not live, restart-free, and OOM-free`);
  return inspect;
}

function verifyTerminalContainer(inspect, label) {
  if (
    inspect?.State?.Running !== false ||
    inspect.State.OOMKilled !== false ||
    inspect.RestartCount !== 0 ||
    inspect.State.ExitCode !== 0
  )
    throw new Error(`${label} terminal state is not clean`);
  return inspect;
}

function mountpointPreflightEvidence(plan, inspect, observedAtMs) {
  const proof = plan.manifest.dependencyMountpoint;
  const mounts = dockerMounts(inspect);
  return deepFreeze({
    schema: MOUNTPOINT_PREFLIGHT_SCHEMA,
    status: 'passed',
    runId: plan.manifest.runId,
    observedAtMs,
    candidateCommit: proof.candidateCommit,
    candidateTree: proof.candidateTree,
    candidateSourceSha256: proof.candidateSourceSha256,
    dependencyLockSha256: plan.manifest.candidate.lockSha256,
    sourceManifestSha256: proof.sourceManifestSha256,
    inheritedPathCount: proof.inheritedPathCount,
    inheritedFileCount: proof.inheritedFileCount,
    inheritedTopologySha256: proof.inheritedTopologySha256,
    sourceDirectory: proof.sourceDirectory,
    mountpointPath: proof.mountpointPath,
    onlyAddedPath: proof.onlyAddedPath,
    mountpointType: proof.mountpointType,
    mountpointEmptyBeforeMount: proof.mountpointEmptyBeforeMount,
    gitTreeVerified: proof.gitTreeVerified,
    containerName: plan.names.mountpointPreflight,
    containerId: inspect.Id,
    imageReference: plan.manifest.images.helper.reference,
    imageId: plan.manifest.images.helper.id,
    output: plan.mountpointPreflightOutput,
    exitCode: inspect.State.ExitCode,
    oomKilled: inspect.State.OOMKilled,
    restartCount: inspect.RestartCount,
    readonlyRootfs: inspect.HostConfig.ReadonlyRootfs,
    networkMode: inspect.HostConfig.NetworkMode,
    capDrop: inspect.HostConfig.CapDrop,
    securityOpt: inspect.HostConfig.SecurityOpt,
    mounts: [
      plan.manifest.inputs.candidate,
      plan.manifest.inputs.git,
      plan.manifest.inputs.dependencies,
    ].map((input) => ({
      type: input.type,
      source: input.source,
      destination: input.target,
      readOnly: mounts[input.target].RW === false,
    })),
    disposableContainerRemovedAfterInspection: true,
    distributedNodesContacted: false,
    resultReuse: false,
  });
}

function verifyMountpointPreflightEvidence(value, plan) {
  exactKeys(
    value,
    [
      'candidateCommit',
      'candidateSourceSha256',
      'candidateTree',
      'capDrop',
      'containerId',
      'containerName',
      'dependencyLockSha256',
      'disposableContainerRemovedAfterInspection',
      'distributedNodesContacted',
      'exitCode',
      'gitTreeVerified',
      'imageId',
      'imageReference',
      'inheritedFileCount',
      'inheritedPathCount',
      'inheritedTopologySha256',
      'mountpointEmptyBeforeMount',
      'mountpointPath',
      'mountpointType',
      'mounts',
      'networkMode',
      'observedAtMs',
      'onlyAddedPath',
      'oomKilled',
      'output',
      'readonlyRootfs',
      'restartCount',
      'resultReuse',
      'runId',
      'schema',
      'securityOpt',
      'sourceDirectory',
      'sourceManifestSha256',
      'status',
    ],
    'dependency mountpoint preflight evidence'
  );
  const proof = plan.manifest.dependencyMountpoint;
  const expectedMounts = [
    plan.manifest.inputs.candidate,
    plan.manifest.inputs.git,
    plan.manifest.inputs.dependencies,
  ].map((input) => ({
    type: input.type,
    source: input.source,
    destination: input.target,
    readOnly: true,
  }));
  if (
    value.schema !== MOUNTPOINT_PREFLIGHT_SCHEMA ||
    value.status !== 'passed' ||
    value.runId !== plan.manifest.runId ||
    !Number.isSafeInteger(value.observedAtMs) ||
    value.observedAtMs < 0 ||
    value.candidateCommit !== proof.candidateCommit ||
    value.candidateTree !== proof.candidateTree ||
    value.candidateSourceSha256 !== proof.candidateSourceSha256 ||
    value.dependencyLockSha256 !== plan.manifest.candidate.lockSha256 ||
    value.sourceManifestSha256 !== proof.sourceManifestSha256 ||
    value.inheritedPathCount !== proof.inheritedPathCount ||
    value.inheritedFileCount !== proof.inheritedFileCount ||
    value.inheritedTopologySha256 !== proof.inheritedTopologySha256 ||
    value.sourceDirectory !== proof.sourceDirectory ||
    value.mountpointPath !== proof.mountpointPath ||
    value.onlyAddedPath !== 'node_modules' ||
    value.mountpointType !== 'directory' ||
    value.mountpointEmptyBeforeMount !== true ||
    value.gitTreeVerified !== true ||
    value.containerName !== plan.names.mountpointPreflight ||
    typeof value.containerId !== 'string' ||
    value.containerId.length < 1 ||
    value.imageReference !== plan.manifest.images.helper.reference ||
    value.imageId !== plan.manifest.images.helper.id ||
    value.output !== plan.mountpointPreflightOutput ||
    value.exitCode !== 0 ||
    value.oomKilled !== false ||
    value.restartCount !== 0 ||
    value.readonlyRootfs !== true ||
    value.networkMode !== 'none' ||
    !sameArray(value.capDrop, ['ALL']) ||
    !sameArray(value.securityOpt, ['no-new-privileges']) ||
    !sameJson(value.mounts, expectedMounts) ||
    value.disposableContainerRemovedAfterInspection !== true ||
    value.distributedNodesContacted !== false ||
    value.resultReuse !== false
  )
    throw new Error('Retained dependency mountpoint preflight differs');
  return value;
}

function normalizeAdapters(value, callbacks = false) {
  plainObject(value, 'host containment adapters');
  const normalized = {
    fs: plainObject(value.fs, 'host containment filesystem adapter'),
    process: plainObject(value.process, 'host containment process adapter'),
    proof: callbacks
      ? plainObject(value.proof, 'host containment proof adapter')
      : value.proof,
  };
  for (const name of ['readFile', 'appendJsonLine'])
    requiredFunction(normalized.fs[name], `Filesystem adapter ${name}`);
  requiredFunction(normalized.process.probe, 'Process adapter probe');
  if (callbacks)
    requiredFunction(normalized.proof.request, 'Proof adapter request');
  return normalized;
}

function sameCandidate(actual, expected) {
  return ['repository', 'commit', 'tree', 'lockSha256', 'sourceSha256'].every(
    (key) => actual?.[key] === expected[key]
  );
}

function validateProof(
  value,
  manifest,
  expectedMode,
  { tokenRequired = false } = {}
) {
  plainObject(value, 'privileged proof response');
  const client = plainObject(
    value.clientProcess,
    'capability-free proof client observation'
  );
  if (
    value.verified !== true ||
    value.sourceSha256 !== manifest.candidate.sourceSha256 ||
    value.mode !== expectedMode ||
    typeof value.namespaceId !== 'string' ||
    !value.namespaceId ||
    !HASH64.test(value.rulesSha256 ?? '') ||
    client.capabilityEffectiveSet !== '0000000000000000' ||
    client.capabilityBoundingSet !== '0000000000000000' ||
    client.noNewPrivileges !== true ||
    !Number.isSafeInteger(client.pid) ||
    client.pid < 1 ||
    (tokenRequired && !/^[a-f0-9]{48}$/u.test(value.token ?? ''))
  )
    throw new Error(`Privileged ${expectedMode} proof is incomplete`);
  return value;
}

async function recordCallback(fsAdapter, manifest, value) {
  await fsAdapter.appendJsonLine(manifest.evidence.callbackLogPath, {
    ...value,
    evidenceSha256: canonicalSha256(value),
  });
}

function assertProbeReceipt(receiptValue, expectedExitCode, label) {
  plainObject(receiptValue, `${label} receipt`);
  const expectedStatus = expectedExitCode === 0 ? 'passed' : 'failed';
  if (
    receiptValue.exitCode !== expectedExitCode ||
    receiptValue.status !== expectedStatus ||
    receiptValue.lifecycle?.completed !== true ||
    receiptValue.lifecycle?.cleanupVerified !== true ||
    receiptValue.aborted ||
    receiptValue.timedOut ||
    receiptValue.signal ||
    typeof receiptValue.stdout !== 'string' ||
    typeof receiptValue.stderr !== 'string'
  )
    throw new Error(`${label} requires a complete native probe receipt`);
  return receiptValue;
}

function assertDistributedContext(context, manifest) {
  plainObject(context, 'distributed containment context');
  const relative = path.relative(
    manifest.paths.stateRoot,
    context.applicationRoot
  );
  const parts = relative.split('/');
  if (
    context.applicationId !==
      manifest.network.distributed.runtimeApplicationKey ||
    context.repositoryIdentitySha256 !== manifest.candidate.sourceSha256 ||
    context.runId !== manifest.runId ||
    context.unitId !== manifest.network.distributed.unitId ||
    !relative ||
    relative.startsWith('../') ||
    path.isAbsolute(relative) ||
    parts.length !== 2 ||
    !parts[0].startsWith(`${manifest.paths.snapshotDirectoryPrefix}-`) ||
    parts[1] !== manifest.paths.snapshotSourceDirectory
  )
    throw new Error('Distributed network context differs from containment');
  return context;
}

async function verifyRestoredBaseline(proof, manifest, baselineRulesSha256) {
  const restored = validateProof(
    await proof.request({
      op: 'observe',
      sourceSha256: manifest.candidate.sourceSha256,
    }),
    manifest,
    manifest.network.baselineMode
  );
  if (restored.rulesSha256 !== baselineRulesSha256)
    throw new Error('Original network policy was not restored exactly');
  return restored;
}

async function withNetworkLease({
  kind,
  operation,
  manifest,
  adapters,
  prepare,
}) {
  if (typeof operation !== 'function')
    throw new Error('Contained network operation must be a function');
  const mode = manifest.network[kind].mode;
  const baseline = validateProof(
    await adapters.proof.request({
      op: 'observe',
      sourceSha256: manifest.candidate.sourceSha256,
    }),
    manifest,
    manifest.network.baselineMode
  );
  let lease;
  let beginResponse;
  try {
    beginResponse = await adapters.proof.request({
      op: `${kind}-begin`,
      sourceSha256: manifest.candidate.sourceSha256,
      unitId: manifest.network[kind].unitId,
    });
    lease = validateProof(beginResponse, manifest, mode, {
      tokenRequired: true,
    });
    await prepare(lease);
  } catch (error) {
    let endError;
    const activeToken =
      lease?.token ??
      (/^[a-f0-9]{48}$/u.test(beginResponse?.token ?? '')
        ? beginResponse.token
        : null);
    if (activeToken) {
      try {
        const ended = validateProof(
          await adapters.proof.request({
            op: `${kind}-end`,
            sourceSha256: manifest.candidate.sourceSha256,
            unitId: manifest.network[kind].unitId,
            token: activeToken,
          }),
          manifest,
          manifest.network.baselineMode
        );
        if (
          ended.restoredToken !== activeToken ||
          ended.rulesSha256 !== baseline.rulesSha256
        )
          throw new Error(
            'Failed admission did not restore its exact original rules',
            { cause: error }
          );
      } catch (restoreError) {
        endError = restoreError;
      }
    }
    try {
      await verifyRestoredBaseline(
        adapters.proof,
        manifest,
        baseline.rulesSha256
      );
    } catch (restoreError) {
      throw new AggregateError(
        [error, ...(endError ? [endError] : []), restoreError],
        'Network admission failed and restoration is unverified',
        { cause: restoreError }
      );
    }
    if (endError)
      throw new AggregateError(
        [error, endError],
        'Network admission failed and restoration failed',
        { cause: error }
      );
    throw error;
  }

  let calls = 0;
  let result;
  let operationFailure;
  let restoreFailure;
  let logFailure;
  try {
    calls += 1;
    result = await operation();
  } catch (error) {
    operationFailure = error;
  }
  try {
    const ended = validateProof(
      await adapters.proof.request({
        op: `${kind}-end`,
        sourceSha256: manifest.candidate.sourceSha256,
        unitId: manifest.network[kind].unitId,
        token: lease.token,
      }),
      manifest,
      manifest.network.baselineMode
    );
    if (
      ended.restoredToken !== lease.token ||
      ended.rulesSha256 !== baseline.rulesSha256
    )
      throw new Error('Network lease did not restore its exact original rules');
    await verifyRestoredBaseline(
      adapters.proof,
      manifest,
      baseline.rulesSha256
    );
  } catch (error) {
    restoreFailure = error;
  }
  try {
    await recordCallback(adapters.fs, manifest, {
      event: `${kind}-end`,
      operationCalls: calls,
      operationFailure: operationFailure?.message ?? null,
      restoreFailure: restoreFailure?.message ?? null,
      tokenSha256: digest(Buffer.from(lease.token)),
    });
  } catch (error) {
    logFailure = error;
  }
  if (calls !== 1)
    throw new Error('Contained network operation was not invoked exactly once');
  const failures = [operationFailure, restoreFailure, logFailure].filter(
    Boolean
  );
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Contained operation, restoration, or evidence recording failed'
    );
  if (restoreFailure) throw restoreFailure;
  if (operationFailure) throw operationFailure;
  if (logFailure) throw logFailure;
  return result;
}

function verifyAuthenticatedGitEvidence(raw, manifest, localTagRefsSha256) {
  if (digest(raw) !== manifest.gitHistory.evidenceSha256)
    throw new Error('Authenticated Git history evidence changed');
  let value;
  try {
    value = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch (error) {
    throw new Error('Authenticated Git history evidence is not JSON', {
      cause: error,
    });
  }
  exactKeys(
    value,
    [
      'authenticatedCloneVerified',
      'beforeAfterRemoteRefsVerified',
      'branch',
      'cleanSourceVerified',
      'commit',
      'fetchedUsing',
      'lockSha256',
      'observedAt',
      'publishedBranchVerified',
      'remoteRefs',
      'repository',
      'schema',
      'shallow',
      'tagCount',
      'tagRefs',
      'tree',
    ],
    'authenticated Git history receipt'
  );
  if (
    value.schema !== 1 ||
    value.repository !== manifest.candidate.repository ||
    value.branch !== manifest.candidate.branch ||
    value.commit !== manifest.candidate.commit ||
    value.tree !== manifest.candidate.tree ||
    value.lockSha256 !== manifest.candidate.lockSha256 ||
    value.fetchedUsing !== 'authenticated Git fetch --tags' ||
    value.shallow !== false ||
    value.beforeAfterRemoteRefsVerified !== true ||
    value.publishedBranchVerified !== true ||
    value.authenticatedCloneVerified !== true ||
    value.cleanSourceVerified !== true ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(value.tagRefs) ||
    value.tagRefs.length < 1 ||
    value.tagCount !== value.tagRefs.length ||
    new Set(value.tagRefs).size !== value.tagRefs.length ||
    !sameArray(value.tagRefs, [...value.tagRefs].toSorted(compareText)) ||
    !Array.isArray(value.remoteRefs) ||
    value.remoteRefs.length < 1
  )
    throw new Error('Complete authenticated current Git closure is required');
  const refs = value.remoteRefs.map((entry) => {
    exactKeys(entry, ['oid', 'ref'], 'authenticated Git remote ref');
    if (!HASH40.test(entry.oid) || typeof entry.ref !== 'string')
      throw new Error('Authenticated Git remote ref is invalid');
    return entry;
  });
  if (
    new Set(refs.map(({ ref }) => ref)).size !== refs.length ||
    !sameArray(
      refs.map(({ ref }) => ref),
      refs.map(({ ref }) => ref).toSorted(compareText)
    ) ||
    refs.filter(({ ref }) => ref === 'HEAD').length !== 1 ||
    refs.filter(
      ({ oid, ref }) =>
        ref === `refs/heads/${manifest.candidate.branch}` &&
        oid === manifest.candidate.commit
    ).length !== 1
  )
    throw new Error('Authenticated Git remote refs are incomplete');
  const tagRefs = value.tagRefs.map((entry) => text(entry, 'Git tag ref'));
  const remoteTags = refs
    .filter(({ ref }) => ref.startsWith('refs/tags/') && !ref.endsWith('^{}'))
    .map(({ oid, ref }) => `${ref} ${oid}`)
    .toSorted(compareText);
  const tagSha256 = digest(Buffer.from(`${tagRefs.join('\n')}\n`));
  if (!sameArray(remoteTags, tagRefs) || tagSha256 !== localTagRefsSha256)
    throw new Error('Local tags differ from authenticated remote closure');
  return Object.freeze({
    verified: true,
    completeClosure: true,
    sourceSha256: manifest.candidate.sourceSha256,
    commit: manifest.candidate.commit,
    version: 'authenticated-git-current-complete-ref-closure-v1',
    localTagRefsSha256: tagSha256,
    remoteTagRefsSha256: tagSha256,
    remoteRefsSha256: canonicalSha256(refs),
    evidenceSha256: manifest.gitHistory.evidenceSha256,
  });
}

/** Create the exact five callbacks required by the production runner. */
export function createDistributedLinuxHostContainmentCallbacks(
  manifestValue,
  adapterValue
) {
  const manifest = normalizeManifest(manifestValue);
  const adapters = normalizeAdapters(adapterValue, true);
  const callbacks = {
    async verifyNetworkBoundary({ candidate }) {
      if (!sameCandidate(candidate, manifest.candidate))
        throw new Error('Network proof candidate differs from the manifest');
      const parent = validateProof(
        await adapters.proof.request({
          op: 'observe',
          sourceSha256: candidate.sourceSha256,
        }),
        manifest,
        manifest.network.baselineMode
      );
      const publicReceipt = assertProbeReceipt(
        await adapters.process.probe({
          kind: 'public-provider',
          endpoint: manifest.network.publicProbe,
        }),
        0,
        'Public provider probe'
      );
      const status = Number(publicReceipt.stdout.trim());
      if (
        !Number.isInteger(status) ||
        status < manifest.network.publicProbe.statusMinimum ||
        status > manifest.network.publicProbe.statusMaximum
      )
        throw new Error(
          'Public provider probe did not return an allowed status'
        );
      const privateReceipt = assertProbeReceipt(
        await adapters.process.probe({
          kind: 'private-provider',
          endpoint: manifest.network.privateProbe,
        }),
        manifest.network.privateProbe.expectedExitCode,
        'Private provider probe'
      );
      const result = Object.freeze({
        verified: true,
        isolated: true,
        deniesPrivateProviders: true,
        sourceSha256: candidate.sourceSha256,
        networkNamespace: parent.namespaceId,
        rulesSha256: parent.rulesSha256,
        evidenceSha256: canonicalSha256({
          parent,
          public: receiptEvidence(publicReceipt),
          private: receiptEvidence(privateReceipt),
        }),
        capabilityBoundingSet: parent.clientProcess.capabilityBoundingSet,
        noNewPrivileges: parent.clientProcess.noNewPrivileges,
        publicProbe: {
          host: manifest.network.publicProbe.host,
          httpsStatus: status,
        },
        privateProbe: {
          destination: `${manifest.network.privateProbe.host}:${manifest.network.privateProbe.port}`,
          refused: true,
          exitCode: manifest.network.privateProbe.expectedExitCode,
        },
      });
      await recordCallback(adapters.fs, manifest, {
        event: 'network-boundary',
        result,
      });
      return result;
    },

    async verifyDockerFixture({ candidate }) {
      if (!sameCandidate(candidate, manifest.candidate))
        throw new Error('Docker proof candidate differs from the manifest');
      const parent = validateProof(
        await adapters.proof.request({
          op: 'docker-observe',
          sourceSha256: candidate.sourceSha256,
        }),
        manifest,
        manifest.network.baselineMode
      );
      const docker = plainObject(parent.docker, 'private Docker proof');
      const expectedEndpoint = `unix://${manifest.paths.dockerSocket}`;
      if (
        !docker.daemonId ||
        docker.daemonId === manifest.outerDaemonId ||
        docker.outerDaemonId !== manifest.outerDaemonId ||
        docker.distinctDaemonVerified !== true ||
        docker.endpoint !== expectedEndpoint ||
        docker.bridgeCidr !== manifest.network.bridgeCidr ||
        docker.bridgeName !== manifest.network.bridgeName ||
        docker.fixtureName !== manifest.dockerFixture.name ||
        docker.fixtureImage !== manifest.dockerFixture.imageReference ||
        docker.bindSource !== manifest.dockerFixture.bindSource ||
        docker.bindTarget !== manifest.dockerFixture.bindTarget ||
        docker.containerPort !== manifest.dockerFixture.containerPort ||
        !HASH64.test(docker.executableSha256 ?? '') ||
        docker.scratchBindPathsVerified !== true ||
        docker.loopbackReachabilityVerified !== true ||
        docker.directReachabilityDenied !== true ||
        docker.daemonVerified !== true
      )
        throw new Error('Private Docker fixture proof is incomplete');
      const result = Object.freeze({
        verified: true,
        sourceSha256: candidate.sourceSha256,
        namespaceId: parent.namespaceId,
        evidenceSha256: canonicalSha256(parent),
        daemonVerified: true,
        daemonId: docker.daemonId,
        scratchBindPathsVerified: true,
        loopbackReachabilityVerified: true,
        endpoint: expectedEndpoint,
        executableSha256: docker.executableSha256,
      });
      await recordCallback(adapters.fs, manifest, {
        event: 'docker-fixture',
        result,
      });
      return result;
    },

    async verifyGitHistory({ candidate, localTagRefsSha256 }) {
      if (!sameCandidate(candidate, manifest.candidate))
        throw new Error('Git proof candidate differs from the manifest');
      const result = verifyAuthenticatedGitEvidence(
        await adapters.fs.readFile(manifest.gitHistory.evidencePath),
        manifest,
        sha(localTagRefsSha256, 'local tag refs hash')
      );
      await recordCallback(adapters.fs, manifest, {
        event: 'git-history',
        result,
      });
      return result;
    },

    async withRepositoryIsolation(operation, context) {
      if (
        !sameCandidate(context?.candidate, manifest.candidate) ||
        context?.unitId !== manifest.network.repository.unitId
      )
        throw new Error(
          'Repository isolation context differs from containment'
        );
      context.signal?.throwIfAborted();
      return withNetworkLease({
        kind: 'repository',
        operation,
        manifest,
        adapters,
        prepare: async (lease) => {
          const denials = await Promise.all([
            adapters.process.probe({
              kind: 'repository-public-denial',
              endpoint: manifest.network.publicProbe,
            }),
            adapters.process.probe({
              kind: 'repository-private-denial',
              endpoint: manifest.network.privateProbe,
            }),
          ]);
          denials.forEach((receipt, index) =>
            assertProbeReceipt(
              receipt,
              manifest.network.repository.deniedExitCode,
              `Repository denial probe ${index}`
            )
          );
          await recordCallback(adapters.fs, manifest, {
            event: 'repository-begin',
            lease: { mode: lease.mode, rulesSha256: lease.rulesSha256 },
            tokenSha256: digest(Buffer.from(lease.token)),
            denials: denials.map(receiptEvidence),
          });
        },
      });
    },

    async withDistributedNetwork(operation, context) {
      assertDistributedContext(context, manifest);
      context.signal?.throwIfAborted();
      return withNetworkLease({
        kind: 'distributed',
        operation,
        manifest,
        adapters,
        prepare: async (lease) => {
          if (
            !sameJson(
              lease.allowedEndpoints,
              manifest.network.distributed.endpoints
            )
          )
            throw new Error('Distributed proof allowed endpoints differ');
          await recordCallback(adapters.fs, manifest, {
            event: 'distributed-begin',
            lease: {
              mode: lease.mode,
              rulesSha256: lease.rulesSha256,
              allowedEndpoints: lease.allowedEndpoints,
            },
            tokenSha256: digest(Buffer.from(lease.token)),
          });
        },
      });
    },
  };
  return Object.freeze(callbacks);
}

function normalizeOuterAdapters(value) {
  plainObject(value, 'outer host containment adapters');
  const docker = plainObject(value.docker, 'outer Docker adapter');
  const fsAdapter = plainObject(value.fs, 'outer filesystem adapter');
  const processAdapter = plainObject(value.process, 'outer process adapter');
  for (const name of [
    'inspectContainer',
    'inspectImage',
    'inspectVolume',
    'run',
  ])
    requiredFunction(docker[name], `Docker adapter ${name}`);
  for (const name of [
    'createDirectoryExclusive',
    'readFile',
    'writeJsonExclusive',
  ])
    requiredFunction(fsAdapter[name], `Filesystem adapter ${name}`);
  for (const name of ['delay', 'now', 'uniqueToken'])
    requiredFunction(processAdapter[name], `Process adapter ${name}`);
  return { docker, fs: fsAdapter, process: processAdapter };
}

async function writeOuterEvidence(adapters, manifest, name, value) {
  if (!SAFE_FILE.test(name)) throw new Error('Unsafe outer evidence name');
  const target = resolveHostPath(manifest.evidence.outerDirectory, name);
  await adapters.fs.writeJsonExclusive(target, value);
  let readback;
  try {
    readback = JSON.parse(
      Buffer.from(await adapters.fs.readFile(target)).toString('utf8')
    );
  } catch (error) {
    throw new Error(`Outer evidence readback failed: ${name}`, {
      cause: error,
    });
  }
  if (!sameJson(readback, value))
    throw new Error(`Outer evidence readback differs: ${name}`);
  return target;
}

async function readOuterJsonEvidence(adapters, manifest, fileName) {
  const target = resolveHostPath(manifest.evidence.outerDirectory, fileName);
  const bytes = Buffer.from(await adapters.fs.readFile(target));
  if (!bytes.length || bytes.length > 16 * 1_048_576)
    throw new Error(`Outer evidence is empty or oversized: ${fileName}`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Outer evidence is not valid JSON: ${fileName}`, {
      cause: error,
    });
  }
  return Object.freeze({ bytes, value: plainObject(value, fileName) });
}

async function reconcileOuterEvidence(
  adapters,
  plan,
  {
    admissionFiles,
    commands,
    daemonRuntime,
    helperReady,
    lockedInputScan,
    mountpointPreflight,
    startAdmissionFiles,
  }
) {
  const records = new Map();
  for (const { fileName } of DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES)
    records.set(
      fileName,
      await readOuterJsonEvidence(adapters, plan.manifest, fileName)
    );

  const hostPlan = records.get('host-plan.json').value;
  if (!sameJson(hostPlan, plan))
    throw new Error('Retained outer host plan differs from the executed plan');

  const retainedMountpointPreflight = records.get(
    'mountpoint-preflight.json'
  ).value;
  verifyMountpointPreflightEvidence(retainedMountpointPreflight, plan);
  if (!sameJson(retainedMountpointPreflight, mountpointPreflight))
    throw new Error('Retained dependency mountpoint preflight differs');

  const volumeAdmission = records.get('volume-admission.json').value;
  const expectedVolumeAdmission = {
    schema: VOLUME_ADMISSION_SCHEMA,
    ownership: plan.ownership,
    names: plan.volumes.map(({ role, name }) => ({ role, name })),
    lockedInputScan,
    status: 'passed',
  };
  if (!sameJson(volumeAdmission, expectedVolumeAdmission))
    throw new Error('Retained outer volume admission differs');

  const hostAdmission = records.get('host-admission.json').value;
  exactKeys(
    hostAdmission,
    [
      'admissionFiles',
      'daemon',
      'daemonRuntime',
      'helper',
      'helperReady',
      'preparationAdmission',
      'schema',
      'status',
    ],
    'outer host admission evidence'
  );
  exactKeys(
    hostAdmission.preparationAdmission,
    ['beforeHelperStart', 'initial', 'schema', 'verifiedTwice'],
    'outer host preparation admission evidence'
  );
  if (
    hostAdmission.schema !== 'seerrng-distributed-linux-host-admission/v1' ||
    hostAdmission.status !== 'passed' ||
    hostAdmission.preparationAdmission.schema !==
      'seerrng-distributed-linux-host-preparation-admission/v1' ||
    hostAdmission.preparationAdmission.verifiedTwice !== true ||
    !sameJson(hostAdmission.admissionFiles, admissionFiles) ||
    !sameJson(hostAdmission.preparationAdmission.initial, admissionFiles) ||
    !sameJson(
      hostAdmission.preparationAdmission.beforeHelperStart,
      startAdmissionFiles
    ) ||
    !sameJson(hostAdmission.helperReady, helperReady) ||
    !sameJson(hostAdmission.daemonRuntime, daemonRuntime)
  )
    throw new Error('Retained outer host admission differs');
  verifyRunningContainer(
    verifyHelperInspect(hostAdmission.helper, plan),
    'Retained containment helper admission'
  );
  verifyRunningContainer(
    verifyDaemonInspect(hostAdmission.daemon, plan, hostAdmission.helper.Id),
    'Retained private daemon admission'
  );

  const terminalInspection = records.get('terminal-inspection.json').value;
  exactKeys(
    terminalInspection,
    [
      'cleanupVerified',
      'commands',
      'daemon',
      'helper',
      'observedAtMs',
      'ownership',
      'retainedAssets',
      'schema',
      'successful',
    ],
    'outer terminal inspection evidence'
  );
  if (
    terminalInspection.schema !==
      'seerrng-distributed-linux-terminal-inspection/v1' ||
    !Number.isSafeInteger(terminalInspection.observedAtMs) ||
    terminalInspection.observedAtMs < 0 ||
    terminalInspection.cleanupVerified !== true ||
    terminalInspection.retainedAssets !== true ||
    terminalInspection.successful !== true ||
    !sameJson(terminalInspection.ownership, plan.ownership) ||
    !sameJson(terminalInspection.commands, commands)
  )
    throw new Error('Retained outer terminal inspection differs');
  verifyTerminalContainer(
    verifyHelperInspect(terminalInspection.helper, plan),
    'Retained terminal containment helper'
  );
  verifyTerminalContainer(
    verifyDaemonInspect(
      terminalInspection.daemon,
      plan,
      terminalInspection.helper.Id
    ),
    'Retained terminal private daemon'
  );

  const hashes = Object.fromEntries(
    DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES.map(({ fileName, hashField }) => [
      hashField,
      digest(records.get(fileName).bytes),
    ])
  );
  return deepFreeze({
    schema: DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA,
    ...hashes,
    verified: true,
  });
}

async function verifyAdmissionFiles(fsAdapter, plan) {
  const result = [];
  for (const file of plan.admissionFiles) {
    const observed = digest(await fsAdapter.readFile(file.hostPath));
    if (observed !== file.rawSha256)
      throw new Error(`Immutable ${file.role} digest differs`);
    result.push({
      role: file.role,
      containerPath: file.containerPath,
      rawSha256: observed,
    });
  }
  return Object.freeze(result);
}

async function runDocker(
  adapters,
  args,
  id,
  signal,
  { cleanup = false, timeoutMs } = {}
) {
  const receipt = normalizeNativeReceipt(
    await adapters.docker.run(args, {
      id,
      signal,
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(cleanup ? { cleanup: true } : {}),
    }),
    `Docker command ${id}`
  );
  return receipt;
}

function parseRunningContainerIds(receipt, label) {
  const lines = receipt.stdout.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (
    lines.some(
      (entry) => entry !== entry.trim() || !/^[a-f0-9]{64}$/u.test(entry)
    )
  )
    throw new Error(`${label} returned a malformed container ID`);
  if (new Set(lines).size !== lines.length)
    throw new Error(`${label} returned duplicate container IDs`);
  return lines.toSorted(compareText);
}

function lockedInputDescriptors(manifest) {
  return ['candidate', 'git', 'dependencies', 'tool'].map((role) => ({
    role,
    ...manifest.inputs[role],
  }));
}

function matchingLockedInputs(mount, inputs) {
  if (!mount || typeof mount !== 'object' || Array.isArray(mount))
    throw new Error('Running container mount entry is malformed');
  if (!['bind', 'volume'].includes(mount.Type)) return [];
  if (typeof mount.RW !== 'boolean')
    throw new Error('Running container mount access mode is malformed');
  return inputs.filter((input) =>
    input.type === 'volume'
      ? mount.Type === 'volume' && mount.Name === input.source
      : mount.Type === 'bind' &&
        configuredBindOverlaps(mount.Source, input.source)
  );
}

async function scanRunningLockedInputMounts({ adapters, plan, run, signal }) {
  const initialReceipt = await run(
    ['ps', '--quiet', '--no-trunc'],
    'running-container-list-initial'
  );
  const initialIds = parseRunningContainerIds(
    initialReceipt,
    'Initial running-container list'
  );
  const lockedInputs = lockedInputDescriptors(plan.manifest);
  const containers = [];
  for (const id of initialIds) {
    signal?.throwIfAborted();
    const inspect = await adapters.docker.inspectContainer(id);
    if (
      inspect?.Id !== id ||
      inspect.State?.Running !== true ||
      typeof inspect.Name !== 'string' ||
      !inspect.Name ||
      !Array.isArray(inspect.Mounts)
    )
      throw new Error(
        `Running container changed during locked-input scan: ${id}`
      );
    const runtimeName = inspect.Name.slice(1);
    const staleOwnership =
      inspect.Config?.Labels?.[plan.manifest.ownershipLabelKey];
    const mode3RuntimeName =
      runtimeName.startsWith('mode3-') ||
      runtimeName.startsWith(`${plan.manifest.namePrefix}-`);
    const staleRuntimeName =
      mode3RuntimeName && !runtimeName.endsWith('-postgres');
    if (staleOwnership !== undefined || staleRuntimeName)
      throw new Error(`Stale Mode 3 runtime is still running: ${inspect.Name}`);
    const lockedMounts = [];
    for (const mount of inspect.Mounts) {
      const matches = matchingLockedInputs(mount, lockedInputs);
      for (const input of matches) {
        if (mount.RW !== false)
          throw new Error(
            `Running container ${inspect.Name} writes immutable input ${input.role}`
          );
        lockedMounts.push({
          role: input.role,
          type: input.type,
          source: input.source,
          destination: containerPath(
            mount.Destination,
            `running container ${id} locked mount destination`
          ),
          readOnly: true,
        });
      }
    }
    containers.push({
      id,
      name: inspect.Name,
      lockedMounts: lockedMounts.toSorted((left, right) =>
        compareText(
          `${left.role}\0${left.destination}`,
          `${right.role}\0${right.destination}`
        )
      ),
    });
  }
  signal?.throwIfAborted();
  const finalReceipt = await run(
    ['ps', '--quiet', '--no-trunc'],
    'running-container-list-final'
  );
  const finalIds = parseRunningContainerIds(
    finalReceipt,
    'Final running-container list'
  );
  if (!sameArray(finalIds, initialIds))
    throw new Error('Running container list changed during locked-input scan');
  return deepFreeze({
    schema: LOCKED_INPUT_SCAN_SCHEMA,
    status: 'passed',
    lockedInputs: lockedInputs.map(({ role, source, type }) => ({
      role,
      source,
      type,
    })),
    runningContainerIds: initialIds,
    containers,
    initialListReceipt: receiptEvidence(initialReceipt),
    finalListReceipt: receiptEvidence(finalReceipt),
    nonPostgresMode3RuntimeNamesExcluded: true,
    runningLockedInputWritersExcluded: true,
    stableListVerified: true,
  });
}

async function waitForDockerCheck({
  adapters,
  plan,
  args,
  id,
  container,
  signal,
}) {
  const deadline =
    adapters.process.now() + plan.manifest.proof.readinessTimeoutMs;
  let lastError;
  while (adapters.process.now() <= deadline) {
    signal?.throwIfAborted();
    try {
      return await runDocker(adapters, args, id, signal);
    } catch (error) {
      lastError = error;
      verifyRunningContainer(
        await adapters.docker.inspectContainer(container),
        container
      );
      await adapters.process.delay(plan.manifest.proof.readinessPollMs);
    }
  }
  throw new Error(`${id} timed out`, { cause: lastError });
}

async function readDaemonRuntime(adapters, plan, signal) {
  const read = async (pathValue, id) =>
    (
      await runDocker(
        adapters,
        ['exec', plan.names.daemon, 'cat', pathValue],
        id,
        signal
      )
    ).stdout.trim();
  const command = (
    await runDocker(
      adapters,
      ['exec', plan.names.daemon, 'cat', '/proc/1/cmdline'],
      'daemon-command-readback',
      signal
    )
  ).stdout
    .split('\0')
    .filter(Boolean);
  const result = Object.freeze({
    cpuMax: await read(
      plan.manifest.paths.daemonCpuMaxFile,
      'daemon-cpu-readback'
    ),
    memoryMax: await read(
      plan.manifest.paths.daemonMemoryMaxFile,
      'daemon-memory-readback'
    ),
    pidsMax: await read(
      plan.manifest.paths.daemonPidsMaxFile,
      'daemon-pids-readback'
    ),
    command,
  });
  const expected = plan.manifest.resources.daemon;
  const hosts = command.filter((entry) => entry.startsWith('--host='));
  if (
    result.cpuMax !== expected.expectedCpuMax ||
    result.memoryMax !== expected.expectedMemoryMax ||
    result.pidsMax !== expected.expectedPidsMax ||
    hosts.length !== 1 ||
    hosts[0] !== `--host=unix://${plan.manifest.paths.dockerSocket}` ||
    command.some((entry) => /tcp:\/\//u.test(entry)) ||
    !command.includes('--userland-proxy=false')
  )
    throw new Error('Private daemon live readback differs');
  return result;
}

function parseWaitExit(receipt) {
  const value = Number(receipt.stdout.trim());
  if (!Number.isSafeInteger(value) || value < 0 || value > 255)
    throw new Error('Helper wait did not return a bounded exit code');
  return value;
}

function parseHelperReady(receipt, manifest) {
  let value;
  try {
    value = JSON.parse(receipt.stdout);
  } catch (error) {
    throw new Error('Helper readiness evidence is not JSON', { cause: error });
  }
  plainObject(value, 'helper readiness evidence');
  if (
    value.verified !== true ||
    value.sourceSha256 !== manifest.candidate.sourceSha256 ||
    value.mode !== manifest.network.baselineMode ||
    value.bridgeCidr !== manifest.network.bridgeCidr ||
    value.bridgeOverlapVerified !== true ||
    !HASH64.test(value.rulesSha256 ?? '') ||
    !HASH64.test(value.observedNetworksSha256 ?? '') ||
    !Number.isSafeInteger(value.parentPid) ||
    value.parentPid < 1
  )
    throw new Error('Helper readiness evidence is incomplete');
  return value;
}

function verifyCleanupArtifact(value, manifest) {
  exactKeys(
    value,
    [
      'childExitCode',
      'cleanupVerified',
      'errors',
      'networkRestored',
      'proofServerStopped',
      'resultReuse',
      'schema',
      'uncertainIds',
    ],
    'terminal nested cleanup artifact'
  );
  if (
    value.schema !== manifest.evidence.cleanupSchema ||
    value.cleanupVerified !== true ||
    value.childExitCode !== 0 ||
    value.networkRestored !== true ||
    value.proofServerStopped !== true ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0 ||
    !Array.isArray(value.uncertainIds) ||
    value.uncertainIds.length !== 0 ||
    value.resultReuse !== false
  )
    throw new Error('Terminal nested cleanup proof is incomplete');
  return value;
}

function verifyContainedRunArtifact(value, manifest) {
  plainObject(value, 'contained run verification');
  const hashes = Object.values(CONTAINED_ARTIFACT_HASH_FIELDS);
  if (
    value.schema !== 'seerrng-distributed-linux-contained-run-success/v2' ||
    value.runId !== manifest.runId ||
    value.status !== 'passed' ||
    value.ok !== true ||
    value.resultReuse !== false ||
    !HASH64.test(value.updatedProfileSha256 ?? '') ||
    hashes.some((name) => !HASH64.test(value[name] ?? ''))
  )
    throw new Error('Contained run verification is incomplete');
  return value;
}

function verifyCallbackLedger(bytes) {
  const lines = Buffer.from(bytes).toString('utf8').split('\n').filter(Boolean);
  if (!lines.length) throw new Error('Containment callback ledger is empty');
  const events = lines.map((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Containment callback ledger line ${index} is not JSON`, {
        cause: error,
      });
    }
    plainObject(value, `containment callback ledger line ${index}`);
    const { evidenceSha256, ...evidence } = value;
    if (evidenceSha256 !== canonicalSha256(evidence))
      throw new Error('Containment callback ledger evidence hash differs');
    return value;
  });
  const required = [
    'network-boundary',
    'docker-fixture',
    'git-history',
    'repository-begin',
    'repository-end',
    'distributed-begin',
    'distributed-end',
  ];
  for (const event of required)
    if (events.filter((value) => value.event === event).length !== 1)
      throw new Error(`Containment callback event count differs: ${event}`);
  const tokenSha256 = {};
  for (const kind of ['repository', 'distributed']) {
    const begin = events.find((value) => value.event === `${kind}-begin`);
    const end = events.find((value) => value.event === `${kind}-end`);
    if (
      !HASH64.test(begin.tokenSha256 ?? '') ||
      end.tokenSha256 !== begin.tokenSha256 ||
      end.operationCalls !== 1 ||
      end.operationFailure !== null ||
      end.restoreFailure !== null
    )
      throw new Error(`Containment callback ${kind} lifecycle differs`);
    tokenSha256[kind] = begin.tokenSha256;
  }
  return deepFreeze({ eventCount: events.length, tokenSha256, verified: true });
}

function verifyProofParentLedger(bytes, callbackLedger, manifest) {
  const events = Buffer.from(bytes)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return plainObject(
          JSON.parse(line),
          `proof parent ledger line ${index}`
        );
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error(`Proof parent ledger line ${index} is not JSON`, {
            cause: error,
          });
        throw error;
      }
    });
  for (const event of [
    'ready',
    'docker-hooks-ready',
    'fixture-created',
    'terminal-network',
    'fixture-cleanup',
    'proof-server-stopped',
  ])
    if (events.filter((value) => value.event === event).length !== 1)
      throw new Error(`Proof parent event count differs: ${event}`);
  const ready = events.find((value) => value.event === 'ready');
  const terminal = events.find((value) => value.event === 'terminal-network');
  const fixture = events.find((value) => value.event === 'fixture-created');
  const cleanup = events.find((value) => value.event === 'fixture-cleanup');
  if (
    ready.sourceSha256 !== manifest.candidate.sourceSha256 ||
    ready.mode !== manifest.network.baselineMode ||
    terminal.mode !== manifest.network.baselineMode ||
    terminal.rulesSha256 !== ready.rulesSha256 ||
    !fixture.fixtureId ||
    cleanup.fixtureId !== fixture.fixtureId ||
    !Array.isArray(cleanup.uncertainIds) ||
    cleanup.uncertainIds.length !== 0
  )
    throw new Error('Proof parent terminal reconciliation differs');
  for (const kind of ['repository', 'distributed']) {
    const begin = events.filter(
      (value) => value.transition === `${kind}-begin`
    );
    const end = events.filter((value) => value.transition === `${kind}-end`);
    if (
      begin.length !== 1 ||
      end.length !== 1 ||
      typeof begin[0].token !== 'string' ||
      end[0].restoredToken !== begin[0].token ||
      end[0].guardFailure !== null ||
      digest(Buffer.from(begin[0].token)) !== callbackLedger.tokenSha256[kind]
    )
      throw new Error(`Proof parent ${kind} lease reconciliation differs`);
  }
  return Object.freeze({ eventCount: events.length, verified: true });
}

async function copyRetainedArtifacts(adapters, plan, signal) {
  const receipts = [];
  let cleanup;
  let callbackLedger;
  let containedRun;
  let proofParentBytes;
  for (const artifact of plan.manifest.evidence.artifacts) {
    const target = resolveHostPath(
      plan.manifest.evidence.outerDirectory,
      artifact.fileName
    );
    const receipt = await runDocker(
      adapters,
      ['cp', `${plan.names.helper}:${artifact.containerPath}`, target],
      `retain-${artifact.fileName}`,
      signal
    );
    const bytes = await adapters.fs.readFile(target);
    let parsed;
    if (artifact.role === 'nested-cleanup') {
      try {
        parsed = verifyCleanupArtifact(
          JSON.parse(Buffer.from(bytes).toString('utf8')),
          plan.manifest
        );
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error('Terminal cleanup artifact is not JSON', {
            cause: error,
          });
        throw error;
      }
      cleanup = parsed;
    } else if (artifact.role === 'callback-ledger') {
      callbackLedger = verifyCallbackLedger(bytes);
    } else if (artifact.role === 'contained-run-verification') {
      try {
        containedRun = verifyContainedRunArtifact(
          JSON.parse(Buffer.from(bytes).toString('utf8')),
          plan.manifest
        );
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error('Contained run verification is not JSON', {
            cause: error,
          });
        throw error;
      }
    } else if (artifact.role === 'proof-parent-ledger') {
      proofParentBytes = bytes;
    }
    receipts.push(
      Object.freeze({
        fileName: artifact.fileName,
        role: artifact.role,
        containerPath: artifact.containerPath,
        bytes: Buffer.byteLength(bytes),
        sha256: digest(bytes),
        command: receiptEvidence(receipt),
      })
    );
  }
  if (!cleanup) throw new Error('Terminal cleanup artifact was not collected');
  if (!callbackLedger || !containedRun)
    throw new Error('Required contained-run evidence was not reconciled');
  if (!proofParentBytes)
    throw new Error('Proof parent ledger was not collected');
  const artifactHashes = Object.fromEntries(
    receipts.map(({ role, sha256 }) => [role, sha256])
  );
  for (const [role, field] of Object.entries(CONTAINED_ARTIFACT_HASH_FIELDS))
    if (artifactHashes[role] !== containedRun[field])
      throw new Error(`Contained run artifact hash differs: ${role}`);
  const proofParentLedger = verifyProofParentLedger(
    proofParentBytes,
    callbackLedger,
    plan.manifest
  );
  return Object.freeze({
    callbackLedger,
    cleanup,
    containedRun,
    proofParentLedger,
    receipts,
  });
}

async function executeMountpointPreflight({ adapters, cleanupRun, plan, run }) {
  let inspect;
  let verifiedContainerId;
  let primaryError;
  const cleanupErrors = [];
  try {
    await run(plan.mountpointPreflight, 'create-mountpoint-preflight');
    const createdInspect = verifyMountpointPreflightInspect(
      await adapters.docker.inspectContainer(plan.names.mountpointPreflight),
      plan
    );
    verifiedContainerId = createdInspect.Id;
    const startReceipt = await run(
      bindContainerStartToId(
        plan.startMountpointPreflight,
        plan.names.mountpointPreflight,
        verifiedContainerId
      ),
      'start-mountpoint-preflight'
    );
    if (startReceipt.stdout.trim() !== plan.mountpointPreflightOutput)
      throw new Error('Dependency mountpoint preflight output differs');
    const terminalInspect = verifyMountpointPreflightInspect(
      await adapters.docker.inspectContainer(plan.names.mountpointPreflight),
      plan
    );
    if (terminalInspect.Id !== verifiedContainerId)
      throw new Error('Dependency mountpoint preflight identity changed');
    inspect = verifyTerminalContainer(
      terminalInspect,
      'Dependency mountpoint preflight'
    );
  } catch (error) {
    primaryError = error;
  } finally {
    let observedContainer;
    let reconcileError;
    for (
      let attempt = 0;
      attempt < MOUNTPOINT_PREFLIGHT_RECONCILE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        observedContainer = await adapters.docker.inspectContainer(
          plan.names.mountpointPreflight
        );
        reconcileError = undefined;
      } catch (error) {
        reconcileError = error;
      }
      if (observedContainer) break;
      if (attempt + 1 < MOUNTPOINT_PREFLIGHT_RECONCILE_ATTEMPTS) {
        try {
          await adapters.process.delay(MOUNTPOINT_PREFLIGHT_RECONCILE_DELAY_MS);
        } catch (error) {
          cleanupErrors.push(error);
          break;
        }
      }
    }
    if (observedContainer) {
      try {
        const observedContainerId = verifyMountpointPreflightInspect(
          observedContainer,
          plan
        ).Id;
        if (
          verifiedContainerId !== undefined &&
          observedContainerId !== verifiedContainerId
        )
          cleanupErrors.push(
            new Error('Dependency mountpoint preflight identity changed')
          );
        else verifiedContainerId = observedContainerId;
      } catch (error) {
        cleanupErrors.push(
          new Error(
            'Dependency mountpoint preflight ownership topology is unproven',
            { cause: error }
          )
        );
      }
    } else {
      if (reconcileError) cleanupErrors.push(reconcileError);
      if (!primaryError || verifiedContainerId !== undefined)
        cleanupErrors.push(
          new Error(
            'Dependency mountpoint preflight disappeared before planned removal'
          )
        );
    }
    if (verifiedContainerId !== undefined) {
      try {
        await cleanupRun(
          bindContainerRemovalToId(
            plan.forceRemoveMountpointPreflight,
            plan.names.mountpointPreflight,
            verifiedContainerId
          ),
          'force-remove-mountpoint-preflight'
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        const remainingContainer =
          await adapters.docker.inspectContainer(verifiedContainerId);
        if (remainingContainer !== null)
          cleanupErrors.push(
            new Error(
              'Disposable dependency mountpoint preflight was not removed'
            )
          );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (primaryError || cleanupErrors.length) {
    if (primaryError && !cleanupErrors.length) throw primaryError;
    throw new AggregateError(
      [...(primaryError ? [primaryError] : []), ...cleanupErrors],
      primaryError
        ? 'Dependency mountpoint preflight and cleanup failed'
        : 'Dependency mountpoint preflight cleanup failed'
    );
  }
  if (!inspect)
    throw new Error('Dependency mountpoint preflight has no terminal inspect');
  const evidence = mountpointPreflightEvidence(
    plan,
    inspect,
    adapters.process.now()
  );
  await writeOuterEvidence(
    adapters,
    plan.manifest,
    'mountpoint-preflight.json',
    evidence
  );
  return evidence;
}

/**
 * Execute the fresh Windows/Docker outer lifecycle. Stopped labeled assets are
 * retained for review. The final marker is deliberately the final write.
 */
export async function executeDistributedLinuxHostContainment(
  planValue,
  adapterValue,
  { signal } = {}
) {
  const plan = plainObject(planValue, 'distributed Linux host plan');
  if (plan.schema !== DISTRIBUTED_LINUX_HOST_PLAN_SCHEMA)
    throw new Error('Unsupported distributed Linux host plan schema');
  const adapters = normalizeOuterAdapters(adapterValue);
  const { manifest } = plan;
  await adapters.fs.createDirectoryExclusive(manifest.evidence.outerDirectory);
  await writeOuterEvidence(adapters, manifest, 'host-plan.json', plan);
  let helperCreated = false;
  let daemonCreated = false;
  let helperWaited = false;
  let primaryError;
  let collected;
  let daemonRuntime;
  let helperInspect;
  let daemonInspect;
  let helperReady;
  let lockedInputScan;
  let mountpointPreflight;
  let admissionFiles;
  let startAdmissionFiles;
  let outerEvidence;
  const commands = [];
  const run = async (args, id) => {
    const receipt = await runDocker(adapters, args, id, signal);
    commands.push({ id, receipt: receiptEvidence(receipt) });
    return receipt;
  };
  const cleanupRun = async (args, id) => {
    const receipt = await runDocker(adapters, args, id, undefined, {
      cleanup: true,
      timeoutMs: plan.terminalCleanup.hostCommandTimeoutMs,
    });
    commands.push({ id, receipt: receiptEvidence(receipt) });
    return receipt;
  };
  try {
    admissionFiles = await verifyAdmissionFiles(adapters.fs, plan);
    for (const [kind, name] of [
      ['container', plan.names.mountpointPreflight],
      ['container', plan.names.helper],
      ['container', plan.names.daemon],
      ['volume', plan.names.state],
      ['volume', plan.names.logs],
      ['volume', plan.names.daemonData],
    ]) {
      const existing =
        kind === 'container'
          ? await adapters.docker.inspectContainer(name)
          : await adapters.docker.inspectVolume(name);
      if (existing)
        throw new Error(`Fresh ${kind} name is already present: ${name}`);
    }
    for (const image of [manifest.images.helper, manifest.images.daemon]) {
      const inspected = await adapters.docker.inspectImage(image.reference);
      if (inspected?.Id !== image.id)
        throw new Error(`Immutable image identity differs: ${image.reference}`);
    }
    for (const name of new Set(
      Object.values(manifest.inputs)
        .filter(({ type }) => type === 'volume')
        .map(({ source }) => source)
    ))
      verifyLocalVolume(await adapters.docker.inspectVolume(name), name);
    const outerInfo = await run(
      ['info', '--format', '{{json .ID}}'],
      'outer-daemon-identity'
    );
    let outerDaemonId;
    try {
      outerDaemonId = JSON.parse(outerInfo.stdout.trim());
    } catch (error) {
      throw new Error('Outer Docker daemon identity is not JSON', {
        cause: error,
      });
    }
    if (outerDaemonId !== manifest.outerDaemonId)
      throw new Error('Outer Docker daemon identity differs');
    lockedInputScan = await scanRunningLockedInputMounts({
      adapters,
      plan,
      run,
      signal,
    });
    mountpointPreflight = await executeMountpointPreflight({
      adapters,
      cleanupRun,
      plan,
      run,
    });
    for (const volume of plan.volumes) {
      await run(volume.create, `create-${volume.role}-volume`);
      verifyVolume(
        await adapters.docker.inspectVolume(volume.name),
        volume.name,
        plan.ownership
      );
    }
    await writeOuterEvidence(adapters, manifest, 'volume-admission.json', {
      schema: VOLUME_ADMISSION_SCHEMA,
      ownership: plan.ownership,
      names: plan.volumes.map(({ role, name }) => ({ role, name })),
      lockedInputScan,
      status: 'passed',
    });

    await run(plan.helper, 'create-helper');
    helperCreated = true;
    helperInspect = verifyHelperInspect(
      await adapters.docker.inspectContainer(plan.names.helper),
      plan
    );
    startAdmissionFiles = await verifyAdmissionFiles(adapters.fs, plan);
    if (!sameJson(admissionFiles, startAdmissionFiles))
      throw new Error('Immutable proof inputs changed before helper start');
    await run(plan.startHelper, 'start-helper');
    verifyRunningContainer(
      await adapters.docker.inspectContainer(plan.names.helper),
      'Containment helper'
    );
    await waitForDockerCheck({
      adapters,
      plan,
      args: [
        'exec',
        plan.names.helper,
        'test',
        '-f',
        manifest.paths.helperReadyFile,
      ],
      id: 'helper-readiness',
      container: plan.names.helper,
      signal,
    });
    helperReady = parseHelperReady(
      await run(
        ['exec', plan.names.helper, 'cat', manifest.paths.helperReadyFile],
        'helper-readiness-readback'
      ),
      manifest
    );
    await run(
      [
        'exec',
        plan.names.helper,
        'test',
        '-d',
        `/proc/${helperReady.parentPid}`,
      ],
      'proof-parent-liveness'
    );

    await run(plan.daemon, 'create-daemon');
    daemonCreated = true;
    daemonInspect = verifyDaemonInspect(
      await adapters.docker.inspectContainer(plan.names.daemon),
      plan,
      helperInspect.Id
    );
    await run(plan.startDaemon, 'start-daemon');
    verifyRunningContainer(
      await adapters.docker.inspectContainer(plan.names.daemon),
      'Private Docker daemon'
    );
    await waitForDockerCheck({
      adapters,
      plan,
      args: [
        'exec',
        plan.names.helper,
        'test',
        '-S',
        manifest.paths.dockerSocket,
      ],
      id: 'daemon-socket-readiness',
      container: plan.names.daemon,
      signal,
    });
    await waitForDockerCheck({
      adapters,
      plan,
      args: [
        'exec',
        plan.names.helper,
        'test',
        '-S',
        manifest.paths.proofSocket,
      ],
      id: 'proof-socket-readiness',
      container: plan.names.helper,
      signal,
    });
    daemonRuntime = await readDaemonRuntime(adapters, plan, signal);
    await writeOuterEvidence(adapters, manifest, 'host-admission.json', {
      schema: 'seerrng-distributed-linux-host-admission/v1',
      helper: helperInspect,
      helperReady,
      admissionFiles,
      preparationAdmission: {
        schema: 'seerrng-distributed-linux-host-preparation-admission/v1',
        initial: admissionFiles,
        beforeHelperStart: startAdmissionFiles,
        verifiedTwice: true,
      },
      daemon: daemonInspect,
      daemonRuntime,
      status: 'passed',
    });

    const waitReceipt = await run(plan.waitHelper, 'wait-helper');
    helperWaited = true;
    const helperExitCode = parseWaitExit(waitReceipt);
    if (helperExitCode !== 0)
      throw new Error(`Contained engine exited with status ${helperExitCode}`);
    verifyTerminalContainer(
      await adapters.docker.inspectContainer(plan.names.helper),
      'Containment helper'
    );
    verifyRunningContainer(
      await adapters.docker.inspectContainer(plan.names.daemon),
      'Private Docker daemon after helper completion'
    );
    collected = await copyRetainedArtifacts(adapters, plan, signal);
  } catch (error) {
    primaryError = error;
  } finally {
    const terminalFailures = [];
    if (helperCreated && !helperWaited) {
      try {
        const helper = await adapters.docker.inspectContainer(
          plan.names.helper
        );
        if (helper?.State?.Running)
          await cleanupRun(plan.stopHelper, 'stop-helper');
      } catch (error) {
        terminalFailures.push(error);
      }
    }
    if (daemonCreated) {
      try {
        const daemon = await adapters.docker.inspectContainer(
          plan.names.daemon
        );
        if (daemon?.State?.Running)
          await cleanupRun(plan.stopDaemon, 'stop-daemon');
      } catch (error) {
        terminalFailures.push(error);
      }
    }
    try {
      helperInspect = helperCreated
        ? await adapters.docker.inspectContainer(plan.names.helper)
        : null;
      daemonInspect = daemonCreated
        ? await adapters.docker.inspectContainer(plan.names.daemon)
        : null;
      if (!primaryError) {
        verifyTerminalContainer(helperInspect, 'Containment helper');
        verifyTerminalContainer(daemonInspect, 'Private Docker daemon');
      }
      await writeOuterEvidence(adapters, manifest, 'terminal-inspection.json', {
        schema: 'seerrng-distributed-linux-terminal-inspection/v1',
        observedAtMs: adapters.process.now(),
        helper: helperInspect,
        daemon: daemonInspect,
        cleanupVerified: collected?.cleanup?.cleanupVerified === true,
        retainedAssets: true,
        ownership: plan.ownership,
        commands,
        successful: !primaryError && terminalFailures.length === 0,
      });
    } catch (error) {
      terminalFailures.push(error);
    }
    if (terminalFailures.length) {
      const terminalError = new AggregateError(
        terminalFailures,
        'Outer containment terminal proof failed'
      );
      primaryError = primaryError
        ? new AggregateError(
            [primaryError, terminalError],
            'Contained run and terminal cleanup both failed'
          )
        : terminalError;
    }
  }
  if (!primaryError) {
    try {
      if (!collected?.cleanup?.cleanupVerified)
        throw new Error('Contained run has no terminal cleanup proof');
      outerEvidence = await reconcileOuterEvidence(adapters, plan, {
        admissionFiles,
        commands,
        daemonRuntime,
        helperReady,
        lockedInputScan,
        mountpointPreflight,
        startAdmissionFiles,
      });
    } catch (error) {
      primaryError = error;
    }
  }
  if (primaryError) {
    try {
      await writeOuterEvidence(adapters, manifest, 'failure.json', {
        schema: 'seerrng-distributed-linux-host-failure/v1',
        runId: manifest.runId,
        name: primaryError.name,
        message: primaryError.message,
        status: 'failed',
      });
    } catch (evidenceError) {
      throw new AggregateError(
        [primaryError, evidenceError],
        'Outer containment and failure evidence both failed',
        { cause: evidenceError }
      );
    }
    throw primaryError;
  }
  const result = deepFreeze({
    schema: DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA,
    runId: manifest.runId,
    status: 'passed',
    ownership: plan.ownership,
    names: plan.names,
    retainedAssets: true,
    resultReuse: false,
    daemonRuntime,
    artifacts: collected.receipts,
    containedRun: collected.containedRun,
    callbackLedger: collected.callbackLedger,
    proofParentLedger: collected.proofParentLedger,
    terminalCleanup: collected.cleanup,
    mountpointPreflight,
    outerEvidence,
    terminal: {
      helperExitCode: helperInspect.State.ExitCode,
      daemonExitCode: daemonInspect.State.ExitCode,
      cleanupVerified: true,
    },
  });
  // This must remain the last filesystem mutation on the passing path.
  await writeOuterEvidence(
    adapters,
    manifest,
    DISTRIBUTED_LINUX_HOST_FINAL_MARKER,
    result
  );
  return result;
}

/**
 * Build both the outer host lifecycle and the exact inner callback object.
 * The caller may provide separate adapter instances on the Windows host and
 * inside the Linux helper. The privileged proof parent owns exactly the
 * reviewed network capabilities; its engine child is capability-free.
 */
export function createDistributedLinuxHostContainment(
  manifestValue,
  { outer, inner, preparationRequest } = {}
) {
  const outerAdapters = normalizeOuterAdapters(outer);
  const uniqueToken = token(
    outerAdapters.process.uniqueToken(),
    'unique containment token',
    32
  );
  const plan = createDistributedLinuxHostContainmentPlan(manifestValue, {
    preparationRequest,
    uniqueToken,
  });
  const containment = inner
    ? createDistributedLinuxHostContainmentCallbacks(manifestValue, inner)
    : null;
  return Object.freeze({
    plan,
    containment,
    executeHostLifecycle: (options) =>
      executeDistributedLinuxHostContainment(plan, outerAdapters, options),
  });
}

export function assertDistributedLinuxHostContainmentCallbacks(value) {
  exactKeys(
    value,
    CONTAINMENT_CALLBACK_KEYS,
    'distributed Linux host containment callbacks'
  );
  for (const name of CONTAINMENT_CALLBACK_KEYS)
    requiredFunction(value[name], `Containment callback ${name}`);
  return value;
}
