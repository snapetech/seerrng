import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import {
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { BOOK_GENRES } from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import { tvNetworks } from '@app/components/Discover/NetworkSlider';
import { studios } from '@app/components/Discover/StudioSlider';
import IssueItem from '@app/components/IssueList/IssueItem';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import {
  getPositiveQueryParamNumber,
  useUpdateQueryParams,
} from '@app/hooks/useUpdateQueryParams';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  BarsArrowDownIcon,
  BarsArrowUpIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
} from '@heroicons/react/24/outline';
import type { TmdbGenre } from '@server/api/themoviedb/interfaces';
import type { IssueResultsResponse } from '@server/interfaces/api/issueInterfaces';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.IssueList', {
  issues: 'Issues',
  allIssues: 'All Issues',
  taskFilters: 'Task Filters',
  mediaFilters: 'Media Filters',
  filters: 'Filters',
  clearFilters: 'Clear Filters',
  sortBy: 'Sort By',
  sortDate: 'Date',
  sortModified: 'Last Modified',
  sortStatus: 'Status',
  timePeriod: 'Time Period',
  sevenDays: 'Last 7 Days',
  fourteenDays: 'Last 14 Days',
  thirtyDays: 'Last 30 Days',
  sixMonths: 'Last 6 Months',
  allTime: 'All Time',
  search: 'Keyword Search',
  searchIssues: 'Search Issues',
  allMedia: 'All Media',
  movies: 'Movies',
  series: 'Series',
  music: 'Music',
  books: 'Books',
  issueType: 'Issue Type',
  releaseDate: 'Release Date',
  releaseYear: 'Release Year',
  firstPublished: 'First Published',
  genres: 'Genres',
  studio: 'Studio',
  network: 'Network',
  albumType: 'Album Type',
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  any: 'Any',
  audio: 'Audio',
  video: 'Video',
  subtitle: 'Subtitle',
  other: 'Other',
  showAllIssues: 'Show All Issues',
});

type Filter = 'all' | 'open' | 'resolved';
type Sort = 'added' | 'modified' | 'status';
type Direction = 'asc' | 'desc';
type TimeFrame = '7d' | '14d' | '30d' | '6m' | 'all';
type MediaFilter = 'all' | 'movie' | 'tv' | 'music' | 'book';
type IssueTypeFilter = 'all' | 'audio' | 'video' | 'subtitle' | 'other';

