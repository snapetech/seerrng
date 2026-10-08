// Copyright (c) snapetech and SeerrNG contributors.
// Authenticated post-enrollment HTTP transport for trusted private-LAN nodes.
import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';

import {
  createDistributedTrustedReplayCache,
  DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  sealDistributedTrustedEnvelope,
  verifyDistributedTrustedEnvelope,
} from './distributed-trusted-transport.mjs';

export const DISTRIBUTED_NODE_TRANSPORT_ROUTE =
  '/engine/v1/nodes/authenticated';
export const DISTRIBUTED_NODE_PROBE_KIND = 'engine.node.probe.v1';
export const DISTRIBUTED_NODE_TASK_KIND = 'engine.node.task.v1';
export const DEFAULT_DISTRIBUTED_NODE_BODY_BYTES = 1024 * 1024;
export const MAX_DISTRIBUTED_NODE_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_DISTRIBUTED_NODE_TIMEOUT_MS = 30_000;
export const MAX_DISTRIBUTED_NODE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SHARED_KEY = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KIND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const REQUEST_KIND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,86}$/;
const MAX_JSON_DEPTH = 256;

function nodeTransportError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function boundedInteger(value, label, { minimum, maximum }) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be an integer from ${minimum} through ${maximum}`
    );
  return value;
}

function bodyLimit(value, label) {
  return boundedInteger(value, label, {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_NODE_BODY_BYTES,
  });
}

function timeout(value, label = 'Node transport timeout') {
  return boundedInteger(value, label, {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_NODE_TIMEOUT_MS,
  });
}

function authenticationTtl(value, label) {
  return boundedInteger(value, label, {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  });
}

function clockSkew(value) {
  return boundedInteger(value, 'Node transport clock-skew allowance', {
    minimum: 0,
    maximum: MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  });
}

function listenPort(value) {
  return boundedInteger(value, 'Node transport listen port', {
    minimum: 0,
    maximum: 65_535,
  });
}

function destinationPort(value) {
  return boundedInteger(value, 'Node transport destination port', {
    minimum: 1,
    maximum: 65_535,
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

function ipAddress(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || !isIP(value))
    throw new Error(`${label} must be an explicit IP address`);
  return value.toLowerCase();
}

function sharedKeyBytes(value) {
  if (typeof value !== 'string' || !SHARED_KEY.test(value))
    throw new Error(
      'Node transport shared key must be exactly 64 lowercase hexadecimal characters'
    );
  return Buffer.from(value, 'hex');
}

function normalizeKinds(values) {
  if (!Array.isArray(values) || values.length === 0)
    throw new Error('Node transport requires at least one allowed kind');
  const normalized = values.map((value) =>
    exactToken(value, 'allowed node message kind', REQUEST_KIND)
  );
  if (new Set(normalized).size !== normalized.length)
    throw new Error('Node transport allowed kinds must be unique');
  return new Set(normalized);
}

function responseKind(kind) {
  return exactToken(`${kind}.response`, 'node response kind', KIND);
}

function exactRawHeader(message, name, code) {
  const matches = [];
  for (let index = 0; index < message.rawHeaders.length; index += 2)
    if (message.rawHeaders[index].toLowerCase() === name)
      matches.push(message.rawHeaders[index + 1]);
  if (matches.length !== 1)
    throw nodeTransportError(
      `Node transport requires exactly one ${name} header`,
      code
    );
  return matches[0];
}

function rejectBodyEncoding(message) {
  if (
    message.headers['transfer-encoding'] !== undefined ||
    message.headers['content-encoding'] !== undefined
  )
    throw nodeTransportError(
      'Node transport does not accept encoded or chunked bodies',
      'ERR_DISTRIBUTED_NODE_CONTENT_ENCODING'
    );
}

function declaredLength(message, maximumBytes, { allowEmpty }) {
  const raw = exactRawHeader(
    message,
    'content-length',
    'ERR_DISTRIBUTED_NODE_LENGTH'
  );
  const pattern = allowEmpty ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(raw))
    throw nodeTransportError(
      'Node transport requires a canonical exact content length',
      'ERR_DISTRIBUTED_NODE_LENGTH'
    );
  const length = Number(raw);
  if (!Number.isSafeInteger(length))
    throw nodeTransportError(
      'Node transport content length is invalid',
      'ERR_DISTRIBUTED_NODE_LENGTH'
    );
  if (length > maximumBytes)
    throw nodeTransportError(
      'Node transport body exceeds its byte limit',
      'ERR_DISTRIBUTED_NODE_SIZE'
    );
  return length;
}

function requireJsonContentType(message) {
  const value = exactRawHeader(
    message,
    'content-type',
    'ERR_DISTRIBUTED_NODE_CONTENT_TYPE'
  );
  if (value !== JSON_CONTENT_TYPE)
    throw nodeTransportError(
      `Node transport requires ${JSON_CONTENT_TYPE}`,
      'ERR_DISTRIBUTED_NODE_CONTENT_TYPE'
    );
}

function rejectDuplicateObjectKeys(text, label) {
  let index = 0;
  const fail = () => {
    throw nodeTransportError(
      `${label} is not strict JSON`,
      'ERR_DISTRIBUTED_NODE_JSON'
    );
  };
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? '')) index += 1;
  };
  const scanString = () => {
    if (text[index] !== '"') fail();
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      index += 1;
    }
    fail();
  };
  const scanScalar = () => {
    const start = index;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
    if (index === start) fail();
  };
  const scanValue = (depth) => {
    if (depth > MAX_JSON_DEPTH)
      throw nodeTransportError(
        `${label} exceeds its nesting limit`,
        'ERR_DISTRIBUTED_NODE_JSON'
      );
    skipWhitespace();
    if (text[index] === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        const key = scanString();
        if (keys.has(key))
          throw nodeTransportError(
            `${label} contains a duplicate object key`,
            'ERR_DISTRIBUTED_NODE_JSON'
          );
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') fail();
        index += 1;
        scanValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') fail();
        index += 1;
        skipWhitespace();
      }
      fail();
    }
    if (text[index] === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        scanValue(depth + 1);
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        if (text[index] !== ',') fail();
        index += 1;
      }
      fail();
    }
    if (text[index] === '"') {
      scanString();
      return;
    }
    scanScalar();
  };

  skipWhitespace();
  scanValue(0);
  skipWhitespace();
  if (index !== text.length) fail();
}

function strictJson(encoded, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
  } catch {
    throw nodeTransportError(
      `${label} is not valid UTF-8 JSON`,
      'ERR_DISTRIBUTED_NODE_JSON'
    );
  }
  if (text.startsWith('\uFEFF'))
    throw nodeTransportError(
      `${label} must not contain a byte-order mark`,
      'ERR_DISTRIBUTED_NODE_JSON'
    );
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw nodeTransportError(
      `${label} is not valid JSON`,
      'ERR_DISTRIBUTED_NODE_JSON'
    );
  }
  rejectDuplicateObjectKeys(text, label);
  return decoded;
}

async function readExactBody(message, maximumBytes, options) {
  rejectBodyEncoding(message);
  const expected = declaredLength(message, maximumBytes, options);
  const chunks = [];
  let received = 0;
  try {
    for await (const chunk of message) {
      received += chunk.length;
      if (received > expected || received > maximumBytes)
        throw nodeTransportError(
          'Node transport body exceeded its declared length',
          'ERR_DISTRIBUTED_NODE_LENGTH'
        );
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.code?.startsWith('ERR_DISTRIBUTED_NODE_')) throw error;
    throw nodeTransportError(
      'Node transport body was interrupted',
      'ERR_DISTRIBUTED_NODE_ABORTED'
    );
  }
  if (received !== expected)
    throw nodeTransportError(
      'Node transport body did not match its declared length',
      'ERR_DISTRIBUTED_NODE_LENGTH'
    );
  return Buffer.concat(chunks, received);
}

async function readExactJson(message, maximumBytes, label) {
  requireJsonContentType(message);
  return strictJson(
    await readExactBody(message, maximumBytes, { allowEmpty: false }),
    label
  );
}

function sendEmpty(response, statusCode) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': '0',
    'x-content-type-options': 'nosniff',
  });
  response.end();
}

function sendJson(response, value, maximumBytes) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  if (encoded.length > maximumBytes)
    throw nodeTransportError(
      'Node transport response exceeds its byte limit',
      'ERR_DISTRIBUTED_NODE_SIZE'
    );
  response.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': String(encoded.length),
    'content-type': JSON_CONTENT_TYPE,
    'x-content-type-options': 'nosniff',
  });
  response.end(encoded);
}

function errorStatus(error, authenticated) {
  if (error.code === 'ERR_DISTRIBUTED_TRANSPORT_REPLAY') return 409;
  if (error.code === 'ERR_DISTRIBUTED_NODE_SIZE') return 413;
  if (error.code === 'ERR_DISTRIBUTED_NODE_CONTENT_TYPE') return 415;
  if (error.code === 'ERR_DISTRIBUTED_NODE_CONTENT_ENCODING') return 415;
  if (error.code === 'ERR_DISTRIBUTED_NODE_LENGTH') return 411;
  if (error.code === 'ERR_DISTRIBUTED_NODE_JSON') return 400;
  if (error.code === 'ERR_DISTRIBUTED_NODE_TIMEOUT') return 504;
  if (error.code === 'ERR_DISTRIBUTED_TRANSPORT_SIZE') return 413;
  if (error.code === 'ERR_DISTRIBUTED_TRANSPORT_AUTH') return 401;
  if (!authenticated) return 401;
  return 500;
}

function abortError(message = 'Node transport request was aborted') {
  return Object.assign(
    nodeTransportError(message, 'ERR_DISTRIBUTED_NODE_ABORTED'),
    { name: 'AbortError' }
  );
}

function timeoutError() {
  return nodeTransportError(
    'Node transport request timed out',
    'ERR_DISTRIBUTED_NODE_TIMEOUT'
  );
}

function runHandler(handler, value, timeoutMs, controller) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = timeoutError();
      controller.abort(error);
      finish(error);
    }, timeoutMs);
    timer.unref?.();
    Promise.resolve()
      .then(() => handler(value))
      .then((result) => finish(null, result), finish);
  });
}

export async function startDistributedNodeTransportServer({
  sharedKey,
  controllerId: controllerIdValue,
  nodeId: nodeIdValue,
  allowedKinds,
  handler,
  host = '127.0.0.1',
  port = 0,
  maxRequestBytes = DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
  maxResponseBytes = DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
  responseTtlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  handlerTimeoutMs = DEFAULT_DISTRIBUTED_NODE_TIMEOUT_MS,
  closeGraceMs = 1000,
  replayCache = createDistributedTrustedReplayCache(),
  clock = Date.now,
} = {}) {
  if (typeof handler !== 'function')
    throw new Error('Node transport server requires a handler');
  if (typeof clock !== 'function')
    throw new Error('Node transport server requires a clock');
  const controllerId = exactToken(controllerIdValue, 'controller ID');
  const nodeId = exactToken(nodeIdValue, 'node ID');
  const kinds = normalizeKinds(allowedKinds);
  const bindHost = ipAddress(host, 'Node transport bind address');
  const bindPort = listenPort(port);
  const requestLimit = bodyLimit(maxRequestBytes, 'Node request byte limit');
  const responseLimit = bodyLimit(maxResponseBytes, 'Node response byte limit');
  const responseTtl = authenticationTtl(
    responseTtlMs,
    'Node response authentication TTL'
  );
  const allowedClockSkew = clockSkew(clockSkewMs);
  const handlerTimeout = timeout(handlerTimeoutMs, 'Node handler timeout');
  const closeGrace = timeout(closeGraceMs, 'Node service close grace');
  const retainedKey = sharedKeyBytes(sharedKey);
  const sockets = new Set();
  const active = new Set();
  let closing = false;

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      sendEmpty(response, 405);
      request.resume();
      return;
    }
    if (request.url !== DISTRIBUTED_NODE_TRANSPORT_ROUTE) {
      sendEmpty(response, 404);
      request.resume();
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    let authenticated = false;
    const abort = () => controller.abort(abortError());
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    try {
      const raw = await readExactJson(
        request,
        requestLimit,
        'Node transport request'
      );
      if (!kinds.has(raw?.kind))
        throw nodeTransportError(
          'Node transport message kind is not allowed',
          'ERR_DISTRIBUTED_TRANSPORT_AUTH'
        );
      const envelope = verifyDistributedTrustedEnvelope(raw, {
        secret: retainedKey,
        replayCache,
        nowMs: clock(),
        expectedSenderId: controllerId,
        expectedRecipientId: nodeId,
        expectedKind: raw.kind,
        expectedRequestId: raw.requestId,
        maximumBytes: requestLimit,
        clockSkewMs: allowedClockSkew,
      });
      authenticated = true;
      if (closing || controller.signal.aborted) throw abortError();
      const body = await runHandler(
        handler,
        {
          controllerId,
          nodeId,
          kind: envelope.kind,
          requestId: envelope.requestId,
          body: envelope.body,
          remoteAddress: request.socket.remoteAddress ?? null,
          signal: controller.signal,
        },
        handlerTimeout,
        controller
      );
      if (closing || controller.signal.aborted || response.destroyed) return;
      const sealed = sealDistributedTrustedEnvelope({
        secret: retainedKey,
        senderId: nodeId,
        recipientId: controllerId,
        kind: responseKind(envelope.kind),
        requestId: envelope.requestId,
        timestampMs: clock(),
        ttlMs: responseTtl,
        body,
        maximumBytes: responseLimit,
      });
      sendJson(response, sealed, responseLimit);
    } catch (error) {
      if (response.destroyed) return;
      if (
        controller.signal.aborted &&
        error.code !== 'ERR_DISTRIBUTED_NODE_TIMEOUT'
      ) {
        response.destroy();
        return;
      }
      sendEmpty(response, errorStatus(error, authenticated));
      request.resume();
    } finally {
      active.delete(controller);
      request.removeListener('aborted', abort);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.requestTimeout = handlerTimeout;

  try {
    await new Promise((resolveListen, rejectListen) => {
      const fail = (error) => rejectListen(error);
      server.once('error', fail);
      server.listen(bindPort, bindHost, () => {
        server.removeListener('error', fail);
        resolveListen();
      });
    });
  } catch (error) {
    retainedKey.fill(0);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    retainedKey.fill(0);
    server.close();
    throw new Error('Node transport service address is unavailable');
  }
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    for (const controller of active) controller.abort(abortError());
    closePromise = new Promise((resolveClose, rejectClose) => {
      const force = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
      }, closeGrace);
      force.unref?.();
      server.close((error) => {
        clearTimeout(force);
        retainedKey.fill(0);
        replayCache.clear();
        if (error) rejectClose(error);
        else resolveClose();
      });
      server.closeIdleConnections?.();
    });
    return closePromise;
  };
  return Object.freeze({
    host: bindHost,
    port: address.port,
    route: DISTRIBUTED_NODE_TRANSPORT_ROUTE,
    close,
  });
}

async function collectResponse(response, maximumBytes) {
  rejectBodyEncoding(response);
  const encoded = await readExactBody(response, maximumBytes, {
    allowEmpty: response.statusCode !== 200,
  });
  if (response.statusCode !== 200)
    throw nodeTransportError(
      `Node transport request failed with HTTP ${response.statusCode}`,
      'ERR_DISTRIBUTED_NODE_HTTP',
      { statusCode: response.statusCode }
    );
  requireJsonContentType(response);
  return strictJson(encoded, 'Node transport response');
}

export async function requestDistributedNodeJson({
  address: addressValue,
  port: portValue,
  sharedKey,
  controllerId: controllerIdValue,
  nodeId: nodeIdValue,
  kind: kindValue,
  body,
  timeoutMs = DEFAULT_DISTRIBUTED_NODE_TIMEOUT_MS,
  signal,
  requestId,
  nonce,
  timestampMs,
  ttlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  maxRequestBytes = DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
  maxResponseBytes = DEFAULT_DISTRIBUTED_NODE_BODY_BYTES,
  clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  replayCache = createDistributedTrustedReplayCache(),
  clock = Date.now,
} = {}) {
  if (typeof clock !== 'function')
    throw new Error('Node transport client requires a clock');
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Node transport signal must be an AbortSignal');
  if (signal?.aborted) throw abortError();
  const address = ipAddress(addressValue, 'Node transport destination address');
  const port = destinationPort(portValue);
  const controllerId = exactToken(controllerIdValue, 'controller ID');
  const nodeId = exactToken(nodeIdValue, 'node ID');
  const kind = exactToken(kindValue, 'node message kind', REQUEST_KIND);
  const requestTimeout = timeout(timeoutMs);
  const requestLimit = bodyLimit(maxRequestBytes, 'Node request byte limit');
  const responseLimit = bodyLimit(maxResponseBytes, 'Node response byte limit');
  const allowedClockSkew = clockSkew(clockSkewMs);
  const key = sharedKeyBytes(sharedKey);
  try {
    const envelope = sealDistributedTrustedEnvelope({
      secret: key,
      senderId: controllerId,
      recipientId: nodeId,
      kind,
      body,
      ...(requestId === undefined ? {} : { requestId }),
      ...(nonce === undefined ? {} : { nonce }),
      timestampMs: timestampMs === undefined ? clock() : timestampMs,
      ttlMs,
      maximumBytes: requestLimit,
    });
    const encoded = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (encoded.length > requestLimit)
      throw nodeTransportError(
        'Node transport request exceeds its byte limit',
        'ERR_DISTRIBUTED_NODE_SIZE'
      );

    return await new Promise((resolveRequest, rejectRequest) => {
      let settled = false;
      let request;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) rejectRequest(error);
        else resolveRequest(result);
      };
      const abort = () => request.destroy(abortError());
      request = httpRequest(
        {
          protocol: 'http:',
          hostname: address,
          port,
          path: DISTRIBUTED_NODE_TRANSPORT_ROUTE,
          method: 'POST',
          agent: false,
          headers: {
            accept: JSON_CONTENT_TYPE,
            'cache-control': 'no-store',
            connection: 'close',
            'content-length': String(encoded.length),
            'content-type': JSON_CONTENT_TYPE,
          },
        },
        (response) => {
          void (async () => {
            try {
              const decoded = await collectResponse(response, responseLimit);
              const verified = verifyDistributedTrustedEnvelope(decoded, {
                secret: key,
                replayCache,
                nowMs: clock(),
                expectedSenderId: nodeId,
                expectedRecipientId: controllerId,
                expectedKind: responseKind(kind),
                expectedRequestId: envelope.requestId,
                maximumBytes: responseLimit,
                clockSkewMs: allowedClockSkew,
              });
              finish(
                null,
                Object.freeze({
                  body: verified.body,
                  envelope: verified,
                  statusCode: response.statusCode,
                })
              );
            } catch (error) {
              finish(error);
            }
          })();
        }
      );
      const timer = setTimeout(
        () => request.destroy(timeoutError()),
        requestTimeout
      );
      timer.unref?.();
      signal?.addEventListener('abort', abort, { once: true });
      request.once('error', (error) => finish(error));
      request.end(encoded);
    });
  } finally {
    key.fill(0);
  }
}
