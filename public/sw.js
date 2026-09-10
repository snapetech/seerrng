/* eslint-disable no-undef */
// Cache names change only when their stored data becomes incompatible. Normal
// application builds keep compatible runtime data available for offline use.
const OFFLINE_CACHE_NAME = 'seerrng-offline-v1';
const DATA_CACHE_SCHEMA = 2;
const DATA_CACHE_NAME = `seerrng-data-v${DATA_CACHE_SCHEMA}`;
const STATIC_CACHE_SCHEMA = 1;
const STATIC_CACHE_NAME = `seerrng-static-v${STATIC_CACHE_SCHEMA}`;
const CLIENT_CACHE_SCHEMA = 2;
const CLIENT_CACHE_NAME = `seerrng-client-v${CLIENT_CACHE_SCHEMA}`;
const MANAGED_CACHE_PREFIXES = [
  'seerrng-offline-',
  'seerrng-data-',
  'seerrng-static-',
  'seerrng-client-',
  // Cache names used before schema-based cache lifecycle management.
  'runtime-',
  'offline-',
];
const LEGACY_CACHE_NAMES = ['offline'];
const DATA_CACHE_MAX_ENTRIES = 300;
const STATIC_CACHE_MAX_ENTRIES = 200;
const DATA_CACHE_FRESH_MS = 5 * 60 * 1000;
const DATA_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STATIC_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
const STATIC_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_TIMESTAMP_HEADER = 'x-seerrng-cache-time';
const USER_CACHE_KEY_PARAM = '__seerrng_cache_user';
const CLIENT_PARTITION_RETENTION_MS = DATA_CACHE_RETENTION_MS;
const EXPIRATION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
// Customize this with a different URL if needed.
const OFFLINE_URL = '/offline.html';

// A service worker serves every signed-in user of a browser profile. Cache API
// matching does not partition entries by cookies, so clients explicitly tell
// the worker which user owns each authenticated response.
const clientUserPartitions = new Map();
const lastExpirationCleanup = new Map();

const CACHEABLE_API_PATHS = [
  /^\/api\/v1\/settings\/discover$/,
  /^\/api\/v1\/discover(?:\/|$)/,
  /^\/api\/v1\/search(?:\/|$)/,
  /^\/api\/v1\/movie\/\d+/,
  /^\/api\/v1\/tv\/\d+/,
  /^\/api\/v1\/collection\/\d+/,
  /^\/api\/v1\/person\/\d+/,
  /^\/api\/v1\/music\/[^/]+/,
  /^\/api\/v1\/book\/[^/]+/,
  /^\/api\/v1\/author\/[^/]+/,
  /^\/api\/v1\/artist\/[^/]+/,
];

const CACHEABLE_STATIC_PATHS = [
  /^\/imageproxy\//,
  /^\/avatarproxy\//,
  /^\/offline\.html$/,
  /^\/site\.webmanifest$/,
  /^\/robots\.txt$/,
  /^\/favicon\.ico$/,
  /\.(aac|avif|css|flac|gif|ico|jpg|jpeg|js|m4a|map|mjs|mp3|mp4|oga|ogg|ogv|opus|otf|png|svg|ttf|wasm|wav|webm|webp|woff|woff2|json|txt|vtt|xml)$/i,
];

const getRuntimeCacheType = (request) => {
  if (request.method !== 'GET') {
    return undefined;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return undefined;
  }

  if (url.pathname.startsWith('/_next/')) {
    return undefined;
  }

  if (CACHEABLE_API_PATHS.some((pattern) => pattern.test(url.pathname))) {
    return 'user-data';
  }

  // Never let a file-like API path fall through into the shared static cache.
  // Authenticated API routes must be explicitly allowlisted above and scoped
  // to the active user partition.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return undefined;
  }

  if (CACHEABLE_STATIC_PATHS.some((pattern) => pattern.test(url.pathname))) {
    return 'static';
  }

  return undefined;
};

const getCacheControlDirectives = (response) =>
  new Set(
    (response?.headers.get('cache-control') ?? '')
      .split(',')
      .map((directive) =>
        directive.trim().toLowerCase().split('=', 1)[0].trim()
      )
      .filter(Boolean)
  );

