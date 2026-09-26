import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import useDiscoverRowSnapshot from '@app/hooks/useDiscoverRowSnapshot';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import useWarmImageCache, {
  MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT,
} from '@app/hooks/useWarmImageCache';
import defineMessages from '@app/utils/defineMessages';
import { isConfiguredMediaCategoryEnabled } from '@app/utils/serviceAvailability';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useMemo } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';

const RECENTLY_ADDED_URL =
  '/api/v1/media?filter=allavailable&take=20&sort=mediaAdded&mediaType=movie%2Ctv';

const messages = defineMessages('components.Discover.RecentlyAddedSlider', {
  recentlyAdded: 'Recently Added',
});

const RecentlyAddedSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const {
    data: media,
    error: mediaError,
    isLoading,
  } = useDiscoverRowSnapshot<MediaResultsResponse>({
    enabled: inView,
    personalized: true,
    rowKey: 'recently-added',
    url: RECENTLY_ADDED_URL,
  });

  const recentlyAddedCards = useMemo(
    () =>
      (media?.results ?? [])
        .filter((item) => item.mediaType === 'movie' || item.mediaType === 'tv')
        .filter((item) =>
          isConfiguredMediaCategoryEnabled(
            item.mediaType === 'tv' ? 'tv' : 'movie',
            currentSettings
          )
        )
        .map((item) => (
          <TmdbTitleCard
            key={`media-slider-item-${item.id}`}
            id={item.id}
            tmdbId={item.tmdbId}
            tvdbId={item.tvdbId}
            type={item.mediaType === 'tv' ? 'tv' : 'movie'}
          />
        )),
    [currentSettings, media?.results]
  );

  useWarmImageCache(media?.results, {
    maxUrls: MAIN_MEDIA_POSTER_CACHE_WARM_LIMIT,
    posterOnly: true,
  });

  if (
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
        isLoading={isLoading}
        isEmpty={!!media && !recentlyAddedCards.length && !mediaError}
        items={recentlyAddedCards}
      />
    </div>
  );
};

export default RecentlyAddedSlider;
