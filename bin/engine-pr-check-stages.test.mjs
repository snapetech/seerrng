// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import {
  acceptNativeLycheeResult,
  acceptSupplementalNativeCases,
  createSupplementalPrStages,
  normalizeSupplementalPrChecks,
  supplementalApplicability,
  supplementalCompletion,
} from '../tools/validation-engine/runtime/pr-check-stages.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import { resolveReviewedPrMetadata } from '../tools/validation-engine/runtime/native-stage-context.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const candidate = {
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  sourceSha256: 'c'.repeat(64),
};
const binary = (version = '1.0.0') => ({
  verified: true,
  version,
  executableSha256: 'd'.repeat(64),
});

async function fixture(t) {
  const scratchRoot = await mkdtemp(
    path.join(os.tmpdir(), 'seerrng-pr-stages-test-')
  );
  t.after(() => rm(scratchRoot, { recursive: true, force: true }));
  const root = path.join(scratchRoot, 'source');
  const fixtureRoot = path.join(scratchRoot, 'fixtures');
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await mkdir(path.join(root, 'gen-docs'));
  await mkdir(fixtureRoot);
  for (const workflow of [
    'ci.yml',
    'test-docs.yml',
    'lint-helm-charts.yml',
    'docs-link-check.yml',
    'pr-validation.yml',
    'conflict_labeler.yml',
  ])
    await writeFile(
      path.join(root, '.github', 'workflows', workflow),
      `workflow:${workflow}`
    );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'security:council':
          'node workflow && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh',
      },
    })
  );
  await writeFile(
    path.join(root, 'gen-docs', 'package.json'),
    JSON.stringify({
      scripts: {
        'test:security': 'node --test scripts/image-size-security.test.mjs',
        'gen-api-docs': 'docusaurus gen-api-docs all',
        build: 'docusaurus build',
      },
    })
  );
  await writeFile(path.join(root, 'gen-docs', 'pnpm-lock.yaml'), 'locked docs');
  return { root, scratchRoot, fixtureRoot, candidate, configuredWorkers: 4 };
}

const allTools = () => ({
  bash: binary(),
  perl: binary(),
  find: binary(),
  git: { ...binary(), completeHistory: true, completeTags: true },
  dotnet9: { ...binary('9.0.318'), executable: '/owned/dotnet9/dotnet' },
  python3: binary('3.11.9'),
  docker: {
    ...binary(),
    daemonVerified: true,
    scratchBindPathsVerified: true,
    loopbackReachabilityVerified: true,
  },
  ct: {
    ...binary('3.14.0'),
    executable: '/owned/ct/ct',
    configDir: '/owned/ct/etc',
    configSha256: {
      chartSchema:
        'a554cca0ea6454b6359f88f505146d79fbad7077bdc0572dcf698c0f3e033c53',
      lintconf:
        '8dee081250acc0e2619674392c67f2801051b5de37289591a54e4b38aa77802e',
    },
  },
  helm: binary(),
  helmDocs: binary('1.14.2'),
  yamllint: { ...binary('1.33.0'), executable: '/owned/venv/bin/yamllint' },
  yamale: { ...binary('6.0.0'), executable: '/owned/venv/bin/yamale' },
  lychee: binary('0.24.2'),
  docsDependencies: { verified: true, lockSha256: hash('locked docs') },
});

test('native docs link globs run on an independent checkout without changing selection', async (t) => {
  const options = await fixture(t);
  const linksRoot = path.join(options.scratchRoot, 'link-checkout');
  await mkdir(linksRoot);
  const plan = await createSupplementalPrStages({
    ...options,
    linksRoot,
    tools: allTools(),
  });
  const scan = plan.checks.find(
    (check) => check.id === 'docs-links-native-scan'
  );
  assert.equal(scan.cwd, linksRoot);
  assert.deepEqual(scan.args.slice(-4), [
    './docs/**/*.md',
    './docs/**/*.mdx',
    './gen-docs/**/*.md',
    './gen-docs/**/*.mdx',
  ]);
  const council = plan.checks.find(
    (check) => check.id === 'council-workflow-boundaries'
  );
  assert.equal(council.cwd, options.root);
  await assert.rejects(
    createSupplementalPrStages({ ...options, linksRoot: options.fixtureRoot }),
    /owned scratch source/
  );
});
const byId = (plan, id) => plan.checks.find((check) => check.id === id);

