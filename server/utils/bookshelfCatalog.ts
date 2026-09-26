import ReadarrAPI, {
  type ReadarrBookLookupResult,
} from '@server/api/servarr/readarr';
import type Media from '@server/entity/Media';
import { normalizeValidIsbn } from '@server/lib/isbn';
import type { ReadarrSettings } from '@server/lib/settings';
import type {
  AuthorDetails,
  AuthorResult,
  BookDetails,
  BookIsbnCandidate,
  BookResult,
  BookSeriesDetails,
  BookSeriesReference,
} from '@server/models/Book';

export const BOOKSHELF_BOOK_ID_PREFIX = 'bookshelf:';
export const BOOKSHELF_AUTHOR_ID_PREFIX = 'bookshelf-author:';
export const BOOKSHELF_SERIES_ID_PREFIX = 'bookshelf-series:';

const encodeForeignId = (foreignBookId: string) =>
  Buffer.from(foreignBookId, 'utf8').toString('base64url');

const decodeSourceId = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8');

export const getBookshelfMetadataSource = (
  foreignBookId: string
): { name: string; url: string } | undefined => {
  const separator = foreignBookId.indexOf(':');
  if (separator < 1) return undefined;
  const provider = foreignBookId.slice(0, separator).toLowerCase();
  const value = foreignBookId.slice(separator + 1);

  if (provider === 'googlebooks' && /^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    return {
      name: 'Google Books',
      url: `https://books.google.com/books?id=${encodeURIComponent(value)}`,
    };
  }

  if (provider === 'loc') {
    try {
      const url = new URL(decodeSourceId(value));
      if (
        url.protocol === 'https:' &&
        (url.hostname === 'www.loc.gov' || url.hostname === 'loc.gov')
      ) {
        return { name: 'Library of Congress', url: url.href };
      }
    } catch {
      return undefined;
    }
  }

  if (provider === 'europeana') {
    try {
      const id = decodeSourceId(value).replace(/^\/+/, '');
      if (/^\d+\/[A-Za-z0-9._-]+$/.test(id)) {
        return {
          name: 'Europeana',
          url: `https://www.europeana.eu/item/${id}`,
        };
      }
    } catch {
      return undefined;
    }
  }

  if (provider === 'gutendex' && /^[1-9]\d{0,8}$/.test(value)) {
    return {
      name: 'Project Gutenberg',
      url: `https://www.gutenberg.org/ebooks/${value}`,
    };
  }

  if (provider === 'internetarchive') {
    try {
      const id = decodeSourceId(value);
      if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
        return {
          name: 'Internet Archive',
          url: `https://archive.org/details/${encodeURIComponent(id)}`,
        };
      }
    } catch {
      return undefined;
    }
  }

  if (provider === 'ndl') {
    try {
      const id = decodeSourceId(value);
      if (/^R\d{9}-[A-Za-z0-9-]+$/.test(id)) {
        return {
          name: 'NDL Search API',
          url: `https://ndlsearch.ndl.go.jp/books/${encodeURIComponent(id)}`,
        };
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export const makeBookshelfBookId = (serviceId: number, foreignBookId: string) =>
  `${BOOKSHELF_BOOK_ID_PREFIX}${serviceId}:${encodeForeignId(foreignBookId)}`;

export const parseBookshelfBookId = (
  value: string
): { serviceId: number; foreignBookId: string } | undefined => {
  const match = value.match(/^bookshelf:(\d{1,10}):([A-Za-z0-9_-]{1,2048})$/);
  if (!match) return undefined;
  const serviceId = Number(match[1]);
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) return undefined;
  try {
    const foreignBookId = Buffer.from(match[2], 'base64url').toString('utf8');
    return foreignBookId && foreignBookId.length <= 1024
      ? { serviceId, foreignBookId }
      : undefined;
  } catch {
    return undefined;
  }
};

export const makeBookshelfAuthorId = (
  serviceId: number,
  foreignAuthorId: string,
  authorName: string
) =>
  `${BOOKSHELF_AUTHOR_ID_PREFIX}${serviceId}:${encodeForeignId(JSON.stringify({ foreignAuthorId, authorName }))}`;

export const makeBookshelfSeriesId = (
  serviceId: number,
  title: string,
  authorId?: number
) =>
  `${BOOKSHELF_SERIES_ID_PREFIX}${serviceId}:${encodeForeignId(title)}${authorId ? `:${authorId}` : ''}`;

export const parseBookshelfAuthorId = (
  value: string
):
  | { serviceId: number; foreignAuthorId: string; authorName: string }
  | undefined => {
  const match = value.match(
    /^bookshelf-author:(\d{1,10}):([A-Za-z0-9_-]{1,2048})$/
  );
  if (!match) return undefined;
  const serviceId = Number(match[1]);
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(match[2], 'base64url').toString('utf8')
    ) as {
      foreignAuthorId?: unknown;
      authorName?: unknown;
    };
    return typeof payload.foreignAuthorId === 'string' &&
      typeof payload.authorName === 'string' &&
      payload.foreignAuthorId.length <= 1024 &&
      payload.authorName.length <= 256
      ? {
          serviceId,
          foreignAuthorId: payload.foreignAuthorId,
          authorName: payload.authorName,
        }
      : undefined;
  } catch {
    return undefined;
  }
};

