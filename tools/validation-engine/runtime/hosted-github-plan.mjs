// Copyright (c) snapetech and SeerrNG contributors.
// Pure GitHub plan/reconciliation data. The engine owns the logical DAG while
// the bound workflows preserve each native executor and runner environment.
import { createHash } from 'node:crypto';
import { assertHostedTestInventory } from './hosted-test-inventory.mjs';
import {
  assertHostedSchedulingPlan,
  createHostedCaseAssignments,
  createHostedSchedulingPolicy,
  HOSTED_CYPRESS_CASES,
  HOSTED_UNIT_CASES,
} from './hosted-test-sharding.mjs';

const PLAN_SCHEMA = 'seerrng-hosted-github-plan/v6';
const RECONCILIATION_SCHEMA = 'seerrng-hosted-github-reconciliation/v2';
const HASH40 = /^[a-f0-9]{40}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const EVENTS = new Set(['pull_request', 'push']);
const PATH_FILTER_MODES = new Set([
  'changed-files',
  'run-all-large-update',
  'run-all-new-branch',
]);
const STAGES = ['repository', 'codeql', 'build', 'browser'];
const WORKFLOW_KEYS = [
  'ci',
  'codeql',
  'cypress',
  'testDocs',
  'docsLinks',
  'helm',
];
const PLAN_KEYS = [
  'candidate',
  'changedFiles',
  'event',
  'externalMetadata',
  'planSha256',
  'resultReuse',
  'scheduling',
  'schema',
  'testInventory',
  'units',
  'workflowHashes',
];
const EXTERNAL_PR_METADATA = [
  {
    id: 'github-pr-title',
    authority: 'trusted pull_request_target workflow metadata',
    status: 'external-not-reconciled',
  },
  {
    id: 'github-pr-template',
    authority: 'trusted pull_request_target workflow metadata',
    status: 'external-not-reconciled',
  },
  {
    id: 'github-merge-conflict-state',
    authority: 'GitHub live mergeability metadata',
    status: 'external-not-reconciled',
  },
];
const RESULT_REUSE = false;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function githubChangedFilesRange(eventName, baseSha, headSha) {
  if (!HASH40.test(baseSha ?? '') || !HASH40.test(headSha ?? ''))
    throw new Error('Exact GitHub diff endpoints are required');
  if (eventName === 'pull_request') return `${baseSha}...${headSha}`;
  if (eventName === 'push') return `${baseSha}..${headSha}`;
  throw new Error('Changed-file diff supports pull_request and push only');
}

function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Plan values must be JSON data');
  return encoded;
}