test('native supplemental reporting and compiler lifetime are sealed without changing test selection', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
    env: {
      NODE_OPTIONS: '--require=untrusted',
      DOCKER_HOST: 'unix:///owned/docker.sock',
    },
  });
  const security = byId(plan, 'docs-image-parser-security');
  assert.deepEqual(security.args, ['test:security']);
  assert.equal(security.env.NODE_OPTIONS, '--test-reporter=tap');
  assert.ok(
    byId(plan, 'jellyfin-plugin-publish').args.includes(
      '--disable-build-servers'
    )
  );
  assert.equal(
    byId(plan, 'jellyfin-plugin-native-smoke').env.DOCKER_HOST,
    'unix:///owned/docker.sock'
  );
});
test('only the immutable-dependency docs build disables its persistent compiler cache', async (t) => {
  const options = await fixture(t);
  const env = { DOCUSAURUS_NO_PERSISTENT_CACHE: '', PRESERVED: 'native-input' };
  const plan = await createSupplementalPrStages({
    ...options,
    tools: allTools(),
    env,
  });
  const build = byId(plan, 'docs-production-build');
  assert.equal(build.command, 'pnpm');
  assert.deepEqual(build.args, ['build']);
  assert.equal(build.cwd, path.join(options.root, 'gen-docs'));
  assert.equal(build.env.DOCUSAURUS_NO_PERSISTENT_CACHE, '1');
  assert.equal(build.env.PRESERVED, 'native-input');
  assert.deepEqual(build.dependsOn, ['docs-api-generate']);
  assert.deepEqual(build.writes, ['gen-docs/.docusaurus/', 'gen-docs/build/']);
  for (const check of plan.checks)
    if (check.command && check.id !== build.id)
      assert.equal(check.env.DOCUSAURUS_NO_PERSISTENT_CACHE, '');
  assert.deepEqual(env, {
    DOCUSAURUS_NO_PERSISTENT_CACHE: '',
    PRESERVED: 'native-input',
  });
});

const receipt = (id, state = 'executed-pass') => ({
  id,
  state,
  sourceSha256: candidate.sourceSha256,
  evidenceSha256: 'e'.repeat(64),
});

test('full scope includes docs/charts/links independently of native PR path triggers', () => {
  const result = supplementalApplicability({
    scope: 'full',
    changedFiles: ['bin/engine.mjs'],
    baseBranch: 'main',
  });
  for (const check of Object.values(result)) {
    assert.equal(check.selected, true);
    assert.equal(check.nativeApplicable, false);
  }
});

test('native PR applicability distinguishes unknown, excluded branch, path inclusion and workflow changes', () => {
  assert.equal(supplementalApplicability({ scope: 'pr' }).docs.selected, null);
  assert.equal(
    supplementalApplicability({
      scope: 'pr',
      changedFiles: ['docs/index.md'],
      baseBranch: 'main',
    }).docs.selected,
    true
  );
  assert.equal(
    supplementalApplicability({
      scope: 'pr',
      changedFiles: ['docs/index.md'],
      baseBranch: 'develop',
    }).docs.selected,
    false
  );
  const changes = supplementalApplicability({
    scope: 'pr',
    changedFiles: ['.github/workflows/docs-link-check.yml'],
    baseBranch: 'main',
  });
  assert.equal(changes.links.selected, true);
  assert.equal(changes.docs.selected, false);
  assert.throws(
    () => supplementalApplicability({ changedFiles: ['../escape'] }),
    /repository-relative/
  );
});

test('missing prerequisites and PR metadata remain blocked/pending, not passed', async (t) => {
  const plan = await createSupplementalPrStages(await fixture(t));
  assert.equal(
    byId(plan, 'council-browser-boundaries').state,
    'prerequisite-blocked'
  );
  assert(
    byId(plan, 'council-browser-boundaries').missingPrerequisites.includes(
      'perl'
    )
  );
  assert.equal(
    byId(plan, 'jellyfin-plugin-publish').state,
    'prerequisite-blocked'
  );
  assert.equal(
    byId(plan, 'docs-production-build').state,
    'prerequisite-blocked'
  );
  assert.equal(
    byId(plan, 'release-note-contract').state,
    'GitHub-native-pending'
  );
  assert.equal(supplementalCompletion(plan, []).status, 'incomplete');
});

