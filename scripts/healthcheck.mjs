import http from 'node:http';
import https from 'node:https';

const tlsMode = (process.env.SEERR_TLS_MODE ?? 'disabled').toLowerCase();
const tlsEnabled = tlsMode === 'self-signed' || tlsMode === 'provided';
const readinessPath = process.argv[2] ?? '/api/v1/status/ready';
const port = Number(
  tlsEnabled
    ? (process.env.SEERR_HTTPS_PORT ?? '5056')
    : (process.env.PORT ?? '5055')
);
const client = tlsEnabled ? https : http;

const request = client.get(
  {
    hostname: '127.0.0.1',
    path: readinessPath,
    port,
    ...(tlsEnabled ? { rejectUnauthorized: false } : {}),
  },
  (response) => {
    response.resume();
    response.once('end', () => {
      process.exit(response.statusCode === 204 ? 0 : 1);
    });
  }
);

request.setTimeout(3_000, () => request.destroy());
request.once('error', () => process.exit(1));
