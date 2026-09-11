import { getCoverArtArchiveThumbnailUrl } from '@server/api/coverartarchive/urls';
import { DEFAULT_EXTERNAL_API_TIMEOUT_MS } from '@server/api/externalapi';
import ListenBrainzAPI from '@server/api/listenbrainz';
import type {
  LbFreshReleasesResponse,
  LbRelease,
  LbReleaseGroup,
  LbTopAlbumsResponse,
} from '@server/api/listenbrainz/interfaces';
import MusicBrainz from '@server/api/musicbrainz';
import type { MbAlbumResult } from '@server/api/musicbrainz/interfaces';
import type { OpenLibrarySearchDoc } from '@server/api/openlibrary';
import OpenLibraryAPI from '@server/api/openlibrary';
import type { SortOptions } from '@server/api/themoviedb';
import TheMovieDb, { SortOptionsIterable } from '@server/api/themoviedb';
import type {
  TmdbCollectionResult,
  TmdbKeyword,
  TmdbMovieResult,
  TmdbPersonResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { MAX_DISCOVER_KEYWORD_IDS } from '@server/constants/discover';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type MediaEntity from '@server/entity/Media';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import type {
  GenreSliderItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
import { findBookMediaByOpenLibraryIds } from '@server/lib/bookMediaMatcher';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { extractImageCacheUrls } from '@server/lib/imageCacheUrls';
import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { getSettings } from '@server/lib/settings';
import {
  clampNumber,
  getRecencyScore,
  getSeededJitter,
  rankByQualityScore,
  rankTmdbMovieResults,
  rankTmdbTvResults,
} from '@server/lib/tmdbRank';
import {
  UserMutationActorUnauthorizedError,
  isUserSessionCredentialVersionCurrent,
  runUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import { getCombinedWatchlist } from '@server/lib/watchlist';
import logger from '@server/logger';
import { mapOpenLibrarySearchDoc } from '@server/models/Book';
import { mapProductionCompany } from '@server/models/Movie';
import {
  mapAlbumResult,
  mapCollectionResult,
  mapMovieResult,
  mapPersonResult,
  mapTvResult,
} from '@server/models/Search';
import { mapNetwork } from '@server/models/Tv';
import {
  mapWithConcurrency,
  settlePromisesWithin,
} from '@server/utils/concurrency';
import { parsePositiveInt } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { isCollection, isMovie, isPerson } from '@server/utils/typeHelpers';
import {
  parseOptionalAllowedString,
  parseOptionalBoundedString,
  parseOptionalLanguage,
} from '@server/utils/validation';
import type { Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sortBy } from 'lodash';
import { In } from 'typeorm';
import { z } from 'zod';
import discoverHomeRoutes from './discoverHome';

export const createTmdbWithRegionLanguage = (user?: User): TheMovieDb => {
  const settings = getSettings();

  const discoverRegion =
    user?.settings?.streamingRegion === 'all'
      ? ''
      : user?.settings?.streamingRegion
        ? user?.settings?.streamingRegion
        : settings.main.discoverRegion;

  const originalLanguage =
    user?.settings?.originalLanguage === 'all'
      ? ''
      : user?.settings?.originalLanguage
        ? user?.settings?.originalLanguage
        : settings.main.originalLanguage;

  return new TheMovieDb({
    discoverRegion,
    originalLanguage,
  });
};

export const createTmdbWithBlocklistSettings = (): TheMovieDb => {
  const settings = getSettings();

  return new TheMovieDb({
    discoverRegion: settings.main.blocklistRegion,
    originalLanguage: settings.main.blocklistLanguage,
  });
};

const discoverRoutes = Router();
const MAX_DISCOVER_QUERY_LENGTH = 256;
const MAX_DISCOVER_FILTER_LENGTH = 512;
export const MAX_GENRE_SLIDER_ITEMS = 50;
export const GENRE_SLIDER_CONCURRENCY = 10;
export const EXTERNAL_DISCOVER_RATE_LIMIT = {
  windowMs: 60 * 1000,
  limit: 30,
} as const;
const MAX_TMDB_KEYWORD_ID = 1_000_000_000;
const trendingMediaTypes = ['all', 'movie', 'tv'] as const;
const trendingTimeWindows = ['day', 'week'] as const;

discoverRoutes.use('/home', discoverHomeRoutes);
discoverRoutes.use(
  ['/music', '/books'],
  rateLimit({
    ...EXTERNAL_DISCOVER_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () =>
      process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
    keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
  })
);

const parseOptionalDiscoverString = (
  value: unknown,
  fieldName: string,
  maxLength = MAX_DISCOVER_QUERY_LENGTH
) =>
  parseOptionalBoundedString(value, {
    fieldName,
    maxLength,
  });

const isValidIsoCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

const parseOptionalDateFilter = (value: unknown, fieldName: string) => {
  const parsed = parseOptionalDiscoverString(value, fieldName, 10);
  if ('error' in parsed || parsed.value === undefined) {
    return parsed;
  }

  return isValidIsoCalendarDate(parsed.value)
    ? parsed
    : { error: `${fieldName} must be a valid YYYY-MM-DD date.` };
};

const parseTmdbKeywordFilter = (
  value: string | undefined,
  fieldName: string
): { value?: string; ids: number[] } | { error: string } => {
  if (value === undefined || value.trim() === '') {
    return { value: undefined, ids: [] };
  }

  const parts = value.split(',');
  if (parts.length > MAX_DISCOVER_KEYWORD_IDS) {
    return {
      error: `${fieldName} is limited to ${MAX_DISCOVER_KEYWORD_IDS} ids.`,
    };
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const normalized = part.trim();
    if (!/^[1-9]\d*$/.test(normalized)) {
      return { error: `${fieldName} must contain positive integer ids.` };
    }

    const id = Number(normalized);
    if (!Number.isSafeInteger(id) || id > MAX_TMDB_KEYWORD_ID) {
      return { error: `${fieldName} contains an invalid id.` };
    }

    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return { value: ids.join(','), ids };
};

const getErrorLogFields = (error: unknown) => ({
  errorMessage: error instanceof Error ? error.message : 'Unknown error',
  errorStack: error instanceof Error ? error.stack : undefined,
});

const getDiscoverLogQuery = (query: Record<string, unknown>) => ({
  page: query.page,
  sortBy: query.sortBy,
  format: query.format,
  query: query.query,
  genre: query.genre,
  subject: query.subject,
  releaseType: query.releaseType,
  days: query.days,
  shuffleSeed: query.shuffleSeed,
  primaryReleaseDateGte: query.primaryReleaseDateGte,
  primaryReleaseDateLte: query.primaryReleaseDateLte,
});

const parseDiscoverLanguage = (
  value: unknown,
  fallbackLanguage: string | undefined
) => {
  const parsed = parseOptionalLanguage(value);
  if ('error' in parsed) {
    return parsed;
  }

  return { value: parsed.value ?? fallbackLanguage };
};

discoverRoutes.use((_req, res, next) => {
  const json = res.json.bind(res);

  res.json = ((body: unknown) => {
    enqueueImageCacheWarm(extractImageCacheUrls(body));

    return json(body);
  }) as Response['json'];

  next();
});

const emptyDiscoverResponse = (page: number) => ({
  page,
  totalPages: 1,
  totalResults: 0,
  results: [],
});

const normalizeDiscoverTitle = (value?: string) =>
  (value ?? '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getMusicBrainzIdKey = (id?: string | null): string | undefined => {
  if (typeof id !== 'string') {
    return undefined;
  }

  const normalizedId = normalizeMusicBrainzId(id);

  return normalizedId || undefined;
};

const getRelatedMusicMedia = (
  relatedMediaMap: Map<string, MediaEntity>,
  id?: string | null
): MediaEntity | undefined => {
  const idKey = getMusicBrainzIdKey(id);

  return idKey ? relatedMediaMap.get(idKey) : undefined;
};

const dedupeMusicAlbums = <T extends MbAlbumResult>(albums: T[]): T[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return albums.filter((album) => {
    const idKey = getMusicBrainzIdKey(album.id);

    if (!idKey) {
      return false;
    }

    const titleKey = [
      normalizeDiscoverTitle(album.title),
      normalizeDiscoverTitle(album['artist-credit']?.[0]?.name),
      album['first-release-date']?.slice(0, 4) ?? '',
      normalizeDiscoverTitle(album['primary-type']),
    ].join('|');

    if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
      return false;
    }

    seenIds.add(idKey);
    seenTitles.add(titleKey);
    return true;
  });
};

const dedupeFreshReleases = (releases: LbRelease[]): LbRelease[] => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return releases.filter((release) => {
    const idKey = getMusicBrainzIdKey(release.release_group_mbid);

    if (!idKey) {
      return false;
    }

    const titleKey = [
      normalizeDiscoverTitle(release.release_name),
      normalizeDiscoverTitle(release.artist_credit_name),
      release.release_date?.slice(0, 4) ?? '',
      normalizeDiscoverTitle(release.release_group_primary_type),
    ].join('|');

    if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
      return false;
    }

    seenIds.add(idKey);
    seenTitles.add(titleKey);
    return true;
  });
};

const dedupeBookDocs = (
  docs: OpenLibrarySearchDoc[]
): OpenLibrarySearchDoc[] => {
  const seenKeys = new Set<string>();
  const seenTitles = new Set<string>();

  return docs.filter((doc) => {
    const key = normalizeOpenLibraryWorkId(doc.key).toLocaleLowerCase();
    const titleKey = [
      normalizeDiscoverTitle(doc.title),
      normalizeDiscoverTitle(doc.author_name?.[0]),
    ].join('|');

    if (seenKeys.has(key) || seenTitles.has(titleKey)) {
      return false;
    }

    seenKeys.add(key);
    seenTitles.add(titleKey);
    return true;
  });
};

const getUnknownTotalResults = (
  page: number,
  resultCount: number,
  itemsPerPage: number
) =>
  resultCount === itemsPerPage
    ? page * itemsPerPage + itemsPerPage + 1
    : (page - 1) * itemsPerPage + resultCount;

const getProviderWindow = (
  page: number,
  itemsPerPage: number,
  windowSize = 100
) => {
  const pageOffset = (page - 1) * itemsPerPage;
  const windowOffset = Math.floor(pageOffset / windowSize) * windowSize;

  return {
    offset: windowOffset,
    limit: windowSize,
    sliceStart: pageOffset - windowOffset,
    sliceEnd: pageOffset - windowOffset + itemsPerPage,
  };
};

const getRelatedMusicMediaMap = async (
  ids: (string | null | undefined)[],
  user?: User
): Promise<Map<string, MediaEntity>> => {
  const normalizedIds = [...new Set(ids.map(getMusicBrainzIdKey))].filter(
    (id): id is string => Boolean(id)
  );

  if (!normalizedIds.length) {
    return new Map();
  }

  const relatedMedia = await getRepository(Media).find({
    where: { mbId: In(normalizedIds), mediaType: MediaType.MUSIC },
  });
  await hydrateMediaSummaryRelations(relatedMedia, user);

  return new Map(
    relatedMedia
      .filter((media) => media.mbId)
      .map((media) => [normalizeMusicBrainzId(media.mbId as string), media])
  );
};

const scoreMusicRelease = (release: LbRelease): number => {
  const listenScore = Math.log10((release.listen_count ?? 0) + 1) * 40;
  const recencyScore = getRecencyScore(release.release_date);
  const coverScore = release.caa_release_mbid ? 8 : 0;
  const typeScore =
    release.release_group_primary_type === 'Album'
      ? 8
      : release.release_group_primary_type === 'EP'
        ? 4
        : 0;

  return listenScore + recencyScore + coverScore + typeScore;
};

const scoreMusicAlbum = (album: MbAlbumResult): number => {
  const searchScore = clampNumber(album.score) * 2;
  const recencyScore = getRecencyScore(album['first-release-date']);
  const coverScore = album.posterPath ? 8 : 0;
  const typeScore =
    album['primary-type'] === 'Album'
      ? 8
      : album['primary-type'] === 'EP'
        ? 4
        : 0;

  return searchScore + recencyScore + coverScore + typeScore;
};

const scoreBookDoc = (doc: OpenLibrarySearchDoc): number => {
  const ratingScore = clampNumber(doc.ratings_average) * 12;
  const ratingCountScore = Math.log10(clampNumber(doc.ratings_count) + 1) * 18;
  const wantToReadScore =
    Math.log10(clampNumber(doc.want_to_read_count) + 1) * 12;
  const editionScore = Math.log10(clampNumber(doc.edition_count) + 1) * 10;
  const recencyScore =
    getRecencyScore(doc.first_publish_year?.toString()) * 0.5;
  const metadataScore =
    (doc.cover_i ? 8 : 0) + (doc.author_name?.length ? 4 : 0);

  return (
    ratingScore +
    ratingCountScore +
    wantToReadScore +
    editionScore +
    recencyScore +
    metadataScore
  );
};

const getBookAuthorDiversityKey = (doc: OpenLibrarySearchDoc): string =>
  doc.author_key?.[0] ?? doc.author_name?.[0] ?? doc.key;

const diversifyBookDocsByAuthor = (
  docs: OpenLibrarySearchDoc[],
  limit: number,
  maxPerAuthor = 2
): OpenLibrarySearchDoc[] => {
  const selectedDocs: OpenLibrarySearchDoc[] = [];
  const skippedDocs: OpenLibrarySearchDoc[] = [];
  const authorCounts = new Map<string, number>();

  docs.forEach((doc) => {
    const authorKey = getBookAuthorDiversityKey(doc);
    const authorCount = authorCounts.get(authorKey) ?? 0;

    if (authorCount < maxPerAuthor) {
      selectedDocs.push(doc);
      authorCounts.set(authorKey, authorCount + 1);
    } else {
      skippedDocs.push(doc);
    }
  });

  return [...selectedDocs, ...skippedDocs].slice(0, limit);
};

const mapTopAlbumRelease = (releaseGroup: LbReleaseGroup): MbAlbumResult => ({
  id: releaseGroup.release_group_mbid,
  score: releaseGroup.listen_count ?? 0,
  media_type: 'album',
  title: releaseGroup.release_group_name,
  'primary-type': 'Album' as const,
  'first-release-date': '',
  'artist-credit': [
    {
      name: releaseGroup.artist_name,
      artist: {
        id: releaseGroup.artist_mbids[0],
        name: releaseGroup.artist_name,
        'sort-name': releaseGroup.artist_name,
      },
    },
  ],
  posterPath:
    getCoverArtArchiveThumbnailUrl(
      releaseGroup.caa_release_mbid,
      releaseGroup.caa_id
    ) ??
    (releaseGroup.caa_release_mbid
      ? `https://coverartarchive.org/release/${releaseGroup.caa_release_mbid}/front-250`
      : undefined),
});

const mapFreshReleaseAlbum = (release: LbRelease): MbAlbumResult => ({
  id: release.release_group_mbid,
  score: scoreMusicRelease(release),
  media_type: 'album',
  title: release.release_name,
  'primary-type':
    release.release_group_primary_type === 'Single' ||
    release.release_group_primary_type === 'EP'
      ? release.release_group_primary_type
      : 'Album',
  'first-release-date': release.release_date,
  'artist-credit': [
    {
      name: release.artist_credit_name,
      artist: {
        id: release.artist_mbids[0],
        name: release.artist_credit_name,
        'sort-name': release.artist_credit_name,
      },
    },
  ],
  posterPath:
    getCoverArtArchiveThumbnailUrl(release.caa_release_mbid, release.caa_id) ??
    (release.caa_release_mbid
      ? `https://coverartarchive.org/release/${release.caa_release_mbid}/front-250`
      : undefined),
});

const mergeMusicAlbumMetadata = (
  existingAlbum: MbAlbumResult,
  incomingAlbum: MbAlbumResult
): MbAlbumResult => {
  const primaryAlbum =
    scoreMusicAlbum(incomingAlbum) > scoreMusicAlbum(existingAlbum)
      ? incomingAlbum
      : existingAlbum;
  const fallbackAlbum =
    primaryAlbum === incomingAlbum ? existingAlbum : incomingAlbum;

  return {
    ...primaryAlbum,
    score: Math.max(
      clampNumber(existingAlbum.score),
      clampNumber(incomingAlbum.score)
    ),
    title: primaryAlbum.title || fallbackAlbum.title,
    'first-release-date':
      primaryAlbum['first-release-date'] || fallbackAlbum['first-release-date'],
    'artist-credit': primaryAlbum['artist-credit'].length
      ? primaryAlbum['artist-credit']
      : fallbackAlbum['artist-credit'],
    posterPath: primaryAlbum.posterPath ?? fallbackAlbum.posterPath,
  };
};

const getMusicArtistDiversityKey = (album: MbAlbumResult): string =>
  album['artist-credit'][0]?.artist?.id ??
  album['artist-credit'][0]?.name ??
  album.id;

const diversifyMusicAlbumsByArtist = (
  albums: MbAlbumResult[],
  limit: number,
  maxPerArtist = 2
): MbAlbumResult[] => {
  const selectedAlbums: MbAlbumResult[] = [];
  const skippedAlbums: MbAlbumResult[] = [];
  const artistCounts = new Map<string, number>();

  albums.forEach((album) => {
    const artistKey = getMusicArtistDiversityKey(album);
    const artistCount = artistCounts.get(artistKey) ?? 0;

    if (artistCount < maxPerArtist) {
      selectedAlbums.push(album);
      artistCounts.set(artistKey, artistCount + 1);
    } else {
      skippedAlbums.push(album);
    }
  });

  return [...selectedAlbums, ...skippedAlbums].slice(0, limit);
};

const defaultBookDiscoverySubjects = [
  'fiction',
  'fantasy',
  'science_fiction',
  'mystery',
  'biography',
  'romance',
  'history',
  'thriller',
  'literary_fiction',
  'historical_fiction',
  'horror',
  'young_adult',
  'memoir',
  'science',
  'philosophy',
  'poetry',
];

const DEFAULT_BOOK_DISCOVERY_SUBJECT_LIMIT = 5;
// Open Library requests can legitimately take up to
// DEFAULT_EXTERNAL_API_TIMEOUT_MS to complete. These race timeouts must stay
// above that, or they cut off in-flight requests before the HTTP client
// itself would give up, turning a slow-but-working provider into a hard
// failure (see: books discovery going empty under provider latency).
const BOOK_DISCOVERY_BLEND_TIMEOUT_MS = DEFAULT_EXTERNAL_API_TIMEOUT_MS + 2_000;
const MUSIC_DISCOVERY_BLEND_TIMEOUT_MS = 5_000;
const OPENLIBRARY_SINGLE_REQUEST_TIMEOUT_MS =
  DEFAULT_EXTERNAL_API_TIMEOUT_MS + 2_000;

const defaultMusicDiscoveryTags = [
  'pop',
  'rock',
  'hip hop',
  'electronic',
  'jazz',
  'folk',
  'indie',
  'soul',
];

const getDailyRotationOffset = (itemCount: number): number => {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.floor(Date.now() / 86_400_000) % itemCount;
};

const rotateItems = <T>(items: T[], offset: number): T[] => [
  ...items.slice(offset),
  ...items.slice(0, offset),
];

const musicSortOptions = new Set([
  'ranked',
  'popular.week',
  'popular.month',
  'popular.year',
  'listen_count.desc',
  'release_date.desc',
  'release_date.asc',
]);

const bookSortOptions = new Set([
  'ranked',
  'newest',
  'oldest',
  'random',
  'rating',
  'editions',
]);

const tmdbSortOptions = new Set<string>(SortOptionsIterable);

const getValidatedSort = (
  sortBy: unknown,
  allowedSortOptions: Set<string>
): string =>
  typeof sortBy === 'string' && allowedSortOptions.has(sortBy)
    ? sortBy
    : 'ranked';

const getValidatedTmdbSort = (sortBy: unknown): SortOptions =>
  (typeof sortBy === 'string' && tmdbSortOptions.has(sortBy)
    ? sortBy
    : 'popularity.desc') as SortOptions;

const optionalTmdbQueryString = (maxLength = MAX_DISCOVER_FILTER_LENGTH) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(z.string().max(maxLength))
    .optional();
const optionalTmdbDateString = z
  .string()
  .trim()
  .refine(isValidIsoCalendarDate)
  .optional();

const QueryFilterOptions = z.object({
  page: optionalTmdbQueryString(16),
  sortBy: optionalTmdbQueryString(64),
  primaryReleaseDateGte: optionalTmdbDateString,
  primaryReleaseDateLte: optionalTmdbDateString,
  firstAirDateGte: optionalTmdbDateString,
  firstAirDateLte: optionalTmdbDateString,
  studio: optionalTmdbQueryString(),
  genre: optionalTmdbQueryString(),
  keywords: optionalTmdbQueryString(),
  excludeKeywords: optionalTmdbQueryString(),
  language: optionalTmdbQueryString(32),
  withRuntimeGte: optionalTmdbQueryString(16),
  withRuntimeLte: optionalTmdbQueryString(16),
  voteAverageGte: optionalTmdbQueryString(16),
  voteAverageLte: optionalTmdbQueryString(16),
  voteCountGte: optionalTmdbQueryString(16),
  voteCountLte: optionalTmdbQueryString(16),
  network: optionalTmdbQueryString(),
  watchProviders: optionalTmdbQueryString(),
  watchRegion: optionalTmdbQueryString(16),
  status: optionalTmdbQueryString(32),
  certification: optionalTmdbQueryString(32),
  certificationGte: optionalTmdbQueryString(32),
  certificationLte: optionalTmdbQueryString(32),
  certificationCountry: optionalTmdbQueryString(16),
  certificationMode: z.enum(['exact', 'range']).optional(),
  shuffleSeed: optionalTmdbQueryString(128),
});

export type FilterOptions = z.infer<typeof QueryFilterOptions>;
const ApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
});
const SEEDED_DISCOVERY_SHUFFLE_WINDOW = 80;

