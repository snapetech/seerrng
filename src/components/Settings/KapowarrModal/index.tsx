import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import Field, {
  default as SettingsField,
} from '@app/components/Settings/SettingsField';
import { useSetupConnectionSuggestion } from '@app/context/SetupConnectionsContext';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { KapowarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Formik } from 'formik';
import { useCallback, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.KapowarrModal', {
  createkapowarr: 'Add New Kapowarr Server',
  editkapowarr: 'Edit Kapowarr Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationRootFolderRequired: 'You must provide a root folder path',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'URL base must have a leading slash',
  validationBaseUrlTrailingSlash: 'URL base must not end in a trailing slash',
  toastKapowarrTestSuccess: 'Kapowarr connection established successfully!',
  toastKapowarrTestFailure: 'Failed to connect to Kapowarr.',
  toastKapowarrSaveFailure: 'Failed to save the Kapowarr server.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  rootfolder: 'Root Folder',
  syncEnabled: 'Enable Scan',
  externalUrl: 'External URL',
  enableSearch: 'Enable Automatic Search',
  compatibilityNote:
    'Kapowarr finds comics through GetComics.org and downloads from its mirror hosts. This differs from Mylar3 indexers and BackIssue sources. GetComics has a known reliability issue with direct-from-site downloads; mirror-host downloads are generally reliable.',
  flaresolverrNote:
    'Kapowarr needs a companion FlareSolverr container to get past Cloudflare on GetComics and its mirror hosts. Configure its URL in Kapowarr itself (Settings > General), not here.',
  rootFolderHelp:
    'A folder path on the Kapowarr host/container. Kapowarr will create it if it does not already exist.',
  apiKeyHelp: 'Find it in Kapowarr: Settings > General > Security > API Key.',
  baseUrlHelp:
    'If you set a URL Base in Kapowarr (Settings > General), enter it here. Leave blank otherwise.',
  externalUrlHelp:
    'For clickable links on media pages when the hostname is not reachable from outside your network.',
  syncEnabledHelp:
    'Scan Kapowarr for existing comics so users cannot request content already available.',
  enableSearchHelp:
    'Automatically check Kapowarr’s GetComics and mirror sources after a request is approved. Kapowarr does not use Prowlarr indexers; SeerrNG has a separate manual Prowlarr search for users with Manage Requests.',
});

interface TestResponse {
  version?: string;
  rootFolders?: { id: number; path: string }[];
}

interface KapowarrModalProps {
  kapowarr: KapowarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const KapowarrModal = ({ onClose, kapowarr, onSave }: KapowarrModalProps) => {
  const intl = useIntl();
  const setupConnection = useSetupConnectionSuggestion('kapowarr');
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(kapowarr ? true : false);
  const [isTesting, setIsTesting] = useState(false);

  const KapowarrSettingsSchema = Yup.object().shape({
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
    rootFolder: Yup.string().required(
      intl.formatMessage(messages.validationRootFolderRequired)
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
    async ({
      id,
      hostname,
      port,
      apiKey,
      baseUrl,
      useSsl = false,
    }: {
      id?: number;
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl?: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<TestResponse>(
          '/api/v1/settings/kapowarr/test',
          { id, hostname, apiKey, port: Number(port), baseUrl, useSsl }
        );

        setIsValidated(true);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastKapowarrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
        return response.data;
      } catch {
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastKapowarrTestFailure), {
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
          name: kapowarr?.name ?? '',
          hostname: kapowarr?.hostname ?? setupConnection?.hostname ?? '',
          port: kapowarr?.port ?? setupConnection?.port ?? 5656,
          ssl: kapowarr?.useSsl ?? false,
          apiKey: kapowarr?.apiKey ?? '',
          baseUrl: kapowarr?.baseUrl ?? '',
          rootFolder: kapowarr?.rootFolder ?? '',
          isDefault: kapowarr?.isDefault ?? false,
          externalUrl: kapowarr?.externalUrl ?? '',
          syncEnabled: kapowarr?.syncEnabled ?? false,
          enableSearch: !kapowarr?.preventSearch,
        }}
        validationSchema={KapowarrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              rootFolder: values.rootFolder,
              tags: [],
              isDefault: values.isDefault,
              externalUrl: values.externalUrl,
              syncEnabled: values.syncEnabled,
              preventSearch: !values.enableSearch,
            };

            if (!kapowarr) {
              await axios.post('/api/v1/settings/kapowarr', submission);
            } else {
              await axios.put(
                `/api/v1/settings/kapowarr/${kapowarr.id}`,
                submission
              );
            }

            onSave();
          } catch {
            addToast(intl.formatMessage(messages.toastKapowarrSaveFailure), {
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
                : kapowarr
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
                  id: kapowarr?.id,
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
            title={
              !kapowarr
                ? intl.formatMessage(messages.createkapowarr)
                : intl.formatMessage(messages.editkapowarr)
            }
          >
            <div className="mb-6">
              <p className="description">
                {intl.formatMessage(messages.compatibilityNote)}
              </p>
              <p className="description mt-2">
                {intl.formatMessage(messages.flaresolverrNote)}
              </p>
              <div className="form-row">
                <label htmlFor="isDefault" className="checkbox-label">
                  {intl.formatMessage(messages.defaultserver)}
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
                  {intl.formatMessage(messages.servername)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="name"
                      name="name"
                      type="text"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setFieldValue('name', e.target.value);
                      }}
                    />
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
                    <Field
                      id="hostname"
                      name="hostname"
                      type="text"
                      inputMode="url"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('hostname', e.target.value);
                      }}
                      className="rounded-r-only"
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
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('port', e.target.value);
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
                  <Field
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('apiKey', e.target.value);
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
                    <Field
                      id="baseUrl"
                      name="baseUrl"
                      type="text"
                      inputMode="url"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('baseUrl', e.target.value);
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
                <label htmlFor="rootFolder" className="text-label">
                  {intl.formatMessage(messages.rootfolder)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id="rootFolder" name="rootFolder" type="text" />
                  </div>
                  {errors.rootFolder &&
                    touched.rootFolder &&
                    typeof errors.rootFolder === 'string' && (
                      <div className="error">{errors.rootFolder}</div>
                    )}
                </div>
                <span className="settings-form-row-description">
                  {intl.formatMessage(messages.rootFolderHelp)}
                </span>
              </div>
              <div className="form-row">
                <label htmlFor="externalUrl" className="text-label">
                  {intl.formatMessage(messages.externalUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id="externalUrl" name="externalUrl" type="text" />
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
            </div>
          </Modal>
        )}
      </Formik>
    </Transition>
  );
};

export default KapowarrModal;
