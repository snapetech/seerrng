// Copyright (c) snapetech and SeerrNG contributors.
// Deterministic test ownership for the existing GitHub-native command jobs.
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

const TEST_ROOTS = Object.freeze([
  'server',
  'src',
  'bin',
  'scripts',
  'deploy',
  'packaging',
  'cypress',
  'playwright',
  'gen-docs',
]);
const TEST_FILE = /\.(?:(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)|cy\.[jt]sx?)$/;
const VITEST_TEST = /^(?:server\/.+\.test\.ts|src\/.+\.test\.tsx?)$/;
const MJS_TEST = /\.(?:test|spec)\.mjs$/;
const CYPRESS_SPEC = /^cypress\/e2e\/.+\.cy\.[jt]sx?$/;
const PLAYWRIGHT_SPEC = /^playwright\/.+\.spec\.[jt]sx?$/;
const DOCS_SECURITY_TEST = 'gen-docs/scripts/image-size-security.test.mjs';
const TOOLING_GROUPS = Object.freeze(['portableTests', 'posixOnlyTests']);
const VITEST_INCLUDE = Object.freeze([
  'server/**/*.test.ts',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'src/**/*.vitest.test.ts',
]);
const VITEST_EXCLUDE = Object.freeze(['node_modules/**', 'dist/**']);

const slash = (value) => value.split(path.sep).join('/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
};
const stableJson = (value) => JSON.stringify(canonical(value));

function compactExecutableSource(source) {
  let compact = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      compact += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      compact += character;
      continue;
    }
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index + 2);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0)
        throw new Error('Unterminated block comment in hosted test input');
      index = end + 1;
      continue;
    }
    if (!/\s/.test(character)) compact += character;
  }
  if (quote) throw new Error('Unterminated string in hosted test input');
  return compact;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function checkedFile(root, file) {
  const absolute = path.resolve(root, file);
  if (!inside(root, absolute))
    throw new Error(`Missing hosted inventory input: ${file}`);
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    throw new Error(`Unsafe hosted inventory input: ${file}`, {
      cause: error,
    });
  }
  try {
    const before = fstatSync(descriptor);
    const sameFile = (left, right) =>
      left.isFile() &&
      right.isFile() &&
      ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => left[key] === right[key]
      );
    let checked;
    try {
      checked = lstatSync(absolute);
    } catch (error) {
      throw new Error(`Hosted inventory input changed before read: ${file}`, {
        cause: error,
      });
    }
    if (checked.isSymbolicLink() || !sameFile(checked, before))
      throw new Error(`Hosted inventory input changed before read: ${file}`);
    const bytes = readFileSync(descriptor);
    let afterPath;
    try {
      afterPath = lstatSync(absolute);
    } catch (error) {
      throw new Error(`Hosted inventory input changed during read: ${file}`, {
        cause: error,
      });
    }
    if (
      !sameFile(fstatSync(descriptor), before) ||
      afterPath.isSymbolicLink() ||
      !sameFile(afterPath, before) ||
      bytes.length !== before.size
    )
      throw new Error(`Hosted inventory input changed during read: ${file}`);
    return { absolute, bytes };
  } finally {
    closeSync(descriptor);
  }
}

