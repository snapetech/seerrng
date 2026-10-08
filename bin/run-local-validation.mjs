#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createNativeStageContext } from '../tools/validation-engine/runtime/native-stage-context.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { executeStagedValidation } from '../tools/validation-engine/runtime/staged-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createHostedGithubPlan,
  githubChangedFilesRange,
} from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  admitHostedGithubUnit,
  executeHostedTestLane,
  loadHostedReceiptDirectory,
  materializeHostedVitestLane,
  readHostedGithubPlan,
  reconcileHostedGithubExecution,
  sealHostedGithubUnitReceipt,
  verifyHostedGithubPlanContext,
} from '../tools/validation-engine/runtime/hosted-github-execution.mjs';
import {
  createPlan,
  executePlan,
  preflight,
  printPlan,
} from './local-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  activateAcceptedLinuxNodeEnrollment,
  configureLinuxController,
  createPendingLinuxNode,
  resolveActiveLinuxConfig,
} from '../tools/validation-engine/runtime/distributed-linux-management.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  requestNodeEnrollment,
  requestSupportedApplications,
  startNodeEnrollmentServer,
} from '../tools/validation-engine/runtime/distributed-node-enrollment-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  addSupportedApplicationToControllerConfigFile,
  compareDependencyAvailability,
  createDependencyProvisioningPlanFromApplicationListing,
  createSupportedApplicationListing,
  deleteSupportedApplicationFromControllerConfigFile,
  setControllerNodeThreadPolicyInFile,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  parseDistributedLinuxNodeApplicationBindings,
  startDistributedLinuxNodeRunner,
} from '../tools/validation-engine/runtime/distributed-linux-node-runner.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, parameters, encoding = 'utf8') =>
  execFileSync('git', ['-C', root, ...parameters], {
    ...(encoding === null ? {} : { encoding }),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
const nulPaths = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);

function hostedGithubInput(root) {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Hosted GitHub mode requires GitHub Actions');
  for (const name of [
    'GITHUB_EVENT_NAME',
    'GITHUB_EVENT_PATH',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_SHA',
  ])
    if (!process.env[name]?.trim())
      throw new Error(`Hosted GitHub mode requires ${name}`);
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim())
    throw new Error('Hosted GitHub planning requires a clean tracked checkout');
  const payload = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
  );
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!['pull_request', 'push'].includes(eventName))
    throw new Error(
      'Hosted CI orchestration supports pull_request and push only'
    );
  const executionSha = git(root, ['rev-parse', 'HEAD']).trim();
  if (executionSha !== process.env.GITHUB_SHA)
    throw new Error('Checked GitHub execution SHA does not match GITHUB_SHA');
  const pullRequest = payload.pull_request;
  const headSha =
    eventName === 'pull_request' ? pullRequest?.head?.sha : payload.after;
  const baseSha =
    eventName === 'pull_request' ? pullRequest?.base?.sha : payload.before;
  if (!/^[a-f0-9]{40}$/.test(headSha ?? ''))
    throw new Error('Exact GitHub head SHA is missing');
  if (!/^[a-f0-9]{40}$/.test(baseSha ?? ''))
    throw new Error('Exact GitHub base SHA is missing');
  let changedFiles;
  let pathFilterMode = 'changed-files';
  if (eventName === 'push' && /^0{40}$/.test(baseSha ?? '')) {
    pathFilterMode = 'run-all-new-branch';
    changedFiles = [];
  } else {
    const count = git(root, [
      'rev-list',
      '--count',
      `${baseSha}..${headSha}`,
    ]).trim();
    if (!/^\d+$/.test(count))
      throw new Error('Exact GitHub change commit count is unavailable');
    if (BigInt(count) > 1000n) {
      pathFilterMode = 'run-all-large-update';
      changedFiles = [];
    }
  }
  if (!changedFiles) {
    changedFiles = nulPaths(
      git(
        root,
        [
          'diff',
          '--name-only',
          '--diff-filter=ACDMRTUXB',
          '-z',
          githubChangedFilesRange(eventName, baseSha, headSha),
          '--',
        ],
        null
      )
    );
  }
  const workflowFiles = {
    ci: '.github/workflows/ci.yml',
    codeql: '.github/workflows/codeql.yml',
    cypress: '.github/workflows/cypress.yml',
    testDocs: '.github/workflows/test-docs.yml',
    docsLinks: '.github/workflows/docs-link-check.yml',
    helm: '.github/workflows/lint-helm-charts.yml',
  };
  const workflowHashes = Object.fromEntries(
    Object.entries(workflowFiles).map(([name, file]) => [
      name,
      hash(readFileSync(resolve(root, file))),
    ])
  );
  return {
    candidate: {
      repository: process.env.GITHUB_REPOSITORY,
      commit: executionSha,
      tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(),
      lockSha256: hash(readFileSync(resolve(root, 'pnpm-lock.yaml'))),
      sourceSha256: hash(
        git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
      ),
    },
    event: {
      name: eventName,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      executionSha,
      headSha,
      baseSha,
      ref: process.env.GITHUB_REF ?? null,
      baseRef:
        eventName === 'pull_request'
          ? (pullRequest?.base?.ref ?? process.env.GITHUB_BASE_REF ?? null)
          : null,
      actorType:
        eventName === 'pull_request' ? (pullRequest?.user?.type ?? null) : null,
      pathFilterMode,
    },
    changedFiles,
    workflowHashes,
    testInventory: createHostedTestInventory(root),
  };
}

