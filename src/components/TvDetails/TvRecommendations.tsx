import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import { prepareFilterValues } from '@app/components/Discover/constants';
import MediaDiscoveryControls from '@app/components/Discover/MediaDiscoveryControls';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { filterAndSortRelatedMedia } from '@app/utils/relatedMediaFilters';
import type { TvResult } from '@server/models/Search';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TvDetails', {
  recommendations: 'Recommendations',
});

const TvRecommendations = () => {
  const router = useRouter();
  const intl = useIntl();
  const tvId = typeof router.query.tvId === 'string' ? router.query.tvId : '';
  const preparedFilters = prepareFilterValues(router.query);
  const { data: tvData } = useSWR<TvDetails>(
    tvId ? `/api/v1/tv/${tvId}` : null
  );
  const {
    isLoadingInitialData,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<TvResult>(
    `/api/v1/tv/${tvId}/recommendations`,
    { language: preparedFilters.language },
    {
      enabled: !!tvId,
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
        title={[intl.formatMessage(messages.recommendations), tvData?.name]}
      />
      <div className="mt-1 mb-5">
        <Header
          subtext={
            <Link href={`/tv/${tvData?.id}`} className="hover:underline">
              {tvData?.name}
            </Link>
          }
        >
          {intl.formatMessage(messages.recommendations)}
        </Header>
      </div>
      <div className="mb-4">
        <MediaDiscoveryControls type="tv" currentFilters={preparedFilters} />
      </div>
      <ListView
        items={filteredTitles}
        isEmpty={!isLoadingInitialData && filteredTitles.length === 0}
        isReachingEnd={isReachingEnd}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default TvRecommendations;
