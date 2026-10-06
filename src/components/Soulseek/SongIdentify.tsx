import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useRouter } from 'next/router';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface SongIdView {
  id: string;
  status: string;
  summary?: string;
  stage?: string;
  percentComplete?: number;
  queuePosition?: number;
  albums: {
    releaseId: string;
    releaseGroupId?: string;
    title: string;
    artist: string;
    isExact: boolean;
  }[];
  tracks: {
    recordingId: string;
    title: string;
    artist: string;
    isExact: boolean;
  }[];
}

const messages = defineMessages('components.Soulseek.SongIdentify', {
  title: 'Identify a Song',
  description:
    'Paste a link to a clip or video, or describe the song. SongID looks for the matching recording and album so you can request it.',
  notConfigured:
    'Song identification is not set up. An administrator can connect slskdN in Settings → Services.',
  source: 'Link or Description',
  identify: 'Identify',
  identifying: 'Identifying…',
  queued: 'Waiting in queue (position {position})',
  progress: '{stage} · {percent}%',
  albums: 'Albums',
  tracks: 'Tracks',
  exact: 'Exact Match',
  openAlbum: 'Open Album',
  requestTrack: 'Request Track',
  requested: 'Track requested from Soulseek.',
  noMatches: 'No matching recordings were found.',
  failed: 'Song identification failed.',
  requestFailed: 'The track could not be requested.',
});

const FINISHED = new Set(['completed', 'failed', 'cancelled']);

const SongIdentify = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { data: status } = useSWR<{ configured: boolean; canRequest: boolean }>(
    '/api/v1/soulseek/status'
  );
  const [source, setSource] = useState('');
  const [runId, setRunId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const { data: run, error } = useSWR<SongIdView>(
    runId ? `/api/v1/soulseek/songid/${encodeURIComponent(runId)}` : null,
    {
      refreshInterval: (latest) =>
        latest && FINISHED.has(latest.status) ? 0 : 3_000,
    }
  );

  useEffect(() => {
    if (error) setRunId(undefined);
  }, [error]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    try {
      const response = await axios.post<SongIdView>('/api/v1/soulseek/songid', {
        source: source.trim(),
      });
      setRequested(new Set());
      setRunId(response.data.id);
    } catch (failure) {
      addToast(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.message === 'string'
          ? failure.response.data.message
          : intl.formatMessage(messages.failed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setStarting(false);
    }
  };

  const requestTrack = async (track: SongIdView['tracks'][number]) => {
    try {
      await axios.post('/api/v1/soulseek/track-requests', {
        tracks: [
          {
            artist: track.artist,
            title: track.title,
            recordingMbid: track.recordingId,
            source: 'songid',
          },
        ],
      });
      setRequested((current) => new Set(current).add(track.recordingId));
      addToast(intl.formatMessage(messages.requested), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (failure) {
      addToast(
        axios.isAxiosError(failure) &&
          typeof failure.response?.data?.message === 'string'
          ? failure.response.data.message
          : intl.formatMessage(messages.requestFailed),
        { appearance: 'error', autoDismiss: true }
      );
    }
  };

  const running = !!runId && (!run || !FINISHED.has(run.status));

  return (
    <div className="page-layout">
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="page-title-row">
        <h1 className="page-title">{intl.formatMessage(messages.title)}</h1>
        {running && (
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
          <section className="app-card-main card-layout">
            <p className="card-body-text">
              {intl.formatMessage(messages.description)}
            </p>
            <form onSubmit={(event) => void start(event)}>
              <div className="form-row">
                <label htmlFor="songid-source">
                  {intl.formatMessage(messages.source)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <input
                      id="songid-source"
                      type="text"
                      maxLength={2048}
                      value={source}
                      disabled={starting || running}
                      onChange={(event) => setSource(event.currentTarget.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="app-action-row">
                <Button
                  type="submit"
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={
                    !source.trim() || starting || running || !status?.canRequest
                  }
                >
                  {intl.formatMessage(
                    starting || running
                      ? messages.identifying
                      : messages.identify
                  )}
                </Button>
              </div>
            </form>
            {running && run && (
              <p className="card-body-text" role="status">
                {run.queuePosition
                  ? intl.formatMessage(messages.queued, {
                      position: run.queuePosition,
                    })
                  : intl.formatMessage(messages.progress, {
                      stage: run.stage ?? run.status,
                      percent: Math.round(run.percentComplete ?? 0),
                    })}
              </p>
            )}
          </section>
          {run && FINISHED.has(run.status) && (
            <>
              {run.status !== 'completed' && (
                <section className="app-card-main card-layout">
                  <p className="card-body-text">
                    {run.summary ?? intl.formatMessage(messages.failed)}
                  </p>
                </section>
              )}
              {run.status === 'completed' &&
                run.albums.length === 0 &&
                run.tracks.length === 0 && (
                  <section className="app-card-main card-layout">
                    <p className="card-body-text">
                      {intl.formatMessage(messages.noMatches)}
                    </p>
                  </section>
                )}
              {run.albums.length > 0 && (
                <>
                  <h2 className="page-heading">
                    {intl.formatMessage(messages.albums)}
                  </h2>
                  <ul className="card-list" data-list-layout="stacked">
                    {run.albums.map((album) => (
                      <li key={album.releaseId}>
                        <article className="app-card-sub card-layout">
                          <div className="page-title-row">
                            <h3 className="card-title">{album.title}</h3>
                            {album.isExact && (
                              <Badge badgeType="success">
                                {intl.formatMessage(messages.exact)}
                              </Badge>
                            )}
                          </div>
                          <p className="card-subheading">{album.artist}</p>
                          {album.releaseGroupId && (
                            <div className="app-action-row">
                              <Button
                                buttonType="primary"
                                buttonSize="sm"
                                onClick={() =>
                                  void router.push(
                                    `/music/${album.releaseGroupId}`
                                  )
                                }
                              >
                                {intl.formatMessage(messages.openAlbum)}
                              </Button>
                            </div>
                          )}
                        </article>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {run.tracks.length > 0 && (
                <>
                  <h2 className="page-heading">
                    {intl.formatMessage(messages.tracks)}
                  </h2>
                  <ul className="card-list" data-list-layout="stacked">
                    {run.tracks.map((track) => (
                      <li key={track.recordingId || track.title}>
                        <article className="app-card-sub card-layout">
                          <div className="page-title-row">
                            <h3 className="card-title">{track.title}</h3>
                            {track.isExact && (
                              <Badge badgeType="success">
                                {intl.formatMessage(messages.exact)}
                              </Badge>
                            )}
                          </div>
                          <p className="card-subheading">{track.artist}</p>
                          <div className="app-action-row">
                            <Button
                              buttonType="default"
                              buttonSize="sm"
                              disabled={
                                !status?.canRequest ||
                                requested.has(track.recordingId)
                              }
                              onClick={() => void requestTrack(track)}
                            >
                              {intl.formatMessage(messages.requestTrack)}
                            </Button>
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default SongIdentify;
