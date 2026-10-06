import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import type {
  RecordingRequestView,
  RecordingStatus,
} from '@app/hooks/useLiveTv';
import { useLiveTvStatus } from '@app/hooks/useLiveTv';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.LiveTv.RecordingList', {
  title: 'Recordings',
  notConfigured:
    'Live TV recording is not set up. An administrator can connect IPTV Tunerr in Settings → Services.',
  empty: 'No Recordings Yet',
  emptyHelp:
    'Open a movie or series that is airing on Live TV and select On Live TV to request a recording.',
  loadError: 'Recordings could not be loaded.',
  retry: 'Retry',
  mine: 'My Recordings',
  everyone: 'All Recordings',
  activeOnly: 'Active Only',
  showAll: 'Show All',
  oneAiring: 'One Airing',
  series: 'Every Airing',
  channel: 'Channel',
  anyChannel: 'Any channel',
  airs: 'Airs',
  recorded: 'Recorded',
  requestedBy: 'Requested By',
  approve: 'Approve',
  decline: 'Decline',
  cancel: 'Cancel Recording',
  working: 'Working…',
  actionFailed: 'The recording could not be updated.',
  statusPending: 'Pending Approval',
  statusScheduled: 'Scheduled',
  statusRecording: 'Recording',
  statusCompleted: 'Recorded',
  statusFailed: 'Failed',
  statusDeclined: 'Declined',
  statusCancelled: 'Cancelled',
});

const statusMessage: Record<RecordingStatus, keyof typeof messages> = {
  pending: 'statusPending',
  scheduled: 'statusScheduled',
  recording: 'statusRecording',
  completed: 'statusCompleted',
  failed: 'statusFailed',
  declined: 'statusDeclined',
  cancelled: 'statusCancelled',
};

const statusBadge: Record<
  RecordingStatus,
  'default' | 'primary' | 'success' | 'warning' | 'danger'
> = {
  pending: 'warning',
  scheduled: 'primary',
  recording: 'success',
  completed: 'success',
  failed: 'danger',
  declined: 'danger',
  cancelled: 'default',
};

const ACTIVE: RecordingStatus[] = ['pending', 'scheduled', 'recording'];

const RecordingList = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const { data: status } = useLiveTvStatus();
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const canViewAll = hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const [scopeAll, setScopeAll] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [busyId, setBusyId] = useState<number>();

  const key = status?.configured
    ? `/api/v1/live-tv/recordings?scope=${scopeAll ? 'all' : 'mine'}&filter=${
        activeOnly ? 'active' : 'all'
      }&take=100`
    : null;
  const { data, error, mutate, isValidating } = useSWR<{
    results: RecordingRequestView[];
  }>(key, { refreshInterval: 30_000 });

  const act = async (
    recording: RecordingRequestView,
    action: 'approve' | 'decline' | 'cancel'
  ) => {
    setBusyId(recording.id);
    try {
      if (action === 'cancel') {
        await axios.delete(`/api/v1/live-tv/recordings/${recording.id}`);
      } else {
        await axios.post(
          `/api/v1/live-tv/recordings/${recording.id}/${action}`
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

  const formatAiring = (recording: RecordingRequestView) =>
    recording.startsAt
      ? intl.formatDate(recording.startsAt, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : intl.formatMessage(messages.series);

  const renderRecording = (recording: RecordingRequestView) => {
    const isOwner = recording.requestedBy?.id === user?.id;
    const active = ACTIVE.includes(recording.status);
    return (
      <li key={recording.id}>
        <article className="app-card-sub card-layout">
          <div className="page-title-row">
            <h2 className="card-title">{recording.title}</h2>
            <Badge badgeType={statusBadge[recording.status]}>
              {intl.formatMessage(messages[statusMessage[recording.status]])}
            </Badge>
          </div>
          {recording.subTitle && (
            <p className="card-subheading">{recording.subTitle}</p>
          )}
          <dl className="card-table">
            <dt>
              {intl.formatMessage(
                recording.kind === 'airing' ? messages.airs : messages.series
              )}
            </dt>
            <dd>
              {recording.kind === 'airing'
                ? formatAiring(recording)
                : intl.formatMessage(messages.series)}
            </dd>
            <dt>{intl.formatMessage(messages.channel)}</dt>
            <dd>
              {recording.channelName ??
                recording.channel ??
                intl.formatMessage(messages.anyChannel)}
            </dd>
            {recording.kind === 'series' && (
              <>
                <dt>{intl.formatMessage(messages.recorded)}</dt>
                <dd>{recording.completedCount}</dd>
              </>
            )}
            {scopeAll && recording.requestedBy && (
              <>
                <dt>{intl.formatMessage(messages.requestedBy)}</dt>
                <dd>{recording.requestedBy.displayName}</dd>
              </>
            )}
          </dl>
          {recording.lastError && (
            <p className="card-body-text">{recording.lastError}</p>
          )}
          {active && (canManage || isOwner) && (
            <div className="app-action-row">
              {canManage && recording.status === 'pending' && (
                <>
                  <Button
                    buttonType="success"
                    buttonSize="sm"
                    disabled={busyId === recording.id}
                    onClick={() => void act(recording, 'approve')}
                  >
                    {intl.formatMessage(messages.approve)}
                  </Button>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    disabled={busyId === recording.id}
                    onClick={() => void act(recording, 'decline')}
                  >
                    {intl.formatMessage(messages.decline)}
                  </Button>
                </>
              )}
              {recording.status !== 'pending' || isOwner ? (
                <Button
                  buttonType="danger"
                  buttonSize="sm"
                  disabled={busyId === recording.id}
                  onClick={() => void act(recording, 'cancel')}
                >
                  {intl.formatMessage(
                    busyId === recording.id ? messages.working : messages.cancel
                  )}
                </Button>
              ) : null}
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
              {results.map(renderRecording)}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default RecordingList;