const shuffleRankedWindow = <T>(
  rankedResults: T[],
  seed?: string,
  windowSize = SEEDED_DISCOVERY_SHUFFLE_WINDOW
): T[] => {
  if (!seed) {
    return rankedResults;
  }

  const windowedResults = rankedResults
    .slice(0, windowSize)
    .map((result, index) => ({
      result,
      rank: getSeededJitter(seed, index),
    }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ result }) => result);

  return [...windowedResults, ...rankedResults.slice(windowSize)];
};

discoverRoutes.get('/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const parsedQuery = ApiQuerySchema.safeParse({ ...req.query });
    if (!parsedQuery.success) {
      return res.status(400).json({
        status: 400,
        message: 'Invalid discovery query parameters.',
      });
    }
    const query = parsedQuery.data;
    const parsedKeywords = parseTmdbKeywordFilter(query.keywords, 'Keywords');
    const parsedExcludeKeywords = parseTmdbKeywordFilter(
      query.excludeKeywords,
      'Excluded keywords'
    );
    const parsedShuffleSeed = parseOptionalDiscoverString(
      query.shuffleSeed,
      'Shuffle seed',
      128
    );
    if ('error' in parsedShuffleSeed) {
      return res
        .status(400)
        .json({ status: 400, message: parsedShuffleSeed.error });
    }
    if ('error' in parsedKeywords) {
      return res
        .status(400)
        .json({ status: 400, message: parsedKeywords.error });
    }
    if ('error' in parsedExcludeKeywords) {
      return res
        .status(400)
        .json({ status: 400, message: parsedExcludeKeywords.error });
    }
    const keywords = parsedKeywords.value;
    const excludeKeywords = parsedExcludeKeywords.value;

    const data = await tmdb.getDiscoverMovies({
      page: parsePositiveInt(query.page, 1, 500),
      sortBy: getValidatedTmdbSort(query.sortBy),
      language: req.locale ?? query.language,
      originalLanguage: query.language,
      genre: query.genre,
      studio: query.studio,
      primaryReleaseDateLte: query.primaryReleaseDateLte
        ? new Date(query.primaryReleaseDateLte).toISOString().split('T')[0]
        : undefined,
      primaryReleaseDateGte: query.primaryReleaseDateGte
        ? new Date(query.primaryReleaseDateGte).toISOString().split('T')[0]
        : undefined,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });
    const rankedResults = query.sortBy
      ? data.results
      : shuffleRankedWindow(
          rankTmdbMovieResults(data.results, parsedShuffleSeed.value),
          parsedShuffleSeed.value
        );

    const media = await Media.getRelatedMedia(
      req.user,
      rankedResults.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const keywordResults = await Promise.all(
        parsedKeywords.ids.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: rankedResults.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular movies.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/movies/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        originalLanguage: req.params.language,
      });
      const rankedResults = rankTmdbMovieResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: rankedResults.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/movies/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);
    const genreId = parsePositiveRouteId(req.params.genreId);
    if (!genreId) {
      return next({ status: 404, message: 'Genre not found.' });
    }

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }
      const genres = await tmdb.getMovieGenres({
        language: parsedLanguage.value,
      });

      const genre = genres.find((genre) => genre.id === genreId);

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        genre: genreId.toString(),
      });
      const rankedResults = rankTmdbMovieResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: rankedResults.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by genre.',
      });
    }
  }
);

