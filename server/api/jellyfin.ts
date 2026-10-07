/* eslint-disable @typescript-eslint/no-explicit-any */
import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import availabilitySync from '@server/lib/availabilitySync';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';

export interface JellyfinUserResponse {
  Name: string;
  ServerId: string;
  ServerName: string;
  Id: string;
  Configuration: {
    GroupedFolders: string[];
  };
  Policy: {
    IsAdministrator: boolean;
  };
  PrimaryImageTag?: string;
}

export interface JellyfinDevice {
  Id: string;
  Name: string;
  LastUserName: string;
  AppName: string;
  AppVersion: string;
  LastUserId: string;
  DateLastActivity: string;
  Capabilities: Record<string, unknown>;
}

export interface JellyfinDevicesResponse {
  Items: JellyfinDevice[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinLoginResponse {
  User: JellyfinUserResponse;
  AccessToken: string;
}

export interface QuickConnectInitiateResponse {
  Secret: string;
  Code: string;
  DateAdded: string;
}

export interface QuickConnectStatusResponse {
  Authenticated: boolean;
  Secret: string;
  Code: string;
  DeviceId: string;
  DeviceName: string;
  AppName: string;
  AppVersion: string;
  DateAdded: string;
}

export interface JellyfinUserListResponse {
  users: JellyfinUserResponse[];
}

export interface JellyfinLibrary {
  type: 'show' | 'movie' | 'music';
  key: string;
  title: string;
  agent: string;
}

export interface JellyfinLibraryItem {
  Name: string;
  Id: string;
  HasSubtitles: boolean;
  Type:
    | 'Movie'
    | 'Episode'
    | 'Season'
    | 'Series'
    | 'MusicAlbum'
    | 'Audio'
    | 'AudioBook';
  LocationType: 'FileSystem' | 'Offline' | 'Remote' | 'Virtual';
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  ParentIndexNumber?: number;
  MediaType: string;
}

export interface JellyfinWatchEpisode {
  seasonNumber: number;
  episodeNumber: number;
  played: boolean;
}

export interface JellyfinMediaStream {
  Codec: string;
  Type: 'Video' | 'Audio' | 'Subtitle';
  Height?: number;
  Width?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Language?: string;
  DisplayTitle: string;
}

export interface JellyfinMediaSource {
  Protocol: string;
  Id: string;
  Path: string;
  Type: string;
  VideoType: string;
  MediaStreams: JellyfinMediaStream[];
}

export interface JellyfinLibraryItemExtended extends JellyfinLibraryItem {
  ProviderIds: {
    Tmdb?: string;
    TheMovieDb?: string;
    Imdb?: string;
    Tvdb?: string;
    AniDB?: string;
    MusicBrainzAlbum?: string;
    MusicBrainzReleaseGroup?: string;
    MusicBrainzArtist?: string;
  };
  MediaSources?: JellyfinMediaSource[];
  Width?: number;
  Height?: number;
  IsHD?: boolean;
  DateCreated?: string;
  ProductionYear?: number;
  RunTimeTicks?: number;
  UserData?: {
    Played: boolean;
    Rating?: number;
    PlayCount?: number;
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
  };
}

type EpisodeReturn<T> = T extends { includeMediaInfo: true }
  ? JellyfinLibraryItemExtended[]
  : JellyfinLibraryItem[];

export interface JellyfinItemsReponse {
  Items: JellyfinLibraryItemExtended[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinSession {
  Id: string;
  DeviceId?: string;
  DeviceName: string;
  Client: string;
  UserId?: string;
  UserName?: string;
  IsActive: boolean;
  SupportsMediaControl: boolean;
  SupportsRemoteControl: boolean;
  PlayableMediaTypes: string[];
  SupportedCommands: string[];
  NowPlayingItem?: JellyfinLibraryItemExtended;
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
  };
}

export interface JellyfinPlaylist {
  Id: string;
  Name: string;
  MediaType: 'Audio' | 'Video';
}

export const MAX_JELLYFIN_USERS = 1_000;
export const MAX_JELLYFIN_LIBRARIES = 10_000;
export const MAX_JELLYFIN_LIBRARY_ITEMS = 100_000;
export const MAX_JELLYFIN_EPISODES = 10_000;
export const MAX_JELLYFIN_SEASONS = 1_000;
export const MAX_JELLYFIN_MEDIA_SOURCES = 100;
export const MAX_JELLYFIN_MEDIA_STREAMS = 1_000;
const MAX_JELLYFIN_TEXT_LENGTH = 2_048;
const MAX_JELLYFIN_TOKEN_LENGTH = 4_096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedJellyfinText = (
  value: unknown,
  maximum = MAX_JELLYFIN_TEXT_LENGTH
) => (typeof value === 'string' ? value.slice(0, maximum) : '');

const optionalJellyfinInteger = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 10_000_000
    ? value
    : undefined;

// Jellyfin stores playback offsets and runtimes in 100-nanosecond ticks.
// Those values are routinely in the tens of billions, so they must not use
// the small bound intended for episode numbers and other ordinary integers.
const optionalJellyfinTicks = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const jellyfinItemTypes = [
  'Movie',
  'Episode',
  'Season',
  'Series',
  'MusicAlbum',
  'Audio',
  'AudioBook',
] as const;
const jellyfinLocationTypes = [
  'FileSystem',
  'Offline',
  'Remote',
  'Virtual',
] as const;
const jellyfinStreamTypes = ['Video', 'Audio', 'Subtitle'] as const;

const sanitizeJellyfinMediaStream = (
  value: unknown
): JellyfinMediaStream | undefined => {
  if (!isRecord(value) || !jellyfinStreamTypes.includes(value.Type as never)) {
    return undefined;
  }

  return {
    Codec: boundedJellyfinText(value.Codec, 128),
    Type: value.Type as JellyfinMediaStream['Type'],
    Height: optionalJellyfinInteger(value.Height),
    Width: optionalJellyfinInteger(value.Width),
    AverageFrameRate:
      typeof value.AverageFrameRate === 'number' &&
      Number.isFinite(value.AverageFrameRate) &&
      value.AverageFrameRate >= 0 &&
      value.AverageFrameRate <= 10_000
        ? value.AverageFrameRate
        : undefined,
    RealFrameRate:
      typeof value.RealFrameRate === 'number' &&
      Number.isFinite(value.RealFrameRate) &&
      value.RealFrameRate >= 0 &&
      value.RealFrameRate <= 10_000
        ? value.RealFrameRate
        : undefined,
    Language: boundedJellyfinText(value.Language, 128) || undefined,
    DisplayTitle: boundedJellyfinText(value.DisplayTitle, 512),
  };
};

const sanitizeJellyfinMediaSource = (
  value: unknown
): JellyfinMediaSource | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    Protocol: boundedJellyfinText(value.Protocol, 128),
    Id: boundedJellyfinText(value.Id, 128),
    Path: boundedJellyfinText(value.Path),
    Type: boundedJellyfinText(value.Type, 128),
    VideoType: boundedJellyfinText(value.VideoType, 128),
    MediaStreams: (Array.isArray(value.MediaStreams) ? value.MediaStreams : [])
      .slice(0, MAX_JELLYFIN_MEDIA_STREAMS)
      .flatMap((stream) => {
        const normalized = sanitizeJellyfinMediaStream(stream);
        return normalized ? [normalized] : [];
      }),
  };
};

export const sanitizeJellyfinLibraryItem = (
  value: unknown,
  includeExtended = false
): JellyfinLibraryItem | JellyfinLibraryItemExtended | undefined => {
  if (
    !isRecord(value) ||
    !jellyfinItemTypes.includes(value.Type as never) ||
    (value.LocationType !== undefined &&
      !jellyfinLocationTypes.includes(value.LocationType as never))
  ) {
    return undefined;
  }

  const id = boundedJellyfinText(value.Id, 128);
  if (!id) {
    return undefined;
  }

  const base: JellyfinLibraryItem = {
    Id: id,
    Name: boundedJellyfinText(value.Name, 512),
    HasSubtitles: value.HasSubtitles === true,
    Type: value.Type as JellyfinLibraryItem['Type'],
    LocationType:
      value.LocationType === undefined
        ? 'FileSystem'
        : (value.LocationType as JellyfinLibraryItem['LocationType']),
    SeriesName: boundedJellyfinText(value.SeriesName, 512) || undefined,
    SeriesId: boundedJellyfinText(value.SeriesId, 128) || undefined,
    SeasonId: boundedJellyfinText(value.SeasonId, 128) || undefined,
    SeasonName: boundedJellyfinText(value.SeasonName, 512) || undefined,
    IndexNumber: optionalJellyfinInteger(value.IndexNumber),
    IndexNumberEnd: optionalJellyfinInteger(value.IndexNumberEnd),
    ParentIndexNumber: optionalJellyfinInteger(value.ParentIndexNumber),
    MediaType: boundedJellyfinText(value.MediaType, 128),
  };

  if (!includeExtended) {
    return base;
  }

  const providerIds = isRecord(value.ProviderIds) ? value.ProviderIds : {};
  return {
    ...base,
    ProviderIds: {
      Tmdb: boundedJellyfinText(providerIds.Tmdb, 128) || undefined,
      TheMovieDb: boundedJellyfinText(providerIds.TheMovieDb, 128) || undefined,
      Imdb: boundedJellyfinText(providerIds.Imdb, 128) || undefined,
      Tvdb: boundedJellyfinText(providerIds.Tvdb, 128) || undefined,
      AniDB: boundedJellyfinText(providerIds.AniDB, 128) || undefined,
      MusicBrainzAlbum:
        boundedJellyfinText(
          providerIds.MusicBrainzAlbum ?? providerIds.MusicBrainzAlbumId,
          128
        ) || undefined,
      MusicBrainzReleaseGroup:
        boundedJellyfinText(
          providerIds.MusicBrainzReleaseGroup ??
            providerIds.MusicBrainzReleaseGroupId,
          128
        ) || undefined,
      MusicBrainzArtist:
        boundedJellyfinText(
          providerIds.MusicBrainzArtist ?? providerIds.MusicBrainzArtistId,
          128
        ) || undefined,
    },
    MediaSources: (Array.isArray(value.MediaSources) ? value.MediaSources : [])
      .slice(0, MAX_JELLYFIN_MEDIA_SOURCES)
      .flatMap((source) => {
        const normalized = sanitizeJellyfinMediaSource(source);
        return normalized ? [normalized] : [];
      }),
    Width: optionalJellyfinInteger(value.Width),
    Height: optionalJellyfinInteger(value.Height),
    IsHD: typeof value.IsHD === 'boolean' ? value.IsHD : undefined,
    DateCreated: boundedJellyfinText(value.DateCreated, 128) || undefined,
    ProductionYear: optionalJellyfinInteger(value.ProductionYear),
    RunTimeTicks: optionalJellyfinTicks(value.RunTimeTicks),
    UserData: isRecord(value.UserData)
      ? {
          Played: value.UserData.Played === true,
          Rating:
            typeof value.UserData.Rating === 'number' &&
            Number.isFinite(value.UserData.Rating) &&
            value.UserData.Rating >= 0 &&
            value.UserData.Rating <= 10
              ? value.UserData.Rating
              : undefined,
          PlayCount: optionalJellyfinInteger(value.UserData.PlayCount),
          PlaybackPositionTicks: optionalJellyfinTicks(
            value.UserData.PlaybackPositionTicks
          ),
          PlayedPercentage:
            typeof value.UserData.PlayedPercentage === 'number' &&
            Number.isFinite(value.UserData.PlayedPercentage) &&
            value.UserData.PlayedPercentage >= 0 &&
            value.UserData.PlayedPercentage <= 100
              ? value.UserData.PlayedPercentage
              : undefined,
        }
      : undefined,
  };
};

export const sanitizeJellyfinLibraryItems = (
  value: unknown,
  maximum: number,
  options: { includeExtended?: boolean; excludeVirtual?: boolean } = {}
): JellyfinLibraryItem[] | JellyfinLibraryItemExtended[] =>
  (Array.isArray(value) ? value : []).slice(0, maximum).flatMap((item) => {
    const normalized = sanitizeJellyfinLibraryItem(
      item,
      options.includeExtended
    );
    return normalized &&
      !(options.excludeVirtual && normalized.LocationType === 'Virtual')
      ? [normalized]
      : [];
  }) as JellyfinLibraryItem[] | JellyfinLibraryItemExtended[];

export const sanitizeJellyfinUser = (
  value: unknown
): JellyfinUserResponse | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedJellyfinText(value.Id, 128);
  const name = boundedJellyfinText(value.Name, 512);
  if (!id || !name) {
    return undefined;
  }
  const configuration = isRecord(value.Configuration)
    ? value.Configuration
    : {};
  const policy = isRecord(value.Policy) ? value.Policy : {};

