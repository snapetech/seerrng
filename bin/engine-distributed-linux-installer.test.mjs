import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveBash, withGitBashOnPath } from './platform-tools.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const installer = path.join(
  repositoryRoot,
  'tools',
  'validation-engine',
  'setup',
  'install-distributed-test-engine.sh'
);

function runBashScript(script, arguments_ = [], options = {}) {
  return spawnSync(resolveBash(), ['--', script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: withGitBashOnPath(options.env ?? process.env),
    input: options.input,
    shell: false,
    windowsHide: true,
  });
}

function checkBashSyntax(script) {
  return spawnSync(resolveBash(), ['-n', '--', script], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: withGitBashOnPath(process.env),
    shell: false,
    windowsHide: true,
  });
}

function runExecutable(executable, arguments_, options = {}) {
  return spawnSync(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
    shell: false,
    windowsHide: true,
  });
}

async function createFakeEngineSource(root) {
  const sourceRoot = path.join(root, 'source-tree');
  const binDirectory = path.join(sourceRoot, 'bin');
  const runtimeDirectory = path.join(
    sourceRoot,
    'tools',
    'validation-engine',
    'runtime'
  );
  const sourceInstaller = path.join(
    sourceRoot,
    'tools',
    'validation-engine',
    'setup',
    'install-distributed-test-engine.sh'
  );
  const runner = path.join(binDirectory, 'run-local-validation.mjs');

  await mkdir(binDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(path.dirname(sourceInstaller), { recursive: true });
  await copyFile(installer, sourceInstaller);
  await chmod(sourceInstaller, 0o755);
  await writeFile(
    runner,
    [
      '#!/usr/bin/env bash',
      'log="${SEERRNG_FAKE_RUNNER_LOG:-${0}.arguments}"',
      '{',
      "  printf '%s\\n' '--- invocation ---'",
      '  printf \'%s\\n\' "$@"',
      '} >>"$log"',
      'mode=""',
      'has_json=0',
      'node_id=""',
      'previous=""',
      'for argument in "$@"; do',
      '  case "$argument" in',
      '    --distributed-applications) mode="applications" ;;',
      '    --distributed-dependency-plan) mode="dependency-plan" ;;',
      '    --distributed-node-thread-policy) mode="node-thread-policy" ;;',
      '    --json) has_json=1 ;;',
      '  esac',
      '  if [[ "$previous" == "--node-id" ]]; then node_id="$argument"; fi',
      '  previous="$argument"',
      'done',
      'if [[ "$mode" == "applications" ]]; then',
      '  if [[ -n "${SEERRNG_FAKE_APPLICATIONS_JSON:-}" ]]; then',
      '    printf \'%s\\n\' "$SEERRNG_FAKE_APPLICATIONS_JSON"',
      '  else',
      '    printf \'%s\\n\' \'{"applications":[{"entryId":"01","applicationId":"SeerrNG 3.3.0","name":"SeerrNG","profilePath":"/source/seerrng-test-suite-dependancies.cfg","requirements":[{"name":"node","version":"24.21.0"}]}]}\'',
      '  fi',
      '  exit 0',
      'fi',
      'if [[ "$mode" == "node-thread-policy" && "$has_json" == 1 && -z "$node_id" ]]; then',
      '  if [[ -n "${SEERRNG_FAKE_NODES_JSON:-}" ]]; then',
      '    printf \'%s\\n\' "$SEERRNG_FAKE_NODES_JSON"',
      '  else',
      '    printf \'%s\\n\' \'{"nodes":[{"nodeNumber":"01","computerName":"Media server","ipAddress":"192.168.10.9","port":62021,"cpuName":"AMD Ryzen Embedded V3C14","availableThreads":8,"threads":null,"minimumThreadCount":null}]}\'',
      '  fi',
      '  exit 0',
      'fi',
      'if [[ "$mode" == "dependency-plan" ]]; then',
      '  if [[ -n "${SEERRNG_FAKE_DEPENDENCY_PLAN_JSON:-}" ]]; then',
      '    printf \'%s\\n\' "$SEERRNG_FAKE_DEPENDENCY_PLAN_JSON"',
      '  else',
      '    printf \'%s\\n\' \'{"selectedApplications":[{"entryId":"01","applicationId":"SeerrNG 3.3.0","name":"SeerrNG"}],"dependencies":[{"name":"node","version":"24.21.0"}]}\'',
      '  fi',
      '  exit 0',
      'fi',
      'if [[ "${SEERRNG_FAKE_RUNNER_CONFLICT_ONCE:-0}" == 1 ]]; then',
      '  count_file="${log}.count"',
      '  count=0',
      '  [[ ! -f "$count_file" ]] || count="$(<"$count_file")"',
      '  count=$((count + 1))',
      '  printf \'%s\\n\' "$count" >"$count_file"',
      '  if (( count == 1 )); then',
      "    printf '%s\\n' 'Node 01 is already occupied by another address.' >&2",
      '    exit 20',
      '  fi',
      'fi',
      'status="${SEERRNG_FAKE_RUNNER_STATUS:-0}"',
      'if (( status == 20 )); then',
      "  printf '%s\\n' 'Node 01 is already occupied by another address.' >&2",
      'elif (( status != 0 )); then',
      '  printf \'fake runner failure %s\\n\' "$status" >&2',
      'fi',
      'exit "$status"',
      '',
    ].join('\n'),
    'utf8'
  );
  await chmod(runner, 0o755);
  await writeFile(
    path.join(binDirectory, 'local-validation.mjs'),
    'export const fakeLocalValidation = true;\n',
    'utf8'
  );
  await writeFile(
    path.join(binDirectory, 'platform-tools.mjs'),
    'export const fakePlatformTools = true;\n',
    'utf8'
  );
  await writeFile(
    path.join(runtimeDirectory, 'fake-runtime.mjs'),
    'export const fakeRuntime = true;\n',
    'utf8'
  );
  return sourceRoot;
}

function nodeConfigurationInput() {
  return [
    '01',
    "John's Laptop - VM1",
    '192.168.10.51',
    '62021',
    '192.168.10.50',
    '62021',
    '',
  ].join('\n');
}

async function installAt(root, sourceRoot, role, startup = 'manual') {
  return runBashScript(installer, [
    '--install-root',
    root,
    '--engine-source-root',
    sourceRoot,
    '--action',
    `install-${role}`,
    '--startup',
    startup,
    '--configure-now',
    'no',
    '--yes',
  ]);
}

function manualNodeCommand(root) {
  const command = path.join(root, 'usr/local/bin/seerrng-test-engine');
  const stateRoot = path.join(root, 'var/lib/seerrng-test-engine');
  const logRoot = path.join(root, 'var/log/seerrng-test-engine');
  return `${command} --distributed-node --active-config-marker ${path.join(
    stateRoot,
    'active-config'
  )} --state-root ${stateRoot} --log-root ${logRoot} --app ID=ABSOLUTE_ROOT`;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function startControllerAndStop(executable, arguments_) {
  const child = spawn(executable, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let listening = false;

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new Error(
          `controller service did not listen before timeout\n${stdout}\n${stderr}`
        )
      );
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (
        !listening &&
        stdout.includes('controller enrollment service is listening on')
      ) {
        listening = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (!listening) {
        reject(
          new Error(
            `controller service exited before listening (${code ?? signal})\n${stdout}\n${stderr}`
          )
        );
        return;
      }
      resolve({ code, signal, stderr, stdout });
    });
  });
}

