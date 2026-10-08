import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalJsonSha256,
  createRunScopedLedger,
  createSuccessReceipt,
  createWorkIdentity,
  mergeRunScopedLedgers,
  parseRunScopedLedger,
  parseSuccessReceipt,
  recordSuccessfulWork,
  serializeRunScopedLedger,
  serializeSuccessReceipt,
  verifyRunScopedLedger,
  verifySuccessReceipt,
  workKeySha256,
} from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const h = (character) => character.repeat(64);
const g = (character) => character.repeat(40);

function identityInput() {
  return {
    schema: 'seerrng-run-scoped-work-identity/v1',
    run: {
      provider: 'github-actions',
      repository: 'JohnCronk79/seerrng',
      runId: '10000000000000000001',
      runAttempt: '1',
    },
    candidate: {
      repository: 'JohnCronk79/seerrng',
      commit: g('a'),
      tree: g('b'),
      sourceSha256: h('c'),
    },
    planSha256: h('d'),
    unit: {
      id: 'ci-unit-test',
      definitionSha256: h('e'),
      testInventorySha256: h('f'),
      caseInventorySha256: h('0'),
    },
    command: {
      executable: 'pnpm',
      args: ['exec', 'vitest', '--run'],
      cwd: '.',
      environmentSha256: h('1'),
    },
    dependencies: {
      lockSha256: h('2'),
      stateSha256: h('3'),
    },
    toolchain: {
      toolsSha256: h('4'),
      runtimeSha256: h('5'),
    },
    runner: {
      image: 'node:24.21.0-alpine3.23@sha256:immutable',
      environmentSha256: h('6'),
    },
    setup: {
      setupSha256: h('7'),
      fixturesSha256: h('8'),
      configSha256: h('9'),
    },
    workflow: {
      workflowSha256: h('a'),
      actionsSha256: h('b'),
    },
  };
}

function evidence(character = 'c') {
  return {
    resultSha256: h(character),
    stdoutSha256: h('d'),
    stderrSha256: h('e'),
    artifactManifestSha256: h('f'),
    caseResultsSha256: h('0'),
  };
}

function scope(input = identityInput()) {
  return {
    run: input.run,
    candidate: input.candidate,
    planSha256: input.planSha256,
  };
}

const clone = (value) => structuredClone(value);

test('identity and success receipt construction is canonical and deterministic', () => {
  const input = identityInput();
  const identity = createWorkIdentity(input);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const otherIdentity = createWorkIdentity(reordered);
  assert.deepEqual(identity, otherIdentity);
  assert.equal(workKeySha256(identity), workKeySha256(otherIdentity));

  const receipt = createSuccessReceipt({ identity, evidence: evidence() });
  const duplicate = createSuccessReceipt({
    evidence: Object.fromEntries(Object.entries(evidence()).reverse()),
    identity: otherIdentity,
  });
  assert.deepEqual(receipt, duplicate);
  assert.equal(receipt.outcome.status, 'success');
  assert.equal(receipt.outcome.exitCode, 0);
  assert.equal(receipt.outcome.completed, true);
  assert.equal(receipt.workKeySha256, canonicalJsonSha256(identity));
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.identity.command.args), true);
});

test('new ledgers are blank and record each completed execution once', () => {
  const identity = createWorkIdentity(identityInput());
  const blank = createRunScopedLedger(scope());
  assert.deepEqual(blank.entries, []);

  const receipt = createSuccessReceipt({ identity, evidence: evidence() });
  const ledger = recordSuccessfulWork(blank, receipt);
  assert.deepEqual(ledger.entries, [receipt]);
  assert.throws(
    () => recordSuccessfulWork(ledger, receipt),
    /duplicate successful work/
  );
  assert.equal(Object.isFrozen(ledger.entries), true);
});

