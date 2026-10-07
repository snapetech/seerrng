import ExternalAPI from '@server/api/externalapi';
import MusicBrainz from '@server/api/musicbrainz';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import AsyncLock from '@server/utils/asyncLock';
import {
  buildServiceUrl,
  normalizeServiceHostname,
} from '@server/utils/serviceUrl';
import axios from 'axios';

interface PlexStatusResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
  };
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  year?: number;
  viewOffset?: number;
  userRating?: number;
  parentTitle?: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode' | 'artist' | 'album' | 'track';
  leafCount?: number;
  viewedLeafCount?: number;
  viewCount?: number;
  Media: Media[];
}

export interface PlexPlaybackSession {
  ratingKey: string;
  grandparentRatingKey?: string;
  type: 'episode';
  index: number;
  parentIndex: number;
  viewOffset: number;
  duration: number;
  userId?: string;
  username?: string;
  state?: string;
}

export interface PlexLibrary {
  type: 'show' | 'movie' | 'artist';
  key: string;
  title: string;
  agent: string;
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season' | 'episode' | 'artist' | 'album' | 'track';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: number;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  viewCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

export interface PlexPlayQueue {
  playQueueId: number;
  selectedItemId: string;
}

export interface PlexPlaylist {
  ratingKey: string;
  key: string;
  title: string;
  playlistType: 'audio' | 'video';
}

export interface PlexCollection {
  ratingKey: string;
  title: string;
  librarySectionID: string;
  smart: boolean;
}

const parseCollection = (value: unknown, section?: string): PlexCollection => {
  const libraryId = isRecord(value)
    ? (value.librarySectionID ?? section)
    : undefined;
  if (
    !isRecord(value) ||
    value.type !== 'collection' ||
    !/^\d+$/.test(String(value.ratingKey)) ||
    !/^\d+$/.test(String(libraryId)) ||
    (section !== undefined && String(libraryId) !== section)
  ) {
    throw new Error('Plex returned invalid collection metadata.');
  }
  return {
    ratingKey: String(value.ratingKey),
    title: boundedPlexText(value.title, 512),
    librarySectionID: String(libraryId),
    smart: value.smart === true || value.smart === 1 || value.smart === '1',
  };
};

const metadataItems = (response: unknown): unknown[] => {
  if (!isRecord(response) || !isRecord(response.MediaContainer)) {
    throw new Error('Plex returned an invalid library response.');
  }
  const container = response.MediaContainer;
  if (Array.isArray(container.Metadata)) return container.Metadata;
  if (container.size === 0) return [];
  throw new Error('Plex returned incomplete library metadata.');
};

export interface PlexClient {
  clientIdentifier: string;
  name: string;
  product: string;
  platform?: string;
  connectionUri: string;
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

export const MAX_PLEX_LIBRARIES = 10_000;
export const MAX_PLEX_LIBRARY_ITEMS = 100_000;
export const MAX_PLEX_METADATA_ITEMS = 10_000;
export const MAX_PLEX_GUIDS = 100;
export const MAX_PLEX_MEDIA_VARIANTS = 100;
const MAX_PLEX_TEXT_LENGTH = 2_048;
const plexPlaylistLock = new AsyncLock();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedPlexText = (value: unknown, maximum = MAX_PLEX_TEXT_LENGTH) =>
  typeof value === 'string' ? value.slice(0, maximum) : '';

const plexNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : 0;

const plexInteger = (value: unknown): number => Math.floor(plexNumber(value));

const plexPort = (value: unknown): number => {
  const port =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,5}$/.test(value)
        ? Number(value)
        : 0;
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : 0;
};

export const sanitizePlexClients = (value: unknown): PlexClient[] => {
  const mediaContainer =
    isRecord(value) && isRecord(value.MediaContainer)
      ? value.MediaContainer
      : {};

  return (Array.isArray(mediaContainer.Server) ? mediaContainer.Server : [])
    .slice(0, 250)
    .flatMap((client) => {
      if (!isRecord(client)) {
        return [];
      }

      const clientIdentifier = boundedPlexText(client.machineIdentifier, 512);
      const name = boundedPlexText(client.name, 512);
      const product = boundedPlexText(client.product, 512);
      const hostname = normalizeServiceHostname(
        boundedPlexText(client.address || client.host, 512)
      );
      const port = plexPort(client.port);
      const capabilities = boundedPlexText(client.protocolCapabilities, 1_024)
        .split(',')
        .map((capability) => capability.trim().toLocaleLowerCase());

      if (
        !clientIdentifier ||
        !name ||
        !product ||
        !hostname ||
        !port ||
        !capabilities.includes('playback')
      ) {
        return [];
      }

      return [
        {
          clientIdentifier,
          name,
          product,
          platform:
            boundedPlexText(client.platform || client.deviceClass, 512) ||
            undefined,
          connectionUri: buildServiceUrl({
            useSsl: client.protocol === 'https',
            hostname,
            port,
          }),
        },
      ];
    });
};

const sanitizePlexMedia = (value: unknown): Media | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    id: plexInteger(value.id),
    duration: plexNumber(value.duration),
    bitrate: plexNumber(value.bitrate),
    width: plexNumber(value.width),
    height: plexNumber(value.height),
    aspectRatio: plexNumber(value.aspectRatio),
    audioChannels: plexNumber(value.audioChannels),
    audioCodec: boundedPlexText(value.audioCodec, 128),
    videoCodec: boundedPlexText(value.videoCodec, 128),
    videoResolution: boundedPlexText(value.videoResolution, 128),
    container: boundedPlexText(value.container, 128),
    videoFrameRate: boundedPlexText(value.videoFrameRate, 128),
    videoProfile: boundedPlexText(value.videoProfile, 128),
  };
};

