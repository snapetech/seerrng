import type {
  JellyfinLibrary,
  JellyfinLibraryItemExtended,
} from '@server/api/jellyfin';
import JellyfinAPI from '@server/api/jellyfin';
import type { PlexLibrary, PlexLibraryItem } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import type { DiscoveryAccountProvider } from '@server/entity/DiscoveryAccount';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { runWithConfigurationAdmission } from '@server/lib/configurationAdmission';
import { DiscoveryIntegrationError } from '@server/lib/discoveryIntegrations/accounts';
import type { Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { createHash } from 'node:crypto';
import { applyCuratedIdentityMappings } from './curatedIdentityPacks';
import {
  resolveExternalIdentityMatches,
  toPublicIdentityCandidate,
} from './externalIdentityResolver';
import { applyPersonalIdentityMappings } from './identityMappings';
import type { LibraryShelf, PersonalLibraryItem } from './library';

export type NativeLibrarySource = 'plex' | 'jellyfin' | 'emby';
export type PersonalLibrarySource =
  DiscoveryAccountProvider | NativeLibrarySource;

export interface NativeLibraryOption {
  id: string;
  name: string;
  type: 'show' | 'movie';
}

export interface NativeLibraryConnection {
  provider: NativeLibrarySource;
  connected: boolean;
}

const PAGE_SIZE = 20;
const MAX_PAGE = 500;
const PROVIDER_SCAN_SIZE = 100;
const MAX_SCAN_ITEMS_PER_REQUEST = 2_000;
export const MAX_NATIVE_LIBRARY_CURSOR = 100_000;
const cacheFlights = new Map<string, Promise<unknown>>();

const sourceForConfiguredServer = (): NativeLibrarySource | undefined => {
  const serverType = getSettings().main.mediaServerType;
  if (serverType === MediaServerType.PLEX) return 'plex';
  if (serverType === MediaServerType.JELLYFIN) return 'jellyfin';
  if (serverType === MediaServerType.EMBY) return 'emby';
  return undefined;
};

const enabledVideoLibraries = (libraries: Library[]): NativeLibraryOption[] =>
  libraries
    .filter(
      (library) =>
        library.enabled &&
        (library.type === 'show' || library.type === 'movie') &&
        !!library.id &&
        !!library.name
    )
    .map((library) => ({
      id: library.id,
      name: library.name,
      type: library.type as 'show' | 'movie',
    }));

const boundedPositive = (value: unknown): number | undefined => {
  const id =
    typeof value === 'string' && /^\d{1,10}$/.test(value)
      ? Number(value)
      : value;
  return typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    id <= 2_147_483_647
    ? id
    : undefined;
};

const plexTmdbId = (item: PlexLibraryItem): number | undefined => {
  for (const guid of item.Guid ?? []) {
    const match = /^tmdb:\/\/(\d{1,10})$/.exec(guid.id);
    const id = match ? boundedPositive(match[1]) : undefined;
    if (id) return id;
  }
  return undefined;
};

const jellyfinTmdbId = (item: JellyfinLibraryItemExtended) =>
  boundedPositive(item.ProviderIds.Tmdb ?? item.ProviderIds.TheMovieDb);

const plexExternalIds = (
  item: PlexLibraryItem
): { imdbId?: string; tvdbId?: number } => {
  for (const guid of item.Guid ?? []) {
    const imdbId = /^imdb:\/\/(tt\d{1,20})(?:[/?#]|$)/.exec(guid.id)?.[1];
    if (imdbId) return { imdbId };
    const tvdbId = /^tvdb:\/\/(\d{1,10})(?:[/?#]|$)/.exec(guid.id)?.[1];
    const parsedTvdbId = boundedPositive(tvdbId);
    if (parsedTvdbId) return { tvdbId: parsedTvdbId };
  }
  return {};
};

const plexItem = (item: PlexLibraryItem): PersonalLibraryItem | undefined => {
  if (item.type !== 'movie' && item.type !== 'show') return undefined;
  const mediaType = item.type === 'movie' ? 'movie' : 'tv';
  const total = item.type === 'show' ? (item.leafCount ?? 0) : undefined;
  const watched =
    item.type === 'movie'
      ? (item.viewCount ?? 0) > 0
      : total !== undefined &&
        total > 0 &&
        (item.viewedLeafCount ?? 0) >= total;
  const progress = item.type === 'show' ? (item.viewedLeafCount ?? 0) : 0;
  const status: PersonalLibraryItem['status'] = watched
    ? 'completed'
    : item.type === 'movie'
      ? (item.viewOffset ?? 0) > 0
        ? 'watching'
        : 'unwatched'
      : progress > 0
        ? 'watching'
        : 'unwatched';
  return {
    id: `plex:${mediaType}:${item.ratingKey}`,
    source: 'plex',
    sourceId: item.ratingKey,
    title: item.title,
    mediaType,
    tmdbId: plexTmdbId(item),
    ...plexExternalIds(item),
    year: item.year,
    rating: item.userRating,
    status,
    ...(item.type === 'show' ? { progress, totalEpisodes: total } : {}),
  };
};

const jellyfinItem = (
  item: JellyfinLibraryItemExtended,
  source: 'jellyfin' | 'emby'
): PersonalLibraryItem | undefined => {
  if (item.Type !== 'Movie' && item.Type !== 'Series') return undefined;
  const mediaType = item.Type === 'Movie' ? 'movie' : 'tv';
  const userData = item.UserData;
  const isPartiallyPlayed =
    !userData?.Played &&
    ((userData?.PlaybackPositionTicks ?? 0) > 0 ||
      ((userData?.PlayedPercentage ?? 0) > 0 &&
        (userData?.PlayedPercentage ?? 0) < 100));
  return {
    id: `${source}:${mediaType}:${item.Id}`,
    source,
    sourceId: item.Id,
    title: item.Name,
    mediaType,
    tmdbId: jellyfinTmdbId(item),
    ...(item.ProviderIds.Imdb && /^tt\d{1,20}$/.test(item.ProviderIds.Imdb)
      ? { imdbId: item.ProviderIds.Imdb }
      : {}),
    ...(boundedPositive(item.ProviderIds.Tvdb)
      ? { tvdbId: boundedPositive(item.ProviderIds.Tvdb) }
      : {}),
    year: item.ProductionYear,
    rating: userData?.Rating,
    status: userData?.Played
      ? 'completed'
      : isPartiallyPlayed
        ? 'watching'
        : 'unwatched',
  };
};

const statusMatchesShelf = (item: PersonalLibraryItem, shelf: LibraryShelf) => {
  switch (shelf) {
    case 'all':
      return true;
    case 'watched':
      return item.status === 'completed' || item.status === 'watched';
    case 'unwatched':
      return item.status !== 'completed' && item.status !== 'watched';
    case 'in-progress':
      return item.status === 'watching';
    case 'rated':
      return item.rating !== undefined && item.rating > 0;
    default:
      return false;
  }
};

const cachedPersonalRead = async <T>(
  scope: unknown,
  operation: unknown,
  load: () => Promise<T>
): Promise<T> => {
  // The cache and single-flight keys are hashes; account credentials and
  // personal library contents never appear in cache keys or logs.
  const scopeHash = createHash('sha256')
    .update(JSON.stringify(scope))
    .digest('hex');
  const operationHash = createHash('sha256')
    .update(JSON.stringify(operation))
    .digest('hex');
  const key = `personal-library:${scopeHash}:${operationHash}`;
  const cache = cacheManager.getCache('personallibrary').data;
  const cached = cache.get<T>(key);
  if (cached !== undefined) return cached;
  const pending = cacheFlights.get(key);
  if (pending) return pending as Promise<T>;
  if (cacheFlights.size >= 256) {
    throw new DiscoveryIntegrationError(
      429,
      'Too many personal library requests are in progress.'
    );
  }
  const result = load();
  cacheFlights.set(key, result);
  try {
    const value = await result;
    cache.set(key, value, 30);
    return value;
  } finally {
    if (cacheFlights.get(key) === result) cacheFlights.delete(key);
  }
};

const validateShelfAndPage = (
  shelf: LibraryShelf,
  page: number,
  cursor?: number
) => {
  if (
    !['all', 'watched', 'unwatched', 'in-progress', 'rated'].includes(shelf) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > MAX_PAGE ||
    (cursor !== undefined &&
      (!Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor > MAX_NATIVE_LIBRARY_CURSOR))
  ) {
    throw new DiscoveryIntegrationError(
      400,
      'Choose a valid media library shelf and page.'
    );
  }
};

const collectInProgressPage = async <T>(
  startOffset: number,
  fetchBatch: (
    offset: number,
    size: number
  ) => Promise<{ items: T[]; total: number }>,
  normalize: (item: T) => PersonalLibraryItem | undefined,
  matches: (item: PersonalLibraryItem) => boolean = (item) =>
    item.status === 'watching'
) => {
  const items: PersonalLibraryItem[] = [];
  const stopOffset = Math.min(
    MAX_NATIVE_LIBRARY_CURSOR,
    startOffset + MAX_SCAN_ITEMS_PER_REQUEST
  );
  let offset = startOffset;
  let nextCursor = startOffset;
  let total = MAX_NATIVE_LIBRARY_CURSOR;
  let providerTotalExceedsCursor = false;
  let foundLookahead = false;

  while (offset < total && offset < stopOffset) {
    const size = Math.min(PROVIDER_SCAN_SIZE, stopOffset - offset);
    const batch = await fetchBatch(offset, size);
    const providerTotal = Number.isSafeInteger(batch.total)
      ? Math.max(0, batch.total)
      : 0;
    providerTotalExceedsCursor ||= providerTotal > MAX_NATIVE_LIBRARY_CURSOR;
    total = Math.min(MAX_NATIVE_LIBRARY_CURSOR, providerTotal);
    if (!batch.items.length) break;

    const inspectedItems = batch.items.slice(0, size);
    for (let index = 0; index < inspectedItems.length; index += 1) {
      const item = normalize(inspectedItems[index]);
      if (!item || !matches(item)) continue;
      if (items.length === PAGE_SIZE) {
        foundLookahead = true;
        break;
      }
      items.push(item);
      nextCursor = offset + index + 1;
    }
    if (foundLookahead) break;
    offset += inspectedItems.length;
  }

  const cursorLimitReached =
    providerTotalExceedsCursor && offset >= MAX_NATIVE_LIBRARY_CURSOR;
  const truncated =
    (offset >= stopOffset && (offset < total || providerTotalExceedsCursor)) ||
    cursorLimitReached;
  return {
    items,
    total,
    hasMore: foundLookahead || (truncated && !cursorLimitReached),
    // If we stopped because the scan budget ran out, continue from the end
    // of the inspected batch. Otherwise resume immediately after the final
    // visible match so the lookahead item appears on the following page.
    nextCursor: truncated ? offset : foundLookahead ? nextCursor : offset,
    truncated,
  };
};

export async function getNativeLibraryConnection(
  userId: number
): Promise<NativeLibraryConnection | null> {
  const source = sourceForConfiguredServer();
  if (!source) return null;
  const settings = getSettings();
  const configuredLibraries = enabledVideoLibraries(
    source === 'plex' ? settings.plex.libraries : settings.jellyfin.libraries
  );
  const hasConfiguredServer =
    source === 'plex'
      ? !!settings.plex.ip && configuredLibraries.length > 0
      : !!settings.jellyfin.ip && configuredLibraries.length > 0;
  if (!hasConfiguredServer) return null;
  const user = await getRepository(User).findOne({
    where: { id: userId },
    select: {
      id: true,
      plexToken: true,
      jellyfinUserId: true,
      jellyfinAuthToken: true,
    },
  });
  const connected =
    source === 'plex'
      ? !!user?.plexToken
      : !!user?.jellyfinAuthToken &&
        !!normalizeJellyfinGuid(user?.jellyfinUserId);
  return { provider: source, connected };
}

export async function personalMediaServerLibrary(
  userId: number,
  source: NativeLibrarySource,
  shelf: LibraryShelf,
  page: number,
  requestedLibraryId?: string,
  requestedCursor?: number
) {
  validateShelfAndPage(shelf, page, requestedCursor);
  if (
    requestedLibraryId !== undefined &&
    (typeof requestedLibraryId !== 'string' ||
      requestedLibraryId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(requestedLibraryId))
  ) {
    throw new DiscoveryIntegrationError(400, 'Invalid library selection.');
  }

  const configuredSource = sourceForConfiguredServer();
  if (configuredSource !== source) {
    throw new DiscoveryIntegrationError(
      409,
      'This media server is not configured for SeerrNG.'
    );
  }
  const section = source === 'plex' ? 'plex' : 'jellyfin';
  return runWithConfigurationAdmission(section, async () => {
    const currentSettings = getSettings();
    if (sourceForConfiguredServer() !== source) {
      throw new DiscoveryIntegrationError(
        409,
        'This media server is not configured for SeerrNG.'
      );
    }
    const configuredLibraries = enabledVideoLibraries(
      source === 'plex'
        ? currentSettings.plex.libraries
        : currentSettings.jellyfin.libraries
    );
    if (configuredLibraries.length === 0) {
      throw new DiscoveryIntegrationError(
        409,
        'No enabled movie or series libraries are configured.'
      );
    }

    const user = await getRepository(User).findOne({
      where: { id: userId },
      select: {
        id: true,
        plexToken: true,
        jellyfinUserId: true,
        jellyfinDeviceId: true,
        jellyfinAuthToken: true,
      },
    });
    if (source === 'plex' && !user?.plexToken) {
      throw new DiscoveryIntegrationError(
        409,
        'Link your Plex account to browse your personal library.'
      );
    }
    const jellyfinUserId = normalizeJellyfinGuid(user?.jellyfinUserId);
    if (source !== 'plex' && (!user?.jellyfinAuthToken || !jellyfinUserId)) {
      throw new DiscoveryIntegrationError(
        409,
        `Link your ${source === 'emby' ? 'Emby' : 'Jellyfin'} account to browse your personal library.`
      );
    }

    const config =
      source === 'plex' ? currentSettings.plex : currentSettings.jellyfin;
    const host =
      source === 'plex'
        ? `${config.useSsl ? 'https' : 'http'}://${config.ip}:${config.port}`
        : getHostname(currentSettings.jellyfin);
    const credential =
      source === 'plex' ? user!.plexToken! : user!.jellyfinAuthToken!;
    const cacheScope = [source, userId, credential, host, configuredLibraries];
    const offset = requestedCursor ?? (page - 1) * PAGE_SIZE;
    const cacheOperation = [requestedLibraryId ?? '', shelf, page, offset];

    return cachedPersonalRead(cacheScope, cacheOperation, async () => {
      let libraries: NativeLibraryOption[];
      let items: PersonalLibraryItem[] = [];
      let total = 0;
      let hasMore = false;
      let nextCursor = offset;
      let truncated = false;

      if (source === 'plex') {
        const api = new PlexAPI({
          plexToken: credential,
          plexSettings: currentSettings.plex,
        });
        const serverLibraries = await api.getLibraries();
        libraries = configuredLibraries.flatMap((configured) => {
          const visible = serverLibraries.find(
            (candidate: PlexLibrary) =>
              candidate.key === configured.id &&
              candidate.type === configured.type
          );
          return visible ? [configured] : [];
        });
        if (requestedLibraryId) {
          const library = libraries.find(
            (candidate) => candidate.id === requestedLibraryId
          );
          if (!library) {
            throw new DiscoveryIntegrationError(404, 'Library not found.');
          }
          if (shelf === 'in-progress' || shelf === 'rated') {
            const result = await collectInProgressPage(
              offset,
              async (batchOffset, size) => {
                const batch = await api.getLibraryContents(library.id, {
                  offset: batchOffset,
                  size,
                  libraryType: library.type,
                });
                return { items: batch.items, total: batch.totalSize };
              },
              plexItem,
              shelf === 'rated' ? (item) => (item.rating ?? 0) > 0 : undefined
            );
            ({ items, total, hasMore, nextCursor, truncated } = result);
          } else {
            const result = await api.getLibraryContents(library.id, {
              offset,
              size: PAGE_SIZE,
              libraryType: library.type,
              ...(shelf === 'watched'
                ? { isWatched: true }
                : shelf === 'unwatched'
                  ? { isWatched: false }
                  : {}),
            });
            total = result.totalSize;
            items = result.items.flatMap((entry) => {
              const item = plexItem(entry);
              return item && statusMatchesShelf(item, shelf) ? [item] : [];
            });
            nextCursor = offset + PAGE_SIZE;
            hasMore = nextCursor < total;
          }
        }
      } else {
        const api = new JellyfinAPI(
          getHostname(currentSettings.jellyfin),
          credential,
          user?.jellyfinDeviceId
        );
        api.setUserId(jellyfinUserId!);
        const serverLibraries = await api.getUserLibraries();
        libraries = configuredLibraries.filter((configured) =>
          serverLibraries.some(
            (candidate: JellyfinLibrary) =>
              candidate.key === configured.id &&
              candidate.type === configured.type
          )
        );
        if (requestedLibraryId) {
          const library = libraries.find(
            (candidate) => candidate.id === requestedLibraryId
          );
          if (!library) {
            throw new DiscoveryIntegrationError(404, 'Library not found.');
          }
          if (shelf === 'in-progress' || shelf === 'rated') {
            const result = await collectInProgressPage(
              offset,
              async (batchOffset, size) => {
                const batch = await api.getUserLibraryContents(
                  library.id,
                  library.type,
                  {
                    offset: batchOffset,
                    size,
                    isPlayed: false,
                  }
                );
                return {
                  items: batch.Items,
                  total: batch.TotalRecordCount,
                };
              },
              (entry) => jellyfinItem(entry, source),
              shelf === 'rated' ? (item) => (item.rating ?? 0) > 0 : undefined
            );
            ({ items, total, hasMore, nextCursor, truncated } = result);
          } else {
            const result = await api.getUserLibraryContents(
              library.id,
              library.type,
              {
                offset,
                size: PAGE_SIZE,
                ...(shelf === 'watched'
                  ? { isPlayed: true }
                  : shelf === 'unwatched'
                    ? { isPlayed: false }
                    : {}),
              }
            );
            total = result.TotalRecordCount;
            items = result.Items.flatMap((entry) => {
              const item = jellyfinItem(entry, source);
              return item && statusMatchesShelf(item, shelf) ? [item] : [];
            });
            nextCursor = offset + PAGE_SIZE;
            hasMore = nextCursor < total;
          }
        }
      }

      const personalItems = await applyPersonalIdentityMappings(userId, items);
      const curatedItems = await applyCuratedIdentityMappings(personalItems);
      const mappedItems = await resolveExternalIdentityMatches(curatedItems);
      return {
        items: mappedItems.map(toPublicIdentityCandidate),
        libraries,
        page,
        total,
        hasMore: hasMore && page < MAX_PAGE,
        nextCursor,
        allowWrites: false,
        missingMappings: mappedItems.filter((item) => !item.tmdbId).length,
        truncated: truncated || (hasMore && page === MAX_PAGE),
      };
    });
  });
}