test('native supplementary commands preserve .NET9, pinned smoke, required build order and advisory link policy', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  assert.equal(
    byId(plan, 'jellyfin-plugin-publish').command,
    '/owned/dotnet9/dotnet'
  );
  assert(byId(plan, 'jellyfin-plugin-publish').args.includes('Release'));
  assert.equal(byId(plan, 'jellyfin-plugin-native-smoke').state, 'ready');
  assert(
    byId(plan, 'jellyfin-plugin-native-smoke').fixtureImage.includes('@sha256:')
  );
  assert.deepEqual(byId(plan, 'docs-production-build').dependsOn, [
    'docs-api-generate',
  ]);
  assert.deepEqual(byId(plan, 'docs-api-generate').dependsOn, [
    'docs-image-parser-security',
  ]);
  assert(byId(plan, 'charts-native-lint').args.includes('--all'));
  const links = byId(plan, 'docs-links-native-scan');
  assert.equal(links.required, true);
  assert.equal(byId(plan, 'docs-links-advisory').required, false);
  assert.equal(byId(plan, 'docs-links-advisory').command, undefined);
  assert(links.args.includes('markdown'));
  assert(links.args.includes('task'));
  assert(links.args.includes('200..204,300..304,307,308,404,429,999'));
  assert.equal(links.env.GITHUB_TOKEN, '');
  assert.equal(
    byId(plan, 'charts-native-lint').env.CT_CONFIG_DIR,
    '/owned/ct/etc'
  );
  assert(byId(plan, 'charts-native-lint').env.PATH.includes('/owned/venv/bin'));
  assert.equal(
    byId(plan, 'council-native-tooling').state,
    'delegated-to-native-owner'
  );
});

test('action-pinned chart validators, ct bundled configs and lychee versions cannot silently drift', async (t) => {
  const options = await fixture(t);
  for (const [name, version, id] of [
    ['ct', '3.13.0', 'charts-native-lint'],
    ['yamllint', '1.38.0', 'charts-native-lint'],
    ['yamale', '6.1.0', 'charts-native-lint'],
    ['lychee', '0.24.3', 'docs-links-native-scan'],
  ]) {
    const tools = allTools();
    tools[name].version = version;
    assert.equal(
      byId(await createSupplementalPrStages({ ...options, tools }), id).state,
      'prerequisite-blocked'
    );
  }
  const tools = allTools();
  tools.ct.configSha256.lintconf = 'f'.repeat(64);
  assert.equal(
    byId(
      await createSupplementalPrStages({ ...options, tools }),
      'charts-native-lint'
    ).state,
    'prerequisite-blocked'
  );
});

const lycheeMarkdown = (total = 2) =>
  '# Summary\n\n| Status | Count |\n|---|---|\n' +
  [
    ['🔍 Total', total],
    ['🔗 Unique', total],
    ['✅ Successful', 0],
    ['⏳ Timeouts', 0],
    ['🔀 Redirected', 0],
    ['👻 Excluded', 0],
    ['❓ Unknown', 0],
    ['🚫 Errors', total],
    ['⛔ Unsupported', 0],
  ]
    .map(([label, count]) => `| ${label} | ${count} |`)
    .join('\n') +
  '\n';
const lycheeReceipt = (exitCode = 2) => ({
  status: exitCode === 0 ? 'passed' : 'failed',
  exitCode,
  wallMs: 12,
  lifecycle: {
    completed: true,
    cleanupVerified: true,
    aborted: false,
    timedOut: false,
    signal: null,
  },
});

