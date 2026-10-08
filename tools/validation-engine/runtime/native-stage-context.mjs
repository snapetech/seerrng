// Copyright (c) snapetech and SeerrNG contributors.
// Automatic preparation/context for the existing native validation coordinator.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { freemem, networkInterfaces, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node runtime cannot resolve application aliases.
import {
  createPlan,
  executePlan,
  isolatedEnvironment,
  runCommand,
  startCommand,
} from '../../../bin/local-validation.mjs';
import {
  buildBrowserEnvironment,
  createBuildBrowserStages,
} from './build-browser-stage.mjs';
import {
  createCodeqlSteps,
  readCodeqlQueryPackMetadata,
  readCodeqlWorkflow,
} from './codeql-stage.mjs';
import { detectWorkerCapacity } from './cpu-capacity.mjs';
import { readNodeTapHierarchy } from './node-tap-hierarchy.mjs';
import {
  createSupplementalPrStages,
  normalizeSupplementalPrChecks,
} from './pr-check-stages.mjs';
import { createStagedValidation } from './staged-validation.mjs';

const prefix = 'seerrng-native-validation-';
export const MODE3_DEPENDENCY_MOUNTPOINT_SCHEMA =
  'seerrng-mode3-dependency-mountpoint/v1';
const MODE3_DEPENDENCY_MOUNTPOINT_KEYS = Object.freeze(
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
  ].sort()
);
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const beneath = (root, file) => {
  const rel = path.relative(root, file);
  return (
    rel &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
};
const safe = (file) =>
  typeof file === 'string' &&
  file &&
  !path.isAbsolute(file) &&
  // eslint-disable-next-line no-control-regex -- Reject unsafe control characters in source-relative paths.
  !/[\x00-\x1f\\]/.test(file) &&
  file.split('/').every((part) => part && part !== '.' && part !== '..');
const git = (root, args, input) =>
  execFileSync(
    'git',
    [
      '--no-optional-locks',
      '-C',
      root,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.longpaths=true',
      '-c',
      'init.templateDir=',
      ...args,
    ],
    {
      encoding: 'utf8',
      input,
      maxBuffer: 128 * 1024 ** 2,
      env: {
        ...nativeEnvironment(process.env, tmpdir()),
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    }
  );

function gitTrackedFileModes(root) {
  const modes = new Map();
  for (const entry of git(root, ['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean)) {
    const match = /^(100644|100755) [a-f0-9]{40} 0\t([^\0]+)$/u.exec(entry);
    if (!match || !safe(match[2]) || modes.has(match[2]))
      throw new Error('Git index contains an unsupported source entry');
    modes.set(match[2], match[1]);
  }
  return modes;
}

export async function probeNativeBrowserReadiness(
  baseUrl,
  { fetchImpl = globalThis.fetch } = {}
) {
  try {
    // The initialized app redirects logged-out homepage requests to /login.
    // Require both the database health check and the actual Next login page.
    for (const [pathname, expectedStatus] of [
      ['/api/v1/status/ready', 204],
      ['/login', 200],
    ]) {
      const response = await fetchImpl(new URL(pathname, baseUrl).href, {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      });
      if (response.status !== expectedStatus) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function nativeEnvironment(inherited, home) {
  const env = buildBrowserEnvironment(inherited, home, 5056);
  env.HOME = home;
  env.USERPROFILE = home;
  delete env.CONFIG_DIRECTORY;
  delete env.E2E_TESTS;
  delete env.WITH_MIGRATIONS;
  delete env.PORT;
  return env;
}

function regular(root, file) {
  const absolute = path.resolve(root, file);
  if (!safe(file) || !beneath(root, absolute))
    throw new Error(`Unsafe source path: ${file}`);
  // Every ancestor must stay literal and inside the chosen root.
  let current = root;
  for (const component of file.split('/')) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`Source symlink is not a frozen regular file: ${file}`);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`Source special entry: ${file}`);
  return { absolute, stat };
}
function readCheckedRegularFile(file, checked) {
  // Bind classification and bytes to one descriptor, not a second pathname
  // lookup. NOFOLLOW rejects replacement links; NONBLOCK avoids waiting on a
  // substituted FIFO before its actual descriptor type can be rejected.
  const descriptor = openSync(
    file,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0)
  );
  try {
    const before = fstatSync(descriptor);
    const unchanged = (stat) =>
      stat.isFile() &&
      ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => stat[key] === checked[key]
      );
    if (!unchanged(before))
      throw new Error(
        'Checked regular file changed before its descriptor read'
      );
    const bytes = readFileSync(descriptor);
    if (!unchanged(fstatSync(descriptor)) || bytes.length !== before.size)
      throw new Error(
        'Checked regular file changed during its descriptor read'
      );
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
function copyMetadata(from, to) {
  if (!existsSync(from)) return;
  const stat = lstatSync(from);
  if (stat.isSymbolicLink())
    throw new Error('External Git metadata links are not copied');
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      if (name === 'alternates' || name.endsWith('.lock'))
        throw new Error('External or locked Git metadata is unsafe');
      copyMetadata(path.join(from, name), path.join(to, name));
    }
  } else if (stat.isFile())
    writeFileSync(to, readCheckedRegularFile(from, stat), { flag: 'wx' });
  else throw new Error('Special Git metadata entry is unsafe');
}

export function createOwnedSourceSnapshot(
  sourceRoot,
  { scratchParent = tmpdir() } = {}
) {
  sourceRoot = realpathSync(sourceRoot);
  if (
    realpathSync(git(sourceRoot, ['rev-parse', '--show-toplevel']).trim()) !==
    sourceRoot
  )
    throw new Error('Source root must be the actual repository root');
  const origin = git(sourceRoot, [
    'config',
    '--get',
    'remote.origin.url',
  ]).trim();
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+(?:\.git)?$/.test(
      origin
    )
  )
    throw new Error(
      'Repository origin must be a credential-free GitHub identity'
    );
  const commit = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
  const common = realpathSync(
    path.resolve(
      sourceRoot,
      git(sourceRoot, ['rev-parse', '--git-common-dir']).trim()
    )
  );
  const actualGit = realpathSync(
    git(sourceRoot, ['rev-parse', '--absolute-git-dir']).trim()
  );
  const shallow =
    git(sourceRoot, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const tracked = git(sourceRoot, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean);
  const untracked = git(sourceRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .split('\0')
    .filter(Boolean);
  if (git(sourceRoot, ['ls-files', '--unmerged', '-z']).length)
    throw new Error('Unmerged source cannot be frozen');
  const authoritativeTrackedModes = gitTrackedFileModes(sourceRoot);
  if (
    authoritativeTrackedModes.size !== tracked.length ||
    tracked.some((file) => !authoritativeTrackedModes.has(file))
  )
    throw new Error('Git index mode closure is incomplete');
  const paths = [...new Set([...tracked, ...untracked])].sort();
  scratchParent = realpathSync(scratchParent);
  if (scratchParent === sourceRoot || beneath(sourceRoot, scratchParent))
    throw new Error('Native scratch must be outside authoritative source');
  const scratchRoot = mkdtempSync(path.join(scratchParent, prefix));
  const root = path.join(scratchRoot, 'source');
  mkdirSync(root);
  const entries = [];
  try {
    for (const file of paths) {
      if (
        file === '.git' ||
        file.startsWith('.git/') ||
        file === 'node_modules' ||
        file.startsWith('node_modules/')
      )
        throw new Error(
          'Metadata/dependency paths cannot become source payload'
        );
      const { absolute, stat } = regular(sourceRoot, file),
        bytes = readFileSync(absolute);
      const target = path.join(root, file),
        trackedMode = authoritativeTrackedModes.get(file),
        // Windows does not expose a dependable executable bit. Preserve the
        // staged Git index mode for tracked paths there. POSIX working-tree mode
        // changes and every untracked path remain filesystem-authoritative.
        mode =
          process.platform === 'win32' && trackedMode
            ? trackedMode
            : stat.mode & 0o111
              ? '100755'
              : '100644';
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, {
        flag: 'wx',
        mode: mode === '100755' ? 0o755 : 0o644,
      });
      chmodSync(target, mode === '100755' ? 0o755 : 0o644);
      entries.push({
        path: file,
        mode,
        bytes: bytes.length,
        sha256: hash(bytes),
      });
    }
    git(root, ['init', '--quiet']);
    const snapshotGit = path.join(root, '.git');
    // Object/history inputs are retained for repository-owned fixtures. Never
    // copy source Git config, hooks, logs, credential helpers or workstation state.
    copyMetadata(
      path.join(common, 'objects'),
      path.join(snapshotGit, 'objects')
    );
    copyMetadata(path.join(common, 'refs'), path.join(snapshotGit, 'refs'));
    if (existsSync(path.join(common, 'packed-refs')))
      copyMetadata(
        path.join(common, 'packed-refs'),
        path.join(snapshotGit, 'packed-refs')
      );
    if (existsSync(path.join(common, 'shallow')))
      copyMetadata(
        path.join(common, 'shallow'),
        path.join(snapshotGit, 'shallow')
      );
    writeFileSync(
      path.join(snapshotGit, 'HEAD'),
      readFileSync(path.join(actualGit, 'HEAD'))
    );
    git(root, ['config', 'remote.origin.url', origin]);
    git(root, ['config', 'core.hooksPath', path.join(scratchRoot, 'no-hooks')]);
    // One native Git operation hashes the copied bytes without filters. This
    // avoids thousands of process launches and still builds the exact working
    // tree object rather than substituting a commit's old tree.
    const blobs = git(
      root,
      ['hash-object', '-w', '--no-filters', '--stdin-paths'],
      entries.map((entry) => JSON.stringify(entry.path)).join('\n') + '\n'
    )
      .trim()
      .split('\n');
    if (
      blobs.length !== entries.length ||
      blobs.some((blob) => !/^[a-f0-9]{40}$/.test(blob))
    )
      throw new Error('Native source object closure is incomplete');
    const index = entries.map(
      (entry, ordinal) => `${entry.mode} ${blobs[ordinal]}\t${entry.path}\0`
    );
    git(root, ['update-index', '-z', '--index-info'], index.join(''));
    const tree = git(root, ['write-tree']).trim();
    const manifest = {
      schema: 1,
      representation: 'actual-working-files-and-modes',
      repository: origin,
      commit,
      tree,
      fileCount: entries.length,
      files: entries,
    };
    const sourceSha256 = hash(json(manifest));
    const candidate = {
      repository: origin,
      commit,
      tree,
      lockSha256: entries.find((entry) => entry.path === 'pnpm-lock.yaml')
        ?.sha256,
      sourceSha256,
    };
    if (!/^[a-f0-9]{64}$/.test(candidate.lockSha256 ?? ''))
      throw new Error('Exact installed lockfile input is required');
    writeFileSync(
      path.join(scratchRoot, 'source-manifest.json'),
      json(manifest),
      { flag: 'wx' }
    );
    const snapshot = {
      root,
      authoritativeRoot: sourceRoot,
      scratchRoot,
      scratchParent,
      manifest,
      candidate,
      tracked,
      untracked,
      shallow,
    };
    verifySourceSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    error.scratchRoot = scratchRoot;
    error.preserveTemporary = true;
    throw error;
  }
}

const declaredDerived = (file, enabled) =>
  (enabled.has('docs-api') && file.startsWith('docs/api/')) ||
  (enabled.has('chart-docs') && /^charts\/.+\/README\.md$/.test(file));

// The native link-check workflow only checks its checkout: it does not install
// Docusaurus or regenerate docs. Preserve its exact globs on a separate clean
// source input, rather than adding excludes that could hide repository docs.
export function createOwnedDocsLinkSnapshot(snapshot) {
  verifySourceSnapshot(snapshot);
  const links = createOwnedSourceSnapshot(snapshot.authoritativeRoot, {
    scratchParent: snapshot.scratchRoot,
  });
  if (links.candidate.sourceSha256 !== snapshot.candidate.sourceSha256)
    throw new Error('Docs link source differs from the frozen candidate');
  for (const relative of ['node_modules', 'gen-docs/node_modules'])
    if (existsSync(path.join(links.root, relative)))
      throw new Error(
        'Docs link checkout must not contain installed dependencies'
      );
  return links;
}

export function verifySourceSnapshot(
  snapshot,
  { derivedOutputs = new Set() } = {}
) {
  if (
    hash(json(snapshot.manifest)) !== snapshot.candidate.sourceSha256 ||
    hash(
      readFileSync(path.join(snapshot.scratchRoot, 'source-manifest.json'))
    ) !== snapshot.candidate.sourceSha256
  )
    throw new Error('Frozen source manifest changed');
  if (
    git(snapshot.authoritativeRoot, ['rev-parse', 'HEAD']).trim() !==
    snapshot.candidate.commit
  )
    throw new Error('Authoritative HEAD changed during native validation');
  const authoritativeTrackedModes = gitTrackedFileModes(
    snapshot.authoritativeRoot
  );
  const snapshotTrackedModes = gitTrackedFileModes(snapshot.root);
  const originallyTracked = new Set(snapshot.tracked);
  for (const [kind, previous] of [
    ['tracked', snapshot.tracked],
    ['untracked', snapshot.untracked],
  ]) {
    const now = git(
      snapshot.authoritativeRoot,
      kind === 'tracked'
        ? ['ls-files', '-z']
        : ['ls-files', '--others', '--exclude-standard', '-z']
    )
      .split('\0')
      .filter(Boolean)
      .sort();
    if (JSON.stringify(now) !== JSON.stringify([...previous].sort()))
      throw new Error(
        `Authoritative ${kind} paths changed during native validation`
      );
  }
  for (const file of snapshot.manifest.files)
    for (const root of [snapshot.authoritativeRoot, snapshot.root]) {
      // Only the disjoint supplemental copy may contain native-declared derived
      // output. Authoritative bytes are never exempt from the input guard.
      if (root === snapshot.root && declaredDerived(file.path, derivedOutputs))
        continue;
      const { absolute, stat } = regular(root, file.path);
      const authoritative = root === snapshot.authoritativeRoot;
      const indexedMode = authoritative
        ? authoritativeTrackedModes.get(file.path)
        : snapshotTrackedModes.get(file.path);
      const mode =
        process.platform === 'win32' &&
        (!authoritative || originallyTracked.has(file.path))
          ? indexedMode
          : stat.mode & 0o111
            ? '100755'
            : '100644';
      if (hash(readFileSync(absolute)) !== file.sha256 || mode !== file.mode)
        throw new Error(`Frozen source changed: ${file.path}`);
    }
  if (git(snapshot.root, ['write-tree']).trim() !== snapshot.candidate.tree)
    throw new Error('Frozen source Git tree changed');
  return true;
}

function snapshotPayloadTopology(root) {
  const entries = [];
  const scan = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && name === '.git') continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error(
          `Mode 3 snapshot payload contains a symbolic link: ${relativePath}`
        );
      if (stat.isDirectory()) {
        entries.push({ path: relativePath, type: 'directory' });
        scan(absolute, relativePath);
      } else if (stat.isFile())
        entries.push({ path: relativePath, type: 'file' });
      else
        throw new Error(
          `Mode 3 snapshot payload contains a special entry: ${relativePath}`
        );
    }
  };
  scan(root);
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  return entries;
}

