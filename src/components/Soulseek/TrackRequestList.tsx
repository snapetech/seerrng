import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type TrackStatus =
  'pending' | 'searching' | 'completed' | 'failed' | 'declined' | 'cancelled';

interface TrackRequestView {
  id: number;
  status: TrackStatus;
  artist: string;
  title: string;
  source: string;
  searchCount: number;
  lastMatchCount: number;
  lastError?: string;
  createdAt: string;
  requestedBy?: { id: number; displayName: string };
}

const messages = defineMessages('components.Soulseek.TrackRequestList', {
  title: 'Track Requests',
  notConfigured:
    'Soulseek track requests are not set up. An administrator can connect slskdN in Settings → Services.',
  empty: 'No Track Requests Yet',
  emptyHelp:
    'Import a playlist from Requests, or identify a song, to request tracks that have no album match.',
  identify: 'Identify a Song',
  loadError: 'Track requests could not be loaded.',
  retry: 'Retry',
  mine: 'My Requests',
  everyone: 'All Requests',
  activeOnly: 'Active Only',
  showAll: 'Show All',
  artist: 'Artist',
  searches: 'Searches',
  matches: 'Last Matches',
  requestedBy: 'Requested By',
  approve: 'Approve',
  decline: 'Decline',
  cancel: 'Cancel Request',
  working: 'Working…',
  actionFailed: 'The request could not be updated.',
  statusPending: 'Pending Approval',
  statusSearching: 'Searching',
  statusCompleted: 'Downloaded',
  statusFailed: 'Failed',
  statusDeclined: 'Declined',
  statusCancelled: 'Cancelled',
});

const statusMessage: Record<TrackStatus, keyof typeof messages> = {
  pending: 'statusPending',
  searching: 'statusSearching',
  completed: 'statusCompleted',
  failed: 'statusFailed',
  declined: 'statusDeclined',
  cancelled: 'statusCancelled',
};

const statusBadge: Record<
  TrackStatus,
  'default' | 'primary' | 'success' | 'warning' | 'danger'
> = {
  pending: 'warning',
  searching: 'primary',
  completed: 'success',
  failed: 'danger',
  declined: 'danger',
  cancelled: 'default',
};

const ACTIVE: TrackStatus[] = ['pending', 'searching'];

const TrackRequestList = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const { data: status } = useSWR<{ configured: boolean }>(
    '/api/v1/soulseek/status'
  );
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const canViewAll = hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const [scopeAll, setScopeAll] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [busyId, setBusyId] = useState<number>();

  const key = status?.configured
    ? `/api/v1/soulseek/track-requests?scope=${scopeAll ? 'all' : 'mine'}&filter=${
        activeOnly ? 'active' : 'all'
      }&take=100`
    : null;
  const { data, error, mutate, isValidating } = useSWR<{
    results: TrackRequestView[];
  }>(key, { refreshInterval: 60_000 });

  const act = async (
    request: TrackRequestView,
    action: 'approve' | 'decline' | 'cancel'
  ) => {
    setBusyId(request.id);
    try {
      if (action === 'cancel') {
        await axios.delete(`/api/v1/soulseek/track-requests/${request.id}`);
      } else {
        await axios.post(
          `/api/v1/soulseek/track-requests/${request.id}/${action}`
        );
      }
      await mutate();
    } catch (failure) {
      addToast(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.message === 'string'
          ? failure.response.data.message
          : intl.formatMessage(messages.actionFailed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const renderRequest = (request: TrackRequestView) => {
    const isOwner = request.requestedBy?.id === user?.id;
    const active = ACTIVE.includes(request.status);
    return (
      <li key={request.id}>
        <article className="app-card-sub card-layout">
          <div className="page-title-row">
            <h2 className="card-title">{request.title}</h2>
            <Badge badgeType={statusBadge[request.status]}>
              {intl.formatMessage(messages[statusMessage[request.status]])}
            </Badge>
          </div>
          <dl className="card-table">
            <dt>{intl.formatMessage(messages.artist)}</dt>
            <dd>{request.artist}</dd>
            {request.status === 'searching' && (
              <>
                <dt>{intl.formatMessage(messages.searches)}</dt>
                <dd>{request.searchCount}</dd>
                <dt>{intl.formatMessage(messages.matches)}</dt>
                <dd>{request.lastMatchCount}</dd>
              </>
            )}
            {scopeAll && request.requestedBy && (
              <>
                <dt>{intl.formatMessage(messages.requestedBy)}</dt>
                <dd>{request.requestedBy.displayName}</dd>
              </>
            )}
          </dl>
          {request.lastError && (
            <p className="card-body-text">{request.lastError}</p>
          )}
          {active && (canManage || isOwner) && (
            <div className="app-action-row">
              {canManage && request.status === 'pending' && (
                <>
                  <Button
                    buttonType="success"
                    buttonSize="sm"
                    disabled={busyId === request.id}
                    onClick={() => void act(request, 'approve')}
                  >
                    {intl.formatMessage(messages.approve)}
                  </Button>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    disabled={busyId === request.id}
                    onClick={() => void act(request, 'decline')}
                  >
                    {intl.formatMessage(messages.decline)}
                  </Button>
                </>
              )}
              {(request.status !== 'pending' || isOwner) && (
                <Button
                  buttonType="danger"
                  buttonSize="sm"
                  disabled={busyId === request.id}
                  onClick={() => void act(request, 'cancel')}
                >
                  {intl.formatMessage(
                    busyId === request.id ? messages.working : messages.cancel
                  )}
                </Button>
              )}
            </div>
          )}
        </article>
      </li>
    );
  };

  const results = data?.results ?? [];

  return (
    <div className="page-layout">
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="page-title-row">
        <h1 className="page-title">{intl.formatMessage(messages.title)}</h1>
        {isValidating && data && (
          <span className="page-status">
            <LoadingSpinner />
          </span>
        )}
      </div>
      {status && !status.configured ? (
        <section className="app-card-main card-layout">
          <p className="card-body-text">
            {intl.formatMessage(messages.notConfigured)}
          </p>
        </section>
      ) : (
        <>
          <div className="app-action-row">
            {canViewAll && (
              <Button
                buttonType="default"
                buttonSize="sm"
                onClick={() => setScopeAll((value) => !value)}
              >
                {intl.formatMessage(
                  scopeAll ? messages.mine : messages.everyone
                )}
              </Button>
            )}
            <Button
              buttonType="default"
              buttonSize="sm"
              onClick={() => setActiveOnly((value) => !value)}
            >
              {intl.formatMessage(
                activeOnly ? messages.showAll : messages.activeOnly
              )}
            </Button>
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() => void router.push('/identify')}
            >
              {intl.formatMessage(messages.identify)}
            </Button>
          </div>
          {error && !data ? (
            <section className="app-card-main card-layout">
              <h2 className="card-title">
                {intl.formatMessage(messages.loadError)}
              </h2>
              <div className="app-action-row">
                <Button
                  buttonType="default"
                  buttonSize="sm"
                  onClick={() => void mutate()}
                >
                  {intl.formatMessage(messages.retry)}
                </Button>
              </div>
            </section>
          ) : !data ? (
            <LoadingSpinner />
          ) : results.length === 0 ? (
            <section className="app-card-main card-layout">
              <h2 className="page-heading">
                {intl.formatMessage(messages.empty)}
              </h2>
              <p className="card-body-text">
                {intl.formatMessage(messages.emptyHelp)}
              </p>
            </section>
          ) : (
            <ul className="card-list" data-list-layout="stacked">
              {results.map(renderRequest)}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default TrackRequestList;
