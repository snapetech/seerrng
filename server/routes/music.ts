import CoverArtArchive from '@server/api/coverartarchive';
import ListenBrainzAPI from '@server/api/listenbrainz';
import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import MusicBrainz from '@server/api/musicbrainz';
import type { MbAlbumDetails } from '@server/api/musicbrainz/interfaces';
import LidarrAPI from '@server/api/servarr/lidarr';
import TheAudioDb from '@server/api/theaudiodb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import MetadataArtist from '@server/entity/MetadataArtist';
import { Watchlist } from '@server/entity/Watchlist';
import {
  isValidMusicBrainzResourceId,
  MAX_MUSICBRAINZ_BATCH_IDS,
  normalizeMusicBrainzId,
  prepareMusicBrainzBatchIds,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { upsertMediaSearchMetadata } from '@server/lib/mediaSearchMetadata';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import {
  getAvailableMusicQualities,
  getAvailableMusicServices,
  getMusicQualityStatuses,
} from '@server/lib/musicQualityAvailability';
import { getMusicTrackAvailability } from '@server/lib/musicTrackAvailability';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import logger from '@server/logger';
import {
  mapMusicDetails,
  type MusicRatingResponse,
} from '@server/models/Music';
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
export const MAX_ALBUM_MEDIA = 50;
export const MAX_ALBUM_TRACKS = 1_000;
export const MAX_ALBUM_TRACK_ARTISTS = 20;

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
) => {
  if ('error' in parsed) {
    return parsed;
  }

  const value = normalizeMusicBrainzId(parsed.value);
  return isValidMusicBrainzResourceId(value)
    ? { value }
    : { error: 'MusicBrainz ID is invalid.' };
};

const normalizeMusicBrainzIds = (ids: string[]): string[] => [
  ...prepareMusicBrainzBatchIds(ids),
];

export const collectAlbumTrackArtists = (
  value: unknown
): { artistId: string; artistName: string }[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const artists = new Map<string, string>();
  let inspectedTracks = 0;
  outer: for (const medium of value.slice(0, MAX_ALBUM_MEDIA)) {
    if (!medium || typeof medium !== 'object') continue;
    const tracks = (medium as { tracks?: unknown }).tracks;
    if (!Array.isArray(tracks)) continue;

    for (const track of tracks) {
      if (inspectedTracks >= MAX_ALBUM_TRACKS) {
        break outer;
      }
      inspectedTracks += 1;
      if (!track || typeof track !== 'object') continue;
      const credits = (track as { artists?: unknown }).artists;
      if (!Array.isArray(credits)) continue;

      for (const credit of credits.slice(0, MAX_ALBUM_TRACK_ARTISTS)) {
        if (!credit || typeof credit !== 'object') continue;
        const { artist_mbid: rawId, artist_credit_name: rawName } = credit as {
          artist_mbid?: unknown;
          artist_credit_name?: unknown;
        };
        if (
          typeof rawId !== 'string' ||
          rawId.length > 128 ||
          typeof rawName !== 'string' ||
          rawName.length > 512
        ) {
          continue;
        }
        const artistId = normalizeMusicBrainzId(rawId);
        const artistName = rawName.trim();
        if (artistId && artistName && !artists.has(artistId)) {
          artists.set(artistId, artistName);
        }
        if (artists.size >= MAX_MUSICBRAINZ_BATCH_IDS) {
          break outer;
        }
      }
    }
  }

  return [...artists].map(([artistId, artistName]) => ({
    artistId,
    artistName,
  }));
};

