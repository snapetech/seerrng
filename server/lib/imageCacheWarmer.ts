import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';

const warmBatchSize = 8;
const maxWarmUrls = 80;
const maxWarmPathLength = 2048;
const warmCooldownMs = 5 * 60 * 1000;
const maxRememberedWarmUrls = 5000;
export const maxQueuedWarmUrls = 1000;
const queuedWarmUrls = new Set<string>();
const recentlyWarmedUrls = new Map<string, number>();

const tmdbImageProxy = new ImageProxy('tmdb', 'https://image.tmdb.org', {
  rateLimitOptions: {
    maxRequests: 10,
    maxRPS: 20,
  },
});
const tvdbImageProxy = new ImageProxy('tvdb', 'https://artworks.thetvdb.com', {
  rateLimitOptions: {
    maxRequests: 10,
    maxRPS: 20,
  },
});
const coverArtArchiveImageProxy = new ImageProxy(
  'coverartarchive',
  'https://coverartarchive.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const archiveOrgImageProxy = new ImageProxy(
  'archiveorg',
  'https://archive.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const theAudioDbImageProxy = new ImageProxy(
  'theaudiodb',
  'https://r2.theaudiodb.com',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);
const openLibraryCoversImageProxy = new ImageProxy(
  'openlibrarycovers',
  'https://covers.openlibrary.org',
  {
    rateLimitOptions: {
      maxRequests: 5,
      maxRPS: 10,
    },
  }
);

export const getImageCacheWarmProvider = (url: URL): string | null => {
  switch (url.origin) {
    case 'https://image.tmdb.org':
      return 'tmdb';
    case 'https://artworks.thetvdb.com':
      return 'tvdb';
    case 'https://coverartarchive.org':
      return 'coverartarchive';
    case 'https://archive.org':
      return 'archiveorg';
    case 'https://r2.theaudiodb.com':
    case 'https://www.theaudiodb.com':
      return 'theaudiodb';
    case 'https://covers.openlibrary.org':
      return 'openlibrarycovers';
    default:
      return null;
  }
};

export const getImageCacheWarmPath = (url: URL): string =>
  `${url.pathname}${url.search}`;

export const isImageCacheWarmUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    const path = getImageCacheWarmPath(url);

    return (
      getImageCacheWarmProvider(url) !== null &&
      !url.username &&
      !url.password &&
      path.length <= maxWarmPathLength &&
      !url.pathname.startsWith('//') &&
      !url.pathname.includes('://')
    );
  } catch {
    return false;
  }
};

const getProxyForUrl = (url: URL): ImageProxy | null => {
  const provider = getImageCacheWarmProvider(url);

  switch (provider) {
    case 'tmdb':
      return tmdbImageProxy;
    case 'tvdb':
      return tvdbImageProxy;
    case 'coverartarchive':
      return coverArtArchiveImageProxy;
    case 'archiveorg':
      return archiveOrgImageProxy;
    case 'theaudiodb':
      return theAudioDbImageProxy;
    case 'openlibrarycovers':
      return openLibraryCoversImageProxy;
    default:
      return null;
  }
};

const warmUrl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  const proxy = getProxyForUrl(url);

  if (!proxy) {
    return;
  }

  await proxy.getImage(getImageCacheWarmPath(url));
};

export const getQueuedImageCacheWarmCount = (): number => queuedWarmUrls.size;

export const enqueueImageCacheWarm = (urls: string[]): number => {
  if (process.env.E2E_TESTS === 'true' || !getSettings().main.cacheImages) {
    return 0;
  }

  const now = Date.now();

  if (recentlyWarmedUrls.size > maxRememberedWarmUrls) {
    for (const [url, expiresAt] of recentlyWarmedUrls) {
      if (expiresAt <= now || recentlyWarmedUrls.size > maxRememberedWarmUrls) {
        recentlyWarmedUrls.delete(url);
      }
    }
  }

  const uniqueUrls = [...new Set(urls)]
    .filter(isImageCacheWarmUrl)
    .slice(0, maxWarmUrls)
    .filter((url) => {
      if (queuedWarmUrls.has(url)) {
        return false;
      }

      if ((recentlyWarmedUrls.get(url) ?? 0) > now) {
        return false;
      }

      if (queuedWarmUrls.size >= maxQueuedWarmUrls) {
        return false;
      }

      queuedWarmUrls.add(url);
      recentlyWarmedUrls.set(url, now + warmCooldownMs);
      return true;
    });

  if (!uniqueUrls.length) {
    return 0;
  }

  trackBackgroundTask('image cache warming', async () => {
    try {
      for (let i = 0; i < uniqueUrls.length; i += warmBatchSize) {
        const batch = uniqueUrls.slice(i, i + warmBatchSize);

        await Promise.allSettled(batch.map((url) => warmUrl(url)));
      }
    } finally {
      for (const url of uniqueUrls) {
        queuedWarmUrls.delete(url);
      }
    }

    logger.debug(`Queued ${uniqueUrls.length} image(s) for cache warming`, {
      label: 'Image Cache',
    });
  });

  return uniqueUrls.length;
};