test('one native Lychee scan accepts only proven exits0/2 and distinguishes advisory links from required empty/configuration failure', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  const scan = byId(plan, 'docs-links-native-scan');
  const nativeLychee = acceptNativeLycheeResult(
    scan,
    lycheeReceipt(),
    lycheeMarkdown()
  );
  assert.equal(nativeLychee.status, 'passed');
  assert.equal(nativeLychee.linkOutcome, 'advisory-findings');
  assert.equal(nativeLychee.counts.total, 2);
  const completion = supplementalCompletion(plan, [
    { ...receipt(scan.id), nativeLychee },
  ]);
  assert.equal(
    completion.checks.find((check) => check.id === scan.id).outcome,
    'executed-pass'
  );
  assert.equal(
    completion.checks.find((check) => check.id === 'docs-links-advisory')
      .outcome,
    'advisory'
  );
  assert.throws(
    () => supplementalCompletion(plan, [receipt(scan.id)]),
    /Unproved native Lychee/
  );
  assert.throws(
    () => acceptNativeLycheeResult(scan, lycheeReceipt(), lycheeMarkdown(0)),
    /zero links/
  );
  for (const exit of [1, 3, 127])
    assert.throws(
      () =>
        acceptNativeLycheeResult(scan, lycheeReceipt(exit), lycheeMarkdown()),
      /execution\/configuration/
    );
  for (const patch of [
    { completed: false },
    { cleanupVerified: false },
    { aborted: true },
    { timedOut: true },
    { signal: 'SIGTERM' },
  ])
    assert.throws(
      () =>
        acceptNativeLycheeResult(
          scan,
          {
            ...lycheeReceipt(),
            lifecycle: { ...lycheeReceipt().lifecycle, ...patch },
          },
          lycheeMarkdown()
        ),
      /lifecycle/
    );
  assert.throws(
    () =>
      acceptNativeLycheeResult(
        scan,
        { ...lycheeReceipt(), wallMs: undefined },
        lycheeMarkdown()
      ),
    /lifecycle/
  );
  assert.throws(
    () =>
      acceptNativeLycheeResult(
        scan,
        lycheeReceipt(),
        lycheeMarkdown() + '| 🔍 Total | 2 |\n'
      ),
    /duplicate/
  );
  assert.throws(
    () => acceptNativeLycheeResult(scan, lycheeReceipt(), '# Summary\n'),
    /count/
  );
  const normalized = normalizeSupplementalPrChecks(plan);
  assert.equal(
    normalized.prChecks.filter((check) => check.id.startsWith('docs-links'))
      .length,
    1
  );
  assert.equal(normalized.derivedCoverageReferences[0].owner, scan.id);
});

test('wrong SDK, helm-docs version, lockfile or daemon paths block their check', async (t) => {
  const tools = allTools();
  tools.dotnet9.version = '10.0.100';
  tools.helmDocs.version = '1.14.3';
  tools.docsDependencies.lockSha256 = 'f'.repeat(64);
  tools.docker.scratchBindPathsVerified = false;
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools,
  });
  for (const id of [
    'jellyfin-plugin-publish',
    'charts-generated-docs',
    'docs-production-build',
    'jellyfin-plugin-native-smoke',
  ])
    assert.equal(byId(plan, id).state, 'prerequisite-blocked');
});

test('PR release body requires exact source/head/base and full Git closure; no opt-out is generated', async (t) => {
  const options = await fixture(t);
  const bodyFile = path.join(options.fixtureRoot, 'reviewed-pr-body.md');
  const body = 'A reviewed human body';
  await writeFile(bodyFile, body);
  const metadata = {
    source: 'proposed-reviewed',
    head: candidate.commit,
    headTree: candidate.tree,
    headSourceSha256: candidate.sourceSha256,
    base: 'f'.repeat(40),
    bodyFile,
    bodySha256: hash(body),
    authorType: 'User',
  };
  const plan = await createSupplementalPrStages({
    ...options,
    metadata,
    tools: allTools(),
  });
  assert.equal(byId(plan, 'release-note-contract').state, 'ready');
  assert(byId(plan, 'release-note-contract').args.includes(bodyFile));
  const stale = await createSupplementalPrStages({
    ...options,
    metadata: { ...metadata, headSourceSha256: 'f'.repeat(64) },
    tools: allTools(),
  });
  assert.equal(
    byId(stale, 'release-note-contract').state,
    'GitHub-native-pending'
  );
  await writeFile(bodyFile, 'changed');
  await assert.rejects(
    createSupplementalPrStages({ ...options, metadata, tools: allTools() }),
    /body bytes changed/
  );
});

test('reviewed release metadata callback is optional, explicit, isolated and invoked once', async () => {
  const paths = { fixtureRoot: '/owned/fixtures', scratchRoot: '/owned' };
  assert.equal(
    await resolveReviewedPrMetadata(undefined, candidate, paths),
    undefined
  );
  for (const invalid of [null, {}, 'metadata'])
    await assert.rejects(
      resolveReviewedPrMetadata(invalid, candidate, paths),
      /explicit callback/
    );
  let calls = 0;
  const result = { source: 'proposed-reviewed' };
  assert.equal(
    await resolveReviewedPrMetadata(
      async (actual, owned) => {
        calls += 1;
        assert.deepEqual(actual, candidate);
        assert.deepEqual(owned, paths);
        assert.notEqual(actual, candidate);
        assert.notEqual(owned, paths);
        assert(Object.isFrozen(actual));
        assert(Object.isFrozen(owned));
        assert.throws(() => {
          actual.commit = 'changed';
        }, TypeError);
        assert.throws(() => {
          owned.fixtureRoot = '/escape';
        }, TypeError);
        return result;
      },
      candidate,
      paths
    ),
    result
  );
  assert.equal(calls, 1);
  await assert.rejects(
    resolveReviewedPrMetadata(
      () => {
        throw new Error('review refused');
      },
      candidate,
      paths
    ),
    /review refused/
  );
});

