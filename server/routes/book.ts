import OpenLibraryAPI from '@server/api/openlibrary';
import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Watchlist } from '@server/entity/Watchlist';
import {
  findBookMediaForBookResults,
  findBookMediaForSearchDocs,
  findBookMediaForWork,
} from '@server/lib/bookMediaMatcher';
import {
  isValidOpenLibraryResourceId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { upsertMediaSearchMetadata } from '@server/lib/mediaSearchMetadata';
import { getSettings, type ReadarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  type BookSeriesReference,
  mapOpenLibrarySearchDoc,
  mapOpenLibraryWork,
} from '@server/models/Book';
import {
  getBookshelfBookDetails,
  getBookshelfLibraryBookSeries,
  parseBookshelfBookId,
  searchBookshelfCatalogs,
} from '@server/utils/bookshelfCatalog';
import { filterEntityResponse } from '@server/utils/entityResponse';
import {
  parseOptionalPositiveInt,
  parsePositiveInt,
} from '@server/utils/pagination';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const bookRoutes = Router();
const MAX_BOOK_SEARCH_QUERY_LENGTH = 256;
const MAX_OPENLIBRARY_WORK_ID_LENGTH = 128;
export const BOOK_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
const bookRateLimit = rateLimit({
  ...BOOK_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
});

bookRoutes.use(bookRateLimit);

const parseBookSearchQuery = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'Query',
    maxLength: MAX_BOOK_SEARCH_QUERY_LENGTH,
  });

const parseOpenLibraryWorkId = (value: unknown) => {
  const parsed = parseBoundedString(value, {
    fieldName: 'Book ID',
    maxLength: MAX_OPENLIBRARY_WORK_ID_LENGTH,
  });
  if ('error' in parsed) {
    return parsed;
  }

  const normalized = normalizeOpenLibraryWorkId(parsed.value);
  return isValidOpenLibraryResourceId(normalized)
    ? { value: normalized }
    : { error: 'Book ID is invalid.' };
};

const mergeBookSeriesReferences = (
  ...seriesLists: (BookSeriesReference[] | undefined)[]
): BookSeriesReference[] => {
  const unique = new Map<string, BookSeriesReference>();
  for (const series of seriesLists.flatMap((entries) => entries ?? [])) {
    const source = series.id.match(/^bookshelf-series:\d+:/)?.[0] ?? series.id;
    const key = `${series.title
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()}:${source}:${series.position ?? ''}`;
    if (!unique.has(key)) unique.set(key, series);
  }
  return [...unique.values()];
};

const getBookCoverService = (
  media?: Media,
  format?: 'ebook' | 'audiobook'
):
  | { server: ReadarrSettings; bookId: number; format: 'ebook' | 'audiobook' }
  | undefined => {
  if (!media) {
    return undefined;
  }

  const settings = getSettings();
  const candidates =
    format === 'ebook'
      ? [
          {
            serviceId: media.serviceId,
            externalServiceId: media.externalServiceId,
            format: 'ebook' as const,
          },
        ]
      : format === 'audiobook'
        ? [
            {
              serviceId: media.audiobookServiceId,
              externalServiceId: media.audiobookExternalServiceId,
              format: 'audiobook' as const,
            },
          ]
        : [
            {
              serviceId: media.audiobookServiceId,
              externalServiceId: media.audiobookExternalServiceId,
              format: 'audiobook' as const,
            },
            {
              serviceId: media.serviceId,
              externalServiceId: media.externalServiceId,
              format: 'ebook' as const,
            },
          ];

  for (const candidate of candidates) {
    if (
      candidate.serviceId === null ||
      candidate.serviceId === undefined ||
      candidate.externalServiceId === null ||
      candidate.externalServiceId === undefined
    ) {
      continue;
    }

    const server = settings.readarr.find(
      (readarr) => readarr.id === candidate.serviceId
    );

    if (server) {
      return {
        server,
        bookId: candidate.externalServiceId,
        format: candidate.format,
      };
    }
  }

  return undefined;
};

