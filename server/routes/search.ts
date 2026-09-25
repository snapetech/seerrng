import ComicVineAPI from '@server/api/comicvine';
import CoverArtArchive from '@server/api/coverartarchive';
import LazyLibrarianAPI, {
  type LazyLibrarianMagazine,
} from '@server/api/lazylibrarian';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import {
  findBookMediaForBookResults,
  findBookMediaForSearchDocs,
} from '@server/lib/bookMediaMatcher';
import { findComicMediaByComicVineIds } from '@server/lib/comicMediaMatcher';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';
import { findMagazineMediaByTitles } from '@server/lib/magazineMediaMatcher';
import {
  getAvailableMusicQualities,
  getMusicQualityStatuses,
} from '@server/lib/musicQualityAvailability';
import {
  findSearchProvider,
  type CombinedSearchResponse,
} from '@server/lib/search';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  mapOpenLibraryAuthorSearchDoc,
  mapOpenLibrarySearchDoc,
  type AuthorResult,
} from '@server/models/Book';
import { mapComicVineVolumeResult } from '@server/models/Comic';
import { mapLazyLibrarianMagazine } from '@server/models/Magazine';
import { mapSearchResults } from '@server/models/Search';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import {
  searchBookshelfAuthors,
  searchBookshelfCatalogs,
} from '@server/utils/bookshelfCatalog';
import {
  BoundedTaskQueue,
  mapWithConcurrency,
  settlePromisesWithin,
} from '@server/utils/concurrency';
import { getHttpErrorDetails, hasHttpStatus } from '@server/utils/httpError';
import { parsePositiveInt } from '@server/utils/pagination';
import {
  matchesAllSearchTerms,
  toFieldedBooleanAndQuery,
  toMusicAlbumRefinementQuery,
} from '@server/utils/searchTerms';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalBoundedString,
  parseOptionalLanguage,
} from '@server/utils/validation';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { In } from 'typeorm';

const searchRoutes = Router();
const MAX_SEARCH_QUERY_LENGTH = 256;
export const SEARCH_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
export const MAX_SEARCH_RESULTS_PER_PROVIDER = 20;
export const MAX_COMBINED_SEARCH_RESULTS = 100;
export const SEARCH_PROVIDER_TIMEOUT_MS = 5_000;
export const SEARCH_CREDIT_LOOKUP_CONCURRENCY = parsePositiveInt(
  process.env.SEARCH_CREDIT_CONCURRENCY,
  10,
  40
);
const searchCreditLookupQueue = new BoundedTaskQueue(
  SEARCH_CREDIT_LOOKUP_CONCURRENCY,
  MAX_COMBINED_SEARCH_RESULTS
);
const searchRateLimit = rateLimit({
  ...SEARCH_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
  keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
});

searchRoutes.use(searchRateLimit);

export const capSearchProviderResults = <T>(
  value: unknown,
  limit = MAX_SEARCH_RESULTS_PER_PROVIDER
): T[] => {
  const maxResults =
    Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, MAX_COMBINED_SEARCH_RESULTS)
      : MAX_SEARCH_RESULTS_PER_PROVIDER;
  return Array.isArray(value) ? value.slice(0, maxResults) : [];
};

const searchTypes = [
  'movie',
  'tv',
  'person',
  'album',
  'artist',
  'book',
  'author',
  'music',
  'comic',
  'magazine',
] as const;
type SearchType = (typeof searchTypes)[number];
const bookFormats = ['ebook', 'audiobook'] as const;
type BookFormat = (typeof bookFormats)[number];

const parseSearchQuery = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'Query',
    maxLength: MAX_SEARCH_QUERY_LENGTH,
  });

const normalizeSearchText = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

type MagazineCatalogSearchResults = {
  totalResults: number;
  results: (LazyLibrarianMagazine & { serviceId: number })[];
};

