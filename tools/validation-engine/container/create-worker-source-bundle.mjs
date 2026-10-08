// Copyright (c) snapetech and SeerrNG contributors.
// Creates the shallow candidate-and-release-tags bundle admitted by Dockerfile.worker.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';

const GIT_SHA1 = /^[a-f0-9]{40}$/;
const RELEASE_TAG_REF_PREFIX = 'refs/tags/v3.';
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

function comparablePath(value) {
  const resolved = resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function containsPath(parent, candidate) {
  const child = relative(parent, candidate);
  return (
    child === '' ||
    (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

function safeGitEnvironment(environment) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !name.toUpperCase().startsWith('GIT_')
    )
  );
  return {
    ...clean,
    GCM_INTERACTIVE: 'Never',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    SSH_ASKPASS_REQUIRE: 'never',
  };
}

function runGit({
  args,
  cwd,
  environment,
  label,
  allowFailure = false,
  input,
}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    input,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  });
  if (result.error)
    throw new Error(`Worker source bundle could not ${label}`, {
      cause: result.error,
    });
  if (!allowFailure && result.status !== 0)
    throw new Error(`Worker source bundle could not ${label}`);
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function gitText(options) {
  return runGit(options).stdout.trim();
}

function exactHash(value, label) {
  if (!GIT_SHA1.test(value))
    throw new Error(`Worker source bundle requires an exact ${label}`);
  return value;
}

function existingRealDirectory(path, label) {
  let entry;
  try {
    entry = lstatSync(path);
  } catch (error) {
    throw new Error(`Worker source bundle ${label} must already exist`, {
      cause: error,
    });
  }
  if (entry.isSymbolicLink() || !entry.isDirectory())
    throw new Error(`Worker source bundle ${label} must be a real directory`);
  const real = realpathSync.native(path);
  if (!samePath(path, real))
    throw new Error(
      `Worker source bundle ${label} must be a canonical real directory`
    );
  return real;
}

function assertUnused(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error('Worker source bundle output could not be inspected', {
      cause: error,
    });
  }
  throw new Error('Worker source bundle output must not already exist');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function inspectReleaseTags(repository, environment) {
  const output = runGit({
    args: [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)',
      'refs/tags/v3.*',
    ],
    cwd: repository,
    environment,
    label: 'inspect SeerrNG release tags',
  }).stdout.trimEnd();
  if (!output)
    throw new Error(
      'Worker source bundle requires at least one SeerrNG v3 release tag'
    );
  const releaseTags = output.split(/\r?\n/u).map((line) => {
    const [refName, objectType, objectId, peeledType, peeledObjectId, ...rest] =
      line.split('\t');
    if (
      rest.length > 0 ||
      !refName?.startsWith(RELEASE_TAG_REF_PREFIX) ||
      !GIT_SHA1.test(objectId ?? '')
    )
      throw new Error('Worker source bundle found an invalid release tag ref');
    let commitId;
    if (objectType === 'commit' && !peeledType && !peeledObjectId)
      commitId = objectId;
    else if (
      objectType === 'tag' &&
      peeledType === 'commit' &&
      GIT_SHA1.test(peeledObjectId ?? '')
    )
      commitId = peeledObjectId;
    else
      throw new Error(
        `Worker source bundle release tag must resolve to a commit: ${refName}`
      );
    return Object.freeze({ commitId, objectId, refName });
  });
  if (
    new Set(releaseTags.map(({ refName }) => refName)).size !==
    releaseTags.length
  )
    throw new Error('Worker source bundle release tag refs must be unique');
  return Object.freeze(releaseTags);
}

function canonicalReleaseTags(releaseTags) {
  return releaseTags
    .map(
      ({ commitId, objectId, refName }) =>
        `${objectId} ${commitId} ${refName}\n`
    )
    .join('');
}

function assertReleaseTagsMatch(actual, expected, label) {
  if (canonicalReleaseTags(actual) !== canonicalReleaseTags(expected))
    throw new Error(`Worker source bundle ${label} release tags do not match`);
}

