import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeIsbn } from '@server/lib/isbn';
import logger from '@server/logger';
import { trimTrailingSlashes } from '@server/utils/serviceUrl';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';
import ServarrBase, {
  MAX_SERVARR_CONFIGURATION_RESULTS,
  MAX_SERVARR_LIBRARY_RESULTS,
  MAX_SERVARR_LOOKUP_RESULTS,
  sanitizeServarrProfiles,
  sanitizeServarrRecordArray,
  sanitizeServarrSystemStatus,
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

type ReadarrQueueItem = {
  bookId?: number;
  book?: {
    id?: number;
  };
};

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
    | { message?: unknown; errorMessage?: unknown }
    | undefined;
  const message =
    typeof data?.message === 'string'
      ? data.message
      : typeof data?.errorMessage === 'string'
        ? data.errorMessage
        : error.message;

  return status ? `${message} (status ${status})` : message;
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

  public async getBooks(): Promise<ReadarrBook[]> {
    try {
      return sanitizeServarrRecordArray<ReadarrBook>(
        await this.get<ReadarrBook[]>('/book', this.getRequestConfig()),
        MAX_SERVARR_LIBRARY_RESULTS
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to retrieve books: ${e.message}`);
    }
  }

  public async getBook(bookId: number): Promise<ReadarrBook> {
    try {
      return await this.get<ReadarrBook>(
        `/book/${bookId}`,
        this.getRequestConfig()
      );
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to retrieve book ${bookId}: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getBookCover(bookId: number): Promise<ReadarrCoverImage> {
    const book = await this.getBook(bookId).catch(() => undefined);
    const advertisedCoverPaths = (book?.images ?? [])
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
    const remoteCoverUrls = (book?.images ?? [])
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
        const isLocalCoverUrl = coverUrl.startsWith(this.coverBaseUrl);
        const response = await (
          isLocalCoverUrl ? this.axios : axios
        ).get<ArrayBuffer>(coverUrl, {
          responseType: 'arraybuffer',
          headers: { Accept: 'image/*' },
        });
        const contentType = String(response.headers['content-type'] ?? '');

        if (!contentType.toLowerCase().startsWith('image/')) {
          throw new Error('Upstream response is not an image');
        }

        return {
          imageBuffer: Buffer.from(response.data),
          contentType,
        };
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
  ): Promise<ReadarrBookLookupResult> {
    try {
      const existingBooks = sanitizeServarrRecordArray<ReadarrBook>(
        await this.get<ReadarrBook[]>('/book', this.getRequestConfig()),
        MAX_SERVARR_LIBRARY_RESULTS
      );
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
      const existingBook = existingBooks.find((book) => {
        if (
          book.foreignBookId &&
          normalizedForeignBookId &&
          normalizeOpenLibraryWorkId(book.foreignBookId) ===
            normalizedForeignBookId
        ) {
          return true;
        }

        return book.editions?.some((edition) => {
          const editionIsbn = normalizeIsbn(edition.isbn13);

          return (
            (!!edition.foreignEditionId &&
              optionEditionIds.has(
                normalizeOpenLibraryEditionId(edition.foreignEditionId)
              )) ||
            (!!editionIsbn && optionIsbns.has(editionIsbn))
          );
        });
      });

      if (existingBook && this.isBookMonitored(existingBook)) {
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

        return existingBook;
      }

      if (existingBook) {
        logger.info(
          'Book exists in Bookshelf/Readarr but is not monitored. Updating monitored status.',
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
            editions: existingBook.editions ?? [],
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
            monitored: true,
            ...(this.isChaptarr() ? this.getMediaMonitoringFields(true) : {}),
            ...(this.isChaptarr() && options.addOptions
              ? { addOptions: options.addOptions }
              : {}),
          }
        );

        await this.post(
          '/command',
          {
            name: 'BookSearch',
            bookIds: [updatedBook.id ?? existingBook.id],
          },
          this.getRequestConfig()
        );

        return updatedBook;
      }

      const postedBook = await this.post<ReadarrBookLookupResult | number>(
        '/book',
        {
          ...(options as unknown as Record<string, unknown>),
          ...(this.isChaptarr()
            ? this.getMediaMonitoringFields(options.monitored)
            : {}),
        },
        this.getRequestConfig()
      );

      const addedBook: ReadarrBookLookupResult =
        typeof postedBook === 'number'
          ? { ...options, id: postedBook }
          : postedBook;

      return await this.ensureRequestedBookState(addedBook, options);
    } catch (e) {
      throw new Error(
        `[Readarr] Failed to add book: ${getReadarrErrorMessage(e)}`,
        {
          cause: e,
        }
      );
    }
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
      throw new Error(`[Readarr] Failed to remove book: ${e.message}`);
    }
  }

  public async searchBook(bookId: number): Promise<void> {
    logger.info('Executing book search command.', {
      label: 'Readarr API',
      bookId,
    });

    try {
      await this.runCommand('BookSearch', { bookIds: [bookId] });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Bookshelf/Readarr book search.',
        {
          label: 'Readarr API',
          errorMessage: getReadarrErrorMessage(e),
          bookId,
        }
      );
    }
  }
}

export default ReadarrAPI;
