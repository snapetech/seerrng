import ExternalAPI from '@server/api/externalapi';
import type { KapowarrSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import axios from 'axios';

export interface KapowarrVolume {
  id: number;
  comicvine_id: number;
  title: string;
  year?: number;
  publisher?: string;
  volume_number?: number;
  monitored: boolean;
  folder?: string;
  root_folder?: number;
  issue_count: number;
  issues_downloaded: number;
}

export interface KapowarrSystemAbout {
  version: string;
  database_version: number;
}

export interface KapowarrRootFolder {
  id: number;
  folder: string;
}

export interface KapowarrQueueItem {
  id: number;
  volumeId: number;
  title: string;
  size: number;
  status: string;
  progress: number;
  speed: number;
}

interface KapowarrEnvelope<T> {
  error: string | null;
  result: T;
}

// Confirmed live and from source (backend/base/custom_exceptions.py): Kapowarr
// refuses to delete a volume while it has a queued or running task (even a
// merely-queued, not-yet-running one), returning 400 with this error code
// rather than deleting anyway.
export class KapowarrTaskRunningError extends Error {
  constructor(public readonly volumeId: number) {
    super(`Kapowarr has a queued or running task for volume ${volumeId}.`);
    this.name = 'KapowarrTaskRunningError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedString = (value: unknown, maxLength = 512): string | undefined =>
  typeof value === 'string' && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;

const boundedInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const boundedNonNegativeNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const sanitizeVolume = (value: unknown): KapowarrVolume | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedInteger(value.id);
  const comicvineId = boundedInteger(value.comicvine_id);
  const title = boundedString(value.title, 1_000);
  if (id === undefined || comicvineId === undefined || !title) {
    return undefined;
  }

  return {
    id,
    comicvine_id: comicvineId,
    title,
    year: boundedInteger(value.year),
    publisher: boundedString(value.publisher),
    volume_number: boundedInteger(value.volume_number),
    monitored: value.monitored === true,
    folder: boundedString(value.folder, 2048),
    root_folder: boundedInteger(value.root_folder),
    issue_count: boundedInteger(value.issue_count) ?? 0,
    issues_downloaded: boundedInteger(value.issues_downloaded) ?? 0,
  };
};

const sanitizeRootFolder = (value: unknown): KapowarrRootFolder | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedInteger(value.id);
  const folder = boundedString(value.folder, 2048);
  return id !== undefined && folder ? { id, folder } : undefined;
};

const sanitizeQueueItem = (value: unknown): KapowarrQueueItem | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedInteger(value.id);
  const volumeId = boundedInteger(value.volume_id);
  if (id === undefined || volumeId === undefined) {
    return undefined;
  }
  return {
    id,
    volumeId,
    title: boundedString(value.title, 1_000) ?? '',
    size: boundedNonNegativeNumber(value.size) ?? 0,
    status: boundedString(value.status, 64) ?? 'queued',
    progress: boundedNonNegativeNumber(value.progress) ?? 0,
    speed: boundedNonNegativeNumber(value.speed) ?? 0,
  };
};

class KapowarrAPI extends ExternalAPI {
  static buildUrl(
    settings: Pick<
      KapowarrSettings,
      'useSsl' | 'hostname' | 'port' | 'baseUrl'
    >,
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

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super(url, { api_key: apiKey }, { allowPrivateAddresses: true });
  }

  public async getSystemAbout(): Promise<KapowarrSystemAbout> {
    const response = await this.get<KapowarrEnvelope<unknown>>(
      '/api/system/about',
      {},
      0
    );
    if (!isRecord(response) || !isRecord(response.result)) {
      throw new Error('Kapowarr returned an invalid /system/about response.');
    }
    const version = boundedString(response.result.version, 64);
    if (!version) {
      throw new Error('Kapowarr /system/about response is missing a version.');
    }
    return {
      version,
      database_version: boundedInteger(response.result.database_version) ?? 0,
    };
  }

  public async getVolumes(): Promise<KapowarrVolume[]> {
    const response = await this.get<KapowarrEnvelope<unknown>>(
      '/api/volumes',
      {},
      300
    );
    if (!isRecord(response) || !Array.isArray(response.result)) {
      return [];
    }
    return response.result
      .map(sanitizeVolume)
      .filter((volume): volume is KapowarrVolume => !!volume);
  }

