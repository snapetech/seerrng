// Copyright (c) snapetech and SeerrNG contributors.
// Safe bridge from a locally derived tests-only plan to one selected task.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createPlan,
  executePlan,
  preflight,
  runCommand,
} from '../../../bin/local-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { withGitBashOnPath } from '../../../bin/platform-tools.mjs';
import {
  createDistributedNativeTapCaseLedger,
  createDistributedNativeVitestCaseLedger,
  isExplicitlySkippedDistributedNativeCaseLedger,
  verifyDistributedNativeCaseLedger,
} from './distributed-native-case-ledger.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA =
  'seerrng-distributed-native-candidate/v1';
export const DISTRIBUTED_NATIVE_CATALOG_SCHEMA =
  'seerrng-distributed-native-catalog/v1';
export const DISTRIBUTED_NATIVE_TASK_SCHEMA =
  'seerrng-distributed-native-task/v1';
export const DISTRIBUTED_NATIVE_TASK_REQUEST_SCHEMA =
  'seerrng-distributed-native-task-request/v1';
export const DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA =
  'seerrng-distributed-native-task-result/v2';
export const DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_DISTRIBUTED_NATIVE_TASKS = 65_536;

const INVENTORY_IDENTITY_SCHEMA =
  'seerrng-distributed-native-inventory-identity/v1';