function writeHostedPlanOutputs(plan, planFile) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('Hosted GitHub planning requires GITHUB_OUTPUT');
  if (!planFile) throw new Error('Hosted GitHub planning requires --plan-file');
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const byWorkflow = Object.fromEntries(
    plan.units.map((unit) => [unit.workflow, unit.applicable])
  );
  const unit = plan.units.find((entry) => entry.id === 'ci-unit-test');
  const playwright = plan.units.find((entry) => entry.id === 'ci-playwright');
  const cypress = plan.units.find((entry) => entry.id === 'cypress-run');
  if (!unit || !playwright || !cypress)
    throw new Error('Hosted plan is missing required test units');
  const unitMatrix = {
    include: unit.caseAssignments.map((assignment) => ({
      case_id: assignment.caseId,
    })),
  };
  const cypressMatrix = {
    include: cypress.caseAssignments.map((assignment) => {
      const lane = assignment.lanes.find((entry) => entry.id === 'cypress');
      if (
        !lane ||
        !lane.files.length ||
        lane.files.some(
          (file) =>
            file.includes(',') || file.includes('\r') || file.includes('\n')
        )
      )
        throw new Error('Hosted Cypress matrix contains unsafe specs');
      return { case_id: assignment.caseId, specs: lane.files.join(',') };
    }),
  };
  const values = {
    planSha256: plan.planSha256,
    runId: plan.event.runId,
    runAttempt: plan.event.runAttempt,
    executionSha: plan.event.executionSha,
    headSha: plan.event.headSha,
    codeql: byWorkflow.codeql,
    playwright: playwright.applicable,
    cypress: byWorkflow.cypress,
    testDocs: byWorkflow.testDocs,
    docsLinks: byWorkflow.docsLinks,
    helm: byWorkflow.helm,
    unitMatrix: JSON.stringify(unitMatrix),
    cypressMatrix: JSON.stringify(cypressMatrix),
  };
  appendFileSync(
    output,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

function writeHostedAdmissionOutputs(decision) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output)
    throw new Error('Hosted GitHub admission requires GITHUB_OUTPUT');
  appendFileSync(
    output,
    `${[
      ['action', decision.action],
      ['execute', 'true'],
      ['decisionSha256', decision.decisionSha256],
    ]
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

const flagOptions = new Set([
  '--help',
  '-h',
  '--plan',
  '--json',
  '--tests-only',
  '--github-plan',
  '--github-admit',
  '--github-materialize-test-lane',
  '--github-receipt',
  '--github-run-test-lane',
  '--github-reconcile',
  '--distributed-configure-controller',
  '--distributed-configure-node',
  '--distributed-controller-service',
  '--distributed-contained-run',
  '--distributed-run',
  '--distributed-node',
  '--distributed-node-thread-policy',
  '--distributed-applications',
  '--distributed-app-add',
  '--distributed-app-delete',
  '--distributed-dependency-plan',
  '--distributed-dependency-report',
  '--all-applications',
  '--allow-existing-config-update',
  '--overwrite-node',
]);
const valueOptions = new Set([
  '--active-config-marker',
  '--application-id',
  '--application-name',
  '--case',
  '--config-file',
  '--controller-address',
  '--controller-name',
  '--controller-port',
  '--dependency-name',
  '--dependency-profile',
  '--expected-plan-sha256',
  '--job-status',
  '--lane',
  '--listen-address',
  '--listen-port',
  '--log-root',
  '--minimum-thread-count',
  '--node-id',
  '--node-name',
  '--output-file',
  '--plan-file',
  '--profile',
  '--receipt-dir',
  '--request-file',
  '--report-file',
  '--state-root',
  '--thread-rule',
  '--unit',
]);
const repeatedValueOptions = new Set([
  '--application',
  '--app',
  '--evidence',
  '--dependency',
]);

const optionContracts = {
  'local-full': {
    label: 'Local full mode',
    allowed: new Set(),
    requiredValues: [],
  },
  'local-tests-only': {
    label: 'Local tests-only mode',
    allowed: new Set(['--tests-only']),
    requiredValues: [],
  },
  'local-plan': {
    label: 'Local plan mode',
    allowed: new Set(['--plan', '--tests-only', '--json']),
    requiredValues: [],
  },
  'github-plan': {
    label: 'GitHub plan mode',
    allowed: new Set(['--github-plan', '--plan-file', '--json']),
    requiredValues: ['--plan-file'],
  },
  'github-admit': {
    label: 'GitHub admission mode',
    allowed: new Set([
      '--github-admit',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
    ],
  },
  'github-run-test-lane': {
    label: 'GitHub test-lane mode',
    allowed: new Set([
      '--github-run-test-lane',
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
    ],
  },
  'github-materialize-test-lane': {
    label: 'GitHub test-lane materialization mode',
    allowed: new Set([
      '--github-materialize-test-lane',
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--output-file',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--output-file',
    ],
  },
  'github-receipt': {
    label: 'GitHub receipt mode',
    allowed: new Set([
      '--github-receipt',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
      '--evidence',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
    ],
  },
  'github-reconcile': {
    label: 'GitHub reconciliation mode',
    allowed: new Set([
      '--github-reconcile',
      '--plan-file',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: ['--plan-file', '--receipt-dir'],
  },
  'distributed-configure-controller': {
    label: 'Distributed controller configuration mode',
    allowed: new Set([
      '--distributed-configure-controller',
      '--config-file',
      '--profile',
      '--controller-name',
      '--listen-address',
      '--listen-port',
      '--thread-rule',
      '--minimum-thread-count',
      '--active-config-marker',
      '--state-root',
      '--log-root',
      '--allow-existing-config-update',
    ]),
    requiredValues: [
      '--config-file',
      '--profile',
      '--controller-name',
      '--listen-address',
      '--listen-port',
      '--thread-rule',
      '--minimum-thread-count',
      '--active-config-marker',
      '--state-root',
      '--log-root',
    ],
  },
  'distributed-configure-node': {
    label: 'Distributed node configuration mode',
    allowed: new Set([
      '--distributed-configure-node',
      '--config-file',
      '--node-id',
      '--node-name',
      '--listen-address',
      '--listen-port',
      '--controller-address',
      '--controller-port',
      '--active-config-marker',
      '--state-root',
      '--log-root',
      '--allow-existing-config-update',
      '--overwrite-node',
    ]),
    requiredValues: [
      '--config-file',
      '--node-id',
      '--node-name',
      '--listen-address',
      '--listen-port',
      '--controller-address',
      '--controller-port',
      '--active-config-marker',
      '--state-root',
      '--log-root',
    ],
  },
  'distributed-controller-service': {
    label: 'Distributed controller service mode',
    allowed: new Set([
      '--distributed-controller-service',
      '--active-config-marker',
      '--state-root',
      '--log-root',
    ]),
    requiredValues: ['--active-config-marker', '--state-root', '--log-root'],
  },
  'distributed-contained-run': {
    label: 'Internal distributed contained run mode',
    allowed: new Set(['--distributed-contained-run', '--request-file']),
    requiredValues: ['--request-file'],
  },
  'distributed-run': {
    label: 'Distributed production run mode',
    allowed: new Set([
      '--distributed-run',
      '--active-config-marker',
      '--state-root',
      '--log-root',
      '--application',
      '--json',
    ]),
    requiredValues: ['--active-config-marker', '--state-root', '--log-root'],
    requiredRepeated: ['--application'],
  },
  'distributed-applications': {
    label: 'Distributed application listing mode',
    allowed: new Set([
      '--distributed-applications',
      '--active-config-marker',
      '--json',
    ]),
    requiredValues: ['--active-config-marker'],
  },
  'distributed-app-add': {
    label: 'Distributed application add mode',
    allowed: new Set([
      '--distributed-app-add',
      '--active-config-marker',
      '--application-id',
      '--application-name',
      '--dependency-profile',
      '--json',
    ]),
    requiredValues: [
      '--active-config-marker',
      '--application-id',
      '--application-name',
      '--dependency-profile',
    ],
  },
  'distributed-app-delete': {
    label: 'Distributed application delete mode',
    allowed: new Set([
      '--distributed-app-delete',
      '--active-config-marker',
      '--application',
      '--json',
    ]),
    requiredValues: ['--active-config-marker'],
    requiredRepeated: ['--application'],
  },
  'distributed-dependency-plan': {
    label: 'Distributed dependency planning mode',
    allowed: new Set([
      '--distributed-dependency-plan',
      '--active-config-marker',
      '--application',
      '--all-applications',
      '--dependency-name',
      '--json',
    ]),
    requiredValues: ['--active-config-marker'],
  },
  'distributed-dependency-report': {
    label: 'Distributed dependency reporting mode',
    allowed: new Set([
      '--distributed-dependency-report',
      '--active-config-marker',
      '--application',
      '--dependency',
      '--json',
    ]),
    requiredValues: ['--active-config-marker'],
    requiredRepeated: ['--application'],
  },
  'distributed-node': {
    label: 'Distributed node service mode',
    allowed: new Set([
      '--distributed-node',
      '--active-config-marker',
      '--state-root',
      '--log-root',
      '--app',
    ]),
    requiredValues: ['--active-config-marker', '--state-root', '--log-root'],
    requiredRepeated: ['--app'],
  },
  'distributed-node-thread-policy': {
    label: 'Distributed node thread-policy mode',
    allowed: new Set([
      '--distributed-node-thread-policy',
      '--active-config-marker',
      '--node-id',
      '--thread-rule',
      '--minimum-thread-count',
      '--json',
    ]),
    requiredValues: ['--active-config-marker'],
  },
};

function parseOptions(args) {
  const flags = new Set();
  const values = new Map();
  const repeated = new Map();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (flagOptions.has(option)) {
      if (flags.has(option)) throw new Error(`Duplicate option: ${option}`);
      flags.add(option);
      continue;
    }
    if (valueOptions.has(option) || repeatedValueOptions.has(option)) {
      const value = args[++index];
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for ${option}`);
      if (repeatedValueOptions.has(option)) {
        const entries = repeated.get(option) ?? [];
        if (entries.includes(value))
          throw new Error(`Duplicate value for ${option}: ${value}`);
        entries.push(value);
        repeated.set(option, entries);
      } else {
        if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
        values.set(option, value);
      }
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return { flags, values, repeated };
}

