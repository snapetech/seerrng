import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LabeledCheckbox from '@app/components/Common/LabeledCheckbox';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import PermissionEdit from '@app/components/PermissionEdit';
import QuotaSelector from '@app/components/QuotaSelector';
import { default as SettingsField } from '@app/components/Settings/SettingsField';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import { MediaServerType } from '@server/constants/server';
import type { MainSettings } from '@server/lib/settings';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as yup from 'yup';

const messages = defineMessages('components.Settings.SettingsUsers', {
  users: 'Users',
  userSettings: 'User Settings',
  userSettingsDescription: 'Configure global and default user settings.',
  toastSettingsSuccess: 'User settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  loginMethods: 'Login Methods',
  loginMethodsTip: 'Configure login methods for users.',
  localLogin: 'Enable Local Sign-In',
  localLoginTip:
    'Allow users to sign in using their email address and password',
  mediaServerLogin: 'Enable {mediaServerName} Sign-In',
  mediaServerLoginTip:
    'Allow users to sign in using their {mediaServerName} account',
  atLeastOneAuth: 'At least one authentication method must be selected.',
  newPlexLogin: 'Enable New {mediaServerName} Sign-In',
  newPlexLoginTip:
    'Allow {mediaServerName} users to sign in without first being imported',
  movieRequestLimitLabel: 'Global Movie Request Limit',
  tvRequestLimitLabel: 'Global Series Request Limit',
  musicRequestLimitLabel: 'Global Music Request Limit',
  bookRequestLimitLabel: 'Global Book Request Limit',
  comicRequestLimitLabel: 'Global Comic Request Limit',
  magazineRequestLimitLabel: 'Global Magazine Request Limit',
  softwareRequestLimitLabel: 'Global Software Request Limit',
  defaultPermissions: 'Default Permissions',
  defaultPermissionsTip: 'Initial permissions assigned to new users',
  disabledMediaServerLoginWarning:
    'Some users may not have a {applicationTitle} password set. Disabling {mediaServerName} sign-in could lock them out. Affected users will need to set a password from their profile or via a password reset link.',
});

