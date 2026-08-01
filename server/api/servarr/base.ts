import ExternalAPI from '@server/api/externalapi';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager from '@server/lib/cache';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type { DVRSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { buildServiceUrl, trimTrailingSlashes } from '@server/utils/serviceUrl';

export interface SystemStatus {
  appName?: string;
  version: string;
  buildTime: Date;
  isDebug: boolean;
  isProduction: boolean;
  isAdmin: boolean;
  isUserInteractive: boolean;
  startupPath: string;
  appData: string;
  osName: string;
  osVersion: string;
  isNetCore: boolean;
  isMono: boolean;
  isLinux: boolean;
  isOsx: boolean;
  isWindows: boolean;
  isDocker: boolean;
  mode: string;
  branch: string;
  authentication: string;
  sqliteVersion: string;
  migrationVersion: number;
  urlBase: string;
  runtimeVersion: string;
  runtimeName: string;
  startTime: Date;
  packageUpdateMechanism: string;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace: number;
  totalSpace: number;
  accessible?: boolean;
  unmappedFolders: {
    name: string;
    path: string;
  }[];
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface QueueStatusMessage {
  title?: string;
  messages?: string[];
}

export interface QueueItem {
  size: number;
  title: string;
  sizeleft: number;
  timeleft: string;
  estimatedCompletionTime: string;
  status: string;
  trackedDownloadStatus: string;
  trackedDownloadState: string;
  downloadId: string;
  protocol: string;
  downloadClient: string;
  indexer: string;
  id: number;
  statusMessages?: QueueStatusMessage[];
}

export interface Tag {
  id: number;
  label: string;
}

interface QueueResponse<QueueItemAppendT> {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: (QueueItem & QueueItemAppendT)[];
}

export const MAX_SERVARR_CONFIGURATION_RESULTS = 1_000;
export const MAX_SERVARR_QUEUE_RESULTS = 10_000;
export const MAX_SERVARR_LIBRARY_RESULTS = 100_000;
export const MAX_SERVARR_LOOKUP_RESULTS = 1_000;
const MAX_SERVARR_TEXT_LENGTH = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedText = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_SERVARR_TEXT_LENGTH) : '';

export const sanitizeServarrSystemStatus = (
  value: unknown
): Pick<SystemStatus, 'appName' | 'version' | 'urlBase'> => {
  if (!isRecord(value)) {
    throw new Error('Servarr returned invalid system status');
  }
  const version = boundedText(value.version);
  if (!version) {
    throw new Error('Servarr returned invalid system status');
  }
  return {
    appName: boundedText(value.appName) || undefined,
    version,
    urlBase: boundedText(value.urlBase),
  };
};

export const sanitizeServarrRecordArray = <T>(
  value: unknown,
  maximum = MAX_SERVARR_LIBRARY_RESULTS
): T[] =>
  (Array.isArray(value) ? value : []).slice(0, maximum).filter(isRecord) as T[];

export const sanitizeServarrProfiles = (value: unknown): QualityProfile[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_SERVARR_CONFIGURATION_RESULTS)
    .flatMap((profile) => {
      if (!isRecord(profile) || !Number.isSafeInteger(profile.id)) {
        return [];
      }
      const name = boundedText(profile.name);
      return name ? [{ id: profile.id as number, name }] : [];
    });

export const sanitizeServarrRootFolders = (value: unknown): RootFolder[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_SERVARR_CONFIGURATION_RESULTS)
    .flatMap((folder) => {
      if (!isRecord(folder) || !Number.isSafeInteger(folder.id)) {
        return [];
      }
      const path = boundedText(folder.path);
      if (!path) {
        return [];
      }
      const finiteNumber = (number: unknown): number =>
        typeof number === 'number' && Number.isFinite(number) ? number : 0;
      return [
        {
          id: folder.id as number,
          path,
          freeSpace: finiteNumber(folder.freeSpace),
          totalSpace: finiteNumber(folder.totalSpace),
          accessible:
            typeof folder.accessible === 'boolean'
              ? folder.accessible
              : undefined,
          unmappedFolders: (Array.isArray(folder.unmappedFolders)
            ? folder.unmappedFolders
            : []
          )
            .slice(0, MAX_SERVARR_CONFIGURATION_RESULTS)
            .flatMap((unmapped) =>
              isRecord(unmapped)
                ? [
                    {
                      name: boundedText(unmapped.name),
                      path: boundedText(unmapped.path),
                    },
                  ]
                : []
            ),
        },
      ];
    });

export const sanitizeServarrTags = (value: unknown): Tag[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_SERVARR_CONFIGURATION_RESULTS)
    .flatMap((tag) => {
      if (!isRecord(tag) || !Number.isSafeInteger(tag.id)) {
        return [];
      }
      const label = boundedText(tag.label);
      return label ? [{ id: tag.id as number, label }] : [];
    });

export const sanitizeServarrQueue = <T>(value: unknown): T[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_SERVARR_QUEUE_RESULTS)
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const normalized = { ...item };
      for (const field of [
        'title',
        'timeleft',
        'estimatedCompletionTime',
        'status',
        'trackedDownloadStatus',
        'trackedDownloadState',
        'downloadId',
        'protocol',
        'downloadClient',
        'indexer',
      ]) {
        normalized[field] = boundedText(normalized[field]);
      }
      return [normalized as T];
    });

const EXTERNAL_READ_ONLY =
  process.env.SEERR_EXTERNAL_READ_ONLY?.toLowerCase() === 'true' ||
  process.env.SEERR_EXTERNAL_READ_ONLY === '1';

