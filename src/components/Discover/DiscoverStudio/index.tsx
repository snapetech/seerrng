import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import DiscoverMovies from '@app/components/Discover/DiscoverMovies';
import ErrorPage from '@app/pages/_error';
import type { ProductionCompany } from '@server/models/common';
import { useRouter } from 'next/router';
import useSWR from 'swr';

const DiscoverMovieStudio = () => {
  const router = useRouter();
  const studioId =
    typeof router.query.studioId === 'string' ? router.query.studioId : '';
  const { data: studio, error } = useSWR<ProductionCompany>(
    studioId ? `/api/v1/studio/${studioId}` : null
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  if (!studio) {
    return <LoadingSpinner />;
  }

  return <DiscoverMovies studio={studio} />;
};

export default DiscoverMovieStudio;
