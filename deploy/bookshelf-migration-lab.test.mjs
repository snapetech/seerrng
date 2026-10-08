import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scriptPath = path.resolve('deploy/bookshelf-migration-lab.sh');
const temporaryDirectories = new Set();

const createTemporaryDirectory = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-lab-test-'));
  temporaryDirectories.add(root);
  return root;
};

const runLab = (environment, mode) =>
  new Promise((resolve) => {
    const child = spawn(scriptPath, [mode], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('Bookshelf migration lab paths', () => {
  it('refuses to clean a directory without the lab ownership marker', async () => {
    const root = await createTemporaryDirectory();
    const labDirectory = path.join(root, 'unrelated');
    const sentinel = path.join(labDirectory, 'keep');
    await fs.mkdir(labDirectory);
    await fs.writeFile(sentinel, 'unchanged');

    const result = await runLab({ LAB_DIR: labDirectory }, 'clean');

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unowned or unmarked LAB_DIR/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
  });

  it('rejects database root folders that escape the lab', async () => {
    const root = await createTemporaryDirectory();
    const labDirectory = path.join(root, 'lab');
    const sourceDirectory = path.join(root, 'source');
    const executableDirectory = path.join(root, 'bin');
    const escapedDirectory = path.join(root, 'escaped');
    await fs.mkdir(sourceDirectory);
    await fs.mkdir(executableDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'readarr.db'), 'fixture');
    for (const command of ['curl', 'docker', 'node']) {
      await fs.writeFile(
        path.join(executableDirectory, command),
        '#!/bin/sh\nexit 0\n',
        { mode: 0o755 }
      );
    }
    await fs.writeFile(
      path.join(executableDirectory, 'rsync'),
      '#!/bin/sh\nfor argument do destination=$argument; done\nmkdir -p "$destination"\n: >"$destination/readarr.db"\n',
      { mode: 0o755 }
    );
    await fs.writeFile(
      path.join(executableDirectory, 'sqlite3'),
      "#!/bin/sh\nprintf '%s\\n' '/data/../../escaped'\n",
      { mode: 0o755 }
    );

    const result = await runLab(
      {
        BUILD_LOCAL_IMAGE: 'false',
        HARDCOVER_AUTH: 'Bearer test-token',
        LAB_DIR: labDirectory,
        PATH: `${executableDirectory}:${process.env.PATH}`,
        SKIP_PULL: 'true',
        SOURCE_EBOOK_CONFIG_DIR: sourceDirectory,
      },
      'prepare'
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unsafe source root folder path/);
    await assert.rejects(fs.stat(escapedDirectory), { code: 'ENOENT' });
  });

  it('requires a Bearer-prefixed Hardcover token for the lab', async () => {
    const root = await createTemporaryDirectory();
    const labDirectory = path.join(root, 'lab');
    const sourceDirectory = path.join(root, 'source');
    const executableDirectory = path.join(root, 'bin');
    await fs.mkdir(sourceDirectory);
    await fs.mkdir(executableDirectory);
    await fs.writeFile(path.join(sourceDirectory, 'readarr.db'), 'fixture');
    for (const command of ['curl', 'docker', 'node', 'rsync', 'sqlite3']) {
      await fs.writeFile(
        path.join(executableDirectory, command),
        '#!/bin/sh\nexit 0\n',
        {
          mode: 0o755,
        }
      );
    }

    const result = await runLab(
      {
        BUILD_LOCAL_IMAGE: 'false',
        HARDCOVER_AUTH: 'invalid-token',
        LAB_DIR: labDirectory,
        PATH: `${executableDirectory}:${process.env.PATH}`,
        SKIP_PULL: 'true',
        SOURCE_EBOOK_CONFIG_DIR: sourceDirectory,
      },
      'prepare'
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /HARDCOVER_AUTH must start with 'Bearer '/);
  });
});
