// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Standalone Node tests cannot resolve application aliases.
import { probeNativeBrowserReadiness } from '../tools/validation-engine/runtime/native-stage-context.mjs';

test('browser readiness requires database 204 and the login frontend 200 without redirects', async () => {
  const requests = [];
  const passed = await probeNativeBrowserReadiness('http://127.0.0.1:5056', {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { status: requests.length === 1 ? 204 : 200 };
    },
  });
  assert.equal(passed, true);
  assert.deepEqual(
    requests.map(({ url }) => url),
    ['http://127.0.0.1:5056/api/v1/status/ready', 'http://127.0.0.1:5056/login']
  );
  for (const { options } of requests) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.equal(options.signal.aborted, false);
    assert.equal(options.headers, undefined);
  }
});

for (const status of [200, 307, 503]) {
  test(`browser readiness rejects database status ${status} before probing frontend`, async () => {
    let calls = 0;
    assert.equal(
      await probeNativeBrowserReadiness('http://127.0.0.1:5056', {
        fetchImpl: async () => {
          calls += 1;
          return { status };
        },
      }),
      false
    );
    assert.equal(calls, 1);
  });
}

for (const status of [204, 307, 500]) {
  test(`browser readiness rejects frontend status ${status} after healthy database`, async () => {
    let calls = 0;
    assert.equal(
      await probeNativeBrowserReadiness('http://127.0.0.1:5056', {
        fetchImpl: async () => ({ status: ++calls === 1 ? 204 : status }),
      }),
      false
    );
    assert.equal(calls, 2);
  });
}

test('browser readiness rejects failed requests', async () => {
  assert.equal(
    await probeNativeBrowserReadiness('http://127.0.0.1:5056', {
      fetchImpl: async () => {
        throw new Error('Not listening yet');
      },
    }),
    false
  );
});

test('native HTTP readiness accepts the initialized logged-out application contract', async (t) => {
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/') {
      response.writeHead(307, { location: '/login' });
    } else if (request.url === '/api/v1/status/ready') {
      response.writeHead(204);
    } else if (request.url === '/login') {
      response.writeHead(200);
    } else response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(fetch(baseUrl, { redirect: 'error' }));
  assert.equal(await probeNativeBrowserReadiness(baseUrl), true);
  assert.deepEqual(paths, ['/', '/api/v1/status/ready', '/login']);
});
