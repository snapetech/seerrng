import BookFormatBadge from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import {
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { prepareFilterValues } from '@app/components/Discover/constants';
import useDiscover from '@app/hooks/useDiscover';
import { setSearchActivity } from '@app/hooks/useSearchActivity';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import {
  isConfiguredMediaCategoryEnabled,
  isOptionalCatalogPathEnabled,
} from '@app/utils/serviceAvailability';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type {
  AlbumResult,
  ArtistResult,
  AuthorResult,
  BookResult,
  ComicResult,
  MagazineResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import ContextualSearchFilters from './ContextualSearchFilters';
import {
  getSearchCategoryQuery,
  getSearchEndpoint,
  getSearchResultFilter,
  isSearchDataReady,
  matchesSearchResultFilter,
  searchContextualFilterKeys,
} from './searchFilters';
import {
  getSortField,
  getSortOrder,
  type SortField,
  type SortOrder,
} from './searchSort';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
  all: 'All',
  movies: 'Movies',
  series: 'Series',
  ebooks: 'Books',
  audiobooks: 'Audiobooks',
  music: 'Music',
  comics: 'Comics',
  magazines: 'Magazines',
  filter: 'Filters',
  mediaFilters: 'Media Filters',
  sortBy: 'Sort By',
  title: 'Title',
  author: 'Author',
  authors: 'Authors',
  artist: 'Artist',
  date: 'Date',
  publisher: 'Publisher',
  rating: 'Rating',
  writer: 'Writer',
  director: 'Director',
  ascending: 'Ascending',
  descending: 'Descending',
  showingFormat: 'Showing',
  noResultsFound: 'No Results Found',
  searchUnavailable: 'Search is unavailable right now.',
  searchUnavailableHint: 'The catalog could not be reached. Try again.',
  retrySearch: 'Try again',
  retryingSearch: 'Trying again…',
  clearFilters: 'Clear Filters',
});

const searchCategories = [
  { key: 'all', type: undefined, message: messages.all },
  { key: 'movie', type: 'movie', message: messages.movies },
  { key: 'tv', type: 'tv', message: messages.series },
  {
    key: 'book',
    type: 'book',
    format: 'ebook',
    message: messages.ebooks,
  },
  {
    key: 'audiobook',
    type: 'book',
    format: 'audiobook',
    message: messages.audiobooks,
  },
  { key: 'music', type: 'music', message: messages.music },
  { key: 'comic', type: 'comic', message: messages.comics },
  { key: 'magazine', type: 'magazine', message: messages.magazines },
  { key: 'author', type: 'author', message: messages.authors },
] as const;

type SearchCategory = (typeof searchCategories)[number];
type BookFormat = 'ebook' | 'audiobook';
type SearchResult =
  | MovieResult
  | TvResult
  | PersonResult
  | AlbumResult
  | ArtistResult
  | BookResult
  | AuthorResult
  | ComicResult
  | MagazineResult;

type SortOption = {
  field: SortField;
  message: (typeof messages)[keyof typeof messages];
  defaultOrder: SortOrder;
};

const sortOptionDefinitions: Record<SortField, SortOption> = {
  date: { field: 'date', message: messages.date, defaultOrder: 'desc' },
  title: { field: 'title', message: messages.title, defaultOrder: 'asc' },
  rating: { field: 'rating', message: messages.rating, defaultOrder: 'desc' },
  writer: { field: 'writer', message: messages.writer, defaultOrder: 'asc' },
  director: {
    field: 'director',
    message: messages.director,
    defaultOrder: 'asc',
  },
  artist: { field: 'artist', message: messages.artist, defaultOrder: 'asc' },
  author: { field: 'author', message: messages.author, defaultOrder: 'asc' },
  publisher: {
    field: 'publisher',
    message: messages.publisher,
    defaultOrder: 'asc',
  },
};

const sortFieldsByCategory: Record<
  SearchCategory['key'],
  readonly SortField[]
