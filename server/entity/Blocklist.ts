import { MediaStatus, type MediaType } from '@server/constants/media';
import dataSource from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { User } from '@server/entity/User';
import type { BlocklistItem } from '@server/interfaces/api/blocklistInterfaces';
import { normalizeExternalMediaId } from '@server/lib/externalIds';
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
@Index(['externalId', 'mediaType'], { unique: true })
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
  @Index()
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

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<Blocklist>) {
    Object.assign(this, init);
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
    let media: Media | null = null;

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
    } else {
      media = await mediaRepository.findOne({
        where: {
          tmdbId,
          mediaType: blocklistRequest.mediaType,
        },
      });
    }

    const blocklistRepository = em.getRepository(this);

    await blocklistRepository.save(blocklist);

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
            : undefined,
        blocklist: Promise.resolve(blocklist),
      });

      await mediaRepository.save(media);
    } else {
      media.blocklist = Promise.resolve(blocklist);
      media.status = MediaStatus.BLOCKLISTED;
      media.status4k = MediaStatus.BLOCKLISTED;

      await mediaRepository.save(media);
    }
  }
}
