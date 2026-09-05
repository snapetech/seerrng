import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaRequestStatusEvent from '@server/entity/MediaRequestStatusEvent';
import { RequestDispatchOutbox } from '@server/entity/RequestDispatchOutbox';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import downloadTracker from '@server/lib/downloadtracker';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import logger from '@server/logger';
import type { EntityManager, Repository } from 'typeorm';
import { In, Not } from 'typeorm';

export enum RequestStatusStage {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  SEARCHING = 'searching',
  DOWNLOADING = 'downloading',
  IMPORTING = 'importing',
  LIBRARY = 'library',
  AVAILABLE = 'available',
  UNAVAILABLE = 'unavailable',
  FAILED = 'failed',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
}

export const REQUEST_STATUS_TIMELINE: readonly RequestStatusStage[] = [
  RequestStatusStage.REQUESTED,
  RequestStatusStage.APPROVED,
  RequestStatusStage.SEARCHING,
  RequestStatusStage.DOWNLOADING,
  RequestStatusStage.IMPORTING,
  RequestStatusStage.LIBRARY,
  RequestStatusStage.AVAILABLE,
];

export const REQUEST_STATUS_TERMINAL_STAGES: readonly RequestStatusStage[] = [
  RequestStatusStage.AVAILABLE,
  RequestStatusStage.UNAVAILABLE,
  RequestStatusStage.FAILED,
  RequestStatusStage.DECLINED,
  RequestStatusStage.CANCELLED,
];

export interface RequestStatusSnapshot {
  stage: RequestStatusStage;
  attempt: number;
  percent: number | null;
  size: number | null;
  sizeLeft: number | null;
  estimatedCompletionTime: Date | null;
  downloadCount: number;
  downloadId: string | null;
  service: string | null;
  message: string;
  observedAt: Date;
  isTerminal: boolean;
  needsAttention: boolean;
  retryable: boolean;
}

export interface RequestStatusHistoryItem {
  id: number;
  requestId: number;
  requestedById: number;
  mediaId: number;
  mediaType: string;
  stage: RequestStatusStage;
  attempt: number;
  format: string | null;
  service: string | null;
  message: string | null;
  percent: number | null;
  size: number | null;
  sizeLeft: number | null;
  estimatedCompletionTime: Date | null;
  downloadCount: number;
  downloadId: string | null;
  createdAt: Date;
}

export interface RequestStatusPageItem {
  request: MediaRequest;
  status: RequestStatusSnapshot;
}

export interface RequestStatusPage {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: RequestStatusPageItem[];
  counts: {
    total: number;
    active: number;
    attention: number;
    completed: number;
  };
}

type RequestMediaLike = {
  id: number;
  mediaType: MediaType;
  status: MediaStatus;
  status4k: MediaStatus;
  serviceId?: number | null;
  serviceId4k?: number | null;
  externalServiceId?: number | null;
  externalServiceId4k?: number | null;
  audiobookServiceId?: number | null;
  audiobookExternalServiceId?: number | null;
  seasons?: {
    seasonNumber: number;
    status: MediaStatus;
    status4k: MediaStatus;
  }[];
};

type RequestLike = {
  id: number;
  status: MediaRequestStatus;
  type: MediaType;
  is4k: boolean;
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null;
  createdAt: Date;
  updatedAt: Date;
  requestedBy: { id: number };
  media: RequestMediaLike;
  seasons?: {
    seasonNumber: number;
  }[];
};

type StatusEventLike = Pick<
  MediaRequestStatusEvent,
  | 'id'
  | 'requestId'
  | 'requestedById'
  | 'mediaId'
  | 'mediaType'
  | 'stage'
  | 'attempt'
  | 'format'
  | 'service'
  | 'message'
  | 'percent'
  | 'size'
  | 'sizeLeft'
  | 'estimatedCompletionTime'
  | 'downloadCount'
  | 'downloadId'
  | 'fingerprint'
  | 'createdAt'
>;

type StatusOptions = {
  downloads?: DownloadingItem[];
  dispatchPending?: boolean;
  latestEvent?: StatusEventLike;
};

const ACTIVE_STAGES = [
  RequestStatusStage.REQUESTED,
  RequestStatusStage.APPROVED,
  RequestStatusStage.SEARCHING,
  RequestStatusStage.DOWNLOADING,
  RequestStatusStage.IMPORTING,
  RequestStatusStage.LIBRARY,
];

