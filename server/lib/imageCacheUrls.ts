type ImageWarmableRecord = {
  mediaType?: unknown;
  posterPath?: unknown;
  remotePoster?: unknown;
  backdropPath?: unknown;
  profilePath?: unknown;
  artistThumb?: unknown;
  artistBackdrop?: unknown;
};

const TMDB_POSTER_TYPES = new Set(['movie', 'tv', 'person', 'collection']);
const TMDB_BACKDROP_TYPES = new Set(['movie', 'tv', 'collection']);
const MAX_IMAGE_CACHE_URL_TRAVERSAL_DEPTH = 8;
const MAX_IMAGE_CACHE_URL_TRAVERSAL_NODES = 2000;
const MAX_EXTRACTED_IMAGE_CACHE_URLS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getTmdbImageUrl = (path: string, size: string): string =>
  `https://image.tmdb.org/t/p/${size}${path}`;

const normalizeExternalImageUrl = (path: unknown): string | null => {
  if (
    typeof path !== 'string' ||
    (!path.startsWith('http://') && !path.startsWith('https://'))
  ) {
    return null;
  }

  return path;
};

const getWarmableImageUrls = (item: ImageWarmableRecord): string[] => {
  const urls: (string | null)[] = [];
  const mediaType = typeof item.mediaType === 'string' ? item.mediaType : '';

  if (typeof item.posterPath === 'string') {
    const posterPath = item.posterPath;
    if (
      TMDB_POSTER_TYPES.has(mediaType) &&
      posterPath.startsWith('/') &&
      !['/api/', '/images/', '/imageproxy/'].some((prefix) =>
        posterPath.startsWith(prefix)
      )
    ) {
      urls.push(getTmdbImageUrl(posterPath, TMDB_POSTER_BASE_SIZE));
    } else {
      urls.push(normalizeExternalImageUrl(item.posterPath));
    }
  }

  urls.push(normalizeExternalImageUrl(item.remotePoster));

  if (
    typeof item.backdropPath === 'string' &&
    TMDB_BACKDROP_TYPES.has(mediaType) &&
    item.backdropPath.startsWith('/')
  ) {
    urls.push(getTmdbImageUrl(item.backdropPath, 'w1920_and_h800_multi_faces'));
  }

  if (typeof item.profilePath === 'string') {
    urls.push(
      item.profilePath.startsWith('/')
        ? getTmdbImageUrl(item.profilePath, 'w600_and_h900_bestv2')
        : normalizeExternalImageUrl(item.profilePath)
    );
  }

  urls.push(
    normalizeExternalImageUrl(item.artistThumb),
    normalizeExternalImageUrl(item.artistBackdrop)
  );

  return urls.filter((url): url is string => !!url);
};

export const extractImageCacheUrls = (body: unknown): string[] => {
  const urls = new Set<string>();
  const seen = new Set<unknown>();
  let visitedNodes = 0;

  const visit = (value: unknown, depth = 0) => {
    if (
      !value ||
      seen.has(value) ||
      depth > MAX_IMAGE_CACHE_URL_TRAVERSAL_DEPTH ||
      visitedNodes >= MAX_IMAGE_CACHE_URL_TRAVERSAL_NODES ||
      urls.size >= MAX_EXTRACTED_IMAGE_CACHE_URLS
    ) {
      return;
    }

    visitedNodes += 1;

    if (Array.isArray(value)) {
      seen.add(value);
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    seen.add(value);
    getWarmableImageUrls(value).forEach((url) => urls.add(url));
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };

  visit(body);

  return [...urls];
};
import { TMDB_POSTER_BASE_SIZE } from '@server/constants/images';
