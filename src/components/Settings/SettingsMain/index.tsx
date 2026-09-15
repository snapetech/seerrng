import BlocklistedTagsSelector from '@app/components/BlocklistedTagsSelector';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import LanguageSelector from '@app/components/LanguageSelector';
import RegionSelector from '@app/components/RegionSelector';
import CopyButton from '@app/components/Settings/CopyButton';
import SettingsBadge from '@app/components/Settings/SettingsBadge';
import Field, {
  default as SettingsField,
} from '@app/components/Settings/SettingsField';
import SettingsFormRow from '@app/components/Settings/SettingsFormRow';
import { availableLanguages } from '@app/context/LanguageContext';
import useLocale from '@app/hooks/useLocale';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/24/solid';
import type { UserSettingsGeneralResponse } from '@server/interfaces/api/userSettingsInterfaces';
import type { MainSettings } from '@server/lib/settings';
import type { AvailableLocale } from '@server/types/languages';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsMain', {
  general: 'General',
  generalsettings: 'General Settings',
  generalsettingsDescription:
    'Configure global and default settings for Seerr.',
  apikey: 'API Key',
  apikeyCopied: 'Copied API key to clipboard.',
  applicationTitle: 'Application Title',
  applicationurl: 'Application URL',
  discoverRegion: 'Discover Region',
  discoverRegionTip: 'Filter content by regional availability',
  originallanguage: 'Discover Language',
  originallanguageTip: 'Filter content by original language',
  blocklistRegion: 'Blocklist Region',
  blocklistRegionTip:
    'Region used for blocklist content scanning (independent of discover settings)',
  blocklistLanguage: 'Blocklist Language',
  blocklistLanguageTip:
    'Language used for blocklist content scanning (independent of discover settings)',
  blocklistedTags: 'Blocklist Content with Tags',
  blocklistedTagsTip:
    'Automatically add content with tags to the blocklist using the "Process Blocklisted Tags" job',
  blocklistedTagsLimit: 'Limit Content Blocklisted per Tag',
  blocklistedTagsLimitTip:
    'The "Process Blocklisted Tags" job will blocklist this many pages into each sort. Larger numbers will create a more accurate blocklist, but use more space.',
  streamingRegion: 'Streaming Region',
  streamingRegionTip: 'Show streaming sites by regional availability',
  hideBlocklisted: 'Hide Blocklisted Items',
  hideBlocklistedTip:
    'Hide blocklisted items from discover pages for all users with the "Manage Blocklist" permission',
  toastApiKeySuccess: 'New API key generated successfully!',
  toastApiKeyFailure: 'Something went wrong while generating a new API key.',
  toastSettingsSuccess: 'Settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  hideAvailable: 'Hide Available Media',
  hideAvailableTip:
    'Hide available media from the discover pages but not search results',
  cacheImages: 'Enable Image Caching',
  cacheImagesTip:
    'Cache externally sourced images (requires a significant amount of disk space)',
  includeAdult: 'Include Adult Content',
  includeAdultTip:
    'Include adult content in TMDB searches and movie discovery results',
  validationApplicationTitle: 'You must provide an application title',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  partialRequestsEnabled: 'Allow Partial Series Requests',
  enableSpecialEpisodes: 'Allow Special Episodes Requests',
  locale: 'Display Language',
  youtubeUrl: 'YouTube URL',
  youtubeUrlTip:
    'Base URL for YouTube videos if a self-hosted YouTube instance is used.',
  versionCheck: 'Version Check',
  versionCheckTip: 'Automatically check for new versions on GitHub.',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  playlistIntegrations: 'Playlist Integrations',
  playlistIntegrationsDescription:
    'Configure the provider credentials used when users import playlists into SeerrNG.',
  spotifyClientId: 'Spotify Client ID',
  spotifyClientIdTip:
    'Create an application in the Spotify Developer Dashboard and copy its client ID.',
  spotifyClientSecret: 'Spotify Client Secret',
  spotifyClientSecretTip:
    'The Spotify client secret is stored in SeerrNG and never shown in full after saving.',
  youtubeApiKey: 'YouTube Data API Key',
  youtubeApiKeyTip:
    'A Google YouTube Data API v3 key is required for public YouTube playlists.',
});

