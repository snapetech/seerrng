import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import SeriesSeasonEpisodeSelector from '@app/components/Common/SeriesSeasonEpisodeSelector';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import SearchByNameModal from '@app/components/RequestModal/SearchByNameModal';
import {
  canPromotePendingDestinationRequests,
  createRequestDestination,
  isRequestDestinationAvailable,
  isRequestDestinationRequested,
} from '@app/components/RequestModal/requestAvailability';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
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
import { useState } from 'react';
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
  requestseasons:
    'Request {seasonCount} {seasonCount, plural, one {Season} other {Seasons}}',
  requestseasons4k:
    'Request {seasonCount} {seasonCount, plural, one {Season} other {Seasons}} in 4K',
  alreadyrequested: 'Already Requested',
  selectseason: 'Select Season(s)',
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
  const [activeSeason, setActiveSeason] = useState<number>(
    editingSeasonSelections[0]?.seasonNumber ?? -1
  );
  const selectedSeasons = seasonSelections.map(
    (selection) => selection.seasonNumber
  );
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(true);
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const effectiveIs4k = requestOverrides?.is4k ?? is4k;
  const intl = useIntl();
  const { user, hasPermission } = useUser();
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
  const selectedDestination = createRequestDestination(
    'sonarr',
    effectiveIs4k ? '4k' : 'standard',
    selectedService ?? fallbackService,
    requestOverrides
  );
  const selectedDestinationAvailable =
    !editRequest &&
    isRequestDestinationAvailable(data?.mediaInfo, selectedDestination);
  const selectedDestinationRequested =
    !editRequest &&
    isRequestDestinationRequested(
      data?.mediaInfo?.requests,
      selectedDestination
    );
  const selectedDestinationPromotable =
    selectedDestinationRequested &&
    canPromotePendingDestinationRequests(
      data?.mediaInfo?.requests,
      [selectedDestination],
      {
        canManageRequests: hasPermission(Permission.MANAGE_REQUESTS),
        hasAutoApprove: hasAutoApprovePermission(
          user?.permissions ?? 0,
          'tv',
          effectiveIs4k
        ),
      }
    );
  const selectedDestinationCovered =
    selectedDestinationAvailable ||
    (selectedDestinationRequested && !selectedDestinationPromotable);

  const currentlyRemaining =
    (quota?.tv.remaining ?? 0) -
    selectedSeasons.length +
    (editRequest?.seasons ?? []).length;

  const updateRequest = async (alsoApproveRequest = false) => {
    if (!editRequest) {
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
    if (selectedDestinationCovered) {
      return;
    }

    if (
      settings.currentSettings.partialRequestsEnabled &&
      selectedSeasons.length === 0
    ) {
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
        seasons: settings.currentSettings.partialRequestsEnabled
          ? [...selectedSeasons].sort((a, b) => a - b)
          : getAllSeasons().filter(
              (season) => !getAllRequestedSeasons().includes(season)
            ),
        seasonRequests: settings.currentSettings.partialRequestsEnabled
          ? seasonSelections
          : undefined,
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

  const getAllSeasons = (): number[] => {
    let allSeasons = (data?.seasons ?? []).filter(
      (season) => season.episodeCount !== 0
    );
    if (!settings.currentSettings.enableSpecialEpisodes) {
      allSeasons = allSeasons.filter((season) => season.seasonNumber > 0);
    }
    return allSeasons.map((season) => season.seasonNumber);
  };

  const getAllRequestedSeasons = (): number[] => {
    const requestedSeasons = (data?.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.id !== editRequest?.id &&
          request.is4k === effectiveIs4k &&
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
          !requestedSeasons.includes(season.seasonNumber)
      )
      .map((season) => season.seasonNumber);

    return [...requestedSeasons, ...availableSeasons];
  };

  const getAllRequestedEpisodes = (): Record<number, number[]> => {
    const requestedEpisodes: Record<number, number[]> = {};
    (data?.mediaInfo?.requests ?? [])
      .filter(
        (request) =>
          request.id !== editRequest?.id &&
          request.is4k === effectiveIs4k &&
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
  };

  const unrequestedSeasons = getAllSeasons().filter(
    (season) => !getAllRequestedSeasons().includes(season)
  );

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
    : getAllRequestedSeasons().length >= getAllSeasons().length
      ? intl.formatMessage(messages.alreadyrequested)
      : !settings.currentSettings.partialRequestsEnabled
        ? intl.formatMessage(
            effectiveIs4k ? globalMessages.request4k : globalMessages.request
          )
        : selectedSeasons.length === 0
          ? intl.formatMessage(messages.selectseason)
          : intl.formatMessage(
              effectiveIs4k
                ? messages.requestseasons4k
                : messages.requestseasons,
              { seasonCount: selectedSeasons.length }
            );
  const requestDisabled = editRequest
    ? false
    : selectedDestinationCovered ||
      (!settings.currentSettings.partialRequestsEnabled &&
        quota?.tv.limit &&
        unrequestedSeasons.length > quota.tv.limit &&
        !requestOverrides?.ignoreQuota) ||
      getAllRequestedSeasons().length >= getAllSeasons().length ||
      (settings.currentSettings.partialRequestsEnabled &&
        selectedSeasons.length === 0);
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
      backdrop={
        data?.backdropPath
          ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
          : getTmdbPosterImageUrl(data?.posterPath, 'original')
      }
      backdropFull
      actionButtonSize={editRequest ? 'standard' : 'sm'}
      dialogClass="artwork-form-main-card refreshed-card-surface refreshed-detail-text"
    >
      {editRequest && (
        <div className="refreshed-inset-surface mb-[5px] rounded-lg border border-gray-700 p-3">
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
      <div className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type="tmdb"
              src={
                getTmdbPosterImageUrl(data?.posterPath) ||
                '/images/seerr_poster_not_found.png'
              }
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <h3 className="-mt-0.5 truncate text-lg leading-5 font-semibold text-white">
              {data?.name}
              {releaseYear ? ` (${releaseYear})` : ''}
            </h3>

            <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch">
              <div className="card:col-span-2 card:pr-3 min-w-0">
                <dl className="refreshed-detail-text-muted card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                  <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                    Series · {effectiveIs4k ? '4K' : 'HD'}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                    {intl.formatMessage(messages.releaseDate)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                    {firstAirDate}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                    {intl.formatMessage(messages.runtime)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                    {runtime
                      ? `${intl.formatNumber(runtime)} minutes`
                      : notAvailable}
                  </dd>
                  <div className="media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                    {featuredCrew.map((person) => (
                      <div
                        className="contents"
                        key={`${person.job}-${person.id}`}
                      >
                        <dt className="font-medium text-gray-100">
                          {person.job}:
                        </dt>
                        <dd className="m-0 truncate">{person.name}</dd>
                      </div>
                    ))}
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.network)}:
                    </dt>
                    <dd className="m-0 truncate">{network}</dd>
                  </div>
                  <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  <dd className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 mt-0.5 line-clamp-2 min-w-0 break-words">
                    {data?.genres?.length
                      ? data.genres
                          .slice(0, 3)
                          .map((genre) => genre.name)
                          .join(', ')
                      : notAvailable}
                  </dd>
                </dl>
              </div>
              <dl className="refreshed-detail-text-muted media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4">
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.status)}:
                </dt>
                <dd className="m-0 truncate">
                  {intl.formatMessage(
                    selectedDestinationAvailable
                      ? globalMessages.available
                      : selectedDestinationRequested
                        ? messages.requested
                        : messages.readyToRequest
                  )}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.service)}:
                </dt>
                <dd className="m-0 truncate">
                  {selectedService?.name ??
                    fallbackService?.name ??
                    notAvailable}
                </dd>
                <dt className="font-medium text-gray-100">
                  {intl.formatMessage(messages.approval)}:
                </dt>
                <dd className="m-0 min-w-0">
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

      {settings.currentSettings.partialRequestsEnabled && data && (
        <SeriesSeasonEpisodeSelector
          tvId={data.id}
          seasons={visibleSeasons}
          selections={seasonSelections}
          activeSeason={
            activeSeason >= 0
              ? activeSeason
              : (visibleSeasons[0]?.seasonNumber ?? -1)
          }
          disabledSeasons={getAllRequestedSeasons()}
          disabledEpisodes={getAllRequestedEpisodes()}
          onActiveSeasonChange={setActiveSeason}
          onSelectionsChange={(nextSelections) => {
            const allowedSelections =
              (quota?.tv.remaining ?? 0) + (editRequest?.seasons.length ?? 0);
            if (
              !quota?.tv.limit ||
              requestOverrides?.ignoreQuota ||
              nextSelections.length <= allowedSelections
            ) {
              setSeasonSelections(nextSelections);
            }
          }}
        />
      )}

      {canUseAdvancedOptions && (
        <AdvancedRequester
          type="tv"
          is4k={is4k}
          allow4kServerSelection={allow4kServerSelection && !editRequest}
          isAnime={isAnime}
          quota={quota}
          requestUser={editRequest?.requestedBy}
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

      <div className="mt-[5px] flex flex-wrap items-center justify-end gap-2">
        <div className="mr-auto flex items-center gap-2">
          {canUseAdvancedOptions && (
            <button
              type="button"
              className="request-form-control compact-control inline-flex items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition focus:ring-2 focus:ring-indigo-400 focus:outline-none focus:ring-inset"
              aria-expanded={advancedOptionsOpen}
              onClick={() => setAdvancedOptionsOpen((open) => !open)}
            >
              <AdjustmentsHorizontalIcon
                className="h-3.5 w-3.5"
                aria-hidden="true"
              />
              {intl.formatMessage(messages.advancedOptions)}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 transition-transform ${advancedOptionsOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
        <div
          className="compact-control flex items-center"
          ref={setRequestedByPortal}
        />
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
          onClick={() => void submitAction()}
          data-testid="modal-ok-button"
          buttonType="success"
          buttonSize="standard"
        >
          <ArrowDownTrayIcon aria-hidden="true" />
          {requestButtonLabel}
        </Button>
      </div>
    </Modal>
  );
};

export default TvRequestModal;
