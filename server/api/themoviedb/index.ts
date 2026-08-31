import ExternalAPI from '@server/api/externalapi';
import type { TvShowProvider } from '@server/api/provider';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';
import { sortBy } from 'lodash';
import { getTmdbAuthHeaders, getTmdbAuthParams } from './auth';
import type {
  TmdbCollection,
  TmdbCompanySearchResponse,
  TmdbExternalIdResponse,
  TmdbGenre,
  TmdbGenresResult,
  TmdbKeyword,
  TmdbKeywordSearchResponse,
  TmdbLanguage,
  TmdbMovieDetails,
  TmdbNetwork,
  TmdbPersonCombinedCredits,
  TmdbPersonDetails,
  TmdbProductionCompany,
  TmdbRegion,
  TmdbSearchMovieResponse,
  TmdbSearchMultiResponse,
  TmdbSearchTvResponse,
  TmdbSeasonWithEpisodes,
  TmdbTvDetails,
  TmdbUpcomingMoviesResponse,
  TmdbWatchProviderDetails,
  TmdbWatchProviderRegion,
} from './interfaces';

export const MAX_TMDB_PAGE_RESULTS = 100;
export const MAX_TMDB_SEASON_EPISODES = 2_500;
export const MAX_TMDB_LOOKUP_RESULTS = 500;
export const MAX_TMDB_DETAIL_CREDITS = 1_000;
export const MAX_TMDB_DETAIL_TEXT_LENGTH = 20_000;
const MAX_TMDB_DETAIL_ARRAY = 500;
const MAX_TMDB_DETAIL_VIDEOS = 100;
const MAX_TMDB_WATCH_PROVIDER_REGIONS = 250;
const MAX_TMDB_WATCH_PROVIDERS_PER_TYPE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedTmdbString = (value: unknown, maximum = 1000): string =>
  typeof value === 'string' ? value.slice(0, maximum) : '';

const boundedTmdbStrings = (value: unknown, maximum = MAX_TMDB_DETAIL_ARRAY) =>
  Array.isArray(value)
    ? value
        .slice(0, maximum)
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.slice(0, 1000))
    : [];

const boundedTmdbRecords = (value: unknown, maximum = MAX_TMDB_DETAIL_ARRAY) =>
  Array.isArray(value) ? value.slice(0, maximum).filter(isRecord) : [];

const finiteTmdbNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const integerTmdbNumber = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) ? (value as number) : fallback;

const sanitizeTmdbExternalIds = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const field of [
    'imdb_id',
    'freebase_mid',
    'freebase_id',
    'tvrage_id',
    'facebook_id',
    'instagram_id',
    'twitter_id',
  ]) {
    const normalized = boundedTmdbString(value[field], 512);
    if (normalized) result[field] = normalized;
  }
  if (Number.isSafeInteger(value.tvdb_id)) {
    result.tvdb_id = value.tvdb_id;
  }
  return result;
};

const sanitizeTmdbIdName = (value: Record<string, unknown>) => ({
  id: integerTmdbNumber(value.id),
  name: boundedTmdbString(value.name, 1000),
});

const sanitizeTmdbCast = (value: Record<string, unknown>) => ({
  cast_id: integerTmdbNumber(value.cast_id),
  character: boundedTmdbString(value.character, 2000),
  credit_id: boundedTmdbString(value.credit_id, 512),
  gender: Number.isSafeInteger(value.gender)
    ? (value.gender as number)
    : undefined,
  id: integerTmdbNumber(value.id),
  name: boundedTmdbString(value.name, 1000),
  order: integerTmdbNumber(value.order),
  profile_path: boundedTmdbString(value.profile_path, 2000) || undefined,
});

const sanitizeTmdbCrew = (value: Record<string, unknown>) => ({
  credit_id: boundedTmdbString(value.credit_id, 512),
  gender: Number.isSafeInteger(value.gender)
    ? (value.gender as number)
    : undefined,
  id: integerTmdbNumber(value.id),
  name: boundedTmdbString(value.name, 1000),
  profile_path: boundedTmdbString(value.profile_path, 2000) || undefined,
  job: boundedTmdbString(value.job, 1000),
  department: boundedTmdbString(value.department, 1000),
});

const TMDB_VIDEO_TYPES = new Set([
  'Clip',
  'Teaser',
  'Trailer',
  'Featurette',
  'Opening Credits',
  'Behind the Scenes',
  'Bloopers',
]);

const sanitizeTmdbVideo = (value: Record<string, unknown>) => {
  const key = boundedTmdbString(value.key, 512);
  const type = boundedTmdbString(value.type, 128);
  if (value.site !== 'YouTube' || !key || !TMDB_VIDEO_TYPES.has(type)) {
    return undefined;
  }
  return {
    id: boundedTmdbString(value.id, 512),
    key,
    name: boundedTmdbString(value.name, 1000),
    site: 'YouTube' as const,
    size: integerTmdbNumber(value.size),
    type,
  };
};

const sanitizeTmdbWatchProviderDetails = (value: Record<string, unknown>) => ({
  display_priority: Number.isSafeInteger(value.display_priority)
    ? (value.display_priority as number)
    : undefined,
  logo_path: boundedTmdbString(value.logo_path, 2000) || undefined,
  provider_id: integerTmdbNumber(value.provider_id),
  provider_name: boundedTmdbString(value.provider_name, 1000),
});

const sanitizeTmdbEpisode = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  return {
    id: integerTmdbNumber(value.id),
    air_date: boundedTmdbString(value.air_date, 128) || null,
    episode_number: integerTmdbNumber(value.episode_number),
    name: boundedTmdbString(value.name, 1000),
    overview: boundedTmdbString(value.overview, MAX_TMDB_DETAIL_TEXT_LENGTH),
    production_code: boundedTmdbString(value.production_code, 512),
    season_number: integerTmdbNumber(value.season_number),
    show_id: integerTmdbNumber(value.show_id),
    still_path: boundedTmdbString(value.still_path, 2000),
    vote_average: finiteTmdbNumber(value.vote_average),
    vote_count: integerTmdbNumber(value.vote_count),
  };
};

const sanitizeTmdbWatchProviders = (
  value: unknown
): Record<string, unknown> => {
  if (!isRecord(value) || !isRecord(value.results)) {
    return { results: {} };
  }

  const results: Record<string, unknown> = {};
  for (const [region, rawProvider] of Object.entries(value.results).slice(
    0,
    MAX_TMDB_WATCH_PROVIDER_REGIONS
  )) {
    if (!isRecord(rawProvider)) {
      continue;
    }
    results[region.slice(0, 16)] = {
      link: boundedTmdbString(rawProvider.link, 2000),
      buy: boundedTmdbRecords(
        rawProvider.buy,
        MAX_TMDB_WATCH_PROVIDERS_PER_TYPE
      ).map(sanitizeTmdbWatchProviderDetails),
      flatrate: boundedTmdbRecords(
        rawProvider.flatrate,
        MAX_TMDB_WATCH_PROVIDERS_PER_TYPE
      ).map(sanitizeTmdbWatchProviderDetails),
    };
  }

  return { results };
};

const sanitizeTmdbVideos = (
  value: unknown
): { results: Record<string, unknown>[] } => ({
  results: isRecord(value)
    ? boundedTmdbRecords(value.results, MAX_TMDB_DETAIL_VIDEOS).flatMap(
        (video) => {
          const normalized = sanitizeTmdbVideo(video);
          return normalized ? [normalized] : [];
        }
      )
    : [],
});