test('Linux installer has valid Bash syntax and the approved public contract', async () => {
  const result = checkBashSyntax(installer);
  assert.equal(result.status, 0, result.stderr);

  const source = await readFile(installer, 'utf8');
  for (const menuItem of [
    'Install Controller',
    'Configure Controller',
    'Install Node',
    'Configure Node',
    'Manage Supported Applications',
    'Install or Repair Test Dependencies',
    'Assign Enrolled Node Thread Policy',
    'List Supported Applications',
    'Add Supported Application',
    'Delete Supported Application',
    'Select One or More Applications',
    'Install All Supported Applications',
    'Manual Dependency Installation',
  ]) {
    assert.match(source, new RegExp(menuItem));
  }
  assert.match(source, /print_section 'DESCRIPTION'/);

  for (const defaultPath of [
    '/usr/local/lib/seerrng-test-engine',
    '/usr/local/bin/seerrng-test-engine',
    '/etc/seerrng-test-engine',
    '/var/lib/seerrng-test-engine',
    '/var/log/seerrng-test-engine',
  ]) {
    assert.ok(source.includes(defaultPath), defaultPath);
  }

  for (const mode of [
    '--distributed-configure-controller',
    '--distributed-configure-node',
    '--distributed-controller-service',
    '--distributed-node',
    '--distributed-node-thread-policy',
  ]) {
    assert.ok(source.includes(mode), mode);
  }

  assert.match(source, /--engine-source-root PATH/);
  assert.match(source, /bin\/run-local-validation\.mjs/);
  assert.match(source, /tools\/validation-engine\/runtime\/\*\.mjs/);
  assert.match(
    source,
    /tools\/validation-engine\/setup\/install-distributed-test-engine\.sh/
  );
  assert.match(source, /<appname>-test-suite-dependancies\.cfg/);
  assert.match(source, /--distributed-applications/);
  assert.match(source, /--distributed-app-add/);
  assert.match(source, /--distributed-app-delete/);
  assert.match(source, /--distributed-dependency-plan/);
  assert.match(source, /--application-id/);
  assert.match(source, /--application-name/);
  assert.match(source, /--dependency-profile/);
  assert.match(source, /--all-applications/);
  assert.match(source, /--dependency-name/);
  assert.doesNotMatch(source, /source\s+["']?\$[^\n]*depend/i);
  assert.doesNotMatch(source, /\beval\b/);
  assert.match(source, /test-suite-multi-computer-\$github_username\.cfg/);
  assert.match(source, /test-suite-multi-computer-node-\$node_id\.cfg/);
  assert.match(source, /safe_symlink "\$INSTALLED_RUNNER" "\$COMMAND_PATH"/);
  assert.match(
    source,
    /safe_symlink[\s\\]+"\$INSTALLED_SETUP" "\$SETUP_COMMAND_PATH"/
  );
  assert.match(source, /--active-config-marker \$ACTIVE_CONFIG_MARKER/);
  assert.match(source, /verified application provisioning is required/i);
  assert.match(source, /--app ID=ABSOLUTE_ROOT/);
  assert.doesNotMatch(source, /--runner-source/);
  assert.doesNotMatch(source, /self-contained runner/i);
  assert.doesNotMatch(source, /--bootstrap/);
  assert.doesNotMatch(source, /\bshare\s*=/i);
});

test('installer validation matches the Linux config value boundaries', async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'seerrng-installer-contract-')
  );
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const contractDirectory = path.join(fixtureRoot, 'contract path $quoted');
  const contractScript = path.join(contractDirectory, 'validate-contract.sh');
  await mkdir(contractDirectory, { recursive: true });
  await writeFile(
    contractScript,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'source "$1"',
      'valid_ip_address 192.168.10.50',
      '! valid_ip_address 999.168.10.50',
      'valid_thread_rule n-1',
      'valid_thread_rule 2n',
      'valid_thread_rule 28',
      'valid_thread_rule 2n+1',
      '! valid_thread_rule 0',
      'valid_minimum_thread_count 1',
      'valid_minimum_thread_count 256',
      '! valid_minimum_thread_count 257',
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  const result = runBashScript(contractScript, [installer]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test(
  'real disposable install preserves module paths and loads help, controller config, and controller service',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));

    const installResult = await installAt(
      root,
      repositoryRoot,
      'controller',
      'automatic'
    );
    assert.equal(
      installResult.status,
      0,
      `${installResult.stdout}\n${installResult.stderr}`
    );
    assert.match(installResult.stdout, /systemd was not invoked/i);

    const appDirectory = path.join(root, 'usr/local/lib/seerrng-test-engine');
    const installedRunner = path.join(
      appDirectory,
      'bin/run-local-validation.mjs'
    );
    const installedSetup = path.join(
      appDirectory,
      'tools/validation-engine/setup/install-distributed-test-engine.sh'
    );
    const command = path.join(root, 'usr/local/bin/seerrng-test-engine');
    const setupCommand = path.join(
      root,
      'usr/local/sbin/seerrng-test-engine-setup'
    );
    assert.equal(await readlink(command), installedRunner);
    assert.equal(await readlink(setupCommand), installedSetup);
    await assert.rejects(
      readFile(path.join(appDirectory, 'seerrng-test-engine'), 'utf8'),
      { code: 'ENOENT' }
    );
    await assert.rejects(
      readFile(
        path.join(appDirectory, 'install-distributed-test-engine.sh'),
        'utf8'
      ),
      { code: 'ENOENT' }
    );

    for (const relativePath of [
      'bin/run-local-validation.mjs',
      'bin/local-validation.mjs',
      'bin/platform-tools.mjs',
    ]) {
      assert.equal(
        await readFile(path.join(appDirectory, relativePath), 'utf8'),
        await readFile(path.join(repositoryRoot, relativePath), 'utf8')
      );
    }
    const sourceRuntimeDirectory = path.join(
      repositoryRoot,
      'tools/validation-engine/runtime'
    );
    const installedRuntimeDirectory = path.join(
      appDirectory,
      'tools/validation-engine/runtime'
    );
    const runtimeNames = (await readdir(sourceRuntimeDirectory))
      .filter((name) => name.endsWith('.mjs'))
      .sort();
    assert.deepEqual(
      (await readdir(installedRuntimeDirectory)).sort(),
      runtimeNames
    );
    for (const runtimeName of runtimeNames) {
      assert.equal(
        await readFile(
          path.join(installedRuntimeDirectory, runtimeName),
          'utf8'
        ),
        await readFile(path.join(sourceRuntimeDirectory, runtimeName), 'utf8')
      );
    }

    const helpResult = runExecutable(command, ['--help']);
    assert.equal(
      helpResult.status,
      0,
      `${helpResult.stdout}\n${helpResult.stderr}`
    );
    assert.match(helpResult.stdout, /--distributed-controller-service/);
    const setupHelpResult = runExecutable(setupCommand, ['--help']);
    assert.equal(
      setupHelpResult.status,
      0,
      `${setupHelpResult.stdout}\n${setupHelpResult.stderr}`
    );
    assert.match(setupHelpResult.stdout, /--engine-source-root/);

    const port = await reserveLoopbackPort();
    const configureResult = runExecutable(
      setupCommand,
      ['--install-root', root, '--action', 'configure-controller', '--yes'],
      {
        input: [
          'JohnCronk79',
          "John's Laptop",
          '127.0.0.1',
          String(port),
          '2n',
          '1',
          '',
        ].join('\n'),
      }
    );
    assert.equal(
      configureResult.status,
      0,
      `${configureResult.stdout}\n${configureResult.stderr}`
    );

    const stateDirectory = path.join(root, 'var/lib/seerrng-test-engine');
    const logDirectory = path.join(root, 'var/log/seerrng-test-engine');
    const activeConfigMarker = path.join(stateDirectory, 'active-config');
    const expectedConfig = path.join(
      root,
      'etc/seerrng-test-engine/test-suite-multi-computer-JohnCronk79.cfg'
    );
    assert.equal(
      (await readFile(activeConfigMarker, 'utf8')).trim(),
      expectedConfig
    );
    assert.match(await readFile(expectedConfig, 'utf8'), /port = \d+/);

    const dependencyProfile = path.join(
      root,
      'seerrng-test-suite-dependancies.cfg'
    );
    await writeFile(
      dependencyProfile,
      '[Dependencies]\nnode = 24.21.0\npnpm = 10.24.0\n',
      'utf8'
    );
    const addApplicationResult = runExecutable(
      setupCommand,
      ['--install-root', root, '--action', 'manage-applications', '--yes'],
      {
        input: [
          '2',
          'M',
          dependencyProfile,
          'SeerrNG 3.3.0',
          "John's SeerrNG",
          '0',
          '',
        ].join('\n'),
      }
    );
    assert.equal(
      addApplicationResult.status,
      0,
      `${addApplicationResult.stdout}\n${addApplicationResult.stderr}`
    );
    assert.match(addApplicationResult.stdout, /\[ADDED\] John's SeerrNG/);
    assert.match(
      await readFile(expectedConfig, 'utf8'),
      /\[Application SeerrNG 3\.3\.0 Requirements\][\s\S]*node = 24\.21\.0[\s\S]*pnpm = 10\.24\.0/
    );

    const dependencyPlanResult = runExecutable(
      setupCommand,
      ['--install-root', root, '--action', 'install-dependencies', '--plan'],
      { input: '2\n' }
    );
    assert.equal(
      dependencyPlanResult.status,
      0,
      `${dependencyPlanResult.stdout}\n${dependencyPlanResult.stderr}`
    );
    assert.match(dependencyPlanResult.stdout, /node:\s+24\.21\.0/);
    assert.match(dependencyPlanResult.stdout, /pnpm:\s+10\.24\.0/);

    const serviceResult = await startControllerAndStop(command, [
      '--distributed-controller-service',
      '--active-config-marker',
      activeConfigMarker,
      '--state-root',
      stateDirectory,
      '--log-root',
      logDirectory,
    ]);
    assert.match(
      serviceResult.stdout,
      /controller enrollment service is listening on 127\.0\.0\.1:/
    );
    assert.equal(serviceResult.code, 0, serviceResult.stderr);
    assert.equal(serviceResult.signal, null);

    const role = await readFile(
      path.join(stateDirectory, 'installed-role'),
      'utf8'
    );
    const unit = await readFile(
      path.join(
        root,
        'etc/systemd/system/seerrng-test-engine-controller.service'
      ),
      'utf8'
    );
    assert.equal(role, 'controller\n');
    assert.match(unit, /--distributed-controller-service/);
    assert.match(unit, /--active-config-marker/);
    assert.equal(unit.match(/^ExecStart=/gm)?.length, 1);
    assert.match(unit, /Restart=on-failure/);
  }
);

test(
  'automatic node startup is rejected before installation or service writes',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);

    const result = await installAt(root, sourceRoot, 'node', 'automatic');
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /automatic node startup is deferred; verified application provisioning is required before an explicit --app ID=ABSOLUTE_ROOT binding can be started; select manual startup/
    );

    for (const unwrittenPath of [
      path.join(root, 'usr/local/lib/seerrng-test-engine'),
      path.join(root, 'usr/local/bin/seerrng-test-engine'),
      path.join(root, 'etc/systemd/system/seerrng-test-engine-node.service'),
    ]) {
      await assert.rejects(readFile(unwrittenPath, 'utf8'), { code: 'ENOENT' });
    }
  }
);

