import {
  getBrowserImageResponseHeaders,
  shouldSendBrowserImageNotModified,
} from '@server/lib/browserImageCache';
import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import ImageProxy, {
  getImageResponseContentType,
  sendImage,
} from '@server/lib/imageproxy';
import logger from '@server/logger';
import { getRateLimitKey } from '@server/utils/security';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const router = Router();
const maxWarmRequestUrls = 100;
const maxWarmUrlLength = 2048;
const maxProxyImagePathLength = 2048;

const proxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const warmRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

router.use(proxyRateLimit);

// Delay the initialization of ImageProxy instances until the proxy (if any) is properly configured
let _tmdbImageProxy: ImageProxy;
function initTmdbImageProxy() {
  if (!_tmdbImageProxy) {
    _tmdbImageProxy = new ImageProxy('tmdb', 'https://image.tmdb.org', {
      rateLimitOptions: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
  }
  return _tmdbImageProxy;
}
let _tvdbImageProxy: ImageProxy;
function initTvdbImageProxy() {
  if (!_tvdbImageProxy) {
    _tvdbImageProxy = new ImageProxy('tvdb', 'https://artworks.thetvdb.com', {
      rateLimitOptions: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
  }
  return _tvdbImageProxy;
}
let _coverArtArchiveImageProxy: ImageProxy;
function initCoverArtArchiveImageProxy() {
  if (!_coverArtArchiveImageProxy) {
    _coverArtArchiveImageProxy = new ImageProxy(
      'coverartarchive',
      'https://coverartarchive.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _coverArtArchiveImageProxy;
}
let _archiveOrgImageProxy: ImageProxy;
function initArchiveOrgImageProxy() {
  if (!_archiveOrgImageProxy) {
    _archiveOrgImageProxy = new ImageProxy(
      'archiveorg',
      'https://archive.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _archiveOrgImageProxy;
}
let _theAudioDbImageProxy: ImageProxy;
function initTheAudioDbImageProxy() {
  if (!_theAudioDbImageProxy) {
    _theAudioDbImageProxy = new ImageProxy(
      'theaudiodb',
      'https://r2.theaudiodb.com',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _theAudioDbImageProxy;
}
let _openLibraryCoversImageProxy: ImageProxy;
function initOpenLibraryCoversImageProxy() {
  if (!_openLibraryCoversImageProxy) {
    _openLibraryCoversImageProxy = new ImageProxy(
      'openlibrarycovers',
      'https://covers.openlibrary.org',
      {
        rateLimitOptions: {
          maxRequests: 10,
          maxRPS: 20,
        },
      }
    );
  }
  return _openLibraryCoversImageProxy;
}

router.get<{
  type: string;
  path: string[];
}>('/:type/*path', async (req, res) => {
  const queryIndex = req.url.indexOf('?');
  const imagePathname = '/' + req.params.path.join('/');
  const imagePath =
    imagePathname + (queryIndex === -1 ? '' : req.url.slice(queryIndex));

  if (
    imagePath.length > maxProxyImagePathLength ||
    imagePathname.startsWith('//') ||
    imagePathname.includes('://')
  ) {
    logger.error('Invalid URL for image proxy', { imagePath });
    return res.status(403).send('Invalid URL for image proxy');
  }

  try {
    let imageData;
    if (req.params.type === 'tmdb') {
      imageData = await initTmdbImageProxy().getImage(imagePath);
    } else if (req.params.type === 'tvdb') {
      imageData = await initTvdbImageProxy().getImage(imagePath);
    } else if (req.params.type === 'coverartarchive') {
      imageData = await initCoverArtArchiveImageProxy().getImage(imagePath);
    } else if (req.params.type === 'archiveorg') {
      imageData = await initArchiveOrgImageProxy().getImage(imagePath);
    } else if (req.params.type === 'theaudiodb') {
      imageData = await initTheAudioDbImageProxy().getImage(imagePath);
    } else if (req.params.type === 'openlibrarycovers') {
      imageData = await initOpenLibraryCoversImageProxy().getImage(imagePath);
    } else {
      logger.error('Unsupported image type', {
        imagePath,
        type: req.params.type,
      });
      res.status(400).send('Unsupported image type');
      return;
    }

    const etag = `"${imageData.meta.etag}"`;
    const browserCacheHeaders = getBrowserImageResponseHeaders({
      cacheKey: imageData.meta.cacheKey,
      cacheMiss: imageData.meta.cacheMiss,
      etag,
      lastModified: imageData.meta.lastModified,
      maxAge: imageData.meta.curRevalidate,
    });

    if (
      shouldSendBrowserImageNotModified({
        etag,
        ifModifiedSince: req.headers['if-modified-since'],
        ifNoneMatch: req.headers['if-none-match'],
        lastModified: imageData.meta.lastModified,
      })
    ) {
      return res.status(304).set(browserCacheHeaders).end();
    }

    await sendImage(res, imageData, {
      'Content-Type': getImageResponseContentType(imageData.meta.extension),
      ...browserCacheHeaders,
    });
  } catch (e) {
    logger.error('Failed to proxy image', {
      imagePath,
      errorMessage: e.message,
    });
    res.status(500).send();
  }
});

router.post('/warm', warmRateLimit, (req, res) => {
  if (!Array.isArray(req.body?.urls)) {
    return res.status(400).json({ error: 'urls must be an array.' });
  }

  if (req.body.urls.length > maxWarmRequestUrls) {
    return res
      .status(400)
      .json({ error: `urls are limited to ${maxWarmRequestUrls} values.` });
  }

  const urls: string[] = [];
  for (const url of req.body.urls) {
    if (typeof url !== 'string') {
      return res.status(400).json({ error: 'urls must contain strings.' });
    }

    if (url.length > maxWarmUrlLength) {
      return res.status(400).json({
        error: `urls must be ${maxWarmUrlLength} characters or fewer.`,
      });
    }

    urls.push(url);
  }

  enqueueImageCacheWarm(urls);

  return res.status(202).json({ accepted: true });
});

export default router;
