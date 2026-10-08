import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dockerfile = readFileSync(
  fileURLToPath(
    new URL(
      '../tools/validation-engine/container/Dockerfile.worker',
      import.meta.url
    )
  ),
  'utf8'
);
const logicalDockerfile = dockerfile.replace(/\\\r?\n\s*/g, ' ');

test('worker image pins the approved Node base and exact native tool set', () => {
  const from = dockerfile.match(/^FROM\s+.+$/gm) ?? [];
  assert.deepEqual(from, [
    'FROM mirror.gcr.io/library/node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2',
  ]);

  const packages = logicalDockerfile.match(
    /RUN apk add --no-cache\s+(.+?)\s+&& npm install/
  )?.[1];
  assert.ok(packages, 'worker image must install its native tools once');
  assert.deepEqual(packages.trim().split(/\s+/), [
    'bash',
    'coreutils',
    'findutils',
    'g++',
    'gcc',
    'git',
    'helm',
    'jq',
    'libc6-compat',
    'make',
    'openssh-keygen=10.2_p1-r0',
    'py3-setuptools',
    'python3',
    'sqlite',
    'tar',
    'tini=0.19.0-r3',
    'unzip',
    'zip',
  ]);
  assert.match(
    logicalDockerfile,
    /npm install --global node-gyp@13\.0\.2 pnpm@10\.24\.0/
  );
  assert.match(logicalDockerfile, /test "\$\(pnpm --version\)" = "10\.24\.0"/);
  assert.match(logicalDockerfile, /apk info -e tini=0\.19\.0-r3 >\/dev\/null/);
  assert.match(
    logicalDockerfile,
    /apk info -e openssh-keygen=10\.2_p1-r0 >\/dev\/null/
  );
  assert.match(
    logicalDockerfile,
    /test "\$\(tini --version 2>&1\)" = "tini version 0\.19\.0"/
  );
  assert.match(
    logicalDockerfile,
    /for required_command in helm jq sqlite3 zip unzip find tar python ssh-keygen tini; do\s+command -v "\$required_command" >\/dev\/null \|\| exit 1;\s+done/
  );
  assert.match(
    logicalDockerfile,
    /find --version \| grep -F 'GNU findutils' >\/dev\/null/
  );
  assert.match(
    logicalDockerfile,
    /tar --version \| grep -F 'GNU tar' >\/dev\/null/
  );
  assert.match(
    logicalDockerfile,
    /tar --help \| grep -F -- '--transform' >\/dev\/null/
  );
  for (const command of ['sha256sum', 'realpath', 'timeout'])
    assert.match(
      logicalDockerfile,
      new RegExp(
        `${command} --version \\| grep -F 'GNU coreutils' >\\/dev\\/null`
      )
    );
  assert.match(logicalDockerfile, /python --version >\/dev\/null/);
});

test('worker image admits only a sealed bundle and exact commit identity', () => {
  assert.deepEqual(
    [...dockerfile.matchAll(/^ARG\s+([A-Z0-9_]+)\s*$/gm)].map(
      (match) => match[1]
    ),
    ['SOURCE_COMMIT', 'SOURCE_BUNDLE_SHA256']
  );
  assert.deepEqual(dockerfile.match(/^(?:ADD|COPY)\s+.+$/gm) ?? [], [
    'COPY source.bundle /tmp/source.bundle',
  ]);
  assert.match(logicalDockerfile, /test "\$\{#SOURCE_COMMIT\}" -eq 40/);
  assert.match(logicalDockerfile, /test "\$\{#SOURCE_BUNDLE_SHA256\}" -eq 64/);
  assert.match(
    logicalDockerfile,
    /printf '%s {2}%s\\n' "\$SOURCE_BUNDLE_SHA256" \/tmp\/source\.bundle\s+\| sha256sum -c -/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace bundle verify \/tmp\/source\.bundle/
  );
  assert.match(logicalDockerfile, /mkdir \/workspace/);
  assert.match(
    logicalDockerfile,
    /git -C \/workspace init --quiet --object-format=sha1/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace bundle list-heads \/tmp\/source\.bundle\s+> \/tmp\/source-bundle-heads/
  );
  assert.match(
    logicalDockerfile,
    /case "\$ref_name" in\s+HEAD\) test "\$object_id" = "\$SOURCE_COMMIT" \|\| exit 1 ;;\s+refs\/tags\/v3\.\*\)/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace check-ref-format "\$ref_name" \|\| exit 1/
  );
  assert.match(
    logicalDockerfile,
    /grep -Fxc "\$SOURCE_COMMIT HEAD" \/tmp\/source-bundle-heads/
  );
  assert.match(
    logicalDockerfile,
    /cut -d ' ' -f 2 \/tmp\/source-bundle-heads\s+> \/tmp\/source-bundle-refnames/
  );
  assert.match(
    logicalDockerfile,
    /duplicate_refs="\$\(uniq -d \/tmp\/source-bundle-refnames\)"\s+&& test -z "\$duplicate_refs"/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace bundle unbundle \/tmp\/source\.bundle/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace update-ref "\$ref_name" "\$object_id" \|\| exit 1/
  );
  assert.match(
    logicalDockerfile,
    /peeled_commit="\$\(git -C \/workspace rev-parse\s+--verify "\$\{ref_name\}\^\{commit\}"\)" \|\| exit 1/
  );
  assert.match(
    logicalDockerfile,
    /sort -u \/tmp\/source-shallow -o \/workspace\/\.git\/shallow/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace update-ref refs\/heads\/candidate "\$SOURCE_COMMIT"/
  );
  assert.match(
    logicalDockerfile,
    /git -C \/workspace checkout --detach "\$SOURCE_COMMIT"/
  );
  assert.match(
    logicalDockerfile,
    /rev-parse --verify 'HEAD\^\{commit\}'\)"\s+= "\$SOURCE_COMMIT"/
  );
  assert.match(logicalDockerfile, /test -d \/workspace\/\.git/);
  assert.match(
    logicalDockerfile,
    /test "\$\(git -C \/workspace rev-list --count HEAD\)" = 1/
  );
  assert.match(
    logicalDockerfile,
    /commit_count="\$\(git -C \/workspace rev-list --count "\$ref_name"\)"\s+\|\| exit 1;\s+test "\$commit_count" = 1 \|\| exit 1/
  );
  assert.match(logicalDockerfile, /test -z "\$\(git -C \/workspace remote\)"/);
  assert.match(
    logicalDockerfile,
    /git -C \/workspace for-each-ref --sort=refname\s+--format='%\(objectname\) %\(refname\)' refs\/tags/
  );
  assert.match(
    logicalDockerfile,
    /unreachable_objects="\$\(git -C \/workspace fsck --full\s+--unreachable --no-reflogs 2>\/dev\/null\)"\s+&& test -z "\$unreachable_objects"/
  );
  assert.doesNotMatch(logicalDockerfile, /rm\s+-rf\s+[^\n]*\.git/);
});

