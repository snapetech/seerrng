import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI, {
  MAX_PLEX_SHARED_USERS,
  plexUserHasServerAccess,
} from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import {
  MAX_BLOCKLISTED_TAG_IDS,
  MAX_BLOCKLISTED_TAG_PAGES,
  MAX_TMDB_KEYWORD_ID,
} from '@server/constants/blocklist';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import type {
  PlexConnection,
  PlexDevice,
} from '@server/interfaces/api/plexInterfaces';
import type {
  LogMessage,
  LogsResultsResponse,
  SettingsAboutResponse,
} from '@server/interfaces/api/settingsInterfaces';
import scheduledJobLeaseManager from '@server/job/jobLease';
import {
  getScheduledJobLeaseName,
  isTrackedJobRunning,
  runTrackedJob,
  scheduledJobs,
} from '@server/job/schedule';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager, { isAvailableCacheId } from '@server/lib/cache';
import {
  runWithConfigurationAdmission,
  runWithConfigurationAdmissions,
} from '@server/lib/configurationAdmission';
import ImageProxy from '@server/lib/imageproxy';
import { assertNoSymlinkDirectoryComponents } from '@server/lib/pathSecurity';
import {
  MAX_PERMISSION_VALUE,
  Permission,
  isValidPermissionValue,
} from '@server/lib/permissions';
import { jellyfinFullScanner } from '@server/lib/scanners/jellyfin';
import { plexFullScanner } from '@server/lib/scanners/plex';
import type {
  JellyfinSettings,
  JobId,
  Library,
  MainSettings,
  NetworkSettings,
  PlexSettings,
  TautulliSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import {
  authorizedMutation,
  authorizedRouteAccess,
} from '@server/middleware/authorizedMutation';
import discoverSettingRoutes from '@server/routes/settings/discover';
import { ApiError } from '@server/types/error';
import { isAvailableLocale } from '@server/types/languages';
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion } from '@server/utils/appVersion';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { dnsCache } from '@server/utils/dnsCache';
import { getHostname } from '@server/utils/getHostname';
import { parsePageParams } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  REDACTED_SECRET,
  isValidApplicationUrl,
  isValidHttpUrl,
  preserveRedactedSecrets,
  redactSecrets,
} from '@server/utils/security';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import type { DnsEntries, DnsStats } from 'dns-caching';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, merge, omit, set, sortBy } from 'lodash';
import { rescheduleJob } from 'node-schedule';
import path from 'path';
import semver from 'semver';
import { URL } from 'url';
import lidarrRoutes from './lidarr';
import metadataRoutes from './metadata';
import notificationRoutes from './notifications';
import radarrRoutes from './radarr';
import readarrRoutes from './readarr';
import sonarrRoutes from './sonarr';

const settingsRoutes = Router();
settingsRoutes.use(authorizedRouteAccess(Permission.ADMIN));
const MAX_LOG_READ_BYTES = 2 * 1024 * 1024;
const MAX_LOG_LINE_BYTES = 64 * 1024;
const MAX_LOG_SEARCH_DEPTH = 8;
const MAX_LOG_SEARCH_VALUES = 500;
const MAX_LOG_SEARCH_LENGTH = 200;
const MAX_JOB_SCHEDULE_LENGTH = 100;
const MAX_LIBRARY_ENABLE_QUERY_LENGTH = 4096;
const MAX_SETTINGS_PATH_ID_LENGTH = 128;
const MAX_NETWORK_TIMEOUT_MS = 300_000;
const MAX_PROXY_STRING_LENGTH = 512;
const MAX_PROXY_BYPASS_LENGTH = 4096;
const MAX_PROXY_PORT = 65_535;
const MAX_DNS_CACHE_TTL = 86_400;
const MAX_MAIN_STRING_LENGTH = 512;
const MAX_BLOCKLISTED_TAGS_LENGTH = 4096;
const MAX_DEFAULT_QUOTA_VALUE = 10_000;
const MAX_PROVIDER_USER_ID = 1_000_000_000;
export const MAX_PLEX_SERVER_DEVICES = 100;
export const MAX_PLEX_CONNECTION_PROBES_PER_DEVICE = 20;
export const MAX_PLEX_CONNECTION_PROBES = 100;
export const PLEX_CONNECTION_PROBE_CONCURRENCY = 10;
const MAX_MEDIA_SERVER_STRING_LENGTH = 512;
const MAX_MEDIA_SERVER_PORT = 65_535;
const logFilters = ['debug', 'info', 'warn', 'error'] as const;

export const preparePlexServerDevices = (
  devices: PlexDevice[]
): PlexDevice[] => {
  const preparedDevices = devices
    .filter((device) => device.provides.includes('server') && device.owned)
    .slice(0, MAX_PLEX_SERVER_DEVICES)
    .map((device) => {
      const connections: PlexConnection[] = [];

      for (const rawConnection of device.connection ?? []) {
        if (connections.length >= MAX_PLEX_CONNECTION_PROBES_PER_DEVICE) {
          break;
        }

        const connection = { ...rawConnection };
        connections.push(connection);

        try {
          const url = new URL(connection.uri);
          if (
            url.hostname !== connection.address &&
            connections.length < MAX_PLEX_CONNECTION_PROBES_PER_DEVICE
          ) {
            connections.push({ ...connection, address: url.hostname });
            // Connect to IP addresses over HTTP while retaining the advertised
            // hostname as a separate TLS candidate.
            connection.protocol = 'http';
          }
        } catch {
          // The address/port candidate can still be probed without its URI.
        }
      }

      return { ...device, connection: connections };
    });

  const cappedDevices = preparedDevices.map((device) => ({
    ...device,
    connection: [] as PlexConnection[],
  }));
  let probeCount = 0;

  for (
    let connectionIndex = 0;
    connectionIndex < MAX_PLEX_CONNECTION_PROBES_PER_DEVICE &&
    probeCount < MAX_PLEX_CONNECTION_PROBES;
    connectionIndex += 1
  ) {
    for (
      let deviceIndex = 0;
      deviceIndex < preparedDevices.length;
      deviceIndex += 1
    ) {
      const connection =
        preparedDevices[deviceIndex].connection[connectionIndex];
      if (connection) {
        cappedDevices[deviceIndex].connection.push(connection);
        probeCount += 1;
      }
      if (probeCount >= MAX_PLEX_CONNECTION_PROBES) {
        break;
      }
    }
  }

  return cappedDevices;
};

const parseEnableList = (value: unknown) => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName: 'Enabled libraries',
    maxLength: MAX_LIBRARY_ENABLE_QUERY_LENGTH,
  });

  if ('error' in parsed) {
    return parsed;
  }

  return {
    value: parsed.value
      ? parsed.value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : [],
  };
};

const parseSettingsPathId = (value: unknown, fieldName: string) =>
  parseBoundedString(value, {
    fieldName,
    maxLength: MAX_SETTINGS_PATH_ID_LENGTH,
  });

const findScheduledJob = (value: unknown) => {
  const jobId = parseSettingsPathId(value, 'Job ID');
  if ('error' in jobId) {
    return undefined;
  }

  return scheduledJobs.find((job) => job.id === jobId.value);
};

