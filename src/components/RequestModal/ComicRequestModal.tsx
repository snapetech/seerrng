import Alert from '@app/components/Common/Alert';
import CachedImage from '@app/components/Common/CachedImage';
import Modal from '@app/components/Common/Modal';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ComicServiceOption } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { ComicDetails } from '@server/models/Comic';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Comic', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestcomic: 'Request Comic',
  pendingrequest: 'Pending Comic Request',
  cancel: 'Cancel Request',
  close: 'Close',
  pendingapproval: 'Your request is pending approval.',
  requestfrom: "{username}'s request is pending approval.",
  requesterror: 'Something went wrong while submitting the request.',
  backendRequestFailed:
    'The request was submitted, but the comics service rejected it while processing.',
  editerror: 'Something went wrong while canceling the request.',
  noComicsServer:
    'No Mylar or Kapowarr service is configured. Comic requests are unavailable.',
  publisher: 'Publisher',
  issueCount: 'Issues',
  status: 'Status',
  service: 'Service',
  defaultService: 'Default ({name})',
  rootFolder: 'Kapowarr root folder',
  configuredRootFolder: 'Configured default ({path})',
  rootFolderLoading: 'Loading folders…',
  approval: 'Approval',
  requested: 'Requested',
  readyToRequest: 'Ready to Request',
  notAvailable: 'Not Available',
});

interface ComicRequestModalProps {
  comicId: string;
  initialServerId?: number;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  editRequest?: NonFunctionProperties<MediaRequest>;
}

interface KapowarrRootFoldersResponse {
  defaultRootFolder: string | null;
  rootFolders: { id: number; path: string }[];
}

