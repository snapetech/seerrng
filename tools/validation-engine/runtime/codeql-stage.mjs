// Copyright (c) snapetech and SeerrNG contributors.
// Native CodeQL commands for the existing validation coordinator. No process runner.
import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const version = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const packName = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const fail = (message) => {
  throw new Error(`CodeQL stage: ${message}`);
};

// Read the exact vendor manifest identity, not an arbitrary SARIF suffix.
// This deliberately supports only the reviewed native qlpack metadata shape.
export function readCodeqlQueryPackMetadata(contents, expected) {
  const text = contents.toString();
  const scalar = (key) => {
    const values = [
      ...text.matchAll(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'gm')),
    ];
    if (values.length !== 1) fail(`ambiguous query pack ${key}`);
    return values[0][1];
  };
  if (
    scalar('name') !== expected.name ||
    scalar('version') !== expected.version
  )
    fail('installed query pack manifest identity mismatch');
  const blocks = [
    ...text.matchAll(
      /^buildMetadata:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/gm
    ),
  ];
  if (
    blocks.length > 1 ||
    (text.match(/^buildMetadata:/gm)?.length ?? 0) !== blocks.length
  )
    fail('unsupported query pack build metadata');
  let buildMetadataSha = null;
  if (blocks.length) {
    const fields = blocks[0][1].trim().split(/\r?\n/);
    const sha = fields
      .find((line) => /^\s*sha: [a-f0-9]{40}$/.test(line))
      ?.trim()
      .slice(5);
    const cli = fields
      .find((line) => /^\s*cliVersion: \d+\.\d+\.\d+$/.test(line))
      ?.trim()
      .slice(12);
    if (fields.length !== 2 || !sha || cli !== expected.cliVersion)
      fail('unsupported query pack build metadata');
    buildMetadataSha = sha;
  }
  return {
    sarifSemanticVersion: `${expected.version}${buildMetadataSha ? `+${buildMetadataSha}` : ''}`,
    buildMetadataSha,
    qlpackSha256: hash(contents),
  };
}

function absolute(value, label) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value))
    fail(`invalid ${label}`);
  const implementation = /^[A-Za-z]:[\\/]/.test(value)
    ? path.win32
    : path.posix;
  if (
    !implementation.isAbsolute(value) ||
    implementation.normalize(value) !== value ||
    value === implementation.parse(value).root
  )
    fail(`${label} must be a normalized, non-root absolute path`);
  return { value, implementation };
}

function within(parent, child) {
  const relative = parent.implementation.relative(parent.value, child.value);
  return (
    relative === '' ||
    (!relative.startsWith(`..${parent.implementation.sep}`) &&
      relative !== '..' &&
      !parent.implementation.isAbsolute(relative))
  );
}

// Reject unsupported workflow changes instead of silently using a stale recipe.
export function readCodeqlWorkflow(workflowText) {
  if (typeof workflowText !== 'string') fail('workflow contents required');
  const matrix = workflowText.match(/^\s+language:\s*\[([^\]\r\n]+)\]\s*$/m);
  const languages = matrix?.[1]
    .split(',')
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ''));
  if (
    !languages ||
    languages.length !== 2 ||
    new Set(languages).size !== 2 ||
    !languages.includes('actions') ||
    !languages.includes('javascript')
  )
    fail('unsupported language matrix; review the native workflow');
  if (
    !/^\s+queries:\s*['"]?\+security-and-quality['"]?\s*$/m.test(workflowText)
  )
    fail('unsupported query selection; review the native workflow');
  const packs = workflowText.match(/^\s+packs:\s*(.+)$/m)?.[1];
  const model = packs
    ?.match(/'([^']+@\d+\.\d+\.\d+)'/g)
    ?.map((value) => value.slice(1, -1))
    .filter((value) => value.includes('/'));
  if (
    !packs?.includes("matrix.language == 'javascript'") ||
    model?.length !== 1 ||
    !/^snapetech\/seerrng-codeql-models@\d+\.\d+\.\d+$/.test(model[0])
  )
    fail('unsupported model-pack selection; review the native workflow');
  const pins = [
    ...workflowText.matchAll(
      /uses:\s*github\/codeql-action\/(init|autobuild|analyze)@([a-f0-9]{40})/g
    ),
  ];
  if (
    pins.length !== 3 ||
    new Set(pins.map((value) => value[1])).size !== 3 ||
    new Set(pins.map((value) => value[2])).size !== 1
  )
    fail('unverified CodeQL action pin');
  return {
    languages,
    querySelection: '+security-and-quality',
    modelPack: model[0],
    actionCommit: pins[0][2],
    sha256: hash(workflowText),
  };
}

