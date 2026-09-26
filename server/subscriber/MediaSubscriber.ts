import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { isRequestedBookFormatAvailable } from '@server/lib/bookAvailability';
import logger from '@server/logger';
import type {
  EntityManager,
  EntitySubscriberInterface,
  FindOptionsWhere,
  UpdateEvent,
} from 'typeorm';
import { And, EventSubscriber, In, LessThanOrEqual, MoreThan } from 'typeorm';

export const MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE = 250;

@EventSubscriber()
export class MediaSubscriber implements EntitySubscriberInterface<Media> {
  private async forEachRequestBatch(
    manager: EntityManager,
    where: FindOptionsWhere<MediaRequest>,
    callback: (requests: MediaRequest[]) => Promise<void>
  ): Promise<void> {
    const requestRepository = manager.getRepository(MediaRequest);
    const newestRequest = await requestRepository.findOne({
      where,
      select: { id: true },
      order: { id: 'DESC' },
      relationLoadStrategy: 'query',
    });
    const maxId = newestRequest?.id;
    if (!Number.isSafeInteger(maxId) || !maxId || maxId <= 0) {
      return;
    }

    let afterId = 0;
    while (afterId < maxId) {
      const requests = (
        await requestRepository.find({
          where: {
            ...where,
            id: And(MoreThan(afterId), LessThanOrEqual(maxId)),
          },
          order: { id: 'ASC' },
          take: MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE,
          relationLoadStrategy: 'query',
        })
      )
        .filter(
          (request) =>
            Number.isSafeInteger(request.id) &&
            request.id > afterId &&
            request.id <= maxId
        )
        .sort((left, right) => left.id - right.id)
        .slice(0, MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE);
      if (!requests.length) {
        return;
      }

      await callback(requests);
      afterId = requests[requests.length - 1].id;

      if (requests.length < MEDIA_SUBSCRIBER_REQUEST_BATCH_SIZE) {
        return;
      }
    }
  }

  private isBookRequestSatisfied(media: Media, request: MediaRequest): boolean {
    if (media.status === MediaStatus.DELETED) {
      return true;
    }

    return isRequestedBookFormatAvailable(media, request.bookFormat ?? 'ebook');
  }

  private async updateChildRequestStatus(
    manager: EntityManager,
    event: Media,
    is4k: boolean
  ) {
    const requestRepository = manager.getRepository(MediaRequest);

    await this.forEachRequestBatch(
      manager,
      {
        media: { id: event.id },
        status: MediaRequestStatus.PENDING,
        is4k,
      },
      async (requests) => {
        for (const request of requests) {
          if (
            event.mediaType !== MediaType.BOOK ||
            this.isBookRequestSatisfied(event, request)
          ) {
            request.status = MediaRequestStatus.APPROVED;
            await requestRepository.save(request);
          }
        }
      }
    );
  }

  private async updateRelatedMediaRequest(
    manager: EntityManager,
    event: Media,
    databaseEvent: Media,
    is4k: boolean
  ) {
    const requestRepository = manager.getRepository(MediaRequest);
    const seasonRequestRepository = manager.getRepository(SeasonRequest);

    await this.forEachRequestBatch(
      manager,
      {
        media: { id: event.id },
        status: In([MediaRequestStatus.APPROVED, MediaRequestStatus.FAILED]),
        is4k,
      },
      async (relatedRequests) => {
        // Check the media entity status and if available
        // or deleted, set the related request to completed
        const completedRequests: MediaRequest[] = [];

        for (const request of relatedRequests) {
          let shouldComplete = false;

          if (
            (event[request.is4k ? 'status4k' : 'status'] ===
              MediaStatus.AVAILABLE ||
              event[request.is4k ? 'status4k' : 'status'] ===
                MediaStatus.DELETED) &&
            (event.mediaType === MediaType.MOVIE ||
              event.mediaType === MediaType.MUSIC ||
              event.mediaType === MediaType.COMIC)
          ) {
            shouldComplete = true;
          } else if (event.mediaType === MediaType.BOOK) {
            shouldComplete = this.isBookRequestSatisfied(event, request);
          } else if (event.mediaType === 'tv') {
            const seasonsToComplete: SeasonRequest[] = [];
            const allSeasonResults = request.seasons.map((requestSeason) => {
              const matchingSeason = event.seasons.find(
                (mediaSeason) =>
                  mediaSeason.seasonNumber === requestSeason.seasonNumber
              );
              const matchingOldSeason = databaseEvent.seasons.find(
                (oldSeason) =>
                  oldSeason.seasonNumber === requestSeason.seasonNumber
              );

              if (!matchingSeason) {
                return false;
              }

              const currentSeasonStatus =
                matchingSeason[request.is4k ? 'status4k' : 'status'];
              const previousSeasonStatus =
                matchingOldSeason?.[request.is4k ? 'status4k' : 'status'];

              const hasStatusChanged =
                currentSeasonStatus !== previousSeasonStatus;

              const shouldUpdate =
                (hasStatusChanged ||
                  requestSeason.status === MediaRequestStatus.COMPLETED) &&
                (currentSeasonStatus === MediaStatus.AVAILABLE ||
                  currentSeasonStatus === MediaStatus.DELETED);

              if (shouldUpdate) {
                requestSeason.status = MediaRequestStatus.COMPLETED;
                seasonsToComplete.push(requestSeason);

                return true;
              }

              return false;
            });

            if (seasonsToComplete.length > 0) {
              await seasonRequestRepository.save(seasonsToComplete);
            }

            const allSeasonsReady = allSeasonResults.every((result) => result);
            shouldComplete = allSeasonsReady;
          }

          if (shouldComplete) {
            request.status = MediaRequestStatus.COMPLETED;
            completedRequests.push(request);
          }
        }

        if (completedRequests.length > 0) {
          await requestRepository.save(completedRequests);
        }
      }
    );
  }

