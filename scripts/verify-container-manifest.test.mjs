import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const rootDirectory = path.resolve(import.meta.dirname, '..');
const verifier = path.join(
  rootDirectory,
  'scripts',
  'verify-container-manifest.sh'
);

test('ignores unknown-platform provenance descriptors when verifying platforms', () => {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'seerrng-manifest-test-')
  );
  try {
    const dockerPath = path.join(temporaryDirectory, 'docker');
    const fixturePath = path.join(temporaryDirectory, 'manifest.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        manifests: [
          {
            digest: 'sha256:' + 'a'.repeat(64),
            platform: { architecture: 'amd64', os: 'linux' },
          },
          {
            digest: 'sha256:' + 'b'.repeat(64),
            platform: { architecture: 'arm64', os: 'linux' },
          },
          {
            annotations: {
              'vnd.docker.reference.type': 'attestation-manifest',
            },
            digest: 'sha256:' + 'c'.repeat(64),
            platform: { architecture: 'unknown', os: 'unknown' },
          },
        ],
        mediaType: 'application/vnd.oci.image.index.v1+json',
      })
    );
    writeFileSync(
      dockerPath,
      '#!/usr/bin/env bash\ncat "$MANIFEST_FIXTURE"\n',
      { mode: 0o755 }
    );

    const result = spawnSync(
      'bash',
      [
        verifier,
        '--require-provenance',
        'example:tag',
        'linux/amd64',
        'linux/arm64',
      ],
      {
        env: {
          ...process.env,
          MANIFEST_FIXTURE: fixturePath,
          PATH: `${temporaryDirectory}:${process.env.PATH}`,
        },
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Verified example:tag: linux\/amd64, linux\/arm64/
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
