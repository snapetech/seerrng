import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import BookFormatTabs, {
  type BookDiscoveryFormat,
} from '@app/components/Discover/BookFormatTabs';
import ReadMeABookSearch from '@app/components/Discover/DiscoverBooks/ReadMeABookSearch';
import {
  FilterResetButton,
  getFilterToggleButtonClass,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import LibraryFilterFields from '@app/components/Discover/FilterPanel/LibraryFilterFields';
import { bookSortOptions } from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import PinnedFilterSection from '@app/components/Discover/PinnedFilterSection';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import useDiscoverScrollRestoration from '@app/hooks/useDiscoverScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import useSettings from '@app/hooks/useSettings';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { parseQueryFromPath } from '@app/utils/routeQuery';
import { isOptionalCatalogPathEnabled } from '@app/utils/serviceAvailability';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type { BookResult } from '@server/models/Book';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverBooks', {
  books: 'Books',
  audiobooks: 'Audiobooks',
  mediaFilters: 'Media Filters',
  filters: 'Filters',
  sortBy: 'Sort By',
  clearFilters: 'Clear Filters',
  recommended: 'Recommended',
  trending: 'Trending',
  rating: 'Rating',
  editions: 'Most Editions',
  date: 'First Published',
  random: 'Random',
  unavailable: 'Book discovery is unavailable right now.',
  unavailableHint: 'Open Library could not be reached. Try again.',
  retry: 'Try Again',
  retrying: 'Trying Again…',
});

interface DiscoverBooksProps {
  format?: BookDiscoveryFormat;
  titleOverride?: string;
  mediaFilters?: ReactNode;
  showFormatTabs?: boolean;
  defaultSortBy?: 'ranked' | 'trending';
}

