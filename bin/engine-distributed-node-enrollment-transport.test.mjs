import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  controllerConfigFilename,
  persistControllerConfigFile,
  readControllerConfigFile,
} from '../tools/validation-engine/runtime/distributed-linux-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These focused tests run in native Node without application aliases.
import {
  DEFAULT_NODE_ENROLLMENT_BODY_BYTES,
  NODE_ENROLLMENT_ROUTE,
  NODE_ENROLLMENT_TRUST_BOUNDARY,
  requestNodeEnrollment,
  requestSupportedApplications,
  startNodeEnrollmentServer,
  SUPPORTED_APPLICATIONS_ROUTE,
} from '../tools/validation-engine/runtime/distributed-node-enrollment-transport.mjs';

const sharedAuthenticationKey = 'a'.repeat(64);

function controllerConfig(nodes = [], changes = {}) {
  return {
    global: {
      githubUsername: 'JohnCronk79',
      computerName: "John's Laptop",
      ipAddress: '127.0.0.10',
      port: 7443,
      cpuName: 'AMD Ryzen 9 7940HS',
      availableThreads: 16,
      threads: '2n',
      minimumThreadCount: 1,
    },
    nodes,
    sharedAuthenticationKey,
    ...changes,
  };
}

function controllerNode(changes = {}) {
  return {
    nodeNumber: '01',
    computerName: 'Test Node 01',
    ipAddress: '127.0.0.31',
    port: 7443,
    cpuName: 'AMD Ryzen Embedded V3C14',
    availableThreads: 8,
    threads: 'n-1',
    minimumThreadCount: 1,
    ...changes,
  };
}

