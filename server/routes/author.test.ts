import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import OpenLibraryAPI from '@server/api/openlibrary';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import authorRoutes from './author';

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
  app.use('/author', authorRoutes);
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

beforeEach(() => {
  mock.method(MediaRequest, 'sendNotification', async () => undefined);
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

describe('GET /author/:id', () => {
  it('rejects malformed author IDs before calling OpenLibrary', async () => {
    const getAuthor = mock.method(OpenLibraryAPI.prototype, 'getAuthor');
    const getAuthorWorks = mock.method(
      OpenLibraryAPI.prototype,
      'getAuthorWorks'
    );

    const agent = await login();
    const res = await agent.get(`/author/${'x'.repeat(129)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAuthor.mock.callCount(), 0);
    assert.strictEqual(getAuthorWorks.mock.callCount(), 0);
  });

  it('returns author works with pagination and existing media state', async () => {
    mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => ({
      key: '/authors/OL1A',
      name: 'Test Author',
      bio: { value: 'Writes test books.' },
      birth_date: '1970',
      photos: [123],
    }));
    mock.method(
      OpenLibraryAPI.prototype,
      'getAuthorWorks',
      async (
        _authorId: string,
        { limit, offset }: { limit: number; offset: number }
      ) => ({
        size: 2,
        entries: [
          {
            key: '/works/OL1W',
            title: 'Existing Work',
            covers: [11],
            first_publish_date: '2001',
          },
          {
            key: '/works/OL2W',
            title: 'New Work',
            first_publish_date: '2002',
          },
        ].slice(offset, offset + limit),
      })
    );

    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    await getRepository(MediaIdentifier).save(
      new MediaIdentifier({
        media,
        provider: MediaIdentifierProvider.OPENLIBRARY,
        value: 'OL1W',
        canonical: true,
      })
    );
    await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy,
        status: MediaRequestStatus.PENDING,
        is4k: false,
        bookFormat: 'ebook',
      })
    );

    const agent = await login();
    const res = await agent.get('/author/OL1A?limit=1&offset=0');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, 'OL1A');
    assert.strictEqual(res.body.name, 'Test Author');
    assert.strictEqual(res.body.biography, 'Writes test books.');
    assert.deepStrictEqual(res.body.pagination, {
      limit: 1,
      offset: 0,
      totalItems: 2,
      nextOffset: 1,
    });
    assert.strictEqual(res.body.works.length, 1);
    assert.strictEqual(res.body.works[0].id, 'OL1W');
    assert.strictEqual(res.body.works[0].author, 'Test Author');
    assert.strictEqual(res.body.works[0].mediaInfo.status, MediaStatus.PENDING);
    assert.strictEqual(res.body.works[0].mediaInfo.requests.length, 1);
  });
});

describe('GET /author/:id/works', () => {
  it('rejects malformed author work IDs before calling OpenLibrary', async () => {
    const getAuthor = mock.method(OpenLibraryAPI.prototype, 'getAuthor');
    const getAuthorWorks = mock.method(
      OpenLibraryAPI.prototype,
      'getAuthorWorks'
    );

    const agent = await login();
    const res = await agent.get(`/author/${'x'.repeat(129)}/works`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(getAuthor.mock.callCount(), 0);
    assert.strictEqual(getAuthorWorks.mock.callCount(), 0);
  });

  it('loads a later page of bibliography works', async () => {
    mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => ({
      key: '/authors/OL1A',
      name: 'Test Author',
    }));
    mock.method(
      OpenLibraryAPI.prototype,
      'getAuthorWorks',
      async (
        _authorId: string,
        { limit, offset }: { limit: number; offset: number }
      ) => ({
        size: 2,
        entries: [
          {
            key: '/works/OL1W',
            title: 'Existing Work',
          },
          {
            key: '/works/OL2W',
            title: 'Later Work',
          },
        ].slice(offset, offset + limit),
      })
    );

    const agent = await login();
    const res = await agent.get('/author/OL1A/works?limit=1&offset=1');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.pagination, {
      limit: 1,
      offset: 1,
      totalItems: 2,
      nextOffset: 2,
    });
    assert.strictEqual(res.body.works.length, 1);
    assert.strictEqual(res.body.works[0].id, 'OL2W');
    assert.strictEqual(res.body.works[0].author, 'Test Author');
  });
});
