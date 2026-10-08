import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import { getMediaServerName } from '@app/components/Common/MediaServerIcon';
import Modal from '@app/components/Common/Modal';
import MediaQualitySelect from '@app/components/MediaDetails/MediaQualitySelect';
import AdvancedOptionsDisclosureButton from '@app/components/RequestModal/AdvancedOptionsDisclosureButton';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester, {
  RequestListboxControl,
} from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import RequestSeasonEpisodeTree from '@app/components/RequestModal/RequestSeasonEpisodeTree';
import SearchByNameModal from '@app/components/RequestModal/SearchByNameModal';
import {
  canPromotePendingDestinationRequests,
  createRequestDestination,
  isRequestDestinationAvailable,
  isRequestDestinationRequested,
  isRequestForDestination,
  isVideoQualityAvailable,
} from '@app/components/RequestModal/requestAvailability';
import useAdvancedOptionsDisclosure from '@app/hooks/useAdvancedOptionsDisclosure';
import usePlaybackCatalog from '@app/hooks/usePlaybackCatalog';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import {
  getAvailableEpisodesBySeason,
  getDefaultUnavailableSeasonSelections,
  getRequestableTvSelections,
  mergeEpisodeNumbersBySeason,
} from '@app/utils/tvRequestSelection';
import { hasLinkedWatchAheadAccount } from '@app/utils/watchAhead';
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestseriestitle: 'Request Series',
  requestseries4ktitle: 'Request Series in 4K',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Request',
  pending4krequest: 'Pending 4K Request',
  requestfrom: "{username}'s request is pending approval.",
  selectUnavailableItemsToRequest:
    'Select unavailable seasons or episodes to request.',
  alreadyAvailable:
    'The selected seasons or episodes are already available or requested.',
  noUnavailableItems: 'No unavailable seasons or episodes remain to request.',
  episodesLoading: 'Load episode information before submitting this selection.',
  requestQuotaExceeded:
    'Your remaining request quota is not enough for this selection.',
  season: 'Season',
  episodes: 'Episodes',
  seasonnumber: 'Season {number}',
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requestcancelled: 'Request for <strong>{title}</strong> canceled.',
  autoapproval: 'Automatic Approval',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  network: 'Network',
  status: 'Status',
  service: 'Service',
  approval: 'Approval',
  readyToRequest: 'Ready to Request',
  requested: 'Requested',
  notAvailable: 'Not Available',
  advancedOptions: 'Advanced Options',
  quality: 'Quality',
  watchAheadLabel: 'Episode Queue',
  watchAheadDescription:
    'Off by default. Choose one starting episode. When linked playback reaches 90%, SeerrNG asks Sonarr to keep this many upcoming episodes requested. Sonarr controls download timing. Turning the queue off stops future additions; episodes already requested stay in place.',
  watchAheadEditDescription:
    'This changes future episode queueing only. Your current request selections and episodes already requested stay in place.',
  watchAheadUnavailableServer:
    'Episode Queue needs Plex, Jellyfin, or Emby playback tracking.',
  watchAheadUnavailableLink:
    'Link your {mediaServer} account to SeerrNG so it can match your playback to this request.',
  watchAheadUnavailableIdentity:
    'Episode Queue needs a TVDB match for this series before it can connect playback to Sonarr.',
  watchAheadUnavailablePermission:
    'You need permission to request the selected TV quality to use Episode Queue.',
  watchAheadUnavailableSonarr:
    'Choose or configure a Sonarr server for the selected TV quality to use Episode Queue.',
  watchAheadUnavailableOwner:
    'Episode Queue follows the signed-in request owner’s playback, so it is available when you request for yourself.',
  watchAheadLearnMore: 'How Episode Queue works',
  watchAheadLinkAccount: 'Link account',
  watchAheadStartingEpisode:
    'Choose one episode to request first. As you watch, SeerrNG maintains the selected buffer of upcoming episodes in Sonarr.',
  watchAheadEditOnly: 'Update future queueing',
  watchAheadOff: 'Off',
  watchAheadEpisodeOption:
    '{count, plural, one {# episode} other {# episodes}}',
});

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus, is4k?: boolean) => void;
  onUpdating?: (isUpdating: boolean) => void;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  allow4kServerSelection?: boolean;
}

const TvRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  onUpdating,
  editRequest,
  is4k = false,
  allow4kServerSelection = false,
}: RequestModalProps) => {
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const [selectedIs4k, setSelectedIs4k] = useState(is4k);
  const [qualityRevision, setQualityRevision] = useState(0);
  const { addToast } = useToasts();
  const editingSeasonSelections: SeasonEpisodeSelection[] = (
    editRequest?.seasons ?? []
  ).map((season) => ({
    seasonNumber: season.seasonNumber,
    ...(season.episodeNumbers ? { episodeNumbers: season.episodeNumbers } : {}),
  }));
  const { data, error } = useSWR<TvDetails>(`/api/v1/tv/${tmdbId}`);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const [seasonSelections, setSeasonSelections] = useState<
    SeasonEpisodeSelection[]
  >(editRequest ? editingSeasonSelections : []);
  const [watchAheadEpisodeCount, setWatchAheadEpisodeCount] = useState(
    editRequest?.watchAheadEpisodeCount ?? 0
  );
  const selectionBeforeWatchAhead = useRef<SeasonEpisodeSelection[] | null>(
    null
  );
  const [initializedSelectionKey, setInitializedSelectionKey] = useState('');
  const [requestTreeReady, setRequestTreeReady] = useState(false);
  const selectedSeasons = seasonSelections.map(
    (selection) => selection.seasonNumber
  );
  const {
    open: advancedOptionsOpen,
    pinned: advancedOptionsPinned,
    toggleOpen: toggleAdvancedOptions,
    togglePin: toggleAdvancedOptionsPin,
  } = useAdvancedOptionsDisclosure('tv');
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const effectiveIs4k = requestOverrides?.is4k ?? selectedIs4k;
  const { data: playbackCatalog } = usePlaybackCatalog(
    data?.mediaInfo?.id,
    effectiveIs4k
  );
  const availableEpisodesBySeason = useMemo(
    () => getAvailableEpisodesBySeason(playbackCatalog),
    [playbackCatalog]
  );
  const intl = useIntl();
  const [searchModal, setSearchModal] = useState<{
    show: boolean;
  }>({
    show: true,
  });
  const [tvdbId, setTvdbId] = useState<number | undefined>(undefined);
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id ||
        hasPermission([Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS], {
          type: 'or',
        }))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );
  const isWatchAheadRequestForCurrentUser = editRequest
    ? editRequest.requestedBy.id === user?.id
    : !requestOverrides?.user || requestOverrides.user.id === user?.id;
  const { data: sonarrServers } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/sonarr',
    {
      refreshInterval: 0,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );
  const selectedService = sonarrServers?.find(
    (server) => server.id === requestOverrides?.server
  );
  const fallbackService = sonarrServers?.find(
    (server) => server.isDefault && server.is4k === effectiveIs4k
  );
  const watchAheadTvdbId = editRequest
    ? editRequest.media.tvdbId
    : (tvdbId ?? data?.externalIds.tvdbId);
  const canConfigureWatchAhead =
    hasLinkedWatchAheadAccount(
      user,
      settings.currentSettings.mediaServerType
    ) &&
    Number.isSafeInteger(Number(watchAheadTvdbId)) &&
    Number(watchAheadTvdbId) > 0 &&
    hasPermission(
      effectiveIs4k
        ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
        : [Permission.REQUEST, Permission.REQUEST_TV],
      { type: 'or' }
    ) &&
    Boolean(selectedService ?? fallbackService) &&
    isWatchAheadRequestForCurrentUser &&
    !editRequest?.watchAheadParentRequestId;
  const watchAheadMediaServerName = getMediaServerName(
    settings.currentSettings.mediaServerType
  );
  const needsWatchAheadAccountLink =
    Boolean(watchAheadMediaServerName) &&
    isWatchAheadRequestForCurrentUser &&
    !hasLinkedWatchAheadAccount(user, settings.currentSettings.mediaServerType);
  const watchAheadCardVisible =
    !editRequest ||
    (editRequest.requestedBy.id === user?.id &&
      !editRequest.watchAheadParentRequestId);
  const watchAheadUnavailableMessage = (() => {
    if (!watchAheadMediaServerName) {
      return intl.formatMessage(messages.watchAheadUnavailableServer);
    }
    if (!isWatchAheadRequestForCurrentUser) {
      return intl.formatMessage(messages.watchAheadUnavailableOwner);
    }
    if (needsWatchAheadAccountLink) {
      return intl.formatMessage(messages.watchAheadUnavailableLink, {
        mediaServer: watchAheadMediaServerName,
      });
    }
    if (
      !Number.isSafeInteger(Number(watchAheadTvdbId)) ||
      Number(watchAheadTvdbId) <= 0
    ) {
      return intl.formatMessage(messages.watchAheadUnavailableIdentity);
    }
    if (
      !hasPermission(
        effectiveIs4k
          ? [Permission.REQUEST_4K, Permission.REQUEST_4K_TV]
          : [Permission.REQUEST, Permission.REQUEST_TV],
        { type: 'or' }
      )
    ) {
      return intl.formatMessage(messages.watchAheadUnavailablePermission);
    }
    if (!selectedService && !fallbackService) {
      return intl.formatMessage(messages.watchAheadUnavailableSonarr);
    }
    return undefined;
  })();
  const selectedDestination = useMemo(
    () =>
      createRequestDestination(
        'sonarr',
        effectiveIs4k ? '4k' : 'standard',
        selectedService ?? fallbackService,
        requestOverrides
      ),
    [effectiveIs4k, fallbackService, requestOverrides, selectedService]
  );
  const requestSelectionKey = JSON.stringify([
    tmdbId,
    effectiveIs4k,
    selectedDestination?.serverId,
    selectedDestination?.profileId,
    selectedDestination?.metadataProfileId,
    selectedDestination?.languageProfileId,
    selectedDestination?.rootFolder,
  ]);
  const selectedDestinationAvailable =
    !editRequest &&
    (isVideoQualityAvailable(data?.mediaInfo, 'tv', effectiveIs4k) ||
      isRequestDestinationAvailable(data?.mediaInfo, selectedDestination));
  const selectedDestinationRequested =
    !editRequest &&
    isRequestDestinationRequested(
      data?.mediaInfo?.requests,
      selectedDestination
    );
  const currentlyRemaining =
    (quota?.tv.remaining ?? 0) -
    selectedSeasons.length +
    (editRequest?.seasons ?? []).length;

  const updateRequest = async (alsoApproveRequest = false) => {
    if (!editRequest || requestDisabled) {
      return;
    }

    if (onUpdating) {
      onUpdating(true);
      mutate('/api/v1/request/count');
    }

    try {
      if (selectedSeasons.length > 0) {
        await axios.put(`/api/v1/request/${editRequest.id}`, {
          mediaType: 'tv',
          serverId: requestOverrides?.server,
          profileId: requestOverrides?.profile,
          rootFolder: requestOverrides?.folder,
          languageProfileId: requestOverrides?.language,
          userId: requestOverrides?.user?.id,
          tags: requestOverrides?.tags,
          seasons: [...selectedSeasons].sort((a, b) => a - b),
          seasonRequests: seasonSelections,
          ...(canConfigureWatchAhead ||
          (isWatchAheadRequestForCurrentUser && watchAheadEpisodeCount === 0)
            ? { watchAheadEpisodeCount }
            : {}),
        });

        if (alsoApproveRequest) {
          await axios.post(`/api/v1/request/${editRequest.id}/approve`);
        }
      } else {
        await axios.delete(`/api/v1/request/${editRequest.id}`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {selectedSeasons.length > 0
            ? intl.formatMessage(
                alsoApproveRequest
                  ? messages.requestApproved
                  : messages.requestedited,
                {
                  title: data?.name,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                }
              )
            : intl.formatMessage(messages.requestcancelled, {
                title: data?.name,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
              })}
        </span>,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );
      if (onComplete) {
        onComplete(MediaStatus.PENDING, effectiveIs4k);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      if (onUpdating) {
        onUpdating(false);
      }
    }
  };

  const sendRequest = async () => {
    if (requestDisabled) {
      return;
    }

    if (usesEpisodeSelection && selectedSeasons.length === 0) {
      return;
    }

    if (onUpdating) {
      onUpdating(true);
      mutate('/api/v1/request/count');
    }

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          rootFolder: requestOverrides.folder,
          languageProfileId: requestOverrides.language,
          userId: requestOverrides?.user?.id,
          tags: requestOverrides.tags,
        };
      }
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id,
        tvdbId: tvdbId ?? data?.externalIds.tvdbId,
        mediaType: 'tv',
        is4k: effectiveIs4k,
        ignoreQuota: requestOverrides?.ignoreQuota,
        seasons: usesEpisodeSelection
          ? requestableSelections
              .map((selection) => selection.seasonNumber)
              .sort((a, b) => a - b)
          : getAllSeasons().filter(
              (season) => !getAllRequestedSeasons().includes(season)
            ),
        seasonRequests: usesEpisodeSelection
          ? requestableSelections
          : undefined,
        ...(isWatchAheadRequestForCurrentUser
          ? { watchAheadEpisodeCount }
          : {}),
        ...overrideParams,
      });
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');

      if (response.data) {
        if (onComplete) {
          onComplete(
            response.data.media[effectiveIs4k ? 'status4k' : 'status'],
            effectiveIs4k
          );
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccess, {
              title: data?.name,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      if (onUpdating) {
        onUpdating(false);
      }
    }
  };

  const getAllSeasons = useCallback((): number[] => {
    let allSeasons = (data?.seasons ?? []).filter(
      (season) => season.episodeCount !== 0
    );
    if (!settings.currentSettings.enableSpecialEpisodes) {
      allSeasons = allSeasons.filter((season) => season.seasonNumber > 0);
    }
    return allSeasons.map((season) => season.seasonNumber);
  }, [data?.seasons, settings.currentSettings.enableSpecialEpisodes]);

  const getAllRequestedEpisodes = useCallback((): Record<number, number[]> => {
    const requestedEpisodes: Record<number, number[]> = {};
    (data?.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.id !== editRequest?.id &&
          (selectedDestination
            ? isRequestForDestination(request, selectedDestination)
            : request.is4k === effectiveIs4k) &&
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.FAILED &&
          request.status !== MediaRequestStatus.COMPLETED
      )
      .flatMap((request) => request.seasons)
      .filter((season) => season.episodeNumbers != null)
      .forEach((season) => {
        requestedEpisodes[season.seasonNumber] = [
          ...new Set([
            ...(requestedEpisodes[season.seasonNumber] ?? []),
            ...(season.episodeNumbers ?? []),
          ]),
        ];
      });
    return requestedEpisodes;
  }, [
    data?.mediaInfo?.requests,
    editRequest?.id,
    effectiveIs4k,
    selectedDestination,
  ]);

  const getAllRequestedSeasons = useCallback((): number[] => {
    const requestedSeasons = (data?.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.id !== editRequest?.id &&
          (selectedDestination
            ? isRequestForDestination(request, selectedDestination)
            : request.is4k === effectiveIs4k) &&
          request.status !== MediaRequestStatus.DECLINED &&
          request.status !== MediaRequestStatus.FAILED &&
          request.status !== MediaRequestStatus.COMPLETED
      )
      .reduce((requestedSeasons, request) => {
        return [
          ...requestedSeasons,
          ...request.seasons
            .filter((season) => season.episodeNumbers == null)
            .map((sr) => sr.seasonNumber),
        ];
      }, [] as number[]);

    const availableSeasons = (data?.mediaInfo?.seasons ?? [])
      .filter(
        (season) =>
          season[effectiveIs4k ? 'status4k' : 'status'] ===
            MediaStatus.AVAILABLE &&
          (!selectedDestination ||
            (effectiveIs4k
              ? data?.mediaInfo?.serviceId4k
              : data?.mediaInfo?.serviceId) == null ||
            (effectiveIs4k
              ? data?.mediaInfo?.serviceId4k
              : data?.mediaInfo?.serviceId) === selectedDestination.serverId) &&
          !requestedSeasons.includes(season.seasonNumber)
      )
      .map((season) => season.seasonNumber);

    const fullyAvailableCatalogSeasons = (data?.seasons ?? [])
      .filter(
        (season) =>
          season.episodeCount > 0 &&
          (availableEpisodesBySeason[season.seasonNumber]?.length ?? 0) >=
            season.episodeCount
      )
      .map((season) => season.seasonNumber);
    const blockedEpisodes = mergeEpisodeNumbersBySeason(
      availableEpisodesBySeason,
      getAllRequestedEpisodes()
    );
    const fullyBlockedSeasons = (data?.seasons ?? [])
      .filter(
        (season) =>
          season.episodeCount > 0 &&
          (blockedEpisodes[season.seasonNumber]?.length ?? 0) >=
            season.episodeCount
      )
      .map((season) => season.seasonNumber);

    return [
      ...new Set([
        ...requestedSeasons,
        ...availableSeasons,
        ...fullyAvailableCatalogSeasons,
        ...fullyBlockedSeasons,
      ]),
    ];
  }, [
    availableEpisodesBySeason,
    data?.mediaInfo?.requests,
    data?.mediaInfo?.seasons,
    data?.seasons,
    editRequest?.id,
    effectiveIs4k,
    getAllRequestedEpisodes,
    selectedDestination,
    data?.mediaInfo?.serviceId,
    data?.mediaInfo?.serviceId4k,
  ]);

  const unrequestedSeasons = getAllSeasons().filter(
    (season) => !getAllRequestedSeasons().includes(season)
  );
  const changeWatchAheadEpisodeCount = (nextCount: number) => {
    if (!editRequest && watchAheadEpisodeCount === 0 && nextCount > 0) {
      const currentNormalSelection: SeasonEpisodeSelection[] = settings
        .currentSettings.partialRequestsEnabled
        ? seasonSelections
        : unrequestedSeasons.map((seasonNumber) => ({ seasonNumber }));
      selectionBeforeWatchAhead.current = currentNormalSelection.map(
        (selection) => ({
          seasonNumber: selection.seasonNumber,
          ...(selection.episodeNumbers
            ? { episodeNumbers: [...selection.episodeNumbers] }
            : {}),
        })
      );
      setSeasonSelections(currentNormalSelection);
    } else if (!editRequest && watchAheadEpisodeCount > 0 && nextCount === 0) {
      if (selectionBeforeWatchAhead.current) {
        setSeasonSelections(selectionBeforeWatchAhead.current);
      }
      selectionBeforeWatchAhead.current = null;
    }
    setWatchAheadEpisodeCount(nextCount);
  };
  const usesEpisodeSelection =
    settings.currentSettings.partialRequestsEnabled ||
    watchAheadEpisodeCount > 0;
  const blockedEpisodesBySeason = mergeEpisodeNumbersBySeason(
    availableEpisodesBySeason,
    getAllRequestedEpisodes()
  );
  const requestSelections = usesEpisodeSelection
    ? seasonSelections
    : unrequestedSeasons.map((seasonNumber) => ({ seasonNumber }));
  const requestableSelections = getRequestableTvSelections(
    requestSelections,
    data?.seasons ?? [],
    getAllRequestedSeasons(),
    blockedEpisodesBySeason
  );
  const partialQuotaExceeded =
    !!quota?.tv.limit &&
    !requestOverrides?.ignoreQuota &&
    requestableSelections.length >
      (quota.tv.remaining ?? 0) + (editRequest?.seasons.length ?? 0);
  const fullQuotaExceeded =
    !!quota?.tv.limit &&
    !requestOverrides?.ignoreQuota &&
    unrequestedSeasons.length > (quota.tv.remaining ?? 0);
  const requestDisabledReason =
    usesEpisodeSelection && !requestTreeReady && selectedSeasons.length > 0
      ? intl.formatMessage(messages.episodesLoading)
      : partialQuotaExceeded || (!usesEpisodeSelection && fullQuotaExceeded)
        ? intl.formatMessage(messages.requestQuotaExceeded)
        : requestableSelections.length === 0
          ? usesEpisodeSelection &&
            seasonSelections.length === 0 &&
            unrequestedSeasons.length > 0
            ? intl.formatMessage(messages.selectUnavailableItemsToRequest)
            : intl.formatMessage(
                unrequestedSeasons.length === 0
                  ? messages.noUnavailableItems
                  : messages.alreadyAvailable
              )
          : undefined;

  useEffect(() => {
    if (
      editRequest ||
      !settings.currentSettings.partialRequestsEnabled ||
      !data ||
      initializedSelectionKey === requestSelectionKey
    ) {
      return;
    }

    const defaults = getDefaultUnavailableSeasonSelections(
      data.seasons.filter((season) =>
        getAllSeasons().includes(season.seasonNumber)
      ),
      getAllRequestedSeasons()
    );
    setSeasonSelections(defaults);
    setInitializedSelectionKey(requestSelectionKey);
  }, [
    data,
    editRequest,
    effectiveIs4k,
    getAllRequestedSeasons,
    getAllSeasons,
    initializedSelectionKey,
    requestSelectionKey,
    settings.currentSettings.partialRequestsEnabled,
  ]);

  useEffect(() => {
    if (editRequest) {
      return;
    }

    const coveredSeasons = new Set(getAllRequestedSeasons());
    setSeasonSelections((currentSelections) =>
      currentSelections.filter(
        (selection) => !coveredSeasons.has(selection.seasonNumber)
      )
    );
  }, [editRequest, getAllRequestedSeasons]);

  const isOwner = editRequest && editRequest.requestedBy.id === user?.id;
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const hasAutoApprove = hasAutoApprovePermission(
    requestOverrides?.user?.permissions ?? user?.permissions ?? 0,
    'tv',
    effectiveIs4k
  );
  const selectedDestinationPromotable =
    selectedDestinationRequested &&
    canPromotePendingDestinationRequests(
      data?.mediaInfo?.requests,
      [selectedDestination],
      {
        canManageRequests: hasPermission(Permission.MANAGE_REQUESTS),
        hasAutoApprove,
      }
    );
  const selectedDestinationCovered =
    selectedDestinationAvailable ||
    (selectedDestinationRequested && !selectedDestinationPromotable);
  const isAnime =
    data?.keywords.some((keyword) => keyword.id === ANIME_KEYWORD_ID) ?? false;
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const firstAirDate = data?.firstAirDate
    ? intl.formatDate(new Date(`${data.firstAirDate}T00:00:00`), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : notAvailable;
  const releaseYear = data?.firstAirDate?.match(/^\d{4}/)?.[0];
  const runtime = data?.episodeRunTime.find(
    (minutes) => minutes > 0 && Number.isFinite(minutes)
  );
  const featuredCrew =
    data && data.createdBy.length > 0
      ? data.createdBy.slice(0, 2).map((person) => ({
          id: person.id,
          job: 'Creator',
          name: person.name,
        }))
      : sortCrewPriority(data?.credits?.crew ?? []).slice(0, 2);
  const network =
    data?.networks?.[0]?.name ??
    data?.productionCompanies?.[0]?.name ??
    notAvailable;
  const visibleSeasons = (data?.seasons ?? []).filter(
    (season) =>
      season.episodeCount !== 0 &&
      (settings.currentSettings.enableSpecialEpisodes ||
        season.seasonNumber !== 0)
  );
  const requestButtonLabel = editRequest
    ? selectedSeasons.length === 0
      ? intl.formatMessage(messages.cancel)
      : hasPermission(Permission.MANAGE_REQUESTS)
        ? intl.formatMessage(messages.approve)
        : intl.formatMessage(messages.edit)
    : intl.formatMessage(globalMessages.request);
  const requestDisabled = editRequest
    ? usesEpisodeSelection && selectedSeasons.length > 0 && !requestTreeReady
    : (usesEpisodeSelection && !requestTreeReady) ||
      selectedDestinationCovered ||
      requestableSelections.length === 0 ||
      partialQuotaExceeded ||
      (!usesEpisodeSelection && fullQuotaExceeded);
  const closeAction = tvdbId ? () => setSearchModal({ show: true }) : onCancel;
  const submitAction = () =>
    editRequest
      ? hasPermission(Permission.MANAGE_REQUESTS)
        ? updateRequest(true)
        : updateRequest()
      : sendRequest();

  return data && !error && !data.externalIds.tvdbId && searchModal.show ? (
    <SearchByNameModal
      tvdbId={tvdbId}
      setTvdbId={setTvdbId}
      closeModal={() => setSearchModal({ show: false })}
      onCancel={onCancel}
      modalTitle={intl.formatMessage(
        effectiveIs4k
          ? messages.requestseries4ktitle
          : messages.requestseriestitle
      )}
      modalSubTitle={data.name}
      tmdbId={tmdbId}
      backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
    />
  ) : (
    <Modal
      loading={!data && !error}
      backgroundClickable
      onCancel={closeAction}
      onOk={submitAction}
      hideActions
      alignTop
      title={intl.formatMessage(
        editRequest
          ? is4k
            ? messages.pending4krequest
            : messages.pendingrequest
          : effectiveIs4k
            ? messages.requestseries4ktitle
            : messages.requestseriestitle
      )}
      okText={requestButtonLabel}
      okButtonProps={{
        buttonIcon:
          editRequest && selectedSeasons.length === 0 ? 'cancel' : undefined,
      }}
      okDisabled={requestDisabled}
      okButtonType={
        editRequest
          ? settings.currentSettings.partialRequestsEnabled &&
            selectedSeasons.length === 0
            ? 'danger'
            : hasPermission(Permission.MANAGE_REQUESTS)
              ? 'success'
              : 'primary'
          : 'primary'
      }
      cancelText={
        editRequest
          ? intl.formatMessage(globalMessages.close)
          : tvdbId
            ? intl.formatMessage(globalMessages.back)
            : intl.formatMessage(globalMessages.cancel)
      }
      cancelButtonType={editRequest ? 'danger' : 'default'}
      actionButtonSize={editRequest ? 'standard' : 'sm'}
      dialogClass="request-modal-site-surface"
    >
      <RequestMediaCard
        artwork={
          data?.backdropPath
            ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
            : getTmdbPosterImageUrl(data?.posterPath, 'original')
        }
        artworkType="tmdb"
      >
        {editRequest && (
          <div className="app-card-inset refreshed-inset-surface card-spacing-after">
            {isOwner
              ? intl.formatMessage(messages.pendingapproval)
              : intl.formatMessage(messages.requestfrom, {
                  username: editRequest.requestedBy.displayName,
                })}
          </div>
        )}
        {(quota?.tv.limit ?? 0) > 0 && (
          <QuotaDisplay
            mediaType="tv"
            quota={quota?.tv}
            remaining={
              !settings.currentSettings.partialRequestsEnabled &&
              unrequestedSeasons.length > (quota?.tv.remaining ?? 0)
                ? 0
                : currentlyRemaining
            }
            userOverride={
              requestOverrides?.user && requestOverrides.user.id !== user?.id
                ? requestOverrides?.user?.id
                : undefined
            }
            overLimit={
              !settings.currentSettings.partialRequestsEnabled &&
              unrequestedSeasons.length > (quota?.tv.remaining ?? 0)
                ? unrequestedSeasons.length
                : undefined
            }
          />
        )}
        <div className="app-card-inset refreshed-inset-surface detail-summary-card">
          <div className="app-detail-summary-grid">
            <div className="app-detail-poster-frame detail-card-poster">
              <CachedImage
                type="tmdb"
                src={
                  getTmdbPosterImageUrl(data?.posterPath) ||
                  '/images/seerr_poster_not_found.png'
                }
                alt=""
                fill
                sizes="(min-width: 640px) 80px, 64px"
                className="media-detail-artwork-image"
              />
            </div>

            <div>
              <h3 className="card-title detail-summary-title">
                {data?.name}
                {releaseYear ? ` (${releaseYear})` : ''}
              </h3>

              <div className="detail-card-heading-spacing detail-three-column-grid">
                <div className="detail-paired-column-span">
                  <dl className="card-table detail-paired-columns">
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.mediaAndFormat)}:
                    </dt>
                    <dd className="card-table-value">
                      Series · {effectiveIs4k ? '4K' : 'HD'}
                    </dd>
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.releaseDate)}:
                    </dt>
                    <dd className="card-table-value">{firstAirDate}</dd>
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.runtime)}:
                    </dt>
                    <dd className="card-table-value">
                      {runtime
                        ? `${intl.formatNumber(runtime)} minutes`
                        : notAvailable}
                    </dd>
                    <div className="card-table media-detail-column-divider">
                      {featuredCrew.map((person) => (
                        <div
                          className="card-table-group"
                          key={`${person.job}-${person.id}`}
                        >
                          <dt className="card-table-heading">{person.job}:</dt>
                          <dd className="card-table-value">{person.name}</dd>
                        </div>
                      ))}
                      <dt className="card-table-heading">
                        {intl.formatMessage(messages.network)}:
                      </dt>
                      <dd className="card-table-value">{network}</dd>
                    </div>
                    <dt className="card-table-heading">
                      {intl.formatMessage(messages.genres)}:
                    </dt>
                    <dd
                      className="card-table-value"
                      data-wrap="true"
                      data-lines="2"
                    >
                      {data?.genres?.length
                        ? data.genres
                            .slice(0, 3)
                            .map((genre) => genre.name)
                            .join(', ')
                        : notAvailable}
                    </dd>
                  </dl>
                </div>
                <dl className="card-table media-detail-column-divider">
                  <dt className="card-table-heading">
                    {intl.formatMessage(messages.status)}:
                  </dt>
                  <dd className="card-table-value">
                    {intl.formatMessage(
                      selectedDestinationAvailable
                        ? globalMessages.available
                        : selectedDestinationRequested
                          ? messages.requested
                          : messages.readyToRequest
                    )}
                  </dd>
                  <dt className="card-table-heading">
                    {intl.formatMessage(messages.service)}:
                  </dt>
                  <dd className="card-table-value">
                    {selectedService?.name ??
                      fallbackService?.name ??
                      notAvailable}
                  </dd>
                  <dt className="card-table-heading">
                    {intl.formatMessage(messages.approval)}:
                  </dt>
                  <dd className="card-table-value">
                    <RequestFooterStatus
                      available={selectedDestinationAvailable}
                      requested={selectedDestinationRequested}
                      hasAutoApprove={hasAutoApprove}
                    />
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="request-selection-layout">
          {usesEpisodeSelection && data && (
            <RequestSeasonEpisodeTree
              key={requestSelectionKey}
              tvId={data.id}
              seasons={visibleSeasons}
              selections={requestableSelections}
              disabledSeasons={getAllRequestedSeasons()}
              disabledEpisodes={blockedEpisodesBySeason}
              availableEpisodesBySeason={availableEpisodesBySeason}
              selectionMode={
                watchAheadEpisodeCount > 0 && !editRequest
                  ? 'single-episode'
                  : 'multiple'
              }
              onReadyChange={setRequestTreeReady}
              onSelectionsChange={(nextSelections) => {
                const allowedSelections =
                  (quota?.tv.remaining ?? 0) +
                  (editRequest?.seasons.length ?? 0);
                if (
                  !quota?.tv.limit ||
                  requestOverrides?.ignoreQuota ||
                  nextSelections.length <= seasonSelections.length ||
                  nextSelections.length <= allowedSelections
                ) {
                  setSeasonSelections(nextSelections);
                }
              }}
            />
          )}

          <div className="request-selection-options">
            {!editRequest && (
              <MediaQualitySelect
                value={effectiveIs4k ? '4k' : 'hd'}
                options={[
                  { label: 'HD', value: 'hd' },
                  { label: '4K', value: '4k' },
                ]}
                onChange={(quality) => {
                  setSelectedIs4k(quality === '4k');
                  setRequestOverrides(null);
                  setQualityRevision((current) => current + 1);
                }}
                label={intl.formatMessage(messages.quality)}
                autoSelectAvailable={false}
                purpose="request"
              />
            )}
            {watchAheadCardVisible && (
              <div className="app-card-inset refreshed-inset-surface detail-item-padded request-episode-queue">
                <RequestListboxControl
                  id="tv-watch-ahead-count"
                  label={intl.formatMessage(messages.watchAheadLabel)}
                  value={watchAheadEpisodeCount}
                  options={[
                    {
                      value: 0,
                      label: intl.formatMessage(messages.watchAheadOff),
                    },
                    ...(canConfigureWatchAhead
                      ? [1, 2, 3, 4, 5]
                      : watchAheadEpisodeCount > 0
                        ? [watchAheadEpisodeCount]
                        : []
                    ).map((count) => ({
                      value: count,
                      label: intl.formatMessage(
                        messages.watchAheadEpisodeOption,
                        { count }
                      ),
                    })),
                  ]}
                  onChange={changeWatchAheadEpisodeCount}
                  disabled={
                    !canConfigureWatchAhead && watchAheadEpisodeCount === 0
                  }
                  loadingLabel={intl.formatMessage(messages.watchAheadOff)}
                />
                <p className="request-episode-queue-description refreshed-detail-text-muted">
                  {intl.formatMessage(
                    editRequest
                      ? messages.watchAheadEditDescription
                      : messages.watchAheadDescription
                  )}
                </p>
                {!editRequest && watchAheadEpisodeCount > 0 && (
                  <p className="request-episode-queue-description refreshed-detail-text-muted">
                    {intl.formatMessage(messages.watchAheadStartingEpisode)}
                  </p>
                )}
                {watchAheadUnavailableMessage && (
                  <p
                    className="request-episode-queue-description refreshed-detail-text-muted"
                    role="status"
                  >
                    {watchAheadUnavailableMessage}
                  </p>
                )}
                {needsWatchAheadAccountLink && (
                  <Button
                    as="a"
                    href="/profile/settings/linked-accounts"
                    buttonType="ghost"
                    buttonSize="sm"
                  >
                    {intl.formatMessage(messages.watchAheadLinkAccount)}
                  </Button>
                )}
                <Button
                  as="a"
                  href="https://github.com/snapetech/seerrng/blob/main/docs/using-seerr/jellyfin-watch-ahead.md"
                  target="_blank"
                  rel="noreferrer"
                  buttonType="ghost"
                  buttonSize="sm"
                >
                  {intl.formatMessage(messages.watchAheadLearnMore)}
                </Button>
              </div>
            )}
          </div>
        </div>
        {canUseAdvancedOptions && (
          <AdvancedRequester
            key={(selectedIs4k ? '4k' : 'hd') + '-' + qualityRevision}
            type="tv"
            tmdbId={tmdbId}
            is4k={selectedIs4k}
            allow4kServerSelection={allow4kServerSelection && !editRequest}
            isAnime={isAnime}
            quota={quota}
            requestUser={editRequest?.requestedBy}
            requestId={editRequest?.id}
            defaultOverrides={
              editRequest
                ? {
                    folder: editRequest.rootFolder,
                    profile: editRequest.profileId,
                    server: editRequest.serverId,
                    language: editRequest.languageProfileId,
                    tags: editRequest.tags,
                  }
                : undefined
            }
            expanded={advancedOptionsOpen}
            panelOnly
            rootFolderTable
            requestedByPortal={requestedByPortal}
            onChange={(overrides) => setRequestOverrides(overrides)}
          />
        )}

        <div className="app-action-row app-modal-actions">
          <div className="app-action-row" data-action-placement="leading">
            {canUseAdvancedOptions && (
              <AdvancedOptionsDisclosureButton
                label={intl.formatMessage(messages.advancedOptions)}
                open={advancedOptionsOpen}
                pinned={advancedOptionsPinned}
                onToggle={toggleAdvancedOptions}
                onPin={toggleAdvancedOptionsPin}
              />
            )}
          </div>
          <div className="app-action-row" ref={setRequestedByPortal} />
          <Button
            type="button"
            onClick={closeAction}
            data-testid="modal-cancel-button"
            buttonType="danger"
            buttonSize="standard"
          >
            <XMarkIcon aria-hidden="true" />
            {editRequest
              ? intl.formatMessage(globalMessages.close)
              : intl.formatMessage(globalMessages.cancel)}
          </Button>
          <Button
            type="button"
            disabled={requestDisabled}
            disabledReason={requestDisabledReason}
            onClick={() => void submitAction()}
            data-testid="modal-ok-button"
            buttonType="success"
            buttonSize="standard"
          >
            {editRequest && selectedSeasons.length === 0 ? (
              <XMarkIcon aria-hidden="true" />
            ) : (
              <ArrowDownTrayIcon aria-hidden="true" />
            )}
            {requestButtonLabel}
          </Button>
        </div>
      </RequestMediaCard>
    </Modal>
  );
};

export default TvRequestModal;
