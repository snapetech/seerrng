import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import Field from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import type { SportarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Form, Formik } from 'formik';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

type Profile = { id: number; name: string };

const messages = defineMessages('components.Settings.SportarrModal', {
  addTitle: 'Connect Sportarr',
  editTitle: 'Edit Sportarr connection',
  intro:
    'Search Sportarr leagues and send approved requests to Sportarr. New leagues use Sportarr’s configured root folder and monitoring defaults.',
  host: 'Hostname or IP address',
  port: 'Port',
  ssl: 'Use HTTPS',
  baseUrl: 'URL base',
  baseUrlHelp:
    'Enter the URL base configured in Sportarr, such as /sportarr, or leave blank.',
  apiKey: 'API key',
  apiKeyHelp: 'Find this in Sportarr under Settings > General.',
  name: 'Connection name',
  profile: 'Quality profile',
  chooseProfile: 'Choose a quality profile',
  test: 'Test connection',
  testing: 'Connecting…',
  add: 'Connect',
  default: 'Use as the default Sportarr server',
  validationRequired: 'This field is required.',
  validationPort: 'Enter a port from 1 to 65535.',
  validationProfile: 'Choose a quality profile.',
  testFirst: 'Test the connection to load quality profiles.',
  testSuccess: 'Connected to Sportarr.',
  testFailure: 'Could not connect to Sportarr. Check the address and API key.',
  saveFailure: 'Could not save the Sportarr connection.',
});

interface SportarrModalProps {
  settings: SportarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const SportarrModal = ({ settings, onClose, onSave }: SportarrModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [isTesting, setIsTesting] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const validationSchema = Yup.object().shape({
    name: Yup.string().required(
      intl.formatMessage(messages.validationRequired)
    ),
    hostname: Yup.string().required(
      intl.formatMessage(messages.validationRequired)
    ),
    port: Yup.number()
      .integer()
      .min(1, intl.formatMessage(messages.validationPort))
      .max(65535, intl.formatMessage(messages.validationPort))
      .required(intl.formatMessage(messages.validationPort)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationRequired)
    ),
    activeProfileId: Yup.number()
      .integer()
      .positive(intl.formatMessage(messages.validationProfile))
      .required(intl.formatMessage(messages.validationProfile)),
  });