  return {
    Id: id,
    Name: name,
    ServerId: boundedJellyfinText(value.ServerId, 128),
    ServerName: boundedJellyfinText(value.ServerName, 512),
    Configuration: {
      GroupedFolders: (Array.isArray(configuration.GroupedFolders)
        ? configuration.GroupedFolders
        : []
      )
        .slice(0, 1_000)
        .filter((folder): folder is string => typeof folder === 'string')
        .map((folder) => folder.slice(0, 512)),
    },
    Policy: { IsAdministrator: policy.IsAdministrator === true },
    PrimaryImageTag:
      boundedJellyfinText(value.PrimaryImageTag, 512) || undefined,
  };
};

export const sanitizeJellyfinUsers = (value: unknown): JellyfinUserResponse[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_JELLYFIN_USERS)
    .flatMap((user) => {
      const normalized = sanitizeJellyfinUser(user);
      return normalized ? [normalized] : [];
    });

export const sanitizeJellyfinLoginResponse = (
  value: unknown
): JellyfinLoginResponse => {
  if (!isRecord(value)) {
    throw new Error('Jellyfin returned an invalid authentication response');
  }
  const user = sanitizeJellyfinUser(value.User);
  const accessToken = value.AccessToken;
  if (
    !user ||
    typeof accessToken !== 'string' ||
    !accessToken ||
    accessToken.length > MAX_JELLYFIN_TOKEN_LENGTH
  ) {
    throw new Error('Jellyfin returned an invalid authentication response');
  }
  return { User: user, AccessToken: accessToken };
};

