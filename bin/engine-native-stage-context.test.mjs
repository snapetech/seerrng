// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import {
  MODE3_DEPENDENCY_MOUNTPOINT_SCHEMA,
  createNativeRepositoryCheckExecutor,
  createNativeStageContext,
  createOwnedDocsLinkSnapshot,
  createOwnedSourceSnapshot,
  disposeSourceSnapshot,
  evaluatorHeadroom,
  findNativeExecutable,
  materializeNativeReceipt,
  nativeEnvironment,
  nativeInputFileIdentity,
  nativeNetworkBoundary,
  prepareJellyfinTemporaryDirectory,
  prepareMode3DependencyMountpoint,
  readNativeStageArtifact,
  readonlyMountProof,
  repositoryIsolationReadiness,
  repositoryNativeCases,
  validateNativeBoundaryProof,
  verifyMode3DependencyMountpoint,
  verifyNativeInputFreshness,
  verifySourceSnapshot,
} from '../tools/validation-engine/runtime/native-stage-context.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function fixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'native-context-test-'));
  const root = path.join(parent, 'repository');
  mkdirSync(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Source fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(
    root,
    'config',
    'remote.origin.url',
    'https://github.com/Example/seerr.git'
  );
  git(root, 'config', 'credential.helper', 'never-copy-this-private-setting');
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(path.join(root, '.gitignore'), 'private-provider.json\n');
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'Fixture only');
  git(root, 'tag', 'fixture-v1');
  return { root, parent };
}

function repositoryCheckFixture(t) {
  const { parent } = fixture(t);
  const root = path.join(parent, 'sealed-plan-root');
  const scratchRoot = path.join(parent, 'sealed-check-scratch');
  mkdirSync(root);
  mkdirSync(scratchRoot);
  const plan = {
    root,
    platform: process.platform,
    testsOnly: false,
    inventory: [],
    steps: [
      {
        name: 'Formatting',
        command: process.execPath,
        args: ['bin/run-prettier.mjs', '--check'],
        kind: 'check',
      },
      {
        name: 'Node JavaScript 1/1',
        command: process.execPath,
        args: ['--test', 'server/test/example.test.mjs'],
        kind: 'node-js',
        files: ['server/test/example.test.mjs'],
      },
      {
        name: 'Lint',
        command: process.execPath,
        args: ['node_modules/eslint/bin/eslint.js', './server/**/*.ts'],
        kind: 'check',
      },
    ],
  };
  return { parent, plan, root, scratchRoot };
}

function completeCheckReceipt(scratchRoot, id, { status = 'passed' } = {}) {
  const stdout = Buffer.from('complete check stdout\n');
  const stderr = Buffer.from('');
  const stdoutLog = path.join(scratchRoot, `${id}.stdout.log`);
  const stderrLog = path.join(scratchRoot, `${id}.stderr.log`);
  writeFileSync(stdoutLog, stdout);
  writeFileSync(stderrLog, stderr);
  return {
    id,
    status,
    exitCode: status === 'passed' ? 0 : 1,
    signal: null,
    aborted: false,
    timedOut: false,
    stopped: false,
    spawnError: null,
    wallMs: 1,
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    stdoutLog,
    stderrLog,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stdoutSha256: sha(stdout),
    stderrSha256: sha(stderr),
    stdoutTruncated: false,
    stderrTruncated: false,
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
  };
}

test('invalid worker overrides fail before allocating a disposable source copy', async (t) => {
  const { root, parent } = fixture(t);
  const before = readdirSync(parent).sort();
  for (const workerOverride of [0, -1, 1.5, 257, '1', NaN]) {
    await assert.rejects(
      createNativeStageContext(root, {
        runId: 'native-context-focused-run',
        scratchParent: parent,
        inherited: {},
        workerOverride,
      }),
      /Worker override/
    );
    assert.deepEqual(readdirSync(parent).sort(), before);
  }
});

test('public run and operator identities fail before allocating a source copy', async (t) => {
  const { root, parent } = fixture(t);
  const before = readdirSync(parent).sort();
  await assert.rejects(
    createNativeStageContext(root, {
      scratchParent: parent,
      inherited: {},
    }),
    /exact public run ID/u
  );
  await assert.rejects(
    createNativeStageContext(root, {
      runId: 'native-context-focused-run',
      operatorGithubLogin: 'not an identity',
      scratchParent: parent,
      inherited: {},
    }),
    /operator GitHub login is invalid/u
  );
  assert.deepEqual(readdirSync(parent).sort(), before);
});

test('native repository check runs one exact sealed check with authentic receipt and source guards', async (t) => {
  const { plan, root, scratchRoot } = repositoryCheckFixture(t);
  const events = [];
  const controller = new AbortController();
  let configDirectory;
  let actualCommand;
  const receipt = completeCheckReceipt(scratchRoot, 'Formatting');
  const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
    scratchRoot,
    inherited: { NODE_OPTIONS: '--unsealed', PATH: process.env.PATH },
    stdout: { write() {} },
    verifySource: async () => events.push('verify'),
    nativeRun: async (command, options) => {
      events.push('run');
      actualCommand = command;
      configDirectory = command.env.CONFIG_DIRECTORY;
      assert.equal(options.signal, controller.signal);
      assert.equal(existsSync(configDirectory), true);
      return receipt;
    },
  });

  const returned = await executeRepositoryCheck(
    structuredClone(plan.steps[0]),
    {
      index: 0,
      signal: controller.signal,
    }
  );

  assert.equal(returned, receipt);
  assert.deepEqual(events, ['verify', 'run', 'verify']);
  assert.deepEqual(
    {
      name: actualCommand.name,
      command: actualCommand.command,
      args: actualCommand.args,
      kind: actualCommand.kind,
    },
    plan.steps[0]
  );
  assert.equal(actualCommand.cwd, root);
  assert.equal(actualCommand.env.NODE_ENV, 'test');
  assert.equal(actualCommand.env.ALLOW_NETWORK, 'false');
  assert.equal(actualCommand.env.SEERR_TEST_FAIL_ON_NETWORK, 'true');
  assert.equal(actualCommand.env.NODE_OPTIONS, undefined);
  assert.equal(existsSync(configDirectory), false);
});

