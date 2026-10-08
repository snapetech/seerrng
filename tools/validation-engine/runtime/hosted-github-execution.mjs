// Copyright (c) snapetech and SeerrNG contributors.
// Admission, evidence and current-attempt reconciliation for GitHub-native jobs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import path from 'node:path';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone engine code cannot resolve application aliases.
import {
  isolatedEnvironment,
  removeOwnedTemporaryDirectory,
  runCommand,
  vitestConfigSource,
} from '../../../bin/local-validation.mjs';
import { acceptNativeCypressResults } from './build-browser-stage.mjs';
import { detectWorkerCapacity } from './cpu-capacity.mjs';
import {
  assertHostedGithubPlan,
  reconcileHostedGithubNeeds,
} from './hosted-github-plan.mjs';
import { verifyHostedTestInventory } from './hosted-test-inventory.mjs';
import { readNodeTapHierarchy } from './node-tap-hierarchy.mjs';
import {
  canonicalJsonSha256,
  createRunScopedLedger,
  createSuccessReceipt,
  createWorkIdentity,
  mergeRunScopedLedgers,
  parseRunScopedLedger,
  recordSuccessfulWork,
  serializeRunScopedLedger,
  verifyRunScopedLedger,
  verifySuccessReceipt,
  workKeySha256,
} from './run-scoped-ledger.mjs';

export const HOSTED_ADMISSION_SCHEMA = 'seerrng-hosted-admission/v2';
export const HOSTED_ADMISSION_DECISION_SCHEMA =
  'seerrng-hosted-admission-decision/v2';
export const HOSTED_UNIT_RECEIPT_SCHEMA = 'seerrng-hosted-unit-receipt/v2';
export const HOSTED_TEST_LANE_RESULT_SCHEMA =
  'seerrng-hosted-test-lane-result/v2';

const HASH64 = /^[a-f0-9]{64}$/;
const HOSTED_CONTROL_FILE =
  /^([a-z0-9][a-z0-9-]{0,255})\.(admission|receipt|ledger)\.json$/;
const JOB_STATUSES = new Set(['success', 'failure', 'cancelled']);
const EVENT_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;
const BEHAVIOR_INPUT_MAX_BYTES = 4 * 1024 * 1024;
const HOSTED_RESULT_MAX_BYTES = 64 * 1024 * 1024;
const HOSTED_CASE_RESULTS_SCHEMA = 'seerrng-hosted-case-results/v2';
const CYPRESS_RUNTIME_CONFIG_DIRECTORY = 'seerrng-cypress-runtime-config';
const PLAYWRIGHT_RUNTIME_CONFIG_DIRECTORY = 'seerrng-playwright-runtime-config';
const UNIT_TEST_EVIDENCE = Object.freeze({
  vitest: 'report.xml',
  node: 'seerrng-engine-node-tests.json',
});
const CYPRESS_TEST_EVIDENCE = 'seerrng-engine-cypress-result.json';
const HOSTED_CYPRESS_RESULT_SCHEMA = 'seerrng-hosted-cypress-result/v1';
const PLAYWRIGHT_TEST_EVIDENCE = 'seerrng-engine-playwright-result.json';
const COMMAND_ENVIRONMENT = Object.freeze([
  'CI',
  'GITHUB_ACTIONS',
  'GITHUB_BASE_REF',
  'GITHUB_EVENT_NAME',
  'GITHUB_REF',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'NODE_OPTIONS',
  'TZ',
]);
const RUNNER_ENVIRONMENT = Object.freeze([
  'ImageOS',
  'ImageVersion',
  'RUNNER_ARCH',
  'RUNNER_ENVIRONMENT',
  'RUNNER_OS',
]);
const WORKFLOW_FILES = Object.freeze({
  ci: '.github/workflows/ci.yml',
  codeql: '.github/workflows/codeql.yml',
  cypress: '.github/workflows/cypress.yml',
  testDocs: '.github/workflows/test-docs.yml',
  docsLinks: '.github/workflows/docs-link-check.yml',
  helm: '.github/workflows/lint-helm-charts.yml',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonSha256 = (value) => canonicalJsonSha256(value);
const git = (root, parameters, encoding = 'utf8') =>
  execFileSync('git', ['--no-optional-locks', '-C', root, ...parameters], {
    ...(encoding === null ? {} : { encoding }),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, label, keys) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
}

function regularFile(file, label) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1)
    throw new Error(`Unsafe or empty ${label}: ${file}`);
  return stat;
}

function readCheckedRegularFile(file, label, { allowMissing = false } = {}) {
  let descriptor;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw new Error(`Unsafe ${label}: ${file}`, { cause: error });
  }
  try {
    const before = fstatSync(descriptor);
    const sameFile = (left, right) =>
      left.isFile() &&
      right.isFile() &&
      ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(
        (key) => left[key] === right[key]
      );
    let checked;
    try {
      checked = lstatSync(file);
    } catch (error) {
      throw new Error(`${label} changed before its descriptor read`, {
        cause: error,
      });
    }
    if (checked.isSymbolicLink() || !sameFile(checked, before))
      throw new Error(`${label} changed before its descriptor read`);
    const bytes = readFileSync(descriptor);
    let afterPath;
    try {
      afterPath = lstatSync(file);
    } catch (error) {
      throw new Error(`${label} changed during its descriptor read`, {
        cause: error,
      });
    }
    if (
      !sameFile(fstatSync(descriptor), before) ||
      afterPath.isSymbolicLink() ||
      !sameFile(afterPath, before) ||
      bytes.length !== before.size
    )
      throw new Error(`${label} changed during its descriptor read`);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function writeNewJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

function slug(unitId, caseId) {
  const value = `${unitId}--${caseId}`;
  if (!/^[a-z0-9][a-z0-9-]{0,255}$/.test(value))
    throw new Error('Unsafe hosted unit/case filename');
  return value;
}

function workflowBytes(root, workflow) {
  const relative = WORKFLOW_FILES[workflow];
  if (!relative) throw new Error(`Unknown hosted workflow: ${workflow}`);
  const file = path.resolve(root, relative);
  regularFile(file, `${workflow} workflow`);
  return readFileSync(file);
}

function planScope(plan) {
  return {
    run: {
      provider: 'github-actions',
      repository: plan.candidate.repository,
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
    },
    candidate: {
      repository: plan.candidate.repository,
      commit: plan.candidate.commit,
      tree: plan.candidate.tree,
      sourceSha256: plan.candidate.sourceSha256,
    },
    planSha256: plan.planSha256,
  };
}

export function readHostedGithubPlan(planFile) {
  planFile = path.resolve(planFile);
  regularFile(planFile, 'hosted GitHub plan');
  let plan;
  try {
    plan = JSON.parse(readFileSync(planFile, 'utf8'));
  } catch {
    throw new Error('Hosted GitHub plan artifact is not valid JSON');
  }
  return assertHostedGithubPlan(plan);
}

export function verifyHostedGithubPlanContext(
  root,
  plan,
  { environment = process.env } = {}
) {
  plan = assertHostedGithubPlan(plan);
  if (environment.GITHUB_ACTIONS !== 'true')
    throw new Error('Hosted engine execution requires GitHub Actions');
  const expectedEnvironment = {
    GITHUB_REPOSITORY: plan.candidate.repository,
    GITHUB_RUN_ID: plan.event.runId,
    GITHUB_RUN_ATTEMPT: plan.event.runAttempt,
    GITHUB_SHA: plan.candidate.commit,
  };
  for (const [name, expected] of Object.entries(expectedEnvironment))
    if (environment[name] !== expected)
      throw new Error(`Hosted plan is not bound to current ${name}`);
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim())
    throw new Error('Hosted engine requires an unchanged tracked candidate');
  const observedCandidate = {
    commit: git(root, ['rev-parse', 'HEAD']).trim(),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(),
    lockSha256: sha256(readFileSync(path.resolve(root, 'pnpm-lock.yaml'))),
    sourceSha256: sha256(
      git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
    ),
  };
  for (const [name, value] of Object.entries(observedCandidate))
    if (plan.candidate[name] !== value)
      throw new Error(`Hosted candidate ${name} changed after planning`);
  for (const [name, expected] of Object.entries(plan.workflowHashes))
    if (sha256(workflowBytes(root, name)) !== expected)
      throw new Error(`Hosted ${name} workflow changed after planning`);
  verifyHostedTestInventory(root, plan.testInventory, { platform: 'linux' });
  return plan;
}

function resolveUnitCase(plan, unitId, caseId) {
  const unit = plan.units.find((entry) => entry.id === unitId);
  if (!unit) throw new Error(`Unplanned hosted engine unit: ${unitId}`);
  if (!unit.applicable)
    throw new Error(`Inapplicable hosted engine unit cannot run: ${unitId}`);
  const resolvedCase =
    caseId ?? (unit.cases.length === 1 ? unit.cases[0] : null);
  if (!resolvedCase || !unit.cases.includes(resolvedCase))
    throw new Error(`Exact hosted engine case is required for ${unitId}`);
  return { unit, caseId: resolvedCase };
}

function osReleaseSha256() {
  const file = '/etc/os-release';
  return process.platform === 'linux' && existsSync(file)
    ? sha256(readFileSync(file))
    : sha256(`${platform()}/${arch()}`);
}

function selectedEnvironment(environment, names) {
  return Object.fromEntries(
    names.map((name) => [name, environment[name] ?? null])
  );
}

