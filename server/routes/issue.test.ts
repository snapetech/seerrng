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
  status = IssueStatus.OPEN
) {
  const user = await getRepository(User).findOneByOrFail({
    email,
  });
  const media = await getRepository(Media).save(
    new Media({
      tmdbId,
      mediaType: MediaType.MOVIE,
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

  it('accepts sorting issues by added date', async () => {
    const agent = await login();
    const res = await agent.get('/issue').query({ sort: 'added' });

    assert.notEqual(res.status, 400);
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
