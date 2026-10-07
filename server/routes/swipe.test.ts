import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import SwipeDecision from '@server/entity/SwipeDecision';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings, type SwipeSettings } from '@server/lib/settings';
import { setSwipeCatalogClients } from '@server/lib/swipe/candidates';
import { clearSwipeDecks } from '@server/lib/swipe/deck';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import request from 'supertest';
import swipeRoutes from './swipe';

const movie = (id: number, title: string) => ({
  id,
  media_type: 'movie',
  title,
  original_title: title,
  release_date: '2020-01-01',
  poster_path: `/poster-${id}.jpg`,
  overview: `${title} overview`,
  vote_average: 7.5,
  vote_count: 100,
  popularity: 10,
  genre_ids: [18],
  adult: false,
  video: false,
  original_language: 'en',
});

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const id = Number(req.header('x-test-user'));
    req.user =
      (await getRepository(User).findOne({ where: { id } })) ?? undefined;
    next();
  });
  app.use('/swipe', swipeRoutes);
  return app;
};

describe('Swipe routes', () => {
  const app = createApp();
  let previous: SwipeSettings;
  let friend: User;

  setupTestDb();

  beforeEach(async () => {
    previous = getSettings().swipe;
    getSettings().swipe = { ...previous, enabled: true, aiProvider: 'none' };
    clearSwipeDecks();
    friend = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    const trending = {
      page: 1,
      total_pages: 1,
      total_results: 4,
      results: [
        movie(101, 'Arrival'),
        movie(102, 'Already Here'),
        movie(103, 'Heat'),
        { ...movie(104, 'No Poster'), poster_path: undefined },
      ],
    };
    setSwipeCatalogClients({
      tmdb: () =>
        ({
          getMovieTrending: async () => trending,
          getMovieRecommendations: async () => ({
            page: 1,
            total_pages: 1,
            total_results: 1,
            results: [movie(201, 'Sicario')],
          }),
          getMovie: async () => ({ title: 'Arrival' }),
        }) as unknown as TheMovieDb,
    });
    await getRepository(Media).save(
      new Media({
        tmdbId: 102,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.AVAILABLE,
      })
    );
  });

  afterEach(() => {
    getSettings().swipe = previous;
    setSwipeCatalogClients();
  });

  const as = (user: User) => ({
    get: (path: string) =>
      request(app).get(path).set('x-test-user', String(user.id)),
    post: (path: string, body?: object) =>
      request(app)
        .post(path)
        .set('x-test-user', String(user.id))
        .send(body ?? {}),
    put: (path: string, body?: object) =>
      request(app)
        .put(path)
        .set('x-test-user', String(user.id))
        .send(body ?? {}),
  });

  it('builds a deck that skips owned titles and cards without art', async () => {
    const deck = await as(friend).get('/swipe/deck?mediaType=movie');
    assert.equal(deck.status, 200);
    assert.deepEqual(
      deck.body.cards.map((item: { id: string }) => item.id),
      ['101', '103']
    );
    assert.equal(deck.body.cards[0].because, 'Trending this week');
    assert.equal(
      deck.body.cards[0].imageUrl,
      'https://image.tmdb.org/t/p/w500/poster-101.jpg'
    );
    assert.equal('score' in deck.body.cards[0], false);
  });

  it('records swipes, never shows them again, and undoes a pass', async () => {
    await as(friend).get('/swipe/deck?mediaType=movie');
    const passed = await as(friend).post('/swipe/decisions', {
      mediaType: 'movie',
      id: '103',
      decision: 'pass',
    });
    assert.equal(passed.status, 200);

    const liked = await as(friend).post('/swipe/decisions', {
      mediaType: 'movie',
      id: '101',
      decision: 'seen',
    });
    assert.equal(liked.status, 200);

    const undone = await as(friend).post('/swipe/undo', { mediaType: 'movie' });
    assert.equal(undone.status, 200);
    assert.equal(undone.body.card.id, '101');
    assert.equal(undone.body.card.title, 'Arrival');
    assert.ok(undone.body.card.imageUrl, 'undo restores the whole card');

    // A rebuilt deck is seeded from what the user liked and skips passes.
    await as(friend).post('/swipe/decisions', {
      mediaType: 'movie',
      id: '101',
      decision: 'want',
    });
    const rebuilt = await as(friend).get(
      '/swipe/deck?mediaType=movie&refresh=true'
    );
    const ids = rebuilt.body.cards.map((item: { id: string }) => item.id);
    assert.ok(ids.includes('201'), 'recommendations from the liked title');
    assert.ok(!ids.includes('103'), 'passed title stays hidden');
    assert.ok(!ids.includes('101'), 'requested title stays hidden');
    assert.equal(
      rebuilt.body.cards.find((item: { id: string }) => item.id === '201')
        .because,
      'Because you liked Arrival'
    );

    const blocked = await as(friend).post('/swipe/undo', {
      mediaType: 'movie',
    });
    assert.equal(blocked.status, 409, 'a right swipe is not undone here');
    assert.equal(await getRepository(SwipeDecision).count(), 2);
  });

  it('rejects cards that are not in the deck', async () => {
    const response = await as(friend).post('/swipe/decisions', {
      mediaType: 'movie',
      id: '999',
      decision: 'want',
    });
    assert.equal(response.status, 404);
  });

  it('saves preferences and validates them', async () => {
    const saved = await as(friend).put('/swipe/profile', {
      tasteNotes: 'Slow-burn sci-fi',
      seriesRequest: 'all-seasons',
      bookFormat: 'ebook',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.seriesRequest, 'all-seasons');
    const read = await as(friend).get('/swipe/profile');
    assert.equal(read.body.tasteNotes, 'Slow-burn sci-fi');
    const invalid = await as(friend).put('/swipe/profile', {
      tasteNotes: 'x'.repeat(1001),
    });
    assert.equal(invalid.status, 400);
  });

  it('offers owned seed options and accepts only selected library or request items', async () => {
    await as(friend).get('/swipe/deck?mediaType=movie');
    const liked = await as(friend).post('/swipe/decisions', {
      mediaType: 'movie',
      id: '101',
      decision: 'seen',
    });
    assert.equal(liked.status, 200);

    const options = await as(friend).get('/swipe/favorites?mediaType=movie');
    assert.equal(options.status, 200);
    assert.ok(options.body.some((item: { id: string }) => item.id === '101'));

    const saved = await as(friend).put('/swipe/profile', {
      seedScope: 'favorites',
      favoriteSeeds: [
        { mediaType: 'movie', id: '101', title: 'Spoofed title' },
      ],
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.favoriteSeeds[0].title, 'Arrival');

    const forged = await as(friend).put('/swipe/profile', {
      favoriteSeeds: [{ mediaType: 'movie', id: '999999', title: 'Not yours' }],
    });
    assert.equal(forged.status, 400);
  });

  it('is unavailable when turned off or without request permission', async () => {
    getSettings().swipe = { ...getSettings().swipe, enabled: false };
    assert.equal((await as(friend).get('/swipe/status')).status, 404);
    getSettings().swipe = { ...getSettings().swipe, enabled: true };
    await getRepository(User).update(friend.id, {
      permissions: Permission.NONE,
    });
    const viewer = await getRepository(User).findOneByOrFail({
      id: friend.id,
    });
    assert.equal((await as(viewer).get('/swipe/status')).status, 403);
  });
});