const sanitizeTmdbSearchResult = (
  value: Record<string, unknown>,
  includeKnownFor = true
): Record<string, unknown> | undefined => {
  if (!Number.isSafeInteger(value.id) || (value.id as number) <= 0) {
    return undefined;
  }
  const result: Record<string, unknown> = { id: value.id as number };
  for (const field of [
    'media_type',
    'poster_path',
    'backdrop_path',
    'overview',
    'original_language',
    'title',
    'original_title',
    'release_date',
    'name',
    'original_name',
    'first_air_date',
    'known_for_department',
    'profile_path',
    'logo_path',
  ]) {
    if (typeof value[field] === 'string') {
      result[field] = boundedTmdbString(
        value[field],
        field === 'overview' ? MAX_TMDB_DETAIL_TEXT_LENGTH : 2000
      );
    }
  }
  for (const field of ['popularity', 'vote_count', 'vote_average']) {
    if (typeof value[field] === 'number' && Number.isFinite(value[field])) {
      result[field] = value[field];
    }
  }
  for (const field of ['adult', 'video']) {
    if (typeof value[field] === 'boolean') {
      result[field] = value[field];
    }
  }
  if (Array.isArray(value.genre_ids)) {
    result.genre_ids = value.genre_ids
      .slice(0, 100)
      .filter((id): id is number => Number.isSafeInteger(id));
  }
  if (Array.isArray(value.origin_country)) {
    result.origin_country = boundedTmdbStrings(value.origin_country, 25);
  }
  if (includeKnownFor && Array.isArray(value.known_for)) {
    result.known_for = boundedTmdbRecords(value.known_for, 50).flatMap(
      (knownFor) => {
        const normalized = sanitizeTmdbSearchResult(knownFor, false);
        return normalized ? [normalized] : [];
      }
    );
  }
  return result;
};

const sanitizeTmdbLookupResults = (value: unknown): Record<string, unknown>[] =>
  boundedTmdbRecords(value, MAX_TMDB_LOOKUP_RESULTS).flatMap((result) => {
    const normalized = sanitizeTmdbSearchResult(result);
    return normalized ? [normalized] : [];
  });

export const sanitizeTmdbPersonDetails = (
  value: unknown
): TmdbPersonDetails => {
  if (!isRecord(value)) {
    throw new Error('Invalid TMDB person response');
  }

  return {
    id: integerTmdbNumber(value.id),
    name: boundedTmdbString(value.name, 1000),
    birthday: boundedTmdbString(value.birthday, 128),
    deathday: boundedTmdbString(value.deathday, 128),
    known_for_department: boundedTmdbString(value.known_for_department, 512),
    also_known_as: boundedTmdbStrings(value.also_known_as, 100),
    gender: integerTmdbNumber(value.gender),
    biography: boundedTmdbString(value.biography, MAX_TMDB_DETAIL_TEXT_LENGTH),
    popularity: finiteTmdbNumber(value.popularity),
    place_of_birth: boundedTmdbString(value.place_of_birth, 1000) || undefined,
    profile_path: boundedTmdbString(value.profile_path, 2000) || undefined,
    adult: value.adult === true,
    imdb_id: boundedTmdbString(value.imdb_id, 512) || undefined,
    homepage: boundedTmdbString(value.homepage, 2000) || undefined,
  } as unknown as TmdbPersonDetails;
};

export const sanitizeTmdbCombinedCredits = (
  value: unknown
): TmdbPersonCombinedCredits => {
  if (!isRecord(value)) {
    return { id: 0, cast: [], crew: [] };
  }
  const sanitizeCredit = (credit: Record<string, unknown>) => ({
    id: integerTmdbNumber(credit.id),
    original_language: boundedTmdbString(credit.original_language, 32),
    episode_count: integerTmdbNumber(credit.episode_count),
    overview: boundedTmdbString(credit.overview, MAX_TMDB_DETAIL_TEXT_LENGTH),
    origin_country: boundedTmdbStrings(credit.origin_country, 25),
    original_name: boundedTmdbString(credit.original_name, 1000),
    vote_count: integerTmdbNumber(credit.vote_count),
    name: boundedTmdbString(credit.name, 1000),
    media_type: boundedTmdbString(credit.media_type, 32),
    popularity: finiteTmdbNumber(credit.popularity),
    credit_id: boundedTmdbString(credit.credit_id, 512),
    backdrop_path: boundedTmdbString(credit.backdrop_path, 2000) || undefined,
    first_air_date: boundedTmdbString(credit.first_air_date, 128),
    vote_average: finiteTmdbNumber(credit.vote_average),
    genre_ids: Array.isArray(credit.genre_ids)
      ? credit.genre_ids
          .slice(0, 100)
          .filter((id): id is number => Number.isSafeInteger(id))
      : [],
    poster_path: boundedTmdbString(credit.poster_path, 2000) || undefined,
    original_title: boundedTmdbString(credit.original_title, 1000),
    video: credit.video === true,
    title: boundedTmdbString(credit.title, 1000),
    adult: credit.adult === true,
    release_date: boundedTmdbString(credit.release_date, 128),
    character: boundedTmdbString(credit.character, 2000),
    department: boundedTmdbString(credit.department, 1000),
    job: boundedTmdbString(credit.job, 1000),
  });

  return {
    id: Number.isSafeInteger(value.id) ? (value.id as number) : 0,
    cast: boundedTmdbRecords(value.cast, MAX_TMDB_DETAIL_CREDITS).map(
      sanitizeCredit
    ),
    crew: boundedTmdbRecords(value.crew, MAX_TMDB_DETAIL_CREDITS).map(
      sanitizeCredit
    ),
  } as unknown as TmdbPersonCombinedCredits;
};

