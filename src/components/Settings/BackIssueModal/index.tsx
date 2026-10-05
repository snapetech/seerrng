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
import type { BackIssueSettings } from '@server/lib/settings';
import axios from 'axios';
import { Formik } from 'formik';
import { useCallback, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.BackIssueModal', {
  create: 'Add BackIssue Server',
  edit: 'Edit BackIssue Server',
  nameRequired: 'Enter a name for this server.',
  hostnameRequired: 'Enter a valid hostname or IP address.',
  portRequired: 'Enter a valid port number.',
  apiKeyRequired: 'Enter a BackIssue API key.',
  externalUrlInvalid: 'Enter a valid HTTP or HTTPS URL.',
  baseUrlInvalid: 'URL Base must be a relative path.',
  toastTestSuccess: 'Connected to BackIssue.',
  toastTestFailure:
    'Could not connect to BackIssue. Check the address and API key.',
  toastSaveFailure: 'Could not save the BackIssue server.',
  add: 'Add Server',
  name: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use HTTPS',
  apiKey: 'BackIssue API Key',
  apiKeyHelp:
    'Use a key with library.view, library.manage, and downloads.grab permissions so SeerrNG can sync the collection and manage requests.',
  baseUrl: 'URL Base',
  baseUrlHelp: 'Leave blank unless BackIssue is served under a URL path.',
  externalUrl: 'External URL',
  externalUrlHelp: 'Optional address your users can open from their browser.',
  defaultServer: 'Use for requests by default',
  sync: 'Keep SeerrNG availability in sync',
  syncHelp:
    'Scan the collection for existing comics and show active BackIssue downloads in request status.',
  intro:
    'SeerrNG sends BackIssue the complete ComicVine volume. BackIssue uses its own sources and download settings to find and track issues.',
});

interface BackIssueModalProps {
  backissue: BackIssueSettings | null;
  onClose: () => void;
  onSave: () => void;
}

interface TestResponse {
  version?: string;
}

