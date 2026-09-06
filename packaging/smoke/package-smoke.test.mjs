import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scriptPath = path.resolve('packaging/smoke/package-smoke');
const temporaryDirectories = new Set();

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'package-smoke-test-'));
  temporaryDirectories.add(root);
  const executableDirectory = path.join(root, 'bin');
  await fs.mkdir(executableDirectory);
  await fs.writeFile(
    path.join(executableDirectory, 'flatpak-builder'),
    '#!/bin/sh\nif [ -n "${FLATPAK_BUILDER_COUNT:-}" ]; then printf \'x\' >>"$FLATPAK_BUILDER_COUNT"; fi\nexit "${FLATPAK_BUILDER_EXIT:-0}"\n',
    { mode: 0o755 }
  );
  return { executableDirectory, root };
};

const runSmoke = (
  fixture,
  artifactDirectory,
  arguments_ = [],
  environment = {}
) =>
  new Promise((resolve) => {
    const child = spawn(
      scriptPath,
      ['seerrng', 'flatpak', 'v1.2.3', ...arguments_],
      {
        env: {
          ...process.env,
          PACKAGE_SMOKE_ARTIFACT_DIR: artifactDirectory,
          PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
          TMPDIR: fixture.root,
          ...environment,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('package smoke evidence boundaries', () => {
  it('writes private valid evidence for a successful metadata smoke', async () => {
    const fixture = await createFixture();
    const artifacts = path.join(fixture.root, 'artifacts');

    const result = await runSmoke(fixture, artifacts);

    assert.equal(result.code, 0, result.output);
    const evidence = JSON.parse(
      await fs.readFile(path.join(artifacts, 'evidence.json'), 'utf8')
    );
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.arch, os.machine());
    assert.equal(
      (await fs.stat(path.join(artifacts, 'evidence.json'))).mode & 0o777,
      0o600
    );
    assert.equal((await fs.stat(artifacts)).mode & 0o777, 0o700);
  });

  it('rejects an architecture path traversal before creating evidence', async () => {
    const fixture = await createFixture();
    const artifacts = path.join(fixture.root, 'artifacts');
    const escaped = path.join(fixture.root, 'escaped');

    const result = await runSmoke(fixture, artifacts, [
      '--arch',
      '../../escaped',
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.output, /unsupported architecture/);
    await assert.rejects(fs.stat(escaped), { code: 'ENOENT' });
  });

  it('rejects an architecture that the selected channel does not publish', async () => {
    const fixture = await createFixture();
    const artifacts = path.join(fixture.root, 'artifacts');

    const result = await runSmoke(fixture, artifacts, ['--arch', 'arm64']);

    assert.notEqual(result.code, 0);
    assert.match(result.output, /flatpak is published only for amd64\/x86_64/);
  });

  it('executes each smoke command once', async () => {
    const fixture = await createFixture();
    const artifacts = path.join(fixture.root, 'artifacts');
    const countFile = path.join(fixture.root, 'flatpak-builder.count');

    const result = await runSmoke(fixture, artifacts, [], {
      FLATPAK_BUILDER_COUNT: countFile,
    });

    assert.equal(result.code, 0, result.output);
    assert.equal((await fs.readFile(countFile, 'utf8')).length, 1);
  });

  it('rejects a symlink in the artifact directory path', async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.root, 'target');
    const link = path.join(fixture.root, 'artifact-link');
    await fs.mkdir(target);
    await fs.symlink(target, link);

    const result = await runSmoke(fixture, path.join(link, 'nested'));

    assert.notEqual(result.code, 0);
    assert.match(result.output, /artifact directory contains a symlink/);
    await assert.rejects(fs.stat(path.join(target, 'nested')), {
      code: 'ENOENT',
    });
  });

  it('does not overwrite a planted evidence symlink', async () => {
    const fixture = await createFixture();
    const artifacts = path.join(fixture.root, 'artifacts');
    const sentinel = path.join(fixture.root, 'sentinel');
    await fs.mkdir(path.join(artifacts, 'logs'), { recursive: true });
    await fs.writeFile(sentinel, 'unchanged');
    await fs.symlink(sentinel, path.join(artifacts, 'evidence.json'));

    const result = await runSmoke(fixture, artifacts);

    assert.notEqual(result.code, 0);
    assert.match(result.output, /refusing symlink evidence file/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
  });
});