function validateOptions(options) {
  const helpAliases = ['--help', '-h'].filter((option) =>
    options.flags.has(option)
  );
  if (helpAliases.length > 1) throw new Error('Duplicate option: --help');

  const names = new Set([
    ...options.flags,
    ...options.values.keys(),
    ...options.repeated.keys(),
  ]);
  if (helpAliases.length) {
    if (names.size !== 1)
      throw new Error('Help mode cannot be combined with other options');
    return { name: 'help', hostedOption: null };
  }

  const hostedModes = [
    '--github-plan',
    '--github-admit',
    '--github-materialize-test-lane',
    '--github-run-test-lane',
    '--github-receipt',
    '--github-reconcile',
  ].filter((option) => options.flags.has(option));
  if (hostedModes.length > 1)
    throw new Error('Choose exactly one hosted GitHub mode');

  const distributedModes = [
    '--distributed-configure-controller',
    '--distributed-configure-node',
    '--distributed-controller-service',
    '--distributed-contained-run',
    '--distributed-run',
    '--distributed-node',
    '--distributed-node-thread-policy',
    '--distributed-applications',
    '--distributed-app-add',
    '--distributed-app-delete',
    '--distributed-dependency-plan',
    '--distributed-dependency-report',
  ].filter((option) => options.flags.has(option));
  if (distributedModes.length > 1)
    throw new Error('Choose exactly one distributed mode');
  if (hostedModes.length && distributedModes.length)
    throw new Error('Hosted GitHub and distributed modes cannot be combined');

  const hostedOption = hostedModes[0] ?? null;
  const distributedOption = distributedModes[0] ?? null;
  const name = hostedOption
    ? hostedOption.slice(2)
    : distributedOption
      ? distributedOption.slice(2)
      : options.flags.has('--plan')
        ? 'local-plan'
        : options.flags.has('--tests-only')
          ? 'local-tests-only'
          : 'local-full';
  const contract = optionContracts[name];
  for (const option of names)
    if (!contract.allowed.has(option))
      throw new Error(`${contract.label} does not accept ${option}`);
  for (const option of contract.requiredValues)
    if (!options.values.has(option))
      throw new Error(`${contract.label} requires ${option}`);
  for (const option of contract.requiredRepeated ?? [])
    if (!options.repeated.has(option))
      throw new Error(`${contract.label} requires ${option}`);
  if (
    ['distributed-app-delete', 'distributed-run'].includes(name) &&
    (options.repeated.get('--application') ?? []).length !== 1
  )
    throw new Error(
      `${optionContracts[name].label} requires exactly one --application`
    );
  if (name === 'distributed-dependency-plan') {
    const applications = options.repeated.get('--application') ?? [];
    const all = options.flags.has('--all-applications');
    if (all === applications.length > 0)
      throw new Error(
        'Distributed dependency planning mode requires exactly one of --application or --all-applications'
      );
  }
  if (name === 'distributed-node-thread-policy') {
    const policyOptions = [
      '--node-id',
      '--thread-rule',
      '--minimum-thread-count',
    ].filter((option) => options.values.has(option));
    if (policyOptions.length !== 0 && policyOptions.length !== 3)
      throw new Error(
        'Distributed node thread-policy mode requires node ID, thread rule, and minimum thread count together'
      );
  }
  return { name, hostedOption, distributedOption };
}