test('native repository check rejects test lanes and modified commands before source checks or spawn', async (t) => {
  const { plan, scratchRoot } = repositoryCheckFixture(t);
  let runCalls = 0;
  let verifyCalls = 0;
  const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
    scratchRoot,
    stdout: { write() {} },
    verifySource: async () => {
      verifyCalls += 1;
    },
    nativeRun: async () => {
      runCalls += 1;
      return completeCheckReceipt(scratchRoot, 'Formatting');
    },
  });
  const changedCommand = structuredClone(plan.steps[0]);
  changedCommand.command = 'unsealed-command';
  const changedArgs = structuredClone(plan.steps[0]);
  changedArgs.args.push('--write');
  const relabeledLane = structuredClone(plan.steps[1]);
  relabeledLane.kind = 'check';

  for (const [step, index] of [
    [structuredClone(plan.steps[1]), 1],
    [changedCommand, 0],
    [changedArgs, 0],
    [structuredClone(plan.steps[0]), 2],
    [relabeledLane, 1],
  ])
    await assert.rejects(
      executeRepositoryCheck(step, { index }),
      /differs from its sealed plan step/
    );

  assert.equal(verifyCalls, 0);
  assert.equal(runCalls, 0);
});

test('native repository check fails closed across source, signal, command, and receipt boundaries', async (t) => {
  const { plan, scratchRoot } = repositoryCheckFixture(t);
  const check = structuredClone(plan.steps[0]);

  await t.test('pre-source failure prevents spawn', async () => {
    let runCalls = 0;
    const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
      scratchRoot,
      stdout: { write() {} },
      verifySource: async () => {
        throw new Error('pre-source changed');
      },
      nativeRun: async () => {
        runCalls += 1;
      },
    });
    await assert.rejects(
      executeRepositoryCheck(check, { index: 0 }),
      /pre-source changed/
    );
    assert.equal(runCalls, 0);
  });

  await t.test(
    'post-source failure overrides apparent command success',
    async () => {
      let verifyCalls = 0;
      const receipt = completeCheckReceipt(scratchRoot, 'Formatting');
      const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
        scratchRoot,
        stdout: { write() {} },
        verifySource: async () => {
          verifyCalls += 1;
          if (verifyCalls === 2) throw new Error('post-source changed');
        },
        nativeRun: async () => receipt,
      });
      await assert.rejects(
        executeRepositoryCheck(check, { index: 0 }),
        /post-source changed/
      );
      assert.equal(verifyCalls, 2);
    }
  );

  await t.test(
    'command failure retains its authentic receipt and post-guard',
    async () => {
      let verifyCalls = 0;
      const receipt = completeCheckReceipt(scratchRoot, 'Formatting', {
        status: 'failed',
      });
      const failure = Object.assign(new Error('native check failed'), {
        receipt,
      });
      const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
        scratchRoot,
        stdout: { write() {} },
        verifySource: async () => {
          verifyCalls += 1;
        },
        nativeRun: async () => {
          throw failure;
        },
      });
      await assert.rejects(
        executeRepositoryCheck(check, { index: 0 }),
        (error) => error === failure && error.receipt === receipt
      );
      assert.equal(verifyCalls, 2);
    }
  );

  await t.test(
    'pre-aborted signal prevents source checks and spawn',
    async () => {
      let verifyCalls = 0;
      let runCalls = 0;
      const controller = new AbortController();
      controller.abort();
      const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
        scratchRoot,
        stdout: { write() {} },
        verifySource: async () => {
          verifyCalls += 1;
        },
        nativeRun: async () => {
          runCalls += 1;
        },
      });
      await assert.rejects(
        executeRepositoryCheck(check, {
          index: 0,
          signal: controller.signal,
        }),
        { name: 'AbortError' }
      );
      assert.equal(verifyCalls, 0);
      assert.equal(runCalls, 0);
    }
  );

  await t.test(
    'receipt identity tampering is rejected after one spawn',
    async () => {
      let runCalls = 0;
      let verifyCalls = 0;
      const executeRepositoryCheck = createNativeRepositoryCheckExecutor(plan, {
        scratchRoot,
        stdout: { write() {} },
        verifySource: async () => {
          verifyCalls += 1;
        },
        nativeRun: async () => {
          runCalls += 1;
          return completeCheckReceipt(scratchRoot, 'another-command');
        },
      });
      await assert.rejects(
        executeRepositoryCheck(check, { index: 0 }),
        /receipt identity mismatch/
      );
      assert.equal(runCalls, 1);
      assert.equal(verifyCalls, 2);
    }
  );
});

