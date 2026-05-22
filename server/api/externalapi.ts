import { requestInterceptorFunction } from '@server/utils/customProxyAgent';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import type NodeCache from 'node-cache';
import { createHash } from 'node:crypto';

// 5 minute default TTL (in seconds)
const DEFAULT_TTL = 300;

// 10 seconds default rolling buffer (in ms)
const DEFAULT_ROLLING_BUFFER = 10000;

const CACHE_KEY_DIGEST_PREFIX = ':sha256:';

export interface ExternalAPIOptions {
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

export const createExternalApiCacheKeySuffix = (
  options?: Record<string, unknown>
) => {
  if (!options) {
    return '';
  }

  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(options, (_key, value: unknown) => {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value;
    }

    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = (value as Record<string, unknown>)[key];
        return sorted;
      }, {});
  });

  return `${CACHE_KEY_DIGEST_PREFIX}${createHash('sha256')
    .update(serialized ?? '')
    .digest('hex')}`;
};

class ExternalAPI {
  protected axios: AxiosInstance;
  private baseUrl: string;
  private cache?: NodeCache;
  private static pendingRequests = new Map<string, Promise<unknown>>();

  constructor(
    baseUrl: string,
    params: Record<string, unknown>,
    options: ExternalAPIOptions = {}
  ) {
    this.axios = axios.create({
      baseURL: baseUrl,
      params,
      timeout: options.timeout,
      maxContentLength: options.maxContentLength,
      maxBodyLength: options.maxBodyLength,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });
    this.axios.interceptors.request.use(requestInterceptorFunction);

    if (options.rateLimit) {
      this.axios = rateLimit(this.axios, {
        maxRequests: options.rateLimit.maxRequests,
        maxRPS: options.rateLimit.maxRPS,
      });
    }

    this.baseUrl = baseUrl;
    this.cache = options.nodeCache;
  }

  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
      headers: config?.headers,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    return this.fetchAndCache(
      'GET',
      cacheKey,
      () => this.axios.get<T>(endpoint, config),
      ttl
    );
  }

  protected async post<T>(
    endpoint: string,
    data?: Record<string, unknown>,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      config: config?.params,
      ...(data ? { data } : {}),
    });

    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    return this.fetchAndCache(
      'POST',
      cacheKey,
      () => this.axios.post<T>(endpoint, data, config),
      ttl
    );
  }

  protected async getRolling<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
      headers: config?.headers,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);

    if (cachedItem) {
      const keyTtl = this.cache?.getTtl(cacheKey) ?? 0;

      // If the item has passed our rolling check, fetch again in background
      if (
        keyTtl - (ttl ?? DEFAULT_TTL) * 1000 <
        Date.now() - DEFAULT_ROLLING_BUFFER
      ) {
        this.fetchAndCache(
          'GET',
          cacheKey,
          () => this.axios.get<T>(endpoint, config),
          ttl
        ).catch(() => {
          // Keep serving the stale cached item if a background refresh fails.
        });
      }
      return cachedItem;
    }

    return this.fetchAndCache(
      'GET',
      cacheKey,
      () => this.axios.get<T>(endpoint, config),
      ttl
    );
  }

  protected removeCache(endpoint: string, options?: Record<string, unknown>) {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...options,
    });
    this.cache?.del(cacheKey);
  }

  private serializeCacheKey(
    endpoint: string,
    options?: Record<string, unknown>
  ) {
    if (!options) {
      return `${this.baseUrl}${endpoint}`;
    }

    return `${this.baseUrl}${endpoint}${createExternalApiCacheKeySuffix(
      options
    )}`;
  }

  private async fetchAndCache<T>(
    method: 'GET' | 'POST',
    cacheKey: string,
    request: () => Promise<{ data: T }>,
    ttl?: number
  ): Promise<T> {
    const pendingKey = `${method}:${cacheKey}`;
    const pendingRequest = ExternalAPI.pendingRequests.get(pendingKey) as
      | Promise<T>
      | undefined;
    if (pendingRequest) {
      return pendingRequest;
    }

    const pending = request()
      .then((response) => {
        if (this.cache && ttl !== 0) {
          this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
        }

        return response.data;
      })
      .finally(() => {
        ExternalAPI.pendingRequests.delete(pendingKey);
      });

    ExternalAPI.pendingRequests.set(pendingKey, pending);

    return pending;
  }
}

export default ExternalAPI;
