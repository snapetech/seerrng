import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import Tooltip from '@app/components/Common/Tooltip';
import {
  CompactSelect,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { PinnedFilterSectionGroup } from '@app/components/Discover/PinnedFilterSection';
import RequestItem from '@app/components/RequestList/RequestItem';
import {
  getPositiveQueryParamNumber,
  getQueryParamString,
  useUpdateQueryParams,
} from '@app/hooks/useUpdateQueryParams';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  isStoredOption,
  isStoredPageSize,
  readLocalStoredRecord,
  writeLocalStoredRecord,
} from '@app/utils/localStorage';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/24/solid';
import type { RequestResultsResponse } from '@server/interfaces/api/requestInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestList', {
  requests: 'Requests',
  showallrequests: 'Show All Requests',
  sortAdded: 'Most Recent',
  sortModified: 'Last Modified',
  sortDirection: 'Toggle Sort Direction',
  taskFilters: 'Task Filters',
  mediaFilters: 'Media Filters',
  sortBy: 'Sort By',
  mediaType: 'Media Type',
  unableToConnect:
    'Unable to connect to {services}. Some information may be unavailable.',
});

enum Filter {
  ALL = 'all',
  PENDING = 'pending',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  AVAILABLE = 'available',
  UNAVAILABLE = 'unavailable',
  FAILED = 'failed',
  DELETED = 'deleted',
  COMPLETED = 'completed',
}

type Sort = 'added' | 'modified';

type SortDirection = 'asc' | 'desc';

type MediaType = 'all' | 'movie' | 'tv' | 'music' | 'book' | 'sports';

const isMediaType = (value: unknown): value is MediaType =>
  typeof value === 'string' &&
  ['all', 'movie', 'tv', 'music', 'book', 'sports'].includes(value);
const REQUEST_FILTER_OPTIONS = Object.values(Filter);
const REQUEST_SORT_OPTIONS: readonly Sort[] = ['added', 'modified'];
const SORT_DIRECTION_OPTIONS: readonly SortDirection[] = ['asc', 'desc'];

