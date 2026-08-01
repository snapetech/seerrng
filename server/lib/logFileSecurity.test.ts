import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import fs from 'fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PRIVATE_LOG_DIRECTORY_MODE,
  PRIVATE_LOG_FILE_MODE,
  secureLogDirectory,
} from './logFileSecurity';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('log file permissions', () => {
  it('creates a missing log directory with private permissions', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-logs-'));
    temporaryDirectories.push(parent);
    const logDirectory = path.join(parent, 'logs');

    secureLogDirectory(logDirectory);

    assert.strictEqual(
      (await fs.stat(logDirectory)).mode & 0o777,
      PRIVATE_LOG_DIRECTORY_MODE
    );
  });

  it('tightens existing log directories and regular files', async () => {
    const logDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-logs-')
    );
    temporaryDirectories.push(logDirectory);
    const logFile = path.join(logDirectory, 'seerr.log');

    await fs.chmod(logDirectory, 0o755);
    await fs.writeFile(logFile, 'sensitive log data', { mode: 0o644 });
    secureLogDirectory(logDirectory);

    assert.strictEqual(
      (await fs.stat(logDirectory)).mode & 0o777,
      PRIVATE_LOG_DIRECTORY_MODE
    );
    assert.strictEqual(
      (await fs.stat(logFile)).mode & 0o777,
      PRIVATE_LOG_FILE_MODE
    );
  });

  it('rejects symlinked log directories without modifying their targets', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-logs-'));
    temporaryDirectories.push(parent);
    const targetDirectory = path.join(parent, 'unrelated');
    const logDirectory = path.join(parent, 'logs');
    await fs.mkdir(targetDirectory, { mode: 0o755 });
    await fs.symlink(targetDirectory, logDirectory);

    assert.throws(() => secureLogDirectory(logDirectory), /symlink/);
    assert.equal((await fs.stat(targetDirectory)).mode & 0o777, 0o755);
  });

  it('rejects symlinks above the direct log directory', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-logs-'));
    temporaryDirectories.push(parent);
    const targetRoot = path.join(parent, 'target');
    const targetDirectory = path.join(targetRoot, 'logs');
    const linkedRoot = path.join(parent, 'linked');
    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o755 });
    await fs.symlink(targetRoot, linkedRoot);

    assert.throws(
      () => secureLogDirectory(path.join(linkedRoot, 'logs')),
      /symlink/
    );
    assert.equal((await fs.stat(targetDirectory)).mode & 0o777, 0o755);
  });

  it('allows only safe logger-managed symlinks', async () => {
    const logDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-logs-')
    );
    temporaryDirectories.push(logDirectory);
    const datedLog = path.join(logDirectory, 'seerr-2026-07-15.log');
    await fs.writeFile(datedLog, 'log', { mode: 0o644 });
    await fs.symlink(
      path.basename(datedLog),
      path.join(logDirectory, 'seerr.log')
    );

    secureLogDirectory(logDirectory);

    assert.equal((await fs.stat(datedLog)).mode & 0o777, PRIVATE_LOG_FILE_MODE);
  });

  it('allows the legacy Overseerr logger-managed symlink', async () => {
    const logDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-logs-')
    );
    temporaryDirectories.push(logDirectory);
    const datedLog = path.join(logDirectory, 'overseerr-2026-07-15.log');
    await fs.writeFile(datedLog, 'log', { mode: 0o644 });
    await fs.symlink(
      path.basename(datedLog),
      path.join(logDirectory, 'overseerr.log')
    );

    secureLogDirectory(logDirectory);

    assert.equal((await fs.stat(datedLog)).mode & 0o777, PRIVATE_LOG_FILE_MODE);
  });

  it('rejects escaping and unexpected log symlinks', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-logs-'));
    temporaryDirectories.push(parent);
    const logDirectory = path.join(parent, 'logs');
    const target = path.join(parent, 'outside.log');
    await fs.mkdir(logDirectory);
    await fs.writeFile(target, 'outside', { mode: 0o644 });
    await fs.symlink('../outside.log', path.join(logDirectory, 'seerr.log'));

    assert.throws(() => secureLogDirectory(logDirectory), /escapes/);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o644);

    await fs.rm(path.join(logDirectory, 'seerr.log'));
    await fs.symlink('../outside.log', path.join(logDirectory, 'audit.json'));
    assert.throws(() => secureLogDirectory(logDirectory), /Unexpected symlink/);
  });

  it('rejects hard-linked log files without changing the target', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-logs-'));
    temporaryDirectories.push(parent);
    const logDirectory = path.join(parent, 'logs');
    const target = path.join(parent, 'outside.log');
    await fs.mkdir(logDirectory);
    await fs.writeFile(target, 'outside', { mode: 0o644 });
    await fs.link(target, path.join(logDirectory, 'seerr-current.log'));

    assert.throws(() => secureLogDirectory(logDirectory), /hard-linked/);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o644);
  });
});
