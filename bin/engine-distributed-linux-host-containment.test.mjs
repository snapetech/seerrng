import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
  DISTRIBUTED_LINUX_HOST_FINAL_MARKER,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA,
  createDistributedLinuxHostContainment,
  createDistributedLinuxHostContainmentCallbacks,
  createDistributedLinuxHostContainmentPlan,
  createDistributedLinuxProofParentConfig,
  createDistributedLinuxProofSocketAdapter,
  executeDistributedLinuxHostContainment,
} from '../tools/validation-engine/runtime/distributed-linux-host-containment.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
  distributedLinuxPrettyJsonBytes,
} from '../tools/validation-engine/runtime/distributed-linux-host-preparation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROOF_PARENT = join(
  ROOT,
  'tools',
  'validation-engine',
  'container',
  'mode3-proof-parent.py'
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (character) => character.repeat(64);
const hash40 = (character) => character.repeat(40);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}

const canonicalBytes = (value) =>
  Buffer.from(`${JSON.stringify(canonical(value))}\n`);

function gitEvidence(candidate) {
  const tagOid = hash40('5');
  return {
    schema: 1,
    repository: candidate.repository,
    branch: candidate.branch,
    commit: candidate.commit,
    tree: candidate.tree,
    lockSha256: candidate.lockSha256,
    fetchedUsing: 'authenticated Git fetch --tags',
    shallow: false,
    beforeAfterRemoteRefsVerified: true,
    publishedBranchVerified: true,
    authenticatedCloneVerified: true,
    cleanSourceVerified: true,
    observedAt: '2026-10-07T12:00:00.000Z',
    tagCount: 1,
    tagRefs: [`refs/tags/v1 ${tagOid}`],
    remoteRefs: [
      { oid: candidate.commit, ref: 'HEAD' },
      { oid: candidate.commit, ref: `refs/heads/${candidate.branch}` },
      { oid: tagOid, ref: 'refs/tags/v1' },
    ],
  };
}

function manifestFixture() {
  const candidate = {
    repository: 'ssh://git.example.invalid/owner/project.git',
    branch: 'main',
    commit: hash40('1'),
    tree: hash40('2'),
    lockSha256: digest('3'),
    sourceSha256: digest('4'),
  };
  const gitBytes = canonicalBytes(gitEvidence(candidate));
  const payloadText = 'generic fixture payload';
  const parentBytes = readFileSync(PROOF_PARENT);
  const base = {
    schema: DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
    runId: 'generic-run-1',
    namePrefix: 'seerrng-mode3',
    ownershipLabelKey: 'org.example.validation-owner',
    outerDaemonId: 'outer-daemon-generic',
    candidate,
    dependencyMountpoint: {
      schema: 'seerrng-mode3-dependency-mountpoint/v1',
      sourceDirectory: 'C:\\mode3-inputs\\candidate',
      mountpointPath: 'C:\\mode3-inputs\\candidate\\node_modules',
      relativePath: 'node_modules',
      candidateCommit: candidate.commit,
      candidateTree: candidate.tree,
      candidateSourceSha256: candidate.sourceSha256,
      sourceManifestSha256: candidate.sourceSha256,
      inheritedPathCount: 12,
      inheritedFileCount: 10,
      inheritedTopologySha256: digest('5'),
      onlyAddedPath: 'node_modules',
      mountpointType: 'directory',
      mountpointEmptyBeforeMount: true,
      gitTreeVerified: true,
    },
    images: {
      helper: {
        reference: `helper.invalid/runtime@sha256:${digest('6')}`,
        id: `sha256:${digest('6')}`,
      },
      daemon: {
        reference: `daemon.invalid/dind@sha256:${digest('7')}`,
        id: `sha256:${digest('7')}`,
        entrypoint: '/usr/local/bin/dockerd-entrypoint.sh',
        storageDriver: 'overlay2',
      },
    },
    inputs: {
      candidate: {
        type: 'bind',
        source: 'C:\\mode3-inputs\\candidate',
        target: '/candidate',
      },
      git: {
        type: 'bind',
        source: 'C:\\mode3-inputs\\candidate\\.git',
        target: '/candidate/.git',
      },
      config: {
        type: 'bind',
        source: 'C:\\mode3-inputs\\config',
        target: '/config',
      },
      dependencies: {
        type: 'volume',
        source: 'mode3-linux-dependencies',
        target: '/candidate/node_modules',
      },
      tool: {
        type: 'volume',
        source: 'mode3-linux-prerequisites',
        target: '/tools',
      },
      recipe: {
        type: 'bind',
        source: PROOF_PARENT,
        target: '/recipes/mode3-proof-parent.py',
      },
    },
    paths: {
      stateRoot: '/run-state',
      logRoot: '/run-logs',
      daemonDataRoot: '/var/lib/docker',
      dockerSocket: '/run-state/docker/docker.sock',
      daemonExecRoot: '/run-state/docker/exec',
      daemonPidFile: '/run-state/docker/docker.pid',
      helperReadyFile: '/run-state/helper-ready.json',
      proofSocket: '/run-state/proof.sock',
      daemonCpuMaxFile: '/sys/fs/cgroup/cpu.max',
      daemonMemoryMaxFile: '/sys/fs/cgroup/memory.max',
      daemonPidsMaxFile: '/sys/fs/cgroup/pids.max',
      snapshotDirectoryPrefix: 'snapshot',
      snapshotSourceDirectory: 'source',
    },
    resources: {
      helper: {
        cpus: 4,
        memoryBytes: 4_294_967_296,
        pidsLimit: 512,
        tmpfsBytes: 67_108_864,
        tmpfsTarget: '/tmp',
      },
      daemon: {
        cpus: 2,
        memoryBytes: 2_147_483_648,
        pidsLimit: 256,
        expectedCpuMax: '200000 100000',
        expectedMemoryMax: '2147483648',
        expectedPidsMax: '256',
      },
    },
    network: {
      baselineMode: 'baseline-public',
      bridgeAddress: '198.51.100.1/29',
      bridgeCidr: '198.51.100.0/29',
      bridgeName: 'docker0',
      dnsServers: ['203.0.113.53'],
      baselineDeniedCidrsV4: [
        '10.0.0.0/8',
        '192.168.0.0/16',
        '198.51.100.0/24',
      ],
      baselineDeniedCidrsV6: ['fc00::/7', 'fe80::/10'],
      publicProbe: {
        host: 'provider.example.invalid',
        url: 'https://provider.example.invalid/status',
        statusMinimum: 200,
        statusMaximum: 399,
      },
      privateProbe: {
        host: '192.0.2.44',
        port: 9,
        expectedExitCode: 7,
      },
      repository: {
        mode: 'repository-loopback',
        unitId: 'repository-unit',
        deniedExitCode: 7,
      },
      distributed: {
        mode: 'distributed-endpoints',
        unitId: 'distributed-unit',
        runtimeApplicationKey: 'application-key',
        endpoints: [{ host: '203.0.113.17', port: 44001 }],
      },
    },
    inner: {
      parentScript: '/recipes/mode3-proof-parent.py',
      parentScriptSha256: sha256(parentBytes),
      configPath: '/config/proof-parent.json',
      engineExecutable: '/usr/local/bin/node',
      engineArguments: [
        '/candidate/tools/validation-engine/runtime/entry.mjs',
        '--request-file',
        '/config/contained-request.json',
      ],
      workingDirectory: '/candidate',
      environment: { PATH: '/usr/local/bin:/usr/bin:/bin' },
    },
    gitHistory: {
      evidencePath: '/config/git-history.json',
      evidenceSha256: sha256(gitBytes),
    },
    dockerFixture: {
      name: 'generic-bind-fixture',
      imageReference: `fixture.invalid/server@sha256:${digest('8')}`,
      bindSource: '/run-state/fixture',
      bindTarget: '/www',
      bridgeName: 'docker0',
      containerPort: 8080,
      command: ['httpd', '-f', '-p', '8080', '-h', '/www'],
      payloadFileName: 'proof.txt',
      payloadText,
      payloadSha256: sha256(Buffer.from(payloadText)),
    },
    evidence: {
      outerDirectory: 'C:\\mode3-evidence\\generic-run-1',
      callbackLogPath: '/run-logs/containment-callbacks.jsonl',
      cleanupSchema: 'seerrng-mode3-nested-cleanup/v1',
      cleanupArtifactFileName: 'nested-cleanup.json',
      artifacts: [
        {
          role: 'contained-run-verification',
          fileName: 'contained-run-verification.json',
          containerPath: '/run-state/contained-run-verification.json',
        },
        {
          role: 'callback-ledger',
          fileName: 'containment-callbacks.jsonl',
          containerPath: '/run-logs/containment-callbacks.jsonl',
        },
        {
          role: 'nested-cleanup',
          fileName: 'nested-cleanup.json',
          containerPath: '/run-state/nested-cleanup.json',
        },
        {
          role: 'proof-parent-ledger',
          fileName: 'proof-parent-events.jsonl',
          containerPath: '/run-logs/proof-parent-events.jsonl',
        },
        {
          role: 'engine-stdout',
          fileName: 'engine.stdout.log',
          containerPath: '/run-logs/engine.stdout.log',
        },
        ...[
          ['production-result', 'staged-validation-result.json'],
          ['production-timings', 'timings.json'],
          ['native-run-expectations', 'native-run-expectations.json'],
          ['host-preparation-receipt', 'host-preparation-receipt.json'],
          ['native-command-receipts', 'native-command-receipts.jsonl'],
          ['native-process-ledger', 'native-process-ledger.json'],
          ['native-process-streams', 'native-process-streams.json'],
          ['independent-reconciliation', 'independent-reconciliation.json'],
          ['timing-observations', 'adaptive-timing-observations.json'],
          ['timing-profile-update', 'adaptive-timing-profile-update.json'],
          ['timing-profile', 'adaptive-timing-profile.json'],
        ].map(([role, fileName]) => ({
          role,
          fileName,
          containerPath: `/run-state/${fileName}`,
        })),
      ],
    },
    proof: {
      leaseMaximumMs: 60_000,
      readinessPollMs: 10,
      readinessTimeoutMs: 1_000,
      binaries: {
        docker: '/usr/bin/docker',
        ip6tables: '/usr/sbin/ip6tables',
        ip6tablesRestore: '/usr/sbin/ip6tables-restore',
        iptables: '/usr/sbin/iptables',
        iptablesRestore: '/usr/sbin/iptables-restore',
        python: '/usr/bin/python3',
        setpriv: '/usr/bin/setpriv',
      },
    },
  };
  const proofParentConfig = createDistributedLinuxProofParentConfig({
    candidate: base.candidate,
    dockerFixture: base.dockerFixture,
    evidence: base.evidence,
    inner: base.inner,
    network: base.network,
    outerDaemonId: base.outerDaemonId,
    paths: base.paths,
    proof: base.proof,
    runId: base.runId,
  });
  const manifest = { ...base, proofParentConfig: proofParentConfig.value };
  const controllerBytes = Buffer.from('[Global Settings]\nRole = controller\n');
  const activeMarkerBytes = Buffer.from('/config/controller.cfg\n');
  const timingSeedBytes = distributedLinuxPrettyJsonBytes(
    createAdaptiveTimingProfile()
  );
  const manifestBytes = distributedLinuxPrettyJsonBytes(manifest);
  const proofConfigBytes = Buffer.from(proofParentConfig.json);
  const preparationInputs = [
    ['controller-config', '/config/controller.cfg', controllerBytes],
    [
      'active-controller-marker',
      '/config/active-controller',
      activeMarkerBytes,
    ],
    [
      'timing-profile-seed',
      '/config/adaptive-timing-profile.json',
      timingSeedBytes,
    ],
    ['authenticated-git-evidence', base.gitHistory.evidencePath, gitBytes],
    ['proof-parent-config', base.inner.configPath, proofConfigBytes],
    ['proof-parent-script', base.inner.parentScript, parentBytes],
    [
      'containment-manifest',
      '/config/containment-manifest.json',
      manifestBytes,
    ],
  ].map(([role, containerPath, bytes]) => ({
    role,
    containerPath,
    rawSha256: sha256(bytes),
  }));
  const requestValue = {
    schema: 'seerrng-distributed-linux-contained-request/v2',
    activeConfigMarkerPath: '/config/active-controller',
    applicationEntryId: '01',
    evidenceDirectory: '/run-state/production-evidence',
    hostPreparation: {
      schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
      inputs: preparationInputs,
    },
    manifestPath: '/config/containment-manifest.json',
    operatorGithubLogin: null,
    reviewBaseCommit: hash40('0'),
    requiredCapacityProof: null,
    runId: base.runId,
    runtimeApplicationKey: base.network.distributed.runtimeApplicationKey,
    sourceRoot: base.inner.workingDirectory,
    timingProfilePath: '/run-state/adaptive-timing-profile.json',
    timingProfileSeedPath: '/config/adaptive-timing-profile.json',
  };
  const requestBytes = distributedLinuxPrettyJsonBytes(requestValue);
  const preparationFiles = new Map([
    ...preparationInputs.map((entry) => [
      entry.containerPath,
      [
        controllerBytes,
        activeMarkerBytes,
        timingSeedBytes,
        gitBytes,
        proofConfigBytes,
        parentBytes,
        manifestBytes,
      ][preparationInputs.indexOf(entry)],
    ]),
    ['/config/contained-request.json', requestBytes],
  ]);
  return {
    manifest,
    gitBytes,
    parentBytes,
    preparationFiles,
    preparationRequest: {
      containerPath: '/config/contained-request.json',
      rawSha256: sha256(requestBytes),
      value: requestValue,
    },
    proofParentConfig,
  };
}

