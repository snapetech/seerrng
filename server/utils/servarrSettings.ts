import type {
  BackIssueSettings,
  CollectorServiceSettings,
  DVRSettings,
  KapowarrSettings,
  LazyLibrarianSettings,
  LidarrSettings,
  MylarSettings,
  RadarrSettings,
  ReadarrSettings,
  SonarrSettings,
  SportarrSettings,
} from '@server/lib/settings';
import {
  normalizeServiceHostname,
  normalizeUrlBase,
} from '@server/utils/serviceUrl';
import {
  parseBoundedString,
  parseOptionalBoundedString,
  parseOptionalNonNegativeInteger,
} from '@server/utils/validation';
import { REDACTED_SECRET, isValidHttpUrl } from './security';

const MAX_SERVICE_STRING_LENGTH = 512;
const MAX_SERVICE_PATH_LENGTH = 4096;
const MAX_SERVICE_TAGS = 100;
const MAX_SERVICE_PORT = 65535;
const MAX_SERVICE_ID = 1_000_000;
export const MAX_SERVARR_INSTANCES_PER_TYPE = 50;

export const assertServarrInstanceCapacity = (
  current: readonly unknown[]
): void => {
  if (current.length >= MAX_SERVARR_INSTANCES_PER_TYPE) {
    throw Object.assign(
      new Error(
        `A maximum of ${MAX_SERVARR_INSTANCES_PER_TYPE} instances can be configured for each service type.`
      ),
      { status: 409 }
    );
  }
};

export type ServarrConnectionSettings = Pick<
  DVRSettings,
  'hostname' | 'port' | 'apiKey' | 'useSsl' | 'baseUrl'
> & { id?: number; serviceType?: ReadarrSettings['serviceType'] };

export const preserveServarrApiKey = <T extends { apiKey: string }>(
  body: unknown,
  current?: T
): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const incoming = body as Record<string, unknown>;
  return current && incoming.apiKey === REDACTED_SECRET
    ? { ...incoming, apiKey: current.apiKey }
    : body;
};

export const preserveServarrConnectionSecret = <
  T extends { id: number; apiKey: string },
>(
  body: unknown,
  currentSettings: T[]
): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const incoming = body as Record<string, unknown>;
  const id = parseOptionalNonNegativeInteger(incoming.id, MAX_SERVICE_ID);
  if (id === undefined) {
    return body;
  }

  const current = currentSettings.find((settings) => settings.id === id);
  return preserveServarrApiKey(body, current);
};

const parseNumberArray = (
  value: unknown,
  fieldName: string
): { value: number[] } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: [] };
  }

  if (!Array.isArray(value) || value.length > MAX_SERVICE_TAGS) {
    return { error: `${fieldName} is invalid.` };
  }

  const parsedValues = new Set<number>();

  for (const item of value) {
    const parsedValue =
      typeof item === 'number'
        ? item
        : typeof item === 'string' && item.trim() !== ''
          ? Number(item)
          : undefined;
    const parsed = parseOptionalNonNegativeInteger(parsedValue, MAX_SERVICE_ID);

    if (parsed === undefined) {
      return { error: `${fieldName} contains an invalid value.` };
    }

    parsedValues.add(parsed);
  }

  return { value: [...parsedValues] };
};

const parseRequiredServiceString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_SERVICE_STRING_LENGTH
): { value: string } | { error: string } =>
  parseBoundedString(value, { fieldName, maxLength });

const parseOptionalServiceString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_SERVICE_STRING_LENGTH
): { value: string | undefined } | { error: string } =>
  parseOptionalBoundedString(value, { fieldName, maxLength });

const parseOptionalExternalUrl = (
  value: unknown
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalServiceString(value, 'externalUrl');

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidHttpUrl(parsed.value)
    ? parsed
    : { error: 'externalUrl must be a valid HTTP URL.' };
};

