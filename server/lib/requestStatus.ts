import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import {
  MediaRequest,
  type MediaRequestServiceTarget,
} from '@server/entity/MediaRequest';
import MediaRequestStatusEvent from '@server/entity/MediaRequestStatusEvent';
import { RequestDispatchOutbox } from '@server/entity/RequestDispatchOutbox';
import type {
  DownloadingItem,
  ServarrHistoryEvidence,
} from '@server/lib/downloadtracker';
import downloadTracker from '@server/lib/downloadtracker';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  getRequestedMusicSearchTime,
  reconcileRequestedMusicAvailability,
} from '@server/lib/musicAvailability';
import logger from '@server/logger';
import type { EntityManager, Repository } from 'typeorm';
import { In, MoreThan } from 'typeorm';
import {
  filterRequestStatusItems,
  isMetadataRequestStatusSort,
  sortRequestStatusItems,
  type RequestStatusSortDirection,
  type RequestStatusSortField,
} from './requestStatusSort';

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
    incomplete: number;
    attention: number;
    completed: number;
    unavailable: number;
    failed: number;
  };
  /** Requests in the same scope that predate the selected rolling window. */
  olderCount: number;
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
  serverId?: number | null;
  serviceTargets?: MediaRequestServiceTarget[] | null;
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
  bookSearchState?: BookRequestSearch['state'];
  musicSearchTime?: Date | null;
  servarrHistory?: ServarrHistoryEvidence;
  resetTerminalOverride?: boolean;
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
const REQUEST_STATUS_RECONCILIATION_BATCH_SIZE = 500;
const COMPLETED_MUSIC_SEARCH_SETTLE_MS = 15_000;
const REQUEST_STATUS_RECONCILIATION_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
  MediaRequestStatus.FAILED,
  MediaRequestStatus.COMPLETED,
  MediaRequestStatus.DECLINED,
];
// The synchronizer runs on a schedule and must not starve requests after the
// first batch when a large installation has more than 500 active requests.
let requestStatusReconciliationCursor = 0;

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

const getTarget = (
  request: RequestLike,
  serviceType: MediaRequestServiceTarget['serviceType'],
  format?: MediaRequestServiceTarget['format']
): MediaRequestServiceTarget | undefined =>
  request.serviceTargets?.find(
    (target) =>
      target.serviceType === serviceType &&
      (format === undefined || target.format === format)
  );

const getMusicTarget = (
  request: RequestLike
): MediaRequestServiceTarget | undefined => {
  const savedTarget = getTarget(request, 'lidarr', 'music');
  if (savedTarget) {
    return savedTarget;
  }

  return (request.serverId == null ||
    request.media.serviceId === request.serverId) &&
    request.media.serviceId != null &&
    request.media.externalServiceId != null
    ? {
        serviceType: 'lidarr',
        format: 'music',
        serverId: request.media.serviceId,
        externalServiceId: request.media.externalServiceId,
        status: request.media.status,
      }
    : undefined;
};

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

  if (
    request.type === MediaType.MOVIE ||
    request.type === MediaType.TV ||
    request.type === MediaType.COMIC
  ) {
    return request.is4k
      ? hasLink(request.media.serviceId4k, request.media.externalServiceId4k)
      : hasLink(request.media.serviceId, request.media.externalServiceId);
  }

  const musicTarget = getMusicTarget(request);
  return hasLink(musicTarget?.serverId, musicTarget?.externalServiceId);
};

const getRequestedMediaStatus = (request: RequestLike): MediaStatus =>
  request.type === MediaType.MUSIC
    ? (getMusicTarget(request)?.status ?? request.media.status)
    : request.type === MediaType.BOOK
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

const normalizedQueueStates = (item: DownloadingItem): string[] =>
  [item.status, item.trackedDownloadStatus, item.trackedDownloadState]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLocaleLowerCase().replace(/[\s_-]+/g, ''));

