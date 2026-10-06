import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import MusicBrainz from '@server/api/musicbrainz';
import { getRepository } from '@server/datasource';
import TrackRequest from '@server/entity/TrackRequest';
import { User } from '@server/entity/User';
import { getSettings, type SlskdnSettings } from '@server/lib/settings';
import { toSongIdView } from '@server/lib/soulseek/libraryHealth';
import {
  nextTrackStatus,
  syncTrackRequests,
  trackSearchText,
} from '@server/lib/soulseek/trackRequests';
import { parseSlskdnSettings } from '@server/routes/settings/slskdn';
import { setupTestDb } from '@server/test/db';
import express from 'express';
import request from 'supertest';
import soulseekRoutes, { parseTrackInputs } from './soulseek';

const RELEASE_GROUP = '11111111-1111-4111-8111-111111111111';
const RELEASE = '22222222-2222-4222-8222-222222222222';

interface FakeSlskdn {
  server: Server;
  port: number;
  wishlist: Map<string, Record<string, unknown>>;
  deleted: string[];
  remediated: string[][];
  apiKeys: (string | undefined)[];
}

const startFake = async (): Promise<FakeSlskdn> => {
  const fake: FakeSlskdn = {
    server: createServer(),
    port: 0,
    wishlist: new Map(),
    deleted: [],
    remediated: [],
    apiKeys: [],
  };
  let nextId = 1;
  fake.server.on('request', (req, res) => {
    fake.apiKeys.push(req.headers['x-api-key'] as string | undefined);
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/v0/wishlist' && req.method === 'POST') {
        const id = `00000000-0000-4000-8000-00000000000${nextId++}`;
        const item = { id, ...JSON.parse(body), totalDownloadCount: 0 };
        fake.wishlist.set(id, item);
        res.statusCode = 201;
        res.end(JSON.stringify(item));
        return;
      }
      const wishlistMatch = /^\/api\/v0\/wishlist\/(.+)$/.exec(url.pathname);
      if (wishlistMatch) {
        const item = fake.wishlist.get(wishlistMatch[1]);
        if (req.method === 'DELETE') {
          fake.deleted.push(wishlistMatch[1]);
          fake.wishlist.delete(wishlistMatch[1]);
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = item ? 200 : 404;
        res.end(JSON.stringify(item ?? {}));
        return;
      }
      if (url.pathname === '/api/v0/library/health/issues') {
        const release = url.searchParams.get('musicBrainzReleaseId');
        res.end(
          JSON.stringify({
            issues:
              release === RELEASE
                ? [
                    {
                      issueId: 'fixable',
                      type: 'SuspectedTranscode',
                      severity: 'High',
                      status: 'Detected',
                      title: 'Track 1',
                      canAutoFix: true,
                    },
                    {
                      issueId: 'manual',
                      type: 'MissingMetadata',
                      severity: 'Low',
                      status: 'Detected',
                      canAutoFix: false,
                    },
                  ]
                : [],
          })
        );
        return;
      }
      if (url.pathname === '/api/slskdn/library/remediate') {
        fake.remediated.push(JSON.parse(body).issue_ids);
        res.end(JSON.stringify({ job_id: 'job-1' }));
        return;
      }
      if (url.pathname === '/api/v0/songid/runs' && req.method === 'POST') {
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            id: 'run-1',
            status: 'queued',
            albums: [],
            tracks: [],
          })
        );
        return;
      }
      if (url.pathname === '/api/v0/songid/runs/run-1') {
        res.end(
          JSON.stringify({
            id: 'run-1',
            status: 'completed',
            albums: [
              {
                releaseId: RELEASE,
                title: 'Album',
                artist: 'Band',
                isExact: true,
              },
            ],
            tracks: [],
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
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
  app.use('/soulseek', soulseekRoutes);
  return app;
};

describe('Soulseek routes', () => {
  let fake: FakeSlskdn;
  let previous: SlskdnSettings;
  let admin: User;
  let friend: User;
  const app = createApp();

  setupTestDb();

  before(async () => {
    previous = getSettings().slskdn;
    fake = await startFake();
  });

  beforeEach(async () => {
    fake.wishlist.clear();
    fake.deleted = [];
    fake.remediated = [];
    fake.apiKeys = [];
    getSettings().slskdn = {
      enabled: true,
      hostname: '127.0.0.1',
      port: fake.port,
      useSsl: false,
      baseUrl: '',
      apiKey: 'key-1',
      searchFilter: 'flac',
    };
    admin = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    friend = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    mock.method(MusicBrainz.prototype, 'getReleaseGroupDetails', async () => ({
      releases: [{ id: RELEASE }],
    }));
    mock.method(
      MusicBrainz.prototype,
      'getReleaseGroup',
      async () => RELEASE_GROUP
    );
  });

  after(() => {
    getSettings().slskdn = previous;
    mock.restoreAll();
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

  it('queues a track for approval, then searches and completes it', async () => {
    const created = await as(friend).post('/soulseek/track-requests', {
      tracks: [{ artist: 'Band', title: 'B-Side!', source: 'playlist' }],
    });
    assert.equal(created.status, 201);
    const [track] = created.body.results;
    assert.equal(track.status, 'pending');
    assert.equal(fake.wishlist.size, 0);

    const repeat = await as(friend).post('/soulseek/track-requests', {
      tracks: [{ artist: 'Band', title: 'B-Side!' }],
    });
    assert.equal(repeat.body.results[0].id, track.id, 'duplicates are reused');

    const approved = await as(admin).post(
      `/soulseek/track-requests/${track.id}/approve`
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'searching');
    const [item] = fake.wishlist.values();
    assert.equal(item.searchText, 'Band B Side');
    assert.equal(item.filter, 'flac');
    assert.equal(item.autoDownload, true);
    assert.equal(item.maxDownloads, 1);
    assert.ok(fake.apiKeys.every((key) => key === 'key-1'));

    item.totalDownloadCount = 1;
    await syncTrackRequests();
    const stored = await getRepository(TrackRequest).findOneByOrFail({
      id: track.id,
    });
    assert.equal(stored.status, 'completed');
  });

  it('starts manager requests immediately and cancels them in slskdN', async () => {
    const created = await as(admin).post('/soulseek/track-requests', {
      tracks: [{ artist: 'Band', title: 'Single' }],
    });
    const [track] = created.body.results;
    assert.equal(track.status, 'searching');

    const forbidden = await as(friend).delete(
      `/soulseek/track-requests/${track.id}`
    );
    assert.equal(forbidden.status, 403);

    const cancelled = await as(admin).delete(
      `/soulseek/track-requests/${track.id}`
    );
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(fake.deleted.length, 1);
  });

  it('lists album issues and only remediates fixable ones for that album', async () => {
    const denied = await as(friend).get(
      `/soulseek/albums/${RELEASE_GROUP}/issues`
    );
    assert.equal(denied.status, 403);

    const issues = await as(admin).get(
      `/soulseek/albums/${RELEASE_GROUP}/issues`
    );
    assert.equal(issues.status, 200);
    assert.deepEqual(
      issues.body.issues.map((issue: { issueId: string }) => issue.issueId),
      ['fixable', 'manual']
    );

    const fixed = await as(admin).post(
      `/soulseek/albums/${RELEASE_GROUP}/remediate`,
      { issueIds: ['fixable', 'manual', 'other-album'] }
    );
    assert.equal(fixed.status, 202);
    assert.deepEqual(fake.remediated, [['fixable']]);

    const nothing = await as(admin).post(
      `/soulseek/albums/${RELEASE_GROUP}/remediate`,
      { issueIds: ['manual'] }
    );
    assert.equal(nothing.status, 409);
  });

  it('lets only the requester read a SongID run', async () => {
    const started = await as(friend).post('/soulseek/songid', {
      source: 'https://example.com/clip',
    });
    assert.equal(started.status, 202);
    const other = await getRepository(User).findOneByOrFail({
      email: 'demo@seerr.dev',
    });
    assert.equal((await as(other).get('/soulseek/songid/run-1')).status, 404);

    const result = await as(friend).get('/soulseek/songid/run-1');
    assert.equal(result.status, 200);
    assert.equal(result.body.albums[0].releaseGroupId, RELEASE_GROUP);
  });
});

describe('Soulseek helpers', () => {
  it('builds Soulseek-safe search text', () => {
    assert.equal(trackSearchText('AC/DC', 'T.N.T.'), 'AC DC T N T');
    assert.equal(
      trackSearchText('Björk', "It's Oh So Quiet"),
      "Björk It's Oh So Quiet"
    );
  });

  it('decides track status from the wishlist item', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    const request = {
      status: 'searching' as const,
      createdAt: new Date('2026-10-05T00:00:00Z'),
    };
    assert.equal(
      nextTrackStatus(request, { totalDownloadCount: 1 }, now).status,
      'completed'
    );
    assert.equal(
      nextTrackStatus(request, { totalDownloadCount: 0 }, now).status,
      'searching'
    );
    assert.equal(nextTrackStatus(request, undefined, now).status, 'failed');
    const stale = nextTrackStatus(
      { status: 'searching', createdAt: new Date('2026-09-01T00:00:00Z') },
      { totalDownloadCount: 0 },
      now
    );
    assert.equal(stale.status, 'failed');
    assert.equal(stale.removeWishlistItem, true);
  });

  it('validates track input', () => {
    assert.ok('error' in parseTrackInputs({ tracks: [] }));
    assert.ok('error' in parseTrackInputs({ tracks: [{ artist: 'A' }] }));
    const parsed = parseTrackInputs({
      tracks: [
        {
          artist: ' A ',
          title: 'B',
          recordingMbid: 'not-an-id',
          source: 'evil',
        },
      ],
    });
    assert.ok(Array.isArray(parsed));
    assert.deepEqual(parsed[0], {
      artist: 'A',
      title: 'B',
      recordingMbid: undefined,
      source: 'manual',
    });
  });

  it('requires a hostname and API key before enabling slskdN', () => {
    const current = {
      enabled: false,
      hostname: '',
      port: 5030,
      useSsl: false,
      baseUrl: '',
      apiKey: '',
      searchFilter: '',
    };
    assert.ok('error' in parseSlskdnSettings({ enabled: true }, current));
    const parsed = parseSlskdnSettings(
      { enabled: true, hostname: 'slskdn', apiKey: 'k' },
      current
    );
    assert.ok('value' in parsed);
  });

  it('keeps SongID albums without a resolvable release group', async () => {
    const view = await toSongIdView(
      {
        id: 'r',
        status: 'completed',
        albums: [{ releaseId: RELEASE, title: 'A', artist: 'B' }],
      },
      async () => {
        throw new Error('offline');
      }
    );
    assert.equal(view.albums[0].releaseGroupId, undefined);
  });
});
