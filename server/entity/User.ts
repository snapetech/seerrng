import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { Watchlist } from '@server/entity/Watchlist';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import PreparedEmail from '@server/lib/email';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import { AfterDate } from '@server/utils/dateHelpers';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import path from 'path';
import {
  AfterLoad,
  Column,
  Entity,
  In,
  Index,
  IsNull,
  Not,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Repository,
} from 'typeorm';
import Issue from './Issue';
import { LinkedAccount } from './LinkedAccount';
import { MediaRequest } from './MediaRequest';
import { UserPushSubscription } from './UserPushSubscription';
import { UserSettings } from './UserSettings';

const permissionColumnTransformer = {
  to: (value?: number | null): number => value ?? 0,
  from: (value: string | number | null): number => Number(value ?? 0),
};

@Entity()
@Index('IDX_user_plex_id_unique', ['plexId'], { unique: true })
@Index('IDX_user_jellyfin_user_id_unique', ['jellyfinUserId'], {
  unique: true,
})
export class User {
  public static async populateRequestCounts(users: User[]): Promise<void> {
    const uniqueUsers = [
      ...new Map(users.map((user) => [user.id, user])).values(),
    ].filter((user) => Number.isSafeInteger(user.id) && user.id > 0);

    if (uniqueUsers.length === 0) {
      return;
    }

    const counts = await getRepository(MediaRequest)
      .createQueryBuilder('request')
      .select('request.requestedBy', 'userId')
      .addSelect('COUNT(*)', 'requestCount')
      .where('request.requestedBy IN (:...userIds)', {
        userIds: uniqueUsers.map((user) => user.id),
      })
      .groupBy('request.requestedBy')
      .getRawMany<{ userId: number | string; requestCount: number | string }>();

    const countsByUserId = new Map(
      counts.map((row) => [Number(row.userId), Number(row.requestCount)])
    );

    for (const user of uniqueUsers) {
      user.requestCount = countsByUserId.get(user.id) ?? 0;
    }
  }

  public static filterMany(
    users: User[],
    showFiltered?: boolean
  ): Partial<User>[] {
    return users.map((u) => u.filter(showFiltered));
  }

  static readonly filteredFields: (keyof User)[] = [
    'email',
    'plexId',
    'jellyfinUserId',
    'settings',
    'linkedAccounts',
  ];

  static readonly credentialFields: (keyof User)[] = [
    'password',
    'passwordChangedAt',
    'failedLoginAttempts',
    'lastFailedLoginAt',
    'loginBlockedUntil',
    'resetPasswordGuid',
    'recoveryLinkExpirationDate',
    'resetPasswordDeliveryPending',
    'jellyfinDeviceId',
    'jellyfinAuthToken',
    'plexToken',
  ];

  public displayName: string;

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({
    unique: true,
    transformer: {
      from: (value: string): string => (value ?? '').toLowerCase(),
      to: (value: string): string => (value ?? '').toLowerCase(),
    },
  })
  public email: string;

  @Column({ type: 'varchar', nullable: true })
  public plexUsername?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public jellyfinUsername?: string | null;

  @Column({ nullable: true })
  public username?: string;

  @Column({ nullable: true, select: false })
  public password?: string;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public passwordChangedAt?: Date | null;

  @Column({ type: 'integer', default: 0, select: false })
  public failedLoginAttempts?: number;

  @DbAwareColumn({ type: 'datetime', nullable: true, select: false })
  public lastFailedLoginAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', nullable: true, select: false })
  public loginBlockedUntil?: Date | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public resetPasswordGuid?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public recoveryLinkExpirationDate?: Date | null;

  @Column({ type: 'boolean', default: false, select: false })
  public resetPasswordDeliveryPending?: boolean;

  @Column({ type: 'integer', default: UserType.PLEX })
  public userType: UserType;

  @Column({ type: 'integer', nullable: true, select: true })
  public plexId?: number | null;

  @Column({
    type: 'varchar',
    nullable: true,
    transformer: {
      to: (value?: string | null) =>
        value ? (normalizeJellyfinGuid(value) ?? value) : value,
      from: (value?: string | null) =>
        value ? (normalizeJellyfinGuid(value) ?? value) : value,
    },
  })
  public jellyfinUserId?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public jellyfinDeviceId?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public jellyfinAuthToken?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public plexToken?: string | null;

  @OneToMany(() => LinkedAccount, (link) => link.user, { cascade: true })
  public linkedAccounts: LinkedAccount[];

  @Column({
    type: resolveDbType('bigint'),
    default: 0,
    transformer: permissionColumnTransformer,
  })
  public permissions = 0;

  @Column()
  public avatar: string;

  @Column({ type: 'varchar', nullable: true })
  public avatarETag?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public avatarVersion?: string | null;

  public requestCount?: number;

