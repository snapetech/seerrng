import { getRepository } from '@server/datasource';
import type {
  SwipeDecisionKind,
  SwipeMediaType,
} from '@server/entity/SwipeDecision';
import type {
  SwipeFavoriteSeed,
  SwipeSeedScope,
} from '@server/entity/SwipeProfile';
import SwipeProfile from '@server/entity/SwipeProfile';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  getSwipeFavoriteOptions,
  MAX_SWIPE_FAVORITE_SEEDS,
  type SwipeCard,
} from '@server/lib/swipe/candidates';
import {
  clearSwipeDecks,
  getSwipeDeck,
  getSwipeProfile,
  recordSwipeDecision,
  SwipeError,
  undoLastSwipe,
} from '@server/lib/swipe/deck';
import { isAiRankingConfigured } from '@server/lib/swipe/ranking';
import logger from '@server/logger';
import type { Response } from 'express';
import { Router } from 'express';

const MEDIA_TYPES: SwipeMediaType[] = ['movie', 'tv', 'book'];
const DECISIONS: SwipeDecisionKind[] = ['want', 'pass', 'seen'];
const DECK_PAGE = 20;

const parseMediaType = (value: unknown): SwipeMediaType | undefined =>
  MEDIA_TYPES.includes(value as SwipeMediaType)
    ? (value as SwipeMediaType)
    : undefined;

/** Browser view of a card; the internal score stays on the server. */
export const cardView = (card: SwipeCard) => ({
  mediaType: card.mediaType,
  id: card.id,
  title: card.title,
  subtitle: card.subtitle,
  year: card.year,
  overview: card.overview,
  imageUrl: card.imageUrl,
  rating: card.rating,
  authorId: card.authorId,
  because: card.because,
  reason: card.reason,
});

const sendError = (res: Response, error: unknown) => {
  if (error instanceof SwipeError) {
    return res.status(error.status).json({ message: error.message });
  }
  throw error;
};

const swipeRoutes = Router();

swipeRoutes.use((req, res, next) => {
  if (!getSettings().swipe.enabled) {
    return res.status(404).json({ message: 'Swipe is turned off.' });
  }
  if (!req.user?.hasPermission(Permission.REQUEST)) {
    return res
      .status(403)
      .json({ message: 'Swipe needs permission to make requests.' });
  }
  return next();
});

swipeRoutes.get('/status', (_req, res) => {
  return res.status(200).json({
    enabled: true,
    aiRanking: isAiRankingConfigured(getSettings().swipe),
  });
});

