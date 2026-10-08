import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  startCommand,
  testCount,
  toolingOwnership,
  validateDependencyReference,
  validateGovernanceSources,
  validatePackageBindings,
  vitestConfigSource,
} from './local-validation.mjs';
import { parseToolingWorkers } from './run-tooling-tests.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ts = loadTypeScript(root);
const sink = { write() {} };
const validGovernanceAgents =
  "# Agent Instructions\n\n## Communication and authority\n\nDo not make project-owner or other human acceptance a merge or release gate when the maintainer explicitly directs the work to proceed. Act on explicit user instructions without asking for the same authorization again. Ask only when a material decision is genuinely unresolved or an action falls outside the user's authorization.\n\n## Required development reading\n\nRead docs/maintainers/ui-style-standard.md docs/maintainers/ui-fix-it.md docs/maintainers/ui-forward-merge-guide.md and follow tools/validation-engine/README.md.\n\n## Required verification\n\nVisual inspection is evidence, not a merge or release gate when the maintainer explicitly directs the work to proceed.";
const validGovernanceContributing =
  '# Contributing\n\n## AI Assistance\n\nMaintainers may authorize and accept AI-assisted work without a separate human-review gate. An explicit maintainer direction to merge or release supplies that authorization; do not require a second confirmation that the same work was reviewed.';
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
    'const portableTests = ["scripts/portable.test.mjs"]; const posixOnlyTests = ["deploy/posix.test.mjs"]; const tests = process.platform === "win32" ? portableTests : [...portableTests, ...posixOnlyTests]; const workers=1; spawnSync(process.execPath, ["--test", "--test-reporter=tap", `--test-concurrency=${workers}`, ...tests], {});'
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

test('tooling worker options accept only one bounded concurrency argument', () => {
  assert.equal(parseToolingWorkers([]), undefined);
  for (const workers of [1, 2, 24, 256])
    assert.equal(parseToolingWorkers([`--workers=${workers}`]), workers);
  for (const args of [
    ['--workers=0'],
    ['--workers=257'],
    ['--workers=-1'],
    ['--workers=1.5'],
    ['--workers=01'],
    ['--workers=1e2'],
    ['--workers=1 '],
    ['--workers', '1'],
    ['--workers=1', '--workers=2'],
    ['--unknown'],
    ['--test-name-pattern=green'],
    ['--test-shard=1/2'],
    ['--test-concurrency=1'],
    [1],
    null,
  ])
    assert.throws(() => parseToolingWorkers(args), /Tooling/);
});

test('tooling concurrency recognition preserves exact platform inventory and rejects filters or duplicate launches', () => {
  const declarations =
    'const portableTests = ["a"]; const posixOnlyTests = ["b"]; const tests = process.platform === "win32" ? portableTests : [...portableTests, ...posixOnlyTests];';
  const legacy = 'spawnSync(process.execPath, ["--test", ...tests], {});';
  const bounded =
    'spawnSync(process.execPath, ["--test", `--test-concurrency=${workers}`, ...tests], {});';
  const reported =
    'spawnSync(process.execPath, ["--test", "--test-reporter=tap", `--test-concurrency=${workers}`, ...tests], {});';
  assert.deepEqual(
    toolingOwnership(declarations + reported, ts),
    new Map([
      ['portableTests', ['a']],
      ['posixOnlyTests', ['b']],
    ])
  );
  assert.deepEqual(
    toolingOwnership(
      readFileSync(join(root, 'bin/run-tooling-tests.mjs'), 'utf8'),
      ts
    ).get('posixOnlyTests').length,
    9
  );
  for (const changed of [
    legacy,
    bounded,
    reported.replace('...tests', '...tests.filter(Boolean)'),
    reported.replace('...tests', '...tests.slice(1)'),
    reported.replace('...tests', '"--test-name-pattern=green", ...tests'),
    reported.replace('...tests', '"--test-shard=1/2", ...tests'),
    reported.replace('process.execPath', '"node"'),
    reported + legacy,
  ])
    assert.throws(
      () => toolingOwnership(declarations + changed, ts),
      /Unsupported tooling execution selection/
    );
  assert.throws(
    () =>
      toolingOwnership(
        declarations.replace(
          '[...portableTests, ...posixOnlyTests]',
          'portableTests'
        ) + reported,
        ts
      ),
    /Unsupported tooling execution selection/
  );
});

