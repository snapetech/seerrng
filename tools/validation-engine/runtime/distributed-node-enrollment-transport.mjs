// Copyright (c) snapetech and SeerrNG contributors.
// First-contact enrollment is intentionally unauthenticated because this MVP
// treats access to the operator's private LAN as its enrollment trust boundary.
import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';

import {
  createNodeEnrollmentRequest,
  createNodeEnrollmentResponse,
  createSupportedApplicationListing,
  createSupportedApplicationListingResponse,
  enrollNodeInControllerConfigFile,
  readControllerConfigFile,
} from './distributed-linux-config.mjs';

export const NODE_ENROLLMENT_ROUTE = '/engine/v1/nodes/enroll';
export const SUPPORTED_APPLICATIONS_ROUTE = '/engine/v1/applications';
export const NODE_ENROLLMENT_TRUST_BOUNDARY =
  'trusted-private-lan-unauthenticated-first-contact';
export const DEFAULT_NODE_ENROLLMENT_BODY_BYTES = 16 * 1024;
export const MAX_NODE_ENROLLMENT_BODY_BYTES = 64 * 1024;
export const DEFAULT_NODE_ENROLLMENT_TIMEOUT_MS = 10_000;
export const MAX_NODE_ENROLLMENT_TIMEOUT_MS = 120_000;

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

function enrollmentTransportError(message, code) {
  return Object.assign(new Error(message), { code });
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
    maximum: MAX_NODE_ENROLLMENT_BODY_BYTES,
  });
}

function timeout(value) {
  return boundedInteger(value, 'Node enrollment timeout', {
    minimum: 1,
    maximum: MAX_NODE_ENROLLMENT_TIMEOUT_MS,
  });
}

function ipAddress(value, label) {
  if (typeof value !== 'string' || isIP(value) === 0)
    throw new Error(`${label} must be an explicit IP address`);
  return value;
}

function listenPort(value) {
  return boundedInteger(value, 'Node enrollment listen port', {
    minimum: 0,
    maximum: 65_535,
  });
}

function controllerPort(value) {
  return boundedInteger(value, 'Node enrollment controller port', {
    minimum: 1,
    maximum: 65_535,
  });
}

function contentTypeIsJson(value) {
  return typeof value === 'string' && JSON_CONTENT_TYPE.test(value);
}

function responseHeaders(encoded) {
  return {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': String(encoded.length),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(statusCode, {
    ...responseHeaders(encoded),
    ...extraHeaders,
  });
  response.end(encoded);
}

function sendError(response, statusCode, error, extraHeaders = {}) {
  sendJson(response, statusCode, { error }, extraHeaders);
}

function rejectDuplicateObjectKeys(text, label) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? '')) index += 1;
  };
  const scanString = () => {
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
    throw new Error('Valid JSON string was not terminated');
  };
  const scanValue = () => {
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
          throw enrollmentTransportError(
            `${label} contains a duplicate object key`,
            'ERR_NODE_ENROLLMENT_JSON'
          );
        keys.add(key);
        skipWhitespace();
        index += 1;
        scanValue();
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        index += 1;
        skipWhitespace();
      }
      return;
    }
    if (text[index] === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        scanValue();
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        index += 1;
      }
      return;
    }
    if (text[index] === '"') {
      scanString();
      return;
    }
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
  };

  scanValue();
}

function strictUtf8Json(encoded, label) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(encoded);
  } catch {
    throw enrollmentTransportError(
      `${label} is not valid UTF-8 JSON`,
      'ERR_NODE_ENROLLMENT_JSON'
    );
  }
  if (text.startsWith('\uFEFF'))
    throw enrollmentTransportError(
      `${label} must not contain a byte-order mark`,
      'ERR_NODE_ENROLLMENT_JSON'
    );
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw enrollmentTransportError(
      `${label} is not valid JSON`,
      'ERR_NODE_ENROLLMENT_JSON'
    );
  }
  rejectDuplicateObjectKeys(text, label);
  return decoded;
}

