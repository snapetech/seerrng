import { MediaRequestStatus, MediaStatus } from '@server/constants/media';

export type RequestServiceType =
  | 'radarr'
  | 'sonarr'
  | 'sportarr'
  | 'lidarr'
  | 'readarr'
  | 'mylar'
  | 'kapowarr'
  | 'backissue'
  | 'lazylibrarian';
export type RequestTargetFormat =
  | 'standard'
  | '4k'
  | 'music'
  | 'ebook'
  | 'audiobook'
  | 'comic'
  | 'magazine'
  | 'sports';

export interface RequestDestination {
  serviceType: RequestServiceType;
  format: RequestTargetFormat;
  serverId: number | null;
  profileId?: number | null;
  metadataProfileId?: number | null;
  languageProfileId?: number | null;
  rootFolder?: string | null;
  status?: MediaStatus | null;
}

export interface StoredRequestDestination {
  id?: number;
  status: MediaRequestStatus;
  type?: string | null;
  is4k?: boolean | null;
  serverId?: number | null;
  profileId?: number | null;
  metadataProfileId?: number | null;
  languageProfileId?: number | null;
  rootFolder?: string | null;
  bookFormat?: 'ebook' | 'audiobook' | 'both' | null;
  serviceTargets?: RequestDestination[] | null;
  requestedBy?: { id: number } | null;
}

const sameNullableValue = <T>(
  left: T | null | undefined,
  right: T | null | undefined
) => (left ?? null) === (right ?? null);

export const isExactRequestDestination = (
  left: RequestDestination,
  right: RequestDestination
): boolean =>
  left.serviceType === right.serviceType &&
  left.format === right.format &&
  left.serverId === right.serverId &&
  sameNullableValue(left.profileId, right.profileId) &&
  sameNullableValue(left.metadataProfileId, right.metadataProfileId) &&
  sameNullableValue(left.languageProfileId, right.languageProfileId) &&
  sameNullableValue(left.rootFolder, right.rootFolder);

const legacyValueCovers = <T>(
  stored: T | null | undefined,
  selected: T | null | undefined
) => stored == null || stored === selected;

export const legacyRequestDestinationCovers = (
  stored: RequestDestination,
  selected: RequestDestination
): boolean =>
  stored.serviceType === selected.serviceType &&
  stored.format === selected.format &&
  legacyValueCovers(stored.serverId, selected.serverId) &&
  legacyValueCovers(stored.profileId, selected.profileId) &&
  legacyValueCovers(stored.metadataProfileId, selected.metadataProfileId) &&
  legacyValueCovers(stored.languageProfileId, selected.languageProfileId) &&
  legacyValueCovers(stored.rootFolder, selected.rootFolder);

export const isActiveRequestStatus = (status: MediaRequestStatus): boolean =>
  status !== MediaRequestStatus.DECLINED &&
  status !== MediaRequestStatus.FAILED &&
  status !== MediaRequestStatus.COMPLETED;

const getLegacyRequestDestinations = (
  request: StoredRequestDestination
): RequestDestination[] => {
  const base = {
    serverId: request.serverId ?? null,
    profileId: request.profileId,
    metadataProfileId: request.metadataProfileId,
    languageProfileId: request.languageProfileId,
    rootFolder: request.rootFolder,
  };

  if (request.type === 'movie') {
    return [
      {
        ...base,
        serviceType: 'radarr',
        format: request.is4k ? '4k' : 'standard',
      },
    ];
  }
  if (request.type === 'tv') {
    return [
      {
        ...base,
        serviceType: 'sonarr',
        format: request.is4k ? '4k' : 'standard',
      },
    ];
  }
  if (request.type === 'sports') {
    return [{ ...base, serviceType: 'sportarr', format: 'sports' }];
  }
  if (request.type === 'music') {
    return [{ ...base, serviceType: 'lidarr', format: 'music' }];
  }
  if (request.type === 'book') {
    const format = request.bookFormat ?? 'ebook';
    const bookFormats: ('ebook' | 'audiobook')[] =
      format === 'both' ? ['ebook', 'audiobook'] : [format];
    return bookFormats.map((bookFormat) => ({
      ...base,
      serviceType: 'readarr' as const,
      format: bookFormat,
    }));
  }

  if (request.type === 'magazine') {
    return [{ ...base, serviceType: 'lazylibrarian', format: 'magazine' }];
  }

  return [];
};

export const getStoredRequestDestinations = (
  request: StoredRequestDestination
): { targets: RequestDestination[]; legacy: boolean } => {
  if (request.serviceTargets?.length) {
    return { targets: request.serviceTargets, legacy: false };
  }

  return { targets: getLegacyRequestDestinations(request), legacy: true };
};

export const isDestinationCoveredByActiveRequest = (
  requests: StoredRequestDestination[] | null | undefined,
  selected: RequestDestination
): boolean => !!getActiveRequestForDestination(requests, selected);

export const getActiveRequestForDestination = <
  T extends StoredRequestDestination,
>(
  requests: T[] | null | undefined,
  selected: RequestDestination
): T | undefined =>
  (requests ?? []).find((request) => {
    if (!isActiveRequestStatus(request.status)) {
      return false;
    }

    const { targets, legacy } = getStoredRequestDestinations(request);
    return targets.some((target) =>
      legacy
        ? legacyRequestDestinationCovers(target, selected)
        : isExactRequestDestination(target, selected)
    );
  });

export const isDestinationAvailableInTargets = (
  requests: StoredRequestDestination[] | null | undefined,
  selected: RequestDestination
): boolean =>
  (requests ?? []).some((request) =>
    (request.serviceTargets ?? []).some(
      (target) =>
        target.status === MediaStatus.AVAILABLE &&
        isExactRequestDestination(target, selected)
    )
  );

export const hasTrackedAvailableDestination = (
  requests: StoredRequestDestination[] | null | undefined,
  selected: Pick<RequestDestination, 'serviceType' | 'format'>
): boolean =>
  (requests ?? []).some((request) =>
    (request.serviceTargets ?? []).some(
      (target) =>
        target.status === MediaStatus.AVAILABLE &&
        target.serviceType === selected.serviceType &&
        target.format === selected.format
    )
  );
