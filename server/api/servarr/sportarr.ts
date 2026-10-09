import type { QualityProfile } from '@server/api/servarr/base';
import {
  fetchSafeRemoteImage,
  MAX_SAFE_REMOTE_IMAGE_BYTES,
  normalizeSafeRasterImage,
} from '@server/utils/safeRemoteImage';
import ServarrBase, {
  isServarrServiceUrl,
  MAX_SERVARR_CONFIGURATION_RESULTS,
  MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
  MAX_SERVARR_LIBRARY_RESULTS,
  MAX_SERVARR_LOOKUP_RESULTS,
  sanitizeServarrImages,
  sanitizeServarrProfiles,
  sanitizeServarrSystemStatus,
} from './base';

const MAX_TEXT_LENGTH = 10_000;
const MAX_CONFIGURATION_NAME_LENGTH = 200;
const MAX_CONFIGURATION_URL_LENGTH = 4_096;
const MAX_EVENT_RESULTS = 1_000;
const MAX_EVENT_FILES = 100;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : '';
const optionalText = (value: unknown): string | undefined =>
  text(value).trim() || undefined;
const integer = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) ? (value as number) : undefined;
const nonNegativeInteger = (value: unknown): number | undefined => {
  const parsed = integer(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
};
const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const boolean = (value: unknown): boolean => value === true;

export interface SportarrLeague {
  /** Sportarr's installation-local library ID. Catalog search results omit it. */
  id?: number;
  externalId: string;
  title: string;
  overview: string;
  sport?: string;
  country?: string;
  year?: number;
  monitored: boolean;
  images: ReturnType<typeof sanitizeServarrImages>;
}

export interface SportarrEvent {
  id: number;
  externalId?: string;
  title: string;
  sport?: string;
  leagueId?: number;
  leagueName?: string;
  season?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  eventDate?: string;
  broadcastDate?: string;
  broadcastTimezone?: string;
  monitored: boolean;
  hasFile: boolean;
  fileCount: number;
  fileSize?: number;
  quality?: string;
}

export interface SportarrEventPage {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  records: SportarrEvent[];
}

export interface SportarrCoverImage {
  imageBuffer: Buffer;
  contentType: string;
}

export interface SportarrAddLeagueOptions {
  externalId: string;
  title: string;
  sport?: string;
  country?: string;
  overview?: string;
}

export interface SportarrIptvSource {
  id: number;
  name: string;
  type: 'M3U' | 'Xtream';
  url: string;
  isActive: boolean;
  channelCount: number;
  lastError?: string;
}

export interface SportarrIptvSourceTestResult {
  success: boolean;
  channelCount: number;
  error?: string;
}

export interface SportarrEpgSource {
  id: number;
  name: string;
  url: string;
  isActive: boolean;
  priority: number;
  programCount: number;
  iptvSourceId?: number;
  lastError?: string;
}

export interface SportarrEpgSyncResult {
  success: boolean;
  channelCount: number;
  programCount: number;
  mappedChannelCount: number;
}

const sanitizeIptvSource = (value: unknown): SportarrIptvSource | undefined => {
  if (!isRecord(value)) return undefined;
  const id = integer(value.id);
  const type = value.type;
  const name = text(value.name).trim().slice(0, MAX_CONFIGURATION_NAME_LENGTH);
  const url = text(value.url).trim();
  const channelCount = nonNegativeInteger(value.channelCount);
  if (
    id === undefined ||
    id <= 0 ||
    !name ||
    !url ||
    url.length > MAX_CONFIGURATION_URL_LENGTH ||
    typeof value.isActive !== 'boolean' ||
    channelCount === undefined ||
    (type !== 'M3U' && type !== 'Xtream')
  ) {
    return undefined;
  }
  return {
    id,
    name,
    type,
    url,
    isActive: value.isActive,
    channelCount,
    ...(optionalText(value.lastError)
      ? { lastError: optionalText(value.lastError) }
      : {}),
  };
};

const sanitizeEpgSource = (
  value: unknown,
  allowMissingProgramCount = false
): SportarrEpgSource | undefined => {
  if (!isRecord(value)) return undefined;
  const id = integer(value.id);
  const name = text(value.name).trim().slice(0, MAX_CONFIGURATION_NAME_LENGTH);
  const url = text(value.url).trim();
  const priority = nonNegativeInteger(value.priority);
  const programCount = nonNegativeInteger(value.programCount);
  if (
    id === undefined ||
    id <= 0 ||
    !name ||
    !url ||
    url.length > MAX_CONFIGURATION_URL_LENGTH ||
    typeof value.isActive !== 'boolean' ||
    priority === undefined ||
    (programCount === undefined && !allowMissingProgramCount)
  ) {
    return undefined;
  }
  const iptvSourceId = integer(value.iptvSourceId);
  return {
    id,
    name,
    url,
    isActive: value.isActive,
    priority,
    programCount: programCount ?? 0,
    ...(iptvSourceId !== undefined && iptvSourceId > 0 ? { iptvSourceId } : {}),
    ...(optionalText(value.lastError)
      ? { lastError: optionalText(value.lastError) }
      : {}),
  };
};

const sanitizeConfigurationList = <T>(
  value: unknown,
  sanitize: (item: unknown) => T | undefined,
  label: string
): T[] => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SERVARR_CONFIGURATION_RESULTS
  ) {
    throw new Error(`Sportarr returned an invalid ${label} list.`);
  }
  return value.map((item) => {
    const sanitized = sanitize(item);
    if (!sanitized) {
      throw new Error(`Sportarr returned an invalid ${label}.`);
    }
    return sanitized;
  });
};

