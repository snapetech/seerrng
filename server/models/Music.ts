import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import type Media from '@server/entity/Media';

export interface MusicDetails {
  id: string;
  mbId: string;
  title: string;
  titleSlug?: string;
  mediaType: 'album';
  type: string;
  releaseDate: string;
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
}

export const mapMusicDetails = (
  album: LbAlbumDetails,
  media?: Media,
  userWatchlist?: boolean
): MusicDetails => {
  const releaseGroup = album.release_group_metadata?.release_group;
  const artist = album.release_group_metadata?.artist;
  const primaryArtist = artist?.artists?.[0];
  const title = releaseGroup?.name ?? album.release_group_mbid;

  return {
    id: album.release_group_mbid,
    mbId: album.release_group_mbid,
    title,
    titleSlug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    mediaType: 'album',
    type: album.type,
    releaseDate: releaseGroup?.date,
    artist: {
      id: primaryArtist?.artist_mbid,
      name: artist?.name ?? primaryArtist?.name,
      area: primaryArtist?.area,
      beginYear: primaryArtist?.begin_year,
      type: primaryArtist?.type,
    },
    tracks: (album.mediums ?? []).flatMap((medium) =>
      (medium.tracks ?? []).map((track) => ({
        name: track.name,
        position: track.position,
        length: track.length,
        recordingMbid: track.recording_mbid,
        totalListenCount: track.total_listen_count,
        totalUserCount: track.total_user_count,
        artists: (track.artists ?? []).map((artist) => ({
          name: artist.artist_credit_name,
          mbid: artist.artist_mbid,
        })),
      }))
    ),
    tags: {
      artist: (album.release_group_metadata?.tag?.artist ?? []).map((tag) => ({
        artistMbid: tag.artist_mbid,
        count: tag.count,
        tag: tag.tag,
      })),
      releaseGroup: (
        album.release_group_metadata?.tag?.release_group ?? []
      ).map((tag) => ({
        count: tag.count,
        genreMbid: tag.genre_mbid,
        tag: tag.tag,
      })),
    },
    stats: {
      totalListenCount: album.listening_stats?.total_listen_count ?? 0,
      totalUserCount: album.listening_stats?.total_user_count ?? 0,
      listeners: (album.listening_stats?.listeners ?? []).map((listener) => ({
        userName: listener.user_name,
        listenCount: listener.listen_count,
      })),
    },
    mediaInfo: media,
    onUserWatchlist: userWatchlist,
  };
};
