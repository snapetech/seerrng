import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

@Entity('external_request_list')
@Index('IDX_external_request_list_user_source', ['user', 'sourceId'], {
  unique: true,
})
export class ExternalRequestList {
  public constructor(init?: Partial<ExternalRequestList>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  public user: User;

  @Column({ type: 'varchar', length: 16 })
  public provider: 'imdb' | 'goodreads' | 'hardcover';

  @Column({ type: 'varchar', length: 64 })
  public sourceId: string;

  @Column({ type: 'varchar', length: 2048 })
  public sourceUrl: string;

  /** Hardcover API tokens are never selected by default or returned by list routes. */
  @Column({ type: 'text', nullable: true, select: false })
  public apiToken?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  public processedItemIds?: string[];

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastSyncedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  public lastSyncError?: string | null;
}