const isAvailableStatus = (status: MediaStatus): boolean =>
  status === MediaStatus.AVAILABLE;

const isDeletedStatus = (status: MediaStatus): boolean =>
  status === MediaStatus.DELETED;

const hasLink = (
  serviceId: number | null | undefined,
  externalServiceId: number | null | undefined
): boolean =>
  serviceId !== null &&
  serviceId !== undefined &&
  externalServiceId !== null &&
  externalServiceId !== undefined;

const hasRequestedBookFormat = (
  media: RequestMediaLike,
  format: 'ebook' | 'audiobook'
): boolean =>
  format === 'audiobook'
    ? hasLink(media.audiobookServiceId, media.audiobookExternalServiceId)
    : hasLink(media.serviceId, media.externalServiceId);

const hasRequestedServiceLink = (request: RequestLike): boolean => {
  if (request.type === MediaType.BOOK) {
    if (request.bookFormat === 'audiobook') {
      return hasRequestedBookFormat(request.media, 'audiobook');
    }
    if (request.bookFormat === 'both') {
      return (
        hasRequestedBookFormat(request.media, 'ebook') ||
        hasRequestedBookFormat(request.media, 'audiobook')
      );
    }
    return hasRequestedBookFormat(request.media, 'ebook');
  }

  if (request.type === MediaType.MOVIE || request.type === MediaType.TV) {
    return request.is4k
      ? hasLink(request.media.serviceId4k, request.media.externalServiceId4k)
      : hasLink(request.media.serviceId, request.media.externalServiceId);
  }

  return hasLink(request.media.serviceId, request.media.externalServiceId);
};

const getRequestedMediaStatus = (request: RequestLike): MediaStatus =>
  request.type === MediaType.BOOK || request.type === MediaType.MUSIC
    ? request.media.status
    : request.is4k
      ? request.media.status4k
      : request.media.status;

const isRequestSatisfied = (request: RequestLike): boolean => {
  const mediaStatus = getRequestedMediaStatus(request);
  if (isDeletedStatus(mediaStatus)) {
    return false;
  }

  if (request.type === MediaType.BOOK) {
    if (!isAvailableStatus(mediaStatus)) {
      return false;
    }
    if (request.bookFormat === 'audiobook') {
      return hasRequestedBookFormat(request.media, 'audiobook');
    }
    if (request.bookFormat === 'both') {
      return (
        hasRequestedBookFormat(request.media, 'ebook') &&
        hasRequestedBookFormat(request.media, 'audiobook')
      );
    }
    return hasRequestedBookFormat(request.media, 'ebook');
  }

  if (request.type === MediaType.TV && request.seasons?.length) {
    const seasonStatus = request.is4k ? 'status4k' : 'status';
    const seasons = request.media.seasons ?? [];
    return request.seasons.every((requestedSeason) => {
      const season = seasons.find(
        (candidate) => candidate.seasonNumber === requestedSeason.seasonNumber
      );
      return !!season && isAvailableStatus(season[seasonStatus]);
    });
  }

  return isAvailableStatus(mediaStatus);
};

const normalizedQueueStatus = (item: DownloadingItem): string =>
  item.status.toLocaleLowerCase().replace(/[\s_-]+/g, '');

const isFailedQueueItem = (item: DownloadingItem): boolean => {
  const status = normalizedQueueStatus(item);
  return (
    status.includes('failed') ||
    status.includes('error') ||
    status.includes('importfailed') ||
    status === 'warning'
  );
};

const isImportingQueueItem = (item: DownloadingItem): boolean => {
  const status = normalizedQueueStatus(item);
  return (
    status.includes('import') ||
    status.includes('postprocess') ||
    status.includes('moving') ||
    status.includes('copying') ||
    status === 'completed'
  );
};

