import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
  DEFAULT_DISTRIBUTED_NODE_TIMEOUT_MS,
  DISTRIBUTED_NODE_PROBE_KIND,
  DISTRIBUTED_NODE_TASK_KIND,
  DISTRIBUTED_NODE_TRANSPORT_ROUTE,
  MAX_DISTRIBUTED_NODE_BODY_BYTES,
  MAX_DISTRIBUTED_NODE_TIMEOUT_MS,
  requestDistributedNodeJson,
  startDistributedNodeTransportServer,
} from '../tools/validation-engine/runtime/distributed-node-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests exercise the shared native envelope contract directly.
import { sealDistributedTrustedEnvelope } from '../tools/validation-engine/runtime/distributed-trusted-transport.mjs';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SHARED_KEY = '12'.repeat(32);
const OTHER_KEY = '34'.repeat(32);
const CONTROLLER_ID = 'controller-john';
const NODE_ID = 'node-01';

function sealedRequest({
  sharedKey = SHARED_KEY,
  nodeId = NODE_ID,
  kind = DISTRIBUTED_NODE_PROBE_KIND,
  body = { probe: true },
  requestId = 'request-00000001',
  nonce = 'nonce_000000000000000000000001',
  timestampMs = Date.now(),
  ttlMs = 30_000,
} = {}) {
  const secret = Buffer.from(sharedKey, 'hex');
  try {
    return sealDistributedTrustedEnvelope({
      secret,
      senderId: CONTROLLER_ID,
      recipientId: nodeId,
      kind,
      body,
      requestId,
      nonce,
      timestampMs,
      ttlMs,
      maximumBytes: DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
    });
  } finally {
    secret.fill(0);
  }
}

function rawPost({
  port,
  body,
  contentType = JSON_CONTENT_TYPE,
  contentLength,
  path = DISTRIBUTED_NODE_TRANSPORT_ROUTE,
}) {
  const encoded = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: {
          connection: 'close',
          'content-length': String(contentLength ?? encoded.length),
          'content-type': contentType,
        },
      },
      async (response) => {
        try {
          const chunks = [];
          for await (const chunk of response) chunks.push(chunk);
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        } catch (error) {
          reject(error);
        }
      }
    );
    request.once('error', reject);
    request.end(encoded);
  });
}

async function startTestNode(handler, options = {}) {
  return startDistributedNodeTransportServer({
    sharedKey: SHARED_KEY,
    controllerId: CONTROLLER_ID,
    nodeId: NODE_ID,
    allowedKinds: [DISTRIBUTED_NODE_PROBE_KIND, DISTRIBUTED_NODE_TASK_KIND],
    handler,
    host: '127.0.0.1',
    port: 0,
    ...options,
  });
}

