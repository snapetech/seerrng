import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';
import QuestarrNGAPI from './questarrng';
import type { PcGameVariant } from './types';

it('sends IGDB and Steam identities together for separate library checks', async () => {
  let requestPath = '';
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-api-key'], 'questarr-contract-test');
    requestPath = request.url ?? '';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        games: [{ igdbId: 42, status: 'owned', deliverable: false }],
        steamGames: [{ steamAppId: 570, owned: true }],
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new QuestarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'questarr-contract-test',
    });
    const result = await api.lookupLibrary([42], [570]);
    const url = new URL(requestPath, 'http://localhost');

    assert.equal(url.pathname, '/api/integration/seerrng/v1/library/lookup');
    assert.equal(url.searchParams.get('igdbIds'), '42');
    assert.equal(url.searchParams.get('steamAppIds'), '570');
    assert.deepEqual(result.steamGames, [{ steamAppId: 570, owned: true }]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('requests exact platform release dates from the SeerrNG catalog contract', async () => {
  let requestPath = '';
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-api-key'], 'questarr-contract-test');
    const url = new URL(request.url ?? '/', 'http://localhost');
    requestPath = `${url.pathname}${url.search}`;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'igdb-42',
        igdbId: 42,
        platformReleaseDate: '2026-10-12',
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new QuestarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'questarr-contract-test',
    });
    const game = await api.getCatalogGame(42, 6);

    assert.equal(game.igdbId, 42);
    assert.equal(game.platformReleaseDate, '2026-10-12');
    const url = new URL(requestPath, 'http://localhost');
    assert.equal(url.pathname, '/api/integration/seerrng/v1/catalog/games/42');
    assert.equal(url.searchParams.get('platformId'), '6');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('sends the selected IGDB identity when creating a durable Questarr request', async () => {
  let requestPath = '';
  let requestBody = '';
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-api-key'], 'questarr-contract-test');
    requestPath = request.url ?? '';
    request.on('data', (chunk: Buffer) => {
      requestBody += chunk.toString('utf8');
    });
    request.on('end', () => {
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          externalRequestId: 'seerrng:request:17',
          status: 'searching',
          deliverable: false,
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new QuestarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'questarr-contract-test',
    });
    const variant: PcGameVariant = {
      operatingSystem: 'linux',
      architecture: 'x64',
    };
    const result = await api.createRequest(
      'seerrng:request:17',
      'Example Game',
      variant,
      42
    );

    assert.equal(requestPath, '/api/integration/seerrng/v1/requests');
    assert.deepEqual(JSON.parse(requestBody), {
      externalRequestId: 'seerrng:request:17',
      title: 'Example Game',
      variant,
      igdbId: 42,
    });
    assert.equal(result.externalRequestId, 'seerrng:request:17');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('streams the request-scoped multi-file bundle through the provider client', async () => {
  let requestPath = '';
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-api-key'], 'questarr-contract-test');
    assert.equal(request.headers.range, undefined);
    requestPath = request.url ?? '';
    response.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': '4',
      'Accept-Ranges': 'bytes',
      'Content-Disposition':
        "attachment; filename*=UTF-8''Example%20Game.tar.gz",
    });
    response.end(Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new QuestarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'questarr-contract-test',
    });
    const bundle = await api.streamBundle('seerrng:request:17');
    const chunks: Buffer[] = [];
    for await (const chunk of bundle.stream) chunks.push(Buffer.from(chunk));

    assert.equal(
      requestPath,
      '/api/integration/seerrng/v1/requests/seerrng%3Arequest%3A17/assets/bundle'
    );
    assert.equal(bundle.filename, 'Example Game.tar.gz');
    assert.equal(bundle.contentType, 'application/gzip');
    assert.equal(bundle.contentLength, 4);
    assert.equal(bundle.rangeSupported, false);
    assert.equal(bundle.statusCode, 200);
    assert.equal(bundle.contentRange, undefined);
    assert.deepEqual(
      Buffer.concat(chunks),
      Buffer.from([0x1f, 0x8b, 0x08, 0x00])
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects a partial response when streaming a Questarr bundle', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(206, {
      'Content-Type': 'application/gzip',
      'Content-Length': '0',
      'Content-Range': 'bytes 0-0/1',
    });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new QuestarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'questarr-contract-test',
    });
    await assert.rejects(api.streamBundle('seerrng:request:17'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
