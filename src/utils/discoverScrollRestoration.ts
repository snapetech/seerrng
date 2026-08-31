export type RestorableDiscoverMediaType = 'movie' | 'tv' | 'book';

export type DiscoverScrollEntry = {
  path: string;
  scrollY: number;
  itemCount: number;
};

export const DISCOVER_SCROLL_HISTORY_KEY = '__seerrDiscoverScroll';

const detailPathPatterns: Record<RestorableDiscoverMediaType, RegExp> = {
  movie: /^\/movie\/[^/?#]+(?:[/?#]|$)/,
  tv: /^\/tv\/[^/?#]+(?:[/?#]|$)/,
  book: /^\/book\/[^/?#]+(?:[/?#]|$)/,
};

export const isMediaDetailPath = (
  url: string,
  mediaType: RestorableDiscoverMediaType
): boolean => {
  const path = url.startsWith('http') ? new URL(url).pathname : url;

  return detailPathPatterns[mediaType].test(path);
};

export const getDiscoverScrollEntry = (
  historyState: unknown,
  path: string
): DiscoverScrollEntry | undefined => {
  if (!historyState || typeof historyState !== 'object') {
    return undefined;
  }

  const entry = (historyState as Record<string, unknown>)[
    DISCOVER_SCROLL_HISTORY_KEY
  ];

  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const candidate = entry as Partial<DiscoverScrollEntry>;

  if (
    candidate.path !== path ||
    typeof candidate.scrollY !== 'number' ||
    !Number.isFinite(candidate.scrollY) ||
    candidate.scrollY < 0 ||
    typeof candidate.itemCount !== 'number' ||
    !Number.isInteger(candidate.itemCount) ||
    candidate.itemCount < 0
  ) {
    return undefined;
  }

  return candidate as DiscoverScrollEntry;
};

export const getScrollRestorationAction = ({
  entry,
  itemCount,
  isLoading,
  isReachingEnd,
}: {
  entry?: DiscoverScrollEntry;
  itemCount: number;
  isLoading: boolean;
  isReachingEnd: boolean;
}): 'none' | 'load-more' | 'restore' => {
  if (!entry) {
    return 'none';
  }

  if (itemCount >= entry.itemCount || isReachingEnd) {
    return 'restore';
  }

  return isLoading ? 'none' : 'load-more';
};
