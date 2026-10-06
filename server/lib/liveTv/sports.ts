import TunerrAPI, { type TunerrSportsReport } from '@server/api/tunerr';
import { getRepository } from '@server/datasource';
import RecordingRequest from '@server/entity/RecordingRequest';
import SportsFollow from '@server/entity/SportsFollow';
import { User } from '@server/entity/User';
import {
  findProgrammeNear,
  guideIndex,
  type GuideSnapshot,
} from '@server/lib/liveTv/guideIndex';
import {
  createRecordingRequest,
  isTunerrConfigured,
  RecordingRequestError,
} from '@server/lib/liveTv/recordings';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/** How far a guide airing may start from the scheduled game time. */
const GAME_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface SportsTeam {
  dataset: string;
  league?: string;
  team: string;
}

const teamKey = (dataset: string, team: string) =>
  `${dataset.toLowerCase()}|${team.trim().toLowerCase()}`;

/** Teams seen in Tunerr's sports schedule, for the follow picker. */
export const listSportsTeams = (report: TunerrSportsReport): SportsTeam[] => {
  const teams = new Map<string, SportsTeam>();
  for (const { event } of report.events) {
    for (const team of [event.home_team, event.away_team]) {
      if (!team?.trim() || !event.dataset) continue;
      const key = teamKey(event.dataset, team);
      if (!teams.has(key)) {
        teams.set(key, {
          dataset: event.dataset,
          league: event.league,
          team: team.trim(),
        });
      }
    }
  }
  return [...teams.values()].sort(
    (a, b) => a.dataset.localeCompare(b.dataset) || a.team.localeCompare(b.team)
  );
};

export interface PlannedGameRecording {
  eventId: string;
  channel: string;
  start: string;
  title: string;
}

/**
 * Upcoming games for the followed teams that Tunerr matched to a channel,
 * resolved to the exact guide airing SeerrNG can request. Exposed for tests.
 */
export const planGameRecordings = (
  report: TunerrSportsReport,
  follows: Pick<SportsFollow, 'dataset' | 'team'>[],
  snapshot: GuideSnapshot,
  now: Date
): PlannedGameRecording[] => {
  const followed = new Set(
    follows.map((follow) => teamKey(follow.dataset, follow.team))
  );
  const planned: PlannedGameRecording[] = [];
  for (const { event, matched, channels } of report.events) {
    if (!matched || !channels?.length) continue;
    const isFollowed = [event.home_team, event.away_team].some((team) =>
      followed.has(teamKey(event.dataset, team ?? ''))
    );
    if (!isFollowed) continue;
    const startsAt = new Date(event.starts_at);
    if (Number.isNaN(startsAt.getTime())) continue;
    for (const channel of channels) {
      if (!channel.source_guide_number || !channel.source_programme) continue;
      const programme = findProgrammeNear(
        snapshot,
        channel.source_guide_number,
        channel.source_programme,
        startsAt,
        GAME_MATCH_WINDOW_MS
      );
      if (!programme || programme.stop <= now) continue;
      planned.push({
        eventId: event.id,
        channel: programme.channel,
        start: programme.start.toISOString(),
        title: programme.title,
      });
      // One airing per game is enough.
      break;
    }
  }
  return planned;
};

let syncing = false;

/**
 * Requests recordings of followed teams' games. A game the user already
 * requested in any state (including cancelled) is not requested again.
 */
export const syncSportsFollows = async (): Promise<void> => {
  if (syncing || !isTunerrConfigured()) return;
  syncing = true;
  try {
    const follows = await getRepository(SportsFollow).find();
    if (follows.length === 0) return;
    const snapshot = await guideIndex.get();
    if (!snapshot) return;
    const report = await new TunerrAPI(getSettings().tunerr).getSportsReport();
    const now = new Date();

    const byUser = new Map<number, SportsFollow[]>();
    for (const follow of follows) {
      byUser.set(follow.userId, [...(byUser.get(follow.userId) ?? []), follow]);
    }

    for (const [userId, userFollows] of byUser) {
      const user = await getRepository(User).findOne({ where: { id: userId } });
      if (!user?.hasPermission(Permission.REQUEST)) continue;
      for (const game of planGameRecordings(
        report,
        userFollows,
        snapshot,
        now
      )) {
        const existing = await getRepository(RecordingRequest).findOne({
          where: {
            requestedById: userId,
            channelId: game.channel,
            startsAt: new Date(game.start),
          },
        });
        if (existing) continue;
        try {
          await createRecordingRequest(user, {
            kind: 'airing',
            title: game.title,
            channel: game.channel,
            start: game.start,
          });
        } catch (error) {
          if (!(error instanceof RecordingRequestError)) throw error;
          logger.debug('Skipped a followed-team recording', {
            label: 'Live TV',
            userId,
            eventId: game.eventId,
            reason: error.message,
          });
        }
      }
    }
  } catch (error) {
    logger.warn('Followed-team recording sync failed', {
      label: 'Live TV',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    syncing = false;
  }
};
