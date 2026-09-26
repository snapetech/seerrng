import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import {
  MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE,
  MediaSubscriber,
} from '@server/subscriber/MediaSubscriber';
import { setupTestDb } from '@server/test/db';
import type { EntityManager, UpdateEvent } from 'typeorm';

setupTestDb();

type SubscriberInternals = {
  forEachRequestBatch: (
    manager: EntityManager,
    where: object,
    callback: (requests: MediaRequest[]) => Promise<void>
  ) => Promise<void>;
  updateChildRequestStatus: (
    manager: EntityManager,
    media: Media,
    is4k: boolean
  ) => Promise<void>;
  updateRelatedMediaRequest: (
    manager: EntityManager,
    media: Media,
    previousMedia: Media,
    is4k: boolean
  ) => Promise<void>;
};

const makeMedia = (init: Partial<Media>): Media =>
  new Media({
    id: 1,
    tmdbId: 10,
    mediaType: MediaType.MOVIE,
    status: MediaStatus.UNKNOWN,
    status4k: MediaStatus.UNKNOWN,
    seasons: [],
    ...init,
  });

const makeUpdateEvent = (
  entity: Media,
  databaseEntity: Media
): UpdateEvent<Media> =>
  ({ entity, databaseEntity }) as unknown as UpdateEvent<Media>;

describe('MediaSubscriber', () => {
  it('processes a fixed request snapshot in bounded keyset batches', async () => {
    const subscriber = new MediaSubscriber();
    const internals = subscriber as unknown as SubscriberInternals;
    const source = Array.from(
      { length: MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE + 2 },
      (_, index) => new MediaRequest({ id: index + 1 })
    );
    const observedLimits: number[] = [];
    const observedBatchSizes: number[] = [];
    let readIndex = 0;
    const requestRepository = {
      findOne: async () =>
        new MediaRequest({ id: MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE + 2 }),
      find: async (options: { take: number }) => {
        observedLimits.push(options.take);
        if (readIndex === 0) {
          source.push(new MediaRequest({ id: source.length + 1 }));
        }
        const batch = source.slice(readIndex, readIndex + options.take);
        readIndex += options.take;
        return batch;
      },
    };
    const manager = {
      getRepository: () => requestRepository,
    } as unknown as EntityManager;

    await internals.forEachRequestBatch(manager, {}, async (requests) => {
      observedBatchSizes.push(requests.length);
    });

    assert.deepStrictEqual(observedLimits, [250, 250]);
    assert.deepStrictEqual(observedBatchSizes, [250, 2]);
  });

  it('awaits child and related request transitions after availability changes', async () => {
    const subscriber = new MediaSubscriber();
    const internals = subscriber as unknown as SubscriberInternals;
    let releaseChild: (() => void) | undefined;
    let relatedCalls = 0;
    internals.updateChildRequestStatus = async () =>
      new Promise<void>((resolve) => {
        releaseChild = resolve;
      });
    internals.updateRelatedMediaRequest = async () => {
      relatedCalls += 1;
    };
    const entity = makeMedia({ status: MediaStatus.AVAILABLE });
    const previous = makeMedia({ status: MediaStatus.PENDING });

    let settled = false;
    const update = subscriber
      .afterUpdate(makeUpdateEvent(entity, previous))
      .then(() => {
        settled = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(settled, false);
    assert.strictEqual(relatedCalls, 0);
    releaseChild?.();
    await update;
    assert.strictEqual(relatedCalls, 1);
  });

  it('compares TV seasons by season number rather than relation order', async () => {
    const subscriber = new MediaSubscriber();
    const internals = subscriber as unknown as SubscriberInternals;
    let relatedCalls = 0;
    internals.updateChildRequestStatus = async () => undefined;
    internals.updateRelatedMediaRequest = async () => {
      relatedCalls += 1;
    };
    const seasonOne = new Season({
      seasonNumber: 1,
      status: MediaStatus.AVAILABLE,
      status4k: MediaStatus.UNKNOWN,
    });
    const seasonTwo = new Season({
      seasonNumber: 2,
      status: MediaStatus.UNKNOWN,
      status4k: MediaStatus.UNKNOWN,
    });
    const entity = makeMedia({
      mediaType: MediaType.TV,
      status: MediaStatus.PARTIALLY_AVAILABLE,
      seasons: [seasonTwo, seasonOne],
    });
    const previous = makeMedia({
      mediaType: MediaType.TV,
      status: MediaStatus.PARTIALLY_AVAILABLE,
      seasons: [seasonOne, seasonTwo],
    });

    await subscriber.afterUpdate(makeUpdateEvent(entity, previous));

    assert.strictEqual(relatedCalls, 0);
  });

  it('ignores partial update events without a database snapshot', async () => {
    const subscriber = new MediaSubscriber();
    const partialEvent = {
      entity: makeMedia({ status: MediaStatus.AVAILABLE }),
    } as unknown as UpdateEvent<Media>;

    await subscriber.beforeUpdate(partialEvent);
    await subscriber.afterUpdate(partialEvent);
  });

  it('rolls back child request transitions with the source media update', async () => {
    const user = await getRepository(User).findOneByOrFail({ id: 1 });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 99_001,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: user,
        status: MediaRequestStatus.PENDING,
        is4k: false,
      })
    );
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transactionalMedia = await queryRunner.manager.findOneByOrFail(
        Media,
        { id: media.id }
      );
      transactionalMedia.status = MediaStatus.AVAILABLE;
      await queryRunner.manager.save(transactionalMedia);
      const transitioned = await queryRunner.manager.findOneByOrFail(
        MediaRequest,
        { id: request.id }
      );
      assert.notStrictEqual(transitioned.status, MediaRequestStatus.PENDING);
      await queryRunner.rollbackTransaction();
    } finally {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      await queryRunner.release();
    }

    assert.strictEqual(
      (await getRepository(Media).findOneByOrFail({ id: media.id })).status,
      MediaStatus.PENDING
    );
    assert.strictEqual(
      (await getRepository(MediaRequest).findOneByOrFail({ id: request.id }))
        .status,
      MediaRequestStatus.PENDING
    );
  });

  it('completes an approved comic request once its media becomes available', async () => {
    const user = await getRepository(User).findOneByOrFail({ id: 1 });
    const media = await getRepository(Media).save(
      new Media({
        tmdbId: 0,
        mediaType: MediaType.COMIC,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
        comicServiceType: 'kapowarr',
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.COMIC,
        media,
        requestedBy: user,
        status: MediaRequestStatus.APPROVED,
        is4k: false,
      })
    );

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    savedMedia.status = MediaStatus.AVAILABLE;
    await getRepository(Media).save(savedMedia);

    assert.strictEqual(
      (await getRepository(MediaRequest).findOneByOrFail({ id: request.id }))
        .status,
      MediaRequestStatus.COMPLETED
    );
  });
});
