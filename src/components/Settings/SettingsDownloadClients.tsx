import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SettingsField from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type {
  DownloadClientSettings,
  DownloadClientType,
} from '@server/lib/settings';
import axios from 'axios';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const REDACTED = '[REDACTED]';
const MAX_CLIENTS = 8;

const messages = defineMessages('components.Settings.SettingsDownloadClients', {
  title: 'Live Download Progress',
  description:
    'Connect the torrent clients your Radarr, Sonarr, Lidarr, and Bookshelf services use. SeerrNG reads live speed, peers, and progress for downloads that people are viewing. It never adds, changes, or removes torrents.',
  loadError: 'Download client settings could not be loaded.',
  noClients:
    'No download clients are connected. Download progress updates when the scheduled Download Sync job runs.',
  addClient: 'Add Download Client',
  removeClient: 'Remove',
  newClient: 'New Download Client',
  name: 'Name',
  type: 'Client',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  useSsl: 'Use HTTPS',
  baseUrl: 'URL Base',
  baseUrlTransmission:
    'Leave empty to use /transmission. Set this only when Transmission is behind a different path.',
  username: 'Username',
  password: 'Password',
  delugePassword: 'Web UI Password',
  torrentngToken: 'API Token',
  savedSecret: 'Saved — leave empty to keep it',
  clearSecret: 'Remove the saved password or token',
  enabled: 'Read Live Progress from This Client',
  pollInterval: 'Refresh Interval (Seconds)',
  pollIntervalDescription:
    'How often SeerrNG asks the clients for progress while someone is viewing a download. Clients are not contacted when nobody is viewing one.',
  test: 'Test',
  testing: 'Testing…',
  testSuccess: 'Connected to {name}.',
  testSuccessVersion: 'Connected to {name} (version {version}).',
  testFailure: 'Could not connect to {name}.',
  lastCheckFailed: 'Last check failed: {error}',
  save: 'Save Changes',
  saving: 'Saving…',
  cancel: 'Discard Changes',
  unsavedChanges: 'You have unsaved changes.',
  saveSuccess: 'Download client settings saved.',
  saveError: 'Download client settings could not be saved.',
});

const CLIENT_LABELS: Record<DownloadClientType, string> = {
  qbittorrent: 'qBittorrent',
  transmission: 'Transmission',
  deluge: 'Deluge',
  torrentng: 'TorrentNG',
};

const DEFAULT_PORTS: Record<DownloadClientType, number> = {
  qbittorrent: 8080,
  transmission: 9091,
  deluge: 8112,
  torrentng: 8080,
};

const usesUsername = (type: DownloadClientType) =>
  type === 'qbittorrent' || type === 'transmission';

type DraftClient = Omit<DownloadClientSettings, 'id' | 'port'> & {
  id?: number;
  port: string;
  clearPassword: boolean;
  key: string;
};

interface LiveDownloadSettingsResponse {
  pollIntervalSeconds: number;
  clients: (DownloadClientSettings & { passwordConfigured: boolean })[];
}

interface StatusResponse {
  clients: { clientId: number; ok: boolean; error?: string }[];
}

type TestState =
  | { key: string; ok: true; version?: string }
  | { key: string; ok: false; error: string };

let draftKeyCounter = 0;
const nextKey = () => `client-${(draftKeyCounter += 1)}`;

const toDraft = (data: LiveDownloadSettingsResponse) => ({
  pollIntervalSeconds: String(data.pollIntervalSeconds),
  clients: data.clients.map((client): DraftClient => ({
    id: client.id,
    name: client.name,
    type: client.type,
    enabled: client.enabled,
    hostname: client.hostname,
    port: String(client.port),
    useSsl: client.useSsl,
    baseUrl: client.baseUrl,
    username: client.username,
    password: client.password,
    clearPassword: false,
    key: nextKey(),
  })),
});