export function createCodeqlSteps({
  sourceRoot,
  scratchRoot,
  capacity,
  memoryMb,
  toolchain,
  workflowText,
  sourceIdentity,
}) {
  const source = absolute(sourceRoot, 'source root');
  const scratch = absolute(scratchRoot, 'scratch root');
  if (
    source.implementation !== scratch.implementation ||
    within(source, scratch) ||
    within(scratch, source)
  )
    fail('source and scratch must be disjoint');
  absolute(toolchain?.cliPath, 'CLI executable');
  if (
    !version.test(toolchain?.cliVersion ?? '') ||
    !sha256.test(toolchain?.sha256 ?? '')
  )
    fail('pinned CLI version and toolchain closure SHA256 required');
  if (!sha256.test(sourceIdentity?.sha256 ?? ''))
    fail('frozen source manifest SHA256 required');
  if (
    !Number.isSafeInteger(capacity?.effectiveLogicalCpus) ||
    capacity.effectiveLogicalCpus < 1 ||
    !Number.isSafeInteger(capacity?.configuredWorkers) ||
    capacity.configuredWorkers < 1
  )
    fail('sealed worker capacity required');
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 2048)
    fail(
      'at least 2048 MiB of evaluator memory required; CodeQL rounds smaller budgets upward'
    );
  const threads = Math.min(
    capacity.effectiveLogicalCpus,
    capacity.configuredWorkers
  );
  const workflow = readCodeqlWorkflow(workflowText);
  const packs = toolchain.packs;
  if (
    !Array.isArray(packs) ||
    packs.some(
      (pack) =>
        !packName.test(pack.name ?? '') ||
        !version.test(pack.version ?? '') ||
        !sha256.test(pack.sha256 ?? '')
    )
  )
    fail('pack closure names, versions and SHA256 values required');
  if (new Set(packs.map((pack) => pack.name)).size !== packs.length)
    fail('duplicate pack identity');
  for (const pack of packs) {
    if (pack.sarifSemanticVersion !== undefined) {
      absolute(pack.root, 'query pack root');
      if (
        !sha256.test(pack.qlpackSha256 ?? '') ||
        (pack.buildMetadataSha !== null &&
          !/^[a-f0-9]{40}$/.test(pack.buildMetadataSha ?? '')) ||
        pack.sarifSemanticVersion !==
          `${pack.version}${pack.buildMetadataSha ? `+${pack.buildMetadataSha}` : ''}`
      )
        fail('unsealed query pack SARIF identity');
    }
  }
  for (const language of workflow.languages) {
    if (!packs.some((pack) => pack.name === `codeql/${language}-queries`))
      fail(`missing ${language} query pack closure`);
  }
  const [modelName, modelVersion] = workflow.modelPack.split('@');
  if (
    !packs.some(
      (pack) => pack.name === modelName && pack.version === modelVersion
    )
  )
    fail('model pack does not match workflow');
  const join = (...parts) =>
    scratch.implementation.join(scratch.value, ...parts);
  const artifacts = [];
  const steps = [];
  const outputs = [];
  for (const language of workflow.languages) {
    const pack = packs.find(
      (item) => item.name === `codeql/${language}-queries`
    );
    const configPath = join(`${language}-config.json`);
    const databasePath = join(`${language}-database`);
    const sarifPath = join(`${language}.sarif`);
    // '+' in Actions retains default queries; explicitly retain both suites.
    const config =
      JSON.stringify(
        {
          name: 'SeerrNG PR parity',
          'disable-default-queries': false,
          queries: [{ uses: 'security-and-quality' }],
        },
        null,
        2
      ) + '\n';
    artifacts.push({
      path: configPath,
      contents: config,
      sha256: hash(config),
    });
    const common = [`--threads=${threads}`, `--ram=${memoryMb}`];
    steps.push({
      id: `codeql-${language}-create`,
      kind: 'check',
      command: toolchain.cliPath,
      args: [
        'database',
        'create',
        databasePath,
        `--language=${language}`,
        `--source-root=${source.value}`,
        `--codescanning-config=${configPath}`,
        ...common,
      ],
      cwd: source.value,
    });
    steps.push({
      id: `codeql-${language}-analyze`,
      kind: 'check',
      command: toolchain.cliPath,
      args: [
        'database',
        'analyze',
        databasePath,
        `${pack.name}@${pack.version}:codeql-suites/${language}-code-scanning.qls`,
        `${pack.name}@${pack.version}:codeql-suites/${language}-security-and-quality.qls`,
        '--format=sarifv2.1.0',
        `--output=${sarifPath}`,
        `--sarif-category=/language:${language}`,
        '--sarif-group-rules-by-pack',
        '--no-download',
        ...(language === 'javascript'
          ? [`--model-packs=${workflow.modelPack}`]
          : []),
        ...common,
      ],
      cwd: source.value,
    });
    outputs.push({ language, path: sarifPath, queryPack: { ...pack } });
  }
  const plan = {
    schema: 1,
    stage: 'codeql',
    scheduling: 'exclusive-sequential',
    sourceRoot: source.value,
    scratchRoot: scratch.value,
    sourceIdentity: { ...sourceIdentity },
    toolchain: { ...toolchain, packs: packs.map((pack) => ({ ...pack })) },
    workflow,
    resources: {
      threads,
      memoryMb,
      configuredWorkers: capacity.configuredWorkers,
      effectiveLogicalCpus: capacity.effectiveLogicalCpus,
      observedThreads: null,
    },
    artifacts,
    steps,
    outputs,
    cache: { resultReuse: false, inputClosureComplete: false },
  };
  return { ...plan, planSha256: hash(JSON.stringify(plan)) };
}

