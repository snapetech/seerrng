import { MediaStatus } from '@server/constants/media';
import type { AlbumResult, MediaType } from '@server/models/Search';

export type TitleCardQuality = 'HD' | '4K' | 'MP3' | 'FLAC';

export interface TitleCardStatusBadge {
  quality?: TitleCardQuality;
  status: MediaStatus;
  inProgress: boolean;
}

export const getTitleCardStatusBadgeSlots = (
  badges: TitleCardStatusBadge[]
): {
  primary?: TitleCardStatusBadge;
  secondary?: TitleCardStatusBadge;
} => ({
  primary: badges.find(
    (badge) =>
      badge.quality === 'HD' || badge.quality === 'MP3' || !badge.quality
  ),
  secondary: badges.find(
    (badge) => badge.quality === '4K' || badge.quality === 'FLAC'
  ),
});

interface GetTitleCardStatusBadgesOptions {
  mediaType: MediaType;
  status?: MediaStatus;
  status4k?: MediaStatus;
  inProgress?: boolean;
  inProgress4k?: boolean;
  availableQualities?: ('MP3' | 'FLAC')[];
  qualityStatuses?: AlbumResult['qualityStatuses'];
}

const hasVisibleStatus = (
  status: MediaStatus | undefined
): status is MediaStatus =>
  status !== undefined &&
  [
    MediaStatus.PENDING,
    MediaStatus.PROCESSING,
    MediaStatus.PARTIALLY_AVAILABLE,
    MediaStatus.AVAILABLE,
  ].includes(status);

export const getTitleCardStatusBadges = ({
  mediaType,
  status,
  status4k,
  inProgress = false,
  inProgress4k = false,
  availableQualities,
  qualityStatuses,
}: GetTitleCardStatusBadgesOptions): TitleCardStatusBadge[] => {
  if (
    mediaType === 'movie' ||
    mediaType === 'tv' ||
    mediaType === 'collection'
  ) {
    return [
      ...(hasVisibleStatus(status)
        ? [{ quality: 'HD' as const, status, inProgress }]
        : []),
      ...(hasVisibleStatus(status4k)
        ? [
            {
              quality: '4K' as const,
              status: status4k,
              inProgress: inProgress4k,
            },
          ]
        : []),
    ];
  }

  if (mediaType === 'album') {
    if (qualityStatuses?.length) {
      return (['MP3', 'FLAC'] as const).flatMap((quality) => {
        const qualityStatus = qualityStatuses.find(
          (candidate) => candidate.quality === quality
        );
        return qualityStatus ? [{ ...qualityStatus, inProgress: false }] : [];
      });
    }

    if (availableQualities?.length) {
      return (['MP3', 'FLAC'] as const)
        .filter((quality) => availableQualities.includes(quality))
        .map((quality) => ({
          quality,
          status: MediaStatus.AVAILABLE,
          inProgress: false,
        }));
    }
  }

  return hasVisibleStatus(status) ? [{ status, inProgress }] : [];
};
