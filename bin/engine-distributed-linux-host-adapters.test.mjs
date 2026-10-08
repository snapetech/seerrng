import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { createDistributedLinuxHostAdapters } from '../tools/validation-engine/runtime/distributed-linux-host-adapters.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-host-adapters-'));
  const script = join(root, 'docker-fixture.mjs');
  writeFileSync(
    script,
    `const args = process.argv.slice(2);
const [kind, operation, reference] = args;
if (kind === 'pass') process.stdout.write('passed\\n');
else if (kind === 'fail') { process.stderr.write('focused failure\\n'); process.exitCode = 7; }
else if (kind === 'delay') setTimeout(() => process.stdout.write('done\\n'), Number(operation));
else if (kind === 'large') process.stdout.write('x'.repeat(Number(operation)));
else if (operation === 'inspect' && reference === 'present') process.stdout.write(JSON.stringify([{ Id: kind + '-id', Name: reference }]));
else if (operation === 'inspect' && reference === 'malformed') process.stdout.write('{');
else if (operation === 'inspect' && reference === 'multiple') process.stdout.write('[{},{}]');
else if (operation === 'inspect' && reference === 'unrelated') { process.stderr.write('permission denied\\n'); process.exitCode = 1; }
else if (operation === 'inspect') {
  const message = kind === 'container' ? 'Error: No such container: ' + reference
    : kind === 'image' ? 'Error response from daemon: No such image: ' + reference
    : 'Error response from daemon: get ' + reference + ': no such volume';
  process.stderr.write(message + '\\n');
  process.exitCode = 1;
} else { process.stderr.write('unexpected fixture arguments\\n'); process.exitCode = 9; }
`,
    'utf8'
  );
  const create = (overrides = {}) =>
    createDistributedLinuxHostAdapters({
      dockerExecutable: process.execPath,
      dockerPrefixArguments: [script],
      primaryTimeoutMs: 2_000,
      cleanupTimeoutMs: 2_000,
      inspectTimeoutMs: 2_000,
      terminationGraceMs: 25,
      terminationHardMs: 250,
      ...overrides,
    });
  return {
    root,
    create,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('builder returns only the exact outer adapter surface', (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const adapters = focused.create();
  assert.deepEqual(Object.keys(adapters).sort(), ['docker', 'fs', 'process']);
  assert.deepEqual(Object.keys(adapters.docker).sort(), [
    'inspectContainer',
    'inspectImage',
    'inspectVolume',
    'run',
  ]);
  assert.deepEqual(Object.keys(adapters.fs).sort(), [
    'createDirectoryExclusive',
    'readFile',
    'writeJsonExclusive',
  ]);
  assert.deepEqual(Object.keys(adapters.process).sort(), [
    'delay',
    'now',
    'uniqueToken',
  ]);
  assert.match(adapters.process.uniqueToken(), /^[a-f0-9]{32}$/u);
  assert.equal(typeof adapters.process.now(), 'number');
});

test('Docker run returns bounded exact success and failure receipts', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const { docker } = focused.create();
  const passed = await docker.run(['pass'], { id: 'pass-command' });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.signal, null);
  assert.equal(passed.timeoutMs, 2_000);
  assert.equal(passed.cleanupMode, false);
  assert.equal(passed.stdout, 'passed\n');
  assert.equal(passed.stdoutSha256, sha256('passed\n'));
  assert.equal(passed.lifecycle.completed, true);
  assert.equal(passed.lifecycle.cleanupVerified, true);

  const failed = await docker.run(['fail'], { id: 'fail-command' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.stderr, 'focused failure\n');
  assert.equal(failed.lifecycle.cleanupVerified, true);
});

test('primary abort is honored while bounded cleanup ignores that signal', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const { docker } = focused.create();
  const controller = new AbortController();
  controller.abort(new Error('focused abort'));
  const aborted = await docker.run(['delay', '10'], {
    id: 'primary-aborted',
    signal: controller.signal,
  });
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.lifecycle.spawned, false);
  assert.equal(aborted.lifecycle.cleanupVerified, true);

  const cleanup = await docker.run(['pass'], {
    id: 'cleanup-after-abort',
    signal: controller.signal,
    cleanup: true,
  });
  assert.equal(cleanup.status, 'passed');
  assert.equal(cleanup.cleanupMode, true);
  assert.equal(cleanup.stdout, 'passed\n');
});

test('timeout and output overflow terminate within bounds without false success', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const timed = focused.create({ primaryTimeoutMs: 30 });
  const timedOut = await timed.docker.run(['delay', '500'], {
    id: 'timeout-command',
  });
  assert.equal(timedOut.status, 'timed-out');
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.lifecycle.cleanupVerified, true);

  const bounded = focused.create({ maxCaptureBytes: 32 });
  const overflow = await bounded.docker.run(['large', '2048'], {
    id: 'output-overflow',
  });
  assert.equal(overflow.status, 'incomplete');
  assert.equal(overflow.outputLimitExceeded, true);
  assert.equal(Buffer.byteLength(overflow.stdout), 32);
  assert.equal(overflow.stdoutTruncated, true);
  assert.equal(overflow.lifecycle.cleanupVerified, true);
});

test('typed inspections return one exact object or null only for not-found', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const { docker } = focused.create();
  assert.deepEqual(await docker.inspectContainer('present'), {
    Id: 'container-id',
    Name: 'present',
  });
  assert.deepEqual(await docker.inspectImage('present'), {
    Id: 'image-id',
    Name: 'present',
  });
  assert.deepEqual(await docker.inspectVolume('present'), {
    Id: 'volume-id',
    Name: 'present',
  });
  assert.equal(await docker.inspectContainer('absent'), null);
  assert.equal(await docker.inspectImage('absent'), null);
  assert.equal(await docker.inspectVolume('absent'), null);
  await assert.rejects(
    docker.inspectContainer('unrelated'),
    /Docker container inspection failed/u
  );
  await assert.rejects(
    docker.inspectContainer('malformed'),
    /did not return JSON/u
  );
  await assert.rejects(
    docker.inspectContainer('multiple'),
    /exactly one object/u
  );
});

test('filesystem writes are exclusive, readable and never overwrite evidence', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  const adapters = focused.create();
  const directory = join(focused.root, 'evidence');
  await adapters.fs.createDirectoryExclusive(directory);
  await assert.rejects(
    adapters.fs.createDirectoryExclusive(directory),
    /EEXIST/u
  );
  const path = join(directory, 'receipt.json');
  await adapters.fs.writeJsonExclusive(path, { status: 'passed' });
  assert.equal(
    (await adapters.fs.readFile(path)).toString('utf8'),
    '{\n  "status": "passed"\n}\n'
  );
  await assert.rejects(
    adapters.fs.writeJsonExclusive(path, { status: 'changed' }),
    /EEXIST/u
  );
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    status: 'passed',
  });
});

test('invalid arguments and adapter bounds fail before process launch', async (t) => {
  const focused = fixture();
  t.after(focused.cleanup);
  assert.throws(
    () => focused.create({ primaryTimeoutMs: 0 }),
    /Invalid primary Docker command timeout/u
  );
  const { docker } = focused.create();
  await assert.rejects(
    docker.run(['bad\0argument']),
    /Invalid Docker arguments entry/u
  );
  await assert.rejects(
    docker.run(['pass'], { cleanup: 'yes' }),
    /cleanup mode must be boolean/u
  );
});