test(
  'manual node install writes no unit and prints the exact explicit application command',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);

    const result = await installAt(root, sourceRoot, 'node', 'manual');
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes(manualNodeCommand(root)));
    assert.match(result.stdout, /Configuration remains incomplete/);
    await assert.rejects(
      readFile(
        path.join(root, 'etc/systemd/system/seerrng-test-engine-node.service'),
        'utf8'
      ),
      { code: 'ENOENT' }
    );
  }
);

test(
  'disposable install preserves an unknown application directory',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const unknownDirectory = path.join(
      root,
      'usr/local/lib/seerrng-test-engine'
    );
    await mkdir(unknownDirectory, { recursive: true });
    const sentinel = path.join(unknownDirectory, 'do-not-touch');
    await writeFile(sentinel, 'preserve me\n', 'utf8');

    const result = await installAt(root, sourceRoot, 'node');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown installation and was preserved/i);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve me\n');
  }
);

test(
  'Configure Node sends addressing and identity but no thread assignment or key',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'node');
    assert.equal(installResult.status, 0, installResult.stderr);

    const configureResult = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-node', '--yes'],
      { input: nodeConfigurationInput() }
    );
    assert.equal(
      configureResult.status,
      0,
      `${configureResult.stdout}\n${configureResult.stderr}`
    );

    const installedCommand = path.join(
      root,
      'usr/local/bin/seerrng-test-engine'
    );
    const arguments_ = await readFile(`${installedCommand}.arguments`, 'utf8');
    assert.match(arguments_, /--distributed-configure-node/);
    assert.match(arguments_, /--node-id\n01/);
    assert.match(arguments_, /--controller-address\n192\.168\.10\.50/);
    assert.match(arguments_, /test-suite-multi-computer-node-01\.cfg/);
    assert.doesNotMatch(arguments_, /thread-rule|minimum-thread|secret|key/i);
    assert.ok(configureResult.stdout.includes(manualNodeCommand(root)));
  }
);

