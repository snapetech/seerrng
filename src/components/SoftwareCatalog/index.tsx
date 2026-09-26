import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  PcArchitecture,
  PcOperatingSystem,
} from '@server/api/software/types';
import axios from 'axios';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.SoftwareCatalog', {
  title: 'Software',
  intro:
    'Browse emulation titles and PC games. Requests keep their selected system or PC target through approval and download.',
  retro: 'Retro',
  modern: 'Modern',
  games: 'PC Games',
  searchPlaceholder: 'Search software titles',
  search: 'Search',
  popular: 'Popular titles',
  noResults: 'No titles match this search.',
  loadError: 'The software catalog could not be loaded.',
  configureHint:
    'Ask an administrator to connect QuestarrNG and the required acquisition service in Settings → Services.',
  request: 'Request',
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
  existingRequest: 'This title is already requested for that target.',
  chooseAll: 'Choose an operating system and architecture to continue.',
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

interface CatalogGame {
  id: string;
  igdbId: number;
  title: string;
  summary: string;
  coverUrl: string;
  releaseDate: string;
  platforms: string[];
  platformOptions: { id: number; name: string }[];
  genres: string[];
  emulationSystems?: EmulationSystemOption[];
}

interface CatalogResponse {
  results: CatalogGame[];
}

const categories: Category[] = ['retro', 'modern', 'game'];
const operatingSystems: PcOperatingSystem[] = ['windows', 'linux', 'macos'];
const architectures: PcArchitecture[] = ['x64', 'arm64', 'x86', 'universal'];

const SoftwareCatalog = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const canRequest = hasPermission(Permission.REQUEST);
  const [category, setCategory] = useState<Category>('retro');
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedGame, setSelectedGame] = useState<CatalogGame | null>(null);
  const [selectedSystem, setSelectedSystem] = useState('');
  const [variant, setVariant] = useState<PcVariant>({
    operatingSystem: '',
    architecture: '',
  });
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  const [requesting, setRequesting] = useState(false);

  const query = submittedQuery.trim();
  const url = useMemo(() => {
    const params = new URLSearchParams({ category, limit: '24' });
    if (query) {
      params.set('q', query);
      return `/api/v1/software/catalog/search?${params.toString()}`;
    }
    return `/api/v1/software/catalog/popular?${params.toString()}`;
  }, [category, query]);
  const { data, error, isLoading } = useSWR<CatalogResponse>(url);

  const openRequest = (game: CatalogGame) => {
    setSelectedGame(game);
    setSelectedSystem(game.emulationSystems?.[0]?.slug ?? '');
    setVariant({ operatingSystem: '', architecture: '' });
    setRequestError('');
  };

  const submitRequest = async () => {
    if (!selectedGame) return;
    if (
      category === 'game' &&
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
          category,
          catalogId: selectedGame.igdbId,
          ...(category === 'game'
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
      setSelectedGame(null);
    } catch (submitError) {
      setRequestError(
        axios.isAxiosError(submitError) && submitError.response?.status === 409
          ? intl.formatMessage(messages.existingRequest)
          : intl.formatMessage(messages.requestError)
      );
    } finally {
      setRequesting(false);
    }
  };

  const categoryTitle = intl.formatMessage(
    category === 'game'
      ? messages.games
      : category === 'modern'
        ? messages.modern
        : messages.retro
  );

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <main className="mb-10">
        <Header subtext={intl.formatMessage(messages.intro)}>
          {intl.formatMessage(messages.title)}
        </Header>

        <div className="mt-6 flex flex-wrap gap-2" role="tablist">
          {categories.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={category === value}
              onClick={() => {
                setCategory(value);
                setSubmittedQuery('');
                setSearchInput('');
                setRequestSuccess('');
              }}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus:ring-2 focus:ring-indigo-400 focus:outline-none ${
                category === value
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

        {requestSuccess && (
          <div
            role="status"
            className="mt-4 rounded-md border border-green-700 bg-green-900/30 px-4 py-3 text-sm text-green-200"
          >
            {requestSuccess}
          </div>
        )}

        <div className="mt-8 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold text-gray-100">
            {query
              ? intl.formatMessage(messages.searchPlaceholder)
              : intl.formatMessage(messages.popular)}
          </h2>
          <span className="text-sm text-gray-400">{categoryTitle}</span>
        </div>

        {isLoading ? (
          <div className="py-16">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="mt-5 rounded-lg border border-gray-700 bg-gray-800 px-5 py-6 text-sm text-gray-300">
            <p>{intl.formatMessage(messages.loadError)}</p>
            <p className="mt-2 text-gray-400">
              {intl.formatMessage(messages.configureHint)}
            </p>
          </div>
        ) : data?.results.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.results.map((game) => (
              <li key={game.igdbId}>
                <article className="group h-full overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow transition hover:border-gray-500 hover:shadow-lg">
                  <div className="relative aspect-[2/3] overflow-hidden bg-gray-900">
                    <CachedImage
                      type="tmdb"
                      src={
                        game.coverUrl || '/images/seerr_poster_not_found.png'
                      }
                      alt=""
                      className="object-cover transition duration-200 group-hover:scale-[1.02]"
                      fill
                    />
                  </div>
                  <div className="flex h-[10.5rem] flex-col p-3">
                    <h3 className="line-clamp-2 min-h-10 text-sm font-semibold text-white">
                      {game.title}
                    </h3>
                    <p className="mt-1 truncate text-xs text-gray-400">
                      {game.releaseDate || game.genres.slice(0, 2).join(' · ')}
                    </p>
                    <p className="mt-2 line-clamp-2 min-h-8 text-xs text-gray-300">
                      {category === 'game'
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
        ) : (
          <div className="mt-5 rounded-lg border border-gray-700 bg-gray-800 px-5 py-8 text-center text-sm text-gray-300">
            {intl.formatMessage(messages.noResults)}
          </div>
        )}
      </main>

      {selectedGame && (
        <Modal
          title={intl.formatMessage(messages.requestTitle, {
            title: selectedGame.title,
          })}
          subTitle={intl.formatMessage(messages.requestDescription)}
          onCancel={() => setSelectedGame(null)}
          onOk={submitRequest}
          okText={intl.formatMessage(messages.request)}
          cancelText={intl.formatMessage(globalMessages.cancel)}
          okDisabled={
            requesting ||
            (category !== 'game' && !selectedSystem) ||
            (category === 'game' &&
              (!variant.operatingSystem || !variant.architecture))
          }
          loading={requesting}
          dialogClass="max-w-xl"
        >
          <div className="space-y-4">
            {category === 'game' ? (
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
                  onChange={(event) => setSelectedSystem(event.target.value)}
                >
                  {selectedGame.emulationSystems?.map((system) => (
                    <option key={system.slug} value={system.slug}>
                      {system.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {requestError && (
              <p role="alert" className="text-sm text-red-300">
                {requestError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default SoftwareCatalog;
