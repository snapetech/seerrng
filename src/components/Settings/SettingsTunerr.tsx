import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SettingsField from '@app/components/Settings/SettingsField';
import { useLiveTvStatus } from '@app/hooks/useLiveTv';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import type { TunerrSportarrIntegrationStatus } from '@server/interfaces/api/settingsInterfaces';
import type { TunerrSettings } from '@server/lib/settings';
import axios from 'axios';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const REDACTED = '[REDACTED]';

const messages = defineMessages('components.Settings.SettingsTunerr', {
  title: 'Live TV (IPTV Tunerr)',
  description:
    'Connect IPTV Tunerr so people can see when a movie or series airs on Live TV and request recordings. Recording requests use the same approval rules as other requests.',
  setupNote:
    'SeerrNG talks to the Tunerr deck with its username and password. Set IPTV_TUNERR_WEBUI_ALLOW_LAN=1 on Tunerr so the deck accepts connections from SeerrNG, and run the Tunerr recorder with recording rules enabled.',
  loadError: 'Tunerr settings could not be loaded.',
  enabled: 'Enable Live TV',
  hostname: 'Hostname or IP Address',
  useSsl: 'Use HTTPS',
  baseUrl: 'Deck URL Base',
  deckPort: 'Deck Port',
  tunerPort: 'Tuner Port',
  guideUrl: 'Guide URL',
  guideUrlDescription:
    'Leave empty to read /guide.xml from the tuner port. Set this when the guide is served from somewhere else.',
  guideHours: 'Guide Window (Hours)',
  guideHoursDescription:
    'How far ahead SeerrNG looks for airings. Larger windows use more memory.',
  sportarrIntegrationTitle: 'Optional Sportarr DVR link',
  sportarrIntegrationDescription:
    'Make Tunerr’s matched live sports channels and guide available to Sportarr’s IPTV DVR. Sportarr still controls channel mappings, monitored leagues, and recordings.',
  sportarrBaseUrl: 'Tunerr URL reachable from Sportarr',
  sportarrBaseUrlDescription:
    'Leave empty to use the Tunerr hostname, HTTPS setting, and tuner port above. Set a base URL if Sportarr runs in a different network or uses a reverse proxy.',
  sportarrLinkSetup:
    'Save Tunerr settings, configure the default Sportarr connection, and enable Sports Automation in Tunerr before linking feeds.',
  sportarrStatusChecking: 'Checking Tunerr and Sportarr connection status…',
  sportarrTunerrMissing:
    'Enable and configure IPTV Tunerr to connect its sports feeds.',
  sportarrAutomationDisabled:
    'Turn on Sports Automation in IPTV Tunerr to publish the event playlist and guide.',
  sportarrAutomationReady:
    'Tunerr sports automation is on: {matched} of {events} scheduled events currently match a channel.',
  sportarrAutomationUnavailable:
    'SeerrNG could not read Tunerr’s sports schedule. Check Tunerr and retry.',
  sportarrMissing:
    'Connect a default Sportarr instance in Settings → Services to use its DVR.',
  sportarrUnavailable:
    'Sportarr is configured but could not be reached. Check its connection and retry.',
  sportarrNotLinked: 'The Tunerr sports feeds are not linked to Sportarr yet.',
  sportarrPaused:
    'The Tunerr playlist or guide is inactive in Sportarr. Enable both feeds there to use DVR scheduling.',
  sportarrFeedError:
    'Sportarr reports an error for one of the Tunerr feeds. Review the source details in Sportarr.',
  sportarrLinked:
    'Tunerr sports feeds are linked to {name}: {channels} channels and {programmes} guide programmes.',
  sportarrNoMatches:
    'No scheduled Tunerr events currently match a channel. Check Tunerr’s sports mappings; the linked Sportarr feed will populate when a match is available.',
  sportarrSourceOnly:
    'Sportarr has the Tunerr playlist, but its XMLTV guide is missing. Retry the setup to add it; if the playlist is inactive, enable it in Sportarr.',
  sportarrGuideConflict:
    'Sportarr already has this Tunerr guide attached to another playlist. Resolve the guide link in Sportarr before retrying.',
  sportarrLinkError: 'The Tunerr feeds could not be connected to Sportarr.',
  sportarrLinkSuccess:
    'Tunerr’s sports playlist and guide are connected to Sportarr.',
  sportarrConnect: 'Connect sports feeds',
  sportarrSync: 'Sync guide',
  sportarrConnecting: 'Connecting…',
  sportarrSteps:
    'After linking, review the imported channels in Sportarr, map channels to leagues, and enable automatic DVR for the leagues you want recorded.',
  sportarrIndependent:
    'SeerrNG’s own Live TV recording requests remain available and continue to follow request approval settings.',
  username: 'Deck Username',
  password: 'Deck Password',
  savedSecret: 'Saved — leave empty to keep it',
  clearSecret: 'Remove the saved password',
  test: 'Test Connection',
  testing: 'Testing…',
  testOk: 'Connected to the Tunerr deck and guide.',
  testMissing:
    'Connected, but this Tunerr version cannot record SeerrNG requests (missing: {features}). Update Tunerr to enable recording.',
  testGuideFailed: 'Guide: {error}',
  guideStatus:
    'Guide loaded: {programmes} programmes on {channels} channels, refreshed {time}.',
  guideTruncated:
    'The guide is larger than SeerrNG indexes; shorten the guide window to include every channel.',
  guideError: 'Last guide refresh failed: {error}',
  save: 'Save Changes',
  saving: 'Saving…',
  cancel: 'Discard Changes',
  unsavedChanges: 'You have unsaved changes.',
  saveSuccess: 'Tunerr settings saved.',
  saveError: 'Tunerr settings could not be saved.',
});

