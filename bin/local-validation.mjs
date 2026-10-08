import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
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
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { detectWorkerCapacity } from '../tools/validation-engine/runtime/cpu-capacity.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createDistributedNativeCaseLedger,
  isExplicitlySkippedDistributedNativeCaseLedger,
} from '../tools/validation-engine/runtime/distributed-native-case-ledger.mjs';

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

function normalizedMarkdownSection(source, heading) {
  const lines = source.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1)
    throw new Error(`Governance source is missing section: ${heading}`);
  const next = lines.findIndex(
    (line, index) => index > start && /^##\s+/.test(line)
  );
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateGovernanceSources(agents, hook, contributing) {
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
  const authority = normalizedMarkdownSection(
    agents,
    'Communication and authority'
  );
  const verification = normalizedMarkdownSection(
    agents,
    'Required verification'
  );
  const aiAssistance = normalizedMarkdownSection(contributing, 'AI Assistance');
  for (const [name, source, rule] of [
    [
      'AGENTS.md Communication and authority',
      authority,
      'Do not make project-owner or other human acceptance a merge or release gate when the maintainer explicitly directs the work to proceed.',
    ],
    [
      'AGENTS.md Communication and authority',
      authority,
      'Act on explicit user instructions without asking for the same authorization again.',
    ],
    [
      'AGENTS.md Communication and authority',
      authority,
      "Ask only when a material decision is genuinely unresolved or an action falls outside the user's authorization.",
    ],
    [
      'AGENTS.md Required verification',
      verification,
      'Visual inspection is evidence, not a merge or release gate when the maintainer explicitly directs the work to proceed.',
    ],
    [
      'CONTRIBUTING.md AI Assistance',
      aiAssistance,
      'Maintainers may authorize and accept AI-assisted work without a separate human-review gate.',
    ],
    [
      'CONTRIBUTING.md AI Assistance',
      aiAssistance,
      'An explicit maintainer direction to merge or release supplies that authorization; do not require a second confirmation that the same work was reviewed.',
    ],
  ]) {
    if (!source.includes(rule))
      throw new Error(`${name} must preserve: ${rule}`);
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
      'CONTRIBUTING.md',
      '.husky/pre-commit',
      'docs/maintainers/ui-style-standard.md',
      'docs/maintainers/ui-fix-it.md',
      'docs/maintainers/ui-forward-merge-guide.md',
      'tools/validation-engine/README.md',
    ])
      requireFile(root, file);
    validateGovernanceSources(
      readFileSync(join(root, 'AGENTS.md'), 'utf8'),
      readFileSync(join(root, '.husky/pre-commit'), 'utf8'),
      readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8')
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
  let invocations = 0;
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
      invocations += 1;
      const argumentsText = node.arguments
        .slice(0, 2)
        .map((argument) =>
          argument.getText(tree).replace(/\s/g, '').replace(/"/g, "'")
        );
      invocation =
        argumentsText[0] === 'process.execPath' &&
        new Set([
          "['--test','--test-reporter=tap',`--test-concurrency=${workers}`,...tests]",
          "['--test','--test-reporter=tap',`--test-concurrency=${workers}`,...tests,]",
        ]).has(argumentsText[1]);
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
    !invocation ||
    invocations !== 1
  )
    throw new Error(
      'Unsupported tooling execution selection; review ownership before running'
    );
  return arrays;
}

