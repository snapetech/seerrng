export interface ShutdownServer {
  close: (callback: (error?: Error) => void) => unknown;
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
}

export interface ShutdownTask {
  name: string;
  run: () => void | Promise<void>;
}

export interface ShutdownDrainResult {
  forcedConnections: boolean;
  serverError?: Error;
  taskErrors: { name: string; error: unknown }[];
  timedOutTasks: string[];
}

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface ShutdownProcess {
  once: (signal: ShutdownSignal, listener: () => void) => unknown;
  removeListener: (signal: ShutdownSignal, listener: () => void) => unknown;
  exit: (code: number) => never;
}

export interface ProcessShutdownController {
  request: (reason: string, requestedExitCode?: number) => void;
  dispose: () => void;
}

export const hasShutdownDrainFailures = (
  result: ShutdownDrainResult
): boolean =>
  result.forcedConnections ||
  !!result.serverError ||
  result.taskErrors.length > 0 ||
  result.timedOutTasks.length > 0;

export const createProcessShutdownController = ({
  drain,
  onStart,
  onComplete,
  onError,
  processTarget = process,
}: {
  drain: () => Promise<ShutdownDrainResult>;
  onStart?: (reason: string) => void;
  onComplete?: (result: ShutdownDrainResult, failed: boolean) => void;
  onError?: (error: unknown) => void;
  processTarget?: ShutdownProcess;
}): ProcessShutdownController => {
  let shutdownStarted = false;
  let shutdownExitCode = 0;

  const forceExit = () => processTarget.exit(1);
  const onSigterm = () => request('SIGTERM');
  const onSigint = () => request('SIGINT');
  const dispose = () => {
    processTarget.removeListener('SIGTERM', onSigterm);
    processTarget.removeListener('SIGINT', onSigint);
    processTarget.removeListener('SIGTERM', forceExit);
    processTarget.removeListener('SIGINT', forceExit);
  };
  const exitAfterError = (error: unknown) => {
    try {
      onError?.(error);
    } finally {
      dispose();
      processTarget.exit(1);
    }
  };

  function request(reason: string, requestedExitCode = 0): void {
    shutdownExitCode = Math.max(shutdownExitCode, requestedExitCode);
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;

    try {
      onStart?.(reason);
      // Any signal received after shutdown has begun is an explicit request
      // to stop waiting, even when a non-signal failure started the drain.
      processTarget.once('SIGTERM', forceExit);
      processTarget.once('SIGINT', forceExit);

      void drain()
        .then((result) => {
          const failed =
            shutdownExitCode !== 0 || hasShutdownDrainFailures(result);
          onComplete?.(result, failed);
          dispose();
          processTarget.exit(failed ? 1 : 0);
        })
        .catch(exitAfterError);
    } catch (error) {
      exitAfterError(error);
    }
  }

  processTarget.once('SIGTERM', onSigterm);
  processTarget.once('SIGINT', onSigint);

  return { request, dispose };
};

const drainServer = (
  server: ShutdownServer,
  timeoutMs: number
): Promise<{ forced: boolean; error?: Error }> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: { forced: boolean; error?: Error }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({ forced: true });
      server.closeAllConnections?.();
    }, timeoutMs);

    try {
      server.close((error) => finish({ forced: false, error }));
      server.closeIdleConnections?.();
    } catch (error) {
      finish({
        forced: false,
        error:
          error instanceof Error ? error : new Error('Server close failed'),
      });
    }
  });

const drainServers = async (
  servers: ShutdownServer[],
  timeoutMs: number
): Promise<{ forced: boolean; error?: Error }> => {
  const results = await Promise.all(
    servers.map((server) => drainServer(server, timeoutMs))
  );
  const errors = results
    .map((result) => result.error)
    .filter((error): error is Error => !!error);

  return {
    forced: results.some((result) => result.forced),
    error:
      errors.length === 0
        ? undefined
        : errors.length === 1
          ? errors[0]
          : new AggregateError(errors, 'One or more servers failed to close.'),
  };
};

const drainTasks = async (
  tasks: ShutdownTask[],
  timeoutMs: number
): Promise<{
  errors: { name: string; error: unknown }[];
  timedOut: string[];
}> => {
  const pending = new Set(tasks.map((task) => task.name));
  const errors: { name: string; error: unknown }[] = [];
  const completion = Promise.all(
    tasks.map((task) =>
      Promise.resolve()
        .then(task.run)
        .catch((error) => {
          errors.push({ name: task.name, error });
        })
        .finally(() => {
          pending.delete(task.name);
        })
    )
  );
  let timeout: NodeJS.Timeout | undefined;

  await Promise.race([
    completion,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }

  return { errors, timedOut: [...pending] };
};

export const drainForShutdown = async ({
  server,
  tasks,
  connectionTimeoutMs = 10_000,
  taskTimeoutMs = 10_000,
}: {
  server: ShutdownServer | ShutdownServer[];
  tasks: ShutdownTask[];
  connectionTimeoutMs?: number;
  taskTimeoutMs?: number;
}): Promise<ShutdownDrainResult> => {
  // Stop accepting requests and let active handlers finish before snapshotting
  // background work. An active handler may enqueue work immediately before it
  // sends its response, so starting the task drain earlier can miss accepted
  // work entirely.
  const serverResult = await drainServers(
    Array.isArray(server) ? server : [server],
    connectionTimeoutMs
  );
  const taskResult = await drainTasks(tasks, taskTimeoutMs);

  return {
    forcedConnections: serverResult.forced,
    serverError: serverResult.error,
    taskErrors: taskResult.errors,
    timedOutTasks: taskResult.timedOut,
  };
};
