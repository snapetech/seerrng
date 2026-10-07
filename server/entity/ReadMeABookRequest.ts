import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

/** A SeerrNG user's audiobook request and its ReadMeABook lifecycle. */
@Entity('readmeabook_request')
@Index('IDX_readmeabook_request_user_asin', ['userId', 'asin'], {
  unique: true,
})
export class ReadMeABookRequest {
  public constructor(init?: Partial<ReadMeABookRequest>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user: User;

  @Column({ type: 'varchar', length: 20 })
  public asin: string;

  @Column({ type: 'varchar', length: 512 })
  public title: string;

  @Column({ type: 'varchar', length: 512 })
  public author: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  public narrator?: string | null;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  public coverArtUrl?: string | null;

  @Column({ type: 'integer', nullable: true })
  public durationMinutes?: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  public remoteId?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'awaiting_approval' })
  public status: string;

  @Column({ type: 'text', nullable: true })
  public statusMessage?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public updatedAt: Date;
}

export default ReadMeABookRequest;
