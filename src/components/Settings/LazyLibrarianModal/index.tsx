import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import SettingsField from '@app/components/Settings/SettingsField';
import { useSetupConnectionSuggestion } from '@app/context/SetupConnectionsContext';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { LazyLibrarianSettings } from '@server/lib/settings';
import axios from 'axios';
import { Formik } from 'formik';
import { useCallback, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.LazyLibrarianModal', {
  create: 'Add New LazyLibrarian Server',
  edit: 'Edit LazyLibrarian Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'URL base must have a leading slash',
  validationBaseUrlTrailingSlash: 'URL base must not end in a trailing slash',
  testSuccess: 'LazyLibrarian connection established successfully!',
  testFailure: 'Failed to connect to LazyLibrarian.',
  saveFailure: 'Failed to save the LazyLibrarian server.',
  add: 'Add Server',
  defaultServer: 'Default Server',
  serverName: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  syncEnabled: 'Enable Library Scan',
  externalUrl: 'External URL',
  enableSearch: 'Search automatically after approval',
  apiKeyHelp:
    'Use a write-enabled API key from LazyLibrarian under Config > Interface. A read-only key cannot add magazines or start searches.',
  baseUrlHelp:
    'Enter the URL Base from LazyLibrarian if you configured one. Leave blank otherwise.',
  externalUrlHelp:
    'Optional address for opening LazyLibrarian from outside your network.',
  syncEnabledHelp:
    'Scan LazyLibrarian magazines and issue files to show current availability.',
  enableSearchHelp:
    'Start a search for this magazine in LazyLibrarian after its request is approved. Prowlarr can sync indexers to LazyLibrarian; verify synced indexers appear and work in your LazyLibrarian build. SeerrNG also offers a separate manual Prowlarr search for users with Manage Requests.',
});

interface LazyLibrarianModalProps {
  lazylibrarian: LazyLibrarianSettings | null;
  onClose: () => void;
  onSave: () => void;
}

interface TestResponse {
  version?: string;
}

