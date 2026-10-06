/**
 * Streaming XMLTV reader for IPTV Tunerr guides. Only the fields SeerrNG
 * needs for airing lookups are kept, and only for programmes inside the
 * requested window, so large guides do not have to fit in memory as a DOM.
 */

export interface GuideChannel {
  /** XMLTV channel ID. In Tunerr's guide this is the guide number. */
  id: string;
  name: string;
}

export interface GuideProgramme {
  channel: string;
  start: Date;
  stop: Date;
  title: string;
  subTitle?: string;
  categories: string[];
  season?: number;
  episode?: number;
}

export interface XmltvParseLimits {
  windowStart: Date;
  windowEnd: Date;
  /** Programmes kept after the window filter. */
  maxProgrammes: number;
  /** Elements larger than this are skipped rather than buffered. */
  maxElementBytes: number;
}

export const DEFAULT_XMLTV_LIMITS = {
  maxProgrammes: 500_000,
  maxElementBytes: 256 * 1024,
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export const decodeXmlText = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();

const readAttributes = (openTag: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(openTag))) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? '');
  }
  return attributes;
};

const childTexts = (element: string, tag: string): string[] => {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(element))) {
    const text = decodeXmlText(match[1]);
    if (text) values.push(text);
  }
  return values;
};

/** Parses `YYYYMMDDhhmmss +zzzz` (seconds and offset optional). */
export const parseXmltvTime = (value: string | undefined): Date | undefined => {
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?$/.exec(
      value?.trim() ?? ''
    );
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, offset] = match;
  const offsetText =
    !offset || offset === 'Z'
      ? 'Z'
      : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${offsetText}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** xmltv_ns episode numbers are zero-based: `season.episode.part`. */
export const parseXmltvNs = (
  value: string | undefined
): { season?: number; episode?: number } => {
  const [seasonPart, episodePart] = (value ?? '').split('.');
  const parse = (part: string | undefined) => {
    const number = parseInt((part ?? '').split('/')[0].trim(), 10);
    return Number.isInteger(number) && number >= 0 ? number + 1 : undefined;
  };
  return { season: parse(seasonPart), episode: parse(episodePart) };
};

const parseProgramme = (element: string): GuideProgramme | undefined => {
  const openEnd = element.indexOf('>');
  const attributes = readAttributes(element.slice(0, openEnd));
  const start = parseXmltvTime(attributes.start);
  const stop = parseXmltvTime(attributes.stop);
  const channel = attributes.channel?.trim();
  const [title] = childTexts(element, 'title');
  if (!start || !stop || !channel || !title || stop <= start) {
    return undefined;
  }
  const [subTitle] = childTexts(element, 'sub-title');
  const nsMatch =
    /<episode-num[^>]*system\s*=\s*["']xmltv_ns["'][^>]*>([\s\S]*?)<\/episode-num>/.exec(
      element
    );
  const { season, episode } = parseXmltvNs(
    nsMatch ? decodeXmlText(nsMatch[1]) : undefined
  );
  return {
    channel,
    start,
    stop,
    title: title.slice(0, 512),
    subTitle: subTitle?.slice(0, 512),
    categories: childTexts(element, 'category').slice(0, 16),
    season,
    episode,
  };
};

const parseChannel = (element: string): GuideChannel | undefined => {
  const openEnd = element.indexOf('>');
  const id = readAttributes(element.slice(0, openEnd)).id?.trim();
  if (!id) return undefined;
  const [name] = childTexts(element, 'display-name');
  return { id, name: (name ?? id).slice(0, 255) };
};

export interface XmltvParseResult {
  channels: GuideChannel[];
  programmes: GuideProgramme[];
  /** Programmes dropped because `maxProgrammes` was reached. */
  truncated: boolean;
}

/**
 * Incremental parser. Feed text with `push`, then call `finish`. Elements are
 * located by their tags, which is sufficient for XMLTV's flat structure.
 */
export class XmltvStreamParser {
  private buffer = '';
  private readonly channels: GuideChannel[] = [];
  private readonly programmes: GuideProgramme[] = [];
  private truncated = false;

  constructor(private readonly limits: XmltvParseLimits) {}

  public push(chunk: string): void {
    this.buffer += chunk;
    this.drain();
  }

  public finish(): XmltvParseResult {
    this.drain();
    this.buffer = '';
    return {
      channels: this.channels,
      programmes: this.programmes,
      truncated: this.truncated,
    };
  }

  private drain(): void {
    for (;;) {
      const programmeAt = this.buffer.indexOf('<programme');
      const channelAt = this.buffer.indexOf('<channel');
      const candidates = [programmeAt, channelAt].filter((index) => index >= 0);
      if (candidates.length === 0) {
        // Keep a short tail in case a start tag is split across chunks.
        this.buffer = this.buffer.slice(-16);
        return;
      }
      const start = Math.min(...candidates);
      const tag = start === programmeAt ? 'programme' : 'channel';
      const afterName = this.buffer[start + tag.length + 1];
      if (afterName === undefined) {
        this.buffer = this.buffer.slice(start);
        return;
      }
      if (!/[\s>/]/.test(afterName)) {
        // e.g. `<channels`: not an element we read.
        this.buffer = this.buffer.slice(start + tag.length + 1);
        continue;
      }

      const closeTag = `</${tag}>`;
      const end = this.buffer.indexOf(closeTag, start);
      if (end < 0) {
        if (this.buffer.length - start > this.limits.maxElementBytes) {
          // Oversized or malformed element: skip past its start tag.
          this.buffer = this.buffer.slice(start + tag.length + 1);
          continue;
        }
        this.buffer = this.buffer.slice(start);
        return;
      }

      const element = this.buffer.slice(start, end + closeTag.length);
      this.buffer = this.buffer.slice(end + closeTag.length);
      if (element.length > this.limits.maxElementBytes) continue;

      if (tag === 'channel') {
        const channel = parseChannel(element);
        if (channel) this.channels.push(channel);
        continue;
      }
      const programme = parseProgramme(element);
      if (
        !programme ||
        programme.stop <= this.limits.windowStart ||
        programme.start >= this.limits.windowEnd
      ) {
        continue;
      }
      if (this.programmes.length >= this.limits.maxProgrammes) {
        this.truncated = true;
        continue;
      }
      this.programmes.push(programme);
    }
  }
}

export const parseXmltv = (
  text: string,
  limits: XmltvParseLimits
): XmltvParseResult => {
  const parser = new XmltvStreamParser(limits);
  parser.push(text);
  return parser.finish();
};
