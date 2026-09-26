import KapowarrAPI from '@server/api/comics/kapowarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import requestDispatchManager from '@server/lib/requestDispatch';
import { getSettings } from '@server/lib/settings';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import requestWorkCleanupManager, {
  RequestWorkCleanupError,
} from './requestWorkCleanup';

const configureBookshelf = () => {
  getSettings().readarr = [
    {
      id: 20,
      name: 'Bookshelf',
      hostname: 'bookshelf.local',
      port: 8787,
      apiKey: 'test-key',
      useSsl: false,
      activeProfileId: 11,
      activeProfileName: 'Books',
      activeMetadataProfileId: 12,
      activeMetadataProfileName: 'Standard',
      activeDirectory: '/books',
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
      serviceType: 'ebook',
    },
  ];
};

const createActiveBookRequest = async () => {
  const requestedBy = await getRepository(User).findOneByOrFail({
    email: 'friend@seerr.dev',
  });
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.BOOK,
      tmdbId: 0,
      status: MediaStatus.PROCESSING,
      status4k: MediaStatus.UNKNOWN,
      serviceId: 20,
      externalServiceId: 55,
      externalServiceSlug: 'cleanup-book',
    })
  );
  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.BOOK,
      status: MediaRequestStatus.COMPLETED,
      bookFormat: 'ebook',
      media,
      requestedBy,
      is4k: false,
    })
  );
  await getRepository(BookRequestSearch).save(
    new BookRequestSearch({
      requestId: request.id,
      serviceId: 20,
      format: 'ebook',
      bookId: 55,
      authorId: 77,
      commandId: 901,
      createdBook: true,
      createdAuthor: true,
      state: 'grabbed',
    })
  );
  return request;
};

const createActiveComicRequest = async (
  comicServiceType: 'mylar' | 'kapowarr'
) => {
  const requestedBy = await getRepository(User).findOneByOrFail({
    email: 'friend@seerr.dev',
  });
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.COMIC,
      tmdbId: 0,
      status: MediaStatus.PROCESSING,
      status4k: MediaStatus.UNKNOWN,
      serviceId: 40,
      externalServiceId: 1,
      comicServiceType,
    })
  );
  return getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.COMIC,
      status: MediaRequestStatus.APPROVED,
      media,
      requestedBy,
      is4k: false,
      serverId: 40,
    })
  );
};

