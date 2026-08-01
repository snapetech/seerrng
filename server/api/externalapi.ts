import logger from '@server/logger';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import { requestInterceptorFunction } from '@server/utils/customProxyAgent';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import type NodeCache from 'node-cache';
import { createHash } from 'node:crypto';

// 5 minute default TTL (in seconds)
const DEFAULT_TTL = 300;

// 10 seconds default rolling buffer (in ms)
const DEFAULT_ROLLING_BUFFER = 10000;
export const DEFAULT_EXTERNAL_API_TIMEOUT_MS = 10_000;
export const DEFAULT_EXTERNAL_API_MAX_CONTENT_LENGTH = 16 * 1024 * 1024;
export const DEFAULT_EXTERNAL_API_MAX_BODY_LENGTH = 1024 * 1024;
export const MAX_PENDING_EXTERNAL_API_REQUESTS = 256;

const CACHE_KEY_DIGEST_PREFIX = ':sha256:';
const MAX_CACHE_KEY_VALUES = 100_000;
const MAX_CACHE_KEY_DEPTH = 64;
const MAX_CREDENTIAL_SCAN_NODES = 5_000;
const MAX_CREDENTIAL_SCAN_DEPTH = 32;
const CREDENTIAL_FIELD_PATTERN =
  /(authorization|api[-_]?key|auth(?:entication)?[-_]?token|auth[-_]?header|auth|token|secret|password|cookie|credential)$/i;

export const containsCredentialFields = (value: unknown): boolean => {
  const ancestors = new WeakSet<object>();
  let visitedNodes = 0;

  const inspect = (item: unknown, depth: number): boolean => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    if (
      depth > MAX_CREDENTIAL_SCAN_DEPTH ||
      visitedNodes >= MAX_CREDENTIAL_SCAN_NODES
    ) {
      // If a configuration is too complex to inspect safely, do not let it
      // authorize detached background work.
      return true;
    }
    if (ancestors.has(item)) {
      return false;
    }
    if (item instanceof URLSearchParams) {
      return [...item.keys()].some((key) => CREDENTIAL_FIELD_PATTERN.test(key));
    }

    ancestors.add(item);
    visitedNodes += 1;
    try {
      return Object.entries(item).some(
        ([key, nested]) =>
          CREDENTIAL_FIELD_PATTERN.test(key) || inspect(nested, depth + 1)
      );
    } finally {
      ancestors.delete(item);
    }
  };

  return inspect(value, 0);
};

export interface ExternalAPIOptions {
  allowPrivateAddresses?: boolean;
  allowedBaseUrls?: string[];
  nodeCache?: NodeCache;
  headers?: Record<string, unknown>;
  timeout?: number;
  maxContentLength?: number;
  maxBodyLength?: number;
  rateLimit?: {
    maxRPS: number;
    maxRequests: number;
  };
}

const getHttpOrigin = (
  value: string,
  options: { allowMalformed?: boolean } = {}
): string | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (options.allowMalformed) {
      return undefined;
    }
    throw error;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('External API base URLs must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('External API base URLs must not contain credentials.');
  }
  return url.origin;
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const normalizeExternalApiRequestTarget = (
  endpoint: string,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>
): string => {
  let requestUrl: URL;
  try {
    requestUrl = new URL(endpoint, baseUrl);
  } catch {
    // Preserve the legacy delayed failure for incomplete administrator
    // configuration, but never let an absolute target bypass the origin
    // policy when URL parsing succeeds for the endpoint itself.
    if (isAbsoluteUrl(endpoint)) {
      throw new Error('External API request target is not allowed.');
    }
    return endpoint;
  }

  if (
    !['http:', 'https:'].includes(requestUrl.protocol) ||
    requestUrl.username ||
    requestUrl.password ||
    !allowedOrigins.has(requestUrl.origin)
  ) {
    throw new Error('External API request target is not allowed.');
  }

  return endpoint;
};