const sanitizeSourceTestResult = (
  value: unknown
): SportarrIptvSourceTestResult => {
  const channelCount = isRecord(value)
    ? nonNegativeInteger(value.channelCount)
    : undefined;
  if (
    !isRecord(value) ||
    typeof value.success !== 'boolean' ||
    channelCount === undefined
  ) {
    throw new Error('Sportarr returned an invalid IPTV source test result.');
  }
  return {
    success: value.success,
    channelCount,
    ...(optionalText(value.error) ? { error: optionalText(value.error) } : {}),
  };
};

const sanitizeEpgSyncResult = (value: unknown): SportarrEpgSyncResult => {
  const channelCount = isRecord(value)
    ? nonNegativeInteger(value.channelCount)
    : undefined;
  const programCount = isRecord(value)
    ? nonNegativeInteger(value.programCount)
    : undefined;
  const mappedChannelCount = isRecord(value)
    ? nonNegativeInteger(value.mappedChannelCount)
    : undefined;
  if (
    !isRecord(value) ||
    typeof value.success !== 'boolean' ||
    channelCount === undefined ||
    programCount === undefined ||
    mappedChannelCount === undefined
  ) {
    throw new Error('Sportarr returned an invalid XMLTV sync result.');
  }
  return {
    success: value.success,
    channelCount,
    programCount,
    mappedChannelCount,
  };
};

const unwrapRecords = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value.slice(0, MAX_SERVARR_LIBRARY_RESULTS);
  if (!isRecord(value)) return undefined;
  for (const key of ['records', 'results', 'data']) {
    if (Array.isArray(value[key])) {
      return (value[key] as unknown[]).slice(0, MAX_SERVARR_LIBRARY_RESULTS);
    }
  }
  return undefined;
};