discoverRoutes.get<{ studioId: string }>(
  '/movies/studio/:studioId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();
    const studioId = parsePositiveRouteId(req.params.studioId);
    if (!studioId) {
      return next({ status: 404, message: 'Studio not found.' });
    }

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }
      const studio = await tmdb.getStudio(studioId);

      const data = await tmdb.getDiscoverMovies({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        studio: studioId.toString(),
      });
      const rankedResults = rankTmdbMovieResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        studio: mapProductionCompany(studio),
        results: rankedResults.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by studio', {
        label: 'API',
        errorMessage: e.message,
        studioId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by studio.',
      });
    }
  }
);

discoverRoutes.get('/movies/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const parsedLanguage = parseDiscoverLanguage(
      req.query.language,
      req.locale
    );
    if ('error' in parsedLanguage) {
      return res
        .status(400)
        .json({ status: 400, message: parsedLanguage.error });
    }
    const data = await tmdb.getDiscoverMovies({
      page: parsePositiveInt(req.query.page, 1, 500),
      language: parsedLanguage.value,
      primaryReleaseDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (med) =>
              med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming movies.',
    });
  }
});

discoverRoutes.get('/tv', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const parsedQuery = ApiQuerySchema.safeParse({ ...req.query });
    if (!parsedQuery.success) {
      return res.status(400).json({
        status: 400,
        message: 'Invalid discovery query parameters.',
      });
    }
    const query = parsedQuery.data;
    const parsedKeywords = parseTmdbKeywordFilter(query.keywords, 'Keywords');
    const parsedExcludeKeywords = parseTmdbKeywordFilter(
      query.excludeKeywords,
      'Excluded keywords'
    );
    const parsedShuffleSeed = parseOptionalDiscoverString(
      query.shuffleSeed,
      'Shuffle seed',
      128
    );
    const network =
      query.network === undefined
        ? undefined
        : parsePositiveRouteId(query.network);

    if ('error' in parsedShuffleSeed) {
      return res
        .status(400)
        .json({ status: 400, message: parsedShuffleSeed.error });
    }
    if ('error' in parsedKeywords) {
      return res
        .status(400)
        .json({ status: 400, message: parsedKeywords.error });
    }
    if ('error' in parsedExcludeKeywords) {
      return res
        .status(400)
        .json({ status: 400, message: parsedExcludeKeywords.error });
    }
    if (query.network !== undefined && network === undefined) {
      return res.status(400).json({
        status: 400,
        message: 'Network must be a positive decimal identifier.',
      });
    }

    const keywords = parsedKeywords.value;
    const excludeKeywords = parsedExcludeKeywords.value;

    const data = await tmdb.getDiscoverTv({
      page: parsePositiveInt(query.page, 1, 500),
      sortBy: getValidatedTmdbSort(query.sortBy),
      language: req.locale ?? query.language,
      genre: query.genre,
      network,
      firstAirDateLte: query.firstAirDateLte
        ? new Date(query.firstAirDateLte).toISOString().split('T')[0]
        : undefined,
      firstAirDateGte: query.firstAirDateGte
        ? new Date(query.firstAirDateGte).toISOString().split('T')[0]
        : undefined,
      originalLanguage: query.language,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      withStatus: query.status,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });
    const rankedResults = query.sortBy
      ? data.results
      : shuffleRankedWindow(
          rankTmdbTvResults(data.results, parsedShuffleSeed.value),
          parsedShuffleSeed.value
        );

    const media = await Media.getRelatedMedia(
      req.user,
      rankedResults.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const keywordResults = await Promise.all(
        parsedKeywords.ids.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: rankedResults.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular series.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/tv/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        originalLanguage: req.params.language,
      });
      const rankedResults = rankTmdbTvResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: rankedResults.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/tv/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);
    const genreId = parsePositiveRouteId(req.params.genreId);
    if (!genreId) {
      return next({ status: 404, message: 'Genre not found.' });
    }

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return res
          .status(400)
          .json({ status: 400, message: parsedLanguage.error });
      }
      const genres = await tmdb.getTvGenres({
        language: parsedLanguage.value,
      });

      const genre = genres.find((genre) => genre.id === genreId);

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        genre: genreId.toString(),
      });
      const rankedResults = rankTmdbTvResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: rankedResults.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by genre.',
      });
    }
  }
);