const getScheduledJobResponse = (
  scheduledJob: (typeof scheduledJobs)[number],
  activeLeaseNames: ReadonlySet<string> = new Set()
) => ({
  id: scheduledJob.id,
  name: scheduledJob.name,
  type: scheduledJob.type,
  interval: scheduledJob.interval,
  cronSchedule: scheduledJob.cronSchedule,
  enabled: getSettings().jobs[scheduledJob.id]?.enabled !== false,
  nextExecutionTime: scheduledJob.job.nextInvocation(),
  running:
    isTrackedJobRunning(scheduledJob.name) ||
    (scheduledJob.running ? scheduledJob.running() : false) ||
    activeLeaseNames.has(getScheduledJobLeaseName(scheduledJob.name)),
});

const getActiveScheduledJobLeaseNames = async (
  jobs: readonly (typeof scheduledJobs)[number][]
): Promise<Set<string>> =>
  scheduledJobLeaseManager.getActiveLeaseNames(
    jobs
      .filter((job) => job.scope !== 'instance')
      .map((job) => getScheduledJobLeaseName(job.name))
  );

const isScheduledJobRunning = async (
  scheduledJob: (typeof scheduledJobs)[number]
): Promise<boolean> => {
  if (isTrackedJobRunning(scheduledJob.name) || scheduledJob.running?.()) {
    return true;
  }
  if (scheduledJob.scope === 'instance') {
    return false;
  }

  const activeLeaseNames = await getActiveScheduledJobLeaseNames([
    scheduledJob,
  ]);
  return activeLeaseNames.has(getScheduledJobLeaseName(scheduledJob.name));
};

const getScheduledJobResponseWithLease = async (
  scheduledJob: (typeof scheduledJobs)[number]
) =>
  getScheduledJobResponse(
    scheduledJob,
    await getActiveScheduledJobLeaseNames([scheduledJob])
  );

const parseSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Settings body must be an object.' };
  }

  return { value: body as Record<string, unknown> };
};

const parseOptionalSettingsBodyObject = (
  body: unknown
): { value: Record<string, unknown> } | { error: string } => {
  if (body === undefined || body === null) {
    return { value: {} };
  }

  return parseSettingsBodyObject(body);
};

const validateOptionalHttpUrl = (
  value: unknown,
  fieldName: string
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName,
    maxLength: 512,
  });

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidHttpUrl(parsed.value)
    ? parsed
    : { error: `${fieldName} must be a valid HTTP URL.` };
};

const validateOptionalApplicationUrl = (
  value: unknown
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName: 'applicationUrl',
    maxLength: 512,
  });

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  try {
    const url = new URL(parsed.value);
    if (url.username || url.password || url.search || url.hash) {
      return {
        error:
          'applicationUrl must not contain credentials, a query, or a fragment.',
      };
    }
  } catch {
    return { error: 'applicationUrl must be a valid HTTP URL.' };
  }

  return isValidApplicationUrl(parsed.value)
    ? parsed
    : { error: 'applicationUrl must be a valid HTTP URL.' };
};

const parseOptionalBooleanSetting = (
  value: unknown,
  fieldName: string
): { value: boolean | undefined } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  return typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };
};

const parsePatchBoundedString = (
  body: Record<string, unknown>,
  key: string,
  options: {
    fieldName: string;
    maxLength: number;
    allowEmpty?: boolean;
  }
): { value: string | undefined } | { error: string } => {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { value: undefined };
  }
  if (options.allowEmpty && (body[key] === null || body[key] === '')) {
    return { value: '' };
  }

  return parseBoundedString(body[key], {
    fieldName: options.fieldName,
    maxLength: options.maxLength,
    required: options.allowEmpty !== true,
  });
};

const getSettingsField = (
  body: Record<string, unknown>,
  key: string,
  current: unknown
): unknown =>
  Object.prototype.hasOwnProperty.call(body, key) ? body[key] : current;

const parseMediaServerHostname = (
  value: unknown,
  fieldName: string,
  required = true
): { value: string | undefined } | { error: string } => {
  const parsed = required
    ? parseBoundedString(value, {
        fieldName,
        maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
      })
    : parseOptionalBoundedString(value, {
        fieldName,
        maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
      });
  if ('error' in parsed) {
    return parsed;
  }
  if (parsed.value === undefined) {
    return { value: undefined };
  }

  const normalized = normalizeServiceHostname(parsed.value);
  return normalized
    ? { value: normalized }
    : { error: `${fieldName} must be a valid hostname or IP address.` };
};

const parseMediaServerPort = (
  value: unknown,
  fieldName: string,
  required = true
): { value: number | undefined } | { error: string } => {
  if (!required && (value === undefined || value === null || value === '')) {
    return { value: undefined };
  }

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_MEDIA_SERVER_PORT
    ? { value }
    : { error: `${fieldName} must be a valid port.` };
};

const parseMediaServerBoolean = (
  value: unknown,
  fieldName: string
): { value: boolean } | { error: string } =>
  typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };

const parseMediaServerUrlBase = (
  value: unknown,
  fieldName: string
): { value: string } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: '' };
  }

  const parsed = parseBoundedString(value, {
    fieldName,
    maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
    required: false,
  });
  if ('error' in parsed) {
    return parsed;
  }

  const normalized = normalizeUrlBase(parsed.value);
  return normalized
    ? { value: normalized }
    : { error: `${fieldName} must be a relative URL path.` };
};

const parseOptionalMediaServerHttpUrl = (
  value: unknown,
  fieldName: string
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalBoundedString(value, {
    fieldName,
    maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
  });
  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidHttpUrl(parsed.value)
    ? parsed
    : { error: `${fieldName} must be a valid HTTP URL.` };
};

export const parsePlexSettingsBody = (
  body: Record<string, unknown>,
  current: PlexSettings
): { value: PlexSettings } | { error: string } => {
  const webAppUrl = parseOptionalMediaServerHttpUrl(
    getSettingsField(body, 'webAppUrl', current.webAppUrl),
    'webAppUrl'
  );
  if ('error' in webAppUrl) return webAppUrl;
  const ip = parseMediaServerHostname(
    getSettingsField(body, 'ip', current.ip),
    'ip'
  );
  if ('error' in ip) return ip;
  const port = parseMediaServerPort(
    getSettingsField(body, 'port', current.port),
    'port'
  );
  if ('error' in port) return port;
  const useSsl = parseMediaServerBoolean(
    getSettingsField(body, 'useSsl', current.useSsl ?? false),
    'useSsl'
  );
  if ('error' in useSsl) return useSsl;

  return {
    value: {
      name: current.name,
      machineId: current.machineId,
      libraries: current.libraries,
      ip: ip.value!,
      port: port.value!,
      useSsl: useSsl.value,
      webAppUrl: webAppUrl.value ?? '',
    },
  };
};

