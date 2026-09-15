import ListenBrainzAPI from '@server/api/listenbrainz';
import MusicBrainz from '@server/api/musicbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import OverrideRule from '@server/entity/OverrideRule';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import {
  normalizeMusicBrainzId,
  normalizeOpenLibraryEditionId,
  normalizeOpenLibraryWorkId,
} from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { normalizeValidIsbn } from '@server/lib/isbn';
import {
  MediaServerUserAuthorityChangedError,
  assertMediaServerUserAuthorityCurrent,
  type MediaServerUserAuthoritySnapshot,
} from '@server/lib/mediaServerUserAuthority';
import type { Notification } from '@server/lib/notifications';
import notificationManager from '@server/lib/notifications';
import {
  getOverrideRuleProfileId,
  getOverrideRuleTagIds,
  overrideRuleMatchesUser,
  selectMostSpecificOverrideRule,
} from '@server/lib/overrideRules';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import requestAdmissionCoordinator from '@server/lib/requestAdmission';
import {
  hasTrackedAvailableDestination,
  isDestinationAvailableInTargets,
  isDestinationCoveredByActiveRequest,
  type RequestDestination,
} from '@server/lib/requestDestination';
import {
  runWithServarrServiceAdmission,
  type ServarrServiceType,
} from '@server/lib/serviceAdmission';
import {
  type ReadarrSettings,
  type SonarrSettings,
} from '@server/lib/settings';
import {
  isUserCredentialVersionCurrent,
  runUserSecurityMutation,
} from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import AsyncLock from '@server/utils/asyncLock';
import {
  AfterLoad,
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VirtualColumn,
  type EntityManager,
} from 'typeorm';
import Media from './Media';
import SeasonRequest from './SeasonRequest';
import { User } from './User';

export class RequestPermissionError extends Error {}
export class QuotaRestrictedError extends Error {}
export class DuplicateMediaRequestError extends Error {}
export class NoSeasonsAvailableError extends Error {}
export class BlocklistedMediaError extends Error {}
export class ServiceConfigurationError extends Error {}

export type MediaRequestServiceTarget = {
  serviceType: ServarrServiceType;
  format: 'standard' | '4k' | 'music' | 'ebook' | 'audiobook';
  serverId: number;
  profileId?: number | null;
  metadataProfileId?: number | null;
  languageProfileId?: number | null;
  rootFolder?: string | null;
  tags?: number[] | null;
  externalServiceId?: number | null;
  externalServiceSlug?: string | null;
  status?: MediaStatus | null;
};

type MediaRequestOptions = {
  expectedCredentialVersion?: number;
  expectedMediaServerUserAuthority?: MediaServerUserAuthoritySnapshot;
  isAutoRequest?: boolean;
};

type BookIdentifierCandidate = {
  provider: MediaIdentifierProvider;
  value: string;
  canonical: boolean;
};

type ResolvedBookRequest = {
  openLibraryId: string;
  identifierCandidates: BookIdentifierCandidate[];
};

type InternalMediaRequestOptions = MediaRequestOptions & {
  resolvedMusicMbId?: string;
  resolvedBook?: ResolvedBookRequest;
  serviceAdmissionGranted?: boolean;
};
export const MAX_BOOK_REQUEST_IDENTIFIER_CANDIDATES = 200;

const requestAdmissionLock = new AsyncLock();

const runWithLocalRequestLocks = <T>(
  keys: string[],
  callback: () => Promise<T>
): Promise<T> => {
  const uniqueKeys = [...new Set(keys)].sort();
  const dispatch = (index: number): Promise<T> =>
    index === uniqueKeys.length
      ? callback()
      : requestAdmissionLock.dispatch(uniqueKeys[index], () =>
          dispatch(index + 1)
        );

  return dispatch(0);
};

export const runWithRequestAdmission = <T>(
  keys: string[],
  callback: () => Promise<T>
): Promise<T> =>
  requestAdmissionCoordinator.run(keys, () =>
    runWithLocalRequestLocks(keys, callback)
  );

export const getRequestMutationAdmissionKey = (requestId: number): string => {
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new Error('A valid request ID is required for request admission.');
  }
  return `request-edit:${requestId}`;
};

const getRequestMediaLockKey = (requestBody: MediaRequestBody): string =>
  [
    'request-media',
    requestBody.mediaType,
    String(requestBody.mediaId).trim().toLowerCase(),
  ].join(':');

const canUseAdvancedRequestOptions = (user: User): boolean =>
  user.hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    {
      type: 'or',
    }
  );

export const hasMediaRequestPermission = (
  user: User,
  mediaType: MediaType,
  is4k = false
): boolean => {
  switch (mediaType) {
    case MediaType.MOVIE:
      return user.hasPermission(
        is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_MOVIE]
          : [Permission.REQUEST, Permission.REQUEST_MOVIE],
        { type: 'or' }
      );
    case MediaType.TV:
      return user.hasPermission(
        is4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
          : [Permission.REQUEST, Permission.REQUEST_TV],
        { type: 'or' }
      );
    case MediaType.MUSIC:
      return user.hasPermission(
        [Permission.REQUEST, Permission.REQUEST_MUSIC],
        { type: 'or' }
      );
    case MediaType.BOOK:
      return user.hasPermission([Permission.REQUEST, Permission.REQUEST_BOOK], {
        type: 'or',
      });
  }
};

const isTvdbConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes('media.tvdbId');
};

// request.save() triggers MediaRequestSubscriber's afterInsert/afterUpdate
// hooks, which (for an approved request) bump the *separately fetched*
// parent Media row to PROCESSING. The `request` object passed into save()
// still references the pre-update Media snapshot, so returning it directly
// would report a stale status (e.g. PENDING) to the caller even though the
// database — and the subscriber's own write, made through this same
// transaction manager — already reflects PROCESSING. Re-fetching after save
// picks up whatever the subscriber just committed.
const saveRequestWithFreshMedia = async (
  manager: EntityManager,
  request: MediaRequest
): Promise<MediaRequest> => {
  const savedRequest = await manager.getRepository(MediaRequest).save(request);
  return manager
    .getRepository(MediaRequest)
    .findOneOrFail({ where: { id: savedRequest.id } });
};

const findPromotablePendingRequest = (
  requests: MediaRequest[],
  destinations: RequestDestination[],
  actor: User,
  mediaType: MediaType,
  is4k = false
): MediaRequest | undefined => {
  if (destinations.length === 0) {
    return undefined;
  }

  return requests.find((request) => {
    if (
      request.status !== MediaRequestStatus.PENDING ||
      !destinations.every((destination) =>
        isDestinationCoveredByActiveRequest([request], destination)
      )
    ) {
      return false;
    }

    return (
      actor.hasPermission(Permission.MANAGE_REQUESTS) ||
      hasAutoApprovePermission(actor.permissions, mediaType, is4k)
    );
  });
};

const promotePendingRequest = async (
  pendingRequest: MediaRequest,
  actor: User
): Promise<MediaRequest> =>
  dataSource.transaction(async (manager) => {
    const requestRepository = manager.getRepository(MediaRequest);
    const currentRequest = await requestRepository.findOneOrFail({
      where: { id: pendingRequest.id },
    });

    if (currentRequest.status !== MediaRequestStatus.PENDING) {
      throw new DuplicateMediaRequestError(
        'The matching request is no longer pending approval.'
      );
    }

    currentRequest.status = MediaRequestStatus.APPROVED;
    currentRequest.modifiedBy = actor;
    return saveRequestWithFreshMedia(manager, currentRequest);
  });

