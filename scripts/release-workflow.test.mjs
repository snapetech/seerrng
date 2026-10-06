import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';
import { splitDiscordReleaseBody } from './discord-release-notes.mjs';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const workflowDirectory = path.join(rootDirectory, '.github', 'workflows');
const readWorkflow = (name) =>
  yaml.load(fs.readFileSync(path.join(workflowDirectory, name), 'utf8'));

test('release assets build while image verification runs, then package channels wait for both', () => {
  const release = readWorkflow('release.yml');
  const assetBuild = release.jobs['build-release-assets'];
  const packageDispatch = release.jobs['dispatch-package-channels'];
  const publishRelease = release.jobs['publish-release'];
  const dispatchScript = packageDispatch.steps.find(
    (step) => step.name === 'Dispatch package workflows'
  ).run;

  assert.equal(
    release.on.workflow_dispatch.inputs.reuse_package_workflow_runs.default,
    '{}'
  );
  assert.equal(
    packageDispatch.steps[0].uses,
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
  );
  assert.equal(assetBuild.uses, './.github/workflows/release-assets.yml');
  assert.deepEqual(assetBuild.needs, [
    'validate-main-tag',
    'create-draft-release',
  ]);
  assert.equal(assetBuild.needs.includes('verify'), false);
  assert.equal(assetBuild.with.tag, '${{ inputs.tag || github.ref_name }}');
  assert.equal(assetBuild.permissions.actions, 'read');
  assert.deepEqual(packageDispatch.needs, ['verify', 'build-release-assets']);
  assert.equal(packageDispatch['timeout-minutes'], 360);
  assert.match(dispatchScript, /--ref main/u);
  assert.match(dispatchScript, /release-chocolatey\.yml/u);
  assert.match(dispatchScript, /release-linux-packages\.yml/u);
  assert.match(
    dispatchScript,
    /required_workflows=\([\s\S]*release-copr\.yml/u
  );
  assert.match(
    dispatchScript,
    /optional_workflows=\([\s\S]*release-snap\.yml/u
  );
  assert.match(dispatchScript, /watch-github-run\.mjs/u);
  assert.match(dispatchScript, /REUSE_PACKAGE_WORKFLOW_RUNS/u);
  assert.match(
    dispatchScript,
    /repos\/\$REPO\/actions\/runs\/\$reused_run_id/u,
    'reused package runs must be fetched from this repository'
  );
  assert.match(
    dispatchScript,
    /\.status == "completed" and[\s\S]*\.conclusion == "success"/u,
    'only successful completed package runs may be reused'
  );
  assert.match(
    dispatchScript,
    /RELEASE_TAG: \$TAG/u,
    'reused package runs must prove they built the requested release tag'
  );
  assert.match(
    dispatchScript,
    /Skipping optional Chocolatey and Snap workflows during release recovery/u
  );
  assert.match(
    dispatchScript,
    /node scripts\/watch-github-run\.mjs[\s\S]*\) &/u,
    'required package channels must be monitored concurrently'
  );
  assert.match(
    dispatchScript,
    /Optional package workflow .*could not be dispatched; continuing/u
  );
  assert.match(
    dispatchScript,
    /Skipping stable package channels for pre-release/u
  );
  const inventoryScript = packageDispatch.steps.find(
    (step) => step.name === 'Verify release package assets'
  ).run;
  assert.match(
    inventoryScript,
    /gh release view .*--json assets/u,
    'package inventory must inspect draft releases through the GitHub CLI'
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
  assert.match(
    discordStep.run,
    /curl --fail --silent --show-error/u,
    'Discord delivery must fail the release when the webhook returns HTTP error'
  );
});

test('container workflows use the canonical lowercase GitHub Container Registry path', () => {
  const expectedImage = 'ghcr.io/snapetech/seerrng';
  for (const name of [
    'ci.yml',
    'helm.yml',
    'preview.yml',
    'release.yml',
    'trivy-scan.yml',
  ]) {
    const source = fs.readFileSync(path.join(workflowDirectory, name), 'utf8');
    assert.equal(readWorkflow(name).env.GHCR_IMAGE, expectedImage, name);
    assert.doesNotMatch(
      source,
      /ghcr\.io\/\$\{GITHUB_REPOSITORY\}|ghcr\.io\/\$\{\{ github\.repository \}\}/u,
      `${name} must not interpolate the case-sensitive GitHub repository name into an OCI image reference`
    );
  }
  const release = readWorkflow('release.yml');
  const digestResolver = release.jobs.publish.steps.find(
    (step) => step.name === 'Resolve manifest digest'
  );
  assert.match(digestResolver.run, /image="\$\{GHCR_IMAGE\}:\$\{VERSION\}"/u);
});

test('AppImage pins its builder, uses the current launcher, and excludes binaries above its glibc baseline', () => {
  const workflow = readWorkflow('release-linux-packages.yml');
  const job = workflow.jobs.appimage;
  const launcherCheckout = job.steps.find(
    (step) => step.name === 'Checkout AppImage launcher files from main'
  );
  const build = job.steps.find((step) => step.name === 'Build AppImage');
  const smoke = job.steps.find((step) => step.name === 'Smoke-test AppImage');
  const appRun = fs.readFileSync(
    path.join(rootDirectory, 'packaging', 'appimage', 'AppRun'),
    'utf8'
  );
  const applicationPackage = JSON.parse(
    fs.readFileSync(path.join(rootDirectory, 'package.json'), 'utf8')
  );
  const desktop = fs.readFileSync(
    path.join(rootDirectory, 'packaging', 'appimage', 'seerrng.desktop'),
    'utf8'
  );

  assert.equal(launcherCheckout.with.ref, 'main');
  assert.equal(launcherCheckout.with.path, 'appimage-packaging');
  assert.match(
    build.run,
    /appimagetool_url='https:\/\/github\.com\/AppImage\/appimagetool\/releases\/download\/1\.9\.1\/appimagetool-x86_64\.AppImage'/u,
    'AppImage must use a versioned appimagetool release instead of the mutable continuous asset'
  );
  assert.match(
    build.run,
    /ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0/u,
    'AppImage must verify the upstream appimagetool release digest'
  );
  assert.match(build.run, /@next\/swc-linux-x64-gnu/u);
  assert.ok(
    build.run.includes(`${applicationPackage.dependencies.next})`),
    'AppImage must pin its WASM compiler to the app’s Next.js version'
  );
  assert.match(build.run, /@next\/swc-wasm-nodejs/u);
  assert.match(
    build.run,
    /require\(require\('node:path'\)\.resolve\(process\.argv\[1\]\)\)/u,
    'AppImage must resolve the extracted Next.js package.json as a filesystem path'
  );
  assert.match(
    build.run,
    /next_directory="\$app_dir\/node_modules\/next"[\s\S]*swc_wasm_directory="\$next_directory\/wasm\/@next\/swc-wasm-nodejs"/u
  );
  assert.match(
    build.run,
    /sha512-Qbh5QIWcyzZfp\+neSFDxSaS0PjyCv7NUVipXcOaEp0\+bCAynyGAoGnZirESQyPwpn\/VXBncpZCVa0cnD\+EWDmQ==/u
  );
  assert.match(
    build.run,
    /manylinux_2_28_x86_64@sha256:[a-f0-9]{64}/u,
    'AppImage native modules must be rebuilt in the pinned glibc 2.28 environment'
  );
  assert.match(
    build.run,
    /node-gyp rebuild --release --force_build=1 --nodedir=\/node-runtime/u,
    'AppImage must compile better-sqlite3 from source for its Node runtime'
  );
  assert.match(
    build.run,
    /npm install --global --prefix \/tmp\/node-tooling/u,
    'AppImage must keep node-gyp installation outside its read-only Node runtime mount'
  );
  assert.match(
    build.run,
    /install -m 0644 build\/Release\/better_sqlite3\.node prebuilds\/linux-x64\.node/u,
    'AppImage must replace the incompatible upstream x64 SQLite prebuild'
  );
  assert.ok(
    build.run.includes("sed -n 's/^[[:space:]]*Machine:[[:space:]]*//p'"),
    'AppImage compatibility checks must ignore ELF binaries for other architectures'
  );
  assert.match(build.run, /dpkg --compare-versions[\s\S]*gt 2\.29/u);
  assert.match(smoke.run, /--appimage-extract-and-run/u);
  assert.match(smoke.run, /api\/v1\/settings\/public/u);
  assert.match(appRun, /xdg-open[\s\S]*127\.0\.0\.1/mu);
  assert.match(desktop, /^Exec=AppRun$/mu);
  assert.match(desktop, /^Terminal=false$/mu);
});

test('release asset publication can download artifacts from the same run', () => {
  const assets = readWorkflow('release-assets.yml');

  assert.equal(assets.jobs.publish.permissions.actions, 'read');
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

test('Chocolatey packages only verified Windows release archives', () => {
  const workflow = readWorkflow('release-chocolatey.yml');
  const job = workflow.jobs['publish-chocolatey'];
  const steps = job.steps.map((step) => step.run ?? '').join('\n');

  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(job['runs-on'], 'windows-latest');
  assert.match(
    steps,
    /merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/u
  );
  assert.match(steps, /Get-FileHash[\s\S]*SHA-256 mismatch/u);
  assert.match(steps, /CHOCOLATEY_API_KEY/u);
  assert.match(steps, /choco push/u);
});

test('Launchpad retries for the same release tag are serialized', () => {
  const ppa = readWorkflow('release-ppa.yml');

  assert.equal(
    ppa.concurrency.group,
    'release-ppa-${{ inputs.tag || github.ref_name }}'
  );
  assert.equal(ppa.concurrency['cancel-in-progress'], false);
  assert.equal(ppa.jobs['publish-ppa']['timeout-minutes'], 360);
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

test('all container vulnerability scans use an available pinned Trivy release', () => {
  for (const workflowName of ['ci.yml', 'trivy-scan.yml', 'release.yml']) {
    const workflowText = fs.readFileSync(
      path.join(workflowDirectory, workflowName),
      'utf8'
    );
    assert.match(workflowText, /aquasecurity\/setup-trivy@/u);
    assert.match(workflowText, /version: v0\.74\.0/u);
    assert.doesNotMatch(workflowText, /version: 0\.58\.2/u);
    assert.match(workflowText, /--exit-code 1/u);
    assert.match(workflowText, /--severity HIGH,CRITICAL/u);
    assert.match(workflowText, /--ignore-unfixed/u);
  }
  const gitlab = fs.readFileSync(
    path.join(rootDirectory, '.gitlab-ci.yml'),
    'utf8'
  );
  assert.match(gitlab, /aquasec\/trivy:0\.74\.0@sha256:/u);
  assert.match(
    gitlab,
    /trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed/u
  );
});

test('multi-architecture publishers perform the real build once and verify the index', () => {
  const ci = readWorkflow('ci.yml');
  const preview = readWorkflow('preview.yml');
  const release = readWorkflow('release.yml');

  assert.equal(ci.jobs.build, undefined);
  assert.equal(ci.jobs.publish.if, "github.ref == 'refs/heads/main'");
  assert.equal(ci.jobs.publish.needs, undefined);
  assert.equal(ci.on.workflow_dispatch.inputs.deploy_main.default, true);
  assert.equal(ci.on.workflow_dispatch.inputs.deploy_main.type, 'boolean');
  assert.equal(
    ci.jobs.publish.outputs.image_digest,
    '${{ steps.resolve-digest.outputs.image_digest }}'
  );
  assert.deepEqual(ci.jobs['deploy-main'].needs, [
    'publish',
    'preflight-deploy',
  ]);
  assert.equal(
    ci.jobs['preflight-deploy'].outputs.ready,
    '${{ steps.verify-storage.outputs.ready }}'
  );
  assert.match(
    ci.jobs['preflight-deploy'].steps.find(
      (step) =>
        step.name === 'Verify deployment storage and determine readiness'
    ).run,
    /live deployment will remain skipped until the host is repaired/u
  );
  assert.match(
    ci.jobs['preflight-deploy'].steps.find(
      (step) =>
        step.name === 'Verify deployment storage and determine readiness'
    ).run,
    /ready=false/u
  );
  assert.equal(
    ci.jobs['deploy-main'].if,
    "github.ref == 'refs/heads/main' && needs.preflight-deploy.outputs.ready == 'true' && (github.event_name != 'workflow_dispatch' || inputs.deploy_main)"
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
  assert.equal(ci.jobs['scan-main-image'].needs, 'publish');
  assert.deepEqual(ci.jobs['scan-main-image'].strategy.matrix.include, [
    { platform: 'linux/amd64', suffix: 'amd64' },
    { platform: 'linux/arm64', suffix: 'arm64' },
  ]);
  assert.match(
    ci.jobs['scan-main-image'].steps.find(
      (step) => step.name === 'Run Trivy image scan'
    ).run,
    /\$\{GHCR_IMAGE\}@\$\{IMAGE_DIGEST\}/u
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
  const releaseCommit = release.jobs.publish.steps.find(
    (step) => step.name === 'Resolve release commit'
  );
  assert.equal(releaseCommit.id, 'release');
  assert.match(releaseCommit.run, /git rev-parse.*RELEASE_TAG/iu);
  const metadata = release.jobs.publish.steps.find(
    (step) => step.name === 'Extract metadata'
  );
  assert.match(
    metadata.with.labels,
    /org\.opencontainers\.image\.revision=\$\{\{ steps\.release\.outputs\.SHA \}\}/u,
    'release image metadata must identify the tagged source commit'
  );
  assert.match(
    metadata.with.annotations,
    /org\.opencontainers\.image\.revision=\$\{\{ steps\.release\.outputs\.SHA \}\}/u,
    'release image annotations must identify the tagged source commit'
  );
  const buildStep = release.jobs.publish.steps.find(
    (step) => step.name === 'Build & Push (multi-arch)'
  );
  assert.match(
    buildStep.run,
    /release_sha="\$\{\{ steps\.release\.outputs\.SHA \}\}"/u,
    'release image contents and metadata must use the same tagged source commit'
  );
  assert.match(
    buildStep.env.IMAGE_ANNOTATIONS,
    /steps\.meta\.outputs\.annotations/u,
    'release image builds must receive OCI annotations from metadata'
  );
  assert.match(
    buildStep.run,
    /--annotation/u,
    'release image builds must publish the tagged source commit as an OCI annotation'
  );
  assert.match(
    release.jobs.publish.steps.find(
      (step) => step.name === 'Verify published architectures'
    ).run,
    /verify-container-manifest\.sh --require-provenance/u
  );
  const digestResolver = release.jobs.publish.steps.find(
    (step) => step.name === 'Resolve manifest digest'
  );
  assert.match(
    digestResolver.run,
    /image="\$\{GHCR_IMAGE\}:\$\{VERSION\}"/u,
    'release digest resolution must use GHCR rather than the unreachable Docker Hub blob mirror'
  );
  assert.match(
    digestResolver.run,
    /docker buildx imagetools inspect "\$image"/u
  );
  assert.doesNotMatch(
    digestResolver.run,
    /DOCKER_HUB/u,
    'the digest resolver must not fetch the Docker Hub CloudFront-backed manifests'
  );
  assert.deepEqual(release.jobs['scan-release-image'].needs, 'publish');
  assert.deepEqual(release.jobs['scan-release-image'].strategy.matrix.include, [
    { platform: 'linux/amd64', suffix: 'amd64' },
    { platform: 'linux/arm64', suffix: 'arm64' },
  ]);
  assert.deepEqual(release.jobs.sign.needs, ['publish', 'scan-release-image']);
  assert.match(
    release.jobs['scan-release-image'].steps.find(
      (step) => step.name === 'Run Trivy image scan'
    ).run,
    /needs\.publish\.outputs\.image_digest/u
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
  assert.equal(workflowCall.inputs.reuse_from_run_id.required, false);
  assert.equal(workflowCall.inputs.reuse_from_run_id.type, 'string');
  assert.equal(workflowCall.inputs.reuse_from_run_id.default, '');
  assert.equal(assets.jobs.build['timeout-minutes'], 45);
  assert.match(resolve.if, /github\.event_name != 'workflow_dispatch'/u);
  assert.match(resolve.if, /github\.ref == 'refs\/heads\/main'/u);
  assert.equal(workflowCall.inputs.reuse_windows_x64_artifact.type, 'boolean');
  assert.equal(
    workflowCall.inputs.reuse_windows_arm64_artifact.type,
    'boolean'
  );
  assert.equal(workflowCall.inputs.reuse_windows_arm64_artifact.default, false);
  assert.match(
    resolve.steps.find((step) => step.name === 'Resolve version').env
      .RELEASE_TAG,
    /inputs\.tag/u
  );
});

test('release recovery validates reusable artifacts and repairs the failed release stage', () => {
  const release = readWorkflow('release.yml');
  const assets = readWorkflow('release-assets.yml');
  const inputs = release.on.workflow_dispatch.inputs;
  const recoveryValidation = release.jobs['validate-main-tag'].steps.find(
    (step) => step.name === 'Validate previous run artifacts for recovery'
  );
  const imageBuild = release.jobs.publish.steps.find(
    (step) => step.name === 'Build & Push (multi-arch)'
  );
  const imageReuse = release.jobs.publish.steps.find(
    (step) =>
      step.name ===
      'Verify and reuse published image for this exact release commit'
  );
  const assetBuild = release.jobs['build-release-assets'];
  const reusedArtifactDownload = assets.jobs.build.steps.find(
    (step) => step.name === 'Download validated artifacts from previous run'
  );

  assert.equal(inputs.reuse_from_run_id.type, 'string');
  assert.equal(inputs.reuse_published_image.type, 'boolean');
  assert.equal(inputs.reuse_published_image.default, false);
  assert.equal(recoveryValidation.if, "inputs.reuse_from_run_id != ''");
  assert.equal(release.jobs['validate-main-tag'].permissions.actions, 'read');
  assert.match(
    release.jobs['validate-main-tag'].outputs.reuse_windows_x64_artifact,
    /steps\.recovery\.outputs/u
  );
  assert.match(
    release.jobs['validate-main-tag'].outputs.reuse_windows_arm64_artifact,
    /steps\.recovery\.outputs/u
  );
  assert.match(recoveryValidation.run, /\.head_sha == \$sha/u);
  assert.match(
    recoveryValidation.run,
    /Build release assets \/ Build windows x64/u
  );
  assert.match(
    recoveryValidation.run,
    /Build release assets \/ Upload release assets/u
  );
  assert.match(
    recoveryValidation.run,
    /\["Dispatch package channels"\]/u,
    'a package-channel-only failure must be recoverable from verified assets'
  );
  assert.match(
    recoveryValidation.run,
    /reuse_windows_arm64_artifact=true/u,
    'package-only recovery must preserve the successful Windows ARM64 artifact'
  );
  assert.match(recoveryValidation.run, /event == "workflow_dispatch"/u);
  assert.match(recoveryValidation.run, /\.expired == false/u);
  assert.match(imageBuild.if, /inputs\.reuse_published_image != true/u);
  assert.match(imageReuse.if, /inputs\.reuse_published_image == true/u);
  assert.match(imageReuse.run, /org\.opencontainers\.image\.revision/u);
  assert.match(imageReuse.run, /EXPECTED_SHA/u);
  assert.deepEqual(assetBuild.needs, [
    'validate-main-tag',
    'create-draft-release',
  ]);
  assert.match(
    assetBuild.with.reuse_windows_x64_artifact,
    /needs\.validate-main-tag\.outputs\.reuse_windows_x64_artifact/u
  );
  assert.match(
    assetBuild.with.reuse_windows_arm64_artifact,
    /needs\.validate-main-tag\.outputs\.reuse_windows_arm64_artifact/u
  );
  assert.equal(
    assetBuild.with.reuse_from_run_id,
    "${{ inputs.reuse_from_run_id || '' }}"
  );
  assert.equal(
    reusedArtifactDownload.with['run-id'],
    '${{ inputs.reuse_from_run_id }}'
  );
  assert.match(
    reusedArtifactDownload.if,
    /inputs\.reuse_windows_x64_artifact == true/u
  );
  assert.match(
    reusedArtifactDownload.if,
    /inputs\.reuse_windows_arm64_artifact == true/u
  );
  assert.match(
    assets.jobs.build.steps.find((step) => step.name === 'Build archive').if,
    /matrix\.arch == 'arm64'/u
  );
  assert.match(
    assets.jobs.build.steps.find((step) => step.name === 'Build archive').if,
    /inputs\.reuse_windows_arm64_artifact != true/u,
    'recovery must skip a successful Windows ARM64 rebuild'
  );
  assert.match(
    assets.jobs.build.steps.find(
      (step) => step.name === 'Install node-gyp for Visual Studio 2026'
    ).if,
    /inputs\.reuse_windows_arm64_artifact != true/u,
    'recovery must skip ARM64 build-tool setup when reusing its artifact'
  );
  assert.match(
    assets.jobs.build.steps.find((step) => step.name === 'Build archive').env
      .SEERRNG_RELEASE_ARCH,
    /matrix\.arch/u
  );
});

test('release assets build supported native archive platforms', () => {
  const assets = readWorkflow('release-assets.yml');
  const build = assets.jobs.build;
  const publish = assets.jobs.publish;
  const downloadAssets = publish.steps.find(
    (step) => step.name === 'Download built assets'
  );
  const flattenAssets = publish.steps.find(
    (step) => step.name === 'Flatten downloaded release assets'
  );
  const verifyInventory = publish.steps.find(
    (step) => step.name === 'Verify archive inventory and checksums'
  ).run;
  const archiveBuild = build.steps.find(
    (step) => step.name === 'Build archive'
  );
  const releaseTooling = build.steps.find(
    (step) => step.name === 'Checkout release tooling'
  );
  const buildScript = fs.readFileSync(
    path.join(rootDirectory, 'scripts', 'build-release-assets.sh'),
    'utf8'
  );

  assert.deepEqual(build.strategy.matrix.include, [
    {
      runner: 'ubuntu-latest',
      os: 'linux',
      arch: 'x64',
      pnpm_version: '10.24.0',
    },
    {
      runner: 'ubuntu-24.04-arm',
      os: 'linux',
      arch: 'arm64',
      pnpm_version: '10.24.0',
    },
    {
      runner: 'macos-15',
      os: 'macos',
      arch: 'arm64',
      pnpm_version: '10.24.0',
    },
    {
      runner: 'macos-15-intel',
      os: 'macos',
      arch: 'x64',
      pnpm_version: '10.24.0',
    },
    {
      runner: 'windows-2022',
      os: 'windows',
      arch: 'x64',
      pnpm_version: '10.24.0',
      msvs_version: 'auto',
    },
    {
      runner: 'windows-11-vs2026-arm',
      os: 'windows',
      arch: 'arm64',
      pnpm_version: '10.24.0',
      msvs_version: '2026',
    },
  ]);
  assert.equal(
    archiveBuild.env.GYP_MSVS_VERSION,
    "${{ matrix.msvs_version || 'auto' }}"
  );
  assert.equal(archiveBuild.env.npm_config_msvs_version, undefined);
  assert.match(
    build.steps.find(
      (step) => step.name === 'Install node-gyp for Visual Studio 2026'
    ).run,
    /npm_config_msvs_version=2026/u
  );

  assert.equal(assets.jobs['build-linux-arm'], undefined);
  assert.deepEqual(publish.needs, [
    'resolve',
    'build',
    'build-jellyfin-plugin',
  ]);
  assert.equal(downloadAssets.with.path, 'dist-release/downloaded');
  assert.equal(downloadAssets.with['merge-multiple'], undefined);
  assert.match(flattenAssets.run, /Unexpected file in release artifact/u);
  assert.match(
    flattenAssets.run,
    /Duplicate release asset filename.*collides with/u
  );
  assert.match(flattenAssets.run, /windows-arm64.*expected_archive/u);
  assert.match(flattenAssets.run, /find "\$downloads" -type f/u);
  assert.match(releaseTooling.with.ref, /github\.sha/u);
  assert.equal(releaseTooling.with.path, '.release-tooling');
  assert.equal(releaseTooling.with['sparse-checkout'], 'scripts');
  assert.match(
    archiveBuild.run,
    /\.release-tooling\/scripts\/build-release-assets\.sh/u
  );
  assert.match(buildScript, /node -p 'process\.arch'/u);
  assert.doesNotMatch(buildScript, /uname -m/u);
  assert.match(verifyInventory, /sha256sum -c/u);
  for (const archive of [
    'seerrng-${TAG}-macos-x64.tar.gz',
    'seerrng-${TAG}-windows-arm64.zip',
  ]) {
    assert.ok(
      verifyInventory.includes(`"${archive}"`),
      `expected the release-asset inventory check to require ${archive}`
    );
  }

  const release = readWorkflow('release.yml');
  const requiredAssets = release.jobs['dispatch-package-channels'].steps.find(
    (step) => step.name === 'Verify release package assets'
  ).run;
  for (const archive of [
    'seerrng-${TAG}-macos-x64.tar.gz',
    'seerrng-${TAG}-windows-arm64.zip',
  ]) {
    assert.ok(
      requiredAssets.includes(`"${archive}"`),
      `expected the release gate to require ${archive}`
    );
  }
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
  const commitStep = createTag.steps.find(
    (step) => step.name === 'Commit updated files'
  );
  assert.match(
    commitStep.run,
    /git add CHANGELOG\.md package\.json charts\/seerr-chart\/Chart\.yaml charts\/seerr-chart\/README\.md/u
  );
  assert.match(commitStep.run, /release-note: none/u);
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
  const discordScript = discord.steps.find(
    (step) => step.name === 'Send Discord announcement'
  ).run;
  assert.ok(
    discord.steps.some((step) => step.name === 'Checkout release tooling')
  );
  assert.match(discordScript, /discord-release-notes\.mjs --split/u);
  assert.match(discordScript, /wait=true/u);
  assert.doesNotMatch(
    discordScript,
    /3797|3800/u,
    'Discord announcements must not silently truncate later release-note sections'
  );
});

test('release automation does not publish YunoHost packages', () => {
  const release = readWorkflow('release.yml');
  assert.equal(release.jobs['sync-yunohost-package'], undefined);
});

test('Discord release-note chunks preserve all text and stay within the limit', () => {
  const body = '#### Security\n- Secure every copy 🛡️.\n\n'.repeat(240);
  const chunks = splitDiscordReleaseBody(body, 3600);

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), body);
  assert.ok(chunks.every((chunk) => chunk.length <= 3600));
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/u.test(chunk)));
  assert.throws(
    () => splitDiscordReleaseBody('🛡️', 1),
    /cannot fit this Unicode character/u
  );
});

test('a workflow dispatch can correct omitted notes for a published release', () => {
  const release = readWorkflow('release.yml');
  const correction = release.jobs['announce-security-correction'];

  assert.equal(
    release.on.workflow_dispatch.inputs.announce_security_correction.type,
    'boolean'
  );
  assert.equal(
    correction.if,
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.announce_security_correction == true"
  );
  assert.match(
    correction.steps.find((step) => step.name === 'Post omitted security notes')
      .run,
    /releases\/tags\/\$\{TAG\}/u
  );
});

test('release platform digest validation is portable across grep implementations', () => {
  const releaseText = fs.readFileSync(
    path.join(workflowDirectory, 'release.yml'),
    'utf8'
  );

  assert.doesNotMatch(releaseText, /grep -Eq '\^(?:amd64|arm64)\\tsha256:/u);
  assert.equal((releaseText.match(/\[\[:blank:\]\]/gu) ?? []).length, 4);
});

test('release asset checksums match the builder sidecar names', () => {
  const releaseText = fs.readFileSync(
    path.join(workflowDirectory, 'release.yml'),
    'utf8'
  );
  const assetsText = fs.readFileSync(
    path.join(workflowDirectory, 'release-assets.yml'),
    'utf8'
  );

  assert.doesNotMatch(releaseText, /(?:\\.tar\\.gz|\\.zip)\\.sha256/u);
  assert.doesNotMatch(
    assetsText,
    /checksum="dist-release\/\$archive\.sha256"/u
  );
  assert.match(assetsText, /archive_base="\$\{archive%\.tar\.gz\}"/u);
  assert.match(assetsText, /archive_base="\$\{archive_base%\.zip\}"/u);
});

test('pull-request CI publishes the exact release-note preview', () => {
  const ci = readWorkflow('ci.yml');
  const validation = ci.jobs['release-notes'].steps.find(
    (step) => step.name === 'Validate release-note fragment or explicit opt-out'
  );

  assert.ok(validation);
  assert.equal(
    validation.env.PR_BODY,
    "${{ github.event_name == 'pull_request' && github.event.pull_request.body || github.event.head_commit.message || '' }}"
  );
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
