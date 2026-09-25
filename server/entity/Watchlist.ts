import ComicVineAPI from '@server/api/comicvine';
import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
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
  runWithRequestAdmission,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  isValidExternalMediaId,
  isValidMusicBrainzResourceId,
  isValidOpenLibraryResourceId,
  normalizeMusicBrainzId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  cleanMagazineTitle,
  normalizeMagazineTitle,
} from '@server/lib/magazineIdentity';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import {
  isUserCredentialVersionCurrent,
  runUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
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
export class WatchlistActorUnavailableError extends Error {}
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

@Entity()
@Unique('UNIQUE_USER_DB', ['tmdbId', 'mediaType', 'requestedBy'])
@Unique('UNIQUE_USER_MUSIC', ['mbId', 'requestedBy'])
@Unique('UNIQUE_USER_BOOK', ['externalId', 'mediaType', 'requestedBy'])
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
  @Index('IDX_watchlist_mbId')
  public mbId?: string;

  @Column({ nullable: true, type: 'varchar' })
  @Index('IDX_watchlist_external_id')
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

  public static async createWatchlist(
    {
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
    },
    options: {
      admissionGranted?: boolean;
      expectedCredentialVersion?: number;
      securityGranted?: boolean;
    } = {}
  ): Promise<Watchlist> {
    watchlistRequest = {
      ...watchlistRequest,
      mbId: watchlistRequest.mbId
        ? normalizeMusicBrainzId(watchlistRequest.mbId)
        : undefined,
      externalId: watchlistRequest.externalId
        ? watchlistRequest.mediaType === MediaType.COMIC
          ? watchlistRequest.externalId.trim()
          : watchlistRequest.mediaType === MediaType.MAGAZINE
            ? normalizeMagazineTitle(watchlistRequest.externalId)
            : normalizeOpenLibraryWorkId(watchlistRequest.externalId)
        : undefined,
    };

    if (
      watchlistRequest.mediaType === MediaType.MUSIC &&
      (!watchlistRequest.mbId ||
        !isValidMusicBrainzResourceId(watchlistRequest.mbId))
    ) {
      throw new Error('MusicBrainz ID is invalid for music watchlists.');
    }

    if (
      watchlistRequest.mediaType === MediaType.BOOK &&
      (!watchlistRequest.externalId ||
        !isValidOpenLibraryResourceId(watchlistRequest.externalId))
    ) {
      throw new Error('Open Library ID is invalid for book watchlists.');
    }

    if (
      watchlistRequest.mediaType === MediaType.COMIC &&
      (!watchlistRequest.externalId ||
        !isValidExternalMediaId(watchlistRequest.externalId, MediaType.COMIC))
    ) {
      throw new Error('ComicVine ID is invalid for comic watchlists.');
    }

    if (
      watchlistRequest.mediaType === MediaType.MAGAZINE &&
      (!watchlistRequest.externalId ||
        watchlistRequest.externalId.length > 256 ||
        !normalizeMagazineTitle(watchlistRequest.externalId))
    ) {
      throw new Error('Magazine title is invalid for magazine watchlists.');
    }

    if (!options.securityGranted) {
      let activeUser!: User;
      const watchlist = await runUserSecurityMutation(user.id, async () => {
        const currentUser = await getRepository(User).findOneBy({
          id: user.id,
        });
        if (
          !currentUser ||
          !isUserCredentialVersionCurrent(
            currentUser,
            options.expectedCredentialVersion
          )
        ) {
          throw new WatchlistActorUnavailableError(
            'Watchlist actor changed before admission.'
          );
        }
        activeUser = currentUser;
        return this.createWatchlist(
          { watchlistRequest, user: currentUser },
          { ...options, securityGranted: true }
        );
      });

      // Auto-requesting acquires the user-security and canonical media locks
      // itself. Run it after the watchlist critical section to preserve the
      // global user-security -> media-admission lock order.
      if (watchlistRequest.mediaType === MediaType.MUSIC) {
        await this.requestMusicFromWatchlist(
          watchlistRequest.mbId!,
          activeUser,
          options.expectedCredentialVersion
        );
      } else if (watchlistRequest.mediaType === MediaType.BOOK) {
        await this.requestBookFromWatchlist(
          watchlistRequest.externalId!,
          activeUser,
          options.expectedCredentialVersion
        );
      } else if (watchlistRequest.mediaType === MediaType.COMIC) {
        await this.requestComicFromWatchlist(
          watchlistRequest.externalId!,
          activeUser,
          options.expectedCredentialVersion
        );
      } else if (watchlistRequest.mediaType === MediaType.MAGAZINE) {
        await this.requestMagazineFromWatchlist(
          watchlist.title,
          activeUser,
          options.expectedCredentialVersion
        );
      }

      return watchlist;
    }

    if (!options.admissionGranted) {
      const identity =
        watchlistRequest.mediaType === MediaType.MUSIC
          ? watchlistRequest.mbId
          : watchlistRequest.mediaType === MediaType.BOOK ||
              watchlistRequest.mediaType === MediaType.COMIC ||
              watchlistRequest.mediaType === MediaType.MAGAZINE
            ? watchlistRequest.externalId
            : watchlistRequest.tmdbId;
      const identityKey =
        watchlistRequest.mediaType === MediaType.MUSIC
          ? `request-canonical:music:${identity}`
          : watchlistRequest.mediaType === MediaType.BOOK
            ? `request-canonical:book:${MediaIdentifierProvider.OPENLIBRARY}:${identity}`
            : watchlistRequest.mediaType === MediaType.COMIC
              ? `request-canonical:comic:${MediaIdentifierProvider.COMICVINE}:${identity}`
              : watchlistRequest.mediaType === MediaType.MAGAZINE
                ? `request-canonical:magazine:${MediaIdentifierProvider.LAZYLIBRARIAN}:${identity}`
                : `request-media:${watchlistRequest.mediaType}:${identity}`;

      const watchlist = await runWithRequestAdmission([identityKey], () =>
        this.createWatchlist(
          { watchlistRequest, user },
          { ...options, admissionGranted: true }
        )
      );

      return watchlist;
    }

    const watchlistRepository = getRepository(this);
    const tmdb = new TheMovieDb();

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

      return dataSource.transaction(async (manager) => {
        const transactionalMediaRepository = manager.getRepository(Media);
        const transactionalWatchlistRepository = manager.getRepository(this);
        let media = await transactionalMediaRepository.findOne({
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

        await transactionalMediaRepository.save(media);
        await transactionalWatchlistRepository.save(watchlist);
        return watchlist;
      });
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
      return dataSource.transaction(async (manager) => {
        const transactionalMediaRepository = manager.getRepository(Media);
        const identifierRepository = manager.getRepository(MediaIdentifier);
        const transactionalWatchlistRepository = manager.getRepository(this);
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
          media = await transactionalMediaRepository.save(
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

        await transactionalWatchlistRepository.save(watchlist);
        return watchlist;
      });
    }

    if (watchlistRequest.mediaType === MediaType.COMIC) {
      if (!watchlistRequest.externalId) {
        throw new Error('ComicVine ID is required for comic watchlists.');
      }

      const existing = await watchlistRepository.findOne({
        where: {
          externalId: watchlistRequest.externalId,
          mediaType: MediaType.COMIC,
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

      const { comicVineApiKey } = getSettings().main;
      if (!comicVineApiKey) {
        throw new Error('ComicVine is not configured for comic watchlists.');
      }
      const comicVine = new ComicVineAPI(comicVineApiKey);
      const volume = await comicVine.getVolume(
        Number(watchlistRequest.externalId)
      );
      if (!volume) {
        throw new Error('ComicVine volume not found.');
      }
      const title = watchlistRequest.title ?? volume.name;
      return dataSource.transaction(async (manager) => {
        const transactionalMediaRepository = manager.getRepository(Media);
        const identifierRepository = manager.getRepository(MediaIdentifier);
        const transactionalWatchlistRepository = manager.getRepository(this);
        const identifier = await identifierRepository.findOne({
          where: {
            provider: MediaIdentifierProvider.COMICVINE,
            value: watchlistRequest.externalId,
          },
          relations: { media: true },
        });
        let media =
          identifier?.media.mediaType === MediaType.COMIC
            ? identifier.media
            : undefined;

        if (!media) {
          media = await transactionalMediaRepository.save(
            new Media({
              tmdbId: 0,
              mediaType: MediaType.COMIC,
            })
          );
          await identifierRepository.save(
            new MediaIdentifier({
              media,
              provider: MediaIdentifierProvider.COMICVINE,
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

        await transactionalWatchlistRepository.save(watchlist);
        return watchlist;
      });
    }

    if (watchlistRequest.mediaType === MediaType.MAGAZINE) {
      if (!watchlistRequest.externalId) {
        throw new Error('Magazine title is required for magazine watchlists.');
      }

      const existing = await watchlistRepository.findOne({
        where: {
          externalId: watchlistRequest.externalId,
          mediaType: MediaType.MAGAZINE,
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

      const title = cleanMagazineTitle(
        watchlistRequest.title ?? watchlistRequest.externalId
      );
      return dataSource.transaction(async (manager) => {
        const transactionalMediaRepository = manager.getRepository(Media);
        const identifierRepository = manager.getRepository(MediaIdentifier);
        const transactionalWatchlistRepository = manager.getRepository(this);
        const identifier = await identifierRepository.findOne({
          where: {
            provider: MediaIdentifierProvider.LAZYLIBRARIAN,
            value: watchlistRequest.externalId,
          },
          relations: { media: true },
        });
        let media =
          identifier?.media.mediaType === MediaType.MAGAZINE
            ? identifier.media
            : undefined;

        if (!media) {
          media = await transactionalMediaRepository.save(
            new Media({
              tmdbId: 0,
              mediaType: MediaType.MAGAZINE,
              externalServiceSlug: title,
            })
          );
          await identifierRepository.save(
            new MediaIdentifier({
              media,
              provider: MediaIdentifierProvider.LAZYLIBRARIAN,
              value: watchlistRequest.externalId,
              canonical: true,
            })
          );
        } else if (!media.externalServiceSlug) {
          media.externalServiceSlug = title;
          await transactionalMediaRepository.save(media);
        }

        const watchlist = new this({
          ...watchlistRequest,
          title,
          requestedBy: user,
          media,
        });

        await transactionalWatchlistRepository.save(watchlist);
        return watchlist;
      });
    }

    if (!watchlistRequest.tmdbId) {
      throw new Error('TMDB ID is required for movie and series watchlists.');
    }

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

    const tmdbMedia =
      watchlistRequest.mediaType === MediaType.MOVIE
        ? await tmdb.getMovie({ movieId: watchlistRequest.tmdbId })
        : await tmdb.getTvShow({ tvId: watchlistRequest.tmdbId });

    return dataSource.transaction(async (manager) => {
      const transactionalMediaRepository = manager.getRepository(Media);
      const transactionalWatchlistRepository = manager.getRepository(this);
      let media = await transactionalMediaRepository.findOne({
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

      await transactionalMediaRepository.save(media);
      await transactionalWatchlistRepository.save(watchlist);
      return watchlist;
    });
  }

  public static async deleteWatchlist(
    id: Watchlist['tmdbId'] | Watchlist['mbId'] | Watchlist['externalId'],
    mediaType: MediaType,
    user: User,
    options: {
      expectedCredentialVersion?: number;
      securityGranted?: boolean;
    } = {}
  ): Promise<Watchlist | null> {
    if (!options.securityGranted) {
      return runUserSecurityMutation(user.id, async () => {
        const currentUser = await getRepository(User).findOneBy({
          id: user.id,
        });
        if (
          !currentUser ||
          !isUserCredentialVersionCurrent(
            currentUser,
            options.expectedCredentialVersion
          )
        ) {
          throw new WatchlistActorUnavailableError(
            'Watchlist actor changed before admission.'
          );
        }

        return this.deleteWatchlist(id, mediaType, currentUser, {
          ...options,
          securityGranted: true,
        });
      });
    }

    const watchlistRepository = getRepository(this);
    const watchlist = await watchlistRepository.findOneBy({
      ...(mediaType === MediaType.MUSIC
        ? { mbId: id as string }
        : mediaType === MediaType.BOOK ||
            mediaType === MediaType.COMIC ||
            mediaType === MediaType.MAGAZINE
          ? { externalId: id as string }
          : { tmdbId: Number(id) }),
      mediaType,
      requestedBy: { id: user.id },
    });
    if (!watchlist) {
      throw new NotFoundError('Watchlist item not found.');
    }

    if (watchlist) {
      await watchlistRepository.delete(watchlist.id);
    }

    return watchlist;
  }

  private static async requestBookFromWatchlist(
    openLibraryId: string,
    user: User,
    expectedCredentialVersion?: number
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

    const readarrSettings = getExternalRuntimeConfig().readarr;
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
        { expectedCredentialVersion, isAutoRequest: true }
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
    user: User,
    expectedCredentialVersion?: number
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
        { expectedCredentialVersion, isAutoRequest: true }
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

  private static async requestComicFromWatchlist(
    comicVineId: string,
    user: User,
    expectedCredentialVersion?: number
  ): Promise<void> {
    if (
      !user.settings?.watchlistSyncComics ||
      !user.hasPermission(
        [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_COMIC],
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
          mediaId: comicVineId,
          mediaType: MediaType.COMIC,
        },
        user,
        { expectedCredentialVersion, isAutoRequest: true }
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
          logger.debug('Failed to create comic request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            comicVineId,
            errorMessage: e.message,
          });
          break;
        case BlocklistedMediaError:
          break;
        default:
          logger.error('Failed to create comic request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            comicVineId,
            errorMessage: e.message,
          });
      }
    }
  }

  private static async requestMagazineFromWatchlist(
    title: string,
    user: User,
    expectedCredentialVersion?: number
  ): Promise<void> {
    if (
      !user.settings?.watchlistSyncMagazines ||
      !user.hasPermission(
        [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_MAGAZINE],
        { type: 'or' }
      )
    ) {
      return;
    }

    try {
      await MediaRequest.request(
        {
          mediaId: title,
          mediaType: MediaType.MAGAZINE,
        },
        user,
        { expectedCredentialVersion, isAutoRequest: true }
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
          logger.debug('Failed to create magazine request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            magazineTitle: title,
            errorMessage: e.message,
          });
          break;
        case BlocklistedMediaError:
          break;
        default:
          logger.error('Failed to create magazine request from watchlist', {
            label: 'Watchlist',
            userId: user.id,
            magazineTitle: title,
            errorMessage: e.message,
          });
      }
    }
  }
}
