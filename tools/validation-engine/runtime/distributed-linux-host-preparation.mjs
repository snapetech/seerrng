// Copyright (c) snapetech and SeerrNG contributors.
// Exact raw-byte contract for the Mode 3 host-preparation inputs.
import { createHash } from 'node:crypto';
import path from 'node:path/posix';

export const DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA =
  'seerrng-distributed-linux-host-preparation/v1';
export const DISTRIBUTED_LINUX_HOST_PREPARATION_RECEIPT_SCHEMA =
  'seerrng-distributed-linux-host-preparation-receipt/v1';

export const DISTRIBUTED_LINUX_HOST_PREPARATION_BASE_ROLES = Object.freeze([
  'controller-config',
  'active-controller-marker',
  'timing-profile-seed',
  'authenticated-git-evidence',
  'proof-parent-config',
  'proof-parent-script',
  'containment-manifest',
]);
export const DISTRIBUTED_LINUX_HOST_PREPARATION_ROLES = Object.freeze([
  ...DISTRIBUTED_LINUX_HOST_PREPARATION_BASE_ROLES,
  'contained-request',
]);

const HASH64 = /^[a-f0-9]{64}$/u;

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

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value).toSorted(compareText);
  const expected = [...keys].toSorted(compareText);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function containerPath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value.includes('\\') ||
    // eslint-disable-next-line no-control-regex -- Paths cross process boundaries.
    /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
  )
    throw new Error(`${label} must be an absolute canonical Linux path`);
  return value;
}

function rawSha256(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase raw SHA-256 digest`);
  return value;
}

function normalizeEntry(value, expectedRole, index) {
  exactKeys(
    value,
    ['containerPath', 'rawSha256', 'role'],
    `host-preparation input ${index + 1}`
  );
  if (value.role !== expectedRole)
    throw new Error(
      `Host-preparation input ${index + 1} must have role ${expectedRole}`
    );
  return Object.freeze({
    role: expectedRole,
    containerPath: containerPath(
      value.containerPath,
      `Host-preparation ${expectedRole} path`
    ),
    rawSha256: rawSha256(
      value.rawSha256,
      `Host-preparation ${expectedRole} hash`
    ),
  });
}

function normalizeForRoles(value, roles, label) {
  exactKeys(value, ['inputs', 'schema'], label);
  if (value.schema !== DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA)
    throw new Error('Unsupported distributed Linux host-preparation schema');
  if (!Array.isArray(value.inputs) || value.inputs.length !== roles.length)
    throw new Error(`${label} requires exactly ${roles.length} inputs`);
  const inputs = roles.map((role, index) =>
    normalizeEntry(value.inputs[index], role, index)
  );
  if (
    new Set(inputs.map(({ containerPath: entryPath }) => entryPath)).size !==
    inputs.length
  )
    throw new Error('Host-preparation input paths must be unique');
  return Object.freeze({
    schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
    inputs: Object.freeze(inputs),
  });
}

export function distributedLinuxPrettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function distributedLinuxRawSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeDistributedLinuxHostPreparationSeal(value) {
  return normalizeForRoles(
    value,
    DISTRIBUTED_LINUX_HOST_PREPARATION_BASE_ROLES,
    'distributed Linux host-preparation seal'
  );
}

export function normalizeDistributedLinuxHostPreparationAdmission(value) {
  return normalizeForRoles(
    value,
    DISTRIBUTED_LINUX_HOST_PREPARATION_ROLES,
    'distributed Linux host-preparation admission'
  );
}

export function completeDistributedLinuxHostPreparation(
  sealValue,
  requestValue
) {
  const seal = normalizeDistributedLinuxHostPreparationSeal(sealValue);
  const request = normalizeEntry(
    requestValue,
    'contained-request',
    DISTRIBUTED_LINUX_HOST_PREPARATION_BASE_ROLES.length
  );
  return normalizeDistributedLinuxHostPreparationAdmission({
    schema: DISTRIBUTED_LINUX_HOST_PREPARATION_SCHEMA,
    inputs: [...seal.inputs, request],
  });
}
