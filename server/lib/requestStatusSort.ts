import ListenBrainzAPI from '@server/api/listenbrainz';
import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import type {
  OpenLibraryAuthor,
  OpenLibraryEdition,
  OpenLibraryWork,
} from '@server/api/openlibrary';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import type { RequestStatusPageItem } from '@server/lib/requestStatus';
import { mapWithConcurrency } from '@server/utils/concurrency';

export const REQUEST_STATUS_SORT_FIELDS = [
  'added',
  'modified',
  'status',
  'title',
  'director',
  'writer',
  'rating',
  'releaseDate',
  'artist',
  'author',
  'publisher',
] as const;

export type RequestStatusSortField =
  (typeof REQUEST_STATUS_SORT_FIELDS)[number];

export type RequestStatusSortDirection = 'asc' | 'desc';

export interface RequestStatusSortMetadata {
  title?: string;
  director?: string;
  writer?: string;
  rating?: number;
  releaseDate?: string;
  artist?: string;
  author?: string;
  publisher?: string;
}

export type RequestStatusSortMetadataLoader = (
  item: RequestStatusPageItem
) => Promise<RequestStatusSortMetadata>;

const METADATA_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_METADATA_CACHE_ENTRIES = 5_000;
const METADATA_CONCURRENCY = 8;

type CachedMetadata = {
  value: RequestStatusSortMetadata;
  expiresAt: number;
};

const metadataCache = new Map<string, CachedMetadata>();
const metadataInFlight = new Map<string, Promise<RequestStatusSortMetadata>>();

const cacheSortMetadata = (
  key: string,
  value: RequestStatusSortMetadata
): void => {
  const now = Date.now();
  for (const [cachedKey, cached] of metadataCache) {
    if (cached.expiresAt <= now) {
      metadataCache.delete(cachedKey);
    }
  }

  while (metadataCache.size >= MAX_METADATA_CACHE_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    metadataCache.delete(oldestKey);
  }

  metadataCache.set(key, {
    value,
    expiresAt: now + METADATA_CACHE_TTL_MS,
  });
};

let tmdb: TheMovieDb | undefined;
let listenbrainz: ListenBrainzAPI | undefined;
let openLibrary: OpenLibraryAPI | undefined;

const getTmdb = (): TheMovieDb => {
  tmdb ??= new TheMovieDb();
  return tmdb;
};

const getListenBrainz = (): ListenBrainzAPI => {
  listenbrainz ??= new ListenBrainzAPI();
  return listenbrainz;
};

const getOpenLibrary = (): OpenLibraryAPI => {
  openLibrary ??= new OpenLibraryAPI();
  return openLibrary;
};

const nonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const firstCredit = (
  credits: { name: string; job: string }[] | undefined,
  jobs: readonly string[]
): string | undefined => {
  if (!credits) {
    return undefined;
  }
  return nonEmpty(
    credits
      .filter((credit) => jobs.includes(credit.job))
      .map((credit) => credit.name)
      .join(', ')
  );
};

const movieMetadata = (movie: TmdbMovieDetails): RequestStatusSortMetadata => ({
  title: nonEmpty(movie.title ?? movie.original_title),
  director: firstCredit(movie.credits?.crew, ['Director']),
  rating:
    typeof movie.vote_average === 'number' &&
    Number.isFinite(movie.vote_average)
      ? movie.vote_average
      : undefined,
  releaseDate: nonEmpty(movie.release_date),
});

const tvMetadata = (show: TmdbTvDetails): RequestStatusSortMetadata => ({
  title: nonEmpty(show.name ?? show.original_name),
  director: firstCredit(show.credits?.crew, ['Director']),
  writer: firstCredit(show.credits?.crew, [
    'Writer',
    'Screenplay',
    'Story',
    'Teleplay',
  ]),
  rating:
    typeof show.vote_average === 'number' && Number.isFinite(show.vote_average)
      ? show.vote_average
      : undefined,
  releaseDate: nonEmpty(show.first_air_date),
});

const musicMetadata = (album: LbAlbumDetails): RequestStatusSortMetadata => ({
  title: nonEmpty(album.release_group_metadata?.release_group?.name),
  artist: nonEmpty(album.release_group_metadata?.artist?.name),
  releaseDate: nonEmpty(album.release_group_metadata?.release_group?.date),
});