test('execution forwards the sealed worker budget only to tooling without changing test selection or caller descriptors', async () => {
  for (const workers of [undefined, 1, 24, 256]) {
    const steps = [
      {
        name: 'tooling fixture',
        command: process.execPath,
        args: ['bin/run-tooling-tests.mjs'],
        kind: 'tooling',
      },
      {
        name: 'native fixture',
        command: process.execPath,
        args: ['--test', '--test-concurrency=1', 'src/native.test.mjs'],
        kind: 'node-js',
      },
      {
        name: 'check fixture',
        command: process.execPath,
        args: ['bin/check-i18n.js'],
        kind: 'check',
      },
    ];
    const before = structuredClone(steps),
      observed = [];
    const totals = await executePlan(
      { root, steps },
      {
        workers,
        stdout: sink,
        stderr: sink,
        inherited: { ...process.env, NODE_OPTIONS: '--test-concurrency=999' },
        executor: async (step, { env }) => {
          assert.equal(env.NODE_OPTIONS, undefined);
          observed.push(step);
          return '# tests 1\n# pass 1\n# fail 0\n';
        },
      }
    );
    assert.deepEqual(
      observed[0].args,
      workers === undefined
        ? before[0].args
        : [...before[0].args, `--workers=${workers}`]
    );
    assert.deepEqual(observed[1].args, before[1].args);
    assert.deepEqual(observed[2].args, before[2].args);
    assert.deepEqual(steps, before);
    assert.equal(totals.get('tooling').active, 1);
    assert.equal(totals.get('node-js').active, 1);
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

test('canonical engine binding uses the existing CI adapter once without changing ordinary native commands', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        createPlan(f.directory, {
          testsOnly: true,
          ts,
          canonicalTypescript: true,
        }),
      /required file/
    );
    f.write('server/test/vitestNodeTest.ts', 'export const test = () => {};');
    f.write(
      'vitest.config.mts',
      "export default {resolve: {alias: {'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts')}}, test: {}};"
    );
    const plan = createPlan(f.directory, {
      testsOnly: true,
      ts,
      canonicalTypescript: true,
    });
    assert.equal(plan.steps.filter(({ kind }) => kind === 'node-ts').length, 0);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'vitest').files, [
      'server/native.test.ts',
      'src/component.test.ts',
      'src/native.test.tsx',
    ]);
    assert.equal(
      new Set(plan.steps.flatMap(({ files = [] }) => files)).size,
      plan.inventory.filter(({ selected }) => selected).length
    );
    assert.equal(
      plan.steps
        .flatMap(({ files = [] }) => files)
        .includes('deploy/posix.test.mjs'),
      process.platform !== 'win32'
    );
    assert.equal(
      plan.inventory.filter(({ originalOwner }) => originalOwner === 'node-ts')
        .length,
      2
    );
    assert.equal(
      createPlan(f.directory, { testsOnly: true, ts }).steps.filter(
        ({ kind }) => kind === 'node-ts'
      ).length,
      1
    );
    f.write('vitest.config.mts', 'export default {};');
    assert.throws(
      () =>
        createPlan(f.directory, {
          testsOnly: true,
          ts,
          canonicalTypescript: true,
        }),
      /native node:test adapter/
    );
  } finally {
    f.cleanup();
  }
});

