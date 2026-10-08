// Copyright (c) snapetech and SeerrNG contributors.
import * as yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const stepIndex = (job, name) =>
  job.steps.findIndex((step) => step.name === name);
const needs = (job) =>
  new Set(Array.isArray(job.needs) ? job.needs : [job.needs]);

const ci = readWorkflow('ci');
const validationCli = readFileSync(
  path.join(root, 'bin/run-local-validation.mjs'),
  'utf8'
).replaceAll('\r\n', '\n');
const cypressConfig = readFileSync(
  path.join(root, 'cypress.config.ts'),
  'utf8'
).replaceAll('\r\n', '\n');
const playwrightConfig = readFileSync(
  path.join(root, 'playwright.config.ts'),
  'utf8'
).replaceAll('\r\n', '\n');
const directUnits = {
  'jellyfin-plugin': 'ci-jellyfin-plugin',
  'release-notes': 'ci-release-notes',
  i18n: 'ci-i18n',
  test: 'ci-test',
  'unit-test': 'ci-unit-test',
  playwright: 'ci-playwright',
};
const reusableUnits = {
  codeql: ['codeql.yml', 'codeql-analyze'],
  cypress: ['cypress.yml', 'cypress-run'],
  'test-docs': ['test-docs.yml', 'test-docs-build'],
  'docs-links': ['docs-link-check.yml', 'docs-links'],
  helm: ['lint-helm-charts.yml', 'helm-lint-test'],
};

