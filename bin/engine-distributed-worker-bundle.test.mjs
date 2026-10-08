import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { createWorkerSourceBundle } from '../tools/validation-engine/container/create-worker-source-bundle.mjs';

const producerPath = fileURLToPath(
  new URL(
    '../tools/validation-engine/container/create-worker-source-bundle.mjs',
    import.meta.url
  )
);

test('producer normalizes and packs Git objects deterministically', () => {
  const producer = readFileSync(producerPath, 'utf8');
  assert.match(
    producer,
    /args: \[\s+'repack',\s+'-a',\s+'-d',\s+'-f',\s+'-F',\s+'--threads=1',\s+'--no-write-bitmap-index'/u
  );
  assert.match(
    producer,
    /args: \[\s+'-c',\s+'pack\.threads=1',\s+'-c',\s+'pack\.useBitmaps=false',\s+'bundle',\s+'create'/u
  );
});

function gitEnvironment(extra = {}) {
  return {
    ...process.env,
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnvironment(),
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0)
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr ?? '').trim()}`
    );
  return result;
}

function createFixture({ objectFormat = 'sha1', withReleaseTags = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-worker-bundle-test-'));
  const source = join(root, 'source');
  const output = join(root, 'output');
  mkdirSync(source, { mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  git(source, [
    'init',
    '--quiet',
    '--template=',
    `--object-format=${objectFormat}`,
  ]);
  git(source, ['config', 'user.name', 'Worker Bundle Test']);
  git(source, ['config', 'user.email', 'worker-bundle@example.invalid']);
  writeFileSync(join(source, 'candidate.txt'), 'base\n');
  git(source, ['add', '--', 'candidate.txt']);
  git(source, ['commit', '--quiet', '-m', 'base']);
  const baseCommit = git(source, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]).stdout.trim();
  writeFileSync(join(source, 'candidate.txt'), 'release\n');
  writeFileSync(join(source, 'release.txt'), 'tagged release\n');
  git(source, ['add', '--', 'candidate.txt', 'release.txt']);
  git(source, ['commit', '--quiet', '-m', 'release']);
  const releaseCommit = git(source, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]).stdout.trim();
  const releaseTagNames = withReleaseTags
    ? ['v3.1.0', 'v3.1.1', 'v3.preview']
    : [];
  if (withReleaseTags) {
    git(source, ['tag', 'v3.1.0', releaseCommit]);
    git(source, [
      'tag',
      '--annotate',
      '--message',
      'annotated release',
      'v3.1.1',
      releaseCommit,
    ]);
    git(source, ['tag', 'v3.preview', releaseCommit]);
    git(source, ['tag', 'unrelated', releaseCommit]);
  }
  writeFileSync(join(source, 'candidate.txt'), 'candidate\n');
  writeFileSync(join(source, 'candidate-only.txt'), 'tip only\n');
  writeFileSync(
    join(source, 'compression-fixture.txt'),
    'deterministic bundle compression fixture\n'.repeat(4096)
  );
  git(source, [
    'add',
    '--',
    'candidate.txt',
    'candidate-only.txt',
    'compression-fixture.txt',
  ]);
  git(source, ['commit', '--quiet', '-m', 'candidate']);
  const sourceCommit = git(source, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}',
  ]).stdout.trim();
  const sourceTree = git(source, [
    'rev-parse',
    '--verify',
    'HEAD^{tree}',
  ]).stdout.trim();
  const releaseTags = releaseTagNames.map((name) => ({
    commitId: git(source, [
      'rev-parse',
      '--verify',
      `${name}^{commit}`,
    ]).stdout.trim(),
    objectId: git(source, ['rev-parse', '--verify', name]).stdout.trim(),
    refName: `refs/tags/${name}`,
  }));
  return {
    root,
    source,
    output,
    baseCommit,
    releaseCommit,
    releaseTags,
    sourceCommit,
    sourceTree,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function inspectBundle({
  bundle,
  root,
  sourceCommit,
  sourceTree,
  baseCommit,
  releaseCommit,
  releaseTags,
}) {
  const inspect = join(root, 'inspect');
  mkdirSync(inspect, { mode: 0o700 });
  git(inspect, ['init', '--quiet', '--template=']);
  const bundleHeads = new Map(
    git(inspect, ['bundle', 'list-heads', bundle])
      .stdout.trim()
      .split(/\r?\n/u)
      .map((line) => {
        const [objectId, refName] = line.split(' ');
        return [refName, objectId];
      })
  );
  assert.deepEqual(
    bundleHeads,
    new Map([
      ['HEAD', sourceCommit],
      ...releaseTags.map(({ objectId, refName }) => [refName, objectId]),
    ])
  );
  git(inspect, ['bundle', 'verify', bundle]);
  git(inspect, ['bundle', 'unbundle', bundle]);
  for (const { objectId, refName } of releaseTags)
    git(inspect, ['update-ref', refName, objectId]);
  writeFileSync(
    join(inspect, '.git', 'shallow'),
    `${[sourceCommit, ...releaseTags.map(({ commitId }) => commitId)]
      .sort()
      .filter(
        (value, index, values) => index === 0 || value !== values[index - 1]
      )
      .join('\n')}\n`,
    { flag: 'wx' }
  );
  git(inspect, ['update-ref', 'refs/heads/candidate', sourceCommit]);
  git(inspect, ['checkout', '--quiet', '--detach', sourceCommit]);
  assert.equal(
    git(inspect, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim(),
    sourceCommit
  );
  assert.equal(
    git(inspect, ['rev-parse', '--verify', 'HEAD^{tree}']).stdout.trim(),
    sourceTree
  );
  assert.equal(
    git(inspect, ['rev-list', '--count', 'HEAD']).stdout.trim(),
    '1'
  );
  assert.equal(
    git(inspect, ['cat-file', '-e', `${releaseCommit}^{commit}`], {
      allowFailure: true,
    }).status,
    0
  );
  assert.notEqual(
    git(inspect, ['cat-file', '-e', `${baseCommit}^{commit}`], {
      allowFailure: true,
    }).status,
    0
  );
  assert.deepEqual(
    git(inspect, ['tag', '--list']).stdout.trim().split(/\r?\n/u),
    releaseTags.map(({ refName }) => refName.slice('refs/tags/'.length))
  );
  for (const { commitId, objectId, refName } of releaseTags) {
    assert.equal(
      git(inspect, ['rev-parse', '--verify', refName]).stdout.trim(),
      objectId
    );
    assert.equal(
      git(inspect, [
        'rev-parse',
        '--verify',
        `${refName}^{commit}`,
      ]).stdout.trim(),
      commitId
    );
    assert.equal(
      git(inspect, ['rev-list', '--count', refName]).stdout.trim(),
      '1'
    );
  }
  assert.equal(
    git(inspect, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ]).stdout.trim(),
    ''
  );
  const fsck = git(inspect, [
    'fsck',
    '--full',
    '--unreachable',
    '--no-reflogs',
  ]);
  assert.equal(fsck.stdout.trim(), '');
}

test('producer emits a deterministic shallow candidate with exact release tags', () => {
  const fixture = createFixture();
  try {
    const hostileHomeOne = join(fixture.root, 'hostile-home-one');
    const hostileHomeTwo = join(fixture.root, 'hostile-home-two');
    const emptyXdgOne = join(fixture.root, 'empty-xdg-one');
    const emptyXdgTwo = join(fixture.root, 'empty-xdg-two');
    mkdirSync(hostileHomeOne, { mode: 0o700 });
    mkdirSync(hostileHomeTwo, { mode: 0o700 });
    mkdirSync(emptyXdgOne, { mode: 0o700 });
    mkdirSync(emptyXdgTwo, { mode: 0o700 });
    writeFileSync(
      join(hostileHomeOne, '.gitconfig'),
      '[pack]\n\tcompression = 1\n\tthreads = 8\n'
    );
    writeFileSync(
      join(hostileHomeTwo, '.gitconfig'),
      '[pack]\n\tcompression = 9\n\tthreads = 2\n'
    );
    const firstBundle = join(fixture.output, 'first.bundle');
    const command = spawnSync(
      process.execPath,
      [producerPath, '--source-root', fixture.source, '--output', firstBundle],
      {
        encoding: 'utf8',
        env: gitEnvironment({
          GIT_DIR: join(fixture.root, 'hostile-git-dir'),
          GIT_WORK_TREE: join(fixture.root, 'hostile-work-tree'),
          HOME: hostileHomeOne,
          USERPROFILE: hostileHomeOne,
          XDG_CONFIG_HOME: emptyXdgOne,
        }),
        shell: false,
        windowsHide: true,
      }
    );
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stderr, '');
    const provenance = JSON.parse(command.stdout);
    assert.deepEqual(Object.keys(provenance), [
      'schema',
      'sourceCommit',
      'sourceTree',
      'releaseTagCount',
      'releaseTagsSha256',
      'bundleSha256',
      'bundleBytes',
      'outputPath',
    ]);
    assert.equal(provenance.schema, 'seerrng-worker-source-bundle/v2');
    assert.equal(provenance.sourceCommit, fixture.sourceCommit);
    assert.equal(provenance.sourceTree, fixture.sourceTree);
    assert.equal(provenance.releaseTagCount, fixture.releaseTags.length);
    assert.match(provenance.releaseTagsSha256, /^[a-f0-9]{64}$/);
    assert.match(provenance.bundleSha256, /^[a-f0-9]{64}$/);
    assert.equal(provenance.bundleBytes, statSync(firstBundle).size);
    assert.equal(provenance.outputPath, firstBundle);
    assert.equal(provenance.bundleBytes > 0, true);
    if (process.platform !== 'win32')
      assert.equal(statSync(firstBundle).mode & 0o777, 0o600);

    const secondBundle = join(fixture.output, 'second.bundle');
    const repeated = createWorkerSourceBundle({
      sourceRoot: fixture.source,
      outputPath: secondBundle,
      environment: gitEnvironment({
        HOME: hostileHomeTwo,
        USERPROFILE: hostileHomeTwo,
        XDG_CONFIG_HOME: emptyXdgTwo,
      }),
    });
    assert.equal(repeated.bundleSha256, provenance.bundleSha256);
    assert.equal(repeated.bundleBytes, provenance.bundleBytes);
    assert.equal(repeated.releaseTagsSha256, provenance.releaseTagsSha256);
    inspectBundle({ bundle: firstBundle, ...fixture });
  } finally {
    fixture.cleanup();
  }
});

test('producer rejects a dirty source worktree', () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.source, 'untracked.txt'), 'not admitted\n');
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: join(fixture.output, 'dirty.bundle'),
        }),
      /requires a clean source worktree/
    );
  } finally {
    fixture.cleanup();
  }
});

test('producer rejects a source without SeerrNG v3 release tags', () => {
  const fixture = createFixture({ withReleaseTags: false });
  try {
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: join(fixture.output, 'no-tags.bundle'),
        }),
      /requires at least one SeerrNG v3 release tag/
    );
  } finally {
    fixture.cleanup();
  }
});

test('producer rejects an existing output without changing it', () => {
  const fixture = createFixture();
  try {
    const existing = join(fixture.output, 'existing.bundle');
    writeFileSync(existing, 'preserve me\n');
    chmodSync(existing, 0o644);
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: existing,
        }),
      /must not already exist/
    );
    assert.equal(readFileSync(existing, 'utf8'), 'preserve me\n');
  } finally {
    fixture.cleanup();
  }
});

test('producer rejects a source using a non-SHA-1 object format', () => {
  const fixture = createFixture({ objectFormat: 'sha256' });
  try {
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: join(fixture.output, 'sha256.bundle'),
        }),
      /requires the Git SHA-1 object format/
    );
  } finally {
    fixture.cleanup();
  }
});

test('producer rejects relative, non-top-level, missing-parent, and in-source paths', () => {
  const fixture = createFixture();
  try {
    const nested = join(fixture.source, 'nested');
    mkdirSync(nested);
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: relative(process.cwd(), fixture.source),
          outputPath: join(fixture.output, 'relative-source.bundle'),
        }),
      /source root must be absolute/
    );
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: 'relative.bundle',
        }),
      /output path must be absolute/
    );
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: nested,
          outputPath: join(fixture.output, 'nested-root.bundle'),
        }),
      /exact Git top level/
    );
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: join(fixture.source, 'inside.bundle'),
        }),
      /outside the source worktree/
    );
    assert.throws(
      () =>
        createWorkerSourceBundle({
          sourceRoot: fixture.source,
          outputPath: join(fixture.output, 'missing-parent', 'source.bundle'),
        }),
      /output parent must already exist/
    );
  } finally {
    fixture.cleanup();
  }
});
