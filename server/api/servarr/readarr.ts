import {
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeIsbn } from '@server/lib/isbn';
import logger from '@server/logger';
import axios from 'axios';
import ServarrBase, {
  MAX_SERVARR_CONFIGURATION_RESULTS,
  MAX_SERVARR_LIBRARY_RESULTS,
  MAX_SERVARR_LOOKUP_RESULTS,
  sanitizeServarrProfiles,
  sanitizeServarrRecordArray,
} from './base';

export interface ReadarrMetadataProfile {
  id: number;
  name: string;
}

export interface ReadarrDevelopmentConfig {
  id: number;
  metadataSource?: string;
}

export interface ReadarrBookLookupResult {
  id?: number;
  title: string;
  titleSlug?: string;
  foreignBookId: string;
  foreignEditionId?: string;
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
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({
      url,
      apiKey,
      cacheName: 'readarr',
      apiName: 'Readarr',
    });
  }

  public async getMetadataProfiles(): Promise<ReadarrMetadataProfile[]> {
    try {
      return sanitizeServarrProfiles(
        await this.get<ReadarrMetadataProfile[]>('/metadataProfile')
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
      const response = await this.get<unknown>('/config/development');
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
        await this.get<ReadarrBook[]>('/book'),
        MAX_SERVARR_LIBRARY_RESULTS
      );
    } catch (e) {
      throw new Error(`[Readarr] Failed to retrieve books: ${e.message}`);
    }
  }

  public async getEditions(bookId: number): Promise<ReadarrEdition[]> {
    try {
      return sanitizeServarrRecordArray<ReadarrEdition>(
        await this.get<ReadarrEdition[]>('/edition', {
          params: { bookId },
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
      return sanitizeServarrRecordArray<ReadarrBookLookupResult>(
        await this.get<ReadarrBookLookupResult[]>('/book/lookup', {
          params: { term },
        }),
        MAX_SERVARR_LOOKUP_RESULTS
      );
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
          params: { term },
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
        await this.get<ReadarrBook[]>('/book'),
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

      if (existingBook?.monitored) {
        logger.info(
          'Book is already monitored in Bookshelf/Readarr. Skipping add and returning success',
          {
            label: 'Readarr',
            bookId: existingBook.id,
            bookTitle: existingBook.title,
          }
        );
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

        // codeql[js/request-forgery]
        const updatedBook = await this.axios.put<ReadarrBook>(
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
          }
        );

        // codeql[js/request-forgery]
        await this.post('/command', {
          name: 'BookSearch',
          bookIds: [updatedBook.data.id],
        });

        return updatedBook.data;
      }

      // codeql[js/request-forgery]
      return await this.post<ReadarrBookLookupResult>(
        '/book',
        options as unknown as Record<string, unknown>
      );
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
      await this.axios.delete(`/book/${bookId}`, {
        params: {
          deleteFiles: options.deleteFiles ?? true,
          addImportListExclusion: options.addImportListExclusion ?? false,
        },
      });
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
