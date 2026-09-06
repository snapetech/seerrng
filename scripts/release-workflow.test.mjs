import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const workflowDirectory = path.join(rootDirectory, '.github', 'workflows');
const readWorkflow = (name) =>
  yaml.load(fs.readFileSync(path.join(workflowDirectory, name), 'utf8'));

test('release package channels wait for the reusable release asset build', () => {
  const release = readWorkflow('release.yml');
  const assetBuild = release.jobs['build-release-assets'];
  const packageDispatch = release.jobs['dispatch-package-channels'];
  const publishRelease = release.jobs['publish-release'];
  const dispatchScript = packageDispatch.steps.find(
    (step) => step.name === 'Dispatch package workflows'
  ).run;

  assert.equal(assetBuild.uses, './.github/workflows/release-assets.yml');
  assert.equal(assetBuild.needs, 'verify');
  assert.equal(assetBuild.with.tag, '${{ inputs.tag || github.ref_name }}');
  assert.deepEqual(packageDispatch.needs, ['verify', 'build-release-assets']);
  assert.equal(packageDispatch['timeout-minutes'], 120);
  assert.match(dispatchScript, /--ref main/u);
  assert.match(dispatchScript, /release-linux-packages\.yml/u);
  assert.match(dispatchScript, /gh run watch/u);
  assert.match(
    dispatchScript,
    /Skipping stable package channels for pre-release/u
  );
  assert.deepEqual(publishRelease.needs, [
    'create-draft-release',
    'verify',
    'build-release-assets',
    'dispatch-package-channels',
  ]);
  assert.equal(
    release.jobs['announce-discord'].needs.includes('publish-release'),
    true
  );
  const discordStep = release.jobs['announce-discord'].steps.find(
    (step) => step.name === 'Send Discord announcement'
  );
  assert.equal(discordStep.if, undefined);
  assert.match(
    discordStep.run,
    /DISCORD_RELEASE_WEBHOOK is required to complete a release/u
  );
});

test('package workflows build the requested tag and reject tags outside main', () => {
  for (const workflowName of [
    'release-linux-packages.yml',
    'release-flatpak.yml',
    'release-ppa.yml',
    'release-copr.yml',
  ]) {
    const workflowText = fs.readFileSync(
      path.join(workflowDirectory, workflowName),
      'utf8'
    );
    assert.match(
      workflowText,
      /ref: \$\{\{ (?:github\.event\.inputs|steps\.version\.outputs)\.tag(?: \}\})?/u
    );
    assert.match(
      workflowText,
      /ensure-release-tag-on-main\.sh/u,
      `${workflowName} must verify tag ancestry before publishing`
    );
  }
});

test('release asset uploaders preserve the draft until the final publish gate', () => {
  for (const workflowName of [
    'release-assets.yml',
    'release-linux-packages.yml',
    'release-flatpak.yml',
  ]) {
    const workflowText = fs.readFileSync(
      path.join(workflowDirectory, workflowName),
      'utf8'
    );
    assert.match(
      workflowText,
      /softprops\/action-gh-release@[\s\S]*?draft: true/u
    );
  }
});

test('multi-architecture publishers perform the real build once and verify the index', () => {
  const ci = readWorkflow('ci.yml');
  const preview = readWorkflow('preview.yml');
  const release = readWorkflow('release.yml');

  assert.equal(ci.jobs.build, undefined);
  assert.equal(ci.jobs.publish.if, "github.ref == 'refs/heads/main'");
  assert.equal(ci.jobs.publish.needs, undefined);
  assert.deepEqual(ci.jobs['deploy-main'].needs, [
    'publish',
    'preflight-deploy',
  ]);
  assert.match(
    ci.jobs['preflight-deploy'].steps.find(
      (step) => step.name === 'Verify deployment storage is mounted read-write'
    ).run,
    /refusing deployment until the host is repaired/u
  );
  assert.match(
    ci.jobs.publish.steps.find(
      (step) => step.name === 'Build & Push (multi-arch, single tag)'
    ).run,
    /--platform linux\/amd64,linux\/arm64[\s\S]*--provenance mode=max/u
  );
  assert.match(
    ci.jobs.publish.steps.find(
      (step) => step.name === 'Verify published architectures'
    ).run,
    /verify-container-manifest\.sh --require-provenance/u
  );

  assert.equal(preview.jobs.build, undefined);
  assert.equal(preview.jobs.publish.needs, 'validate-main-tag');
  assert.match(
    preview.jobs.publish.steps.find(
      (step) => step.name === 'Verify published architectures'
    ).run,
    /verify-container-manifest\.sh --require-provenance[\s\S]*linux\/amd64 linux\/arm64/u
  );

  assert.equal(release.jobs.build, undefined);
  assert.deepEqual(release.jobs.publish.needs, [
    'validate-main-tag',
    'create-draft-release',
  ]);
  assert.match(
    release.jobs.publish.steps.find(
      (step) => step.name === 'Verify published architectures'
    ).run,
    /verify-container-manifest\.sh --require-provenance/u
  );
});