const searchLazyLibrarianCatalogs = async (
  services: ReturnType<typeof getExternalRuntimeConfig>['lazylibrarian'],
  query: string,
  page: number
): Promise<MagazineCatalogSearchResults> => {
  const settled = await Promise.allSettled(
    services.map((service) =>
      runWithServarrServiceSnapshot('lazylibrarian', service, async (current) =>
        (
          await new LazyLibrarianAPI({
            url: LazyLibrarianAPI.buildUrl(current),
            apiKey: current.apiKey,
          }).getMagazines()
        ).map((magazine) => ({ ...magazine, serviceId: current.id }))
      )
    )
  );
  const successful = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  );
  const failures = settled.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  if (successful.length === 0 && failures.length > 0) {
    throw failures[0].reason;
  }
  if (failures.length > 0) {
    logger.warn('Some LazyLibrarian instances failed during magazine search', {
      label: 'Search',
      failedServices: failures.map(({ reason }) => getHttpErrorDetails(reason)),
    });
  }

  const magazinesByTitle = new Map<
    string,
    LazyLibrarianMagazine & { serviceId: number }
  >();
  for (const magazine of successful.flat()) {
    const key = normalizeMagazineTitle(magazine.title);
    if (key && !magazinesByTitle.has(key)) {
      magazinesByTitle.set(key, magazine);
    }
  }

  const matched = [...magazinesByTitle.values()]
    .filter((magazine) => matchesAllSearchTerms([magazine.title], query))
    .sort((left, right) => left.title.localeCompare(right.title));
  const offset = (page - 1) * MAX_SEARCH_RESULTS_PER_PROVIDER;

  return {
    totalResults: matched.length,
    results: matched.slice(offset, offset + MAX_SEARCH_RESULTS_PER_PROVIDER),
  };
};

const WRITING_JOBS = new Set(['Screenplay', 'Story', 'Teleplay', 'Writer']);

const sortedUniqueCreditNames = (values: unknown[]): string[] =>
  [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ].sort((left, right) => left.localeCompare(right));

export const extractSearchCrew = (details: {
  credits?: { crew?: { job?: string; name?: string }[] };
  created_by?: { name?: string }[];
}) => {
  const crew = details.credits?.crew ?? [];
  const directors = sortedUniqueCreditNames(
    crew
      .filter((credit) => credit.job === 'Director')
      .map((credit) => credit.name)
  );
  const creditedWriters = crew
    .filter((credit) => credit.job && WRITING_JOBS.has(credit.job))
    .map((credit) => credit.name);
  const writers = sortedUniqueCreditNames([
    ...creditedWriters,
    ...(creditedWriters.length === 0
      ? (details.created_by ?? []).map((creator) => creator.name)
      : []),
  ]);

  return { directors, writers };
};

const dedupeAlbumSearchResults = <T extends { id: string }>(
  albums: T[]
): T[] => {
  const seenIds = new Set<string>();

  return albums.filter((album) => {
    const id = normalizeMusicBrainzId(album.id);

    if (seenIds.has(id)) {
      return false;
    }

    seenIds.add(id);
    return true;
  });
};

const dedupeBookSearchDocs = <
  T extends { key: string; title: string; author_name?: string[] },
>(
  docs: T[]
): T[] => {
  const seenKeys = new Set<string>();
  const seenTitles = new Set<string>();

  return docs.filter((doc) => {
    const key = normalizeOpenLibraryWorkId(doc.key).toLocaleLowerCase();
    const titleKey = [
      normalizeSearchText(doc.title),
      normalizeSearchText(doc.author_name?.[0]),
    ].join('|');

    if (seenKeys.has(key) || seenTitles.has(titleKey)) {
      return false;
    }

    seenKeys.add(key);
    seenTitles.add(titleKey);
    return true;
  });
};