test('snapshot seals actual working bytes/modes, includes unignored files and omits credentials', (t) => {
  const { root, parent } = fixture(t);
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 2;\n');
  writeFileSync(path.join(root, 'new.mjs'), 'export const added = true;\n');
  writeFileSync(
    path.join(root, 'private-provider.json'),
    '{"token":"never-copy"}'
  );
  if (process.platform !== 'win32')
    chmodSync(path.join(root, 'new.mjs'), 0o755);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  assert.equal(
    snapshot.manifest.files.find(({ path: file }) => file === 'new.mjs')?.mode,
    process.platform === 'win32' ? '100644' : '100755'
  );
  assert.notEqual(
    snapshot.candidate.tree,
    git(root, 'rev-parse', 'HEAD^{tree}')
  );
  assert.equal(snapshot.candidate.commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(
    readFileSync(path.join(snapshot.root, 'source.mjs'), 'utf8'),
    'export const value = 2;\n'
  );
  assert.equal(snapshot.manifest.fileCount, 4);
  assert.equal(
    existsSync(path.join(snapshot.root, 'private-provider.json')),
    false
  );
  const config = readFileSync(path.join(snapshot.root, '.git/config'), 'utf8');
  assert.doesNotMatch(
    config,
    /credential|user\.name|Source fixture|fixture@example/
  );
  assert.equal(git(snapshot.root, 'write-tree'), snapshot.candidate.tree);
  assert.equal(git(snapshot.root, 'tag', '--list'), 'fixture-v1');
  assert.equal(verifySourceSnapshot(snapshot), true);
  disposeSourceSnapshot(snapshot);
  assert.equal(existsSync(snapshot.scratchRoot), false);
});

test('snapshot preserves a clean tracked executable mode', (t) => {
  const { root, parent } = fixture(t);
  git(root, 'update-index', '--chmod=+x', 'source.mjs');
  if (process.platform !== 'win32')
    chmodSync(path.join(root, 'source.mjs'), 0o755);
  git(root, 'commit', '--quiet', '-m', 'Track executable mode');
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  assert.equal(
    snapshot.manifest.files.find(({ path: file }) => file === 'source.mjs')
      ?.mode,
    '100755'
  );
  assert.equal(snapshot.candidate.tree, git(root, 'rev-parse', 'HEAD^{tree}'));
  assert.equal(git(snapshot.root, 'write-tree'), snapshot.candidate.tree);
  assert.equal(verifySourceSnapshot(snapshot), true);
});

test(
  'Windows snapshot verification rejects tracked index-mode changes',
  { skip: process.platform !== 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    git(root, 'update-index', '--chmod=+x', 'source.mjs');
    git(root, 'commit', '--quiet', '-m', 'Track executable mode');
    const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
    assert.equal(verifySourceSnapshot(snapshot), true);

    git(root, 'update-index', '--chmod=-x', 'source.mjs');
    assert.throws(
      () => verifySourceSnapshot(snapshot),
      /Frozen source changed: source\.mjs/u
    );

    git(root, 'update-index', '--chmod=+x', 'source.mjs');
    git(snapshot.root, 'update-index', '--chmod=-x', 'source.mjs');
    assert.throws(
      () => verifySourceSnapshot(snapshot),
      /Frozen source changed: source\.mjs/u
    );
  }
);

test(
  'POSIX snapshot verification follows working-tree executable modes',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    git(root, 'update-index', '--chmod=+x', 'source.mjs');
    chmodSync(path.join(root, 'source.mjs'), 0o755);
    git(root, 'commit', '--quiet', '-m', 'Track executable mode');
    const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
    assert.equal(verifySourceSnapshot(snapshot), true);

    chmodSync(path.join(root, 'source.mjs'), 0o644);
    assert.throws(
      () => verifySourceSnapshot(snapshot),
      /Frozen source changed: source\.mjs/u
    );

    const changed = createOwnedSourceSnapshot(root, { scratchParent: parent });
    assert.equal(
      changed.manifest.files.find(({ path: file }) => file === 'source.mjs')
        ?.mode,
      '100644'
    );
  }
);