describe('RequestWorkCleanupManager', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    configureBookshelf();
    mock.method(requestDispatchManager, 'cancel', async () => undefined);
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().readarr = [];
    getSettings().mylar = [];
    getSettings().kapowarr = [];
  });

  it('cancels a pending Chaptarr import without requiring a book or command ID', async () => {
    const request = await createActiveBookRequest();
    const operation = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
    });
    await getRepository(BookRequestSearch).update(operation.id, {
      bookId: null,
      commandId: null,
      providerBookId: 'hc:book-17',
      pendingId: 904,
      createdBook: false,
      createdAuthor: false,
      state: 'pending',
    });
    await getRepository(Media).update(request.media.id, {
      externalServiceId: null,
      externalServiceSlug: 'hc:book-17',
    });
    const canceled: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'cancelPendingAuthorImport',
      async (pendingId: number) => {
        canceled.push(pendingId);
      }
    );
    const commandMock = mock.method(
      ReadarrAPI.prototype,
      'getCommand',
      async () => {
        throw new Error('A pending import has no command.');
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(canceled, [904]);
    assert.equal(commandMock.mock.calls.length, 0);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    assert.equal(media.serviceId, null);
    assert.equal(media.externalServiceId, null);
    assert.equal(media.externalServiceSlug, null);
  });

  it('keeps a pending Chaptarr import when another request still references it', async () => {
    const request = await createActiveBookRequest();
    const otherRequest = await createActiveBookRequest();
    const operations = await getRepository(BookRequestSearch).find({
      where: [{ requestId: request.id }, { requestId: otherRequest.id }],
      order: { id: 'ASC' },
    });
    await getRepository(BookRequestSearch).update(
      operations.map((operation) => operation.id),
      {
        bookId: null,
        commandId: null,
        providerBookId: 'hc:book-17',
        pendingId: 905,
        createdBook: false,
        createdAuthor: false,
        state: 'pending',
      }
    );
    const canceled: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'cancelPendingAuthorImport',
      async (pendingId: number) => {
        canceled.push(pendingId);
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(canceled, []);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({
        requestId: otherRequest.id,
        pendingId: 905,
      }),
      1
    );
  });

  it('keeps a pending import shared by ebook and audiobook entries on one instance', async () => {
    const request = await createActiveBookRequest();
    const otherRequest = await createActiveBookRequest();
    const ebookService = getSettings().readarr[0];
    getSettings().readarr = [
      ebookService,
      {
        ...ebookService,
        id: 21,
        name: 'Bookshelf Audiobooks',
        isDefault: false,
        serviceType: 'audiobook',
      },
    ];

    const operations = await getRepository(BookRequestSearch).find({
      where: [{ requestId: request.id }, { requestId: otherRequest.id }],
      order: { id: 'ASC' },
    });
    await getRepository(BookRequestSearch).update(
      operations.map((operation) => operation.id),
      {
        bookId: null,
        commandId: null,
        providerBookId: 'hc:book-18',
        pendingId: 906,
        createdBook: false,
        createdAuthor: false,
        state: 'pending',
      }
    );
    await getRepository(BookRequestSearch).update(operations[1].id, {
      serviceId: 21,
      format: 'audiobook',
    });

    const canceled: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'cancelPendingAuthorImport',
      async (pendingId: number) => {
        canceled.push(pendingId);
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(canceled, []);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({
        requestId: otherRequest.id,
        pendingId: 906,
        serviceId: 21,
        format: 'audiobook',
      }),
      1
    );
  });

  it('cancels a book download and removes request-created empty records', async () => {
    const request = await createActiveBookRequest();
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    let queueRead = 0;
    mock.method(ReadarrAPI.prototype, 'getQueue', async () =>
      queueRead++ === 0
        ? [
            {
              id: 12,
              bookId: 55,
              size: 100,
              sizeleft: 50,
              title: 'Cleanup Book',
              timeleft: '00:01:00',
              estimatedCompletionTime: '',
              status: 'downloading',
              trackedDownloadStatus: 'ok',
              trackedDownloadState: 'downloading',
              downloadId: 'download-1',
              protocol: 'usenet',
              downloadClient: 'sabnzbd',
              indexer: 'indexer',
            },
          ]
        : []
    );
    const deletedQueueIds: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'deleteQueueItem',
      async (queueId: number) => {
        deletedQueueIds.push(queueId);
      }
    );
    mock.method(ReadarrAPI.prototype, 'getBookIfExists', async () => ({
      id: 55,
      title: 'Cleanup Book',
      statistics: { bookFileCount: 0 },
    }));
    const removedBooks: number[] = [];
    mock.method(ReadarrAPI.prototype, 'removeBook', async (bookId: number) => {
      removedBooks.push(bookId);
    });
    mock.method(ReadarrAPI.prototype, 'getBooksByAuthor', async () => []);
    const removedAuthors: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'removeAuthor',
      async (authorId: number) => {
        removedAuthors.push(authorId);
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(deletedQueueIds, [12]);
    assert.deepEqual(removedBooks, [55]);
    assert.deepEqual(removedAuthors, [77]);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    assert.equal(media.serviceId, null);
    assert.equal(media.externalServiceId, null);
  });

  it('keeps the request intact when Bookshelf cannot confirm cancellation', async () => {
    const request = await createActiveBookRequest();
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'started',
    }));

    await assert.rejects(
      () => requestWorkCleanupManager.cleanup(request, true),
      RequestWorkCleanupError
    );
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      1
    );
  });

  it('reports Mylar cancellation as unsupported without touching the request', async () => {
    const request = await createActiveComicRequest('mylar');

    await assert.rejects(
      () => requestWorkCleanupManager.cleanup(request, true),
      RequestWorkCleanupError
    );
  });

  it('cancels a Kapowarr comic download by matching the queued volume', async () => {
    getSettings().kapowarr = [
      {
        id: 40,
        name: 'Kapowarr',
        hostname: 'kapowarr.local',
        port: 5656,
        apiKey: 'kapowarr-key',
        useSsl: false,
        tags: [],
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
      },
    ];
    const request = await createActiveComicRequest('kapowarr');
    let queueRead = 0;
    mock.method(KapowarrAPI.prototype, 'getQueue', async () =>
      queueRead++ === 0 ? [{ id: 9, volumeId: 1 }] : []
    );
    const removed: [number, boolean][] = [];
    mock.method(
      KapowarrAPI.prototype,
      'removeQueueItem',
      async (downloadId: number, blocklist: boolean) => {
        removed.push([downloadId, blocklist]);
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(removed, [[9, false]]);
  });

  it('confirms cancellation actually removed the Kapowarr queue entry', async () => {
    getSettings().kapowarr = [
      {
        id: 40,
        name: 'Kapowarr',
        hostname: 'kapowarr.local',
        port: 5656,
        apiKey: 'kapowarr-key',
        useSsl: false,
        tags: [],
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
      },
    ];
    const request = await createActiveComicRequest('kapowarr');
    mock.method(KapowarrAPI.prototype, 'getQueue', async () => [
      { id: 9, volumeId: 1 },
    ]);
    mock.method(
      KapowarrAPI.prototype,
      'removeQueueItem',
      async () => undefined
    );

    await assert.rejects(
      () => requestWorkCleanupManager.cleanup(request, true),
      RequestWorkCleanupError
    );
  });
});
