import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { uniqWith } from 'lodash';

type SyncStatus = StatusBase & {
  currentServer: LidarrSettings;
  servers: LidarrSettings[];
};

class LidarrScanner
  extends BaseScanner<LidarrAlbum>
  implements RunnableScanner<SyncStatus>
{
  private servers: LidarrSettings[];
  private currentServer: LidarrSettings;
  private lidarrApi: LidarrAPI;
  private scannedMbIds: Set<string> = new Set();
  private didScan = false;

  constructor() {
    super('Lidarr Scan', { bundleSize: 50 });
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
      currentServer: this.currentServer,
      servers: this.servers,
    };
  }

  public async run(): Promise<void> {
    const settings = getSettings();
    const sessionId = this.startRun();
    this.scannedMbIds.clear();
    this.didScan = false;

    try {
      this.servers = uniqWith(settings.lidarr, (lidarrA, lidarrB) => {
        return (
          lidarrA.hostname === lidarrB.hostname &&
          lidarrA.port === lidarrB.port &&
          lidarrA.baseUrl === lidarrB.baseUrl
        );
      });

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Lidarr server: ${server.name}`,
            'info'
          );

          this.lidarrApi = new LidarrAPI({
            apiKey: server.apiKey,
            url: LidarrAPI.buildUrl(server, '/api/v1'),
          });

          this.items = await this.lidarrApi.getAlbums();
          this.didScan = true;
          await this.loop(this.processLidarrAlbum.bind(this), { sessionId });
        } else {
          this.log(`Sync not enabled. Skipping Lidarr server: ${server.name}`);
        }
      }

      if (!this.servers.every((server) => server.syncEnabled)) {
        this.didScan = false;
      }

      await this.cleanupOrphanedAlbums();
      this.log('Lidarr scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processLidarrAlbum(lidarrAlbum: LidarrAlbum): Promise<void> {
    try {
      const mbId = lidarrAlbum.foreignAlbumId
        ? normalizeMusicBrainzId(lidarrAlbum.foreignAlbumId)
        : undefined;
      if (!mbId) {
        this.log(
          'No MusicBrainz ID found for this title. Skipping item.',
          'debug',
          {
            title: lidarrAlbum.title,
          }
        );
        return;
      }

      this.scannedMbIds.add(mbId);

      if (!lidarrAlbum.monitored) {
        await this.processMusic(mbId, {
          serviceId: this.currentServer.id,
          externalServiceId: lidarrAlbum.id,
          externalServiceSlug: mbId,
          title: lidarrAlbum.title,
          processing: false,
          hasFile: false,
        });
        return;
      }

      await this.processMusic(mbId, {
        serviceId: this.currentServer.id,
        externalServiceId: lidarrAlbum.id,
        externalServiceSlug: mbId,
        title: lidarrAlbum.title,
        processing:
          lidarrAlbum.monitored &&
          (!lidarrAlbum.statistics ||
            lidarrAlbum.statistics.trackFileCount <
              lidarrAlbum.statistics.totalTrackCount),
      });
    } catch (e) {
      this.log('Failed to process Lidarr media', 'error', {
        errorMessage: e.message,
        title: lidarrAlbum.title,
      });
    }
  }

  private async cleanupOrphanedAlbums(): Promise<void> {
    const mediaRepository = getRepository(Media);

    if (!this.didScan) {
      this.log(
        'Skipping orphaned album cleanup: not all Lidarr servers were scanned.',
        'info'
      );
      return;
    }

    const processingAlbums = await mediaRepository.find({
      where: { mediaType: MediaType.MUSIC, status: MediaStatus.PROCESSING },
    });

    for (const media of processingAlbums) {
      if (media.mbId && !this.scannedMbIds.has(media.mbId)) {
        media.status = MediaStatus.UNKNOWN;
        await mediaRepository.save(media);
        this.log(
          `Album ${media.mbId} not found in any Lidarr server. Status reset to UNKNOWN.`,
          'info'
        );
      }
    }
  }
}

export const lidarrScanner = new LidarrScanner();