function createPlan(fixture, options) {
  return createDistributedLinuxHostContainmentPlan(fixture.manifest, {
    ...options,
    preparationRequest: fixture.preparationRequest,
  });
}

function passingReceipt(stdout = '', id = 'test') {
  return {
    id,
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    stdout,
    stderr: '',
    wallMs: 1,
    lifecycle: { completed: true, cleanupVerified: true },
  };
}

function failedProbe(exitCode = 7) {
  return {
    status: 'failed',
    exitCode,
    signal: null,
    aborted: false,
    timedOut: false,
    stdout: '',
    stderr: 'denied',
    lifecycle: { completed: true, cleanupVerified: true },
  };
}

function proofHarness(fixture, { badRepositoryProbe = false } = {}) {
  const callbackLines = [];
  const requests = [];
  let mode = fixture.manifest.network.baselineMode;
  let token = null;
  const baselineRules = digest('9');
  const clientProcess = {
    pid: 42,
    capabilityEffectiveSet: '0000000000000000',
    capabilityBoundingSet: '0000000000000000',
    noNewPrivileges: true,
  };
  const response = (extra = {}) => ({
    verified: true,
    sourceSha256: fixture.manifest.candidate.sourceSha256,
    mode,
    namespaceId: 'net:[generic]',
    rulesSha256:
      mode === fixture.manifest.network.baselineMode
        ? baselineRules
        : digest('a'),
    clientProcess,
    ...extra,
  });
  const adapters = {
    proof: {
      async request(request) {
        requests.push(structuredClone(request));
        if (request.op === 'observe') return response();
        if (request.op === 'docker-observe')
          return response({
            docker: {
              daemonId: 'private-daemon',
              outerDaemonId: fixture.manifest.outerDaemonId,
              distinctDaemonVerified: true,
              endpoint: `unix://${fixture.manifest.paths.dockerSocket}`,
              bridgeCidr: fixture.manifest.network.bridgeCidr,
              bridgeName: fixture.manifest.network.bridgeName,
              fixtureName: fixture.manifest.dockerFixture.name,
              fixtureImage: fixture.manifest.dockerFixture.imageReference,
              bindSource: fixture.manifest.dockerFixture.bindSource,
              bindTarget: fixture.manifest.dockerFixture.bindTarget,
              containerPort: fixture.manifest.dockerFixture.containerPort,
              executableSha256: digest('b'),
              scratchBindPathsVerified: true,
              loopbackReachabilityVerified: true,
              directReachabilityDenied: true,
              daemonVerified: true,
            },
          });
        if (request.op.endsWith('-begin')) {
          mode = request.op.startsWith('repository')
            ? fixture.manifest.network.repository.mode
            : fixture.manifest.network.distributed.mode;
          token = 'c'.repeat(48);
          return response({
            token,
            ...(request.op.startsWith('distributed')
              ? {
                  allowedEndpoints:
                    fixture.manifest.network.distributed.endpoints,
                }
              : {}),
          });
        }
        if (request.op.endsWith('-end')) {
          assert.equal(request.token, token);
          const restoredToken = token;
          token = null;
          mode = fixture.manifest.network.baselineMode;
          return response({ restoredToken });
        }
        throw new Error(`Unexpected proof operation ${request.op}`);
      },
    },
    fs: {
      async readFile(path) {
        assert.equal(path, fixture.manifest.gitHistory.evidencePath);
        return fixture.gitBytes;
      },
      async appendJsonLine(_path, value) {
        callbackLines.push(value);
      },
    },
    process: {
      async probe({ kind }) {
        if (kind === 'public-provider') return passingReceipt('204\n', kind);
        if (badRepositoryProbe && kind.startsWith('repository-'))
          return passingReceipt('', kind);
        return failedProbe();
      },
    },
  };
  return { adapters, callbackLines, requests };
}

