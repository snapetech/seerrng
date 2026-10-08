// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import {
  createCodeqlSteps,
  readCodeqlQueryPackMetadata,
  readCodeqlWorkflow,
  validateCodeqlOutputs,
} from '../tools/validation-engine/runtime/codeql-stage.mjs';

const workflowText = `matrix:\n  language: [actions, javascript]\n  queries: +security-and-quality\n  packs: \${{ matrix.language == 'javascript' && 'snapetech/seerrng-codeql-models@0.0.15' || '' }}\n  uses: github/codeql-action/init@${'a'.repeat(40)}\n  uses: github/codeql-action/autobuild@${'a'.repeat(40)}\n  uses: github/codeql-action/analyze@${'a'.repeat(40)}\n`;
const digest = 'b'.repeat(64);
const context = () => ({
  sourceRoot: '/source',
  scratchRoot: '/scratch/codeql',
  workflowText,
  capacity: { effectiveLogicalCpus: 4, configuredWorkers: 8 },
  memoryMb: 3072,
  sourceIdentity: { sha256: digest },
  toolchain: {
    cliPath: '/opt/codeql/codeql',
    cliVersion: '2.27.1',
    sha256: digest,
    packs: [
      { name: 'codeql/actions-queries', version: '0.6.36', sha256: digest },
      { name: 'codeql/javascript-queries', version: '2.4.6', sha256: digest },
      {
        name: 'snapetech/seerrng-codeql-models',
        version: '0.0.15',
        sha256: digest,
      },
    ],
  },
});
function completed(plan) {
  const files = new Map(
    plan.artifacts.map((artifact) => [artifact.path, artifact.contents])
  );
  for (const output of plan.outputs)
    files.set(
      output.path,
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            automationDetails: { id: `/language:${output.language}/` },
            tool: {
              driver: { name: 'CodeQL', semanticVersion: '2.27.1' },
              extensions: [
                {
                  name: output.queryPack.name,
                  semanticVersion:
                    output.queryPack.sarifSemanticVersion ??
                    output.queryPack.version,
                  rules: [{ id: 'native/query' }],
                },
              ],
            },
            invocations: [{ executionSuccessful: true }],
            results: [],
          },
        ],
      })
    );
  return {
    commandResults: plan.steps.map((step) => ({
      id: step.id,
      exitCode: 0,
      wallMs: 10,
    })),
    readFile: async (file) => {
      if (!files.has(file)) throw new Error('missing artifact');
      return files.get(file);
    },
    files,
  };
}
test('native workflow controls both language owners and model pack', () => {
  const plan = createCodeqlSteps(context());
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    [
      'codeql-actions-create',
      'codeql-actions-analyze',
      'codeql-javascript-create',
      'codeql-javascript-analyze',
    ]
  );
  assert.equal(plan.resources.threads, 4);
  assert.ok(
    plan.steps.every(
      (step) =>
        step.args.includes('--threads=4') && step.args.includes('--ram=3072')
    )
  );
  assert.ok(
    plan.steps[3].args.includes(
      '--model-packs=snapetech/seerrng-codeql-models@0.0.15'
    )
  );
  assert.ok(!plan.steps[1].args.some((arg) => arg.startsWith('--model-packs')));
  assert.ok(
    plan.artifacts.every(
      (artifact) =>
        JSON.parse(artifact.contents).queries[0].uses === 'security-and-quality'
    )
  );
  assert.ok(
    plan.steps[1].args.includes(
      'codeql/actions-queries@0.6.36:codeql-suites/actions-code-scanning.qls'
    )
  );
  assert.ok(
    plan.steps[1].args.includes(
      'codeql/actions-queries@0.6.36:codeql-suites/actions-security-and-quality.qls'
    )
  );
  assert.equal(plan.cache.resultReuse, false);
});

