import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedNativeCatalog,
  createDistributedNativeTaskRequest,
  discoverDistributedNativeCatalog,
  distributedNativeTaskId,
  executeDistributedNativeTask,
  verifyDistributedNativeTaskResult,
  verifyDistributedNativeWorkspace,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

function write(root, file, content) {
  const path = join(root, ...file.split('/'));
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function command(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || args.join(' ')
  );
}

function fakeTypeScript() {
  const identifier = (text) => ({ type: 'identifier', text, children: [] });
  const string = (text) => ({ type: 'string', text, children: [] });
  const text = (value) => ({
    type: 'text',
    children: [],
    getText: () => value,
  });
  const variable = (name, initializer) => ({
    type: 'variable',
    name: identifier(name),
    initializer,
    children: [],
  });
  const array = (entries) => ({
    type: 'array',
    elements: entries.map(string),
    children: [],
  });
  return {
    ScriptTarget: { Latest: 99 },
    SyntaxKind: { ImportKeyword: 1 },
    createSourceFile(file, source) {
      if (file === 'run-tooling-tests.mjs') {
        return {
          type: 'root',
          children: [
            variable('portableTests', array(['bin/tooling.test.mjs'])),
            variable('posixOnlyTests', array(['deploy/posix.test.mjs'])),
            variable(
              'tests',
              text(
                "process.platform === 'win32' ? portableTests : [...portableTests, ...posixOnlyTests]"
              )
            ),
            {
              type: 'call',
              expression: identifier('spawnSync'),
              arguments: [
                text('process.execPath'),
                text(
                  "['--test', '--test-reporter=tap', `--test-concurrency=${workers}`, ...tests]"
                ),
              ],
              children: [],
            },
          ],
        };
      }
      const imports = [
        ...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g),
      ].map((match) => ({
        type: 'import',
        moduleSpecifier: string(match[1]),
        children: [],
      }));
      return { type: 'root', children: imports };
    },
    forEachChild(node, visitor) {
      for (const child of node.children || []) visitor(child);
    },
    isArrayLiteralExpression: (node) => node?.type === 'array',
    isCallExpression: (node) => node?.type === 'call',
    isExportDeclaration: () => false,
    isIdentifier: (node) => node?.type === 'identifier',
    isImportDeclaration: (node) => node?.type === 'import',
    isStringLiteral: (node) => node?.type === 'string',
    isVariableDeclaration: (node) => node?.type === 'variable',
  };
}

