import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
  DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES,
  DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA,
  createDistributedLinuxHostContainmentPlan,
} from '../tools/validation-engine/runtime/distributed-linux-host-containment.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_CONTAINED_ENGINE_BIN,
  DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA,
  DISTRIBUTED_LINUX_HOST_PROFILE_FILE,
  DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA,
  DISTRIBUTED_LINUX_TIMING_PROFILE_FILE,
  createDistributedLinuxContainedYamlToolWrappers,
  createDistributedLinuxHostLifecycleManifest,
  executeDistributedLinuxPublicLifecycle,
  fetchAuthenticatedGitState,
  normalizeDistributedLinuxHostProfile,
  runDistributedLinuxProofClientCommand,
  verifyDistributedLinuxOuterSuccessEvidence,
} from '../tools/validation-engine/runtime/distributed-linux-public-lifecycle.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { findNativeExecutable } from '../tools/validation-engine/runtime/native-stage-context.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
  distributedLinuxPrettyJsonBytes,
} from '../tools/validation-engine/runtime/distributed-linux-host-preparation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROOF_PARENT = resolve(
  ROOT,
  'tools/validation-engine/container/mode3-proof-parent.py'
);
const digest = (character) => character.repeat(64);
const hash40 = (character) => character.repeat(40);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function writeFocusedOuterSuccess(directory, runId, profile) {
  const values = {
    'host-plan.json': { schema: 'focused-host-plan/v1', runId },
    'volume-admission.json': {
      schema: 'focused-volume-admission/v1',
      status: 'passed',
    },
    'host-admission.json': {
      schema: 'focused-host-admission/v1',
      status: 'passed',
    },
    'mountpoint-preflight.json': {
      schema: 'focused-mountpoint-preflight/v1',
      status: 'passed',
    },
    'terminal-inspection.json': {
      schema: 'focused-terminal-inspection/v1',
      successful: true,
    },
  };
  const bytes = new Map();
  for (const [fileName, value] of Object.entries(values)) {
    const artifactBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    writeFileSync(join(directory, fileName), artifactBytes);
    bytes.set(fileName, artifactBytes);
  }
  const outerEvidence = {
    schema: DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA,
    ...Object.fromEntries(
      DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES.map(({ fileName, hashField }) => [
        hashField,
        sha256(bytes.get(fileName)),
      ])
    ),
    verified: true,
  };
  const hostResult = {
    schema: DISTRIBUTED_LINUX_HOST_RESULT_SCHEMA,
    runId,
    status: 'passed',
    resultReuse: false,
    outerEvidence,
    containedRun: {
      updatedProfileSha256: canonicalJsonSha256(profile),
    },
  };
  const markerBytes = Buffer.from(`${JSON.stringify(hostResult, null, 2)}\n`);
  writeFileSync(
    join(directory, 'launch-result-verification.json'),
    markerBytes
  );
  return { bytes, hostResult, markerBytes, values };
}

function hostProfile() {
  return {
    schema: DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA,
    images: {
      helper: {
        reference: `helper.invalid/tool@sha256:${digest('a')}`,
        id: `sha256:${digest('a')}`,
      },
      daemon: {
        reference: `daemon.invalid/dind@sha256:${digest('b')}`,
        id: `sha256:${digest('b')}`,
        entrypoint: '/usr/local/bin/dockerd-entrypoint.sh',
        storageDriver: 'overlay2',
      },
      fixture: {
        reference: `fixture.invalid/http@sha256:${digest('c')}`,
        containerPort: 8080,
        command: ['httpd', '-f', '-p', '8080', '-h', '/www'],
      },
    },
    volumes: {
      dependencies: 'focused-dependencies',
      prerequisites: 'focused-prerequisites',
    },
    resources: {
      helper: {
        cpus: 12,
        memoryBytes: 12 * 1024 ** 3,
        pidsLimit: 4096,
        tmpfsBytes: 256 * 1024 ** 2,
        tmpfsTarget: '/tmp',
      },
      daemon: {
        cpus: 2,
        memoryBytes: 4 * 1024 ** 3,
        pidsLimit: 2048,
        expectedCpuMax: '200000 100000',
        expectedMemoryMax: String(4 * 1024 ** 3),
        expectedPidsMax: '2048',
      },
    },
    network: {
      baselineMode: 'public-private-blocked',
      bridgeAddress: '172.31.253.1/29',
      bridgeCidr: '172.31.253.0/29',
      bridgeName: 'docker0',
      dnsServers: ['1.1.1.1'],
      baselineDeniedCidrsV4: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      baselineDeniedCidrsV6: ['fc00::/7', 'fe80::/10'],
      publicProbe: {
        host: 'api.github.com',
        url: 'https://api.github.com/',
        statusMinimum: 200,
        statusMaximum: 399,
      },
      privateProbe: {
        host: '192.168.255.254',
        port: 9,
        expectedExitCode: 7,
      },
    },
  };
}

