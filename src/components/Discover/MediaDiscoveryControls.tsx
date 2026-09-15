import type { FilterOptions } from '@app/components/Discover/constants';
import FilterPanel from '@app/components/Discover/FilterPanel';
import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, BarsArrowUpIcon } from '@heroicons/react/24/solid';
import type { SortOptions as TMDBSortOptions } from '@server/api/themoviedb';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.MediaDiscoveryControls', {
  filters: 'Filters',
  sortBy: 'Sort By',
  popularity: 'Popularity',
  releaseDate: 'Release Date',
  firstAirDate: 'First Air Date',
  rating: 'TMDB Rating',
  title: 'Title',
});

const movieSorts = [
  { label: 'popularity', asc: 'popularity.asc', desc: 'popularity.desc' },
  { label: 'releaseDate', asc: 'release_date.asc', desc: 'release_date.desc' },
  { label: 'rating', asc: 'vote_average.asc', desc: 'vote_average.desc' },
  { label: 'title', asc: 'original_title.asc', desc: 'original_title.desc' },
] as const satisfies readonly {
  label: keyof typeof messages;
  asc: TMDBSortOptions;
  desc: TMDBSortOptions;
}[];

const seriesSorts = [
  { label: 'popularity', asc: 'popularity.asc', desc: 'popularity.desc' },
  {
    label: 'firstAirDate',
    asc: 'first_air_date.asc',
    desc: 'first_air_date.desc',
  },
  { label: 'rating', asc: 'vote_average.asc', desc: 'vote_average.desc' },
  { label: 'title', asc: 'original_title.asc', desc: 'original_title.desc' },
] as const satisfies readonly {
  label: keyof typeof messages;
  asc: TMDBSortOptions;
  desc: TMDBSortOptions;
}[];

interface MediaDiscoveryControlsProps {
  type: 'movie' | 'tv';
  currentFilters: FilterOptions;
}

const MediaDiscoveryControls = ({
  type,
  currentFilters,
}: MediaDiscoveryControlsProps) => {
  const intl = useIntl();
  const updateQueryParams = useUpdateQueryParams({});
  const currentSort = currentFilters.sortBy || 'popularity.desc';
  const sorts = type === 'movie' ? movieSorts : seriesSorts;

  return (
    <>
      <div className="app-filter-section-heading">
        {intl.formatMessage(messages.filters)}
      </div>
      <FilterPanel type={type} currentFilters={currentFilters} />
      <div className="app-filter-section-heading">
        {intl.formatMessage(messages.sortBy)}
      </div>
      <div className="flex flex-wrap gap-2">
        {sorts.map((option) => {
          const active =
            currentSort === option.asc || currentSort === option.desc;
          const ascending = currentSort === option.asc;
          const Icon = ascending ? BarsArrowUpIcon : BarsArrowDownIcon;

          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() =>
                updateQueryParams(
                  'sortBy',
                  active && !ascending ? option.asc : option.desc
                )
              }
              className={getFilterToggleButtonClass(active)}
            >
              {intl.formatMessage(messages[option.label])}
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </>
  );
};

export default MediaDiscoveryControls;