function boundedJsonFile(file, label, maximumBytes) {
  const stat = regularFile(file, label);
  if (stat.size > maximumBytes)
    throw new Error(`${label} exceeds its safe size limit`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function githubEventPayload(plan, environment) {
  const eventFile = environment.GITHUB_EVENT_PATH;
  if (typeof eventFile !== 'string' || !path.isAbsolute(eventFile))
    throw new Error('Exact GitHub event payload path is required');
  const payload = plainObject(
    boundedJsonFile(eventFile, 'GitHub event payload', EVENT_PAYLOAD_MAX_BYTES),
    'GitHub event payload'
  );
  if (payload.repository?.full_name !== plan.candidate.repository)
    throw new Error('GitHub event payload repository does not match the plan');
  if (plan.event.name === 'pull_request') {
    const pullRequest = plainObject(
      payload.pull_request,
      'GitHub pull request payload'
    );
    if (
      pullRequest.base?.sha !== plan.event.baseSha ||
      pullRequest.head?.sha !== plan.event.headSha
    )
      throw new Error('GitHub pull request payload does not match the plan');
  } else if (
    payload.before !== plan.event.baseSha ||
    payload.after !== plan.event.headSha
  ) {
    throw new Error('GitHub push payload does not match the plan');
  }
  return payload;
}

function behaviorFile(root, relative, label) {
  const sourceRoot = path.resolve(root);
  const normalized = relative.replaceAll('\\', '/');
  const absolute = path.resolve(sourceRoot, normalized);
  if (
    absolute === sourceRoot ||
    !absolute.startsWith(`${sourceRoot}${path.sep}`)
  )
    throw new Error(`Unsafe ${label} path`);
  const parts = normalized.split('/');
  let cursor = sourceRoot;
  for (const part of parts) {
    if (!part || part === '.' || part === '..')
      throw new Error(`Unsafe ${label} path`);
    cursor = path.join(cursor, part);
    if (!existsSync(cursor)) throw new Error(`Missing ${label}: ${relative}`);
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error(`Unsafe symbolic-link ${label}: ${relative}`);
  }
  const stat = regularFile(absolute, label);
  if (stat.size > BEHAVIOR_INPUT_MAX_BYTES)
    throw new Error(`${label} exceeds its safe size limit`);
  return {
    path: normalized,
    bytes: stat.size,
    sha256: sha256(readFileSync(absolute)),
  };
}

function browserRuntimeSettings(root, environment, directory, label) {
  const runnerTemp = environment.RUNNER_TEMP;
  if (typeof runnerTemp !== 'string' || !path.isAbsolute(runnerTemp))
    throw new Error(`Absolute GitHub runner temp is required for ${label}`);
  const resolvedRunnerTemp = path.resolve(runnerTemp);
  if (!existsSync(resolvedRunnerTemp))
    throw new Error(`GitHub runner temp is unsafe for ${label}`);
  const runnerTempStat = lstatSync(resolvedRunnerTemp);
  if (runnerTempStat.isSymbolicLink() || !runnerTempStat.isDirectory())
    throw new Error(`GitHub runner temp is unsafe for ${label}`);

  const expectedConfigDirectory = path.join(resolvedRunnerTemp, directory);
  const configDirectory = environment.CONFIG_DIRECTORY;
  if (
    typeof configDirectory !== 'string' ||
    !path.isAbsolute(configDirectory) ||
    path.resolve(configDirectory) !== expectedConfigDirectory
  )
    throw new Error(
      `${label} runtime config must use the current runner temp directory`
    );

  const sourceRoot = path.resolve(root);
  if (
    expectedConfigDirectory === sourceRoot ||
    expectedConfigDirectory.startsWith(`${sourceRoot}${path.sep}`)
  )
    throw new Error(`${label} runtime config cannot be inside the source tree`);

  const settings = behaviorFile(
    resolvedRunnerTemp,
    `${directory}/settings.json`,
    `${label} runtime settings`
  );
  return {
    ...settings,
    path: `$RUNNER_TEMP/${directory}/settings.json`,
  };
}

function cypressRuntimeSettings(root, environment) {
  return browserRuntimeSettings(
    root,
    environment,
    CYPRESS_RUNTIME_CONFIG_DIRECTORY,
    'Cypress'
  );
}

function playwrightRuntimeSettings(root, environment) {
  return browserRuntimeSettings(
    root,
    environment,
    PLAYWRIGHT_RUNTIME_CONFIG_DIRECTORY,
    'Playwright'
  );
}

function textDigest(value, label) {
  if (value === null || value === undefined) return sha256('');
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  return sha256(value);
}

function hostedBehaviorState(root, plan, unit, caseId, environment) {
  const state = {
    schema: 'seerrng-hosted-behavior-state/v2',
    unitId: unit.id,
    caseId,
    environment: selectedEnvironment(environment, COMMAND_ENVIRONMENT),
    event: null,
    files: [],
    resultReuse: false,
  };
  if (unit.id === 'ci-release-notes') {
    const payload = githubEventPayload(plan, environment);
    state.event = {
      kind: plan.event.name,
      releaseTextSha256:
        plan.event.name === 'pull_request'
          ? textDigest(payload.pull_request.body, 'pull request body')
          : textDigest(payload.head_commit?.message, 'head commit message'),
    };
  } else if (
    unit.id === 'helm-lint-test' &&
    plan.event.name === 'pull_request'
  ) {
    const payload = githubEventPayload(plan, environment);
    if (
      typeof payload.repository.default_branch !== 'string' ||
      !payload.repository.default_branch
    )
      throw new Error('GitHub default branch is required for Helm admission');
    state.event = {
      kind: 'pull_request',
      targetBranchSha256: sha256(payload.repository.default_branch),
    };
  } else if (unit.id === 'cypress-run') {
    const assigned = selectedLane(plan, unit, caseId, 'cypress');
    if (
      assigned.files.some(
        (file) =>
          file.includes(',') || file.includes('\r') || file.includes('\n')
      )
    )
      throw new Error('Hosted Cypress spec paths are unsafe for transport');
    const expectedFiles = assigned.files.join(',');
    if (environment.SEERRNG_ENGINE_CYPRESS_FILES !== expectedFiles)
      throw new Error('Hosted Cypress specs do not match the planned shard');
    const payload = githubEventPayload(plan, environment);
    const message =
      plan.event.name === 'pull_request'
        ? payload.pull_request.title
        : payload.head_commit?.message;
    state.event = {
      kind: plan.event.name,
      commitInfoMessageSha256: textDigest(message, 'Cypress commit message'),
      commitInfoSha:
        plan.event.name === 'pull_request'
          ? plan.event.headSha
          : plan.event.executionSha,
      dashboardMode:
        plan.event.name === 'push'
          ? 'record-secret-presence-not-bindable-at-admission'
          : 'record-disabled',
      specsSha256: sha256(expectedFiles),
    };
    state.files.push(cypressRuntimeSettings(root, environment));
  } else if (unit.id === 'ci-playwright') {
    const assigned = selectedLane(plan, unit, caseId, 'playwright');
    if (assigned.files.length < 1)
      throw new Error('Hosted Playwright lane cannot be empty');
    const port = environment.PORT;
    const baseUrl = environment.PLAYWRIGHT_BASE_URL;
    if (port !== '5055' || baseUrl !== `http://127.0.0.1:${port}`)
      throw new Error('Hosted Playwright server binding is not canonical');
    state.event = {
      kind: 'playwright',
      baseUrlSha256: sha256(baseUrl),
      filesSha256: jsonSha256(assigned.files),
    };
    state.files.push(playwrightRuntimeSettings(root, environment));
  }
  return state;
}

function hostedSetupIdentity(root, plan, unit, caseId, environment) {
  const behavior = hostedBehaviorState(root, plan, unit, caseId, environment);
  const configSha256 = jsonSha256(behavior);
  return {
    setupSha256: jsonSha256({
      workflow: unit.workflow,
      job: unit.job,
      caseId,
      planSha256: plan.planSha256,
      workflowSha256: unit.workflowSha256,
      testInventorySha256: plan.testInventory.inventorySha256,
      assignmentSha256: jsonSha256(selectedCaseAssignment(unit, caseId)),
      configSha256,
    }),
    fixturesSha256: plan.candidate.sourceSha256,
    configSha256,
  };
}

function dependencyStateSha256(root, plan, unit) {
  const relative =
    unit.id === 'test-docs-build'
      ? 'gen-docs/node_modules/.pnpm/lock.yaml'
      : 'node_modules/.pnpm/lock.yaml';
  const installed = path.resolve(root, relative);
  const installedLock = readCheckedRegularFile(
    installed,
    'installed dependency lock',
    { allowMissing: true }
  );
  return jsonSha256({
    sourceLockSha256: plan.candidate.lockSha256,
    installedLock: {
      path: relative,
      sha256: installedLock === null ? null : sha256(installedLock),
    },
  });
}

function actionPinsSha256(source) {
  const pins = source
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line)?.[1])
    .filter(Boolean);
  return jsonSha256(pins);
}

function selectedCaseAssignment(unit, caseId) {
  const assignments = unit.caseAssignments.filter(
    (assignment) => assignment.caseId === caseId
  );
  if (assignments.length !== 1)
    throw new Error(
      `Missing exact hosted case assignment: ${unit.id}/${caseId}`
    );
  return assignments[0];
}

function selectedLane(plan, unit, caseId, laneId) {
  const assignment = selectedCaseAssignment(unit, caseId);
  const scheduled = assignment.lanes.find((lane) => lane.id === laneId);
  const inventory = plan.testInventory.lanes.find((lane) => lane.id === laneId);
  if (!scheduled || !inventory || !unit.testLanes.includes(laneId))
    throw new Error(
      `Missing hosted lane assignment: ${unit.id}/${caseId}/${laneId}`
    );
  return { ...scheduled, command: inventory.command };
}

function laneInventory(plan, unit, caseId) {
  const assignment = selectedCaseAssignment(unit, caseId);
  return assignment.lanes.map((scheduled) => {
    const inventory = plan.testInventory.lanes.find(
      (lane) => lane.id === scheduled.id
    );
    if (!inventory)
      throw new Error(`Missing hosted test lane: ${scheduled.id}`);
    return {
      id: scheduled.id,
      mode: scheduled.mode,
      strategy: scheduled.strategy,
      estimatedWeight: scheduled.estimatedWeight,
      filesSha256: scheduled.filesSha256,
      command: inventory.command,
      files: scheduled.files.map((file) => {
        const entry = plan.testInventory.entries.find(
          (candidate) => candidate.file === file
        );
        if (!entry) throw new Error(`Missing hosted test entry: ${file}`);
        return { file, sourceSha256: entry.sourceSha256 };
      }),
    };
  });
}

