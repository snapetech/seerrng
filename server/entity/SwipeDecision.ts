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

export type SwipeMediaType = 'movie' | 'tv' | 'book';

/**
 * `want`: swiped right (requested). `pass`: not interested, never shown
 * again. `seen`: already watched or read; a taste signal, not a request.
 */
export type SwipeDecisionKind = 'want' | 'pass' | 'seen';

@Entity('swipe_decision')
@Index('IDX_swipe_decision_identity', ['userId', 'mediaType', 'itemId'], {
  unique: true,
})
@Index('IDX_swipe_decision_user_created', ['userId', 'createdAt'])
export class SwipeDecision {
  public constructor(init?: Partial<SwipeDecision>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user: User;

  @Column({ type: 'varchar', length: 8 })
  public mediaType: SwipeMediaType;

  /** TMDB ID for movies and series; Open Library work ID for books. */
  @Column({ type: 'varchar', length: 64 })
  public itemId: string;

  @Column({ type: 'varchar', length: 512 })
  public title: string;

  @Column({ type: 'varchar', length: 8 })
  public decision: SwipeDecisionKind;

  /** Book subjects or genres kept as later taste signals. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  public tags?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}

export default SwipeDecision;