const calculateDownloadMetrics = (downloads: DownloadingItem[]) => {
  const sizedDownloads = downloads.filter(
    (item) =>
      Number.isFinite(item.size) &&
      item.size > 0 &&
      Number.isFinite(item.sizeLeft) &&
      item.sizeLeft >= 0
  );
  const size = sizedDownloads.reduce((total, item) => total + item.size, 0);
  const sizeLeft = sizedDownloads.reduce(
    (total, item) => total + Math.min(item.size, item.sizeLeft),
    0
  );
  const percent =
    size > 0 ? Math.round(((size - sizeLeft) / size) * 1000) / 10 : null;
  const completionTimes = downloads
    .map((item) => item.estimatedCompletionTime)
    .filter(
      (value): value is Date =>
        value instanceof Date && !Number.isNaN(value.getTime())
    );

  return {
    percent,
    size: size > 0 ? size : null,
    sizeLeft: size > 0 ? sizeLeft : null,
    estimatedCompletionTime:
      completionTimes.length > 0
        ? new Date(Math.max(...completionTimes.map((value) => value.getTime())))
        : null,
    downloadId: downloads[0]?.downloadId ?? null,
  };
};

const getDownloadItems = (request: RequestLike): DownloadingItem[] => {
  const media = request.media;
  if (request.type === MediaType.MOVIE) {
    return request.is4k &&
      media.serviceId4k !== null &&
      media.serviceId4k !== undefined &&
      media.externalServiceId4k !== null &&
      media.externalServiceId4k !== undefined
      ? downloadTracker.getMovieProgress(
          media.serviceId4k,
          media.externalServiceId4k
        )
      : media.serviceId !== null &&
          media.serviceId !== undefined &&
          media.externalServiceId !== null &&
          media.externalServiceId !== undefined
        ? downloadTracker.getMovieProgress(
            media.serviceId,
            media.externalServiceId
          )
        : [];
  }
  if (request.type === MediaType.TV) {
    return request.is4k &&
      media.serviceId4k !== null &&
      media.serviceId4k !== undefined &&
      media.externalServiceId4k !== null &&
      media.externalServiceId4k !== undefined
      ? downloadTracker.getSeriesProgress(
          media.serviceId4k,
          media.externalServiceId4k
        )
      : media.serviceId !== null &&
          media.serviceId !== undefined &&
          media.externalServiceId !== null &&
          media.externalServiceId !== undefined
        ? downloadTracker.getSeriesProgress(
            media.serviceId,
            media.externalServiceId
          )
        : [];
  }
  if (request.type === MediaType.MUSIC) {
    return media.serviceId !== null &&
      media.serviceId !== undefined &&
      media.externalServiceId !== null &&
      media.externalServiceId !== undefined
      ? downloadTracker.getMusicProgress(
          media.serviceId,
          media.externalServiceId
        )
      : [];
  }

  const ebookDownloads =
    media.serviceId !== null &&
    media.serviceId !== undefined &&
    media.externalServiceId !== null &&
    media.externalServiceId !== undefined
      ? downloadTracker.getBookProgress(
          media.serviceId,
          media.externalServiceId
        )
      : [];
  const audiobookDownloads =
    media.audiobookServiceId !== null &&
    media.audiobookServiceId !== undefined &&
    media.audiobookExternalServiceId !== null &&
    media.audiobookExternalServiceId !== undefined
      ? downloadTracker.getBookProgress(
          media.audiobookServiceId,
          media.audiobookExternalServiceId
        )
      : [];

  if (request.bookFormat === 'audiobook') {
    return audiobookDownloads;
  }
  if (request.bookFormat === 'both') {
    return [...ebookDownloads, ...audiobookDownloads];
  }
  return ebookDownloads;
};

const getServiceName = (request: RequestLike): string | null => {
  const settings = getExternalRuntimeConfig();
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) names.add(name);
  };

  if (request.type === MediaType.MOVIE) {
    add(
      settings.radarr.find(
        (server) =>
          server.id ===
          (request.is4k ? request.media.serviceId4k : request.media.serviceId)
      )?.name
    );
  } else if (request.type === MediaType.TV) {
    add(
      settings.sonarr.find(
        (server) =>
          server.id ===
          (request.is4k ? request.media.serviceId4k : request.media.serviceId)
      )?.name
    );
  } else if (request.type === MediaType.MUSIC) {
    add(
      settings.lidarr.find((server) => server.id === request.media.serviceId)
        ?.name
    );
  } else {
    add(
      settings.readarr.find((server) => server.id === request.media.serviceId)
        ?.name
    );
    add(
      settings.readarr.find(
        (server) => server.id === request.media.audiobookServiceId
      )?.name
    );
  }

  return names.size > 0 ? [...names].join(' + ') : null;
};