searchRoutes.get('/', async (req, res, next) => {
  const parsedQuery = parseSearchQuery(req.query.query);
  if ('error' in parsedQuery) {
    return res.status(400).json({ status: 400, message: parsedQuery.error });
  }

  const queryString = parsedQuery.value;
  let typeSpecificTotalResults: number | undefined;
  let typeSpecificTotalPages: number | undefined;
  const page = parsePositiveInt(req.query.page, 1, 500);
  const parsedLanguage = parseOptionalLanguage(req.query.language);
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  const language = parsedLanguage.value ?? req.locale;

  const parsedType = req.query.type
    ? parseOptionalAllowedString(req.query.type, {
        fieldName: 'Type',
        allowedValues: searchTypes,
        maxLength: 16,
      })
    : ({ value: undefined } as { value?: SearchType });
  if ('error' in parsedType) {
    return res.status(400).json({ status: 400, message: parsedType.error });
  }
  const typeFilter = parsedType.value;
  const parsedResultFilter = parseOptionalBoundedString(
    req.query.resultFilter,
    {
      fieldName: 'Result filter',
      maxLength: MAX_SEARCH_QUERY_LENGTH,
    }
  );
  if ('error' in parsedResultFilter) {
    return res
      .status(400)
      .json({ status: 400, message: parsedResultFilter.error });
  }
  const resultFilter = parsedResultFilter.value;
  const parsedFormat = req.query.format
    ? parseOptionalAllowedString(req.query.format, {
        fieldName: 'Format',
        allowedValues: bookFormats,
        maxLength: 16,
      })
    : ({ value: undefined } as { value?: BookFormat });
  if ('error' in parsedFormat) {
    return res.status(400).json({ status: 400, message: parsedFormat.error });
  }
  const bookFormat = parsedFormat.value;
  if (bookFormat && typeFilter !== 'book') {
    return res.status(400).json({
      status: 400,
      message: 'Format can only be used with book searches.',
    });
  }
  const settings = getExternalRuntimeConfig();
  const musicEnabled = settings.lidarr.length > 0;
  const booksEnabled = bookFormat
    ? settings.readarr.some(
        (server) => (server.serviceType ?? 'ebook') === bookFormat
      )
    : settings.readarr.length > 0;
  const comicVineApiKey = getSettings().main.comicVineApiKey;
  const comicsEnabled = !!comicVineApiKey;
  const magazinesEnabled = settings.lazylibrarian.length > 0;

  if (
    (typeFilter === 'album' ||
      typeFilter === 'artist' ||
      typeFilter === 'music') &&
    !musicEnabled
  ) {
    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }

  if ((typeFilter === 'book' || typeFilter === 'author') && !booksEnabled) {
    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }

  if (typeFilter === 'comic' && !comicsEnabled) {
    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }

  if (typeFilter === 'magazine' && !magazinesEnabled) {
    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }

  try {
    const tmdb = new TheMovieDb();
    const searchProvider = findSearchProvider(queryString.toLowerCase());
    let results: CombinedSearchResponse;

    if (searchProvider) {
      const [id] = queryString
        .toLowerCase()
        .match(searchProvider.pattern) as RegExpMatchArray;
      results = await searchProvider.search({
        id,
        language,
        query: queryString,
      });
    } else {
      const musicbrainz = new MusicBrainz();
      const openLibrary = new OpenLibraryAPI();
      const comicVine = comicVineApiKey
        ? new ComicVineAPI(comicVineApiKey)
        : undefined;
      const theAudioDb = new TheAudioDb();
      const coverArtArchive = new CoverArtArchive();
      const personMapper = new TmdbPersonMapper();
      const musicOffset = (page - 1) * 20;

      const shouldSearchVideo =
        !typeFilter ||
        typeFilter === 'movie' ||
        typeFilter === 'tv' ||
        typeFilter === 'person';
      const shouldSearchMusic =
        !typeFilter ||
        typeFilter === 'album' ||
        typeFilter === 'artist' ||
        typeFilter === 'music';
      const shouldSearchBooks = !typeFilter || typeFilter === 'book';
      const shouldSearchAuthors = !typeFilter || typeFilter === 'author';
      const shouldSearchComics = !typeFilter || typeFilter === 'comic';
      const shouldSearchMagazines = !typeFilter || typeFilter === 'magazine';
      const providerNames = [
        'TMDB',
        'MusicBrainz albums',
        'MusicBrainz artists',
        'Open Library books',
        'Bookshelf books',
        'Open Library authors',
        'Bookshelf authors',
        'ComicVine',
        'LazyLibrarian magazines',
      ];
      const providerPromises: Promise<unknown>[] = [
        shouldSearchVideo
          ? tmdb.searchMulti({
              query: queryString,
              page,
              language,
            })
          : Promise.resolve({
              page,
              results: [],
              total_pages: 1,
              total_results: 0,
            }),
        shouldSearchMusic && musicEnabled
          ? musicbrainz.searchAlbumWithTotal({
              query:
                typeFilter === 'music' && resultFilter
                  ? toMusicAlbumRefinementQuery(queryString, resultFilter)
                  : queryString,
              limit: 20,
              offset: musicOffset,
            })
          : Promise.resolve({ results: [], totalResults: 0 }),
        shouldSearchMusic && musicEnabled && !resultFilter
          ? musicbrainz.searchArtistWithTotal({
              query: queryString,
              limit: 20,
              offset: musicOffset,
            })
          : Promise.resolve({ results: [], totalResults: 0 }),
        shouldSearchBooks && booksEnabled
          ? openLibrary.searchBooks({
              query: toFieldedBooleanAndQuery(queryString, ['title', 'author']),
              page,
              limit: 20,
            })
          : Promise.resolve({ numFound: 0, start: 0, docs: [] }),
        shouldSearchBooks && booksEnabled
          ? searchBookshelfCatalogs(
              getSettings().readarr,
              queryString,
              bookFormat === 'ebook' || bookFormat === 'audiobook'
                ? bookFormat
                : undefined
            )
          : Promise.resolve([]),
        shouldSearchAuthors && booksEnabled
          ? openLibrary.searchAuthors({
              query: queryString,
              page,
              limit: 20,
            })
          : Promise.resolve({ numFound: 0, start: 0, docs: [] }),
        shouldSearchAuthors && booksEnabled
          ? searchBookshelfAuthors(getSettings().readarr, queryString)
          : Promise.resolve([]),
        shouldSearchComics && comicsEnabled && comicVine
          ? comicVine.searchVolumes({
              query: queryString,
              page,
              limit: 20,
            })
          : Promise.resolve({
              error: 'OK',
              limit: 20,
              offset: 0,
              number_of_page_results: 0,
              number_of_total_results: 0,
              status_code: 1,
              results: [],
            }),
        shouldSearchMagazines && magazinesEnabled
          ? searchLazyLibrarianCatalogs(
              settings.lazylibrarian,
              queryString,
              page
            )
          : Promise.resolve({ totalResults: 0, results: [] }),
      ];
      type SearchProviderResult = {
        index: number;
        result: PromiseSettledResult<unknown>;
      };
      type TmdbSearchResults = Awaited<ReturnType<TheMovieDb['searchMulti']>>;
      type AlbumSearchResults = Awaited<
        ReturnType<MusicBrainz['searchAlbumWithTotal']>
      >;
      type ArtistSearchResults = Awaited<
        ReturnType<MusicBrainz['searchArtistWithTotal']>
      >;
      type BookSearchResults = Awaited<
        ReturnType<OpenLibraryAPI['searchBooks']>
      >;
      type BookshelfSearchResults = Awaited<
        ReturnType<typeof searchBookshelfCatalogs>
      >;
      type AuthorSearchResults = Awaited<
        ReturnType<OpenLibraryAPI['searchAuthors']>
      >;
      type BookshelfAuthorSearchResults = Awaited<
        ReturnType<typeof searchBookshelfAuthors>
      >;
      type ComicSearchResults = Awaited<
        ReturnType<ComicVineAPI['searchVolumes']>
      >;
      type MagazineSearchResults = MagazineCatalogSearchResults;

      const providerResponses =
        await settlePromisesWithin<SearchProviderResult>(
          providerPromises.map((promise, index) =>
            promise.then(
              (value): SearchProviderResult => ({
                index,
                result: { status: 'fulfilled', value },
              }),
              (reason): SearchProviderResult => ({
                index,
                result: { status: 'rejected', reason },
              })
            )
          ),
          SEARCH_PROVIDER_TIMEOUT_MS
        );
      const providerResults = new Map(
        providerResponses.results
          .filter(
            (
              response
            ): response is PromiseFulfilledResult<SearchProviderResult> =>
              response.status === 'fulfilled'
          )
          .map(({ value }) => [value.index, value.result])
      );
      const failedProviders = providerNames.flatMap((provider, index) => {
        const response = providerResults.get(index);
        if (response?.status === 'rejected') {
          return [{ provider, ...getHttpErrorDetails(response.reason) }];
        }

        return !response && providerResponses.timedOut
          ? [
              {
                provider,
                timedOut: true,
                timeoutMs: SEARCH_PROVIDER_TIMEOUT_MS,
                errorCode: 'SEARCH_PROVIDER_TIMEOUT',
                errorMessage:
                  'Provider did not finish before the global search deadline.',
              },
            ]
          : [];
      });
      if (failedProviders.length > 0) {
        logger.warn('One or more global search providers failed', {
          label: 'API',
          failedProviders,
        });
      }
      const getProviderValue = <T>(index: number, fallback: T): T => {
        const response = providerResults.get(index);
        return response?.status === 'fulfilled'
          ? (response.value as T)
          : fallback;
      };

      const bookProviderResponse = providerResults.get(3);
      const bookshelfProviderResponse = providerResults.get(4);
      const authorProviderResponse = providerResults.get(5);
      const bookshelfAuthorProviderResponse = providerResults.get(6);
      if (
        typeFilter === 'book' &&
        shouldSearchBooks &&
        booksEnabled &&
        (!bookProviderResponse || bookProviderResponse.status === 'rejected') &&
        (!bookshelfProviderResponse ||
          bookshelfProviderResponse.status === 'rejected')
      ) {
        return next({
          status: 503,
          message:
            'Open Library, the service used for book searches, timed out or is unavailable. Please try again.',
        });
      }
      if (
        typeFilter === 'author' &&
        shouldSearchAuthors &&
        booksEnabled &&
        (!authorProviderResponse ||
          authorProviderResponse.status === 'rejected') &&
        (!bookshelfAuthorProviderResponse ||
          bookshelfAuthorProviderResponse.status === 'rejected')
      ) {
        return next({
          status: 503,
          message:
            'The author catalogs timed out or are unavailable. Please try again.',
        });
      }
      const comicProviderResponse = providerResults.get(7);
      if (
        typeFilter === 'comic' &&
        shouldSearchComics &&
        comicsEnabled &&
        (!comicProviderResponse || comicProviderResponse.status === 'rejected')
      ) {
        return next({
          status: 503,
          message:
            'ComicVine, the service used for comic searches, timed out or is unavailable. Please try again.',
        });
      }
      const magazineProviderResponse = providerResults.get(8);
      if (
        typeFilter === 'magazine' &&
        shouldSearchMagazines &&
        magazinesEnabled &&
        (!magazineProviderResponse ||
          magazineProviderResponse.status === 'rejected')
      ) {
        return next({
          status: 503,
          message:
            'LazyLibrarian, the service used for magazine searches, is unavailable. Please try again.',
        });
      }

      if (providerResponses.timedOut) {
        logger.debug('Global search provider deadline exceeded', {
          label: 'API',
          query: queryString,
          timeoutMs: SEARCH_PROVIDER_TIMEOUT_MS,
          completedProviders: providerResults.size,
        });
      }

      const rawTmdbResults = getProviderValue<TmdbSearchResults>(0, {
        page,
        results: [],
        total_pages: 1,
        total_results: 0,
      });
      const tmdbResults = {
        ...rawTmdbResults,
        results: rawTmdbResults.results.slice(
          0,
          MAX_SEARCH_RESULTS_PER_PROVIDER
        ),
      };
      const rawAlbumResults = getProviderValue<AlbumSearchResults>(1, {
        results: [],
        totalResults: 0,
      });
      const albumResults = capSearchProviderResults<
        AlbumSearchResults['results'][number]
      >(rawAlbumResults.results);
      const rawArtistResults = getProviderValue<ArtistSearchResults>(2, {
        results: [],
        totalResults: 0,
      });
      const artistResults = capSearchProviderResults<
        ArtistSearchResults['results'][number]
      >(rawArtistResults.results);
      const rawBookResults = getProviderValue<BookSearchResults>(3, {
        numFound: 0,
        start: 0,
        docs: [],
      });
      const rawBookshelfResults = getProviderValue<BookshelfSearchResults>(
        4,
        []
      );
      const rawAuthorResults = getProviderValue<AuthorSearchResults>(5, {
        numFound: 0,
        start: 0,
        docs: [],
      });
      const rawBookshelfAuthorResults =
        getProviderValue<BookshelfAuthorSearchResults>(6, []);
      const rawComicResults = getProviderValue<ComicSearchResults>(7, {
        error: 'OK',
        limit: 20,
        offset: 0,
        number_of_page_results: 0,
        number_of_total_results: 0,
        status_code: 1,
        results: [],
      });
      const rawMagazineResults = getProviderValue<MagazineSearchResults>(8, {
        totalResults: 0,
        results: [],
      });
      if (typeFilter === 'comic') {
        typeSpecificTotalResults = rawComicResults.number_of_total_results;
      } else if (typeFilter === 'magazine') {
        typeSpecificTotalResults = rawMagazineResults.totalResults;
      }
      if (typeSpecificTotalResults !== undefined) {
        typeSpecificTotalPages = Math.max(
          1,
          Math.ceil(typeSpecificTotalResults / MAX_SEARCH_RESULTS_PER_PROVIDER)
        );
      }
      const comicVolumes = capSearchProviderResults<
        ComicSearchResults['results'][number]
      >(rawComicResults.results);
      const bookResults = {
        ...rawBookResults,
        docs: capSearchProviderResults<BookSearchResults['docs'][number]>(
          rawBookResults.docs
        ),
      };

      const personIds = tmdbResults.results
        .filter(
          (result) => result.media_type === 'person' && !result.profile_path
        )
        .map((p) => p.id.toString());

      const dedupedAlbumResults = dedupeAlbumSearchResults(albumResults);
      const dedupedBookDocs = dedupeBookSearchDocs(bookResults.docs).filter(
        (doc) =>
          matchesAllSearchTerms(
            [doc.title, ...(doc.author_name ?? [])],
            queryString
          )
      );
      const dedupedAuthors = new Map<string, AuthorResult>();
      for (const author of [
        ...capSearchProviderResults<AuthorSearchResults['docs'][number]>(
          rawAuthorResults.docs
        ).map(mapOpenLibraryAuthorSearchDoc),
        ...capSearchProviderResults<AuthorResult>(rawBookshelfAuthorResults),
      ]) {
        const key = normalizeSearchText(author.name);
        if (key && !dedupedAuthors.has(key)) {
          dedupedAuthors.set(key, author);
        }
      }
      const authorResults = [...dedupedAuthors.values()];

      const albumIds = dedupedAlbumResults.map((album) =>
        normalizeMusicBrainzId(album.id)
      );
      const artistIds = artistResults.map((artist) =>
        normalizeMusicBrainzId(artist.id)
      );
      const tmdbPersonIds = tmdbResults.results
        .filter((result) => result.media_type === 'person')
        .map((person) => person.id.toString());

      const [artistMetadata, albumMetadata, artistsMetadata, existingMappings] =
        await Promise.all([
          personIds.length > 0
            ? getRepository(MetadataArtist).find({
                where: { tmdbPersonId: In(personIds) },
                cache: true,
                select: {
                  tmdbPersonId: true,
                  tadbThumb: true,
                  tadbCover: true,
                },
              })
            : [],
          albumIds.length > 0
            ? getRepository(MetadataAlbum).find({
                where: { mbAlbumId: In(albumIds) },
                select: { mbAlbumId: true, caaUrl: true },
              })
            : [],
          artistIds.length > 0
            ? getRepository(MetadataArtist).find({
                where: { mbArtistId: In(artistIds) },
                cache: true,
                select: {
                  mbArtistId: true,
                  tmdbPersonId: true,
                  tadbThumb: true,
                  tadbCover: true,
                },
              })
            : [],
          tmdbPersonIds.length > 0
            ? getRepository(MetadataArtist).find({
                where: { tmdbPersonId: In(tmdbPersonIds) },
                cache: true,
                select: { mbArtistId: true, tmdbPersonId: true },
              })
            : [],
        ]);

      const artistMetadataMap = new Map(
        artistMetadata.map((m) => [m.tmdbPersonId, m])
      );

      const artistsMetadataMap = new Map(
        artistsMetadata.map((m) => [normalizeMusicBrainzId(m.mbArtistId), m])
      );

      const existingMappingsMap = new Map(
        existingMappings.map((m) => [
          normalizeMusicBrainzId(m.mbArtistId),
          m.tmdbPersonId,
        ])
      );

      const coverArtByAlbumId = Object.fromEntries(
        albumMetadata.map((metadata) => [
          normalizeMusicBrainzId(metadata.mbAlbumId),
          metadata.caaUrl,
        ])
      );

      const personsWithoutImages = tmdbResults.results.filter(
        (result) => result.media_type === 'person' && !result.profile_path
      );

      personsWithoutImages.forEach((person) => {
        const metadata = artistMetadataMap.get(person.id.toString());
        if (metadata?.tadbThumb) {
          Object.assign(person, {
            profile_path: metadata.tadbThumb,
            artist_backdrop: metadata.tadbCover,
          });
        }
      });

      const artistsNeedingMapping = artistResults
        .filter(
          (artist) =>
            artist.type === 'Person' &&
            !artistsMetadataMap.get(normalizeMusicBrainzId(artist.id))
              ?.tmdbPersonId
        )
        .map((artist) => ({
          artistId: normalizeMusicBrainzId(artist.id),
          artistName: artist.name,
        }));

      const artistsNeedingImages = artistIds.filter((id) => {
        const metadata = artistsMetadataMap.get(normalizeMusicBrainzId(id));
        return !metadata?.tadbThumb && !metadata?.tadbCover;
      });

      if (
        albumIds.length > 0 ||
        artistsNeedingMapping.length > 0 ||
        artistsNeedingImages.length > 0
      ) {
        trackBackgroundTask('search metadata enrichment', async () => {
          await Promise.allSettled([
            albumIds.length > 0
              ? coverArtArchive.batchGetCoverArt(albumIds)
              : Promise.resolve(),
            artistsNeedingMapping.length > 0
              ? personMapper.batchGetMappings(artistsNeedingMapping)
              : Promise.resolve(),
            artistsNeedingImages.length > 0
              ? theAudioDb.batchGetArtistImages(artistsNeedingImages)
              : Promise.resolve(),
          ]);
        });
      }

      const albumsWithArt = dedupedAlbumResults.map((album) => {
        const posterPath =
          coverArtByAlbumId[normalizeMusicBrainzId(album.id)] ?? undefined;

        return {
          ...album,
          media_type: 'album' as const,
          posterPath,
          needsCoverArt: !posterPath,
          score: album.score || 0,
        };
      });

      const artistsWithArt = artistResults
        .map((artist) => {
          const artistId = normalizeMusicBrainzId(artist.id);
          const metadata = artistsMetadataMap.get(artistId);
          const hasTmdbPersonId = !!metadata?.tmdbPersonId;

          if (artist.type === 'Person' && hasTmdbPersonId) {
            return null;
          }

          const artistThumb = metadata?.tadbThumb ?? null;

          const artistBackdrop = metadata?.tadbCover ?? null;

          return {
            ...artist,
            media_type: 'artist' as const,
            artistThumb,
            artistBackdrop,
            score: artist.score || 0,
          };
        })
        .filter(
          (artist): artist is NonNullable<typeof artist> => artist !== null
        );

      const filteredArtists = artistsWithArt.filter((artist) => {
        const tmdbPersonId = existingMappingsMap.get(
          normalizeMusicBrainzId(artist.id)
        );
        return !tmdbPersonId || !tmdbPersonIds.includes(tmdbPersonId);
      });

      const musicResults = [...albumsWithArt, ...filteredArtists].sort(
        (a, b) => (b.score || 0) - (a.score || 0)
      );

      const musicTotalResults = Math.max(
        musicResults.length,
        rawAlbumResults.totalResults + rawArtistResults.totalResults
      );
      const bookshelfBookResults = rawBookshelfResults;
      const totalItems =
        tmdbResults.total_results +
        musicTotalResults +
        bookResults.numFound +
        bookshelfBookResults.length +
        rawAuthorResults.numFound +
        rawBookshelfAuthorResults.length +
        rawComicResults.number_of_total_results +
        rawMagazineResults.totalResults;
      const totalPages = Math.max(
        tmdbResults.total_pages,
        Math.ceil(totalItems / 20)
      );

      const bookMediaMap = await findBookMediaForSearchDocs(
        dedupedBookDocs,
        req.user
      );
      const mappedBookResults = dedupedBookDocs.map((doc) =>
        mapOpenLibrarySearchDoc(
          doc,
          bookMediaMap.get(normalizeOpenLibraryWorkId(doc.key))
        )
      );

      const comicMediaMap = await findComicMediaByComicVineIds(
        comicVolumes.map((volume) => volume.id),
        req.user
      );
      const mappedComicResults = comicVolumes.map((volume) =>
        mapComicVineVolumeResult(volume, comicMediaMap.get(volume.id))
      );
      const magazineMediaMap = await findMagazineMediaByTitles(
        rawMagazineResults.results.map((magazine) => magazine.title),
        req.user
      );
      const mappedMagazineResults = rawMagazineResults.results.map((magazine) =>
        mapLazyLibrarianMagazine(
          magazine,
          [],
          magazineMediaMap.get(normalizeMagazineTitle(magazine.title)),
          magazine.serviceId
        )
      );

      const combinedResults = [
        ...tmdbResults.results,
        ...musicResults,
        ...mappedBookResults,
        ...bookshelfBookResults,
        ...authorResults,
        ...mappedComicResults,
        ...mappedMagazineResults,
      ];

      results = {
        page: tmdbResults.page,
        total_pages: totalPages,
        total_results: totalItems,
        results: combinedResults,
      };
    }

    results.results = capSearchProviderResults<
      (typeof results.results)[number]
    >(results.results, MAX_COMBINED_SEARCH_RESULTS);

    const movieTvIds = results.results
      .filter(
        (result) =>
          'media_type' in result &&
          (result.media_type === 'movie' || result.media_type === 'tv')
      )
      .map((result) => Number(result.id));

    const musicIds = results.results
      .filter(
        (result) =>
          'media_type' in result &&
          (result.media_type === 'album' || result.media_type === 'artist')
      )
      .map((result) => normalizeMusicBrainzId(result.id.toString()));

    const bookResults = results.results.filter(
      (result): result is ReturnType<typeof mapOpenLibrarySearchDoc> =>
        'mediaType' in result && result.mediaType === 'book'
    );
    const bookIds = bookResults
      .filter(
        (result) =>
          result.mediaInfo === undefined && result.provider !== 'bookshelf'
      )
      .map((result) => normalizeOpenLibraryWorkId(result.id));

    const [movieTvMedia, musicMedia, bookMediaMap] = await Promise.all([
      movieTvIds.length > 0 ? Media.getRelatedMedia(req.user, movieTvIds) : [],
      musicIds.length > 0 ? Media.getRelatedMedia(req.user, musicIds) : [],
      bookIds.length > 0
        ? findBookMediaForBookResults(bookResults, req.user)
        : new Map<string, Media>(),
    ]);

    const media = [...movieTvMedia, ...musicMedia];
    results.results = results.results.map((result) =>
      'mediaType' in result && result.mediaType === 'book'
        ? {
            ...result,
            mediaInfo:
              result.mediaInfo ??
              bookMediaMap.get(normalizeOpenLibraryWorkId(result.id)),
          }
        : result
    );

    const mappedResults = await mapSearchResults(results.results, media);
    const qualityEnrichedResults = mappedResults.map((result) =>
      result.mediaType === 'album'
        ? {
            ...result,
            availableQualities: getAvailableMusicQualities(
              result.mediaInfo,
              result.mediaInfo?.requests ?? [],
              getSettings().lidarr
            ),
            qualityStatuses: getMusicQualityStatuses(
              result.mediaInfo,
              result.mediaInfo?.requests ?? [],
              getSettings().lidarr
            ),
          }
        : result
    );
    const creditEnrichedResults =
      typeFilter === 'movie' || typeFilter === 'tv'
        ? await mapWithConcurrency(
            qualityEnrichedResults,
            SEARCH_CREDIT_LOOKUP_CONCURRENCY,
            async (result) => {
              if (result.mediaType !== typeFilter) {
                return result;
              }

              try {
                const details = await searchCreditLookupQueue.run(async () =>
                  result.mediaType === 'movie'
                    ? await tmdb.getMovie({ movieId: result.id, language })
                    : await tmdb.getTvShow({ tvId: result.id, language })
                );

                return { ...result, ...extractSearchCrew(details) };
              } catch (error) {
                if (hasHttpStatus(error, 429)) {
                  logger.warn(
                    'TMDB rate limit reached during search credit enrichment; returning results without credits.',
                    {
                      label: 'Search',
                      mediaId: result.id,
                      ...getHttpErrorDetails(error),
                    }
                  );
                }
                return result;
              }
            }
          )
        : qualityEnrichedResults;

    const capabilityResults = creditEnrichedResults.filter(
      (result) =>
        !('mediaType' in result) ||
        (((result.mediaType !== 'album' && result.mediaType !== 'artist') ||
          musicEnabled) &&
          (result.mediaType !== 'book' || booksEnabled) &&
          (result.mediaType !== 'comic' || comicsEnabled) &&
          (result.mediaType !== 'magazine' || magazinesEnabled))
    );

    const filteredResults = typeFilter
      ? capabilityResults.filter(
          (result) =>
            'mediaType' in result &&
            (typeFilter === 'music'
              ? result.mediaType === 'album' || result.mediaType === 'artist'
              : result.mediaType === typeFilter)
        )
      : capabilityResults;

    const capabilityFiltered =
      capabilityResults.length !== creditEnrichedResults.length;

    return res.status(200).json({
      page: results.page,
      totalPages: typeSpecificTotalPages ?? results.total_pages,
      totalResults:
        typeSpecificTotalResults ??
        (typeFilter || capabilityFiltered
          ? filteredResults.length
          : results.total_results),
      results: filteredResults,
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving search results', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      query: queryString,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve search results.',
    });
  }
});

searchRoutes.get('/keyword', async (req, res, next) => {
  const parsedQuery = parseSearchQuery(req.query.query);
  if ('error' in parsedQuery) {
    return res.status(400).json({ status: 400, message: parsedQuery.error });
  }

  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchKeyword({
      query: parsedQuery.value,
      page: parsePositiveInt(req.query.page, 1, 500),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving keyword search results', {
      label: 'API',
      errorMessage: e.message,
      query: parsedQuery.value,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve keyword search results.',
    });
  }
});

searchRoutes.get('/company', async (req, res, next) => {
  const parsedQuery = parseSearchQuery(req.query.query);
  if ('error' in parsedQuery) {
    return res.status(400).json({ status: 400, message: parsedQuery.error });
  }

  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.searchCompany({
      query: parsedQuery.value,
      page: parsePositiveInt(req.query.page, 1, 500),
    });

    return res.status(200).json(results);
  } catch (e) {
    logger.debug('Something went wrong retrieving company search results', {
      label: 'API',
      errorMessage: e.message,
      query: parsedQuery.value,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve company search results.',
    });
  }
});

export default searchRoutes;