export const parseJellyfinSettingsBody = (
  body: Record<string, unknown>,
  current: JellyfinSettings
): { value: JellyfinSettings } | { error: string } => {
  const externalHostname = parseOptionalMediaServerHttpUrl(
    getSettingsField(body, 'externalHostname', current.externalHostname),
    'externalHostname'
  );
  if ('error' in externalHostname) return externalHostname;
  const jellyfinForgotPasswordUrl = parseOptionalMediaServerHttpUrl(
    getSettingsField(
      body,
      'jellyfinForgotPasswordUrl',
      current.jellyfinForgotPasswordUrl
    ),
    'jellyfinForgotPasswordUrl'
  );
  if ('error' in jellyfinForgotPasswordUrl) {
    return jellyfinForgotPasswordUrl;
  }
  const ip = parseMediaServerHostname(
    getSettingsField(body, 'ip', current.ip),
    'ip'
  );
  if ('error' in ip) return ip;
  const port = parseMediaServerPort(
    getSettingsField(body, 'port', current.port),
    'port'
  );
  if ('error' in port) return port;
  const useSsl = parseMediaServerBoolean(
    getSettingsField(body, 'useSsl', current.useSsl ?? false),
    'useSsl'
  );
  if ('error' in useSsl) return useSsl;
  const urlBase = parseMediaServerUrlBase(
    getSettingsField(body, 'urlBase', current.urlBase),
    'urlBase'
  );
  if ('error' in urlBase) return urlBase;
  const apiKey = parseBoundedString(
    getSettingsField(body, 'apiKey', current.apiKey),
    {
      fieldName: 'apiKey',
      maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
    }
  );
  if ('error' in apiKey) return apiKey;

  return {
    value: {
      name: current.name,
      libraries: current.libraries,
      serverId: current.serverId,
      ip: ip.value!,
      port: port.value!,
      useSsl: useSsl.value,
      urlBase: urlBase.value,
      externalHostname: externalHostname.value ?? '',
      jellyfinForgotPasswordUrl: jellyfinForgotPasswordUrl.value ?? '',
      apiKey: apiKey.value,
    },
  };
};

export const parseTautulliSettingsBody = (
  body: Record<string, unknown>,
  current: TautulliSettings
): { value: TautulliSettings } | { error: string } => {
  const hostname = parseMediaServerHostname(
    getSettingsField(body, 'hostname', current.hostname),
    'hostname',
    false
  );
  if ('error' in hostname) return hostname;
  const port = parseMediaServerPort(
    getSettingsField(body, 'port', current.port),
    'port',
    hostname.value !== undefined
  );
  if ('error' in port) return port;
  const useSsl = parseMediaServerBoolean(
    getSettingsField(body, 'useSsl', current.useSsl ?? false),
    'useSsl'
  );
  if ('error' in useSsl) return useSsl;
  const urlBase = parseMediaServerUrlBase(
    getSettingsField(body, 'urlBase', current.urlBase),
    'urlBase'
  );
  if ('error' in urlBase) return urlBase;
  const externalUrl = parseOptionalMediaServerHttpUrl(
    getSettingsField(body, 'externalUrl', current.externalUrl),
    'externalUrl'
  );
  if ('error' in externalUrl) return externalUrl;
  const rawApiKey = getSettingsField(body, 'apiKey', current.apiKey);
  const apiKey = hostname.value
    ? parseBoundedString(rawApiKey, {
        fieldName: 'apiKey',
        maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
      })
    : parseOptionalBoundedString(rawApiKey, {
        fieldName: 'apiKey',
        maxLength: MAX_MEDIA_SERVER_STRING_LENGTH,
      });
  if ('error' in apiKey) return apiKey;

  return {
    value: {
      hostname: hostname.value ?? '',
      port: port.value,
      useSsl: useSsl.value,
      urlBase: urlBase.value,
      apiKey: apiKey.value ?? '',
      externalUrl: externalUrl.value ?? '',
    },
  };
};

const preserveConnectionApiKey = (
  body: Record<string, unknown>,
  currentApiKey: string | undefined
): Record<string, unknown> => ({
  ...body,
  ...(body.apiKey === REDACTED_SECRET ? { apiKey: currentApiKey } : {}),
});

const parseOptionalNetworkInteger = (
  value: unknown,
  fieldName: string,
  max: number,
  min = 0
): { value: number | undefined } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  return typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
    ? { error: `${fieldName} must be a valid number.` }
    : { value };
};

