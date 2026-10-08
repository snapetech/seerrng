import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import SportarrAPI from '@server/api/servarr/sportarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  DuplicateMediaRequestError,
  MediaRequest,
  QuotaRestrictedError,
} from '@server/entity/MediaRequest';
import { MediaSearchMetadata } from '@server/entity/MediaSearchMetadata';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';

// get is a prototype method unlike getMovie, and replaces the cache lookup too
const externalApiGetMock = mock.method(
  ExternalAPI.prototype as unknown as {
    get: (endpoint: string) => Promise<unknown>;
  },
  'get',
  async (endpoint: string) => {
    const tmdbId = Number(endpoint.replace(/^\/(movie|tv)\//, ''));

    if (!tmdbId) {
      throw new Error(`Unstubbed external endpoint: ${endpoint}`);
    }

    return {
      id: tmdbId,
      external_ids: {},
      seasons: [1, 2, 3].map((season_number) => ({ season_number })),
      // Skips getMovie's localized fallback call
      videos: { results: [{ type: 'Trailer', key: 'trailer' }] },
    };
  }
).mock;

mock.method(MediaRequest, 'sendNotification', async () => undefined);

setupTestDb();

const sportarrLookupRestores: (() => void)[] = [];

afterEach(() => {
  sportarrLookupRestores.splice(0).forEach((restore) => restore());
  getSettings().sportarr = [];
});

beforeEach(() => {
  externalApiGetMock.resetCalls();
  getSettings().sportarr = [];
});

async function seedRequester(movieQuotaLimit: number): Promise<User> {
  const userRepository = getRepository(User);

  const requester = await userRepository.findOneOrFail({
    where: { email: 'demo@seerr.dev' },
  });
  requester.movieQuotaLimit = movieQuotaLimit;

  return userRepository.save(requester);
}

async function createRequester(
  email: string,
  permissions = Permission.REQUEST
): Promise<User> {
  return getRepository(User).save(new User({ email, permissions, avatar: '' }));
}

function requestMovies(mediaIds: number[], requester: User) {
  return Promise.allSettled(
    mediaIds.map((mediaId) =>
      MediaRequest.request(
        { mediaId, mediaType: MediaType.MOVIE, is4k: false },
        requester
      )
    )
  );
}

function rejections(results: PromiseSettledResult<MediaRequest>[]) {
  return results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
}

describe('MediaRequest.request', () => {
  it('creates canonical sports requests for a user with sports permission', async () => {
    const settings = getSettings();
    settings.sportarr = [
      {
        id: 44,
        name: 'Sportarr',
        hostname: 'sportarr.test',
        port: 1867,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        isDefault: true,
      },
    ];
    const lookup = mock.method(
      SportarrAPI.prototype,
      'getLeagueByExternalId',
      async () => ({
        externalId: 'lg-000042',
        title: 'Premier League',
        overview: 'Top division football league.',
        sport: 'Football',
        country: 'England',
        year: 1888,
        monitored: false,
        images: [],
      })
    );
    sportarrLookupRestores.push(() => lookup.mock.restore());

    const requester = await createRequester(
      'sports-requester@seerr.dev',
      Permission.REQUEST_SPORTS
    );
    const created = await MediaRequest.request(
      {
        mediaId: 'lg-000042',
        mediaType: MediaType.SPORTS,
        is4k: false,
      },
      requester
    );

    assert.equal(created.type, MediaType.SPORTS);
    assert.equal(created.status, MediaRequestStatus.PENDING);
    assert.deepEqual(created.serviceTargets, [
      {
        serviceType: 'sportarr',
        format: 'sports',
        serverId: 44,
        profileId: 5,
        rootFolder: null,
        status: MediaStatus.PENDING,
      },
    ]);
    const savedMedia = await getRepository(Media).findOneOrFail({
      where: { id: created.media.id },
      relations: { identifiers: true },
    });
    assert.equal(
      savedMedia.identifiers.find(
        (identifier) => identifier.provider === 'sportarr'
      )?.value,
      'lg-000042'
    );
    const metadata = await getRepository(MediaSearchMetadata).findOneByOrFail({
      mediaId: created.media.id,
    });
    assert.equal(metadata.title, 'Premier League');
    assert.equal(metadata.provider, 'sportarr');
  });

  it('counts sports requests against the same TV quota', async () => {
    const settings = getSettings();
    settings.sportarr = [
      {
        id: 45,
        name: 'Sportarr',
        hostname: 'sportarr.test',
        port: 1867,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        isDefault: true,
      },
    ];
    const lookup = mock.method(
      SportarrAPI.prototype,
      'getLeagueByExternalId',
      async () => ({
        externalId: 'lg-000043',
        title: 'National Hockey League',
        overview: '',
        sport: 'Ice Hockey',
        monitored: false,
        images: [],
      })
    );
    sportarrLookupRestores.push(() => lookup.mock.restore());

    const requester = await createRequester(
      'sports-quota@seerr.dev',
      Permission.REQUEST
    );
    requester.tvQuotaLimit = 1;
    await getRepository(User).save(requester);
    await MediaRequest.request(
      {
        mediaId: 'lg-000043',
        mediaType: MediaType.SPORTS,
        is4k: false,
      },
      requester
    );

    await assert.rejects(
      () =>
        MediaRequest.request(
          { mediaId: 98765, mediaType: MediaType.TV, is4k: false },
          requester
        ),
      QuotaRestrictedError
    );
  });

  it('rejects the second of two concurrent requests at the movie quota', async () => {
    const requestRepository = getRepository(MediaRequest);
    const requester = await seedRequester(1);

    const results = await requestMovies([11111, 22222], requester);
    const rejected = rejections(results);

    assert.strictEqual(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof QuotaRestrictedError);
    assert.strictEqual(await requestRepository.count(), 1);
    assert.strictEqual(externalApiGetMock.callCount(), 1);
  });

  it('rejects a concurrent duplicate request for the same movie', async () => {
    const requestRepository = getRepository(MediaRequest);
    const requester = await seedRequester(5);

    const results = await requestMovies([33333, 33333], requester);
    const rejected = rejections(results);

    assert.strictEqual(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof DuplicateMediaRequestError);
    assert.strictEqual(await requestRepository.count(), 1);
    assert.strictEqual(externalApiGetMock.callCount(), 2);
  });

  it('rejects a duplicate request that omits is4k', async () => {
    const requestRepository = getRepository(MediaRequest);
    const requester = await seedRequester(5);
    const body = { mediaId: 66666, mediaType: MediaType.MOVIE };

    await MediaRequest.request(body, requester);

    await assert.rejects(
      () => MediaRequest.request(body, requester),
      DuplicateMediaRequestError
    );
    assert.strictEqual(await requestRepository.count(), 1);
  });

  it('rejects a concurrent duplicate request from a different user', async () => {
    const requestRepository = getRepository(MediaRequest);
    const requester = await seedRequester(5);
    const otherRequester = await createRequester('second@seerr.dev');

    const results = await Promise.allSettled(
      [requester, otherRequester].map((user) =>
        MediaRequest.request(
          { mediaId: 44444, mediaType: MediaType.MOVIE, is4k: false },
          user
        )
      )
    );
    const rejected = rejections(results);

    assert.strictEqual(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof DuplicateMediaRequestError);
    assert.strictEqual(await requestRepository.count(), 1);
  });

  it('gives an overlapping season to only one of two concurrent users', async () => {
    const seasonRequestRepository = getRepository(SeasonRequest);
    const requester = await seedRequester(5);
    const otherRequester = await createRequester('second@seerr.dev');

    const results = await Promise.allSettled(
      [
        [requester, [1, 2]],
        [otherRequester, [2, 3]],
      ].map(([user, seasons]) =>
        MediaRequest.request(
          {
            mediaId: 55555,
            mediaType: MediaType.TV,
            seasons: seasons as number[],
            is4k: false,
          },
          user as User
        )
      )
    );

    assert.strictEqual(rejections(results).length, 0);
    assert.strictEqual(
      await seasonRequestRepository.count({ where: { seasonNumber: 2 } }),
      1
    );
    assert.strictEqual(await seasonRequestRepository.count(), 3);
  });

  it('creates one media row for concurrent 4k and non-4k requests', async () => {
    const mediaRepository = getRepository(Media);
    const requestRepository = getRepository(MediaRequest);
    const requester = await seedRequester(5);
    const otherRequester = await createRequester(
      'second@seerr.dev',
      Permission.REQUEST_4K
    );

    const results = await Promise.allSettled(
      [
        [requester, false],
        [otherRequester, true],
      ].map(([user, is4k]) =>
        MediaRequest.request(
          { mediaId: 88888, mediaType: MediaType.MOVIE, is4k: is4k as boolean },
          user as User
        )
      )
    );

    assert.strictEqual(rejections(results).length, 0);
    assert.strictEqual(await requestRepository.count(), 2);
    assert.strictEqual(
      await mediaRepository.count({
        where: { tmdbId: 88888, mediaType: MediaType.MOVIE },
      }),
      1
    );
  });
});