test('proof-parent config builder emits the exact digest-bound engine authority', () => {
  const fixture = manifestFixture();
  assert.equal(
    fixture.proofParentConfig.value.schema,
    'seerrng-distributed-linux-proof-parent/v1'
  );
  assert.equal(
    sha256(Buffer.from(fixture.proofParentConfig.json)),
    fixture.proofParentConfig.sha256
  );
  assert.equal(
    fixture.proofParentConfig.value.engine.executable,
    fixture.manifest.inner.engineExecutable
  );
  assert.equal(
    fixture.proofParentConfig.value.binaries.setpriv,
    fixture.manifest.proof.binaries.setpriv
  );
});

test('combined builder exposes the plan and one-call outer lifecycle seam', () => {
  const fixture = manifestFixture();
  const built = createDistributedLinuxHostContainment(fixture.manifest, {
    outer: {
      docker: {
        inspectContainer() {},
        inspectImage() {},
        inspectVolume() {},
        run() {},
      },
      fs: {
        createDirectoryExclusive() {},
        readFile() {},
        writeJsonExclusive() {},
      },
      process: {
        delay() {},
        now() {},
        uniqueToken: () => 'combined-builder-token',
      },
    },
    preparationRequest: fixture.preparationRequest,
  });
  assert.match(built.plan.names.helper, /combined-builder-token/u);
  assert.equal(built.containment, null);
  assert.equal(typeof built.executeHostLifecycle, 'function');
});

test('proof adapter delegates to the peer-authenticating engine-owned client', async () => {
  let invocation;
  const proof = createDistributedLinuxProofSocketAdapter({
    python: '/usr/bin/python3',
    scriptPath: '/recipes/mode3-proof-parent.py',
    socketPath: '/run-state/proof.sock',
    parentPid: 17,
    async runCommand(args, options) {
      invocation = { args, options };
      return passingReceipt('{"verified":true}\n', options.id);
    },
  });
  assert.deepEqual(
    await proof.request({ op: 'observe', sourceSha256: digest('4') }),
    { verified: true }
  );
  assert.deepEqual(invocation.args, [
    '/usr/bin/python3',
    '/recipes/mode3-proof-parent.py',
    'client',
    '/run-state/proof.sock',
    '17',
  ]);
  assert.match(invocation.options.input.toString('utf8'), /"op":"observe"/u);
  assert.throws(
    () =>
      createDistributedLinuxProofSocketAdapter({
        python: '/inputs/fake-python',
        scriptPath: '/recipes/mode3-proof-parent.py',
        socketPath: '/run-state/proof.sock',
        parentPid: 17,
        async runCommand() {},
      }),
    /immutable image/u
  );
});

test('plan binds a fresh owner, exact mounts, corrected helper capabilities, and private DinD', () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'fresh-token-1',
  });
  assert.match(plan.names.helper, /fresh-token-1/u);
  assert.match(plan.names.mountpointPreflight, /fresh-token-1/u);
  assert.equal(plan.mountpointPreflightOutput, 'mountpoint-preflight-ok');
  assert.ok(plan.mountpointPreflight.includes('--read-only'));
  assert.ok(plan.mountpointPreflight.includes('none'));
  assert.ok(!plan.mountpointPreflight.includes('NET_ADMIN'));
  assert.equal(plan.volumes.length, 3);
  assert.equal(plan.proofParentConfig.sha256, fixture.proofParentConfig.sha256);
  assert.equal(plan.proofParentConfig.json, fixture.proofParentConfig.json);
  assert.deepEqual(
    plan.helper.filter((entry) => entry === 'NET_ADMIN' || entry === 'SETPCAP'),
    ['NET_ADMIN', 'SETPCAP']
  );
  assert.ok(plan.helper.includes('no-new-privileges'));
  const userIndex = plan.helper.indexOf('--user');
  assert.ok(userIndex > 0);
  assert.equal(plan.helper[userIndex + 1], '0:0');
  assert.ok(!plan.helper.some((entry) => entry.includes('PATH=/usr/local')));
  assert.ok(plan.helper.includes(fixture.proofParentConfig.sha256));
  assert.ok(plan.helper.includes(fixture.preparationRequest.rawSha256));
  assert.deepEqual(
    plan.admissionFiles.map(({ role }) => role),
    [
      'controller-config',
      'active-controller-marker',
      'timing-profile-seed',
      'authenticated-git-evidence',
      'proof-parent-config',
      'proof-parent-script',
      'containment-manifest',
      'contained-request',
    ]
  );
  assert.ok(plan.daemon.includes(`container:${plan.names.helper}`));
  assert.equal(
    plan.daemonCommand.filter((entry) => entry.startsWith('--host=')).length,
    1
  );
  assert.ok(
    plan.daemonCommand.some((entry) => entry.startsWith('--host=unix://'))
  );
  assert.ok(!plan.daemonCommand.some((entry) => entry.includes('tcp://')));
  assert.ok(plan.daemonCommand.includes('--data-root=/var/lib/docker'));
  assert.ok(
    plan.daemon.includes(
      `type=volume,src=${plan.names.daemonData},dst=/var/lib/docker`
    )
  );
  const cleanup = plan.manifest.proofParentConfig.cleanup;
  const boundedOperations = [
    'engineTerminateSeconds',
    'engineKillSeconds',
    'dockerInspectSeconds',
    'dockerRemoveSeconds',
    'dockerListSeconds',
    'proofServerStopSeconds',
  ];
  assert.equal(
    boundedOperations.reduce((total, name) => total + cleanup[name], 0),
    cleanup.terminalBudgetSeconds
  );
  assert.equal(
    plan.terminalCleanup.proofParentBudgetSeconds,
    cleanup.terminalBudgetSeconds
  );
  assert.ok(
    plan.terminalCleanup.helperStopGraceSeconds > cleanup.terminalBudgetSeconds
  );
  assert.equal(
    Number(plan.stopHelper[2]),
    plan.terminalCleanup.helperStopGraceSeconds
  );
  assert.ok(
    plan.terminalCleanup.hostCommandTimeoutMs >
      plan.terminalCleanup.helperStopGraceSeconds * 1000
  );
  for (const mount of Object.values(fixture.manifest.inputs))
    assert.ok(
      plan.helper.includes(
        `type=${mount.type},src=${mount.source},dst=${mount.target},readonly`
      )
    );
});

test('manifest mutations fail closed before Docker execution', () => {
  const fixture = manifestFixture();
  const configMutation = structuredClone(fixture.manifest);
  configMutation.proofParentConfig.network.distributedEndpoints[0].port += 1;
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(configMutation, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-1',
      }),
    /Proof parent config differs/u
  );
  const binaryMutation = structuredClone(fixture.manifest);
  binaryMutation.proof.binaries.setpriv = '/candidate/fake-setpriv';
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(binaryMutation, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-2',
      }),
    /immutable image/u
  );
  const environmentMutation = structuredClone(fixture.manifest);
  environmentMutation.inner.environment.LD_PRELOAD = '/candidate/inject.so';
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(environmentMutation, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-3',
      }),
    /unsafe key/u
  );
  const tcpMutation = structuredClone(fixture.manifest);
  tcpMutation.images.daemon.entrypoint = 'dockerd --host=tcp://0.0.0.0:2375';
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(tcpMutation, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-4',
      }),
    /daemon image entrypoint/u
  );
  const gitEscape = structuredClone(fixture.manifest);
  gitEscape.gitHistory.evidencePath = '/run-state/forged-git.json';
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(gitEscape, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-5',
      }),
    /Git evidence must stay under read-only config/u
  );
  const mountpointMutation = structuredClone(fixture.manifest);
  mountpointMutation.dependencyMountpoint.mountpointEmptyBeforeMount = false;
  assert.throws(
    () =>
      createDistributedLinuxHostContainmentPlan(mountpointMutation, {
        preparationRequest: fixture.preparationRequest,
        uniqueToken: 'mutation-6',
      }),
    /mountpoint proof differs/u
  );
});

