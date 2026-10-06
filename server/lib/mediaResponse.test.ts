import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import Issue from '@server/entity/Issue';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { resolveLiveDownloadToken } from './liveDownloadTokens';
import {
  aliasDownloadId,
  restrictMediaIssuesForUser,
  restrictMediaOperationalFieldsForUser,
  restrictMediaRequestsForUser,
} from './mediaResponse';
import { Permission } from './permissions';

describe('aliasDownloadId', () => {
  it('uses a stable installation-keyed alias for low-entropy queue IDs', () => {
    assert.strictEqual(aliasDownloadId('42', 'secret-a').length, 64);
    assert.strictEqual(
      aliasDownloadId('42', 'secret-a'),
      aliasDownloadId('42', 'secret-a')
    );
    assert.notStrictEqual(
      aliasDownloadId('42', 'secret-a'),
      aliasDownloadId('42', 'secret-b')
    );
  });
});

const createMedia = () =>
  new Media({
    issues: [
      new Issue({ id: 1, createdBy: new User({ id: 10 }) }),
      new Issue({ id: 2, createdBy: new User({ id: 20 }) }),
    ],
  });

describe('restrictMediaIssuesForUser', () => {
  it("keeps only the active user's issues without cross-user view permission", () => {
    const media = restrictMediaIssuesForUser(
      createMedia(),
      new User({ id: 10, permissions: Permission.CREATE_ISSUES })
    );

    assert.deepStrictEqual(
      media?.issues.map((issue) => issue.id),
      [1]
    );
  });

  it('keeps all issues for issue viewers and managers', () => {
    for (const permissions of [
      Permission.VIEW_ISSUES,
      Permission.MANAGE_ISSUES,
    ]) {
      const media = restrictMediaIssuesForUser(
        createMedia(),
        new User({ id: 10, permissions })
      );
      assert.deepStrictEqual(
        media?.issues.map((issue) => issue.id),
        [1, 2]
      );
    }
  });
});

const createMediaWithRequests = () =>
  new Media({
    requests: [
      new MediaRequest({
        id: 1,
        status: 2,
        type: MediaType.TV,
        requestedBy: new User({ id: 10 }),
        modifiedBy: new User({ id: 30 }),
        is4k: false,
        serverId: 7,
        profileId: 8,
        rootFolder: '/private/media',
        tags: [9],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        seasons: [new SeasonRequest({ id: 11, seasonNumber: 3, status: 2 })],
      }),
      new MediaRequest({
        id: 2,
        status: 1,
        type: MediaType.BOOK,
        requestedBy: new User({ id: 20 }),
        is4k: false,
        bookFormat: 'audiobook',
        serverId: 17,
        profileId: 18,
        rootFolder: '/other/private/media',
        tags: [19],
        createdAt: new Date('2026-02-01T00:00:00Z'),
        seasons: [],
      }),
    ],
  });