const parseOptionalUrlBase = (
  value: unknown
): { value: string | undefined } | { error: string } => {
  const parsed = parseOptionalServiceString(value, 'baseUrl');

  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  const normalized = normalizeUrlBase(parsed.value);

  return normalized || !parsed.value.trim()
    ? { value: normalized || undefined }
    : { error: 'baseUrl must be a relative path.' };
};

const parseServiceBoolean = (
  value: unknown,
  fieldName: string
): { value: boolean } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: false };
  }

  return typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };
};

const parseOptionalServiceId = (
  value: unknown,
  fieldName: string
): { value: number | undefined } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  const parsed = parseOptionalNonNegativeInteger(value, MAX_SERVICE_ID);
  return parsed === undefined
    ? { error: `${fieldName} is invalid.` }
    : { value: parsed };
};

export const parseServarrConnectionSettings = (
  body: unknown
): { value: ServarrConnectionSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'settings must be an object.' };
  }

  const settings = body as Partial<DVRSettings> & {
    serviceType?: ReadarrSettings['serviceType'];
  };
  const hostname = parseRequiredServiceString(settings.hostname, 'hostname');
  if ('error' in hostname) return hostname;
  const normalizedHostname = normalizeServiceHostname(hostname.value);
  if (!normalizedHostname) {
    return { error: 'hostname is invalid.' };
  }

  const apiKey = parseRequiredServiceString(settings.apiKey, 'apiKey');
  if ('error' in apiKey) return apiKey;

  const port = parseOptionalNonNegativeInteger(settings.port, MAX_SERVICE_PORT);
  if (port === undefined || port < 1) {
    return { error: 'port is invalid.' };
  }

  const baseUrl = parseOptionalUrlBase(settings.baseUrl);
  if ('error' in baseUrl) return baseUrl;
  const useSsl = parseServiceBoolean(settings.useSsl, 'useSsl');
  if ('error' in useSsl) return useSsl;

  const serviceType =
    settings.serviceType === undefined ||
    settings.serviceType === 'ebook' ||
    settings.serviceType === 'audiobook'
      ? settings.serviceType
      : undefined;
  if (settings.serviceType !== undefined && serviceType === undefined) {
    return { error: 'serviceType must be ebook or audiobook.' };
  }

  return {
    value: {
      hostname: normalizedHostname,
      port,
      apiKey: apiKey.value,
      useSsl: useSsl.value,
      baseUrl: baseUrl.value,
      serviceType,
    },
  };
};

