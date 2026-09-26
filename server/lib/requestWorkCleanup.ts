import KapowarrAPI from '@server/api/comics/kapowarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI, { type ReadarrMediaType } from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import requestDispatchManager from '@server/lib/requestDispatch';

type CleanupQueueItem = {
  id: number;
  movieId?: number;
  seriesId?: number;
  albumId?: number;
  bookId?: number;
  book?: { id?: number };
  volumeId?: number;
};

type CleanupQueueApi = {
  getQueue: () => Promise<CleanupQueueItem[]>;
  deleteQueueItem: (
    queueId: number,
    options: {
      removeFromClient: boolean;
      blocklist: boolean;
      skipRedownload: boolean;
    }
  ) => Promise<void>;
};

export class RequestWorkCleanupError extends Error {}

const removeMatchingQueueItems = async (
  api: CleanupQueueApi,
  matches: (item: CleanupQueueItem) => boolean
): Promise<void> => {
  const queue = await api.getQueue();
  for (const item of queue.filter(matches)) {
    await api.deleteQueueItem(item.id, {
      removeFromClient: true,
      blocklist: false,
      skipRedownload: true,
    });
  }
  if ((await api.getQueue()).some(matches)) {
    throw new RequestWorkCleanupError(
      'The download service did not confirm cancellation.'
    );
  }
};

class RequestWorkCleanupManager {
  private async cleanupBookOperation(
    operation: BookRequestSearch,
    mediaId: number
  ): Promise<void> {
    const runtimeConfig = getExternalRuntimeConfig();
    const readarrServices = runtimeConfig.readarr;
    const server = readarrServices.find(
      (candidate) => candidate.id === operation.serviceId
    );
    if (!server?.syncEnabled) {
      throw new RequestWorkCleanupError(
        'The selected Bookshelf service is unavailable for cleanup.'
      );
    }
    const api = new ReadarrAPI({
      apiKey: server.apiKey,
      url: ReadarrAPI.buildUrl(server, '/api/v1'),
      mediaType: operation.format,
    });
    const clearServiceLink = async () =>
      getRepository(Media).update(mediaId, {
        ...(operation.format === 'audiobook'
          ? {
              audiobookServiceId: null,
              audiobookExternalServiceId: null,
              audiobookExternalServiceSlug: null,
            }
          : {
              serviceId: null,
              externalServiceId: null,
              externalServiceSlug: null,
            }),
      });

    if (operation.pendingId != null) {
      const instanceUrl = new URL(ReadarrAPI.buildUrl(server, '/api/v1')).href;
      const pendingReferences = await getRepository(BookRequestSearch).find({
        where: { pendingId: operation.pendingId },
        select: { id: true, requestId: true, serviceId: true, state: true },
      });
      const activeReferences = pendingReferences.filter((reference) => {
        if (['available', 'unavailable', 'failed'].includes(reference.state)) {
          return false;
        }

        if (reference.serviceId === operation.serviceId) {
          return true;
        }

        const referenceService = readarrServices.find(
          (candidate) => candidate.id === reference.serviceId
        );
        if (!referenceService) {
          return true;
        }

        try {
          return (
            new URL(ReadarrAPI.buildUrl(referenceService, '/api/v1')).href ===
            instanceUrl
          );
        } catch {
          // If a stored reference cannot be mapped to an instance, preserve
          // the pending import rather than risking cancellation of shared work.
          return true;
        }
      });
      const referencedByAnotherRequest = activeReferences.some(
        (reference) => reference.requestId !== operation.requestId
      );
      const earlierReferenceInRequest = activeReferences.some(
        (reference) =>
          reference.requestId === operation.requestId &&
          reference.id < operation.id
      );
      if (!referencedByAnotherRequest && !earlierReferenceInRequest) {
        await api.cancelPendingAuthorImport(operation.pendingId);
      }
      await clearServiceLink();
      return;
    }
    if (operation.bookId == null) {
      await clearServiceLink();
      return;
    }
    if (operation.commandId != null) {
      const command = await api.getCommand(operation.commandId);
      if (
        !['completed', 'failed', 'aborted', 'cancelled', 'orphaned'].includes(
          String(command.status ?? '')
            .trim()
            .toLowerCase()
        )
      ) {
        throw new RequestWorkCleanupError(
          'Bookshelf has not finished its search command and cannot confirm cancellation yet.'
        );
      }
    } else if (operation.state !== 'pending') {
      throw new RequestWorkCleanupError(
        'Bookshelf request tracking is incomplete, so Seerr cannot confirm cancellation yet.'
      );
    }
    await removeMatchingQueueItems(
      api,
      (item) => (item.bookId ?? item.book?.id) === operation.bookId
    );

    const book = await api.getBookIfExists(operation.bookId);
    let removedBook = !book;
    if (book && operation.createdBook) {
      if ((book.statistics?.bookFileCount ?? 0) === 0) {
        await api.removeBook(operation.bookId, { deleteFiles: false });
        removedBook = true;
      }
    }
    if (operation.createdAuthor && operation.authorId) {
      const remainingBooks = await api.getBooksByAuthor(operation.authorId, 0);
      if (remainingBooks.length === 0) {
        await api.removeAuthor(operation.authorId, { deleteFiles: false });
      }
    }
    if (removedBook) {
      await getRepository(Media).update(mediaId, {
        ...(operation.format === 'audiobook'
          ? {
              audiobookServiceId: null,
              audiobookExternalServiceId: null,
              audiobookExternalServiceSlug: null,
            }
          : {
              serviceId: null,
              externalServiceId: null,
              externalServiceSlug: null,
            }),
      });
    }
  }

