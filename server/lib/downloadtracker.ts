import KapowarrAPI from '@server/api/comics/kapowarr';
import type { QueueItem, ServarrHistoryItem } from '@server/api/servarr/base';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  hasSameServarrServiceAuthority,
  runWithServarrServiceAdmission,
  type ServarrServiceAuthority,
  type ServarrServiceType,
} from '@server/lib/serviceAdmission';
import type { DVRSettings, ReadarrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { trackBackgroundTask } from '@server/utils/backgroundTasks';
import { mapWithConcurrency } from '@server/utils/concurrency';
import { MAX_SERVARR_INSTANCES_PER_TYPE } from '@server/utils/servarrSettings';
import { uniqWith } from 'lodash';

interface EpisodeNumberResult {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  id: number;
}

export const isMatchingReadarrDownloadServer = (
  serverA: {
    hostname: string;
    port: number;
    baseUrl?: string;
    serviceType?: 'ebook' | 'audiobook';
  },
  serverB: {
    hostname: string;
    port: number;
    baseUrl?: string;
    serviceType?: 'ebook' | 'audiobook';
  }
): boolean =>
  serverA.hostname === serverB.hostname &&
  serverA.port === serverB.port &&
  serverA.baseUrl === serverB.baseUrl &&
  (serverA.serviceType ?? 'ebook') === (serverB.serviceType ?? 'ebook');

export interface DownloadingItem {
  mediaType: MediaType;
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  timeLeft: string;
  estimatedCompletionTime: Date;
  title: string;
  downloadId: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  episode?: EpisodeNumberResult;
}

export type ServarrHistoryStage = 'grabbed' | 'imported' | 'failed';

export interface ServarrHistoryEvidence {
  stage: ServarrHistoryStage;
  observedAt: Date;
  downloadId?: string;
}

const getQueueState = (
  item: QueueItem
): Pick<DownloadingItem, 'trackedDownloadStatus' | 'trackedDownloadState'> => ({
  trackedDownloadStatus: item.trackedDownloadStatus,
  trackedDownloadState: item.trackedDownloadState,
});

export const DOWNLOAD_TRACKER_SERVER_CONCURRENCY = 5;

type DownloadTrackerServerSettings = DVRSettings &
  Partial<Pick<ReadarrSettings, 'serviceType'>>;

export const hasSameServarrDownloadAuthority = hasSameServarrServiceAuthority;

export class DownloadTracker {
  private static readonly monitoredRefreshCooldownMs = 5 * 60 * 1000;

  private radarrServers: Record<number, DownloadingItem[]> = {};
  private radarrHistory: Record<number, ServarrHistoryItem[]> = {};
  private sonarrServers: Record<number, DownloadingItem[]> = {};
  private sonarrHistory: Record<number, ServarrHistoryItem[]> = {};
  private lidarrServers: Record<number, DownloadingItem[]> = {};
  private lidarrHistory: Record<number, ServarrHistoryItem[]> = {};
  private readarrServers: Record<number, DownloadingItem[]> = {};
  private kapowarrServers: Record<number, DownloadingItem[]> = {};
  private monitoredRefreshes = new Set<string>();
  private lastMonitoredRefresh = new Map<string, number>();
  private activeUpdate?: Promise<void>;

  private runWithCurrentServarrDownloadServer<
    Server extends ServarrServiceAuthority,
    Result,
  >(
    serviceType: ServarrServiceType,
    server: Server,
    operation: () => Promise<Result>
  ): Promise<Result | undefined> {
    return runWithServarrServiceAdmission(
      [{ serviceType, serviceId: server.id }],
      async () => {
        const current = getExternalRuntimeConfig()[serviceType].find(
          (candidate) => candidate.id === server.id
        );
        if (
          !current ||
          !current.syncEnabled ||
          !hasSameServarrDownloadAuthority(current, server)
        ) {
          return undefined;
        }

        return operation();
      }
    );
  }

  private refreshMonitoredDownloads(
    key: string,
    serviceType: ServarrServiceType,
    server: DownloadTrackerServerSettings,
    refresh: () => Promise<void>,
    serverName: string
  ): void {
    const lastRefresh = this.lastMonitoredRefresh.get(key) ?? 0;

    if (Date.now() - lastRefresh < DownloadTracker.monitoredRefreshCooldownMs) {
      return;
    }

    if (this.monitoredRefreshes.has(key)) {
      return;
    }

    this.monitoredRefreshes.add(key);
    this.lastMonitoredRefresh.set(key, Date.now());
    trackBackgroundTask(
      `refresh monitored downloads for ${serverName}`,
      async () => {
        try {
          await this.runWithCurrentServarrDownloadServer(
            serviceType,
            server,
            refresh
          );
        } catch (e) {
          logger.debug(
            `Unable to refresh monitored downloads for server: ${serverName}`,
            {
              errorMessage: e instanceof Error ? e.message : String(e),
              label: 'Download Tracker',
            }
          );
        } finally {
          this.monitoredRefreshes.delete(key);
        }
      }
    );
  }

  private async loadHistory(
    serviceType: ServarrServiceType,
    server: DownloadTrackerServerSettings,
    api: { getHistory: () => Promise<ServarrHistoryItem[]> },
    serverName: string
  ): Promise<ServarrHistoryItem[] | undefined> {
    try {
      return await this.runWithCurrentServarrDownloadServer(
        serviceType,
        server,
        () => api.getHistory()
      );
    } catch (e) {
      logger.debug(`Unable to get history from server: ${serverName}`, {
        errorMessage: e instanceof Error ? e.message : String(e),
        label: 'Download Tracker',
      });
      return undefined;
    }
  }

  public getMovieProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.radarrServers[serverId]) {
      return [];
    }

    return this.radarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getSeriesProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.sonarrServers[serverId]) {
      return [];
    }

    return this.sonarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getMusicProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.lidarrServers[serverId]) {
      return [];
    }

    return this.lidarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  private getHistoryEvidence(
    history: Record<number, ServarrHistoryItem[]>,
    idField: 'movieId' | 'seriesId' | 'albumId',
    serverId: number,
    externalServiceId: number,
    since: Date
  ): ServarrHistoryEvidence | undefined {
    const sinceTime = since.getTime();
    if (!Number.isFinite(sinceTime)) {
      return undefined;
    }

    let evidence: ServarrHistoryEvidence | undefined;
    for (const item of history[serverId] ?? []) {
      if (item[idField] !== externalServiceId || !item.date) {
        continue;
      }
      const observedAt = new Date(item.date);
      if (
        Number.isNaN(observedAt.getTime()) ||
        observedAt.getTime() < sinceTime
      ) {
        continue;
      }

      const eventType = String(item.eventType ?? '')
        .trim()
        .toLocaleLowerCase();
      let stage: ServarrHistoryStage | undefined;
      if (
        eventType.includes('failed') ||
        eventType.includes('error') ||
        Number(item.eventType) === 4
      ) {
        stage = 'failed';
      } else if (
        eventType.includes('imported') ||
        eventType.includes('importcompleted') ||
        [3, 8].includes(Number(item.eventType))
      ) {
        stage = 'imported';
      } else if (eventType === 'grabbed' || Number(item.eventType) === 1) {
        stage = 'grabbed';
      }

      if (
        stage &&
        (!evidence || observedAt.getTime() > evidence.observedAt.getTime())
      ) {
        evidence = { stage, observedAt, downloadId: item.downloadId };
      }
    }

    return evidence;
  }

  public getMovieHistoryEvidence(
    serverId: number,
    externalServiceId: number,
    since: Date
  ): ServarrHistoryEvidence | undefined {
    return this.getHistoryEvidence(
      this.radarrHistory,
      'movieId',
      serverId,
      externalServiceId,
      since
    );
  }

  public getSeriesHistoryEvidence(
    serverId: number,
    externalServiceId: number,
    since: Date
  ): ServarrHistoryEvidence | undefined {
    return this.getHistoryEvidence(
      this.sonarrHistory,
      'seriesId',
      serverId,
      externalServiceId,
      since
    );
  }

  public getMusicHistoryEvidence(
    serverId: number,
    externalServiceId: number,
    since: Date
  ): ServarrHistoryEvidence | undefined {
    return this.getHistoryEvidence(
      this.lidarrHistory,
      'albumId',
      serverId,
      externalServiceId,
      since
    );
  }

  public getBookProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.readarrServers[serverId]) {
      return [];
    }

    return this.readarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getComicProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.kapowarrServers[serverId]) {
      return [];
    }

    return this.kapowarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public async resetDownloadTracker() {
    // A reset that races an update can otherwise be undone when the older
    // queue fetch writes its results after the reset. Drain that local update
    // first, then clear the snapshot and its refresh cooldowns.
    await this.activeUpdate?.catch(() => undefined);
    this.radarrServers = {};
    this.radarrHistory = {};
    this.sonarrServers = {};
    this.sonarrHistory = {};
    this.lidarrServers = {};
    this.lidarrHistory = {};
    this.readarrServers = {};
    this.kapowarrServers = {};
    this.lastMonitoredRefresh.clear();
  }

  public updateDownloads(): Promise<void> {
    if (this.activeUpdate) {
      return this.activeUpdate;
    }

    const update = Promise.all([
      this.updateRadarrDownloads(),
      this.updateSonarrDownloads(),
      this.updateLidarrDownloads(),
      this.updateReadarrDownloads(),
      this.updateKapowarrDownloads(),
    ])
      .then(() => undefined)
      .finally(() => {
        if (this.activeUpdate === update) {
          this.activeUpdate = undefined;
        }
      });
    this.activeUpdate = update;
    return update;
  }

  private async updateRadarrDownloads() {
    const settings = getExternalRuntimeConfig();

    // Remove duplicate servers
    const filteredServers = uniqWith(
      settings.radarr.slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      (radarrA, radarrB) => {
        return (
          radarrA.hostname === radarrB.hostname &&
          radarrA.port === radarrB.port &&
          radarrA.baseUrl === radarrB.baseUrl
        );
      }
    );

    // Load downloads from Radarr servers
    await mapWithConcurrency(
      filteredServers,
      DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
      async (server) => {
        if (server.syncEnabled) {
          const radarr = new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            this.refreshMonitoredDownloads(
              `radarr:${server.id}`,
              'radarr',
              server,
              () => radarr.refreshMonitoredDownloads(),
              server.name
            );
            const [queueItems, historyItems] = await Promise.all([
              this.runWithCurrentServarrDownloadServer('radarr', server, () =>
                radarr.getQueue()
              ),
              this.loadHistory('radarr', server, radarr, server.name),
            ]);
            if (!queueItems) {
              delete this.radarrServers[server.id];
              delete this.radarrHistory[server.id];
              return;
            }

            if (historyItems) {
              this.radarrHistory[server.id] = historyItems;
            }
            this.radarrServers[server.id] = queueItems.map((item) => ({
              externalId: item.movieId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.MOVIE,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
              downloadId: item.downloadId,
              ...getQueueState(item),
            }));

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Radarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch {
            logger.error(
              `Unable to get queue from Radarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
          }

          // Duplicate this data to matching servers
          const matchingServers = settings.radarr.filter(
            (rs) =>
              rs.hostname === server.hostname &&
              rs.port === server.port &&
              rs.baseUrl === server.baseUrl &&
              rs.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Radarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.radarrServers[ms.id] = this.radarrServers[server.id];
              this.radarrHistory[ms.id] = this.radarrHistory[server.id];
            }
          });
        }
      }
    );
  }

  private async updateSonarrDownloads() {
    const settings = getExternalRuntimeConfig();

    // Remove duplicate servers
    const filteredServers = uniqWith(
      settings.sonarr.slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      (sonarrA, sonarrB) => {
        return (
          sonarrA.hostname === sonarrB.hostname &&
          sonarrA.port === sonarrB.port &&
          sonarrA.baseUrl === sonarrB.baseUrl
        );
      }
    );

    // Load downloads from Sonarr servers
    await mapWithConcurrency(
      filteredServers,
      DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
      async (server) => {
        if (server.syncEnabled) {
          const sonarr = new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          });

          try {
            this.refreshMonitoredDownloads(
              `sonarr:${server.id}`,
              'sonarr',
              server,
              () => sonarr.refreshMonitoredDownloads(),
              server.name
            );
            const [queueItems, historyItems] = await Promise.all([
              this.runWithCurrentServarrDownloadServer('sonarr', server, () =>
                sonarr.getQueue()
              ),
              this.loadHistory('sonarr', server, sonarr, server.name),
            ]);
            if (!queueItems) {
              delete this.sonarrServers[server.id];
              delete this.sonarrHistory[server.id];
              return;
            }

            if (historyItems) {
              this.sonarrHistory[server.id] = historyItems;
            }
            this.sonarrServers[server.id] = queueItems.map((item) => ({
              externalId: item.seriesId,
              estimatedCompletionTime: new Date(item.estimatedCompletionTime),
              mediaType: MediaType.TV,
              size: item.size,
              sizeLeft: item.sizeleft,
              status: item.status,
              timeLeft: item.timeleft,
              title: item.title,
              episode: item.episode,
              downloadId: item.downloadId,
              ...getQueueState(item),
            }));

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Sonarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch {
            logger.error(
              `Unable to get queue from Sonarr server: ${server.name}`,
              {
                label: 'Download Tracker',
              }
            );
          }

          // Duplicate this data to matching servers
          const matchingServers = settings.sonarr.filter(
            (ss) =>
              ss.hostname === server.hostname &&
              ss.port === server.port &&
              ss.baseUrl === server.baseUrl &&
              ss.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Sonarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.sonarrServers[ms.id] = this.sonarrServers[server.id];
              this.sonarrHistory[ms.id] = this.sonarrHistory[server.id];
            }
          });
        }
      }
    );
  }

  private async updateLidarrDownloads() {
    const settings = getExternalRuntimeConfig();

    const filteredServers = uniqWith(
      settings.lidarr.slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      (lidarrA, lidarrB) => {
        return (
          lidarrA.hostname === lidarrB.hostname &&
          lidarrA.port === lidarrB.port &&
          lidarrA.baseUrl === lidarrB.baseUrl
        );
      }
    );

    await mapWithConcurrency(
      filteredServers,
      DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
      async (server) => {
        if (server.syncEnabled) {
          const lidarr = new LidarrAPI({
            apiKey: server.apiKey,
            url: LidarrAPI.buildUrl(server, '/api/v1'),
          });

          try {
            this.refreshMonitoredDownloads(
              `lidarr:${server.id}`,
              'lidarr',
              server,
              () => lidarr.refreshMonitoredDownloads(),
              server.name
            );
            const [queueItems, historyItems] = await Promise.all([
              this.runWithCurrentServarrDownloadServer('lidarr', server, () =>
                lidarr.getQueue()
              ),
              this.loadHistory('lidarr', server, lidarr, server.name),
            ]);
            if (!queueItems) {
              delete this.lidarrServers[server.id];
              delete this.lidarrHistory[server.id];
              return;
            }

            if (historyItems) {
              this.lidarrHistory[server.id] = historyItems;
            }
            this.lidarrServers[server.id] = queueItems
              .filter((item) => item.albumId !== undefined)
              .map((item) => ({
                externalId: item.albumId,
                estimatedCompletionTime: new Date(item.estimatedCompletionTime),
                mediaType: MediaType.MUSIC,
                size: item.size,
                sizeLeft: item.sizeleft,
                status: item.status,
                timeLeft: item.timeleft,
                title: item.title,
                downloadId: item.downloadId,
                ...getQueueState(item),
              }));

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Lidarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch (e) {
            logger.error(
              `Unable to get queue from Lidarr server: ${server.name}`,
              {
                errorMessage: e.message,
                label: 'Download Tracker',
              }
            );
          }

          const matchingServers = settings.lidarr.filter(
            (ls) =>
              ls.hostname === server.hostname &&
              ls.port === server.port &&
              ls.baseUrl === server.baseUrl &&
              ls.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Lidarr server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.lidarrServers[ms.id] = this.lidarrServers[server.id];
              this.lidarrHistory[ms.id] = this.lidarrHistory[server.id];
            }
          });
        }
      }
    );
  }

  private async updateKapowarrDownloads() {
    const settings = getExternalRuntimeConfig();

    const filteredServers = uniqWith(
      settings.kapowarr.slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      (kapowarrA, kapowarrB) => {
        return (
          kapowarrA.hostname === kapowarrB.hostname &&
          kapowarrA.port === kapowarrB.port &&
          kapowarrA.baseUrl === kapowarrB.baseUrl
        );
      }
    );

    await mapWithConcurrency(
      filteredServers,
      DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
      async (server) => {
        if (server.syncEnabled) {
          const kapowarr = new KapowarrAPI({
            apiKey: server.apiKey,
            url: KapowarrAPI.buildUrl(server),
          });

          try {
            const queueItems = await this.runWithCurrentServarrDownloadServer(
              'kapowarr',
              server,
              () => kapowarr.getQueue()
            );
            if (!queueItems) {
              delete this.kapowarrServers[server.id];
              return;
            }

            this.kapowarrServers[server.id] = queueItems.map((item) => {
              const sizeLeft = Math.round(
                item.size * (1 - item.progress / 100)
              );
              const etaSeconds = item.speed > 0 ? sizeLeft / item.speed : NaN;
              return {
                externalId: item.volumeId,
                estimatedCompletionTime: new Date(
                  Date.now() + etaSeconds * 1000
                ),
                mediaType: MediaType.COMIC,
                size: item.size,
                sizeLeft,
                status: item.status,
                timeLeft: 'unknown',
                title: item.title,
                downloadId: String(item.id),
              };
            });

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Kapowarr server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch (e) {
            logger.error(
              `Unable to get queue from Kapowarr server: ${server.name}`,
              {
                errorMessage: e.message,
                label: 'Download Tracker',
              }
            );
          }

          const matchingServers = settings.kapowarr.filter(
            (ks) =>
              ks.hostname === server.hostname &&
              ks.port === server.port &&
              ks.baseUrl === server.baseUrl &&
              ks.id !== server.id
          );

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.kapowarrServers[ms.id] = this.kapowarrServers[server.id];
            }
          });
        }
      }
    );
  }

  private async updateReadarrDownloads() {
    const settings = getExternalRuntimeConfig();

    const filteredServers = uniqWith(
      settings.readarr.slice(0, MAX_SERVARR_INSTANCES_PER_TYPE),
      (readarrA, readarrB) =>
        isMatchingReadarrDownloadServer(readarrA, readarrB)
    );

    await mapWithConcurrency(
      filteredServers,
      DOWNLOAD_TRACKER_SERVER_CONCURRENCY,
      async (server) => {
        if (server.syncEnabled) {
          const readarr = new ReadarrAPI({
            apiKey: server.apiKey,
            url: ReadarrAPI.buildUrl(server, '/api/v1'),
            mediaType: server.serviceType ?? 'ebook',
          });

          try {
            this.refreshMonitoredDownloads(
              `readarr:${server.id}`,
              'readarr',
              server,
              () => readarr.refreshMonitoredDownloads(),
              server.name
            );
            const queueItems = await this.runWithCurrentServarrDownloadServer(
              'readarr',
              server,
              () => readarr.getQueue()
            );
            if (!queueItems) {
              delete this.readarrServers[server.id];
              return;
            }

            this.readarrServers[server.id] = queueItems
              .map((item) => ({
                item,
                bookId: item.bookId ?? item.book?.id,
              }))
              .filter(
                (
                  queueItem
                ): queueItem is typeof queueItem & { bookId: number } =>
                  queueItem.bookId !== undefined
              )
              .map(({ item, bookId }) => ({
                externalId: bookId,
                estimatedCompletionTime: new Date(item.estimatedCompletionTime),
                mediaType: MediaType.BOOK,
                size: item.size,
                sizeLeft: item.sizeleft,
                status: item.status,
                timeLeft: item.timeleft,
                title: item.title,
                downloadId: item.downloadId,
                ...getQueueState(item),
              }));

            if (queueItems.length > 0) {
              logger.debug(
                `Found ${queueItems.length} item(s) in progress on Bookshelf server: ${server.name}`,
                { label: 'Download Tracker' }
              );
            }
          } catch (e) {
            logger.error(
              `Unable to get queue from Bookshelf server: ${server.name}`,
              {
                errorMessage: e.message,
                label: 'Download Tracker',
              }
            );
          }

          const matchingServers = settings.readarr.filter(
            (rs) =>
              isMatchingReadarrDownloadServer(rs, server) && rs.id !== server.id
          );

          if (matchingServers.length > 0) {
            logger.debug(
              `Matching download data to ${matchingServers.length} other Bookshelf server(s)`,
              { label: 'Download Tracker' }
            );
          }

          matchingServers.forEach((ms) => {
            if (ms.syncEnabled) {
              this.readarrServers[ms.id] = this.readarrServers[server.id];
            }
          });
        }
      }
    );
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
