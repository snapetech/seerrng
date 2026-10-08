import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertHostedTestInventory,
  createHostedTestInventory,
  verifyHostedTestInventory,
} from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';

const repositoryRoot = path.resolve(
  fileURLToPath(new URL('..', import.meta.url))
);
const temporary = new Set();
const TEST_LIKE_FILE =
  /\.(?:(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)|cy\.[jt]sx?)$/;
const securityCouncil =
  'node scripts/check-workflow-boundaries.mjs && pnpm test:tooling && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh';

test.afterEach(() => {
  for (const directory of temporary)
    rmSync(directory, { recursive: true, force: true });
  temporary.clear();
});

function write(root, file, contents) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function repositoryTestFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        ['.git', '.next', 'build', 'dist', 'node_modules'].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink())
        continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && TEST_LIKE_FILE.test(entry.name))
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  };
  visit(root);
  return files.sort();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'hosted-test-inventory-'));
  temporary.add(root);
  for (const directory of [
    'server',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
    'cypress',
    'playwright',
    'gen-docs',
  ])
    mkdirSync(path.join(root, directory), { recursive: true });
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: {
        'security:council': securityCouncil,
        'test:ci':
          'vitest run --reporter=default --reporter=junit --outputFile.junit=report.xml',
        'test:tooling': 'node bin/run-tooling-tests.mjs',
        'test:playwright': 'pnpm cypress:prepare && playwright test',
      },
    })
  );
  write(
    root,
    'vitest.config.mts',
    `import { engineVitestProjects } from './tools/validation-engine/runtime/vitest-binding.mjs';
    const include = [
      'server/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.vitest.test.ts',
    ];
    const exclude = ['node_modules/**', 'dist/**'];
    const alias = {
      'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts'),
    };
    const config = {
      test: {
        projects: engineVitestProjects({
          include,
          exclude,
          workers: capacity.configuredWorkers,
        }),
      },
    };
    export { alias, config };
    `
  );
  write(root, 'server/test/vitestNodeTest.ts', 'export const test = true;\n');
  write(
    root,
    'gen-docs/package.json',
    JSON.stringify({
      scripts: {
        'test:security': 'node --test scripts/image-size-security.test.mjs',
      },
    })
  );
  write(
    root,
    'cypress.config.ts',
    "import { defineConfig } from 'cypress'; export default defineConfig({ e2e: {} });\n"
  );
  write(
    root,
    'playwright.config.ts',
    `import { defineConfig } from '@playwright/test';
     const port = process.env.PORT ?? '5055';
     const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? \`http://127.0.0.1:\${port}\`;
     const configDirectory = process.env.CONFIG_DIRECTORY ?? \`\${process.cwd()}/cypress/runtime-config\`;
     export default defineConfig({
       testDir: './playwright', fullyParallel: false, workers: 1,
       use: { baseURL },
       webServer: {
         command: 'pnpm cypress:start',
         url: \`\${baseURL}/login\`,
         env: { CONFIG_DIRECTORY: configDirectory, PORT: port },
       },
     });\n`
  );
  write(
    root,
    'bin/run-tooling-tests.mjs',
    `import { spawnSync } from 'node:child_process';
     const portableTests = ['bin/tool.test.mjs'];
     const posixOnlyTests = ['deploy/posix.test.mjs'];
     const tests = process.platform === 'win32'
       ? portableTests
       : [...portableTests, ...posixOnlyTests];
     const workers = 2;
     spawnSync(
       process.execPath,
       ['--test', '--test-reporter=tap', \`--test-concurrency=\${workers}\`, ...tests],
       { stdio: 'inherit' }
     );
    `
  );
  write(root, 'server/native.test.ts', "import test from 'node:test';\n");
  write(root, 'src/unit.test.tsx', "import { test } from 'vitest';\n");
  write(root, 'src/native.test.mjs', "import test from 'node:test';\n");
  write(root, 'server/native-two.test.mjs', "import test from 'node:test';\n");
  write(root, 'bin/tool.test.mjs', "import test from 'node:test';\n");
  write(root, 'deploy/posix.test.mjs', "import test from 'node:test';\n");
  write(
    root,
    'gen-docs/scripts/image-size-security.test.mjs',
    "import test from 'node:test';\n"
  );
  write(root, 'cypress/e2e/login.cy.ts', "describe('login', () => {});\n");
  write(
    root,
    'playwright/settings.spec.ts',
    "import { test } from '@playwright/test'; test('settings', async () => {});\n"
  );
  return root;
}

