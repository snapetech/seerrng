import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SelectionCircle from '@app/components/Common/SelectionCircle';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import type { EmulationSystemGroup } from '@server/lib/settings';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.SettingsSoftwareAcquisition', {
  title: 'Software acquisition',
  description:
    'Connect the ROM and PC-game acquisition services used by SeerrNG requests.',
  questarrTitle: 'QuestarrNG',
  questarrDescription:
    'Acquires approved Windows, Linux, and macOS game requests. QuestarrNG can also provide the IGDB catalog and use indexers synced from Prowlarr; SeerrNG provides a separate manual Prowlarr search across media categories.',
  romarrTitle: 'ROMarrNG',
  romarrDescription:
    'Provides supported emulation systems and acquires approved ROM requests. Newer ROMarrNG builds can also provide the IGDB catalog; ROMarrNG may search Prowlarr, direct Torznab/Newznab sources, and plugins. SeerrNG’s manual Prowlarr search does not grab results.',
  hostname: 'Hostname',
  port: 'Port',
  basePath: 'Base path',
  useSsl: 'Use SSL',
  apiKey: 'API key',
  apiKeyDescription:
    'Use the API key configured in the corresponding ROMarrNG or QuestarrNG General settings. Leave blank to keep using the saved key.',
  apiKeySaved: 'A key is saved. Leave this blank to keep using it.',
  clearApiKey: 'Remove saved API key',
  testConnection: 'Test connection',
  testing: 'Testing…',
  save: 'Save settings',
  saving: 'Saving…',
  connectionSuccess: '{service} is connected.',
  romarrConnectionSuccess:
    '{service} is connected. Found {platformCount} systems.',
  catalogReady: 'IGDB catalog ready',
  catalogUnavailable:
    'This ROMarrNG version does not advertise the SeerrNG IGDB catalog. QuestarrNG remains the default.',
  datCatalogReady: 'DAT catalog ready for {count} systems',
  datCatalogUnavailable:
    'This ROMarrNG version does not advertise a loaded DAT catalog.',
  unmatchedDatNames:
    '{count} DAT names are not linked to a ROMarrNG system: {names}',
  contractVersion: 'Integration API v{version}',
  saved: 'Software acquisition settings saved.',
  systemGroups: 'Emulation system groups',
  systemGroupsDescription:
    'Assign each ROMarrNG system to Retro or Modern before users can request titles for it.',
  systemGroupsHelpLabel: 'About Retro and Modern groups',
  systemGroupsHelp:
    'Use Retro for older consoles and handhelds. Use Modern for newer platforms such as PS4, PS5, PS Vita, Xbox One, and Xbox Series. These groups organize browsing and requests in SeerrNG; they do not change ROMarrNG or automatically classify systems. Choose a group for each platform.',
  systemGroupsSourceHint:
    'This list uses saved ROMarrNG settings, not unsaved test values. Systems from a recent successful fetch can remain visible for up to five minutes.',
  assignAllRetro: 'Assign all to Retro',
  assignAllModern: 'Assign all to Modern',
  unassigned: 'Not available in requests',
  retro: 'Retro',
  modern: 'Modern',
  loadingSystems: 'Loading supported ROMarrNG systems',
  configureRomarr: 'Connect ROMarrNG to load its supported systems.',
  loadError: 'Software acquisition settings could not be loaded.',
  systemsError: 'Supported systems could not be loaded.',
  testError: 'Connection test failed.',
  testRequestHttpError:
    'SeerrNG could not complete the test request (HTTP {status}). Check SeerrNG access and server logs.',
  testRequestUnavailable:
    'SeerrNG could not complete the test request ({code}). Check SeerrNG access and server logs.',
  testRequestFailed:
    'SeerrNG could not complete the test request. Check SeerrNG access and server logs.',
  saveError: 'Settings could not be saved.',
  emulationCatalog: 'Emulation catalog source',
  emulationCatalogDescription:
    'QuestarrNG is the default. ROMarrNG can provide its IGDB catalog or a DAT-backed catalog when DAT files are loaded. ROMarrNG still acquires ROM requests; PC game requests always use QuestarrNG.',
  platformMappings: 'ROMarrNG to IGDB platform matching',
  platformMappingsDescription:
    'SeerrNG matches system names and aliases automatically when they resolve to one IGDB platform. Preview the matches and choose an override for systems that need a different platform.',
  previewPlatformMappings: 'Preview platform matches',
  loadingPlatformMappings: 'Loading platform matches…',
  automaticMatch: 'Automatic match',
  unmatched: 'No automatic match',
  manualMatch: 'Manual match',
  unavailableMatch: 'Saved platform is unavailable',
  unmatchedSystems: 'Systems without a match: {count}',
  unusedCatalogPlatforms: 'Unused IGDB platforms: {count}',
  platformPreviewError: 'Platform matches could not be loaded.',
  platformMappingHelp:
    'Choosing Automatic match removes a saved override. A system without a match is hidden from the ROM catalog until you choose an IGDB platform.',
  unmatchedDatSystems:
    '{count} DAT names are not linked to a ROMarrNG system. Update ROMarrNG platform aliases to include them: {names}',
});

