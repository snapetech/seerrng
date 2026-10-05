import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chunkArguments,
  createPlan,
  discoverTests,
  executePlan,
  expectedPackageBindings,
  frameworkOf,
  isolatedEnvironment,
  loadTypeScript,
  preflight,
  removeOwnedTemporaryDirectory,
  runCommand,
  testCount,
  toolingOwnership,
  validateGovernanceSources,
  validatePackageBindings,
  vitestConfigSource,
} from './local-validation.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ts = loadTypeScript(root);
const sink = { write() {} };
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-validation-fixture-'));
  const write = (path, contents = '// fixture') => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  };
  for (const scope of [
    'server',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
  ])
    mkdirSync(join(directory, scope));
  write('package.json', '{}');
  write(
    'vitest.config.mts',
    'export default {plugins: [], test: {setupFiles: ["setup.ts"]}};'
  );
  write('node_modules/vitest/vitest.mjs');
  write('server/test/index.mts');
  write(
    'server/native.test.ts',
    'import test from "node:test"; test("native", () => {});'
  );
  write(
    'src/native.test.tsx',
    'import test from "node:test"; test("tsx", () => {});'
  );
  write(
    'src/component.test.ts',
    'import {test} from "vitest"; test("vitest", () => {});'
  );
  write(
    'src/style.test.mjs',
    'import test from "node:test"; test("style", () => {});'
  );
  write(
    'scripts/portable.test.mjs',
    'import test from "node:test"; test("tool", () => {});'
  );
  write(
    'deploy/posix.test.mjs',
    'import test from "node:test"; test("posix", () => {});'
  );
  write(
    'bin/run-tooling-tests.mjs',
    'const portableTests = ["scripts/portable.test.mjs"]; const posixOnlyTests = ["deploy/posix.test.mjs"]; const tests = process.platform === "win32" ? portableTests : [...portableTests, ...posixOnlyTests]; spawnSync(process.execPath, ["--test", ...tests], {});'
  );
  return {
    directory,
    write,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
};

test('AST classification ignores comments and text, accepts actual imports and rejects ambiguous suites', () => {
  assert.equal(
    frameworkOf(
      '/* import {test} from "vitest" */ import test from "node:test";',
      'x.test.ts',
      ts
    ),
    'node-ts'
  );
  assert.equal(
    frameworkOf('const {test} = require("node:test");', 'x.test.cjs', ts),
    'node-js'
  );
  assert.equal(frameworkOf('import("vitest");', 'x.test.ts', ts), 'vitest');
  assert.throws(
    () => frameworkOf('import "vitest"; import "node:test";', 'x.test.ts', ts),
    /Mixed/
  );
  assert.throws(
    () => frameworkOf('const label = "node:test";', 'x.test.ts', ts),
    /Unclassified/
  );
});

test('discovery accounts for every file once, includes TSX and new Node tests, and preserves platform ownership', () => {
  const f = fixture();
  try {
    f.write(
      'bin/new.test.mjs',
      'import test from "node:test"; test("new", () => {});'
    );
    const linux = discoverTests(f.directory, { platform: 'linux', ts });
    const windows = discoverTests(f.directory, { platform: 'win32', ts });
    assert.equal(linux.length, 7);
    assert.equal(new Set(linux.map(({ file }) => file)).size, 7);
    assert.equal(linux.filter(({ owner }) => owner === 'tooling').length, 2);
    assert.equal(linux.filter(({ owner }) => owner === 'node-ts').length, 2);
    assert.equal(windows.filter(({ selected }) => !selected).length, 1);
    assert.match(
      windows.find(({ file }) => file === 'deploy/posix.test.mjs').exclusion,
      /POSIX/
    );
    assert.equal(
      windows.find(({ file }) => file === 'bin/new.test.mjs').owner,
      'node-js'
    );
    f.write('server/unknown.test.ts', 'export const value = 1;');
    assert.throws(() => discoverTests(f.directory, { ts }), /Unclassified/);
  } finally {
    f.cleanup();
  }
});

