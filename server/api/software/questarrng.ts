import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import type { SoftwareProviderSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import axios from 'axios';
import { Readable } from 'node:stream';
import type {
  PcGameVariant,
  SoftwareAssetsResponse,
  SoftwareCatalogGame,
  SoftwareCatalogPlatform,
  SoftwareProviderHandshake,
  SoftwareProviderRequest,
} from './types';

export interface QuestarrHandshake extends SoftwareProviderHandshake {
  requestContractVersion?: number;
}

export interface SoftwareCatalogSearchPage {
  results: SoftwareCatalogGame[];
  nextCursor: string | null;
}

export interface SoftwareCatalogPopularPage {
  results: SoftwareCatalogGame[];
  nextOffset: number | null;
}

export interface SoftwareBundleStream {
  stream: Readable;
  filename?: string;
  contentLength?: number;
  contentType?: string;
  rangeSupported: boolean;
  statusCode: number;
  contentRange?: string;
}

export interface QuestarrLibraryLookup {
  games: { igdbId: number; status: string; deliverable?: boolean }[];
  steamGames?: { steamAppId: number; owned: boolean | null }[];
}

export interface SoftwareAssetStream {
  stream: Readable;
  filename?: string;
  contentLength?: number;
  contentType?: string;
  rangeSupported: boolean;
  statusCode: number;
  contentRange?: string;
}

export class QuestarrNGAPI extends ExternalAPI {
  static buildUrl(
    settings: Pick<
      SoftwareProviderSettings,
      'useSsl' | 'hostname' | 'port' | 'baseUrl'
    >,
    path = ''
  ): string {
    return buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.port,
      urlBase: settings.baseUrl,
      path,
    });
  }

  constructor(settings: SoftwareProviderSettings) {
    super(
      QuestarrNGAPI.buildUrl(settings),
      {},
      {
        allowPrivateAddresses: true,
        nodeCache: cacheManager.getCache('questarr').data,
        headers: { 'X-Api-Key': settings.apiKey },
      }
    );
  }

  public async getHandshake(): Promise<QuestarrHandshake> {
    let handshake: QuestarrHandshake;
    try {
      handshake = await this.get<QuestarrHandshake>(
        '/api/integration/seerrng/v1/ping',
        {},
        0
      );
    } catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 404) {
        throw error;
      }
      handshake = await this.get<QuestarrHandshake>(
        '/api/integration/ping',
        {},
        0
      );
    }
    if (handshake.apiVersion !== 1) {
      throw new Error(
        `QuestarrNG API v${handshake.apiVersion} is not supported`
      );
    }
    if (
      handshake.requestContractVersion !== undefined &&
      ![1, 2].includes(handshake.requestContractVersion)
    ) {
      throw new Error(
        `QuestarrNG request contract v${handshake.requestContractVersion} is not supported`
      );
    }
    return handshake;
  }

  public searchCatalog(
    query: string,
    limit = 20
  ): Promise<SoftwareCatalogGame[]> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/search',
      { params: { q: query, limit } },
      600
    );
  }

  public searchCatalogPage(
    query: string,
    limit = 20,
    cursor?: string,
    platformIds: number[] = [],
    genre?: string,
    releaseYear?: number
  ): Promise<SoftwareCatalogSearchPage> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/search-page',
      {
        params: {
          q: query,
          limit,
          ...(cursor ? { cursor } : {}),
          ...(platformIds.length ? { platformIds: platformIds.join(',') } : {}),
          ...(genre ? { genre } : {}),
          ...(releaseYear ? { releaseYear } : {}),
        },
      },
      600
    );
  }

  public getPopularCatalog(limit = 20): Promise<SoftwareCatalogGame[]> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/popular',
      { params: { limit } },
      600
    );
  }

  public getPopularCatalogPage(
    limit = 20,
    offset = 0,
    platformIds: number[] = [],
    genre?: string,
    releaseYear?: number
  ): Promise<SoftwareCatalogPopularPage> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/popular-page',
      {
        params: {
          limit,
          offset,
          ...(platformIds.length ? { platformIds: platformIds.join(',') } : {}),
          ...(genre ? { genre } : {}),
          ...(releaseYear ? { releaseYear } : {}),
        },
      },
      600
    );
  }

  public getCatalogPlatforms(): Promise<SoftwareCatalogPlatform[]> {
    return this.get('/api/integration/seerrng/v1/catalog/platforms', {}, 600);
  }

  public getCatalogGame(
    igdbId: number,
    platformId?: number
  ): Promise<SoftwareCatalogGame> {
    return this.get(
      `/api/integration/seerrng/v1/catalog/games/${igdbId}`,
      { params: platformId === undefined ? undefined : { platformId } },
      600
    );
  }

  public lookupLibrary(
    igdbIds: number[],
    steamAppIds: number[] = []
  ): Promise<QuestarrLibraryLookup> {
    return this.get(
      '/api/integration/seerrng/v1/library/lookup',
      {
        params: {
          igdbIds: igdbIds.join(','),
          ...(steamAppIds.length ? { steamAppIds: steamAppIds.join(',') } : {}),
        },
      },
      60
    );
  }

  public createRequest(
    externalRequestId: string,
    title: string,
    variant: PcGameVariant,
    igdbId?: number
  ): Promise<SoftwareProviderRequest> {
    return this.post('/api/integration/seerrng/v1/requests', {
      externalRequestId,
      title,
      variant,
      ...(igdbId ? { igdbId } : {}),
    });
  }

  public getRequest(
    externalRequestId: string
  ): Promise<SoftwareProviderRequest> {
    return this.get(
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}`,
      {},
      0
    );
  }

  public retryRequest(
    externalRequestId: string,
    confirmNoExistingDownload = false
  ): Promise<SoftwareProviderRequest> {
    return this.post(
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/retry`,
      { confirmNoExistingDownload }
    );
  }

  public cancelRequest(
    externalRequestId: string,
    confirmNoExistingDownload = false
  ): Promise<SoftwareProviderRequest> {
    return this.post(
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/cancel`,
      { confirmNoExistingDownload }
    );
  }

  public getAssets(externalRequestId: string): Promise<SoftwareAssetsResponse> {
    return this.get(
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/assets`,
      {},
      0
    );
  }

  public async streamAsset(
    externalRequestId: string,
    assetId: string,
    range?: string
  ): Promise<SoftwareAssetStream> {
    const response = await this.request<Readable>(
      'GET',
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/assets/${encodeURIComponent(assetId)}`,
      undefined,
      {
        responseType: 'stream',
        headers: range ? { Range: range } : {},
        validateStatus: (status) =>
          status === 200 || status === 206 || status === 416,
      }
    );
    if (response.status === 416) {
      response.data.destroy();
      const contentRange = response.headers['content-range'];
      return {
        stream: Readable.from([]),
        contentLength: 0,
        rangeSupported: true,
        statusCode: 416,
        contentRange:
          typeof contentRange === 'string' &&
          /^bytes \*\/\d+$/.test(contentRange)
            ? contentRange
            : undefined,
      };
    }
    return {
      stream: response.data,
      filename: response.headers['content-disposition'],
      contentLength: Number(response.headers['content-length']) || undefined,
      contentType:
        typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type']
          : undefined,
      rangeSupported: response.headers['accept-ranges'] === 'bytes',
      statusCode: response.status,
      contentRange: response.headers['content-range'],
    };
  }

  public async streamBundle(
    externalRequestId: string
  ): Promise<SoftwareBundleStream> {
    const response = await this.request<Readable>(
      'GET',
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/assets/bundle`,
      undefined,
      {
        responseType: 'stream',
        validateStatus: (status) => status === 200,
      }
    );
    const rawContentLength = response.headers['content-length'];
    const parsedContentLength =
      typeof rawContentLength === 'string' &&
      /^\d{1,16}$/.test(rawContentLength)
        ? Number(rawContentLength)
        : undefined;
    return {
      stream: response.data,
      filename: this.getFilenameFromDisposition(
        response.headers['content-disposition']
      ),
      contentLength:
        parsedContentLength !== undefined &&
        Number.isSafeInteger(parsedContentLength)
          ? parsedContentLength
          : undefined,
      contentType: 'application/gzip',
      rangeSupported: false,
      statusCode: 200,
    };
  }

  private getFilenameFromDisposition(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /filename\*=UTF-8''([^;]+)/i.exec(value);
    if (!match) return undefined;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return undefined;
    }
  }
}

export default QuestarrNGAPI;
