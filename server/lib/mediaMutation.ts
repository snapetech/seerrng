import { MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import { runWithRequestAdmission } from '@server/entity/MediaRequest';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import AsyncLock from '@server/utils/asyncLock';

const mediaMutationLock = new AsyncLock();

export const getMediaMutationResource = (mediaId: number): string =>
  `media-row:${mediaId}`;

export const getMediaAdmissionResources = (media: Media): string[] => {
  if (media.mediaType === MediaType.MUSIC && media.mbId) {
    return [`request-canonical:music:${normalizeMusicBrainzId(media.mbId)}`];
  }
  if (media.mediaType === MediaType.BOOK) {
    return (media.identifiers ?? []).map(
      (identifier) =>
        `request-canonical:book:${identifier.provider}:${identifier.value}`
    );
  }
  if (media.mediaType === MediaType.COMIC) {
    return (media.identifiers ?? []).map(
      (identifier) =>
        `request-canonical:comic:${identifier.provider}:${identifier.value}`
    );
  }
  if (
    (media.mediaType === MediaType.MOVIE || media.mediaType === MediaType.TV) &&
    Number.isSafeInteger(media.tmdbId) &&
    media.tmdbId > 0
  ) {
    return [`request-media:${media.mediaType}:${media.tmdbId}`];
  }
  return [];
};

export const runMediaMutation = <Result>(
  mediaIds: number | number[],
  callback: () => Promise<Result>
): Promise<Result> => {
  const requestedIds = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
  if (
    requestedIds.length === 0 ||
    requestedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('A valid media ID is required for a media mutation.');
  }
  const ids = [...new Set(requestedIds)].sort((left, right) => left - right);

  const resources = ids.map(getMediaMutationResource);
  const dispatch = (index: number): Promise<Result> =>
    index === resources.length
      ? callback()
      : mediaMutationLock.dispatch(resources[index], () => dispatch(index + 1));

  return requestAdmissionCoordinator.run(resources, () => dispatch(0));
};

export const runMediaEntityMutation = <Result>(
  media: Media,
  callback: () => Promise<Result>
): Promise<Result> =>
  runWithRequestAdmission(getMediaAdmissionResources(media), () =>
    runMediaMutation(media.id, callback)
  );