export function validateDependencyReference(
  root,
  reference,
  {
    platform = process.platform,
    mountInfo = platform === 'linux'
      ? readFileSync('/proc/self/mountinfo', 'utf8')
      : '',
  } = {}
) {
  if (
    !reference ||
    reference.readonlyProof?.verified !== true ||
    platform !== 'linux'
  )
    throw new Error('An actual read-only dependency reference is required');
  const dependencyRoot = realpathSync(reference.root);
  if (realpathSync(join(root, 'node_modules')) !== dependencyRoot)
    throw new Error(
      'Dependency reference does not match the selected source link'
    );
  const mounts = mountInfo
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(
      (parts) =>
        parts[4] &&
        (dependencyRoot === parts[4].replaceAll('\\040', ' ') ||
          inside(parts[4].replaceAll('\\040', ' '), dependencyRoot))
    )
    .sort((a, b) => b[4].length - a[4].length);
  if (!mounts[0]?.[5].split(',').includes('ro'))
    throw new Error('Dependency reference is not actually mounted read-only');
  const sourceLock = createHash('sha256')
    .update(readFileSync(join(root, 'pnpm-lock.yaml')))
    .digest('hex');
  const installedLock = createHash('sha256')
    .update(readFileSync(join(dependencyRoot, '.pnpm', 'lock.yaml')))
    .digest('hex');
  if (sourceLock !== reference.lockSha256 || installedLock !== sourceLock)
    throw new Error('Read-only dependency reference lockfile mismatch');
  return dependencyRoot;
}

