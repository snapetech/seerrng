import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import LanguageSelector from '@app/components/LanguageSelector';
import QuotaSelector from '@app/components/QuotaSelector';
import RegionSelector from '@app/components/RegionSelector';
import { availableLanguages } from '@app/context/LanguageContext';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { getPositiveQueryParamNumber } from '@app/hooks/useUpdateQueryParams';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { TmdbLanguage } from '@server/api/themoviedb/interfaces';
import { ApiErrorCode } from '@server/constants/error';
import type { UserSettingsGeneralResponse } from '@server/interfaces/api/userSettingsInterfaces';
import type { AvailableLocale } from '@server/types/languages';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import validator from 'validator';
import * as Yup from 'yup';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserGeneralSettings',
  {
    general: 'General',
    generalsettings: 'General Settings',
    displayName: 'Display Name',
    email: 'Email',
    save: 'Save Changes',
    saving: 'Saving…',
    mediaServerUser: '{mediaServerName} User',
    accounttype: 'Account Type',
    plexuser: 'Plex User',
    localuser: 'Local User',
    role: 'Role',
    owner: 'Owner',
    admin: 'Admin',
    user: 'User',
    toastSettingsSuccess: 'Settings saved successfully!',
    toastSettingsFailure: 'Something went wrong while saving settings.',
    toastSettingsFailureEmail: 'This email is already taken!',
    toastSettingsFailureEmailEmpty:
      'Another user already has this username. You must set an email',
    region: 'Discover Region',
    regionTip: 'Filter content by regional availability',
    discoverRegion: 'Discover Region',
    discoverRegionTip: 'Filter content by regional availability',
    originallanguage: 'Discover Language',
    originallanguageTip: 'Filter content by original language',
    streamingRegion: 'Streaming Region',
    streamingRegionTip: 'Show streaming sites by regional availability',
    movierequestlimit: 'Movie Request Limit',
    seriesrequestlimit: 'Series Request Limit',
    musicrequestlimit: 'Music Request Limit',
    bookrequestlimit: 'Book Request Limit',
    comicrequestlimit: 'Comic Request Limit',
    magazinerequestlimit: 'Magazine Request Limit',
    enableOverride: 'Override Global Limit',
    applanguage: 'Display Language',
    languageDefault: 'Default ({language})',
    preferredLanguageAll: 'Preferred Language for All Media',
    preferredLanguageMovie: 'Movie Language Override',
    preferredLanguageTv: 'Series Language Override',
    preferredLanguageMusic: 'Music Language Override',
    preferredLanguageBook: 'Book Language Override',
    preferredLanguageTip:
      'Each medium inherits this default unless you set an override. SeerrNG uses matching Radarr or Sonarr language profiles when available and selects a matching book edition when available. Music services do not currently expose a language-based request choice. You can still change the destination or edition for each request.',
    preferredLanguageAny: 'Any language',
    preferredLanguageInherit: 'Use all-media preference',
    validationemailrequired: 'Email required',
    validationemailformat: 'Valid email required',
    plexwatchlistsyncmovies: 'Auto-Request Movies',
    plexwatchlistsyncmoviestip:
      'Automatically request movies on your <PlexWatchlistSupportLink>Plex Watchlist</PlexWatchlistSupportLink>',
    plexwatchlistsyncseries: 'Auto-Request Series',
    plexwatchlistsyncseriestip:
      'Automatically request series on your <PlexWatchlistSupportLink>Plex Watchlist</PlexWatchlistSupportLink>',
    musicwatchlistsync: 'Auto-Request Music',
    musicwatchlistsynctip:
      'Automatically request albums added to SeerrNG music watchlists when a supported music watchlist source is available.',
    bookwatchlistsync: 'Auto-Request Books',
    bookwatchlistsynctip:
      'Automatically request books added to SeerrNG book watchlists when a supported book watchlist source is available.',
    comicwatchlistsync: 'Auto-Request Comics',
    comicwatchlistsynctip:
      'Automatically request comics added to your SeerrNG comic watchlist.',
    magazinewatchlistsync: 'Auto-Request Magazines',
    magazinewatchlistsynctip:
      'Automatically request magazines added to your SeerrNG magazine watchlist.',
    cardTextVisibility: 'Card Titles',
    cardTextVisibilityTip:
      'Choose when each media type shows title text on poster cards.',
    cardTextVisibilityMovie: 'Movies',
    cardTextVisibilityTv: 'Series',
    cardTextVisibilityAlbum: 'Music',
    cardTextVisibilityBook: 'Books',
    cardTextVisibilityHover: 'On hover',
    cardTextVisibilityAlways: 'Always',
  }
);