function inspectSourceRoot(sourceRoot, environment) {
  if (typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot))
    throw new Error('Worker source bundle source root must be absolute');
  const source = existingRealDirectory(resolve(sourceRoot), 'source root');
  const topLevel = gitText({
    args: ['rev-parse', '--show-toplevel'],
    cwd: source,
    environment,
    label: 'resolve the Git top level',
  });
  let realTopLevel;
  try {
    realTopLevel = realpathSync.native(topLevel);
  } catch (error) {
    throw new Error('Worker source bundle could not verify the Git top level', {
      cause: error,
    });
  }
  if (!samePath(source, realTopLevel))
    throw new Error(
      'Worker source bundle source root must be the exact Git top level'
    );
  if (
    gitText({
      args: ['rev-parse', '--is-inside-work-tree'],
      cwd: source,
      environment,
      label: 'verify the source worktree',
    }) !== 'true'
  )
    throw new Error('Worker source bundle source must be a Git worktree');
  if (
    gitText({
      args: ['rev-parse', '--show-object-format'],
      cwd: source,
      environment,
      label: 'resolve the source object format',
    }) !== 'sha1'
  )
    throw new Error(
      'Worker source bundle requires the Git SHA-1 object format'
    );
  const sourceCommit = exactHash(
    gitText({
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      cwd: source,
      environment,
      label: 'resolve the source commit',
    }),
    'source commit'
  );
  const sourceTree = exactHash(
    gitText({
      args: ['rev-parse', '--verify', 'HEAD^{tree}'],
      cwd: source,
      environment,
      label: 'resolve the source tree',
    }),
    'source tree'
  );
  const status = gitText({
    args: [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ],
    cwd: source,
    environment,
    label: 'inspect source cleanliness',
  });
  if (status)
    throw new Error('Worker source bundle requires a clean source worktree');
  const releaseTags = inspectReleaseTags(source, environment);
  return {
    source,
    sourceCommit,
    sourceTree,
    releaseTags,
    releaseTagsSha256: sha256Text(canonicalReleaseTags(releaseTags)),
  };
}

function inspectOutputPath(outputPath, source) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath))
    throw new Error('Worker source bundle output path must be absolute');
  const output = resolve(outputPath);
  const parent = existingRealDirectory(dirname(output), 'output parent');
  const canonicalOutput = join(parent, basename(output));
  if (!samePath(output, canonicalOutput))
    throw new Error('Worker source bundle output path must be canonical');
  if (containsPath(source, canonicalOutput))
    throw new Error(
      'Worker source bundle output must be outside the source worktree'
    );
  assertUnused(canonicalOutput);
  return canonicalOutput;
}

function initializeRepository(path, environment) {
  mkdirSync(path, { mode: 0o700 });
  runGit({
    args: ['init', '--quiet', '--template=', '--object-format=sha1'],
    cwd: path,
    environment,
    label: 'initialize a temporary repository',
  });
}

function verifyRepository({
  path,
  sourceCommit,
  sourceTree,
  environment,
  label,
}) {
  const commit = exactHash(
    gitText({
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
      cwd: path,
      environment,
      label: `verify the ${label} commit`,
    }),
    `${label} commit`
  );
  const tree = exactHash(
    gitText({
      args: ['rev-parse', '--verify', 'HEAD^{tree}'],
      cwd: path,
      environment,
      label: `verify the ${label} tree`,
    }),
    `${label} tree`
  );
  if (commit !== sourceCommit || tree !== sourceTree)
    throw new Error(
      `Worker source bundle ${label} identity does not match the source`
    );
  if (
    gitText({
      args: ['rev-list', '--count', 'HEAD'],
      cwd: path,
      environment,
      label: `count the ${label} history`,
    }) !== '1'
  )
    throw new Error(`Worker source bundle ${label} must contain one commit`);
  if (
    gitText({
      args: [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ],
      cwd: path,
      environment,
      label: `inspect the ${label} worktree`,
    })
  )
    throw new Error(`Worker source bundle ${label} worktree is not clean`);
}

function assertExactBundleHeads({
  repository,
  bundle,
  sourceCommit,
  releaseTags,
  environment,
}) {
  const output = runGit({
    args: ['bundle', 'list-heads', bundle],
    cwd: repository,
    environment,
    label: 'inspect bundle heads',
  }).stdout.trim();
  const actual = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const [objectId, refName, ...rest] = line.split(' ');
    if (
      rest.length > 0 ||
      !GIT_SHA1.test(objectId ?? '') ||
      !refName ||
      actual.has(refName)
    )
      throw new Error('Worker source bundle exposes invalid or duplicate refs');
    actual.set(refName, objectId);
  }
  const expected = new Map([
    ['HEAD', sourceCommit],
    ...releaseTags.map(({ objectId, refName }) => [refName, objectId]),
  ]);
  if (
    actual.size !== expected.size ||
    [...expected].some(
      ([refName, objectId]) => actual.get(refName) !== objectId
    )
  )
    throw new Error(
      'Worker source bundle must expose exactly SOURCE_COMMIT HEAD and the sealed release tags'
    );
}

