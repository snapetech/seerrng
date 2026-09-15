import CardTextVisibilityToggle from '@app/components/Common/CardTextVisibilityToggle';
import AvailabilityQualityControl from '@app/components/Discover/AvailabilityQualityControl';
import {
  CompactRatingSelect,
  CompactSelect,
  getFilterResetButtonClass,
  getFilterToggleButtonClass,
  type CompactSelectOption,
  type RangeOption,
  type RatingOption,
} from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { tvNetworks } from '@app/components/Discover/NetworkSlider';
import type { FilterOptions } from '@app/components/Discover/constants';
import {
  CompanySelector,
  StatusSelector,
  WatchProviderSelector,
} from '@app/components/Selector';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { useSearchActivityReporter } from '@app/hooks/useSearchActivity';
import { useBatchUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon, TvIcon } from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import type { TmdbGenre } from '@server/api/themoviedb/interfaces';
import type { Language } from '@server/lib/settings';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.FilterPanel', {
  filters: 'Filters',
  releaseDate: 'Release Date',
  studio: 'Studio',
  network: 'Network',
  genres: 'Genres',
  language: 'Language',
  clearFilters: 'Clear Filters',
  keywordSearch: 'Keyword Search',
  searchMovies: 'Search Movies',
  searchSeries: 'Search Series',
  tmdbuserscore: 'TMDB Rating',
  runtime: 'Runtime',
  streamingservices: 'Streaming Services',
  region: 'Region',
  status: 'Status',
  certification: 'Content Rating',
  any: 'Any',
  durationMinutes: '{minutes} Minutes',
  durationHours: '{hours} {hours, plural, one {Hour} other {Hours}}',
  hoursAndUp: '{hours}+ Hours',
  currentRange: 'Current: {minimum}–{maximum}',
});

type FilterPanelProps = {
  type: 'movie' | 'tv';
  currentFilters: FilterOptions;
  variant?: 'discover' | 'search';
  searchQueryKey?: 'search' | 'resultFilter';
};

const clearedFilters = {
  availability: undefined,
  certification: undefined,
  certificationCountry: undefined,
  certificationGte: undefined,
  certificationLte: undefined,
  certificationMode: undefined,
  excludeKeywords: undefined,
  firstAirDateGte: undefined,
  firstAirDateLte: undefined,
  genre: undefined,
  keywords: undefined,
  language: undefined,
  primaryReleaseDateGte: undefined,
  primaryReleaseDateLte: undefined,
  search: undefined,
  status: undefined,
  studio: undefined,
  network: undefined,
  voteAverageGte: undefined,
  voteAverageLte: undefined,
  voteCountGte: undefined,
  voteCountLte: undefined,
  watchProviders: undefined,
  watchRegion: undefined,
  withRuntimeGte: undefined,
  withRuntimeLte: undefined,
} as const;

const getRangeValue = (options: RangeOption[], gte?: string, lte?: string) =>
  options.find((option) => option.gte === gte && option.lte === lte)?.value ??
  `current:${gte ?? ''}:${lte ?? ''}`;