const SettingsMain = () => {
  const { addToast } = useToasts();
  const { user: currentUser, hasPermission: userHasPermission } = useUser();
  const intl = useIntl();
  const { setLocale } = useLocale();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MainSettings>('/api/v1/settings/main');
  const { data: userData } = useSWR<UserSettingsGeneralResponse>(
    currentUser ? `/api/v1/user/${currentUser.id}/settings/main` : null
  );

  const MainSettingsSchema = Yup.object().shape({
    applicationTitle: Yup.string().required(
      intl.formatMessage(messages.validationApplicationTitle)
    ),
    applicationUrl: Yup.string()
      .test(
        'valid-url',
        intl.formatMessage(messages.validationApplicationUrl),
        isValidURL
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationApplicationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    blocklistedTagsLimit: Yup.number()
      .test(
        'positive',
        'Number must be greater than 0.',
        (value) => (value ?? 0) >= 0
      )
      .test(
        'lte-250',
        'Number must be less than or equal to 250.',
        (value) => (value ?? 0) <= 250
      ),
    youtubeUrl: Yup.string()
      .url(intl.formatMessage(messages.validationUrl))
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const regenerate = async () => {
    try {
      await axios.post('/api/v1/settings/main/regenerate');

      revalidate();
      addToast(intl.formatMessage(messages.toastApiKeySuccess), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch {
      addToast(intl.formatMessage(messages.toastApiKeyFailure), {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.general),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <Formik
        initialValues={{
          applicationTitle: data?.applicationTitle,
          applicationUrl: data?.applicationUrl,
          hideAvailable: data?.hideAvailable,
          hideBlocklisted: data?.hideBlocklisted,
          locale: data?.locale ?? 'en',
          discoverRegion: data?.discoverRegion,
          originalLanguage: data?.originalLanguage,
          streamingRegion: data?.streamingRegion || 'US',
          blocklistRegion: data?.blocklistRegion || '',
          blocklistLanguage: data?.blocklistLanguage || '',
          blocklistedTags: data?.blocklistedTags,
          blocklistedTagsLimit: data?.blocklistedTagsLimit || 50,
          partialRequestsEnabled: data?.partialRequestsEnabled,
          enableSpecialEpisodes: data?.enableSpecialEpisodes,
          cacheImages: data?.cacheImages,
          includeAdult: data?.includeAdult ?? false,
          youtubeUrl: data?.youtubeUrl,
          versionCheck: data?.versionCheck,
          spotifyClientId: data?.spotifyClientId ?? '',
          spotifyClientSecret: data?.spotifyClientSecret ?? '',
          youtubeApiKey: data?.youtubeApiKey ?? '',
        }}
        enableReinitialize
        validationSchema={MainSettingsSchema}
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/main', {
              applicationTitle: values.applicationTitle,
              applicationUrl: values.applicationUrl,
              hideAvailable: values.hideAvailable,
              hideBlocklisted: values.hideBlocklisted,
              locale: values.locale,
              discoverRegion: values.discoverRegion,
              streamingRegion: values.streamingRegion,
              originalLanguage: values.originalLanguage,
              blocklistRegion: values.blocklistRegion,
              blocklistLanguage: values.blocklistLanguage,
              blocklistedTags: values.blocklistedTags,
              blocklistedTagsLimit: values.blocklistedTagsLimit,
              partialRequestsEnabled: values.partialRequestsEnabled,
              enableSpecialEpisodes: values.enableSpecialEpisodes,
              cacheImages: values.cacheImages,
              includeAdult: values.includeAdult,
              youtubeUrl: values.youtubeUrl,
              versionCheck: values?.versionCheck,
              spotifyClientId: values.spotifyClientId,
              spotifyClientSecret: values.spotifyClientSecret,
              youtubeApiKey: values.youtubeApiKey,
            });
            mutate('/api/v1/settings/public');
            mutate('/api/v1/status?checkUpdateAvailable=false');

            if (setLocale) {
              setLocale(
                (userData?.locale
                  ? userData.locale
                  : values.locale) as AvailableLocale
              );
            }

            addToast(intl.formatMessage(messages.toastSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            addToast(intl.formatMessage(messages.toastSettingsFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            revalidate();
          }
        }}
      >
        {({
          errors,
          touched,
          isSubmitting,
          isValid,
          values,
          setFieldValue,
        }) => {
          return (
            <Form
              className="settings-page-form"
              data-testid="settings-main-form"
            >
              <section className="settings-group-card">
                <h3 className="settings-group-heading">
                  {intl.formatMessage(messages.generalsettings)}
                </h3>
                <p className="settings-group-description">
                  {intl.formatMessage(messages.generalsettingsDescription)}
                </p>
                <div className="settings-group-content">
                  {userHasPermission(Permission.ADMIN) && (
                    <div className="form-row">
                      <label htmlFor="apiKey" className="text-label">
                        {intl.formatMessage(messages.apikey)}
                      </label>
                      <div className="form-input-area">
                        <div className="form-input-field">
                          <SensitiveInput
                            type="text"
                            id="apiKey"
                            className="rounded-l-only"
                            value={data?.apiKey}
                            readOnly
                          />
                          <CopyButton
                            textToCopy={data?.apiKey ?? ''}
                            toastMessage={intl.formatMessage(
                              messages.apikeyCopied
                            )}
                            key={data?.apiKey}
                          />
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              regenerate();
                            }}
                            className="input-action"
                            type="button"
                          >
                            <ArrowPathIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="form-row">
                    <label htmlFor="applicationTitle" className="text-label">
                      {intl.formatMessage(messages.applicationTitle)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          id="applicationTitle"
                          name="applicationTitle"
                          type="text"
                        />
                      </div>
                      {errors.applicationTitle &&
                        touched.applicationTitle &&
                        typeof errors.applicationTitle === 'string' && (
                          <div className="error">{errors.applicationTitle}</div>
                        )}
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="applicationUrl" className="text-label">
                      {intl.formatMessage(messages.applicationurl)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          id="applicationUrl"
                          name="applicationUrl"
                          type="text"
                          inputMode="url"
                        />
                      </div>
                      {errors.applicationUrl &&
                        touched.applicationUrl &&
                        typeof errors.applicationUrl === 'string' && (
                          <div className="error">{errors.applicationUrl}</div>
                        )}
                    </div>
                  </div>
                  <SettingsFormRow
                    htmlFor="cacheImages"
                    label={intl.formatMessage(messages.cacheImages)}
                    description={intl.formatMessage(messages.cacheImagesTip)}
                    badge={<SettingsBadge badgeType="experimental" />}
                    labelClassName="checkbox-label"
                  >
                    <SettingsField
                      type="checkbox"
                      id="cacheImages"
                      name="cacheImages"
                      onChange={() => {
                        setFieldValue('cacheImages', !values.cacheImages);
                      }}
                    />
                  </SettingsFormRow>
                  <div className="form-row">
                    <label htmlFor="locale" className="text-label">
                      {intl.formatMessage(messages.locale)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field as="select" id="locale" name="locale">
                          {(
                            Object.keys(
                              availableLanguages
                            ) as (keyof typeof availableLanguages)[]
                          ).map((key) => (
                            <option
                              key={key}
                              value={availableLanguages[key].code}
                              lang={availableLanguages[key].code}
                            >
                              {availableLanguages[key].display}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>
                  </div>
                  <SettingsFormRow
                    htmlFor="includeAdult"
                    label={intl.formatMessage(messages.includeAdult)}
                    description={intl.formatMessage(messages.includeAdultTip)}
                    labelClassName="checkbox-label"
                  >
                    <SettingsField
                      type="checkbox"
                      id="includeAdult"
                      name="includeAdult"
                      onChange={() => {
                        setFieldValue('includeAdult', !values.includeAdult);
                      }}
                    />
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="discoverRegion"
                    label={intl.formatMessage(messages.discoverRegion)}
                    description={intl.formatMessage(messages.discoverRegionTip)}
                  >
                    <div className="form-input-field">
                      <RegionSelector
                        value={values.discoverRegion ?? ''}
                        name="discoverRegion"
                        onChange={setFieldValue}
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="originalLanguage"
                    label={intl.formatMessage(messages.originallanguage)}
                    description={intl.formatMessage(
                      messages.originallanguageTip
                    )}
                  >
                    <div className="form-input-field relative z-30">
                      <LanguageSelector
                        setFieldValue={setFieldValue}
                        value={values.originalLanguage}
                        fieldName="originalLanguage"
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="streamingRegion"
                    label={intl.formatMessage(messages.streamingRegion)}
                    description={intl.formatMessage(
                      messages.streamingRegionTip
                    )}
                  >
                    <div className="form-input-field relative">
                      <RegionSelector
                        value={values.streamingRegion}
                        name="streamingRegion"
                        onChange={setFieldValue}
                        regionType="streaming"
                        disableAll
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="blocklistRegion"
                    label={intl.formatMessage(messages.blocklistRegion)}
                    description={intl.formatMessage(
                      messages.blocklistRegionTip
                    )}
                  >
                    <div className="form-input-field">
                      <RegionSelector
                        value={values.blocklistRegion}
                        name="blocklistRegion"
                        onChange={setFieldValue}
                        regionType="discover"
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="blocklistLanguage"
                    label={intl.formatMessage(messages.blocklistLanguage)}
                    description={intl.formatMessage(
                      messages.blocklistLanguageTip
                    )}
                  >
                    <div className="form-input-field relative z-20">
                      <LanguageSelector
                        setFieldValue={setFieldValue}
                        serverValue={data?.blocklistLanguage}
                        value={values.blocklistLanguage}
                        fieldName="blocklistLanguage"
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="blocklistedTags"
                    label={intl.formatMessage(messages.blocklistedTags)}
                    description={intl.formatMessage(
                      messages.blocklistedTagsTip
                    )}
                  >
                    <div className="form-input-field relative z-10">
                      <BlocklistedTagsSelector
                        defaultValue={values.blocklistedTags}
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="blocklistedTagsLimit"
                    label={intl.formatMessage(messages.blocklistedTagsLimit)}
                    description={intl.formatMessage(
                      messages.blocklistedTagsLimitTip
                    )}
                    badge={<SettingsBadge badgeType="advanced" />}
                  >
                    <SettingsField
                      id="blocklistedTagsLimit"
                      name="blocklistedTagsLimit"
                      type="text"
                      inputMode="numeric"
                      className="short"
                      placeholder={50}
                    />
                    {errors.blocklistedTagsLimit &&
                      touched.blocklistedTagsLimit &&
                      typeof errors.blocklistedTagsLimit === 'string' && (
                        <div className="error">
                          {errors.blocklistedTagsLimit}
                        </div>
                      )}
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="hideAvailable"
                    label={intl.formatMessage(messages.hideAvailable)}
                    description={intl.formatMessage(messages.hideAvailableTip)}
                    badge={<SettingsBadge badgeType="experimental" />}
                    labelClassName="checkbox-label"
                  >
                    <SettingsField
                      type="checkbox"
                      id="hideAvailable"
                      name="hideAvailable"
                      onChange={() => {
                        setFieldValue('hideAvailable', !values.hideAvailable);
                      }}
                    />
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="hideBlocklisted"
                    label={intl.formatMessage(messages.hideBlocklisted)}
                    description={intl.formatMessage(
                      messages.hideBlocklistedTip
                    )}
                    labelClassName="checkbox-label"
                  >
                    <SettingsField
                      type="checkbox"
                      id="hideBlocklisted"
                      name="hideBlocklisted"
                      onChange={() => {
                        setFieldValue(
                          'hideBlocklisted',
                          !values.hideBlocklisted
                        );
                      }}
                    />
                  </SettingsFormRow>
                  <div className="form-row">
                    <label
                      htmlFor="partialRequestsEnabled"
                      className="checkbox-label"
                    >
                      <span className="mr-2">
                        {intl.formatMessage(messages.partialRequestsEnabled)}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <SettingsField
                        type="checkbox"
                        id="partialRequestsEnabled"
                        name="partialRequestsEnabled"
                        onChange={() => {
                          setFieldValue(
                            'partialRequestsEnabled',
                            !values.partialRequestsEnabled
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <label
                      htmlFor="enableSpecialEpisodes"
                      className="checkbox-label"
                    >
                      <span className="mr-2">
                        {intl.formatMessage(messages.enableSpecialEpisodes)}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <SettingsField
                        type="checkbox"
                        id="enableSpecialEpisodes"
                        name="enableSpecialEpisodes"
                        onChange={() => {
                          setFieldValue(
                            'enableSpecialEpisodes',
                            !values.enableSpecialEpisodes
                          );
                        }}
                      />
                    </div>
                  </div>
                  <SettingsFormRow
                    htmlFor="youtubeUrl"
                    label={intl.formatMessage(messages.youtubeUrl)}
                    description={intl.formatMessage(messages.youtubeUrlTip)}
                  >
                    <div className="form-input-field">
                      <Field
                        id="youtubeUrl"
                        name="youtubeUrl"
                        type="text"
                        inputMode="url"
                      />
                    </div>
                    {errors.youtubeUrl &&
                      touched.youtubeUrl &&
                      typeof errors.youtubeUrl === 'string' && (
                        <div className="error">{errors.youtubeUrl}</div>
                      )}
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="versionCheck"
                    label={intl.formatMessage(messages.versionCheck)}
                    description={intl.formatMessage(messages.versionCheckTip)}
                  >
                    <Field
                      type="checkbox"
                      id="versionCheck"
                      name="versionCheck"
                      onChange={() => {
                        setFieldValue('versionCheck', !values.versionCheck);
                      }}
                    />
                  </SettingsFormRow>
                </div>
              </section>
              <section className="settings-group-card">
                <h3 className="settings-group-heading">
                  {intl.formatMessage(messages.playlistIntegrations)}
                </h3>
                <p className="settings-group-description">
                  {intl.formatMessage(messages.playlistIntegrationsDescription)}
                </p>
                <div className="settings-group-content">
                  <SettingsFormRow
                    htmlFor="spotifyClientId"
                    label={intl.formatMessage(messages.spotifyClientId)}
                    description={intl.formatMessage(
                      messages.spotifyClientIdTip
                    )}
                  >
                    <div className="form-input-field">
                      <Field
                        id="spotifyClientId"
                        name="spotifyClientId"
                        type="text"
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="spotifyClientSecret"
                    label={intl.formatMessage(messages.spotifyClientSecret)}
                    description={intl.formatMessage(
                      messages.spotifyClientSecretTip
                    )}
                  >
                    <div className="form-input-field">
                      <SensitiveInput
                        as="field"
                        id="spotifyClientSecret"
                        name="spotifyClientSecret"
                        type="text"
                        value={values.spotifyClientSecret}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>
                        ) =>
                          setFieldValue(
                            'spotifyClientSecret',
                            event.target.value
                          )
                        }
                      />
                    </div>
                  </SettingsFormRow>
                  <SettingsFormRow
                    htmlFor="youtubeApiKey"
                    label={intl.formatMessage(messages.youtubeApiKey)}
                    description={intl.formatMessage(messages.youtubeApiKeyTip)}
                  >
                    <div className="form-input-field">
                      <SensitiveInput
                        as="field"
                        id="youtubeApiKey"
                        name="youtubeApiKey"
                        type="text"
                        value={values.youtubeApiKey}
                        onChange={(
                          event: React.ChangeEvent<HTMLInputElement>
                        ) => setFieldValue('youtubeApiKey', event.target.value)}
                      />
                    </div>
                  </SettingsFormRow>
                </div>
              </section>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting || !isValid}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(globalMessages.saving)
                          : intl.formatMessage(globalMessages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </Form>
          );
        }}
      </Formik>
    </>
  );
};

export default SettingsMain;