interface ProviderSettings {
  hostname: string;
  port: number;
  useSsl: boolean;
  baseUrl: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  clearApiKey: boolean;
}

interface SoftwareSettingsResponse {
  romarr: Omit<ProviderSettings, 'clearApiKey'>;
  questarr: Omit<ProviderSettings, 'clearApiKey'>;
  emulationSystemGroups: Record<string, EmulationSystemGroup>;
  emulationCatalogProvider: 'questarr' | 'romarr' | 'romarr-dat';
  emulationPlatformMappings: Record<string, number>;
}

interface EmulationSystem {
  slug: string;
  name: string;
  group: EmulationSystemGroup | null;
}

interface SystemResponse {
  results: EmulationSystem[];
  catalogProvider?: 'questarr' | 'igdb' | 'dat';
  catalogSystemSlugs?: string[];
  unmatchedDatNames?: string[];
}

interface PlatformMappingPreview {
  systems: {
    slug: string;
    name: string;
    automaticMatch: { id: number; name: string } | null;
    selectedMatch: { id: number; name: string } | null;
    status: 'automatic' | 'manual' | 'unmatched';
  }[];
  catalogPlatforms: { id: number; name: string }[];
  unmatchedSystems: { slug: string; name: string }[];
  unmatchedCatalogPlatforms: { id: number; name: string }[];
}

interface TestState {
  provider?: 'romarr' | 'questarr';
  success: boolean;
  message: string;
}

const toProviderState = (
  provider: SoftwareSettingsResponse['romarr']
): ProviderSettings => ({
  ...provider,
  apiKey: '',
  clearApiKey: false,
});

const getProviderPayload = (provider: ProviderSettings) => ({
  hostname: provider.hostname,
  port: Number(provider.port),
  useSsl: provider.useSsl,
  baseUrl: provider.baseUrl,
  ...(provider.clearApiKey
    ? { apiKey: '' }
    : provider.apiKey
      ? { apiKey: provider.apiKey }
      : {}),
});