function createFixture(
  t,
  { includeSkippedNative = false, vitestStatus = 'passed' } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-native-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'server/test',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
  ])
    mkdirSync(join(root, ...directory.split('/')), { recursive: true });

  write(root, '.gitignore', 'node_modules/\nignored-native.test.mjs\n');
  write(
    root,
    'package.json',
    JSON.stringify({
      name: 'distributed-native-fixture',
      private: true,
      type: 'module',
      engines: { node: '>=18', pnpm: '>=9' },
      devDependencies: {
        '@swc/core': '*',
        semver: '*',
        'ts-node': '*',
        'tsconfig-paths': '*',
        typescript: '*',
        vitest: '*',
      },
    })
  );
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  for (const name of [
    'semver',
    'typescript',
    'vitest',
    'ts-node',
    'tsconfig-paths',
    '@swc/core',
  ])
    write(
      root,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version: '1.0.0', main: 'index.js' })
    );
  write(root, 'node_modules/semver/index.js', 'exports.satisfies=()=>true;\n');
  write(
    root,
    'node_modules/typescript/index.js',
    `module.exports=(${fakeTypeScript.toString()})();\n`
  );
  write(
    root,
    'node_modules/vitest/vitest.mjs',
    `import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = process.argv.find((argument) => argument.startsWith('--outputFile.json='))?.slice('--outputFile.json='.length);
if (!output) throw new Error('missing fixture Vitest report path');
writeFileSync(output, JSON.stringify({
  numTotalTests: 1,
  numPassedTests: ${vitestStatus === 'passed' ? 1 : 0},
  numFailedTests: 0,
  numPendingTests: ${vitestStatus === 'passed' ? 0 : 1},
  success: true,
  testResults: [{
    name: resolve('server/native-typescript.test.ts'),
    assertionResults: [{ fullName: 'canonical TypeScript fixture', status: ${JSON.stringify(vitestStatus)} }],
  }],
}));
`
  );
  write(
    root,
    'vitest.config.mts',
    `import { resolve } from 'node:path';
const projectRoot = process.cwd();
export default { resolve: { alias: { 'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts') } } };
`
  );
  write(
    root,
    'server/test/index.mts',
    '// fixture native TypeScript adapter\n'
  );
  write(
    root,
    'server/test/vitestNodeTest.ts',
    '// fixture canonical node:test-to-Vitest adapter\n'
  );
  write(
    root,
    'src/vitest.test.ts',
    "import { test } from 'vitest';\ntest('fixture',()=>{});\n"
  );
  write(
    root,
    'server/native-typescript.test.ts',
    "import test from 'node:test';\ntest('fixture',()=>{});\n"
  );
  write(
    root,
    'scripts/tiny-native.test.mjs',
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('tiny native task',()=>{assert.equal(2+2,4);assert.equal(process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET,undefined);});\n"
  );
  if (includeSkippedNative)
    write(
      root,
      'scripts/skipped-native.test.mjs',
      "import test from 'node:test';\ntest('explicitly skipped native task',{skip:'fixture prerequisite unavailable'},()=>{});\n"
    );
  write(
    root,
    'scripts/hanging-native.test.mjs',
    "import test from 'node:test';\ntest('hanging native task',()=>new Promise(()=>setInterval(()=>{},1000)));\n"
  );
  write(
    root,
    'bin/tooling.test.mjs',
    "import test from 'node:test';\ntest('tooling fixture',()=>{});\n"
  );
  write(
    root,
    'deploy/posix.test.mjs',
    "import test from 'node:test';\ntest('posix fixture',()=>{});\n"
  );
  write(
    root,
    'bin/run-tooling-tests.mjs',
    "import {spawnSync} from 'node:child_process';\nconst workers=1;\nconst portableTests=['bin/tooling.test.mjs'];\nconst posixOnlyTests=['deploy/posix.test.mjs'];\nconst tests=process.platform==='win32'?portableTests:[...portableTests,...posixOnlyTests];\nconst result=spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-concurrency=${workers}`,...tests],{stdio:'inherit'});\nprocess.exitCode=result.status??1;\n"
  );

  command(root, ['init', '--quiet']);
  command(root, ['config', 'user.name', 'Distributed Fixture']);
  command(root, ['config', 'user.email', 'fixture@example.invalid']);
  command(root, ['add', '--all']);
  command(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

function sink() {
  let output = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    }),
    output: () => output,
  };
}

