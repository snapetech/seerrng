import Alert from '@app/components/Common/Alert';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import AlbumTrackList from '@app/components/MediaDetails/AlbumTrackList';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import {
  canPromotePendingDestinationRequests,
  createRequestDestination,
  isRequestDestinationAvailable,
  isRequestDestinationRequested,
} from '@app/components/RequestModal/requestAvailability';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import {
  encodeApiPathSegment,
  normalizeMusicBrainzId,
} from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { MusicDetails } from '@server/models/Music';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Music', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestEdited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requestmusic: 'Request Music',
  pendingrequest: 'Pending Music Request',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  close: 'Close',
  pendingapproval: 'Your request is pending approval.',
  requestfrom: "{username}'s request is pending approval.",
  requesterror: 'Something went wrong while submitting the request.',
  backendRequestFailed:
    'The request was submitted, but Lidarr rejected it while processing.',
  editerror: 'Something went wrong while editing the request.',
  noLidarrServer:
    'No Lidarr service is configured. Music requests are unavailable.',
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  artist: 'Artist',
  albumType: 'Album Type',
  trackCount: 'Track Count',
  status: 'Status',
  service: 'Service',
  approval: 'Approval',
  requested: 'Requested',
  readyToRequest: 'Ready to Request',
  notAvailable: 'Not Available',
  advancedOptions: 'Advanced Options',
});

interface MusicRequestModalProps {
  mbId: string;
  initialServerId?: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  editRequest?: NonFunctionProperties<MediaRequest>;
}