const LazyLibrarianModal = ({
  onClose,
  lazylibrarian,
  onSave,
}: LazyLibrarianModalProps) => {
  const intl = useIntl();
  const setupConnection = useSetupConnectionSuggestion('lazylibrarian');
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(Boolean(lazylibrarian));
  const [isTesting, setIsTesting] = useState(false);

  const schema = Yup.object().shape({
    name: Yup.string().required(
      intl.formatMessage(messages.validationNameRequired)
    ),
    hostname: Yup.string().required(
      intl.formatMessage(messages.validationHostnameRequired)
    ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationApiKeyRequired)
    ),
    externalUrl: Yup.string()
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
    baseUrl: Yup.string()
      .test(
        'leading-slash',
        intl.formatMessage(messages.validationBaseUrlLeadingSlash),
        (value) => !value || value.startsWith('/')
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationBaseUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const testConnection = useCallback(
    async (values: {
      id?: number;
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<TestResponse>(
          '/api/v1/settings/lazylibrarian/test',
          { ...values, port: Number(values.port) }
        );
        setIsValidated(true);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.testSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
        return response.data;
      } catch {
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.testFailure), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
        return null;
      } finally {
        setIsTesting(false);
        initialLoad.current = true;
      }
    },
    [addToast, intl]
  );

  return (
    <Transition as="div" appear show>
      <Formik
        initialValues={{
          name: lazylibrarian?.name ?? '',
          hostname: lazylibrarian?.hostname ?? setupConnection?.hostname ?? '',
          port: lazylibrarian?.port ?? setupConnection?.port ?? 5299,
          ssl: lazylibrarian?.useSsl ?? false,
          apiKey: lazylibrarian?.apiKey ?? '',
          baseUrl: lazylibrarian?.baseUrl ?? '',
          isDefault: lazylibrarian?.isDefault ?? false,
          externalUrl: lazylibrarian?.externalUrl ?? '',
          syncEnabled: lazylibrarian?.syncEnabled ?? false,
          enableSearch: !lazylibrarian?.preventSearch,
        }}
        validationSchema={schema}
        onSubmit={async (values) => {
          try {
            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl || undefined,
              tags: [],
              isDefault: values.isDefault,
              externalUrl: values.externalUrl || undefined,
              syncEnabled: values.syncEnabled,
              preventSearch: !values.enableSearch,
            };

            if (!lazylibrarian) {
              await axios.post('/api/v1/settings/lazylibrarian', submission);
            } else {
              await axios.put(
                `/api/v1/settings/lazylibrarian/${lazylibrarian.id}`,
                submission
              );
            }
            onSave();
          } catch {
            addToast(intl.formatMessage(messages.saveFailure), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
        }) => (
          <Modal
            onCancel={onClose}
            okButtonType="primary"
            okText={
              isSubmitting
                ? intl.formatMessage(globalMessages.saving)
                : lazylibrarian
                  ? intl.formatMessage(globalMessages.save)
                  : intl.formatMessage(messages.add)
            }
            secondaryButtonType="warning"
            secondaryText={
              isTesting
                ? intl.formatMessage(globalMessages.testing)
                : intl.formatMessage(globalMessages.test)
            }
            onSecondary={async () => {
              if (values.apiKey && values.hostname && values.port) {
                await testConnection({
                  id: lazylibrarian?.id,
                  apiKey: values.apiKey,
                  baseUrl: values.baseUrl,
                  hostname: values.hostname,
                  port: values.port,
                  useSsl: values.ssl,
                });
              }
            }}
            secondaryDisabled={
              !values.apiKey ||
              !values.hostname ||
              !values.port ||
              isTesting ||
              isSubmitting
            }
            okDisabled={!isValidated || isSubmitting || isTesting || !isValid}
            onOk={() => handleSubmit()}
            title={intl.formatMessage(
              lazylibrarian ? messages.edit : messages.create
            )}
          >
            <div className="form-row">
              <label htmlFor="isDefault" className="checkbox-label">
                {intl.formatMessage(messages.defaultServer)}
              </label>
              <div className="form-input-area">
                <SettingsField
                  type="checkbox"
                  id="isDefault"
                  name="isDefault"
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="name" className="text-label">
                {intl.formatMessage(messages.serverName)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField id="name" name="name" type="text" />
                </div>
                {errors.name &&
                  touched.name &&
                  typeof errors.name === 'string' && (
                    <div className="error">{errors.name}</div>
                  )}
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="hostname" className="text-label">
                {intl.formatMessage(messages.hostname)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <span className="protocol">
                    {values.ssl ? 'https://' : 'http://'}
                  </span>
                  <SettingsField
                    id="hostname"
                    name="hostname"
                    type="text"
                    inputMode="url"
                    className="rounded-r-only"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('hostname', event.target.value);
                    }}
                  />
                </div>
                {errors.hostname &&
                  touched.hostname &&
                  typeof errors.hostname === 'string' && (
                    <div className="error">{errors.hostname}</div>
                  )}
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="port" className="text-label">
                {intl.formatMessage(messages.port)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <SettingsField
                  id="port"
                  name="port"
                  type="text"
                  inputMode="numeric"
                  className="short"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setIsValidated(false);
                    setFieldValue('port', event.target.value);
                  }}
                />
                {errors.port &&
                  touched.port &&
                  typeof errors.port === 'string' && (
                    <div className="error">{errors.port}</div>
                  )}
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="ssl" className="checkbox-label">
                {intl.formatMessage(messages.ssl)}
              </label>
              <div className="form-input-area">
                <SettingsField
                  type="checkbox"
                  id="ssl"
                  name="ssl"
                  onChange={() => {
                    setIsValidated(false);
                    setFieldValue('ssl', !values.ssl);
                  }}
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="apiKey" className="text-label">
                {intl.formatMessage(messages.apiKey)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SensitiveInput
                    as="field"
                    id="apiKey"
                    name="apiKey"
                    autoComplete="one-time-code"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('apiKey', event.target.value);
                    }}
                  />
                </div>
                {errors.apiKey &&
                  touched.apiKey &&
                  typeof errors.apiKey === 'string' && (
                    <div className="error">{errors.apiKey}</div>
                  )}
              </div>
              <span className="settings-form-row-description">
                {intl.formatMessage(messages.apiKeyHelp)}
              </span>
            </div>
            <div className="form-row">
              <label htmlFor="baseUrl" className="text-label">
                {intl.formatMessage(messages.baseUrl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    id="baseUrl"
                    name="baseUrl"
                    type="text"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('baseUrl', event.target.value);
                    }}
                  />
                </div>
                {errors.baseUrl &&
                  touched.baseUrl &&
                  typeof errors.baseUrl === 'string' && (
                    <div className="error">{errors.baseUrl}</div>
                  )}
              </div>
              <span className="settings-form-row-description">
                {intl.formatMessage(messages.baseUrlHelp)}
              </span>
            </div>
            <div className="form-row">
              <label htmlFor="externalUrl" className="text-label">
                {intl.formatMessage(messages.externalUrl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <SettingsField
                    id="externalUrl"
                    name="externalUrl"
                    type="text"
                  />
                </div>
                {errors.externalUrl &&
                  touched.externalUrl &&
                  typeof errors.externalUrl === 'string' && (
                    <div className="error">{errors.externalUrl}</div>
                  )}
              </div>
              <span className="settings-form-row-description">
                {intl.formatMessage(messages.externalUrlHelp)}
              </span>
            </div>
            <div className="form-row">
              <label htmlFor="syncEnabled" className="checkbox-label">
                {intl.formatMessage(messages.syncEnabled)}
              </label>
              <div className="form-input-area">
                <SettingsField
                  type="checkbox"
                  id="syncEnabled"
                  name="syncEnabled"
                />
              </div>
              <span className="settings-form-row-description">
                {intl.formatMessage(messages.syncEnabledHelp)}
              </span>
            </div>
            <div className="form-row">
              <label htmlFor="enableSearch" className="checkbox-label">
                {intl.formatMessage(messages.enableSearch)}
              </label>
              <div className="form-input-area">
                <SettingsField
                  type="checkbox"
                  id="enableSearch"
                  name="enableSearch"
                />
              </div>
              <span className="settings-form-row-description">
                {intl.formatMessage(messages.enableSearchHelp)}
              </span>
            </div>
          </Modal>
        )}
      </Formik>
    </Transition>
  );
};

export default LazyLibrarianModal;
