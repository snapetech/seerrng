import {
  assertNoSymlinkDirectoryComponents,
  isTolerableChmodError,
} from '@server/lib/pathSecurity';
import logger from '@server/logger';
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto';
import fs, { constants } from 'node:fs';
import fsp from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerOptions } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { createSecureContext } from 'node:tls';
import selfsigned from 'selfsigned';
import { appDataPath } from './appDataVolume';
import { parseListenPort } from './httpServer';

export type TlsMode = 'disabled' | 'self-signed' | 'provided';

export interface TlsRuntimeInfo {
  mode: TlsMode;
  httpPort: number;
  httpsPort: number | null;
  httpAuthAllowed: boolean;
  redirectsHttpToHttps: boolean;
  hosts: string[];
  fingerprint?: string;
  caDownloadAvailable: boolean;
}

export interface TlsConfiguration {
  mode: TlsMode;
  httpAuthAllowed: boolean;
  httpPort: number;
  httpsPort?: number;
  hosts: string[];
  httpsOptions?: ServerOptions;
  runtime: TlsRuntimeInfo;
  caCertificatePath?: string;
}

interface TlsMaterialPaths {
  directory: string;
  caCertificate: string;
  caKey: string;
  serverCertificate: string;
  serverKey: string;
  metadata: string;
}

interface LocalTlsMaterial {
  caCertificate: string;
  caKey: string;
  serverCertificate: string;
  serverKey: string;
}

const DEFAULT_HTTPS_PORT = 5056;
const DEFAULT_TLS_HOSTS = ['localhost', '127.0.0.1', '::1'];
const TLS_DIRECTORY_NAME = 'tls';
const LOCAL_CA_VALIDITY_DAYS = 10 * 365;
const LOCAL_CERT_VALIDITY_DAYS = 825;
const CERTIFICATE_RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_TLS_FILE_BYTES = 4 * 1024 * 1024;
const PRIVATE_TLS_FILE_MODE = 0o600;
const PRIVATE_TLS_DIRECTORY_MODE = 0o700;

let activeRuntime: TlsRuntimeInfo = {
  mode: 'disabled',
  httpPort: 5055,
  httpsPort: null,
  httpAuthAllowed: false,
  redirectsHttpToHttps: false,
  hosts: [],
  caDownloadAvailable: false,
};
let activeCaCertificate: string | undefined;

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

const isRecordFile = async (filePath: string): Promise<boolean> => {
  try {
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`TLS material must not be a symlink: ${filePath}`);
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`TLS material must be a regular file: ${filePath}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const bestEffortChmod = async (
  filePath: string,
  mode: number,
  label: string
): Promise<void> => {
  try {
    await fsp.chmod(filePath, mode);
  } catch (error) {
    if (!isTolerableChmodError(error)) {
      throw error;
    }
    logger.warn(
      `Unable to set restrictive permissions on ${label}; continuing with the existing permissions.`,
      { label: 'Security' }
    );
  }
};

const ensureTlsDirectory = async (directory: string): Promise<void> => {
  assertNoSymlinkDirectoryComponents(directory, {
    allowMissing: true,
    label: 'TLS directory',
  });
  await fsp.mkdir(directory, {
    recursive: true,
    mode: PRIVATE_TLS_DIRECTORY_MODE,
  });
  assertNoSymlinkDirectoryComponents(directory, { label: 'TLS directory' });
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('TLS directory must not be a symlink.');
  }
  await bestEffortChmod(
    directory,
    PRIVATE_TLS_DIRECTORY_MODE,
    'the TLS directory'
  );
};

const readPrivateTlsFile = async (filePath: string): Promise<string> => {
  assertNoSymlinkDirectoryComponents(path.dirname(filePath), {
    label: 'TLS directory',
  });
  const handle = await fsp.open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(
        `TLS material must be a private regular file: ${filePath}`
      );
    }
    if (stat.size > MAX_TLS_FILE_BYTES) {
      throw new Error(`TLS material exceeds ${MAX_TLS_FILE_BYTES} bytes`);
    }
    await handle.chmod(PRIVATE_TLS_FILE_MODE).catch((error: unknown) => {
      if (!isTolerableChmodError(error)) {
        throw error;
      }
    });
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
};

const writePrivateTlsFile = async (
  filePath: string,
  contents: string
): Promise<void> => {
  if (Buffer.byteLength(contents, 'utf8') > MAX_TLS_FILE_BYTES) {
    throw new Error(`TLS material exceeds ${MAX_TLS_FILE_BYTES} bytes`);
  }
  const directory = path.dirname(filePath);
  await ensureTlsDirectory(directory);
  if (await isRecordFile(filePath)) {
    const existing = await fsp.lstat(filePath);
    if (existing.nlink !== 1) {
      throw new Error(`TLS material must not be hard-linked: ${filePath}`);
    }
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${cryptoRandomSuffix()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(temporaryPath, 'wx', PRIVATE_TLS_FILE_MODE);
    await handle.writeFile(contents, 'utf8');
    await handle.chmod(PRIVATE_TLS_FILE_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.unlink(temporaryPath).catch(() => undefined);
  }
};

const cryptoRandomSuffix = (): string => `${Date.now()}-${randomUUID()}`;

const readProvidedTlsFile = (filePath: string, label: string): string => {
  let resolvedPath: string;
  try {
    // Secret mounts often use a symlink for the active version. Resolve that
    // indirection once, then refuse a final-component symlink race.
    resolvedPath = fs.realpathSync(filePath);
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}`, { cause: error });
  }

  const descriptor = fs.openSync(
    resolvedPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`${label} must be a regular file: ${filePath}`);
    }
    if (stat.size > MAX_TLS_FILE_BYTES) {
      throw new Error(`${label} exceeds ${MAX_TLS_FILE_BYTES} bytes`);
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
};

