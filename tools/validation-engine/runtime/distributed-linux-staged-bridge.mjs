// Copyright (c) snapetech and SeerrNG contributors.
// Production binding from a prepared native context to the Linux Mode 3 runner.
import { isAbsolute } from 'node:path';

import { runDistributedLinuxController } from './distributed-linux-controller-runner.mjs';
import { executeDistributedStagedValidation } from './distributed-staged-validation.mjs';

const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONFIG_APPLICATION_ID = /^\S(?:.*\S)?\s+\S*\d\S*$/u;
const PROFILE_FILE = /^[^/\\]+-test-suite-dependancies\.cfg$/u;
const DIRECT_APPLICATION_KEYS = Object.freeze([
  'configuredApplicationId',
  'dependencyProfilePath',
  'runtimeApplicationKey',
]);
const RESOLVED_APPLICATION_KEYS = Object.freeze([
  'runtimeApplicationKey',
  'supportedApplication',
]);
const SUPPORTED_APPLICATION_KEYS = Object.freeze([
  'applicationId',
  'entryId',
  'name',
  'profilePath',
]);
const CONTROLLER_REQUIRED_KEYS = Object.freeze(['runId', 'timingProfile']);
const CONTROLLER_OPTIONAL_KEYS = Object.freeze([
  'activeConfigMarkerPath',
  'config',
  'policy',
  'taskTimeoutMs',
]);
const CONTROLLER_DEPENDENCY_KEYS = Object.freeze([
  'activeConfigResolver',
  'catalogDiscovery',
  'confirmDependencyExclusions',
  'dependencyProfileReader',
  'localTaskExecutor',
  'profileDetector',
  'requestFactory',
  'requestIdFactory',
  'resultVerifier',
  'scheduleExecutor',
  'scheduleFactory',
  'transportRequester',
  'withDistributedNetwork',
]);
const CONTROLLER_REQUIRED_DEPENDENCY_KEYS = Object.freeze([
  'withDistributedNetwork',
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, required, optional, label) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted(compareText);
  const expectedRequired = [...required].toSorted(compareText);
  const allowed = new Set([...required, ...optional]);
  const missing = expectedRequired.filter((key) => !Object.hasOwn(value, key));
  const unsupported = actual.filter((key) => !allowed.has(key));
  if (missing.length || unsupported.length)
    throw new Error(`${label} has unexpected or missing fields`);
  return value;
}

function exactText(value, label, maximum = 4096) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- These values cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function machineId(value, label) {
  const normalized = exactText(value, label, 128);
  if (!MACHINE_ID.test(normalized))
    throw new Error(`${label} must be a machine-safe identifier`);
  return normalized;
}

function configuredApplicationId(value) {
  const normalized = exactText(value, 'configured application ID', 128);
  if (/[[\]]/u.test(normalized) || !CONFIG_APPLICATION_ID.test(normalized))
    throw new Error(
      'Configured application ID must contain a product name followed by a version'
    );
  return normalized;
}

function dependencyProfilePath(value) {
  const normalized = exactText(value, 'dependency profile path');
  const name = normalized.split(/[\\/]/u).at(-1);
  if (!isAbsolute(normalized) || !PROFILE_FILE.test(name))
    throw new Error(
      'Dependency profile path must be absolute and use <appname>-test-suite-dependancies.cfg'
    );
  return normalized;
}

function normalizeSupportedApplication(value) {
  exactKeys(
    value,
    SUPPORTED_APPLICATION_KEYS,
    [],
    'resolved supported application'
  );
  const entryId = exactText(value.entryId, 'supported application entry ID', 2);
  if (!/^(?:0[1-9]|[1-9]\d)$/u.test(entryId))
    throw new Error('Supported application entry ID must use 01 through 99');
  return Object.freeze({
    entryId,
    applicationId: configuredApplicationId(value.applicationId),
    name: exactText(value.name, 'supported application name', 256),
    profilePath: dependencyProfilePath(value.profilePath),
  });
}

function normalizeApplication(value) {
  plainObject(value, 'distributed staged application binding');
  const resolved = Object.hasOwn(value, 'supportedApplication');
  exactKeys(
    value,
    resolved ? RESOLVED_APPLICATION_KEYS : DIRECT_APPLICATION_KEYS,
    [],
    'distributed staged application binding'
  );
  const runtimeApplicationKey = machineId(
    value.runtimeApplicationKey,
    'runtime application key'
  );
  if (resolved) {
    const supportedApplication = normalizeSupportedApplication(
      value.supportedApplication
    );
    return Object.freeze({
      runtimeApplicationKey,
      configuredApplicationId: supportedApplication.applicationId,
      dependencyProfilePath: supportedApplication.profilePath,
      supportedApplication,
    });
  }
  return Object.freeze({
    runtimeApplicationKey,
    configuredApplicationId: configuredApplicationId(
      value.configuredApplicationId
    ),
    dependencyProfilePath: dependencyProfilePath(value.dependencyProfilePath),
    supportedApplication: null,
  });
}

