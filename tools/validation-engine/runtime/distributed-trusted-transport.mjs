// Copyright (c) snapetech and SeerrNG contributors.
// Authenticated envelopes for trusted private-LAN node transport.
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export const DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA =
  'seerrng-distributed-trusted-transport/v1';
export const MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS = 5 * 60_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS = 30_000;
export const MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS = 5_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS = 5_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES = 1024 * 1024;
export const MAX_DISTRIBUTED_TRUSTED_BODY_BYTES = 32 * 1024 * 1024;

const PROOF = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KIND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const ENVELOPE_KEYS = [
  'body',
  'bodySha256',
  'expiresAtMs',
  'kind',
  'nonce',
  'proof',
  'recipientId',
  'requestId',
  'schema',
  'senderId',
  'timestampMs',
];
const replayCaches = new WeakSet();

function transportError(message, code) {
  return Object.assign(new Error(message), { code });
}

function safeInteger(
  value,
  label,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be a safe integer from ${minimum} through ${maximum}`
    );
  return value;
}

function boundedBytes(value, label) {
  return safeInteger(value, label, {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_BODY_BYTES,
  });
}

function exactToken(value, label, pattern = TOKEN) {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.normalize('NFC') !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted();
  const wanted = [...expected].toSorted();
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function canonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value)
      throw new Error('Transport JSON strings must be canonical NFC text');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Transport JSON numbers must be finite');
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new Error('Transport JSON integers must be safe integers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object')
    throw new Error('Transport bodies must contain JSON values only');
  if (seen.has(value)) throw new Error('Transport JSON must not be cyclic');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length)
        throw new Error('Transport JSON arrays must be dense');
      return value.map((entry) => canonicalValue(entry, seen));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Transport JSON objects must be plain objects');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string'))
      throw new Error('Transport JSON objects require string keys');
    const normalized = Object.create(null);
    for (const key of keys.toSorted()) {
      if (key.normalize('NFC') !== key)
        throw new Error('Transport JSON keys must be canonical NFC text');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new Error(
          'Transport JSON objects require enumerable data fields'
        );
      normalized[key] = canonicalValue(descriptor.value, seen);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function secretBytes(value) {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 32 ||
    value.byteLength > 1024
  )
    throw new Error('Distributed transport secret must be 32..1024 bytes');
  return Buffer.from(value);
}

function unsignedEnvelope(value) {
  const unsigned = { ...value };
  delete unsigned.proof;
  return unsigned;
}

function envelopeProof(secret, value) {
  const key = secretBytes(secret);
  try {
    return createHmac('sha256', key)
      .update(canonicalJson(unsignedEnvelope(value)))
      .digest('base64url');
  } finally {
    key.fill(0);
  }
}

function normalizedBody(value) {
  return deepFreeze(canonicalValue(value));
}

function normalizeEnvelope(value, maximumBytes) {
  exactKeys(value, ENVELOPE_KEYS, 'distributed transport envelope');
  if (value.schema !== DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA)
    throw new Error('Unsupported distributed transport schema');
  const body = normalizedBody(value.body);
  const bodySha256 = sha256(canonicalJson(body));
  if (value.bodySha256 !== bodySha256)
    throw transportError(
      'Distributed transport body hash does not match its contents',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  const timestampMs = safeInteger(value.timestampMs, 'Transport timestamp');
  const expiresAtMs = safeInteger(value.expiresAtMs, 'Transport expiry');
  if (
    expiresAtMs <= timestampMs ||
    expiresAtMs - timestampMs > MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS
  )
    throw new Error('Distributed transport authentication window is invalid');
  if (typeof value.proof !== 'string' || !PROOF.test(value.proof))
    throw transportError(
      'Exact distributed transport proof is required',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  const normalized = {
    schema: DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA,
    senderId: exactToken(value.senderId, 'transport sender ID'),
    recipientId: exactToken(value.recipientId, 'transport recipient ID'),
    kind: exactToken(value.kind, 'transport message kind', KIND),
    requestId: exactToken(value.requestId, 'transport request ID'),
    timestampMs,
    expiresAtMs,
    nonce: exactToken(value.nonce, 'transport nonce', NONCE),
    bodySha256,
    body,
    proof: value.proof,
  };
  if (Buffer.byteLength(canonicalJson(normalized), 'utf8') > maximumBytes)
    throw transportError(
      `Distributed transport envelope exceeds ${maximumBytes} bytes`,
      'ERR_DISTRIBUTED_TRANSPORT_SIZE'
    );
  return normalized;
}

function normalizeMaximum(value, label) {
  return boundedBytes(value ?? DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES, label);
}

function normalizeClockSkew(value) {
  return safeInteger(value, 'Transport clock-skew allowance', {
    maximum: MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  });
}

export function createDistributedTrustedReplayCache({
  maxEntries = 16_384,
} = {}) {
  safeInteger(maxEntries, 'Replay-cache entry limit', {
    minimum: 2,
    maximum: 1_000_000,
  });
  const entries = new Map();
  const cache = Object.freeze({
    consume({ senderId, requestId, nonce, expiresAtMs, nowMs }) {
      safeInteger(nowMs, 'Replay-cache clock');
      for (const [key, expiry] of entries)
        if (expiry < nowMs) entries.delete(key);
      const keys = [
        `nonce:${senderId}:${nonce}`,
        `request:${senderId}:${requestId}`,
      ];
      if (keys.some((key) => entries.has(key)))
        throw transportError(
          'Distributed transport envelope was replayed',
          'ERR_DISTRIBUTED_TRANSPORT_REPLAY'
        );
      if (entries.size + keys.length > maxEntries)
        throw transportError(
          'Distributed transport replay cache is full',
          'ERR_DISTRIBUTED_TRANSPORT_REPLAY_CAPACITY'
        );
      for (const key of keys) entries.set(key, expiresAtMs);
    },
    size(nowMs = Date.now()) {
      safeInteger(nowMs, 'Replay-cache inspection clock');
      for (const [key, expiry] of entries)
        if (expiry < nowMs) entries.delete(key);
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  });
  replayCaches.add(cache);
  return cache;
}

export function sealDistributedTrustedEnvelope({
  secret,
  senderId,
  recipientId,
  kind,
  body,
  requestId = randomUUID(),
  nonce = randomBytes(24).toString('base64url'),
  timestampMs = Date.now(),
  ttlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  maximumBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
}) {
  const limit = normalizeMaximum(maximumBytes, 'Transport envelope byte limit');
  const timestamp = safeInteger(timestampMs, 'Transport timestamp');
  const ttl = safeInteger(ttlMs, 'Transport authentication TTL', {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  });
  const normalized = {
    schema: DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA,
    senderId: exactToken(senderId, 'transport sender ID'),
    recipientId: exactToken(recipientId, 'transport recipient ID'),
    kind: exactToken(kind, 'transport message kind', KIND),
    requestId: exactToken(requestId, 'transport request ID'),
    timestampMs: timestamp,
    expiresAtMs: timestamp + ttl,
    nonce: exactToken(nonce, 'transport nonce', NONCE),
    bodySha256: '',
    body: normalizedBody(body),
    proof: 'A'.repeat(43),
  };
  normalized.bodySha256 = sha256(canonicalJson(normalized.body));
  normalized.proof = envelopeProof(secret, normalized);
  return deepFreeze(normalizeEnvelope(normalized, limit));
}

export function verifyDistributedTrustedEnvelope(
  value,
  {
    secret,
    replayCache,
    nowMs = Date.now(),
    expectedSenderId,
    expectedRecipientId,
    expectedKind,
    expectedRequestId,
    maximumBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
    clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  }
) {
  if (!replayCaches.has(replayCache))
    throw new Error('A trusted distributed replay cache is required');
  const limit = normalizeMaximum(maximumBytes, 'Transport envelope byte limit');
  const clockSkew = normalizeClockSkew(clockSkewMs);
  const envelope = normalizeEnvelope(value, limit);
  const now = safeInteger(nowMs, 'Transport verification clock');
  if (
    envelope.timestampMs - now > clockSkew ||
    now - envelope.expiresAtMs > clockSkew
  )
    throw transportError(
      'Distributed transport envelope is outside its authentication window',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  for (const [actual, expected, label, pattern] of [
    [envelope.senderId, expectedSenderId, 'sender ID', TOKEN],
    [envelope.recipientId, expectedRecipientId, 'recipient ID', TOKEN],
    [envelope.kind, expectedKind, 'message kind', KIND],
    [envelope.requestId, expectedRequestId, 'request ID', TOKEN],
  ]) {
    if (
      expected !== undefined &&
      actual !== exactToken(expected, `expected ${label}`, pattern)
    )
      throw transportError(
        `Distributed transport ${label} does not match`,
        'ERR_DISTRIBUTED_TRANSPORT_AUTH'
      );
  }
  const supplied = Buffer.from(envelope.proof, 'base64url');
  const expected = Buffer.from(envelopeProof(secret, envelope), 'base64url');
  const accepted =
    supplied.length === expected.length && timingSafeEqual(supplied, expected);
  supplied.fill(0);
  expected.fill(0);
  if (!accepted)
    throw transportError(
      'Distributed transport authentication proof was rejected',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  replayCache.consume({
    senderId: envelope.senderId,
    requestId: envelope.requestId,
    nonce: envelope.nonce,
    expiresAtMs:
      envelope.expiresAtMs > Number.MAX_SAFE_INTEGER - clockSkew
        ? Number.MAX_SAFE_INTEGER
        : envelope.expiresAtMs + clockSkew,
    nowMs: now,
  });
  return deepFreeze(envelope);
}
