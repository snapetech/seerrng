import { parseDownloadPathMappings } from '@server/lib/downloadPathMappings';
import type { AllSettings, NotificationAgentKey } from '@server/lib/settings';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuration required by integrations that make outbound requests.
 *
 * Falls back to reading from settings.json when SEERR_EXTERNAL_CONFIG is not set.
 * Secret managers can inject the JSON directly into SEERR_EXTERNAL_CONFIG.
 */
export type ExternalRuntimeConfig = Pick<
  AllSettings,
  | 'clientId'
  | 'vapidPublic'
  | 'vapidPrivate'
  | 'main'
  | 'plex'
  | 'jellyfin'
  | 'oidc'
  | 'tautulli'
  | 'radarr'
  | 'sonarr'
  | 'lidarr'
  | 'readarr'
  | 'mylar'
  | 'kapowarr'
  | 'lazylibrarian'
  | 'notifications'
  | 'network'
>;

const MAX_EXTERNAL_CONFIG_BYTES = 2 * 1024 * 1024;
let cachedSource: string | undefined;
let cachedConfig: ExternalRuntimeConfig | undefined;
type ExternalRuntimeConfigTestProvider = () => unknown;
const TEST_RUNTIME_CONFIG_SYMBOL = Symbol.for(
  'seerrng.test.externalRuntimeConfig'
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (
  value: unknown,
  name: string
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`SEERR_EXTERNAL_CONFIG.${name} must be an object`);
  }
  return value;
};

const normalizeServarrServices = (
  value: unknown,
  service: string
): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    throw new Error(`SEERR_EXTERNAL_CONFIG.${service} must be an array`);
  }

  return value.map((entry, index) => {
    const settings = assertRecord(entry, `${service}[${index}]`);
    if (
      settings.is4k !== undefined &&
      settings.is4k !== null &&
      typeof settings.is4k !== 'boolean'
    ) {
      throw new Error(
        `SEERR_EXTERNAL_CONFIG.${service}[${index}].is4k must be a boolean`
      );
    }

    return {
      ...settings,
      // Older settings files omitted this field or stored it as null. Both
      // representations mean the standard (non-4K) service.
      is4k: settings.is4k === true,
    };
  });
};

const validate = (value: unknown): ExternalRuntimeConfig => {
  const root = assertRecord(value, 'root');
  if (typeof root.clientId !== 'string' || root.clientId.length === 0) {
    throw new Error(
      'SEERR_EXTERNAL_CONFIG.clientId must be a non-empty string'
    );
  }
  for (const section of [
    'main',
    'plex',
    'jellyfin',
    'oidc',
    'tautulli',
    'notifications',
    'network',
  ]) {
    assertRecord(root[section], section);
  }
  const notifications = assertRecord(root.notifications, 'notifications');
  const main = assertRecord(root.main, 'main');
  assertRecord(notifications.agents, 'notifications.agents');
  return {
    ...root,
    main: {
      ...main,
      downloadPathMappings: parseDownloadPathMappings(
        main.downloadPathMappings
      ),
    },
    radarr: normalizeServarrServices(root.radarr, 'radarr'),
    sonarr: normalizeServarrServices(root.sonarr, 'sonarr'),
    lidarr: normalizeServarrServices(root.lidarr, 'lidarr'),
    readarr: normalizeServarrServices(root.readarr, 'readarr'),
    // Lenient unlike the four services above: SEERR_EXTERNAL_CONFIG is
    // hand-maintained by whoever sets it (or predates this feature), and
    // requiring these two new keys would break every existing config the
    // moment this shipped.
    mylar:
      root.mylar === undefined
        ? []
        : normalizeServarrServices(root.mylar, 'mylar'),
    kapowarr:
      root.kapowarr === undefined
        ? []
        : normalizeServarrServices(root.kapowarr, 'kapowarr'),
    lazylibrarian:
      root.lazylibrarian === undefined
        ? []
        : normalizeServarrServices(root.lazylibrarian, 'lazylibrarian'),
  } as unknown as ExternalRuntimeConfig;
};

const getTestProvider = (): ExternalRuntimeConfigTestProvider | undefined => {
  const provider = Reflect.get(globalThis, TEST_RUNTIME_CONFIG_SYMBOL);
  return typeof provider === 'function'
    ? (provider as ExternalRuntimeConfigTestProvider)
    : undefined;
};

const SETTINGS_PATH = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/settings.json`
  : path.join(__dirname, '../../config/settings.json');

const loadFromSettingsFile = (): ExternalRuntimeConfig | undefined => {
  try {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const settings = JSON.parse(content);
    return {
      clientId: settings.clientId,
      vapidPublic: settings.vapidPublic,
      vapidPrivate: settings.vapidPrivate,
      main: settings.main,
      plex: settings.plex,
      jellyfin: settings.jellyfin,
      oidc: settings.oidc ?? { providers: [] },
      tautulli: settings.tautulli,
      radarr: settings.radarr ?? [],
      sonarr: settings.sonarr ?? [],
      lidarr: settings.lidarr ?? [],
      readarr: settings.readarr ?? [],
      mylar: settings.mylar ?? [],
      kapowarr: settings.kapowarr ?? [],
      lazylibrarian: settings.lazylibrarian ?? [],
      notifications: settings.notifications,
      network: settings.network,
    };
  } catch {
    return undefined;
  }
};

export const loadExternalRuntimeConfig = (): ExternalRuntimeConfig => {
  const source = process.env.SEERR_EXTERNAL_CONFIG;
  if (!source) {
    const provider =
      process.env.NODE_ENV === 'test' ? getTestProvider() : undefined;
    if (provider) {
      return validate(provider());
    }
    const fileConfig = loadFromSettingsFile();
    if (fileConfig) {
      return validate(fileConfig);
    }
    throw new Error(
      'SEERR_EXTERNAL_CONFIG is required for outbound integrations. Run scripts/export-external-config.mjs to migrate existing settings.'
    );
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_EXTERNAL_CONFIG_BYTES) {
    throw new Error('SEERR_EXTERNAL_CONFIG exceeds the 2 MiB limit');
  }
  if (source === cachedSource && cachedConfig) {
    return cachedConfig;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('SEERR_EXTERNAL_CONFIG must contain valid JSON', {
      cause: error,
    });
  }

  cachedSource = source;
  cachedConfig = validate(parsed);
  return cachedConfig;
};

export const getExternalRuntimeConfig = loadExternalRuntimeConfig;

export const getExternalNotificationAgent = <Key extends NotificationAgentKey>(
  key: Key
): AllSettings['notifications']['agents'][Key] => {
  const agent = getExternalRuntimeConfig().notifications.agents[key];
  if (!agent) {
    throw new Error(
      `SEERR_EXTERNAL_CONFIG.notifications.agents.${key} is missing`
    );
  }
  return agent;
};
