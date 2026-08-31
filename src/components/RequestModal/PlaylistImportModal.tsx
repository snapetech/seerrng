import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { PlaylistResolutionResponse } from '@server/interfaces/api/playlistInterfaces';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestModal.PlaylistImportModal', {
  title: 'Import Playlist',
  description:
    'Paste a Spotify or YouTube playlist link. SeerrNG will match its tracks to MusicBrainz albums for review before requesting anything.',
  urlLabel: 'Playlist URL',
  urlPlaceholder: 'https://open.spotify.com/playlist/...',
  spotifyConnect: 'Connect Spotify',
  spotifyReconnect: 'Reconnect Spotify',
  spotifyHelp:
    'Spotify imports use the connected account and only include playlists that account can access.',
  spotifyDisconnect: 'Disconnect Spotify',
  youtubeHelp:
    'YouTube imports use public playlists configured by the administrator.',
  preview: 'Preview Matches',
  resolving: 'Matching playlist…',
  error: 'The playlist could not be resolved.',
});

interface PlaylistImportModalProps {
  show: boolean;
  onCancel: () => void;
  onResolved: (response: PlaylistResolutionResponse) => void;
}

const getErrorMessage = (error: unknown): string | undefined => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    return typeof message === 'string' ? message : error.message;
  }
  return error instanceof Error ? error.message : undefined;
};

const PlaylistImportModal = ({
  show,
  onCancel,
  onResolved,
}: PlaylistImportModalProps) => {
  const intl = useIntl();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const [isResolving, setIsResolving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { data: spotifyStatus, mutate: refreshSpotifyStatus } = useSWR<{
    connected: boolean;
    displayName: string | null;
  }>('/api/v1/playlist/spotify/status');

  const resolve = async () => {
    if (!url.trim() || isResolving) {
      return;
    }
    setError(undefined);
    setIsResolving(true);
    try {
      const response = await axios.post<PlaylistResolutionResponse>(
        '/api/v1/playlist/resolve',
        { url: url.trim() }
      );
      onResolved(response.data);
    } catch (requestError) {
      setError(
        getErrorMessage(requestError) ?? intl.formatMessage(messages.error)
      );
    } finally {
      setIsResolving(false);
    }
  };

  const disconnectSpotify = async () => {
    if (isDisconnecting) {
      return;
    }
    setError(undefined);
    setIsDisconnecting(true);
    try {
      await axios.post('/api/v1/playlist/spotify/disconnect');
      await refreshSpotifyStatus();
    } catch (requestError) {
      setError(
        getErrorMessage(requestError) ?? intl.formatMessage(messages.error)
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Transition as={Fragment} show={show}>
      <Modal
        title={intl.formatMessage(messages.title)}
        onCancel={onCancel}
        onOk={() => void resolve()}
        okText={
          isResolving
            ? intl.formatMessage(messages.resolving)
            : intl.formatMessage(messages.preview)
        }
        okDisabled={!url.trim() || isResolving}
        loading={isResolving}
      >
        <p className="text-gray-300">
          {intl.formatMessage(messages.description)}
        </p>
        {error && (
          <div className="mt-4">
            <Alert title={error} type="warning" />
          </div>
        )}
        <label className="mt-5 block" htmlFor="playlist-url">
          <span className="text-label">
            {intl.formatMessage(messages.urlLabel)}
          </span>
          <input
            id="playlist-url"
            type="url"
            inputMode="url"
            value={url}
            placeholder={intl.formatMessage(messages.urlPlaceholder)}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void resolve();
              }
            }}
          />
        </label>
        <div className="mt-5 space-y-2 text-sm text-gray-400">
          <p>
            <a
              href="/api/v1/playlist/spotify/connect"
              className="text-indigo-300 hover:text-indigo-200"
            >
              {intl.formatMessage(
                spotifyStatus?.connected
                  ? messages.spotifyReconnect
                  : messages.spotifyConnect
              )}
            </a>{' '}
            {intl.formatMessage(messages.spotifyHelp)}
            {spotifyStatus?.connected && (
              <Button
                buttonType="ghost"
                buttonSize="sm"
                className="ml-2"
                onClick={() => void disconnectSpotify()}
                disabled={isDisconnecting}
              >
                {intl.formatMessage(messages.spotifyDisconnect)}
              </Button>
            )}
          </p>
          <p>{intl.formatMessage(messages.youtubeHelp)}</p>
        </div>
      </Modal>
    </Transition>
  );
};

export default PlaylistImportModal;