function enrollmentRequest(changes = {}) {
  return {
    nodeNumber: '01',
    computerName: 'Test Node 01',
    ipAddress: '127.0.0.31',
    port: 7443,
    cpuName: 'AMD Ryzen Embedded V3C14',
    availableThreads: 8,
    overwrite: false,
    ...changes,
  };
}

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function listenOnLoopback(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function startEnrollmentFixture(t, nodes = [], changes = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-node-enrollment-'));
  const configPath = join(directory, controllerConfigFilename('JohnCronk79'));
  persistControllerConfigFile(configPath, controllerConfig(nodes, changes));
  const enrollmentServer = await startNodeEnrollmentServer({
    controllerConfigPath: configPath,
    host: '127.0.0.1',
    port: 0,
  });
  t.after(async () => {
    await enrollmentServer.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { configPath, enrollmentServer };
}

function rawHttpRequest({
  port,
  method = 'POST',
  path = NODE_ENROLLMENT_ROUTE,
  body = Buffer.alloc(0),
  headers = {},
}) {
  const encoded = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        headers: {
          connection: 'close',
          ...(method === 'POST'
            ? {
                'content-length': String(encoded.length),
                'content-type': 'application/json',
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('error', rejectRequest);
        response.once('end', () =>
          resolveRequest({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    request.once('error', rejectRequest);
    request.end(encoded);
  });
}

async function withResponseServer(t, handler) {
  const server = createServer(handler);
  const port = await listenOnLoopback(server);
  t.after(() => closeServer(server));
  return port;
}

test('first contact explicitly uses the trusted private LAN boundary', () => {
  assert.equal(
    NODE_ENROLLMENT_TRUST_BOUNDARY,
    'trusted-private-lan-unauthenticated-first-contact'
  );
  assert.equal(NODE_ENROLLMENT_ROUTE, '/engine/v1/nodes/enroll');
  assert.equal(SUPPORTED_APPLICATIONS_ROUTE, '/engine/v1/applications');
});

test('node fetches supported apps in memory and reports actual dependency availability', async (t) => {
  const profilePath = join(tmpdir(), 'seerrng-test-suite-dependancies.cfg');
  const { configPath, enrollmentServer } = await startEnrollmentFixture(t, [], {
    supportedApplications: [
      {
        entryId: '01',
        applicationId: 'SeerrNG 3.17.0',
        name: 'SeerrNG',
        profilePath,
      },
    ],
    applicationRequirements: [
      {
        applicationId: 'SeerrNG 3.17.0',
        dependencies: [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ],
      },
    ],
    nodeDependencyAvailability: [],
  });
  const listing = await requestSupportedApplications({
    controllerIpAddress: '127.0.0.1',
    controllerPort: enrollmentServer.port,
  });
  assert.deepEqual(listing, {
    applications: [
      {
        entryId: '01',
        applicationId: 'SeerrNG 3.17.0',
        name: 'SeerrNG',
        profilePath,
        requirements: [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ],
      },
    ],
  });

  const response = await requestNodeEnrollment({
    controllerIpAddress: '127.0.0.1',
    controllerPort: enrollmentServer.port,
    enrollmentRequest: {
      ...enrollmentRequest(),
      selectedApplicationEntries: ['01'],
      dependencyAvailability: [
        { name: 'node', version: '24.21.0' },
        { name: 'pnpm', version: '10.24.0' },
      ],
    },
  });
  assert.deepEqual(response.selectedApplications, [
    {
      entryId: '01',
      applicationId: 'SeerrNG 3.17.0',
      name: 'SeerrNG',
    },
  ]);
  assert.deepEqual(
    readControllerConfigFile(configPath).nodeDependencyAvailability,
    [
      {
        nodeNumber: '01',
        dependencies: [
          { name: 'node', version: '24.21.0' },
          { name: 'pnpm', version: '10.24.0' },
        ],
      },
    ]
  );
});

test('controller accepts a new node and returns the shared cluster key', async (t) => {
  const { configPath, enrollmentServer } = await startEnrollmentFixture(t);
  const response = await requestNodeEnrollment({
    controllerIpAddress: '127.0.0.1',
    controllerPort: enrollmentServer.port,
    enrollmentRequest: enrollmentRequest(),
  });

  assert.deepEqual(response, {
    status: 'accepted',
    disposition: 'created',
    nodeNumber: '01',
    sharedAuthenticationKey,
  });
  const persisted = readControllerConfigFile(configPath);
  assert.deepEqual(persisted.nodes, [
    controllerNode({ threads: null, minimumThreadCount: null }),
  ]);
});

test('occupied node number returns 409 and never exposes the shared key', async (t) => {
  const { enrollmentServer } = await startEnrollmentFixture(t, [
    controllerNode(),
  ]);
  const conflicting = enrollmentRequest({
    ipAddress: '127.0.0.41',
    computerName: 'Different Node',
  });
  const raw = await rawHttpRequest({
    port: enrollmentServer.port,
    body: JSON.stringify(conflicting),
  });

  assert.equal(raw.statusCode, 409);
  assert.equal(raw.headers['content-type'], 'application/json; charset=utf-8');
  assert.doesNotMatch(raw.body.toString('utf8'), /sharedAuthenticationKey/);
  assert.doesNotMatch(
    raw.body.toString('utf8'),
    new RegExp(sharedAuthenticationKey)
  );
  const decoded = JSON.parse(raw.body.toString('utf8'));
  assert.equal(decoded.status, 'conflict');
  assert.equal(Object.hasOwn(decoded, 'sharedAuthenticationKey'), false);

  const validated = await requestNodeEnrollment({
    controllerIpAddress: '127.0.0.1',
    controllerPort: enrollmentServer.port,
    enrollmentRequest: conflicting,
  });
  assert.equal(validated.status, 'conflict');
  assert.equal(Object.hasOwn(validated, 'sharedAuthenticationKey'), false);
});

test('explicit overwrite replaces node facts and clears its prior thread policy', async (t) => {
  const { configPath, enrollmentServer } = await startEnrollmentFixture(t, [
    controllerNode(),
  ]);
  const response = await requestNodeEnrollment({
    controllerIpAddress: '127.0.0.1',
    controllerPort: enrollmentServer.port,
    enrollmentRequest: enrollmentRequest({
      overwrite: true,
      computerName: 'Replacement Node',
      ipAddress: '127.0.0.41',
      cpuName: 'Intel Core i7',
      availableThreads: 12,
    }),
  });

  assert.equal(response.status, 'accepted');
  assert.equal(response.disposition, 'overwritten');
  assert.deepEqual(readControllerConfigFile(configPath).nodes, [
    controllerNode({
      computerName: 'Replacement Node',
      ipAddress: '127.0.0.41',
      cpuName: 'Intel Core i7',
      availableThreads: 12,
      threads: null,
      minimumThreadCount: null,
    }),
  ]);
});

test('controller refuses malformed, oversized, and incorrectly typed bodies', async (t) => {
  const { enrollmentServer } = await startEnrollmentFixture(t);
  const malformed = await rawHttpRequest({
    port: enrollmentServer.port,
    body: '{',
  });
  assert.equal(malformed.statusCode, 400);

  const extraField = await rawHttpRequest({
    port: enrollmentServer.port,
    body: JSON.stringify({ ...enrollmentRequest(), unexpected: true }),
  });
  assert.equal(extraField.statusCode, 400);

  const oversized = await rawHttpRequest({
    port: enrollmentServer.port,
    body: Buffer.alloc(DEFAULT_NODE_ENROLLMENT_BODY_BYTES + 1, 0x61),
  });
  assert.equal(oversized.statusCode, 413);

  const wrongType = await rawHttpRequest({
    port: enrollmentServer.port,
    body: JSON.stringify(enrollmentRequest()),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(wrongType.statusCode, 415);
});

test('controller rejects duplicate decoded request keys', async (t) => {
  const { configPath, enrollmentServer } = await startEnrollmentFixture(t);
  const duplicateKey = JSON.stringify(enrollmentRequest()).replace(
    '"nodeNumber":"01"',
    '"nodeNumber":"01","\\u006eodeNumber":"02"'
  );
  const response = await rawHttpRequest({
    port: enrollmentServer.port,
    body: duplicateKey,
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(readControllerConfigFile(configPath).nodes, []);
});

test('controller refuses wrong methods and routes', async (t) => {
  const { enrollmentServer } = await startEnrollmentFixture(t);
  const wrongMethod = await rawHttpRequest({
    port: enrollmentServer.port,
    method: 'GET',
  });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, 'POST');

  const wrongRoute = await rawHttpRequest({
    port: enrollmentServer.port,
    path: '/engine/v1/nodes/not-enrollment',
    body: JSON.stringify(enrollmentRequest()),
  });
  assert.equal(wrongRoute.statusCode, 404);
});

test('client enforces response status, content type, body limit, and status model', async (t) => {
  await t.test('status', async (t) => {
    const port = await withResponseServer(t, (request, response) => {
      request.resume();
      response.writeHead(500, {
        connection: 'close',
        'content-type': 'application/json',
      });
      response.end('{}');
    });
    await assert.rejects(
      requestNodeEnrollment({
        controllerIpAddress: '127.0.0.1',
        controllerPort: port,
        enrollmentRequest: enrollmentRequest(),
      }),
      { code: 'ERR_NODE_ENROLLMENT_HTTP' }
    );
  });

  await t.test('content type', async (t) => {
    const port = await withResponseServer(t, (request, response) => {
      request.resume();
      response.writeHead(200, {
        connection: 'close',
        'content-type': 'text/plain',
      });
      response.end('{}');
    });
    await assert.rejects(
      requestNodeEnrollment({
        controllerIpAddress: '127.0.0.1',
        controllerPort: port,
        enrollmentRequest: enrollmentRequest(),
      }),
      { code: 'ERR_NODE_ENROLLMENT_CONTENT_TYPE' }
    );
  });

  await t.test('body limit', async (t) => {
    const port = await withResponseServer(t, (request, response) => {
      request.resume();
      response.writeHead(200, {
        connection: 'close',
        'content-length': '129',
        'content-type': 'application/json',
      });
      response.end(Buffer.alloc(129, 0x61));
    });
    await assert.rejects(
      requestNodeEnrollment({
        controllerIpAddress: '127.0.0.1',
        controllerPort: port,
        enrollmentRequest: enrollmentRequest(),
        responseBodyLimitBytes: 128,
      }),
      { code: 'ERR_NODE_ENROLLMENT_SIZE' }
    );
  });

  await t.test('HTTP and response model agreement', async (t) => {
    const accepted = JSON.stringify({
      status: 'accepted',
      disposition: 'created',
      nodeNumber: '01',
      sharedAuthenticationKey,
    });
    const port = await withResponseServer(t, (request, response) => {
      request.resume();
      response.writeHead(409, {
        connection: 'close',
        'content-type': 'application/json',
      });
      response.end(accepted);
    });
    await assert.rejects(
      requestNodeEnrollment({
        controllerIpAddress: '127.0.0.1',
        controllerPort: port,
        enrollmentRequest: enrollmentRequest(),
      }),
      { code: 'ERR_NODE_ENROLLMENT_HTTP' }
    );
  });
});

test('client rejects duplicate decoded keys nested in a response', async (t) => {
  const conflict = JSON.stringify({
    status: 'conflict',
    reason: 'node-number-occupied',
    nodeNumber: '01',
    existingNode: {
      nodeNumber: '01',
      computerName: 'Test Node 01',
      ipAddress: '127.0.0.31',
      port: 7443,
      cpuName: 'AMD Ryzen Embedded V3C14',
      availableThreads: 8,
    },
  }).replace(
    '"computerName":"Test Node 01"',
    '"computerName":"Test Node 01","\\u0063omputerName":"Duplicate"'
  );
  const port = await withResponseServer(t, (request, response) => {
    request.resume();
    response.writeHead(409, {
      connection: 'close',
      'content-type': 'application/json',
    });
    response.end(conflict);
  });

  await assert.rejects(
    requestNodeEnrollment({
      controllerIpAddress: '127.0.0.1',
      controllerPort: port,
      enrollmentRequest: enrollmentRequest(),
    }),
    { code: 'ERR_NODE_ENROLLMENT_JSON' }
  );
});

test('client stops on timeout and caller abort', async (t) => {
  await t.test('timeout', async (t) => {
    const port = await withResponseServer(t, (request) => request.resume());
    await assert.rejects(
      requestNodeEnrollment({
        controllerIpAddress: '127.0.0.1',
        controllerPort: port,
        enrollmentRequest: enrollmentRequest(),
        timeoutMs: 30,
      }),
      { code: 'ERR_NODE_ENROLLMENT_TIMEOUT' }
    );
  });

  await t.test('abort', async (t) => {
    const port = await withResponseServer(t, (request) => request.resume());
    const controller = new AbortController();
    const pending = requestNodeEnrollment({
      controllerIpAddress: '127.0.0.1',
      controllerPort: port,
      enrollmentRequest: enrollmentRequest(),
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, { code: 'ERR_NODE_ENROLLMENT_ABORTED' });
  });
});
