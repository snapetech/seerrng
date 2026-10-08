// Copyright (c) snapetech and SeerrNG contributors.
// Concrete outer-host adapters for the production Linux Mode 3 lifecycle.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_PRIMARY_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 2 * 60 * 1_000;
const DEFAULT_INSPECT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CAPTURE_BYTES = 16 * 1024 * 1_024;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_TERMINATION_HARD_MS = 5_000;
const MAX_ARGUMENTS = 4_096;
const MAX_ARGUMENT_BYTES = 2 * 1_024 * 1_024;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${label}`);
  return value;
}

function nonEmptyText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
    throw new Error(`Invalid ${label}`);
  return value;
}

function normalizeArguments(value, label) {
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS)
    throw new Error(`Invalid ${label}`);
  let bytes = 0;
  const result = value.map((entry, index) => {
    const argument = nonEmptyText(entry, `${label} entry ${index + 1}`);
    bytes += Buffer.byteLength(argument);
    return argument;
  });
  if (bytes > MAX_ARGUMENT_BYTES) throw new Error(`${label} is too large`);
  return Object.freeze(result);
}

function normalizeSignal(value) {
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof value.aborted !== 'boolean' ||
      typeof value.addEventListener !== 'function' ||
      typeof value.removeEventListener !== 'function')
  )
    throw new Error('Invalid Docker command AbortSignal');
  return value;
}

function commandError(message, receipt, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.receipt = receipt;
  return error;
}

function delay(milliseconds) {
  positiveInteger(milliseconds, 'delay duration');
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function syncDirectory(path) {
  // Windows does not expose a portable directory fsync. Exclusive creation and
  // file fsync still provide its strongest available equivalent here.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createDirectoryExclusive(path) {
  nonEmptyText(path, 'exclusive directory path');
  if (!isAbsolute(path))
    throw new Error('Exclusive directory path must be absolute');
  await mkdir(path, { recursive: false, mode: 0o700 });
  await syncDirectory(path);
  await syncDirectory(dirname(path));
}

async function writeJsonExclusive(path, value) {
  nonEmptyText(path, 'exclusive JSON path');
  if (!isAbsolute(path))
    throw new Error('Exclusive JSON path must be absolute');
  let bytes;
  try {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) throw new Error('JSON value is undefined');
    bytes = Buffer.from(`${json}\n`, 'utf8');
  } catch (error) {
    throw new Error('Exclusive JSON value is not serializable', {
      cause: error,
    });
  }
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

function createCommandRunner({
  executable,
  prefixArguments,
  primaryTimeoutMs,
  cleanupTimeoutMs,
  maxCaptureBytes,
  terminationGraceMs,
  terminationHardMs,
}) {
  return async function run(
    argumentValue,
    {
      id = 'docker-command',
      signal: signalValue,
      cleanup = false,
      timeoutMs,
    } = {}
  ) {
    const args = normalizeArguments(argumentValue, 'Docker arguments');
    const signal = normalizeSignal(signalValue);
    nonEmptyText(id, 'Docker command id');
    if (typeof cleanup !== 'boolean')
      throw new Error('Docker cleanup mode must be boolean');
    const effectiveTimeoutMs = positiveInteger(
      timeoutMs ?? (cleanup ? cleanupTimeoutMs : primaryTimeoutMs),
      'Docker command timeout'
    );
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const hashes = {
      stdout: createHash('sha256'),
      stderr: createHash('sha256'),
    };
    const capture = {
      stdout: [],
      stderr: [],
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutCapturedBytes: 0,
      stderrCapturedBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    };
    let child;
    let spawned = false;
    let closed = false;
    let completed = false;
    let aborted = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError = null;
    let cleanupError = null;
    let exitCode = null;
    let exitSignal = null;
    let timeout;
    let graceTimeout;
    let hardTimeout;
    let finished = false;

    const receipt = () => {
      const stdout = Buffer.concat(capture.stdout).toString('utf8');
      const stderr = Buffer.concat(capture.stderr).toString('utf8');
      const lifecycle = Object.freeze({
        spawned,
        completed,
        cleanupVerified: !spawned || closed,
        cleanupError,
      });
      const status =
        spawnError || outputLimitExceeded || cleanupError
          ? 'incomplete'
          : aborted
            ? 'aborted'
            : timedOut
              ? 'timed-out'
              : exitCode === 0 && !exitSignal
                ? 'passed'
                : 'failed';
      return Object.freeze({
        id,
        command: executable,
        args: Object.freeze([...prefixArguments, ...args]),
        pid: child?.pid ?? null,
        status,
        exitCode,
        signal: exitSignal,
        aborted,
        timedOut,
        timeoutMs: effectiveTimeoutMs,
        cleanupMode: cleanup,
        outputLimitExceeded,
        spawnError,
        startedAt,
        finishedAt: new Date().toISOString(),
        wallMs: Math.max(0, Math.round(performance.now() - started)),
        stdout,
        stderr,
        stdoutBytes: capture.stdoutBytes,
        stderrBytes: capture.stderrBytes,
        stdoutTruncated: capture.stdoutTruncated,
        stderrTruncated: capture.stderrTruncated,
        stdoutSha256: hashes.stdout.digest('hex'),
        stderrSha256: hashes.stderr.digest('hex'),
        lifecycle,
      });
    };

    if (!cleanup && signal?.aborted) {
      aborted = true;
      cleanupError = null;
      return receipt();
    }

    return new Promise((resolveReceipt) => {
      const clearTimers = () => {
        clearTimeout(timeout);
        clearTimeout(graceTimeout);
        clearTimeout(hardTimeout);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimers();
        if (!cleanup) signal?.removeEventListener('abort', abortCommand);
        resolveReceipt(receipt());
      };
      const terminate = (reason) => {
        if (finished || !spawned || closed) return;
        if (reason === 'abort') aborted = true;
        if (reason === 'timeout') timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch (error) {
          cleanupError ??= `Docker command termination failed: ${error.message}`;
        }
        graceTimeout ??= setTimeout(() => {
          if (closed) return;
          try {
            child.kill('SIGKILL');
          } catch (error) {
            cleanupError ??= `Docker command forced termination failed: ${error.message}`;
          }
        }, terminationGraceMs);
        hardTimeout ??= setTimeout(() => {
          if (closed) return;
          cleanupError ??=
            'Docker command did not terminate within its cleanup bound';
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish();
        }, terminationGraceMs + terminationHardMs);
      };
      const abortCommand = () => terminate('abort');
      const receive = (stream) => (chunk) => {
        if (finished) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hashes[stream].update(bytes);
        capture[`${stream}Bytes`] += bytes.length;
        const remaining = maxCaptureBytes - capture[`${stream}CapturedBytes`];
        if (remaining > 0) {
          const retained = bytes.subarray(0, remaining);
          capture[stream].push(retained);
          capture[`${stream}CapturedBytes`] += retained.length;
        }
        if (bytes.length > remaining) {
          capture[`${stream}Truncated`] = true;
          outputLimitExceeded = true;
          terminate('output-limit');
        }
      };

      try {
        child = spawn(executable, [...prefixArguments, ...args], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        spawnError = error.message;
        finish();
        return;
      }
      spawned = child.pid !== undefined;
      child.stdout.on('data', receive('stdout'));
      child.stderr.on('data', receive('stderr'));
      child.once('error', (error) => {
        spawnError = error.message;
      });
      child.once('close', (code, childSignal) => {
        closed = true;
        completed = !spawnError;
        exitCode = code;
        exitSignal = childSignal;
        finish();
      });
      if (!cleanup)
        signal?.addEventListener('abort', abortCommand, { once: true });
      if (!cleanup && signal?.aborted) abortCommand();
      timeout = setTimeout(() => terminate('timeout'), effectiveTimeoutMs);
    });
  };
}

function notFound(receipt, kind) {
  if (
    receipt.exitCode === 0 ||
    receipt.signal ||
    receipt.aborted ||
    receipt.timedOut ||
    receipt.outputLimitExceeded ||
    receipt.lifecycle.cleanupVerified !== true
  )
    return false;
  const message = receipt.stderr.trim();
  const patterns = {
    container:
      /^(?:Error(?::| response from daemon:)\s*)?No such container:\s*\S+(?:\r?\n)?$/iu,
    image:
      /^(?:Error(?::| response from daemon:)\s*)?No such image:\s*\S+(?:\r?\n)?$/iu,
    volume:
      /^(?:Error response from daemon:\s*)?(?:get\s+\S+:\s*)?no such volume(?:\s*:\s*\S+)?(?:\r?\n)?$/iu,
  };
  return patterns[kind].test(message);
}

function createInspector(run, kind, timeoutMs) {
  return async (reference) => {
    nonEmptyText(reference, `Docker ${kind} reference`);
    const receipt = await run([kind, 'inspect', reference], {
      id: `inspect-${kind}`,
      cleanup: true,
      timeoutMs,
    });
    if (notFound(receipt, kind)) return null;
    if (receipt.status !== 'passed')
      throw commandError(`Docker ${kind} inspection failed`, receipt);
    let value;
    try {
      value = JSON.parse(receipt.stdout);
    } catch (error) {
      throw commandError(
        `Docker ${kind} inspection did not return JSON`,
        receipt,
        error
      );
    }
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      !value[0] ||
      typeof value[0] !== 'object' ||
      Array.isArray(value[0])
    )
      throw commandError(
        `Docker ${kind} inspection did not return exactly one object`,
        receipt
      );
    return value[0];
  };
}

/**
 * Build the exact adapter surface consumed by normalizeOuterAdapters().
 * Cleanup commands deliberately ignore an already-aborted primary signal but
 * remain independently timeout-bounded through the `cleanup` run option.
 */
export function createDistributedLinuxHostAdapters({
  dockerExecutable = 'docker',
  dockerPrefixArguments = [],
  primaryTimeoutMs = DEFAULT_PRIMARY_TIMEOUT_MS,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  inspectTimeoutMs = DEFAULT_INSPECT_TIMEOUT_MS,
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  terminationHardMs = DEFAULT_TERMINATION_HARD_MS,
} = {}) {
  const executable = nonEmptyText(dockerExecutable, 'Docker executable');
  const prefixArguments = normalizeArguments(
    dockerPrefixArguments,
    'Docker prefix arguments'
  );
  const options = {
    executable,
    prefixArguments,
    primaryTimeoutMs: positiveInteger(
      primaryTimeoutMs,
      'primary Docker command timeout'
    ),
    cleanupTimeoutMs: positiveInteger(
      cleanupTimeoutMs,
      'cleanup Docker command timeout'
    ),
    maxCaptureBytes: positiveInteger(maxCaptureBytes, 'Docker capture bound'),
    terminationGraceMs: positiveInteger(
      terminationGraceMs,
      'Docker termination grace'
    ),
    terminationHardMs: positiveInteger(
      terminationHardMs,
      'Docker termination hard bound'
    ),
  };
  const normalizedInspectTimeoutMs = positiveInteger(
    inspectTimeoutMs,
    'Docker inspection timeout'
  );
  const run = createCommandRunner(options);
  return Object.freeze({
    docker: Object.freeze({
      run,
      inspectContainer: createInspector(
        run,
        'container',
        normalizedInspectTimeoutMs
      ),
      inspectImage: createInspector(run, 'image', normalizedInspectTimeoutMs),
      inspectVolume: createInspector(run, 'volume', normalizedInspectTimeoutMs),
    }),
    fs: Object.freeze({
      createDirectoryExclusive,
      readFile,
      writeJsonExclusive,
    }),
    process: Object.freeze({
      delay,
      now: () => Date.now(),
      uniqueToken: () => randomBytes(16).toString('hex'),
    }),
  });
}