function canonicalOrdinaryPath(pathValue, label, kind) {
  if (!isAbsolute(pathValue) || resolve(pathValue) !== pathValue)
    throw new Error(`${label} must be an absolute canonical ${kind}`);
  const metadata = lstatSync(pathValue);
  if (
    metadata.isSymbolicLink() ||
    !metadata[`is${kind === 'file' ? 'File' : 'Directory'}`]()
  )
    throw new Error(`${label} must be an ordinary ${kind}`);
  return pathValue;
}

function runtimeApplicationKey(sourceRoot) {
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(resolve(sourceRoot, 'package.json'), 'utf8')
    );
  } catch (error) {
    throw new Error('The repository package manifest is not valid JSON', {
      cause: error,
    });
  }
  const name = manifest?.name;
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(name)
  )
    throw new Error(
      'The repository package name is not a valid distributed runtime application key'
    );
  return name;
}

/**
 * Public integration seam for the engine-owned host lifecycle. The integration
 * module builds the deployment-specific manifest and adapters, then owns both
 * the outer containment and inner production runner.
 */
export async function executeDistributedLinuxPublicLifecycle(request) {
  const integration =
    await import('../tools/validation-engine/runtime/distributed-linux-public-lifecycle.mjs');
  if (typeof integration.executeDistributedLinuxPublicLifecycle !== 'function')
    throw new Error(
      'Distributed public lifecycle integration does not export executeDistributedLinuxPublicLifecycle'
    );
  return integration.executeDistributedLinuxPublicLifecycle(request);
}

/** Internal helper-child seam on this same engine entrypoint. */
export async function executeDistributedLinuxContainedLifecycle(
  requestFilePath,
  options
) {
  const integration =
    await import('../tools/validation-engine/runtime/distributed-linux-public-lifecycle.mjs');
  if (
    typeof integration.executeDistributedLinuxContainedLifecycle !== 'function'
  )
    throw new Error(
      'Distributed contained lifecycle integration does not export executeDistributedLinuxContainedLifecycle'
    );
  return integration.executeDistributedLinuxContainedLifecycle(
    requestFilePath,
    options
  );
}

/**
 * Validate and bind the small public command contract before invoking the
 * deployment-specific engine integration. Dependency injection is limited to
 * focused tests; the public CLI always uses the engine-owned lifecycle above.
 */
export async function dispatchDistributedLinuxPublicRun(
  {
    activeConfigMarkerPath,
    applicationEntryId,
    logRoot,
    sourceRoot,
    stateRoot,
    signal,
  },
  {
    executeLifecycle = executeDistributedLinuxPublicLifecycle,
    uniqueId = randomUUID,
  } = {}
) {
  if (
    typeof applicationEntryId !== 'string' ||
    !applicationEntryId.trim() ||
    applicationEntryId !== applicationEntryId.trim()
  )
    throw new Error('Exactly one non-empty application entry ID is required');
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed production signal must be an AbortSignal');
  if (typeof executeLifecycle !== 'function')
    throw new Error('Distributed public lifecycle integration is required');
  if (typeof uniqueId !== 'function')
    throw new Error('Distributed run ID generator is required');
  const canonicalSourceRoot = canonicalOrdinaryPath(
    sourceRoot,
    'Repository source root',
    'directory'
  );
  const runId = `mode3-${uniqueId()}`;
  if (
    !/^mode3-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      runId
    )
  )
    throw new Error('The distributed run ID generator returned an invalid ID');
  const request = Object.freeze({
    activeConfigMarkerPath: canonicalOrdinaryPath(
      activeConfigMarkerPath,
      'Active config marker',
      'file'
    ),
    applicationEntryId,
    logRoot: canonicalOrdinaryPath(logRoot, 'Log root', 'directory'),
    runId,
    runtimeApplicationKey: runtimeApplicationKey(canonicalSourceRoot),
    signal,
    sourceRoot: canonicalSourceRoot,
    stateRoot: canonicalOrdinaryPath(stateRoot, 'State root', 'directory'),
  });

  const result = await executeLifecycle(request);
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    result.status !== 'passed' ||
    result.runId !== request.runId
  )
    throw new Error(
      'Distributed public lifecycle did not return the exact passing run result'
    );
  return Object.freeze({ request, result });
}

const executedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(resolve(process.argv[1])) ===
    realpathSync(fileURLToPath(import.meta.url));

let options;
let selectedMode;
if (executedDirectly) {
  try {
    options = parseOptions(process.argv.slice(2));
    selectedMode = validateOptions(options);
  } catch (error) {
    options = undefined;
    selectedMode = undefined;
    process.stderr.write(`${error.message}. Use --help.\n`);
    process.exitCode = 1;
  }
}
const has = (option) => options?.flags.has(option) ?? false;
const value = (option) => options?.values.get(option);
const repeated = (option) => options?.repeated.get(option) ?? [];
const pathValueOptions = new Set([
  '--active-config-marker',
  '--config-file',
  '--dependency-profile',
  '--log-root',
  '--output-file',
  '--plan-file',
  '--receipt-dir',
  '--report-file',
  '--request-file',
  '--state-root',
]);

function restoreWindowsPackageScriptPath(pathValue) {
  const pnpmUserAgent = process.env.npm_config_user_agent ?? '';
  const pnpmExecutable = process.env.npm_execpath ?? '';
  const pnpmValidationLifecycle =
    process.platform === 'win32' &&
    process.env.npm_lifecycle_event === 'validate:development' &&
    (pnpmUserAgent.startsWith('pnpm/') ||
      /(?:^|[\\/])pnpm(?:\.[cm]?js)?$/iu.test(pnpmExecutable));
  if (!pnpmValidationLifecycle || !isAbsolute(pathValue)) return pathValue;
  const canonical = resolve(pathValue);
  return pathValue === canonical.replaceAll('\\', '\\\\')
    ? canonical
    : pathValue;
}

const requiredValue = (option) => {
  const result = value(option);
  if (!result) throw new Error(`Selected mode requires ${option}`);
  return pathValueOptions.has(option)
    ? restoreWindowsPackageScriptPath(result)
    : result;
};
const requiredSingleRepeatedValue = (option) => {
  const entries = repeated(option);
  if (entries.length !== 1)
    throw new Error(`Selected mode requires exactly one ${option}`);
  return entries[0];
};