test('callbacks prove boundaries and restore leases with operation-once semantics', async () => {
  const fixture = manifestFixture();
  const harness = proofHarness(fixture);
  const callbacks = createDistributedLinuxHostContainmentCallbacks(
    fixture.manifest,
    harness.adapters
  );
  const candidate = fixture.manifest.candidate;
  const network = await callbacks.verifyNetworkBoundary({ candidate });
  assert.equal(network.capabilityBoundingSet, '0000000000000000');
  const docker = await callbacks.verifyDockerFixture({ candidate });
  assert.equal(docker.daemonId, 'private-daemon');
  const localTagRefsSha256 = sha256(
    Buffer.from(`refs/tags/v1 ${hash40('5')}\n`)
  );
  const git = await callbacks.verifyGitHistory({
    candidate,
    localTagRefsSha256,
  });
  assert.equal(git.completeClosure, true);
  let repositoryCalls = 0;
  const repositoryResult = await callbacks.withRepositoryIsolation(
    async () => {
      repositoryCalls += 1;
      return 'repository-result';
    },
    { candidate, unitId: fixture.manifest.network.repository.unitId }
  );
  assert.equal(repositoryResult, 'repository-result');
  assert.equal(repositoryCalls, 1);
  let distributedCalls = 0;
  await callbacks.withDistributedNetwork(
    async () => {
      distributedCalls += 1;
    },
    {
      applicationId: fixture.manifest.network.distributed.runtimeApplicationKey,
      applicationRoot: '/run-state/snapshot-1/source',
      repositoryIdentitySha256: candidate.sourceSha256,
      runId: fixture.manifest.runId,
      unitId: fixture.manifest.network.distributed.unitId,
    }
  );
  assert.equal(distributedCalls, 1);
  assert.equal(
    harness.requests.filter(({ op }) => op === 'repository-end').length,
    1
  );
  assert.equal(
    harness.requests.filter(({ op }) => op === 'distributed-end').length,
    1
  );
});

test('authenticated Git evidence rejects a coherently resealed missing clean-source proof', async () => {
  const fixture = manifestFixture();
  const evidence = gitEvidence(fixture.manifest.candidate);
  evidence.cleanSourceVerified = false;
  fixture.gitBytes = canonicalBytes(evidence);
  fixture.manifest.gitHistory.evidenceSha256 = sha256(fixture.gitBytes);
  const harness = proofHarness(fixture);
  const callbacks = createDistributedLinuxHostContainmentCallbacks(
    fixture.manifest,
    harness.adapters
  );
  await assert.rejects(
    callbacks.verifyGitHistory({
      candidate: fixture.manifest.candidate,
      localTagRefsSha256: sha256(Buffer.from(`refs/tags/v1 ${hash40('5')}\n`)),
    }),
    /Complete authenticated current Git closure is required/u
  );
});

test('callback admission failure ends an acquired lease before rejecting', async () => {
  const fixture = manifestFixture();
  const harness = proofHarness(fixture, { badRepositoryProbe: true });
  const callbacks = createDistributedLinuxHostContainmentCallbacks(
    fixture.manifest,
    harness.adapters
  );
  let calls = 0;
  await assert.rejects(
    callbacks.withRepositoryIsolation(
      async () => {
        calls += 1;
      },
      {
        candidate: fixture.manifest.candidate,
        unitId: fixture.manifest.network.repository.unitId,
      }
    ),
    /denial probe/u
  );
  assert.equal(calls, 0);
  assert.equal(
    harness.requests.filter(({ op }) => op === 'repository-end').length,
    1
  );
  assert.equal(harness.requests.at(-1).op, 'observe');
});

function callbackLedgerBytes() {
  const entries = [];
  const add = (value) =>
    entries.push({ ...value, evidenceSha256: sha256(canonicalBytes(value)) });
  add({ event: 'network-boundary', result: { verified: true } });
  add({ event: 'docker-fixture', result: { verified: true } });
  add({ event: 'git-history', result: { verified: true } });
  for (const kind of ['repository', 'distributed']) {
    const token = kind === 'repository' ? 'c'.repeat(48) : 'd'.repeat(48);
    const tokenSha256 = sha256(Buffer.from(token));
    add({ event: `${kind}-begin`, tokenSha256 });
    add({
      event: `${kind}-end`,
      operationCalls: 1,
      operationFailure: null,
      restoreFailure: null,
      tokenSha256,
    });
  }
  return Buffer.from(
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  );
}