test(
  'occupied Node number is preserved when the installer choice defaults to preserve',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'node');
    assert.equal(installResult.status, 0, installResult.stderr);
    const log = path.join(root, 'occupied-decline.arguments');

    const configureResult = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-node', '--yes'],
      {
        env: {
          ...process.env,
          SEERRNG_FAKE_RUNNER_LOG: log,
          SEERRNG_FAKE_RUNNER_STATUS: '20',
        },
        input: nodeConfigurationInput(),
      }
    );

    assert.equal(configureResult.status, 20);
    assert.match(
      configureResult.stderr,
      /Node 01 is already occupied by another address\./
    );
    assert.match(configureResult.stdout, /Preserve the existing Node 01/);
    assert.match(
      configureResult.stdout,
      /Overwrite Node 01 with this computer/
    );
    assert.match(configureResult.stderr, /registration was preserved/);
    const arguments_ = await readFile(log, 'utf8');
    assert.equal(arguments_.match(/^--- invocation ---$/gm)?.length, 1);
    assert.doesNotMatch(arguments_, /--overwrite-node/);
  }
);

test(
  'installer overwrite selection retries once with both internal engine flags',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'node');
    assert.equal(installResult.status, 0, installResult.stderr);
    const log = path.join(root, 'occupied-overwrite.arguments');

    const configureResult = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-node', '--yes'],
      {
        env: {
          ...process.env,
          SEERRNG_FAKE_RUNNER_LOG: log,
          SEERRNG_FAKE_RUNNER_CONFLICT_ONCE: '1',
        },
        input: `${nodeConfigurationInput()}2\n`,
      }
    );

    assert.equal(
      configureResult.status,
      0,
      `${configureResult.stdout}\n${configureResult.stderr}`
    );
    const invocations = (await readFile(log, 'utf8'))
      .split('--- invocation ---\n')
      .filter(Boolean);
    assert.equal(invocations.length, 2);
    assert.doesNotMatch(invocations[0], /--overwrite-node/);
    assert.doesNotMatch(invocations[0], /--allow-existing-config-update/);
    assert.match(invocations[1], /--allow-existing-config-update/);
    assert.match(invocations[1], /--overwrite-node/);
  }
);