function expectedSnapshotPayloadTopology(snapshot) {
  const directories = new Set();
  const files = new Set();
  for (const entry of snapshot.manifest.files) {
    files.add(entry.path);
    const components = entry.path.split('/');
    for (let length = 1; length < components.length; length += 1)
      directories.add(components.slice(0, length).join('/'));
  }
  return [
    ...[...directories].map((entryPath) => ({
      path: entryPath,
      type: 'directory',
    })),
    ...[...files].map((entryPath) => ({ path: entryPath, type: 'file' })),
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function topologySha256(entries) {
  return hash(json(entries));
}

function assertMode3DependencyMountpointProof(snapshot, proof) {
  if (
    !proof ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    JSON.stringify(Object.keys(proof).sort()) !==
      JSON.stringify(MODE3_DEPENDENCY_MOUNTPOINT_KEYS)
  )
    throw new Error('Mode 3 dependency mountpoint proof shape differs');
  const sourceDirectory = realpathSync(snapshot.root);
  const mountpointPath = path.join(sourceDirectory, 'node_modules');
  const sourceManifestSha256 = hash(json(snapshot.manifest));
  const expectedTopology = expectedSnapshotPayloadTopology(snapshot);
  const expectedTopologySha256 = topologySha256(expectedTopology);
  const expected = {
    schema: MODE3_DEPENDENCY_MOUNTPOINT_SCHEMA,
    sourceDirectory,
    mountpointPath,
    relativePath: 'node_modules',
    candidateCommit: snapshot.candidate.commit,
    candidateTree: snapshot.candidate.tree,
    candidateSourceSha256: snapshot.candidate.sourceSha256,
    sourceManifestSha256,
    inheritedPathCount: expectedTopology.length,
    inheritedFileCount: snapshot.manifest.fileCount,
    inheritedTopologySha256: expectedTopologySha256,
    onlyAddedPath: 'node_modules',
    mountpointType: 'directory',
    mountpointEmptyBeforeMount: true,
    gitTreeVerified: true,
  };
  for (const [key, value] of Object.entries(expected))
    if (proof[key] !== value)
      throw new Error(`Mode 3 dependency mountpoint proof differs: ${key}`);
  return { expectedTopology, mountpointPath };
}

/**
 * Add the one real, empty nested-volume target required by the outer Mode 3
 * helper. Ordinary native snapshots remain byte-for-byte unchanged.
 */
export function prepareMode3DependencyMountpoint(snapshot) {
  verifySourceSnapshot(snapshot);
  const sourceDirectory = realpathSync(snapshot.root);
  const mountpointPath = path.join(sourceDirectory, 'node_modules');
  if (existsSync(mountpointPath))
    throw new Error(
      'Mode 3 dependency mountpoint must not exist before preparation'
    );
  const expectedTopology = expectedSnapshotPayloadTopology(snapshot);
  const inheritedTopology = snapshotPayloadTopology(sourceDirectory);
  if (JSON.stringify(inheritedTopology) !== JSON.stringify(expectedTopology))
    throw new Error(
      'Mode 3 snapshot payload differs before dependency mountpoint preparation'
    );
  mkdirSync(mountpointPath, { mode: 0o755 });
  const proof = Object.freeze({
    schema: MODE3_DEPENDENCY_MOUNTPOINT_SCHEMA,
    sourceDirectory,
    mountpointPath,
    relativePath: 'node_modules',
    candidateCommit: snapshot.candidate.commit,
    candidateTree: snapshot.candidate.tree,
    candidateSourceSha256: snapshot.candidate.sourceSha256,
    sourceManifestSha256: hash(json(snapshot.manifest)),
    inheritedPathCount: inheritedTopology.length,
    inheritedFileCount: snapshot.manifest.fileCount,
    inheritedTopologySha256: topologySha256(inheritedTopology),
    onlyAddedPath: 'node_modules',
    mountpointType: 'directory',
    mountpointEmptyBeforeMount: true,
    gitTreeVerified: true,
  });
  verifyMode3DependencyMountpoint(snapshot, proof);
  return proof;
}

/** Verify the prepared target and all inherited source identity again. */
export function verifyMode3DependencyMountpoint(snapshot, proof) {
  verifySourceSnapshot(snapshot);
  const { expectedTopology, mountpointPath } =
    assertMode3DependencyMountpointProof(snapshot, proof);
  const stat = lstatSync(mountpointPath);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(
      'Mode 3 dependency mountpoint is not an ordinary directory'
    );
  if (readdirSync(mountpointPath).length !== 0)
    throw new Error('Mode 3 dependency mountpoint is not empty');
  const currentTopology = snapshotPayloadTopology(proof.sourceDirectory);
  const mountpointEntries = currentTopology.filter(
    ({ path: entryPath }) => entryPath === proof.onlyAddedPath
  );
  const inheritedTopology = currentTopology.filter(
    ({ path: entryPath }) => entryPath !== proof.onlyAddedPath
  );
  if (
    mountpointEntries.length !== 1 ||
    mountpointEntries[0].type !== 'directory' ||
    JSON.stringify(inheritedTopology) !== JSON.stringify(expectedTopology)
  )
    throw new Error(
      'Mode 3 dependency mountpoint is not the only added snapshot path'
    );
  if (
    inheritedTopology.length !== proof.inheritedPathCount ||
    inheritedTopology.filter(({ type }) => type === 'file').length !==
      proof.inheritedFileCount ||
    topologySha256(inheritedTopology) !== proof.inheritedTopologySha256
  )
    throw new Error('Mode 3 inherited snapshot topology changed');
  if (git(snapshot.root, ['write-tree']).trim() !== proof.candidateTree)
    throw new Error('Mode 3 snapshot Git tree changed');
  return true;
}

function derivedOutputManifest(snapshot, enabled) {
  const entries = [];
  const scan = (directory) => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name),
        stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error('Derived documentation output contains a symlink');
      if (stat.isDirectory()) scan(absolute);
      else if (stat.isFile()) {
        const file = path
          .relative(snapshot.root, absolute)
          .split(path.sep)
          .join('/');
        if (declaredDerived(file, enabled))
          entries.push({
            path: file,
            bytes: stat.size,
            sha256: hash(readCheckedRegularFile(absolute, stat)),
          });
      } else throw new Error('Derived documentation contains a special entry');
    }
  };
  if (enabled.has('docs-api')) scan(path.join(snapshot.root, 'docs/api'));
  if (enabled.has('chart-docs')) scan(path.join(snapshot.root, 'charts'));
  for (const entry of snapshot.manifest.files)
    if (
      declaredDerived(entry.path, enabled) &&
      !existsSync(path.join(snapshot.root, entry.path))
    )
      entries.push({ path: entry.path, deleted: true });
  const manifest = {
    sourceSha256: snapshot.candidate.sourceSha256,
    declaredNativeOutputs: [...enabled].sort(),
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
  return { ...manifest, sha256: hash(json(manifest)) };
}

