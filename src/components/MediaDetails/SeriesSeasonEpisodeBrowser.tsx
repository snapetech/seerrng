import PageErrorMessage, {
  type MessageRetry,
} from '@app/components/Common/PageErrorMessage';
import SeasonEpisodeTree, {
  formatTreeNumber,
} from '@app/components/MediaDetails/SeasonEpisodeTree';
import {
  buildSeriesTreeData,
  selectedTreeEpisodeIds,
  treeSelectionToPlaybackIds,
} from '@app/components/MediaDetails/seriesTreeData';
import defineMessages from '@app/utils/defineMessages';
import type { PlaybackCatalogResponse } from '@server/models/Playback';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import type { WatchStatusResponse } from '@server/models/WatchStatus';
import axios from 'axios';
import { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MediaDetails.SeriesBrowser', {
  specials: 'Specials',
  seasonNumber: 'Season {number}',
  untitled: 'Untitled',
  noSeasons: 'No Seasons Available',
  loadError: 'Episodes Could Not Be Loaded',
  loadErrorHint: 'Episode information could not be fetched, please try again.',
  retryEpisodesTooltip:
    'Fetch the seasons and episodes again without changing your playback selection.',
});

interface SeriesSeasonEpisodeBrowserProps {
  active: boolean;
  contained?: boolean;
  metadataRetry: MessageRetry;
  onLoadingChange?: (loading: boolean) => void;
  tvId: number;
  seasons: TvDetails['seasons'];
  catalog?: PlaybackCatalogResponse;
  watchedStatus?: WatchStatusResponse;
  selectedItemIds: string[];
  onSelectionChange: (itemIds: string[]) => void;
}

const SeriesSeasonEpisodeBrowser = ({
  active,
  contained = false,
  metadataRetry,
  onLoadingChange,
  tvId,
  seasons,
  catalog,
  watchedStatus,
  selectedItemIds,
  onSelectionChange,
}: SeriesSeasonEpisodeBrowserProps) => {
  const intl = useIntl();
  const visibleSeasons = useMemo(
    () => seasons.filter((season) => season.episodeCount > 0),
    [seasons]
  );
  const { data, error, isValidating, mutate } = useSWR<SeasonWithEpisodes[]>(
    active && visibleSeasons.length
      ? [
          'series-season-metadata',
          tvId,
          ...visibleSeasons.map((season) => season.seasonNumber),
        ]
      : null,
    async () =>
      Promise.all(
        visibleSeasons.map(
          async (season) =>
            (
              await axios.get<SeasonWithEpisodes>(
                `/api/v1/tv/${tvId}/season/${season.seasonNumber}`
              )
            ).data
        )
      ),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  useEffect(() => {
    onLoadingChange?.(isValidating);
  }, [isValidating, onLoadingChange]);
  useEffect(() => () => onLoadingChange?.(false), [onLoadingChange]);

  const treeData = useMemo(
    () =>
      buildSeriesTreeData(
        visibleSeasons,
        data ?? [],
        catalog,
        watchedStatus,
        (seasonNumber) =>
          seasonNumber === 0
            ? intl.formatMessage(messages.specials)
            : intl.formatMessage(messages.seasonNumber, {
                number: formatTreeNumber(seasonNumber),
              }),
        intl.formatMessage(messages.untitled)
      ),
    [visibleSeasons, data, catalog, watchedStatus, intl]
  );
  const feedback =
    visibleSeasons.length === 0 ? (
      <PageErrorMessage
        title={intl.formatMessage(messages.noSeasons)}
        severity="empty"
        retry={metadataRetry}
      />
    ) : error ? (
      <PageErrorMessage
        title={intl.formatMessage(messages.loadError)}
        description={intl.formatMessage(messages.loadErrorHint)}
        retry={{
          onClick: () => mutate(),
          tooltip: intl.formatMessage(messages.retryEpisodesTooltip),
          busy: isValidating,
        }}
      />
    ) : null;

  return (
    <div
      className="card-list"
      data-list-layout={contained ? undefined : 'stacked'}
      data-list-width={contained ? 'remaining' : 'two-thirds'}
      data-selection-tree
    >
      <SeasonEpisodeTree
        key={tvId}
        layout={1}
        seasons={treeData.seasons}
        mediaServerType={watchedStatus?.serverType ?? catalog?.serverType}
        selectedIds={selectedTreeEpisodeIds(
          treeData.playbackIdsByEpisode,
          selectedItemIds
        )}
        onSelectionChange={(ids) =>
          onSelectionChange(
            treeSelectionToPlaybackIds(treeData.playbackIdsByEpisode, ids)
          )
        }
        feedback={feedback}
      />
    </div>
  );
};

export default SeriesSeasonEpisodeBrowser;
