import ExternalAPI from '@server/api/externalapi';
import type { SoftwareProviderSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import type { Readable } from 'node:stream';
import type {
  PcGameVariant,
  SoftwareAssetsResponse,
  SoftwareCatalogGame,
  SoftwareCatalogPlatform,
  SoftwareProviderRequest,
} from './types';

export interface QuestarrHandshake {
  service: string;
  apiVersion: number;
  requestContractVersion: number;
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
        headers: { 'X-Api-Key': settings.apiKey },
      }
    );
  }

  public getHandshake(): Promise<QuestarrHandshake> {
    return this.get('/api/integration/seerrng/v1/ping', {}, 0);
  }

  public searchCatalog(
    query: string,
    limit = 20
  ): Promise<SoftwareCatalogGame[]> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/search',
      { params: { q: query, limit } },
      0
    );
  }

  public getPopularCatalog(limit = 20): Promise<SoftwareCatalogGame[]> {
    return this.get(
      '/api/integration/seerrng/v1/catalog/popular',
      { params: { limit } },
      0
    );
  }

  public getCatalogPlatforms(): Promise<SoftwareCatalogPlatform[]> {
    return this.get('/api/integration/seerrng/v1/catalog/platforms', {}, 0);
  }

  public getCatalogGame(igdbId: number): Promise<SoftwareCatalogGame> {
    return this.get(
      `/api/integration/seerrng/v1/catalog/games/${igdbId}`,
      {},
      0
    );
  }

  public createRequest(
    externalRequestId: string,
    title: string,
    variant: PcGameVariant
  ): Promise<SoftwareProviderRequest> {
    return this.post('/api/integration/seerrng/v1/requests', {
      externalRequestId,
      title,
      variant,
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
    externalRequestId: string
  ): Promise<SoftwareProviderRequest> {
    return this.post(
      `/api/integration/seerrng/v1/requests/${encodeURIComponent(externalRequestId)}/retry`,
      {}
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
        validateStatus: (status) => status === 200 || status === 206,
      }
    );
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

export default QuestarrNGAPI;