async function listenFake(responder) {
  const server = createServer(responder);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeFakeJson(response, encoded, contentType = JSON_CONTENT_TYPE) {
  response.writeHead(200, {
    connection: 'close',
    'content-length': String(Buffer.byteLength(encoded)),
    'content-type': contentType,
  });
  response.end(encoded);
}

test('node transport exports its bounded versioned contract', () => {
  assert.equal(
    DISTRIBUTED_NODE_TRANSPORT_ROUTE,
    '/engine/v1/nodes/authenticated'
  );
  assert.equal(DISTRIBUTED_NODE_PROBE_KIND, 'engine.node.probe.v1');
  assert.equal(DISTRIBUTED_NODE_TASK_KIND, 'engine.node.task.v1');
  assert.equal(DEFAULT_DISTRIBUTED_NODE_BODY_BYTES, 1024 * 1024);
  assert.equal(MAX_DISTRIBUTED_NODE_BODY_BYTES, 32 * 1024 * 1024);
  assert.equal(DEFAULT_DISTRIBUTED_NODE_TIMEOUT_MS, 30_000);
  assert.equal(MAX_DISTRIBUTED_NODE_TIMEOUT_MS, 24 * 60 * 60 * 1000);
});

test('node transport authenticates a request and its separately signed response', async () => {
  let handled;
  const service = await startTestNode((value) => {
    handled = value;
    return { accepted: value.body.value };
  });
  try {
    const result = await requestDistributedNodeJson({
      address: service.host,
      port: service.port,
      sharedKey: SHARED_KEY,
      controllerId: CONTROLLER_ID,
      nodeId: NODE_ID,
      kind: DISTRIBUTED_NODE_TASK_KIND,
      body: { value: 42 },
    });
    assert.deepEqual({ ...result.body }, { accepted: 42 });
    assert.equal(result.statusCode, 200);
    assert.equal(result.envelope.senderId, NODE_ID);
    assert.equal(result.envelope.recipientId, CONTROLLER_ID);
    assert.equal(
      result.envelope.kind,
      `${DISTRIBUTED_NODE_TASK_KIND}.response`
    );
    assert.equal(result.envelope.requestId, handled.requestId);
    assert.equal(handled.controllerId, CONTROLLER_ID);
    assert.equal(handled.nodeId, NODE_ID);
    assert.equal(handled.kind, DISTRIBUTED_NODE_TASK_KIND);
    assert.deepEqual({ ...handled.body }, { value: 42 });
  } finally {
    await service.close();
  }
});

test('node transport rejects the wrong shared key without disclosing either key', async () => {
  const service = await startTestNode(() => ({ ok: true }));
  try {
    await assert.rejects(
      requestDistributedNodeJson({
        address: service.host,
        port: service.port,
        sharedKey: OTHER_KEY,
        controllerId: CONTROLLER_ID,
        nodeId: NODE_ID,
        kind: DISTRIBUTED_NODE_PROBE_KIND,
        body: {},
      }),
      (error) => {
        assert.equal(error.code, 'ERR_DISTRIBUTED_NODE_HTTP');
        assert.equal(error.statusCode, 401);
        assert.doesNotMatch(error.message, new RegExp(SHARED_KEY, 'i'));
        assert.doesNotMatch(error.message, new RegExp(OTHER_KEY, 'i'));
        return true;
      }
    );
  } finally {
    await service.close();
  }
});

test('node transport rejects a signed request for another node', async () => {
  const service = await startTestNode(() => ({ ok: true }));
  try {
    await assert.rejects(
      requestDistributedNodeJson({
        address: service.host,
        port: service.port,
        sharedKey: SHARED_KEY,
        controllerId: CONTROLLER_ID,
        nodeId: 'node-02',
        kind: DISTRIBUTED_NODE_PROBE_KIND,
        body: {},
      }),
      (error) =>
        error.code === 'ERR_DISTRIBUTED_NODE_HTTP' && error.statusCode === 401
    );
  } finally {
    await service.close();
  }
});

test('node transport consumes each authenticated request exactly once', async () => {
  let calls = 0;
  const service = await startTestNode(() => {
    calls += 1;
    return { calls };
  });
  const encoded = JSON.stringify(sealedRequest());
  try {
    const first = await rawPost({ port: service.port, body: encoded });
    const replay = await rawPost({ port: service.port, body: encoded });
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.body.length, 0);
    assert.equal(calls, 1);
  } finally {
    await service.close();
  }
});

test('node transport rejects body tampering before the handler', async () => {
  let calls = 0;
  const service = await startTestNode(() => {
    calls += 1;
    return {};
  });
  const tampered = JSON.parse(JSON.stringify(sealedRequest()));
  tampered.body.probe = false;
  try {
    const response = await rawPost({
      port: service.port,
      body: JSON.stringify(tampered),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.length, 0);
    assert.equal(calls, 0);
  } finally {
    await service.close();
  }
});

test('node transport rejects stale authentication before the handler', async () => {
  let calls = 0;
  const service = await startTestNode(() => {
    calls += 1;
    return {};
  });
  const stale = sealedRequest({
    timestampMs: Date.now() - 60_000,
    ttlMs: 1000,
  });
  try {
    const response = await rawPost({
      port: service.port,
      body: JSON.stringify(stale),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(calls, 0);
  } finally {
    await service.close();
  }
});

test('node transport enforces request size and exact media type', async (context) => {
  const service = await startTestNode(() => ({}), { maxRequestBytes: 512 });
  try {
    await context.test('oversized body', async () => {
      const response = await rawPost({
        port: service.port,
        body: 'x'.repeat(513),
      });
      assert.equal(response.statusCode, 413);
    });
    await context.test('inexact media type', async () => {
      const response = await rawPost({
        port: service.port,
        body: JSON.stringify(sealedRequest()),
        contentType: 'application/json',
      });
      assert.equal(response.statusCode, 415);
    });
  } finally {
    await service.close();
  }
});

test('node transport rejects malformed and duplicate-key request JSON', async (context) => {
  let calls = 0;
  const service = await startTestNode(() => {
    calls += 1;
    return {};
  });
  try {
    for (const [name, body] of [
      ['malformed', '{'],
      ['duplicate top-level key', '{"kind":"a","kind":"b"}'],
      ['duplicate escaped key', '{"body":{"a":1,"\\u0061":2}}'],
    ])
      await context.test(name, async () => {
        const response = await rawPost({ port: service.port, body });
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.length, 0);
      });
    assert.equal(calls, 0);
  } finally {
    await service.close();
  }
});

test('node transport client rejects malformed and duplicate-key response JSON', async (context) => {
  for (const [name, encoded] of [
    ['malformed', '{'],
    ['duplicate', '{"schema":"a","schema":"b"}'],
  ])
    await context.test(name, async () => {
      const fake = await listenFake((_request, response) =>
        writeFakeJson(response, encoded)
      );
      try {
        await assert.rejects(
          requestDistributedNodeJson({
            address: '127.0.0.1',
            port: fake.port,
            sharedKey: SHARED_KEY,
            controllerId: CONTROLLER_ID,
            nodeId: NODE_ID,
            kind: DISTRIBUTED_NODE_PROBE_KIND,
            body: {},
          }),
          { code: 'ERR_DISTRIBUTED_NODE_JSON' }
        );
      } finally {
        await fake.close();
      }
    });
});

test('node transport client verifies response sender, recipient, and request binding', async (context) => {
  for (const [name, changes] of [
    ['sender', { senderId: 'node-02' }],
    ['recipient', { recipientId: 'controller-other' }],
    ['request', { requestId: 'request-other' }],
  ])
    await context.test(name, async () => {
      const fake = await listenFake(async (request, response) => {
        const received = await readRequest(request);
        const secret = Buffer.from(SHARED_KEY, 'hex');
        try {
          const sealed = sealDistributedTrustedEnvelope({
            secret,
            senderId: changes.senderId ?? NODE_ID,
            recipientId: changes.recipientId ?? CONTROLLER_ID,
            kind: `${received.kind}.response`,
            requestId: changes.requestId ?? received.requestId,
            body: { ok: true },
          });
          writeFakeJson(response, JSON.stringify(sealed));
        } finally {
          secret.fill(0);
        }
      });
      try {
        await assert.rejects(
          requestDistributedNodeJson({
            address: '127.0.0.1',
            port: fake.port,
            sharedKey: SHARED_KEY,
            controllerId: CONTROLLER_ID,
            nodeId: NODE_ID,
            kind: DISTRIBUTED_NODE_PROBE_KIND,
            body: {},
          }),
          { code: 'ERR_DISTRIBUTED_TRANSPORT_AUTH' }
        );
      } finally {
        await fake.close();
      }
    });
});

test('node transport client enforces its timeout', async () => {
  const service = await startTestNode(
    ({ signal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ late: true }), 1000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true }
        );
      })
  );
  try {
    await assert.rejects(
      requestDistributedNodeJson({
        address: service.host,
        port: service.port,
        sharedKey: SHARED_KEY,
        controllerId: CONTROLLER_ID,
        nodeId: NODE_ID,
        kind: DISTRIBUTED_NODE_PROBE_KIND,
        body: {},
        timeoutMs: 30,
      }),
      { code: 'ERR_DISTRIBUTED_NODE_TIMEOUT' }
    );
  } finally {
    await service.close();
  }
});

