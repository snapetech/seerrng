import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import {
  IssueStatus,
  IssueType,
  MAX_ISSUE_COMMENTS,
} from '@server/constants/issue';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import { MediaSearchMetadata } from '@server/entity/MediaSearchMetadata';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import issueRoutes from './issue';
import issueCommentRoutes from './issueComment';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      cookie: { secure: 'auto' },
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(rateLimit({ windowMs: 60_000, limit: 10_000 }), checkUser);
  app.use('/auth', authRoutes);
  app.use('/issue', issueRoutes);
  app.use('/issueComment', issueCommentRoutes);
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
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

async function createIssue(
  email = 'admin@seerr.dev',
  tmdbId = 100,
  issueType = IssueType.VIDEO,
  status = IssueStatus.OPEN,
  mediaType = MediaType.MOVIE
) {
  const user = await getRepository(User).findOneByOrFail({
    email,
  });
  const media = await getRepository(Media).save(
    new Media({
      tmdbId,
      mediaType,
      status: MediaStatus.AVAILABLE,
      status4k: MediaStatus.UNKNOWN,
    })
  );

  return getRepository(Issue).save(
    new Issue({
      createdBy: user,
      issueType,
      status,
      media,
      comments: [
        new IssueComment({
          user,
          message: 'Playback fails.',
        }),
      ],
    })
  );
}

