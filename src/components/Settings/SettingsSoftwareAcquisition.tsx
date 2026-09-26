import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
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
    'Provides the IGDB catalog and acquires approved Windows, Linux, and macOS game requests.',
  romarrTitle: 'ROMarrNG',
  romarrDescription:
    'Provides supported emulation systems and acquires approved ROM requests.',
  hostname: 'Hostname',
  port: 'Port',
  basePath: 'Base path',
  useSsl: 'Use SSL',
  apiKey: 'API key',
  apiKeySaved: 'A key is saved. Leave this blank to keep using it.',
  clearApiKey: 'Remove saved API key',
  testConnection: 'Test connection',
  testing: 'Testing…',
  save: 'Save settings',
  saving: 'Saving…',
  connectionSuccess: '{service} is connected.',
  saved: 'Software acquisition settings saved.',
  systemGroups: 'Emulation system groups',
  systemGroupsDescription:
    'Assign each ROMarrNG system to Retro or Modern before users can request titles for it.',
  unassigned: 'Not available in requests',
  retro: 'Retro',
  modern: 'Modern',
  loadingSystems: 'Loading supported ROMarrNG systems',
  configureRomarr: 'Connect ROMarrNG to load its supported systems.',
  loadError: 'Software acquisition settings could not be loaded.',
  systemsError: 'Supported systems could not be loaded.',
  testError: 'Connection test failed.',
  saveError: 'Settings could not be saved.',
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
}

interface EmulationSystem {
  slug: string;
  name: string;
  group: EmulationSystemGroup | null;
}

interface SystemResponse {
  results: EmulationSystem[];
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
  } = useSWR<SystemResponse>('/api/v1/software/catalog/systems', {
    shouldRetryOnError: false,
  });
  const [romarr, setRomarr] = useState<ProviderSettings | null>(null);
  const [questarr, setQuestarr] = useState<ProviderSettings | null>(null);
  const [systemGroups, setSystemGroups] = useState<
    Record<string, EmulationSystemGroup>
  >({});
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
    setSystemGroups(data.emulationSystemGroups ?? {});
  }, [data]);

  const updateProvider = (
    provider: 'romarr' | 'questarr',
    update: Partial<ProviderSettings>
  ) => {
    const setter = provider === 'romarr' ? setRomarr : setQuestarr;
    setter((current) => (current ? { ...current, ...update } : current));
  };

  const testProvider = async (provider: 'romarr' | 'questarr') => {
    const current = provider === 'romarr' ? romarr : questarr;
    if (!current) return;
    setTesting(provider);
    setTestState(null);
    try {
      const response = await axios.post<{ service: string }>(
        `/api/v1/settings/software-acquisition/test/${provider}`,
        getProviderPayload(current)
      );
      setTestState({
        provider,
        success: true,
        message: intl.formatMessage(messages.connectionSuccess, {
          service: response.data.service,
        }),
      });
      if (provider === 'romarr') {
        await mutate('/api/v1/software/catalog/systems');
      }
    } catch {
      setTestState({
        provider,
        success: false,
        message: intl.formatMessage(messages.testError),
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
        emulationSystemGroups: systemGroups,
      });
      await mutate('/api/v1/settings/software-acquisition');
      setSaveState({
        success: true,
        message: intl.formatMessage(messages.saved),
      });
    } catch {
      setSaveState({
        success: false,
        message: intl.formatMessage(messages.saveError),
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
          </label>
          {current.apiKeyConfigured && (
            <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
              <input
                type="checkbox"
                checked={current.clearApiKey}
                onChange={(event) =>
                  updateProvider(provider, {
                    clearApiKey: event.target.checked,
                    apiKey: '',
                  })
                }
                className="checkbox"
              />
              {intl.formatMessage(messages.clearApiKey)}
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-200 sm:col-span-2">
            <input
              type="checkbox"
              checked={current.useSsl}
              onChange={(event) =>
                updateProvider(provider, { useSsl: event.target.checked })
              }
              className="checkbox"
            />
            {intl.formatMessage(messages.useSsl)}
          </label>
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

        <section className="mt-8 rounded-lg border border-gray-700 bg-gray-800/50 p-4 sm:p-5">
          <div className="mb-4">
            <h4 className="text-lg font-semibold text-white">
              {intl.formatMessage(messages.systemGroups)}
            </h4>
            <p className="mt-1 text-sm text-gray-300">
              {intl.formatMessage(messages.systemGroupsDescription)}
            </p>
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
