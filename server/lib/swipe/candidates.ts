import OpenLibraryAPI, {
  type OpenLibrarySearchDoc,
} from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SwipeDecision, {
  type SwipeMediaType,
} from '@server/entity/SwipeDecision';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { In } from 'typeorm';

/** A card in a swipe deck. Every card is a real, requestable catalog item. */
export interface SwipeCard {
  mediaType: SwipeMediaType;
  /** TMDB ID (as a string) or Open Library work ID such as `OL45883W`. */
  id: string;
  title: string;
  subtitle?: string;
  year?: number;
  overview?: string;
  imageUrl?: string;
  rating?: number;
  /** Book subjects or TMDB genre IDs, kept as taste signals. */
  tags: string[];
  authorId?: string;
  /** Why this card is in the deck, e.g. "Because you liked Alien". */
  because?: string;
  /** AI explanation, when an AI provider ranked the deck. */
  reason?: string;
  score: number;
}

export interface TasteSignals {
  liked: { title: string; tags: string[] }[];
  passed: { title: string }[];
}

type CatalogClients = {
  tmdb: () => Pick<
    TheMovieDb,
    | 'getMovie'
    | 'getTvShow'
    | 'getMovieRecommendations'
    | 'getTvRecommendations'
    | 'getMovieTrending'
    | 'getTvTrending'
  >;
  openLibrary: () => Pick<OpenLibraryAPI, 'searchBooks'>;
};

const defaultClients: CatalogClients = {
  tmdb: () => new TheMovieDb(),
  openLibrary: () => new OpenLibraryAPI(),
};

let clients: CatalogClients = defaultClients;

/** Replaces the catalog clients. For tests; pass nothing to restore. */
export const setSwipeCatalogClients = (override?: Partial<CatalogClients>) => {
  clients = { ...defaultClients, ...override };
};

const MAX_SEEDS = 6;
const MAX_CANDIDATES = 60;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const yearOf = (date: string | undefined) => {
  const year = Number.parseInt((date ?? '').slice(0, 4), 10);
  return Number.isInteger(year) && year > 1800 ? year : undefined;
};

const truncate = (text: string | undefined, max: number) =>
  text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Merges candidate lists, rewarding items recommended by several seeds. */