const normalizeTlsHost = (value: string): string => {
  const host = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    !host ||
    host.length > 253 ||
    host.includes('*') ||
    /[\s/\\]/u.test(host)
  ) {
    throw new Error(`Invalid TLS hostname or IP address: ${value}`);
  }
  if (isIP(host)) {
    return host.toLowerCase();
  }
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/iu.test(
      host
    )
  ) {
    throw new Error(`Invalid TLS hostname or IP address: ${value}`);
  }
  return host.toLowerCase();
};

export const parseTlsMode = (value?: string): TlsMode => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'disabled') {
    return 'disabled';
  }
  if (normalized === 'self-signed' || normalized === 'selfsigned') {
    return 'self-signed';
  }
  if (normalized === 'provided') {
    return 'provided';
  }
  throw new Error(
    'SEERR_TLS_MODE must be one of "disabled", "self-signed", or "provided".'
  );
};

export const parseTlsBoolean = (
  name: string,
  value: string | undefined,
  defaultValue = false
): boolean => {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (value.toLowerCase() === 'true' || value === '1') {
    return true;
  }
  if (value.toLowerCase() === 'false' || value === '0') {
    return false;
  }
  throw new Error(`${name} must be either "true" or "false".`);
};

export const parseTlsHosts = (value?: string): string[] => {
  const source = value?.trim() ? value : DEFAULT_TLS_HOSTS.join(',');
  const hosts = [...new Set(source.split(',').map(normalizeTlsHost))];
  if (hosts.length === 0 || hosts.length > 64) {
    throw new Error('SEERR_TLS_HOSTS must contain between 1 and 64 hosts.');
  }
  return hosts;
};

const getTlsMaterialPaths = (
  directory = path.join(appDataPath(), TLS_DIRECTORY_NAME)
): TlsMaterialPaths => ({
  directory,
  caCertificate: path.join(directory, 'ca.crt'),
  caKey: path.join(directory, 'ca.key'),
  serverCertificate: path.join(directory, 'server.crt'),
  serverKey: path.join(directory, 'server.key'),
  metadata: path.join(directory, 'metadata.json'),
});

const extractCertificateHosts = (certificate: X509Certificate): string[] => [
  ...new Set(
    (certificate.subjectAltName ?? '')
      .split(/,\s*/u)
      .map((entry) => {
        const separator = entry.indexOf(':');
        if (separator < 0) return undefined;
        const type = entry.slice(0, separator).toLowerCase();
        const value = entry.slice(separator + 1).trim();
        if (type === 'dns' || type === 'ip address') {
          try {
            return normalizeTlsHost(value);
          } catch {
            return undefined;
          }
        }
        return undefined;
      })
      .filter((host): host is string => !!host)
  ),
];

const sameHosts = (left: string[], right: string[]): boolean => {
  const leftSet = new Set(left);
  return (
    leftSet.size === right.length && right.every((host) => leftSet.has(host))
  );
};

