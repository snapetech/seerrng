import Alert from '@app/components/Common/Alert';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import type { SportarrResult } from '@server/models/Sportarr';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverSports', {
  title: 'Sports',
  description:
    'Browse leagues available in Sportarr. Requesting a league adds it to Sportarr using its configured quality profile and folder settings. If an administrator links IPTV Tunerr in Settings > Services, Sportarr can also use Tunerr’s live sports feeds for its DVR.',
  search: 'Search Sportarr leagues',
  placeholder: 'League name',
  unavailable: 'Sportarr league discovery is unavailable right now.',
  unavailableHint: 'Check the Sportarr connection in Settings > Services.',
  noResults: 'No Sportarr leagues match this search.',
  suggested: 'Suggested searches',
});

const suggestedLeagues = [
  'National Football League',
  'National Hockey League',
  'National Basketball Association',
  'Major League Baseball',
  'Premier League',
  'UFC',
];

const DiscoverSports = () => {
  const intl = useIntl();
  const router = useRouter();
  const [isRouteReady, setIsRouteReady] = useState(false);
  useEffect(() => {
    if (router.isReady) setIsRouteReady(true);
  }, [router.isReady]);

  const routeQuery = isRouteReady ? router.query : {};
  const query = typeof routeQuery.query === 'string' ? routeQuery.query : '';
  const update = useBatchUpdateQueryParams(routeQuery);
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  const pendingRouteSearchRef = useRef<string | null>(null);

  useEffect(() => {
    routedSearchRef.current = query.trim();
    pendingRouteSearchRef.current = query.trim();
    setSearch(query);
  }, [query, setSearch]);

  const discover = useDiscover<SportarrResult>(
    '/api/v1/discover/sports',
    { query },
    {
      enabled: isRouteReady,
      showErrorToast: false,
      hideErrorWithResults: false,
    }
  );

  useSearchActivityReporter(
    Boolean(search.trim()) &&
      (search.trim() !== query.trim() ||
        discover.isLoadingInitialData ||
        discover.isValidating),
    'sportarr-keyword'
  );

  useEffect(() => {
    const nextSearch = debouncedSearch.trim();
    if (pendingRouteSearchRef.current !== null) {
      if (nextSearch !== pendingRouteSearchRef.current) return;
      pendingRouteSearchRef.current = null;
    }
    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update({ query: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);

  const errorMessage = (
    discover.error as { response?: { data?: { message?: string } } } | undefined
  )?.response?.data?.message;
  const title = intl.formatMessage(messages.title);

  return (
    <>
      <PageTitle title={title} />
      <div className="app-filter-section-gap">
        <Header>{title}</Header>
        <p className="description">
          {intl.formatMessage(messages.description)}
        </p>
        <form
          className="app-filter-row"
          onSubmit={(event) => {
            event.preventDefault();
            const nextSearch = search.trim();
            routedSearchRef.current = nextSearch;
            update({ query: nextSearch || undefined, page: undefined });
          }}
        >
          <label className="discover-filter-control app-filter-search-control">
            <span
              className={`discover-filter-control-label ${
                search.trim() ? 'discover-filter-control-label-active' : ''
              }`}
            >
              <MagnifyingGlassIcon aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={intl.formatMessage(messages.placeholder)}
              aria-label={intl.formatMessage(messages.search)}
              className="app-filter-search-input"
            />
          </label>
        </form>
        {!search.trim() && (
          <div className="app-filter-section-gap">
            <p className="description">
              {intl.formatMessage(messages.suggested)}
            </p>
            <div className="app-filter-row">
              {suggestedLeagues.map((league) => (
                <button
                  key={league}
                  type="button"
                  className={getFilterToggleButtonClass(false)}
                  onClick={() => setSearch(league)}
                >
                  {league}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {discover.error && (
        <Alert
          title={errorMessage ?? intl.formatMessage(messages.unavailable)}
          type="warning"
        >
          {intl.formatMessage(messages.unavailableHint)}
        </Alert>
      )}
      {!discover.error &&
        search.trim() &&
        !discover.isLoadingInitialData &&
        discover.isEmpty && (
          <Alert title={intl.formatMessage(messages.noResults)} type="info" />
        )}
      {(!discover.error || discover.titles.length > 0) && (
        <ListView
          items={discover.titles}
          isEmpty={discover.isEmpty}
          isLoading={
            discover.isLoadingInitialData ||
            (discover.isLoadingMore && discover.titles.length > 0)
          }
          isReachingEnd={discover.isReachingEnd}
          onScrollBottom={discover.fetchMore}
        />
      )}
    </>
  );
};

export default DiscoverSports;
