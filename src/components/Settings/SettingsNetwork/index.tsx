import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import SettingsBadge from '@app/components/Settings/SettingsBadge';
import Field, {
  default as SettingsField,
} from '@app/components/Settings/SettingsField';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { NetworkSettings } from '@server/lib/settings';
import axios from 'axios';
import { Form, Formik } from 'formik';
import type { ChangeEvent } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsNetwork', {
  toastSettingsSuccess: 'Settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  network: 'Network',
  networksettings: 'Network Settings',
  networksettingsDescription:
    'Configure network settings for your Seerr instance.',
  csrfProtection: 'Enable CSRF Protection',
  csrfProtectionDescription:
    'Reject cross-site state-changing browser requests (requires HTTPS)',
  csrfProtectionWarning:
    'Keep this enabled for browser-session security. Disable it only when a trusted external API client must make write requests and cannot send CSRF tokens.',
  trustProxy: 'Enable Proxy Support',
  trustProxyTip:
    'Allow Seerr to correctly register client IP addresses behind a proxy',
  proxyEnabled: 'HTTP(S) Proxy',
  proxyEnabledTip:
    'Send ALL outgoing HTTP/HTTPS requests through a proxy server (host/port). Does NOT enable HTTPS, SSL, or certificate configuration.',
  proxyHostname: 'Proxy Hostname',
  proxyPort: 'Proxy Port',
  proxySsl: 'Use SSL For Proxy',
  proxyUser: 'Proxy Username',
  proxyPassword: 'Proxy Password',
  proxyBypassFilter: 'Proxy Ignored Addresses',
  proxyBypassFilterTip:
    "Use ',' as a separator, and '*.' as a wildcard for subdomains",
  proxyBypassLocalAddresses: 'Bypass Proxy for Local Addresses',
  validationDnsCacheMinTtl: 'You must provide a valid minimum TTL',
  validationDnsCacheMaxTtl: 'You must provide a valid maximum TTL',
  validationProxyPort: 'You must provide a valid port',
  networkDisclaimer:
    'Network parameters from your container/system should be used instead of these settings. See the {docs} for more information.',
  docs: 'documentation',
  forceIpv4First: 'Force IPv4 Resolution First',
  forceIpv4FirstTip:
    'Force Seerr to resolve IPv4 addresses first instead of IPv6',
  dnsCache: 'DNS Cache',
  dnsCacheTip:
    'Enable caching of DNS lookups to optimize performance and avoid making unnecessary API calls',
  dnsCacheHoverTip:
    'Do NOT enable this if you are experiencing issues with DNS lookups',
  dnsCacheForceMinTtl: 'DNS Cache Minimum TTL',
  dnsCacheForceMaxTtl: 'DNS Cache Maximum TTL',
  apiRequestTimeout: 'API Request Timeout',
  apiRequestTimeoutTip:
    'Maximum time (in seconds) to wait for responses from external services like Radarr, Sonarr, Lidarr, or Bookshelf. Set to 0 for no timeout.',
  validationApiRequestTimeout: 'You must provide a valid timeout value',
  transportSecurity: 'Browser Transport Security',
  transportSecurityDescription:
    'Choose how Seerr protects browser login sessions. Listener changes require a server restart.',
  tlsMode: 'Built-in HTTPS mode',
  tlsDisabled: 'Disabled (direct HTTP sign-in or use a reverse proxy)',
  tlsSelfSigned: 'Self-signed local HTTPS',
  tlsProvided: 'Provided certificate',
  httpsPort: 'HTTPS Port',
  httpsPortTip: 'The HTTPS listener port. It must differ from the HTTP port.',
  tlsHosts: 'Self-signed HTTPS hostnames and IP addresses',
  tlsHostsTip:
    'Comma-separated names and addresses included in the generated certificate and accepted by the HTTP listener. Provided certificates use their own SANs.',
  certificateFile: 'Certificate file',
  keyFile: 'Private key file',
  caFile: 'CA chain file (optional)',
  providedFileTip:
    'Use paths visible inside the SeerrNG process. Mount certificate files into the container; private keys are never uploaded through this form.',
  redirectHttpToHttps: 'Redirect HTTP to HTTPS',
  redirectHttpToHttpsTip:
    'Leave this off while verifying the HTTPS URL. HTTP will show an upgrade instruction instead of serving the app.',
  allowHttpAuth: 'Allow authenticated browser sessions over HTTP',
  allowHttpAuthTip:
    'Use only when trusted LAN devices cannot install the local CA. Anyone observing the connection could steal the session cookie.',
  acknowledgeHttpRisk:
    'I understand that HTTP login sessions can be intercepted on the network.',
  environmentOverride:
    'Transport settings are overridden by environment variables: {variables}. Remove those variables before using these controls.',
  tlsSaveRestart:
    'Save the choice, restart SeerrNG, verify HTTPS, then enable the HTTP redirect if desired.',
});

