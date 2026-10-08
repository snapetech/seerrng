import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  createRequiredWorkerCapacityProof,
  detectWorkerCapacity,
  resolveOperatorGithubLogin,
  selectWorkerCapacity,
} from '../tools/validation-engine/runtime/cpu-capacity.mjs';

test('ordinary operators default to one fewer worker than effective logical CPUs', () => {
  const result = selectWorkerCapacity({ availableLogicalCpus: 12 });
  assert.equal(result.effectiveLogicalCpus, 12);
  assert.equal(result.configuredWorkers, 11);
  assert.equal(result.policy, 'one-worker-less-than-effective-logical-cpus');
  assert.equal(result.operatorGithubLogin, null);
});

test('GitHub Actions uses all effective CPUs regardless of the triggering operator', () => {
  for (const operatorGithubLogin of [null, 'snapetech', 'JohnCronk79']) {
    const result = selectWorkerCapacity({
      availableLogicalCpus: 32,
      visibleLogicalCpus: 16,
      quotaCpus: 4,
      operatorGithubLogin,
      githubActions: true,
    });
    assert.equal(result.configuredWorkers, 4);
    assert.equal(
      result.policy,
      'one-worker-per-effective-logical-cpu-on-github-actions'
    );
  }
  assert.equal(
    selectWorkerCapacity({ availableLogicalCpus: 8, githubActions: true })
      .configuredWorkers,
    8
  );
  assert.equal(
    selectWorkerCapacity({ availableLogicalCpus: 1, githubActions: true })
      .configuredWorkers,
    1
  );
});

test('GitHub Actions discovery takes precedence over John local identity, not explicit overrides', () => {
  const options = {
    environment: { GITHUB_ACTIONS: 'true', GITHUB_ACTOR: 'JohnCronk79' },
  };
  const detected = detectWorkerCapacity(options);
  assert.equal(detected.configuredWorkers, detected.effectiveLogicalCpus);
  assert.equal(
    detectWorkerCapacity({ ...options, override: 3 }).configuredWorkers,
    3
  );
  for (const GITHUB_ACTIONS of [undefined, 'false', 'TRUE', '1']) {
    const local = detectWorkerCapacity({
      environment: { GITHUB_ACTIONS },
      operatorGithubLogin: 'JohnCronk79',
    });
    assert.equal(local.configuredWorkers, local.effectiveLogicalCpus * 2);
  }
  assert.throws(() =>
    selectWorkerCapacity({ availableLogicalCpus: 4, githubActions: 'true' })
  );
});

test('the approved GitHub operator automatically receives two workers per effective logical CPU', () => {
  const result = selectWorkerCapacity({
    availableLogicalCpus: 32,
    operatorGithubLogin: 'johncronk79',
  });
  assert.equal(result.configuredWorkers, 64);
  assert.equal(
    result.policy,
    'two-workers-per-effective-logical-cpu-for-approved-operator'
  );
  assert.equal(result.operatorGithubLogin, 'JohnCronk79');
});

test('required John capacity proof admits exactly 12 logical CPUs and 24 workers', () => {
  const requiredProof = createRequiredWorkerCapacityProof({
    operatorGithubLogin: 'JohnCronk79',
    expectedLogicalCpus: 12,
  });
  const result = selectWorkerCapacity({
    availableLogicalCpus: 12,
    visibleLogicalCpus: 12,
    quotaCpus: 12,
    operatorGithubLogin: 'JohnCronk79',
    requiredProof,
  });
  assert.equal(result.configuredWorkers, 24);
  assert.throws(
    () =>
      selectWorkerCapacity({
        availableLogicalCpus: 12,
        visibleLogicalCpus: 12,
        quotaCpus: 12,
        operatorGithubLogin: null,
        requiredProof,
      }),
    /did not match admission/u
  );
  assert.throws(
    () =>
      selectWorkerCapacity({
        availableLogicalCpus: 11,
        visibleLogicalCpus: 11,
        quotaCpus: 11,
        operatorGithubLogin: 'JohnCronk79',
        requiredProof,
      }),
    /did not match admission/u
  );
});

test('automatic policies respect visible and cgroup CPU limits', () => {
  const ordinary = selectWorkerCapacity({
    availableLogicalCpus: 32,
    visibleLogicalCpus: 16,
    quotaCpus: 12.9,
  });
  const approved = selectWorkerCapacity({
    availableLogicalCpus: 32,
    visibleLogicalCpus: 16,
    quotaCpus: 12.9,
    operatorGithubLogin: 'JohnCronk79',
  });
  assert.equal(ordinary.effectiveLogicalCpus, 12);
  assert.equal(ordinary.configuredWorkers, 11);
  assert.equal(approved.configuredWorkers, 24);
});

test('the ordinary one-CPU floor remains one worker', () => {
  assert.equal(
    selectWorkerCapacity({ availableLogicalCpus: 1 }).configuredWorkers,
    1
  );
});

test('an explicit worker override remains authoritative', () => {
  for (const override of [1, 7, 24]) {
    const result = selectWorkerCapacity({
      availableLogicalCpus: 12,
      override,
      operatorGithubLogin: 'JohnCronk79',
    });
    assert.equal(result.configuredWorkers, override);
    assert.equal(result.effectiveLogicalCpus, 12);
    assert.equal(result.policy, 'explicit-worker-override');
  }
});

test('GitHub Actions actors and ordinary Git identity resolve without credentials', () => {
  assert.equal(
    resolveOperatorGithubLogin({
      environment: { GITHUB_ACTOR: 'JohnCronk79' },
    }),
    'JohnCronk79'
  );
  assert.equal(
    resolveOperatorGithubLogin({
      gitConfig: (key) => (key === 'github.user' ? 'JohnCronk79' : null),
    }),
    'JohnCronk79'
  );
  assert.equal(
    resolveOperatorGithubLogin({
      gitConfig: (key) =>
        key === 'user.email'
          ? '124496464+JohnCronk79@users.noreply.github.com'
          : key === 'user.name'
            ? 'John Cronk'
            : null,
    }),
    'JohnCronk79'
  );
  assert.equal(
    resolveOperatorGithubLogin({
      gitConfig: (key) => (key === 'user.name' ? 'JohnCronk79' : null),
    }),
    'JohnCronk79'
  );
  assert.equal(
    resolveOperatorGithubLogin({
      environment: { GITHUB_ACTOR: 'snapetech' },
      gitConfig: () => null,
    }),
    null
  );
  assert.equal(
    resolveOperatorGithubLogin({
      environment: { GITHUB_ACTOR: 'snapetech' },
      gitConfig: () => 'JohnCronk79',
    }),
    null
  );
});