test('outer Mode 3 adds only one empty real dependency mountpoint without changing source identity', (t) => {
  const { root, parent } = fixture(t);
  const first = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const originalCandidate = structuredClone(first.candidate);
  const originalManifest = readFileSync(
    path.join(first.scratchRoot, 'source-manifest.json')
  );
  assert.equal(existsSync(path.join(first.root, 'node_modules')), false);

  const proof = prepareMode3DependencyMountpoint(first);
  assert.equal(proof.schema, MODE3_DEPENDENCY_MOUNTPOINT_SCHEMA);
  assert.equal(proof.sourceDirectory, first.root);
  assert.equal(proof.mountpointPath, path.join(first.root, 'node_modules'));
  assert.equal(proof.onlyAddedPath, 'node_modules');
  assert.equal(proof.mountpointType, 'directory');
  assert.equal(proof.mountpointEmptyBeforeMount, true);
  assert.equal(proof.candidateCommit, originalCandidate.commit);
  assert.equal(proof.candidateTree, originalCandidate.tree);
  assert.equal(proof.candidateSourceSha256, originalCandidate.sourceSha256);
  assert.equal(proof.sourceManifestSha256, originalCandidate.sourceSha256);
  assert.equal(proof.inheritedFileCount, first.manifest.fileCount);
  assert.match(proof.inheritedTopologySha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(readdirSync(proof.mountpointPath), []);
  assert.equal(verifyMode3DependencyMountpoint(first, proof), true);
  assert.deepEqual(first.candidate, originalCandidate);
  assert.deepEqual(
    readFileSync(path.join(first.scratchRoot, 'source-manifest.json')),
    originalManifest
  );
  assert.equal(git(first.root, 'write-tree'), originalCandidate.tree);

  const second = createOwnedSourceSnapshot(root, { scratchParent: parent });
  assert.equal(existsSync(path.join(second.root, 'node_modules')), false);
  const secondProof = prepareMode3DependencyMountpoint(second);
  assert.equal(
    secondProof.inheritedTopologySha256,
    proof.inheritedTopologySha256,
    'Topology identity must not depend on the disposable snapshot path'
  );
});

test('outer Mode 3 rejects a pre-existing dependency file, link, or nonempty directory', async (t) => {
  for (const kind of ['file', 'link', 'nonempty-directory'])
    await t.test(kind, (t) => {
      const { root, parent } = fixture(t);
      const snapshot = createOwnedSourceSnapshot(root, {
        scratchParent: parent,
      });
      const mountpoint = path.join(snapshot.root, 'node_modules');
      if (kind === 'file') writeFileSync(mountpoint, 'not a directory');
      else if (kind === 'nonempty-directory') {
        mkdirSync(mountpoint);
        writeFileSync(path.join(mountpoint, 'payload'), 'not empty');
      } else {
        const outside = path.join(parent, 'outside-dependencies');
        mkdirSync(outside);
        symlinkSync(
          outside,
          mountpoint,
          process.platform === 'win32' ? 'junction' : 'dir'
        );
      }
      assert.throws(
        () => prepareMode3DependencyMountpoint(snapshot),
        /must not exist before preparation/u
      );
    });
});

test('outer Mode 3 dependency mountpoint verification fails closed on post-preparation tampering', (t) => {
  const { root, parent } = fixture(t);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const proof = prepareMode3DependencyMountpoint(snapshot);

  writeFileSync(path.join(proof.mountpointPath, 'payload'), 'unexpected');
  assert.throws(
    () => verifyMode3DependencyMountpoint(snapshot, proof),
    /mountpoint is not empty/u
  );
  rmSync(path.join(proof.mountpointPath, 'payload'));

  writeFileSync(path.join(snapshot.root, 'unexpected.txt'), 'unexpected');
  assert.throws(
    () => verifyMode3DependencyMountpoint(snapshot, proof),
    /not the only added snapshot path/u
  );
  rmSync(path.join(snapshot.root, 'unexpected.txt'));

  assert.throws(
    () =>
      verifyMode3DependencyMountpoint(snapshot, {
        ...proof,
        inheritedTopologySha256: '0'.repeat(64),
      }),
    /proof differs: inheritedTopologySha256/u
  );
});

test(
  'Windows source snapshots support long owned scratch paths',
  { skip: process.platform !== 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    const sourceDirectory = path.join(
      root,
      'src',
      ...Array.from({ length: 10 }, (_, index) => `source-${index}`)
    );
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(
      path.join(sourceDirectory, 'long-path-source.mjs'),
      'export const longPath = true;\n'
    );
    const scratchParent = path.join(
      parent,
      ...Array.from({ length: 5 }, (_, index) => `scratch-segment-${index}`)
    );
    mkdirSync(scratchParent, { recursive: true });

    const snapshot = createOwnedSourceSnapshot(root, { scratchParent });
    assert.ok(
      path.join(
        snapshot.root,
        path.relative(root, sourceDirectory),
        'long-path-source.mjs'
      ).length > 260
    );
    assert.equal(verifySourceSnapshot(snapshot), true);
    disposeSourceSnapshot(snapshot);
    assert.equal(existsSync(snapshot.scratchRoot), false);
  }
);

test('source changes and manifest changes fail the post-source guard', (t) => {
  const { root, parent } = fixture(t);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  writeFileSync(path.join(root, 'source.mjs'), 'changed while tests ran');
  assert.throws(() => verifySourceSnapshot(snapshot), /Frozen source changed/);
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 1;\n');
  writeFileSync(path.join(snapshot.scratchRoot, 'source-manifest.json'), '{}');
  assert.throws(() => verifySourceSnapshot(snapshot), /manifest changed/);
});

test('docs link checkout excludes installed vendors and other jobs generated docs without excluding source docs', (t) => {
  const { root, parent } = fixture(t);
  writeFileSync(
    path.join(root, '.gitignore'),
    'private-provider.json\nnode_modules/\n'
  );
  mkdirSync(path.join(root, 'docs'));
  mkdirSync(path.join(root, 'gen-docs/node_modules/vendor'), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, 'docs/readme.md'),
    '[original](https://example.com)\n'
  );
  writeFileSync(
    path.join(root, 'gen-docs/node_modules/vendor/readme.md'),
    '[vendor](https://vendor.invalid)\n'
  );
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const links = createOwnedDocsLinkSnapshot(snapshot);
  assert.equal(links.candidate.sourceSha256, snapshot.candidate.sourceSha256);
  assert.equal(
    existsSync(path.join(links.root, 'gen-docs/node_modules')),
    false
  );
  writeFileSync(
    path.join(snapshot.root, 'docs/readme.md'),
    'generated by another job'
  );
  assert.equal(
    readFileSync(path.join(links.root, 'docs/readme.md'), 'utf8'),
    '[original](https://example.com)\n'
  );
  assert.equal(verifySourceSnapshot(links), true);
  writeFileSync(path.join(links.root, 'docs/readme.md'), 'changed link input');
  assert.throws(() => verifySourceSnapshot(links), /Frozen source changed/);
});