type Draft = Omit<TunerrSettings, 'deckPort' | 'tunerPort' | 'guideHours'> & {
  deckPort: string;
  tunerPort: string;
  guideHours: string;
  clearPassword: boolean;
};

interface TestResult {
  deck: boolean;
  guide: boolean;
  missingFeatures: string[];
  error?: string;
  guideError?: string;
}

const toDraft = (settings: TunerrSettings): Draft => ({
  ...settings,
  deckPort: String(settings.deckPort),
  tunerPort: String(settings.tunerPort),
  guideHours: String(settings.guideHours),
  clearPassword: false,
});

const toPayload = (draft: Draft) => ({
  enabled: draft.enabled,
  hostname: draft.hostname.trim(),
  useSsl: draft.useSsl,
  baseUrl: draft.baseUrl.trim(),
  deckPort: Number(draft.deckPort),
  tunerPort: Number(draft.tunerPort),
  guideUrl: draft.guideUrl.trim(),
  sportarrBaseUrl: draft.sportarrBaseUrl.trim(),
  guideHours: Number(draft.guideHours),
  username: draft.username,
  password: draft.password,
  clearPassword: draft.clearPassword,
});

const errorMessage = (error: unknown): string | undefined =>
  axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
    ? error.response.data.error
    : undefined;