const BackIssueModal = ({
  backissue,
  onClose,
  onSave,
}: BackIssueModalProps) => {
  const intl = useIntl();
  const setupConnection = useSetupConnectionSuggestion('backissue');
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(Boolean(backissue));
  const [isTesting, setIsTesting] = useState(false);

  const schema = Yup.object().shape({
    name: Yup.string().required(intl.formatMessage(messages.nameRequired)),
    hostname: Yup.string().required(
      intl.formatMessage(messages.hostnameRequired)
    ),
    port: Yup.number()
      .integer()
      .min(1)
      .max(65535)
      .required(intl.formatMessage(messages.portRequired)),
    apiKey: Yup.string().required(intl.formatMessage(messages.apiKeyRequired)),
    externalUrl: Yup.string().test(
      'valid-url',
      intl.formatMessage(messages.externalUrlInvalid),
      (value) => !value || isValidURL(value)
    ),
    baseUrl: Yup.string().test(
      'relative-base',
      intl.formatMessage(messages.baseUrlInvalid),
      (value) => !value || (value.startsWith('/') && !value.endsWith('/'))
    ),
  });

  const testConnection = useCallback(
    async (values: {
      id?: number;
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl: string;
      useSsl: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<TestResponse>(
          '/api/v1/settings/backissue/test',
          values
        );
        setIsValidated(true);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
        return response.data;
      } catch (error) {
        setIsValidated(false);
        if (initialLoad.current) {
          const responseMessage = axios.isAxiosError<{ message?: unknown }>(
            error
          )
            ? error.response?.data?.message
            : undefined;
          addToast(
            typeof responseMessage === 'string' && responseMessage.length > 0
              ? responseMessage
              : intl.formatMessage(messages.toastTestFailure),
            {
              appearance: 'error',
              autoDismiss: true,
            }
          );
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
          name: backissue?.name ?? '',
          hostname: backissue?.hostname ?? setupConnection?.hostname ?? '',
          port: backissue?.port ?? setupConnection?.port ?? 8787,
          useSsl: backissue?.useSsl ?? false,
          apiKey: backissue?.apiKey ?? '',
          baseUrl: backissue?.baseUrl ?? '',
          externalUrl: backissue?.externalUrl ?? '',
          isDefault: backissue?.isDefault ?? false,
          syncEnabled: backissue?.syncEnabled ?? false,
        }}
        validationSchema={schema}
        onSubmit={async (values) => {
          const submission = {
            ...values,
            port: Number(values.port),
            tags: backissue?.tags ?? [],
            preventSearch: backissue?.preventSearch ?? false,
          };
          try {
            if (backissue) {
              await axios.put(
                `/api/v1/settings/backissue/${backissue.id}`,
                submission
              );
            } else {
              await axios.post('/api/v1/settings/backissue', submission);
            }
            onSave();
          } catch {
            addToast(intl.formatMessage(messages.toastSaveFailure), {
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
          setFieldValue,
          handleSubmit,
          isSubmitting,
          isValid,
        }) => (
          <Modal
            onCancel={onClose}
            okButtonType="primary"
            okText={
              isSubmitting
                ? intl.formatMessage(globalMessages.saving)
                : backissue
                  ? intl.formatMessage(globalMessages.save)
                  : intl.formatMessage(messages.add)
            }
            secondaryButtonType="warning"
            secondaryText={
              isTesting
                ? intl.formatMessage(globalMessages.testing)
                : intl.formatMessage(globalMessages.test)
            }
            onSecondary={() =>
              testConnection({
                hostname: values.hostname,
                id: backissue?.id,
                port: Number(values.port),
                apiKey: values.apiKey,
                baseUrl: values.baseUrl,
                useSsl: values.useSsl,
              })
            }
            secondaryDisabled={
              !values.hostname || !values.apiKey || !values.port || isTesting
            }
            okDisabled={!isValidated || !isValid || isSubmitting || isTesting}
            onOk={() => handleSubmit()}
            title={intl.formatMessage(
              backissue ? messages.edit : messages.create
            )}
          >
            <div className="mb-6">
              <p className="description">
                {intl.formatMessage(messages.intro)}
              </p>
              <div className="form-row">
                <label className="checkbox-label" htmlFor="isDefault">
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
                <label className="text-label" htmlFor="name">
                  {intl.formatMessage(messages.name)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field id="name" name="name" type="text" />
                  {touched.name && typeof errors.name === 'string' && (
                    <div className="error">{errors.name}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label className="text-label" htmlFor="hostname">
                  {intl.formatMessage(messages.hostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="protocol">
                      {values.useSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      id="hostname"
                      name="hostname"
                      type="text"
                      inputMode="url"
                      className="rounded-r-only"
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>
                      ) => {
                        setIsValidated(false);
                        setFieldValue('hostname', event.target.value);
                      }}
                    />
                  </div>
                  {touched.hostname && typeof errors.hostname === 'string' && (
                    <div className="error">{errors.hostname}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label className="text-label" htmlFor="port">
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
                  {touched.port && typeof errors.port === 'string' && (
                    <div className="error">{errors.port}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label className="checkbox-label" htmlFor="useSsl">
                  {intl.formatMessage(messages.ssl)}
                </label>
                <div className="form-input-area">
                  <Field
                    id="useSsl"
                    name="useSsl"
                    type="checkbox"
                    onChange={() => {
                      setIsValidated(false);
                      setFieldValue('useSsl', !values.useSsl);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label className="text-label" htmlFor="apiKey">
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
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>
                      ) => {
                        setIsValidated(false);
                        setFieldValue('apiKey', event.target.value);
                      }}
                    />
                  </div>
                  {touched.apiKey && typeof errors.apiKey === 'string' && (
                    <div className="error">{errors.apiKey}</div>
                  )}
                </div>
                <span className="settings-form-row-description">
                  {intl.formatMessage(messages.apiKeyHelp)}
                </span>
              </div>
              <div className="form-row">
                <label className="text-label" htmlFor="baseUrl">
                  {intl.formatMessage(messages.baseUrl)}
                </label>
                <div className="form-input-area">
                  <Field
                    id="baseUrl"
                    name="baseUrl"
                    type="text"
                    inputMode="url"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setIsValidated(false);
                      setFieldValue('baseUrl', event.target.value);
                    }}
                  />
                  {touched.baseUrl && typeof errors.baseUrl === 'string' && (
                    <div className="error">{errors.baseUrl}</div>
                  )}
                </div>
                <span className="settings-form-row-description">
                  {intl.formatMessage(messages.baseUrlHelp)}
                </span>
              </div>
              <div className="form-row">
                <label className="text-label" htmlFor="externalUrl">
                  {intl.formatMessage(messages.externalUrl)}
                </label>
                <div className="form-input-area">
                  <Field id="externalUrl" name="externalUrl" type="text" />
                  {touched.externalUrl &&
                    typeof errors.externalUrl === 'string' && (
                      <div className="error">{errors.externalUrl}</div>
                    )}
                </div>
                <span className="settings-form-row-description">
                  {intl.formatMessage(messages.externalUrlHelp)}
                </span>
              </div>
              <div className="form-row">
                <label className="checkbox-label" htmlFor="syncEnabled">
                  {intl.formatMessage(messages.sync)}
                </label>
                <div className="form-input-area">
                  <SettingsField
                    type="checkbox"
                    id="syncEnabled"
                    name="syncEnabled"
                  />
                </div>
                <span className="settings-form-row-description">
                  {intl.formatMessage(messages.syncHelp)}
                </span>
              </div>
            </div>
          </Modal>
        )}
      </Formik>
    </Transition>
  );
};

export default BackIssueModal;