function normalizeController(value) {
  exactKeys(
    value,
    CONTROLLER_REQUIRED_KEYS,
    CONTROLLER_OPTIONAL_KEYS,
    'distributed staged controller launch'
  );
  const direct = Object.hasOwn(value, 'config');
  const routed = Object.hasOwn(value, 'activeConfigMarkerPath');
  if (direct === routed)
    throw new Error(
      'Distributed staged controller launch requires exactly one config or active config marker'
    );
  plainObject(value.timingProfile, 'distributed timing profile');
  if (Object.hasOwn(value, 'policy'))
    plainObject(value.policy, 'distributed scheduling policy');
  if (direct) plainObject(value.config, 'distributed controller config');
  if (routed)
    exactText(value.activeConfigMarkerPath, 'active config marker path');
  if (
    Object.hasOwn(value, 'taskTimeoutMs') &&
    (!Number.isSafeInteger(value.taskTimeoutMs) || value.taskTimeoutMs < 1)
  )
    throw new Error('Distributed task timeout must be a positive integer');
  return Object.freeze({
    ...value,
    runId: machineId(value.runId, 'distributed controller run ID'),
  });
}

function normalizeControllerDependencies(value) {
  exactKeys(
    value,
    CONTROLLER_REQUIRED_DEPENDENCY_KEYS,
    CONTROLLER_DEPENDENCY_KEYS,
    'distributed controller dependencies'
  );
  for (const [name, callback] of Object.entries(value))
    if (typeof callback !== 'function')
      throw new Error(
        `Distributed controller dependency ${name} must be a function`
      );
  return Object.freeze({ ...value });
}

async function executeWithDistributedNetwork(
  operation,
  context,
  withDistributedNetwork
) {
  let operationCalls = 0;
  let operationResult;
  let operationFailure;
  let operationSettled = false;
  let callbackActive = true;
  let operationPromise;
  const guardedOperation = async () => {
    operationCalls += 1;
    if (operationCalls !== 1)
      throw new Error(
        'Distributed network callback invoked the controller more than once'
      );
    if (!callbackActive)
      throw new Error(
        'Distributed network callback invoked the controller after its lease closed'
      );
    operationPromise = Promise.resolve().then(operation);
    try {
      operationResult = await operationPromise;
      return operationResult;
    } catch (error) {
      operationFailure = error;
      throw error;
    } finally {
      operationSettled = true;
    }
  };

  let callbackResult;
  try {
    callbackResult = await withDistributedNetwork(guardedOperation, context);
  } finally {
    callbackActive = false;
  }
  if (operationCalls === 0)
    throw new Error(
      'Distributed network callback did not invoke the controller'
    );
  if (operationCalls !== 1)
    throw new Error(
      'Distributed network callback invoked the controller more than once'
    );
  if (!operationSettled) {
    await operationPromise?.catch(() => {});
    throw new Error(
      'Distributed network callback closed before the controller settled'
    );
  }
  if (operationFailure !== undefined)
    throw new Error(
      'Distributed network callback suppressed the controller failure',
      { cause: operationFailure }
    );
  if (callbackResult !== operationResult)
    throw new Error(
      'Distributed network callback replaced the controller result'
    );
  return operationResult;
}

function normalizeNativeContext(value) {
  plainObject(value, 'prepared native stage context');
  plainObject(value.binding, 'prepared native stage binding');
  const options = plainObject(
    value.options,
    'prepared native stage execution options'
  );
  if (typeof options.executeRepositoryCheck !== 'function')
    throw new Error(
      'Prepared native stage context requires its repository check executor'
    );
  return { binding: value.binding, options };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Execute a prepared four-stage native context with only its repository test
 * catalog delegated to the real Linux Mode 3 controller. The runtime key used
 * by machine protocols is deliberately distinct from the human product/version
 * application ID stored in controller configuration. The host-owned
 * withDistributedNetwork dependency must invoke its operation exactly once and
 * return the unchanged result only after restoring the prior network boundary.
 */
export async function executeDistributedLinuxStagedValidation(
  nativeContextValue,
  launchValue,
  controllerDependenciesValue = {}
) {
  const nativeContext = normalizeNativeContext(nativeContextValue);
  exactKeys(
    launchValue,
    ['application', 'controller'],
    [],
    'distributed Linux staged launch'
  );
  const application = normalizeApplication(launchValue.application);
  const controller = normalizeController(launchValue.controller);
  const normalizedControllerDependencies = normalizeControllerDependencies(
    controllerDependenciesValue
  );
  const { withDistributedNetwork, ...controllerDependencies } =
    normalizedControllerDependencies;

  const stagedResult = await executeDistributedStagedValidation(
    nativeContext.binding,
    nativeContext.options,
    {
      executeLocalCheck: nativeContext.options.executeRepositoryCheck,
      executeDistributedRun: async ({ candidate, repositoryPlan, signal }) => {
        const networkContext = Object.freeze({
          applicationId: application.runtimeApplicationKey,
          applicationRoot: repositoryPlan.root,
          repositoryIdentitySha256: candidate.sourceSha256,
          runId: controller.runId,
          signal,
          unitId: 'native-repository-distributed',
        });
        return executeWithDistributedNetwork(
          () =>
            runDistributedLinuxController({
              ...controller,
              applicationId: application.runtimeApplicationKey,
              applicationRoot: repositoryPlan.root,
              dependencyProfilePath: application.dependencyProfilePath,
              repositoryIdentitySha256: candidate.sourceSha256,
              signal,
              ...controllerDependencies,
            }),
          networkContext,
          withDistributedNetwork
        );
      },
    }
  );

  return deepFreeze({
    ...stagedResult,
    distributedApplication: application,
  });
}
