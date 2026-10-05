import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
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
import { stripVTControlCharacters } from 'node:util';

const roots = ['server', 'src', 'bin', 'scripts', 'deploy', 'packaging'];
const candidate = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const prefix = 'seerrng-local-validation-';
export const expectedPackageBindings = Object.freeze({
  test: 'vitest run',
  'validate:development': 'node bin/run-local-validation.mjs',
  prebuild: 'pnpm i18n:check && pnpm current-batch:check',
  build: 'pnpm build:all',
  'build:all': 'run-p build:next build:server',
  'build:compile': 'run-p build:next:compile build:server:compile',
  'build:server:compile':
    'tsc --project server/tsconfig.json && copyfiles -u 2 server/templates/**/*.{html,pug} dist/templates && copyfiles -u 2 "server/i18n/locale/*.json" dist/i18n && tsc-alias -p server/tsconfig.json && node scripts/replace-server-import-aliases.mjs dist',
  'build:next:compile': 'next build --webpack',
  'build:server':
    'tsc --project server/tsconfig.json && copyfiles -u 2 server/templates/**/*.{html,pug} dist/templates && copyfiles -u 2 "server/i18n/locale/*.json" dist/i18n && tsc-alias -p server/tsconfig.json && node scripts/replace-server-import-aliases.mjs dist',
  'build:next': 'next build --webpack',
  dev: "nodemon -e ts,json,yml --watch server --watch seerr-api.yml --exec 'ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/index.ts'",
  'dev:checked': 'pnpm dev',
  'dev:server':
    "nodemon -e ts,json,yml --watch server --watch seerr-api.yml --exec 'ts-node -r tsconfig-paths/register --files --project server/tsconfig.json server/index.ts'",
  'test:node': 'node server/test/index.mts',
  'test:vitest': 'vitest run',
  'test:tooling': 'node bin/run-tooling-tests.mjs',
  'test:ci':
    'vitest run --reporter=default --reporter=junit --outputFile.junit=report.xml',
});
const slash = (path) => path.split(sep).join('/');
const inside = (parent, child) => {
  const path = relative(parent, child);
  return (
    path !== '' &&
    !path.startsWith(`..${sep}`) &&
    path !== '..' &&
    !isAbsolute(path)
  );
};

export function loadTypeScript(root) {
  return createRequire(join(root, 'package.json'))('typescript');
}

export function validatePackageBindings(packageJson) {
  const scripts = packageJson.scripts || {};
  for (const [name, expected] of Object.entries(expectedPackageBindings)) {
    if (scripts[name] !== expected)
      throw new Error(
        `Local validation binding drift: ${name} must be ${JSON.stringify(expected)}`
      );
  }
  for (const name of [
    'build:server:compile',
    'build:next:compile',
    'dev:server',
  ]) {
    if (
      typeof scripts[name] !== 'string' ||
      !scripts[name].trim() ||
      /validate:development|run-local-validation|pnpm (?:build|dev)(?:\s|$)/.test(
        scripts[name]
      )
    ) {
      throw new Error(
        `Missing or recursive internal compile/development command: ${name}`
      );
    }
  }
}

export function validateGovernanceSources(agents, hook) {
  for (const route of [
    'docs/maintainers/ui-style-standard.md',
    'docs/maintainers/ui-fix-it.md',
    'docs/maintainers/ui-forward-merge-guide.md',
    'tools/validation-engine/README.md',
  ]) {
    if (!agents.includes(route))
      throw new Error(
        `AGENTS.md is missing the required development route: ${route}`
      );
  }
  const commands = hook
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const required = [
    '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?',
    'pnpm exec lint-staged || exit $?',
  ];
  if (JSON.stringify(commands) !== JSON.stringify(required))
    throw new Error(
      'Commit hook must preserve attribution and lint-staged checks; the comprehensive development gate remains an explicit command'
    );
}