function createAndVerifyBundle({
  bundle,
  source,
  sourceCommit,
  sourceTree,
  releaseTags,
  temporaryRoot,
  environment,
}) {
  const seed = join(temporaryRoot, 'seed');
  const verification = join(temporaryRoot, 'verification');
  initializeRepository(seed, environment);
  runGit({
    args: [
      '-c',
      'protocol.file.allow=always',
      'fetch',
      '--quiet',
      '--depth=1',
      '--no-tags',
      '--no-recurse-submodules',
      pathToFileURL(source).href,
      sourceCommit,
      ...releaseTags.map(({ refName }) => `+${refName}:${refName}`),
    ],
    cwd: seed,
    environment,
    label: 'fetch the exact source tip',
  });
  runGit({
    args: ['checkout', '--quiet', '--detach', sourceCommit],
    cwd: seed,
    environment,
    label: 'check out the exact source tip',
  });
  verifyRepository({
    path: seed,
    sourceCommit,
    sourceTree,
    environment,
    label: 'seed',
  });
  assertReleaseTagsMatch(
    inspectReleaseTags(seed, environment),
    releaseTags,
    'seed'
  );
  runGit({
    args: [
      'repack',
      '-a',
      '-d',
      '-f',
      '-F',
      '--threads=1',
      '--no-write-bitmap-index',
    ],
    cwd: seed,
    environment,
    label: 'normalize the shallow source objects deterministically',
  });
  runGit({
    args: [
      '-c',
      'pack.threads=1',
      '-c',
      'pack.useBitmaps=false',
      'bundle',
      'create',
      bundle,
      'HEAD',
      ...releaseTags.map(({ refName }) => refName),
    ],
    cwd: seed,
    environment,
    label: 'create the candidate-and-release-tags bundle',
  });
  runGit({
    args: ['bundle', 'verify', bundle],
    cwd: seed,
    environment,
    label: 'verify the created bundle',
  });
  assertExactBundleHeads({
    repository: seed,
    bundle,
    sourceCommit,
    releaseTags,
    environment,
  });

  initializeRepository(verification, environment);
  runGit({
    args: ['bundle', 'verify', bundle],
    cwd: verification,
    environment,
    label: 'verify the bundle in an independent repository',
  });
  assertExactBundleHeads({
    repository: verification,
    bundle,
    sourceCommit,
    releaseTags,
    environment,
  });
  runGit({
    args: ['bundle', 'unbundle', bundle],
    cwd: verification,
    environment,
    label: 'import the bundle independently',
  });
  runGit({
    args: ['cat-file', '-e', `${sourceCommit}^{commit}`],
    cwd: verification,
    environment,
    label: 'verify the imported source commit',
  });
  runGit({
    args: ['update-ref', '--stdin'],
    cwd: verification,
    environment,
    input: releaseTags
      .map(({ objectId, refName }) => `update ${refName} ${objectId}\n`)
      .join(''),
    label: 'restore the imported release tag refs',
  });
  writeFileSync(
    join(verification, '.git', 'shallow'),
    `${[sourceCommit, ...releaseTags.map(({ commitId }) => commitId)]
      .sort()
      .filter(
        (value, index, values) => index === 0 || value !== values[index - 1]
      )
      .join('\n')}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    }
  );
  runGit({
    args: ['update-ref', 'refs/heads/candidate', sourceCommit],
    cwd: verification,
    environment,
    label: 'bind the imported candidate ref',
  });
  runGit({
    args: ['checkout', '--quiet', '--detach', sourceCommit],
    cwd: verification,
    environment,
    label: 'check out the imported source tip',
  });
  verifyRepository({
    path: verification,
    sourceCommit,
    sourceTree,
    environment,
    label: 'imported',
  });
  assertReleaseTagsMatch(
    inspectReleaseTags(verification, environment),
    releaseTags,
    'imported'
  );
  for (const { commitId, refName } of releaseTags) {
    if (
      gitText({
        args: ['rev-list', '--count', refName],
        cwd: verification,
        environment,
        label: `count imported release tag ${refName}`,
      }) !== '1' ||
      gitText({
        args: ['rev-parse', '--verify', `${refName}^{commit}`],
        cwd: verification,
        environment,
        label: `verify imported release tag ${refName}`,
      }) !== commitId
    )
      throw new Error(
        `Worker source bundle imported release tag is not shallow and exact: ${refName}`
      );
  }
  if (
    gitText({
      args: ['remote'],
      cwd: verification,
      environment,
      label: 'inspect imported remotes',
    })
  )
    throw new Error('Worker source bundle import must contain no remotes');
  const fsck = runGit({
    args: ['fsck', '--full', '--unreachable', '--no-reflogs'],
    cwd: verification,
    environment,
    label: 'audit imported objects',
  });
  if (fsck.stdout.trim())
    throw new Error('Worker source bundle import contains unreachable objects');
}

function sourceStillMatches({
  source,
  sourceCommit,
  sourceTree,
  releaseTags,
  releaseTagsSha256,
  environment,
}) {
  const current = inspectSourceRoot(source, environment);
  if (
    current.sourceCommit !== sourceCommit ||
    current.sourceTree !== sourceTree ||
    current.releaseTagsSha256 !== releaseTagsSha256
  )
    throw new Error('Worker source changed while its bundle was created');
  assertReleaseTagsMatch(current.releaseTags, releaseTags, 'source');
}

export function createWorkerSourceBundle({
  sourceRoot,
  outputPath,
  environment = process.env,
}) {
  const gitEnvironment = safeGitEnvironment(environment);
  const sourceIdentity = inspectSourceRoot(sourceRoot, gitEnvironment);
  const output = inspectOutputPath(outputPath, sourceIdentity.source);
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), 'seerrng-worker-source-bundle-')
  );
  const temporaryBundle = join(temporaryRoot, 'source.bundle');
  let outputCreated = false;
  try {
    createAndVerifyBundle({
      bundle: temporaryBundle,
      ...sourceIdentity,
      temporaryRoot,
      environment: gitEnvironment,
    });
    sourceStillMatches({
      ...sourceIdentity,
      environment: gitEnvironment,
    });
    const bundleSha256 = sha256(temporaryBundle);
    const bundleBytes = statSync(temporaryBundle).size;
    assertUnused(output);
    copyFileSync(temporaryBundle, output, constants.COPYFILE_EXCL);
    outputCreated = true;
    chmodSync(output, 0o600);
    if (
      statSync(output).size !== bundleBytes ||
      sha256(output) !== bundleSha256
    )
      throw new Error('Worker source bundle output verification failed');
    return Object.freeze({
      schema: 'seerrng-worker-source-bundle/v2',
      sourceCommit: sourceIdentity.sourceCommit,
      sourceTree: sourceIdentity.sourceTree,
      releaseTagCount: sourceIdentity.releaseTags.length,
      releaseTagsSha256: sourceIdentity.releaseTagsSha256,
      bundleSha256,
      bundleBytes,
      outputPath: output,
    });
  } catch (error) {
    if (outputCreated) {
      try {
        unlinkSync(output);
      } catch {
        // Preserve the original failure; the caller still receives a failure.
      }
    }
    throw error;
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true, maxRetries: 3 });
  }
}

function parseArguments(args) {
  if (
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== 'string')
  )
    throw new Error('Worker source bundle arguments must be strings');
  const parsed = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!['--source-root', '--output'].includes(option) || value === undefined)
      throw new Error(
        'Usage: create-worker-source-bundle --source-root ABS --output ABS'
      );
    if (parsed[option] !== undefined)
      throw new Error(`Worker source bundle repeats option ${option}`);
    parsed[option] = value;
  }
  if (args.length !== 4 || !parsed['--source-root'] || !parsed['--output'])
    throw new Error(
      'Usage: create-worker-source-bundle --source-root ABS --output ABS'
    );
  return {
    sourceRoot: parsed['--source-root'],
    outputPath: parsed['--output'],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const provenance = createWorkerSourceBundle(
      parseArguments(process.argv.slice(2))
    );
    process.stdout.write(`${JSON.stringify(provenance)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Worker source bundle failed'}\n`
    );
    process.exitCode = 1;
  }
}
