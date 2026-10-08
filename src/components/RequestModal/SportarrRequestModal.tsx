import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import RequestFooterStatus from '@app/components/RequestModal/RequestFooterStatus';
import RequestMediaCard from '@app/components/RequestModal/RequestMediaCard';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import { encodeApiPathSegment } from '@app/utils/apiPath';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { SportarrServiceOption } from '@server/interfaces/api/serviceInterfaces';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { hasAutoApprovePermission } from '@server/lib/permissions';
import type { SportarrDetails } from '@server/models/Sportarr';
import axios from 'axios';
import { useCallback, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Sportarr', {
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestError: 'Something went wrong while submitting the sports request.',
  backendRequestFailed:
    'The request was saved, but Sportarr could not add this league. Review the request for details and retry it.',
  pendingRequest: 'Pending sports request',
  cancelRequest: 'Cancel request',
  close: 'Close',
  pendingApproval: 'Your request is pending approval.',
  requestFrom: "{username}'s request is pending approval.",
  cancelSuccess: 'The request for {title} was canceled.',
  cancelError: 'Something went wrong while canceling this request.',
  status: 'Status',
  requested: 'Already requested',
  monitored: 'Already monitored in Sportarr',
  notRequestable: 'This league cannot be requested right now.',
  service: 'Sportarr service',
  defaultService: 'Default ({name})',
  noService: 'No Sportarr service is configured.',
  unmonitored:
    'This league already exists in Sportarr but is not monitored. Enable it in Sportarr before requesting it here.',
  quotaHint: 'TV seasons and sports leagues share your TV request quota.',
});

interface SportarrRequestModalProps {
  leagueId: string;
  leagueTitle?: string;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
  editRequest?: NonFunctionProperties<MediaRequest>;
  initialServerId?: number;
}