const parseNetworkSettingsBody = (
  body: Record<string, unknown>,
  current: NetworkSettings
): { value: Record<string, unknown> } | { error: string } => {
  const value: Record<string, unknown> = {};

  for (const [key, fieldName] of [
    ['csrfProtection', 'csrfProtection'],
    ['forceIpv4First', 'forceIpv4First'],
    ['trustProxy', 'trustProxy'],
  ] as const) {
    const parsed = parseOptionalBooleanSetting(body[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  if (body.apiRequestTimeout !== undefined) {
    const parsedTimeout = parseOptionalNetworkInteger(
      body.apiRequestTimeout,
      'apiRequestTimeout',
      MAX_NETWORK_TIMEOUT_MS
    );
    if ('error' in parsedTimeout) {
      return parsedTimeout;
    }
    value.apiRequestTimeout = parsedTimeout.value;
  }

  if (body.dnsCache !== undefined) {
    if (
      !body.dnsCache ||
      typeof body.dnsCache !== 'object' ||
      Array.isArray(body.dnsCache)
    ) {
      return { error: 'dnsCache must be an object.' };
    }

    const incomingDnsCache = body.dnsCache as Record<string, unknown>;
    const dnsCache: Record<string, unknown> = {};
    const enabled = parseOptionalBooleanSetting(
      incomingDnsCache.enabled,
      'dnsCache.enabled'
    );
    if ('error' in enabled) {
      return enabled;
    }
    dnsCache.enabled = enabled.value;

    for (const [key, fieldName, min] of [
      ['forceMinTtl', 'dnsCache.forceMinTtl', 0],
      ['forceMaxTtl', 'dnsCache.forceMaxTtl', -1],
    ] as const) {
      const parsed = parseOptionalNetworkInteger(
        incomingDnsCache[key],
        fieldName,
        MAX_DNS_CACHE_TTL,
        min
      );
      if ('error' in parsed) {
        return parsed;
      }
      dnsCache[key] = parsed.value;
    }

    value.dnsCache = dnsCache;
  }

  if (body.proxy !== undefined) {
    if (
      !body.proxy ||
      typeof body.proxy !== 'object' ||
      Array.isArray(body.proxy)
    ) {
      return { error: 'proxy must be an object.' };
    }

    const incomingProxy = body.proxy as Record<string, unknown>;
    const proxy: Record<string, unknown> = {};

    for (const [key, fieldName] of [
      ['enabled', 'proxy.enabled'],
      ['useSsl', 'proxy.useSsl'],
      ['bypassLocalAddresses', 'proxy.bypassLocalAddresses'],
    ] as const) {
      const parsed = parseOptionalBooleanSetting(incomingProxy[key], fieldName);
      if ('error' in parsed) {
        return parsed;
      }
      proxy[key] = parsed.value;
    }

    for (const [key, fieldName, maxLength] of [
      ['hostname', 'proxy.hostname', MAX_PROXY_STRING_LENGTH],
      ['user', 'proxy.user', MAX_PROXY_STRING_LENGTH],
      ['password', 'proxy.password', MAX_PROXY_STRING_LENGTH],
      ['bypassFilter', 'proxy.bypassFilter', MAX_PROXY_BYPASS_LENGTH],
    ] as const) {
      const parsed = parsePatchBoundedString(incomingProxy, key, {
        fieldName,
        maxLength,
        allowEmpty: true,
      });
      if ('error' in parsed) {
        return parsed;
      }
      if (parsed.value !== undefined) {
        proxy[key] = parsed.value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(incomingProxy, 'port')) {
      const port = parseOptionalNetworkInteger(
        incomingProxy.port,
        'proxy.port',
        MAX_PROXY_PORT
      );
      if ('error' in port) {
        return port;
      }
      proxy.port = port.value;
    }
    const effectiveProxy = merge({}, current.proxy, proxy);
    if (
      effectiveProxy.enabled === true &&
      (!effectiveProxy.hostname ||
        effectiveProxy.port === undefined ||
        effectiveProxy.port < 1)
    ) {
      return {
        error: 'proxy hostname and port are required when proxy is enabled.',
      };
    }
    value.proxy = proxy;
  }

  return { value };
};

const parseMainSettingsBody = (
  body: Record<string, unknown>
): { value: Record<string, unknown> } | { error: string } => {
  const value: Record<string, unknown> = {};

  for (const [key, fieldName] of [
    ['applicationTitle', 'applicationTitle'],
    ['locale', 'locale'],
  ] as const) {
    const parsed = parsePatchBoundedString(body, key, {
      fieldName,
      maxLength: MAX_MAIN_STRING_LENGTH,
    });
    if ('error' in parsed) {
      return parsed;
    }
    if (parsed.value !== undefined) {
      if (key === 'locale' && !isAvailableLocale(parsed.value)) {
        return { error: 'locale must be a supported locale.' };
      }
      value[key] = parsed.value;
    }
  }

  for (const [key, fieldName] of [
    ['discoverRegion', 'discoverRegion'],
    ['streamingRegion', 'streamingRegion'],
    ['originalLanguage', 'originalLanguage'],
    ['blocklistRegion', 'blocklistRegion'],
    ['blocklistLanguage', 'blocklistLanguage'],
  ] as const) {
    const parsed = parsePatchBoundedString(body, key, {
      fieldName,
      maxLength: MAX_MAIN_STRING_LENGTH,
      allowEmpty: true,
    });
    if ('error' in parsed) {
      return parsed;
    }
    if (parsed.value !== undefined) {
      value[key] = parsed.value;
    }
  }

  const blocklistedTags = parsePatchBoundedString(body, 'blocklistedTags', {
    fieldName: 'blocklistedTags',
    maxLength: MAX_BLOCKLISTED_TAGS_LENGTH,
    allowEmpty: true,
  });
  if ('error' in blocklistedTags) {
    return blocklistedTags;
  }
  if (blocklistedTags.value !== undefined) {
    const tags = blocklistedTags.value
      ? blocklistedTags.value.split(',').map((tag) => tag.trim())
      : [];
    if (
      tags.length > MAX_BLOCKLISTED_TAG_IDS ||
      tags.some(
        (tag) =>
          !/^\d+$/.test(tag) ||
          Number(tag) < 1 ||
          Number(tag) > MAX_TMDB_KEYWORD_ID
      )
    ) {
      return {
        error: `blocklistedTags must contain at most ${MAX_BLOCKLISTED_TAG_IDS} valid keyword IDs.`,
      };
    }
    value.blocklistedTags = [...new Set(tags)].join(',');
  }

  for (const [key, fieldName] of [
    ['hideAvailable', 'hideAvailable'],
    ['hideBlocklisted', 'hideBlocklisted'],
    ['localLogin', 'localLogin'],
    ['mediaServerLogin', 'mediaServerLogin'],
    ['oidcLogin', 'oidcLogin'],
    ['newPlexLogin', 'newPlexLogin'],
    ['partialRequestsEnabled', 'partialRequestsEnabled'],
    ['enableSpecialEpisodes', 'enableSpecialEpisodes'],
    ['cacheImages', 'cacheImages'],
  ] as const) {
    const parsed = parseOptionalBooleanSetting(body[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  for (const [key, fieldName, max] of [
    ['blocklistedTagsLimit', 'blocklistedTagsLimit', MAX_BLOCKLISTED_TAG_PAGES],
    ['defaultPermissions', 'defaultPermissions', MAX_PERMISSION_VALUE],
  ] as const) {
    const parsed = parseOptionalNetworkInteger(body[key], fieldName, max);
    if ('error' in parsed) {
      return parsed;
    }
    value[key] = parsed.value;
  }

  if (
    value.defaultPermissions !== undefined &&
    !isValidPermissionValue(value.defaultPermissions as number)
  ) {
    return { error: 'defaultPermissions must be valid.' };
  }

  if (body.mediaServerType !== undefined) {
    const parsed = parseOptionalNetworkInteger(
      body.mediaServerType,
      'mediaServerType',
      MediaServerType.NOT_CONFIGURED
    );
    if ('error' in parsed || parsed.value === undefined || parsed.value < 1) {
      return { error: 'mediaServerType must be valid.' };
    }
    value.mediaServerType = parsed.value;
  }

  if (body.defaultQuotas !== undefined) {
    if (
      !body.defaultQuotas ||
      typeof body.defaultQuotas !== 'object' ||
      Array.isArray(body.defaultQuotas)
    ) {
      return { error: 'defaultQuotas must be an object.' };
    }

    const incomingDefaultQuotas = body.defaultQuotas as Record<string, unknown>;
    const defaultQuotas: Record<string, unknown> = {};

    for (const mediaType of ['movie', 'tv', 'music', 'book'] as const) {
      if (incomingDefaultQuotas[mediaType] === undefined) {
        continue;
      }

      if (
        !incomingDefaultQuotas[mediaType] ||
        typeof incomingDefaultQuotas[mediaType] !== 'object' ||
        Array.isArray(incomingDefaultQuotas[mediaType])
      ) {
        return { error: `defaultQuotas.${mediaType} must be an object.` };
      }

      const incomingQuota = incomingDefaultQuotas[mediaType] as Record<
        string,
        unknown
      >;
      const quota: Record<string, unknown> = {};

      for (const [key, fieldName] of [
        ['quotaLimit', `defaultQuotas.${mediaType}.quotaLimit`],
        ['quotaDays', `defaultQuotas.${mediaType}.quotaDays`],
      ] as const) {
        const parsed = parseOptionalNetworkInteger(
          incomingQuota[key],
          fieldName,
          MAX_DEFAULT_QUOTA_VALUE
        );
        if ('error' in parsed) {
          return parsed;
        }
        quota[key] = parsed.value;
      }

      defaultQuotas[mediaType] = quota;
    }

    value.defaultQuotas = defaultQuotas;
  }

  for (const [key, fieldName] of [
    ['applicationUrl', 'applicationUrl'],
    ['youtubeUrl', 'youtubeUrl'],
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) {
      continue;
    }
    const parsed =
      key === 'applicationUrl'
        ? validateOptionalApplicationUrl(body[key])
        : validateOptionalHttpUrl(body[key], fieldName);
    if ('error' in parsed) {
      return parsed;
    }
    if (parsed.value?.endsWith('/')) {
      return { error: `${fieldName} must not end with a slash.` };
    }
    value[key] = parsed.value ?? '';
  }

  return { value };
};

export const readLogTail = async (
  logFile: string,
  maxBytes = MAX_LOG_READ_BYTES
): Promise<string> => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_LOG_READ_BYTES
  ) {
    throw new Error('Invalid log read limit.');
  }

  const directory = path.dirname(logFile);
  assertNoSymlinkDirectoryComponents(directory, { label: 'Log directory' });
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(
      logFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ELOOP') {
      throw error;
    }
    const target = await fs.promises.readlink(logFile);
    if (
      path.isAbsolute(target) ||
      path.basename(target) !== target ||
      target === '.' ||
      target === '..'
    ) {
      throw new Error('Log symlink must target a file in the log directory.');
    }
    const filePath = path.join(directory, target);
    handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error('Log path must resolve to one private regular file.');
    }

    const start = Math.max(stat.size - maxBytes, 0);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const content = buffer.subarray(0, bytesRead).toString('utf-8');

    if (start === 0) {
      return content;
    }

    const firstNewline = content.indexOf('\n');
    return firstNewline === -1 ? '' : content.slice(firstNewline + 1);
  } finally {
    await handle.close();
  }
};

export const deepLogValueStrings = (
  obj: Record<string, unknown>,
  maxDepth = MAX_LOG_SEARCH_DEPTH,
  maxValues = MAX_LOG_SEARCH_VALUES
): string[] => {
  const values: string[] = [];
  const stack: { value: unknown; depth: number }[] = [{ value: obj, depth: 0 }];

  while (stack.length && values.length < maxValues) {
    const item = stack.pop();
    if (!item) {
      break;
    }

    const { value, depth } = item;

    if (typeof value === 'string') {
      values.push(value);
      continue;
    }

    if (typeof value === 'number') {
      values.push(value.toString());
      continue;
    }

    if (!value || typeof value !== 'object' || depth >= maxDepth) {
      continue;
    }

    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      stack.push({ value: nestedValue, depth: depth + 1 });
    }
  }

  return values;
};

export const parseLogMessages = (
  logContent: string,
  filter: string[],
  searchRegexp?: RegExp
): LogMessage[] => {
  const logs: LogMessage[] = [];
  const logMessageProperties = [
    'timestamp',
    'level',
    'label',
    'message',
    'data',
  ];

  logContent.split('\n').forEach((line) => {
    if (!line.length || Buffer.byteLength(line, 'utf8') > MAX_LOG_LINE_BYTES) {
      return;
    }

    let logMessage: LogMessage & Record<string, unknown>;
    try {
      logMessage = JSON.parse(line);
    } catch {
      return;
    }

    if (
      !filter.includes(logMessage.level) ||
      typeof logMessage.message !== 'string'
    ) {
      return;
    }

    if (
      !Object.keys(logMessage).every((key) =>
        logMessageProperties.includes(key)
      )
    ) {
      Object.keys(logMessage)
        .filter((prop) => !logMessageProperties.includes(prop))
        .forEach((prop) => {
          set(logMessage, `data.${prop}`, logMessage[prop]);
        });
    }

    if (searchRegexp) {
      if (
        // label and data are sometimes undefined
        !searchRegexp.test(logMessage.label ?? '') &&
        !searchRegexp.test(logMessage.message) &&
        !deepLogValueStrings(logMessage.data ?? {}).some((val) =>
          searchRegexp.test(val)
        )
      ) {
        return;
      }
    }

    logs.push(redactSecrets(logMessage));
  });

  return logs;
};

settingsRoutes.use('/notifications', notificationRoutes);
settingsRoutes.use('/radarr', radarrRoutes);
settingsRoutes.use('/sonarr', sonarrRoutes);
settingsRoutes.use('/lidarr', lidarrRoutes);
settingsRoutes.use('/readarr', readarrRoutes);
settingsRoutes.use('/discover', discoverSettingRoutes);
settingsRoutes.use('/metadatas', metadataRoutes);

export const filteredMainSettings = (
  user: User,
  main: MainSettings
): Partial<MainSettings> => {
  if (!user?.hasPermission(Permission.ADMIN)) {
    return omit(main, 'apiKey');
  }

  return {
    ...redactSecrets(main),
    apiKey: main.apiKey,
  };
};

settingsRoutes.get('/main', (req, res, next) => {
  const settings = getSettings();

  if (!req.user) {
    return next({ status: 400, message: 'User missing from request.' });
  }

  res.status(200).json(filteredMainSettings(req.user, settings.main));
});

settingsRoutes.post(
  '/main',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const parsedMain = parseMainSettingsBody(parsedBody.value);
    if ('error' in parsedMain) {
      return res.status(400).json({ message: parsedMain.error });
    }

    const main = await runWithConfigurationAdmissions(
      ['jellyfin', 'oidc', 'plex'],
      () =>
        settings.persistSection('main', (current) =>
          merge({}, current, preserveRedactedSecrets(parsedMain.value, current))
        )
    );

    return res.status(200).json(filteredMainSettings(req.user!, main));
  })
);

