import MusicBrainz from '@server/api/musicbrainz';
import type {
  MbAlbumResult,
  MbArtistResult,
} from '@server/api/musicbrainz/interfaces';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbCollectionResult,
  TmdbMovieDetails,
  TmdbMovieResult,
  TmdbPersonDetails,
  TmdbPersonResult,
  TmdbSearchMovieResponse,
  TmdbSearchTvResponse,
  TmdbTvDetails,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import type { BookResult } from '@server/models/Book';
import {
  mapOpenLibrarySearchDoc,
  mapOpenLibraryWork,
} from '@server/models/Book';
import {
  mapMovieDetailsToResult,
  mapPersonDetailsToResult,
  mapTvDetailsToResult,
} from '@server/models/Search';
import {
  isMovie,
  isMovieDetails,
  isTvDetails,
} from '@server/utils/typeHelpers';

export type CombinedSearchResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: (
    | MbArtistResult
    | MbAlbumResult
    | TmdbMovieResult
    | TmdbTvResult
    | TmdbPersonResult
    | TmdbCollectionResult
    | BookResult
  )[];
};
interface SearchProvider {
  pattern: RegExp;
  search: ({
    id,
    language,
    query,
  }: {
    id: string;
    language?: string;
    query?: string;
  }) => Promise<CombinedSearchResponse>;
}

const searchProviders: SearchProvider[] = [];
const MUSICBRAINZ_MID_PATTERN =
  /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;

const normalizeProviderSearchText = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const dedupeProviderAlbums = (albums: MbAlbumResult[]): MbAlbumResult[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return albums.filter((album) => {
    const idKey = album.id.toLocaleLowerCase();
    const titleKey = [
      normalizeProviderSearchText(album.title),
      normalizeProviderSearchText(album['artist-credit']?.[0]?.name),
      album['first-release-date']?.slice(0, 4) ?? '',
      normalizeProviderSearchText(album['primary-type']),
    ].join('|');

    if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
      return false;
    }

    seenIds.add(idKey);
    seenTitles.add(titleKey);
    return true;
  });
};

const dedupeProviderBooks = (books: BookResult[]): BookResult[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return books.filter((book) => {
    const idKey = book.id.toLocaleLowerCase();
    const titleKey = [
      normalizeProviderSearchText(book.title),
      normalizeProviderSearchText(book.author),
    ].join('|');

    if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
      return false;
    }

    seenIds.add(idKey);
    seenTitles.add(titleKey);
    return true;
  });
};

export const findSearchProvider = (
  query: string
): SearchProvider | undefined => {
  return searchProviders.find((provider) => provider.pattern.test(query));
};

const searchMusicBrainzById = async (
  id: string
): Promise<CombinedSearchResponse> => {
  const musicbrainz = new MusicBrainz();

  try {
    let releaseGroupId = id;
    let albumDetails: MbAlbumResult | null = null;

    try {
      albumDetails = await musicbrainz.getReleaseGroupDetails({
        releaseGroupId,
      });
    } catch {
      const resolvedReleaseGroupId = await musicbrainz.getReleaseGroup({
        releaseId: id,
      });

      if (!resolvedReleaseGroupId) {
        throw new Error('MusicBrainz ID did not resolve to a release group');
      }

      releaseGroupId = resolvedReleaseGroupId;
      albumDetails = await musicbrainz.getReleaseGroupDetails({
        releaseGroupId,
      });
    }

    const result: MbAlbumResult = {
      ...albumDetails,
      id: releaseGroupId,
      media_type: 'album',
      score: albumDetails.score || 100,
    };

    return {
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [result],
    };
  } catch {
    return {
      page: 1,
      total_pages: 1,
      total_results: 0,
      results: [],
    };
  }
};

searchProviders.push({
  pattern: new RegExp(/(?<=tmdb:)\d+/),
  search: async ({ id, language }) => {
    const tmdb = new TheMovieDb();

    const moviePromise = tmdb.getMovie({ movieId: parseInt(id), language });
    const tvShowPromise = tmdb.getTvShow({ tvId: parseInt(id), language });
    const personPromise = tmdb.getPerson({ personId: parseInt(id), language });

    const responses = await Promise.allSettled([
      moviePromise,
      tvShowPromise,
      personPromise,
    ]);

    const successfulResponses = responses.filter(
      (r) => r.status === 'fulfilled'
    ) as (
      | PromiseFulfilledResult<TmdbMovieDetails>
      | PromiseFulfilledResult<TmdbTvDetails>
      | PromiseFulfilledResult<TmdbPersonDetails>
    )[];

    const results: (TmdbMovieResult | TmdbTvResult | TmdbPersonResult)[] = [];

    if (successfulResponses.length) {
      results.push(
        ...successfulResponses.map((r) => {
          if (isMovieDetails(r.value)) {
            return mapMovieDetailsToResult(r.value);
          } else if (isTvDetails(r.value)) {
            return mapTvDetailsToResult(r.value);
          } else {
            return mapPersonDetailsToResult(r.value);
          }
        })
      );
    }

    return {
      page: 1,
      total_pages: 1,
      total_results: results.length,
      results,
    };
  },
});

