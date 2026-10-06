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

/** `airing` records one guide programme; `series` keeps recording a title. */
export type RecordingRequestKind = 'airing' | 'series';

export type RecordingRequestStatus =
  | 'pending'
  | 'scheduled'
  | 'recording'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'cancelled';

export const ACTIVE_RECORDING_STATUSES: RecordingRequestStatus[] = [
  'pending',
  'scheduled',
  'recording',
];

/**
 * A request to record Live TV through IPTV Tunerr. Approval creates a Tunerr
 * recording rule named after this request; the rule is removed when the
 * request finishes or is cancelled.
 */
@Entity('recording_request')
@Index('IDX_recording_request_requester_created', [
  'requestedById',
  'createdAt',
])
@Index('IDX_recording_request_status_created', ['status', 'createdAt'])
export class RecordingRequest {
  public constructor(init?: Partial<RecordingRequest>) {
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

  @Column({ type: 'varchar', length: 16 })
  public kind: RecordingRequestKind;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  public status: RecordingRequestStatus;

  /** Guide title the Tunerr rule matches. */
  @Column({ type: 'varchar', length: 512 })
  public title: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public subTitle?: string | null;

  /** `movie` or `tv` when the request came from a TMDB detail page. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  public mediaType?: 'movie' | 'tv' | null;

  @Column({ type: 'integer', nullable: true })
  public tmdbId?: number | null;

  /** Tunerr channel ID (XMLTV channel). Null records on any channel. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  public channelId?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public channelName?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public startsAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public endsAt?: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  public tunerrRuleId?: string | null;

  @Column({ type: 'integer', default: 0 })
  public completedCount: number;

  @Column({ type: 'integer', default: 0 })
  public failedCount: number;

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

export default RecordingRequest;