discoverRoutes.get<{ networkId: string }>(
  '/tv/network/:networkId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();
    const networkId = parsePositiveRouteId(req.params.networkId);
    if (!networkId) {
      return next({ status: 404, message: 'Network not found.' });
    }

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return res
          .status(400)
          .json({ status: 400, message: parsedLanguage.error });
      }
      const network = await tmdb.getNetwork(networkId);

      const data = await tmdb.getDiscoverTv({
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
        network: networkId,
      });
      const rankedResults = rankTmdbTvResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        network: mapNetwork(network),
        results: rankedResults.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by network', {
        label: 'API',
        errorMessage: e.message,
        networkId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by network.',
      });
    }
  }
);

discoverRoutes.get('/tv/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const parsedLanguage = parseDiscoverLanguage(
      req.query.language,
      req.locale
    );
    if ('error' in parsedLanguage) {
      return res
        .status(400)
        .json({ status: 400, message: parsedLanguage.error });
    }
    const data = await tmdb.getDiscoverTv({
      page: parsePositiveInt(req.query.page, 1, 500),
      language: parsedLanguage.value,
      firstAirDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming series.',
    });
  }
});

discoverRoutes.get('/trending', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const parsedMediaType = parseOptionalAllowedString(req.query.mediaType, {
      fieldName: 'Media type',
      allowedValues: trendingMediaTypes,
      maxLength: 16,
    });
    if ('error' in parsedMediaType) {
      return res
        .status(400)
        .json({ status: 400, message: parsedMediaType.error });
    }
    const parsedTimeWindow = parseOptionalAllowedString(req.query.timeWindow, {
      fieldName: 'Time window',
      allowedValues: trendingTimeWindows,
      maxLength: 8,
    });
    if ('error' in parsedTimeWindow) {
      return res
        .status(400)
        .json({ status: 400, message: parsedTimeWindow.error });
    }
    const parsedLanguage = parseDiscoverLanguage(
      req.query.language,
      req.locale
    );
    if ('error' in parsedLanguage) {
      return res
        .status(400)
        .json({ status: 400, message: parsedLanguage.error });
    }
    const mediaType = parsedMediaType.value ?? 'all';
    const timeWindow = parsedTimeWindow.value ?? 'day';
    const language = parsedLanguage.value;
    const page = parsePositiveInt(req.query.page, 1, 500);

    const trendingFetchers = {
      movie: async () => ({
        data: await tmdb.getMovieTrending({ page, language, timeWindow }),
        mapper: mapMovieResult,
        type: MediaType.MOVIE,
      }),
      tv: async () => ({
        data: await tmdb.getTvTrending({ page, language, timeWindow }),
        mapper: mapTvResult,
        type: MediaType.TV,
      }),
      all: async () => ({
        data: await tmdb.getAllTrending({ page, language, timeWindow }),
        mapper: (
          result:
            | TmdbMovieResult
            | TmdbTvResult
            | TmdbPersonResult
            | TmdbCollectionResult,
          media?: Media
        ) => {
          if (isMovie(result)) {
            return mapMovieResult(result, media);
          } else if (isPerson(result)) {
            return mapPersonResult(result);
          } else if (isCollection(result)) {
            return mapCollectionResult(result);
          } else {
            return mapTvResult(result, media);
          }
        },
        type: null,
      }),
    } as const;

    const { data, mapper, type } = await trendingFetchers[mediaType]();
    const mapTrendingResult = mapper as (
      result: (typeof data.results)[number],
      media?: Media
    ) => unknown;

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: isMovie(result) ? MediaType.MOVIE : MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) => {
        // - If "type" is set (case: "movie" or "tv"), the mediaType must also match.
        // - If "type" is not set (case: "all"), only filter by tmdbId.
        const selectedMedia = media.find(
          (med) =>
            med.tmdbId === result.id && (type ? med.mediaType === type : true)
        );

        return mapTrendingResult(result, selectedMedia);
      }),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving trending items', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve trending items.',
    });
  }
});

