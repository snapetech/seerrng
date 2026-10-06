import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PaginationFooter from '@app/components/Common/PaginationFooter';
import {
  RequestActionButton,
  RequestActionConfirmation,
} from '@app/components/Requests/destructiveActions';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import type {
  PcArchitecture,
  PcOperatingSystem,
} from '@server/api/software/types';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestStatus.SoftwareRequests', {
  datVerified: 'DAT Verified',
  datPartlyVerified: '{verified} of {total} DAT Verified',
  title: 'Software Requests',
  requestedBy: 'Requested by {user}',
  pending: 'Pending Approval',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Verifying Import',
  available: 'Available',
  failed: 'Failed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  retro: 'Retro',
  modern: 'Modern',
  game: 'PC Game',
  operatingSystem: 'Operating System: {value}',
  architecture: 'Architecture: {value}',
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  x64: 'x64',
  arm64: 'ARM64',
  x86: 'x86',
  universal: 'Universal',
  submitted: 'Requested {date}',
  approve: 'Approve',
  decline: 'Decline',
  withdraw: 'Withdraw',
  cancel: 'Cancel',
  retry: 'Retry',
  manageError: 'This software request could not be updated.',
  downloadCopy: 'Download copy',
  downloadCopies: 'Download copies',
  downloadAllCopies: 'Download all files',
  downloadNamed: 'Download {name}',
  retryCheckRequired:
    'The provider cannot confirm whether the previous download started. Check the download client’s queue and history. Continue only if no matching download exists.',
  confirmAfterCheck: 'I checked; continue',
  cancelRetry: 'Cancel',
  clearCancelled: 'Clear cancelled request',
  clearCancelledTitle: 'Clear This Cancelled Request?',
  clearCancelledDescription:
    'This removes the cancelled request and its saved status history from Seerr. It does not delete installed software.',
  clearSuccess: 'Cancelled request cleared.',
  clearFailed: 'Unable to clear this cancelled request.',
  loadError: 'Software request status could not be loaded.',
  noRequests: 'No software requests yet.',
  quotaExceeded: 'Your software request limit has been reached.',
  history: 'History',
  historyLoading: 'Loading status history…',
  historyError: 'Status history could not be loaded.',
  noHistory: 'No saved status updates are available.',
});

type SoftwareStatus =
  | 'pending'
  | 'approved'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'declined'
  | 'cancelled';

interface SoftwareRequestRow {
  id: number;
  requestedBy?: { id: number; displayName: string; avatar: string } | null;
  category: 'retro' | 'modern' | 'game';
  provider: 'romarr' | 'questarr';
  status: SoftwareStatus;
  title: string;
  coverUrl?: string | null;
  platform?: {
    slug: string;
    name: string | null;
    catalogId: number | null;
  } | null;
  actions?: {
    retry: boolean;
    cancel: boolean;
    cancelReason?: string;
  } | null;
  variant?: {
    operatingSystem: PcOperatingSystem;
    architecture: PcArchitecture;
  } | null;
  createdAt: string;
}

interface SoftwareRequestResult {
  request: SoftwareRequestRow;
  status: SoftwareStatus;
  message: string | null;
  assets: {
    id: string;
    name: string;
    size: number;
    url: string;
    datVerified?: boolean;
  }[];
  bundle?: { name: string; url: string } | null;
}

interface SoftwareRequestsResponse {
  results: SoftwareRequestResult[];
  pageInfo: { page: number; pages: number; pageSize: number; results: number };
}

interface SoftwareRequestHistoryResponse {
  history: {
    id: number;
    status: SoftwareStatus;
    message?: string | null;
    percent?: number | null;
    createdAt: string;
  }[];
}

/**
 * ROMarrNG DAT verification for delivered files. Shown only when ROMarrNG
 * reported a verdict for at least one file.
 */
const DatVerificationBadge = ({
  assets,
}: {
  assets: SoftwareRequestResult['assets'];
}) => {
  const intl = useIntl();
  const reported = assets.filter(
    (asset) => typeof asset.datVerified === 'boolean'
  );
  if (reported.length === 0) return null;
  const verified = reported.filter((asset) => asset.datVerified).length;
  if (verified === assets.length) {
    return (
      <Badge badgeType="success">
        {intl.formatMessage(messages.datVerified)}
      </Badge>
    );
  }
  return (
    <Badge badgeType="warning">
      {intl.formatMessage(messages.datPartlyVerified, {
        verified,
        total: assets.length,
      })}
    </Badge>
  );
};