const isRuntimeCacheableResponse = (response) =>
  response &&
  response.ok &&
  response.status === 200 &&
  (response.type === 'basic' || response.type === 'default') &&
  !getCacheControlDirectives(response).has('no-store') &&
  response.headers.get('vary')?.trim() !== '*';

const getCachedAt = (response) => {
  const cachedAt = Number(response?.headers.get(CACHE_TIMESTAMP_HEADER));
  return Number.isFinite(cachedAt) ? cachedAt : 0;
};

const isFresh = (response, maxAgeMs) => {
  if (getCacheControlDirectives(response).has('no-cache')) {
    return false;
  }

  const discoverFreshnessHeader = response?.headers.get('x-discover-freshness');
  const discoverFreshnessSeconds =
    discoverFreshnessHeader === null ||
    discoverFreshnessHeader === undefined ||
    discoverFreshnessHeader.trim() === ''
      ? Number.NaN
      : Number(discoverFreshnessHeader);
  const effectiveMaxAge =
    Number.isFinite(discoverFreshnessSeconds) && discoverFreshnessSeconds >= 0
      ? discoverFreshnessSeconds * 1000
      : maxAgeMs;

  return Date.now() - getCachedAt(response) < effectiveMaxAge;
};

const isPublicArtworkResponse = (request, response, cacheType) => {
  const directives = getCacheControlDirectives(response);

  return (
    cacheType === 'static' &&
    new URL(request.url).pathname.startsWith('/imageproxy/') &&
    isRuntimeCacheableResponse(response) &&
    /^image\//i.test(response.headers.get('content-type') ?? '') &&
    directives.has('public') &&
    !directives.has('private') &&
    !directives.has('no-cache')
  );
};

const isFreshArtwork = (response) => {
  const now = Date.now();
  const cachedAt = getCachedAt(response);
  if (cachedAt <= 0 || cachedAt > now) {
    return false;
  }

  let maxAgeMs = STATIC_CACHE_FRESH_MS;
  const maxAgeDirectives = (response.headers.get('cache-control') ?? '')
    .split(',')
    .filter((directive) => /^\s*max-age\s*(?:=|$)/i.test(directive));

  if (maxAgeDirectives.length > 0) {
    // Malformed or conflicting freshness metadata cannot authorize a cache hit.
    const match = maxAgeDirectives[0].match(
      /^\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*$/i
    );
    if (maxAgeDirectives.length !== 1 || !match) {
      return false;
    }
    maxAgeMs = Math.min(maxAgeMs, Number(match[1] ?? match[2]) * 1000);
  }

  const ageHeader = response.headers.get('age');
  if (ageHeader !== null && !/^\d+$/.test(ageHeader.trim())) {
    return false;
  }
  const ageMs = Number(ageHeader ?? 0) * 1000;
  const dateHeader = response.headers.get('date');
  const responseDate = dateHeader === null ? cachedAt : Date.parse(dateHeader);
  if (!Number.isFinite(ageMs) || !Number.isFinite(responseDate)) {
    return false;
  }

  // A response may already be old when fetched from the browser/CDN cache.
  // The worker's insertion timestamp must not reset that existing age.
  const initialAgeMs = Math.max(0, cachedAt - responseDate, ageMs);
  return initialAgeMs + (now - cachedAt) < maxAgeMs;
};

