// Copyright (c) snapetech and SeerrNG contributors.
// Supplemental native PR descriptors for the existing coordinator/executor.
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const owned = (parent, value) => {
  const relative = path.relative(parent, value);
  return (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
const sha = (value) => /^[a-f0-9]{64}$/.test(value ?? '');
const ready = (receipt) =>
  receipt?.verified === true &&
  sha(receipt.executableSha256) &&
  typeof receipt.version === 'string';
export const supplementalPinnedTools = Object.freeze({
  ct: '3.14.0',
  helmDocs: '1.14.2',
  yamllint: '1.33.0',
  yamale: '6.0.0',
  lychee: '0.24.2',
});
const workflows = [
  'ci.yml',
  'test-docs.yml',
  'lint-helm-charts.yml',
  'docs-link-check.yml',
  'pr-validation.yml',
  'conflict_labeler.yml',
];

export function supplementalApplicability({
  scope = 'full',
  changedFiles = null,
  baseBranch = null,
} = {}) {
  if (!['full', 'pr'].includes(scope))
    throw new Error('Supplemental scope must be full or pr');
  if (
    changedFiles !== null &&
    (!Array.isArray(changedFiles) ||
      !changedFiles.every(
        (file) =>
          typeof file === 'string' &&
          file &&
          !file.startsWith('/') &&
          !file.split('/').includes('..')
      ))
  ) {
    throw new Error(
      'Changed paths require an exact repository-relative inventory'
    );
  }
  const trigger = (matches, requiresMain = false) => {
    const nativeApplicable =
      changedFiles === null || (requiresMain && baseBranch === null)
        ? null
        : (!requiresMain || baseBranch === 'main') &&
          changedFiles.some(matches);
    return {
      selected: scope === 'full' ? true : nativeApplicable,
      nativeApplicable,
      reason:
        scope === 'full'
          ? 'explicit full supplemental scope'
          : nativeApplicable === null
            ? 'exact PR changed paths/base branch missing'
            : nativeApplicable
              ? 'native workflow path trigger matched'
              : 'native workflow path trigger did not match',
    };
  };
  return {
    docs: trigger(
      (file) => file.startsWith('docs/') || file.startsWith('gen-docs/'),
      true
    ),
    charts: trigger(
      (file) =>
        file.startsWith('charts/') ||
        file === '.github/workflows/lint-helm-charts.yml',
      true
    ),
    links: trigger(
      (file) =>
        file.startsWith('docs/') ||
        file.startsWith('gen-docs/') ||
        file === '.github/workflows/docs-link-check.yml'
    ),
  };
}

export async function createSupplementalPrStages(options) {
  const {
    root,
    linksRoot = root,
    scratchRoot,
    fixtureRoot,
    candidate,
    tools = {},
    scope = 'full',
    changedFiles = null,
    baseBranch = null,
    defaultBranch = null,
    metadata = null,
    env = {},
    configuredWorkers = 1,
    reviewedWorkflowSha256 = null,
  } = options;
  if (
    !candidate ||
    !sha(candidate.sourceSha256) ||
    !/^[a-f0-9]{40}$/.test(candidate.commit ?? '') ||
    !/^[a-f0-9]{40}$/.test(candidate.tree ?? '')
  )
    throw new Error('Supplemental checks require a frozen candidate');
  if (
    !Number.isSafeInteger(configuredWorkers) ||
    configuredWorkers < 1 ||
    configuredWorkers > 256
  )
    throw new Error('Invalid supplemental worker budget');
  const [source, scratch, fixtures] = await Promise.all(
    [root, scratchRoot, fixtureRoot].map((value) => realpath(value))
  );
  if (
    !owned(scratch, source) ||
    !owned(scratch, fixtures) ||
    owned(source, fixtures) ||
    source === fixtures
  )
    throw new Error(
      'Supplemental outputs require an owned scratch source copy and separate fixtures'
    );
  const linksSource = await realpath(linksRoot);
  if (
    !owned(scratch, linksSource) ||
    linksSource === fixtures ||
    owned(fixtures, linksSource) ||
    owned(linksSource, fixtures)
  )
    throw new Error(
      'Docs link inputs require an owned scratch source checkout'
    );
  const workflowHashes = {};
  for (const name of workflows) {
    const file = `.github/workflows/${name}`;
    workflowHashes[file] = digest(await readFile(path.join(source, file)));
    if (
      reviewedWorkflowSha256 &&
      reviewedWorkflowSha256[file] !== workflowHashes[file]
    )
      throw new Error(`Reviewed workflow identity changed: ${file}`);
  }
  const docsLockSha256 = digest(
    await readFile(path.join(source, 'gen-docs', 'pnpm-lock.yaml'))
  );
  const docsPackage = JSON.parse(
    await readFile(path.join(source, 'gen-docs', 'package.json'), 'utf8')
  );
  const appPackage = JSON.parse(
    await readFile(path.join(source, 'package.json'), 'utf8')
  );
  if (
    docsPackage.scripts?.['test:security'] !==
      'node --test scripts/image-size-security.test.mjs' ||
    docsPackage.scripts?.['gen-api-docs'] !== 'docusaurus gen-api-docs all' ||
    docsPackage.scripts?.build !== 'docusaurus build' ||
    !appPackage.scripts?.['security:council']?.includes(
      'check-council-browser-boundaries.sh'
    ) ||
    !appPackage.scripts?.['security:council']?.includes(
      'check-council-server-boundaries.sh'
    )
  )
    throw new Error(
      'Native supplemental package binding changed; review the recipe'
    );
  const applicability = supplementalApplicability({
    scope,
    changedFiles,
    baseBranch,
  });
  const checks = [];
  const checkPinnedTools = (descriptor, names) => {
    if (descriptor.state !== 'ready') return;
    for (const name of names) {
      if (
        tools[name]?.version.replace(/^v/, '') !== supplementalPinnedTools[name]
      ) {
        descriptor.state = 'prerequisite-blocked';
        descriptor.missingPrerequisites.push(
          `${name}:${supplementalPinnedTools[name]}`
        );
      }
    }
  };
  const command = (
    id,
    executable,
    args,
    {
      lane = 'repository',
      cwd = source,
      required = true,
      dependsOn = [],
      selection = null,
      prerequisites = [],
      writes = [],
      ...extra
    } = {}
  ) => {
    let state =
      selection?.selected === false
        ? 'not-applicable-with-trigger-proof'
        : selection?.selected === null
          ? 'GitHub-native-pending'
          : 'ready';
    const missing = prerequisites.filter((name) => !ready(tools[name]));
    if (state === 'ready' && missing.length) state = 'prerequisite-blocked';
    const descriptor = {
      id,
      command: executable,
      args,
      cwd,
      env: { ...env },
      lane,
      required,
      advisory: !required,
      dependsOn,
      prerequisites,
      missingPrerequisites: missing,
      state,
      applicability: selection,
      writes,
      slots: configuredWorkers,
      candidate,
      workflowHashes,
      ...extra,
    };
    checks.push(descriptor);
    return descriptor;
  };
  command('council-workflow-boundaries', process.execPath, [
    'scripts/check-workflow-boundaries.mjs',
  ]);
  checks.push({
    id: 'council-native-tooling',
    lane: 'repository',
    required: true,
    state: 'delegated-to-native-owner',
    owner: 'repository-native-tooling',
    reason:
      'Use exact current native tooling execution receipt; do not execute a duplicate suite or infer pass',
    candidate,
  });
  for (const boundary of ['browser', 'server'])
    command(
      `council-${boundary}-boundaries`,
      process.execPath,
      ['bin/run-bash.mjs', `scripts/check-council-${boundary}-boundaries.sh`],
      { prerequisites: ['bash', 'perl', 'find'] }
    );
  const docsDependencies =
    tools.docsDependencies?.verified === true &&
    tools.docsDependencies.lockSha256 === docsLockSha256;
  const docsOptions = {
    cwd: path.join(source, 'gen-docs'),
    selection: applicability.docs,
  };
  const docsSecurity = command(
    'docs-image-parser-security',
    'pnpm',
    ['test:security'],
    {
      ...docsOptions,
      // Keep the exact native package script, but seal its machine-readable
      // reporter instead of relying on Node's version-dependent default.
      env: { ...env, NODE_OPTIONS: '--test-reporter=tap' },
    }
  );
  docsSecurity.caseLedger = {
    format: 'node-tap13-hierarchy-v1',
    file: 'gen-docs/scripts/image-size-security.test.mjs',
  };
  const docsGenerate = command('docs-api-generate', 'pnpm', ['gen-api-docs'], {
    ...docsOptions,
    lane: 'compile',
    dependsOn: [docsSecurity.id],
    writes: ['docs/api/'],
  });
  const docsBuild = command('docs-production-build', 'pnpm', ['build'], {
    ...docsOptions,
    // Installed dependencies are immutable in the engine's owned host. Avoid
    // filesystem-cache work that cannot be committed into that reference.
    env: { ...env, DOCUSAURUS_NO_PERSISTENT_CACHE: '1' },
    lane: 'compile',
    dependsOn: [docsGenerate.id],
    writes: ['gen-docs/.docusaurus/', 'gen-docs/build/'],
  });
  for (const descriptor of [docsSecurity, docsGenerate, docsBuild]) {
    if (descriptor.state === 'ready' && !docsDependencies) {
      descriptor.state = 'prerequisite-blocked';
      descriptor.missingPrerequisites.push(
        'docsDependencies:matching-frozen-lockfile'
      );
    }
  }
  const dotnet = command(
    'jellyfin-plugin-publish',
    tools.dotnet9?.executable ?? 'dotnet',
    [
      'publish',
      'integrations/jellyfin-plugin/SeerrNG.JellyfinBridge.csproj',
      '--configuration',
      'Release',
      // Disposable native commands must not leave persistent compiler servers.
      '--disable-build-servers',
      '--output',
      path.join(fixtures, 'jellyfin-plugin-output'),
    ],
    {
      lane: 'compile',
      prerequisites: ['dotnet9'],
      writes: [
        'integrations/jellyfin-plugin/obj/',
        path.join(fixtures, 'jellyfin-plugin-output'),
      ],
      env: {
        ...env,
        DOTNET_CLI_HOME: path.join(fixtures, 'dotnet-home'),
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        NUGET_PACKAGES: path.join(fixtures, 'nuget-packages'),
      },
    }
  );
  if (dotnet.state === 'ready' && !/^9\.0\./.test(tools.dotnet9.version)) {
    dotnet.state = 'prerequisite-blocked';
    dotnet.missingPrerequisites.push('dotnet9:SDK9.0.x');
  }
  const smoke = command(
    'jellyfin-plugin-native-smoke',
    tools.python3?.executable ?? 'python3',
    [
      'integrations/jellyfin-plugin/smoke-test.py',
      '--plugin-output',
      path.join(fixtures, 'jellyfin-plugin-output'),
    ],
    {
      lane: 'compile',
      prerequisites: ['python3', 'docker'],
      dependsOn: [dotnet.id],
      fixtureImage:
        'jellyfin/jellyfin@sha256:aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db',
      lifecycleOwner: 'native-smoke-script-plus-outer-container-reconciliation',
      env: {
        ...env,
        TMPDIR: path.join(fixtures, 'jellyfin-smoke'),
        TMP: path.join(fixtures, 'jellyfin-smoke'),
        TEMP: path.join(fixtures, 'jellyfin-smoke'),
      },
    }
  );
  if (
    smoke.state === 'ready' &&
    (tools.docker?.daemonVerified !== true ||
      tools.docker?.scratchBindPathsVerified !== true ||
      tools.docker?.loopbackReachabilityVerified !== true)
  ) {
    smoke.state = 'prerequisite-blocked';
    smoke.missingPrerequisites.push(
      'docker:daemon-visible-bind-paths-and-loopback'
    );
  }
  const gitReady =
    ready(tools.git) &&
    tools.git.completeHistory === true &&
    tools.git.completeTags === true;
  const metadataReady =
    metadata?.source === 'github' || metadata?.source === 'proposed-reviewed';
  const sameMetadata =
    metadataReady &&
    metadata.head === candidate.commit &&
    metadata.headTree === candidate.tree &&
    metadata.headSourceSha256 === candidate.sourceSha256 &&
    /^[a-f0-9]{40}$/.test(metadata.base ?? '') &&
    ['User', 'Bot'].includes(metadata.authorType) &&
    sha(metadata.bodySha256) &&
    typeof metadata.bodyFile === 'string' &&
    owned(fixtures, path.resolve(metadata.bodyFile));
  const release = command(
    'release-note-contract',
    process.execPath,
    [
      'scripts/check-release-notes.mjs',
      '--base',
      metadata?.base ?? '',
      '--head',
      metadata?.head ?? '',
      '--pr-body',
      metadata?.bodyFile ?? '',
      '--summary-file',
      path.join(fixtures, 'release-note-summary.md'),
    ],
    {
      prerequisites: ['git'],
      writes: [path.join(fixtures, 'release-note-summary.md')],
    }
  );
  if (!sameMetadata) {
    release.state = 'GitHub-native-pending';
    release.reason =
      'Exact candidate/base/PR body metadata is missing; no opt-out is invented';
  } else {
    if (digest(await readFile(metadata.bodyFile)) !== metadata.bodySha256)
      throw new Error('Reviewed PR body bytes changed');
    if (metadata.authorType === 'Bot') {
      release.state = 'not-applicable-with-trigger-proof';
      release.reason =
        'Native pull_request release-note job excludes Bot authors';
    } else if (!gitReady) {
      release.state = 'prerequisite-blocked';
      release.missingPrerequisites.push('git:complete-history-and-tags');
    }
  }
  const changelog = command(
    'changelog-tag-coverage',
    process.execPath,
    ['scripts/check-changelog-tags.mjs'],
    { prerequisites: ['git'] }
  );
  if (changelog.state === 'ready' && !gitReady) {
    changelog.state = 'prerequisite-blocked';
    changelog.missingPrerequisites.push('git:complete-history-and-tags');
  }
  if (scope === 'pr' && sameMetadata && metadata.authorType === 'Bot') {
    changelog.state = 'not-applicable-with-trigger-proof';
    changelog.reason = 'Entire native release-note job excludes Bot PR authors';
  }
  const helmDocs = command(
    'charts-generated-docs',
    tools.helmDocs?.executable ?? 'helm-docs',
    [],
    {
      lane: 'compile',
      selection: applicability.charts,
      prerequisites: ['helmDocs'],
      writes: ['charts/**/README.md'],
    }
  );
  checkPinnedTools(helmDocs, ['helmDocs']);
  const chartEnv = {
    ...env,
    CT_CONFIG_DIR: tools.ct?.configDir ?? '',
    PATH: [
      ...['yamllint', 'yamale', 'helm']
        .map((name) => tools[name]?.executable)
        .filter((file) => file && path.isAbsolute(file))
        .map((file) => path.dirname(file)),
      env.PATH ?? process.env.PATH ?? '',
    ].join(path.delimiter),
  };
  const chartArgs =
    scope === 'full'
      ? ['lint', '--all', '--validate-maintainers=false']
      : [
          'lint',
          '--target-branch',
          defaultBranch ?? '',
          '--validate-maintainers=false',
        ];
  if (scope === 'pr') {
    const listChanged = command(
      'charts-list-changed',
      tools.ct?.executable ?? 'ct',
      ['list-changed', '--target-branch', defaultBranch ?? ''],
      {
        lane: 'compile',
        selection: applicability.charts,
        prerequisites: ['ct', 'git'],
        dependsOn: [helmDocs.id],
        env: chartEnv,
      }
    );
    checkPinnedTools(listChanged, ['ct']);
  }
  const chartLint = command(
    'charts-native-lint',
    tools.ct?.executable ?? 'ct',
    chartArgs,
    {
      lane: 'compile',
      selection: applicability.charts,
      prerequisites: ['ct', 'helm', 'yamllint', 'yamale', 'git'],
      dependsOn: [scope === 'pr' ? 'charts-list-changed' : helmDocs.id],
      nativeCondition:
        scope === 'pr' ? 'charts-list-changed:nonempty-native-output' : null,
      env: chartEnv,
    }
  );
  checkPinnedTools(chartLint, ['ct', 'yamllint', 'yamale']);
  if (
    chartLint.state === 'ready' &&
    (!path.isAbsolute(tools.ct?.configDir ?? '') ||
      tools.ct?.configSha256?.chartSchema !==
        'a554cca0ea6454b6359f88f505146d79fbad7077bdc0572dcf698c0f3e033c53' ||
      tools.ct?.configSha256?.lintconf !==
        '8dee081250acc0e2619674392c67f2801051b5de37289591a54e4b38aa77802e')
  ) {
    chartLint.state = 'prerequisite-blocked';
    chartLint.missingPrerequisites.push('ct:source-bound-bundled-etc');
  }
  if (chartLint.state === 'ready' && !gitReady) {
    chartLint.state = 'prerequisite-blocked';
    chartLint.missingPrerequisites.push('git:complete-history-and-target-ref');
  }
  if (scope === 'pr' && !defaultBranch)
    for (const descriptor of checks.filter((check) =>
      ['charts-list-changed', 'charts-native-lint'].includes(check.id)
    )) {
      if (descriptor.state === 'ready') {
        descriptor.state = 'prerequisite-blocked';
        descriptor.missingPrerequisites.push('git:repository-default-branch');
      }
    }
  const lycheeReport = path.join(fixtures, 'lychee-out.md');
  const links = command(
    'docs-links-native-scan',
    tools.lychee?.executable ?? 'lychee',
    [
      '--format',
      'markdown',
      '--mode',
      'task',
      '--output',
      lycheeReport,
      '--verbose',
      '--no-progress',
      '--accept',
      '200..204,300..304,307,308,404,429,999',
      '--exclude',
      '^file://',
      '--exclude',
      '^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|\\[::\\])',
      '--exclude',
      '^https?://support\\.discord\\.com',
      './docs/**/*.md',
      './docs/**/*.mdx',
      './gen-docs/**/*.md',
      './gen-docs/**/*.mdx',
    ],
    {
      cwd: linksSource,
      selection: applicability.links,
      prerequisites: ['lychee'],
      networkDependent: true,
      writes: [lycheeReport],
      env: { ...env, GITHUB_TOKEN: '', GH_TOKEN: '', GITLAB_TOKEN: '' },
      lycheeLedger: {
        format: 'lychee-0.24.2-markdown-v1',
        reportFile: lycheeReport,
        failIfEmpty: true,
        linkFailureExitCode: 2,
      },
    }
  );
  checkPinnedTools(links, ['lychee']);
  checks.push({
    id: 'docs-links-advisory',
    lane: links.lane,
    required: false,
    state: links.state === 'ready' ? 'derived-from-native-owner' : links.state,
    owner: links.id,
    candidate,
    applicability: links.applicability,
    reason:
      'Link findings derive from the same native scan; zero links and runtime/configuration errors fail its required operational guard',
  });
  for (const [id, reason] of [
    [
      'github-pr-title',
      'pull_request_target uses trusted base and live title/event metadata',
    ],
    [
      'github-pr-template',
      'pull_request_target trusted-base checkout; native bot/event/association exclusions remain authoritative',
    ],
    [
      'github-merge-conflict-state',
      'Native live mergeability/label check is not locally emulated',
    ],
  ])
    checks.push({
      id,
      state: 'GitHub-native-pending',
      lane: 'github-native',
      required: true,
      reason,
      candidate,
    });
  return {
    schema: 1,
    candidate,
    scope,
    applicability,
    workflowHashes,
    docsLockSha256,
    checks,
    operationExclusions: [
      'main-only-image-publish',
      'image-scan',
      'deployment',
      'release-distribution',
      'renovate-writer-hooks',
      'maintainer-label-automation',
    ],
    resultReuse: false,
  };
}

export function supplementalCompletion(plan, results) {
  const byId = new Map();
  for (const receipt of results) {
    if (byId.has(receipt.id))
      throw new Error(`Duplicate supplemental result: ${receipt.id}`);
    if (!plan.checks.some((check) => check.id === receipt.id))
      throw new Error(`Unknown supplemental result: ${receipt.id}`);
    if (
      receipt.sourceSha256 !== plan.candidate.sourceSha256 ||
      !sha(receipt.evidenceSha256)
    )
      throw new Error(`Unbound supplemental result: ${receipt.id}`);
    byId.set(receipt.id, receipt);
  }
  const checks = plan.checks.map((check) => {
    if (check.state === 'not-applicable-with-trigger-proof')
      return { ...check, outcome: check.state };
    const receipt =
      byId.get(check.id) ??
      (check.state === 'derived-from-native-owner'
        ? byId.get(check.owner)
        : null);
    if (!receipt)
      return {
        ...check,
        outcome:
          check.state === 'ready' ||
          check.state === 'delegated-to-native-owner' ||
          check.state === 'derived-from-native-owner'
            ? 'pending'
            : check.state,
      };
    if (
      ![
        'executed-pass',
        'executed-fail',
        'advisory',
        'not-applicable-with-trigger-proof',
      ].includes(receipt.state)
    )
      throw new Error(`Invalid supplemental outcome: ${check.id}`);
    if (check.required && receipt.state === 'advisory')
      throw new Error(`Required check cannot become advisory: ${check.id}`);
    if (
      check.lycheeLedger &&
      receipt.state === 'executed-pass' &&
      (receipt.nativeLychee?.status !== 'passed' ||
        receipt.nativeLychee?.sourceSha256 !== plan.candidate.sourceSha256 ||
        !sha(receipt.nativeLychee?.reportSha256) ||
        !Number.isSafeInteger(receipt.nativeLychee?.counts?.total) ||
        receipt.nativeLychee.counts.total < 1)
    )
      throw new Error(`Unproved native Lychee operational guard: ${check.id}`);
    if (
      receipt.state === 'not-applicable-with-trigger-proof' &&
      (!check.nativeCondition || !receipt.triggerProofSha256)
    )
      throw new Error(`Unproved supplemental exclusion: ${check.id}`);
    if (
      check.state === 'GitHub-native-pending' &&
      receipt.provider !== 'github'
    )
      throw new Error(
        `GitHub-native metadata cannot be passed locally: ${check.id}`
      );
    if (
      check.lifecycleOwner &&
      receipt.state === 'executed-pass' &&
      !sha(receipt.cleanupProofSha256)
    )
      throw new Error(`Unproved native fixture cleanup: ${check.id}`);
    return {
      ...check,
      outcome: check.required ? receipt.state : 'advisory',
      receipt,
    };
  });
  const required = checks.filter((check) => check.required);
  return {
    status: required.some((check) => check.outcome === 'executed-fail')
      ? 'failed'
      : required.every((check) =>
            ['executed-pass', 'not-applicable-with-trigger-proof'].includes(
              check.outcome
            )
          )
        ? 'passed'
        : 'incomplete',
    checks,
  };
}

// Root's existing coordinator admits these descriptors; this module never runs them.
export function normalizeSupplementalPrChecks(plan) {
  const raw = new Map(plan.checks.map((check) => [check.id, check]));
  const consumed = new Set();
  const prChecks = [];
  const pendingMetadata = [];
  const delegatedCoverageReferences = [];
  const derivedCoverageReferences = [];
  const normalize = (ids, id = ids[0]) => {
    const checks = ids.map((key) => raw.get(key)).filter(Boolean);
    for (const check of checks) consumed.add(check.id);
    if (checks.every((check) => check.state === 'GitHub-native-pending')) {
      pendingMetadata.push(...checks);
      return;
    }
    const unavailable =
      checks.find((check) => check.state === 'prerequisite-blocked') ??
      checks.find((check) => check.state !== 'ready');
    const status = !unavailable
      ? 'ready'
      : unavailable.state === 'not-applicable-with-trigger-proof'
        ? 'not-applicable'
        : unavailable.state === 'GitHub-native-pending'
          ? 'github-native-pending'
          : 'prerequisite-blocked';
    const first = checks[0];
    prChecks.push({
      id,
      stage: first.lane === 'compile' ? 'build' : first.lane,
      required: checks.some((check) => check.required),
      status,
      reason: unavailable
        ? checks
            .filter((check) => check.state !== 'ready')
            .map(
              (check) =>
                `${check.id}: ${check.reason ?? check.applicability?.reason ?? check.state}${check.missingPrerequisites?.length ? ` (${check.missingPrerequisites.join(', ')})` : ''}`
            )
            .join('; ')
        : undefined,
      commands: checks
        .filter((check) => check.command)
        .map((check) => ({ ...check })),
      files: checks.flatMap((check) =>
        check.caseLedger ? [check.caseLedger.file] : []
      ),
      applicability: first.applicability,
      workflowHashes: plan.workflowHashes,
      sourceSha256: plan.candidate.sourceSha256,
    });
  };
  normalize(['docs-api-generate', 'docs-production-build'], 'docs-production');
  normalize(
    ['jellyfin-plugin-publish', 'jellyfin-plugin-native-smoke'],
    'jellyfin-plugin'
  );
  normalize(
    ['charts-generated-docs', 'charts-list-changed', 'charts-native-lint'],
    'charts-native'
  );
  for (const check of plan.checks) {
    if (consumed.has(check.id)) continue;
    if (check.state === 'delegated-to-native-owner') {
      delegatedCoverageReferences.push(check);
      continue;
    }
    if (check.id === 'docs-links-advisory') {
      derivedCoverageReferences.push(check);
      continue;
    }
    if (
      check.lane === 'github-native' ||
      check.state === 'GitHub-native-pending'
    ) {
      pendingMetadata.push(check);
      continue;
    }
    normalize([check.id]);
  }
  return {
    prChecks,
    pendingMetadata,
    delegatedCoverageReferences,
    derivedCoverageReferences,
  };
}

// One scan, two conclusions: required execution/empty guard and advisory link findings.
// Root must use this only with the executor's own complete receipt and fresh report bytes.
export function acceptNativeLycheeResult(descriptor, receipt, reportBytes) {
  if (descriptor.lycheeLedger?.format !== 'lychee-0.24.2-markdown-v1')
    throw new Error('Exact native Lychee ledger binding is required');
  const lifecycle = receipt?.lifecycle;
  if (
    !['passed', 'failed'].includes(receipt?.status) ||
    lifecycle?.completed !== true ||
    lifecycle?.cleanupVerified !== true ||
    (receipt?.aborted ?? lifecycle?.aborted) !== false ||
    (receipt?.timedOut ?? lifecycle?.timedOut) !== false ||
    (Object.hasOwn(receipt, 'signal') ? receipt.signal : lifecycle?.signal) !==
      null ||
    receipt?.spawnError ||
    !Number.isFinite(receipt?.wallMs) ||
    receipt.wallMs < 0 ||
    ![0, 2].includes(receipt.exitCode) ||
    (receipt.exitCode === 0) !== (receipt.status === 'passed')
  )
    throw new Error('Lychee native execution/configuration/lifecycle failed');
  if (typeof reportBytes !== 'string' && !Buffer.isBuffer(reportBytes))
    throw new Error('Fresh native Lychee Markdown bytes are required');
  const bytes = Buffer.isBuffer(reportBytes)
    ? reportBytes
    : Buffer.from(reportBytes);
  const text = bytes.toString('utf8');
  if (!text.startsWith('# Summary\n') && !text.startsWith('# Summary\r\n'))
    throw new Error('Incomplete native Lychee summary');
  const counts = {};
  for (const [key, label] of Object.entries({
    total: '🔍 Total',
    unique: '🔗 Unique',
    successful: '✅ Successful',
    timeouts: '⏳ Timeouts',
    redirected: '🔀 Redirected',
    excluded: '👻 Excluded',
    unknown: '❓ Unknown',
    errors: '🚫 Errors',
    unsupported: '⛔ Unsupported',
  })) {
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`| ${label}`));
    const match =
      rows.length === 1 && rows[0].match(/^\| [^|]+\|\s*(\d+)\s*\|$/);
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new Error(`Missing/duplicate native Lychee ${key} count`);
    counts[key] = Number(match[1]);
  }
  if (counts.total === 0)
    throw new Error('Native Lychee found zero links (action failIfEmpty=true)');
  if (
    counts.unique > counts.total ||
    Object.entries(counts).some(
      ([key, value]) => key !== 'total' && value > counts.total
    )
  )
    throw new Error('Inconsistent native Lychee counts');
  return {
    status: 'passed',
    sourceSha256: descriptor.candidate.sourceSha256,
    reportSha256: digest(bytes),
    counts,
    nativeExitCode: receipt.exitCode,
    linkOutcome:
      receipt.exitCode === 2 ? 'advisory-findings' : 'no-failing-links',
    reportFile: descriptor.lycheeLedger.reportFile,
  };
}

