// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  computeDistributedLinuxRunnerClosureSha256,
  createDistributedLinuxNodeAttestation,
  DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA,
  verifyDistributedLinuxNodeAttestation,
} from '../tools/validation-engine/runtime/distributed-linux-node-attestation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  createNodeConfig,
  serializeNodeConfig,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';

const temporaryRoots = new Set();
const SHARED_KEY = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
  temporaryRoots.clear();
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nodeConfig() {
  return createNodeConfig({
    controller: { ipAddress: '127.0.0.2', port: 49_100 },
    node: {
      nodeNumber: '01',
      computerName: 'Focused node',
      ipAddress: '127.0.0.1',
      port: 49_101,
      cpuName: 'Focused CPU',
      availableThreads: 8,
    },
    sharedAuthenticationKey: SHARED_KEY,
  });
}

async function runtimeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'seerrng-node-attestation-'));
  temporaryRoots.add(root);
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'tools', 'validation-engine', 'runtime'), {
    recursive: true,
  });
  await Promise.all([
    writeFile(join(root, 'bin', 'local-validation.mjs'), 'export {}\n'),
    writeFile(join(root, 'bin', 'platform-tools.mjs'), 'export {}\n'),
    writeFile(join(root, 'bin', 'run-local-validation.mjs'), 'export {}\n'),
    writeFile(
      join(root, 'tools', 'validation-engine', 'runtime', 'a.mjs'),
      'export const a = 1;\n'
    ),
    writeFile(
      join(root, 'tools', 'validation-engine', 'runtime', 'b.mjs'),
      'export const b = 2;\n'
    ),
    writeFile(join(root, 'focused-node'), 'focused executable\n'),
  ]);
  return {
    root,
    executablePath: join(root, 'focused-node'),
    runtimeA: join(root, 'tools', 'validation-engine', 'runtime', 'a.mjs'),
  };
}

test('attests canonical active config, exact runner closure, and Node runtime without leaking config data or paths', async () => {
  const fixture = await runtimeFixture();
  const config = nodeConfig();
  const attestation = await createDistributedLinuxNodeAttestation(config, {
    repositoryRoot: fixture.root,
    executablePath: fixture.executablePath,
    nodeVersion: 'v24.21.0',
    platform: 'linux',
    architecture: 'x64',
  });

  assert.equal(attestation.schema, DISTRIBUTED_LINUX_NODE_ATTESTATION_SCHEMA);
  assert.equal(
    attestation.activeNodeConfigSha256,
    sha256(serializeNodeConfig(config))
  );
  assert.equal(attestation.runnerClosureSha256.length, 64);
  assert.equal(
    attestation.nodeExecutableSha256,
    sha256('focused executable\n')
  );
  assert.equal(attestation.nodeVersion, 'v24.21.0');
  assert.equal(attestation.platform, 'linux');
  assert.equal(attestation.architecture, 'x64');
  assert.deepEqual(
    verifyDistributedLinuxNodeAttestation(attestation),
    attestation
  );
  assert.ok(Object.isFrozen(attestation));

  const encoded = JSON.stringify(attestation);
  assert.doesNotMatch(encoded, new RegExp(SHARED_KEY));
  assert.doesNotMatch(encoded, /Focused node|127\.0\.0\.1|repositoryRoot/);
  assert.doesNotMatch(encoded, /executablePath|sharedAuthenticationKey/);
});

test('runner closure identity changes when any installed runtime module changes', async () => {
  const fixture = await runtimeFixture();
  const before = await computeDistributedLinuxRunnerClosureSha256({
    repositoryRoot: fixture.root,
  });
  await writeFile(fixture.runtimeA, 'export const a = 2;\n');
  const after = await computeDistributedLinuxRunnerClosureSha256({
    repositoryRoot: fixture.root,
  });
  assert.notEqual(after, before);
});

test('attestation verifier rejects malformed fields, extensions, and a changed self-hash', async () => {
  const fixture = await runtimeFixture();
  const attestation = await createDistributedLinuxNodeAttestation(
    nodeConfig(),
    {
      repositoryRoot: fixture.root,
      executablePath: fixture.executablePath,
      nodeVersion: 'v24.21.0',
      platform: 'linux',
      architecture: 'x64',
    }
  );
  assert.throws(
    () =>
      verifyDistributedLinuxNodeAttestation({
        ...attestation,
        extra: true,
      }),
    /unexpected or missing fields/
  );
  assert.throws(
    () =>
      verifyDistributedLinuxNodeAttestation({
        ...attestation,
        runnerClosureSha256: 'f'.repeat(64),
      }),
    /seal is invalid/
  );
  assert.throws(
    () =>
      verifyDistributedLinuxNodeAttestation({
        ...attestation,
        attestationSha256: 'f'.repeat(64),
      }),
    /seal is invalid/
  );
});