const getMessage = (
  stage: RequestStatusStage,
  queueFailure = false
): string => {
  switch (stage) {
    case RequestStatusStage.REQUESTED:
      return 'Your request is waiting for approval.';
    case RequestStatusStage.APPROVED:
      return 'Your request was approved and is waiting to be dispatched.';
    case RequestStatusStage.SEARCHING:
      return 'Searching for a usable release.';
    case RequestStatusStage.DOWNLOADING:
      return 'A usable release is downloading.';
    case RequestStatusStage.IMPORTING:
      return 'The download is being imported.';
    case RequestStatusStage.LIBRARY:
      return 'The media is being added to your library.';
    case RequestStatusStage.AVAILABLE:
      return 'The requested media is available.';
    case RequestStatusStage.UNAVAILABLE:
      return 'No usable release is currently available.';
    case RequestStatusStage.FAILED:
      return queueFailure
        ? 'The download or import failed.'
        : 'The request could not be completed.';
    case RequestStatusStage.DECLINED:
      return 'This request was declined.';
    case RequestStatusStage.CANCELLED:
      return 'This request was cancelled.';
  }
};

const getStageFromRequest = (
  request: RequestLike,
  options: StatusOptions
): {
  stage: RequestStatusStage;
  queueFailure: boolean;
  downloads: DownloadingItem[];
} => {
  if (request.status === MediaRequestStatus.DECLINED) {
    return {
      stage: RequestStatusStage.DECLINED,
      queueFailure: false,
      downloads: [],
    };
  }
  if (request.status === MediaRequestStatus.FAILED) {
    return {
      stage: RequestStatusStage.FAILED,
      queueFailure: false,
      downloads: [],
    };
  }

  const downloads = options.downloads ?? getDownloadItems(request);
  const queueFailure = downloads.some(isFailedQueueItem);
  if (queueFailure) {
    return { stage: RequestStatusStage.FAILED, queueFailure: true, downloads };
  }

  if (isDeletedStatus(getRequestedMediaStatus(request))) {
    return {
      stage: RequestStatusStage.UNAVAILABLE,
      queueFailure: false,
      downloads,
    };
  }
  if (isRequestSatisfied(request)) {
    return {
      stage: RequestStatusStage.AVAILABLE,
      queueFailure: false,
      downloads,
    };
  }
  if (downloads.some(isImportingQueueItem)) {
    return {
      stage: RequestStatusStage.IMPORTING,
      queueFailure: false,
      downloads,
    };
  }
  if (downloads.length > 0) {
    return {
      stage: RequestStatusStage.DOWNLOADING,
      queueFailure: false,
      downloads,
    };
  }

  const latestEventIsCurrent =
    !!options.latestEvent &&
    options.latestEvent.createdAt.getTime() >= request.updatedAt.getTime();
  if (
    latestEventIsCurrent &&
    options.latestEvent?.stage === RequestStatusStage.UNAVAILABLE &&
    request.status === MediaRequestStatus.APPROVED &&
    !hasRequestedServiceLink(request)
  ) {
    return {
      stage: RequestStatusStage.UNAVAILABLE,
      queueFailure: false,
      downloads,
    };
  }
  if (
    latestEventIsCurrent &&
    options.latestEvent?.stage === RequestStatusStage.FAILED &&
    request.status === MediaRequestStatus.APPROVED
  ) {
    return { stage: RequestStatusStage.FAILED, queueFailure: true, downloads };
  }

  if (request.status === MediaRequestStatus.PENDING) {
    return {
      stage: RequestStatusStage.REQUESTED,
      queueFailure: false,
      downloads,
    };
  }
  if (request.status === MediaRequestStatus.COMPLETED) {
    return {
      stage: hasRequestedServiceLink(request)
        ? RequestStatusStage.LIBRARY
        : RequestStatusStage.APPROVED,
      queueFailure: false,
      downloads,
    };
  }
  if (
    hasRequestedServiceLink(request) &&
    (request.type === MediaType.BOOK && request.bookFormat === 'both'
      ? hasRequestedBookFormat(request.media, 'ebook') !==
        hasRequestedBookFormat(request.media, 'audiobook')
      : [MediaStatus.PROCESSING, MediaStatus.PARTIALLY_AVAILABLE].includes(
          getRequestedMediaStatus(request)
        ))
  ) {
    return {
      stage: RequestStatusStage.LIBRARY,
      queueFailure: false,
      downloads,
    };
  }
  if (options.dispatchPending) {
    return {
      stage: RequestStatusStage.APPROVED,
      queueFailure: false,
      downloads,
    };
  }

  return {
    stage: RequestStatusStage.SEARCHING,
    queueFailure: false,
    downloads,
  };
};

