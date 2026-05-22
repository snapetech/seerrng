import ListenBrainzAPI from '@server/api/listenbrainz';
import type { LbReleaseGroupExtended } from '@server/api/listenbrainz/interfaces';
import MusicBrainz from '@server/api/musicbrainz';
import TheAudioDb from '@server/api/theaudiodb';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MetadataAlbum from '@server/entity/MetadataAlbum';
import MetadataArtist from '@server/entity/MetadataArtist';
import { getAssociations } from '@server/lib/associations';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import logger from '@server/logger';
import { parsePositiveInt } from '@server/utils/pagination';
import {
  parseBoundedString,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import { Router } from 'express';
import { In } from 'typeorm';

const artistRoutes = Router();
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 500;
const MAX_MUSICBRAINZ_ID_LENGTH = 128;
const MAX_ALBUM_TYPE_LENGTH = 128;
const ALL_ALBUM_TYPES = 'All';

const parseMusicBrainzId = (value: unknown, fieldName = 'Artist ID') =>
  parseBoundedString(value, {
    fieldName,
    maxLength: MAX_MUSICBRAINZ_ID_LENGTH,
  });

const normalizeParsedMusicBrainzId = (
  parsed: ReturnType<typeof parseMusicBrainzId>
) =>
  'error' in parsed ? parsed : { value: normalizeMusicBrainzId(parsed.value) };

const normalizeReleaseGroupTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const dedupeReleaseGroups = (releaseGroups: LbReleaseGroupExtended[]) => {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return releaseGroups.filter((releaseGroup) => {
    const idKey = normalizeMusicBrainzId(releaseGroup.mbid);
    const type = releaseGroup.secondary_types?.length
      ? releaseGroup.secondary_types[0]
      : releaseGroup.type || 'Other';
    const titleKey = [
      normalizeReleaseGroupTitle(releaseGroup.name),
      releaseGroup.artist_credit_name.toLocaleLowerCase(),
      releaseGroup.date?.slice(0, 4) ?? '',
      type.toLocaleLowerCase(),
    ].join('|');

    if (seenIds.has(idKey) || seenTitles.has(titleKey)) {
      return false;
    }

    seenIds.add(idKey);
    seenTitles.add(titleKey);
    return true;
  });
};

artistRoutes.get('/:id/similar', async (req, res, next) => {
  const parsedArtistId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedArtistId) {
    return res.status(404).json({ status: 404, message: 'Artist not found' });
  }

  const artistId = parsedArtistId.value;
  const page = parsePositiveInt(req.query.page, 1, MAX_PAGE);
  const pageSize = parsePositiveInt(
    req.query.pageSize,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  try {
    const graph = await getAssociations('artist', artistId, req.user, {
      includeWeak: true,
      limit: 60,
    });
    const results = graph.edges
      .filter(
        (edge) =>
          (edge.type === 'similar' || edge.type === 'shared-genre') &&
          edge.node.mediaType === 'artist'
      )
      .map((edge) => edge.node);
    const totalResults = results.length;
    const totalPages = Math.max(Math.ceil(totalResults / pageSize), 1);

    return res.status(200).json({
      page,
      pageSize,
      totalPages,
      totalResults,
      results: results.slice((page - 1) * pageSize, page * pageSize),
    });
  } catch (e) {
    logger.error('Something went wrong retrieving similar artists', {
      label: 'Artist API',
      errorMessage: e.message,
      artistId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve similar artists.',
    });
  }
});

artistRoutes.get('/:id', async (req, res, next) => {
  const parsedArtistId = normalizeParsedMusicBrainzId(
    parseMusicBrainzId(req.params.id)
  );
  if ('error' in parsedArtistId) {
    return res.status(404).json({ status: 404, message: 'Artist not found' });
  }

  const parsedAlbumType = parseOptionalBoundedString(req.query.albumType, {
    fieldName: 'Album type',
    maxLength: MAX_ALBUM_TYPE_LENGTH,
  });
  if ('error' in parsedAlbumType) {
    return res
      .status(400)
      .json({ status: 400, message: parsedAlbumType.error });
  }

  const artistId = parsedArtistId.value;
  const listenbrainz = new ListenBrainzAPI();
  const musicbrainz = new MusicBrainz();
  const theAudioDb = new TheAudioDb();

  const page = parsePositiveInt(req.query.page, 1, MAX_PAGE);
  const pageSize = parsePositiveInt(
    req.query.pageSize,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const initialItemsPerType = 20;
  const albumType = parsedAlbumType.value;

  try {
    const [artistData, metadataArtist] = await Promise.all([
      listenbrainz.getArtist(artistId),
      getRepository(MetadataArtist).findOne({
        where: { mbArtistId: artistId },
        select: ['mbArtistId', 'tadbThumb', 'tadbCover', 'tmdbThumb'],
      }),
    ]);

    if (!artistData) {
      throw new Error('Artist not found');
    }

    const releaseGroups = dedupeReleaseGroups(artistData.releaseGroups);
    const groupedReleaseGroups = releaseGroups.reduce(
      (acc, rg) => {
        const type = rg.secondary_types?.length
          ? rg.secondary_types[0]
          : rg.type || 'Other';

        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(rg);
        return acc;
      },
      {} as Record<string, typeof artistData.releaseGroups>
    );

    Object.keys(groupedReleaseGroups).forEach((type) => {
      groupedReleaseGroups[type].sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
    });

    let releaseGroupsToProcess: LbReleaseGroupExtended[];
    let totalCount;
    let totalPages;

    if (albumType === ALL_ALBUM_TYPES) {
      const allReleaseGroups = Object.values(groupedReleaseGroups).flat();
      allReleaseGroups.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });

      totalCount = allReleaseGroups.length;
      totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

      releaseGroupsToProcess = allReleaseGroups.slice(
        (page - 1) * pageSize,
        page * pageSize
      );
    } else if (albumType) {
      const filteredReleaseGroups = groupedReleaseGroups[albumType] || [];
      totalCount = filteredReleaseGroups.length;
      totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

      releaseGroupsToProcess = filteredReleaseGroups.slice(
        (page - 1) * pageSize,
        page * pageSize
      );
    } else {
      releaseGroupsToProcess = [];
      Object.entries(groupedReleaseGroups).forEach(([, releases]) => {
        releaseGroupsToProcess.push(...releases.slice(0, initialItemsPerType));
      });

      totalCount = Object.values(groupedReleaseGroups).reduce(
        (sum, releases) => sum + releases.length,
        0
      );
      totalPages = 1;
    }

    const mbIds = [
      ...new Set(
        releaseGroupsToProcess.map((rg) => normalizeMusicBrainzId(rg.mbid))
      ),
    ];

    const responses = await Promise.allSettled([
      musicbrainz
        .getArtistWikipediaExtract({
          artistMbid: artistId,
          language: req.locale,
        })
        .catch(() => null),
      !metadataArtist?.tadbThumb && !metadataArtist?.tadbCover
        ? theAudioDb.getArtistImages(artistId)
        : theAudioDb.getArtistImagesFromCache(artistId),
      Media.getRelatedMedia(req.user, mbIds),
      getRepository(MetadataAlbum).find({
        where: { mbAlbumId: In(mbIds) },
        cache: true,
      }),
    ]);

    const artistWikipedia =
      responses[0].status === 'fulfilled' ? responses[0].value : null;
    const artistImages =
      responses[1].status === 'fulfilled' ? responses[1].value : null;
    const relatedMedia =
      responses[2].status === 'fulfilled' ? responses[2].value : [];
    const albumMetadata =
      responses[3].status === 'fulfilled' ? responses[3].value : [];

    const metadataMap = new Map(
      albumMetadata.map((metadata) => [metadata.mbAlbumId, metadata])
    );

    const mediaMap = new Map(
      relatedMedia
        .filter((media) => media.mbId)
        .map((media) => [normalizeMusicBrainzId(media.mbId as string), media])
    );

    const mappedReleaseGroups = releaseGroupsToProcess.map((releaseGroup) => {
      const metadata = metadataMap.get(releaseGroup.mbid);
      const coverArtUrl = metadata?.caaUrl || null;

      return {
        id: releaseGroup.mbid,
        mediaType: 'album',
        title: releaseGroup.name,
        'first-release-date': releaseGroup.date,
        'artist-credit': [{ name: releaseGroup.artist_credit_name }],
        'primary-type': releaseGroup.type || 'Other',
        secondary_types: releaseGroup.secondary_types || [],
        total_listen_count: releaseGroup.total_listen_count || 0,
        posterPath: coverArtUrl,
        needsCoverArt: !coverArtUrl,
        mediaInfo: mediaMap.get(normalizeMusicBrainzId(releaseGroup.mbid)),
      };
    });

    const typeCounts = Object.fromEntries(
      Object.entries(groupedReleaseGroups).map(([type, releases]) => [
        type,
        releases.length,
      ])
    );

    return res.status(200).json({
      ...artistData,
      wikipedia: artistWikipedia,
      artistThumb:
        metadataArtist?.tmdbThumb ??
        metadataArtist?.tadbThumb ??
        artistImages?.artistThumb ??
        null,
      artistBackdrop:
        metadataArtist?.tadbCover ?? artistImages?.artistBackground ?? null,
      releaseGroups: mappedReleaseGroups,
      pagination: {
        page,
        pageSize,
        totalItems: totalCount,
        totalPages,
        albumType,
      },
      typeCounts,
    });
  } catch (e) {
    logger.error('Something went wrong retrieving artist details', {
      label: 'Artist API',
      errorMessage: e.message,
      artistId,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve artist.',
    });
  }
});

export default artistRoutes;
