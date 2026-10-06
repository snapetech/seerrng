import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './User';

export type TrackRequestStatus =
  'pending' | 'searching' | 'completed' | 'failed' | 'declined' | 'cancelled';

export const ACTIVE_TRACK_STATUSES: TrackRequestStatus[] = [
  'pending',
  'searching',
];

/**
 * A single-track request fulfilled through the slskdN wishlist. Used for
 * tracks Lidarr cannot request, such as singles or playlist tracks without a
 * confident album match.
 */
@Entity('track_request')
@Index('IDX_track_request_requester_created', ['requestedById', 'createdAt'])
@Index('IDX_track_request_status_created', ['status', 'createdAt'])
export class TrackRequest {
  public constructor(init?: Partial<TrackRequest>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public requestedById: number;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestedById' })
  public requestedBy: User;

  @Column({ type: 'integer', nullable: true })
  public modifiedById?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'modifiedById' })
  public modifiedBy?: User | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  public status: TrackRequestStatus;

  @Column({ type: 'varchar', length: 255 })
  public artist: string;

  @Column({ type: 'varchar', length: 255 })
  public title: string;

  /** MusicBrainz recording ID when known. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  public recordingMbid?: string | null;

  /** Where the request came from, e.g. `playlist` or `songid`. */
  @Column({ type: 'varchar', length: 16, default: 'manual' })
  public source: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public wishlistItemId?: string | null;

  @Column({ type: 'integer', default: 0 })
  public searchCount: number;

  @Column({ type: 'integer', default: 0 })
  public lastMatchCount: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public lastError?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastCheckedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;
}

export default TrackRequest;
