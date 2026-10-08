import type { ParsedUrlQuery } from 'querystring';

export type SearchFilterCategory =
  | 'all'
  | 'movie'
  | 'tv'
  | 'book'
  | 'audiobook'
  | 'music'
  | 'author'
  | 'comic'
  | 'magazine'
  | 'sports'
  | 'software';

export const searchContextualFilterKeys = [
  'artist',
  'artistId',
  'availability',
  'certification',
  'certificationCountry',
  'certificationGte',
  'certificationLte',
  'certificationMode',
  'country',
  'excludeKeywords',
  'firstAirDateGte',
  'firstAirDateLte',
  'firstPublishYear',
  'genre',
  'language',
  'keywords',
  'minRating',
  'network',
  'narrator',
  'primaryReleaseDateGte',
  'primaryReleaseDateLte',
  'releaseType',
  'resultFilter',
  'search',
  'sortBy',
  'status',
  'studio',
  'subject',
  'voteAverageGte',
  'voteAverageLte',
  'watchProviders',
  'watchRegion',
  'withRuntimeGte',
  'withRuntimeLte',
] as const;

export const matchesSearchResultFilter = (
  values: (string | undefined)[],
  filter: string
): boolean => {
  const normalizedFilter = filter.trim().toLocaleLowerCase();

  if (!normalizedFilter) {
    return true;
  }

  return values.some((value) =>
    value?.toLocaleLowerCase().includes(normalizedFilter)
  );
};

export const getSearchResultFilter = (query: ParsedUrlQuery): string =>
  typeof query.resultFilter === 'string' ? query.resultFilter : '';

export const getMusicSearchParams = (query: ParsedUrlQuery) =>
  Object.fromEntries(
    [
      'artist',
      'artistId',
      'genre',
      'releaseType',
      'primaryReleaseDateGte',
      'primaryReleaseDateLte',
    ].flatMap((key) =>
      typeof query[key] === 'string' && query[key] ? [[key, query[key]]] : []
    )
  ) as Record<string, string>;

export const getSearchEndpoint = (
  category: SearchFilterCategory,
  mainQuery = '',
  hasContextualFilters = false
): string => {
  if (category === 'sports') {
    return '/api/v1/discover/sports';
  }

  // Scoped discovery routes accept catalogue constraints alongside the main
  // keyword. Use combined search only when no contextual constraints are set.
  if (mainQuery.trim() && !hasContextualFilters) {
    return '/api/v1/search';
  }

  if (category === 'movie') {
    return '/api/v1/discover/movies';
  }

  if (category === 'tv') {
    return '/api/v1/discover/tv';
  }

  if (category === 'music') {
    return '/api/v1/discover/music';
  }

  if (category === 'book' || category === 'audiobook') {
    return '/api/v1/discover/books';
  }

  return '/api/v1/search';
};

export const isSearchDataReady = ({
  routerReady,
  category,
  query,
}: {
  routerReady: boolean;
  category: SearchFilterCategory;
  query: string;
}): boolean =>
  routerReady &&
  category !== 'software' &&
  (category === 'all' ||
  category === 'author' ||
  category === 'comic' ||
  category === 'magazine' ||
  category === 'sports'
    ? Boolean(query)
    : true);

export const getSearchCategoryQuery = (
  currentQuery: ParsedUrlQuery,
  category: { type?: string; format?: 'ebook' | 'audiobook' }
): ParsedUrlQuery => {
  const nextQuery = { ...currentQuery };

  searchContextualFilterKeys.forEach((key) => {
    delete nextQuery[key];
  });
  delete nextQuery.format;
  delete nextQuery.order;
  delete nextQuery.sort;

  if (category.type) {
    nextQuery.type = category.type;
  } else {
    delete nextQuery.type;
  }

  if (category.format) {
    nextQuery.format = category.format;
  }

  return nextQuery;
};