test('node transport client honors an abort signal', async () => {
  let enteredResolve;
  const entered = new Promise((resolve) => {
    enteredResolve = resolve;
  });
  const service = await startTestNode(
    ({ signal }) =>
      new Promise((resolve, reject) => {
        enteredResolve();
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      })
  );
  const controller = new AbortController();
  try {
    const pending = requestDistributedNodeJson({
      address: service.host,
      port: service.port,
      sharedKey: SHARED_KEY,
      controllerId: CONTROLLER_ID,
      nodeId: NODE_ID,
      kind: DISTRIBUTED_NODE_PROBE_KIND,
      body: {},
      signal: controller.signal,
    });
    await entered;
    controller.abort();
    await assert.rejects(pending, {
      name: 'AbortError',
      code: 'ERR_DISTRIBUTED_NODE_ABORTED',
    });
  } finally {
    await service.close();
  }
});

test('node transport exposes no shared key through service, handler, response, or error data', async () => {
  let handled;
  const service = await startTestNode((value) => {
    handled = value;
    return { ok: true };
  });
  try {
    const result = await requestDistributedNodeJson({
      address: service.host,
      port: service.port,
      sharedKey: SHARED_KEY,
      controllerId: CONTROLLER_ID,
      nodeId: NODE_ID,
      kind: DISTRIBUTED_NODE_PROBE_KIND,
      body: {},
    });
    for (const visible of [service, handled, result])
      assert.equal(JSON.stringify(visible).includes(SHARED_KEY), false);
  } finally {
    await service.close();
  }

  let transmitted;
  const fake = await listenFake(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    transmitted = Buffer.concat(chunks).toString('utf8');
    const received = JSON.parse(transmitted);
    const secret = Buffer.from(SHARED_KEY, 'hex');
    try {
      const sealed = sealDistributedTrustedEnvelope({
        secret,
        senderId: NODE_ID,
        recipientId: CONTROLLER_ID,
        kind: `${received.kind}.response`,
        requestId: received.requestId,
        body: { ok: true },
      });
      writeFakeJson(response, JSON.stringify(sealed));
    } finally {
      secret.fill(0);
    }
  });
  try {
    await requestDistributedNodeJson({
      address: '127.0.0.1',
      port: fake.port,
      sharedKey: SHARED_KEY,
      controllerId: CONTROLLER_ID,
      nodeId: NODE_ID,
      kind: DISTRIBUTED_NODE_PROBE_KIND,
      body: {},
    });
    assert.equal(transmitted.includes(SHARED_KEY), false);
  } finally {
    await fake.close();
  }
});
