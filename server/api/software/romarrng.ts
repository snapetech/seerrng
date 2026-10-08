import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import type { SoftwareProviderSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import axios from 'axios';
import { Readable } from 'node:stream';
import type { SoftwareAssetStream } from './questarrng';
import type {
  SoftwareAssetsResponse,
  SoftwareCatalogGame,
  SoftwareCatalogPlatform,
  SoftwareDatCatalogPlatformsResponse,
  SoftwareProviderHandshake,
  SoftwareProviderRequest,
} from './types';

export interface RomarrHandshake extends SoftwareProviderHandshake {
  version?: string;
}

export interface RomarrCatalogSearchPage {
  results: SoftwareCatalogGame[];
  nextCursor: string | null;
}

export interface RomarrCatalogPopularPage {
  results: SoftwareCatalogGame[];
  nextOffset: number | null;
}

export interface RomarrPlatform {
  slug: string;
  name: string;
  aliases?: string[];
  media: string;
  extensions: string[];
  max_size_mb: number;
}

export interface RomarrLibraryLookup {
  ready: boolean;
  partial: boolean;
  matches: { title: string; platform: string }[];
}

export class ROMarrNGAPI extends ExternalAPI {
  private handshakePromise?: Promise<RomarrHandshake>;

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
      ROMarrNGAPI.buildUrl(settings),
      {},
      {
        allowPrivateAddresses: true,
        nodeCache: cacheManager.getCache('romarr').data,
        headers: { 'X-Api-Key': settings.apiKey },
      }
    );
  }

  public getHandshake(): Promise<RomarrHandshake> {
    if (!this.handshakePromise) {
      const handshake = this.get<RomarrHandshake>(
        '/api/integration/seerrng/v1/ping',
        {},
        60
      ).catch<RomarrHandshake>((error: unknown) => {
        if (!axios.isAxiosError(error) || error.response?.status !== 404) {
          throw error;
        }
        return this.get<RomarrHandshake>('/api/v1/integration/ping', {}, 60);
      });
      this.handshakePromise = handshake.catch((error: unknown) => {
        this.handshakePromise = undefined;
        throw error;
      });
    }
    return this.handshakePromise;
  }

  private async getIntegrationBase(): Promise<string> {
    const handshake = await this.getHandshake();
    if (handshake.requestContractVersion === undefined) {
      return '/api/v1/integration';
    }
    if ([1, 2].includes(handshake.requestContractVersion)) {
      // Request contracts v1 and v2 both use the stable SeerrNG v1 route.
      return '/api/integration/seerrng/v1';
    }
    throw new Error(
      `ROMarrNG request contract v${handshake.requestContractVersion} is not supported`
    );
  }

  public searchCatalog(
    query: string,
    limit = 20
  ): Promise<SoftwareCatalogGame[]> {
    return this.getIntegrationBase().then((base) =>
      this.get(`${base}/catalog/search`, { params: { q: query, limit } }, 600)
    );
  }

  public searchCatalogPage(
    query: string,
    limit = 20,
    cursor?: string,
    platformIds: number[] = [],
    genre?: string,
    releaseYear?: number
  ): Promise<RomarrCatalogSearchPage> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/search-page`,
        {
          params: {
            q: query,
            limit,
            ...(cursor ? { cursor } : {}),
            ...(platformIds.length
              ? { platformIds: platformIds.join(',') }
              : {}),
            ...(genre ? { genre } : {}),
            ...(releaseYear ? { releaseYear } : {}),
          },
        },
        600
      )
    );
  }

  public getPopularCatalog(limit = 20): Promise<SoftwareCatalogGame[]> {
    return this.getIntegrationBase().then((base) =>
      this.get(`${base}/catalog/popular`, { params: { limit } }, 600)
    );
  }

  public getPopularCatalogPage(
    limit = 20,
    offset = 0,
    platformIds: number[] = [],
    genre?: string,
    releaseYear?: number
  ): Promise<RomarrCatalogPopularPage> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/popular-page`,
        {
          params: {
            limit,
            offset,
            ...(platformIds.length
              ? { platformIds: platformIds.join(',') }
              : {}),
            ...(genre ? { genre } : {}),
            ...(releaseYear ? { releaseYear } : {}),
          },
        },
        600
      )
    );
  }

  public getCatalogPlatforms(): Promise<SoftwareCatalogPlatform[]> {
    return this.getIntegrationBase().then((base) =>
      this.get(`${base}/catalog/platforms`, {}, 600)
    );
  }

  public getCatalogGame(
    igdbId: number,
    platformId?: number
  ): Promise<SoftwareCatalogGame> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/games/${igdbId}`,
        { params: platformId === undefined ? undefined : { platformId } },
        600
      )
    );
  }

  public getDatCatalogPlatforms(): Promise<SoftwareDatCatalogPlatformsResponse> {
    return this.getIntegrationBase().then((base) =>
      this.get(`${base}/catalog/dat/platforms`, {}, 600)
    );
  }

  public searchDatCatalogPage(
    query: string,
    limit = 24,
    cursor?: string,
    platformSlugs: string[] = []
  ): Promise<RomarrCatalogSearchPage> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/dat/search-page`,
        {
          params: {
            q: query,
            limit,
            ...(cursor ? { cursor } : {}),
            ...(platformSlugs.length
              ? { platformSlugs: platformSlugs.join(',') }
              : {}),
          },
        },
        600
      )
    );
  }

  public browseDatCatalogPage(
    limit = 24,
    offset = 0,
    platformSlugs: string[] = []
  ): Promise<RomarrCatalogPopularPage> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/dat/browse-page`,
        {
          params: {
            limit,
            offset,
            ...(platformSlugs.length
              ? { platformSlugs: platformSlugs.join(',') }
              : {}),
          },
        },
        600
      )
    );
  }

  public getDatCatalogGame(catalogKey: string): Promise<SoftwareCatalogGame> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/catalog/dat/games/${encodeURIComponent(catalogKey)}`,
        {},
        600
      )
    );
  }

  public getPlatforms(forceFresh = false): Promise<RomarrPlatform[]> {
    return this.get('/api/platforms', {}, forceFresh ? 0 : 300);
  }

  public lookupLibrary(
    titles: { title: string; platform: string }[]
  ): Promise<RomarrLibraryLookup> {
    return this.getIntegrationBase().then((base) =>
      this.post(`${base}/library/lookup`, { titles })
    );
  }

  public createRequest(
    externalRequestId: string,
    game: string,
    platform: string,
    catalogId?: number,
    platformId?: number,
    datIdentity?: { catalogKey: string; platformSlug: string }
  ): Promise<SoftwareProviderRequest> {
    return this.getIntegrationBase().then((base) =>
      this.post(`${base}/requests`, {
        externalRequestId,
        game,
        platform,
        ...(base.includes('/seerrng/v1') && catalogId
          ? { identity: { catalogProvider: 'igdb', catalogId, platformId } }
          : datIdentity && base.includes('/seerrng/v1')
            ? {
                identity: {
                  catalogProvider: 'dat',
                  catalogKey: datIdentity.catalogKey,
                  platformSlug: datIdentity.platformSlug,
                },
              }
            : {}),
      })
    );
  }

  public getRequest(
    externalRequestId: string
  ): Promise<SoftwareProviderRequest> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/requests/${encodeURIComponent(externalRequestId)}`,
        {},
        0
      )
    );
  }

  public retryRequest(
    externalRequestId: string,
    confirmNoExistingDownload = false
  ): Promise<SoftwareProviderRequest> {
    return this.getIntegrationBase().then((base) =>
      this.post(
        `${base}/requests/${encodeURIComponent(externalRequestId)}/retry`,
        { confirmNoExistingDownload }
      )
    );
  }

  public cancelRequest(
    externalRequestId: string,
    confirmNoExistingDownload = false
  ): Promise<SoftwareProviderRequest> {
    return this.getIntegrationBase().then((base) =>
      this.post(
        `${base}/requests/${encodeURIComponent(externalRequestId)}/cancel`,
        { confirmNoExistingDownload }
      )
    );
  }

  public getAssets(externalRequestId: string): Promise<SoftwareAssetsResponse> {
    return this.getIntegrationBase().then((base) =>
      this.get(
        `${base}/requests/${encodeURIComponent(externalRequestId)}/assets`,
        {},
        0
      )
    );
  }

  public async streamAsset(
    externalRequestId: string,
    assetId: string,
    range?: string
  ): Promise<SoftwareAssetStream> {
    const base = await this.getIntegrationBase();
    const response = await this.request<Readable>(
      'GET',
      `${base}/requests/${encodeURIComponent(externalRequestId)}/assets/${encodeURIComponent(assetId)}`,
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
}

export default ROMarrNGAPI;