> = {
  all: ['date', 'title'],
  movie: ['date', 'title', 'rating', 'writer', 'director'],
  tv: ['date', 'title', 'rating', 'writer', 'director'],
  music: ['date', 'title', 'artist'],
  book: ['date', 'title', 'author', 'publisher'],
  audiobook: ['date', 'title', 'author', 'publisher'],
  author: ['title'],
  comic: ['date', 'title'],
  magazine: ['date', 'title'],
};

const getSearchCategory = (
  type: string | string[] | undefined,
  format: string | string[] | undefined
): SearchCategory => {
  if (type === 'book') {
    return format === 'audiobook'
      ? searchCategories.find((category) => category.key === 'audiobook')!
      : searchCategories.find((category) => category.key === 'book')!;
  }

  return (
    searchCategories.find(
      (category) =>
        category.type === type &&
        ('format' in category ? category.format === format : !format)
    ) ?? searchCategories[0]
  );
};

const matchesCategory = (result: SearchResult, category: SearchCategory) => {
  if (!category.type) {
    return true;
  }

  if (category.type === 'music') {
    return result.mediaType === 'album' || result.mediaType === 'artist';
  }

  return result.mediaType === category.type;
};

const getResultTitle = (result: SearchResult): string | undefined => {
  if (result.mediaType === 'tv') {
    return result.name;
  }

  if (
    result.mediaType === 'person' ||
    result.mediaType === 'artist' ||
    result.mediaType === 'author'
  ) {
    return result.name;
  }

  return result.title;
};

const getResultAuthor = (result: SearchResult): string | undefined => {
  if (result.mediaType === 'book') {
    return result.author;
  }

  return undefined;
};

const getResultArtist = (result: SearchResult): string | undefined => {
  if (result.mediaType === 'album') {
    return result['artist-credit']?.[0]?.name;
  }

  if (result.mediaType === 'artist') {
    return result.name;
  }

  return undefined;
};

const getResultDate = (result: SearchResult): number | undefined => {
  if (result.mediaType === 'magazine') {
    const issueDate = Date.parse(result.latestIssue ?? '');
    return Number.isFinite(issueDate) ? issueDate : undefined;
  }

  const value =
    result.mediaType === 'movie'
      ? result.releaseDate
      : result.mediaType === 'tv'
        ? result.firstAirDate
        : result.mediaType === 'album'
          ? (result.releaseDate ?? result['first-release-date'])
          : result.mediaType === 'book'
            ? result.firstPublishYear
            : result.mediaType === 'comic'
              ? result.startYear
              : undefined;
  const year =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.slice(0, 4))
        : undefined;

  return year !== undefined && Number.isFinite(year) ? year : undefined;
};

const getResultRating = (result: SearchResult): number | undefined =>
  result.mediaType === 'movie' || result.mediaType === 'tv'
    ? result.voteAverage
    : undefined;

const getResultCredit = (
  result: SearchResult,
  field: 'writer' | 'director'
): string | undefined => {
  if (result.mediaType !== 'movie' && result.mediaType !== 'tv') {
    return undefined;
  }

  return (field === 'writer' ? result.writers : result.directors)?.[0];
};

const compareOptional = <T,>(
  left: T | undefined,
  right: T | undefined,
  compare: (a: T, b: T) => number,
  order: SortOrder
) => {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }

  return compare(left, right) * (order === 'asc' ? 1 : -1);
};