test('external dependency references require actual read-only mount and exact source/installed locks', () => {
  const f = fixture();
  const dependencies = mkdtempSync(
    join(tmpdir(), 'seerrng-dependency-reference-')
  );
  try {
    const lock = 'lockfileVersion: 9\n';
    f.write('pnpm-lock.yaml', lock);
    mkdirSync(join(dependencies, '.pnpm'));
    writeFileSync(join(dependencies, '.pnpm/lock.yaml'), lock);
    rmSync(join(f.directory, 'node_modules'), { recursive: true });
    symlinkSync(
      dependencies,
      join(f.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const reference = {
      root: dependencies,
      readonlyProof: { verified: true },
      lockSha256: createHash('sha256').update(lock).digest('hex'),
    };
    const options = {
      platform: 'linux',
      mountInfo: `1 0 0:1 / ${dependencies} ro - tmpfs tmpfs ro\n`,
    };
    assert.equal(
      validateDependencyReference(f.directory, reference, options),
      dependencies
    );
    assert.throws(
      () =>
        validateDependencyReference(f.directory, reference, {
          ...options,
          mountInfo: options.mountInfo.replaceAll(' ro', ' rw'),
        }),
      /actually mounted read-only/
    );
    assert.throws(
      () =>
        validateDependencyReference(
          f.directory,
          { ...reference, readonlyProof: { verified: false } },
          options
        ),
      /actual read-only/
    );
    assert.throws(
      () =>
        validateDependencyReference(f.directory, reference, {
          ...options,
          platform: 'win32',
        }),
      /actual read-only/
    );
    writeFileSync(join(dependencies, '.pnpm/lock.yaml'), 'different-lock');
    assert.throws(
      () => validateDependencyReference(f.directory, reference, options),
      /lockfile mismatch/
    );
  } finally {
    f.cleanup();
    rmSync(dependencies, { recursive: true });
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

test('agent routes preserve authorization while the normal hook stays bounded', () => {
  const agents = validGovernanceAgents;
  const contributing = validGovernanceContributing;
  const hook =
    '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?\npnpm exec lint-staged || exit $?\n';
  assert.doesNotThrow(() =>
    validateGovernanceSources(agents, hook, contributing)
  );
  assert.doesNotThrow(() =>
    validateGovernanceSources(
      agents.replace('same authorization', 'same\nauthorization'),
      hook,
      contributing
    )
  );
  for (const missing of [
    'docs/maintainers/ui-style-standard.md',
    'docs/maintainers/ui-fix-it.md',
    'docs/maintainers/ui-forward-merge-guide.md',
    'tools/validation-engine/README.md',
  ])
    assert.throws(
      () =>
        validateGovernanceSources(
          agents.replace(missing, ''),
          hook,
          contributing
        ),
      /missing the required/
    );
  assert.throws(
    () =>
      validateGovernanceSources(
        agents.replace(
          'Act on explicit user instructions without asking for the same authorization again. ',
          ''
        ),
        hook,
        contributing
      ),
    /must preserve/
  );
  for (const [changedAgents, changedContributing] of [
    [
      agents.replace('not a merge or release gate', 'a merge or release gate'),
      contributing,
    ],
    [
      agents,
      contributing.replace(
        'without a separate human-review gate',
        'with a separate human-review gate'
      ),
    ],
    [
      agents,
      contributing.replace(
        'do not require a second confirmation',
        'require a second confirmation'
      ),
    ],
  ])
    assert.throws(
      () => validateGovernanceSources(changedAgents, hook, changedContributing),
      /must preserve/
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
      () => validateGovernanceSources(agents, changed, contributing),
      /must preserve/
    );
});

test('runtime preflight rejects unsupported engines, dependency drift, and incomplete validation governance without installing anything', () => {
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
    f.write('AGENTS.md', validGovernanceAgents);
    f.write('CONTRIBUTING.md', validGovernanceContributing);
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

test('zero-active execution requires complete explicit skipped case evidence', async () => {
  const plan = {
    root,
    steps: [
      {
        name: 'explicit skip fixture',
        command: process.execPath,
        args: [],
        kind: 'node-js',
        files: ['scripts/portable.test.mjs'],
      },
    ],
  };
  const completeSkipTap = [
    'TAP version 13',
    '# Subtest: explicit skip fixture',
    'ok 1 - explicit skip fixture # SKIP prerequisite unavailable',
    '  ---',
    '  duration_ms: 1',
    "  type: 'test'",
    '  ...',
    '1..1',
    '# tests 1',
    '# suites 0',
    '# pass 0',
    '# fail 0',
    '# cancelled 0',
    '# skipped 1',
    '# todo 0',
    '',
  ].join('\n');

  await assert.rejects(
    executePlan(plan, {
      executor: async () => completeSkipTap,
      stdout: sink,
      stderr: sink,
    }),
    /zero active/
  );

  const ledgers = [];
  const totals = await executePlan(plan, {
    executor: async () => completeSkipTap,
    stdout: sink,
    stderr: sink,
    caseLedgerObserver: (ledger) => ledgers.push(ledger),
  });
  assert.deepEqual(totals.get('node-js'), { active: 0, total: 1 });
  assert.equal(ledgers.length, 1);
  assert.deepEqual(ledgers[0].counts, {
    active: 0,
    failed: 0,
    passed: 0,
    skipped: 1,
    total: 1,
  });
  assert.deepEqual(
    ledgers[0].cases.map(({ status }) => status),
    ['skipped']
  );

  for (const output of [
    '# tests 1\n# pass 0\n# fail 0\n',
    'TAP version 13\n1..0\n# tests 1\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n',
  ])
    await assert.rejects(
      executePlan(plan, {
        executor: async () => output,
        stdout: sink,
        stderr: sink,
        caseLedgerObserver: () => {},
      }),
      /TAP case ledger is absent|TAP case closure failed/
    );
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

test('CLI modes reject mixed, foreign, repeated, and incomplete options before project access', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const invalid = [
    {
      args: ['--help', '--plan'],
      message: /Help mode cannot be combined with other options/,
    },
    {
      args: ['-h', '--help'],
      message: /Duplicate option: --help/,
    },
    {
      args: ['--plan', '--plan'],
      message: /Duplicate option: --plan/,
    },
    {
      args: ['--json'],
      message: /Local full mode does not accept --json/,
    },
    {
      args: ['--tests-only', '--json'],
      message: /Local tests-only mode does not accept --json/,
    },
    {
      args: ['--tests-only', '--plan-file', 'missing-plan.json'],
      message: /Local tests-only mode does not accept --plan-file/,
    },
    {
      args: ['--plan', '--unit', 'ci'],
      message: /Local plan mode does not accept --unit/,
    },
    {
      args: ['--github-plan', '--github-admit'],
      message: /Choose exactly one hosted GitHub mode/,
    },
    {
      args: ['--github-plan'],
      message: /GitHub plan mode requires --plan-file/,
    },
    {
      args: [
        '--github-plan',
        '--plan-file',
        'missing-plan.json',
        '--unit',
        'ci',
      ],
      message: /GitHub plan mode does not accept --unit/,
    },
    {
      args: [
        '--github-plan',
        '--plan-file',
        'one.json',
        '--plan-file',
        'two.json',
      ],
      message: /Duplicate option: --plan-file/,
    },
    {
      args: ['--github-admit', '--plan-file', 'missing-plan.json'],
      message: /GitHub admission mode requires --unit/,
    },
    {
      args: ['--github-admit', '--unit', '-h'],
      message: /Missing value for --unit/,
    },
    {
      args: [
        '--github-admit',
        '--unit',
        'ci',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--evidence',
        'evidence.json',
      ],
      message: /GitHub admission mode does not accept --evidence/,
    },
    {
      args: ['--github-run-test-lane', '--plan-file', 'missing-plan.json'],
      message: /GitHub test-lane mode requires --unit/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--plan-file',
        'missing-plan.json',
      ],
      message: /GitHub test-lane materialization mode requires --unit/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--plan-file',
        'missing-plan.json',
      ],
      message: /GitHub test-lane materialization mode requires --case/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--case',
        'shard-01-of-04',
        '--lane',
        'vitest',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--output-file',
        'vitest.config.mts',
        '--report-file',
        'report.json',
      ],
      message:
        /GitHub test-lane materialization mode does not accept --report-file/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--case',
        'shard-01-of-04',
        '--lane',
        'vitest',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--output-file',
        'first.config.mts',
        '--output-file',
        'second.config.mts',
      ],
      message: /Duplicate option: --output-file/,
    },
    {
      args: ['--github-receipt', '--plan-file', 'missing-plan.json'],
      message: /GitHub receipt mode requires --unit/,
    },
    {
      args: [
        '--github-receipt',
        '--unit',
        'ci',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--job-status',
        'success',
        '--evidence',
        'evidence.json',
        '--evidence',
        'evidence.json',
      ],
      message: /Duplicate value for --evidence: evidence\.json/,
    },
    {
      args: ['--github-reconcile', '--plan-file', 'missing-plan.json'],
      message: /GitHub reconciliation mode requires --receipt-dir/,
    },
    {
      args: [
        '--github-reconcile',
        '--plan-file',
        'missing-plan.json',
        '--receipt-dir',
        'receipts',
        '--case',
        'actions',
      ],
      message: /GitHub reconciliation mode does not accept --case/,
    },
  ];

  for (const { args, message } of invalid) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, message, JSON.stringify(args));
    assert.doesNotMatch(
      result.stderr,
      /Hosted GitHub mode requires GitHub Actions|Missing hosted GitHub plan|ENOENT/,
      JSON.stringify(args)
    );
  }
});

test('CLI materialization mode accepts only its complete bounded option set', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const result = spawnSync(
    process.execPath,
    [
      cli,
      '--github-materialize-test-lane',
      '--unit',
      'ci-unit-test',
      '--case',
      'shard-01-of-04',
      '--lane',
      'vitest',
      '--plan-file',
      'missing-plan.json',
      '--expected-plan-sha256',
      'a'.repeat(64),
      '--receipt-dir',
      'receipts',
      '--output-file',
      'vitest.config.mts',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing hosted GitHub plan/);
  assert.doesNotMatch(result.stderr, /does not accept|requires --/);
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
      assert.match(readFileSync(step.args[0], 'utf8'), /maxWorkers: 4/);
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
      (
        await executePlan(plan, {
          executor,
          stdout: sink,
          stderr: sink,
          workers: 4,
        })
      ).get('vitest').total,
      1
    );
    assert.equal(existsSync(directory), false);
    await assert.rejects(
      executePlan(plan, { workers: 0 }),
      /sealed native worker budget/
    );
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

test('duplicate Vitest ownership or failed report cannot become a passing gate', async () => {
  const f = fixture();
  try {
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
    const file = { name: join(f.directory, 'src/component.test.ts') };
    for (const [report, expected] of [
      [
        {
          numTotalTests: 2,
          numPassedTests: 2,
          numFailedTests: 0,
          testResults: [file, file],
        },
        /excluded or added files/,
      ],
      [
        {
          numTotalTests: 1,
          numPassedTests: 0,
          numFailedTests: 1,
          testResults: [file],
        },
        /failed tests/,
      ],
      [
        {
          numTotalTests: 1,
          numPassedTests: 2,
          numFailedTests: 0,
          testResults: [file],
        },
        /Invalid Vitest/,
      ],
    ]) {
      await assert.rejects(
        executePlan(plan, {
          stdout: sink,
          stderr: sink,
          executor: async (step) => {
            writeFileSync(step.args[1].split('=')[1], JSON.stringify(report));
            return '';
          },
        }),
        expected
      );
    }
  } finally {
    f.cleanup();
  }
});

test('native receipts separate streams, preserve full byte hashes and retain owned logs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-native-logs-'));
  try {
    const stdoutLog = join(directory, 'stdout.log'),
      stderrLog = join(directory, 'stderr.log');
    const receipt = await runCommand(
      {
        id: 'structured',
        name: 'structured fixture',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("stdout data"); process.stderr.write("stderr data");',
        ],
      },
      {
        root,
        env: process.env,
        stdout: sink,
        stderr: sink,
        receipt: true,
        maxCaptureBytes: 6,
        logDirectory: directory,
        stdoutLog,
        stderrLog,
      }
    );
    assert.equal(receipt.id, 'structured');
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.stdout, 't data');
    assert.equal(receipt.stderr, 'r data');
    assert.equal(receipt.stdoutTruncated, true);
    assert.equal(readFileSync(stdoutLog, 'utf8'), 'stdout data');
    assert.equal(readFileSync(stderrLog, 'utf8'), 'stderr data');
    assert.equal(
      receipt.stdoutSha256,
      createHash('sha256').update('stdout data').digest('hex')
    );
    assert.equal(
      receipt.stderrSha256,
      createHash('sha256').update('stderr data').digest('hex')
    );
    assert.ok(receipt.wallMs >= 0);
    assert.equal(receipt.lifecycle.completed, true);
    assert.equal(receipt.lifecycle.cleanupVerified, true);
    await assert.rejects(
      runCommand(
        { command: process.execPath, args: [] },
        { root, logDirectory: directory, stdoutLog }
      ),
      /EEXIST/
    );
    await assert.rejects(
      runCommand(
        { command: process.execPath, args: [] },
        { root, logDirectory: root, stdoutLog: join(root, 'no-source-log') }
      ),
      /unsafe/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failure, spawn failure, timeout and pre-abort attach truthful incomplete process receipts', async () => {
  const options = {
    root,
    env: process.env,
    stdout: sink,
    stderr: sink,
    receipt: true,
    terminationGraceMs: 50,
  };
  await assert.rejects(
    runCommand(
      {
        id: 'failed',
        name: 'failed',
        command: process.execPath,
        args: ['-e', 'console.error("native failure"); process.exit(9);'],
      },
      options
    ),
    (error) =>
      error.exitCode === 9 &&
      error.receipt.status === 'failed' &&
      error.receipt.stderr.includes('native failure')
  );
  await assert.rejects(
    runCommand(
      {
        id: 'missing',
        command: join(tmpdir(), 'seerrng-missing-native-command'),
        args: [],
      },
      options
    ),
    (error) =>
      error.receipt.status === 'incomplete' &&
      error.receipt.lifecycle.spawned === false &&
      error.receipt.lifecycle.completed === false
  );
  await assert.rejects(
    runCommand(
      {
        id: 'timeout',
        name: 'timeout',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000);'],
      },
      { ...options, timeoutMs: 30 }
    ),
    (error) =>
      error.receipt.timedOut &&
      error.receipt.status === 'timed-out' &&
      error.receipt.lifecycle.cleanupVerified
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCommand(
      { id: 'never-spawned', command: process.execPath, args: [] },
      { ...options, signal: controller.signal }
    ),
    (error) => error.receipt.aborted && !error.receipt.lifecycle.spawned
  );
  await assert.rejects(
    runCommand(
      { command: process.execPath, args: [] },
      { ...options, timeoutMs: 0 }
    ),
    /Invalid process/
  );
});

