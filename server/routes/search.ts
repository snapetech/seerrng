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
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
import {
  findSearchProvider,
  type CombinedSearchResponse,
} from '@server/lib/search';
import logger from '@server/logger';
import { mapOpenLibrarySearchDoc } from '@server/models/Book';
import { mapSearchResults } from '@server/models/Search';
import { parsePositiveInt } from '@server/utils/pagination';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalLanguage,
} from '@server/utils/validation';
import { Router } from 'express';
import { In } from 'typeorm';

const searchRoutes = Router();
const MAX_SEARCH_QUERY_LENGTH = 256;

const searchTypes = [
  'movie',
  'tv',
  'person',
  'album',
  'artist',
  'book',
] as const;
type SearchType = (typeof searchTypes)[number];

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
    const id = album.id.toLocaleLowerCase();

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
      const personMapper = new TmdbPersonMapper();
      const musicOffset = (page - 1) * 20;

      const responses = await Promise.allSettled([
        tmdb.searchMulti({
          query: queryString,
          page,
          language,
        }),
        musicbrainz.searchAlbum({
          query: queryString,
          limit: 20,
          offset: musicOffset,
        }),
        musicbrainz.searchArtist({
          query: queryString,
          limit: 20,
          offset: musicOffset,
        }),
        openLibrary.searchBooks({
          query: queryString,
          page,
          limit: 20,
        }),
      ]);

      const tmdbResults =
        responses[0].status === 'fulfilled'
          ? responses[0].value
          : { page: 1, results: [], total_pages: 1, total_results: 0 };
      const albumResults =
        responses[1].status === 'fulfilled' ? responses[1].value : [];
      const artistResults =
        responses[2].status === 'fulfilled' ? responses[2].value : [];
      const bookResults =
        responses[3].status === 'fulfilled'
          ? responses[3].value
          : { numFound: 0, start: 0, docs: [] };

      const personIds = tmdbResults.results
        .filter(
          (result) => result.media_type === 'person' && !result.profile_path
        )
        .map((p) => p.id.toString());

      const dedupedAlbumResults = dedupeAlbumSearchResults(albumResults);
      const dedupedBookDocs = dedupeBookSearchDocs(bookResults.docs);

      const albumIds = dedupedAlbumResults.map((album) => album.id);
      const artistIds = artistResults.map((artist) => artist.id);
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
                cache: true,
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

      const albumMetadataMap = new Map(
        albumMetadata.map((m) => [m.mbAlbumId, m])
      );

      const artistsMetadataMap = new Map(
        artistsMetadata.map((m) => [m.mbArtistId, m])
      );

      const existingMappingsMap = new Map(
        existingMappings.map((m) => [m.mbArtistId, m.tmdbPersonId])
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
            !artistsMetadataMap.get(artist.id)?.tmdbPersonId
        )
        .map((artist) => ({
          artistId: artist.id,
          artistName: artist.name,
        }));

      const artistsNeedingImages = artistIds.filter((id) => {
        const metadata = artistsMetadataMap.get(id);
        return !metadata?.tadbThumb && !metadata?.tadbCover;
      });

      type PersonMappingResult = Record<
        string,
        { personId: number | null; profilePath: string | null }
      >;
      type ArtistImageResult = Record<
        string,
        { artistThumb: string | null; artistBackground: string | null }
      >;

      const externalApiResponses = await Promise.allSettled([
        artistsNeedingMapping.length > 0
          ? personMapper.batchGetMappings(artistsNeedingMapping)
          : ({} as PersonMappingResult),
        artistsNeedingImages.length > 0
          ? theAudioDb.batchGetArtistImages(artistsNeedingImages)
          : ({} as ArtistImageResult),
      ]);

      const personMappingResults =
        externalApiResponses[0].status === 'fulfilled'
          ? externalApiResponses[0].value
          : ({} as PersonMappingResult);
      const artistImageResults =
        externalApiResponses[1].status === 'fulfilled'
          ? externalApiResponses[1].value
          : ({} as ArtistImageResult);

      let updatedArtistsMetadataMap = artistsMetadataMap;
      if (
        (artistsNeedingMapping.length > 0 || artistsNeedingImages.length > 0) &&
        artistIds.length > 0
      ) {
        const updatedArtistsMetadata = await getRepository(MetadataArtist).find(
          {
            where: { mbArtistId: In(artistIds) },
            cache: true,
            select: ['mbArtistId', 'tmdbPersonId', 'tadbThumb', 'tadbCover'],
          }
        );

        updatedArtistsMetadataMap = new Map(
          updatedArtistsMetadata.map((m) => [m.mbArtistId, m])
        );
      }

      const albumsWithArt = dedupedAlbumResults.map((album) => {
        const metadata = albumMetadataMap.get(album.id);

        return {
          ...album,
          media_type: 'album' as const,
          posterPath: metadata?.caaUrl ?? undefined,
          needsCoverArt: !metadata?.caaUrl,
          score: album.score || 0,
        };
      });

      const artistsWithArt = artistResults
        .map((artist) => {
          const metadata = updatedArtistsMetadataMap.get(artist.id);
          const personMapping = personMappingResults[artist.id];
          const hasTmdbPersonId =
            !!metadata?.tmdbPersonId ||
            (personMapping ? personMapping.personId !== null : false);

          if (artist.type === 'Person' && hasTmdbPersonId) {
            return null;
          }

          const artistThumb =
            metadata?.tadbThumb ||
            (artistImageResults[artist.id]?.artistThumb ?? null);

          const artistBackdrop =
            metadata?.tadbCover ||
            (artistImageResults[artist.id]?.artistBackground ?? null);

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
        const tmdbPersonId = existingMappingsMap.get(artist.id);
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
        req.user?.id
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
      .map((result) => result.id.toString());

    const bookResults = results.results.filter(
      (result): result is ReturnType<typeof mapOpenLibrarySearchDoc> =>
        'mediaType' in result && result.mediaType === 'book'
    );
    const bookIds = bookResults
      .filter((result) => result.mediaInfo === undefined)
      .map((result) => result.id);

    const [movieTvMedia, musicMedia, bookMediaMap] = await Promise.all([
      movieTvIds.length > 0 ? Media.getRelatedMedia(req.user, movieTvIds) : [],
      musicIds.length > 0 ? Media.getRelatedMedia(req.user, musicIds) : [],
      bookIds.length > 0
        ? findBookMediaForBookResults(bookResults, req.user?.id)
        : new Map<string, Media>(),
    ]);

    const media = [...movieTvMedia, ...musicMedia];
    results.results = results.results.map((result) =>
      'mediaType' in result && result.mediaType === 'book'
        ? {
            ...result,
            mediaInfo: result.mediaInfo ?? bookMediaMap.get(result.id),
          }
        : result
    );

    const mappedResults = await mapSearchResults(results.results, media);

    const filteredResults = typeFilter
      ? mappedResults.filter(
          (result) => 'mediaType' in result && result.mediaType === typeFilter
        )
      : mappedResults;

    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: typeFilter ? filteredResults.length : results.total_results,
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
