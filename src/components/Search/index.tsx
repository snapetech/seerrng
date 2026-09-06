import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import { setSearchActivity } from '@app/hooks/useSearchActivity';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type {
  AlbumResult,
  ArtistResult,
  BookResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
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
  books: 'Books',
  audiobooks: 'Audiobooks',
  music: 'Music',
  filter: 'Filter',
  sortBy: 'Sort by',
  title: 'Title',
  author: 'Author',
  artist: 'Artist',
  date: 'Date',
  publisher: 'Publisher',
  rating: 'Rating',
  writer: 'Writer',
  director: 'Director',
  ascending: 'Ascending',
  descending: 'Descending',
  noResultsFound: 'No Results Found',
});

const searchCategories = [
  { key: 'all', type: undefined, message: messages.all },
  { key: 'movie', type: 'movie', message: messages.movies },
  { key: 'tv', type: 'tv', message: messages.series },
  {
    key: 'book',
    type: 'book',
    format: 'ebook',
    message: messages.books,
  },
  {
    key: 'audiobook',
    type: 'book',
    format: 'audiobook',
    message: messages.audiobooks,
  },
  { key: 'music', type: 'music', message: messages.music },
] as const;

type SearchCategory = (typeof searchCategories)[number];
type SearchType = Exclude<SearchCategory['type'], undefined>;
type BookFormat = 'ebook' | 'audiobook';
type SearchResult =
  | MovieResult
  | TvResult
  | PersonResult
  | AlbumResult
  | ArtistResult
  | BookResult;

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

  if (result.mediaType === 'person' || result.mediaType === 'artist') {
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
  const value =
    result.mediaType === 'movie'
      ? result.releaseDate
      : result.mediaType === 'tv'
        ? result.firstAirDate
        : result.mediaType === 'album'
          ? (result.releaseDate ?? result['first-release-date'])
          : result.mediaType === 'book'
            ? result.firstPublishYear
            : undefined;
  const year = typeof value === 'number' ? value : Number(value?.slice(0, 4));

  return Number.isFinite(year) ? year : undefined;
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
  const query =
    typeof router.query.query === 'string' ? router.query.query.trim() : '';
  const category = getSearchCategory(router.query.type, router.query.format);
  const type = category.type as SearchType | undefined;
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
  const searchOptions = useMemo(
    () => ({
      query,
      ...(type ? { type } : {}),
      ...(preferredBookFormat ? { format: preferredBookFormat } : {}),
    }),
    [preferredBookFormat, query, type]
  );
  const isSearchReady = router.isReady && !!query;

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isValidating,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<SearchResult>(`/api/v1/search`, searchOptions, {
    enabled: isSearchReady,
    hideAvailable: false,
    hideBlocklisted: false,
    showErrorToast: false,
    shouldRetryOnError: false,
  });
  useEffect(() => {
    setSearchActivity(isSearchReady && (isLoadingInitialData || isValidating));

    return () => setSearchActivity(false);
  }, [isLoadingInitialData, isSearchReady, isValidating]);
  const visibleTitles = useMemo(
    () =>
      error ? [] : titles.filter((title) => matchesCategory(title, category)),
    [category, error, titles]
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
    (Boolean(error) || sortedTitles.length === 0);

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
      </div>
      <div className="mb-6">
        <div className="mb-1 text-sm text-gray-300">
          {intl.formatMessage(messages.filter)}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={intl.formatMessage(messages.filter)}
        >
          <CardTextVisibilityToggle
            mediaType={['movie', 'tv', 'album', 'book']}
          />
          {searchCategories.map((searchCategory) => {
            const isSelected = category.key === searchCategory.key;

            return (
              <Button
                key={searchCategory.key}
                className="w-[104px] px-2"
                buttonSize="sm"
                buttonType={isSelected ? 'primary' : 'default'}
                aria-pressed={isSelected}
                onClick={() => {
                  const nextQuery = { ...router.query };

                  delete nextQuery.format;

                  if (searchCategory.type) {
                    nextQuery.type = searchCategory.type;
                  } else {
                    delete nextQuery.type;
                  }

                  if ('format' in searchCategory) {
                    nextQuery.format = searchCategory.format;
                  }

                  void router.replace(
                    { pathname: router.pathname, query: nextQuery },
                    undefined,
                    { shallow: true, scroll: false }
                  );
                }}
              >
                {intl.formatMessage(searchCategory.message)}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="mb-6">
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
              <Button
                key={sortOption.field}
                className="w-[104px] px-2"
                buttonSize="sm"
                buttonType={isSelected ? 'primary' : 'default'}
                aria-pressed={isSelected}
                aria-label={`${intl.formatMessage(
                  sortOption.message
                )}: ${directionLabel}`}
                title={directionLabel}
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
                <span className="flex items-center gap-2">
                  {intl.formatMessage(sortOption.message)}
                  <SortDirectionIcon className="h-4 w-4 flex-shrink-0" />
                </span>
              </Button>
            );
          })}
        </div>
      </div>
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
  );
};

export default Search;
