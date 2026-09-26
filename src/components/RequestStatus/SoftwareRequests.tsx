import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestStatus.SoftwareRequests', {
  title: 'Software requests',
  requestedBy: 'Requested by {user}',
  pending: 'Pending approval',
  approved: 'Approved',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Verifying import',
  available: 'Available',
  failed: 'Failed',
  declined: 'Declined',
  retro: 'Retro',
  modern: 'Modern',
  game: 'PC game',
  operatingSystem: 'Operating system: {value}',
  architecture: 'Architecture: {value}',
  submitted: 'Requested {date}',
  approve: 'Approve',
  decline: 'Decline',
  retry: 'Retry',
  manageError: 'This software request could not be updated.',
  downloadCopy: 'Download copy',
  downloadCopies: 'Download copies',
  downloadNamed: 'Download {name}',
  retryCheckRequired:
    'ROMarrNG cannot tell whether the previous download started. Check the download client’s queue and history. Continue only if no matching download exists.',
  retryAfterCheck: 'I checked; confirm retry',
  cancelRetry: 'Cancel',
  loadError: 'Software request status could not be loaded.',
  noRequests: 'No software requests yet.',
});

type SoftwareStatus =
  | 'pending'
  | 'approved'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'declined';

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
  variant?: { operatingSystem: string; architecture: string } | null;
  createdAt: string;
}

interface SoftwareRequestResult {
  request: SoftwareRequestRow;
  status: SoftwareStatus;
  message: string | null;
  assets: { id: string; name: string; size: number; url: string }[];
}

interface SoftwareRequestsResponse {
  results: SoftwareRequestResult[];
}

const DownloadCopies = ({
  requestId,
  assets,
}: {
  requestId: number;
  assets: SoftwareRequestResult['assets'];
}) => {
  const intl = useIntl();
  if (assets.length === 0) return null;
  const endpoint = (id: string) =>
    `/api/v1/request/software/status/${requestId}/downloads/${encodeURIComponent(id)}`;
  const buttonClassName =
    'compact-control inline-flex items-center gap-1 rounded-md border border-indigo-500/80 bg-indigo-800/25 px-2 text-[11px] leading-none font-semibold whitespace-nowrap text-indigo-200 transition hover:border-indigo-400 hover:bg-indigo-800/45 hover:text-white focus:ring-2 focus:ring-indigo-400 focus:outline-none';
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
        <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopy)}
      </a>
    );
  }
  return (
    <details className="group relative">
      <summary className={`${buttonClassName} list-none`}>
        <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {intl.formatMessage(messages.downloadCopies)}
        <ChevronDownIcon
          className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <ol className="absolute right-0 z-30 mt-1 max-h-64 max-w-[min(24rem,80vw)] min-w-64 overflow-y-auto rounded-lg border border-gray-600 bg-gray-900 p-1 shadow-xl">
        {assets.map((asset) => (
          <li key={asset.id}>
            <a
              href={endpoint(asset.id)}
              download
              className="block truncate rounded-md px-3 py-2 text-xs text-gray-100 hover:bg-gray-700 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
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
  requestedById,
  softwareRequestId,
}: {
  enabled: boolean;
  requestedById?: number;
  softwareRequestId?: number;
}) => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const canRequest = hasPermission(Permission.REQUEST);
  const endpoint = useMemo(() => {
    if (!enabled) return null;
    const params = new URLSearchParams({ take: '20', skip: '0' });
    if (requestedById !== undefined)
      params.set('requestedBy', String(requestedById));
    if (softwareRequestId !== undefined) {
      params.set('requestId', String(softwareRequestId));
    }
    return `/api/v1/request/software/status?${params.toString()}`;
  }, [enabled, requestedById, softwareRequestId]);
  const { data, error, mutate } = useSWR<SoftwareRequestsResponse>(endpoint, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [retryConfirmationId, setRetryConfirmationId] = useState<number | null>(
    null
  );

  const mutateRequest = async (
    requestId: number,
    action: 'approve' | 'decline' | 'retry',
    confirmNoExistingDownload = false
  ) => {
    setWorkingId(requestId);
    try {
      await axios.post(
        `/api/v1/request/software/status/${requestId}/${action}`,
        action === 'retry' ? { confirmNoExistingDownload } : undefined
      );
      setRetryConfirmationId(null);
      await mutate();
    } catch (actionError) {
      const errorData =
        axios.isAxiosError(actionError) &&
        actionError.response?.data &&
        typeof actionError.response.data === 'object'
          ? (actionError.response.data as { confirmationRequired?: unknown })
          : undefined;
      if (
        action === 'retry' &&
        !confirmNoExistingDownload &&
        errorData?.confirmationRequired === 'confirmNoExistingDownload'
      ) {
        setRetryConfirmationId(requestId);
        return;
      }
      addToast(intl.formatMessage(messages.manageError), {
        appearance: 'error',
      });
    } finally {
      setWorkingId(null);
    }
  };

  if (!enabled) return null;
  if (!data && !error) return <LoadingSpinner />;
  if (error) {
    return (
      <p className="text-sm text-gray-400">
        {intl.formatMessage(messages.loadError)}
      </p>
    );
  }
  if (!data?.results.length) return null;

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

  const canRetryRequest = (request: SoftwareRequestRow) =>
    canManage || (canRequest && request.requestedBy?.id === user?.id);

  return (
    <section
      className="mb-6 space-y-3"
      aria-label={intl.formatMessage(messages.title)}
    >
      <h2 className="text-lg font-semibold text-gray-100">
        {intl.formatMessage(messages.title)}
      </h2>
      <div className="space-y-3">
        {data.results.map(({ request, status, message, assets }) => (
          <article
            key={request.id}
            className="refreshed-card-surface rounded-xl border border-gray-700 p-3 sm:p-4"
          >
            <div className="flex gap-3">
              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md bg-gray-900 sm:h-24 sm:w-16">
                <CachedImage
                  type="tmdb"
                  src={request.coverUrl || '/images/seerr_poster_not_found.png'}
                  alt=""
                  className="object-cover"
                  fill
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gray-600 bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-200">
                        {groupLabel(request.category)}
                      </span>
                      <span className="text-xs font-medium text-indigo-200">
                        {statusLabel(status)}
                      </span>
                    </div>
                    <h3 className="mt-1 truncate text-sm font-semibold text-white sm:text-base">
                      {request.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                      {request.platform?.name && (
                        <span>{request.platform.name}</span>
                      )}
                      {request.variant && (
                        <>
                          <span>
                            {intl.formatMessage(messages.operatingSystem, {
                              value: request.variant.operatingSystem,
                            })}
                          </span>
                          <span>
                            {intl.formatMessage(messages.architecture, {
                              value: request.variant.architecture,
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
                      <p className="mt-2 text-xs text-amber-200">{message}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
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
                    {status === 'available' && (
                      <DownloadCopies requestId={request.id} assets={assets} />
                    )}
                  </div>
                </div>
                {retryConfirmationId === request.id && (
                  <div
                    className="mt-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3"
                    role="alert"
                  >
                    <p className="text-xs text-amber-100">
                      {intl.formatMessage(messages.retryCheckRequired)}
                    </p>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        buttonType="default"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() => setRetryConfirmationId(null)}
                      >
                        {intl.formatMessage(messages.cancelRetry)}
                      </Button>
                      <Button
                        buttonType="warning"
                        buttonSize="sm"
                        disabled={workingId === request.id}
                        onClick={() => mutateRequest(request.id, 'retry', true)}
                      >
                        {intl.formatMessage(messages.retryAfterCheck)}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default SoftwareRequests;
