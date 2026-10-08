import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  persistControllerConfigFile,
  readControllerConfigFile,
  readNodeConfigFile,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  activateAcceptedLinuxNodeEnrollment,
  createPendingLinuxNode,
} from '../tools/validation-engine/runtime/distributed-linux-management.mjs';
import { dispatchDistributedLinuxPublicRun } from './run-local-validation.mjs';

const cli = fileURLToPath(
  new URL('./run-local-validation.mjs', import.meta.url)
);
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function runCli(args, { env = process.env } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-mode3-cli-'));
  const configRoot = join(root, 'config');
  const stateRoot = join(root, 'state');
  const logRoot = join(root, 'log');
  const secondNodeRoot = join(root, 'second-node');
  for (const directory of [configRoot, stateRoot, logRoot, secondNodeRoot])
    mkdirSync(directory);
  return {
    root,
    configRoot,
    stateRoot,
    logRoot,
    secondNodeRoot,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  );
  return address.port;
}

function waitForReady(child, pattern) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      cleanup();
      rejectReady(
        new Error(`Timed out waiting for service readiness: ${stdout}${stderr}`)
      );
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };
    const onStdout = (chunk) => {
      stdout += chunk;
      if (pattern.test(stdout)) {
        cleanup();
        resolveReady({ stdout, stderr });
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk;
    };
    const onExit = (code, signal) => {
      cleanup();
      rejectReady(
        new Error(
          `Service exited before readiness (${code ?? signal}): ${stdout}${stderr}`
        )
      );
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

test('help documents the Linux controller and node lifecycle', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--distributed-configure-controller/);
  assert.match(result.stdout, /--distributed-configure-node/);
  assert.match(result.stdout, /--distributed-controller-service/);
  assert.match(result.stdout, /--distributed-run/);
  assert.match(result.stdout, /--distributed-node/);
  assert.match(result.stdout, /--distributed-node-thread-policy/);
  assert.match(result.stdout, /--distributed-applications/);
  assert.match(result.stdout, /--distributed-app-add/);
  assert.match(result.stdout, /--distributed-app-delete/);
  assert.match(result.stdout, /--distributed-dependency-plan/);
  assert.match(result.stdout, /--distributed-dependency-report/);
  assert.match(result.stdout, /--app ID=ABSOLUTE_ROOT/);
  assert.match(result.stdout, /conflict exits with status 20/);
  assert.match(result.stdout, /thread and worker overrides are forbidden/);
  assert.doesNotMatch(result.stdout, /--distributed-contained-run/);
});

test('README public pnpm launch matches the CLI contract without a separator argument', () => {
  const readme = readFileSync(
    resolve(repositoryRoot, 'tools/validation-engine/README.md'),
    'utf8'
  );
  const documentedCommand = readme
    .split(/\r?\n/)
    .find((line) =>
      line.startsWith('pnpm validate:development --distributed-run')
    );
  assert.ok(
    documentedCommand,
    'README must document the public Mode 3 command'
  );
  assert.doesNotMatch(readme, /pnpm validate:development -- --distributed-run/);

  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes(
      documentedCommand.replace(
        'pnpm validate:development',
        'node bin/run-local-validation.mjs'
      )
    ),
    'README public Mode 3 command must match CLI help'
  );
});

test('internal contained mode stays hidden and fails closed at its same-entrypoint boundary', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const missingRequest = join(
    paths.stateRoot,
    'missing-contained-request.json'
  );
  const result = runCli([
    '--distributed-contained-run',
    '--request-file',
    missingRequest,
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    process.platform === 'linux' ? /fixed internal request/ : /requires Linux/
  );

  const override = runCli([
    '--distributed-contained-run',
    '--request-file',
    missingRequest,
    '--thread-rule',
    '2n',
  ]);
  assert.equal(override.status, 1);
  assert.match(
    override.stderr,
    /Internal distributed contained run mode does not accept --thread-rule/
  );
});

