import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import IndexerSearchLink from '@app/components/Common/IndexerSearchLink';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  isAnySoftwareCategoryEnabled,
  isConfiguredMediaCategoryEnabled,
} from '@app/utils/serviceAvailability';
import { Transition } from '@headlessui/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  PcArchitecture,
  PcOperatingSystem,
} from '@server/api/software/types';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import axios from 'axios';
import { useRouter } from 'next/router';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.SoftwareCatalog', {
  title: 'Software',
  intro:
    'Browse emulation titles and PC games. Requests keep their selected system or PC target through approval and download.',
  retro: 'Retro',
  modern: 'Modern',
  games: 'PC Games',
  allSystems: 'All systems',
  allPcPlatforms: 'All PC platforms',
  genreFilter: 'Genre',
  releaseYearFilter: 'Release year',
  invalidReleaseYear: 'Enter a release year from 1950 to 2200.',
  searchPlaceholder: 'Search software titles',
  search: 'Search',
  popular: 'Popular titles',
  browseDat: 'Browse DAT titles',
  datCatalog: 'DAT catalog',
  noResults: 'No titles match this search.',
  loadMore: 'Load more titles',
  retryLoad: 'Retry loading titles',
  loadError: 'The software catalog could not be loaded.',
  upgradeQuestarr:
    'Update QuestarrNG to browse software by genre or release year.',
  configureHint:
    'Ask an administrator to connect QuestarrNG and the required acquisition service in Settings → Services.',
  datConfigureHint:
    'Ask an administrator to load DAT files in ROMarrNG and select ROMarrNG · DAT in Settings → Services.',
  datUnavailable:
    'The ROMarrNG DAT catalog is unavailable. Ask an administrator to check that DAT files are loaded.',
  request: 'Request',
  details: 'Details',
  requestTitle: 'Request {title}',
  requestDescription:
    'Choose the target for this request. The selected target stays fixed after submission.',
  chooseSystem: 'Emulation system',
  chooseOperatingSystem: 'Operating system',
  chooseArchitecture: 'Architecture',
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  x64: 'x64',
  arm64: 'ARM64',
  x86: 'x86',
  universal: 'Universal',
  requestSuccess: 'Request submitted for approval.',
  requestSuccessApproved:
    'Request approved and sent to its acquisition service.',
  requestError: 'This request could not be submitted.',
  quotaExceeded: 'Your software request limit has been reached.',
  existingRequest: 'This title is already requested for that target.',
  chooseAll: 'Choose an operating system and architecture to continue.',
  noCategories: 'No software categories are currently available.',
  titleUnavailable: 'This catalog title could not be loaded.',
  available: 'In library',
  tracked: 'Tracked',
  downloading: 'Downloading',
  availabilityUnknown: 'Availability unknown',
  screenshots: 'Screenshots',
  watchVideo: 'Watch {name}',
  gameVideo: 'Game video',
  rating: 'Rating: {rating}/10',
});

type Category = 'retro' | 'modern' | 'game';
type PcVariant = {
  operatingSystem: PcOperatingSystem | '';
  architecture: PcArchitecture | '';
};

interface EmulationSystemOption {
  slug: string;
  name: string;
  group: 'retro' | 'modern';
  catalogPlatformId: number;
}

interface CatalogSystemOption {
  slug: string;
  name: string;
  group: 'retro' | 'modern' | null;
}

interface CatalogGame {
  id: string;
  catalogProvider: 'igdb' | 'dat';
  catalogId: string;
  igdbId?: number;
  title: string;
  summary: string;
  coverUrl: string;
  releaseDate: string;
  platforms: string[];
  platformOptions: { id?: number; key?: string; name: string }[];
  genres: string[];
  emulationSystems?: EmulationSystemOption[];
  availability?:
    'available' | 'tracked' | 'downloading' | 'missing' | 'unknown';
  availableSystems?: string[];
  rating?: number | null;
  publishers?: string[];
  developers?: string[];
  screenshots?: string[];
  videos?: { name: string; videoId: string }[];
}

interface CatalogResponse {
  results: CatalogGame[];
  nextCursor?: string | null;
  nextOffset?: number | null;
}

