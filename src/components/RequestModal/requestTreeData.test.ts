import type { SeasonEpisodeSelection } from '@server/interfaces/api/seasonInterfaces';
import type { SeasonWithEpisodes, TvDetails } from '@server/models/Tv';
import { describe, expect, it } from 'vitest';
import {
  buildRequestTreeData,
  firstSelectableRequestEpisodeId,
  hasCompleteRequestMetadata,
  requestSelectionToTreeIds,
  treeSelectionToRequests,
} from './requestTreeData';

export const requestSeasons = [
  { seasonNumber: 2, episodeCount: 2 },
  { seasonNumber: 0, episodeCount: 1 },
  { seasonNumber: 1, episodeCount: 3 },
] as TvDetails['seasons'];
export const requestMetadata = [
  {
    seasonNumber: 0,
    episodes: [{ id: 0, episodeNumber: 1, name: 'Special', airDate: null }],
  },
  {
    seasonNumber: 1,
    episodes: [
      { id: 13, episodeNumber: 3, name: 'Third', airDate: '2026-10-02' },
      { id: 11, episodeNumber: 1, name: 'First', airDate: null },
      { id: 12, episodeNumber: 2, name: '', airDate: null },
    ],
  },
  {
    seasonNumber: 2,
    episodes: [
      { id: 21, episodeNumber: 1, name: 'Later First', airDate: null },
      { id: 22, episodeNumber: 2, name: 'Later Second', airDate: null },
    ],
  },
] as SeasonWithEpisodes[];

const build = (disabledSeasons: number[] = [], disabledEpisodes = {}) =>
  buildRequestTreeData(
    requestSeasons,
    requestMetadata,
    disabledSeasons,
    disabledEpisodes,
    { 1: [2] },
    (number) => (number === 0 ? 'Specials' : `Season ${number}`),
    'Untitled'
  );

describe('request tree payload adapter', () => {
  it('separates true library availability from eligibility and preserves source facts', () => {
    const tree = build([2], { 1: [2] });
    expect(tree.map((season) => season.seasonNumber)).toEqual([0, 1, 2]);
    expect(tree[0].name).toBe('Specials');
    expect(tree[0].episodes[0]).toMatchObject({
      id: 0,
      available: false,
      selectable: true,
    });
    expect(tree[1].episodes.map((episode) => episode.episodeNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(tree[1].episodes[1]).toMatchObject({
      name: 'Untitled',
      available: true,
      selectable: false,
    });
    expect(tree[1].episodes[2].releaseDate).toBe('2026-10-02');
    expect(tree[2].episodes.every((episode) => !episode.selectable)).toBe(true);
  });

  it('retains whole-season intent including specials and uses numbers, never row IDs', () => {
    const tree = build();
    const selections = [{ seasonNumber: 0 }, { seasonNumber: 1 }];
    const ids = requestSelectionToTreeIds(tree, selections);
    expect(ids).toEqual([0, 11, 12, 13]);
    expect(treeSelectionToRequests(tree, ids)).toEqual(selections);
    expect(treeSelectionToRequests(tree, [13, 11, 11, 999])).toEqual([
      { seasonNumber: 1, episodeNumbers: [1, 3] },
    ]);
  });

  it('supports clear/all and excludes blocked rows while preserving disabled/out-of-scope intent', () => {
    const tree = build([2], { 1: [2] });
    const preserved: SeasonEpisodeSelection[] = [
      { seasonNumber: 2 },
      { seasonNumber: 9, episodeNumbers: [5] },
    ];
    expect(treeSelectionToRequests(tree, [], preserved)).toEqual(preserved);
    expect(
      treeSelectionToRequests(tree, [0, 11, 12, 13, 21], preserved)
    ).toEqual([{ seasonNumber: 0 }, { seasonNumber: 1 }, ...preserved]);
    expect(
      requestSelectionToTreeIds(tree, [
        { seasonNumber: 1, episodeNumbers: [2] },
        { seasonNumber: 2 },
      ])
    ).toEqual([]);
  });

  it('chooses an existing selectable episode first, then the first selectable fallback', () => {
    const tree = build([2], { 1: [2] });
    expect(firstSelectableRequestEpisodeId(tree, [13, 11])).toBe(13);
    expect(firstSelectableRequestEpisodeId(tree, [12, 22])).toBe(0);
    expect(firstSelectableRequestEpisodeId(build([0, 1, 2]))).toBeUndefined();
  });

  it('keeps single-episode intent explicit even when it is the only selectable episode', () => {
    const tree = build([], { 1: [2, 3] });
    expect(treeSelectionToRequests(tree, [11], [], true)).toEqual([
      { seasonNumber: 1, episodeNumbers: [1] },
    ]);
    expect(treeSelectionToRequests(tree, [11, 13], [], true)).toEqual([
      { seasonNumber: 1, episodeNumbers: [1] },
    ]);
    expect(treeSelectionToRequests(tree, [12], [], true)).toEqual([]);
  });

  it('requires every season metadata record before editing, including zero-valued specials', () => {
    expect(hasCompleteRequestMetadata(requestSeasons)).toBe(false);
    expect(
      hasCompleteRequestMetadata(requestSeasons, requestMetadata.slice(1))
    ).toBe(false);
    expect(hasCompleteRequestMetadata(requestSeasons, requestMetadata)).toBe(
      true
    );
    expect(hasCompleteRequestMetadata([], undefined)).toBe(true);
  });
});