const sanitizeLeague = (
  value: unknown,
  includeLibraryId: boolean
): SportarrLeague | undefined => {
  if (!isRecord(value)) return undefined;
  // The native library uses `externalId`/`name`, while catalog responses use
  // TheSportsDB-compatible `idLeague`/`strLeague` fields. Normalize both
  // shapes at the provider boundary.
  const externalId = text(
    value.externalId ?? value.external_id ?? value.idLeague ?? value.id_league
  ).trim();
  const title = text(value.name ?? value.title ?? value.strLeague).trim();
  if (!/^lg-\d{1,20}$/.test(externalId) || !title) return undefined;

  const providerId = integer(value.id);
  const id =
    includeLibraryId && providerId !== undefined && providerId > 0
      ? providerId
      : undefined;
  const images = sanitizeServarrImages(value.images);
  const posterUrl = optionalText(
    value.posterUrl ?? value.posterPath ?? value.strPoster
  );
  const logoUrl = optionalText(
    value.logoUrl ?? value.strLogo ?? value.strBadge
  );
  const bannerUrl = optionalText(value.bannerUrl ?? value.strBanner);
  if (posterUrl && !images.some((image) => image.url === posterUrl)) {
    images.unshift({ coverType: 'poster', url: posterUrl });
  }
  if (logoUrl && !images.some((image) => image.url === logoUrl)) {
    images.push({ coverType: 'poster', url: logoUrl });
  }
  if (bannerUrl && !images.some((image) => image.url === bannerUrl)) {
    images.push({ coverType: 'banner', url: bannerUrl });
  }

  const year =
    integer(value.year) ??
    (/^\d{4}$/.test(text(value.intFormedYear).trim())
      ? Number(text(value.intFormedYear).trim())
      : undefined);
  const sport = optionalText(value.sport ?? value.strSport);
  const country = optionalText(value.country ?? value.strCountry);

  return {
    ...(id !== undefined ? { id } : {}),
    externalId,
    title,
    overview: text(
      value.overview ?? value.description ?? value.strDescriptionEN
    ),
    ...(sport ? { sport } : {}),
    ...(country ? { country } : {}),
    ...(year !== undefined ? { year } : {}),
    monitored: boolean(value.monitored),
    images,
  };
};

const sanitizeEvent = (value: unknown): SportarrEvent | undefined => {
  if (!isRecord(value)) return undefined;
  const id = integer(value.id);
  const title = text(value.title).trim();
  if (id === undefined || id <= 0 || !title) return undefined;

  const files = Array.isArray(value.files)
    ? value.files.slice(0, MAX_EVENT_FILES)
    : [];
  const existingFiles = files.filter(
    (file) => isRecord(file) && file.exists !== false
  );
  const advertisedFileCount = finiteNumber(value.fileCount);
  const hasFile = boolean(value.hasFile) || existingFiles.length > 0;

  return {
    id,
    ...(optionalText(value.externalId)
      ? { externalId: text(value.externalId) }
      : {}),
    title,
    ...(optionalText(value.sport) ? { sport: text(value.sport) } : {}),
    ...(integer(value.leagueId) !== undefined
      ? { leagueId: integer(value.leagueId) }
      : {}),
    ...(optionalText(value.leagueName)
      ? { leagueName: text(value.leagueName) }
      : {}),
    ...(optionalText(value.season) ? { season: text(value.season) } : {}),
    ...(integer(value.seasonNumber) !== undefined
      ? { seasonNumber: integer(value.seasonNumber) }
      : {}),
    ...(integer(value.episodeNumber) !== undefined
      ? { episodeNumber: integer(value.episodeNumber) }
      : {}),
    ...(optionalText(value.eventDate)
      ? { eventDate: text(value.eventDate) }
      : {}),
    ...(optionalText(value.broadcastDate)
      ? { broadcastDate: text(value.broadcastDate) }
      : {}),
    ...(optionalText(value.broadcastTimezone)
      ? { broadcastTimezone: text(value.broadcastTimezone) }
      : {}),
    monitored: boolean(value.monitored),
    hasFile,
    fileCount: Math.max(
      existingFiles.length,
      Math.min(MAX_EVENT_FILES, Math.floor(advertisedFileCount ?? 0)),
      hasFile ? 1 : 0
    ),
    ...(finiteNumber(value.fileSize) !== undefined
      ? { fileSize: finiteNumber(value.fileSize) }
      : {}),
    ...(optionalText(value.quality) ? { quality: text(value.quality) } : {}),
  };
};

