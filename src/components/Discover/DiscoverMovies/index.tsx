import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { FilterOptions } from '@app/components/Discover/constants';
import { prepareFilterValues } from '@app/components/Discover/constants';
import MediaDiscoveryControls from '@app/components/Discover/MediaDiscoveryControls';
import { studios } from '@app/components/Discover/StudioSlider';
import useDiscover from '@app/hooks/useDiscover';
import useDiscoverScrollRestoration from '@app/hooks/useDiscoverScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { ProductionCompany } from '@server/models/common';
import type { MovieResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMovies', {
  movies: 'Movies',
  studioMovies: '{studio} Movies',
});

interface DiscoverMoviesProps {
  studio?: ProductionCompany;
  titleOverride?: string;
  initialFilters?: FilterOptions;
  randomizeOrder?: boolean;
  mediaFilters?: ReactNode;
}

const DiscoverMovies = ({
  studio,
  titleOverride,
  initialFilters,
  randomizeOrder,
  mediaFilters,
}: DiscoverMoviesProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const preparedFilters = {
    ...initialFilters,
    ...prepareFilterValues(router.query),
    ...(studio ? { studio: studio.id.toString() } : {}),
  };
  const discover = useDiscover<MovieResult, unknown, FilterOptions>(
    '/api/v1/discover/movies',
    preparedFilters,
    {
      randomizeOrder: randomizeOrder ?? !preparedFilters.sortBy,
      availableQuality: preparedFilters.availability,
      hideAvailable: !preparedFilters.availability,
    }
  );
  useSearchActivityReporter(
    Boolean(preparedFilters.search || preparedFilters.availability) &&
      (discover.isLoadingInitialData ||
        discover.isValidating ||
        discover.isSearchingAvailableQuality),
    'movies-discovery'
  );
  useDiscoverScrollRestoration({
    mediaType: 'movie',
    itemCount: discover.titles.length,
    shuffleSeed: discover.shuffleSeed,
    isLoading: discover.isLoadingInitialData || discover.isLoadingMore,
    isReachingEnd: discover.isReachingEnd,
    fetchMore: discover.fetchMore,
  });
  if (discover.error) return <ErrorPage statusCode={500} />;
  const title = studio
    ? intl.formatMessage(messages.studioMovies, { studio: studio.name })
    : (titleOverride ?? intl.formatMessage(messages.movies));
  const curatedStudio = studio
    ? studios.find((item) => item.url.endsWith(`/${studio.id}`))
    : undefined;
  const studioLogo =
    curatedStudio?.image ??
    (studio?.logoPath
      ? `https://image.tmdb.org/t/p/original${studio.logoPath}`
      : undefined);
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {mediaFilters}
        {studioLogo && (
          <div className="relative mx-auto my-4 h-20 w-full max-w-sm sm:h-24">
            <CachedImage
              type="tmdb"
              src={studioLogo}
              alt={studio?.name ?? ''}
              className={`object-contain ${
                curatedStudio?.logoTone === 'white' ? 'brightness-0 invert' : ''
              }`}
              fill
            />
          </div>
        )}
        <MediaDiscoveryControls type="movie" currentFilters={preparedFilters} />
      </div>
      <ListView
        items={discover.titles}
        isEmpty={discover.isEmpty}
        isLoading={
          discover.isLoadingInitialData ||
          discover.isSearchingAvailableQuality ||
          (discover.isLoadingMore && discover.titles.length > 0)
        }
        isReachingEnd={discover.isReachingEnd}
        onScrollBottom={discover.fetchMore}
      />
    </>
  );
};
export default DiscoverMovies;