export function readonlyMountProof(
  directory,
  {
    platform = process.platform,
    mountInfo = platform === 'linux'
      ? readFileSync('/proc/self/mountinfo', 'utf8')
      : '',
  } = {}
) {
  if (platform !== 'linux')
    return {
      verified: false,
      reason:
        'No native read-only bind-mount proof is available on this platform',
    };
  const real = realpathSync(directory);
  const mounts = mountInfo
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(
      (parts) =>
        parts[4] &&
        (real === parts[4].replaceAll('\\040', ' ') ||
          beneath(parts[4].replaceAll('\\040', ' '), real))
    )
    .sort((a, b) => b[4].length - a[4].length);
  const selected = mounts[0];
  return {
    verified: !!selected?.[5].split(',').includes('ro'),
    mount: selected?.[4] ?? null,
    reason: selected?.[5].split(',').includes('ro')
      ? 'Actual execution namespace declares this dependency mount read-only'
      : 'Installed dependency reference is not proven read-only',
  };
}

// Only exact sealed read-only query manifests may be read outside scratch.
export function readNativeStageArtifact(
  file,
  { scratchRoot, queryPacks = [] },
  mountProof = readonlyMountProof
) {
  const absolute = path.resolve(file);
  const pack = queryPacks.find(
    (pack) =>
      pack.qlpackSha256 && absolute === path.join(pack.root, 'qlpack.yml')
  );
  if (pack) {
    if (
      !/^[a-f0-9]{64}$/.test(pack.qlpackSha256) ||
      realpathSync(pack.root) !== pack.root ||
      !mountProof(pack.root).verified
    )
      throw new Error('Query manifest requires its sealed read-only pack root');
    const bytes = readFileSync(regular(pack.root, 'qlpack.yml').absolute);
    if (hash(bytes) !== pack.qlpackSha256)
      throw new Error('Sealed query manifest bytes changed');
    return bytes;
  }
  return readFileSync(
    regular(
      scratchRoot,
      path.relative(scratchRoot, absolute).split(path.sep).join('/')
    ).absolute
  );
}

export function nativeNetworkBoundary({
  platform = process.platform,
  interfaces = networkInterfaces(),
  routes = platform === 'linux' ? readFileSync('/proc/net/route', 'utf8') : '',
} = {}) {
  const external = Object.entries(interfaces)
    .filter(([, addresses]) => addresses?.some((address) => !address.internal))
    .map(([name]) => name);
  const defaultRoute = routes
    .split('\n')
    .slice(1)
    .some((line) => /^\S+\s+00000000\s/.test(line));
  const verified =
    platform === 'linux' && external.length === 0 && !defaultRoute;
  return {
    isolated: verified,
    deniesPrivateProviders: verified,
    mechanism: verified
      ? 'observed-loopback-only-Linux-network-namespace'
      : 'unproven',
    externalInterfaces: external,
    defaultRoute,
    evidenceSha256: hash(json({ platform, external, defaultRoute })),
    reason: verified
      ? 'No external interface or IPv4 default route exists in the current process namespace'
      : 'Browser fixture flags are not an OS provider-network boundary',
  };
}

export function validateNativeBoundaryProof(
  proof,
  candidate,
  {
    platform = process.platform,
    networkNamespace = platform === 'linux'
      ? readlinkSync('/proc/self/ns/net')
      : null,
    status = platform === 'linux'
      ? readFileSync('/proc/self/status', 'utf8')
      : '',
  } = {}
) {
  const boundingSet = /^CapBnd:\s*(\S+)$/m.exec(status)?.[1];
  const effectiveSet = /^CapEff:\s*(\S+)$/m.exec(status)?.[1];
  const noNewPrivileges = /^NoNewPrivs:\s*1$/m.test(status);
  if (
    platform !== 'linux' ||
    proof?.verified !== true ||
    proof.isolated !== true ||
    proof.deniesPrivateProviders !== true ||
    proof.sourceSha256 !== candidate.sourceSha256 ||
    proof.networkNamespace !== networkNamespace ||
    !/^[a-f0-9]{64}$/.test(proof.rulesSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
    boundingSet !== '0000000000000000' ||
    effectiveSet !== '0000000000000000' ||
    proof.capabilityBoundingSet !== boundingSet ||
    !noNewPrivileges ||
    proof.noNewPrivileges !== true ||
    proof.publicProbe?.host !== 'api.themoviedb.org' ||
    !Number.isInteger(proof.publicProbe.httpsStatus) ||
    proof.publicProbe.httpsStatus < 200 ||
    proof.publicProbe.httpsStatus >= 400 ||
    proof.privateProbe?.destination !== '192.168.255.254:9' ||
    proof.privateProbe.refused !== true ||
    proof.privateProbe.exitCode !== 7
  )
    throw new Error(
      'Current namespace/capability/live-probe provider boundary is unproven'
    );
  return structuredClone(proof);
}

function closure(root) {
  root = realpathSync(root);
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name),
        stat = lstatSync(absolute),
        file = path.relative(root, absolute).split(path.sep).join('/');
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(absolute);
        if (resolved !== root && !beneath(root, resolved))
          throw new Error(`Tool/dependency closure escapes its root: ${file}`);
        entries.push({ path: file, link: readlinkSync(absolute) });
      } else if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile())
        entries.push({
          path: file,
          mode: stat.mode & 0o111 ? '100755' : '100644',
          bytes: stat.size,
          sha256: hash(readCheckedRegularFile(absolute, stat)),
        });
      else throw new Error('Special entry in native closure');
    }
  };
  visit(root);
  return {
    root,
    sha256: hash(json(entries)),
    entries: entries.length,
    representation:
      'sorted-native-tree-regular-bytes-modes-internal-symlink-targets-json-v1',
  };
}

export function nativeInputFileIdentity(file, expectedRealpath) {
  const absolute = path.resolve(file),
    actual = realpathSync(absolute);
  if (expectedRealpath !== undefined && actual !== expectedRealpath)
    throw new Error(`Frozen native input path changed: ${absolute}`);
  const stat = lstatSync(actual);
  return {
    path: absolute,
    realpath: actual,
    mode: stat.mode & 0o111 ? '100755' : '100644',
    sha256: hash(readCheckedRegularFile(actual, stat)),
  };
}

// A read-only consumer mount does not stop another consumer changing the same
// backing volume. Recheck actual bytes at the existing source admission/exit
// boundary; this is input freshness, never a retained test-result cache.
export function verifyNativeInputFreshness({ closures, files }) {
  for (const reference of closures) {
    for (const alias of reference.paths ?? [reference.root])
      if (realpathSync(alias) !== reference.root)
        throw new Error(`Frozen native input path changed: ${alias}`);
    const actual = closure(reference.root);
    if (
      actual.root !== reference.root ||
      actual.sha256 !== reference.sha256 ||
      actual.entries !== reference.entries ||
      actual.representation !== reference.representation
    )
      throw new Error(`Frozen native input closure changed: ${reference.root}`);
  }
  for (const reference of files) {
    const actual = nativeInputFileIdentity(reference.path, reference.realpath);
    if (
      actual.realpath !== reference.realpath ||
      actual.mode !== reference.mode ||
      actual.sha256 !== reference.sha256
    )
      throw new Error(`Frozen native input file changed: ${reference.path}`);
  }
  return true;
}

export function findNativeExecutable(name, environment = process.env) {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error('Unsafe native executable name');
  const extensions =
    process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const candidates = (environment.PATH ?? environment.Path ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) => path.join(directory, `${name}${extension}`))
    );
  if (name === 'codeql')
    candidates.push(
      path.join(
        '/opt/codeql',
        process.platform === 'win32' ? 'codeql.exe' : 'codeql'
      )
    );
  for (const candidate of candidates) {
    try {
      const actual = realpathSync(candidate);
      if (lstatSync(actual).isFile()) {
        accessSync(actual, constants.X_OK);
        return actual;
      }
    } catch {
      // An inaccessible PATH candidate is not a verified native executable.
    }
  }
  return null;
}

export function materializeNativeReceipt(receipt) {
  for (const stream of ['stdout', 'stderr']) {
    if (!receipt[`${stream}Truncated`]) continue;
    const file = receipt[`${stream}Log`];
    if (!file)
      throw new Error('Truncated native output has no complete persistent log');
    const bytes = readFileSync(file);
    if (
      bytes.length !== receipt[`${stream}Bytes`] ||
      hash(bytes) !== receipt[`${stream}Sha256`]
    )
      throw new Error(
        'Complete native output log does not match its process receipt'
      );
    receipt = {
      ...receipt,
      [stream]: bytes.toString('utf8'),
      [`${stream}CaptureTruncated`]: true,
      [`${stream}Truncated`]: false,
    };
  }
  return receipt;
}

export function prepareJellyfinTemporaryDirectory(command, fixtureRoot) {
  if (command.id !== 'jellyfin-plugin-native-smoke') return null;
  const root = realpathSync(fixtureRoot);
  if (lstatSync(fixtureRoot).isSymbolicLink())
    throw new Error('Jellyfin fixture root must not be a symlink');
  const expected = path.join(root, 'jellyfin-smoke');
  if (['TMPDIR', 'TMP', 'TEMP'].some((key) => command.env?.[key] !== expected))
    throw new Error(
      'Jellyfin native temporary directory is not bound to owned fixtures'
    );
  // The native smoke script calls mktemp beneath TMPDIR. Create only its fresh
  // parent; it remains responsible for its own temporary fixture lifecycle.
  mkdirSync(expected, { recursive: false, mode: 0o700 });
  return expected;
}