const SettingsUsers = () => {
  const { addToast } = useToasts();
  const intl = useIntl();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MainSettings>('/api/v1/settings/main');
  const settings = useSettings();

  const schema = yup
    .object()
    .shape({
      localLogin: yup.boolean(),
      mediaServerLogin: yup.boolean(),
    })
    .test({
      name: 'atLeastOneAuth',
      test: function (values) {
        const isValid = (
          ['localLogin', 'mediaServerLogin'] as (keyof typeof values)[]
        ).some((field) => !!values[field]);

        if (isValid) return true;
        return this.createError({
          path: 'localLogin | mediaServerLogin',
          message: intl.formatMessage(messages.atLeastOneAuth),
        });
      },
    });

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const mediaServerFormatValues = {
    mediaServerName:
      settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? 'Jellyfin'
        : settings.currentSettings.mediaServerType === MediaServerType.EMBY
          ? 'Emby'
          : settings.currentSettings.mediaServerType === MediaServerType.PLEX
            ? 'Plex'
            : undefined,
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.users),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <section className="settings-group-card">
        <h3 className="settings-group-heading">
          {intl.formatMessage(messages.userSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.userSettingsDescription)}
        </p>
        <Formik
          initialValues={{
            localLogin: data?.localLogin,
            mediaServerLogin: data?.mediaServerLogin,
            newPlexLogin: data?.newPlexLogin,
            movieQuotaLimit: data?.defaultQuotas.movie.quotaLimit ?? 0,
            movieQuotaDays: data?.defaultQuotas.movie.quotaDays ?? 7,
            tvQuotaLimit: data?.defaultQuotas.tv.quotaLimit ?? 0,
            tvQuotaDays: data?.defaultQuotas.tv.quotaDays ?? 7,
            musicQuotaLimit: data?.defaultQuotas.music.quotaLimit ?? 0,
            musicQuotaDays: data?.defaultQuotas.music.quotaDays ?? 7,
            bookQuotaLimit: data?.defaultQuotas.book.quotaLimit ?? 0,
            bookQuotaDays: data?.defaultQuotas.book.quotaDays ?? 7,
            comicQuotaLimit: data?.defaultQuotas.comic.quotaLimit ?? 0,
            comicQuotaDays: data?.defaultQuotas.comic.quotaDays ?? 7,
            magazineQuotaLimit: data?.defaultQuotas.magazine.quotaLimit ?? 0,
            magazineQuotaDays: data?.defaultQuotas.magazine.quotaDays ?? 7,
            softwareQuotaLimit: data?.defaultQuotas.software.quotaLimit ?? 0,
            softwareQuotaDays: data?.defaultQuotas.software.quotaDays ?? 7,
            defaultPermissions: data?.defaultPermissions ?? 0,
          }}
          validationSchema={schema}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/main', {
                localLogin: values.localLogin,
                mediaServerLogin: values.mediaServerLogin,
                newPlexLogin: values.newPlexLogin,
                defaultQuotas: {
                  movie: {
                    quotaLimit: values.movieQuotaLimit,
                    quotaDays: values.movieQuotaDays,
                  },
                  tv: {
                    quotaLimit: values.tvQuotaLimit,
                    quotaDays: values.tvQuotaDays,
                  },
                  music: {
                    quotaLimit: values.musicQuotaLimit,
                    quotaDays: values.musicQuotaDays,
                  },
                  book: {
                    quotaLimit: values.bookQuotaLimit,
                    quotaDays: values.bookQuotaDays,
                  },
                  comic: {
                    quotaLimit: values.comicQuotaLimit,
                    quotaDays: values.comicQuotaDays,
                  },
                  magazine: {
                    quotaLimit: values.magazineQuotaLimit,
                    quotaDays: values.magazineQuotaDays,
                  },
                  software: {
                    quotaLimit: values.softwareQuotaLimit,
                    quotaDays: values.softwareQuotaDays,
                  },
                },
                defaultPermissions: values.defaultPermissions,
              });
              mutate('/api/v1/settings/public');

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
          {({ isSubmitting, isValid, values, errors, setFieldValue }) => {
            return (
              <Form className="settings-group-content">
                <div className="form-row">
                  <label htmlFor="magazineRequestLimit" className="text-label">
                    {intl.formatMessage(messages.magazineRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="magazineQuotaDays"
                      limitFieldName="magazineQuotaLimit"
                      mediaType="magazine"
                      defaultDays={values.magazineQuotaDays}
                      defaultLimit={values.magazineQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="softwareRequestLimit" className="text-label">
                    {intl.formatMessage(messages.softwareRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="softwareQuotaDays"
                      limitFieldName="softwareQuotaLimit"
                      mediaType="software"
                      defaultDays={values.softwareQuotaDays}
                      defaultLimit={values.softwareQuotaLimit}
                    />
                  </div>
                </div>
                <div
                  role="group"
                  aria-labelledby="group-label"
                  className="form-group"
                >
                  <div className="form-row">
                    <span id="group-label" className="group-label">
                      {intl.formatMessage(messages.loginMethods)}

                      {'localLogin | mediaServerLogin' in errors && (
                        <span className="error">
                          {errors['localLogin | mediaServerLogin'] as string}
                        </span>
                      )}
                    </span>

                    <div className="form-input-area max-w-lg">
                      <LabeledCheckbox
                        id="localLogin"
                        label={intl.formatMessage(messages.localLogin)}
                        description={intl.formatMessage(
                          messages.localLoginTip,
                          mediaServerFormatValues
                        )}
                        onChange={() =>
                          setFieldValue('localLogin', !values.localLogin)
                        }
                      />
                      <LabeledCheckbox
                        id="mediaServerLogin"
                        className="mt-4"
                        label={intl.formatMessage(
                          messages.mediaServerLogin,
                          mediaServerFormatValues
                        )}
                        description={intl.formatMessage(
                          messages.mediaServerLoginTip,
                          mediaServerFormatValues
                        )}
                        onChange={() =>
                          setFieldValue(
                            'mediaServerLogin',
                            !values.mediaServerLogin
                          )
                        }
                      />
                      {!values.mediaServerLogin && values.localLogin && (
                        <div className="mt-4">
                          <Alert
                            title={intl.formatMessage(
                              messages.disabledMediaServerLoginWarning,
                              {
                                applicationTitle:
                                  settings.currentSettings.applicationTitle,
                                ...mediaServerFormatValues,
                              }
                            )}
                            type="warning"
                          />
                        </div>
                      )}
                    </div>
                    <span className="settings-form-row-description">
                      {intl.formatMessage(messages.loginMethodsTip)}
                    </span>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="newPlexLogin" className="checkbox-label">
                    {intl.formatMessage(
                      messages.newPlexLogin,
                      mediaServerFormatValues
                    )}
                  </label>
                  <div className="form-input-area">
                    <SettingsField
                      type="checkbox"
                      id="newPlexLogin"
                      name="newPlexLogin"
                      onChange={() => {
                        setFieldValue('newPlexLogin', !values.newPlexLogin);
                      }}
                    />
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(
                      messages.newPlexLoginTip,
                      mediaServerFormatValues
                    )}
                  </span>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.movieRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="movieQuotaDays"
                      limitFieldName="movieQuotaLimit"
                      mediaType="movie"
                      defaultDays={values.movieQuotaDays}
                      defaultLimit={values.movieQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.tvRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="tvQuotaDays"
                      limitFieldName="tvQuotaLimit"
                      mediaType="tv"
                      defaultDays={values.tvQuotaDays}
                      defaultLimit={values.tvQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.musicRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="musicQuotaDays"
                      limitFieldName="musicQuotaLimit"
                      mediaType="music"
                      defaultDays={values.musicQuotaDays}
                      defaultLimit={values.musicQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.bookRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="bookQuotaDays"
                      limitFieldName="bookQuotaLimit"
                      mediaType="book"
                      defaultDays={values.bookQuotaDays}
                      defaultLimit={values.bookQuotaLimit}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="applicationTitle" className="text-label">
                    {intl.formatMessage(messages.comicRequestLimitLabel)}
                  </label>
                  <div className="form-input-area">
                    <QuotaSelector
                      onChange={setFieldValue}
                      dayFieldName="comicQuotaDays"
                      limitFieldName="comicQuotaLimit"
                      mediaType="comic"
                      defaultDays={values.comicQuotaDays}
                      defaultLimit={values.comicQuotaLimit}
                    />
                  </div>
                </div>
                <div
                  role="group"
                  aria-labelledby="group-label"
                  className="form-group"
                >
                  <div className="form-row">
                    <span id="group-label" className="group-label">
                      {intl.formatMessage(messages.defaultPermissions)}
                    </span>
                    <div className="form-input-area">
                      <div className="settings-permission-options max-w-lg">
                        <PermissionEdit
                          currentPermission={values.defaultPermissions}
                          onUpdate={(newPermissions) =>
                            setFieldValue('defaultPermissions', newPermissions)
                          }
                        />
                      </div>
                    </div>
                    <span className="settings-form-row-description">
                      {intl.formatMessage(messages.defaultPermissionsTip)}
                    </span>
                  </div>
                </div>
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
      </section>
    </>
  );
};

export default SettingsUsers;