bookRoutes.get('/search', async (req, res, next) => {
  const parsedQuery = parseBookSearchQuery(req.query.query);
  const page = parsePositiveInt(req.query.page, 1, 500);

  if ('error' in parsedQuery) {
    return res.status(400).json({ status: 400, message: parsedQuery.error });
  }

  const query = parsedQuery.value;
  const settings = getSettings();

  try {
    const [openLibraryResponse, bookshelfResults] = await Promise.allSettled([
      new OpenLibraryAPI().searchBooks({ query, page, limit: 20 }),
      searchBookshelfCatalogs(settings.readarr, query),
    ]);
    const docs =
      openLibraryResponse.status === 'fulfilled'
        ? openLibraryResponse.value.docs
        : [];
    if (
      openLibraryResponse.status === 'rejected' &&
      (bookshelfResults.status !== 'fulfilled' ||
        !bookshelfResults.value.length)
    ) {
      throw openLibraryResponse.reason;
    }
    const mappedOpenLibrary = docs.map((doc) => mapOpenLibrarySearchDoc(doc));
    const mappedBookshelf =
      bookshelfResults.status === 'fulfilled' ? bookshelfResults.value : [];
    const deduped = new Map<string, (typeof mappedOpenLibrary)[number]>();
    for (const result of [...mappedOpenLibrary, ...mappedBookshelf]) {
      const key = result.isbn13
        ? `isbn:${result.isbn13}`
        : `${result.title.toLowerCase()}:${result.author?.toLowerCase() ?? ''}`;
      if (!deduped.has(key)) deduped.set(key, result);
    }
    const results = [...deduped.values()].slice(0, 40);
    const mediaByOpenLibraryId = await findBookMediaForSearchDocs(
      docs,
      req.user
    );
    const allMediaByBookId = await findBookMediaForBookResults(
      results,
      req.user
    );

    return res.status(200).json({
      page,
      totalPages: Math.max(
        Math.ceil(
          ((openLibraryResponse.status === 'fulfilled'
            ? openLibraryResponse.value.numFound
            : 0) +
            mappedBookshelf.length) /
            20
        ),
        1
      ),
      totalResults:
        (openLibraryResponse.status === 'fulfilled'
          ? openLibraryResponse.value.numFound
          : 0) + mappedBookshelf.length,
      results: results.map((result) =>
        result.provider === 'openlibrary'
          ? {
              ...result,
              mediaInfo: mediaByOpenLibraryId.get(
                normalizeOpenLibraryWorkId(result.id)
              ),
            }
          : { ...result, mediaInfo: allMediaByBookId.get(result.id) }
      ),
    });
  } catch (e) {
    logger.error('Failed to search books', {
      label: 'Book',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      query,
    });
    return next({ status: 500, message: 'Unable to search books.' });
  }
});

