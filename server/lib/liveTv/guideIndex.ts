import TunerrAPI, { MAX_GUIDE_BYTES } from '@server/api/tunerr';
import {
  DEFAULT_XMLTV_LIMITS,
  type GuideProgramme,
  XmltvStreamParser,
} from '@server/lib/liveTv/xmltv';
import { getSettings, type TunerrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export interface Airing {
  channel: string;
  channelName: string;
  start: string;
  stop: string;
  title: string;
  subTitle?: string;
  season?: number;
  episode?: number;
  categories: string[];
}

/**
 * Normalizes a title for matching guide rows to catalog titles: case,
 * accents, punctuation, a leading "The", and a trailing "(1999)" year are
 * ignored; "&" matches "and".
 */
export const normalizeGuideTitle = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(\s*\d{4}\s*\)\s*$/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');

export interface GuideSnapshot {
  refreshedAt: Date;
  windowEnd: Date;
  programmeCount: number;
  channelCount: number;
  truncated: boolean;
  byTitle: Map<string, GuideProgramme[]>;
  channelNames: Map<string, string>;
}

export const buildGuideSnapshot = (
  programmes: GuideProgramme[],
  channels: { id: string; name: string }[],
  refreshedAt: Date,
  windowEnd: Date,
  truncated: boolean
): GuideSnapshot => {
  const byTitle = new Map<string, GuideProgramme[]>();
  for (const programme of programmes) {
    const key = normalizeGuideTitle(programme.title);
    if (!key) continue;
    const list = byTitle.get(key);
    if (list) list.push(programme);
    else byTitle.set(key, [programme]);
  }
  for (const list of byTitle.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return {
    refreshedAt,
    windowEnd,
    programmeCount: programmes.length,
    channelCount: channels.length,
    truncated,
    byTitle,
    channelNames: new Map(
      channels.map((channel) => [channel.id, channel.name])
    ),
  };
};

export const findAiringsInSnapshot = (
  snapshot: GuideSnapshot,
  titles: string[],
  now: Date,
  limit: number
): Airing[] => {
  const keys = new Set(titles.map(normalizeGuideTitle).filter(Boolean));
  const seen = new Set<string>();
  const found: GuideProgramme[] = [];
  for (const key of keys) {
    for (const programme of snapshot.byTitle.get(key) ?? []) {
      if (programme.stop <= now) continue;
      const identity = `${programme.channel}|${programme.start.toISOString()}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      found.push(programme);
    }
  }
  return found
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit)
    .map((programme) => ({
      channel: programme.channel,
      channelName:
        snapshot.channelNames.get(programme.channel) ?? programme.channel,
      start: programme.start.toISOString(),
      stop: programme.stop.toISOString(),
      title: programme.title,
      subTitle: programme.subTitle,
      season: programme.season,
      episode: programme.episode,
      categories: programme.categories,
    }));
};

/** Finds one exact guide row, used to validate recording requests. */
export const findProgrammeInSnapshot = (
  snapshot: GuideSnapshot,
  channel: string,
  start: Date
): GuideProgramme | undefined => {
  for (const list of snapshot.byTitle.values()) {
    for (const programme of list) {
      if (
        programme.channel === channel &&
        programme.start.getTime() === start.getTime()
      ) {
        return programme;
      }
    }
  }
  return undefined;
};

export const readGuideStream = async (
  stream: Readable,
  now: Date,
  hours: number
): Promise<GuideSnapshot> => {
  const windowEnd = new Date(now.getTime() + hours * 3600_000);
  const parser = new XmltvStreamParser({
    windowStart: now,
    windowEnd,
    ...DEFAULT_XMLTV_LIMITS,
  });
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_GUIDE_BYTES) {
      stream.destroy();
      throw new Error('The Tunerr guide is larger than SeerrNG accepts.');
    }
    parser.push(decoder.write(buffer));
  }
  parser.push(decoder.end());
  const result = parser.finish();
  return buildGuideSnapshot(
    result.programmes,
    result.channels,
    now,
    windowEnd,
    result.truncated
  );
};

const STALE_AFTER_MS = 30 * 60 * 1000;

class GuideIndex {
  private snapshot?: GuideSnapshot;
  private refreshing?: Promise<GuideSnapshot | undefined>;
  private lastError?: string;
  private sourceKey = '';

  public status() {
    return {
      ready: !!this.snapshot,
      refreshedAt: this.snapshot?.refreshedAt.toISOString(),
      programmeCount: this.snapshot?.programmeCount ?? 0,
      channelCount: this.snapshot?.channelCount ?? 0,
      truncated: this.snapshot?.truncated ?? false,
      lastError: this.lastError,
    };
  }

  public clear(): void {
    this.snapshot = undefined;
    this.lastError = undefined;
  }

  /** Returns the current snapshot, refreshing it when stale. */
  public async get(
    settings: TunerrSettings = getSettings().tunerr
  ): Promise<GuideSnapshot | undefined> {
    if (!settings.enabled || !settings.hostname) return undefined;
    const key = JSON.stringify([
      settings.hostname,
      settings.tunerPort,
      settings.useSsl,
      settings.guideUrl,
      settings.guideHours,
    ]);
    if (key !== this.sourceKey) {
      this.sourceKey = key;
      this.snapshot = undefined;
    }
    const fresh =
      this.snapshot &&
      Date.now() - this.snapshot.refreshedAt.getTime() < STALE_AFTER_MS;
    if (fresh) return this.snapshot;
    const pending = this.refresh(settings);
    // Serve a stale snapshot while refreshing instead of blocking the page.
    return this.snapshot ?? pending;
  }

  public refresh(
    settings: TunerrSettings = getSettings().tunerr
  ): Promise<GuideSnapshot | undefined> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const stream = await new TunerrAPI(settings).openGuide();
        const snapshot = await readGuideStream(
          stream,
          new Date(),
          Math.min(14 * 24, Math.max(6, settings.guideHours))
        );
        this.snapshot = snapshot;
        this.lastError = undefined;
        logger.debug('Live TV guide refreshed', {
          label: 'Live TV',
          programmes: snapshot.programmeCount,
          channels: snapshot.channelCount,
        });
        return snapshot;
      } catch (error) {
        this.lastError =
          error instanceof Error ? error.message : 'Guide refresh failed.';
        logger.warn('Live TV guide refresh failed', {
          label: 'Live TV',
          errorMessage: this.lastError,
        });
        return this.snapshot;
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }
}

export const guideIndex = new GuideIndex();