discoverRoutes.get<{ keywordId: string }>(
  '/keyword/:keywordId/movies',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();
    const keywordId = parsePositiveRouteId(req.params.keywordId);
    if (!keywordId) {
      return next({ status: 404, message: 'Keyword not found.' });
    }

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return res
          .status(400)
          .json({ status: 400, message: parsedLanguage.error });
      }
      const data = await tmdb.getMoviesByKeyword({
        keywordId,
        page: parsePositiveInt(req.query.page, 1, 500),
        language: parsedLanguage.value,
      });
      const rankedResults = rankTmdbMovieResults(data.results);

      const media = await Media.getRelatedMedia(
        req.user,
        rankedResults.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        results: rankedResults.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by keyword', {
        label: 'API',
        errorMessage: e.message,
        keywordId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by keyword.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/movie',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }

      const genres = await tmdb.getMovieGenres({
        language: parsedLanguage.value,
      });

      const mappedGenres = await mapWithConcurrency(
        genres.slice(0, MAX_GENRE_SLIDER_ITEMS),
        GENRE_SLIDER_CONCURRENCY,
        async (genre): Promise<GenreSliderItem> => {
          const genreData = await tmdb.getDiscoverMovies({
            genre: genre.id.toString(),
          });
          const rankedResults = rankTmdbMovieResults(genreData.results);

          return {
            id: genre.id,
            name: genre.name,
            backdrops: rankedResults
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          };
        }
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the movie genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie genre slider.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/tv',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const parsedLanguage = parseDiscoverLanguage(
        req.query.language,
        req.locale
      );
      if ('error' in parsedLanguage) {
        return next({ status: 400, message: parsedLanguage.error });
      }

      const genres = await tmdb.getTvGenres({
        language: parsedLanguage.value,
      });

      const mappedGenres = await mapWithConcurrency(
        genres.slice(0, MAX_GENRE_SLIDER_ITEMS),
        GENRE_SLIDER_CONCURRENCY,
        async (genre): Promise<GenreSliderItem> => {
          const genreData = await tmdb.getDiscoverTv({
            genre: genre.id.toString(),
          });
          const rankedResults = rankTmdbTvResults(genreData.results);

          return {
            id: genre.id,
            name: genre.name,
            backdrops: rankedResults
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          };
        }
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the series genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series genre slider.',
      });
    }
  }
);

