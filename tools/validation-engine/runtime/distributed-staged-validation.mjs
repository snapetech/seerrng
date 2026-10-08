// Copyright (c) snapetech and SeerrNG contributors.
// Binds the distributed repository compositor into the existing four-stage gate.
import { executeDistributedRepositoryStage } from './distributed-repository-stage.mjs';
import { executeStagedValidation } from './staged-validation.mjs';

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

async function executeIsolatedLocalCheck(
  step,
  checkContext,
  { candidate, executeLocalCheck, withRepositoryIsolation }
) {
  let operationCalls = 0;
  const operation = async () => {
    operationCalls += 1;
    if (operationCalls !== 1)
      throw new Error(
        'Repository isolation invoked a local check more than once'
      );
    return executeLocalCheck(step, checkContext);
  };
  const result = await withRepositoryIsolation(operation, {
    candidate,
    unitId: 'native-repository',
    signal: checkContext.signal,
  });
  if (operationCalls !== 1)
    throw new Error('Repository isolation did not invoke its local check');
  return result;
}

/**
 * Execute the existing four-stage coordinator while replacing only its
 * repository executor. Local repository checks cross the supplied isolation
 * boundary one at a time; distributed discovery, probes and task transport do
 * not cross that boundary.
 */
export async function executeDistributedStagedValidation(
  binding,
  stagedOptionsValue,
  { executeLocalCheck, executeDistributedRun } = {}
) {
  plainObject(binding, 'distributed staged binding');
  const stagedOptions = plainObject(
    stagedOptionsValue,
    'distributed staged options'
  );
  const candidate = plainObject(
    binding.plan?.candidate,
    'distributed staged candidate'
  );
  const { executeRepository, withRepositoryIsolation, ...preservedOptions } =
    stagedOptions;
  for (const [callback, label] of [
    [executeRepository, 'existing repository executor'],
    [withRepositoryIsolation, 'repository isolation callback'],
    [executeLocalCheck, 'local check executor'],
    [executeDistributedRun, 'distributed run callback'],
  ])
    if (typeof callback !== 'function')
      throw new Error(`Distributed staged validation requires a ${label}`);

  return executeStagedValidation(binding, {
    ...preservedOptions,
    executeRepository: async (repositoryPlan, { signal } = {}) =>
      executeDistributedRepositoryStage(repositoryPlan, {
        candidate,
        signal,
        executeLocalCheck: (step, checkContext) =>
          executeIsolatedLocalCheck(step, checkContext, {
            candidate,
            executeLocalCheck,
            withRepositoryIsolation,
          }),
        executeDistributedRun,
      }),
  });
}
