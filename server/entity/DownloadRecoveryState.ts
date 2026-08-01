import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DownloadRecoveryServiceType =
  | 'radarr'
  | 'sonarr'
  | 'lidarr'
  | 'readarr';

@Entity('download_recovery_state')
@Index(
  'IDX_download_recovery_state_service_download',
  ['serviceType', 'serviceId', 'downloadId'],
  { unique: true }
)
class DownloadRecoveryState {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public serviceType: DownloadRecoveryServiceType;

  @Column({ type: 'int' })
  public serviceId: number;

  @Column({ type: 'int', nullable: true })
  public externalServiceId?: number | null;

  @Column({ type: 'int' })
  public queueId: number;

  @Column({ type: 'varchar' })
  public downloadId: string;

  @Column({ type: 'varchar', nullable: true })
  public releaseTitle?: string | null;

  @Column({ type: 'varchar', default: '0' })
  public lastSizeLeft: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public lastProgressAt: Date;

  @Column({ type: 'int', default: 0 })
  public retryCount: number;

  @Column({ type: 'varchar', nullable: true })
  public lastAction?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public lastReason?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;
}

export default DownloadRecoveryState;