export function createHostedWorkIdentity({
  root,
  plan,
  unitId,
  caseId,
  environment = process.env,
}) {
  plan = verifyHostedGithubPlanContext(root, plan, { environment });
  const resolved = resolveUnitCase(plan, unitId, caseId);
  const source = workflowBytes(root, resolved.unit.workflow);
  const commandEnvironment = {
    variables: selectedEnvironment(environment, COMMAND_ENVIRONMENT),
    node: process.version,
    platform: platform(),
    arch: arch(),
  };
  const runnerEnvironment = {
    variables: selectedEnvironment(environment, RUNNER_ENVIRONMENT),
    osReleaseSha256: osReleaseSha256(),
    node: process.version,
    platform: platform(),
    arch: arch(),
  };
  const setup = hostedSetupIdentity(
    root,
    plan,
    resolved.unit,
    resolved.caseId,
    environment
  );
  return createWorkIdentity({
    schema: 'seerrng-run-scoped-work-identity/v1',
    ...planScope(plan),
    unit: {
      id: `${resolved.unit.id}.${resolved.caseId}`,
      definitionSha256: jsonSha256(resolved.unit),
      testInventorySha256: plan.testInventory.inventorySha256,
      caseInventorySha256: jsonSha256({
        selectedCase: resolved.caseId,
        cases: resolved.unit.cases,
        assignmentSha256: jsonSha256(
          selectedCaseAssignment(resolved.unit, resolved.caseId)
        ),
        lanes: laneInventory(plan, resolved.unit, resolved.caseId),
      }),
    },
    command: {
      executable: 'github-workflow-job',
      args: [
        resolved.unit.workflow,
        resolved.unit.job,
        resolved.caseId,
        ...resolved.unit.testLanes,
      ],
      cwd: '.',
      environmentSha256: jsonSha256(commandEnvironment),
    },
    dependencies: {
      lockSha256: plan.candidate.lockSha256,
      stateSha256: dependencyStateSha256(root, plan, resolved.unit),
    },
    toolchain: {
      runtimeSha256: jsonSha256({
        node: process.version,
        versions: process.versions,
        platform: platform(),
        arch: arch(),
      }),
      toolsSha256: jsonSha256({
        workflowSha256: resolved.unit.workflowSha256,
        actionPinsSha256: actionPinsSha256(source),
      }),
    },
    runner: {
      image: `github-hosted:${environment.ImageOS ?? environment.RUNNER_OS ?? platform()}@${environment.ImageVersion ?? 'unversioned'}:${osReleaseSha256()}`,
      environmentSha256: jsonSha256(runnerEnvironment),
    },
    setup,
    workflow: {
      workflowSha256: resolved.unit.workflowSha256,
      actionsSha256: actionPinsSha256(source),
    },
  });
}

function admissionHash(value) {
  const unsigned = { ...value };
  delete unsigned.admissionSha256;
  return jsonSha256(unsigned);
}

function verifyAdmission(value, expectedIdentity, { unitId, caseId } = {}) {
  exactKeys(value, 'hosted admission', [
    'admissionSha256',
    'caseId',
    'identity',
    'planSha256',
    'schema',
    'unitId',
    'workKeySha256',
  ]);
  if (value.schema !== HOSTED_ADMISSION_SCHEMA)
    throw new Error('Unsupported hosted admission schema');
  const identity = createWorkIdentity(value.identity);
  if (
    value.planSha256 !== identity.planSha256 ||
    value.workKeySha256 !== workKeySha256(identity) ||
    value.admissionSha256 !== admissionHash(value)
  )
    throw new Error('Hosted admission seal or binding is invalid');
  slug(value.unitId, value.caseId);
  if (identity.unit.id !== `${value.unitId}.${value.caseId}`)
    throw new Error('Hosted admission unit/case identity is invalid');
  if (
    expectedIdentity &&
    workKeySha256(identity) !== workKeySha256(expectedIdentity)
  )
    throw new Error('Hosted admission does not match current work identity');
  if (
    (unitId !== undefined && value.unitId !== unitId) ||
    (caseId !== undefined && value.caseId !== caseId)
  )
    throw new Error('Hosted admission does not match the requested unit/case');
  return { ...value, identity };
}

function admissionDecisionHash(value) {
  const unsigned = { ...value };
  delete unsigned.decisionSha256;
  return jsonSha256(unsigned);
}

export function verifyHostedAdmissionDecision(value) {
  exactKeys(value, 'hosted admission decision', [
    'action',
    'admissionSha256',
    'decisionSha256',
    'schema',
    'workKeySha256',
  ]);
  if (
    value.schema !== HOSTED_ADMISSION_DECISION_SCHEMA ||
    value.action !== 'execute' ||
    !HASH64.test(value.admissionSha256 ?? '') ||
    !HASH64.test(value.workKeySha256 ?? '') ||
    value.decisionSha256 !== admissionDecisionHash(value)
  )
    throw new Error('Hosted admission decision seal or schema is invalid');
  return value;
}

function createAdmissionDecision(admission) {
  const unsigned = {
    schema: HOSTED_ADMISSION_DECISION_SCHEMA,
    action: 'execute',
    admissionSha256: admission.admissionSha256,
    workKeySha256: admission.workKeySha256,
  };
  return verifyHostedAdmissionDecision({
    ...unsigned,
    decisionSha256: admissionDecisionHash(unsigned),
  });
}

function receiptPaths(receiptDir, unitId, caseId) {
  const name = slug(unitId, caseId);
  receiptDir = path.resolve(receiptDir);
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  if (
    lstatSync(receiptDir).isSymbolicLink() ||
    !lstatSync(receiptDir).isDirectory()
  )
    throw new Error('Hosted receipt directory is unsafe');
  return {
    admission: path.join(receiptDir, `${name}.admission.json`),
    receipt: path.join(receiptDir, `${name}.receipt.json`),
    ledger: path.join(receiptDir, `${name}.ledger.json`),
  };
}

export function admitHostedGithubUnit({
  root,
  plan,
  expectedPlanSha256,
  unitId,
  caseId,
  receiptDir,
  environment = process.env,
}) {
  if (plan.planSha256 !== expectedPlanSha256)
    throw new Error('Hosted admission expected-plan hash mismatch');
  const resolved = resolveUnitCase(plan, unitId, caseId);
  const identity = createHostedWorkIdentity({
    root,
    plan,
    unitId,
    caseId: resolved.caseId,
    environment,
  });
  const paths = receiptPaths(receiptDir, unitId, resolved.caseId);
  let ledger = createRunScopedLedger(planScope(plan));
  let ledgerDescriptor;
  try {
    ledgerDescriptor = openSync(
      paths.ledger,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  if (ledgerDescriptor === undefined) {
    ledger = parseRunScopedLedger(
      readCheckedRegularFile(paths.ledger, 'hosted run ledger').toString('utf8')
    );
  } else {
    try {
      writeFileSync(ledgerDescriptor, serializeRunScopedLedger(ledger));
    } finally {
      closeSync(ledgerDescriptor);
    }
  }
  const unsigned = {
    schema: HOSTED_ADMISSION_SCHEMA,
    planSha256: plan.planSha256,
    unitId,
    caseId: resolved.caseId,
    workKeySha256: workKeySha256(identity),
    identity,
  };
  const admission = {
    ...unsigned,
    admissionSha256: admissionHash(unsigned),
  };
  if (existsSync(paths.admission)) {
    const admitted = verifyAdmission(
      JSON.parse(readFileSync(paths.admission, 'utf8')),
      identity,
      { unitId, caseId: resolved.caseId }
    );
    if (admitted.admissionSha256 !== admission.admissionSha256)
      throw new Error('Conflicting hosted admission for one unit/case');
    if (ledger.entries.length > 0 || existsSync(paths.receipt))
      throw new Error(
        'Hosted unit/case is already finalized; test-result reuse is disabled'
      );
    throw new Error(
      'Hosted unit/case is already admitted; duplicate execution is not allowed'
    );
  }
  if (ledger.entries.length > 0 || existsSync(paths.receipt))
    throw new Error(
      'Hosted result artifacts exist without their original admission'
    );
  writeNewJson(paths.admission, admission);
  return {
    admission,
    decision: createAdmissionDecision(admission),
    paths,
  };
}

function evidenceManifest(files, { required }) {
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string'))
    throw new Error('Hosted evidence files must be an array of paths');
  const names = new Set();
  const entries = files.map((file) => {
    const absolute = path.resolve(file);
    if (!existsSync(absolute)) {
      if (required)
        throw new Error(`Missing successful hosted evidence: ${file}`);
      return { name: path.basename(absolute), missing: true };
    }
    const stat = regularFile(absolute, 'hosted evidence');
    if (stat.size > HOSTED_RESULT_MAX_BYTES)
      throw new Error('Hosted evidence exceeds its safe limit');
    const name = path.basename(absolute);
    if (names.has(name))
      throw new Error(`Duplicate hosted evidence name: ${name}`);
    names.add(name);
    return { name, bytes: stat.size, sha256: sha256(readFileSync(absolute)) };
  });
  return entries.toSorted((left, right) => left.name.localeCompare(right.name));
}

function archiveHostedEvidence(receiptDir, unitId, caseId, files) {
  const prefix = slug(unitId, caseId);
  for (const file of files) {
    const source = path.resolve(file);
    if (!existsSync(source)) continue;
    const stat = regularFile(source, 'hosted evidence archive input');
    if (stat.size > HOSTED_RESULT_MAX_BYTES)
      throw new Error('Hosted evidence archive input exceeds its safe limit');
    const name = path.basename(source);
    const target = path.join(
      path.resolve(receiptDir),
      `${prefix}.evidence-${name}`
    );
    writeFileSync(target, readFileSync(source), {
      flag: 'wx',
      mode: 0o600,
    });
  }
}

function exactStringArray(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string') ||
    jsonSha256(value) !== jsonSha256(expected)
  )
    throw new Error(`${label} does not match the planned inventory`);
  return value;
}

function decodeXmlAttribute(value) {
  return value.replace(
    /&(?:#(?:x[0-9a-f]+|[0-9]+)|amp|apos|gt|lt|quot);/giu,
    (entity) => {
      const named = {
        '&amp;': '&',
        '&apos;': "'",
        '&gt;': '>',
        '&lt;': '<',
        '&quot;': '"',
      }[entity.toLowerCase()];
      if (named !== undefined) return named;
      const hexadecimal = entity.toLowerCase().startsWith('&#x');
      const digits = entity.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0x1)
        throw new Error('Vitest JUnit report contains an invalid XML entity');
      return String.fromCodePoint(codePoint);
    }
  );
}

function xmlAttributes(source, label) {
  const attributes = {};
  const matcher = /\s*([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])([\s\S]*?)\2/gy;
  let cursor = 0;
  while (cursor < source.length) {
    if (/^\s*\/?\s*$/.test(source.slice(cursor))) break;
    matcher.lastIndex = cursor;
    const match = matcher.exec(source);
    if (!match)
      throw new Error(`Vitest JUnit ${label} attributes are malformed`);
    if (Object.hasOwn(attributes, match[1]))
      throw new Error(`Vitest JUnit ${label} has duplicate attributes`);
    attributes[match[1]] = decodeXmlAttribute(match[3]);
    cursor = matcher.lastIndex;
  }
  if (!/^\s*\/?\s*$/.test(source.slice(cursor)))
    throw new Error(`Vitest JUnit ${label} attributes are malformed`);
  return attributes;
}

function nonnegativeXmlInteger(attributes, name, label) {
  const value = attributes[name];
  if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? ''))
    throw new Error(`Vitest JUnit ${label} requires a valid ${name} count`);
  return Number(value);
}