const SettingsTunerr = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<TunerrSettings>(
    '/api/v1/settings/tunerr'
  );
  const { data: status, mutate: mutateStatus } = useLiveTvStatus();
  const [draft, setDraft] = useState<Draft>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>();
  const [connectingSportarr, setConnectingSportarr] = useState(false);
  const [sportarrConnectError, setSportarrConnectError] = useState<string>();
  const [sportarrConnectSuccess, setSportarrConnectSuccess] = useState(false);
  const {
    data: sportarrIntegration,
    error: sportarrIntegrationError,
    isLoading: sportarrIntegrationLoading,
    mutate: mutateSportarrIntegration,
  } = useSWR<TunerrSportarrIntegrationStatus>(
    data ? '/api/v1/settings/tunerr/sportarr' : null,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (data && !isDirty) setDraft(toDraft(data));
  }, [data, isDirty]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setIsDirty(true);
    setTestResult(undefined);
    setSportarrConnectError(undefined);
    setSportarrConnectSuccess(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      const response = await axios.put<TunerrSettings>(
        '/api/v1/settings/tunerr',
        toPayload(draft)
      );
      await mutate(response.data, { revalidate: false });
      void mutateStatus();
      void mutateSportarrIntegration();
      setIsDirty(false);
      addToast(intl.formatMessage(messages.saveSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (failure) {
      setSaveError(
        errorMessage(failure) ?? intl.formatMessage(messages.saveError)
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
        '/api/v1/settings/tunerr/test',
        toPayload(draft)
      );
      setTestResult(response.data);
    } catch (failure) {
      if (axios.isAxiosError(failure) && failure.response?.data) {
        const body = failure.response.data as Partial<TestResult>;
        setTestResult({
          deck: !!body.deck,
          guide: !!body.guide,
          missingFeatures: body.missingFeatures ?? [],
          error: body.error ?? errorMessage(failure),
          guideError: body.guideError,
        });
      } else {
        setTestResult({ deck: false, guide: false, missingFeatures: [] });
      }
    } finally {
      setTesting(false);
    }
  };

  const connectSportarr = async () => {
    setConnectingSportarr(true);
    setSportarrConnectError(undefined);
    setSportarrConnectSuccess(false);
    try {
      await axios.post('/api/v1/settings/tunerr/sportarr/connect');
      setSportarrConnectSuccess(true);
      await mutateSportarrIntegration();
    } catch (failure) {
      setSportarrConnectError(
        errorMessage(failure) ?? intl.formatMessage(messages.sportarrLinkError)
      );
      await mutateSportarrIntegration();
    } finally {
      setConnectingSportarr(false);
    }
  };

  const textField = (
    id: keyof Draft,
    label: string,
    options: {
      inputMode?: 'numeric' | 'url';
      maxLength?: number;
      description?: string;
      type?: string;
    } = {}
  ) => (
    <div className="form-row">
      <label htmlFor={`tunerr-${id}`}>{label}</label>
      <div className="form-input-area">
        <div className="form-input-field">
          <input
            id={`tunerr-${id}`}
            type={options.type ?? 'text'}
            inputMode={options.inputMode}
            maxLength={options.maxLength ?? 255}
            autoComplete="off"
            disabled={isSaving || connectingSportarr}
            value={String(draft?.[id] ?? '')}
            onChange={(event) =>
              update({ [id]: event.currentTarget.value } as Partial<Draft>)
            }
          />
        </div>
        {options.description && (
          <p className="settings-form-row-description">{options.description}</p>
        )}
      </div>
    </div>
  );

  const guide = status?.guide;

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
              <p>{intl.formatMessage(messages.setupNote)}</p>
            </Alert>
            {guide?.ready && !isDirty && (
              <p className="settings-form-row-description" role="status">
                {intl.formatMessage(messages.guideStatus, {
                  programmes: guide.programmeCount,
                  channels: guide.channelCount,
                  time: guide.refreshedAt
                    ? intl.formatTime(guide.refreshedAt)
                    : '',
                })}
              </p>
            )}
            {guide?.truncated && !isDirty && (
              <Alert
                type="warning"
                title={intl.formatMessage(messages.guideTruncated)}
              />
            )}
            {guide?.lastError && !isDirty && (
              <Alert
                type="warning"
                title={intl.formatMessage(messages.guideError, {
                  error: guide.lastError,
                })}
              />
            )}
            <div className="form-row">
              <label htmlFor="tunerr-enabled">
                {intl.formatMessage(messages.enabled)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id="tunerr-enabled"
                    name="tunerr-enabled"
                    label={intl.formatMessage(messages.enabled)}
                    checked={draft.enabled}
                    disabled={isSaving || connectingSportarr}
                    onCheckedChange={(checked) => update({ enabled: checked })}
                  />
                </div>
              </div>
            </div>
            {textField('hostname', intl.formatMessage(messages.hostname))}
            {textField('deckPort', intl.formatMessage(messages.deckPort), {
              inputMode: 'numeric',
              maxLength: 5,
            })}
            {textField('tunerPort', intl.formatMessage(messages.tunerPort), {
              inputMode: 'numeric',
              maxLength: 5,
            })}
            <div className="form-row">
              <label htmlFor="tunerr-ssl">
                {intl.formatMessage(messages.useSsl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    type="checkbox"
                    id="tunerr-ssl"
                    name="tunerr-ssl"
                    label={intl.formatMessage(messages.useSsl)}
                    checked={draft.useSsl}
                    disabled={isSaving || connectingSportarr}
                    onCheckedChange={(checked) => update({ useSsl: checked })}
                  />
                </div>
              </div>
            </div>
            {textField('baseUrl', intl.formatMessage(messages.baseUrl), {
              maxLength: 512,
            })}
            {textField('username', intl.formatMessage(messages.username), {
              maxLength: 256,
            })}
            <div className="form-row">
              <label htmlFor="tunerr-password">
                {intl.formatMessage(messages.password)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <input
                    id="tunerr-password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={2048}
                    disabled={
                      isSaving || connectingSportarr || draft.clearPassword
                    }
                    value={draft.password === REDACTED ? '' : draft.password}
                    placeholder={
                      draft.password === REDACTED
                        ? intl.formatMessage(messages.savedSecret)
                        : ''
                    }
                    onChange={(event) =>
                      update({
                        password:
                          event.currentTarget.value ||
                          (data.password ? REDACTED : ''),
                      })
                    }
                  />
                </div>
                {data.password && (
                  <div className="form-input-field">
                    <SettingsField
                      type="checkbox"
                      id="tunerr-clear-password"
                      name="tunerr-clear-password"
                      label={intl.formatMessage(messages.clearSecret)}
                      checked={draft.clearPassword}
                      disabled={isSaving || connectingSportarr}
                      onCheckedChange={(checked) =>
                        update({ clearPassword: checked })
                      }
                    />
                    <span>{intl.formatMessage(messages.clearSecret)}</span>
                  </div>
                )}
              </div>
            </div>
            {textField('guideUrl', intl.formatMessage(messages.guideUrl), {
              inputMode: 'url',
              maxLength: 2048,
              description: intl.formatMessage(messages.guideUrlDescription),
            })}
            {textField('guideHours', intl.formatMessage(messages.guideHours), {
              inputMode: 'numeric',
              maxLength: 3,
              description: intl.formatMessage(messages.guideHoursDescription),
            })}
            <section className="app-card-sub card-layout">
              <h4 className="card-title">
                {intl.formatMessage(messages.sportarrIntegrationTitle)}
              </h4>
              <p className="card-body-text">
                {intl.formatMessage(messages.sportarrIntegrationDescription)}
              </p>
              {textField(
                'sportarrBaseUrl',
                intl.formatMessage(messages.sportarrBaseUrl),
                {
                  inputMode: 'url',
                  maxLength: 1024,
                  description: intl.formatMessage(
                    messages.sportarrBaseUrlDescription
                  ),
                }
              )}
              {isDirty && (
                <p className="settings-form-row-description" role="status">
                  {intl.formatMessage(messages.sportarrLinkSetup)}
                </p>
              )}
              {sportarrIntegrationError && (
                <Alert
                  type="warning"
                  title={intl.formatMessage(messages.sportarrLinkError)}
                />
              )}
              {sportarrIntegrationLoading && (
                <p className="settings-form-row-description" role="status">
                  {intl.formatMessage(messages.sportarrStatusChecking)}
                </p>
              )}
              {sportarrIntegration?.tunerr.configured === false && (
                <Alert
                  type="info"
                  title={intl.formatMessage(messages.sportarrTunerrMissing)}
                />
              )}
              {sportarrIntegration?.tunerr.configured &&
                sportarrIntegration.tunerr.sportsAutomation === 'disabled' && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(
                      messages.sportarrAutomationDisabled
                    )}
                  />
                )}
              {sportarrIntegration?.tunerr.configured &&
                sportarrIntegration.tunerr.sportsAutomation === 'enabled' && (
                  <p className="settings-form-row-description" role="status">
                    {intl.formatMessage(messages.sportarrAutomationReady, {
                      matched:
                        sportarrIntegration.tunerr.matchedEventCount ?? 0,
                      events: sportarrIntegration.tunerr.eventCount ?? 0,
                    })}
                  </p>
                )}
              {sportarrIntegration?.tunerr.configured &&
                sportarrIntegration.tunerr.sportsAutomation ===
                  'unavailable' && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(
                      messages.sportarrAutomationUnavailable
                    )}
                  />
                )}
              {sportarrIntegration?.sportarr.configured === false && (
                <Alert
                  type="info"
                  title={intl.formatMessage(messages.sportarrMissing)}
                />
              )}
              {sportarrIntegration?.sportarr.configured &&
                sportarrIntegration.sportarr.reachable === false && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(messages.sportarrUnavailable)}
                  />
                )}
              {sportarrIntegration?.sportarr.reachable &&
                sportarrIntegration.sportarr.feeds.linked &&
                sportarrIntegration.sportarr.feeds.source &&
                sportarrIntegration.sportarr.feeds.guide &&
                !sportarrIntegration.sportarr.feeds.source.hasError &&
                !sportarrIntegration.sportarr.feeds.guide.hasError && (
                  <Alert type="info">
                    {intl.formatMessage(messages.sportarrLinked, {
                      name: sportarrIntegration.sportarr.name ?? 'Sportarr',
                      channels:
                        sportarrIntegration.sportarr.feeds.source.channelCount,
                      programmes:
                        sportarrIntegration.sportarr.feeds.guide.programCount,
                    })}
                  </Alert>
                )}
              {sportarrIntegration?.sportarr.reachable &&
                sportarrIntegration.sportarr.feeds.linked &&
                sportarrIntegration.tunerr.matchedEventCount === 0 && (
                  <p className="settings-form-row-description" role="status">
                    {intl.formatMessage(messages.sportarrNoMatches)}
                  </p>
                )}
              {sportarrIntegration?.sportarr.reachable &&
                (sportarrIntegration.sportarr.feeds.source?.hasError ||
                  sportarrIntegration.sportarr.feeds.guide?.hasError) && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(messages.sportarrFeedError)}
                  />
                )}
              {sportarrIntegration?.sportarr.reachable &&
                sportarrIntegration.sportarr.feeds.source &&
                !sportarrIntegration.sportarr.feeds.linked &&
                !sportarrIntegration.sportarr.feeds.guide && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(messages.sportarrSourceOnly)}
                  />
                )}
              {sportarrIntegration?.sportarr.reachable &&
                sportarrIntegration.sportarr.feeds.source &&
                !sportarrIntegration.sportarr.feeds.linked &&
                sportarrIntegration.sportarr.feeds.guide &&
                !sportarrIntegration.sportarr.feeds.guide.linkedToSource && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(messages.sportarrGuideConflict)}
                  />
                )}
              {sportarrIntegration?.sportarr.reachable &&
                sportarrIntegration.sportarr.feeds.source &&
                !sportarrIntegration.sportarr.feeds.linked &&
                sportarrIntegration.sportarr.feeds.guide?.linkedToSource && (
                  <Alert
                    type="warning"
                    title={intl.formatMessage(messages.sportarrPaused)}
                  />
                )}
              {sportarrIntegration?.sportarr.reachable &&
                !sportarrIntegration.sportarr.feeds.source && (
                  <Alert
                    type="info"
                    title={intl.formatMessage(messages.sportarrNotLinked)}
                  />
                )}
              {sportarrConnectError && (
                <Alert type="error" title={sportarrConnectError} />
              )}
              {sportarrConnectSuccess && (
                <Alert type="info">
                  {intl.formatMessage(messages.sportarrLinkSuccess)}
                </Alert>
              )}
              <p className="card-body-text">
                {intl.formatMessage(messages.sportarrSteps)}
              </p>
              <p className="card-body-text">
                {intl.formatMessage(messages.sportarrIndependent)}
              </p>
              <div className="settings-card-actions settings-service-card-actions">
                <Button
                  type="button"
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={
                    isDirty ||
                    isSaving ||
                    connectingSportarr ||
                    !sportarrIntegration?.tunerr.configured ||
                    sportarrIntegration.tunerr.sportsAutomation !== 'enabled' ||
                    sportarrIntegration.sportarr.reachable !== true
                  }
                  onClick={() => void connectSportarr()}
                >
                  {intl.formatMessage(
                    connectingSportarr
                      ? messages.sportarrConnecting
                      : sportarrIntegration?.sportarr.feeds.linked
                        ? messages.sportarrSync
                        : messages.sportarrConnect
                  )}
                </Button>
              </div>
            </section>
            {testResult &&
              (testResult.deck &&
              testResult.guide &&
              testResult.missingFeatures.length === 0 ? (
                <Alert type="info">{intl.formatMessage(messages.testOk)}</Alert>
              ) : (
                <>
                  {testResult.deck && testResult.missingFeatures.length > 0 && (
                    <Alert
                      type="warning"
                      title={intl.formatMessage(messages.testMissing, {
                        features: testResult.missingFeatures.join(', '),
                      })}
                    />
                  )}
                  {testResult.error && (
                    <Alert type="error" title={testResult.error} />
                  )}
                  {testResult.guideError && (
                    <Alert
                      type="error"
                      title={intl.formatMessage(messages.testGuideFailed, {
                        error: testResult.guideError,
                      })}
                    />
                  )}
                </>
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
                  disabled={
                    isSaving ||
                    connectingSportarr ||
                    testing ||
                    !draft.hostname.trim()
                  }
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
                    disabled={isSaving || connectingSportarr}
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
                  disabled={!isDirty || isSaving || connectingSportarr}
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

export default SettingsTunerr;
