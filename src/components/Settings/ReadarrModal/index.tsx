import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import Field, {
  default as SettingsField,
} from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { ReadarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.ReadarrModal', {
  createreadarr: 'Add New Bookshelf Server',
  editreadarr: 'Edit Bookshelf Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationRootFolderRequired: 'You must select a root folder',
  validationProfileRequired: 'You must select a quality profile',
  validationMetadataProfileRequired: 'You must select a metadata profile',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'URL base must have a leading slash',
  validationBaseUrlTrailingSlash: 'URL base must not end in a trailing slash',
  toastReadarrTestSuccess: 'Bookshelf connection established successfully!',
  toastReadarrTestFailure: 'Failed to connect to Bookshelf.',
  toastReadarrSaveFailure: 'Failed to save the Bookshelf server.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  qualityprofile: 'Quality Profile',
  rootfolder: 'Root Folder',
  metadataprofile: 'Metadata Profile',
  selectQualityProfile: 'Select quality profile',
  selectRootFolder: 'Select root folder',
  selectMetadataProfile: 'Select metadata profile',
  loadingprofiles: 'Loading quality profiles...',
  loadingrootfolders: 'Loading root folders...',
  loadingmetadataprofiles: 'Loading metadata profiles...',
  testFirstQualityProfiles: 'Test connection to load quality profiles',
  testFirstRootFolders: 'Test connection to load root folders',
  testFirstMetadataProfiles: 'Test connection to load metadata profiles',
  syncEnabled: 'Enable Scan',
  externalUrl: 'External URL',
  enableSearch: 'Enable Automatic Search',
  serviceType: 'Book Format',
  ebook: 'Book',
  audiobook: 'Audiobook',
  compatibilityNote:
    'Bookshelf is the recommended book backend. Readarr-compatible servers, including Chaptarr, can also be used. For Chaptarr, set Book Format to match the configured root folder; Seerr sends that format explicitly on every request.',
  migrationNote:
    'Existing Readarr or softcover libraries should be migrated before switching to Hardcover. The migration tool can preserve native Hardcover matches, recover metadata through softcover, and optionally create local Bookshelf records for books Hardcover cannot import.',
  migrationGuide: 'Bookshelf Hardcover migration guide',
  apiKeyHelp:
    'Find it in Bookshelf or Readarr: Settings > General > Security > API Key.',
  baseUrlHelp:
    'If you set a URL Base in Bookshelf, Chaptarr, or Readarr (Settings > General > Host), enter it here (e.g. /bookshelf). Leave blank otherwise. Chaptarr users do not need a provider-specific URL Base.',
  externalUrlHelp:
    'For clickable links on media pages when the hostname is not reachable from outside your network.',
  syncEnabledHelp:
    'Scan Bookshelf for existing books and request status so users cannot request content already available.',
  enableSearchHelp:
    'Automatically trigger a search in Bookshelf when a request is approved.',
  diagnose: 'Run Diagnostic',
  diagnosing: 'Running diagnostic...',
  diagnosticOk: 'Bookshelf lookup returned usable metadata.',
  diagnosticFailed: 'Bookshelf diagnostic failed.',
});

interface TestResponse {
  profiles: {
    id: number;
    name: string;
  }[];
  metadataProfiles: {
    id: number;
    name: string;
  }[];
  rootFolders: {
    id: number;
    path: string;
  }[];
  tags: {
    id: number;
    label: string;
  }[];
  urlBase?: string;
  provider?: 'hardcover' | 'softcover' | 'unknown';
  legacyWarning?: string;
  metadataSource?: string;
}

interface DiagnosticResponse {
  ok: boolean;
  category:
    | 'ok'
    | 'backend_unreachable'
    | 'lookup_empty'
    | 'lookup_incomplete'
    | 'backend_add_rejected';
  message: string;
  provider?: 'hardcover' | 'softcover' | 'unknown';
  legacyWarning?: string;
  metadataSource?: string;
  lookupCount?: number;
  sample?: {
    title?: string;
    foreignBookId?: string;
    authorName?: string;
    editionCount?: number;
  };
}