settingsRoutes.get('/network', (req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.network));
});

settingsRoutes.post(
  '/network',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const parsedNetwork = parseNetworkSettingsBody(
      parsedBody.value,
      settings.network
    );
    if ('error' in parsedNetwork) {
      return res.status(400).json({ message: parsedNetwork.error });
    }

    const network = await settings.persistSection('network', (current) =>
      merge({}, current, preserveRedactedSecrets(parsedNetwork.value, current))
    );

    return res.status(200).json(redactSecrets(network));
  })
);

settingsRoutes.post(
  '/main/regenerate',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const settings = getSettings();

    const main = await settings.regenerateApiKey();

    if (!req.user) {
      return next({ status: 500, message: 'User missing from request.' });
    }

    return res.status(200).json(filteredMainSettings(req.user, main));
  })
);

settingsRoutes.get('/plex', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.plex));
});

settingsRoutes.post(
  '/plex',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }

    return runWithConfigurationAdmission('plex', async () => {
      const userRepository = getRepository(User);
      const settings = getSettings();
      const parsedPlex = parsePlexSettingsBody(parsedBody.value, settings.plex);
      if ('error' in parsedPlex) {
        return res.status(400).json({ message: parsedPlex.error });
      }

      try {
        const admin = await userRepository.findOneOrFail({
          select: { id: true, plexToken: true },
          where: { id: 1 },
        });

        const plexClient = new PlexAPI({
          plexToken: admin.plexToken,
          plexSettings: parsedPlex.value,
        });

        const result = await plexClient.getStatus();

        if (!result?.MediaContainer?.machineIdentifier) {
          throw new Error('Server not found');
        }

        await settings.persistSection('plex', (current) => ({
          ...parsedPlex.value,
          libraries: current.libraries,
          machineId: result.MediaContainer.machineIdentifier,
          name: result.MediaContainer.friendlyName,
        }));
      } catch (e) {
        logger.error('Something went wrong testing Plex connection', {
          label: 'API',
          errorMessage: e.message,
        });
        return next({
          status: 500,
          message: 'Unable to connect to Plex.',
        });
      }

      return res.status(200).json(redactSecrets(settings.plex));
    });
  })
);

settingsRoutes.get('/plex/devices/servers', async (req, res, next) => {
  const userRepository = getRepository(User);
  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexTvClient = admin.plexToken
      ? new PlexTvAPI(admin.plexToken)
      : null;
    const devices = preparePlexServerDevices(
      (await plexTvClient?.getDevices()) ?? []
    );
    const settings = getSettings();

    await mapWithConcurrency(
      devices.flatMap((device) => device.connection),
      PLEX_CONNECTION_PROBE_CONCURRENCY,
      async (connection) => {
        const plexDeviceSettings = {
          ...settings.plex,
          ip: connection.address,
          port: connection.port,
          useSsl: connection.protocol === 'https',
        };
        const plexClient = new PlexAPI({
          plexToken: admin.plexToken,
          plexSettings: plexDeviceSettings,
          timeout: 2500,
        });

        try {
          await plexClient.getStatus();
          connection.status = 200;
          connection.message = 'OK';
        } catch (e) {
          connection.status = 500;
          connection.message = e.message.split(':')[0];
        }
      }
    );
    return res.status(200).json(devices);
  } catch (e) {
    logger.error('Something went wrong retrieving Plex server list', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve Plex server list.',
    });
  }
});

