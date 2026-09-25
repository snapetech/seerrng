import type { QualityProfile, RootFolder, Tag } from '@server/api/servarr/base';
import type { LanguageProfile } from '@server/api/servarr/sonarr';
import type { BookshelfProvider } from '@server/utils/bookshelfProvider';

export interface ServiceCommonServer {
  id: number;
  name: string;
  is4k: boolean;
  isAlt?: boolean;
  isDefault: boolean;
  activeProfileId?: number;
  activeMetadataProfileId?: number;
  activeDirectory?: string;
  activeLanguageProfileId?: number;
  activeAnimeProfileId?: number;
  activeAnimeDirectory?: string;
  activeAnimeLanguageProfileId?: number;
  activeTags?: number[];
  activeAnimeTags?: number[];
  serviceType?: 'ebook' | 'audiobook';
  provider?: BookshelfProvider;
  providerNotice?: string;
  legacyWarning?: string;
  metadataSource?: string;
}

export interface ServiceCommonServerWithDetails {
  server: ServiceCommonServer;
  profiles: QualityProfile[];
  metadataProfiles?: QualityProfile[];
  rootFolders: Partial<RootFolder>[];
  languageProfiles?: LanguageProfile[];
  tags: Tag[];
}

// Comics don't share Servarr's quality-profile/root-folder concept, so this
// is deliberately a much smaller shape than ServiceCommonServer rather than
// a forced fit into it.
export interface ComicServiceOption {
  id: number;
  name: string;
  isDefault: boolean;
  backendType: 'mylar' | 'kapowarr';
}

export interface MagazineServiceOption {
  id: number;
  name: string;
  isDefault: boolean;
}