const UserGeneralSettings = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { locale, setLocale } = useLocale();
  const [movieQuotaEnabled, setMovieQuotaEnabled] = useState(false);
  const [tvQuotaEnabled, setTvQuotaEnabled] = useState(false);
  const [musicQuotaEnabled, setMusicQuotaEnabled] = useState(false);
  const [bookQuotaEnabled, setBookQuotaEnabled] = useState(false);
  const [comicQuotaEnabled, setComicQuotaEnabled] = useState(false);
  const [magazineQuotaEnabled, setMagazineQuotaEnabled] = useState(false);
  const router = useRouter();
  const userId = getPositiveQueryParamNumber(router.query.userId);
  const {
    user,
    hasPermission,
    revalidate: revalidateUser,
  } = useUser({
    id: userId,
  });
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const { currentSettings } = useSettings();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<UserSettingsGeneralResponse>(
    user ? `/api/v1/user/${user?.id}/settings/main` : null
  );
  const { data: languages } = useSWR<TmdbLanguage[]>('/api/v1/languages');
  const preferredLanguageOptions = useMemo(
    () =>
      (languages ?? [])
        .filter((language) => /^[a-z]{2}$/.test(language.iso_639_1))
        .map((language) => ({
          code: language.iso_639_1,
          name:
            intl.formatDisplayName(language.iso_639_1, {
              type: 'language',
              fallback: 'none',
            }) ||
            language.english_name ||
            language.name,
        }))
        .sort((left, right) =>
          left.name.localeCompare(right.name, intl.locale)
        ),
    [intl, languages]
  );

  const UserGeneralSettingsSchema = Yup.object().shape({
    email:
      // email is required for everybody except non-admin jellyfin users
      user?.id === 1 ||
      (user?.userType !== UserType.JELLYFIN && user?.userType !== UserType.EMBY)
        ? Yup.string()
            .test(
              'email',
              intl.formatMessage(messages.validationemailformat),
              (value) =>
                !value || validator.isEmail(value, { require_tld: false })
            )
            .required(intl.formatMessage(messages.validationemailrequired))
        : Yup.string().test(
            'email',
            intl.formatMessage(messages.validationemailformat),
            (value) =>
              !value || validator.isEmail(value, { require_tld: false })
          ),
  });

  useEffect(() => {
    setMovieQuotaEnabled(
      data?.movieQuotaLimit != undefined && data?.movieQuotaDays != undefined
    );
    setTvQuotaEnabled(
      data?.tvQuotaLimit != undefined && data?.tvQuotaDays != undefined
    );
    setMusicQuotaEnabled(
      data?.musicQuotaLimit != undefined && data?.musicQuotaDays != undefined
    );
    setBookQuotaEnabled(
      data?.bookQuotaLimit != undefined && data?.bookQuotaDays != undefined
    );
    setComicQuotaEnabled(
      data?.comicQuotaLimit != undefined && data?.comicQuotaDays != undefined
    );
    setMagazineQuotaEnabled(
      data?.magazineQuotaLimit != undefined &&
        data?.magazineQuotaDays != undefined
    );
  }, [data]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={500} />;
  }

  const preferredLanguageOverrides = [
    {
      field: 'preferredLanguageMovie',
      label: messages.preferredLanguageMovie,
    },
    {
      field: 'preferredLanguageTv',
      label: messages.preferredLanguageTv,
    },
    {
      field: 'preferredLanguageMusic',
      label: messages.preferredLanguageMusic,
    },
    {
      field: 'preferredLanguageBook',
      label: messages.preferredLanguageBook,
    },
  ] as const;

  const preferredLanguageFieldValue = (
    mediaType: 'movie' | 'tv' | 'music' | 'book'
  ) => {
    const preferredLanguages = data.preferredLanguages;
    if (
      !preferredLanguages ||
      !Object.prototype.hasOwnProperty.call(preferredLanguages, mediaType)
    ) {
      return 'inherit';
    }

    return preferredLanguages[mediaType] ?? 'any';
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.general),
          intl.formatMessage(globalMessages.usersettings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.generalsettings)}
        </h3>
      </div>
      <Formik
        initialValues={{
          displayName: data?.username !== user?.email ? data?.username : '',
          email: data?.email?.includes('@') ? data.email : '',
          locale: data?.locale,
          preferredLanguageAll: data?.preferredLanguages?.all ?? '',
          preferredLanguageMovie: preferredLanguageFieldValue('movie'),
          preferredLanguageTv: preferredLanguageFieldValue('tv'),
          preferredLanguageMusic: preferredLanguageFieldValue('music'),
          preferredLanguageBook: preferredLanguageFieldValue('book'),
          discoverRegion: data?.discoverRegion,
          streamingRegion: data?.streamingRegion,
          originalLanguage: data?.originalLanguage,
          movieQuotaLimit: data?.movieQuotaLimit,
          movieQuotaDays: data?.movieQuotaDays,
          tvQuotaLimit: data?.tvQuotaLimit,
          tvQuotaDays: data?.tvQuotaDays,
          musicQuotaLimit: data?.musicQuotaLimit,
          musicQuotaDays: data?.musicQuotaDays,
          bookQuotaLimit: data?.bookQuotaLimit,
          bookQuotaDays: data?.bookQuotaDays,
          comicQuotaLimit: data?.comicQuotaLimit,
          comicQuotaDays: data?.comicQuotaDays,
          magazineQuotaLimit: data?.magazineQuotaLimit,
          magazineQuotaDays: data?.magazineQuotaDays,
          watchlistSyncMovies: data?.watchlistSyncMovies,
          watchlistSyncTv: data?.watchlistSyncTv,
          watchlistSyncMusic: data?.watchlistSyncMusic,
          watchlistSyncBooks: data?.watchlistSyncBooks,
          watchlistSyncComics: data?.watchlistSyncComics,
          watchlistSyncMagazines: data?.watchlistSyncMagazines,
          cardTextVisibilityMovie: data?.cardTextVisibility?.movie ?? 'hover',
          cardTextVisibilityTv: data?.cardTextVisibility?.tv ?? 'hover',
          cardTextVisibilityAlbum: data?.cardTextVisibility?.album ?? 'always',
          cardTextVisibilityBook: data?.cardTextVisibility?.book ?? 'always',
        }}
        validationSchema={UserGeneralSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post(`/api/v1/user/${user?.id}/settings/main`, {
              username: values.displayName,
              email:
                values.email || user?.jellyfinUsername || user?.plexUsername,
              locale: values.locale,
              preferredLanguages: {
                all: values.preferredLanguageAll || null,
                movie:
                  values.preferredLanguageMovie === 'inherit'
                    ? undefined
                    : values.preferredLanguageMovie === 'any'
                      ? null
                      : values.preferredLanguageMovie,
                tv:
                  values.preferredLanguageTv === 'inherit'
                    ? undefined
                    : values.preferredLanguageTv === 'any'
                      ? null
                      : values.preferredLanguageTv,
                music:
                  values.preferredLanguageMusic === 'inherit'
                    ? undefined
                    : values.preferredLanguageMusic === 'any'
                      ? null
                      : values.preferredLanguageMusic,
                book:
                  values.preferredLanguageBook === 'inherit'
                    ? undefined
                    : values.preferredLanguageBook === 'any'
                      ? null
                      : values.preferredLanguageBook,
              },
              discoverRegion: values.discoverRegion,
              streamingRegion: values.streamingRegion,
              originalLanguage: values.originalLanguage,
              movieQuotaLimit: movieQuotaEnabled
                ? values.movieQuotaLimit
                : null,
              movieQuotaDays: movieQuotaEnabled ? values.movieQuotaDays : null,
              tvQuotaLimit: tvQuotaEnabled ? values.tvQuotaLimit : null,
              tvQuotaDays: tvQuotaEnabled ? values.tvQuotaDays : null,
              musicQuotaLimit: musicQuotaEnabled
                ? values.musicQuotaLimit
                : null,
              musicQuotaDays: musicQuotaEnabled ? values.musicQuotaDays : null,
              bookQuotaLimit: bookQuotaEnabled ? values.bookQuotaLimit : null,
              bookQuotaDays: bookQuotaEnabled ? values.bookQuotaDays : null,
              comicQuotaLimit: comicQuotaEnabled
                ? values.comicQuotaLimit
                : null,
              comicQuotaDays: comicQuotaEnabled ? values.comicQuotaDays : null,
              magazineQuotaLimit: magazineQuotaEnabled
                ? values.magazineQuotaLimit
                : null,
              magazineQuotaDays: magazineQuotaEnabled
                ? values.magazineQuotaDays
                : null,
              watchlistSyncMovies: values.watchlistSyncMovies,
              watchlistSyncTv: values.watchlistSyncTv,
              watchlistSyncMusic: values.watchlistSyncMusic,
              watchlistSyncBooks: values.watchlistSyncBooks,
              watchlistSyncComics: values.watchlistSyncComics,
              watchlistSyncMagazines: values.watchlistSyncMagazines,
              cardTextVisibility: {
                movie: values.cardTextVisibilityMovie,
                tv: values.cardTextVisibilityTv,
                album: values.cardTextVisibilityAlbum,
                book: values.cardTextVisibilityBook,
              },
            });

            if (currentUser?.id === user?.id && setLocale) {
              setLocale(
                (values.locale
                  ? values.locale
                  : currentSettings.locale) as AvailableLocale
              );
            }

            addToast(intl.formatMessage(messages.toastSettingsSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch (e) {
            if (e?.response?.data?.message === ApiErrorCode.InvalidEmail) {
              if (values.email) {
                addToast(
                  intl.formatMessage(messages.toastSettingsFailureEmail),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              } else {
                addToast(
                  intl.formatMessage(messages.toastSettingsFailureEmailEmpty),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } else {
              addToast(intl.formatMessage(messages.toastSettingsFailure), {
                autoDismiss: true,
                appearance: 'error',
              });
            }
          } finally {
            revalidate();
            revalidateUser();
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
            <Form className="section">
              <div className="form-row">
                <label className="text-label">
                  {intl.formatMessage(messages.accounttype)}
                </label>
                <div className="mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    {user?.userType === UserType.PLEX ? (
                      <Badge badgeType="warning">
                        {intl.formatMessage(messages.plexuser)}
                      </Badge>
                    ) : user?.userType === UserType.LOCAL ? (
                      <Badge badgeType="default">
                        {intl.formatMessage(messages.localuser)}
                      </Badge>
                    ) : user?.userType === UserType.EMBY ? (
                      <Badge badgeType="success">
                        {intl.formatMessage(messages.mediaServerUser, {
                          mediaServerName: 'Emby',
                        })}
                      </Badge>
                    ) : user?.userType === UserType.JELLYFIN ? (
                      <Badge badgeType="default">
                        {intl.formatMessage(messages.mediaServerUser, {
                          mediaServerName: 'Jellyfin',
                        })}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label className="text-label">
                  {intl.formatMessage(messages.role)}
                </label>
                <div className="mb-1 text-sm leading-5 font-medium text-gray-400 sm:mt-2">
                  <div className="flex max-w-lg items-center">
                    {user?.id === 1
                      ? intl.formatMessage(messages.owner)
                      : hasPermission(Permission.ADMIN)
                        ? intl.formatMessage(messages.admin)
                        : intl.formatMessage(messages.user)}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="displayName" className="text-label">
                  {intl.formatMessage(messages.displayName)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="displayName"
                      name="displayName"
                      type="text"
                      placeholder={
                        user?.jellyfinUsername ||
                        user?.plexUsername ||
                        user?.email
                      }
                    />
                  </div>
                  {errors.displayName &&
                    touched.displayName &&
                    typeof errors.displayName === 'string' && (
                      <div className="error">{errors.displayName}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="email" className="text-label">
                  {intl.formatMessage(messages.email)}
                  {user?.warnings.find((w) => w === 'userEmailRequired') && (
                    <span className="label-required">*</span>
                  )}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="email"
                      name="email"
                      type="text"
                      placeholder="example@domain.com"
                      disabled={user?.plexUsername}
                      className={
                        user?.warnings.find((w) => w === 'userEmailRequired')
                          ? 'border-2 border-red-400 focus:border-blue-600'
                          : ''
                      }
                    />
                  </div>
                  {errors.email && touched.email && (
                    <div className="error">{errors.email}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="locale" className="text-label">
                  {intl.formatMessage(messages.applanguage)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field as="select" id="locale" name="locale">
                      <option value="" lang={locale}>
                        {intl.formatMessage(messages.languageDefault, {
                          language:
                            availableLanguages[currentSettings.locale].display,
                        })}
                      </option>
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
              <div className="form-row">
                <div className="text-label">
                  <label htmlFor="preferredLanguageAll">
                    {intl.formatMessage(messages.preferredLanguageAll)}
                  </label>
                  <span className="label-tip">
                    {intl.formatMessage(messages.preferredLanguageTip)}
                  </span>
                </div>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      as="select"
                      id="preferredLanguageAll"
                      name="preferredLanguageAll"
                    >
                      <option value="">
                        {intl.formatMessage(messages.preferredLanguageAny)}
                      </option>
                      {preferredLanguageOptions.map((language) => (
                        <option
                          key={language.code}
                          value={language.code}
                          lang={language.code}
                        >
                          {language.name}
                        </option>
                      ))}
                    </Field>
                  </div>
                </div>
              </div>
              {preferredLanguageOverrides.map((override) => (
                <div className="form-row" key={override.field}>
                  <label htmlFor={override.field} className="text-label">
                    {intl.formatMessage(override.label)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id={override.field}
                        name={override.field}
                      >
                        <option value="inherit">
                          {intl.formatMessage(
                            messages.preferredLanguageInherit
                          )}
                        </option>
                        <option value="any">
                          {intl.formatMessage(messages.preferredLanguageAny)}
                        </option>
                        {preferredLanguageOptions.map((language) => (
                          <option
                            key={language.code}
                            value={language.code}
                            lang={language.code}
                          >
                            {language.name}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
              <div className="form-row">
                <div className="text-label">
                  <span>{intl.formatMessage(messages.discoverRegion)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.discoverRegionTip)}
                  </span>
                </div>
                <div className="form-input-area">
                  <div className="form-input-field relative z-[22]">
                    <RegionSelector
                      name="discoverRegion"
                      value={values.discoverRegion ?? ''}
                      isUserSetting
                      onChange={setFieldValue}
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="text-label">
                  <span>{intl.formatMessage(messages.originallanguage)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.originallanguageTip)}
                  </span>
                </div>
                <div className="form-input-area">
                  <div className="form-input-field relative z-[21]">
                    <LanguageSelector
                      setFieldValue={setFieldValue}
                      serverValue={currentSettings.originalLanguage}
                      value={values.originalLanguage}
                      isUserSettings
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="text-label">
                  <span>{intl.formatMessage(messages.streamingRegion)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.streamingRegionTip)}
                  </span>
                </div>
                <div className="form-input-area">
                  <div className="form-input-field relative z-20">
                    <RegionSelector
                      name="streamingRegion"
                      value={values.streamingRegion || ''}
                      isUserSetting
                      onChange={setFieldValue}
                      regionType="streaming"
                      disableAll
                    />
                  </div>
                </div>
              </div>
              {currentHasPermission(Permission.MANAGE_USERS) &&
                !hasPermission(Permission.MANAGE_USERS) && (
                  <>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.movierequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={movieQuotaEnabled}
                              onChange={() => setMovieQuotaEnabled((s) => !s)}
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!movieQuotaEnabled}
                            dayFieldName="movieQuotaDays"
                            limitFieldName="movieQuotaLimit"
                            mediaType="movie"
                            onChange={setFieldValue}
                            defaultDays={values.movieQuotaDays}
                            defaultLimit={values.movieQuotaLimit}
                            dayOverride={
                              !movieQuotaEnabled
                                ? data?.globalMovieQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !movieQuotaEnabled
                                ? data?.globalMovieQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.seriesrequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={tvQuotaEnabled}
                              onChange={() => setTvQuotaEnabled((s) => !s)}
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!tvQuotaEnabled}
                            dayFieldName="tvQuotaDays"
                            limitFieldName="tvQuotaLimit"
                            mediaType="tv"
                            onChange={setFieldValue}
                            defaultDays={values.tvQuotaDays}
                            defaultLimit={values.tvQuotaLimit}
                            dayOverride={
                              !tvQuotaEnabled
                                ? data?.globalTvQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !tvQuotaEnabled
                                ? data?.globalTvQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.musicrequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={musicQuotaEnabled}
                              onChange={() => setMusicQuotaEnabled((s) => !s)}
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!musicQuotaEnabled}
                            dayFieldName="musicQuotaDays"
                            limitFieldName="musicQuotaLimit"
                            mediaType="music"
                            onChange={setFieldValue}
                            defaultDays={values.musicQuotaDays}
                            defaultLimit={values.musicQuotaLimit}
                            dayOverride={
                              !musicQuotaEnabled
                                ? data?.globalMusicQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !musicQuotaEnabled
                                ? data?.globalMusicQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.bookrequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={bookQuotaEnabled}
                              onChange={() => setBookQuotaEnabled((s) => !s)}
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!bookQuotaEnabled}
                            dayFieldName="bookQuotaDays"
                            limitFieldName="bookQuotaLimit"
                            mediaType="book"
                            onChange={setFieldValue}
                            defaultDays={values.bookQuotaDays}
                            defaultLimit={values.bookQuotaLimit}
                            dayOverride={
                              !bookQuotaEnabled
                                ? data?.globalBookQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !bookQuotaEnabled
                                ? data?.globalBookQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.comicrequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={comicQuotaEnabled}
                              onChange={() => setComicQuotaEnabled((s) => !s)}
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!comicQuotaEnabled}
                            dayFieldName="comicQuotaDays"
                            limitFieldName="comicQuotaLimit"
                            mediaType="comic"
                            onChange={setFieldValue}
                            defaultDays={values.comicQuotaDays}
                            defaultLimit={values.comicQuotaLimit}
                            dayOverride={
                              !comicQuotaEnabled
                                ? data?.globalComicQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !comicQuotaEnabled
                                ? data?.globalComicQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">
                        <span>
                          {intl.formatMessage(messages.magazinerequestlimit)}
                        </span>
                      </div>
                      <div className="form-input-area">
                        <div className="flex flex-col">
                          <div className="mb-4 flex items-center">
                            <input
                              type="checkbox"
                              checked={magazineQuotaEnabled}
                              onChange={() =>
                                setMagazineQuotaEnabled((enabled) => !enabled)
                              }
                            />
                            <span className="ml-2 text-gray-300">
                              {intl.formatMessage(messages.enableOverride)}
                            </span>
                          </div>
                          <QuotaSelector
                            isDisabled={!magazineQuotaEnabled}
                            dayFieldName="magazineQuotaDays"
                            limitFieldName="magazineQuotaLimit"
                            mediaType="magazine"
                            onChange={setFieldValue}
                            defaultDays={values.magazineQuotaDays}
                            defaultLimit={values.magazineQuotaLimit}
                            dayOverride={
                              !magazineQuotaEnabled
                                ? data?.globalMagazineQuotaDays
                                : undefined
                            }
                            limitOverride={
                              !magazineQuotaEnabled
                                ? data?.globalMagazineQuotaLimit
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MOVIE],
                { type: 'or' }
              ) &&
                user?.userType === UserType.PLEX && (
                  <div className="form-row">
                    <label
                      htmlFor="watchlistSyncMovies"
                      className="checkbox-label"
                    >
                      <span>
                        {intl.formatMessage(messages.plexwatchlistsyncmovies)}
                      </span>
                      <span className="label-tip">
                        {intl.formatMessage(
                          messages.plexwatchlistsyncmoviestip,
                          {
                            PlexWatchlistSupportLink: (
                              msg: React.ReactNode
                            ) => (
                              <a
                                href="https://support.plex.tv/articles/universal-watchlist/"
                                className="text-white transition duration-300 hover:underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {msg}
                              </a>
                            ),
                          }
                        )}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <Field
                        type="checkbox"
                        id="watchlistSyncMovies"
                        name="watchlistSyncMovies"
                        onChange={() => {
                          setFieldValue(
                            'watchlistSyncMovies',
                            !values.watchlistSyncMovies
                          );
                        }}
                      />
                    </div>
                  </div>
                )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_TV],
                { type: 'or' }
              ) &&
                user?.userType === UserType.PLEX && (
                  <div className="form-row">
                    <label htmlFor="watchlistSyncTv" className="checkbox-label">
                      <span>
                        {intl.formatMessage(messages.plexwatchlistsyncseries)}
                      </span>
                      <span className="label-tip">
                        {intl.formatMessage(
                          messages.plexwatchlistsyncseriestip,
                          {
                            PlexWatchlistSupportLink: (
                              msg: React.ReactNode
                            ) => (
                              <a
                                href="https://support.plex.tv/articles/universal-watchlist/"
                                className="text-white transition duration-300 hover:underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {msg}
                              </a>
                            ),
                          }
                        )}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <Field
                        type="checkbox"
                        id="watchlistSyncTv"
                        name="watchlistSyncTv"
                        onChange={() => {
                          setFieldValue(
                            'watchlistSyncTv',
                            !values.watchlistSyncTv
                          );
                        }}
                      />
                    </div>
                  </div>
                )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MUSIC],
                { type: 'or' }
              ) && (
                <div className="form-row">
                  <label
                    htmlFor="watchlistSyncMusic"
                    className="checkbox-label"
                  >
                    <span>
                      {intl.formatMessage(messages.musicwatchlistsync)}
                    </span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.musicwatchlistsynctip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="watchlistSyncMusic"
                      name="watchlistSyncMusic"
                      onChange={() => {
                        setFieldValue(
                          'watchlistSyncMusic',
                          !values.watchlistSyncMusic
                        );
                      }}
                    />
                  </div>
                </div>
              )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_BOOK],
                { type: 'or' }
              ) && (
                <div className="form-row">
                  <label
                    htmlFor="watchlistSyncBooks"
                    className="checkbox-label"
                  >
                    <span>
                      {intl.formatMessage(messages.bookwatchlistsync)}
                    </span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.bookwatchlistsynctip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="watchlistSyncBooks"
                      name="watchlistSyncBooks"
                      onChange={() => {
                        setFieldValue(
                          'watchlistSyncBooks',
                          !values.watchlistSyncBooks
                        );
                      }}
                    />
                  </div>
                </div>
              )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_COMIC],
                { type: 'or' }
              ) && (
                <div className="form-row">
                  <label
                    htmlFor="watchlistSyncComics"
                    className="checkbox-label"
                  >
                    <span>
                      {intl.formatMessage(messages.comicwatchlistsync)}
                    </span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.comicwatchlistsynctip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="watchlistSyncComics"
                      name="watchlistSyncComics"
                      onChange={() => {
                        setFieldValue(
                          'watchlistSyncComics',
                          !values.watchlistSyncComics
                        );
                      }}
                    />
                  </div>
                </div>
              )}
              {hasPermission(
                [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MAGAZINE],
                { type: 'or' }
              ) && (
                <div className="form-row">
                  <label
                    htmlFor="watchlistSyncMagazines"
                    className="checkbox-label"
                  >
                    <span>
                      {intl.formatMessage(messages.magazinewatchlistsync)}
                    </span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.magazinewatchlistsynctip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="watchlistSyncMagazines"
                      name="watchlistSyncMagazines"
                      onChange={() => {
                        setFieldValue(
                          'watchlistSyncMagazines',
                          !values.watchlistSyncMagazines
                        );
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="form-row">
                <label htmlFor="cardTextVisibilityMovie" className="text-label">
                  <span>{intl.formatMessage(messages.cardTextVisibility)}</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.cardTextVisibilityTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['cardTextVisibilityMovie', 'cardTextVisibilityMovie'],
                        ['cardTextVisibilityTv', 'cardTextVisibilityTv'],
                        ['cardTextVisibilityAlbum', 'cardTextVisibilityAlbum'],
                        ['cardTextVisibilityBook', 'cardTextVisibilityBook'],
                      ] as const
                    ).map(([fieldName, messageKey]) => (
                      <div key={fieldName}>
                        <label
                          htmlFor={fieldName}
                          className="mb-1 block text-sm font-medium text-gray-300"
                        >
                          {intl.formatMessage(messages[messageKey])}
                        </label>
                        <Field as="select" id={fieldName} name={fieldName}>
                          <option value="hover">
                            {intl.formatMessage(
                              messages.cardTextVisibilityHover
                            )}
                          </option>
                          <option value="always">
                            {intl.formatMessage(
                              messages.cardTextVisibilityAlways
                            )}
                          </option>
                        </Field>
                      </div>
                    ))}
                  </div>
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
    </>
  );
};

export default UserGeneralSettings;