export function repositoryIsolationReadiness(
  withRepositoryIsolation,
  observedBoundary = nativeNetworkBoundary()
) {
  if (
    withRepositoryIsolation !== undefined &&
    typeof withRepositoryIsolation !== 'function'
  )
    throw new Error(
      'Internal repository-isolation admission must be a function'
    );
  if (typeof withRepositoryIsolation === 'function')
    return {
      ready: true,
      mechanism: 'internal-repository-isolation-admission',
      requiresLiveProof: true,
    };
  return {
    ready:
      observedBoundary.isolated === true &&
      observedBoundary.mechanism ===
        'observed-loopback-only-Linux-network-namespace',
    mechanism: observedBoundary.mechanism,
    requiresLiveProof: false,
    reason:
      'Without an internal live admission wrapper, repository tests require an observed loopback-only OS namespace',
  };
}

function nodeTapSourceEntries(command) {
  if (!['node-js', 'node-ts', 'tooling'].includes(command.kind)) return [];
  // Older parser unit fixtures without a command root cannot claim the narrow
  // module-load exception; their ordinary TAP cases remain strictly checked.
  if (typeof command.cwd !== 'string' || !command.cwd) return [];
  if (
    !Array.isArray(command.files) ||
    !command.files.length ||
    command.files.some((file) => !safe(file)) ||
    new Set(command.files).size !== command.files.length
  )
    throw new Error('Native Node source ownership is incomplete or duplicated');
  const root = path.resolve(command.cwd),
    // The Node CLI expands/sorts file patterns. The programmatic TypeScript
    // runner instead preserves the supplied file array.
    ordered =
      command.kind === 'node-ts'
        ? [...command.files]
        : command.files.map((file) => path.normalize(file)).sort();
  return ordered.map((file) => {
    const absolute = path.resolve(root, file);
    if (!beneath(root, absolute))
      throw new Error(`Unsafe native Node source path: ${file}`);
    return {
      name: command.kind === 'node-ts' ? absolute : path.normalize(file),
      absoluteFile: absolute,
    };
  });
}

export function repositoryNativeCases(
  command,
  receipt,
  { vitestReport, collectFailures = false } = {}
) {
  if (command.kind === 'check') return null;
  if (command.kind === 'vitest') {
    if (!vitestReport || !Array.isArray(vitestReport.testResults))
      throw new Error('Actual native Vitest JSON case ledger is required');
    const files = vitestReport.testResults.map((result) => ({
      file: result.name,
      cases: result.assertionResults,
    }));
    if (files.some((file) => !Array.isArray(file.cases)))
      throw new Error('Vitest assertion closure is missing');
    if (collectFailures) {
      const names = files.map((file) =>
        path
          .relative(command.cwd, path.resolve(command.cwd, file.file))
          .split(path.sep)
          .join('/')
      );
      if (
        !Array.isArray(command.files) ||
        !command.files.length ||
        command.files.some((file) => !safe(file)) ||
        new Set(command.files).size !== command.files.length ||
        names.length !== command.files.length ||
        new Set(names).size !== names.length ||
        names.some((name) => !command.files.includes(name))
      )
        throw new Error(
          'Native Vitest source ownership is incomplete or duplicated'
        );
    }
    const cases = files.flatMap((file) =>
      file.cases.map((entry, ordinal) => ({
        file: file.file,
        name: entry.fullName ?? entry.title,
        status: entry.status,
        ...(collectFailures
          ? {
              caseId: JSON.stringify([
                file.file,
                ordinal,
                entry.fullName ?? entry.title,
              ]),
              failureMessages: entry.failureMessages ?? [],
            }
          : {}),
      }))
    );
    if (
      cases.some(
        (entry) =>
          ![
            'passed',
            'failed',
            'pending',
            'skipped',
            'todo',
            'disabled',
          ].includes(entry.status)
      )
    )
      throw new Error('Unknown native Vitest case status');
    if (
      collectFailures &&
      cases.some(
        (entry) =>
          typeof entry.name !== 'string' ||
          !entry.name ||
          (entry.status === 'failed' &&
            (!Array.isArray(entry.failureMessages) ||
              !entry.failureMessages.length))
      )
    )
      throw new Error(
        'Native Vitest case identity/failure diagnostic is incomplete'
      );
    const counts = {
      passed: cases.filter((entry) => entry.status === 'passed').length,
      failed: cases.filter((entry) => entry.status === 'failed').length,
      skipped: cases.filter(
        (entry) => !['passed', 'failed'].includes(entry.status)
      ).length,
    };
    if (
      counts.passed !== vitestReport.numPassedTests ||
      counts.failed !== vitestReport.numFailedTests ||
      cases.length !== vitestReport.numTotalTests ||
      vitestReport.success !== (counts.failed === 0) ||
      counts.passed + counts.failed < 1 ||
      (!collectFailures && counts.failed)
    )
      throw new Error(
        'Native Vitest cases/summary closure is incomplete or failed'
      );
    return {
      format: 'native-vitest-json',
      files: command.files,
      cases,
      counts,
      reportSha256: hash(json(vitestReport)),
    };
  }
  const raw = Buffer.from(receipt.stdout),
    marker = raw.indexOf(Buffer.from('TAP version 13'));
  if (marker < 0 || (marker > 0 && raw[marker - 1] !== 10))
    throw new Error('Actual native Node TAP case ledger is absent');
  const runner =
    command.kind === 'node-ts'
      ? 'server/test/index.mts'
      : command.kind === 'tooling'
        ? 'bin/run-tooling-tests.mjs'
        : 'node:test';
  const ledger = readNodeTapHierarchy(raw.subarray(marker), runner, {
    sourceEntries: nodeTapSourceEntries(command),
  });
  if (
    !ledger.complete ||
    (!collectFailures && ledger.counts.failed) ||
    ledger.counts.passed + ledger.counts.failed < 1
  )
    throw new Error(
      `Native repository case closure failed: ${ledger.issues.join('; ')}`
    );
  return { ...ledger, files: command.files, nativeRunner: runner };
}

// A native assertion failure is distinct from interrupted/incomplete execution.
// Read actual complete logs; a claimed status or digest alone cannot admit it.
export function requireRepositoryNativeReceipt(receipt, scratchRoot) {
  if (
    !receipt ||
    !['passed', 'failed'].includes(receipt.status) ||
    !Number.isSafeInteger(receipt.exitCode) ||
    receipt.exitCode < 0 ||
    (receipt.status === 'passed'
      ? receipt.exitCode !== 0
      : receipt.exitCode === 0) ||
    receipt.lifecycle?.spawned !== true ||
    receipt.lifecycle?.completed !== true ||
    receipt.lifecycle?.cleanupVerified !== true ||
    receipt.aborted !== false ||
    receipt.timedOut !== false ||
    receipt.signal !== null ||
    receipt.spawnError ||
    !Number.isFinite(receipt.wallMs) ||
    receipt.wallMs < 0
  )
    throw new Error(
      'Incomplete native repository execution cannot collect failures'
    );
  for (const stream of ['stdout', 'stderr']) {
    const file = receipt[`${stream}Log`];
    if (typeof file !== 'string' || !beneath(scratchRoot, path.resolve(file)))
      throw new Error('Native repository log is not owned by scratch');
    const bytes = readFileSync(
      regular(
        scratchRoot,
        path.relative(scratchRoot, file).split(path.sep).join('/')
      ).absolute
    );
    if (
      bytes.length !== receipt[`${stream}Bytes`] ||
      hash(bytes) !== receipt[`${stream}Sha256`] ||
      receipt[`${stream}Truncated`] !== false ||
      bytes.toString('utf8') !== receipt[stream]
    )
      throw new Error('Native repository full log/hash closure is incomplete');
  }
  return receipt;
}

