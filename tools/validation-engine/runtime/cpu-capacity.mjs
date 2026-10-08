import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';

const HIGH_THROUGHPUT_GITHUB_LOGINS = new Map([['johncronk79', 'JohnCronk79']]);
export const REQUIRED_WORKER_CAPACITY_PROOF_SCHEMA =
  'seerrng-required-worker-capacity-proof/v1';

const approvedGithubLogin = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return HIGH_THROUGHPUT_GITHUB_LOGINS.get(value.trim().toLowerCase()) ?? null;
};

const githubLoginFromNoreplyEmail = (value) => {
  if (typeof value !== 'string') return null;
  const match = value
    .trim()
    .match(/^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i);
  return match ? approvedGithubLogin(match[1]) : null;
};

export function resolveOperatorGithubLogin({
  environment = {},
  gitConfig = () => null,
} = {}) {
  for (const value of [
    environment.GITHUB_TRIGGERING_ACTOR,
    environment.GITHUB_ACTOR,
  ]) {
    if (typeof value === 'string' && value.trim() !== '')
      return approvedGithubLogin(value);
  }
  const configuredGithubUser = gitConfig('github.user');
  if (
    typeof configuredGithubUser === 'string' &&
    configuredGithubUser.trim() !== ''
  ) {
    return approvedGithubLogin(configuredGithubUser);
  }
  const emailLogin = githubLoginFromNoreplyEmail(gitConfig('user.email'));
  if (emailLogin) return emailLogin;
  return approvedGithubLogin(gitConfig('user.name'));
}

