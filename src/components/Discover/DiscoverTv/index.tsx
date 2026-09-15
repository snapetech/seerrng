import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { FilterOptions } from '@app/components/Discover/constants';
import { prepareFilterValues } from '@app/components/Discover/constants';
import MediaDiscoveryControls from '@app/components/Discover/MediaDiscoveryControls';
import { tvNetworks } from '@app/components/Discover/NetworkSlider';
import useDiscover from '@app/hooks/useDiscover';
import useDiscoverScrollRestoration from '@app/hooks/useDiscoverScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { TvNetwork } from '@server/models/common';
import type { TvResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverTv', {
  series: 'Series',
  networkSeries: '{network} Series',
});
interface DiscoverTvProps {
  network?: TvNetwork;
  titleOverride?: string;
  initialFilters?: FilterOptions;
  randomizeOrder?: boolean;
  mediaFilters?: ReactNode;
}

const DiscoverTv = ({
  network,
  titleOverride,
  initialFilters,
  randomizeOrder,
  mediaFilters,
}: DiscoverTvProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const preparedFilters = {
    ...initialFilters,
    ...prepareFilterValues(router.query),
    ...(network ? { network: network.id.toString() } : {}),
  };
  const discover = useDiscover<TvResult, never, FilterOptions>(
    '/api/v1/discover/tv',
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
    'series-discovery'
  );
  useDiscoverScrollRestoration({
    mediaType: 'tv',
    itemCount: discover.titles.length,
    shuffleSeed: discover.shuffleSeed,
    isLoading: discover.isLoadingInitialData || discover.isLoadingMore,
    isReachingEnd: discover.isReachingEnd,
    fetchMore: discover.fetchMore,
  });
  if (discover.error) return <ErrorPage statusCode={500} />;
  const title = network
    ? intl.formatMessage(messages.networkSeries, { network: network.name })
    : (titleOverride ?? intl.formatMessage(messages.series));
  const curatedNetwork = network
    ? tvNetworks.find((item) => item.url.endsWith(`/${network.id}`))
    : undefined;
  const networkLogo =
    curatedNetwork?.image ??
    (network?.logoPath
      ? `https://image.tmdb.org/t/p/original${network.logoPath}`
      : undefined);
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {mediaFilters}
        {networkLogo && (
          <div className="relative mx-auto my-4 h-20 w-full max-w-sm sm:h-24">
            <CachedImage
              type="tmdb"
              src={networkLogo}
              alt={network?.name ?? ''}
              className={`object-contain ${
                curatedNetwork?.logoTone === 'white'
                  ? 'brightness-0 invert'
                  : ''
              }`}
              fill
            />
          </div>
        )}
        <MediaDiscoveryControls type="tv" currentFilters={preparedFilters} />
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
export default DiscoverTv;