const toOptionalNumber = (value: unknown): number | undefined =>
  value === '' || value === null || value === undefined
    ? undefined
    : Number(value);

const SettingsNetwork = () => {
  const { addToast } = useToasts();
  const intl = useIntl();
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<NetworkSettings>('/api/v1/settings/network');
  const { data: tlsStatus } = useSWR<{
    environmentOverrides: string[];
  }>('/api/v1/status/tls');

  const NetworkSettingsSchema = Yup.object().shape({
    dnsCacheForceMinTtl: Yup.number().when('dnsCacheEnabled', {
      is: true,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationDnsCacheMinTtl))
          .required(intl.formatMessage(messages.validationDnsCacheMinTtl))
          .min(0),
      otherwise: (schema) => schema.nullable(),
    }),
    dnsCacheForceMaxTtl: Yup.number().when('dnsCacheEnabled', {
      is: true,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationDnsCacheMaxTtl))
          .required(intl.formatMessage(messages.validationDnsCacheMaxTtl))
          .min(-1),
      otherwise: (schema) => schema.nullable(),
    }),
    proxyPort: Yup.number().when('proxyEnabled', {
      is: (proxyEnabled: boolean) => proxyEnabled,
      then: (schema) =>
        schema
          .typeError(intl.formatMessage(messages.validationProxyPort))
          .integer(intl.formatMessage(messages.validationProxyPort))
          .min(1, intl.formatMessage(messages.validationProxyPort))
          .max(65535, intl.formatMessage(messages.validationProxyPort))
          .required(intl.formatMessage(messages.validationProxyPort)),
      otherwise: (schema) => schema.nullable(),
    }),
    apiRequestTimeout: Yup.number()
      .typeError(intl.formatMessage(messages.validationApiRequestTimeout))
      .required(intl.formatMessage(messages.validationApiRequestTimeout))
      .min(0, intl.formatMessage(messages.validationApiRequestTimeout)),
  });

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.network),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.networksettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.networksettingsDescription)}
        </p>
      </div>
      <div className="section">
        <Formik
          initialValues={{
            csrfProtection: data?.csrfProtection,
            forceIpv4First: data?.forceIpv4First,
            dnsCacheEnabled: data?.dnsCache.enabled,
            dnsCacheForceMinTtl: data?.dnsCache.forceMinTtl,
            dnsCacheForceMaxTtl: data?.dnsCache.forceMaxTtl,
            trustProxy: data?.trustProxy,
            proxyEnabled: data?.proxy?.enabled,
            proxyHostname: data?.proxy?.hostname,
            proxyPort: data?.proxy?.port,
            proxySsl: data?.proxy?.useSsl,
            proxyUser: data?.proxy?.user,
            proxyPassword: data?.proxy?.password,
            proxyBypassFilter: data?.proxy?.bypassFilter,
            proxyBypassLocalAddresses: data?.proxy?.bypassLocalAddresses,
            apiRequestTimeout:
              data?.apiRequestTimeout !== undefined
                ? data.apiRequestTimeout / 1000
                : 10,
            tlsMode: data?.tls?.mode ?? 'disabled',
            tlsHttpsPort: data?.tls?.httpsPort ?? 5056,
            tlsHosts: data?.tls?.hosts ?? 'localhost,127.0.0.1,::1',
            tlsCertificateFile: data?.tls?.certificateFile ?? '',
            tlsKeyFile: data?.tls?.keyFile ?? '',
            tlsCaFile: data?.tls?.caFile ?? '',
            tlsRedirectHttpToHttps: data?.tls?.redirectHttpToHttps ?? false,
            tlsAllowHttpAuth: data?.tls?.allowHttpAuth ?? true,
            tlsHttpAuthAcknowledged: data?.tls?.httpAuthAcknowledged ?? true,
          }}
          enableReinitialize
          validationSchema={NetworkSettingsSchema}
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/network', {
                csrfProtection: values.csrfProtection,
                forceIpv4First: values.forceIpv4First,
                trustProxy: values.trustProxy,
                dnsCache: {
                  enabled: values.dnsCacheEnabled,
                  forceMinTtl: toOptionalNumber(values.dnsCacheForceMinTtl),
                  forceMaxTtl: toOptionalNumber(values.dnsCacheForceMaxTtl),
                },
                proxy: {
                  enabled: values.proxyEnabled,
                  hostname: values.proxyHostname,
                  port: toOptionalNumber(values.proxyPort),
                  useSsl: values.proxySsl,
                  user: values.proxyUser,
                  password: values.proxyPassword,
                  bypassFilter: values.proxyBypassFilter,
                  bypassLocalAddresses: values.proxyBypassLocalAddresses,
                },
                apiRequestTimeout: Number(values.apiRequestTimeout) * 1000,
                tls: {
                  mode: values.tlsMode,
                  httpsPort: toOptionalNumber(values.tlsHttpsPort),
                  hosts: values.tlsHosts,
                  certificateFile: values.tlsCertificateFile,
                  keyFile: values.tlsKeyFile,
                  caFile: values.tlsCaFile,
                  redirectHttpToHttps: values.tlsRedirectHttpToHttps,
                  allowHttpAuth: values.tlsAllowHttpAuth,
                  httpAuthAcknowledged: values.tlsHttpAuthAcknowledged,
                },
              });
              mutate('/api/v1/settings/public');
              mutate('/api/v1/status?checkUpdateAvailable=false');

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
              <Form className="section" data-testid="settings-network-form">
                <div className="mb-6">
                  <h4 className="heading">
                    {intl.formatMessage(messages.transportSecurity)}
                  </h4>
                  <p className="description">
                    {intl.formatMessage(messages.transportSecurityDescription)}
                  </p>
                  {tlsStatus?.environmentOverrides.length ? (
                    <Alert type="warning">
                      {intl.formatMessage(messages.environmentOverride, {
                        variables: tlsStatus.environmentOverrides.join(', '),
                      })}
                    </Alert>
                  ) : null}
                </div>
                <div className="form-row">
                  <label htmlFor="tlsMode" className="text-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.tlsMode)}
                    </span>
                    <SettingsBadge badgeType="restartRequired" />
                  </label>
                  <div className="form-input-area">
                    <Field
                      as="select"
                      id="tlsMode"
                      name="tlsMode"
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                        const nextMode = event.target.value;
                        setFieldValue('tlsMode', nextMode);
                        if (nextMode !== 'disabled') {
                          setFieldValue('tlsAllowHttpAuth', false);
                          setFieldValue('tlsHttpAuthAcknowledged', false);
                        }
                      }}
                    >
                      <option value="disabled">
                        {intl.formatMessage(messages.tlsDisabled)}
                      </option>
                      <option value="self-signed">
                        {intl.formatMessage(messages.tlsSelfSigned)}
                      </option>
                      <option value="provided">
                        {intl.formatMessage(messages.tlsProvided)}
                      </option>
                    </Field>
                  </div>
                </div>
                {values.tlsMode !== 'disabled' && (
                  <>
                    <div className="mr-2 ml-4">
                      <div className="form-row">
                        <label htmlFor="tlsHttpsPort" className="text-label">
                          {intl.formatMessage(messages.httpsPort)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="tlsHttpsPort"
                            name="tlsHttpsPort"
                            type="text"
                            inputMode="numeric"
                            className="short"
                          />
                        </div>
                        <span className="settings-form-row-description">
                          {intl.formatMessage(messages.httpsPortTip)}
                        </span>
                      </div>
                      {values.tlsMode === 'self-signed' && (
                        <div className="form-row">
                          <label htmlFor="tlsHosts" className="text-label">
                            {intl.formatMessage(messages.tlsHosts)}
                          </label>
                          <div className="form-input-area">
                            <Field id="tlsHosts" name="tlsHosts" type="text" />
                          </div>
                          <span className="settings-form-row-description">
                            {intl.formatMessage(messages.tlsHostsTip)}
                          </span>
                        </div>
                      )}
                      {values.tlsMode === 'provided' && (
                        <>
                          <p className="description">
                            {intl.formatMessage(messages.providedFileTip)}
                          </p>
                          {(
                            [
                              ['tlsCertificateFile', messages.certificateFile],
                              ['tlsKeyFile', messages.keyFile],
                              ['tlsCaFile', messages.caFile],
                            ] as const
                          ).map(([name, label]) => (
                            <div className="form-row" key={name}>
                              <label htmlFor={name} className="text-label">
                                {intl.formatMessage(label)}
                              </label>
                              <div className="form-input-area">
                                <Field id={name} name={name} type="text" />
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="form-row">
                      <label
                        htmlFor="tlsRedirectHttpToHttps"
                        className="checkbox-label"
                      >
                        <span className="mr-2">
                          {intl.formatMessage(messages.redirectHttpToHttps)}
                        </span>
                        <SettingsBadge badgeType="restartRequired" />
                      </label>
                      <div className="form-input-area">
                        <SettingsField
                          type="checkbox"
                          id="tlsRedirectHttpToHttps"
                          name="tlsRedirectHttpToHttps"
                          onChange={() => {
                            setFieldValue(
                              'tlsRedirectHttpToHttps',
                              !values.tlsRedirectHttpToHttps
                            );
                          }}
                        />
                      </div>
                      <span className="settings-form-row-description">
                        {intl.formatMessage(messages.redirectHttpToHttpsTip)}
                      </span>
                    </div>
                  </>
                )}
                {values.tlsMode === 'disabled' && (
                  <>
                    <div className="form-row">
                      <label
                        htmlFor="tlsAllowHttpAuth"
                        className="checkbox-label"
                      >
                        <span className="mr-2">
                          {intl.formatMessage(messages.allowHttpAuth)}
                        </span>
                        <SettingsBadge badgeType="restartRequired" />
                      </label>
                      <div className="form-input-area">
                        <SettingsField
                          type="checkbox"
                          id="tlsAllowHttpAuth"
                          name="tlsAllowHttpAuth"
                          onChange={() => {
                            setFieldValue(
                              'tlsAllowHttpAuth',
                              !values.tlsAllowHttpAuth
                            );
                            if (values.tlsAllowHttpAuth) {
                              setFieldValue('tlsHttpAuthAcknowledged', false);
                            }
                          }}
                        />
                      </div>
                      <p className="settings-form-row-description">
                        {intl.formatMessage(messages.allowHttpAuthTip)}
                      </p>
                    </div>
                    {values.tlsAllowHttpAuth && (
                      <Alert type="warning" className="settings-http-warning">
                        <label
                          htmlFor="tlsHttpAuthAcknowledged"
                          className="settings-warning-acknowledgement checkbox-label"
                        >
                          <SettingsField
                            type="checkbox"
                            id="tlsHttpAuthAcknowledged"
                            name="tlsHttpAuthAcknowledged"
                          />
                          <span className="ml-2">
                            {intl.formatMessage(messages.acknowledgeHttpRisk)}
                          </span>
                        </label>
                      </Alert>
                    )}
                  </>
                )}
                {values.tlsMode !== 'disabled' && (
                  <p className="description">
                    {intl.formatMessage(messages.tlsSaveRestart)}
                  </p>
                )}
                <div className="form-row">
                  <label htmlFor="trustProxy" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.trustProxy)}
                    </span>
                    <SettingsBadge badgeType="restartRequired" />
                  </label>
                  <div className="form-input-area">
                    <SettingsField
                      type="checkbox"
                      id="trustProxy"
                      name="trustProxy"
                      onChange={() => {
                        setFieldValue('trustProxy', !values.trustProxy);
                      }}
                    />
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.trustProxyTip)}
                  </span>
                </div>
                <div className="form-row">
                  <label htmlFor="csrfProtection" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.csrfProtection)}
                    </span>
                    <span className="settings-badge-row">
                      <SettingsBadge badgeType="advanced" />
                      <SettingsBadge badgeType="restartRequired" />
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Tooltip
                      content={intl.formatMessage(
                        messages.csrfProtectionWarning
                      )}
                    >
                      <SettingsField
                        type="checkbox"
                        id="csrfProtection"
                        name="csrfProtection"
                        onChange={() => {
                          setFieldValue(
                            'csrfProtection',
                            !values.csrfProtection
                          );
                        }}
                      />
                    </Tooltip>
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.csrfProtectionDescription)}
                  </span>
                </div>
                <div className="form-row">
                  <label htmlFor="forceIpv4First" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.forceIpv4First)}
                    </span>
                    <span className="settings-badge-row">
                      <SettingsBadge badgeType="advanced" />
                      <SettingsBadge badgeType="restartRequired" />
                      <SettingsBadge badgeType="experimental" />
                    </span>
                  </label>
                  <div className="form-input-area">
                    <SettingsField
                      type="checkbox"
                      id="forceIpv4First"
                      name="forceIpv4First"
                      onChange={() => {
                        setFieldValue('forceIpv4First', !values.forceIpv4First);
                      }}
                    />
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.forceIpv4FirstTip)}
                  </span>
                </div>
                <div className="form-row">
                  <label htmlFor="dnsCacheEnabled" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.dnsCache)}
                    </span>
                    <span className="settings-badge-row">
                      <SettingsBadge badgeType="advanced" />
                      <SettingsBadge badgeType="restartRequired" />
                      <SettingsBadge badgeType="experimental" />
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Tooltip
                      content={intl.formatMessage(messages.dnsCacheHoverTip)}
                    >
                      <SettingsField
                        type="checkbox"
                        id="dnsCacheEnabled"
                        name="dnsCacheEnabled"
                        onChange={() => {
                          setFieldValue(
                            'dnsCacheEnabled',
                            !values.dnsCacheEnabled
                          );
                        }}
                      />
                    </Tooltip>
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.dnsCacheTip)}
                  </span>
                </div>
                {values.dnsCacheEnabled && (
                  <>
                    <div className="mr-2 ml-4">
                      <div className="form-row">
                        <label
                          htmlFor="dnsCacheForceMinTtl"
                          className="text-label"
                        >
                          {intl.formatMessage(messages.dnsCacheForceMinTtl)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="dnsCacheForceMinTtl"
                            name="dnsCacheForceMinTtl"
                            type="text"
                            inputMode="numeric"
                            className="short"
                          />
                        </div>
                        {errors.dnsCacheForceMinTtl &&
                          touched.dnsCacheForceMinTtl &&
                          typeof errors.dnsCacheForceMinTtl === 'string' && (
                            <div className="error">
                              {errors.dnsCacheForceMinTtl}
                            </div>
                          )}
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="dnsCacheForceMaxTtl"
                          className="text-label"
                        >
                          {intl.formatMessage(messages.dnsCacheForceMaxTtl)}
                        </label>
                        <div className="form-input-area">
                          <Field
                            id="dnsCacheForceMaxTtl"
                            name="dnsCacheForceMaxTtl"
                            type="text"
                            inputMode="text"
                            className="short"
                          />
                        </div>
                        {errors.dnsCacheForceMaxTtl &&
                          touched.dnsCacheForceMaxTtl &&
                          typeof errors.dnsCacheForceMaxTtl === 'string' && (
                            <div className="error">
                              {errors.dnsCacheForceMaxTtl}
                            </div>
                          )}
                      </div>
                    </div>
                  </>
                )}
                <div className="form-row">
                  <label htmlFor="apiRequestTimeout" className="text-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.apiRequestTimeout)}
                    </span>
                    <SettingsBadge badgeType="restartRequired" />
                  </label>
                  <div className="form-input-area">
                    <SettingsField
                      id="apiRequestTimeout"
                      name="apiRequestTimeout"
                      type="text"
                      inputMode="numeric"
                      className="short"
                    />
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.apiRequestTimeoutTip)}
                  </span>
                  {errors.apiRequestTimeout &&
                    touched.apiRequestTimeout &&
                    typeof errors.apiRequestTimeout === 'string' && (
                      <div className="error">{errors.apiRequestTimeout}</div>
                    )}
                </div>
                <div className="form-row">
                  <label htmlFor="proxyEnabled" className="checkbox-label">
                    <span className="mr-2">
                      {intl.formatMessage(messages.proxyEnabled)}
                    </span>
                    <span className="settings-badge-row">
                      <SettingsBadge badgeType="advanced" />
                      <SettingsBadge badgeType="restartRequired" />
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="proxyEnabled"
                      name="proxyEnabled"
                      onChange={() => {
                        setFieldValue('proxyEnabled', !values.proxyEnabled);
                      }}
                    />
                  </div>
                  <span className="settings-form-row-description">
                    {intl.formatMessage(messages.proxyEnabledTip)}
                  </span>
                </div>
                {values.proxyEnabled && (
                  <>
                    <div className="mr-2 ml-4">
                      <div className="form-row">
                        <label
                          htmlFor="proxyHostname"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyHostname)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyHostname"
                              name="proxyHostname"
                              type="text"
                            />
                          </div>
                          {errors.proxyHostname &&
                            touched.proxyHostname &&
                            typeof errors.proxyHostname === 'string' && (
                              <div className="error">
                                {errors.proxyHostname}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxyPort" className="checkbox-label">
                          {intl.formatMessage(messages.proxyPort)}
                        </label>
                        <div className="form-input-area">
                          <SettingsField
                            id="proxyPort"
                            name="proxyPort"
                            type="text"
                            inputMode="numeric"
                            className="short"
                          />
                          {errors.proxyPort &&
                            touched.proxyPort &&
                            typeof errors.proxyPort === 'string' && (
                              <div className="error">{errors.proxyPort}</div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxySsl" className="checkbox-label">
                          {intl.formatMessage(messages.proxySsl)}
                        </label>
                        <div className="form-input-area">
                          <SettingsField
                            type="checkbox"
                            id="proxySsl"
                            name="proxySsl"
                            onChange={() => {
                              setFieldValue('proxySsl', !values.proxySsl);
                            }}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <label htmlFor="proxyUser" className="checkbox-label">
                          {intl.formatMessage(messages.proxyUser)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyUser"
                              name="proxyUser"
                              type="text"
                            />
                          </div>
                          {errors.proxyUser &&
                            touched.proxyUser &&
                            typeof errors.proxyUser === 'string' && (
                              <div className="error">{errors.proxyUser}</div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyPassword"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyPassword)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyPassword"
                              name="proxyPassword"
                              type="password"
                            />
                          </div>
                          {errors.proxyPassword &&
                            touched.proxyPassword &&
                            typeof errors.proxyPassword === 'string' && (
                              <div className="error">
                                {errors.proxyPassword}
                              </div>
                            )}
                        </div>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyBypassFilter"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(messages.proxyBypassFilter)}
                        </label>
                        <div className="form-input-area">
                          <div className="form-input-field">
                            <Field
                              id="proxyBypassFilter"
                              name="proxyBypassFilter"
                              type="text"
                            />
                          </div>
                          {errors.proxyBypassFilter &&
                            touched.proxyBypassFilter &&
                            typeof errors.proxyBypassFilter === 'string' && (
                              <div className="error">
                                {errors.proxyBypassFilter}
                              </div>
                            )}
                        </div>
                        <span className="settings-form-row-description">
                          {intl.formatMessage(messages.proxyBypassFilterTip)}
                        </span>
                      </div>
                      <div className="form-row">
                        <label
                          htmlFor="proxyBypassLocalAddresses"
                          className="checkbox-label"
                        >
                          {intl.formatMessage(
                            messages.proxyBypassLocalAddresses
                          )}
                        </label>
                        <div className="form-input-area">
                          <Field
                            type="checkbox"
                            id="proxyBypassLocalAddresses"
                            name="proxyBypassLocalAddresses"
                            onChange={() => {
                              setFieldValue(
                                'proxyBypassLocalAddresses',
                                !values.proxyBypassLocalAddresses
                              );
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
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
      </div>
    </>
  );
};

export default SettingsNetwork;