function proofParentLedgerBytes(fixture) {
  const repositoryToken = 'c'.repeat(48);
  const distributedToken = 'd'.repeat(48);
  const rulesSha256 = digest('9');
  const events = [
    {
      event: 'ready',
      sourceSha256: fixture.manifest.candidate.sourceSha256,
      mode: fixture.manifest.network.baselineMode,
      rulesSha256,
    },
    { event: 'docker-hooks-ready', rulesSha256 },
    { event: 'fixture-created', fixtureId: 'fixture-id' },
    {
      transition: 'repository-begin',
      token: repositoryToken,
    },
    {
      transition: 'repository-end',
      restoredToken: repositoryToken,
      guardFailure: null,
    },
    {
      transition: 'distributed-begin',
      token: distributedToken,
    },
    {
      transition: 'distributed-end',
      restoredToken: distributedToken,
      guardFailure: null,
    },
    {
      event: 'terminal-network',
      mode: fixture.manifest.network.baselineMode,
      rulesSha256,
    },
    {
      event: 'fixture-cleanup',
      fixtureId: 'fixture-id',
      uncertainIds: [],
    },
    { event: 'proof-server-stopped' },
  ];
  return Buffer.from(
    `${events.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
}

const timingProfileArtifact = createAdaptiveTimingProfile();
const productionArtifactBytes = (role) =>
  role === 'timing-profile'
    ? Buffer.from(`${JSON.stringify(timingProfileArtifact, null, 2)}\n`)
    : Buffer.from(`${role}\n`);

function outerHarness(
  fixture,
  plan,
  {
    abortController,
    failFailureEvidence = false,
    failDaemonRuntime = false,
    mutateAdmission = false,
    mutateCleanup = false,
    mutateHelper = false,
    mutateHelperUser = false,
    mutateOuterEvidence = null,
    mutateProductionArtifact = false,
    mutateTimingProfileArtifact = false,
    mutateVolume = false,
    mountSourceOverrides = {},
    failMountpointCreateReceipt = false,
    failMountpointCleanupInspect = false,
    failMountpointPreflight = false,
    foreignMountpointOwner = false,
    disappearMountpointBeforeRemoval = false,
    lateMountpointCreateAfterInspects = null,
    replaceMountpointBeforeStart = false,
    replaceMountpointBeforeRemoval = false,
    runningLockedInputMode = null,
    runningLockedInputRole = 'dependencies',
    runningLockedInputSource = null,
    runningStaleMode3 = null,
    malformedRunningList = false,
    duplicateRunningList = false,
    changeRunningList = false,
    retainMountpointPreflight = false,
    mutateMountpointPreflight = false,
  } = {}
) {
  const files = new Map(
    plan.admissionFiles.map(({ containerPath, hostPath }) => [
      hostPath,
      fixture.preparationFiles.get(containerPath),
    ])
  );
  const writes = [];
  const stopCalls = [];
  const dockerCalls = [];
  const admissionReads = new Map();
  const outerEvidenceReads = new Map();
  const containers = new Map();
  let mountpointInspectCount = 0;
  const volumes = new Map();
  for (const input of Object.values(fixture.manifest.inputs))
    if (input.type === 'volume')
      volumes.set(input.source, {
        Name: input.source,
        Driver: 'local',
        Scope: 'local',
        Options: null,
        Labels: {},
        Mountpoint: `/var/lib/docker/volumes/${input.source}/_data`,
      });
  const mountFor = (input) => ({
    Type: input.type,
    Source:
      input.type === 'bind'
        ? (mountSourceOverrides[input.target] ?? input.source)
        : `/volumes/${input.source}/_data`,
    Name: input.type === 'volume' ? input.source : undefined,
    Destination: input.target,
    RW: false,
  });
  const runningContainerId = digest('d');
  if (runningLockedInputMode || runningStaleMode3) {
    const input = runningLockedInputMode
      ? fixture.manifest.inputs[runningLockedInputRole]
      : null;
    const staleNames = {
      controller: `/mode3-old-run-full-controller`,
      helper: `/mode3-old-run-helper`,
      laptop: `/mode3-old-run-a-laptop-1`,
      node: `/mode3-old-run-node-01`,
      postgres: `/mode3-old-run-postgres`,
    };
    containers.set(runningContainerId, {
      Id: runningContainerId,
      Name: staleNames[runningStaleMode3] ?? '/existing-preview',
      Config:
        runningStaleMode3 === 'label'
          ? {
              Labels: {
                [fixture.manifest.ownershipLabelKey]: 'old-mode3-run',
              },
            }
          : { Labels: {} },
      State: { Running: true },
      Mounts: runningLockedInputMode
        ? [
            {
              ...mountFor(input),
              ...(runningLockedInputSource
                ? { Source: runningLockedInputSource }
                : {}),
              RW: runningLockedInputMode === 'rw',
            },
          ]
        : [],
    });
  }
  const outputMount = (name, destination) => ({
    Type: 'volume',
    Source: `/volumes/${name}/_data`,
    Name: name,
    Destination: destination,
    RW: true,
  });
  const mountpointPreflightId = digest('e');
  const foreignReplacementId = digest('f');
  const mountpointPreflightInspect = () => ({
    Id: mountpointPreflightId,
    Image: fixture.manifest.images.helper.id,
    Path: '/bin/sh',
    Args: plan.mountpointPreflight.slice(
      plan.mountpointPreflight.indexOf('-eu')
    ),
    Config: {
      Image: fixture.manifest.images.helper.reference,
      Labels: { [plan.ownership.key]: plan.ownership.value },
      User: '0:0',
      WorkingDir: '/',
      Entrypoint: ['/bin/sh'],
      Cmd: plan.mountpointPreflight.slice(
        plan.mountpointPreflight.indexOf('-eu')
      ),
    },
    HostConfig: {
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: mutateMountpointPreflight ? 'bridge' : 'none',
      RestartPolicy: { Name: 'no' },
    },
    Mounts: [
      fixture.manifest.inputs.candidate,
      fixture.manifest.inputs.git,
      fixture.manifest.inputs.dependencies,
    ].map(mountFor),
    State: { Running: false, OOMKilled: false, ExitCode: 0 },
    RestartCount: 0,
  });
  const helperInspect = () => ({
    Id: 'helper-id',
    Image: fixture.manifest.images.helper.id,
    Path: fixture.manifest.proof.binaries.python,
    Args: [
      fixture.manifest.inner.parentScript,
      fixture.manifest.inner.configPath,
      plan.proofParentConfig.sha256,
      fixture.preparationRequest.containerPath,
      fixture.preparationRequest.rawSha256,
    ],
    Config: {
      Image: fixture.manifest.images.helper.reference,
      Labels: { [plan.ownership.key]: plan.ownership.value },
      User: mutateHelperUser ? '' : '0:0',
      Env: [
        `DOCKER_HOST=unix://${fixture.manifest.paths.dockerSocket}`,
        `SEERR_VALIDATION_STATE_DIR=${fixture.manifest.paths.stateRoot}`,
        `SEERR_VALIDATION_LOG_DIR=${fixture.manifest.paths.logRoot}`,
      ],
      WorkingDir: fixture.manifest.inner.workingDirectory,
      Entrypoint: mutateHelper
        ? [fixture.manifest.proof.binaries.python, '/candidate/extra']
        : [fixture.manifest.proof.binaries.python],
      Cmd: [
        fixture.manifest.inner.parentScript,
        fixture.manifest.inner.configPath,
        plan.proofParentConfig.sha256,
        fixture.preparationRequest.containerPath,
        fixture.preparationRequest.rawSha256,
      ],
    },
    HostConfig: {
      NanoCpus: fixture.manifest.resources.helper.cpus * 1e9,
      Memory: fixture.manifest.resources.helper.memoryBytes,
      PidsLimit: fixture.manifest.resources.helper.pidsLimit,
      ReadonlyRootfs: true,
      Init: true,
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: ['CAP_NET_ADMIN', 'CAP_SETPCAP'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: 'bridge',
      Dns: fixture.manifest.network.dnsServers,
      Tmpfs: {
        [fixture.manifest.resources.helper.tmpfsTarget]:
          `rw,nosuid,nodev,size=${fixture.manifest.resources.helper.tmpfsBytes}`,
      },
      RestartPolicy: { Name: 'no' },
    },
    Mounts: [
      ...Object.values(fixture.manifest.inputs).map(mountFor),
      outputMount(plan.names.state, fixture.manifest.paths.stateRoot),
      outputMount(plan.names.logs, fixture.manifest.paths.logRoot),
    ],
    State: { Running: false, OOMKilled: false, ExitCode: 0 },
    RestartCount: 0,
  });
  const daemonInspect = () => ({
    Id: 'daemon-id',
    Image: fixture.manifest.images.daemon.id,
    Path: fixture.manifest.images.daemon.entrypoint,
    Args: plan.daemonCommand,
    Config: {
      Image: fixture.manifest.images.daemon.reference,
      Labels: { [plan.ownership.key]: plan.ownership.value },
      Env: ['DOCKER_TLS_CERTDIR='],
      Entrypoint: [fixture.manifest.images.daemon.entrypoint],
      Cmd: plan.daemonCommand,
    },
    HostConfig: {
      NetworkMode: `container:${plan.names.helper}`,
      Privileged: true,
      NanoCpus: fixture.manifest.resources.daemon.cpus * 1e9,
      Memory: fixture.manifest.resources.daemon.memoryBytes,
      PidsLimit: fixture.manifest.resources.daemon.pidsLimit,
      RestartPolicy: { Name: 'no' },
    },
    Mounts: [
      outputMount(plan.names.state, fixture.manifest.paths.stateRoot),
      outputMount(plan.names.daemonData, fixture.manifest.paths.daemonDataRoot),
    ],
    State: { Running: false, OOMKilled: false, ExitCode: 0 },
    RestartCount: 0,
  });
  const artifact = (containerPath) => {
    if (containerPath.endsWith('nested-cleanup.json'))
      return canonicalBytes({
        schema: fixture.manifest.evidence.cleanupSchema,
        cleanupVerified: !mutateCleanup,
        childExitCode: 0,
        networkRestored: true,
        proofServerStopped: true,
        resultReuse: false,
        uncertainIds: [],
        errors: mutateCleanup ? ['injected contradiction'] : [],
      });
    if (containerPath.endsWith('contained-run-verification.json'))
      return canonicalBytes({
        schema: 'seerrng-distributed-linux-contained-run-success/v2',
        runId: fixture.manifest.runId,
        status: 'passed',
        ok: true,
        resultSha256: sha256(productionArtifactBytes('production-result')),
        timingsSha256: sha256(productionArtifactBytes('production-timings')),
        runExpectationsSha256: sha256(
          productionArtifactBytes('native-run-expectations')
        ),
        hostPreparationReceiptSha256: sha256(
          productionArtifactBytes('host-preparation-receipt')
        ),
        processLedgerSha256: sha256(
          productionArtifactBytes('native-command-receipts')
        ),
        processLedgerSummarySha256: sha256(
          productionArtifactBytes('native-process-ledger')
        ),
        processStreamsSha256: sha256(
          productionArtifactBytes('native-process-streams')
        ),
        reconciliationSha256: sha256(
          productionArtifactBytes('independent-reconciliation')
        ),
        observationsSha256: sha256(
          productionArtifactBytes('timing-observations')
        ),
        timingProfileUpdateSha256: sha256(
          productionArtifactBytes('timing-profile-update')
        ),
        timingProfileFileSha256: sha256(
          productionArtifactBytes('timing-profile')
        ),
        updatedProfileSha256: canonicalJsonSha256(timingProfileArtifact),
        resultReuse: false,
      });
    if (containerPath.endsWith('containment-callbacks.jsonl'))
      return callbackLedgerBytes();
    if (containerPath.endsWith('proof-parent-events.jsonl'))
      return proofParentLedgerBytes(fixture);
    const productionRole = fixture.manifest.evidence.artifacts.find(
      (entry) => entry.containerPath === containerPath
    )?.role;
    if (
      [
        'production-result',
        'production-timings',
        'native-run-expectations',
        'host-preparation-receipt',
        'native-command-receipts',
        'native-process-ledger',
        'native-process-streams',
        'independent-reconciliation',
        'timing-observations',
        'timing-profile-update',
        'timing-profile',
      ].includes(productionRole)
    )
      return (mutateProductionArtifact &&
        productionRole === 'production-result') ||
        (mutateTimingProfileArtifact && productionRole === 'timing-profile')
        ? Buffer.from('mutated production result\n')
        : productionArtifactBytes(productionRole);
    return Buffer.from('engine output\n');
  };
  const docker = {
    async inspectContainer(name) {
      if (name === plan.names.mountpointPreflight) {
        mountpointInspectCount += 1;
        if (
          lateMountpointCreateAfterInspects !== null &&
          !containers.has(name) &&
          mountpointInspectCount >= lateMountpointCreateAfterInspects
        )
          containers.set(name, mountpointPreflightInspect());
        if (failMountpointCleanupInspect && mountpointInspectCount >= 4)
          throw new Error('Injected mountpoint cleanup inspection failure');
        if (disappearMountpointBeforeRemoval && mountpointInspectCount === 4) {
          containers.delete(name);
          return null;
        }
      }
      return (
        containers.get(name) ??
        [...containers.values()].find(({ Id }) => Id === name) ??
        null
      );
    },
    async inspectVolume(name) {
      return volumes.get(name) ?? null;
    },
    async inspectImage(reference) {
      const image = [
        fixture.manifest.images.helper,
        fixture.manifest.images.daemon,
      ].find((entry) => entry.reference === reference);
      return image ? { Id: image.id } : null;
    },
    async run(args, options) {
      const id = options.id;
      dockerCalls.push(id);
      if (id === 'outer-daemon-identity')
        return passingReceipt(
          `${JSON.stringify(fixture.manifest.outerDaemonId)}\n`,
          id
        );
      if (
        id === 'running-container-list-initial' ||
        id === 'running-container-list-final'
      ) {
        if (malformedRunningList)
          return passingReceipt('not-a-container-id\n', id);
        const listed = containers.has(runningContainerId)
          ? [runningContainerId]
          : [];
        if (id === 'running-container-list-final' && changeRunningList)
          listed.length = 0;
        if (duplicateRunningList && listed.length) listed.push(listed[0]);
        return passingReceipt(
          listed.length ? `${listed.join('\n')}\n` : '',
          id
        );
      }
      if (id.startsWith('create-') && id.endsWith('-volume')) {
        const name = args.at(-1);
        const role = id.slice('create-'.length, -'-volume'.length);
        volumes.set(name, {
          Name: name,
          Driver: 'local',
          Scope: 'local',
          Options: null,
          Labels: {
            [plan.ownership.key]:
              mutateVolume && role === 'state'
                ? 'foreign'
                : plan.ownership.value,
          },
          Mountpoint: `/var/lib/docker/volumes/${name}/_data`,
        });
      } else if (id === 'create-mountpoint-preflight') {
        const preflight = mountpointPreflightInspect();
        if (foreignMountpointOwner)
          preflight.Config.Labels[plan.ownership.key] = 'foreign';
        if (lateMountpointCreateAfterInspects === null)
          containers.set(plan.names.mountpointPreflight, preflight);
        if (failMountpointCreateReceipt)
          throw new Error('Injected mountpoint create receipt failure');
      } else if (id === 'start-mountpoint-preflight') {
        const targetId = args.at(-1);
        assert.equal(targetId, mountpointPreflightId);
        if (replaceMountpointBeforeStart) {
          const foreign = mountpointPreflightInspect();
          foreign.Id = foreignReplacementId;
          foreign.Config.Labels[plan.ownership.key] = 'foreign';
          containers.set(plan.names.mountpointPreflight, foreign);
        }
        const target = [...containers.values()].find(
          (container) => container.Id === targetId
        );
        if (!target) throw new Error('No such container');
        if (failMountpointPreflight)
          throw new Error('Injected dependency mountpoint preflight failure');
        return passingReceipt(`${plan.mountpointPreflightOutput}\n`, id);
      } else if (id === 'force-remove-mountpoint-preflight') {
        assert.equal(options.signal, undefined);
        assert.equal(options.cleanup, true);
        const targetId = args.at(-1);
        assert.equal(targetId, mountpointPreflightId);
        assert.ok(args.includes('--force'));
        if (replaceMountpointBeforeRemoval) {
          const foreign = mountpointPreflightInspect();
          foreign.Id = foreignReplacementId;
          foreign.Config.Labels[plan.ownership.key] = 'foreign';
          containers.set(plan.names.mountpointPreflight, foreign);
        }
        const target = [...containers.entries()].find(
          ([, container]) => container.Id === targetId
        );
        if (!target) throw new Error('No such container');
        if (!retainMountpointPreflight) containers.delete(target[0]);
      } else if (id === 'create-helper') {
        containers.set(plan.names.helper, helperInspect());
      } else if (id === 'start-helper') {
        containers.get(plan.names.helper).State.Running = true;
      } else if (id === 'helper-readiness-readback') {
        return passingReceipt(
          JSON.stringify({
            verified: true,
            sourceSha256: fixture.manifest.candidate.sourceSha256,
            mode: fixture.manifest.network.baselineMode,
            bridgeCidr: fixture.manifest.network.bridgeCidr,
            bridgeOverlapVerified: true,
            rulesSha256: digest('9'),
            observedNetworksSha256: digest('8'),
            parentPid: 1,
          }),
          id
        );
      } else if (id === 'create-daemon') {
        containers.set(plan.names.daemon, daemonInspect());
      } else if (id === 'start-daemon') {
        containers.get(plan.names.daemon).State.Running = true;
      } else if (id === 'daemon-command-readback') {
        return passingReceipt(`${plan.daemonCommand.join('\0')}\0`, id);
      } else if (id === 'daemon-cpu-readback') {
        if (failDaemonRuntime) {
          abortController.abort();
          throw new Error('Injected daemon readback failure');
        }
        return passingReceipt(
          `${fixture.manifest.resources.daemon.expectedCpuMax}\n`,
          id
        );
      } else if (id === 'daemon-memory-readback') {
        return passingReceipt(
          `${fixture.manifest.resources.daemon.expectedMemoryMax}\n`,
          id
        );
      } else if (id === 'daemon-pids-readback') {
        return passingReceipt(
          `${fixture.manifest.resources.daemon.expectedPidsMax}\n`,
          id
        );
      } else if (id === 'wait-helper') {
        containers.get(plan.names.helper).State.Running = false;
        containers.get(plan.names.helper).State.ExitCode = 0;
        return passingReceipt('0\n', id);
      } else if (id.startsWith('retain-')) {
        const source = args[1].slice(args[1].indexOf(':') + 1);
        files.set(args[2], artifact(source));
      } else if (id === 'stop-helper') {
        assert.equal(options.signal, undefined);
        assert.equal(
          options.timeoutMs,
          plan.terminalCleanup.hostCommandTimeoutMs
        );
        assert.equal(options.cleanup, true);
        stopCalls.push(id);
        containers.get(plan.names.helper).State.Running = false;
      } else if (id === 'stop-daemon') {
        assert.equal(options.signal, undefined);
        assert.equal(
          options.timeoutMs,
          plan.terminalCleanup.hostCommandTimeoutMs
        );
        assert.equal(options.cleanup, true);
        stopCalls.push(id);
        containers.get(plan.names.daemon).State.Running = false;
        containers.get(plan.names.daemon).State.ExitCode = 0;
      }
      return passingReceipt('', id);
    },
  };
  let now = 0;
  return {
    adapters: {
      docker,
      fs: {
        async createDirectoryExclusive(path) {
          writes.push(`mkdir:${path}`);
        },
        async readFile(path) {
          if (!files.has(path)) throw new Error(`Unknown fake file ${path}`);
          const outerEvidenceFile =
            DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES.find(({ fileName }) =>
              path.endsWith(fileName)
            )?.fileName ?? null;
          if (outerEvidenceFile) {
            const reads = (outerEvidenceReads.get(outerEvidenceFile) ?? 0) + 1;
            outerEvidenceReads.set(outerEvidenceFile, reads);
            if (
              reads > 1 &&
              mutateOuterEvidence?.fileName === outerEvidenceFile
            ) {
              if (mutateOuterEvidence.mode === 'missing')
                throw new Error(
                  `Unknown fake file after write ${outerEvidenceFile}`
                );
              if (mutateOuterEvidence.mode === 'tamper')
                return Buffer.from('not-json\n');
              if (mutateOuterEvidence.mode === 'coherent-reseal') {
                const value = JSON.parse(files.get(path).toString('utf8'));
                value.coherentlyResealed = true;
                return canonicalBytes(value);
              }
            }
          }
          const admission = plan.admissionFiles.find(
            ({ hostPath }) => hostPath === path
          );
          if (admission) {
            const reads = (admissionReads.get(admission.role) ?? 0) + 1;
            admissionReads.set(admission.role, reads);
            const mutatedRole =
              mutateAdmission === true
                ? 'proof-parent-config'
                : mutateAdmission || null;
            if (admission.role === mutatedRole && reads > 1)
              return Buffer.from(`substituted ${admission.role}`);
          }
          return files.get(path);
        },
        async writeJsonExclusive(path, value) {
          if (failFailureEvidence && path.endsWith('failure.json'))
            throw new Error('Injected failure-evidence persistence failure');
          files.set(path, canonicalBytes(value));
          writes.push(`write:${path}`);
        },
      },
      process: {
        uniqueToken: () => 'unused',
        now: () => (now += 10),
        delay: async () => {},
      },
    },
    writes,
    stopCalls,
    dockerCalls,
    containers,
    files,
  };
}