const addCacheTimestamp = (response) => {
  const headers = new Headers(response.headers);
  headers.set(CACHE_TIMESTAMP_HEADER, String(Date.now()));

  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const trimRuntimeCache = async (
  cache,
  maxEntries,
  retentionMs,
  cacheName,
  forceExpiration = false
) => {
  const keys = await cache.keys();
  const shouldCleanExpiration =
    forceExpiration ||
    Date.now() - (lastExpirationCleanup.get(cacheName) ?? 0) >=
      EXPIRATION_CLEANUP_INTERVAL_MS;
  let expiredKeys = [];

  if (shouldCleanExpiration) {
    // Set this before awaiting cache reads so parallel homepage requests do not
    // all launch the same full expiration scan.
    lastExpirationCleanup.set(cacheName, Date.now());
    const responses = await Promise.all(
      keys.map((request) => cache.match(request))
    );
    expiredKeys = keys.filter((request, index) => {
      const cachedAt = getCachedAt(responses[index]);
      return cachedAt > 0 && Date.now() - cachedAt > retentionMs;
    });
  }

  await Promise.all(expiredKeys.map((request) => cache.delete(request)));

  const remainingKeys = keys.filter(
    (request) => !expiredKeys.includes(request)
  );

  if (remainingKeys.length <= maxEntries) {
    return;
  }

  await Promise.all(
    remainingKeys
      .slice(0, remainingKeys.length - maxEntries)
      .map((request) => cache.delete(request))
  );
};

const getClientPartitionRequest = (clientId) =>
  new Request(
    new URL(
      `/__seerrng_service_worker/client/${encodeURIComponent(clientId)}`,
      self.location.origin
    )
  );

const setClientUserPartition = async (clientId, partition) => {
  const cache = await caches.open(CLIENT_CACHE_NAME);
  const partitionRequest = getClientPartitionRequest(clientId);

  if (!partition) {
    clientUserPartitions.delete(clientId);
    await cache.delete(partitionRequest);
    return;
  }

  clientUserPartitions.set(clientId, partition);
  await cache.put(
    partitionRequest,
    new Response(JSON.stringify({ ...partition, cachedAt: Date.now() }), {
      headers: { 'content-type': 'application/json' },
    })
  );
};

const trimClientPartitions = async (cache) => {
  const keys = await cache.keys();
  const partitions = await Promise.all(
    keys.map(async (request) => {
      try {
        const response = await cache.match(request);
        return response ? await response.json() : undefined;
      } catch {
        return undefined;
      }
    })
  );

  await Promise.all(
    keys
      .filter((request, index) => {
        const cachedAt = Number(partitions[index]?.cachedAt);
        return (
          !Number.isFinite(cachedAt) ||
          Date.now() - cachedAt > CLIENT_PARTITION_RETENTION_MS
        );
      })
      .map((request) => cache.delete(request))
  );
};

const isValidClientPartition = (partition) =>
  Number.isSafeInteger(partition?.userId) &&
  partition.userId > 0 &&
  Number.isSafeInteger(partition?.permissions) &&
  partition.permissions >= 0 &&
  Number.isSafeInteger(partition?.userType) &&
  partition.userType > 0;

const getClientUserPartition = async (clientId) => {
  const inMemoryPartition = clientUserPartitions.get(clientId);
  if (inMemoryPartition) {
    return inMemoryPartition;
  }

  if (!clientId) {
    return undefined;
  }

  try {
    const cache = await caches.open(CLIENT_CACHE_NAME);
    const partitionRequest = getClientPartitionRequest(clientId);
    const response = await cache.match(partitionRequest);
    const partition = response ? await response.json() : undefined;

    if (
      isValidClientPartition(partition) &&
      Number.isFinite(partition.cachedAt) &&
      Date.now() - partition.cachedAt <= CLIENT_PARTITION_RETENTION_MS
    ) {
      const clientPartition = {
        userId: partition.userId,
        permissions: partition.permissions,
        userType: partition.userType,
      };
      clientUserPartitions.set(clientId, clientPartition);
      return clientPartition;
    }

    await cache.delete(partitionRequest);
  } catch {
    // Missing client metadata means personalized requests use the network only.
  }

  return undefined;
};

const getUserCacheRequest = async (request, clientId) => {
  const partition = await getClientUserPartition(clientId);

  if (!partition) {
    return undefined;
  }

  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set(
    USER_CACHE_KEY_PARAM,
    `${partition.userId}:${partition.permissions}:${partition.userType}`
  );
  return new Request(cacheUrl, { method: 'GET' });
};

const getCacheConfig = (cacheType) =>
  cacheType === 'static'
    ? {
        cacheName: STATIC_CACHE_NAME,
        freshMs: STATIC_CACHE_FRESH_MS,
        retentionMs: STATIC_CACHE_RETENTION_MS,
        maxEntries: STATIC_CACHE_MAX_ENTRIES,
      }
    : {
        cacheName: DATA_CACHE_NAME,
        freshMs: DATA_CACHE_FRESH_MS,
        retentionMs: DATA_CACHE_RETENTION_MS,
        maxEntries: DATA_CACHE_MAX_ENTRIES,
      };

const cacheRuntimeResponse = async (cache, cacheRequest, response, config) => {
  if (!isRuntimeCacheableResponse(response)) {
    return;
  }

  try {
    await cache.put(cacheRequest, addCacheTimestamp(response));
    await trimRuntimeCache(
      cache,
      config.maxEntries,
      config.retentionMs,
      config.cacheName
    );
  } catch {
    // Runtime caching is opportunistic and should never break the request.
  }
};

const staleWhileRevalidate = async (request, cacheRequest, cacheType) => {
  const config = getCacheConfig(cacheType);
  const cache = await caches.open(config.cacheName);
  const cachedResponse = await cache.match(cacheRequest);
  const publicArtwork = isPublicArtworkResponse(
    request,
    cachedResponse,
    cacheType
  );
  const freshCachedResponse = publicArtwork
    ? !['reload', 'no-cache', 'no-store'].includes(request.cache) &&
      isFreshArtwork(cachedResponse)
    : isFresh(cachedResponse, config.freshMs);

  if (publicArtwork && freshCachedResponse) {
    return {
      responsePromise: Promise.resolve(cachedResponse),
      networkResponsePromise: Promise.resolve(undefined),
    };
  }

  const networkResponsePromise = fetch(request)
    .then(async (networkResponse) => {
      if ([401, 403, 404, 410].includes(networkResponse.status)) {
        await cache.delete(cacheRequest);
      }
      await cacheRuntimeResponse(cache, cacheRequest, networkResponse, config);
      return networkResponse;
    })
    .catch(() => undefined);

  const responsePromise =
    cachedResponse && freshCachedResponse
      ? Promise.resolve(cachedResponse)
      : networkResponsePromise.then((networkResponse) => {
          if (networkResponse && networkResponse.status < 500) {
            return networkResponse;
          }

          // An expired entry remains useful when the server is unreachable.
          // Retention cleanup eventually removes randomized query URLs.
          return cachedResponse ?? networkResponse ?? Response.error();
        });

  return { responsePromise, networkResponsePromise };
};

self.addEventListener('message', (event) => {
  if (
    event.origin !== self.location.origin ||
    event.data?.type !== 'SET_CACHE_USER' ||
    !event.source?.id
  ) {
    return;
  }

  const partition = {
    userId: Number(event.data.userId),
    permissions: Number(event.data.permissions),
    userType: Number(event.data.userType),
  };

  event.waitUntil(
    setClientUserPartition(
      event.source.id,
      isValidClientPartition(partition) ? partition : undefined
    )
  );
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      // Setting {cache: 'reload'} in the new request will ensure that the
      // response isn't fulfilled from the HTTP cache; i.e., it will be from
      // the network.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    })()
  );
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Enable navigation preload if it's supported.
      // See https://developers.google.com/web/updates/2017/02/navigation-preload
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
      }

      const cacheKeys = await caches.keys();
      const activeCacheNames = [
        OFFLINE_CACHE_NAME,
        DATA_CACHE_NAME,
        STATIC_CACHE_NAME,
        CLIENT_CACHE_NAME,
      ];
      await Promise.all(
        cacheKeys
          .filter(
            (key) =>
              (LEGACY_CACHE_NAMES.includes(key) ||
                MANAGED_CACHE_PREFIXES.some((prefix) =>
                  key.startsWith(prefix)
                )) &&
              !activeCacheNames.includes(key)
          )
          .map((key) => caches.delete(key))
      );

      await Promise.all([
        caches
          .open(DATA_CACHE_NAME)
          .then((cache) =>
            trimRuntimeCache(
              cache,
              DATA_CACHE_MAX_ENTRIES,
              DATA_CACHE_RETENTION_MS,
              DATA_CACHE_NAME,
              true
            )
          ),
        caches
          .open(STATIC_CACHE_NAME)
          .then((cache) =>
            trimRuntimeCache(
              cache,
              STATIC_CACHE_MAX_ENTRIES,
              STATIC_CACHE_RETENTION_MS,
              STATIC_CACHE_NAME,
              true
            )
          ),
        caches.open(CLIENT_CACHE_NAME).then(trimClientPartitions),
      ]);
    })()
  );

  // Tell the active service worker to take control of the page immediately.
  clients.claim();
});

