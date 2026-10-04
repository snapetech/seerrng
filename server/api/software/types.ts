import type { SoftwareProviderSettings } from '@server/lib/settings';

export type SoftwareProviderConnection = SoftwareProviderSettings;

export interface SoftwareProviderCapabilities {
  catalog: boolean;
  datCatalog?: boolean;
  pcAcquisition: boolean;
  emulationAcquisition: boolean;
  requestActions: { retry: boolean; cancel: boolean };
  assetStreaming: boolean;
}

export interface SoftwareProviderHandshake {
  service: string;
  version?: string;
  apiVersion: number;
  requestContractVersion?: number;
  capabilities?: SoftwareProviderCapabilities;
}

export interface SoftwareProviderActions {
  retry: boolean;
  cancel: boolean;
  cancelReason?: string;
}

export interface SoftwareCatalogGame {
  id: string;
  catalogProvider?: 'igdb' | 'dat';
  catalogId?: string;
  igdbId?: number;
  title: string;
  summary: string;
  coverUrl: string;
  releaseDate: string;
  /** Exact day-precision release for the requested IGDB platform, when asked. */
  platformReleaseDate?: string | null;
  platforms: string[];
  platformOptions: { id?: number; key?: string; name: string }[];
  genres: string[];
  rating?: number | null;
  publishers?: string[];
  developers?: string[];
  screenshots?: string[];
  videos?: { name: string; videoId: string }[];
  source?: 'IGDB' | 'DAT';
  dat?: {
    name: string;
    version: string;
    entry: string;
    variants: number;
  };
}

export interface SoftwareCatalogPlatform {
  id: number;
  name: string;
}

export interface SoftwareDatCatalogPlatform {
  slug: string;
  name: string;
  gameCount: number;
}

export interface SoftwareDatCatalogPlatformsResponse {
  results: SoftwareDatCatalogPlatform[];
  unmatchedDatNames: string[];
}

export interface SoftwareAsset {
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface SoftwareAssetsResponse {
  assets: SoftwareAsset[];
  bundleSupported: boolean;
}

export type PcOperatingSystem = 'windows' | 'linux' | 'macos';
export type PcArchitecture = 'x64' | 'arm64' | 'x86' | 'universal';

export interface PcGameVariant {
  operatingSystem: PcOperatingSystem;
  architecture: PcArchitecture;
}

export type SoftwareProviderStatus =
  | 'accepted'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'cancelled';

export interface SoftwareProviderRequest {
  externalRequestId: string;
  status: SoftwareProviderStatus;
  stage?: string | null;
  percent?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  deliverable: boolean;
  error?: string | null;
  title?: string;
  game?: { id: string; title: string; status: string } | null;
  variant?: PcGameVariant;
  platform?: string;
  identity?: {
    catalogProvider: string;
    catalogId?: number;
    catalogKey?: string;
    platformId?: number;
    platformSlug?: string;
  } | null;
  actions?: SoftwareProviderActions | null;
}