const sanitizeEventPage = (
  value: unknown,
  fallbackPage: number,
  fallbackPageSize: number
): SportarrEventPage => {
  const envelope = isRecord(value) ? value : undefined;
  const rawRecords = Array.isArray(value)
    ? value
    : envelope && Array.isArray(envelope.records)
      ? envelope.records
      : undefined;
  if (!rawRecords)
    throw new Error('Sportarr returned an invalid events response');

  const records = rawRecords.slice(0, MAX_EVENT_RESULTS).flatMap((event) => {
    const normalized = sanitizeEvent(event);
    return normalized ? [normalized] : [];
  });
  const page = integer(envelope?.page) ?? fallbackPage;
  const pageSize = integer(envelope?.pageSize) ?? fallbackPageSize;
  const totalRecords = integer(envelope?.totalRecords) ?? records.length;
  const totalPages =
    integer(envelope?.totalPages) ??
    Math.ceil(totalRecords / Math.max(pageSize, 1));
  if (page <= 0 || pageSize <= 0 || totalRecords < 0 || totalPages < 0) {
    throw new Error('Sportarr returned invalid event paging information');
  }
  return { page, pageSize, totalRecords, totalPages, records };
};

class SportarrAPI extends ServarrBase<unknown> {
  private readonly coverBaseUrl: string;

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, apiName: 'Sportarr', cacheName: 'sportarr' });
    const parsedUrl = new URL(url);
    parsedUrl.pathname = parsedUrl.pathname.replace(
      /\/api(?:\/v\d+)?\/?$/i,
      ''
    );
    parsedUrl.search = '';
    parsedUrl.hash = '';
    this.coverBaseUrl = parsedUrl.toString().replace(/\/$/, '');
  }

  private buildCoverUrl(path: string): string | undefined {
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('://')
    ) {
      return undefined;
    }
    return `${this.coverBaseUrl}${path}`;
  }

  private buildRemoteCoverUrl(value: string): string | undefined {
    if (value.length > 2_048) return undefined;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol)
        ? url.toString()
        : undefined;
    } catch {
      return undefined;
    }
  }

  public async getSportarrSystemStatus() {
    try {
      const response = await this.request<unknown>('GET', '/system/status');
      return sanitizeServarrSystemStatus(response.data);
    } catch (error) {
      throw new Error(
        `[Sportarr] Failed to retrieve system status: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  public async getQualityProfiles(): Promise<QualityProfile[]> {
    try {
      const response = await this.request<unknown>(
        'GET',
        '/qualityprofile',
        undefined,
        {
          maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
        }
      );
      const records = unwrapRecords(response.data);
      if (!records)
        throw new Error('Sportarr returned an invalid profile list');
      return sanitizeServarrProfiles(records).slice(
        0,
        MAX_SERVARR_CONFIGURATION_RESULTS
      );
    } catch (error) {
      throw new Error(
        `[Sportarr] Failed to retrieve quality profiles: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  public async getLibraryLeagues(): Promise<SportarrLeague[]> {
    try {
      const response = await this.request<unknown>(
        'GET',
        '/leagues',
        undefined,
        {
          maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
        }
      );
      const records = unwrapRecords(response.data);
      if (!records)
        throw new Error('Sportarr returned an invalid league library');
      return records.slice(0, MAX_SERVARR_LIBRARY_RESULTS).flatMap((record) => {
        const league = sanitizeLeague(record, true);
        return league?.id ? [league] : [];
      });
    } catch (error) {
      throw new Error(
        `[Sportarr] Failed to retrieve leagues: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  public async getLeaguesByTitle(query: string): Promise<SportarrLeague[]> {
    const normalizedQuery = query.trim().slice(0, 200);
    if (!normalizedQuery) return [];

    try {
      const response = await this.request<unknown>(
        'GET',
        `/leagues/search/${encodeURIComponent(normalizedQuery)}`,
        undefined,
        { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
      );
      const records = unwrapRecords(response.data);
      if (!records)
        throw new Error('Sportarr returned an invalid league search response');
      return records.slice(0, MAX_SERVARR_LOOKUP_RESULTS).flatMap((record) => {
        const league = sanitizeLeague(record, false);
        return league ? [league] : [];
      });
    } catch (error) {
      throw new Error(
        `[Sportarr] Failed to search leagues: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  private async getCatalogLeagueByExternalId(
    externalId: string
  ): Promise<SportarrLeague | undefined> {
    const response = await this.request<unknown>(
      'GET',
      '/leagues/all',
      undefined,
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    const records = unwrapRecords(response.data);
    if (!records) {
      throw new Error('Sportarr returned an invalid league catalog');
    }

    // This route returns the upstream metadata catalog, not the instance's
    // local library. Catalog identifiers are stable `lg-*` strings and must
    // never be confused with Sportarr's installation-local numeric IDs.
    return records
      .slice(0, MAX_SERVARR_LIBRARY_RESULTS)
      .flatMap((record) => {
        const league = sanitizeLeague(record, false);
        return league ? [league] : [];
      })
      .find((league) => league.externalId === externalId);
  }

  public async getLeagueByExternalId(
    externalId: string
  ): Promise<SportarrLeague | undefined> {
    const library = await this.getLibraryLeagues();
    const existing = library.find((league) => league.externalId === externalId);
    if (existing) return existing;

    return this.getCatalogLeagueByExternalId(externalId);
  }

  public async getLeagueById(id: number): Promise<SportarrLeague> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('Sportarr league ID must be a positive integer');
    }
    const response = await this.request<unknown>(
      'GET',
      `/leagues/${id}`,
      undefined,
      {
        maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
      }
    );
    const league = sanitizeLeague(response.data, true);
    if (!league?.id) throw new Error('Sportarr returned an invalid league');
    return league;
  }

  public async getLeagueEvents(
    leagueId: number,
    page = 1,
    pageSize = 50
  ): Promise<SportarrEventPage> {
    if (!Number.isSafeInteger(leagueId) || leagueId <= 0) {
      throw new Error('Sportarr league ID must be a positive integer');
    }
    if (
      !Number.isSafeInteger(page) ||
      page <= 0 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize <= 0 ||
      pageSize > MAX_EVENT_RESULTS
    ) {
      throw new Error('Sportarr event paging values are out of range');
    }

    const response = await this.request<unknown>(
      'GET',
      `/leagues/${leagueId}/events`,
      undefined,
      {
        params: { page, pageSize },
        maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
      }
    );
    return sanitizeEventPage(response.data, page, pageSize);
  }

  public async getIptvSources(): Promise<SportarrIptvSource[]> {
    const response = await this.request<unknown>(
      'GET',
      '/iptv/sources',
      undefined,
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    return sanitizeConfigurationList(
      response.data,
      sanitizeIptvSource,
      'IPTV source'
    );
  }

  public async testIptvM3uSource(input: {
    name: string;
    url: string;
  }): Promise<SportarrIptvSourceTestResult> {
    const response = await this.request<unknown>(
      'POST',
      '/iptv/sources/test',
      { name: input.name, type: 'M3U', url: input.url, maxStreams: 1 },
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    return sanitizeSourceTestResult(response.data);
  }

  public async addIptvM3uSource(input: {
    name: string;
    url: string;
  }): Promise<SportarrIptvSource> {
    const response = await this.request<unknown>(
      'POST',
      '/iptv/sources',
      { name: input.name, type: 'M3U', url: input.url, maxStreams: 1 },
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    const source = sanitizeIptvSource(response.data);
    if (!source) throw new Error('Sportarr returned an invalid IPTV source.');
    return source;
  }

  public async getEpgSources(): Promise<SportarrEpgSource[]> {
    const response = await this.request<unknown>(
      'GET',
      '/epg/sources',
      undefined,
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    return sanitizeConfigurationList(
      response.data,
      sanitizeEpgSource,
      'XMLTV source'
    );
  }

  public async addEpgSource(input: {
    name: string;
    url: string;
    iptvSourceId: number;
  }): Promise<SportarrEpgSource> {
    const response = await this.request<unknown>(
      'POST',
      '/epg/sources',
      {
        name: input.name,
        url: input.url,
        priority: 25,
        iptvSourceId: input.iptvSourceId,
      },
      { maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    // Sportarr's create response omits ProgramCount even though the list
    // endpoint includes it. The guide sync below supplies the initial count.
    const source = sanitizeEpgSource(response.data, true);
    if (!source) throw new Error('Sportarr returned an invalid XMLTV source.');
    return source;
  }

  public async syncEpgSource(id: number): Promise<SportarrEpgSyncResult> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('Sportarr XMLTV source ID must be a positive integer.');
    }
    const response = await this.request<unknown>(
      'POST',
      `/epg/sources/${id}/sync`,
      undefined,
      { timeout: 120_000, maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES }
    );
    return sanitizeEpgSyncResult(response.data);
  }

  public async addLeague(
    league: SportarrAddLeagueOptions,
    qualityProfileId: number
  ): Promise<SportarrLeague | undefined> {
    if (!/^lg-\d{1,20}$/.test(league.externalId) || !league.title.trim()) {
      throw new Error('Sportarr league identity and title are required');
    }
    if (!Number.isSafeInteger(qualityProfileId) || qualityProfileId <= 0) {
      throw new Error('Sportarr quality profile must be a positive integer');
    }

    const body: Record<string, unknown> = {
      externalId: league.externalId,
      name: league.title.slice(0, MAX_TEXT_LENGTH),
      sport: league.sport?.trim().slice(0, 200) || 'Unknown',
      monitored: true,
      qualityProfileId,
    };
    if (league.country?.trim())
      body.country = league.country.trim().slice(0, 200);
    if (league.overview?.trim()) {
      body.description = league.overview.trim().slice(0, MAX_TEXT_LENGTH);
    }

    await this.request<unknown>('POST', '/leagues', body, {
      maxContentLength: MAX_SERVARR_LIBRARY_RESPONSE_BYTES,
    });
    // Read back from the canonical native library. A successful response body
    // alone does not prove Sportarr accepted monitoring or persisted the item.
    return (await this.getLibraryLeagues()).find(
      (entry) => entry.externalId === league.externalId
    );
  }

  public async getLeagueCover(
    leagueIdentity: number | string
  ): Promise<SportarrCoverImage> {
    const league =
      typeof leagueIdentity === 'number'
        ? await this.getLeagueById(leagueIdentity)
        : await this.getLeagueByExternalId(leagueIdentity);
    if (!league) throw new Error('Sportarr league not found');
    const coverImages = league.images.filter((image) => {
      const type = image.coverType?.toLowerCase();
      return !type || ['poster', 'cover', 'logo'].includes(type);
    });
    const candidateUrls = [
      ...coverImages
        .map((image) => image.url)
        .filter((url): url is string => !!url)
        .map((url) => this.buildCoverUrl(url)),
      ...coverImages
        .map((image) => image.remoteUrl)
        .filter((url): url is string => !!url)
        .map((url) => this.buildRemoteCoverUrl(url)),
    ].filter((url): url is string => !!url);

    let lastError: unknown;
    for (const coverUrl of [...new Set(candidateUrls)]) {
      try {
        if (!isServarrServiceUrl(coverUrl, this.coverBaseUrl)) {
          return await fetchSafeRemoteImage(coverUrl);
        }
        const response = await this.axios.get<ArrayBuffer>(coverUrl, {
          responseType: 'arraybuffer',
          maxContentLength: MAX_SAFE_REMOTE_IMAGE_BYTES,
          headers: { Accept: 'image/*' },
        });
        return normalizeSafeRasterImage(
          response.data,
          response.headers['content-type']
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `[Sportarr] Failed to retrieve cover for league ${leagueIdentity}: ${lastError instanceof Error ? lastError.message : 'No advertised cover was available'}`,
      { cause: lastError }
    );
  }
}

export default SportarrAPI;