function moduleSpecifiers(source) {
  const modules = new Set();
  let index = 0;
  const skipTrivia = () => {
    while (index < source.length) {
      if (/\s/.test(source[index])) {
        index += 1;
        continue;
      }
      if (source[index] === '/' && source[index + 1] === '/') {
        const end = source.indexOf('\n', index + 2);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source[index] === '/' && source[index + 1] === '*') {
        const end = source.indexOf('*/', index + 2);
        if (end < 0)
          throw new Error('Unterminated block comment in hosted test input');
        index = end + 2;
        continue;
      }
      break;
    }
  };
  const consume = (match) => {
    modules.add(match.at(-1));
    index += match[0].length;
    while (/\s/.test(source[index] ?? '')) index += 1;
    if (source[index] === ';') index += 1;
  };
  while (index < source.length) {
    skipTrivia();
    const rest = source.slice(index);
    if (/^import\s*\(/.test(rest)) break;
    if (/^import\b/.test(rest)) {
      const sideEffect = /^import\s*(['"])([^'"\r\n]+)\1\s*;?/.exec(rest);
      const from = /^import\b[\s\S]*?\bfrom\s*(['"])([^'"\r\n]+)\1\s*;?/.exec(
        rest
      );
      const match = sideEffect
        ? [sideEffect[0], sideEffect[2]]
        : from
          ? [from[0], from[2]]
          : null;
      if (!match)
        throw new Error('Unsupported import declaration in hosted test input');
      consume(match);
      continue;
    }
    if (/^export\b/.test(rest)) {
      const from = /^export\b[\s\S]*?\bfrom\s*(['"])([^'"\r\n]+)\1\s*;?/.exec(
        rest
      );
      if (!from) break;
      consume([from[0], from[2]]);
      continue;
    }
    const requireDeclaration =
      /^(?:const|let|var)\b[^;\r\n]*?\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)[^;\r\n]*;?/.exec(
        rest
      );
    if (requireDeclaration) {
      consume([requireDeclaration[0], requireDeclaration[2]]);
      continue;
    }
    break;
  }
  return modules;
}

function declaredFramework(source, file) {
  const modules = moduleSpecifiers(source);
  const native = modules.has('node:test');
  const vitest = [...modules].some((name) => /^vitest(?:\/|$)/.test(name));
  if (native && vitest) throw new Error(`Mixed test frameworks: ${file}`);
  if (!native && !vitest) throw new Error(`Unclassified test file: ${file}`);
  return native ? 'node:test' : 'vitest';
}

function literalArray(source, name) {
  const declaration = new RegExp(`\\bconst\\s+${name}\\s*=\\s*\\[`, 'g');
  const matches = [...source.matchAll(declaration)];
  if (matches.length !== 1)
    throw new Error(`Expected one literal tooling array: ${name}`);
  const start = matches[0].index + matches[0][0].length;
  let index = start;
  let quote = null;
  let escaped = false;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === ']') break;
  }
  if (index === source.length || quote)
    throw new Error(`Unterminated literal tooling array: ${name}`);
  const body = source.slice(start, index);
  const values = [];
  let cursor = 0;
  while (cursor < body.length) {
    while (/[\s,]/.test(body[cursor] ?? '')) cursor += 1;
    if (cursor >= body.length) break;
    const delimiter = body[cursor];
    if (delimiter !== "'" && delimiter !== '"')
      throw new Error(`Non-literal tooling registration in ${name}`);
    cursor += 1;
    let value = '';
    for (; cursor < body.length && body[cursor] !== delimiter; cursor += 1) {
      if (body[cursor] === '\\')
        throw new Error(`Escaped tooling path requires review in ${name}`);
      value += body[cursor];
    }
    if (body[cursor] !== delimiter)
      throw new Error(`Unterminated tooling path in ${name}`);
    cursor += 1;
    values.push(value);
    while (/\s/.test(body[cursor] ?? '')) cursor += 1;
    if (cursor < body.length && body[cursor] !== ',')
      throw new Error(`Unsupported tooling array syntax in ${name}`);
  }
  if (!values.length) throw new Error(`Empty tooling registration: ${name}`);
  return values;
}

function toolingRegistry(root) {
  const { bytes } = checkedFile(root, 'bin/run-tooling-tests.mjs');
  const source = bytes.toString('utf8');
  const groups = Object.fromEntries(
    TOOLING_GROUPS.map((name) => [name, literalArray(source, name)])
  );
  const all = TOOLING_GROUPS.flatMap((name) => groups[name]);
  if (new Set(all).size !== all.length)
    throw new Error('Duplicate hosted tooling test registration');
  const compact = compactExecutableSource(source);
  const selection =
    /consttests=process\.platform===["']win32["']\?portableTests:\[\.\.\.portableTests,\.\.\.posixOnlyTests\];/.test(
      compact
    );
  const invocation =
    /spawnSync\(process\.execPath,\[["']--test["'],["']--test-reporter=tap["'],`--test-concurrency=\$\{workers\}`,\.\.\.tests,?\],\{/.test(
      compact
    );
  if (
    !/import\{spawnSync\}from["']node:child_process["'];/.test(compact) ||
    !selection ||
    !invocation ||
    [...compact.matchAll(/\bspawnSync\(/g)].length !== 1
  )
    throw new Error('Hosted tooling execution binding drift');
  return {
    groups,
    files: new Set(all),
    sha256: sha256(bytes),
  };
}

function validateNativeBindings(root) {
  const packageInput = checkedFile(root, 'package.json');
  const packageJson = JSON.parse(packageInput.bytes.toString('utf8'));
  const expectedScripts = {
    'security:council':
      'node scripts/check-workflow-boundaries.mjs && pnpm test:tooling && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh',
    'test:ci':
      'vitest run --reporter=default --reporter=junit --outputFile.junit=report.xml',
    'test:tooling': 'node bin/run-tooling-tests.mjs',
    'test:playwright': 'pnpm cypress:prepare && playwright test',
  };
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== expected)
      throw new Error(`Hosted native command drift: ${name}`);
  }
  const configInput = checkedFile(root, 'vitest.config.mts');
  const config = configInput.bytes.toString('utf8');
  const includes = literalArray(config, 'include');
  if (stableJson(includes) !== stableJson(VITEST_INCLUDE))
    throw new Error('Hosted Vitest include ownership drift');
  const excludes = literalArray(config, 'exclude');
  if (stableJson(excludes) !== stableJson(VITEST_EXCLUDE))
    throw new Error('Hosted Vitest exclude ownership drift');
  const compactConfig = compactExecutableSource(config);
  if (
    !/import\{engineVitestProjects\}from["']\.\/tools\/validation-engine\/runtime\/vitest-binding\.mjs["'];/.test(
      compactConfig
    ) ||
    !/projects:engineVitestProjects\(\{include,exclude,workers:capacity\.configuredWorkers,?\}\)/.test(
      compactConfig
    ) ||
    [...compactConfig.matchAll(/\bengineVitestProjects\(/g)].length !== 1
  )
    throw new Error('Hosted Vitest engine project binding drift');
  if (
    !/['"]node:test['"]\s*:\s*resolve\(projectRoot,\s*['"]server\/test\/vitestNodeTest\.ts['"]\)/.test(
      config
    )
  )
    throw new Error('Hosted Vitest node:test adapter binding drift');
  checkedFile(root, 'server/test/vitestNodeTest.ts');

  const docsPackageInput = checkedFile(root, 'gen-docs/package.json');
  const docsPackageJson = JSON.parse(docsPackageInput.bytes.toString('utf8'));
  if (
    docsPackageJson.scripts?.['test:security'] !==
    'node --test scripts/image-size-security.test.mjs'
  )
    throw new Error('Hosted native command drift: gen-docs:test:security');

  const cypressConfigInput = checkedFile(root, 'cypress.config.ts');
  const cypressConfig = cypressConfigInput.bytes.toString('utf8');
  if (
    !/\bdefineConfig\s*\(/.test(cypressConfig) ||
    !/\be2e\s*:/.test(cypressConfig) ||
    /\b(?:specPattern|excludeSpecPattern)\s*:/.test(cypressConfig)
  )
    throw new Error('Hosted Cypress native discovery binding drift');

  const playwrightConfigInput = checkedFile(root, 'playwright.config.ts');
  const playwrightConfig = playwrightConfigInput.bytes.toString('utf8');
  if (
    !/\bdefineConfig\s*\(/.test(playwrightConfig) ||
    !/\btestDir\s*:\s*['"]\.\/playwright['"]/.test(playwrightConfig) ||
    !/\bfullyParallel\s*:\s*false/.test(playwrightConfig) ||
    !/\bworkers\s*:\s*1/.test(playwrightConfig) ||
    !/\bcommand\s*:\s*['"]pnpm cypress:start['"]/.test(playwrightConfig) ||
    !/process\.env\.CONFIG_DIRECTORY/.test(playwrightConfig) ||
    !/process\.env\.PORT/.test(playwrightConfig) ||
    !/process\.env\.PLAYWRIGHT_BASE_URL/.test(playwrightConfig) ||
    !/\bCONFIG_DIRECTORY\s*:\s*configDirectory\b/.test(playwrightConfig) ||
    !/\bPORT\s*:\s*port\b/.test(playwrightConfig) ||
    /\.\.\.\s*process\.env/.test(playwrightConfig) ||
    /\b(?:testMatch|testIgnore)\s*:/.test(playwrightConfig)
  )
    throw new Error('Hosted Playwright native discovery binding drift');

  return {
    packageSha256: sha256(packageInput.bytes),
    vitestConfigSha256: sha256(configInput.bytes),
    genDocsPackageSha256: sha256(docsPackageInput.bytes),
    cypressConfigSha256: sha256(cypressConfigInput.bytes),
    playwrightConfigSha256: sha256(playwrightConfigInput.bytes),
  };
}

function discoveredFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name)
    )) {
      const absolute = path.join(directory, entry.name);
      const file = slash(path.relative(root, absolute));
      if (['node_modules', '.git', 'dist', '.next'].includes(entry.name))
        continue;
      if (entry.isSymbolicLink())
        throw new Error(`Symlink in hosted test discovery scope: ${file}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && TEST_FILE.test(entry.name)) files.push(file);
    }
  };
  for (const directory of TEST_ROOTS) {
    const absolute = path.join(root, directory);
    if (
      !existsSync(absolute) ||
      lstatSync(absolute).isSymbolicLink() ||
      !lstatSync(absolute).isDirectory()
    )
      throw new Error(`Missing or unsafe hosted test scope: ${directory}`);
    visit(absolute);
  }
  if (!files.length) throw new Error('Hosted test discovery selected no files');
  return files.sort(compareText);
}

function lane(id, runner, command, files, environment) {
  if (!files.length) throw new Error(`Hosted test lane is empty: ${id}`);
  return { id, runner, command, environment, files };
}

export function assertHostedTestInventory(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
    throw new Error('Hosted test inventory object is required');
  const expectedKeys = [
    'counts',
    'cypressConfigSha256',
    'entries',
    'genDocsPackageSha256',
    'inventorySha256',
    'lanes',
    'packageSha256',
    'platform',
    'playwrightConfigSha256',
    'registrySha256',
    'roots',
    'schemaVersion',
    'vitestConfigSha256',
  ];
  if (
    stableJson(Object.keys(inventory).sort()) !==
    stableJson(expectedKeys.sort())
  )
    throw new Error('Hosted test inventory schema fields are not canonical');
  if (
    inventory.schemaVersion !== 3 ||
    inventory.platform !== 'linux' ||
    stableJson(inventory.roots) !== stableJson(TEST_ROOTS)
  )
    throw new Error('Unsupported hosted test inventory schema');
  for (const field of [
    'inventorySha256',
    'registrySha256',
    'packageSha256',
    'vitestConfigSha256',
    'genDocsPackageSha256',
    'cypressConfigSha256',
    'playwrightConfigSha256',
  ]) {
    if (!/^[a-f0-9]{64}$/.test(inventory[field] ?? ''))
      throw new Error(`Invalid hosted test inventory digest: ${field}`);
  }
  const countKeys = [
    'total',
    'vitest',
    'tooling',
    'nodeTestMjs',
    'docsSecurity',
    'cypress',
    'playwright',
  ];
  if (
    stableJson(Object.keys(inventory.counts ?? {}).sort()) !==
      stableJson([...countKeys].sort()) ||
    countKeys.some(
      (key) =>
        !Number.isSafeInteger(inventory.counts[key]) ||
        inventory.counts[key] < 1
    ) ||
    inventory.counts.total !==
      inventory.counts.vitest +
        inventory.counts.tooling +
        inventory.counts.nodeTestMjs +
        inventory.counts.docsSecurity +
        inventory.counts.cypress +
        inventory.counts.playwright
  )
    throw new Error('Invalid hosted test inventory counts');
  if (
    !Array.isArray(inventory.entries) ||
    inventory.entries.length !== inventory.counts.total
  )
    throw new Error('Hosted test inventory entry count mismatch');
  const owners = new Map([
    ['vitest', 'package:test:ci'],
    ['tooling', 'package:security:council->test:tooling'],
    ['node-test-mjs', 'engine-native-node-test'],
    ['docs-security', 'gen-docs:test:security'],
    ['cypress', 'cypress-io/github-action'],
    ['playwright', 'package:test:playwright'],
  ]);
  const files = new Set();
  const actualCounts = {
    vitest: 0,
    tooling: 0,
    nodeTestMjs: 0,
    docsSecurity: 0,
    cypress: 0,
    playwright: 0,
  };
  let previous = '';
  for (const entry of inventory.entries) {
    const expectedEntryKeys = [
      'bytes',
      'executionBinding',
      'file',
      'framework',
      'owner',
      'sourceSha256',
      ...(entry.owner === 'tooling' ? ['toolingGroup'] : []),
    ].sort();
    if (
      !entry ||
      stableJson(Object.keys(entry).sort()) !== stableJson(expectedEntryKeys) ||
      typeof entry.file !== 'string' ||
      entry.file.includes('\\') ||
      /[\x00-\x1f]/.test(entry.file) ||
      !TEST_ROOTS.includes(entry.file.split('/')[0]) ||
      entry.file
        .split('/')
        .some((segment) => !segment || segment === '.' || segment === '..') ||
      entry.file <= previous ||
      files.has(entry.file) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256 ?? '') ||
      !['node:test', 'vitest', 'cypress', 'playwright'].includes(
        entry.framework
      ) ||
      !owners.has(entry.owner)
    )
      throw new Error(
        `Invalid or non-canonical hosted test inventory entry: ${entry?.file ?? '(missing file)'}`
      );
    if (
      entry.owner === 'vitest'
        ? entry.executionBinding !==
          (entry.framework === 'node:test'
            ? 'repository-native-node-test-adapter'
            : 'package:test:ci')
        : entry.executionBinding !== owners.get(entry.owner)
    )
      throw new Error(`Hosted execution binding mismatch: ${entry.file}`);
    if (
      entry.owner === 'tooling' &&
      !TOOLING_GROUPS.includes(entry.toolingGroup)
    )
      throw new Error(`Hosted tooling group mismatch: ${entry.file}`);
    // Cypress Action transports explicit specs as one comma-delimited value.
    const laneFileMatches =
      entry.owner === 'vitest'
        ? VITEST_TEST.test(entry.file) &&
          ['node:test', 'vitest'].includes(entry.framework)
        : entry.owner === 'cypress'
          ? CYPRESS_SPEC.test(entry.file) &&
            !entry.file.includes(',') &&
            entry.framework === 'cypress'
          : entry.owner === 'playwright'
            ? PLAYWRIGHT_SPEC.test(entry.file) &&
              entry.framework === 'playwright'
            : entry.owner === 'docs-security'
              ? entry.file === DOCS_SECURITY_TEST &&
                entry.framework === 'node:test'
              : MJS_TEST.test(entry.file) && entry.framework === 'node:test';
    if (!laneFileMatches)
      throw new Error(`Hosted test lane file mismatch: ${entry.file}`);
    previous = entry.file;
    files.add(entry.file);
    actualCounts[
      entry.owner === 'node-test-mjs'
        ? 'nodeTestMjs'
        : entry.owner === 'docs-security'
          ? 'docsSecurity'
          : entry.owner
    ] += 1;
  }
  if (
    [
      'vitest',
      'tooling',
      'nodeTestMjs',
      'docsSecurity',
      'cypress',
      'playwright',
    ].some((key) => actualCounts[key] !== inventory.counts[key])
  )
    throw new Error('Hosted test inventory owner counts mismatch');
  if (
    !Array.isArray(inventory.lanes) ||
    stableJson(inventory.lanes.map(({ id }) => id)) !==
      stableJson([
        'vitest',
        'tooling',
        'node-test-mjs',
        'docs-security',
        'cypress',
        'playwright',
      ])
  )
    throw new Error('Hosted test lane schema mismatch');
  const commandByLane = {
    vitest: { program: 'pnpm', args: ['test:ci'] },
    tooling: { program: 'pnpm', args: ['security:council'] },
    'docs-security': {
      program: 'pnpm',
      args: ['test:security'],
      cwd: 'gen-docs',
    },
    cypress: { program: 'cypress', args: ['run'] },
    playwright: { program: 'playwright', args: ['test'] },
  };
  const environmentByLane = {
    vitest: 'existing-node-24-linux-job',
    tooling: 'existing-node-24-linux-posix-job',
    'node-test-mjs': 'existing-node-24-linux-job',
    'docs-security': 'existing-test-docs-ubuntu-job',
    cypress: 'existing-cypress-ubuntu-job',
    playwright: 'existing-node-24-ubuntu-browser-job',
  };
  const runnerByLane = {
    vitest: 'vitest',
    tooling: 'node:test',
    'node-test-mjs': 'node:test',
    'docs-security': 'node:test',
    cypress: 'cypress-io/github-action',
    playwright: '@playwright/test',
  };
  const laneFiles = [];
  for (const entryLane of inventory.lanes) {
    if (
      stableJson(Object.keys(entryLane).sort()) !==
        stableJson(
          ['command', 'environment', 'files', 'id', 'runner'].sort()
        ) ||
      !Array.isArray(entryLane.files) ||
      !entryLane.files.length ||
      entryLane.runner !== runnerByLane[entryLane.id] ||
      entryLane.environment !== environmentByLane[entryLane.id]
    )
      throw new Error(`Hosted test lane is empty: ${entryLane.id}`);
    const expected = inventory.entries
      .filter((entry) => entry.owner === entryLane.id)
      .map((entry) => entry.file);
    if (stableJson(entryLane.files) !== stableJson(expected))
      throw new Error(`Hosted test lane ownership mismatch: ${entryLane.id}`);
    const expectedCommand =
      entryLane.id === 'node-test-mjs'
        ? {
            program: 'node',
            args: [
              '--test',
              '--test-isolation=none',
              '--test-concurrency=1',
              '--test-reporter=tap',
              '<file>',
            ],
            pool: {
              partition: 'one-file-per-process',
              maxWorkers: '<workers>',
            },
          }
        : commandByLane[entryLane.id];
    if (stableJson(entryLane.command) !== stableJson(expectedCommand))
      throw new Error(`Hosted native command mismatch: ${entryLane.id}`);
    laneFiles.push(...entryLane.files);
  }
  if (
    laneFiles.length !== files.size ||
    new Set(laneFiles).size !== files.size ||
    laneFiles.some((file) => !files.has(file))
  )
    throw new Error('Hosted test lanes do not close the inventory');
  const { inventorySha256, ...payload } = inventory;
  if (sha256(stableJson(payload)) !== inventorySha256)
    throw new Error('Hosted test inventory canonical hash mismatch');
  return inventory;
}

export function createHostedTestInventory(root, { platform = 'linux' } = {}) {
  if (platform !== 'linux')
    throw new Error('Hosted test inventory requires the existing Linux jobs');
  root = realpathSync(root);
  const tooling = toolingRegistry(root);
  const bindings = validateNativeBindings(root);
  const toolingGroups = new Map(
    TOOLING_GROUPS.flatMap((group) =>
      tooling.groups[group].map((file) => [file, group])
    )
  );
  if (tooling.files.has(DOCS_SECURITY_TEST))
    throw new Error(
      `Duplicate hosted native test ownership: ${DOCS_SECURITY_TEST}`
    );
  const entries = discoveredFiles(root).map((file) => {
    const input = checkedFile(root, file);
    const source = input.bytes.toString('utf8');
    let framework;
    if (CYPRESS_SPEC.test(file)) framework = 'cypress';
    else if (PLAYWRIGHT_SPEC.test(file)) framework = 'playwright';
    else
      try {
        framework = declaredFramework(source, file);
      } catch (error) {
        if (/^(?:Mixed|Unclassified) test/.test(error.message)) throw error;
        throw new Error(`${error.message}: ${file}`, { cause: error });
      }
    const topLevel = file.split('/')[0];
    let owner;
    let executionBinding;
    let toolingGroup;
    if (file === DOCS_SECURITY_TEST) {
      if (framework !== 'node:test')
        throw new Error(`Incompatible hosted docs test: ${file}`);
      owner = 'docs-security';
      executionBinding = 'gen-docs:test:security';
    } else if (CYPRESS_SPEC.test(file)) {
      owner = 'cypress';
      executionBinding = 'cypress-io/github-action';
    } else if (PLAYWRIGHT_SPEC.test(file)) {
      owner = 'playwright';
      executionBinding = 'package:test:playwright';
    } else if (tooling.files.has(file)) {
      if (!MJS_TEST.test(file) || framework !== 'node:test')
        throw new Error(`Incompatible hosted tooling test: ${file}`);
      owner = 'tooling';
      toolingGroup = toolingGroups.get(file);
      executionBinding = 'package:security:council->test:tooling';
    } else if (VITEST_TEST.test(file)) {
      owner = 'vitest';
      executionBinding =
        framework === 'node:test'
          ? 'repository-native-node-test-adapter'
          : 'package:test:ci';
    } else if (
      MJS_TEST.test(file) &&
      ['server', 'src'].includes(topLevel) &&
      framework === 'node:test'
    ) {
      owner = 'node-test-mjs';
      executionBinding = 'engine-native-node-test';
    } else throw new Error(`Unclassified hosted test ownership: ${file}`);
    return {
      file,
      bytes: input.bytes.length,
      sourceSha256: sha256(input.bytes),
      framework,
      owner,
      executionBinding,
      ...(toolingGroup ? { toolingGroup } : {}),
    };
  });
  const discovered = new Set(entries.map((entry) => entry.file));
  for (const file of [...tooling.files].sort()) {
    if (!discovered.has(file))
      throw new Error(`Registered tooling test is missing: ${file}`);
  }
  const filesFor = (owner) =>
    entries.filter((entry) => entry.owner === owner).map((entry) => entry.file);
  const lanes = [
    lane(
      'vitest',
      'vitest',
      { program: 'pnpm', args: ['test:ci'] },
      filesFor('vitest'),
      'existing-node-24-linux-job'
    ),
    lane(
      'tooling',
      'node:test',
      { program: 'pnpm', args: ['security:council'] },
      filesFor('tooling'),
      'existing-node-24-linux-posix-job'
    ),
    lane(
      'node-test-mjs',
      'node:test',
      {
        program: 'node',
        args: [
          '--test',
          '--test-isolation=none',
          '--test-concurrency=1',
          '--test-reporter=tap',
          '<file>',
        ],
        pool: {
          partition: 'one-file-per-process',
          maxWorkers: '<workers>',
        },
      },
      filesFor('node-test-mjs'),
      'existing-node-24-linux-job'
    ),
    lane(
      'docs-security',
      'node:test',
      { program: 'pnpm', args: ['test:security'], cwd: 'gen-docs' },
      filesFor('docs-security'),
      'existing-test-docs-ubuntu-job'
    ),
    lane(
      'cypress',
      'cypress-io/github-action',
      { program: 'cypress', args: ['run'] },
      filesFor('cypress'),
      'existing-cypress-ubuntu-job'
    ),
    lane(
      'playwright',
      '@playwright/test',
      { program: 'playwright', args: ['test'] },
      filesFor('playwright'),
      'existing-node-24-ubuntu-browser-job'
    ),
  ];
  const counts = Object.freeze({
    total: entries.length,
    vitest: filesFor('vitest').length,
    tooling: filesFor('tooling').length,
    nodeTestMjs: filesFor('node-test-mjs').length,
    docsSecurity: filesFor('docs-security').length,
    cypress: filesFor('cypress').length,
    playwright: filesFor('playwright').length,
  });
  const payload = {
    schemaVersion: 3,
    platform,
    roots: [...TEST_ROOTS],
    counts,
    entries,
    lanes,
    registrySha256: tooling.sha256,
    packageSha256: bindings.packageSha256,
    vitestConfigSha256: bindings.vitestConfigSha256,
    genDocsPackageSha256: bindings.genDocsPackageSha256,
    cypressConfigSha256: bindings.cypressConfigSha256,
    playwrightConfigSha256: bindings.playwrightConfigSha256,
  };
  const inventory = Object.freeze({
    ...payload,
    inventorySha256: sha256(stableJson(payload)),
  });
  assertHostedTestInventory(inventory);
  return inventory;
}

export function verifyHostedTestInventory(
  root,
  sealed,
  { platform = 'linux' } = {}
) {
  assertHostedTestInventory(sealed);
  const actual = createHostedTestInventory(root, { platform });
  if (actual.inventorySha256 !== sealed.inventorySha256)
    throw new Error(
      `Hosted test inventory drift: expected ${sealed.inventorySha256}, got ${actual.inventorySha256}`
    );
  return actual;
}