async function readBoundedRequest(request, maximumBytes) {
  if (!contentTypeIsJson(request.headers['content-type']))
    throw enrollmentTransportError(
      'Node enrollment requires application/json',
      'ERR_NODE_ENROLLMENT_CONTENT_TYPE'
    );
  if (
    request.headers['content-encoding'] !== undefined &&
    request.headers['content-encoding'] !== 'identity'
  )
    throw enrollmentTransportError(
      'Node enrollment does not accept encoded request bodies',
      'ERR_NODE_ENROLLMENT_CONTENT_ENCODING'
    );
  const length = request.headers['content-length'];
  if (typeof length !== 'string' || !/^[1-9]\d*$/.test(length))
    throw enrollmentTransportError(
      'Node enrollment requires an exact content length',
      'ERR_NODE_ENROLLMENT_LENGTH'
    );
  const expected = Number(length);
  if (!Number.isSafeInteger(expected) || expected > maximumBytes)
    throw enrollmentTransportError(
      'Node enrollment request exceeds its body limit',
      'ERR_NODE_ENROLLMENT_SIZE'
    );

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes)
      throw enrollmentTransportError(
        'Node enrollment request exceeds its body limit',
        'ERR_NODE_ENROLLMENT_SIZE'
      );
    chunks.push(chunk);
  }
  if (received !== expected)
    throw enrollmentTransportError(
      'Node enrollment request length is incomplete',
      'ERR_NODE_ENROLLMENT_LENGTH'
    );
  return strictUtf8Json(
    Buffer.concat(chunks, received),
    'Node enrollment request'
  );
}

function requestErrorStatus(error) {
  if (error.code === 'ERR_NODE_ENROLLMENT_SIZE') return 413;
  if (error.code === 'ERR_NODE_ENROLLMENT_CONTENT_TYPE') return 415;
  if (error.code === 'ERR_NODE_ENROLLMENT_CONTENT_ENCODING') return 415;
  if (error.code === 'ERR_NODE_ENROLLMENT_LENGTH') return 411;
  if (error.code === 'ERR_NODE_ENROLLMENT_JSON') return 400;
  return 400;
}

function closeHttpServer(server, sockets) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
    server.closeIdleConnections?.();
    for (const socket of sockets) socket.destroy();
  });
}