export const getRequestStatus = (
  request: RequestLike,
  options: StatusOptions = {}
): RequestStatusSnapshot => {
  const result = getStageFromRequest(request, options);
  const metrics = calculateDownloadMetrics(result.downloads);
  const stage = result.stage;
  const latestEvent = options.latestEvent;
  const message =
    latestEvent &&
    (stage === RequestStatusStage.UNAVAILABLE ||
      stage === RequestStatusStage.FAILED) &&
    latestEvent.stage === stage &&
    latestEvent.message
      ? latestEvent.message
      : getMessage(stage, result.queueFailure);

  return {
    stage,
    attempt: latestEvent?.attempt ?? 0,
    percent: metrics.percent,
    size: metrics.size,
    sizeLeft: metrics.sizeLeft,
    estimatedCompletionTime: metrics.estimatedCompletionTime,
    downloadCount: result.downloads.length,
    downloadId: metrics.downloadId,
    service: getServiceName(request),
    message,
    observedAt: new Date(),
    isTerminal: (REQUEST_STATUS_TERMINAL_STAGES as readonly string[]).includes(
      stage
    ),
    needsAttention:
      stage === RequestStatusStage.UNAVAILABLE ||
      stage === RequestStatusStage.FAILED ||
      stage === RequestStatusStage.DECLINED ||
      stage === RequestStatusStage.CANCELLED,
    retryable: request.status === MediaRequestStatus.FAILED,
  };
};

const getStatusEventRepository = (
  manager?: EntityManager
): Repository<MediaRequestStatusEvent> =>
  manager?.getRepository(MediaRequestStatusEvent) ??
  getRepository(MediaRequestStatusEvent);

const getLatestStatusEvent = async (
  requestId: number,
  manager?: EntityManager
): Promise<MediaRequestStatusEvent | null> =>
  getStatusEventRepository(manager).findOne({
    where: { requestId },
    order: { id: 'DESC' },
  });

const getDispatchPending = async (
  requestId: number,
  manager?: EntityManager
): Promise<boolean> =>
  (
    manager?.getRepository(RequestDispatchOutbox) ??
    getRepository(RequestDispatchOutbox)
  ).exists({ where: { requestId } });

const eventToHistoryItem = (
  event: MediaRequestStatusEvent
): RequestStatusHistoryItem => ({
  id: event.id,
  requestId: event.requestId,
  requestedById: event.requestedById,
  mediaId: event.mediaId,
  mediaType: event.mediaType,
  stage: event.stage as RequestStatusStage,
  attempt: event.attempt,
  format: event.format ?? null,
  service: event.service ?? null,
  message: event.message ?? null,
  percent: event.percent ?? null,
  size: event.size ?? null,
  sizeLeft: event.sizeLeft ?? null,
  estimatedCompletionTime: event.estimatedCompletionTime ?? null,
  downloadCount: event.downloadCount,
  downloadId: event.downloadId ?? null,
  createdAt: event.createdAt,
});

const makeFingerprint = (status: RequestStatusSnapshot): string =>
  [
    status.stage,
    status.attempt,
    status.percent === null ? 'unknown' : status.percent.toFixed(1),
    status.sizeLeft === null ? 'unknown' : Math.round(status.sizeLeft),
    status.service ?? 'unknown',
    status.downloadCount,
  ]
    .join(':')
    .slice(0, 255);

const getAttempt = (
  stage: RequestStatusStage,
  latestEvent?: StatusEventLike
): number =>
  (latestEvent?.attempt ?? 0) +
  (stage === RequestStatusStage.SEARCHING &&
  latestEvent?.stage !== RequestStatusStage.SEARCHING
    ? 1
    : 0);