const parseDvrSettings = (
  body: unknown,
  current?: DVRSettings
): { value: DVRSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'settings must be an object.' };
  }

  const settings = body as Partial<DVRSettings>;
  const name = parseRequiredServiceString(settings.name, 'name');
  if ('error' in name) return name;

  const hostname = parseRequiredServiceString(settings.hostname, 'hostname');
  if ('error' in hostname) return hostname;
  const normalizedHostname = normalizeServiceHostname(hostname.value);
  if (!normalizedHostname) {
    return { error: 'hostname is invalid.' };
  }

  const apiKey = parseRequiredServiceString(settings.apiKey, 'apiKey');
  if ('error' in apiKey) return apiKey;

  const activeProfileName = parseRequiredServiceString(
    settings.activeProfileName,
    'activeProfileName'
  );
  if ('error' in activeProfileName) return activeProfileName;

  const activeDirectory = parseRequiredServiceString(
    settings.activeDirectory,
    'activeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeDirectory) return activeDirectory;

  const baseUrl = parseOptionalUrlBase(settings.baseUrl);
  if ('error' in baseUrl) return baseUrl;

  const externalUrl = parseOptionalExternalUrl(settings.externalUrl);
  if ('error' in externalUrl) return externalUrl;

  const tags = parseNumberArray(settings.tags, 'tags');
  if ('error' in tags) return tags;

  const overrideRule = parseNumberArray(settings.overrideRule, 'overrideRule');
  if ('error' in overrideRule) return overrideRule;

  const useSsl = parseServiceBoolean(settings.useSsl, 'useSsl');
  if ('error' in useSsl) return useSsl;
  const is4k = parseServiceBoolean(settings.is4k, 'is4k');
  if ('error' in is4k) return is4k;
  const isDefault = parseServiceBoolean(settings.isDefault, 'isDefault');
  if ('error' in isDefault) return isDefault;
  const syncEnabled = parseServiceBoolean(settings.syncEnabled, 'syncEnabled');
  if ('error' in syncEnabled) return syncEnabled;
  const preventSearch = parseServiceBoolean(
    settings.preventSearch,
    'preventSearch'
  );
  if ('error' in preventSearch) return preventSearch;
  const tagRequests = parseServiceBoolean(settings.tagRequests, 'tagRequests');
  if ('error' in tagRequests) return tagRequests;

  const port = parseOptionalNonNegativeInteger(settings.port, MAX_SERVICE_PORT);
  const activeProfileId = parseOptionalNonNegativeInteger(
    settings.activeProfileId,
    MAX_SERVICE_ID
  );

  if (port === undefined || port < 1) {
    return { error: 'port is invalid.' };
  }

  if (activeProfileId === undefined) {
    return { error: 'activeProfileId is invalid.' };
  }

  return {
    value: {
      id: current?.id ?? 0,
      name: name.value,
      hostname: normalizedHostname,
      port,
      apiKey: apiKey.value,
      useSsl: useSsl.value,
      baseUrl: baseUrl.value,
      activeProfileId,
      activeProfileName: activeProfileName.value,
      activeDirectory: activeDirectory.value,
      tags: tags.value,
      is4k: is4k.value,
      isDefault: isDefault.value,
      externalUrl: externalUrl.value,
      syncEnabled: syncEnabled.value,
      preventSearch: preventSearch.value,
      tagRequests: tagRequests.value,
      overrideRule: overrideRule.value,
    },
  };
};

export const parseRadarrSettings = (
  body: unknown,
  current?: RadarrSettings
): { value: RadarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<RadarrSettings>;

  const minimumAvailability = parseRequiredServiceString(
    settings.minimumAvailability,
    'minimumAvailability'
  );
  if ('error' in minimumAvailability) return minimumAvailability;

  return {
    value: {
      ...parsed.value,
      minimumAvailability: minimumAvailability.value,
    },
  };
};

export const parseSonarrSettings = (
  body: unknown,
  current?: SonarrSettings
): { value: SonarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<SonarrSettings>;

  const seriesTypes = ['standard', 'daily', 'anime'] as const;
  const seriesType =
    typeof settings.seriesType === 'string' &&
    seriesTypes.includes(settings.seriesType)
      ? settings.seriesType
      : undefined;
  const animeSeriesType =
    typeof settings.animeSeriesType === 'string' &&
    seriesTypes.includes(settings.animeSeriesType)
      ? settings.animeSeriesType
      : undefined;

  if (!seriesType || !animeSeriesType) {
    return { error: 'seriesType is invalid.' };
  }

  const activeAnimeProfileName = parseOptionalServiceString(
    settings.activeAnimeProfileName,
    'activeAnimeProfileName'
  );
  if ('error' in activeAnimeProfileName) return activeAnimeProfileName;

  const activeAnimeDirectory = parseOptionalServiceString(
    settings.activeAnimeDirectory,
    'activeAnimeDirectory',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in activeAnimeDirectory) return activeAnimeDirectory;

  const animeTags = parseNumberArray(settings.animeTags, 'animeTags');
  if ('error' in animeTags) return animeTags;
  const activeAnimeProfileId = parseOptionalServiceId(
    settings.activeAnimeProfileId,
    'activeAnimeProfileId'
  );
  if ('error' in activeAnimeProfileId) return activeAnimeProfileId;
  const activeAnimeLanguageProfileId = parseOptionalServiceId(
    settings.activeAnimeLanguageProfileId,
    'activeAnimeLanguageProfileId'
  );
  if ('error' in activeAnimeLanguageProfileId) {
    return activeAnimeLanguageProfileId;
  }
  const activeLanguageProfileId = parseOptionalServiceId(
    settings.activeLanguageProfileId,
    'activeLanguageProfileId'
  );
  if ('error' in activeLanguageProfileId) return activeLanguageProfileId;
  const enableSeasonFolders = parseServiceBoolean(
    settings.enableSeasonFolders,
    'enableSeasonFolders'
  );
  if ('error' in enableSeasonFolders) return enableSeasonFolders;

  const monitorNewItems =
    settings.monitorNewItems === 'all' || settings.monitorNewItems === 'none'
      ? settings.monitorNewItems
      : undefined;

  if (!monitorNewItems) {
    return { error: 'monitorNewItems is invalid.' };
  }

  return {
    value: {
      ...parsed.value,
      seriesType,
      animeSeriesType,
      activeAnimeProfileId: activeAnimeProfileId.value,
      activeAnimeProfileName: activeAnimeProfileName.value,
      activeAnimeDirectory: activeAnimeDirectory.value,
      activeAnimeLanguageProfileId: activeAnimeLanguageProfileId.value,
      activeLanguageProfileId: activeLanguageProfileId.value,
      animeTags: animeTags.value,
      enableSeasonFolders: enableSeasonFolders.value,
      monitorNewItems,
    },
  };
};

