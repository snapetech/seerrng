import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import RecordingRequest from '@server/entity/RecordingRequest';
import SportsFollow from '@server/entity/SportsFollow';
import { User } from '@server/entity/User';
import { guideIndex } from '@server/lib/liveTv/guideIndex';
import { syncRecordings } from '@server/lib/liveTv/recordings';
import { syncSportsFollows } from '@server/lib/liveTv/sports';
import { getSettings, type TunerrSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import request from 'supertest';
import liveTvRoutes from './liveTv';

const xmltvTime = (date: Date) =>
  `${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;

interface FakeTunerr {
  server: Server;
  port: number;
  rules: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  features: string[];
  history: Record<string, unknown>[];
  authHeaders: (string | undefined)[];
  sports: Record<string, unknown>;
}

const startFakeTunerr = async (start: Date): Promise<FakeTunerr> => {
  const stop = new Date(start.getTime() + 3600_000);
  const guide = `<tv>
    <channel id="101"><display-name>News One</display-name></channel>
    <programme start="${xmltvTime(start)}" stop="${xmltvTime(stop)}" channel="101">
      <title>Evening News</title>
    </programme>
  </tv>`;
  const fake: FakeTunerr = {
    server: createServer(),
    port: 0,
    rules: [],
    posts: [],
    features: ['title_equals', 'start_window', 'rules_only_recorder'],
    history: [],
    authHeaders: [],
    sports: { events: [] },
  };
  fake.server.on('request', (req, res) => {
    if (req.url === '/guide.xml') {
      res.setHeader('Content-Type', 'application/xml');
      res.end(guide);
      return;
    }
    fake.authHeaders.push(req.headers.authorization);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/recordings/rules.json' && req.method === 'GET') {
      res.end(JSON.stringify({ rules: fake.rules, features: fake.features }));
      return;
    }
    if (req.url === '/api/recordings/rules.json' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const payload = JSON.parse(body);
        fake.posts.push(payload);
        if (payload.action === 'upsert') {
          fake.rules = [
            ...fake.rules.filter((rule) => rule.id !== payload.rule.id),
            payload.rule,
          ];
        } else if (payload.action === 'delete') {
          fake.rules = fake.rules.filter((rule) => rule.id !== payload.rule_id);
        }
        res.end(JSON.stringify({ rules: fake.rules }));
      });
      return;
    }
    if (req.url === '/api/v1/sports/events') {
      res.end(JSON.stringify(fake.sports));
      return;
    }
    if (req.url === '/api/recordings/history.json') {
      res.end(JSON.stringify({ matches: fake.history }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  fake.server.listen(0, '127.0.0.1');
  await once(fake.server, 'listening');
  fake.port = (fake.server.address() as AddressInfo).port;
  return fake;
};

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const id = Number(req.header('x-test-user'));
    req.user =
      (await getRepository(User).findOne({ where: { id } })) ?? undefined;
    next();
  });
  app.use('/live-tv', liveTvRoutes);
  return app;
};

describe('Live TV recording requests', () => {
  let fake: FakeTunerr;
  let previous: TunerrSettings;
  let airingStart: Date;
  let admin: User;
  let friend: User;
  const app = createApp();

  setupTestDb();

  before(async () => {
    previous = getSettings().tunerr;
    airingStart = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 3600_000);
    fake = await startFakeTunerr(airingStart);
  });

  beforeEach(async () => {
    fake.rules = [];
    fake.posts = [];
    fake.history = [];
    fake.authHeaders = [];
    fake.features = ['title_equals', 'start_window', 'rules_only_recorder'];
    getSettings().tunerr = {
      enabled: true,
      hostname: '127.0.0.1',
      useSsl: false,
      baseUrl: '',
      deckPort: fake.port,
      tunerPort: fake.port,
      guideUrl: '',
      username: 'deck',
      password: 'deck-secret',
      guideHours: 24,
    };
    guideIndex.clear();
    await guideIndex.refresh();
    admin = (await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    })) as User;
    friend = (await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    })) as User;
  });

  after(() => {
    getSettings().tunerr = previous;
    guideIndex.clear();
    fake.server.close();
  });

  const as = (user: User) => ({
    get: (path: string) =>
      request(app).get(path).set('x-test-user', String(user.id)),
    post: (path: string, body?: object) =>
      request(app)
        .post(path)
        .set('x-test-user', String(user.id))
        .send(body ?? {}),
    delete: (path: string) =>
      request(app).delete(path).set('x-test-user', String(user.id)),
  });

  it('finds airings, then schedules, tracks, and cancels a recording', async () => {
    const airings = await as(friend).get(
      '/live-tv/airings?title=evening%20news'
    );
    assert.equal(airings.status, 200);
    assert.equal(airings.body.airings.length, 1);
    assert.equal(airings.body.airings[0].channelName, 'News One');

    const created = await as(friend).post('/live-tv/recordings', {
      kind: 'airing',
      title: 'Evening News',
      channel: '101',
      start: airingStart.toISOString(),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'pending');
    assert.equal(fake.posts.length, 0, 'not scheduled before approval');

    const duplicate = await as(friend).post('/live-tv/recordings', {
      kind: 'airing',
      title: 'Evening News',
      channel: '101',
      start: airingStart.toISOString(),
    });
    assert.equal(duplicate.status, 409);

    const forbidden = await as(friend).post(
      `/live-tv/recordings/${created.body.id}/approve`
    );
    assert.equal(forbidden.status, 403);

    const approved = await as(admin).post(
      `/live-tv/recordings/${created.body.id}/approve`
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'scheduled');
    const [upsert] = fake.posts;
    assert.equal(upsert.action, 'upsert');
    assert.deepEqual((upsert.rule as Record<string, unknown>).title_equals, [
      'Evening News',
    ]);
    assert.deepEqual(
      (upsert.rule as Record<string, unknown>).include_guide_numbers,
      ['101']
    );
    assert.ok(
      fake.authHeaders.every(
        (header) =>
          header ===
          `Basic ${Buffer.from('deck:deck-secret').toString('base64')}`
      )
    );

    fake.history = [
      {
        rule_id: `seerrng-${created.body.id}`,
        active_count: 1,
        completed_count: 0,
        failed_count: 0,
      },
    ];
    await syncRecordings();
    const recording = await getRepository(RecordingRequest).findOneByOrFail({
      id: created.body.id,
    });
    assert.equal(recording.status, 'recording');

    const cancelled = await as(friend).delete(
      `/live-tv/recordings/${created.body.id}`
    );
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(fake.rules.length, 0);

    const list = await as(friend).get('/live-tv/recordings');
    assert.equal(list.body.results.length, 1);
    assert.equal(list.body.results[0].status, 'cancelled');
  });

  it('auto-approves for managers and re-creates rules removed in Tunerr', async () => {
    const created = await as(admin).post('/live-tv/recordings', {
      kind: 'series',
      title: 'evening news',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'scheduled');
    assert.equal(created.body.title, 'Evening News');

    fake.rules = [];
    await syncRecordings();
    assert.equal(fake.rules.length, 1);
  });

  it('refuses to schedule against a Tunerr without rule recording support', async () => {
    fake.features = [];
    const created = await as(admin).post('/live-tv/recordings', {
      kind: 'series',
      title: 'Evening News',
    });
    assert.equal(created.status, 503);
    assert.match(created.body.message, /Update Tunerr/);
    assert.equal(fake.posts.length, 0);
  });

  it('rejects airings that are not in the guide', async () => {
    const response = await as(friend).post('/live-tv/recordings', {
      kind: 'airing',
      title: 'Evening News',
      channel: '999',
      start: airingStart.toISOString(),
    });
    assert.equal(response.status, 404);
  });

  it('records followed teams through matched guide airings', async () => {
    fake.sports = {
      enabled: true,
      events: [
        {
          event: {
            id: 'nfl-1',
            dataset: 'nfl',
            home_team: 'Denver Broncos',
            away_team: 'Kansas City Chiefs',
            // Schedule time differs slightly from the guide airing.
            starts_at: new Date(
              airingStart.getTime() + 10 * 60_000
            ).toISOString(),
          },
          matched: true,
          channels: [
            { source_guide_number: '101', source_programme: 'Evening News' },
          ],
        },
      ],
    };

    const teams = await as(friend).get('/live-tv/sports/teams');
    assert.equal(teams.status, 200);
    assert.deepEqual(
      teams.body.teams.map((team: { team: string }) => team.team),
      ['Denver Broncos', 'Kansas City Chiefs']
    );

    const followed = await as(friend).post('/live-tv/sports/follows', {
      dataset: 'NFL',
      team: 'Denver Broncos',
    });
    assert.equal(followed.status, 201);
    assert.equal(followed.body.dataset, 'nfl');

    await syncSportsFollows();
    const [recording] = await getRepository(RecordingRequest).find({
      where: { requestedById: friend.id },
    });
    assert.equal(recording.kind, 'airing');
    assert.equal(recording.channelId, '101');
    assert.equal(recording.status, 'pending');
    assert.equal(
      new Date(recording.startsAt as Date).toISOString(),
      airingStart.toISOString()
    );

    // A cancelled game is not requested again.
    recording.status = 'cancelled';
    await getRepository(RecordingRequest).save(recording);
    await syncSportsFollows();
    assert.equal(
      await getRepository(RecordingRequest).count({
        where: { requestedById: friend.id },
      }),
      1
    );

    const unfollow = await as(friend).delete(
      `/live-tv/sports/follows/${followed.body.id}`
    );
    assert.equal(unfollow.status, 204);
    assert.equal(await getRepository(SportsFollow).count(), 0);
  });
});
