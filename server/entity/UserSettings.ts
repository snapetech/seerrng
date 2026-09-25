import type {
  CardTextVisibility,
  NotificationAgentTypes,
  UserPreferredLanguages,
  UserSettingsDetailDisclosuresByMedia,
} from '@server/interfaces/api/userSettingsInterfaces';
import { Notification, hasNotificationType } from '@server/lib/notifications';
import { NotificationAgentKey } from '@server/lib/settings';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

export const ALL_NOTIFICATIONS = Object.values(Notification)
  .filter((v) => !isNaN(Number(v)))
  .reduce((a, v) => a + Number(v), 0);

// convert between DB representation (JSON string) into typescript array
const jsonArrayTransformer = {
  from: (v: string | null): string[] => {
    try {
      return v ? JSON.parse(v) : [];
    } catch {
      return [];
    }
  },
  to: (v: string[] | null): string | null =>
    v?.length ? JSON.stringify(v) : null,
};

const getDefaultNotificationTypes = (): Partial<NotificationAgentTypes> => ({
  email: ALL_NOTIFICATIONS,
  discord: 0,
  pushbullet: 0,
  pushover: 0,
  slack: 0,
  telegram: 0,
  webhook: 0,
  webpush: ALL_NOTIFICATIONS,
});

const allowedNotificationAgentKeys = Object.values(NotificationAgentKey);

const sanitizeNotificationTypes = (
  value: unknown
): Partial<NotificationAgentTypes> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const sanitized: Partial<NotificationAgentTypes> = {};
  for (const key of allowedNotificationAgentKeys) {
    const mask = input[key];
    if (
      typeof mask === 'number' &&
      Number.isInteger(mask) &&
      mask >= 0 &&
      (mask & ~ALL_NOTIFICATIONS) === 0
    ) {
      sanitized[key] = mask;
    }
  }

  return sanitized;
};

export const deserializeNotificationTypes = (
  value: string | null
): Partial<NotificationAgentTypes> => {
  if (!value) {
    return getDefaultNotificationTypes();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return getDefaultNotificationTypes();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return getDefaultNotificationTypes();
  }

  const values = sanitizeNotificationTypes(parsed);
  if (values.email == null) {
    values.email = ALL_NOTIFICATIONS;
  }
  if (values.webpush == null) {
    values.webpush = ALL_NOTIFICATIONS;
  }

  return values;
};

export const serializeNotificationTypes = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(sanitizeNotificationTypes(value));
};

@Entity()
export class UserSettings {
  constructor(init?: Partial<UserSettings>) {
    Object.assign(this, init);
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @OneToOne(() => User, (user) => user.settings, { onDelete: 'CASCADE' })
  @JoinColumn()
  public user: User;

  @Column({ default: '' })
  public locale?: string;

  @Column({ nullable: true })
  public discoverRegion?: string;

  @Column({ nullable: true })
  public streamingRegion?: string;

  @Column({ nullable: true })
  public originalLanguage?: string;

  @Column({ type: 'simple-json', nullable: true })
  public preferredLanguages?: UserPreferredLanguages;

  @Column({ nullable: true })
  public pgpKey?: string;

  @Column({ type: 'text', nullable: true, transformer: jsonArrayTransformer })
  public discordIds: string[];

  @Column({ nullable: true })
  public pushbulletAccessToken?: string;

  @Column({ nullable: true })
  public pushoverApplicationToken?: string;

  @Column({ nullable: true })
  public pushoverUserKey?: string;

  @Column({ nullable: true })
  public pushoverSound?: string;

  @Column({ type: 'text', nullable: true })
  public spotifyAccessToken?: string | null;

  @Column({ type: 'text', nullable: true })
  public spotifyRefreshToken?: string | null;

  @Column({ type: 'text', nullable: true })
  public spotifyUserId?: string | null;

  @Column({ type: 'text', nullable: true })
  public spotifyDisplayName?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public spotifyTokenExpiresAt?: Date | null;

  @Column({ nullable: true })
  public telegramChatId?: string;

  @Column({ nullable: true })
  public telegramMessageThreadId?: string;

  @Column({ nullable: true })
  public telegramSendSilently?: boolean;

  @Column({ nullable: true })
  public watchlistSyncMovies?: boolean;

  @Column({ nullable: true })
  public watchlistSyncTv?: boolean;

  @Column({ nullable: true })
  public watchlistSyncMusic?: boolean;

  @Column({ nullable: true })
  public watchlistSyncBooks?: boolean;

  @Column({ nullable: true })
  public watchlistSyncComics?: boolean;

  @Column({ nullable: true })
  public watchlistSyncMagazines?: boolean;

  @Column({ type: 'varchar', nullable: true })
  public cardTextVisibilityMovie?: CardTextVisibility;

  @Column({ type: 'varchar', nullable: true })
  public cardTextVisibilityTv?: CardTextVisibility;

  @Column({ type: 'varchar', nullable: true })
  public cardTextVisibilityAlbum?: CardTextVisibility;

  @Column({ type: 'varchar', nullable: true })
  public cardTextVisibilityBook?: CardTextVisibility;

  @Column({ default: false })
  public detailDisclosureCastPinned: boolean;

  @Column({ default: false })
  public detailDisclosureCrewPinned: boolean;

  @Column({ default: false })
  public detailDisclosureArtistsPinned: boolean;

  @Column({ default: false })
  public detailDisclosureSubjectTagsPinned: boolean;

  @Column({ type: 'simple-json', nullable: true })
  public detailDisclosurePins?: UserSettingsDetailDisclosuresByMedia;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): Partial<NotificationAgentTypes> => {
        return deserializeNotificationTypes(value);
      },
      to: serializeNotificationTypes,
    },
  })
  public notificationTypes: Partial<NotificationAgentTypes>;

  public hasNotificationType(
    key: NotificationAgentKey,
    type: Notification
  ): boolean {
    return hasNotificationType(type, this.notificationTypes[key] ?? 0);
  }

  /**
   * Return only settings needed by the general user payload. Notification
   * credentials are exposed through their dedicated, redacted endpoint and
   * must never be included in an eagerly loaded User response.
   */
  public filter(): Partial<UserSettings> {
    return {
      id: this.id,
      locale: this.locale,
      discoverRegion: this.discoverRegion,
      streamingRegion: this.streamingRegion,
      originalLanguage: this.originalLanguage,
      preferredLanguages: this.preferredLanguages,
      discordIds: this.discordIds,
      notificationTypes: this.notificationTypes,
      watchlistSyncMovies: this.watchlistSyncMovies,
      watchlistSyncTv: this.watchlistSyncTv,
      watchlistSyncMusic: this.watchlistSyncMusic,
      watchlistSyncBooks: this.watchlistSyncBooks,
      watchlistSyncComics: this.watchlistSyncComics,
      watchlistSyncMagazines: this.watchlistSyncMagazines,
      cardTextVisibilityMovie: this.cardTextVisibilityMovie,
      cardTextVisibilityTv: this.cardTextVisibilityTv,
      cardTextVisibilityAlbum: this.cardTextVisibilityAlbum,
      cardTextVisibilityBook: this.cardTextVisibilityBook,
      detailDisclosureCastPinned: this.detailDisclosureCastPinned,
      detailDisclosureCrewPinned: this.detailDisclosureCrewPinned,
      detailDisclosureArtistsPinned: this.detailDisclosureArtistsPinned,
      detailDisclosureSubjectTagsPinned: this.detailDisclosureSubjectTagsPinned,
      detailDisclosurePins: this.detailDisclosurePins,
    };
  }

  public toJSON(): Partial<UserSettings> {
    return this.filter();
  }
}