settingsRoutes.get('/plex/library', (req, res) => {
  const settings = getSettings();
  if (req.query.sync !== undefined || req.query.enable !== undefined) {
    return res.status(400).json({
      message: 'Library synchronization and updates require POST.',
    });
  }

  return res.status(200).json(settings.plex.libraries);
});

settingsRoutes.post(
  '/plex/library',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const sync = parseOptionalBodyBoolean(parsedBody.value.sync, 'Sync');
    if ('error' in sync) {
      return res.status(400).json({ message: sync.error });
    }
    const enabledLibraries = parseEnableList(parsedBody.value.enable);
    if ('error' in enabledLibraries) {
      return res.status(400).json({ message: enabledLibraries.error });
    }

    return runWithConfigurationAdmission('plex', async () => {
      const settings = getSettings();
      if (sync.value) {
        const userRepository = getRepository(User);
        const admin = await userRepository.findOneOrFail({
          select: { id: true, plexToken: true },
          where: { id: 1 },
        });
        const plexapi = new PlexAPI({ plexToken: admin.plexToken });

        const libraries = await plexapi.syncLibraries({
          enabledLibraryIds: enabledLibraries.value,
        });
        return res.status(200).json(libraries);
      }

      const plex = await settings.persistSection('plex', (current) => ({
        ...current,
        libraries: current.libraries.map((library) => ({
          ...library,
          enabled: enabledLibraries.value.includes(library.id),
        })),
      }));
      return res.status(200).json(plex.libraries);
    });
  })
);

settingsRoutes.get('/plex/sync', (_req, res) => {
  return res.status(200).json(plexFullScanner.status());
});

settingsRoutes.post(
  '/plex/sync',
  authorizedMutation(Permission.ADMIN, (req, res) => {
    const parsedBody = parseOptionalSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const body = parsedBody.value;

    const cancel = parseOptionalBodyBoolean(body.cancel, 'Cancel');
    if ('error' in cancel) {
      return res.status(400).json({ message: cancel.error });
    }
    const start = parseOptionalBodyBoolean(body.start, 'Start');
    if ('error' in start) {
      return res.status(400).json({ message: start.error });
    }

    if (cancel.value) {
      plexFullScanner.cancel();
    } else if (start.value) {
      void runTrackedJob('Plex Full Library Scan', () => plexFullScanner.run());
    }
    return res.status(200).json(plexFullScanner.status());
  })
);

settingsRoutes.get('/jellyfin', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.jellyfin));
});

settingsRoutes.post(
  '/jellyfin',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }

    return runWithConfigurationAdmission('jellyfin', async () => {
      const userRepository = getRepository(User);
      const settings = getSettings();
      const preservedBody = preserveConnectionApiKey(
        parsedBody.value,
        settings.jellyfin.apiKey
      );
      const parsedJellyfin = parseJellyfinSettingsBody(
        preservedBody,
        settings.jellyfin
      );
      if ('error' in parsedJellyfin) {
        return res.status(400).json({ message: parsedJellyfin.error });
      }

      try {
        const admin = await userRepository.findOneOrFail({
          where: { id: 1 },
          select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
          order: { id: 'ASC' },
        });

        const jellyfinClient = new JellyfinAPI(
          getHostname(parsedJellyfin.value),
          parsedJellyfin.value.apiKey,
          admin.jellyfinDeviceId ?? ''
        );

        const result = await jellyfinClient.getSystemInfo();

        await settings.persistSection('jellyfin', (current) => ({
          ...parsedJellyfin.value,
          // A redacted API key means "keep the persisted value", not "keep
          // the value that happened to be loaded before the connection test".
          // Rebase it after the settings file is refreshed under its lock so
          // a concurrent rotation cannot be undone.
          apiKey:
            parsedBody.value.apiKey === REDACTED_SECRET
              ? current.apiKey
              : parsedJellyfin.value.apiKey,
          libraries: current.libraries,
          serverId: result.Id,
          name: result.ServerName,
        }));
      } catch (e) {
        if (e instanceof ApiError) {
          logger.error('Something went wrong testing Jellyfin connection', {
            label: 'API',
            status: e.statusCode,
            errorMessage: ApiErrorCode.InvalidUrl,
          });

          return next({
            status: e.statusCode,
            message: ApiErrorCode.InvalidUrl,
          });
        } else {
          logger.error('Something went wrong', {
            label: 'API',
            errorMessage: e.message,
          });

          return next({
            status: e.statusCode ?? 500,
            message: ApiErrorCode.Unknown,
          });
        }
      }

      return res.status(200).json(redactSecrets(settings.jellyfin));
    });
  })
);

settingsRoutes.get('/jellyfin/library', (req, res) => {
  const settings = getSettings();
  if (req.query.sync !== undefined || req.query.enable !== undefined) {
    return res.status(400).json({
      message: 'Library synchronization and updates require POST.',
    });
  }

  return res.status(200).json(settings.jellyfin.libraries);
});

settingsRoutes.post(
  '/jellyfin/library',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const sync = parseOptionalBodyBoolean(parsedBody.value.sync, 'Sync');
    if ('error' in sync) {
      return res.status(400).json({ message: sync.error });
    }
    const enabledLibraries = parseEnableList(parsedBody.value.enable);
    if ('error' in enabledLibraries) {
      return res.status(400).json({ message: enabledLibraries.error });
    }

    return runWithConfigurationAdmission('jellyfin', async () => {
      const settings = getSettings();
      let synchronizedLibraries: Library[] | undefined;

      if (sync.value) {
        const userRepository = getRepository(User);
        const admin = await userRepository.findOneOrFail({
          select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
          where: { id: 1 },
          order: { id: 'ASC' },
        });
        const jellyfinClient = new JellyfinAPI(
          getHostname(),
          settings.jellyfin.apiKey,
          admin.jellyfinDeviceId ?? ''
        );

        jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

        const libraries = await jellyfinClient.getLibraries();

        if (libraries.length === 0) {
          // Check if no libraries are found due to the fallback to user views
          // This only affects LDAP users
          const account = await jellyfinClient.getUser();

          // Automatic Library grouping is not supported when user views are used to get library
          if (account.Configuration.GroupedFolders?.length > 0) {
            return next({
              status: 501,
              message: ApiErrorCode.SyncErrorGroupedFolders,
            });
          }

          return next({
            status: 404,
            message: ApiErrorCode.SyncErrorNoLibraries,
          });
        }

        const newLibraries: Library[] = libraries.map((library) => {
          const existing = settings.jellyfin.libraries.find(
            (l) => l.id === library.key && l.name === library.title
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: library.type,
          };
        });

        synchronizedLibraries = newLibraries;
      }

      const jellyfin = await settings.persistSection('jellyfin', (current) => ({
        ...current,
        libraries: (synchronizedLibraries ?? current.libraries).map(
          (library) => ({
            ...library,
            enabled: enabledLibraries.value.includes(library.id),
          })
        ),
      }));
      return res.status(200).json(jellyfin.libraries);
    });
  })
);