const FilterPanel = ({
  type,
  currentFilters,
  variant = 'discover',
  searchQueryKey = 'search',
}: FilterPanelProps) => {
  const intl = useIntl();
  const batchUpdateQueryParams = useBatchUpdateQueryParams({});
  const [searchValue, debouncedSearchValue, setSearchValue] = useDebouncedState(
    currentFilters.search ?? ''
  );
  const routedSearchRef = useRef((currentFilters.search ?? '').trim());
  useSearchActivityReporter(
    Boolean(searchValue.trim()) &&
      searchValue.trim() !== (currentFilters.search ?? '').trim(),
    `${type}-keyword-input`
  );
  const [isStreamingOpen, setIsStreamingOpen] = useState(false);
  const { data: languages } = useSWR<Language[]>('/api/v1/languages');
  const { data: availableGenres } = useSWR<TmdbGenre[]>(
    `/api/v1/genres/${type}`
  );

  useEffect(() => {
    routedSearchRef.current = (currentFilters.search ?? '').trim();
    setSearchValue(currentFilters.search ?? '');
  }, [currentFilters.search, setSearchValue]);

  useEffect(() => {
    const nextSearch = debouncedSearchValue.trim();

    if (nextSearch === routedSearchRef.current) {
      return;
    }

    routedSearchRef.current = nextSearch;
    batchUpdateQueryParams({
      ...(variant === 'discover' ? clearedFilters : {}),
      [searchQueryKey]: nextSearch || undefined,
    });
  }, [batchUpdateQueryParams, debouncedSearchValue, searchQueryKey, variant]);

  const dateGte =
    type === 'movie' ? 'primaryReleaseDateGte' : 'firstAirDateGte';
  const dateLte =
    type === 'movie' ? 'primaryReleaseDateLte' : 'firstAirDateLte';
  const hasActiveFilters = Object.keys(currentFilters).length > 0;
  const clearAllFilters = () => {
    routedSearchRef.current = '';
    setSearchValue('');
    batchUpdateQueryParams({
      ...clearedFilters,
      [searchQueryKey]: undefined,
      sortBy: undefined,
    });
  };
  const updateFilter = (key: string, value?: string) => {
    batchUpdateQueryParams({
      ...(variant === 'discover' ? { [searchQueryKey]: undefined } : {}),
      [key]: value,
    });
  };
  const updateFilters = (values: Record<string, string | undefined>) => {
    batchUpdateQueryParams({
      ...(variant === 'discover' ? { [searchQueryKey]: undefined } : {}),
      ...values,
    });
  };
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
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...(availableGenres ?? []).map((genre) => ({
      label: genre.name,
      value: genre.id.toString(),
    })),
  ];
  const selectedGenre = currentFilters.genre?.split(',')[0] ?? 'any';
  const selectedYear = yearOptions.find((option) => {
    if (option.value === 'any') {
      return !currentFilters[dateGte] && !currentFilters[dateLte];
    }

    if (option.value === 'before-1970') {
      return (
        !currentFilters[dateGte] && currentFilters[dateLte] === '1969-12-31'
      );
    }

    return (
      currentFilters[dateGte] === `${option.value}-01-01` &&
      currentFilters[dateLte] === `${option.value}-12-31`
    );
  });
  const yearValue = selectedYear?.value ?? 'current-date-range';

  if (!selectedYear) {
    yearOptions.push({
      label: intl.formatMessage(messages.currentRange, {
        minimum: currentFilters[dateGte] ?? 'Any',
        maximum: currentFilters[dateLte] ?? 'Any',
      }),
      value: yearValue,
    });
  }
  const certifications =
    type === 'movie'
      ? ['NR', 'G', 'PG', 'PG-13', 'R', 'NC-17']
      : ['NR', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'];
  const certificationOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: '' },
    ...certifications.map((certification) => ({
      label: certification,
      value: certification,
    })),
  ];
  const currentCertification = currentFilters.certification ?? '';
  const networkOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...tvNetworks.map((network) => ({
      label: network.name,
      value: network.url.split('/').pop() ?? '',
    })),
  ];
  const languageOptions: CompactSelectOption[] = [
    { label: intl.formatMessage(messages.any), value: 'all' },
    ...(languages ?? [])
      .map((language) => ({
        label:
          intl.formatDisplayName(language.iso_639_1, {
            type: 'language',
            fallback: 'none',
          }) ?? language.english_name,
        value: language.iso_639_1,
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, intl.locale, {
          sensitivity: 'base',
        })
      ),
  ];
  const currentLanguage = currentFilters.language ?? 'all';

  if (
    currentLanguage !== 'all' &&
    !languageOptions.some((option) => option.value === currentLanguage)
  ) {
    const languageNames = currentLanguage.split('|').map((code) => {
      const knownLanguage = languageOptions.find(
        (option) => option.value === code
      );
      return knownLanguage?.label ?? code;
    });
    languageOptions.push({
      label: languageNames.join(', '),
      value: currentLanguage,
    });
  }

  if (
    currentCertification &&
    !certificationOptions.some(
      (option) => option.value === currentCertification
    )
  ) {
    certificationOptions.push({
      label: currentCertification,
      value: currentCertification,
    });
  }

  const runtimeOptions: RangeOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    {
      label: intl.formatMessage(messages.durationMinutes, { minutes: 30 }),
      value: '30-minutes',
      lte: '30',
    },
    {
      label: intl.formatMessage(messages.durationHours, { hours: 1 }),
      value: '1-hour',
      lte: '60',
    },
    {
      label: intl.formatMessage(messages.durationHours, { hours: 1.5 }),
      value: '1.5-hours',
      lte: '90',
    },
    {
      label: intl.formatMessage(messages.durationHours, { hours: 2 }),
      value: '2-hours',
      lte: '120',
    },
    {
      label: intl.formatMessage(messages.durationHours, { hours: 2.5 }),
      value: '2.5-hours',
      lte: '150',
    },
    {
      label: intl.formatMessage(messages.durationHours, { hours: 3 }),
      value: '3-hours',
      lte: '180',
    },
    {
      label: intl.formatMessage(messages.hoursAndUp, { hours: 4 }),
      value: '4-hours-plus',
      gte: '240',
    },
  ];
  const ratingOptions: RatingOption[] = [
    { label: intl.formatMessage(messages.any), value: 'any' },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => ({
      label: `${score.toFixed(1)}+`,
      value: `${score}-plus`,
      gte: score.toString(),
      score,
    })),
  ];
  const appendCurrentRange = (
    options: RangeOption[],
    gte?: string,
    lte?: string
  ): RangeOption[] => {
    const selectedValue = getRangeValue(options, gte, lte);

    if (!selectedValue.startsWith('current:')) {
      return options;
    }

    return [
      ...options,
      {
        label: intl.formatMessage(messages.currentRange, {
          minimum: gte ?? '0',
          maximum: lte ?? intl.formatMessage(messages.any),
        }),
        value: selectedValue,
        gte,
        lte,
      },
    ];
  };

  const updateRange = (
    options: RangeOption[],
    value: string,
    gteKey: string,
    lteKey: string
  ) => {
    const selected = options.find((option) => option.value === value);

    updateFilters({
      [gteKey]: selected?.gte,
      [lteKey]: selected?.lte,
    });
  };

  const runtimeValue = getRangeValue(
    runtimeOptions,
    currentFilters.withRuntimeGte,
    currentFilters.withRuntimeLte
  );
  const currentRuntimeOptions = appendCurrentRange(
    runtimeOptions,
    currentFilters.withRuntimeGte,
    currentFilters.withRuntimeLte
  );
  const ratingValue = getRangeValue(
    ratingOptions,
    currentFilters.voteAverageGte,
    currentFilters.voteAverageLte
  );
  const currentRatingOptions: RatingOption[] = ratingValue.startsWith(
    'current:'
  )
    ? [
        ...ratingOptions,
        {
          label: intl.formatMessage(messages.currentRange, {
            minimum: currentFilters.voteAverageGte ?? '0',
            maximum:
              currentFilters.voteAverageLte ?? intl.formatMessage(messages.any),
          }),
          value: ratingValue,
          gte: currentFilters.voteAverageGte,
          lte: currentFilters.voteAverageLte,
          score: currentFilters.voteAverageGte
            ? Number(currentFilters.voteAverageGte)
            : undefined,
        },
      ]
    : ratingOptions;
  return (
    <section
      aria-label={intl.formatMessage(messages.filters)}
      className={variant === 'search' ? 'contents' : undefined}
    >
      {variant === 'discover' && (
        <div className="discover-filter-primary-row">
          <button
            type="button"
            aria-pressed={!hasActiveFilters}
            onClick={clearAllFilters}
            className={`${getFilterResetButtonClass(!hasActiveFilters)} order-1`}
          >
            {intl.formatMessage(messages.clearFilters)}
          </button>
          <CardTextVisibilityToggle mediaType={type} className="order-2" />
          <AvailabilityQualityControl
            mediaType={type}
            value={currentFilters.availability}
            onChange={(value) => updateFilter('availability', value)}
            className="order-3"
          />
        </div>
      )}
      <div
        className={
          variant === 'search' ? 'contents' : 'discover-filter-secondary-row'
        }
      >
        <form
          className="discover-filter-control order-5 w-72 max-w-full flex-none"
          onSubmit={(event) => {
            event.preventDefault();
            batchUpdateQueryParams({
              ...(variant === 'discover' ? clearedFilters : {}),
              [searchQueryKey]: searchValue.trim() || undefined,
            });
          }}
        >
          <span
            className={`discover-filter-control-label gap-1.5 ${
              searchValue.trim() ? 'discover-filter-control-label-active' : ''
            }`}
          >
            <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
            {intl.formatMessage(messages.keywordSearch)}
          </span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={intl.formatMessage(
              type === 'movie' ? messages.searchMovies : messages.searchSeries
            )}
            aria-label={intl.formatMessage(
              type === 'movie' ? messages.searchMovies : messages.searchSeries
            )}
            className="min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-xs font-medium text-gray-200 placeholder:text-gray-500 focus:ring-0"
          />
        </form>
        {type === 'tv' && (
          <div className="discover-filter-control order-6">
            <span
              className={`discover-filter-control-label ${
                currentFilters.status
                  ? 'discover-filter-control-label-active'
                  : ''
              }`}
            >
              {intl.formatMessage(messages.status)}
            </span>
            <StatusSelector
              compact
              defaultValue={currentFilters.status}
              isMulti
              onChange={(value) => {
                updateFilter('status', value?.map((v) => v.value).join('|'));
              }}
            />
          </div>
        )}
        <CompactSelect
          className={type === 'movie' ? 'order-6' : 'order-7'}
          label={intl.formatMessage(messages.releaseDate)}
          value={yearValue}
          options={yearOptions}
          onChange={(value) => {
            if (value === 'any') {
              updateFilters({ [dateGte]: undefined, [dateLte]: undefined });
            } else if (value === 'before-1970') {
              updateFilters({
                [dateGte]: undefined,
                [dateLte]: '1969-12-31',
              });
            } else if (value !== 'current-date-range') {
              updateFilters({
                [dateGte]: `${value}-01-01`,
                [dateLte]: `${value}-12-31`,
              });
            }
          }}
        />
        {type === 'movie' && (
          <div className="discover-filter-control order-9">
            <span
              className={`discover-filter-control-label ${
                currentFilters.studio
                  ? 'discover-filter-control-label-active'
                  : ''
              }`}
            >
              {intl.formatMessage(messages.studio)}
            </span>
            <CompanySelector
              compact
              defaultValue={currentFilters.studio}
              onChange={(value) => {
                updateFilter('studio', value?.value.toString());
              }}
            />
          </div>
        )}
        <CompactSelect
          className={type === 'movie' ? 'order-7' : 'order-8'}
          label={intl.formatMessage(messages.genres)}
          value={selectedGenre}
          options={genreOptions}
          onChange={(value) =>
            updateFilter('genre', value === 'any' ? undefined : value)
          }
        />
        <CompactSelect
          className="order-12"
          label={intl.formatMessage(messages.language)}
          value={currentLanguage}
          options={languageOptions}
          onChange={(value) => {
            updateFilter('language', value === 'all' ? undefined : value);
          }}
        />
        <CompactSelect
          className={type === 'movie' ? 'order-8' : 'order-9'}
          label={intl.formatMessage(messages.certification)}
          value={currentCertification}
          options={certificationOptions}
          onChange={(value) => {
            updateFilters({
              certification: value || undefined,
              certificationCountry: value ? 'US' : undefined,
              certificationGte: undefined,
              certificationLte: undefined,
              certificationMode: value ? 'exact' : undefined,
            });
          }}
        />
        {type === 'movie' && (
          <CompactSelect
            className="order-10"
            label={intl.formatMessage(messages.runtime)}
            value={runtimeValue}
            options={currentRuntimeOptions}
            onChange={(value) =>
              updateRange(
                currentRuntimeOptions,
                value,
                'withRuntimeGte',
                'withRuntimeLte'
              )
            }
          />
        )}
        {type === 'tv' && (
          <CompactSelect
            className="order-10"
            label={intl.formatMessage(messages.network)}
            value={currentFilters.network ?? 'any'}
            options={networkOptions}
            onChange={(value) =>
              updateFilter('network', value === 'any' ? undefined : value)
            }
          />
        )}
        <CompactRatingSelect
          className="order-11"
          label={intl.formatMessage(messages.tmdbuserscore)}
          value={ratingValue}
          options={currentRatingOptions}
          onChange={(value) =>
            updateRange(
              currentRatingOptions,
              value,
              'voteAverageGte',
              'voteAverageLte'
            )
          }
        />
        <button
          type="button"
          aria-expanded={isStreamingOpen}
          onClick={() => setIsStreamingOpen((current) => !current)}
          className={`${getFilterToggleButtonClass(Boolean(currentFilters.watchProviders))} order-[13]`}
        >
          <TvIcon className="h-4 w-4" aria-hidden="true" />
          {intl.formatMessage(messages.streamingservices)}
          {currentFilters.watchProviders && (
            <span className="rounded-full bg-gray-900/50 px-1.5 py-0.5 text-[10px]">
              {currentFilters.watchProviders.split('|').length}
            </span>
          )}
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform ${isStreamingOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {isStreamingOpen && (
        <section
          className={`${
            variant === 'search' ? 'w-full basis-full' : ''
          } scrollable-card mt-2 max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900/40 p-3 pb-7`}
        >
          <WatchProviderSelector
            type={type}
            regionLabel={intl.formatMessage(messages.region)}
            region={currentFilters.watchRegion}
            activeProviders={
              currentFilters.watchProviders?.split('|').map((v) => Number(v)) ??
              []
            }
            onChange={(region, providers) => {
              if (providers.length) {
                updateFilters({
                  watchRegion: region,
                  watchProviders: providers.join('|'),
                });
              } else {
                batchUpdateQueryParams({
                  watchRegion: undefined,
                  watchProviders: undefined,
                });
              }
            }}
          />
        </section>
      )}
    </section>
  );
};

export default FilterPanel;
