import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeIsbn } from '@server/lib/isbn';
import logger from '@server/logger';
import {
  fetchSafeRemoteImage,
  MAX_SAFE_REMOTE_IMAGE_BYTES,
  normalizeSafeRasterImage,
} from '@server/utils/safeRemoteImage';
import { trimTrailingSlashes } from '@server/utils/serviceUrl';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';
import ServarrBase, {
  isServarrServiceUrl,
  MAX_SERVARR_CONFIGURATION_RESULTS,
  MAX_SERVARR_LIBRARY_RESULTS,
  MAX_SERVARR_LOOKUP_RESULTS,
  sanitizeServarrImages,
  sanitizeServarrProfiles,
  sanitizeServarrRecordArray,
  sanitizeServarrSystemStatus,
  type ServarrCommand,
  type SystemStatus,
} from './base';

export interface ReadarrMetadataProfile {
  id: number;
  name: string;
}

export interface ReadarrDevelopmentConfig {
  id: number;
  metadataSource?: string;
}

export type ReadarrMediaType = 'ebook' | 'audiobook';
type ChaptarrDialect = 'hc' | 'gr';
const CHAPTARR_REQUEST_TIMEOUT_MS = 60_000;
const CHAPTARR_LIBRARY_PAGE_SIZE = 500;

export interface ReadarrBookLookupResult {
  id?: number;
  title: string;
  titleSlug?: string;
  foreignBookId: string;
  foreignEditionId?: string;
  mediaType?: ReadarrMediaType;
  audiobookMonitored?: boolean;
  ebookMonitored?: boolean;
  addOptions?: {
    searchForNewBook?: boolean;
  };
  authorId?: number;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitored?: boolean;
  tags?: number[];
  authorTitle?: string;
  seriesTitle?: string;
  releaseDate?: string;
  audiobookDuration?: number;
  audioSeconds?: number;
  durationSeconds?: number;
  narrators?: string[];
  author?: {
    foreignAuthorId?: string;
    authorName?: string;
    id?: number;
    rootFolderPath?: string;
    qualityProfileId?: number;
    metadataProfileId?: number;
    monitored?: boolean;
    monitorNewItems?: string;
    addOptions?: {
      monitor?: string;
      searchForMissingBooks?: boolean;
      booksToMonitor?: string[];
    };
    manualAdd?: boolean;
  };
  editions?: {
    foreignEditionId: string;
    title: string;
    isbn13?: string;
    asin?: string;
    monitored: boolean;
    audiobookDuration?: number;
    audioSeconds?: number;
    durationSeconds?: number;
    narrators?: string[];
    contributors?: { name?: string; role?: string }[];
  }[];
  images?: ReadarrBookImage[];
}

export interface ReadarrBookImage {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
}

export interface ReadarrAuthorLookupResult {
  id?: number;
  foreignAuthorId: string;
  authorName: string;
  titleSlug?: string;
  remotePoster?: string;
  images?: ReadarrBookImage[];
}

export interface ReadarrEdition {
  foreignEditionId: string;
  title: string;
  isbn13?: string;
  asin?: string;
  monitored: boolean;
}

export interface ReadarrBookOptions extends ReadarrBookLookupResult {
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  useRequestedEdition?: boolean;
  tags?: number[];
  addOptions?: {
    searchForNewBook: boolean;
  };
}

export interface ReadarrBook extends ReadarrBookLookupResult {
  id: number;
  titleSlug?: string;
  added?: string;
  statistics?: {
    bookFileCount?: number;
    totalBookCount?: number;
  };
}

export interface ReadarrBookFile {
  id: number;
  bookId: number;
  path?: string;
  relativePath?: string;
  size: number;
}

interface PagedReadarrBooksResponse {
  records?: unknown;
  totalCount?: unknown;
  offset?: unknown;
  pageSize?: unknown;
}

export interface ReadarrAddBookResult extends ReadarrBookLookupResult {
  createdBook: boolean;
  createdAuthor: boolean;
  pending?: true;
  pendingId?: number;
  message?: string;
}

export interface ReadarrPendingAuthorImport {
  id: number;
  overallStatus?: string;
  ebookStatus?: string;
  audiobookStatus?: string;
  lastError?: string;
}

type ReadarrQueueItem = {
  bookId?: number;
  book?: {
    id?: number;
  };
};

export interface ReadarrHistoryItem {
  id: number;
  bookId?: number;
  eventType?: string;
  date?: string;
  downloadId?: string;
}

export type ReadarrCoverImage = {
  imageBuffer: Buffer;
  contentType: string;
};

const getReadarrErrorMessage = (error: unknown): string => {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const status = error.response?.status;
  const data = error.response?.data as
    { message?: unknown; errorMessage?: unknown } | undefined;
  const message =
    typeof data?.message === 'string'
      ? data.message
      : typeof data?.errorMessage === 'string'
        ? data.errorMessage
        : error.message;

  return status ? `${message} (status ${status})` : message;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeReadarrBookFile = (
  value: unknown
): ReadarrBookFile | undefined => {
  if (!isRecord(value)) return undefined;
  const id = Number(value.id);
  const bookId = Number(value.bookId);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(bookId) ||
    bookId <= 0
  ) {
    return undefined;
  }
  const path =
    typeof value.path === 'string' ? value.path.slice(0, 10_000) : '';
  const relativePath =
    typeof value.relativePath === 'string'
      ? value.relativePath.slice(0, 10_000)
      : '';
  const size = Number(value.size);
  return {
    id,
    bookId,
    path: path || undefined,
    relativePath: relativePath || undefined,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
  };
};

