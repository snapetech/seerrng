import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SettingsField from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { SlskdnSettings } from '@server/lib/settings';
import axios from 'axios';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const REDACTED = '[REDACTED]';

const messages = defineMessages('components.Settings.SettingsSlskdn', {
  title: 'Soulseek (slskdN)',
  description:
    'Connect slskdN to request single tracks that Lidarr cannot, fix albums slskdN flags as transcoded or incomplete, and identify songs with SongID. Lidarr can keep using slskdN for album downloads as before.',
  keyNote:
    'Use an slskdN API key with the read-write role. SongID needs the administrator role.',
  loadError: 'slskdN settings could not be loaded.',
  enabled: 'Enable Soulseek Requests',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  useSsl: 'Use HTTPS',
  baseUrl: 'URL Base',
  apiKey: 'API Key',
  savedSecret: 'Saved — leave empty to keep it',
  clearSecret: 'Remove the saved API key',
  searchFilter: 'Search Filter',
  searchFilterDescription:
    'Optional slskdN wishlist filter for track requests, for example to prefer lossless files.',
  test: 'Test Connection',
  testing: 'Testing…',
  testOk: 'Connected to slskdN {version}.',
  feature:
    '{feature}: {available, select, true {available} other {not available}}',
  wishlist: 'Track requests (wishlist)',
  libraryHealth: 'Album fixes (library health)',
  songId: 'SongID',
  save: 'Save Changes',
  saving: 'Saving…',
  cancel: 'Discard Changes',
  unsavedChanges: 'You have unsaved changes.',
  saveSuccess: 'slskdN settings saved.',
  saveError: 'slskdN settings could not be saved.',
});

type Draft = Omit<SlskdnSettings, 'port'> & {
  port: string;
  clearApiKey: boolean;
};

interface TestResult {
  success: boolean;
  version?: string;
  features?: { wishlist: boolean; libraryHealth: boolean; songId: boolean };
  error?: string;
}

const toDraft = (settings: SlskdnSettings): Draft => ({
  ...settings,
  port: String(settings.port),
  clearApiKey: false,
});

const toPayload = (draft: Draft) => ({
  enabled: draft.enabled,
  hostname: draft.hostname.trim(),
  port: Number(draft.port),
  useSsl: draft.useSsl,
  baseUrl: draft.baseUrl.trim(),
  apiKey: draft.apiKey,
  clearApiKey: draft.clearApiKey,
  searchFilter: draft.searchFilter,
});