export const parseBookshelfSeriesId = (
  value: string
): { serviceId: number; title: string; authorId?: number } | undefined => {
  const match = value.match(
    /^bookshelf-series:(\d{1,10}):([A-Za-z0-9_-]{1,2048})(?::(\d{1,10}))?$/
  );
  if (!match) return undefined;
  const serviceId = Number(match[1]);
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) return undefined;
  try {
    const title = Buffer.from(match[2], 'base64url').toString('utf8').trim();
    const authorId = match[3] ? Number(match[3]) : undefined;
    return title &&
      title.length <= 512 &&
      (authorId === undefined ||
        (Number.isSafeInteger(authorId) && authorId > 0))
      ? { serviceId, title, authorId }
      : undefined;
  } catch {
    return undefined;
  }
};

const parseSeriesTitle = (value?: string) =>
  (value ?? '')
    .split(/\s*;\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const match = entry.match(/^(.*?)\s+#\s*([\d]+(?:\.[\d]+)?)$/);
      const title = (match?.[1] ?? entry).trim();
      return title ? [{ title, position: match?.[2] }] : [];
    });

const normalizeSeriesTitle = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

type LinkedBookMedia = Pick<
  Media,
  | 'serviceId'
  | 'externalServiceId'
  | 'audiobookServiceId'
  | 'audiobookExternalServiceId'
>;

export const getBookshelfLibraryBookSeries = async (
  servers: ReadarrSettings[],
  media?: LinkedBookMedia
): Promise<BookSeriesReference[]> => {
  if (!media) return [];

  const candidates = [
    {
      serviceId: media.serviceId,
      bookId: media.externalServiceId,
    },
    {
      serviceId: media.audiobookServiceId,
      bookId: media.audiobookExternalServiceId,
    },
  ].filter(
    (candidate): candidate is { serviceId: number; bookId: number } =>
      typeof candidate.serviceId === 'number' &&
      Number.isSafeInteger(candidate.serviceId) &&
      candidate.serviceId > 0 &&
      typeof candidate.bookId === 'number' &&
      Number.isSafeInteger(candidate.bookId) &&
      candidate.bookId > 0
  );

  const results = await Promise.all(
    candidates.map(async ({ serviceId, bookId }) => {
      const server = servers.find((candidate) => candidate.id === serviceId);
      if (!server) return [];

      try {
        const book = await getApi(server).getBook(bookId, 300);
        if (book.id !== bookId) return [];

        const mapped = mapBookshelfBook(book, serviceId);
        const authorId =
          typeof book.authorId === 'number' &&
          Number.isSafeInteger(book.authorId) &&
          book.authorId > 0
            ? book.authorId
            : undefined;
        return (mapped.series ?? []).map((series) => ({
          ...series,
          id: authorId
            ? makeBookshelfSeriesId(serviceId, series.title, authorId)
            : series.id,
        }));
      } catch {
        return [];
      }
    })
  );

  const unique = new Map<string, BookSeriesReference>();
  for (const series of results.flat()) {
    const source = series.id.match(/^bookshelf-series:\d+:/)?.[0] ?? series.id;
    const key = `${source}:${normalizeSeriesTitle(series.title)}:${series.position ?? ''}`;
    if (!unique.has(key)) unique.set(key, series);
  }
  return [...unique.values()];
};

const getIsbnCandidates = (
  result: ReadarrBookLookupResult
): BookIsbnCandidate[] => {
  const unique = new Map<string, BookIsbnCandidate>();
  for (const edition of result.editions ?? []) {
    const isbn = normalizeValidIsbn(edition.isbn13);
    if (isbn && !unique.has(isbn)) {
      unique.set(isbn, {
        isbn,
        editionId: edition.foreignEditionId,
        title: edition.title,
      });
    }
  }
  return [...unique.values()];
};