interface ReadarrModalProps {
  readarr: ReadarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const ReadarrModal = ({ onClose, readarr, onSave }: ReadarrModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(readarr ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosticResponse, setDiagnosticResponse] =
    useState<DiagnosticResponse | null>(null);
  const [testResponse, setTestResponse] = useState<TestResponse>({
    profiles: [],
    metadataProfiles: [],
    rootFolders: [],
    tags: [],
  });

  const ReadarrSettingsSchema = Yup.object().shape({
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
    activeProfileId: Yup.string().required(
      intl.formatMessage(messages.validationProfileRequired)
    ),
    activeMetadataProfileId: Yup.string().required(
      intl.formatMessage(messages.validationMetadataProfileRequired)
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
      serviceType = 'ebook',
    }: {
      id?: number;
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl?: boolean;
      serviceType?: ReadarrSettings['serviceType'];
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<TestResponse>(
          '/api/v1/settings/readarr/test',
          {
            id,
            hostname,
            apiKey,
            port: Number(port),
            baseUrl,
            useSsl,
            serviceType,
          }
        );

        setIsValidated(true);
        setTestResponse(response.data);
        setDiagnosticResponse(
          response.data.provider
            ? {
                ok: response.data.provider !== 'softcover',
                category: 'ok',
                message:
                  response.data.legacyWarning ??
                  'Bookshelf connection established successfully.',
                provider: response.data.provider,
                legacyWarning: response.data.legacyWarning,
                metadataSource: response.data.metadataSource,
              }
            : null
        );
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastReadarrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
        return response.data;
      } catch {
        setIsValidated(false);
        setDiagnosticResponse(null);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastReadarrTestFailure), {
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

  useEffect(() => {
    if (readarr) {
      testConnection({
        id: readarr.id,
        apiKey: readarr.apiKey,
        hostname: readarr.hostname,
        port: readarr.port,
        baseUrl: readarr.baseUrl,
        useSsl: readarr.useSsl,
        serviceType: readarr.serviceType ?? 'ebook',
      });
    }
  }, [readarr, testConnection]);

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          name: readarr?.name ?? '',
          hostname: readarr?.hostname ?? '',
          port: readarr?.port ?? 8787,
          ssl: readarr?.useSsl ?? false,
          apiKey: readarr?.apiKey ?? '',
          baseUrl: readarr?.baseUrl ?? '',
          activeProfileId: readarr?.activeProfileId ?? '',
          rootFolder: readarr?.activeDirectory ?? '',
          isDefault: readarr?.isDefault ?? false,
          externalUrl: readarr?.externalUrl ?? '',
          syncEnabled: readarr?.syncEnabled ?? false,
          enableSearch: !readarr?.preventSearch,
          activeMetadataProfileId: readarr?.activeMetadataProfileId ?? '',
          serviceType: readarr?.serviceType ?? 'ebook',
        }}
        validationSchema={ReadarrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const profileName = testResponse.profiles.find(
              (profile) => profile.id === Number(values.activeProfileId)
            )?.name;
            const metadataProfileName = testResponse.metadataProfiles.find(
              (profile) => profile.id === Number(values.activeMetadataProfileId)
            )?.name;

            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              activeProfileId: Number(values.activeProfileId),
              activeProfileName: profileName,
              activeDirectory: values.rootFolder,
              tags: [],
              isDefault: values.isDefault,
              is4k: false,
              externalUrl: values.externalUrl,
              syncEnabled: values.syncEnabled,
              preventSearch: !values.enableSearch,
              tagRequests: false,
              overrideRule: [],
              activeMetadataProfileId: Number(values.activeMetadataProfileId),
              activeMetadataProfileName: metadataProfileName,
              serviceType: values.serviceType,
            };

            if (!readarr) {
              await axios.post('/api/v1/settings/readarr', submission);
            } else {
              await axios.put(
                `/api/v1/settings/readarr/${readarr.id}`,
                submission
              );
            }

            onSave();
          } catch {
            addToast(intl.formatMessage(messages.toastReadarrSaveFailure), {
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
                : readarr
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
                const response = await testConnection({
                  id: readarr?.id,
                  apiKey: values.apiKey,
                  baseUrl: values.baseUrl,
                  hostname: values.hostname,
                  port: values.port,
                  useSsl: values.ssl,
                  serviceType: values.serviceType,
                });
                if (response && (!values.baseUrl || values.baseUrl === '/')) {
                  setFieldValue('baseUrl', response.urlBase || '');
                }
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
              !readarr
                ? intl.formatMessage(messages.createreadarr)
                : intl.formatMessage(messages.editreadarr)
            }
          >
            <div className="mb-6">
              <p className="description">
                {intl.formatMessage(messages.compatibilityNote)}
              </p>
              <p className="description mt-2">
                {intl.formatMessage(messages.migrationNote)}{' '}
                <a
                  href="https://docs.seerr.dev/using-seerr/bookshelf-hardcover-migration"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-500 transition duration-300 hover:text-indigo-400"
                >
                  {intl.formatMessage(messages.migrationGuide)}
                </a>
              </p>
              <div className="form-row">
                <span className="text-label">
                  {intl.formatMessage(messages.diagnose)}
                </span>
                <div className="form-input-area">
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled={
                      !values.apiKey ||
                      !values.hostname ||
                      !values.port ||
                      isTesting ||
                      isDiagnosing
                    }
                    onClick={async (e) => {
                      e.preventDefault();
                      setIsDiagnosing(true);
                      try {
                        const response = await axios.post<DiagnosticResponse>(
                          '/api/v1/settings/readarr/diagnose',
                          {
                            id: readarr?.id,
                            hostname: values.hostname,
                            apiKey: values.apiKey,
                            port: Number(values.port),
                            baseUrl: values.baseUrl,
                            useSsl: values.ssl,
                            serviceType: values.serviceType,
                            activeDirectory: values.rootFolder,
                            activeProfileId: Number(values.activeProfileId),
                            activeMetadataProfileId: Number(
                              values.activeMetadataProfileId
                            ),
                            term: 'isbn:9780547928227',
                          }
                        );

                        setDiagnosticResponse(response.data);
                        addToast(
                          response.data.ok
                            ? intl.formatMessage(messages.diagnosticOk)
                            : intl.formatMessage(messages.diagnosticFailed),
                          {
                            appearance: response.data.ok ? 'success' : 'error',
                            autoDismiss: true,
                          }
                        );
                      } catch (e) {
                        const message = axios.isAxiosError(e)
                          ? e.response?.data?.message || e.message
                          : e instanceof Error
                            ? e.message
                            : 'Diagnostic request failed.';
                        setDiagnosticResponse({
                          ok: false,
                          category: 'backend_unreachable',
                          message,
                        });
                        addToast(
                          intl.formatMessage(messages.diagnosticFailed),
                          {
                            appearance: 'error',
                            autoDismiss: true,
                          }
                        );
                      } finally {
                        setIsDiagnosing(false);
                      }
                    }}
                  >
                    {isDiagnosing
                      ? intl.formatMessage(messages.diagnosing)
                      : intl.formatMessage(messages.diagnose)}
                  </Button>
                  {diagnosticResponse && (
                    <p className="description mt-2">
                      {diagnosticResponse.category}:{' '}
                      {diagnosticResponse.message}
                      {diagnosticResponse.provider
                        ? ` Provider: ${diagnosticResponse.provider}.`
                        : ''}
                      {diagnosticResponse.metadataSource
                        ? ` Metadata: ${diagnosticResponse.metadataSource}.`
                        : ''}
                      {diagnosticResponse.legacyWarning
                        ? ` ${diagnosticResponse.legacyWarning}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>
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
                <label htmlFor="serviceType" className="text-label">
                  {intl.formatMessage(messages.serviceType)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field as="select" id="serviceType" name="serviceType">
                      <option value="ebook">
                        {intl.formatMessage(messages.ebook)}
                      </option>
                      <option value="audiobook">
                        {intl.formatMessage(messages.audiobook)}
                      </option>
                    </Field>
                  </div>
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
                <label htmlFor="activeProfileId" className="text-label">
                  {intl.formatMessage(messages.qualityprofile)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      as="select"
                      id="activeProfileId"
                      name="activeProfileId"
                      disabled={!isValidated || isTesting}
                    >
                      <option value="">
                        {isTesting
                          ? intl.formatMessage(messages.loadingprofiles)
                          : !isValidated
                            ? intl.formatMessage(
                                messages.testFirstQualityProfiles
                              )
                            : intl.formatMessage(messages.selectQualityProfile)}
                      </option>
                      {testResponse.profiles.map((profile) => (
                        <option
                          key={`loaded-readarr-profile-${profile.id}`}
                          value={profile.id}
                        >
                          {profile.name}
                        </option>
                      ))}
                    </Field>
                  </div>
                  {errors.activeProfileId &&
                    touched.activeProfileId &&
                    typeof errors.activeProfileId === 'string' && (
                      <div className="error">{errors.activeProfileId}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="rootFolder" className="text-label">
                  {intl.formatMessage(messages.rootfolder)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      as="select"
                      id="rootFolder"
                      name="rootFolder"
                      disabled={!isValidated || isTesting}
                    >
                      <option value="">
                        {isTesting
                          ? intl.formatMessage(messages.loadingrootfolders)
                          : !isValidated
                            ? intl.formatMessage(messages.testFirstRootFolders)
                            : intl.formatMessage(messages.selectRootFolder)}
                      </option>
                      {testResponse.rootFolders.map((folder) => (
                        <option
                          key={`loaded-readarr-root-${folder.id}`}
                          value={folder.path}
                        >
                          {folder.path}
                        </option>
                      ))}
                    </Field>
                  </div>
                  {errors.rootFolder &&
                    touched.rootFolder &&
                    typeof errors.rootFolder === 'string' && (
                      <div className="error">{errors.rootFolder}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="activeMetadataProfileId" className="text-label">
                  {intl.formatMessage(messages.metadataprofile)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      as="select"
                      id="activeMetadataProfileId"
                      name="activeMetadataProfileId"
                      disabled={!isValidated || isTesting}
                    >
                      <option value="">
                        {isTesting
                          ? intl.formatMessage(messages.loadingmetadataprofiles)
                          : !isValidated
                            ? intl.formatMessage(
                                messages.testFirstMetadataProfiles
                              )
                            : intl.formatMessage(
                                messages.selectMetadataProfile
                              )}
                      </option>
                      {testResponse.metadataProfiles.map((profile) => (
                        <option
                          key={`loaded-readarr-metadataprofile-${profile.id}`}
                          value={profile.id}
                        >
                          {profile.name}
                        </option>
                      ))}
                    </Field>
                  </div>
                  {errors.activeMetadataProfileId &&
                    touched.activeMetadataProfileId &&
                    typeof errors.activeMetadataProfileId === 'string' && (
                      <div className="error">
                        {errors.activeMetadataProfileId}
                      </div>
                    )}
                </div>
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

export default ReadarrModal;
