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
        cancelButtonType="danger"
        okButtonType="success"
        actionButtonSize="standard"
        dialogClass="request-modal-site-surface refreshed-detail-text !w-[calc(100%-2rem)] rounded-xl border border-gray-700 shadow-lg shadow-gray-950/20 sm:!max-w-2xl"
      >
        <p className="refreshed-detail-text">
          {intl.formatMessage(messages.description)}
        </p>
        {error && (
          <div className="mt-4">
            <Alert title={error} type="warning" />
          </div>
        )}
        <div className="mt-5">
          <label className="text-label" htmlFor="playlist-url">
            {intl.formatMessage(messages.urlLabel)}
          </label>
          <input
            id="playlist-url"
            type="url"
            inputMode="url"
            value={url}
            placeholder={intl.formatMessage(messages.urlPlaceholder)}
            className="request-form-control mt-2 block h-10 w-full min-w-0 rounded-md border px-3 text-sm transition duration-150 ease-in-out focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 focus:outline-none"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void resolve();
              }
            }}
          />
        </div>
        <section className="refreshed-inset-surface mt-5 rounded-lg border border-gray-700 p-3 text-sm">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Button
              as="a"
              href="/api/v1/playlist/spotify/connect"
              buttonType="association"
              buttonSize="sm"
            >
              {intl.formatMessage(
                spotifyStatus?.connected
                  ? messages.spotifyReconnect
                  : messages.spotifyConnect
              )}
            </Button>
            <p className="refreshed-detail-text-muted flex-1">
              {intl.formatMessage(messages.spotifyHelp)}
            </p>
            {spotifyStatus?.connected && (
              <Button
                buttonType="default"
                buttonSize="sm"
                onClick={() => void disconnectSpotify()}
                disabled={isDisconnecting}
              >
                {intl.formatMessage(messages.spotifyDisconnect)}
              </Button>
            )}
          </div>
          <p className="refreshed-detail-text-muted mt-3 border-t border-gray-700 pt-3">
            {intl.formatMessage(messages.youtubeHelp)}
          </p>
        </section>
      </Modal>
    </Transition>
  );
};

export default PlaylistImportModal;
