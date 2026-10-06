import TunerrAPI, {
  TunerrError,
  type TunerrRecordingRule,
  type TunerrRuleHistoryMatch,
} from '@server/api/tunerr';
import { getRepository } from '@server/datasource';
import RecordingRequest, {
  ACTIVE_RECORDING_STATUSES,
  type RecordingRequestKind,
} from '@server/entity/RecordingRequest';
import type { User } from '@server/entity/User';
import {
  findProgrammeInSnapshot,
  guideIndex,
  normalizeGuideTitle,
} from '@server/lib/liveTv/guideIndex';
import { Permission } from '@server/lib/permissions';
import { getSettings, type TunerrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In, IsNull } from 'typeorm';

/** Start-time tolerance for matching one airing. */
const AIRING_START_TOLERANCE_MS = 2 * 60 * 1000;
/** How long after an airing ends SeerrNG waits for Tunerr to finish. */
const AIRING_FINISH_GRACE_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_RECORDINGS_PER_USER = 25;

export class RecordingRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 502 | 503
  ) {
    super(message);
    this.name = 'RecordingRequestError';
  }
}

export const tunerrRuleId = (requestId: number) => `seerrng-${requestId}`;

export const isTunerrConfigured = (
  settings: TunerrSettings = getSettings().tunerr
) => settings.enabled && !!settings.hostname;

/** Builds the Tunerr rule for a request. Exposed for tests. */
export const buildTunerrRule = (
  request: Pick<
    RecordingRequest,
    'id' | 'kind' | 'title' | 'channelId' | 'startsAt'
  >
): TunerrRecordingRule => {
  const rule: TunerrRecordingRule = {
    id: tunerrRuleId(request.id),
    name: `SeerrNG #${request.id}: ${request.title}`.slice(0, 200),
    enabled: true,
    title_equals: [request.title],
    // Older Tunerr versions ignore title_equals; this keeps any accidental
    // match narrow. SeerrNG refuses to schedule against those versions.
    title_contains: [request.title],
  };
  if (request.channelId) {
    rule.include_guide_numbers = [request.channelId];
  }
  if (request.kind === 'airing' && request.startsAt) {
    const start = new Date(request.startsAt).getTime();
    rule.start_after = new Date(
      start - AIRING_START_TOLERANCE_MS
    ).toISOString();
    rule.start_before = new Date(
      start + AIRING_START_TOLERANCE_MS
    ).toISOString();
  }
  return rule;
};

export interface RecordingStatusUpdate {
  status?: RecordingRequest['status'];
  completedCount: number;
  failedCount: number;
  lastError?: string | null;
  removeRule: boolean;
}

/**
 * Decides the next status from Tunerr's per-rule history. Exposed for tests.
 */
export const nextRecordingStatus = (
  request: Pick<RecordingRequest, 'kind' | 'status' | 'endsAt'>,
  match: TunerrRuleHistoryMatch | undefined,
  now: Date
): RecordingStatusUpdate => {
  const completedCount = match?.completed_count ?? 0;
  const failedCount = match?.failed_count ?? 0;
  const active = (match?.active_count ?? 0) > 0;

  if (request.kind === 'series') {
    return {
      status: active ? 'recording' : 'scheduled',
      completedCount,
      failedCount,
      removeRule: false,
    };
  }

  if (completedCount > 0 && !active) {
    return {
      status: 'completed',
      completedCount,
      failedCount,
      lastError: null,
      removeRule: true,
    };
  }
  if (active) {
    return {
      status: 'recording',
      completedCount,
      failedCount,
      removeRule: false,
    };
  }
  const endsAt = request.endsAt ? new Date(request.endsAt).getTime() : 0;
  if (endsAt && now.getTime() > endsAt + AIRING_FINISH_GRACE_MS) {
    return {
      status: 'failed',
      completedCount,
      failedCount,
      lastError:
        failedCount > 0
          ? 'Tunerr could not record this airing.'
          : 'Tunerr did not record this airing. Check that its recorder is running with recording rules enabled.',
      removeRule: true,
    };
  }
  return {
    status: request.status,
    completedCount,
    failedCount,
    removeRule: false,
  };
};

