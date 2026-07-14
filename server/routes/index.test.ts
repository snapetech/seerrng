import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import { DiscoverSliderType } from '@server/constants/discover';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import router from './index';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use('/api/v1', router);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

async function login() {
  return loginAs('admin@seerr.dev');
}

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('Discover homepage synchronization API', () => {
  it('requires authentication for manifest and state endpoints', async () => {
    const [manifest, state] = await Promise.all([
      request(app).get('/api/v1/discover/home/manifest'),
      request(app)
        .post('/api/v1/discover/home/state')
        .send({ items: [{ mediaType: MediaType.MOVIE, id: 1 }] }),
    ]);

    assert.strictEqual(manifest.status, 403);
    assert.strictEqual(state.status, 403);
  });

  it('returns stable descriptor revisions and conditionally revalidates the manifest', async () => {
    const slider = await getRepository(DiscoverSlider).save(
      new DiscoverSlider({
        type: DiscoverSliderType.TRENDING,
        order: 0,
        enabled: true,
        isBuiltIn: true,
      })
    );
    const agent = await login();
    const first = await agent.get('/api/v1/discover/home/manifest');
    const second = await agent.get('/api/v1/discover/home/manifest');
    const unchanged = await agent
      .get('/api/v1/discover/home/manifest')
      .set('If-None-Match', first.headers.etag);
    slider.title = 'Changed descriptor';
    await getRepository(DiscoverSlider).save(slider);
    const changed = await agent.get('/api/v1/discover/home/manifest');

    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.layoutRevision, second.body.layoutRevision);
    assert.strictEqual(
      first.body.userStateRevision,
      second.body.userStateRevision
    );
    assert.strictEqual(
      first.body.rows[0].descriptorRevision,
      second.body.rows[0].descriptorRevision
    );
    assert.strictEqual(first.body.rows[0].revision, undefined);
    assert.strictEqual(first.body.freshness.rowMaxAgeSeconds, 300);
    assert.match(first.headers['cache-control'], /private/);
    assert.strictEqual(unchanged.status, 304);
    assert.notStrictEqual(
      first.body.layoutRevision,
      changed.body.layoutRevision
    );
    assert.notStrictEqual(
      first.body.rows[0].descriptorRevision,
      changed.body.rows[0].descriptorRevision
    );
  });

  it('rejects malformed and oversized personalized state item lists', async () => {
    const agent = await login();
    const malformed = await agent
      .post('/api/v1/discover/home/state')
      .send({ items: [{ mediaType: MediaType.MOVIE, id: '1' }] });
    const oversized = await agent.post('/api/v1/discover/home/state').send({
      items: Array.from({ length: 101 }, (_, index) => ({
        mediaType: MediaType.MOVIE,
        id: index + 1,
      })),
    });

    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(oversized.status, 400);
  });

  it('isolates request and watchlist overlays by authenticated user', async () => {
    const [admin, friend] = await Promise.all([
      getRepository(User).findOneOrFail({
        where: { email: 'admin@seerr.dev' },
      }),
      getRepository(User).findOneOrFail({
        where: { email: 'friend@seerr.dev' },
      }),
    ]);
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 4242,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        media,
        requestedBy: admin,
        status: MediaRequestStatus.APPROVED,
        type: MediaType.MOVIE,
        is4k: false,
      })
    );
    await getRepository(Watchlist).save(
      new Watchlist({
        media,
        requestedBy: admin,
        mediaType: MediaType.MOVIE,
        tmdbId: 4242,
        title: 'Private Movie',
        ratingKey: '4242',
      })
    );

    const [adminAgent, friendAgent] = await Promise.all([
      loginAs(admin.email),
      loginAs(friend.email),
    ]);
    const body = { items: [{ mediaType: MediaType.MOVIE, id: 4242 }] };
    const [adminState, friendState] = await Promise.all([
      adminAgent.post('/api/v1/discover/home/state').send(body),
      friendAgent.post('/api/v1/discover/home/state').send(body),
    ]);

    assert.strictEqual(adminState.status, 200);
    assert.strictEqual(
      adminState.body.items[0].request.status,
      MediaRequestStatus.APPROVED
    );
    assert.strictEqual(adminState.body.items[0].watchlisted, true);
    assert.strictEqual(friendState.status, 200);
    assert.strictEqual(
      friendState.body.items[0].media.status,
      MediaStatus.PROCESSING
    );
    assert.strictEqual(friendState.body.items[0].request, null);
    assert.strictEqual(friendState.body.items[0].watchlisted, false);
    assert.notStrictEqual(adminState.body.revision, friendState.body.revision);

    const [adminManifest, friendManifest] = await Promise.all([
      adminAgent.get('/api/v1/discover/home/manifest'),
      friendAgent.get('/api/v1/discover/home/manifest'),
    ]);
    assert.notStrictEqual(
      adminManifest.body.userStateRevision,
      friendManifest.body.userStateRevision
    );
  });
});

describe('Top-level API route validation', () => {
  it('allows unauthenticated login backdrop requests', async () => {
    const res = await request(app).get('/api/v1/backdrops');

    assert.notStrictEqual(res.status, 403);
  });

  it('rejects malformed keyword detail IDs before provider lookup', async () => {
    const agent = await login();
    const res = await agent.get('/api/v1/keyword/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('rejects missing Pushover sound tokens before provider lookup', async () => {
    const agent = await login();
    const res = await agent.get(
      '/api/v1/settings/notifications/pushover/sounds'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Pushover application token/);
  });

  it('rejects oversized watch provider regions before provider lookup', async () => {
    const agent = await login();
    const res = await agent
      .get('/api/v1/watchproviders/movies')
      .query({ watchRegion: 'x'.repeat(17) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Watch region/);
  });
});