export function preflight(
  root,
  {
    testsOnly = false,
    inherited = process.env,
    nodeVersion = process.version,
  } = {}
) {
  const require = createRequire(join(root, 'package.json'));
  const packageJson = JSON.parse(
    readFileSync(requireFile(root, 'package.json'), 'utf8')
  );
  let semver;
  try {
    semver = require('semver');
  } catch {
    throw new Error(
      'Missing installed semver dependency; restore the project dependencies before validation'
    );
  }
  if (
    !packageJson.engines?.node ||
    !semver.satisfies(nodeVersion, packageJson.engines.node)
  )
    throw new Error(
      `Node ${nodeVersion} does not satisfy package engines ${packageJson.engines?.node || '(missing)'}; select the supported installed runtime`
    );
  const agent = inherited.npm_config_user_agent;
  if (agent) {
    const version = /(?:^|\s)pnpm\/([^\s]+)/.exec(agent)?.[1];
    if (
      !version ||
      !packageJson.engines?.pnpm ||
      !semver.satisfies(version, packageJson.engines.pnpm)
    )
      throw new Error(
        `Use pnpm satisfying package engines ${packageJson.engines?.pnpm || '(missing)'}, not ${agent.split(' ')[0]}`
      );
  }
  for (const name of [
    'typescript',
    'vitest',
    'ts-node',
    'tsconfig-paths',
    '@swc/core',
    ...(testsOnly ? [] : ['eslint', 'next', 'prettier']),
  ]) {
    const wanted =
      packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
    let installed;
    try {
      installed = require(`${name}/package.json`).version;
    } catch {
      throw new Error(
        `Missing installed ${name}; restore project dependencies before validation (no automatic install)`
      );
    }
    if (!wanted || !semver.satisfies(installed, wanted))
      throw new Error(
        `Installed ${name} ${installed} does not satisfy package ${wanted || '(missing declaration)'}`
      );
  }
  if (!testsOnly) {
    for (const file of [
      'AGENTS.md',
      '.husky/pre-commit',
      'docs/maintainers/ui-style-standard.md',
      'docs/maintainers/ui-fix-it.md',
      'docs/maintainers/ui-forward-merge-guide.md',
      'tools/validation-engine/README.md',
    ])
      requireFile(root, file);
    validateGovernanceSources(
      readFileSync(join(root, 'AGENTS.md'), 'utf8'),
      readFileSync(join(root, '.husky/pre-commit'), 'utf8')
    );
    validatePackageBindings(packageJson);
  }
}

export function frameworkOf(source, file, ts) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = new Set();
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.add(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    )
      imports.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const native = imports.has('node:test');
  const vitest =
    [...imports].some((name) => /^vitest(?:\/|$)/.test(name)) ||
    /\.vitest\.test\.[cm]?tsx?$/.test(file);
  if (native && vitest) throw new Error(`Mixed test frameworks: ${file}`);
  if (!native && !vitest) throw new Error(`Unclassified test file: ${file}`);
  return vitest ? 'vitest' : /\.[cm]?jsx?$/.test(file) ? 'node-js' : 'node-ts';
}