export const createExternalApiCacheKeySuffix = (
  options?: Record<string, unknown>
) => {
  if (!options) {
    return '';
  }

  const hash = createHash('sha256');
  const ancestors = new Map<object, number>();
  let visitedValues = 0;
  const write = (value: string) => {
    hash.update(`${Buffer.byteLength(value, 'utf8')}:`);
    hash.update(value);
  };
  const serialize = (value: unknown, depth: number): void => {
    if (depth > MAX_CACHE_KEY_DEPTH || visitedValues >= MAX_CACHE_KEY_VALUES) {
      throw new Error('External API cache options exceed safe limits.');
    }
    visitedValues += 1;

    if (value === null) {
      write('null');
      return;
    }

    switch (typeof value) {
      case 'undefined':
        write('undefined');
        return;
      case 'string':
        write('string');
        write(value);
        return;
      case 'boolean':
        write(value ? 'true' : 'false');
        return;
      case 'number':
        write('number');
        write(
          Number.isNaN(value)
            ? 'NaN'
            : Object.is(value, -0)
              ? '-0'
              : String(value)
        );
        return;
      case 'bigint':
        write('bigint');
        write(value.toString());
        return;
      case 'symbol':
      case 'function':
        throw new TypeError(
          `Unsupported external API cache option value: ${typeof value}.`
        );
    }

    const ancestorDepth = ancestors.get(value);
    if (ancestorDepth !== undefined) {
      write('cycle');
      write(String(depth - ancestorDepth));
      return;
    }

    if (Buffer.isBuffer(value)) {
      write('buffer');
      write(value.toString('base64'));
      return;
    }
    if (value instanceof Date) {
      write('date');
      write(Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString());
      return;
    }
    if (value instanceof URL) {
      write('url');
      write(value.href);
      return;
    }
    if (value instanceof URLSearchParams) {
      write('url-search-params');
      write(value.toString());
      return;
    }

    ancestors.set(value, depth);
    try {
      if (Array.isArray(value)) {
        write('array:start');
        for (const entry of value) {
          serialize(entry, depth + 1);
        }
        write('array:end');
        return;
      }

      write('object:start');
      for (const key of Object.keys(value).sort()) {
        write('key');
        write(key);
        serialize((value as Record<string, unknown>)[key], depth + 1);
      }
      write('object:end');
    } finally {
      ancestors.delete(value);
    }
  };

  serialize(options, 0);
  return `${CACHE_KEY_DIGEST_PREFIX}${hash.digest('hex')}`;
};

class ExternalAPI {
  protected axios: AxiosInstance;
  private baseUrl: string;
  private allowedOrigins: ReadonlySet<string>;
  private cacheScope: string;
  private cache?: NodeCache;
  private backgroundCacheRefreshEnabled: boolean;
  private static pendingRequests = new Map<string | symbol, Promise<unknown>>();

