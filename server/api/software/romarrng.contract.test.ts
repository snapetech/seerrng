import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { it } from 'node:test';
import ROMarrNGAPI from './romarrng';

it('uses the versioned SeerrNG catalog contract and preserves IGDB identity', async () => {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-api-key'], 'romarr-contract-test');
    const url = new URL(request.url ?? '/', 'http://localhost');
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        ...(body ? { body: JSON.parse(body) as unknown } : {}),
      });
      const payload = url.pathname.endsWith('/ping')
        ? {
            service: 'ROMarrNG',
            version: '1.0.0',
            apiVersion: 1,
            requestContractVersion: 1,
            capabilities: {
              catalog: true,
              pcAcquisition: false,
              emulationAcquisition: true,
              requestActions: { retry: true, cancel: true },
              assetStreaming: true,
            },
          }
        : url.pathname.endsWith('/search-page')
          ? { results: [], nextCursor: 'cursor-2' }
          : url.pathname.endsWith('/popular-page')
            ? { results: [], nextOffset: 40 }
            : url.pathname.endsWith('/platforms')
              ? []
              : url.pathname.endsWith('/games/42')
                ? {
                    id: 'igdb-42',
                    igdbId: 42,
                    ...(url.searchParams.has('platformId')
                      ? { platformReleaseDate: '2026-10-12' }
                      : {}),
                  }
                : url.pathname.endsWith('/requests')
                  ? { externalRequestId: 'request-42', status: 'accepted' }
                  : { error: 'Unknown test endpoint' };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new ROMarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '/romarr',
      useSsl: false,
      apiKey: 'romarr-contract-test',
    });
    const handshake = await api.getHandshake();
    const search = await api.searchCatalogPage(
      'Example game',
      10,
      'cursor+/=',
      [130],
      'Adventure',
      2024
    );
    const popular = await api.getPopularCatalogPage(
      10,
      30,
      [130],
      'Adventure',
      2024
    );
    const platforms = await api.getCatalogPlatforms();
    const game = await api.getCatalogGame(42);
    const platformGame = await api.getCatalogGame(42, 130);
    await api.createRequest('request-42', 'Example game', 'nes', 42, 130);

    assert.equal(handshake.requestContractVersion, 1);
    assert.equal(search.nextCursor, 'cursor-2');
    assert.equal(popular.nextOffset, 40);
    assert.deepEqual(platforms, []);
    assert.equal(game.igdbId, 42);
    assert.equal(platformGame.igdbId, 42);
    assert.equal(platformGame.platformReleaseDate, '2026-10-12');
    assert.deepEqual(
      requests.map(({ method, path }) => `${method} ${path.split('?')[0]}`),
      [
        'GET /romarr/api/integration/seerrng/v1/ping',
        'GET /romarr/api/integration/seerrng/v1/catalog/search-page',
        'GET /romarr/api/integration/seerrng/v1/catalog/popular-page',
        'GET /romarr/api/integration/seerrng/v1/catalog/platforms',
        'GET /romarr/api/integration/seerrng/v1/catalog/games/42',
        'GET /romarr/api/integration/seerrng/v1/catalog/games/42',
        'POST /romarr/api/integration/seerrng/v1/requests',
      ]
    );
    assert.deepEqual(requests[1].path.includes('cursor=cursor%2B%2F%3D'), true);
    assert.equal(
      new URL(requests[5].path, 'http://localhost').searchParams.get(
        'platformId'
      ),
      '130'
    );
    assert.deepEqual(requests[6].body, {
      externalRequestId: 'request-42',
      game: 'Example game',
      platform: 'nes',
      identity: {
        catalogProvider: 'igdb',
        catalogId: 42,
        platformId: 130,
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('keeps ROM acquisition working through the legacy integration prefix', async () => {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? 'GET',
        path: url.pathname,
        ...(body ? { body: JSON.parse(body) as unknown } : {}),
      });
      if (url.pathname === '/romarr/api/integration/seerrng/v1/ping') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Unknown integration route' }));
        return;
      }
      const payload =
        url.pathname === '/romarr/api/v1/integration/ping'
          ? { service: 'ROMarrNG', apiVersion: 1 }
          : url.pathname.endsWith('/search-page')
            ? { results: [], nextCursor: null }
            : { externalRequestId: 'request-legacy', status: 'accepted' };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new ROMarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '/romarr',
      useSsl: false,
      apiKey: 'romarr-legacy-test',
    });
    const handshake = await api.getHandshake();
    const catalog = await api.searchCatalogPage('Legacy catalog');
    const request = await api.createRequest(
      'request-legacy',
      'Example game',
      'nes',
      42,
      130
    );

    assert.equal(handshake.service, 'ROMarrNG');
    assert.equal(handshake.requestContractVersion, undefined);
    assert.deepEqual(catalog.results, []);
    assert.equal(request.externalRequestId, 'request-legacy');
    assert.deepEqual(
      requests.map(({ method, path }) => `${method} ${path}`),
      [
        'GET /romarr/api/integration/seerrng/v1/ping',
        'GET /romarr/api/v1/integration/ping',
        'GET /romarr/api/v1/integration/catalog/search-page',
        'POST /romarr/api/v1/integration/requests',
      ]
    );
    assert.deepEqual(requests[3].body, {
      externalRequestId: 'request-legacy',
      game: 'Example game',
      platform: 'nes',
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('uses the stable SeerrNG integration prefix for request contract v2', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    requests.push(`${request.method ?? 'GET'} ${path}`);
    const payload = path.endsWith('/ping')
      ? {
          service: 'ROMarrNG',
          apiVersion: 1,
          requestContractVersion: 2,
          capabilities: {
            catalog: true,
            pcAcquisition: false,
            emulationAcquisition: true,
            requestActions: { retry: true, cancel: true },
            assetStreaming: true,
            datCatalog: true,
          },
        }
      : { ready: true, partial: false, matches: [] };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new ROMarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'romarr-contract-v2-test',
    });
    const lookup = await api.lookupLibrary([
      { title: 'Example game', platform: 'nes' },
    ]);

    assert.deepEqual(lookup, { ready: true, partial: false, matches: [] });
    assert.deepEqual(requests, [
      'GET /api/integration/seerrng/v1/ping',
      'POST /api/integration/seerrng/v1/library/lookup',
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects a request contract version it does not understand', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        service: 'ROMarrNG',
        apiVersion: 1,
        requestContractVersion: 3,
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const api = new ROMarrNGAPI({
      hostname: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      baseUrl: '',
      useSsl: false,
      apiKey: 'romarr-contract-test',
    });
    await assert.rejects(
      api.lookupLibrary([{ title: 'Example', platform: 'nes' }]),
      /request contract v3 is not supported/
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