function candidate() {
  return {
    repository: 'https://github.com/example/project.git',
    branch: 'feature/focused',
    commit: hash40('1'),
    tree: hash40('2'),
    lockSha256: digest('3'),
    sourceSha256: digest('4'),
  };
}

function dependencyMountpoint(sourceDirectory, candidateValue) {
  return {
    schema: 'seerrng-mode3-dependency-mountpoint/v1',
    sourceDirectory,
    mountpointPath: join(sourceDirectory, 'node_modules'),
    relativePath: 'node_modules',
    candidateCommit: candidateValue.commit,
    candidateTree: candidateValue.tree,
    candidateSourceSha256: candidateValue.sourceSha256,
    sourceManifestSha256: candidateValue.sourceSha256,
    inheritedPathCount: 10,
    inheritedFileCount: 5,
    inheritedTopologySha256: digest('f'),
    onlyAddedPath: 'node_modules',
    mountpointType: 'directory',
    mountpointEmptyBeforeMount: true,
    gitTreeVerified: true,
  };
}

function lifecycleFixture(root) {
  const configDirectory = join(root, 'config');
  const sourceDirectory = join(root, 'source');
  const gitDirectory = join(sourceDirectory, '.git');
  const evidenceDirectory = join(root, 'evidence');
  for (const directory of [
    configDirectory,
    sourceDirectory,
    gitDirectory,
    evidenceDirectory,
  ])
    mkdirSync(directory);
  mkdirSync(join(sourceDirectory, 'node_modules'));
  const parentBytes = readFileSync(PROOF_PARENT);
  const candidateValue = candidate();
  return createDistributedLinuxHostLifecycleManifest({
    candidate: candidateValue,
    configDirectory,
    dependencyMountpoint: dependencyMountpoint(sourceDirectory, candidateValue),
    dependencyVolume: 'focused-dependencies',
    gitDirectory,
    gitEvidenceSha256: digest('5'),
    hostProfile: hostProfile(),
    outerDaemonId: 'focused-outer-daemon',
    outerEvidenceDirectory: join(evidenceDirectory, 'containment'),
    parentScriptPath: PROOF_PARENT,
    parentScriptSha256: sha256(parentBytes),
    prerequisiteVolume: 'focused-prerequisites',
    runId: 'mode3-focused-run',
    runtimeApplicationKey: 'seerrng',
    sourceDirectory,
    distributedEndpoints: [{ host: '192.168.10.9', port: 62021 }],
  });
}

function preparationRequest(lifecycle) {
  const manifest = lifecycle.manifest;
  const inputs = [
    ['controller-config', '/config/controller.cfg', digest('a')],
    ['active-controller-marker', '/config/active-controller', digest('b')],
    [
      'timing-profile-seed',
      '/config/adaptive-timing-profile.json',
      digest('c'),
    ],
    [
      'authenticated-git-evidence',
      manifest.gitHistory.evidencePath,
      manifest.gitHistory.evidenceSha256,
    ],
    [
      'proof-parent-config',
      manifest.inner.configPath,
      lifecycle.proofParentConfig.sha256,
    ],
    [
      'proof-parent-script',
      manifest.inner.parentScript,
      manifest.inner.parentScriptSha256,
    ],
    [
      'containment-manifest',
      '/config/containment-manifest.json',
      sha256(distributedLinuxPrettyJsonBytes(manifest)),
    ],
  ].map(([role, containerPath, rawSha256]) => ({
    role,
    containerPath,
    rawSha256,
  }));
  const value = {
    schema: DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA,
    activeConfigMarkerPath: '/config/active-controller',
    applicationEntryId: '01',
    evidenceDirectory: '/run-state/production-evidence',
    hostPreparation: {
      schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
      inputs,
    },
    manifestPath: '/config/containment-manifest.json',
    operatorGithubLogin: null,
    reviewBaseCommit: hash40('0'),
    requiredCapacityProof: null,
    runId: manifest.runId,
    runtimeApplicationKey: manifest.network.distributed.runtimeApplicationKey,
    sourceRoot: manifest.inner.workingDirectory,
    timingProfilePath: '/run-state/adaptive-timing-profile.json',
    timingProfileSeedPath: '/config/adaptive-timing-profile.json',
  };
  return {
    containerPath: '/config/contained-request.json',
    rawSha256: sha256(distributedLinuxPrettyJsonBytes(value)),
    value,
  };
}