test('outer lifecycle reconciles evidence, stops assets, retains them, and writes its marker last', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'outer-positive',
  });
  const harness = outerHarness(fixture, plan);
  const result = await executeDistributedLinuxHostContainment(
    plan,
    harness.adapters
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.retainedAssets, true);
  assert.equal(result.terminalCleanup.cleanupVerified, true);
  assert.equal(result.mountpointPreflight.status, 'passed');
  assert.equal(result.mountpointPreflight.output, 'mountpoint-preflight-ok');
  assert.equal(
    result.mountpointPreflight.dependencyLockSha256,
    fixture.manifest.candidate.lockSha256
  );
  assert.equal(result.mountpointPreflight.distributedNodesContacted, false);
  assert.equal(
    result.mountpointPreflight.disposableContainerRemovedAfterInspection,
    true
  );
  const createPreflightIndex = harness.dockerCalls.indexOf(
    'create-mountpoint-preflight'
  );
  const createStateVolumeIndex = harness.dockerCalls.indexOf(
    'create-state-volume'
  );
  assert.ok(createPreflightIndex >= 0);
  assert.ok(createStateVolumeIndex >= 0);
  assert.ok(createPreflightIndex < createStateVolumeIndex);
  const forceRemoveIndex = harness.dockerCalls.indexOf(
    'force-remove-mountpoint-preflight'
  );
  const createHelperIndex = harness.dockerCalls.indexOf('create-helper');
  assert.ok(forceRemoveIndex >= 0);
  assert.ok(createHelperIndex >= 0);
  assert.ok(forceRemoveIndex < createHelperIndex);
  assert.equal(
    result.outerEvidence.schema,
    DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA
  );
  assert.equal(result.outerEvidence.verified, true);
  for (const { hashField } of DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES)
    assert.match(result.outerEvidence[hashField], /^[a-f0-9]{64}$/u);
  assert.notEqual(
    result.containedRun.updatedProfileSha256,
    result.containedRun.timingProfileFileSha256
  );
  assert.ok(
    harness.writes.at(-1).endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
  );
});

