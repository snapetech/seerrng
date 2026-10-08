import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import OverrideRule from '@server/entity/OverrideRule';
import {
  MAX_SERVARR_SERVICE_ID,
  type ServarrServiceType,
} from '@server/lib/serviceAdmission';
import { In } from 'typeorm';

export { MAX_SERVARR_SERVICE_ID } from '@server/lib/serviceAdmission';
const activeRequestStatuses = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
  MediaRequestStatus.FAILED,
];

const mediaTypeByService: Record<ServarrServiceType, MediaType> = {
  radarr: MediaType.MOVIE,
  sonarr: MediaType.TV,
  sportarr: MediaType.SPORTS,
  lidarr: MediaType.MUSIC,
  readarr: MediaType.BOOK,
  // Mylar, Kapowarr, and BackIssue all fulfill comics, so they share one ID space keyed
  // to MediaType.COMIC (mirrors how ebook/audiobook Readarr instances share
  // MediaType.BOOK's ID space today).
  mylar: MediaType.COMIC,
  kapowarr: MediaType.COMIC,
  backissue: MediaType.COMIC,
  lazylibrarian: MediaType.MAGAZINE,
};

export const getHistoricalComicServiceIdMaximum = async (): Promise<number> =>
  Math.max(
    await getHistoricalServarrServiceIdMaximum('mylar'),
    await getHistoricalServarrServiceIdMaximum('kapowarr'),
    await getHistoricalServarrServiceIdMaximum('backissue')
  );

const overrideColumnByService: Partial<
  Record<
    ServarrServiceType,
    'radarrServiceId' | 'sonarrServiceId' | 'lidarrServiceId'
  >
> = {
  radarr: 'radarrServiceId',
  sonarr: 'sonarrServiceId',
  lidarr: 'lidarrServiceId',
};

const parseStoredServiceId = (value: unknown): number => {
  if (value === null || value === undefined) {
    return -1;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_SERVARR_SERVICE_ID
  ) {
    throw new Error('Stored service ID is outside the supported range.');
  }
  return parsed;
};

export const getHistoricalServarrServiceIdMaximum = async (
  serviceType: ServarrServiceType
): Promise<number> => {
  const mediaType = mediaTypeByService[serviceType];
  const overrideColumn = overrideColumnByService[serviceType];
  const [requestMaximum, mediaMaximum, overrideMaximum] = await Promise.all([
    getRepository(MediaRequest)
      .createQueryBuilder('request')
      .select('MAX(request.serverId)', 'maximum')
      .where('request.type = :mediaType', { mediaType })
      .getRawOne<{ maximum: unknown }>(),
    getRepository(Media)
      .createQueryBuilder('media')
      .select('MAX(media.serviceId)', 'standardMaximum')
      .addSelect('MAX(media.serviceId4k)', 'fourKMaximum')
      .where('media.mediaType = :mediaType', { mediaType })
      .getRawOne<{ standardMaximum: unknown; fourKMaximum: unknown }>(),
    !overrideColumn
      ? Promise.resolve({ maximum: null as unknown })
      : getRepository(OverrideRule)
          .createQueryBuilder('rule')
          .select(`MAX(rule.${overrideColumn})`, 'maximum')
          .getRawOne<{ maximum: unknown }>(),
  ]);

  return Math.max(
    parseStoredServiceId(requestMaximum?.maximum),
    parseStoredServiceId(mediaMaximum?.standardMaximum),
    parseStoredServiceId(mediaMaximum?.fourKMaximum),
    parseStoredServiceId(overrideMaximum?.maximum)
  );
};

export const allocateServarrServiceId = (
  currentIds: number[],
  historicalMaximum: number
): number => {
  if (
    !Number.isSafeInteger(historicalMaximum) ||
    historicalMaximum < -1 ||
    historicalMaximum > MAX_SERVARR_SERVICE_ID
  ) {
    throw new Error('Stored service ID is outside the supported range.');
  }
  const maximum = Math.max(
    historicalMaximum,
    ...currentIds.map(parseStoredServiceId)
  );
  if (maximum >= MAX_SERVARR_SERVICE_ID) {
    throw new Error('No service IDs remain in the supported range.');
  }
  return maximum + 1;
};

export class ServarrServiceInUseError extends Error {
  public readonly status = 409;
}

export const assertServarrServiceCanBeRemoved = async (
  serviceType: ServarrServiceType,
  serviceId: number
): Promise<void> => {
  const overrideColumn = overrideColumnByService[serviceType];
  const activeRequestCount = await getRepository(MediaRequest).count({
    where: {
      type: mediaTypeByService[serviceType],
      serverId: serviceId,
      status: In(activeRequestStatuses),
    },
  });
  const overrideRuleCount = overrideColumn
    ? await getRepository(OverrideRule).count({
        where: { [overrideColumn]: serviceId },
      })
    : 0;

  if (activeRequestCount > 0 || overrideRuleCount > 0) {
    const references = [
      activeRequestCount > 0
        ? `${activeRequestCount} active request${activeRequestCount === 1 ? '' : 's'}`
        : '',
      overrideRuleCount > 0
        ? `${overrideRuleCount} override rule${overrideRuleCount === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);
    throw new ServarrServiceInUseError(
      `Service is still referenced by ${references.join(' and ')}.`
    );
  }
};

export const assertServarrServiceCanChangeKind = async (
  serviceType: ServarrServiceType,
  serviceId: number
): Promise<void> => {
  const activeRequestCount = await getRepository(MediaRequest).count({
    where: {
      type: mediaTypeByService[serviceType],
      serverId: serviceId,
      status: In(activeRequestStatuses),
    },
  });
  if (activeRequestCount > 0) {
    throw new ServarrServiceInUseError(
      `Service routing cannot change while referenced by ${activeRequestCount} active request${activeRequestCount === 1 ? '' : 's'}.`
    );
  }
};
