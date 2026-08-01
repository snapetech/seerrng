import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { setupTestDb } from '@server/test/db';

setupTestDb();

test('User persistence canonicalizes valid Jellyfin GUIDs', async () => {
  const repository = getRepository(User);
  const user = await repository.save(
    new User({
      email: 'canonical-jellyfin@example.com',
      avatar: 'https://example.com/avatar.png',
      jellyfinUserId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
    })
  );

  const raw = await repository
    .createQueryBuilder('user')
    .select('user.jellyfinUserId', 'jellyfinUserId')
    .where('user.id = :id', { id: user.id })
    .getRawOne<{ jellyfinUserId: string }>();

  assert.strictEqual(raw?.jellyfinUserId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('populates request counts explicitly instead of on every user load', async () => {
  const userRepository = getRepository(User);
  const requestRepository = getRepository(MediaRequest);
  const user = await userRepository.findOneByOrFail({ id: 2 });
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 991_001,
      status: MediaStatus.UNKNOWN,
      status4k: MediaStatus.UNKNOWN,
    })
  );

  await requestRepository.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy: user,
      is4k: false,
    })
  );

  const loadedUser = await userRepository.findOneByOrFail({ id: user.id });
  assert.strictEqual(loadedUser.requestCount, undefined);

  await User.populateRequestCounts([loadedUser]);

  assert.strictEqual(loadedUser.requestCount, 1);
});

test('failed and declined requests do not consume retry quota', async () => {
  const userRepository = getRepository(User);
  const user = await userRepository.findOneByOrFail({ id: 2 });
  Object.assign(user, {
    movieQuotaLimit: 10,
    tvQuotaLimit: 10,
    musicQuotaLimit: 10,
    bookQuotaLimit: 10,
  });
  await userRepository.save(user);
  const mediaRepository = getRepository(Media);
  const requestRepository = getRepository(MediaRequest);
  const mediaByType = new Map<MediaType, Media>();
  for (const [index, mediaType] of Object.values(MediaType).entries()) {
    mediaByType.set(
      mediaType,
      await mediaRepository.save(
        new Media({
          mediaType,
          tmdbId:
            mediaType === MediaType.MOVIE || mediaType === MediaType.TV
              ? 992_000 + index
              : 0,
          mbId:
            mediaType === MediaType.MUSIC
              ? 'quota-failed-release-group'
              : undefined,
          status: MediaStatus.UNKNOWN,
          status4k: MediaStatus.UNKNOWN,
        })
      )
    );
  }

  for (const mediaType of Object.values(MediaType)) {
    const media = mediaByType.get(mediaType)!;
    for (const status of [
      MediaRequestStatus.DECLINED,
      MediaRequestStatus.FAILED,
      MediaRequestStatus.COMPLETED,
    ]) {
      await requestRepository.save(
        new MediaRequest({
          type: mediaType,
          status,
          media,
          requestedBy: user,
          is4k: false,
          bookFormat: mediaType === MediaType.BOOK ? 'ebook' : undefined,
          seasons:
            mediaType === MediaType.TV
              ? [new SeasonRequest({ seasonNumber: status })]
              : [],
        })
      );
    }
  }

  const quota = await user.getQuota();

  assert.strictEqual(quota.movie.used, 1);
  assert.strictEqual(quota.tv.used, 1);
  assert.strictEqual(quota.music.used, 1);
  assert.strictEqual(quota.book.used, 1);
});