self.addEventListener('fetch', (event) => {
  const cacheType = getRuntimeCacheType(event.request);

  if (cacheType) {
    const strategyPromise = (async () => {
      const cacheRequest =
        cacheType === 'user-data'
          ? await getUserCacheRequest(event.request, event.clientId)
          : event.request;

      if (!cacheRequest) {
        const networkResponsePromise = fetch(event.request);
        return {
          responsePromise: networkResponsePromise,
          networkResponsePromise,
        };
      }

      return staleWhileRevalidate(event.request, cacheRequest, cacheType);
    })();

    event.respondWith(
      strategyPromise.then((strategy) => strategy.responsePromise)
    );
    event.waitUntil(
      strategyPromise
        .then((strategy) => strategy.networkResponsePromise)
        .catch(() => undefined)
    );
    return;
  }

  // We only want to call event.respondWith() if this is a navigation request
  // for an HTML page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // First, try to use the navigation preload response if it's supported.
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) {
            return preloadResponse;
          }

          // Always try the network first.
          const networkResponse = await fetch(event.request);
          return networkResponse;
        } catch (error) {
          // catch is only triggered if an exception is thrown, which is likely
          // due to a network error.
          // If fetch() returns a valid HTTP response with a response code in
          // the 4xx or 5xx range, the catch() will NOT be called.
          // eslint-disable-next-line no-console
          console.log('Fetch failed; returning offline page instead.', error);

          const cache = await caches.open(OFFLINE_CACHE_NAME);
          const cachedResponse = await cache.match(OFFLINE_URL);
          return cachedResponse;
        }
      })()
    );
  }
});

