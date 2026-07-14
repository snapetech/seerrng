import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

type Listener = (event: Record<string, unknown>) => void;

class MemoryCache {
  private entries = new Map<string, Response>();

  async delete(request: Request | string) {
    return this.entries.delete(this.key(request));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async match(request: Request | string) {
    return this.entries.get(this.key(request))?.clone();
  }

  async put(request: Request | string, response: Response) {
    this.entries.set(this.key(request), response.clone());
  }

  private key(request: Request | string) {
    return typeof request === 'string' ? request : request.url;
  }
}

const createHarness = () => {
  const listeners = new Map<string, Listener>();
  const cacheStores = new Map<string, MemoryCache>();
  const networkResponses: (Response | Error)[] = [];

  const caches = {
    delete: async (name: string) => cacheStores.delete(name),
    keys: async () => [...cacheStores.keys()],
    open: async (name: string) => {
      const cache = cacheStores.get(name) ?? new MemoryCache();
      cacheStores.set(name, cache);
      return cache;
    },
  };

  const self = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    location: { origin: 'https://seerr.test' },
    registration: { navigationPreload: { enable: async () => undefined } },
    skipWaiting: () => undefined,
  };

  runInNewContext(
    readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf8'),
    {
      caches,
      clients: { claim: () => undefined, openWindow: () => undefined },
      console,
      encodeURIComponent,
      fetch: async () => {
        const nextResponse = networkResponses.shift();
        if (nextResponse instanceof Error) {
          throw nextResponse;
        }
        return nextResponse ?? new Response(null, { status: 503 });
      },
      Headers,
      Map,
      navigator: {},
      Number,
      Promise,
      Request,
      Response,
      self,
      URL,
    }
  );

  const setUser = async (userId: number | null) => {
    const lifetimes: Promise<unknown>[] = [];
    listeners.get('message')?.({
      data: { type: 'SET_CACHE_USER', userId },
      source: { id: 'client-1' },
      waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
    });
    await Promise.all(lifetimes);
  };

  const activate = async () => {
    const lifetimes: Promise<unknown>[] = [];
    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
    });
    await Promise.all(lifetimes);
  };

  const fetchRequest = async (request: Request) => {
    let responsePromise: Promise<Response> | undefined;
    const lifetimes: Promise<unknown>[] = [];
    listeners.get('fetch')?.({
      clientId: 'client-1',
      preloadResponse: Promise.resolve(undefined),
      request,
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
      waitUntil: (promise: Promise<unknown>) => lifetimes.push(promise),
    });

    const response = responsePromise ? await responsePromise : undefined;
    await Promise.all(lifetimes);
    return response;
  };

  return {
    activate,
    cacheNames: () => [...cacheStores.keys()],
    fetchRequest,
    networkResponses,
    seedCache: (name: string) => caches.open(name),
    setUser,
  };
};

describe('service worker runtime cache', () => {
  it('preserves compatible and unrelated caches during activation', async () => {
    const harness = createHarness();
    await Promise.all([
      harness.seedCache('seerrng-data-v1'),
      harness.seedCache('runtime-v3'),
      harness.seedCache('third-party-cache'),
    ]);

    await harness.activate();

    assert.equal(harness.cacheNames().includes('seerrng-data-v1'), true);
    assert.equal(harness.cacheNames().includes('runtime-v3'), false);
    assert.equal(harness.cacheNames().includes('third-party-cache'), true);
  });

  it('never intercepts mutations', async () => {
    const harness = createHarness();
    const response = await harness.fetchRequest(
      new Request('https://seerr.test/api/v1/request', { method: 'POST' })
    );

    assert.equal(response, undefined);
  });

  it('does not cache public settings with a no-store contract', async () => {
    const harness = createHarness();
    const response = await harness.fetchRequest(
      new Request('https://seerr.test/api/v1/settings/public')
    );

    assert.equal(response, undefined);
  });

  it('honors Discover freshness headers before using cached data', async () => {
    const harness = createHarness();
    const request = new Request(
      'https://seerr.test/api/v1/discover/home/manifest'
    );

    await harness.setUser(1);
    harness.networkResponses.push(
      new Response('first', { headers: { 'X-Discover-Freshness': '0' } })
    );
    assert.equal(await (await harness.fetchRequest(request))?.text(), 'first');

    harness.networkResponses.push(new Response('second'));
    assert.equal(await (await harness.fetchRequest(request))?.text(), 'second');
  });

  it('isolates personalized data and retains stale data on network failure', async () => {
    const harness = createHarness();
    const request = new Request(
      'https://seerr.test/api/v1/media?filter=allavailable'
    );

    await harness.setUser(1);
    harness.networkResponses.push(new Response('user-one'));
    assert.equal(
      await (await harness.fetchRequest(request))?.text(),
      'user-one'
    );

    await harness.setUser(2);
    harness.networkResponses.push(new Response('user-two'));
    assert.equal(
      await (await harness.fetchRequest(request))?.text(),
      'user-two'
    );

    await harness.setUser(1);
    harness.networkResponses.push(new Error('offline'));
    assert.equal(
      await (await harness.fetchRequest(request))?.text(),
      'user-one'
    );
  });
});