const SettingsSoftwareAcquisition = () => {
  const intl = useIntl();
  const { data, error, isLoading } = useSWR<SoftwareSettingsResponse>(
    '/api/v1/settings/software-acquisition'
  );
  const {
    data: systemsData,
    error: systemsError,
    isLoading: systemsLoading,
  } = useSWR<SystemResponse>('/api/v1/request/software/catalog/systems', {
    shouldRetryOnError: false,
  });
  const [romarr, setRomarr] = useState<ProviderSettings | null>(null);
  const [questarr, setQuestarr] = useState<ProviderSettings | null>(null);
  const [systemGroups, setSystemGroups] = useState<
    Record<string, EmulationSystemGroup>
  >({});
  const [emulationCatalogProvider, setEmulationCatalogProvider] = useState<
    'questarr' | 'romarr' | 'romarr-dat'
  >('questarr');
  const [emulationPlatformMappings, setEmulationPlatformMappings] = useState<
    Record<string, number>
  >({});
  const [mappingPreview, setMappingPreview] =
    useState<PlatformMappingPreview | null>(null);
  const [mappingPreviewError, setMappingPreviewError] = useState('');
  const [loadingMappingPreview, setLoadingMappingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'romarr' | 'questarr' | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);
  const [saveState, setSaveState] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!data) return;
    setRomarr(toProviderState(data.romarr));
    setQuestarr(toProviderState(data.questarr));
    setEmulationCatalogProvider(data.emulationCatalogProvider ?? 'questarr');
    setSystemGroups(data.emulationSystemGroups ?? {});
    setEmulationPlatformMappings(data.emulationPlatformMappings ?? {});
  }, [data]);

  const updateProvider = (
    provider: 'romarr' | 'questarr',
    update: Partial<ProviderSettings>
  ) => {
    const setter = provider === 'romarr' ? setRomarr : setQuestarr;
    setter((current) => (current ? { ...current, ...update } : current));
  };

  const assignAllSystems = (group: EmulationSystemGroup) => {
    const systems = systemsData?.results ?? [];
    if (systems.length === 0) return;

    setSystemGroups((current) => {
      const next = { ...current };
      systems.forEach((system) => {
        next[system.slug] = group;
      });
      return next;
    });
  };

  const previewPlatformMappings = async () => {
    setLoadingMappingPreview(true);
    setMappingPreviewError('');
    try {
      const response = await axios.get<PlatformMappingPreview>(
        '/api/v1/settings/software-acquisition/platform-mapping/preview'
      );
      setMappingPreview(response.data);
    } catch (error) {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : intl.formatMessage(messages.platformPreviewError);
      setMappingPreviewError(detail);
    } finally {
      setLoadingMappingPreview(false);
    }
  };

  const testProvider = async (provider: 'romarr' | 'questarr') => {
    const current = provider === 'romarr' ? romarr : questarr;
    if (!current) return;
    setTesting(provider);
    setTestState(null);
    try {
      const response = await axios.post<{
        service: string;
        platformCount?: number;
        apiVersion?: number;
        requestContractVersion?: number;
        capabilities?: { catalog?: boolean; datCatalog?: boolean };
        datCatalogPlatformCount?: number;
        unmatchedDatNames?: string[];
      }>(
        `/api/v1/settings/software-acquisition/test/${provider}`,
        getProviderPayload(current)
      );
      const connectionMessage =
        provider === 'romarr' && typeof response.data.platformCount === 'number'
          ? intl.formatMessage(messages.romarrConnectionSuccess, {
              service: response.data.service,
              platformCount: response.data.platformCount,
            })
          : intl.formatMessage(messages.connectionSuccess, {
              service: response.data.service,
            });
      const providerDetails =
        provider === 'romarr'
          ? [
              intl.formatMessage(
                response.data.capabilities?.catalog
                  ? messages.catalogReady
                  : messages.catalogUnavailable
              ),
              response.data.capabilities?.datCatalog &&
              typeof response.data.datCatalogPlatformCount === 'number'
                ? intl.formatMessage(messages.datCatalogReady, {
                    count: response.data.datCatalogPlatformCount,
                  })
                : intl.formatMessage(messages.datCatalogUnavailable),
              ...(response.data.unmatchedDatNames?.length
                ? [
                    intl.formatMessage(messages.unmatchedDatNames, {
                      count: response.data.unmatchedDatNames.length,
                      names: response.data.unmatchedDatNames
                        .slice(0, 4)
                        .join(', '),
                    }),
                  ]
                : []),
            ]
          : [];
      const providerDetail = providerDetails.join(' · ');
      setTestState({
        provider,
        success: true,
        message: `${connectionMessage}${providerDetail ? ` · ${providerDetail}` : ''} · ${intl.formatMessage(
          messages.contractVersion,
          {
            version:
              response.data.requestContractVersion ??
              response.data.apiVersion ??
              1,
          }
        )}`,
      });
      if (provider === 'romarr') {
        await mutate('/api/v1/request/software/catalog/systems');
      }
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : error.response
            ? intl.formatMessage(messages.testRequestHttpError, {
                status: error.response.status,
              })
            : error.code
              ? intl.formatMessage(messages.testRequestUnavailable, {
                  code: error.code,
                })
              : intl.formatMessage(messages.testRequestFailed)
        : intl.formatMessage(messages.testError);
      setTestState({
        provider,
        success: false,
        message: detail,
      });
    } finally {
      setTesting(null);
    }
  };

  const saveSettings = async () => {
    if (!romarr || !questarr) return;
    setSaving(true);
    setSaveState(null);
    try {
      await axios.put('/api/v1/settings/software-acquisition', {
        romarr: getProviderPayload(romarr),
        questarr: getProviderPayload(questarr),
        emulationCatalogProvider,
        emulationSystemGroups: systemGroups,
        emulationPlatformMappings,
      });
      await Promise.all([
        mutate('/api/v1/settings/software-acquisition'),
        mutate('/api/v1/request/software/catalog/systems'),
      ]);
      setSaveState({
        success: true,
        message: intl.formatMessage(messages.saved),
      });
    } catch (error) {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : intl.formatMessage(messages.saveError);
      setSaveState({
        success: false,
        message: detail,
      });
    } finally {
      setSaving(false);
    }
  };

  const renderProvider = (
    provider: 'romarr' | 'questarr',
    current: ProviderSettings | null
  ) => {
    if (!current) return null;
    const isRomarr = provider === 'romarr';
    const title = intl.formatMessage(
      isRomarr ? messages.romarrTitle : messages.questarrTitle
    );
    return (
      <section className="rounded-lg border border-gray-700 bg-gray-800/70 p-4 sm:p-5">
        <div className="mb-4">
          <h4 className="text-lg font-semibold text-white">{title}</h4>
          <p className="mt-1 text-sm text-gray-300">
            {intl.formatMessage(
              isRomarr
                ? messages.romarrDescription
                : messages.questarrDescription
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm text-gray-200">
            {intl.formatMessage(messages.hostname)}
            <input
              className="input input-lite mt-1 w-full"
              value={current.hostname}
              onChange={(event) =>
                updateProvider(provider, { hostname: event.target.value })
              }
              autoComplete="off"
            />
          </label>
          <label className="text-sm text-gray-200">
            {intl.formatMessage(messages.port)}
            <input
              className="input input-lite mt-1 w-full"
              type="number"
              min={1}
              max={65535}
              value={current.port}
              onChange={(event) =>
                updateProvider(provider, { port: Number(event.target.value) })
              }
            />
          </label>
          <label className="text-sm text-gray-200 sm:col-span-2">
            {intl.formatMessage(messages.basePath)}
            <input
              className="input input-lite mt-1 w-full"
              value={current.baseUrl}
              onChange={(event) =>
                updateProvider(provider, { baseUrl: event.target.value })
              }
              placeholder="/"
              autoComplete="off"
            />
          </label>
          <label className="text-sm text-gray-200 sm:col-span-2">
            {intl.formatMessage(messages.apiKey)}
            <input
              className="input input-lite mt-1 w-full"
              type="password"
              value={current.apiKey}
              onChange={(event) =>
                updateProvider(provider, {
                  apiKey: event.target.value,
                  clearApiKey: false,
                })
              }
              placeholder={
                current.apiKeyConfigured
                  ? intl.formatMessage(messages.apiKeySaved)
                  : ''
              }
              autoComplete="new-password"
            />
            <span className="mt-1 block text-xs text-gray-400">
              {intl.formatMessage(messages.apiKeyDescription)}
            </span>
          </label>
          {current.apiKeyConfigured && (
            <div className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
              <SelectionCircle
                label={intl.formatMessage(messages.clearApiKey)}
                selected={current.clearApiKey}
                onClick={() =>
                  updateProvider(provider, {
                    clearApiKey: !current.clearApiKey,
                    apiKey: '',
                  })
                }
              />
              <span>{intl.formatMessage(messages.clearApiKey)}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-gray-200 sm:col-span-2">
            <SelectionCircle
              label={intl.formatMessage(messages.useSsl)}
              selected={current.useSsl}
              onClick={() =>
                updateProvider(provider, { useSsl: !current.useSsl })
              }
            />
            <span>{intl.formatMessage(messages.useSsl)}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            buttonType="default"
            buttonSize="sm"
            disabled={testing !== null}
            onClick={() => testProvider(provider)}
          >
            {testing === provider
              ? intl.formatMessage(messages.testing)
              : intl.formatMessage(messages.testConnection)}
          </Button>
          {testState?.provider === provider && (
            <span
              role="status"
              className={
                testState.success
                  ? 'text-sm text-green-300'
                  : 'text-sm text-red-300'
              }
            >
              {testState.message}
            </span>
          )}
        </div>
      </section>
    );
  };

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return (
      <Alert type="error" title={intl.formatMessage(messages.loadError)} />
    );
  }

  const selectedPlatformForSystem = (
    system: PlatformMappingPreview['systems'][number]
  ) => {
    const override = emulationPlatformMappings[system.slug];
    return override
      ? (mappingPreview?.catalogPlatforms.find(
          (platform) => platform.id === override
        ) ?? null)
      : system.automaticMatch;
  };
  const unmatchedSystemCount =
    mappingPreview?.systems.filter(
      (system) => !selectedPlatformForSystem(system)
    ).length ?? 0;
  const selectedPlatformIds = new Set(
    (mappingPreview?.systems ?? []).flatMap((system) => {
      const platform = selectedPlatformForSystem(system);
      return platform ? [platform.id] : [];
    })
  );
  const unusedCatalogPlatformCount =
    mappingPreview?.catalogPlatforms.filter(
      (platform) => !selectedPlatformIds.has(platform.id)
    ).length ?? 0;

  return (
    <>
      <div className="mt-10 mb-6">
        <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
        <p className="description">
          {intl.formatMessage(messages.description)}
        </p>
      </div>
      <div className="section settings-service-section">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {renderProvider('romarr', romarr)}
          {renderProvider('questarr', questarr)}
        </div>

        <section className="settings-group-card">
          <h4 className="settings-group-heading">
            {intl.formatMessage(messages.emulationCatalog)}
          </h4>
          <p className="settings-group-description">
            {intl.formatMessage(messages.emulationCatalogDescription)}
          </p>
          <label>
            {intl.formatMessage(messages.emulationCatalog)}
            <select
              className="input input-lite"
              value={emulationCatalogProvider}
              onChange={(event) =>
                setEmulationCatalogProvider(
                  event.target.value as 'questarr' | 'romarr' | 'romarr-dat'
                )
              }
            >
              <option value="questarr">QuestarrNG</option>
              <option value="romarr">ROMarrNG · IGDB</option>
              <option value="romarr-dat">ROMarrNG · DAT</option>
            </select>
          </label>
        </section>

        <section className="settings-group-card">
          <h4 className="settings-group-heading">
            {intl.formatMessage(messages.platformMappings)}
          </h4>
          <p className="settings-group-description">
            {intl.formatMessage(messages.platformMappingsDescription)}
          </p>
          <Button
            buttonType="default"
            buttonSize="sm"
            disabled={loadingMappingPreview || !romarr?.hostname}
            onClick={() => void previewPlatformMappings()}
          >
            {loadingMappingPreview
              ? intl.formatMessage(messages.loadingPlatformMappings)
              : intl.formatMessage(messages.previewPlatformMappings)}
          </Button>
          {mappingPreviewError && (
            <Alert type="error" title={mappingPreviewError} />
          )}
          {mappingPreview && (
            <>
              <p className="settings-group-description">
                {intl.formatMessage(messages.platformMappingHelp)}
              </p>
              <div className="app-list-items section">
                <dl className="app-list">
                  {mappingPreview.systems.map((system) => {
                    const override = emulationPlatformMappings[system.slug];
                    const selectedMatch = selectedPlatformForSystem(system);
                    const status = override
                      ? selectedMatch
                        ? 'manual'
                        : 'unmatched'
                      : system.automaticMatch
                        ? 'automatic'
                        : 'unmatched';
                    return (
                      <div className="app-list-row" key={system.slug}>
                        <div>
                          <dt className="app-list-label">{system.name}</dt>
                          <dd className="app-list-value">
                            {intl.formatMessage(
                              override && !selectedMatch
                                ? messages.unavailableMatch
                                : status === 'manual'
                                  ? messages.manualMatch
                                  : status === 'automatic'
                                    ? messages.automaticMatch
                                    : messages.unmatched
                            )}
                            {selectedMatch ? ` · ${selectedMatch.name}` : ''}
                          </dd>
                          <select
                            className="input input-lite"
                            aria-label={`${system.name}: ${intl.formatMessage(messages.platformMappings)}`}
                            value={override ? String(override) : ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setEmulationPlatformMappings((current) => {
                                const next = { ...current };
                                if (value) next[system.slug] = Number(value);
                                else delete next[system.slug];
                                return next;
                              });
                            }}
                          >
                            {override && !selectedMatch && (
                              <option value={override}>
                                {intl.formatMessage(messages.unavailableMatch)}
                              </option>
                            )}
                            <option value="">
                              {intl.formatMessage(messages.automaticMatch)}
                            </option>
                            {mappingPreview.catalogPlatforms.map((platform) => (
                              <option key={platform.id} value={platform.id}>
                                {platform.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </dl>
              </div>
              <div className="settings-group-description">
                <p>
                  {intl.formatMessage(messages.unmatchedSystems, {
                    count: unmatchedSystemCount,
                  })}
                </p>
                <p>
                  {intl.formatMessage(messages.unusedCatalogPlatforms, {
                    count: unusedCatalogPlatformCount,
                  })}
                </p>
              </div>
            </>
          )}
        </section>

        <section className="mt-8 rounded-lg border border-gray-700 bg-gray-800/50 p-4 sm:p-5">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-semibold text-white">
                {intl.formatMessage(messages.systemGroups)}
              </h4>
              <Tooltip content={intl.formatMessage(messages.systemGroupsHelp)}>
                <button
                  type="button"
                  aria-label={intl.formatMessage(
                    messages.systemGroupsHelpLabel
                  )}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                >
                  <QuestionMarkCircleIcon
                    aria-hidden="true"
                    className="h-4 w-4"
                  />
                </button>
              </Tooltip>
            </div>
            <p className="mt-1 text-sm text-gray-300">
              {intl.formatMessage(messages.systemGroupsDescription)}
            </p>
            {systemsData?.results.length ? (
              <p className="mt-2 text-xs text-gray-400">
                {intl.formatMessage(messages.systemGroupsSourceHint)}
              </p>
            ) : null}
            {systemsData?.catalogProvider === 'dat' &&
            systemsData.unmatchedDatNames?.length ? (
              <div role="status">
                <Alert
                  type="warning"
                  title={intl.formatMessage(messages.unmatchedDatSystems, {
                    count: systemsData.unmatchedDatNames.length,
                    names: systemsData.unmatchedDatNames.slice(0, 4).join(', '),
                  })}
                />
              </div>
            ) : null}
          </div>
          {systemsLoading ? (
            <LoadingSpinner />
          ) : systemsError ? (
            <Alert
              type="info"
              title={intl.formatMessage(
                romarr?.hostname && romarr.apiKeyConfigured
                  ? messages.systemsError
                  : messages.configureRomarr
              )}
            />
          ) : systemsData?.results.length ? (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  buttonType="default"
                  buttonSize="sm"
                  disabled={saving}
                  onClick={() => assignAllSystems('retro')}
                >
                  {intl.formatMessage(messages.assignAllRetro)}
                </Button>
                <Button
                  buttonType="default"
                  buttonSize="sm"
                  disabled={saving}
                  onClick={() => assignAllSystems('modern')}
                >
                  {intl.formatMessage(messages.assignAllModern)}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                {systemsData.results.map((system) => (
                  <label
                    key={system.slug}
                    className="flex min-w-0 items-center justify-between gap-3 text-sm text-gray-200"
                  >
                    <span className="truncate" title={system.name}>
                      {system.name}
                    </span>
                    <select
                      className="input input-lite max-w-48 shrink-0"
                      value={systemGroups[system.slug] ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSystemGroups((current) => {
                          const next = { ...current };
                          if (value === 'retro' || value === 'modern') {
                            next[system.slug] = value;
                          } else {
                            delete next[system.slug];
                          }
                          return next;
                        });
                      }}
                    >
                      <option value="">
                        {intl.formatMessage(messages.unassigned)}
                      </option>
                      <option value="retro">
                        {intl.formatMessage(messages.retro)}
                      </option>
                      <option value="modern">
                        {intl.formatMessage(messages.modern)}
                      </option>
                    </select>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">
              {intl.formatMessage(messages.configureRomarr)}
            </p>
          )}
        </section>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            buttonType="primary"
            buttonSize="standard"
            disabled={saving || !romarr || !questarr}
            onClick={saveSettings}
          >
            {saving
              ? intl.formatMessage(messages.saving)
              : intl.formatMessage(messages.save)}
          </Button>
          {saveState && (
            <span
              role="status"
              className={
                saveState.success
                  ? 'text-sm text-green-300'
                  : 'text-sm text-red-300'
              }
            >
              {saveState.message}
            </span>
          )}
        </div>
      </div>
    </>
  );
};

export default SettingsSoftwareAcquisition;