export const mapBookshelfBook = (
  result: ReadarrBookLookupResult,
  serviceId: number
): BookResult => {
  const isbnCandidates = getIsbnCandidates(result);
  const audioEdition = (result.editions ?? []).find(
    (edition) =>
      edition.monitored &&
      (edition.audiobookDuration ||
        edition.audioSeconds ||
        edition.durationSeconds ||
        edition.narrators?.length ||
        edition.contributors?.some((contributor) =>
          contributor.role?.toLowerCase().includes('narrat')
        ))
  );
  const series = parseSeriesTitle(result.seriesTitle).map(
    ({ title, position }) => ({
      id: makeBookshelfSeriesId(serviceId, title),
      title,
      position,
    })
  );
  const audiobookDuration =
    result.audiobookDuration ??
    result.audioSeconds ??
    result.durationSeconds ??
    audioEdition?.audiobookDuration ??
    audioEdition?.audioSeconds ??
    audioEdition?.durationSeconds;
  const narrators =
    result.narrators ??
    audioEdition?.narrators ??
    audioEdition?.contributors
      ?.filter((contributor) =>
        contributor.role?.toLowerCase().includes('narrat')
      )
      .map((contributor) => contributor.name?.trim())
      .filter((name): name is string => !!name);
  const image = result.images?.find(
    (entry) => entry.coverType?.toLowerCase() === 'cover'
  );
  return {
    id: makeBookshelfBookId(serviceId, result.foreignBookId),
    provider: 'bookshelf',
    metadataSource: getBookshelfMetadataSource(result.foreignBookId),
    mediaType: 'book',
    title: result.title,
    author: result.author?.authorName,
    authorId: result.author?.foreignAuthorId
      ? makeBookshelfAuthorId(
          serviceId,
          result.author.foreignAuthorId,
          result.author.authorName ?? result.authorTitle ?? ''
        )
      : undefined,
    posterPath: image?.remoteUrl ?? image?.url,
    isbn13: isbnCandidates.find((candidate) => candidate.isbn.length === 13)
      ?.isbn,
    firstPublishYear: result.releaseDate
      ? Number(result.releaseDate.match(/\d{4}/)?.[0]) || undefined
      : undefined,
    isbnCandidates,
    editionId:
      result.foreignEditionId ?? result.editions?.[0]?.foreignEditionId,
    series,
    audiobookDuration,
    narrators: narrators?.length ? [...new Set(narrators)] : undefined,
  };
};

export const searchBookshelfAuthors = async (
  servers: ReadarrSettings[],
  term: string
): Promise<AuthorResult[]> => {
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        const authors = await getApi(server).lookupAuthor(term);
        return authors.map((author) => ({
          id: makeBookshelfAuthorId(
            server.id,
            author.foreignAuthorId,
            author.authorName
          ),
          provider: 'bookshelf' as const,
          mediaType: 'author' as const,
          name: author.authorName,
          posterPath:
            author.images?.find(
              (image) => image.coverType?.toLowerCase() === 'poster'
            )?.remoteUrl ?? author.remotePoster,
        }));
      } catch {
        return [];
      }
    })
  );

  return results.flat();
};

export const getBookshelfSeriesDetails = async (
  servers: ReadarrSettings[],
  id: string
): Promise<BookSeriesDetails | undefined> => {
  const parsed = parseBookshelfSeriesId(id);
  const server =
    parsed && servers.find((candidate) => candidate.id === parsed.serviceId);
  if (!parsed || !server) return undefined;

  try {
    const expectedTitle = normalizeSeriesTitle(parsed.title);
    const api = getApi(server);
    const [libraryBooks, catalogBooks] = await Promise.all([
      parsed.authorId
        ? api.getBooksByAuthor(parsed.authorId).catch(() => [])
        : Promise.resolve([]),
      api.lookupBook(parsed.title).catch(() => []),
    ]);
    const nativeMatches = libraryBooks.filter((book) =>
      parseSeriesTitle(book.seriesTitle).some(
        (series) => normalizeSeriesTitle(series.title) === expectedTitle
      )
    );
    const catalogMatches = catalogBooks.filter((book) =>
      parseSeriesTitle(book.seriesTitle).some(
        (series) => normalizeSeriesTitle(series.title) === expectedTitle
      )
    );
    const books = [...nativeMatches, ...catalogMatches].map((book) => {
      const mappedBook = mapBookshelfBook(book, server.id);
      return {
        ...mappedBook,
        series: mappedBook.series?.map((series) =>
          normalizeSeriesTitle(series.title) === expectedTitle
            ? { ...series, id, title: parsed.title }
            : parsed.authorId
              ? {
                  ...series,
                  id: makeBookshelfSeriesId(
                    server.id,
                    series.title,
                    parsed.authorId
                  ),
                }
              : series
        ),
      };
    });
    const dedupedBooks = [
      ...new Map(books.map((book) => [book.id, book])).values(),
    ];
    dedupedBooks.sort((left, right) => {
      const leftPosition = Number(
        left.series?.find(
          (entry) => normalizeSeriesTitle(entry.title) === expectedTitle
        )?.position
      );
      const rightPosition = Number(
        right.series?.find(
          (entry) => normalizeSeriesTitle(entry.title) === expectedTitle
        )?.position
      );
      const leftHasPosition = Number.isFinite(leftPosition);
      const rightHasPosition = Number.isFinite(rightPosition);
      if (
        leftHasPosition &&
        rightHasPosition &&
        leftPosition !== rightPosition
      ) {
        return leftPosition - rightPosition;
      }
      if (leftHasPosition !== rightHasPosition) return leftHasPosition ? -1 : 1;
      return left.title.localeCompare(right.title, undefined, {
        numeric: true,
      });
    });

    return dedupedBooks.length
      ? { id, title: parsed.title, books: dedupedBooks }
      : undefined;
  } catch {
    return undefined;
  }
};

