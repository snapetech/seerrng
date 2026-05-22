import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ZodNumber, ZodOptional, ZodString } from 'zod';

export class DuplicateWatchlistRequestError extends Error {}
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

@Entity()
@Unique('UNIQUE_USER_DB', ['tmdbId', 'mediaType', 'requestedBy'])
@Unique('UNIQUE_USER_MUSIC', ['mbId', 'requestedBy'])
@Unique('UNIQUE_USER_BOOK', ['externalId', 'requestedBy'])
export class Watchlist {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  public ratingKey = '';

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'varchar' })
  title = '';

  @Column({ nullable: true })
  @Index()
  public tmdbId?: number;

  @Column({ nullable: true, type: 'varchar' })
  @Index()
  public mbId?: string;

  @Column({ nullable: true, type: 'varchar' })
  @Index()
  public externalId?: string;

  @ManyToOne(() => User, (user) => user.watchlists, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => Media, (media) => media.watchlists, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Watchlist>) {
    Object.assign(this, init);
  }

  public static async createWatchlist({
    watchlistRequest,
    user,
  }: {
    watchlistRequest: {
      mediaType: MediaType;
      ratingKey?: ZodOptional<ZodString>['_output'];
      title?: ZodOptional<ZodString>['_output'];
      tmdbId?: ZodNumber['_output'];
      mbId?: ZodOptional<ZodString>['_output'];
      externalId?: ZodOptional<ZodString>['_output'];
    };
    user: User;
  }): Promise<Watchlist> {
    const watchlistRepository = getRepository(this);
    const mediaRepository = getRepository(Media);
    const tmdb = new TheMovieDb();
    watchlistRequest = {
      ...watchlistRequest,
      mbId: watchlistRequest.mbId
        ? normalizeMusicBrainzId(watchlistRequest.mbId)
        : undefined,
      externalId: watchlistRequest.externalId
        ? normalizeOpenLibraryWorkId(watchlistRequest.externalId)
        : undefined,
    };

    if (watchlistRequest.mediaType === MediaType.MUSIC) {
      if (!watchlistRequest.mbId) {
        throw new Error('MusicBrainz ID is required for music watchlists.');
      }

      const existing = await watchlistRepository.findOne({
        where: {
          mbId: watchlistRequest.mbId,
          mediaType: MediaType.MUSIC,
          requestedBy: { id: user.id },
        },
      });

      if (existing) {
        logger.warn('Duplicate request for watchlist blocked', {
          mbId: watchlistRequest.mbId,
          mediaType: watchlistRequest.mediaType,
          label: 'Watchlist',
        });

        throw new DuplicateWatchlistRequestError();
      }

      const listenBrainz = new ListenBrainzAPI();
      const album = await listenBrainz.getAlbum(watchlistRequest.mbId);
      const title =
        watchlistRequest.title ??
        album.release_group_metadata.release_group.name;

      let media = await mediaRepository.findOne({
        where: {
          mbId: watchlistRequest.mbId,
          mediaType: MediaType.MUSIC,
        },
      });

      if (!media) {
        media = new Media({
          tmdbId: 0,
          mbId: watchlistRequest.mbId,
          mediaType: MediaType.MUSIC,
        });
      }

      const watchlist = new this({
        ...watchlistRequest,
        title,
        requestedBy: user,
        media,
      });

      await mediaRepository.save(media);
      await watchlistRepository.save(watchlist);
      await this.requestMusicFromWatchlist(watchlistRequest.mbId, user);
      return watchlist;
    }

    if (watchlistRequest.mediaType === MediaType.BOOK) {
      if (!watchlistRequest.externalId) {
        throw new Error('Open Library ID is required for book watchlists.');
      }

      const existing = await watchlistRepository.findOne({
        where: {
          externalId: watchlistRequest.externalId,
          mediaType: MediaType.BOOK,
          requestedBy: { id: user.id },
        },
      });

      if (existing) {
        logger.warn('Duplicate request for watchlist blocked', {
          externalId: watchlistRequest.externalId,
          mediaType: watchlistRequest.mediaType,
          label: 'Watchlist',
        });

        throw new DuplicateWatchlistRequestError();
      }

      const openLibrary = new OpenLibraryAPI();
      const work = await openLibrary.getWork(watchlistRequest.externalId);
      const title = watchlistRequest.title ?? work.title;
      const identifierRepository = getRepository(MediaIdentifier);
      const identifier = await identifierRepository.findOne({
        where: {
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: watchlistRequest.externalId,
        },
        relations: { media: true },
      });
      let media =
        identifier?.media.mediaType === MediaType.BOOK
          ? identifier.media
          : undefined;

      if (!media) {
        media = await mediaRepository.save(
          new Media({
            tmdbId: 0,
            mediaType: MediaType.BOOK,
          })
        );
        await identifierRepository.save(
          new MediaIdentifier({
            media,
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: watchlistRequest.externalId,
            canonical: true,
          })
        );
      }

      const watchlist = new this({
        ...watchlistRequest,
        title,
        requestedBy: user,
        media,
      });

      await watchlistRepository.save(watchlist);
      await this.requestBookFromWatchlist(watchlistRequest.externalId, user);
      return watchlist;
    }

    if (!watchlistRequest.tmdbId) {
      throw new Error('TMDB ID is required for movie and series watchlists.');
    }

    const tmdbMedia =
      watchlistRequest.mediaType === MediaType.MOVIE
        ? await tmdb.getMovie({ movieId: watchlistRequest.tmdbId })
        : await tmdb.getTvShow({ tvId: watchlistRequest.tmdbId });

    const existing = await watchlistRepository
      .createQueryBuilder('watchlist')
      .leftJoinAndSelect('watchlist.requestedBy', 'user')
      .where('user.id = :userId', { userId: user.id })
      .andWhere('watchlist.tmdbId = :tmdbId', {
        tmdbId: watchlistRequest.tmdbId,
      })
      .andWhere('watchlist.mediaType = :mediaType', {
        mediaType: watchlistRequest.mediaType,
      })
      .getMany();

    if (existing && existing.length > 0) {
      logger.warn('Duplicate request for watchlist blocked', {
        tmdbId: watchlistRequest.tmdbId,
        mediaType: watchlistRequest.mediaType,
        label: 'Watchlist',
      });

      throw new DuplicateWatchlistRequestError();
    }

    let media = await mediaRepository.findOne({
      where: {
        tmdbId: watchlistRequest.tmdbId,
        mediaType: watchlistRequest.mediaType,
      },
    });

    if (!media) {
      media = new Media({
        tmdbId: tmdbMedia.id,
        tvdbId: tmdbMedia.external_ids.tvdb_id,
        mediaType: watchlistRequest.mediaType,
      });
    }

    const watchlist = new this({
      ...watchlistRequest,
      requestedBy: user,
      media,
    });

    await mediaRepository.save(media);
    await watchlistRepository.save(watchlist);
    return watchlist;
  }

  public static async deleteWatchlist(
    id: Watchlist['tmdbId'] | Watchlist['mbId'] | Watchlist['externalId'],
    mediaType: MediaType,
    user: User
  ): Promise<Watchlist | null> {
    const watchlistRepository = getRepository(this);
    const watchlist = await watchlistRepository.findOneBy({
      ...(mediaType === MediaType.MUSIC
        ? { mbId: id as string }
        : mediaType === MediaType.BOOK
          ? { externalId: id as string }
          : { tmdbId: Number(id) }),
      mediaType,
      requestedBy: { id: user.id },
    });
    if (!watchlist) {
      throw new NotFoundError('not Found');
    }

    if (watchlist) {
      await watchlistRepository.delete(watchlist.id);
    }

    return watchlist;
  }

  private static async requestBookFromWatchlist(
    openLibraryId: string,
    user: User
  ): Promise<void> {
    if (
      !user.settings?.watchlistSyncBooks ||
      !user.hasPermission(
        [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_BOOK],
        {
          type: 'or',
        }
      )
    ) {
      return;
    }

    const readarrSettings = getSettings().readarr;
    const hasDefaultEbook = readarrSettings.some(
      (readarr) =>
        readarr.isDefault && (readarr.serviceType ?? 'ebook') === 'ebook'
    );
    const hasDefaultAudiobook = readarrSettings.some(
      (readarr) => readarr.isDefault && readarr.serviceType === 'audiobook'
    );
    const format = hasDefaultEbook
      ? 'ebook'
      : hasDefaultAudiobook
        ? 'audiobook'
        : 'ebook';

    try {
      await MediaRequest.request(
        {
          mediaId: openLibraryId,
          mediaType: MediaType.BOOK,
          format,
        },
        user,
        { isAutoRequest: true }
      );
    } catch (e) {
      if (!(e instanceof Error)) {
        return;
      }

      switch (e.constructor) {
        case RequestPermissionError:
        case DuplicateMediaRequestError:
        case QuotaRestrictedError:
        case NoSeasonsAvailableError:
          logger.debug('Failed to create book request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            openLibraryId,
            errorMessage: e.message,
          });
          break;
        case BlocklistedMediaError:
          break;
        default:
          logger.error('Failed to create book request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            openLibraryId,
            errorMessage: e.message,
          });
      }
    }
  }

  private static async requestMusicFromWatchlist(
    mbId: string,
    user: User
  ): Promise<void> {
    if (
      !user.settings?.watchlistSyncMusic ||
      !user.hasPermission(
        [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MUSIC],
        {
          type: 'or',
        }
      )
    ) {
      return;
    }

    try {
      await MediaRequest.request(
        {
          mediaId: mbId,
          mediaType: MediaType.MUSIC,
        },
        user,
        { isAutoRequest: true }
      );
    } catch (e) {
      if (!(e instanceof Error)) {
        return;
      }

      switch (e.constructor) {
        case RequestPermissionError:
        case DuplicateMediaRequestError:
        case QuotaRestrictedError:
        case NoSeasonsAvailableError:
          logger.debug('Failed to create music request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            mbId,
            errorMessage: e.message,
          });
          break;
        case BlocklistedMediaError:
          break;
        default:
          logger.error('Failed to create music request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            mbId,
            errorMessage: e.message,
          });
      }
    }
  }
}