const canAutoApprove = (user: User) =>
  user.hasPermission([Permission.MANAGE_REQUESTS, Permission.AUTO_APPROVE], {
    type: 'or',
  });

export interface CreateRecordingInput {
  kind: RecordingRequestKind;
  title: string;
  channel?: string;
  start?: string;
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
}

const apiFor = () => new TunerrAPI(getSettings().tunerr);

const ensureTunerrSupportsRules = async (api: TunerrAPI) => {
  const ruleset = await api.getRules();
  const missing = api.missingFeatures(ruleset);
  if (missing.length > 0) {
    throw new RecordingRequestError(
      `This Tunerr version cannot record SeerrNG requests (missing: ${missing.join(', ')}). Update Tunerr.`,
      503
    );
  }
};

/** Creates the Tunerr rule and marks the request scheduled. */
export const scheduleRecording = async (
  request: RecordingRequest,
  approver: User
): Promise<RecordingRequest> => {
  const api = apiFor();
  try {
    await ensureTunerrSupportsRules(api);
    const rule = buildTunerrRule(request);
    await api.upsertRule(rule);
    request.tunerrRuleId = rule.id;
    request.status = 'scheduled';
    request.lastError = null;
  } catch (error) {
    if (error instanceof RecordingRequestError) throw error;
    throw new RecordingRequestError(
      error instanceof TunerrError
        ? error.message
        : 'Tunerr could not be reached to schedule the recording.',
      502
    );
  }
  request.modifiedBy = approver;
  return getRepository(RecordingRequest).save(request);
};

export const createRecordingRequest = async (
  user: User,
  input: CreateRecordingInput
): Promise<RecordingRequest> => {
  if (!isTunerrConfigured()) {
    throw new RecordingRequestError('Live TV recording is not set up.', 404);
  }
  const snapshot = await guideIndex.get();
  if (!snapshot) {
    throw new RecordingRequestError(
      'The Live TV guide is not available yet. Try again shortly.',
      503
    );
  }

  const repository = getRepository(RecordingRequest);
  const activeCount = await repository.count({
    where: {
      requestedById: user.id,
      status: In(ACTIVE_RECORDING_STATUSES),
    },
  });
  if (activeCount >= MAX_ACTIVE_RECORDINGS_PER_USER) {
    throw new RecordingRequestError(
      `You can have up to ${MAX_ACTIVE_RECORDINGS_PER_USER} active recordings.`,
      409
    );
  }

  const request = new RecordingRequest({
    requestedBy: user,
    requestedById: user.id,
    kind: input.kind,
    status: 'pending',
    mediaType: input.mediaType ?? null,
    tmdbId: input.tmdbId ?? null,
  });

  if (input.kind === 'airing') {
    const start = input.start ? new Date(input.start) : undefined;
    if (!input.channel || !start || Number.isNaN(start.getTime())) {
      throw new RecordingRequestError('Choose an airing to record.', 400);
    }
    const programme = findProgrammeInSnapshot(snapshot, input.channel, start);
    if (!programme || programme.stop <= new Date()) {
      throw new RecordingRequestError(
        'That airing is no longer in the guide.',
        404
      );
    }
    Object.assign(request, {
      title: programme.title,
      subTitle: programme.subTitle ?? null,
      channelId: programme.channel,
      channelName: snapshot.channelNames.get(programme.channel) ?? null,
      startsAt: programme.start,
      endsAt: programme.stop,
    });
  } else {
    const key = normalizeGuideTitle(input.title);
    const airings = snapshot.byTitle.get(key) ?? [];
    if (!key || airings.length === 0) {
      throw new RecordingRequestError(
        'That title is not in the Live TV guide.',
        404
      );
    }
    const channel = input.channel?.trim() || null;
    if (channel && !airings.some((airing) => airing.channel === channel)) {
      throw new RecordingRequestError(
        'That title does not air on the chosen channel.',
        400
      );
    }
    Object.assign(request, {
      // Use the guide's own spelling so Tunerr's exact match succeeds.
      title: airings[0].title,
      channelId: channel,
      channelName: channel
        ? (snapshot.channelNames.get(channel) ?? null)
        : null,
    });
  }

  const duplicate = await repository.findOne({
    where: {
      requestedById: user.id,
      kind: request.kind,
      title: request.title,
      channelId: request.channelId ?? IsNull(),
      status: In(ACTIVE_RECORDING_STATUSES),
      startsAt: request.startsAt ?? IsNull(),
    },
  });
  if (duplicate) {
    throw new RecordingRequestError(
      'You already requested this recording.',
      409
    );
  }

  const saved = await repository.save(request);
  if (canAutoApprove(user)) {
    try {
      return await scheduleRecording(saved, user);
    } catch (error) {
      saved.lastError =
        error instanceof Error ? error.message.slice(0, 500) : null;
      await repository.save(saved);
      throw error;
    }
  }
  return saved;
};

