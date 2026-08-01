import type { QueueItem } from '@server/api/servarr/base';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { getRepository } from '@server/datasource';
import DownloadRecoveryState, {
  type DownloadRecoveryServiceType,
} from '@server/entity/DownloadRecoveryState';
import {
  getSettings,
  type DVRSettings,
  type ReadarrSettings,
} from '@server/lib/settings';
import logger from '@server/logger';
import { uniqWith } from 'lodash';
import { LessThan, MoreThan } from 'typeorm';
import { isMatchingReadarrDownloadServer } from './downloadtracker';

type RecoveryQueueItem = QueueItem & {
  movieId?: number;
  seriesId?: number;
  albumId?: number;
  bookId?: number;
  book?: {
    id?: number;
  };
};

type RecoveryApi = {
  getQueue: () => Promise<RecoveryQueueItem[]>;
  deleteQueueItem: (
    queueId: number,
    options?: {
      removeFromClient?: boolean;
      blocklist?: boolean;
      skipRedownload?: boolean;
      changeCategory?: boolean;
    }
  ) => Promise<void>;
  refreshMonitoredDownloads: () => Promise<void>;
};

type RecoveryService = {
  serviceType: DownloadRecoveryServiceType;
  label: string;
  server: DVRSettings;
  api: RecoveryApi;
  getExternalId: (item: RecoveryQueueItem) => number | undefined;
  search: (externalId: number) => Promise<void>;
};

type RecoveryDecision =
  | { action: 'retry'; reason: string }
  | { action: 'track'; reason?: string }
  | { action: 'ignore'; reason: string };

