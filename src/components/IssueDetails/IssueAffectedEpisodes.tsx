import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type Issue from '@server/entity/Issue';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import axios from 'axios';
import useSWR from 'swr';

interface IssueAffectedEpisodesProps {
  issue: Issue;
  tvId: number;
}

const getSelections = (issue: Issue): SeasonEpisodeSelection[] => {
  if (issue.problemEpisodeSelections?.length) {
    return issue.problemEpisodeSelections;
  }
  if (issue.problemSeason > 0 || issue.problemEpisodes?.length) {
    const episodes =
      issue.problemEpisodes && issue.problemEpisodes.length > 0
        ? issue.problemEpisodes
        : issue.problemEpisode > 0
          ? [issue.problemEpisode]
          : undefined;
    return [
      {
        seasonNumber: issue.problemSeason,
        ...(episodes ? { episodeNumbers: episodes } : {}),
      },
    ];
  }
  return [];
};

const isLegacyEntireSeriesIssue = (issue: Issue) =>
  !issue.problemEpisodeSelections?.length &&
  issue.problemSeason === 0 &&
  issue.problemEpisode === 0 &&
  !issue.problemEpisodes?.length;

const IssueAffectedEpisodes = ({ issue, tvId }: IssueAffectedEpisodesProps) => {
  const selections = getSelections(issue);
  const seasonNumbers = selections.map((selection) => selection.seasonNumber);
  const { data, error } = useSWR<SeasonWithEpisodes[]>(
    seasonNumbers.length > 0
      ? `issue-affected-seasons:${tvId}:${seasonNumbers.join(',')}`
      : null,
    async () =>
      Promise.all(
        seasonNumbers.map(async (seasonNumber) => {
          const response = await axios.get<SeasonWithEpisodes>(
            `/api/v1/tv/${tvId}/season/${seasonNumber}`
          );
          return response.data;
        })
      )
  );
  const rows = data
    ? selections.flatMap((selection) => {
        const season = data.find(
          (item) => item.seasonNumber === selection.seasonNumber
        );
        const episodes = selection.episodeNumbers
          ? (season?.episodes.filter((episode) =>
              selection.episodeNumbers?.includes(episode.episodeNumber)
            ) ?? [])
          : (season?.episodes ?? []);
        return episodes.map((episode) => ({
          season:
            selection.seasonNumber === 0
              ? 'Specials'
              : `Season ${selection.seasonNumber}`,
          episode: `Episode ${episode.episodeNumber}`,
          title: episode.name || `Episode ${episode.episodeNumber}`,
        }));
      })
    : [];
  const legacyEntireSeries = isLegacyEntireSeriesIssue(issue);

  return (
    <section className="refreshed-inset-surface mt-[5px] rounded-lg border border-gray-700 p-3">
      <h4 className="mb-2 text-xs font-semibold text-gray-200">
        Affected Episodes
      </h4>
      <div className="request-divider-dark grid grid-cols-[7rem_7rem_minmax(0,1fr)] gap-x-3 border-b px-1 pb-2 text-xs font-semibold text-gray-200">
        <span>Season</span>
        <span>Episode</span>
        <span>Title</span>
      </div>
      {!data && !error && selections.length > 0 ? (
        <div className="flex h-16 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="scrollable-card -mr-3 max-h-56 overflow-y-auto pr-3">
          {legacyEntireSeries ? (
            <div className="grid min-h-7 grid-cols-[7rem_7rem_minmax(0,1fr)] items-center gap-x-3 px-1 text-xs">
              <span className="font-medium text-gray-200">All Seasons</span>
              <span className="refreshed-detail-text">All</span>
              <span className="refreshed-detail-text">Entire Series</span>
            </div>
          ) : error ? (
            <div className="px-1 py-2 text-xs text-red-300">
              Affected episodes could not be loaded
            </div>
          ) : rows.length > 0 ? (
            rows.map((row, index) => (
              <div
                key={`${row.season}-${row.episode}-${index}`}
                className="grid min-h-7 grid-cols-[7rem_7rem_minmax(0,1fr)] items-center gap-x-3 px-1 text-xs"
              >
                <span className="font-medium text-gray-200">{row.season}</span>
                <span className="refreshed-detail-text">{row.episode}</span>
                <span className="refreshed-detail-text truncate">
                  {row.title}
                </span>
              </div>
            ))
          ) : (
            <div className="refreshed-detail-text-muted px-1 py-2 text-xs">
              None Selected
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default IssueAffectedEpisodes;
