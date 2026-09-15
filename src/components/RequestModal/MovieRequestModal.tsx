import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
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
import { sortCrewPriority } from '@app/utils/creditHelpers';
import defineMessages from '@app/utils/defineMessages';
import { getTmdbPosterImageUrl } from '@app/utils/imageCache';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { MovieDetails } from '@server/models/Movie';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestmovietitle: 'Request Movie',
  requestmovie4ktitle: 'Request Movie in 4K',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Movie Request',
  pending4krequest: 'Pending 4K Movie Request',
  requestfrom: "{username}'s request is pending approval.",
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
  mediaAndFormat: 'Media & Format',
  releaseDate: 'Release Date',
  runtime: 'Runtime',
  genres: 'Genres',
  studio: 'Studio',
  status: 'Status',
  service: 'Service',
  approval: 'Approval',
  requested: 'Requested',
  readyToRequest: 'Ready to Request',
  notAvailable: 'Not available',
  advancedOptions: 'Advanced Options',
});

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus, is4k?: boolean) => void;
  onUpdating?: (isUpdating: boolean) => void;
  allow4kServerSelection?: boolean;
}

const MovieRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  onUpdating,
  editRequest,
  is4k = false,
  allow4kServerSelection = false,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const { addToast } = useToasts();
  const { data, error } = useSWR<MovieDetails>(`/api/v1/movie/${tmdbId}`, {
    revalidateOnMount: true,
  });
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id ||
        hasPermission([Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS], {
          type: 'or',
        }))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );
  const { data: radarrServers } = useSWR<ServiceCommonServer[]>(
    '/api/v1/service/radarr',
    {
      refreshInterval: 0,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    }
  );
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(true);
  const [requestedByPortal, setRequestedByPortal] =
    useState<HTMLDivElement | null>(null);
  const effectiveIs4k = requestOverrides?.is4k ?? is4k;
  const selectedService = radarrServers?.find(
    (server) => server.id === requestOverrides?.server
  );
  const fallbackService = radarrServers?.find(
    (server) => server.isDefault && server.is4k === effectiveIs4k
  );
  const selectedDestination = createRequestDestination(
    'radarr',
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
          'movie',
          effectiveIs4k
        ),
      }
    );
  const selectedDestinationCovered =
    selectedDestinationAvailable ||
    (selectedDestinationRequested && !selectedDestinationPromotable);

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  const sendRequest = useCallback(async () => {
    if (selectedDestinationCovered) {
      return;
    }

    setIsUpdating(true);

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          rootFolder: requestOverrides.folder,
          userId: requestOverrides.user?.id,
          tags: requestOverrides.tags,
        };
      }
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id,
        mediaType: 'movie',
        is4k: effectiveIs4k,
        ignoreQuota: requestOverrides?.ignoreQuota,
        ...overrideParams,
      });
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

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
      const errorMessage =
        typeof responseMessage === 'string' && responseMessage.length > 0
          ? responseMessage
          : intl.formatMessage(messages.requesterror);

      addToast(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [
    requestOverrides,
    data?.id,
    data?.title,
    effectiveIs4k,
    selectedDestinationCovered,
    onComplete,
    addToast,
    intl,
  ]);

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        if (onComplete) {
          onComplete(MediaStatus.UNKNOWN, is4k);
        }
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
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: 'movie',
        serverId: requestOverrides?.server,
        profileId: requestOverrides?.profile,
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
              : messages.requestedited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );

      if (onComplete) {
        onComplete(MediaStatus.PENDING, is4k);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
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
        title={intl.formatMessage(
          is4k ? messages.pending4krequest : messages.pendingrequest
        )}
        subTitle={data?.title}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating}
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
        cancelText={intl.formatMessage(globalMessages.close)}
        cancelButtonType="danger"
        backdrop={
          data?.backdropPath
            ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
            : undefined
        }
        backdropFull
        alignTop
        actionButtonSize="standard"
        dialogClass="refreshed-card-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-5xl"
      >
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
            type="movie"
            is4k={is4k}
            requestUser={editRequest.requestedBy}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              profile: editRequest.profileId,
              server: editRequest.serverId,
              tags: editRequest.tags,
            }}
            onChange={(overrides) => {
              setRequestOverrides(overrides);
            }}
          />
        )}
      </Modal>
    );
  }

  const hasAutoApprove = hasAutoApprovePermission(
    requestOverrides?.user?.permissions ?? user?.permissions ?? 0,
    'movie',
    effectiveIs4k
  );
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
  const featuredCrew = sortCrewPriority(data?.credits?.crew ?? []).slice(0, 2);
  const studio = data?.productionCompanies?.[0]?.name ?? notAvailable;
  const requestButtonLabel = isUpdating
    ? intl.formatMessage(globalMessages.requesting)
    : intl.formatMessage(
        effectiveIs4k ? globalMessages.request4k : globalMessages.request
      );

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
        (quota?.movie.restricted && !requestOverrides?.ignoreQuota)
      }
      title={intl.formatMessage(
        effectiveIs4k
          ? messages.requestmovie4ktitle
          : messages.requestmovietitle
      )}
      okText={requestButtonLabel}
      okButtonType={'primary'}
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {(quota?.movie.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="movie"
          quota={quota?.movie}
          userOverride={
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
        />
      )}
      <RequestMediaCard
        artwork={
          data?.backdropPath
            ? `https://image.tmdb.org/t/p/original${data.backdropPath}`
            : getTmdbPosterImageUrl(data?.posterPath, 'original')
        }
        artworkType="tmdb"
      >
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
                    Movie · {effectiveIs4k ? '4K' : 'HD'}
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
                    {data?.runtime
                      ? `${intl.formatNumber(data.runtime)} minutes`
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
                      {intl.formatMessage(messages.studio)}:
                    </dt>
                    <dd className="m-0 truncate">{studio}</dd>
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

        {canUseAdvancedOptions && (
          <AdvancedRequester
            type="movie"
            is4k={is4k}
            allow4kServerSelection={allow4kServerSelection}
            quota={quota}
            mediaTitle={data?.title}
            posterPath={data?.posterPath}
            expanded={advancedOptionsOpen}
            panelOnly
            rootFolderTable
            requestedByPortal={requestedByPortal}
            onChange={(overrides) => {
              setRequestOverrides(overrides);
            }}
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
              (quota?.movie.restricted && !requestOverrides?.ignoreQuota)
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

export default MovieRequestModal;