test('new source paths are not silently omitted after the freeze', (t) => {
  const { root, parent } = fixture(t);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  writeFileSync(path.join(root, 'later.mjs'), 'new source');
  assert.throws(
    () => verifySourceSnapshot(snapshot),
    /untracked paths changed/
  );
});

test('derived documentation exemptions are copy-only and cannot relax authoritative input protection', (t) => {
  const { root, parent } = fixture(t);
  mkdirSync(path.join(root, 'docs/api'), { recursive: true });
  writeFileSync(path.join(root, 'docs/api/generated.mdx'), 'initial source');
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const options = { derivedOutputs: new Set(['docs-api']) };
  writeFileSync(
    path.join(snapshot.root, 'docs/api/generated.mdx'),
    'actual generated output'
  );
  assert.equal(verifySourceSnapshot(snapshot, options), true);
  assert.throws(() => verifySourceSnapshot(snapshot), /Frozen source changed/);
  writeFileSync(
    path.join(root, 'docs/api/generated.mdx'),
    'unauthorized authoritative write'
  );
  assert.throws(
    () => verifySourceSnapshot(snapshot, options),
    /Frozen source changed/
  );
});

test(
  'source symlinks and scratch nested in source are rejected before native execution',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    const outside = path.join(parent, 'outside.txt');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, path.join(root, 'escape.mjs'));
    assert.throws(
      () => createOwnedSourceSnapshot(root, { scratchParent: parent }),
      /symlink/
    );
    assert.throws(
      () => createOwnedSourceSnapshot(root, { scratchParent: root }),
      /outside authoritative source/
    );
  }
);

test(
  'metadata substitution after regular-file classification cannot copy an outside file',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    const checkedPath = path.join(root, '.git/objects/race-probe');
    const outside = path.join(parent, 'outside-owned-marker.txt');
    writeFileSync(checkedPath, 'original metadata bytes\n');
    writeFileSync(outside, 'outside-owned-marker\n');
    const originalLstat = fs.lstatSync;
    let swapped = false;
    let copiedOutside = false;
    fs.lstatSync = function (file, ...args) {
      const result = originalLstat.call(this, file, ...args);
      if (file === checkedPath && !swapped) {
        swapped = true;
        fs.unlinkSync(checkedPath);
        symlinkSync(outside, checkedPath);
      }
      return result;
    };
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => {
          const snapshot = createOwnedSourceSnapshot(root, {
            scratchParent: parent,
          });
          copiedOutside =
            readFileSync(
              path.join(snapshot.root, '.git/objects/race-probe'),
              'utf8'
            ) === 'outside-owned-marker\n';
        },
        /ELOOP|symlink|changed/,
        'A checked path must not be reopened as an outside symlink'
      );
    } finally {
      fs.lstatSync = originalLstat;
      syncBuiltinESMExports();
      t.diagnostic(
        `swapPerformed=${swapped}; outsideBytesCopied=${copiedOutside}`
      );
    }
    assert.equal(
      swapped,
      true,
      'The reproduction must reach the real metadata read'
    );
    assert.equal(copiedOutside, false);
  }
);

test('cleanup refuses roots whose exact generated ownership is not established', (t) => {
  const { root, parent } = fixture(t);
  assert.throws(
    () => disposeSourceSnapshot({ scratchRoot: root, scratchParent: parent }),
    /unsafe native scratch cleanup/
  );
  assert.equal(existsSync(root), true);
});