export async function startNodeEnrollmentServer({
  controllerConfigPath,
  host,
  port = 0,
  requestBodyLimitBytes = DEFAULT_NODE_ENROLLMENT_BODY_BYTES,
  requestTimeoutMs = DEFAULT_NODE_ENROLLMENT_TIMEOUT_MS,
}) {
  if (typeof controllerConfigPath !== 'string' || !controllerConfigPath)
    throw new Error('Node enrollment requires a controller config path');
  const bindHost = ipAddress(host, 'Node enrollment bind host');
  const bindPort = listenPort(port);
  const requestLimit = bodyLimit(
    requestBodyLimitBytes,
    'Node enrollment request body limit'
  );
  const timeoutMs = timeout(requestTimeoutMs);
  const sockets = new Set();

  const server = createServer(async (request, response) => {
    if (request.url === SUPPORTED_APPLICATIONS_ROUTE) {
      request.resume();
      if (request.method !== 'GET') {
        sendError(response, 405, 'method-not-allowed', { allow: 'GET' });
        return;
      }
      try {
        sendJson(
          response,
          200,
          createSupportedApplicationListing(
            readControllerConfigFile(controllerConfigPath)
          )
        );
      } catch {
        sendError(response, 500, 'controller-config-unavailable');
      }
      return;
    }
    if (request.url !== NODE_ENROLLMENT_ROUTE) {
      request.resume();
      sendError(response, 404, 'not-found');
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      sendError(response, 405, 'method-not-allowed', { allow: 'POST' });
      return;
    }

    try {
      const decoded = await readBoundedRequest(request, requestLimit);
      let enrollmentRequest;
      try {
        enrollmentRequest = createNodeEnrollmentRequest(decoded);
      } catch {
        throw enrollmentTransportError(
          'Node enrollment request fields are invalid',
          'ERR_NODE_ENROLLMENT_REQUEST'
        );
      }
      const enrollmentResponse = enrollNodeInControllerConfigFile(
        controllerConfigPath,
        enrollmentRequest
      );
      if (enrollmentResponse.status === 'conflict') {
        // The strict conflict model has no shared authentication key field.
        sendJson(response, 409, enrollmentResponse);
        return;
      }
      sendJson(response, 200, enrollmentResponse);
    } catch (error) {
      if (request.aborted || response.destroyed) return;
      request.resume();
      if (error.code?.startsWith('ERR_NODE_ENROLLMENT_')) {
        sendError(response, requestErrorStatus(error), 'invalid-request');
        return;
      }
      sendError(response, 500, 'controller-config-unavailable');
    }
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs;
  server.keepAliveTimeout = 1;
  server.maxHeadersCount = 32;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise((resolveListen, rejectListen) => {
    const fail = (error) => rejectListen(error);
    server.once('error', fail);
    server.listen(bindPort, bindHost, () => {
      server.removeListener('error', fail);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Node enrollment server address is unavailable');
  }

  let closePromise;
  return Object.freeze({
    host: address.address,
    port: address.port,
    route: NODE_ENROLLMENT_ROUTE,
    applicationsRoute: SUPPORTED_APPLICATIONS_ROUTE,
    trustBoundary: NODE_ENROLLMENT_TRUST_BOUNDARY,
    server,
    close() {
      closePromise ??= closeHttpServer(server, sockets);
      return closePromise;
    },
  });
}

function responseContentLength(response, maximumBytes) {
  const length = response.headers['content-length'];
  if (length === undefined) return null;
  if (typeof length !== 'string' || !/^\d+$/.test(length))
    throw enrollmentTransportError(
      'Node enrollment response has an invalid content length',
      'ERR_NODE_ENROLLMENT_LENGTH'
    );
  const expected = Number(length);
  if (!Number.isSafeInteger(expected) || expected > maximumBytes)
    throw enrollmentTransportError(
      'Node enrollment response exceeds its body limit',
      'ERR_NODE_ENROLLMENT_SIZE'
    );
  return expected;
}

async function collectBoundedResponse(response, maximumBytes) {
  const expected = responseContentLength(response, maximumBytes);
  const chunks = [];
  let received = 0;
  for await (const chunk of response) {
    received += chunk.length;
    if (received > maximumBytes)
      throw enrollmentTransportError(
        'Node enrollment response exceeds its body limit',
        'ERR_NODE_ENROLLMENT_SIZE'
      );
    chunks.push(chunk);
  }
  if (expected !== null && received !== expected)
    throw enrollmentTransportError(
      'Node enrollment response length is incomplete',
      'ERR_NODE_ENROLLMENT_LENGTH'
    );
  return Buffer.concat(chunks, received);
}

function abortedError() {
  return enrollmentTransportError(
    'Node enrollment request was aborted',
    'ERR_NODE_ENROLLMENT_ABORTED'
  );
}

function timedOutError() {
  return enrollmentTransportError(
    'Node enrollment request timed out',
    'ERR_NODE_ENROLLMENT_TIMEOUT'
  );
}

export async function requestNodeEnrollment({
  controllerIpAddress,
  controllerPort: controllerPortValue,
  enrollmentRequest: requestValue,
  timeoutMs: timeoutValue = DEFAULT_NODE_ENROLLMENT_TIMEOUT_MS,
  responseBodyLimitBytes = DEFAULT_NODE_ENROLLMENT_BODY_BYTES,
  signal,
}) {
  const hostname = ipAddress(
    controllerIpAddress,
    'Node enrollment controller IP address'
  );
  const port = controllerPort(controllerPortValue);
  const requestValueNormalized = createNodeEnrollmentRequest(requestValue);
  const responseLimit = bodyLimit(
    responseBodyLimitBytes,
    'Node enrollment response body limit'
  );
  const requestTimeout = timeout(timeoutValue);
  if (
    signal !== undefined &&
    (!signal || typeof signal.addEventListener !== 'function')
  )
    throw new Error('Node enrollment abort signal is invalid');
  if (signal?.aborted) throw abortedError();

  const encoded = Buffer.from(JSON.stringify(requestValueNormalized), 'utf8');
  if (encoded.length > MAX_NODE_ENROLLMENT_BODY_BYTES)
    throw enrollmentTransportError(
      'Node enrollment request exceeds its body limit',
      'ERR_NODE_ENROLLMENT_SIZE'
    );

  const received = await new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let timer;
    let request;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) rejectRequest(error);
      else resolveRequest(result);
    };
    const abort = () => request?.destroy(abortedError());

    request = httpRequest(
      {
        protocol: 'http:',
        hostname,
        port,
        path: NODE_ENROLLMENT_ROUTE,
        method: 'POST',
        agent: false,
        headers: {
          accept: 'application/json',
          'cache-control': 'no-store',
          connection: 'close',
          'content-length': String(encoded.length),
          'content-type': 'application/json; charset=utf-8',
        },
      },
      async (response) => {
        try {
          const encodedResponse = await collectBoundedResponse(
            response,
            responseLimit
          );
          if (![200, 409].includes(response.statusCode))
            throw enrollmentTransportError(
              `Node enrollment failed with HTTP ${response.statusCode}`,
              'ERR_NODE_ENROLLMENT_HTTP'
            );
          if (!contentTypeIsJson(response.headers['content-type']))
            throw enrollmentTransportError(
              'Node enrollment response is not application/json',
              'ERR_NODE_ENROLLMENT_CONTENT_TYPE'
            );
          const decoded = strictUtf8Json(
            encodedResponse,
            'Node enrollment response'
          );
          const enrollmentResponse = createNodeEnrollmentResponse(decoded);
          if (
            (response.statusCode === 200 &&
              enrollmentResponse.status !== 'accepted') ||
            (response.statusCode === 409 &&
              enrollmentResponse.status !== 'conflict')
          )
            throw enrollmentTransportError(
              'Node enrollment response conflicts with its HTTP status',
              'ERR_NODE_ENROLLMENT_HTTP'
            );
          finish(null, enrollmentResponse);
        } catch (error) {
          finish(error);
        }
      }
    );
    timer = setTimeout(() => request.destroy(timedOutError()), requestTimeout);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', (error) => finish(error));
    request.end(encoded);
  });
  return received;
}

export async function requestSupportedApplications({
  controllerIpAddress,
  controllerPort: controllerPortValue,
  timeoutMs: timeoutValue = DEFAULT_NODE_ENROLLMENT_TIMEOUT_MS,
  responseBodyLimitBytes = MAX_NODE_ENROLLMENT_BODY_BYTES,
  signal,
}) {
  const hostname = ipAddress(
    controllerIpAddress,
    'Supported applications controller IP address'
  );
  const port = controllerPort(controllerPortValue);
  const responseLimit = bodyLimit(
    responseBodyLimitBytes,
    'Supported applications response body limit'
  );
  const requestTimeout = timeout(timeoutValue);
  if (
    signal !== undefined &&
    (!signal || typeof signal.addEventListener !== 'function')
  )
    throw new Error('Supported applications abort signal is invalid');
  if (signal?.aborted) throw abortedError();

  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let timer;
    let request;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) rejectRequest(error);
      else resolveRequest(result);
    };
    const abort = () => request?.destroy(abortedError());
    request = httpRequest(
      {
        protocol: 'http:',
        hostname,
        port,
        path: SUPPORTED_APPLICATIONS_ROUTE,
        method: 'GET',
        agent: false,
        headers: {
          accept: 'application/json',
          'cache-control': 'no-store',
          connection: 'close',
        },
      },
      async (response) => {
        try {
          const encodedResponse = await collectBoundedResponse(
            response,
            responseLimit
          );
          if (response.statusCode !== 200)
            throw enrollmentTransportError(
              `Supported applications request failed with HTTP ${response.statusCode}`,
              'ERR_NODE_ENROLLMENT_HTTP'
            );
          if (!contentTypeIsJson(response.headers['content-type']))
            throw enrollmentTransportError(
              'Supported applications response is not application/json',
              'ERR_NODE_ENROLLMENT_CONTENT_TYPE'
            );
          const decoded = strictUtf8Json(
            encodedResponse,
            'Supported applications response'
          );
          finish(null, createSupportedApplicationListingResponse(decoded));
        } catch (error) {
          finish(error);
        }
      }
    );
    timer = setTimeout(() => request.destroy(timedOutError()), requestTimeout);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', (error) => finish(error));
    request.end();
  });
}