test('overwrite is not exposed as an installer launch option', () => {
  const result = runBashScript(installer, [
    '--plan',
    '--action',
    'configure-node',
    '--overwrite-node',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown option: --overwrite-node/);
});

test(
  'non-conflict runner failures propagate without an overwrite retry',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'node');
    assert.equal(installResult.status, 0, installResult.stderr);
    const log = path.join(root, 'other-error.arguments');

    const configureResult = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-node', '--yes'],
      {
        env: {
          ...process.env,
          SEERRNG_FAKE_RUNNER_LOG: log,
          SEERRNG_FAKE_RUNNER_STATUS: '37',
        },
        input: nodeConfigurationInput(),
      }
    );

    assert.equal(configureResult.status, 37);
    assert.match(configureResult.stderr, /fake runner failure 37/);
    assert.doesNotMatch(
      `${configureResult.stdout}\n${configureResult.stderr}`,
      /NODE NUMBER CONFLICT|--overwrite-node/
    );
    const arguments_ = await readFile(log, 'utf8');
    assert.equal(arguments_.match(/^--- invocation ---$/gm)?.length, 1);
  }
);

test(
  'Configure Controller owns profile naming and thread policy inputs',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'controller');
    assert.equal(installResult.status, 0, installResult.stderr);

    const configureResult = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-controller', '--yes'],
      {
        input: [
          'JohnCronk79',
          "John's Laptop",
          '192.168.10.50',
          '62021',
          '2n',
          '1',
          '',
        ].join('\n'),
      }
    );
    assert.equal(
      configureResult.status,
      0,
      `${configureResult.stdout}\n${configureResult.stderr}`
    );

    const installedCommand = path.join(
      root,
      'usr/local/bin/seerrng-test-engine'
    );
    const arguments_ = await readFile(`${installedCommand}.arguments`, 'utf8');
    assert.match(arguments_, /--distributed-configure-controller/);
    assert.match(arguments_, /--profile\nJohnCronk79/);
    assert.match(arguments_, /test-suite-multi-computer-JohnCronk79\.cfg/);
    assert.match(arguments_, /--thread-rule\n2n/);
    assert.match(arguments_, /--minimum-thread-count\n1/);
    assert.doesNotMatch(arguments_, /secret|key/i);
  }
);

