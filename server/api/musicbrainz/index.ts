import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import {
  isValidMusicBrainzResourceId,
  normalizeMusicBrainzId,
} from '@server/lib/externalIds';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import axios from 'axios';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import type {
  MbAlbumDetails,
  MbArtistDetails,
  MbLink,
  MbRecordingDetails,
} from './interfaces';

const window = new JSDOM('').window;
const purify = DOMPurify(window);
export const WIKIPEDIA_EXTRACT_HTTP_OPTIONS = {
  ...createSafeHttpRequestOptions(),
  timeout: 10_000,
  maxRedirects: 3,
  maxContentLength: 256 * 1024,
  maxBodyLength: 1024,
};

export const escapeMusicBrainzQuery = (value: string): string =>
  value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

export const MAX_MUSICBRAINZ_PAGE_SIZE = 100;
export const MAX_MUSICBRAINZ_ARTIST_CREDITS = 20;
export const MAX_MUSICBRAINZ_RELEASES = 500;
export const MAX_MUSICBRAINZ_TAGS = 200;
export const MAX_MUSICBRAINZ_LINKS = 100;
export const MAX_MUSICBRAINZ_RECORDING_RELEASES = 100;
export const MAX_MUSICBRAINZ_LABELS = 25;
export const MAX_MUSICBRAINZ_TEXT_LENGTH = 1_000;
export const MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundText = (value: unknown, maxLength = MAX_MUSICBRAINZ_TEXT_LENGTH) =>
  typeof value === 'string' ? value.slice(0, maxLength) : '';

export const sanitizeMusicBrainzReleaseLabels = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value['label-info'])) {
    return [];
  }

  return value['label-info']
    .slice(0, MAX_MUSICBRAINZ_LABELS)
    .map((entry) => {
      if (!isRecord(entry) || !isRecord(entry.label)) {
        return undefined;
      }

      const name = boundText(entry.label.name, 256).trim();
      return name || undefined;
    })
    .filter((name): name is string => !!name);
};

const clampPageSize = (value: number, fallback: number): number =>
  Math.min(
    MAX_MUSICBRAINZ_PAGE_SIZE,
    Math.max(
      1,
      Number.isFinite(value) ? Math.trunc(value) : Math.trunc(fallback)
    )
  );

const boundStringArray = (value: unknown, limit: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && !!item)
        .slice(0, limit)
        .map((item) => item.slice(0, 128))
    : [];

const sanitizeLinks = (value: unknown): MbLink[] =>
  Array.isArray(value)
    ? value
        .slice(0, MAX_MUSICBRAINZ_LINKS)
        .map((link) => {
          if (!isRecord(link)) {
            return undefined;
          }
          const type = boundText(link.type, 128);
          const target = boundText(link.target, 2_048);
          return type && target ? { type, target } : undefined;
        })
        .filter((link): link is MbLink => !!link)
    : [];