export function detectOperatorGithubLogin({
  sourceRoot = process.cwd(),
  environment = process.env,
} = {}) {
  const gitConfig = (key) => {
    try {
      return (
        execFileSync('git', ['-C', sourceRoot, 'config', '--get', key], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null
      );
    } catch {
      return null;
    }
  };
  return resolveOperatorGithubLogin({ environment, gitConfig });
}

// OS logical capacity, not physical cores, observed workers, or performance.
export function selectWorkerCapacity({
  availableLogicalCpus,
  visibleLogicalCpus = availableLogicalCpus,
  quotaCpus = null,
  override = null,
  operatorGithubLogin = null,
  githubActions = false,
  requiredProof = null,
}) {
  if (typeof githubActions !== 'boolean')
    throw new Error('GitHub Actions context must be boolean');
  if (
    !Number.isSafeInteger(availableLogicalCpus) ||
    availableLogicalCpus < 1 ||
    !Number.isSafeInteger(visibleLogicalCpus) ||
    visibleLogicalCpus < 1 ||
    (quotaCpus !== null && (!Number.isFinite(quotaCpus) || quotaCpus <= 0))
  )
    throw new Error('Invalid actual CPU capacity');
  const effectiveLogicalCpus = Math.min(
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus === null
      ? availableLogicalCpus
      : Math.max(1, Math.floor(quotaCpus))
  );
  if (
    override !== null &&
    (!Number.isSafeInteger(override) || override < 1 || override > 256)
  )
    throw new Error('Worker override must be an integer1..256');
  const approvedOperatorGithubLogin = approvedGithubLogin(operatorGithubLogin);
  const highThroughput = approvedOperatorGithubLogin !== null;
  const automaticWorkers = githubActions
    ? effectiveLogicalCpus
    : highThroughput
      ? effectiveLogicalCpus * 2
      : Math.max(1, effectiveLogicalCpus - 1);
  const capacity = {
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus,
    effectiveLogicalCpus,
    operatorGithubLogin: approvedOperatorGithubLogin,
    githubActions,
    policy:
      override !== null
        ? 'explicit-worker-override'
        : githubActions
          ? 'one-worker-per-effective-logical-cpu-on-github-actions'
          : highThroughput
            ? 'two-workers-per-effective-logical-cpu-for-approved-operator'
            : 'one-worker-less-than-effective-logical-cpus',
    configuredWorkers: override ?? automaticWorkers,
    observedWorkerCount: null,
  };
  if (requiredProof !== null)
    verifyRequiredWorkerCapacityProof(capacity, requiredProof);
  return capacity;
}

export function createRequiredWorkerCapacityProof({
  operatorGithubLogin,
  expectedLogicalCpus,
}) {
  const approvedOperatorGithubLogin = approvedGithubLogin(operatorGithubLogin);
  if (!approvedOperatorGithubLogin)
    throw new Error(
      'Required capacity proof needs an approved GitHub operator'
    );
  if (!Number.isSafeInteger(expectedLogicalCpus) || expectedLogicalCpus < 1)
    throw new Error(
      'Required capacity proof needs a positive logical CPU count'
    );
  return normalizeRequiredWorkerCapacityProof({
    schema: REQUIRED_WORKER_CAPACITY_PROOF_SCHEMA,
    operatorGithubLogin: approvedOperatorGithubLogin,
    expectedLogicalCpus,
    expectedConfiguredWorkers: expectedLogicalCpus * 2,
    githubActions: false,
    policy: 'two-workers-per-effective-logical-cpu-for-approved-operator',
  });
}

export function normalizeRequiredWorkerCapacityProof(proof) {
  if (
    !proof ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    Object.getPrototypeOf(proof) !== Object.prototype ||
    ![
      'expectedConfiguredWorkers',
      'expectedLogicalCpus',
      'githubActions',
      'operatorGithubLogin',
      'policy',
      'schema',
    ].every((key) => Object.hasOwn(proof, key)) ||
    Object.keys(proof).length !== 6 ||
    proof.schema !== REQUIRED_WORKER_CAPACITY_PROOF_SCHEMA ||
    approvedGithubLogin(proof.operatorGithubLogin) !==
      proof.operatorGithubLogin ||
    !Number.isSafeInteger(proof.expectedLogicalCpus) ||
    proof.expectedLogicalCpus < 1 ||
    proof.expectedConfiguredWorkers !== proof.expectedLogicalCpus * 2 ||
    proof.githubActions !== false ||
    proof.policy !==
      'two-workers-per-effective-logical-cpu-for-approved-operator'
  )
    throw new Error('Required worker capacity proof policy is invalid');
  return Object.freeze({
    schema: proof.schema,
    operatorGithubLogin: proof.operatorGithubLogin,
    expectedLogicalCpus: proof.expectedLogicalCpus,
    expectedConfiguredWorkers: proof.expectedConfiguredWorkers,
    githubActions: proof.githubActions,
    policy: proof.policy,
  });
}

export function verifyRequiredWorkerCapacityProof(capacity, proofValue) {
  const proof = normalizeRequiredWorkerCapacityProof(proofValue);
  if (
    capacity.availableLogicalCpus !== proof.expectedLogicalCpus ||
    capacity.visibleLogicalCpus !== proof.expectedLogicalCpus ||
    capacity.quotaCpus !== proof.expectedLogicalCpus ||
    capacity.effectiveLogicalCpus !== proof.expectedLogicalCpus ||
    capacity.operatorGithubLogin !== proof.operatorGithubLogin ||
    capacity.githubActions !== proof.githubActions ||
    capacity.policy !== proof.policy ||
    capacity.configuredWorkers !== proof.expectedConfiguredWorkers ||
    capacity.observedWorkerCount !== null
  )
    throw new Error('Required worker capacity proof did not match admission');
  return capacity;
}

export function detectWorkerCapacity(options = {}) {
  if (options === null || Number.isSafeInteger(options))
    options = { override: options };
  if (typeof options !== 'object' || Array.isArray(options))
    throw new Error(
      'Worker capacity options must be an object, integer, or null'
    );
  const {
    override = null,
    sourceRoot = process.cwd(),
    operatorGithubLogin = null,
    environment = process.env,
    requiredProof = null,
  } = options;
  let quotaCpus = null;
  if (process.platform === 'linux') {
    let quota;
    try {
      quota = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8')
        .trim()
        .split(/\s+/);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (quota) {
      if (
        quota.length !== 2 ||
        !Number.isFinite(Number(quota[1])) ||
        Number(quota[1]) <= 0
      )
        throw new Error('Invalid cgroup CPU quota');
      if (quota[0] !== 'max') quotaCpus = Number(quota[0]) / Number(quota[1]);
    } else {
      try {
        const amount = Number(
          readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8')
        );
        const period = Number(
          readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8')
        );
        if (amount !== -1) {
          if (!(period > 0)) throw new Error('Invalid legacy CPU quota');
          quotaCpus = amount / period;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const detectedOperatorGithubLogin =
    operatorGithubLogin ??
    detectOperatorGithubLogin({ sourceRoot, environment });
  return selectWorkerCapacity({
    availableLogicalCpus: availableParallelism(),
    visibleLogicalCpus: cpus().length,
    quotaCpus,
    override,
    operatorGithubLogin: detectedOperatorGithubLogin,
    githubActions: environment.GITHUB_ACTIONS === 'true',
    requiredProof,
  });
}
