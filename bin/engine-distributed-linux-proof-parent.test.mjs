import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pythonTest = fileURLToPath(
  new URL('./engine-distributed-linux-proof-parent.test.py', import.meta.url)
);

test(
  'Linux proof-parent Python contracts pass through the registered tooling lane',
  { skip: process.platform !== 'linux' },
  () => {
    const result = spawnSync('python3', [pythonTest], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });

    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `Proof-parent Python tests failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.match(result.stderr, /Ran \d+ tests? in/u);
    assert.match(result.stderr, /\nOK\s*$/u);
  }
);