test('tooling declarations fail closed for missing, duplicate, or dynamic ownership', () => {
  assert.throws(
    () => toolingOwnership('const portableTests = [];', ts),
    /Missing/
  );
  assert.throws(
    () =>
      toolingOwnership(
        'const portableTests = ["a"]; const posixOnlyTests = ["a"];',
        ts
      ),
    /Duplicate/
  );
  assert.throws(
    () =>
      toolingOwnership(
        'const portableTests = find(); const posixOnlyTests = ["a"];',
        ts
      ),
    /Unsupported/
  );
  const f = fixture();
  try {
    rmSync(join(f.directory, 'scripts/portable.test.mjs'));
    assert.throws(
      () => discoverTests(f.directory, { ts }),
      /Missing or incompatible tooling test/
    );
  } finally {
    f.cleanup();
  }
});

test('plan is read-only, partitions framework runs and preserves the original Vitest configuration', () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.directory, 'vitest.config.mts'), 'utf8');
    const plan = createPlan(f.directory, {
      testsOnly: true,
      ts,
      platform: 'linux',
    });
    assert.equal(plan.steps.length, 4);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'node-ts').files, [
      'server/native.test.ts',
      'src/native.test.tsx',
    ]);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'vitest').files, [
      'src/component.test.ts',
    ]);
    assert.equal(
      plan.steps.find(({ kind }) => kind === 'tooling').args[0],
      join(f.directory, 'bin/run-tooling-tests.mjs')
    );
    const generated = vitestConfigSource(
      join(f.directory, 'vitest.config.mts'),
      f.directory,
      ['src/component.test.ts']
    );
    assert.match(generated, /\.\.\.base/);
    assert.match(generated, /\.\.\.base\.test/);
    assert.match(generated, /passWithNoTests: false/);
    assert.match(generated, /Vitest projects need explicit ownership/);
    assert.equal(
      readFileSync(join(f.directory, 'vitest.config.mts'), 'utf8'),
      before
    );
    assert.equal(existsSync(join(f.directory, 'config')), false);
    rmSync(join(f.directory, 'src/component.test.ts'));
    assert.throws(
      () => createPlan(f.directory, { testsOnly: true, ts }),
      /zero-test execution lane: vitest/
    );
  } finally {
    f.cleanup();
  }
});

test('full validation retains original validators and type/format/lint checks without nested duplicate test commands', () => {
  const f = fixture();
  try {
    for (const path of [
      'bin/check-i18n.js',
      'bin/check-current-batch-contract.js',
      'bin/check-refreshed-ui-style.js',
      'bin/run-prettier.mjs',
      'node_modules/eslint/bin/eslint.js',
      'node_modules/typescript/bin/tsc',
      'node_modules/next/dist/bin/next',
      'server/tsconfig.json',
      'tsconfig.json',
    ])
      f.write(path);
    const plan = createPlan(f.directory, { ts });
    assert.deepEqual(
      plan.steps.filter(({ kind }) => kind === 'check').map(({ name }) => name),
      [
        'Translations',
        'Current batch contract',
        'Shared visual standard',
        'Formatting',
        'Lint',
        'Server types',
        'Client route types',
        'Client types',
      ]
    );
    assert.equal(plan.steps.filter(({ kind }) => kind !== 'check').length, 4);
    rmSync(join(f.directory, 'bin/check-current-batch-contract.js'));
    assert.throws(() => createPlan(f.directory, { ts }), /required file/);
  } finally {
    f.cleanup();
  }
});

