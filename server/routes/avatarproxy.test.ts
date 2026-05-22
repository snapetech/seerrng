import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import * as datasource from '@server/datasource';
import type { ImageResponse } from '@server/lib/imageproxy';
import ImageProxy from '@server/lib/imageproxy';
import express from 'express';
import request from 'supertest';
import avatarproxyRoutes, { AVATAR_HEAD_REQUEST_OPTIONS } from './avatarproxy';

const avatarResponse: ImageResponse = {
  meta: {
    cacheKey: 'avatar-cache-key',
    cacheMiss: false,
    curRevalidate: 3600,
    etag: 'avatar-etag',
    extension: 'jpg',
    isStale: false,
    lastModified: Date.UTC(2026, 0, 1, 0, 0, 0),
    revalidateAfter: Date.UTC(2026, 0, 1, 1, 0, 0),
  },
  imageBuffer: Buffer.from('avatar-bytes'),
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/avatarproxy', avatarproxyRoutes);
  return app;
}

function mockAvatarDependencies() {
  mock.method(datasource, 'getRepository', () => ({
    findOne: async (options?: { where?: Record<string, unknown> }) => {
      if (options?.where?.id === 1) {
        return {
          id: 1,
          jellyfinDeviceId: 'device-id',
          jellyfinUserId: 'admin-jellyfin-id',
        };
      }

      if (options?.where?.jellyfinUserId) {
        return {
          avatarVersion: 'version-1',
          email: 'user@example.com',
        };
      }

      return null;
    },
  }));
  mock.method(ImageProxy.prototype, 'getImage', async () => avatarResponse);
}

afterEach(() => {
  mock.restoreAll();
});

describe('AVATAR_HEAD_REQUEST_OPTIONS', () => {
  it('bounds media-server avatar HEAD requests', () => {
    assert.equal(AVATAR_HEAD_REQUEST_OPTIONS.timeout, 5_000);
    assert.equal(AVATAR_HEAD_REQUEST_OPTIONS.maxRedirects, 0);
    assert.equal(AVATAR_HEAD_REQUEST_OPTIONS.maxContentLength, 1024);
    assert.equal(AVATAR_HEAD_REQUEST_OPTIONS.maxBodyLength, 1024);
  });
});

describe('GET /avatarproxy/remote', () => {
  it('sends browser cache headers for allowlisted remote avatars', async () => {
    mockAvatarDependencies();

    const res = await request(createApp()).get(
      '/avatarproxy/remote?url=https%3A%2F%2Fsecure.gravatar.com%2Favatar%2Fabc%3Fd%3Dmm'
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.equal(res.headers.etag, '"avatar-etag"');
    assert.equal(res.headers['last-modified'], 'Thu, 01 Jan 2026 00:00:00 GMT');
    assert.equal(
      res.headers['cache-control'],
      'public, max-age=3600, stale-while-revalidate=2592000, stale-if-error=604800'
    );
    assert.equal(res.headers['os-cache-key'], 'avatar-cache-key');
    assert.equal(res.headers['os-cache-status'], 'HIT');
    assert.equal(res.body.toString(), 'avatar-bytes');
  });

  it('returns 304 with cache headers when the browser validator matches', async () => {
    mockAvatarDependencies();

    const res = await request(createApp())
      .get(
        '/avatarproxy/remote?url=https%3A%2F%2Fsecure.gravatar.com%2Favatar%2Fabc%3Fd%3Dmm'
      )
      .set('If-None-Match', '"avatar-etag"');

    assert.equal(res.status, 304);
    assert.equal(res.headers.etag, '"avatar-etag"');
    assert.equal(
      res.headers['cache-control'],
      'public, max-age=3600, stale-while-revalidate=2592000, stale-if-error=604800'
    );
  });

  it('rejects unsupported remote avatar URLs without caching them', async () => {
    mockAvatarDependencies();

    const res = await request(createApp()).get(
      '/avatarproxy/remote?url=https%3A%2F%2Fexample.com%2Favatar.png'
    );

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Unsupported avatar URL' });
  });

  it('rejects duplicate remote avatar URL query params', async () => {
    mockAvatarDependencies();

    const res = await request(createApp())
      .get('/avatarproxy/remote')
      .query({
        url: [
          'https://secure.gravatar.com/avatar/abc?d=mm',
          'https://secure.gravatar.com/avatar/def?d=mm',
        ],
      });

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Avatar URL must be a string' });
  });

  it('supports HEAD requests with browser cache headers and no body', async () => {
    mockAvatarDependencies();

    const res = await request(createApp()).head(
      '/avatarproxy/remote?url=https%3A%2F%2Fsecure.gravatar.com%2Favatar%2Fabc%3Fd%3Dmm'
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.equal(res.headers.etag, '"avatar-etag"');
    assert.equal(
      res.headers['cache-control'],
      'public, max-age=3600, stale-while-revalidate=2592000, stale-if-error=604800'
    );
    assert.equal(res.text, undefined);
  });
});

describe('GET /avatarproxy/:jellyfinUserId', () => {
  it('rejects malformed Jellyfin user IDs before cache lookup', async () => {
    const getImageMock = mock.method(
      ImageProxy.prototype,
      'getImage',
      async () => avatarResponse
    );

    const res = await request(createApp()).get('/avatarproxy/not-a-guid');

    assert.equal(res.status, 400);
    assert.match(res.body.error, /avatar/);
    assert.equal(getImageMock.mock.callCount(), 0);
  });

  it('rejects oversized avatar version parameters', async () => {
    mockAvatarDependencies();

    const res = await request(createApp())
      .get('/avatarproxy/0123456789abcdef0123456789abcdef')
      .query({ v: 'x'.repeat(129) });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Avatar version must be 128 characters/);
  });

  it('uses immutable browser caching for versioned avatar URLs', async () => {
    mockAvatarDependencies();

    const res = await request(createApp())
      .get('/avatarproxy/0123456789abcdef0123456789abcdef?v=version-1')
      .set('If-None-Match', '"avatar-etag"');

    assert.equal(res.status, 200);
    assert.equal(res.headers.etag, '"avatar-etag"');
    assert.equal(
      res.headers['cache-control'],
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=604800, immutable'
    );
    assert.equal(res.body.toString(), 'avatar-bytes');
  });
});