function resealNativeResult(value, change) {
  const core = JSON.parse(JSON.stringify(value));
  delete core.resultSha256;
  change(core);
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

function resealCaseLedger(value, change) {
  return resealNativeResult(value, (result) => {
    const ledger = result.caseLedger;
    delete ledger.ledgerSha256;
    change(ledger);
    ledger.ledgerSha256 = canonicalJsonSha256(ledger);
  });
}

test('native discovery seals every locally owned task before allowlist selection', (t) => {
  const root = createFixture(t);
  const discovered = discoverDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
  });
  const repeated = discoverDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
  });

  assert.deepEqual(repeated, discovered);
  assert.equal(Object.isFrozen(discovered), true);
  assert.equal(Object.isFrozen(discovered.tasks), true);
  assert.equal(discovered.tasks.length, 5);
  assert.deepEqual(
    discovered.tasks.map(({ taskId }) => taskId),
    discovered.tasks.map(({ taskId }) => taskId).toSorted()
  );
  for (const task of discovered.tasks) {
    assert.deepEqual(Object.keys(task).toSorted(), [
      'adapterId',
      'files',
      'schema',
      'taskId',
    ]);
    assert.equal(
      task.taskId,
      distributedNativeTaskId({
        applicationId: discovered.applicationId,
        adapterId: task.adapterId,
        files: task.files,
      })
    );
    assert.equal('command' in task, false);
    assert.equal('args' in task, false);
    assert.equal('cwd' in task, false);
    assert.equal('env' in task, false);
  }

  const toolingFiles = [
    'bin/tooling.test.mjs',
    ...(process.platform === 'win32' ? [] : ['deploy/posix.test.mjs']),
  ];
  assert.deepEqual(
    discovered.tasks.flatMap(({ files }) => files).toSorted(),
    [
      'server/native-typescript.test.ts',
      'src/vitest.test.ts',
      'scripts/hanging-native.test.mjs',
      'scripts/tiny-native.test.mjs',
      ...toolingFiles,
    ].toSorted()
  );
  assert.equal(
    discovered.tasks.find(({ files }) =>
      files.includes('server/native-typescript.test.ts')
    )?.adapterId,
    'vitest'
  );
  assert.equal(
    discovered.tasks.filter(({ adapterId }) => adapterId === 'tooling').length,
    1
  );
  assert.deepEqual(
    discovered.tasks.find(({ adapterId }) => adapterId === 'tooling')?.files,
    toolingFiles
  );
  const selectedIds = discovered.tasks
    .filter(({ adapterId }) => adapterId !== 'tooling')
    .slice(0, 2)
    .map(({ taskId }) => taskId);
  const selected = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: selectedIds,
  });
  assert.equal(selected.tasks.length, 2);
  assert.deepEqual(
    new Set(selected.tasks.map(({ taskId }) => taskId)),
    new Set(selectedIds)
  );
  assert.equal(
    selected.candidate.candidateSha256,
    discovered.candidate.candidateSha256
  );
  assert.throws(
    () =>
      discoverDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
        allowedTaskIds: selectedIds,
      }),
    /exact field set/
  );
});

test('native discovery rejects an ignored test file absent from HEAD', (t) => {
  const root = createFixture(t);
  write(
    root,
    'scripts/ignored-native.test.mjs',
    "import test from 'node:test';\ntest('ignored native task',()=>{});\n"
  );
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }
  );
  assert.ifError(status.error);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, '');
  assert.throws(
    () =>
      discoverDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
      }),
    /not an ordinary tracked HEAD blob: scripts\/ignored-native\.test\.mjs/
  );
});

test('native discovery rejects tracked task bytes that differ from HEAD', (t) => {
  const root = createFixture(t);
  command(root, [
    'update-index',
    '--assume-unchanged',
    'scripts/tiny-native.test.mjs',
  ]);
  write(
    root,
    'scripts/tiny-native.test.mjs',
    "import test from 'node:test';\ntest('changed hidden native task',()=>{});\n"
  );
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }
  );
  assert.ifError(status.error);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout, '');
  assert.throws(
    () =>
      discoverDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
      }),
    /does not match its HEAD blob: scripts\/tiny-native\.test\.mjs/
  );
});

