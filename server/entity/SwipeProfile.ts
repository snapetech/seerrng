import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './User';

/** Per-user swipe preferences. */
@Entity('swipe_profile')
export class SwipeProfile {
  public constructor(init?: Partial<SwipeProfile>) {
    Object.assign(this, init);
  }

  @PrimaryColumn({ type: 'integer' })
  public userId: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user: User;

  /** Free-text taste notes passed to the AI ranker (max 1000 characters). */
  @Column({ type: 'varchar', length: 1000, default: '' })
  public tasteNotes: string;

  /** What a right swipe on a series requests. */
  @Column({ type: 'varchar', length: 16, default: 'first-season' })
  public seriesRequest: 'first-season' | 'all-seasons';

  @Column({ type: 'varchar', length: 16, default: 'audiobook' })
  public bookFormat: 'ebook' | 'audiobook';

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public updatedAt: Date;
}

export default SwipeProfile;