function verifyVitestJunitReport(file, expectedFiles) {
  const stat = regularFile(file, 'Vitest JUnit report');
  if (stat.size > HOSTED_RESULT_MAX_BYTES)
    throw new Error('Vitest JUnit report exceeds its safe size limit');
  const bytes = readFileSync(file);
  const source = bytes.toString('utf8').replace(/^\uFEFF/u, '');
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    throw new Error('Vitest JUnit report cannot contain a document type');
  const roots = [...source.matchAll(/<testsuites\b([^>]*)>/gu)];
  const rootClosures = [...source.matchAll(/<\/testsuites\s*>/gu)];
  if (roots.length !== 1 || rootClosures.length !== 1)
    throw new Error('Vitest JUnit report requires one testsuites root');
  const root = xmlAttributes(roots[0][1], 'testsuites');
  const rootTests = nonnegativeXmlInteger(root, 'tests', 'testsuites');
  const rootFailures = nonnegativeXmlInteger(root, 'failures', 'testsuites');
  const rootErrors = nonnegativeXmlInteger(root, 'errors', 'testsuites');
  if (rootFailures !== 0 || rootErrors !== 0)
    throw new Error('Vitest JUnit report contains failed or errored tests');

  const suiteOpenings = [...source.matchAll(/<testsuite\b/gu)].length;
  const suites = [
    ...source.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite\s*>/gu),
  ];
  if (suites.length !== suiteOpenings)
    throw new Error('Vitest JUnit report contains an incomplete testsuite');
  const files = [];
  let summedTests = 0;
  let summedSkipped = 0;
  for (const suiteMatch of suites) {
    const attributes = xmlAttributes(suiteMatch[1], 'testsuite');
    if (typeof attributes.name !== 'string' || !attributes.name)
      throw new Error('Vitest JUnit testsuite requires a file name');
    const tests = nonnegativeXmlInteger(attributes, 'tests', 'testsuite');
    const failures = nonnegativeXmlInteger(attributes, 'failures', 'testsuite');
    const errors = nonnegativeXmlInteger(attributes, 'errors', 'testsuite');
    const skipped = nonnegativeXmlInteger(attributes, 'skipped', 'testsuite');
    const testcases = [...suiteMatch[2].matchAll(/<testcase\b/gu)].length;
    if (
      tests < 1 ||
      skipped > tests ||
      failures !== 0 ||
      errors !== 0 ||
      testcases !== tests ||
      /<(?:failure|error)\b/iu.test(suiteMatch[2])
    )
      throw new Error(
        `Vitest JUnit testsuite is not a complete success: ${attributes.name}`
      );
    files.push(attributes.name);
    summedTests += tests;
    summedSkipped += skipped;
  }
  if (
    rootTests !== summedTests ||
    files.length !== expectedFiles.length ||
    new Set(files).size !== files.length ||
    expectedFiles.some((expected) => !files.includes(expected)) ||
    files.some((actual) => !expectedFiles.includes(actual))
  )
    throw new Error('Vitest JUnit report does not close the planned file set');
  if (rootTests - summedSkipped < 1)
    throw new Error('Vitest JUnit report contains no active tests');
  return {
    id: 'vitest',
    proof: 'junit-file-closure',
    files: [...expectedFiles],
    fileCount: files.length,
    tests: rootTests,
    active: rootTests - summedSkipped,
    skipped: summedSkipped,
    failures: 0,
    errors: 0,
    reportSha256: sha256(bytes),
  };
}

function verifyNativeNodeLaneReport({
  file,
  plan,
  unit,
  caseId,
  admission,
  lane,
  root,
  environment,
}) {
  const stat = regularFile(file, 'hosted native Node result');
  if (stat.size > HOSTED_RESULT_MAX_BYTES)
    throw new Error('Hosted native Node result exceeds its safe size limit');
  const bytes = readFileSync(file);
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Hosted native Node result is not valid JSON');
  }
  exactKeys(result, 'hosted native Node result', [
    'admissionSha256',
    'capacity',
    'caseId',
    'caseLedger',
    'counts',
    'files',
    'inventorySha256',
    'laneId',
    'planSha256',
    'schema',
    'status',
    'unitId',
    'workKeySha256',
  ]);
  exactStringArray(result.files, lane.files, 'Hosted native Node files');
  const expectedCapacity = detectWorkerCapacity({
    sourceRoot: root,
    environment,
  });
  if (
    result.schema !== HOSTED_TEST_LANE_RESULT_SCHEMA ||
    result.planSha256 !== plan.planSha256 ||
    result.unitId !== unit.id ||
    result.caseId !== caseId ||
    result.admissionSha256 !== admission.admissionSha256 ||
    result.workKeySha256 !== admission.workKeySha256 ||
    result.inventorySha256 !== plan.testInventory.inventorySha256 ||
    result.laneId !== lane.id ||
    result.status !== 'passed' ||
    jsonSha256(result.capacity) !== jsonSha256(expectedCapacity)
  )
    throw new Error('Hosted native Node result is not bound to its admission');

  exactKeys(result.counts, 'hosted native Node totals', ['active', 'total']);
  const ledger = result.caseLedger;
  exactKeys(ledger, 'hosted native Node case ledger', [
    'cases',
    'complete',
    'counts',
    'files',
    'format',
    'issues',
    'nativeRunner',
    'nodes',
    'rawBytes',
    'reports',
    'reportSha256',
    'roots',
    'summaries',
  ]);
  exactStringArray(
    ledger.files,
    lane.files,
    'Hosted native Node case-ledger files'
  );
  exactKeys(ledger.counts, 'hosted native Node case counts', [
    'failed',
    'passed',
    'skipped',
  ]);
  exactKeys(ledger.summaries, 'hosted native Node TAP summaries', [
    'cancelled',
    'fail',
    'pass',
    'skipped',
    'suites',
    'tests',
    'todo',
  ]);
  const integers = [
    result.counts.total,
    result.counts.active,
    ledger.counts.failed,
    ledger.counts.passed,
    ledger.counts.skipped,
    ledger.rawBytes,
    ...Object.values(ledger.summaries),
  ];
  const cases = Array.isArray(ledger.cases) ? ledger.cases : [];
  const caseIds = cases.map((entry) => entry?.caseId);
  const reports = Array.isArray(ledger.reports) ? ledger.reports : [];
  for (const report of reports)
    exactKeys(report, 'hosted native Node per-file report', [
      'active',
      'file',
      'passed',
      'rawBytes',
      'reportSha256',
      'skipped',
      'tests',
      'wallMs',
    ]);
  const reportFiles = reports.map((report) => report.file);
  const reportIntegers = reports.flatMap((report) => [
    report.tests,
    report.active,
    report.passed,
    report.skipped,
    report.rawBytes,
  ]);
  const perFileClosure = reports.every((report) => {
    const observed = cases.filter((entry) => entry?.file === report.file);
    const passed = observed.filter(
      (entry) => entry?.status === 'passed'
    ).length;
    const skipped = observed.filter((entry) => entry?.status === 'skip').length;
    return (
      HASH64.test(report.reportSha256 ?? '') &&
      Number.isFinite(report.wallMs) &&
      report.wallMs >= 0 &&
      report.tests > 0 &&
      report.rawBytes > 0 &&
      report.active === report.passed &&
      report.passed + report.skipped === report.tests &&
      observed.length === report.tests &&
      passed === report.passed &&
      skipped === report.skipped
    );
  });
  if (
    integers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    reportIntegers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    ledger.complete !== true ||
    !Array.isArray(ledger.issues) ||
    ledger.issues.length !== 0 ||
    ledger.nativeRunner !== 'node:test-per-file' ||
    ledger.format !== 'node-tap13-per-file-v1' ||
    !HASH64.test(ledger.reportSha256 ?? '') ||
    ledger.reportSha256 !== jsonSha256(reports) ||
    ledger.rawBytes < 1 ||
    reports.length !== lane.files.length ||
    new Set(reportFiles).size !== reports.length ||
    reportFiles.some((file, index) => file !== lane.files[index]) ||
    !perFileClosure ||
    reports.reduce((sum, report) => sum + report.rawBytes, 0) !==
      ledger.rawBytes ||
    !Array.isArray(ledger.nodes) ||
    !Array.isArray(ledger.roots) ||
    cases.length < 1 ||
    caseIds.some((value) => typeof value !== 'string' || !value) ||
    new Set(caseIds).size !== caseIds.length ||
    result.counts.total !== cases.length ||
    result.counts.active !== ledger.counts.passed + ledger.counts.failed ||
    ledger.counts.failed !== 0 ||
    ledger.counts.passed < 1 ||
    ledger.counts.passed + ledger.counts.failed + ledger.counts.skipped !==
      cases.length ||
    ledger.summaries.tests !== cases.length ||
    ledger.summaries.pass !== ledger.counts.passed ||
    ledger.summaries.fail !== 0 ||
    ledger.summaries.skipped !== ledger.counts.skipped ||
    ledger.summaries.cancelled !== 0 ||
    ledger.summaries.todo !== 0 ||
    reports.reduce((sum, report) => sum + report.tests, 0) !== cases.length ||
    reports.reduce((sum, report) => sum + report.active, 0) !==
      result.counts.active ||
    reports.reduce((sum, report) => sum + report.passed, 0) !==
      ledger.counts.passed ||
    reports.reduce((sum, report) => sum + report.skipped, 0) !==
      ledger.counts.skipped
  )
    throw new Error('Hosted native Node result closure is incomplete');
  return {
    id: lane.id,
    proof: 'engine-json-per-file-closure',
    files: [...lane.files],
    fileCount: lane.files.length,
    tests: result.counts.total,
    active: result.counts.active,
    passed: ledger.counts.passed,
    skipped: ledger.counts.skipped,
    nativeReportSha256: ledger.reportSha256,
    resultSha256: sha256(bytes),
  };
}