test('native adapter derives, binds, and executes only one exact local task', async (t) => {
  const root = createFixture(t);
  const tinyTaskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'node-js',
    files: ['scripts/tiny-native.test.mjs'],
  });
  const allowedTaskIds = [tinyTaskId];
  assert.throws(
    () =>
      createDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
        allowedTaskIds: [],
      }),
    /nonempty local distributed native task allowlist/
  );
  assert.throws(
    () =>
      createDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
        allowedTaskIds: [tinyTaskId, 'f'.repeat(64)],
      }),
    /names an unavailable task/
  );
  assert.throws(
    () =>
      createDistributedNativeCatalog(root, {
        applicationId: 'fixture-app',
        allowedTaskIds,
        ts: fakeTypeScript(),
      }),
    /exact field set/
  );
  const first = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds,
  });
  const second = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds,
  });
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.candidate.commitSha, /^[a-f0-9]{40,64}$/);
  assert.match(first.candidate.treeSha, /^[a-f0-9]{40,64}$/);
  assert.match(first.candidate.lockfileSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.tasks.length, 1);
  assert.equal(
    verifyDistributedNativeWorkspace(root, first.candidate).candidateSha256,
    first.candidate.candidateSha256
  );

  const selected = first.tasks.find(
    (task) => task.files[0] === 'scripts/tiny-native.test.mjs'
  );
  assert.ok(selected);
  assert.equal(selected.adapterId, 'node-js');
  const request = createDistributedNativeTaskRequest(first, selected.taskId);
  assert.deepEqual(request.files, ['scripts/tiny-native.test.mjs']);
  assert.equal('command' in request, false);
  assert.equal('args' in request, false);
  assert.equal('cwd' in request, false);
  assert.equal('env' in request, false);
  assert.equal('catalogSha256' in request, false);

  const priorGitDirectory = process.env.GIT_DIR;
  process.env.GIT_DIR = join(root, 'not-the-repository');
  try {
    assert.equal(
      verifyDistributedNativeWorkspace(root, first.candidate).candidateSha256,
      first.candidate.candidateSha256
    );
  } finally {
    if (priorGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDirectory;
  }

  await assert.rejects(
    executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      expectedCandidate: first.candidate,
      request: { ...request, command: 'not-allowed' },
      allowedTaskIds,
    }),
    /exact field set/
  );
  await assert.rejects(
    executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      expectedCandidate: first.candidate,
      request: { ...request, taskId: 'f'.repeat(64) },
      allowedTaskIds,
    }),
    /Unknown distributed native task/
  );
  await assert.rejects(
    executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      expectedCandidate: first.candidate,
      request: { ...request, files: [] },
      allowedTaskIds,
    }),
    /nonempty array/
  );
  await assert.rejects(
    executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      expectedCandidate: first.candidate,
      request: { ...request, files: ['bin/tooling.test.mjs'] },
      allowedTaskIds,
    }),
    /file selection drift/
  );

  const stdout = sink();
  const stderr = sink();
  const priorFleetSecret = process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET;
  process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET =
    'fixture-secret-must-not-reach-native-child';
  let result;
  try {
    result = await executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      expectedCandidate: first.candidate,
      request,
      stdout: stdout.stream,
      stderr: stderr.stream,
      allowedTaskIds,
    });
  } finally {
    if (priorFleetSecret === undefined)
      delete process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET;
    else process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET = priorFleetSecret;
  }
  assert.equal(result.status, 'passed');
  assert.equal(result.taskId, selected.taskId);
  assert.deepEqual(result.files, ['scripts/tiny-native.test.mjs']);
  assert.deepEqual(result.totals['node-js'], { total: 1, active: 1 });
  assert.equal(result.receipt.exitCode, 0);
  assert.equal(result.receipt.timedOut, false);
  assert.equal(result.receipt.lifecycle.cleanupVerified, true);
  assert.match(result.receipt.stdoutSha256, /^[a-f0-9]{64}$/);
  assert.match(result.receipt.stderrSha256, /^[a-f0-9]{64}$/);
  assert.match(stdout.output(), /tiny-native\.test\.mjs/);
  assert.equal(stderr.output(), '');
  const verified = verifyDistributedNativeTaskResult(result, {
    catalog: first,
    taskId: selected.taskId,
  });
  assert.deepEqual(verified, result);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.files), true);
  assert.equal(Object.isFrozen(verified.totals), true);
  assert.equal(Object.isFrozen(verified.totals['node-js']), true);
  assert.equal(Object.isFrozen(verified.caseLedger), true);
  assert.equal(Object.isFrozen(verified.caseLedger.cases), true);
  assert.equal(Object.isFrozen(verified.caseLedger.counts), true);
  assert.deepEqual(verified.caseLedger.counts, {
    active: 1,
    failed: 0,
    passed: 1,
    skipped: 0,
    total: 1,
  });
  assert.equal(Object.isFrozen(verified.receipt), true);
  assert.equal(Object.isFrozen(verified.receipt.lifecycle), true);

  const canonicalTypeScriptTaskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'vitest',
    files: ['server/native-typescript.test.ts'],
  });
  const canonicalTypeScriptCatalog = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: [canonicalTypeScriptTaskId],
  });
  const canonicalTypeScriptResult = await executeDistributedNativeTask({
    root,
    applicationId: 'fixture-app',
    allowedTaskIds: [canonicalTypeScriptTaskId],
    expectedCandidate: canonicalTypeScriptCatalog.candidate,
    request: createDistributedNativeTaskRequest(
      canonicalTypeScriptCatalog,
      canonicalTypeScriptTaskId
    ),
    stdout: sink().stream,
    stderr: sink().stream,
  });
  assert.equal(canonicalTypeScriptResult.adapterId, 'vitest');
  assert.deepEqual(canonicalTypeScriptResult.files, [
    'server/native-typescript.test.ts',
  ]);
  assert.deepEqual(canonicalTypeScriptResult.totals.vitest, {
    total: 1,
    active: 1,
  });
  const forgedVitestSkip = resealNativeResult(
    canonicalTypeScriptResult,
    (value) => {
      const ledger = value.caseLedger;
      delete ledger.ledgerSha256;
      ledger.cases[0].status = 'skipped';
      ledger.counts = {
        active: 0,
        failed: 0,
        passed: 0,
        skipped: 1,
        total: 1,
      };
      ledger.ledgerSha256 = canonicalJsonSha256(ledger);
      value.totals.vitest = { active: 0, total: 1 };
    }
  );
  assert.throws(
    () =>
      verifyDistributedNativeTaskResult(forgedVitestSkip, {
        catalog: canonicalTypeScriptCatalog,
        taskId: canonicalTypeScriptTaskId,
      }),
    /case ledger differs from retained execution report/
  );

  const bindingAttacks = [
    (value) => {
      value.applicationId = 'another-app';
    },
    (value) => {
      value.candidateSha256 = '0'.repeat(64);
    },
    (value) => {
      value.catalogSha256 = '1'.repeat(64);
    },
    (value) => {
      value.taskId = '2'.repeat(64);
    },
    (value) => {
      value.adapterId = 'vitest';
    },
    (value) => {
      value.files = ['scripts/hanging-native.test.mjs'];
    },
  ];
  for (const attack of bindingAttacks)
    assert.throws(
      () =>
        verifyDistributedNativeTaskResult(resealNativeResult(result, attack), {
          catalog: first,
          taskId: selected.taskId,
        }),
      /binding is invalid/
    );

  const evidenceAttacks = [
    [
      (value) => {
        value.status = 'failed';
      },
      /did not pass/,
    ],
    [
      (value) => {
        value.wallMs = -1;
      },
      /nonnegative finite duration/,
    ],
    [
      (value) => {
        value.totals['node-js'].active = 0;
      },
      /active test coverage/,
    ],
    [
      (value) => {
        value.totals['node-js'].unexpected = 1;
      },
      /exact field set/,
    ],
    [
      (value) => {
        value.receipt.status = 'failed';
      },
      /passing receipt/,
    ],
    [
      (value) => {
        value.receipt.unexpected = true;
      },
      /exact field set/,
    ],
    [
      (value) => {
        value.receipt.wallMs = -1;
      },
      /nonnegative finite duration/,
    ],
    [
      (value) => {
        value.receipt.lifecycle.cleanupVerified = false;
      },
      /verified lifecycle cleanup/,
    ],
    [
      (value) => {
        value.receipt.lifecycle.unexpected = true;
      },
      /exact field set/,
    ],
    [
      (value) => {
        value.receipt.stdout = 'changed evidence\n';
      },
      /hash-bound stdout evidence/,
    ],
    [
      (value) => {
        value.receipt.stdoutTruncated = true;
      },
      /TAP evidence stream was truncated/,
    ],
  ];
  for (const [attack, message] of evidenceAttacks)
    assert.throws(
      () =>
        verifyDistributedNativeTaskResult(resealNativeResult(result, attack), {
          catalog: first,
          taskId: selected.taskId,
        }),
      message
    );
  const forgedSkipResult = resealNativeResult(result, (value) => {
    const ledger = value.caseLedger;
    delete ledger.ledgerSha256;
    ledger.cases[0].status = 'skipped';
    ledger.counts = {
      active: 0,
      failed: 0,
      passed: 0,
      skipped: 1,
      total: 1,
    };
    ledger.ledgerSha256 = canonicalJsonSha256(ledger);
    value.totals['node-js'] = { active: 0, total: 1 };
  });
  assert.throws(
    () =>
      verifyDistributedNativeTaskResult(forgedSkipResult, {
        catalog: first,
        taskId: selected.taskId,
      }),
    /case ledger differs from retained execution report/
  );
  assert.throws(
    () =>
      verifyDistributedNativeTaskResult(
        { ...result, unexpected: true },
        { catalog: first, taskId: selected.taskId }
      ),
    /exact field set/
  );
  assert.throws(
    () =>
      verifyDistributedNativeTaskResult(
        { ...result, resultSha256: '0'.repeat(64) },
        { catalog: first, taskId: selected.taskId }
      ),
    /result hash is invalid/
  );
  const remoteCatalogSha256 = '3'.repeat(64);
  const remoteCatalogResult = resealNativeResult(result, (value) => {
    value.catalogSha256 = remoteCatalogSha256;
  });
  assert.throws(
    () =>
      verifyDistributedNativeTaskResult(remoteCatalogResult, {
        catalog: first,
        taskId: selected.taskId,
      }),
    /binding is invalid/
  );
  const verifiedRemoteCatalogResult = verifyDistributedNativeTaskResult(
    remoteCatalogResult,
    {
      catalog: first,
      taskId: selected.taskId,
      expectedCatalogSha256: remoteCatalogSha256,
    }
  );
  assert.equal(verifiedRemoteCatalogResult.catalogSha256, remoteCatalogSha256);
  assert.equal(Object.isFrozen(verifiedRemoteCatalogResult), true);

  const toolingFiles = [
    'bin/tooling.test.mjs',
    ...(process.platform === 'win32' ? [] : ['deploy/posix.test.mjs']),
  ];
  const toolingTaskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'tooling',
    files: toolingFiles,
  });
  const toolingCatalog = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: [toolingTaskId],
  });
  const toolingRequest = createDistributedNativeTaskRequest(
    toolingCatalog,
    toolingTaskId
  );
  assert.deepEqual(toolingRequest.files, toolingFiles);
  const toolingResult = await executeDistributedNativeTask({
    root,
    applicationId: 'fixture-app',
    allowedTaskIds: [toolingTaskId],
    expectedCandidate: toolingCatalog.candidate,
    request: toolingRequest,
    stdout: sink().stream,
    stderr: sink().stream,
  });
  assert.deepEqual(toolingResult.totals.tooling, {
    total: toolingFiles.length,
    active: toolingFiles.length,
  });

  const hangingTaskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'node-js',
    files: ['scripts/hanging-native.test.mjs'],
  });
  assert.throws(
    () => createDistributedNativeTaskRequest(first, hangingTaskId),
    /Unknown distributed native task/
  );
  const hangingCatalog = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: [hangingTaskId],
  });
  await assert.rejects(
    executeDistributedNativeTask({
      root,
      applicationId: 'fixture-app',
      allowedTaskIds: [hangingTaskId],
      expectedCandidate: hangingCatalog.candidate,
      request: createDistributedNativeTaskRequest(
        hangingCatalog,
        hangingTaskId
      ),
      stdout: sink().stream,
      stderr: sink().stream,
      timeoutMs: 100,
    }),
    (error) => {
      assert.equal(error.receipt?.timedOut, true);
      assert.equal(error.receipt?.lifecycle.cleanupVerified, true);
      return true;
    }
  );
  verifyDistributedNativeWorkspace(root, hangingCatalog.candidate);

  write(root, 'unexpected.txt', 'drift\n');
  assert.throws(
    () => verifyDistributedNativeWorkspace(root, first.candidate),
    /workspace must be clean/
  );
  rmSync(join(root, 'unexpected.txt'));
  assert.throws(
    () =>
      verifyDistributedNativeWorkspace(root, {
        ...first.candidate,
        lockfileSha256: '0'.repeat(64),
      }),
    /candidate identity is invalid/
  );
});

