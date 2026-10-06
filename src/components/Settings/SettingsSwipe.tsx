import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SettingsField from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { SwipeSettings } from '@server/lib/settings';
import axios from 'axios';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const REDACTED = '[REDACTED]';

const messages = defineMessages('components.Settings.SettingsSwipe', {
  title: 'Swipe Discovery',
  description:
    'Swipe shows people a stack of movies, series, and books picked from their requests and swipes. Swiping right makes a normal request with the usual approval rules.',
  aiNote:
    'Optional: connect Claude to order each deck and explain why a title was picked. Decks still come only from SeerrNG’s catalogs, and swiping keeps working if the AI provider is unavailable. Titles, taste notes, and swipe history are sent to Anthropic when this is on.',
  loadError: 'Swipe settings could not be loaded.',
  enabled: 'Enable Swipe',
  aiProvider: 'AI Ordering',
  aiNone: 'Off (catalog order)',
  aiAnthropic: 'Anthropic Claude',
  apiKey: 'Anthropic API Key',
  savedSecret: 'Saved — leave empty to keep it',
  clearSecret: 'Remove the saved API key',
  model: 'Model',
  modelHelp: 'Claude model ID. Leave empty for the default ({model}).',
  effort: 'Effort',
  effortHelp:
    'Higher effort can improve ordering but takes longer and costs more per deck.',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  test: 'Test AI Ordering',
  testing: 'Testing…',
  testOk: 'Claude answered the test request.',
  save: 'Save Changes',
  saving: 'Saving…',
  cancel: 'Discard Changes',
  unsavedChanges: 'You have unsaved changes.',
  saveSuccess: 'Swipe settings saved.',
  saveError: 'Swipe settings could not be saved.',
});

type Draft = SwipeSettings & { clearAiApiKey: boolean };

const DEFAULT_MODEL = 'claude-opus-5-5';