const sanitizePlexGuids = (value: unknown): { id: string }[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_PLEX_GUIDS)
    .flatMap((guid) => {
      const id = isRecord(guid) ? boundedPlexText(guid.id, 512) : '';
      return id ? [{ id }] : [];
    });

const plexItemTypes = [
  'movie',
  'show',
  'season',
  'episode',
  'artist',
  'album',
  'track',
] as const;

export const sanitizePlexLibraryItem = (
  value: unknown
): PlexLibraryItem | undefined => {
  if (!isRecord(value) || !plexItemTypes.includes(value.type as never)) {
    return undefined;
  }
  const ratingKey = boundedPlexText(value.ratingKey, 128);
  if (!ratingKey) {
    return undefined;
  }

  return {
    ratingKey,
    parentRatingKey: boundedPlexText(value.parentRatingKey, 128) || undefined,
    grandparentRatingKey:
      boundedPlexText(value.grandparentRatingKey, 128) || undefined,
    title: boundedPlexText(value.title, 512),
    year: plexInteger(value.year) || undefined,
    viewOffset: plexInteger(value.viewOffset),
    userRating:
      typeof value.userRating === 'number' &&
      Number.isFinite(value.userRating) &&
      value.userRating >= 0 &&
      value.userRating <= 10
        ? value.userRating
        : undefined,
    parentTitle: boundedPlexText(value.parentTitle, 512) || undefined,
    guid: boundedPlexText(value.guid, 512),
    parentGuid: boundedPlexText(value.parentGuid, 512) || undefined,
    grandparentGuid: boundedPlexText(value.grandparentGuid, 512) || undefined,
    addedAt: plexInteger(value.addedAt),
    updatedAt: plexInteger(value.updatedAt),
    Guid: sanitizePlexGuids(value.Guid),
    type: value.type as PlexLibraryItem['type'],
    leafCount: plexInteger(value.leafCount),
    viewedLeafCount: plexInteger(value.viewedLeafCount),
    viewCount: plexInteger(value.viewCount),
    Media: (Array.isArray(value.Media) ? value.Media : [])
      .slice(0, MAX_PLEX_MEDIA_VARIANTS)
      .flatMap((media) => {
        const normalized = sanitizePlexMedia(media);
        return normalized ? [normalized] : [];
      }),
  };
};