const resolveMusicReleaseGroupId = async (
  mediaId: string,
  listenbrainz: ListenBrainzAPI,
  musicbrainz: MusicBrainz
): Promise<string> => {
  let listenBrainzError: unknown;

  try {
    const album = await listenbrainz.getAlbum(normalizeMusicBrainzId(mediaId));

    if (album.release_group_mbid) {
      return album.release_group_mbid;
    }
  } catch (error) {
    listenBrainzError = error;
    logger.warn('ListenBrainz album lookup failed during music request', {
      label: 'Media Request',
      mediaId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
  }

  try {
    const album = await musicbrainz.getReleaseGroupDetails({
      releaseGroupId: normalizeMusicBrainzId(mediaId),
    });

    return normalizeMusicBrainzId(album.id);
  } catch (releaseGroupError) {
    logger.warn(
      'MusicBrainz release group lookup failed during music request',
      {
        label: 'Media Request',
        mediaId,
        errorMessage:
          releaseGroupError instanceof Error
            ? releaseGroupError.message
            : 'Unknown error',
        errorStack:
          releaseGroupError instanceof Error
            ? releaseGroupError.stack
            : undefined,
      }
    );
  }

  const resolvedReleaseGroupId = await musicbrainz
    .getReleaseGroup({
      releaseId: normalizeMusicBrainzId(mediaId),
    })
    .catch((error) => {
      if (listenBrainzError) {
        throw listenBrainzError;
      }

      throw error;
    });

  if (!resolvedReleaseGroupId) {
    throw new Error('MusicBrainz ID did not resolve to a release group.');
  }

  return normalizeMusicBrainzId(resolvedReleaseGroupId);
};

@Entity()
export class MediaRequest {
  public static request(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions = {}
  ): Promise<MediaRequest> {
    requestBody = { ...requestBody, is4k: requestBody.is4k ?? false };

    // Lock the requested target even when the actor's loaded permission snapshot
    // says they cannot select it. Permissions are reloaded under the security
    // lock below, so a concurrent grant or revocation cannot change which quota
    // and user rows are protected.
    const requestUserId = requestBody.userId ?? user.id;
    const expectedMediaServerUserAuthority =
      options.expectedMediaServerUserAuthority;

    if (
      expectedMediaServerUserAuthority &&
      expectedMediaServerUserAuthority.userId !== user.id
    ) {
      return Promise.reject(
        new RequestPermissionError(
          'Media server authority does not belong to the request user.'
        )
      );
    }

    const userLockKey = `request-user:${requestUserId}`;
    const mediaLockKey = getRequestMediaLockKey(requestBody);

    return runUserSecurityMutation([user.id, requestUserId], async () => {
      if (expectedMediaServerUserAuthority) {
        try {
          await assertMediaServerUserAuthorityCurrent(
            expectedMediaServerUserAuthority
          );
        } catch (error) {
          if (error instanceof MediaServerUserAuthorityChangedError) {
            throw new RequestPermissionError(
              'Media server authority changed before request admission.'
            );
          }
          throw error;
        }
      }

      return runWithRequestAdmission([userLockKey, mediaLockKey], () =>
        this.requestUnlocked(requestBody, user, options)
      );
    });
  }

  private static async requestUnlocked(
    requestBody: MediaRequestBody,
    user: User,
    options: InternalMediaRequestOptions
  ): Promise<MediaRequest> {
    const tmdb = new TheMovieDb();
    const listenbrainz = new ListenBrainzAPI();
    const musicbrainz = new MusicBrainz();
    const openLibrary = new OpenLibraryAPI();
    const mediaRepository = getRepository(Media);
    const mediaIdentifierRepository = getRepository(MediaIdentifier);
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    const settings = getExternalRuntimeConfig();

    const currentUser = await userRepository.findOne({
      where: { id: user.id },
    });
    if (!currentUser) {
      throw new RequestPermissionError('Request user no longer exists.');
    }
    if (
      !isUserCredentialVersionCurrent(
        currentUser,
        options.expectedCredentialVersion
      )
    ) {
      throw new RequestPermissionError(
        'Request credentials changed before admission.'
      );
    }
    user = currentUser;
    let requestUser = user;
    const canSelectRequestUser = user.hasPermission([
      Permission.MANAGE_USERS,
      Permission.MANAGE_REQUESTS,
    ]);

    if (requestBody.userId && !canSelectRequestUser) {
      throw new RequestPermissionError(
        'You do not have permission to modify the request user.'
      );
    } else if (requestBody.userId) {
      requestUser = await userRepository.findOneOrFail({
        where: { id: requestBody.userId },
      });
    }

    if (!requestUser) {
      throw new Error('User missing from request context.');
    }

    const isManagedRequestForAnotherUser =
      canSelectRequestUser && requestUser.id !== user.id;

    if (
      requestBody.mediaType === MediaType.MOVIE &&
      !isManagedRequestForAnotherUser &&
      !hasMediaRequestPermission(
        requestUser,
        requestBody.mediaType,
        requestBody.is4k
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }movie requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.TV &&
      !isManagedRequestForAnotherUser &&
      !hasMediaRequestPermission(
        requestUser,
        requestBody.mediaType,
        requestBody.is4k
      )
    ) {
      throw new RequestPermissionError(
        `You do not have permission to make ${
          requestBody.is4k ? '4K ' : ''
        }series requests.`
      );
    } else if (
      requestBody.mediaType === MediaType.MUSIC &&
      !isManagedRequestForAnotherUser &&
      !hasMediaRequestPermission(requestUser, requestBody.mediaType)
    ) {
      throw new RequestPermissionError(
        'You do not have permission to make music requests.'
      );
    } else if (
      requestBody.mediaType === MediaType.BOOK &&
      !isManagedRequestForAnotherUser &&
      !hasMediaRequestPermission(requestUser, requestBody.mediaType)
    ) {
      throw new RequestPermissionError(
        'You do not have permission to make book requests.'
      );
    }

    if (canUseAdvancedRequestOptions(user) && requestBody.serverId != null) {
      const serviceName =
        requestBody.mediaType === MediaType.MOVIE
          ? 'Radarr'
          : requestBody.mediaType === MediaType.TV
            ? 'Sonarr'
            : requestBody.mediaType === MediaType.MUSIC
              ? 'Lidarr'
              : 'Bookshelf';
      const selectedService =
        requestBody.mediaType === MediaType.MOVIE
          ? settings.radarr.find(({ id }) => id === requestBody.serverId)
          : requestBody.mediaType === MediaType.TV
            ? settings.sonarr.find(({ id }) => id === requestBody.serverId)
            : requestBody.mediaType === MediaType.MUSIC
              ? settings.lidarr.find(({ id }) => id === requestBody.serverId)
              : settings.readarr.find(({ id }) => id === requestBody.serverId);
      if (!selectedService) {
        throw new ServiceConfigurationError(
          `Selected ${serviceName} server does not exist.`
        );
      }
      if (
        (requestBody.mediaType === MediaType.MOVIE ||
          requestBody.mediaType === MediaType.TV) &&
        Boolean(selectedService.is4k) !== Boolean(requestBody.is4k)
      ) {
        throw new ServiceConfigurationError(
          `Selected ${serviceName} server does not match the requested quality tier.`
        );
      }
      if (
        requestBody.mediaType === MediaType.BOOK &&
        ((selectedService as ReadarrSettings).serviceType ?? 'ebook') !==
          (requestBody.format === 'audiobook' ? 'audiobook' : 'ebook')
      ) {
        throw new ServiceConfigurationError(
          `Selected Bookshelf server is not configured for ${
            requestBody.format === 'audiobook' ? 'audiobook' : 'ebook'
          }.`
        );
      }
    }

    const quotas = await requestUser.getQuota();

    const canBypassQuota = requestUser.hasPermission(
      Permission.MANAGE_REQUESTS
    );
    const quotaForMediaType = (mediaType: MediaType) => {
      switch (mediaType) {
        case MediaType.MOVIE:
          return quotas.movie;
        case MediaType.TV:
          return quotas.tv;
        case MediaType.MUSIC:
          return quotas.music;
        case MediaType.BOOK:
          return quotas.book;
        default:
          return undefined;
      }
    };
    const ignoreQuota =
      requestBody.ignoreQuota === true &&
      canBypassQuota &&
      (quotaForMediaType(requestBody.mediaType)?.limit ?? 0) > 0;

    if (!ignoreQuota) {
      if (requestBody.ignoreQuota && !canBypassQuota) {
        throw new RequestPermissionError(
          'You do not have permission to bypass user quota limits.'
        );
      } else if (
        requestBody.mediaType === MediaType.MOVIE &&
        quotas.movie.restricted
      ) {
        throw new QuotaRestrictedError('Movie Quota exceeded.');
      } else if (
        requestBody.mediaType === MediaType.TV &&
        quotas.tv.restricted
      ) {
        throw new QuotaRestrictedError('Series Quota exceeded.');
      } else if (
        requestBody.mediaType === MediaType.MUSIC &&
        quotas.music.restricted
      ) {
        throw new QuotaRestrictedError('Music Quota exceeded.');
      } else if (
        requestBody.mediaType === MediaType.BOOK &&
        quotas.book.restricted
      ) {
        throw new QuotaRestrictedError('Book Quota exceeded.');
      }
    }

    // Canonical media admission must precede Servarr admission. Media mutation
    // paths use that order too; reversing it here can deadlock two PostgreSQL
    // instances when a request races a service-backed media mutation.
    if (
      requestBody.mediaType === MediaType.MUSIC &&
      !options.resolvedMusicMbId
    ) {
      const musicMbId = normalizeMusicBrainzId(
        await resolveMusicReleaseGroupId(
          requestBody.mediaId.toString(),
          listenbrainz,
          musicbrainz
        )
      );

      return runWithRequestAdmission(
        [`request-canonical:music:${musicMbId}`],
        () =>
          this.requestUnlocked(requestBody, user, {
            ...options,
            resolvedMusicMbId: musicMbId,
          })
      );
    }

    if (requestBody.mediaType === MediaType.BOOK && !options.resolvedBook) {
      const openLibraryId = normalizeOpenLibraryWorkId(
        requestBody.mediaId.toString()
      );
      const [, editions] = await Promise.all([
        openLibrary.getWork(openLibraryId),
        openLibrary.getWorkEditions(openLibraryId).catch(() => ({
          size: 0,
          entries: [],
        })),
      ]);
      const openLibraryEditionId = requestBody.editionId
        ? normalizeOpenLibraryEditionId(requestBody.editionId.toString())
        : undefined;
      const maxIsbnCandidates =
        MAX_BOOK_REQUEST_IDENTIFIER_CANDIDATES -
        1 -
        (openLibraryEditionId ? 1 : 0);
      const normalizedIsbns = new Set<string>();
      const addIsbn = (value?: string) => {
        if (normalizedIsbns.size >= maxIsbnCandidates) {
          return;
        }
        const normalized = normalizeValidIsbn(value);
        if (normalized) {
          normalizedIsbns.add(normalized);
        }
      };
      addIsbn(requestBody.isbn13);
      for (const edition of editions.entries.slice(0, 100)) {
        for (const isbn of edition.isbn_13 ?? []) {
          addIsbn(isbn);
        }
        for (const isbn of edition.isbn_10 ?? []) {
          addIsbn(isbn);
        }
        if (normalizedIsbns.size >= maxIsbnCandidates) {
          break;
        }
      }

      const resolvedBook: ResolvedBookRequest = {
        openLibraryId,
        identifierCandidates: [
          {
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: openLibraryId,
            canonical: true,
          },
          ...[...normalizedIsbns].map((isbn) => ({
            provider: MediaIdentifierProvider.ISBN,
            value: isbn,
            canonical: false,
          })),
          ...(openLibraryEditionId
            ? [
                {
                  provider: MediaIdentifierProvider.OPENLIBRARY_EDITION,
                  value: openLibraryEditionId,
                  canonical: false,
                },
              ]
            : []),
        ],
      };

      return runWithRequestAdmission(
        resolvedBook.identifierCandidates.map(
          (identifier) =>
            `request-canonical:book:${identifier.provider}:${identifier.value}`
        ),
        () =>
          this.requestUnlocked(requestBody, user, {
            ...options,
            resolvedBook,
          })
      );
    }

    if (!options.serviceAdmissionGranted) {
      const useAdvancedOptions = canUseAdvancedRequestOptions(user);
      const services: {
        serviceType: ServarrServiceType;
        serviceId: number;
      }[] = [];
      const addService = (
        serviceType: ServarrServiceType,
        serviceId: number | null | undefined
      ) => {
        if (serviceId != null) services.push({ serviceType, serviceId });
      };

      if (requestBody.mediaType === MediaType.MOVIE) {
        addService(
          'radarr',
          useAdvancedOptions && requestBody.serverId != null
            ? requestBody.serverId
            : settings.radarr.find(
                ({ is4k, isDefault }) =>
                  isDefault && Boolean(is4k) === Boolean(requestBody.is4k)
              )?.id
        );
      } else if (requestBody.mediaType === MediaType.TV) {
        addService(
          'sonarr',
          useAdvancedOptions && requestBody.serverId != null
            ? requestBody.serverId
            : settings.sonarr.find(
                ({ is4k, isDefault }) =>
                  isDefault && Boolean(is4k) === Boolean(requestBody.is4k)
              )?.id
        );
      } else if (requestBody.mediaType === MediaType.MUSIC) {
        addService(
          'lidarr',
          useAdvancedOptions && requestBody.serverId != null
            ? requestBody.serverId
            : settings.lidarr.find(({ isDefault }) => isDefault)?.id
        );
      } else {
        const format = requestBody.format ?? 'ebook';
        if (format === 'both') {
          addService(
            'readarr',
            useAdvancedOptions && requestBody.serverId != null
              ? requestBody.serverId
              : settings.readarr.find(
                  ({ isDefault, serviceType }) =>
                    isDefault && (serviceType ?? 'ebook') === 'ebook'
                )?.id
          );
          addService(
            'readarr',
            settings.readarr.find(
              ({ isDefault, serviceType }) =>
                isDefault && serviceType === 'audiobook'
            )?.id
          );
        } else {
          addService(
            'readarr',
            useAdvancedOptions && requestBody.serverId != null
              ? requestBody.serverId
              : settings.readarr.find(
                  ({ isDefault, serviceType }) =>
                    isDefault &&
                    (serviceType ?? 'ebook') ===
                      (format === 'audiobook' ? 'audiobook' : 'ebook')
                )?.id
          );
        }
      }

      if (services.length > 0) {
        return runWithServarrServiceAdmission(services, () =>
          this.requestUnlocked(requestBody, user, {
            ...options,
            serviceAdmissionGranted: true,
          })
        );
      }
    }

    if (requestBody.mediaType === MediaType.MUSIC) {
      const musicMbId = options.resolvedMusicMbId!;

      const blocklistedAlbum = await getRepository(Blocklist).findOne({
        where: {
          externalId: musicMbId,
          mediaType: MediaType.MUSIC,
        },
      });

      if (blocklistedAlbum) {
        logger.warn('Request for music blocked due to being blocklisted', {
          mbId: musicMbId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This album is blocklisted.');
      }

      let media = await mediaRepository.findOne({
        where: { mbId: musicMbId, mediaType: MediaType.MUSIC },
      });

      if (!media) {
        media = new Media({
          tmdbId: 0,
          mbId: musicMbId,
          status: MediaStatus.PENDING,
          status4k: MediaStatus.UNKNOWN,
          mediaType: MediaType.MUSIC,
        });
      } else if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for music blocked due to being blocklisted', {
          mbId: musicMbId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This album is blocklisted.');
      } else if (media.status === MediaStatus.UNKNOWN) {
        media.status = MediaStatus.PENDING;
      }

      const useAdvancedOptions = canUseAdvancedRequestOptions(user);
      const useOverrides = !useAdvancedOptions;

      const defaultLidarr = settings.lidarr.find((lidarr) => lidarr.isDefault);
      const requestedServerId = useAdvancedOptions
        ? requestBody.serverId
        : undefined;
      const requestedLidarr = settings.lidarr.find(
        (lidarr) => lidarr.id === requestedServerId
      );

      if (
        requestedServerId !== undefined &&
        requestedServerId !== null &&
        !requestedLidarr
      ) {
        throw new ServiceConfigurationError(
          'Selected Lidarr server does not exist.'
        );
      }

      if (!defaultLidarr && requestedServerId == null) {
        throw new ServiceConfigurationError(
          'No default Lidarr server configured.'
        );
      }

      const selectedLidarr = requestedLidarr ?? defaultLidarr;
      const serverId = selectedLidarr?.id;
      let rootFolder = useAdvancedOptions
        ? (requestBody.rootFolder ?? selectedLidarr?.activeDirectory)
        : selectedLidarr?.activeDirectory;
      let profileId = useAdvancedOptions
        ? (requestBody.profileId ?? selectedLidarr?.activeProfileId)
        : selectedLidarr?.activeProfileId;
      const metadataProfileId =
        useAdvancedOptions && requestBody.metadataProfileId !== undefined
          ? requestBody.metadataProfileId
          : selectedLidarr?.activeMetadataProfileId;
      let tags = useAdvancedOptions
        ? (requestBody.tags ?? selectedLidarr?.tags)
        : selectedLidarr?.tags;

      if (useOverrides) {
        const overrideRules = await getRepository(OverrideRule).find({
          where: { lidarrServiceId: serverId },
        });
        const prioritizedRule = selectMostSpecificOverrideRule(
          overrideRules.filter((rule) =>
            overrideRuleMatchesUser(rule, requestUser.id)
          ),
          ['users']
        );

        if (prioritizedRule?.rootFolder) {
          rootFolder = prioritizedRule.rootFolder;
        }
        const overrideProfileId = prioritizedRule
          ? getOverrideRuleProfileId(prioritizedRule)
          : undefined;
        if (overrideProfileId !== undefined) {
          profileId = overrideProfileId;
        }
        const overrideTags = prioritizedRule
          ? getOverrideRuleTagIds(prioritizedRule)
          : [];
        if (overrideTags.length > 0) {
          tags = [...new Set([...(tags || []), ...overrideTags])];
        }
      }

      const selectedDestination: RequestDestination | undefined =
        serverId === undefined
          ? undefined
          : {
              serviceType: 'lidarr',
              format: 'music',
              serverId,
              profileId: profileId ?? null,
              metadataProfileId: metadataProfileId ?? null,
              rootFolder: rootFolder ?? null,
            };
      const destinationRequests = media.id
        ? await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.requestedBy', 'requestedBy')
            .select([
              'request.id',
              'request.status',
              'request.type',
              'request.serverId',
              'request.profileId',
              'request.metadataProfileId',
              'request.rootFolder',
              'request.serviceTargets',
              'requestedBy.id',
            ])
            .innerJoin('request.media', 'requestMedia')
            .where('requestMedia.id = :mediaId', { mediaId: media.id })
            .getMany()
        : [];
      const selectedDestinationAlreadyAvailable =
        !!selectedDestination &&
        isDestinationAvailableInTargets(
          destinationRequests,
          selectedDestination
        );

      if (
        ((!selectedDestination ||
          !hasTrackedAvailableDestination(
            destinationRequests,
            selectedDestination
          )) &&
          media.status === MediaStatus.AVAILABLE &&
          (media.serviceId == null || media.serviceId === serverId)) ||
        selectedDestinationAlreadyAvailable
      ) {
        throw new DuplicateMediaRequestError(
          'This album is already available on the selected service.'
        );
      }

      const promotablePendingRequest = selectedDestination
        ? findPromotablePendingRequest(
            destinationRequests,
            [selectedDestination],
            user,
            MediaType.MUSIC
          )
        : undefined;
      if (promotablePendingRequest) {
        return promotePendingRequest(promotablePendingRequest, user);
      }

      const hasActiveRequestForTarget =
        !!selectedDestination &&
        isDestinationCoveredByActiveRequest(
          destinationRequests,
          selectedDestination
        );

      if (hasActiveRequestForTarget) {
        throw new DuplicateMediaRequestError(
          'Request for this album already exists for the selected service.'
        );
      }

      const autoApproved = hasAutoApprovePermission(
        requestUser.permissions,
        'music'
      );

      const request = new MediaRequest({
        type: MediaType.MUSIC,
        media,
        requestedBy: requestUser,
        status: autoApproved
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: autoApproved ? user : undefined,
        is4k: false,
        serverId,
        profileId,
        metadataProfileId,
        rootFolder,
        tags,
        serviceTargets:
          serverId === undefined
            ? []
            : [
                {
                  serviceType: 'lidarr',
                  format: 'music',
                  serverId,
                  profileId: profileId ?? null,
                  metadataProfileId: metadataProfileId ?? null,
                  rootFolder: rootFolder ?? null,
                  tags: tags ?? null,
                  status: MediaStatus.PENDING,
                },
              ],
        isAutoRequest: options.isAutoRequest ?? false,
        ignoreQuota,
      });

      return dataSource.transaction(async (manager) => {
        const savedMedia = await manager.getRepository(Media).save(media!);
        request.media = savedMedia;
        return saveRequestWithFreshMedia(manager, request);
      });
    }

    if (requestBody.mediaType === MediaType.BOOK) {
      const resolvedBook = options.resolvedBook!;

      const { openLibraryId, identifierCandidates } = resolvedBook;
      const blocklistedBook = await getRepository(Blocklist).findOne({
        where: identifierCandidates.map((identifier) => ({
          externalId: identifier.value,
          mediaType: MediaType.BOOK,
        })),
      });

      if (blocklistedBook) {
        logger.warn('Request for book blocked due to being blocklisted', {
          openLibraryId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This book is blocklisted.');
      }

      const existingIdentifiers = await mediaIdentifierRepository.find({
        where: identifierCandidates.map((identifier) => ({
          provider: identifier.provider,
          value: identifier.value,
        })),
        relations: { media: true },
        relationLoadStrategy: 'query',
        order: { id: 'ASC' },
      });
      const existingIdentifier = identifierCandidates
        .map((candidate) =>
          existingIdentifiers.find(
            (identifier) =>
              identifier.provider === candidate.provider &&
              identifier.value === candidate.value &&
              identifier.media.mediaType === MediaType.BOOK
          )
        )
        .find((identifier) => identifier !== undefined);

      let media = existingIdentifier?.media;
      const requestedBookFormat = requestBody.format ?? 'ebook';

      if (!media) {
        media = new Media({
          tmdbId: 0,
          status: MediaStatus.PENDING,
          status4k: MediaStatus.UNKNOWN,
          mediaType: MediaType.BOOK,
        });
      } else if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for book blocked due to being blocklisted', {
          openLibraryId,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This book is blocklisted.');
      } else if (media.status === MediaStatus.UNKNOWN) {
        media.status = MediaStatus.PENDING;
      }

      const requestedServiceType =
        requestedBookFormat === 'audiobook' ? 'audiobook' : 'ebook';
      const useAdvancedOptions = canUseAdvancedRequestOptions(user);
      const requestedServerId = useAdvancedOptions
        ? requestBody.serverId
        : undefined;
      const requestedServer = settings.readarr.find(
        (readarr) => readarr.id === requestedServerId
      );

      if (
        requestedServerId !== undefined &&
        requestedServerId !== null &&
        !requestedServer
      ) {
        throw new ServiceConfigurationError(
          'Selected Bookshelf server does not exist.'
        );
      }

      if (
        requestedServerId !== undefined &&
        requestedServerId !== null &&
        requestedServer &&
        (requestedServer.serviceType ?? 'ebook') !== requestedServiceType
      ) {
        throw new ServiceConfigurationError(
          `Selected Bookshelf server is not configured for ${requestedServiceType}.`
        );
      }

      const defaultReadarr = settings.readarr.find(
        (readarr) =>
          readarr.isDefault &&
          (readarr.serviceType ?? 'ebook') === requestedServiceType
      );
      const defaultEbookReadarr = settings.readarr.find(
        (readarr) =>
          readarr.isDefault && (readarr.serviceType ?? 'ebook') === 'ebook'
      );
      const defaultAudiobookReadarr = settings.readarr.find(
        (readarr) => readarr.isDefault && readarr.serviceType === 'audiobook'
      );

      if (requestedBookFormat === 'both') {
        if (
          !(requestedServer ?? defaultEbookReadarr) ||
          !defaultAudiobookReadarr
        ) {
          throw new ServiceConfigurationError(
            'Both book formats require default ebook and audiobook Bookshelf servers.'
          );
        }
      } else if (!defaultReadarr && requestedServerId == null) {
        throw new ServiceConfigurationError(
          `No default Bookshelf server configured for ${requestedServiceType}.`
        );
      }

      const selectedReadarr = requestedServer ?? defaultReadarr;

      const createBookTarget = (
        service: ReadarrSettings,
        format: 'ebook' | 'audiobook',
        allowOverrides: boolean
      ): MediaRequestServiceTarget => ({
        serviceType: 'readarr',
        format,
        serverId: service.id,
        profileId:
          allowOverrides && useAdvancedOptions
            ? (requestBody.profileId ?? service.activeProfileId)
            : service.activeProfileId,
        metadataProfileId:
          allowOverrides &&
          useAdvancedOptions &&
          requestBody.metadataProfileId !== undefined
            ? requestBody.metadataProfileId
            : (service.activeMetadataProfileId ?? null),
        rootFolder:
          allowOverrides && useAdvancedOptions
            ? (requestBody.rootFolder ?? service.activeDirectory)
            : service.activeDirectory,
        tags:
          allowOverrides && useAdvancedOptions
            ? (requestBody.tags ?? service.tags ?? null)
            : (service.tags ?? null),
        status: MediaStatus.PENDING,
      });
      const bookTargets: MediaRequestServiceTarget[] = [];
      if (requestedBookFormat === 'both') {
        const ebookService = requestedServer ?? defaultEbookReadarr;
        if (ebookService) {
          bookTargets.push(createBookTarget(ebookService, 'ebook', true));
        }
        if (defaultAudiobookReadarr) {
          bookTargets.push(
            createBookTarget(defaultAudiobookReadarr, 'audiobook', false)
          );
        }
      } else if (selectedReadarr) {
        bookTargets.push(
          createBookTarget(
            selectedReadarr,
            requestedBookFormat === 'audiobook' ? 'audiobook' : 'ebook',
            true
          )
        );
      }

      const destinationRequests = media.id
        ? await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.requestedBy', 'requestedBy')
            .select([
              'request.id',
              'request.status',
              'request.type',
              'request.serverId',
              'request.profileId',
              'request.metadataProfileId',
              'request.rootFolder',
              'request.bookFormat',
              'request.serviceTargets',
              'requestedBy.id',
            ])
            .where('request.media = :mediaId', { mediaId: media.id })
            .getMany()
        : [];
      const isLegacyBookTargetAvailable = (
        target: MediaRequestServiceTarget
      ): boolean => {
        if (
          media.status !== MediaStatus.AVAILABLE ||
          hasTrackedAvailableDestination(destinationRequests, target)
        ) {
          return false;
        }

        const isAudiobook = target.format === 'audiobook';
        const externalServiceId = isAudiobook
          ? media.audiobookExternalServiceId
          : media.externalServiceId;
        const serviceId = isAudiobook
          ? media.audiobookServiceId
          : media.serviceId;
        return (
          externalServiceId != null &&
          (serviceId == null || serviceId === target.serverId)
        );
      };
      const uncoveredBookTargets = bookTargets.filter(
        (target) =>
          !isLegacyBookTargetAvailable(target) &&
          !isDestinationAvailableInTargets(destinationRequests, target) &&
          !isDestinationCoveredByActiveRequest(destinationRequests, target)
      );

      const unavailableBookTargets = bookTargets.filter(
        (target) =>
          !isLegacyBookTargetAvailable(target) &&
          !isDestinationAvailableInTargets(destinationRequests, target)
      );
      const promotablePendingRequest = findPromotablePendingRequest(
        destinationRequests,
        unavailableBookTargets,
        user,
        MediaType.BOOK
      );
      if (promotablePendingRequest) {
        return promotePendingRequest(promotablePendingRequest, user);
      }

      if (
        bookTargets.some((target) =>
          isDestinationCoveredByActiveRequest(destinationRequests, target)
        )
      ) {
        throw new DuplicateMediaRequestError(
          'Request for this book already exists.'
        );
      }

      if (uncoveredBookTargets.length === 0) {
        throw new DuplicateMediaRequestError(
          'Every selected book destination is already available or requested.'
        );
      }

      const autoApproved = hasAutoApprovePermission(
        requestUser.permissions,
        'book'
      );

      const request = new MediaRequest({
        type: MediaType.BOOK,
        media,
        requestedBy: requestUser,
        status: autoApproved
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: autoApproved ? user : undefined,
        is4k: false,
        serverId: selectedReadarr?.id,
        profileId: useAdvancedOptions
          ? (requestBody.profileId ?? selectedReadarr?.activeProfileId)
          : selectedReadarr?.activeProfileId,
        metadataProfileId:
          useAdvancedOptions && requestBody.metadataProfileId !== undefined
            ? requestBody.metadataProfileId
            : selectedReadarr?.activeMetadataProfileId,
        rootFolder: useAdvancedOptions
          ? (requestBody.rootFolder ?? selectedReadarr?.activeDirectory)
          : selectedReadarr?.activeDirectory,
        tags: useAdvancedOptions
          ? (requestBody.tags ?? selectedReadarr?.tags)
          : selectedReadarr?.tags,
        serviceTargets: uncoveredBookTargets,
        bookFormat: requestedBookFormat,
        isAutoRequest: options.isAutoRequest ?? false,
        ignoreQuota,
      });

      return dataSource.transaction(async (manager) => {
        const transactionalMediaRepository = manager.getRepository(Media);
        const transactionalIdentifierRepository =
          manager.getRepository(MediaIdentifier);
        const savedMedia = await transactionalMediaRepository.save(media);

        for (const identifier of identifierCandidates) {
          const hasIdentifier = existingIdentifiers.some(
            (existing) =>
              existing.provider === identifier.provider &&
              existing.value === identifier.value &&
              existing.media.id === savedMedia.id
          );
          const isOwnedByOtherMedia = existingIdentifiers.some(
            (existing) =>
              existing.provider === identifier.provider &&
              existing.value === identifier.value &&
              existing.media.id !== savedMedia.id
          );

          if (!hasIdentifier && !isOwnedByOtherMedia) {
            await transactionalIdentifierRepository.save(
              new MediaIdentifier({
                media: savedMedia,
                provider: identifier.provider,
                value: identifier.value,
                canonical: identifier.canonical,
              })
            );
          }
        }

        request.media = savedMedia;
        return saveRequestWithFreshMedia(manager, request);
      });
    }

    const tmdbMedia =
      requestBody.mediaType === MediaType.MOVIE
        ? await tmdb.getMovie({ movieId: requestBody.mediaId as number })
        : await tmdb.getTvShow({ tvId: requestBody.mediaId as number });

    const tvdbId =
      requestBody.mediaType === MediaType.TV
        ? (requestBody.tvdbId ?? tmdbMedia.external_ids.tvdb_id)
        : undefined;
    let media = await mediaRepository.findOne({
      where: {
        tmdbId: requestBody.mediaId as number,
        mediaType: requestBody.mediaType,
      },
    });

    if (!media && requestBody.mediaType === MediaType.TV && tvdbId) {
      media = await mediaRepository.findOne({
        where: {
          tvdbId,
          mediaType: MediaType.TV,
        },
      });

      if (media && media.tmdbId !== tmdbMedia.id) {
        logger.info('Matched existing TV media by TVDB ID', {
          label: 'Media Request',
          mediaId: media.id,
          oldTmdbId: media.tmdbId,
          newTmdbId: tmdbMedia.id,
          tvdbId,
        });
        media.tmdbId = tmdbMedia.id;
      }
    }

    if (!media) {
      media = new Media({
        tmdbId: tmdbMedia.id,
        tvdbId,
        status: !requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        status4k: requestBody.is4k ? MediaStatus.PENDING : MediaStatus.UNKNOWN,
        mediaType: requestBody.mediaType,
      });
    } else {
      if (requestBody.mediaType === MediaType.TV && tvdbId && !media.tvdbId) {
        media.tvdbId = tvdbId;
      }

      if (media.status === MediaStatus.BLOCKLISTED) {
        logger.warn('Request for media blocked due to being blocklisted', {
          tmdbId: tmdbMedia.id,
          mediaType: requestBody.mediaType,
          label: 'Media Request',
        });

        throw new BlocklistedMediaError('This media is blocklisted.');
      }

      if (
        (media.status === MediaStatus.UNKNOWN ||
          media.status === MediaStatus.DELETED) &&
        !requestBody.is4k
      ) {
        media.status = MediaStatus.PENDING;
      }

      if (
        (media.status4k === MediaStatus.UNKNOWN ||
          media.status4k === MediaStatus.DELETED) &&
        requestBody.is4k
      ) {
        media.status4k = MediaStatus.PENDING;
      }
    }

    const useAdvancedOptions = canUseAdvancedRequestOptions(user);
    const useOverrides = !useAdvancedOptions;
    const defaultRadarr = requestBody.is4k
      ? settings.radarr.find((r) => r.is4k && r.isDefault)
      : settings.radarr.find((r) => !r.is4k && r.isDefault);
    const defaultSonarr = requestBody.is4k
      ? settings.sonarr.find((s) => s.is4k && s.isDefault)
      : settings.sonarr.find((s) => !s.is4k && s.isDefault);
    const defaultServer =
      requestBody.mediaType === MediaType.MOVIE ? defaultRadarr : defaultSonarr;
    const requestedServerId = useAdvancedOptions
      ? requestBody.serverId
      : undefined;
    const requestedServer =
      requestedServerId == null
        ? undefined
        : requestBody.mediaType === MediaType.MOVIE
          ? settings.radarr.find(({ id }) => id === requestedServerId)
          : settings.sonarr.find(({ id }) => id === requestedServerId);
    if (requestedServerId != null && !requestedServer) {
      throw new ServiceConfigurationError(
        `Selected ${
          requestBody.mediaType === MediaType.MOVIE ? 'Radarr' : 'Sonarr'
        } server does not exist.`
      );
    }
    if (
      requestedServer &&
      Boolean(requestedServer.is4k) !== Boolean(requestBody.is4k)
    ) {
      throw new ServiceConfigurationError(
        `Selected ${
          requestBody.mediaType === MediaType.MOVIE ? 'Radarr' : 'Sonarr'
        } server does not match the requested quality tier.`
      );
    }
    const selectedServer = requestedServer ?? defaultServer;
    const serverId = selectedServer?.id;
    const selectedSonarr =
      requestBody.mediaType === MediaType.TV
        ? (selectedServer as SonarrSettings)
        : undefined;

    let rootFolder = useAdvancedOptions
      ? (requestBody.rootFolder ?? selectedServer?.activeDirectory)
      : selectedServer?.activeDirectory;
    let profileId = useAdvancedOptions
      ? (requestBody.profileId ?? selectedServer?.activeProfileId)
      : selectedServer?.activeProfileId;
    let tags = useAdvancedOptions
      ? (requestBody.tags ?? selectedServer?.tags)
      : selectedServer?.tags;
    const languageProfileId =
      requestBody.mediaType === MediaType.TV
        ? useAdvancedOptions
          ? (requestBody.languageProfileId ??
            selectedSonarr?.activeLanguageProfileId)
          : selectedSonarr?.activeLanguageProfileId
        : undefined;

    if (useOverrides) {
      const overrideRuleRepository = getRepository(OverrideRule);
      const overrideRules = await overrideRuleRepository.find({
        where:
          requestBody.mediaType === MediaType.MOVIE
            ? { radarrServiceId: defaultRadarr?.id }
            : { sonarrServiceId: defaultSonarr?.id },
      });

      const appliedOverrideRules = overrideRules.filter((rule) => {
        const hasAnimeKeyword =
          'results' in tmdbMedia.keywords &&
          tmdbMedia.keywords.results.some(
            (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
          );

        // Skip override rules if the media is an anime TV show as anime TV
        // is handled by default and override rules do not explicitly include
        // the anime keyword
        if (
          requestBody.mediaType === MediaType.TV &&
          hasAnimeKeyword &&
          (!rule.keywords ||
            !rule.keywords.split(',').map(Number).includes(ANIME_KEYWORD_ID))
        ) {
          return false;
        }

        if (!overrideRuleMatchesUser(rule, requestUser.id)) {
          return false;
        }
        if (
          rule.genre &&
          !rule.genre
            .split(',')
            .some((genreId) =>
              tmdbMedia.genres
                .map((genre) => genre.id)
                .includes(Number(genreId))
            )
        ) {
          return false;
        }
        if (
          rule.language &&
          !rule.language
            .split('|')
            .some((languageId) => languageId === tmdbMedia.original_language)
        ) {
          return false;
        }
        if (
          rule.keywords &&
          !rule.keywords.split(',').some((keywordId) => {
            let keywordList: TmdbKeyword[] = [];

            if ('keywords' in tmdbMedia.keywords) {
              keywordList = tmdbMedia.keywords.keywords;
            } else if ('results' in tmdbMedia.keywords) {
              keywordList = tmdbMedia.keywords.results;
            }

            return keywordList
              .map((keyword: TmdbKeyword) => keyword.id)
              .includes(Number(keywordId));
          })
        ) {
          return false;
        }
        return true;
      });

      const prioritizedRule =
        selectMostSpecificOverrideRule(appliedOverrideRules);

      if (prioritizedRule) {
        if (prioritizedRule.rootFolder) {
          rootFolder = prioritizedRule.rootFolder;
        }
        const overrideProfileId = getOverrideRuleProfileId(prioritizedRule);
        if (overrideProfileId !== undefined) {
          profileId = overrideProfileId;
        }
        const overrideTags = getOverrideRuleTagIds(prioritizedRule);
        if (overrideTags.length > 0) {
          tags = [...new Set([...(tags || []), ...overrideTags])];
        }

        logger.debug('Override rule applied.', {
          label: 'Media Request',
          overrides: prioritizedRule,
        });
      }
    }

    const selectedDestination: RequestDestination | undefined =
      serverId === undefined
        ? undefined
        : {
            serviceType:
              requestBody.mediaType === MediaType.MOVIE ? 'radarr' : 'sonarr',
            format: requestBody.is4k ? '4k' : 'standard',
            serverId,
            profileId: profileId ?? null,
            languageProfileId: languageProfileId ?? null,
            rootFolder: rootFolder ?? null,
          };
    const loadDestinationRequests = async (
      requestMedia: Media
    ): Promise<MediaRequest[]> =>
      requestMedia.id
        ? requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.requestedBy', 'requestedBy')
            .leftJoinAndSelect('request.seasons', 'seasons')
            .where('request.media = :mediaId', { mediaId: requestMedia.id })
            .getMany()
        : [];
    const destinationRequests = await loadDestinationRequests(media);

    if (selectedDestination) {
      const hasTrackedAvailability = hasTrackedAvailableDestination(
        destinationRequests,
        selectedDestination
      );
      const isLegacyDestinationAvailable =
        !hasTrackedAvailability &&
        media[requestBody.is4k ? 'status4k' : 'status'] ===
          MediaStatus.AVAILABLE &&
        (media[requestBody.is4k ? 'serviceId4k' : 'serviceId'] == null ||
          media[requestBody.is4k ? 'serviceId4k' : 'serviceId'] === serverId);
      if (
        isLegacyDestinationAvailable ||
        isDestinationAvailableInTargets(
          destinationRequests,
          selectedDestination
        )
      ) {
        throw new DuplicateMediaRequestError(
          `This ${
            requestBody.mediaType === MediaType.MOVIE ? 'movie' : 'series'
          } is already available at the selected destination.`
        );
      }

      if (
        requestBody.mediaType === MediaType.MOVIE &&
        isDestinationCoveredByActiveRequest(
          destinationRequests,
          selectedDestination
        )
      ) {
        const promotablePendingRequest = findPromotablePendingRequest(
          destinationRequests,
          [selectedDestination],
          user,
          MediaType.MOVIE,
          requestBody.is4k
        );
        if (promotablePendingRequest) {
          return promotePendingRequest(promotablePendingRequest, user);
        }

        throw new DuplicateMediaRequestError(
          'Request for this media already exists at the selected destination.'
        );
      }

      const hasExistingAutoRequest = destinationRequests.some(
        (request) =>
          request.isAutoRequest &&
          request.requestedBy?.id === requestUser.id &&
          isDestinationCoveredByActiveRequest([request], selectedDestination)
      );
      if (hasExistingAutoRequest) {
        throw new DuplicateMediaRequestError(
          'Auto-request for this media, user, and destination already exists.'
        );
      }
    }

    if (requestBody.mediaType === MediaType.MOVIE) {
      const request = new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: requestUser,
        // Approval follows the request owner, including when an administrator
        // submits on another user's behalf.
        status: hasAutoApprovePermission(
          requestUser.permissions,
          'movie',
          requestBody.is4k
        )
          ? MediaRequestStatus.APPROVED
          : MediaRequestStatus.PENDING,
        modifiedBy: hasAutoApprovePermission(
          requestUser.permissions,
          'movie',
          requestBody.is4k
        )
          ? user
          : undefined,
        is4k: requestBody.is4k,
        serverId,
        profileId: profileId,
        rootFolder: rootFolder,
        tags: tags,
        serviceTargets:
          serverId === undefined
            ? []
            : [
                {
                  serviceType: 'radarr',
                  format: requestBody.is4k ? '4k' : 'standard',
                  serverId,
                  profileId: profileId ?? null,
                  rootFolder: rootFolder ?? null,
                  tags: tags ?? null,
                  status: MediaStatus.PENDING,
                },
              ],
        isAutoRequest: options.isAutoRequest ?? false,
        ignoreQuota,
      });

      return dataSource.transaction(async (manager) => {
        const savedMedia = await manager.getRepository(Media).save(media!);
        request.media = savedMedia;
        return saveRequestWithFreshMedia(manager, request);
      });
    } else {
      const tmdbMediaShow = tmdbMedia as Awaited<
        ReturnType<typeof tmdb.getTvShow>
      >;
      const requestedSeasons =
        requestBody.seasons === 'all'
          ? tmdbMediaShow.seasons
              .filter((season) => season.season_number !== 0)
              .map((season) => season.season_number)
          : (requestBody.seasons as number[]);
      let requestedSeasonSelections: SeasonEpisodeSelection[] = requestBody
        .seasonRequests?.length
        ? requestBody.seasonRequests
        : requestedSeasons.map((seasonNumber) => ({ seasonNumber }));
      if (!settings.main.enableSpecialEpisodes) {
        requestedSeasonSelections = requestedSeasonSelections.filter(
          (selection) => selection.seasonNumber > 0
        );
      }

      const selectionIsCoveredByRequest = (
        request: MediaRequest,
        selection: SeasonEpisodeSelection
      ): boolean => {
        const matchingRows = (request.seasons ?? []).filter(
          (season) => season.seasonNumber === selection.seasonNumber
        );
        if (!selection.episodeNumbers) {
          return matchingRows.some((season) => season.episodeNumbers == null);
        }

        const coveredEpisodes = new Set<number>();
        for (const season of matchingRows) {
          if (season.episodeNumbers == null) {
            return true;
          }
          season.episodeNumbers.forEach((episode) =>
            coveredEpisodes.add(episode)
          );
        }
        return selection.episodeNumbers.every((episode) =>
          coveredEpisodes.has(episode)
        );
      };
      const promotablePendingRequest = selectedDestination
        ? findPromotablePendingRequest(
            destinationRequests.filter((request) =>
              requestedSeasonSelections.every((selection) =>
                selectionIsCoveredByRequest(request, selection)
              )
            ),
            [selectedDestination],
            user,
            MediaType.TV,
            requestBody.is4k
          )
        : undefined;
      if (promotablePendingRequest) {
        return promotePendingRequest(promotablePendingRequest, user);
      }

      const getFinalSeasons = async (
        requestMedia: Media
      ): Promise<SeasonEpisodeSelection[]> => {
        const activeRequestedSeasonRows: SeasonRequest[] = selectedDestination
          ? (await loadDestinationRequests(requestMedia))
              .filter((request) =>
                isDestinationCoveredByActiveRequest(
                  [request],
                  selectedDestination
                )
              )
              .flatMap((request) => request.seasons ?? [])
          : [];
        const fullyRequestedSeasons = new Set(
          activeRequestedSeasonRows
            .filter((season) => season.episodeNumbers == null)
            .map((season) => season.seasonNumber)
        );
        const requestedEpisodes = new Map<number, Set<number>>();
        activeRequestedSeasonRows
          .filter((season) => season.episodeNumbers != null)
          .forEach((season) => {
            const episodes =
              requestedEpisodes.get(season.seasonNumber) ?? new Set<number>();
            season.episodeNumbers?.forEach((episode) => episodes.add(episode));
            requestedEpisodes.set(season.seasonNumber, episodes);
          });

        // Fully available seasons do not need another request. Partially
        // available seasons remain eligible for exact episode requests.
        if (requestMedia.seasons) {
          requestMedia.seasons
            .filter(
              (season) =>
                season[requestBody.is4k ? 'status4k' : 'status'] ===
                MediaStatus.AVAILABLE
            )
            .forEach((season) =>
              fullyRequestedSeasons.add(season.seasonNumber)
            );
        }

        return requestedSeasonSelections.flatMap((selection) => {
          if (fullyRequestedSeasons.has(selection.seasonNumber)) {
            return [];
          }
          if (!selection.episodeNumbers) {
            return [selection];
          }
          const existingEpisodes =
            requestedEpisodes.get(selection.seasonNumber) ?? new Set<number>();
          const episodeNumbers = selection.episodeNumbers.filter(
            (episode) => !existingEpisodes.has(episode)
          );
          return episodeNumbers.length > 0
            ? [{ ...selection, episodeNumbers }]
            : [];
        });
      };

      let finalSeasonSelections = await getFinalSeasons(media);

      if (finalSeasonSelections.length === 0) {
        throw new NoSeasonsAvailableError('No seasons available to request');
      } else if (
        !ignoreQuota &&
        quotas.tv.limit &&
        finalSeasonSelections.length > (quotas.tv.remaining ?? 0)
      ) {
        throw new QuotaRestrictedError('Series Quota exceeded.');
      }

      const persistTvRequest = (
        requestMedia: Media,
        selections: SeasonEpisodeSelection[]
      ): Promise<MediaRequest> => {
        const autoApproved = hasAutoApprovePermission(
          requestUser.permissions,
          'tv',
          requestBody.is4k
        );
        const request = new MediaRequest({
          type: MediaType.TV,
          media: requestMedia,
          requestedBy: requestUser,
          status: autoApproved
            ? MediaRequestStatus.APPROVED
            : MediaRequestStatus.PENDING,
          modifiedBy: autoApproved ? user : undefined,
          is4k: requestBody.is4k,
          serverId,
          profileId: profileId,
          rootFolder: rootFolder,
          languageProfileId,
          tags: tags,
          serviceTargets:
            serverId === undefined
              ? []
              : [
                  {
                    serviceType: 'sonarr',
                    format: requestBody.is4k ? '4k' : 'standard',
                    serverId,
                    profileId: profileId ?? null,
                    languageProfileId: languageProfileId ?? null,
                    rootFolder: rootFolder ?? null,
                    tags: tags ?? null,
                    status: MediaStatus.PENDING,
                  },
                ],
          seasons: selections.map(
            (selection) =>
              new SeasonRequest({
                seasonNumber: selection.seasonNumber,
                episodeNumbers: selection.episodeNumbers,
                status: autoApproved
                  ? MediaRequestStatus.APPROVED
                  : MediaRequestStatus.PENDING,
              })
          ),
          isAutoRequest: options.isAutoRequest ?? false,
          ignoreQuota,
        });

        return dataSource.transaction(async (manager) => {
          const savedMedia = await manager
            .getRepository(Media)
            .save(requestMedia);
          request.media = savedMedia;
          return saveRequestWithFreshMedia(manager, request);
        });
      };

      try {
        return await persistTvRequest(media, finalSeasonSelections);
      } catch (e) {
        if (!tvdbId || !isTvdbConstraintError(e)) {
          throw e;
        }

        const existingMedia = await mediaRepository.findOne({
          where: {
            tvdbId,
            mediaType: MediaType.TV,
          },
        });

        if (!existingMedia) {
          throw e;
        }

        logger.warn('Recovered from duplicate TVDB media insert', {
          label: 'Media Request',
          tmdbId: tmdbMedia.id,
          tvdbId,
          mediaId: existingMedia.id,
        });

        media = existingMedia;

        if (media.tmdbId !== tmdbMedia.id) {
          media.tmdbId = tmdbMedia.id;
        }

        if (media.status === MediaStatus.UNKNOWN && !requestBody.is4k) {
          media.status = MediaStatus.PENDING;
        }

        if (media.status4k === MediaStatus.UNKNOWN && requestBody.is4k) {
          media.status4k = MediaStatus.PENDING;
        }

        finalSeasonSelections = await getFinalSeasons(media);

        if (finalSeasonSelections.length === 0) {
          throw new NoSeasonsAvailableError('No seasons available to request');
        }

        return persistTvRequest(media, finalSeasonSelections);
      }
    }
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  @Index()
  public status: MediaRequestStatus;

  @ManyToOne(() => Media, (media) => media.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, (user) => user.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => User, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @Index()
  public modifiedBy?: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  @Column({ type: 'varchar' })
  public type: MediaType;

  @VirtualColumn({
    type: 'integer',
    query: (alias) =>
      `SELECT COUNT(*) FROM "season_request" WHERE "requestId" = ${alias}."id"`,
  })
  public seasonCount: number;

  @OneToMany(() => SeasonRequest, (season) => season.request, {
    eager: true,
    cascade: true,
  })
  public seasons: SeasonRequest[];

  @Column({ default: false })
  public is4k: boolean;

  @Column({ nullable: true })
  public serverId: number;

  @Column({ nullable: true })
  public profileId: number;

  @Column({ nullable: true })
  public rootFolder: string;

  @Column({ nullable: true })
  public languageProfileId: number;

  @Column({ nullable: true })
  public metadataProfileId: number;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): MediaRequestServiceTarget[] => {
        if (!value) {
          return [];
        }
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
      to: (value: MediaRequestServiceTarget[] | null): string | null =>
        value?.length ? JSON.stringify(value) : null,
    },
  })
  public serviceTargets?: MediaRequestServiceTarget[];

  @Column({ nullable: true, type: 'varchar' })
  public bookFormat?: 'ebook' | 'audiobook' | 'both' | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): number[] | null => {
        if (value) {
          if (value === 'none') {
            return [];
          }
          return value.split(',').map((v) => Number(v));
        }
        return null;
      },
      to: (value: number[] | null): string | null => {
        if (value) {
          const finalValue = value.join(',');

          // We want to keep the actual state of an "empty array" so we use
          // the keyword "none" to track this.
          if (!finalValue) {
            return 'none';
          }

          return finalValue;
        }
        return null;
      },
    },
  })
  public tags?: number[];

  @Column({ default: false })
  public isAutoRequest: boolean;

  @Column({ default: false })
  public ignoreQuota: boolean;

  constructor(init?: Partial<MediaRequest>) {
    Object.assign(this, init);
  }

  @AfterLoad()
  private sortSeasons() {
    if (Array.isArray(this.seasons)) {
      this.seasons.sort((a, b) => a.id - b.id);
    }
  }

  static async sendNotification(
    entity: MediaRequest,
    media: Media,
    type: Notification
  ) {
    try {
      if (Number.isSafeInteger(entity.id) && entity.id > 0) {
        await notificationManager.sendNotificationIntent(type, {
          kind: 'media-request',
          requestId: entity.id,
        });
        return;
      }
      const { buildMediaRequestNotificationPayload } =
        await import('@server/lib/notifications/intents');
      const payload = await buildMediaRequestNotificationPayload(
        entity,
        media,
        type
      );
      await notificationManager.sendNotification(type, payload);
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        requestId: entity.id,
        mediaId: entity.media.id,
      });
    }
  }
}

export default MediaRequest;
