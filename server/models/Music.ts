import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import type Media from '@server/entity/Media';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import type { AvailableMusicService } from '@server/lib/musicQualityAvailability';
import type { MusicTrackAvailability } from '@server/lib/musicTrackAvailability';

export interface MusicDetails {
  id: string;
  mbId: string;
  title: string;
  titleSlug?: string;
  mediaType: 'album';
  type: string;
  releaseDate: string;
  recordLabel?: string;
  artist: {
    id: string;
    name: string;
    area?: string;
    beginYear?: number;
    type?: string;
  };
  tracks: {
    name: string;
    position: number;
    length: number;
    recordingMbid: string;
    totalListenCount: number;
    totalUserCount: number;
    artists: {
      name: string;
      mbid: string;
      tmdbMapping?: {
        personId: number;
        profilePath: string;
      };
    }[];
  }[];
  tags?: {
    artist: {
      artistMbid: string;
      count: number;
      tag: string;
    }[];
    releaseGroup: {
      count: number;
      genreMbid: string;
      tag: string;
    }[];
  };
  stats?: {
    totalListenCount: number;
    totalUserCount: number;
    listeners: {
      userName: string;
      listenCount: number;
    }[];
  };
  mediaInfo?: Media;
  onUserWatchlist?: boolean;
  posterPath?: string;
  needsCoverArt?: boolean;
  artistWikipedia?: {
    content: string;
    title: string;
    url: string;
  };
  tmdbPersonId?: number;
  artistBackdrop?: string;
  artistThumb?: string;
  availableServices?: AvailableMusicService[];
  trackAvailability?: MusicTrackAvailability;
}

export interface MusicRatingResponse {
  rating?: {
    score: number;
    votes: number;
    url: string;
    source: 'musicbrainz' | 'lidarr';
  };
}

export const MAX_MUSIC_DETAIL_MEDIA = 50;
export const MAX_MUSIC_DETAIL_TRACKS = 1_000;
export const MAX_MUSIC_DETAIL_TRACK_ARTISTS = 20;
export const MAX_MUSIC_DETAIL_TAGS = 200;
export const MAX_MUSIC_DETAIL_LISTENERS = 100;
const MAX_MUSIC_DETAIL_TEXT_LENGTH = 1_000;

const boundText = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_MUSIC_DETAIL_TEXT_LENGTH) : '';

export const mapMusicDetails = (
  album: LbAlbumDetails,
  media?: Media,
  userWatchlist?: boolean
): MusicDetails => {
  const releaseGroup = album.release_group_metadata?.release_group;
  const artist = album.release_group_metadata?.artist;
  const primaryArtist = artist?.artists?.[0];
  const title = boundText(releaseGroup?.name ?? album.release_group_mbid);
  const releaseGroupMbid = normalizeMusicBrainzId(album.release_group_mbid);
  let remainingTracks = MAX_MUSIC_DETAIL_TRACKS;
  const tracks = (Array.isArray(album.mediums) ? album.mediums : [])
    .slice(0, MAX_MUSIC_DETAIL_MEDIA)
    .flatMap((medium) => {
      if (remainingTracks === 0 || !Array.isArray(medium?.tracks)) {
        return [];
      }
      const boundedTracks = medium.tracks.slice(0, remainingTracks);
      remainingTracks -= boundedTracks.length;
      return boundedTracks.map((track) => ({
        name: boundText(track?.name),
        position: Number.isFinite(track?.position) ? track.position : 0,
        length: Number.isFinite(track?.length) ? track.length : 0,
        recordingMbid: normalizeMusicBrainzId(track?.recording_mbid ?? ''),
        totalListenCount: Number.isFinite(track?.total_listen_count)
          ? track.total_listen_count
          : 0,
        totalUserCount: Number.isFinite(track?.total_user_count)
          ? track.total_user_count
          : 0,
        artists: (Array.isArray(track?.artists) ? track.artists : [])
          .slice(0, MAX_MUSIC_DETAIL_TRACK_ARTISTS)
          .map((artist) => ({
            name: boundText(artist?.artist_credit_name),
            mbid: normalizeMusicBrainzId(artist?.artist_mbid ?? ''),
          })),
      }));
    });

  return {
    id: releaseGroupMbid,
    mbId: releaseGroupMbid,
    title,
    titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    mediaType: 'album',
    type: album.type,
    releaseDate: releaseGroup?.date,
    artist: {
      id: primaryArtist?.artist_mbid
        ? normalizeMusicBrainzId(primaryArtist.artist_mbid)
        : '',
      name: boundText(artist?.name ?? primaryArtist?.name),
      area: primaryArtist?.area ? boundText(primaryArtist.area) : undefined,
      beginYear: primaryArtist?.begin_year,
      type: primaryArtist?.type,
    },
    tracks,
    tags: {
      artist: (Array.isArray(album.release_group_metadata?.tag?.artist)
        ? album.release_group_metadata.tag.artist
        : []
      )
        .slice(0, MAX_MUSIC_DETAIL_TAGS)
        .map((tag) => ({
          artistMbid: normalizeMusicBrainzId(tag?.artist_mbid ?? ''),
          count: Number.isFinite(tag?.count) ? tag.count : 0,
          tag: boundText(tag?.tag),
        })),
      releaseGroup: (Array.isArray(
        album.release_group_metadata?.tag?.release_group
      )
        ? album.release_group_metadata.tag.release_group
        : []
      )
        .slice(0, MAX_MUSIC_DETAIL_TAGS)
        .map((tag) => ({
          count: Number.isFinite(tag?.count) ? tag.count : 0,
          genreMbid: normalizeMusicBrainzId(tag?.genre_mbid ?? ''),
          tag: boundText(tag?.tag),
        })),
    },
    stats: {
      totalListenCount: album.listening_stats?.total_listen_count ?? 0,
      totalUserCount: album.listening_stats?.total_user_count ?? 0,
      listeners: (Array.isArray(album.listening_stats?.listeners)
        ? album.listening_stats.listeners
        : []
      )
        .slice(0, MAX_MUSIC_DETAIL_LISTENERS)
        .map((listener) => ({
          userName: boundText(listener?.user_name),
          listenCount: Number.isFinite(listener?.listen_count)
            ? listener.listen_count
            : 0,
        })),
    },
    mediaInfo: media,
    onUserWatchlist: userWatchlist,
  };
};