export const sanitizePlexPlaybackSession = (
  value: unknown
): PlexPlaybackSession | undefined => {
  if (!isRecord(value) || value.type !== 'episode') return undefined;

  const ratingKey = boundedPlexText(value.ratingKey, 128);
  const user = isRecord(value.User) ? value.User : undefined;
  const player = isRecord(value.Player) ? value.Player : undefined;
  const index = plexInteger(value.index);
  const parentIndex = plexInteger(value.parentIndex);
  const viewOffset = plexInteger(value.viewOffset);
  const duration = plexInteger(value.duration);
  if (
    !ratingKey ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Number.isSafeInteger(parentIndex) ||
    parentIndex < 0 ||
    !Number.isSafeInteger(viewOffset) ||
    viewOffset < 0 ||
    !Number.isSafeInteger(duration) ||
    duration <= 0
  ) {
    return undefined;
  }

  return {
    ratingKey,
    grandparentRatingKey:
      boundedPlexText(value.grandparentRatingKey, 128) || undefined,
    type: 'episode',
    index,
    parentIndex,
    viewOffset,
    duration,
    userId: boundedPlexText(user?.id, 128) || undefined,
    username: boundedPlexText(user?.title, 512) || undefined,
    state: boundedPlexText(player?.state, 64) || undefined,
  };
};

export const sanitizePlexMetadata = (
  value: unknown,
  includeChildren = true
): PlexMetadata | undefined => {
  const item = sanitizePlexLibraryItem(value);
  if (!item || !isRecord(value)) {
    return undefined;
  }
  const children = isRecord(value.Children) ? value.Children : undefined;

  return {
    ratingKey: item.ratingKey,
    parentRatingKey: item.parentRatingKey,
    guid: item.guid,
    type: item.type,
    title: item.title,
    Guid: item.Guid ?? [],
    Children:
      includeChildren && children
        ? {
            size: plexInteger(children.size),
            Metadata: (Array.isArray(children.Metadata)
              ? children.Metadata
              : []
            )
              .slice(0, MAX_PLEX_METADATA_ITEMS)
              .flatMap((child) => {
                const normalized = sanitizePlexMetadata(child, false);
                return normalized ? [normalized] : [];
              }),
          }
        : undefined,
    index: plexInteger(value.index),
    parentIndex:
      typeof value.parentIndex === 'number'
        ? plexInteger(value.parentIndex)
        : undefined,
    leafCount: plexInteger(value.leafCount),
    viewedLeafCount: plexInteger(value.viewedLeafCount),
    viewCount: plexInteger(value.viewCount),
    addedAt: item.addedAt,
    updatedAt: item.updatedAt,
    Media: item.Media,
  };
};

class PlexAPI extends ExternalAPI {
  private readonly configuredServerUrl: string;
  private collectionLookupSeeds = new Map<string, Promise<string | null>>();
  private collectionLookupGuids = new Map<number, Promise<string | null>>();

  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string | null;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    const settingsPlex = plexSettings ?? settings.plex;

    const baseUrl = buildServiceUrl({
      useSsl: settingsPlex.useSsl,
      hostname: settingsPlex.ip,
      port: settingsPlex.port,
    });