export const parseSportarrSettings = (
  body: unknown,
  current?: SportarrSettings
): { value: SportarrSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'settings must be an object.' };
  }

  const settings = body as Partial<SportarrSettings>;
  const connection = parseServarrConnectionSettings(body);
  if ('error' in connection) return connection;

  const name = parseRequiredServiceString(settings.name, 'name');
  if ('error' in name) return name;
  const activeProfileId = parseOptionalNonNegativeInteger(
    settings.activeProfileId,
    MAX_SERVICE_ID
  );
  if (activeProfileId === undefined || activeProfileId < 1) {
    return { error: 'activeProfileId is invalid.' };
  }
  const activeProfileName = parseRequiredServiceString(
    settings.activeProfileName,
    'activeProfileName'
  );
  if ('error' in activeProfileName) return activeProfileName;
  const isDefault = parseServiceBoolean(settings.isDefault, 'isDefault');
  if ('error' in isDefault) return isDefault;
  const externalUrl = parseOptionalExternalUrl(settings.externalUrl);
  if ('error' in externalUrl) return externalUrl;

  return {
    value: {
      id: current?.id ?? 0,
      name: name.value,
      ...connection.value,
      activeProfileId,
      activeProfileName: activeProfileName.value,
      isDefault: isDefault.value,
      externalUrl: externalUrl.value,
    },
  };
};

export const parseLidarrSettings = (
  body: unknown,
  current?: LidarrSettings
): { value: LidarrSettings } | { error: string } => {
  const parsed = parseDvrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<LidarrSettings>;

  const activeMetadataProfileName = parseOptionalServiceString(
    settings.activeMetadataProfileName,
    'activeMetadataProfileName'
  );
  if ('error' in activeMetadataProfileName) return activeMetadataProfileName;
  const activeMetadataProfileId = parseOptionalServiceId(
    settings.activeMetadataProfileId,
    'activeMetadataProfileId'
  );
  if ('error' in activeMetadataProfileId) return activeMetadataProfileId;

  return {
    value: {
      ...parsed.value,
      activeMetadataProfileId: activeMetadataProfileId.value,
      activeMetadataProfileName: activeMetadataProfileName.value,
    },
  };
};

export const parseReadarrSettings = (
  body: unknown,
  current?: ReadarrSettings
): { value: ReadarrSettings } | { error: string } => {
  const parsed = parseLidarrSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<ReadarrSettings>;

  const serviceType =
    settings.serviceType === 'ebook' || settings.serviceType === 'audiobook'
      ? settings.serviceType
      : undefined;

  if (!serviceType) {
    return { error: 'serviceType is invalid.' };
  }

  return {
    value: {
      ...parsed.value,
      serviceType,
    },
  };
};

