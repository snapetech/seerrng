import { MediaStatus, type MediaType } from '@server/constants/media';
import dataSource from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import type { BlocklistItem } from '@server/interfaces/api/blocklistInterfaces';
import {
  isValidExternalMediaId,
  normalizeExternalMediaId,
} from '@server/lib/externalIds';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import type { EntityManager } from 'typeorm';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ZodNumber, ZodOptional, ZodString } from 'zod';

@Entity()
@Index('IDX_blocklist_external_media_type', ['externalId', 'mediaType'], {
  unique: true,
})
@Index('UQ_blocklist_screen_tmdb_type', ['tmdbId', 'mediaType'], {
  unique: true,
  where: `"mediaType" IN ('movie', 'tv') AND "tmdbId" > 0`,
})
export class Blocklist implements BlocklistItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ nullable: true, type: 'varchar' })
  title?: string;

  @Column()
  @Index()
  public tmdbId: number;

  @Column({ nullable: true, type: 'varchar' })
  public externalId?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public externalProvider?: MediaIdentifierProvider | null;

  @ManyToOne(() => User, (user) => user.id, {
    eager: true,
  })
  @Index()
  user?: User;

  @OneToOne(() => Media, (media) => media.blocklist, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  public media: Media;

  @Column({ nullable: true, type: 'varchar' })
  public blocklistedTags?: string;

  @Column({ nullable: true, type: 'int' })
  public previousStatus?: MediaStatus | null;

  @Column({ nullable: true, type: 'int' })
  public previousStatus4k?: MediaStatus | null;

  @Column({ nullable: true, type: 'boolean' })
  public isMediaPlaceholder?: boolean | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<Blocklist>) {
    Object.assign(this, init);
  }

  public static async removeFromBlocklist(
    blocklist: Blocklist,
    entityManager?: EntityManager
  ): Promise<void> {
    const em = entityManager ?? dataSource;
    const blocklistRepository = em.getRepository(this);
    const mediaRepository = em.getRepository(Media);
    const persisted = await blocklistRepository.findOne({
      where: { id: blocklist.id },
      relations: { media: true },
    });

    if (!persisted) {
      return;
    }

    const media = persisted.media;
    if (!media) {
      await blocklistRepository.remove(persisted);
      return;
    }

    if (persisted.isMediaPlaceholder === true) {
      // New blocklist-only media rows are explicitly marked at creation time.
      // Legacy rows have a null marker and are preserved because their origin
      // cannot be reconstructed safely.
      await mediaRepository.remove(media);
      return;
    }

    await blocklistRepository.remove(persisted);
    media.status =
      persisted.previousStatus == null ||
      persisted.previousStatus === MediaStatus.BLOCKLISTED
        ? MediaStatus.UNKNOWN
        : persisted.previousStatus;
    media.status4k =
      persisted.previousStatus4k == null ||
      persisted.previousStatus4k === MediaStatus.BLOCKLISTED
        ? MediaStatus.UNKNOWN
        : persisted.previousStatus4k;
    await mediaRepository.save(media);
  }

  public static async addToBlocklist(
    {
      blocklistRequest,
    }: {
      blocklistRequest: {
        mediaType: MediaType;
        title?: ZodOptional<ZodString>['_output'];
        tmdbId?: ZodNumber['_output'];
        externalId?: string;
        externalProvider?: MediaIdentifierProvider;
        user?: User;
        blocklistedTags?: string;
      };
    },
    entityManager?: EntityManager
  ): Promise<void> {
    const em = entityManager ?? dataSource;
    const isScreenMedia =
      blocklistRequest.mediaType === 'movie' ||
      blocklistRequest.mediaType === 'tv';
    if (
      (isScreenMedia &&
        (!Number.isSafeInteger(blocklistRequest.tmdbId) ||
          (blocklistRequest.tmdbId ?? 0) <= 0 ||
          blocklistRequest.externalId !== undefined ||
          blocklistRequest.externalProvider !== undefined)) ||
      (blocklistRequest.mediaType === 'music' &&
        (!blocklistRequest.externalId ||
          !isValidExternalMediaId(
            blocklistRequest.externalId,
            blocklistRequest.mediaType,
            blocklistRequest.externalProvider
          ) ||
          blocklistRequest.tmdbId !== undefined ||
          (blocklistRequest.externalProvider !== undefined &&
            blocklistRequest.externalProvider !==
              MediaIdentifierProvider.MUSICBRAINZ))) ||
      (blocklistRequest.mediaType === 'book' &&
        (!blocklistRequest.externalId ||
          !isValidExternalMediaId(
            blocklistRequest.externalId,
            blocklistRequest.mediaType,
            blocklistRequest.externalProvider
          ) ||
          blocklistRequest.tmdbId !== undefined ||
          (blocklistRequest.externalProvider !== undefined &&
            ![
              MediaIdentifierProvider.OPENLIBRARY,
              MediaIdentifierProvider.OPENLIBRARY_EDITION,
              MediaIdentifierProvider.ISBN,
            ].includes(blocklistRequest.externalProvider)))) ||
      (blocklistRequest.mediaType === 'comic' &&
        (!blocklistRequest.externalId ||
          !isValidExternalMediaId(
            blocklistRequest.externalId,
            blocklistRequest.mediaType,
            blocklistRequest.externalProvider
          ) ||
          blocklistRequest.tmdbId !== undefined ||
          (blocklistRequest.externalProvider !== undefined &&
            blocklistRequest.externalProvider !==
              MediaIdentifierProvider.COMICVINE))) ||
      (blocklistRequest.mediaType === 'magazine' &&
        (!blocklistRequest.externalId ||
          !isValidExternalMediaId(
            blocklistRequest.externalId,
            blocklistRequest.mediaType,
            blocklistRequest.externalProvider
          ) ||
          blocklistRequest.tmdbId !== undefined ||
          (blocklistRequest.externalProvider !== undefined &&
            blocklistRequest.externalProvider !==
              MediaIdentifierProvider.LAZYLIBRARIAN)))
    ) {
      throw new Error('Blocklist media identity is invalid.');
    }

    if (
      blocklistRequest.mediaType === 'music' &&
      blocklistRequest.externalProvider === undefined
    ) {
      blocklistRequest = {
        ...blocklistRequest,
        externalProvider: MediaIdentifierProvider.MUSICBRAINZ,
      };
    } else if (
      blocklistRequest.mediaType === 'book' &&
      blocklistRequest.externalProvider === undefined
    ) {
      blocklistRequest = {
        ...blocklistRequest,
        externalProvider: MediaIdentifierProvider.OPENLIBRARY,
      };
    } else if (
      blocklistRequest.mediaType === 'comic' &&
      blocklistRequest.externalProvider === undefined
    ) {
      blocklistRequest = {
        ...blocklistRequest,
        externalProvider: MediaIdentifierProvider.COMICVINE,
      };
    } else if (
      blocklistRequest.mediaType === 'magazine' &&
      blocklistRequest.externalProvider === undefined
    ) {
      blocklistRequest = {
        ...blocklistRequest,
        externalProvider: MediaIdentifierProvider.LAZYLIBRARIAN,
      };
    }

    const tmdbId = blocklistRequest.tmdbId ?? 0;
    blocklistRequest = {
      ...blocklistRequest,
      externalId: blocklistRequest.externalId
        ? normalizeExternalMediaId(
            blocklistRequest.externalId,
            blocklistRequest.mediaType,
            blocklistRequest.externalProvider
          )
        : undefined,
    };
    const blocklist = new this({
      ...blocklistRequest,
      tmdbId,
    });

    const mediaRepository = em.getRepository(Media);
    let media: Media | null;

    if (blocklistRequest.mediaType === 'music' && blocklistRequest.externalId) {
      media = await mediaRepository.findOne({
        where: {
          mbId: blocklistRequest.externalId,
          mediaType: blocklistRequest.mediaType,
        },
      });
    } else if (
      blocklistRequest.mediaType === 'book' &&
      blocklistRequest.externalId
    ) {
      const identifier = await em.getRepository(MediaIdentifier).findOne({
        where: {
          provider:
            blocklistRequest.externalProvider ??
            MediaIdentifierProvider.OPENLIBRARY,
          value: blocklistRequest.externalId,
        },
        relations: { media: true },
      });
      media =
        identifier?.media.mediaType === blocklistRequest.mediaType
          ? identifier.media
          : null;
    } else if (
      blocklistRequest.mediaType === 'comic' &&
      blocklistRequest.externalId
    ) {
      const identifier = await em.getRepository(MediaIdentifier).findOne({
        where: {
          provider: MediaIdentifierProvider.COMICVINE,
          value: blocklistRequest.externalId,
        },
        relations: { media: true },
      });
      media =
        identifier?.media.mediaType === blocklistRequest.mediaType
          ? identifier.media
          : null;
    } else if (
      blocklistRequest.mediaType === 'magazine' &&
      blocklistRequest.externalId
    ) {
      const identifier = await em.getRepository(MediaIdentifier).findOne({
        where: {
          provider: MediaIdentifierProvider.LAZYLIBRARIAN,
          value: blocklistRequest.externalId,
        },
        relations: { media: true },
      });
      media =
        identifier?.media.mediaType === blocklistRequest.mediaType
          ? identifier.media
          : null;
    } else {
      media = await mediaRepository.findOne({
        where: {
          tmdbId,
          mediaType: blocklistRequest.mediaType,
        },
      });
    }

    const blocklistRepository = em.getRepository(this);

    if (media) {
      blocklist.previousStatus = media.status;
      blocklist.previousStatus4k = media.status4k;
      blocklist.isMediaPlaceholder = false;
    } else {
      blocklist.isMediaPlaceholder = true;
    }

    if (!media) {
      media = new Media({
        tmdbId,
        mbId:
          blocklistRequest.mediaType === 'music'
            ? blocklistRequest.externalId
            : undefined,
        status: MediaStatus.BLOCKLISTED,
        status4k: MediaStatus.BLOCKLISTED,
        mediaType: blocklistRequest.mediaType,
        identifiers:
          blocklistRequest.mediaType === 'book' && blocklistRequest.externalId
            ? [
                new MediaIdentifier({
                  provider:
                    blocklistRequest.externalProvider ??
                    MediaIdentifierProvider.OPENLIBRARY,
                  value: blocklistRequest.externalId,
                  canonical: true,
                }),
              ]
            : blocklistRequest.mediaType === 'comic' &&
                blocklistRequest.externalId
              ? [
                  new MediaIdentifier({
                    provider: MediaIdentifierProvider.COMICVINE,
                    value: blocklistRequest.externalId,
                    canonical: true,
                  }),
                ]
              : blocklistRequest.mediaType === 'magazine' &&
                  blocklistRequest.externalId
                ? [
                    new MediaIdentifier({
                      provider: MediaIdentifierProvider.LAZYLIBRARIAN,
                      value: blocklistRequest.externalId,
                      canonical: true,
                    }),
                  ]
                : undefined,
      });

      await mediaRepository.save(media);
    } else {
      media.blocklist = Promise.resolve(blocklist);
      media.status = MediaStatus.BLOCKLISTED;
      media.status4k = MediaStatus.BLOCKLISTED;

      await mediaRepository.save(media);
    }

    // Blocklist owns the one-to-one join column. Assigning the inverse
    // Media.blocklist relation alone does not persist the association.
    blocklist.media = media;
    await blocklistRepository.save(blocklist);
  }
}
