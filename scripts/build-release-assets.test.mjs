import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const sourceScript = path.resolve('scripts/build-release-assets.sh');
const temporaryDirectories = new Set();

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-assets-test-'));
  temporaryDirectories.add(root);
  const executableDirectory = path.join(root, 'tools');
  await Promise.all([
    ...['.next', 'bin', 'dist', 'public'].map((directory) =>
      fs.mkdir(path.join(root, directory), { recursive: true })
    ),
    fs.mkdir(executableDirectory, { recursive: true }),
  ]);
  await fs.writeFile(path.join(root, 'dist', 'index.js'), 'fixture\n');
  await fs.writeFile(path.join(root, 'bin', 'prepare.mjs'), 'fixture\n');
  await fs.writeFile(path.join(root, 'public', 'asset.txt'), 'public\n');
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'next.config.ts',
    'seerr-api.yml',
    'LICENSE',
  ]) {
    await fs.writeFile(path.join(root, file), '{}\n');
  }
  const script = path.join(root, 'build-release-assets.sh');
  await fs.copyFile(sourceScript, script);
  await fs.chmod(script, 0o755);
  await fs.writeFile(
    path.join(executableDirectory, 'corepack'),
    '#!/bin/sh\nexit 0\n',
    {
      mode: 0o755,
    }
  );
  await fs.writeFile(
    path.join(executableDirectory, 'pnpm'),
    '#!/bin/sh\nif [ "$1" = install ] && [ "$2" = --prod ]; then\n  ln -s "$PWD/public/asset.txt" "$PWD/public/internal-link"\nfi\nexit 0\n',
    { mode: 0o755 }
  );
  return { executableDirectory, root, script };
};

const run = (fixture, arguments_) =>
  new Promise((resolve) => {
    const child = spawn(fixture.script, arguments_, {
      cwd: fixture.root,
      env: {
        ...process.env,
        PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
        TMPDIR: fixture.root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });

const extractArchive = (archive, destination) =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', destination]);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))
    );
  });

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('release asset construction', () => {
  it('atomically publishes a narrowed archive with a location-independent launcher', async () => {
    const fixture = await createFixture();
    const distribution = path.join(fixture.root, 'dist-release');
    const sentinel = path.join(fixture.root, 'sentinel');
    const asset = 'seerrng-v1.2.3-linux-x64';
    const archive = path.join(distribution, `${asset}.tar.gz`);
    await fs.mkdir(distribution);
    await fs.writeFile(sentinel, 'unchanged');
    await fs.symlink(sentinel, archive);

    const result = await run(fixture, ['v1.2.3', distribution]);

    assert.equal(result.code, 0, result.output);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
    assert.equal((await fs.stat(archive)).mode & 0o777, 0o644);
    const extracted = path.join(fixture.root, 'extracted');
    await fs.mkdir(extracted);
    await extractArchive(archive, extracted);
    const root = path.join(extracted, asset);
    await assert.rejects(fs.stat(path.join(root, 'server')), {
      code: 'ENOENT',
    });
    await assert.rejects(fs.stat(path.join(root, 'bin')), { code: 'ENOENT' });

    const invocation = path.join(fixture.root, 'node-invocation');
    await fs.writeFile(
      path.join(fixture.executableDirectory, 'node'),
      '#!/bin/sh\nprintf \'%s\\n%s\\n%s\\n\' "$PWD" "$CONFIG_DIRECTORY" "$*" >"$NODE_INVOCATION"\n',
      { mode: 0o755 }
    );
    const launch = await new Promise((resolve) => {
      const child = spawn(path.join(root, 'seerrng'), ['--version'], {
        cwd: fixture.root,
        env: {
          ...process.env,
          NODE_INVOCATION: invocation,
          PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
        },
      });
      child.on('close', resolve);
    });
    assert.equal(launch, 0);
    assert.deepEqual(
      (await fs.readFile(invocation, 'utf8')).trim().split('\n'),
      [root, path.join(root, 'config'), 'dist/index.js --version']
    );
  });

  it('rejects tag traversal before creating a distribution directory', async () => {
    const fixture = await createFixture();
    const distribution = path.join(fixture.root, 'dist-release');

    const result = await run(fixture, ['../../escaped', distribution]);

    assert.notEqual(result.code, 0);
    assert.match(result.output, /Invalid release tag/);
    await assert.rejects(fs.stat(distribution), { code: 'ENOENT' });
  });

  it('rejects absolute symlinks from staged runtime content', async () => {
    const fixture = await createFixture();
    const distribution = path.join(fixture.root, 'dist-release');
    await fs.symlink(
      '/etc/passwd',
      path.join(fixture.root, 'public', 'escape')
    );

    const result = await run(fixture, ['v1.2.3', distribution]);

    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing absolute archive symlink/);
    await assert.rejects(
      fs.stat(path.join(distribution, 'seerrng-v1.2.3-linux-x64.tar.gz')),
      { code: 'ENOENT' }
    );
  });

  it('normalizes absolute symlinks that remain inside staged runtime content', async () => {
    const fixture = await createFixture();
    const distribution = path.join(fixture.root, 'dist-release');
    const asset = 'seerrng-v1.2.3-linux-x64';
    const archive = path.join(distribution, `${asset}.tar.gz`);
    await fs.mkdir(distribution);
    const result = await run(fixture, ['v1.2.3', distribution]);

    assert.equal(result.code, 0, result.output);
    const extracted = path.join(fixture.root, 'extracted');
    await fs.mkdir(extracted);
    await extractArchive(archive, extracted);
    const link = path.join(extracted, asset, 'public', 'internal-link');
    assert.equal(path.isAbsolute(await fs.readlink(link)), false);
    assert.equal(await fs.readFile(link, 'utf8'), 'public\n');
  });
});