test('host profile is data-only and rejects mutable image identities', () => {
  const profile = normalizeDistributedLinuxHostProfile(hostProfile());
  assert.equal(profile.schema, DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA);
  assert.equal(profile.volumes.dependencies, 'focused-dependencies');
  const mutable = structuredClone(hostProfile());
  mutable.images.helper.reference = 'helper.invalid/tool:latest';
  assert.throws(
    () => normalizeDistributedLinuxHostProfile(mutable),
    /immutable identity/
  );
  assert.deepEqual(Object.keys(profile).sort(), [
    'images',
    'network',
    'resources',
    'schema',
    'volumes',
  ]);
});

test('proof client runner delivers the exact canonical request on standard input', () => {
  const input = Buffer.from('{"op":"observe"}\n');
  const receipt = runDistributedLinuxProofClientCommand(
    [process.execPath, '-e', 'process.stdin.pipe(process.stdout)'],
    { id: 'focused-proof-client', input, timeoutMs: 10_000 }
  );
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.stdout, input.toString('utf8'));
  assert.equal(receipt.lifecycle.cleanupVerified, true);
});

function focusedGitClosureAdapter({
  branch,
  commit,
  tree = hash40('6'),
  remote,
  localTags,
  sourceStatus = '',
}) {
  const calls = [];
  return {
    calls,
    git: (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'symbolic-ref --short HEAD') return `${branch}\n`;
      if (command === 'config --get remote.origin.url')
        return 'https://github.com/example/project.git\n';
      if (command.startsWith('ls-remote origin HEAD')) return remote;
      if (command === 'fetch --prune --tags origin') return '';
      if (command === 'rev-parse HEAD') return `${commit}\n`;
      if (command === 'rev-parse HEAD^{tree}') return `${tree}\n`;
      if (command === 'rev-parse --is-shallow-repository') return 'false\n';
      if (command === 'show-ref --tags') return localTags;
      if (
        command ===
        'status --porcelain=v1 --untracked-files=all --ignore-submodules=none'
      )
        return sourceStatus;
      throw new Error(`Unexpected focused Git command: ${command}`);
    },
  };
}