searchProviders.push({
  pattern: new RegExp(/(?<=imdb:)(tt|nm)\d+/),
  search: async ({ id, language }) => {
    const tmdb = new TheMovieDb();

    const responses = await tmdb.getByExternalId({
      externalId: id,
      type: 'imdb',
      language,
    });

    const results: (TmdbMovieResult | TmdbTvResult | TmdbPersonResult)[] = [];

    // set the media_type here since searching by external id doesn't return it
    results.push(
      ...(responses.movie_results.map((movie) => ({
        ...movie,
        media_type: 'movie',
      })) as TmdbMovieResult[]),
      ...(responses.tv_results.map((tv) => ({
        ...tv,
        media_type: 'tv',
      })) as TmdbTvResult[]),
      ...(responses.person_results.map((person) => ({
        ...person,
        media_type: 'person',
      })) as TmdbPersonResult[])
    );

    return {
      page: 1,
      total_pages: 1,
      total_results: results.length,
      results,
    };
  },
});

searchProviders.push({
  pattern: new RegExp(/(?<=tvdb:)\d+/),
  search: async ({ id, language }) => {
    const tmdb = new TheMovieDb();

    const responses = await tmdb.getByExternalId({
      externalId: parseInt(id),
      type: 'tvdb',
      language,
    });

    const results: (TmdbMovieResult | TmdbTvResult | TmdbPersonResult)[] = [];

    // set the media_type here since searching by external id doesn't return it
    results.push(
      ...(responses.movie_results.map((movie) => ({
        ...movie,
        media_type: 'movie',
      })) as TmdbMovieResult[]),
      ...(responses.tv_results.map((tv) => ({
        ...tv,
        media_type: 'tv',
      })) as TmdbTvResult[]),
      ...(responses.person_results.map((person) => ({
        ...person,
        media_type: 'person',
      })) as TmdbPersonResult[])
    );

    return {
      page: 1,
      total_pages: 1,
      total_results: results.length,
      results,
    };
  },
});

searchProviders.push({
  pattern: new RegExp(/(?<=year:)\d{4}/),
  search: async ({ id: year, query }) => {
    const tmdb = new TheMovieDb();

    const moviesPromise = tmdb.searchMovies({
      query: query?.replace(new RegExp(/year:\d{4}/), '') ?? '',
      year: parseInt(year),
    });
    const tvShowsPromise = tmdb.searchTvShows({
      query: query?.replace(new RegExp(/year:\d{4}/), '') ?? '',
      year: parseInt(year),
    });

    const responses = await Promise.allSettled([moviesPromise, tvShowsPromise]);

    const successfulResponses = responses.filter(
      (r) => r.status === 'fulfilled'
    ) as (
      | PromiseFulfilledResult<TmdbSearchMovieResponse>
      | PromiseFulfilledResult<TmdbSearchTvResponse>
    )[];

    const results: (TmdbMovieResult | TmdbTvResult)[] = [];

    if (successfulResponses.length) {
      successfulResponses.forEach((response) => {
        response.value.results.forEach((result) =>
          // set the media_type here since the search endpoints don't return it
          results.push(
            isMovie(result)
              ? { ...result, media_type: 'movie' }
              : { ...result, media_type: 'tv' }
          )
        );
      });
    }

    return {
      page: 1,
      total_pages: 1,
      total_results: results.length,
      results,
    };
  },
});

searchProviders.push({
  pattern: new RegExp(`(?<=musicbrainz:)${MUSICBRAINZ_MID_PATTERN.source}`),
  search: async ({ id }) => searchMusicBrainzById(id),
});

searchProviders.push({
  pattern: new RegExp(`(?<=mbid:)${MUSICBRAINZ_MID_PATTERN.source}`),
  search: async ({ id }) => searchMusicBrainzById(id),
});

searchProviders.push({
  pattern: new RegExp(/(?<=musicbrainz:).+/),
  search: async ({ query }) => {
    const musicbrainz = new MusicBrainz();

    try {
      const searchQuery = query?.replace(/^musicbrainz:/i, '') ?? '';
      const albumResults = dedupeProviderAlbums(
        await musicbrainz.searchAlbum({
          query: searchQuery,
          limit: 20,
        })
      );

      const results: CombinedSearchResponse['results'] = albumResults.map(
        (album) =>
          ({
            ...album,
            media_type: 'album',
          }) as MbAlbumResult
      );

      return {
        page: 1,
        total_pages: 1,
        total_results: results.length,
        results,
      };
    } catch {
      return {
        page: 1,
        total_pages: 1,
        total_results: 0,
        results: [],
      };
    }
  },
});

searchProviders.push({
  pattern: new RegExp(/(?<=openlibrary:)ol\d+w/),
  search: async ({ id }) => {
    const openLibrary = new OpenLibraryAPI();

    try {
      const workId = id.toUpperCase();
      const [work, editions] = await Promise.all([
        openLibrary.getWork(workId),
        openLibrary.getWorkEditions(workId).catch(() => ({
          size: 0,
          entries: [],
        })),
      ]);
      const result = mapOpenLibraryWork(work, undefined, editions.entries);

      return {
        page: 1,
        total_pages: 1,
        total_results: 1,
        results: [result],
      };
    } catch {
      return {
        page: 1,
        total_pages: 1,
        total_results: 0,
        results: [],
      };
    }
  },
});

searchProviders.push({
  pattern: new RegExp(/(?<=isbn:)[0-9x-]+/),
  search: async ({ id }) => {
    const openLibrary = new OpenLibraryAPI();

    try {
      const books = await openLibrary.searchBooks({
        query: `isbn:${id}`,
        page: 1,
        limit: 20,
      });
      const results = dedupeProviderBooks(
        books.docs.map((doc) => mapOpenLibrarySearchDoc(doc))
      );

      return {
        page: 1,
        total_pages: Math.max(Math.ceil(results.length / 20), 1),
        total_results: results.length,
        results,
      };
    } catch {
      return {
        page: 1,
        total_pages: 1,
        total_results: 0,
        results: [],
      };
    }
  },
});