export const sanitizeTmdbMovieDetails = (value: unknown): TmdbMovieDetails => {
  if (!isRecord(value)) {
    throw new Error('Invalid TMDB movie response');
  }
  const credits = isRecord(value.credits) ? value.credits : {};
  const keywords = isRecord(value.keywords) ? value.keywords : {};
  const releases = isRecord(value.release_dates) ? value.release_dates : {};

  return {
    id: integerTmdbNumber(value.id),
    imdb_id: boundedTmdbString(value.imdb_id, 512) || undefined,
    adult: value.adult === true,
    backdrop_path: boundedTmdbString(value.backdrop_path, 2000) || undefined,
    poster_path: boundedTmdbString(value.poster_path, 2000) || undefined,
    budget: finiteTmdbNumber(value.budget),
    genres: boundedTmdbRecords(value.genres, 100).map(sanitizeTmdbIdName),
    homepage: boundedTmdbString(value.homepage, 2000) || undefined,
    original_language: boundedTmdbString(value.original_language, 32),
    original_title: boundedTmdbString(value.original_title, 1000),
    overview:
      boundedTmdbString(value.overview, MAX_TMDB_DETAIL_TEXT_LENGTH) ||
      undefined,
    popularity: finiteTmdbNumber(value.popularity),
    production_companies: boundedTmdbRecords(
      value.production_companies,
      MAX_TMDB_DETAIL_ARRAY
    ).map((company) => ({
      ...sanitizeTmdbIdName(company),
      logo_path: boundedTmdbString(company.logo_path, 2000) || undefined,
      origin_country: boundedTmdbString(company.origin_country, 32),
      homepage: boundedTmdbString(company.homepage, 2000) || undefined,
      headquarters: boundedTmdbString(company.headquarters, 2000) || undefined,
      description:
        boundedTmdbString(company.description, MAX_TMDB_DETAIL_TEXT_LENGTH) ||
        undefined,
    })),
    production_countries: boundedTmdbRecords(
      value.production_countries,
      250
    ).map((country) => ({
      iso_3166_1: boundedTmdbString(country.iso_3166_1, 16),
      name: boundedTmdbString(country.name, 500),
    })),
    release_date: boundedTmdbString(value.release_date, 128),
    revenue: finiteTmdbNumber(value.revenue),
    runtime: Number.isFinite(value.runtime)
      ? (value.runtime as number)
      : undefined,
    spoken_languages: boundedTmdbRecords(value.spoken_languages, 250).map(
      (language) => ({
        iso_639_1: boundedTmdbString(language.iso_639_1, 16),
        name: boundedTmdbString(language.name, 500),
      })
    ),
    status: boundedTmdbString(value.status, 512),
    tagline: boundedTmdbString(value.tagline, 2000) || undefined,
    title: boundedTmdbString(value.title, 1000),
    video: value.video === true,
    vote_average: finiteTmdbNumber(value.vote_average),
    vote_count: integerTmdbNumber(value.vote_count),
    credits: {
      cast: boundedTmdbRecords(credits.cast, MAX_TMDB_DETAIL_CREDITS).map(
        sanitizeTmdbCast
      ),
      crew: boundedTmdbRecords(credits.crew, MAX_TMDB_DETAIL_CREDITS).map(
        sanitizeTmdbCrew
      ),
    },
    belongs_to_collection: isRecord(value.belongs_to_collection)
      ? {
          ...sanitizeTmdbIdName(value.belongs_to_collection),
          poster_path:
            boundedTmdbString(value.belongs_to_collection.poster_path, 2000) ||
            undefined,
          backdrop_path:
            boundedTmdbString(
              value.belongs_to_collection.backdrop_path,
              2000
            ) || undefined,
        }
      : undefined,
    external_ids: sanitizeTmdbExternalIds(value.external_ids),
    videos: sanitizeTmdbVideos(value.videos),
    keywords: {
      keywords: boundedTmdbRecords(
        keywords.keywords,
        MAX_TMDB_DETAIL_ARRAY
      ).map(sanitizeTmdbIdName),
    },
    release_dates: {
      results: boundedTmdbRecords(releases.results, 250).map((release) => ({
        iso_3166_1: boundedTmdbString(release.iso_3166_1, 16),
        rating: boundedTmdbString(release.rating, 64),
        release_dates: boundedTmdbRecords(release.release_dates, 100).map(
          (date) => ({
            certification: boundedTmdbString(date.certification, 64),
            iso_639_1: boundedTmdbString(date.iso_639_1, 16) || undefined,
            note: boundedTmdbString(date.note, 2000) || undefined,
            release_date: boundedTmdbString(date.release_date, 128),
            type: integerTmdbNumber(date.type),
          })
        ),
      })),
    },
    'watch/providers': sanitizeTmdbWatchProviders(value['watch/providers']),
  } as unknown as TmdbMovieDetails;
};

export const sanitizeTmdbTvDetails = (value: unknown): TmdbTvDetails => {
  if (!isRecord(value)) {
    throw new Error('Invalid TMDB TV response');
  }
  const aggregateCredits = isRecord(value.aggregate_credits)
    ? value.aggregate_credits
    : {};
  const credits = isRecord(value.credits) ? value.credits : {};
  const keywords = isRecord(value.keywords) ? value.keywords : {};
  const contentRatings = isRecord(value.content_ratings)
    ? value.content_ratings
    : {};
  const aggregateCast = boundedTmdbRecords(
    aggregateCredits.cast,
    MAX_TMDB_DETAIL_CREDITS
  ).flatMap((cast) => {
    const roles = boundedTmdbRecords(cast.roles, 50).map((role) => ({
      credit_id: boundedTmdbString(role.credit_id, 512),
      character: boundedTmdbString(role.character, 2000),
      episode_count: integerTmdbNumber(role.episode_count),
    }));
    return roles.length ? [{ ...sanitizeTmdbCast(cast), roles }] : [];
  });

  return {
    id: integerTmdbNumber(value.id),
    backdrop_path: boundedTmdbString(value.backdrop_path, 2000) || undefined,
    content_ratings: {
      results: boundedTmdbRecords(contentRatings.results, 250).map(
        (rating) => ({
          iso_3166_1: boundedTmdbString(rating.iso_3166_1, 16),
          rating: boundedTmdbString(rating.rating, 64),
        })
      ),
    },
    created_by: boundedTmdbRecords(value.created_by, 100).map((creator) => ({
      ...sanitizeTmdbIdName(creator),
      credit_id: boundedTmdbString(creator.credit_id, 512),
      gender: integerTmdbNumber(creator.gender),
      profile_path: boundedTmdbString(creator.profile_path, 2000) || undefined,
    })),
    episode_run_time: Array.isArray(value.episode_run_time)
      ? value.episode_run_time
          .slice(0, 100)
          .filter((runtime): runtime is number => Number.isFinite(runtime))
      : [],
    first_air_date: boundedTmdbString(value.first_air_date, 128),
    genres: boundedTmdbRecords(value.genres, 100).map(sanitizeTmdbIdName),
    homepage: boundedTmdbString(value.homepage, 2000),
    in_production: value.in_production === true,
    languages: boundedTmdbStrings(value.languages, 100),
    last_air_date: boundedTmdbString(value.last_air_date, 128),
    last_episode_to_air: sanitizeTmdbEpisode(value.last_episode_to_air),
    name: boundedTmdbString(value.name, 1000),
    next_episode_to_air: sanitizeTmdbEpisode(value.next_episode_to_air),
    networks: boundedTmdbRecords(value.networks, MAX_TMDB_DETAIL_ARRAY).map(
      (network) => ({
        ...sanitizeTmdbIdName(network),
        headquarters:
          boundedTmdbString(network.headquarters, 2000) || undefined,
        homepage: boundedTmdbString(network.homepage, 2000) || undefined,
        logo_path: boundedTmdbString(network.logo_path, 2000) || undefined,
        origin_country:
          boundedTmdbString(network.origin_country, 32) || undefined,
      })
    ),
    number_of_episodes: integerTmdbNumber(value.number_of_episodes),
    number_of_seasons: integerTmdbNumber(value.number_of_seasons),
    origin_country: boundedTmdbStrings(value.origin_country, 100),
    original_language: boundedTmdbString(value.original_language, 32),
    original_name: boundedTmdbString(value.original_name, 1000),
    overview: boundedTmdbString(value.overview, MAX_TMDB_DETAIL_TEXT_LENGTH),
    popularity: finiteTmdbNumber(value.popularity),
    poster_path: boundedTmdbString(value.poster_path, 2000) || undefined,
    production_companies: boundedTmdbRecords(
      value.production_companies,
      MAX_TMDB_DETAIL_ARRAY
    ).map((company) => ({
      ...sanitizeTmdbIdName(company),
      logo_path: boundedTmdbString(company.logo_path, 2000) || undefined,
      origin_country: boundedTmdbString(company.origin_country, 32),
    })),
    production_countries: boundedTmdbRecords(
      value.production_countries,
      250
    ).map((country) => ({
      iso_3166_1: boundedTmdbString(country.iso_3166_1, 16),
      name: boundedTmdbString(country.name, 500),
    })),
    spoken_languages: boundedTmdbRecords(value.spoken_languages, 250).map(
      (language) => ({
        english_name: boundedTmdbString(language.english_name, 500),
        iso_639_1: boundedTmdbString(language.iso_639_1, 16),
        name: boundedTmdbString(language.name, 500),
      })
    ),
    seasons: boundedTmdbRecords(value.seasons, MAX_TMDB_DETAIL_ARRAY).map(
      (season) => ({
        id: integerTmdbNumber(season.id),
        air_date: boundedTmdbString(season.air_date, 128),
        episode_count: integerTmdbNumber(season.episode_count),
        name: boundedTmdbString(season.name, 1000),
        overview: boundedTmdbString(
          season.overview,
          MAX_TMDB_DETAIL_TEXT_LENGTH
        ),
        poster_path: boundedTmdbString(season.poster_path, 2000) || undefined,
        season_number: integerTmdbNumber(season.season_number),
      })
    ),
    status: boundedTmdbString(value.status, 512),
    tagline: boundedTmdbString(value.tagline, 2000) || undefined,
    type: boundedTmdbString(value.type, 512),
    vote_average: finiteTmdbNumber(value.vote_average),
    vote_count: integerTmdbNumber(value.vote_count),
    aggregate_credits: { cast: aggregateCast },
    credits: {
      crew: boundedTmdbRecords(credits.crew, MAX_TMDB_DETAIL_CREDITS).map(
        sanitizeTmdbCrew
      ),
    },
    external_ids: sanitizeTmdbExternalIds(value.external_ids),
    keywords: {
      results: boundedTmdbRecords(keywords.results, MAX_TMDB_DETAIL_ARRAY).map(
        sanitizeTmdbIdName
      ),
    },
    videos: sanitizeTmdbVideos(value.videos),
    'watch/providers': sanitizeTmdbWatchProviders(value['watch/providers']),
  } as unknown as TmdbTvDetails;
};

