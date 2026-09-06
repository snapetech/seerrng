import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const workflowDirectory = path.join(rootDirectory, '.github', 'workflows');
const failures = [];

const check = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

const workflowFiles = fs
  .readdirSync(workflowDirectory)
  .filter((file) => /\.ya?ml$/u.test(file))
  .sort();
const workflows = new Map();

for (const file of workflowFiles) {
  const absolutePath = path.join(workflowDirectory, file);
  const source = fs.readFileSync(absolutePath, 'utf8');
  try {
    const workflow = yaml.load(source, { filename: absolutePath });
    check(
      workflow !== null &&
        typeof workflow === 'object' &&
        !Array.isArray(workflow),
      `${file}: workflow root must be a mapping`
    );
    workflows.set(file, { source, workflow });
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

const inspectUses = (value, location, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (typeof value.uses === 'string') {
    const uses = value.uses;
    const isLocal = uses.startsWith('./');
    const isCommitPinned = /^[^\s@]+@[0-9a-f]{40}$/u.test(uses);
    const isDigestPinnedContainer =
      /^docker:\/\/[^\s]+@sha256:[0-9a-f]{64}$/u.test(uses);
    check(
      isLocal || isCommitPinned || isDigestPinnedContainer,
      `${location}.uses: external action is not pinned to a full commit or image digest (${uses})`
    );

    if (uses.startsWith('actions/checkout@')) {
      check(
        value.with?.clean !== false,
        `${location}: checkout must not retain a dirty self-hosted workspace`
      );
      const credentialsPersist = value.with?.['persist-credentials'] !== false;
      const isDedicatedSshPushCheckout =
        location.startsWith('create-tag.yml.jobs.create-tag.') &&
        value.with?.['ssh-key'] === '${{ secrets.COMMIT_KEY }}';
      check(
        !credentialsPersist || isDedicatedSshPushCheckout,
        `${location}: checkout credentials must not persist beyond checkout`
      );
    }

    if (uses.startsWith('actions/github-script@')) {
      const script = value.with?.script ?? '';
      check(
        typeof script === 'string' && script.length <= 65_536,
        `${location}: GitHub Script source must be a bounded string`
      );
      if (typeof script === 'string') {
        try {
          new Function(
            'github',
            'context',
            'core',
            `return (async () => {\n${script}\n})();`
          );
        } catch (error) {
          failures.push(
            `${location}: GitHub Script does not parse (${error.message})`
          );
        }
        check(
          !/\bgithub\.paginate\s*\(/u.test(script),
          `${location}: GitHub API pagination must have an explicit page/resource bound`
        );
      }
    }

    if (uses.startsWith('dawidd6/action-download-artifact@')) {
      check(
        String(value.with?.path ?? '').startsWith('${{ runner.temp }}/'),
        `${location}: cross-workflow artifacts must extract outside the repository checkout`
      );
      check(
        value.with?.branch === 'main' &&
          value.with?.workflow_conclusion === 'success' &&
          value.with?.allow_forks !== true,
        `${location}: cross-workflow artifacts must come from successful main runs without forks`
      );
    }
  }

  for (const [key, child] of Object.entries(value)) {
    inspectUses(child, `${location}.${key}`, seen);
  }
};

for (const [file, parsed] of workflows) {
  inspectUses(parsed.workflow, file);
  for (const [jobName, job] of Object.entries(parsed.workflow.jobs ?? {})) {
    for (const [stepIndex, step] of (job.steps ?? []).entries()) {
      check(
        !/\$\{\{[^}]*\bgithub\.event\./u.test(String(step.run ?? '')),
        `${file}.jobs.${jobName}.steps.${stepIndex}: event data must enter shell through a quoted environment variable`
      );
    }
  }
}

const findSecretExpressions = (value, expressions = []) => {
  if (typeof value === 'string' && /\bsecrets\.[A-Za-z0-9_]+/u.test(value)) {
    expressions.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) {
      findSecretExpressions(child, expressions);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      findSecretExpressions(child, expressions);
    }
  }
  return expressions;
};

for (const [file, parsed] of workflows) {
  const workflow = parsed.workflow;
  if (!workflow.on?.pull_request) {
    continue;
  }
  const jobs = workflow.jobs ?? {};
  const pullRequestAdmission = new Map();
  const canRunOnPullRequest = (jobName, visiting = new Set()) => {
    if (pullRequestAdmission.has(jobName)) {
      return pullRequestAdmission.get(jobName);
    }
    if (visiting.has(jobName)) {
      return true;
    }
    visiting.add(jobName);
    const job = jobs[jobName] ?? {};
    const condition = String(job.if ?? '');
    const directlyExcluded =
      /github\.event_name\s*==\s*['"]push['"]/u.test(condition) ||
      /github\.event_name\s*!=\s*['"]pull_request['"]/u.test(condition) ||
      /github\.ref\s*==\s*['"]refs\/heads\/main['"]/u.test(condition);
    const dependencies = Array.isArray(job.needs)
      ? job.needs
      : job.needs
        ? [job.needs]
        : [];
    const dependencyExcluded = dependencies.some(
      (dependency) => !canRunOnPullRequest(dependency, new Set(visiting))
    );
    const admitted = !directlyExcluded && !dependencyExcluded;
    pullRequestAdmission.set(jobName, admitted);
    return admitted;
  };

  for (const [jobName, job] of Object.entries(jobs)) {
    const checksOutRepository = (job.steps ?? []).some((step) =>
      String(step.uses ?? '').startsWith('actions/checkout@')
    );
    if (!checksOutRepository || !canRunOnPullRequest(jobName)) {
      continue;
    }
    for (const expression of findSecretExpressions(job)) {
      const excludesPullRequest =
        /github\.event_name\s*==\s*['"]push['"]\s*&&/u.test(expression) ||
        /github\.event_name\s*!=\s*['"]pull_request['"]\s*&&/u.test(expression);
      check(
        excludesPullRequest,
        `${file}.jobs.${jobName}: pull-request code must not receive secrets (${expression})`
      );
    }
  }
}

for (const [file, parsed] of workflows) {
  const workflow = parsed.workflow;
  if (workflow.on?.workflow_dispatch === undefined) {
    continue;
  }
  const jobs = workflow.jobs ?? {};
  const mainAdmission = new Map();
  const canRunOutsideMain = (jobName, visiting = new Set()) => {
    if (mainAdmission.has(jobName)) {
      return mainAdmission.get(jobName);
    }
    if (visiting.has(jobName)) {
      return true;
    }
    visiting.add(jobName);
    const job = jobs[jobName] ?? {};
    const condition = String(job.if ?? '');
    const directlyRestricted =
      condition.trim() === 'false' ||
      /github\.ref\s*==\s*['"]refs\/heads\/main['"]/u.test(condition);
    const dependencies = Array.isArray(job.needs)
      ? job.needs
      : job.needs
        ? [job.needs]
        : [];
    const dependencyRestricted = dependencies.some(
      (dependency) => !canRunOutsideMain(dependency, new Set(visiting))
    );
    const admitted = !directlyRestricted && !dependencyRestricted;
    mainAdmission.set(jobName, admitted);
    return admitted;
  };

  for (const [jobName, job] of Object.entries(jobs)) {
    const permissions = job.permissions ?? workflow.permissions ?? {};
    const hasWriteAuthority = Object.values(permissions).includes('write');
    const hasSecret = findSecretExpressions(job).length > 0;
    if (hasWriteAuthority || hasSecret) {
      check(
        !canRunOutsideMain(jobName),
        `${file}.jobs.${jobName}: privileged manual dispatch must be gated by a main-ref job`
      );
    }
  }
}

const preview = workflows.get('preview.yml')?.workflow;
if (!preview) {
  failures.push('preview.yml: required workflow is missing or invalid');
} else {
  check(
    preview.on?.workflow_dispatch === undefined,
    'preview.yml: arbitrary workflow-dispatch refs must not reach self-hosted preview builders'
  );
  const validationJob = preview.jobs?.['validate-main-tag'];
  const publishJob = preview.jobs?.publish;
  check(
    Boolean(validationJob),
    'preview.yml: trusted tag validation job is missing'
  );
  check(
    validationJob?.['runs-on'] === 'ubuntu-latest',
    'preview.yml: untrusted preview tag validation must run on a hosted runner'
  );
  check(
    publishJob?.needs === 'validate-main-tag' ||
      publishJob?.needs?.includes?.('validate-main-tag'),
    'preview.yml: self-hosted preview publishing must depend on tag validation'
  );
  const validationScript = validationJob?.steps?.find(
    (step) => step.name === 'Ensure bounded preview tag is on main'
  )?.run;
  check(
    typeof validationScript === 'string' &&
      validationScript.includes('git merge-base --is-ancestor') &&
      validationScript.includes("$GITHUB_REF_TYPE\" != 'tag'"),
    'preview.yml: preview validation must enforce tag type and main ancestry'
  );
}

const createTag =
  workflows.get('create-tag.yml')?.workflow?.jobs?.['create-tag'];
if (!createTag) {
  failures.push('create-tag.yml: create-tag job is missing');
} else {
  check(
    JSON.stringify(createTag.permissions) ===
      JSON.stringify({ contents: 'read' }),
    'create-tag.yml: the SSH push job must not also receive a write-capable GitHub token'
  );
  const versionStep = createTag.steps?.find(
    (step) => step.name === 'Bump package.json'
  );
  check(
    String(versionStep?.run ?? '').includes('--ignore-scripts'),
    'create-tag.yml: npm version must not execute repository lifecycle scripts while the SSH key is active'
  );
}

const helmWorkflow = workflows.get('helm.yml')?.workflow;
check(
  Boolean(
    helmWorkflow?.on?.push?.paths?.includes('.github/workflows/helm.yml')
  ),
  'helm.yml: chart release trigger must include its actual workflow path'
);
for (const [jobName, stepName] of [
  ['publish', 'Push charts to GHCR'],
  ['verify', 'Verify signatures for each chart tag'],
]) {
  const script = helmWorkflow?.jobs?.[jobName]?.steps?.find(
    (step) => step.name === stepName
  )?.run;
  check(
    typeof script === 'string' &&
      script.includes('set -euo pipefail') &&
      script.includes("mapfile -d '' -t chart_archives") &&
      script.includes('helm show chart "$chart_path"') &&
      script.includes('${#chart_archives[@]} > 20'),
    `helm.yml: ${jobName} must validate bounded chart artifacts from Helm metadata`
  );
}

const releaseValidation = workflows
  .get('release.yml')
  ?.workflow?.jobs?.[
    'validate-main-tag'
  ]?.steps?.find((step) => step.name === 'Ensure tag is on main')?.run;
check(
  workflows.get('release.yml')?.workflow?.jobs?.['validate-main-tag']?.[
    'runs-on'
  ] === 'ubuntu-latest',
  'release.yml: untrusted release tag validation must run on a hosted runner'
);
check(
  typeof releaseValidation === 'string' &&
    releaseValidation.includes("$GITHUB_REF_TYPE\" != 'tag'") &&
    releaseValidation.includes('^v[0-9][0-9A-Za-z._+-]{0,126}$') &&
    releaseValidation.includes('git merge-base --is-ancestor'),
  'release.yml: release authority must require a bounded tag contained in main'
);

const renovateFile = 'renovate-helm-custom-hooks.yml';
const renovate = workflows.get(renovateFile);
if (!renovate) {
  failures.push(`${renovateFile}: required workflow is missing or invalid`);
} else {
  const { source, workflow } = renovate;
  const render = workflow.jobs?.render;
  const publish = workflow.jobs?.publish;

  check(
    Boolean(workflow.on?.pull_request),
    `${renovateFile}: must use pull_request`
  );
  check(
    !/\bpull_request_target\s*:/u.test(source),
    `${renovateFile}: must not execute Renovate content with pull_request_target`
  );
  check(Boolean(render), `${renovateFile}: render job is missing`);
  check(Boolean(publish), `${renovateFile}: publish job is missing`);
  check(
    !/(?:\$GITHUB_SHA|github\.sha)/u.test(source),
    `${renovateFile}: PR commits must use pull_request.head.sha, not the merge SHA`
  );

  if (render) {
    check(
      JSON.stringify(render.permissions) ===
        JSON.stringify({ contents: 'read' }),
      `${renovateFile}: render job must have only contents: read`
    );
    const renderCondition = String(render.if ?? '');
    for (const requiredCondition of [
      "github.actor == 'renovate[bot]'",
      "github.event.pull_request.user.login == 'renovate[bot]'",
      'github.event.pull_request.head.repo.full_name == github.repository',
      "startsWith(github.event.pull_request.head.ref, 'renovate/')",
    ]) {
      check(
        renderCondition.includes(requiredCondition),
        `${renovateFile}: render job is missing condition: ${requiredCondition}`
      );
    }

    const renderText = JSON.stringify(render);
    check(
      !/(?:secrets\.|private-key|create-github-app-token|permission-contents)/iu.test(
        renderText
      ),
      `${renovateFile}: untrusted render job must not receive secrets or write-token authority`
    );
    const checkout = render.steps?.find((step) =>
      String(step.uses ?? '').startsWith('actions/checkout@')
    );
    check(
      Boolean(checkout),
      `${renovateFile}: render checkout step is missing`
    );
    if (checkout) {
      check(
        checkout.with?.ref === '${{ github.event.pull_request.head.sha }}',
        `${renovateFile}: render must checkout the exact PR head commit`
      );
      check(
        checkout.with?.['persist-credentials'] === false,
        `${renovateFile}: render checkout must disable credential persistence`
      );
    }
  }

  if (publish) {
    check(
      JSON.stringify(publish.permissions) ===
        JSON.stringify({ contents: 'read' }),
      `${renovateFile}: publish job must have only contents: read at job scope`
    );
    const publishSteps = publish.steps ?? [];
    check(
      !publishSteps.some((step) =>
        String(step.uses ?? '').startsWith('actions/checkout@')
      ),
      `${renovateFile}: credentialed publish job must not checkout repository content`
    );

    const validationIndex = publishSteps.findIndex(
      (step) => step.name === 'Validate generated change manifest'
    );
    const tokenIndex = publishSteps.findIndex((step) =>
      String(step.uses ?? '').startsWith('actions/create-github-app-token@')
    );
    const commitIndex = publishSteps.findIndex(
      (step) => step.name === 'Commit validated generated changes'
    );
    check(
      validationIndex >= 0,
      `${renovateFile}: manifest validation step is missing`
    );
    check(tokenIndex >= 0, `${renovateFile}: app-token step is missing`);
    check(commitIndex >= 0, `${renovateFile}: commit step is missing`);
    check(
      validationIndex >= 0 &&
        !publishSteps.slice(0, validationIndex).some((step) => step.run),
      `${renovateFile}: publish must not execute shell code before manifest validation`
    );
    check(
      validationIndex < tokenIndex && tokenIndex < commitIndex,
      `${renovateFile}: validation must finish before token creation and commit`
    );

    const tokenStep = publishSteps[tokenIndex];
    if (tokenStep) {
      check(
        tokenStep.with?.['permission-contents'] === 'write',
        `${renovateFile}: app token must request only explicit contents write authority`
      );
      check(
        tokenStep.with?.owner === undefined &&
          tokenStep.with?.repositories === undefined,
        `${renovateFile}: app token must remain scoped to the current repository`
      );
    }

    const validationScript = publishSteps[validationIndex]?.run ?? '';
    for (const requiredBoundary of [
      'artifact_entries=',
      'keys == ["branch", "expectedHeadOid", "fileChanges", "repository"]',
      '(.fileChanges.deletions == [])',
      'length >= 1 and length <= 20',
      'total_bytes > 2097152',
    ]) {
      check(
        validationScript.includes(requiredBoundary),
        `${renovateFile}: manifest validator is missing boundary: ${requiredBoundary}`
      );
    }
  }
}

console.log('Workflow boundary check');
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${workflowFiles.length} workflows; action pins and Renovate privilege boundaries are intact.`
  );
}
