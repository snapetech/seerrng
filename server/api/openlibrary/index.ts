import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import {
  isValidOpenLibraryResourceId,
  normalizeOpenLibraryAuthorId,
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';

export interface OpenLibrarySearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  edition_key?: string[];
  edition_count?: number;
  ratings_average?: number;
  ratings_count?: number;
  want_to_read_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  start: number;
  docs: OpenLibrarySearchDoc[];
}

export interface OpenLibraryWork {
  key: string;
  title: string;
  description?: string | { value: string };
  covers?: number[];
  authors?: {
    author: {
      key: string;
    };
  }[];
  first_publish_date?: string;
  subjects?: string[];
}

export interface OpenLibraryAuthor {
  key: string;
  name: string;
  bio?: string | { value: string };
  birth_date?: string;
  death_date?: string;
  photos?: number[];
}

export interface OpenLibraryAuthorWork {
  key: string;
  title: string;
  covers?: number[];
  first_publish_date?: string;
  authors?: OpenLibraryWork['authors'];
  languages?: { key: string }[];
}

export interface OpenLibraryEdition {
  key: string;
  title?: string;
  publishers?: string[];
  isbn_10?: string[];
  isbn_13?: string[];
  physical_format?: string;
  works?: {
    key: string;
  }[];
}

interface OpenLibraryEditionsResponse {
  links?: {
    next?: string;
  };
  size: number;
  entries: OpenLibraryEdition[];
}

interface OpenLibraryAuthorWorksResponse {
  links?: {
    next?: string;
  };
  size: number;
  entries: OpenLibraryAuthorWork[];
}

export const MAX_OPENLIBRARY_PAGE_SIZE = 100;
export const MAX_OPENLIBRARY_EDITION_ISBNS = 200;
export const MAX_OPENLIBRARY_TITLE_LENGTH = 1_000;
export const MAX_OPENLIBRARY_DESCRIPTION_LENGTH = 20_000;
const MAX_OPENLIBRARY_TEXT_LENGTH = 512;
const MAX_OPENLIBRARY_ARRAY_ITEMS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedString = (
  value: unknown,
  maxLength = MAX_OPENLIBRARY_TEXT_LENGTH
): string | undefined =>
  typeof value === 'string' && value.length > 0
    ? value.slice(0, maxLength)
    : undefined;

const boundedStrings = (
  value: unknown,
  maxItems = MAX_OPENLIBRARY_ARRAY_ITEMS,
  maxLength = MAX_OPENLIBRARY_TEXT_LENGTH
): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string' && !!item)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
  return strings.length ? strings : undefined;
};

const boundedNumbers = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers = value
    .filter(
      (item): item is number =>
        typeof item === 'number' && Number.isSafeInteger(item)
    )
    .slice(0, MAX_OPENLIBRARY_ARRAY_ITEMS);
  return numbers.length ? numbers : undefined;
};

const requireString = (
  value: unknown,
  field: string,
  maxLength = MAX_OPENLIBRARY_TEXT_LENGTH
): string => {
  const parsed = boundedString(value, maxLength);
  if (!parsed) {
    throw new Error(`Open Library returned an invalid ${field}.`);
  }
  return parsed;
};

const requireOpenLibraryResourceId = (
  value: string,
  resourceType: 'author' | 'edition' | 'work'
): string => {
  const normalized =
    resourceType === 'author'
      ? normalizeOpenLibraryAuthorId(value)
      : resourceType === 'edition'
        ? normalizeOpenLibraryEditionId(value)
        : normalizeOpenLibraryWorkId(value);

  if (!isValidOpenLibraryResourceId(normalized)) {
    throw new Error(`Open Library ${resourceType} ID is invalid.`);
  }

  return normalized;
};

const sanitizeDescription = (
  value: unknown
): string | { value: string } | undefined => {
  if (typeof value === 'string') {
    return value.slice(0, MAX_OPENLIBRARY_DESCRIPTION_LENGTH);
  }
  if (isRecord(value)) {
    const description = boundedString(
      value.value,
      MAX_OPENLIBRARY_DESCRIPTION_LENGTH
    );
    return description ? { value: description } : undefined;
  }
  return undefined;
};

const sanitizeSearchDoc = (
  value: unknown,
  takeIsbns: (value: unknown) => string[] | undefined
): OpenLibrarySearchDoc | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = boundedString(value.key, 128);
  const title = boundedString(value.title, MAX_OPENLIBRARY_TITLE_LENGTH);
  if (!key || !title) {
    return undefined;
  }

  return {
    key,
    title,
    author_name: boundedStrings(value.author_name, 20),
    author_key: boundedStrings(value.author_key, 20, 128),
    first_publish_year:
      typeof value.first_publish_year === 'number' &&
      Number.isSafeInteger(value.first_publish_year)
        ? value.first_publish_year
        : undefined,
    cover_i:
      typeof value.cover_i === 'number' && Number.isSafeInteger(value.cover_i)
        ? value.cover_i
        : undefined,
    isbn: takeIsbns(value.isbn),
    edition_key: boundedStrings(value.edition_key, 100, 128),
    edition_count:
      typeof value.edition_count === 'number' &&
      Number.isSafeInteger(value.edition_count)
        ? value.edition_count
        : undefined,
    ratings_average:
      typeof value.ratings_average === 'number' &&
      Number.isFinite(value.ratings_average)
        ? value.ratings_average
        : undefined,
    ratings_count:
      typeof value.ratings_count === 'number' &&
      Number.isSafeInteger(value.ratings_count)
        ? value.ratings_count
        : undefined,
    want_to_read_count:
      typeof value.want_to_read_count === 'number' &&
      Number.isSafeInteger(value.want_to_read_count)
        ? value.want_to_read_count
        : undefined,
  };
};