test('authenticated Git closure binds origin tags while accepting unrelated local tags', () => {
  const branch = 'feature/focused';
  const commit = hash40('1');
  const defaultCommit = hash40('2');
  const tagObject = hash40('3');
  const peeledTagCommit = hash40('4');
  const unrelatedLocalTag = hash40('5');
  const remote = [
    `${defaultCommit}\tHEAD`,
    `${commit}\trefs/heads/${branch}`,
    `${tagObject}\trefs/tags/v1`,
    `${peeledTagCommit}\trefs/tags/v1^{}`,
    '',
  ].join('\n');
  const { calls, git } = focusedGitClosureAdapter({
    branch,
    commit,
    remote,
    localTags:
      `${tagObject} refs/tags/v1\n` +
      `${unrelatedLocalTag} refs/tags/upstream-only\n`,
  });
  const state = fetchAuthenticatedGitState('ignored-by-focused-adapter', {
    git,
  });
  assert.equal(state.branch, branch);
  assert.equal(state.cleanSourceVerified, true);
  assert.equal(state.commit, commit);
  assert.equal(state.tree, hash40('6'));
  assert.deepEqual(state.tagRefs, [`refs/tags/v1 ${tagObject}`]);
  const query = [
    'ls-remote',
    'origin',
    'HEAD',
    `refs/heads/${branch}`,
    'refs/tags/*',
  ];
  assert.deepEqual(
    calls.filter(([command]) => ['ls-remote', 'fetch'].includes(command)),
    [query, ['fetch', '--prune', '--tags', 'origin'], query],
    'Remote refs must be observed before and after the authenticated fetch'
  );
  assert.deepEqual(calls.at(-1), [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
});

test('authenticated Git closure rejects every dirty source class', async (t) => {
  const branch = 'feature/focused';
  const commit = hash40('1');
  const tagObject = hash40('3');
  const remote = [
    `${hash40('2')}\tHEAD`,
    `${commit}\trefs/heads/${branch}`,
    `${tagObject}\trefs/tags/v1`,
    '',
  ].join('\n');
  for (const [name, sourceStatus] of [
    ['staged', 'M  staged.mjs\n'],
    ['unstaged', ' M unstaged.mjs\n'],
    ['staged and unstaged tracked', 'MM tracked.mjs\n'],
    ['untracked', '?? untracked.mjs\n'],
  ])
    await t.test(name, () => {
      const { git } = focusedGitClosureAdapter({
        branch,
        commit,
        remote,
        localTags: `${tagObject} refs/tags/v1\n`,
        sourceStatus,
      });
      assert.throws(
        () => fetchAuthenticatedGitState('ignored-by-focused-adapter', { git }),
        /requires a clean source checkout/u
      );
    });
});

test('authenticated Git closure rejects a missing origin tag after fetch', () => {
  const branch = 'feature/focused';
  const commit = hash40('1');
  const remote = [
    `${hash40('2')}\tHEAD`,
    `${commit}\trefs/heads/${branch}`,
    `${hash40('3')}\trefs/tags/v1`,
    '',
  ].join('\n');
  const { git } = focusedGitClosureAdapter({
    branch,
    commit,
    remote,
    localTags: `${hash40('4')} refs/tags/upstream-only\n`,
  });

  assert.throws(
    () => fetchAuthenticatedGitState('ignored-by-focused-adapter', { git }),
    /every authenticated origin tag at its exact object ID/u
  );
});

test('authenticated Git closure rejects a mismatched origin tag after fetch', () => {
  const branch = 'feature/focused';
  const commit = hash40('1');
  const remote = [
    `${hash40('2')}\tHEAD`,
    `${commit}\trefs/heads/${branch}`,
    `${hash40('3')}\trefs/tags/v1`,
    '',
  ].join('\n');
  const { git } = focusedGitClosureAdapter({
    branch,
    commit,
    remote,
    localTags: `${hash40('4')} refs/tags/v1\n`,
  });

  assert.throws(
    () => fetchAuthenticatedGitState('ignored-by-focused-adapter', { git }),
    /every authenticated origin tag at its exact object ID/u
  );
});

test('generated manifest is accepted by the real containment planner', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-public-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lifecycle = lifecycleFixture(root);
  assert.equal(
    lifecycle.manifest.schema,
    DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA
  );
  const plan = createDistributedLinuxHostContainmentPlan(lifecycle.manifest, {
    preparationRequest: preparationRequest(lifecycle),
    uniqueToken: 'f'.repeat(32),
  });
  assert.equal(plan.manifest.inputs.candidate.target, '/app');
  assert.equal(plan.manifest.inputs.dependencies.target, '/app/node_modules');
  assert.equal(plan.manifest.paths.daemonDataRoot, '/var/lib/docker');
  assert.ok(plan.daemonCommand.includes('--data-root=/var/lib/docker'));
  assert.ok(
    plan.daemon.includes(
      `type=volume,src=${plan.names.daemonData},dst=/var/lib/docker`
    )
  );
  assert.equal(
    plan.manifest.inner.environment.PATH.split(':')[0],
    DISTRIBUTED_LINUX_CONTAINED_ENGINE_BIN
  );
  assert.deepEqual(plan.manifest.inner.engineArguments, [
    '/app/bin/run-local-validation.mjs',
    '--distributed-contained-run',
    '--request-file',
    '/config/contained-request.json',
  ]);
  assert.equal(
    plan.manifest.network.distributed.endpoints[0].host,
    '192.168.10.9'
  );
  assert.ok(
    plan.manifest.evidence.artifacts.some(
      ({ role }) => role === 'proof-parent-ledger'
    )
  );
  assert.equal(plan.admissionFiles.length, 8);
  assert.ok(
    plan.manifest.evidence.artifacts.some(
      ({ role, fileName }) =>
        role === 'native-process-streams' &&
        fileName === 'native-process-streams.json'
    )
  );
});

test('contained YAML wrappers have exact bytes, private executable mode, exclusive ownership, and PATH discovery', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-yaml-wrappers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binDirectory = join(root, 'engine-bin');
  const created = createDistributedLinuxContainedYamlToolWrappers(binDirectory);
  const expected = {
    yamllint:
      '#!/bin/sh\n# Relocated, read-only prerequisite venv: no global Python/default changes.\nexec /tools/prereqs/tools/python-venv/bin/python3 -m yamllint "$@"\n',
    yamale:
      '#!/bin/sh\n# Relocated, read-only prerequisite venv: no global Python/default changes.\nexec /tools/prereqs/tools/python-venv/bin/python3 -m yamale.command_line "$@"\n',
  };
  assert.equal(created.binDirectory, binDirectory);
  assert.deepEqual(Object.keys(created.wrappers).toSorted(), [
    'yamale',
    'yamllint',
  ]);
  const discoveryEnvironment = {
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
  };
  for (const [name, bytes] of Object.entries(expected)) {
    const target = created.wrappers[name];
    assert.equal(readFileSync(target, 'utf8'), bytes);
    const metadata = lstatSync(target);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    if (process.platform !== 'win32')
      assert.equal(metadata.mode & 0o777, 0o500);
    assert.equal(
      findNativeExecutable(name, discoveryEnvironment),
      realpathSync(target)
    );
  }
  assert.throws(
    () => createDistributedLinuxContainedYamlToolWrappers(binDirectory),
    (error) => error?.code === 'EEXIST'
  );
});