const Search = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const query =
    typeof router.query.query === 'string' ? router.query.query.trim() : '';
  const requestedCategory = getSearchCategory(
    router.query.type,
    router.query.format
  );
  const visibleSearchCategories = searchCategories.filter((searchCategory) => {
    switch (searchCategory.key) {
      case 'movie':
        return isConfiguredMediaCategoryEnabled('movie', currentSettings);
      case 'tv':
        return isConfiguredMediaCategoryEnabled('tv', currentSettings);
      case 'book':
        return (
          currentSettings.booksEnabled &&
          isConfiguredMediaCategoryEnabled('ebook', currentSettings)
        );
      case 'audiobook':
        return (
          currentSettings.booksEnabled &&
          isConfiguredMediaCategoryEnabled('audiobook', currentSettings)
        );
      case 'author':
        return (
          currentSettings.booksEnabled &&
          (isConfiguredMediaCategoryEnabled('ebook', currentSettings) ||
            isConfiguredMediaCategoryEnabled('audiobook', currentSettings))
        );
      case 'music':
        return isOptionalCatalogPathEnabled('/discover/music', currentSettings);
      case 'comic':
        return isOptionalCatalogPathEnabled(
          '/discover/comics',
          currentSettings
        );
      case 'magazine':
        return isOptionalCatalogPathEnabled(
          '/discover/magazines',
          currentSettings
        );
      default:
        return true;
    }
  });
  const category = visibleSearchCategories.some(
    (searchCategory) => searchCategory.key === requestedCategory.key
  )
    ? requestedCategory
    : searchCategories[0];
  useEffect(() => {
    if (!router.isReady || category.key === requestedCategory.key) return;
    void router.replace(
      {
        pathname: router.pathname,
        query: { query: query || undefined },
      },
      undefined,
      { shallow: true, scroll: false }
    );
  }, [category.key, query, requestedCategory.key, router]);
  const preferredBookFormat =
    'format' in category ? (category.format as BookFormat) : undefined;
  const sortOptions = sortFieldsByCategory[category.key].map(
    (field) => sortOptionDefinitions[field]
  );
  const requestedSortField = getSortField(router.query.sort);
  const sortField = sortOptions.some(
    (option) => option.field === requestedSortField
  )
    ? requestedSortField
    : 'date';
  const sortOrder = getSortOrder(router.query.order, sortField);
  const getRoutedString = (key: string) => {
    const value = router.query[key];
    return typeof value === 'string' ? value : '';
  };
  const preparedVideoFilters = prepareFilterValues({
    ...router.query,
    search: query || undefined,
  });
  const resultFilter = getSearchResultFilter(router.query).trim();
  const searchEndpoint = getSearchEndpoint(category.key, query);
  const searchOptions = useMemo(
    () => {
      if (query) {
        return {
          query,
          ...(category.type ? { type: category.type } : {}),
          ...(preferredBookFormat ? { format: preferredBookFormat } : {}),
          ...(category.key === 'music' && resultFilter ? { resultFilter } : {}),
        };
      }

      if (category.key === 'movie' || category.key === 'tv') {
        return preparedVideoFilters;
      }

      if (category.key === 'music') {
        return {
          query,
          days: '14',
          sortBy: 'ranked',
          genre: getRoutedString('genre'),
          releaseType: getRoutedString('releaseType'),
          primaryReleaseDateGte: getRoutedString('primaryReleaseDateGte'),
          primaryReleaseDateLte: getRoutedString('primaryReleaseDateLte'),
        };
      }

      if (category.key === 'book' || category.key === 'audiobook') {
        return {
          query,
          subject: getRoutedString('subject'),
          firstPublishYear: getRoutedString('firstPublishYear'),
          language: getRoutedString('language'),
          minRating: getRoutedString('minRating'),
          sortBy: 'ranked',
          format: preferredBookFormat,
          responseVersion: 2,
        };
      }

      return { query };
    },
    // The router query is the source of truth for all contextual controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category.key, preferredBookFormat, query, router.query]
  );
  const isSearchReady = isSearchDataReady({
    routerReady: router.isReady,
    category: category.key,
    query,
  });
  const hasActiveFilters = Boolean(
    category.key !== 'all' ||
    router.query.sort ||
    router.query.order ||
    searchContextualFilterKeys.some((key) => router.query[key])
  );

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isValidating,
    isReachingEnd,
    titles,
    fetchMore,
    error,
    mutate,
  } = useDiscover<SearchResult>(searchEndpoint, searchOptions, {
    enabled: isSearchReady,
    hideAvailable: false,
    hideBlocklisted: true,
    showErrorToast: false,
    shouldRetryOnError: false,
  });
  useEffect(() => {
    setSearchActivity(isSearchReady && (isLoadingInitialData || isValidating));

    return () => setSearchActivity(false);
  }, [isLoadingInitialData, isSearchReady, isValidating]);
  const visibleTitles = useMemo(
    () =>
      titles
        .filter((title) => matchesCategory(title, category))
        .filter((title) =>
          matchesSearchResultFilter(
            [
              getResultTitle(title),
              getResultAuthor(title),
              getResultArtist(title),
              title.mediaType === 'book' ? title.publisher : undefined,
              title.mediaType === 'author' ? title.topWork : undefined,
              ...(title.mediaType === 'comic'
                ? [title.publisher, title.startYear, ...(title.aliases ?? [])]
                : []),
              title.mediaType === 'magazine' ? title.latestIssue : undefined,
            ],
            resultFilter
          )
        ),
    [category, resultFilter, titles]
  );
  const sortedTitles = useMemo(() => {
    const collator = new Intl.Collator(undefined, {
      sensitivity: 'base',
      numeric: true,
    });

    return [...visibleTitles].sort((left, right) => {
      if (sortField === 'date') {
        return compareOptional(
          getResultDate(left),
          getResultDate(right),
          (a, b) => a - b,
          sortOrder
        );
      }

      if (sortField === 'rating') {
        return compareOptional(
          getResultRating(left),
          getResultRating(right),
          (a, b) => a - b,
          sortOrder
        );
      }

      const leftValue =
        sortField === 'title'
          ? getResultTitle(left)
          : sortField === 'author'
            ? getResultAuthor(left)
            : sortField === 'artist'
              ? getResultArtist(left)
              : sortField === 'writer' || sortField === 'director'
                ? getResultCredit(left, sortField)
                : left.mediaType === 'book'
                  ? left.publisher
                  : undefined;
      const rightValue =
        sortField === 'title'
          ? getResultTitle(right)
          : sortField === 'author'
            ? getResultAuthor(right)
            : sortField === 'artist'
              ? getResultArtist(right)
              : sortField === 'writer' || sortField === 'director'
                ? getResultCredit(right, sortField)
                : right.mediaType === 'book'
                  ? right.publisher
                  : undefined;

      return compareOptional(
        leftValue,
        rightValue,
        (a, b) => collator.compare(a, b),
        sortOrder
      );
    });
  }, [sortField, sortOrder, visibleTitles]);
  const isShowingEmptyState =
    isSearchReady &&
    !isLoadingInitialData &&
    !isLoadingMore &&
    sortedTitles.length === 0;
  const providerErrorMessage = (
    error as { response?: { data?: { message?: string } } } | undefined
  )?.response?.data?.message;

  const searchError = error && (
    <div
      className="mt-6 flex flex-col items-start gap-4 rounded-xl border border-red-500/50 bg-red-500/10 p-6 text-red-100 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div>
        <p className="font-medium">
          {providerErrorMessage ??
            intl.formatMessage(messages.searchUnavailable)}
        </p>
        <p className="mt-1 text-sm text-red-100/80">
          {intl.formatMessage(messages.searchUnavailableHint)}
        </p>
      </div>
      <Button
        buttonType="warning"
        buttonSize="sm"
        disabled={isValidating}
        onClick={() => mutate?.()}
      >
        {intl.formatMessage(
          isValidating ? messages.retryingSearch : messages.retrySearch
        )}
      </Button>
    </div>
  );

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mb-5 flow-root">
        <Header
          subtext={
            preferredBookFormat ? (
              <span className="inline-flex items-center gap-2">
                <span>{intl.formatMessage(messages.showingFormat)}</span>
                <BookFormatBadge
                  format={preferredBookFormat}
                  variant="inline"
                />
              </span>
            ) : undefined
          }
        >
          {intl.formatMessage(messages.searchresults)}
        </Header>
      </div>
      <div className="app-filter-section-gap">
        <div className="mb-1 text-sm text-gray-300">
          {intl.formatMessage(messages.mediaFilters)}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={intl.formatMessage(messages.mediaFilters)}
        >
          {visibleSearchCategories.map((searchCategory) => {
            const isSelected = category.key === searchCategory.key;

            return (
              <button
                key={searchCategory.key}
                type="button"
                className={getFilterToggleButtonClass(isSelected)}
                aria-pressed={isSelected}
                onClick={() => {
                  const nextQuery = getSearchCategoryQuery(router.query, {
                    type: searchCategory.type,
                    format:
                      'format' in searchCategory
                        ? searchCategory.format
                        : undefined,
                  });

                  void router.replace(
                    { pathname: router.pathname, query: nextQuery },
                    undefined,
                    { shallow: true, scroll: false }
                  );
                }}
              >
                {intl.formatMessage(searchCategory.message)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="app-filter-section-gap">
        <div className="mb-1 text-sm text-gray-300">
          {intl.formatMessage(messages.filter)}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={intl.formatMessage(messages.filter)}
        >
          <button
            type="button"
            aria-pressed={!hasActiveFilters}
            className={getFilterResetButtonClass(!hasActiveFilters)}
            onClick={() => {
              void router.replace(
                {
                  pathname: router.pathname,
                  query: { query: query || undefined },
                },
                undefined,
                { shallow: true, scroll: false }
              );
            }}
          >
            {intl.formatMessage(messages.clearFilters)}
          </button>
          <CardTextVisibilityToggle
            mediaType={['movie', 'tv', 'album', 'book']}
          />
          <ContextualSearchFilters category={category.key} />
        </div>
      </div>
      <div className="app-filter-section-gap">
        <div className="mb-1 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sortOptions.map((sortOption) => {
            const isSelected = sortField === sortOption.field;
            const displayedOrder = isSelected
              ? sortOrder
              : sortOption.defaultOrder;
            const directionLabel = intl.formatMessage(
              displayedOrder === 'asc'
                ? messages.ascending
                : messages.descending
            );
            const SortDirectionIcon =
              displayedOrder === 'asc' ? BarsArrowUpIcon : BarsArrowDownIcon;

            return (
              <Tooltip key={sortOption.field} content={directionLabel}>
                <button
                  type="button"
                  className={getFilterToggleButtonClass(isSelected)}
                  aria-pressed={isSelected}
                  aria-label={`${intl.formatMessage(
                    sortOption.message
                  )}: ${directionLabel}`}
                  onClick={() => {
                    const nextOrder = isSelected
                      ? sortOrder === 'asc'
                        ? 'desc'
                        : 'asc'
                      : sortOption.defaultOrder;

                    void router.replace(
                      {
                        pathname: router.pathname,
                        query: {
                          ...router.query,
                          sort: sortOption.field,
                          order: nextOrder,
                        },
                      },
                      undefined,
                      { shallow: true, scroll: false }
                    );
                  }}
                >
                  {intl.formatMessage(sortOption.message)}
                  <SortDirectionIcon className="h-4 w-4 flex-shrink-0" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      {error && sortedTitles.length === 0 ? (
        searchError
      ) : (
        <>
          {error && searchError}
          <ListView
            items={sortedTitles}
            preferredBookFormat={preferredBookFormat}
            emptyMessage={intl.formatMessage(messages.noResultsFound)}
            emptyClassName="mt-6"
            isEmpty={isShowingEmptyState || (isSearchReady && isEmpty)}
            isLoading={
              !router.isReady ||
              (isSearchReady &&
                (isLoadingInitialData ||
                  (isLoadingMore && (titles?.length ?? 0) > 0)))
            }
            isReachingEnd={isReachingEnd}
            onScrollBottom={fetchMore}
          />
        </>
      )}
    </>
  );
};

export default Search;
