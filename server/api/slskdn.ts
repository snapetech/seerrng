import type { SlskdnSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';

/**
 * Client for slskdN's REST API (slskd-compatible `/api/v0` routes plus the
 * slskdN-native `/api/slskdn` routes). Every feature is probed separately so
 * plain slskd or slskr installs simply report it as unavailable.
 */

export interface SlskdnWishlistItem {
  id: string;
  searchText: string;
  filter?: string;
  enabled: boolean;
  autoDownload: boolean;
  lastSearchedAt?: string | null;
  lastMatchCount?: number;
  totalSearchCount?: number;
  totalDownloadCount?: number;
  maxDownloads?: number | null;
}

export type SlskdnIssueType =
  | 'SuspectedTranscode'
  | 'NonCanonicalVariant'
  | 'TrackNotInTaggedRelease'
  | 'MissingTrackInRelease'
  | 'CorruptedFile'
  | 'MissingMetadata'
  | 'MultipleVariants'
  | 'WrongDuration';

export interface SlskdnLibraryIssue {
  issueId: string;
  type: SlskdnIssueType | string;
  severity: string;
  status: string;
  filePath?: string;
  musicBrainzReleaseId?: string;
  artist?: string;
  album?: string;
  title?: string;
  reason?: string;
  canAutoFix?: boolean;
  suggestedAction?: string;
  remediationJobId?: string;
  detectedAt?: string;
}

export interface SlskdnSongIdAlbum {
  releaseId: string;
  title: string;
  artist: string;
  trackCount?: number;
  isExact?: boolean;
  identityScore?: number;
}

export interface SlskdnSongIdTrack {
  recordingId: string;
  title: string;
  artist: string;
  isExact?: boolean;
  searchText?: string;
  identityScore?: number;
}

export interface SlskdnSongIdRun {
  id: string;
  status: string;
  summary?: string;
  currentStage?: string;
  percentComplete?: number;
  queuePosition?: number | null;
  albums?: SlskdnSongIdAlbum[];
  tracks?: SlskdnSongIdTrack[];
}

export interface SlskdnFeatures {
  wishlist: boolean;
  libraryHealth: boolean;
  songId: boolean;
}

export class SlskdnError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'connection' | 'protocol' | 'unsupported'
  ) {
    super(message);
    this.name = 'SlskdnError';
  }
}

const REQUEST_CONFIG: AxiosRequestConfig = {
  timeout: 15_000,
  maxContentLength: 16 * 1024 * 1024,
  maxBodyLength: 256 * 1024,
  maxRedirects: 0,
  validateStatus: () => true,
};

export default class SlskdnAPI {
  constructor(private readonly settings: SlskdnSettings) {}

  private url(path: string): string {
    return buildServiceUrl({
      useSsl: this.settings.useSsl,
      hostname: this.settings.hostname,
      port: this.settings.port,
      urlBase: this.settings.baseUrl,
      path,
    });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    what: string,
    options: { data?: unknown; params?: Record<string, unknown> } = {}
  ): Promise<{ status: number; data: T }> {
    let response;
    try {
      response = await axios.request<T>({
        ...REQUEST_CONFIG,
        method,
        url: this.url(path),
        data: options.data,
        params: options.params,
        paramsSerializer: { indexes: null },
        headers: {
          'X-API-Key': this.settings.apiKey,
          Accept: 'application/json',
        },
      });
    } catch {
      throw new SlskdnError(
        'slskdN could not be reached. Check the hostname and port.',
        'connection'
      );
    }
    if (response.status === 401) {
      throw new SlskdnError('slskdN rejected the API key.', 'auth');
    }
    if (response.status === 403) {
      throw new SlskdnError(
        `The slskdN API key's role cannot use ${what}.`,
        'auth'
      );
    }
    return response;
  }

  private ok<T>(
    response: { status: number; data: T },
    what: string,
    accepted = [200]
  ): T {
    if (response.status === 404) {
      throw new SlskdnError(
        `This slskdN does not support ${what}.`,
        'unsupported'
      );
    }
    if (!accepted.includes(response.status)) {
      throw new SlskdnError(
        `slskdN ${what} returned HTTP ${response.status}.`,
        'protocol'
      );
    }
    return response.data;
  }