test('the comprehensive gate is an explicit package command while ordinary scripts keep their upstream bindings', () => {
  const valid = {
    scripts: { ...expectedPackageBindings },
  };
  assert.doesNotThrow(() => validatePackageBindings(valid));
  for (const [name, changed] of [
    ['test', 'node bin/run-local-validation.mjs --tests-only'],
    ['validate:development', 'pnpm test'],
    ['build', 'pnpm validate:development && pnpm build:all'],
    ['build:all', 'pnpm build'],
    ['dev', 'pnpm validate:development && pnpm dev:server'],
    ['test:ci', 'node bin/run-local-validation.mjs'],
    ['build:server:compile', 'pnpm build'],
  ]) {
    assert.throws(
      () =>
        validatePackageBindings({
          scripts: { ...valid.scripts, [name]: changed },
        }),
      /binding drift|recursive/
    );
  }
  assert.throws(
    () =>
      validatePackageBindings({
        scripts: { ...valid.scripts, prebuild: 'pnpm validate:development' },
      }),
    /binding drift/
  );
  assert.throws(
    () =>
      validatePackageBindings({
        scripts: { ...valid.scripts, 'dev:server': '' },
      }),
    /binding drift/
  );
});

test('agent routes require the current engine while the normal hook stays bounded', () => {
  const agents =
    'Read docs/maintainers/ui-style-standard.md docs/maintainers/ui-fix-it.md docs/maintainers/ui-forward-merge-guide.md and follow tools/validation-engine/README.md';
  const hook =
    '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?\npnpm exec lint-staged || exit $?\n';
  assert.doesNotThrow(() => validateGovernanceSources(agents, hook));
  for (const missing of [
    'docs/maintainers/ui-style-standard.md',
    'docs/maintainers/ui-fix-it.md',
    'docs/maintainers/ui-forward-merge-guide.md',
    'tools/validation-engine/README.md',
  ])
    assert.throws(
      () => validateGovernanceSources(agents.replace(missing, ''), hook),
      /missing the required/
    );
  for (const changed of [
    `${hook}pnpm validate:development\n`,
    hook.replace(
      'pnpm attribution:check || exit $?',
      'pnpm attribution:check || true'
    ),
    `exit 0\n${hook}`,
    hook.replace('pnpm exec lint-staged || exit $?\n', ''),
  ])
    assert.throws(
      () => validateGovernanceSources(agents, changed),
      /must preserve/
    );
});