test('public success rejects missing, tampered, and coherently resealed outer evidence', async (t) => {
  const createFixture = () => {
    const directory = mkdtempSync(join(tmpdir(), 'mode3-outer-proof-'));
    const profile = createAdaptiveTimingProfile();
    const success = writeFocusedOuterSuccess(
      directory,
      'focused-outer-proof',
      profile
    );
    return { directory, ...success };
  };

  await t.test('accepts the exact returned result and retained bytes', () => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    const proof = verifyDistributedLinuxOuterSuccessEvidence({
      hostResult: fixture.hostResult,
      markerBytes: fixture.markerBytes,
      outerEvidenceDirectory: fixture.directory,
      runId: 'focused-outer-proof',
    });
    assert.equal(proof.outerEvidence.verified, true);
    assert.equal(proof.containmentMarkerSha256, sha256(fixture.markerBytes));
  });

  await t.test('rejects a missing bound artifact', () => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    rmSync(join(fixture.directory, 'host-admission.json'));
    assert.throws(() =>
      verifyDistributedLinuxOuterSuccessEvidence({
        hostResult: fixture.hostResult,
        markerBytes: fixture.markerBytes,
        outerEvidenceDirectory: fixture.directory,
        runId: 'focused-outer-proof',
      })
    );
  });

  await t.test('rejects artifact tampering after outer success', () => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    writeFileSync(
      join(fixture.directory, 'terminal-inspection.json'),
      '{"successful":false}\n'
    );
    assert.throws(
      () =>
        verifyDistributedLinuxOuterSuccessEvidence({
          hostResult: fixture.hostResult,
          markerBytes: fixture.markerBytes,
          outerEvidenceDirectory: fixture.directory,
          runId: 'focused-outer-proof',
        }),
      /Outer evidence hash differs/u
    );
  });

  await t.test('rejects a coherently resealed artifact and marker', () => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.directory, { recursive: true, force: true }));
    const changedArtifact = Buffer.from(
      `${JSON.stringify({ schema: 'focused-host-plan/v1', runId: 'other-run' })}\n`
    );
    writeFileSync(join(fixture.directory, 'host-plan.json'), changedArtifact);
    const resealedMarker = structuredClone(fixture.hostResult);
    resealedMarker.outerEvidence.hostPlanSha256 = sha256(changedArtifact);
    const resealedMarkerBytes = Buffer.from(
      `${JSON.stringify(resealedMarker, null, 2)}\n`
    );
    writeFileSync(
      join(fixture.directory, 'launch-result-verification.json'),
      resealedMarkerBytes
    );
    assert.throws(
      () =>
        verifyDistributedLinuxOuterSuccessEvidence({
          hostResult: fixture.hostResult,
          markerBytes: resealedMarkerBytes,
          outerEvidenceDirectory: fixture.directory,
          runId: 'focused-outer-proof',
        }),
      /differs from the returned outer host result/u
    );
  });
});

