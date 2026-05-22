import ListenBrainzAPI from '@server/api/listenbrainz';
import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import MusicBrainz from '@server/api/musicbrainz';
import type { MbAlbumDetails } from '@server/api/musicbrainz/interfaces';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import { Watchlist } from '@server/entity/Watchlist';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import logger from '@server/logger';
import { mapMusicDetails } from '@server/models/Music';
import { filterEntityResponse } from '@server/utils/entityResponse';
import { parsePositiveInt } from '@server/utils/pagination';
import {
  parseBoundedString,
  parseOptionalQueryBoolean,
} from '@server/utils/validation';
import { Router } from 'express';
import { In } from 'typeorm';

const musicRoutes = Router();
const MAX_MUSICBRAINZ_ID_LENGTH = 128;
const MAX_PAGE = 500;

class AlbumDetailsNotFoundError extends Error {
  constructor(message = 'Album not found') {
    super(message);
  }
}

const parseMusicBrainzId = (value: unknown) =>
  parseBoundedString(value, {
    fieldName: 'MusicBrainz ID',
    maxLength: MAX_MUSICBRAINZ_ID_LENGTH,
  });

const normalizeParsedMusicBrainzId = (
  parsed: ReturnType<typeof parseMusicBrainzId>
) =>
  'error' in parsed ? parsed : { value: normalizeMusicBrainzId(parsed.value) };

const mapMusicBrainzReleaseGroupToListenBrainzAlbum = (
  album: MbAlbumDetails
): LbAlbumDetails => {
  const primaryArtist = album['artist-credit']?.[0]?.artist;

  return {
    caa_id: 0,
    caa_release_mbid: '',
    listening_stats: {
      artist_mbids: primaryArtist?.id ? [primaryArtist.id] : [],
      artist_name:
        album['artist-credit']?.[0]?.name ?? primaryArtist?.name ?? '',
      caa_id: 0,
      caa_release_mbid: '',
      from_ts: 0,
      last_updated: 0,
      listeners: [],
      release_group_mbid: album.id,
      release_group_name: album.title,
      stats_range: '',
      to_ts: 0,
      total_listen_count: 0,
      total_user_count: 0,
    },
    mediums: [],
    recordings_release_mbid: '',
    release_group_mbid: album.id,
    release_group_metadata: {
      artist: {
        artist_credit_id: 0,
        name: album['artist-credit']?.[0]?.name ?? primaryArtist?.name ?? '',
        artists: primaryArtist
          ? [
              {
                area: '',
                artist_mbid: primaryArtist.id,
                begin_year: 0,
                join_phrase: '',
                name: primaryArtist.name,
                rels: {},
                type: '',
              },
            ]
          : [],
      },
      release: {
        caa_id: 0,
        caa_release_mbid: '',
        date: album['first-release-date'] ?? '',
        name: album.title,
        rels: [],
        type: album['primary-type'] ?? 'Album',
      },
      release_group: {
        caa_id: 0,
        caa_release_mbid: '',
        date: album['first-release-date'] ?? '',
        name: album.title,
        rels: [],
        type: album['primary-type'] ?? 'Album',
      },
      tag: {
        artist: [],
        release_group: (album.tags ?? []).map((tag) => ({
          count: tag.count,
          genre_mbid: '',
          tag: tag.name,
        })),
      },
    },
    type: album['primary-type'] ?? 'Album',
  };
};

const getAlbumDetails = async (
  mbId: string,
  listenbrainz: ListenBrainzAPI,
  musicbrainz: MusicBrainz
) => {
  try {
    return await listenbrainz.getAlbum(mbId);
  } catch (error) {
    logger.warn('ListenBrainz album details unavailable; using MusicBrainz', {
      label: 'Music API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      mbId,
    });

    let album: MbAlbumDetails;
    try {
      album = await musicbrainz.getReleaseGroupDetails({
        releaseGroupId: mbId,
      });
    } catch (musicBrainzError) {
      const errorMessage =
        musicBrainzError instanceof Error
          ? musicBrainzError.message
          : 'Unknown error';

      if (errorMessage.includes('status code 404')) {
        throw new AlbumDetailsNotFoundError();
      }

      throw musicBrainzError;
    }

    return mapMusicBrainzReleaseGroupToListenBrainzAlbum(album);
  }
};