test('locked-input scan accepts read-only use and binds the complete stable scan', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'locked-input-readonly',
  });
  const harness = outerHarness(fixture, plan, {
    runningLockedInputMode: 'ro',
  });
  const result = await executeDistributedLinuxHostContainment(
    plan,
    harness.adapters
  );
  assert.equal(result.status, 'passed');
  const entry = [...harness.files.entries()].find(([path]) =>
    path.endsWith('volume-admission.json')
  );
  assert.ok(entry);
  const admission = JSON.parse(entry[1].toString('utf8'));
  assert.equal(
    admission.schema,
    'seerrng-distributed-linux-volume-admission/v2'
  );
  assert.equal(admission.lockedInputScan.status, 'passed');
  assert.equal(
    admission.lockedInputScan.nonPostgresMode3RuntimeNamesExcluded,
    true
  );
  assert.equal(
    admission.lockedInputScan.runningLockedInputWritersExcluded,
    true
  );
  assert.equal(admission.lockedInputScan.stableListVerified, true);
  assert.deepEqual(admission.lockedInputScan.runningContainerIds, [
    digest('d'),
  ]);
  assert.deepEqual(admission.lockedInputScan.containers[0].lockedMounts, [
    {
      destination: fixture.manifest.inputs.dependencies.target,
      readOnly: true,
      role: 'dependencies',
      source: fixture.manifest.inputs.dependencies.source,
      type: 'volume',
    },
  ]);
  const finalListIndex = harness.dockerCalls.indexOf(
    'running-container-list-final'
  );
  const preflightIndex = harness.dockerCalls.indexOf(
    'create-mountpoint-preflight'
  );
  assert.ok(finalListIndex >= 0);
  assert.ok(preflightIndex >= 0);
  assert.ok(finalListIndex < preflightIndex);
});

test('locked-input scan rejects running read-write bind and volume consumers', async () => {
  for (const runningLockedInputRole of [
    'candidate',
    'git',
    'dependencies',
    'tool',
  ]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: `locked-input-rw-${runningLockedInputRole}`,
    });
    const harness = outerHarness(fixture, plan, {
      runningLockedInputMode: 'rw',
      runningLockedInputRole,
    });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      new RegExp(
        `writes immutable input ${
          runningLockedInputRole === 'git'
            ? 'candidate'
            : runningLockedInputRole
        }`,
        'u'
      )
    );
    assert.ok(!harness.dockerCalls.includes('create-mountpoint-preflight'));
    assert.ok(!harness.dockerCalls.includes('create-state-volume'));
    assert.ok(!harness.dockerCalls.includes('create-helper'));
  }
});

test('locked-input scan rejects stale Mode 3 ownership and runtime roles', async () => {
  for (const runningStaleMode3 of [
    'label',
    'controller',
    'helper',
    'laptop',
    'node',
  ]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: `stale-runtime-${runningStaleMode3}`,
    });
    const harness = outerHarness(fixture, plan, { runningStaleMode3 });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      /Stale Mode 3 runtime is still running/u
    );
    assert.ok(!harness.dockerCalls.includes('create-mountpoint-preflight'));
  }
});

test('locked-input scan permits the separate preserved Mode 3 database role', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'preserved-mode3-postgres',
  });
  const harness = outerHarness(fixture, plan, {
    runningStaleMode3: 'postgres',
  });
  const result = await executeDistributedLinuxHostContainment(
    plan,
    harness.adapters
  );
  assert.equal(result.status, 'passed');
});

test('locked-input scan rejects a writable ancestor of each source bind', async () => {
  for (const runningLockedInputRole of ['candidate', 'git']) {
    const fixture = manifestFixture();
    const input = fixture.manifest.inputs[runningLockedInputRole];
    const plan = createPlan(fixture, {
      uniqueToken: `locked-parent-${runningLockedInputRole}`,
    });
    const harness = outerHarness(fixture, plan, {
      runningLockedInputMode: 'rw',
      runningLockedInputRole,
      runningLockedInputSource: win32.dirname(input.source),
    });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      /writes immutable input candidate/u
    );
    assert.ok(!harness.dockerCalls.includes('create-mountpoint-preflight'));
  }
});

test('locked-input scan rejects a writable descendant of each source bind', async () => {
  for (const runningLockedInputRole of ['candidate', 'git']) {
    const fixture = manifestFixture();
    const input = fixture.manifest.inputs[runningLockedInputRole];
    const plan = createPlan(fixture, {
      uniqueToken: `locked-child-${runningLockedInputRole}`,
    });
    const harness = outerHarness(fixture, plan, {
      runningLockedInputMode: 'rw',
      runningLockedInputRole,
      runningLockedInputSource: win32.join(input.source, 'mutable-child'),
    });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      /writes immutable input candidate/u
    );
    assert.ok(!harness.dockerCalls.includes('create-mountpoint-preflight'));
  }
});

test('locked-input scan rejects malformed, duplicate, and changing running-container lists', async () => {
  for (const [name, mutation, error] of [
    ['malformed', { malformedRunningList: true }, /malformed container ID/u],
    [
      'duplicate',
      { duplicateRunningList: true, runningLockedInputMode: 'ro' },
      /duplicate container IDs/u,
    ],
    [
      'changed',
      { changeRunningList: true, runningLockedInputMode: 'ro' },
      /list changed during locked-input scan/u,
    ],
  ]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: `locked-input-list-${name}`,
    });
    const harness = outerHarness(fixture, plan, mutation);
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      error
    );
    assert.ok(!harness.dockerCalls.includes('create-mountpoint-preflight'));
    assert.ok(!harness.dockerCalls.includes('create-state-volume'));
    assert.ok(!harness.dockerCalls.includes('create-helper'));
  }
});

test(
  'outer lifecycle accepts only the exact Docker Desktop form of a canonical Windows bind source',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: 'docker-desktop-bind-source',
    });
    const translated = (source) =>
      `/run/desktop/mnt/host/${source[0].toLowerCase()}/${source.slice(3).replaceAll('\\', '/')}`;
    const harness = outerHarness(fixture, plan, {
      mountSourceOverrides: {
        [fixture.manifest.inputs.git.target]: translated(
          fixture.manifest.inputs.git.source
        ),
        [fixture.manifest.inputs.recipe.target]: translated(
          fixture.manifest.inputs.recipe.source
        ),
      },
    });
    const result = await executeDistributedLinuxHostContainment(
      plan,
      harness.adapters
    );
    assert.equal(result.status, 'passed');
  }
);