discoverRoutes.get('/music', async (req, res) => {
  const listenBrainz = new ListenBrainzAPI();
  const musicBrainz = new MusicBrainz();
  const itemsPerPage = 20;
  const page = parsePositiveInt(req.query.page, 1, 500);
  const days = parsePositiveInt(req.query.days, 14, 365);
  const hasCustomDays = typeof req.query.days === 'string';
  const sortByValue = getValidatedSort(req.query.sortBy, musicSortOptions);
  const sortAscending = sortByValue === 'release_date.asc';
  const parsedGenre = parseOptionalDiscoverString(
    req.query.genre,
    'Genre',
    MAX_DISCOVER_FILTER_LENGTH
  );
  const parsedReleaseType = parseOptionalDiscoverString(
    req.query.releaseType,
    'Release type',
    MAX_DISCOVER_FILTER_LENGTH
  );
  const parsedQuery = parseOptionalDiscoverString(req.query.query, 'Query');
  const parsedShuffleSeed = parseOptionalDiscoverString(
    req.query.shuffleSeed,
    'Shuffle seed',
    128
  );
  const parsedReleaseDateGte = parseOptionalDateFilter(
    req.query.primaryReleaseDateGte,
    'Primary release date start'
  );
  const parsedReleaseDateLte = parseOptionalDateFilter(
    req.query.primaryReleaseDateLte,
    'Primary release date end'
  );

  if ('error' in parsedGenre) {
    return res.status(400).json({ status: 400, message: parsedGenre.error });
  }
  if ('error' in parsedReleaseType) {
    return res
      .status(400)
      .json({ status: 400, message: parsedReleaseType.error });
  }
  if ('error' in parsedQuery) {
    return res.status(400).json({ status: 400, message: parsedQuery.error });
  }
  if ('error' in parsedShuffleSeed) {
    return res
      .status(400)
      .json({ status: 400, message: parsedShuffleSeed.error });
  }
  if ('error' in parsedReleaseDateGte) {
    return res
      .status(400)
      .json({ status: 400, message: parsedReleaseDateGte.error });
  }
  if ('error' in parsedReleaseDateLte) {
    return res
      .status(400)
      .json({ status: 400, message: parsedReleaseDateLte.error });
  }

  const genreFilter = parsedGenre.value
    ? parsedGenre.value
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean)
    : [];
  const releaseTypeFilter = parsedReleaseType.value
    ? parsedReleaseType.value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
    : [];
  const query = parsedQuery.value ?? '';
  const shuffleSeed = parsedShuffleSeed.value;
  const releaseDateGte = parsedReleaseDateGte.value;
  const releaseDateLte = parsedReleaseDateLte.value;

  try {
    if (query) {
      const providerWindow = getProviderWindow(page, itemsPerPage);
      const albumWindow = await musicBrainz.searchAlbum({
        query,
        limit: providerWindow.limit,
        offset: providerWindow.offset,
      });
      const albums = dedupeMusicAlbums(
        albumWindow.slice(providerWindow.sliceStart, providerWindow.sliceEnd)
      );
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : page,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapAlbumResult(album, getRelatedMusicMedia(relatedMediaMap, album.id))
        ),
      });
    }

    if (genreFilter.length) {
      const providerWindow = getProviderWindow(page, itemsPerPage);
      const { releaseGroups, totalCount } =
        await musicBrainz.searchReleaseGroupsByTag({
          tags: genreFilter,
          primaryTypes: releaseTypeFilter.length
            ? releaseTypeFilter
            : undefined,
          releaseDateGte,
          releaseDateLte,
          limit: providerWindow.limit,
          offset: providerWindow.offset,
        });
      const sortedAlbums = dedupeMusicAlbums(releaseGroups).sort((a, b) => {
        if (sortByValue === 'ranked') {
          return scoreMusicAlbum(b) - scoreMusicAlbum(a);
        }

        if (sortByValue === 'listen_count.desc') {
          return (b.score ?? 0) - (a.score ?? 0);
        }

        const left = a['first-release-date'] ?? '';
        const right = b['first-release-date'] ?? '';
        return sortAscending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });
      const albums =
        sortByValue === 'ranked'
          ? diversifyMusicAlbumsByArtist(
              shuffleRankedWindow(
                rankByQualityScore(
                  sortedAlbums,
                  scoreMusicAlbum,
                  0.08,
                  4,
                  shuffleSeed
                ),
                shuffleSeed
              ),
              providerWindow.sliceEnd
            ).slice(providerWindow.sliceStart, providerWindow.sliceEnd)
          : sortedAlbums.slice(
              providerWindow.sliceStart,
              providerWindow.sliceEnd
            );
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: Math.max(1, Math.ceil(totalCount / itemsPerPage)),
        totalResults: totalCount,
        results: albums.map((album) =>
          mapAlbumResult(album, getRelatedMusicMedia(relatedMediaMap, album.id))
        ),
      });
    }

    const providerWindow = getProviderWindow(page, itemsPerPage);
    const hasReleaseDateFilter = Boolean(releaseDateGte || releaseDateLte);

    if (!genreFilter.length && sortByValue.startsWith('popular')) {
      const range =
        sortByValue === 'popular.week'
          ? 'week'
          : sortByValue === 'popular.year'
            ? 'year'
            : 'month';
      const topAlbums = await listenBrainz.getTopAlbums({
        range,
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
      const albums = diversifyMusicAlbumsByArtist(
        dedupeMusicAlbums(
          topAlbums.payload.release_groups.map(mapTopAlbumRelease)
        ),
        providerWindow.sliceEnd
      ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: Math.max(
          1,
          Math.ceil(topAlbums.payload.count / itemsPerPage)
        ),
        totalResults: topAlbums.payload.count,
        results: albums.map((album) =>
          mapAlbumResult(album, getRelatedMusicMedia(relatedMediaMap, album.id))
        ),
      });
    }

    if (
      sortByValue === 'ranked' &&
      !releaseTypeFilter.length &&
      !hasReleaseDateFilter &&
      !hasCustomDays
    ) {
      const primaryResults = await settlePromisesWithin<
        LbTopAlbumsResponse | LbFreshReleasesResponse
      >(
        [
          listenBrainz.getTopAlbums({
            range: 'week',
            offset: providerWindow.offset,
            count: providerWindow.limit,
          }),
          listenBrainz.getFreshReleases({
            days,
            sort: 'release_date',
            offset: providerWindow.offset,
            count: providerWindow.limit,
          }),
        ],
        MUSIC_DISCOVERY_BLEND_TIMEOUT_MS
      );
      const topAlbumsResult = primaryResults.results[0] as
        | PromiseSettledResult<LbTopAlbumsResponse>
        | undefined;
      const freshReleasesResult = primaryResults.results[1] as
        | PromiseSettledResult<LbFreshReleasesResponse>
        | undefined;
      const topAlbums =
        topAlbumsResult?.status === 'fulfilled'
          ? topAlbumsResult.value.payload.release_groups
          : [];
      const freshReleases =
        freshReleasesResult?.status === 'fulfilled'
          ? freshReleasesResult.value.payload.releases
          : [];

      if (primaryResults.timedOut) {
        logger.warn('Ranked music discovery blend timed out', {
          label: 'Discover Music',
          completedSources: primaryResults.results.length,
          requestQuery: getDiscoverLogQuery(req.query),
        });
      }

      if (!topAlbums.length && !freshReleases.length) {
        logger.warn(
          'No ListenBrainz ranked music discovery sources were available, falling back to MusicBrainz tags',
          {
            label: 'Discover Music',
          }
        );

        const fallbackTags = rotateItems(
          defaultMusicDiscoveryTags,
          getDailyRotationOffset(defaultMusicDiscoveryTags.length)
        ).slice(0, 4);
        const fallbackResults = await settlePromisesWithin(
          fallbackTags.map((tag) =>
            musicBrainz.searchReleaseGroupsByTag({
              tags: [tag],
              primaryTypes: ['Album'],
              limit: Math.ceil(providerWindow.limit / 2),
              offset: providerWindow.offset,
            })
          ),
          MUSIC_DISCOVERY_BLEND_TIMEOUT_MS
        );
        if (fallbackResults.timedOut) {
          logger.warn('Music discovery fallback timed out', {
            label: 'Discover Music',
            completedSources: fallbackResults.results.length,
            requestQuery: getDiscoverLogQuery(req.query),
          });
        }
        const fallbackAlbumsById = new Map<string, MbAlbumResult>();

        fallbackResults.results
          .flatMap((result) =>
            result.status === 'fulfilled' ? result.value.releaseGroups : []
          )
          .forEach((album) => {
            const albumId = getMusicBrainzIdKey(album.id);

            if (!albumId) {
              return;
            }

            const existingAlbum = fallbackAlbumsById.get(albumId);

            fallbackAlbumsById.set(
              albumId,
              existingAlbum
                ? mergeMusicAlbumMetadata(existingAlbum, album)
                : album
            );
          });

        const fallbackAlbums = diversifyMusicAlbumsByArtist(
          shuffleRankedWindow(
            rankByQualityScore(
              [...fallbackAlbumsById.values()].sort(
                (a, b) => scoreMusicAlbum(b) - scoreMusicAlbum(a)
              ),
              scoreMusicAlbum,
              0.08,
              4,
              shuffleSeed
            ),
            shuffleSeed
          ),
          providerWindow.sliceEnd
        ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);

        if (!fallbackAlbums.length) {
          return res.status(200).json(emptyDiscoverResponse(page));
        }

        const fallbackRelatedMediaMap = await getRelatedMusicMediaMap(
          fallbackAlbums.map((album) => album.id),
          req.user
        );

        return res.status(200).json({
          page,
          totalPages: fallbackAlbums.length === itemsPerPage ? page + 1 : 1,
          totalResults: getUnknownTotalResults(
            page,
            fallbackAlbums.length,
            itemsPerPage
          ),
          results: fallbackAlbums.map((album) =>
            mapAlbumResult(
              album,
              getRelatedMusicMedia(fallbackRelatedMediaMap, album.id)
            )
          ),
        });
      }

      if (topAlbumsResult?.status === 'rejected') {
        logger.warn('Music chart discovery failed during ranked blend', {
          label: 'Discover Music',
          ...getErrorLogFields(topAlbumsResult.reason),
          requestQuery: getDiscoverLogQuery(req.query),
        });
      }

      if (freshReleasesResult?.status === 'rejected') {
        logger.warn('Fresh music discovery failed during ranked blend', {
          label: 'Discover Music',
          ...getErrorLogFields(freshReleasesResult.reason),
          requestQuery: getDiscoverLogQuery(req.query),
        });
      }

      const albumsById = new Map<string, MbAlbumResult>();

      [
        ...topAlbums.map(mapTopAlbumRelease),
        ...freshReleases
          .filter(
            (release) => release.release_group_mbid && release.release_name
          )
          .map(mapFreshReleaseAlbum),
      ].forEach((album) => {
        const albumId = getMusicBrainzIdKey(album.id);

        if (!albumId) {
          return;
        }

        const existingAlbum = albumsById.get(albumId);

        albumsById.set(
          albumId,
          existingAlbum ? mergeMusicAlbumMetadata(existingAlbum, album) : album
        );
      });

      const albums = diversifyMusicAlbumsByArtist(
        shuffleRankedWindow(
          rankByQualityScore(
            [...albumsById.values()].sort(
              (a, b) => scoreMusicAlbum(b) - scoreMusicAlbum(a)
            ),
            scoreMusicAlbum,
            0.08,
            4,
            shuffleSeed
          ),
          shuffleSeed
        ),
        providerWindow.sliceEnd
      ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : 1,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapAlbumResult(album, getRelatedMusicMedia(relatedMediaMap, album.id))
        ),
      });
    }

    let freshReleases;
    try {
      freshReleases = await listenBrainz.getFreshReleases({
        days,
        sort: 'release_date',
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
    } catch (e) {
      if (days <= 7) {
        throw e;
      }

      logger.warn('Music discovery failed, retrying with a shorter window', {
        label: 'Discover Music',
        days,
        ...getErrorLogFields(e),
        requestQuery: getDiscoverLogQuery(req.query),
      });
      freshReleases = await listenBrainz.getFreshReleases({
        days: 7,
        sort: 'release_date',
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
    }
    const sortedReleases = dedupeFreshReleases(
      freshReleases.payload.releases
        .filter((release) => release.release_group_mbid && release.release_name)
        .filter(
          (release) =>
            !releaseTypeFilter.length ||
            releaseTypeFilter.includes(
              release.release_group_primary_type ?? 'Album'
            )
        )
    ).sort((a, b) => {
      if (sortByValue === 'ranked') {
        return scoreMusicRelease(b) - scoreMusicRelease(a);
      }

      if (sortByValue === 'listen_count.desc') {
        return (b.listen_count ?? 0) - (a.listen_count ?? 0);
      }

      const left = a.release_date ?? '';
      const right = b.release_date ?? '';
      return sortAscending
        ? left.localeCompare(right)
        : right.localeCompare(left);
    });
    const releases =
      sortByValue === 'ranked'
        ? diversifyMusicAlbumsByArtist(
            shuffleRankedWindow(
              rankByQualityScore(
                sortedReleases.map(mapFreshReleaseAlbum),
                scoreMusicAlbum,
                0.08,
                4,
                shuffleSeed
              ),
              shuffleSeed
            ),
            providerWindow.sliceEnd
          )
            .slice(providerWindow.sliceStart, providerWindow.sliceEnd)
            .map((album) => {
              const release = sortedReleases.find(
                (sortedRelease) =>
                  getMusicBrainzIdKey(sortedRelease.release_group_mbid) ===
                  getMusicBrainzIdKey(album.id)
              );

              return release;
            })
            .filter((release): release is LbRelease => !!release)
        : sortedReleases.slice(
            providerWindow.sliceStart,
            providerWindow.sliceEnd
          );
    const relatedMediaMap = await getRelatedMusicMediaMap(
      releases.map((release) => release.release_group_mbid),
      req.user
    );

    const results = releases.map((release) =>
      mapAlbumResult(
        {
          ...mapFreshReleaseAlbum(release),
          score:
            sortByValue === 'ranked'
              ? scoreMusicRelease(release)
              : (release.listen_count ?? 0),
        },
        getRelatedMusicMedia(relatedMediaMap, release.release_group_mbid)
      )
    );

    return res.status(200).json({
      page,
      totalPages: releases.length === itemsPerPage ? page + 1 : page,
      totalResults: getUnknownTotalResults(page, releases.length, itemsPerPage),
      results,
    });
  } catch (e) {
    logger.error('Failed to fetch music discovery results', {
      label: 'Discover Music',
      ...getErrorLogFields(e),
      requestQuery: getDiscoverLogQuery(req.query),
    });
    return res.status(200).json(emptyDiscoverResponse(page));
  }
});

discoverRoutes.get('/books', async (req, res) => {
  const openLibrary = new OpenLibraryAPI();
  const itemsPerPage = 20;
  const page = parsePositiveInt(req.query.page, 1, 500);
  const sortByValue = getValidatedSort(req.query.sortBy, bookSortOptions);
  const parsedFormat = req.query.format
    ? parseOptionalAllowedString(req.query.format, {
        fieldName: 'Format',
        allowedValues: ['ebook', 'audiobook'] as const,
        maxLength: 16,
      })
    : ({ value: undefined } as { value?: 'ebook' | 'audiobook' });
  const parsedSubject = parseOptionalDiscoverString(
    req.query.subject,
    'Subject',
    MAX_DISCOVER_FILTER_LENGTH
  );
  const parsedSearchQuery = parseOptionalDiscoverString(
    req.query.query,
    'Query'
  );
  const parsedShuffleSeed = parseOptionalDiscoverString(
    req.query.shuffleSeed,
    'Shuffle seed',
    128
  );

  if ('error' in parsedFormat) {
    return res.status(400).json({ status: 400, message: parsedFormat.error });
  }
  if ('error' in parsedSubject) {
    return res.status(400).json({ status: 400, message: parsedSubject.error });
  }
  if ('error' in parsedSearchQuery) {
    return res
      .status(400)
      .json({ status: 400, message: parsedSearchQuery.error });
  }
  if ('error' in parsedShuffleSeed) {
    return res
      .status(400)
      .json({ status: 400, message: parsedShuffleSeed.error });
  }

  const subjectQuery = parsedSubject.value ?? '';
  const hasSubjectFilter = !!subjectQuery;
  const subject = hasSubjectFilter ? subjectQuery : 'fiction';
  const searchQuery = parsedSearchQuery.value ?? '';
  const shuffleSeed = parsedShuffleSeed.value;
  const hasSearchQuery = !!searchQuery;
  const query = hasSearchQuery ? searchQuery : `subject:${subject}`;

  try {
    const openLibrarySort =
      sortByValue === 'newest'
        ? 'new'
        : sortByValue === 'oldest'
          ? 'old'
          : sortByValue === 'random'
            ? 'random'
            : sortByValue === 'rating'
              ? 'rating'
              : sortByValue === 'editions'
                ? 'editions'
                : undefined;
    const shouldBlendDefaultSubjects =
      !hasSearchQuery && !hasSubjectFilter && sortByValue === 'ranked';
    const books = shouldBlendDefaultSubjects
      ? await settlePromisesWithin(
          rotateItems(
            defaultBookDiscoverySubjects,
            getDailyRotationOffset(defaultBookDiscoverySubjects.length)
          )
            .slice(0, DEFAULT_BOOK_DISCOVERY_SUBJECT_LIMIT)
            .map((defaultSubject) =>
              openLibrary.searchBooks({
                query: `subject:${defaultSubject}`,
                page,
                limit: itemsPerPage,
              })
            ),
          BOOK_DISCOVERY_BLEND_TIMEOUT_MS
        ).then(({ results, timedOut }) => {
          const responses = results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : []
          );

          if (timedOut) {
            logger.warn('Book discovery blend timed out', {
              label: 'Discover Books',
              completedSubjects: responses.length,
              requestQuery: getDiscoverLogQuery(req.query),
            });
          }

          if (!responses.length) {
            throw new Error('No book discovery subjects were available');
          }

          const rejectedCount = results.filter(
            (result) => result.status === 'rejected'
          ).length;

          if (rejectedCount > 0) {
            logger.warn('Some book discovery subjects failed during blend', {
              label: 'Discover Books',
              failedSubjects: rejectedCount,
              requestQuery: getDiscoverLogQuery(req.query),
            });
          }

          const docsByKey = new Map<string, OpenLibrarySearchDoc>();

          responses
            .flatMap((response) => response.docs)
            .forEach((doc) => {
              const existingDoc = docsByKey.get(doc.key);

              if (
                !existingDoc ||
                scoreBookDoc(doc) > scoreBookDoc(existingDoc)
              ) {
                docsByKey.set(doc.key, doc);
              }
            });

          return {
            numFound: responses.reduce(
              (total, response) => total + response.numFound,
              0
            ),
            start: 0,
            docs: diversifyBookDocsByAuthor(
              shuffleRankedWindow(
                rankByQualityScore(
                  [...docsByKey.values()].sort(
                    (a, b) => scoreBookDoc(b) - scoreBookDoc(a)
                  ),
                  scoreBookDoc,
                  0.08,
                  4,
                  shuffleSeed
                ),
                shuffleSeed
              ),
              itemsPerPage
            ),
          };
        })
      : await settlePromisesWithin(
          [
            openLibrary.searchBooks({
              query,
              page,
              limit: itemsPerPage,
              sort: openLibrarySort,
            }),
          ],
          OPENLIBRARY_SINGLE_REQUEST_TIMEOUT_MS
        ).then(({ results, timedOut }) => {
          if (timedOut) {
            logger.warn('Book discovery request timed out', {
              label: 'Discover Books',
              requestQuery: getDiscoverLogQuery(req.query),
            });
          }

          const result = results[0];
          if (!result) {
            throw new Error('Open Library book discovery request timed out.');
          }
          if (result.status === 'rejected') {
            throw result.reason;
          }

          return result.value;
        });
    const dedupedDocs = dedupeBookDocs(books.docs);
    const sortedDocs =
      sortByValue === 'ranked' && !shouldBlendDefaultSubjects
        ? shuffleRankedWindow(
            rankByQualityScore(
              [...dedupedDocs].sort(
                (a, b) => scoreBookDoc(b) - scoreBookDoc(a)
              ),
              scoreBookDoc,
              0.08,
              4,
              shuffleSeed
            ),
            shuffleSeed
          )
        : dedupedDocs;
    const ids = sortedDocs.map((doc) => normalizeOpenLibraryWorkId(doc.key));
    const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(
      ids,
      req.user
    );

    return res.status(200).json({
      page,
      totalPages: Math.max(Math.ceil(books.numFound / itemsPerPage), 1),
      totalResults: books.numFound,
      results: sortedDocs.map((doc) => ({
        ...mapOpenLibrarySearchDoc(
          doc,
          mediaByOpenLibraryId.get(normalizeOpenLibraryWorkId(doc.key))
        ),
        score: scoreBookDoc(doc),
      })),
    });
  } catch (e) {
    logger.error('Failed to fetch book discovery results', {
      label: 'Discover Books',
      ...getErrorLogFields(e),
      requestQuery: getDiscoverLogQuery(req.query),
    });
    return res.status(200).json(emptyDiscoverResponse(page));
  }
});

discoverRoutes.get<Record<string, unknown>, WatchlistResponse>(
  '/watchlist',
  async (req, res) => {
    const userRepository = getRepository(User);
    const itemsPerPage = 20;
    const page = parsePositiveInt(req.query.page, 1, 500);

    try {
      return await runUserSecurityMutation(req.user!.id, async () => {
        const activeUser = await userRepository.findOne({
          where: { id: req.user!.id },
          select: ['id', 'plexToken', 'passwordChangedAt'],
        });
        if (
          !activeUser ||
          (req.session?.userId === activeUser.id &&
            !isUserSessionCredentialVersionCurrent(
              activeUser,
              req.session.credentialVersion
            ))
        ) {
          throw new UserMutationActorUnauthorizedError();
        }

        return res.json(
          await getCombinedWatchlist({
            userId: activeUser.id,
            plexToken: activeUser.plexToken,
            page,
            itemsPerPage,
          })
        );
      });
    } catch (error) {
      if (error instanceof UserMutationActorUnauthorizedError) {
        return res.status(403).json({
          page: 1,
          totalPages: 1,
          totalResults: 0,
          results: [],
        });
      }
      throw error;
    }
  }
);

export default discoverRoutes;