settingsRoutes.get('/jellyfin/users', async (req, res) =>
  runWithConfigurationAdmission('jellyfin', async () => {
    const settings = getSettings();

    if (!settings.jellyfin.ip || !settings.jellyfin.apiKey) {
      return res.status(400).json({ message: 'Jellyfin is not configured.' });
    }

    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
      where: { id: 1 },
      order: { id: 'ASC' },
    });
    const jellyfinClient = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey,
      admin.jellyfinDeviceId ?? ''
    );

    jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
    const resp = await jellyfinClient.getUsers();
    const jellyfinUsers = resp.users.map((user) => ({
      username: user.Name,
      id: user.Id,
      thumb: `/avatarproxy/${user.Id}`,
      email: user.Name,
    }));

    return res.status(200).json(jellyfinUsers);
  })
);

settingsRoutes.get('/jellyfin/sync', (_req, res) => {
  return res.status(200).json(jellyfinFullScanner.status());
});

settingsRoutes.post(
  '/jellyfin/sync',
  authorizedMutation(Permission.ADMIN, (req, res) => {
    const parsedBody = parseOptionalSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    const body = parsedBody.value;

    const cancel = parseOptionalBodyBoolean(body.cancel, 'Cancel');
    if ('error' in cancel) {
      return res.status(400).json({ message: cancel.error });
    }
    const start = parseOptionalBodyBoolean(body.start, 'Start');
    if ('error' in start) {
      return res.status(400).json({ message: start.error });
    }

    if (cancel.value) {
      jellyfinFullScanner.cancel();
    } else if (start.value) {
      void runTrackedJob('Jellyfin Full Library Scan', () =>
        jellyfinFullScanner.run()
      );
    }
    return res.status(200).json(jellyfinFullScanner.status());
  })
);
settingsRoutes.get('/tautulli', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(redactSecrets(settings.tautulli));
});

settingsRoutes.post(
  '/tautulli',
  authorizedMutation(Permission.ADMIN, async (req, res, next) => {
    const parsedBody = parseSettingsBodyObject(req.body);
    if ('error' in parsedBody) {
      return res.status(400).json({ message: parsedBody.error });
    }
    return runWithConfigurationAdmission('tautulli', async () => {
      const settings = getSettings();
      const preservedBody = preserveConnectionApiKey(
        parsedBody.value,
        settings.tautulli.apiKey
      );
      const parsedTautulli = parseTautulliSettingsBody(
        preservedBody,
        settings.tautulli
      );
      if ('error' in parsedTautulli) {
        return res.status(400).json({ message: parsedTautulli.error });
      }

      if (parsedTautulli.value.hostname) {
        try {
          const tautulliClient = new TautulliAPI(parsedTautulli.value);
          const result = await tautulliClient.getInfo();
          if (
            !semver.gte(semver.coerce(result?.tautulli_version) ?? '', '2.9.0')
          ) {
            throw new Error('Tautulli version not supported');
          }
        } catch (e) {
          logger.error('Something went wrong testing Tautulli connection', {
            label: 'API',
            errorMessage: e.message,
          });
          return next({
            status: 500,
            message: 'Unable to connect to Tautulli.',
          });
        }
      }

      const tautulli = await settings.persistSection('tautulli', (current) => ({
        ...parsedTautulli.value,
        apiKey:
          parsedBody.value.apiKey === REDACTED_SECRET
            ? current.apiKey
            : parsedTautulli.value.apiKey,
      }));
      return res.status(200).json(redactSecrets(tautulli));
    });
  })
);

settingsRoutes.get(
  '/plex/users',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const qb = userRepository.createQueryBuilder('user');

    try {
      const admin = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });
      const machineId = getSettings().plex.machineId;
      const plexApi = new PlexTvAPI(admin.plexToken ?? '');
      const plexUsers = (await plexApi.getUsers()).MediaContainer.User.filter(
        (user) =>
          user.$.email && parsePositiveRouteId(user.$.id, MAX_PROVIDER_USER_ID)
      ).slice(0, MAX_PLEX_SHARED_USERS);

      const unimportedPlexUsers: {
        id: string;
        title: string;
        username: string;
        email: string;
        thumb: string;
      }[] = [];

      const plexIds = plexUsers.map((plexUser) => Number(plexUser.$.id));
      const plexEmails = plexUsers.map((plexUser) =>
        plexUser.$.email.toLowerCase()
      );
      if (!plexIds.length) plexIds.push(-1);
      if (!plexEmails.length) plexEmails.push('@');

      const existingUsers = await qb
        .where('user.plexId IN (:...plexIds)', { plexIds })
        .orWhere('user.email IN (:...plexEmails)', { plexEmails })
        .getMany();

      for (const plexUser of plexUsers) {
        const plexId = parsePositiveRouteId(plexUser.$.id);
        if (!plexId) {
          continue;
        }
        if (
          !existingUsers.find(
            (user) =>
              user.plexId === plexId ||
              user.email === plexUser.$.email.toLowerCase()
          ) &&
          plexUserHasServerAccess(plexUser, machineId)
        ) {
          unimportedPlexUsers.push(plexUser.$);
        }
      }

      return res.status(200).json(sortBy(unimportedPlexUsers, 'username'));
    } catch (e) {
      logger.error('Something went wrong getting unimported Plex users', {
        label: 'API',
        errorMessage: e.message,
      });
      next({
        status: 500,
        message: 'Unable to retrieve unimported Plex users.',
      });
    }
  }
);