test('reviewed release callback preserves native candidate, body, history and GitHub metadata gates', async (t) => {
  const options = await fixture(t);
  const bodyFile = path.join(options.fixtureRoot, 'local-review-body.txt');
  const body = 'Reviewed local validation metadata; not a GitHub PR body.';
  await writeFile(bodyFile, body);
  const metadata = await resolveReviewedPrMetadata(
    (actual, owned) => ({
      source: 'proposed-reviewed',
      head: actual.commit,
      headTree: actual.tree,
      headSourceSha256: actual.sourceSha256,
      base: 'f'.repeat(40),
      authorType: 'User',
      bodyFile: path.join(owned.fixtureRoot, 'local-review-body.txt'),
      bodySha256: hash(body),
    }),
    candidate,
    options
  );
  const plan = await createSupplementalPrStages({
    ...options,
    metadata,
    tools: allTools(),
  });
  assert.equal(byId(plan, 'release-note-contract').state, 'ready');
  assert.deepEqual(byId(plan, 'release-note-contract').args, [
    'scripts/check-release-notes.mjs',
    '--base',
    metadata.base,
    '--head',
    candidate.commit,
    '--pr-body',
    bodyFile,
    '--summary-file',
    path.join(options.fixtureRoot, 'release-note-summary.md'),
  ]);
  const normalized = normalizeSupplementalPrChecks(plan);
  assert.equal(
    normalized.prChecks.find((check) => check.id === 'release-note-contract')
      .status,
    'ready'
  );
  assert(
    !normalized.pendingMetadata.some(
      (check) => check.id === 'release-note-contract'
    )
  );
  for (const id of [
    'github-pr-title',
    'github-pr-template',
    'github-merge-conflict-state',
  ])
    assert(normalized.pendingMetadata.some((check) => check.id === id));
  for (const patch of [
    { head: 'e'.repeat(40) },
    { headTree: 'e'.repeat(40) },
    { headSourceSha256: 'e'.repeat(64) },
    { base: 'invalid' },
    { source: 'unreviewed' },
    { authorType: 'unknown' },
    { bodyFile: path.join(options.scratchRoot, 'outside-fixtures.txt') },
  ]) {
    const stale = await createSupplementalPrStages({
      ...options,
      metadata: { ...metadata, ...patch },
      tools: allTools(),
    });
    assert.equal(
      byId(stale, 'release-note-contract').state,
      'GitHub-native-pending'
    );
  }
  for (const key of ['completeHistory', 'completeTags']) {
    const tools = allTools();
    tools.git[key] = false;
    const blocked = await createSupplementalPrStages({
      ...options,
      metadata,
      tools,
    });
    assert.equal(
      byId(blocked, 'release-note-contract').state,
      'prerequisite-blocked'
    );
  }
  await writeFile(bodyFile, `${body} changed`);
  await assert.rejects(
    createSupplementalPrStages({ ...options, metadata, tools: allTools() }),
    /body bytes changed/
  );
});

test('chart PR target is the repository default branch, not an inferred target or every chart', async (t) => {
  const options = {
    ...(await fixture(t)),
    tools: allTools(),
    scope: 'pr',
    changedFiles: ['charts/example/Chart.yaml'],
    baseBranch: 'main',
  };
  const noRef = await createSupplementalPrStages(options);
  assert.equal(byId(noRef, 'charts-native-lint').state, 'prerequisite-blocked');
  const plan = await createSupplementalPrStages({
    ...options,
    defaultBranch: 'main',
  });
  assert.deepEqual(byId(plan, 'charts-list-changed').args, [
    'list-changed',
    '--target-branch',
    'main',
  ]);
  assert(!byId(plan, 'charts-native-lint').args.includes('--all'));
  assert.equal(
    byId(plan, 'charts-native-lint').nativeCondition,
    'charts-list-changed:nonempty-native-output'
  );
});