const MusicRequestModal = ({
  mbId,
  initialServerId,
  onCancel,
  onComplete,
  onUpdating,
  editRequest,
}: MusicRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(
      initialServerId !== undefined ? { server: initialServerId } : null
    );
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(true);
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const normalizedMbId = normalizeMusicBrainzId(mbId);
  const { data, error } = useSWR<MusicDetails>(
    `/api/v1/music/${encodeApiPathSegment(normalizedMbId)}`,
    {
      revalidateOnMount: true,
    }
  );
  const { data: musicServices } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/lidarr'
  );
  const selectedService = musicServices?.find(
    (server) => server.id === requestOverrides?.server
  );
  const fallbackService = musicServices?.find((server) => server.isDefault);
  const selectedDestination = createRequestDestination(
    'lidarr',
    'music',
    selectedService ?? fallbackService,
    requestOverrides
  );
  const selectedDestinationAvailable =
    !editRequest &&
    isRequestDestinationAvailable(
      data?.mediaInfo,
      selectedDestination,
      data?.availableServices?.map((service) => service.serverId)
    );
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
          'music'
        ),
      }
    );
  const selectedDestinationCovered =
    selectedDestinationAvailable ||
    (selectedDestinationRequested && !selectedDestinationPromotable);
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id ||
        hasPermission([Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS], {
          type: 'or',
        }))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  useEffect(() => {
    setRequestOverrides(
      initialServerId !== undefined ? { server: initialServerId } : null
    );
  }, [editRequest?.id, initialServerId, mbId]);

  useEffect(() => {
    onUpdating?.(isUpdating);
  }, [isUpdating, onUpdating]);

  const sendRequest = useCallback(async () => {
    if (selectedDestinationCovered) {
      return;
    }

    setIsUpdating(true);

    try {
      const overrideParams = requestOverrides
        ? {
            serverId: requestOverrides.server,
            profileId: requestOverrides.profile,
            metadataProfileId: requestOverrides.metadataProfile,
            rootFolder: requestOverrides.folder,
            userId: requestOverrides.user?.id,
            tags: requestOverrides.tags,
          }
        : {};
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.mbId
          ? normalizeMusicBrainzId(data.mbId)
          : normalizedMbId,
        mediaType: MediaType.MUSIC,
        ...overrideParams,
      });

      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.data) {
        if (response.data.status === MediaRequestStatus.FAILED) {
          addToast(intl.formatMessage(messages.backendRequestFailed), {
            appearance: 'error',
            autoDismiss: true,
          });
          return;
        }

        onComplete?.(
          response.data.status === MediaRequestStatus.APPROVED
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
        );
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccess, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch (error) {
      const responseMessage = axios.isAxiosError<{ message?: unknown }>(error)
        ? error.response?.data?.message
        : undefined;
      addToast(
        typeof responseMessage === 'string' && responseMessage.length > 0
          ? responseMessage
          : intl.formatMessage(messages.requesterror),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsUpdating(false);
    }
  }, [
    addToast,
    data?.mbId,
    data?.title,
    intl,
    normalizedMbId,
    onComplete,
    requestOverrides,
    selectedDestinationCovered,
  ]);

  const hasAutoApprove = hasAutoApprovePermission(
    requestOverrides?.user?.permissions ?? user?.permissions ?? 0,
    'music'
  );
  const serviceUnavailable = !!musicServices && musicServices.length === 0;
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const releaseDate = data?.releaseDate
    ? intl.formatDate(new Date(`${data.releaseDate}T00:00:00`), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : notAvailable;
  const releaseYear = data?.releaseDate?.match(/^\d{4}/)?.[0];
  const runtimeMinutes = Math.round(
    (data?.tracks ?? []).reduce((total, track) => total + track.length, 0) /
      60000
  );
  const genres = [...(data?.tags?.releaseGroup ?? [])]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((tag) => tag.tag)
    .filter(Boolean)
    .join(', ');
  const requestButtonLabel = isUpdating
    ? intl.formatMessage(globalMessages.requesting)
    : intl.formatMessage(globalMessages.request);

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        onComplete?.(MediaStatus.UNKNOWN);
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.editerror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: MediaType.MUSIC,
        serverId: requestOverrides?.server,
        profileId: requestOverrides?.profile,
        metadataProfileId: requestOverrides?.metadataProfile,
        rootFolder: requestOverrides?.folder,
        userId: requestOverrides?.user?.id,
        tags: requestOverrides?.tags,
      });

      if (alsoApproveRequest) {
        await axios.post(`/api/v1/request/${editRequest?.id}/approve`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {intl.formatMessage(
            alsoApproveRequest
              ? messages.requestApproved
              : messages.requestEdited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );

      onComplete?.(MediaStatus.PENDING);
    } catch {
      addToast(intl.formatMessage(messages.editerror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingrequest)}
        subTitle={data ? `${data.artist.name} - ${data.title}` : undefined}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating || serviceUnavailable}
        okText={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? intl.formatMessage(messages.approve)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? intl.formatMessage(messages.edit)
              : intl.formatMessage(messages.cancel)
        }
        okButtonType={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? 'success'
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? 'primary'
              : 'danger'
        }
        onSecondary={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? () => cancelRequest()
            : undefined
        }
        secondaryDisabled={isUpdating}
        secondaryText={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? intl.formatMessage(messages.cancel)
            : undefined
        }
        secondaryButtonType="danger"
        cancelText={intl.formatMessage(messages.close)}
        cancelButtonType="danger"
        backdrop={data?.artistBackdrop ?? data?.artistThumb ?? data?.posterPath}
        backdropFull
        alignTop
        actionButtonSize="standard"
        dialogClass="refreshed-card-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-5xl"
      >
        {serviceUnavailable && (
          <div className="mb-4">
            <Alert
              title={intl.formatMessage(messages.noLidarrServer)}
              type="warning"
            />
          </div>
        )}
        <div className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
          {isOwner
            ? intl.formatMessage(messages.pendingapproval)
            : intl.formatMessage(messages.requestfrom, {
                username: editRequest.requestedBy.displayName,
              })}
        </div>
        {(hasPermission(Permission.REQUEST_ADVANCED) ||
          hasPermission(Permission.MANAGE_REQUESTS)) && (
          <AdvancedRequester
            type="music"
            is4k={false}
            requestUser={editRequest.requestedBy}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              metadataProfile: editRequest.metadataProfileId,
              profile: editRequest.profileId,
              server: editRequest.serverId,
              tags: editRequest.tags,
            }}
            onChange={(overrides) => setRequestOverrides(overrides)}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      hideActions
      alignTop
      okDisabled={
        isUpdating ||
        selectedDestinationCovered ||
        quota?.music?.restricted ||
        serviceUnavailable
      }
      title={intl.formatMessage(messages.requestmusic)}
      okText={requestButtonLabel}
      okButtonType="primary"
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {serviceUnavailable && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.noLidarrServer)}
            type="warning"
          />
        </div>
      )}
      {(quota?.music?.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="music"
          quota={quota?.music}
          userOverride={
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
        />
      )}
      <RequestMediaCard
        artwork={data?.artistBackdrop ?? data?.artistThumb ?? data?.posterPath}
        artworkType="music"
      >
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type="music"
              src={data?.posterPath || '/images/seerr_poster_not_found.png'}
              alt=""
              fill
              sizes="(min-width: 640px) 80px, 64px"
              className="object-cover"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <h3 className="-mt-0.5 truncate text-lg leading-5 font-semibold text-white">
              {data?.title}
              {releaseYear ? ` (${releaseYear})` : ''}
            </h3>

            <div className="card:grid-cols-3 mt-4 grid min-h-0 min-w-0 flex-1 grid-cols-1 items-stretch">
              <div className="card:col-span-2 card:pr-3 min-w-0">
                <dl className="card:grid-cols-[max-content_0.75rem_6rem_0.75rem_minmax(0,1fr)] card:gap-x-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4 text-gray-400">
                  <dt className="card:col-start-1 card:row-start-1 font-medium text-gray-100">
                    {intl.formatMessage(messages.mediaAndFormat)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-1 m-0 truncate">
                    Music · Album
                  </dd>
                  <dt className="card:col-start-1 card:row-start-2 font-medium text-gray-100">
                    {intl.formatMessage(messages.releaseDate)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-2 m-0 truncate">
                    {releaseDate}
                  </dd>
                  <dt className="card:col-start-1 card:row-start-3 font-medium text-gray-100">
                    {intl.formatMessage(messages.runtime)}:
                  </dt>
                  <dd className="card:col-start-3 card:row-start-3 m-0 truncate">
                    {runtimeMinutes > 0
                      ? `${intl.formatNumber(runtimeMinutes)} minutes`
                      : notAvailable}
                  </dd>

                  <div className="media-detail-column-divider card:col-span-1 card:col-start-5 card:row-span-3 card:row-start-1 col-span-2 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5">
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.artist)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {data?.artist.name || notAvailable}
                    </dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.albumType)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {data?.type || notAvailable}
                    </dd>
                    <dt className="font-medium text-gray-100">
                      {intl.formatMessage(messages.trackCount)}:
                    </dt>
                    <dd className="m-0 truncate">
                      {data?.tracks.length
                        ? intl.formatNumber(data.tracks.length)
                        : notAvailable}
                    </dd>
                  </div>

                  <dt className="card:col-start-1 card:row-start-4 mt-0.5 font-medium text-gray-100">
                    {intl.formatMessage(messages.genres)}:
                  </dt>
                  <dd className="card:col-span-3 card:col-start-3 card:row-start-4 m-0 mt-0.5 line-clamp-2 min-w-0 break-words">
                    {genres || notAvailable}
                  </dd>
                </dl>
              </div>

              <dl className="media-detail-column-divider grid h-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-3 gap-y-0.5 text-xs leading-4 text-gray-400">
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

        {data?.tracks.length ? <AlbumTrackList tracks={data.tracks} /> : null}

        {canUseAdvancedOptions && (
          <AdvancedRequester
            type="music"
            is4k={false}
            expanded={advancedOptionsOpen}
            panelOnly
            rootFolderTable
            requestedByPortal={requestedByPortal}
            onChange={(overrides) => setRequestOverrides(overrides)}
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
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
          <button
            type="button"
            onClick={onCancel}
            data-testid="modal-cancel-button"
            className="compact-control inline-flex items-center gap-1 rounded-md border border-red-600/80 bg-red-800/25 px-2 text-[11px] leading-none font-semibold text-red-200 transition hover:border-red-500 hover:text-white focus:ring-2 focus:ring-red-500 focus:outline-none"
          >
            <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {intl.formatMessage(globalMessages.cancel)}
          </button>
          <button
            type="button"
            onClick={() => void sendRequest()}
            data-testid="modal-ok-button"
            disabled={
              isUpdating ||
              selectedDestinationCovered ||
              quota?.music?.restricted ||
              serviceUnavailable
            }
            className="compact-control inline-flex items-center gap-1 rounded-md border border-emerald-600/80 bg-emerald-800/25 px-2 text-[11px] leading-none font-semibold text-emerald-200 transition hover:border-emerald-500 hover:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {requestButtonLabel}
          </button>
        </div>
      </RequestMediaCard>
    </Modal>
  );
};

export default MusicRequestModal;