function verifyHostedCypressReport({ file, plan, unit, caseId, lane, root }) {
  const stat = regularFile(file, 'hosted Cypress result');
  if (stat.size > HOSTED_RESULT_MAX_BYTES)
    throw new Error('Hosted Cypress result exceeds its safe size limit');
  const bytes = readFileSync(file);
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Hosted Cypress result is not valid JSON');
  }
  exactKeys(result, 'hosted Cypress result', [
    'caseId',
    'native',
    'planSha256',
    'schema',
    'specs',
    'unitId',
  ]);
  exactStringArray(result.specs, lane.files, 'Hosted Cypress specs');
  if (
    result.schema !== HOSTED_CYPRESS_RESULT_SCHEMA ||
    result.planSha256 !== plan.planSha256 ||
    result.unitId !== unit.id ||
    result.caseId !== caseId
  )
    throw new Error('Hosted Cypress result is not bound to its unit/case');
  const accepted = acceptNativeCypressResults(
    {
      schema: 1,
      candidate: plan.candidate,
      specs: result.specs,
      native: result.native,
    },
    {
      root: path.resolve(root),
      candidate: plan.candidate,
      specs: lane.files,
    },
    { allowNoActiveTests: true }
  );
  if (accepted.status !== 'passed' || accepted.counts.failed !== 0)
    throw new Error('Hosted Cypress shard did not pass');
  return {
    id: lane.id,
    proof: 'native-cypress-per-case-closure',
    files: [...lane.files],
    fileCount: lane.files.length,
    tests: accepted.cases.length,
    active: accepted.counts.passed + accepted.counts.failed,
    passed: accepted.counts.passed,
    failures: accepted.counts.failed,
    pending: accepted.counts.pending,
    skipped: accepted.counts.skipped,
    durationMs: accepted.durationMs,
    reportSha256: sha256(bytes),
  };
}

function playwrightSpecFile(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Hosted Playwright report contains an unsafe spec path');
  return `playwright/${value}`;
}

function playwrightSpecs(suites) {
  if (!Array.isArray(suites))
    throw new Error('Hosted Playwright report requires suites');
  const specs = [];
  for (const suite of suites) {
    plainObject(suite, 'hosted Playwright suite');
    if (suite.suites !== undefined)
      specs.push(...playwrightSpecs(suite.suites));
    if (suite.specs !== undefined) {
      if (!Array.isArray(suite.specs))
        throw new Error('Hosted Playwright suite specs are invalid');
      specs.push(...suite.specs);
    }
  }
  return specs;
}

function verifyHostedPlaywrightReport({ file, lane, root, environment }) {
  const stat = regularFile(file, 'hosted Playwright result');
  if (stat.size > HOSTED_RESULT_MAX_BYTES)
    throw new Error('Hosted Playwright result exceeds its safe size limit');
  const bytes = readFileSync(file);
  let result;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Hosted Playwright result is not valid JSON');
  }
  exactKeys(result, 'hosted Playwright result', [
    'config',
    'errors',
    'stats',
    'suites',
  ]);
  const config = plainObject(result.config, 'hosted Playwright config');
  const webServer = plainObject(
    config.webServer,
    'hosted Playwright web server'
  );
  exactKeys(webServer.env, 'hosted Playwright web-server environment', [
    'CONFIG_DIRECTORY',
    'PORT',
  ]);
  if (
    path.resolve(config.configFile ?? '') !==
      path.join(path.resolve(root), 'playwright.config.ts') ||
    path.resolve(config.rootDir ?? '') !==
      path.join(path.resolve(root), 'playwright') ||
    config.fullyParallel !== false ||
    config.workers !== 1 ||
    webServer.command !== 'pnpm cypress:start' ||
    webServer.url !== `${environment.PLAYWRIGHT_BASE_URL}/login` ||
    webServer.env.CONFIG_DIRECTORY !== environment.CONFIG_DIRECTORY ||
    webServer.env.PORT !== environment.PORT
  )
    throw new Error('Hosted Playwright result used an unbound configuration');
  if (!Array.isArray(result.errors) || result.errors.length !== 0)
    throw new Error('Hosted Playwright result contains top-level errors');

  const stats = plainObject(result.stats, 'hosted Playwright statistics');
  const counts = ['expected', 'skipped', 'unexpected', 'flaky'].map(
    (key) => stats[key]
  );
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    !Number.isFinite(stats.duration) ||
    stats.duration < 0 ||
    stats.expected < 1 ||
    stats.unexpected !== 0 ||
    stats.flaky !== 0
  )
    throw new Error('Hosted Playwright result did not pass completely');

  const specs = playwrightSpecs(result.suites);
  if (!specs.length)
    throw new Error('Hosted Playwright result contains no specs');
  const files = [];
  let passed = 0;
  let skipped = 0;
  for (const spec of specs) {
    plainObject(spec, 'hosted Playwright spec');
    const specFile = playwrightSpecFile(spec.file);
    if (spec.ok !== true || !Array.isArray(spec.tests) || !spec.tests.length)
      throw new Error(`Hosted Playwright spec did not pass: ${specFile}`);
    files.push(specFile);
    for (const test of spec.tests) {
      plainObject(test, 'hosted Playwright test');
      if (
        !['passed', 'skipped'].includes(test.expectedStatus) ||
        !Array.isArray(test.results)
      )
        throw new Error(`Hosted Playwright test is invalid: ${specFile}`);
      if (test.status === 'expected') {
        if (
          test.expectedStatus !== 'passed' ||
          !test.results.length ||
          test.results.at(-1)?.status !== 'passed'
        )
          throw new Error(`Hosted Playwright test did not pass: ${specFile}`);
        passed++;
      } else if (test.status === 'skipped') {
        if (
          test.results.some(
            (attempt) =>
              attempt?.status !== undefined && attempt.status !== 'skipped'
          )
        )
          throw new Error(`Hosted Playwright skip is invalid: ${specFile}`);
        skipped++;
      } else {
        throw new Error(`Hosted Playwright test did not pass: ${specFile}`);
      }
    }
  }
  const uniqueFiles = [...new Set(files)].toSorted();
  if (
    uniqueFiles.length !== lane.files.length ||
    lane.files.some((expected, index) => uniqueFiles[index] !== expected) ||
    passed !== stats.expected ||
    skipped !== stats.skipped
  )
    throw new Error('Hosted Playwright result does not close the planned lane');
  return {
    id: lane.id,
    proof: 'native-playwright-file-closure',
    files: [...lane.files],
    fileCount: lane.files.length,
    tests: passed + skipped,
    active: passed,
    passed,
    failures: 0,
    skipped,
    reportSha256: sha256(bytes),
  };
}

function createHostedCaseResults({
  root,
  plan,
  unit,
  caseId,
  admission,
  evidenceFiles,
  environment,
}) {
  const evidenceByName = new Map(
    evidenceFiles.map((file) => [
      path.basename(path.resolve(file)),
      path.resolve(file),
    ])
  );
  const expectedEvidence =
    unit.id === 'ci-unit-test'
      ? Object.values(UNIT_TEST_EVIDENCE)
      : unit.id === 'cypress-run'
        ? [CYPRESS_TEST_EVIDENCE]
        : unit.id === 'ci-playwright'
          ? [PLAYWRIGHT_TEST_EVIDENCE]
          : [];
  if (
    evidenceByName.size !== expectedEvidence.length ||
    expectedEvidence.some((name) => !evidenceByName.has(name))
  )
    throw new Error(
      `${unit.id} success requires its exact hosted evidence set`
    );
  const lanes = unit.testLanes.map((laneId) => {
    const lane = selectedLane(plan, unit, caseId, laneId);
    if (laneId === 'vitest')
      return verifyVitestJunitReport(
        evidenceByName.get(UNIT_TEST_EVIDENCE.vitest),
        lane.files
      );
    if (laneId === 'node-test-mjs')
      return verifyNativeNodeLaneReport({
        file: evidenceByName.get(UNIT_TEST_EVIDENCE.node),
        plan,
        unit,
        caseId,
        admission,
        lane,
        root,
        environment,
      });
    if (laneId === 'cypress')
      return verifyHostedCypressReport({
        file: evidenceByName.get(CYPRESS_TEST_EVIDENCE),
        plan,
        unit,
        caseId,
        lane,
        root,
      });
    if (laneId === 'playwright')
      return verifyHostedPlaywrightReport({
        file: evidenceByName.get(PLAYWRIGHT_TEST_EVIDENCE),
        lane,
        root,
        environment,
      });
    return { id: laneId, proof: 'workflow-bound-native-exit' };
  });
  return {
    schema: HOSTED_CASE_RESULTS_SCHEMA,
    unitId: unit.id,
    caseId,
    lanes,
  };
}