test('environment preserves runtime paths but strips provider credentials and workstation identity', () => {
  const env = nativeEnvironment(
    {
      PATH: '/bin',
      HOME: '/private/home',
      USERPROFILE: 'private-profile',
      GITHUB_TOKEN: 'secret',
      TMDB_API_KEY: 'secret',
      DATABASE_URL: 'private-provider',
      DOCKER_HOST: 'tcp://production:2375',
      NODE_OPTIONS: '--import=private',
      CYPRESS_LIVE_QA_EMAIL: 'personal',
      PLAYWRIGHT_BASE_URL: 'https://production.invalid',
    },
    '/owned/tool-home'
  );
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/owned/tool-home');
  assert.equal(env.USERPROFILE, '/owned/tool-home');
  for (const key of [
    'GITHUB_TOKEN',
    'TMDB_API_KEY',
    'DATABASE_URL',
    'DOCKER_HOST',
    'NODE_OPTIONS',
    'PLAYWRIGHT_BASE_URL',
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.CYPRESS_LIVE_QA_EMAIL, '');
  assert.equal(env.CONFIG_DIRECTORY, undefined);
});

test('read-only dependency proof uses the innermost actual mount, not ancestor or a flag', (t) => {
  const { root } = fixture(t);
  const normalized = root.split(path.sep).join('/');
  const mountInfo = `1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / ${normalized} ro,nosuid - ext4 /dev/a ro\n`;
  assert.equal(
    readonlyMountProof(root, { platform: 'linux', mountInfo }).verified,
    process.platform === 'win32' ? false : true
  );
  assert.equal(
    readonlyMountProof(root, { platform: 'win32', mountInfo }).verified,
    false
  );
  const writable = mountInfo.replace('ro,nosuid', 'rw,nosuid');
  assert.equal(
    readonlyMountProof(root, { platform: 'linux', mountInfo: writable })
      .verified,
    false
  );
});

function inputClosure(root, files) {
  const entries = files.sort().map((file) => {
    const identity = nativeInputFileIdentity(path.join(root, file));
    const bytes = readFileSync(identity.path);
    return {
      path: file,
      mode: identity.mode,
      bytes: bytes.length,
      sha256: sha(bytes),
    };
  });
  return {
    root: fs.realpathSync(root),
    sha256: sha(Buffer.from(`${JSON.stringify(entries, null, 2)}\n`)),
    entries: entries.length,
    representation:
      'sorted-native-tree-regular-bytes-modes-internal-symlink-targets-json-v1',
  };
}

test('native input freshness accepts unchanged real dependency/tool closures and installed locks', (t) => {
  const { parent } = fixture(t);
  const dependencies = path.join(parent, 'dependencies');
  const tools = path.join(parent, 'tools');
  mkdirSync(path.join(dependencies, '.pnpm'), { recursive: true });
  mkdirSync(tools);
  const lock = path.join(dependencies, '.pnpm/lock.yaml');
  const executable = path.join(tools, 'native-tool');
  writeFileSync(lock, 'lockfileVersion: 9.0\n');
  writeFileSync(
    path.join(dependencies, 'module.mjs'),
    'export const value = 1;\n'
  );
  writeFileSync(executable, 'native executable bytes');
  const inputs = {
    closures: [
      inputClosure(dependencies, ['.pnpm/lock.yaml', 'module.mjs']),
      inputClosure(tools, ['native-tool']),
    ],
    files: [nativeInputFileIdentity(lock), nativeInputFileIdentity(executable)],
  };
  assert.equal(verifyNativeInputFreshness(inputs), true);
  assert.equal(verifyNativeInputFreshness(inputs), true);
});

test('native input freshness rejects changed dependencies, additions, deletions and executable modes', (t) => {
  const { parent } = fixture(t);
  const root = path.join(parent, 'dependencies');
  mkdirSync(root);
  const file = path.join(root, 'module.mjs');
  const bytes = 'original dependency bytes';
  writeFileSync(file, bytes, { mode: 0o644 });
  const inputs = { closures: [inputClosure(root, ['module.mjs'])], files: [] };
  writeFileSync(file, 'changed dependency bytes');
  assert.throws(() => verifyNativeInputFreshness(inputs), /closure changed/);
  writeFileSync(file, bytes);
  const added = path.join(root, 'new.mjs');
  writeFileSync(added, 'previously unsealed input');
  assert.throws(() => verifyNativeInputFreshness(inputs), /closure changed/);
  rmSync(added);
  rmSync(file);
  assert.throws(() => verifyNativeInputFreshness(inputs), /closure changed/);
  writeFileSync(file, bytes, { mode: 0o644 });
  if (process.platform !== 'win32') {
    chmodSync(file, 0o755);
    assert.throws(() => verifyNativeInputFreshness(inputs), /closure changed/);
    chmodSync(file, 0o644);
  }
  assert.equal(verifyNativeInputFreshness(inputs), true);
});

test('native input freshness rejects changed CodeQL CLI, query and model tree bytes', (t) => {
  const { parent } = fixture(t);
  const closures = ['cli', 'queries', 'models'].map((name) => {
    const root = path.join(parent, name);
    mkdirSync(root);
    writeFileSync(path.join(root, 'input'), `${name} original bytes`);
    return inputClosure(root, ['input']);
  });
  const inputs = { closures, files: [] };
  for (const reference of closures) {
    const file = path.join(reference.root, 'input');
    const original = readFileSync(file);
    writeFileSync(file, 'changed native tool/query/model bytes');
    assert.throws(() => verifyNativeInputFreshness(inputs), /closure changed/);
    writeFileSync(file, original);
  }
  assert.equal(verifyNativeInputFreshness(inputs), true);
});

test('native input freshness rejects changed installed locks and individual native executables', (t) => {
  const { parent } = fixture(t);
  const files = [
    'app-installed-lock',
    'docs-installed-lock',
    'native-executable',
    'chart-config',
  ].map((name) => {
    const file = path.join(parent, name);
    writeFileSync(file, `${name} original bytes`);
    return nativeInputFileIdentity(file);
  });
  const inputs = { closures: [], files };
  for (const reference of files) {
    const original = readFileSync(reference.path);
    writeFileSync(reference.path, 'changed captured input');
    assert.throws(() => verifyNativeInputFreshness(inputs), /file changed/);
    writeFileSync(reference.path, original);
  }
  assert.equal(verifyNativeInputFreshness(inputs), true);
});

test(
  'native input freshness rejects redirected dependency aliases even when replacement bytes match',
  { skip: process.platform === 'win32' },
  (t) => {
    const { parent } = fixture(t);
    const roots = ['original', 'replacement'].map((name) => {
      const root = path.join(parent, name);
      mkdirSync(root);
      writeFileSync(path.join(root, 'module.mjs'), 'identical bytes');
      return root;
    });
    const alias = path.join(parent, 'node_modules');
    symlinkSync(roots[0], alias);
    const fileInputs = {
      closures: [],
      files: [nativeInputFileIdentity(path.join(alias, 'module.mjs'))],
    };
    const inputs = {
      closures: [{ ...inputClosure(roots[0], ['module.mjs']), paths: [alias] }],
      files: [],
    };
    assert.equal(verifyNativeInputFreshness(inputs), true);
    rmSync(alias);
    symlinkSync(roots[1], alias);
    assert.throws(
      () => verifyNativeInputFreshness(inputs),
      /input path changed/
    );
    assert.throws(
      () => verifyNativeInputFreshness(fileInputs),
      /input path changed/
    );
  }
);

test('provider isolation is only proven by an observed loopback-only Linux namespace', () => {
  const loopback = { lo: [{ address: '127.0.0.1', internal: true }] };
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: loopback,
      routes: 'Iface Destination\n',
    }).isolated,
    true
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'win32',
      interfaces: loopback,
      routes: '',
    }).isolated,
    false
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: { ...loopback, eth0: [{ internal: false }] },
      routes: '',
    }).isolated,
    false
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: loopback,
      routes: 'Iface Destination\neth0\t00000000\t00000000',
    }).isolated,
    false
  );
});