const vendorSha = '6e9f9e38390175c41b99070a423c875f450759ca';
const nativeManifest = (pack) =>
  `---\nname: ${pack.name}\nversion: ${pack.version}\nbuildMetadata:\n  sha: ${vendorSha}\n  cliVersion: 2.27.1\ndependencies:\n  codeql/suite-helpers: 1.0.58\n`;
function vendorContext() {
  const input = context();
  for (const pack of input.toolchain.packs.filter((pack) =>
    pack.name.startsWith('codeql/')
  )) {
    pack.root = `/opt/codeql/qlpacks/${pack.name}/${pack.version}`;
    Object.assign(
      pack,
      readCodeqlQueryPackMetadata(nativeManifest(pack), {
        ...pack,
        cliVersion: input.toolchain.cliVersion,
      })
    );
  }
  return input;
}
function vendorCompleted(plan) {
  const result = completed(plan);
  for (const output of plan.outputs)
    result.files.set(
      `${output.queryPack.root}/qlpack.yml`,
      nativeManifest(output.queryPack)
    );
  return result;
}
test('native vendor build identity is derived from the exact installed manifest', async () => {
  const plan = createCodeqlSteps(vendorContext());
  const receipt = await validateCodeqlOutputs(plan, vendorCompleted(plan));
  assert.equal(
    receipt.languages[0].queryPack.sarifSemanticVersion,
    `0.6.36+${vendorSha}`
  );
  assert.equal(
    receipt.languages[1].queryPack.sarifSemanticVersion,
    `2.4.6+${vendorSha}`
  );
  assert.equal(receipt.languages[0].queryPack.buildMetadataSha, vendorSha);
  for (const manifest of [
    nativeManifest(plan.outputs[0].queryPack).replace('2.27.1', '2.27.0'),
    nativeManifest(plan.outputs[0].queryPack).replace(vendorSha, 'unknown'),
    nativeManifest(plan.outputs[0].queryPack) +
      'name: codeql/actions-queries\n',
    nativeManifest(plan.outputs[0].queryPack).replace(
      'buildMetadata:',
      'buildMetadata: arbitrary'
    ),
    nativeManifest(plan.outputs[0].queryPack).replace(
      '  cliVersion:',
      `  sha: ${vendorSha}\n  cliVersion:`
    ),
  ])
    assert.throws(() =>
      readCodeqlQueryPackMetadata(manifest, {
        ...plan.outputs[0].queryPack,
        cliVersion: '2.27.1',
      })
    );
});
test('vendor metadata cannot conceal base, prerelease, build SHA or manifest drift', async () => {
  const plan = createCodeqlSteps(vendorContext());
  for (const version of [
    '0.6.36',
    '0.6.37',
    `0.6.36+${'a'.repeat(40)}`,
    `0.6.36-rc.1+${vendorSha}`,
    `0.6.36+${vendorSha}.extra`,
  ]) {
    const result = vendorCompleted(plan);
    const sarif = JSON.parse(result.files.get(plan.outputs[0].path));
    sarif.runs[0].tool.extensions[0].semanticVersion = version;
    result.files.set(plan.outputs[0].path, JSON.stringify(sarif));
    await assert.rejects(
      validateCodeqlOutputs(plan, result),
      /pack identity mismatch/
    );
  }
  const result = vendorCompleted(plan);
  result.files.set(
    `${plan.outputs[0].queryPack.root}/qlpack.yml`,
    nativeManifest(plan.outputs[0].queryPack) + '# changed\n'
  );
  await assert.rejects(validateCodeqlOutputs(plan, result), /manifest changed/);
  const input = vendorContext();
  input.toolchain.packs[0].sarifSemanticVersion = '0.6.36+arbitrary';
  assert.throws(() => createCodeqlSteps(input), /unsealed/);
});
test('ordinary local capacity, memory limits and pinned input closure fail closed', () => {
  assert.equal(
    createCodeqlSteps({
      ...context(),
      capacity: { effectiveLogicalCpus: 4, configuredWorkers: 3 },
    }).resources.threads,
    3
  );
  for (const memoryMb of [2047, 0, NaN])
    assert.throws(
      () => createCodeqlSteps({ ...context(), memoryMb }),
      /memory/
    );
  assert.throws(
    () => createCodeqlSteps({ ...context(), sourceIdentity: {} }),
    /manifest/
  );
  const input = context();
  input.toolchain.packs.pop();
  assert.throws(() => createCodeqlSteps(input), /model pack/);
});
test('unsafe paths and unsupported workflow revisions cannot silently reuse a recipe', () => {
  for (const scratchRoot of [
    '/source/scratch',
    '/scratch/../source',
    '/',
    'relative',
    '/scratch\nother',
  ])
    assert.throws(() => createCodeqlSteps({ ...context(), scratchRoot }));
  assert.throws(
    () =>
      readCodeqlWorkflow(
        workflowText.replace(
          '[actions, javascript]',
          '[actions, javascript, python]'
        )
      ),
    /matrix/
  );
  assert.throws(
    () =>
      readCodeqlWorkflow(
        workflowText.replace('+security-and-quality', 'security-extended')
      ),
    /query/
  );
  assert.throws(
    () => readCodeqlWorkflow(workflowText.replace('0.0.15', 'latest')),
    /model/
  );
});
test('complete native results retain findings without inventing a GitHub alert-count gate', async () => {
  const plan = createCodeqlSteps(context());
  const result = completed(plan);
  const sarif = JSON.parse(result.files.get(plan.outputs[1].path));
  sarif.runs[0].results.push({
    ruleId: 'js/native-query',
    level: 'error',
    message: { text: 'native finding' },
  });
  result.files.set(plan.outputs[1].path, JSON.stringify(sarif));
  const receipt = await validateCodeqlOutputs(plan, result);
  assert.equal(receipt.processStatus, 'passed');
  assert.equal(receipt.findingsStatus, 'findings-reported');
  assert.equal(receipt.findings, 1);
  assert.equal(receipt.wallMs, 40);
});
test('failed, aborted, duplicate or missing command receipts never pass', async () => {
  const plan = createCodeqlSteps(context());
  for (const mutation of [
    (value) => value.commandResults.pop(),
    (value) => {
      value.commandResults[0].exitCode = 2;
    },
    (value) => {
      value.commandResults[0].aborted = true;
    },
    (value) => {
      value.commandResults[0].id = value.commandResults[1].id;
    },
  ]) {
    const result = completed(plan);
    mutation(result);
    await assert.rejects(validateCodeqlOutputs(plan, result));
  }
});
test('invalid SARIF, failed invocation and pack drift block output acceptance', async () => {
  const plan = createCodeqlSteps(context());
  for (const mutation of [
    (sarif) => {
      sarif.runs = [];
    },
    (sarif) => {
      sarif.runs[0].invocations[0].executionSuccessful = false;
    },
    (sarif) => {
      sarif.runs[0].tool.extensions[0].semanticVersion = '9.9.9';
    },
    (sarif) => {
      sarif.runs[0].invocations[0].toolExecutionNotifications = [
        { level: 'error' },
      ];
    },
  ]) {
    const result = completed(plan);
    const sarif = JSON.parse(result.files.get(plan.outputs[0].path));
    mutation(sarif);
    result.files.set(plan.outputs[0].path, JSON.stringify(sarif));
    await assert.rejects(validateCodeqlOutputs(plan, result));
  }
  const result = completed(plan);
  result.files.delete(plan.outputs[1].path);
  await assert.rejects(validateCodeqlOutputs(plan, result));
});
test('sealed recipe and exact config hashes catch execution input drift', async () => {
  const plan = createCodeqlSteps(context());
  const result = completed(plan);
  result.files.set(plan.artifacts[0].path, '{}');
  await assert.rejects(
    validateCodeqlOutputs(plan, result),
    /configuration changed/
  );
  const changed = structuredClone(plan);
  changed.steps[0].args.push('--overwrite');
  await assert.rejects(
    validateCodeqlOutputs(changed, completed(plan)),
    /sealing/
  );
});
