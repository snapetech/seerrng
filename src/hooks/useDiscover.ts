import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import {
  setPersistentResponse,
  usePersistentResponse,
} from '@app/utils/swrCache';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { buildDiscoverQueryString } from '@server/utils/discoverQuery';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';
import useSettings from './useSettings';
import { Permission, useUser } from './useUser';

export { encodeURIExtraParams } from '@server/utils/discoverQuery';

export interface BaseSearchResult<T> {
  page: number;
  totalResults: number;
  totalPages: number;
  results: T[];
}

interface BaseMedia {
  id: number | string;
  mediaType: string;
  mediaInfo?: {
    status: MediaStatus;
    serviceId?: number | null;
    externalServiceId?: number | null;
    audiobookServiceId?: number | null;
    audiobookExternalServiceId?: number | null;
    requests?: {
      status: MediaRequestStatus;
      bookFormat?: 'ebook' | 'audiobook' | 'both' | null;
    }[];
  };
}

interface DiscoverResult<T, S> {
  isLoadingInitialData: boolean;
  isLoadingMore: boolean;
  isValidating: boolean;
  fetchMore: () => void;
  isEmpty: boolean;
  isReachingEnd: boolean;
  error: unknown;
  titles: T[];
  firstResultData?: BaseSearchResult<T> & S;
  mutate?: () => void;
}

const FILTERED_EMPTY_PAGE_SCAN_LIMIT = 10;

const getShuffleSeed = (): string => Math.random().toString(36).slice(2);

const hasLinkedBookFormat = (
  mediaInfo: NonNullable<BaseMedia['mediaInfo']>,
  format: 'ebook' | 'audiobook'
) => {
  if (format === 'audiobook') {
    return (
      mediaInfo.audiobookServiceId !== null &&
      mediaInfo.audiobookServiceId !== undefined &&
      mediaInfo.audiobookExternalServiceId !== null &&
      mediaInfo.audiobookExternalServiceId !== undefined
    );
  }

  return (
    mediaInfo.serviceId !== null &&
    mediaInfo.serviceId !== undefined &&
    mediaInfo.externalServiceId !== null &&
    mediaInfo.externalServiceId !== undefined
  );
};

const hasActiveBookRequest = (
  mediaInfo: NonNullable<BaseMedia['mediaInfo']>,
  format: 'ebook' | 'audiobook'
) => {
  return (mediaInfo.requests ?? []).some((request) => {
    if (
      request.status === MediaRequestStatus.DECLINED ||
      request.status === MediaRequestStatus.FAILED ||
      request.status === MediaRequestStatus.COMPLETED
    ) {
      return false;
    }

    const requestFormat = request.bookFormat ?? 'ebook';

    return requestFormat === 'both' || requestFormat === format;
  });
};

const isMissingBookFormat = (item: BaseMedia) => {
  if (
    item.mediaType !== 'book' ||
    !item.mediaInfo ||
    item.mediaInfo.status === MediaStatus.BLOCKLISTED
  ) {
    return false;
  }

  const hasEbook =
    hasLinkedBookFormat(item.mediaInfo, 'ebook') ||
    hasActiveBookRequest(item.mediaInfo, 'ebook');
  const hasAudiobook =
    hasLinkedBookFormat(item.mediaInfo, 'audiobook') ||
    hasActiveBookRequest(item.mediaInfo, 'audiobook');

  return !hasEbook || !hasAudiobook;
};

const getMediaResultKey = (item: BaseMedia): string =>
  `${item.mediaType}:${item.id}`;

const isDiscoverMediaResult = (item: unknown): item is BaseMedia => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const candidate = item as Partial<BaseMedia>;

  return (
    (typeof candidate.id === 'number' || typeof candidate.id === 'string') &&
    typeof candidate.mediaType === 'string'
  );
};

const useDiscover = <
  T extends BaseMedia,
  S = Record<string, never>,
  O = Record<string, unknown>,
