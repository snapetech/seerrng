import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI, {
  type OpenLibraryAuthorWork,
} from '@server/api/openlibrary';
import TheAudioDb from '@server/api/theaudiodb';
import TheMovieDb from '@server/api/themoviedb';
import TmdbPersonMapper from '@server/api/themoviedb/personMapper';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import MetadataArtist from '@server/entity/MetadataArtist';
import type { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { normalizeOpenLibraryWorkId } from '@server/lib/externalIds';
import { getSettings } from '@server/lib/settings';
import { scoreTmdbResult } from '@server/lib/tmdbRank';
import logger from '@server/logger';
import { mapOpenLibraryAuthorWork } from '@server/models/Book';
import type {
  ArtistResult,
  BookResult,
  MovieResult,
  TvResult,
} from '@server/models/Search';
import { mapMovieResult, mapTvResult } from '@server/models/Search';
import { In } from 'typeorm';
import { musicToScreen, screenToMusic } from './personBridge';
import type {
  AssociationEdge,
  AssociationGraph,
  AssociationMediaType,
  AssociationOptions,
} from './types';
import { ASSOCIATION_LIMITS } from './types';

const cache = cacheManager.getCache('associations');

const ISO_639_1_TO_OPENLIBRARY: Record<string, string> = {
  ar: 'ara',
  ca: 'cat',
  cs: 'cze',
  da: 'dan',
  de: 'ger',
  el: 'gre',
  en: 'eng',
  es: 'spa',
  et: 'est',
  eu: 'baq',
  fi: 'fin',
  fr: 'fre',
  he: 'heb',
  hi: 'hin',
  hr: 'hrv',
  hu: 'hun',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  lt: 'lit',
  nl: 'dut',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'rum',
  ru: 'rus',
  sk: 'slo',
  sl: 'slv',
  sq: 'alb',
  sr: 'srp',
  sv: 'swe',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'chi',
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const scoreScreenResult = (result: {
  popularity: number;
  vote_average: number;
  vote_count: number;
  release_date?: string;
  first_air_date?: string;
}): number =>
  clamp01(
    scoreTmdbResult({
      ...result,
      date: result.first_air_date ?? result.release_date,
    }) / 120
  );

const dedupeKey = (edge: AssociationEdge): string =>
  `${edge.node.mediaType}:${edge.node.id}`;

const finalize = (
  root: AssociationGraph['root'],
  edges: AssociationEdge[],
  opts: AssociationOptions
): AssociationGraph => {
  const seen = new Set<string>();
  const deduped: AssociationEdge[] = [];
  for (const edge of [...edges].sort((a, b) => b.weight - a.weight)) {
    const key = dedupeKey(edge);
    if (seen.has(key) || key === `${root.mediaType}:${root.id}`) {
      continue;
    }
    seen.add(key);
    deduped.push(edge);
  }
  return {
    root,
    edges: deduped.slice(0, opts.limit ?? ASSOCIATION_LIMITS.DEFAULT_TOTAL),
  };
};

const buildForScreen = async (
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  user: User | undefined,
  opts: AssociationOptions
): Promise<AssociationGraph> => {
  const tmdb = new TheMovieDb();
  const isTv = mediaType === 'tv';

  const [detail, similar, recommendations] = await Promise.all([
    isTv
      ? tmdb.getTvShow({ tvId: tmdbId })
      : tmdb.getMovie({ movieId: tmdbId }),
    isTv
      ? tmdb.getTvSimilar({ tvId: tmdbId })
      : tmdb.getMovieSimilar({ movieId: tmdbId }),
    isTv
      ? tmdb.getTvRecommendations({ tvId: tmdbId })
      : tmdb.getMovieRecommendations({ movieId: tmdbId }),
  ]);

  const rootTitle =
    'name' in detail ? detail.name : (detail as { title: string }).title;
  const rootGenres = new Map(detail.genres.map((g) => [g.id, g.name]));

  const tagged = [
    ...similar.results.map((r) => [r, 'similar'] as const),
    ...recommendations.results.map((r) => [r, 'recommended'] as const),
  ];

  const relatedMedia = await Media.getRelatedMedia(
    user,
    tagged.map(([r]) => ({
      tmdbId: r.id,
      mediaType: isTv ? MediaType.TV : MediaType.MOVIE,
    }))
  );

  const edges: AssociationEdge[] = [];
  for (const [r, type] of tagged) {
    const media = relatedMedia.find(
      (m) =>
        m.tmdbId === r.id &&
        m.mediaType === (isTv ? MediaType.TV : MediaType.MOVIE)
    );
    const node: MovieResult | TvResult = isTv
      ? mapTvResult(r as Parameters<typeof mapTvResult>[0], media)
      : mapMovieResult(r as Parameters<typeof mapMovieResult>[0], media);
    const genreIds = 'genre_ids' in r ? (r.genre_ids ?? []) : [];
    const sharedGenre = genreIds.find((gid) => rootGenres.has(gid));

    if (opts.includeWeak && type === 'recommended' && sharedGenre) {
      edges.push({
        weight: scoreScreenResult(r) * 0.4,
        type: 'shared-genre',
        reason: `Shares ${rootGenres.get(sharedGenre)}`,
        node,
      });
    } else {
      edges.push({
        weight: scoreScreenResult(r) * (type === 'similar' ? 1 : 0.85),
        type,
        reason:
          type === 'similar'
            ? 'Similar tone and audience'
            : 'Often recommended with this',
        node,
      });
    }
  }

  const cast =
    'aggregate_credits' in detail
      ? detail.aggregate_credits.cast
      : detail.credits.cast;
  const crew =
    'aggregate_credits' in detail ? detail.credits.crew : detail.credits.crew;
  try {
    edges.push(...(await screenToMusic(cast, crew)));
  } catch (e) {
    logger.debug('screenToMusic bridge failed', {
      label: 'Associations',
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }

  return finalize(
    { mediaType, id: String(tmdbId), title: rootTitle },
    edges,
    opts
  );
};

const hydrateArtistThumbs = async (
  mbIds: string[]
): Promise<Map<string, MetadataArtist>> => {
  if (mbIds.length === 0) {
    return new Map();
  }
  try {
    const rows = await getRepository(MetadataArtist).find({
      where: { mbArtistId: In(mbIds) },
    });
    return new Map(rows.map((r) => [r.mbArtistId, r]));
  } catch {
    return new Map();
  }
};

const hydrateSimilarArtists = async (
  artists: { artist_mbid: string; name: string; type?: string | null }[]
): Promise<{
  metadata: Map<string, MetadataArtist>;
  images: Record<
    string,
    { artistThumb: string | null; artistBackground: string | null }
  >;
}> => {
  const mbIds = artists.map((artist) => artist.artist_mbid).filter(Boolean);
  const metadataArtistRepository = getRepository(MetadataArtist);
  const theAudioDb = new TheAudioDb();
  const personMapper = new TmdbPersonMapper();

  const initialMetadata = await hydrateArtistThumbs(mbIds);
  const artistsNeedingImages = mbIds.filter((id) => {
    const metadata = initialMetadata.get(id);
    return !metadata?.tadbThumb && !metadata?.tadbCover;
  });
  const personArtists = artists
    .filter((artist) => artist.type === 'Person')
    .filter((artist) => !initialMetadata.get(artist.artist_mbid)?.tmdbPersonId)
    .map((artist) => ({
      artistId: artist.artist_mbid,
      artistName: artist.name,
    }));

  const [imageResult, mappingResult] = await Promise.allSettled([
    artistsNeedingImages.length > 0
      ? theAudioDb.batchGetArtistImages(artistsNeedingImages)
      : Promise.resolve({}),
    personArtists.length > 0
      ? personMapper.batchGetMappings(personArtists).then(() =>
          metadataArtistRepository.find({
            where: { mbArtistId: In(mbIds) },
          })
        )
      : Promise.resolve(Array.from(initialMetadata.values())),
  ]);

  const metadataRows =
    mappingResult.status === 'fulfilled'
      ? mappingResult.value
      : Array.from(initialMetadata.values());

  return {
    metadata: new Map(metadataRows.map((row) => [row.mbArtistId, row])),
    images: imageResult.status === 'fulfilled' ? imageResult.value : {},
  };
};

const findBookMediaByOpenLibraryIds = async (
  ids: string[],
  userId?: number
): Promise<Map<string, Media>> => {
  if (!ids.length) {
    return new Map();
  }

  const identifiers = await getRepository(MediaIdentifier).find({
    where: {
      provider: MediaIdentifierProvider.OPENLIBRARY,
      value: In(ids),
    },
    relations: { media: { requests: true, watchlists: true } },
  });

  return new Map(
    identifiers
      .filter((identifier) => identifier.media.mediaType === MediaType.BOOK)
      .map((identifier) => {
        identifier.media.watchlists =
          identifier.media.watchlists?.filter(
            (watchlist) => watchlist.requestedBy.id === userId
          ) ?? [];

        return [identifier.value, identifier.media];
      })
  );
};

const scoreBookWork = (book: BookResult): number => {
  const recencyScore = book.firstPublishYear
    ? Math.max(
        0,
        30 - Math.max(0, new Date().getUTCFullYear() - book.firstPublishYear)
      ) / 30
    : 0;
  const metadataScore = (book.posterPath ? 0.2 : 0) + (book.author ? 0.1 : 0);

  return clamp01(0.65 + recencyScore * 0.25 + metadataScore);
};

const normalizeBookAssociationTitle = (title: string) =>
  title
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const getPreferredOpenLibraryLanguage = () => {
  const settings = getSettings();
  const language = (
    settings.main.originalLanguage ||
    settings.main.locale ||
    ''
  )
    .split(/[-_]/)[0]
    ?.toLowerCase();

  return language ? ISO_639_1_TO_OPENLIBRARY[language] : undefined;
};

const filterBookAssociationWorks = (
  works: OpenLibraryAuthorWork[],
  currentWorkKey: string,
  preferredLanguage?: string
) => {
  const seenTitles = new Set<string>();

  return works.filter((work) => {
    if (work.key === currentWorkKey) {
      return false;
    }

    if (
      preferredLanguage &&
      work.languages?.length &&
      !work.languages.some(
        (language) =>
          language.key.replace('/languages/', '').toLowerCase() ===
          preferredLanguage
      )
    ) {
      return false;
    }

    const titleKey = normalizeBookAssociationTitle(work.title);

    if (seenTitles.has(titleKey)) {
      return false;
    }

    seenTitles.add(titleKey);
    return true;
  });
};

const buildArtistEdges = async (
  mbArtistId: string,
  artistName: string,
  user: User | undefined
): Promise<AssociationEdge[]> => {
  const listenbrainz = new ListenBrainzAPI();
  const artist = await listenbrainz.getArtist(mbArtistId);

  const similar = (artist.similarArtists?.artists ?? [])
    .filter((a) => a.artist_mbid)
    .sort((a, b) => b.score - a.score)
    .slice(0, ASSOCIATION_LIMITS.MAX_SAME_MEDIUM);

  const maxScore = similar.reduce((m, a) => Math.max(m, a.score), 0) || 1;
  const { metadata, images } = await hydrateSimilarArtists(similar);

  const edges: AssociationEdge[] = similar.map((a, idx) => {
    const meta = metadata.get(a.artist_mbid);
    const imageResult = images[a.artist_mbid];
    const artistThumb = meta?.tadbThumb ?? imageResult?.artistThumb ?? null;
    const node: ArtistResult = {
      id: a.artist_mbid,
      score: a.score,
      mediaType: 'artist',
      name: a.name,
      type: a.type === 'Group' ? 'Group' : 'Person',
      'sort-name': a.name,
      artistThumb: meta?.tmdbThumb ?? artistThumb,
      artistBackdrop: meta?.tadbCover ?? imageResult?.artistBackground ?? null,
      tmdbPersonId: meta?.tmdbPersonId ? Number(meta.tmdbPersonId) : undefined,
    };
    // Tail of the similar list is treated as weak genre-proximity.
    const isWeakTail = idx >= 10;
    return {
      weight: clamp01(a.score / maxScore) * (isWeakTail ? 0.4 : 1),
      type: isWeakTail ? 'shared-genre' : 'similar',
      reason: isWeakTail ? 'Nearby listener overlap' : 'Similar artist',
      node,
    };
  });

  try {
    edges.push(...(await musicToScreen(mbArtistId, artistName, user)));
  } catch (e) {
    logger.debug('musicToScreen bridge failed', {
      label: 'Associations',
      error: e instanceof Error ? e.message : 'Unknown error',
    });
  }

  return edges;
};

const buildForArtist = async (
  mbArtistId: string,
  user: User | undefined,
  opts: AssociationOptions
): Promise<AssociationGraph> => {
  const listenbrainz = new ListenBrainzAPI();
  const artist = await listenbrainz.getArtist(mbArtistId);
  const name = artist.artist?.name ?? '';
  const edges = await buildArtistEdges(mbArtistId, name, user);
  return finalize(
    { mediaType: 'artist', id: mbArtistId, title: name },
    opts.includeWeak ? edges : edges.filter((e) => e.type !== 'shared-genre'),
    opts
  );
};

const buildForAlbum = async (
  mbAlbumId: string,
  user: User | undefined,
  opts: AssociationOptions
): Promise<AssociationGraph> => {
  const listenbrainz = new ListenBrainzAPI();
  const album = await listenbrainz.getAlbum(mbAlbumId);
  const rootArtist = album.release_group_metadata?.artist?.artists?.[0];
  const rootTitle =
    album.release_group_metadata?.release_group?.name ?? 'Album';

  if (!rootArtist?.artist_mbid) {
    return finalize(
      { mediaType: 'album', id: mbAlbumId, title: rootTitle },
      [],
      opts
    );
  }

  const edges = await buildArtistEdges(
    rootArtist.artist_mbid,
    rootArtist.name,
    user
  );
  return finalize(
    { mediaType: 'album', id: mbAlbumId, title: rootTitle },
    opts.includeWeak ? edges : edges.filter((e) => e.type !== 'shared-genre'),
    opts
  );
};

const buildForBook = async (
  openLibraryId: string,
  user: User | undefined,
  opts: AssociationOptions
): Promise<AssociationGraph> => {
  const openLibrary = new OpenLibraryAPI();
  let work = await openLibrary.getWork(openLibraryId);
  let workId = openLibraryId;

  if (!work.key || !/^\/works\//i.test(work.key)) {
    const edition = await openLibrary.getEdition(openLibraryId);
    const editionWorkId = edition.works?.[0]?.key
      ? normalizeOpenLibraryWorkId(edition.works[0].key)
      : undefined;
    if (editionWorkId) {
      work = await openLibrary.getWork(editionWorkId);
      workId = editionWorkId;
    }
  }

  const authorId = work.authors?.[0]?.author?.key?.replace('/authors/', '');

  if (!authorId) {
    return finalize(
      { mediaType: 'book', id: workId, title: work.title },
      [],
      opts
    );
  }

  const [author, authorWorks] = await Promise.all([
    openLibrary.getAuthor(authorId).catch(() => undefined),
    openLibrary.getAuthorWorks(authorId, {
      limit: ASSOCIATION_LIMITS.MAX_SAME_MEDIUM + 1,
    }),
  ]);
  const books = filterBookAssociationWorks(
    authorWorks.entries,
    work.key,
    getPreferredOpenLibraryLanguage()
  ).slice(0, ASSOCIATION_LIMITS.MAX_SAME_MEDIUM);
  const bookIds = books.map((book) => normalizeOpenLibraryWorkId(book.key));
  const mediaByOpenLibraryId = await findBookMediaByOpenLibraryIds(
    bookIds,
    user?.id
  );

  const edges = books.map((authorWork) => {
    const bookId = normalizeOpenLibraryWorkId(authorWork.key);
    const node = mapOpenLibraryAuthorWork(
      authorWork,
      mediaByOpenLibraryId.get(bookId),
      author?.name,
      authorId
    );

    return {
      weight: scoreBookWork(node),
      type: 'shared-person' as const,
      reason: author?.name ? `Also by ${author.name}` : 'Same author',
      node,
    };
  });

  return finalize(
    { mediaType: 'book', id: workId, title: work.title },
    edges,
    opts
  );
};

export const getAssociations = async (
  mediaType: AssociationMediaType,
  id: string,
  user: User | undefined,
  opts: AssociationOptions = {}
): Promise<AssociationGraph> => {
  const cacheKey = `assoc:${user?.id ?? 'anon'}:${mediaType}:${id}:${
    opts.includeWeak ? 1 : 0
  }:${opts.limit ?? ASSOCIATION_LIMITS.DEFAULT_TOTAL}`;
  const cached = cache.data.get<AssociationGraph>(cacheKey);
  if (cached) {
    return cached;
  }

  let graph: AssociationGraph;
  switch (mediaType) {
    case 'movie':
    case 'tv':
      graph = await buildForScreen(mediaType, Number(id), user, opts);
      break;
    case 'artist':
      graph = await buildForArtist(id, user, opts);
      break;
    case 'album':
      graph = await buildForAlbum(id, user, opts);
      break;
    case 'book':
      graph = await buildForBook(id, user, opts);
      break;
    default:
      graph = {
        root: { mediaType, id, title: '' },
        edges: [],
      };
  }

  cache.data.set(cacheKey, graph);
  return graph;
};