const categories: Category[] = ['retro', 'modern', 'game'];
const operatingSystems: PcOperatingSystem[] = ['windows', 'linux', 'macos'];
const architectures: PcArchitecture[] = ['x64', 'arm64', 'x86', 'universal'];

const SoftwareCatalog = ({
  externalQuery,
  embedded = false,
}: {
  externalQuery?: string;
  embedded?: boolean;
}) => {
  const router = useRouter();
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { currentSettings } = useSettings();
  const canRequest = hasPermission(Permission.REQUEST);
  const canManageRequests = hasPermission(Permission.MANAGE_REQUESTS);
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const [category, setCategory] = useState<Category>('retro');
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [systemFilter, setSystemFilter] = useState('');
  const [pcPlatformFilter, setPcPlatformFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [genreInput, setGenreInput] = useState('');
  const [releaseYearFilter, setReleaseYearFilter] = useState('');
  const [releaseYearInput, setReleaseYearInput] = useState('');
  const [selectedGame, setSelectedGame] = useState<CatalogGame | null>(null);
  const [selectedSystem, setSelectedSystem] = useState('');
  const [variant, setVariant] = useState<PcVariant>({
    operatingSystem: '',
    architecture: '',
  });
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requesting, setRequesting] = useState(false);
  const hydratedGameId = useRef<string | undefined>(undefined);
  const openedFromCatalog = useRef(false);
  const linkedCategory =
    typeof router.query.category === 'string' &&
    categories.includes(router.query.category as Category)
      ? (router.query.category as Category)
      : undefined;
  const linkedCatalogProvider =
    router.query.catalogProvider === 'dat' ? 'dat' : 'igdb';
  const linkedGameId =
    typeof router.query.game === 'string' &&
    (linkedCatalogProvider === 'dat'
      ? /^dat-[0-9a-f]{64}$/.test(router.query.game)
      : /^[1-9]\d*$/.test(router.query.game))
      ? router.query.game
      : undefined;
  const { data: linkedGame, error: linkedGameError } = useSWR<{
    game: CatalogGame;
  }>(
    linkedCategory && linkedGameId
      ? `/api/v1/request/software/catalog/games/${encodeURIComponent(linkedGameId)}?category=${linkedCategory}&catalogProvider=${linkedCatalogProvider}`
      : null
  );

  useEffect(() => {
    if (router.isReady && linkedCategory) setCategory(linkedCategory);
  }, [linkedCategory, router.isReady]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!linkedGameId) {
      openedFromCatalog.current = false;
      hydratedGameId.current = undefined;
      setSelectedGame(null);
    } else if (
      linkedGame?.game &&
      linkedGame.game.catalogId === linkedGameId &&
      linkedGame.game.catalogProvider === linkedCatalogProvider
    ) {
      if (hydratedGameId.current !== linkedGameId) {
        hydratedGameId.current = linkedGameId;
        setSelectedSystem(linkedGame.game.emulationSystems?.[0]?.slug ?? '');
        setVariant({ operatingSystem: '', architecture: '' });
        setRequestError('');
      }
      setSelectedGame(linkedGame.game);
    }
  }, [linkedGame?.game, linkedCatalogProvider, linkedGameId, router.isReady]);

  const visibleCategories = categories.filter((value) => {
    if (!isAnySoftwareCategoryEnabled(currentSettings)) return false;
    if (value === 'game') {
      return isConfiguredMediaCategoryEnabled('game', currentSettings);
    }
    return (
      currentSettings.romarrEnabled &&
      isConfiguredMediaCategoryEnabled(value, currentSettings)
    );
  });
  const selectedCategory = visibleCategories.includes(category)
    ? category
    : (visibleCategories[0] ?? category);
  const { data: systemCatalog } = useSWR<{
    results: CatalogSystemOption[];
    catalogProvider?: 'questarr' | 'igdb' | 'dat';
    catalogSystemSlugs?: string[];
  }>(
    selectedCategory !== 'game' && visibleCategories.length
      ? '/api/v1/request/software/catalog/systems'
      : null
  );
  const catalogProvider =
    selectedCategory === 'game'
      ? 'igdb'
      : (systemCatalog?.catalogProvider ?? 'igdb');
  const isDatCatalog = catalogProvider === 'dat';
  const datSystemSlugs = new Set(systemCatalog?.catalogSystemSlugs ?? []);
  const systemsForCategory = (systemCatalog?.results ?? []).filter(
    (system) =>
      system.group === selectedCategory &&
      (!isDatCatalog || datSystemSlugs.has(system.slug))
  );

  const query = (externalQuery ?? submittedQuery).trim();
  const validReleaseYear =
    releaseYearInput === '' ||
    (/^[0-9]{4}$/.test(releaseYearInput) &&
      Number(releaseYearInput) >= 1950 &&
      Number(releaseYearInput) <= 2200);
  useEffect(() => {
    const timer = setTimeout(() => {
      setGenreFilter(genreInput.trim());
      setReleaseYearFilter(
        /^[0-9]{4}$/.test(releaseYearInput) &&
          Number(releaseYearInput) >= 1950 &&
          Number(releaseYearInput) <= 2200
          ? releaseYearInput
          : ''
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [genreInput, releaseYearInput]);
  const { ref: loadMoreRef, inView: loadMoreInView } = useInView({
    rootMargin: '600px',
  });
  const getCatalogKey = useCallback(
    (pageIndex: number, previousPage: CatalogResponse | null) => {
      if (
        visibleCategories.length === 0 ||
        (!isDatCatalog && !validReleaseYear)
      )
        return null;
      if (pageIndex > 0 && !previousPage) return null;
      const params = new URLSearchParams({
        category: selectedCategory,
        limit: '24',
      });
      if (selectedCategory === 'game' && pcPlatformFilter) {
        params.set('platform', pcPlatformFilter);
      } else if (selectedCategory !== 'game' && systemFilter) {
        params.set('system', systemFilter);
      }
      if (!isDatCatalog && genreFilter.trim()) {
        params.set('genre', genreFilter.trim());
      }
      if (!isDatCatalog && releaseYearFilter) {
        params.set('releaseYear', releaseYearFilter);
      }
      if (query) {
        params.set('q', query);
        if (pageIndex > 0) {
          if (!previousPage?.nextCursor) return null;
          params.set('cursor', previousPage.nextCursor);
        }
        return `/api/v1/request/software/catalog/search?${params.toString()}`;
      }
      if (pageIndex > 0) {
        if (previousPage?.nextOffset == null) return null;
        params.set('offset', String(previousPage.nextOffset));
      }
      return `/api/v1/request/software/catalog/popular?${params.toString()}`;
    },
    [
      pcPlatformFilter,
      genreFilter,
      query,
      releaseYearFilter,
      selectedCategory,
      systemFilter,
      validReleaseYear,
      visibleCategories.length,
      isDatCatalog,
    ]
  );
  const {
    data: pages,
    error,
    isLoading,
    size,
    setSize,
    mutate,
  } = useSWRInfinite<CatalogResponse>(getCatalogKey, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
  const games = useMemo(() => {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) =>
      page.results.filter((game) => {
        if (seen.has(`${game.catalogProvider}:${game.catalogId}`)) return false;
        seen.add(`${game.catalogProvider}:${game.catalogId}`);
        return true;
      })
    );
  }, [pages]);
  const lastPage = pages?.[pages.length - 1];
  const hasMore = query
    ? Boolean(lastPage?.nextCursor)
    : lastPage?.nextOffset != null;
  const isLoadingMore = !error && size > (pages?.length ?? 0);
  const catalogErrorMessage =
    axios.isAxiosError(error) &&
    error.response?.status === 503 &&
    error.response.data?.error ===
      'Upgrade QuestarrNG to use software genre and year filters.'
      ? messages.upgradeQuestarr
      : isDatCatalog &&
          axios.isAxiosError(error) &&
          error.response?.status === 503
        ? messages.datUnavailable
        : messages.loadError;

  useEffect(() => {
    if (loadMoreInView && hasMore && !isLoadingMore && !error) {
      void setSize((current) => current + 1);
    }
  }, [error, hasMore, isLoadingMore, loadMoreInView, setSize]);

  const openRequest = (game: CatalogGame) => {
    openedFromCatalog.current = true;
    hydratedGameId.current = game.catalogId;
    setSelectedGame(game);
    setSelectedSystem(game.emulationSystems?.[0]?.slug ?? '');
    setVariant({
      operatingSystem: pcPlatformFilter as PcOperatingSystem | '',
      architecture: '',
    });
    setRequestError('');
    void router.push(
      {
        pathname: router.pathname,
        query: {
          ...router.query,
          category: selectedCategory,
          game: game.catalogId,
          catalogProvider: game.catalogProvider,
        },
      },
      undefined,
      { shallow: true, scroll: false }
    );
  };

  const closeRequest = () => {
    if (openedFromCatalog.current) {
      openedFromCatalog.current = false;
      router.back();
      return;
    }
    const nextQuery = { ...router.query };
    delete nextQuery.game;
    delete nextQuery.catalogProvider;
    void router.replace(
      { pathname: router.pathname, query: nextQuery },
      undefined,
      { shallow: true, scroll: false }
    );
  };

  const submitRequest = async () => {
    if (!selectedGame) return;
    if (
      selectedCategory === 'game' &&
      (!variant.operatingSystem || !variant.architecture)
    ) {
      setRequestError(intl.formatMessage(messages.chooseAll));
      return;
    }
    setRequesting(true);
    setRequestError('');
    try {
      const response = await axios.post<{ request: { status: string } }>(
        '/api/v1/request/software',
        {
          category: selectedCategory,
          catalogProvider: selectedGame.catalogProvider,
          ...(selectedGame.catalogProvider === 'dat'
            ? { catalogKey: selectedGame.catalogId }
            : { catalogId: selectedGame.igdbId }),
          ...(selectedCategory === 'game'
            ? {
                variant: {
                  operatingSystem: variant.operatingSystem,
                  architecture: variant.architecture,
                },
              }
            : { platformSlug: selectedSystem }),
        }
      );
      setRequestSuccess(
        intl.formatMessage(
          response.data.request.status !== 'pending'
            ? messages.requestSuccessApproved
            : messages.requestSuccess
        )
      );
      void mutate();
      closeRequest();
    } catch (submitError) {
      const requestFailure =
        axios.isAxiosError(submitError) &&
        submitError.response?.data?.error === 'SOFTWARE_QUOTA_EXCEEDED'
          ? messages.quotaExceeded
          : axios.isAxiosError(submitError) &&
              submitError.response?.status === 409
            ? messages.existingRequest
            : messages.requestError;
      setRequestError(intl.formatMessage(requestFailure));
    } finally {
      setRequesting(false);
    }
  };

  const categoryTitle = intl.formatMessage(
    selectedCategory === 'game'
      ? messages.games
      : selectedCategory === 'modern'
        ? messages.modern
        : messages.retro
  );
  const availabilityLabel = (game: CatalogGame) =>
    game.availability === 'available'
      ? intl.formatMessage(messages.available)
      : game.availability === 'tracked'
        ? intl.formatMessage(messages.tracked)
        : game.availability === 'downloading'
          ? intl.formatMessage(messages.downloading)
          : game.availability === 'unknown'
            ? intl.formatMessage(messages.availabilityUnknown)
            : '';

  return (
    <>
      {!embedded && <PageTitle title={intl.formatMessage(messages.title)} />}
      <main className="mb-10">
        {!embedded && (
          <Header subtext={intl.formatMessage(messages.intro)}>
            {intl.formatMessage(messages.title)}
          </Header>
        )}

        <div className="mt-6 flex flex-wrap gap-2" role="tablist">
          {visibleCategories.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selectedCategory === value}
              onClick={() => {
                setCategory(value);
                setSubmittedQuery('');
                setSearchInput('');
                setSystemFilter('');
                setPcPlatformFilter('');
                setRequestSuccess('');
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus:ring-2 focus:ring-indigo-400 focus:outline-none ${
                selectedCategory === value
                  ? 'border-indigo-400 bg-indigo-600 text-white'
                  : 'border-gray-600 bg-gray-800 text-gray-200 hover:border-gray-400'
              }`}
            >
              {intl.formatMessage(
                value === 'game'
                  ? messages.games
                  : value === 'modern'
                    ? messages.modern
                    : messages.retro
              )}
            </button>
          ))}
        </div>

        {visibleCategories.length > 0 && (
          <div className="mt-4 flex max-w-2xl flex-wrap gap-2">
            <select
              className="input input-lite min-w-48 flex-1"
              aria-label={intl.formatMessage(
                selectedCategory === 'game'
                  ? messages.allPcPlatforms
                  : messages.allSystems
              )}
              value={
                selectedCategory === 'game' ? pcPlatformFilter : systemFilter
              }
              onChange={(event) => {
                if (selectedCategory === 'game') {
                  setPcPlatformFilter(event.target.value);
                } else {
                  setSystemFilter(event.target.value);
                }
              }}
            >
              <option value="">
                {intl.formatMessage(
                  selectedCategory === 'game'
                    ? messages.allPcPlatforms
                    : messages.allSystems
                )}
              </option>
              {selectedCategory === 'game'
                ? operatingSystems.map((system) => (
                    <option key={system} value={system}>
                      {intl.formatMessage(
                        system === 'macos'
                          ? messages.macos
                          : system === 'linux'
                            ? messages.linux
                            : messages.windows
                      )}
                    </option>
                  ))
                : systemsForCategory.map((system) => (
                    <option key={system.slug} value={system.slug}>
                      {system.name}
                    </option>
                  ))}
            </select>
            {!isDatCatalog && (
              <>
                <input
                  className="input input-lite min-w-40 flex-1"
                  aria-label={intl.formatMessage(messages.genreFilter)}
                  placeholder={intl.formatMessage(messages.genreFilter)}
                  maxLength={64}
                  value={genreInput}
                  onChange={(event) => setGenreInput(event.target.value)}
                />
                <input
                  className="input input-lite w-36"
                  aria-label={intl.formatMessage(messages.releaseYearFilter)}
                  placeholder={intl.formatMessage(messages.releaseYearFilter)}
                  type="number"
                  min={1950}
                  max={2200}
                  aria-invalid={!validReleaseYear}
                  value={releaseYearInput}
                  onChange={(event) => setReleaseYearInput(event.target.value)}
                />
              </>
            )}
          </div>
        )}
        {!isDatCatalog && !validReleaseYear && (
          <p className="mt-2 text-sm text-red-300" role="alert">
            {intl.formatMessage(messages.invalidReleaseYear)}
          </p>
        )}

        {externalQuery === undefined && (
          <form
            className="mt-5 flex max-w-2xl gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(searchInput.trim());
              setRequestSuccess('');
            }}
          >
            <label className="relative min-w-0 flex-1">
              <MagnifyingGlassIcon
                className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                className="input input-lite w-full pl-10"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={intl.formatMessage(messages.searchPlaceholder)}
                maxLength={200}
              />
            </label>
            <Button buttonType="primary" buttonSize="standard" type="submit">
              {intl.formatMessage(messages.search)}
            </Button>
          </form>
        )}

        {requestSuccess && (
          <div
            role="status"
            className="mt-4 rounded-md border border-green-700 bg-green-900/30 px-4 py-3 text-sm text-green-200"
          >
            {requestSuccess}
          </div>
        )}

        {linkedGameError && !selectedGame && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {intl.formatMessage(messages.titleUnavailable)}
          </p>
        )}

        <div className="mt-8 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-100">
            {query
              ? intl.formatMessage(messages.searchPlaceholder)
              : intl.formatMessage(
                  isDatCatalog ? messages.browseDat : messages.popular
                )}
          </h2>
          <span className="text-sm text-gray-400">
            {categoryTitle}
            {isDatCatalog && ` · ${intl.formatMessage(messages.datCatalog)}`}
          </span>
        </div>

        {visibleCategories.length === 0 ? (
          <p className="mt-8 text-sm text-gray-400">
            {intl.formatMessage(messages.noCategories)}
          </p>
        ) : isLoading ? (
          <div className="py-16">
            <LoadingSpinner />
          </div>
        ) : error && !games.length ? (
          <div className="mt-5 rounded-lg border border-gray-700 bg-gray-800 px-5 py-6 text-sm text-gray-300">
            <p>{intl.formatMessage(catalogErrorMessage)}</p>
            {(catalogErrorMessage === messages.loadError ||
              catalogErrorMessage === messages.datUnavailable) && (
              <p className="mt-2 text-gray-400">
                {intl.formatMessage(
                  isDatCatalog
                    ? messages.datConfigureHint
                    : messages.configureHint
                )}
              </p>
            )}
          </div>
        ) : games.length ? (
          <>
            {error && (
              <p role="alert" className="mt-4 text-sm text-amber-300">
                {intl.formatMessage(catalogErrorMessage)}
              </p>
            )}
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {games.map((game) => (
                <li key={game.id}>
                  <article className="group h-full overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow transition hover:border-gray-500 hover:shadow-lg">
                    <div className="relative aspect-[2/3] overflow-hidden bg-gray-900">
                      {availabilityLabel(game) && (
                        <span className="absolute top-2 left-2 z-10 rounded bg-gray-950/85 px-2 py-1 text-xs font-semibold text-white">
                          {availabilityLabel(game)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="relative block h-full w-full"
                        aria-label={`${intl.formatMessage(messages.details)}: ${game.title}`}
                        onClick={() => openRequest(game)}
                      >
                        <CachedImage
                          type="tmdb"
                          src={
                            game.coverUrl ||
                            '/images/seerr_poster_not_found.png'
                          }
                          alt=""
                          className="object-cover transition duration-200 group-hover:scale-[1.02]"
                          fill
                        />
                      </button>
                    </div>
                    <div className="flex h-[10.5rem] flex-col p-3">
                      <h3 className="line-clamp-2 min-h-10 text-sm font-semibold text-white">
                        <button type="button" onClick={() => openRequest(game)}>
                          {game.title}
                        </button>
                      </h3>
                      <p className="mt-1 truncate text-xs text-gray-400">
                        {game.releaseDate ||
                          game.genres.slice(0, 2).join(' · ')}
                      </p>
                      <p className="mt-2 line-clamp-2 min-h-8 text-xs text-gray-300">
                        {selectedCategory === 'game'
                          ? game.platforms
                              .filter((platform) =>
                                /windows|linux|mac/i.test(platform)
                              )
                              .slice(0, 2)
                              .join(' · ')
                          : game.emulationSystems
                              ?.map((system) => system.name)
                              .slice(0, 2)
                              .join(' · ')}
                      </p>
                      {canRequest && (
                        <Button
                          buttonType="detailRequest"
                          buttonSize="sm"
                          className="mt-auto w-full justify-center"
                          onClick={() => openRequest(game)}
                        >
                          {intl.formatMessage(messages.request)}
                        </Button>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </>
        ) : !hasMore ? (
          <div className="mt-5 rounded-lg border border-gray-700 bg-gray-800 px-5 py-8 text-center text-sm text-gray-300">
            {intl.formatMessage(messages.noResults)}
          </div>
        ) : null}
        {hasMore && (
          <div ref={loadMoreRef} className="mt-6 flex justify-center">
            {isLoadingMore ? (
              <LoadingSpinner />
            ) : (
              <Button
                buttonType="primary"
                buttonSize="standard"
                onClick={() =>
                  void (error ? mutate() : setSize((current) => current + 1))
                }
              >
                {intl.formatMessage(
                  error ? messages.retryLoad : messages.loadMore
                )}
              </Button>
            )}
          </div>
        )}
      </main>

      {selectedGame && (
        <Transition as={Fragment} show={Boolean(selectedGame)}>
          <Modal
            manageHistory={false}
            title={selectedGame.title}
            subTitle={
              canRequest
                ? intl.formatMessage(messages.requestDescription)
                : undefined
            }
            onCancel={closeRequest}
            onOk={canRequest ? submitRequest : undefined}
            okText={intl.formatMessage(messages.request)}
            cancelText={intl.formatMessage(
              canRequest ? globalMessages.cancel : globalMessages.close
            )}
            okDisabled={
              requesting ||
              (quota?.software?.restricted && !canManageRequests) ||
              (selectedCategory !== 'game' && !selectedSystem) ||
              (selectedCategory === 'game' &&
                (!variant.operatingSystem || !variant.architecture))
            }
            loading={requesting}
            dialogClass="max-w-xl"
          >
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded bg-gray-900">
                  <CachedImage
                    type="tmdb"
                    src={
                      selectedGame.coverUrl ||
                      '/images/seerr_poster_not_found.png'
                    }
                    alt=""
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 text-sm text-gray-300">
                  {availabilityLabel(selectedGame) && (
                    <p className="font-semibold text-indigo-200">
                      {availabilityLabel(selectedGame)}
                    </p>
                  )}
                  {selectedGame.summary && <p>{selectedGame.summary}</p>}
                  {selectedGame.releaseDate && (
                    <p className="mt-2 text-gray-400">
                      {selectedGame.releaseDate}
                    </p>
                  )}
                  {selectedGame.genres.length > 0 && (
                    <p className="mt-2 text-gray-400">
                      {selectedGame.genres.join(' · ')}
                    </p>
                  )}
                  {selectedGame.rating != null && (
                    <p className="mt-2 text-gray-400">
                      {intl.formatMessage(messages.rating, {
                        rating: selectedGame.rating,
                      })}
                    </p>
                  )}
                  {selectedGame.developers?.length ? (
                    <p className="mt-2 text-gray-400">
                      {selectedGame.developers.join(' · ')}
                    </p>
                  ) : null}
                </div>
              </div>
              {(selectedGame.screenshots?.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-2 font-semibold text-white">
                    {intl.formatMessage(messages.screenshots)}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedGame.screenshots?.slice(0, 4).map((src) => (
                      <div
                        key={src}
                        className="relative aspect-video overflow-hidden rounded bg-gray-900"
                      >
                        <CachedImage
                          type="tmdb"
                          src={src}
                          alt=""
                          fill
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(selectedGame.videos?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedGame.videos?.map((video) => (
                    <a
                      key={video.videoId}
                      href={`https://www.youtube.com/watch?v=${video.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-300 hover:text-indigo-200"
                    >
                      {intl.formatMessage(messages.watchVideo, {
                        name:
                          video.name || intl.formatMessage(messages.gameVideo),
                      })}
                    </a>
                  ))}
                </div>
              )}
              {canRequest && (quota?.software?.limit ?? 0) > 0 && (
                <QuotaDisplay quota={quota?.software} mediaType="software" />
              )}
              {canRequest &&
                (selectedCategory === 'game' ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="text-sm text-gray-200">
                      {intl.formatMessage(messages.chooseOperatingSystem)}
                      <select
                        className="input input-lite mt-1 w-full"
                        value={variant.operatingSystem}
                        onChange={(event) =>
                          setVariant((current) => ({
                            ...current,
                            operatingSystem: event.target
                              .value as PcVariant['operatingSystem'],
                          }))
                        }
                      >
                        <option value="" />
                        {operatingSystems.map((os) => (
                          <option key={os} value={os}>
                            {intl.formatMessage(
                              os === 'macos'
                                ? messages.macos
                                : os === 'linux'
                                  ? messages.linux
                                  : messages.windows
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-gray-200">
                      {intl.formatMessage(messages.chooseArchitecture)}
                      <select
                        className="input input-lite mt-1 w-full"
                        value={variant.architecture}
                        onChange={(event) =>
                          setVariant((current) => ({
                            ...current,
                            architecture: event.target
                              .value as PcVariant['architecture'],
                          }))
                        }
                      >
                        <option value="" />
                        {architectures.map((architecture) => (
                          <option key={architecture} value={architecture}>
                            {intl.formatMessage(
                              architecture === 'arm64'
                                ? messages.arm64
                                : architecture === 'x86'
                                  ? messages.x86
                                  : architecture === 'universal'
                                    ? messages.universal
                                    : messages.x64
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <label className="block text-sm text-gray-200">
                    {intl.formatMessage(messages.chooseSystem)}
                    <select
                      className="input input-lite mt-1 w-full"
                      value={selectedSystem}
                      onChange={(event) =>
                        setSelectedSystem(event.target.value)
                      }
                    >
                      {selectedGame.emulationSystems?.map((system) => (
                        <option key={system.slug} value={system.slug}>
                          {system.name}
                          {selectedGame.availableSystems?.includes(system.slug)
                            ? ` · ${intl.formatMessage(messages.available)}`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <IndexerSearchLink
                category={selectedCategory}
                title={selectedGame.title}
              />
              {requestError && (
                <p role="alert" className="text-sm text-red-300">
                  {requestError}
                </p>
              )}
            </div>
          </Modal>
        </Transition>
      )}
    </>
  );
};

export default SoftwareCatalog;