test('distributed production mode requires one application and rejects override options', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const marker = join(paths.stateRoot, 'active-controller');
  writeFileSync(marker, 'focused-controller.cfg\n');
  const base = [
    '--distributed-run',
    '--active-config-marker',
    marker,
    '--state-root',
    paths.stateRoot,
    '--log-root',
    paths.logRoot,
  ];

  const missing = runCli(base);
  assert.equal(missing.status, 1);
  assert.match(
    missing.stderr,
    /Distributed production run mode requires --application/
  );

  const multiple = runCli([
    ...base,
    '--application',
    '01',
    '--application',
    '02',
  ]);
  assert.equal(multiple.status, 1);
  assert.match(multiple.stderr, /requires exactly one --application/);

  const threadOverride = runCli([
    ...base,
    '--application',
    '01',
    '--thread-rule',
    '2n',
  ]);
  assert.equal(threadOverride.status, 1);
  assert.match(
    threadOverride.stderr,
    /Distributed production run mode does not accept --thread-rule/
  );

  const relativeState = runCli([
    '--distributed-run',
    '--active-config-marker',
    marker,
    '--state-root',
    'relative-state',
    '--log-root',
    paths.logRoot,
    '--application',
    '01',
  ]);
  assert.equal(relativeState.status, 1);
  assert.match(
    relativeState.stderr,
    /State root must be an absolute canonical directory/
  );
});

test('distributed public dispatch derives and seals the minimal run request', async (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const marker = join(paths.stateRoot, 'active-controller');
  writeFileSync(marker, 'focused-controller.cfg\n');
  const signal = new AbortController().signal;
  let received;
  const execution = await dispatchDistributedLinuxPublicRun(
    {
      activeConfigMarkerPath: marker,
      applicationEntryId: '01',
      logRoot: paths.logRoot,
      sourceRoot: repositoryRoot,
      stateRoot: paths.stateRoot,
      signal,
    },
    {
      uniqueId: () => '00000000-0000-4000-8000-000000000001',
      executeLifecycle: async (request) => {
        received = request;
        return Object.freeze({
          runId: request.runId,
          status: 'passed',
        });
      },
    }
  );

  assert.deepEqual(Object.keys(received).sort(), [
    'activeConfigMarkerPath',
    'applicationEntryId',
    'logRoot',
    'runId',
    'runtimeApplicationKey',
    'signal',
    'sourceRoot',
    'stateRoot',
  ]);
  assert.equal(received.activeConfigMarkerPath, marker);
  assert.equal(received.applicationEntryId, '01');
  assert.equal(received.logRoot, paths.logRoot);
  assert.equal(received.runId, 'mode3-00000000-0000-4000-8000-000000000001');
  assert.equal(received.runtimeApplicationKey, 'seerrng');
  assert.equal(received.signal, signal);
  assert.equal(received.sourceRoot, repositoryRoot);
  assert.equal(received.stateRoot, paths.stateRoot);
  assert.equal(Object.isFrozen(received), true);
  assert.equal(execution.request, received);
  assert.equal(execution.result.status, 'passed');
});

test('distributed public dispatch fails closed before or after the lifecycle seam', async (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const marker = join(paths.stateRoot, 'active-controller');
  writeFileSync(marker, 'focused-controller.cfg\n');
  let calls = 0;
  const common = {
    activeConfigMarkerPath: marker,
    applicationEntryId: '01',
    logRoot: paths.logRoot,
    sourceRoot: repositoryRoot,
    stateRoot: paths.stateRoot,
  };
  const dependencies = {
    uniqueId: () => '00000000-0000-4000-8000-000000000002',
    executeLifecycle: async (request) => {
      calls += 1;
      return { runId: request.runId, status: 'incomplete' };
    },
  };

  await assert.rejects(
    dispatchDistributedLinuxPublicRun(
      { ...common, stateRoot: 'relative-state' },
      dependencies
    ),
    /State root must be an absolute canonical directory/
  );
  assert.equal(calls, 0);

  if (process.platform === 'win32') {
    await assert.rejects(
      dispatchDistributedLinuxPublicRun(
        { ...common, stateRoot: common.stateRoot.replaceAll('\\', '\\\\') },
        dependencies
      ),
      /State root must be an absolute canonical directory/
    );
    assert.equal(calls, 0);
  }

  await assert.rejects(
    dispatchDistributedLinuxPublicRun(common, dependencies),
    /did not return the exact passing run result/
  );
  assert.equal(calls, 1);
});

