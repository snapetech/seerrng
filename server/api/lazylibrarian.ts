import ExternalAPI from '@server/api/externalapi';
import type { LazyLibrarianSettings } from '@server/lib/settings';
import {
  MAX_SAFE_REMOTE_IMAGE_BYTES,
  normalizeSafeRasterImage,
  type SafeRemoteImage,
} from '@server/utils/safeRemoteImage';
import { buildServiceUrl } from '@server/utils/serviceUrl';

export interface LazyLibrarianMagazine {
  title: string;
  status?: string;
  issueStatus?: string;
  issueDate?: string;
  lastAcquired?: string;
  latestCover?: string;
}

export interface LazyLibrarianIssue {
  issueId?: string;
  title: string;
  issueDate?: string;
  issueFile?: string;
  cover?: string;
  issueNumber?: string;
}

export interface LazyLibrarianMagazineDetail {
  magazine?: LazyLibrarianMagazine;
  issues: LazyLibrarianIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readString = (
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.slice(0, 2048);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
};

const sanitizeMagazine = (
  value: unknown
): LazyLibrarianMagazine | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const title = readString(value, 'Title', 'title');
  if (!title) {
    return undefined;
  }
  return {
    title,
    status: readString(value, 'Status', 'status'),
    issueStatus: readString(value, 'IssueStatus', 'issueStatus'),
    issueDate: readString(value, 'IssueDate', 'issueDate'),
    lastAcquired: readString(value, 'LastAcquired', 'lastAcquired'),
    latestCover: readString(value, 'LatestCover', 'latestCover'),
  };
};

const sanitizeIssue = (value: unknown): LazyLibrarianIssue | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const title = readString(value, 'Title', 'title');
  if (!title) {
    return undefined;
  }
  return {
    issueId: readString(value, 'IssueID', 'IssueId', 'id'),
    title,
    issueDate: readString(value, 'IssueDate', 'issueDate'),
    issueFile: readString(value, 'IssueFile', 'issueFile'),
    cover: readString(value, 'Cover', 'cover'),
    issueNumber: readString(value, 'IssueNum', 'IssueNumber', 'issueNumber'),
  };
};

const assertApiResponse = (response: unknown, command: string): unknown => {
  if (isRecord(response) && response.Success === false) {
    const error = isRecord(response.Error)
      ? readString(response.Error, 'Message', 'message')
      : undefined;
    throw new Error(
      `LazyLibrarian command "${command}" failed${error ? `: ${error}` : '.'}`
    );
  }

  if (
    typeof response === 'string' &&
    /^(error|invalid api key|unknown api command|missing parameter|no search methods set)/i.test(
      response.trim()
    )
  ) {
    throw new Error(`LazyLibrarian command "${command}" failed: ${response}`);
  }
  if (isRecord(response) && response.Success === true && 'Data' in response) {
    return response.Data;
  }
  return response;
};

class LazyLibrarianAPI extends ExternalAPI {
  static buildUrl(
    settings: Pick<
      LazyLibrarianSettings,
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

  private readonly serviceUrl: string;
  private readonly apiKey: string;

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super(url, {}, { allowPrivateAddresses: true });
    this.serviceUrl = url;
    this.apiKey = apiKey;
  }

  private async runCommand<T>(
    command: string,
    params: Record<string, string | number | boolean> = {},
    ttl = 0
  ): Promise<T> {
    const response = await this.get<unknown>(
      '/api',
      {
        params: {
          apikey: this.apiKey,
          cmd: command,
          ...params,
        },
      },
      ttl
    );
    return assertApiResponse(response, command) as T;
  }

  public async getVersion(): Promise<string> {
    const response = await this.runCommand<unknown>('getVersion');
    if (typeof response === 'string') {
      return response.slice(0, 128);
    }
    if (isRecord(response)) {
      return (
        readString(response, 'current_version', 'currentVersion', 'version') ??
        'Connected'
      );
    }
    return 'Connected';
  }

  public async getMagazines(): Promise<LazyLibrarianMagazine[]> {
    const response = await this.runCommand<unknown>('getMagazines', {}, 60);
    return Array.isArray(response)
      ? response
          .map(sanitizeMagazine)
          .filter((magazine): magazine is LazyLibrarianMagazine => !!magazine)
      : [];
  }

  public async getIssues(title: string): Promise<LazyLibrarianMagazineDetail> {
    const response = await this.runCommand<unknown>('getIssues', {
      name: title,
    });
    if (!isRecord(response)) {
      return { issues: [] };
    }
    const magazineValue = Array.isArray(response.magazine)
      ? response.magazine[0]
      : response.magazine;
    return {
      magazine: sanitizeMagazine(magazineValue),
      issues: Array.isArray(response.issues)
        ? response.issues
            .map(sanitizeIssue)
            .filter((issue): issue is LazyLibrarianIssue => !!issue)
        : [],
    };
  }

  public async addMagazine(title: string): Promise<void> {
    await this.runCommand<unknown>('addMagazine', { name: title });
  }

  public async removeMagazine(title: string): Promise<void> {
    await this.runCommand<unknown>('removeMagazine', { name: title });
  }

  public async searchMagazine(title: string): Promise<void> {
    // LazyLibrarian accepts an optional title and scopes the search to that
    // magazine when it is already in its database.
    await this.runCommand<unknown>('forceMagSearch', { title });
  }

  public async scanMagazine(title?: string): Promise<void> {
    await this.runCommand<unknown>('forceMagazineScan', title ? { title } : {});
  }

  public async getMagazineCover(coverId: string): Promise<SafeRemoteImage> {
    if (!/^(?:[a-f\d]{32}|[a-f\d]{40})$/i.test(coverId)) {
      throw new Error('Magazine cover ID is invalid.');
    }

    const coverUrl = new URL(this.serviceUrl);
    coverUrl.pathname = `${coverUrl.pathname.replace(/\/+$/, '')}/cache/magazine/${coverId.toLowerCase()}.jpg`;
    coverUrl.search = '';
    coverUrl.hash = '';

    const response = await this.axios.get<ArrayBuffer>(coverUrl.href, {
      responseType: 'arraybuffer',
      maxContentLength: MAX_SAFE_REMOTE_IMAGE_BYTES,
      maxBodyLength: MAX_SAFE_REMOTE_IMAGE_BYTES,
      headers: { Accept: 'image/*' },
    });

    return normalizeSafeRasterImage(
      response.data,
      response.headers['content-type']
    );
  }
}

export default LazyLibrarianAPI;
