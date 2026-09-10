import {
  TMDB_POSTER_BASE_SIZE,
  TMDB_POSTER_WIDTHS,
} from '@server/constants/images';

export type CacheableImageType = 'tmdb' | 'avatar' | 'tvdb' | 'music' | 'book';

export const AVATAR_FALLBACK_IMAGE = '/user-icon-192x192.png';

export const isResolvedImageUrl = (src?: string): boolean =>
  !!src &&
  (src.startsWith('http') ||
    src.startsWith('/images/') ||
    src.startsWith('/api/') ||
    src.startsWith('/imageproxy/'));

export function getTmdbPosterImageUrl(
  posterPath: string,
  size?: string
): string;
export function getTmdbPosterImageUrl(
  posterPath?: string,
  size?: string
): string | undefined;
export function getTmdbPosterImageUrl(
  posterPath?: string,
  size = TMDB_POSTER_BASE_SIZE
): string | undefined {
  if (!posterPath) {
    return undefined;
  }

  return isResolvedImageUrl(posterPath)
    ? posterPath
    : `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// Only explicitly generated sizes of the same uncropped TMDB poster are
// interchangeable. Already resolved artwork may use a different provider,
// edition, or crop and must retain its exact URL.
export const getTmdbPosterImageVariants = (
  posterPath?: string
): readonly { src: string; width: number }[] | undefined =>
  posterPath && !isResolvedImageUrl(posterPath)
    ? TMDB_POSTER_WIDTHS.map((width) => ({
        src: getTmdbPosterImageUrl(posterPath, `w${width}`),
        width,
      }))
    : undefined;

export const getInitialImageUrl = (
  type: CacheableImageType,
  imageUrl: string
): string => (type === 'avatar' ? AVATAR_FALLBACK_IMAGE : imageUrl);

export const getImageErrorFallback = (
  type: CacheableImageType,
  currentSrc: string
): string | null =>
  type === 'avatar' && currentSrc !== AVATAR_FALLBACK_IMAGE
    ? AVATAR_FALLBACK_IMAGE
    : null;

const PROXIED_IMAGE_PREFIXES = {
  tmdb: {
    source: /^https:\/\/image\.tmdb\.org\//,
    target: '/imageproxy/tmdb/',
  },
  tvdb: {
    source: /^https:\/\/artworks\.thetvdb\.com\//,
    target: '/imageproxy/tvdb/',
  },
  musicCoverArtArchive: {
    source: /^https:\/\/coverartarchive\.org\//,
    target: '/imageproxy/coverartarchive/',
  },
  musicArchiveOrg: {
    source: /^https:\/\/archive\.org\//,
    target: '/imageproxy/archiveorg/',
  },
  musicTheAudioDb: {
    source: /^https:\/\/(?:www|r2)\.theaudiodb\.com\//,
    target: '/imageproxy/theaudiodb/',
  },
  book: {
    source: /^https:\/\/covers\.openlibrary\.org\//,
    target: '/imageproxy/openlibrarycovers/',
  },
};

const getProxiedImageUrl = (src: string): string | null => {
  for (const { source, target } of Object.values(PROXIED_IMAGE_PREFIXES)) {
    if (source.test(src)) {
      return src.replace(source, target);
    }
  }

  return null;
};

export const isRemoteAvatarCacheUrlAllowed = (src: string): boolean => {
  try {
    const avatarUrl = new URL(src);
    const hostname = avatarUrl.hostname.toLowerCase();

    return (
      avatarUrl.protocol === 'https:' &&
      !avatarUrl.username &&
      !avatarUrl.password &&
      (hostname === 'gravatar.com' ||
        hostname === 'secure.gravatar.com' ||
        hostname === 'www.gravatar.com' ||
        hostname.endsWith('.gravatar.com') ||
        hostname === 'plex.tv' ||
        hostname.endsWith('.plex.tv'))
    );
  } catch {
    return false;
  }
};

export const getImageCacheUrl = ({
  cacheImages,
  src,
  type,
}: {
  cacheImages: boolean;
  src: string;
  type: CacheableImageType;
}): string => {
  if (!cacheImages || src.startsWith('/')) {
    return src;
  }

  const proxiedImageUrl = getProxiedImageUrl(src);

  if (proxiedImageUrl) {
    return proxiedImageUrl;
  }

  if (type === 'tmdb') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.tmdb.source,
      PROXIED_IMAGE_PREFIXES.tmdb.target
    );
  }

  if (type === 'tvdb') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.tvdb.source,
      PROXIED_IMAGE_PREFIXES.tvdb.target
    );
  }

  if (type === 'music') {
    if (src.startsWith('https://coverartarchive.org/')) {
      return src.replace(
        PROXIED_IMAGE_PREFIXES.musicCoverArtArchive.source,
        PROXIED_IMAGE_PREFIXES.musicCoverArtArchive.target
      );
    }

    if (src.startsWith('https://archive.org/')) {
      return src.replace(
        PROXIED_IMAGE_PREFIXES.musicArchiveOrg.source,
        PROXIED_IMAGE_PREFIXES.musicArchiveOrg.target
      );
    }
  }

  if (type === 'book') {
    return src.replace(
      PROXIED_IMAGE_PREFIXES.book.source,
      PROXIED_IMAGE_PREFIXES.book.target
    );
  }

  if (type === 'avatar' && isRemoteAvatarCacheUrlAllowed(src)) {
    return `/avatarproxy/remote?url=${encodeURIComponent(src)}`;
  }

  return src;
};
