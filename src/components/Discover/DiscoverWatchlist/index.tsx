import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import { getPositiveQueryParamNumber } from '@app/hooks/useUpdateQueryParams';
import { useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { isDiscoverWatchlistTypeEnabled } from '@app/utils/serviceAvailability';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverWatchlist', {
  discoverwatchlist: 'Your Watchlist',
  watchlist: 'Watchlist',
});

const DiscoverWatchlist = () => {
  const intl = useIntl();
  const router = useRouter();
  const userId = getPositiveQueryParamNumber(router.query.userId);
  const { user } = useUser({
    id: userId,
  });
  const { user: currentUser } = useUser();
  const { currentSettings } = useSettings();

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isValidating,
    titles,
    fetchMore,
    error,
    mutate,
    firstResultData,
  } = useDiscover<WatchlistItem>(
    `/api/v1/${
      router.pathname.startsWith('/profile')
        ? `user/${currentUser?.id}`
        : userId
          ? `user/${userId}`
          : 'discover'
    }/watchlist`
  );
  const visibleTitles = titles.filter((item) =>
    isDiscoverWatchlistTypeEnabled(item.mediaType, currentSettings)
  );
  const hasMoreTitles =
    (firstResultData?.totalResults ?? titles.length) > titles.length;

  useEffect(() => {
    if (
      !isLoadingInitialData &&
      !isLoadingMore &&
      !isValidating &&
      titles.length > 0 &&
      visibleTitles.length === 0 &&
      hasMoreTitles
    ) {
      fetchMore();
    }
  }, [
    fetchMore,
    hasMoreTitles,
    isLoadingInitialData,
    isLoadingMore,
    isValidating,
    titles.length,
    visibleTitles.length,
  ]);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = intl.formatMessage(
    userId ? messages.watchlist : messages.discoverwatchlist
  );

  return (
    <>
      <PageTitle title={[title, userId ? user?.displayName : '']} />
      <div className="mt-1 mb-5">
        <Header
          subtext={
            userId ? (
              <Link href={`/users/${user?.id}`} className="hover:underline">
                {user?.displayName}
              </Link>
            ) : (
              ''
            )
          }
        >
          {title}
        </Header>
      </div>
      <ListView
        plexItems={visibleTitles}
        isEmpty={isEmpty || (!hasMoreTitles && visibleTitles.length === 0)}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={!hasMoreTitles}
        onScrollBottom={fetchMore}
        mutateParent={mutate}
      />
    </>
  );
};

export default DiscoverWatchlist;