test('the immutable plan is an attempt-bound artifact consumed by every unit', () => {
  const plan = ci.workflow.jobs['engine-plan'];
  const create = stepNamed(plan, 'Create current-run hosted validation plan');
  const publish = stepNamed(
    plan,
    'Publish immutable current-attempt validation plan'
  );
  assert.match(create.run, /--github-plan/);
  assert.match(create.run, /--plan-file/);
  assert.match(publish.uses, /^actions\/upload-artifact@043fb46d/);
  assert.match(publish.with.name, /github\.run_id/);
  assert.match(publish.with.name, /github\.run_attempt/);
  assert.equal(publish.with['retention-days'], 1);
  assert.equal(plan.outputs.unitMatrix, '${{ steps.plan.outputs.unitMatrix }}');
  assert.equal(
    plan.outputs.cypressMatrix,
    '${{ steps.plan.outputs.cypressMatrix }}'
  );
  assert.equal(plan.outputs.playwright, '${{ steps.plan.outputs.playwright }}');
  assert.match(
    validationCli,
    /const playwright = plan\.units\.find\([\s\S]*entry\.id === 'ci-playwright'/
  );
  assert.match(validationCli, /playwright: playwright\.applicable/);

  for (const [jobId, unitId] of Object.entries(directUnits)) {
    const job = ci.workflow.jobs[jobId];
    assert.ok(
      Object.values(job.env).every((value) => !value.includes('runner.')),
      `${jobId} job-level env must use only job-available contexts`
    );
    assert.equal(job.env.SEERRNG_ENGINE_UNIT_ID, unitId, jobId);
    assert.equal(
      job.env.SEERRNG_ENGINE_RUN_ID,
      '${{ needs.engine-plan.outputs.runId }}',
      jobId
    );
    assert.equal(
      job.env.SEERRNG_ENGINE_RUN_ATTEMPT,
      '${{ needs.engine-plan.outputs.runAttempt }}',
      jobId
    );
    assert.equal(
      job.env.SEERRNG_ENGINE_EXECUTION_SHA,
      '${{ needs.engine-plan.outputs.executionSha }}',
      jobId
    );
    assert.ok(stepNamed(job, 'Download immutable validation plan'), jobId);
  }

  for (const [jobId, [, unitId]] of Object.entries(reusableUnits)) {
    const job = ci.workflow.jobs[jobId];
    assert.equal(job.with.unit_id, unitId, jobId);
    assert.equal(
      job.with.plan_sha256,
      '${{ needs.engine-plan.outputs.planSha256 }}'
    );
    assert.equal(
      job.with.engine_run_id,
      '${{ needs.engine-plan.outputs.runId }}'
    );
    assert.equal(
      job.with.engine_run_attempt,
      '${{ needs.engine-plan.outputs.runAttempt }}'
    );
    assert.equal(
      job.with.execution_sha,
      '${{ needs.engine-plan.outputs.executionSha }}'
    );
  }
});

test('hosted admission outputs expose execution only', () => {
  assert.match(validationCli, /\['execute', 'true'\]/);
  for (const forbidden of [
    'reuseSuccess',
    'reusableSuccessReceiptSha256',
    'reusableHostedUnitReceiptSha256',
    'reuse-success',
  ])
    assert.equal(validationCli.includes(forbidden), false, forbidden);
});

test('the fixed GitHub graph fans out after planning and fans in for reconciliation', () => {
  const jobs = ci.workflow.jobs;
  const validationJobs = [
    ...Object.keys(directUnits),
    ...Object.keys(reusableUnits),
  ];
  for (const id of validationJobs) {
    assert.deepEqual(needs(jobs[id]), new Set(['engine-plan']), id);
    assert.match(jobs[id].if, /always\(\)/, id);
    assert.match(jobs[id].if, /!cancelled\(\)/, id);
    assert.match(jobs[id].if, /needs\.engine-plan\.result == 'success'/, id);
  }
  for (const id of validationJobs)
    assert.doesNotMatch(
      jobs[id].if,
      /needs\.(?!engine-plan)[\w-]+\.result/,
      id
    );
  assert.match(jobs.codeql.if, /outputs\.codeql == 'true'/);
  assert.match(jobs['test-docs'].if, /outputs\.testDocs == 'true'/);
  assert.match(jobs.helm.if, /outputs\.helm == 'true'/);
  assert.match(jobs.cypress.if, /outputs\.cypress == 'true'/);
  assert.match(jobs.playwright.if, /outputs\.playwright == 'true'/);
});

test('the weighted Unit and Cypress shard matrices consume the sealed plan outputs', () => {
  const unit = ci.workflow.jobs['unit-test'];
  const cypress = ci.workflow.jobs.cypress;
  assert.equal(unit.strategy['fail-fast'], false);
  assert.equal(unit.strategy['max-parallel'], 4);
  assert.equal(
    unit.strategy.matrix,
    '${{ fromJSON(needs.engine-plan.outputs.unitMatrix) }}'
  );
  assert.match(unit.name, /matrix\.case_id/);
  assert.equal(unit.env.SEERRNG_ENGINE_CASE_ID, '${{ matrix.case_id }}');

  assert.equal(cypress.strategy['fail-fast'], false);
  assert.equal(cypress.strategy['max-parallel'], 6);
  assert.equal(
    cypress.strategy.matrix,
    '${{ fromJSON(needs.engine-plan.outputs.cypressMatrix) }}'
  );
  assert.match(cypress.name, /matrix\.case_id/);
  assert.equal(cypress.with.case_id, '${{ matrix.case_id }}');
  assert.equal(cypress.with.specs, '${{ matrix.specs }}');
  assert.match(validationCli, /const unitMatrix = \{\s*include:/);
  assert.match(validationCli, /const cypressMatrix = \{\s*include:/);
  assert.match(validationCli, /specs: lane\.files\.join\(','\)/);
});

test('direct native jobs execute only after admission and preserve sealed receipts', () => {
  const jobs = ci.workflow.jobs;
  const nativeValidation = {
    'jellyfin-plugin': [
      'Build plugin',
      'Smoke test plugin in Jellyfin 10.11.11',
    ],
    'release-notes': ['Validate release-note fragment or explicit opt-out'],
    i18n: ['i18n Check', 'Security council and tooling tests'],
    test: ['Lint', 'Formatting', 'Build', 'Bundle budget'],
    'unit-test': [
      'Run tests',
      'Run engine-owned native Node tests',
      'Publish test report',
    ],
    playwright: [
      'Build Playwright application once on Ubuntu',
      'Run native Playwright suite',
    ],
  };
  for (const id of Object.keys(directUnits)) {
    const job = jobs[id];
    const admit = stepNamed(job, 'Admit engine unit');
    const seal = stepNamed(job, 'Seal engine unit receipt');
    const publish = stepNamed(job, 'Publish engine unit receipt');
    assert.ok(admit, id);
    assert.ok(seal, id);
    assert.ok(publish, id);
    assert.equal(admit.id, 'engine-admission', id);
    const firstAfterAdmission =
      id === 'unit-test'
        ? 'Materialize planned Vitest shard'
        : nativeValidation[id][0];
    assert.equal(
      stepIndex(job, 'Admit engine unit') + 1,
      stepIndex(job, firstAfterAdmission),
      id
    );
    assert.ok(
      stepIndex(job, 'Admit engine unit') > stepIndex(job, 'Checkout'),
      id
    );
    assert.ok(
      stepIndex(job, 'Seal engine unit receipt') >
        stepIndex(job, nativeValidation[id][0]),
      id
    );
    for (const name of nativeValidation[id]) {
      const step = stepNamed(job, name);
      assert.ok(step, `${id}: ${name}`);
      assert.match(
        step.if,
        /steps\.engine-admission\.outputs\.execute == 'true'/,
        `${id}: ${name}`
      );
    }
    assert.match(seal.if, /always\(\)/, id);
    assert.match(
      seal.if,
      /steps\.engine-admission\.outputs\.execute == 'true'/,
      id
    );
    assert.match(seal.run, /--github-receipt/, id);
    assert.match(seal.run, /--job-status/, id);
    assert.match(publish.if, /always\(\)/, id);
    assert.doesNotMatch(publish.if, /outputs\.execute/, id);
    assert.match(publish.with.name, /github\.run_attempt/, id);
    assert.equal(publish.with['if-no-files-found'], 'error', id);
  }
  const unit = jobs['unit-test'];
  assert.match(stepNamed(unit, 'Admit engine unit').run, /--case/);
  assert.match(stepNamed(unit, 'Seal engine unit receipt').run, /--case/);
  assert.match(
    stepNamed(unit, 'Publish engine unit receipt').with.name,
    /matrix\.case_id/
  );
});

test('the unit matrix materializes and executes only each planned test shard', () => {
  const job = ci.workflow.jobs['unit-test'];
  const materialize = stepNamed(job, 'Materialize planned Vitest shard');
  const vitest = stepNamed(job, 'Run tests');
  const nodeTests = stepNamed(job, 'Run engine-owned native Node tests');
  const receipt = stepNamed(job, 'Seal engine unit receipt');
  assert.match(materialize.run, /--github-materialize-test-lane/);
  assert.match(materialize.run, /--unit "\$SEERRNG_ENGINE_UNIT_ID"/);
  assert.match(materialize.run, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
  assert.match(materialize.run, /--lane vitest/);
  assert.match(materialize.run, /--receipt-dir /);
  assert.match(
    materialize.run,
    /--output-file "\$RUNNER_TEMP\/seerrng-engine-vitest\.config\.mts"/
  );
  assert.match(
    materialize.if,
    /steps\.engine-admission\.outputs\.execute == 'true'/
  );
  assert.match(vitest.run, /pnpm test:ci\s+--config/);
  assert.doesNotMatch(vitest.run, /pnpm test:ci\s+--\s+--config/);
  assert.match(
    vitest.run,
    /--config "\$RUNNER_TEMP\/seerrng-engine-vitest\.config\.mts"/
  );
  assert.match(nodeTests.run, /--github-run-test-lane/);
  assert.match(nodeTests.run, /--unit "\$SEERRNG_ENGINE_UNIT_ID"/);
  assert.match(nodeTests.run, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
  assert.match(nodeTests.run, /--lane node-test-mjs/);
  assert.match(nodeTests.run, /--plan-file /);
  assert.match(nodeTests.run, /--expected-plan-sha256 /);
  assert.match(nodeTests.run, /--receipt-dir /);
  assert.match(
    nodeTests.run,
    /--report-file "\$RUNNER_TEMP\/seerrng-engine-node-tests\.json"/
  );
  assert.match(receipt.run, /--evidence report\.xml/);
  assert.match(
    receipt.run,
    /--evidence "\$RUNNER_TEMP\/seerrng-engine-node-tests\.json"/
  );
  assert.match(receipt.run, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
});

test('reusable native workflows require binding inputs and emit receipts', () => {
  const standalone = new Set(['codeql', 'cypress', 'docs-links']);
  const commonInputs = [
    'plan_sha256',
    'engine_run_id',
    'engine_run_attempt',
    'execution_sha',
    'unit_id',
  ];
  const firstValidation = {
    codeql: 'Initialize CodeQL',
    cypress: 'Build Cypress application once on Ubuntu',
    'test-docs': 'Test image parser boundaries',
    'docs-links': 'Run Lychee link checker',
    helm: 'Run chart-testing (list-changed)',
  };
  for (const [jobId, [file]] of Object.entries(reusableUnits)) {
    const name = file.replace(/\.yml$/, '');
    const { workflow } = readWorkflow(name);
    const inputs = workflow.on.workflow_call.inputs;
    assert.deepEqual(
      new Set(Object.keys(inputs)),
      new Set(
        jobId === 'cypress'
          ? [...commonInputs, 'case_id', 'specs']
          : commonInputs
      ),
      jobId
    );
    for (const [inputId, input] of Object.entries(inputs)) {
      assert.equal(input.type, 'string', jobId);
      assert.equal(input.required, true, `${jobId}/${inputId}`);
    }
    for (const job of Object.values(workflow.jobs)) {
      assert.ok(
        Object.values(job.env).every((value) => !value.includes('runner.')),
        `${jobId} job-level env must use only job-available contexts`
      );
      const admission = job.steps.find((step) =>
        step.name?.startsWith('Admit engine unit')
      );
      const receipt = job.steps.find((step) =>
        step.name?.startsWith('Seal engine unit')
      );
      const publish = job.steps.find((step) =>
        step.name?.startsWith('Publish engine unit')
      );
      assert.ok(admission, jobId);
      assert.ok(receipt, jobId);
      assert.ok(publish, jobId);
      assert.equal(admission.id, 'engine-admission', jobId);
      assert.equal(
        job.steps.indexOf(admission) + 1,
        stepIndex(job, firstValidation[jobId]),
        jobId
      );
      assert.match(admission.run, /--plan-file/, jobId);
      const firstNativeStep = stepNamed(job, firstValidation[jobId]);
      assert.match(
        firstNativeStep.if,
        /steps\.engine-admission\.outputs\.execute == 'true'/,
        jobId
      );
      if (standalone.has(jobId))
        assert.match(
          firstNativeStep.if,
          /inputs\.plan_sha256 == ''\s*\|\|\s*steps\.engine-admission\.outputs\.execute == 'true'/,
          jobId
        );
      else
        assert.equal(
          firstNativeStep.if,
          "steps.engine-admission.outputs.execute == 'true'",
          jobId
        );
      assert.match(receipt.run, /--github-receipt/, jobId);
      assert.match(receipt.if, /always\(\)/, jobId);
      assert.match(
        receipt.if,
        /steps\.engine-admission\.outputs\.execute == 'true'/,
        jobId
      );
      assert.match(publish.if, /always\(\)/, jobId);
      assert.doesNotMatch(publish.if, /outputs\.execute/, jobId);
      assert.match(publish.with.name, /github\.run_attempt/, jobId);
      assert.equal(publish.with['if-no-files-found'], 'error', jobId);
    }
  }

  const codeql = readWorkflow('codeql').workflow.jobs.analyze;
  assert.match(stepNamed(codeql, 'Admit engine unit case').run, /--case/);
  assert.match(
    stepNamed(codeql, 'Seal engine unit case receipt').run,
    /--case/
  );
});

test('Helm scopes committed chart changes before read-only documentation validation', () => {
  const { workflow } = readWorkflow('lint-helm-charts');
  const job = workflow.jobs['lint-test'];
  const listChanged = stepNamed(job, 'Run chart-testing (list-changed)');
  const docs = stepNamed(job, 'Ensure documentation is updated');
  const pullRequestLint = stepNamed(job, 'Run chart-testing (pull request)');
  const pushLint = stepNamed(job, 'Run chart-testing (push)');
  const receipt = stepNamed(job, 'Seal engine unit receipt');

  assert.ok(
    stepIndex(job, 'Run chart-testing (list-changed)') <
      stepIndex(job, 'Ensure documentation is updated')
  );
  assert.ok(
    stepIndex(job, 'Ensure documentation is updated') <
      stepIndex(job, 'Seal engine unit receipt')
  );
  assert.match(listChanged.run, /ct list-changed --target-branch/);
  assert.match(listChanged.run, /RUNNER_TEMP\/seerrng-helm-charts\.txt/);
  assert.match(docs.if, /steps\.list-changed\.outputs\.changed == 'true'/);
  assert.match(docs.if, /github\.event_name == 'push'/);
  assert.match(docs.run, /docker run --rm/);
  assert.match(docs.run, /--volume "\$GITHUB_WORKSPACE:\/helm-docs:ro"/);
  assert.match(docs.run, /--dry-run/);
  assert.match(docs.run, /diff --unified/);
  assert.match(
    pullRequestLint.run,
    /ct lint --target-branch "\$TARGET_BRANCH" --validate-maintainers=false/
  );
  assert.match(pushLint.run, /ct lint --all --validate-maintainers=false/);
  assert.match(pullRequestLint.if, /!cancelled\(\)/);
  assert.match(pushLint.if, /!cancelled\(\)/);
  assert.match(receipt.if, /always\(\)/);
});

test('each planned Cypress shard seals its exact specs and native result', () => {
  const { text, workflow } = readWorkflow('cypress');
  const job = workflow.jobs['cypress-run'];
  const configure = stepNamed(job, 'Configure Cypress runtime directory');
  const configureResult = stepNamed(job, 'Configure Cypress engine result');
  const prepare = stepNamed(job, 'Prepare Cypress runtime configuration');
  const exportConfig = stepNamed(job, 'Export external runtime configuration');
  const admission = stepNamed(job, 'Admit engine unit');
  const build = stepNamed(job, 'Build Cypress application once on Ubuntu');
  const run = stepNamed(job, 'Cypress run');
  const receipt = stepNamed(job, 'Seal engine unit receipt');
  assert.match(
    configure.run,
    /CONFIG_DIRECTORY=.*\$RUNNER_TEMP\/seerrng-cypress-runtime-config/
  );
  assert.match(configure.run, />> "\$GITHUB_ENV"/);
  assert.match(
    configureResult.run,
    /SEERRNG_ENGINE_CYPRESS_REPORT=.*\$RUNNER_TEMP\/seerrng-engine-cypress-result\.json/
  );
  assert.equal(job.env.SEERRNG_ENGINE_UNIT_ID, '${{ inputs.unit_id }}');
  assert.equal(job.env.SEERRNG_ENGINE_CASE_ID, '${{ inputs.case_id }}');
  assert.equal(job.env.SEERRNG_ENGINE_CYPRESS_FILES, '${{ inputs.specs }}');
  assert.match(job.name, /inputs\.case_id/);
  assert.match(workflow.concurrency.group, /inputs\.case_id/);
  for (const name of [
    'Prepare Cypress runtime configuration',
    'Export external runtime configuration',
    'Admit engine unit',
    'Build Cypress application once on Ubuntu',
    'Cypress run',
    'Seal engine unit receipt',
  ])
    assert.ok(
      stepIndex(job, 'Configure Cypress runtime directory') <
        stepIndex(job, name),
      name
    );
  for (const step of [prepare, exportConfig, admission, build, run, receipt])
    assert.equal(step.env?.CONFIG_DIRECTORY, undefined, step.name);
  assert.doesNotMatch(text, /cypress\/runtime-config/);
  assert.equal(build.run, 'pnpm cypress:build');
  assert.equal(
    build.env.SEERR_EXTERNAL_CONFIG,
    '${{ steps.export-config.outputs.external_config }}'
  );
  assert.equal(build.env.WITH_MIGRATIONS, true);
  assert.equal(build.env.E2E_TESTS, true);
  assert.equal(build.env.PORT, 5056);
  assert.equal(run.with.build, undefined);
  assert.equal(run.with.install, false);
  assert.equal(run.with.start, 'env E2E_TESTS=true pnpm start');
  assert.equal(run.with.spec, '${{ inputs.specs }}');
  assert.equal(text.match(/pnpm cypress:build/g)?.length, 1);
  assert.match(
    run.uses,
    /^cypress-io\/github-action@789d836053c5ca389c2905fc0c9f2909da778c46/
  );
  assert.match(admission.run, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
  assert.match(receipt.run, /--case "\$SEERRNG_ENGINE_CASE_ID"/);
  assert.match(receipt.run, /--evidence "\$SEERRNG_ENGINE_CYPRESS_REPORT"/);
  assert.match(
    stepNamed(job, 'Publish engine unit receipt').with.name,
    /cypress-run-\$\{\{ inputs\.case_id \}\}/
  );
  assert.match(cypressConfig, /on\('after:run'/);
  assert.match(cypressConfig, /seerrng-hosted-cypress-result\/v1/);
  assert.match(cypressConfig, /planSha256:/);
  assert.match(cypressConfig, /caseId:/);
  assert.match(cypressConfig, /specs: engineSpecs/);
  assert.match(cypressConfig, /native: results/);
});

test('Playwright runs as one engine-owned native Ubuntu browser lane', () => {
  const job = ci.workflow.jobs.playwright;
  const configure = stepNamed(job, 'Configure Playwright runtime');
  const prepare = stepNamed(job, 'Prepare Playwright runtime configuration');
  const admission = stepNamed(job, 'Admit engine unit');
  const build = stepNamed(job, 'Build Playwright application once on Ubuntu');
  const run = stepNamed(job, 'Run native Playwright suite');
  const receipt = stepNamed(job, 'Seal engine unit receipt');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.container, undefined);
  assert.equal(job.env.SEERRNG_ENGINE_UNIT_ID, 'ci-playwright');
  assert.equal(job.env.PORT, '5055');
  assert.equal(job.env.PLAYWRIGHT_BASE_URL, 'http://127.0.0.1:5055');
  assert.match(job.if, /needs\.engine-plan\.outputs\.playwright == 'true'/);
  assert.match(
    configure.run,
    /CONFIG_DIRECTORY=.*\$RUNNER_TEMP\/seerrng-playwright-runtime-config/
  );
  assert.match(
    configure.run,
    /PLAYWRIGHT_JSON_OUTPUT_FILE=.*\$RUNNER_TEMP\/seerrng-engine-playwright-result\.json/
  );
  assert.ok(
    stepIndex(job, 'Configure Playwright runtime') <
      stepIndex(job, prepare.name)
  );
  assert.ok(stepIndex(job, prepare.name) < stepIndex(job, admission.name));
  assert.equal(build.run, 'pnpm build');
  assert.equal(run.run, 'pnpm exec playwright test --reporter=json');
  assert.match(receipt.run, /--evidence "\$PLAYWRIGHT_JSON_OUTPUT_FILE"/);
  assert.match(playwrightConfig, /process\.env\.CONFIG_DIRECTORY/);
  assert.match(playwrightConfig, /process\.env\.PORT/);
  assert.match(playwrightConfig, /process\.env\.PLAYWRIGHT_BASE_URL/);
  assert.doesNotMatch(playwrightConfig, /\.\.\.\s*process\.env/);
});

test('native environments, commands, permissions, and action pins are preserved', () => {
  const jobs = ci.workflow.jobs;
  const alpine =
    'node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2';
  assert.equal(jobs.test.container.image, alpine);
  assert.equal(jobs['unit-test'].container.image, alpine);
  assert.equal(jobs.test['runs-on'], 'ubuntu-latest');
  assert.equal(jobs['unit-test']['runs-on'], 'ubuntu-latest');
  assert.equal(jobs.codeql.permissions['security-events'], 'write');

  for (const fragment of [
    'dotnet publish',
    'integrations/jellyfin-plugin/smoke-test.py',
    'node scripts/check-release-notes.mjs',
    'node scripts/check-changelog-tags.mjs',
    'node bin/check-i18n.js',
    'pnpm security:council',
    'pnpm lint',
    'pnpm format:check',
    'pnpm build',
    'pnpm bundle:check',
    'pnpm test:ci',
    'mikepenz/action-junit-report@a9170d5795813c01ab4901ffb045b52bab4ab09d',
  ])
    assert.ok(ci.text.includes(fragment), fragment);

  const required = {
    codeql: [
      'language: [actions, javascript]',
      'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'github/codeql-action/autobuild@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'queries: +security-and-quality',
      'snapetech/seerrng-codeql-models@0.0.15',
    ],
    cypress: [
      'cypress-io/github-action@789d836053c5ca389c2905fc0c9f2909da778c46',
      'start: env E2E_TESTS=true pnpm start',
      "wait-on: 'http://localhost:5056'",
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

test('reconciliation consumes the immutable plan and full receipt artifacts', () => {
  const job = ci.workflow.jobs['engine-reconcile'];
  const plan = stepNamed(job, 'Download immutable validation plan');
  const receipts = stepNamed(job, 'Download current-attempt engine receipts');
  const reconcile = stepNamed(
    job,
    'Reconcile current-run hosted validation results'
  );
  assert.match(plan.with.name, /github\.run_attempt/);
  assert.match(receipts.with.pattern, /github\.run_attempt/);
  assert.match(receipts.with.pattern, /seerrng-engine-receipt-/);
  assert.equal(receipts.with['merge-multiple'], true);
  assert.deepEqual(
    needs(job),
    new Set([
      'engine-plan',
      ...Object.keys(directUnits),
      ...Object.keys(reusableUnits),
    ])
  );
  assert.match(job.if, /always\(\)/);
  assert.match(reconcile.run, /--github-reconcile/);
  assert.match(reconcile.run, /--plan-file/);
  assert.match(reconcile.run, /--receipt-dir/);
  assert.equal(
    reconcile.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256,
    '${{ needs.engine-plan.outputs.planSha256 }}'
  );
});