settingsRoutes.get(
  '/logs',
  rateLimit({ windowMs: 60 * 1000, max: 50 }),
  async (req, res, next) => {
    const { pageSize, skip } = parsePageParams(req.query, {
      take: 25,
      maxTake: 100,
    });
    const parsedSearch = parseOptionalBoundedString(req.query.search, {
      fieldName: 'Search',
      maxLength: MAX_LOG_SEARCH_LENGTH,
    });
    if ('error' in parsedSearch) {
      return next({ status: 400, message: parsedSearch.error });
    }
    const parsedFilter = parseOptionalAllowedString(req.query.filter, {
      fieldName: 'Filter',
      allowedValues: logFilters,
      maxLength: 16,
    });
    if ('error' in parsedFilter) {
      return next({ status: 400, message: parsedFilter.error });
    }
    const search = parsedSearch.value ?? '';
    const searchRegexp = search
      ? new RegExp(escapeRegExp(search), 'i')
      : undefined;

    let filter: string[] = [];
    switch (parsedFilter.value) {
      case 'debug':
        filter.push('debug');
      // falls through
      case 'info':
        filter.push('info');
      // falls through
      case 'warn':
        filter.push('warn');
      // falls through
      case 'error':
        filter.push('error');
        break;
      default:
        filter = ['debug', 'info', 'warn', 'error'];
    }

    const logFile = process.env.CONFIG_DIRECTORY
      ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs.json`
      : path.join(__dirname, '../../../config/logs/.machinelogs.json');
    try {
      const logContent = await readLogTail(logFile);
      const logs = parseLogMessages(logContent, filter, searchRegexp);

      const displayedLogs = logs.reverse().slice(skip, skip + pageSize);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(logs.length / pageSize),
          pageSize,
          results: logs.length,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: displayedLogs,
      } as LogsResultsResponse);
    } catch (error) {
      logger.error('Something went wrong while retrieving logs', {
        label: 'Logs',
        errorMessage: error.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve logs.',
      });
    }
  }
);

settingsRoutes.get('/jobs', async (_req, res) => {
  const activeLeaseNames = await getActiveScheduledJobLeaseNames(scheduledJobs);
  return res
    .status(200)
    .json(
      scheduledJobs.map((job) => getScheduledJobResponse(job, activeLeaseNames))
    );
});

settingsRoutes.post<{ jobId: string }>(
  '/jobs/:jobId/run',
  authorizedMutation<{ jobId: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const scheduledJob = findScheduledJob(req.params.jobId);
      if (!scheduledJob) {
        return next({ status: 404, message: 'Job not found.' });
      }

      if (await isScheduledJobRunning(scheduledJob)) {
        return next({ status: 409, message: 'Job is already running.' });
      }

      scheduledJob.job.invoke();

      return res
        .status(200)
        .json(await getScheduledJobResponseWithLease(scheduledJob));
    }
  )
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/cancel',
  authorizedMutation<{ jobId: JobId }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const scheduledJob = findScheduledJob(req.params.jobId);
      if (!scheduledJob) {
        return next({ status: 404, message: 'Job not found.' });
      }

      const locallyRunning =
        isTrackedJobRunning(scheduledJob.name) || scheduledJob.running?.();
      if (!locallyRunning && (await isScheduledJobRunning(scheduledJob))) {
        return next({
          status: 409,
          message: 'Job is running on another instance.',
        });
      }

      if (scheduledJob.cancelFn) {
        scheduledJob.cancelFn();
      }

      return res
        .status(200)
        .json(await getScheduledJobResponseWithLease(scheduledJob));
    }
  )
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/schedule',
  authorizedMutation<{ jobId: JobId }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const scheduledJob = findScheduledJob(req.params.jobId);
      if (!scheduledJob) {
        return next({ status: 404, message: 'Job not found.' });
      }

      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        typeof (req.body as { schedule?: unknown }).schedule !== 'string' ||
        !(req.body as { schedule: string }).schedule.trim() ||
        (req.body as { schedule: string }).schedule.length >
          MAX_JOB_SCHEDULE_LENGTH
      ) {
        return next({ status: 400, message: 'Invalid job schedule.' });
      }

      const schedule = (req.body as { schedule: string }).schedule.trim();
      const previousSchedule = scheduledJob.cronSchedule;
      const result = rescheduleJob(scheduledJob.job, schedule);
      const settings = getSettings();

      if (result) {
        try {
          await settings.persistSection('jobs', (current) => ({
            ...current,
            [scheduledJob.id]: {
              ...current[scheduledJob.id],
              schedule,
            },
          }));
        } catch (error) {
          if (!rescheduleJob(scheduledJob.job, previousSchedule)) {
            logger.error('Failed to restore job schedule after save failure', {
              label: 'Jobs',
              jobId: scheduledJob.id,
              previousSchedule,
            });
          }
          throw error;
        }

        scheduledJob.cronSchedule = schedule;

        return res
          .status(200)
          .json(await getScheduledJobResponseWithLease(scheduledJob));
      } else {
        return next({ status: 400, message: 'Invalid job schedule.' });
      }
    }
  )
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/enabled',
  async (req, res, next) => {
    const scheduledJob = findScheduledJob(req.params.jobId);
    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next({ status: 400, message: 'Invalid job enabled setting.' });
    }

    const enabled = parseOptionalBodyBoolean(
      (req.body as { enabled?: unknown }).enabled,
      'Enabled'
    );
    if ('error' in enabled || enabled.value === undefined) {
      return next({ status: 400, message: 'Invalid job enabled setting.' });
    }

    const settings = getSettings();
    settings.jobs[scheduledJob.id].enabled = enabled.value;
    await settings.save();

    if (enabled.value) {
      const result = rescheduleJob(scheduledJob.job, scheduledJob.cronSchedule);
      if (!result) {
        return next({ status: 400, message: 'Invalid job schedule.' });
      }
    } else {
      scheduledJob.job.cancel();
    }

    return res.status(200).json(getScheduledJobResponse(scheduledJob));
  }
);

settingsRoutes.get('/cache', async (_req, res) => {
  const cacheManagerCaches = cacheManager.getAllCaches();

  const apiCaches = Object.values(cacheManagerCaches).map((cache) => ({
    id: cache.id,
    name: cache.name,
    stats: cache.getStats(),
  }));

  const tmdbImageCache = await ImageProxy.getImageStats('tmdb');
  const avatarImageCache = await ImageProxy.getImageStats('avatar');

  const stats: DnsStats | undefined = dnsCache?.getStats();
  const entries: DnsEntries | undefined = dnsCache?.getCacheEntries();

  return res.status(200).json({
    apiCaches,
    imageCache: {
      tmdb: tmdbImageCache,
      avatar: avatarImageCache,
    },
    dnsCache: {
      stats,
      entries,
    },
  });
});

settingsRoutes.post<{ cacheId: AvailableCacheIds }>(
  '/cache/:cacheId/flush',
  authorizedMutation<{ cacheId: AvailableCacheIds }>(
    Permission.ADMIN,
    (req, res, next) => {
      const cacheId = parseSettingsPathId(req.params.cacheId, 'Cache ID');
      if ('error' in cacheId) {
        return next({ status: 404, message: 'Cache not found.' });
      }

      if (!isAvailableCacheId(cacheId.value)) {
        return next({ status: 404, message: 'Cache not found.' });
      }

      const cache = cacheManager.getCache(cacheId.value);

      if (cache) {
        cache.flush();
        return res.status(204).send();
      }

      next({ status: 404, message: 'Cache not found.' });
    }
  )
);

settingsRoutes.post<{ dnsEntry: string }>(
  '/cache/dns/:dnsEntry/flush',
  authorizedMutation<{ dnsEntry: string }>(
    Permission.ADMIN,
    (req, res, next) => {
      const dnsEntry = parseSettingsPathId(
        req.params.dnsEntry,
        'DNS cache entry'
      );
      if ('error' in dnsEntry) {
        return next({ status: 404, message: 'Cache not found.' });
      }

      if (dnsCache) {
        dnsCache.clear(dnsEntry.value);
        return res.status(204).send();
      }

      next({ status: 404, message: 'Cache not found.' });
    }
  )
);

settingsRoutes.post(
  '/initialize',
  isAuthenticated(Permission.ADMIN),
  authorizedMutation(Permission.ADMIN, async (_req, res) => {
    const settings = getSettings();

    const publicSettings = await settings.persistSection(
      'public',
      (current) => ({ ...current, initialized: true })
    );

    return res.status(200).json(publicSettings);
  })
);

settingsRoutes.get('/about', async (req, res) => {
  const mediaRepository = getRepository(Media);
  const mediaRequestRepository = getRepository(MediaRequest);

  const totalMediaItems = await mediaRepository.count();
  const totalRequests = await mediaRequestRepository.count();

  return res.status(200).json({
    version: getAppVersion(),
    totalMediaItems,
    totalRequests,
    tz: process.env.TZ,
    appDataPath: appDataPath(),
  } as SettingsAboutResponse);
});

export default settingsRoutes;
