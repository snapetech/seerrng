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

const messages = defineMessages('components.NativeSearch', {
  search: 'Search',
  searchresults: 'Search Results',
});

const NativeSearch = () => {
  const intl = useIntl();
  const router = useRouter();
  const query =
    typeof router.query.query === 'string' ? router.query.query.trim() : '';
  const searchOptions = useMemo(
    () => ({
      query,
    }),
    [query]
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

export default NativeSearch;