export const sanitizeMusicBrainzAlbum = (
  value: unknown
): MbAlbumDetails | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundText(value.id, 128);
  const title = boundText(value.title);
  if (!id || !title) {
    return undefined;
  }
  const artistCredit = Array.isArray(value['artist-credit'])
    ? value['artist-credit']
        .slice(0, MAX_MUSICBRAINZ_ARTIST_CREDITS)
        .map((credit) => {
          if (!isRecord(credit) || !isRecord(credit.artist)) {
            return undefined;
          }
          const artistId = boundText(credit.artist.id, 128);
          const artistName = boundText(credit.artist.name);
          if (!artistId || !artistName) {
            return undefined;
          }
          return {
            name: boundText(credit.name) || artistName,
            artist: {
              id: artistId,
              name: artistName,
              'sort-name': boundText(credit.artist['sort-name']) || artistName,
              overview: boundText(credit.artist.overview, 10_000) || undefined,
            },
          };
        })
        .filter(
          (credit): credit is NonNullable<typeof credit> => credit !== undefined
        )
    : [];
  const releases = Array.isArray(value.releases)
    ? value.releases
        .slice(0, MAX_MUSICBRAINZ_RELEASES)
        .map((release) => {
          if (!isRecord(release)) {
            return undefined;
          }
          const releaseId = boundText(release.id, 128);
          if (!releaseId) {
            return undefined;
          }
          return {
            id: releaseId,
            title: boundText(release.title),
            status: boundText(release.status, 128),
            'status-id': boundText(release['status-id'], 128),
          };
        })
        .filter(
          (release): release is MbAlbumDetails['releases'][number] => !!release
        )
    : [];
  const tags = Array.isArray(value.tags)
    ? value.tags
        .slice(0, MAX_MUSICBRAINZ_TAGS)
        .map((tag) =>
          isRecord(tag) && typeof tag.name === 'string'
            ? {
                name: boundText(tag.name, 256),
                count:
                  typeof tag.count === 'number' && Number.isFinite(tag.count)
                    ? tag.count
                    : 0,
              }
            : undefined
        )
        .filter((tag): tag is { name: string; count: number } => !!tag?.name)
    : [];
  const primaryType =
    value['primary-type'] === 'Single' || value['primary-type'] === 'EP'
      ? value['primary-type']
      : 'Album';

  return {
    id,
    title,
    score:
      typeof value.score === 'number' && Number.isFinite(value.score)
        ? value.score
        : 0,
    media_type: 'album',
    'primary-type': primaryType,
    'first-release-date': boundText(value['first-release-date'], 128),
    'artist-credit': artistCredit,
    posterPath: boundText(value.posterPath, 2_048) || undefined,
    'type-id': boundText(value['type-id'], 128),
    'primary-type-id': boundText(value['primary-type-id'], 128),
    count:
      typeof value.count === 'number' && Number.isFinite(value.count)
        ? value.count
        : releases.length,
    'secondary-types': boundStringArray(value['secondary-types'], 20),
    'secondary-type-ids': boundStringArray(value['secondary-type-ids'], 20),
    releases,
    releasedate: boundText(value.releasedate, 128),
    tags,
    links: sanitizeLinks(value.links),
    poster_path: boundText(value.poster_path, 2_048) || undefined,
  };
};

export const sanitizeMusicBrainzArtist = (
  value: unknown
): MbArtistDetails | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = boundText(value.id, 128);
  const name = boundText(value.name);
  if (!id || !name) {
    return undefined;
  }

  return {
    id,
    name,
    score:
      typeof value.score === 'number' && Number.isFinite(value.score)
        ? value.score
        : 0,
    media_type: 'artist',
    type: value.type === 'Group' ? 'Group' : 'Person',
    'sort-name': boundText(value['sort-name']) || name,
    country: boundText(value.country, 128) || undefined,
    disambiguation: boundText(value.disambiguation) || undefined,
    artistThumb: boundText(value.artistThumb, 2_048) || undefined,
    artistBackdrop: boundText(value.artistBackdrop, 2_048) || undefined,
    'type-id': boundText(value['type-id'], 128),
    gender: boundText(value.gender, 128) || undefined,
    'gender-id': boundText(value['gender-id'], 128) || undefined,
    isnis: boundStringArray(value.isnis, 100),
    aliases: Array.isArray(value.aliases)
      ? value.aliases
          .slice(0, 100)
          .filter(isRecord)
          .map((alias) => ({
            name: boundText(alias.name),
            'sort-name': boundText(alias['sort-name']),
            type: boundText(alias.type, 128) || undefined,
            'type-id': boundText(alias['type-id'], 128) || undefined,
          }))
          .filter((alias) => !!alias.name)
      : [],
    tags: Array.isArray(value.tags)
      ? value.tags
          .slice(0, MAX_MUSICBRAINZ_TAGS)
          .filter(isRecord)
          .map((tag) => ({
            name: boundText(tag.name, 256),
            count:
              typeof tag.count === 'number' && Number.isFinite(tag.count)
                ? tag.count
                : 0,
          }))
          .filter((tag) => !!tag.name)
      : [],
    links: sanitizeLinks(value.links),
  };
};

