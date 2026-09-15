import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import AvailabilityQualityControl, {
  type AvailabilityQuality,
} from '@app/components/Discover/AvailabilityQualityControl';
import {
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { musicSortOptions } from '@app/components/Discover/FilterPanel/libraryFilterUtils';
import BulkRequestModal from '@app/components/RequestModal/BulkRequestModal';
import PlaylistImportModal from '@app/components/RequestModal/PlaylistImportModal';
import useDebouncedState from '@app/hooks/useDebouncedState';
import useDiscover from '@app/hooks/useDiscover';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import {
  BarsArrowDownIcon,
  BarsArrowUpIcon,
  MagnifyingGlassIcon,
  QueueListIcon,
} from '@heroicons/react/24/solid';
import type { PlaylistResolutionResponse } from '@server/interfaces/api/playlistInterfaces';
import type { AlbumResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMusic', {
  music: 'Music',
  filters: 'Filters',
  sortBy: 'Sort By',
  search: 'Keyword Search',
  searchMusic: 'Search Music',
  clearFilters: 'Clear Filters',
  genres: 'Genres',
  releaseType: 'Release Type',
  releaseYear: 'Release Year',
  any: 'Any',
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  recommended: 'Recommended',
  week: 'Popular This Week',
  month: 'Popular This Month',
  year: 'Popular This Year',
  listened: 'Most Listened',
  releaseDate: 'Release Date',
  loadError: 'Music discovery could not be loaded right now.',
  importPlaylist: 'Import Playlist',
});
const genres = [
  'Alternative',
  'Classical',
  'Country',
  'Electronic',
  'Hip-Hop',
  'Jazz',
  'Metal',
  'Pop',
  'Rock',
];
const musicSorts = [
  { label: messages.recommended, asc: 'ranked.asc', desc: 'ranked' },
  {
    label: messages.week,
    asc: 'popular.week.asc',
    desc: 'popular.week',
  },
  {
    label: messages.month,
    asc: 'popular.month.asc',
    desc: 'popular.month',
  },
  {
    label: messages.year,
    asc: 'popular.year.asc',
    desc: 'popular.year',
  },
  {
    label: messages.listened,
    asc: 'listen_count.asc',
    desc: 'listen_count.desc',
  },
  {
    label: messages.releaseDate,
    asc: 'release_date.asc',
    desc: 'release_date.desc',
  },
] as const;
interface DiscoverMusicProps {
  titleOverride?: string;
  mediaFilters?: ReactNode;
}