const DiscoverBooks = ({
  format = 'ebook',
  titleOverride,
  mediaFilters,
  showFormatTabs = true,
  defaultSortBy = 'ranked',
}: DiscoverBooksProps) => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();
  const [currentPath, setCurrentPath] = useState<string>();
  useEffect(() => {
    const syncCurrentPath = () => {
      setCurrentPath(`${window.location.pathname}${window.location.search}`);
    };

    syncCurrentPath();
    router.events.on('routeChangeComplete', syncCurrentPath);

    return () => {
      router.events.off('routeChangeComplete', syncCurrentPath);
    };
  }, [router.events]);
  const routeQuery = currentPath
    ? parseQueryFromPath(currentPath)
    : router.query;
  const isRouteReady = currentPath !== undefined;
  const update = useBatchUpdateQueryParams(routeQuery);
  const query = typeof routeQuery.search === 'string' ? routeQuery.search : '';
  const authorQuery =
    typeof routeQuery.author === 'string' ? routeQuery.author : '';
  const [author, debouncedAuthor, setAuthor] = useDebouncedState(authorQuery);
  const routedAuthorRef = useRef(authorQuery.trim());
  useEffect(() => {
    const routedAuthor = authorQuery.trim();
    if (routedAuthor !== routedAuthorRef.current) {
      routedAuthorRef.current = routedAuthor;
      setAuthor(authorQuery);
    }
  }, [authorQuery, setAuthor]);
  const routedFormat =
    routeQuery.format === 'all' ||
    routeQuery.format === 'ebook' ||
    routeQuery.format === 'audiobook'
      ? routeQuery.format
      : undefined;
  const ebookEnabled = isOptionalCatalogPathEnabled(
    '/discover/books',
    currentSettings
  );
  const audiobookEnabled = isOptionalCatalogPathEnabled(
    '/discover/audiobooks',
    currentSettings
  );
  const availableFormats: BookDiscoveryFormat[] = [
    ...(ebookEnabled && audiobookEnabled ? ['all' as const] : []),
    ...(ebookEnabled ? ['ebook' as const] : []),
    ...(audiobookEnabled ? ['audiobook' as const] : []),
  ];
  const requestedFormat = routedFormat ?? format;
  const activeFormat =
    requestedFormat === 'all' && !(ebookEnabled && audiobookEnabled)
      ? ebookEnabled
        ? 'ebook'
        : 'audiobook'
      : requestedFormat === 'ebook' && !ebookEnabled && audiobookEnabled
        ? 'audiobook'
        : requestedFormat === 'audiobook' && !audiobookEnabled && ebookEnabled
          ? 'ebook'
          : requestedFormat;
  const hasEnabledBookFormat = ebookEnabled || audiobookEnabled;

  useEffect(() => {
    if (
      !currentPath ||
      !hasEnabledBookFormat ||
      activeFormat === requestedFormat
    ) {
      return;
    }

    const target = new URL(currentPath, window.location.origin);
    if (router.pathname === '/discover/trending') {
      target.searchParams.set(
        'mediaType',
        activeFormat === 'audiobook' ? 'audiobook' : 'book'
      );
    } else {
      target.pathname =
        activeFormat === 'audiobook'
          ? '/discover/audiobooks'
          : '/discover/books';
      if (activeFormat === 'ebook') {
        target.searchParams.set('format', 'ebook');
      } else {
        target.searchParams.delete('format');
      }
    }

    void router.replace(`${target.pathname}${target.search}${target.hash}`);
  }, [
    activeFormat,
    currentPath,
    hasEnabledBookFormat,
    requestedFormat,
    router,
  ]);
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    const routedSearch = query.trim();
    if (routedSearch !== routedSearchRef.current) {
      routedSearchRef.current = routedSearch;
      setSearch(query);
    }
  }, [query, setSearch]);
  const subject =
    typeof routeQuery.subject === 'string' ? routeQuery.subject : '';
  const firstPublishYear =
    typeof routeQuery.firstPublishYear === 'string'
      ? routeQuery.firstPublishYear
      : '';
  const language =
    typeof routeQuery.language === 'string' ? routeQuery.language : '';
  const minRating =
    typeof routeQuery.minRating === 'string' ? routeQuery.minRating : '';
  const sortBy =
    typeof routeQuery.sortBy === 'string' &&
    bookSortOptions.has(routeQuery.sortBy)
      ? routeQuery.sortBy
      : defaultSortBy;
  const discover = useDiscover<BookResult>(
    '/api/v1/discover/books',
    {
      query,
      author: authorQuery,
      subject,
      firstPublishYear,
      language,
      minRating,
      sortBy,
      format: activeFormat === 'all' ? undefined : activeFormat,
      // Bump the cached contract because all-format discovery now returns
      // format-tagged results from both Open Library and Bookshelf catalogs.
      responseVersion: 3,
    },
    {
      enabled: isRouteReady && hasEnabledBookFormat,
      randomizeOrder:
        sortBy === 'ranked' || sortBy === 'ranked.asc' || sortBy === 'random',
      showErrorToast: false,
      hideErrorWithResults: false,
    }
  );
  useSearchActivityReporter(
    Boolean(search.trim()) &&
      isRouteReady &&
      (search.trim() !== query.trim() ||
        discover.isLoadingInitialData ||
        discover.isValidating),
    'books-keyword'
  );
  useDiscoverScrollRestoration({
    mediaType: 'book',
    itemCount: discover.titles.length,
    shuffleSeed: discover.shuffleSeed,
    isLoading:
      !isRouteReady || discover.isLoadingInitialData || discover.isLoadingMore,
    isReachingEnd: discover.isReachingEnd,
    fetchMore: discover.fetchMore,
  });
  const setParam = (values: Record<string, string | undefined>) =>
    update({ ...values, page: undefined });
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();

    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update(
        { search: nextSearch || undefined, page: undefined },
        { shallow: true, scroll: false }
      );
    }
  }, [debouncedSearch, update]);
  useEffect(() => {
    const nextAuthor = debouncedAuthor.trim();
    if (nextAuthor !== routedAuthorRef.current) {
      routedAuthorRef.current = nextAuthor;
      update(
        { author: nextAuthor || undefined, page: undefined },
        { shallow: true, scroll: false }
      );
    }
  }, [debouncedAuthor, update]);
  useSearchActivityReporter(
    Boolean(author.trim()) &&
      isRouteReady &&
      (author.trim() !== authorQuery.trim() ||
        discover.isLoadingInitialData ||
        discover.isValidating),
    'books-author'
  );
  const title =
    titleOverride ??
    intl.formatMessage(
      router.pathname === '/discover/audiobooks'
        ? messages.audiobooks
        : messages.books
    );
  const hasActiveFilters = Boolean(
    query ||
    authorQuery ||
    subject ||
    firstPublishYear ||
    language ||
    minRating ||
    sortBy !== defaultSortBy
  );
  const providerMessage = (
    discover.error as { response?: { data?: { message?: string } } } | undefined
  )?.response?.data?.message;
  return (
    <>
      <PageTitle title={title} />
      <div className="app-filter-section-gap">
        <Header>{title}</Header>
        {activeFormat === 'audiobook' && <ReadMeABookSearch />}
        {mediaFilters}
        {showFormatTabs && (
          <PinnedFilterSection
            mediaType="book"
            section="mediaFilters"
            label={intl.formatMessage(messages.mediaFilters)}
          >
            <BookFormatTabs
              format={activeFormat}
              availableFormats={availableFormats}
              query={routeQuery}
              currentPath={currentPath}
            />
          </PinnedFilterSection>
        )}
        <PinnedFilterSection
          mediaType="book"
          section="filters"
          label={intl.formatMessage(messages.filters)}
        >
          <div className="app-filter-row">
            <FilterResetButton
              label={intl.formatMessage(messages.clearFilters)}
              selected={!hasActiveFilters}
              onClick={() => {
                setSearch('');
                setAuthor('');
                setParam({
                  search: undefined,
                  author: undefined,
                  subject: undefined,
                  firstPublishYear: undefined,
                  language: undefined,
                  minRating: undefined,
                  sortBy: undefined,
                });
              }}
            />
            <CardTextVisibilityToggle mediaType="book" />
            <LibraryFilterFields
              mediaType="book"
              audiobook={activeFormat === 'audiobook'}
              search={search}
              onSearchChange={setSearch}
              onSearchSubmit={() => {
                const nextSearch = search.trim();
                routedSearchRef.current = nextSearch;
                update(
                  { search: nextSearch || undefined, page: undefined },
                  { shallow: true, scroll: false }
                );
              }}
              author={author}
              onAuthorChange={setAuthor}
              onAuthorSubmit={() => {
                const nextAuthor = author.trim();
                routedAuthorRef.current = nextAuthor;
                update(
                  { author: nextAuthor || undefined, page: undefined },
                  { shallow: true, scroll: false }
                );
              }}
              firstPublishYear={firstPublishYear}
              subject={subject}
              minRating={minRating}
              language={language}
              setParam={setParam}
            />
          </div>
        </PinnedFilterSection>
        <PinnedFilterSection
          mediaType="book"
          section="sortBy"
          label={intl.formatMessage(messages.sortBy)}
        >
          <div className="app-filter-row">
            <button
              className={getFilterToggleButtonClass(
                sortBy === 'ranked' || sortBy === 'ranked.asc'
              )}
              onClick={() =>
                setParam({
                  sortBy: sortBy === 'ranked' ? 'ranked.asc' : 'ranked',
                })
              }
            >
              {intl.formatMessage(messages.recommended)}
              {sortBy === 'ranked.asc' ? (
                <BarsArrowUpIcon className="app-action-icon" />
              ) : (
                <BarsArrowDownIcon className="app-action-icon" />
              )}
            </button>
            <button
              className={getFilterToggleButtonClass(sortBy === 'trending')}
              onClick={() => setParam({ sortBy: 'trending' })}
            >
              {intl.formatMessage(messages.trending)}
            </button>
            <button
              className={getFilterToggleButtonClass(
                sortBy === 'rating' ||
                  sortBy === 'rating.desc' ||
                  sortBy === 'rating.asc'
              )}
              onClick={() =>
                setParam({
                  sortBy:
                    sortBy === 'rating' || sortBy === 'rating.desc'
                      ? 'rating.asc'
                      : 'rating.desc',
                })
              }
            >
              {intl.formatMessage(messages.rating)}
              {sortBy === 'rating.asc' ? (
                <BarsArrowUpIcon className="app-action-icon" />
              ) : (
                <BarsArrowDownIcon className="app-action-icon" />
              )}
            </button>
            <button
              className={getFilterToggleButtonClass(
                sortBy === 'editions' || sortBy === 'editions.asc'
              )}
              onClick={() =>
                setParam({
                  sortBy: sortBy === 'editions' ? 'editions.asc' : 'editions',
                })
              }
            >
              {intl.formatMessage(messages.editions)}
              {sortBy === 'editions.asc' ? (
                <BarsArrowUpIcon className="app-action-icon" />
              ) : (
                <BarsArrowDownIcon className="app-action-icon" />
              )}
            </button>
            <button
              className={getFilterToggleButtonClass(
                sortBy === 'newest' || sortBy === 'oldest'
              )}
              onClick={() =>
                setParam({ sortBy: sortBy === 'newest' ? 'oldest' : 'newest' })
              }
            >
              {intl.formatMessage(messages.date)}
              {sortBy === 'oldest' ? (
                <BarsArrowUpIcon className="app-action-icon" />
              ) : (
                <BarsArrowDownIcon className="app-action-icon" />
              )}
            </button>
            <button
              className={getFilterToggleButtonClass(sortBy === 'random')}
              onClick={() =>
                sortBy === 'random'
                  ? discover.mutate?.()
                  : setParam({ sortBy: 'random' })
              }
            >
              {intl.formatMessage(messages.random)}
              <BarsArrowDownIcon className="app-action-icon" />
            </button>
          </div>
        </PinnedFilterSection>
      </div>
      {discover.error && (
        <div
          className="mt-6 flex flex-col items-start gap-4 rounded-xl border border-red-500/50 bg-red-500/10 p-6 text-red-100 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="font-medium">
              {providerMessage ?? intl.formatMessage(messages.unavailable)}
            </p>
            <p className="mt-1 text-sm text-red-100/80">
              {intl.formatMessage(messages.unavailableHint)}
            </p>
          </div>
          <Button
            buttonType="warning"
            buttonSize="sm"
            disabled={discover.isValidating}
            onClick={() => discover.mutate?.()}
          >
            {intl.formatMessage(
              discover.isValidating ? messages.retrying : messages.retry
            )}
          </Button>
        </div>
      )}
      {(!discover.error || discover.titles.length > 0) && (
        <ListView
          items={discover.titles}
          preferredBookFormat={
            activeFormat === 'audiobook' ? 'audiobook' : 'ebook'
          }
          showAllBookFormats={activeFormat === 'all'}
          isEmpty={isRouteReady && discover.isEmpty}
          isLoading={
            !isRouteReady ||
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
export default DiscoverBooks;