  constructor(
    baseUrl: string,
    params: Record<string, unknown>,
    options: ExternalAPIOptions = {}
  ) {
    const configuredOrigin = getHttpOrigin(baseUrl, { allowMalformed: true });
    const allowedOrigins = new Set(
      [
        configuredOrigin,
        ...(options.allowedBaseUrls ?? []).map((url) => getHttpOrigin(url)),
      ].filter((origin): origin is string => origin !== undefined)
    );
    this.axios = axios.create({
      baseURL: baseUrl,
      params,
      ...createSafeHttpRequestOptions(
        options.allowPrivateAddresses ?? false,
        false
      ),
      timeout: options.timeout ?? DEFAULT_EXTERNAL_API_TIMEOUT_MS,
      maxContentLength:
        options.maxContentLength ?? DEFAULT_EXTERNAL_API_MAX_CONTENT_LENGTH,
      maxBodyLength:
        options.maxBodyLength ?? DEFAULT_EXTERNAL_API_MAX_BODY_LENGTH,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });
    this.axios.interceptors.request.use((config) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(config.url ?? '', config.baseURL ?? baseUrl);
      } catch {
        // Some legacy configurations contain an incomplete base URL. A
        // relative request remains non-routable with Axios' real adapter, but
        // delaying that failure lets configuration recovery and test adapters
        // inspect the request. Never permit an absolute first-hop escape.
        if (isAbsoluteUrl(config.url ?? '')) {
          throw new Error('External API request target is not allowed.');
        }
        return config;
      }
      if (
        !['http:', 'https:'].includes(requestUrl.protocol) ||
        requestUrl.username ||
        requestUrl.password ||
        !allowedOrigins.has(requestUrl.origin)
      ) {
        throw new Error('External API request target is not allowed.');
      }
      return config;
    });
    this.axios.interceptors.request.use(requestInterceptorFunction);

    if (options.rateLimit) {
      this.axios = rateLimit(this.axios, {
        maxRequests: options.rateLimit.maxRequests,
        maxRPS: options.rateLimit.maxRPS,
      });
    }

    this.baseUrl = baseUrl;
    this.allowedOrigins = allowedOrigins;
    // Shared caches and the process-wide in-flight map must not coalesce
    // requests made with different credentials or constructor-level params.
    // Keep only a digest in cache keys so API secrets are not retained there.
    this.cacheScope = createExternalApiCacheKeySuffix({
      params,
      headers: options.headers,
    });
    this.cache = options.nodeCache;
    // Credential-bearing API instances can outlive the request or security
    // lease that created them. Let their cache entries expire naturally
    // instead of starting detached requests with stale authority.
    this.backgroundCacheRefreshEnabled = !(
      containsCredentialFields(params) ||
      containsCredentialFields(options.headers)
    );
  }

  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number,
    isUsableResponse?: (data: T) => boolean
  ): Promise<T> {
    const requestEndpoint = normalizeExternalApiRequestTarget(
      endpoint,
      config?.baseURL ?? this.baseUrl,
      this.allowedOrigins
    );
    const cacheKey = this.serializeCacheKey(endpoint, {
      params: config?.params,
      headers: config?.headers,
      baseURL: config?.baseURL,
    });
    if (ttl !== 0) {
      const cachedItem = this.cache?.get<T>(cacheKey);
      if (cachedItem !== undefined) {
        if (!isUsableResponse || isUsableResponse(cachedItem)) {
          return cachedItem;
        }
        this.cache?.del(cacheKey);
      }
    }

    const response = await this.fetchAndCache(
      'GET',
      cacheKey,
      () => this.axios.get<T>(requestEndpoint, config),
      ttl,
      isUsableResponse
    );

    if (isUsableResponse && !isUsableResponse(response)) {
      return this.fetchAndCache(
        'GET',
        cacheKey,
        () => this.axios.get<T>(requestEndpoint, config),
        0,
        isUsableResponse
      );
    }

    return response;
  }

  protected async post<T>(
    endpoint: string,
    data?: Record<string, unknown>,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const requestEndpoint = normalizeExternalApiRequestTarget(
      endpoint,
      config?.baseURL ?? this.baseUrl,
      this.allowedOrigins
    );
    const cacheable = typeof ttl === 'number' && ttl > 0;
    const cacheKey = this.serializeCacheKey(endpoint, {
      params: config?.params,
      headers: config?.headers,
      baseURL: config?.baseURL,
      ...(data ? { data } : {}),
    });

    if (cacheable) {
      const cachedItem = this.cache?.get<T>(cacheKey);
      if (cachedItem !== undefined) {
        return cachedItem;
      }
    }

    return this.fetchAndCache(
      'POST',
      cacheKey,
      () => this.axios.post<T>(requestEndpoint, data, config),
      ttl
    );
  }

  protected async getRolling<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const requestEndpoint = normalizeExternalApiRequestTarget(
      endpoint,
      config?.baseURL ?? this.baseUrl,
      this.allowedOrigins
    );
    const cacheKey = this.serializeCacheKey(endpoint, {
      params: config?.params,
      headers: config?.headers,
      baseURL: config?.baseURL,
    });
    const cachedItem = ttl === 0 ? undefined : this.cache?.get<T>(cacheKey);

    if (cachedItem !== undefined) {
      const keyTtl = this.cache?.getTtl(cacheKey) ?? 0;

      // If the item has passed our rolling check, fetch again in background
      if (
        this.backgroundCacheRefreshEnabled &&
        !containsCredentialFields({
          params: config?.params,
          headers: config?.headers,
        }) &&
        keyTtl - (ttl ?? DEFAULT_TTL) * 1000 <
          Date.now() - DEFAULT_ROLLING_BUFFER
      ) {
        trackBackgroundTask('rolling external API cache refresh', () =>
          this.fetchAndCache(
            'GET',
            cacheKey,
            () => this.axios.get<T>(requestEndpoint, config),
            ttl
          )
        );
      }
      return cachedItem;
    }

    return this.fetchAndCache(
      'GET',
      cacheKey,
      () => this.axios.get<T>(requestEndpoint, config),
      ttl
    );
  }

  protected removeCache(endpoint: string, options?: Record<string, unknown>) {
    const cacheKey = this.serializeCacheKey(endpoint, {
      params: options,
      headers: undefined,
      baseURL: undefined,
    });
    this.cache?.del(cacheKey);
  }

  private serializeCacheKey(
    endpoint: string,
    options?: Record<string, unknown>
  ) {
    return `external-api${createExternalApiCacheKeySuffix({
      baseUrl: this.baseUrl,
      endpoint,
      scope: this.cacheScope,
      options,
    })}`;
  }

  private async fetchAndCache<T>(
    method: 'GET' | 'POST',
    cacheKey: string,
    request: () => Promise<{ data: T }>,
    ttl?: number,
    isUsableResponse?: (data: T) => boolean
  ): Promise<T> {
    const pendingKey = `${method}:${cacheKey}`;
    const cacheable =
      method === 'GET' ? ttl !== 0 : typeof ttl === 'number' && ttl > 0;
    const coalesce = method === 'GET' || cacheable;
    const requestKey: string | symbol = coalesce
      ? pendingKey
      : Symbol(pendingKey);
    if (coalesce) {
      const pendingRequest = ExternalAPI.pendingRequests.get(requestKey) as
        | Promise<T>
        | undefined;
      if (pendingRequest) {
        return pendingRequest;
      }
    }

    if (ExternalAPI.pendingRequests.size >= MAX_PENDING_EXTERNAL_API_REQUESTS) {
      throw new Error('External API request capacity exceeded.');
    }

    // Defer adapter invocation until after the promise is admitted to the
    // process-wide map. This keeps the size check and registration atomic on
    // the JavaScript event loop, including for adapters that throw
    // synchronously.
    const pending = Promise.resolve()
      .then(request)
      .then((response) => {
        if (
          this.cache &&
          cacheable &&
          (!isUsableResponse || isUsableResponse(response.data))
        ) {
          try {
            this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
          } catch (error) {
            logger.warn('Unable to cache external API response', {
              label: 'External API',
              errorMessage:
                error instanceof Error ? error.message : 'Unknown cache error',
            });
          }
        }

        return response.data;
      })
      .finally(() => {
        ExternalAPI.pendingRequests.delete(requestKey);
      });

    ExternalAPI.pendingRequests.set(requestKey, pending);

    return pending;
  }
}

export default ExternalAPI;