  public async getVolume(id: number): Promise<KapowarrVolume | undefined> {
    const response = await this.get<KapowarrEnvelope<unknown>>(
      `/api/volumes/${id}`,
      {},
      0
    );
    return isRecord(response) ? sanitizeVolume(response.result) : undefined;
  }

  public async getRootFolders(): Promise<KapowarrRootFolder[]> {
    const response = await this.get<KapowarrEnvelope<unknown>>(
      '/api/rootfolder',
      {},
      300
    );
    if (!isRecord(response) || !Array.isArray(response.result)) {
      return [];
    }
    return response.result
      .map(sanitizeRootFolder)
      .filter((folder): folder is KapowarrRootFolder => !!folder);
  }

  public async resolveRootFolderId(path: string): Promise<number> {
    const existing = await this.getRootFolders();
    const match = existing.find((folder) => folder.folder === path);
    if (match) {
      return match.id;
    }

    const response = await this.post<KapowarrEnvelope<unknown>>(
      '/api/rootfolder',
      {
        folder: path,
      }
    );
    const created = isRecord(response)
      ? sanitizeRootFolder(response.result)
      : undefined;
    if (!created) {
      throw new Error(`Kapowarr could not create root folder "${path}".`);
    }
    return created.id;
  }

  public async addVolume({
    comicVineId,
    rootFolderId,
    monitored = true,
  }: {
    comicVineId: number;
    rootFolderId: number;
    monitored?: boolean;
  }): Promise<KapowarrVolume> {
    let response: KapowarrEnvelope<unknown>;
    try {
      response = await this.post<KapowarrEnvelope<unknown>>('/api/volumes', {
        comicvine_id: comicVineId,
        root_folder_id: rootFolderId,
        monitor: monitored,
        auto_search: true,
      });
    } catch (error) {
      // A client-side timeout doesn't mean Kapowarr's own add (folder
      // creation + full ComicVine issue fetch) didn't complete server-side -
      // confirmed live: a 10s-timed-out add showed up in Kapowarr's library
      // moments later. A bare retry would then hit this same
      // VolumeAlreadyAdded response, so treat it as success and fetch the
      // volume that's already there instead of failing the request.
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 400 &&
        isRecord(error.response.data) &&
        error.response.data.error === 'VolumeAlreadyAdded'
      ) {
        const existingId = boundedInteger(
          isRecord(error.response.data.result)
            ? error.response.data.result.volume_id
            : undefined
        );
        const existing =
          existingId !== undefined
            ? await this.getVolume(existingId)
            : undefined;
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    const volume = isRecord(response)
      ? sanitizeVolume(response.result)
      : undefined;
    if (!volume) {
      throw new Error('Kapowarr did not return the created volume.');
    }
    return volume;
  }

  // Confirmed live against a running Kapowarr instance: DELETE /volumes/<id>
  // takes delete_folder as the literal string "true"/"false", not a JSON
  // boolean (confirmed from source's extract_key parsing).
  public async removeVolume(id: number, deleteFolder = false): Promise<void> {
    try {
      await this.request('DELETE', `/api/volumes/${id}`, undefined, {
        params: { delete_folder: deleteFolder ? 'true' : 'false' },
      });
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        error.response?.status === 400 &&
        isRecord(error.response.data) &&
        error.response.data.error === 'TaskForVolumeRunning'
      ) {
        throw new KapowarrTaskRunningError(id);
      }
      throw error;
    }
  }

  // Confirmed live and from source (frontend/api.py's api_downloads /
  // api_delete_download): unlike Radarr/Sonarr/Lidarr, Kapowarr's queue
  // delete takes a JSON body ({"blocklist": bool}), not a query param.
  public async getQueue(): Promise<KapowarrQueueItem[]> {
    const response = await this.get<KapowarrEnvelope<unknown>>(
      '/api/activity/queue',
      {},
      0
    );
    if (!isRecord(response) || !Array.isArray(response.result)) {
      return [];
    }
    return response.result
      .map(sanitizeQueueItem)
      .filter((item): item is KapowarrQueueItem => !!item);
  }

  public async removeQueueItem(
    downloadId: number,
    blocklist = false
  ): Promise<void> {
    await this.request('DELETE', `/api/activity/queue/${downloadId}`, {
      blocklist,
    });
  }
}

export default KapowarrAPI;