test('release publishing admits only tag pushes and main-branch retries', () => {
  const release = readWorkflow('release.yml');
  const validation = release.jobs['validate-main-tag'];
  const validationScript = validation.steps.find(
    (step) => step.name === 'Ensure tag is on main'
  ).run;

  assert.match(validation.if, /github\.event_name != 'workflow_dispatch'/u);
  assert.match(validation.if, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(validationScript, /\$GITHUB_EVENT_NAME" == 'push'/u);
  assert.match(validationScript, /\$GITHUB_REF_TYPE" != 'tag'/u);
  assert.match(validationScript, /git merge-base --is-ancestor/u);
});

test('release assets support trusted reuse and main-only manual dispatch', () => {
  const assets = readWorkflow('release-assets.yml');
  const workflowCall = assets.on.workflow_call;
  const resolve = assets.jobs.resolve;

  assert.equal(workflowCall.inputs.tag.required, true);
  assert.equal(workflowCall.inputs.tag.type, 'string');
  assert.equal(assets.jobs.build['timeout-minutes'], 45);
  assert.match(resolve.if, /github\.event_name != 'workflow_dispatch'/u);
  assert.match(resolve.if, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(
    resolve.steps.find((step) => step.name === 'Resolve version').env
      .RELEASE_TAG,
    /inputs\.tag/u
  );
});

test('tag preparation keeps Helm metadata aligned with the application release', () => {
  const createTag = readWorkflow('create-tag.yml').jobs['create-tag'];
  const syncStep = createTag.steps.find(
    (step) => step.name === 'Sync Helm chart release metadata'
  );

  assert.ok(syncStep);
  assert.match(syncStep.run, /charts\/seerr-chart\/Chart\.yaml/u);
  assert.match(syncStep.run, /appVersion:/u);
  assert.match(syncStep.run, /chart_patch=\$\(\(10#\$chart_patch \+ 1\)\)/u);
  assert.match(syncStep.run, /charts\/seerr-chart\/README\.md/u);
  assert.match(syncStep.run, /next_chart_version/u);
  assert.match(
    createTag.steps.find((step) => step.name === 'Commit updated files').run,
    /git add CHANGELOG\.md package\.json charts\/seerr-chart\/Chart\.yaml charts\/seerr-chart\/README\.md/u
  );
});

test('release notes flow into the draft release and Discord announcement', () => {
  const release = readWorkflow('release.yml');
  const changelog = release.jobs.changelog;
  const draft = release.jobs['create-draft-release'];
  const discord = release.jobs['announce-discord'];

  assert.equal(
    changelog.outputs.release_body,
    '${{ steps.release-body.outputs.release_body }}'
  );
  assert.match(
    changelog.steps.find((step) => step.name === 'Add curated release notes')
      .run,
    /assemble-release-notes\.mjs/u
  );
  assert.equal(draft.needs, 'changelog');
  assert.equal(
    draft.steps.find((step) => step.name === 'Draft Release').env.RELEASE_BODY,
    '${{ needs.changelog.outputs.release_body }}'
  );
  assert.deepEqual(discord.needs, [
    'changelog',
    'publish',
    'publish-release',
    'dispatch-package-channels',
  ]);
  assert.equal(
    discord.env.RELEASE_BODY,
    '${{ needs.changelog.outputs.release_body }}'
  );
});

test('pull-request CI publishes the exact release-note preview', () => {
  const ci = readWorkflow('ci.yml');
  const validation = ci.jobs['release-notes'].steps.find(
    (step) => step.name === 'Validate release-note fragment or explicit opt-out'
  );

  assert.ok(validation);
  assert.match(validation.run, /--summary-file "\$GITHUB_STEP_SUMMARY"/u);
});

test('tag preparation prepends the current changelog without replacing history', () => {
  const createTag = readWorkflow('create-tag.yml').jobs['create-tag'];
  const changelogStep = createTag.steps.find(
    (step) => step.name === 'Generate checked-in changelog'
  );
  const commitStep = createTag.steps.find(
    (step) => step.name === 'Commit updated files'
  );

  assert.ok(changelogStep);
  assert.match(
    changelogStep.run,
    /git-cliff[\s\S]*--unreleased[\s\S]*--output "\$current_changelog"/u
  );
  assert.match(changelogStep.run, /assemble-release-notes\.mjs/u);
  assert.match(changelogStep.run, /prepend-changelog-section\.mjs/u);
  assert.match(changelogStep.run, /--existing CHANGELOG\.md/u);
  assert.match(commitStep.run, /git add CHANGELOG\.md/u);
});

test('git-cliff skips all release-preparation commits', () => {
  const cliff = fs.readFileSync(
    path.join(rootDirectory, '.github', 'cliff.toml'),
    'utf8'
  );

  assert.match(cliff, /message = '\^chore\\\(release\\\):'/u);
});
