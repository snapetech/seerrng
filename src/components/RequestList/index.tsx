import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import Tooltip from '@app/components/Common/Tooltip';
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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Bars3BottomLeftIcon,
  CircleStackIcon,
  FunnelIcon,
} from '@heroicons/react/24/solid';
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

type MediaType = 'all' | 'movie' | 'tv' | 'music' | 'book';

const isMediaType = (value: unknown): value is MediaType =>
  typeof value === 'string' &&
  ['all', 'movie', 'tv', 'music', 'book'].includes(value);
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

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <LoadingSpinner />;
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
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
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
        <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mr-2 sm:mb-0 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
              <CircleStackIcon className="h-6 w-6" />
            </span>
            <select
              id="mediaType"
              name="mediaType"
              onChange={(e) => {
                setCurrentMediaType(e.target.value as MediaType);
                router.push({
                  pathname: router.pathname,
                  query: router.query.userId
                    ? {
                        userId: router.query.userId,
                        mediaType: e.target.value,
                      }
                    : { mediaType: e.target.value },
                });
              }}
              value={effectiveMediaType}
              className="rounded-r-only"
            >
              <option value="all">
                {intl.formatMessage(globalMessages.all)}
              </option>
              <option value="movie">
                {intl.formatMessage(globalMessages.movies)}
              </option>
              <option value="tv">
                {intl.formatMessage(globalMessages.tvshows)}
              </option>
              <option value="music">
                {intl.formatMessage(globalMessages.music)}
              </option>
              <option value="book">
                {intl.formatMessage(globalMessages.books)}
              </option>
            </select>
          </div>
          <div className="mb-2 flex flex-grow sm:mr-2 sm:mb-0 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
              <FunnelIcon className="h-6 w-6" />
            </span>
            <select
              id="filter"
              name="filter"
              onChange={(e) => {
                setCurrentFilter(e.target.value as Filter);
                router.push({
                  pathname: router.pathname,
                  query: router.query.userId
                    ? {
                        userId: router.query.userId,
                        filter: e.target.value,
                        mediaType: effectiveMediaType,
                      }
                    : { filter: e.target.value, mediaType: effectiveMediaType },
                });
              }}
              value={effectiveFilter}
              className="rounded-r-only"
            >
              <option value="all">
                {intl.formatMessage(globalMessages.all)}
              </option>
              <option value="pending">
                {intl.formatMessage(globalMessages.pending)}
              </option>
              <option value="approved">
                {intl.formatMessage(globalMessages.approved)}
              </option>
              <option value="completed">
                {intl.formatMessage(globalMessages.completed)}
              </option>
              <option value="processing">
                {intl.formatMessage(globalMessages.processing)}
              </option>
              <option value="failed">
                {intl.formatMessage(globalMessages.failed)}
              </option>
              <option value="available">
                {intl.formatMessage(globalMessages.available)}
              </option>
              <option value="unavailable">
                {intl.formatMessage(globalMessages.unavailable)}
              </option>
              <option value="deleted">
                {intl.formatMessage(globalMessages.deleted)}
              </option>
            </select>
          </div>
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <Bars3BottomLeftIcon className="h-6 w-6" />
            </span>
            <select
              id="sort"
              name="sort"
              onChange={(e) => {
                setCurrentSort(e.target.value as Sort);
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
              value={currentSort}
              className="rounded-none border-r-0"
            >
              <option value="added">
                {intl.formatMessage(messages.sortAdded)}
              </option>
              <option value="modified">
                {intl.formatMessage(messages.sortModified)}
              </option>
            </select>
            <Tooltip content={intl.formatMessage(messages.sortDirection)}>
              <Button
                buttonType="default"
                className="app-control-shadow-exempt z-40 mr-2 rounded-l-none px-3"
                buttonSize="md"
                onClick={() =>
                  setCurrentSortDirection(
                    currentSortDirection === 'asc' ? 'desc' : 'asc'
                  )
                }
              >
                {currentSortDirection === 'asc' ? (
                  <ArrowUpIcon className="h-6 w-6" />
                ) : (
                  <ArrowDownIcon className="h-6 w-6" />
                )}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

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
