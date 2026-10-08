import {
  currentTimestampDefault,
  DbAwareColumn,
} from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import Media from './Media';

export enum MediaIdentifierProvider {
  TMDB = 'tmdb',
  TVDB = 'tvdb',
  IMDB = 'imdb',
  MUSICBRAINZ = 'musicbrainz',
  LISTENBRAINZ = 'listenbrainz',
  HARDCOVER = 'hardcover',
  OPENLIBRARY = 'openlibrary',
  OPENLIBRARY_EDITION = 'openlibrary_edition',
  ISBN = 'isbn',
  READARR = 'readarr',
  LIDARR = 'lidarr',
  BOOKSHELF = 'bookshelf',
  AUDIOBOOKSHELF = 'audiobookshelf',
  COMICVINE = 'comicvine',
  MYLAR = 'mylar',
  KAPOWARR = 'kapowarr',
  LAZYLIBRARIAN = 'lazylibrarian',
  SPORTARR = 'sportarr',
}

@Entity()
@Unique('UNIQUE_MEDIA_IDENTIFIER', ['media', 'provider', 'value'])
@Index('IDX_media_identifier_provider_value', ['provider', 'value'])
@Index('UQ_media_identifier_canonical_book', ['provider', 'value'], {
  unique: true,
  where: `"provider" IN ('isbn', 'openlibrary', 'openlibrary_edition', 'bookshelf')`,
})
@Index('UQ_media_identifier_canonical_comic', ['provider', 'value'], {
  unique: true,
  where: `"provider" = 'comicvine'`,
})
@Index('UQ_media_identifier_canonical_magazine', ['provider', 'value'], {
  unique: true,
  where: `"provider" = 'lazylibrarian'`,
})
@Index('UQ_media_identifier_canonical_sportarr', ['provider', 'value'], {
  unique: true,
  where: `"provider" = 'sportarr'`,
})
class MediaIdentifier {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.identifiers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'mediaId',
    foreignKeyConstraintName: 'FK_media_identifier_media',
  })
  @Index('IDX_media_identifier_mediaId')
  public media: Media;

  @Column({ type: 'varchar' })
  public provider: MediaIdentifierProvider;

  @Column({ type: 'varchar' })
  public value: string;

  @Column({ type: 'boolean', default: false })
  public canonical: boolean;

  @DbAwareColumn({ type: 'datetime', default: currentTimestampDefault })
  public createdAt: Date;

  constructor(init?: Partial<MediaIdentifier>) {
    Object.assign(this, init);
  }
}

export default MediaIdentifier;
