import Slider from '@app/components/Slider';
import LibraryTitleCard from '@app/components/TitleCard/LibraryTitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import useDiscoverRowSnapshot from '@app/hooks/useDiscoverRowSnapshot';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';

const WATCHLIST_URL = '/api/v1/discover/watchlist';

const messages = defineMessages('components.Discover.PlexWatchlistSlider', {
  plexwatchlist: 'Your Watchlist',
  emptywatchlist: 'Items added to your watchlist will appear here.',
});

const PlexWatchlistSlider = () => {
  const intl = useIntl();
  const { user } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });

  const {
    data: watchlistItems,
    error: watchlistError,
    isLoading,
  } = useDiscoverRowSnapshot<{
    page: number;
    totalPages: number;
    totalResults: number;
    results: WatchlistItem[];
  }>({
    enabled: inView,
    rowKey: 'watchlist',
    url: WATCHLIST_URL,
  });

  const watchlistCards = useMemo(
    () =>
      (watchlistItems?.results ?? []).flatMap((item) => {
        const card =
          item.mediaType === 'music' && item.mbId ? (
            <LibraryTitleCard
              id={item.mbId}
              type="album"
              title={item.title}
              isAddedToWatchlist={true}
            />
          ) : item.mediaType === 'book' && item.externalId ? (
            <LibraryTitleCard
              id={item.externalId}
              type="book"
              title={item.title}
              isAddedToWatchlist={true}
            />
          ) : item.tmdbId ? (
            <TmdbTitleCard
              id={item.tmdbId}
              tmdbId={item.tmdbId}
              type={item.mediaType === 'tv' ? 'tv' : 'movie'}
              isAddedToWatchlist={true}
            />
          ) : null;

        return card
          ? [<div key={`watchlist-slider-item-${item.ratingKey}`}>{card}</div>]
          : [];
      }),
    [watchlistItems?.results]
  );
  const isWatchlistEmpty = !!watchlistItems && watchlistCards.length === 0;

  if (
    (isWatchlistEmpty &&
      !user?.settings?.watchlistSyncMovies &&
      !user?.settings?.watchlistSyncTv &&
      !user?.settings?.watchlistSyncMusic &&
      !user?.settings?.watchlistSyncBooks) ||
    watchlistError
  ) {
    return null;
  }

  return (
    <div ref={ref}>
      <div className="slider-header">
        <Link href="/discover/watchlist" className="slider-title">
          <span>{intl.formatMessage(messages.plexwatchlist)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <Slider
        sliderKey="watchlist"
        isLoading={isLoading}
        isEmpty={isWatchlistEmpty}
        emptyMessage={intl.formatMessage(messages.emptywatchlist)}
        items={watchlistCards}
      />
    </div>
  );
};

export default PlexWatchlistSlider;