describe('restrictMediaRequestsForUser', () => {
  it('keeps own requests and projects foreign requests to availability data', () => {
    const media = restrictMediaRequestsForUser(
      createMediaWithRequests(),
      new User({ id: 10, permissions: 0 })
    );

    assert.strictEqual(media?.requests[0].rootFolder, '/private/media');
    assert.deepStrictEqual(media?.requests[1], {
      status: 1,
      type: 'book',
      seasons: [],
      is4k: false,
      bookFormat: 'audiobook',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
  });

  it('keeps full foreign requests only for request viewers and managers', () => {
    for (const permissions of [
      Permission.REQUEST_VIEW,
      Permission.MANAGE_REQUESTS,
    ]) {
      const media = restrictMediaRequestsForUser(
        createMediaWithRequests(),
        new User({ id: 99, permissions })
      );
      assert.strictEqual(media?.requests[1].rootFolder, '/other/private/media');
      assert.strictEqual(media?.requests[1].requestedBy.id, 20);
    }
  });
});

const createOperationalMedia = () =>
  new Media({
    serviceUrl: 'http://radarr.internal/movie/private-release',
    serviceUrl4k: 'http://radarr4k.internal/movie/private-release',
    audiobookServiceUrl: 'http://books.internal/book/private-release',
    tautulliUrl: 'http://tautulli.internal/info?rating_key=123',
    externalServiceSlug: 'private-release',
    ratingKey: '123',
    jellyfinMediaId: 'private-jellyfin-id',
    downloadStatus: [
      {
        mediaType: MediaType.MOVIE,
        externalId: 55,
        size: 100,
        sizeLeft: 40,
        status: 'downloading',
        timeLeft: '1 hour',
        estimatedCompletionTime: new Date('2026-03-01T00:00:00Z'),
        title: 'Private.Release.Name-GROUP',
        downloadId: 'private-downloader-id',
        episode: {
          seasonNumber: 2,
          episodeNumber: 3,
          absoluteEpisodeNumber: 15,
          id: 999,
        },
      },
    ],
  });

describe('restrictMediaOperationalFieldsForUser', () => {
  it('adds a user-scoped live ID while keeping the torrent hash redacted', () => {
    const hash = 'a'.repeat(40);
    const source = createOperationalMedia();
    source.downloadStatus![0].downloadId = hash;

    const media = restrictMediaOperationalFieldsForUser(
      source,
      new User({ id: 10, permissions: Permission.REQUEST })
    );
    const download = media?.downloadStatus?.[0];

    assert.equal(download?.downloadId, aliasDownloadId(hash));
    assert.notEqual(download?.downloadId, hash);
    assert.ok(download?.liveDownloadToken);
    assert.equal(
      resolveLiveDownloadToken(download?.liveDownloadToken, 10),
      hash
    );
    assert.equal(
      resolveLiveDownloadToken(download?.liveDownloadToken, 20),
      undefined
    );
  });

  it('removes backend routes and release identifiers for ordinary users', () => {
    const media = restrictMediaOperationalFieldsForUser(
      createOperationalMedia(),
      new User({ id: 10, permissions: Permission.REQUEST })
    );

    assert.strictEqual(media?.serviceUrl, undefined);
    assert.strictEqual(media?.tautulliUrl, undefined);
    assert.strictEqual(media?.externalServiceSlug, undefined);
    assert.strictEqual(media?.ratingKey, undefined);
    assert.strictEqual(media?.jellyfinMediaId, undefined);
    assert.strictEqual(media?.downloadStatus?.[0].title, '');
    assert.strictEqual(media?.downloadStatus?.[0].externalId, 0);
    assert.notStrictEqual(
      media?.downloadStatus?.[0].downloadId,
      'private-downloader-id'
    );
    assert.deepStrictEqual(media?.downloadStatus?.[0].episode, {
      seasonNumber: 2,
      episodeNumber: 3,
    });
  });

  it('keeps service routes for request managers but still redacts releases', () => {
    const media = restrictMediaOperationalFieldsForUser(
      createOperationalMedia(),
      new User({ id: 10, permissions: Permission.MANAGE_REQUESTS })
    );

    assert.strictEqual(
      media?.serviceUrl,
      'http://radarr.internal/movie/private-release'
    );
    assert.strictEqual(media?.downloadStatus?.[0].title, '');
  });

  it('keeps full operational data for administrators', () => {
    const media = restrictMediaOperationalFieldsForUser(
      createOperationalMedia(),
      new User({ id: 1, permissions: Permission.ADMIN })
    );

    assert.strictEqual(
      media?.serviceUrl,
      'http://radarr.internal/movie/private-release'
    );
    assert.strictEqual(
      media?.downloadStatus?.[0].title,
      'Private.Release.Name-GROUP'
    );
    assert.strictEqual(
      media?.downloadStatus?.[0].downloadId,
      'private-downloader-id'
    );
  });
});