export async function validateCodeqlOutputs(
  plan,
  { commandResults, readFile }
) {
  const { planSha256, ...sealed } = plan;
  if (
    !sha256.test(planSha256 ?? '') ||
    hash(JSON.stringify(sealed)) !== planSha256
  )
    fail('plan changed after sealing');
  if (
    !Array.isArray(commandResults) ||
    commandResults.length !== plan.steps.length
  )
    fail('missing or duplicated native process receipts');
  const receipts = new Map();
  for (const receipt of commandResults) {
    if (receipts.has(receipt.id)) fail('duplicate native process receipt');
    receipts.set(receipt.id, receipt);
  }
  let wallMs = 0;
  for (const step of plan.steps) {
    const result = receipts.get(step.id);
    if (
      !result ||
      result.exitCode !== 0 ||
      result.signal ||
      result.aborted ||
      result.timedOut ||
      result.lifecycle?.completed === false ||
      !Number.isFinite(result.wallMs) ||
      result.wallMs < 0
    )
      fail(`incomplete or failed native command: ${step.id}`);
    wallMs += result.wallMs;
  }
  if (typeof readFile !== 'function') fail('artifact reader required');
  for (const artifact of plan.artifacts) {
    if (hash(await readFile(artifact.path)) !== artifact.sha256)
      fail('CodeQL configuration changed during scan');
  }
  const languages = [];
  for (const output of plan.outputs) {
    if (output.queryPack.sarifSemanticVersion !== undefined) {
      const root = absolute(output.queryPack.root, 'query pack root');
      const manifest = await readFile(
        root.implementation.join(root.value, 'qlpack.yml')
      );
      if (hash(manifest) !== output.queryPack.qlpackSha256)
        fail('installed query pack manifest changed during scan');
      const metadata = readCodeqlQueryPackMetadata(manifest, {
        ...output.queryPack,
        cliVersion: plan.toolchain.cliVersion,
      });
      if (
        metadata.sarifSemanticVersion !== output.queryPack.sarifSemanticVersion
      )
        fail('installed query pack SARIF identity mismatch');
    }
    const bytes = await readFile(output.path);
    let sarif;
    try {
      sarif = JSON.parse(bytes.toString());
    } catch {
      fail(`invalid ${output.language} SARIF`);
    }
    if (
      sarif.version !== '2.1.0' ||
      !Array.isArray(sarif.runs) ||
      sarif.runs.length !== 1
    )
      fail(`missing ${output.language} SARIF run`);
    const run = sarif.runs[0];
    const driver = run.tool?.driver;
    if (
      driver?.name !== 'CodeQL' ||
      (driver.semanticVersion ?? driver.version) !== plan.toolchain.cliVersion
    )
      fail('SARIF tool identity mismatch');
    if (
      run.automationDetails?.id?.replace(/\/$/, '') !==
      `/language:${output.language}`
    )
      fail('SARIF language/category mismatch');
    if (
      !Array.isArray(run.invocations) ||
      !run.invocations.length ||
      run.invocations.some(
        (invocation) =>
          invocation.executionSuccessful !== true ||
          [
            ...(invocation.toolExecutionNotifications ?? []),
            ...(invocation.toolConfigurationNotifications ?? []),
          ].some((notification) => notification.level === 'error')
      )
    )
      fail(`incomplete ${output.language} analysis invocation`);
    const extension = run.tool.extensions?.find(
      (item) => item.name === output.queryPack.name
    );
    if (
      !extension ||
      (extension.semanticVersion ?? extension.version) !==
        (output.queryPack.sarifSemanticVersion ?? output.queryPack.version)
    )
      fail('SARIF query pack identity mismatch');
    if (
      !Array.isArray(extension.rules) ||
      !extension.rules.length ||
      !Array.isArray(run.results)
    )
      fail('missing query or result ledger');
    if (
      run.results.some(
        (result) =>
          result.kind === 'fail' && result.level === 'error' && !result.ruleId
      )
    )
      fail('malformed native result');
    languages.push({
      language: output.language,
      sarifSha256: hash(bytes),
      queryPack: output.queryPack,
      queries: extension.rules.length,
      findings: run.results.length,
      executionSuccessful: true,
    });
  }
  return {
    status: 'passed',
    processStatus: 'passed',
    findingsStatus: languages.some((language) => language.findings)
      ? 'findings-reported'
      : 'no-findings',
    findings: languages.reduce(
      (count, language) => count + language.findings,
      0
    ),
    languages,
    wallMs,
    resources: plan.resources,
    sourceIdentity: plan.sourceIdentity,
    toolchain: plan.toolchain,
    workflow: plan.workflow,
    planSha256,
    cache: plan.cache,
  };
}
