import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequestServiceTarget } from '@server/entity/MediaRequest';

interface MusicAvailabilityMedia {
  status?: MediaStatus;
  serviceId?: number | null;
  availableMusicServiceIds?: number[] | null;
}

interface MusicAvailabilityRequest {
  status?: MediaRequestStatus;
  serverId?: number | null;
  serviceTargets?: MediaRequestServiceTarget[] | null;
}

interface MusicAvailabilityService {
  id: number;
  name: string;
  activeProfileName: string;
}

export interface AvailableMusicService {
  serverId: number;
  quality: string;
}

export interface MusicQualityStatus {
  quality: 'MP3' | 'FLAC';
  status: MediaStatus;
}

const getMusicServiceQuality = (
  service: MusicAvailabilityService | undefined
): 'MP3' | 'FLAC' | undefined => {
  const label = `${service?.activeProfileName ?? ''} ${service?.name ?? ''}`
    .trim()
    .toLocaleUpperCase();

  if (label.includes('FLAC')) {
    return 'FLAC';
  }
  if (label.includes('MP3')) {
    return 'MP3';
  }

  return undefined;
};

const statusPriority: Partial<Record<MediaStatus, number>> = {
  [MediaStatus.PENDING]: 1,
  [MediaStatus.PROCESSING]: 2,
  [MediaStatus.PARTIALLY_AVAILABLE]: 3,
  [MediaStatus.AVAILABLE]: 4,
};

const isPosterQualityStatus = (
  status: MediaStatus | null | undefined
): status is MediaStatus => status != null && statusPriority[status] != null;

export const getAvailableMusicServices = (
  media: MusicAvailabilityMedia | null | undefined,
  requests: MusicAvailabilityRequest[],
  services: MusicAvailabilityService[]
): AvailableMusicService[] => {
  if (!media) {
    return [];
  }

  const availableServerIds = new Set<number>();
  if (media.availableMusicServiceIds != null) {
    for (const serverId of media.availableMusicServiceIds ?? []) {
      if (Number.isSafeInteger(serverId) && serverId >= 0) {
        availableServerIds.add(serverId);
      }
    }
  } else if (
    media.status === MediaStatus.AVAILABLE &&
    media.serviceId != null
  ) {
    // Compatibility for rows created before per-destination availability was
    // persisted. The next complete Lidarr scan replaces this fallback.
    availableServerIds.add(media.serviceId);
  }
  for (const request of requests) {
    for (const target of request.serviceTargets ?? []) {
      if (
        target.serviceType === 'lidarr' &&
        target.format === 'music' &&
        target.status === MediaStatus.AVAILABLE
      ) {
        availableServerIds.add(target.serverId);
      }
    }
  }

  return services.flatMap((service) => {
    if (!availableServerIds.has(service.id)) {
      return [];
    }
    const quality = (service.activeProfileName || service.name).trim();
    return quality
      ? [{ serverId: service.id, quality: quality.toLocaleUpperCase() }]
      : [];
  });
};

export const getAvailableMusicQualities = (
  media: MusicAvailabilityMedia | null | undefined,
  requests: MusicAvailabilityRequest[],
  services: MusicAvailabilityService[]
): ('MP3' | 'FLAC')[] => {
  const availableServiceQualities = getAvailableMusicServices(
    media,
    requests,
    services
  ).map((service) => service.quality.toLocaleUpperCase());

  return (['MP3', 'FLAC'] as const).filter((quality) =>
    availableServiceQualities.some((serviceQuality) =>
      serviceQuality.includes(quality)
    )
  );
};

export const getMusicQualityStatuses = (
  media: MusicAvailabilityMedia | null | undefined,
  requests: MusicAvailabilityRequest[],
  services: MusicAvailabilityService[]
): MusicQualityStatus[] => {
  const statuses = new Map<'MP3' | 'FLAC', MediaStatus>();
  const setStatus = (quality: 'MP3' | 'FLAC', status: MediaStatus) => {
    const current = statuses.get(quality);
    if (
      current === undefined ||
      (statusPriority[status] ?? 0) > (statusPriority[current] ?? 0)
    ) {
      statuses.set(quality, status);
    }
  };
  const serviceById = new Map(services.map((service) => [service.id, service]));

  for (const available of getAvailableMusicServices(
    media,
    requests,
    services
  )) {
    const quality = getMusicServiceQuality(serviceById.get(available.serverId));
    if (quality) {
      setStatus(quality, MediaStatus.AVAILABLE);
    }
  }

  for (const request of requests) {
    if (
      request.status === MediaRequestStatus.DECLINED ||
      request.status === MediaRequestStatus.FAILED
    ) {
      continue;
    }

    const explicitTargets = (request.serviceTargets ?? []).filter(
      (target) => target.serviceType === 'lidarr' && target.format === 'music'
    );
    const targets =
      explicitTargets.length > 0
        ? explicitTargets
        : request.serverId != null
          ? [{ serverId: request.serverId, status: media?.status }]
          : [];

    for (const target of targets) {
      const quality = getMusicServiceQuality(serviceById.get(target.serverId));
      if (!quality || statuses.get(quality) === MediaStatus.AVAILABLE) {
        continue;
      }

      const status = isPosterQualityStatus(target.status)
        ? target.status
        : request.status === MediaRequestStatus.PENDING
          ? MediaStatus.PENDING
          : request.status === MediaRequestStatus.APPROVED
            ? MediaStatus.PROCESSING
            : undefined;
      if (status !== undefined) {
        setStatus(quality, status);
      }
    }
  }

  if (media?.serviceId != null && isPosterQualityStatus(media.status)) {
    const quality = getMusicServiceQuality(serviceById.get(media.serviceId));
    if (quality) {
      setStatus(quality, media.status);
    }
  }

  return (['MP3', 'FLAC'] as const).flatMap((quality) => {
    const status = statuses.get(quality);
    return status === undefined ? [] : [{ quality, status }];
  });
};
