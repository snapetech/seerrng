import type { MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type {
  RequestStatusHistoryItem,
  RequestStatusSnapshot,
} from '@server/lib/requestStatus';
import type {
  RequestStatusSortDirection,
  RequestStatusSortField,
} from '@server/lib/requestStatusSort';
import type { NonFunctionProperties, PaginatedResponse } from './common';

export interface RequestResultsResponse extends PaginatedResponse {
  results: (NonFunctionProperties<MediaRequest> & {
    profileName?: string;
    canRemove?: boolean;
  })[];
  status?: number;
  message?: string;
  serviceErrors: {
    radarr: { id: number; name: string }[];
    sonarr: { id: number; name: string }[];
    lidarr: { id: number; name: string }[];
    readarr: { id: number; name: string }[];
  };
}

export type MediaRequestBody = {
  mediaType: MediaType;
  mediaId: number | string;
  tvdbId?: number;
  seasons?: number[] | 'all';
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  languageProfileId?: number;
  metadataProfileId?: number;
  format?: 'ebook' | 'audiobook' | 'both';
  editionId?: string;
  isbn13?: string;
  authorId?: string;
  userId?: number;
  tags?: number[];
  ignoreQuota?: boolean;
};

export type BulkMediaRequestItem = {
  mediaId: string;
  title?: string;
  isbn13?: string;
  editionId?: string;
  authorId?: string;
};

export type BulkMediaRequestBody = {
  mediaType: MediaType.MUSIC | MediaType.BOOK;
  items: BulkMediaRequestItem[];
  format?: 'ebook' | 'audiobook' | 'both';
  serverId?: number;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  metadataProfileId?: number;
  userId?: number;
  tags?: number[];
};

export type BulkMediaRequestResult = {
  mediaId: string;
  title?: string;
  reason: string;
};

export type BulkMediaRequestResponse = {
  created: MediaRequest[];
  skipped: BulkMediaRequestResult[];
  failed: BulkMediaRequestResult[];
};

export interface RequestStatusResultsResponse extends PaginatedResponse {
  results: {
    request: NonFunctionProperties<MediaRequest>;
    status: RequestStatusSnapshot;
  }[];
  counts: {
    total: number;
    active: number;
    attention: number;
    completed: number;
  };
}

export interface RequestStatusUsersResponse extends PaginatedResponse {
  results: {
    id: number;
    displayName: string;
    avatar: string;
  }[];
}

export type RequestStatusQuery = {
  requestedBy?: number;
  mediaType?: MediaType | 'all';
  bookFormat?: 'ebook' | 'audiobook';
  filter?: string;
  sort?: RequestStatusSortField;
  sortDirection?: RequestStatusSortDirection;
};

export interface RequestStatusDetailResponse {
  request: NonFunctionProperties<MediaRequest>;
  current: RequestStatusSnapshot;
  history: {
    results: RequestStatusHistoryItem[];
    total: number;
  };
}