test('injected boundary proofs require source, live namespace, capability and probe binding', () => {
  const candidate = { sourceSha256: 'a'.repeat(64) };
  const proof = {
    verified: true,
    isolated: true,
    deniesPrivateProviders: true,
    sourceSha256: candidate.sourceSha256,
    networkNamespace: 'net:[123]',
    rulesSha256: 'b'.repeat(64),
    evidenceSha256: 'c'.repeat(64),
    capabilityBoundingSet: '0000000000000000',
    noNewPrivileges: true,
    publicProbe: { host: 'api.themoviedb.org', httpsStatus: 204 },
    privateProbe: {
      destination: '192.168.255.254:9',
      refused: true,
      exitCode: 7,
    },
  };
  const current = {
    platform: 'linux',
    networkNamespace: 'net:[123]',
    status:
      'CapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\n',
  };
  assert.deepEqual(
    validateNativeBoundaryProof(proof, candidate, current),
    proof
  );
  for (const changed of [
    { ...proof, sourceSha256: 'd'.repeat(64) },
    { ...proof, networkNamespace: 'net:[other]' },
    { ...proof, rulesSha256: null },
    { ...proof, privateProbe: { ...proof.privateProbe, refused: false } },
  ])
    assert.throws(
      () => validateNativeBoundaryProof(changed, candidate, current),
      /unproven/
    );
  assert.throws(
    () =>
      validateNativeBoundaryProof(proof, candidate, {
        ...current,
        status: 'CapBnd:\t0000000000002000\nNoNewPrivs:\t1\n',
      }),
    /unproven/
  );
});

test('native tool discovery is PATH-bound and rejects path-like names', (t) => {
  const { parent } = fixture(t);
  const executable = path.join(
    parent,
    process.platform === 'win32' ? 'fake-native.exe' : 'fake-native'
  );
  writeFileSync(executable, 'test-only tool bytes');
  chmodSync(executable, 0o755);
  assert.equal(
    findNativeExecutable('fake-native', { PATH: parent }),
    executable
  );
  assert.equal(findNativeExecutable('absent-native', { PATH: parent }), null);
  assert.throws(
    () => findNativeExecutable('../private', { PATH: parent }),
    /Unsafe native executable name/
  );
});

test('complete native output is materialized only when persistent byte count/hash closes', (t) => {
  const { parent } = fixture(t);
  const log = path.join(parent, 'native.stdout.log');
  const bytes = Buffer.from('TAP version 13\ncomplete native output\n');
  writeFileSync(log, bytes);
  const receipt = {
    stdout: 'tail',
    stdoutTruncated: true,
    stdoutLog: log,
    stdoutBytes: bytes.length,
    stdoutSha256: sha(bytes),
    stderr: '',
    stderrTruncated: false,
  };
  const result = materializeNativeReceipt(receipt);
  assert.equal(result.stdout, bytes.toString());
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stdoutCaptureTruncated, true);
  assert.throws(
    () =>
      materializeNativeReceipt({ ...receipt, stdoutSha256: '0'.repeat(64) }),
    /does not match/
  );
  assert.throws(
    () => materializeNativeReceipt({ ...receipt, stdoutLog: null }),
    /no complete persistent log/
  );
});

test('artifact reader permits only exact sealed read-only query manifests outside scratch', (t) => {
  const { parent } = fixture(t);
  const scratchRoot = path.join(parent, 'artifact-scratch');
  const packRoot = path.join(parent, 'query-pack');
  mkdirSync(scratchRoot);
  mkdirSync(packRoot);
  const manifest = path.join(packRoot, 'qlpack.yml');
  const bytes = Buffer.from('name: codeql/actions-queries\nversion: 0.6.36\n');
  writeFileSync(manifest, bytes);
  const options = {
    scratchRoot,
    queryPacks: [{ root: packRoot, qlpackSha256: sha(bytes) }],
  };
  assert.deepEqual(
    readNativeStageArtifact(manifest, options, () => ({ verified: true })),
    bytes
  );
  assert.throws(
    () =>
      readNativeStageArtifact(manifest, options, () => ({ verified: false })),
    /read-only/
  );
  assert.throws(
    () => readNativeStageArtifact(manifest, { ...options, queryPacks: [] }),
    /Unsafe/
  );
  const unrelated = path.join(packRoot, 'other.yml');
  writeFileSync(unrelated, bytes);
  assert.throws(
    () =>
      readNativeStageArtifact(unrelated, options, () => ({ verified: true })),
    /Unsafe/
  );
  writeFileSync(manifest, 'changed');
  assert.throws(
    () =>
      readNativeStageArtifact(manifest, options, () => ({ verified: true })),
    /bytes changed/
  );
  const output = path.join(scratchRoot, 'result.sarif');
  writeFileSync(output, 'native output');
  assert.equal(
    readNativeStageArtifact(output, options).toString(),
    'native output'
  );
});