test('dependency planning requires entries or all, never both', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const marker = join(paths.stateRoot, 'active-controller');
  const neither = runCli([
    '--distributed-dependency-plan',
    '--active-config-marker',
    marker,
    '--json',
  ]);
  assert.equal(neither.status, 1);
  assert.match(
    neither.stderr,
    /exactly one of --application or --all-applications/
  );

  const both = runCli([
    '--distributed-dependency-plan',
    '--active-config-marker',
    marker,
    '--application',
    '01',
    '--all-applications',
    '--json',
  ]);
  assert.equal(both.status, 1);
  assert.match(
    both.stderr,
    /exactly one of --application or --all-applications/
  );
});

test('node thread-policy assignment requires a complete policy tuple', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const result = runCli([
    '--distributed-node-thread-policy',
    '--active-config-marker',
    join(paths.stateRoot, 'active-controller'),
    '--node-id',
    '01',
    '--thread-rule',
    'n-1',
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /requires node ID, thread rule, and minimum thread count together/
  );
});

test('node thread-policy CLI lists and updates an enrolled controller node', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const controllerPath = join(
    paths.configRoot,
    'test-suite-multi-computer-CliTester.cfg'
  );
  const marker = join(paths.stateRoot, 'active-controller');
  persistControllerConfigFile(controllerPath, {
    global: {
      githubUsername: 'CliTester',
      computerName: 'Focused controller',
      ipAddress: '127.0.0.1',
      port: 62021,
      cpuName: 'Focused controller CPU',
      availableThreads: 12,
      threads: '2n',
      minimumThreadCount: 1,
    },
    nodes: [
      {
        nodeNumber: '01',
        computerName: 'Focused node',
        ipAddress: '127.0.0.2',
        port: 62021,
        cpuName: 'Focused node CPU',
        availableThreads: 8,
        threads: null,
        minimumThreadCount: null,
      },
    ],
    sharedAuthenticationKey: 'a'.repeat(64),
  });
  writeFileSync(marker, `${controllerPath}\n`, { mode: 0o600 });

  const listed = runCli([
    '--distributed-node-thread-policy',
    '--active-config-marker',
    marker,
    '--json',
  ]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).nodes[0].threads, null);

  const updated = runCli([
    '--distributed-node-thread-policy',
    '--active-config-marker',
    marker,
    '--node-id',
    '01',
    '--thread-rule',
    'n-2',
    '--minimum-thread-count',
    '2',
    '--json',
  ]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.deepEqual(JSON.parse(updated.stdout).node, {
    ...readControllerConfigFile(controllerPath).nodes[0],
  });
  assert.equal(
    readControllerConfigFile(controllerPath).nodes[0].threads,
    'n-2'
  );
});

test(
  'Windows package-script path transport restores only fully doubled separators',
  { skip: process.platform !== 'win32' },
  (t) => {
    const paths = fixture();
    t.after(paths.cleanup);
    const controllerPath = join(
      paths.configRoot,
      'test-suite-multi-computer-CliTransport.cfg'
    );
    const marker = join(paths.stateRoot, 'active-controller');
    persistControllerConfigFile(controllerPath, {
      global: {
        githubUsername: 'CliTransport',
        computerName: 'Transport controller',
        ipAddress: '127.0.0.1',
        port: 62021,
        cpuName: 'Transport controller CPU',
        availableThreads: 12,
        threads: '2n',
        minimumThreadCount: 1,
      },
      nodes: [],
      sharedAuthenticationKey: 'a'.repeat(64),
    });
    writeFileSync(marker, `${controllerPath}\n`, { mode: 0o600 });

    const doubledMarker = marker.replaceAll('\\', '\\\\');
    const doubledArguments = [
      '--distributed-node-thread-policy',
      '--active-config-marker',
      doubledMarker,
      '--json',
    ];
    const directEnvironment = { ...process.env };
    delete directEnvironment.npm_config_user_agent;
    delete directEnvironment.npm_execpath;
    delete directEnvironment.npm_lifecycle_event;
    const pnpmEnvironment = {
      ...directEnvironment,
      npm_config_user_agent: 'pnpm/10.24.0 npm/? node/v24.19.0 win32 x64',
      npm_lifecycle_event: 'validate:development',
    };
    const restored = runCli(doubledArguments, {
      env: pnpmEnvironment,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout), { nodes: [] });

    const direct = runCli(doubledArguments, { env: directEnvironment });
    assert.equal(direct.status, 1);
    assert.match(direct.stderr, /absolute canonical file path/);

    // Deliberately duplicate exactly one separator for the rejection case.
    const firstSeparator = marker.indexOf('\\');
    assert.notEqual(firstSeparator, -1);
    const partlyDoubledMarker =
      marker.slice(0, firstSeparator + 1) +
      '\\' +
      marker.slice(firstSeparator + 1);
    assert.notEqual(partlyDoubledMarker, doubledMarker);
    const rejected = runCli(
      [
        '--distributed-node-thread-policy',
        '--active-config-marker',
        partlyDoubledMarker,
        '--json',
      ],
      { env: pnpmEnvironment }
    );
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /absolute canonical file path/);
  }
);

