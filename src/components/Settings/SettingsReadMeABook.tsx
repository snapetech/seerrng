import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SettingsField from '@app/components/Settings/SettingsField';
import defineMessages from '@app/utils/defineMessages';
import type ReadMeABookRequest from '@server/entity/ReadMeABookRequest';
import type { ReadMeABookSettings } from '@server/lib/settings';
import axios from 'axios';
import { useEffect, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type Draft = Omit<ReadMeABookSettings, 'port'> & {
  port: string;
  clearApiKey: boolean;
};
type RequestView = Pick<
  ReadMeABookRequest,
  'id' | 'title' | 'author' | 'asin' | 'status'
> & {
  user: { id: number; username: string; email: string } | null;
};
type Dashboard = {
  metrics: unknown;
  activeDownloads: unknown;
  recentRequests: unknown;
};
const REDACTED = '[REDACTED]';
const messages = defineMessages('components.Settings.SettingsReadMeABook', {
  title: 'ReadMeABook Audiobooks',
  description:
    'Use the ReadMeABook API for audiobook search, user requests, approvals, status, and acquisition dashboard data.',
  enabled: 'Enable ReadMeABook',
  hostname: 'Hostname or IP address',
  port: 'Port',
  useSsl: 'Use HTTPS',
  baseUrl: 'URL base',
  apiKey: 'API token',
  savedToken: 'Saved token — leave empty to keep it',
  clearToken: 'Remove saved token',
  save: 'Save settings',
  saving: 'Saving…',
  test: 'Test connection',
  testing: 'Testing…',
  approvals: 'Audiobook requests awaiting approval',
  approve: 'Approve',
  deny: 'Deny',
  dashboard: 'Acquisition dashboard',
  empty: 'No audiobook requests are waiting for approval.',
  loadError: 'ReadMeABook settings could not be loaded.',
  saveError: 'ReadMeABook settings could not be saved.',
  testOk: 'Connected to ReadMeABook.',
  testError: 'ReadMeABook connection failed.',
});

const initialDraft = (value: ReadMeABookSettings): Draft => ({
  ...value,
  port: String(value.port),
  clearApiKey: false,
});
const SettingsReadMeABook = () => {
  const intl = useIntl();
  const { data, error, mutate } = useSWR<
    ReadMeABookSettings & { apiKeyConfigured: boolean }
  >('/api/v1/settings/readmeabook');
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busyId, setBusyId] = useState<number>();
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const { data: approvals, mutate: mutateApprovals } = useSWR<RequestView[]>(
    data?.enabled ? '/api/v1/readmeabook/admin/requests' : null
  );
  const { data: dashboard } = useSWR<Dashboard>(
    data?.enabled ? '/api/v1/readmeabook/admin/dashboard' : null
  );

  useEffect(() => {
    if (data) setDraft(initialDraft(data));
  }, [data]);

  if (!draft && !error) return <LoadingSpinner />;
  if (!draft) {
    return <p className="error">{intl.formatMessage(messages.loadError)}</p>;
  }

  const update = (key: keyof Draft, value: Draft[keyof Draft]) =>
    setDraft((current) => current && { ...current, [key]: value });
  const payload = () => ({
    enabled: draft.enabled,
    hostname: draft.hostname.trim(),
    port: Number(draft.port),
    useSsl: draft.useSsl,
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey,
    clearApiKey: draft.clearApiKey,
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setMessage(undefined);
    setSaving(true);
    try {
      await axios.put('/api/v1/settings/readmeabook', payload());
      setMessage('ReadMeABook settings saved.');
      await mutate();
    } catch (caught) {
      setFailure(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.error === 'string'
          ? caught.response.data.error
          : intl.formatMessage(messages.saveError)
      );
    } finally {
      setSaving(false);
    }
  };
  const testConnection = async () => {
    setFailure(undefined);
    setMessage(undefined);
    setTesting(true);
    try {
      await axios.post('/api/v1/settings/readmeabook/test', payload());
      setMessage(intl.formatMessage(messages.testOk));
    } catch (caught) {
      setFailure(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.error === 'string'
          ? caught.response.data.error
          : intl.formatMessage(messages.testError)
      );
    } finally {
      setTesting(false);
    }
  };
  const approve = async (item: RequestView, action: 'approve' | 'deny') => {
    setBusyId(item.id);
    setFailure(undefined);
    try {
      await axios.post(
        `/api/v1/readmeabook/admin/requests/${item.id}/${action}`
      );
      await mutateApprovals();
    } catch (caught) {
      setFailure(
        axios.isAxiosError(caught) &&
          typeof caught.response?.data?.message === 'string'
          ? caught.response.data.message
          : intl.formatMessage(messages.saveError)
      );
    } finally {
      setBusyId(undefined);
    }
  };
  const field = (key: keyof Draft, label: string, type = 'text') => (
    <div className="form-row">
      <label htmlFor={`readmeabook-${key}`}>{label}</label>
      <div className="form-input-area">
        <input
          id={`readmeabook-${key}`}
          type={type}
          value={String(draft[key])}
          onChange={(event) => update(key, event.target.value)}
        />
      </div>
    </div>
  );

  return (
    <section className="section app-card-sub settings-service-section">
      <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
      <p className="description">{intl.formatMessage(messages.description)}</p>
      <form onSubmit={submit}>
        <div className="form-row">
          <label htmlFor="readmeabook-enabled">
            {intl.formatMessage(messages.enabled)}
          </label>
          <div className="form-input-area">
            <SettingsField
              type="checkbox"
              id="readmeabook-enabled"
              name="readmeabook-enabled"
              label={intl.formatMessage(messages.enabled)}
              checked={draft.enabled}
              onCheckedChange={(checked) => update('enabled', checked)}
            />
          </div>
        </div>
        {field('hostname', intl.formatMessage(messages.hostname))}
        {field('port', intl.formatMessage(messages.port), 'number')}
        {field('baseUrl', intl.formatMessage(messages.baseUrl))}
        {field(
          'apiKey',
          data?.apiKeyConfigured && draft.apiKey === REDACTED
            ? intl.formatMessage(messages.savedToken)
            : intl.formatMessage(messages.apiKey),
          'password'
        )}
        <div className="form-row">
          <label htmlFor="readmeabook-https">
            {intl.formatMessage(messages.useSsl)}
          </label>
          <div className="form-input-area">
            <SettingsField
              type="checkbox"
              id="readmeabook-https"
              name="readmeabook-https"
              label={intl.formatMessage(messages.useSsl)}
              checked={draft.useSsl}
              onCheckedChange={(checked) => update('useSsl', checked)}
            />
          </div>
        </div>
        {data?.apiKeyConfigured && (
          <div className="form-row">
            <label htmlFor="readmeabook-clear-token">
              {intl.formatMessage(messages.clearToken)}
            </label>
            <div className="form-input-area">
              <SettingsField
                type="checkbox"
                id="readmeabook-clear-token"
                name="readmeabook-clear-token"
                label={intl.formatMessage(messages.clearToken)}
                checked={draft.clearApiKey}
                onCheckedChange={(checked) => update('clearApiKey', checked)}
              />
            </div>
          </div>
        )}
        <div className="settings-page-actions">
          <Button buttonType="primary" type="submit" disabled={saving}>
            {intl.formatMessage(saving ? messages.saving : messages.save)}
          </Button>
          <Button
            buttonType="default"
            type="button"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {intl.formatMessage(testing ? messages.testing : messages.test)}
          </Button>
        </div>
      </form>
      {message && (
        <p className="description" role="status">
          {message}
        </p>
      )}
      {failure && <p className="error">{failure}</p>}
      {draft.enabled && (
        <>
          <h4 className="heading">{intl.formatMessage(messages.approvals)}</h4>
          {!approvals?.length && (
            <p className="description">{intl.formatMessage(messages.empty)}</p>
          )}
          {approvals?.map((item) => (
            <div className="app-list-row" key={item.id}>
              <span className="app-list-label">{item.title}</span>
              <span className="app-list-value">
                {item.author} · {item.user?.username ?? item.user?.email}
              </span>
              <div className="app-action-row">
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  type="button"
                  disabled={busyId !== undefined}
                  onClick={() => void approve(item, 'approve')}
                >
                  {intl.formatMessage(messages.approve)}
                </Button>
                <Button
                  buttonType="danger"
                  buttonSize="sm"
                  type="button"
                  disabled={busyId !== undefined}
                  onClick={() => void approve(item, 'deny')}
                >
                  {intl.formatMessage(messages.deny)}
                </Button>
              </div>
            </div>
          ))}
          <h4 className="heading">{intl.formatMessage(messages.dashboard)}</h4>
          {dashboard ? (
            <div className="app-list">
              {(['metrics', 'activeDownloads', 'recentRequests'] as const).map(
                (key) => (
                  <details className="app-list-row" key={key}>
                    <summary className="app-list-label">{key}</summary>
                    <pre className="app-list-value">
                      {JSON.stringify(dashboard[key], null, 2)}
                    </pre>
                  </details>
                )
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};

export default SettingsReadMeABook;
