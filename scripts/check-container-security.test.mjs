import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const ciWorkflow = yaml.load(
  fs.readFileSync(
    path.join(rootDirectory, '.github', 'workflows', 'ci.yml'),
    'utf8'
  )
);
const deploySteps = ciWorkflow.jobs['deploy-main'].steps;
const deployScript = deploySteps.find(
  (step) => step.name === 'Deploy seerr.home'
).run;
const deploymentValidationScript = deploySteps.find(
  (step) => step.name === 'Validate deployment inputs'
).run;
const rollbackStep = deploySteps.find(
  (step) => step.name === 'Restore previous seerr.home deployment'
);

const composeFiles = [
  'deploy/compose.main.yml',
  'deploy/compose.readonly-local.yml',
  'deploy/compose.readonly-swap.yml',
];
const expectedTemporaryFilesystems = [
  '/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=1777',
  '/app/.next/cache:rw,noexec,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0700',
];

for (const composeFile of composeFiles) {
  test(`${composeFile} confines the SeerrNG container`, () => {
    const document = yaml.load(
      fs.readFileSync(path.join(rootDirectory, composeFile), 'utf8')
    );
    const service = document.services.seerrng;

    assert.equal(service.init, true);
    assert.equal(service.user, '1000:1000');
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(service.tmpfs, expectedTemporaryFilesystems);
    assert.ok(
      service.volumes.some((volume) => volume.endsWith(':/app/config')),
      'the writable configuration volume is missing'
    );
    assert.equal(service.healthcheck.test[0], 'CMD-SHELL');
    assert.match(
      service.healthcheck.test[1],
      /127\.0\.0\.1:5055\/api\/v1\/status\/ready/
    );
  });
}

test('the production image has an explicit unprivileged final user', () => {
  const dockerfile = fs.readFileSync(
    path.join(rootDirectory, 'Dockerfile'),
    'utf8'
  );
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

  assert.match(finalStage, /\nUSER node:node\n/);
  assert.match(finalStage, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
});

test('the Docker build context excludes runtime state and common secrets', () => {
  const ignoredPaths = new Set(
    fs
      .readFileSync(path.join(rootDirectory, '.dockerignore'), 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith('#'))
  );

  for (const expectedPattern of [
    '.env*',
    '.git',
    '.npmrc',
    '**/*.key',
    '**/*.p12',
    '**/*.pfx',
    '**/*.pem',
    'config',
  ]) {
    assert.ok(
      ignoredPaths.has(expectedPattern),
      `${expectedPattern} is exposed to the Docker build context`
    );
  }
});

test('the main deployment runs the pulled digest inside the container boundary', () => {
  const pullScript = deploySteps.find(
    (step) => step.name === 'Pull latest main image'
  ).run;
  const prepareScript = deploySteps.find(
    (step) => step.name === 'Prepare config directory'
  ).run;
  const verifyScript = deploySteps.find(
    (step) => step.name === 'Verify seerr.home deployment'
  ).run;
  assert.match(pullScript, /SEERRNG_IMAGE_DIGEST/u);
  assert.match(pullScript, /invalid image digest/u);
  assert.match(pullScript, /SEERRNG_IMAGE_REF/u);
  assert.match(deploymentValidationScript, /65535/u);
  assert.match(deploymentValidationScript, /SEERRNG_CONFIG_DIR/u);
  assert.match(prepareScript, /"\$SEERRNG_IMAGE_REF"/u);
  assert.match(deployScript, /"\$SEERRNG_IMAGE_REF"/u);
  assert.match(deployScript, /export-external-config\.mjs/u);
  assert.match(deployScript, /--env-file "\$external_env_file"/u);
  assert.match(deployScript, /-f "\$SEERRNG_CONFIG_DIR\/settings\.json"/u);
  assert.match(
    deployScript,
    /starting SeerrNG so it can initialize the config/u
  );
  assert.match(deployScript, /docker rename/u);
  assert.match(deployScript, /\/api\/v1\/status\/ready/u);
  assert.match(verifyScript, /\$RUNNER_TEMP\/seerr-main-status\.json/u);
  assert.match(verifyScript, /process\.argv\[1\]/u);
  assert.equal(
    rollbackStep.if,
    "(failure() || cancelled()) && steps.deploy-main.outputs.cutover_started == 'true'"
  );
  assert.match(rollbackStep.run, /docker rename/u);
  assert.match(rollbackStep.run, /docker start/u);

  for (const flag of [
    '--init',
    '--user 1000:1000',
    '--read-only',
    '--cap-drop ALL',
    '--security-opt no-new-privileges:true',
    '--tmpfs /tmp:',
    '--tmpfs /app/.next/cache:',
    '--health-cmd',
    '--health-start-period 20s',
  ]) {
    assert.ok(
      deployScript.includes(flag),
      `${flag} is missing from deployment`
    );
  }
});

test('deployment inputs are rejected before Docker receives them', () => {
  const validEnvironment = {
    ...process.env,
    SEERRNG_CONFIG_DIR: '/srv/seerr-config',
    SEERRNG_CONTAINER_NAME: 'seerr-host',
    SEERRNG_PORT: '5055',
  };
  const runValidation = (overrides = {}) =>
    spawnSync('bash', ['-c', deploymentValidationScript], {
      encoding: 'utf8',
      env: { ...validEnvironment, ...overrides },
    });

  assert.equal(runValidation().status, 0);
  for (const overrides of [
    { SEERRNG_CONTAINER_NAME: '--privileged' },
    { SEERRNG_PORT: '5055); process.exit(0)' },
    { SEERRNG_PORT: '65536' },
    { SEERRNG_CONFIG_DIR: 'relative/config' },
    { SEERRNG_CONFIG_DIR: '/srv/config:/host' },
    { SEERRNG_CONFIG_DIR: '/srv/config\nforged' },
  ]) {
    assert.notEqual(runValidation(overrides).status, 0);
  }
});

const createFakeDockerFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-deploy-rollback-'));
  const binDirectory = path.join(root, 'bin');
  const stateDirectory = path.join(root, 'state');
  fs.mkdirSync(binDirectory);
  fs.mkdirSync(stateDirectory);
  fs.writeFileSync(
    path.join(binDirectory, 'docker'),
    `#!/bin/sh
set -eu
state=\${FAKE_DOCKER_STATE:?}
command=\$1
shift
last=''
for argument in "\$@"; do last=\$argument; done
case "\$command" in
  inspect)
    test -f "\$state/\$last"
    ;;
  rm)
    rm -f "\$state/\$last"
    ;;
  stop)
    test -f "\$state/\$last"
    printf 'stop %s\\n' "\$last" >> "\$state/operations"
    ;;
  rename)
    if [ "\${FAKE_FAIL_RENAME:-}" = true ]; then exit 41; fi
    mv "\$state/\$1" "\$state/\$2"
    printf 'rename %s %s\\n' "\$1" "\$2" >> "\$state/operations"
    ;;
  run)
    name=''
    while [ "\$#" -gt 0 ]; do
      if [ "\$1" = --name ]; then
        name=\$2
        shift 2
      else
        shift
      fi
    done
    if [ -z "\$name" ]; then
      printf '{"main":{},"plex":{},"jellyfin":{},"tautulli":{},"radarr":[],"sonarr":[],"notifications":{}}\\n'
      exit 0
    fi
    test -n "\$name"
    printf 'new' > "\$state/\$name"
    printf 'run %s\\n' "\$name" >> "\$state/operations"
    printf 'fake-container-id\\n'
    ;;
  start)
    test -f "\$state/\$last"
    printf 'start %s\\n' "\$last" >> "\$state/operations"
    ;;
  *)
    printf 'unsupported docker command: %s\\n' "\$command" >&2
    exit 64
    ;;
esac
`,
    { mode: 0o755 }
  );

  const outputPath = path.join(root, 'github-output');
  const environment = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
    FAKE_DOCKER_STATE: stateDirectory,
    GITHUB_OUTPUT: outputPath,
    LOG_LEVEL: 'info',
    SEERRNG_CONFIG_DIR: '/srv/seerr-config',
    SEERRNG_CONTAINER_NAME: 'seerr-host',
    SEERRNG_IMAGE_REF: `ghcr.io/snapetech/seerrng@sha256:${'a'.repeat(64)}`,
    SEERRNG_PORT: '5055',
  };

  return { environment, outputPath, root, stateDirectory };
};