swipeRoutes.get('/deck', async (req, res) => {
  const mediaType = parseMediaType(req.query.mediaType);
  if (!mediaType) {
    return res
      .status(400)
      .json({ message: 'Choose movies, series, or books.' });
  }
  try {
    const deck = await getSwipeDeck(
      req.user!.id,
      mediaType,
      req.query.refresh === 'true'
    );
    return res.status(200).json({
      mediaType,
      ranked: deck.ranked,
      remaining: deck.cards.length,
      cards: deck.cards.slice(0, DECK_PAGE).map(cardView),
    });
  } catch (error) {
    logger.warn('Swipe deck could not be built', {
      label: 'Swipe',
      mediaType,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return res
      .status(502)
      .json({ message: 'Recommendations could not be loaded. Try again.' });
  }
});

swipeRoutes.post('/decisions', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const mediaType = parseMediaType(body.mediaType);
  const decision = DECISIONS.includes(body.decision as SwipeDecisionKind)
    ? (body.decision as SwipeDecisionKind)
    : undefined;
  const id =
    typeof body.id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(body.id)
      ? body.id
      : undefined;
  if (!mediaType || !decision || !id) {
    return res.status(400).json({ message: 'Invalid swipe.' });
  }
  try {
    const saved = await recordSwipeDecision(
      req.user!.id,
      mediaType,
      id,
      decision
    );
    return res.status(200).json({
      mediaType,
      id: saved.itemId,
      decision: saved.decision,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

swipeRoutes.post('/undo', async (req, res) => {
  const mediaType = parseMediaType(
    (req.body as Record<string, unknown> | undefined)?.mediaType
  );
  if (!mediaType) {
    return res
      .status(400)
      .json({ message: 'Choose movies, series, or books.' });
  }
  try {
    const card = await undoLastSwipe(req.user!.id, mediaType);
    if (!card) return res.status(404).json({ message: 'Nothing to undo.' });
    return res.status(200).json({ card: cardView(card) });
  } catch (error) {
    return sendError(res, error);
  }
});

const profileView = (profile: SwipeProfile) => ({
  tasteNotes: profile.tasteNotes,
  seriesRequest: profile.seriesRequest,
  bookFormat: profile.bookFormat,
  seedScope: profile.seedScope ?? 'full',
  favoriteSeeds: profile.favoriteSeeds ?? [],
});

swipeRoutes.get('/favorites', async (req, res) => {
  const mediaType = parseMediaType(req.query.mediaType);
  if (!mediaType) {
    return res
      .status(400)
      .json({ message: 'Choose movies, series, or books.' });
  }
  try {
    return res
      .status(200)
      .json(await getSwipeFavoriteOptions(req.user!.id, mediaType));
  } catch {
    return res
      .status(502)
      .json({ message: 'Your favorites could not be loaded.' });
  }
});

swipeRoutes.get('/profile', async (req, res) => {
  return res.status(200).json(profileView(await getSwipeProfile(req.user!.id)));
});

swipeRoutes.put('/profile', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const current = await getSwipeProfile(req.user!.id);
  const tasteNotes = body.tasteNotes ?? current.tasteNotes;
  const seriesRequest = body.seriesRequest ?? current.seriesRequest;
  const bookFormat = body.bookFormat ?? current.bookFormat;
  const seedScope = body.seedScope ?? current.seedScope ?? 'full';
  const favoriteSeeds = body.favoriteSeeds ?? current.favoriteSeeds ?? [];
  if (
    typeof tasteNotes !== 'string' ||
    tasteNotes.length > 1000 ||
    (seriesRequest !== 'first-season' && seriesRequest !== 'all-seasons') ||
    (bookFormat !== 'ebook' && bookFormat !== 'audiobook') ||
    !(['full', 'rated', 'favorites'] as unknown[]).includes(seedScope) ||
    !Array.isArray(favoriteSeeds) ||
    favoriteSeeds.length > MAX_SWIPE_FAVORITE_SEEDS
  ) {
    return res.status(400).json({ message: 'Invalid swipe preferences.' });
  }
  const normalizedFavorites: SwipeFavoriteSeed[] = [];
  const favoriteKeys = new Set<string>();
  for (const seed of favoriteSeeds) {
    if (
      !seed ||
      typeof seed !== 'object' ||
      Array.isArray(seed) ||
      !(['movie', 'tv', 'book'] as unknown[]).includes(seed.mediaType) ||
      typeof seed.id !== 'string' ||
      typeof seed.title !== 'string' ||
      seed.title.trim().length === 0 ||
      seed.title.length > 512 ||
      (seed.mediaType === 'book'
        ? !/^OL\d+W$/.test(seed.id)
        : !/^\d{1,10}$/.test(seed.id))
    ) {
      return res.status(400).json({ message: 'Choose valid favorite seeds.' });
    }
    const key = `${seed.mediaType}:${seed.id}`;
    if (favoriteKeys.has(key)) {
      return res.status(400).json({ message: 'Choose each favorite once.' });
    }
    favoriteKeys.add(key);
    normalizedFavorites.push({
      mediaType: seed.mediaType,
      id: seed.id,
      title: seed.title.trim(),
    });
  }
  const existingFavoriteKeys = new Set(
    (current.favoriteSeeds ?? []).map((seed) => `${seed.mediaType}:${seed.id}`)
  );
  const addedFavorites = normalizedFavorites.filter(
    (seed) => !existingFavoriteKeys.has(`${seed.mediaType}:${seed.id}`)
  );
  if (addedFavorites.length) {
    const mediaTypes = [
      ...new Set(addedFavorites.map((seed) => seed.mediaType)),
    ];
    let availableFavorites: SwipeFavoriteSeed[];
    try {
      availableFavorites = (
        await Promise.all(
          mediaTypes.map((mediaType) =>
            getSwipeFavoriteOptions(req.user!.id, mediaType)
          )
        )
      ).flat();
    } catch {
      return res
        .status(502)
        .json({ message: 'Your favorite seeds could not be verified.' });
    }
    const availableByKey = new Map(
      availableFavorites.map((seed) => [`${seed.mediaType}:${seed.id}`, seed])
    );
    for (const seed of addedFavorites) {
      const available = availableByKey.get(`${seed.mediaType}:${seed.id}`);
      if (!available) {
        return res
          .status(400)
          .json({ message: 'Choose favorites from your library or requests.' });
      }
      seed.title = available.title;
    }
  }
  const preferencesChanged =
    tasteNotes.trim() !== current.tasteNotes ||
    seedScope !== current.seedScope ||
    JSON.stringify(normalizedFavorites) !==
      JSON.stringify(current.favoriteSeeds ?? []);
  const saved = await getRepository(SwipeProfile).save(
    Object.assign(current, {
      tasteNotes: tasteNotes.trim(),
      seriesRequest,
      bookFormat,
      seedScope: seedScope as SwipeSeedScope,
      favoriteSeeds: normalizedFavorites,
      updatedAt: new Date(),
    })
  );
  if (preferencesChanged) clearSwipeDecks(req.user!.id);
  return res.status(200).json(profileView(saved));
});

export default swipeRoutes;