export const mergeCandidates = (lists: SwipeCard[][]): SwipeCard[] => {
  const merged = new Map<string, SwipeCard>();
  for (const list of lists) {
    for (const card of list) {
      const existing = merged.get(card.id);
      if (existing) {
        existing.score += card.score;
      } else {
        merged.set(card.id, { ...card });
      }
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
};

const tmdbCard = (
  result: TmdbMovieResult | TmdbTvResult,
  mediaType: 'movie' | 'tv',
  because: string | undefined,
  rank: number
): SwipeCard | undefined => {
  const title =
    mediaType === 'movie'
      ? (result as TmdbMovieResult).title
      : (result as TmdbTvResult).name;
  if (!title || !result.id || !result.poster_path) {
    return undefined;
  }
  const year = yearOf(
    mediaType === 'movie'
      ? (result as TmdbMovieResult).release_date
      : (result as TmdbTvResult).first_air_date
  );
  return {
    mediaType,
    id: String(result.id),
    title,
    subtitle: year ? String(year) : undefined,
    year,
    overview: truncate(result.overview, 600),
    imageUrl: `${TMDB_IMAGE_BASE}${result.poster_path}`,
    rating:
      result.vote_count >= 20 && Number.isFinite(result.vote_average)
        ? Math.round(result.vote_average * 10) / 10
        : undefined,
    tags: (result.genre_ids ?? []).map(String),
    because,
    // Earlier recommendations count more; well-rated titles get a nudge.
    score: 10 / (rank + 1) + (result.vote_average ?? 0) / 10,
  };
};

const bookCard = (
  doc: OpenLibrarySearchDoc,
  because: string | undefined,
  rank: number
): SwipeCard | undefined => {
  const id = doc.key?.replace(/^\/works\//, '');
  if (!id || !/^OL\d+W$/.test(id) || !doc.title || !doc.cover_i) {
    return undefined;
  }
  return {
    mediaType: 'book',
    id,
    title: doc.title,
    subtitle: doc.author_name?.slice(0, 2).join(', '),
    year: doc.first_publish_year,
    imageUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
    rating:
      (doc.ratings_count ?? 0) >= 5 && doc.ratings_average
        ? Math.round(doc.ratings_average * 10) / 10
        : undefined,
    tags: (doc.subject ?? []).slice(0, 8),
    authorId: doc.author_key?.[0],
    because,
    score: 10 / (rank + 1) + Math.log10(1 + (doc.want_to_read_count ?? 0)),
  };
};

/** Items the user already decided on, requested, or already has. */
const excludedIds = async (
  userId: number,
  mediaType: SwipeMediaType,
  ids: string[]
): Promise<Set<string>> => {
  const excluded = new Set<string>();
  if (ids.length === 0) return excluded;
  const decisions = await getRepository(SwipeDecision).find({
    select: { itemId: true },
    where: { userId, mediaType, itemId: In(ids) },
  });
  decisions.forEach((decision) => excluded.add(decision.itemId));

  if (mediaType !== 'book') {
    const tmdbIds = ids.map(Number).filter(Number.isSafeInteger);
    const media = await getRepository(Media).find({
      select: { tmdbId: true, status: true },
      where: {
        tmdbId: In(tmdbIds),
        mediaType: mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
      },
    });
    media
      .filter(
        (item) =>
          item.status !== MediaStatus.UNKNOWN &&
          item.status !== MediaStatus.DELETED
      )
      .forEach((item) => excluded.add(String(item.tmdbId)));
  }
  return excluded;
};

/** The user's liked and passed items, newest first, for seeds and ranking. */
export const loadTasteSignals = async (
  userId: number,
  mediaType: SwipeMediaType
): Promise<TasteSignals> => {
  const decisions = await getRepository(SwipeDecision).find({
    where: { userId, mediaType },
    order: { createdAt: 'DESC' },
    take: 60,
  });
  return {
    liked: decisions
      .filter((d) => d.decision === 'want' || d.decision === 'seen')
      .slice(0, 25)
      .map((d) => ({
        title: d.title,
        tags: d.tags ? d.tags.split('|').filter(Boolean) : [],
      })),
    passed: decisions
      .filter((d) => d.decision === 'pass')
      .slice(0, 15)
      .map((d) => ({ title: d.title })),
  };
};

const tmdbSeeds = async (
  userId: number,
  mediaType: 'movie' | 'tv'
): Promise<{ id: number; title?: string }[]> => {
  const [decisions, requests] = await Promise.all([
    getRepository(SwipeDecision).find({
      where: { userId, mediaType, decision: In(['want', 'seen']) },
      order: { createdAt: 'DESC' },
      take: MAX_SEEDS,
    }),
    getRepository(MediaRequest).find({
      where: {
        requestedBy: { id: userId },
        type: mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
      },
      relations: { media: true },
      order: { createdAt: 'DESC' },
      take: MAX_SEEDS,
    }),
  ]);
  const seeds = new Map<number, string | undefined>();
  for (const decision of decisions) {
    const id = Number(decision.itemId);
    if (Number.isSafeInteger(id)) seeds.set(id, decision.title);
  }
  for (const request of requests) {
    const id = request.media?.tmdbId;
    if (id && !seeds.has(id) && seeds.size < MAX_SEEDS)
      seeds.set(id, undefined);
  }
  return [...seeds].slice(0, MAX_SEEDS).map(([id, title]) => ({ id, title }));
};

const buildTmdbCandidates = async (
  userId: number,
  mediaType: 'movie' | 'tv'
): Promise<SwipeCard[]> => {
  const tmdb = clients.tmdb();
  const seeds = await tmdbSeeds(userId, mediaType);
  const lists = await mapWithConcurrency(seeds, 3, async (seed) => {
    try {
      const title =
        seed.title ??
        (mediaType === 'movie'
          ? (await tmdb.getMovie({ movieId: seed.id })).title
          : (await tmdb.getTvShow({ tvId: seed.id })).name);
      const response =
        mediaType === 'movie'
          ? await tmdb.getMovieRecommendations({ movieId: seed.id })
          : await tmdb.getTvRecommendations({ tvId: seed.id });
      return (response.results as (TmdbMovieResult | TmdbTvResult)[])
        .map((result, rank) =>
          tmdbCard(
            result,
            mediaType,
            title ? `Because you liked ${title}` : undefined,
            rank
          )
        )
        .filter((card): card is SwipeCard => !!card);
    } catch {
      return [];
    }
  });

  // New users, or too few recommendations: fill from this week's trending.
  if (lists.flat().length < 20) {
    const trending =
      mediaType === 'movie'
        ? await tmdb.getMovieTrending({ timeWindow: 'week' })
        : await tmdb.getTvTrending({ timeWindow: 'week' });
    lists.push(
      (trending.results as (TmdbMovieResult | TmdbTvResult)[])
        .map((result, rank) =>
          tmdbCard(result, mediaType, 'Trending this week', rank + 5)
        )
        .filter((card): card is SwipeCard => !!card)
    );
  }
  return mergeCandidates(lists);
};

const buildBookCandidates = async (userId: number): Promise<SwipeCard[]> => {
  const openLibrary = clients.openLibrary();
  const signals = await loadTasteSignals(userId, 'book');
  const subjectCounts = new Map<string, number>();
  for (const liked of signals.liked) {
    for (const tag of liked.tags.slice(0, 5)) {
      subjectCounts.set(tag, (subjectCounts.get(tag) ?? 0) + 1);
    }
  }
  const subjects = [...subjectCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([subject]) => subject);

  const lists = await mapWithConcurrency(subjects, 2, async (subject) => {
    try {
      const response = await openLibrary.searchBooks({
        query: `subject:"${subject.replace(/"/g, '')}"`,
        limit: 30,
      });
      return response.docs
        .map((doc, rank) =>
          bookCard(doc, `Because you like ${subject.toLowerCase()}`, rank)
        )
        .filter((card): card is SwipeCard => !!card);
    } catch {
      return [];
    }
  });

  if (lists.flat().length < 20) {
    const trending = await openLibrary.searchBooks({
      query: 'trending_score_hourly_sum:[1 TO *]',
      sort: 'trending',
      limit: 50,
    });
    lists.push(
      trending.docs
        .map((doc, rank) => bookCard(doc, 'Trending now', rank + 5))
        .filter((card): card is SwipeCard => !!card)
    );
  }
  return mergeCandidates(lists);
};

/** Builds an unranked deck for the user, excluding anything already decided. */
export const buildCandidates = async (
  userId: number,
  mediaType: SwipeMediaType
): Promise<SwipeCard[]> => {
  const candidates =
    mediaType === 'book'
      ? await buildBookCandidates(userId)
      : await buildTmdbCandidates(userId, mediaType);
  const excluded = await excludedIds(
    userId,
    mediaType,
    candidates.map((card) => card.id)
  );
  return candidates
    .filter((card) => !excluded.has(card.id))
    .slice(0, MAX_CANDIDATES);
};
