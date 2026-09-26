import type { SoftwareProviderSettings } from '@server/lib/settings';

export type SoftwareProviderConnection = SoftwareProviderSettings;

export interface SoftwareCatalogGame {
  id: string;
  igdbId: number;
  title: string;
  summary: string;
  coverUrl: string;
  releaseDate: string;
  platforms: string[];
  platformOptions: { id: number; name: string }[];
  genres: string[];
}

export interface SoftwareCatalogPlatform {
  id: number;
  name: string;
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
  | 'failed';

export interface SoftwareProviderRequest {
  externalRequestId: string;
  status: SoftwareProviderStatus;
  deliverable: boolean;
  error?: string | null;
  title?: string;
  game?: { id: string; title: string; status: string } | null;
  variant?: PcGameVariant;
  platform?: string;
}