function requireFile(root, file, dependencyRoot) {
  const absolute = resolve(root, file);
  if (
    !inside(root, absolute) ||
    !existsSync(absolute) ||
    !lstatSync(absolute).isFile() ||
    lstatSync(absolute).size === 0 ||
    !(
      inside(root, realpathSync(absolute)) ||
      (dependencyRoot &&
        file.startsWith('node_modules/') &&
        inside(dependencyRoot, realpathSync(absolute)))
    )
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
  {
    testsOnly = false,
    platform = process.platform,
    ts,
    canonicalTypescript = false,
    dependencyReference,
  } = {}
) {
  root = realpathSync(root);
  const inventory = discoverTests(root, {
    platform,
    ts: ts || loadTypeScript(root),
  });
  if (typeof canonicalTypescript !== 'boolean')
    throw new Error('Explicit canonical TypeScript binding is required');
  if (canonicalTypescript) {
    const config = readFileSync(requireFile(root, 'vitest.config.mts'), 'utf8');
    requireFile(root, 'server/test/vitestNodeTest.ts');
    if (
      !/['"]node:test['"]\s*:\s*resolve\(projectRoot,\s*['"]server\/test\/vitestNodeTest\.ts['"]\)/.test(
        config
      )
    )
      throw new Error(
        'Canonical execution requires the repository native node:test adapter'
      );
    for (const entry of inventory) {
      if (entry.owner === 'node-ts') {
        entry.originalOwner = entry.owner;
        entry.owner = 'vitest';
        entry.executionBinding = 'repository-native-node-test-adapter';
      }
    }
  }
  const steps = [];
  const add = (name, args, kind = 'check') =>
    steps.push({ name, command: process.execPath, args, kind });
  const dependencyRoot = dependencyReference
    ? validateDependencyReference(root, dependencyReference)
    : undefined;
  const required = (file) => requireFile(root, file, dependencyRoot);
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
    if (canonicalTypescript && owner === 'node-ts') continue;
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
  return { root, platform, testsOnly, canonicalTypescript, inventory, steps };
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

export function vitestConfigSource(
  config,
  root,
  files,
  workers = detectWorkerCapacity({ sourceRoot: root }).configuredWorkers,
  cacheDirectory
) {
  const binding = new URL(
    '../tools/validation-engine/runtime/vitest-binding.mjs',
    import.meta.url
  ).href;
  return `import original from ${JSON.stringify(pathToFileURL(config).href)};
import { engineVitestProjects, isEngineVitestProjects } from ${JSON.stringify(binding)};
export default async (environment) => {
 const base = await (typeof original === 'function' ? original(environment) : original);
 if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('Unsupported Vitest config');
 if (base.test?.projects?.length && !isEngineVitestProjects(base.test.projects)) throw new Error('Vitest projects need explicit ownership');
 const test = {...base.test};
 // Vite concatenates inherited arrays. Root includes would broaden both
 // child projects and execute some files twice instead of partitioning them.
 delete test.include; delete test.exclude; delete test.projects;
 return {...base, root: ${JSON.stringify(root)}, ${cacheDirectory ? `cacheDir: ${JSON.stringify(cacheDirectory)},` : ''} test: {...test, maxWorkers: ${JSON.stringify(workers)}, projects: engineVitestProjects({ files: ${JSON.stringify(files)}, exclude: base.test?.exclude ?? ['node_modules/**', 'dist/**'], workers: ${JSON.stringify(workers)} }), passWithNoTests: false}};
};
`;
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

function processError(receipt) {
  const message = !receipt.lifecycle.cleanupVerified
    ? `Validation interrupted; child cleanup uncertain: ${receipt.lifecycle.cleanupError}`
    : receipt.aborted
      ? 'Validation interrupted'
      : receipt.timedOut
        ? `${receipt.name} timed out`
        : `${receipt.name} failed (${receipt.signal || receipt.exitCode || receipt.spawnError || 'incomplete'})`;
  return Object.assign(new Error(message), {
    receipt,
    exitCode: receipt.exitCode || 1,
    preserveTemporary: !receipt.lifecycle.cleanupVerified,
  });
}

function commandLog(file, directory, sourceRoot) {
  if (file === undefined) return null;
  if (!directory || !isAbsolute(directory) || !isAbsolute(file))
    throw new Error('Persistent native logs need absolute owned log paths');
  const parent = realpathSync(directory),
    absolute = resolve(file);
  if (
    parent === resolve(sourceRoot) ||
    inside(resolve(sourceRoot), parent) ||
    !inside(parent, absolute) ||
    dirname(absolute) !== parent ||
    lstatSync(directory).isSymbolicLink()
  )
    throw new Error('Refusing unsafe or source-owned native log path');
  // Exclusive creation refuses an existing file or symlink; never overwrite logs.
  return { path: absolute, fd: openSync(absolute, 'wx', 0o600) };
}

// Both short checks and long-lived disposable servers share this owned runner.
export function startCommand(step, options = {}) {
  const root = options.root ?? step.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout,
    stderr = options.stderr ?? process.stderr;
  const maxCaptureBytes = options.maxCaptureBytes ?? 2_000_000;
  const graceMs = options.terminationGraceMs ?? 5000;
  for (const [name, value] of [
    ['maxCaptureBytes', maxCaptureBytes],
    ['terminationGraceMs', graceMs],
    ...(options.timeoutMs === undefined
      ? []
      : [['timeoutMs', options.timeoutMs]]),
  ])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid process ${name}`);
  if (options.signal?.aborted)
    throw Object.assign(
      new Error('Validation interrupted before child spawn'),
      {
        receipt: {
          id: step.id ?? step.name,
          aborted: true,
          lifecycle: {
            spawned: false,
            completed: false,
            cleanupVerified: true,
          },
        },
      }
    );
  const logs = {};
  try {
    logs.stdout = commandLog(options.stdoutLog, options.logDirectory, root);
    logs.stderr = commandLog(options.stderrLog, options.logDirectory, root);
  } catch (error) {
    for (const log of Object.values(logs)) if (log) closeSync(log.fd);
    throw error;
  }
  const startedAt = new Date().toISOString(),
    started = performance.now();
  let child;
  try {
    child = spawn(step.command, step.args, {
      cwd: root,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    for (const log of Object.values(logs)) if (log) closeSync(log.fd);
    throw error;
  }
  const capture = {
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
  let tail = '',
    spawnError = null,
    cleanupError = null,
    aborted = false,
    timedOut = false,
    stopped = false,
    settled = false;
  let termination = null,
    timeout,
    receipt;
  const delay = (milliseconds) =>
    new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
  const groupExists = () => {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const terminate = () => {
    if (termination) return termination;
    termination = (async () => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          await new Promise((resolveKill, rejectKill) => {
            const killer = spawn(
              join(
                process.env.SystemRoot || 'C:\\Windows',
                'System32',
                'taskkill.exe'
              ),
              ['/PID', String(child.pid), '/T', '/F'],
              { shell: false, windowsHide: true, stdio: 'ignore' }
            );
            killer.once('error', rejectKill);
            killer.once('close', (status) =>
              status === 0
                ? resolveKill()
                : rejectKill(
                    new Error('Unable to terminate the validation process tree')
                  )
            );
          });
        } else {
          if (!groupExists()) return;
          process.kill(-child.pid, 'SIGTERM');
          const deadline = performance.now() + graceMs;
          while (groupExists() && performance.now() < deadline)
            await delay(Math.min(25, graceMs));
          if (groupExists()) process.kill(-child.pid, 'SIGKILL');
          const killDeadline = performance.now() + 1000;
          while (groupExists() && performance.now() < killDeadline)
            await delay(25);
          if (groupExists())
            throw new Error(
              'Owned process group still present after termination'
            );
        }
      } catch (error) {
        if (error.code !== 'ESRCH') {
          cleanupError = error.message;
          child.kill('SIGKILL');
        }
      }
    })();
    return termination;
  };
  const interrupt = () => {
    aborted = true;
    void terminate();
  };
  options.signal?.addEventListener('abort', interrupt, { once: true });
  if (options.signal?.aborted) interrupt();
  if (options.timeoutMs !== undefined)
    timeout = setTimeout(() => {
      timedOut = true;
      void terminate();
    }, options.timeoutMs);
  const receive = (stream, target) => (data) => {
    try {
      target.write(data);
      if (logs[stream]) {
        let offset = 0;
        while (offset < data.length)
          offset += writeSync(
            logs[stream].fd,
            data,
            offset,
            data.length - offset
          );
      }
      hashes[stream].update(data);
      capture[`${stream}Bytes`] += data.length;
      capture[stream] = Buffer.concat([capture[stream], data]).subarray(
        -maxCaptureBytes
      );
      tail = (tail + data.toString()).slice(-maxCaptureBytes);
    } catch (error) {
      cleanupError = `Native output capture failed: ${error.message}`;
      void terminate();
    }
  };
  child.stdout.on('data', receive('stdout', stdout));
  child.stderr.on('data', receive('stderr', stderr));
  const exit = new Promise((complete) => {
    child.once('error', (error) => {
      spawnError = error.message;
    });
    // A leader exiting does not prove its same-group descendants have stopped.
    child.once('exit', () => {
      if (process.platform !== 'win32' && child.pid && !termination) {
        try {
          if (groupExists()) {
            cleanupError =
              'Native command left running process-group descendants';
            void terminate();
          }
        } catch (error) {
          cleanupError = error.message;
          void terminate();
        }
      }
    });
    child.once('close', async (exitCode, signal) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', interrupt);
      await termination;
      for (const log of Object.values(logs))
        if (log) {
          try {
            closeSync(log.fd);
          } catch (error) {
            cleanupError ??= error.message;
          }
        }
      receipt = {
        id: step.id ?? step.name,
        name: step.name ?? step.id,
        pid: child.pid ?? null,
        exitCode,
        signal,
        aborted,
        timedOut,
        stopped,
        spawnError,
        startedAt,
        wallMs: performance.now() - started,
        stdout: capture.stdout.toString(),
        stderr: capture.stderr.toString(),
        output: tail,
        stdoutBytes: capture.stdoutBytes,
        stderrBytes: capture.stderrBytes,
        stdoutTruncated: capture.stdoutBytes > maxCaptureBytes,
        stderrTruncated: capture.stderrBytes > maxCaptureBytes,
        stdoutSha256: hashes.stdout.digest('hex'),
        stderrSha256: hashes.stderr.digest('hex'),
        stdoutLog: logs.stdout?.path ?? null,
        stderrLog: logs.stderr?.path ?? null,
        lifecycle: {
          spawned: child.pid !== undefined,
          completed: !spawnError,
          cleanupVerified: !cleanupError,
          cleanupError,
        },
      };
      receipt.status =
        cleanupError || spawnError
          ? 'incomplete'
          : aborted
            ? 'aborted'
            : timedOut
              ? 'timed-out'
              : stopped
                ? 'stopped'
                : exitCode === 0 && !signal
                  ? 'passed'
                  : 'failed';
      settled = true;
      complete(receipt);
    });
  });
  const handle = {
    pid: child.pid ?? null,
    exit,
    stop: async () => {
      if (!settled) {
        stopped = true;
        await terminate();
      }
      const result = await exit;
      if (!result.lifecycle.cleanupVerified) throw processError(result);
      return result;
    },
    waitForReady: async (health, { timeoutMs = 60_000, pollMs = 100 } = {}) => {
      if (
        typeof health !== 'function' ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        !Number.isSafeInteger(pollMs) ||
        pollMs < 1
      )
        throw new Error('Invalid managed process readiness contract');
      let readinessTimeout;
      const unavailable = exit.then((result) => {
        throw Object.assign(
          new Error(
            `Managed process exited before readiness (${result.status})`
          ),
          { receipt: result }
        );
      });
      const expiration = new Promise((_, rejectReady) => {
        readinessTimeout = setTimeout(
          () => rejectReady(new Error('Managed process readiness timed out')),
          timeoutMs
        );
      });
      const poll = async () => {
        while (!settled) {
          if (await health({ pid: handle.pid, signal: options.signal }))
            return {
              pid: handle.pid,
              ready: true,
              wallMs: performance.now() - started,
            };
          await delay(pollMs);
        }
        return unavailable;
      };
      try {
        return await Promise.race([poll(), unavailable, expiration]);
      } catch (error) {
        error.receipt = await handle.stop();
        throw error;
      } finally {
        clearTimeout(readinessTimeout);
      }
    },
  };
  return handle;
}

export async function runCommand(step, options = {}) {
  const receipt = await startCommand(step, options).exit;
  if (receipt.status !== 'passed') throw processError(receipt);
  return options.receipt === true ? receipt : receipt.output;
}

export async function executePlan(
  plan,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    inherited = process.env,
    executor = runCommand,
    signal,
    workers,
    collectFailures = false,
    caseLedgerObserver,
  } = {}
) {
  if (typeof collectFailures !== 'boolean')
    throw new Error('Internal failure collection must be explicit');
  if (
    caseLedgerObserver !== undefined &&
    typeof caseLedgerObserver !== 'function'
  )
    throw new Error('Native case-ledger observer must be a function');
  if (
    workers !== undefined &&
    (!Number.isSafeInteger(workers) || workers < 1 || workers > 256)
  )
    throw new Error('Invalid sealed native worker budget');
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const env = isolatedEnvironment(directory, inherited);
  const totals = new Map();
  const failures = [];
  const caseCoverage = new Map();
  let preserveTemporary = false;
  try {
    for (const original of plan.steps) {
      if (signal?.aborted) throw new Error('Validation interrupted');
      const step = { ...original, args: [...original.args] };
      if (step.kind === 'tooling' && workers !== undefined)
        step.args.push(`--workers=${workers}`);
      const report = join(directory, 'vitest-report.json');
      if (step.kind === 'vitest') {
        const config = join(directory, 'vitest.config.mjs');
        writeFileSync(
          config,
          vitestConfigSource(
            step.config,
            plan.root,
            step.files,
            workers,
            join(directory, 'vitest-cache')
          ),
          { flag: 'wx' }
        );
        step.args = step.args.map((arg) =>
          arg
            .replace('<temporary-vitest-config>', config)
            .replace('<temporary-vitest-report>', report)
        );
      }
      stdout.write(`\n[${step.name}]\n`);
      const executionResult = await executor(step, {
        root: plan.root,
        env,
        stdout,
        stderr,
        signal,
      });
      const output = collectFailures ? executionResult.output : executionResult;
      let nativeCount;
      if (collectFailures && step.kind !== 'check') {
        const receipt = executionResult.nativeReceipt,
          ledger = executionResult.caseLedger,
          counts = ledger?.counts;
        if (
          !receipt ||
          !['passed', 'failed'].includes(receipt.status) ||
          receipt.lifecycle?.completed !== true ||
          receipt.lifecycle?.cleanupVerified !== true ||
          receipt.aborted !== false ||
          receipt.timedOut !== false ||
          receipt.signal !== null ||
          receipt.spawnError ||
          !Number.isSafeInteger(receipt.exitCode) ||
          receipt.exitCode < 0 ||
          !counts ||
          !Object.values(counts).every(
            (value) => Number.isSafeInteger(value) && value >= 0
          ) ||
          !Array.isArray(ledger.cases) ||
          ledger.cases.length !==
            counts.passed + counts.failed + counts.skipped ||
          counts.passed + counts.failed < 1 ||
          (receipt.status === 'passed'
            ? receipt.exitCode !== 0 || counts.failed !== 0
            : receipt.exitCode === 0 || counts.failed < 1)
        )
          throw new Error(
            'Complete native case ledger required for internal failure collection'
          );
        nativeCount = {
          total: ledger.cases.length,
          active: counts.passed + counts.failed,
        };
        if (counts.failed)
          failures.push({ name: step.name, kind: step.kind, receipt, counts });
      }
      if (step.kind !== 'check') {
        let count;
        let vitestReport;
        let vitestReportBytes;
        if (step.kind === 'vitest') {
          vitestReportBytes = readFileSync(report);
          const result = JSON.parse(vitestReportBytes.toString('utf8'));
          vitestReport = result;
          count = {
            total: result.numTotalTests,
            active: result.numPassedTests + result.numFailedTests,
          };
          if (
            !Number.isSafeInteger(count.total) ||
            !Number.isSafeInteger(count.active) ||
            count.total < 0 ||
            count.active < 0 ||
            count.active > count.total
          )
            throw new Error('Invalid Vitest test summary');
          if (
            !collectFailures &&
            (result.numFailedTests > 0 || result.success === false)
          )
            throw new Error('Vitest report contains failed tests');
          if (
            collectFailures &&
            (result.success !==
              (executionResult.caseLedger.counts.failed === 0) ||
              count.total !== nativeCount.total ||
              count.active !== nativeCount.active)
          )
            throw new Error(
              'Vitest native failure/count closure is incomplete'
            );
          const actual = new Set(
            (result.testResults || []).map((entry) =>
              slash(relative(plan.root, resolve(plan.root, entry.name)))
            )
          );
          if (
            result.testResults?.length !== step.files.length ||
            actual.size !== step.files.length ||
            step.files.some((file) => !actual.has(file))
          )
            throw new Error(
              'Vitest excluded or added files outside its discovered ownership; refusing partial success'
            );
        } else count = testCount(output);
        if (caseLedgerObserver) {
          const ledger = createDistributedNativeCaseLedger({
            adapterId: step.kind,
            files: [...step.files].toSorted(),
            root: plan.root,
            stdout: output,
            vitestReport,
            vitestReportBytes,
          });
          if (
            ledger.counts.total !== count.total ||
            ledger.counts.active !== count.active
          )
            throw new Error(
              'Distributed native case ledger differs from execution totals'
            );
          caseLedgerObserver(ledger);
          const coverage = caseCoverage.get(step.kind) ?? {
            steps: 0,
            explicitlySkippedSteps: 0,
          };
          coverage.steps += 1;
          if (isExplicitlySkippedDistributedNativeCaseLedger(ledger))
            coverage.explicitlySkippedSteps += 1;
          caseCoverage.set(step.kind, coverage);
        }
        if (
          collectFailures &&
          (count.total !== nativeCount.total ||
            count.active !== nativeCount.active)
        )
          throw new Error('Native failure/count closure is incomplete');
        const previous = totals.get(step.kind) || { total: 0, active: 0 };
        totals.set(step.kind, {
          total: previous.total + count.total,
          active: previous.active + count.active,
        });
      }
    }
    for (const [kind, count] of totals) {
      const coverage = caseCoverage.get(kind);
      const allStepsExplicitlySkipped =
        coverage?.steps > 0 &&
        coverage.steps === coverage.explicitlySkippedSteps;
      if (count.total <= 0 || (count.active <= 0 && !allStepsExplicitlySkipped))
        throw new Error(`Unexpected zero active tests: ${kind}`);
    }
    if (!totals.size) throw new Error('No test lanes executed');
    if (collectFailures) totals.failures = failures;
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
