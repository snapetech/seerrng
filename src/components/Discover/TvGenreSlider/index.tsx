import { genreColorMap } from '@app/components/Discover/constants';
import GenreCard from '@app/components/GenreCard';
import Slider from '@app/components/Slider';
import useDiscoverRowSnapshot from '@app/hooks/useDiscoverRowSnapshot';
import defineMessages from '@app/utils/defineMessages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import type { GenreSliderItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import React from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';

const TV_GENRES_URL = '/api/v1/discover/genreslider/tv';

const messages = defineMessages('components.Discover.TvGenreSlider', {
  tvgenres: 'Series Genres',
});

const TvGenreSlider = () => {
  const intl = useIntl();
  const { ref, inView } = useInView({
    rootMargin: '450px 0px',
    triggerOnce: true,
  });
  const { data, error, isLoading } = useDiscoverRowSnapshot<GenreSliderItem[]>({
    enabled: inView,
    rowKey: 'tv-genres',
    url: TV_GENRES_URL,
  });

  return (
    <div ref={ref}>
      <div className="slider-header">
        <Link href="/discover/tv/genres" className="slider-title">
          <span>{intl.formatMessage(messages.tvgenres)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <Slider
        sliderKey="tv-genres"
        isLoading={isLoading && !error}
        isEmpty={false}
        items={(data ?? []).map((genre, index) => (
          <GenreCard
            key={`genre-tv-${genre.id}-${index}`}
            name={genre.name}
            image={`https://image.tmdb.org/t/p/w780_filter(duotone,${
              genreColorMap[genre.id] ?? genreColorMap[0]
            })${genre.backdrops[4]}`}
            url={`/discover/tv?genre=${genre.id}`}
          />
        ))}
        placeholder={<GenreCard.Placeholder />}
        emptyMessage=""
      />
    </div>
  );
};

export default React.memo(TvGenreSlider);