const ComicRequestModal = ({
  comicId,
  initialServerId,
  onCancel,
  onComplete,
  onUpdating,
  editRequest,
}: ComicRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(
    initialServerId
  );
  const [selectedRootFolder, setSelectedRootFolder] = useState('');
  const { data, error } = useSWR<ComicDetails>(
    `/api/v1/comic/${encodeApiPathSegment(comicId)}`,
    { revalidateOnMount: true }
  );
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const { data: comicServices } = useSWR<ComicServiceOption[]>(
    '/api/v1/service/comic'
  );

  useEffect(() => {
    onUpdating?.(isUpdating);
  }, [isUpdating, onUpdating]);

  const isAvailable =
    data?.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data?.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const isRequested = !!data?.mediaInfo?.requests?.some(
    (request) =>
      request.status === MediaRequestStatus.PENDING ||
      request.status === MediaRequestStatus.APPROVED
  );
  const requestCovered = isAvailable || isRequested;
  const serviceUnavailable = !!comicServices && comicServices.length === 0;
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const selectedService = comicServices?.find(
    (service) => service.id === selectedServerId
  );
  const fallbackService = comicServices?.find((service) => service.isDefault);
  const requestService = selectedService ?? fallbackService;
  const rootFoldersEndpoint =
    canUseAdvancedOptions && requestService?.backendType === 'kapowarr'
      ? `/api/v1/service/comic/${requestService.id}/rootfolders`
      : null;
  const { data: kapowarrFolders } =
    useSWR<KapowarrRootFoldersResponse>(rootFoldersEndpoint);

  useEffect(() => {
    setSelectedRootFolder('');
  }, [selectedServerId]);

  const sendRequest = useCallback(async () => {
    if (requestCovered) {
      return;
    }

    setIsUpdating(true);

    try {
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: comicId,
        mediaType: 'comic',
        ...(selectedServerId !== undefined
          ? { serverId: selectedServerId }
          : {}),
        ...(selectedRootFolder && requestService?.backendType === 'kapowarr'
          ? { rootFolder: selectedRootFolder }
          : {}),
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
    comicId,
    data?.title,
    intl,
    onComplete,
    requestCovered,
    requestService?.backendType,
    selectedRootFolder,
    selectedServerId,
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

  const hasAutoApprove = hasAutoApprovePermission(
    user?.permissions ?? 0,
    'comic'
  );
  const notAvailable = intl.formatMessage(messages.notAvailable);
  const requestButtonLabel = isUpdating
    ? intl.formatMessage(globalMessages.requesting)
    : intl.formatMessage(globalMessages.request);

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingrequest)}
        subTitle={data?.title}
        onOk={() => cancelRequest()}
        okDisabled={isUpdating}
        okText={intl.formatMessage(messages.cancel)}
        okButtonType="danger"
        cancelText={intl.formatMessage(messages.close)}
        cancelButtonType="default"
        backdrop={data?.posterPath}
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
      okDisabled={isUpdating || requestCovered || quota?.comic?.restricted}
      title={intl.formatMessage(messages.requestcomic)}
      okText={requestButtonLabel}
      okButtonType="primary"
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {serviceUnavailable && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.noComicsServer)}
            type="warning"
          />
        </div>
      )}
      {(quota?.comic?.limit ?? 0) > 0 && (
        <QuotaDisplay mediaType="comic" quota={quota?.comic} />
      )}
      <RequestMediaCard artwork={data?.posterPath} artworkType="book">
        <div className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <div className="relative h-24 w-16 overflow-hidden rounded-lg ring-1 ring-gray-600 sm:h-[120px] sm:w-20">
            <CachedImage
              type="book"
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
              {data?.startYear ? ` (${data.startYear})` : ''}
            </h3>

            <dl className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs leading-4 text-gray-400">
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.publisher)}:
              </dt>
              <dd className="m-0 truncate">
                {data?.publisher || notAvailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.issueCount)}:
              </dt>
              <dd className="m-0 truncate">
                {data?.issueCount
                  ? intl.formatNumber(data.issueCount)
                  : notAvailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.status)}:
              </dt>
              <dd className="m-0 truncate">
                {intl.formatMessage(
                  isAvailable
                    ? globalMessages.available
                    : isRequested
                      ? messages.requested
                      : messages.readyToRequest
                )}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.service)}:
              </dt>
              <dd className="m-0 truncate">
                {selectedService?.name ?? fallbackService?.name ?? notAvailable}
              </dd>
              <dt className="font-medium text-gray-100">
                {intl.formatMessage(messages.approval)}:
              </dt>
              <dd className="m-0 min-w-0">
                <RequestFooterStatus
                  available={isAvailable}
                  requested={isRequested}
                  hasAutoApprove={hasAutoApprove}
                />
              </dd>
            </dl>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {canUseAdvancedOptions &&
            comicServices &&
            comicServices.length > 1 && (
              <select
                className="request-form-control compact-control mr-auto rounded-md border px-2 text-[11px] font-medium"
                value={selectedServerId ?? ''}
                onChange={(e) =>
                  setSelectedServerId(
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
              >
                <option value="">
                  {fallbackService
                    ? intl.formatMessage(messages.defaultService, {
                        name: fallbackService.name,
                      })
                    : notAvailable}
                </option>
                {comicServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            )}
          {canUseAdvancedOptions &&
            requestService?.backendType === 'kapowarr' && (
              <select
                className="request-form-control compact-control rounded-md border px-2 text-[11px] font-medium"
                value={selectedRootFolder}
                onChange={(event) => setSelectedRootFolder(event.target.value)}
                disabled={!kapowarrFolders}
                aria-label={intl.formatMessage(messages.rootFolder)}
              >
                {!kapowarrFolders ? (
                  <option value="">
                    {intl.formatMessage(messages.rootFolderLoading)}
                  </option>
                ) : (
                  <>
                    <option value="">
                      {intl.formatMessage(messages.configuredRootFolder, {
                        path: kapowarrFolders.defaultRootFolder || notAvailable,
                      })}
                    </option>
                    {kapowarrFolders.rootFolders
                      .filter(
                        (folder) =>
                          folder.path !== kapowarrFolders.defaultRootFolder
                      )
                      .map((folder) => (
                        <option key={folder.id} value={folder.path}>
                          {folder.path}
                        </option>
                      ))}
                  </>
                )}
              </select>
            )}
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
            disabled={isUpdating || requestCovered || quota?.comic?.restricted}
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

export default ComicRequestModal;