export const getBookshelfAuthorDetails = async (
  servers: ReadarrSettings[],
  id: string,
  limit = 20,
  offset = 0
): Promise<AuthorDetails | undefined> => {
  const parsed = parseBookshelfAuthorId(id);
  const server =
    parsed && servers.find((candidate) => candidate.id === parsed.serviceId);
  if (!parsed || !server) return undefined;
  try {
    const api = getApi(server);
    const [authorMatches, bookMatches] = await Promise.all([
      api.lookupAuthor(parsed.authorName),
      api.lookupBook(parsed.authorName),
    ]);
    const author = authorMatches.find(
      (candidate) => candidate.foreignAuthorId === parsed.foreignAuthorId
    );
    if (!author) return undefined;
    const books = bookMatches
      .filter(
        (book) =>
          book.author?.foreignAuthorId === parsed.foreignAuthorId ||
          book.author?.authorName?.toLowerCase() ===
            parsed.authorName.toLowerCase()
      )
      .map((book) => mapBookshelfBook(book, server.id));
    return {
      id,
      name: author.authorName,
      posterPath:
        author.images?.find(
          (image) => image.coverType?.toLowerCase() === 'poster'
        )?.remoteUrl ?? author.remotePoster,
      works: books.slice(offset, offset + limit),
      pagination: { limit, offset, totalItems: books.length },
    };
  } catch {
    return undefined;
  }
};

const getApi = (server: ReadarrSettings) =>
  new ReadarrAPI({
    apiKey: server.apiKey,
    url: ReadarrAPI.buildUrl(server, '/api/v1'),
    mediaType: server.serviceType ?? 'ebook',
  });

export const searchBookshelfCatalogs = async (
  servers: ReadarrSettings[],
  term: string,
  serviceType?: 'ebook' | 'audiobook'
): Promise<BookResult[]> => {
  const matches = servers.filter(
    (server) => !serviceType || (server.serviceType ?? 'ebook') === serviceType
  );
  const results = await Promise.all(
    matches.map(async (server) => {
      try {
        const books = await getApi(server).lookupBook(term);
        return books.map((book) => mapBookshelfBook(book, server.id));
      } catch {
        return [];
      }
    })
  );
  const deduped = new Map<string, BookResult>();
  for (const result of results.flat()) {
    const key = result.isbn13
      ? `isbn:${result.isbn13}`
      : `${result.id}:${result.title.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, result);
  }
  return [...deduped.values()];
};

export const getBookshelfBookDetails = async (
  servers: ReadarrSettings[],
  id: string
): Promise<BookDetails | undefined> => {
  const parsed = parseBookshelfBookId(id);
  if (!parsed) return undefined;
  const server = servers.find((candidate) => candidate.id === parsed.serviceId);
  if (!server) return undefined;
  try {
    const candidates = await getApi(server).lookupBook(parsed.foreignBookId);
    const result = candidates.find(
      (candidate) => candidate.foreignBookId === parsed.foreignBookId
    );
    if (!result) return undefined;
    const base = mapBookshelfBook(result, server.id);
    const editions = result.editions ?? [];
    const description = (
      editions as ((typeof editions)[number] & { overview?: string })[]
    )
      .map((edition) => edition.overview)
      .find(Boolean);
    const publisher = (
      editions as ((typeof editions)[number] & { publisher?: string })[]
    )
      .map((edition) => edition.publisher)
      .find(Boolean);
    const pageCount = (
      editions as ((typeof editions)[number] & { pageCount?: number })[]
    )
      .map((edition) => edition.pageCount)
      .find(
        (value) => value !== undefined && Number.isFinite(value) && value > 0
      );
    return {
      ...base,
      description,
      publisher,
      numberOfPages: pageCount,
      onUserWatchlist: false,
    };
  } catch {
    return undefined;
  }
};