const isReadarrBookLookupResult = (
  value: unknown
): value is ReadarrBookLookupResult =>
  isRecord(value) &&
  typeof value.title === 'string' &&
  typeof value.foreignBookId === 'string';

const normalizeProviderIdentity = (
  value?: string,
  edition = false
): string | undefined => {
  if (!value?.trim()) return undefined;

  const openLibraryId = edition
    ? normalizeOpenLibraryEditionId(value)
    : normalizeOpenLibraryWorkId(value);
  return (openLibraryId ?? value).trim().toLowerCase();
};

export const matchesReadarrBookProviderIdentity = (
  book: ReadarrBookLookupResult,
  providerBookId: string,
  providerEditionId?: string
): boolean => {
  const normalizedBookId = normalizeProviderIdentity(providerBookId);
  const normalizedEditionId = normalizeProviderIdentity(
    providerEditionId,
    true
  );

  return (
    (!!normalizedBookId &&
      normalizeProviderIdentity(book.foreignBookId) === normalizedBookId) ||
    (!!normalizedEditionId &&
      (normalizeProviderIdentity(book.foreignEditionId, true) ===
        normalizedEditionId ||
        (book.editions ?? []).some(
          (edition) =>
            normalizeProviderIdentity(edition.foreignEditionId, true) ===
            normalizedEditionId
        )))
  );
};

class ReadarrAPI extends ServarrBase<ReadarrQueueItem> {
  private readonly nativeApiUrl: string;
  private readonly mediaType?: ReadarrMediaType;
  private coverBaseUrl: string;
  private requestBaseUrl?: string;
  private chaptarrDialect?: ChaptarrDialect;
  private detectedSystemStatus?: Pick<
    SystemStatus,
    'appName' | 'version' | 'urlBase'
  >;
  private providerDetection?: Promise<void>;

  constructor({
    url,
    apiKey,
    mediaType,
  }: {
    url: string;
    apiKey: string;
    mediaType?: ReadarrMediaType;
  }) {
    super({
      url,
      apiKey,
      cacheName: 'readarr',
      apiName: 'Readarr',
      requestParams: mediaType ? { mediaType } : undefined,
    });
    this.nativeApiUrl = trimTrailingSlashes(url);
    this.mediaType = mediaType;
    this.coverBaseUrl = ReadarrAPI.buildCoverBaseUrl(url);
  }

  private static isChaptarrStatus(status: { appName?: string }): boolean {
    return status.appName?.trim().toLowerCase() === 'chaptarr';
  }

  private static buildChaptarrFacadeUrl(
    apiUrl: string,
    mediaType: ReadarrMediaType,
    dialect: ChaptarrDialect
  ): string {
    try {
      const parsedUrl = new URL(apiUrl);
      const apiPath = parsedUrl.pathname.match(/^(.*)\/api\/v\d+\/?$/i);

      if (!apiPath) {
        return apiUrl;
      }

      parsedUrl.pathname = `${apiPath[1]}/readarr/${dialect}/${mediaType}/api/v1`;
      parsedUrl.search = '';
      parsedUrl.hash = '';
      return trimTrailingSlashes(parsedUrl.toString());
    } catch {
      return apiUrl;
    }
  }

  private async detectChaptarrDialect(): Promise<ChaptarrDialect> {
    try {
      const response = await super.request<unknown>(
        'GET',
        '/config/hardcover',
        undefined,
        this.getRequestConfig()
      );

      if (
        response.data &&
        typeof response.data === 'object' &&
        !Array.isArray(response.data) &&
        typeof (response.data as Record<string, unknown>).enabled === 'boolean'
      ) {
        return (response.data as Record<string, unknown>).enabled ? 'hc' : 'gr';
      }
    } catch {
      // Older Chaptarr builds do not expose the Hardcover config endpoint.
      // Their native compatibility scope defaults to Hardcover.
    }

    return 'hc';
  }

  private async ensureProvider(): Promise<void> {
    if (!this.mediaType) {
      return;
    }

    if (this.providerDetection) {
      return this.providerDetection;
    }

    this.providerDetection = (async () => {
      const response = await super.request<unknown>(
        'GET',
        '/system/status',
        undefined,
        this.getRequestConfig()
      );
      const status = sanitizeServarrSystemStatus(response.data);
      this.detectedSystemStatus = status;

      if (this.mediaType && ReadarrAPI.isChaptarrStatus(status)) {
        this.axios.defaults.timeout = Math.max(
          this.axios.defaults.timeout ?? 0,
          CHAPTARR_REQUEST_TIMEOUT_MS
        );
        this.chaptarrDialect = await this.detectChaptarrDialect();
        this.requestBaseUrl = ReadarrAPI.buildChaptarrFacadeUrl(
          this.nativeApiUrl,
          this.mediaType,
          this.chaptarrDialect
        );
      }
    })();

    try {
      await this.providerDetection;
    } catch (error) {
      this.providerDetection = undefined;
      throw error;
    }
  }