test('runtime preflight rejects unsupported engines, dependency drift, and incomplete archive governance without installing anything', () => {
  const f = fixture();
  try {
    rmSync(join(f.directory, 'node_modules'), { recursive: true, force: true });
    symlinkSync(
      join(root, 'node_modules'),
      join(f.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const packageJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    );
    packageJson.scripts = { ...expectedPackageBindings };
    f.write('package.json', JSON.stringify(packageJson));
    const options = {
      testsOnly: true,
      nodeVersion: process.version,
      inherited: {
        npm_config_user_agent: `pnpm/10.24.0 npm/? node/${process.version}`,
      },
    };
    assert.doesNotThrow(() => preflight(f.directory, options));
    assert.throws(
      () => preflight(f.directory, { ...options, nodeVersion: 'v18.0.0' }),
      /does not satisfy package engines/
    );
    assert.throws(
      () =>
        preflight(f.directory, {
          ...options,
          inherited: { npm_config_user_agent: 'pnpm/9.0.0' },
        }),
      /Use pnpm satisfying/
    );
    assert.throws(
      () =>
        preflight(f.directory, {
          ...options,
          inherited: { npm_config_user_agent: 'npm/10.0.0' },
        }),
      /Use pnpm satisfying/
    );
    assert.throws(
      () => preflight(f.directory, { ...options, testsOnly: false }),
      /required file: AGENTS.md/
    );
    f.write(
      'AGENTS.md',
      'docs/maintainers/ui-style-standard.md docs/maintainers/ui-fix-it.md docs/maintainers/ui-forward-merge-guide.md tools/validation-engine/README.md'
    );
    f.write(
      '.husky/pre-commit',
      '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?\npnpm exec lint-staged || exit $?\n'
    );
    for (const path of [
      'docs/maintainers/ui-style-standard.md',
      'docs/maintainers/ui-fix-it.md',
      'docs/maintainers/ui-forward-merge-guide.md',
      'tools/validation-engine/README.md',
    ])
      f.write(path, '# Required source document');
    assert.doesNotThrow(() =>
      preflight(f.directory, { ...options, testsOnly: false })
    );
    packageJson.devDependencies.typescript = '^999.0.0';
    f.write('package.json', JSON.stringify(packageJson));
    assert.throws(
      () => preflight(f.directory, options),
      /Installed typescript/
    );
  } finally {
    f.cleanup();
  }
});

test('argument chunks retain every filename without shell composition or exceeding the Windows budget', () => {
  const files = Array.from(
    { length: 400 },
    (_, index) => `src/folder with spaces/item-${index}.test.ts`
  );
  const chunks = chunkArguments(files, 500);
  assert.deepEqual(chunks.flat(), files);
  assert.ok(
    chunks.every(
      (chunk) => chunk.reduce((sum, file) => sum + file.length + 3, 0) <= 500
    )
  );
  assert.throws(() => chunkArguments(['x'.repeat(600)], 500), /budget/);
});

test('isolation removes inherited live configuration and escape flags without mutating the parent', () => {
  const inherited = {
    NODE_ENV: 'production',
    CONFIG_DIRECTORY: '/live',
    DB_HOST: 'live',
    DB_PASS: 'secret',
    DB_SSL_CA_FILE: '/secret',
    DATABASE_URL: 'postgres://live',
    NODE_OPTIONS: '--require injected',
    TS_NODE_PROJECT: '/wrong',
    VITEST: 'true',
    CI: 'true',
    ALLOW_NETWORK: 'true',
    SEERR_TEST_FAIL_ON_NETWORK: 'false',
    PATH: '/tools',
  };
  const isolated = isolatedEnvironment('/owned', inherited);
  assert.equal(isolated.NODE_ENV, 'test');
  assert.equal(isolated.CONFIG_DIRECTORY, '/owned');
  assert.equal(isolated.ALLOW_NETWORK, 'false');
  assert.equal(isolated.SEERR_TEST_FAIL_ON_NETWORK, 'true');
  assert.equal(isolated.DB_HOST, undefined);
  assert.equal(isolated.NODE_OPTIONS, undefined);
  assert.equal(isolated.CI, undefined);
  assert.equal(isolated.PATH, '/tools');
  assert.equal(inherited.CONFIG_DIRECTORY, '/live');
});

test('execution enforces positive active summaries and removes only its owned temporary directory on success or failure', async () => {
  for (const mode of ['success', 'zero', 'missing', 'failure']) {
    let directory;
    const plan = {
      root,
      steps: [
        {
          name: 'fixture',
          command: process.execPath,
          args: [],
          kind: 'node-js',
        },
      ],
    };
    const executor = async (_, { env }) => {
      directory = env.CONFIG_DIRECTORY;
      assert.ok(existsSync(directory));
      assert.equal(env.NODE_ENV, 'test');
      if (mode === 'failure')
        throw Object.assign(new Error('fixture failure'), { exitCode: 7 });
      if (mode === 'missing') return 'No summary';
      return mode === 'zero'
        ? '# tests 2\n# pass 0\n# fail 0\n'
        : '# tests 2\n# pass 2\n# fail 0\n';
    };
    if (mode === 'success')
      assert.equal(
        (await executePlan(plan, { executor, stdout: sink, stderr: sink })).get(
          'node-js'
        ).active,
        2
      );
    else
      await assert.rejects(
        executePlan(plan, { executor, stdout: sink, stderr: sink }),
        /zero active|Missing native|fixture failure/
      );
    assert.equal(existsSync(directory), false);
  }
  const unsafe = mkdtempSync(join(tmpdir(), 'other-owner-'));
  try {
    assert.throws(
      () => removeOwnedTemporaryDirectory(unsafe),
      /unsafe temporary cleanup/
    );
    assert.ok(existsSync(unsafe));
    assert.throws(
      () => removeOwnedTemporaryDirectory(tmpdir()),
      /unsafe temporary cleanup/
    );
  } finally {
    rmSync(unsafe, { recursive: true, force: true });
  }
});

test('native subprocess failures propagate their actual exit status and zero-summary output cannot pass', async () => {
  await assert.rejects(
    runCommand(
      {
        name: 'failure',
        command: process.execPath,
        args: ['-e', 'process.exit(7)'],
      },
      { root, env: isolatedEnvironment(tmpdir()), stdout: sink, stderr: sink }
    ),
    (error) => error.exitCode === 7
  );
  assert.deepEqual(testCount('ℹ tests 3\nℹ pass 3\nℹ fail 0\n'), {
    total: 3,
    active: 3,
  });
  assert.throws(() => testCount('Done!'), /Missing native/);
});

test('CLI help succeeds without discovery and malformed options fail before running checks', async () => {
  const command = {
    name: 'help',
    command: process.execPath,
    args: [join(root, 'bin/run-local-validation.mjs'), '--help'],
  };
  const options = {
    root,
    env: { ...process.env, NODE_OPTIONS: '' },
    stdout: sink,
    stderr: sink,
  };
  assert.match(await runCommand(command, options), /Usage:.*--tests-only/);
  for (const args of [['--unknown'], ['--json']])
    await assert.rejects(
      runCommand({ ...command, args: [command.args[0], ...args] }, options),
      (error) => error.exitCode === 1
    );
});

test('interruption cancels the owned child process tree and prevents later steps', async () => {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      runCommand(
        {
          name: 'interrupted',
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
        },
        {
          root,
          env: isolatedEnvironment(tmpdir()),
          stdout: sink,
          stderr: sink,
          signal: controller.signal,
        }
      ),
      /interrupted/
    );
    let called = false;
    await assert.rejects(
      executePlan(
        { root, steps: [{ name: 'not started', args: [], kind: 'node-js' }] },
        {
          signal: controller.signal,
          stdout: sink,
          stderr: sink,
          executor: async () => {
            called = true;
            return '';
          },
        }
      ),
      /interrupted/
    );
    assert.equal(called, false);
  } finally {
    clearTimeout(handle);
  }
});

