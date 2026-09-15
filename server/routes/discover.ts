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
import RadarrAPI, { type RadarrMovie } from '@server/api/servarr/radarr';
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
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type MediaEntity from '@server/entity/Media';
import Media from '@server/entity/Media';
import { MediaSearchMetadata } from '@server/entity/MediaSearchMetadata';
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
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { extractImageCacheUrls } from '@server/lib/imageCacheUrls';
import { enqueueImageCacheWarm } from '@server/lib/imageCacheWarmer';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import {
  getAvailableMusicQualities,
  getMusicQualityStatuses,
} from '@server/lib/musicQualityAvailability';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import type { RadarrSettings } from '@server/lib/settings';
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
  type AlbumResult,
} from '@server/models/Search';
import { mapNetwork } from '@server/models/Tv';
import {
  mapWithConcurrency,
  settlePromisesWithin,
} from '@server/utils/concurrency';
import { parsePositiveInt } from '@server/utils/pagination';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  matchesAllSearchTerms,
  toBooleanAndQuery,
  toFieldedBooleanAndQuery,
} from '@server/utils/searchTerms';
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
  search: query.search,
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

const mapDiscoverAlbumResult = (
  album: MbAlbumResult,
  relatedMediaMap: Map<string, MediaEntity>
) => {
  const media = getRelatedMusicMedia(relatedMediaMap, album.id);
  const services = getSettings().lidarr;
  const availableQualities = getAvailableMusicQualities(
    media,
    media?.requests ?? [],
    services
  );

  return {
    ...mapAlbumResult(album, media),
    availableQualities,
    qualityStatuses: getMusicQualityStatuses(
      media,
      media?.requests ?? [],
      services
    ),
  };
};

const normalizeLocalAlbumType = (
  value?: string | null
): AlbumResult['primary-type'] => {
  const normalized = value?.trim().toLocaleLowerCase();

  if (normalized === 'single') {
    return 'Single';
  }
  if (normalized === 'ep') {
    return 'EP';
  }

  return 'Album';
};

const getLocalAvailableMusic = async ({
  availability,
  page,
  itemsPerPage,
  query,
  genreFilter,
  releaseTypeFilter,
  releaseDateGte,
  releaseDateLte,
  sortByValue,
  user,
}: {
  availability: 'mp3' | 'flac';
  page: number;
  itemsPerPage: number;
  query: string;
  genreFilter: string[];
  releaseTypeFilter: string[];
  releaseDateGte?: string;
  releaseDateLte?: string;
  sortByValue: string;
  user?: User;
}) => {
  const media = await getRepository(Media).find({
    where: { mediaType: MediaType.MUSIC },
  });
  await hydrateMediaSummaryRelations(media, user);

  const metadata = media.length
    ? await getRepository(MediaSearchMetadata).find({
        where: { mediaId: In(media.map((item) => item.id)) },
      })
    : [];
  const metadataByMediaId = new Map(
    metadata.map((item) => [item.mediaId, item])
  );
  const settings = getSettings();
  const requestedQuality = availability.toLocaleUpperCase();
  const sortAscending = sortByValue.endsWith('.asc');
  const sortByBase = sortByValue.replace(/\.(?:asc|desc)$/, '');

  const matches = media
    .map((item) => {
      const searchMetadata = metadataByMediaId.get(item.id);
      const availableQualities = getAvailableMusicQualities(
        item,
        item.requests ?? [],
        settings.lidarr
      );
      const genres = (searchMetadata?.genres ?? '')
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean);
      const releaseDate = searchMetadata?.releaseDate ?? '';
      const albumType = normalizeLocalAlbumType(searchMetadata?.albumType);

      return {
        item,
        searchMetadata,
        availableQualities,
        genres,
        releaseDate,
        albumType,
      };
    })
    .filter(
      ({
        searchMetadata,
        availableQualities,
        genres,
        releaseDate,
        albumType,
      }) =>
        Boolean(searchMetadata?.title) &&
        availableQualities.includes(requestedQuality as 'MP3' | 'FLAC') &&
        (!query ||
          matchesAllSearchTerms(
            [searchMetadata?.title, searchMetadata?.artist, ...genres],
            query
          )) &&
        (!releaseTypeFilter.length ||
          releaseTypeFilter.some(
            (type) => type.toLocaleLowerCase() === albumType.toLocaleLowerCase()
          )) &&
        (!genreFilter.length ||
          genreFilter.some((filterGenre) =>
            genres.some(
              (genre) =>
                genre.toLocaleLowerCase() === filterGenre.toLocaleLowerCase()
            )
          )) &&
        (!releaseDateGte || releaseDate >= releaseDateGte) &&
        (!releaseDateLte || releaseDate <= releaseDateLte)
    )
    .sort((left, right) => {
      if (sortByBase === 'release_date') {
        const comparison = left.releaseDate.localeCompare(right.releaseDate);
        return sortAscending ? comparison : -comparison;
      }

      const leftAdded =
        left.item.mediaAddedAt?.getTime() ?? left.item.updatedAt.getTime();
      const rightAdded =
        right.item.mediaAddedAt?.getTime() ?? right.item.updatedAt.getTime();
      const comparison =
        rightAdded - leftAdded ||
        (left.searchMetadata?.title ?? '').localeCompare(
          right.searchMetadata?.title ?? ''
        );

      return sortAscending ? -comparison : comparison;
    });

  const offset = (page - 1) * itemsPerPage;
  const pagedMatches = matches.slice(offset, offset + itemsPerPage);

  return {
    page,
    totalPages: Math.max(1, Math.ceil(matches.length / itemsPerPage)),
    totalResults: matches.length,
    results: pagedMatches.map(
      ({
        item,
        searchMetadata,
        availableQualities,
        releaseDate,
        albumType,
      }) => ({
        ...mapAlbumResult(
          {
            id: item.mbId as string,
            score: 0,
            media_type: 'album',
            title: searchMetadata?.title as string,
            'primary-type': albumType,
            'first-release-date': releaseDate,
            posterPath: `https://coverartarchive.org/release-group/${encodeURIComponent(
              item.mbId as string
            )}/front-250`,
            'artist-credit': searchMetadata?.artist
              ? [
                  {
                    name: searchMetadata.artist,
                    artist: {
                      id: '',
                      name: searchMetadata.artist,
                      'sort-name': searchMetadata.artist,
                    },
                  },
                ]
              : [],
          },
          item
        ),
        availableQualities,
        qualityStatuses: getMusicQualityStatuses(
          item,
          item.requests ?? [],
          settings.lidarr
        ),
      })
    ),
  };
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

