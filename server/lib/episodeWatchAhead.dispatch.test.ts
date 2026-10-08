import JellyfinAPI, { type JellyfinSession } from '@server/api/jellyfin';
import SonarrAPI from '@server/api/servarr/sonarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import episodeWatchAhead, {
  getCompletedWatchAheadProgress,
} from './episodeWatchAhead';

setupTestDb();

describe('Episode Queue playback reconciliation', () => {
  let restoreSettings: (() => void) | undefined;

  beforeEach(() => {
    const settings = getSettings();
    const originalMain = { ...settings.main };
    const originalJellyfin = { ...settings.jellyfin };
    const originalSonarr = settings.sonarr;
    restoreSettings = () => {
      Object.assign(settings.main, originalMain);
      Object.assign(settings.jellyfin, originalJellyfin);
      settings.sonarr = originalSonarr;
    };

    settings.main.mediaServerType = MediaServerType.JELLYFIN;
    settings.jellyfin.ip = 'localhost';
    settings.jellyfin.port = 8096;
    settings.jellyfin.apiKey = 'test-jellyfin-key';
    settings.sonarr = [
      {
        id: 7,
        name: 'Test Sonarr',
        hostname: 'sonarr.test',
        port: 8989,
        apiKey: 'test-sonarr-key',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'HD',
        activeDirectory: '/tv',
        tags: [],
        is4k: false,
        isDefault: true,
        seriesType: 'standard',
        animeSeriesType: 'standard',
        enableSeasonFolders: true,
        monitorNewItems: 'all',
        syncEnabled: false,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];
  });

  afterEach(() => {
    mock.restoreAll();
    restoreSettings?.();
  });

  it('queues the requested number of missing episodes after linked-user playback reaches 90%', async () => {
    const requestedBy = await getRepository(User).findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    requestedBy.jellyfinUserId = '01234567-89ab-cdef-0123-456789abcdef';
    requestedBy.jellyfinUsername = 'friend';
    await getRepository(User).save(requestedBy);

    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 765432,
        tvdbId: 123456,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const parent = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.TV,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy,
        is4k: false,
        serverId: 7,
        watchAheadEpisodeCount: 2,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            episodeNumbers: [1],
            status: MediaRequestStatus.APPROVED,
          }),
        ],
      })
    );
    const requestTable = dataSource.getMetadata(MediaRequest).tableName;
    await dataSource.query(
      `UPDATE "${requestTable}" SET "status" = ? WHERE "id" = ?`,
      [MediaRequestStatus.APPROVED, parent.id]
    );

    const episode = {
      Id: 'jellyfin-episode-1',
      Name: 'Episode 1',
      Type: 'Episode',
      HasSubtitles: false,
      LocationType: 'FileSystem',
      MediaType: 'Video',
      ParentIndexNumber: 1,
      IndexNumber: 1,
      SeriesId: 'jellyfin-series',
      RunTimeTicks: 2_400_000_000_000,
      ProviderIds: {},
    };
    const session = {
      Id: 'session-1',
      UserId: requestedBy.jellyfinUserId,
      DeviceName: 'Living room',
      Client: 'Jellyfin',
      IsActive: true,
      SupportsMediaControl: true,
      SupportsRemoteControl: true,
      PlayableMediaTypes: ['Video'],
      SupportedCommands: [],
      NowPlayingItem: episode,
      PlayState: {
        PositionTicks: 2_160_000_000_000,
        IsPaused: false,
      },
    } as unknown as JellyfinSession;

    let playbackSessionReads = 0;
    const playbackItemReads: string[] = [];
    mock.method(JellyfinAPI.prototype, 'getPlaybackSessions', async () => {
      playbackSessionReads += 1;
      return [session];
    });
    mock.method(
      JellyfinAPI.prototype,
      'getUserPlaybackItem',
      async (_userId: string, itemId: string) => {
        playbackItemReads.push(itemId);
        return itemId === episode.Id
          ? {
              ...episode,
              UserData: { Played: true },
            }
          : {
              Id: itemId,
              Name: 'Test Show',
              Type: 'Series',
              ProviderIds: { Tvdb: '123456' },
            };
      }
    );
    mock.method(
      SonarrAPI.prototype,
      'getLibrarySeriesByTvdbId',
      async () =>
        [
          {
            id: 55,
            title: 'Test Show',
            tvdbId: 123456,
          },
        ] as Awaited<ReturnType<SonarrAPI['getLibrarySeriesByTvdbId']>>
    );
    mock.method(
      SonarrAPI.prototype,
      'getEpisodes',
      async () =>
        [1, 2, 3, 4].map((episodeNumber) => ({
          seasonNumber: 1,
          episodeNumber,
          hasFile: false,
          monitored: false,
        })) as Awaited<ReturnType<SonarrAPI['getEpisodes']>>
    );

    assert.deepEqual(
      getCompletedWatchAheadProgress(session, {
        ...episode,
        UserData: { Played: true },
      } as never),
      { seasonNumber: 1, episodeNumber: 1 }
    );
    await episodeWatchAhead.run();

    assert.equal(playbackSessionReads, 1);
    assert.deepEqual(playbackItemReads, [episode.Id, 'jellyfin-series']);

    const parentAfter = await getRepository(MediaRequest).findOneByOrFail({
      id: parent.id,
    });
    assert.equal(parentAfter.watchAheadLastSeason, 1);
    assert.equal(parentAfter.watchAheadLastEpisode, 1);
    assert.ok(parentAfter.watchAheadLastReconciledAt);

    const queuedRequests = await getRepository(MediaRequest).find({
      where: { watchAheadParent: { id: parent.id } },
      relations: { seasons: true },
    });
    assert.equal(queuedRequests.length, 1);
    assert.equal(queuedRequests[0].status, MediaRequestStatus.APPROVED);
    assert.deepEqual(
      queuedRequests[0].seasons.map((season) => ({
        seasonNumber: season.seasonNumber,
        episodeNumbers: season.episodeNumbers,
      })),
      [{ seasonNumber: 1, episodeNumbers: [2, 3] }]
    );
  });
});