const persistStatusEvent = async (
  request: RequestLike,
  status: RequestStatusSnapshot,
  latestEvent: StatusEventLike | undefined,
  manager?: EntityManager
): Promise<void> => {
  const repository = getStatusEventRepository(manager);
  const attempt = getAttempt(status.stage, latestEvent);
  status.attempt = attempt;
  const fingerprint = makeFingerprint(status);
  if (
    latestEvent &&
    latestEvent.stage === status.stage &&
    latestEvent.attempt === attempt &&
    latestEvent.fingerprint === fingerprint
  ) {
    return;
  }

  try {
    await repository.insert(
      new MediaRequestStatusEvent({
        requestId: request.id,
        requestedById: request.requestedBy.id,
        mediaId: request.media.id,
        mediaType: request.type,
        stage: status.stage,
        attempt,
        format: request.bookFormat ?? null,
        service: status.service,
        message: status.message,
        percent: status.percent,
        size: status.size,
        sizeLeft: status.sizeLeft,
        estimatedCompletionTime: status.estimatedCompletionTime,
        downloadCount: status.downloadCount,
        downloadId: status.downloadId,
        fingerprint,
      })
    );
  } catch (error) {
    // Two application instances can observe the same queue poll. The unique
    // fingerprint makes that race harmless; surface other failures to logs.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLocaleLowerCase().includes('unique')) {
      logger.warn('Unable to persist request status event', {
        label: 'Request Status',
        requestId: request.id,
        errorMessage: message,
      });
    }
  }
};

const loadRequest = async (
  requestId: number,
  manager?: EntityManager
): Promise<MediaRequest | null> =>
  (manager?.getRepository(MediaRequest) ?? getRepository(MediaRequest)).findOne(
    {
      where: { id: requestId },
      relations: {
        media: true,
        seasons: true,
        requestedBy: true,
      },
    }
  );

export const recordRequestStatus = async (
  requestId: number,
  options: { manager?: EntityManager } = {}
): Promise<RequestStatusSnapshot | undefined> => {
  const request = await loadRequest(requestId, options.manager);
  if (!request) {
    return undefined;
  }
  const latestEvent = await getLatestStatusEvent(requestId, options.manager);
  const dispatchPending = await getDispatchPending(requestId, options.manager);
  const status = getRequestStatus(request, {
    latestEvent: latestEvent ?? undefined,
    dispatchPending,
  });
  await persistStatusEvent(
    request,
    status,
    latestEvent ?? undefined,
    options.manager
  );
  return status;
};

export const recordRequestStatusOverride = async (
  requestId: number,
  stage: RequestStatusStage,
  message: string
): Promise<void> => {
  const request = await loadRequest(requestId);
  if (!request) {
    return;
  }
  const latestEvent = await getLatestStatusEvent(requestId);
  const status = getRequestStatus(request, {
    latestEvent: latestEvent ?? undefined,
    dispatchPending: false,
  });
  status.stage = stage;
  status.message = message.slice(0, 512);
  status.isTerminal = (
    REQUEST_STATUS_TERMINAL_STAGES as readonly string[]
  ).includes(stage);
  status.needsAttention = stage !== RequestStatusStage.AVAILABLE;
  status.observedAt = new Date();
  await persistStatusEvent(request, status, latestEvent ?? undefined);
};

export const recordRequestCancellation = async (
  request: Pick<
    RequestLike,
    'id' | 'type' | 'bookFormat' | 'requestedBy' | 'media'
  >,
  options: { manager?: EntityManager } = {}
): Promise<void> => {
  const repository = getStatusEventRepository(options.manager);
  const existing = await getLatestStatusEvent(request.id, options.manager);
  const status: RequestStatusSnapshot = {
    stage: RequestStatusStage.CANCELLED,
    attempt: existing?.attempt ?? 0,
    percent: null,
    size: null,
    sizeLeft: null,
    estimatedCompletionTime: null,
    downloadCount: 0,
    downloadId: null,
    service: null,
    message: getMessage(RequestStatusStage.CANCELLED),
    observedAt: new Date(),
    isTerminal: true,
    needsAttention: true,
    retryable: false,
  };
  const fingerprint = makeFingerprint(status);
  try {
    await repository.insert(
      new MediaRequestStatusEvent({
        requestId: request.id,
        requestedById: request.requestedBy.id,
        mediaId: request.media.id,
        mediaType: request.type,
        stage: status.stage,
        attempt: status.attempt,
        format: request.bookFormat ?? null,
        message: status.message,
        downloadCount: 0,
        fingerprint,
      })
    );
  } catch {
    // A duplicate cancellation event is harmless.
  }
};