test('current repository has complete deterministic hosted ownership', () => {
  const inventory = createHostedTestInventory(repositoryRoot);
  const { total, ...ownerCounts } = inventory.counts;
  assert.equal(
    total,
    Object.values(ownerCounts).reduce((sum, count) => sum + count, 0)
  );
  assert.equal(
    new Set(inventory.entries.map(({ file }) => file)).size,
    inventory.counts.total
  );
  assert.deepEqual(
    inventory.lanes.flatMap(({ files }) => files).sort(),
    inventory.entries.map(({ file }) => file).sort()
  );
  assert.deepEqual(
    inventory.entries.map(({ file }) => file),
    repositoryTestFiles(repositoryRoot)
  );
  assert.ok(
    inventory.entries
      .filter(({ file }) => file.startsWith('cypress/e2e/'))
      .every(
        ({ owner, framework }) => owner === 'cypress' && framework === 'cypress'
      )
  );
  assert.ok(
    inventory.entries
      .filter(({ file }) => file.startsWith('playwright/'))
      .every(
        ({ owner, framework }) =>
          owner === 'playwright' && framework === 'playwright'
      )
  );
  assert.equal(
    inventory.entries.find(
      ({ file }) => file === 'gen-docs/scripts/image-size-security.test.mjs'
    )?.owner,
    'docs-security'
  );
  assert.deepEqual(
    verifyHostedTestInventory(repositoryRoot, inventory),
    inventory
  );
  assert.equal(assertHostedTestInventory(inventory), inventory);
});

