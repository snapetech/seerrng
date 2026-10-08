import BookFormatBadge from '@app/components/Common/BookFormatBadge';
import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import {
  FilterResetButton,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import MediaFilterOption from '@app/components/Discover/MediaFilterOption';
import PinnedFilterSection from '@app/components/Discover/PinnedFilterSection';
import { prepareFilterValues } from '@app/components/Discover/constants';
import SoftwareCatalog from '@app/components/SoftwareCatalog';
import useDiscover from '@app/hooks/useDiscover';
import useMediaFilterPin from '@app/hooks/useMediaFilterPin';
import { setSearchActivity } from '@app/hooks/useSearchActivity';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import {
  isAnySoftwareCategoryEnabled,
  isConfiguredMediaCategoryEnabled,
  isOptionalCatalogPathEnabled,
} from '@app/utils/serviceAvailability';
import { stableSearchResults } from '@app/utils/stableSearchResults';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type { DetailDisclosureMediaType } from '@server/interfaces/api/userSettingsInterfaces';
import type {
  AlbumResult,
  ArtistResult,
  AuthorResult,
  BookResult,
  ComicResult,
  MagazineResult,
  MovieResult,
  PersonResult,
  SportarrResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
import { useIntl } from 'react-intl';
import ContextualSearchFilters from './ContextualSearchFilters';
import SoftwareSearchPreview from './SoftwareSearchPreview';
import {
  getMusicSearchParams,
  getSearchCategoryQuery,
  getSearchEndpoint,
  getSearchResultFilter,
  isSearchDataReady,
  matchesSearchResultFilter,
  searchContextualFilterKeys,
} from './searchFilters';
import {
  getBookSearchRelevance,
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
  sports: 'Sports',
  software: 'Software',
  filter: 'Filters',
  mediaFilters: 'Media Filters',
  sortBy: 'Sort By',
  relevance: 'Best Match',
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
  { key: 'sports', type: 'sports', message: messages.sports },
  { key: 'software', type: 'software', message: messages.software },
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
  | MagazineResult
  | SportarrResult;

const getSearchResultKey = (result: SearchResult) =>
  `${result.mediaType}:${result.id}`;

type SortOption = {
  field: SortField;
  message: (typeof messages)[keyof typeof messages];
  defaultOrder: SortOrder;
};

const sortOptionDefinitions: Record<SortField, SortOption> = {
  relevance: {
    field: 'relevance',
    message: messages.relevance,
    defaultOrder: 'desc',
  },
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
  book: ['relevance', 'date', 'title', 'author', 'publisher'],
  audiobook: ['relevance', 'date', 'title', 'author', 'publisher'],
  author: ['title'],
  comic: ['date', 'title'],
  magazine: ['date', 'title'],
  sports: ['date', 'title'],
  software: [],
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

  if (category.type === 'software') return false;

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

  if (result.mediaType === 'sports') {
    return result.year;
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
  const hasRoutedSearchParams = Object.keys(router.query).length > 0;
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
        return isOptionalCatalogPathEnabled('/discover/books', currentSettings);
      case 'audiobook':
        return isOptionalCatalogPathEnabled(
          '/discover/audiobooks',
          currentSettings
        );
      case 'author':
        return isOptionalCatalogPathEnabled('/author/', currentSettings);
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
      case 'sports':
        return isOptionalCatalogPathEnabled(
          '/discover/sports',
          currentSettings
        );
      case 'software':
        return isAnySoftwareCategoryEnabled(currentSettings);
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
  const filterMediaType: DetailDisclosureMediaType =
    category.key === 'tv'
      ? 'tv'
      : category.key === 'music'
        ? 'music'
        : category.key === 'book' || category.key === 'audiobook'
          ? 'book'
          : category.key === 'sports'
            ? 'tv'
            : 'movie';
  const mediaPin = useMediaFilterPin<SearchCategory['key']>({
    scope: 'search',
    selected: category.key,
    values: visibleSearchCategories.map((item) => item.key),
    ready: router.isReady,
    explicit: Boolean(router.query.type || router.query.format),
    restore: (value) => {
      const target = visibleSearchCategories.find(
        (item) => item.key === value
      )!;
      void router.replace(
        {
          pathname: router.pathname,
          query: getSearchCategoryQuery(router.query, {
            type: target.type,
            format: 'format' in target ? target.format : undefined,
          }),
        },
        undefined,
        { shallow: true, scroll: false }
      );
    },
  });
  const preferredBookFormat =
    'format' in category ? (category.format as BookFormat) : undefined;
  const sortOptions = sortFieldsByCategory[category.key].map(
    (field) => sortOptionDefinitions[field]
  );
  const requestedSortField = getSortField(router.query.sort);
  const sortField =
    !router.query.sort &&
    (category.key === 'book' || category.key === 'audiobook')
      ? 'relevance'
      : sortOptions.some((option) => option.field === requestedSortField)
        ? requestedSortField
        : 'date';
  const sortOrder = getSortOrder(router.query.order, sortField);
  const getRoutedString = (key: string) => {
    const value = router.query[key];
    return typeof value === 'string' ? value : '';
  };
  const resultFilter = getSearchResultFilter(router.query).trim();
  const combinedQuery = [query, resultFilter].filter(Boolean).join(' ');
  const preparedVideoFilters = prepareFilterValues(
    category.key === 'movie' || category.key === 'tv'
      ? { ...router.query, search: combinedQuery || undefined }
      : { search: combinedQuery || undefined }
  );
  const searchEndpoint = getSearchEndpoint(
    category.key,
    query,
    searchContextualFilterKeys.some((key) => Boolean(router.query[key]))
  );
  const searchOptions = useMemo(
    () => {
      if (searchEndpoint === '/api/v1/search') {
        return {
          query: category.key === 'all' ? combinedQuery : query,
          ...(category.type ? { type: category.type } : {}),
          ...(preferredBookFormat ? { format: preferredBookFormat } : {}),
          ...(category.key === 'music' && resultFilter ? { resultFilter } : {}),
          ...(category.key === 'music'
            ? getMusicSearchParams(router.query)
            : {}),
        };
      }

      if (category.key === 'movie' || category.key === 'tv') {
        return preparedVideoFilters;
      }

      if (category.key === 'music') {
        return {
          query: combinedQuery,
          availability: getRoutedString('availability') || undefined,
          days: '14',
          sortBy: 'ranked',
          genre: getRoutedString('genre'),
          releaseType: getRoutedString('releaseType'),
          primaryReleaseDateGte: getRoutedString('primaryReleaseDateGte'),
          primaryReleaseDateLte: getRoutedString('primaryReleaseDateLte'),
          artist: getRoutedString('artist'),
          artistId: getRoutedString('artistId'),
        };
      }

      if (category.key === 'book' || category.key === 'audiobook') {
        return {
          query: combinedQuery,
          author: getRoutedString('author'),
          narrator:
            category.key === 'audiobook'
              ? getRoutedString('narrator')
              : undefined,
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
    query: combinedQuery,
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
    availableQuality:
      category.key === 'music'
        ? router.query.availability === 'mp3' ||
          router.query.availability === 'flac'
          ? router.query.availability
          : undefined
        : category.key === 'movie' || category.key === 'tv'
          ? preparedVideoFilters.availability
          : undefined,
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
              title.mediaType === 'book'
                ? title.narrators?.join(' ')
                : undefined,
              title.mediaType === 'book'
                ? title.subjects?.join(' ')
                : undefined,
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
      if (sortField === 'relevance') {
        const score = (result: SearchResult) => {
          if (result.mediaType !== 'book') return 0;
          return getBookSearchRelevance(result.title, query);
        };
        return (score(right) - score(left)) * (sortOrder === 'desc' ? 1 : -1);
      }
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
  }, [query, sortField, sortOrder, visibleTitles]);
  const orderKey = `${router.asPath}|${searchEndpoint}|${sortField}:${sortOrder}`;
  const previousOrder = useRef<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  const stableTitles = useMemo(
    () =>
      previousOrder.current.key === orderKey
        ? stableSearchResults(
            sortedTitles,
            previousOrder.current.ids,
            getSearchResultKey
          )
        : sortedTitles,
    [orderKey, sortedTitles]
  );
  useEffect(() => {
    if (stableTitles.length > 0 || previousOrder.current.key !== orderKey) {
      previousOrder.current = {
        key: orderKey,
        ids: stableTitles.map(getSearchResultKey),
      };
    }
  }, [orderKey, stableTitles]);
  const isShowingEmptyState =
    isSearchReady &&
    !isLoadingInitialData &&
    !isLoadingMore &&
    isReachingEnd &&
    stableTitles.length === 0;
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
      <div>
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
      <PinnedFilterSection
        mediaType={filterMediaType}
        section="mediaFilters"
        label={intl.formatMessage(messages.mediaFilters)}
      >
        <div
          className="app-filter-row"
          aria-label={intl.formatMessage(messages.mediaFilters)}
        >
          {visibleSearchCategories.map((searchCategory) => {
            const isSelected = category.key === searchCategory.key;

            return (
              <MediaFilterOption
                key={searchCategory.key}
                pin={mediaPin}
                value={searchCategory.key}
                label={intl.formatMessage(searchCategory.message)}
                selected={isSelected}
              >
                <button
                  type="button"
                  className="app-control-shadow-exempt app-filter-segment-focus"
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
              </MediaFilterOption>
            );
          })}
        </div>
      </PinnedFilterSection>
      {category.key !== 'software' && (
        <PinnedFilterSection
          mediaType={filterMediaType}
          section="filters"
          label={intl.formatMessage(messages.filter)}
        >
          <div
            className="app-filter-row"
            aria-label={intl.formatMessage(messages.filter)}
          >
            <FilterResetButton
              label={intl.formatMessage(messages.clearFilters)}
              selected={!hasActiveFilters}
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
            />
            <CardTextVisibilityToggle
              mediaType={['movie', 'tv', 'album', 'book']}
            />
            <ContextualSearchFilters category={category.key} />
          </div>
        </PinnedFilterSection>
      )}
      {category.key !== 'software' && (
        <PinnedFilterSection
          mediaType={filterMediaType}
          section="sortBy"
          label={intl.formatMessage(messages.sortBy)}
        >
          <div className="app-filter-row">
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
                    <SortDirectionIcon />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </PinnedFilterSection>
      )}
      {category.key === 'software' ? (
        <SoftwareCatalog externalQuery={query} embedded />
      ) : error && stableTitles.length === 0 ? (
        searchError
      ) : (
        <>
          {error && searchError}
          {category.key === 'all' && query && (
            <SoftwareSearchPreview query={query} />
          )}
          <ListView
            items={stableTitles}
            preferredBookFormat={preferredBookFormat}
            emptyMessage={intl.formatMessage(messages.noResultsFound)}
            emptyClassName="mt-6"
            isEmpty={isShowingEmptyState || (isSearchReady && isEmpty)}
            isLoading={
              (!router.isReady && hasRoutedSearchParams) ||
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