export const sanitizeTmdbPagedResponse = <T>(
  value: unknown,
  fallbackPage = 1
): T => {
  if (!isRecord(value)) {
    return {
      page: fallbackPage,
      results: [],
      total_pages: 1,
      total_results: 0,
    } as T;
  }
  const dates = isRecord(value.dates)
    ? {
        maximum:
          typeof value.dates.maximum === 'string'
            ? value.dates.maximum.slice(0, 128)
            : '',
        minimum:
          typeof value.dates.minimum === 'string'
            ? value.dates.minimum.slice(0, 128)
            : '',
      }
    : undefined;

  return {
    page:
      typeof value.page === 'number' &&
      Number.isSafeInteger(value.page) &&
      value.page > 0
        ? value.page
        : fallbackPage,
    results: Array.isArray(value.results)
      ? value.results
          .slice(0, MAX_TMDB_PAGE_RESULTS)
          .filter(isRecord)
          .flatMap((result) => {
            const normalized = sanitizeTmdbSearchResult(result);
            return normalized ? [normalized] : [];
          })
      : [],
    total_pages:
      typeof value.total_pages === 'number' &&
      Number.isSafeInteger(value.total_pages) &&
      value.total_pages > 0
        ? value.total_pages
        : 1,
    total_results:
      typeof value.total_results === 'number' &&
      Number.isSafeInteger(value.total_results) &&
      value.total_results >= 0
        ? value.total_results
        : 0,
    ...(dates ? { dates } : {}),
  } as T;
};

export const sanitizeTmdbGenres = (value: unknown): TmdbGenre[] => {
  const genres = isRecord(value) ? value.genres : undefined;
  return boundedTmdbRecords(genres, MAX_TMDB_LOOKUP_RESULTS).flatMap(
    (genre) => {
      const name = boundedTmdbString(genre.name, 500);
      return Number.isSafeInteger(genre.id)
        ? [{ id: genre.id as number, name }]
        : [];
    }
  );
};

export const sanitizeTmdbCertifications = (
  value: unknown
): TmdbCertificationResponse => {
  const rawCertifications =
    isRecord(value) && isRecord(value.certifications)
      ? value.certifications
      : {};
  const certifications: TmdbCertificationResponse['certifications'] = {};

  for (const [country, rawEntries] of Object.entries(rawCertifications).slice(
    0,
    250
  )) {
    certifications[country.slice(0, 16)] = boundedTmdbRecords(
      rawEntries,
      100
    ).flatMap((entry) => {
      const certification = boundedTmdbString(entry.certification, 64);
      if (!certification) {
        return [];
      }
      return [
        {
          certification,
          meaning: boundedTmdbString(entry.meaning, 2000) || undefined,
          order: Number.isFinite(entry.order)
            ? Math.trunc(entry.order as number)
            : undefined,
        },
      ];
    });
  }

  return { certifications };
};

interface SearchOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

interface SingleSearchOptions extends SearchOptions {
  year?: number;
}

export const SortOptionsIterable = [
  'popularity.desc',
  'popularity.asc',
  'release_date.desc',
  'release_date.asc',
  'revenue.desc',
  'revenue.asc',
  'primary_release_date.desc',
  'primary_release_date.asc',
  'original_title.asc',
  'original_title.desc',
  'vote_average.desc',
  'vote_average.asc',
  'vote_count.desc',
  'vote_count.asc',
  'first_air_date.desc',
  'first_air_date.asc',
] as const;

export type SortOptions = (typeof SortOptionsIterable)[number];

export interface TmdbCertificationResponse {
  certifications: {
    [country: string]: {
      certification: string;
      meaning?: string;
      order?: number;
    }[];
  };
}

interface DiscoverMovieOptions {
  page?: number;
  includeAdult?: boolean;
  includeVideo?: boolean;
  language?: string;
  primaryReleaseDateGte?: string;
  primaryReleaseDateLte?: string;
  withRuntimeGte?: string;
  withRuntimeLte?: string;
  voteAverageGte?: string;
  voteAverageLte?: string;
  voteCountGte?: string;
  voteCountLte?: string;
  originalLanguage?: string;
  genre?: string;
  studio?: string;
  keywords?: string;
  excludeKeywords?: string;
  sortBy?: SortOptions;
  watchRegion?: string;
  watchProviders?: string;
  certification?: string;
  certificationGte?: string;
  certificationLte?: string;
  certificationCountry?: string;
}

interface DiscoverTvOptions {
  page?: number;
  language?: string;
  firstAirDateGte?: string;
  firstAirDateLte?: string;
  withRuntimeGte?: string;
  withRuntimeLte?: string;
  voteAverageGte?: string;
  voteAverageLte?: string;
  voteCountGte?: string;
  voteCountLte?: string;
  includeEmptyReleaseDate?: boolean;
  originalLanguage?: string;
  genre?: string;
  network?: number;
  keywords?: string;
  excludeKeywords?: string;
  sortBy?: SortOptions;
  watchRegion?: string;
  watchProviders?: string;
  withStatus?: string; // Returning Series: 0 Planned: 1 In Production: 2 Ended: 3 Cancelled: 4 Pilot: 5
  certification?: string;
  certificationGte?: string;
  certificationLte?: string;
  certificationCountry?: string;
}