function verifyHostedCaseResults(plan, unit, caseId, value, evidence) {
  exactKeys(value, 'hosted case results', [
    'caseId',
    'lanes',
    'schema',
    'unitId',
  ]);
  if (
    value.schema !== HOSTED_CASE_RESULTS_SCHEMA ||
    value.unitId !== unit.id ||
    value.caseId !== caseId ||
    !Array.isArray(value.lanes) ||
    value.lanes.length !== unit.testLanes.length
  )
    throw new Error('Hosted case results are not bound to their unit/case');
  const evidenceByName = new Map(evidence.map((entry) => [entry.name, entry]));
  for (const [index, laneId] of unit.testLanes.entries()) {
    const actual = value.lanes[index];
    const lane = selectedLane(plan, unit, caseId, laneId);
    if (laneId === 'vitest') {
      exactKeys(actual, 'hosted Vitest case results', [
        'active',
        'errors',
        'failures',
        'fileCount',
        'files',
        'id',
        'proof',
        'reportSha256',
        'skipped',
        'tests',
      ]);
      exactStringArray(actual.files, lane.files, 'Hosted Vitest result files');
      if (
        actual.id !== laneId ||
        actual.proof !== 'junit-file-closure' ||
        actual.fileCount !== lane.files.length ||
        ![actual.tests, actual.active, actual.skipped].every(
          (count) => Number.isSafeInteger(count) && count >= 0
        ) ||
        actual.tests < lane.files.length ||
        actual.active < 1 ||
        actual.active + actual.skipped !== actual.tests ||
        actual.failures !== 0 ||
        actual.errors !== 0 ||
        actual.reportSha256 !==
          evidenceByName.get(UNIT_TEST_EVIDENCE.vitest)?.sha256
      )
        throw new Error('Hosted Vitest case results failed reconciliation');
    } else if (laneId === 'node-test-mjs') {
      exactKeys(actual, 'hosted native Node case results', [
        'active',
        'fileCount',
        'files',
        'id',
        'nativeReportSha256',
        'passed',
        'proof',
        'resultSha256',
        'skipped',
        'tests',
      ]);
      exactStringArray(
        actual.files,
        lane.files,
        'Hosted native Node result files'
      );
      if (
        actual.id !== laneId ||
        actual.proof !== 'engine-json-per-file-closure' ||
        actual.fileCount !== lane.files.length ||
        ![actual.tests, actual.active, actual.passed, actual.skipped].every(
          (count) => Number.isSafeInteger(count) && count >= 0
        ) ||
        actual.tests < 1 ||
        actual.active < 1 ||
        actual.passed !== actual.active ||
        actual.passed + actual.skipped !== actual.tests ||
        !HASH64.test(actual.nativeReportSha256 ?? '') ||
        actual.resultSha256 !==
          evidenceByName.get(UNIT_TEST_EVIDENCE.node)?.sha256
      )
        throw new Error(
          'Hosted native Node case results failed reconciliation'
        );
    } else if (laneId === 'cypress') {
      exactKeys(actual, 'hosted Cypress case results', [
        'active',
        'durationMs',
        'failures',
        'fileCount',
        'files',
        'id',
        'passed',
        'pending',
        'proof',
        'reportSha256',
        'skipped',
        'tests',
      ]);
      exactStringArray(actual.files, lane.files, 'Hosted Cypress result files');
      if (
        actual.id !== laneId ||
        actual.proof !== 'native-cypress-per-case-closure' ||
        actual.fileCount !== lane.files.length ||
        ![
          actual.tests,
          actual.active,
          actual.passed,
          actual.failures,
          actual.pending,
          actual.skipped,
        ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
        (actual.durationMs !== null &&
          (!Number.isSafeInteger(actual.durationMs) ||
            actual.durationMs < 0)) ||
        actual.active !== actual.passed + actual.failures ||
        actual.tests !==
          actual.passed + actual.failures + actual.pending + actual.skipped ||
        actual.failures !== 0 ||
        !HASH64.test(actual.reportSha256 ?? '') ||
        actual.reportSha256 !==
          evidenceByName.get(CYPRESS_TEST_EVIDENCE)?.sha256
      )
        throw new Error('Hosted Cypress case results failed reconciliation');
    } else if (laneId === 'playwright') {
      exactKeys(actual, 'hosted Playwright case results', [
        'active',
        'failures',
        'fileCount',
        'files',
        'id',
        'passed',
        'proof',
        'reportSha256',
        'skipped',
        'tests',
      ]);
      exactStringArray(
        actual.files,
        lane.files,
        'Hosted Playwright result files'
      );
      if (
        actual.id !== laneId ||
        actual.proof !== 'native-playwright-file-closure' ||
        actual.fileCount !== lane.files.length ||
        ![
          actual.tests,
          actual.active,
          actual.passed,
          actual.failures,
          actual.skipped,
        ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
        actual.tests !== actual.passed + actual.failures + actual.skipped ||
        actual.active !== actual.passed + actual.failures ||
        actual.active < 1 ||
        actual.failures !== 0 ||
        actual.reportSha256 !==
          evidenceByName.get(PLAYWRIGHT_TEST_EVIDENCE)?.sha256
      )
        throw new Error('Hosted Playwright case results failed reconciliation');
    } else {
      exactKeys(actual, 'hosted native workflow case results', ['id', 'proof']);
      if (actual.id !== laneId || actual.proof !== 'workflow-bound-native-exit')
        throw new Error('Hosted native workflow result failed reconciliation');
    }
  }
  if (
    unit.id === 'ci-unit-test' &&
    (evidenceByName.size !== 2 ||
      !evidenceByName.has(UNIT_TEST_EVIDENCE.vitest) ||
      !evidenceByName.has(UNIT_TEST_EVIDENCE.node))
  )
    throw new Error('Unit-test evidence set failed reconciliation');
  if (
    unit.id === 'cypress-run' &&
    (evidenceByName.size !== 1 || !evidenceByName.has(CYPRESS_TEST_EVIDENCE))
  )
    throw new Error('Cypress evidence set failed reconciliation');
  if (
    unit.id === 'ci-playwright' &&
    (evidenceByName.size !== 1 || !evidenceByName.has(PLAYWRIGHT_TEST_EVIDENCE))
  )
    throw new Error('Playwright evidence set failed reconciliation');
  if (
    !['ci-unit-test', 'cypress-run', 'ci-playwright'].includes(unit.id) &&
    evidenceByName.size !== 0
  )
    throw new Error('Unexpected hosted evidence for native workflow result');
  return value;
}

function unitReceiptHash(value) {
  const unsigned = { ...value };
  delete unsigned.receiptSha256;
  return jsonSha256(unsigned);
}

export function verifyHostedUnitReceipt(value) {
  exactKeys(value, 'hosted unit receipt', [
    'admissionSha256',
    'caseId',
    'caseResults',
    'evidence',
    'jobStatus',
    'needsKey',
    'planSha256',
    'receiptSha256',
    'schema',
    'stage',
    'successReceipt',
    'unitId',
    'workKeySha256',
  ]);
  if (
    value.schema !== HOSTED_UNIT_RECEIPT_SCHEMA ||
    !JOB_STATUSES.has(value.jobStatus) ||
    !HASH64.test(value.planSha256 ?? '') ||
    !HASH64.test(value.admissionSha256 ?? '') ||
    !HASH64.test(value.workKeySha256 ?? '') ||
    !Array.isArray(value.evidence) ||
    value.receiptSha256 !== unitReceiptHash(value)
  )
    throw new Error('Hosted unit receipt seal or schema is invalid');
  const evidenceNames = new Set();
  for (const entry of value.evidence) {
    plainObject(entry, 'hosted evidence entry');
    if (
      typeof entry.name !== 'string' ||
      !entry.name ||
      path.basename(entry.name) !== entry.name ||
      evidenceNames.has(entry.name)
    )
      throw new Error('Hosted evidence manifest is invalid');
    evidenceNames.add(entry.name);
    if (entry.missing === true)
      exactKeys(entry, 'missing hosted evidence entry', ['missing', 'name']);
    else {
      exactKeys(entry, 'hosted evidence entry', ['bytes', 'name', 'sha256']);
      if (
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 ||
        !HASH64.test(entry.sha256 ?? '')
      )
        throw new Error('Hosted evidence manifest is invalid');
    }
  }
  if (value.jobStatus === 'success') {
    plainObject(value.caseResults, 'hosted successful case results');
    if (value.evidence.some((entry) => entry.missing === true))
      throw new Error('Hosted success cannot contain missing evidence');
    const success = verifySuccessReceipt(value.successReceipt);
    if (
      success.workKeySha256 !== value.workKeySha256 ||
      success.identity.planSha256 !== value.planSha256
    )
      throw new Error(
        'Hosted success receipt is not bound to its unit receipt'
      );
  } else if (value.successReceipt !== null || value.caseResults !== null)
    throw new Error(
      'Failed or cancelled hosted work cannot have success evidence'
    );
  return value;
}

export function sealHostedGithubUnitReceipt({
  root,
  plan,
  expectedPlanSha256,
  unitId,
  caseId,
  receiptDir,
  jobStatus,
  evidenceFiles = [],
  environment = process.env,
}) {
  if (!JOB_STATUSES.has(jobStatus))
    throw new Error('Exact GitHub job status is required');
  if (plan.planSha256 !== expectedPlanSha256)
    throw new Error('Hosted receipt expected-plan hash mismatch');
  verifyHostedGithubPlanContext(root, plan, { environment });
  const resolved = resolveUnitCase(plan, unitId, caseId);
  const paths = receiptPaths(receiptDir, unitId, resolved.caseId);
  regularFile(paths.admission, 'hosted admission');
  regularFile(paths.ledger, 'hosted run ledger');
  if (existsSync(paths.receipt))
    throw new Error('Hosted unit/case already has a finalized receipt');
  const admission = verifyAdmission(
    JSON.parse(readFileSync(paths.admission, 'utf8')),
    undefined,
    { unitId, caseId: resolved.caseId }
  );
  assertPlannedHostedIdentity(
    plan,
    resolved.unit,
    resolved.caseId,
    admission.identity
  );
  const identity = admission.identity;
  const ledger = parseRunScopedLedger(readFileSync(paths.ledger, 'utf8'));
  if (ledger.entries.length !== 0)
    throw new Error(
      'Hosted unit/case ledger is not blank before result sealing'
    );
  const evidence = evidenceManifest(evidenceFiles, {
    required: jobStatus === 'success',
  });
  const caseResults =
    jobStatus === 'success'
      ? createHostedCaseResults({
          root,
          plan,
          unit: resolved.unit,
          caseId: resolved.caseId,
          admission,
          evidenceFiles,
          environment,
        })
      : null;
  archiveHostedEvidence(receiptDir, unitId, resolved.caseId, evidenceFiles);
  let successReceipt = null;
  if (jobStatus === 'success') {
    successReceipt = createSuccessReceipt({
      identity,
      evidence: {
        resultSha256: jsonSha256({
          unitId,
          caseId: resolved.caseId,
          jobStatus,
        }),
        stdoutSha256: sha256(''),
        stderrSha256: sha256(''),
        artifactManifestSha256: jsonSha256(evidence),
        caseResultsSha256: jsonSha256({ caseResults, evidence }),
      },
    });
    const updated = recordSuccessfulWork(ledger, successReceipt);
    writeFileSync(paths.ledger, serializeRunScopedLedger(updated), {
      mode: 0o600,
    });
  }
  const unsigned = {
    schema: HOSTED_UNIT_RECEIPT_SCHEMA,
    planSha256: plan.planSha256,
    unitId,
    caseId: resolved.caseId,
    stage: resolved.unit.stage,
    needsKey: resolved.unit.needsKey,
    jobStatus,
    admissionSha256: admission.admissionSha256,
    workKeySha256: admission.workKeySha256,
    evidence,
    caseResults,
    successReceipt,
  };
  const receipt = { ...unsigned, receiptSha256: unitReceiptHash(unsigned) };
  verifyHostedUnitReceipt(receipt);
  writeNewJson(paths.receipt, receipt);
  return { receipt, paths };
}

export function loadHostedReceiptDirectory(receiptDir) {
  receiptDir = path.resolve(receiptDir);
  if (!existsSync(receiptDir) || lstatSync(receiptDir).isSymbolicLink())
    throw new Error('Hosted receipt artifact directory is missing or unsafe');
  const admissions = [];
  const receipts = [];
  const ledgers = [];
  for (const entry of readdirSync(receiptDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const control = HOSTED_CONTROL_FILE.exec(entry.name);
    if (!control) continue;
    const file = path.join(receiptDir, entry.name);
    if (control[2] === 'admission')
      admissions.push(verifyAdmission(JSON.parse(readFileSync(file, 'utf8'))));
    else if (control[2] === 'receipt')
      receipts.push(
        verifyHostedUnitReceipt(JSON.parse(readFileSync(file, 'utf8')))
      );
    else if (control[2] === 'ledger')
      ledgers.push(parseRunScopedLedger(readFileSync(file, 'utf8')));
  }
  return { admissions, receipts, ledgers };
}

function assertPlannedHostedIdentity(plan, unit, caseId, identity) {
  const expectedScope = planScope(plan);
  const actualScope = {
    run: identity.run,
    candidate: identity.candidate,
    planSha256: identity.planSha256,
  };
  const expectedUnit = {
    id: `${unit.id}.${caseId}`,
    definitionSha256: jsonSha256(unit),
    testInventorySha256: plan.testInventory.inventorySha256,
    caseInventorySha256: jsonSha256({
      selectedCase: caseId,
      cases: unit.cases,
      assignmentSha256: jsonSha256(selectedCaseAssignment(unit, caseId)),
      lanes: laneInventory(plan, unit, caseId),
    }),
  };
  const expectedCommand = {
    executable: 'github-workflow-job',
    args: [unit.workflow, unit.job, caseId, ...unit.testLanes],
    cwd: '.',
  };
  const expectedSetupSha256 = jsonSha256({
    workflow: unit.workflow,
    job: unit.job,
    caseId,
    planSha256: plan.planSha256,
    workflowSha256: unit.workflowSha256,
    testInventorySha256: plan.testInventory.inventorySha256,
    assignmentSha256: jsonSha256(selectedCaseAssignment(unit, caseId)),
    configSha256: identity.setup.configSha256,
  });
  if (
    jsonSha256(actualScope) !== jsonSha256(expectedScope) ||
    jsonSha256(identity.unit) !== jsonSha256(expectedUnit) ||
    jsonSha256({
      executable: identity.command.executable,
      args: identity.command.args,
      cwd: identity.command.cwd,
    }) !== jsonSha256(expectedCommand) ||
    identity.dependencies.lockSha256 !== plan.candidate.lockSha256 ||
    identity.setup.setupSha256 !== expectedSetupSha256 ||
    identity.setup.fixturesSha256 !== plan.candidate.sourceSha256 ||
    identity.workflow.workflowSha256 !== unit.workflowSha256 ||
    identity.toolchain.toolsSha256 !==
      jsonSha256({
        workflowSha256: unit.workflowSha256,
        actionPinsSha256: identity.workflow.actionsSha256,
      })
  )
    throw new Error(
      `Hosted work identity does not match planned unit/case: ${unit.id}/${caseId}`
    );
}

function artifactKey(value) {
  return `${value.unitId}::${value.caseId}`;
}

function exactArtifactMap(values, expectedKeys, label) {
  const entries = values.map((value) => [artifactKey(value), value]);
  const keys = entries.map(([key]) => key);
  if (
    keys.length !== expectedKeys.length ||
    new Set(keys).size !== keys.length ||
    expectedKeys.some((key) => !keys.includes(key)) ||
    keys.some((key) => !expectedKeys.includes(key))
  )
    throw new Error(
      `Hosted ${label} set does not close the planned unit cases`
    );
  return new Map(entries);
}

function reconcileShardedLaneCoverage(plan, expectedCases, receiptMap) {
  const summaries = [];
  for (const inventoryLane of plan.testInventory.lanes) {
    const cases = expectedCases.filter(({ unit, caseId }) =>
      selectedCaseAssignment(unit, caseId).lanes.some(
        (lane) => lane.id === inventoryLane.id && lane.mode === 'shard'
      )
    );
    if (cases.length === 0) continue;
    const actualFiles = [];
    let active = 0;
    for (const { key, caseId } of cases) {
      const actual = receiptMap
        .get(key)
        ?.caseResults?.lanes?.find((lane) => lane.id === inventoryLane.id);
      if (!actual || !Array.isArray(actual.files))
        throw new Error(
          `Hosted sharded result is missing: ${inventoryLane.id}/${caseId}`
        );
      actualFiles.push(...actual.files);
      if (Number.isSafeInteger(actual.active)) active += actual.active;
    }
    const expectedFiles = [...inventoryLane.files].toSorted();
    const observedFiles = [...actualFiles].toSorted();
    if (
      actualFiles.length !== expectedFiles.length ||
      new Set(actualFiles).size !== actualFiles.length ||
      jsonSha256(observedFiles) !== jsonSha256(expectedFiles)
    )
      throw new Error(
        `Hosted ${inventoryLane.id} shards do not close the full lane exactly once`
      );
    if (active < 1)
      throw new Error(
        `Hosted ${inventoryLane.id} shards contain no active tests in aggregate`
      );
    summaries.push({
      id: inventoryLane.id,
      cases: cases.length,
      files: actualFiles.length,
      active,
      status: 'passed',
    });
  }
  return summaries;
}

export function reconcileHostedGithubExecution(plan, needs, evidence) {
  const native = reconcileHostedGithubNeeds(plan, needs);
  plainObject(evidence, 'hosted receipt evidence');
  if (
    !Array.isArray(evidence.admissions) ||
    !Array.isArray(evidence.receipts) ||
    !Array.isArray(evidence.ledgers)
  )
    throw new Error('Hosted admissions, receipts, and ledgers are required');
  const admissions = evidence.admissions.map((admission) =>
    verifyAdmission(admission)
  );
  const receipts = evidence.receipts.map(verifyHostedUnitReceipt);
  const ledgers = evidence.ledgers.map(verifyRunScopedLedger);
  const expectedCases = plan.units.flatMap((unit) =>
    unit.applicable
      ? unit.cases.map((caseId) => ({
          key: `${unit.id}::${caseId}`,
          unit,
          caseId,
        }))
      : []
  );
  const expectedKeys = expectedCases.map((entry) => entry.key);
  const admissionMap = exactArtifactMap(admissions, expectedKeys, 'admission');
  const receiptMap = exactArtifactMap(receipts, expectedKeys, 'receipt');
  if (ledgers.length !== expectedCases.length)
    throw new Error(
      'Every applicable hosted unit case requires one run ledger'
    );
  if (ledgers.some((ledger) => ledger.entries.length !== 1))
    throw new Error(
      'Each hosted unit/case requires one single-success-entry ledger'
    );
  const ledgersByWorkKey = new Map();
  for (const ledger of ledgers) {
    const key = ledger.entries[0].workKeySha256;
    if (ledgersByWorkKey.has(key))
      throw new Error('Hosted unit/case ledgers contain a duplicate work key');
    ledgersByWorkKey.set(key, ledger);
  }

  for (const { key, unit, caseId } of expectedCases) {
    const admission = verifyAdmission(admissionMap.get(key), undefined, {
      unitId: unit.id,
      caseId,
    });
    const receipt = receiptMap.get(key);
    const success = receipt.successReceipt;
    const ledger = ledgersByWorkKey.get(admission.workKeySha256);
    assertPlannedHostedIdentity(plan, unit, caseId, admission.identity);
    if (
      receipt.planSha256 !== plan.planSha256 ||
      receipt.stage !== unit.stage ||
      receipt.needsKey !== unit.needsKey ||
      receipt.jobStatus !== 'success' ||
      receipt.admissionSha256 !== admission.admissionSha256 ||
      receipt.workKeySha256 !== admission.workKeySha256 ||
      !success ||
      !ledger
    )
      throw new Error(`Hosted unit receipt failed binding: ${key}`);
    verifyHostedCaseResults(
      plan,
      unit,
      caseId,
      receipt.caseResults,
      receipt.evidence
    );
    verifySuccessReceipt(success, admission.identity);
    if (
      success.evidence.resultSha256 !==
        jsonSha256({ unitId: unit.id, caseId, jobStatus: 'success' }) ||
      success.evidence.stdoutSha256 !== sha256('') ||
      success.evidence.stderrSha256 !== sha256('') ||
      success.evidence.artifactManifestSha256 !==
        jsonSha256(receipt.evidence) ||
      success.evidence.caseResultsSha256 !==
        jsonSha256({
          caseResults: receipt.caseResults,
          evidence: receipt.evidence,
        })
    )
      throw new Error(`Hosted success evidence failed binding: ${key}`);
    if (
      ledger.entries[0].receiptSha256 !== success.receiptSha256 ||
      verifySuccessReceipt(ledger.entries[0], admission.identity)
        .receiptSha256 !== success.receiptSha256
    )
      throw new Error(`Hosted run ledger failed binding: ${key}`);
  }

  const merged = mergeRunScopedLedgers(ledgers);
  if (merged.entries.length !== expectedCases.length)
    throw new Error('Hosted run ledgers do not close every planned unit case');
  const shardedLanes = reconcileShardedLaneCoverage(
    plan,
    expectedCases,
    receiptMap
  );
  return Object.freeze({
    ...native,
    scope: 'engine-bound-native-jobs',
    receipts: {
      expected: expectedCases.length,
      succeeded: receipts.length,
      ledgerEntries: merged.entries.length,
      ledgerSha256: merged.ledgerSha256,
    },
    shardedLanes,
    resultReuse: false,
  });
}

export function materializeHostedVitestLane({
  root,
  plan,
  expectedPlanSha256,
  unitId,
  caseId,
  receiptDir,
  outputFile,
  environment = process.env,
}) {
  if (plan.planSha256 !== expectedPlanSha256)
    throw new Error(
      'Hosted Vitest materialization expected-plan hash mismatch'
    );
  verifyHostedGithubPlanContext(root, plan, { environment });
  const resolved = resolveUnitCase(plan, unitId, caseId);
  const lane = selectedLane(plan, resolved.unit, resolved.caseId, 'vitest');
  const identity = createHostedWorkIdentity({
    root,
    plan,
    unitId,
    caseId: resolved.caseId,
    environment,
  });
  const paths = receiptPaths(receiptDir, unitId, resolved.caseId);
  regularFile(paths.admission, 'hosted admission');
  regularFile(paths.ledger, 'hosted run ledger');
  verifyAdmission(JSON.parse(readFileSync(paths.admission, 'utf8')), identity, {
    unitId,
    caseId: resolved.caseId,
  });
  const ledger = parseRunScopedLedger(readFileSync(paths.ledger, 'utf8'));
  if (ledger.entries.length !== 0 || existsSync(paths.receipt))
    throw new Error(
      'Hosted Vitest configuration cannot be created after finalization'
    );
  const capacity = detectWorkerCapacity({ sourceRoot: root, environment });
  if (
    capacity.githubActions !== true ||
    capacity.configuredWorkers !== capacity.effectiveLogicalCpus
  )
    throw new Error('GitHub Vitest shard must use exactly N effective workers');
  const runnerTemp = environment.RUNNER_TEMP;
  if (typeof runnerTemp !== 'string' || !path.isAbsolute(runnerTemp))
    throw new Error('Hosted Vitest requires an absolute GitHub runner temp');
  const resolvedRunnerTemp = path.resolve(runnerTemp);
  if (
    !existsSync(resolvedRunnerTemp) ||
    lstatSync(resolvedRunnerTemp).isSymbolicLink() ||
    !lstatSync(resolvedRunnerTemp).isDirectory()
  )
    throw new Error('Hosted Vitest runner temp is unsafe');
  outputFile = path.resolve(outputFile);
  const expectedOutput = path.join(
    resolvedRunnerTemp,
    'seerrng-engine-vitest.config.mts'
  );
  if (outputFile !== expectedOutput)
    throw new Error('Hosted Vitest config must use its exact runner-temp path');
  const sourceConfig = path.resolve(root, 'vitest.config.mts');
  regularFile(sourceConfig, 'repository Vitest config');
  const source = vitestConfigSource(
    sourceConfig,
    path.resolve(root),
    lane.files,
    capacity.configuredWorkers,
    path.join(resolvedRunnerTemp, 'seerrng-engine-vitest-cache')
  );
  writeFileSync(outputFile, source, { flag: 'wx', mode: 0o600 });
  return {
    schema: 'seerrng-hosted-vitest-materialization/v1',
    planSha256: plan.planSha256,
    unitId,
    caseId: resolved.caseId,
    laneId: lane.id,
    files: [...lane.files],
    filesSha256: lane.filesSha256,
    configuredWorkers: capacity.configuredWorkers,
    configSha256: sha256(Buffer.from(source)),
  };
}

export async function executeHostedTestLane({
  root,
  plan,
  expectedPlanSha256,
  unitId,
  caseId,
  laneId,
  receiptDir,
  reportFile,
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (plan.planSha256 !== expectedPlanSha256)
    throw new Error('Hosted test-lane expected-plan hash mismatch');
  verifyHostedGithubPlanContext(root, plan, { environment });
  const resolved = resolveUnitCase(plan, unitId, caseId);
  if (!resolved.unit.testLanes.includes(laneId))
    throw new Error(
      `Hosted test lane is not assigned to ${unitId}/${resolved.caseId}`
    );
  const lane = selectedLane(plan, resolved.unit, resolved.caseId, laneId);
  if (laneId !== 'node-test-mjs')
    throw new Error(
      'Only the missing native Node lane is engine-executed here'
    );
  const identity = createHostedWorkIdentity({
    root,
    plan,
    unitId,
    caseId: resolved.caseId,
    environment,
  });
  const paths = receiptPaths(receiptDir, unitId, resolved.caseId);
  regularFile(paths.admission, 'hosted admission');
  regularFile(paths.ledger, 'hosted run ledger');
  const admission = verifyAdmission(
    JSON.parse(readFileSync(paths.admission, 'utf8')),
    identity,
    { unitId, caseId: resolved.caseId }
  );
  const ledger = parseRunScopedLedger(readFileSync(paths.ledger, 'utf8'));
  if (ledger.entries.length !== 0 || existsSync(paths.receipt))
    throw new Error(
      'Hosted test lane cannot launch after its unit/case is finalized'
    );
  const capacity = detectWorkerCapacity({ sourceRoot: root, environment });
  if (
    capacity.githubActions !== true ||
    capacity.configuredWorkers !== capacity.effectiveLogicalCpus
  )
    throw new Error('GitHub test lane must use exactly N effective workers');
  const expectedCommand = {
    program: 'node',
    args: [
      '--test',
      '--test-isolation=none',
      '--test-concurrency=1',
      '--test-reporter=tap',
      '<file>',
    ],
    pool: {
      partition: 'one-file-per-process',
      maxWorkers: '<workers>',
    },
  };
  if (jsonSha256(lane.command) !== jsonSha256(expectedCommand))
    throw new Error('Hosted native Node lane command is not canonical');
  const laneEnvironment = { ...environment };
  // Regression tests invoke this entry from node:test. The hosted workflow does
  // not, and must not inherit Node's private nested-run marker.
  delete laneEnvironment.NODE_TEST_CONTEXT;
  const outcomes = new Array(lane.files.length);
  let nextFile = 0;
  const runFile = async (file) => {
    let directory;
    let receipt;
    let executionError;
    let fileLedger;
    try {
      directory = mkdtempSync(path.join(tmpdir(), 'seerrng-local-validation-'));
      const args = lane.command.args.map((argument) =>
        argument === '<file>' ? file : argument
      );
      stdout.write(`\n[Hosted native Node test: ${file}]\n`);
      try {
        receipt = await runCommand(
          {
            id: `${lane.id}:${file}`,
            name: `Hosted native Node test: ${file}`,
            command: process.execPath,
            args,
          },
          {
            root,
            env: isolatedEnvironment(directory, laneEnvironment),
            stdout,
            stderr,
            receipt: true,
            maxCaptureBytes: 64 * 1024 * 1024,
          }
        );
      } catch (error) {
        executionError = error;
        receipt = error.receipt;
      }
      if (receipt && !receipt.stdoutTruncated && !receipt.stderrTruncated)
        fileLedger = readNodeTapHierarchy(Buffer.from(receipt.stdout), file, {
          sourceEntries: [
            {
              // Node reports a source-only wrapper using the platform-native
              // command path (including escaped Windows separators). Bind that
              // wrapper to the exact planned file so it cannot masquerade as a
              // discovered test case.
              name: path.normalize(file),
              absoluteFile: path.resolve(root, file),
            },
          ],
        });
    } catch (error) {
      executionError ??= error;
    }
    let cleanupError;
    if (directory && executionError?.preserveTemporary !== true)
      try {
        removeOwnedTemporaryDirectory(directory);
      } catch (error) {
        cleanupError = error;
      }
    else if (directory)
      stderr.write(
        `Temporary validation files retained because child cleanup is uncertain: ${directory}\n`
      );
    const syntheticEmptyFile =
      fileLedger?.issues.includes(
        'Native source wrapper has no discovered cases'
      ) === true;
    const complete =
      !cleanupError &&
      receipt?.status === 'passed' &&
      receipt.lifecycle?.completed === true &&
      receipt.lifecycle?.cleanupVerified === true &&
      receipt.aborted === false &&
      receipt.timedOut === false &&
      receipt.signal === null &&
      receipt.spawnError === null &&
      receipt.stdoutTruncated === false &&
      receipt.stderrTruncated === false &&
      fileLedger?.complete === true &&
      fileLedger.issues.length === 0 &&
      fileLedger.cases.length > 0 &&
      !syntheticEmptyFile &&
      fileLedger.cases.every((entry) => entry.file === file) &&
      fileLedger.counts.failed === 0;
    return {
      file,
      receipt,
      ledger: fileLedger,
      error: cleanupError ?? executionError ?? null,
      syntheticEmptyFile,
      complete,
    };
  };
  const pool = Array.from(
    {
      length: Math.min(capacity.configuredWorkers, lane.files.length),
    },
    async () => {
      while (nextFile < lane.files.length) {
        const index = nextFile++;
        outcomes[index] = await runFile(lane.files[index]);
      }
    }
  );
  await Promise.all(pool);
  const incomplete = outcomes.filter((outcome) => !outcome?.complete);
  if (incomplete.length) {
    const detail = incomplete
      .map((outcome) => {
        const reasons = [
          outcome?.receipt?.status,
          ...(outcome?.ledger?.issues ?? []),
          outcome?.error?.message,
          outcome?.receipt?.stdoutTruncated || outcome?.receipt?.stderrTruncated
            ? 'output truncated'
            : null,
          !outcome?.ledger?.cases?.length || outcome?.syntheticEmptyFile
            ? 'no observed registered test cases'
            : null,
        ].filter(Boolean);
        return `${outcome?.file ?? '(unknown file)'}: ${reasons.join(', ') || 'incomplete'}`;
      })
      .join('; ');
    const error = new Error(
      `Hosted native Node per-file closure failed: ${detail}`
    );
    error.preserveTemporary = incomplete.some(
      (outcome) => outcome?.error?.preserveTemporary === true
    );
    throw error;
  }
  const reports = outcomes.map(({ file, receipt, ledger: fileLedger }) => ({
    file,
    reportSha256: fileLedger.reportSha256,
    rawBytes: fileLedger.rawBytes,
    tests: fileLedger.cases.length,
    active: fileLedger.counts.passed + fileLedger.counts.failed,
    passed: fileLedger.counts.passed,
    skipped: fileLedger.counts.skipped,
    wallMs: receipt.wallMs,
  }));
  const sum = (select) =>
    outcomes.reduce((total, outcome) => total + select(outcome.ledger), 0);
  const caseLedger = {
    format: 'node-tap13-per-file-v1',
    nativeRunner: 'node:test-per-file',
    files: reports.map(({ file }) => file),
    reports,
    reportSha256: jsonSha256(reports),
    rawBytes: sum((entry) => entry.rawBytes),
    cases: outcomes.flatMap(({ ledger: entry }) => entry.cases),
    nodes: outcomes.flatMap(({ ledger: entry }) => entry.nodes),
    roots: outcomes.flatMap(({ ledger: entry }) => entry.roots),
    counts: {
      passed: sum((entry) => entry.counts.passed),
      failed: sum((entry) => entry.counts.failed),
      skipped: sum((entry) => entry.counts.skipped),
    },
    summaries: {
      tests: sum((entry) => entry.summaries.tests),
      suites: sum((entry) => entry.summaries.suites),
      pass: sum((entry) => entry.summaries.pass),
      fail: sum((entry) => entry.summaries.fail),
      cancelled: sum((entry) => entry.summaries.cancelled),
      skipped: sum((entry) => entry.summaries.skipped),
      todo: sum((entry) => entry.summaries.todo),
    },
    issues: [],
    complete: true,
  };
  const counts = {
    total: caseLedger.cases.length,
    active: caseLedger.counts.passed + caseLedger.counts.failed,
  };
  if (counts.total < lane.files.length || counts.active < 1)
    throw new Error('Hosted native Node result closure is incomplete');
  const result = {
    schema: HOSTED_TEST_LANE_RESULT_SCHEMA,
    planSha256: plan.planSha256,
    unitId,
    caseId: resolved.caseId,
    admissionSha256: admission.admissionSha256,
    workKeySha256: admission.workKeySha256,
    inventorySha256: plan.testInventory.inventorySha256,
    laneId,
    files: lane.files,
    capacity,
    counts,
    caseLedger,
    status: 'passed',
  };
  reportFile = path.resolve(reportFile);
  writeFileSync(reportFile, `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return result;
}