test('node service requires explicit application bindings and never infers a repository', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const result = runCli([
    '--distributed-node',
    '--active-config-marker',
    join(paths.stateRoot, 'active-node'),
    '--state-root',
    paths.stateRoot,
    '--log-root',
    paths.logRoot,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Distributed node service mode requires --app/);
});

test('node service accepts repeatable explicit application bindings', (t) => {
  const paths = fixture();
  t.after(paths.cleanup);
  const result = runCli([
    '--distributed-node',
    '--active-config-marker',
    join(paths.stateRoot, 'missing-active-node'),
    '--state-root',
    paths.stateRoot,
    '--log-root',
    paths.logRoot,
    '--app',
    `seerrng=${paths.root}`,
    '--app',
    `another=${paths.secondNodeRoot}`,
  ]);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /exactly one --app/);
  assert.match(
    result.stderr,
    process.platform === 'linux' ? /ENOENT|no such file/i : /requires Linux/
  );
});

test(
  'Linux node service starts from its active marker and closes cleanly on SIGTERM',
  {
    skip:
      process.platform !== 'linux' ||
      !process.env.SEERRNG_MODE3_CLEAN_APPLICATION_ROOT,
  },
  async (t) => {
    const paths = fixture();
    t.after(paths.cleanup);
    const port = await unusedLoopbackPort();
    const nodePath = join(
      paths.configRoot,
      'test-suite-multi-computer-node-01.cfg'
    );
    const nodeMarker = join(paths.stateRoot, 'active-node-01');
    const pending = createPendingLinuxNode({
      configPath: nodePath,
      controller: { ipAddress: '127.0.0.2', port: 62021 },
      node: {
        nodeNumber: '01',
        computerName: 'Focused CLI node',
        ipAddress: '127.0.0.1',
        port,
      },
    });
    activateAcceptedLinuxNodeEnrollment({
      configPath: nodePath,
      activeConfigMarkerPath: nodeMarker,
      pendingConfig: pending,
      response: {
        status: 'accepted',
        disposition: 'created',
        nodeNumber: '01',
        sharedAuthenticationKey: 'a'.repeat(64),
      },
    });

    const service = spawn(
      process.execPath,
      [
        cli,
        '--distributed-node',
        '--active-config-marker',
        nodeMarker,
        '--state-root',
        paths.stateRoot,
        '--log-root',
        paths.logRoot,
        '--app',
        `seerrng=${process.env.SEERRNG_MODE3_CLEAN_APPLICATION_ROOT}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    t.after(() => {
      if (service.exitCode === null) service.kill('SIGTERM');
    });
    const ready = await waitForReady(service, /node-01 is listening/);
    assert.doesNotMatch(`${ready.stdout}${ready.stderr}`, /a{64}/);

    const stoppedPromise = waitForExit(service);
    service.kill('SIGTERM');
    const stopped = await stoppedPromise;
    assert.equal(stopped.signal, null);
    assert.equal(stopped.code, 0);
  }
);

test(
  'Linux CLI configures, serves, enrolls, reports conflict, and explicitly overwrites a node',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const paths = fixture();
    t.after(paths.cleanup);
    const port = await unusedLoopbackPort();
    const controllerPath = join(
      paths.configRoot,
      'test-suite-multi-computer-CliTester.cfg'
    );
    const controllerMarker = join(paths.stateRoot, 'active-controller');
    const controllerArgs = [
      '--distributed-configure-controller',
      '--config-file',
      controllerPath,
      '--profile',
      'CliTester',
      '--controller-name',
      'Test controller',
      '--listen-address',
      '127.0.0.1',
      '--listen-port',
      String(port),
      '--thread-rule',
      '2n',
      '--minimum-thread-count',
      '1',
      '--active-config-marker',
      controllerMarker,
      '--state-root',
      paths.stateRoot,
      '--log-root',
      paths.logRoot,
    ];

    const configured = runCli(controllerArgs);
    assert.equal(configured.status, 0, configured.stderr);
    assert.match(configured.stdout, /controller .* configured and active/i);
    assert.doesNotMatch(
      `${configured.stdout}${configured.stderr}`,
      /[a-f0-9]{64}/
    );
    const originalController = readControllerConfigFile(controllerPath);

    const refusedUpdate = runCli(controllerArgs);
    assert.equal(refusedUpdate.status, 1);
    assert.match(refusedUpdate.stderr, /allowExistingUpdate is required/);
    assert.equal(
      readControllerConfigFile(controllerPath).sharedAuthenticationKey,
      originalController.sharedAuthenticationKey
    );

    const updated = runCli([
      ...controllerArgs,
      '--allow-existing-config-update',
    ]);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(
      readControllerConfigFile(controllerPath).sharedAuthenticationKey,
      originalController.sharedAuthenticationKey
    );

    const service = spawn(
      process.execPath,
      [
        cli,
        '--distributed-controller-service',
        '--active-config-marker',
        controllerMarker,
        '--state-root',
        paths.stateRoot,
        '--log-root',
        paths.logRoot,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    t.after(() => {
      if (service.exitCode === null) service.kill('SIGTERM');
    });
    const ready = await waitForReady(
      service,
      /enrollment service is listening/
    );
    assert.doesNotMatch(`${ready.stdout}${ready.stderr}`, /[a-f0-9]{64}/);

    const nodePath = join(
      paths.configRoot,
      'test-suite-multi-computer-node-01.cfg'
    );
    const nodeMarker = join(paths.stateRoot, 'active-node-01');
    const nodeArgs = [
      '--distributed-configure-node',
      '--config-file',
      nodePath,
      '--node-id',
      '01',
      '--node-name',
      'First test node',
      '--listen-address',
      '127.0.0.2',
      '--listen-port',
      String(port),
      '--controller-address',
      '127.0.0.1',
      '--controller-port',
      String(port),
      '--active-config-marker',
      nodeMarker,
      '--state-root',
      paths.stateRoot,
      '--log-root',
      paths.logRoot,
    ];
    const enrolled = runCli(nodeArgs);
    assert.equal(enrolled.status, 0, enrolled.stderr);
    assert.match(enrolled.stdout, /node 01 is enrolled and active/i);
    assert.doesNotMatch(`${enrolled.stdout}${enrolled.stderr}`, /[a-f0-9]{64}/);
    assert.equal(
      readNodeConfigFile(nodePath).sharedAuthenticationKey,
      originalController.sharedAuthenticationKey
    );

    const listedPolicies = runCli([
      '--distributed-node-thread-policy',
      '--active-config-marker',
      controllerMarker,
      '--json',
    ]);
    assert.equal(listedPolicies.status, 0, listedPolicies.stderr);
    assert.deepEqual(JSON.parse(listedPolicies.stdout).nodes[0], {
      ...readControllerConfigFile(controllerPath).nodes[0],
    });
    const assignedPolicy = runCli([
      '--distributed-node-thread-policy',
      '--active-config-marker',
      controllerMarker,
      '--node-id',
      '01',
      '--thread-rule',
      'n-2',
      '--minimum-thread-count',
      '2',
      '--json',
    ]);
    assert.equal(assignedPolicy.status, 0, assignedPolicy.stderr);
    assert.equal(JSON.parse(assignedPolicy.stdout).node.threads, 'n-2');
    assert.equal(
      readControllerConfigFile(controllerPath).nodes[0].minimumThreadCount,
      2
    );

    const beforeRejectedUpdate = readFileSync(nodePath);
    const beforeRejectedMarker = readFileSync(nodeMarker);
    const rejectedUpdate = runCli([
      ...nodeArgs.map((argument) =>
        argument === 'First test node'
          ? 'Rejected replacement node'
          : argument === '127.0.0.2'
            ? '127.0.0.4'
            : argument
      ),
      '--allow-existing-config-update',
    ]);
    assert.equal(rejectedUpdate.status, 20, rejectedUpdate.stderr);
    assert.deepEqual(readFileSync(nodePath), beforeRejectedUpdate);
    assert.deepEqual(readFileSync(nodeMarker), beforeRejectedMarker);

    const conflictingNodePath = join(
      paths.secondNodeRoot,
      'test-suite-multi-computer-node-01.cfg'
    );
    const conflictingNodeMarker = join(paths.stateRoot, 'active-conflict');
    const conflictingNodeArgs = [
      '--distributed-configure-node',
      '--config-file',
      conflictingNodePath,
      '--node-id',
      '01',
      '--node-name',
      'Replacement test node',
      '--listen-address',
      '127.0.0.3',
      '--listen-port',
      String(port),
      '--controller-address',
      '127.0.0.1',
      '--controller-port',
      String(port),
      '--active-config-marker',
      conflictingNodeMarker,
      '--state-root',
      paths.stateRoot,
      '--log-root',
      paths.logRoot,
    ];
    const conflict = runCli(conflictingNodeArgs);
    assert.equal(conflict.status, 20, conflict.stderr);
    assert.match(conflict.stderr, /Node 01 is already assigned/);
    assert.match(conflict.stderr, /--overwrite-node/);
    assert.doesNotMatch(`${conflict.stdout}${conflict.stderr}`, /[a-f0-9]{64}/);
    assert.equal(existsSync(conflictingNodeMarker), false);
    assert.equal(existsSync(conflictingNodePath), false);

    const overwritten = runCli([
      ...conflictingNodeArgs,
      '--allow-existing-config-update',
      '--overwrite-node',
    ]);
    assert.equal(overwritten.status, 0, overwritten.stderr);
    assert.equal(
      readNodeConfigFile(conflictingNodePath).sharedAuthenticationKey,
      originalController.sharedAuthenticationKey
    );
    assert.equal(existsSync(conflictingNodeMarker), true);
    const finalController = readControllerConfigFile(controllerPath);
    assert.equal(finalController.nodes.length, 1);
    assert.equal(finalController.nodes[0].nodeNumber, '01');
    assert.equal(finalController.nodes[0].ipAddress, '127.0.0.3');
    assert.equal(finalController.nodes[0].threads, null);
    assert.equal(finalController.nodes[0].minimumThreadCount, null);

    const beforeUnavailableUpdate = readFileSync(nodePath);
    const beforeUnavailableMarker = readFileSync(nodeMarker);

    const stoppedPromise = waitForExit(service);
    service.kill('SIGTERM');
    const stopped = await stoppedPromise;
    assert.equal(stopped.signal, null);
    assert.equal(stopped.code, 0);

    const unavailableUpdate = runCli([
      ...nodeArgs.map((argument) =>
        argument === 'First test node' ? 'Unavailable update node' : argument
      ),
      '--allow-existing-config-update',
    ]);
    assert.equal(unavailableUpdate.status, 1);
    assert.match(unavailableUpdate.stderr, /ECONNREFUSED|connect/i);
    assert.deepEqual(readFileSync(nodePath), beforeUnavailableUpdate);
    assert.deepEqual(readFileSync(nodeMarker), beforeUnavailableMarker);
  }
);

test(
  'new configuration modes fail closed outside Linux before touching files',
  { skip: process.platform === 'linux' },
  (t) => {
    const paths = fixture();
    t.after(paths.cleanup);
    const controllerPath = join(
      paths.configRoot,
      'test-suite-multi-computer-CliTester.cfg'
    );
    const result = runCli([
      '--distributed-configure-controller',
      '--config-file',
      controllerPath,
      '--profile',
      'CliTester',
      '--controller-name',
      'Test controller',
      '--listen-address',
      '127.0.0.1',
      '--listen-port',
      '62021',
      '--thread-rule',
      '2n',
      '--minimum-thread-count',
      '1',
      '--active-config-marker',
      join(paths.stateRoot, 'active-controller'),
      '--state-root',
      paths.stateRoot,
      '--log-root',
      paths.logRoot,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires Linux/);
    assert.equal(existsSync(controllerPath), false);
  }
);
