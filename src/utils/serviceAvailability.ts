import type { MediaCategoryKey } from '@server/constants/mediaCategories';

export interface OptionalServiceAvailability {
  musicEnabled: boolean;
  booksEnabled: boolean;
  comicsEnabled: boolean;
  magazinesEnabled?: boolean;
  softwareEnabled?: boolean;
  romarrEnabled?: boolean;
  enabledMediaCategories?: Partial<Record<MediaCategoryKey, boolean>>;
}

export const DISCOVER_MEDIA_TYPES = [
  'movie',
  'tv',
  'music',
  'book',
  'audiobook',
] as const;

export type DiscoverMediaType = (typeof DISCOVER_MEDIA_TYPES)[number];

export const DISCOVER_WATCHLIST_TYPES = [
  'movie',
  'tv',
  'music',
  'book',
  'comic',
  'magazine',
] as const;

export type DiscoverWatchlistType = (typeof DISCOVER_WATCHLIST_TYPES)[number];

export const isConfiguredMediaCategoryEnabled = (
  category: MediaCategoryKey,
  availability: Pick<OptionalServiceAvailability, 'enabledMediaCategories'>
): boolean => availability.enabledMediaCategories?.[category] !== false;

export const isDiscoverMediaTypeEnabled = (
  type: DiscoverMediaType,
  availability: OptionalServiceAvailability
): boolean => {
  switch (type) {
    case 'movie':
      return isConfiguredMediaCategoryEnabled('movie', availability);
    case 'tv':
      return isConfiguredMediaCategoryEnabled('tv', availability);
    case 'music':
      return (
        availability.musicEnabled &&
        isConfiguredMediaCategoryEnabled('music', availability)
      );
    case 'book':
      return (
        availability.booksEnabled &&
        isConfiguredMediaCategoryEnabled('ebook', availability)
      );
    case 'audiobook':
      return (
        availability.booksEnabled &&
        isConfiguredMediaCategoryEnabled('audiobook', availability)
      );
  }
};

export const isDiscoverWatchlistTypeEnabled = (
  type: DiscoverWatchlistType,
  availability: OptionalServiceAvailability
): boolean => {
  switch (type) {
    case 'movie':
      return isConfiguredMediaCategoryEnabled('movie', availability);
    case 'tv':
      return isConfiguredMediaCategoryEnabled('tv', availability);
    case 'music':
      return isConfiguredMediaCategoryEnabled('music', availability);
    case 'book':
      return (
        isConfiguredMediaCategoryEnabled('ebook', availability) ||
        isConfiguredMediaCategoryEnabled('audiobook', availability)
      );
    case 'comic':
      return isConfiguredMediaCategoryEnabled('comic', availability);
    case 'magazine':
      return isConfiguredMediaCategoryEnabled('magazine', availability);
  }
};

export const isAnySoftwareCategoryEnabled = (
  availability: OptionalServiceAvailability
): boolean =>
  Boolean(
    availability.softwareEnabled &&
    (isConfiguredMediaCategoryEnabled('game', availability) ||
      (availability.romarrEnabled !== false &&
        (isConfiguredMediaCategoryEnabled('retro', availability) ||
          isConfiguredMediaCategoryEnabled('modern', availability))))
  );

export const isOptionalCatalogPathEnabled = (
  path: string,
  availability: OptionalServiceAvailability
): boolean => {
  if (
    path === '/discover/movies' ||
    path.startsWith('/discover/movies/') ||
    path.startsWith('/movie/')
  ) {
    return isConfiguredMediaCategoryEnabled('movie', availability);
  }

  if (
    path === '/discover/tv' ||
    path.startsWith('/discover/tv/') ||
    path.startsWith('/tv/') ||
    path.startsWith('/series/')
  ) {
    return isConfiguredMediaCategoryEnabled('tv', availability);
  }

  if (
    path === '/discover/music' ||
    path.startsWith('/discover/music/') ||
    path.startsWith('/music/') ||
    path.startsWith('/artist/')
  ) {
    return (
      availability.musicEnabled &&
      isConfiguredMediaCategoryEnabled('music', availability)
    );
  }

  if (
    path === '/discover/comics' ||
    path.startsWith('/discover/comics/') ||
    path.startsWith('/comic/')
  ) {
    return (
      availability.comicsEnabled &&
      isConfiguredMediaCategoryEnabled('comic', availability)
    );
  }

  if (
    path === '/discover/magazines' ||
    path.startsWith('/discover/magazines/') ||
    path.startsWith('/magazine/')
  ) {
    return (
      Boolean(availability.magazinesEnabled) &&
      isConfiguredMediaCategoryEnabled('magazine', availability)
    );
  }

  if (path === '/discover/audiobooks') {
    return (
      availability.booksEnabled &&
      isConfiguredMediaCategoryEnabled('audiobook', availability)
    );
  }

  if (path === '/discover/books') {
    return (
      availability.booksEnabled &&
      (isConfiguredMediaCategoryEnabled('ebook', availability) ||
        isConfiguredMediaCategoryEnabled('audiobook', availability))
    );
  }

  if (path.startsWith('/book/') || path.startsWith('/author/')) {
    return (
      availability.booksEnabled &&
      (isConfiguredMediaCategoryEnabled('ebook', availability) ||
        isConfiguredMediaCategoryEnabled('audiobook', availability))
    );
  }

  if (path === '/software') {
    return isAnySoftwareCategoryEnabled(availability);
  }

  return true;
};