const SettingsSwipe = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<SwipeSettings>(
    '/api/v1/settings/swipe'
  );
  const [draft, setDraft] = useState<Draft>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string }
  >();

  useEffect(() => {
    if (data && !isDirty) setDraft({ ...data, clearAiApiKey: false });
  }, [data, isDirty]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setIsDirty(true);
    setTestResult(undefined);
  };

  const failureText = (failure: unknown, fallback: string) =>
    axios.isAxiosError(failure) &&
    typeof failure.response?.data?.error === 'string'
      ? failure.response.data.error
      : fallback;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      const response = await axios.put<SwipeSettings>(
        '/api/v1/settings/swipe',
        draft
      );
      await mutate(response.data, { revalidate: false });
      setIsDirty(false);
      addToast(intl.formatMessage(messages.saveSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (failure) {
      setSaveError(
        failureText(failure, intl.formatMessage(messages.saveError))
      );
    } finally {
      setIsSaving(false);
    }
  };

  const test = async () => {
    if (!draft) return;
    setTesting(true);
    try {
      await axios.post('/api/v1/settings/swipe/test', draft);
      setTestResult({ ok: true });
    } catch (failure) {
      setTestResult({
        ok: false,
        error: failureText(failure, intl.formatMessage(messages.saveError)),
      });
    } finally {
      setTesting(false);
    }
  };

  const usesAi = draft?.aiProvider === 'anthropic';

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
            <div className="form-row">
              <label htmlFor="swipe-enabled">
                {intl.formatMessage(messages.enabled)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id="swipe-enabled"
                    name="swipe-enabled"
                    label={intl.formatMessage(messages.enabled)}
                    checked={draft.enabled}
                    disabled={isSaving}
                    onCheckedChange={(checked) => update({ enabled: checked })}
                  />
                </div>
              </div>
            </div>
            <Alert type="info">
              <p>{intl.formatMessage(messages.aiNote)}</p>
            </Alert>
            <div className="form-row">
              <label htmlFor="swipe-ai-provider">
                {intl.formatMessage(messages.aiProvider)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <select
                    id="swipe-ai-provider"
                    value={draft.aiProvider}
                    disabled={isSaving}
                    onChange={(event) =>
                      update({
                        aiProvider: event.currentTarget
                          .value as SwipeSettings['aiProvider'],
                      })
                    }
                  >
                    <option value="none">
                      {intl.formatMessage(messages.aiNone)}
                    </option>
                    <option value="anthropic">
                      {intl.formatMessage(messages.aiAnthropic)}
                    </option>
                  </select>
                </div>
              </div>
            </div>
            {usesAi && (
              <>
                <div className="form-row">
                  <label htmlFor="swipe-ai-key">
                    {intl.formatMessage(messages.apiKey)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <input
                        id="swipe-ai-key"
                        type="password"
                        autoComplete="new-password"
                        maxLength={512}
                        disabled={isSaving || draft.clearAiApiKey}
                        value={
                          draft.aiApiKey === REDACTED ? '' : draft.aiApiKey
                        }
                        placeholder={
                          draft.aiApiKey === REDACTED
                            ? intl.formatMessage(messages.savedSecret)
                            : ''
                        }
                        onChange={(event) =>
                          update({
                            aiApiKey:
                              event.currentTarget.value ||
                              (data.aiApiKey ? REDACTED : ''),
                          })
                        }
                      />
                    </div>
                    {data.aiApiKey && (
                      <div className="form-input-field">
                        <SettingsField
                          type="checkbox"
                          id="swipe-clear-key"
                          name="swipe-clear-key"
                          label={intl.formatMessage(messages.clearSecret)}
                          checked={draft.clearAiApiKey}
                          disabled={isSaving}
                          onCheckedChange={(checked) =>
                            update({ clearAiApiKey: checked })
                          }
                        />
                        <span>{intl.formatMessage(messages.clearSecret)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="swipe-ai-model">
                    {intl.formatMessage(messages.model)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <input
                        id="swipe-ai-model"
                        type="text"
                        maxLength={100}
                        disabled={isSaving}
                        value={draft.aiModel}
                        placeholder={DEFAULT_MODEL}
                        onChange={(event) =>
                          update({ aiModel: event.currentTarget.value })
                        }
                      />
                    </div>
                    <p className="settings-form-row-description">
                      {intl.formatMessage(messages.modelHelp, {
                        model: DEFAULT_MODEL,
                      })}
                    </p>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="swipe-ai-effort">
                    {intl.formatMessage(messages.effort)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <select
                        id="swipe-ai-effort"
                        value={draft.aiEffort}
                        disabled={isSaving}
                        onChange={(event) =>
                          update({
                            aiEffort: event.currentTarget
                              .value as SwipeSettings['aiEffort'],
                          })
                        }
                      >
                        <option value="low">
                          {intl.formatMessage(messages.low)}
                        </option>
                        <option value="medium">
                          {intl.formatMessage(messages.medium)}
                        </option>
                        <option value="high">
                          {intl.formatMessage(messages.high)}
                        </option>
                      </select>
                    </div>
                    <p className="settings-form-row-description">
                      {intl.formatMessage(messages.effortHelp)}
                    </p>
                  </div>
                </div>
                {testResult &&
                  (testResult.ok ? (
                    <Alert type="info">
                      {intl.formatMessage(messages.testOk)}
                    </Alert>
                  ) : (
                    <Alert type="error" title={testResult.error} />
                  ))}
              </>
            )}
            {isDirty && (
              <p className="settings-form-row-description" role="status">
                {intl.formatMessage(messages.unsavedChanges)}
              </p>
            )}
            <div className="actions">
              <div className="settings-card-actions settings-service-card-actions">
                {usesAi && (
                  <Button
                    type="button"
                    buttonType="warning"
                    buttonSize="sm"
                    disabled={isSaving || testing}
                    onClick={() => void test()}
                  >
                    {intl.formatMessage(
                      testing ? messages.testing : messages.test
                    )}
                  </Button>
                )}
                {isDirty && (
                  <Button
                    type="button"
                    buttonSize="sm"
                    disabled={isSaving}
                    onClick={() => {
                      setDraft({ ...data, clearAiApiKey: false });
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

export default SettingsSwipe;
