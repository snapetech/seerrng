import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const workflow = yaml.load(
  fs.readFileSync(
    path.join(rootDirectory, '.github', 'workflows', 'lint-helm-charts.yml'),
    'utf8'
  )
);
const ciWorkflow = yaml.load(
  fs.readFileSync(
    path.join(rootDirectory, '.github', 'workflows', 'ci.yml'),
    'utf8'
  )
);
const steps = workflow.jobs['lint-test'].steps;

test('chart validation uses version-aware comparison for pull requests', () => {
  const listChanged = steps.find(
    (step) => step.name === 'Run chart-testing (list-changed)'
  );
  const pullRequestLint = steps.find(
    (step) => step.name === 'Run chart-testing (pull request)'
  );

  assert.equal(
    listChanged.if,
    "steps.engine-admission.outputs.execute == 'true'"
  );
  assert.match(listChanged.run, /GITHUB_EVENT_NAME.*pull_request/iu);
  assert.equal(
    pullRequestLint.if,
    "!cancelled() && steps.engine-admission.outputs.execute == 'true' && github.event_name == 'pull_request' && steps.list-changed.outputs.changed == 'true'"
  );
  assert.match(pullRequestLint.run, /ct lint --target-branch/iu);
});

test('centrally selected chart validation retains push-wide lint behavior', () => {
  const pushLint = steps.find(
    (step) => step.name === 'Run chart-testing (push)'
  );

  assert.equal(
    pushLint.if,
    "!cancelled() && steps.engine-admission.outputs.execute == 'true' && github.event_name == 'push'"
  );
  assert.match(pushLint.run, /ct lint --all --validate-maintainers=false/iu);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_call'));
  assert.deepEqual(ciWorkflow.on.push.branches, ['main']);
  assert.equal(
    ciWorkflow.jobs.helm.uses,
    './.github/workflows/lint-helm-charts.yml'
  );
  assert.match(ciWorkflow.jobs.helm.if, /always\(\)/u);
  assert.match(ciWorkflow.jobs.helm.if, /!cancelled\(\)/u);
  assert.match(
    ciWorkflow.jobs.helm.if,
    /needs\.engine-plan\.result == 'success'/u
  );
  assert.match(
    ciWorkflow.jobs.helm.if,
    /needs\.engine-plan\.outputs\.helm == 'true'/u
  );
});