export const sanitizeMusicBrainzRecording = (
  value: unknown
): MbRecordingDetails | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = boundText(value.id, 128);
  const title = boundText(value.title);
  if (!id || !title) {
    return undefined;
  }

  const artistCredit = Array.isArray(value['artist-credit'])
    ? value['artist-credit']
        .slice(0, MAX_MUSICBRAINZ_ARTIST_CREDITS)
        .map((credit) => {
          if (!isRecord(credit) || !isRecord(credit.artist)) {
            return undefined;
          }
          const artistId = boundText(credit.artist.id, 128);
          const artistName = boundText(credit.artist.name);
          if (!artistId || !artistName) {
            return undefined;
          }
          return {
            name: boundText(credit.name) || artistName,
            artist: {
              id: artistId,
              name: artistName,
              'sort-name': boundText(credit.artist['sort-name']) || artistName,
            },
          };
        })
        .filter(
          (credit): credit is NonNullable<typeof credit> => credit !== undefined
        )
    : [];

  const releases = Array.isArray(value.releases)
    ? value.releases
        .slice(0, MAX_MUSICBRAINZ_RECORDING_RELEASES)
        .map((release) => {
          if (!isRecord(release) || !isRecord(release['release-group'])) {
            return undefined;
          }
          const releaseId = boundText(release.id, 128);
          const releaseGroup = release['release-group'];
          const releaseGroupId = boundText(releaseGroup.id, 128);
          const releaseGroupTitle = boundText(releaseGroup.title);
          if (!releaseId || !releaseGroupId || !releaseGroupTitle) {
            return undefined;
          }
          return {
            id: releaseId,
            title: boundText(release.title),
            status: boundText(release.status, 128),
            'first-release-date': boundText(
              release['first-release-date'] ?? value['first-release-date'],
              128
            ),
            'release-group': {
              id: releaseGroupId,
              title: releaseGroupTitle,
              'primary-type': boundText(releaseGroup['primary-type'], 128),
              'secondary-types': boundStringArray(
                releaseGroup['secondary-types'],
                20
              ),
            },
          };
        })
        .filter(
          (release): release is MbRecordingDetails['releases'][number] =>
            !!release
        )
    : [];

  return {
    id,
    title,
    score:
      typeof value.score === 'number' && Number.isFinite(value.score)
        ? value.score
        : 0,
    media_type: 'recording',
    'artist-credit': artistCredit,
    'first-release-date': boundText(value['first-release-date'], 128),
    releases,
  };
};