function planHash(plan) {
  const unsigned = structuredClone(plan);
  delete unsigned.planSha256;
  return sha256(canonicalJson(unsigned));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

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

function string(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new Error(`Exact ${label} is required`);
  return value;
}

function candidateIdentity(candidate) {
  plainObject(candidate, 'candidate');
  const identity = {
    repository: string(candidate.repository, 'candidate repository'),
    commit: candidate.commit,
    tree: candidate.tree,
    lockSha256: candidate.lockSha256,
    sourceSha256: candidate.sourceSha256,
  };
  if (!/^[^/\s]+\/[^/\s]+$/.test(identity.repository))
    throw new Error('Candidate repository must include owner and name');
  if (!HASH40.test(identity.commit ?? '') || !HASH40.test(identity.tree ?? ''))
    throw new Error('Exact candidate commit and tree are required');
  if (
    !HASH64.test(identity.lockSha256 ?? '') ||
    !HASH64.test(identity.sourceSha256 ?? '')
  )
    throw new Error('Exact candidate lock and source hashes are required');
  return identity;
}

function eventIdentity(event, candidate) {
  plainObject(event, 'event metadata');
  const identity = {
    name: event.name,
    runId: String(event.runId ?? ''),
    runAttempt: String(event.runAttempt ?? ''),
    executionSha: event.executionSha,
    headSha: event.headSha,
    baseSha: event.baseSha,
    ref: event.ref ?? null,
    baseRef: event.baseRef ?? null,
    actorType: event.actorType ?? null,
    pathFilterMode: event.pathFilterMode,
  };
  if (!EVENTS.has(identity.name)) throw new Error('Unsupported GitHub event');
  if (
    !POSITIVE_DECIMAL.test(identity.runId) ||
    !POSITIVE_DECIMAL.test(identity.runAttempt)
  )
    throw new Error('Exact GitHub run ID and attempt are required');
  if (
    !HASH40.test(identity.executionSha ?? '') ||
    !HASH40.test(identity.headSha ?? '') ||
    !HASH40.test(identity.baseSha ?? '') ||
    identity.executionSha !== candidate.commit
  )
    throw new Error('GitHub execution identity must bind the candidate');
  if (identity.ref !== null) string(identity.ref, 'GitHub ref');
  if (identity.baseRef !== null) string(identity.baseRef, 'GitHub base ref');
  if (identity.actorType !== null) string(identity.actorType, 'actor type');
  if (!PATH_FILTER_MODES.has(identity.pathFilterMode))
    throw new Error('Exact GitHub path-filter mode is required');
  if (identity.name === 'pull_request') {
    string(identity.baseRef, 'pull-request base ref');
    if (!['User', 'Bot'].includes(identity.actorType))
      throw new Error('Pull-request actor type must be User or Bot');
    if (
      !['changed-files', 'run-all-large-update'].includes(
        identity.pathFilterMode
      )
    )
      throw new Error('Pull requests require a valid changed-file mode');
  } else {
    string(identity.ref, 'GitHub ref');
    if (
      identity.pathFilterMode === 'run-all-new-branch' &&
      !/^0{40}$/.test(identity.baseSha)
    )
      throw new Error('New-branch path fallback requires a zero base SHA');
    if (
      identity.pathFilterMode !== 'run-all-new-branch' &&
      /^0{40}$/.test(identity.baseSha)
    )
      throw new Error('Zero-base pushes require the new-branch path fallback');
  }
  if (identity.name === 'push' && identity.headSha !== identity.executionSha)
    throw new Error('Push head and execution identities must match');
  return identity;
}

function sourcePath(value) {
  string(value, 'changed source path');
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Source paths are serialized into a plan.
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Changed files require normalized source-relative paths');
  return value;
}

function changedFileList(changedFiles) {
  if (!Array.isArray(changedFiles))
    throw new Error('Complete changed files must be an explicit array');
  const normalized = changedFiles.map(sourcePath);
  if (new Set(normalized).size !== normalized.length)
    throw new Error('Duplicate changed file');
  return normalized.toSorted();
}

function workflowIdentity(workflowHashes) {
  plainObject(workflowHashes, 'workflow hashes');
  const supplied = Object.keys(workflowHashes).toSorted();
  if (
    supplied.length !== WORKFLOW_KEYS.length ||
    supplied.some((key, index) => key !== [...WORKFLOW_KEYS].sort()[index])
  )
    throw new Error('Exact hosted workflow hash set is required');
  return Object.fromEntries(
    WORKFLOW_KEYS.map((key) => {
      if (!HASH64.test(workflowHashes[key] ?? ''))
        throw new Error(`Invalid ${key} workflow hash`);
      return [key, workflowHashes[key]];
    })
  );
}

const under = (file, directory) => file.startsWith(`${directory}/`);
const exactOrUnder = (file, exact, directories) =>
  exact.includes(file) ||
  directories.some((directory) => under(file, directory));
const anyChanged = (changedFiles, predicate) => changedFiles.some(predicate);
const isMainPush = (event) =>
  event.name === 'push' && event.ref === 'refs/heads/main';
const isMainPullRequest = (event) =>
  event.name === 'pull_request' && event.baseRef === 'main';
const isWildcardPullRequest = (event) =>
  event.name === 'pull_request' && !event.baseRef.includes('/');

function codeqlPath(file) {
  return (
    (!file.endsWith('.md') && !under(file, 'docs')) ||
    exactOrUnder(
      file,
      ['vitest.config.mts', 'package.json', 'pnpm-lock.yaml'],
      ['tools/validation-engine', 'bin', 'server/test']
    )
  );
}

function cypressPath(file) {
  return exactOrUnder(
    file,
    [
      'scripts/export-external-config.mjs',
      'cypress.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'next.config.ts',
      'tsconfig.json',
      '.github/workflows/ci.yml',
      '.github/workflows/cypress.yml',
      'vitest.config.mts',
    ],
    ['src', 'server', 'config', 'cypress', 'tools/validation-engine', 'bin']
  );
}

function playwrightPath(file) {
  return exactOrUnder(
    file,
    [
      'playwright.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'next.config.ts',
      'tsconfig.json',
      '.github/workflows/ci.yml',
    ],
    ['src', 'server', 'config', 'playwright', 'tools/validation-engine', 'bin']
  );
}

function docsPath(file, workflow) {
  return exactOrUnder(
    file,
    [
      workflow,
      '.github/workflows/ci.yml',
      'vitest.config.mts',
      'package.json',
      'pnpm-lock.yaml',
    ],
    ['docs', 'gen-docs', 'tools/validation-engine', 'bin', 'server/test']
  );
}

function helmPath(file) {
  return (
    file === '.github/workflows/ci.yml' ||
    file === '.github/workflows/lint-helm-charts.yml' ||
    under(file, 'charts')
  );
}

function applicability(event, changedFiles) {
  const pullRequest = isWildcardPullRequest(event);
  const mainPush = isMainPush(event);
  const ci = pullRequest || mainPush;
  const runAllPaths = event.pathFilterMode !== 'changed-files';
  return {
    ci,
    releaseNotes: mainPush || (pullRequest && event.actorType !== 'Bot'),
    codeql:
      (isMainPullRequest(event) || mainPush) &&
      (runAllPaths || anyChanged(changedFiles, codeqlPath)),
    cypress:
      (pullRequest || mainPush) &&
      (runAllPaths || anyChanged(changedFiles, cypressPath)),
    playwright:
      (pullRequest || mainPush) &&
      (runAllPaths || anyChanged(changedFiles, playwrightPath)),
    testDocs:
      (isMainPullRequest(event) || mainPush) &&
      (runAllPaths ||
        anyChanged(changedFiles, (file) =>
          docsPath(file, '.github/workflows/test-docs.yml')
        )),
    docsLinks:
      (pullRequest || mainPush) &&
      (runAllPaths ||
        anyChanged(changedFiles, (file) =>
          docsPath(file, '.github/workflows/docs-link-check.yml')
        )),
    helm:
      (isMainPullRequest(event) || mainPush) &&
      (runAllPaths || anyChanged(changedFiles, helmPath)),
  };
}

function unit({
  id,
  needsKey,
  workflow,
  workflowSha256,
  job,
  stage,
  cases = ['default'],
  testLanes = [],
  dependsOn,
  applicable,
  reason,
}) {
  return {
    id,
    needsKey,
    workflow,
    workflowSha256,
    job,
    stage,
    cases,
    testLanes,
    required: true,
    applicable,
    applicability: {
      expectedResult: applicable ? 'success' : 'skipped',
      reason,
    },
    dependsOn,
  };
}

function validationUnits(event, changedFiles, workflowHashes, testInventory) {
  const applies = applicability(event, changedFiles);
  const units = [
    unit({
      id: 'ci-release-notes',
      needsKey: 'release-notes',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'release-notes',
      stage: 'repository',
      dependsOn: ['engine-plan'],
      applicable: applies.releaseNotes,
      reason: 'CI job: push, or non-Bot pull request',
    }),
    unit({
      id: 'ci-i18n',
      needsKey: 'i18n',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'i18n',
      stage: 'repository',
      testLanes: ['tooling'],
      dependsOn: ['engine-plan'],
      applicable: applies.ci,
      reason: 'CI job: pull request or push to main',
    }),
    unit({
      id: 'ci-unit-test',
      needsKey: 'unit-test',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'unit-test',
      stage: 'repository',
      cases: [...HOSTED_UNIT_CASES],
      testLanes: ['vitest', 'node-test-mjs'],
      dependsOn: ['engine-plan'],
      applicable: applies.ci,
      reason: 'CI job: pull request or push to main',
    }),
    unit({
      id: 'docs-links',
      needsKey: 'docs-links',
      workflow: 'docsLinks',
      workflowSha256: workflowHashes.docsLinks,
      job: 'link-check',
      stage: 'repository',
      dependsOn: ['engine-plan'],
      applicable: applies.docsLinks,
      reason: 'Docs links event, branch and path filters',
    }),
    unit({
      id: 'codeql-analyze',
      needsKey: 'codeql',
      workflow: 'codeql',
      workflowSha256: workflowHashes.codeql,
      job: 'analyze',
      stage: 'codeql',
      cases: ['actions', 'javascript'],
      dependsOn: ['engine-plan'],
      applicable: applies.codeql,
      reason: 'CodeQL event, branch and ordered path filters',
    }),
    unit({
      id: 'ci-jellyfin-plugin',
      needsKey: 'jellyfin-plugin',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'jellyfin-plugin',
      stage: 'build',
      dependsOn: ['engine-plan'],
      applicable: applies.ci,
      reason: 'CI job: pull request or push to main',
    }),
    unit({
      id: 'ci-test',
      needsKey: 'test',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'test',
      stage: 'build',
      dependsOn: ['engine-plan'],
      applicable: applies.ci,
      reason: 'CI job: pull request or push to main',
    }),
    unit({
      id: 'test-docs-build',
      needsKey: 'test-docs',
      workflow: 'testDocs',
      workflowSha256: workflowHashes.testDocs,
      job: 'test-build',
      stage: 'build',
      testLanes: ['docs-security'],
      dependsOn: ['engine-plan'],
      applicable: applies.testDocs,
      reason: 'Test Docs main-branch and path filters',
    }),
    unit({
      id: 'helm-lint-test',
      needsKey: 'helm',
      workflow: 'helm',
      workflowSha256: workflowHashes.helm,
      job: 'lint-test',
      stage: 'build',
      dependsOn: ['engine-plan'],
      applicable: applies.helm,
      reason: 'Helm lint main-branch and chart path filters',
    }),
    unit({
      id: 'ci-playwright',
      needsKey: 'playwright',
      workflow: 'ci',
      workflowSha256: workflowHashes.ci,
      job: 'playwright',
      stage: 'browser',
      testLanes: ['playwright'],
      dependsOn: ['engine-plan'],
      applicable: applies.playwright,
      reason: 'Playwright event, branch and path filters',
    }),
    unit({
      id: 'cypress-run',
      needsKey: 'cypress',
      workflow: 'cypress',
      workflowSha256: workflowHashes.cypress,
      job: 'cypress-run',
      stage: 'browser',
      cases: [...HOSTED_CYPRESS_CASES],
      testLanes: ['cypress'],
      dependsOn: ['engine-plan'],
      applicable: applies.cypress,
      reason: 'Cypress event, branch and path filters',
    }),
  ];
  return units.map((entry) => ({
    ...entry,
    caseAssignments: createHostedCaseAssignments(entry, testInventory),
  }));
}

function assertPlan(plan) {
  plainObject(plan, 'hosted GitHub plan');
  if (
    Object.keys(plan)
      .toSorted()
      .some((key, index) => key !== PLAN_KEYS[index]) ||
    Object.keys(plan).length !== PLAN_KEYS.length
  )
    throw new Error('Exact hosted GitHub plan schema is required');
  if (plan.schema !== PLAN_SCHEMA || !HASH64.test(plan.planSha256 ?? ''))
    throw new Error('Hosted GitHub plan schema/hash is invalid');
  if (planHash(plan) !== plan.planSha256)
    throw new Error('Hosted GitHub plan hash does not match its contents');
  if (!Array.isArray(plan.units) || plan.units.length !== 11)
    throw new Error('Exact hosted validation unit set is required');
  const ids = new Set();
  const needsKeys = new Set();
  for (const entry of plan.units) {
    if (ids.has(entry.id) || needsKeys.has(entry.needsKey))
      throw new Error('Duplicate hosted validation unit binding');
    ids.add(entry.id);
    needsKeys.add(entry.needsKey);
    if (
      !STAGES.includes(entry.stage) ||
      entry.required !== true ||
      !HASH64.test(entry.workflowSha256 ?? '') ||
      !Array.isArray(entry.cases) ||
      entry.cases.length < 1 ||
      entry.cases.some(
        (value) =>
          typeof value !== 'string' ||
          !value ||
          value.trim() !== value ||
          !/^[a-z0-9][a-z0-9-]*$/.test(value)
      ) ||
      new Set(entry.cases).size !== entry.cases.length ||
      !Array.isArray(entry.testLanes) ||
      new Set(entry.testLanes).size !== entry.testLanes.length ||
      entry.testLanes.some(
        (value) =>
          typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(value)
      ) ||
      !Array.isArray(entry.dependsOn) ||
      entry.dependsOn.length < 1 ||
      new Set(entry.dependsOn).size !== entry.dependsOn.length ||
      entry.applicability?.expectedResult !==
        (entry.applicable ? 'success' : 'skipped')
    )
      throw new Error('Invalid hosted validation unit contract');
  }
  const candidate = candidateIdentity(plan.candidate);
  const event = eventIdentity(plan.event, candidate);
  const changedFiles = changedFileList(plan.changedFiles);
  const workflows = workflowIdentity(plan.workflowHashes);
  const testInventory = assertHostedTestInventory(plan.testInventory);
  const expectedScheduling = createHostedSchedulingPolicy();
  const expectedUnits = validationUnits(
    event,
    changedFiles,
    workflows,
    testInventory
  );
  assertHostedSchedulingPlan({
    units: plan.units,
    testInventory,
    scheduling: plan.scheduling,
  });
  const assignedTestLanes = plan.units.flatMap((entry) => entry.testLanes);
  const expectedTestLanes = testInventory.lanes.map((lane) => lane.id);
  if (
    assignedTestLanes.length !== expectedTestLanes.length ||
    new Set(assignedTestLanes).size !== expectedTestLanes.length ||
    expectedTestLanes.some((lane) => !assignedTestLanes.includes(lane))
  )
    throw new Error('Hosted units do not close the complete test inventory');
  for (const entry of plan.units)
    if (entry.dependsOn.length !== 1 || entry.dependsOn[0] !== 'engine-plan')
      throw new Error('Hosted units must fan out directly from engine-plan');
  const expectedMetadata =
    event.name === 'pull_request' ? EXTERNAL_PR_METADATA : [];
  if (
    canonicalJson(candidate) !== canonicalJson(plan.candidate) ||
    canonicalJson(event) !== canonicalJson(plan.event) ||
    canonicalJson(changedFiles) !== canonicalJson(plan.changedFiles) ||
    canonicalJson(workflows) !== canonicalJson(plan.workflowHashes) ||
    canonicalJson(testInventory) !== canonicalJson(plan.testInventory) ||
    canonicalJson(expectedScheduling) !== canonicalJson(plan.scheduling) ||
    canonicalJson(expectedUnits) !== canonicalJson(plan.units) ||
    canonicalJson(expectedMetadata) !== canonicalJson(plan.externalMetadata) ||
    plan.resultReuse !== RESULT_REUSE
  )
    throw new Error('Hosted GitHub plan does not match native workflow policy');
  return plan;
}

export function assertHostedGithubPlan(plan) {
  return assertPlan(plan);
}

export function createHostedGithubPlan({
  candidate,
  event,
  changedFiles,
  workflowHashes,
  testInventory,
}) {
  const boundCandidate = candidateIdentity(candidate);
  const boundEvent = eventIdentity(event, boundCandidate);
  const boundChangedFiles = changedFileList(changedFiles);
  const boundWorkflowHashes = workflowIdentity(workflowHashes);
  const boundTestInventory = assertHostedTestInventory(testInventory);
  const scheduling = createHostedSchedulingPolicy();
  const unsigned = {
    schema: PLAN_SCHEMA,
    candidate: boundCandidate,
    event: boundEvent,
    changedFiles: boundChangedFiles,
    workflowHashes: boundWorkflowHashes,
    testInventory: structuredClone(boundTestInventory),
    scheduling,
    units: validationUnits(
      boundEvent,
      boundChangedFiles,
      boundWorkflowHashes,
      boundTestInventory
    ),
    externalMetadata:
      boundEvent.name === 'pull_request'
        ? structuredClone(EXTERNAL_PR_METADATA)
        : [],
    resultReuse: RESULT_REUSE,
  };
  const plan = { ...unsigned, planSha256: planHash(unsigned) };
  assertPlan(plan);
  return freeze(plan);
}

function exactNeedsKeys(plan, needs) {
  const expected = [
    'engine-plan',
    ...plan.units.map((entry) => entry.needsKey),
  ];
  const actual = Object.keys(needs);
  const missing = expected.filter((key) => !Object.hasOwn(needs, key));
  const extra = actual.filter((key) => !expected.includes(key));
  if (missing.length || extra.length)
    throw new Error(
      `Hosted needs set mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`
    );
}

function assertPlanNeed(plan, receipt) {
  plainObject(receipt, 'engine-plan needs result');
  if (receipt.result !== 'success')
    throw new Error(`engine-plan did not succeed: ${receipt.result}`);
  const outputs = plainObject(receipt.outputs, 'engine-plan outputs');
  const expected = {
    planSha256: plan.planSha256,
    runId: plan.event.runId,
    runAttempt: plan.event.runAttempt,
    executionSha: plan.event.executionSha,
    headSha: plan.event.headSha,
  };
  for (const [key, value] of Object.entries(expected))
    if (outputs[key] !== value)
      throw new Error(`Stale or unbound engine-plan ${key}`);
}

export function reconcileHostedGithubNeeds(plan, needs) {
  assertPlan(plan);
  plainObject(needs, 'GitHub needs results');
  exactNeedsKeys(plan, needs);
  assertPlanNeed(plan, needs['engine-plan']);

  const stages = Object.fromEntries(
    STAGES.map((id) => [
      id,
      { id, expected: 0, applicable: 0, succeeded: 0, skipped: 0 },
    ])
  );
  let succeeded = 0;
  let skipped = 0;
  for (const entry of plan.units) {
    const receipt = plainObject(
      needs[entry.needsKey],
      `${entry.needsKey} needs result`
    );
    const expected = entry.applicable ? 'success' : 'skipped';
    if (receipt.result !== expected)
      throw new Error(
        `${entry.needsKey} expected ${expected}, received ${receipt.result}`
      );
    const stage = stages[entry.stage];
    stage.expected++;
    if (entry.applicable) {
      stage.applicable++;
      stage.succeeded++;
      succeeded++;
    } else {
      stage.skipped++;
      skipped++;
    }
  }
  const stageResults = STAGES.map((id) => ({
    ...stages[id],
    status: 'passed',
  }));
  return freeze({
    schema: RECONCILIATION_SCHEMA,
    scope: 'native-jobs',
    status: 'passed',
    ok: true,
    complete: plan.externalMetadata.length === 0,
    planSha256: plan.planSha256,
    run: {
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
      executionSha: plan.event.executionSha,
      headSha: plan.event.headSha,
    },
    jobs: {
      expected: plan.units.length,
      applicable: succeeded,
      succeeded,
      skipped,
    },
    stages: stageResults,
    externalMetadata: structuredClone(plan.externalMetadata),
    externalMetadataStatus:
      plan.externalMetadata.length === 0
        ? 'not-applicable'
        : 'external-not-reconciled',
    resultReuse: RESULT_REUSE,
  });
}