test('Jellyfin native smoke gets an exclusively owned TMPDIR parent before mktemp', (t) => {
  const { parent } = fixture(t);
  const fixtures = path.join(parent, 'supplemental-fixtures');
  mkdirSync(fixtures);
  const expected = path.join(fixtures, 'jellyfin-smoke');
  const descriptor = {
    id: 'jellyfin-plugin-native-smoke',
    env: { TMPDIR: expected, TMP: expected, TEMP: expected },
  };
  assert.equal(
    prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    expected
  );
  assert.equal(existsSync(expected), true);
  assert.throws(
    () => prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    /EEXIST/
  );
  assert.equal(
    prepareJellyfinTemporaryDirectory({ id: 'other-native-check' }, fixtures),
    null
  );
});

test('Jellyfin temporary directory cannot escape fixture ownership or follow a reused symlink', (t) => {
  const { parent } = fixture(t);
  const fixtures = path.join(parent, 'supplemental-fixtures');
  mkdirSync(fixtures);
  const outside = path.join(parent, 'outside');
  mkdirSync(outside);
  const descriptor = {
    id: 'jellyfin-plugin-native-smoke',
    env: { TMPDIR: outside, TMP: outside, TEMP: outside },
  };
  assert.throws(
    () => prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    /not bound/
  );
  if (process.platform !== 'win32') {
    const expected = path.join(fixtures, 'jellyfin-smoke');
    symlinkSync(outside, expected);
    assert.throws(
      () =>
        prepareJellyfinTemporaryDirectory(
          {
            ...descriptor,
            env: { TMPDIR: expected, TMP: expected, TEMP: expected },
          },
          fixtures
        ),
      /EEXIST/
    );
    assert.deepEqual(readdirSync(outside), []);
  }
});

test('repository isolation requires live internal admission or an observed loopback-only fallback', () => {
  const wrapper = async (operation) => operation();
  const deferred = repositoryIsolationReadiness(wrapper, { isolated: false });
  assert.equal(deferred.ready, true);
  assert.equal(deferred.requiresLiveProof, true);
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: true,
      mechanism: 'observed-loopback-only-Linux-network-namespace',
    }).ready,
    true
  );
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: true,
      mechanism: 'private-egress-firewall',
    }).ready,
    false
  );
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: false,
      mechanism: 'unproven',
    }).ready,
    false
  );
  assert.throws(() => repositoryIsolationReadiness(true), /must be a function/);
});

test('repository count evidence requires actual native cases and rejects failed/incomplete closure', () => {
  const report = {
    numPassedTests: 1,
    numFailedTests: 0,
    numTotalTests: 2,
    success: true,
    testResults: [
      {
        name: 'source.test.ts',
        assertionResults: [
          { fullName: 'actual pass', status: 'passed' },
          { fullName: 'native conditional skip', status: 'pending' },
        ],
      },
    ],
  };
  const command = { kind: 'vitest', files: ['source.test.ts'] };
  assert.deepEqual(
    repositoryNativeCases(command, {}, { vitestReport: report }).counts,
    { passed: 1, failed: 0, skipped: 1 }
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        command,
        {},
        { vitestReport: { ...report, numTotalTests: 3 } }
      ),
    /incomplete or failed/
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        { kind: 'node-js', files: ['actual.test.mjs'] },
        { stdout: '# tests 12\n# pass 12\n# fail 0' }
      ),
    /TAP case ledger is absent/
  );
  const stdout =
    "TAP version 13\n# Subtest: actual case\nok 1 - actual case\n  ---\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(
    repositoryNativeCases(
      { kind: 'node-js', files: ['actual.test.mjs'] },
      { stdout }
    ).counts.passed,
    1
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        { kind: 'node-js', files: ['actual.test.mjs'] },
        { stdout: stdout.replace('# tests 1', '# tests 2') }
      ),
    /closure failed/
  );
});

test('CodeQL memory headroom discounts observed inactive file cache but retains working-set reserve', () => {
  const gib = 1024 ** 3;
  const headroom = evaluatorHeadroom({
    memAvailableBytes: 20 * gib,
    cgroupLimitBytes: 4 * gib,
    cgroupCurrentBytes: 3 * gib,
    inactiveFileBytes: 2 * gib,
  });
  assert.equal(headroom.workingSetBytes, gib);
  assert.equal(headroom.evaluatorMb, 2048);
  assert.equal(
    evaluatorHeadroom({
      memAvailableBytes: gib,
      cgroupLimitBytes: 4 * gib,
      cgroupCurrentBytes: 3 * gib,
      inactiveFileBytes: 2 * gib,
    }).evaluatorMb,
    0
  );
  assert.equal(
    evaluatorHeadroom({
      memAvailableBytes: 20 * gib,
      cgroupLimitBytes: 4 * gib,
      cgroupCurrentBytes: 3 * gib,
    }).evaluatorMb,
    0
  );
  assert.throws(
    () => evaluatorHeadroom({ memAvailableBytes: NaN }),
    /Invalid observed/
  );
});

test('help stays read-only and does not require project/dependency/tool prerequisites', (t) => {
  const { root } = fixture(t);
  const before = readdirSync(root).sort();
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('./run-local-validation.mjs', import.meta.url)),
      '--help',
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert.match(output, /staged native PR-parity gate/);
  assert.deepEqual(readdirSync(root).sort(), before);
});