test('inventory and native lane assignment are deterministic', () => {
  const root = fixture();
  const first = createHostedTestInventory(root);
  const second = createHostedTestInventory(root);
  assert.deepEqual(second, first);
  assert.equal(first.counts.total, first.entries.length);
  assert.deepEqual(
    first.lanes.map(({ id, command }) => ({ id, command })),
    [
      {
        id: 'vitest',
        command: { program: 'pnpm', args: ['test:ci'] },
      },
      {
        id: 'tooling',
        command: { program: 'pnpm', args: ['security:council'] },
      },
      {
        id: 'node-test-mjs',
        command: {
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
      },
      {
        id: 'docs-security',
        command: {
          program: 'pnpm',
          args: ['test:security'],
          cwd: 'gen-docs',
        },
      },
      {
        id: 'cypress',
        command: { program: 'cypress', args: ['run'] },
      },
      {
        id: 'playwright',
        command: { program: 'playwright', args: ['test'] },
      },
    ]
  );
});

test('inventory ignores dependency links but rejects source links', () => {
  const root = fixture();
  const expected = createHostedTestInventory(root);
  const dependencies = mkdtempSync(
    path.join(tmpdir(), 'hosted-test-inventory-dependencies-')
  );
  temporary.add(dependencies);
  writeFileSync(path.join(dependencies, 'marker.txt'), 'dependency input\n');
  symlinkSync(
    dependencies,
    path.join(root, 'gen-docs/node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.deepEqual(createHostedTestInventory(root), expected);

  const linkedSource = mkdtempSync(
    path.join(tmpdir(), 'hosted-test-inventory-linked-source-')
  );
  temporary.add(linkedSource);
  writeFileSync(
    path.join(linkedSource, 'linked.test.mjs'),
    "import test from 'node:test';\n"
  );
  symlinkSync(
    linkedSource,
    path.join(root, 'gen-docs/linked-source'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Symlink in hosted test discovery scope: gen-docs\/linked-source/
  );
});

test('inventory still rejects Cypress runtime links inside the source tree', () => {
  const root = fixture();
  const runtimeLogs = mkdtempSync(
    path.join(tmpdir(), 'hosted-test-inventory-cypress-runtime-')
  );
  temporary.add(runtimeLogs);
  writeFileSync(path.join(runtimeLogs, 'machine.log'), 'runtime output\n');
  mkdirSync(path.join(root, 'cypress/runtime-config'), { recursive: true });
  symlinkSync(
    runtimeLogs,
    path.join(root, 'cypress/runtime-config/logs'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Symlink in hosted test discovery scope: cypress\/runtime-config\/logs/
  );
});

test('embedded inventory validation is pure and rejects tampering', () => {
  const root = fixture();
  const inventory = JSON.parse(JSON.stringify(createHostedTestInventory(root)));
  assert.equal(assertHostedTestInventory(inventory), inventory);
  inventory.lanes[2].files.pop();
  assert.throws(
    () => assertHostedTestInventory(inventory),
    /Hosted test lane ownership mismatch: node-test-mjs/
  );
  const duplicate = JSON.parse(JSON.stringify(createHostedTestInventory(root)));
  const cypress = duplicate.lanes.find(({ id }) => id === 'cypress');
  cypress.files.push(cypress.files[0]);
  assert.throws(
    () => assertHostedTestInventory(duplicate),
    /Hosted test lane ownership mismatch: cypress/
  );
  const digestTamper = JSON.parse(
    JSON.stringify(createHostedTestInventory(root))
  );
  digestTamper.inventorySha256 = '0'.repeat(64);
  assert.throws(
    () => assertHostedTestInventory(digestTamper),
    /Hosted test inventory canonical hash mismatch/
  );
});

test('sealed inventory catches added and removed tests', () => {
  const root = fixture();
  const sealed = createHostedTestInventory(root);
  write(root, 'server/added.test.mjs', "import test from 'node:test';\n");
  assert.throws(
    () => verifyHostedTestInventory(root, sealed),
    /Hosted test inventory drift/
  );
  unlinkSync(path.join(root, 'server/added.test.mjs'));
  unlinkSync(path.join(root, 'src/native.test.mjs'));
  assert.throws(
    () => verifyHostedTestInventory(root, sealed),
    /Hosted test inventory drift/
  );
});

test('unclassified, mixed, and unregistered tests fail closed', () => {
  const root = fixture();
  write(root, 'src/unclassified.test.mjs', 'export const value = true;\n');
  assert.throws(
    () => createHostedTestInventory(root),
    /Unclassified test file: src\/unclassified\.test\.mjs/
  );
  unlinkSync(path.join(root, 'src/unclassified.test.mjs'));
  write(
    root,
    'src/mixed.test.ts',
    "import test from 'node:test'; import { expect } from 'vitest';\n"
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Mixed test frameworks: src\/mixed\.test\.ts/
  );
  unlinkSync(path.join(root, 'src/mixed.test.ts'));
  write(root, 'src/not-in-vitest.spec.ts', "import { test } from 'vitest';\n");
  assert.throws(
    () => createHostedTestInventory(root),
    /Unclassified hosted test ownership: src\/not-in-vitest\.spec\.ts/
  );
  unlinkSync(path.join(root, 'src/not-in-vitest.spec.ts'));
  write(root, 'scripts/rogue.test.mjs', "import test from 'node:test';\n");
  assert.throws(
    () => createHostedTestInventory(root),
    /Unclassified hosted test ownership: scripts\/rogue\.test\.mjs/
  );
});

test('tooling registry and native command drift fail closed', () => {
  const root = fixture();
  const toolingRunner = readFileSync(
    path.join(root, 'bin/run-tooling-tests.mjs'),
    'utf8'
  );
  write(
    root,
    'bin/run-tooling-tests.mjs',
    toolingRunner.replace(
      "['bin/tool.test.mjs']",
      "['bin/tool.test.mjs', 'bin/missing.test.mjs']"
    )
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Registered tooling test is missing: bin\/missing\.test\.mjs/
  );
  const restored = fixture();
  const packageJson = {
    scripts: {
      'security:council': securityCouncil,
      'test:ci': 'vitest run',
      'test:tooling': 'node bin/run-tooling-tests.mjs',
      'test:playwright': 'pnpm cypress:prepare && playwright test',
    },
  };
  write(restored, 'package.json', JSON.stringify(packageJson));
  assert.throws(
    () => createHostedTestInventory(restored),
    /Hosted native command drift: test:ci/
  );
  const docsDrift = fixture();
  write(
    docsDrift,
    'gen-docs/package.json',
    JSON.stringify({ scripts: { 'test:security': 'node --test' } })
  );
  assert.throws(
    () => createHostedTestInventory(docsDrift),
    /Hosted native command drift: gen-docs:test:security/
  );
  const cypressDrift = fixture();
  write(
    cypressDrift,
    'cypress.config.ts',
    "import { defineConfig } from 'cypress'; export default defineConfig({ e2e: { specPattern: 'one.cy.ts' } });\n"
  );
  assert.throws(
    () => createHostedTestInventory(cypressDrift),
    /Hosted Cypress native discovery binding drift/
  );
  const playwrightDrift = fixture();
  write(
    playwrightDrift,
    'playwright.config.ts',
    "import { defineConfig } from '@playwright/test'; export default defineConfig({ testDir: './other', fullyParallel: false, workers: 1, webServer: { command: 'pnpm cypress:start' } });\n"
  );
  assert.throws(
    () => createHostedTestInventory(playwrightDrift),
    /Hosted Playwright native discovery binding drift/
  );
  const playwrightAmbientEnvironment = fixture();
  write(
    playwrightAmbientEnvironment,
    'playwright.config.ts',
    readFileSync(
      path.join(playwrightAmbientEnvironment, 'playwright.config.ts'),
      'utf8'
    ).replace(
      'env: { CONFIG_DIRECTORY: configDirectory, PORT: port }',
      'env: { ...process.env, CONFIG_DIRECTORY: configDirectory, PORT: port }'
    )
  );
  assert.throws(
    () => createHostedTestInventory(playwrightAmbientEnvironment),
    /Hosted Playwright native discovery binding drift/
  );
});

test('hosted tooling remains transitively bound through security:council', () => {
  for (const councilCommand of [
    securityCouncil.replace('pnpm test:tooling && ', ''),
    securityCouncil.replace(
      'pnpm test:tooling',
      'pnpm test:tooling && pnpm test:tooling'
    ),
  ]) {
    const root = fixture();
    const packageJson = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    packageJson.scripts['security:council'] = councilCommand;
    write(root, 'package.json', JSON.stringify(packageJson));
    assert.throws(
      () => createHostedTestInventory(root),
      /Hosted native command drift: security:council/
    );
  }
});

test('Vitest include must be bound to the configured engine projects', () => {
  const root = fixture();
  const configFile = path.join(root, 'vitest.config.mts');
  const config = readFileSync(configFile, 'utf8');
  write(
    root,
    'vitest.config.mts',
    config.replace(
      'projects: engineVitestProjects',
      'unusedProjects: engineVitestProjects'
    )
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Hosted Vitest engine project binding drift/
  );
});

test('Vitest exclusion cannot hide an owned test file', () => {
  const root = fixture();
  const configFile = path.join(root, 'vitest.config.mts');
  const config = readFileSync(configFile, 'utf8');
  write(
    root,
    'vitest.config.mts',
    config.replace(
      "const exclude = ['node_modules/**', 'dist/**'];",
      "const exclude = ['node_modules/**', 'dist/**', 'src/unit.test.tsx'];"
    )
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Hosted Vitest exclude ownership drift/
  );
});

test('tooling arrays must both reach the existing Node test runner', () => {
  const root = fixture();
  const runnerFile = path.join(root, 'bin/run-tooling-tests.mjs');
  const runner = readFileSync(runnerFile, 'utf8');
  write(
    root,
    'bin/run-tooling-tests.mjs',
    runner.replace(
      ': [...portableTests, ...posixOnlyTests];',
      ': portableTests;'
    )
  );
  assert.throws(
    () => createHostedTestInventory(root),
    /Hosted tooling execution binding drift/
  );
  const reporterDrift = fixture();
  const reporterRunnerFile = path.join(
    reporterDrift,
    'bin/run-tooling-tests.mjs'
  );
  const reporterRunner = readFileSync(reporterRunnerFile, 'utf8');
  write(
    reporterDrift,
    'bin/run-tooling-tests.mjs',
    reporterRunner.replace("'--test-reporter=tap', ", '')
  );
  assert.throws(
    () => createHostedTestInventory(reporterDrift),
    /Hosted tooling execution binding drift/
  );
});
