// Copyright (c) snapetech and SeerrNG contributors.
// Linux hardware facts used to populate Mode 3 configuration files.
import os from 'node:os';

function effectiveLogicalThreads(availableParallelism, processors) {
  let preferred;
  if (typeof availableParallelism === 'function') {
    try {
      preferred = availableParallelism();
    } catch {
      preferred = undefined;
    }
  }
  const value =
    Number.isSafeInteger(preferred) && preferred > 0
      ? preferred
      : processors.length;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Linux host available threads must be a positive integer');
  return value;
}

function cpuName(processors) {
  const model = processors[0]?.model;
  if (typeof model !== 'string')
    throw new Error('Linux host CPU name is unavailable');
  const normalized = model.trim().normalize('NFC');
  // eslint-disable-next-line no-control-regex -- Config values cross machines.
  if (!normalized || /[\u0000-\u001f\u007f\u2028\u2029]/.test(normalized))
    throw new Error('Linux host CPU name is unavailable');
  return normalized;
}

export function detectLinuxHostProfile(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('Linux host profile options must be an object');
  const platform = options.platform ?? process.platform;
  const availableParallelism = Object.hasOwn(options, 'availableParallelism')
    ? options.availableParallelism
    : () => os.availableParallelism();
  const cpus = Object.hasOwn(options, 'cpus') ? options.cpus : () => os.cpus();
  if (platform !== 'linux')
    throw new Error('Mode 3 host profiling requires Linux');
  if (typeof cpus !== 'function')
    throw new Error('Linux CPU inspection is unavailable');
  let processors;
  try {
    processors = cpus();
  } catch {
    throw new Error('Linux CPU inspection failed');
  }
  if (!Array.isArray(processors))
    throw new Error('Linux CPU inspection returned invalid data');
  const availableThreads = effectiveLogicalThreads(
    availableParallelism,
    processors
  );
  return Object.freeze({
    cpuName: cpuName(processors),
    availableThreads,
  });
}
