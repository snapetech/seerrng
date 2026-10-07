import type { ReadMeABookSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import axios, { type AxiosRequestConfig } from 'axios';

const REQUEST_CONFIG: AxiosRequestConfig = {
  timeout: 15_000,
  maxContentLength: 4 * 1024 * 1024,
  maxBodyLength: 64 * 1024,
  maxRedirects: 0,
  validateStatus: () => true,
};

export class ReadMeABookError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ReadMeABookError';
  }
}

export default class ReadMeABookAPI {
  constructor(private readonly settings: ReadMeABookSettings) {}

  private url(path: string): string {
    return buildServiceUrl({
      useSsl: this.settings.useSsl,
      hostname: this.settings.hostname,
      port: this.settings.port,
      urlBase: this.settings.baseUrl,
      path: `/api${path}`,
    });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown
  ): Promise<T> {
    let response;
    try {
      response = await axios.request<T>({
        ...REQUEST_CONFIG,
        method,
        url: this.url(path),
        ...(data === undefined ? {} : { data }),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.settings.apiKey}`,
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
      });
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? 502)
        : 502;
      throw new ReadMeABookError('ReadMeABook could not be reached.', status);
    }

    if (response.status < 200 || response.status >= 300) {
      const payload = response.data as Record<string, unknown> | undefined;
      const code =
        payload && typeof payload.error === 'string'
          ? payload.error
          : payload && typeof payload.code === 'string'
            ? payload.code
            : undefined;
      const message =
        code === 'AlreadyAvailable'
          ? 'This audiobook is already available.'
          : code === 'BeingProcessed'
            ? 'This audiobook is already being processed.'
            : code === 'DuplicateRequest'
              ? 'This audiobook has already been requested.'
              : response.status === 401 || response.status === 403
                ? 'ReadMeABook rejected the configured API token.'
                : `ReadMeABook returned HTTP ${response.status}.`;
      throw new ReadMeABookError(message, response.status, code);
    }
    return response.data;
  }

  public search(query: string): Promise<unknown> {
    const params = new URLSearchParams({ query: query.trim() });
    return this.request('GET', `/audiobooks/search?${params.toString()}`);
  }

  public getPopularAudiobooks(): Promise<unknown> {
    return this.request('GET', '/audiobooks/popular?page=1&limit=20');
  }

  public getNewReleases(): Promise<unknown> {
    return this.request('GET', '/audiobooks/new-releases?page=1&limit=20');
  }

  public createRequest(audiobook: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/requests', { audiobook });
  }

  public getRequest(id: string): Promise<unknown> {
    return this.request('GET', `/requests/${encodeURIComponent(id)}`);
  }

  public listRequests(): Promise<unknown> {
    return this.request('GET', '/requests');
  }

  public getAdminDashboard(): Promise<{
    metrics: unknown;
    activeDownloads: unknown;
    recentRequests: unknown;
  }> {
    return Promise.all([
      this.request('GET', '/admin/metrics'),
      this.request('GET', '/admin/downloads/active'),
      this.request('GET', '/admin/requests/recent'),
    ]).then(([metrics, activeDownloads, recentRequests]) => ({
      metrics,
      activeDownloads,
      recentRequests,
    }));
  }
}
