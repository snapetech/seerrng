import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import BookFormatTabs, {
  type BookDiscoveryFormat,
} from '@app/components/Discover/BookFormatTabs';
import {
  CompactRatingSelect,
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
  type RatingOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import {
  BOOK_GENRES,
  BOOK_LANGUAGES,
  bookSortOptions,
} from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import useDiscoverScrollRestoration from '@app/hooks/useDiscoverScrollRestoration';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { parseQueryFromPath } from '@app/utils/routeQuery';
import {
  BarsArrowDownIcon,
  BarsArrowUpIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid';
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
  search: 'Keyword Search',
  searchBooks: 'Search Books',
  clearFilters: 'Clear Filters',
  genres: 'Genres',
  firstPublished: 'First Published',
  language: 'Language',
  ratingFilter: 'Rating',
  any: 'Any',
  recommended: 'Recommended',
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
}

const DiscoverBooks = ({
  format = 'ebook',
  titleOverride,
  mediaFilters,
  showFormatTabs = true,
}: DiscoverBooksProps) => {
  const intl = useIntl();
  const router = useRouter();
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
  const routedFormat =
    routeQuery.format === 'ebook' || routeQuery.format === 'audiobook'
      ? routeQuery.format
      : undefined;
  const activeFormat = routedFormat ?? format;
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    routedSearchRef.current = query.trim();
    setSearch(query);
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
      : 'ranked';
  const discover = useDiscover<BookResult>(
    '/api/v1/discover/books',
    {
      query,
      subject,
      firstPublishYear,
      language,
      minRating,
      sortBy,
      format: activeFormat === 'all' ? undefined : activeFormat,
      // One-time response contract bump prevents browsers from substituting
      // the old stale-on-error empty response after this behavior changed.
      responseVersion: 2,
    },
    {
      enabled: isRouteReady,
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
      update({ search: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);
  const title =
    titleOverride ??
    intl.formatMessage(
      activeFormat === 'audiobook' ? messages.audiobooks : messages.books
    );
  const currentYear = new Date().getFullYear();
  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: currentYear - 1969 }, (_, index) => {
      const year = currentYear - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const genreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_GENRES.map(([value, label]) => ({ value, label })),
  ];
  const languageOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...BOOK_LANGUAGES.map(([value, label]) => ({ value, label })),
  ];
  const ratingOptions: RatingOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...Array.from({ length: 9 }, (_, index) => {
      const score = 1 + index * 0.5;
      return {
        label: `${score.toFixed(1)}+`,
        value: score.toFixed(1),
        score,
      };
    }),
  ];
  const hasActiveFilters = Boolean(
    query ||
    subject ||
    firstPublishYear ||
    language ||
    minRating ||
    sortBy !== 'ranked'
  );
  const providerMessage = (
    discover.error as { response?: { data?: { message?: string } } } | undefined
  )?.response?.data?.message;
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <Header>{title}</Header>
        {mediaFilters}
        {showFormatTabs && (
          <>
            <div className="app-filter-section-heading">
              {intl.formatMessage(messages.mediaFilters)}
            </div>
            <BookFormatTabs
              format={activeFormat}
              query={routeQuery}
              currentPath={currentPath}
            />
          </>
        )}
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.filters)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!hasActiveFilters}
            className={getFilterResetButtonClass(!hasActiveFilters)}
            onClick={() => {
              setSearch('');
              setParam({
                search: undefined,
                subject: undefined,
                firstPublishYear: undefined,
                language: undefined,
                minRating: undefined,
                sortBy: undefined,
              });
            }}
          >
            {intl.formatMessage(messages.clearFilters)}
          </button>
          <CardTextVisibilityToggle mediaType="book" />
          <form
            className="discover-filter-control w-72 max-w-full flex-none"
            onSubmit={(e) => {
              e.preventDefault();
              const nextSearch = search.trim();
              routedSearchRef.current = nextSearch;
              setParam({ search: nextSearch || undefined });
            }}
          >
            <span
              className={`discover-filter-control-label gap-1.5 ${
                search.trim() ? 'discover-filter-control-label-active' : ''
              }`}
            >
              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={intl.formatMessage(messages.searchBooks)}
              aria-label={intl.formatMessage(messages.searchBooks)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </form>
          <CompactSelect
            label={intl.formatMessage(messages.firstPublished)}
            value={firstPublishYear}
            options={yearOptions}
            onChange={(value) =>
              setParam({ firstPublishYear: value || undefined })
            }
          />
          <CompactSelect
            label={intl.formatMessage(messages.genres)}
            value={subject}
            options={genreOptions}
            onChange={(value) => setParam({ subject: value || undefined })}
          />
          <CompactRatingSelect
            label={intl.formatMessage(messages.ratingFilter)}
            value={minRating}
            options={ratingOptions}
            maxScore={5}
            onChange={(value) => setParam({ minRating: value || undefined })}
          />
          <CompactSelect
            label={intl.formatMessage(messages.language)}
            value={language}
            options={languageOptions}
            onChange={(value) => setParam({ language: value || undefined })}
          />
        </div>
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap gap-2">
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
              <BarsArrowUpIcon className="h-4 w-4" />
            ) : (
              <BarsArrowDownIcon className="h-4 w-4" />
            )}
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
              <BarsArrowUpIcon className="h-4 w-4" />
            ) : (
              <BarsArrowDownIcon className="h-4 w-4" />
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
              <BarsArrowUpIcon className="h-4 w-4" />
            ) : (
              <BarsArrowDownIcon className="h-4 w-4" />
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
              <BarsArrowUpIcon className="h-4 w-4" />
            ) : (
              <BarsArrowDownIcon className="h-4 w-4" />
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
            <BarsArrowDownIcon className="h-4 w-4" />
          </button>
        </div>
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