export const declineRecording = async (
  request: RecordingRequest,
  manager: User
) => {
  if (request.status !== 'pending') {
    throw new RecordingRequestError(
      'Only pending recordings can be declined.',
      409
    );
  }
  request.status = 'declined';
  request.modifiedBy = manager;
  return getRepository(RecordingRequest).save(request);
};

export const cancelRecording = async (
  request: RecordingRequest,
  user: User
) => {
  if (!ACTIVE_RECORDING_STATUSES.includes(request.status)) {
    throw new RecordingRequestError('This recording is no longer active.', 409);
  }
  if (request.tunerrRuleId) {
    try {
      await apiFor().deleteRule(request.tunerrRuleId);
    } catch (error) {
      throw new RecordingRequestError(
        error instanceof TunerrError
          ? error.message
          : 'Tunerr could not be reached to cancel the recording.',
        502
      );
    }
  }
  request.status = 'cancelled';
  request.modifiedBy = user;
  return getRepository(RecordingRequest).save(request);
};

let syncing = false;

/**
 * Updates scheduled recordings from Tunerr's rule history, re-creates rules
 * removed in Tunerr, and removes rules for finished single airings.
 */
export const syncRecordings = async (): Promise<void> => {
  if (syncing || !isTunerrConfigured()) return;
  syncing = true;
  try {
    const repository = getRepository(RecordingRequest);
    const requests = await repository.find({
      where: { status: In(['scheduled', 'recording']) },
    });
    if (requests.length === 0) return;

    const api = apiFor();
    const [ruleset, history] = await Promise.all([
      api.getRules(),
      api.getRuleHistory(),
    ]);
    const ruleIds = new Set(ruleset.rules.map((rule) => rule.id));
    const now = new Date();

    for (const request of requests) {
      const ruleId = request.tunerrRuleId ?? tunerrRuleId(request.id);
      const match = history.matches.find((entry) => entry.rule_id === ruleId);
      const update = nextRecordingStatus(request, match, now);

      if (!update.removeRule && !ruleIds.has(ruleId)) {
        await api.upsertRule(buildTunerrRule(request));
      }
      if (update.removeRule && ruleIds.has(ruleId)) {
        await api.deleteRule(ruleId);
      }

      request.status = update.status ?? request.status;
      request.completedCount = update.completedCount;
      request.failedCount = update.failedCount;
      if (update.lastError !== undefined) request.lastError = update.lastError;
      request.lastCheckedAt = now;
      await repository.save(request);
    }
  } catch (error) {
    logger.warn('Live TV recording sync failed', {
      label: 'Live TV',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    syncing = false;
  }
};
