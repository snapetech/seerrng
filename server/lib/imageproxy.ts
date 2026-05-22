import logger from '@server/logger';
import { requestInterceptorFunction } from '@server/utils/customProxyAgent';
import axios, { type AxiosInstance } from 'axios';
import rateLimit, { type rateLimitOptions } from 'axios-rate-limit';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { createReadStream, promises } from 'fs';
import mime from 'mime/lite';
import path from 'path';
import sharp from 'sharp';

type ImageMeta = {
  revalidateAfter: number;
  curRevalidate: number;
  isStale: boolean;
  etag: string;
  extension: string | null;
  cacheKey: string;
  cacheMiss: boolean;
  lastModified: number;
};

export type ImageResponse = {
  meta: ImageMeta;
  // Exactly one of these is set: a buffer for hot/just-fetched images,
  // or a file path to stream from disk for larger cold images.
  imageBuffer?: Buffer;
  filePath?: string;
};

const baseCacheDirectory = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/cache/images`
  : path.join(__dirname, '../../config/cache/images');

const WEBP_QUALITY = 80;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LRU_MAX_BYTES = 64 * 1024 * 1024;
const LRU_MAX_ENTRIES = 512;
// Images larger than this are streamed from disk instead of held in memory.
const LRU_ITEM_MAX_BYTES = 1.5 * 1024 * 1024;
const TRANSCODABLE_CONTENT_TYPE = /^image\/(jpe?g|png|webp|avif|bmp|tiff)$/i;
const DEFAULT_IMAGE_CACHE_MAX_AGE = 86400;
export const MAX_IMAGE_CACHE_MAX_AGE = 365 * 24 * 60 * 60;
const resolvedBaseCacheDirectory = path.resolve(baseCacheDirectory);

export const IMAGE_PROXY_HTTP_OPTIONS = {
  timeout: 10_000,
} as const;

export const parseCacheControlMaxAge = (
  cacheControl: string | undefined
): number => {
  const maxAge = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);

  if (!maxAge) {
    return DEFAULT_IMAGE_CACHE_MAX_AGE;
  }

  const parsed = Number(maxAge[1]);

  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_IMAGE_CACHE_MAX_AGE)
    : DEFAULT_IMAGE_CACHE_MAX_AGE;
};

export const parseImageCacheFileMetadata = (
  filename: string,
  now = Date.now()
): {
  maxAge: number;
  expireAt: number;
  etag: string;
  extension: string;
  lastModified: number;
  revalidateAfter: number;
  isStale: boolean;
} | null => {
  const [maxAgeSt, expireAtSt, etag, extension, ...extra] = filename.split('.');

  if (extra.length || !etag || !extension) {
    return null;
  }

  const maxAge = Number(maxAgeSt);
  const expireAt = Number(expireAtSt);

  if (
    !Number.isSafeInteger(maxAge) ||
    maxAge <= 0 ||
    maxAge > MAX_IMAGE_CACHE_MAX_AGE ||
    !Number.isSafeInteger(expireAt) ||
    expireAt <= 0
  ) {
    return null;
  }

  const lastModified = getImageCacheLastModified(expireAt, maxAge, now);
  if (!Number.isFinite(lastModified)) {
    return null;
  }

  return {
    maxAge,
    expireAt,
    etag,
    extension,
    lastModified,
    revalidateAfter: maxAge * 1000 + now,
    isStale: now > expireAt,
  };
};

export const getImageCacheLastModified = (
  expireAt: number,
  maxAge: number,
  now = Date.now()
): number => {
  if (
    Number.isFinite(expireAt) &&
    Number.isFinite(maxAge) &&
    maxAge > 0 &&
    expireAt > 0
  ) {
    return expireAt - maxAge * 1000;
  }

  return now;
};

export const getImageResponseContentType = (
  extension: string | null | undefined
): string => {
  if (!extension) {
    return 'application/octet-stream';
  }

  return mime.getType(extension) ?? `image/${extension}`;
};

const getHeaderString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string');
  }

  return undefined;
};

const resolveCachePath = (...segments: string[]): string => {
  const resolved = path.resolve(baseCacheDirectory, ...segments);
  const relative = path.relative(resolvedBaseCacheDirectory, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Image cache path escapes cache directory');
  }

  return resolved;
};

const assertCachePath = (target: string): string => {
  const resolved = path.resolve(target);
  const relative = path.relative(resolvedBaseCacheDirectory, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Image cache path escapes cache directory');
  }

  return resolved;
};

type LruEntry = {
  buffer: Buffer;
  maxAge: number;
  expireAt: number;
  etag: string;
  extension: string | null;
  lastModified: number;
};

/**
 * Process-wide LRU of decoded image bytes, shared across all ImageProxy
 * instances. Cache keys are SHA-256 hashes that already incorporate the
 * proxy key + version + path, so they are globally unique.
 */
class ImageMemoryCache {
  private map = new Map<string, LruEntry>();
  private bytes = 0;

  public get(key: string): LruEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    // Mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  public set(key: string, entry: LruEntry): void {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.buffer.length;
      this.map.delete(key);
    }
    this.map.set(key, entry);
    this.bytes += entry.buffer.length;
    this.evict();
  }

  public delete(key: string): void {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.buffer.length;
      this.map.delete(key);
    }
  }

  public clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  private evict(): void {
    while (
      (this.bytes > LRU_MAX_BYTES || this.map.size > LRU_MAX_ENTRIES) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value as string;
      const oldest = this.map.get(oldestKey);
      if (oldest) {
        this.bytes -= oldest.buffer.length;
      }
      this.map.delete(oldestKey);
    }
  }
}

const memoryCache = new ImageMemoryCache();

/**
 * Writes the response headers and body for a cached image, streaming from
 * disk when the payload was not small enough to keep in memory.
 */
export async function sendImage(
  res: Response,
  imageData: ImageResponse,
  headers: Record<string, string | number>
): Promise<void> {
  if (imageData.imageBuffer) {
    res.writeHead(200, {
      ...headers,
      'Content-Length': imageData.imageBuffer.length,
    });
    res.end(imageData.imageBuffer);
    return;
  }

  if (!imageData.filePath) {
    res.status(500).end();
    return;
  }

  try {
    const stat = await promises.lstat(imageData.filePath);
    if (!stat.isFile()) {
      res.status(500).end();
      return;
    }

    const { size } = stat;
    res.writeHead(200, { ...headers, 'Content-Length': size });
    const stream = createReadStream(imageData.filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.destroy();
    });
    stream.pipe(res);
  } catch {
    res.status(500).end();
  }
}

class ImageProxy {
  public static async clearCache(key: string) {
    let deletedImages = 0;
    const cacheDirectory = resolveCachePath(key);

    try {
      const files = await promises.readdir(cacheDirectory);

      for (const file of files) {
        const filePath = resolveCachePath(key, file);
        const stat = await promises.lstat(filePath);

        if (stat.isDirectory()) {
          const imageFiles = await promises.readdir(filePath);

          for (const imageFile of imageFiles) {
            const metadata = parseImageCacheFileMetadata(imageFile);

            if (metadata?.isStale) {
              await promises.rm(filePath, {
                recursive: true,
              });
              deletedImages += 1;
            }
          }
        }
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        return;
      }
      logger.error('Failed to read directory', {
        label: 'Image Cache',
        message: e.message,
      });
    }

    // On-disk entries were pruned; drop the in-memory mirror so stale
    // bytes are not served from RAM.
    memoryCache.clear();

    logger.info(`Cleared ${deletedImages} stale image(s) from cache '${key}'`, {
      label: 'Image Cache',
    });
  }

  public static async getImageStats(
    key: string
  ): Promise<{ size: number; imageCount: number }> {
    const cacheDirectory = resolveCachePath(key);

    const imageTotalSize = await ImageProxy.getDirectorySize(cacheDirectory);
    const imageCount = await ImageProxy.getImageCount(cacheDirectory);

    return {
      size: imageTotalSize,
      imageCount,
    };
  }

  private static async getDirectorySize(dir: string): Promise<number> {
    try {
      const files = await promises.readdir(dir, {
        withFileTypes: true,
      });

      const paths = files.map(async (file) => {
        const filePath = assertCachePath(path.join(dir, file.name));

        if (file.isDirectory()) {
          return await ImageProxy.getDirectorySize(filePath);
        }

        if (file.isFile()) {
          const { size } = await promises.lstat(filePath);

          return size;
        }

        return 0;
      });

      return (await Promise.all(paths))
        .flat(Infinity)
        .reduce((i, size) => i + size, 0);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return 0;
      }
    }

    return 0;
  }

  private static async getImageCount(dir: string) {
    try {
      const files = await promises.readdir(dir);

      return files.length;
    } catch (e) {
      if (e.code === 'ENOENT') {
        return 0;
      }
    }

    return 0;
  }

  private axios: AxiosInstance;
  private cacheVersion;
  private key;

  constructor(
    key: string,
    baseUrl: string,
    options: {
      cacheVersion?: number;
      rateLimitOptions?: rateLimitOptions;
      headers?: Record<string, string>;
    } = {}
  ) {
    // Bumped to 2 when WebP transcoding was introduced so previously
    // cached originals are re-fetched and re-encoded.
    this.cacheVersion = options.cacheVersion ?? 2;
    this.key = key;
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: options.headers,
      ...IMAGE_PROXY_HTTP_OPTIONS,
    });
    this.axios.interceptors.request.use(requestInterceptorFunction);

    if (options.rateLimitOptions) {
      this.axios = rateLimit(this.axios, options.rateLimitOptions);
    }
  }

  public async getImage(
    path: string,
    fallbackPath?: string
  ): Promise<ImageResponse> {
    const cacheKey = this.getCacheKey(path);

    const imageResponse = await this.get(cacheKey);

    if (!imageResponse) {
      const newImage = await this.set(path, cacheKey);

      if (!newImage) {
        if (fallbackPath) {
          return await this.getImage(fallbackPath);
        } else {
          throw new Error('Failed to load image');
        }
      }

      return newImage;
    }

    // If the image is stale, we will revalidate it in the background.
    if (imageResponse.meta.isStale) {
      this.set(path, cacheKey);
    }

    return imageResponse;
  }

  public async clearCachedImage(path: string) {
    // find cacheKey
    const cacheKey = this.getCacheKey(path);
    const directory = resolveCachePath(this.key, cacheKey);

    memoryCache.delete(cacheKey);

    try {
      await promises.access(directory);
    } catch (e) {
      if (e.code === 'ENOENT') {
        logger.debug(
          `Cache directory '${cacheKey}' does not exist; nothing to clear.`,
          {
            label: 'Image Cache',
          }
        );
        return;
      } else {
        logger.error('Error checking cache directory existence', {
          label: 'Image Cache',
          message: e.message,
        });
        return;
      }
    }

    try {
      const stat = await promises.lstat(directory);
      if (!stat.isDirectory()) {
        logger.error('Cached image path is not a directory', {
          label: 'Image Cache',
          cacheKey,
        });
        return;
      }

      const files = await promises.readdir(directory);

      await promises.rm(directory, { recursive: true });

      logger.debug(`Cleared ${files[0]} from cache 'avatar'`, {
        label: 'Image Cache',
      });
    } catch (e) {
      logger.error('Failed to clear cached image', {
        label: 'Image Cache',
        message: e.message,
      });
    }
  }

  private async get(cacheKey: string): Promise<ImageResponse | null> {
    const now = Date.now();

    const cached = memoryCache.get(cacheKey);
    if (cached) {
      return {
        meta: {
          curRevalidate: cached.maxAge,
          revalidateAfter: cached.expireAt,
          isStale: now > cached.expireAt,
          etag: cached.etag,
          extension: cached.extension,
          cacheKey,
          cacheMiss: false,
          lastModified: cached.lastModified,
        },
        imageBuffer: cached.buffer,
      };
    }

    try {
      const directory = resolveCachePath(this.key, cacheKey);
      const files = await promises.readdir(directory);

      for (const file of files) {
        const filePath = assertCachePath(path.join(directory, file));
        const metadata = parseImageCacheFileMetadata(file, now);
        if (!metadata) {
          continue;
        }

        const meta: ImageMeta = {
          curRevalidate: metadata.maxAge,
          revalidateAfter: metadata.revalidateAfter,
          isStale: metadata.isStale,
          etag: metadata.etag,
          extension: metadata.extension,
          cacheKey,
          cacheMiss: false,
          lastModified: metadata.lastModified,
        };

        const stat = await promises.lstat(filePath);
        if (!stat.isFile()) {
          continue;
        }

        const { size } = stat;

        if (size <= LRU_ITEM_MAX_BYTES) {
          const buffer = await promises.readFile(filePath);
          memoryCache.set(cacheKey, {
            buffer,
            maxAge: metadata.maxAge,
            expireAt: metadata.expireAt,
            etag: metadata.etag,
            extension: metadata.extension,
            lastModified: metadata.lastModified,
          });
          return { meta, imageBuffer: buffer };
        }

        return { meta, filePath };
      }
    } catch {
      // No files. Treat as empty cache.
    }

    return null;
  }

  private async set(
    path: string,
    cacheKey: string
  ): Promise<ImageResponse | null> {
    try {
      const directory = resolveCachePath(this.key, cacheKey);
      const response = await this.axios.get(path, {
        responseType: 'arraybuffer',
        maxContentLength: MAX_IMAGE_BYTES,
        maxBodyLength: MAX_IMAGE_BYTES,
      });

      let buffer = Buffer.from(response.data, 'binary');
      if (buffer.length > MAX_IMAGE_BYTES) {
        throw new Error('Image exceeds maximum allowed size');
      }

      const contentType =
        getHeaderString(response.headers['content-type']) ?? '';
      let extension = mime.getExtension(contentType) || '';

      if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error('Upstream response is not an image');
      }

      if (TRANSCODABLE_CONTENT_TYPE.test(contentType)) {
        try {
          buffer = await sharp(buffer, { animated: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer();
          extension = 'webp';
        } catch (e) {
          logger.debug('Failed to transcode image to WebP; storing original', {
            label: 'Image Cache',
            errorMessage: e.message,
          });
        }
      }

      const maxAge = parseCacheControlMaxAge(
        getHeaderString(response.headers['cache-control'])
      );
      const lastModified = Date.now();
      const expireAt = lastModified + maxAge * 1000;
      const etag = this.getHash([buffer]);

      const filePath = await this.writeToCacheDir(
        directory,
        extension,
        maxAge,
        expireAt,
        buffer,
        etag
      );

      if (buffer.length <= LRU_ITEM_MAX_BYTES) {
        memoryCache.set(cacheKey, {
          buffer,
          maxAge,
          expireAt,
          etag,
          extension,
          lastModified,
        });
      } else {
        memoryCache.delete(cacheKey);
      }

      return {
        meta: {
          curRevalidate: maxAge,
          revalidateAfter: expireAt,
          isStale: false,
          etag,
          extension,
          cacheKey,
          cacheMiss: true,
          lastModified,
        },
        ...(buffer.length <= LRU_ITEM_MAX_BYTES
          ? { imageBuffer: buffer }
          : { filePath }),
      };
    } catch (e) {
      logger.debug('Something went wrong caching image.', {
        label: 'Image Cache',
        errorMessage: e.message,
      });
      return null;
    }
  }

  private async writeToCacheDir(
    dir: string,
    extension: string | null,
    maxAge: number,
    expireAt: number,
    buffer: Buffer,
    etag: string
  ): Promise<string> {
    const safeDir = assertCachePath(dir);
    const filename = assertCachePath(
      path.join(safeDir, `${maxAge}.${expireAt}.${etag}.${extension}`)
    );

    const existing = await promises.lstat(safeDir).catch((e) => {
      if (e.code === 'ENOENT') {
        return null;
      }
      throw e;
    });

    if (existing && !existing.isDirectory()) {
      throw new Error('Image cache path is not a directory');
    }

    await promises.rm(safeDir, { force: true, recursive: true }).catch(() => {
      // do nothing
    });

    await promises.mkdir(safeDir, { recursive: true });
    await promises.writeFile(filename, buffer);

    return filename;
  }

  private getCacheKey(path: string) {
    return this.getHash([this.key, this.cacheVersion, path]);
  }

  private getHash(items: (string | number | Buffer)[]) {
    const hash = createHash('sha256');
    for (const item of items) {
      if (typeof item === 'number') hash.update(String(item));
      else {
        hash.update(item);
      }
    }
    // See https://en.wikipedia.org/wiki/Base64#Filenames
    return hash.digest('base64').replace(/\//g, '-');
  }

  private getCacheDirectory() {
    return resolveCachePath(this.key);
  }
}

export default ImageProxy;