describe('Issue route validation', () => {
  it('rejects malformed issue list query filters', async () => {
    const agent = await login();
    const res = await agent
      .get('/issue')
      .query({ filter: ['open', 'resolved'] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Filter must be a string/);
  });

  it('rejects unknown issue list sort parameters', async () => {
    const agent = await login();
    const res = await agent.get('/issue').query({ sort: 'drop-table' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sort must be valid/);
  });

  it('rejects unknown issue media type filters', async () => {
    const agent = await login();
    const res = await agent.get('/issue').query({ mediaType: 'podcast' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media type must be valid/);
  });

  it('rejects unknown issue type filters', async () => {
    const agent = await login();
    const res = await agent.get('/issue').query({ issueType: 'quality' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Issue type must be valid/);
  });

  it('rejects malformed media-specific issue filters', async () => {
    const agent = await login();
    const res = await agent
      .get('/issue')
      .query({ mediaType: MediaType.MOVIE, releaseYear: 'next-year' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Release year must be a four-digit year/);
  });

  it('accepts sorting issues by added date', async () => {
    const agent = await login();
    const res = await agent.get('/issue').query({ sort: 'added' });

    assert.notEqual(res.status, 400);
  });

  it('searches issue media through the locally stored metadata snapshot', async () => {
    const issue = await createIssue('admin@seerr.dev', 108);
    await getRepository(MediaSearchMetadata).save({
      mediaId: issue.media.id,
      media: issue.media,
      title: 'Issue Metadata Movie',
      director: 'Hidden Search Director',
      genres: 'Science Fiction',
      searchText:
        'issue metadata movie hidden search director science fiction radarr-hd',
    });
    const agent = await login();

    const res = await agent
      .get('/issue')
      .query({ search: 'hidden search director' });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map(({ id }: { id: number }) => id),
      [issue.id]
    );
  });

  it('filters issues and task counts by media type', async () => {
    const issue = await createIssue(
      'admin@seerr.dev',
      109,
      IssueType.VIDEO,
      IssueStatus.OPEN,
      MediaType.TV
    );
    await getRepository(MediaSearchMetadata).save({
      mediaId: issue.media.id,
      media: issue.media,
      title: 'Issue Media Filter Marker',
      searchText: 'issue media filter marker',
    });
    const agent = await login();

    const [seriesResponse, movieResponse] = await Promise.all([
      agent.get('/issue').query({
        search: 'issue media filter marker',
        mediaType: MediaType.TV,
      }),
      agent.get('/issue').query({
        search: 'issue media filter marker',
        mediaType: MediaType.MOVIE,
      }),
    ]);

    assert.strictEqual(seriesResponse.status, 200);
    assert.deepStrictEqual(
      seriesResponse.body.results.map(({ id }: { id: number }) => id),
      [issue.id]
    );
    assert.deepStrictEqual(seriesResponse.body.counts, {
      all: 1,
      open: 1,
      resolved: 0,
    });
    assert.strictEqual(movieResponse.status, 200);
    assert.deepStrictEqual(movieResponse.body.results, []);
    assert.deepStrictEqual(movieResponse.body.counts, {
      all: 0,
      open: 0,
      resolved: 0,
    });
  });

  it('filters movie issues through the media-specific metadata controls', async () => {
    const matchingIssue = await createIssue(
      'admin@seerr.dev',
      111,
      IssueType.VIDEO,
      IssueStatus.OPEN,
      MediaType.MOVIE
    );
    const otherIssue = await createIssue(
      'admin@seerr.dev',
      112,
      IssueType.VIDEO,
      IssueStatus.OPEN,
      MediaType.MOVIE
    );
    await getRepository(MediaSearchMetadata).save([
      {
        mediaId: matchingIssue.media.id,
        media: matchingIssue.media,
        title: 'Matching Movie Issue',
        releaseDate: '2024-03-15',
        genres: 'Action, Thriller',
        studio: 'Universal Pictures',
        searchText: 'matching movie issue 2024 action thriller universal',
      },
      {
        mediaId: otherIssue.media.id,
        media: otherIssue.media,
        title: 'Other Movie Issue',
        releaseDate: '2023-06-01',
        genres: 'Drama',
        studio: 'Disney',
        searchText: 'other movie issue 2023 drama disney',
      },
    ]);
    const agent = await login();

    const res = await agent.get('/issue').query({
      mediaType: MediaType.MOVIE,
      releaseYear: '2024',
      genre: 'action',
      studio: 'universal',
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(
      res.body.results.map(({ id }: { id: number }) => id),
      [matchingIssue.id]
    );
    assert.deepStrictEqual(res.body.counts, {
      all: 1,
      open: 1,
      resolved: 0,
    });
  });

  it('filters series and music issues by their dynamic controls', async () => {
    const seriesIssue = await createIssue(
      'admin@seerr.dev',
      113,
      IssueType.VIDEO,
      IssueStatus.OPEN,
      MediaType.TV
    );
    const musicIssue = await createIssue(
      'admin@seerr.dev',
      114,
      IssueType.AUDIO,
      IssueStatus.OPEN,
      MediaType.MUSIC
    );
    await getRepository(MediaSearchMetadata).save([
      {
        mediaId: seriesIssue.media.id,
        media: seriesIssue.media,
        title: 'Network Series Issue',
        releaseDate: '2022-01-01',
        genres: 'Drama',
        network: 'Prime Video',
        searchText: 'network series issue 2022 drama prime video',
      },
      {
        mediaId: musicIssue.media.id,
        media: musicIssue.media,
        title: 'Album Type Issue',
        releaseDate: '2021-01-01',
        genres: 'Rock',
        albumType: 'Album',
        searchText: 'album type issue 2021 rock album',
      },
    ]);
    const agent = await login();

    const [seriesResponse, musicResponse] = await Promise.all([
      agent.get('/issue').query({
        mediaType: MediaType.TV,
        network: 'prime video',
      }),
      agent.get('/issue').query({
        mediaType: MediaType.MUSIC,
        albumType: 'album',
      }),
    ]);

    assert.strictEqual(seriesResponse.status, 200);
    assert.deepStrictEqual(
      seriesResponse.body.results.map(({ id }: { id: number }) => id),
      [seriesIssue.id]
    );
    assert.strictEqual(musicResponse.status, 200);
    assert.deepStrictEqual(
      musicResponse.body.results.map(({ id }: { id: number }) => id),
      [musicIssue.id]
    );
  });

  it('filters issues and task counts by issue type', async () => {
    const issue = await createIssue(
      'admin@seerr.dev',
      110,
      IssueType.AUDIO,
      IssueStatus.OPEN
    );
    await getRepository(MediaSearchMetadata).save({
      mediaId: issue.media.id,
      media: issue.media,
      title: 'Issue Type Filter Marker',
      searchText: 'issue type filter marker',
    });
    const agent = await login();

    const [audioResponse, videoResponse] = await Promise.all([
      agent
        .get('/issue')
        .query({ search: 'issue type filter marker', issueType: 'audio' }),
      agent
        .get('/issue')
        .query({ search: 'issue type filter marker', issueType: 'video' }),
    ]);

    assert.strictEqual(audioResponse.status, 200);
    assert.deepStrictEqual(
      audioResponse.body.results.map(({ id }: { id: number }) => id),
      [issue.id]
    );
    assert.deepStrictEqual(audioResponse.body.counts, {
      all: 1,
      open: 1,
      resolved: 0,
    });
    assert.strictEqual(videoResponse.status, 200);
    assert.deepStrictEqual(videoResponse.body.results, []);
    assert.deepStrictEqual(videoResponse.body.counts, {
      all: 0,
      open: 0,
      resolved: 0,
    });
  });

  it('rejects malformed issue create numeric fields before media lookup', async () => {
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: '1',
      mediaId: '1',
      message: 'Playback fails.',
      problemEpisode: 1,
      problemSeason: 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Media ID must be a valid ID/);
  });

  it('rejects malformed issue create bodies before validation', async () => {
    const agent = await login();
    const res = await agent.post('/issue').send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Issue body must be an object/);
  });

  it('rejects invalid issue types before persistence', async () => {
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: 999,
      mediaId: 1,
      message: 'Playback fails.',
      problemEpisode: 1,
      problemSeason: 1,
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Issue type must be valid/);
  });

  it('persists the selected quality and affected series episodes', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 111,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.AVAILABLE,
      })
    );
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.VIDEO,
      mediaId: media.id,
      message: 'Several episodes have visible artifacts.',
      is4k: true,
      problemSeason: 3,
      problemEpisodes: [7, 5, 7, 6],
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.is4k, true);
    assert.strictEqual(res.body.problemSeason, 3);
    assert.strictEqual(res.body.problemEpisode, 5);
    assert.deepStrictEqual(res.body.problemEpisodes, [5, 6, 7]);

    const persisted = await getRepository(Issue).findOneByOrFail({
      id: res.body.id,
    });
    assert.strictEqual(persisted.is4k, true);
    assert.deepStrictEqual(persisted.problemEpisodes, [5, 6, 7]);
  });

  it('persists independent episode selections for multiple seasons', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 113,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const selections = [
      { seasonNumber: 1, episodeNumbers: [4, 2, 4] },
      { seasonNumber: 3 },
      { seasonNumber: 5, episodeNumbers: [8, 7] },
    ];
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.AUDIO,
      mediaId: media.id,
      message: 'Several episodes have audio problems.',
      problemEpisodeSelections: selections,
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.problemEpisodeSelections, [
      { seasonNumber: 1, episodeNumbers: [2, 4] },
      { seasonNumber: 3 },
      { seasonNumber: 5, episodeNumbers: [7, 8] },
    ]);
    assert.strictEqual(res.body.problemSeason, 1);
    assert.strictEqual(res.body.problemEpisode, 2);
    assert.deepStrictEqual(res.body.problemEpisodes, [2, 4]);

    const persisted = await getRepository(Issue).findOneByOrFail({
      id: res.body.id,
    });
    assert.deepStrictEqual(persisted.problemEpisodeSelections, [
      { seasonNumber: 1, episodeNumbers: [2, 4] },
      { seasonNumber: 3 },
      { seasonNumber: 5, episodeNumbers: [7, 8] },
    ]);
    assert.deepStrictEqual(persisted.problemEpisodes, [2, 4]);
  });

  it('rejects an empty partial-season episode selection', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 114,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.VIDEO,
      mediaId: media.id,
      message: 'The selected episode is broken.',
      problemEpisodeSelections: [{ seasonNumber: 1, episodeNumbers: [] }],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /must include at least one episode/);
  });

  it('rejects malformed affected episode selections', async () => {
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 112,
        mediaType: MediaType.TV,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.VIDEO,
      mediaId: media.id,
      message: 'The selected episode is broken.',
      problemSeason: 1,
      problemEpisodes: [1, '2'],
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /positive integers/);
  });

  it('returns issue details without requiring a request body', async () => {
    const issue = await createIssue();

    const agent = await login();
    const res = await agent.get(`/issue/${issue.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, issue.id);
    assert.strictEqual(res.body.comments[0].message, 'Playback fails.');
  });

  it('rejects malformed issue detail IDs before lookup', async () => {
    const agent = await login();
    const res = await agent.get('/issue/not-a-number');

    assert.strictEqual(res.status, 404);
  });

  it('returns 404 when issue details do not exist', async () => {
    const agent = await login();
    const res = await agent.get('/issue/999999999');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.message, 'Issue not found.');
  });

  it('rejects malformed issue comment IDs before lookup', async () => {
    const agent = await login();
    const res = await agent
      .post('/issue/not-a-number/comment')
      .send({ message: 'still broken' });

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed issue comment bodies before lookup', async () => {
    const issue = await createIssue();

    const agent = await login();
    const res = await agent.post(`/issue/${issue.id}/comment`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Issue body must be an object/);
  });

  it('caps issue threads without loading and cascading the entire thread', async () => {
    const issue = await createIssue('admin@seerr.dev', 109);
    const user = await getRepository(User).findOneByOrFail({ id: 1 });
    await getRepository(IssueComment).insert(
      Array.from({ length: MAX_ISSUE_COMMENTS - 1 }, (_, index) => ({
        issue,
        user,
        message: `Existing reply ${index + 1}`,
      }))
    );
    const agent = await login();

    const res = await agent
      .post(`/issue/${issue.id}/comment`)
      .send({ message: 'One reply too many.' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.message, 'Issue comment limit reached.');
    assert.strictEqual(
      await getRepository(IssueComment).countBy({ issue: { id: issue.id } }),
      MAX_ISSUE_COMMENTS
    );
  });

  it('rejects malformed issue comment edit bodies before lookup', async () => {
    const issue = await createIssue();
    const comment = issue.comments[0];

    const agent = await login();
    const res = await agent.put(`/issueComment/${comment.id}`).send([]);

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Issue comment body must be an object/);
  });

  it('rejects malformed issue status IDs before lookup', async () => {
    const agent = await login();
    const res = await agent.post('/issue/not-a-number/resolved');

    assert.strictEqual(res.status, 404);
  });

  it('rejects malformed issue delete IDs before lookup', async () => {
    const agent = await login();
    const res = await agent.delete('/issue/not-a-number');

    assert.strictEqual(res.status, 404);
  });
});

describe('POST /issue on behalf of another user', () => {
  async function seedMedia(tmdbId: number) {
    return getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      })
    );
  }

  it('creates an issue on behalf of the supplied userId', async () => {
    const issueRepo = getRepository(Issue);
    const userRepo = getRepository(User);
    const media = await seedMedia(20001);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });

    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.VIDEO,
      message: 'Playback stutters near the end.',
      mediaId: media.id,
      problemSeason: 0,
      problemEpisode: 0,
      userId: friend.id,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.createdBy.id, friend.id);
    assert.strictEqual(res.body.comments[0].user.id, friend.id);

    const persisted = await issueRepo.findOneOrFail({
      where: { id: res.body.id },
      relations: { createdBy: true, comments: { user: true } },
    });

    assert.strictEqual(persisted.createdBy.id, friend.id);
    assert.strictEqual(persisted.comments[0].user.id, friend.id);
  });

  it('defaults to the authenticated user when userId is omitted', async () => {
    const media = await seedMedia(20002);

    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.AUDIO,
      message: 'Audio is out of sync.',
      mediaId: media.id,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.createdBy.id, 1);
    assert.strictEqual(res.body.comments[0].user.id, 1);
  });

  it('allows creators to supply their own userId', async () => {
    const userRepo = getRepository(User);
    const media = await seedMedia(20003);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });

    friend.permissions = Permission.CREATE_ISSUES;
    await userRepo.save(friend);

    const agent = await loginAs('friend@seerr.dev');
    const res = await agent.post('/issue').send({
      issueType: IssueType.SUBTITLES,
      message: 'Subtitles are missing.',
      mediaId: media.id,
      userId: friend.id,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.createdBy.id, friend.id);
    assert.strictEqual(res.body.comments[0].user.id, friend.id);
  });

  it('prevents non-managers from supplying another userId', async () => {
    const userRepo = getRepository(User);
    const media = await seedMedia(20004);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });

    friend.permissions = Permission.CREATE_ISSUES;
    await userRepo.save(friend);

    const agent = await loginAs('friend@seerr.dev');
    const res = await agent.post('/issue').send({
      issueType: IssueType.OTHER,
      message: 'Something else is wrong.',
      mediaId: media.id,
      userId: admin.id,
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'You do not have permission to create an issue on behalf of another user.'
    );
  });

  it('returns 404 when the supplied userId does not exist', async () => {
    const media = await seedMedia(20005);

    const agent = await login();
    const res = await agent.post('/issue').send({
      issueType: IssueType.OTHER,
      message: 'Something else is wrong.',
      mediaId: media.id,
      userId: 999999,
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.message, 'Issue user not found');
  });
});

describe('Issue route authorization', () => {
  it('uses persisted issue authority for list, count, detail, and comment reads', async () => {
    const ownIssue = await createIssue('admin@seerr.dev', 107);
    const otherIssue = await createIssue('friend@seerr.dev', 108);
    const otherComment = otherIssue.comments[0];
    await getRepository(User).update(1, {
      permissions: Permission.CREATE_ISSUES,
    });

    const staleAuthorizationApp = express();
    staleAuthorizationApp.use((req, _res, next) => {
      req.user = new User({
        id: 1,
        permissions: Permission.MANAGE_ISSUES,
      });
      next();
    });
    staleAuthorizationApp.use('/issue', issueRoutes);
    staleAuthorizationApp.use('/issueComment', issueCommentRoutes);
    staleAuthorizationApp.use(
      (
        err: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => (void _next, res.status(err.status ?? 500).json(err))
    );

    const [listResponse, countResponse, detailResponse, commentResponse] =
      await Promise.all([
        request(staleAuthorizationApp)
          .get('/issue')
          .query({ createdBy: otherIssue.createdBy.id }),
        request(staleAuthorizationApp).get('/issue/count'),
        request(staleAuthorizationApp).get(`/issue/${otherIssue.id}`),
        request(staleAuthorizationApp).get(`/issueComment/${otherComment.id}`),
      ]);

    assert.strictEqual(listResponse.status, 403);
    assert.strictEqual(countResponse.status, 200);
    assert.strictEqual(countResponse.body.total, 1);
    assert.strictEqual(countResponse.body.open, 1);
    assert.strictEqual(detailResponse.status, 403);
    assert.strictEqual(commentResponse.status, 403);
    assert.notStrictEqual(ownIssue.id, otherIssue.id);
  });

  it('limits aggregate counts to issues visible to create-only users', async () => {
    const friend = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    friend.permissions = Permission.CREATE_ISSUES;
    await getRepository(User).save(friend);

    await createIssue(
      'friend@seerr.dev',
      101,
      IssueType.AUDIO,
      IssueStatus.OPEN
    );
    await createIssue(
      'admin@seerr.dev',
      102,
      IssueType.VIDEO,
      IssueStatus.RESOLVED
    );

    const agent = await loginAs('friend@seerr.dev');
    const res = await agent.get('/issue/count');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(res.body, {
      total: 1,
      video: 0,
      audio: 1,
      subtitles: 0,
      others: 0,
      open: 1,
      closed: 0,
    });
  });

  it('allows issue owners to fetch replies written by other users', async () => {
    const friend = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    friend.permissions = Permission.CREATE_ISSUES;
    await getRepository(User).save(friend);
    const issue = await createIssue('friend@seerr.dev', 103);
    const admin = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    const reply = await getRepository(IssueComment).save(
      new IssueComment({
        issue,
        user: admin,
        message: 'Please retry now.',
      })
    );

    const agent = await loginAs('friend@seerr.dev');
    const res = await agent.get(`/issueComment/${reply.id}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'Please retry now.');
    assert.strictEqual(res.body.issue, undefined);
  });

  it('prevents owners from deleting issues after another user replies', async () => {
    const friend = await getRepository(User).findOneByOrFail({
      email: 'friend@seerr.dev',
    });
    friend.permissions = Permission.CREATE_ISSUES;
    await getRepository(User).save(friend);
    const issue = await createIssue('friend@seerr.dev', 104);
    const admin = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    await getRepository(IssueComment).save(
      new IssueComment({
        issue,
        user: admin,
        message: 'I am investigating this.',
      })
    );

    const agent = await loginAs('friend@seerr.dev');
    const res = await agent.delete(`/issue/${issue.id}`);

    assert.strictEqual(res.status, 403);
    assert.ok(await getRepository(Issue).findOneBy({ id: issue.id }));
  });

  it('allows issue managers to delete replied-to issues', async () => {
    const issue = await createIssue('friend@seerr.dev', 105);
    const admin = await getRepository(User).findOneByOrFail({
      email: 'admin@seerr.dev',
    });
    await getRepository(IssueComment).save(
      new IssueComment({
        issue,
        user: admin,
        message: 'This reply should not prevent manager cleanup.',
      })
    );

    const agent = await login();
    const res = await agent.delete(`/issue/${issue.id}`);

    assert.strictEqual(res.status, 204);
    assert.strictEqual(
      await getRepository(Issue).findOneBy({ id: issue.id }),
      null
    );
  });

  it('does not orphan a comment edited concurrently with issue deletion', async () => {
    const issue = await createIssue('admin@seerr.dev', 106);
    const commentId = issue.comments[0].id;
    const agent = await login();

    const [editResult, deleteResult] = await Promise.all([
      agent
        .put(`/issueComment/${commentId}`)
        .send({ message: 'Concurrent edit' }),
      agent.delete(`/issue/${issue.id}`),
    ]);

    assert.ok([200, 404].includes(editResult.status));
    assert.strictEqual(deleteResult.status, 204);
    assert.strictEqual(
      await getRepository(IssueComment).findOneBy({ id: commentId }),
      null
    );
  });
});