test('Vitest must produce a valid report with active tests and cleanup still runs', async () => {
  const f = fixture();
  try {
    let directory;
    const plan = {
      root: f.directory,
      steps: [
        {
          name: 'Vitest fixture',
          command: process.execPath,
          args: [
            '<temporary-vitest-config>',
            '--outputFile.json=<temporary-vitest-report>',
          ],
          kind: 'vitest',
          config: join(f.directory, 'vitest.config.mts'),
          files: ['src/component.test.ts'],
        },
      ],
    };
    const executor = async (step, { env }) => {
      directory = env.CONFIG_DIRECTORY;
      assert.match(readFileSync(step.args[0], 'utf8'), /component\.test\.ts/);
      writeFileSync(
        step.args[1].split('=')[1],
        JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
          testResults: [{ name: join(f.directory, 'src/component.test.ts') }],
        })
      );
      return '';
    };
    assert.equal(
      (await executePlan(plan, { executor, stdout: sink, stderr: sink })).get(
        'vitest'
      ).total,
      1
    );
    assert.equal(existsSync(directory), false);
    await assert.rejects(
      executePlan(plan, {
        executor: async () => '',
        stdout: sink,
        stderr: sink,
      }),
      /ENOENT/
    );
    await assert.rejects(
      executePlan(plan, {
        executor: async (step) => {
          writeFileSync(
            step.args[1].split('=')[1],
            JSON.stringify({
              numTotalTests: 1,
              numPassedTests: 1,
              numFailedTests: 0,
              testResults: [],
            })
          );
          return '';
        },
        stdout: sink,
        stderr: sink,
      }),
      /excluded or added files/
    );
  } finally {
    f.cleanup();
  }
});
