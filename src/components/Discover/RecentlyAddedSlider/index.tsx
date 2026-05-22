import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentlyAddedSlider', {
  recentlyAdded: 'Recently Added',
});

const RecentlyAddedSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const { data: media, error: mediaError } = useSWR<MediaResultsResponse>(
    inView
      ? '/api/v1/media?filter=allavailable&take=20&sort=mediaAdded&mediaType=movie%2Ctv'
      : null,
    { revalidateOnFocus: false }
  );

  const recentlyAddedCards = useMemo(
    () =>
      (media?.results ?? [])
        .filter((item) => item.mediaType === 'movie' || item.mediaType === 'tv')
        .map((item) => (
          <TmdbTitleCard
            key={`media-slider-item-${item.id}`}
            id={item.id}
            tmdbId={item.tmdbId}
            tvdbId={item.tvdbId}
            type={item.mediaType === 'tv' ? 'tv' : 'movie'}
          />
        )),
    [media?.results]
  );

  if (
    (media && !recentlyAddedCards.length && !mediaError) ||
    !hasPermission([Permission.MANAGE_REQUESTS, Permission.RECENT_VIEW], {
      type: 'or',
    })
  ) {
    return null;
  }

  return (
    <div ref={ref}>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.recentlyAdded)}</span>
        </div>
      </div>
      <Slider
        sliderKey="media"
        isLoading={inView && !media}
        items={recentlyAddedCards}
      />
    </div>
  );
};

export default RecentlyAddedSlider;
