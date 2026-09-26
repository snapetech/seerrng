import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import {
  getSettings,
  type DVRSettings,
  type KapowarrSettings,
  type LazyLibrarianSettings,
  type LidarrSettings,
  type MylarSettings,
  type RadarrSettings,
  type ReadarrSettings,
  type SonarrSettings,
} from '@server/lib/settings';
import AsyncLock from '@server/utils/asyncLock';

export type ServarrServiceType =
  | 'radarr'
  | 'sonarr'
  | 'lidarr'
  | 'readarr'
  | 'mylar'
  | 'kapowarr'
  | 'lazylibrarian';
export interface ServarrServiceSettingsByType {
  radarr: RadarrSettings;
  sonarr: SonarrSettings;
  lidarr: LidarrSettings;
  readarr: ReadarrSettings;
  mylar: MylarSettings;
  kapowarr: KapowarrSettings;
  lazylibrarian: LazyLibrarianSettings;
}
// Picked down to the fields Servarr-family services (which fully satisfy
// DVRSettings) share with the non-Servarr comics backends (Mylar/Kapowarr,
// which only satisfy the smaller CollectorServiceSettings) - is4k and
// serviceType stay Partial so services with no such concept (comics have
// neither) still satisfy this type.
export type ServarrServiceAuthority = Pick<
  DVRSettings,
  'id' | 'hostname' | 'port' | 'useSsl' | 'baseUrl' | 'apiKey' | 'syncEnabled'
> &
  Partial<Pick<DVRSettings, 'is4k'>> &
  Partial<Pick<ReadarrSettings, 'serviceType'>>;

export const hasSameServarrServiceAuthority = (
  current: ServarrServiceAuthority,
  snapshot: ServarrServiceAuthority
): boolean =>
  current.id === snapshot.id &&
  current.hostname === snapshot.hostname &&
  current.port === snapshot.port &&
  current.useSsl === snapshot.useSsl &&
  current.baseUrl === snapshot.baseUrl &&
  current.apiKey === snapshot.apiKey &&
  current.syncEnabled === snapshot.syncEnabled &&
  Boolean(current.is4k) === Boolean(snapshot.is4k) &&
  (current.serviceType ?? 'ebook') === (snapshot.serviceType ?? 'ebook');

export class ServarrServiceAuthorityChangedError extends Error {}
export const MAX_SERVARR_SERVICE_ID = 1_000_000_000;
const serviceAdmissionLock = new AsyncLock();

export const getServarrServiceCollectionAdmissionResource = (
  serviceType: ServarrServiceType
): string => `service-config:${serviceType}:collection`;

export const getServarrServiceAdmissionResource = (
  serviceType: ServarrServiceType,
  serviceId: number
): string => {
  if (
    !Number.isSafeInteger(serviceId) ||
    serviceId < 0 ||
    serviceId > MAX_SERVARR_SERVICE_ID
  ) {
    throw new Error('A valid service ID is required for service admission.');
  }
  return `service-config:${serviceType}:${serviceId}`;
};

const runWithServarrAdmissionResources = <Result>(
  resources: string[],
  callback: () => Promise<Result>
): Promise<Result> => {
  const orderedResources = [...new Set(resources)].sort();
  if (orderedResources.length === 0) {
    return callback();
  }

  const dispatch = (index: number): Promise<Result> =>
    index === orderedResources.length
      ? requestAdmissionCoordinator.run(orderedResources, callback)
      : serviceAdmissionLock.dispatch(orderedResources[index], () =>
          dispatch(index + 1)
        );
  return dispatch(0);
};

export const runWithServarrServiceAdmission = <Result>(
  services: { serviceType: ServarrServiceType; serviceId: number }[],
  callback: () => Promise<Result>
): Promise<Result> =>
  runWithServarrAdmissionResources(
    services.map(({ serviceType, serviceId }) =>
      getServarrServiceAdmissionResource(serviceType, serviceId)
    ),
    callback
  );

export const runWithServarrServiceCollectionAdmission = <Result>(
  serviceType: ServarrServiceType,
  callback: () => Promise<Result>
): Promise<Result> => {
  const resource = getServarrServiceCollectionAdmissionResource(serviceType);
  return runWithServarrAdmissionResources([resource], callback);
};

