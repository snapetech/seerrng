import SelectionCircle from '@app/components/Common/SelectionCircle';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon, ServerStackIcon } from '@heroicons/react/24/outline';
import type { PlaybackCatalogResponse } from '@server/models/Playback';
import { useMemo } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.PlaybackTrackList', {
  track: 'Track',
  title: 'Title',
  audiobook: 'Audiobook',
  noTracks: 'No playable tracks are available.',
  selection: 'Select items to play',
  availabilityLegend: 'Green check: available. Red X: not available.',
});

interface PlaybackTrackListProps {
  catalog?: PlaybackCatalogResponse;
  selectedItemIds: string[];
  onSelectionChange: (itemIds: string[]) => void;
}

const PlaybackTrackList = ({
  catalog,
  selectedItemIds,
  onSelectionChange,
}: PlaybackTrackListProps) => {
  const intl = useIntl();
  const tracks = useMemo(
    () =>
      (catalog?.groups ?? [])
        .flatMap((group) => group.items)
        .sort(
          (first, second) =>
            (first.parentIndex ?? 0) - (second.parentIndex ?? 0) ||
            first.index - second.index
        ),
    [catalog]
  );
  const selection = new Set(selectedItemIds);
  const allSelected =
    tracks.length > 0 && tracks.every((track) => selection.has(track.id));
  const toggleAll = () =>
    onSelectionChange(allSelected ? [] : tracks.map((track) => track.id));
  const toggleTrack = (itemId: string) => {
    const next = new Set(selection);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    onSelectionChange([...next]);
  };

  if (tracks.length === 0) {
    return (
      <p className="refreshed-detail-text-muted mt-2 text-xs">
        {intl.formatMessage(messages.noTracks)}
      </p>
    );
  }

  return (
    <section className="refreshed-inset-surface mt-[5px] overflow-hidden rounded-lg border border-gray-700 p-2">
      <div className="media-inset-table-heading media-scroll-grid-header request-divider-dark grid grid-cols-[2rem_3rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 border-b pb-2 pl-1">
        <SelectionCircle
          onClick={toggleAll}
          selected={allSelected}
          label={intl.formatMessage(messages.selection)}
        />
        <span>{intl.formatMessage(messages.track)}</span>
        <span>{intl.formatMessage(messages.title)}</span>
        <Tooltip content={intl.formatMessage(messages.availabilityLegend)}>
          <span
            className="media-availability-cell"
            aria-label={intl.formatMessage(messages.availabilityLegend)}
          >
            <ServerStackIcon className="h-4 w-4" />
          </span>
        </Tooltip>
      </div>
      <div className="scrollable-card -mr-2 max-h-[214px] space-y-0.5 overflow-y-auto pt-1 pr-2">
        {tracks.map((track, index) => {
          const selected = selection.has(track.id);
          return (
            <div
              key={track.id}
              className="grid min-h-[24px] grid-cols-[2rem_3rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 px-1"
            >
              <SelectionCircle
                onClick={() => toggleTrack(track.id)}
                selected={selected}
                label={intl.formatMessage(messages.selection)}
              />
              <span className="text-xs font-medium text-gray-100">
                {track.index || index + 1}
              </span>
              <span className="refreshed-detail-text truncate text-xs">
                {track.title || intl.formatMessage(messages.audiobook)}
              </span>
              <span className="media-availability-cell">
                <CheckCircleIcon
                  className="h-4 w-4 text-green-400"
                  aria-hidden
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PlaybackTrackList;