  public override async getSystemStatus(): Promise<
    Pick<SystemStatus, 'appName' | 'version' | 'urlBase'>
  > {
    if (!this.mediaType) {
      return super.getSystemStatus();
    }

    try {
      await this.ensureProvider();
      return this.detectedSystemStatus as Pick<
        SystemStatus,
        'appName' | 'version' | 'urlBase'
      >;
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve system status: ${getReadarrErrorMessage(e)}`,
        { cause: e }
      );
    }
  }

  protected override async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    await this.ensureProvider();

    return super.request(
      method,
      endpoint,
      data,
      this.requestBaseUrl && !config?.baseURL
        ? { ...config, baseURL: this.requestBaseUrl }
        : config
    );
  }

  private isChaptarr(): boolean {
    return ReadarrAPI.isChaptarrStatus(this.detectedSystemStatus ?? {});
  }

  private static hasAddressableLookupIdentity(
    result: ReadarrBookLookupResult
  ): boolean {
    return (
      !!result.foreignBookId?.trim() &&
      !!result.author?.foreignAuthorId?.trim() &&
      (result.editions ?? []).some(
        (edition) => !!edition.foreignEditionId?.trim()
      )
    );
  }

  private getMediaMonitoringFields(
    monitored: boolean
  ): Record<string, boolean> {
    if (this.mediaType === 'audiobook') {
      return { audiobookMonitored: monitored };
    }

    if (this.mediaType === 'ebook') {
      return { ebookMonitored: monitored };
    }

    return {};
  }

  private isBookMonitored(book: ReadarrBookLookupResult): boolean {
    const mediaSpecificMonitoring =
      this.mediaType === 'audiobook'
        ? book.audiobookMonitored
        : this.mediaType === 'ebook'
          ? book.ebookMonitored
          : undefined;

    return typeof mediaSpecificMonitoring === 'boolean'
      ? mediaSpecificMonitoring
      : book.monitored === true;
  }

  private async resolveBookMutationResult(
    result: ReadarrBookLookupResult | number,
    fallback: ReadarrBookLookupResult
  ): Promise<ReadarrBookLookupResult> {
    if (typeof result !== 'number') {
      return result;
    }

    return this.getFreshBook(result).catch(() => ({
      ...fallback,
      id: result,
    }));
  }

  private async getFreshBook(bookId: number): Promise<ReadarrBook> {
    const response = await this.request<ReadarrBook>(
      'GET',
      `/book/${bookId}`,
      undefined,
      this.getRequestConfig()
    );
    return response.data;
  }

  public async getBookHistory(bookId: number): Promise<ReadarrHistoryItem[]> {
    const response = await this.request<{
      records?: ReadarrHistoryItem[];
    }>(
      'GET',
      '/history',
      undefined,
      this.getRequestConfig({
        page: 1,
        pageSize: 100,
        sortKey: 'date',
        sortDirection: 'descending',
        bookId,
      })
    );
    return sanitizeServarrRecordArray<ReadarrHistoryItem>(
      response.data?.records,
      100
    );
  }

  public async getBooksByAuthor(
    authorId: number,
    cacheTtl?: number
  ): Promise<ReadarrBook[]> {
    return sanitizeServarrRecordArray<ReadarrBook>(
      await this.get<ReadarrBook[]>(
        '/book',
        {
          ...this.getRequestConfig({ authorId }),
        },
        cacheTtl
      ),
      MAX_SERVARR_LIBRARY_RESULTS
    );
  }

  public async removeAuthor(
    authorId: number,
    options: { deleteFiles?: boolean; addImportListExclusion?: boolean } = {}
  ): Promise<void> {
    await this.request(
      'DELETE',
      `/author/${authorId}`,
      undefined,
      this.getRequestConfig({
        deleteFiles: options.deleteFiles ?? false,
        addImportListExclusion: options.addImportListExclusion ?? false,
      })
    );
  }

  private async ensureRequestedBookState(
    addedBook: ReadarrBookLookupResult,
    options: ReadarrBookOptions
  ): Promise<ReadarrBookLookupResult> {
    if (
      !this.isChaptarr() ||
      !this.mediaType ||
      !options.monitored ||
      !addedBook.id
    ) {
      return addedBook;
    }

    const observedBook = await this.getFreshBook(addedBook.id).catch(
      () => addedBook
    );
    const needsMonitoringRepair = !this.isBookMonitored(observedBook);
    const needsSearchRepair =
      options.addOptions?.searchForNewBook === true &&
      observedBook.addOptions?.searchForNewBook !== true;

    if (!needsMonitoringRepair && !needsSearchRepair) {
      return observedBook;
    }

    const updatedBookResponse = await this.request<
      ReadarrBookLookupResult | number
    >(
      'PUT',
      `/book/${addedBook.id}`,
      {
        id: addedBook.id,
        mediaType: this.mediaType,
        monitored: true,
        ...this.getMediaMonitoringFields(true),
        ...(options.addOptions?.searchForNewBook
          ? {
              addOptions: {
                ...(observedBook.addOptions ?? {}),
                searchForNewBook: true,
              },
            }
          : {}),
      },
      this.getRequestConfig()
    );
    const updatedBook = await this.resolveBookMutationResult(
      updatedBookResponse.data,
      {
        ...addedBook,
        monitored: true,
        ...this.getMediaMonitoringFields(true),
        ...(options.addOptions?.searchForNewBook
          ? { addOptions: options.addOptions }
          : {}),
      }
    );

    if (options.addOptions?.searchForNewBook) {
      await this.post(
        '/command',
        {
          name: 'BookSearch',
          bookIds: [updatedBook.id ?? addedBook.id],
        },
        this.getRequestConfig()
      );
    }

    return updatedBook;
  }

  private static buildCoverBaseUrl(url: string): string {
    const parsedUrl = new URL(url);
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/api\/v\d+\/?$/i, '');
    parsedUrl.search = '';
    parsedUrl.hash = '';

    return parsedUrl.toString().replace(/\/$/, '');
  }

  private buildCoverUrl(path: string): string | undefined {
    if (!path.startsWith('/') || path.includes('://')) {
      return undefined;
    }

    return `${this.coverBaseUrl}${path}`;
  }

  private buildRemoteCoverUrl(url: string): string | undefined {
    if (url.length > 2_048) {
      return undefined;
    }

    try {
      const parsedUrl = new URL(url);

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return undefined;
      }

      return parsedUrl.toString();
    } catch {
      return undefined;
    }
  }

  public async getMetadataProfiles(): Promise<ReadarrMetadataProfile[]> {
    try {
      return sanitizeServarrProfiles(
        await this.get<ReadarrMetadataProfile[]>(
          '/metadataProfile',
          this.getRequestConfig()
        )
      );
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve metadata profiles: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getDevelopmentConfig(): Promise<ReadarrDevelopmentConfig> {
    try {
      const response = await this.get<unknown>(
        '/config/development',
        this.getRequestConfig()
      );
      if (
        !response ||
        typeof response !== 'object' ||
        Array.isArray(response)
      ) {
        return { id: 0 };
      }
      const record = response as Record<string, unknown>;
      return {
        id: Number.isSafeInteger(record.id) ? (record.id as number) : 0,
        metadataSource:
          typeof record.metadataSource === 'string'
            ? record.metadataSource.slice(0, 10_000)
            : undefined,
      };
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve development config: ${e.message}`,
        { cause: e }
      );
    }
  }

  private static matchesExistingBook(
    book: ReadarrBookLookupResult,
    options: ReadarrBookOptions
  ): boolean {
    const normalizedForeignBookId = options.foreignBookId
      ? normalizeOpenLibraryWorkId(options.foreignBookId)
      : undefined;
    const optionEditionIds = new Set(
      options.editions
        ?.map((edition) =>
          edition.foreignEditionId
            ? normalizeOpenLibraryEditionId(edition.foreignEditionId)
            : undefined
        )
        .filter(Boolean)
    );
    const optionIsbns = new Set(
      options.editions
        ?.map((edition) => normalizeIsbn(edition.isbn13))
        .filter(Boolean)
    );

    if (
      book.foreignBookId &&
      normalizedForeignBookId &&
      normalizeOpenLibraryWorkId(book.foreignBookId) === normalizedForeignBookId
    ) {
      return true;
    }

    return (
      book.editions?.some((edition) => {
        const editionIsbn = normalizeIsbn(edition.isbn13);

        return (
          (!!edition.foreignEditionId &&
            optionEditionIds.has(
              normalizeOpenLibraryEditionId(edition.foreignEditionId)
            )) ||
          (!!editionIsbn && optionIsbns.has(editionIsbn))
        );
      }) ?? false
    );
  }

  private async findExistingBookForAdd(
    options: ReadarrBookOptions
  ): Promise<ReadarrBook | undefined> {
    if (this.isChaptarr()) {
      // Chaptarr's POST /book is provider-aware and resolves existing local
      // rows in its indexed database. Only use a positive ID already returned
      // by a lookup as a targeted read; never scan the whole library here.
      const bookId = options.id;
      if (
        typeof bookId !== 'number' ||
        !Number.isSafeInteger(bookId) ||
        bookId <= 0
      ) {
        return undefined;
      }

      try {
        const existingBook = await this.getBook(bookId);
        return ReadarrAPI.matchesExistingBook(existingBook, options)
          ? existingBook
          : undefined;
      } catch (error) {
        logger.debug(
          'Chaptarr targeted existing-book lookup failed; letting the provider resolve the add.',
          {
            label: 'Readarr',
            bookId,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          }
        );
        return undefined;
      }
    }

    const existingBooks = sanitizeServarrRecordArray<ReadarrBook>(
      await this.get<ReadarrBook[]>('/book', this.getRequestConfig()),
      MAX_SERVARR_LIBRARY_RESULTS
    );

    return existingBooks.find((book) =>
      ReadarrAPI.matchesExistingBook(book, options)
    );
  }

  private async getChaptarrBooks(): Promise<ReadarrBook[]> {
    const books: ReadarrBook[] = [];
    let offset = 0;
    let reportedTotalCount: number | undefined;

    while (books.length < MAX_SERVARR_LIBRARY_RESULTS) {
      const response = await this.get<unknown>(
        '/book/paged',
        this.getRequestConfig({
          offset,
          pageSize: CHAPTARR_LIBRARY_PAGE_SIZE,
          includeUnmonitored: true,
        })
      );
      if (
        !response ||
        typeof response !== 'object' ||
        Array.isArray(response) ||
        !Array.isArray((response as PagedReadarrBooksResponse).records)
      ) {
        throw new Error('Chaptarr returned an invalid paged library response');
      }

      const payload = response as PagedReadarrBooksResponse;
      const responsePageSize =
        typeof payload.pageSize === 'number' &&
        Number.isSafeInteger(payload.pageSize) &&
        payload.pageSize > 0
          ? payload.pageSize
          : CHAPTARR_LIBRARY_PAGE_SIZE;
      const responseOffset =
        typeof payload.offset === 'number' &&
        Number.isSafeInteger(payload.offset) &&
        payload.offset >= 0
          ? payload.offset
          : offset;
      if (responseOffset !== offset) {
        throw new Error(
          `Chaptarr returned offset ${responseOffset} when SeerrNG requested ${offset}`
        );
      }
      const totalCount =
        typeof payload.totalCount === 'number' &&
        Number.isSafeInteger(payload.totalCount) &&
        payload.totalCount >= 0
          ? payload.totalCount
          : undefined;
      if (totalCount !== undefined) {
        reportedTotalCount = totalCount;
      }
      const page = sanitizeServarrRecordArray<ReadarrBook>(
        payload.records,
        Math.min(
          CHAPTARR_LIBRARY_PAGE_SIZE,
          MAX_SERVARR_LIBRARY_RESULTS - books.length
        )
      );

      if (page.length === 0) {
        if (totalCount !== undefined && responseOffset < totalCount) {
          throw new Error(
            `Chaptarr returned an empty page before the reported library total of ${totalCount}`
          );
        }
        break;
      }

      books.push(...page);
      const nextOffset = responseOffset + page.length;

      if (nextOffset <= offset) {
        throw new Error('Chaptarr returned a non-advancing library page');
      }

      if (totalCount !== undefined && nextOffset >= totalCount) {
        break;
      }

      if (totalCount === undefined && page.length < responsePageSize) {
        break;
      }

      offset = nextOffset;
    }

    if (
      books.length >= MAX_SERVARR_LIBRARY_RESULTS &&
      (reportedTotalCount === undefined || reportedTotalCount > books.length)
    ) {
      throw new Error(
        `Chaptarr library scan reached the ${MAX_SERVARR_LIBRARY_RESULTS}-book safety limit before confirming the library was complete`
      );
    }

    return books;
  }

  public async getBooks(): Promise<ReadarrBook[]> {
    try {
      await this.ensureProvider();

      if (this.isChaptarr()) {
        return await this.getChaptarrBooks();
      }

      return sanitizeServarrRecordArray<ReadarrBook>(
        await this.get<ReadarrBook[]>('/book', this.getRequestConfig()),
        MAX_SERVARR_LIBRARY_RESULTS
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to retrieve books: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getBook(
    bookId: number,
    cacheTtl?: number
  ): Promise<ReadarrBook> {
    try {
      return await this.get<ReadarrBook>(
        `/book/${bookId}`,
        this.getRequestConfig(),
        cacheTtl
      );
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve book ${bookId}: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getBookFiles(bookId: number): Promise<ReadarrBookFile[]> {
    try {
      await this.ensureProvider();
      const response = await this.request<unknown[]>(
        'GET',
        '/bookfile',
        undefined,
        this.getRequestConfig({ bookId })
      );
      return sanitizeServarrRecordArray<Record<string, unknown>>(
        response.data,
        MAX_SERVARR_LIBRARY_RESULTS
      ).flatMap((file) => {
        const normalized = sanitizeReadarrBookFile(file);
        return normalized ? [normalized] : [];
      });
    } catch (error) {
      throw new Error(
        `[Readarr] Failed to retrieve book files: ${error.message}`,
        {
          cause: error,
        }
      );
    }
  }

  public async getBookIfExists(bookId: number): Promise<ReadarrBook | null> {
    try {
      const response = await this.request<ReadarrBook>(
        'GET',
        `/book/${bookId}`,
        undefined,
        this.getRequestConfig()
      );
      return response.data;
    } catch (e) {
      if (e?.response?.status === 404) {
        return null;
      }
      throw new Error(
        `[Readarr] Failed to retrieve book ${bookId}: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getBookCover(bookId: number): Promise<ReadarrCoverImage> {
    const book = await this.getBook(bookId).catch(() => undefined);
    const images = sanitizeServarrImages(book?.images);
    const advertisedCoverPaths = images
      .filter((image) => {
        const coverType = image.coverType?.toLowerCase();
        return !coverType || coverType === 'cover' || coverType === 'poster';
      })
      .map((image) => image.url)
      .filter((url): url is string => !!url && url.startsWith('/'));
    const candidatePaths = [
      ...advertisedCoverPaths,
      `/MediaCover/${bookId}/cover.jpg`,
      `/MediaCover/${bookId}/poster.jpg`,
    ];
    const remoteCoverUrls = images
      .filter((image) => {
        const coverType = image.coverType?.toLowerCase();
        return !coverType || coverType === 'cover' || coverType === 'poster';
      })
      .map((image) => image.remoteUrl)
      .filter((url): url is string => !!url)
      .map((url) => this.buildRemoteCoverUrl(url))
      .filter((url): url is string => !!url);
    const candidateUrls = [
      ...candidatePaths.map((path) => this.buildCoverUrl(path)),
      ...remoteCoverUrls,
    ].filter((url): url is string => !!url);
    const uniqueCandidateUrls = [...new Set(candidateUrls)];
    let lastError: unknown;

    for (const coverUrl of uniqueCandidateUrls) {
      try {
        const isLocalCoverUrl = isServarrServiceUrl(
          coverUrl,
          this.coverBaseUrl
        );
        if (!isLocalCoverUrl) {
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
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(
      `[Readarr] Failed to retrieve cover for book ${bookId}: ${
        lastError instanceof Error ? lastError.message : 'No cover path worked'
      }`,
      { cause: lastError }
    );
  }

  public async getAuthorCover(authorId: number): Promise<ReadarrCoverImage> {
    if (!Number.isSafeInteger(authorId) || authorId <= 0) {
      throw new Error('[Readarr] Invalid author ID for cover lookup.');
    }

    const author = await this.get<ReadarrAuthorLookupResult>(
      `/author/${authorId}`,
      this.getRequestConfig()
    );
    const posterImages = sanitizeServarrImages(author?.images).filter(
      (image) => {
        const coverType = image.coverType?.toLowerCase();
        return !coverType || coverType === 'poster' || coverType === 'headshot';
      }
    );
    const candidatePaths = posterImages
      .map((image) => image.url)
      .filter((url): url is string => !!url && url.startsWith('/'));
    const candidateUrls = [
      ...candidatePaths.map((path) => this.buildCoverUrl(path)),
      ...posterImages
        .map((image) => image.remoteUrl)
        .filter((url): url is string => !!url)
        .map((url) => this.buildRemoteCoverUrl(url)),
      this.buildCoverUrl(`/MediaCover/${authorId}/poster.jpg`),
      author?.remotePoster
        ? this.buildRemoteCoverUrl(author.remotePoster)
        : undefined,
    ].filter((url): url is string => !!url);
    let lastError: unknown;

    for (const coverUrl of [...new Set(candidateUrls)]) {
      try {
        const isLocalCoverUrl = isServarrServiceUrl(
          coverUrl,
          this.coverBaseUrl
        );
        if (!isLocalCoverUrl) {
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
      `[Readarr] Failed to retrieve cover for author ${authorId}: ${
        lastError instanceof Error ? lastError.message : 'No poster path worked'
      }`,
      { cause: lastError }
    );
  }

  public async getEditions(bookId: number): Promise<ReadarrEdition[]> {
    try {
      return sanitizeServarrRecordArray<ReadarrEdition>(
        await this.get<ReadarrEdition[]>('/edition', {
          ...this.getRequestConfig({ bookId }),
        }),
        MAX_SERVARR_CONFIGURATION_RESULTS
      );
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve editions for book ${bookId}: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async lookupBook(term: string): Promise<ReadarrBookLookupResult[]> {
    try {
      let scopedResults: ReadarrBookLookupResult[] = [];

      try {
        scopedResults = sanitizeServarrRecordArray<ReadarrBookLookupResult>(
          await this.get<ReadarrBookLookupResult[]>('/book/lookup', {
            ...this.getRequestConfig({ term }),
          }),
          MAX_SERVARR_LOOKUP_RESULTS
        );
      } catch (error) {
        if (!this.isChaptarr()) {
          throw error;
        }

        logger.warn(
          'Chaptarr format facade lookup failed; trying compatible scopes.',
          {
            label: 'Readarr',
            mediaType: this.mediaType,
            term,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          }
        );
      }

      if (
        !this.isChaptarr() ||
        !this.mediaType ||
        scopedResults.some(ReadarrAPI.hasAddressableLookupIdentity)
      ) {
        return scopedResults;
      }

      const alternateDialect: ChaptarrDialect =
        this.chaptarrDialect === 'gr' ? 'hc' : 'gr';
      const alternateBaseUrl = ReadarrAPI.buildChaptarrFacadeUrl(
        this.nativeApiUrl,
        this.mediaType,
        alternateDialect
      );

      try {
        const alternateResults =
          sanitizeServarrRecordArray<ReadarrBookLookupResult>(
            await this.get<ReadarrBookLookupResult[]>('/book/lookup', {
              ...this.getRequestConfig({ term }),
              baseURL: alternateBaseUrl,
            }),
            MAX_SERVARR_LOOKUP_RESULTS
          );

        if (alternateResults.some(ReadarrAPI.hasAddressableLookupIdentity)) {
          this.chaptarrDialect = alternateDialect;
          this.requestBaseUrl = alternateBaseUrl;
          logger.info(
            'Chaptarr selected an alternate provider facade with addressable lookup results.',
            {
              label: 'Readarr',
              dialect: alternateDialect,
              mediaType: this.mediaType,
              term,
              resultCount: alternateResults.length,
            }
          );
          return alternateResults;
        }
      } catch (error) {
        logger.warn('Chaptarr alternate provider facade lookup failed.', {
          label: 'Readarr',
          dialect: alternateDialect,
          mediaType: this.mediaType,
          term,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const nativeResults =
          sanitizeServarrRecordArray<ReadarrBookLookupResult>(
            await this.get<ReadarrBookLookupResult[]>('/book/lookup', {
              baseURL: this.nativeApiUrl,
              params: { term },
            }),
            MAX_SERVARR_LOOKUP_RESULTS
          );

        const formatResults = nativeResults.filter(
          (result) => result.mediaType === this.mediaType
        );

        if (formatResults.length > 0) {
          logger.info(
            'Chaptarr provider facades returned no addressable lookup results; using native provider lookup results.',
            {
              label: 'Readarr',
              mediaType: this.mediaType,
              term,
              resultCount: formatResults.length,
            }
          );
          return formatResults;
        }

        // Chaptarr 0.9.911 can return only audiobook metadata from its native
        // lookup even when an ebook facade is configured. The add endpoint
        // still accepts that provider-backed record when the requested media
        // type is supplied, so keep the usable identity instead of turning a
        // valid request into a local "book not found" failure.
        const crossFormatResults = nativeResults
          .filter(ReadarrAPI.hasAddressableLookupIdentity)
          .map((result) => ({ ...result, mediaType: this.mediaType }));

        if (crossFormatResults.length > 0) {
          logger.warn(
            'Chaptarr returned no lookup results for the requested format; using addressable native metadata as an add seed.',
            {
              label: 'Readarr',
              requestedMediaType: this.mediaType,
              nativeMediaType: nativeResults.find((result) => result.mediaType)
                ?.mediaType,
              term,
              resultCount: crossFormatResults.length,
            }
          );
          return crossFormatResults;
        }
      } catch (error) {
        logger.warn('Chaptarr native lookup fallback failed.', {
          label: 'Readarr',
          mediaType: this.mediaType,
          term,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }

      return scopedResults;
    } catch (e) {
      throw new Error(`[Readarr] Failed to lookup book: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async lookupBookByProviderIdentity(
    providerBookId: string,
    providerEditionId?: string
  ): Promise<ReadarrBookLookupResult | undefined> {
    await this.ensureProvider();
    const terms = [...new Set([providerBookId, providerEditionId])].filter(
      (term): term is string => !!term?.trim()
    );

    for (const term of terms) {
      const results = await this.lookupBook(term);
      const match = results.find((book) =>
        matchesReadarrBookProviderIdentity(
          book,
          providerBookId,
          providerEditionId
        )
      );
      if (match) return match;
    }

    return undefined;
  }

  public async getPendingAuthorImport(
    pendingId: number
  ): Promise<ReadarrPendingAuthorImport | undefined> {
    await this.ensureProvider();
    if (
      !this.isChaptarr() ||
      !Number.isSafeInteger(pendingId) ||
      pendingId <= 0
    ) {
      return undefined;
    }

    try {
      const response = await this.get<unknown>(
        `/pendingauthorimport/${pendingId}`,
        this.getRequestConfig(),
        0
      );
      if (!isRecord(response)) return undefined;

      const readText = (value: unknown): string | undefined =>
        typeof value === 'string' ? value.slice(0, 10_000) : undefined;
      const status = (camel: string, pascal: string): string | undefined =>
        readText(response[camel] ?? response[pascal]);
      const responseId = Number(response.id ?? response.Id);

      return {
        id: Number.isSafeInteger(responseId) ? responseId : pendingId,
        overallStatus: status('overallStatus', 'OverallStatus'),
        ebookStatus: status('ebookStatus', 'EbookStatus'),
        audiobookStatus: status('audiobookStatus', 'AudiobookStatus'),
        lastError: status('lastError', 'LastError'),
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return undefined;
      }

      throw new Error(
        `[Readarr] Failed to retrieve pending Chaptarr import ${pendingId}: ${getReadarrErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  public async cancelPendingAuthorImport(pendingId: number): Promise<void> {
    await this.ensureProvider();
    if (
      !this.isChaptarr() ||
      !Number.isSafeInteger(pendingId) ||
      pendingId <= 0
    ) {
      return;
    }

    try {
      await this.request(
        'DELETE',
        `/pendingauthorimport/${pendingId}`,
        undefined,
        this.getRequestConfig()
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return;
      }

      throw new Error(
        `[Readarr] Failed to cancel pending Chaptarr import ${pendingId}: ${getReadarrErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  public async lookupAuthor(
    term: string
  ): Promise<ReadarrAuthorLookupResult[]> {
    try {
      return sanitizeServarrRecordArray<ReadarrAuthorLookupResult>(
        await this.get<ReadarrAuthorLookupResult[]>('/author/lookup', {
          ...this.getRequestConfig({ term }),
        }),
        MAX_SERVARR_LOOKUP_RESULTS
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to lookup author: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async addBook(
    options: ReadarrBookOptions
  ): Promise<ReadarrAddBookResult> {
    try {
      await this.ensureProvider();
      const existingBook = await this.findExistingBookForAdd(options);
      const editionUpdate = existingBook
        ? this.getRequestedEditionUpdate(existingBook, options)
        : undefined;

      if (
        existingBook &&
        this.isBookMonitored(existingBook) &&
        !editionUpdate?.changed
      ) {
        logger.info(
          'Book is already monitored in Bookshelf/Readarr. Skipping add and returning success',
          {
            label: 'Readarr',
            bookId: existingBook.id,
            bookTitle: existingBook.title,
          }
        );

        if (this.isChaptarr() && options.addOptions?.searchForNewBook) {
          await this.searchBook(existingBook.id);
        }

        return {
          ...existingBook,
          createdBook: false,
          createdAuthor: false,
        };
      }

      if (existingBook) {
        logger.info(
          editionUpdate?.changed
            ? 'Updating the requested Bookshelf edition.'
            : 'Book exists in Bookshelf/Readarr but is not monitored. Updating monitored status.',
          {
            label: 'Readarr',
            bookId: existingBook.id,
            bookTitle: existingBook.title,
          }
        );

        const updatedBookResponse = await this.request<
          ReadarrBookLookupResult | number
        >(
          'PUT',
          `/book/${existingBook.id}`,
          {
            ...existingBook,
            editions: editionUpdate?.editions ?? existingBook.editions ?? [],
            monitored: true,
            qualityProfileId:
              options.qualityProfileId ?? existingBook.qualityProfileId,
            metadataProfileId:
              options.metadataProfileId ?? existingBook.metadataProfileId,
            rootFolderPath:
              options.rootFolderPath ?? existingBook.rootFolderPath,
            tags: options.tags ?? existingBook.tags,
            ...(this.isChaptarr() ? this.getMediaMonitoringFields(true) : {}),
            ...(this.isChaptarr() && options.addOptions
              ? { addOptions: options.addOptions }
              : {}),
          },
          this.getRequestConfig()
        );
        const updatedBook = await this.resolveBookMutationResult(
          updatedBookResponse.data,
          {
            ...existingBook,
            editions: editionUpdate?.editions ?? existingBook.editions ?? [],
            monitored: true,
            ...(this.isChaptarr() ? this.getMediaMonitoringFields(true) : {}),
            ...(this.isChaptarr() && options.addOptions
              ? { addOptions: options.addOptions }
              : {}),
          }
        );

        if (options.addOptions?.searchForNewBook) {
          await this.post(
            '/command',
            {
              name: 'BookSearch',
              bookIds: [updatedBook.id ?? existingBook.id],
            },
            this.getRequestConfig()
          );
        }

        return {
          ...updatedBook,
          createdBook: false,
          createdAuthor: false,
        };
      }

      const existingAuthors = this.isChaptarr()
        ? []
        : sanitizeServarrRecordArray<ReadarrAuthorLookupResult>(
            await this.get<ReadarrAuthorLookupResult[]>(
              '/author',
              this.getRequestConfig()
            ),
            MAX_SERVARR_LIBRARY_RESULTS
          );
      const createdAuthor =
        !this.isChaptarr() &&
        !existingAuthors.some(
          (author) =>
            !!author.foreignAuthorId &&
            author.foreignAuthorId === options.author?.foreignAuthorId
        );

      const postedBook = await this.post<
        ReadarrBookLookupResult | number | Record<string, unknown>
      >(
        '/book',
        {
          ...this.getBookAddPayload(options),
          ...(this.isChaptarr()
            ? this.getMediaMonitoringFields(options.monitored)
            : {}),
        },
        this.getRequestConfig()
      );

      if (this.isChaptarr() && isRecord(postedBook)) {
        const pendingIdValue = postedBook.pendingId ?? postedBook.PendingId;
        if (pendingIdValue !== undefined) {
          const pendingId = Number(pendingIdValue);
          if (!Number.isSafeInteger(pendingId) || pendingId <= 0) {
            throw new Error('Chaptarr returned an invalid pending add ID.');
          }

          return {
            ...options,
            id: undefined,
            pending: true,
            pendingId,
            message:
              typeof (postedBook.message ?? postedBook.Message) === 'string'
                ? String(postedBook.message ?? postedBook.Message).slice(
                    0,
                    10_000
                  )
                : undefined,
            createdBook: false,
            createdAuthor: false,
          };
        }
      }

      let addedBook: ReadarrBookLookupResult;
      if (typeof postedBook === 'number') {
        addedBook = {
          ...(this.getBookAddPayload(
            options
          ) as unknown as ReadarrBookLookupResult),
          id: postedBook,
        };
      } else if (isReadarrBookLookupResult(postedBook)) {
        addedBook = postedBook;
      } else {
        throw new Error('Bookshelf returned an invalid book response.');
      }

      const ensuredBook = await this.ensureRequestedBookState(
        addedBook,
        options
      );
      const persistedBook =
        !this.isChaptarr() && ensuredBook.id
          ? await this.getFreshBook(ensuredBook.id).catch(() => ensuredBook)
          : ensuredBook;
      return {
        ...persistedBook,
        createdBook: true,
        createdAuthor,
      };
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to add book: ${getReadarrErrorMessage(e)}`,
        {
          cause: e,
        }
      );
    }
  }

  private getRequestedEditionUpdate(
    existingBook: ReadarrBookLookupResult,
    options: ReadarrBookOptions
  ): { editions: ReadarrEdition[]; changed: boolean } | undefined {
    if (!options.useRequestedEdition) {
      return undefined;
    }

    const requestedEdition = options.editions?.find(
      (edition) => edition.monitored
    );
    if (!requestedEdition) {
      return undefined;
    }

    const currentEditions = existingBook.editions ?? [];
    const requestedEditionExists = currentEditions.some(
      (edition) =>
        edition.foreignEditionId === requestedEdition.foreignEditionId
    );
    const editions = requestedEditionExists
      ? currentEditions
      : [...currentEditions, requestedEdition];
    const monitoredEditions = editions.map((edition) => ({
      ...edition,
      monitored: edition.foreignEditionId === requestedEdition.foreignEditionId,
    }));

    return {
      editions: monitoredEditions,
      changed:
        monitoredEditions.length !== currentEditions.length ||
        currentEditions.some(
          (edition, index) =>
            edition.monitored !== monitoredEditions[index]?.monitored
        ),
    };
  }

  private getBookAddPayload(
    options: ReadarrBookOptions
  ): Record<string, unknown> {
    const payload = { ...options };
    delete payload.useRequestedEdition;
    return payload;
  }

  public async removeBook(
    bookId: number,
    options: { deleteFiles?: boolean; addImportListExclusion?: boolean } = {}
  ): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/book/${bookId}`,
        undefined,
        this.getRequestConfig({
          deleteFiles: options.deleteFiles ?? true,
          addImportListExclusion: options.addImportListExclusion ?? false,
        })
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to remove book: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async startBookSearch(bookId: number): Promise<ServarrCommand> {
    logger.info('Executing book search command.', {
      label: 'Readarr API',
      bookId,
    });

    try {
      return await this.runCommand('BookSearch', { bookIds: [bookId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Bookshelf/Readarr book search.',
        {
          label: 'Readarr API',
          errorMessage: getReadarrErrorMessage(e),
          bookId,
        }
      );
      throw new Error(
        `[Readarr] Failed to start book search: ${getReadarrErrorMessage(e)}`,
        { cause: e }
      );
    }
  }

  public async searchBook(bookId: number): Promise<void> {
    await this.startBookSearch(bookId);
  }
}

export default ReadarrAPI;