>(
  endpoint: string,
  options?: O,
  {
    enabled = true,
    hideAvailable = true,
    hideBlocklisted = true,
    randomizeOrder = false,
    showErrorToast = true,
    shouldRetryOnError = true,
  } = {}
): DiscoverResult<T, S> => {
  const settings = useSettings();
  const { hasPermission, user } = useUser();
  const { addToast } = useToasts();
  const intl = useIntl();
  const [shuffleSeed, setShuffleSeed] = useState(getShuffleSeed);
  const fallbackCacheKey = useMemo(
    () =>
      `discover-view:${user?.id ?? 'anonymous'}:${endpoint}:${buildDiscoverQueryString(
        (options ?? {}) as Record<string, unknown>
      )}:${randomizeOrder ? 'random' : 'stable'}`,
    [endpoint, options, randomizeOrder, user?.id]
  );
  const persistentFallbackData =
    usePersistentResponse<(BaseSearchResult<T> & S)[]>(fallbackCacheKey);
  // A randomized view gets a new seed on each mount. Restoring results produced
  // with the previous seed would paint one lineup and then replace it as soon as
  // the current request completes.
  const fallbackData = randomizeOrder ? undefined : persistentFallbackData;
  const {
    data,
    error,
    size,
    setSize,
    isValidating,
    mutate: revalidate,
  } = useSWRInfinite<BaseSearchResult<T> & S>(
    (pageIndex: number, previousPageData) => {
      if (!enabled) {
        return null;
      }

      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }

      const params: Record<string, unknown> = {
        page: pageIndex + 1,
        ...options,
      };

      if (randomizeOrder) {
        params.shuffleSeed = shuffleSeed;
      }

      return `${endpoint}?${buildDiscoverQueryString(params)}`;
    },
    {
      initialSize: 1,
      // Loading the next page should only append that page. Availability and
      // request state are refreshed explicitly when a cached view is restored.
      revalidateFirstPage: false,
      dedupingInterval: 30000,
      revalidateOnFocus: false,
      fallbackData,
      shouldRetryOnError,
    }
  );

  const isLoadingInitialData = enabled && !data && !error;

  useEffect(() => {
    if (fallbackData) {
      void revalidate();
    }
  }, [fallbackData, revalidate]);

  const isLoadingMore =
    isLoadingInitialData ||
    (size > 0 &&
      !!data &&
      typeof data[size - 1] === 'undefined' &&
      isValidating);

  const fetchMore = useCallback(() => {
    setSize((currentSize) => currentSize + 1);
  }, [setSize]);

  const mutate = useCallback(() => {
    if (randomizeOrder) {
      setSize(1);
      setShuffleSeed(getShuffleSeed());
      return;
    }

    void revalidate();
  }, [randomizeOrder, revalidate, setSize]);

  const canViewBlocklist = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );
  const titles = useMemo(() => {
    const resultKeys = new Set<string>();
    let filteredTitles: T[] = [];

    for (const page of data ?? []) {
      if (!page || !Array.isArray(page.results)) {
        continue;
      }

      for (const result of page.results) {
        if (!isDiscoverMediaResult(result)) {
          continue;
        }

        const resultKey = getMediaResultKey(result);

        if (!resultKeys.has(resultKey)) {
          resultKeys.add(resultKey);
          filteredTitles.push(result);
        }
      }
    }

    if (settings.currentSettings.hideAvailable && hideAvailable) {
      filteredTitles = filteredTitles.filter(
        (i) =>
          !i.mediaInfo ||
          !(
            i.mediaInfo.status === MediaStatus.AVAILABLE ||
            i.mediaInfo.status === MediaStatus.PARTIALLY_AVAILABLE
          ) ||
          isMissingBookFormat(i)
      );
    }

    if (
      hideBlocklisted &&
      (settings.currentSettings.hideBlocklisted || !canViewBlocklist)
    ) {
      filteredTitles = filteredTitles.filter(
        (i) => !i.mediaInfo || i.mediaInfo.status !== MediaStatus.BLOCKLISTED
      );
    }

    return filteredTitles;
  }, [
    canViewBlocklist,
    data,
    hideAvailable,
    hideBlocklisted,
    settings.currentSettings.hideAvailable,
    settings.currentSettings.hideBlocklisted,
  ]);

  const rawResultCount = useMemo(
    () =>
      (data ?? []).reduce(
        (total, page) =>
          total + (Array.isArray(page?.results) ? page.results.length : 0),
        0
      ),
    [data]
  );
  const lastResultPage = data?.[data.length - 1];
  const lastResultPageResults = Array.isArray(lastResultPage?.results)
    ? lastResultPage.results
    : [];
  const hasMoreUnfilteredResults =
    !!lastResultPage &&
    lastResultPageResults.length >= 20 &&
    lastResultPage.totalResults > size * 20;
  const shouldScanNextFilteredPage =
    !isLoadingInitialData &&
    !isLoadingMore &&
    !isValidating &&
    titles.length === 0 &&
    rawResultCount > 0 &&
    hasMoreUnfilteredResults &&
    size < FILTERED_EMPTY_PAGE_SCAN_LIMIT;
  const isEmpty =
    !isLoadingInitialData && titles.length === 0 && !shouldScanNextFilteredPage;
  const isReachingEnd =
    (!!data && lastResultPageResults.length < 20) ||
    (!!data && (lastResultPage?.totalResults ?? 0) <= size * 20) ||
    (!!data && (lastResultPage?.totalResults ?? 0) < 41) ||
    (titles.length === 0 &&
      rawResultCount > 0 &&
      size >= FILTERED_EMPTY_PAGE_SCAN_LIMIT);

  useEffect(() => {
    if (shouldScanNextFilteredPage) {
      setSize((currentSize) => currentSize + 1);
    }
  }, [setSize, shouldScanNextFilteredPage]);

  useEffect(() => {
    if (!randomizeOrder && data?.length && titles.length) {
      setPersistentResponse(fallbackCacheKey, data);
    }
  }, [data, fallbackCacheKey, randomizeOrder, titles.length]);

  useEffect(() => {
    if (showErrorToast && error && titles.length) {
      addToast(intl.formatMessage(globalMessages.error), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  }, [data, error, addToast, intl, showErrorToast, titles.length]);

  return {
    isLoadingInitialData,
    isLoadingMore,
    isValidating,
    fetchMore,
    isEmpty,
    isReachingEnd,
    error: error && titles.length ? null : error,
    titles,
    firstResultData: data?.[0],
    mutate,
  };
};

export default useDiscover;
