import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import DiscoverTv from '@app/components/Discover/DiscoverTv';
import ErrorPage from '@app/pages/_error';
import type { TvNetwork } from '@server/models/common';
import { useRouter } from 'next/router';
import useSWR from 'swr';

const DiscoverTvNetwork = () => {
  const router = useRouter();
  const networkId =
    typeof router.query.networkId === 'string' ? router.query.networkId : '';
  const { data: network, error } = useSWR<TvNetwork>(
    networkId ? `/api/v1/network/${networkId}` : null
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  if (!network) {
    return <LoadingSpinner />;
  }

  return <DiscoverTv network={network} />;
};

export default DiscoverTvNetwork;