musicRoutes.get('/:id', async (req, res, next) => {
  const parsedMbId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedMbId) {
    return res.status(404).json({ status: 404, message: 'Album not found' });
  }

  const mbId = parsedMbId.value;
  const listenbrainz = new ListenBrainzAPI();
  const musicbrainz = new MusicBrainz();
  const personMapper = new TmdbPersonMapper();
  const theAudioDb = new TheAudioDb();

  try {
    const [albumDetails, media, onUserWatchlist] = await Promise.all([
      getAlbumDetails(mbId, listenbrainz, musicbrainz),
      getRepository(Media)
        .createQueryBuilder('media')
        .leftJoinAndSelect('media.requests', 'requests')
        .leftJoinAndSelect('requests.requestedBy', 'requestedBy')
        .leftJoinAndSelect('requests.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('media.issues', 'issues')
        .leftJoinAndSelect('issues.createdBy', 'issueCreatedBy')
        .leftJoinAndSelect('issues.modifiedBy', 'issueModifiedBy')
        .leftJoinAndSelect('issues.comments', 'issueComments')
        .leftJoinAndSelect('issueComments.user', 'issueCommentUser')
        .where({
          mbId,
          mediaType: MediaType.MUSIC,
        })
        .getOne()
        .then((media) => media ?? undefined),
      getRepository(Watchlist).exist({
        where: {
          mbId,
          requestedBy: { id: req.user?.id },
        },
      }),
    ]);

    const artistId =
      albumDetails.release_group_metadata?.artist?.artists?.[0]?.artist_mbid;
    const isPerson =
      albumDetails.release_group_metadata?.artist?.artists?.[0]?.type ===
      'Person';
    const trackArtistIds = (albumDetails.mediums ?? [])
      .flatMap((medium) => medium.tracks)
      .flatMap((track) => track.artists ?? [])
      .filter((artist) => artist.artist_mbid)
      .map((artist) => artist.artist_mbid);

    const [
      metadataAlbum,
      metadataArtist,
      trackArtistMetadata,
      artistWikipedia,
    ] = await Promise.allSettled([
      getRepository(MetadataAlbum).findOne({
        where: { mbAlbumId: mbId },
      }),
      artistId
        ? getRepository(MetadataArtist).findOne({
            where: { mbArtistId: artistId },
          })
        : Promise.resolve(undefined),
      getRepository(MetadataArtist).find({
        where: { mbArtistId: In(trackArtistIds) },
      }),
      artistId && isPerson
        ? musicbrainz
            .getArtistWikipediaExtract({
              artistMbid: artistId,
              language: req.locale,
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const resolvedMetadataAlbum =
      metadataAlbum.status === 'fulfilled' ? metadataAlbum.value : null;
    const resolvedMetadataArtist =
      metadataArtist.status === 'fulfilled' ? metadataArtist.value : undefined;
    const resolvedTrackArtistMetadata =
      trackArtistMetadata.status === 'fulfilled'
        ? trackArtistMetadata.value
        : [];
    const resolvedArtistWikipedia =
      artistWikipedia.status === 'fulfilled' ? artistWikipedia.value : null;

    const trackArtistsToMap = (albumDetails.mediums ?? [])
      .flatMap((medium) => medium.tracks)
      .flatMap((track) =>
        (track.artists ?? [])
          .filter((artist) => artist.artist_mbid)
          .filter(
            (artist) =>
              !resolvedTrackArtistMetadata.some(
                (m) => m.mbArtistId === artist.artist_mbid && m.tmdbPersonId
              )
          )
          .map((artist) => ({
            artistId: artist.artist_mbid,
            artistName: artist.artist_credit_name,
          }))
      );

    const responses = await Promise.allSettled([
      artistId &&
      !resolvedMetadataArtist?.tadbThumb &&
      !resolvedMetadataArtist?.tadbCover
        ? theAudioDb.getArtistImages(artistId)
        : Promise.resolve(null),
      artistId && isPerson && !resolvedMetadataArtist?.tmdbPersonId
        ? personMapper
            .getMapping(
              artistId,
              albumDetails.release_group_metadata?.artist?.artists?.[0]?.name ??
                albumDetails.release_group_metadata?.artist?.name ??
                ''
            )
            .catch(() => null)
        : Promise.resolve(null),
      trackArtistsToMap.length > 0
        ? personMapper.batchGetMappings(trackArtistsToMap).then(() =>
            getRepository(MetadataArtist).find({
              where: { mbArtistId: In(trackArtistIds) },
            })
          )
        : Promise.resolve(resolvedTrackArtistMetadata),
    ]);

    const artistImages =
      responses[0].status === 'fulfilled' ? responses[0].value : null;
    const personMappingResult =
      responses[1].status === 'fulfilled' ? responses[1].value : null;
    const updatedArtistMetadata =
      responses[2].status === 'fulfilled'
        ? responses[2].value
        : resolvedTrackArtistMetadata;

    const updatedMetadataArtist =
      personMappingResult && artistId
        ? await getRepository(MetadataArtist).findOne({
            where: { mbArtistId: artistId },
          })
        : resolvedMetadataArtist;

    const mappedDetails = mapMusicDetails(albumDetails, media, onUserWatchlist);
    const finalTrackArtistMetadata =
      updatedArtistMetadata || resolvedTrackArtistMetadata;

    return res.status(200).json(
      filterEntityResponse({
        ...mappedDetails,
        posterPath: resolvedMetadataAlbum?.caaUrl ?? null,
        needsCoverArt: !resolvedMetadataAlbum?.caaUrl,
        artistWikipedia: resolvedArtistWikipedia,
        artistThumb:
          updatedMetadataArtist?.tmdbThumb ??
          updatedMetadataArtist?.tadbThumb ??
          artistImages?.artistThumb ??
          null,
        artistBackdrop:
          updatedMetadataArtist?.tadbCover ??
          artistImages?.artistBackground ??
          null,
        tmdbPersonId: updatedMetadataArtist?.tmdbPersonId
          ? Number(updatedMetadataArtist.tmdbPersonId)
          : null,
        tracks: mappedDetails.tracks.map((track) => ({
          ...track,
          artists: track.artists.map((artist) => {
            const metadata = finalTrackArtistMetadata.find(
              (m) => m.mbArtistId === artist.mbid
            );
            return {
              ...artist,
              tmdbMapping: metadata?.tmdbPersonId
                ? {
                    personId: Number(metadata.tmdbPersonId),
                    profilePath: metadata.tmdbThumb,
                  }
                : null,
            };
          }),
        })),
      })
    );
  } catch (e) {
    if (e instanceof AlbumDetailsNotFoundError) {
      return next({
        status: 404,
        message: 'Album not found',
      });
    }

    logger.error('Something went wrong retrieving album details', {
      label: 'Music API',
      errorMessage: e.message,
      mbId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve album details.',
    });
  }
});

musicRoutes.get('/:id/artist', async (req, res, next) => {
  const parsedMbId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedMbId) {
    return res.status(404).json({ status: 404, message: 'Album not found' });
  }

  const mbId = parsedMbId.value;

  try {
    const listenbrainzApi = new ListenBrainzAPI();
    const theAudioDb = new TheAudioDb();
    const metadataArtistRepository = getRepository(MetadataArtist);

    const albumData = await listenbrainzApi.getAlbum(mbId);
    const artistData = albumData?.release_group_metadata?.artist?.artists?.[0];
    const artistType = artistData?.type;

    if (!artistData?.artist_mbid || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const responses = await Promise.allSettled([
      listenbrainzApi.getArtist(artistData.artist_mbid),
      theAudioDb.getArtistImagesFromCache(artistData.artist_mbid),
      metadataArtistRepository.findOne({
        where: { mbArtistId: artistData.artist_mbid },
      }),
    ]);

    const artistDetails =
      responses[0].status === 'fulfilled' ? responses[0].value : null;
    const cachedTheAudioDb =
      responses[1].status === 'fulfilled' ? responses[1].value : null;
    const metadataArtist =
      responses[2].status === 'fulfilled' ? responses[2].value : null;

    if (!artistDetails) {
      return res.status(404).json({ status: 404, message: 'Artist not found' });
    }

    const [artistImagesResult] = await Promise.allSettled([
      !cachedTheAudioDb &&
      !metadataArtist?.tadbThumb &&
      !metadataArtist?.tadbCover
        ? theAudioDb.getArtistImages(artistData.artist_mbid)
        : Promise.resolve(null),
    ]);

    const artistImages =
      artistImagesResult.status === 'fulfilled'
        ? artistImagesResult.value
        : null;

    return res.status(200).json({
      artist: {
        ...artistDetails,
        artistThumb:
          cachedTheAudioDb?.artistThumb ??
          metadataArtist?.tadbThumb ??
          artistImages?.artistThumb ??
          null,
        artistBackdrop:
          cachedTheAudioDb?.artistBackground ??
          metadataArtist?.tadbCover ??
          artistImages?.artistBackground ??
          null,
      },
    });
  } catch (error) {
    logger.error('Something went wrong retrieving artist details', {
      label: 'Music API',
      errorMessage: error.message,
      mbId,
    });
    return next({ status: 500, message: 'Unable to retrieve artist details.' });
  }
});

musicRoutes.get('/:id/artist-discography', async (req, res, next) => {
  const parsedMbId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedMbId) {
    return res.status(404).json({ status: 404, message: 'Album not found' });
  }

  const mbId = parsedMbId.value;

  try {
    const listenbrainzApi = new ListenBrainzAPI();
    const metadataAlbumRepository = getRepository(MetadataAlbum);

    const page = parsePositiveInt(req.query.page, 1, MAX_PAGE);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 50);
    const parsedSlider = parseOptionalQueryBoolean(req.query.slider, 'Slider');
    if ('error' in parsedSlider) {
      return res.status(400).json({ status: 400, message: parsedSlider.error });
    }
    const isSlider = parsedSlider.value ?? false;

    const albumData = await listenbrainzApi.getAlbum(mbId);
    const artistData = albumData?.release_group_metadata?.artist?.artists?.[0];
    const artistType = artistData?.type;

    if (!artistData?.artist_mbid || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const artistDetails = await listenbrainzApi.getArtist(
      artistData.artist_mbid
    );

    if (!artistDetails) {
      return res.status(404).json({ status: 404, message: 'Artist not found' });
    }

    const totalReleaseGroups = artistDetails.releaseGroups.length;
    const paginatedReleaseGroups =
      isSlider || page === 1
        ? artistDetails.releaseGroups.slice(0, pageSize)
        : artistDetails.releaseGroups.slice(
            (page - 1) * pageSize,
            page * pageSize
          );

    const releaseGroupIds = [
      ...new Set(
        paginatedReleaseGroups.map((rg) => normalizeMusicBrainzId(rg.mbid))
      ),
    ];

    const mediaResponses = await Promise.allSettled([
      Media.getRelatedMedia(req.user, releaseGroupIds),
      metadataAlbumRepository.find({
        where: { mbAlbumId: In(releaseGroupIds) },
      }),
    ]);

    const relatedMedia =
      mediaResponses[0].status === 'fulfilled' ? mediaResponses[0].value : [];
    const albumMetadata =
      mediaResponses[1].status === 'fulfilled' ? mediaResponses[1].value : [];

    const albumMetadataMap = new Map(
      albumMetadata.map((metadata) => [
        normalizeMusicBrainzId(metadata.mbAlbumId),
        metadata,
      ])
    );

    const relatedMediaMap = new Map(
      relatedMedia
        .filter((media) => media.mbId)
        .map((media) => [normalizeMusicBrainzId(media.mbId as string), media])
    );

    const transformedReleaseGroups = paginatedReleaseGroups.map(
      (releaseGroup) => {
        const releaseGroupId = normalizeMusicBrainzId(releaseGroup.mbid);
        const metadata = albumMetadataMap.get(releaseGroupId);
        return {
          id: releaseGroup.mbid,
          mediaType: 'album',
          title: releaseGroup.name,
          'first-release-date': releaseGroup.date,
          'artist-credit': [{ name: releaseGroup.artist_credit_name }],
          'primary-type': releaseGroup.type || 'Other',
          posterPath: metadata?.caaUrl ?? null,
          needsCoverArt: !metadata?.caaUrl,
          mediaInfo: relatedMediaMap.get(releaseGroupId),
        };
      }
    );

    return res.status(200).json({
      page,
      totalPages: Math.max(Math.ceil(totalReleaseGroups / pageSize), 1),
      totalResults: totalReleaseGroups,
      results: transformedReleaseGroups,
    });
  } catch (error) {
    logger.error('Something went wrong retrieving artist discography', {
      label: 'Music API',
      errorMessage: error.message,
      mbId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist discography.',
    });
  }
});

musicRoutes.get('/:id/artist-similar', async (req, res, next) => {
  const parsedMbId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedMbId) {
    return res.status(404).json({ status: 404, message: 'Album not found' });
  }

  const mbId = parsedMbId.value;

  try {
    const listenbrainzApi = new ListenBrainzAPI();
    const personMapper = new TmdbPersonMapper();
    const theAudioDb = new TheAudioDb();
    const metadataArtistRepository = getRepository(MetadataArtist);

    const page = parsePositiveInt(req.query.page, 1, MAX_PAGE);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 50);

    const albumData = await listenbrainzApi.getAlbum(mbId);
    const artistData = albumData?.release_group_metadata?.artist?.artists?.[0];
    const artistType = artistData?.type;

    if (!artistData?.artist_mbid || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const artistDetails = await listenbrainzApi.getArtist(
      artistData.artist_mbid
    );

    if (!artistDetails) {
      return res.status(404).json({ status: 404, message: 'Artist not found' });
    }

    const allSimilarArtists =
      artistDetails.similarArtists?.artists?.sort(
        (a, b) => b.score - a.score
      ) ?? [];

    const totalResults = allSimilarArtists.length;
    const totalPages = Math.max(Math.ceil(totalResults / pageSize), 1);

    const paginatedSimilarArtists = allSimilarArtists.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    const similarArtistIds = paginatedSimilarArtists.map((a) => a.artist_mbid);

    if (similarArtistIds.length === 0) {
      return res.status(200).json({
        page,
        totalPages,
        totalResults,
        results: [],
      });
    }

    const [similarArtistMetadataResult] = await Promise.allSettled([
      metadataArtistRepository.find({
        where: { mbArtistId: In(similarArtistIds) },
      }),
    ]);

    const similarArtistMetadata =
      similarArtistMetadataResult.status === 'fulfilled'
        ? similarArtistMetadataResult.value
        : [];

    const similarArtistMetadataMap = new Map(
      similarArtistMetadata.map((metadata) => [metadata.mbArtistId, metadata])
    );

    const artistsNeedingImages = similarArtistIds.filter((id) => {
      const metadata = similarArtistMetadataMap.get(id);
      return !metadata?.tadbThumb && !metadata?.tadbCover;
    });

    const personArtists =
      paginatedSimilarArtists
        .filter((artist) => artist.type === 'Person')
        .filter((artist) => {
          const metadata = similarArtistMetadataMap.get(artist.artist_mbid);
          return !metadata?.tmdbPersonId;
        })
        .map((artist) => ({
          artistId: artist.artist_mbid,
          artistName: artist.name,
        })) ?? [];

    type ArtistImageResults = Record<
      string,
      { artistThumb: string | null; artistBackground: string | null }
    >;

    const artistResponses = await Promise.allSettled([
      artistsNeedingImages.length > 0
        ? theAudioDb.batchGetArtistImages(artistsNeedingImages)
        : ({} as ArtistImageResults),
      personArtists.length > 0
        ? personMapper.batchGetMappings(personArtists).then(() =>
            metadataArtistRepository.find({
              where: { mbArtistId: In(similarArtistIds) },
            })
          )
        : Promise.resolve(similarArtistMetadata),
    ]);

    const artistImageResults =
      artistResponses[0].status === 'fulfilled' ? artistResponses[0].value : {};
    const updatedArtistMetadata =
      artistResponses[1].status === 'fulfilled'
        ? artistResponses[1].value
        : similarArtistMetadata;

    const finalArtistMetadataMap = new Map(
      (updatedArtistMetadata || similarArtistMetadata).map((metadata) => [
        metadata.mbArtistId,
        metadata,
      ])
    );

    const transformedSimilarArtists = paginatedSimilarArtists.map((artist) => {
      const metadata = finalArtistMetadataMap.get(artist.artist_mbid);
      const artistImageResult =
        artistImageResults[
          artist.artist_mbid as keyof typeof artistImageResults
        ];

      const artistThumb =
        metadata?.tadbThumb || (artistImageResult?.artistThumb ?? null);

      return {
        id: artist.artist_mbid,
        mediaType: 'artist',
        name: artist.name,
        type: artist.type as 'Group' | 'Person',
        artistThumb: metadata?.tmdbThumb ?? artistThumb,
        score: artist.score,
        tmdbPersonId: metadata?.tmdbPersonId
          ? Number(metadata.tmdbPersonId)
          : null,
        'sort-name': artist.name,
      };
    });

    return res.status(200).json({
      page,
      totalPages,
      totalResults,
      results: transformedSimilarArtists,
    });
  } catch (error) {
    logger.error('Something went wrong retrieving similar artists', {
      label: 'Music API',
      errorMessage: error.message,
      mbId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve similar artists.',
    });
  }
});

export default musicRoutes;