export const getRequestStatusHistory = async (
  requestId: number,
  take = 100,
  skip = 0
): Promise<{ results: RequestStatusHistoryItem[]; total: number }> => {
  const repository = getStatusEventRepository();
  const [events, total] = await repository.findAndCount({
    where: { requestId },
    order: { id: 'DESC' },
    take: Math.min(Math.max(take, 1), 100),
    skip: Math.max(skip, 0),
  });
  return { results: events.map(eventToHistoryItem), total };
};

const getLatestEvents = async (
  requestIds: number[]
): Promise<Map<number, MediaRequestStatusEvent>> => {
  if (requestIds.length === 0) {
    return new Map();
  }
  const events = await getStatusEventRepository().find({
    where: { requestId: In(requestIds) },
    order: { id: 'DESC' },
  });
  const latest = new Map<number, MediaRequestStatusEvent>();
  for (const event of events) {
    if (!latest.has(event.requestId)) {
      latest.set(event.requestId, event);
    }
  }
  return latest;
};

const getPendingDispatchRequestIds = async (
  requestIds: number[]
): Promise<Set<number>> => {
  if (requestIds.length === 0) {
    return new Set();
  }
  const records = await getRepository(RequestDispatchOutbox).find({
    where: { requestId: In(requestIds) },
    select: { requestId: true },
  });
  return new Set(records.map((record) => record.requestId));
};

const mapRequestStatusItem = async (
  request: MediaRequest,
  latestEvent: MediaRequestStatusEvent | undefined,
  dispatchPending: boolean,
  persist: boolean
): Promise<RequestStatusPageItem> => {
  const status = getRequestStatus(request, {
    latestEvent,
    dispatchPending,
  });
  if (persist) {
    await persistStatusEvent(request, status, latestEvent);
  }
  return { request, status };
};

const stageMatchesFilter = (
  stage: RequestStatusStage,
  filter: string | undefined
): boolean => {
  switch (filter) {
    case 'active':
      return ACTIVE_STAGES.includes(stage);
    case 'attention':
      return [
        RequestStatusStage.UNAVAILABLE,
        RequestStatusStage.FAILED,
        RequestStatusStage.DECLINED,
        RequestStatusStage.CANCELLED,
      ].includes(stage);
    case 'completed':
    case 'available':
      return stage === RequestStatusStage.AVAILABLE;
    default:
      return !filter || stage === filter;
  }
};

const getStatusFilterStages = (
  filter: string | undefined
): RequestStatusStage[] | undefined => {
  if (!filter || filter === 'all') {
    return undefined;
  }
  if (filter === 'active') {
    return ACTIVE_STAGES;
  }
  if (filter === 'attention') {
    return [
      RequestStatusStage.UNAVAILABLE,
      RequestStatusStage.FAILED,
      RequestStatusStage.DECLINED,
      RequestStatusStage.CANCELLED,
    ];
  }
  if (filter === 'completed' || filter === 'available') {
    return [RequestStatusStage.AVAILABLE];
  }
  return Object.values(RequestStatusStage).includes(
    filter as RequestStatusStage
  )
    ? [filter as RequestStatusStage]
    : undefined;
};

