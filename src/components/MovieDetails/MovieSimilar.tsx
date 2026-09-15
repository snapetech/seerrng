import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import { prepareFilterValues } from '@app/components/Discover/constants';
import MediaDiscoveryControls from '@app/components/Discover/MediaDiscoveryControls';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { filterAndSortRelatedMedia } from '@app/utils/relatedMediaFilters';
import type { MovieDetails } from '@server/models/Movie';
import type { MovieResult } from '@server/models/Search';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MovieDetails', {
  similar: 'Similar Titles',
});

const MovieSimilar = () => {
  const router = useRouter();
  const intl = useIntl();
  const movieId =
    typeof router.query.movieId === 'string' ? router.query.movieId : '';
  const preparedFilters = prepareFilterValues(router.query);
  const { data: movieData } = useSWR<MovieDetails>(
    movieId ? `/api/v1/movie/${movieId}` : null
  );
  const {
    isLoadingInitialData,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult>(
    `/api/v1/movie/${movieId}/similar`,
    { language: preparedFilters.language },
    {
      enabled: !!movieId,
      randomizeOrder: !preparedFilters.sortBy,
      availableQuality: preparedFilters.availability,
      hideAvailable: !preparedFilters.availability,
    }
  );
  const filteredTitles = useMemo(
    () => filterAndSortRelatedMedia(titles, preparedFilters),
    [preparedFilters, titles]
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle
        title={[intl.formatMessage(messages.similar), movieData?.title]}
      />
      <div className="mt-1 mb-5">
        <Header
          subtext={
            <Link href={`/movie/${movieData?.id}`} className="hover:underline">
              {movieData?.title}
            </Link>
          }
        >
          {intl.formatMessage(messages.similar)}
        </Header>
      </div>
      <div className="mb-4">
        <MediaDiscoveryControls type="movie" currentFilters={preparedFilters} />
      </div>
      <ListView
        items={filteredTitles}
        isEmpty={!isLoadingInitialData && filteredTitles.length === 0}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default MovieSimilar;
