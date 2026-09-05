import CoverArtArchive from '@server/api/coverartarchive';
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
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  findSearchProvider,
  type CombinedSearchResponse,
} from '@server/lib/search';
import logger from '@server/logger';
import { mapOpenLibrarySearchDoc } from '@server/models/Book';
import { mapSearchResults } from '@server/models/Search';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import { settlePromisesWithin } from '@server/utils/concurrency';
import { parsePositiveInt } from '@server/utils/pagination';
import {
  parseBoundedString,
  parseOptionalAllowedString,
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
  'music',
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

  if (typeFilter === 'book' && !booksEnabled) {
    return res.status(200).json({
      page,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }

  try {
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
      const tmdb = new TheMovieDb();
      const musicbrainz = new MusicBrainz();
      const openLibrary = new OpenLibraryAPI();
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
          ? musicbrainz.searchAlbum({
              query: queryString,
              limit: 20,
              offset: musicOffset,
            })
          : Promise.resolve([]),
        shouldSearchMusic && musicEnabled
          ? musicbrainz.searchArtist({
              query: queryString,
              limit: 20,
              offset: musicOffset,
            })
          : Promise.resolve([]),
        shouldSearchBooks && booksEnabled
          ? openLibrary.searchBooks({
              query: queryString,
              page,
              limit: 20,
            })
          : Promise.resolve({ numFound: 0, start: 0, docs: [] }),
      ];
      type SearchProviderResult = {
        index: number;
        result: PromiseSettledResult<unknown>;
      };
      type TmdbSearchResults = Awaited<ReturnType<TheMovieDb['searchMulti']>>;
      type AlbumSearchResults = Awaited<ReturnType<MusicBrainz['searchAlbum']>>;
      type ArtistSearchResults = Awaited<
        ReturnType<MusicBrainz['searchArtist']>
      >;
      type BookSearchResults = Awaited<
        ReturnType<OpenLibraryAPI['searchBooks']>
      >;

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
      const getProviderValue = <T>(index: number, fallback: T): T => {
        const response = providerResults.get(index);
        return response?.status === 'fulfilled'
          ? (response.value as T)
          : fallback;
      };

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
      const albumResults = capSearchProviderResults<AlbumSearchResults[number]>(
        getProviderValue<AlbumSearchResults>(1, [])
      );
      const artistResults = capSearchProviderResults<
        ArtistSearchResults[number]
      >(getProviderValue<ArtistSearchResults>(2, []));
      const rawBookResults = getProviderValue<BookSearchResults>(3, {
        numFound: 0,
        start: 0,
        docs: [],
      });
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
      const dedupedBookDocs = dedupeBookSearchDocs(bookResults.docs);

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
                select: ['tmdbPersonId', 'tadbThumb', 'tadbCover'],
              })
            : [],
          albumIds.length > 0
            ? getRepository(MetadataAlbum).find({
                where: { mbAlbumId: In(albumIds) },
                select: ['mbAlbumId', 'caaUrl'],
              })
            : [],
          artistIds.length > 0
            ? getRepository(MetadataArtist).find({
                where: { mbArtistId: In(artistIds) },
                cache: true,
                select: [
                  'mbArtistId',
                  'tmdbPersonId',
                  'tadbThumb',
                  'tadbCover',
                ],
              })
            : [],
          tmdbPersonIds.length > 0
            ? getRepository(MetadataArtist).find({
                where: { tmdbPersonId: In(tmdbPersonIds) },
                cache: true,
                select: ['mbArtistId', 'tmdbPersonId'],
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

      const totalItems =
        tmdbResults.total_results +
        musicResults.length +
        dedupedBookDocs.length;
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

      const combinedResults = [
        ...tmdbResults.results,
        ...musicResults,
        ...mappedBookResults,
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
      .filter((result) => result.mediaInfo === undefined)
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

    const capabilityResults = mappedResults.filter(
      (result) =>
        !('mediaType' in result) ||
        (((result.mediaType !== 'album' && result.mediaType !== 'artist') ||
          musicEnabled) &&
          (result.mediaType !== 'book' || booksEnabled))
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
      capabilityResults.length !== mappedResults.length;

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults:
        typeFilter || capabilityFiltered
          ? filteredResults.length
          : results.total_results,
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