const NODE_ENROLLMENT_CONFLICT_EXIT_CODE = 20;

function requireLinuxDistributedMode(label) {
  if (process.platform !== 'linux') throw new Error(`${label} requires Linux`);
}

function canonicalIntegerOption(option, minimum, maximum) {
  const raw = requiredValue(option);
  if (!/^(?:0|[1-9]\d*)$/.test(raw))
    throw new Error(`${option} must use canonical decimal digits`);
  const result = Number(raw);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new Error(`${option} must be from ${minimum} through ${maximum}`);
  return result;
}

function reservedLinuxDirectory(option) {
  const directory = requiredValue(option);
  if (!isAbsolute(directory) || resolve(directory) !== directory)
    throw new Error(`${option} must be an absolute canonical directory`);
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error(`${option} must be an ordinary directory`);
  return directory;
}

function validateReservedLinuxDirectories() {
  reservedLinuxDirectory('--state-root');
  reservedLinuxDirectory('--log-root');
}

function nodeEnrollmentConflict(response) {
  const detail =
    response.reason === 'node-number-occupied'
      ? `Node ${response.nodeNumber} is already assigned; rerun locally with --overwrite-node to replace it`
      : 'Node enrollment conflict: this IP address is assigned to another node';
  return Object.assign(new Error(detail), {
    code: 'ERR_NODE_ENROLLMENT_CONFLICT',
    exitCode: NODE_ENROLLMENT_CONFLICT_EXIT_CODE,
  });
}

function parseDependencyAvailability(values) {
  return values.map((binding) => {
    const equals = binding.indexOf('=');
    if (equals < 1 || equals === binding.length - 1)
      throw new Error('--dependency must use NAME=ACTUAL_VERSION');
    return {
      name: binding.slice(0, equals),
      version: binding.slice(equals + 1),
    };
  });
}

async function supportedApplicationsForActiveConfig(active, signal) {
  if (active.role === 'controller')
    return createSupportedApplicationListing(active.config);
  return requestSupportedApplications({
    controllerIpAddress: active.config.controller.ipAddress,
    controllerPort: active.config.controller.port,
    signal,
  });
}