class MusicBrainz extends ExternalAPI {
  constructor() {
    super(
      'https://musicbrainz.org/ws/2',
      {},
      {
        headers: {
          'User-Agent': 'SeerrNG/0.1.0 (https://github.com/snapetech/seerrng)',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('musicbrainz').data,
        rateLimit: {
          maxRequests: 1,
          maxRPS: 1,
        },
      }
    );
  }

  public async searchAlbum(options: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<MbAlbumDetails[]> {
    return (await this.searchAlbumWithTotal(options)).results;
  }

  public async searchAlbumWithTotal({
    query,
    limit = 30,
    offset = 0,
  }: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<{ results: MbAlbumDetails[]; totalResults: number }> {
    try {
      const boundedLimit = clampPageSize(limit, 30);
      const data = await this.get<{
        created: string;
        count: number;
        offset: number;
        'release-groups': MbAlbumDetails[];
      }>(
        '/release-group',
        {
          params: {
            query,
            fmt: 'json',
            limit: boundedLimit.toString(),
            offset: offset.toString(),
          },
        },
        43200
      );

      const results = Array.isArray(data?.['release-groups'])
        ? data['release-groups']
            .slice(0, boundedLimit)
            .map(sanitizeMusicBrainzAlbum)
            .filter((album): album is MbAlbumDetails => !!album)
        : [];
      return { results, totalResults: data?.count ?? results.length };
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to search albums: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async searchRecording({
    query,
    limit = 30,
    offset = 0,
  }: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<MbRecordingDetails[]> {
    try {
      const boundedLimit = clampPageSize(limit, 30);
      const data = await this.get<{
        created: string;
        count: number;
        offset: number;
        recordings: MbRecordingDetails[];
      }>(
        '/recording',
        {
          params: {
            query,
            inc: 'releases',
            fmt: 'json',
            limit: boundedLimit.toString(),
            offset: offset.toString(),
          },
        },
        43200
      );

      return Array.isArray(data?.recordings)
        ? data.recordings
            .slice(0, boundedLimit)
            .map(sanitizeMusicBrainzRecording)
            .filter((recording): recording is MbRecordingDetails => !!recording)
        : [];
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to search recordings: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async searchReleaseGroupsByTag({
    tags,
    primaryTypes,
    releaseDateGte,
    releaseDateLte,
    limit = 25,
    offset = 0,
  }: {
    tags: string[];
    primaryTypes?: string[];
    releaseDateGte?: string;
    releaseDateLte?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ releaseGroups: MbAlbumDetails[]; totalCount: number }> {
    try {
      const boundedLimit = clampPageSize(limit, 25);
      const tagQuery = tags
        .filter((tag): tag is string => typeof tag === 'string')
        .slice(0, 20)
        .map((tag) => tag.slice(0, 128))
        .map((tag) => `tag:"${escapeMusicBrainzQuery(tag)}"`)
        .join(' OR ');
      if (!tagQuery) {
        return { releaseGroups: [], totalCount: 0 };
      }
      let query = `(${tagQuery})`;

      if (primaryTypes?.length) {
        const typeQuery = primaryTypes
          .filter((type): type is string => typeof type === 'string')
          .slice(0, 20)
          .map((type) => type.slice(0, 128))
          .map((type) => `primarytype:"${escapeMusicBrainzQuery(type)}"`)
          .join(' OR ');
        query += ` AND (${typeQuery})`;
      }

      if (releaseDateGte || releaseDateLte) {
        const datePattern = /^\d{4}(-\d{2}(-\d{2})?)?$/;
        const from =
          releaseDateGte && datePattern.test(releaseDateGte)
            ? releaseDateGte
            : '*';
        const to =
          releaseDateLte && datePattern.test(releaseDateLte)
            ? releaseDateLte
            : '*';
        query += ` AND firstreleasedate:[${from} TO ${to}]`;
      }

      query += ' AND status:"official"';

      const data = await this.get<{
        created: string;
        count: number;
        offset: number;
        'release-groups': MbAlbumDetails[];
      }>(
        '/release-group',
        {
          params: {
            query,
            fmt: 'json',
            limit: boundedLimit.toString(),
            offset: offset.toString(),
          },
        },
        43200
      );

      return {
        releaseGroups: Array.isArray(data?.['release-groups'])
          ? data['release-groups']
              .slice(0, boundedLimit)
              .map(sanitizeMusicBrainzAlbum)
              .filter((album): album is MbAlbumDetails => !!album)
          : [],
        totalCount:
          typeof data?.count === 'number' &&
          Number.isSafeInteger(data.count) &&
          data.count >= 0
            ? data.count
            : 0,
      };
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to search release groups by tag: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async searchArtist(options: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<MbArtistDetails[]> {
    return (await this.searchArtistWithTotal(options)).results;
  }

  public async searchArtistWithTotal({
    query,
    limit = 50,
    offset = 0,
  }: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<{ results: MbArtistDetails[]; totalResults: number }> {
    try {
      const boundedLimit = clampPageSize(limit, 50);
      const data = await this.get<{
        created: string;
        count: number;
        offset: number;
        artists: MbArtistDetails[];
      }>(
        '/artist',
        {
          params: {
            query,
            fmt: 'json',
            limit: boundedLimit.toString(),
            offset: offset.toString(),
          },
        },
        43200
      );

      const results = Array.isArray(data?.artists)
        ? data.artists
            .slice(0, boundedLimit)
            .map(sanitizeMusicBrainzArtist)
            .filter((artist): artist is MbArtistDetails => !!artist)
        : [];
      return { results, totalResults: data?.count ?? results.length };
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to search artists: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async getReleaseGroupDetails({
    releaseGroupId,
  }: {
    releaseGroupId: string;
  }): Promise<MbAlbumDetails> {
    const normalizedReleaseGroupId = normalizeMusicBrainzId(releaseGroupId);

    if (!isValidMusicBrainzResourceId(normalizedReleaseGroupId)) {
      throw new Error('Invalid MusicBrainz release group ID');
    }

    try {
      const data = await this.get<Omit<MbAlbumDetails, 'score' | 'media_type'>>(
        `/release-group/${encodeURIComponent(normalizedReleaseGroupId)}`,
        {
          params: {
            inc: 'artist-credits+releases',
            fmt: 'json',
          },
        },
        43200
      );

      const album = sanitizeMusicBrainzAlbum({
        ...data,
        score: 100,
        media_type: 'album',
      });
      if (!album) {
        throw new Error('MusicBrainz returned an invalid release group.');
      }
      return album;
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to fetch release group details: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async getReleaseLabels({
    releaseId,
  }: {
    releaseId: string;
  }): Promise<string[]> {
    const normalizedReleaseId = normalizeMusicBrainzId(releaseId);

    if (!isValidMusicBrainzResourceId(normalizedReleaseId)) {
      throw new Error('Invalid MusicBrainz release ID');
    }

    try {
      const data = await this.get<unknown>(
        `/release/${encodeURIComponent(normalizedReleaseId)}`,
        {
          params: {
            inc: 'labels',
            fmt: 'json',
          },
        },
        43200
      );

      return sanitizeMusicBrainzReleaseLabels(data);
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to fetch release labels: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }

  public async getArtistWikipediaExtract({
    artistMbid,
  }: {
    artistMbid: string;
  }): Promise<{ title: string; url: string; content: string } | null> {
    if (
      !artistMbid ||
      typeof artistMbid !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        artistMbid
      )
    ) {
      throw new Error('Invalid MusicBrainz artist ID format');
    }

    try {
      const safeUrl = `https://musicbrainz.org/artist/${artistMbid}/wikipedia-extract`;

      const response = await axios.get(safeUrl, {
        ...WIKIPEDIA_EXTRACT_HTTP_OPTIONS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SeerrNG/0.1.0 (https://github.com/snapetech/seerrng)',
        },
      });

      const data: unknown = response.data;
      if (
        !isRecord(data) ||
        !isRecord(data.wikipediaExtract) ||
        typeof data.wikipediaExtract.content !== 'string' ||
        !data.wikipediaExtract.content
      ) {
        return null;
      }

      const cleanContent = purify
        .sanitize(
          data.wikipediaExtract.content.slice(
            0,
            MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH
          ),
          {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: [],
          }
        )
        .slice(0, MAX_MUSICBRAINZ_WIKIPEDIA_LENGTH);
      const rawUrl = boundText(data.wikipediaExtract.url, 2_048);
      let url = '';
      try {
        const parsedUrl = new URL(rawUrl);
        if (
          parsedUrl.protocol === 'https:' &&
          (parsedUrl.hostname === 'wikipedia.org' ||
            parsedUrl.hostname.endsWith('.wikipedia.org'))
        ) {
          url = parsedUrl.toString();
        }
      } catch {
        // Invalid provider URLs are omitted from the response.
      }

      return {
        title: boundText(data.wikipediaExtract.title),
        url,
        content: cleanContent.trim(),
      };
    } catch (error) {
      throw new Error(
        `[MusicBrainz] Failed to fetch Wikipedia extract: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  public async getReleaseGroup({
    releaseId,
  }: {
    releaseId: string;
  }): Promise<string | null> {
    const normalizedReleaseId = normalizeMusicBrainzId(releaseId);

    if (!isValidMusicBrainzResourceId(normalizedReleaseId)) {
      throw new Error('Invalid MusicBrainz release ID');
    }

    try {
      const data = await this.get<{
        'release-group': {
          id: string;
        };
      }>(
        `/release/${encodeURIComponent(normalizedReleaseId)}`,
        {
          params: {
            inc: 'release-groups',
            fmt: 'json',
          },
        },
        43200
      );

      const releaseGroupId = isRecord(data?.['release-group'])
        ? boundText(data['release-group'].id, 128)
        : '';
      return releaseGroupId || null;
    } catch (e) {
      throw new Error(
        `[MusicBrainz] Failed to fetch release group: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`
      );
    }
  }
}

export default MusicBrainz;