class TheMovieDb extends ExternalAPI implements TvShowProvider {
  private locale: string;
  private discoverRegion?: string;
  private originalLanguage?: string;
  private includeAdult: boolean;
  constructor({
    discoverRegion,
    originalLanguage,
  }: { discoverRegion?: string; originalLanguage?: string } = {}) {
    super('https://api.themoviedb.org/3', getTmdbAuthParams(), {
      headers: getTmdbAuthHeaders(),
      nodeCache: cacheManager.getCache('tmdb').data,
      rateLimit: {
        maxRequests: 20,
        maxRPS: 50,
      },
    });
    this.locale = getSettings().main?.locale || 'en';
    this.discoverRegion = discoverRegion;
    this.originalLanguage = originalLanguage;
    this.includeAdult = getSettings().main?.includeAdult === true;
  }

  public searchMulti = async ({
    query,
    page = 1,
    includeAdult = this.includeAdult,
    language = this.locale,
  }: SearchOptions): Promise<TmdbSearchMultiResponse> => {
    try {
      const data = await this.get<TmdbSearchMultiResponse>('/search/multi', {
        params: { query, page, include_adult: includeAdult, language },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchMultiResponse>(data, page);
    } catch {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public searchMovies = async ({
    query,
    page = 1,
    includeAdult = this.includeAdult,
    language = this.locale,
    year,
  }: SingleSearchOptions): Promise<TmdbSearchMovieResponse> => {
    try {
      const data = await this.get<TmdbSearchMovieResponse>('/search/movie', {
        params: {
          query,
          page,
          include_adult: includeAdult,
          language,
          primary_release_year: year,
        },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public searchTvShows = async ({
    query,
    page = 1,
    includeAdult = this.includeAdult,
    language = this.locale,
    year,
  }: SingleSearchOptions): Promise<TmdbSearchTvResponse> => {
    try {
      const data = await this.get<TmdbSearchTvResponse>('/search/tv', {
        params: {
          query,
          page,
          include_adult: includeAdult,
          language,
          first_air_date_year: year,
        },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchTvResponse>(data, page);
    } catch {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public getPerson = async ({
    personId,
    language = this.locale,
  }: {
    personId: number;
    language?: string;
  }): Promise<TmdbPersonDetails> => {
    try {
      const data = await this.get<TmdbPersonDetails>(`/person/${personId}`, {
        params: { language },
      });

      return sanitizeTmdbPersonDetails(data);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch person details: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getPersonCombinedCredits = async ({
    personId,
    language = this.locale,
  }: {
    personId: number;
    language?: string;
  }): Promise<TmdbPersonCombinedCredits> => {
    try {
      const data = await this.get<TmdbPersonCombinedCredits>(
        `/person/${personId}/combined_credits`,
        {
          params: { language },
        }
      );

      return sanitizeTmdbCombinedCredits(data);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch person combined credits: ${e.message}`,
        { cause: e }
      );
    }
  };

  public getMovie = async ({
    movieId,
    language = this.locale,
  }: {
    movieId: number;
    language?: string;
  }): Promise<TmdbMovieDetails> => {
    try {
      const data = sanitizeTmdbMovieDetails(
        await this.get<TmdbMovieDetails>(
          `/movie/${movieId}`,
          {
            params: {
              language,
              append_to_response:
                'credits,external_ids,videos,keywords,release_dates,watch/providers',
              include_video_language: language,
            },
          },
          43200
        )
      );

      if (
        (!language || !language.startsWith('en')) &&
        !data.videos?.results?.some((video) => video.type === 'Trailer')
      ) {
        try {
          const fallback = sanitizeTmdbMovieDetails(
            await this.get<TmdbMovieDetails>(
              `/movie/${movieId}`,
              {
                params: {
                  language,
                  append_to_response: 'videos',
                  include_video_language: 'en',
                },
              },
              43200
            )
          );

          const localizedVideos = data.videos?.results ?? [];
          const localizedVideoKeys = new Set(
            localizedVideos.map((video) => video.key)
          );
          const englishFallbackTrailers =
            fallback.videos?.results?.filter(
              (video) =>
                video.type === 'Trailer' && !localizedVideoKeys.has(video.key)
            ) ?? [];

          if (englishFallbackTrailers.length > 0) {
            data.videos = {
              ...(data.videos ?? { results: [] }),
              results: [...localizedVideos, ...englishFallbackTrailers],
            };
          }
        } catch {
          // Ignore trailer fallback failures; return the original data.
        }
      }

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie details: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getTvShow = async ({
    tvId,
    language = this.locale,
  }: {
    tvId: number;
    language?: string;
  }): Promise<TmdbTvDetails> => {
    try {
      const data = sanitizeTmdbTvDetails(
        await this.get<TmdbTvDetails>(
          `/tv/${tvId}`,
          {
            params: {
              language,
              append_to_response:
                'aggregate_credits,credits,external_ids,keywords,videos,content_ratings,watch/providers',
              include_video_language: language,
            },
          },
          43200
        )
      );

      if (
        (!language || !language.startsWith('en')) &&
        !data.videos?.results?.some((video) => video.type === 'Trailer')
      ) {
        try {
          const fallback = sanitizeTmdbTvDetails(
            await this.get<TmdbTvDetails>(
              `/tv/${tvId}`,
              {
                params: {
                  language,
                  append_to_response: 'videos',
                  include_video_language: 'en',
                },
              },
              43200
            )
          );

          const localizedVideos = data.videos?.results ?? [];
          const localizedVideoKeys = new Set(
            localizedVideos.map((video) => video.key)
          );
          const englishFallbackTrailers =
            fallback.videos?.results?.filter(
              (video) =>
                video.type === 'Trailer' && !localizedVideoKeys.has(video.key)
            ) ?? [];

          if (englishFallbackTrailers.length > 0) {
            data.videos = {
              ...(data.videos ?? { results: [] }),
              results: [...localizedVideos, ...englishFallbackTrailers],
            };
          }
        } catch {
          // Ignore trailer fallback failures; return the original data.
        }
      }

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV show details: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getTvSeason = async ({
    tvId,
    seasonNumber,
    language,
  }: {
    tvId: number;
    seasonNumber: number;
    language?: string;
  }): Promise<TmdbSeasonWithEpisodes> => {
    try {
      const data = await this.get<TmdbSeasonWithEpisodes>(
        `/tv/${tvId}/season/${seasonNumber}`,
        {
          params: {
            language,
            append_to_response: 'external_ids',
          },
        }
      );

      if (!isRecord(data)) {
        throw new Error('TMDB returned an invalid season response.');
      }
      const episodes = Array.isArray(data.episodes)
        ? data.episodes
            .slice(0, MAX_TMDB_SEASON_EPISODES)
            .flatMap((episode) => {
              const normalized = sanitizeTmdbEpisode(episode);
              if (!normalized) return [];
              const stillPath = normalized.still_path.replace(/^\/+/, '');
              return [
                {
                  ...normalized,
                  still_path: stillPath
                    ? `https://image.tmdb.org/t/p/original/${stillPath}`
                    : '',
                },
              ];
            })
        : [];

      return {
        id: integerTmdbNumber(data.id),
        air_date: boundedTmdbString(data.air_date, 128),
        name: boundedTmdbString(data.name, 1000),
        overview: boundedTmdbString(data.overview, MAX_TMDB_DETAIL_TEXT_LENGTH),
        poster_path: boundedTmdbString(data.poster_path, 2000) || undefined,
        season_number: integerTmdbNumber(data.season_number, seasonNumber),
        external_ids: sanitizeTmdbExternalIds(data.external_ids),
        episodes,
      } as unknown as TmdbSeasonWithEpisodes;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV show details: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getMovieRecommendations({
    movieId,
    page = 1,
    language = this.locale,
  }: {
    movieId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/movie/${movieId}/recommendations`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getMovieSimilar({
    movieId,
    page = 1,
    language = this.locale,
  }: {
    movieId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/movie/${movieId}/similar`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getMoviesByKeyword({
    keywordId,
    page = 1,
    language = this.locale,
  }: {
    keywordId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/keyword/${keywordId}/movies`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch movies by keyword: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getTvRecommendations({
    tvId,
    page = 1,
    language = this.locale,
  }: {
    tvId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchTvResponse> {
    try {
      const data = await this.get<TmdbSearchTvResponse>(
        `/tv/${tvId}/recommendations`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchTvResponse>(data, page);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch TV recommendations: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getTvSimilar({
    tvId,
    page = 1,
    language = this.locale,
  }: {
    tvId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchTvResponse> {
    try {
      const data = await this.get<TmdbSearchTvResponse>(`/tv/${tvId}/similar`, {
        params: {
          page,
          language,
        },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchTvResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV similar: ${e.message}`, {
        cause: e,
      });
    }
  }

  public getDiscoverMovies = async ({
    sortBy = 'popularity.desc',
    page = 1,
    includeAdult = this.includeAdult,
    includeVideo = true,
    language = this.locale,
    primaryReleaseDateGte,
    primaryReleaseDateLte,
    originalLanguage,
    genre,
    studio,
    keywords,
    excludeKeywords,
    withRuntimeGte,
    withRuntimeLte,
    voteAverageGte,
    voteAverageLte,
    voteCountGte,
    voteCountLte,
    watchProviders,
    watchRegion,
    certification,
    certificationGte,
    certificationLte,
    certificationCountry,
  }: DiscoverMovieOptions = {}): Promise<TmdbSearchMovieResponse> => {
    try {
      const defaultFutureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * (365 * 1.5)
      )
        .toISOString()
        .split('T')[0];

      const defaultPastDate = new Date('1900-01-01')
        .toISOString()
        .split('T')[0];

      const data = await this.get<TmdbSearchMovieResponse>('/discover/movie', {
        params: {
          sort_by: sortBy,
          page,
          include_adult: includeAdult,
          include_video: includeVideo,
          language,
          region: this.discoverRegion || '',
          with_original_language:
            originalLanguage && originalLanguage !== 'all'
              ? originalLanguage
              : originalLanguage === 'all'
                ? undefined
                : this.originalLanguage,
          // Set our release date values, but check if one is set and not the other,
          // so we can force a past date or a future date. TMDB Requires both values if one is set!
          'primary_release_date.gte':
            !primaryReleaseDateGte && primaryReleaseDateLte
              ? defaultPastDate
              : primaryReleaseDateGte,
          'primary_release_date.lte':
            !primaryReleaseDateLte && primaryReleaseDateGte
              ? defaultFutureDate
              : primaryReleaseDateLte,
          with_genres: genre,
          with_companies: studio,
          with_keywords: keywords,
          without_keywords: excludeKeywords,
          'with_runtime.gte': withRuntimeGte,
          'with_runtime.lte': withRuntimeLte,
          'vote_average.gte': voteAverageGte,
          'vote_average.lte': voteAverageLte,
          'vote_count.gte': voteCountGte,
          'vote_count.lte': voteCountLte,
          watch_region: watchRegion,
          with_watch_providers: watchProviders,
          certification: certification,
          'certification.gte': certificationGte,
          'certification.lte': certificationLte,
          certification_country: certificationCountry,
        },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getDiscoverTv = async ({
    sortBy = 'popularity.desc',
    page = 1,
    language = this.locale,
    firstAirDateGte,
    firstAirDateLte,
    includeEmptyReleaseDate = false,
    originalLanguage,
    genre,
    network,
    keywords,
    excludeKeywords,
    withRuntimeGte,
    withRuntimeLte,
    voteAverageGte,
    voteAverageLte,
    voteCountGte,
    voteCountLte,
    watchProviders,
    watchRegion,
    withStatus,
    certification,
    certificationGte,
    certificationLte,
    certificationCountry,
  }: DiscoverTvOptions = {}): Promise<TmdbSearchTvResponse> => {
    try {
      const defaultFutureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * (365 * 1.5)
      )
        .toISOString()
        .split('T')[0];

      const defaultPastDate = new Date('1900-01-01')
        .toISOString()
        .split('T')[0];

      const data = await this.get<TmdbSearchTvResponse>('/discover/tv', {
        params: {
          sort_by: sortBy,
          page,
          language,
          region: this.discoverRegion || '',
          // Set our release date values, but check if one is set and not the other,
          // so we can force a past date or a future date. TMDB Requires both values if one is set!
          'first_air_date.gte':
            !firstAirDateGte && firstAirDateLte
              ? defaultPastDate
              : firstAirDateGte,
          'first_air_date.lte':
            !firstAirDateLte && firstAirDateGte
              ? defaultFutureDate
              : firstAirDateLte,
          with_original_language:
            originalLanguage && originalLanguage !== 'all'
              ? originalLanguage
              : originalLanguage === 'all'
                ? undefined
                : this.originalLanguage,
          include_null_first_air_dates: includeEmptyReleaseDate,
          with_genres: genre,
          with_networks: network,
          with_keywords: keywords,
          without_keywords: excludeKeywords,
          'with_runtime.gte': withRuntimeGte,
          'with_runtime.lte': withRuntimeLte,
          'vote_average.gte': voteAverageGte,
          'vote_average.lte': voteAverageLte,
          'vote_count.gte': voteCountGte,
          'vote_count.lte': voteCountLte,
          with_watch_providers: watchProviders,
          watch_region: watchRegion,
          with_status: withStatus,
          certification: certification,
          'certification.gte': certificationGte,
          'certification.lte': certificationLte,
          certification_country: certificationCountry,
        },
      });

      return sanitizeTmdbPagedResponse<TmdbSearchTvResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover TV: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getUpcomingMovies = async ({
    page = 1,
    language = this.locale,
  }: {
    page: number;
    language: string;
  }): Promise<TmdbUpcomingMoviesResponse> => {
    try {
      const data = await this.get<TmdbUpcomingMoviesResponse>(
        '/movie/upcoming',
        {
          params: {
            page,
            language,
            region: this.discoverRegion,
            originalLanguage: this.originalLanguage,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbUpcomingMoviesResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch upcoming movies: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getAllTrending = async ({
    page = 1,
    timeWindow = 'day',
    language = this.locale,
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
    language?: string;
  } = {}): Promise<TmdbSearchMultiResponse> => {
    try {
      const data = await this.get<TmdbSearchMultiResponse>(
        `/trending/all/${timeWindow}`,
        {
          params: {
            page,
            language,
            region: this.discoverRegion,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchMultiResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getMovieTrending = async ({
    page = 1,
    timeWindow = 'day',
    language = this.locale,
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
    language?: string;
  } = {}): Promise<TmdbSearchMovieResponse> => {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/trending/movie/${timeWindow}`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchMovieResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`, {
        cause: e,
      });
    }
  };

  public getTvTrending = async ({
    page = 1,
    timeWindow = 'day',
    language = this.locale,
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
    language?: string;
  } = {}): Promise<TmdbSearchTvResponse> => {
    try {
      const data = await this.get<TmdbSearchTvResponse>(
        `/trending/tv/${timeWindow}`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return sanitizeTmdbPagedResponse<TmdbSearchTvResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`, {
        cause: e,
      });
    }
  };

  public async getByExternalId({
    externalId,
    type,
    language = this.locale,
  }:
    | {
        externalId: string;
        type: 'imdb';
        language?: string;
      }
    | {
        externalId: number;
        type: 'tvdb';
        language?: string;
      }): Promise<TmdbExternalIdResponse> {
    try {
      if (
        (type === 'imdb' &&
          (typeof externalId !== 'string' ||
            !/^tt[0-9]{1,20}$/.test(externalId))) ||
        (type === 'tvdb' &&
          (!Number.isSafeInteger(externalId) ||
            externalId <= 0 ||
            externalId > 1_000_000_000))
      ) {
        throw new Error('Invalid external media ID');
      }
      const data = await this.get<TmdbExternalIdResponse>(
        `/find/${externalId}`,
        {
          params: {
            external_source: type === 'imdb' ? 'imdb_id' : 'tvdb_id',
            language,
          },
        }
      );

      return {
        movie_results: sanitizeTmdbLookupResults(data?.movie_results),
        tv_results: sanitizeTmdbLookupResults(data?.tv_results),
        person_results: sanitizeTmdbLookupResults(data?.person_results),
      } as unknown as TmdbExternalIdResponse;
    } catch (e) {
      throw new Error(`[TMDB] Failed to find by external ID: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getMediaByImdbId({
    imdbId,
    language = this.locale,
  }: {
    imdbId: string;
    language?: string;
  }): Promise<TmdbMovieDetails | TmdbTvDetails> {
    try {
      const extResponse = await this.getByExternalId({
        externalId: imdbId,
        type: 'imdb',
      });

      if (extResponse.movie_results[0]) {
        const movie = await this.getMovie({
          movieId: extResponse.movie_results[0].id,
          language,
        });

        return movie;
      }

      if (extResponse.tv_results[0]) {
        const tvshow = await this.getTvShow({
          tvId: extResponse.tv_results[0].id,
          language,
        });

        return tvshow;
      }

      throw new Error(`No movie or show returned from API for ID ${imdbId}`);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to find media using external IMDb ID: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getShowByTvdbId({
    tvdbId,
    language = this.locale,
  }: {
    tvdbId: number;
    language?: string;
  }): Promise<TmdbTvDetails> {
    try {
      const extResponse = await this.getByExternalId({
        externalId: tvdbId,
        type: 'tvdb',
      });

      if (extResponse.tv_results[0]) {
        const tvshow = await this.getTvShow({
          tvId: extResponse.tv_results[0].id,
          language,
        });

        return tvshow;
      }

      throw new Error(`No show returned from API for ID ${tvdbId}`);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to get TV show using the external TVDB ID: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getCollection({
    collectionId,
    language = this.locale,
  }: {
    collectionId: number;
    language?: string;
  }): Promise<TmdbCollection> {
    try {
      const data = await this.get<TmdbCollection>(
        `/collection/${collectionId}`,
        {
          params: {
            language,
          },
        }
      );

      if (!isRecord(data)) {
        throw new Error('TMDB returned an invalid collection response.');
      }
      return {
        id:
          typeof data.id === 'number' && Number.isSafeInteger(data.id)
            ? data.id
            : collectionId,
        name: typeof data.name === 'string' ? data.name.slice(0, 1_000) : '',
        overview:
          typeof data.overview === 'string'
            ? data.overview.slice(0, 20_000)
            : undefined,
        poster_path:
          typeof data.poster_path === 'string'
            ? data.poster_path.slice(0, 2_048)
            : undefined,
        backdrop_path:
          typeof data.backdrop_path === 'string'
            ? data.backdrop_path.slice(0, 2_048)
            : undefined,
        parts: sanitizeTmdbLookupResults(data.parts),
      } as unknown as TmdbCollection;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch collection: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getRegions(): Promise<TmdbRegion[]> {
    try {
      const data = await this.get<TmdbRegion[]>(
        '/configuration/countries',
        {},
        86400 // 24 hours
      );

      const regions = sortBy(
        (Array.isArray(data) ? data : [])
          .slice(0, MAX_TMDB_LOOKUP_RESULTS)
          .flatMap((region) =>
            isRecord(region) &&
            typeof region.iso_3166_1 === 'string' &&
            typeof region.english_name === 'string'
              ? [
                  {
                    iso_3166_1: region.iso_3166_1.slice(0, 16),
                    english_name: region.english_name.slice(0, 500),
                  },
                ]
              : []
          ),
        'english_name'
      ) as TmdbRegion[];

      return regions;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch countries: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getLanguages(): Promise<TmdbLanguage[]> {
    try {
      const data = await this.get<TmdbLanguage[]>(
        '/configuration/languages',
        {},
        86400 // 24 hours
      );

      const languages = sortBy(
        (Array.isArray(data) ? data : [])
          .slice(0, MAX_TMDB_LOOKUP_RESULTS)
          .flatMap((language) =>
            isRecord(language) &&
            typeof language.iso_639_1 === 'string' &&
            typeof language.english_name === 'string' &&
            typeof language.name === 'string'
              ? [
                  {
                    iso_639_1: language.iso_639_1.slice(0, 16),
                    english_name: language.english_name.slice(0, 500),
                    name: language.name.slice(0, 500),
                  },
                ]
              : []
          ),
        'english_name'
      ) as TmdbLanguage[];

      return languages;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch langauges: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getStudio(studioId: number): Promise<TmdbProductionCompany> {
    try {
      const data = await this.get<TmdbProductionCompany>(
        `/company/${studioId}`
      );

      if (!isRecord(data)) {
        throw new Error('Invalid TMDB studio response');
      }
      return {
        id: Number.isSafeInteger(data.id) ? (data.id as number) : studioId,
        name: boundedTmdbString(data.name, 1000),
        logo_path: boundedTmdbString(data.logo_path, 2000) || undefined,
        origin_country: boundedTmdbString(data.origin_country, 32),
        homepage: boundedTmdbString(data.homepage, 2000) || undefined,
        headquarters: boundedTmdbString(data.headquarters, 2000) || undefined,
        description:
          boundedTmdbString(data.description, MAX_TMDB_DETAIL_TEXT_LENGTH) ||
          undefined,
      };
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie studio: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getNetwork(networkId: number): Promise<TmdbNetwork> {
    try {
      const data = await this.get<TmdbNetwork>(`/network/${networkId}`);

      if (!isRecord(data)) {
        throw new Error('Invalid TMDB network response');
      }
      return {
        id: Number.isSafeInteger(data.id) ? (data.id as number) : networkId,
        name: boundedTmdbString(data.name, 1000),
        logo_path: boundedTmdbString(data.logo_path, 2000) || undefined,
        origin_country: boundedTmdbString(data.origin_country, 32),
        homepage: boundedTmdbString(data.homepage, 2000) || undefined,
        headquarters: boundedTmdbString(data.headquarters, 2000) || undefined,
      };
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV network: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getMovieGenres({
    language = this.locale,
  }: {
    language?: string;
  } = {}): Promise<TmdbGenre[]> {
    try {
      const data = await this.get<TmdbGenresResult>(
        '/genre/movie/list',
        {
          params: {
            language,
          },
        },
        86400 // 24 hours
      );

      const genres = sanitizeTmdbGenres(data);
      if (!language.startsWith('en') && genres.some((genre) => !genre.name)) {
        const englishData = await this.get<TmdbGenresResult>(
          '/genre/movie/list',
          {
            params: {
              language: 'en',
            },
          },
          86400 // 24 hours
        );

        const englishGenres = sanitizeTmdbGenres(englishData);
        genres
          .filter((genre) => !genre.name)
          .forEach((genre) => {
            genre.name =
              englishGenres.find((englishGenre) => englishGenre.id === genre.id)
                ?.name ?? '';
          });
      }

      const movieGenres = sortBy(
        genres.filter((genre) => genre.name),
        'name'
      );

      return movieGenres;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie genres: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getTvGenres({
    language = this.locale,
  }: {
    language?: string;
  } = {}): Promise<TmdbGenre[]> {
    try {
      const data = await this.get<TmdbGenresResult>(
        '/genre/tv/list',
        {
          params: {
            language,
          },
        },
        86400 // 24 hours
      );

      const genres = sanitizeTmdbGenres(data);
      if (!language.startsWith('en') && genres.some((genre) => !genre.name)) {
        const englishData = await this.get<TmdbGenresResult>(
          '/genre/tv/list',
          {
            params: {
              language: 'en',
            },
          },
          86400 // 24 hours
        );

        const englishGenres = sanitizeTmdbGenres(englishData);
        genres
          .filter((genre) => !genre.name)
          .forEach((genre) => {
            genre.name =
              englishGenres.find((englishGenre) => englishGenre.id === genre.id)
                ?.name ?? '';
          });
      }

      const tvGenres = sortBy(
        genres.filter((genre) => genre.name),
        'name'
      );

      return tvGenres;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV genres: ${e.message}`, {
        cause: e,
      });
    }
  }

  public getMovieCertifications =
    async (): Promise<TmdbCertificationResponse> => {
      try {
        const data = await this.get<TmdbCertificationResponse>(
          '/certification/movie/list',
          {},
          604800 // 7 days
        );

        return sanitizeTmdbCertifications(data);
      } catch (e) {
        throw new Error(`[TMDB] Failed to fetch movie certifications: ${e}`, {
          cause: e,
        });
      }
    };

  public getTvCertifications = async (): Promise<TmdbCertificationResponse> => {
    try {
      const data = await this.get<TmdbCertificationResponse>(
        '/certification/tv/list',
        {},
        604800 // 7 days
      );

      return sanitizeTmdbCertifications(data);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch TV certifications: ${e.message}`,
        { cause: e }
      );
    }
  };

  public async getKeywordDetails({
    keywordId,
  }: {
    keywordId: number;
  }): Promise<TmdbKeyword | null> {
    try {
      const data = await this.get<TmdbKeyword>(
        `/keyword/${keywordId}`,
        undefined,
        604800 // 7 days
      );

      if (
        !isRecord(data) ||
        !Number.isSafeInteger(data.id) ||
        typeof data.name !== 'string'
      ) {
        return null;
      }
      return {
        id: data.id as number,
        name: data.name.slice(0, 1000),
      };
    } catch (e) {
      if (e.response?.status === 404) {
        return null;
      }
      throw new Error(`[TMDB] Failed to fetch keyword: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async searchKeyword({
    query,
    page = 1,
  }: {
    query: string;
    page?: number;
  }): Promise<TmdbKeywordSearchResponse> {
    try {
      const data = await this.get<TmdbKeywordSearchResponse>(
        '/search/keyword',
        {
          params: {
            query,
            page,
          },
        },
        86400 // 24 hours
      );

      return sanitizeTmdbPagedResponse<TmdbKeywordSearchResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to search keyword: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async searchCompany({
    query,
    page = 1,
  }: {
    query: string;
    page?: number;
  }): Promise<TmdbCompanySearchResponse> {
    try {
      const data = await this.get<TmdbCompanySearchResponse>(
        '/search/company',
        {
          params: {
            query,
            page,
          },
        },
        86400 // 24 hours
      );

      return sanitizeTmdbPagedResponse<TmdbCompanySearchResponse>(data, page);
    } catch (e) {
      throw new Error(`[TMDB] Failed to search companies: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getAvailableWatchProviderRegions({
    language,
  }: {
    language?: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderRegion[] }>(
        '/watch/providers/regions',
        {
          params: {
            language: language ?? this.originalLanguage,
          },
        },
        86400 // 24 hours
      );

      return Array.isArray(data?.results)
        ? data.results.slice(0, MAX_TMDB_LOOKUP_RESULTS).flatMap((region) =>
            isRecord(region) &&
            typeof region.iso_3166_1 === 'string' &&
            typeof region.english_name === 'string' &&
            typeof region.native_name === 'string'
              ? [
                  {
                    iso_3166_1: region.iso_3166_1.slice(0, 16),
                    english_name: region.english_name.slice(0, 500),
                    native_name: region.native_name.slice(0, 500),
                  },
                ]
              : []
          )
        : [];
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch available watch regions: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMovieWatchProviders({
    language,
    watchRegion,
  }: {
    language?: string;
    watchRegion: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderDetails[] }>(
        '/watch/providers/movie',
        {
          params: {
            language: language ?? this.originalLanguage,
            watch_region: watchRegion,
          },
        },
        86400 // 24 hours
      );

      return Array.isArray(data?.results)
        ? data.results.slice(0, MAX_TMDB_LOOKUP_RESULTS).flatMap((provider) =>
            isRecord(provider) &&
            Number.isSafeInteger(provider.provider_id) &&
            typeof provider.provider_name === 'string'
              ? [
                  {
                    provider_id: provider.provider_id as number,
                    provider_name: provider.provider_name.slice(0, 500),
                    display_priority: Number.isFinite(provider.display_priority)
                      ? Math.trunc(provider.display_priority as number)
                      : undefined,
                    logo_path:
                      typeof provider.logo_path === 'string'
                        ? provider.logo_path.slice(0, 2000)
                        : undefined,
                  },
                ]
              : []
          )
        : [];
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch movie watch providers: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getTvWatchProviders({
    language,
    watchRegion,
  }: {
    language?: string;
    watchRegion: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderDetails[] }>(
        '/watch/providers/tv',
        {
          params: {
            language: language ?? this.originalLanguage,
            watch_region: watchRegion,
          },
        },
        86400 // 24 hours
      );

      return Array.isArray(data?.results)
        ? data.results.slice(0, MAX_TMDB_LOOKUP_RESULTS).flatMap((provider) =>
            isRecord(provider) &&
            Number.isSafeInteger(provider.provider_id) &&
            typeof provider.provider_name === 'string'
              ? [
                  {
                    provider_id: provider.provider_id as number,
                    provider_name: provider.provider_name.slice(0, 500),
                    display_priority: Number.isFinite(provider.display_priority)
                      ? Math.trunc(provider.display_priority as number)
                      : undefined,
                    logo_path:
                      typeof provider.logo_path === 'string'
                        ? provider.logo_path.slice(0, 2000)
                        : undefined,
                  },
                ]
              : []
          )
        : [];
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch TV watch providers: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default TheMovieDb;