test('every execution-defining field participates in the exact work key', () => {
  const originalInput = identityInput();
  const original = createWorkIdentity(originalInput);
  const receipt = createSuccessReceipt({
    identity: original,
    evidence: evidence(),
  });
  const changes = [
    [
      'unit.definitionSha256',
      (value) => (value.unit.definitionSha256 = h('1')),
    ],
    [
      'unit.testInventorySha256',
      (value) => (value.unit.testInventorySha256 = h('2')),
    ],
    [
      'unit.caseInventorySha256',
      (value) => (value.unit.caseInventorySha256 = h('3')),
    ],
    ['command executable', (value) => (value.command.executable = 'node')],
    ['command args', (value) => value.command.args.push('--changed')],
    [
      'command environment',
      (value) => (value.command.environmentSha256 = h('4')),
    ],
    ['dependency lock', (value) => (value.dependencies.lockSha256 = h('5'))],
    ['dependency state', (value) => (value.dependencies.stateSha256 = h('6'))],
    ['tools', (value) => (value.toolchain.toolsSha256 = h('7'))],
    ['runtime', (value) => (value.toolchain.runtimeSha256 = h('8'))],
    ['runner image', (value) => (value.runner.image = 'ubuntu-24.04')],
    [
      'runner environment',
      (value) => (value.runner.environmentSha256 = h('9')),
    ],
    ['setup', (value) => (value.setup.setupSha256 = h('a'))],
    ['fixtures', (value) => (value.setup.fixturesSha256 = h('b'))],
    ['config', (value) => (value.setup.configSha256 = h('c'))],
    ['workflow', (value) => (value.workflow.workflowSha256 = h('d'))],
    ['actions', (value) => (value.workflow.actionsSha256 = h('e'))],
  ];
  for (const [label, change] of changes) {
    const changed = identityInput();
    change(changed);
    assert.notEqual(workKeySha256(changed), receipt.workKeySha256, label);
  }
});

test('new attempts, candidates, and plans cannot enter an old ledger', () => {
  const original = identityInput();
  const ledger = createRunScopedLedger(scope(original));
  const changes = [
    ['attempt', (value) => (value.run.runAttempt = '2')],
    ['run', (value) => (value.run.runId = '10000000000000000002')],
    ['commit', (value) => (value.candidate.commit = g('c'))],
    ['tree', (value) => (value.candidate.tree = g('d'))],
    ['source', (value) => (value.candidate.sourceSha256 = h('e'))],
    ['plan', (value) => (value.planSha256 = h('f'))],
  ];
  for (const [label, change] of changes) {
    const changed = identityInput();
    change(changed);
    assert.throws(
      () =>
        recordSuccessfulWork(
          ledger,
          createSuccessReceipt({ identity: changed, evidence: evidence() })
        ),
      /different run attempt, candidate, or plan/,
      label
    );
  }
});

test('identity construction fails closed on missing and unknown fields', () => {
  for (const key of Object.keys(identityInput())) {
    const changed = identityInput();
    delete changed[key];
    assert.throws(() => createWorkIdentity(changed), /exact field set/, key);
  }
  for (const [section, key] of [
    ['run', 'runAttempt'],
    ['candidate', 'sourceSha256'],
    ['unit', 'caseInventorySha256'],
    ['command', 'args'],
    ['dependencies', 'lockSha256'],
    ['toolchain', 'runtimeSha256'],
    ['runner', 'image'],
    ['setup', 'fixturesSha256'],
    ['workflow', 'actionsSha256'],
  ]) {
    const changed = identityInput();
    delete changed[section][key];
    assert.throws(
      () => createWorkIdentity(changed),
      /exact field set/,
      `${section}.${key}`
    );
  }
  const unknown = identityInput();
  unknown.command.surprise = true;
  assert.throws(() => createWorkIdentity(unknown), /exact field set/);
  assert.throws(
    () => createWorkIdentity({ ...identityInput(), surprise: true }),
    /exact field set/
  );
  const numericRunId = identityInput();
  numericRunId.run.runId = 123;
  assert.throws(
    () => createWorkIdentity(numericRunId),
    /Exact workflow run ID and attempt/
  );
  const symbolField = identityInput();
  symbolField[Symbol('unsealed')] = true;
  assert.throws(() => createWorkIdentity(symbolField), /exact field set/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalJsonSha256(sparse), /dense JSON arrays/);
});

test('failure, incomplete, malformed, or duplicate receipts are never recorded', () => {
  const identity = createWorkIdentity(identityInput());
  const good = createSuccessReceipt({ identity, evidence: evidence() });
  for (const outcome of [
    { status: 'failure', exitCode: 1, completed: true },
    { status: 'success', exitCode: 1, completed: true },
    { status: 'success', exitCode: 0, completed: false },
  ]) {
    const changed = clone(good);
    changed.outcome = outcome;
    assert.throws(
      () => verifySuccessReceipt(changed),
      /Only completed successful work can be recorded/
    );
  }
  assert.throws(
    () =>
      createSuccessReceipt({
        identity,
        evidence: { ...evidence(), resultSha256: null },
      }),
    /Exact result hash/
  );
  assert.throws(
    () =>
      createSuccessReceipt({
        identity,
        evidence: evidence(),
        outcome: 'success',
      }),
    /exact field set/
  );

  const first = recordSuccessfulWork(createRunScopedLedger(scope()), good);
  const conflicting = createSuccessReceipt({
    identity,
    evidence: evidence('1'),
  });
  assert.throws(
    () => recordSuccessfulWork(first, conflicting),
    /duplicate successful work/
  );
});

