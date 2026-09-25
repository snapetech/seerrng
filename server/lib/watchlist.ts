import PlexTvAPI from '@server/api/plextv';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  WatchlistItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
import {
  isValidExternalMediaId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { normalizeMagazineTitle } from '@server/lib/magazineIdentity';
import type { SelectQueryBuilder } from 'typeorm';

const mapLocalWatchlistItem = (item: Watchlist): WatchlistItem => ({
  id: item.id,
  ratingKey:
    item.ratingKey || item.mbId || item.externalId || item.id.toString(),
  tmdbId: item.tmdbId,
  mbId: item.mbId ? normalizeMusicBrainzId(item.mbId) : item.mbId,
  externalId: item.externalId
    ? item.mediaType === MediaType.COMIC
      ? item.externalId.trim()
      : item.mediaType === MediaType.MAGAZINE
        ? normalizeMagazineTitle(item.externalId)
        : normalizeOpenLibraryWorkId(item.externalId)
    : item.externalId,
  mediaType: item.mediaType as
    'movie' | 'tv' | 'music' | 'book' | 'comic' | 'magazine',
  title: item.title,
});

const isRenderableWatchlistItem = (item: Watchlist): boolean =>
  ((item.mediaType === MediaType.MOVIE || item.mediaType === MediaType.TV) &&
    Number.isSafeInteger(item.tmdbId) &&
    Number(item.tmdbId) > 0) ||
  (item.mediaType === MediaType.MUSIC && !!item.mbId) ||
  (item.mediaType === MediaType.BOOK && !!item.externalId) ||
  (item.mediaType === MediaType.COMIC &&
    !!item.externalId &&
    isValidExternalMediaId(item.externalId, MediaType.COMIC)) ||
  (item.mediaType === MediaType.MAGAZINE &&
    !!item.externalId &&
    isValidExternalMediaId(item.externalId, MediaType.MAGAZINE));

const applyRenderableWatchlistFilter = (query: SelectQueryBuilder<Watchlist>) =>
  query.andWhere(
    `(
      (watchlist.mediaType IN (:...screenMediaTypes) AND watchlist.tmdbId > 0)
      OR (watchlist.mediaType = :musicMediaType AND watchlist.mbId IS NOT NULL AND watchlist.mbId != '')
      OR (watchlist.mediaType IN (:...externalMediaTypes) AND watchlist.externalId IS NOT NULL AND watchlist.externalId != '')
    )`,
    {
      screenMediaTypes: [MediaType.MOVIE, MediaType.TV],
      musicMediaType: MediaType.MUSIC,
      externalMediaTypes: [MediaType.BOOK, MediaType.COMIC, MediaType.MAGAZINE],
    }
  );

const getWatchlistDedupeKey = (item: WatchlistItem) => {
  if (
    (item.mediaType === MediaType.MOVIE || item.mediaType === MediaType.TV) &&
    item.tmdbId !== undefined
  ) {
    return `${item.mediaType}:tmdb:${item.tmdbId}`;
  }

  if (item.mediaType === MediaType.MUSIC && item.mbId) {
    return `${item.mediaType}:mb:${normalizeMusicBrainzId(item.mbId)}`;
  }

  if (item.mediaType === MediaType.BOOK && item.externalId) {
    return `${item.mediaType}:openlibrary:${normalizeOpenLibraryWorkId(
      item.externalId
    ).toLocaleLowerCase()}`;
  }

  if (item.mediaType === MediaType.COMIC && item.externalId) {
    return `${item.mediaType}:comicvine:${item.externalId.trim()}`;
  }

  if (item.mediaType === MediaType.MAGAZINE && item.externalId) {
    return `${item.mediaType}:lazylibrarian:${normalizeMagazineTitle(
      item.externalId
    )}`;
  }

  return `${item.mediaType}:rating:${item.ratingKey}`;
};

const dedupeWatchlistItems = (items: WatchlistItem[]): WatchlistItem[] => {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = getWatchlistDedupeKey(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const getCombinedWatchlist = async ({
  userId,
  plexToken,
  page,
  itemsPerPage,
}: {
  userId?: number;
  plexToken?: string | null;
  page: number;
  itemsPerPage: number;
}): Promise<WatchlistResponse> => {
  if (!userId) {
    return {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    };
  }

  const offset = (page - 1) * itemsPerPage;
  const watchlistRepository = getRepository(Watchlist);
  const localQuery = applyRenderableWatchlistFilter(
    watchlistRepository
      .createQueryBuilder('watchlist')
      .where('watchlist.requestedBy = :userId', { userId })
  );
  const localTotal = await localQuery.getCount();
  const localTake = Math.max(
    itemsPerPage - Math.max(offset - localTotal, 0),
    0
  );
  const localSkip = Math.min(offset, localTotal);
  const localResult = localTake
    ? await localQuery
        .orderBy('watchlist.id', 'ASC')
        .skip(localSkip)
        .take(localTake)
        .getMany()
    : [];
  const localItems = dedupeWatchlistItems(
    localResult.filter(isRenderableWatchlistItem).map(mapLocalWatchlistItem)
  );

  if (!plexToken) {
    return {
      page,
      totalPages: Math.max(Math.ceil(localTotal / itemsPerPage), 1),
      totalResults: localTotal,
      results: localItems,
    };
  }

  const plexTV = new PlexTvAPI(plexToken);
  const plexOffset = Math.max(offset - localTotal, 0);
  const plexWatchlist = await plexTV.getWatchlist({ offset: plexOffset });
  const remainingItems = itemsPerPage - localItems.length;
  const plexItems = plexWatchlist.items
    .slice(0, remainingItems)
    .map<WatchlistItem>((item) => ({
      id: item.tmdbId,
      ratingKey: item.ratingKey,
      title: item.title,
      mediaType: item.type === 'show' ? MediaType.TV : MediaType.MOVIE,
      tmdbId: item.tmdbId,
    }));
  const results = dedupeWatchlistItems([...localItems, ...plexItems]);
  const visibleDuplicateCount =
    localItems.length + plexItems.length - results.length;
  const totalResults = Math.max(
    localTotal + plexWatchlist.totalSize - visibleDuplicateCount,
    results.length
  );

  return {
    page,
    totalPages: Math.max(Math.ceil(totalResults / itemsPerPage), 1),
    totalResults,
    results,
  };
};