export const runWithServarrServiceCollectionMutationAdmission = <Result>(
  serviceType: ServarrServiceType,
  callback: () => Promise<Result>
): Promise<Result> =>
  runWithServarrServiceCollectionAdmission(serviceType, () =>
    runWithServarrServiceAdmission(
      getSettings()[serviceType].map(({ id }) => ({
        serviceType,
        serviceId: id,
      })),
      callback
    )
  );

export const runWithServarrServiceMutationAdmission = <Result>(
  services: { serviceType: ServarrServiceType; serviceId: number }[],
  callback: () => Promise<Result>
): Promise<Result> =>
  runWithServarrAdmissionResources(
    services.flatMap(({ serviceType, serviceId }) => [
      getServarrServiceCollectionAdmissionResource(serviceType),
      getServarrServiceAdmissionResource(serviceType, serviceId),
    ]),
    callback
  );

export const runWithCurrentServarrService = <
  ServiceType extends ServarrServiceType,
  Result,
>(
  serviceType: ServiceType,
  serviceId: number,
  callback: (
    service: ServarrServiceSettingsByType[ServiceType]
  ) => Promise<Result>
): Promise<Result | undefined> =>
  runWithServarrServiceAdmission([{ serviceType, serviceId }], async () => {
    const service = getSettings()[serviceType].find(
      (candidate) => candidate.id === serviceId
    ) as ServarrServiceSettingsByType[ServiceType] | undefined;

    return service ? callback(service) : undefined;
  });

export const runWithServarrServiceSnapshot = <
  ServiceType extends ServarrServiceType,
  Result,
>(
  serviceType: ServiceType,
  snapshot: ServarrServiceSettingsByType[ServiceType],
  callback: (
    service: ServarrServiceSettingsByType[ServiceType]
  ) => Promise<Result>
): Promise<Result> =>
  runWithServarrServiceSnapshots(serviceType, [snapshot], async ([current]) =>
    callback(current)
  );

export const runWithServarrServiceSnapshots = <
  ServiceType extends ServarrServiceType,
  Result,
>(
  serviceType: ServiceType,
  snapshots: ServarrServiceSettingsByType[ServiceType][],
  callback: (
    services: ServarrServiceSettingsByType[ServiceType][]
  ) => Promise<Result>,
  options: {
    requireExactAuthoritySet?: boolean;
    includeCurrent?: (
      service: ServarrServiceSettingsByType[ServiceType]
    ) => boolean;
  } = {}
): Promise<Result> => {
  if (snapshots.length === 0) {
    throw new ServarrServiceAuthorityChangedError(
      `No ${serviceType} service configuration was admitted.`
    );
  }
  const runAdmission = options.requireExactAuthoritySet
    ? runWithServarrServiceMutationAdmission
    : runWithServarrServiceAdmission;
  return runAdmission(
    snapshots.map((snapshot) => ({
      serviceType,
      serviceId: snapshot.id,
    })),
    async () => {
      const currentSettings = getSettings()[
        serviceType
      ] as ServarrServiceSettingsByType[ServiceType][];
      const includedCurrent = options.includeCurrent
        ? currentSettings.filter(options.includeCurrent)
        : currentSettings;
      if (
        options.requireExactAuthoritySet &&
        (includedCurrent.length !== snapshots.length ||
          includedCurrent.some(
            (current) =>
              !snapshots.some((snapshot) =>
                hasSameServarrServiceAuthority(current, snapshot)
              )
          ))
      ) {
        throw new ServarrServiceAuthorityChangedError(
          `${serviceType} service collection changed during operation.`
        );
      }
      const services = snapshots.map((snapshot) => {
        const current = currentSettings.find(
          (candidate) => candidate.id === snapshot.id
        ) as ServarrServiceSettingsByType[ServiceType] | undefined;
        if (!current || !hasSameServarrServiceAuthority(current, snapshot)) {
          throw new ServarrServiceAuthorityChangedError(
            `${serviceType} service configuration changed during operation.`
          );
        }
        return current;
      });
      return callback(services);
    }
  );
};