  const initialValues = {
    name: settings?.name ?? 'Sportarr',
    hostname: settings?.hostname ?? '',
    port: settings?.port ?? 1867,
    useSsl: settings?.useSsl ?? false,
    baseUrl: settings?.baseUrl ?? '',
    apiKey: settings?.apiKey ?? '',
    activeProfileId: settings?.activeProfileId ?? '',
    activeProfileName: settings?.activeProfileName ?? '',
    isDefault: settings?.isDefault ?? true,
    externalUrl: settings?.externalUrl ?? '',
  };

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={async (values, { setSubmitting }) => {
        const profile = profiles.find(
          (candidate) => candidate.id === Number(values.activeProfileId)
        );
        const payload = {
          ...values,
          activeProfileId: Number(values.activeProfileId),
          activeProfileName: profile?.name ?? values.activeProfileName,
        };
        try {
          if (settings) {
            await axios.put(
              `/api/v1/settings/sportarr/${settings.id}`,
              payload
            );
          } else {
            await axios.post('/api/v1/settings/sportarr', payload);
          }
          onSave();
        } catch {
          addToast(intl.formatMessage(messages.saveFailure), {
            appearance: 'error',
            autoDismiss: true,
          });
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {({
        values,
        errors,
        touched,
        isSubmitting,
        submitForm,
        isValid,
        setFieldValue,
      }) => {
        const connectionPayload = {
          hostname: values.hostname,
          port: Number(values.port),
          useSsl: values.useSsl,
          baseUrl: values.baseUrl,
          apiKey: values.apiKey,
        };
        const testConnection = async () => {
          setIsTesting(true);
          try {
            const response = await axios.post<{ profiles: Profile[] }>(
              '/api/v1/settings/sportarr/test',
              connectionPayload
            );
            setProfiles(response.data.profiles);
            addToast(intl.formatMessage(messages.testSuccess), {
              appearance: 'success',
              autoDismiss: true,
            });
          } catch {
            addToast(intl.formatMessage(messages.testFailure), {
              appearance: 'error',
              autoDismiss: true,
            });
          } finally {
            setIsTesting(false);
          }
        };

        const renderError = (field: keyof typeof values) =>
          errors[field] &&
          touched[field] &&
          typeof errors[field] === 'string' ? (
            <div className="error">{errors[field]}</div>
          ) : null;

        return (
          <Modal
            title={intl.formatMessage(
              settings ? messages.editTitle : messages.addTitle
            )}
            onCancel={onClose}
            onOk={() => submitForm()}
            okText={
              isSubmitting
                ? intl.formatMessage(globalMessages.saving)
                : settings
                  ? intl.formatMessage(globalMessages.save)
                  : intl.formatMessage(messages.add)
            }
            okDisabled={isSubmitting || !isValid || isTesting}
            secondaryText={
              isTesting
                ? intl.formatMessage(messages.testing)
                : intl.formatMessage(messages.test)
            }
            onSecondary={() => void testConnection()}
            secondaryDisabled={isSubmitting || isTesting || !isValid}
          >
            <Form>
              <p className="description">
                {intl.formatMessage(messages.intro)}
              </p>
              <div className="form-row">
                <label htmlFor="name" className="text-label">
                  {intl.formatMessage(messages.name)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id="name" name="name" type="text" />
                  </div>
                  {renderError('name')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="hostname" className="text-label">
                  {intl.formatMessage(messages.host)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id="hostname" name="hostname" type="text" />
                  </div>
                  {renderError('hostname')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="port" className="text-label">
                  {intl.formatMessage(messages.port)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="port"
                      name="port"
                      type="number"
                      min="1"
                      max="65535"
                    />
                  </div>
                  {renderError('port')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="useSsl" className="checkbox-label">
                  {intl.formatMessage(messages.ssl)}
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="useSsl" name="useSsl" />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="baseUrl" className="text-label">
                  {intl.formatMessage(messages.baseUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id="baseUrl" name="baseUrl" type="text" />
                  </div>
                  <p className="settings-form-row-description">
                    {intl.formatMessage(messages.baseUrlHelp)}
                  </p>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="apiKey" className="text-label">
                  {intl.formatMessage(messages.apiKey)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput as="field" id="apiKey" name="apiKey" />
                  </div>
                  <p className="settings-form-row-description">
                    {intl.formatMessage(messages.apiKeyHelp)}
                  </p>
                  {renderError('apiKey')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="activeProfileId" className="text-label">
                  {intl.formatMessage(messages.profile)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      as="select"
                      id="activeProfileId"
                      name="activeProfileId"
                      onChange={(
                        event: React.ChangeEvent<HTMLSelectElement>
                      ) => {
                        const id = Number(event.target.value);
                        const profile = profiles.find((item) => item.id === id);
                        void setFieldValue('activeProfileId', id || '');
                        void setFieldValue(
                          'activeProfileName',
                          profile?.name ?? ''
                        );
                      }}
                    >
                      <option value="">
                        {intl.formatMessage(messages.chooseProfile)}
                      </option>
                      {values.activeProfileId !== '' &&
                        !profiles.some(
                          (item) => item.id === Number(values.activeProfileId)
                        ) && (
                          <option value={values.activeProfileId}>
                            {values.activeProfileName}
                          </option>
                        )}
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </Field>
                  </div>
                  {!profiles.length && (
                    <p className="settings-form-row-description">
                      {intl.formatMessage(messages.testFirst)}
                    </p>
                  )}
                  {renderError('activeProfileId')}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="isDefault" className="checkbox-label">
                  {intl.formatMessage(messages.default)}
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="isDefault" name="isDefault" />
                </div>
              </div>
            </Form>
          </Modal>
        );
      }}
    </Formik>
  );
};

export default SportarrModal;
