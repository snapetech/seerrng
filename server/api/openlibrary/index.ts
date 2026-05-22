import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

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
    return this.get<OpenLibrarySearchResponse>(
      '/search.json',
      {
        params: {
          q: query,
          page: page.toString(),
          limit: limit.toString(),
          ...(sort ? { sort } : {}),
        },
      },
      43200
    );
  }

  public async getWork(workId: string): Promise<OpenLibraryWork> {
    const normalizedWorkId = /^\/works\//i.test(workId)
      ? workId
      : `/works/${workId}`;

    return this.get<OpenLibraryWork>(
      `${normalizedWorkId}.json`,
      undefined,
      43200
    );
  }

  public async getEdition(editionId: string): Promise<OpenLibraryEdition> {
    const normalizedEditionId = /^\/books\//i.test(editionId)
      ? editionId
      : `/books/${editionId}`;

    return this.get<OpenLibraryEdition>(
      `${normalizedEditionId}.json`,
      undefined,
      43200
    );
  }

  public async getAuthor(authorId: string): Promise<OpenLibraryAuthor> {
    const normalizedAuthorId = authorId.startsWith('/authors/')
      ? authorId
      : `/authors/${authorId}`;

    return this.get<OpenLibraryAuthor>(
      `${normalizedAuthorId}.json`,
      undefined,
      43200
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
    const normalizedAuthorId = authorId.startsWith('/authors/')
      ? authorId
      : `/authors/${authorId}`;

    return this.get<OpenLibraryAuthorWorksResponse>(
      `${normalizedAuthorId}/works.json`,
      {
        params: {
          limit: Math.min(Math.max(limit, 1), 100).toString(),
          offset: Math.max(offset, 0).toString(),
        },
      },
      43200
    );
  }

  public async getWorkEditions(
    workId: string,
    limit = 100
  ): Promise<OpenLibraryEditionsResponse> {
    const normalizedWorkId = /^\/works\//i.test(workId)
      ? workId
      : `/works/${workId}`;

    return this.get<OpenLibraryEditionsResponse>(
      `${normalizedWorkId}/editions.json`,
      {
        params: {
          limit: Math.min(Math.max(limit, 1), 100).toString(),
        },
      },
      43200
    );
  }
}

export default OpenLibraryAPI;