const getAuthorNames = async (
  work: OpenLibraryWork
): Promise<string | undefined> => {
  const authorIds = (work.authors ?? [])
    .map((entry) => nonEmpty(entry.author?.key)?.replace(/^\/authors\//, ''))
    .filter((authorId): authorId is string => !!authorId)
    .slice(0, 3);
  if (authorIds.length === 0) {
    return undefined;
  }

  const authors = await mapWithConcurrency(
    authorIds,
    3,
    async (authorId): Promise<OpenLibraryAuthor | undefined> => {
      try {
        return await getOpenLibrary().getAuthor(authorId);
      } catch {
        return undefined;
      }
    }
  );

  return nonEmpty(
    authors
      .filter((author): author is OpenLibraryAuthor => !!author)
      .map((author) => author.name)
      .join(', ')
  );
};

const bookMetadata = async (
  work: OpenLibraryWork,
  edition?: OpenLibraryEdition
): Promise<RequestStatusSortMetadata> => ({
  title: nonEmpty(work.title),
  author: await getAuthorNames(work),
  publisher: nonEmpty(edition?.publishers?.join(', ')),
  releaseDate: nonEmpty(work.first_publish_date),
});

const getIdentifier = (
  item: RequestStatusPageItem,
  provider: string
): string | undefined =>
  item.request.media.identifiers?.find(
    (identifier) => identifier.provider === provider
  )?.value;

const getMetadataCacheKey = (
  item: RequestStatusPageItem
): string | undefined => {
  const { request } = item;
  if (request.type === MediaType.MOVIE || request.type === MediaType.TV) {
    return `${request.type}:${request.media.tmdbId}`;
  }
  if (request.type === MediaType.MUSIC) {
    return request.media.mbId ? `music:${request.media.mbId}` : undefined;
  }
  const workId = getIdentifier(item, 'openlibrary');
  const editionId = getIdentifier(item, 'openlibrary_edition');
  return workId ? `book:${workId}:${editionId ?? ''}` : undefined;
};

const loadSortMetadata = async (
  item: RequestStatusPageItem
): Promise<RequestStatusSortMetadata> => {
  const key = getMetadataCacheKey(item);
  if (!key) {
    return {};
  }

  const cached = metadataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const existing = metadataInFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = (async (): Promise<RequestStatusSortMetadata> => {
    try {
      if (item.request.type === MediaType.MOVIE) {
        return movieMetadata(
          await getTmdb().getMovie({ movieId: item.request.media.tmdbId })
        );
      }
      if (item.request.type === MediaType.TV) {
        return tvMetadata(
          await getTmdb().getTvShow({ tvId: item.request.media.tmdbId })
        );
      }
      if (item.request.type === MediaType.MUSIC && item.request.media.mbId) {
        return musicMetadata(
          await getListenBrainz().getAlbum(item.request.media.mbId)
        );
      }
      if (item.request.type === MediaType.BOOK) {
        const workId = getIdentifier(item, 'openlibrary');
        if (!workId) {
          return {};
        }
        const editionId = getIdentifier(item, 'openlibrary_edition');
        const [work, edition] = await Promise.all([
          getOpenLibrary().getWork(workId),
          editionId
            ? getOpenLibrary()
                .getEdition(editionId)
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
        return bookMetadata(work, edition);
      }
    } catch {
      // Sorting must remain available when an external metadata provider is
      // unavailable. The comparator will place this item after entries with
      // usable metadata and retain deterministic request ordering for ties.
    }
    return {};
  })();

  metadataInFlight.set(key, request);
  try {
    const value = await request;
    // Keep successful lookups warm, but do not cache an outage as a 12-hour
    // result. The next request can then recover as soon as the provider does.
    if (Object.keys(value).length > 0) {
      cacheSortMetadata(key, value);
    }
    return value;
  } finally {
    metadataInFlight.delete(key);
  }
};

const STATUS_ORDER: readonly string[] = [
  'requested',
  'approved',
  'searching',
  'downloading',
  'importing',
  'library',
  'available',
  'unavailable',
  'failed',
  'declined',
  'cancelled',
];

const isSortField = (value: string): value is RequestStatusSortField =>
  (REQUEST_STATUS_SORT_FIELDS as readonly string[]).includes(value);

export const parseRequestStatusSort = (
  sort?: string,
  sortDirection?: string
): {
  field: RequestStatusSortField;
  direction: RequestStatusSortDirection;
} => ({
  field: sort && isSortField(sort) ? sort : 'added',
  direction: sortDirection === 'asc' ? 'asc' : 'desc',
});

export const isMetadataRequestStatusSort = (
  field: RequestStatusSortField
): boolean => !['added', 'modified', 'status'].includes(field);

const getSortValue = (
  item: RequestStatusPageItem,
  field: RequestStatusSortField,
  metadata: RequestStatusSortMetadata
): string | number | undefined => {
  switch (field) {
    case 'added':
      return item.request.createdAt.getTime();
    case 'modified':
      return item.request.updatedAt.getTime();
    case 'status':
      return STATUS_ORDER.indexOf(item.status.stage);
    case 'title':
      return metadata.title;
    case 'director':
      return metadata.director;
    case 'writer':
      return metadata.writer;
    case 'rating':
      return metadata.rating;
    case 'releaseDate':
      return metadata.releaseDate;
    case 'artist':
      return metadata.artist;
    case 'author':
      return metadata.author;
    case 'publisher':
      return metadata.publisher;
  }
};

const compareValues = (
  left: string | number | undefined,
  right: string | number | undefined,
  direction: RequestStatusSortDirection
): number => {
  const leftMissing = left === undefined || left === '';
  const rightMissing = right === undefined || right === '';
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) {
      return 0;
    }
    return leftMissing ? 1 : -1;
  }

  const comparison =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
  return direction === 'asc' ? comparison : -comparison;
};

export const sortRequestStatusItems = async (
  items: RequestStatusPageItem[],
  field: RequestStatusSortField,
  direction: RequestStatusSortDirection,
  metadataLoader: RequestStatusSortMetadataLoader = loadSortMetadata
): Promise<RequestStatusPageItem[]> => {
  const metadata = new Map<string, RequestStatusSortMetadata>();
  if (isMetadataRequestStatusSort(field)) {
    const loaded = await mapWithConcurrency(
      items,
      METADATA_CONCURRENCY,
      async (item) => [item.request.id, await metadataLoader(item)] as const
    );
    for (const [requestId, value] of loaded) {
      metadata.set(String(requestId), value);
    }
  }

  return [...items].sort((left, right) => {
    const leftValue = getSortValue(
      left,
      field,
      metadata.get(String(left.request.id)) ?? {}
    );
    const rightValue = getSortValue(
      right,
      field,
      metadata.get(String(right.request.id)) ?? {}
    );
    const comparison = compareValues(leftValue, rightValue, direction);
    if (comparison !== 0) {
      return comparison;
    }
    return direction === 'asc'
      ? left.request.id - right.request.id
      : right.request.id - left.request.id;
  });
};
