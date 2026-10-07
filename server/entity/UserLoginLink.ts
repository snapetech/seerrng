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

@Entity('user_login_link')
@Index('IDX_user_login_link_hash', ['tokenHash'], { unique: true })
@Index('IDX_user_login_link_target_created', ['userId', 'createdAt'])
export class UserLoginLink {
  public constructor(init?: Partial<UserLoginLink>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  public userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  public user: User;

  @Column({ type: 'integer' })
  public createdById: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'createdById' })
  public createdBy: User;

  /** SHA-256 of the link token. The raw token is never stored. */
  @Column({ type: 'varchar', length: 64, select: false })
  public tokenHash: string;

  @DbAwareColumn({ type: 'datetime' })
  public expiresAt: Date;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public usedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public revokedAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}

export default UserLoginLink;