const DiscoverMusic = ({
  titleOverride,
  mediaFilters,
}: DiscoverMusicProps = {}) => {
  const intl = useIntl();
  const router = useRouter();
  const update = useBatchUpdateQueryParams({});
  const query =
    typeof router.query.search === 'string' ? router.query.search : '';
  const [search, debouncedSearch, setSearch] = useDebouncedState(query);
  const routedSearchRef = useRef(query.trim());
  useEffect(() => {
    routedSearchRef.current = query.trim();
    setSearch(query);
  }, [query, setSearch]);
  const genre =
    typeof router.query.genre === 'string' ? router.query.genre : '';
  const availability: AvailabilityQuality | undefined =
    router.query.availability === 'mp3' || router.query.availability === 'flac'
      ? router.query.availability
      : undefined;
  const releaseType =
    typeof router.query.releaseType === 'string'
      ? router.query.releaseType
      : '';
  const releaseDateGte =
    typeof router.query.primaryReleaseDateGte === 'string'
      ? router.query.primaryReleaseDateGte
      : '';
  const releaseDateLte =
    typeof router.query.primaryReleaseDateLte === 'string'
      ? router.query.primaryReleaseDateLte
      : '';
  const sortBy =
    typeof router.query.sortBy === 'string' &&
    musicSortOptions.has(router.query.sortBy)
      ? router.query.sortBy
      : 'ranked';
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);
  const [showPlaylistRequests, setShowPlaylistRequests] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistResolutionResponse>();
  const discover = useDiscover<AlbumResult>(
    '/api/v1/discover/music',
    {
      query,
      availability,
      days: '14',
      sortBy,
      genre,
      releaseType,
      primaryReleaseDateGte: releaseDateGte,
      primaryReleaseDateLte: releaseDateLte,
    },
    {
      randomizeOrder: !query && sortBy === 'ranked',
      availableQuality: availability,
      hideAvailable: !availability,
    }
  );
  useSearchActivityReporter(
    search.trim() !== query.trim() ||
      discover.isLoadingInitialData ||
      discover.isLoadingMore ||
      discover.isValidating ||
      discover.isSearchingAvailableQuality,
    'music-discovery'
  );
  const title = titleOverride ?? intl.formatMessage(messages.music);
  const setParam = (values: Record<string, string | undefined>) =>
    update({ ...values, page: undefined });
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();

    if (nextSearch !== routedSearchRef.current) {
      routedSearchRef.current = nextSearch;
      update({ search: nextSearch || undefined, page: undefined });
    }
  }, [debouncedSearch, update]);
  const currentYear = new Date().getFullYear();
  const yearOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...Array.from({ length: currentYear - 1969 }, (_, index) => {
      const year = currentYear - index;
      return { label: year.toString(), value: year.toString() };
    }),
    { label: '<1970', value: 'before-1970' },
  ];
  const releaseYear =
    !releaseDateGte && !releaseDateLte
      ? 'any'
      : !releaseDateGte && releaseDateLte === '1969-12-31'
        ? 'before-1970'
        : releaseDateGte.endsWith('-01-01') &&
            releaseDateLte === `${releaseDateGte.slice(0, 4)}-12-31`
          ? releaseDateGte.slice(0, 4)
          : 'any';
  const genreOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...genres.map((value) => ({ label: value, value: value.toLowerCase() })),
  ];
  const releaseTypeOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    { label: intl.formatMessage(messages.album), value: 'Album' },
    { label: intl.formatMessage(messages.ep), value: 'EP' },
    { label: intl.formatMessage(messages.single), value: 'Single' },
  ];
  const hasActiveFilters = Boolean(
    query ||
    availability ||
    genre ||
    releaseType ||
    releaseDateGte ||
    releaseDateLte ||
    sortBy !== 'ranked'
  );
  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Header>{title}</Header>
          <div className="flex gap-2">
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() => setShowPlaylistImport(true)}
            >
              <QueueListIcon />
              {intl.formatMessage(messages.importPlaylist)}
            </Button>
          </div>
        </div>
        {mediaFilters}
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.filters)}
        </div>
        <div className="discover-filter-primary-row">
          <button
            type="button"
            aria-pressed={!hasActiveFilters}
            onClick={() => {
              setSearch('');
              setParam({
                search: undefined,
                availability: undefined,
                genre: undefined,
                releaseType: undefined,
                primaryReleaseDateGte: undefined,
                primaryReleaseDateLte: undefined,
                sortBy: undefined,
              });
            }}
            className={`${getFilterResetButtonClass(!hasActiveFilters)} order-1`}
          >
            {intl.formatMessage(messages.clearFilters)}
          </button>
          <CardTextVisibilityToggle mediaType="album" className="order-2" />
          <AvailabilityQualityControl
            mediaType="music"
            value={availability}
            onChange={(value) => setParam({ availability: value })}
            className="order-3"
          />
        </div>
        <div className="discover-filter-secondary-row">
          <form
            className="discover-filter-control order-5 w-72 flex-none"
            onSubmit={(e) => {
              e.preventDefault();
              const nextSearch = search.trim();
              routedSearchRef.current = nextSearch;
              setParam({ search: nextSearch || undefined });
            }}
          >
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder={intl.formatMessage(messages.searchMusic)}
              aria-label={intl.formatMessage(messages.searchMusic)}
              className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
            />
          </form>
          <CompactSelect
            className="order-8"
            label={intl.formatMessage(messages.genres)}
            value={genre}
            options={genreOptions}
            onChange={(value) => setParam({ genre: value || undefined })}
          />
          <CompactSelect
            className="order-7"
            label={intl.formatMessage(messages.releaseType)}
            value={releaseType}
            options={releaseTypeOptions}
            onChange={(value) => setParam({ releaseType: value || undefined })}
          />
          <CompactSelect
            className="order-6"
            label={intl.formatMessage(messages.releaseYear)}
            value={releaseYear}
            options={yearOptions}
            onChange={(value) => {
              if (value === 'any') {
                setParam({
                  primaryReleaseDateGte: undefined,
                  primaryReleaseDateLte: undefined,
                });
              } else if (value === 'before-1970') {
                setParam({
                  primaryReleaseDateGte: undefined,
                  primaryReleaseDateLte: '1969-12-31',
                });
              } else {
                setParam({
                  primaryReleaseDateGte: `${value}-01-01`,
                  primaryReleaseDateLte: `${value}-12-31`,
                });
              }
            }}
          />
        </div>
        <div className="app-filter-section-heading">
          {intl.formatMessage(messages.sortBy)}
        </div>
        <div className="flex flex-wrap gap-2">
          {musicSorts.map((option) => {
            const active = sortBy === option.asc || sortBy === option.desc;
            const ascending = sortBy === option.asc;
            const Icon = ascending ? BarsArrowUpIcon : BarsArrowDownIcon;

            return (
              <button
                key={option.desc}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setParam({
                    sortBy: active && !ascending ? option.asc : option.desc,
                  })
                }
                className={getFilterToggleButtonClass(active)}
              >
                {intl.formatMessage(option.label)}
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
      {discover.error &&
        !discover.titles.length &&
        !discover.isLoadingInitialData && (
          <Alert
            title={intl.formatMessage(messages.loadError)}
            type="warning"
          />
        )}
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
      {showPlaylistImport && (
        <PlaylistImportModal
          show
          onCancel={() => setShowPlaylistImport(false)}
          onResolved={(response) => {
            setPlaylist(response);
            setShowPlaylistImport(false);
            setShowPlaylistRequests(true);
          }}
        />
      )}
      {playlist && (
        <BulkRequestModal
          show={showPlaylistRequests}
          mediaType="music"
          title={playlist.name}
          initialItems={playlist.items}
          initialTotalItems={playlist.items.length}
          sourceUrl={playlist.url}
          onCancel={() => setShowPlaylistRequests(false)}
        />
      )}
    </>
  );
};
export default DiscoverMusic;