const MAX_RETRIES_PER_DOWNLOAD = 3;
const MAX_RETRIES_PER_MEDIA = 3;
const STALLED_AFTER_MS = 2 * 60 * 60 * 1000;
const STALE_STATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const retryableFailurePattern =
  /\b(encrypted|password|unpack|crc|parity|failed|error|missing|blacklist|rejected|not close enough|couldn't find similar|unable to parse|wrong)\b/i;
const nonRetryableImportPattern =
  /\b(permission|access denied|unauthorized|remote path|path does not exist|no files found|disk full|free space|not enough space|folder is not writable)\b/i;

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.toLowerCase() : '';

const getQueueMessageText = (item: RecoveryQueueItem): string =>
  (item.statusMessages ?? [])
    .flatMap((statusMessage) => [
      statusMessage.title,
      ...(statusMessage.messages ?? []),
    ])
    .filter((message): message is string => !!message)
    .join(' ');

const getQueueFingerprint = (item: RecoveryQueueItem): string =>
  [
    item.status,
    item.trackedDownloadStatus,
    item.trackedDownloadState,
    item.downloadClient,
    item.indexer,
    getQueueMessageText(item),
  ]
    .filter(Boolean)
    .join(' ');

const isProgressState = (item: RecoveryQueueItem): boolean => {
  const status = normalize(item.status);
  const trackedState = normalize(item.trackedDownloadState);

  return ['downloading', 'queued', 'paused', 'stalled'].some(
    (value) => status === value || trackedState === value
  );
};

class DownloadRecovery {
  private running = false;

  public status(): { running: boolean } {
    return { running: this.running };
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.debug('Download recovery already running. Skipping run.', {
        label: 'Download Recovery',
      });
      return;
    }

    this.running = true;

    try {
      const services = this.getServices();
      await Promise.all(
        services.map((service) => this.processService(service))
      );
    } finally {
      this.running = false;
    }
  }

  private getServices(): RecoveryService[] {
    const settings = getSettings();
    const services: RecoveryService[] = [];

    const radarrServers = uniqWith(settings.radarr, (a, b) =>
      this.isSameDvrServer(a, b)
    );
    for (const server of radarrServers) {
      if (!server.syncEnabled) {
        continue;
      }
      const radarr = new RadarrAPI({
        apiKey: server.apiKey,
        url: RadarrAPI.buildUrl(server, '/api/v3'),
      });
      services.push({
        serviceType: 'radarr',
        label: 'Radarr',
        server,
        api: radarr,
        getExternalId: (item) => item.movieId,
        search: (externalId) => radarr.searchMovie(externalId),
      });
    }

    const sonarrServers = uniqWith(settings.sonarr, (a, b) =>
      this.isSameDvrServer(a, b)
    );
    for (const server of sonarrServers) {
      if (!server.syncEnabled) {
        continue;
      }
      const sonarr = new SonarrAPI({
        apiKey: server.apiKey,
        url: SonarrAPI.buildUrl(server, '/api/v3'),
      });
      services.push({
        serviceType: 'sonarr',
        label: 'Sonarr',
        server,
        api: sonarr,
        getExternalId: (item) => item.seriesId,
        search: (externalId) => sonarr.searchSeries(externalId),
      });
    }

    const lidarrServers = uniqWith(settings.lidarr, (a, b) =>
      this.isSameDvrServer(a, b)
    );
    for (const server of lidarrServers) {
      if (!server.syncEnabled) {
        continue;
      }
      const lidarr = new LidarrAPI({
        apiKey: server.apiKey,
        url: LidarrAPI.buildUrl(server, '/api/v1'),
      });
      services.push({
        serviceType: 'lidarr',
        label: 'Lidarr',
        server,
        api: lidarr,
        getExternalId: (item) => item.albumId,
        search: (externalId) => lidarr.searchExistingAlbum(externalId),
      });
    }

    const readarrServers = uniqWith(settings.readarr, (a, b) =>
      isMatchingReadarrDownloadServer(a, b)
    );
    for (const server of readarrServers) {
      if (!server.syncEnabled) {
        continue;
      }
      const readarr = new ReadarrAPI({
        apiKey: server.apiKey,
        url: ReadarrAPI.buildUrl(server, '/api/v1'),
      });
      services.push({
        serviceType: 'readarr',
        label:
          (server as ReadarrSettings).serviceType === 'audiobook'
            ? 'Audiobookshelf/Readarr'
            : 'Bookshelf/Readarr',
        server,
        api: readarr,
        getExternalId: (item) => item.bookId ?? item.book?.id,
        search: (externalId) => readarr.searchBook(externalId),
      });
    }

    return services;
  }

  private isSameDvrServer(a: DVRSettings, b: DVRSettings): boolean {
    return (
      a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl
    );
  }

  private async processService(service: RecoveryService): Promise<void> {
    const stateRepository = getRepository(DownloadRecoveryState);

    try {
      await service.api.refreshMonitoredDownloads().catch((e) => {
        logger.debug('Unable to refresh monitored downloads before recovery.', {
          label: 'Download Recovery',
          service: service.label,
          server: service.server.name,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      });

      const queueItems = await service.api.getQueue();
      const activeDownloadIds = queueItems.map((item) => item.downloadId);

      await Promise.all(
        queueItems.map((item) => this.processQueueItem(service, item))
      );

      await stateRepository.delete({
        serviceType: service.serviceType,
        serviceId: service.server.id,
        updatedAt: LessThan(new Date(Date.now() - STALE_STATE_AFTER_MS)),
      });

      logger.debug('Download recovery checked service queue.', {
        label: 'Download Recovery',
        service: service.label,
        server: service.server.name,
        queueItems: queueItems.length,
        activeDownloadIds: activeDownloadIds.length,
      });
    } catch (e) {
      logger.warn('Download recovery failed to process service queue.', {
        label: 'Download Recovery',
        service: service.label,
        server: service.server.name,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async processQueueItem(
    service: RecoveryService,
    item: RecoveryQueueItem
  ): Promise<void> {
    const stateRepository = getRepository(DownloadRecoveryState);
    const externalServiceId = service.getExternalId(item);
    const sizeLeft = String(item.sizeleft ?? 0);
    const currentSizeLeft = Number(item.sizeleft ?? 0);
    const now = new Date();

    if (!item.downloadId || !externalServiceId) {
      return;
    }

    let state = await stateRepository.findOne({
      where: {
        serviceType: service.serviceType,
        serviceId: service.server.id,
        downloadId: item.downloadId,
      },
    });

    if (!state) {
      state = stateRepository.create({
        serviceType: service.serviceType,
        serviceId: service.server.id,
        externalServiceId,
        queueId: item.id,
        downloadId: item.downloadId,
        releaseTitle: item.title,
        lastSizeLeft: sizeLeft,
        lastProgressAt: now,
      });
      await stateRepository.save(state);
    } else {
      const previousSizeLeft = Number(state.lastSizeLeft);
      const sizeChanged =
        Number.isFinite(previousSizeLeft) &&
        previousSizeLeft !== currentSizeLeft;

      state.externalServiceId = externalServiceId;
      state.queueId = item.id;
      state.releaseTitle = item.title;
      state.lastSizeLeft = sizeLeft;

      if (sizeChanged) {
        state.lastProgressAt = now;
      }

      await stateRepository.save(state);
    }

    const decision = this.decide(item, state, now);

    if (decision.action === 'track') {
      return;
    }

    if (decision.action === 'ignore') {
      state.lastAction = 'ignored';
      state.lastReason = decision.reason;
      await stateRepository.save(state);
      return;
    }

    if (state.retryCount >= MAX_RETRIES_PER_DOWNLOAD) {
      state.lastAction = 'retry-limit';
      state.lastReason = decision.reason;
      await stateRepository.save(state);
      logger.warn('Download recovery retry limit reached.', {
        label: 'Download Recovery',
        service: service.label,
        server: service.server.name,
        title: item.title,
        downloadId: item.downloadId,
        reason: decision.reason,
      });
      return;
    }

    const recentRetryCount = await stateRepository.count({
      where: {
        serviceType: service.serviceType,
        serviceId: service.server.id,
        externalServiceId,
        lastAction: 'retried',
        updatedAt: MoreThan(new Date(Date.now() - STALE_STATE_AFTER_MS)),
      },
    });

    if (recentRetryCount >= MAX_RETRIES_PER_MEDIA) {
      state.lastAction = 'media-retry-limit';
      state.lastReason = decision.reason;
      await stateRepository.save(state);
      logger.warn('Download recovery media retry limit reached.', {
        label: 'Download Recovery',
        service: service.label,
        server: service.server.name,
        title: item.title,
        downloadId: item.downloadId,
        externalServiceId,
        reason: decision.reason,
      });
      return;
    }

    await service.api.deleteQueueItem(item.id, {
      removeFromClient: true,
      blocklist: true,
      skipRedownload: false,
    });
    await service.search(externalServiceId);

    state.retryCount += 1;
    state.lastAction = 'retried';
    state.lastReason = decision.reason;
    await stateRepository.save(state);

    logger.info('Download recovery retried queue item.', {
      label: 'Download Recovery',
      service: service.label,
      server: service.server.name,
      title: item.title,
      downloadId: item.downloadId,
      externalServiceId,
      reason: decision.reason,
      retryCount: state.retryCount,
    });
  }

  private decide(
    item: RecoveryQueueItem,
    state: DownloadRecoveryState,
    now: Date
  ): RecoveryDecision {
    const fingerprint = getQueueFingerprint(item);
    const trackedState = normalize(item.trackedDownloadState);
    const trackedStatus = normalize(item.trackedDownloadStatus);
    const status = normalize(item.status);

    if (trackedState === 'importfailed') {
      if (nonRetryableImportPattern.test(fingerprint)) {
        return {
          action: 'ignore',
          reason: 'import failed with a path, permission, or storage error',
        };
      }

      if (retryableFailurePattern.test(fingerprint)) {
        return {
          action: 'retry',
          reason: 'import failed with retryable error',
        };
      }

      return { action: 'track', reason: 'import failure is not classified' };
    }

    if (
      status === 'failed' ||
      trackedStatus === 'error' ||
      retryableFailurePattern.test(fingerprint)
    ) {
      return { action: 'retry', reason: 'download failed or was rejected' };
    }

    if (
      trackedStatus === 'warning' &&
      retryableFailurePattern.test(fingerprint)
    ) {
      return { action: 'retry', reason: 'download warning is retryable' };
    }

    const lastProgressAt = new Date(state.lastProgressAt).getTime();
    const stalledForMs = now.getTime() - lastProgressAt;

    if (isProgressState(item) && stalledForMs >= STALLED_AFTER_MS) {
      return {
        action: 'retry',
        reason: 'download made no progress for 2 hours',
      };
    }

    return { action: 'track' };
  }
}

const downloadRecovery = new DownloadRecovery();

export default downloadRecovery;