test('native adapter accepts only a nonempty, sealed, fully explicit skipped case closure', async (t) => {
  const root = createFixture(t, { vitestStatus: 'skipped' });
  const taskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'vitest',
    files: ['server/native-typescript.test.ts'],
  });
  const catalog = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: [taskId],
  });
  const result = await executeDistributedNativeTask({
    root,
    applicationId: 'fixture-app',
    allowedTaskIds: [taskId],
    expectedCandidate: catalog.candidate,
    request: createDistributedNativeTaskRequest(catalog, taskId),
    stdout: sink().stream,
    stderr: sink().stream,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.totals.vitest, { active: 0, total: 1 });
  assert.deepEqual(result.caseLedger.counts, {
    active: 0,
    failed: 0,
    passed: 0,
    skipped: 1,
    total: 1,
  });
  assert.deepEqual(
    result.caseLedger.cases.map(({ source, status }) => ({ source, status })),
    [
      {
        source: 'server/native-typescript.test.ts',
        status: 'skipped',
      },
    ]
  );
  assert.deepEqual(
    verifyDistributedNativeTaskResult(result, { catalog, taskId }),
    result
  );

  const attacks = [
    [
      resealNativeResult(result, (value) => {
        delete value.caseLedger;
      }),
      /exact field set/,
    ],
    [
      resealCaseLedger(result, (ledger) => {
        ledger.cases = [];
        ledger.counts = {
          active: 0,
          failed: 0,
          passed: 0,
          skipped: 0,
          total: 0,
        };
      }),
      /must contain cases/,
    ],
    [
      resealCaseLedger(result, (ledger) => {
        ledger.cases[0].status = 'unknown';
      }),
      /unknown status/,
    ],
    [
      resealCaseLedger(result, (ledger) => {
        ledger.files = ['src/vitest.test.ts'];
      }),
      /another file set/,
    ],
    [
      resealNativeResult(result, (value) => {
        value.caseLedger.ledgerSha256 = '0'.repeat(64);
      }),
      /case-ledger hash is invalid/,
    ],
    [
      resealCaseLedger(result, (ledger) => {
        ledger.reportBase64 = 'A'.repeat(
          4 * Math.ceil((8 * 1024 * 1024) / 3) + 4
        );
      }),
      /retained report evidence/,
    ],
    [
      resealCaseLedger(result, (ledger) => {
        ledger.cases[0].status = 'passed';
      }),
      /counts do not close/,
    ],
  ];
  for (const [value, message] of attacks)
    assert.throws(
      () => verifyDistributedNativeTaskResult(value, { catalog, taskId }),
      message
    );
});

test('native adapter accepts a nonempty explicit Node TAP skip ledger', async (t) => {
  const root = createFixture(t, { includeSkippedNative: true });
  const taskId = distributedNativeTaskId({
    applicationId: 'fixture-app',
    adapterId: 'node-js',
    files: ['scripts/skipped-native.test.mjs'],
  });
  const catalog = createDistributedNativeCatalog(root, {
    applicationId: 'fixture-app',
    allowedTaskIds: [taskId],
  });
  const result = await executeDistributedNativeTask({
    root,
    applicationId: 'fixture-app',
    allowedTaskIds: [taskId],
    expectedCandidate: catalog.candidate,
    request: createDistributedNativeTaskRequest(catalog, taskId),
    stdout: sink().stream,
    stderr: sink().stream,
  });

  assert.deepEqual(result.totals['node-js'], { active: 0, total: 1 });
  assert.deepEqual(result.caseLedger.counts, {
    active: 0,
    failed: 0,
    passed: 0,
    skipped: 1,
    total: 1,
  });
  assert.deepEqual(
    result.caseLedger.cases.map(({ status }) => status),
    ['skipped']
  );
  assert.deepEqual(
    verifyDistributedNativeTaskResult(result, { catalog, taskId }),
    result
  );
});