  private async cleanupUntrackedBookLinks(
    request: MediaRequest
  ): Promise<void> {
    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    const formats: ReadarrMediaType[] =
      request.bookFormat === 'both'
        ? ['ebook', 'audiobook']
        : [request.bookFormat === 'audiobook' ? 'audiobook' : 'ebook'];

    for (const format of formats) {
      const serviceId =
        format === 'audiobook' ? media.audiobookServiceId : media.serviceId;
      const bookId =
        format === 'audiobook'
          ? media.audiobookExternalServiceId
          : media.externalServiceId;
      if (serviceId == null || bookId == null) continue;
      const server = getExternalRuntimeConfig().readarr.find(
        (candidate) =>
          candidate.id === serviceId &&
          (candidate.serviceType ?? 'ebook') === format
      );
      if (!server?.syncEnabled) {
        throw new RequestWorkCleanupError(
          'The selected Bookshelf service is unavailable for cleanup.'
        );
      }
      const api = new ReadarrAPI({
        apiKey: server.apiKey,
        url: ReadarrAPI.buildUrl(server, '/api/v1'),
        mediaType: format,
      });
      await removeMatchingQueueItems(
        api,
        (item) => (item.bookId ?? item.book?.id) === bookId
      );
      const book = await api.getBookIfExists(bookId);
      if (book && (book.statistics?.bookFileCount ?? 0) === 0) {
        throw new RequestWorkCleanupError(
          'Seerr cannot safely remove an untracked empty Bookshelf entry.'
        );
      }
      if (!book) {
        await getRepository(Media).update(media.id, {
          ...(format === 'audiobook'
            ? {
                audiobookServiceId: null,
                audiobookExternalServiceId: null,
                audiobookExternalServiceSlug: null,
              }
            : {
                serviceId: null,
                externalServiceId: null,
                externalServiceSlug: null,
              }),
        });
      }
    }
  }

  public async cleanup(request: MediaRequest, active: boolean): Promise<void> {
    await requestDispatchManager.cancel(request.id);
    if (!active) return;

    if (request.type === MediaType.MAGAZINE) {
      throw new RequestWorkCleanupError(
        'LazyLibrarian does not support cancelling an individual magazine search through its API.'
      );
    }

    if (
      request.type === MediaType.COMIC &&
      request.media.comicServiceType === 'mylar'
    ) {
      throw new RequestWorkCleanupError(
        'Mylar3 does not support cancelling an individual comic download through its API.'
      );
    }

    if (request.type === MediaType.BOOK) {
      const operations = await getRepository(BookRequestSearch).find({
        where: { requestId: request.id },
        order: { id: 'ASC' },
      });
      for (const operation of operations) {
        await this.cleanupBookOperation(operation, request.media.id);
      }
      if (operations.length === 0) {
        await this.cleanupUntrackedBookLinks(request);
      }
      await getRepository(BookRequestSearch).delete({ requestId: request.id });
      return;
    }

    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    const serviceId =
      request.serverId ?? (request.is4k ? media.serviceId4k : media.serviceId);
    const externalId = request.is4k
      ? media.externalServiceId4k
      : media.externalServiceId;
    if (serviceId == null || externalId == null) return;

    const settings = getExternalRuntimeConfig();
    let api: CleanupQueueApi | undefined;
    let matches: ((item: CleanupQueueItem) => boolean) | undefined;
    if (request.type === MediaType.MOVIE) {
      const server = settings.radarr.find((item) => item.id === serviceId);
      if (server) {
        api = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });
        matches = (item) => item.movieId === externalId;
      }
    } else if (request.type === MediaType.TV) {
      const server = settings.sonarr.find((item) => item.id === serviceId);
      if (server) {
        api = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });
        matches = (item) => item.seriesId === externalId;
      }
    } else if (request.type === MediaType.MUSIC) {
      const server = settings.lidarr.find((item) => item.id === serviceId);
      if (server) {
        api = new LidarrAPI({
          apiKey: server.apiKey,
          url: LidarrAPI.buildUrl(server, '/api/v1'),
        });
        matches = (item) => item.albumId === externalId;
      }
    } else if (
      request.type === MediaType.COMIC &&
      media.comicServiceType === 'kapowarr'
    ) {
      const server = settings.kapowarr.find((item) => item.id === serviceId);
      if (server) {
        const kapowarr = new KapowarrAPI({
          apiKey: server.apiKey,
          url: KapowarrAPI.buildUrl(server),
        });
        api = {
          getQueue: async () =>
            (await kapowarr.getQueue()).map((item) => ({
              id: item.id,
              volumeId: item.volumeId,
            })),
          deleteQueueItem: (queueId, options) =>
            kapowarr.removeQueueItem(queueId, options.blocklist),
        };
        matches = (item) => item.volumeId === externalId;
      }
    }
    if (!api || !matches) {
      throw new RequestWorkCleanupError(
        'The selected download service is unavailable for cleanup.'
      );
    }
    await removeMatchingQueueItems(api, matches);
  }
}

const requestWorkCleanupManager = new RequestWorkCleanupManager();

export default requestWorkCleanupManager;