export const sanitizeJellyfinSystemInfo = (
  value: unknown
): { Id: string; ServerName: string } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundedJellyfinText(value.Id, 128);
  const serverName = boundedJellyfinText(value.ServerName, 512);
  return id && serverName ? { Id: id, ServerName: serverName } : undefined;
};

export const sanitizeJellyfinSession = (
  value: unknown
): JellyfinSession | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = boundedJellyfinText(value.Id, 128);
  const deviceName = boundedJellyfinText(value.DeviceName, 512);
  const client = boundedJellyfinText(value.Client, 512);
  if (!id || !deviceName || !client) {
    return undefined;
  }

  return {
    Id: id,
    DeviceId: boundedJellyfinText(value.DeviceId, 128) || undefined,
    DeviceName: deviceName,
    Client: client,
    UserId: boundedJellyfinText(value.UserId, 128) || undefined,
    UserName: boundedJellyfinText(value.UserName, 512) || undefined,
    IsActive: value.IsActive === true,
    SupportsMediaControl: value.SupportsMediaControl === true,
    SupportsRemoteControl: value.SupportsRemoteControl === true,
    PlayableMediaTypes: (Array.isArray(value.PlayableMediaTypes)
      ? value.PlayableMediaTypes
      : []
    )
      .slice(0, 20)
      .map((item) => boundedJellyfinText(item, 32))
      .filter(Boolean),
    SupportedCommands: (Array.isArray(value.SupportedCommands)
      ? value.SupportedCommands
      : []
    )
      .slice(0, 100)
      .map((item) => boundedJellyfinText(item, 64))
      .filter(Boolean),
    NowPlayingItem: sanitizeJellyfinLibraryItem(value.NowPlayingItem, true) as
      JellyfinLibraryItemExtended | undefined,
    PlayState: isRecord(value.PlayState)
      ? {
          PositionTicks: optionalJellyfinTicks(value.PlayState.PositionTicks),
          IsPaused:
            typeof value.PlayState.IsPaused === 'boolean'
              ? value.PlayState.IsPaused
              : undefined,
        }
      : undefined,
  };
};