const assertPrivateKeyMatchesCertificate = (
  privateKey: string,
  certificate: X509Certificate,
  label: string
): void => {
  const certificatePublicKey = certificate.publicKey.export({
    type: 'spki',
    format: 'der',
  });
  const privatePublicKey = createPublicKey(createPrivateKey(privateKey)).export(
    {
      type: 'spki',
      format: 'der',
    }
  );
  if (
    !Buffer.from(certificatePublicKey).equals(Buffer.from(privatePublicKey))
  ) {
    throw new Error(`${label} does not match its certificate.`);
  }
};

const createLocalCa = async (notBeforeDate: Date) =>
  selfsigned.generate([{ name: 'commonName', value: 'SeerrNG Local CA' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate: addDays(notBeforeDate, LOCAL_CA_VALIDITY_DAYS),
    extensions: [
      {
        name: 'basicConstraints',
        cA: true,
        pathLenConstraint: 0,
        critical: true,
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        cRLSign: true,
        critical: true,
      },
    ],
  });

const createLocalServerCertificate = async (
  hosts: string[],
  ca: { key: string; cert: string },
  notBeforeDate: Date
) =>
  selfsigned.generate([{ name: 'commonName', value: hosts[0] }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    ca,
    notBeforeDate,
    notAfterDate: addDays(notBeforeDate, LOCAL_CERT_VALIDITY_DAYS),
    extensions: [
      {
        name: 'basicConstraints',
        cA: false,
        critical: true,
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
        critical: true,
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        critical: true,
      },
      {
        name: 'subjectAltName',
        altNames: hosts.map((host) =>
          isIP(host)
            ? { type: 7 as const, ip: host }
            : { type: 2 as const, value: host }
        ),
        critical: true,
      },
    ],
  });

const persistLocalTlsMaterial = async (
  paths: TlsMaterialPaths,
  material: LocalTlsMaterial,
  hosts: string[]
): Promise<void> => {
  await writePrivateTlsFile(paths.caKey, material.caKey);
  await writePrivateTlsFile(paths.caCertificate, material.caCertificate);
  await writePrivateTlsFile(paths.serverKey, material.serverKey);
  await writePrivateTlsFile(
    paths.serverCertificate,
    material.serverCertificate
  );
  await writePrivateTlsFile(
    paths.metadata,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hosts,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
};

const generateLocalTlsMaterial = async (
  paths: TlsMaterialPaths,
  hosts: string[]
): Promise<LocalTlsMaterial> => {
  const notBeforeDate = new Date(Date.now() - 5 * 60 * 1_000);
  const ca = await createLocalCa(notBeforeDate);
  const server = await createLocalServerCertificate(
    hosts,
    { key: ca.private, cert: ca.cert },
    notBeforeDate
  );
  const material = {
    caCertificate: ca.cert,
    caKey: ca.private,
    serverCertificate: server.cert,
    serverKey: server.private,
  };
  await persistLocalTlsMaterial(paths, material, hosts);
  return material;
};

const loadLocalTlsMaterial = async (
  paths: TlsMaterialPaths,
  hosts: string[]
): Promise<LocalTlsMaterial> => {
  await ensureTlsDirectory(paths.directory);
  const requiredPaths = [
    paths.caCertificate,
    paths.caKey,
    paths.serverCertificate,
    paths.serverKey,
  ];
  const present = await Promise.all(requiredPaths.map(isRecordFile));
  if (present.some(Boolean) && !present.every(Boolean)) {
    throw new Error(
      `The built-in TLS directory is incomplete. Remove the incomplete material from ${paths.directory} and restart SeerrNG.`
    );
  }

  if (!present.every(Boolean)) {
    return generateLocalTlsMaterial(paths, hosts);
  }

  const material = {
    caCertificate: await readPrivateTlsFile(paths.caCertificate),
    caKey: await readPrivateTlsFile(paths.caKey),
    serverCertificate: await readPrivateTlsFile(paths.serverCertificate),
    serverKey: await readPrivateTlsFile(paths.serverKey),
  };
  const caCertificate = new X509Certificate(material.caCertificate);
  const serverCertificate = new X509Certificate(material.serverCertificate);
  assertPrivateKeyMatchesCertificate(
    material.caKey,
    caCertificate,
    'The local CA key'
  );
  assertPrivateKeyMatchesCertificate(
    material.serverKey,
    serverCertificate,
    'The local server key'
  );
  if (
    !serverCertificate.checkIssued(caCertificate) ||
    !serverCertificate.verify(caCertificate.publicKey)
  ) {
    throw new Error(
      'The local server certificate is not issued by the local CA.'
    );
  }

  const now = Date.now();
  const caExpiresSoon =
    Date.parse(caCertificate.validTo) <= now + CERTIFICATE_RENEWAL_WINDOW_MS;
  if (caExpiresSoon) {
    return generateLocalTlsMaterial(paths, hosts);
  }

  const serverExpiresSoon =
    Date.parse(serverCertificate.validTo) <=
    now + CERTIFICATE_RENEWAL_WINDOW_MS;
  const configuredHostsChanged = !sameHosts(
    extractCertificateHosts(serverCertificate),
    hosts
  );
  if (serverExpiresSoon || configuredHostsChanged) {
    const notBeforeDate = new Date(Date.now() - 5 * 60 * 1_000);
    const server = await createLocalServerCertificate(
      hosts,
      { key: material.caKey, cert: material.caCertificate },
      notBeforeDate
    );
    const refreshed = {
      ...material,
      serverCertificate: server.cert,
      serverKey: server.private,
    };
    await writePrivateTlsFile(paths.serverKey, refreshed.serverKey);
    await writePrivateTlsFile(
      paths.serverCertificate,
      refreshed.serverCertificate
    );
    await writePrivateTlsFile(
      paths.metadata,
      `${JSON.stringify(
        { schemaVersion: 1, hosts, generatedAt: new Date().toISOString() },
        null,
        2
      )}\n`
    );
    return refreshed;
  }

  if (!(await isRecordFile(paths.metadata))) {
    await writePrivateTlsFile(
      paths.metadata,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          hosts: extractCertificateHosts(serverCertificate),
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
  }
  return material;
};

const getCertificateHosts = (certificate: string): string[] => {
  try {
    return extractCertificateHosts(new X509Certificate(certificate));
  } catch {
    return [];
  }
};

const setActiveRuntime = (
  runtime: TlsRuntimeInfo,
  caCertificate?: string
): void => {
  activeRuntime = runtime;
  activeCaCertificate = caCertificate;
};

export const initializeTls = async ({
  httpPort,
  httpsPort,
  tlsDirectory,
  environment = process.env,
}: {
  httpPort: number;
  httpsPort?: number;
  tlsDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<TlsConfiguration> => {
  const mode = parseTlsMode(environment.SEERR_TLS_MODE);
  const httpAuthAllowed = parseTlsBoolean(
    'SEERR_ALLOW_HTTP_AUTH',
    environment.SEERR_ALLOW_HTTP_AUTH
  );
  if (mode !== 'disabled' && httpAuthAllowed) {
    throw new Error(
      'SEERR_ALLOW_HTTP_AUTH cannot be enabled together with SEERR_TLS_MODE. Choose built-in HTTPS or the explicit insecure HTTP fallback.'
    );
  }

  if (mode === 'disabled') {
    const runtime: TlsRuntimeInfo = {
      mode,
      httpPort,
      httpsPort: null,
      httpAuthAllowed,
      redirectsHttpToHttps: false,
      hosts: [],
      caDownloadAvailable: false,
    };
    setActiveRuntime(runtime);
    return { mode, httpAuthAllowed, httpPort, hosts: [], runtime };
  }

  const configuredHttpsPort =
    httpsPort ??
    parseListenPort(
      environment.SEERR_HTTPS_PORT,
      'SEERR_HTTPS_PORT',
      DEFAULT_HTTPS_PORT
    );
  if (configuredHttpsPort === httpPort) {
    throw new Error(
      'SEERR_HTTPS_PORT must be different from PORT when built-in TLS is enabled.'
    );
  }

  if (mode === 'provided') {
    const certificatePath = environment.SEERR_TLS_CERT_FILE;
    const keyPath = environment.SEERR_TLS_KEY_FILE;
    if (!certificatePath || !keyPath) {
      throw new Error(
        'SEERR_TLS_CERT_FILE and SEERR_TLS_KEY_FILE are required when SEERR_TLS_MODE=provided.'
      );
    }
    const certificate = readProvidedTlsFile(
      certificatePath,
      'SEERR_TLS_CERT_FILE'
    );
    const key = readProvidedTlsFile(keyPath, 'SEERR_TLS_KEY_FILE');
    const ca = environment.SEERR_TLS_CA_FILE
      ? readProvidedTlsFile(environment.SEERR_TLS_CA_FILE, 'SEERR_TLS_CA_FILE')
      : undefined;
    createSecureContext({ key, cert: certificate, ...(ca ? { ca } : {}) });
    const x509 = new X509Certificate(certificate);
    assertPrivateKeyMatchesCertificate(key, x509, 'SEERR_TLS_KEY_FILE');
    const hosts = getCertificateHosts(certificate);
    if (hosts.length === 0) {
      throw new Error(
        'The provided TLS certificate must contain at least one DNS or IP subject alternative name.'
      );
    }
    const runtime: TlsRuntimeInfo = {
      mode,
      httpPort,
      httpsPort: configuredHttpsPort,
      httpAuthAllowed: false,
      redirectsHttpToHttps: true,
      hosts,
      fingerprint: x509.fingerprint256,
      caDownloadAvailable: false,
    };
    setActiveRuntime(runtime);
    return {
      mode,
      httpAuthAllowed: false,
      httpPort,
      httpsPort: configuredHttpsPort,
      hosts,
      httpsOptions: { key, cert: certificate, ...(ca ? { ca } : {}) },
      runtime,
    };
  }

  const hosts = parseTlsHosts(environment.SEERR_TLS_HOSTS);
  const paths = getTlsMaterialPaths(tlsDirectory);
  const material = await loadLocalTlsMaterial(paths, hosts);
  createSecureContext({
    key: material.serverKey,
    cert: material.serverCertificate,
  });
  const fingerprint = new X509Certificate(material.serverCertificate)
    .fingerprint256;
  const runtime: TlsRuntimeInfo = {
    mode,
    httpPort,
    httpsPort: configuredHttpsPort,
    httpAuthAllowed: false,
    redirectsHttpToHttps: true,
    hosts,
    fingerprint,
    caDownloadAvailable: true,
  };
  setActiveRuntime(runtime, material.caCertificate);
  return {
    mode,
    httpAuthAllowed: false,
    httpPort,
    httpsPort: configuredHttpsPort,
    hosts,
    httpsOptions: {
      key: material.serverKey,
      cert: material.serverCertificate,
    },
    runtime,
    caCertificatePath: paths.caCertificate,
  };
};

export const getTlsRuntimeInfo = (): TlsRuntimeInfo => ({
  ...activeRuntime,
  hosts: [...activeRuntime.hosts],
});

export const getTlsCaCertificate = (): string | undefined =>
  activeCaCertificate;

const parseRequestHost = (value: string | undefined): string | undefined => {
  if (!value || value.length > 255 || /[\s/\\]/u.test(value)) {
    return undefined;
  }
  let host = value;
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket < 0) return undefined;
    host = value.slice(1, closingBracket);
    const suffix = value.slice(closingBracket + 1);
    if (suffix && !/^:\d{1,5}$/u.test(suffix)) return undefined;
  } else if (value.includes(':')) {
    const separator = value.lastIndexOf(':');
    if (value.indexOf(':') !== separator) return undefined;
    const port = value.slice(separator + 1);
    if (!/^\d{1,5}$/u.test(port)) return undefined;
    host = value.slice(0, separator);
  }
  try {
    return normalizeTlsHost(host);
  } catch {
    return undefined;
  }
};

const formatUrlHost = (host: string): string =>
  isIP(host) === 6 ? `[${host}]` : host;

export const buildHttpsRedirectLocation = (
  request: Pick<IncomingMessage, 'headers' | 'url'>,
  httpsPort: number,
  allowedHosts: string[]
): string | undefined => {
  const host = parseRequestHost(request.headers.host);
  if (!host || !allowedHosts.includes(host)) {
    return undefined;
  }
  const requestUrl = request.url ?? '/';
  if (!requestUrl.startsWith('/') || requestUrl.startsWith('//')) {
    return undefined;
  }
  const target = new URL(`https://${formatUrlHost(host)}:${httpsPort}`);
  const pathAndQuery = new URL(requestUrl, target);
  target.pathname = pathAndQuery.pathname;
  target.search = pathAndQuery.search;
  return target.toString();
};

export const createHttpsRedirectHandler =
  (httpsPort: number, allowedHosts: string[]) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const location = buildHttpsRedirectLocation(req, httpsPort, allowedHosts);
    if (!location) {
      const message = 'The HTTP Host header is not an allowed TLS hostname.\n';
      res.writeHead(421, {
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(message),
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(message);
      return;
    }
    res.writeHead(308, {
      Location: location,
      'Cache-Control': 'no-store',
      'Content-Length': '0',
    });
    res.end();
  };

export const getTlsDefaultHttpsPort = (): number => DEFAULT_HTTPS_PORT;
