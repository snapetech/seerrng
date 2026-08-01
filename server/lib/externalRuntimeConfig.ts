import {
  getSettings,
  type AllSettings,
  type NotificationAgentKey,
} from '@server/lib/settings';

/**
 * Configuration required by integrations that make outbound requests.
 *
 * This deliberately has no file-backed fallback. Secret managers should
 * inject the JSON directly into SEERR_EXTERNAL_CONFIG.
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
  | 'notifications'
  | 'network'
>;

const MAX_EXTERNAL_CONFIG_BYTES = 2 * 1024 * 1024;
let cachedSource: string | undefined;
let cachedConfig: ExternalRuntimeConfig | undefined;

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
  for (const service of ['radarr', 'sonarr', 'lidarr', 'readarr']) {
    if (!Array.isArray(root[service])) {
      throw new Error(`SEERR_EXTERNAL_CONFIG.${service} must be an array`);
    }
  }

  const notifications = assertRecord(root.notifications, 'notifications');
  assertRecord(notifications.agents, 'notifications.agents');
  return value as ExternalRuntimeConfig;
};

const getTestRuntimeConfig = (): ExternalRuntimeConfig => {
  const settings = getSettings();

  return validate({
    clientId: settings.clientId,
    vapidPublic: settings.vapidPublic,
    vapidPrivate: settings.vapidPrivate,
    main: settings.main,
    plex: settings.plex,
    jellyfin: settings.jellyfin,
    oidc: settings.oidc,
    tautulli: settings.tautulli,
    radarr: settings.radarr,
    sonarr: settings.sonarr,
    lidarr: settings.lidarr,
    readarr: settings.readarr,
    notifications: settings.notifications,
    network: settings.network,
  });
};

export const loadExternalRuntimeConfig = (): ExternalRuntimeConfig => {
  const source = process.env.SEERR_EXTERNAL_CONFIG;
  if (!source) {
    if (process.env.NODE_ENV === 'test') {
      // Tests mutate the in-memory settings object to exercise integration
      // behavior. The adapter validates the same typed runtime shape used by
      // injected production configuration and is never available in a
      // production process.
      return getTestRuntimeConfig();
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