const TASK_IDENTITY_SCHEMA = 'seerrng-distributed-native-task-identity/v1';
const LOCKFILE = 'pnpm-lock.yaml';
const HASH64 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CANDIDATE_CORE_KEYS = [
  'commitSha',
  'lockfilePath',
  'lockfileSha256',
  'schema',
  'treeSha',
];
const CANDIDATE_KEYS = [...CANDIDATE_CORE_KEYS, 'candidateSha256'];
const TASK_KEYS = ['adapterId', 'files', 'schema', 'taskId'];
const CATALOG_CORE_KEYS = [
  'applicationId',
  'candidate',
  'inventorySha256',
  'platform',
  'schema',
  'tasks',
];
const CATALOG_KEYS = [...CATALOG_CORE_KEYS, 'catalogSha256'];
const REQUEST_KEYS = ['candidateSha256', 'files', 'schema', 'taskId'];
const NATIVE_RECEIPT_KEYS = [
  'aborted',
  'exitCode',
  'lifecycle',
  'signal',
  'status',
  'stderr',
  'stderrBytes',
  'stderrSha256',
  'stderrTruncated',
  'stdout',
  'stdoutBytes',
  'stdoutSha256',
  'stdoutTruncated',
  'timedOut',
  'wallMs',
];
const NATIVE_RECEIPT_LIFECYCLE_KEYS = [
  'cleanupError',
  'cleanupVerified',
  'completed',
  'spawned',
];
const TASK_RESULT_CORE_KEYS = [
  'adapterId',
  'applicationId',
  'candidateSha256',
  'caseLedger',
  'catalogSha256',
  'files',
  'receipt',
  'schema',
  'status',
  'taskId',
  'totals',
  'wallMs',
];
const TASK_RESULT_KEYS = [...TASK_RESULT_CORE_KEYS, 'resultSha256'];

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

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function gitObject(value, label) {
  if (typeof value !== 'string' || !GIT_OBJECT.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function normalizeRoot(value) {
  if (typeof value !== 'string' || !value || !isAbsolute(value))
    throw new Error('Distributed native root must be an absolute local path');
  const absolute = resolve(value);
  const metadata = lstatSync(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Distributed native root must be an ordinary directory');
  return realpathSync(absolute);
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = resolve(value).split(sep).join('/').replace(/\/$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

function git(root, args, label) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
  );
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GCM_INTERACTIVE = 'Never';
  const result = spawnSync('git', ['-C', root, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '')
      .trim()
      .slice(0, 512);
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function requireTrackedLockfile(root) {
  const lockfile = resolve(root, LOCKFILE);
  const metadata = lstatSync(lockfile);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('Distributed native lockfile must be an ordinary file');
  const resolved = realpathSync(lockfile);
  const child = relative(root, resolved);
  if (child !== LOCKFILE || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('Distributed native lockfile escaped the configured root');
  const tracked = git(
    root,
    ['ls-files', '--error-unmatch', '--', LOCKFILE],
    'Distributed native lockfile tracking check'
  ).trim();
  if (tracked.split(/\r?\n/).join('/') !== LOCKFILE)
    throw new Error('Distributed native lockfile is not tracked exactly once');
  return readFileSync(resolved);
}

function createCandidate(rootValue) {
  const root = normalizeRoot(rootValue);
  const topLevel = git(
    root,
    ['rev-parse', '--show-toplevel'],
    'Distributed native Git root check'
  ).trim();
  if (!samePath(realpathSync(topLevel), root))
    throw new Error('Distributed native root is not the exact Git top level');
  if (
    git(
      root,
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ],
      'Distributed native Git cleanliness check'
    ).length !== 0
  )
    throw new Error('Distributed native workspace must be clean');
  const core = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: gitObject(
      git(
        root,
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        'Distributed native commit resolution'
      ).trim(),
      'distributed native commit'
    ),
    treeSha: gitObject(
      git(
        root,
        ['rev-parse', '--verify', 'HEAD^{tree}'],
        'Distributed native tree resolution'
      ).trim(),
      'distributed native tree'
    ),
    lockfilePath: LOCKFILE,
    lockfileSha256: createHash('sha256')
      .update(requireTrackedLockfile(root))
      .digest('hex'),
  };
  return deepFreeze({
    ...core,
    candidateSha256: canonicalJsonSha256(core),
  });
}

function normalizeCandidate(value, label = 'distributed native candidate') {
  exactKeys(value, CANDIDATE_KEYS, label);
  if (value.schema !== DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA)
    throw new Error('Unsupported distributed native candidate schema');
  const core = {
    schema: value.schema,
    commitSha: gitObject(value.commitSha, `${label} commit`),
    treeSha: gitObject(value.treeSha, `${label} tree`),
    lockfilePath:
      value.lockfilePath === LOCKFILE
        ? value.lockfilePath
        : (() => {
            throw new Error(
              'Distributed native candidate has another lockfile'
            );
          })(),
    lockfileSha256: digest(value.lockfileSha256, `${label} lockfile hash`),
  };
  const candidateSha256 = digest(
    value.candidateSha256,
    `${label} identity hash`
  );
  if (candidateSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed native candidate identity is invalid');
  return { ...core, candidateSha256 };
}

function sameCandidate(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

export function verifyDistributedNativeWorkspace(root, expectedCandidate) {
  const expected = normalizeCandidate(expectedCandidate, 'expected candidate');
  const actual = createCandidate(root);
  if (!sameCandidate(actual, expected))
    throw new Error('Distributed native workspace candidate drift');
  return actual;
}

function normalizeTask(value, label = 'distributed native task') {
  exactKeys(value, TASK_KEYS, label);
  if (value.schema !== DISTRIBUTED_NATIVE_TASK_SCHEMA)
    throw new Error('Unsupported distributed native task schema');
  const adapterId = identifier(value.adapterId, `${label} adapter ID`);
  const taskId = digest(value.taskId, `${label} ID`);
  const files = normalizeTaskFiles(value.files, `${label} files`);
  if (adapterId !== 'tooling' && files.length !== 1)
    throw new Error(`${label} requires exactly one non-tooling test file`);
  return {
    schema: value.schema,
    taskId,
    adapterId,
    files,
  };
}

function normalizeTaskFiles(value, label) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  const files = value.map((file) => {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      file.length > 1024 ||
      file !== file.trim() ||
      file.includes('\\') ||
      file.startsWith('/') ||
      file
        .split('/')
        .some((segment) => !segment || ['.', '..'].includes(segment))
    )
      throw new Error(`${label} contains an unsafe test path`);
    return file;
  });
  if (new Set(files).size !== files.length)
    throw new Error(`${label} contains duplicate test paths`);
  if (files.some((file, index) => file !== files.toSorted(compareText)[index]))
    throw new Error(`${label} must use canonical test-path order`);
  return files;
}

export function distributedNativeTaskId({
  applicationId,
  adapterId,
  files,
} = {}) {
  applicationId = identifier(applicationId, 'task application ID');
  adapterId = identifier(adapterId, 'task adapter ID');
  files = normalizeTaskFiles(files, 'task identity files');
  return canonicalJsonSha256({
    schema: TASK_IDENTITY_SCHEMA,
    applicationId,
    adapterId,
    files,
  });
}

function createTask(applicationId, adapterId, files) {
  files = normalizeTaskFiles(files, 'locally derived task files');
  return deepFreeze({
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({ applicationId, adapterId, files }),
    adapterId: identifier(adapterId, 'distributed native adapter ID'),
    files,
  });
}

function createAvailableTasks(plan, applicationId) {
  const selected = plan.inventory.filter((entry) => entry.selected);
  if (selected.length === 0)
    throw new Error('Distributed native catalog has zero selected tests');
  const tasks = selected
    .filter((entry) => entry.owner !== 'tooling')
    .map((entry) => {
      const owners = plan.steps.filter(
        (step) => step.kind === entry.owner && step.files?.includes(entry.file)
      );
      if (owners.length !== 1)
        throw new Error(
          `Distributed native test has ${owners.length} local execution owners: ${entry.file}`
        );
      return createTask(applicationId, entry.owner, [entry.file]);
    });
  const toolingSteps = plan.steps.filter((step) => step.kind === 'tooling');
  if (toolingSteps.length !== 1 || !toolingSteps[0].files?.length)
    throw new Error(
      'Distributed native plan requires one complete tooling lane'
    );
  tasks.push(
    createTask(
      applicationId,
      'tooling',
      [...toolingSteps[0].files].toSorted(compareText)
    )
  );
  if (tasks.length > MAX_DISTRIBUTED_NATIVE_TASKS)
    throw new Error('Distributed native task inventory exceeds its safe bound');
  return tasks.toSorted((left, right) =>
    compareText(left.taskId, right.taskId)
  );
}

function verifyTaskFilesAtHead(root, tasks) {
  const headFiles = new Map();
  for (const record of git(
    root,
    ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'],
    'Distributed native HEAD inventory'
  ).split('\0')) {
    if (!record) continue;
    const separator = record.indexOf('\t');
    if (separator < 0)
      throw new Error('Distributed native HEAD inventory is malformed');
    const metadata = record.slice(0, separator).split(' ');
    if (metadata.length !== 3)
      throw new Error('Distributed native HEAD inventory is malformed');
    const [mode, type, objectId] = metadata;
    headFiles.set(record.slice(separator + 1), { mode, type, objectId });
  }

  for (const file of new Set(tasks.flatMap((task) => task.files))) {
    const entry = headFiles.get(file);
    if (
      !entry ||
      entry.type !== 'blob' ||
      !['100644', '100755'].includes(entry.mode) ||
      !GIT_OBJECT.test(entry.objectId)
    )
      throw new Error(
        `Distributed native task file is not an ordinary tracked HEAD blob: ${file}`
      );
    const absolute = resolve(root, ...file.split('/'));
    const metadata = lstatSync(absolute);
    const resolved = realpathSync(absolute);
    const child = relative(root, resolved).split(sep).join('/');
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      child !== file ||
      isAbsolute(child) ||
      child.startsWith('../')
    )
      throw new Error(
        `Distributed native task file escaped its tracked path: ${file}`
      );
    const contents = readFileSync(resolved);
    const algorithm = entry.objectId.length === 40 ? 'sha1' : 'sha256';
    const actualObjectId = createHash(algorithm)
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest('hex');
    if (actualObjectId !== entry.objectId)
      throw new Error(
        `Distributed native task file does not match its HEAD blob: ${file}`
      );
  }
}

function normalizeAllowedTaskIds(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISTRIBUTED_NATIVE_TASKS
  )
    throw new Error(
      'A nonempty local distributed native task allowlist within the supported bound is required'
    );
  const allowed = value.map((taskId) =>
    digest(taskId, 'allowed distributed native task ID')
  );
  if (new Set(allowed).size !== allowed.length)
    throw new Error('Distributed native task allowlist contains duplicates');
  return allowed;
}

function normalizeCatalog(value) {
  exactKeys(value, CATALOG_KEYS, 'distributed native catalog');
  if (value.schema !== DISTRIBUTED_NATIVE_CATALOG_SCHEMA)
    throw new Error('Unsupported distributed native catalog schema');
  const applicationId = identifier(value.applicationId, 'application ID');
  const platform = identifier(value.platform, 'catalog platform');
  const candidate = normalizeCandidate(value.candidate);
  const inventorySha256 = digest(
    value.inventorySha256,
    'catalog inventory hash'
  );
  if (!Array.isArray(value.tasks) || value.tasks.length === 0)
    throw new Error('Distributed native catalog has zero tasks');
  const tasks = value.tasks.map((task, index) =>
    normalizeTask(task, `distributed native task ${index}`)
  );
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length)
    throw new Error('Distributed native catalog contains duplicate task IDs');
  const files = tasks.flatMap((task) => task.files);
  if (new Set(files).size !== files.length)
    throw new Error('Distributed native catalog contains duplicate test files');
  if (
    tasks.some(
      (task) =>
        task.taskId !==
        distributedNativeTaskId({
          applicationId,
          adapterId: task.adapterId,
          files: task.files,
        })
    )
  )
    throw new Error('Distributed native catalog contains an invalid task ID');
  const core = {
    schema: value.schema,
    applicationId,
    platform,
    candidate,
    inventorySha256,
    tasks,
  };
  const catalogSha256 = digest(value.catalogSha256, 'catalog identity hash');
  if (catalogSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed native catalog identity is invalid');
  return { ...core, catalogSha256 };
}

function deriveAvailableTasksAndPlan(rootValue, applicationId) {
  const root = normalizeRoot(rootValue);
  applicationId = identifier(applicationId, 'application ID');
  const candidate = createCandidate(root);
  preflight(root, { testsOnly: true });
  const plan = createPlan(root, {
    testsOnly: true,
    platform: process.platform,
    canonicalTypescript: true,
  });
  const available = createAvailableTasks(plan, applicationId);
  verifyTaskFilesAtHead(root, available);
  return { root, applicationId, candidate, plan, available };
}

function sealCatalog({ root, applicationId, candidate, plan, tasks }) {
  const inventorySha256 = canonicalJsonSha256({
    schema: INVENTORY_IDENTITY_SCHEMA,
    applicationId,
    platform: plan.platform,
    candidateSha256: candidate.candidateSha256,
    tasks,
  });
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId,
    platform: identifier(plan.platform, 'catalog platform'),
    candidate,
    inventorySha256,
    tasks,
  };
  const catalog = deepFreeze({
    ...core,
    catalogSha256: canonicalJsonSha256(core),
  });
  verifyDistributedNativeWorkspace(root, candidate);
  return { root, plan, catalog };
}

function createCatalogAndPlan(rootValue, options) {
  exactKeys(
    options,
    ['allowedTaskIds', 'applicationId'],
    'distributed native catalog options'
  );
  const { applicationId, allowedTaskIds } = options;
  const allowed = normalizeAllowedTaskIds(allowedTaskIds);
  const derived = deriveAvailableTasksAndPlan(rootValue, applicationId);
  const { available } = derived;
  const allowedSet = new Set(allowed);
  const tasks = available.filter((task) => allowedSet.has(task.taskId));
  if (tasks.length !== allowed.length)
    throw new Error(
      'Distributed native task allowlist names an unavailable task'
    );
  return sealCatalog({ ...derived, tasks });
}

export function createDistributedNativeCatalog(root, options) {
  return createCatalogAndPlan(root, options).catalog;
}

export function discoverDistributedNativeCatalog(root, options) {
  exactKeys(options, ['applicationId'], 'distributed native discovery options');
  const derived = deriveAvailableTasksAndPlan(root, options.applicationId);
  return sealCatalog({ ...derived, tasks: derived.available }).catalog;
}

export function createDistributedNativeTaskRequest(catalogValue, taskId) {
  const catalog = normalizeCatalog(catalogValue);
  taskId = digest(taskId, 'requested distributed native task ID');
  const task = catalog.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error('Unknown distributed native task');
  return deepFreeze({
    schema: DISTRIBUTED_NATIVE_TASK_REQUEST_SCHEMA,
    candidateSha256: catalog.candidate.candidateSha256,
    taskId,
    files: [...task.files],
  });
}

function normalizeRequest(value) {
  exactKeys(value, REQUEST_KEYS, 'distributed native task request');
  if (value.schema !== DISTRIBUTED_NATIVE_TASK_REQUEST_SCHEMA)
    throw new Error('Unsupported distributed native task request schema');
  return {
    schema: value.schema,
    candidateSha256: digest(value.candidateSha256, 'request candidate hash'),
    taskId: digest(value.taskId, 'request task ID'),
    files: normalizeTaskFiles(value.files, 'request test files'),
  };
}

function selectedStep(plan, task) {
  if (task.adapterId === 'tooling') {
    const tooling = plan.steps.filter((step) => step.kind === 'tooling');
    if (
      tooling.length !== 1 ||
      !sameFiles([...tooling[0].files].toSorted(compareText), task.files)
    )
      throw new Error('Distributed native tooling lane drift');
    return {
      ...tooling[0],
      args: [...tooling[0].args],
      files: [...task.files],
    };
  }
  const source = plan.steps.find(
    (step) =>
      step.kind === task.adapterId && step.files?.includes(task.files[0])
  );
  if (!source)
    throw new Error('Distributed native task lost its local execution owner');
  const sourceFiles = new Set(source.files);
  return {
    ...source,
    name: `${source.name}: ${task.files[0]}`,
    args: [
      ...source.args.filter((argument) => !sourceFiles.has(argument)),
      task.files[0],
    ],
    files: [...task.files],
  };
}

function sameFiles(left, right) {
  return (
    left.length === right.length &&
    left.every((file, index) => file === right[index])
  );
}

function totalsObject(totals) {
  return Object.fromEntries(
    [...totals.entries()].map(([kind, counts]) => [kind, { ...counts }])
  );
}

function nativeInheritedEnvironment(adapterId) {
  const inherited = { ...process.env };
  // A worker may itself be exercised by node:test. The child is a new owned
  // native run, not a recursive use of the parent's test context.
  delete inherited.NODE_TEST_CONTEXT;
  delete inherited.SEERRNG_DISTRIBUTED_SHARED_SECRET;
  return adapterId === 'tooling' ? withGitBashOnPath(inherited) : inherited;
}

function nativeTaskTimeout(value) {
  if (value === undefined) return DEFAULT_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_DISTRIBUTED_NATIVE_TASK_TIMEOUT_MS
  )
    throw new Error('Invalid local distributed native task timeout');
  return value;
}

