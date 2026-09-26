import KapowarrAPI from '@server/api/comics/kapowarr';
import MylarAPI from '@server/api/comics/mylar';
import LazyLibrarianAPI from '@server/api/lazylibrarian';
import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import type { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import downloadTracker from '@server/lib/downloadtracker';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import { restrictMediaRelationsForUser } from '@server/lib/mediaResponse';
import { hydrateMediaSummaryRelations } from '@server/lib/mediaSummaryHydration';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import { getHostname } from '@server/utils/getHostname';
import {
  AfterLoad,
  Column,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import Issue from './Issue';
import MediaIdentifier from './MediaIdentifier';
import { MediaRequest } from './MediaRequest';
import { MediaSearchMetadata } from './MediaSearchMetadata';
import Season from './Season';

@Entity()
@Index(['tmdbId', 'mediaType'])
@Index('IDX_media_mbId', ['mbId'])
@Index('UQ_media_screen_tmdb_type', ['tmdbId', 'mediaType'], {
  unique: true,
  where: `"mediaType" IN ('movie', 'tv') AND "tmdbId" > 0`,
})
@Index('UQ_media_music_mbid', ['mbId'], {
  unique: true,
  where: `"mediaType" = 'music' AND "mbId" IS NOT NULL`,
})
class Media {
  public hasActiveRequest?: boolean;

  public static async getRelatedMedia(
    user: User | undefined,
    items: { tmdbId: number; mediaType: string }[] | number[] | string[],
    { includeActiveRequest = false }: { includeActiveRequest?: boolean } = {}
  ): Promise<Media[]> {
    const mediaRepository = getRepository(Media);

    try {
      if (items.length === 0) {
        return [];
      }

      const firstItem = items[0];
      const isLegacyItem = typeof firstItem === 'object';
      const ids = isLegacyItem
        ? (items as { tmdbId: number; mediaType: string }[]).map(
            (i) => i.tmdbId
          )
        : (items as (number | string)[]);
      const isMusicIdLookup = typeof ids[0] === 'string';
      const finalIds = [
        ...new Set<number | string>(
          isMusicIdLookup ? (ids as string[]).map(normalizeMusicBrainzId) : ids
        ),
      ];

      const media = await mediaRepository
        .createQueryBuilder('media')
        .leftJoinAndSelect(
          'media.watchlists',
          'watchlist',
          'media.id= watchlist.media and watchlist.requestedBy = :userId',
          { userId: user?.id }
        )
        .where(
          isMusicIdLookup
            ? 'media.mbId in (:...finalIds)'
            : 'media.tmdbId in (:...finalIds)',
          { finalIds }
        )
        .getMany();

      const restrictedMedia = media.map(
        (item) => restrictMediaRelationsForUser(item, user) as Media
      );

      const relatedMedia = !isLegacyItem
        ? restrictedMedia
        : restrictedMedia.filter((m) =>
            (items as { tmdbId: number; mediaType: string }[]).some(
              (i) => i.tmdbId === m.tmdbId && i.mediaType === m.mediaType
            )
          );

      if (
        includeActiveRequest &&
        getSettings().main.hideRequested &&
        relatedMedia.length > 0
      ) {
        const activeRequestMediaIds = await mediaRepository
          .createQueryBuilder('media')
          .select('media.id', 'id')
          .distinct(true)
          .innerJoin('media.requests', 'request')
          .where('media.id IN (:...mediaIds)', {
            mediaIds: relatedMedia.map((m) => m.id),
          })
          .andWhere('request.status IN (:...statuses)', {
            statuses: [MediaRequestStatus.PENDING, MediaRequestStatus.APPROVED],
          })
          .getRawMany<{ id: number }>();

        const activeIds = new Set(activeRequestMediaIds.map((row) => row.id));

        relatedMedia.forEach((m) => {
          m.hasActiveRequest = activeIds.has(m.id);
        });
      }

      return relatedMedia;
    } catch (e) {
      logger.error(e.message);
      return [];
    }
  }

  public static async getMedia(
    id: number,
    mediaType: MediaType,
    user?: User
  ): Promise<Media | undefined> {
    const mediaRepository = getRepository(Media);

    try {
      const media = await mediaRepository.findOne({
        where: { tmdbId: id, mediaType: mediaType },
        relations: {
          issues: {
            createdBy: true,
            modifiedBy: true,
            comments: { user: true },
          },
        },
        relationLoadStrategy: 'query',
      });

      if (media) {
        await hydrateMediaSummaryRelations([media], user, {
          includeRequestSeasons: mediaType === MediaType.TV,
        });
      }

      return media ?? undefined;
    } catch (e) {
      logger.error(e.message);
      return undefined;
    }
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column()
  @Index()
  public tmdbId: number;

  @Column({ unique: true, nullable: true })
  @Index()
  public tvdbId?: number;

  @Column({ nullable: true })
  @Index()
  public imdbId?: string;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  @Index()
  public status: MediaStatus;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  @Index()
  public status4k: MediaStatus;

  @OneToMany(() => MediaRequest, (request) => request.media, {
    cascade: ['insert', 'remove'],
  })
  public requests: MediaRequest[];

  @OneToMany(() => Watchlist, (watchlist) => watchlist.media)
  public watchlists: null | Watchlist[];

  @OneToMany(() => Season, (season) => season.media, {
    cascade: true,
    eager: true,
  })
  public seasons: Season[];

  @OneToMany(() => Issue, (issue) => issue.media, { cascade: true })
  public issues: Issue[];

  @OneToMany(() => MediaIdentifier, (identifier) => identifier.media, {
    cascade: true,
  })
  public identifiers: MediaIdentifier[];

  @OneToOne(() => Blocklist, (blocklist) => blocklist.media)
  public blocklist: Promise<Blocklist>;

  @OneToOne(() => MediaSearchMetadata, (metadata) => metadata.media)
  public searchMetadata?: MediaSearchMetadata;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  /**
   * The `lastSeasonChange` column stores the date and time when the media was added to the library.
   * It needs to be database-aware because SQLite supports `datetime` while PostgreSQL supports `timestamp with timezone (timestampz)`.
   */
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public lastSeasonChange: Date;

  /**
   * The `mediaAddedAt` column stores the date and time when the media was added to the library.
   * It needs to be database-aware because SQLite supports `datetime` while PostgreSQL supports `timestamp with timezone (timestampz)`.
   * This column is nullable because it can be null when the media is not yet synced to the library.
   */
  @DbAwareColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    nullable: true,
  })
  public mediaAddedAt: Date;

  @Column({ nullable: true, type: 'int' })
  public serviceId?: number | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): number[] | null => {
        if (value === null) {
          return null;
        }
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed)
            ? [
                ...new Set(
                  parsed.filter(
                    (serverId): serverId is number =>
                      Number.isSafeInteger(serverId) && serverId >= 0
                  )
                ),
              ]
            : [];
        } catch {
          return [];
        }
      },
      to: (value: number[] | null | undefined): string | null =>
        value === null || value === undefined
          ? null
          : JSON.stringify(
              [...new Set(value)].filter(
                (serverId) => Number.isSafeInteger(serverId) && serverId >= 0
              )
            ),
    },
  })
  public availableMusicServiceIds?: number[] | null;

  @Column({ nullable: true, type: 'int' })
  public serviceId4k?: number | null;

  @Column({ nullable: true, type: 'int' })
  public externalServiceId?: number | null;

  @Column({ nullable: true, type: 'int' })
  public externalServiceId4k?: number | null;

  @Column({ nullable: true, type: 'varchar' })
  public externalServiceSlug?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public externalServiceSlug4k?: string | null;

  @Column({ nullable: true, type: 'int' })
  public audiobookServiceId?: number | null;

  @Column({ nullable: true, type: 'int' })
  public audiobookExternalServiceId?: number | null;

  @Column({ nullable: true, type: 'varchar' })
  public audiobookExternalServiceSlug?: string | null;

  // Comics reuse the generic serviceId/externalServiceId/externalServiceSlug
  // columns above (like MOVIE/TV/MUSIC do) rather than needing their own set,
  // since a comic only ever has one destination. This column exists purely to
  // disambiguate which settings array serviceId indexes into, since comics
  // can be fulfilled by either a Mylar or a Kapowarr instance.
  @Column({ nullable: true, type: 'varchar' })
  public comicServiceType?: 'mylar' | 'kapowarr' | null;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKey?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKey4k?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKeyMp3?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public ratingKeyFlac?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public jellyfinMediaId?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public jellyfinMediaId4k?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public jellyfinMediaIdMp3?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public jellyfinMediaIdFlac?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public mbId?: string | null;

  public serviceUrl?: string;
  public serviceUrl4k?: string;
  public audiobookServiceUrl?: string;
  public downloadStatus?: DownloadingItem[] = [];
  public downloadStatus4k?: DownloadingItem[] = [];
  public audiobookDownloadStatus?: DownloadingItem[] = [];

  public mediaUrl?: string;
  public mediaUrl4k?: string;

  public iOSPlexUrl?: string;
  public iOSPlexUrl4k?: string;

  public tautulliUrl?: string;
  public tautulliUrl4k?: string;

  constructor(init?: Partial<Media>) {
    Object.assign(this, init);
  }

  public resetServiceDataForResolution(is4k: boolean): void {
    if (is4k) {
      this.serviceId4k = null;
      this.externalServiceId4k = null;
      this.externalServiceSlug4k = null;
      this.ratingKey4k = null;
      this.jellyfinMediaId4k = null;
      return;
    }

    this.serviceId = null;
    this.availableMusicServiceIds = null;
    this.externalServiceId = null;
    this.externalServiceSlug = null;
    this.comicServiceType = null;
    this.ratingKey = null;
    this.jellyfinMediaId = null;
    this.ratingKeyMp3 = null;
    this.ratingKeyFlac = null;
    this.jellyfinMediaIdMp3 = null;
    this.jellyfinMediaIdFlac = null;
  }

  public resetServiceData(): void {
    this.resetServiceDataForResolution(false);
    this.resetServiceDataForResolution(true);
    this.audiobookServiceId = null;
    this.audiobookExternalServiceId = null;
    this.audiobookExternalServiceSlug = null;
  }

  @AfterLoad()
  public setPlexUrls(): void {
    const { machineId, webAppUrl } = getSettings().plex;
    const { externalUrl: tautulliUrl } = getSettings().tautulli;

    if (getSettings().main.mediaServerType == MediaServerType.PLEX) {
      if (this.ratingKey) {
        this.mediaUrl = `${
          webAppUrl ? webAppUrl : 'https://app.plex.tv/desktop'
        }#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${
          this.ratingKey
        }`;

        this.iOSPlexUrl = `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${this.ratingKey}&server=${machineId}`;

        if (tautulliUrl) {
          this.tautulliUrl = `${tautulliUrl}/info?rating_key=${this.ratingKey}`;
        }
      }

      if (this.ratingKey4k) {
        this.mediaUrl4k = `${
          webAppUrl ? webAppUrl : 'https://app.plex.tv/desktop'
        }#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${
          this.ratingKey4k
        }`;

        this.iOSPlexUrl4k = `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${this.ratingKey4k}&server=${machineId}`;

        if (tautulliUrl) {
          this.tautulliUrl4k = `${tautulliUrl}/info?rating_key=${this.ratingKey4k}`;
        }
      }
    } else {
      const pageName =
        getSettings().main.mediaServerType == MediaServerType.EMBY
          ? 'item'
          : 'details';
      const { serverId, externalHostname } = getSettings().jellyfin;
      const jellyfinHost =
        externalHostname && externalHostname.length > 0
          ? externalHostname
          : getHostname();

      if (this.jellyfinMediaId) {
        this.mediaUrl = `${jellyfinHost}/web/index.html#!/${pageName}?id=${this.jellyfinMediaId}&context=home&serverId=${serverId}`;
      }
      if (this.jellyfinMediaId4k) {
        this.mediaUrl4k = `${jellyfinHost}/web/index.html#!/${pageName}?id=${this.jellyfinMediaId4k}&context=home&serverId=${serverId}`;
      }
    }
  }

  @AfterLoad()
  public setServiceUrl(): void {
    if (this.mediaType === MediaType.MOVIE) {
      if (this.serviceId !== null && this.externalServiceSlug !== null) {
        const settings = getSettings();
        const server = settings.radarr.find(
          (radarr) => radarr.id === this.serviceId
        );

        if (server) {
          this.serviceUrl = server.externalUrl
            ? `${server.externalUrl}/movie/${this.externalServiceSlug}`
            : RadarrAPI.buildUrl(server, `/movie/${this.externalServiceSlug}`);
        }
      }

      if (this.serviceId4k !== null && this.externalServiceSlug4k !== null) {
        const settings = getSettings();
        const server = settings.radarr.find(
          (radarr) => radarr.id === this.serviceId4k
        );

        if (server) {
          this.serviceUrl4k = server.externalUrl
            ? `${server.externalUrl}/movie/${this.externalServiceSlug4k}`
            : RadarrAPI.buildUrl(
                server,
                `/movie/${this.externalServiceSlug4k}`
              );
        }
      }
    }

    if (this.mediaType === MediaType.TV) {
      if (this.serviceId !== null && this.externalServiceSlug !== null) {
        const settings = getSettings();
        const server = settings.sonarr.find(
          (sonarr) => sonarr.id === this.serviceId
        );

        if (server) {
          this.serviceUrl = server.externalUrl
            ? `${server.externalUrl}/series/${this.externalServiceSlug}`
            : SonarrAPI.buildUrl(server, `/series/${this.externalServiceSlug}`);
        }
      }

      if (this.serviceId4k !== null && this.externalServiceSlug4k !== null) {
        const settings = getSettings();
        const server = settings.sonarr.find(
          (sonarr) => sonarr.id === this.serviceId4k
        );

        if (server) {
          this.serviceUrl4k = server.externalUrl
            ? `${server.externalUrl}/series/${this.externalServiceSlug4k}`
            : SonarrAPI.buildUrl(
                server,
                `/series/${this.externalServiceSlug4k}`
              );
        }
      }
    }

    if (this.mediaType === MediaType.MUSIC) {
      if (this.serviceId !== null && this.externalServiceSlug !== null) {
        const settings = getSettings();
        const server = settings.lidarr.find(
          (lidarr) => lidarr.id === this.serviceId
        );

        if (server) {
          this.serviceUrl = server.externalUrl
            ? `${server.externalUrl}/album/${this.externalServiceSlug}`
            : LidarrAPI.buildUrl(server, `/album/${this.externalServiceSlug}`);
        }
      }
    }

    if (this.mediaType === MediaType.BOOK) {
      if (this.serviceId !== null && this.externalServiceSlug !== null) {
        const settings = getSettings();
        const server = settings.readarr.find(
          (readarr) => readarr.id === this.serviceId
        );

        if (server) {
          const mediaType = server.serviceType ?? 'ebook';
          this.serviceUrl = server.externalUrl
            ? `${server.externalUrl}/book/${this.externalServiceSlug}?mediaType=${mediaType}`
            : ReadarrAPI.buildUrl(
                server,
                `/book/${this.externalServiceSlug}?mediaType=${mediaType}`
              );
        }
      }

      if (
        this.audiobookServiceId !== null &&
        this.audiobookExternalServiceSlug !== null
      ) {
        const settings = getSettings();
        const server = settings.readarr.find(
          (readarr) => readarr.id === this.audiobookServiceId
        );

        if (server) {
          const mediaType = server.serviceType ?? 'audiobook';
          this.audiobookServiceUrl = server.externalUrl
            ? `${server.externalUrl}/book/${this.audiobookExternalServiceSlug}?mediaType=${mediaType}`
            : ReadarrAPI.buildUrl(
                server,
                `/book/${this.audiobookExternalServiceSlug}?mediaType=${mediaType}`
              );
        }
      }
    }

    if (this.mediaType === MediaType.COMIC) {
      if (this.serviceId !== null && this.externalServiceSlug !== null) {
        const settings = getSettings();

        if (this.comicServiceType === 'kapowarr') {
          const server = settings.kapowarr.find(
            (kapowarr) => kapowarr.id === this.serviceId
          );
          if (server) {
            this.serviceUrl = server.externalUrl
              ? `${server.externalUrl}/volumes/${this.externalServiceSlug}`
              : KapowarrAPI.buildUrl(
                  server,
                  `/volumes/${this.externalServiceSlug}`
                );
          }
        } else {
          const server = settings.mylar.find(
            (mylar) => mylar.id === this.serviceId
          );
          if (server) {
            this.serviceUrl = server.externalUrl
              ? `${server.externalUrl}/comicDetails?ComicID=${this.externalServiceSlug}`
              : MylarAPI.buildUrl(
                  server,
                  `/comicDetails?ComicID=${this.externalServiceSlug}`
                );
          }
        }
      }
    }

    if (this.mediaType === MediaType.MAGAZINE && this.serviceId != null) {
      const server = getSettings().lazylibrarian.find(
        (lazylibrarian) => lazylibrarian.id === this.serviceId
      );
      if (server) {
        this.serviceUrl =
          server.externalUrl ?? LazyLibrarianAPI.buildUrl(server);
      }
    }
  }

  @AfterLoad()
  public getDownloadingItem(): void {
    if (this.mediaType === MediaType.MOVIE) {
      if (
        this.externalServiceId !== undefined &&
        this.externalServiceId !== null &&
        this.serviceId !== undefined &&
        this.serviceId !== null
      ) {
        this.downloadStatus = downloadTracker.getMovieProgress(
          this.serviceId,
          this.externalServiceId
        );
      }

      if (
        this.externalServiceId4k !== undefined &&
        this.externalServiceId4k !== null &&
        this.serviceId4k !== undefined &&
        this.serviceId4k !== null
      ) {
        this.downloadStatus4k = downloadTracker.getMovieProgress(
          this.serviceId4k,
          this.externalServiceId4k
        );
      }
    }

    if (this.mediaType === MediaType.TV) {
      if (
        this.externalServiceId !== undefined &&
        this.externalServiceId !== null &&
        this.serviceId !== undefined &&
        this.serviceId !== null
      ) {
        this.downloadStatus = downloadTracker.getSeriesProgress(
          this.serviceId,
          this.externalServiceId
        );
      }

      if (
        this.externalServiceId4k !== undefined &&
        this.externalServiceId4k !== null &&
        this.serviceId4k !== undefined &&
        this.serviceId4k !== null
      ) {
        this.downloadStatus4k = downloadTracker.getSeriesProgress(
          this.serviceId4k,
          this.externalServiceId4k
        );
      }
    }

    if (this.mediaType === MediaType.MUSIC) {
      if (
        this.externalServiceId !== undefined &&
        this.externalServiceId !== null &&
        this.serviceId !== undefined &&
        this.serviceId !== null
      ) {
        this.downloadStatus = downloadTracker.getMusicProgress(
          this.serviceId,
          this.externalServiceId
        );
      }
    }

    if (this.mediaType === MediaType.BOOK) {
      if (
        this.externalServiceId !== undefined &&
        this.externalServiceId !== null &&
        this.serviceId !== undefined &&
        this.serviceId !== null
      ) {
        this.downloadStatus = downloadTracker.getBookProgress(
          this.serviceId,
          this.externalServiceId
        );
      }

      if (
        this.audiobookExternalServiceId !== undefined &&
        this.audiobookExternalServiceId !== null &&
        this.audiobookServiceId !== undefined &&
        this.audiobookServiceId !== null
      ) {
        this.audiobookDownloadStatus = downloadTracker.getBookProgress(
          this.audiobookServiceId,
          this.audiobookExternalServiceId
        );
      }
    }

    if (
      this.mediaType === MediaType.COMIC &&
      this.comicServiceType === 'kapowarr' &&
      this.externalServiceId !== undefined &&
      this.externalServiceId !== null &&
      this.serviceId !== undefined &&
      this.serviceId !== null
    ) {
      this.downloadStatus = downloadTracker.getComicProgress(
        this.serviceId,
        this.externalServiceId
      );
    }
  }
}

export default Media;