  @OneToMany(() => MediaRequest, (request) => request.requestedBy)
  public requests: MediaRequest[];

  @OneToMany(() => Watchlist, (watchlist) => watchlist.requestedBy)
  public watchlists: Watchlist[];

  @Column({ nullable: true })
  public movieQuotaLimit?: number;

  @Column({ nullable: true })
  public movieQuotaDays?: number;

  @Column({ nullable: true })
  public tvQuotaLimit?: number;

  @Column({ nullable: true })
  public tvQuotaDays?: number;

  @Column({ nullable: true })
  public musicQuotaLimit?: number;

  @Column({ nullable: true })
  public musicQuotaDays?: number;

  @Column({ nullable: true })
  public bookQuotaLimit?: number;

  @Column({ nullable: true })
  public bookQuotaDays?: number;

  @OneToOne(() => UserSettings, (settings) => settings.user, {
    cascade: true,
    eager: true,
    onDelete: 'CASCADE',
  })
  public settings?: UserSettings;

  @OneToMany(() => UserPushSubscription, (pushSub) => pushSub.user)
  public pushSubscriptions: UserPushSubscription[];

  @OneToMany(() => Issue, (issue) => issue.createdBy, { cascade: true })
  public createdIssues: Issue[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  public warnings: string[] = [];

  constructor(init?: Partial<User>) {
    Object.assign(this, init);
  }

  public filter(showFiltered?: boolean): Partial<User> {
    const filtered: Partial<User> = Object.assign(
      {},
      ...(Object.keys(this) as (keyof User)[])
        .filter(
          (k) =>
            !User.credentialFields.includes(k) &&
            (showFiltered || !User.filteredFields.includes(k))
        )
        .map((k) => ({ [k]: this[k] }))
    );

    if (showFiltered && this.settings) {
      filtered.settings = this.settings.filter() as UserSettings;
    }

    return filtered;
  }

  /**
   * Minimal identity safe to embed in request, issue, and comment payloads.
   * Operational account fields such as permission masks, quotas, provider
   * usernames, and request counts belong only in explicitly authorized user
   * endpoints.
   */
  public publicFilter(includeCreatedAt = false): Partial<User> {
    return {
      id: this.id,
      displayName: this.displayName,
      avatar: this.avatar,
      ...(includeCreatedAt ? { createdAt: this.createdAt } : {}),
    };
  }

  /**
   * Identity and authorization data required by request managers when choosing
   * a requester. Account-management and activity fields are intentionally
   * excluded.
   */
  public requesterFilter(): Partial<User> {
    return {
      ...this.publicFilter(),
      permissions: this.permissions,
    };
  }

  public toJSON(): Partial<User> {
    return this.filter();
  }

  public hasPermission(
    permissions: Permission | Permission[],
    options?: PermissionCheckOptions
  ): boolean {
    return !!hasPermission(permissions, this.permissions, options);
  }

  public passwordMatch(password: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.password) {
        resolve(bcrypt.compare(password, this.password));
      } else {
        return resolve(false);
      }
    });
  }

  public getActiveLinkedAccounts(): LinkedAccount[] {
    const settings = getSettings();
    if (!settings.main.oidcLogin) {
      return [];
    }
    const activeProviderSlugs = settings.oidc.providers.map((p) => p.slug);
    return (this.linkedAccounts ?? []).filter((a) =>
      activeProviderSlugs.includes(a.provider)
    );
  }

  public async setPassword(password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 12);
    this.password = hashedPassword;
    this.passwordChangedAt = new Date();
    this.failedLoginAttempts = 0;
    this.lastFailedLoginAt = null;
    this.loginBlockedUntil = null;
    // A password change supersedes every outstanding recovery link. Keeping a
    // still-valid token usable after the account owner or an administrator has
    // replaced the password would let an older token take the account back.
    this.resetPasswordGuid = null;
    this.recoveryLinkExpirationDate = null;
    this.resetPasswordDeliveryPending = false;
  }

  public async preparePasswordResetDelivery(
    claimRepository: Repository<User> = getRepository(User)
  ): Promise<(() => Promise<boolean>) | undefined> {
    const settings = getSettings();
    if (
      !settings.main.applicationUrl ||
      !settings.notifications.agents.email.enabled
    ) {
      return undefined;
    }
    const previousResetPasswordGuid = this.resetPasswordGuid;
    const previousRecoveryLinkExpirationDate = this.recoveryLinkExpirationDate;
    const now = new Date();
    const canReuseExistingToken =
      !!previousResetPasswordGuid &&
      !!previousRecoveryLinkExpirationDate &&
      previousRecoveryLinkExpirationDate > now;
    const guid = canReuseExistingToken
      ? previousResetPasswordGuid
      : randomUUID();
    let claimedNewToken = false;

    if (!canReuseExistingToken) {
      // 24 hours into the future
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 1);
      this.resetPasswordGuid = guid;
      this.recoveryLinkExpirationDate = targetDate;

      const tokenClaim = await claimRepository.update(
        {
          id: this.id,
          resetPasswordGuid: previousResetPasswordGuid ?? IsNull(),
          recoveryLinkExpirationDate:
            previousRecoveryLinkExpirationDate ?? IsNull(),
        },
        {
          resetPasswordGuid: guid,
          recoveryLinkExpirationDate: targetDate,
          resetPasswordDeliveryPending: true,
        }
      );

      // Another reset request changed the token after this entity was loaded.
      // Do not send an already-invalid link.
      if (tokenClaim.affected !== 1) {
        this.resetPasswordGuid = previousResetPasswordGuid;
        this.recoveryLinkExpirationDate = previousRecoveryLinkExpirationDate;
        return undefined;
      }
      claimedNewToken = true;
    } else {
      const deliveryClaim = await claimRepository.update(
        { id: this.id, resetPasswordGuid: guid },
        { resetPasswordDeliveryPending: true }
      );
      if (deliveryClaim.affected !== 1) {
        return undefined;
      }
    }
    this.resetPasswordDeliveryPending = true;

    return async () => {
      const userRepository = getRepository(User);
      const { applicationTitle, applicationUrl } = settings.main;
      const resetPasswordLink = `${applicationUrl}/resetpassword/${guid}`;

      try {
        logger.info(`Sending reset password email for ${this.email}`, {
          label: 'User Management',
        });
        const email = new PreparedEmail(settings.notifications.agents.email);
        await email.send({
          template: path.join(__dirname, '../templates/email/resetpassword'),
          message: {
            to: this.email,
          },
          locals: {
            resetPasswordLink,
            applicationUrl,
            applicationTitle,
            recipientName: this.displayName,
            recipientEmail: this.email,
          },
        });
      } catch (e) {
        // Do not replace a previously delivered recovery link with a token the
        // user never received. The conditional update also avoids rolling back
        // a newer token issued while email delivery was in progress.
        if (claimedNewToken) {
          await userRepository.update(
            { id: this.id, resetPasswordGuid: guid },
            {
              resetPasswordGuid: previousResetPasswordGuid ?? null,
              recoveryLinkExpirationDate:
                previousRecoveryLinkExpirationDate ?? null,
              resetPasswordDeliveryPending: false,
            }
          );
          this.resetPasswordGuid = previousResetPasswordGuid;
          this.recoveryLinkExpirationDate = previousRecoveryLinkExpirationDate;
        } else {
          await userRepository.update(
            { id: this.id, resetPasswordGuid: guid },
            { resetPasswordDeliveryPending: false }
          );
        }
        this.resetPasswordDeliveryPending = false;
        logger.error('Failed to send out reset password email', {
          label: 'User Management',
          message: e instanceof Error ? e.message : 'Unknown email error',
        });
        return false;
      }

      // Clear the durable recovery marker only after SMTP has accepted the
      // message. If the process dies first, startup safely resends the same
      // still-valid bearer token.
      await userRepository.update(
        { id: this.id, resetPasswordGuid: guid },
        { resetPasswordDeliveryPending: false }
      );
      this.resetPasswordDeliveryPending = false;
      return true;
    };
  }

  public async resetPassword(): Promise<boolean> {
    const delivery = await this.preparePasswordResetDelivery();
    return delivery ? delivery() : false;
  }

  @AfterLoad()
  public setDisplayName(): void {
    this.displayName =
      this.username || this.plexUsername || this.jellyfinUsername || this.email;
  }

  public async getQuota(): Promise<QuotaResponse> {
    const {
      main: { defaultQuotas },
    } = getSettings();
    const requestRepository = getRepository(MediaRequest);
    const canBypass = this.hasPermission([Permission.MANAGE_USERS], {
      type: 'or',
    });

    const movieQuotaLimit = !canBypass
      ? (this.movieQuotaLimit ?? defaultQuotas.movie.quotaLimit)
      : 0;
    const movieQuotaDays = this.movieQuotaDays ?? defaultQuotas.movie.quotaDays;

    // Count movie requests made during quota period
    const movieDate = new Date();
    if (movieQuotaDays) {
      movieDate.setDate(movieDate.getDate() - movieQuotaDays);
    }

    const movieQuotaUsed = movieQuotaLimit
      ? await requestRepository.count({
          where: {
            requestedBy: {
              id: this.id,
            },
            ...(movieQuotaDays ? { createdAt: AfterDate(movieDate) } : {}),
            type: MediaType.MOVIE,
            status: Not(
              In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED])
            ),
          },
        })
      : 0;

    const tvQuotaLimit = !canBypass
      ? (this.tvQuotaLimit ?? defaultQuotas.tv.quotaLimit)
      : 0;
    const tvQuotaDays = this.tvQuotaDays ?? defaultQuotas.tv.quotaDays;

    // Count tv season requests made during quota period
    const tvDate = new Date();
    if (tvQuotaDays) {
      tvDate.setDate(tvDate.getDate() - tvQuotaDays);
    }
    const tvQuotaStartDate = tvDate.toJSON();
    const tvQuotaUsedQuery = requestRepository
      .createQueryBuilder('request')
      .innerJoin('request.seasons', 'season')
      .select('COUNT(season.id)', 'count')
      .leftJoin('request.requestedBy', 'requestedBy')
      .where('request.type = :requestType', {
        requestType: MediaType.TV,
      })
      .andWhere('requestedBy.id = :userId', {
        userId: this.id,
      })
      .andWhere('request.status NOT IN (:...inactiveStatuses)', {
        inactiveStatuses: [
          MediaRequestStatus.DECLINED,
          MediaRequestStatus.FAILED,
        ],
      });

    if (tvQuotaDays) {
      tvQuotaUsedQuery.andWhere('request.createdAt > :date', {
        date: tvQuotaStartDate,
      });
    }

    let tvQuotaUsed = 0;
    if (tvQuotaLimit) {
      const rawCount = await tvQuotaUsedQuery.getRawOne<{
        count: string | number | null;
      }>();
      tvQuotaUsed = Number(rawCount?.count ?? 0);
      if (!Number.isSafeInteger(tvQuotaUsed) || tvQuotaUsed < 0) {
        throw new Error('Invalid TV quota count returned by database.');
      }
    }

    const musicQuotaLimit = !canBypass
      ? (this.musicQuotaLimit ?? defaultQuotas.music.quotaLimit)
      : 0;
    const musicQuotaDays = this.musicQuotaDays ?? defaultQuotas.music.quotaDays;

    const musicDate = new Date();
    if (musicQuotaDays) {
      musicDate.setDate(musicDate.getDate() - musicQuotaDays);
    }

    const musicQuotaUsed = musicQuotaLimit
      ? await requestRepository.count({
          where: {
            requestedBy: {
              id: this.id,
            },
            ...(musicQuotaDays ? { createdAt: AfterDate(musicDate) } : {}),
            type: MediaType.MUSIC,
            status: Not(
              In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED])
            ),
          },
        })
      : 0;

    const bookQuotaLimit = !canBypass
      ? (this.bookQuotaLimit ?? defaultQuotas.book.quotaLimit)
      : 0;
    const bookQuotaDays = this.bookQuotaDays ?? defaultQuotas.book.quotaDays;

    const bookDate = new Date();
    if (bookQuotaDays) {
      bookDate.setDate(bookDate.getDate() - bookQuotaDays);
    }

    const bookQuotaUsed = bookQuotaLimit
      ? await requestRepository.count({
          where: {
            requestedBy: {
              id: this.id,
            },
            ...(bookQuotaDays ? { createdAt: AfterDate(bookDate) } : {}),
            type: MediaType.BOOK,
            status: Not(
              In([MediaRequestStatus.DECLINED, MediaRequestStatus.FAILED])
            ),
          },
        })
      : 0;

    return {
      movie: {
        days: movieQuotaDays,
        limit: movieQuotaLimit,
        used: movieQuotaUsed,
        remaining: movieQuotaLimit
          ? Math.max(0, movieQuotaLimit - movieQuotaUsed)
          : undefined,
        restricted: !!(
          movieQuotaLimit && movieQuotaLimit - movieQuotaUsed <= 0
        ),
      },
      tv: {
        days: tvQuotaDays,
        limit: tvQuotaLimit,
        used: tvQuotaUsed,
        remaining: tvQuotaLimit
          ? Math.max(0, tvQuotaLimit - tvQuotaUsed)
          : undefined,
        restricted: !!(tvQuotaLimit && tvQuotaLimit - tvQuotaUsed <= 0),
      },
      music: {
        days: musicQuotaDays,
        limit: musicQuotaLimit,
        used: musicQuotaUsed,
        remaining: musicQuotaLimit
          ? Math.max(0, musicQuotaLimit - musicQuotaUsed)
          : undefined,
        restricted: !!(
          musicQuotaLimit && musicQuotaLimit - musicQuotaUsed <= 0
        ),
      },
      book: {
        days: bookQuotaDays,
        limit: bookQuotaLimit,
        used: bookQuotaUsed,
        remaining: bookQuotaLimit
          ? Math.max(0, bookQuotaLimit - bookQuotaUsed)
          : undefined,
        restricted: !!(bookQuotaLimit && bookQuotaLimit - bookQuotaUsed <= 0),
      },
    };
  }
}