test('managed readiness and owned server stop reuse native runner without claiming a passed test', async () => {
  const handle = startCommand(
    {
      id: 'managed',
      name: 'managed',
      command: process.execPath,
      args: [
        '-e',
        'console.log("server started"); setInterval(() => {}, 1000);',
      ],
    },
    {
      root,
      env: process.env,
      stdout: sink,
      stderr: sink,
      terminationGraceMs: 100,
    }
  );
  const ready = await handle.waitForReady(
    async ({ pid }) => pid === handle.pid,
    { timeoutMs: 1000, pollMs: 10 }
  );
  assert.equal(ready.ready, true);
  const stopped = await handle.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.lifecycle.cleanupVerified, true);
  assert.equal(await handle.exit, stopped);
  assert.equal(await handle.stop(), stopped);
});

test('managed premature exit, health failure and readiness timeout fail and drain the owned process', async () => {
  const options = {
    root,
    env: process.env,
    stdout: sink,
    stderr: sink,
    terminationGraceMs: 50,
  };
  for (const mode of ['exit', 'health-failure', 'readiness-timeout']) {
    const handle = startCommand(
      {
        id: mode,
        name: mode,
        command: process.execPath,
        args: [
          '-e',
          mode === 'exit' ? 'process.exit(2)' : 'setInterval(() => {}, 1000)',
        ],
      },
      options
    );
    await assert.rejects(
      handle.waitForReady(
        async () => {
          if (mode === 'health-failure') throw new Error('health failure');
          return false;
        },
        { timeoutMs: mode === 'exit' ? 1000 : 40, pollMs: 5 }
      ),
      /before readiness|health failure|readiness timed out/
    );
    const receipt = await handle.exit;
    assert.equal(receipt.lifecycle.cleanupVerified, true);
    assert.notEqual(receipt.status, 'passed');
  }
});

test(
  'POSIX owned descendant cleanup failure cannot be labelled successful',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      runCommand(
        {
          id: 'orphaned-descendant',
          name: 'orphaned descendant',
          command: process.execPath,
          args: [
            '-e',
            'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}).unref();',
          ],
        },
        {
          root,
          env: process.env,
          stdout: sink,
          stderr: sink,
          receipt: true,
          terminationGraceMs: 50,
        }
      ),
      (error) =>
        error.receipt.status === 'incomplete' &&
        error.preserveTemporary === true &&
        /descendants|termination/.test(error.message)
    );
  }
);