function nonnegativeDuration(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a nonnegative finite duration`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function verifyNativeResultReceipt(value) {
  exactKeys(value, NATIVE_RECEIPT_KEYS, 'distributed native result receipt');
  if (
    value.status !== 'passed' ||
    value.exitCode !== 0 ||
    value.signal !== null ||
    value.aborted !== false ||
    value.timedOut !== false
  )
    throw new Error('Distributed native result requires a passing receipt');
  if (typeof value.stdout !== 'string' || typeof value.stderr !== 'string')
    throw new Error('Distributed native result receipt output must be text');
  if (
    typeof value.stdoutTruncated !== 'boolean' ||
    typeof value.stderrTruncated !== 'boolean'
  )
    throw new Error(
      'Distributed native result receipt truncation flags must be boolean'
    );
  for (const stream of ['stdout', 'stderr'])
    if (
      value[`${stream}Truncated`] === false &&
      (value[`${stream}Bytes`] !== Buffer.byteLength(value[stream]) ||
        value[`${stream}Sha256`] !==
          createHash('sha256').update(value[stream]).digest('hex'))
    )
      throw new Error(
        `Distributed native result requires hash-bound ${stream} evidence`
      );
  exactKeys(
    value.lifecycle,
    NATIVE_RECEIPT_LIFECYCLE_KEYS,
    'distributed native result receipt lifecycle'
  );
  if (
    value.lifecycle.spawned !== true ||
    value.lifecycle.completed !== true ||
    value.lifecycle.cleanupVerified !== true ||
    value.lifecycle.cleanupError !== null
  )
    throw new Error(
      'Distributed native result receipt requires verified lifecycle cleanup'
    );
  return {
    status: value.status,
    exitCode: value.exitCode,
    signal: value.signal,
    aborted: value.aborted,
    timedOut: value.timedOut,
    wallMs: nonnegativeDuration(
      value.wallMs,
      'Distributed native result receipt wall time'
    ),
    stdout: value.stdout,
    stderr: value.stderr,
    stdoutBytes: nonnegativeInteger(
      value.stdoutBytes,
      'Distributed native result receipt stdout bytes'
    ),
    stderrBytes: nonnegativeInteger(
      value.stderrBytes,
      'Distributed native result receipt stderr bytes'
    ),
    stdoutTruncated: value.stdoutTruncated,
    stderrTruncated: value.stderrTruncated,
    stdoutSha256: digest(
      value.stdoutSha256,
      'distributed native result receipt stdout hash'
    ),
    stderrSha256: digest(
      value.stderrSha256,
      'distributed native result receipt stderr hash'
    ),
    lifecycle: {
      spawned: value.lifecycle.spawned,
      completed: value.lifecycle.completed,
      cleanupVerified: value.lifecycle.cleanupVerified,
      cleanupError: value.lifecycle.cleanupError,
    },
  };
}

function tapEvidenceStream(receipt) {
  const containsTap = (value) => {
    const bytes = Buffer.from(value);
    const marker = bytes.indexOf(Buffer.from('TAP version 13'));
    return marker >= 0 && (marker === 0 || bytes[marker - 1] === 10);
  };
  const candidates = ['stdout', 'stderr'].filter((stream) =>
    containsTap(receipt[stream])
  );
  if (candidates.length !== 1)
    throw new Error(
      'Distributed native task requires exactly one TAP evidence stream'
    );
  const [stream] = candidates;
  if (receipt[`${stream}Truncated`])
    throw new Error(
      'Distributed native task TAP evidence stream was truncated'
    );
  return { stream, text: receipt[stream] };
}

function verifyNativeCaseReportBinding(adapterId, caseLedger, receipt) {
  const replayed =
    adapterId === 'vitest'
      ? createDistributedNativeVitestCaseLedger({
          files: caseLedger.files,
          reportBase64: caseLedger.reportBase64,
        })
      : createDistributedNativeTapCaseLedger({
          adapterId,
          files: caseLedger.files,
          report: tapEvidenceStream(receipt).text,
        });
  if (caseLedger.ledgerSha256 !== replayed.ledgerSha256)
    throw new Error(
      'Distributed native case ledger differs from retained execution report'
    );
}

function verifyNativeResultTotals(value, adapterId, caseLedger) {
  exactKeys(value, [adapterId], 'distributed native result totals');
  const counts = value[adapterId];
  exactKeys(
    counts,
    ['active', 'total'],
    'distributed native result adapter totals'
  );
  const total = nonnegativeInteger(
    counts.total,
    'Distributed native result total count'
  );
  const active = nonnegativeInteger(
    counts.active,
    'Distributed native result active count'
  );
  if (
    total < 1 ||
    active > total ||
    total !== caseLedger.counts.total ||
    active !== caseLedger.counts.active ||
    (active < 1 && !isExplicitlySkippedDistributedNativeCaseLedger(caseLedger))
  )
    throw new Error('Distributed native result requires active test coverage');
  return { [adapterId]: { total, active } };
}

export function verifyDistributedNativeTaskResult(value, options = {}) {
  const hasExpectedCatalogSha256 = Object.prototype.hasOwnProperty.call(
    plainObject(options, 'distributed native result verification options'),
    'expectedCatalogSha256'
  );
  exactKeys(
    options,
    [
      'catalog',
      'taskId',
      ...(hasExpectedCatalogSha256 ? ['expectedCatalogSha256'] : []),
    ],
    'distributed native result verification options'
  );
  const catalog = normalizeCatalog(options.catalog);
  const taskId = digest(options.taskId, 'expected distributed native task ID');
  const expectedCatalogSha256 = hasExpectedCatalogSha256
    ? digest(
        options.expectedCatalogSha256,
        'expected distributed native result catalog hash'
      )
    : catalog.catalogSha256;
  const task = catalog.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error('Unknown expected distributed native task');
  exactKeys(value, TASK_RESULT_KEYS, 'distributed native task result');
  if (value.schema !== DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA)
    throw new Error('Unsupported distributed native task result schema');
  const applicationId = identifier(
    value.applicationId,
    'distributed native result application ID'
  );
  const candidateSha256 = digest(
    value.candidateSha256,
    'distributed native result candidate hash'
  );
  const catalogSha256 = digest(
    value.catalogSha256,
    'distributed native result catalog hash'
  );
  const actualTaskId = digest(
    value.taskId,
    'distributed native result task ID'
  );
  const adapterId = identifier(
    value.adapterId,
    'distributed native result adapter ID'
  );
  const files = normalizeTaskFiles(
    value.files,
    'distributed native result files'
  );
  if (
    applicationId !== catalog.applicationId ||
    candidateSha256 !== catalog.candidate.candidateSha256 ||
    catalogSha256 !== expectedCatalogSha256 ||
    actualTaskId !== task.taskId ||
    adapterId !== task.adapterId ||
    !sameFiles(files, task.files)
  )
    throw new Error('Distributed native task result binding is invalid');
  if (value.status !== 'passed')
    throw new Error('Distributed native task result did not pass');
  const wallMs = nonnegativeDuration(
    value.wallMs,
    'Distributed native task result wall time'
  );
  const caseLedger = verifyDistributedNativeCaseLedger(value.caseLedger, {
    adapterId,
    files,
  });
  const totals = verifyNativeResultTotals(value.totals, adapterId, caseLedger);
  const receipt = verifyNativeResultReceipt(value.receipt);
  verifyNativeCaseReportBinding(adapterId, caseLedger, receipt);
  if (wallMs < receipt.wallMs)
    throw new Error(
      'Distributed native task result wall time is shorter than its receipt'
    );
  const core = {
    schema: value.schema,
    applicationId,
    candidateSha256,
    catalogSha256,
    taskId: actualTaskId,
    adapterId,
    files,
    caseLedger,
    status: value.status,
    wallMs,
    totals,
    receipt,
  };
  const resultSha256 = digest(
    value.resultSha256,
    'distributed native task result hash'
  );
  if (resultSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed native task result hash is invalid');
  return deepFreeze({ ...core, resultSha256 });
}

function normalizeNativeReceipt(value) {
  if (!value || value.status !== 'passed' || value.exitCode !== 0)
    throw new Error(
      'Distributed native task requires a passing native receipt'
    );
  return {
    status: value.status,
    exitCode: value.exitCode,
    signal: value.signal,
    aborted: value.aborted,
    timedOut: value.timedOut,
    wallMs: value.wallMs,
    stdout: value.stdout,
    stderr: value.stderr,
    stdoutBytes: value.stdoutBytes,
    stderrBytes: value.stderrBytes,
    stdoutTruncated: value.stdoutTruncated,
    stderrTruncated: value.stderrTruncated,
    stdoutSha256: value.stdoutSha256,
    stderrSha256: value.stderrSha256,
    lifecycle: {
      spawned: value.lifecycle?.spawned,
      completed: value.lifecycle?.completed,
      cleanupVerified: value.lifecycle?.cleanupVerified,
      cleanupError: value.lifecycle?.cleanupError ?? null,
    },
  };
}

export async function executeDistributedNativeTask({
  root,
  applicationId,
  allowedTaskIds,
  expectedCandidate,
  request: requestValue,
  signal,
  stdout = process.stdout,
  stderr = process.stderr,
  timeoutMs,
} = {}) {
  const expected = normalizeCandidate(expectedCandidate, 'expected candidate');
  const request = normalizeRequest(requestValue);
  if (request.candidateSha256 !== expected.candidateSha256)
    throw new Error(
      'Distributed native task request belongs to another candidate'
    );
  const localRoot = normalizeRoot(root);
  verifyDistributedNativeWorkspace(localRoot, expected);
  const derived = createCatalogAndPlan(localRoot, {
    applicationId,
    allowedTaskIds,
  });
  const { plan, catalog } = derived;
  if (!sameCandidate(catalog.candidate, expected))
    throw new Error('Distributed native task expected another candidate');
  const task = catalog.tasks.find((entry) => entry.taskId === request.taskId);
  if (!task) throw new Error('Unknown distributed native task');
  if (!sameFiles(request.files, task.files))
    throw new Error('Distributed native task file selection drift');
  if (task.files.length === 0)
    throw new Error('Distributed native task cannot execute zero tests');

  const taskPlan = {
    ...plan,
    inventory: plan.inventory.filter((entry) =>
      task.files.includes(entry.file)
    ),
    steps: [selectedStep(plan, task)],
  };
  verifyDistributedNativeWorkspace(localRoot, expected);
  const started = performance.now();
  const taskTimeoutMs = nativeTaskTimeout(timeoutMs);
  let totals;
  let caseLedger;
  let nativeReceipt;
  let executionError;
  try {
    totals = await executePlan(taskPlan, {
      stdout,
      stderr,
      signal,
      inherited: nativeInheritedEnvironment(task.adapterId),
      workers: 1,
      caseLedgerObserver: (ledger) => {
        if (caseLedger)
          throw new Error(
            'Distributed native task produced duplicate case ledgers'
          );
        caseLedger = ledger;
      },
      executor: async (step, options) => {
        try {
          nativeReceipt = await runCommand(step, {
            ...options,
            maxCaptureBytes: 2_000_000,
            receipt: true,
            timeoutMs: taskTimeoutMs,
          });
          return step.kind === 'vitest'
            ? nativeReceipt.stdout
            : tapEvidenceStream(nativeReceipt).text;
        } catch (error) {
          nativeReceipt = error.receipt;
          throw error;
        }
      },
    });
  } catch (error) {
    executionError = error;
  }
  let driftError;
  try {
    verifyDistributedNativeWorkspace(localRoot, expected);
  } catch (error) {
    driftError = error;
  }
  if (executionError && driftError)
    throw new AggregateError(
      [executionError, driftError],
      'Distributed native task failed and changed its workspace candidate'
    );
  if (driftError) throw driftError;
  if (executionError) throw executionError;
  if (!caseLedger)
    throw new Error('Distributed native task produced no case ledger');
  const receipt = normalizeNativeReceipt(nativeReceipt);

  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: catalog.applicationId,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    taskId: task.taskId,
    adapterId: task.adapterId,
    files: [...task.files],
    caseLedger,
    status: 'passed',
    wallMs: performance.now() - started,
    totals: totalsObject(totals),
    receipt,
  };
  const result = {
    ...core,
    resultSha256: canonicalJsonSha256(core),
  };
  return verifyDistributedNativeTaskResult(result, {
    catalog,
    taskId: task.taskId,
  });
}
