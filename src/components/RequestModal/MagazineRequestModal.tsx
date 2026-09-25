import Alert from '@app/components/Common/Alert';
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
import type { MagazineServiceOption } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission, hasAutoApprovePermission } from '@server/lib/permissions';
import type { MagazineDetails } from '@server/models/Magazine';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Magazine', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestMagazine: 'Request Magazine',
  pendingRequest: 'Pending Magazine Request',
  cancelRequest: 'Cancel Request',
  close: 'Close',
  pendingApproval: 'Your request is pending approval.',
  requestFrom: "{username}'s request is pending approval.",
  requestError: 'Something went wrong while submitting the request.',
  backendRequestFailed:
    'The request was submitted, but LazyLibrarian rejected it while processing.',
  editError: 'Something went wrong while canceling the request.',
  latestIssue: 'Latest issue',
  status: 'Status',
  requested: 'Requested',
  readyToRequest: 'Ready to Request',
  approval: 'Approval',
  notAvailable: 'Not Available',
  service: 'Service',
  defaultService: 'Default ({name})',
  noMagazineServer:
    'No LazyLibrarian service is configured. Magazine requests are unavailable.',
});

interface MagazineRequestModalProps {
  magazineTitle: string;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  editRequest?: NonFunctionProperties<MediaRequest>;
  initialServerId?: number;
}

const MagazineRequestModal = ({
  magazineTitle,
  onCancel,
  onComplete,
  onUpdating,
  editRequest,
  initialServerId,
}: MagazineRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(
    initialServerId
  );
  const { data } = useSWR<MagazineDetails>(
    `/api/v1/magazine/${encodeApiPathSegment(magazineTitle)}`
  );
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const { data: magazineServices } = useSWR<MagazineServiceOption[]>(
    '/api/v1/service/magazine'
  );
  useEffect(() => onUpdating?.(isUpdating), [isUpdating, onUpdating]);

  const isAvailable =
    data?.mediaInfo?.status === MediaStatus.AVAILABLE ||
    data?.mediaInfo?.status === MediaStatus.PARTIALLY_AVAILABLE;
  const isProcessing = data?.mediaInfo?.status === MediaStatus.PROCESSING;
  const isRequested =
    isProcessing ||
    Boolean(
      data?.mediaInfo?.requests?.some(
        (request) =>
          request.status === MediaRequestStatus.PENDING ||
          request.status === MediaRequestStatus.APPROVED
      )
    );
  const requestCovered = isAvailable || isRequested;
  const serviceUnavailable =
    !!magazineServices && magazineServices.length === 0;
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const selectedService = magazineServices?.find(
    (service) => service.id === selectedServerId
  );
  const fallbackService = magazineServices?.find(
    (service) => service.isDefault
  );
  const hasAutoApprove = hasAutoApprovePermission(
    user?.permissions ?? 0,
    'magazine'
  );

  const sendRequest = useCallback(async () => {
    if (requestCovered) return;
    setIsUpdating(true);
    try {
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: magazineTitle,
        mediaType: 'magazine',
        ...(selectedServerId !== undefined
          ? { serverId: selectedServerId }
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
              title: magazineTitle,
              strong: (text: React.ReactNode) => <strong>{text}</strong>,
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
        typeof responseMessage === 'string' && responseMessage
          ? responseMessage
          : intl.formatMessage(messages.requestError),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setIsUpdating(false);
    }
  }, [
    addToast,
    intl,
    magazineTitle,
    onComplete,
    requestCovered,
    selectedServerId,
  ]);

  const cancelRequest = async () => {
    if (!editRequest) return;
    setIsUpdating(true);
    try {
      const response = await axios.delete(`/api/v1/request/${editRequest.id}`);
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');
      if (response.status === 204) {
        onComplete?.(MediaStatus.UNKNOWN);
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: magazineTitle,
              strong: (text: React.ReactNode) => <strong>{text}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.editError), {
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
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingRequest)}
        subTitle={magazineTitle}
        onOk={() => void cancelRequest()}
        okDisabled={isUpdating}
        okText={intl.formatMessage(messages.cancelRequest)}
        okButtonType="danger"
        cancelText={intl.formatMessage(messages.close)}
        cancelButtonType="default"
      >
        <div className="refreshed-inset-surface rounded-lg border border-gray-700 p-3">
          {isOwner
            ? intl.formatMessage(messages.pendingApproval)
            : intl.formatMessage(messages.requestFrom, {
                username: editRequest.requestedBy.displayName,
              })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      loading={!quota}
      backgroundClickable
      onCancel={onCancel}
      hideActions
      alignTop
      title={intl.formatMessage(messages.requestMagazine)}
      dialogClass="request-modal-site-surface sm:max-w-5xl"
    >
      {(quota?.magazine?.limit ?? 0) > 0 && (
        <QuotaDisplay mediaType="magazine" quota={quota?.magazine} />
      )}
      {serviceUnavailable && (
        <div className="mb-3">
          <Alert
            title={intl.formatMessage(messages.noMagazineServer)}
            type="warning"
          />
        </div>
      )}
      <RequestMediaCard artworkType="book">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-lg leading-5 font-semibold text-white">
            {data?.title ?? magazineTitle}
          </h3>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-gray-400">
            <dt className="font-medium text-gray-100">
              {intl.formatMessage(messages.latestIssue)}:
            </dt>
            <dd className="m-0 truncate">
              {data?.latestIssue ?? intl.formatMessage(messages.notAvailable)}
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
              {selectedService?.name ??
                fallbackService?.name ??
                intl.formatMessage(messages.notAvailable)}
            </dd>
            <dt className="font-medium text-gray-100">
              {intl.formatMessage(messages.approval)}:
            </dt>
            <dd className="m-0">
              <RequestFooterStatus
                available={isAvailable}
                requested={isRequested}
                hasAutoApprove={hasAutoApprove}
              />
            </dd>
          </dl>
          <div className="flex flex-wrap justify-end gap-2">
            {canUseAdvancedOptions &&
              magazineServices &&
              magazineServices.length > 1 && (
                <select
                  className="request-form-control compact-control mr-auto rounded-md border px-2 text-[11px] font-medium"
                  value={selectedServerId ?? ''}
                  onChange={(event) =>
                    setSelectedServerId(
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value)
                    )
                  }
                  aria-label={intl.formatMessage(messages.service)}
                >
                  <option value="">
                    {fallbackService
                      ? intl.formatMessage(messages.defaultService, {
                          name: fallbackService.name,
                        })
                      : intl.formatMessage(messages.notAvailable)}
                  </option>
                  {magazineServices.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              )}
            <button
              type="button"
              onClick={onCancel}
              className="compact-control"
            >
              <XMarkIcon className="mr-1 inline h-3.5 w-3.5" />
              {intl.formatMessage(globalMessages.cancel)}
            </button>
            <button
              type="button"
              onClick={() => void sendRequest()}
              disabled={
                isUpdating ||
                requestCovered ||
                quota?.magazine?.restricted ||
                serviceUnavailable
              }
              className="compact-control inline-flex items-center gap-1 disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              {intl.formatMessage(globalMessages.request)}
            </button>
          </div>
        </div>
      </RequestMediaCard>
    </Modal>
  );
};

export default MagazineRequestModal;