test(
  'Configure Controller assigns an enrolled node thread policy through the engine',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'controller');
    assert.equal(installResult.status, 0, installResult.stderr);

    const stateDirectory = path.join(root, 'var/lib/seerrng-test-engine');
    const configDirectory = path.join(root, 'etc/seerrng-test-engine');
    const activeConfig = path.join(stateDirectory, 'active-config');
    const controllerConfig = path.join(
      configDirectory,
      'test-suite-multi-computer-JohnCronk79.cfg'
    );
    await writeFile(controllerConfig, '[fake controller]\n', 'utf8');
    await writeFile(activeConfig, `${controllerConfig}\n`, 'utf8');

    const log = path.join(root, 'node-thread-policy.arguments');
    const result = runBashScript(
      installer,
      ['--install-root', root, '--action', 'configure-controller', '--yes'],
      {
        env: { ...process.env, SEERRNG_FAKE_RUNNER_LOG: log },
        input: ['2', '1', 'n-2', '2', ''].join('\n'),
      }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Node 01 thread policy completed/);

    const invocations = (await readFile(log, 'utf8'))
      .split('--- invocation ---\n')
      .filter(Boolean);
    assert.equal(invocations.length, 2);
    assert.match(invocations[0], /--distributed-node-thread-policy/);
    assert.match(invocations[0], /--json/);
    assert.doesNotMatch(invocations[0], /--node-id/);
    assert.match(invocations[1], /--distributed-node-thread-policy/);
    assert.match(invocations[1], /--node-id\n01/);
    assert.match(invocations[1], /--thread-rule\nn-2/);
    assert.match(invocations[1], /--minimum-thread-count\n2/);
  }
);