const mapMusicBrainzReleaseGroupToListenBrainzAlbum = (
  album: MbAlbumDetails
): LbAlbumDetails => {
  const primaryArtist = album['artist-credit']?.[0]?.artist;
  const firstReleaseId = album.releases?.[0]?.id ?? '';

  return {
    caa_id: 0,
    caa_release_mbid: firstReleaseId,
    listening_stats: {
      artist_mbids: primaryArtist?.id ? [primaryArtist.id] : [],
      artist_name:
        album['artist-credit']?.[0]?.name ?? primaryArtist?.name ?? '',
      caa_id: 0,
      caa_release_mbid: firstReleaseId,
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
        caa_release_mbid: firstReleaseId,
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

musicRoutes.get('/:id/rating', async (req, res) => {
  const parsedMbId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedMbId) {
    return res.status(404).json({ status: 404, message: 'Album not found' });
  }

  try {
    const album = await new MusicBrainz().getReleaseGroupDetails({
      releaseGroupId: parsedMbId.value,
    });
    if (album.rating) {
      const response: MusicRatingResponse = {
        rating: {
          score: Math.round(album.rating.value * 20) / 10,
          votes: album.rating['votes-count'],
          url: `https://musicbrainz.org/release-group/${encodeURIComponent(
            parsedMbId.value
          )}`,
          source: 'musicbrainz',
        },
      };
      return res.status(200).json(response);
    }
  } catch (e) {
    logger.warn('MusicBrainz album rating unavailable', {
      label: 'Music API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      mbId: parsedMbId.value,
    });
  }

  try {
    const media = await getRepository(Media).findOne({
      where: { mbId: parsedMbId.value, mediaType: MediaType.MUSIC },
    });
    const service = media?.serviceId
      ? getExternalRuntimeConfig().lidarr.find(
          (candidate) => candidate.id === media.serviceId
        )
      : undefined;
    if (service && media?.externalServiceId) {
      const album = await runWithServarrServiceSnapshot(
        'lidarr',
        service,
        (currentService) =>
          new LidarrAPI({
            apiKey: currentService.apiKey,
            url: LidarrAPI.buildUrl(currentService, '/api/v1'),
          }).getAlbum({ id: media.externalServiceId! }, 300)
      );
      const ratings = album.ratings;
      if (
        ratings &&
        Number.isFinite(ratings.value) &&
        ratings.value >= 0 &&
        ratings.value <= 10 &&
        Number.isSafeInteger(ratings.votes) &&
        ratings.votes >= 0
      ) {
        return res.status(200).json({
          rating: {
            score: Math.round(ratings.value * 10) / 10,
            votes: ratings.votes,
            url:
              service.externalUrl ||
              `https://musicbrainz.org/release-group/${encodeURIComponent(
                parsedMbId.value
              )}`,
            source: 'lidarr',
          },
        } satisfies MusicRatingResponse);
      }
    }
  } catch (e) {
    logger.warn('Lidarr album rating unavailable', {
      label: 'Music API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
      mbId: parsedMbId.value,
    });
  }

  return res.status(200).json({} satisfies MusicRatingResponse);
});

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
  const coverArtArchive = new CoverArtArchive();

  try {
    const [albumDetails, media, onUserWatchlist] = await Promise.all([
      getAlbumDetails(mbId, listenbrainz, musicbrainz),
      getRepository(Media)
        .findOne({
          where: { mbId, mediaType: MediaType.MUSIC },
          relations: {
            issues: {
              createdBy: true,
              modifiedBy: true,
              comments: { user: true },
            },
          },
          // Requests, issues, and comments are independent one-to-many
          // relations. Joined hydration multiplies their row counts before
          // TypeORM can reconstruct the entities.
          relationLoadStrategy: 'query',
        })
        .then(async (media) => {
          if (media) {
            await hydrateMediaSummaryRelations([media], req.user);
          }
          return media ?? undefined;
        }),
      req.user
        ? getRepository(Watchlist).exists({
            where: {
              mbId,
              requestedBy: { id: req.user.id },
            },
          })
        : false,
    ]);

    const artistId = albumDetails.release_group_metadata?.artist?.artists?.[0]
      ?.artist_mbid
      ? normalizeMusicBrainzId(
          albumDetails.release_group_metadata.artist.artists[0].artist_mbid
        )
      : undefined;
    const isPerson =
      albumDetails.release_group_metadata?.artist?.artists?.[0]?.type ===
      'Person';
    const trackArtists = collectAlbumTrackArtists(albumDetails.mediums);
    const trackArtistIds = trackArtists.map((artist) => artist.artistId);
    const releaseId = [
      albumDetails.caa_release_mbid,
      albumDetails.recordings_release_mbid,
      albumDetails.release_group_metadata?.release?.caa_release_mbid,
    ]
      .map((id) => (id ? normalizeMusicBrainzId(id) : ''))
      .find((id) => isValidMusicBrainzResourceId(id));

    const [
      coverArt,
      metadataArtist,
      trackArtistMetadata,
      artistWikipedia,
      recordLabels,
    ] = await Promise.allSettled([
      coverArtArchive.getCoverArt(mbId),
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
            })
            .catch(() => null)
        : Promise.resolve(null),
      releaseId
        ? musicbrainz.getReleaseLabels({ releaseId })
        : Promise.resolve([]),
    ]);

    const resolvedCoverArtUrl =
      coverArt.status === 'fulfilled'
        ? (coverArt.value.images.find((image) => image.front)
            ?.thumbnails[250] ?? null)
        : null;
    const resolvedMetadataArtist =
      metadataArtist.status === 'fulfilled' ? metadataArtist.value : undefined;
    const resolvedTrackArtistMetadata =
      trackArtistMetadata.status === 'fulfilled'
        ? trackArtistMetadata.value
        : [];
    const resolvedArtistWikipedia =
      artistWikipedia.status === 'fulfilled' ? artistWikipedia.value : null;
    const resolvedRecordLabels =
      recordLabels.status === 'fulfilled' ? recordLabels.value : [];

    const trackArtistsToMap = trackArtists.filter(
      (artist) =>
        !resolvedTrackArtistMetadata.some(
          (metadata) =>
            normalizeMusicBrainzId(metadata.mbArtistId) === artist.artistId &&
            metadata.tmdbPersonId
        )
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
    const lidarrServices = getExternalRuntimeConfig().lidarr;
    const trackAvailabilityPromise = getMusicTrackAvailability(
      mbId,
      lidarrServices
    );
    const destinationRequests = media?.id
      ? await getRepository(MediaRequest)
          .createQueryBuilder('request')
          .select(['request.id', 'request.serviceTargets'])
          .innerJoin('request.media', 'requestMedia')
          .where('requestMedia.id = :mediaId', { mediaId: media.id })
          .getMany()
      : [];
    const availableServices = getAvailableMusicServices(
      media,
      destinationRequests,
      lidarrServices
    );
    const trackAvailability = await trackAvailabilityPromise;
    const finalTrackArtistMetadata =
      updatedArtistMetadata || resolvedTrackArtistMetadata;

    await upsertMediaSearchMetadata(media?.id, {
      title: mappedDetails.title,
      releaseDate: mappedDetails.releaseDate,
      genres: mappedDetails.tags?.releaseGroup.map((tag) => tag.tag).join(', '),
      runtime: mappedDetails.tracks.length
        ? `${mappedDetails.tracks.length} tracks`
        : undefined,
      artist: mappedDetails.artist.name,
      albumType: mappedDetails.type,
      format: 'Music Album',
      provider: 'MusicBrainz',
      externalIds: mappedDetails.mbId,
    });

    return res.status(200).json(
      filterEntityResponse(
        {
          ...mappedDetails,
          posterPath: resolvedCoverArtUrl,
          needsCoverArt: !resolvedCoverArtUrl,
          artistWikipedia: resolvedArtistWikipedia,
          recordLabel: resolvedRecordLabels.length
            ? resolvedRecordLabels.join(', ')
            : undefined,
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
          availableServices,
          trackAvailability,
          tracks: mappedDetails.tracks.map((track) => ({
            ...track,
            artists: track.artists.map((artist) => {
              const metadata = finalTrackArtistMetadata.find(
                (m) =>
                  normalizeMusicBrainzId(m.mbArtistId) ===
                  normalizeMusicBrainzId(artist.mbid)
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
        },
        req.user
      )
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
    const artistId = artistData?.artist_mbid
      ? normalizeMusicBrainzId(artistData.artist_mbid)
      : undefined;
    const artistType = artistData?.type;

    if (!artistId || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const responses = await Promise.allSettled([
      listenbrainzApi.getArtist(artistId),
      theAudioDb.getArtistImagesFromCache(artistId),
      metadataArtistRepository.findOne({
        where: { mbArtistId: artistId },
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
        ? theAudioDb.getArtistImages(artistId)
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
    const coverArtArchive = new CoverArtArchive();

    const page = parsePositiveInt(req.query.page, 1, MAX_PAGE);
    const pageSize = parsePositiveInt(req.query.pageSize, 20, 50);
    const parsedSlider = parseOptionalQueryBoolean(req.query.slider, 'Slider');
    if ('error' in parsedSlider) {
      return res.status(400).json({ status: 400, message: parsedSlider.error });
    }
    const isSlider = parsedSlider.value ?? false;

    const albumData = await listenbrainzApi.getAlbum(mbId);
    const artistData = albumData?.release_group_metadata?.artist?.artists?.[0];
    const artistId = artistData?.artist_mbid
      ? normalizeMusicBrainzId(artistData.artist_mbid)
      : undefined;
    const artistType = artistData?.type;

    if (!artistId || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const artistDetails = await listenbrainzApi.getArtist(artistId);

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
      coverArtArchive.batchGetCoverArt(releaseGroupIds),
    ]);

    const relatedMedia =
      mediaResponses[0].status === 'fulfilled' ? mediaResponses[0].value : [];
    const coverArtByAlbumId =
      mediaResponses[1].status === 'fulfilled' ? mediaResponses[1].value : {};

    const relatedMediaMap = new Map(
      relatedMedia
        .filter((media) => media.mbId)
        .map((media) => [normalizeMusicBrainzId(media.mbId as string), media])
    );
    const lidarrServices = getExternalRuntimeConfig().lidarr;

    const transformedReleaseGroups = paginatedReleaseGroups.map(
      (releaseGroup) => {
        const releaseGroupId = normalizeMusicBrainzId(releaseGroup.mbid);
        const posterPath = coverArtByAlbumId[releaseGroupId] ?? null;
        const media = relatedMediaMap.get(releaseGroupId);
        return {
          id: releaseGroupId,
          mediaType: 'album',
          title: releaseGroup.name,
          'first-release-date': releaseGroup.date,
          'artist-credit': [{ name: releaseGroup.artist_credit_name }],
          'primary-type': releaseGroup.type || 'Other',
          posterPath,
          needsCoverArt: !posterPath,
          mediaInfo: media,
          availableQualities: getAvailableMusicQualities(
            media,
            media?.requests ?? [],
            lidarrServices
          ),
          qualityStatuses: getMusicQualityStatuses(
            media,
            media?.requests ?? [],
            lidarrServices
          ),
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
    const artistId = artistData?.artist_mbid
      ? normalizeMusicBrainzId(artistData.artist_mbid)
      : undefined;
    const artistType = artistData?.type;

    if (!artistId || artistType === 'Other') {
      return res.status(404).json({
        status: 404,
        message: 'Artist details not available for this type',
      });
    }

    const artistDetails = await listenbrainzApi.getArtist(artistId);

    if (!artistDetails) {
      return res.status(404).json({ status: 404, message: 'Artist not found' });
    }

    const allSimilarArtists = [
      ...(artistDetails.similarArtists?.artists ?? []),
    ].sort((a, b) => b.score - a.score);

    const totalResults = allSimilarArtists.length;
    const totalPages = Math.max(Math.ceil(totalResults / pageSize), 1);

    const paginatedSimilarArtists = allSimilarArtists.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    const similarArtistIds = normalizeMusicBrainzIds(
      paginatedSimilarArtists.map((a) => a.artist_mbid)
    );

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
      similarArtistMetadata.map((metadata) => [
        normalizeMusicBrainzId(metadata.mbArtistId),
        metadata,
      ])
    );

    const artistsNeedingImages = similarArtistIds.filter((id) => {
      const metadata = similarArtistMetadataMap.get(id);
      return !metadata?.tadbThumb && !metadata?.tadbCover;
    });

    const personArtists =
      paginatedSimilarArtists
        .filter((artist) => artist.type === 'Person')
        .filter((artist) => {
          const metadata = similarArtistMetadataMap.get(
            normalizeMusicBrainzId(artist.artist_mbid)
          );
          return !metadata?.tmdbPersonId;
        })
        .map((artist) => ({
          artistId: normalizeMusicBrainzId(artist.artist_mbid),
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
        normalizeMusicBrainzId(metadata.mbArtistId),
        metadata,
      ])
    );

    const transformedSimilarArtists = paginatedSimilarArtists.map((artist) => {
      const normalizedArtistId = normalizeMusicBrainzId(artist.artist_mbid);
      const metadata = finalArtistMetadataMap.get(normalizedArtistId);
      const artistImageResult = artistImageResults[normalizedArtistId];

      const artistThumb =
        metadata?.tadbThumb || (artistImageResult?.artistThumb ?? null);

      return {
        id: normalizedArtistId,
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
