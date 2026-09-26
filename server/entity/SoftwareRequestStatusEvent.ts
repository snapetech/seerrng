import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { SoftwareRequestStatus } from './SoftwareRequest';

/** Durable lifecycle snapshots kept separate from the current request row. */
@Entity('software_request_status_event')
@Unique('UQ_software_request_status_event_fingerprint', [
  'requestId',
  'fingerprint',
])
@Index('IDX_software_request_status_event_request_created', [
  'requestId',
  'createdAt',
])
export class SoftwareRequestStatusEvent {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public requestId: number;

  @Column({ type: 'integer' })
  public requestedById: number;

  @Column({ type: 'varchar', length: 32 })
  public status: SoftwareRequestStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public message?: string | null;

  @Column({ type: 'real', nullable: true })
  public percent?: number | null;

  @Column({ type: 'varchar', length: 255 })
  public fingerprint: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}

export default SoftwareRequestStatusEvent;
