import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  QUIET_TEST_FILES,
  engineVitestProjects,
  isEngineVitestProjects,
  partitionVitestFiles,
} from '../tools/validation-engine/runtime/vitest-binding.mjs';

test('native projects keep all files exactly once, with quiet work after parallel work', () => {
  const files = ['src/new.test.ts', ...QUIET_TEST_FILES, 'server/new.test.ts'];
  const selection = partitionVitestFiles(files);
  assert.deepEqual(selection.regular, [
    'src/new.test.ts',
    'server/new.test.ts',
  ]);
  assert.deepEqual(selection.quiet, QUIET_TEST_FILES);
  const projects = engineVitestProjects({ files, workers: 8 });
  assert.deepEqual(
    projects.flatMap((project) => project.test.include).sort(),
    files.sort()
  );
  assert.equal(projects[0].test.maxWorkers, 8);
  assert.equal(projects[0].test.sequence.groupOrder, 1);
  assert.equal(projects[1].test.maxWorkers, 1);
  assert.equal(projects[1].test.sequence.groupOrder, 2);
  assert.equal(projects[1].test.fileParallelism, false);
  assert.ok(
    projects.every((project) => project.extends && project.test.isolate)
  );
});

test('subset selection never broadens an empty phase or hides duplicate owners', () => {
  assert.equal(
    engineVitestProjects({ files: ['src/new.test.ts'], workers: 4 }).length,
    1
  );
  assert.equal(
    engineVitestProjects({ files: [QUIET_TEST_FILES[0]], workers: 4 })[0].test
      .name,
    'engine-quiet'
  );
  assert.deepEqual(engineVitestProjects({ files: [], workers: 4 }), []);
  assert.throws(() => partitionVitestFiles(['a', 'a']), /Unique/);
  for (const workers of [0, -1, 1.5, NaN, 257])
    assert.throws(
      () => engineVitestProjects({ files: ['a'], workers }),
      /workers/
    );
});

test('only the reviewed project shape may be rebound to dynamically discovered ownership', () => {
  const projects = engineVitestProjects({
    include: ['server/**/*.test.ts'],
    workers: 4,
  });
  assert.ok(isEngineVitestProjects(projects));
  for (const modify of [
    (value) => {
      value[1].test.sequence.groupOrder = 0;
    },
    (value) => {
      value[1].test.maxWorkers = 4;
    },
    (value) => {
      value[0].test.setupFiles = [];
    },
    (value) => {
      value[1].test.include = [];
    },
    (value) => {
      value[0].test.isolate = false;
    },
  ]) {
    const changed = structuredClone(projects);
    modify(changed);
    assert.equal(isEngineVitestProjects(changed), false);
  }
  assert.equal(isEngineVitestProjects([{ test: { name: 'other' } }]), false);
});

test('per-file bootstrap uses fresh config, blocks inherited providers, and cleans only its own directories', () => {
  const setup = fileURLToPath(
    new URL('../server/test/engine-isolate-before.mjs', import.meta.url)
  );
  const setupUrl = pathToFileURL(setup).href;
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    await import(${JSON.stringify(setupUrl)} + '?first');
    const a = process.env.CONFIG_DIRECTORY;
    await import(${JSON.stringify(setupUrl)} + '?second');
    console.log(JSON.stringify({ a, b: process.env.CONFIG_DIRECTORY, db: process.env.DB_HOST ?? null,
      external: process.env.SEERR_EXTERNAL_CONFIG ?? null, network: process.env.ALLOW_NETWORK,
      fail: process.env.SEERR_TEST_FAIL_ON_NETWORK, nodeEnv: process.env.NODE_ENV }));
  `,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DB_HOST: 'live',
        SEERR_EXTERNAL_CONFIG: 'live',
        CONFIG_DIRECTORY: resolve('.'),
        ALLOW_NETWORK: 'true',
      },
    }
  );
  const proof = JSON.parse(result.trim());
  assert.notEqual(proof.a, proof.b);
  assert.equal(proof.db, null);
  assert.equal(proof.external, null);
  assert.equal(proof.network, 'false');
  assert.equal(proof.fail, 'true');
  assert.equal(proof.nodeEnv, 'test');
  assert.equal(existsSync(proof.a), false);
  assert.equal(existsSync(proof.b), false);
  assert.equal(existsSync(resolve('.')), true);
});