const DownloadCopies = ({
  requestId,
  assets,
  bundle,
}: {
  requestId: number;
  assets: SoftwareRequestResult['assets'];
  bundle?: SoftwareRequestResult['bundle'];
}) => {
  const intl = useIntl();
  if (assets.length === 0) return null;
  const endpoint = (id: string) =>
    `/api/v1/request/software/status/${requestId}/downloads/${encodeURIComponent(id)}`;
  const buttonClassName = 'app-button app-button-primary button-sm';
  if (assets.length === 1) {
    const asset = assets[0];
    return (
      <a
        href={endpoint(asset.id)}
        download
        className={buttonClassName}
        aria-label={intl.formatMessage(messages.downloadNamed, {
          name: asset.name,
        })}
        title={asset.name}
      >
        <ArrowDownTrayIcon className="app-action-icon" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopy)}
      </a>
    );
  }
  return (
    <details>
      <summary className={buttonClassName}>
        <ArrowDownTrayIcon className="app-action-icon" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopies)}
        <ChevronDownIcon
          className="app-disclosure-chevron"
          aria-hidden="true"
        />
      </summary>
      <ol className="app-dropdown-menu app-download-menu">
        {bundle && (
          <li>
            <a
              href={bundle.url}
              download
              className="app-dropdown-item app-download-item"
              aria-label={`${intl.formatMessage(messages.downloadAllCopies)}: ${bundle.name}`}
            >
              {intl.formatMessage(messages.downloadAllCopies)} ({bundle.name})
            </a>
          </li>
        )}
        {assets.map((asset) => (
          <li key={asset.id}>
            <a
              href={endpoint(asset.id)}
              download
              className="app-dropdown-item app-download-item"
              title={asset.name}
              aria-label={intl.formatMessage(messages.downloadNamed, {
                name: asset.name,
              })}
            >
              {asset.name}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
};

const SoftwareRequests = ({
  enabled,
  filter,
  category,
  requestedById,
  softwareRequestId,
}: {
  enabled: boolean;
  filter: string;
  category?: SoftwareRequestRow['category'];
  requestedById?: number;
  softwareRequestId?: number;
}) => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const canRequest = hasPermission(Permission.REQUEST);
  const [page, setPage] = useState(1);
  const endpoint = useMemo(() => {
    if (!enabled) return null;
    const params = new URLSearchParams({
      take: '20',
      skip: String((page - 1) * 20),
    });
    if (filter !== 'all') params.set('filter', filter);
    if (category !== undefined) params.set('category', category);
    if (requestedById !== undefined)
      params.set('requestedBy', String(requestedById));
    if (softwareRequestId !== undefined) {
      params.set('requestId', String(softwareRequestId));
    }
    return `/api/v1/request/software/status?${params.toString()}`;
  }, [category, enabled, filter, page, requestedById, softwareRequestId]);
  const { data, error, mutate } = useSWR<SoftwareRequestsResponse>(endpoint, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: false,
  });
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [historyRequestId, setHistoryRequestId] = useState<number | null>(null);
  const [handoffConfirmation, setHandoffConfirmation] = useState<{
    requestId: number;
    action: 'retry' | 'cancel';
  } | null>(null);
  const [clearSelection, setClearSelection] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<number | null>(null);
  const historyEndpoint = historyRequestId
    ? `/api/v1/request/software/status/${historyRequestId}`
    : null;
  const { data: historyData, error: historyError } =
    useSWR<SoftwareRequestHistoryResponse>(historyEndpoint);

  useEffect(() => {
    setPage(1);
    setHistoryRequestId(null);
  }, [category, enabled, filter, requestedById, softwareRequestId]);

  useEffect(() => {
    if (data && data.pageInfo.pages > 0 && page > data.pageInfo.pages) {
      setPage(data.pageInfo.pages);
    }
  }, [data, page]);

  const mutateRequest = async (
    requestId: number,
    action: 'approve' | 'decline' | 'retry' | 'withdraw' | 'cancel',
    confirmNoExistingDownload = false
  ) => {
    setWorkingId(requestId);
    try {
      await axios.post(
        `/api/v1/request/software/status/${requestId}/${action}`,
        ['retry', 'cancel'].includes(action)
          ? { confirmNoExistingDownload }
          : undefined
      );
      setHandoffConfirmation(null);
      await mutate();
    } catch (actionError) {
      const errorData =
        axios.isAxiosError(actionError) &&
        actionError.response?.data &&
        typeof actionError.response.data === 'object'
          ? (actionError.response.data as {
              confirmationRequired?: unknown;
              error?: unknown;
            })
          : undefined;
      if (
        (action === 'retry' || action === 'cancel') &&
        !confirmNoExistingDownload &&
        errorData?.confirmationRequired === 'confirmNoExistingDownload'
      ) {
        setHandoffConfirmation({ requestId, action });
        return;
      }
      const fallbackMessage =
        axios.isAxiosError(actionError) &&
        actionError.response?.data?.error === 'SOFTWARE_QUOTA_EXCEEDED'
          ? messages.quotaExceeded
          : messages.manageError;
      const serverMessage =
        typeof errorData?.error === 'string' && errorData.error.length <= 300
          ? errorData.error
          : undefined;
      addToast(serverMessage ?? intl.formatMessage(fallbackMessage), {
        appearance: 'error',
      });
    } finally {
      setWorkingId(null);
    }
  };

  const clearCancelledRequest = async () => {
    if (clearSelection === null) return;
    const requestId = clearSelection;
    setClearingId(requestId);
    try {
      await axios.delete(`/api/v1/request/software/status/${requestId}`);
      setClearSelection(null);
      setHistoryRequestId((current) =>
        current === requestId ? null : current
      );
      addToast(intl.formatMessage(messages.clearSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.clearFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    } finally {
      setClearingId(null);
    }
    await mutate().catch(() => undefined);
  };

  if (
    !enabled ||
    filter === 'incomplete' ||
    filter === 'unavailable' ||
    filter === 'library'
  ) {
    return null;
  }
  if (!data && !error) return <LoadingSpinner />;
  if (error) {
    if (category === undefined) {
      return (
        <p className="app-inline-error">
          {intl.formatMessage(messages.loadError)}
        </p>
      );
    }
    return (
      <section
        className="app-compact-request-section"
        aria-label={intl.formatMessage(messages.title)}
      >
        <h2 className="app-section-heading">
          {intl.formatMessage(messages.title)}
        </h2>
        <p className="app-inline-error">
          {intl.formatMessage(messages.loadError)}
        </p>
      </section>
    );
  }
  if (!data?.results.length) {
    if (category === undefined) return null;
    return (
      <section
        className="app-compact-request-section"
        aria-label={intl.formatMessage(messages.title)}
      >
        <h2 className="app-section-heading">
          {intl.formatMessage(messages.title)}
        </h2>
        <div className="app-card-main refreshed-card-surface app-empty-state">
          {intl.formatMessage(messages.noRequests)}
        </div>
      </section>
    );
  }

  const statusLabel = (status: SoftwareStatus) =>
    intl.formatMessage(messages[status]);
  const groupLabel = (category: SoftwareRequestRow['category']) =>
    intl.formatMessage(
      category === 'game'
        ? messages.game
        : category === 'modern'
          ? messages.modern
          : messages.retro
    );

  const operatingSystemLabel = (value: PcOperatingSystem) =>
    intl.formatMessage(
      value === 'windows'
        ? messages.windows
        : value === 'macos'
          ? messages.macos
          : messages.linux
    );

  const architectureLabel = (value: PcArchitecture) =>
    intl.formatMessage(
      value === 'arm64'
        ? messages.arm64
        : value === 'x86'
          ? messages.x86
          : value === 'universal'
            ? messages.universal
            : messages.x64
    );

  const canManageRequest = (request: SoftwareRequestRow) =>
    canManage || (canRequest && request.requestedBy?.id === user?.id);
  const canRetryRequest = (request: SoftwareRequestRow) =>
    request.status === 'failed' &&
    (request.actions?.retry ?? true) &&
    canManageRequest(request);
  const canCancelRequest = (request: SoftwareRequestRow) =>
    ['approved', 'searching', 'downloading', 'importing', 'failed'].includes(
      request.status
    ) &&
    (request.actions?.cancel ?? true) &&
    canManageRequest(request);

  return (
    <section
      className="app-compact-request-section"
      aria-label={intl.formatMessage(messages.title)}
    >
      {clearSelection !== null && (
        <RequestActionConfirmation
          action="delete"
          heading={intl.formatMessage(messages.clearCancelledTitle)}
          explanation={intl.formatMessage(messages.clearCancelledDescription)}
          confirmLabel={intl.formatMessage(messages.clearCancelled)}
          busy={clearingId === clearSelection}
          onConfirm={() => void clearCancelledRequest()}
          onCancel={() => setClearSelection(null)}
        />
      )}
      <h2 className="app-section-heading">
        {intl.formatMessage(messages.title)}
      </h2>
      <div className="app-compact-request-list">
        {data.results.map(({ request, status, message, assets, bundle }) => (
          <article
            key={request.id}
            className="refreshed-card-surface app-compact-request-card"
          >
            <div className="app-compact-request-summary">
              <div className="app-compact-request-poster">
                <CachedImage
                  type="tmdb"
                  src={request.coverUrl || '/images/seerr_poster_not_found.png'}
                  alt=""
                  className="media-detail-artwork-image"
                  fill
                />
              </div>
              <div>
                <div className="app-compact-request-header">
                  <div>
                    <div className="app-compact-request-badges">
                      <span className="app-compact-request-category">
                        {groupLabel(request.category)}
                      </span>
                      <span className="app-compact-request-status">
                        {statusLabel(status)}
                      </span>
                    </div>
                    <h3 className="app-compact-request-title">
                      {request.title}
                    </h3>
                    <div className="refreshed-detail-text-muted app-compact-request-meta">
                      {request.platform?.name && (
                        <span>{request.platform.name}</span>
                      )}
                      {request.variant && (
                        <>
                          <span>
                            {intl.formatMessage(messages.operatingSystem, {
                              value: operatingSystemLabel(
                                request.variant.operatingSystem
                              ),
                            })}
                          </span>
                          <span>
                            {intl.formatMessage(messages.architecture, {
                              value: architectureLabel(
                                request.variant.architecture
                              ),
                            })}
                          </span>
                        </>
                      )}
                      {canManage && request.requestedBy && (
                        <span>
                          {intl.formatMessage(messages.requestedBy, {
                            user: request.requestedBy.displayName,
                          })}
                        </span>
                      )}
                      <span>
                        {intl.formatMessage(messages.submitted, {
                          date: intl.formatDate(request.createdAt, {
                            dateStyle: 'medium',
                          }),
                        })}
                      </span>
                    </div>
                    {message && status === 'failed' && (
                      <p className="app-compact-request-warning">{message}</p>
                    )}
                    {request.actions?.cancel === false &&
                      request.actions.cancelReason && (
                        <p className="app-compact-request-note">
                          {request.actions.cancelReason}
                        </p>
                      )}
                  </div>
                  <div className="app-action-row">
                    {canManage && status === 'pending' && (
                      <>
                        <Button
                          buttonType="success"
                          buttonSize="sm"
                          disabled={workingId === request.id}
                          onClick={() => mutateRequest(request.id, 'approve')}
                        >
                          {intl.formatMessage(messages.approve)}
                        </Button>
                        <Button
                          buttonType="default"
                          buttonSize="sm"
                          disabled={workingId === request.id}
                          onClick={() => mutateRequest(request.id, 'decline')}
                        >
                          {intl.formatMessage(messages.decline)}
                        </Button>
                      </>
                    )}
                    {canRequest &&
                      status === 'pending' &&
                      request.requestedBy?.id === user?.id && (
                        <Button
                          buttonType="default"
                          buttonSize="sm"
                          disabled={workingId === request.id}
                          onClick={() => mutateRequest(request.id, 'withdraw')}
                        >
                          {intl.formatMessage(messages.withdraw)}
                        </Button>
                      )}
                    {canCancelRequest(request) && (
                      <Button
                        buttonType="default"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() => mutateRequest(request.id, 'cancel')}
                      >
                        {intl.formatMessage(messages.cancel)}
                      </Button>
                    )}
                    {status === 'failed' && canRetryRequest(request) && (
                      <Button
                        buttonType="default"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() =>
                          mutateRequest(request.id, 'retry', false)
                        }
                      >
                        {intl.formatMessage(messages.retry)}
                      </Button>
                    )}
                    {status === 'cancelled' && canManageRequest(request) && (
                      <RequestActionButton
                        action="delete"
                        label={intl.formatMessage(messages.clearCancelled)}
                        tooltip={intl.formatMessage(messages.clearCancelled)}
                        busy={clearingId === request.id}
                        disabled={workingId === request.id}
                        onClick={() => setClearSelection(request.id)}
                      />
                    )}
                    {status === 'available' && (
                      <DatVerificationBadge assets={assets} />
                    )}
                    {status === 'available' && (
                      <DownloadCopies
                        requestId={request.id}
                        assets={assets}
                        bundle={bundle}
                      />
                    )}
                  </div>
                </div>
                {handoffConfirmation?.requestId === request.id && (
                  <div
                    className="app-page-alert app-page-alert-warning app-compact-request-confirmation"
                    role="alert"
                  >
                    <p className="app-compact-request-confirmation-copy">
                      {intl.formatMessage(messages.retryCheckRequired)}
                    </p>
                    <div className="app-action-row app-compact-request-confirmation-actions">
                      <Button
                        buttonType="default"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() => setHandoffConfirmation(null)}
                      >
                        {intl.formatMessage(messages.cancelRetry)}
                      </Button>
                      <Button
                        buttonType="warning"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() =>
                          mutateRequest(
                            request.id,
                            handoffConfirmation.action,
                            true
                          )
                        }
                      >
                        {intl.formatMessage(messages.confirmAfterCheck)}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="app-compact-request-history-trigger">
                  <Button
                    type="button"
                    buttonType="manage"
                    buttonSize="sm"
                    aria-expanded={historyRequestId === request.id}
                    aria-label={intl.formatMessage(messages.history)}
                    onClick={() =>
                      setHistoryRequestId((current) =>
                        current === request.id ? null : request.id
                      )
                    }
                  >
                    <ClockIcon className="app-action-icon" aria-hidden="true" />
                    {intl.formatMessage(messages.history)}
                    <ChevronDownIcon
                      className="app-disclosure-chevron"
                      aria-hidden="true"
                    />
                  </Button>
                </div>
                {historyRequestId === request.id && (
                  <div className="refreshed-inset-surface app-compact-request-history">
                    {historyError ? (
                      <p className="app-compact-request-history-error">
                        {intl.formatMessage(messages.historyError)}
                      </p>
                    ) : !historyData ? (
                      <p className="refreshed-detail-text-muted app-compact-request-history-copy">
                        {intl.formatMessage(messages.historyLoading)}
                      </p>
                    ) : historyData.history.length === 0 ? (
                      <p className="refreshed-detail-text-muted app-compact-request-history-copy">
                        {intl.formatMessage(messages.noHistory)}
                      </p>
                    ) : (
                      <ol className="app-compact-request-history-list">
                        {historyData.history.map((event) => (
                          <li
                            key={event.id}
                            className="app-compact-request-history-row"
                          >
                            <span className="refreshed-detail-text app-compact-request-history-status">
                              {statusLabel(event.status)}
                              {event.percent !== null &&
                                event.percent !== undefined &&
                                ` · ${Math.round(event.percent)}%`}
                            </span>
                            <time
                              className="refreshed-detail-text-muted"
                              dateTime={event.createdAt}
                            >
                              {intl.formatDate(event.createdAt, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </time>
                            {event.message && (
                              <p className="refreshed-detail-text-muted app-compact-request-history-message">
                                {event.message}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {data.pageInfo.pages > 1 && (
        <PaginationFooter
          defaultPageSize={20}
          page={page}
          pageSize={20}
          totalPages={data.pageInfo.pages}
          onPageChange={setPage}
          onPageSizeChange={() => undefined}
          pageSizeOptions={[20]}
        />
      )}
    </section>
  );
};

export default SoftwareRequests;