const RequestList = () => {
  const router = useRouter();
  const intl = useIntl();
  const userId = getPositiveQueryParamNumber(router.query.userId);
  const { user } = useUser({
    id: userId,
  });
  const { user: currentUser, hasPermission } = useUser();
  const [currentFilter, setCurrentFilter] = useState<Filter>(Filter.PENDING);
  const [currentSort, setCurrentSort] = useState<Sort>('added');
  const [currentMediaType, setCurrentMediaType] = useState<string>('all');
  const [currentSortDirection, setCurrentSortDirection] =
    useState<SortDirection>('desc');
  const [currentPageSize, setCurrentPageSize] = useState<number>(10);

  const page = getPositiveQueryParamNumber(router.query.page, 1) ?? 1;
  const pageIndex = page - 1;
  const updateQueryParams = useUpdateQueryParams({ page: page.toString() });
  const effectiveFilter = Object.values(Filter).includes(
    router.query.filter as Filter
  )
    ? (router.query.filter as Filter)
    : currentFilter;
  const effectiveMediaType = isMediaType(router.query.mediaType)
    ? router.query.mediaType
    : (currentMediaType as MediaType);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<RequestResultsResponse>(
    router.isReady
      ? `/api/v1/request?take=${currentPageSize}&skip=${
          pageIndex * currentPageSize
        }&filter=${effectiveFilter}&mediaType=${effectiveMediaType}&sort=${currentSort}&sortDirection=${currentSortDirection}${
          router.pathname.startsWith('/profile')
            ? `&requestedBy=${currentUser?.id}`
            : userId
              ? `&requestedBy=${userId}`
              : ''
        }`
      : null
  );

  // Restore last set filter values on component mount
  useEffect(() => {
    const filterSettings = readLocalStoredRecord('rl-filter-settings');
    if (filterSettings) {
      if (
        isStoredOption(filterSettings.currentFilter, REQUEST_FILTER_OPTIONS)
      ) {
        setCurrentFilter(filterSettings.currentFilter);
      }
      if (isMediaType(filterSettings.currentMediaType)) {
        setCurrentMediaType(filterSettings.currentMediaType);
      }
      if (isStoredOption(filterSettings.currentSort, REQUEST_SORT_OPTIONS)) {
        setCurrentSort(filterSettings.currentSort);
      }
      if (isStoredPageSize(filterSettings.currentPageSize)) {
        setCurrentPageSize(filterSettings.currentPageSize);
      }
      if (
        isStoredOption(
          filterSettings.currentSortDirection,
          SORT_DIRECTION_OPTIONS
        )
      ) {
        setCurrentSortDirection(filterSettings.currentSortDirection);
      }
    }

    // If filter value is provided in query, use that instead
    const filter = getQueryParamString(router.query.filter);
    const mediaType = getQueryParamString(router.query.mediaType);

    if (Object.values(Filter).includes(filter as Filter)) {
      setCurrentFilter(filter as Filter);
    }

    if (isMediaType(mediaType)) {
      setCurrentMediaType(mediaType);
    }
  }, [router.query.filter, router.query.mediaType]);

  // Set filter values to local storage any time they are changed
  useEffect(() => {
    writeLocalStoredRecord('rl-filter-settings', {
      currentFilter,
      currentMediaType: effectiveMediaType,
      currentSort,
      currentSortDirection,
      currentPageSize,
    });
  }, [
    currentFilter,
    effectiveMediaType,
    currentSort,
    currentSortDirection,
    currentPageSize,
  ]);

  const pendingHeading = (
    <>
      <PageTitle title={intl.formatMessage(messages.requests)} />
      <div className="page-title-row">
        <h2 className="page-title">{intl.formatMessage(messages.requests)}</h2>
      </div>
    </>
  );

  if (!data && !error) {
    return (
      <>
        {pendingHeading}
        <LoadingSpinner />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {pendingHeading}
        <LoadingSpinner />
      </>
    );
  }

  const changePage = (nextPage: number) => {
    updateQueryParams('page', String(nextPage));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <PageTitle
        title={
          router.query.userId && user?.displayName
            ? `${intl.formatMessage(messages.requests)} - ${user.displayName}`
            : intl.formatMessage(messages.requests)
        }
      />
      <Header
        subtext={
          router.pathname.startsWith('/profile') ? (
            <Link href={`/profile`} className="hover:underline">
              {currentUser?.displayName}
            </Link>
          ) : router.query.userId ? (
            <Link href={`/users/${user?.id}`} className="hover:underline">
              {user?.displayName}
            </Link>
          ) : (
            ''
          )
        }
      >
        {intl.formatMessage(messages.requests)}
      </Header>
      <PinnedFilterSectionGroup
        mediaType={
          effectiveMediaType === 'tv'
            ? 'tv'
            : effectiveMediaType === 'sports'
              ? 'tv'
              : effectiveMediaType === 'music'
                ? 'music'
                : effectiveMediaType === 'book'
                  ? 'book'
                  : 'movie'
        }
        sections={[
          {
            section: 'taskFilters',
            label: intl.formatMessage(messages.taskFilters),
            children: (
              <div className="app-filter-row">
                <CompactSelect
                  label={intl.formatMessage(globalMessages.status)}
                  value={effectiveFilter}
                  defaultValue="pending"
                  options={(
                    [
                      ['all', globalMessages.all],
                      ['pending', globalMessages.pending],
                      ['approved', globalMessages.approved],
                      ['completed', globalMessages.completed],
                      ['processing', globalMessages.processing],
                      ['failed', globalMessages.failed],
                      ['available', globalMessages.available],
                      ['unavailable', globalMessages.unavailable],
                      ['deleted', globalMessages.deleted],
                    ] as const
                  ).map(([value, label]) => ({
                    value,
                    label: intl.formatMessage(label),
                  }))}
                  onChange={(value) => {
                    setCurrentFilter(value as Filter);
                    router.push({
                      pathname: router.pathname,
                      query: router.query.userId
                        ? {
                            userId: router.query.userId,
                            filter: value,
                            mediaType: effectiveMediaType,
                          }
                        : { filter: value, mediaType: effectiveMediaType },
                    });
                  }}
                />
              </div>
            ),
          },
          {
            section: 'mediaFilters',
            label: intl.formatMessage(messages.mediaFilters),
            children: (
              <div className="app-filter-row">
                <CompactSelect
                  label={intl.formatMessage(messages.mediaType)}
                  value={effectiveMediaType}
                  options={(
                    [
                      ['all', globalMessages.all],
                      ['movie', globalMessages.movies],
                      ['tv', globalMessages.tvshows],
                      ['music', globalMessages.music],
                      ['book', globalMessages.books],
                      ['sports', globalMessages.sports],
                    ] as const
                  ).map(([value, label]) => ({
                    value,
                    label: intl.formatMessage(label),
                  }))}
                  onChange={(value) => {
                    setCurrentMediaType(value as MediaType);
                    router.push({
                      pathname: router.pathname,
                      query: router.query.userId
                        ? { userId: router.query.userId, mediaType: value }
                        : { mediaType: value },
                    });
                  }}
                />
              </div>
            ),
          },
          {
            section: 'sortBy',
            label: intl.formatMessage(messages.sortBy),
            children: (
              <div className="app-filter-row">
                <CompactSelect
                  label={intl.formatMessage(messages.sortBy)}
                  value={currentSort}
                  options={[
                    {
                      value: 'added',
                      label: intl.formatMessage(messages.sortAdded),
                    },
                    {
                      value: 'modified',
                      label: intl.formatMessage(messages.sortModified),
                    },
                  ]}
                  onChange={(value) => {
                    setCurrentSort(value as Sort);
                    router.push({
                      pathname: router.pathname,
                      query: router.query.userId
                        ? {
                            userId: router.query.userId,
                            filter: effectiveFilter,
                            mediaType: effectiveMediaType,
                          }
                        : {
                            filter: effectiveFilter,
                            mediaType: effectiveMediaType,
                          },
                    });
                  }}
                />
                <Tooltip content={intl.formatMessage(messages.sortDirection)}>
                  <button
                    type="button"
                    className={getFilterToggleButtonClass(false)}
                    aria-label={intl.formatMessage(messages.sortDirection)}
                    onClick={() =>
                      setCurrentSortDirection(
                        currentSortDirection === 'asc' ? 'desc' : 'asc'
                      )
                    }
                  >
                    {currentSortDirection === 'asc' ? (
                      <ArrowUpIcon />
                    ) : (
                      <ArrowDownIcon />
                    )}
                  </button>
                </Tooltip>
              </div>
            ),
          },
        ]}
      />

      {data.serviceErrors &&
        (data.serviceErrors.radarr.length > 0 ||
          data.serviceErrors.sonarr.length > 0 ||
          data.serviceErrors.lidarr.length > 0 ||
          data.serviceErrors.readarr.length > 0) &&
        (hasPermission(Permission.MANAGE_REQUESTS) ||
          hasPermission(Permission.REQUEST_ADVANCED)) && (
          <div className="service-error-banner">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>
              {intl.formatMessage(messages.unableToConnect, {
                services: [
                  ...data.serviceErrors.radarr.map((s) => s.name),
                  ...data.serviceErrors.sonarr.map((s) => s.name),
                  ...data.serviceErrors.lidarr.map((s) => s.name),
                  ...data.serviceErrors.readarr.map((s) => s.name),
                ].join(', '),
              })}
            </span>
          </div>
        )}

      {data.results.map((request) => {
        return (
          <div className="py-2" key={`request-list-${request.id}`}>
            <RequestItem
              request={request}
              revalidateList={() => revalidate()}
            />
          </div>
        );
      })}

      {data.results.length === 0 && (
        <div className="flex w-full flex-col items-center justify-center py-24 text-white">
          <span className="text-2xl text-gray-400">
            {intl.formatMessage(globalMessages.noresults)}
          </span>
          {(effectiveFilter !== Filter.ALL || effectiveMediaType !== 'all') && (
            <div className="mt-4">
              <Button
                buttonType="primary"
                onClick={() => {
                  setCurrentFilter(Filter.ALL);
                  setCurrentMediaType(Filter.ALL);
                }}
              >
                {intl.formatMessage(messages.showallrequests)}
              </Button>
            </div>
          )}
        </div>
      )}
      <PaginationFooter
        page={page}
        pageSize={currentPageSize}
        pageSizeOptions={[5, 10, 25, 50, 100]}
        totalPages={data.pageInfo.pages}
        onPageChange={changePage}
        onPageSizeChange={(size) => {
          setCurrentPageSize(size);
          void router
            .push({
              pathname: router.pathname,
              query: router.query.userId ? { userId: router.query.userId } : {},
            })
            .then(() => window.scrollTo(0, 0));
        }}
      />
    </>
  );
};

export default RequestList;
