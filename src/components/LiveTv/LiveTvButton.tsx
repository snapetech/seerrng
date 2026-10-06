import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import Tooltip from '@app/components/Common/Tooltip';
import {
  liveTvAiringsKey,
  useLiveTvStatus,
  type LiveTvAiring,
  type RecordingRequestView,
} from '@app/hooks/useLiveTv';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { TvIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.LiveTv.LiveTvButton', {
  onLiveTv: 'On Live TV',
  onLiveTvTooltip: 'Airing soon on Live TV — watch or record it',
  airingsTitle: 'On Live TV',
  channel: 'Channel',
  airs: 'Airs',
  episode: 'Episode',
  episodeValue: 'Season {season} Episode {episode}',
  record: 'Record',
  recording: 'Requesting…',
  recordSeries: 'Record Every Airing',
  recordSeriesDescription:
    'Records this title whenever it airs while the request is active.',
  viewRecordings: 'View My Recordings',
  close: 'Close',
  requested: 'Recording requested. It will be scheduled after approval.',
  scheduled: 'Recording scheduled.',
  requestFailed: 'The recording could not be requested.',
  cannotRequest: 'You do not have permission to request recordings.',
});

interface LiveTvButtonProps {
  /** Catalog title plus alternates such as the original title. */
  titles: string[];
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

const LiveTvButton = ({ titles, mediaType, tmdbId }: LiveTvButtonProps) => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { data: status } = useLiveTvStatus();
  const { data } = useSWR<{ airings: LiveTvAiring[] }>(
    status?.configured ? liveTvAiringsKey(titles) : null,
    { revalidateOnFocus: false }
  );
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();

  const airings = data?.airings ?? [];
  if (!status?.configured || airings.length === 0) {
    return null;
  }

  const formatRange = (airing: LiveTvAiring) =>
    `${intl.formatDate(airing.start, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })} – ${intl.formatTime(airing.stop, {
      hour: 'numeric',
      minute: '2-digit',
    })}`;

  const request = async (
    key: string,
    body: Record<string, string | number | undefined>
  ) => {
    setBusyKey(key);
    try {
      const response = await axios.post<RecordingRequestView>(
        '/api/v1/live-tv/recordings',
        { ...body, mediaType, tmdbId }
      );
      addToast(
        intl.formatMessage(
          response.data.status === 'pending'
            ? messages.requested
            : messages.scheduled
        ),
        { appearance: 'success', autoDismiss: true }
      );
    } catch (error) {
      const message =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : intl.formatMessage(messages.requestFailed);
      addToast(message, { appearance: 'error', autoDismiss: true });
    } finally {
      setBusyKey(undefined);
    }
  };

  const canRequest = status.canRequest;

  return (
    <>
      <Tooltip content={intl.formatMessage(messages.onLiveTvTooltip)}>
        <Button
          buttonType="default"
          buttonSize="sm"
          onClick={() => setOpen(true)}
        >
          <TvIcon />
          <span>{intl.formatMessage(messages.onLiveTv)}</span>
        </Button>
      </Tooltip>
      {open && (
        <Modal
          title={intl.formatMessage(messages.airingsTitle)}
          subTitle={titles[0]}
          onCancel={() => setOpen(false)}
          cancelText={intl.formatMessage(messages.close)}
          onSecondary={() => void router.push('/recordings')}
          secondaryText={intl.formatMessage(messages.viewRecordings)}
          secondaryButtonType="default"
        >
          {mediaType === 'tv' && (
            <section className="app-card-sub card-layout">
              <p className="card-body-text">
                {intl.formatMessage(messages.recordSeriesDescription)}
              </p>
              <div className="app-action-row">
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={!canRequest || !!busyKey}
                  onClick={() =>
                    void request('series', {
                      kind: 'series',
                      title: airings[0].title,
                    })
                  }
                >
                  {intl.formatMessage(
                    busyKey === 'series'
                      ? messages.recording
                      : messages.recordSeries
                  )}
                </Button>
              </div>
            </section>
          )}
          <ul className="card-list">
            {airings.map((airing) => {
              const key = `${airing.channel}|${airing.start}`;
              return (
                <li key={key}>
                  <article className="app-card-sub card-layout">
                    <h3 className="card-title">
                      {airing.subTitle ?? airing.title}
                    </h3>
                    <dl className="card-table">
                      <dt>{intl.formatMessage(messages.channel)}</dt>
                      <dd>
                        {airing.channelName === airing.channel
                          ? airing.channel
                          : `${airing.channelName} (${airing.channel})`}
                      </dd>
                      <dt>{intl.formatMessage(messages.airs)}</dt>
                      <dd>{formatRange(airing)}</dd>
                      {airing.season !== undefined &&
                        airing.episode !== undefined && (
                          <>
                            <dt>{intl.formatMessage(messages.episode)}</dt>
                            <dd>
                              {intl.formatMessage(messages.episodeValue, {
                                season: airing.season,
                                episode: airing.episode,
                              })}
                            </dd>
                          </>
                        )}
                    </dl>
                    <div className="app-action-row">
                      <Tooltip
                        content={
                          canRequest
                            ? undefined
                            : intl.formatMessage(messages.cannotRequest)
                        }
                      >
                        <Button
                          buttonType="primary"
                          buttonSize="sm"
                          disabled={!canRequest || !!busyKey}
                          onClick={() =>
                            void request(key, {
                              kind: 'airing',
                              title: airing.title,
                              channel: airing.channel,
                              start: airing.start,
                            })
                          }
                        >
                          {intl.formatMessage(
                            busyKey === key
                              ? messages.recording
                              : messages.record
                          )}
                        </Button>
                      </Tooltip>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </>
  );
};

export default LiveTvButton;