export function toolingOwnership(source, ts) {
  const tree = ts.createSourceFile(
    'run-tooling-tests.mjs',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const arrays = new Map();
  let selection;
  let invocation = false;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'tests'
    ) {
      selection = node.initializer
        ?.getText(tree)
        .replace(/\s/g, '')
        .replace(/"/g, "'");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'spawnSync'
    ) {
      const argumentsText = node.arguments
        .slice(0, 2)
        .map((argument) =>
          argument.getText(tree).replace(/\s/g, '').replace(/"/g, "'")
        );
      invocation ||=
        argumentsText[0] === 'process.execPath' &&
        argumentsText[1] === "['--test',...tests]";
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ['portableTests', 'posixOnlyTests'].includes(node.name.text)
    ) {
      if (
        !node.initializer ||
        !ts.isArrayLiteralExpression(node.initializer) ||
        node.initializer.elements.some((entry) => !ts.isStringLiteral(entry))
      ) {
        throw new Error(
          `Unsupported tooling ownership declaration: ${node.name.text}`
        );
      }
      if (arrays.has(node.name.text))
        throw new Error('Duplicate tooling ownership declaration');
      arrays.set(
        node.name.text,
        node.initializer.elements.map((entry) => entry.text)
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (
    arrays.size !== 2 ||
    [...arrays.values()].some((files) => files.length === 0)
  )
    throw new Error('Missing tooling ownership inventory');
  const entries = [
    ...arrays.get('portableTests'),
    ...arrays.get('posixOnlyTests'),
  ];
  if (new Set(entries).size !== entries.length)
    throw new Error('Duplicate tooling test ownership');
  if (
    selection !==
      "process.platform==='win32'?portableTests:[...portableTests,...posixOnlyTests]" ||
    !invocation
  )
    throw new Error(
      'Unsupported tooling execution selection; review ownership before running'
    );
  return arrays;
}

function requireFile(root, file) {
  const absolute = resolve(root, file);
  if (
    !inside(root, absolute) ||
    !existsSync(absolute) ||
    !lstatSync(absolute).isFile() ||
    lstatSync(absolute).size === 0 ||
    !inside(root, realpathSync(absolute))
  ) {
    throw new Error(`Missing, empty or unsafe required file: ${file}`);
  }
  return absolute;
}

export function discoverTests(
  root,
  { platform = process.platform, ts = loadTypeScript(root) } = {}
) {
  root = realpathSync(root);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.next'].includes(entry.name))
        continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          `Symlink in test discovery scope: ${slash(relative(root, absolute))}`
        );
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && candidate.test(entry.name)) {
        const file = slash(relative(root, absolute));
        const framework = frameworkOf(readFileSync(absolute, 'utf8'), file, ts);
        files.push({ file, framework, owner: framework, selected: true });
      }
    }
  };
  for (const directory of roots) {
    const absolute = join(root, directory);
    if (
      !existsSync(absolute) ||
      lstatSync(absolute).isSymbolicLink() ||
      !lstatSync(absolute).isDirectory()
    )
      throw new Error(`Missing or unsafe test scope: ${directory}`);
    visit(absolute);
  }
  if (files.length === 0) throw new Error('No test files discovered');
  const runner = requireFile(root, 'bin/run-tooling-tests.mjs');
  const ownership = toolingOwnership(readFileSync(runner, 'utf8'), ts);
  for (const [kind, owned] of ownership) {
    for (const file of owned) {
      const test = files.find((entry) => entry.file === file);
      if (!test || test.framework !== 'node-js')
        throw new Error(`Missing or incompatible tooling test: ${file}`);
      test.owner = 'tooling';
      test.selected = platform !== 'win32' || kind === 'portableTests';
      if (!test.selected)
        test.exclusion =
          'Existing POSIX-only tooling suite; mandatory on Linux';
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

export function chunkArguments(files, maxCharacters = 20_000) {
  const chunks = [];
  let chunk = [],
    size = 0;
  for (const file of files) {
    if (file.length + 3 > maxCharacters)
      throw new Error(`Test path exceeds argument budget: ${file}`);
    if (size + file.length + 3 > maxCharacters && chunk.length) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(file);
    size += file.length + 3;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function createPlan(
  root,
  { testsOnly = false, platform = process.platform, ts } = {}
) {
  root = realpathSync(root);
  const inventory = discoverTests(root, {
    platform,
    ts: ts || loadTypeScript(root),
  });
  const steps = [];
  const add = (name, args, kind = 'check') =>
    steps.push({ name, command: process.execPath, args, kind });
  const required = (file) => requireFile(root, file);
  if (!testsOnly) {
    for (const [name, file] of [
      ['Translations', 'bin/check-i18n.js'],
      ['Current batch contract', 'bin/check-current-batch-contract.js'],
      ['Shared visual standard', 'bin/check-refreshed-ui-style.js'],
      ['Formatting', 'bin/run-prettier.mjs'],
    ])
      add(name, [
        required(file),
        ...(name === 'Formatting' ? ['--check'] : []),
      ]);
    add('Lint', [
      required('node_modules/eslint/bin/eslint.js'),
      './server/**/*.{ts,tsx}',
      './src/**/*.{ts,tsx}',
      'bin/local-validation.mjs',
      'bin/local-validation.test.mjs',
      'bin/run-local-validation.mjs',
    ]);
    const tsc = required('node_modules/typescript/bin/tsc');
    required('server/tsconfig.json');
    required('tsconfig.json');
    add('Server types', [tsc, '--project', 'server/tsconfig.json', '--noEmit']);
    add('Client route types', [
      required('node_modules/next/dist/bin/next'),
      'typegen',
    ]);
    add('Client types', [tsc, '--noEmit']);
  }
  for (const owner of ['vitest', 'node-ts', 'node-js', 'tooling']) {
    const files = inventory
      .filter((entry) => entry.owner === owner && entry.selected)
      .map((entry) => entry.file);
    if (!files.length)
      throw new Error(`Unexpected zero-test execution lane: ${owner}`);
    if (owner === 'vitest') {
      const configs = [
        'vitest.config.mts',
        'vitest.config.ts',
        'vitest.config.mjs',
        'vitest.config.js',
      ].filter((file) => existsSync(join(root, file)));
      if (configs.length !== 1)
        throw new Error('Expected exactly one supported Vitest configuration');
      add(
        'Vitest',
        [
          required('node_modules/vitest/vitest.mjs'),
          'run',
          '--config',
          '<temporary-vitest-config>',
          '--reporter=default',
          '--reporter=json',
          '--outputFile.json=<temporary-vitest-report>',
        ],
        owner
      );
      steps.at(-1).files = files;
      steps.at(-1).config = required(configs[0]);
    } else if (owner === 'tooling') {
      add(
        'Platform-aware tooling',
        [required('bin/run-tooling-tests.mjs')],
        owner
      );
      steps.at(-1).files = files;
    } else {
      const chunks = chunkArguments(files);
      for (let i = 0; i < chunks.length; i++) {
        const args =
          owner === 'node-ts'
            ? [
                required('server/test/index.mts'),
                '--test-reporter',
                'tap',
                ...chunks[i],
              ]
            : [
                '--test',
                '--test-concurrency=1',
                '--test-reporter=tap',
                ...chunks[i],
              ];
        add(
          `${owner === 'node-ts' ? 'Native TypeScript' : 'Node JavaScript'} ${i + 1}/${chunks.length}`,
          args,
          owner
        );
        steps.at(-1).files = chunks[i];
      }
    }
  }
  return { root, platform, testsOnly, inventory, steps };
}

export function isolatedEnvironment(directory, inherited = process.env) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) {
    if (
      /^(?:DB_|DATABASE_|TS_NODE_|NODE_OPTIONS$|VITEST$|CONFIG_DIRECTORY$|CI$)/.test(
        key
      )
    )
      delete env[key];
  }
  return {
    ...env,
    NODE_ENV: 'test',
    CONFIG_DIRECTORY: directory,
    ALLOW_NETWORK: 'false',
    SEERR_TEST_FAIL_ON_NETWORK: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

export function removeOwnedTemporaryDirectory(directory, parent = tmpdir()) {
  const absolute = resolve(directory),
    temporaryParent = realpathSync(parent);
  if (
    dirname(absolute) !== resolve(parent) ||
    !basename(absolute).startsWith(prefix) ||
    !inside(temporaryParent, realpathSync(absolute)) ||
    lstatSync(absolute).isSymbolicLink()
  ) {
    throw new Error(`Refusing unsafe temporary cleanup: ${directory}`);
  }
  rmSync(absolute, { recursive: true, force: true });
}

export function vitestConfigSource(config, root, files) {
  return `import original from ${JSON.stringify(pathToFileURL(config).href)};\nexport default async (environment) => {\n const base = await (typeof original === 'function' ? original(environment) : original);\n if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('Unsupported Vitest config');\n if (base.test?.projects?.length) throw new Error('Vitest projects need explicit ownership');\n return {...base, root: ${JSON.stringify(root)}, test: {...base.test, include: ${JSON.stringify(files)}, passWithNoTests: false}};\n};\n`;
}

export function testCount(output) {
  const plain = stripVTControlCharacters(output);
  const tests = [...plain.matchAll(/(?:^|\n)(?:#|ℹ) tests (\d+)\b/g)];
  const passes = [...plain.matchAll(/(?:^|\n)(?:#|ℹ) pass (\d+)\b/g)];
  const failures = [...plain.matchAll(/(?:^|\n)(?:#|ℹ) fail (\d+)\b/g)];
  if (!tests.length || !passes.length || !failures.length)
    throw new Error('Missing native test summary; refusing silent pass');
  return {
    total: tests.reduce((sum, match) => sum + Number(match[1]), 0),
    active: [...passes, ...failures].reduce(
      (sum, match) => sum + Number(match[1]),
      0
    ),
  };
}

export function runCommand(step, options) {
  return new Promise((complete, reject) => {
    let tail = '';
    let termination = Promise.resolve();
    let terminationError;
    let forceTermination;
    const child = spawn(step.command, step.args, {
      cwd: options.root,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const capture = (target) => (data) => {
      target.write(data);
      tail = (tail + data.toString()).slice(-2_000_000);
    };
    child.stdout.on('data', capture(options.stdout));
    child.stderr.on('data', capture(options.stderr));
    const interrupt = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        termination = new Promise((finished) => {
          const killer = spawn(
            join(
              process.env.SystemRoot || 'C:\\Windows',
              'System32',
              'taskkill.exe'
            ),
            ['/PID', String(child.pid), '/T', '/F'],
            { shell: false, windowsHide: true, stdio: 'ignore' }
          );
          killer.on('error', (error) => {
            terminationError = error;
            child.kill();
            finished();
          });
          killer.on('close', (status) => {
            if (status !== 0) {
              terminationError = new Error(
                'Unable to terminate the validation process tree'
              );
              child.kill();
            }
            finished();
          });
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
          forceTermination = setTimeout(() => {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if (error.code !== 'ESRCH') terminationError = error;
            }
          }, 5000);
          forceTermination.unref();
        } catch (error) {
          if (error.code !== 'ESRCH') {
            terminationError = error;
            child.kill();
          }
        }
      }
    };
    options.signal?.addEventListener('abort', interrupt, { once: true });
    if (options.signal?.aborted) interrupt();
    child.on('error', reject);
    child.on('close', async (status, signal) => {
      clearTimeout(forceTermination);
      options.signal?.removeEventListener('abort', interrupt);
      await termination;
      if (terminationError)
        reject(
          Object.assign(
            new Error(
              `Validation interrupted; child cleanup uncertain: ${terminationError.message}`
            ),
            { preserveTemporary: true }
          )
        );
      else if (options.signal?.aborted)
        reject(new Error('Validation interrupted'));
      else if (status !== 0)
        reject(
          Object.assign(
            new Error(`${step.name} failed (${signal || status})`),
            { exitCode: status || 1 }
          )
        );
      else complete(tail);
    });
  });
}

export async function executePlan(
  plan,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    inherited = process.env,
    executor = runCommand,
    signal,
  } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const env = isolatedEnvironment(directory, inherited);
  const totals = new Map();
  let preserveTemporary = false;
  try {
    for (const original of plan.steps) {
      if (signal?.aborted) throw new Error('Validation interrupted');
      const step = { ...original, args: [...original.args] };
      const report = join(directory, 'vitest-report.json');
      if (step.kind === 'vitest') {
        const config = join(directory, 'vitest.config.mjs');
        writeFileSync(
          config,
          vitestConfigSource(step.config, plan.root, step.files),
          { flag: 'wx' }
        );
        step.args = step.args.map((arg) =>
          arg
            .replace('<temporary-vitest-config>', config)
            .replace('<temporary-vitest-report>', report)
        );
      }
      stdout.write(`\n[${step.name}]\n`);
      const output = await executor(step, {
        root: plan.root,
        env,
        stdout,
        stderr,
        signal,
      });
      if (step.kind !== 'check') {
        let count;
        if (step.kind === 'vitest') {
          const result = JSON.parse(readFileSync(report, 'utf8'));
          count = {
            total: result.numTotalTests,
            active: result.numPassedTests + result.numFailedTests,
          };
          if (!Number.isInteger(count.total) || !Number.isInteger(count.active))
            throw new Error('Invalid Vitest test summary');
          const actual = new Set(
            (result.testResults || []).map((entry) =>
              slash(relative(plan.root, resolve(plan.root, entry.name)))
            )
          );
          if (
            actual.size !== step.files.length ||
            step.files.some((file) => !actual.has(file))
          )
            throw new Error(
              'Vitest excluded or added files outside its discovered ownership; refusing partial success'
            );
        } else count = testCount(output);
        const previous = totals.get(step.kind) || { total: 0, active: 0 };
        totals.set(step.kind, {
          total: previous.total + count.total,
          active: previous.active + count.active,
        });
      }
    }
    for (const [kind, count] of totals) {
      if (count.total <= 0 || count.active <= 0)
        throw new Error(`Unexpected zero active tests: ${kind}`);
    }
    if (!totals.size) throw new Error('No test lanes executed');
    return totals;
  } catch (error) {
    preserveTemporary = error.preserveTemporary === true;
    if (preserveTemporary)
      stderr.write(
        `Temporary validation files retained because child cleanup is uncertain: ${directory}\n`
      );
    throw error;
  } finally {
    if (!preserveTemporary) removeOwnedTemporaryDirectory(directory);
  }
}

export function printPlan(
  plan,
  output = process.stdout,
  { details = true } = {}
) {
  output.write(
    `Local ${plan.testsOnly ? 'test' : 'validation'} gate: ${plan.root}\n`
  );
  output.write(
    'Isolation: fresh temporary CONFIG_DIRECTORY, NODE_ENV=test; no dependency installation.\n'
  );
  output.write(
    'Existing HTTP/HTTPS test guards reject external requests; this is not an OS network sandbox.\n'
  );
  for (const owner of ['vitest', 'node-ts', 'node-js', 'tooling']) {
    const owned = plan.inventory.filter((entry) => entry.owner === owner);
    output.write(
      `${owner}: ${owned.filter((entry) => entry.selected).length} files selected, ${owned.filter((entry) => !entry.selected).length} existing platform exclusions\n`
    );
  }
  if (details) {
    for (const entry of plan.inventory)
      output.write(
        `${entry.selected ? 'RUN' : 'PLATFORM-SKIP'} ${entry.owner} ${entry.file}${entry.exclusion ? ` (${entry.exclusion})` : ''}\n`
      );
    for (const step of plan.steps)
      output.write(
        `${step.name}: ${JSON.stringify([step.command, ...step.args])}\n`
      );
  }
}