export function acceptSupplementalNativeCases(
  descriptor,
  receipt,
  { readNodeTapHierarchy } = {}
) {
  if (!descriptor.caseLedger) return null;
  if (typeof readNodeTapHierarchy !== 'function')
    throw new Error('The existing engine native hierarchy parser is required');
  const stdout = receipt.stdout ?? receipt.output;
  if (typeof stdout !== 'string' && !Buffer.isBuffer(stdout))
    throw new Error('Complete native TAP stdout bytes are required');
  const raw = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const marker = raw.indexOf(Buffer.from('TAP version 13'));
  if (marker < 0 || (marker > 0 && raw[marker - 1] !== 10))
    throw new Error('Native TAP13 header is absent');
  const parsed = readNodeTapHierarchy(
    raw.subarray(marker),
    descriptor.caseLedger.file
  );
  if (!parsed.complete || parsed.counts.passed + parsed.counts.failed < 1)
    throw new Error(
      `Incomplete native case ledger for ${descriptor.id}: ${parsed.issues.join('; ')}`
    );
  return {
    ...parsed,
    nativeCommandOutputSha256: digest(raw),
    sourceSha256: descriptor.candidate.sourceSha256,
    file: descriptor.caseLedger.file,
    counts: { ...parsed.counts },
    caseIds: parsed.cases.map((testCase) => testCase.caseId),
  };
}