const toPayloadClient = (client: DraftClient) => ({
  ...(client.id !== undefined ? { id: client.id } : {}),
  name: client.name.trim(),
  type: client.type,
  enabled: client.enabled,
  hostname: client.hostname.trim(),
  port: Number(client.port),
  useSsl: client.useSsl,
  baseUrl: client.baseUrl.trim(),
  username: usesUsername(client.type) ? client.username : '',
  password: client.password,
  clearPassword: client.clearPassword,
});

const errorMessage = (error: unknown): string | undefined => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | undefined;
    if (typeof data?.error === 'string') return data.error;
  }
  return undefined;
};

const SettingsDownloadClients = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<LiveDownloadSettingsResponse>(
    '/api/v1/settings/download-clients'
  );
  const { data: status } = useSWR<StatusResponse>(
    data?.clients.length ? '/api/v1/settings/download-clients/status' : null,
    { refreshInterval: 15_000 }
  );
  const [draft, setDraft] = useState<ReturnType<typeof toDraft>>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [testing, setTesting] = useState<string>();
  const [testResult, setTestResult] = useState<TestState>();

  useEffect(() => {
    if (data && !isDirty) {
      setDraft(toDraft(data));
    }
  }, [data, isDirty]);

  const updateClient = (key: string, patch: Partial<DraftClient>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            clients: current.clients.map((client) =>
              client.key === key ? { ...client, ...patch } : client
            ),
          }
        : current
    );
    setIsDirty(true);
    setTestResult(undefined);
  };

  const addClient = () => {
    setDraft((current) =>
      current
        ? {
            ...current,
            clients: [
              ...current.clients,
              {
                name: intl.formatMessage(messages.newClient),
                type: 'qbittorrent',
                enabled: true,
                hostname: '',
                port: String(DEFAULT_PORTS.qbittorrent),
                useSsl: false,
                baseUrl: '',
                username: '',
                password: '',
                clearPassword: false,
                key: nextKey(),
              },
            ],
          }
        : current
    );
    setIsDirty(true);
  };

  const removeClient = (key: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            clients: current.clients.filter((client) => client.key !== key),
          }
        : current
    );
    setIsDirty(true);
  };

  const discardChanges = () => {
    if (data) setDraft(toDraft(data));
    setIsDirty(false);
    setSaveError(undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      const response = await axios.put<LiveDownloadSettingsResponse>(
        '/api/v1/settings/download-clients',
        {
          pollIntervalSeconds: Number(draft.pollIntervalSeconds),
          clients: draft.clients.map(toPayloadClient),
        }
      );
      await mutate(response.data, { revalidate: false });
      setIsDirty(false);
      addToast(intl.formatMessage(messages.saveSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (saveFailure) {
      setSaveError(
        errorMessage(saveFailure) ?? intl.formatMessage(messages.saveError)
      );
    } finally {
      setIsSaving(false);
    }
  };

  const testClient = async (client: DraftClient) => {
    setTesting(client.key);
    setTestResult(undefined);
    try {
      const response = await axios.post<{ version?: string }>(
        '/api/v1/settings/download-clients/test',
        toPayloadClient(client)
      );
      setTestResult({
        key: client.key,
        ok: true,
        version: response.data.version,
      });
    } catch (testFailure) {
      setTestResult({
        key: client.key,
        ok: false,
        error:
          errorMessage(testFailure) ??
          intl.formatMessage(messages.testFailure, { name: client.name }),
      });
    } finally {
      setTesting(undefined);
    }
  };

  const passwordLabel = (type: DownloadClientType) =>
    intl.formatMessage(
      type === 'torrentng'
        ? messages.torrentngToken
        : type === 'deluge'
          ? messages.delugePassword
          : messages.password
    );

  const renderClient = (client: DraftClient) => {
    const id = `download-client-${client.key}`;
    const health = status?.clients.find(
      (entry) => entry.clientId === client.id
    );
    const result = testResult?.key === client.key ? testResult : undefined;

    return (
      <li
        key={client.key}
        className="settings-service-card app-card-inset refreshed-inset-surface"
      >
        <div className="settings-service-card-content">
          <div className="settings-service-card-body">
            <h4 className="settings-service-title">
              {client.name || CLIENT_LABELS[client.type]}
            </h4>
            <div className="form-row">
              <label htmlFor={`${id}-name`}>
                {intl.formatMessage(messages.name)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id={`${id}-name`}
                    type="text"
                    maxLength={80}
                    disabled={isSaving}
                    value={client.name}
                    onChange={(event) =>
                      updateClient(client.key, {
                        name: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-type`}>
                {intl.formatMessage(messages.type)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <select
                    id={`${id}-type`}
                    disabled={isSaving}
                    value={client.type}
                    onChange={(event) => {
                      const type = event.currentTarget
                        .value as DownloadClientType;
                      updateClient(client.key, {
                        type,
                        port:
                          client.port === String(DEFAULT_PORTS[client.type])
                            ? String(DEFAULT_PORTS[type])
                            : client.port,
                      });
                    }}
                  >
                    {(Object.keys(CLIENT_LABELS) as DownloadClientType[]).map(
                      (type) => (
                        <option key={type} value={type}>
                          {CLIENT_LABELS[type]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-hostname`}>
                {intl.formatMessage(messages.hostname)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id={`${id}-hostname`}
                    type="text"
                    maxLength={255}
                    autoComplete="off"
                    disabled={isSaving}
                    value={client.hostname}
                    onChange={(event) =>
                      updateClient(client.key, {
                        hostname: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-port`}>
                {intl.formatMessage(messages.port)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id={`${id}-port`}
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    disabled={isSaving}
                    value={client.port}
                    onChange={(event) =>
                      updateClient(client.key, {
                        port: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-ssl`}>
                {intl.formatMessage(messages.useSsl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id={`${id}-ssl`}
                    name={`${id}-ssl`}
                    label={intl.formatMessage(messages.useSsl)}
                    checked={client.useSsl}
                    disabled={isSaving}
                    onCheckedChange={(checked) =>
                      updateClient(client.key, { useSsl: checked })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-base-url`}>
                {intl.formatMessage(messages.baseUrl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id={`${id}-base-url`}
                    type="text"
                    maxLength={512}
                    disabled={isSaving}
                    value={client.baseUrl}
                    placeholder={
                      client.type === 'transmission' ? '/transmission' : ''
                    }
                    onChange={(event) =>
                      updateClient(client.key, {
                        baseUrl: event.currentTarget.value,
                      })
                    }
                  />
                </div>
                {client.type === 'transmission' && (
                  <p className="settings-form-row-description">
                    {intl.formatMessage(messages.baseUrlTransmission)}
                  </p>
                )}
              </div>
            </div>
            {usesUsername(client.type) && (
              <div className="form-row">
                <label htmlFor={`${id}-username`}>
                  {intl.formatMessage(messages.username)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <input
                      id={`${id}-username`}
                      type="text"
                      autoComplete="off"
                      maxLength={256}
                      disabled={isSaving}
                      value={client.username}
                      onChange={(event) =>
                        updateClient(client.key, {
                          username: event.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="form-row">
              <label htmlFor={`${id}-password`}>
                {passwordLabel(client.type)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id={`${id}-password`}
                    type="password"
                    autoComplete="new-password"
                    maxLength={2048}
                    disabled={isSaving || client.clearPassword}
                    value={client.password === REDACTED ? '' : client.password}
                    placeholder={
                      client.password === REDACTED
                        ? intl.formatMessage(messages.savedSecret)
                        : ''
                    }
                    onChange={(event) =>
                      updateClient(client.key, {
                        // An emptied field keeps the saved secret; use the
                        // clear option below to remove it.
                        password:
                          event.currentTarget.value ||
                          (client.id !== undefined ? REDACTED : ''),
                      })
                    }
                  />
                </div>
                {client.id !== undefined && (
                  <div className="form-input-field">
                    <SettingsField
                      type="checkbox"
                      id={`${id}-clear-password`}
                      name={`${id}-clear-password`}
                      label={intl.formatMessage(messages.clearSecret)}
                      checked={client.clearPassword}
                      disabled={isSaving}
                      onCheckedChange={(checked) =>
                        updateClient(client.key, { clearPassword: checked })
                      }
                    />
                    <span>{intl.formatMessage(messages.clearSecret)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="form-row">
              <label htmlFor={`${id}-enabled`}>
                {intl.formatMessage(messages.enabled)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id={`${id}-enabled`}
                    name={`${id}-enabled`}
                    label={intl.formatMessage(messages.enabled)}
                    checked={client.enabled}
                    disabled={isSaving}
                    onCheckedChange={(checked) =>
                      updateClient(client.key, { enabled: checked })
                    }
                  />
                </div>
              </div>
            </div>
            {health && !health.ok && health.error && !isDirty && (
              <Alert
                type="warning"
                title={intl.formatMessage(messages.lastCheckFailed, {
                  error: health.error,
                })}
              />
            )}
            {result &&
              (result.ok ? (
                <Alert type="info">
                  {result.version
                    ? intl.formatMessage(messages.testSuccessVersion, {
                        name: client.name,
                        version: result.version,
                      })
                    : intl.formatMessage(messages.testSuccess, {
                        name: client.name,
                      })}
                </Alert>
              ) : (
                <Alert type="error" title={result.error} />
              ))}
            <div className="settings-card-actions">
              <Button
                type="button"
                buttonType="warning"
                buttonSize="sm"
                disabled={isSaving || !!testing || !client.hostname.trim()}
                onClick={() => void testClient(client)}
              >
                {intl.formatMessage(
                  testing === client.key ? messages.testing : messages.test
                )}
              </Button>
              <Button
                type="button"
                buttonType="danger"
                buttonSize="sm"
                disabled={isSaving}
                onClick={() => removeClient(client.key)}
              >
                {intl.formatMessage(messages.removeClient)}
              </Button>
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="app-card-sub settings-group-card">
      <h3 className="settings-group-heading">
        {intl.formatMessage(messages.title)}
      </h3>
      <p className="settings-group-description">
        {intl.formatMessage(messages.description)}
      </p>
      <div className="settings-group-content">
        {!data && !error && <LoadingSpinner />}
        {error && (
          <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        )}
        {data && draft && !error && (
          <form onSubmit={(event) => void submit(event)}>
            {saveError && <Alert type="error" title={saveError} />}
            {draft.clients.length === 0 ? (
              <p className="settings-group-description">
                {intl.formatMessage(messages.noClients)}
              </p>
            ) : (
              <ul className="settings-service-grid">
                {draft.clients.map(renderClient)}
              </ul>
            )}
            <div className="form-row">
              <label htmlFor="download-clients-interval">
                {intl.formatMessage(messages.pollInterval)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id="download-clients-interval"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    disabled={isSaving}
                    value={draft.pollIntervalSeconds}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDraft((current) =>
                        current
                          ? { ...current, pollIntervalSeconds: value }
                          : current
                      );
                      setIsDirty(true);
                    }}
                  />
                </div>
                <p className="settings-form-row-description">
                  {intl.formatMessage(messages.pollIntervalDescription)}
                </p>
              </div>
            </div>
            {isDirty && (
              <p className="settings-form-row-description" role="status">
                {intl.formatMessage(messages.unsavedChanges)}
              </p>
            )}
            <div className="actions">
              <div className="settings-card-actions settings-service-card-actions">
                <Button
                  type="button"
                  buttonType="success"
                  buttonSize="sm"
                  disabled={isSaving || draft.clients.length >= MAX_CLIENTS}
                  onClick={addClient}
                >
                  {intl.formatMessage(messages.addClient)}
                </Button>
                {isDirty && (
                  <Button
                    type="button"
                    buttonSize="sm"
                    disabled={isSaving}
                    onClick={discardChanges}
                  >
                    {intl.formatMessage(messages.cancel)}
                  </Button>
                )}
                <Button
                  type="submit"
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={!isDirty || isSaving}
                >
                  {intl.formatMessage(
                    isSaving ? messages.saving : messages.save
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </section>
  );
};

export default SettingsDownloadClients;