const SportarrRequestModal = ({
  leagueId,
  leagueTitle,
  onCancel,
  onComplete,
  onUpdating,
  editRequest,
  initialServerId,
}: SportarrRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(
    initialServerId
  );
  const canUseAdvancedOptions = hasPermission(
    [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );
  const detailUrl = `/api/v1/sportarr/${encodeApiPathSegment(leagueId)}${
    canUseAdvancedOptions && selectedServerId !== undefined
      ? `?serverId=${selectedServerId}`
      : ''
  }`;
  const { data, mutate: revalidateLeague } = useSWR<SportarrDetails>(detailUrl);
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const { data: services } = useSWR<SportarrServiceOption[]>(
    '/api/v1/service/sportarr'
  );
  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_SPORTS],
    { type: 'or' }
  );
  const fallbackService = services?.find((service) => service.isDefault);
  const selectedService = services?.find(
    (service) => service.id === selectedServerId
  );
  const serviceUnavailable = Boolean(services && services.length === 0);
  const alreadyRequested = data?.libraryState === 'requested';
  const alreadyMonitored = data?.libraryState === 'monitored';
  const hasAutoApprove = hasAutoApprovePermission(
    user?.permissions ?? 0,
    'sports'
  );

  const sendRequest = useCallback(async () => {
    if (!data?.requestable || !canRequest) return;
    setIsUpdating(true);
    onUpdating?.(true);
    try {
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: leagueId,
        mediaType: 'sports',
        ...(canUseAdvancedOptions && selectedServerId !== undefined
          ? { serverId: selectedServerId }
          : {}),
      });
      await Promise.all([
        mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0'),
        mutate('/api/v1/request/count'),
        revalidateLeague(),
      ]);
      if (response.data?.status === MediaRequestStatus.FAILED) {
        addToast(intl.formatMessage(messages.backendRequestFailed), {
          appearance: 'error',
          autoDismiss: true,
        });
        return;
      }
      onComplete?.(
        response.data?.status === MediaRequestStatus.APPROVED ||
          response.data?.status === MediaRequestStatus.COMPLETED
          ? MediaStatus.PROCESSING
          : MediaStatus.PENDING
      );
      addToast(
        <span>
          {intl.formatMessage(messages.requestSuccess, {
            title: data.title,
            strong: (text: React.ReactNode) => <strong>{text}</strong>,
          })}
        </span>,
        { appearance: 'success', autoDismiss: true }
      );
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
      onUpdating?.(false);
    }
  }, [
    addToast,
    canRequest,
    canUseAdvancedOptions,
    data,
    intl,
    leagueId,
    onComplete,
    onUpdating,
    revalidateLeague,
    selectedServerId,
  ]);

  const cancelRequest = async () => {
    if (!editRequest) return;
    setIsUpdating(true);
    onUpdating?.(true);
    try {
      const response = await axios.delete(`/api/v1/request/${editRequest.id}`);
      await Promise.all([
        mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0'),
        mutate('/api/v1/request/count'),
        revalidateLeague(),
      ]);
      if (response.status === 204) {
        onComplete?.(MediaStatus.UNKNOWN);
        addToast(
          intl.formatMessage(messages.cancelSuccess, {
            title: leagueTitle ?? leagueId,
          }),
          {
            appearance: 'success',
            autoDismiss: true,
          }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.cancelError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      onUpdating?.(false);
    }
  };

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;
    return (
      <Modal
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(messages.pendingRequest)}
        subTitle={data?.title ?? leagueTitle ?? leagueId}
        onOk={() => void cancelRequest()}
        okDisabled={isUpdating}
        okText={intl.formatMessage(messages.cancelRequest)}
        okButtonType="danger"
        cancelText={intl.formatMessage(messages.close)}
        cancelButtonType="default"
      >
        <div className="app-card-inset refreshed-inset-surface">
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
      loading={!data || !quota || !services}
      backgroundClickable
      onCancel={onCancel}
      hideActions
      alignTop
      title={intl.formatMessage(globalMessages.request)}
      dialogClass="app-card-main request-modal-site-surface"
    >
      {(quota?.tv?.limit ?? 0) > 0 && (
        <>
          <QuotaDisplay mediaType="tv" quota={quota?.tv} />
          <p className="description">
            {intl.formatMessage(messages.quotaHint)}
          </p>
        </>
      )}
      {serviceUnavailable && (
        <div className="app-filter-section-gap">
          <Alert
            title={intl.formatMessage(messages.noService)}
            type="warning"
          />
        </div>
      )}
      {data?.libraryState === 'unmonitored' && (
        <div className="app-filter-section-gap">
          <Alert
            title={intl.formatMessage(messages.unmonitored)}
            type="warning"
          />
        </div>
      )}
      <RequestMediaCard artwork={data?.posterPath} artworkType="tmdb">
        <div className="app-card-inset refreshed-inset-surface">
          <h2>{data?.title ?? leagueTitle ?? leagueId}</h2>
          {data?.overview && <p className="description">{data.overview}</p>}
          <dl className="card-table">
            {data?.sport && (
              <>
                <dt>Sport</dt>
                <dd>{data.sport}</dd>
              </>
            )}
            {data?.country && (
              <>
                <dt>Country</dt>
                <dd>{data.country}</dd>
              </>
            )}
            {data?.year && (
              <>
                <dt>Year</dt>
                <dd>{data.year}</dd>
              </>
            )}
            <dt>{intl.formatMessage(messages.status)}</dt>
            <dd>
              {alreadyMonitored
                ? intl.formatMessage(messages.monitored)
                : alreadyRequested
                  ? intl.formatMessage(messages.requested)
                  : intl.formatMessage(globalMessages.notrequested)}
            </dd>
            <dt>{intl.formatMessage(messages.service)}</dt>
            <dd>
              {selectedService?.name ??
                fallbackService?.name ??
                intl.formatMessage(messages.noService)}
              {(selectedService?.profileName ?? fallbackService?.profileName) &&
                ` · ${selectedService?.profileName ?? fallbackService?.profileName}`}
            </dd>
            <dt>{intl.formatMessage(globalMessages.approved)}</dt>
            <dd>
              <RequestFooterStatus
                available={alreadyMonitored}
                requested={alreadyRequested}
                hasAutoApprove={hasAutoApprove}
              />
            </dd>
          </dl>
          {canUseAdvancedOptions && (services?.length ?? 0) > 1 && (
            <label className="form-row">
              <span>{intl.formatMessage(messages.service)}</span>
              <select
                className="request-form-control compact-control"
                value={selectedServerId ?? ''}
                onChange={(event) =>
                  setSelectedServerId(
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value)
                  )
                }
              >
                <option value="">
                  {fallbackService
                    ? intl.formatMessage(messages.defaultService, {
                        name: fallbackService.name,
                      })
                    : intl.formatMessage(messages.noService)}
                </option>
                {services?.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="media-primary-action-row">
            <Button buttonType="default" onClick={onCancel}>
              {intl.formatMessage(globalMessages.cancel)}
            </Button>
            <Button
              buttonType="primary"
              disabled={
                isUpdating ||
                !data?.requestable ||
                !canRequest ||
                quota?.tv?.restricted ||
                serviceUnavailable
              }
              onClick={() => void sendRequest()}
            >
              <ArrowDownTrayIcon />
              <span>{intl.formatMessage(globalMessages.request)}</span>
            </Button>
          </div>
        </div>
      </RequestMediaCard>
    </Modal>
  );
};

export default SportarrRequestModal;