test('receipt and ledger seals expose content tampering', () => {
  const identity = createWorkIdentity(identityInput());
  const receipt = createSuccessReceipt({ identity, evidence: evidence() });
  const changedEvidence = clone(receipt);
  changedEvidence.evidence.stdoutSha256 = h('1');
  assert.throws(
    () => verifySuccessReceipt(changedEvidence),
    /seal does not match/
  );
  const changedIdentity = clone(receipt);
  changedIdentity.identity.command.args.push('--tampered');
  assert.throws(
    () => verifySuccessReceipt(changedIdentity),
    /work key does not match/
  );
  const changedSeal = clone(receipt);
  changedSeal.receiptSha256 = h('2');
  assert.throws(() => verifySuccessReceipt(changedSeal), /seal does not match/);

  const ledger = recordSuccessfulWork(createRunScopedLedger(scope()), receipt);
  const changedLedger = clone(ledger);
  changedLedger.scope.planSha256 = h('3');
  assert.throws(
    () => verifyRunScopedLedger(changedLedger),
    /different run attempt, candidate, or plan/
  );
  const changedLedgerSeal = clone(ledger);
  changedLedgerSeal.ledgerSha256 = h('4');
  assert.throws(
    () => verifyRunScopedLedger(changedLedgerSeal),
    /ledger seal does not match/
  );
});

test('verified ledgers merge deterministically and reject mixed scopes', () => {
  const firstIdentity = createWorkIdentity(identityInput());
  const secondInput = identityInput();
  secondInput.unit.id = 'ci-test';
  secondInput.unit.definitionSha256 = h('1');
  const secondIdentity = createWorkIdentity(secondInput);
  const empty = createRunScopedLedger(scope());
  const first = recordSuccessfulWork(
    empty,
    createSuccessReceipt({ identity: firstIdentity, evidence: evidence() })
  );
  const second = recordSuccessfulWork(
    empty,
    createSuccessReceipt({ identity: secondIdentity, evidence: evidence('1') })
  );
  const merged = mergeRunScopedLedgers([second, first]);
  assert.equal(merged.entries.length, 2);
  assert.deepEqual(
    merged.entries.map((entry) => entry.workKeySha256),
    merged.entries
      .map((entry) => entry.workKeySha256)
      .toSorted((left, right) => left.localeCompare(right))
  );
  assert.throws(
    () => mergeRunScopedLedgers([first, first]),
    /duplicate successful work/
  );

  const otherInput = identityInput();
  otherInput.run.runAttempt = '2';
  assert.throws(
    () =>
      mergeRunScopedLedgers([merged, createRunScopedLedger(scope(otherInput))]),
    /different run scopes/
  );
});

test('canonical serialization round-trips only sealed receipt and ledger data', () => {
  const identity = createWorkIdentity(identityInput());
  const receipt = createSuccessReceipt({ identity, evidence: evidence() });
  const ledger = recordSuccessfulWork(createRunScopedLedger(scope()), receipt);
  const receiptText = serializeSuccessReceipt(receipt);
  const ledgerText = serializeRunScopedLedger(ledger);
  assert.equal(receiptText.endsWith('\n'), true);
  assert.equal(ledgerText.endsWith('\n'), true);
  assert.deepEqual(parseSuccessReceipt(receiptText), receipt);
  assert.deepEqual(parseRunScopedLedger(ledgerText), ledger);
  assert.equal(
    serializeSuccessReceipt(parseSuccessReceipt(receiptText)),
    receiptText
  );
  assert.equal(
    serializeRunScopedLedger(parseRunScopedLedger(ledgerText)),
    ledgerText
  );
  assert.throws(() => parseSuccessReceipt('{'), /not valid JSON/);
  assert.throws(() => parseRunScopedLedger('[]'), /must be a plain object/);
});