test('failed verification restores the retained deployment container', () => {
  const fixture = createFakeDockerFixture();
  try {
    fs.writeFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'old');
    const deployed = spawnSync('bash', ['-c', deployScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(
      fs.readFileSync(fixture.outputPath, 'utf8'),
      'cutover_started=true\n'
    );
    assert.equal(
      fs.readFileSync(
        path.join(fixture.stateDirectory, 'seerr-host-rollback'),
        'utf8'
      ),
      'old'
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'utf8'),
      'new'
    );

    const restored = spawnSync('bash', ['-c', rollbackStep.run], {
      encoding: 'utf8',
      env: fixture.environment,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(
      fs.readFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'utf8'),
      'old'
    );
    assert.equal(
      fs.existsSync(path.join(fixture.stateDirectory, 'seerr-host-rollback')),
      false
    );
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('a later deployment preserves rollback state left by runner loss', () => {
  const fixture = createFakeDockerFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.stateDirectory, 'seerr-host'),
      'unverified'
    );
    fs.writeFileSync(
      path.join(fixture.stateDirectory, 'seerr-host-rollback'),
      'known-good'
    );
    const deployed = spawnSync('bash', ['-c', deployScript], {
      encoding: 'utf8',
      env: fixture.environment,
    });
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(
      fs.readFileSync(
        path.join(fixture.stateDirectory, 'seerr-host-rollback'),
        'utf8'
      ),
      'known-good'
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'utf8'),
      'new'
    );

    const restored = spawnSync('bash', ['-c', rollbackStep.run], {
      encoding: 'utf8',
      env: fixture.environment,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(
      fs.readFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'utf8'),
      'known-good'
    );
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('rollback restarts the old container if cancellation lands before rename', () => {
  const fixture = createFakeDockerFixture();
  try {
    fs.writeFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'old');
    const interrupted = spawnSync('bash', ['-c', deployScript], {
      encoding: 'utf8',
      env: { ...fixture.environment, FAKE_FAIL_RENAME: 'true' },
    });
    assert.equal(interrupted.status, 41);

    const restored = spawnSync('bash', ['-c', rollbackStep.run], {
      encoding: 'utf8',
      env: fixture.environment,
    });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(
      fs.readFileSync(path.join(fixture.stateDirectory, 'seerr-host'), 'utf8'),
      'old'
    );
    assert.match(
      fs.readFileSync(path.join(fixture.stateDirectory, 'operations'), 'utf8'),
      /start seerr-host/u
    );
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('main CI runs cannot cancel a deployment during cutover', () => {
  assert.equal(ciWorkflow.jobs.publish.concurrency['cancel-in-progress'], true);
  assert.deepEqual(ciWorkflow.jobs['deploy-main'].concurrency, {
    group: 'seerrng-live-deploy',
    'cancel-in-progress': false,
  });
  assert.equal(
    ciWorkflow.concurrency['cancel-in-progress'],
    "${{ github.event_name == 'pull_request' }}"
  );
});
