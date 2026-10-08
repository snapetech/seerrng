// Copyright (c) snapetech and SeerrNG contributors.
import * as yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readWorkflow = (name) => {
  const text = readFileSync(
    path.join(root, '.github/workflows', `${name}.yml`),
    'utf8'
  ).replaceAll('\r\n', '\n');
  return { text, workflow: yaml.load(text) };
};
const stepNamed = (job, name) => job.steps.find((step) => step.name === name);
const needs = (job) =>
  new Set(Array.isArray(job.needs) ? job.needs : [job.needs]);
const filesUnder = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
const isProductionRuntimeSource = (file) =>
  /\.[cm]?[jt]sx?$/u.test(file) &&
  !/[\\/](?:test|tests|__tests__)[\\/]/u.test(file) &&
  !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);

const ci = readWorkflow('ci');
const nativeJobs = [
  'jellyfin-plugin',
  'release-notes',
  'i18n',
  'test',
  'unit-test',
  'playwright',
];
const reusableJobs = {
  codeql: 'codeql.yml',
  cypress: 'cypress.yml',
  'test-docs': 'test-docs.yml',
  'docs-links': 'docs-link-check.yml',
  helm: 'lint-helm-charts.yml',
};

test('the existing CI workflow invokes the engine plan and reconciler around native jobs', () => {
  const jobs = ci.workflow.jobs;
  assert.equal(
    jobs['engine-plan'].outputs.unitMatrix,
    '${{ steps.plan.outputs.unitMatrix }}'
  );
  assert.equal(
    jobs['engine-plan'].outputs.cypressMatrix,
    '${{ steps.plan.outputs.cypressMatrix }}'
  );
  assert.equal(
    jobs['engine-plan'].outputs.playwright,
    '${{ steps.plan.outputs.playwright }}'
  );
  assert.match(
    stepNamed(jobs['engine-plan'], 'Create current-run hosted validation plan')
      .run,
    /--github-plan[\s\S]*--plan-file/
  );
  const reconcile = stepNamed(
    jobs['engine-reconcile'],
    'Reconcile current-run hosted validation results'
  );
  assert.match(reconcile.run, /--github-reconcile/);
  assert.match(reconcile.run, /--plan-file/);
  assert.match(reconcile.run, /--receipt-dir/);
  assert.deepEqual(
    new Set(jobs['engine-reconcile'].needs),
    new Set(['engine-plan', ...nativeJobs, ...Object.keys(reusableJobs)])
  );
  assert.match(jobs['engine-reconcile'].if, /always\(\)/);
  assert.equal(
    reconcile.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256,
    '${{ needs.engine-plan.outputs.planSha256 }}'
  );
});

test('GitHub fans every independent validation job out from the engine plan', () => {
  const jobs = ci.workflow.jobs;
  for (const id of [...nativeJobs, ...Object.keys(reusableJobs)])
    assert.deepEqual(needs(jobs[id]), new Set(['engine-plan']), id);
  for (const [id, file] of Object.entries(reusableJobs)) {
    assert.equal(jobs[id].uses, `./.github/workflows/${file}`, id);
    assert.match(jobs[id].if, /needs\.engine-plan\.outputs\./, id);
  }
  assert.equal(
    jobs.cypress.secrets.CYPRESS_RECORD_KEY,
    '${{ secrets.CYPRESS_RECORD_KEY }}'
  );
  assert.deepEqual(jobs['unit-test'].strategy, {
    'fail-fast': false,
    'max-parallel': 4,
    matrix: '${{ fromJSON(needs.engine-plan.outputs.unitMatrix) }}',
  });
  assert.deepEqual(jobs.cypress.strategy, {
    'fail-fast': false,
    'max-parallel': 6,
    matrix: '${{ fromJSON(needs.engine-plan.outputs.cypressMatrix) }}',
  });
  assert.equal(jobs.cypress.with.case_id, '${{ matrix.case_id }}');
  assert.equal(jobs.cypress.with.specs, '${{ matrix.specs }}');
  assert.match(jobs.playwright.if, /outputs\.playwright == 'true'/);
});

test('native workflow bodies are reused without duplicate PR or push launches', () => {
  for (const [id, file] of Object.entries(reusableJobs)) {
    const name = file.replace(/\.yml$/, '');
    const { text, workflow } = readWorkflow(name);
    assert.ok(Object.hasOwn(workflow.on, 'workflow_call'), id);
    assert.equal(workflow.on.pull_request, undefined, id);
    assert.equal(workflow.on.push, undefined, id);
    assert.doesNotMatch(
      workflow.concurrency.group,
      /github\.workflow/,
      `${id} must not cancel its caller through a shared concurrency group`
    );
    assert.match(
      text,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/
    );
    if (id === 'cypress') {
      assert.match(workflow.concurrency.group, /inputs\.case_id/);
      assert.match(text, /spec: \$\{\{ inputs\.specs \}\}/);
      assert.match(text, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
      assert.match(text, /--evidence "\$SEERRNG_ENGINE_CYPRESS_REPORT"/);
    }
  }
});

test('hosted orchestration retains the original pinned native actions and commands', () => {
  const required = {
    codeql: [
      'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'queries: +security-and-quality',
      'snapetech/seerrng-codeql-models@0.0.15',
    ],
    cypress: [
      'cypress-io/github-action@789d836053c5ca389c2905fc0c9f2909da778c46',
      'pnpm cypress:build',
      'start: env E2E_TESTS=true pnpm start',
    ],
    'test-docs': ['pnpm test:security', 'pnpm gen-api-docs && pnpm build'],
    'docs-link-check': [
      'lycheeverse/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8',
      'fail: false',
    ],
    'lint-helm-charts': [
      'azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310',
      'helm/chart-testing-action@6ec842c01de15ebb84c8627d2744a0c2f2755c9f',
      'jnorwood/helm-docs:v1.14.2@sha256:7e562b49ab6b1dbc50c3da8f2dd6ffa8a5c6bba327b1c6335cc15ce29267979c',
    ],
  };
  for (const [name, fragments] of Object.entries(required)) {
    const text = readWorkflow(name).text;
    for (const fragment of fragments)
      assert.ok(text.includes(fragment), `${name}: ${fragment}`);
  }
});

test('trusted PR metadata workflows remain outside the untrusted execution DAG', () => {
  const called = Object.values(reusableJobs);
  assert.equal(called.includes('pr-validation.yml'), false);
  assert.equal(called.includes('conflict_labeler.yml'), false);
  assert.ok(ci.workflow.jobs['engine-reconcile']);
});

test('production entrypoints keep distributed Mode 3 orchestration dormant', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  const entrypoints = [
    [
      'package.json scripts',
      Object.entries(packageJson.scripts ?? {})
        .map(([name, command]) => `${name}: ${command}`)
        .join('\n'),
    ],
    ...filesUnder(path.join(root, '.husky')).map((file) => [
      path.relative(root, file),
      readFileSync(file, 'utf8'),
    ]),
    ...filesUnder(path.join(root, '.github', 'workflows'))
      .filter((file) => /\.ya?ml$/u.test(file))
      .map((file) => [path.relative(root, file), readFileSync(file, 'utf8')]),
    ...['src', 'server'].flatMap((directory) =>
      filesUnder(path.join(root, directory))
        .filter(isProductionRuntimeSource)
        .map((file) => [path.relative(root, file), readFileSync(file, 'utf8')])
    ),
  ];

  for (const [source, contents] of entrypoints)
    assert.doesNotMatch(contents, /--distributed-[a-z0-9-]+\b/iu, source);
});
