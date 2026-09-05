import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * A request status event is deliberately a snapshot rather than a relation to
 * MediaRequest. Requests and media can be removed by an administrator, but a
 * user's request history must remain readable and auditable after that happens.
 */
@Entity('media_request_status_event')
@Unique('UQ_media_request_status_event_fingerprint', [
  'requestId',
  'fingerprint',
])
@Index('IDX_media_request_status_event_request_created', [
  'requestId',
  'createdAt',
])
@Index('IDX_media_request_status_event_user_created', [
  'requestedById',
  'createdAt',
])
@Index('IDX_media_request_status_event_stage', ['stage'])
export class MediaRequestStatusEvent {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public requestId: number;

  @Column({ type: 'integer' })
  public requestedById: number;

  @Column({ type: 'integer' })
  public mediaId: number;

  @Column({ type: 'varchar', length: 16 })
  public mediaType: string;

  @Column({ type: 'varchar', length: 32 })
  public stage: string;

  @Column({ type: 'integer', default: 0 })
  public attempt: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  public format?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  public service?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public message?: string | null;

  @Column({ type: 'real', nullable: true })
  public percent?: number | null;

  @Column({ type: 'real', nullable: true })
  public size?: number | null;

  @Column({ type: 'real', nullable: true })
  public sizeLeft?: number | null;

  @DbAwareColumn({
    type: resolveDbType('datetime'),
    nullable: true,
  })
  public estimatedCompletionTime?: Date | null;

  @Column({ type: 'integer', default: 0 })
  public downloadCount: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public downloadId?: string | null;

  /** Stable value used to make repeated queue polls idempotent. */
  @Column({ type: 'varchar', length: 255 })
  public fingerprint: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<MediaRequestStatusEvent>) {
    Object.assign(this, init);
  }
}

export default MediaRequestStatusEvent;