const parseCollectorSettings = (
  body: unknown,
  current?: CollectorServiceSettings
): { value: CollectorServiceSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'settings must be an object.' };
  }

  const settings = body as Partial<CollectorServiceSettings>;
  const name = parseRequiredServiceString(settings.name, 'name');
  if ('error' in name) return name;

  const hostname = parseRequiredServiceString(settings.hostname, 'hostname');
  if ('error' in hostname) return hostname;
  const normalizedHostname = normalizeServiceHostname(hostname.value);
  if (!normalizedHostname) {
    return { error: 'hostname is invalid.' };
  }

  const apiKey = parseRequiredServiceString(settings.apiKey, 'apiKey');
  if ('error' in apiKey) return apiKey;

  const baseUrl = parseOptionalUrlBase(settings.baseUrl);
  if ('error' in baseUrl) return baseUrl;

  const externalUrl = parseOptionalExternalUrl(settings.externalUrl);
  if ('error' in externalUrl) return externalUrl;

  const tags = parseNumberArray(settings.tags, 'tags');
  if ('error' in tags) return tags;

  const useSsl = parseServiceBoolean(settings.useSsl, 'useSsl');
  if ('error' in useSsl) return useSsl;
  const isDefault = parseServiceBoolean(settings.isDefault, 'isDefault');
  if ('error' in isDefault) return isDefault;
  const syncEnabled = parseServiceBoolean(settings.syncEnabled, 'syncEnabled');
  if ('error' in syncEnabled) return syncEnabled;
  const preventSearch = parseServiceBoolean(
    settings.preventSearch,
    'preventSearch'
  );
  if ('error' in preventSearch) return preventSearch;

  const port = parseOptionalNonNegativeInteger(settings.port, MAX_SERVICE_PORT);
  if (port === undefined || port < 1) {
    return { error: 'port is invalid.' };
  }

  return {
    value: {
      id: current?.id ?? 0,
      name: name.value,
      hostname: normalizedHostname,
      port,
      apiKey: apiKey.value,
      useSsl: useSsl.value,
      baseUrl: baseUrl.value,
      isDefault: isDefault.value,
      externalUrl: externalUrl.value,
      tags: tags.value,
      syncEnabled: syncEnabled.value,
      preventSearch: preventSearch.value,
    },
  };
};

export const parseMylarSettings = (
  body: unknown,
  current?: MylarSettings
): { value: MylarSettings } | { error: string } => {
  const parsed = parseCollectorSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<MylarSettings>;

  const rootFolder = parseOptionalServiceString(
    settings.rootFolder,
    'rootFolder',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in rootFolder) return rootFolder;

  return { value: { ...parsed.value, rootFolder: rootFolder.value } };
};

export const parseKapowarrSettings = (
  body: unknown,
  current?: KapowarrSettings
): { value: KapowarrSettings } | { error: string } => {
  const parsed = parseCollectorSettings(body, current);
  if ('error' in parsed) return parsed;
  const settings = body as Partial<KapowarrSettings>;

  // Required, unlike Mylar's - dispatchComicRequest has no fallback and
  // throws a clear error at dispatch time if this is missing, but failing
  // fast here at save time is a better admin experience.
  const rootFolder = parseRequiredServiceString(
    settings.rootFolder,
    'rootFolder',
    MAX_SERVICE_PATH_LENGTH
  );
  if ('error' in rootFolder) return rootFolder;

  return { value: { ...parsed.value, rootFolder: rootFolder.value } };
};

export const parseBackIssueSettings = (
  body: unknown,
  current?: BackIssueSettings
): { value: BackIssueSettings } | { error: string } => {
  const parsed = parseCollectorSettings(body, current);
  return 'error' in parsed ? parsed : { value: parsed.value };
};

export const parseLazyLibrarianSettings = (
  body: unknown,
  current?: LazyLibrarianSettings
): { value: LazyLibrarianSettings } | { error: string } => {
  const parsed = parseCollectorSettings(body, current);
  return 'error' in parsed ? parsed : { value: parsed.value };
};