const getSafeNotificationActionPath = (value) => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\r\n]/.test(value)
  ) {
    return undefined;
  }

  try {
    const url = new URL(value, self.location.origin);
    const path = value.split(/[?#]/, 1)[0];
    return url.origin === self.location.origin && url.pathname === path
      ? `${url.pathname}${url.search}${url.hash}`
      : undefined;
  } catch {
    return undefined;
  }
};

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Ignore malformed push data rather than terminating the event handler.
  }
  const actionUrl = getSafeNotificationActionPath(payload.actionUrl);

  const options = {
    body: payload.message,
    badge: 'badge-128x128.png',
    icon: payload.image ? payload.image : 'android-chrome-192x192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '2',
      actionUrl,
    },
    actions: [],
  };

  if (actionUrl) {
    options.actions.push({
      action: 'view',
      title:
        typeof payload.actionUrlTitle === 'string'
          ? payload.actionUrlTitle.slice(0, 100)
          : 'View',
    });
  }

  // Set the badge with the amount of pending requests
  // Only update the badge if the payload confirms they are the admin
  if (
    (payload.notificationType === 'MEDIA_APPROVED' ||
      payload.notificationType === 'MEDIA_DECLINED') &&
    payload.isAdmin
  ) {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(payload.pendingRequestsCount);
    }
    return;
  }

  if (payload.notificationType === 'MEDIA_PENDING') {
    if ('setAppBadge' in navigator) {
      navigator.setAppBadge(payload.pendingRequestsCount);
    }
  }

  event.waitUntil(self.registration.showNotification(payload.subject, options));
});

self.addEventListener(
  'notificationclick',
  (event) => {
    const actionUrl = getSafeNotificationActionPath(
      event.notification?.data?.actionUrl
    );

    event.notification.close();

    if (actionUrl) {
      event.waitUntil(
        clients.openWindow(new URL(actionUrl, self.location.origin).href)
      );
    }
  },
  false
);
