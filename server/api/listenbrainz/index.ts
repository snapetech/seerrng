import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import {
  isValidMusicBrainzResourceId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import type {
  LbAlbumDetails,
  LbArtistDetails,
  LbFreshReleasesResponse,
  LbRelease,
  LbReleaseGroup,
  LbTopAlbumsResponse,
  LbTopArtistsResponse,
} from './interfaces';

const MAX_LISTENBRAINZ_PAGE_SIZE = 100;
const MAX_LISTENBRAINZ_TOTAL_RESULTS = 10_000_000;
const MAX_LISTENBRAINZ_TEXT_LENGTH = 1000;
const MAX_LISTENBRAINZ_ARTIST_IDS = 20;
const MAX_LISTENBRAINZ_RELEASE_TAGS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedInteger = (
  value: unknown,
  fallback = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.trunc(value)))
    : fallback;

const boundedString = (
  value: unknown,
  maximum = MAX_LISTENBRAINZ_TEXT_LENGTH
) => (typeof value === 'string' ? value.slice(0, maximum) : '');

const boundedStrings = (value: unknown, maximum: number): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, maximum)
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.slice(0, MAX_LISTENBRAINZ_TEXT_LENGTH))
    : [];

const clampPageSize = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_LISTENBRAINZ_PAGE_SIZE, Math.max(1, Math.trunc(value)))
    : 20;

const clampOffset = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(MAX_LISTENBRAINZ_TOTAL_RESULTS, Math.max(0, Math.trunc(value)))
    : 0;

const hasReleaseGroups = (data: unknown): boolean =>
  isRecord(data) &&
  isRecord(data.payload) &&
  Array.isArray(data.payload.release_groups) &&
  data.payload.release_groups.length > 0;

const hasFreshReleases = (data: unknown): boolean =>
  isRecord(data) &&
  isRecord(data.payload) &&
  Array.isArray(data.payload.releases) &&
  data.payload.releases.length > 0;

const sanitizeReleaseGroup = (value: unknown): LbReleaseGroup | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const releaseGroupMbid = boundedString(value.release_group_mbid, 128);
  const releaseGroupName = boundedString(value.release_group_name);
  if (!releaseGroupMbid || !releaseGroupName) {
    return undefined;
  }

  return {
    artist_mbids: boundedStrings(
      value.artist_mbids,
      MAX_LISTENBRAINZ_ARTIST_IDS
    ),
    artist_name: boundedString(value.artist_name),
    caa_id: boundedInteger(value.caa_id),
    caa_release_mbid: boundedString(value.caa_release_mbid, 128),
    listen_count: boundedInteger(value.listen_count),
    release_group_mbid: releaseGroupMbid,
    release_group_name: releaseGroupName,
  };
};

const sanitizeRelease = (value: unknown): LbRelease | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const releaseGroupMbid = boundedString(value.release_group_mbid, 128);
  const releaseName = boundedString(value.release_name);
  if (!releaseGroupMbid || !releaseName) {
    return undefined;
  }

  return {
    artist_credit_name: boundedString(value.artist_credit_name),
    artist_mbids: boundedStrings(
      value.artist_mbids,
      MAX_LISTENBRAINZ_ARTIST_IDS
    ),
    caa_id: boundedInteger(value.caa_id),
    caa_release_mbid: boundedString(value.caa_release_mbid, 128),
    listen_count: boundedInteger(value.listen_count),
    release_date: boundedString(value.release_date, 64),
    release_group_mbid: releaseGroupMbid,
    release_group_primary_type: boundedString(
      value.release_group_primary_type,
      128
    ),
    release_group_secondary_type: boundedString(
      value.release_group_secondary_type,
      128
    ),
    release_mbid: boundedString(value.release_mbid, 128),
    release_name: releaseName,
    release_tags: boundedStrings(
      value.release_tags,
      MAX_LISTENBRAINZ_RELEASE_TAGS
    ),
  };
};

class ListenBrainzAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.listenbrainz.org/1',
      {},
      {
        allowedBaseUrls: ['https://listenbrainz.org'],
        nodeCache: cacheManager.getCache('listenbrainz').data,
        rateLimit: {
          maxRequests: 20,
          maxRPS: 25,
        },
      }
    );
  }

  public async getAlbum(mbid: string): Promise<LbAlbumDetails> {
    const normalizedMbid = normalizeMusicBrainzId(mbid);

    if (!isValidMusicBrainzResourceId(normalizedMbid)) {
      throw new Error('[ListenBrainz] Invalid MusicBrainz album ID');
    }

    try {
      return await this.post<LbAlbumDetails>(
        `/album/${encodeURIComponent(normalizedMbid)}/`,
        {},
        {
          baseURL: 'https://listenbrainz.org',
        },
        43200
      );
    } catch (e) {
      throw new Error(
        `[ListenBrainz] Failed to fetch album details: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async getArtist(mbid: string): Promise<LbArtistDetails> {
    const normalizedMbid = normalizeMusicBrainzId(mbid);

    if (!isValidMusicBrainzResourceId(normalizedMbid)) {
      throw new Error('[ListenBrainz] Invalid MusicBrainz artist ID');
    }

    try {
      return await this.post<LbArtistDetails>(
        `/artist/${encodeURIComponent(normalizedMbid)}/`,
        {},
        {
          baseURL: 'https://listenbrainz.org',
        },
        43200
      );
    } catch (e) {
      throw new Error(
        `[ListenBrainz] Failed to fetch artist details: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async getTopAlbums({
    offset = 0,
    range = 'month',
    count = 20,
  }: {
    offset?: number;
    range?: string;
    count?: number;
  }): Promise<LbTopAlbumsResponse> {
    const boundedCount = clampPageSize(count);
    const data = await this.get<unknown>(
      '/stats/sitewide/release-groups',
      {
        params: {
          offset: clampOffset(offset).toString(),
          range: boundedString(range, 32) || 'month',
          count: boundedCount.toString(),
        },
      },
      43200,
      hasReleaseGroups
    );
    const payload =
      isRecord(data) && isRecord(data.payload) ? data.payload : {};

    return {
      payload: {
        count: boundedInteger(payload.count, 0, MAX_LISTENBRAINZ_TOTAL_RESULTS),
        from_ts: boundedInteger(payload.from_ts),
        last_updated: boundedInteger(payload.last_updated),
        offset: boundedInteger(payload.offset, clampOffset(offset)),
        range: boundedString(payload.range, 32),
        release_groups: (Array.isArray(payload.release_groups)
          ? payload.release_groups
          : []
        )
          .slice(0, boundedCount)
          .flatMap((value) => {
            const releaseGroup = sanitizeReleaseGroup(value);
            return releaseGroup ? [releaseGroup] : [];
          }),
        to_ts: boundedInteger(payload.to_ts),
      },
    };
  }

  public async getTopArtists({
    offset = 0,
    range = 'month',
    count = 20,
  }: {
    offset?: number;
    range?: string;
    count?: number;
  }): Promise<LbTopArtistsResponse> {
    const boundedCount = clampPageSize(count);
    const data = await this.get<unknown>(
      '/stats/sitewide/artists',
      {
        params: {
          offset: clampOffset(offset).toString(),
          range: boundedString(range, 32) || 'month',
          count: boundedCount.toString(),
        },
      },
      43200
    );
    const payload =
      isRecord(data) && isRecord(data.payload) ? data.payload : {};

    return {
      payload: {
        count: boundedInteger(payload.count, 0, MAX_LISTENBRAINZ_TOTAL_RESULTS),
        from_ts: boundedInteger(payload.from_ts),
        last_updated: boundedInteger(payload.last_updated),
        offset: boundedInteger(payload.offset, clampOffset(offset)),
        range: boundedString(payload.range, 32),
        artists: (Array.isArray(payload.artists) ? payload.artists : [])
          .slice(0, boundedCount)
          .flatMap((value) => {
            if (!isRecord(value)) {
              return [];
            }

            const artistMbid = boundedString(value.artist_mbid, 128);
            const artistName = boundedString(value.artist_name);
            return artistMbid && artistName
              ? [
                  {
                    artist_mbid: artistMbid,
                    artist_name: artistName,
                    listen_count: boundedInteger(value.listen_count),
                  },
                ]
              : [];
          }),
        to_ts: boundedInteger(payload.to_ts),
      },
    };
  }

  public async getFreshReleases({
    days = 7,
    sort = 'release_date',
    order = 'asc',
    offset = 0,
    count = 20,
  }: {
    days?: number;
    sort?: string;
    order?: 'asc' | 'desc';
    offset?: number;
    count?: number;
  } = {}): Promise<LbFreshReleasesResponse> {
    const boundedCount = clampPageSize(count);
    const data = await this.get<unknown>(
      '/explore/fresh-releases/',
      {
        params: {
          days: boundedInteger(days, 7, 3650).toString(),
          sort: boundedString(sort, 64) || 'release_date',
          offset: clampOffset(offset).toString(),
          count: boundedCount.toString(),
        },
      },
      43200,
      hasFreshReleases
    );
    const payload =
      isRecord(data) && isRecord(data.payload) ? data.payload : {};

    const releases = (
      Array.isArray(payload.releases) ? payload.releases : []
    ).flatMap((value) => {
      const release = sanitizeRelease(value);
      return release ? [release] : [];
    });
    const orderedReleases = order === 'desc' ? releases.reverse() : releases;
    const boundedOffset = clampOffset(offset);

    return {
      payload: {
        releases: orderedReleases.slice(
          boundedOffset,
          boundedOffset + boundedCount
        ),
      },
    };
  }
}

export default ListenBrainzAPI;