test('public failure records only an explicitly preserved preparation root beneath state', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-public-failure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, 'state');
  const logRoot = join(root, 'logs');
  const activeMarker = join(stateRoot, 'active-controller');
  const preservedRoot = join(stateRoot, 'preserved-preparation');
  for (const directory of [stateRoot, logRoot, preservedRoot])
    mkdirSync(directory);
  writeFileSync(activeMarker, 'controller.cfg\n');
  const request = {
    activeConfigMarkerPath: activeMarker,
    applicationEntryId: '01',
    logRoot,
    runtimeApplicationKey: 'seerrng',
    signal: undefined,
    sourceRoot: ROOT,
    stateRoot,
  };
  const baseDependencies = {
    createHostAdapters: () => ({}),
    fetchGitState: () => ({}),
  };
  const preservedError = Object.assign(
    new Error('snapshot preparation failed'),
    {
      preserveTemporary: true,
      scratchRoot: preservedRoot,
    }
  );
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-preserved-public-failure' },
      {
        ...baseDependencies,
        createSnapshot: () => {
          throw preservedError;
        },
      }
    ),
    /snapshot preparation failed/u
  );
  const preservedFailure = JSON.parse(
    readFileSync(
      join(logRoot, 'mode3-preserved-public-failure', 'failure.json'),
      'utf8'
    )
  );
  assert.equal(preservedFailure.preservedPreparationRoot, preservedRoot);
  assert.equal(
    existsSyncSafe(
      join(
        logRoot,
        'mode3-preserved-public-failure',
        'launch-result-verification.json'
      )
    ),
    false
  );

  const outsideRoot = join(root, 'outside-preparation');
  mkdirSync(outsideRoot);
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-forged-public-failure' },
      {
        ...baseDependencies,
        createSnapshot: () => {
          throw Object.assign(new Error('forged snapshot failure'), {
            preserveTemporary: true,
            scratchRoot: outsideRoot,
          });
        },
      }
    ),
    /forged snapshot failure/u
  );
  const forgedFailure = JSON.parse(
    readFileSync(
      join(logRoot, 'mode3-forged-public-failure', 'failure.json'),
      'utf8'
    )
  );
  assert.equal(forgedFailure.preservedPreparationRoot, null);
});

