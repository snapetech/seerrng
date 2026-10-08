import Button from '@app/components/Common/Button';
import MediaServerIcon, {
  getMediaServerName,
} from '@app/components/Common/MediaServerIcon';
import SelectionCircle, {
  SelectionCircleIndicator,
} from '@app/components/Common/SelectionCircle';
import Tooltip from '@app/components/Common/Tooltip';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MinusIcon,
  NoSymbolIcon,
  PlusIcon,
  ServerStackIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/24/solid';
import type { WatchStatusResponse } from '@server/models/WatchStatus';
import { useId, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

export interface TreeEpisode {
  id: number;
  episodeNumber: number;
  name: string;
  available: boolean;
  // Request selection is independent of library availability.
  selectable?: boolean;
  watched?: boolean;
  releaseDate?: string;
}

export interface TreeSeason {
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  episodes: TreeEpisode[];
}

export interface SeasonEpisodeTreeProps {
  layout: 1 | 6;
  seasons: TreeSeason[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  mediaServerType?: WatchStatusResponse['serverType'];
  feedback?: ReactNode;
  selectionPurpose?: 'playback' | 'request';
  selectionMode?: 'multiple' | 'single-episode';
  disabled?: boolean;
}

export const isTreeEpisodeSelectable = (episode: TreeEpisode) =>
  episode.selectable ?? episode.available;

export const formatTreeNumber = (number: number) =>
  String(number).padStart(2, '0');

export const seasonSelection = (season: TreeSeason, selectedIds: number[]) => {
  const available = season.episodes.filter(isTreeEpisodeSelectable);
  const selected = available.filter((episode) =>
    selectedIds.includes(episode.id)
  );
  return {
    disabled: available.length === 0,
    selected: available.length > 0 && selected.length === available.length,
    partial: selected.length > 0 && selected.length < available.length,
    count: selected.length,
  };
};

export const toggleSeasonSelection = (
  season: TreeSeason,
  selectedIds: number[]
) => {
  const ids = season.episodes
    .filter(isTreeEpisodeSelectable)
    .map((episode) => episode.id);
  const allSelected =
    ids.length > 0 && ids.every((id) => selectedIds.includes(id));
  return allSelected
    ? selectedIds.filter((id) => !ids.includes(id))
    : [...new Set([...selectedIds, ...ids])];
};

const layouts = {
  1: 'outline',
  6: 'amber-tree',
} as const;

const SeasonEpisodeTree = ({
  layout,
  seasons,
  selectedIds,
  onSelectionChange,
  mediaServerType,
  feedback,
  selectionPurpose = 'playback',
  selectionMode = 'multiple',
  disabled = false,
}: SeasonEpisodeTreeProps) => {
  const intl = useIntl();
  const instanceId = useId();
  const [expanded, setExpanded] = useState<number[]>([]);
  const isExpanded = (season: TreeSeason) =>
    expanded.includes(season.seasonNumber);
  const panelId = (season: TreeSeason) =>
    `${instanceId}-season-${season.seasonNumber}`;
  const availableIds = new Set(
    seasons.flatMap((season) =>
      season.episodes
        .filter(isTreeEpisodeSelectable)
        .map((episode) => episode.id)
    )
  );
  const selectedCount = [...availableIds].filter((id) =>
    selectedIds.includes(id)
  ).length;
  const allSelected =
    availableIds.size > 0 && selectedCount === availableIds.size;
  const toggleAll = () =>
    onSelectionChange(
      allSelected
        ? selectedIds.filter((id) => !availableIds.has(id))
        : [...new Set([...selectedIds, ...availableIds])]
    );
  const toggleExpanded = (season: TreeSeason) => {
    setExpanded((current) =>
      current.includes(season.seasonNumber)
        ? current.filter((number) => number !== season.seasonNumber)
        : [...current, season.seasonNumber]
    );
  };
  const toggleEpisode = (episode: TreeEpisode) => {
    if (!isTreeEpisodeSelectable(episode)) return;
    onSelectionChange(
      selectionMode === 'single-episode'
        ? selectedIds.includes(episode.id)
          ? []
          : [episode.id]
        : selectedIds.includes(episode.id)
          ? selectedIds.filter((id) => id !== episode.id)
          : [...selectedIds, episode.id]
    );
  };
  const selectionDescription =
    selectionPurpose === 'request' ? 'requestable' : 'available';
  const formatReleaseDate = (releaseDate?: string) => {
    if (!releaseDate) return '—';
    // Metadata dates are calendar dates, not local-time instants. Keep the day
    // intact while formatting in the user's app locale.
    const date = new Date(`${releaseDate}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return '—';
    return intl.formatDate(date, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  };

  const seasonControls = (season: TreeSeason) => {
    const state = seasonSelection(season, selectedIds);
    const open = isExpanded(season);
    const selection =
      selectionMode === 'single-episode' ? (
        <span data-tree-part="selection" aria-hidden="true" />
      ) : (
        <Tooltip
          content={
            state.disabled
              ? 'No episodes in this season are available for selection.'
              : `${state.selected ? 'Deselect' : 'Select'} every ${selectionDescription} episode in ${season.name}.`
          }
        >
          <span data-tree-part="selection">
            <SelectionCircle
              selected={state.selected}
              partial={state.partial}
              disabled={disabled || state.disabled}
              label={`${state.selected ? 'Deselect' : 'Select'} ${selectionDescription} episodes in ${season.name}`}
              onClick={() =>
                onSelectionChange(toggleSeasonSelection(season, selectedIds))
              }
            />
          </span>
        </Tooltip>
      );
    const episodeCount = season.episodeCount ?? season.episodes.length;
    const countDescription = `${state.count} of ${episodeCount} episodes selected`;
    const expanderIcon =
      layout === 6 ? null : open ? (
        <ChevronDownIcon aria-hidden />
      ) : (
        <ChevronRightIcon aria-hidden />
      );
    return (
      <>
        {selection}
        <Button
          data-tree-part="disclosure"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${season.name}`}
          aria-description={countDescription}
          aria-expanded={open}
          aria-controls={panelId(season)}
          title={`${open ? 'Hide' : 'Show'} the episodes in ${season.name}. ${countDescription}.`}
          onClick={() => toggleExpanded(season)}
        >
          {expanderIcon}
          <span data-tree-part="season-label">
            <span data-tree-part="name">{season.name}:</span>
            <span data-tree-part="count-separator" aria-hidden="true">
              {'  '}
            </span>
            <span
              data-tree-part="count"
              data-selection-state={
                state.count === 0
                  ? 'none'
                  : state.count === episodeCount
                    ? 'full'
                    : 'partial'
              }
              title={countDescription}
              aria-label={countDescription}
            >
              {formatTreeNumber(state.count)}/{formatTreeNumber(episodeCount)}
            </span>
          </span>
        </Button>
      </>
    );
  };

  const episodeContent = (episode: TreeEpisode) => (
    <>
      <Tooltip
        content={
          isTreeEpisodeSelectable(episode)
            ? `${selectedIds.includes(episode.id) ? 'Deselect' : 'Select'} ${episode.name}.`
            : selectionPurpose === 'request'
              ? 'This episode is already available or requested and cannot be selected.'
              : 'This episode is not available in the library and cannot be selected.'
        }
      >
        <button
          type="button"
          data-tree-part="episode-selection"
          disabled={disabled || !isTreeEpisodeSelectable(episode)}
          aria-label={`${selectedIds.includes(episode.id) ? 'Deselect' : 'Select'} Episode ${episode.episodeNumber}: ${episode.name}`}
          aria-pressed={
            selectedIds.includes(episode.id) && isTreeEpisodeSelectable(episode)
          }
          onClick={() => toggleEpisode(episode)}
        >
          <span data-tree-part="selection">
            <SelectionCircleIndicator
              selected={
                selectedIds.includes(episode.id) &&
                isTreeEpisodeSelectable(episode)
              }
              disabled={disabled || !isTreeEpisodeSelectable(episode)}
            />
          </span>
          <span data-tree-part="number">
            {formatTreeNumber(episode.episodeNumber)}
          </span>
          <span data-tree-part="name" title={episode.name}>
            {episode.name}
          </span>
        </button>
      </Tooltip>
      <Tooltip
        content={
          formatReleaseDate(episode.releaseDate) === '—'
            ? 'The release date is not available for this episode.'
            : `Release date: ${formatReleaseDate(episode.releaseDate)}.`
        }
      >
        <time
          data-tree-part="release-date"
          dateTime={
            formatReleaseDate(episode.releaseDate) === '—'
              ? undefined
              : episode.releaseDate
          }
          aria-label={`Release Date: ${formatReleaseDate(episode.releaseDate)}`}
        >
          {formatReleaseDate(episode.releaseDate)}
        </time>
      </Tooltip>
      <Tooltip
        content={
          episode.available
            ? 'Available in the library.'
            : 'Not available in the library.'
        }
      >
        <span
          className="media-availability-cell"
          data-tree-part="availability"
          data-availability={episode.available ? 'full' : 'missing'}
          aria-label={episode.available ? 'Available' : 'Not Available'}
        >
          {episode.available ? (
            <CheckCircleIcon className="card-table-icon" aria-hidden />
          ) : (
            <XCircleIcon className="card-table-icon" aria-hidden />
          )}
        </span>
      </Tooltip>
      <Tooltip
        content={
          episode.watched === undefined
            ? 'Watch status is not available for this episode.'
            : episode.watched
              ? 'This episode has been watched.'
              : 'This episode has not been watched.'
        }
      >
        <span
          className="watched-status-cell"
          data-tree-part="watched"
          aria-label={
            episode.watched === undefined
              ? 'Watch Status Not Available'
              : episode.watched
                ? 'Watched'
                : 'Unwatched'
          }
        >
          {episode.watched === undefined ? (
            '?'
          ) : episode.watched ? (
            <CheckIcon className="watched-status-icon" aria-hidden="true" />
          ) : (
            '–'
          )}
        </span>
      </Tooltip>
    </>
  );

  const columnHeadings = () => (
    <div className="card-table" data-tree-part="column-headings">
      {selectionMode === 'single-episode' ? (
        <span data-tree-part="select-all" aria-hidden="true" />
      ) : (
        <Tooltip
          content={
            availableIds.size === 0
              ? 'No episodes are available for selection.'
              : `${allSelected ? 'Deselect' : 'Select'} every ${selectionDescription} episode across all seasons, including collapsed seasons.`
          }
        >
          <span data-tree-part="select-all">
            <SelectionCircle
              selected={allSelected}
              partial={selectedCount > 0 && !allSelected}
              disabled={disabled || availableIds.size === 0}
              label={`${allSelected ? 'Deselect' : 'Select'} all ${selectionDescription} episodes`}
              onClick={toggleAll}
            />
          </span>
        </Tooltip>
      )}
      <Tooltip content="The episode number within this season.">
        <span
          className="card-table-heading"
          data-tree-part="number-heading"
          aria-label="Episode Number"
        >
          #
        </span>
      </Tooltip>
      <Tooltip content="The episode title. Hover a shortened title to read it in full.">
        <span className="card-table-heading">Title</span>
      </Tooltip>
      <Tooltip content="The episode's original release date, including the abbreviated day of the week. A dash means the date is not available.">
        <span className="card-table-heading">Release Date</span>
      </Tooltip>
      <Tooltip content="Episode availability in the media library: a green check means available; a red cross means unavailable.">
        <span className="media-availability-cell" aria-label="Availability">
          <ServerStackIcon className="card-table-icon" aria-hidden />
        </span>
      </Tooltip>
      <Tooltip
        content={`Watch status on ${(mediaServerType !== undefined ? getMediaServerName(mediaServerType) : undefined) ?? 'the media server'}: a check means watched, a short dash means unwatched, and a question mark means the status is unknown.`}
      >
        <span
          className="watched-status-cell"
          aria-label="Media Server Watch Status"
        >
          {mediaServerType !== undefined ? (
            <MediaServerIcon
              mediaServerType={mediaServerType}
              className="watched-status-logo"
            />
          ) : (
            '—'
          )}
        </span>
      </Tooltip>
    </div>
  );

  const episodes = (season: TreeSeason) => (
    <ul
      id={panelId(season)}
      data-tree-part="episodes"
      hidden={!isExpanded(season)}
      aria-label={`${season.name} Episodes`}
    >
      {season.episodes.map((episode) => (
        <li
          key={episode.id}
          className="card-table episode-focus-row"
          data-tree-part="episode"
          data-selected={
            selectedIds.includes(episode.id) && isTreeEpisodeSelectable(episode)
          }
          data-active={
            selectedIds.includes(episode.id) && isTreeEpisodeSelectable(episode)
          }
        >
          {episodeContent(episode)}
        </li>
      ))}
    </ul>
  );

  return (
    <section
      className="selection-tree card-layout"
      data-tree-layout={layouts[layout]}
      data-selection-mode={selectionMode}
      aria-label={
        selectionMode === 'single-episode'
          ? 'Choose one starting episode'
          : 'Seasons And Episodes'
      }
    >
      <div
        className="app-card-inset card-layout refreshed-inset-surface"
        data-tree-part="frame"
        data-card-layout="scroll"
      >
        <div data-tree-part="toolbar">
          <div className="app-action-row" data-tree-part="actions">
            <Button
              buttonType="prowlarr"
              title="Show the episodes for every season."
              onClick={() =>
                setExpanded(seasons.map((season) => season.seasonNumber))
              }
            >
              <PlusIcon className="app-action-icon" aria-hidden="true" />
              Expand All
            </Button>
            <Button
              buttonType="prowlarr"
              title="Hide the episodes for every season without changing the selection."
              onClick={() => setExpanded([])}
            >
              <MinusIcon className="app-action-icon" aria-hidden="true" />
              Collapse All
            </Button>
            <Button
              buttonType="prowlarr"
              disabled={disabled || selectedCount === 0}
              title="Deselect every episode without changing the expanded seasons."
              onClick={() => onSelectionChange([])}
            >
              <NoSymbolIcon className="app-action-icon" aria-hidden="true" />
              Clear Selection
            </Button>
          </div>
          <dl className="card-table" data-tree-part="selection-summary">
            <dt className="card-table-heading">Selected:</dt>
            <dd className="card-table-value" data-tree-part="selected-total">
              {formatTreeNumber(selectedCount)}
            </dd>
          </dl>
        </div>
        <div data-card-part="body" data-table-layout="selection-table">
          {columnHeadings()}
          {feedback}
          <div
            className="scrollable-card"
            data-tree-part="viewport"
            data-scroll-layout="tree"
          >
            {layout === 1 && (
              <ul data-tree-part="branches">
                {seasons.map((season) => (
                  <li key={season.seasonNumber}>
                    <div className="card-table" data-tree-part="season">
                      {seasonControls(season)}
                    </div>
                    {episodes(season)}
                  </li>
                ))}
              </ul>
            )}
            {layout !== 1 && (
              <>
                <ul data-tree-part="menu">
                  {seasons.map((season) => (
                    <li
                      key={season.seasonNumber}
                      data-tree-part="branch"
                      data-expanded={isExpanded(season)}
                    >
                      <div className="card-table" data-tree-part="season">
                        {seasonControls(season)}
                      </div>
                      {episodes(season)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SeasonEpisodeTree;
