import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  AlbumResult,
  ArtistResult,
  BookResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
  all: 'All',
  movies: 'Movies',
  series: 'Series',
  books: 'Books',
  audiobooks: 'Audiobooks',
  music: 'Music',
  people: 'People',
  sortBy: 'Sort by',
  relevance: 'Relevance',
  title: 'Title',
  author: 'Author',
  date: 'Date',
  publisher: 'Publisher',
  order: 'Order',
  ascending: 'Ascending',
  descending: 'Descending',
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
  { key: 'person', type: 'person', message: messages.people },
] as const;

type SearchCategory = (typeof searchCategories)[number];
type SearchType = Exclude<SearchCategory['type'], undefined>;
type BookFormat = 'ebook' | 'audiobook';
type SortField = 'relevance' | 'title' | 'author' | 'date' | 'publisher';
type SortOrder = 'asc' | 'desc';
type SearchResult =
  | MovieResult
  | TvResult
  | PersonResult
  | AlbumResult
  | ArtistResult
  | BookResult;

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

const getSortField = (value: string | string[] | undefined): SortField =>
  value === 'title' ||
  value === 'author' ||
  value === 'date' ||
  value === 'publisher'
    ? value
    : 'relevance';

const getSortOrder = (value: string | string[] | undefined): SortOrder =>
  value === 'desc' ? 'desc' : 'asc';

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

  if (result.mediaType === 'album') {
    return result['artist-credit']?.[0]?.name;
  }

  if (result.mediaType === 'artist' || result.mediaType === 'person') {
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
  const sortField = getSortField(router.query.sort);
  const sortOrder = getSortOrder(router.query.order);
  const searchOptions = useMemo(
    () => ({
      query,
      ...(type ? { type } : {}),
    }),
    [query, type]
  );
  const isSearchReady = router.isReady && !!query;

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<SearchResult>(`/api/v1/search`, searchOptions, {
    enabled: isSearchReady,
    hideAvailable: false,
    hideBlocklisted: false,
  });
  const sortedTitles = useMemo(() => {
    if (sortField === 'relevance') {
      return titles;
    }

    const collator = new Intl.Collator(undefined, {
      sensitivity: 'base',
      numeric: true,
    });

    return [...titles].sort((left, right) => {
      if (sortField === 'date') {
        return compareOptional(
          getResultDate(left),
          getResultDate(right),
          (a, b) => a - b,
          sortOrder
        );
      }

      const leftValue =
        sortField === 'title'
          ? getResultTitle(left)
          : sortField === 'author'
            ? getResultAuthor(left)
            : left.mediaType === 'book'
              ? left.publisher
              : undefined;
      const rightValue =
        sortField === 'title'
          ? getResultTitle(right)
          : sortField === 'author'
            ? getResultAuthor(right)
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
  }, [sortField, sortOrder, titles]);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
      </div>
      <div
        className="mb-6 flex flex-wrap gap-2"
        aria-label={intl.formatMessage(messages.searchresults)}
      >
        {searchCategories.map((searchCategory) => {
          const isSelected = category.key === searchCategory.key;

          return (
            <Button
              key={searchCategory.key}
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
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-col gap-1 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
          <select
            value={sortField}
            onChange={(event) => {
              const nextQuery = { ...router.query };
              const value = event.target.value as SortField;

              if (value === 'relevance') {
                delete nextQuery.sort;
                delete nextQuery.order;
              } else {
                nextQuery.sort = value;
                nextQuery.order = sortOrder;
              }

              void router.replace(
                { pathname: router.pathname, query: nextQuery },
                undefined,
                { shallow: true, scroll: false }
              );
            }}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white"
          >
            <option value="relevance">
              {intl.formatMessage(messages.relevance)}
            </option>
            <option value="title">{intl.formatMessage(messages.title)}</option>
            <option value="author">
              {intl.formatMessage(messages.author)}
            </option>
            <option value="date">{intl.formatMessage(messages.date)}</option>
            <option value="publisher">
              {intl.formatMessage(messages.publisher)}
            </option>
          </select>
        </label>
        {sortField !== 'relevance' && (
          <label className="flex min-w-40 flex-col gap-1 text-sm text-gray-300">
            {intl.formatMessage(messages.order)}
            <select
              value={sortOrder}
              onChange={(event) => {
                void router.replace(
                  {
                    pathname: router.pathname,
                    query: { ...router.query, order: event.target.value },
                  },
                  undefined,
                  { shallow: true, scroll: false }
                );
              }}
              className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white"
            >
              <option value="asc">
                {intl.formatMessage(messages.ascending)}
              </option>
              <option value="desc">
                {intl.formatMessage(messages.descending)}
              </option>
            </select>
          </label>
        )}
      </div>
      <ListView
        items={sortedTitles}
        preferredBookFormat={preferredBookFormat}
        isEmpty={isSearchReady && isEmpty}
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
