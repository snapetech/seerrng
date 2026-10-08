import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { promisify } from 'node:util';

const scriptPath = path.resolve(
  'scripts/relink-plex-from-local-preferences.sh'
);
const temporaryDirectories = new Set();
const execFileAsync = promisify(execFile);

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-plex-relink-'));
  temporaryDirectories.add(root);
  const configDirectory = path.join(root, 'config');
  const databaseDirectory = path.join(configDirectory, 'db');
  const executableDirectory = path.join(root, 'bin');
  const curlArguments = path.join(root, 'curl-arguments');
  const curlInput = path.join(root, 'curl-input');
  const preferences = path.join(root, 'Preferences.xml');
  await fs.mkdir(databaseDirectory, { recursive: true });
  await fs.mkdir(executableDirectory);
  await fs.writeFile(
    preferences,
    '<Preferences PlexOnlineToken="secret-token" ProcessedMachineIdentifier="machine-id" FriendlyName="Local Plex" />'
  );
  await fs.writeFile(
    path.join(executableDirectory, 'curl'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" >"$CURL_ARGUMENTS"\ncat >"$CURL_INPUT"\nexit 0\n',
    { mode: 0o755 }
  );
  return {
    configDirectory,
    curlArguments,
    curlInput,
    executableDirectory,
    preferences,
    root,
  };
};

const createStores = async (fixture, { mode = 0o640 } = {}) => {
  const settingsPath = path.join(fixture.configDirectory, 'settings.json');
  const databasePath = path.join(fixture.configDirectory, 'db', 'db.sqlite3');
  await fs.writeFile(settingsPath, '{"plex":{"name":"Old"}}\n', { mode });
  await execFileAsync('python3', [
    '-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("create table user (id integer primary key, plexToken text, plexId integer)"); c.execute("insert into user values (1, ?, null)", ("old-token",)); c.commit()',
    databasePath,
  ]);
  return { databasePath, settingsPath };
};

const runScript = (fixture) =>
  new Promise((resolve) => {
    const child = spawn(scriptPath, {
      env: {
        ...process.env,
        CONFIG_DIRECTORY: fixture.configDirectory,
        CURL_ARGUMENTS: fixture.curlArguments,
        CURL_INPUT: fixture.curlInput,
        PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
        PLEX_PREFERENCES: fixture.preferences,
      },
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

describe('Plex relink maintenance script', () => {
  it('refuses a symlinked settings file without modifying its target', async () => {
    const fixture = await createFixture();
    const outside = path.join(fixture.root, 'outside-settings.json');
    const settingsPath = path.join(fixture.configDirectory, 'settings.json');
    await fs.writeFile(outside, '{"unchanged":true}\n');
    await fs.symlink(outside, settingsPath);
    await fs.writeFile(
      path.join(fixture.configDirectory, 'db', 'db.sqlite3'),
      ''
    );

    const result = await runScript(fixture);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /settings file not found/);
    assert.equal(await fs.readFile(outside, 'utf8'), '{"unchanged":true}\n');
  });

  it('atomically preserves settings permissions and updates both stores', async () => {
    const fixture = await createFixture();
    const { databasePath, settingsPath } = await createStores(fixture);

    const result = await runScript(fixture);

    assert.equal(result.code, 0, result.stderr);
    const settingsHandle = await fs.open(settingsPath, 'r');
    try {
      assert.equal((await settingsHandle.stat()).mode & 0o777, 0o640);
      assert.deepEqual(JSON.parse(await settingsHandle.readFile('utf8')).plex, {
        ip: '127.0.0.1',
        machineId: 'machine-id',
        name: 'Local Plex',
        port: 33240,
        useSsl: false,
      });
    } finally {
      await settingsHandle.close();
    }
    const { stdout } = await execFileAsync('python3', [
      '-c',
      'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select plexToken from user where id=1").fetchone()[0])',
      databasePath,
    ]);
    assert.equal(stdout.trim(), 'secret-token');
    assert.equal(
      (await fs.readFile(fixture.curlArguments, 'utf8')).includes(
        'secret-token'
      ),
      false
    );
    assert.equal(
      await fs.readFile(fixture.curlInput, 'utf8'),
      'X-Plex-Token: secret-token\n'
    );
  });

  it('accepts a 512-character token on every supported libc', async () => {
    const fixture = await createFixture();
    const token = 'a'.repeat(512);
    const { databasePath } = await createStores(fixture);
    await fs.writeFile(
      fixture.preferences,
      `<Preferences PlexOnlineToken="${token}" ProcessedMachineIdentifier="machine-id" />`
    );

    const result = await runScript(fixture);

    assert.equal(result.code, 0, result.stderr);
    const { stdout } = await execFileAsync('python3', [
      '-c',
      'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select plexToken from user where id=1").fetchone()[0])',
      databasePath,
    ]);
    assert.equal(stdout.trim(), token);
  });

  it('rejects oversized tokens and invalid characters before contacting Plex', async () => {
    for (const token of ['a'.repeat(513), 'invalid!token']) {
      const fixture = await createFixture();
      await createStores(fixture);
      await fs.writeFile(
        fixture.preferences,
        `<Preferences PlexOnlineToken="${token}" ProcessedMachineIdentifier="machine-id" />`
      );

      const result = await runScript(fixture);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /invalid token/);
      await assert.rejects(fs.stat(fixture.curlArguments), { code: 'ENOENT' });
    }
  });
});