const sanitizeWork = (value: unknown): OpenLibraryWork => {
  if (!isRecord(value)) {
    throw new Error('Open Library returned an invalid work.');
  }

  const authors = Array.isArray(value.authors)
    ? value.authors
        .slice(0, 20)
        .map((entry) => {
          if (!isRecord(entry) || !isRecord(entry.author)) {
            return undefined;
          }
          const key = boundedString(entry.author.key, 128);
          return key ? { author: { key } } : undefined;
        })
        .filter(
          (entry): entry is { author: { key: string } } => entry !== undefined
        )
    : undefined;

  return {
    key: requireString(value.key, 'work key', 128),
    title: requireString(
      value.title,
      'work title',
      MAX_OPENLIBRARY_TITLE_LENGTH
    ),
    description: sanitizeDescription(value.description),
    covers: boundedNumbers(value.covers),
    authors: authors?.length ? authors : undefined,
    first_publish_date: boundedString(value.first_publish_date, 128),
    subjects: boundedStrings(value.subjects, 100, 256),
  };
};

const sanitizeEdition = (value: unknown): OpenLibraryEdition | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = boundedString(value.key, 128);
  if (!key) {
    return undefined;
  }
  const works = Array.isArray(value.works)
    ? value.works
        .slice(0, 20)
        .map((work) => {
          const workKey = isRecord(work)
            ? boundedString(work.key, 128)
            : undefined;
          return workKey ? { key: workKey } : undefined;
        })
        .filter((work): work is { key: string } => work !== undefined)
    : undefined;

  return {
    key,
    title: boundedString(value.title, MAX_OPENLIBRARY_TITLE_LENGTH),
    publishers: boundedStrings(value.publishers, 20, 256),
    isbn_10: boundedStrings(value.isbn_10),
    isbn_13: boundedStrings(value.isbn_13),
    physical_format: boundedString(value.physical_format, 256),
    works: works?.length ? works : undefined,
  };
};

const sanitizeAuthor = (value: unknown): OpenLibraryAuthor => {
  if (!isRecord(value)) {
    throw new Error('Open Library returned an invalid author.');
  }
  return {
    key: requireString(value.key, 'author key', 128),
    name: requireString(
      value.name,
      'author name',
      MAX_OPENLIBRARY_TITLE_LENGTH
    ),
    bio: sanitizeDescription(value.bio),
    birth_date: boundedString(value.birth_date, 128),
    death_date: boundedString(value.death_date, 128),
    photos: boundedNumbers(value.photos),
  };
};

const sanitizeAuthorWork = (
  value: unknown
): OpenLibraryAuthorWork | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const key = boundedString(value.key, 128);
  const title = boundedString(value.title, MAX_OPENLIBRARY_TITLE_LENGTH);
  if (!key || !title) {
    return undefined;
  }
  const work = sanitizeWork({ ...value, key, title });

  return {
    key: work.key,
    title: work.title,
    covers: work.covers,
    first_publish_date: work.first_publish_date,
    authors: work.authors,
    languages: Array.isArray(value.languages)
      ? value.languages
          .slice(0, 50)
          .map((language) => {
            const languageKey = isRecord(language)
              ? boundedString(language.key, 128)
              : undefined;
            return languageKey ? { key: languageKey } : undefined;
          })
          .filter(
            (language): language is { key: string } => language !== undefined
          )
      : undefined,
  };
};

const clampPageSize = (limit: number): number =>
  Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 20, 1), 100);

const boundEditionIdentifiers = (
  entries: unknown[],
  limit: number
): OpenLibraryEdition[] => {
  let remainingIsbns = MAX_OPENLIBRARY_EDITION_ISBNS;

  return entries
    .slice(0, limit)
    .map(sanitizeEdition)
    .filter((edition): edition is OpenLibraryEdition => !!edition)
    .map((edition) => {
      const takeIsbns = (values: unknown): string[] | undefined => {
        if (!Array.isArray(values) || remainingIsbns === 0) {
          return undefined;
        }

        const bounded = values
          .filter((value): value is string => typeof value === 'string')
          .slice(0, remainingIsbns);
        remainingIsbns -= bounded.length;
        return bounded.length ? bounded : undefined;
      };

      return {
        ...edition,
        isbn_13: takeIsbns(edition.isbn_13),
        isbn_10: takeIsbns(edition.isbn_10),
      };
    });
};

