import PageErrorMessage from '@app/components/Common/PageErrorMessage';
import SeasonEpisodeTree, {
  formatTreeNumber,
} from '@app/components/MediaDetails/SeasonEpisodeTree';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import {
  buildRequestTreeData,
  firstSelectableRequestEpisodeId,
  hasCompleteRequestMetadata,
  requestSelectionToTreeIds,
  treeSelectionToRequests,
} from './requestTreeData';

const messages = defineMessages('components.RequestModal.RequestTree', {
  specials: 'Specials',
  seasonNumber: 'Season {number}',
  untitled: 'Untitled',
  loading: 'Loading Episodes',
  noSeasons: 'No Seasons Available',
  loadError: 'Episodes Could Not Be Loaded',
  loadErrorHint:
    'Your request selection is preserved. Load all season information before changing it.',
  retryTooltip:
    'Fetch the seasons and episodes again without changing your request selection.',
});

export interface RequestSeasonEpisodeTreeProps {
  tvId: number;
  seasons: TvDetails['seasons'];
  selections: SeasonEpisodeSelection[];
  onSelectionsChange: (selections: SeasonEpisodeSelection[]) => void;
  disabledSeasons?: number[];
  disabledEpisodes?: Record<number, number[]>;
  availableEpisodesBySeason?: Record<number, number[]>;
  selectionMode?: 'multiple' | 'single-episode';
  onLoadingChange?: (loading: boolean) => void;
  onReadyChange?: (ready: boolean) => void;
}

const RequestSeasonEpisodeTree = ({
  tvId,
  seasons,
  selections,
  onSelectionsChange,
  disabledSeasons = [],
  disabledEpisodes = {},
  availableEpisodesBySeason = {},
  selectionMode = 'multiple',
  onLoadingChange,
  onReadyChange,
}: RequestSeasonEpisodeTreeProps) => {
  const intl = useIntl();
  const { data, error, isValidating, mutate } = useSWR<SeasonWithEpisodes[]>(
    seasons.length
      ? [
          'request-season-metadata',
          tvId,
          ...seasons.map((season) => season.seasonNumber),
        ]
      : null,
    async () =>
      Promise.all(
        seasons.map(
          async (season) =>
            (
              await axios.get<SeasonWithEpisodes>(
                `/api/v1/tv/${tvId}/season/${season.seasonNumber}`
              )
            ).data
        )
      ),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: false,
    }
  );
  const complete = hasCompleteRequestMetadata(seasons, data);
  const ready = complete && !error;
  useEffect(() => {
    onLoadingChange?.(isValidating);
  }, [isValidating, onLoadingChange]);
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, tvId, onReadyChange]);
  useEffect(
    () => () => {
      onLoadingChange?.(false);
      onReadyChange?.(false);
    },
    [onLoadingChange, onReadyChange]
  );
  const treeData = useMemo(
    () =>
      buildRequestTreeData(
        seasons,
        data ?? [],
        disabledSeasons,
        disabledEpisodes,
        availableEpisodesBySeason,
        (number) =>
          number === 0
            ? intl.formatMessage(messages.specials)
            : intl.formatMessage(messages.seasonNumber, {
                number: formatTreeNumber(number),
              }),
        intl.formatMessage(messages.untitled)
      ),
    [
      seasons,
      data,
      disabledSeasons,
      disabledEpisodes,
      availableEpisodesBySeason,
      intl,
    ]
  );
  const feedback =
    seasons.length === 0 ? (
      <PageErrorMessage
        title={intl.formatMessage(messages.noSeasons)}
        severity="empty"
      />
    ) : error || (!complete && data !== undefined && !isValidating) ? (
      <PageErrorMessage
        title={intl.formatMessage(messages.loadError)}
        description={intl.formatMessage(messages.loadErrorHint)}
        retry={{
          onClick: () => mutate(),
          tooltip: intl.formatMessage(messages.retryTooltip),
          busy: isValidating,
        }}
      />
    ) : !complete ? (
      <PageErrorMessage
        title={intl.formatMessage(messages.loading)}
        severity="info"
      />
    ) : null;
  const selectedIds = requestSelectionToTreeIds(treeData, selections);
  const singleEpisodeId =
    selectionMode === 'single-episode'
      ? firstSelectableRequestEpisodeId(treeData, selectedIds)
      : undefined;
  const renderedSelectedIds =
    singleEpisodeId === undefined ? selectedIds : [singleEpisodeId];
  const singleEpisodeSelection =
    singleEpisodeId === undefined
      ? []
      : treeSelectionToRequests(treeData, [singleEpisodeId], [], true);
  const selectionKey = JSON.stringify(selections);
  const singleEpisodeSelectionKey = JSON.stringify(singleEpisodeSelection);
  useEffect(() => {
    if (
      selectionMode === 'single-episode' &&
      ready &&
      selectionKey !== singleEpisodeSelectionKey
    ) {
      onSelectionsChange(singleEpisodeSelection);
    }
  }, [
    onSelectionsChange,
    ready,
    selectionKey,
    selectionMode,
    singleEpisodeSelection,
    singleEpisodeSelectionKey,
  ]);

  return (
    <div
      className="card-list"
      data-list-width="remaining"
      data-selection-tree
      aria-busy={isValidating}
    >
      <SeasonEpisodeTree
        key={tvId}
        layout={1}
        selectionPurpose="request"
        disabled={!ready}
        seasons={treeData}
        selectedIds={renderedSelectedIds}
        selectionMode={selectionMode}
        onSelectionChange={(ids) => {
          if (ready) {
            onSelectionsChange(
              treeSelectionToRequests(
                treeData,
                ids,
                selections,
                selectionMode === 'single-episode'
              )
            );
          }
        }}
        feedback={feedback}
      />
    </div>
  );
};

export default RequestSeasonEpisodeTree;
