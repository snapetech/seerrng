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
  albums: 'Albums',
  artists: 'Artists',
  books: 'Books',
  people: 'People',
});

const searchTypes = [
  { value: undefined, message: messages.all },
  { value: 'movie', message: messages.movies },
  { value: 'tv', message: messages.series },
  { value: 'album', message: messages.albums },
  { value: 'artist', message: messages.artists },
  { value: 'book', message: messages.books },
  { value: 'person', message: messages.people },
] as const;

type SearchType = Exclude<(typeof searchTypes)[number]['value'], undefined>;

const getSearchType = (type: string | string[] | undefined) =>
  typeof type === 'string' &&
  searchTypes.some((searchType) => searchType.value === type)
    ? (type as SearchType)
    : undefined;

const Search = () => {
  const intl = useIntl();
  const router = useRouter();
  const query =
    typeof router.query.query === 'string' ? router.query.query.trim() : '';
  const type = getSearchType(router.query.type);
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
  } = useDiscover<
    | MovieResult
    | TvResult
    | PersonResult
    | AlbumResult
    | ArtistResult
    | BookResult
  >(`/api/v1/search`, searchOptions, {
    enabled: isSearchReady,
    hideAvailable: false,
    hideBlocklisted: false,
  });

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
        {searchTypes.map((searchType) => {
          const isSelected = type === searchType.value;

          return (
            <Button
              key={searchType.value ?? 'all'}
              buttonSize="sm"
              buttonType={isSelected ? 'primary' : 'default'}
              aria-pressed={isSelected}
              onClick={() => {
                const nextQuery = { ...router.query };

                if (searchType.value) {
                  nextQuery.type = searchType.value;
                } else {
                  delete nextQuery.type;
                }

                void router.replace(
                  { pathname: router.pathname, query: nextQuery },
                  undefined,
                  { shallow: true, scroll: false }
                );
              }}
            >
              {intl.formatMessage(searchType.message)}
            </Button>
          );
        })}
      </div>
      <ListView
        items={titles}
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