    super(
      baseUrl,
      {},
      {
        allowPrivateAddresses: true,
        allowUnconfiguredBaseUrl: true,
        timeout,
        headers: {
          'X-Plex-Token': plexToken ?? '',
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Product': 'SeerrNG',
          'X-Plex-Device-Name': 'SeerrNG',
          'X-Plex-Platform': 'SeerrNG',
        },
      }
    );
    this.configuredServerUrl = baseUrl;
  }

  public async getStatus(): Promise<PlexStatusResponse> {
    const response = await this.get<unknown>('/');
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};
    return {
      MediaContainer: {
        machineIdentifier: boundedPlexText(
          mediaContainer.machineIdentifier,
          128
        ),
        friendlyName: boundedPlexText(mediaContainer.friendlyName, 512),
      },
    };
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const response = await this.get<unknown>('/library/sections');
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};

    return (
      Array.isArray(mediaContainer.Directory) ? mediaContainer.Directory : []
    )
      .slice(0, MAX_PLEX_LIBRARIES)
      .flatMap((library) => {
        if (!isRecord(library)) return [];
        const type = library.type;
        const key = boundedPlexText(library.key, 128);
        const title = boundedPlexText(library.title, 512);
        if (
          (type !== 'movie' && type !== 'show' && type !== 'artist') ||
          !key ||
          !title
        )
          return [];
        return [
          {
            type,
            key,
            title,
            agent: boundedPlexText(library.agent, 512),
          },
        ];
      });
  }

  public async getClients(): Promise<PlexClient[]> {
    const response = await this.get<unknown>('/clients', undefined, 0);
    return sanitizePlexClients(response).map((client) => {
      const hostname = new URL(client.connectionUri).hostname.toLowerCase();
      const isLoopback =
        hostname === 'localhost' ||
        hostname === '::1' ||
        hostname.startsWith('127.');

      // Some Plex clients advertise the Plex server's own loopback address.
      // Route those Companion commands through the configured server instead;
      // X-Plex-Target-Client-Identifier still identifies the actual player.
      return isLoopback
        ? { ...client, connectionUri: this.configuredServerUrl }
        : client;
    });
  }

  public async getPlaybackSessions(): Promise<PlexPlaybackSession[]> {
    const response = await this.get<unknown>('/status/sessions', undefined, 0);
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};
    const sessions = [
      ...(Array.isArray(mediaContainer.Metadata)
        ? mediaContainer.Metadata
        : []),
      ...(Array.isArray(mediaContainer.Video) ? mediaContainer.Video : []),
    ];

    return sessions.slice(0, 100).flatMap((session) => {
      const normalized = sanitizePlexPlaybackSession(session);
      return normalized ? [normalized] : [];
    });
  }

  /** Exact GUID lookup, never a title/year guess or a filesystem scan. */
  public async findCollectionMovies(
    libraryId: string,
    tmdbId: number,
    mediaType: 'movie' | 'show' = 'movie'
  ): Promise<PlexLibraryItem[]> {
    const guid = `tmdb://${tmdbId}`;
    const endpoint = `/library/sections/${encodeURIComponent(libraryId)}/all`;
    const lookup = (searchGuid: string) =>
      this.get<unknown>(
        endpoint,
        {
          params: {
            type: mediaType === 'movie' ? 1 : 2,
            guid: searchGuid,
            includeGuids: 1,
          },
          headers: {
            'X-Plex-Container-Start': '0',
            'X-Plex-Container-Size': '100',
          },
        },
        0
      );
    let items = metadataItems(await lookup(guid));
    if (!items.length) {
      // Modern Plex filters on its primary plex:// identity, not child TMDB GUIDs.
      // The read-only matches endpoint resolves an exact provider ID. It does NOT
      // apply a match or change the seed movie. This mirrors PlexAPI getGuid().
      if (!this.collectionLookupSeeds.has(libraryId)) {
        this.collectionLookupSeeds.set(
          libraryId,
          (async () => {
            const response = await this.get<unknown>(
              endpoint,
              {
                params: { type: mediaType === 'movie' ? 1 : 2 },
                headers: {
                  'X-Plex-Container-Start': '0',
                  'X-Plex-Container-Size': '1',
                },
              },
              0
            );
            const seed = metadataItems(response)[0];
            if (!seed) return null;
            if (!isRecord(seed) || !/^\d+$/.test(String(seed.ratingKey)))
              throw new Error('Invalid Plex lookup seed.');
            return String(seed.ratingKey);
          })()
        );
      }
      const seed = await this.collectionLookupSeeds.get(libraryId)!;
      if (!seed) return [];
      if (!this.collectionLookupGuids.has(tmdbId)) {
        this.collectionLookupGuids.set(
          tmdbId,
          (async () => {
            const response = await this.get<unknown>(
              `/library/metadata/${seed}/matches`,
              {
                params: {
                  title: `tmdb-${tmdbId}`,
                  manual: 1,
                  agent:
                    mediaType === 'movie'
                      ? 'tv.plex.agents.movie'
                      : 'tv.plex.agents.series',
                  language: 'en',
                },
              },
              0
            );
            if (!isRecord(response) || !isRecord(response.MediaContainer))
              throw new Error('Invalid provider-ID lookup.');
            const container = response.MediaContainer;
            if (container.size === 0) return null;
            if (
              !Array.isArray(container.SearchResult) ||
              container.SearchResult.length !== 1
            )
              throw new Error('Ambiguous provider-ID lookup.');
            const result = container.SearchResult[0];
            if (
              !isRecord(result) ||
              typeof result.guid !== 'string' ||
              !result.guid.startsWith(`plex://${mediaType}/`)
            )
              throw new Error('Unverified Plex identity.');
            return result.guid;
          })()
        );
      }
      const primaryGuid = await this.collectionLookupGuids.get(tmdbId)!;
      if (!primaryGuid) return [];
      items = metadataItems(await lookup(primaryGuid));
    }
    if (items.length >= 100)
      throw new Error('Plex movie lookup exceeded its limit.');
    return items.flatMap((item) => {
      const movie = sanitizePlexLibraryItem(item);
      return movie?.type === mediaType &&
        /^\d+$/.test(movie.ratingKey) &&
        (mediaType === 'movie' ||
          (isRecord(item) &&
            typeof item.leafCount === 'number' &&
            item.leafCount > 0)) &&
        (movie.guid === guid || movie.Guid?.some((entry) => entry.id === guid))
        ? [movie]
        : [];
    });
  }

  /** Title bounds the candidate set; only an exact MusicBrainz identity admits a member. */
  public async findCollectionAlbums(
    libraryId: string,
    mbId: string,
    title: string
  ): Promise<PlexLibraryItem[]> {
    const response = await this.get<unknown>(
      `/library/sections/${encodeURIComponent(libraryId)}/all`,
      {
        params: { type: 9, title, includeGuids: 1 },
        headers: {
          'X-Plex-Container-Start': '0',
          'X-Plex-Container-Size': '100',
        },
      },
      0
    );
    const candidates = metadataItems(response);
    if (candidates.length >= 100)
      throw new Error('Album lookup exceeded its limit.');
    const matches: PlexLibraryItem[] = [];
    const musicbrainz = new MusicBrainz();
    for (const candidate of candidates) {
      const album = sanitizePlexLibraryItem(candidate);
      if (album?.type !== 'album' || !/^\d+$/.test(album.ratingKey)) continue;
      const ids = [album.guid, ...(album.Guid ?? []).map((entry) => entry.id)]
        .filter((guid) => guid.startsWith('mbid://'))
        .map((guid) => guid.slice(7));
      for (const id of ids) {
        if (
          id === mbId ||
          (await musicbrainz.collectionReleaseGroup(id)) === mbId
        ) {
          const tracks = await this.getChildrenMetadata(album.ratingKey);
          if (
            tracks.some(
              (track) =>
                track.type === 'track' && (track.Media?.length ?? 0) > 0
            )
          )
            matches.push(album);
          break;
        }
      }
    }
    return matches;
  }

  public async getCollection(id: string): Promise<PlexCollection | null> {
    try {
      const response = await this.get<unknown>(
        `/library/collections/${encodeURIComponent(id)}`,
        undefined,
        0
      );
      const items = metadataItems(response);
      if (items.length !== 1)
        throw new Error('Plex did not identify the collection.');
      return parseCollection(items[0]);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404)
        return null;
      throw error;
    }
  }

  public async findCollections(
    libraryId: string,
    title: string
  ): Promise<PlexCollection[]> {
    const matches: PlexCollection[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const response = await this.get<unknown>(
        `/library/sections/${encodeURIComponent(libraryId)}/collections`,
        {
          headers: {
            'X-Plex-Container-Start': String(offset),
            'X-Plex-Container-Size': '100',
          },
        },
        0
      );
      const items = metadataItems(response).map((item) =>
        parseCollection(item, libraryId)
      );
      matches.push(
        ...items.filter(
          (item) => item.title === title && item.librarySectionID === libraryId
        )
      );
      if (items.length < 100) return matches;
    }
    throw new Error('Plex collection lookup exceeded its limit.');
  }

  public async removeCollection(id: string, libraryId: string): Promise<void> {
    const remote = await this.getCollection(id);
    if (!remote) return;
    if (
      remote.ratingKey !== id ||
      remote.librarySectionID !== libraryId ||
      remote.smart
    ) {
      throw new Error('Collection identity changed.');
    }
    await this.request(
      'DELETE',
      `/library/collections/${encodeURIComponent(id)}`
    );
    if (await this.getCollection(id))
      throw new Error('Collection removal was not confirmed.');
  }

  private collectionUri(machineId: string, ids: string[]): string {
    if (!machineId || !ids.length || ids.some((id) => !/^\d+$/.test(id))) {
      throw new Error('Invalid collection members.');
    }
    return `server://${encodeURIComponent(machineId)}/com.plexapp.plugins.library/library/metadata/${[...new Set(ids)].join(',')}`;
  }

  public async createCollection(
    title: string,
    libraryId: string,
    ids: string[],
    machineId: string,
    mediaType: 'movie' | 'show' | 'album' = 'movie'
  ): Promise<PlexCollection> {
    const response = await this.request<unknown>(
      'POST',
      '/library/collections',
      null,
      {
        params: {
          title,
          sectionId: libraryId,
          type: mediaType === 'movie' ? 1 : mediaType === 'show' ? 2 : 9,
          smart: 0,
          uri: this.collectionUri(machineId, ids),
        },
      }
    );
    return parseCollection(metadataItems(response.data)[0], libraryId);
  }

  public async addCollectionItems(
    id: string,
    ids: string[],
    machineId: string
  ): Promise<void> {
    // Compare first: repeated scans must not append duplicate members.
    const existing = new Set<string>();
    for (let offset = 0; offset < 10000; offset += 100) {
      const response = await this.get<unknown>(
        `/library/collections/${encodeURIComponent(id)}/children`,
        {
          headers: {
            'X-Plex-Container-Start': String(offset),
            'X-Plex-Container-Size': '100',
          },
        },
        0
      );
      const items = metadataItems(response);
      for (const item of items) {
        if (!isRecord(item) || !/^\d+$/.test(String(item.ratingKey)))
          throw new Error('Invalid collection member.');
        existing.add(String(item.ratingKey));
      }
      if (items.length < 100) break;
      if (offset === 9900)
        throw new Error('Plex collection membership exceeded its limit.');
    }
    const missing = [...new Set(ids)].filter((id) => !existing.has(id));
    for (let offset = 0; offset < missing.length; offset += 100) {
      await this.request(
        'PUT',
        `/library/collections/${encodeURIComponent(id)}/items`,
        null,
        {
          params: {
            uri: this.collectionUri(
              machineId,
              missing.slice(offset, offset + 100)
            ),
          },
        }
      );
    }
  }

  public async syncLibraries({
    enabledLibraryIds,
  }: { enabledLibraryIds?: string[] } = {}): Promise<Library[]> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const plex = await settings.persistSection('plex', (current) => ({
        ...current,
        libraries: libraries
          // Remove libraries that are not movie, show, or artist (music)
          .filter(
            (library) =>
              library.type === 'movie' ||
              library.type === 'show' ||
              library.type === 'artist'
          )
          // Remove libraries that do not have a metadata agent set (usually personal video libraries)
          .filter((library) => library.agent !== 'com.plexapp.agents.none')
          .map((library) => {
            const existing = current.libraries.find(
              (item) => item.id === library.key
            );

            // Plex has no distinct wire-level type for music vs. audiobook
            // libraries -- both report as 'artist'. An 'artist' library is
            // classified as 'music' unless the admin has manually
            // reclassified it as 'book' (see settings PATCH handler), and
            // that manual choice survives re-syncs via `existing`.
            const type: Library['type'] =
              library.type === 'artist'
                ? existing?.type === 'book'
                  ? 'book'
                  : 'music'
                : library.type;

            return {
              id: library.key,
              name: library.title,
              enabled:
                enabledLibraryIds?.includes(library.key) ??
                existing?.enabled ??
                false,
              type,
              lastScan: existing?.lastScan,
            };
          }),
      }));

      return plex.libraries;
    } catch (e) {
      logger.error('Failed to synchronize Plex libraries', {
        label: 'Plex API',
        message: e.message,
      });
      throw e;
    }
  }

  public async getLibraryContents(
    id: string,
    {
      offset = 0,
      size = 50,
      libraryType,
      isWatched,
    }: {
      offset?: number;
      size?: number;
      libraryType?: 'show' | 'movie' | 'music' | 'book';
      isWatched?: boolean;
    } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const safeOffset =
      Number.isSafeInteger(offset) && offset >= 0
        ? Math.min(offset, MAX_PLEX_LIBRARY_ITEMS)
        : 0;
    const safeSize =
      Number.isSafeInteger(size) && size > 0
        ? Math.min(size, MAX_PLEX_LIBRARY_ITEMS)
        : 50;
    // Artist-type (music/audiobook) sections return artists, not albums,
    // from /all unless we explicitly ask for album-type items (9). Movie
    // and show sections only ever contain their one leaf type, so no
    // filter is needed there.
    const params: Record<string, number> = {
      includeGuids: 1,
      includeUserRating: 1,
    };
    if (libraryType === 'music' || libraryType === 'book') {
      params.type = 9;
    }
    if (isWatched !== undefined) {
      // Plex interprets unwatched=0 as watched and unwatched=1 as unplayed.
      params.unwatched = isWatched ? 0 : 1;
    }
    const response = await this.get<unknown>(
      `/library/sections/${encodeURIComponent(boundedPlexText(id, 128))}/all`,
      {
        params,
        headers: {
          'X-Plex-Container-Start': `${safeOffset}`,
          'X-Plex-Container-Size': `${safeSize}`,
        },
      }
    );
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};

    return {
      totalSize: plexInteger(mediaContainer.totalSize),
      items: (Array.isArray(mediaContainer.Metadata)
        ? mediaContainer.Metadata
        : []
      )
        .slice(0, MAX_PLEX_LIBRARY_ITEMS)
        .flatMap((item) => {
          const normalized = sanitizePlexLibraryItem(item);
          return normalized ? [normalized] : [];
        }),
    };
  }

  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.get<unknown>(
      `/library/metadata/${encodeURIComponent(boundedPlexText(key, 128))}`,
      {
        params: options.includeChildren ? { includeChildren: 1 } : undefined,
      }
    );
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};
    const metadata = sanitizePlexMetadata(
      Array.isArray(mediaContainer.Metadata)
        ? mediaContainer.Metadata[0]
        : undefined
    );
    if (!metadata) {
      throw new Error('Plex returned invalid metadata');
    }
    return metadata;
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.get<unknown>(
      `/library/metadata/${encodeURIComponent(
        boundedPlexText(key, 128)
      )}/children`
    );
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};

    return (
      Array.isArray(mediaContainer.Metadata) ? mediaContainer.Metadata : []
    )
      .slice(0, MAX_PLEX_METADATA_ITEMS)
      .flatMap((item) => {
        const normalized = sanitizePlexMetadata(item);
        return normalized ? [normalized] : [];
      });
  }

  public async getAllLeavesMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.get<unknown>(
      `/library/metadata/${encodeURIComponent(
        boundedPlexText(key, 128)
      )}/allLeaves`,
      { params: { 'X-Plex-Container-Size': MAX_PLEX_METADATA_ITEMS } }
    );
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};

    return (
      Array.isArray(mediaContainer.Metadata) ? mediaContainer.Metadata : []
    )
      .slice(0, MAX_PLEX_METADATA_ITEMS)
      .flatMap((item) => {
        const normalized = sanitizePlexMetadata(item);
        return normalized?.type === 'episode' ? [normalized] : [];
      });
  }

  public async createPlayQueue(
    ratingKeys: string[],
    mediaType: 'audio' | 'video',
    machineIdentifier: string
  ): Promise<PlexPlayQueue> {
    const safeRatingKeys = ratingKeys
      .slice(0, 1_000)
      .map((key) => boundedPlexText(key, 128))
      .filter(Boolean);
    const safeMachineIdentifier = boundedPlexText(machineIdentifier, 128);
    if (safeRatingKeys.length === 0 || !safeMachineIdentifier) {
      throw new Error(
        'A Plex server and at least one media item are required.'
      );
    }

    const response = await this.post<unknown>('/playQueues', undefined, {
      params: {
        type: mediaType,
        shuffle: 0,
        repeat: 0,
        continuous: 0,
        uri: `server://${safeMachineIdentifier}/com.plexapp.plugins.library/library/metadata/${safeRatingKeys.join(
          ','
        )}`,
      },
    });
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};
    const playQueueId = plexInteger(mediaContainer.playQueueID);
    if (!playQueueId) {
      throw new Error('Plex did not create a playable queue.');
    }

    return { playQueueId, selectedItemId: safeRatingKeys[0] };
  }

  public async replacePlaylist(
    title: string,
    ratingKeys: string[],
    mediaType: 'audio' | 'video',
    machineIdentifier: string
  ): Promise<PlexPlaylist> {
    const safeTitle = boundedPlexText(title, 256).trim();
    const safeMachineIdentifier = boundedPlexText(machineIdentifier, 128);
    const safeRatingKeys = ratingKeys
      .slice(0, 1_000)
      .map((key) => boundedPlexText(key, 128))
      .filter(Boolean);
    if (!safeTitle || !safeMachineIdentifier || safeRatingKeys.length === 0) {
      throw new Error(
        'A playlist name, Plex server, and at least one media item are required.'
      );
    }

    return plexPlaylistLock.dispatch(
      `${safeMachineIdentifier}:${safeTitle}`,
      async () => {
        const playlistResponse = await this.get<unknown>(
          '/playlists',
          undefined,
          0
        );
        const playlistContainer =
          isRecord(playlistResponse) &&
          isRecord(playlistResponse.MediaContainer)
            ? playlistResponse.MediaContainer
            : {};
        const existingPlaylistIds = (
          Array.isArray(playlistContainer.Metadata)
            ? playlistContainer.Metadata
            : []
        )
          .slice(0, 10_000)
          .flatMap((playlist) => {
            if (!isRecord(playlist)) {
              return [];
            }
            const playlistTitle = boundedPlexText(playlist.title, 256);
            const ratingKey = boundedPlexText(playlist.ratingKey, 128);
            return playlistTitle === safeTitle && ratingKey ? [ratingKey] : [];
          });

        // The name is reserved for SeerrNG. Remove every exact-name remnant
        // before creating the replacement so retries cannot accumulate lists.
        for (const playlistId of existingPlaylistIds) {
          try {
            await this.request(
              'DELETE',
              `/playlists/${encodeURIComponent(playlistId)}`
            );
          } catch (error) {
            if (
              !isRecord(error) ||
              !isRecord(error.response) ||
              error.response.status !== 404
            ) {
              throw error;
            }
          }
        }

        const queue = await this.createPlayQueue(
          safeRatingKeys,
          mediaType,
          safeMachineIdentifier
        );
        const response = await this.request<unknown>(
          'POST',
          '/playlists',
          null,
          {
            params: {
              type: mediaType,
              title: safeTitle,
              smart: 0,
              playQueueID: queue.playQueueId,
            },
          }
        );
        const mediaContainer =
          isRecord(response.data) && isRecord(response.data.MediaContainer)
            ? response.data.MediaContainer
            : {};
        const metadata = Array.isArray(mediaContainer.Metadata)
          ? mediaContainer.Metadata[0]
          : undefined;
        const ratingKey = isRecord(metadata)
          ? boundedPlexText(metadata.ratingKey, 128)
          : '';
        const key = isRecord(metadata)
          ? boundedPlexText(metadata.key, 256)
          : '';
        if (!ratingKey || !key) {
          throw new Error('Plex did not create the replacement playlist.');
        }

        return { ratingKey, key, title: safeTitle, playlistType: mediaType };
      }
    );
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: 'movie' | 'show' | 'music' | 'book'
  ): Promise<PlexLibraryItem[]> {
    const addedAt =
      typeof options.addedAt === 'number' &&
      Number.isFinite(options.addedAt) &&
      options.addedAt >= 0
        ? Math.floor(options.addedAt / 1000)
        : 0;
    // Plex numeric section-item types: 1=movie, 4=episode, 9=album (used for
    // both music and audiobook libraries -- Plex has no distinct wire type).
    const numericType =
      mediaType === 'show'
        ? 4
        : mediaType === 'music' || mediaType === 'book'
          ? 9
          : 1;
    const response = await this.get<unknown>(
      `/library/sections/${encodeURIComponent(boundedPlexText(id, 128))}/all`,
      {
        params: {
          includeGuids: 1,
          type: numericType,
          sort: 'addedAt:desc',
          'addedAt>>': addedAt,
        },
        headers: {
          'X-Plex-Container-Start': '0',
          'X-Plex-Container-Size': '500',
        },
      }
    );
    const mediaContainer =
      isRecord(response) && isRecord(response.MediaContainer)
        ? response.MediaContainer
        : {};

    return (
      Array.isArray(mediaContainer.Metadata) ? mediaContainer.Metadata : []
    )
      .slice(0, 500)
      .flatMap((item) => {
        const normalized = sanitizePlexLibraryItem(item);
        return normalized ? [normalized] : [];
      });
  }
}

export default PlexAPI;