class OpenLibraryAPI extends ExternalAPI {
  constructor() {
    super(
      'https://openlibrary.org',
      {},
      {
        nodeCache: cacheManager.getCache('openlibrary').data,
        rateLimit: {
          maxRequests: 10,
          maxRPS: 5,
        },
      }
    );
  }

  public async searchBooks({
    query,
    page = 1,
    limit = 20,
    sort,
  }: {
    query: string;
    page?: number;
    limit?: number;
    sort?: string;
  }): Promise<OpenLibrarySearchResponse> {
    const boundedLimit = clampPageSize(limit);
    const response = await this.get<OpenLibrarySearchResponse>(
      '/search.json',
      {
        params: {
          q: query,
          page: page.toString(),
          limit: boundedLimit.toString(),
          ...(sort ? { sort } : {}),
        },
      },
      43200
    );

    if (!isRecord(response)) {
      throw new Error('Open Library returned an invalid search response.');
    }
    let remainingIsbns = MAX_OPENLIBRARY_EDITION_ISBNS;
    const takeIsbns = (value: unknown): string[] | undefined => {
      const values = boundedStrings(value, remainingIsbns);
      remainingIsbns -= values?.length ?? 0;
      return values;
    };

    return {
      numFound:
        typeof response.numFound === 'number' &&
        Number.isSafeInteger(response.numFound) &&
        response.numFound >= 0
          ? response.numFound
          : 0,
      start:
        typeof response.start === 'number' &&
        Number.isSafeInteger(response.start) &&
        response.start >= 0
          ? response.start
          : 0,
      docs: Array.isArray(response.docs)
        ? response.docs
            .slice(0, boundedLimit)
            .map((doc) => sanitizeSearchDoc(doc, takeIsbns))
            .filter((doc): doc is OpenLibrarySearchDoc => !!doc)
        : [],
    };
  }

  public async getWork(workId: string): Promise<OpenLibraryWork> {
    const normalizedWorkId = requireOpenLibraryResourceId(workId, 'work');

    return sanitizeWork(
      await this.get<OpenLibraryWork>(
        `/works/${encodeURIComponent(normalizedWorkId)}.json`,
        undefined,
        43200
      )
    );
  }

  public async getEdition(editionId: string): Promise<OpenLibraryEdition> {
    const normalizedEditionId = requireOpenLibraryResourceId(
      editionId,
      'edition'
    );

    const edition = sanitizeEdition(
      await this.get<OpenLibraryEdition>(
        `/books/${encodeURIComponent(normalizedEditionId)}.json`,
        undefined,
        43200
      )
    );
    if (!edition) {
      throw new Error('Open Library returned an invalid edition.');
    }
    return edition;
  }

  public async getAuthor(authorId: string): Promise<OpenLibraryAuthor> {
    const normalizedAuthorId = requireOpenLibraryResourceId(authorId, 'author');

    return sanitizeAuthor(
      await this.get<OpenLibraryAuthor>(
        `/authors/${encodeURIComponent(normalizedAuthorId)}.json`,
        undefined,
        43200
      )
    );
  }

  public async getAuthorWorks(
    authorId: string,
    {
      limit = 20,
      offset = 0,
    }: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<OpenLibraryAuthorWorksResponse> {
    const normalizedAuthorId = requireOpenLibraryResourceId(authorId, 'author');

    const boundedLimit = clampPageSize(limit);
    const response = await this.get<OpenLibraryAuthorWorksResponse>(
      `/authors/${encodeURIComponent(normalizedAuthorId)}/works.json`,
      {
        params: {
          limit: boundedLimit.toString(),
          offset: Math.max(offset, 0).toString(),
        },
      },
      43200
    );

    if (!isRecord(response)) {
      throw new Error(
        'Open Library returned an invalid author works response.'
      );
    }
    return {
      size:
        typeof response.size === 'number' &&
        Number.isSafeInteger(response.size) &&
        response.size >= 0
          ? response.size
          : 0,
      entries: Array.isArray(response.entries)
        ? response.entries
            .slice(0, boundedLimit)
            .map(sanitizeAuthorWork)
            .filter((entry): entry is OpenLibraryAuthorWork => !!entry)
        : [],
    };
  }

  public async getWorkEditions(
    workId: string,
    limit = 100
  ): Promise<OpenLibraryEditionsResponse> {
    const normalizedWorkId = requireOpenLibraryResourceId(workId, 'work');
    const boundedLimit = clampPageSize(limit);

    const response = await this.get<OpenLibraryEditionsResponse>(
      `/works/${encodeURIComponent(normalizedWorkId)}/editions.json`,
      {
        params: {
          limit: boundedLimit.toString(),
        },
      },
      43200
    );

    if (!isRecord(response)) {
      throw new Error('Open Library returned an invalid editions response.');
    }
    return {
      size:
        typeof response.size === 'number' &&
        Number.isSafeInteger(response.size) &&
        response.size >= 0
          ? response.size
          : 0,
      entries: boundEditionIdentifiers(
        Array.isArray(response.entries) ? response.entries : [],
        boundedLimit
      ),
    };
  }
}

export default OpenLibraryAPI;