const SettingsSlskdn = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<SlskdnSettings>(
    '/api/v1/settings/slskdn'
  );
  const [draft, setDraft] = useState<Draft>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>();

  useEffect(() => {
    if (data && !isDirty) setDraft(toDraft(data));
  }, [data, isDirty]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setIsDirty(true);
    setTestResult(undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      const response = await axios.put<SlskdnSettings>(
        '/api/v1/settings/slskdn',
        toPayload(draft)
      );
      await mutate(response.data, { revalidate: false });
      setIsDirty(false);
      addToast(intl.formatMessage(messages.saveSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (failure) {
      setSaveError(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.error === 'string'
          ? failure.response.data.error
          : intl.formatMessage(messages.saveError)
      );
    } finally {
      setIsSaving(false);
    }
  };

  const test = async () => {
    if (!draft) return;
    setTesting(true);
    setTestResult(undefined);
    try {
      const response = await axios.post<TestResult>(
        '/api/v1/settings/slskdn/test',
        toPayload(draft)
      );
      setTestResult(response.data);
    } catch (failure) {
      setTestResult({
        success: false,
        error:
          axios.isAxiosError(failure) &&
          typeof failure.response?.data?.error === 'string'
            ? failure.response.data.error
            : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  const textField = (
    id: 'hostname' | 'port' | 'baseUrl' | 'searchFilter',
    label: string,
    options: {
      inputMode?: 'numeric';
      maxLength?: number;
      description?: string;
    } = {}
  ) => (
    <div className="form-row">
      <label htmlFor={`slskdn-${id}`}>{label}</label>
      <div className="form-input-area">
        <div className="form-input-field">
          <input
            id={`slskdn-${id}`}
            type="text"
            inputMode={options.inputMode}
            maxLength={options.maxLength ?? 255}
            autoComplete="off"
            disabled={isSaving}
            value={draft?.[id] ?? ''}
            onChange={(event) => update({ [id]: event.currentTarget.value })}
          />
        </div>
        {options.description && (
          <p className="settings-form-row-description">{options.description}</p>
        )}
      </div>
    </div>
  );

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
            <Alert type="info">
              <p>{intl.formatMessage(messages.keyNote)}</p>
            </Alert>
            <div className="form-row">
              <label htmlFor="slskdn-enabled">
                {intl.formatMessage(messages.enabled)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id="slskdn-enabled"
                    name="slskdn-enabled"
                    label={intl.formatMessage(messages.enabled)}
                    checked={draft.enabled}
                    disabled={isSaving}
                    onCheckedChange={(checked) => update({ enabled: checked })}
                  />
                </div>
              </div>
            </div>
            {textField('hostname', intl.formatMessage(messages.hostname))}
            {textField('port', intl.formatMessage(messages.port), {
              inputMode: 'numeric',
              maxLength: 5,
            })}
            <div className="form-row">
              <label htmlFor="slskdn-ssl">
                {intl.formatMessage(messages.useSsl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id="slskdn-ssl"
                    name="slskdn-ssl"
                    label={intl.formatMessage(messages.useSsl)}
                    checked={draft.useSsl}
                    disabled={isSaving}
                    onCheckedChange={(checked) => update({ useSsl: checked })}
                  />
                </div>
              </div>
            </div>
            {textField('baseUrl', intl.formatMessage(messages.baseUrl), {
              maxLength: 512,
            })}
            <div className="form-row">
              <label htmlFor="slskdn-api-key">
                {intl.formatMessage(messages.apiKey)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id="slskdn-api-key"
                    type="password"
                    autoComplete="new-password"
                    maxLength={2048}
                    disabled={isSaving || draft.clearApiKey}
                    value={draft.apiKey === REDACTED ? '' : draft.apiKey}
                    placeholder={
                      draft.apiKey === REDACTED
                        ? intl.formatMessage(messages.savedSecret)
                        : ''
                    }
                    onChange={(event) =>
                      update({
                        apiKey:
                          event.currentTarget.value ||
                          (data.apiKey ? REDACTED : ''),
                      })
                    }
                  />
                </div>
                {data.apiKey && (
                  <div className="form-input-field">
                    <SettingsField
                      type="checkbox"
                      id="slskdn-clear-key"
                      name="slskdn-clear-key"
                      label={intl.formatMessage(messages.clearSecret)}
                      checked={draft.clearApiKey}
                      disabled={isSaving}
                      onCheckedChange={(checked) =>
                        update({ clearApiKey: checked })
                      }
                    />
                    <span>{intl.formatMessage(messages.clearSecret)}</span>
                  </div>
                )}
              </div>
            </div>
            {textField(
              'searchFilter',
              intl.formatMessage(messages.searchFilter),
              {
                maxLength: 512,
                description: intl.formatMessage(
                  messages.searchFilterDescription
                ),
              }
            )}
            {testResult &&
              (testResult.success ? (
                <Alert type="info">
                  <p>
                    {intl.formatMessage(messages.testOk, {
                      version: testResult.version ?? '',
                    })}
                  </p>
                  {testResult.features &&
                    (
                      [
                        ['wishlist', messages.wishlist],
                        ['libraryHealth', messages.libraryHealth],
                        ['songId', messages.songId],
                      ] as const
                    ).map(([key, label]) => (
                      <p key={key}>
                        {intl.formatMessage(messages.feature, {
                          feature: intl.formatMessage(label),
                          available: String(testResult.features?.[key]),
                        })}
                      </p>
                    ))}
                </Alert>
              ) : (
                <Alert
                  type="error"
                  title={
                    testResult.error ?? intl.formatMessage(messages.saveError)
                  }
                />
              ))}
            {isDirty && (
              <p className="settings-form-row-description" role="status">
                {intl.formatMessage(messages.unsavedChanges)}
              </p>
            )}
            <div className="actions">
              <div className="settings-card-actions settings-service-card-actions">
                <Button
                  type="button"
                  buttonType="warning"
                  buttonSize="sm"
                  disabled={isSaving || testing || !draft.hostname.trim()}
                  onClick={() => void test()}
                >
                  {intl.formatMessage(
                    testing ? messages.testing : messages.test
                  )}
                </Button>
                {isDirty && (
                  <Button
                    type="button"
                    buttonSize="sm"
                    disabled={isSaving}
                    onClick={() => {
                      setDraft(toDraft(data));
                      setIsDirty(false);
                      setSaveError(undefined);
                    }}
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

export default SettingsSlskdn;
