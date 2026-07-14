import type {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';

export interface DiscoverHomeRowDescriptor {
  key: string;
  sliderId: number;
  type: number;
  title?: string;
  data?: string;
  endpoint?: string;
  /** Tracks descriptor changes only. Catalog content is revalidated by row ETags. */
  descriptorRevision: string;
}

export interface DiscoverHomeManifest {
  version: 1;
  layoutRevision: string;
  userStateRevision: string;
  generatedAt: string;
  freshness: {
    manifestMaxAgeSeconds: number;
    rowMaxAgeSeconds: number;
    stateMaxAgeSeconds: number;
  };
  rows: DiscoverHomeRowDescriptor[];
}

export interface DiscoverHomeStateItem {
  key: string;
  mediaType: MediaType;
  id: number | string;
  media: {
    id: number;
    status: MediaStatus;
    status4k: MediaStatus;
    updatedAt: string;
  } | null;
  request: {
    id: number;
    status: MediaRequestStatus;
    is4k: boolean;
    updatedAt: string;
  } | null;
  watchlisted: boolean;
}

export interface DiscoverHomeStateResponse {
  revision: string;
  generatedAt: string;
  items: DiscoverHomeStateItem[];
}
