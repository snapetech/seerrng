import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import SettingsField from '@app/components/Settings/SettingsField';
import SettingsFormRow from '@app/components/Settings/SettingsFormRow';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import type { MediaCategoryKey } from '@server/constants/mediaCategories';
import { DEFAULT_ENABLED_MEDIA_CATEGORIES } from '@server/constants/mediaCategories';
import type { MainSettings } from '@server/lib/settings';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings.SettingsCategories', {
  title: 'Media Categories',
  description:
    'Choose which categories everyone can browse and request. Disabled categories disappear from navigation and discovery, and new requests are blocked. Existing requests and download history stay available in Request Status.',
  groupTitle: 'Available Categories',
  groupDescription:
    'These switches control category availability across SeerrNG.',
  movie: 'Movies',
  tv: 'Series',
  music: 'Music',
  ebook: 'Books',
  audiobook: 'Audiobooks',
  comic: 'Comics',
  magazine: 'Magazines',
  retro: 'Emulation (Retro)',
  modern: 'Emulation (Modern)',
  game: 'PC Games',
  movieDescription: 'Allow movie discovery and requests.',
  tvDescription: 'Allow series discovery and requests.',
  musicDescription: 'Allow music discovery and requests.',
  ebookDescription: 'Allow book discovery and requests.',
  audiobookDescription: 'Allow audiobook discovery and requests.',
  comicDescription: 'Allow comic discovery and requests.',
  magazineDescription: 'Allow magazine discovery and requests.',
  retroDescription: 'Allow retro ROM discovery and requests.',
  modernDescription: 'Allow modern emulation ROM discovery and requests.',
  gameDescription: 'Allow PC game discovery and requests.',
  saveSuccess: 'Category settings saved.',
  saveFailure: 'Category settings could not be saved.',
});

const categories: {
  key: MediaCategoryKey;
  label: keyof typeof messages;
  description: keyof typeof messages;
}[] = [
  { key: 'movie', label: 'movie', description: 'movieDescription' },
  { key: 'tv', label: 'tv', description: 'tvDescription' },
  { key: 'music', label: 'music', description: 'musicDescription' },
  { key: 'ebook', label: 'ebook', description: 'ebookDescription' },
  {
    key: 'audiobook',
    label: 'audiobook',
    description: 'audiobookDescription',
  },
  { key: 'comic', label: 'comic', description: 'comicDescription' },
  { key: 'magazine', label: 'magazine', description: 'magazineDescription' },
  { key: 'retro', label: 'retro', description: 'retroDescription' },
  { key: 'modern', label: 'modern', description: 'modernDescription' },
  { key: 'game', label: 'game', description: 'gameDescription' },
];

const SettingsCategories = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<MainSettings>('/api/v1/settings/main');

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.title),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.title)}</h3>
        <p className="description">
          {intl.formatMessage(messages.description)}
        </p>
      </div>
      <Formik
        initialValues={{
          enabledMediaCategories: {
            ...DEFAULT_ENABLED_MEDIA_CATEGORIES,
            ...data?.enabledMediaCategories,
          },
        }}
        enableReinitialize
        onSubmit={async (values, { setSubmitting }) => {
          try {
            await axios.post('/api/v1/settings/main', {
              enabledMediaCategories: values.enabledMediaCategories,
            });
            await Promise.all([
              revalidate(),
              mutate('/api/v1/settings/public'),
            ]);
            addToast(intl.formatMessage(messages.saveSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            addToast(intl.formatMessage(messages.saveFailure), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {({ isSubmitting }) => (
          <Form
            className="settings-page-form"
            data-testid="settings-categories-form"
          >
            <section className="settings-group-card">
              <h3 className="settings-group-heading">
                {intl.formatMessage(messages.groupTitle)}
              </h3>
              <p className="settings-group-description">
                {intl.formatMessage(messages.groupDescription)}
              </p>
              <div className="settings-group-content">
                {categories.map(({ key, label, description }) => (
                  <SettingsFormRow
                    key={key}
                    htmlFor={`enabledMediaCategories.${key}`}
                    label={intl.formatMessage(messages[label])}
                    description={intl.formatMessage(messages[description])}
                    labelClassName="checkbox-label"
                  >
                    <SettingsField
                      type="checkbox"
                      id={`enabledMediaCategories.${key}`}
                      name={`enabledMediaCategories.${key}`}
                      data-testid={`category-toggle-${key}`}
                    />
                  </SettingsFormRow>
                ))}
              </div>
            </section>
            <div className="actions">
              <div className="flex justify-end">
                <span className="ml-3 inline-flex rounded-md shadow-sm">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="sr-only"
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    {intl.formatMessage(globalMessages.save)}
                  </button>
                </span>
              </div>
            </div>
          </Form>
        )}
      </Formik>
    </>
  );
};

export default SettingsCategories;