  public async getVersion(): Promise<string | undefined> {
    const response = await this.request<{
      version?: { full?: string; current?: string };
    }>('GET', '/api/v0/application', 'application status');
    const data = this.ok(response, 'application status');
    const version = data?.version?.full ?? data?.version?.current;
    return typeof version === 'string' ? version.slice(0, 64) : undefined;
  }

  /** Probes each optional feature; a 404 or 403 means unavailable. */
  public async getFeatures(): Promise<SlskdnFeatures> {
    const probe = async (path: string) => {
      try {
        const response = await this.request('GET', path, 'feature probe');
        return response.status >= 200 && response.status < 300;
      } catch (error) {
        if (error instanceof SlskdnError && error.kind === 'auth') {
          return false;
        }
        throw error;
      }
    };
    const [wishlist, libraryHealth, songId] = await Promise.all([
      probe('/api/v0/wishlist'),
      probe('/api/v0/library/health/summary'),
      probe('/api/v0/songid/capabilities'),
    ]);
    return { wishlist, libraryHealth, songId };
  }

  public async createWishlistItem(input: {
    searchText: string;
    filter?: string;
  }): Promise<SlskdnWishlistItem> {
    const response = await this.request<SlskdnWishlistItem>(
      'POST',
      '/api/v0/wishlist',
      'the wishlist',
      {
        data: {
          searchText: input.searchText,
          filter: input.filter ?? '',
          enabled: true,
          autoDownload: true,
          maxResults: 100,
          maxDownloads: 1,
        },
      }
    );
    const item = this.ok(response, 'the wishlist', [200, 201]);
    if (!item || typeof item.id !== 'string') {
      throw new SlskdnError(
        'slskdN returned an invalid wishlist item.',
        'protocol'
      );
    }
    return item;
  }

  public async getWishlistItem(
    id: string
  ): Promise<SlskdnWishlistItem | undefined> {
    const response = await this.request<SlskdnWishlistItem>(
      'GET',
      `/api/v0/wishlist/${encodeURIComponent(id)}`,
      'the wishlist'
    );
    if (response.status === 404) return undefined;
    return this.ok(response, 'the wishlist');
  }

  public async deleteWishlistItem(id: string): Promise<void> {
    const response = await this.request(
      'DELETE',
      `/api/v0/wishlist/${encodeURIComponent(id)}`,
      'the wishlist'
    );
    if (response.status === 404) return;
    this.ok(response, 'the wishlist', [200, 204]);
  }

  public async getLibraryIssues(filter: {
    musicBrainzReleaseId?: string;
    statuses?: string[];
    limit?: number;
  }): Promise<SlskdnLibraryIssue[]> {
    const response = await this.request<{ issues?: SlskdnLibraryIssue[] }>(
      'GET',
      '/api/v0/library/health/issues',
      'library health',
      {
        params: {
          musicBrainzReleaseId: filter.musicBrainzReleaseId,
          statuses: filter.statuses,
          limit: filter.limit ?? 200,
        },
      }
    );
    const data = this.ok(response, 'library health');
    return Array.isArray(data?.issues) ? data.issues : [];
  }

  public async remediateIssues(issueIds: string[]): Promise<string> {
    const response = await this.request<{ job_id?: string }>(
      'POST',
      '/api/slskdn/library/remediate',
      'library remediation',
      { data: { issue_ids: issueIds } }
    );
    const data = this.ok(response, 'library remediation');
    if (typeof data?.job_id !== 'string') {
      throw new SlskdnError(
        'slskdN did not return a remediation job.',
        'protocol'
      );
    }
    return data.job_id;
  }

  public async createSongIdRun(source: string): Promise<SlskdnSongIdRun> {
    const response = await this.request<SlskdnSongIdRun>(
      'POST',
      '/api/v0/songid/runs',
      'SongID',
      { data: { source } }
    );
    if (response.status === 400) {
      throw new SlskdnError(
        'slskdN could not analyze that source.',
        'protocol'
      );
    }
    return this.ok(response, 'SongID', [200, 201, 202]);
  }

  public async getSongIdRun(id: string): Promise<SlskdnSongIdRun | undefined> {
    const response = await this.request<SlskdnSongIdRun>(
      'GET',
      `/api/v0/songid/runs/${encodeURIComponent(id)}`,
      'SongID'
    );
    if (response.status === 404) return undefined;
    return this.ok(response, 'SongID');
  }
}