  public async beforeUpdate(event: UpdateEvent<Media>): Promise<void> {
    if (!event.entity || !event.databaseEntity) {
      return;
    }

    // Manually load related seasons into databaseEntity
    // for seasonStatusCheck in afterUpdate
    const seasons = await event.manager
      .getRepository(Season)
      .createQueryBuilder('season')
      .leftJoin('season.media', 'media')
      .where('media.id = :id', { id: event.databaseEntity.id })
      .getMany();

    event.databaseEntity.seasons = seasons;
  }

  public async afterUpdate(event: UpdateEvent<Media>): Promise<void> {
    if (!event.entity || !event.databaseEntity) {
      return;
    }

    const validStatuses = [
      MediaStatus.PARTIALLY_AVAILABLE,
      MediaStatus.AVAILABLE,
      MediaStatus.DELETED,
    ];

    if (
      event.entity.status === MediaStatus.AVAILABLE &&
      event.databaseEntity.status === MediaStatus.PENDING
    ) {
      await this.updateChildRequestStatus(
        event.manager,
        event.entity as Media,
        false
      );
    }

    if (
      event.entity.status4k === MediaStatus.AVAILABLE &&
      event.databaseEntity.status4k === MediaStatus.PENDING
    ) {
      await this.updateChildRequestStatus(
        event.manager,
        event.entity as Media,
        true
      );
    }

    const seasonStatusCheck = (is4k: boolean) => {
      const previousSeasons = new Map(
        event.databaseEntity.seasons.map((season) => [
          season.seasonNumber,
          season,
        ])
      );

      return event.entity?.seasons?.some((season: Season) => {
        const previousSeason = previousSeasons.get(season.seasonNumber);

        return (
          season[is4k ? 'status4k' : 'status'] !==
          previousSeason?.[is4k ? 'status4k' : 'status']
        );
      });
    };

    try {
      if (
        (event.entity.status !== event.databaseEntity?.status ||
          (event.entity.mediaType === MediaType.TV &&
            seasonStatusCheck(false))) &&
        validStatuses.includes(event.entity.status)
      ) {
        await this.updateRelatedMediaRequest(
          event.manager,
          event.entity as Media,
          event.databaseEntity as Media,
          false
        );
      }
    } catch (e) {
      logger.error(
        'Error while updating related requests in afterUpdate subscriber',
        {
          label: 'Media',
          mediaId: event.entity.id,
          is4k: false,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }

    try {
      if (
        (event.entity.status4k !== event.databaseEntity?.status4k ||
          (event.entity.mediaType === MediaType.TV &&
            seasonStatusCheck(true))) &&
        validStatuses.includes(event.entity.status4k)
      ) {
        await this.updateRelatedMediaRequest(
          event.manager,
          event.entity as Media,
          event.databaseEntity as Media,
          true
        );
      }
    } catch (e) {
      logger.error(
        'Error while updating related requests in afterUpdate subscriber',
        {
          label: 'Media',
          mediaId: event.entity.id,
          is4k: true,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public listenTo(): typeof Media {
    return Media;
  }
}
