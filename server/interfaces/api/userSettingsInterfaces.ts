import type {
  NotificationAgentKey,
  PublicOidcProvider,
} from '@server/lib/settings';

export type CardTextVisibility = 'always' | 'hover';

export type PreferredLanguageMediaType = 'movie' | 'tv' | 'music' | 'book';

export interface UserPreferredLanguages {
  all?: string;
  movie?: string | null;
  tv?: string | null;
  music?: string | null;
  book?: string | null;
}

export interface UserSettingsCardTextResponse {
  movie?: CardTextVisibility;
  tv?: CardTextVisibility;
  album?: CardTextVisibility;
  book?: CardTextVisibility;
}

export type DetailDisclosurePin = 'cast' | 'crew' | 'artists' | 'subjectTags';

export type DetailDisclosureMediaType = 'movie' | 'tv' | 'music' | 'book';

export interface UserSettingsDetailDisclosureResponse {
  cast?: boolean;
  crew?: boolean;
  artists?: boolean;
  subjectTags?: boolean;
}

export type UserSettingsDetailDisclosuresByMedia = Partial<
  Record<DetailDisclosureMediaType, UserSettingsDetailDisclosureResponse>
>;

export interface UserSettingsGeneralResponse {
  username?: string;
  email?: string;
  discordIds?: string[];
  locale?: string;
  discoverRegion?: string;
  streamingRegion?: string;
  originalLanguage?: string;
  preferredLanguages?: UserPreferredLanguages;
  movieQuotaLimit?: number;
  movieQuotaDays?: number;
  tvQuotaLimit?: number;
  tvQuotaDays?: number;
  musicQuotaLimit?: number;
  musicQuotaDays?: number;
  bookQuotaLimit?: number;
  bookQuotaDays?: number;
  comicQuotaLimit?: number;
  comicQuotaDays?: number;
  magazineQuotaLimit?: number;
  magazineQuotaDays?: number;
  softwareQuotaLimit?: number;
  softwareQuotaDays?: number;
  globalMovieQuotaDays?: number;
  globalMovieQuotaLimit?: number;
  globalTvQuotaLimit?: number;
  globalTvQuotaDays?: number;
  globalMusicQuotaDays?: number;
  globalMusicQuotaLimit?: number;
  globalBookQuotaDays?: number;
  globalBookQuotaLimit?: number;
  globalComicQuotaDays?: number;
  globalComicQuotaLimit?: number;
  globalMagazineQuotaDays?: number;
  globalMagazineQuotaLimit?: number;
  globalSoftwareQuotaDays?: number;
  globalSoftwareQuotaLimit?: number;
  watchlistSyncMovies?: boolean;
  watchlistSyncTv?: boolean;
  watchlistSyncMusic?: boolean;
  watchlistSyncBooks?: boolean;
  watchlistSyncComics?: boolean;
  watchlistSyncMagazines?: boolean;
  cardTextVisibility?: UserSettingsCardTextResponse;
}

export type NotificationAgentTypes = Record<NotificationAgentKey, number>;
export interface UserSettingsNotificationsResponse {
  emailEnabled?: boolean;
  pgpKey?: string;
  discordEnabled?: boolean;
  discordEnabledTypes?: number;
  discordIds?: string[];
  pushbulletAccessToken?: string;
  pushoverApplicationToken?: string;
  pushoverUserKey?: string;
  pushoverSound?: string;
  telegramEnabled?: boolean;
  telegramBotUsername?: string;
  telegramChatId?: string;
  telegramMessageThreadId?: string;
  telegramSendSilently?: boolean;
  webPushEnabled?: boolean;
  notificationTypes: Partial<NotificationAgentTypes>;
}

export type UserSettingsLinkedAccount = {
  id: number;
  username: string;
  provider: PublicOidcProvider;
};

export type UserSettingsLinkedAccountResponse = UserSettingsLinkedAccount[];
