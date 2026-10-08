import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application aliases.
import {
  createDistributedTrustedReplayCache,
  DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  sealDistributedTrustedEnvelope,
  verifyDistributedTrustedEnvelope,
} from '../tools/validation-engine/runtime/distributed-trusted-transport.mjs';

const secret = Buffer.alloc(32, 0x5a);
const clientId = 'controller-test';
const serverId = 'worker-test';

test('envelope rejects tampering, wrong auth, expiry, and replay', () => {
  const now = Date.now();
  const original = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-auth-001',
    nonce: 'nonce-auth-000001',
    timestampMs: now,
    body: { performanceScorePermille: 875 },
  });
  const verified = verifyDistributedTrustedEnvelope(original, {
    secret,
    replayCache: createDistributedTrustedReplayCache(),
    nowMs: now,
    expectedSenderId: clientId,
    expectedRecipientId: serverId,
    expectedKind: 'fleet.probe',
    expectedRequestId: 'request-auth-001',
  });
  assert.equal(verified.body.performanceScorePermille, 875);

  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(
        { ...original, body: { performanceScorePermille: 999_999 } },
        {
          secret,
          replayCache: createDistributedTrustedReplayCache(),
          nowMs: now,
        }
      ),
    /body hash/
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret: Buffer.alloc(32, 0x22),
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /proof was rejected/
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs:
          original.expiresAtMs + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
      }),
    /outside its authentication window/
  );
  const replayCache = createDistributedTrustedReplayCache();
  verifyDistributedTrustedEnvelope(original, {
    secret,
    replayCache,
    nowMs: now,
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret,
        replayCache,
        nowMs: now,
      }),
    /replayed/
  );
});

test('clock-skew allowance enforces exact boundaries and retains replay state', () => {
  const now = 2_000_000;
  const futureBoundary = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-future-boundary',
    nonce: 'nonce-skew-future-boundary',
    timestampMs: now + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
    ttlMs: 1_000,
    body: { boundary: 'future' },
  });
  assert.equal(
    verifyDistributedTrustedEnvelope(futureBoundary, {
      secret,
      replayCache: createDistributedTrustedReplayCache(),
      nowMs: now,
    }).body.boundary,
    'future'
  );

  const futureOutside = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-future-outside',
    nonce: 'nonce-skew-future-outside',
    timestampMs: now + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
    ttlMs: 1_000,
    body: { boundary: 'future-outside' },
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(futureOutside, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /outside its authentication window/
  );

  const expiryBoundary = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-expiry-boundary',
    nonce: 'nonce-skew-expiry-boundary',
    timestampMs: now - DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS - 1_000,
    ttlMs: 1_000,
    body: { boundary: 'expiry' },
  });
  const replayCache = createDistributedTrustedReplayCache();
  assert.equal(
    verifyDistributedTrustedEnvelope(expiryBoundary, {
      secret,
      replayCache,
      nowMs: now,
    }).body.boundary,
    'expiry'
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(expiryBoundary, {
        secret,
        replayCache,
        nowMs: now,
      }),
    /replayed/
  );

  const expiryOutside = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-expiry-outside',
    nonce: 'nonce-skew-expiry-outside',
    timestampMs: now - DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS - 1_000 - 1,
    ttlMs: 1_000,
    body: { boundary: 'expiry-outside' },
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(expiryOutside, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /outside its authentication window/
  );

  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(futureBoundary, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
        clockSkewMs: 0,
      }),
    /outside its authentication window/
  );
  for (const clockSkewMs of [
    -1,
    0.5,
    MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
  ]) {
    assert.throws(
      () =>
        verifyDistributedTrustedEnvelope(futureBoundary, {
          secret,
          replayCache: createDistributedTrustedReplayCache(),
          nowMs: now,
          clockSkewMs,
        }),
      /clock-skew allowance/
    );
  }
});

test('authentication freshness accepts the bounded worker-admission window only', () => {
  const now = 2_000_000;
  const bounded = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-auth-window-boundary',
    nonce: 'nonce-auth-window-boundary',
    timestampMs: now,
    ttlMs: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
    body: { boundary: 'maximum' },
  });
  assert.equal(
    verifyDistributedTrustedEnvelope(bounded, {
      secret,
      replayCache: createDistributedTrustedReplayCache(),
      nowMs: now,
    }).body.boundary,
    'maximum'
  );
  assert.throws(
    () =>
      sealDistributedTrustedEnvelope({
        secret,
        senderId: clientId,
        recipientId: serverId,
        kind: 'fleet.probe',
        requestId: 'request-auth-window-outside',
        nonce: 'nonce-auth-window-outside',
        timestampMs: now,
        ttlMs: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS + 1,
        body: { boundary: 'outside' },
      }),
    /authentication TTL/
  );
});