if (!executedDirectly) {
  // Importing exposes focused command helpers without executing the CLI.
} else if (!options) {
  // The parse error above is the complete fail-closed result.
} else if (selectedMode.name === 'help') {
  process.stdout
    .write(`Usage: node bin/run-local-validation.mjs [--tests-only] [--plan [--json]]
       node bin/run-local-validation.mjs --github-plan --plan-file FILE [--json]
       node bin/run-local-validation.mjs --github-admit --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR [--json]
       node bin/run-local-validation.mjs --github-materialize-test-lane --unit ID --case ID --lane vitest --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --output-file FILE [--json]
       node bin/run-local-validation.mjs --github-run-test-lane --unit ID [--case ID] --lane ID --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --report-file FILE [--json]
       node bin/run-local-validation.mjs --github-receipt --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --job-status STATUS [--evidence FILE ...] [--json]
       node bin/run-local-validation.mjs --github-reconcile --plan-file FILE --receipt-dir DIR [--json]
       node bin/run-local-validation.mjs --distributed-configure-controller --config-file ABSOLUTE_FILE --profile GITHUB_USER --controller-name NAME --listen-address IP --listen-port PORT --thread-rule RULE --minimum-thread-count COUNT --active-config-marker ABSOLUTE_FILE --state-root ABSOLUTE_DIR --log-root ABSOLUTE_DIR [--allow-existing-config-update]
       node bin/run-local-validation.mjs --distributed-configure-node --config-file ABSOLUTE_FILE --node-id ## --node-name NAME --listen-address IP --listen-port PORT --controller-address IP --controller-port PORT --active-config-marker ABSOLUTE_FILE --state-root ABSOLUTE_DIR --log-root ABSOLUTE_DIR [--allow-existing-config-update] [--overwrite-node]
       node bin/run-local-validation.mjs --distributed-controller-service --active-config-marker ABSOLUTE_FILE --state-root ABSOLUTE_DIR --log-root ABSOLUTE_DIR
       node bin/run-local-validation.mjs --distributed-run --active-config-marker ABSOLUTE_FILE --state-root ABSOLUTE_DIR --log-root ABSOLUTE_DIR --application ENTRY_ID [--json]
       node bin/run-local-validation.mjs --distributed-node --active-config-marker ABSOLUTE_FILE --state-root ABSOLUTE_DIR --log-root ABSOLUTE_DIR --app ID=ABSOLUTE_ROOT
       node bin/run-local-validation.mjs --distributed-node-thread-policy --active-config-marker ABSOLUTE_FILE [--node-id ## --thread-rule RULE --minimum-thread-count COUNT] [--json]
       node bin/run-local-validation.mjs --distributed-applications --active-config-marker ABSOLUTE_FILE --json
       node bin/run-local-validation.mjs --distributed-app-add --active-config-marker ABSOLUTE_FILE --application-id 'PRODUCT VERSION' --application-name NAME --dependency-profile ABSOLUTE_FILE [--json]
       node bin/run-local-validation.mjs --distributed-app-delete --active-config-marker ABSOLUTE_FILE --application ENTRY_ID [--json]
       node bin/run-local-validation.mjs --distributed-dependency-plan --active-config-marker ABSOLUTE_FILE (--application ENTRY_ID ... | --all-applications) [--dependency-name NAME] --json
       node bin/run-local-validation.mjs --distributed-dependency-report --active-config-marker ABSOLUTE_FILE --application ENTRY_ID ... [--dependency NAME=ACTUAL_VERSION ...] --json

Runs the existing engine's staged native PR-parity gate: repository checks,
CodeQL, production builds, browser tests and applicable supplemental checks.
--tests-only  Run all discovered test suites once, preserving their native runner.
--plan        Print files, framework ownership, platform exclusions, and commands;
              do not create files or launch children.
--github-plan Create the current-run GitHub plan and native-job selections.
--github-admit
              Bind one native job/case to the immutable current-attempt plan.
--github-materialize-test-lane
              Bind one planned Vitest shard into a runner-temp native config.
--github-run-test-lane
              Run an engine-assigned native test lane with its sealed worker budget.
--github-receipt
              Seal one native job/case result and its current-attempt ledger entry.
--github-reconcile
              Verify native needs and complete sealed receipts against the plan.
--distributed-configure-controller
              Create or explicitly update the Linux controller configuration.
--distributed-configure-node
              Register one Linux node with the selected private-LAN controller.
              A controller conflict exits with status 20 without activating the node.
--distributed-controller-service
              Serve private-LAN node enrollment from the exact active configuration.
--distributed-run
              Run one fresh engine-owned contained four-stage Mode 3 lifecycle.
              The application entry is singular; thread and worker overrides are forbidden.
--distributed-node
              Serve explicitly bound applications from the exact active node configuration.
--distributed-node-thread-policy
              List enrolled nodes or assign one node's controller-owned thread policy.
--distributed-applications
              List controller-supported application entries; nodes fetch the list in memory.
--distributed-app-add
              Add one controller app entry from its repository-owned dependency profile.
--distributed-app-delete
              Delete one numbered controller app entry.
--distributed-dependency-plan
              Union and deduplicate selected app requirements without installing anything.
--distributed-dependency-report
              Persist actual node availability and compare it with selected requirements.
--app         Register an explicit distributed application as ID=ABSOLUTE_ROOT;
              repeatable for the node service.
--json        Machine-readable local plan, distributed result, hosted plan, or hosted result.
--help        Show help without reading the project or creating files.

Does not install dependencies, synchronize source, apply live migrations, or edit GitHub workflows.
Native, Vitest-only, tooling and CI commands retain their existing behavior.
Builds and fixture migrations use an owned disposable source/configuration copy.
Missing native tools, unproven isolation and pending GitHub checks are incomplete;
failures, partial output closure and zero active tests fail closed.\n`);
} else {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let context;
  let failure;
  try {
    const hostedMode = selectedMode.hostedOption;
    const distributedMode = selectedMode.distributedOption;
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    if (distributedMode === '--distributed-run') {
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const execution = await dispatchDistributedLinuxPublicRun({
        activeConfigMarkerPath: requiredValue('--active-config-marker'),
        applicationEntryId: requiredSingleRepeatedValue('--application'),
        logRoot: requiredValue('--log-root'),
        sourceRoot: root,
        stateRoot: requiredValue('--state-root'),
        signal: controller.signal,
      });
      process.stdout.write(
        has('--json')
          ? `${JSON.stringify(execution.result, null, 2)}\n`
          : `Mode 3 distributed validation passed for ${execution.request.runtimeApplicationKey}/${execution.request.applicationEntryId} (${execution.request.runId}).\n`
      );
    } else if (distributedMode === '--distributed-contained-run') {
      requireLinuxDistributedMode('Internal distributed contained run');
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const execution = await executeDistributedLinuxContainedLifecycle(
        requiredValue('--request-file'),
        { signal: controller.signal }
      );
      process.stdout.write(
        `${JSON.stringify({ runId: execution.runId, status: execution.status })}\n`
      );
    } else if (distributedMode === '--distributed-configure-controller') {
      requireLinuxDistributedMode('Distributed controller configuration');
      validateReservedLinuxDirectories();
      const configured = configureLinuxController({
        configPath: requiredValue('--config-file'),
        activeConfigMarkerPath: requiredValue('--active-config-marker'),
        operator: {
          githubUsername: requiredValue('--profile'),
          computerName: requiredValue('--controller-name'),
          ipAddress: requiredValue('--listen-address'),
          port: canonicalIntegerOption('--listen-port', 1, 65_535),
          threads: requiredValue('--thread-rule'),
          minimumThreadCount: canonicalIntegerOption(
            '--minimum-thread-count',
            1,
            256
          ),
        },
        allowExistingUpdate: has('--allow-existing-config-update'),
      });
      process.stdout.write(
        `Mode 3 controller ${configured.global.computerName} is configured and active.\n`
      );
    } else if (distributedMode === '--distributed-configure-node') {
      requireLinuxDistributedMode('Distributed node configuration');
      validateReservedLinuxDirectories();
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const configPath = requiredValue('--config-file');
      const pending = createPendingLinuxNode({
        configPath,
        controller: {
          ipAddress: requiredValue('--controller-address'),
          port: canonicalIntegerOption('--controller-port', 1, 65_535),
        },
        node: {
          nodeNumber: requiredValue('--node-id'),
          computerName: requiredValue('--node-name'),
          ipAddress: requiredValue('--listen-address'),
          port: canonicalIntegerOption('--listen-port', 1, 65_535),
        },
        allowExistingUpdate: has('--allow-existing-config-update'),
      });
      const enrollmentResponse = await requestNodeEnrollment({
        controllerIpAddress: pending.controller.ipAddress,
        controllerPort: pending.controller.port,
        enrollmentRequest: {
          ...pending.node,
          overwrite: has('--overwrite-node'),
        },
        signal: controller.signal,
      });
      if (enrollmentResponse.status === 'conflict')
        throw nodeEnrollmentConflict(enrollmentResponse);
      const enrolled = activateAcceptedLinuxNodeEnrollment({
        configPath,
        activeConfigMarkerPath: requiredValue('--active-config-marker'),
        pendingConfig: pending,
        allowExistingUpdate: has('--allow-existing-config-update'),
        response: enrollmentResponse,
      });
      process.stdout.write(
        `Mode 3 node ${enrolled.node.nodeNumber} is enrolled and active.\n`
      );
    } else if (distributedMode === '--distributed-controller-service') {
      requireLinuxDistributedMode('Distributed controller service');
      validateReservedLinuxDirectories();
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker'),
        { expectedRole: 'controller' }
      );
      let service;
      try {
        service = await startNodeEnrollmentServer({
          controllerConfigPath: active.configPath,
          host: active.config.global.ipAddress,
          port: active.config.global.port,
        });
        process.stdout.write(
          `Mode 3 controller enrollment service is listening on ${service.host}:${service.port}.\n`
        );
        if (!controller.signal.aborted)
          await new Promise((resolveStop) =>
            controller.signal.addEventListener('abort', resolveStop, {
              once: true,
            })
          );
      } finally {
        await service?.close();
      }
    } else if (distributedMode === '--distributed-node-thread-policy') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker'),
        { expectedRole: 'controller' }
      );
      if (value('--node-id') === undefined) {
        const nodes = active.config.nodes.map((node) => ({ ...node }));
        if (has('--json'))
          process.stdout.write(`${JSON.stringify({ nodes })}\n`);
        else if (nodes.length === 0)
          process.stdout.write('No enrolled nodes are available.\n');
        else
          for (const node of nodes)
            process.stdout.write(
              `${node.nodeNumber} ${node.computerName}: ${node.threads ?? 'unassigned'} (minimum ${node.minimumThreadCount ?? 'unassigned'})\n`
            );
      } else {
        const node = setControllerNodeThreadPolicyInFile(active.configPath, {
          nodeNumber: requiredValue('--node-id'),
          threads: requiredValue('--thread-rule'),
          minimumThreadCount: canonicalIntegerOption(
            '--minimum-thread-count',
            1,
            256
          ),
        });
        if (has('--json'))
          process.stdout.write(`${JSON.stringify({ node })}\n`);
        else
          process.stdout.write(
            `Mode 3 node ${node.nodeNumber} thread policy is ${node.threads} with minimum ${node.minimumThreadCount}.\n`
          );
      }
    } else if (distributedMode === '--distributed-applications') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker')
      );
      const listing = await supportedApplicationsForActiveConfig(
        active,
        controller.signal
      );
      if (has('--json')) process.stdout.write(`${JSON.stringify(listing)}\n`);
      else {
        for (const application of listing.applications)
          process.stdout.write(
            `${application.entryId} ${application.name} (${application.applicationId})\n`
          );
      }
    } else if (distributedMode === '--distributed-app-add') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker'),
        { expectedRole: 'controller' }
      );
      const application = addSupportedApplicationToControllerConfigFile(
        active.configPath,
        {
          applicationId: requiredValue('--application-id'),
          name: requiredValue('--application-name'),
          profilePath: requiredValue('--dependency-profile'),
        }
      );
      if (has('--json'))
        process.stdout.write(`${JSON.stringify({ application })}\n`);
      else
        process.stdout.write(
          `Supported application ${application.entryId}: ${application.name} (${application.applicationId}).\n`
        );
    } else if (distributedMode === '--distributed-app-delete') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker'),
        { expectedRole: 'controller' }
      );
      const application = deleteSupportedApplicationFromControllerConfigFile(
        active.configPath,
        requiredSingleRepeatedValue('--application')
      );
      if (has('--json'))
        process.stdout.write(`${JSON.stringify({ application })}\n`);
      else
        process.stdout.write(
          `Removed supported application ${application.entryId}: ${application.name}.\n`
        );
    } else if (distributedMode === '--distributed-dependency-plan') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker')
      );
      const listing = await supportedApplicationsForActiveConfig(
        active,
        controller.signal
      );
      const selectedEntries = has('--all-applications')
        ? listing.applications.map((application) => application.entryId)
        : repeated('--application');
      const plan = createDependencyProvisioningPlanFromApplicationListing(
        listing,
        selectedEntries,
        { dependencyNameFilter: value('--dependency-name') ?? null }
      );
      if (has('--json')) process.stdout.write(`${JSON.stringify(plan)}\n`);
      else
        process.stdout.write(
          `Dependency plan contains ${plan.dependencies.length} requirement(s) for ${plan.selectedApplications.length} selected application(s).\n`
        );
    } else if (distributedMode === '--distributed-dependency-report') {
      const active = resolveActiveLinuxConfig(
        requiredValue('--active-config-marker'),
        { expectedRole: 'node' }
      );
      const listing = await supportedApplicationsForActiveConfig(
        active,
        controller.signal
      );
      const selectedEntries = repeated('--application');
      const plan = createDependencyProvisioningPlanFromApplicationListing(
        listing,
        selectedEntries
      );
      const availability = parseDependencyAvailability(
        repeated('--dependency')
      );
      const response = await requestNodeEnrollment({
        controllerIpAddress: active.config.controller.ipAddress,
        controllerPort: active.config.controller.port,
        enrollmentRequest: {
          ...active.config.node,
          overwrite: false,
          selectedApplicationEntries: selectedEntries,
          dependencyAvailability: availability,
        },
        signal: controller.signal,
      });
      if (response.status === 'conflict')
        throw nodeEnrollmentConflict(response);
      activateAcceptedLinuxNodeEnrollment({
        configPath: active.configPath,
        activeConfigMarkerPath: requiredValue('--active-config-marker'),
        pendingConfig: active.config,
        allowExistingUpdate: true,
        response,
      });
      const report = compareDependencyAvailability(plan, availability);
      if (has('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
      else
        process.stdout.write(
          `Dependency availability is ${report.status} for ${report.selectedApplications.length} selected application(s).\n`
        );
      if (report.status !== 'ready') process.exitCode = 1;
    } else if (distributedMode === '--distributed-node') {
      requireLinuxDistributedMode('Distributed node service');
      validateReservedLinuxDirectories();
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const applications = parseDistributedLinuxNodeApplicationBindings(
        repeated('--app')
      );
      let service;
      try {
        service = await startDistributedLinuxNodeRunner({
          activeConfigMarkerPath: requiredValue('--active-config-marker'),
          applications,
          signal: controller.signal,
        });
        process.stdout.write(
          `Mode 3 ${service.nodeId} is listening on ${service.host}:${service.port} for ${service.applications.length} explicitly bound application(s).\n`
        );
        if (!controller.signal.aborted)
          await new Promise((resolveStop) =>
            controller.signal.addEventListener('abort', resolveStop, {
              once: true,
            })
          );
      } finally {
        await service?.close();
      }
    } else if (hostedMode) {
      if (hostedMode === '--github-plan') {
        const plan = createHostedGithubPlan(hostedGithubInput(root));
        writeHostedPlanOutputs(plan, requiredValue('--plan-file'));
        const applicableUnits = plan.units.filter((unit) => unit.applicable);
        const applicableCases = applicableUnits.reduce(
          (total, unit) => total + unit.cases.length,
          0
        );
        process.stdout.write(
          has('--json')
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Hosted GitHub plan ${plan.planSha256}: ${applicableUnits.length}/${plan.units.length} logical units selected across ${applicableCases} runner cases.\n`
        );
      } else {
        const planFile = requiredValue('--plan-file');
        const plan = readHostedGithubPlan(planFile);
        if (hostedMode === '--github-admit') {
          const result = admitHostedGithubUnit({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
          });
          writeHostedAdmissionOutputs(result.decision);
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(
                  {
                    admission: result.admission,
                    decision: result.decision,
                  },
                  null,
                  2
                )}\n`
              : `Admitted ${result.admission.unitId}/${result.admission.caseId} for hosted plan ${plan.planSha256}: ${result.decision.action}.\n`
          );
        } else if (hostedMode === '--github-materialize-test-lane') {
          if (requiredValue('--lane') !== 'vitest')
            throw new Error('Hosted materialization supports Vitest only');
          const result = materializeHostedVitestLane({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: requiredValue('--case'),
            receiptDir: requiredValue('--receipt-dir'),
            outputFile: requiredValue('--output-file'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Materialized ${result.unitId}/${result.caseId} ${result.laneId} shard with ${result.files.length} files and ${result.configuredWorkers} workers.\n`
          );
        } else if (hostedMode === '--github-run-test-lane') {
          const result = await executeHostedTestLane({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            laneId: requiredValue('--lane'),
            receiptDir: requiredValue('--receipt-dir'),
            reportFile: requiredValue('--report-file'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted ${result.laneId} passed: ${result.counts.active}/${result.counts.total} active tests.\n`
          );
        } else if (hostedMode === '--github-receipt') {
          const result = sealHostedGithubUnitReceipt({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
            jobStatus: requiredValue('--job-status'),
            evidenceFiles: repeated('--evidence'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result.receipt, null, 2)}\n`
              : `Sealed ${result.receipt.unitId}/${result.receipt.caseId}: ${result.receipt.jobStatus}.\n`
          );
        } else {
          verifyHostedGithubPlanContext(root, plan);
          const expectedPlan = process.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256;
          if (expectedPlan !== plan.planSha256)
            throw new Error(
              'Hosted GitHub plan artifact does not match engine-plan output'
            );
          let needs;
          try {
            needs = JSON.parse(process.env.SEERRNG_ENGINE_NEEDS_JSON ?? '');
          } catch {
            throw new Error(
              'Hosted GitHub reconciliation requires valid needs JSON'
            );
          }
          const evidence = loadHostedReceiptDirectory(
            requiredValue('--receipt-dir')
          );
          const result = reconcileHostedGithubExecution(plan, needs, evidence);
          const externalSummary = result.complete
            ? ''
            : ' External PR metadata remains outside this native result.';
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted engine validation ${result.status}: ${result.receipts.succeeded} sealed cases passed and ${result.jobs.skipped} jobs were inapplicable.${externalSummary}\n`
          );
        }
      }
    } else {
      preflight(root, { testsOnly: has('--tests-only') });
      const plan = createPlan(root, {
        testsOnly: has('--tests-only'),
        canonicalTypescript: !has('--tests-only'),
      });
      if (has('--plan')) {
        if (!has('--tests-only'))
          plan.stagedCoverage = {
            stages: ['repository', 'codeql', 'build', 'browser'],
            supplementalScope: 'full',
            executionPrerequisites: [
              'owned actual-working-byte source snapshot',
              'read-only installed dependencies matching the source lockfile',
              'verified native tool versions and pack closures',
              'actual OS browser/provider network boundary',
              'verified isolated Docker fixture prerequisites where required',
            ],
            githubMetadata: 'pending until an actual PR exists',
            status: 'planned-only; no prerequisite execution or result reuse',
          };
        if (has('--json'))
          process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          printPlan(plan);
          if (plan.stagedCoverage)
            process.stdout.write(
              '\nFull gate also stages CodeQL, builds, browser and supplemental native checks.\nPrerequisites are verified only on execution; GitHub PR metadata remains pending.\n'
            );
        }
      } else {
        printPlan(plan, process.stdout, { details: false });
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', interrupt);
        if (has('--tests-only')) {
          const totals = await executePlan(plan, {
            signal: controller.signal,
          });
          for (const [lane, count] of totals)
            process.stdout.write(
              `${lane}: ${count.total} tests, ${count.active} active\n`
            );
          process.stdout.write('\nLocal tests passed.\n');
        } else {
          context = await createNativeStageContext(root, {
            runId: `local-${randomUUID()}`,
            signal: controller.signal,
          });
          if (context.report.blockedRequired.length) {
            for (const blocker of context.report.blockedRequired)
              process.stderr.write(`${blocker.id}: ${blocker.reason}\n`);
            process.stderr.write(
              `\nFull validation incomplete; no full stages executed. Preparation evidence: ${context.report.artifacts}\n`
            );
            failure = { preserveTemporary: true };
            process.exitCode = 1;
          } else {
            const result = await executeStagedValidation(
              context.binding,
              context.options
            );
            const pendingRequired = context.pendingMetadata.filter(
              (check) => check.required
            );
            const complete = result.ok && pendingRequired.length === 0;
            const report = {
              ...result,
              status: complete
                ? 'passed'
                : result.ok
                  ? 'incomplete'
                  : result.status,
              ok: complete,
              pendingGithubMetadata: context.pendingMetadata,
              derivedArtifacts: context.derivedArtifacts,
              derivedCoverageReferences:
                context.report.derivedCoverageReferences,
              candidate: context.snapshot.candidate,
            };
            const reportPath = resolve(
              context.snapshot.scratchRoot,
              'native-validation-result.json'
            );
            writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
              flag: 'wx',
            });
            process.stdout.write(
              `\nFull native validation ${report.status}. Actual execution evidence: ${reportPath}\n`
            );
            // Retain completed evidence as well as failures; explicit owned cleanup
            // is available through the context API after durable evidence handoff.
            failure = { preserveTemporary: true };
            if (!complete) process.exitCode = 1;
          }
        }
      }
    }
  } catch (error) {
    failure = context ? { ...error, preserveTemporary: true } : error;
    process.stderr.write(`${error.message}\n`);
    if (error.scratchRoot)
      process.stderr.write(
        `Preparation evidence retained: ${error.scratchRoot}\n`
      );
    process.exitCode = controller.signal.aborted ? 130 : error.exitCode || 1;
  } finally {
    if (context) {
      try {
        await context.cleanup(failure);
      } catch (error) {
        process.stderr.write(
          `Post-validation source guard: ${error.message}\n`
        );
        process.exitCode ||= 1;
      }
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