test('worker source is installed frozen, clean, and owned by its runtime user', () => {
  assert.match(
    logicalDockerfile,
    /CYPRESS_INSTALL_BINARY=0 CI=true\s+pnpm --config\.engine-strict=true install --frozen-lockfile/
  );
  assert.ok(
    (logicalDockerfile.match(/status --porcelain=v1/g) ?? []).length >= 2,
    'cleanliness must be checked before and after dependency installation'
  );
  assert.match(logicalDockerfile, /chown -R node:node \/workspace/);
  assert.match(dockerfile, /^WORKDIR \/workspace$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.doesNotMatch(dockerfile, /^USER root$/m);
  assert.equal(
    dockerfile
      .trimEnd()
      .endsWith(
        'ENTRYPOINT ["/sbin/tini", "-g", "--", "node", "bin/run-local-validation.mjs"]'
      ),
    true
  );
  assert.doesNotMatch(dockerfile, /^CMD\b/m);
});

test('worker image runs a pinned init as non-root PID 1', () => {
  assert.match(logicalDockerfile, /apk add --no-cache\s+[^&]*tini=0\.19\.0-r3/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(
    dockerfile,
    /^ENTRYPOINT \["\/sbin\/tini", "-g", "--", "node", "bin\/run-local-validation\.mjs"\]$/m
  );
  assert.doesNotMatch(dockerfile, /^ENTRYPOINT \["node"/m);
});

test('worker image contains no secret or repository bootstrap channel', () => {
  const buildInputs = dockerfile.match(/^(?:ARG|ENV)\s+.+$/gm) ?? [];
  for (const directive of buildInputs)
    assert.doesNotMatch(
      directive,
      /(?:AUTH|CREDENTIAL|PASSWORD|PRIVATE|SECRET|TOKEN)/i
    );

  assert.doesNotMatch(logicalDockerfile, /\b(?:curl|wget)\b/i);
  assert.doesNotMatch(logicalDockerfile, /\b(?:download|bootstrap)\b/i);
  assert.doesNotMatch(logicalDockerfile, /https?:\/\//i);
  assert.doesNotMatch(logicalDockerfile, /\bcorepack\s+prepare\b/i);
  assert.doesNotMatch(dockerfile, /^(?:ADD|COPY)\s+\.(?:\s|$)/m);
  assert.doesNotMatch(dockerfile, /^ENTRYPOINT\s+.*(?:bash|sh|\.sh|\.bash)/im);
  assert.doesNotMatch(dockerfile, /^VOLUME\b/m);
});

test('worker image leaves isolation, config, application, and evidence to runtime mounts', () => {
  for (const requirement of [
    '--read-only',
    '--tmpfs /tmp',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    'active node config',
    'application root',
    'mounted read-only',
    'bounded writable mount',
  ])
    assert.ok(
      dockerfile.includes(requirement),
      `missing runtime contract: ${requirement}`
    );
  assert.match(dockerfile, /^ENV HOME=\/tmp\/home$/m);
  assert.match(dockerfile, /^ENV XDG_CACHE_HOME=\/tmp\/cache$/m);
  assert.match(dockerfile, /^ENV TMPDIR=\/tmp$/m);
  assert.match(dockerfile, /^ENV GIT_OPTIONAL_LOCKS=0$/m);
});