test('outer lifecycle rejects inexact Docker Desktop bind-source substitutions', async () => {
  const fixture = manifestFixture();
  const target = fixture.manifest.inputs.git.target;
  const substitutions = [
    '/run/desktop/mnt/host/d/mode3-inputs/git',
    '/run/desktop/mnt/host/c/mode3-inputs/other',
    '/host_mnt/c/mode3-inputs/git',
    '/run/desktop/mnt/host/c/../mode3-inputs/git',
  ];
  for (const [index, source] of substitutions.entries()) {
    const plan = createPlan(fixture, {
      uniqueToken: `docker-desktop-bind-rejected-${index}`,
    });
    const harness = outerHarness(fixture, plan, {
      mountSourceOverrides: { [target]: source },
    });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      /Read-only input mount differs|preflight and cleanup failed/u
    );
    assert.ok(
      !harness.writes.some((entry) =>
        entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
      )
    );
  }
});

test('outer lifecycle rejects missing, tampered, and coherently resealed outer evidence', async (t) => {
  const mutations = [
    { fileName: 'host-plan.json', mode: 'missing' },
    { fileName: 'volume-admission.json', mode: 'tamper' },
    ...DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES.map(({ fileName }) => ({
      fileName,
      mode: 'coherent-reseal',
    })),
  ];
  for (const [index, mutateOuterEvidence] of mutations.entries())
    await t.test(
      `${mutateOuterEvidence.mode}: ${mutateOuterEvidence.fileName}`,
      async () => {
        const fixture = manifestFixture();
        const plan = createPlan(fixture, {
          uniqueToken: `outer-evidence-mutation-${index}`,
        });
        const harness = outerHarness(fixture, plan, {
          mutateOuterEvidence,
        });
        await assert.rejects(
          executeDistributedLinuxHostContainment(plan, harness.adapters),
          /outer|fake file|preflight evidence/iu
        );
        assert.ok(
          !harness.writes.some((entry) =>
            entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
          )
        );
      }
    );
});

test('mountpoint preflight fails closed and preserves an unproven wrong topology', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-topology-rejected',
  });
  const harness = outerHarness(fixture, plan, {
    mutateMountpointPreflight: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight and cleanup failed/u
  );
  assert.ok(!harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
  assert.ok(
    !harness.writes.some((entry) =>
      entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
    )
  );
});

test('mountpoint preflight force-removes after failure and rejects failed removal', async () => {
  for (const retainMountpointPreflight of [false, true]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: retainMountpointPreflight
        ? 'mountpoint-removal-rejected'
        : 'mountpoint-failure-cleaned',
    });
    const harness = outerHarness(fixture, plan, {
      failMountpointPreflight: true,
      retainMountpointPreflight,
    });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      retainMountpointPreflight
        ? /preflight and cleanup failed/u
        : /Injected dependency mountpoint preflight failure/u
    );
    assert.ok(
      harness.dockerCalls.includes('force-remove-mountpoint-preflight')
    );
    assert.ok(!harness.dockerCalls.includes('create-state-volume'));
    assert.ok(!harness.dockerCalls.includes('create-helper'));
  }
});

test('mountpoint preflight discovers and removes an owned container after a create receipt failure', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-create-receipt-failed',
  });
  const harness = outerHarness(fixture, plan, {
    failMountpointCreateReceipt: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /Injected mountpoint create receipt failure/u
  );
  assert.ok(harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('start-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight reconciles delayed daemon creation after a failed receipt', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-create-late',
  });
  const harness = outerHarness(fixture, plan, {
    failMountpointCreateReceipt: true,
    lateMountpointCreateAfterInspects: 3,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /Injected mountpoint create receipt failure/u
  );
  assert.ok(harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.equal(harness.containers.has(plan.names.mountpointPreflight), false);
  assert.ok(!harness.dockerCalls.includes('start-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight retains its first verified ID when cleanup inspection fails', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mount-cleanup-inspect',
  });
  const harness = outerHarness(fixture, plan, {
    failMountpointCleanupInspect: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight cleanup failed/u
  );
  assert.ok(harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.equal(harness.containers.has(plan.names.mountpointPreflight), false);
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight never removes a raced foreign container', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-foreign-owner',
  });
  const harness = outerHarness(fixture, plan, {
    foreignMountpointOwner: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight and cleanup failed/u
  );
  assert.ok(!harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight never starts a replacement raced after identity proof', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-start-race',
  });
  const harness = outerHarness(fixture, plan, {
    replaceMountpointBeforeStart: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight and cleanup failed/u
  );
  assert.ok(harness.dockerCalls.includes('start-mountpoint-preflight'));
  const replacement = harness.containers.get(plan.names.mountpointPreflight);
  assert.equal(replacement?.Config?.Labels?.[plan.ownership.key], 'foreign');
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight removal is bound to the inspected immutable ID', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-id-race',
  });
  const harness = outerHarness(fixture, plan, {
    replaceMountpointBeforeRemoval: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight cleanup failed/u
  );
  assert.ok(harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  const replacement = harness.containers.get(plan.names.mountpointPreflight);
  assert.equal(replacement?.Config?.Labels?.[plan.ownership.key], 'foreign');
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('mountpoint preflight rejects an unexplained disappearance before planned removal', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'mountpoint-disappeared',
  });
  const harness = outerHarness(fixture, plan, {
    disappearMountpointBeforeRemoval: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters),
    /preflight cleanup failed/u
  );
  assert.ok(harness.dockerCalls.includes('force-remove-mountpoint-preflight'));
  assert.ok(!harness.dockerCalls.includes('create-state-volume'));
  assert.ok(!harness.dockerCalls.includes('create-helper'));
});

test('outer lifecycle rechecks every sealed preparation input before helper start', async () => {
  const roles = [
    'controller-config',
    'active-controller-marker',
    'timing-profile-seed',
    'authenticated-git-evidence',
    'proof-parent-config',
    'proof-parent-script',
    'containment-manifest',
    'contained-request',
  ];
  for (const [index, role] of roles.entries()) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: `mutated-${index + 1}`,
    });
    const harness = outerHarness(fixture, plan, { mutateAdmission: role });
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters),
      /changed before helper start|digest differs/u
    );
    assert.ok(!harness.dockerCalls.includes('start-helper'));
    assert.ok(
      !harness.writes.some((entry) =>
        entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
      )
    );
  }
});

test('outer lifecycle rejects topology and volume mutations without a success marker', async () => {
  for (const mutation of [
    { mutateHelper: true },
    { mutateHelperUser: true },
    { mutateVolume: true },
  ]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: `outer-mutation-${mutation.mutateHelper ? 'helper' : mutation.mutateHelperUser ? 'helper-user' : 'volume'}`,
    });
    const harness = outerHarness(fixture, plan, mutation);
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters)
    );
    assert.ok(
      !harness.writes.some((entry) =>
        entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
      )
    );
  }
});

test('outer lifecycle rejects substituted inputs, copied artifacts, and contradictory cleanup evidence', async () => {
  for (const mutation of [
    { mutateAdmission: true },
    { mutateProductionArtifact: true },
    { mutateTimingProfileArtifact: true },
    { mutateCleanup: true },
  ]) {
    const fixture = manifestFixture();
    const plan = createPlan(fixture, {
      uniqueToken: mutation.mutateAdmission
        ? 'substituted-input'
        : mutation.mutateProductionArtifact
          ? 'mutated-production-artifact'
          : mutation.mutateTimingProfileArtifact
            ? 'mutated-timing-profile'
            : 'contradictory-cleanup',
    });
    const harness = outerHarness(fixture, plan, mutation);
    await assert.rejects(
      executeDistributedLinuxHostContainment(plan, harness.adapters)
    );
    assert.ok(
      !harness.writes.some((entry) =>
        entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
      )
    );
  }
});

test('outer stop exceeds the shared slow terminal budget and remains uncancellable after caller abort', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'abort-cleanup',
  });
  const abortController = new AbortController();
  const harness = outerHarness(fixture, plan, {
    abortController,
    failDaemonRuntime: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters, {
      signal: abortController.signal,
    }),
    /Injected daemon readback/u
  );
  assert.deepEqual(harness.stopCalls, ['stop-helper', 'stop-daemon']);
  assert.ok(
    !harness.writes.some((entry) =>
      entry.endsWith(DISTRIBUTED_LINUX_HOST_FINAL_MARKER)
    )
  );
});

test('outer lifecycle preserves primary and failure-evidence errors together', async () => {
  const fixture = manifestFixture();
  const plan = createPlan(fixture, {
    uniqueToken: 'aggregate-failure-evidence',
  });
  const abortController = new AbortController();
  const harness = outerHarness(fixture, plan, {
    abortController,
    failDaemonRuntime: true,
    failFailureEvidence: true,
  });
  await assert.rejects(
    executeDistributedLinuxHostContainment(plan, harness.adapters, {
      signal: abortController.signal,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /failure evidence/u);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /Injected daemon readback/u);
      assert.match(error.errors[1].message, /failure-evidence persistence/u);
      return true;
    }
  );
});
