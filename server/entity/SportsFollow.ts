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

/**
 * A team a user follows. The Live TV Sync job requests recordings of the
 * team's upcoming games that IPTV Tunerr has matched to a guide airing.
 */
@Entity('sports_follow')
@Index('IDX_sports_follow_identity', ['userId', 'dataset', 'team'], {
  unique: true,
})
export class SportsFollow {
  public constructor(init?: Partial<SportsFollow>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user: User;

  /** Tunerr / API-Sports dataset, e.g. `nfl`. */
  @Column({ type: 'varchar', length: 32 })
  public dataset: string;

  @Column({ type: 'varchar', length: 128 })
  public team: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}

export default SportsFollow;
