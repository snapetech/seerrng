import type { MediaRequest } from '@server/entity/MediaRequest';
import type {
  ComicServiceOption,
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import useSWR from 'swr';

interface OverrideStatus {
  server?: string;
  profile?: string;
  metadataProfile?: string;
  rootFolder?: string;
  languageProfile?: string;
}

// Comics have no quality-profile/root-folder/language-profile concept, so
// they use the lightweight /service/comic listing instead of the Servarr
// "WithDetails" shape the other media types need.
const useComicRequestOverride = (request: MediaRequest): OverrideStatus => {
  const { data: allServers } = useSWR<ComicServiceOption[]>(
    request.type === 'comic' ? '/api/v1/service/comic' : null
  );

  if (!allServers) {
    return {};
  }

  const defaultServer = allServers.find((server) => server.isDefault);
  const activeServer = allServers.find(
    (server) => server.id === request.serverId
  );

  return {
    server:
      activeServer && request.serverId !== defaultServer?.id
        ? activeServer.name
        : undefined,
  };
};

const useRequestOverride = (request: MediaRequest): OverrideStatus => {
  const serviceType =
    request.type === 'movie'
      ? 'radarr'
      : request.type === 'music'
        ? 'lidarr'
        : request.type === 'book'
          ? 'readarr'
          : 'sonarr';
  const { data: allServers } = useSWR<ServiceCommonServer[]>(
    request.type === 'comic' ? null : `/api/v1/service/${serviceType}`
  );

  const { data } = useSWR<ServiceCommonServerWithDetails>(
    request.type !== 'comic' && request.serverId !== null
      ? `/api/v1/service/${serviceType}/${request.serverId}`
      : null
  );

  const comicOverride = useComicRequestOverride(request);
  if (request.type === 'comic') {
    return comicOverride;
  }

  if (!data || !allServers) {
    return {};
  }

  const bookServiceType =
    request.type === 'book' && request.bookFormat === 'audiobook'
      ? 'audiobook'
      : 'ebook';
  const defaultServer = allServers.find(
    (server) =>
      server.is4k === request.is4k &&
      server.isDefault &&
      (request.type !== 'book' ||
        (server.serviceType ?? 'ebook') === bookServiceType)
  );

  const activeServer = allServers.find(
    (server) => server.id === request.serverId
  );

  return {
    server:
      activeServer && request.serverId !== defaultServer?.id
        ? activeServer.name
        : undefined,
    profile:
      defaultServer?.activeProfileId !== request.profileId
        ? data.profiles.find((profile) => profile.id === request.profileId)
            ?.name
        : undefined,
    metadataProfile:
      (request.type === 'music' || request.type === 'book') &&
      defaultServer?.activeMetadataProfileId !== request.metadataProfileId
        ? data.metadataProfiles?.find(
            (profile) => profile.id === request.metadataProfileId
          )?.name
        : undefined,
    rootFolder:
      defaultServer?.activeDirectory !== request.rootFolder
        ? request.rootFolder
        : undefined,
    languageProfile:
      request.type === 'tv' &&
      defaultServer?.activeLanguageProfileId !== request.languageProfileId
        ? data.languageProfiles?.find(
            (profile) => profile.id === request.languageProfileId
          )?.name
        : undefined,
  };
};

export default useRequestOverride;
