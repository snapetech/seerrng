import Button from '@app/components/Common/Button';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Soulseek.SoulseekUnmatchedTracks', {
  title: 'Tracks Without an Album Match',
  description:
    '{count, plural, one {# track has} other {# tracks have}} no confident album match, so Lidarr cannot request {count, plural, one {it} other {them}}. Request {count, plural, one {it} other {them}} as individual tracks from Soulseek instead.',
  request:
    'Request {count, plural, one {Track} other {# Tracks}} from Soulseek',
  requesting: 'Requesting…',
  requested:
    '{count, plural, one {Track} other {# tracks}} requested from Soulseek.',
  failed: 'The tracks could not be requested from Soulseek.',
});

export interface UnmatchedTrack {
  title: string;
  artist?: string;
}

interface SoulseekUnmatchedTracksProps {
  tracks: UnmatchedTrack[];
}

/**
 * Offers playlist tracks Lidarr cannot request to the slskdN wishlist. Renders
 * nothing unless slskdN is configured and the user can request music.
 */
const SoulseekUnmatchedTracks = ({ tracks }: SoulseekUnmatchedTracksProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data: status } = useSWR<{ configured: boolean; canRequest: boolean }>(
    '/api/v1/soulseek/status',
    { revalidateOnFocus: false }
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const requestable = tracks.filter(
    (track) => track.artist?.trim() && track.title.trim()
  );
  if (!status?.configured || !status.canRequest || requestable.length === 0) {
    return null;
  }

  const submit = async () => {
    setBusy(true);
    try {
      const response = await axios.post<{ results: unknown[] }>(
        '/api/v1/soulseek/track-requests',
        {
          tracks: requestable.slice(0, 50).map((track) => ({
            artist: track.artist,
            title: track.title,
            source: 'playlist',
          })),
        }
      );
      setDone(true);
      addToast(
        intl.formatMessage(messages.requested, {
          count: response.data.results.length,
        }),
        { appearance: 'success', autoDismiss: true }
      );
    } catch (error) {
      addToast(
        axios.isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
          ? error.response.data.message
          : intl.formatMessage(messages.failed),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="app-card-sub card-layout">
      <h3 className="card-title">{intl.formatMessage(messages.title)}</h3>
      <p className="card-body-text">
        {intl.formatMessage(messages.description, {
          count: requestable.length,
        })}
      </p>
      <div className="app-action-row">
        <Button
          buttonType="primary"
          buttonSize="sm"
          disabled={busy || done}
          onClick={() => void submit()}
        >
          {intl.formatMessage(busy ? messages.requesting : messages.request, {
            count: Math.min(requestable.length, 50),
          })}
        </Button>
      </div>
    </section>
  );
};

export default SoulseekUnmatchedTracks;