const isFailedQueueItem = (item: DownloadingItem): boolean => {
  const states = normalizedQueueStates(item);
  const explicitFailure = states.some(
    (status) =>
      status.includes('downloadfailed') ||
      status.includes('importfailed') ||
      status === 'failed'
  );

  if (explicitFailure) {
    return true;
  }

  const waitingForImport = states.some(
    (status) =>
      status.includes('importpending') ||
      status.includes('manualimport') ||
      status.includes('postprocess') ||
      status.includes('moving') ||
      status.includes('copying') ||
      status === 'completed'
  );

  return (
    !waitingForImport &&
    states.some(
      (status) => status.includes('failed') || status.includes('error')
    )
  );
};

const isImportingQueueItem = (item: DownloadingItem): boolean => {
  return normalizedQueueStates(item).some(
    (status) =>
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
  // An aggregate percentage is only trustworthy when every queue item has a
  // usable size. Showing the percentage for only the known subset would make
  // a mixed queue look further along than it really is.
  const hasCompleteSizeData =
    downloads.length > 0 && sizedDownloads.length === downloads.length;
  const size = hasCompleteSizeData
    ? sizedDownloads.reduce((total, item) => total + item.size, 0)
    : 0;
  const sizeLeft = sizedDownloads.reduce(
    (total, item) => total + Math.min(item.size, item.sizeLeft),
    0
  );
  const percent =
    hasCompleteSizeData && size > 0
      ? Math.round(((size - sizeLeft) / size) * 1000) / 10
      : null;
  const completionTimes = downloads
    .map((item) => item.estimatedCompletionTime)
    .filter(
      (value): value is Date =>
        value instanceof Date && !Number.isNaN(value.getTime())
    );

  return {
    percent,
    size: hasCompleteSizeData && size > 0 ? size : null,
    sizeLeft: hasCompleteSizeData && size > 0 ? sizeLeft : null,
    estimatedCompletionTime:
      downloads.length > 0 && completionTimes.length === downloads.length
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
    const downloads =
      request.is4k &&
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
    if (!request.seasons?.length) {
      return downloads;
    }

    const requestedSeasons = new Set(
      request.seasons.map((season) => season.seasonNumber)
    );
    return downloads.filter(
      (download) =>
        !download.episode || requestedSeasons.has(download.episode.seasonNumber)
    );
  }
  if (request.type === MediaType.MUSIC) {
    const target = getMusicTarget(request);
    return target?.serverId !== null &&
      target?.serverId !== undefined &&
      target.externalServiceId !== null &&
      target.externalServiceId !== undefined
      ? downloadTracker.getMusicProgress(
          target.serverId,
          target.externalServiceId
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

const getServarrHistoryEvidence = (
  request: RequestLike
): ServarrHistoryEvidence | undefined => {
  const { media } = request;
  const musicTarget =
    request.type === MediaType.MUSIC ? getMusicTarget(request) : undefined;
  const serverId =
    request.type === MediaType.MUSIC
      ? musicTarget?.serverId
      : request.is4k &&
          (request.type === MediaType.MOVIE || request.type === MediaType.TV)
        ? media.serviceId4k
        : media.serviceId;
  const externalServiceId =
    request.type === MediaType.MUSIC
      ? musicTarget?.externalServiceId
      : request.is4k &&
          (request.type === MediaType.MOVIE || request.type === MediaType.TV)
        ? media.externalServiceId4k
        : media.externalServiceId;
  if (
    serverId === null ||
    serverId === undefined ||
    externalServiceId === null ||
    externalServiceId === undefined
  ) {
    return undefined;
  }

  if (request.type === MediaType.MOVIE) {
    return downloadTracker.getMovieHistoryEvidence(
      serverId,
      externalServiceId,
      request.createdAt
    );
  }
  if (request.type === MediaType.TV) {
    return downloadTracker.getSeriesHistoryEvidence(
      serverId,
      externalServiceId,
      request.createdAt
    );
  }
  if (request.type === MediaType.MUSIC) {
    return downloadTracker.getMusicHistoryEvidence(
      serverId,
      externalServiceId,
      request.createdAt
    );
  }
  return undefined;
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
    const target = getMusicTarget(request);
    add(settings.lidarr.find((server) => server.id === target?.serverId)?.name);
  } else {
    const formats =
      request.bookFormat === 'both'
        ? (['ebook', 'audiobook'] as const)
        : request.bookFormat === 'audiobook'
          ? (['audiobook'] as const)
          : (['ebook'] as const);
    for (const format of formats) {
      add(
        settings.readarr.find((server) => {
          const serviceId =
            format === 'audiobook'
              ? request.media.audiobookServiceId
              : request.media.serviceId;
          return (
            server.id === serviceId &&
            (server.serviceType ?? 'ebook') === format
          );
        })?.name
      );
    }
  }

  return names.size > 0 ? [...names].join(' + ') : null;
};

const getMessage = (
  stage: RequestStatusStage,
  queueFailure = false,
  mediaType?: MediaType
): string => {
  if (mediaType === MediaType.BOOK) {
    if (stage === RequestStatusStage.UNAVAILABLE) {
      return 'No usable edition is available from the connected book service. Check the requested edition and the service catalog or acquisition sources, then retry when they are ready.';
    }
    if (stage === RequestStatusStage.FAILED) {
      return queueFailure
        ? 'The connected book service reported a download or import failure. Check its queue or logs for the cause, fix it there, then retry here.'
        : 'The connected book service could not accept this request. Check its connection and metadata provider settings, then retry.';
    }
  }

  if (mediaType === MediaType.COMIC) {
    if (stage === RequestStatusStage.UNAVAILABLE) {
      return 'No usable release is available from the connected comics service. Check the requested comic and the service catalog or acquisition sources, then retry when they are ready.';
    }
    if (stage === RequestStatusStage.FAILED) {
      return queueFailure
        ? 'The connected comics service reported a download or import failure. Check its queue or logs for the cause, fix it there, then retry here.'
        : 'The connected comics service could not accept this request. Check its connection and ComicVine metadata settings, then retry.';
    }
  }

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
  message?: string;
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
  const servarrHistory =
    options.servarrHistory ?? getServarrHistoryEvidence(request);
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

  if (servarrHistory?.stage === 'failed') {
    return { stage: RequestStatusStage.FAILED, queueFailure: true, downloads };
  }
  if (servarrHistory?.stage === 'grabbed') {
    return {
      stage: RequestStatusStage.IMPORTING,
      queueFailure: false,
      downloads,
    };
  }
  if (servarrHistory?.stage === 'imported') {
    return {
      stage:
        request.type === MediaType.MUSIC
          ? RequestStatusStage.IMPORTING
          : RequestStatusStage.LIBRARY,
      queueFailure: false,
      downloads,
    };
  }

  if (options.bookSearchState === 'importing') {
    return {
      stage: RequestStatusStage.IMPORTING,
      queueFailure: false,
      downloads,
    };
  }
  if (options.bookSearchState === 'grabbed') {
    return {
      stage: RequestStatusStage.DOWNLOADING,
      queueFailure: false,
      downloads,
    };
  }
  if (options.bookSearchState === 'searching') {
    return {
      stage: RequestStatusStage.SEARCHING,
      queueFailure: false,
      downloads,
    };
  }
  if (options.bookSearchState === 'pending') {
    return {
      stage: RequestStatusStage.SEARCHING,
      queueFailure: false,
      downloads,
      message: 'Waiting for Bookshelf to prepare the requested book.',
    };
  }

  if (
    request.type === MediaType.MUSIC &&
    hasRequestedServiceLink(request) &&
    options.latestEvent &&
    (options.latestEvent.stage === RequestStatusStage.DOWNLOADING ||
      options.latestEvent.stage === RequestStatusStage.IMPORTING ||
      options.latestEvent.stage === RequestStatusStage.LIBRARY)
  ) {
    return {
      stage: RequestStatusStage.IMPORTING,
      queueFailure: false,
      downloads,
    };
  }

  if (request.type === MediaType.MUSIC && hasRequestedServiceLink(request)) {
    const musicTarget = getMusicTarget(request);
    const searchTime =
      options.musicSearchTime === undefined
        ? musicTarget?.externalServiceId != null
          ? getRequestedMusicSearchTime(
              musicTarget.serverId,
              musicTarget.externalServiceId
            )
          : undefined
        : (options.musicSearchTime ?? undefined);
    if (
      searchTime &&
      searchTime.getTime() >= request.updatedAt.getTime() &&
      Date.now() - searchTime.getTime() >= COMPLETED_MUSIC_SEARCH_SETTLE_MS
    ) {
      return {
        stage: RequestStatusStage.UNAVAILABLE,
        queueFailure: false,
        downloads,
        message: 'No release found. Use an interactive search in Lidarr.',
      };
    }
  }

  const latestEventIsCurrent =
    !!options.latestEvent &&
    options.latestEvent.createdAt.getTime() >= request.updatedAt.getTime();
  if (
    !options.resetTerminalOverride &&
    latestEventIsCurrent &&
    options.latestEvent?.stage === RequestStatusStage.UNAVAILABLE &&
    request.status === MediaRequestStatus.APPROVED &&
    (!hasRequestedServiceLink(request) ||
      (request.type === MediaType.BOOK &&
        request.bookFormat === 'both' &&
        !isRequestSatisfied(request)))
  ) {
    return {
      stage: RequestStatusStage.UNAVAILABLE,
      queueFailure: false,
      downloads,
    };
  }
  if (
    !options.resetTerminalOverride &&
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
  if (hasRequestedServiceLink(request) && request.type !== MediaType.MUSIC) {
    const isMixedBookFormatProgress =
      request.type === MediaType.BOOK &&
      request.bookFormat === 'both' &&
      hasRequestedBookFormat(request.media, 'ebook') !==
        hasRequestedBookFormat(request.media, 'audiobook');
    const isIncompleteMediaStatus = [
      MediaStatus.PROCESSING,
      MediaStatus.PARTIALLY_AVAILABLE,
    ].includes(getRequestedMediaStatus(request));

    if (isMixedBookFormatProgress || isIncompleteMediaStatus) {
      return {
        stage: RequestStatusStage.LIBRARY,
        queueFailure: false,
        downloads,
      };
    }
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
  const hasGenericBookFailureMessage =
    request.type === MediaType.BOOK &&
    (latestEvent?.message === 'No usable release is currently available.' ||
      latestEvent?.message === 'The download or import failed.' ||
      latestEvent?.message === 'The request could not be completed.');
  const message =
    result.message ??
    (latestEvent &&
    (stage === RequestStatusStage.UNAVAILABLE ||
      stage === RequestStatusStage.FAILED) &&
    latestEvent.stage === stage &&
    latestEvent.message &&
    !hasGenericBookFailureMessage
      ? latestEvent.message
      : getMessage(stage, result.queueFailure, request.type));

  return {
    stage,
    attempt: latestEvent?.attempt ?? 0,
    percent: metrics.percent,
    size: metrics.size,
    sizeLeft: metrics.sizeLeft,
    estimatedCompletionTime: metrics.estimatedCompletionTime,
    downloadCount: result.downloads.length,
    downloadId: metrics.downloadId,
    service: getServiceName(request) ?? latestEvent?.service ?? null,
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
    retryable:
      request.status === MediaRequestStatus.FAILED ||
      (stage === RequestStatusStage.UNAVAILABLE &&
        request.status === MediaRequestStatus.APPROVED &&
        !hasRequestedServiceLink(request)),
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

const getBookSearchState = async (
  requestId: number,
  manager?: EntityManager
): Promise<BookRequestSearch['state'] | undefined> => {
  const records = await (
    manager?.getRepository(BookRequestSearch) ??
    getRepository(BookRequestSearch)
  ).find({ where: { requestId }, select: { state: true } });
  if (records.some((record) => record.state === 'importing'))
    return 'importing';
  if (records.some((record) => record.state === 'grabbed')) return 'grabbed';
  if (
    records.some(
      (record) => record.state === 'searching' || record.state === 'settling'
    )
  ) {
    return 'searching';
  }
  if (records.some((record) => record.state === 'pending')) return 'pending';
  return undefined;
};

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
    status.downloadId ?? 'unknown',
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
  options: {
    manager?: EntityManager;
    resetTerminalOverride?: boolean;
  } = {}
): Promise<RequestStatusSnapshot | undefined> => {
  const request = await loadRequest(requestId, options.manager);
  if (!request) {
    return undefined;
  }
  const latestEvent = await getLatestStatusEvent(requestId, options.manager);
  const [dispatchPending, bookSearchState] = await Promise.all([
    getDispatchPending(requestId, options.manager),
    getBookSearchState(requestId, options.manager),
  ]);
  const status = getRequestStatus(request, {
    latestEvent: latestEvent ?? undefined,
    dispatchPending,
    bookSearchState,
    resetTerminalOverride: options.resetTerminalOverride,
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
  if (!request.requestedBy || !request.media) {
    logger.warn(
      'Skipping request cancellation event without request relations',
      {
        label: 'Request Status',
        requestId: request.id,
        hasRequestedBy: !!request.requestedBy,
        hasMedia: !!request.media,
      }
    );
    return;
  }
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
  } catch (error) {
    // A duplicate cancellation event is harmless; surface other persistence
    // failures so operators can repair the history table or migration.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLocaleLowerCase().includes('unique')) {
      logger.warn('Unable to persist request cancellation event', {
        label: 'Request Status',
        requestId: request.id,
        errorMessage: message,
      });
    }
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
  const events: MediaRequestStatusEvent[] = [];
  for (
    let index = 0;
    index < requestIds.length;
    index += REQUEST_STATUS_RECONCILIATION_BATCH_SIZE
  ) {
    events.push(
      ...(await getStatusEventRepository().find({
        where: {
          requestId: In(
            requestIds.slice(
              index,
              index + REQUEST_STATUS_RECONCILIATION_BATCH_SIZE
            )
          ),
        },
        order: { id: 'DESC' },
      }))
    );
  }
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
  const records: RequestDispatchOutbox[] = [];
  for (
    let index = 0;
    index < requestIds.length;
    index += REQUEST_STATUS_RECONCILIATION_BATCH_SIZE
  ) {
    records.push(
      ...(await getRepository(RequestDispatchOutbox).find({
        where: {
          requestId: In(
            requestIds.slice(
              index,
              index + REQUEST_STATUS_RECONCILIATION_BATCH_SIZE
            )
          ),
        },
        select: { requestId: true },
      }))
    );
  }
  return new Set(records.map((record) => record.requestId));
};

const getBookSearchStates = async (
  requestIds: number[]
): Promise<Map<number, BookRequestSearch['state']>> => {
  if (requestIds.length === 0) return new Map();
  const records = await getRepository(BookRequestSearch).find({
    where: { requestId: In(requestIds) },
    select: { requestId: true, state: true },
  });
  const states = new Map<number, BookRequestSearch['state']>();
  for (const record of records) {
    if (
      record.state === 'available' ||
      record.state === 'unavailable' ||
      record.state === 'failed'
    ) {
      continue;
    }
    const nextState =
      record.state === 'settling' ? ('searching' as const) : record.state;
    const current = states.get(record.requestId);
    if (
      !current ||
      nextState === 'importing' ||
      (nextState === 'grabbed' &&
        (current === 'searching' || current === 'pending')) ||
      (nextState === 'searching' && current === 'pending')
    ) {
      states.set(record.requestId, nextState);
    }
  }
  return states;
};

const mapRequestStatusItem = async (
  request: MediaRequest,
  latestEvent: MediaRequestStatusEvent | undefined,
  dispatchPending: boolean,
  bookSearchState: BookRequestSearch['state'] | undefined,
  persist: boolean
): Promise<RequestStatusPageItem> => {
  const status = getRequestStatus(request, {
    latestEvent,
    dispatchPending,
    bookSearchState,
  });
  if (persist) {
    await persistStatusEvent(request, status, latestEvent);
  }
  return { request, status };
};

const stageMatchesFilter = (
  stage: RequestStatusStage,
  filter: string | undefined,
  request: MediaRequest
): boolean => {
  switch (filter) {
    case 'pending':
      return request.status === MediaRequestStatus.PENDING;
    case 'processing':
      return [
        RequestStatusStage.SEARCHING,
        RequestStatusStage.DOWNLOADING,
        RequestStatusStage.IMPORTING,
        RequestStatusStage.LIBRARY,
      ].includes(stage);
    case 'deleted':
      return getRequestedMediaStatus(request) === MediaStatus.DELETED;
    case 'active':
      return ACTIVE_STAGES.includes(stage);
    case 'incomplete':
      return stage === RequestStatusStage.LIBRARY;
    case 'attention':
      return [
        RequestStatusStage.UNAVAILABLE,
        RequestStatusStage.FAILED,
        RequestStatusStage.DECLINED,
        RequestStatusStage.CANCELLED,
      ].includes(stage);
    case 'completed':
      return request.status === MediaRequestStatus.COMPLETED;
    case 'available':
      return stage === RequestStatusStage.AVAILABLE;
    default:
      return !filter || stage === filter;
  }
};

const getRequestStatusCounts = async (options: {
  ownerId?: number;
  mediaType?: MediaType;
  bookFormat?: 'ebook' | 'audiobook';
  since?: Date;
}): Promise<RequestStatusPage['counts']> => {
  const requestRepository = getRepository(MediaRequest);
  const latestEventQuery = getStatusEventRepository()
    .createQueryBuilder('statusEventCountFilter')
    .select('statusEventCountFilter.requestId', 'requestId')
    .addSelect('MAX(statusEventCountFilter.id)', 'eventId')
    .groupBy('statusEventCountFilter.requestId');
  const query = requestRepository
    .createQueryBuilder('requestCount')
    .leftJoin('requestCount.requestedBy', 'requestedByCount')
    .leftJoin(
      `(${latestEventQuery.getQuery()})`,
      'latestStatusCountId',
      'latestStatusCountId.requestId = requestCount.id'
    )
    .leftJoin(
      MediaRequestStatusEvent,
      'latestStatusCount',
      'latestStatusCount.id = latestStatusCountId.eventId'
    )
    .select('requestCount.status', 'requestStatus')
    .addSelect('latestStatusCount.stage', 'stage');
  query.setParameters(latestEventQuery.getParameters());
  if (options.ownerId) {
    query.andWhere('requestedByCount.id = :countOwnerId', {
      countOwnerId: options.ownerId,
    });
  }
  if (options.since) {
    query.andWhere('requestCount.createdAt >= :countSince', {
      countSince: options.since,
    });
  }
  if (options.mediaType) {
    query.andWhere('requestCount.type = :countMediaType', {
      countMediaType: options.mediaType,
    });
  }
  if (options.bookFormat) {
    query.andWhere(
      options.bookFormat === 'ebook'
        ? `requestCount.type = :countBookType
           AND COALESCE(requestCount.bookFormat, 'ebook') IN ('ebook', 'both')`
        : `requestCount.type = :countBookType
           AND requestCount.bookFormat IN ('audiobook', 'both')`,
      { countBookType: MediaType.BOOK }
    );
  }

  const rows = await query.getRawMany<{
    requestStatus: string | number;
    stage?: string | null;
  }>();
  let active = 0;
  let incomplete = 0;
  let attention = 0;
  let completed = 0;
  let unavailable = 0;
  let failed = 0;
  for (const row of rows) {
    let stage = row.stage as RequestStatusStage | undefined;
    if (!stage) {
      const coarseStatus = Number(row.requestStatus);
      stage =
        coarseStatus === MediaRequestStatus.PENDING
          ? RequestStatusStage.REQUESTED
          : coarseStatus === MediaRequestStatus.DECLINED
            ? RequestStatusStage.DECLINED
            : coarseStatus === MediaRequestStatus.FAILED
              ? RequestStatusStage.FAILED
              : coarseStatus === MediaRequestStatus.COMPLETED
                ? RequestStatusStage.AVAILABLE
                : RequestStatusStage.APPROVED;
    }
    if (
      stage === RequestStatusStage.UNAVAILABLE ||
      stage === RequestStatusStage.FAILED ||
      stage === RequestStatusStage.DECLINED ||
      stage === RequestStatusStage.CANCELLED
    ) {
      attention += 1;
    } else if (stage === RequestStatusStage.AVAILABLE) {
      completed += 1;
    } else {
      active += 1;
      if (stage === RequestStatusStage.LIBRARY) {
        incomplete += 1;
      }
    }
    if (stage === RequestStatusStage.UNAVAILABLE) {
      unavailable += 1;
    } else if (stage === RequestStatusStage.FAILED) {
      failed += 1;
    }
  }
  return {
    total: rows.length,
    active,
    incomplete,
    attention,
    completed,
    unavailable,
    failed,
  };
};

const getRequestStatusOlderCount = async (options: {
  ownerId?: number;
  mediaType?: MediaType;
  bookFormat?: 'ebook' | 'audiobook';
  since: Date;
}): Promise<number> => {
  const requestRepository = getRepository(MediaRequest);
  const query = requestRepository
    .createQueryBuilder('requestOlder')
    .leftJoin('requestOlder.requestedBy', 'requestedByOlder')
    .where('requestOlder.createdAt < :olderSince', {
      olderSince: options.since,
    });

  if (options.ownerId) {
    query.andWhere('requestedByOlder.id = :olderOwnerId', {
      olderOwnerId: options.ownerId,
    });
  }
  if (options.mediaType) {
    query.andWhere('requestOlder.type = :olderMediaType', {
      olderMediaType: options.mediaType,
    });
  }
  if (options.bookFormat) {
    query.andWhere(
      options.bookFormat === 'ebook'
        ? `requestOlder.type = :olderBookType
           AND COALESCE(requestOlder.bookFormat, 'ebook') IN ('ebook', 'both')`
        : `requestOlder.type = :olderBookType
           AND requestOlder.bookFormat IN ('audiobook', 'both')`,
      { olderBookType: MediaType.BOOK }
    );
  }

  return query.getCount();
};

export const getRequestStatusPage = async (options: {
  take: number;
  skip: number;
  ownerId?: number;
  mediaType?: MediaType;
  bookFormat?: 'ebook' | 'audiobook';
  search?: string;
  since?: Date;
  filter?: string;
  sort?: RequestStatusSortField;
  sortDirection?: RequestStatusSortDirection;
}): Promise<RequestStatusPage> => {
  const requestRepository = getRepository(MediaRequest);
  const query = requestRepository
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.media', 'media')
    .leftJoinAndSelect('media.seasons', 'mediaSeasons')
    .leftJoinAndSelect('media.identifiers', 'identifiers')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
    .leftJoinAndSelect('request.seasons', 'seasons');

  if (options.ownerId) {
    query.andWhere('requestedBy.id = :ownerId', { ownerId: options.ownerId });
  }
  if (options.since) {
    query.andWhere('request.createdAt >= :since', { since: options.since });
  }
  if (options.mediaType) {
    query.andWhere('request.type = :mediaType', {
      mediaType: options.mediaType,
    });
  }
  if (options.bookFormat) {
    query.andWhere(
      options.bookFormat === 'ebook'
        ? `request.type = :bookType
           AND COALESCE(request.bookFormat, 'ebook') IN ('ebook', 'both')`
        : `request.type = :bookType
           AND request.bookFormat IN ('audiobook', 'both')`,
      { bookType: MediaType.BOOK }
    );
  }

  const pageSize = Math.min(Math.max(options.take, 1), 100);
  const skip = Math.max(options.skip, 0);
  const hasStatusFilter = !!options.filter && options.filter !== 'all';
  const hasSearch = !!options.search?.trim();
  const sortField = options.sort ?? 'added';
  const sortDirection = options.sortDirection ?? 'desc';
  const requiresFullProjection =
    hasStatusFilter ||
    hasSearch ||
    sortField === 'status' ||
    sortField === 'incomplete' ||
    isMetadataRequestStatusSort(sortField);
  let requests: MediaRequest[];
  let requestCount: number;

  if (requiresFullProjection) {
    // The durable event is a cache of the last observation, not the source of
    // truth for a live filter. Queue progress and media availability can move
    // between reconciler runs, so evaluate every candidate before filtering;
    // otherwise a request can disappear from (for example) Downloading until
    // the next background poll.
    requests = await query
      .orderBy('request.updatedAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .getMany();
    requestCount = 0;
  } else {
    const sortColumn =
      sortField === 'modified' ? 'request.updatedAt' : 'request.createdAt';
    const sortSqlDirection = sortDirection === 'asc' ? 'ASC' : 'DESC';
    [requests, requestCount] = await query
      .orderBy(sortColumn, sortSqlDirection)
      .addOrderBy('request.id', 'DESC')
      .take(pageSize)
      .skip(skip)
      .getManyAndCount();
  }

  const requestIds = requests.map((request) => request.id);
  const [latestEvents, pendingRequestIds, bookSearchStates] = await Promise.all(
    [
      getLatestEvents(requestIds),
      getPendingDispatchRequestIds(requestIds),
      getBookSearchStates(requestIds),
    ]
  );

  let resultItems: RequestStatusPageItem[] = [];
  for (const request of requests) {
    resultItems.push(
      await mapRequestStatusItem(
        request,
        latestEvents.get(request.id),
        pendingRequestIds.has(request.id),
        bookSearchStates.get(request.id),
        !requiresFullProjection
      )
    );
  }

  if (hasStatusFilter) {
    resultItems = resultItems.filter(({ status, request }) =>
      stageMatchesFilter(status.stage, options.filter, request)
    );
    requestCount = resultItems.length;
  }

  if (hasSearch) {
    resultItems = await filterRequestStatusItems(
      resultItems,
      options.search ?? ''
    );
    requestCount = resultItems.length;
  }

  if (
    requiresFullProjection ||
    sortField !== 'added' ||
    sortDirection !== 'desc'
  ) {
    resultItems = await sortRequestStatusItems(
      resultItems,
      sortField,
      sortDirection
    );
  }

  if (requiresFullProjection) {
    requestCount = resultItems.length;
    const pageItems = resultItems.slice(skip, skip + pageSize);
    for (const item of pageItems) {
      await persistStatusEvent(
        item.request,
        item.status,
        latestEvents.get(item.request.id)
      );
    }
    resultItems = pageItems;
  }

  const [counts, olderCount] = await Promise.all([
    getRequestStatusCounts({
      ownerId: options.ownerId,
      mediaType: options.mediaType,
      bookFormat: options.bookFormat,
      since: options.since,
    }),
    options.since && !hasStatusFilter
      ? getRequestStatusOlderCount({
          ownerId: options.ownerId,
          mediaType: options.mediaType,
          bookFormat: options.bookFormat,
          since: options.since,
        })
      : Promise.resolve(0),
  ]);

  return {
    pageInfo: {
      pages: Math.ceil(requestCount / pageSize),
      pageSize,
      results: requestCount,
      page: Math.floor(skip / pageSize) + 1,
    },
    results: resultItems,
    counts,
    olderCount,
  };
};

export const reconcileActiveRequests = async (limit = 500): Promise<void> => {
  const repository = getRepository(MediaRequest);
  const batchSize = Math.min(Math.max(limit, 1), 1_000);
  let requests = await repository.find({
    where: {
      id: MoreThan(requestStatusReconciliationCursor),
      status: In(REQUEST_STATUS_RECONCILIATION_STATUSES),
    },
    relations: {
      media: true,
      seasons: true,
      requestedBy: true,
    },
    order: { id: 'ASC' },
    take: batchSize,
  });
  if (requests.length === 0 && requestStatusReconciliationCursor > 0) {
    requestStatusReconciliationCursor = 0;
    requests = await repository.find({
      where: {
        status: In(REQUEST_STATUS_RECONCILIATION_STATUSES),
      },
      relations: {
        media: true,
        seasons: true,
        requestedBy: true,
      },
      order: { id: 'ASC' },
      take: batchSize,
    });
  }
  await reconcileRequestedMusicAvailability(requests);
  for (const request of requests) {
    await recordRequestStatus(request.id);
    requestStatusReconciliationCursor = request.id;
  }
};

export const hasRequestServiceLink = (request: MediaRequest): boolean =>
  hasRequestedServiceLink(request);
