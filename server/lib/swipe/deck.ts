import { getRepository } from '@server/datasource';
import SwipeDecision, {
  type SwipeDecisionKind,
  type SwipeMediaType,
} from '@server/entity/SwipeDecision';
import SwipeProfile from '@server/entity/SwipeProfile';
import { getSettings } from '@server/lib/settings';
import {
  buildCandidates,
  loadTasteSignals,
  type SwipeCard,
} from '@server/lib/swipe/candidates';
import { rankCandidates } from '@server/lib/swipe/ranking';

const DECK_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_DECKS = 500;

interface CachedDeck {
  cards: SwipeCard[];
  ranked: boolean;
  builtAt: number;
  /** Recently decided cards, newest last, so undo can restore them whole. */
  history: SwipeCard[];
}

const MAX_HISTORY = 20;

const decks = new Map<string, CachedDeck>();
const building = new Map<string, Promise<CachedDeck>>();

const deckKey = (userId: number, mediaType: SwipeMediaType) =>
  `${userId}:${mediaType}`;

export const clearSwipeDecks = (userId?: number) => {
  if (userId === undefined) {
    decks.clear();
    return;
  }
  for (const key of decks.keys()) {
    if (key.startsWith(`${userId}:`)) decks.delete(key);
  }
};

export const getSwipeProfile = async (userId: number) =>
  (await getRepository(SwipeProfile).findOne({ where: { userId } })) ??
  new SwipeProfile({
    userId,
    tasteNotes: '',
    seriesRequest: 'first-season',
    bookFormat: 'audiobook',
  });

const buildDeck = async (
  userId: number,
  mediaType: SwipeMediaType
): Promise<CachedDeck> => {
  const [candidates, signals, profile] = await Promise.all([
    buildCandidates(userId, mediaType),
    loadTasteSignals(userId, mediaType),
    getSwipeProfile(userId),
  ]);
  const { cards, ranked } = await rankCandidates(
    getSettings().swipe,
    mediaType,
    candidates,
    signals,
    profile.tasteNotes
  );
  const previous = decks.get(deckKey(userId, mediaType));
  const deck: CachedDeck = {
    cards,
    ranked,
    builtAt: Date.now(),
    history: previous?.history ?? [],
  };
  if (decks.size >= MAX_CACHED_DECKS) {
    const oldest = decks.keys().next().value;
    if (oldest) decks.delete(oldest);
  }
  decks.set(deckKey(userId, mediaType), deck);
  return deck;
};

/** The user's current deck, rebuilt when stale, empty, or on request. */
export const getSwipeDeck = async (
  userId: number,
  mediaType: SwipeMediaType,
  refresh = false
): Promise<CachedDeck> => {
  const key = deckKey(userId, mediaType);
  const cached = decks.get(key);
  if (
    !refresh &&
    cached &&
    cached.cards.length > 0 &&
    Date.now() - cached.builtAt < DECK_TTL_MS
  ) {
    return cached;
  }
  const pending = building.get(key);
  if (pending) return pending;
  const promise = buildDeck(userId, mediaType).finally(() =>
    building.delete(key)
  );
  building.set(key, promise);
  return promise;
};

export class SwipeError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409
  ) {
    super(message);
    this.name = 'SwipeError';
  }
}

/** Records a decision for a card from the user's deck. */
export const recordSwipeDecision = async (
  userId: number,
  mediaType: SwipeMediaType,
  itemId: string,
  decision: SwipeDecisionKind
): Promise<SwipeDecision> => {
  const key = deckKey(userId, mediaType);
  const deck = decks.get(key);
  const card = deck?.cards.find((item) => item.id === itemId);
  if (!card) {
    throw new SwipeError('That card is no longer in your deck.', 404);
  }
  const repository = getRepository(SwipeDecision);
  const existing = await repository.findOne({
    where: { userId, mediaType, itemId },
  });
  const saved = await repository.save(
    Object.assign(existing ?? new SwipeDecision(), {
      userId,
      mediaType,
      itemId,
      title: card.title.slice(0, 512),
      decision,
      tags: card.tags.join('|').slice(0, 1024) || null,
      createdAt: new Date(),
    })
  );
  if (deck) {
    deck.cards = deck.cards.filter((item) => item.id !== itemId);
    deck.history = [...deck.history, card].slice(-MAX_HISTORY);
  }
  return saved;
};

/**
 * Undoes the most recent pass or seen decision and puts the card back on top
 * of the deck. A request made by a right swipe is not undone here.
 */
export const undoLastSwipe = async (
  userId: number,
  mediaType: SwipeMediaType
): Promise<SwipeCard | undefined> => {
  const repository = getRepository(SwipeDecision);
  const [last] = await repository.find({
    where: { userId, mediaType },
    order: { createdAt: 'DESC', id: 'DESC' },
    take: 1,
  });
  if (!last) return undefined;
  if (last.decision === 'want') {
    throw new SwipeError(
      'A requested title cannot be undone here. Cancel the request from Requests instead.',
      409
    );
  }
  await repository.remove(last);
  const deck = decks.get(deckKey(userId, mediaType));
  const remembered = deck?.history.find((item) => item.id === last.itemId);
  const card: SwipeCard = remembered ?? {
    mediaType,
    id: last.itemId,
    title: last.title,
    tags: last.tags ? last.tags.split('|') : [],
    score: 0,
  };
  if (deck) {
    deck.history = deck.history.filter((item) => item.id !== card.id);
    deck.cards = [card, ...deck.cards.filter((item) => item.id !== card.id)];
  }
  return card;
};
