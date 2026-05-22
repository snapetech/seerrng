import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import { IssueType } from '@server/constants/issue';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import IssueComment from '@server/entity/IssueComment';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
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
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
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
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

async function createIssue() {
  const user = await getRepository(User).findOneByOrFail({
    email: 'admin@seerr.dev',
  });
  const media = await getRepository(Media).save(
    new Media({
      tmdbId: 100,
      mediaType: MediaType.MOVIE,
      status: MediaStatus.AVAILABLE,
      status4k: MediaStatus.UNKNOWN,
    })
  );

  return getRepository(Issue).save(
    new Issue({
      createdBy: user,
      issueType: IssueType.VIDEO,
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