export const normalizeConfiguredServiceUrl = (
  value: string,
  apiName: string
) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error('Service URL must be HTTP or HTTPS.');
    }

    url.username = '';
    url.password = '';
    return trimTrailingSlashes(url.toString());
  } catch (e) {
    throw new Error(`[${apiName}] Invalid configured service URL`, {
      cause: e,
    });
  }
};

class ServarrBase<QueueItemAppendT> extends ExternalAPI {
  static buildUrl(
    settings: Pick<DVRSettings, 'useSsl' | 'hostname' | 'port' | 'baseUrl'>,
    path?: string
  ): string {
    return buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.port,
      urlBase: settings.baseUrl,
      path,
    });
  }

  protected apiName: string;

  constructor({
    url,
    apiKey,
    cacheName,
    apiName,
  }: {
    url: string;
    apiKey: string;
    cacheName: AvailableCacheIds;
    apiName: string;
  }) {
    const timeout = getExternalRuntimeConfig().network.apiRequestTimeout;
    const normalizedUrl = normalizeConfiguredServiceUrl(url, apiName);

    super(
      normalizedUrl,
      {
        apikey: apiKey,
      },
      {
        allowPrivateAddresses: true,
        nodeCache: cacheManager.getCache(cacheName).data,
        timeout,
      }
    );

    this.apiName = apiName;

    if (EXTERNAL_READ_ONLY) {
      this.axios.interceptors.request.use((config) => {
        const method = (config.method ?? 'get').toUpperCase();

        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          logger.warn('Blocked mutating Servarr request in read-only mode.', {
            label: this.apiName,
            method,
            url: config.url,
          });

          throw new Error(
            `[${this.apiName}] Mutating API request blocked by SEERR_EXTERNAL_READ_ONLY`
          );
        }

        return config;
      });
    }
  }

  public async getSystemStatus(): Promise<
    Pick<SystemStatus, 'appName' | 'version' | 'urlBase'>
  > {
    try {
      const response = await this.axios.get<unknown>('/system/status');

      return sanitizeServarrSystemStatus(response.data);
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve system status: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getProfiles(): Promise<QualityProfile[]> {
    try {
      const data = await this.getRolling<QualityProfile[]>(
        `/qualityProfile`,
        undefined,
        3600
      );

      return sanitizeServarrProfiles(data);
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve profiles: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getRootFolders(): Promise<RootFolder[]> {
    try {
      const data = await this.getRolling<RootFolder[]>(
        `/rootfolder`,
        undefined,
        3600
      );

      return sanitizeServarrRootFolders(data);
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve root folders: ${e.message}`,
        { cause: e }
      );
    }
  }

  public getQueue = async (): Promise<(QueueItem & QueueItemAppendT)[]> => {
    try {
      const response = await this.axios.get<QueueResponse<QueueItemAppendT>>(
        `/queue`,
        {
          params: {
            includeEpisode: true,
          },
        }
      );

      return sanitizeServarrQueue<QueueItem & QueueItemAppendT>(
        response.data?.records
      );
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve queue: ${e.message}`,
        { cause: e }
      );
    }
  };

  public deleteQueueItem = async (
    queueId: number,
    options: {
      removeFromClient?: boolean;
      blocklist?: boolean;
      skipRedownload?: boolean;
      changeCategory?: boolean;
    } = {}
  ): Promise<void> => {
    try {
      await this.axios.delete(`/queue/${queueId}`, {
        params: {
          removeFromClient: options.removeFromClient ?? true,
          blocklist: options.blocklist ?? true,
          skipRedownload: options.skipRedownload ?? false,
          changeCategory: options.changeCategory ?? false,
        },
      });
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to remove queue item ${queueId}: ${e.message}`,
        { cause: e }
      );
    }
  };

  public getTags = async (): Promise<Tag[]> => {
    try {
      const response = await this.axios.get<Tag[]>(`/tag`);

      return sanitizeServarrTags(response.data);
    } catch (e) {
      throw new Error(
        `[${this.apiName}] Failed to retrieve tags: ${e.message}`,
        { cause: e }
      );
    }
  };

  public createTag = async ({ label }: { label: string }): Promise<Tag> => {
    try {
      const response = await this.axios.post<Tag>(`/tag`, {
        label,
      });

      const tag = sanitizeServarrTags([response.data])[0];
      if (!tag) throw new Error('Servarr returned an invalid tag');
      return tag;
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to create tag: ${e.message}`, {
        cause: e,
      });
    }
  };

  public renameTag = async ({
    id,
    label,
  }: {
    id: number;
    label: string;
  }): Promise<Tag> => {
    try {
      const response = await this.axios.put<Tag>(`/tag/${id}`, {
        id,
        label,
      });

      const tag = sanitizeServarrTags([response.data])[0];
      if (!tag) throw new Error('Servarr returned an invalid tag');
      return tag;
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to rename tag: ${e.message}`, {
        cause: e,
      });
    }
  };

  async refreshMonitoredDownloads(): Promise<void> {
    if (EXTERNAL_READ_ONLY) {
      logger.debug('Skipping monitored download refresh in read-only mode.', {
        label: this.apiName,
      });

      return;
    }

    await this.runCommand('RefreshMonitoredDownloads', {});
  }

  protected async runCommand(
    commandName: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.axios.post(`/command`, {
        name: commandName,
        ...options,
      });
    } catch (e) {
      throw new Error(`[${this.apiName}] Failed to run command: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default ServarrBase;