// Append actual terminal receipts independently of each stage's pass/fail result.
// Raw streams remain in their hashed logs; never copy command environments here.
export function createNativeProcessReceiptLedger(scratchRoot, candidate) {
  const file = path.join(scratchRoot, 'native-command-receipts.jsonl');
  writeFileSync(file, `${JSON.stringify({ schema: 1, candidate })}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const pending = new Map();
  const completed = new Map();
  let sequence = 0;
  return {
    begin: (id, command, role = 'command') => {
      if (
        typeof id !== 'string' ||
        !id ||
        !['command', 'server'].includes(role) ||
        pending.has(id) ||
        completed.has(id)
      )
        throw new Error('Native process receipt identity is not fresh');
      pending.set(id, {
        sequence: ++sequence,
        id,
        commandId: command.id ?? command.name ?? null,
        role,
      });
    },
    complete: (id, receipt) => {
      const owner = pending.get(id);
      if (!owner) throw new Error('Native process receipt has no active owner');
      const record = {
        ...owner,
        status: receipt.status,
        exitCode: receipt.exitCode,
        signal: receipt.signal,
        aborted: receipt.aborted,
        timedOut: receipt.timedOut,
        spawnError: receipt.spawnError,
        wallMs: receipt.wallMs,
        lifecycle: receipt.lifecycle,
        stdoutLog: receipt.stdoutLog,
        stderrLog: receipt.stderrLog,
        stdoutBytes: receipt.stdoutBytes,
        stderrBytes: receipt.stderrBytes,
        stdoutSha256: receipt.stdoutSha256,
        stderrSha256: receipt.stderrSha256,
      };
      appendFileSync(file, `${JSON.stringify(record)}\n`);
      completed.set(id, record);
      pending.delete(id);
    },
    describe: () => ({
      file,
      sha256: hash(readFileSync(file)),
      records: completed.size,
      pending: [...pending.values()],
      cleanupVerified:
        pending.size === 0 &&
        [...completed.values()].every(
          (record) =>
            record.lifecycle?.completed === true &&
            record.lifecycle?.cleanupVerified === true
        ),
    }),
  };
}

const repositoryCheckPrefix = 'repository-check-';

function sealNativeValue(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(sealNativeValue);
    Object.freeze(value);
  }
  return value;
}

function disposeRepositoryCheckDirectory(directory, scratchRoot) {
  const absolute = path.resolve(directory);
  if (
    path.dirname(absolute) !== scratchRoot ||
    !path.basename(absolute).startsWith(repositoryCheckPrefix) ||
    lstatSync(absolute).isSymbolicLink() ||
    !beneath(scratchRoot, realpathSync(absolute))
  )
    throw new Error('Refusing unsafe repository check cleanup');
  rmSync(absolute, { recursive: true, force: true });
}

function requireRepositoryCheckReceipt(receipt, expected, scratchRoot) {
  requireRepositoryNativeReceipt(receipt, scratchRoot);
  if (receipt.id !== (expected.id ?? expected.name))
    throw new Error('Native repository check receipt identity mismatch');
  return receipt;
}

/**
 * Bind one check executor to an immutable repository plan. Callers provide the
 * structured clone and original index emitted by the distributed compositor;
 * execution always uses the sealed plan entry, never caller-controlled bytes.
 */
export function createNativeRepositoryCheckExecutor(
  repositoryPlanValue,
  {
    nativeRun,
    scratchRoot: scratchRootValue,
    inherited = process.env,
    verifySource,
    stdout = process.stdout,
  } = {}
) {
  if (typeof nativeRun !== 'function')
    throw new Error('Native repository check requires the native runner');
  if (typeof verifySource !== 'function')
    throw new Error('Native repository check requires the source guard');
  if (typeof stdout?.write !== 'function')
    throw new Error('Native repository check requires an output stream');
  if (
    !repositoryPlanValue ||
    typeof repositoryPlanValue !== 'object' ||
    !Array.isArray(repositoryPlanValue.steps)
  )
    throw new Error(
      'Native repository check requires a sealed repository plan'
    );

  const repositoryPlan = sealNativeValue(structuredClone(repositoryPlanValue));
  const root = realpathSync(repositoryPlan.root);
  if (root !== repositoryPlan.root)
    throw new Error('Native repository check plan root is not canonical');
  const scratchRoot = realpathSync(scratchRootValue);

  return async function executeRepositoryCheck(stepValue, execution = {}) {
    if (
      !execution ||
      typeof execution !== 'object' ||
      Array.isArray(execution) ||
      Object.keys(execution).some((key) => !['index', 'signal'].includes(key))
    )
      throw new Error('Native repository check execution context is invalid');
    const { index, signal } = execution;
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new Error('Native repository check signal must be an AbortSignal');
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= repositoryPlan.steps.length
    )
      throw new Error(
        'Native repository check index is outside the sealed plan'
      );
    const expected = repositoryPlan.steps[index];
    if (
      expected.kind !== 'check' ||
      stepValue?.kind !== 'check' ||
      !isDeepStrictEqual(stepValue, expected)
    )
      throw new Error(
        'Native repository check differs from its sealed plan step'
      );

    signal?.throwIfAborted();
    await verifySource();
    signal?.throwIfAborted();

    const configDirectory = mkdtempSync(
      path.join(scratchRoot, repositoryCheckPrefix)
    );
    const command = {
      ...structuredClone(expected),
      cwd: root,
      env: isolatedEnvironment(configDirectory, inherited),
    };
    const failures = [];
    let receipt;
    try {
      stdout.write(`\n[${expected.name}]\n`);
      try {
        receipt = await nativeRun(command, { signal });
        requireRepositoryCheckReceipt(receipt, expected, scratchRoot);
      } catch (error) {
        if (error?.receipt) {
          receipt = error.receipt;
          try {
            requireRepositoryCheckReceipt(receipt, expected, scratchRoot);
          } catch (receiptError) {
            failures.push(receiptError);
          }
        }
        failures.unshift(error);
      }
    } finally {
      try {
        disposeRepositoryCheckDirectory(configDirectory, scratchRoot);
      } catch (error) {
        failures.push(error);
      }
      try {
        await verifySource();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const error = new AggregateError(
        failures,
        'Native repository check or its source/cleanup guard failed'
      );
      if (receipt) error.receipt = receipt;
      throw error;
    }
    return receipt;
  };
}

export async function executeNativeRepository(
  plan,
  {
    nativeRun,
    scratchRoot,
    stdout = process.stdout,
    stderr = process.stderr,
    inherited,
    signal,
    workers,
  }
) {
  const receipts = [],
    caseLedgers = [],
    attemptedSteps = [];
  try {
    const totals = await executePlan(plan, {
      stdout,
      stderr,
      inherited,
      signal,
      workers,
      collectFailures: true,
      executor: async (command, execution) => {
        attemptedSteps.push(command.name);
        let receipt;
        try {
          receipt = await nativeRun({
            ...command,
            cwd: plan.root,
            env: {
              ...execution.env,
              ...(command.kind === 'tooling'
                ? { NODE_OPTIONS: '--test-reporter=tap' }
                : {}),
            },
          });
        } catch (error) {
          if (command.kind === 'check' || error.receipt?.status !== 'failed') {
            if (error.receipt) receipts.push(error.receipt);
            throw error;
          }
          receipt = error.receipt;
        }
        receipts.push(receipt);
        requireRepositoryNativeReceipt(receipt, scratchRoot);
        if (receipt.id !== (command.id ?? command.name))
          throw new Error(
            'Native repository receipt command identity mismatch'
          );
        let vitestReport;
        if (command.kind === 'vitest') {
          const file = command.args
            .find((arg) => arg.startsWith('--outputFile.json='))
            ?.slice('--outputFile.json='.length);
          if (
            !file ||
            !beneath(execution.env.CONFIG_DIRECTORY, path.resolve(file))
          )
            throw new Error('Native Vitest output file is not bound');
          const bytes = readFileSync(
            regular(
              execution.env.CONFIG_DIRECTORY,
              path
                .relative(execution.env.CONFIG_DIRECTORY, file)
                .split(path.sep)
                .join('/')
            ).absolute
          );
          const artifact = path.join(scratchRoot, 'native-vitest-report.json');
          writeFileSync(artifact, bytes, { flag: 'wx' });
          receipt.nativeReport = { file: artifact, sha256: hash(bytes) };
          vitestReport = JSON.parse(bytes);
        }
        const ledger = repositoryNativeCases(
          { ...command, cwd: plan.root },
          receipt,
          { vitestReport, collectFailures: true }
        );
        if (ledger) caseLedgers.push(ledger);
        return {
          output: `${receipt.stdout}\n${receipt.stderr}`,
          nativeReceipt: receipt,
          caseLedger: ledger,
        };
      },
    });
    const counts = [...totals.values()];
    const actual = caseLedgers.reduce(
      (sum, ledger) => ({
        passed: sum.passed + ledger.counts.passed,
        failed: sum.failed + ledger.counts.failed,
        skipped: sum.skipped + ledger.counts.skipped,
      }),
      { passed: 0, failed: 0, skipped: 0 }
    );
    if (
      actual.passed + actual.failed !==
        counts.reduce((sum, count) => sum + count.active, 0) ||
      actual.passed + actual.failed + actual.skipped !==
        counts.reduce((sum, count) => sum + count.total, 0)
    )
      throw new Error(
        'Original repository totals do not close against native case ledgers'
      );
    return {
      status: actual.failed ? 'failed' : 'passed',
      cases: actual,
      caseLedgers,
      totals: Object.fromEntries(totals),
      commands: receipts,
      failures: totals.failures,
      resultReuse: false,
    };
  } catch (error) {
    error.repositoryEvidence = {
      commands: receipts,
      caseLedgers,
      attemptedSteps,
      unexecutedSteps: plan.steps
        .filter((step) => !attemptedSteps.includes(step.name))
        .map((step) => ({
          name: step.name,
          kind: step.kind,
          reason: 'Earlier native infrastructure or prerequisite failure',
        })),
      completed: false,
      resultReuse: false,
    };
    throw error;
  }
}

export function evaluatorHeadroom({
  memAvailableBytes,
  cgroupLimitBytes = null,
  cgroupCurrentBytes = 0,
  inactiveFileBytes = 0,
  reserveMb = 1024,
}) {
  if (
    ![
      memAvailableBytes,
      cgroupCurrentBytes,
      inactiveFileBytes,
      reserveMb,
    ].every((value) => Number.isFinite(value) && value >= 0) ||
    (cgroupLimitBytes !== null &&
      (!Number.isFinite(cgroupLimitBytes) || cgroupLimitBytes <= 0))
  )
    throw new Error('Invalid observed native memory capacity');
  const workingSetBytes = Math.max(0, cgroupCurrentBytes - inactiveFileBytes);
  const availableBytes = Math.min(
    memAvailableBytes,
    cgroupLimitBytes === null
      ? memAvailableBytes
      : Math.max(0, cgroupLimitBytes - workingSetBytes)
  );
  return {
    memAvailableBytes,
    cgroupLimitBytes,
    cgroupCurrentBytes,
    inactiveFileBytes,
    workingSetBytes,
    reserveMb,
    evaluatorMb: Math.max(
      0,
      Math.floor(availableBytes / 1024 ** 2) - reserveMb
    ),
    policy:
      'observed-MemAvailable-capped-by-cgroup-current-minus-inactive-file-with-explicit-reserve',
  };
}

function liveEvaluatorHeadroom() {
  let memAvailableBytes = Math.min(totalmem(), freemem()),
    cgroupLimitBytes = null,
    cgroupCurrentBytes = 0,
    inactiveFileBytes = 0;
  if (process.platform === 'linux') {
    const available = /^MemAvailable:\s*(\d+) kB$/m.exec(
      readFileSync('/proc/meminfo', 'utf8')
    );
    if (available)
      memAvailableBytes = Math.min(totalmem(), Number(available[1]) * 1024);
    if (existsSync('/sys/fs/cgroup/memory.max')) {
      const limit = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      if (limit !== 'max') cgroupLimitBytes = Number(limit);
      cgroupCurrentBytes = Number(
        readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim()
      );
      inactiveFileBytes = Number(
        /^inactive_file (\d+)$/m.exec(
          readFileSync('/sys/fs/cgroup/memory.stat', 'utf8')
        )?.[1] ?? 0
      );
    } else if (existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
      cgroupLimitBytes = Number(
        readFileSync(
          '/sys/fs/cgroup/memory/memory.limit_in_bytes',
          'utf8'
        ).trim()
      );
      cgroupCurrentBytes = Number(
        readFileSync(
          '/sys/fs/cgroup/memory/memory.usage_in_bytes',
          'utf8'
        ).trim()
      );
      inactiveFileBytes = Number(
        /^total_inactive_file (\d+)$/m.exec(
          readFileSync('/sys/fs/cgroup/memory/memory.stat', 'utf8')
        )?.[1] ?? 0
      );
    }
  }
  return evaluatorHeadroom({
    memAvailableBytes,
    cgroupLimitBytes,
    cgroupCurrentBytes,
    inactiveFileBytes,
  });
}

async function inspectTools(discoveryEnv, env, run) {
  const tools = {};
  for (const [id, name, args] of [
    ['bash', 'bash', ['--version']],
    ['perl', 'perl', ['--version']],
    ['find', 'find', ['--version']],
    ['python3', 'python3', ['--version']],
    ['dotnet9', 'dotnet', ['--version']],
    ['docker', 'docker', ['--version']],
    ['git', 'git', ['--version']],
    ['helm', 'helm', ['version', '--short']],
    ['helmDocs', 'helm-docs', ['--version']],
    ['ct', 'ct', ['version']],
    ['yamllint', 'yamllint', ['--version']],
    ['yamale', 'yamale', ['--version']],
    ['lychee', 'lychee', ['--version']],
  ]) {
    const executable = findNativeExecutable(name, discoveryEnv);
    if (!executable || /\.(cmd|bat)$/i.test(executable)) {
      tools[id] = {
        verified: false,
        reason:
          'Native executable not found or requires unsupported shell composition',
      };
      continue;
    }
    try {
      const result = await run({
        id: `prerequisite-${id}`,
        command: executable,
        args,
        env,
      });
      const versionOutput = `${result.stdout} ${result.stderr}`.trim();
      if (id === 'find' && !versionOutput.includes('GNU findutils'))
        throw new Error(
          'Repository scripts require GNU find, not a same-name platform utility'
        );
      tools[id] = {
        verified: true,
        executable,
        executableSha256: nativeInputFileIdentity(executable).sha256,
        version:
          versionOutput.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)/)?.[1] ??
          versionOutput,
        versionEvidenceSha256: hash(
          json({ stdout: result.stdout, stderr: result.stderr })
        ),
      };
    } catch (error) {
      tools[id] = { verified: false, reason: error.message };
    }
  }
  // Docker CLI availability never proves nested daemon/bind/loopback safety.
  if (tools.docker)
    Object.assign(tools.docker, {
      daemonVerified: false,
      scratchBindPathsVerified: false,
      loopbackReachabilityVerified: false,
    });
  return tools;
}

function packLocations(resolved, name, desiredVersion = null) {
  const found = new Map();
  for (const step of resolved.steps ?? []) {
    for (const scan of [...(step.scans ?? []), step]) {
      const item = scan.found?.[name];
      for (const pack of item?.path
        ? [item]
        : Object.entries(item ?? {}).map(([version, details]) => ({
            ...details,
            version,
          }))) {
        if (pack.path && (!desiredVersion || pack.version === desiredVersion))
          found.set(realpathSync(pack.path), pack);
      }
    }
  }
  if (found.size !== 1)
    throw new Error(`CodeQL pack is absent or ambiguous: ${name}`);
  return [...found.values()][0];
}

export async function resolveReviewedPrMetadata(
  callback,
  candidate,
  ownedPaths
) {
  if (callback === undefined) return undefined;
  if (typeof callback !== 'function')
    throw new Error('Reviewed PR metadata must come from an explicit callback');
  return await callback(
    Object.freeze({ ...candidate }),
    Object.freeze({ ...ownedPaths })
  );
}

export async function createNativeStageContext(
  sourceRoot,
  {
    runId,
    stdout = process.stdout,
    stderr = process.stderr,
    inherited = process.env,
    signal,
    workerOverride = null,
    operatorGithubLogin = null,
    requiredCapacityProof = null,
    scratchParent = tmpdir(),
    prerequisiteReferences = {},
    verifyNetworkBoundary,
    verifyDockerFixture,
    verifyGitHistory,
    withRepositoryIsolation,
    reviewedPrMetadata,
  } = {}
) {
  if (typeof runId !== 'string' || !MACHINE_ID.test(runId))
    throw new Error('Native stage context requires the exact public run ID');
  if (
    operatorGithubLogin !== null &&
    (typeof operatorGithubLogin !== 'string' ||
      !MACHINE_ID.test(operatorGithubLogin))
  )
    throw new Error('Native stage context operator GitHub login is invalid');
  const capacity = detectWorkerCapacity({
    sourceRoot,
    environment: inherited,
    override: workerOverride,
    operatorGithubLogin,
    requiredProof: requiredCapacityProof,
  });
  if (
    operatorGithubLogin !== null &&
    capacity.operatorGithubLogin !== operatorGithubLogin
  )
    throw new Error('Native stage context operator identity was not admitted');
  const snapshot = createOwnedSourceSnapshot(sourceRoot, { scratchParent });
  let processReceipts;
  try {
    // Public operator identity is resolved on the real checkout, not from copied
    // credentials/config. Retain only that approved login for existing Vitest's
    // automatic capacity resolver when it executes on the disposable copy.
    if (capacity.operatorGithubLogin)
      git(snapshot.root, [
        'config',
        'github.user',
        capacity.operatorGithubLogin,
      ]);
    const logs = path.join(snapshot.scratchRoot, 'logs'),
      home = path.join(snapshot.scratchRoot, 'tool-home'),
      supplementalFixtures = path.join(
        snapshot.scratchRoot,
        'supplemental-fixtures'
      ),
      codeqlScratch = path.join(snapshot.scratchRoot, 'codeql');
    for (const directory of [logs, home, supplementalFixtures, codeqlScratch])
      mkdirSync(directory);
    processReceipts = createNativeProcessReceiptLedger(
      snapshot.scratchRoot,
      snapshot.candidate
    );
    const env = nativeEnvironment(inherited, home);
    const dependencyRoot = realpathSync(path.join(sourceRoot, 'node_modules'));
    const dependencyProof = readonlyMountProof(dependencyRoot);
    symlinkSync(
      dependencyRoot,
      path.join(snapshot.root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const blockers = [];
    const blocked = (id, stage, reason) =>
      blockers.push({
        id,
        stage,
        required: true,
        status: 'prerequisite-blocked',
        reason,
      });
    if (!dependencyProof.verified)
      blocked(
        'readonly-installed-dependency-reference',
        'repository',
        dependencyProof.reason
      );
    const installedLock = path.join(dependencyRoot, '.pnpm/lock.yaml');
    const installedLockSha256 = existsSync(installedLock)
      ? hash(readFileSync(installedLock))
      : null;
    if (installedLockSha256 !== snapshot.candidate.lockSha256)
      blocked(
        'installed-dependency-lock-binding',
        'repository',
        'Installed dependency lockfile does not match the actual frozen source lockfile'
      );
    const dependency = closure(dependencyRoot);
    const inputClosures = [
      {
        ...dependency,
        paths: [
          path.join(sourceRoot, 'node_modules'),
          path.join(snapshot.root, 'node_modules'),
        ],
      },
    ];
    const inputFiles = [nativeInputFileIdentity(process.execPath)];
    if (existsSync(installedLock)) {
      const installed = nativeInputFileIdentity(installedLock);
      if (installed.sha256 !== installedLockSha256)
        throw new Error('Installed dependency lock changed during preparation');
      inputFiles.push(installed);
    }
    let ordinal = 0;
    let supplementalSnapshot, docsLinkSnapshot;
    const derivedOutputs = new Set(),
      derivedArtifacts = [];
    const nativeRun = async (command, options = {}) => {
      signal?.throwIfAborted();
      const id = `${++ordinal}-${(command.id ?? command.name ?? 'native').replace(/[^A-Za-z0-9_-]/g, '-')}`;
      let executable = command.command,
        args = [...command.args];
      if (executable === 'pnpm' && process.platform === 'win32') {
        const cli = inherited.npm_execpath;
        if (!cli || !/pnpm\.(?:c?js)$/i.test(path.basename(cli)))
          throw new Error(
            'Native Windows pnpm Node entry is unavailable; no shell command is invented'
          );
        executable = process.execPath;
        args.unshift(realpathSync(cli));
      }
      if (command.id === 'docs-api-generate') derivedOutputs.add('docs-api');
      if (command.id === 'charts-generated-docs')
        derivedOutputs.add('chart-docs');
      prepareJellyfinTemporaryDirectory(command, supplementalFixtures);
      let resourceAdmission;
      if (
        /^codeql-(?:actions|javascript)-(?:create|analyze)$/.test(
          command.id ?? ''
        )
      ) {
        const currentCapacity = detectWorkerCapacity({
          sourceRoot: snapshot.authoritativeRoot,
          environment: inherited,
          operatorGithubLogin,
          requiredProof: requiredCapacityProof,
        });
        const memory = liveEvaluatorHeadroom();
        if (
          currentCapacity.effectiveLogicalCpus < codeqlPlan.resources.threads ||
          memory.evaluatorMb < codeqlPlan.resources.memoryMb
        )
          throw new Error(
            'Current native CodeQL CPU/memory capacity is below the sealed command budget'
          );
        resourceAdmission = {
          effectiveLogicalCpus: currentCapacity.effectiveLogicalCpus,
          memory,
        };
      }
      processReceipts.begin(id, command);
      try {
        const receipt = await runCommand(
          {
            ...command,
            command: executable,
            args,
            name: command.name ?? command.id,
          },
          {
            root: command.cwd ?? snapshot.root,
            env: { ...env, ...command.env },
            stdout:
              command.id === 'cypress-fixture-external-config'
                ? { write() {} }
                : stdout,
            stderr,
            signal: options.signal ?? signal,
            timeoutMs: options.timeoutMs,
            receipt: true,
            logDirectory: logs,
            stdoutLog: path.join(logs, `${id}.stdout.log`),
            stderrLog: path.join(logs, `${id}.stderr.log`),
          }
        );
        processReceipts.complete(id, receipt);
        return {
          ...materializeNativeReceipt(receipt),
          ...(resourceAdmission ? { resourceAdmission } : {}),
        };
      } catch (error) {
        if (error.receipt) {
          processReceipts.complete(id, error.receipt);
          error.receipt = {
            ...materializeNativeReceipt(error.receipt),
            ...(resourceAdmission ? { resourceAdmission } : {}),
          };
        }
        throw error;
      } finally {
        if (docsLinkSnapshot) verifySourceSnapshot(docsLinkSnapshot);
        if (supplementalSnapshot) {
          verifySourceSnapshot(supplementalSnapshot, { derivedOutputs });
          if (derivedOutputs.size) {
            const artifact = derivedOutputManifest(
              supplementalSnapshot,
              derivedOutputs
            );
            const file = path.join(
              snapshot.scratchRoot,
              `${id}.derived-doc-output.json`
            );
            writeFileSync(file, json(artifact), { flag: 'wx' });
            derivedArtifacts.push({ file, sha256: hash(json(artifact)) });
          }
        }
      }
    };
    const tools = await inspectTools(inherited, env, (command) =>
      nativeRun(command, { timeoutMs: 10_000 })
    );
    if (tools.ct?.verified) {
      const configDir =
        prerequisiteReferences.chartTestingConfig ??
        inherited.CT_CONFIG_DIR ??
        path.join(path.dirname(tools.ct.executable), 'etc');
      try {
        const actual = realpathSync(configDir),
          proof = readonlyMountProof(actual);
        if (!proof.verified)
          throw new Error(
            'Chart-testing bundled configuration is not proven read-only'
          );
        const schema = regular(actual, 'chart_schema.yaml'),
          lint = regular(actual, 'lintconf.yaml');
        Object.assign(tools.ct, {
          configDir: actual,
          configSha256: {
            chartSchema: hash(readFileSync(schema.absolute)),
            lintconf: hash(readFileSync(lint.absolute)),
          },
          configReadonlyProof: proof,
        });
        for (const [file, expected] of [
          [schema.absolute, tools.ct.configSha256.chartSchema],
          [lint.absolute, tools.ct.configSha256.lintconf],
        ]) {
          const identity = nativeInputFileIdentity(file);
          if (identity.sha256 !== expected)
            throw new Error(
              'Chart-testing configuration changed during preparation'
            );
          inputFiles.push(identity);
        }
      } catch (error) {
        tools.ct.configProofFailure = error.message;
      }
    }
    const proofContext = {
      candidate: snapshot.candidate,
      capacity,
      scratchRoot: snapshot.scratchRoot,
    };
    let gitHistoryProof = null;
    if (tools.git?.verified) {
      const localTagRefsSha256 = hash(
        git(snapshot.root, [
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/tags',
        ])
      );
      Object.assign(tools.git, {
        knownHistory: !snapshot.shallow,
        knownTags: git(snapshot.root, ['tag', '--list']).trim().length > 0,
        localTagRefsSha256,
        completeHistory: false,
        completeTags: false,
      });
      if (typeof verifyGitHistory === 'function') {
        try {
          const proof = await verifyGitHistory({
            ...proofContext,
            localTagRefsSha256,
          });
          if (
            proof?.verified !== true ||
            proof.completeClosure !== true ||
            snapshot.shallow ||
            proof.sourceSha256 !== snapshot.candidate.sourceSha256 ||
            proof.commit !== snapshot.candidate.commit ||
            typeof proof.version !== 'string' ||
            !proof.version.trim() ||
            proof.localTagRefsSha256 !== localTagRefsSha256 ||
            proof.remoteTagRefsSha256 !== localTagRefsSha256 ||
            !/^[a-f0-9]{64}$/.test(proof.remoteRefsSha256 ?? '') ||
            !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
            git(snapshot.root, [
              'rev-list',
              '--objects',
              '--all',
              '--missing=print',
            ])
              .split('\n')
              .some((line) => line.startsWith('?'))
          )
            throw new Error(
              'Authenticated complete Git remote/history/tag closure is unproven'
            );
          gitHistoryProof = proof;
          Object.assign(tools.git, {
            completeHistory: true,
            completeTags: true,
            closureProof: proof,
          });
        } catch (error) {
          tools.git.reason = error.message;
        }
      }
    }
    let dockerFixtureProof = null;
    if (typeof verifyDockerFixture === 'function') {
      try {
        const proof = await verifyDockerFixture(proofContext);
        const socket = proof.endpoint?.startsWith('unix://')
          ? path.resolve(proof.endpoint.slice(7))
          : null;
        if (
          process.platform !== 'linux' ||
          proof.verified !== true ||
          proof.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          proof.namespaceId !== readlinkSync('/proc/self/ns/net') ||
          !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
          !proof.daemonVerified ||
          !proof.daemonId ||
          !proof.scratchBindPathsVerified ||
          !proof.loopbackReachabilityVerified ||
          !socket ||
          !beneath(snapshot.scratchParent, socket) ||
          !lstatSync(socket).isSocket() ||
          proof.executableSha256 !== tools.docker?.executableSha256
        )
          throw new Error(
            'Private Docker endpoint/daemon/fixture namespace proof is incomplete'
          );
        dockerFixtureProof = proof;
        tools.docker = { ...tools.docker, ...proof };
        env.DOCKER_HOST = proof.endpoint;
      } catch (error) {
        if (tools.docker) tools.docker.reason = error.message;
      }
    }
    const docsDeps =
      prerequisiteReferences.docsDependencies ??
      path.join(sourceRoot, 'gen-docs/node_modules');
    if (existsSync(docsDeps) && readonlyMountProof(docsDeps).verified) {
      symlinkSync(
        realpathSync(docsDeps),
        path.join(snapshot.root, 'gen-docs/node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const lockSha256 = hash(
        readFileSync(path.join(snapshot.root, 'gen-docs/pnpm-lock.yaml'))
      );
      const installedDocsLock = path.join(docsDeps, '.pnpm/lock.yaml');
      tools.docsDependencies = {
        verified:
          existsSync(installedDocsLock) &&
          hash(readFileSync(installedDocsLock)) === lockSha256,
        lockSha256,
        closure: closure(docsDeps),
      };
      inputClosures.push({
        ...tools.docsDependencies.closure,
        paths: [docsDeps, path.join(snapshot.root, 'gen-docs/node_modules')],
      });
      if (existsSync(installedDocsLock)) {
        const installed = nativeInputFileIdentity(installedDocsLock);
        if (tools.docsDependencies.verified && installed.sha256 !== lockSha256)
          throw new Error('Installed docs lock changed during preparation');
        inputFiles.push(installed);
      }
    }
    const workflowText = readFileSync(
      path.join(snapshot.root, '.github/workflows/codeql.yml'),
      'utf8'
    );
    let codeqlPlan = {
        sourceIdentity: { sha256: snapshot.candidate.sourceSha256 },
        prerequisiteBlocked: true,
      },
      codeqlToolchain = null;
    try {
      const executable = findNativeExecutable('codeql', inherited);
      if (!executable || /\.(cmd|bat)$/i.test(executable))
        throw new Error('Native CodeQL CLI not installed');
      const versionReceipt = await nativeRun(
        {
          id: 'codeql-version',
          command: executable,
          args: ['version', '--format=json'],
          env: nativeEnvironment(inherited, home),
        },
        { timeoutMs: 10_000 }
      );
      const nativeVersion = JSON.parse(versionReceipt.stdout);
      const modelReference = prerequisiteReferences.codeqlModels;
      if (modelReference && !readonlyMountProof(modelReference).verified)
        throw new Error(
          'Explicit public CodeQL model reference is not proven read-only'
        );
      const resolveArgs = ['resolve', 'packs', '--format=json'];
      if (modelReference)
        resolveArgs.push(`--additional-packs=${realpathSync(modelReference)}`);
      const resolveReceipt = await nativeRun(
        {
          id: 'codeql-packs',
          command: executable,
          args: resolveArgs,
          env: modelReference
            ? nativeEnvironment(inherited, home)
            : buildBrowserEnvironment(inherited, home, 5056),
        },
        { timeoutMs: 10_000 }
      );
      const resolved = JSON.parse(resolveReceipt.stdout),
        workflow = readCodeqlWorkflow(workflowText),
        packs = [];
      for (const name of workflow.languages.map(
        (language) => `codeql/${language}-queries`
      )) {
        const pack = packLocations(resolved, name);
        packs.push({
          name,
          version: pack.version,
          ...closure(path.dirname(pack.path)),
          ...readCodeqlQueryPackMetadata(readFileSync(pack.path), {
            name,
            version: pack.version,
            cliVersion: nativeVersion.version,
          }),
        });
      }
      const [modelName, modelVersion] = workflow.modelPack.split('@'),
        model = packLocations(resolved, modelName, modelVersion);
      packs.push({
        name: modelName,
        version: modelVersion,
        ...closure(path.dirname(model.path)),
      });
      const cliClosure = closure(path.dirname(executable));
      codeqlToolchain = {
        cliPath: executable,
        cliVersion: nativeVersion.version,
        sha256: cliClosure.sha256,
        packs,
        nativeVersion,
      };
      inputClosures.push(
        { ...cliClosure, paths: [path.dirname(executable)] },
        ...packs.map((pack) => ({ ...pack, paths: [pack.root] }))
      );
      const memoryAdmission = liveEvaluatorHeadroom();
      codeqlToolchain.memoryAdmission = memoryAdmission;
      // Do not reserve all free RAM on a large runner. The native evaluator's
      // bounded budget leaves measured headroom for the controller and fixtures.
      const memoryMb = Math.min(4096, memoryAdmission.evaluatorMb);
      codeqlPlan = createCodeqlSteps({
        sourceRoot: snapshot.root,
        scratchRoot: codeqlScratch,
        capacity,
        memoryMb,
        toolchain: codeqlToolchain,
        workflowText,
        sourceIdentity: { sha256: snapshot.candidate.sourceSha256 },
      });
      for (const command of codeqlPlan.steps) {
        if (command.args[1] === 'analyze')
          command.args.push(
            `--additional-packs=${packs.map((pack) => pack.root).join(path.delimiter)}`
          );
      }
      // Additional-packs is part of the sealed native command recipe, never an
      // unrecorded executable override after the plan is approved.
      const unsealed = { ...codeqlPlan };
      delete unsealed.planSha256;
      codeqlPlan.planSha256 = hash(JSON.stringify(unsealed));
    } catch (error) {
      blocked('native-codeql-toolchain', 'codeql', error.message);
    }
    const buildBrowserPlan = await createBuildBrowserStages({
      root: snapshot.root,
      authoritativeRoot: snapshot.authoritativeRoot,
      scratchRoot: snapshot.scratchRoot,
      fixtureRoot: path.join(snapshot.scratchRoot, 'browser-fixture'),
      candidate: snapshot.candidate,
      capacity,
      inheritedEnv: env,
    });
    supplementalSnapshot = createOwnedSourceSnapshot(
      snapshot.authoritativeRoot,
      { scratchParent: snapshot.scratchRoot }
    );
    if (
      supplementalSnapshot.candidate.sourceSha256 !==
      snapshot.candidate.sourceSha256
    )
      throw new Error(
        'Supplemental source copy does not match the sealed application input'
      );
    symlinkSync(
      dependencyRoot,
      path.join(supplementalSnapshot.root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    if (tools.docsDependencies?.verified)
      symlinkSync(
        realpathSync(docsDeps),
        path.join(supplementalSnapshot.root, 'gen-docs/node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    inputClosures[0].paths.push(
      path.join(supplementalSnapshot.root, 'node_modules')
    );
    if (tools.docsDependencies?.verified)
      inputClosures
        .find((reference) => reference.root === realpathSync(docsDeps))
        .paths.push(
          path.join(supplementalSnapshot.root, 'gen-docs/node_modules')
        );
    for (const tool of Object.values(tools)) {
      if (!tool.verified || !tool.executable || !tool.executableSha256)
        continue;
      const identity = nativeInputFileIdentity(tool.executable);
      if (identity.sha256 !== tool.executableSha256)
        throw new Error('Native executable changed during preparation');
      inputFiles.push(identity);
    }
    docsLinkSnapshot = createOwnedDocsLinkSnapshot(snapshot);
    let networkBoundaryProof = nativeNetworkBoundary();
    if (typeof verifyNetworkBoundary === 'function') {
      try {
        networkBoundaryProof = validateNativeBoundaryProof(
          await verifyNetworkBoundary(proofContext),
          snapshot.candidate
        );
      } catch (error) {
        networkBoundaryProof = {
          isolated: false,
          deniesPrivateProviders: false,
          reason: error.message,
        };
      }
    }
    if (!networkBoundaryProof.isolated)
      blocked(
        'browser-provider-network-boundary',
        'browser',
        networkBoundaryProof.reason
      );
    const repositoryIsolation = repositoryIsolationReadiness(
      withRepositoryIsolation
    );
    if (!repositoryIsolation.ready)
      blocked(
        'repository-loopback-only-network-boundary',
        'repository',
        repositoryIsolation.reason
      );
    let defaultBranch = null;
    try {
      defaultBranch = git(snapshot.root, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
      ])
        .trim()
        .replace(/^refs\/remotes\/origin\//, '');
    } catch {
      // A missing remote default branch remains unknown, never inferred.
    }
    const metadata = await resolveReviewedPrMetadata(
      reviewedPrMetadata,
      snapshot.candidate,
      { fixtureRoot: supplementalFixtures, scratchRoot: snapshot.scratchRoot }
    );
    const supplemental = await createSupplementalPrStages({
      root: supplementalSnapshot.root,
      linksRoot: docsLinkSnapshot.root,
      scratchRoot: snapshot.scratchRoot,
      fixtureRoot: supplementalFixtures,
      candidate: snapshot.candidate,
      tools,
      scope: 'full',
      env,
      configuredWorkers: capacity.configuredWorkers,
      defaultBranch,
      metadata,
    });
    const normalized = normalizeSupplementalPrChecks(supplemental);
    const pendingMetadata = normalized.pendingMetadata;
    const repositoryPlan = createPlan(snapshot.root, {
      canonicalTypescript: true,
      dependencyReference: {
        root: dependencyRoot,
        readonlyProof: dependencyProof,
        lockSha256: installedLockSha256,
      },
    });
    const environmentIdentity = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      nodeExecutableSha256: inputFiles[0].sha256,
      dependency,
      dependencyProof,
      installedLockSha256,
      nativeInputFreshness: { closures: inputClosures, files: inputFiles },
      codeqlToolchain,
      tools,
      networkBoundaryProof,
      repositoryIsolation,
      capacity,
      sourceSha256: snapshot.candidate.sourceSha256,
    };
    const executionEnvironmentSha256 = hash(json(environmentIdentity));
    const environmentManifest = path.join(
      snapshot.scratchRoot,
      'native-environment-manifest.json'
    );
    writeFileSync(environmentManifest, json(environmentIdentity), {
      flag: 'wx',
    });
    const binding = createStagedValidation({
      runId,
      candidate: snapshot.candidate,
      executionEnvironmentSha256,
      capacity,
      repositoryPlan,
      codeqlPlan,
      buildBrowserPlan,
      prChecks: [...normalized.prChecks, ...blockers],
    });
    let preserveTemporary = false;
    const verifyRepositoryCheckSource = () => {
      verifySourceSnapshot(snapshot);
      verifySourceSnapshot(docsLinkSnapshot);
      verifySourceSnapshot(supplementalSnapshot, { derivedOutputs });
      verifyNativeInputFreshness({
        closures: inputClosures,
        files: inputFiles,
      });
    };
    const verifySource = async () => {
      verifyRepositoryCheckSource();
      if (networkBoundaryProof.isolated) {
        if (typeof verifyNetworkBoundary === 'function') {
          const fresh = validateNativeBoundaryProof(
            await verifyNetworkBoundary(proofContext),
            snapshot.candidate
          );
          if (fresh.rulesSha256 !== networkBoundaryProof.rulesSha256)
            throw new Error('Frozen browser boundary rules changed');
        } else if (!nativeNetworkBoundary().isolated)
          throw new Error('Browser network boundary changed');
      }
      if (dockerFixtureProof) {
        const fresh = await verifyDockerFixture(proofContext);
        if (
          fresh.verified !== true ||
          fresh.daemonId !== dockerFixtureProof.daemonId ||
          fresh.endpoint !== dockerFixtureProof.endpoint ||
          fresh.namespaceId !== dockerFixtureProof.namespaceId ||
          fresh.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          fresh.daemonVerified !== true ||
          fresh.scratchBindPathsVerified !== true ||
          fresh.loopbackReachabilityVerified !== true ||
          !/^[a-f0-9]{64}$/.test(fresh.evidenceSha256 ?? '')
        )
          throw new Error('Private Docker fixture proof changed');
      }
      if (gitHistoryProof) {
        const fresh = await verifyGitHistory({
          ...proofContext,
          localTagRefsSha256: tools.git.localTagRefsSha256,
        });
        if (
          fresh?.verified !== true ||
          fresh.completeClosure !== true ||
          fresh.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          fresh.commit !== snapshot.candidate.commit ||
          fresh.localTagRefsSha256 !== gitHistoryProof.localTagRefsSha256 ||
          fresh.remoteTagRefsSha256 !== gitHistoryProof.remoteTagRefsSha256 ||
          fresh.remoteRefsSha256 !== gitHistoryProof.remoteRefsSha256 ||
          !/^[a-f0-9]{64}$/.test(fresh.evidenceSha256 ?? '')
        )
          throw new Error(
            'Authenticated Git history/tag closure proof changed'
          );
      }
    };
    const options = {
      signal,
      run: nativeRun,
      readFile: async (file) =>
        readNativeStageArtifact(file, {
          scratchRoot: snapshot.scratchRoot,
          queryPacks: codeqlToolchain?.packs ?? [],
        }),
      writeArtifact: async (artifact) => {
        if (
          !beneath(codeqlScratch, path.resolve(artifact.path)) ||
          !beneath(
            snapshot.scratchRoot,
            realpathSync(path.dirname(artifact.path))
          ) ||
          hash(artifact.contents) !== artifact.sha256
        )
          throw new Error('Unbound CodeQL artifact');
        writeFileSync(artifact.path, artifact.contents, { flag: 'wx' });
      },
      verifySource,
      networkBoundaryProof,
      ...(typeof withRepositoryIsolation === 'function'
        ? { withRepositoryIsolation }
        : {}),
      executeRepositoryCheck: createNativeRepositoryCheckExecutor(
        binding.repositoryPlan,
        {
          nativeRun,
          scratchRoot: snapshot.scratchRoot,
          inherited: env,
          // The coordinator's full guards verify live policy before and after
          // the repository stage. Per-check guards run inside loopback-only
          // isolation, so they revalidate only sealed source and native inputs.
          verifySource: verifyRepositoryCheckSource,
          stdout,
        }
      ),
      executeRepository: async (plan) => {
        if (
          !withRepositoryIsolation &&
          !repositoryIsolationReadiness(undefined).ready
        )
          throw new Error(
            'Repository loopback-only network boundary changed before native execution'
          );
        return executeNativeRepository(plan, {
          nativeRun,
          scratchRoot: snapshot.scratchRoot,
          stdout,
          stderr,
          inherited: env,
          signal,
          workers: capacity.configuredWorkers,
        });
      },
      startServer: async (descriptor) => {
        const id = `${++ordinal}-browser-server`;
        processReceipts.begin(id, descriptor, 'server');
        const service = startCommand(descriptor, {
          root: descriptor.cwd,
          env: descriptor.env,
          stdout,
          stderr,
          signal,
          logDirectory: logs,
          stdoutLog: path.join(logs, 'browser-server.stdout.log'),
          stderrLog: path.join(logs, 'browser-server.stderr.log'),
        });
        const exit = service.exit.then((receipt) => {
          processReceipts.complete(id, receipt);
          return receipt;
        });
        return {
          ...service,
          exit,
          stop: async () => {
            try {
              return await service.stop();
            } finally {
              await exit;
            }
          },
        };
      },
      waitForReady: async (url, { service }) =>
        service.waitForReady(() => probeNativeBrowserReadiness(url), {
          timeoutMs: 30_000,
          pollMs: 100,
        }),
    };
    const localBlocked = [...normalized.prChecks, ...blockers].filter(
      (check) => check.required && check.status === 'prerequisite-blocked'
    );
    const report = {
      schema: 1,
      runId,
      status: localBlocked.length ? 'prerequisite-blocked' : 'ready',
      candidate: snapshot.candidate,
      capacity,
      executionEnvironmentSha256,
      environmentManifest: {
        file: environmentManifest,
        sha256: executionEnvironmentSha256,
      },
      sourceManifest: {
        file: path.join(snapshot.scratchRoot, 'source-manifest.json'),
        sha256: snapshot.candidate.sourceSha256,
      },
      dependencyProof,
      networkBoundaryProof,
      repositoryIsolation,
      browserInventory: {
        cypress: [...buildBrowserPlan.cypressSpecs],
        playwright: [...buildBrowserPlan.playwrightSpecs],
      },
      blockedRequired: localBlocked,
      pendingMetadata,
      delegatedCoverageReferences: normalized.delegatedCoverageReferences,
      derivedCoverageReferences: normalized.derivedCoverageReferences ?? [],
      artifacts: snapshot.scratchRoot,
      stages: ['repository', 'codeql', 'build', 'browser'],
      actualTestsExecuted: 0,
      actualBuilds: 0,
      resultReuse: false,
    };
    writeFileSync(
      path.join(snapshot.scratchRoot, 'native-context-report.json'),
      json(report),
      { flag: 'wx' }
    );
    return {
      binding,
      options,
      report,
      snapshot,
      pendingMetadata,
      derivedArtifacts,
      describeNativeProcessReceipts: processReceipts.describe,
      cleanup: async (error) => {
        preserveTemporary ||= error?.preserveTemporary === true;
        await verifySource();
        if (!preserveTemporary) disposeSourceSnapshot(snapshot);
      },
    };
  } catch (error) {
    error.scratchRoot = snapshot.scratchRoot;
    if (processReceipts)
      error.nativeProcessReceiptLedger = processReceipts.describe();
    error.preserveTemporary = true;
    try {
      verifySourceSnapshot(snapshot);
    } catch (guard) {
      error.sourceGuardFailure = guard.message;
    }
    throw error;
  }
}

export function disposeSourceSnapshot(snapshot) {
  const root = path.resolve(snapshot.scratchRoot);
  if (
    path.dirname(root) !== snapshot.scratchParent ||
    !path.basename(root).startsWith(prefix) ||
    lstatSync(root).isSymbolicLink() ||
    !beneath(snapshot.scratchParent, realpathSync(root))
  )
    throw new Error('Refusing unsafe native scratch cleanup');
  rmSync(root, { recursive: true, force: true });
}