export const getRequestStatusPage = async (options: {
  take: number;
  skip: number;
  ownerId?: number;
  mediaType?: MediaType;
  filter?: string;
}): Promise<RequestStatusPage> => {
  const requestRepository = getRepository(MediaRequest);
  const latestEventQuery = getStatusEventRepository()
    .createQueryBuilder('statusEventFilter')
    .select('statusEventFilter.requestId', 'requestId')
    .addSelect('MAX(statusEventFilter.id)', 'eventId')
    .groupBy('statusEventFilter.requestId');
  const query = requestRepository
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.media', 'media')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
    .leftJoinAndSelect('request.seasons', 'seasons')
    .leftJoin(
      `(${latestEventQuery.getQuery()})`,
      'latestStatusId',
      'latestStatusId.requestId = request.id'
    )
    .leftJoin(
      MediaRequestStatusEvent,
      'latestStatus',
      'latestStatus.id = latestStatusId.eventId'
    );
  query.setParameters(latestEventQuery.getParameters());

  if (options.ownerId) {
    query.andWhere('requestedBy.id = :ownerId', { ownerId: options.ownerId });
  }
  if (options.mediaType) {
    query.andWhere('request.type = :mediaType', {
      mediaType: options.mediaType,
    });
  }

  const statusStages = getStatusFilterStages(options.filter);
  if (statusStages) {
    query.andWhere(
      '(latestStatus.stage IN (:...statusStages) OR (latestStatus.id IS NULL AND request.status IN (:...legacyStatuses)))',
      {
        statusStages,
        legacyStatuses: [
          MediaRequestStatus.PENDING,
          MediaRequestStatus.APPROVED,
          MediaRequestStatus.DECLINED,
          MediaRequestStatus.FAILED,
          MediaRequestStatus.COMPLETED,
        ],
      }
    );
  }

  const [requests, requestCount] = await query
    .orderBy('request.updatedAt', 'DESC')
    .addOrderBy('request.id', 'DESC')
    .take(Math.min(Math.max(options.take, 1), 100))
    .skip(Math.max(options.skip, 0))
    .getManyAndCount();
  const requestIds = requests.map((request) => request.id);
  const [latestEvents, pendingRequestIds] = await Promise.all([
    getLatestEvents(requestIds),
    getPendingDispatchRequestIds(requestIds),
  ]);
  const resultItems: RequestStatusPageItem[] = [];
  for (const request of requests) {
    const item = await mapRequestStatusItem(
      request,
      latestEvents.get(request.id),
      pendingRequestIds.has(request.id),
      true
    );
    if (stageMatchesFilter(item.status.stage, options.filter)) {
      resultItems.push(item);
    }
  }

  const activeCount = await requestRepository.count({
    where: options.ownerId
      ? {
          requestedBy: { id: options.ownerId },
          status: Not(
            In([
              MediaRequestStatus.DECLINED,
              MediaRequestStatus.FAILED,
              MediaRequestStatus.COMPLETED,
            ])
          ),
        }
      : {
          status: Not(
            In([
              MediaRequestStatus.DECLINED,
              MediaRequestStatus.FAILED,
              MediaRequestStatus.COMPLETED,
            ])
          ),
        },
  });
  const attentionCount = await requestRepository.count({
    where: options.ownerId
      ? {
          requestedBy: { id: options.ownerId },
          status: In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED]),
        }
      : {
          status: In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED]),
        },
  });
  const completedCount = await requestRepository.count({
    where: options.ownerId
      ? {
          requestedBy: { id: options.ownerId },
          status: MediaRequestStatus.COMPLETED,
        }
      : { status: MediaRequestStatus.COMPLETED },
  });

  return {
    pageInfo: {
      pages: Math.ceil(requestCount / Math.min(Math.max(options.take, 1), 100)),
      pageSize: Math.min(Math.max(options.take, 1), 100),
      results: requestCount,
      page:
        Math.floor(
          Math.max(options.skip, 0) / Math.min(Math.max(options.take, 1), 100)
        ) + 1,
    },
    results: resultItems,
    counts: {
      total: await requestRepository.count(
        options.ownerId
          ? { where: { requestedBy: { id: options.ownerId } } }
          : undefined
      ),
      active: activeCount,
      attention: attentionCount,
      completed: completedCount,
    },
  };
};

export const reconcileActiveRequests = async (limit = 500): Promise<void> => {
  const repository = getRepository(MediaRequest);
  const requests = await repository.find({
    where: {
      status: In([
        MediaRequestStatus.PENDING,
        MediaRequestStatus.APPROVED,
        MediaRequestStatus.FAILED,
        MediaRequestStatus.COMPLETED,
      ]),
    },
    relations: {
      media: true,
      seasons: true,
      requestedBy: true,
    },
    order: { updatedAt: 'DESC', id: 'DESC' },
    take: Math.min(Math.max(limit, 1), 1_000),
  });
  for (const request of requests) {
    await recordRequestStatus(request.id);
  }
};

export const hasRequestServiceLink = (request: MediaRequest): boolean =>
  hasRequestedServiceLink(request);
