import Alert from '@app/components/Common/Alert';
import defineMessages from '@app/utils/defineMessages';
import type { TlsStatusResponse } from '@server/interfaces/api/settingsInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TransportSecurityNotice', {
  httpsRequiredTitle: 'HTTPS is required for browser sign-in',
  httpsRequiredDescription:
    'This page is reachable over HTTP, but SeerrNG will not create a persistent login session there. Use an HTTPS reverse proxy or enable built-in TLS before signing in.',
  insecureTitle: 'Insecure HTTP sign-in is enabled',
  insecureDescription:
    'SEERR_ALLOW_HTTP_AUTH is enabled. Anyone who can observe this network traffic could steal a session cookie. Use this only on a trusted LAN and prefer HTTPS whenever possible.',
  selfSignedTitle: 'Trust the SeerrNG local CA before signing in',
  selfSignedDescription:
    'Built-in HTTPS is active with a locally generated certificate. Download and install the local CA on each trusted device, then open the HTTPS URL again.',
  providedTitle: 'HTTPS is enabled',
  providedDescription:
    'SeerrNG is using the certificate supplied by the operator. Verify the fingerprint below if your browser or reverse proxy reports a certificate mismatch.',
  httpsUrl: 'HTTPS URL: {url}',
  fingerprint: 'SHA-256 fingerprint: {fingerprint}',
  downloadCa: 'Download the SeerrNG local CA certificate',
  configuredHosts: 'Configured TLS hosts: {hosts}',
});

const formatHost = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

const TransportSecurityNotice = () => {
  const intl = useIntl();
  const { data } = useSWR<TlsStatusResponse>('/api/v1/status/tls', {
    revalidateOnFocus: false,
    refreshInterval: 0,
  });

  if (!data) {
    return null;
  }

  const httpsUrls =
    data.httpsPort === null
      ? []
      : data.hosts.map(
          (host) => `https://${formatHost(host)}:${data.httpsPort}`
        );

  if (data.mode === 'disabled' && !data.httpAuthAllowed) {
    return (
      <Alert
        type="info"
        title={intl.formatMessage(messages.httpsRequiredTitle)}
      >
        {intl.formatMessage(messages.httpsRequiredDescription)}
      </Alert>
    );
  }

  if (data.mode === 'disabled' && data.httpAuthAllowed) {
    return (
      <Alert type="warning" title={intl.formatMessage(messages.insecureTitle)}>
        {intl.formatMessage(messages.insecureDescription)}
      </Alert>
    );
  }

  return (
    <Alert
      type={data.mode === 'self-signed' ? 'warning' : 'info'}
      title={intl.formatMessage(
        data.mode === 'self-signed'
          ? messages.selfSignedTitle
          : messages.providedTitle
      )}
    >
      <p>
        {intl.formatMessage(
          data.mode === 'self-signed'
            ? messages.selfSignedDescription
            : messages.providedDescription
        )}
      </p>
      {httpsUrls.length > 0 && (
        <p>
          {intl.formatMessage(messages.httpsUrl, {
            url: httpsUrls.join(', '),
          })}
        </p>
      )}
      {data.hosts.length > 0 && (
        <p>
          {intl.formatMessage(messages.configuredHosts, {
            hosts: data.hosts.join(', '),
          })}
        </p>
      )}
      {data.fingerprint && (
        <p className="break-all">
          {intl.formatMessage(messages.fingerprint, {
            fingerprint: data.fingerprint,
          })}
        </p>
      )}
      {data.caDownloadAvailable && (
        <p>
          <a
            className="font-medium underline"
            href="/api/v1/status/tls/ca"
            download="seerrng-local-ca.crt"
          >
            {intl.formatMessage(messages.downloadCa)}
          </a>
        </p>
      )}
    </Alert>
  );
};

export default TransportSecurityNotice;