test('completion cannot accept duplicates, foreign evidence, local GitHub metadata, advisory required gates or unproved fixture cleanup', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        receipt('council-workflow-boundaries'),
        receipt('council-workflow-boundaries'),
      ]),
    /Duplicate/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        {
          ...receipt('council-workflow-boundaries'),
          sourceSha256: 'f'.repeat(64),
        },
      ]),
    /Unbound/
  );
  assert.throws(
    () => supplementalCompletion(plan, [receipt('github-pr-title')]),
    /cannot be passed locally/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        receipt('council-workflow-boundaries', 'advisory'),
      ]),
    /cannot become advisory/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [receipt('jellyfin-plugin-native-smoke')]),
    /fixture cleanup/
  );
  const links = supplementalCompletion(plan, [
    receipt('docs-links-advisory', 'executed-fail'),
  ]);
  assert.equal(links.status, 'incomplete');
  assert.equal(
    links.checks.find((check) => check.id === 'docs-links-advisory').outcome,
    'advisory'
  );
});

test('reviewed workflow hashes and source-owned package scripts detect recipe drift', async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    createSupplementalPrStages({ ...options, reviewedWorkflowSha256: {} }),
    /workflow identity changed/
  );
  await writeFile(
    path.join(options.root, 'gen-docs', 'package.json'),
    JSON.stringify({ scripts: { build: 'true' } })
  );
  await assert.rejects(createSupplementalPrStages(options), /binding changed/);
});

test('normalization preserves ordered native groups, root stage contract and separate pending metadata', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  const normalized = normalizeSupplementalPrChecks(plan);
  const docs = normalized.prChecks.find(
    (check) => check.id === 'docs-production'
  );
  assert.equal(docs.stage, 'build');
  assert.equal(docs.status, 'ready');
  assert.deepEqual(
    docs.commands.map((command) => command.id),
    ['docs-api-generate', 'docs-production-build']
  );
  const jellyfin = normalized.prChecks.find(
    (check) => check.id === 'jellyfin-plugin'
  );
  assert.deepEqual(
    jellyfin.commands.map((command) => command.id),
    ['jellyfin-plugin-publish', 'jellyfin-plugin-native-smoke']
  );
  assert(
    normalized.pendingMetadata.some(
      (check) => check.id === 'release-note-contract'
    )
  );
  assert(
    normalized.delegatedCoverageReferences.some(
      (check) => check.id === 'council-native-tooling'
    )
  );
  assert(
    normalized.prChecks.every((check) =>
      ['repository', 'codeql', 'build', 'browser'].includes(check.stage)
    )
  );
});

test('supplemental cases require existing hierarchy parser and complete active source-bound native bytes', () => {
  const descriptor = {
    id: 'docs-image-parser-security',
    candidate,
    caseLedger: { file: 'gen-docs/scripts/image-size-security.test.mjs' },
  };
  assert.throws(
    () =>
      acceptSupplementalNativeCases(descriptor, { stdout: 'TAP version 13\n' }),
    /hierarchy parser/
  );
  assert.throws(
    () =>
      acceptSupplementalNativeCases(
        descriptor,
        { stdout: 'no cases' },
        { readNodeTapHierarchy() {} }
      ),
    /header is absent/
  );
  const parser = (bytes, file) => {
    assert.equal(bytes.toString(), 'TAP version 13\n');
    assert.equal(file, descriptor.caseLedger.file);
    return {
      complete: true,
      counts: { passed: 1, failed: 0, skipped: 0 },
      cases: [{ caseId: 'native-id' }],
      issues: [],
    };
  };
  const result = acceptSupplementalNativeCases(
    descriptor,
    { stdout: '> pnpm native command\nTAP version 13\n' },
    { readNodeTapHierarchy: parser }
  );
  assert.deepEqual(result.caseIds, ['native-id']);
  assert.equal(result.sourceSha256, candidate.sourceSha256);
  assert.throws(
    () =>
      acceptSupplementalNativeCases(
        descriptor,
        { stdout: 'TAP version 13\n' },
        {
          readNodeTapHierarchy: () => ({
            complete: false,
            counts: { passed: 0, failed: 0 },
            issues: ['truncated'],
          }),
        }
      ),
    /Incomplete/
  );
});
