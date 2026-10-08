import type { TreeSeason } from '@app/components/MediaDetails/SeasonEpisodeTree';
import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';

export const hasCompleteRequestMetadata = (
  seasons: TvDetails['seasons'],
  metadata?: SeasonWithEpisodes[]
) =>
  seasons.length === 0 ||
  Boolean(
    metadata &&
    seasons.every((season) =>
      metadata.some((loaded) => loaded.seasonNumber === season.seasonNumber)
    )
  );

export const buildRequestTreeData = (
  seasons: TvDetails['seasons'],
  metadata: SeasonWithEpisodes[],
  disabledSeasons: number[],
  disabledEpisodes: Record<number, number[]>,
  availableEpisodesBySeason: Record<number, number[]>,
  seasonName: (number: number) => string,
  untitled: string
): TreeSeason[] =>
  [...seasons]
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map((season) => ({
      seasonNumber: season.seasonNumber,
      name: seasonName(season.seasonNumber),
      episodeCount: season.episodeCount,
      episodes: [
        ...(metadata.find(
          (loaded) => loaded.seasonNumber === season.seasonNumber
        )?.episodes ?? []),
      ]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((episode) => ({
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          name: episode.name || untitled,
          releaseDate: episode.airDate || undefined,
          available: Boolean(
            availableEpisodesBySeason[season.seasonNumber]?.includes(
              episode.episodeNumber
            )
          ),
          selectable:
            !disabledSeasons.includes(season.seasonNumber) &&
            !disabledEpisodes[season.seasonNumber]?.includes(
              episode.episodeNumber
            ),
        })),
    }));

// TMDB row IDs never enter the request payload. Requests use season/episode
// numbers, with an omitted episodeNumbers field retaining whole-season intent.
export const requestSelectionToTreeIds = (
  seasons: TreeSeason[],
  selections: SeasonEpisodeSelection[]
) =>
  seasons.flatMap((season) => {
    const selected = selections.find(
      (selection) => selection.seasonNumber === season.seasonNumber
    );
    return selected
      ? season.episodes
          .filter(
            (episode) =>
              episode.selectable &&
              (selected.episodeNumbers === undefined ||
                selected.episodeNumbers.includes(episode.episodeNumber))
          )
          .map((episode) => episode.id)
      : [];
  });

export const firstSelectableRequestEpisodeId = (
  seasons: TreeSeason[],
  preferredIds: number[] = []
): number | undefined => {
  const selectableIds = seasons.flatMap((season) =>
    season.episodes
      .filter((episode) => episode.selectable)
      .map((episode) => episode.id)
  );
  return (
    preferredIds.find((id) => selectableIds.includes(id)) ?? selectableIds[0]
  );
};

export const treeSelectionToRequests = (
  seasons: TreeSeason[],
  ids: number[],
  previousSelections: SeasonEpisodeSelection[] = [],
  singleEpisodeSelection = false
): SeasonEpisodeSelection[] => {
  if (singleEpisodeSelection) {
    const selectedId = ids.find((id) =>
      seasons.some((season) =>
        season.episodes.some(
          (episode) => episode.id === id && episode.selectable
        )
      )
    );
    if (selectedId === undefined) return [];
    for (const season of seasons) {
      const episode = season.episodes.find(
        (candidate) => candidate.id === selectedId && candidate.selectable
      );
      if (episode) {
        return [
          {
            seasonNumber: season.seasonNumber,
            episodeNumbers: [episode.episodeNumber],
          },
        ];
      }
    }
    return [];
  }

  const selected = new Set(ids);
  const result: SeasonEpisodeSelection[] = [];
  for (const season of seasons) {
    const selectable = season.episodes.filter((episode) => episode.selectable);
    // A disabled season cannot be changed through this tree. Preserve its
    // existing intent; the request modal remains the final eligibility owner.
    if (selectable.length === 0) {
      const previous = previousSelections.find(
        (selection) => selection.seasonNumber === season.seasonNumber
      );
      if (previous) result.push(previous);
      continue;
    }
    const episodes = selectable.filter((episode) => selected.has(episode.id));
    if (episodes.length === 0) continue;
    result.push({
      seasonNumber: season.seasonNumber,
      ...(episodes.length === selectable.length
        ? {}
        : { episodeNumbers: episodes.map((episode) => episode.episodeNumber) }),
    });
  }
  // The adapter must not discard intent it does not own (e.g. metadata that
  // was removed from the visible season list). No such rows are newly added.
  result.push(
    ...previousSelections.filter(
      (selection) =>
        !seasons.some(
          (season) => season.seasonNumber === selection.seasonNumber
        )
    )
  );
  return result.sort((a, b) => a.seasonNumber - b.seasonNumber);
};