test(
  'controller application menu adds a repository-owned dependency profile through the engine',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'controller');
    assert.equal(installResult.status, 0, installResult.stderr);

    const stateDirectory = path.join(root, 'var/lib/seerrng-test-engine');
    const configDirectory = path.join(root, 'etc/seerrng-test-engine');
    const activeConfig = path.join(stateDirectory, 'active-config');
    const controllerConfig = path.join(
      configDirectory,
      'test-suite-multi-computer-JohnCronk79.cfg'
    );
    await writeFile(controllerConfig, '[fake controller]\n', 'utf8');
    await writeFile(activeConfig, `${controllerConfig}\n`, 'utf8');
    const profile = path.join(root, 'seerrng-test-suite-dependancies.cfg');
    await writeFile(profile, '[Dependencies]\nnode = 24.21.0\n', 'utf8');

    const result = runBashScript(
      installer,
      ['--install-root', root, '--action', 'manage-applications', '--yes'],
      {
        input: [
          '2',
          'M',
          profile,
          'SeerrNG 3.3.0',
          "John's SeerrNG",
          '0',
          '',
        ].join('\n'),
      }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[ADDED\] John's SeerrNG/);

    const command = path.join(root, 'usr/local/bin/seerrng-test-engine');
    const arguments_ = await readFile(`${command}.arguments`, 'utf8');
    assert.match(arguments_, /--distributed-app-add/);
    assert.match(arguments_, /--active-config-marker/);
    assert.match(arguments_, /--application-id\nSeerrNG 3\.3\.0/);
    assert.match(arguments_, /--application-name\nJohn's SeerrNG/);
    assert.ok(arguments_.includes(`--dependency-profile\n${profile}`));
    assert.match(arguments_, /--json/);
  }
);

test(
  'dependency menu resolves the all-applications plan without changing the host in plan mode',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'seerrng-installer-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const sourceRoot = await createFakeEngineSource(root);
    const installResult = await installAt(root, sourceRoot, 'node');
    assert.equal(installResult.status, 0, installResult.stderr);

    const stateDirectory = path.join(root, 'var/lib/seerrng-test-engine');
    const configDirectory = path.join(root, 'etc/seerrng-test-engine');
    const activeConfig = path.join(stateDirectory, 'active-config');
    const nodeConfig = path.join(
      configDirectory,
      'test-suite-multi-computer-node-01.cfg'
    );
    await writeFile(nodeConfig, '[fake node]\n', 'utf8');
    await writeFile(activeConfig, `${nodeConfig}\n`, 'utf8');

    const result = runBashScript(
      installer,
      ['--install-root', root, '--action', 'install-dependencies', '--plan'],
      { input: '2\n' }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /DEPENDENCY INSTALLATION PLAN/);
    assert.match(result.stdout, /node:\s+24\.21\.0/);
    assert.match(
      result.stdout,
      /\[PLAN COMPLETE\] No dependencies were changed/
    );

    const command = path.join(root, 'usr/local/bin/seerrng-test-engine');
    const arguments_ = await readFile(`${command}.arguments`, 'utf8');
    assert.match(arguments_, /--distributed-dependency-plan/);
    assert.match(arguments_, /--all-applications/);
    assert.match(arguments_, /--active-config-marker/);
  }
);