bookRoutes.get('/:id', async (req, res, next) => {
  const bookshelfId = parseBookshelfBookId(req.params.id);
  if (bookshelfId) {
    const settings = getSettings();
    const details = await getBookshelfBookDetails(
      settings.readarr,
      req.params.id
    );
    if (!details)
      return res.status(404).json({ status: 404, message: 'Book not found' });
    try {
      const mediaMap = await findBookMediaForBookResults([details], req.user);
      const media = mediaMap.get(details.id);
      const librarySeries = await getBookshelfLibraryBookSeries(
        getSettings().readarr,
        media
      );
      const series = mergeBookSeriesReferences(librarySeries, details.series);
      await upsertMediaSearchMetadata(undefined, {
        title: details.title,
        author: details.author,
        publisher: details.publisher,
        provider: 'Bookshelf catalog',
        externalIds: [details.id, details.isbn13].filter(Boolean).join(' '),
      });
      return res
        .status(200)
        .json(
          filterEntityResponse(
            { ...details, series, mediaInfo: media },
            req.user
          )
        );
    } catch (e) {
      return next(e);
    }
  }
  const parsedBookId = parseOpenLibraryWorkId(req.params.id);
  if ('error' in parsedBookId) {
    return res.status(404).json({ status: 404, message: 'Book not found' });
  }

  const bookId = parsedBookId.value;

  try {
    const openLibrary = new OpenLibraryAPI();
    const [work, editions, onUserWatchlist] = await Promise.all([
      openLibrary.getWork(bookId),
      openLibrary.getWorkEditions(bookId).catch(() => ({
        size: 0,
        entries: [],
      })),
      req.user
        ? getRepository(Watchlist).exists({
            where: {
              externalId: bookId,
              mediaType: MediaType.BOOK,
              requestedBy: { id: req.user.id },
            },
          })
        : false,
    ]);

    const media = await findBookMediaForWork(
      bookId,
      editions.entries,
      req.user
    );
    const authorId = work.authors?.[0]?.author.key.replace('/authors/', '');
    const author = authorId
      ? await openLibrary.getAuthor(authorId).catch(() => undefined)
      : undefined;
    const bookDetails = {
      ...mapOpenLibraryWork(
        work,
        media,
        editions.entries,
        onUserWatchlist,
        author?.name
      ),
      editionCount: editions.size,
    };

    const settings = getSettings();
    const [librarySeries, bookshelfSeriesResults] = await Promise.all([
      getBookshelfLibraryBookSeries(settings.readarr, media),
      bookDetails.isbn13
        ? searchBookshelfCatalogs(
            settings.readarr,
            `isbn:${bookDetails.isbn13}`
          )
        : Promise.resolve([]),
    ]);
    const matchingSeries = bookshelfSeriesResults
      .filter((result) =>
        result.isbnCandidates?.some(
          (candidate) => candidate.isbn === bookDetails.isbn13
        )
      )
      .flatMap((result) => result.series ?? []);
    const series = mergeBookSeriesReferences(librarySeries, matchingSeries);
    const bookDetailsWithSeries = series.length
      ? {
          ...bookDetails,
          series,
        }
      : bookDetails;

    await upsertMediaSearchMetadata(media?.id, {
      title: bookDetails.title,
      releaseDate: bookDetails.firstPublishYear?.toString(),
      genres: bookDetails.subjects?.join(', '),
      runtime: bookDetails.numberOfPages
        ? `${bookDetails.numberOfPages} pages`
        : undefined,
      author: bookDetails.author,
      publisher: bookDetails.publisher,
      format: 'Book Ebook Audiobook',
      provider: 'Open Library',
      externalIds: [bookDetails.id, bookDetails.editionId, bookDetails.isbn13]
        .filter(Boolean)
        .join(' '),
    });

    return res
      .status(200)
      .json(filterEntityResponse(bookDetailsWithSeries, req.user));
  } catch (e) {
    logger.error('Failed to retrieve book details', {
      label: 'Book',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      bookId,
    });
    return next({ status: 500, message: 'Unable to retrieve book details.' });
  }
});

bookRoutes.get('/:id/cover', async (req, res) => {
  const parsedBookId = parseOpenLibraryWorkId(req.params.id);
  if ('error' in parsedBookId) {
    return res.status(404).send('Book cover not found');
  }

  const mediaId = parseOptionalPositiveInt(req.query.mediaId, 1_000_000_000);
  const format =
    req.query.format === 'ebook' || req.query.format === 'audiobook'
      ? req.query.format
      : undefined;

  if (!mediaId) {
    return res.status(404).send('Book cover not found');
  }

  const media = await getRepository(Media).findOne({
    where: { id: mediaId, mediaType: MediaType.BOOK },
  });
  const coverService = getBookCoverService(media ?? undefined, format);

  if (!coverService) {
    return res.status(404).send('Book cover not found');
  }

  try {
    const readarrApi = new ReadarrAPI({
      apiKey: coverService.server.apiKey,
      url: ReadarrAPI.buildUrl(coverService.server, '/api/v1'),
      mediaType: coverService.format,
    });
    const cover = await readarrApi.getBookCover(coverService.bookId);

    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', cover.contentType);
    res.setHeader('Content-Length', cover.imageBuffer.length);
    return res.status(200).send(cover.imageBuffer);
  } catch (e) {
    logger.warn('Failed to retrieve Bookshelf cover fallback', {
      label: 'Book',
      bookId: normalizeOpenLibraryWorkId(parsedBookId.value),
      mediaId,
      format: coverService.format,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(404).send('Book cover not found');
  }
});

export default bookRoutes;
