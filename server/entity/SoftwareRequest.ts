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

export type SoftwareRequestCategory = 'retro' | 'modern' | 'game';
export type SoftwareRequestProvider = 'romarr' | 'questarr';
export type SoftwareRequestStatus =
  | 'pending'
  | 'approved'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'declined'
  | 'cancelled';

@Entity('software_request')
@Index('IDX_software_request_requester_created', ['requestedById', 'createdAt'])
@Index('IDX_software_request_status_created', ['status', 'createdAt'])
@Index(
  'UQ_software_request_provider_external_id',
  ['provider', 'externalRequestId'],
  { unique: true }
)
export class SoftwareRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public requestedById: number;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestedById' })
  public requestedBy: User;

  @Column({ type: 'integer', nullable: true })
  public approvedById?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approvedById' })
  public approvedBy?: User | null;

  @Column({ type: 'varchar', length: 16 })
  public category: SoftwareRequestCategory;

  @Column({ type: 'varchar', length: 16 })
  public provider: SoftwareRequestProvider;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  public status: SoftwareRequestStatus;

  @Column({ type: 'varchar', length: 255 })
  public externalRequestId: string;

  @Column({ type: 'integer', nullable: true })
  public catalogId?: number | null;

  @Column({ type: 'varchar', length: 512 })
  public title: string;

  @Column({ type: 'text', nullable: true })
  public summary?: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  public coverUrl?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  public platformSlug?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  public platformName?: string | null;

  @Column({ type: 'integer', nullable: true })
  public platformId?: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  public operatingSystem?: 'windows' | 'linux' | 'macos' | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  public architecture?: 'x64' | 'arm64' | 'x86' | 'universal' | null;

  @Column({ type: 'integer', default: 0 })
  public attempt: number;

  @Column({ type: 'real', nullable: true })
  public percent?: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public errorMessage?: string | null;

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

export default SoftwareRequest;
