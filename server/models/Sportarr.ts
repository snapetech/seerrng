import type { SportarrLeague } from '@server/api/servarr/sportarr';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';

export type SportarrLibraryState =
  'not-added' | 'monitored' | 'unmonitored' | 'requested';

export interface SportarrResult {
  id: string;
  provider: 'sportarr';
  mediaType: 'sports';
  title: string;
  overview: string;
  sport?: string;
  country?: string;
  year?: number;
  posterPath?: string;
  requestable: boolean;
  libraryState: SportarrLibraryState;
  mediaInfo?: Media;
}

export type SportarrDetails = SportarrResult & {
  status?: MediaStatus;
  sportarrId?: number;
  eventsAvailable: boolean;
};

const hasActiveRequest = (media: Media | undefined): boolean =>
  Boolean(
    media?.requests?.some(
      (request) =>
        request.status === MediaRequestStatus.PENDING ||
        request.status === MediaRequestStatus.APPROVED
    )
  );

export const mapSportarrLeague = (
  league: SportarrLeague,
  media?: Media,
  serverId?: number
): SportarrDetails => {
  const activeRequest = hasActiveRequest(media);
  const libraryState: SportarrLibraryState = league.id
    ? league.monitored
      ? 'monitored'
      : 'unmonitored'
    : activeRequest
      ? 'requested'
      : 'not-added';

  return {
    id: league.externalId,
    provider: 'sportarr',
    mediaType: 'sports',
    title: league.title,
    overview: league.overview,
    ...(league.sport ? { sport: league.sport } : {}),
    ...(league.country ? { country: league.country } : {}),
    ...(league.year ? { year: league.year } : {}),
    ...(serverId !== undefined && league.images.length > 0
      ? {
          posterPath: `/api/v1/sportarr/cover/${serverId}/${encodeURIComponent(league.externalId)}`,
        }
      : {}),
    requestable: libraryState === 'not-added',
    libraryState,
    eventsAvailable: Boolean(league.id && league.monitored),
    ...(league.id ? { sportarrId: league.id } : {}),
    ...(media ? { mediaInfo: media } : {}),
    ...(libraryState === 'monitored' || libraryState === 'requested'
      ? { status: MediaStatus.PROCESSING }
      : undefined),
  };
};