// Open Library requests can legitimately take up to
// DEFAULT_EXTERNAL_API_TIMEOUT_MS to complete. These race timeouts must stay
// above that, or they cut off in-flight requests before the HTTP client
// itself would give up, turning a slow-but-working provider into a hard
// failure (see: books discovery going empty under provider latency).
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
  'ranked.asc',
  'popular.week',
  'popular.week.asc',
  'popular.month',
  'popular.month.asc',
  'popular.year',
  'popular.year.asc',
  'listen_count.desc',
  'listen_count.asc',
  'release_date.desc',
  'release_date.asc',
]);

const bookSortOptions = new Set([
  'ranked',
  'ranked.asc',
  'newest',
  'oldest',
  'random',
  'rating',
  'rating.desc',
  'rating.asc',
  'editions',
  'editions.asc',
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
  search: optionalTmdbQueryString(),
  availability: z.enum(['hd', '4k']).optional(),
  primaryReleaseDateGte: optionalTmdbDateString,
  primaryReleaseDateLte: optionalTmdbDateString,
  firstAirDateGte: optionalTmdbDateString,
  firstAirDateLte: optionalTmdbDateString,
  studio: optionalTmdbQueryString(),
  country: optionalTmdbQueryString(16),
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
const AVAILABLE_MEDIA_STATUSES = [
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.AVAILABLE,
];

const splitNumericFilter = (value?: string): number[] =>
  value
    ? value
        .split(/[|,]/)
        .map(Number)
        .filter((item) => Number.isSafeInteger(item))
    : [];

const LOCAL_MOVIE_GENRES = new Map([
  [28, 'Action'],
  [12, 'Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [14, 'Fantasy'],
  [36, 'History'],
  [27, 'Horror'],
  [10402, 'Music'],
  [9648, 'Mystery'],
  [10749, 'Romance'],
  [878, 'Science Fiction'],
  [10770, 'TV Movie'],
  [53, 'Thriller'],
  [10752, 'War'],
  [37, 'Western'],
]);
const LOCAL_TV_GENRES = new Map([
  [10759, 'Action & Adventure'],
  [16, 'Animation'],
  [35, 'Comedy'],
  [80, 'Crime'],
  [99, 'Documentary'],
  [18, 'Drama'],
  [10751, 'Family'],
  [10762, 'Kids'],
  [9648, 'Mystery'],
  [10763, 'News'],
  [10764, 'Reality'],
  [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'],
  [10767, 'Talk'],
  [10768, 'War & Politics'],
  [37, 'Western'],
]);

const getLocalVideoGenreIds = (
  mediaType: MediaType.MOVIE | MediaType.TV,
  genres: string[]
): number[] => {
  const normalizedGenres = new Set(genres.map(normalizeDiscoverTitle));
  const genreMap =
    mediaType === MediaType.MOVIE ? LOCAL_MOVIE_GENRES : LOCAL_TV_GENRES;

  return [...genreMap.entries()]
    .filter(([, name]) => normalizedGenres.has(normalizeDiscoverTitle(name)))
    .map(([id]) => id);
};

const parseLocalRuntime = (runtime?: string | null): number | undefined => {
  const value = runtime?.match(/\d+(?:\.\d+)?/)?.[0];
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

type LiveRadarrMovie = {
  movie: RadarrMovie;
  server: RadarrSettings;
};

type LiveRadarrMovieAvailability = {
  hd: Map<number, LiveRadarrMovie>;
  isHdAuthoritative: boolean;
  is4k: Map<number, LiveRadarrMovie>;
  is4kAuthoritative: boolean;
};

const getLiveRadarrMovieAvailability =
  async (): Promise<LiveRadarrMovieAvailability> => {
    const servers = getExternalRuntimeConfig().radarr.filter(
      (server) => server.syncEnabled
    );
    const hdServers = servers.filter((server) => !server.is4k);
    const servers4k = servers.filter((server) => server.is4k);
    const result: LiveRadarrMovieAvailability = {
      hd: new Map(),
      isHdAuthoritative: hdServers.length > 0,
      is4k: new Map(),
      is4kAuthoritative: servers4k.length > 0,
    };

    await Promise.all(
      servers.map(async (server) => {
        const movies = await runWithServarrServiceSnapshot(
          'radarr',
          server,
          async (current) =>
            new RadarrAPI({
              apiKey: current.apiKey,
              url: RadarrAPI.buildUrl(current, '/api/v3'),
            }).getMovies()
        );
        const destination = server.is4k ? result.is4k : result.hd;

        for (const movie of movies) {
          if (movie.hasFile && !destination.has(movie.tmdbId)) {
            destination.set(movie.tmdbId, { movie, server });
          }
        }
      })
    );

    return result;
  };

const clearStaleAvailableStatus = (
  status: MediaStatus | undefined
): MediaStatus =>
  status === MediaStatus.AVAILABLE || status === MediaStatus.PARTIALLY_AVAILABLE
    ? MediaStatus.UNKNOWN
    : (status ?? MediaStatus.UNKNOWN);

const getLiveAvailableMovieDiscoverResponse = async ({
  quality,
  page,
  query,
  user,
}: {
  quality: 'hd' | '4k';
  page: number;
  query: FilterOptions;
  user?: User;
}) => {
  const availability = await getLiveRadarrMovieAvailability();
  const isRequestedQualityAuthoritative =
    quality === '4k'
      ? availability.is4kAuthoritative
      : availability.isHdAuthoritative;

  if (!isRequestedQualityAuthoritative) {
    return undefined;
  }

  const requestedMovies =
    quality === '4k' ? availability.is4k : availability.hd;
  const requestedGenreIds = splitNumericFilter(query.genre);

  const movies = [...requestedMovies.values()]
    .map(({ movie, server }) => {
      const genreIds = getLocalVideoGenreIds(
        MediaType.MOVIE,
        movie.genres ?? []
      );
      const releaseDate = movie.year ? String(movie.year) : '';
      const runtime = movie.runtime;

      return {
        movie,
        server,
        genreIds,
        releaseDate,
        runtime,
      };
    })
    .filter(
      ({ movie, genreIds, releaseDate, runtime }) =>
        (!query.search ||
          matchesAllSearchTerms(
            [movie.title, movie.originalTitle, movie.overview],
            query.search
          )) &&
        (!requestedGenreIds.length ||
          requestedGenreIds.every((genreId) => genreIds.includes(genreId))) &&
        (!query.primaryReleaseDateGte ||
          releaseDate >= query.primaryReleaseDateGte) &&
        (!query.primaryReleaseDateLte ||
          releaseDate <= query.primaryReleaseDateLte) &&
        (!query.withRuntimeGte ||
          (runtime ?? 0) >= Number(query.withRuntimeGte)) &&
        (!query.withRuntimeLte ||
          (runtime ?? Number.POSITIVE_INFINITY) <= Number(query.withRuntimeLte))
    )
    .sort((left, right) => {
      const sortOption = getValidatedTmdbSort(query.sortBy);
      const ascending = sortOption.endsWith('.asc');
      const direction = ascending ? 1 : -1;

      if (
        sortOption.startsWith('release_date') ||
        sortOption.startsWith('primary_release_date')
      ) {
        return left.releaseDate.localeCompare(right.releaseDate) * direction;
      }
      if (sortOption.startsWith('original_title')) {
        return (
          (left.movie.originalTitle || left.movie.title).localeCompare(
            right.movie.originalTitle || right.movie.title
          ) * direction
        );
      }
      if (sortOption.startsWith('vote_average')) {
        return (
          ((left.movie.ratings?.value ?? 0) -
            (right.movie.ratings?.value ?? 0)) *
          direction
        );
      }

      return left.movie.title.localeCompare(right.movie.title);
    });

  const itemsPerPage = 20;
  const pageStart = (page - 1) * itemsPerPage;
  const pageItems = movies.slice(pageStart, pageStart + itemsPerPage);
  const pageTmdbIds = pageItems.map(({ movie }) => movie.tmdbId);
  const persistedMedia = pageTmdbIds.length
    ? await getRepository(Media).find({
        where: { mediaType: MediaType.MOVIE, tmdbId: In(pageTmdbIds) },
      })
    : [];
  await hydrateMediaSummaryRelations(persistedMedia, user);
  const mediaByTmdbId = new Map(
    persistedMedia.map((media) => [media.tmdbId, media])
  );

  return {
    page,
    totalPages: Math.max(1, Math.ceil(movies.length / itemsPerPage)),
    totalResults: movies.length,
    results: pageItems.map(({ movie, server, genreIds, releaseDate }) => {
      const persisted = mediaByTmdbId.get(movie.tmdbId);
      const hdMovie = availability.hd.get(movie.tmdbId);
      const movie4k = availability.is4k.get(movie.tmdbId);
      const media = new Media({
        ...persisted,
        mediaType: MediaType.MOVIE,
        tmdbId: movie.tmdbId,
        status: availability.isHdAuthoritative
          ? hdMovie
            ? MediaStatus.AVAILABLE
            : clearStaleAvailableStatus(persisted?.status)
          : (persisted?.status ?? MediaStatus.UNKNOWN),
        status4k: availability.is4kAuthoritative
          ? movie4k
            ? MediaStatus.AVAILABLE
            : clearStaleAvailableStatus(persisted?.status4k)
          : (persisted?.status4k ?? MediaStatus.UNKNOWN),
        serviceId: hdMovie?.server.id ?? persisted?.serviceId,
        externalServiceId: hdMovie?.movie.id ?? persisted?.externalServiceId,
        serviceId4k: movie4k?.server.id ?? persisted?.serviceId4k,
        externalServiceId4k:
          movie4k?.movie.id ?? persisted?.externalServiceId4k,
      });

      return mapMovieResult(
        {
          id: movie.tmdbId,
          media_type: 'movie',
          title: movie.title,
          original_title: movie.originalTitle || movie.title,
          release_date: releaseDate,
          adult: false,
          video: false,
          popularity: 0,
          poster_path: `/api/v1/movie/${movie.tmdbId}/cover?serviceId=${server.id}&externalServiceId=${movie.id}&is4k=${server.is4k}`,
          backdrop_path: undefined,
          vote_count: movie.ratings?.votes ?? 0,
          vote_average: movie.ratings?.value ?? 0,
          genre_ids: genreIds,
          overview: movie.overview ?? '',
          original_language: '',
        },
        media
      );
    }),
  };
};

const getLocalAvailableVideoDiscoverResponse = async ({
  mediaType,
  quality,
  page,
  query,
  user,
}: {
  mediaType: MediaType.MOVIE | MediaType.TV;
  quality: 'hd' | '4k';
  page: number;
  query: FilterOptions;
  user?: User;
}) => {
  if (mediaType === MediaType.MOVIE) {
    try {
      const liveResponse = await getLiveAvailableMovieDiscoverResponse({
        quality,
        page,
        query,
        user,
      });
      if (liveResponse) {
        return liveResponse;
      }
    } catch (e) {
      logger.warn(
        'Unable to retrieve live Radarr availability; using indexed movie availability',
        {
          label: 'API',
          quality,
          errorMessage: e.message,
        }
      );
    }
  }

  const statusField = quality === '4k' ? 'status4k' : 'status';
  const mediaItems = await getRepository(Media)
    .createQueryBuilder('media')
    .where('media.mediaType = :mediaType', { mediaType })
    .andWhere(`media.${statusField} IN (:...availableStatuses)`, {
      availableStatuses: AVAILABLE_MEDIA_STATUSES,
    })
    .orderBy('media.updatedAt', 'DESC')
    .getMany();
  await hydrateMediaSummaryRelations(mediaItems, user);

  const metadata = mediaItems.length
    ? await getRepository(MediaSearchMetadata).find({
        where: { mediaId: In(mediaItems.map((item) => item.id)) },
      })
    : [];
  const metadataByMediaId = new Map(
    metadata.map((item) => [item.mediaId, item])
  );
  const requestedGenreIds = splitNumericFilter(query.genre);

  const localItems = mediaItems
    .map((media) => {
      const itemMetadata = metadataByMediaId.get(media.id);
      const title =
        itemMetadata?.title ??
        media.externalServiceSlug?.replace(/[-_]+/g, ' ') ??
        `${mediaType === MediaType.MOVIE ? 'Movie' : 'Series'} ${media.tmdbId}`;
      const genres = (itemMetadata?.genres ?? '')
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean);
      const genreIds = getLocalVideoGenreIds(mediaType, genres);
      const releaseDate = itemMetadata?.releaseDate ?? '';
      const runtime = parseLocalRuntime(itemMetadata?.runtime);

      return {
        media,
        metadata: itemMetadata,
        title,
        genreIds,
        releaseDate,
        runtime,
      };
    })
    .filter(
      ({ metadata, title, genreIds, releaseDate, runtime }) =>
        (!query.search ||
          matchesAllSearchTerms(
            [title, metadata?.alternateTitle, metadata?.searchText],
            query.search
          )) &&
        (!requestedGenreIds.length ||
          requestedGenreIds.every((genreId) => genreIds.includes(genreId))) &&
        (!query.primaryReleaseDateGte ||
          releaseDate >= query.primaryReleaseDateGte) &&
        (!query.primaryReleaseDateLte ||
          releaseDate <= query.primaryReleaseDateLte) &&
        (!query.firstAirDateGte || releaseDate >= query.firstAirDateGte) &&
        (!query.firstAirDateLte || releaseDate <= query.firstAirDateLte) &&
        (!query.withRuntimeGte ||
          (runtime ?? 0) >= Number(query.withRuntimeGte)) &&
        (!query.withRuntimeLte ||
          (runtime ?? Number.POSITIVE_INFINITY) <= Number(query.withRuntimeLte))
    )
    .sort((left, right) => {
      const sortOption = getValidatedTmdbSort(query.sortBy);
      const ascending = sortOption.endsWith('.asc');
      const direction = ascending ? 1 : -1;

      if (
        sortOption.startsWith('release_date') ||
        sortOption.startsWith('primary_release_date') ||
        sortOption.startsWith('first_air_date')
      ) {
        return left.releaseDate.localeCompare(right.releaseDate) * direction;
      }
      if (sortOption.startsWith('original_title')) {
        return (
          (left.metadata?.alternateTitle ?? left.title).localeCompare(
            right.metadata?.alternateTitle ?? right.title
          ) * direction
        );
      }

      return right.media.updatedAt.getTime() - left.media.updatedAt.getTime();
    });

  const itemsPerPage = 20;
  const pageStart = (page - 1) * itemsPerPage;
  const pageItems = localItems.slice(pageStart, pageStart + itemsPerPage);

  return {
    page,
    totalPages: Math.max(1, Math.ceil(localItems.length / itemsPerPage)),
    totalResults: localItems.length,
    results: pageItems.map(
      ({ media, metadata: itemMetadata, title, genreIds, releaseDate }) => {
        const common = {
          id: media.tmdbId,
          popularity: 0,
          poster_path: `/api/v1/${
            mediaType === MediaType.MOVIE ? 'movie' : 'tv'
          }/${media.tmdbId}/cover?mediaId=${media.id}&is4k=${quality === '4k'}`,
          backdrop_path: undefined,
          vote_count: 0,
          vote_average: 0,
          genre_ids: genreIds,
          overview: '',
          original_language: '',
        };

        return mediaType === MediaType.MOVIE
          ? mapMovieResult(
              {
                ...common,
                media_type: 'movie',
                title,
                original_title: itemMetadata?.alternateTitle ?? title,
                release_date: releaseDate,
                adult: false,
                video: false,
              },
              media
            )
          : mapTvResult(
              {
                ...common,
                media_type: 'tv',
                name: title,
                original_name: itemMetadata?.alternateTitle ?? title,
                origin_country: [],
                first_air_date: releaseDate,
              },
              media
            );
      }
    ),
  };
};

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

    const page = parsePositiveInt(query.page, 1, 500);
    if (query.availability) {
      return res.status(200).json(
        await getLocalAvailableVideoDiscoverResponse({
          mediaType: MediaType.MOVIE,
          quality: query.availability,
          page,
          query,
          user: req.user,
        })
      );
    }
    const data = query.search
      ? await tmdb.searchMovies({
          query: query.search,
          page,
          language: req.locale ?? query.language,
        })
      : await tmdb.getDiscoverMovies({
          page,
          sortBy: getValidatedTmdbSort(query.sortBy),
          language: req.locale ?? query.language,
          originalLanguage: query.language,
          genre: query.genre,
          studio: query.studio,
          country: query.country,
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
    const providerResults =
      query.search || query.sortBy
        ? data.results
        : shuffleRankedWindow(
            rankTmdbMovieResults(data.results, parsedShuffleSeed.value),
            parsedShuffleSeed.value
          );
    const rankedResults = query.search
      ? providerResults.filter((result) =>
          matchesAllSearchTerms(
            [result.title, result.original_title],
            query.search ?? ''
          )
        )
      : providerResults;

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

    const page = parsePositiveInt(query.page, 1, 500);
    if (query.availability) {
      return res.status(200).json(
        await getLocalAvailableVideoDiscoverResponse({
          mediaType: MediaType.TV,
          quality: query.availability,
          page,
          query,
          user: req.user,
        })
      );
    }
    const data = query.search
      ? await tmdb.searchTvShows({
          query: query.search,
          page,
          language: req.locale ?? query.language,
        })
      : await tmdb.getDiscoverTv({
          page,
          sortBy: getValidatedTmdbSort(query.sortBy),
          language: req.locale ?? query.language,
          genre: query.genre,
          network,
          country: query.country,
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
    const providerResults =
      query.search || query.sortBy
        ? data.results
        : shuffleRankedWindow(
            rankTmdbTvResults(data.results, parsedShuffleSeed.value),
            parsedShuffleSeed.value
          );
    const rankedResults = query.search
      ? providerResults.filter((result) =>
          matchesAllSearchTerms(
            [result.name, result.original_name],
            query.search ?? ''
          )
        )
      : providerResults;

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
  const sortAscending = sortByValue.endsWith('.asc');
  const sortByBase = sortByValue.replace(/\.(?:asc|desc)$/, '');
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
  const parsedAvailability = parseOptionalAllowedString(
    req.query.availability,
    {
      fieldName: 'Availability',
      allowedValues: ['mp3', 'flac'] as const,
      maxLength: 4,
    }
  );
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
  if ('error' in parsedAvailability) {
    return res
      .status(400)
      .json({ status: 400, message: parsedAvailability.error });
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
  const providerSearchQuery = toBooleanAndQuery(query);
  const shuffleSeed = parsedShuffleSeed.value;
  const releaseDateGte = parsedReleaseDateGte.value;
  const releaseDateLte = parsedReleaseDateLte.value;

  try {
    if (parsedAvailability.value) {
      return res.status(200).json(
        await getLocalAvailableMusic({
          availability: parsedAvailability.value,
          page,
          itemsPerPage,
          query,
          genreFilter,
          releaseTypeFilter,
          releaseDateGte,
          releaseDateLte,
          sortByValue,
          user: req.user,
        })
      );
    }

    if (query) {
      const providerWindow = getProviderWindow(page, itemsPerPage);
      const albumWindow = await musicBrainz.searchAlbum({
        query: providerSearchQuery,
        limit: providerWindow.limit,
        offset: providerWindow.offset,
      });
      const filteredAlbums = albumWindow.filter((album) => {
        const releaseDate = album['first-release-date'] ?? '';
        const albumGenres = (album.tags ?? []).map((tag) =>
          tag.name.toLocaleLowerCase()
        );

        return (
          matchesAllSearchTerms(
            [
              album.title,
              ...album['artist-credit'].flatMap((credit) => [
                credit.name,
                credit.artist.name,
                credit.artist['sort-name'],
              ]),
              ...albumGenres,
            ],
            query
          ) &&
          (!releaseTypeFilter.length ||
            releaseTypeFilter.includes(album['primary-type'])) &&
          (!genreFilter.length ||
            genreFilter.some((genre) =>
              albumGenres.includes(genre.toLocaleLowerCase())
            )) &&
          (!releaseDateGte || releaseDate >= releaseDateGte) &&
          (!releaseDateLte || releaseDate <= releaseDateLte)
        );
      });
      const albums = dedupeMusicAlbums(
        filteredAlbums.slice(providerWindow.sliceStart, providerWindow.sliceEnd)
      ).sort((a, b) => {
        if (sortByBase === 'release_date') {
          const comparison = (a['first-release-date'] ?? '').localeCompare(
            b['first-release-date'] ?? ''
          );
          return sortAscending ? comparison : -comparison;
        }

        const comparison = scoreMusicAlbum(b) - scoreMusicAlbum(a);
        return sortAscending ? -comparison : comparison;
      });
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : page,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapDiscoverAlbumResult(album, relatedMediaMap)
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
        if (sortByBase === 'ranked') {
          return scoreMusicAlbum(b) - scoreMusicAlbum(a);
        }

        if (sortByBase === 'listen_count' || sortByBase.startsWith('popular')) {
          const comparison = (b.score ?? 0) - (a.score ?? 0);
          return sortAscending ? -comparison : comparison;
        }

        const left = a['first-release-date'] ?? '';
        const right = b['first-release-date'] ?? '';
        return sortAscending
          ? left.localeCompare(right)
          : right.localeCompare(left);
      });
      const albums =
        sortByBase === 'ranked'
          ? (() => {
              const rankedAlbums = diversifyMusicAlbumsByArtist(
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
              ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);

              return sortAscending ? rankedAlbums.reverse() : rankedAlbums;
            })()
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
          mapDiscoverAlbumResult(album, relatedMediaMap)
        ),
      });
    }

    const providerWindow = getProviderWindow(page, itemsPerPage);
    const hasReleaseDateFilter = Boolean(releaseDateGte || releaseDateLte);

    if (
      !genreFilter.length &&
      (sortByBase.startsWith('popular') || sortByBase === 'listen_count')
    ) {
      const range =
        sortByBase === 'listen_count'
          ? 'all_time'
          : sortByBase === 'popular.week'
            ? 'week'
            : sortByBase === 'popular.year'
              ? 'year'
              : 'month';
      const topAlbums = await listenBrainz.getTopAlbums({
        range,
        offset: providerWindow.offset,
        count: providerWindow.limit,
      });
      const chartAlbums = diversifyMusicAlbumsByArtist(
        dedupeMusicAlbums(
          topAlbums.payload.release_groups.map(mapTopAlbumRelease)
        ),
        providerWindow.sliceEnd
      ).slice(providerWindow.sliceStart, providerWindow.sliceEnd);
      const albums = sortAscending ? chartAlbums.reverse() : chartAlbums;
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
          mapDiscoverAlbumResult(album, relatedMediaMap)
        ),
      });
    }

    if (
      sortByBase === 'ranked' &&
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
        PromiseSettledResult<LbTopAlbumsResponse> | undefined;
      const freshReleasesResult = primaryResults.results[1] as
        PromiseSettledResult<LbFreshReleasesResponse> | undefined;
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

        const rankedFallbackAlbums = diversifyMusicAlbumsByArtist(
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
        const fallbackAlbums = sortAscending
          ? rankedFallbackAlbums.reverse()
          : rankedFallbackAlbums;

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
            mapDiscoverAlbumResult(album, fallbackRelatedMediaMap)
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

      const rankedAlbums = diversifyMusicAlbumsByArtist(
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
      const albums = sortAscending ? rankedAlbums.reverse() : rankedAlbums;
      const relatedMediaMap = await getRelatedMusicMediaMap(
        albums.map((album) => album.id),
        req.user
      );

      return res.status(200).json({
        page,
        totalPages: albums.length === itemsPerPage ? page + 1 : 1,
        totalResults: getUnknownTotalResults(page, albums.length, itemsPerPage),
        results: albums.map((album) =>
          mapDiscoverAlbumResult(album, relatedMediaMap)
        ),
      });
    }

    let freshReleases;
    try {
      freshReleases = await listenBrainz.getFreshReleases({
        days,
        sort: 'release_date',
        order: sortByBase === 'release_date' && !sortAscending ? 'desc' : 'asc',
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
        order: sortByBase === 'release_date' && !sortAscending ? 'desc' : 'asc',
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
      if (sortByBase === 'ranked') {
        const comparison = scoreMusicRelease(b) - scoreMusicRelease(a);
        return sortAscending ? -comparison : comparison;
      }

      if (sortByBase === 'listen_count' || sortByBase.startsWith('popular')) {
        const comparison = (b.listen_count ?? 0) - (a.listen_count ?? 0);
        return sortAscending ? -comparison : comparison;
      }

      const left = a.release_date ?? '';
      const right = b.release_date ?? '';
      return sortAscending
        ? left.localeCompare(right)
        : right.localeCompare(left);
    });
    const releases =
      sortByBase === 'ranked'
        ? (() => {
            const rankedReleases = diversifyMusicAlbumsByArtist(
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
              .filter((release): release is LbRelease => !!release);

            return sortAscending ? rankedReleases.reverse() : rankedReleases;
          })()
        : sortedReleases.slice(
            providerWindow.sliceStart,
            providerWindow.sliceEnd
          );
    const relatedMediaMap = await getRelatedMusicMediaMap(
      releases.map((release) => release.release_group_mbid),
      req.user
    );

    const results = releases.map((release) =>
      mapDiscoverAlbumResult(
        {
          ...mapFreshReleaseAlbum(release),
          score:
            sortByBase === 'ranked'
              ? scoreMusicRelease(release)
              : (release.listen_count ?? 0),
        },
        relatedMediaMap
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
  const itemsPerPage = 50;
  const page = parsePositiveInt(req.query.page, 1, 500);
  const requestedSortBy =
    typeof req.query.sortBy === 'string' &&
    bookSortOptions.has(req.query.sortBy)
      ? req.query.sortBy
      : undefined;
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
  const parsedFirstPublishYear = parseOptionalDiscoverString(
    req.query.firstPublishYear,
    'First publish year',
    16
  );
  const parsedLanguage = parseOptionalDiscoverString(
    req.query.language,
    'Language',
    3
  );
  const parsedMinRating = parseOptionalDiscoverString(
    req.query.minRating,
    'Minimum rating',
    3
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
  if ('error' in parsedFirstPublishYear) {
    return res
      .status(400)
      .json({ status: 400, message: parsedFirstPublishYear.error });
  }
  if ('error' in parsedLanguage) {
    return res.status(400).json({ status: 400, message: parsedLanguage.error });
  }
  if ('error' in parsedMinRating) {
    return res
      .status(400)
      .json({ status: 400, message: parsedMinRating.error });
  }
  if ('error' in parsedShuffleSeed) {
    return res
      .status(400)
      .json({ status: 400, message: parsedShuffleSeed.error });
  }

  const rawSearchQuery = parsedSearchQuery.value ?? '';
  const legacySubjectQuery = rawSearchQuery
    .match(/^subject:(.+)$/i)?.[1]
    ?.trim();
  const subjectQuery = parsedSubject.value ?? legacySubjectQuery ?? '';
  const hasSubjectFilter = !!subjectQuery;
  const searchQuery = legacySubjectQuery ? '' : rawSearchQuery;
  const firstPublishYear = parsedFirstPublishYear.value ?? '';
  const language = parsedLanguage.value ?? '';
  const parsedRatingNumber = parsedMinRating.value
    ? Number(parsedMinRating.value)
    : undefined;

  if (
    firstPublishYear &&
    firstPublishYear !== 'before-1970' &&
    !/^\d{4}$/.test(firstPublishYear)
  ) {
    return res.status(400).json({
      status: 400,
      message: 'First publish year must be a four-digit year or before-1970.',
    });
  }
  if (language && !/^[a-z]{3}$/.test(language)) {
    return res.status(400).json({
      status: 400,
      message: 'Language must be a three-letter ISO 639 code.',
    });
  }
  if (
    parsedRatingNumber !== undefined &&
    (!Number.isFinite(parsedRatingNumber) ||
      parsedRatingNumber < 1 ||
      parsedRatingNumber > 5 ||
      parsedRatingNumber * 2 !== Math.round(parsedRatingNumber * 2))
  ) {
    return res.status(400).json({
      status: 400,
      message: 'Minimum rating must be between 1 and 5 in half-star steps.',
    });
  }
  const shuffleSeed = parsedShuffleSeed.value;
  const hasSearchQuery = !!searchQuery;
  const sortByValue = requestedSortBy ?? (hasSearchQuery ? 'newest' : 'ranked');
  const sortAscending = sortByValue.endsWith('.asc');
  const sortByBase = sortByValue.replace(/\.(?:asc|desc)$/, '');
  const bookDiscoveryContext = {
    format:
      parsedFormat.value === 'audiobook'
        ? 'audiobook'
        : parsedFormat.value === 'ebook'
          ? 'book'
          : 'all',
    keyword: searchQuery || undefined,
    page,
    pageSize: itemsPerPage,
    sort: sortByValue,
    genre: subjectQuery || undefined,
    firstPublishYear: firstPublishYear || undefined,
    language: language || undefined,
    minRating: parsedRatingNumber,
  };
  const queryParts = [
    hasSearchQuery
      ? toFieldedBooleanAndQuery(searchQuery, ['title', 'author'])
      : hasSubjectFilter
        ? `subject:${subjectQuery}`
        : '*:*',
  ];

  if (hasSearchQuery && hasSubjectFilter) {
    queryParts.push(`subject:${subjectQuery}`);
  }
  if (language) {
    queryParts.push(`language:${language}`);
  }
  if (firstPublishYear && firstPublishYear !== 'before-1970') {
    queryParts.push(`first_publish_year:${firstPublishYear}`);
  }

  const query = queryParts.join(' AND ');
  const needsLocalFiltering =
    hasSearchQuery ||
    parsedRatingNumber !== undefined ||
    firstPublishYear === 'before-1970';
  const providerWindow = needsLocalFiltering
    ? getProviderWindow(page, itemsPerPage, itemsPerPage)
    : undefined;
  const providerPage = providerWindow
    ? Math.floor(providerWindow.offset / providerWindow.limit) + 1
    : page;
  const providerLimit = providerWindow?.limit ?? itemsPerPage;

  try {
    const openLibrarySort =
      sortByBase === 'ranked' && !hasSearchQuery && !hasSubjectFilter
        ? 'random'
        : sortByValue === 'newest'
          ? 'new'
          : sortByValue === 'oldest'
            ? 'old'
            : sortByValue === 'random'
              ? 'random'
              : sortByBase === 'rating'
                ? 'rating'
                : sortByBase === 'editions'
                  ? 'editions'
                  : undefined;
    const books = await settlePromisesWithin(
      [
        openLibrary.searchBooks({
          query,
          page: providerPage,
          limit: providerLimit,
          sort: openLibrarySort,
        }),
      ],
      OPENLIBRARY_SINGLE_REQUEST_TIMEOUT_MS
    ).then(({ results, timedOut }) => {
      if (timedOut) {
        throw new Error('Open Library book discovery request timed out.');
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
    if (query === '*:*' && books.numFound === 0 && books.docs.length === 0) {
      throw new Error('Open Library returned an empty default discovery feed.');
    }
    const dedupedDocs = dedupeBookDocs(books.docs).filter((doc) => {
      if (
        hasSearchQuery &&
        !matchesAllSearchTerms(
          [doc.title, ...(doc.author_name ?? [])],
          searchQuery
        )
      ) {
        return false;
      }

      if (
        parsedRatingNumber !== undefined &&
        (doc.ratings_average ?? 0) < parsedRatingNumber
      ) {
        return false;
      }

      if (
        firstPublishYear === 'before-1970' &&
        (doc.first_publish_year === undefined || doc.first_publish_year >= 1970)
      ) {
        return false;
      }

      return true;
    });
    const rankedDocs =
      sortByBase === 'ranked' && !hasSearchQuery
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
        : undefined;
    const sortedDocs = rankedDocs
      ? sortAscending
        ? [...rankedDocs].reverse()
        : rankedDocs
      : sortByValue === 'rating.asc'
        ? [...dedupedDocs].sort(
            (a, b) =>
              (a.ratings_average ?? Number.POSITIVE_INFINITY) -
              (b.ratings_average ?? Number.POSITIVE_INFINITY)
          )
        : sortByBase === 'editions' && sortAscending
          ? [...dedupedDocs].reverse()
          : sortByBase === 'random'
            ? shuffleRankedWindow(dedupedDocs, shuffleSeed, dedupedDocs.length)
            : dedupedDocs;
    const pagedDocs = providerWindow
      ? sortedDocs.slice(providerWindow.sliceStart, providerWindow.sliceEnd)
      : sortedDocs;
    const providerHasMore = providerPage * providerLimit < books.numFound;
    const ids = pagedDocs.map((doc) => normalizeOpenLibraryWorkId(doc.key));
    const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(
      ids,
      req.user
    );

    return res.status(200).json({
      page,
      totalPages: needsLocalFiltering
        ? providerHasMore
          ? page + 1
          : page
        : Math.max(Math.ceil(books.numFound / itemsPerPage), 1),
      totalResults: needsLocalFiltering
        ? providerHasMore
          ? page * itemsPerPage + 1
          : (page - 1) * itemsPerPage + pagedDocs.length
        : books.numFound,
      results: pagedDocs.map((doc) => ({
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
      discoveryContext: bookDiscoveryContext,
    });
    return res.status(503).json({
      status: 503,
      message:
        'Open Library, the service used for book searches, timed out or is unavailable. Please try again.',
    });
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
          select: { id: true, plexToken: true, passwordChangedAt: true },
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