class JellyfinAPI extends ExternalAPI {
  private userId?: string;
  private mediaServerType: MediaServerType;

  constructor(
    jellyfinHost: string,
    authToken?: string | null,
    deviceId?: string | null,
    allowPrivateAddresses = true
  ) {
    const settings = getSettings();
    const safeDeviceId =
      deviceId && deviceId.length > 0
        ? deviceId
        : Buffer.from('BOT_seerr').toString('base64');

    const version =
      settings.main.mediaServerType === MediaServerType.EMBY
        ? '1.0.0'
        : getAppVersion();

    let authHeaderVal = `MediaBrowser Client="Seerr", Device="Seerr", DeviceId="${safeDeviceId}", Version="${version}"`;
    if (authToken) {
      authHeaderVal += `, Token="${authToken}"`;
    }

    super(
      jellyfinHost,
      {},
      {
        allowPrivateAddresses,
        allowUnconfiguredBaseUrl: true,
        headers: {
          Authorization: authHeaderVal,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    this.mediaServerType = settings.main.mediaServerType;
  }

  public async login(
    Username?: string,
    Password?: string,
    ClientIP?: string
  ): Promise<JellyfinLoginResponse> {
    const authenticate = async (useHeaders: boolean) => {
      const headers =
        useHeaders && ClientIP ? { 'X-Forwarded-For': ClientIP } : {};

      return sanitizeJellyfinLoginResponse(
        await this.post<unknown>(
          '/Users/AuthenticateByName',
          {
            Username,
            Pw: Password,
          },
          { headers }
        )
      );
    };

    try {
      return await authenticate(true);
    } catch (e) {
      logger.debug('Failed to authenticate with headers', {
        label: 'Jellyfin API',
        error: e.response?.statusText,
        ip: ClientIP,
      });

      if (!e.response?.status) {
        throw new ApiError(404, ApiErrorCode.InvalidUrl);
      }

      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }
    }

    try {
      return await authenticate(false);
    } catch (e) {
      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }

      logger.error(
        `Something went wrong while authenticating with the Jellyfin server: ${e.message}`,
        {
          label: 'Jellyfin API',
          error: e.response?.status,
          ip: ClientIP,
        }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async initiateQuickConnect(): Promise<QuickConnectInitiateResponse> {
    try {
      const response = await this.post<QuickConnectInitiateResponse>(
        '/QuickConnect/Initiate'
      );

      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while initiating Quick Connect: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async checkQuickConnect(
    secret: string
  ): Promise<QuickConnectStatusResponse> {
    try {
      const response = await this.get<QuickConnectStatusResponse>(
        '/QuickConnect/Connect',
        { params: { secret } }
      );

      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while getting Quick Connect status: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async authenticateQuickConnect(
    secret: string
  ): Promise<JellyfinLoginResponse> {
    try {
      const response = await this.post<JellyfinLoginResponse>(
        '/Users/AuthenticateWithQuickConnect',
        { Secret: secret }
      );
      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while authenticating with Quick Connect: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public setUserId(userId: string): void {
    this.userId = normalizeJellyfinGuid(userId) ?? undefined;
    return;
  }

  public async getUserItemPlayed(itemId: string): Promise<boolean> {
    if (!this.userId) {
      return false;
    }
    const response = await this.get<unknown>(
      `/Users/${encodeURIComponent(this.userId)}/Items/${encodeURIComponent(
        boundedJellyfinText(itemId, 128)
      )}`
    );
    return (
      isRecord(response) &&
      isRecord(response.UserData) &&
      response.UserData.Played === true
    );
  }

  public async getUserWatchEpisodes(
    seriesId: string
  ): Promise<JellyfinWatchEpisode[]> {
    if (!this.userId) {
      return [];
    }
    const response = await this.get<unknown>(
      `/Users/${encodeURIComponent(this.userId)}/Items`,
      {
        params: {
          ParentId: boundedJellyfinText(seriesId, 128),
          Recursive: true,
          IncludeItemTypes: 'Episode',
          EnableUserData: true,
          Limit: MAX_JELLYFIN_EPISODES,
        },
      }
    );
    const items =
      isRecord(response) && Array.isArray(response.Items) ? response.Items : [];
    return items.slice(0, MAX_JELLYFIN_EPISODES).flatMap((item) => {
      if (
        !isRecord(item) ||
        item.Type !== 'Episode' ||
        item.LocationType === 'Virtual' ||
        !Number.isSafeInteger(item.ParentIndexNumber) ||
        !Number.isSafeInteger(item.IndexNumber)
      ) {
        return [];
      }
      return [
        {
          seasonNumber: item.ParentIndexNumber as number,
          episodeNumber: item.IndexNumber as number,
          played: isRecord(item.UserData) && item.UserData.Played === true,
        },
      ];
    });
  }

  public async getSystemInfo(): Promise<{ Id: string; ServerName: string }> {
    try {
      const systemInfoResponse = sanitizeJellyfinSystemInfo(
        await this.get<unknown>('/System/Info')
      );

      if (!systemInfoResponse) {
        throw new Error('Jellyfin returned invalid system information');
      }
      return systemInfoResponse;
    } catch (e) {
      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getServerName(): Promise<string> {
    try {
      const serverResponse = await this.get<JellyfinUserResponse>(
        '/System/Info/Public'
      );

      const serverName = boundedJellyfinText(serverResponse?.ServerName, 512);
      if (!serverName) {
        throw new Error('Jellyfin returned an invalid server name');
      }
      return serverName;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the server name from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }
  }

  public async getUsers(): Promise<JellyfinUserListResponse> {
    try {
      const userReponse = await this.get<unknown>(`/Users`);

      return { users: sanitizeJellyfinUsers(userReponse) };
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUser(): Promise<JellyfinUserResponse> {
    try {
      const userReponse = sanitizeJellyfinUser(
        await this.get<unknown>(`/Users/${this.userId ?? 'Me'}`)
      );
      if (!userReponse) {
        throw new Error('Jellyfin returned an invalid user');
      }
      return userReponse;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getLibraries(): Promise<JellyfinLibrary[]> {
    try {
      const mediaFolderResponse = await this.get<any>(`/Library/MediaFolders`);

      return this.mapLibraries(mediaFolderResponse.Items);
    } catch {
      // fallback to user views to get libraries
      // this only and maybe/depending on factors affects LDAP users
      try {
        const mediaFolderResponse = await this.get<any>(
          `/Users/${encodeURIComponent(this.userId ?? 'Me')}/Views`
        );

        return this.mapLibraries(mediaFolderResponse.Items);
      } catch (e) {
        logger.error(
          `Something went wrong while getting libraries from the Jellyfin server: ${e.message}`,
          {
            label: 'Jellyfin API',
            error: e.response?.status,
          }
        );

        if (!e.response) {
          throw new ApiError(502, ApiErrorCode.ConnectionError);
        }

        return [];
      }
    }
  }

  /**
   * Return only the views visible to the linked user. Do not fall back to
   * /Library/MediaFolders here: that endpoint can expose the server-wide
   * library list when called with an administrator credential.
   */
  public async getUserLibraries(): Promise<JellyfinLibrary[]> {
    if (!this.userId) {
      throw new ApiError(409, ApiErrorCode.InvalidAuthToken);
    }
    try {
      const response = await this.get<unknown>(
        `/Users/${encodeURIComponent(this.userId)}/Views`
      );
      return this.mapLibraries(isRecord(response) ? response.Items : undefined);
    } catch (e) {
      logger.error(
        `Something went wrong while getting user libraries from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }
      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUserLibraryContents(
    id: string,
    libraryType: 'show' | 'movie',
    {
      offset = 0,
      size = 20,
      isPlayed,
    }: { offset?: number; size?: number; isPlayed?: boolean } = {}
  ): Promise<JellyfinItemsReponse> {
    if (!this.userId) {
      throw new ApiError(409, ApiErrorCode.InvalidAuthToken);
    }
    const safeOffset =
      Number.isSafeInteger(offset) && offset >= 0
        ? Math.min(offset, MAX_JELLYFIN_LIBRARY_ITEMS)
        : 0;
    const safeSize =
      Number.isSafeInteger(size) && size > 0 ? Math.min(size, 100) : 20;
    try {
      // Use the current /Items query with an explicit userId. The linked
      // user's own token and user scope are both required for UserData.
      const response = await this.get<unknown>('/Items', {
        params: {
          userId: this.userId,
          parentId: boundedJellyfinText(id, 128),
          recursive: true,
          includeItemTypes: libraryType === 'movie' ? 'Movie' : 'Series',
          fields: 'ProviderIds,UserData',
          enableUserData: true,
          enableTotalRecordCount: true,
          enableImages: false,
          sortBy: 'SortName',
          sortOrder: 'Ascending',
          startIndex: safeOffset,
          limit: safeSize,
          ...(isPlayed === undefined ? {} : { isPlayed }),
        },
      });
      if (!isRecord(response)) {
        throw new Error('Jellyfin returned an invalid user library response.');
      }
      const items = sanitizeJellyfinLibraryItems(response.Items, safeSize, {
        includeExtended: true,
        excludeVirtual: true,
      }) as JellyfinLibraryItemExtended[];
      const totalRecordCount =
        Number.isSafeInteger(response.TotalRecordCount) &&
        Number(response.TotalRecordCount) >= 0
          ? Math.min(
              Number(response.TotalRecordCount),
              MAX_JELLYFIN_LIBRARY_ITEMS
            )
          : items.length;
      return {
        Items: items,
        TotalRecordCount: totalRecordCount,
        StartIndex: safeOffset,
      };
    } catch (e) {
      logger.error(
        `Something went wrong while getting user library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }
      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  private mapLibraries(mediaFolders: unknown): JellyfinLibrary[] {
    const excludedTypes = ['books', 'musicvideos', 'homevideos', 'boxsets'];

    return (Array.isArray(mediaFolders) ? mediaFolders : [])
      .slice(0, MAX_JELLYFIN_LIBRARIES)
      .flatMap((item) => {
        if (!isRecord(item)) return [];
        const collectionType = boundedJellyfinText(
          item.CollectionType,
          128
        ).toLowerCase();
        const key = boundedJellyfinText(item.Id, 128);
        const title = boundedJellyfinText(item.Name, 512);
        if (
          item.Type !== 'CollectionFolder' ||
          excludedTypes.includes(collectionType) ||
          !key ||
          !title
        ) {
          return [];
        }
        const type =
          collectionType === 'movies'
            ? ('movie' as const)
            : collectionType === 'music'
              ? ('music' as const)
              : ('show' as const);

        return [{ key, title, type, agent: 'jellyfin' }];
      });
  }

  public async getLibraryContents(
    id: string,
    libraryType?: JellyfinLibrary['type']
  ): Promise<JellyfinLibraryItem[]> {
    try {
      const libraryItemsResponse = await this.get<any>('/Items', {
        params: {
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          IncludeItemTypes:
            libraryType === 'music' ? 'MusicAlbum' : 'Series,Movie,Others',
          Recursive: true,
          StartIndex: 0,
          ParentId: boundedJellyfinText(id, 128),
          collapseBoxSetItems: false,
        },
      });

      return sanitizeJellyfinLibraryItems(
        libraryItemsResponse?.Items,
        MAX_JELLYFIN_LIBRARY_ITEMS,
        { excludeVirtual: true }
      ) as JellyfinLibraryItem[];
    } catch (e) {
      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e?.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getRecentlyAdded(
    id: string,
    libraryType?: JellyfinLibrary['type']
  ): Promise<JellyfinLibraryItem[]> {
    try {
      const endpoint =
        this.mediaServerType === MediaServerType.JELLYFIN
          ? `/Items/Latest`
          : `/Users/${this.userId}/Items/Latest`;
      const itemResponse = await this.get<unknown>(endpoint, {
        params: {
          Limit: 12,
          ParentId: boundedJellyfinText(id, 128),
          IncludeItemTypes:
            libraryType === 'music' ? 'MusicAlbum' : 'Series,Movie,Others',
          ...(this.mediaServerType === MediaServerType.JELLYFIN
            ? { userId: this.userId ?? 'Me' }
            : {}),
        },
      });

      return sanitizeJellyfinLibraryItems(itemResponse, 100, {
        excludeVirtual: true,
      }) as JellyfinLibraryItem[];
    } catch (e) {
      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  // Unlike the legacy availability lookup, never turn a server error or a
  // malformed response into an empty (apparently deleted) item.
  public async getItemDataForDeletionCheck(
    id: string
  ): Promise<JellyfinLibraryItemExtended | undefined> {
    const response = await this.get<JellyfinItemsReponse>('/Items', {
      params: {
        ids: id,
        fields: 'ProviderIds,MediaSources,Width,Height,IsHD,DateCreated',
      },
    });
    if (!Array.isArray(response?.Items))
      throw new Error('Invalid media-server item response');
    if (!response.Items.length) return undefined;
    const item = sanitizeJellyfinLibraryItem(response.Items[0], true) as
      JellyfinLibraryItemExtended | undefined;
    if (!item || item.Id !== id)
      throw new Error('Unverified media-server item identity');
    return item;
  }

  public async getItemData(
    id: string
  ): Promise<JellyfinLibraryItemExtended | undefined> {
    try {
      const itemResponse = await this.get<JellyfinItemsReponse>(`/Items`, {
        params: {
          ids: id,
          fields: 'ProviderIds,MediaSources,Width,Height,IsHD,DateCreated',
        },
      });

      return sanitizeJellyfinLibraryItem(
        Array.isArray(itemResponse?.Items) ? itemResponse.Items[0] : undefined,
        true
      ) as JellyfinLibraryItemExtended | undefined;
    } catch (e) {
      if (availabilitySync.running) {
        if (e.response?.status === 500) {
          return undefined;
        }
      }

      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getChildren(
    parentId: string,
    includeItemTypes: ('Audio' | 'AudioBook')[] = ['Audio', 'AudioBook']
  ): Promise<JellyfinLibraryItem[]> {
    const itemResponse = await this.get<unknown>('/Items', {
      params: {
        ParentId: boundedJellyfinText(parentId, 128),
        IncludeItemTypes: includeItemTypes.join(','),
        Recursive: true,
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending',
      },
    });
    const items =
      isRecord(itemResponse) && Array.isArray(itemResponse.Items)
        ? itemResponse.Items
        : [];

    return sanitizeJellyfinLibraryItems(items, MAX_JELLYFIN_LIBRARY_ITEMS, {
      excludeVirtual: true,
    }) as JellyfinLibraryItem[];
  }

  public async getAudioChildrenWithMediaInfo(
    parentId: string
  ): Promise<JellyfinLibraryItemExtended[]> {
    const itemResponse = await this.get<unknown>('/Items', {
      params: {
        ParentId: boundedJellyfinText(parentId, 128),
        IncludeItemTypes: 'Audio,AudioBook',
        Recursive: true,
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending',
        Fields: 'MediaSources',
      },
    });
    const items =
      isRecord(itemResponse) && Array.isArray(itemResponse.Items)
        ? itemResponse.Items
        : [];

    return sanitizeJellyfinLibraryItems(items, MAX_JELLYFIN_LIBRARY_ITEMS, {
      includeExtended: true,
      excludeVirtual: true,
    }) as JellyfinLibraryItemExtended[];
  }

  public async getControllableSessions(
    controllingUserId: string
  ): Promise<JellyfinSession[]> {
    const response = await this.get<unknown>('/Sessions', {
      params: {
        ControllableByUserId: boundedJellyfinText(controllingUserId, 128),
        ActiveWithinSeconds: 300,
      },
    });

    return (Array.isArray(response) ? response : [])
      .slice(0, 100)
      .flatMap((session) => {
        const normalized = sanitizeJellyfinSession(session);
        return normalized ? [normalized] : [];
      })
      .filter(
        (session) =>
          session.IsActive &&
          session.SupportsMediaControl &&
          session.SupportsRemoteControl
      );
  }

  public async getPlaybackSessions(): Promise<JellyfinSession[]> {
    const response = await this.get<unknown>('/Sessions', {
      params: { ActiveWithinSeconds: 300 },
    });

    return (Array.isArray(response) ? response : [])
      .slice(0, 100)
      .flatMap((session) => {
        const normalized = sanitizeJellyfinSession(session);
        return normalized?.IsActive && normalized.NowPlayingItem
          ? [normalized]
          : [];
      });
  }

  public async getUserPlaybackItem(
    userId: string,
    itemId: string
  ): Promise<JellyfinLibraryItemExtended | undefined> {
    const safeUserId = boundedJellyfinText(userId, 128);
    const safeItemId = boundedJellyfinText(itemId, 128);
    if (!safeUserId || !safeItemId) {
      return undefined;
    }

    const response = await this.get<unknown>(
      `/Users/${encodeURIComponent(safeUserId)}/Items/${encodeURIComponent(safeItemId)}`,
      { params: { fields: 'UserData,ProviderIds,RunTimeTicks' } }
    );
    const item = sanitizeJellyfinLibraryItem(response, true) as
      JellyfinLibraryItemExtended | undefined;
    return item?.Id === safeItemId ? item : undefined;
  }

  public async playOnSession(
    sessionId: string,
    itemIds: string[]
  ): Promise<void> {
    const safeSessionId = boundedJellyfinText(sessionId, 128);
    const safeItemIds = itemIds
      .slice(0, 1_000)
      .map((itemId) => boundedJellyfinText(itemId, 128))
      .filter(Boolean);
    if (!safeSessionId || safeItemIds.length === 0) {
      throw new Error(
        'A playback session and at least one media item are required.'
      );
    }

    await this.post(
      `/Sessions/${encodeURIComponent(safeSessionId)}/Playing`,
      undefined,
      {
        params: {
          PlayCommand: 'PlayNow',
          ItemIds: safeItemIds.join(','),
          StartIndex: 0,
        },
      }
    );
  }

  public async replacePlaylist(
    name: string,
    itemIds: string[],
    mediaType: 'Audio' | 'Video',
    userId: string
  ): Promise<JellyfinPlaylist> {
    const safeName = boundedJellyfinText(name, 256).trim();
    const safeUserId = boundedJellyfinText(userId, 128);
    const safeItemIds = itemIds
      .slice(0, 1_000)
      .map((itemId) => boundedJellyfinText(itemId, 128))
      .filter(Boolean);
    if (!safeName || !safeUserId || safeItemIds.length === 0) {
      throw new Error(
        'A playlist name, user, and at least one media item are required.'
      );
    }

    const playlistResponse = await this.get<unknown>(
      `/Users/${encodeURIComponent(safeUserId)}/Items`,
      {
        params: {
          IncludeItemTypes: 'Playlist',
          Recursive: true,
          Fields: 'MediaType',
        },
      },
      0
    );
    const existingPlaylistIds = (
      isRecord(playlistResponse) && Array.isArray(playlistResponse.Items)
        ? playlistResponse.Items
        : []
    )
      .slice(0, 10_000)
      .flatMap((playlist) => {
        if (!isRecord(playlist)) {
          return [];
        }
        const playlistName = boundedJellyfinText(playlist.Name, 256);
        const playlistId = boundedJellyfinText(playlist.Id, 128);
        return playlistName === safeName && playlistId ? [playlistId] : [];
      });

    // This exact name is SeerrNG-owned. Delete any remnants first so the
    // replacement remains one list even when media type changes.
    for (const playlistId of existingPlaylistIds) {
      await this.request('DELETE', `/Items/${encodeURIComponent(playlistId)}`);
    }

    const response = await this.request<unknown>('POST', '/Playlists', null, {
      params: {
        UserId: safeUserId,
        Name: safeName,
        Ids: safeItemIds.join(','),
        MediaType: mediaType,
      },
    });
    const playlistId = isRecord(response.data)
      ? boundedJellyfinText(response.data.Id, 128)
      : '';
    if (!playlistId) {
      throw new Error(
        `${this.mediaServerType === MediaServerType.EMBY ? 'Emby' : 'Jellyfin'} did not create the replacement playlist.`
      );
    }

    return { Id: playlistId, Name: safeName, MediaType: mediaType };
  }

  public async getSeasons(seriesID: string): Promise<JellyfinLibraryItem[]> {
    try {
      const seasonResponse = await this.get<any>(
        `/Shows/${encodeURIComponent(boundedJellyfinText(seriesID, 128))}/Seasons`
      );

      return sanitizeJellyfinLibraryItems(
        seasonResponse?.Items,
        MAX_JELLYFIN_SEASONS
      ) as JellyfinLibraryItem[];
    } catch (e) {
      logger.error(
        `Something went wrong while getting the list of seasons from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getEpisodes<
    T extends { includeMediaInfo?: boolean } | undefined = undefined,
  >(
    seriesID: string,
    seasonID: string,
    options?: T
  ): Promise<EpisodeReturn<T>> {
    try {
      const episodeResponse = await this.get<any>(
        `/Shows/${encodeURIComponent(boundedJellyfinText(seriesID, 128))}/Episodes`,
        {
          params: {
            seasonId: boundedJellyfinText(seasonID, 128),
            ...(options?.includeMediaInfo && { fields: 'MediaSources' }),
          },
        }
      );

      return sanitizeJellyfinLibraryItems(
        episodeResponse?.Items,
        MAX_JELLYFIN_EPISODES,
        {
          includeExtended: options?.includeMediaInfo === true,
          excludeVirtual: true,
        }
      ) as EpisodeReturn<T>;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the list of episodes from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async createApiToken(appName: string): Promise<string> {
    try {
      const normalizedAppName = boundedJellyfinText(appName, 128);
      if (!normalizedAppName) {
        throw new Error('Jellyfin API key application name is invalid');
      }
      await this.post('/Auth/Keys', undefined, {
        params: { App: normalizedAppName },
      });
      const apiKeys = await this.get<unknown>(`/Auth/Keys`);
      const items =
        isRecord(apiKeys) && Array.isArray(apiKeys.Items)
          ? apiKeys.Items.slice(0, 1_000)
          : [];
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!isRecord(item) || item.AppName !== normalizedAppName) {
          continue;
        }
        if (
          typeof item.AccessToken === 'string' &&
          item.AccessToken &&
          item.AccessToken.length <= MAX_JELLYFIN_TOKEN_LENGTH
        ) {
          return item.AccessToken;
        }
      }
      throw new Error('Jellyfin did not return the created API key');
    } catch (e) {
      logger.error(
        `Something went wrong while creating an API key from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.InvalidAuthToken);
    }
  }
}

export default JellyfinAPI;