const IssueList = () => {
  const intl = useIntl();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('added');
  const [direction, setDirection] = useState<Direction>('desc');
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [issueTypeFilter, setIssueTypeFilter] =
    useState<IssueTypeFilter>('all');
  const [releaseYearFilter, setReleaseYearFilter] = useState('any');
  const [genreFilter, setGenreFilter] = useState('');
  const [studioFilter, setStudioFilter] = useState('');
  const [networkFilter, setNetworkFilter] = useState('');
  const [albumTypeFilter, setAlbumTypeFilter] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [search, debouncedSearch, setSearch] = useDebouncedState('');
  const page = getPositiveQueryParamNumber(router.query.page, 1) ?? 1;
  const pageIndex = page - 1;
  const updateQueryParams = useUpdateQueryParams({ page: page.toString() });
  const params = new URLSearchParams({
    take: String(pageSize),
    skip: String(pageIndex * pageSize),
    filter,
    sort,
    sortDirection: direction,
    timeFrame,
    mediaType: mediaFilter,
    issueType: issueTypeFilter,
  });
  if (mediaFilter !== 'all') {
    if (releaseYearFilter !== 'any') {
      params.set('releaseYear', releaseYearFilter);
    }
    if (genreFilter) params.set('genre', genreFilter);
    if (mediaFilter === 'movie' && studioFilter) {
      params.set('studio', studioFilter);
    }
    if (mediaFilter === 'tv' && networkFilter) {
      params.set('network', networkFilter);
    }
    if (mediaFilter === 'music' && albumTypeFilter) {
      params.set('albumType', albumTypeFilter);
    }
  }
  if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
  const { data, error, isValidating } = useSWR<IssueResultsResponse>(
    `/api/v1/issue?${params.toString()}`
  );
  useSearchActivityReporter(
    Boolean(search.trim()) &&
      (search.trim() !== debouncedSearch.trim() || isValidating),
    'issues-keyword'
  );
  const { data: availableGenres } = useSWR<TmdbGenre[]>(
    mediaFilter === 'movie' || mediaFilter === 'tv'
      ? `/api/v1/genres/${mediaFilter}`
      : null
  );

  if (!data && !error) return <LoadingSpinner />;
  if (!data) return <ErrorPage statusCode={500} />;

  const resetPage = () => page !== 1 && updateQueryParams('page', '1');
  const clearMediaSpecificFilters = () => {
    setReleaseYearFilter('any');
    setGenreFilter('');
    setStudioFilter('');
    setNetworkFilter('');
    setAlbumTypeFilter('');
  };
  const changePage = (nextPage: number) => {
    updateQueryParams('page', String(nextPage));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const updateSort = (nextSort: Sort) => {
    setDirection(
      sort === nextSort ? (direction === 'asc' ? 'desc' : 'asc') : 'desc'
    );
    setSort(nextSort);
    resetPage();
  };
  const clearFilters = () => {
    setFilter('all');
    setTimeFrame('all');
    setMediaFilter('all');
    setIssueTypeFilter('all');
    clearMediaSpecificFilters();
    setSearch('');
    setSort('added');
    setDirection('desc');
    resetPage();
  };
  const totalPages = Math.max(data.pageInfo.pages, 1);
  const currentYear = new Date().getFullYear();
  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...Array.from({ length: currentYear - 1969 }, (_, index) => {
      const year = currentYear - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const genreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...(mediaFilter === 'movie' || mediaFilter === 'tv'
      ? (availableGenres ?? []).map((genre) => ({
          label: genre.name,
          value: genre.name.toLocaleLowerCase(),
        }))
      : mediaFilter === 'music'
        ? [
            'Alternative',
            'Classical',
            'Country',
            'Electronic',
            'Hip-Hop',
            'Jazz',
            'Metal',
            'Pop',
            'Rock',
          ].map((genre) => ({
            label: genre,
            value: genre.toLocaleLowerCase(),
          }))
        : BOOK_GENRES.map(([, label]) => ({
            label,
            value: label.toLocaleLowerCase(),
          }))),
  ];
  const issueTypeOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'all' },
    { label: intl.formatMessage(messages.audio), value: 'audio' },
    { label: intl.formatMessage(messages.video), value: 'video' },
    { label: intl.formatMessage(messages.subtitle), value: 'subtitle' },
    { label: intl.formatMessage(messages.other), value: 'other' },
  ];
  const timeFrameOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.allTime), value: 'all' },
    { label: intl.formatMessage(messages.sevenDays), value: '7d' },
    { label: intl.formatMessage(messages.fourteenDays), value: '14d' },
    { label: intl.formatMessage(messages.thirtyDays), value: '30d' },
    { label: intl.formatMessage(messages.sixMonths), value: '6m' },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.issues)} />
      <h2 className="mt-8 text-2xl leading-7 font-bold text-gray-100 sm:text-4xl sm:leading-9">
        <span className="text-overseerr">
          {intl.formatMessage(messages.issues)}
        </span>
      </h2>
      <section className="app-filter-section-gap mt-4">
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.taskFilters)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearFilters}
            className={getFilterResetButtonClass(false)}
          >
            <NoSymbolIcon className="h-4 w-4" aria-hidden="true" />
            {intl.formatMessage(messages.clearFilters)}
          </button>
          {(
            [
              ['all', messages.allIssues, data.counts?.all ?? 0],
              ['open', globalMessages.open, data.counts?.open ?? 0],
              ['resolved', globalMessages.resolved, data.counts?.resolved ?? 0],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                resetPage();
              }}
              className={getFilterToggleButtonClass(filter === value)}
            >
              {intl.formatMessage(label)}
              <span className="rounded-full bg-black/25 px-1.5 text-[10px]">
                {count}
              </span>
            </button>
          ))}
          <CompactSelect
            label={intl.formatMessage(messages.issueType)}
            value={issueTypeFilter}
            options={issueTypeOptions}
            onChange={(value) => {
              setIssueTypeFilter(value as IssueTypeFilter);
              resetPage();
            }}
          />
        </div>
      </section>
      <section
        className="app-filter-section-gap"
        aria-label={intl.formatMessage(messages.mediaFilters)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.mediaFilters)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', messages.allMedia],
              ['movie', messages.movies],
              ['tv', messages.series],
              ['music', messages.music],
              ['book', messages.books],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mediaFilter === value}
              onClick={() => {
                setMediaFilter(value);
                clearMediaSpecificFilters();
                resetPage();
              }}
              className={getFilterToggleButtonClass(mediaFilter === value)}
            >
              {intl.formatMessage(label)}
            </button>
          ))}
        </div>
      </section>
      <section
        className="app-filter-section-gap"
        aria-label={intl.formatMessage(messages.filters)}
      >
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.filters)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompactSelect
            label={intl.formatMessage(messages.timePeriod)}
            value={timeFrame}
            options={timeFrameOptions}
            onChange={(value) => {
              setTimeFrame(value as TimeFrame);
              resetPage();
            }}
          />
          <label className="discover-filter-control w-72 flex-none self-center">
            <span
              className={`discover-filter-control-label gap-1 ${
                search.trim() ? 'discover-filter-control-label-active' : ''
              }`}
            >
              <MagnifyingGlassIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {intl.formatMessage(messages.search)}
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              placeholder={intl.formatMessage(messages.searchIssues)}
              aria-label={intl.formatMessage(messages.searchIssues)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </label>
          {mediaFilter !== 'all' && (
            <>
              <CompactSelect
                label={intl.formatMessage(
                  mediaFilter === 'music'
                    ? messages.releaseYear
                    : mediaFilter === 'book'
                      ? messages.firstPublished
                      : messages.releaseDate
                )}
                value={releaseYearFilter}
                options={yearOptions}
                onChange={(value) => {
                  setReleaseYearFilter(value);
                  resetPage();
                }}
              />
              <CompactSelect
                label={intl.formatMessage(messages.genres)}
                value={genreFilter}
                options={genreOptions}
                onChange={(value) => {
                  setGenreFilter(value);
                  resetPage();
                }}
              />
            </>
          )}
          {mediaFilter === 'movie' && (
            <CompactSelect
              label={intl.formatMessage(messages.studio)}
              value={studioFilter}
              options={[
                { label: intl.formatMessage(messages.any), value: '' },
                ...studios.map((studio) => ({
                  label: studio.name,
                  value: studio.name.toLocaleLowerCase(),
                })),
              ]}
              onChange={(value) => {
                setStudioFilter(value);
                resetPage();
              }}
            />
          )}
          {mediaFilter === 'tv' && (
            <CompactSelect
              label={intl.formatMessage(messages.network)}
              value={networkFilter}
              options={[
                { label: intl.formatMessage(messages.any), value: '' },
                ...tvNetworks.map((network) => ({
                  label: network.name,
                  value: network.name.toLocaleLowerCase(),
                })),
              ]}
              onChange={(value) => {
                setNetworkFilter(value);
                resetPage();
              }}
            />
          )}
          {mediaFilter === 'music' && (
            <CompactSelect
              label={intl.formatMessage(messages.albumType)}
              value={albumTypeFilter}
              options={[
                { label: intl.formatMessage(messages.any), value: '' },
                { label: intl.formatMessage(messages.album), value: 'album' },
                { label: intl.formatMessage(messages.ep), value: 'ep' },
                { label: intl.formatMessage(messages.single), value: 'single' },
              ]}
              onChange={(value) => {
                setAlbumTypeFilter(value);
                resetPage();
              }}
            />
          )}
        </div>
      </section>
      <section className="app-filter-section-gap">
        <div className="mb-2 text-sm text-gray-300">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['added', messages.sortDate],
              ['modified', messages.sortModified],
              ['status', messages.sortStatus],
            ] as const
          ).map(([value, label]) => {
            const active = sort === value;
            const Icon =
              active && direction === 'asc'
                ? BarsArrowUpIcon
                : BarsArrowDownIcon;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => updateSort(value)}
                className={getFilterToggleButtonClass(active)}
              >
                {intl.formatMessage(label)}
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </section>
      {data.results.map((issue) => (
        <div className="py-2" key={`issue-item-${issue.id}`}>
          <IssueItem issue={issue} />
        </div>
      ))}
      {data.results.length === 0 && (
        <div className="refreshed-card-surface flex min-h-16 w-full flex-col items-center justify-center rounded-xl border border-gray-700 px-4 py-4 text-white">
          <span className="refreshed-detail-text text-sm">
            {intl.formatMessage(globalMessages.noresults)}
          </span>
          {filter !== 'all' && (
            <Button
              buttonType="primary"
              className="mt-3"
              onClick={() => setFilter('all')}
            >
              {intl.formatMessage(messages.showAllIssues)}
            </Button>
          )}
        </div>
      )}
      <PaginationFooter
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={changePage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          resetPage();
        }}
      />
    </>
  );
};

export default IssueList;