test('public lifecycle persists the returned profile, cleans preparation, and writes success last', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-public-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, 'state');
  const logRoot = join(root, 'logs');
  const scratchRoot = join(stateRoot, 'owned-snapshot');
  for (const directory of [stateRoot, logRoot, scratchRoot])
    mkdirSync(directory);
  writeFileSync(
    join(stateRoot, DISTRIBUTED_LINUX_HOST_PROFILE_FILE),
    `${JSON.stringify(hostProfile(), null, 2)}\n`
  );
  const activeMarker = join(stateRoot, 'active-controller');
  writeFileSync(activeMarker, 'controller.cfg\n');
  const currentCommit = hash40('6');
  const currentTree = hash40('7');
  const sourceSha256 = digest('8');
  const sourceProfile = resolve(
    ROOT,
    'tools/validation-engine/setup/seerrng-test-suite-dependancies.cfg'
  );
  const config = {
    global: {
      githubUsername: 'JohnCronk79',
      computerName: 'Focused laptop',
      ipAddress: '192.168.10.82',
      port: 62021,
      cpuName: 'Focused CPU',
      availableThreads: 12,
      threads: '2n',
      minimumThreadCount: 1,
    },
    nodes: [
      {
        nodeNumber: '01',
        computerName: 'Focused server',
        ipAddress: '192.168.10.9',
        port: 62021,
        cpuName: 'Focused server CPU',
        availableThreads: 8,
        threads: 'n-2',
        minimumThreadCount: 1,
      },
    ],
    supportedApplications: [
      {
        entryId: '01',
        applicationId: 'SeerrNG 3.48.3',
        name: 'Focused SeerrNG',
        profilePath: sourceProfile,
      },
    ],
    applicationRequirements: [
      {
        applicationId: 'SeerrNG 3.48.3',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    nodeDependencyAvailability: [
      {
        nodeNumber: '01',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    sharedAuthenticationKey: 'd'.repeat(64),
  };
  const profile = createAdaptiveTimingProfile();
  const events = [];
  let capturedManifest;
  let capturedPreparationRequest;
  const request = {
    activeConfigMarkerPath: activeMarker,
    applicationEntryId: '01',
    logRoot,
    runId: 'mode3-focused-public-run',
    runtimeApplicationKey: 'seerrng',
    signal: undefined,
    sourceRoot: ROOT,
    stateRoot,
  };
  const dependencies = {
    createHostAdapters: () => ({
      docker: {
        run: async () => ({
          status: 'passed',
          exitCode: 0,
          stdout: '"focused-daemon"\n',
        }),
      },
    }),
    fetchGitState: () => ({
      branch: 'feature/focused',
      cleanSourceVerified: true,
      commit: currentCommit,
      repository: 'https://github.com/JohnCronk79/seerrng.git',
      tagRefs: [`refs/tags/v1 ${hash40('9')}`],
      remoteRefs: [
        { oid: hash40('0'), ref: 'HEAD' },
        { oid: currentCommit, ref: 'refs/heads/feature/focused' },
        { oid: hash40('9'), ref: 'refs/tags/v1' },
      ],
      tree: currentTree,
    }),
    createSnapshot: () => {
      events.push('create-snapshot');
      return {
        root: ROOT,
        scratchRoot,
        candidate: {
          repository: 'https://github.com/JohnCronk79/seerrng.git',
          commit: currentCommit,
          tree: currentTree,
          lockSha256: digest('a'),
          sourceSha256,
        },
      };
    },
    prepareDependencyMountpoint: (snapshot) => {
      events.push('prepare-dependency-mountpoint');
      return dependencyMountpoint(snapshot.root, snapshot.candidate);
    },
    detectOperatorGithubLogin: () => 'JohnCronk79',
    resolveActiveConfig: async () => ({ config, configPath: activeMarker }),
    readTimingProfile: () => profile,
    persistTimingProfile: async (_path, value) => {
      events.push('persist-profile');
      assert.deepEqual(value, profile);
    },
    verifyCleanSource: () => {
      events.push('verify-clean-source');
      return true;
    },
    verifyDependencyMountpoint: (_snapshot, proof) => {
      events.push('verify-dependency-mountpoint');
      assert.equal(proof.onlyAddedPath, 'node_modules');
      return true;
    },
    verifySnapshot: () => events.push('verify-snapshot'),
    disposeSnapshot: () => events.push('dispose-snapshot'),
    createContainment: (manifest, options) => {
      events.push('create-containment');
      capturedManifest = manifest;
      capturedPreparationRequest = options.preparationRequest;
      return {
        executeHostLifecycle: async () => {
          events.push('execute-host-lifecycle');
          mkdirSync(manifest.evidence.outerDirectory);
          writeFileSync(
            join(
              manifest.evidence.outerDirectory,
              'adaptive-timing-profile.json'
            ),
            `${JSON.stringify(profile, null, 2)}\n`
          );
          return writeFocusedOuterSuccess(
            manifest.evidence.outerDirectory,
            manifest.runId,
            profile
          ).hostResult;
        },
      };
    },
  };
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-missing-operator-run' },
      { ...dependencies, detectOperatorGithubLogin: () => null }
    ),
    /operator differs from the authenticated checkout operator/u
  );
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-post-snapshot-dirty-run' },
      { ...dependencies, verifyCleanSource: () => false }
    ),
    /clean source verification is incomplete/u
  );
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-snapshot-tree-mismatch-run' },
      {
        ...dependencies,
        fetchGitState: () => ({
          ...dependencies.fetchGitState(),
          tree: hash40('f'),
        }),
      }
    ),
    /Frozen candidate differs from authenticated Git state/u
  );
  events.length = 0;
  const result = await executeDistributedLinuxPublicLifecycle(
    request,
    dependencies
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.schema, 'seerrng-distributed-linux-public-success/v2');
  assert.equal(
    result.outerEvidence.schema,
    DISTRIBUTED_LINUX_OUTER_EVIDENCE_SCHEMA
  );
  for (const { hashField } of DISTRIBUTED_LINUX_OUTER_EVIDENCE_FILES)
    assert.match(result.outerEvidence[hashField], /^[a-f0-9]{64}$/u);
  assert.equal(capturedManifest.candidate.sourceSha256, sourceSha256);
  assert.deepEqual(
    capturedManifest.dependencyMountpoint,
    dependencyMountpoint(ROOT, {
      commit: currentCommit,
      tree: currentTree,
      sourceSha256,
    })
  );
  const containedRequest = JSON.parse(
    readFileSync(
      join(scratchRoot, 'host-preparation', 'contained-request.json'),
      'utf8'
    )
  );
  const preparationDirectory = join(scratchRoot, 'host-preparation');
  assert.equal(
    JSON.parse(
      readFileSync(
        join(preparationDirectory, 'authenticated-git-closure.json'),
        'utf8'
      )
    ).cleanSourceVerified,
    true
  );
  assert.equal(
    containedRequest.schema,
    DISTRIBUTED_LINUX_CONTAINED_REQUEST_SCHEMA
  );
  assert.equal(
    containedRequest.hostPreparation.schema,
    DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA
  );
  assert.deepEqual(
    containedRequest.hostPreparation.inputs.map(({ role }) => role),
    [
      'controller-config',
      'active-controller-marker',
      'timing-profile-seed',
      'authenticated-git-evidence',
      'proof-parent-config',
      'proof-parent-script',
      'containment-manifest',
    ]
  );
  const persistedManifestBytes = readFileSync(
    join(preparationDirectory, 'containment-manifest.json')
  );
  assert.equal(
    containedRequest.hostPreparation.inputs.find(
      ({ role }) => role === 'containment-manifest'
    ).rawSha256,
    sha256(persistedManifestBytes)
  );
  const persistedRequestBytes = readFileSync(
    join(preparationDirectory, 'contained-request.json')
  );
  assert.equal(
    capturedPreparationRequest.rawSha256,
    sha256(persistedRequestBytes)
  );
  assert.deepEqual(capturedPreparationRequest.value, containedRequest);
  assert.equal(containedRequest.operatorGithubLogin, 'JohnCronk79');
  assert.equal(containedRequest.requiredCapacityProof.expectedLogicalCpus, 12);
  assert.equal(
    containedRequest.requiredCapacityProof.expectedConfiguredWorkers,
    24
  );
  assert.equal(
    capturedManifest.inner.environment.SEERR_MODE3_OPERATOR_GITHUB_LOGIN,
    'JohnCronk79'
  );
  assert.ok(
    capturedManifest.evidence.artifacts.some(
      ({ role }) => role === 'native-run-expectations'
    )
  );
  assert.ok(
    capturedManifest.evidence.artifacts.some(
      ({ role }) => role === 'host-preparation-receipt'
    )
  );
  assert.deepEqual(events, [
    'create-snapshot',
    'verify-clean-source',
    'prepare-dependency-mountpoint',
    'verify-dependency-mountpoint',
    'create-containment',
    'execute-host-lifecycle',
    'verify-dependency-mountpoint',
    'persist-profile',
    'verify-snapshot',
    'dispose-snapshot',
  ]);
  assert.equal(
    JSON.parse(
      readFileSync(
        join(
          logRoot,
          'mode3-focused-public-run',
          'launch-result-verification.json'
        ),
        'utf8'
      )
    ).hostPreparationCleanupVerified,
    true
  );
  assert.equal(
    existsSyncSafe(join(stateRoot, DISTRIBUTED_LINUX_TIMING_PROFILE_FILE)),
    false,
    'The persistence adapter, not an unowned fallback write, owns the profile'
  );
});

function existsSyncSafe(path) {
  try {
    readFileSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
