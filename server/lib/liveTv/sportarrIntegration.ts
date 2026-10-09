import type {
  SportarrEpgSource,
  SportarrEpgSyncResult,
  SportarrIptvSource,
  SportarrIptvSourceTestResult,
} from '@server/api/servarr/sportarr';
import type { TunerrSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';

export const TUNERR_SPORTS_M3U_NAME = 'IPTV Tunerr Sports';
export const TUNERR_SPORTS_EPG_NAME = 'IPTV Tunerr Sports Guide';

export interface TunerrSportsFeedUrls {
  m3u: string;
  xmltv: string;
}

export interface SportarrSportsFeedApi {
  getIptvSources(): Promise<SportarrIptvSource[]>;
  testIptvM3uSource(input: {
    name: string;
    url: string;
  }): Promise<SportarrIptvSourceTestResult>;
  addIptvM3uSource(input: {
    name: string;
    url: string;
  }): Promise<SportarrIptvSource>;
  getEpgSources(): Promise<SportarrEpgSource[]>;
  addEpgSource(input: {
    name: string;
    url: string;
    iptvSourceId: number;
  }): Promise<SportarrEpgSource>;
  syncEpgSource(id: number): Promise<SportarrEpgSyncResult>;
}

export interface SportarrSportsFeedStatus {
  linked: boolean;
  source?: {
    id: number;
    name: string;
    active: boolean;
    channelCount: number;
    hasError: boolean;
  };
  guide?: {
    id: number;
    name: string;
    active: boolean;
    programCount: number;
    linkedToSource: boolean;
    hasError: boolean;
  };
}

export interface SportarrSportsFeedConnectResult {
  sourceCreated: boolean;
  guideCreated: boolean;
  source: SportarrSportsFeedStatus['source'];
  guide: SportarrSportsFeedStatus['guide'];
  sync: SportarrEpgSyncResult;
}

export class SportarrSportsFeedSetupError extends Error {
  constructor(
    message: string,
    public readonly status: 409 | 502 | 503,
    public readonly partial = false
  ) {
    super(message);
    this.name = 'SportarrSportsFeedSetupError';
  }
}

/**
 * Validates and normalizes the optional tuner base URL from Sportarr's point
 * of view. The empty string means derive it from Tunerr's existing settings.
 */
export const normalizeSportarrTunerrBaseUrl = (
  value: string
): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 1024 || trimmed.includes('\\')) return undefined;
  try {
    const parsed = new URL(trimmed);
    const authorityStart = trimmed.indexOf('://') + 3;
    const authorityEnd = trimmed.indexOf('/', authorityStart);
    const rawPath =
      authorityEnd < 0 ? '' : trimmed.slice(authorityEnd).split(/[?#]/u, 1)[0];
    const hasUnsafePathSegment = rawPath.split('/').some((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return (
          decoded === '.' ||
          decoded === '..' ||
          decoded.includes('/') ||
          decoded.includes('\\')
        );
      } catch {
        return true;
      }
    });
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      hasUnsafePathSegment
    ) {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return undefined;
  }
};

export const buildTunerrSportsFeedUrls = (
  settings: TunerrSettings
): TunerrSportsFeedUrls => {
  if (!settings.hostname) {
    throw new Error('Enter the Tunerr hostname before connecting Sportarr.');
  }
  const override = normalizeSportarrTunerrBaseUrl(
    settings.sportarrBaseUrl ?? ''
  );
  if (override === undefined) {
    throw new Error('Tunerr URL reachable from Sportarr is invalid.');
  }
  const baseUrl =
    override ||
    buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.tunerPort,
    });
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error('Tunerr URL reachable from Sportarr is invalid.');
  }
  return {
    m3u: `${baseUrl}/sports/live.m3u`,
    xmltv: `${baseUrl}/sports/guide.xml`,
  };
};

const toSafeSource = (source: SportarrIptvSource) => ({
  id: source.id,
  name: source.name,
  active: source.isActive,
  channelCount: source.channelCount,
  hasError: Boolean(source.lastError),
});

const toSafeGuide = (guide: SportarrEpgSource, linkedToSource: boolean) => ({
  id: guide.id,
  name: guide.name,
  active: guide.isActive,
  programCount: guide.programCount,
  linkedToSource,
  hasError: Boolean(guide.lastError),
});

const isSameUrl = (left: string, right: string) => {
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return false;
  }
};

export const inspectSportarrSportsFeeds = async (
  api: SportarrSportsFeedApi,
  urls: TunerrSportsFeedUrls
): Promise<SportarrSportsFeedStatus> => {
  const [sources, guides] = await Promise.all([
    api.getIptvSources(),
    api.getEpgSources(),
  ]);
  const source = sources.find(
    (candidate) =>
      candidate.type === 'M3U' && isSameUrl(candidate.url, urls.m3u)
  );
  if (!source) return { linked: false };
  const guide = guides.find(
    (candidate) =>
      isSameUrl(candidate.url, urls.xmltv) &&
      candidate.iptvSourceId === source.id
  );
  return {
    linked: Boolean(source.isActive && guide?.isActive),
    source: toSafeSource(source),
    ...(guide
      ? { guide: toSafeGuide(guide, guide.iptvSourceId === source.id) }
      : {}),
  };
};

/**
 * Adds the optional Tunerr sports feeds to Sportarr. Exact URLs make the
 * operation safe to retry after a timeout or a partial EPG failure.
 */
export const connectTunerrSportsFeeds = async (
  api: SportarrSportsFeedApi,
  urls: TunerrSportsFeedUrls
): Promise<SportarrSportsFeedConnectResult> => {
  let sources = await api.getIptvSources();
  let source = sources.find(
    (candidate) =>
      candidate.type === 'M3U' && isSameUrl(candidate.url, urls.m3u)
  );
  const conflictingSource = sources.find((candidate) =>
    isSameUrl(candidate.url, urls.m3u)
  );
  if (!source && conflictingSource) {
    throw new SportarrSportsFeedSetupError(
      'Sportarr already has this URL as a different IPTV source type. Review that source in Sportarr before connecting the Tunerr feed.',
      409
    );
  }

  let sourceCreated = false;
  if (!source) {
    const test = await api.testIptvM3uSource({
      name: TUNERR_SPORTS_M3U_NAME,
      url: urls.m3u,
    });
    if (!test.success) {
      throw new SportarrSportsFeedSetupError(
        'Sportarr could not read Tunerr’s sports playlist. Check the Tunerr URL reachable from Sportarr and try again.',
        502
      );
    }
    try {
      source = await api.addIptvM3uSource({
        name: TUNERR_SPORTS_M3U_NAME,
        url: urls.m3u,
      });
      sourceCreated = true;
    } catch (error) {
      // A source may have been created even if the response was lost, or a
      // concurrent admin click may have completed the same operation.
      sources = await api.getIptvSources();
      source = sources.find(
        (candidate) =>
          candidate.type === 'M3U' && isSameUrl(candidate.url, urls.m3u)
      );
      if (!source) throw error;
    }
  }
  if (!source) {
    throw new Error('Sportarr did not return the Tunerr playlist source.');
  }

  const guides = await api.getEpgSources();
  let guide = guides.find((candidate) => isSameUrl(candidate.url, urls.xmltv));
  if (guide && guide.iptvSourceId !== source.id) {
    throw new SportarrSportsFeedSetupError(
      'Sportarr already has this XMLTV URL without a link to the Tunerr playlist. Link it to the Tunerr source in Sportarr, or remove the duplicate guide before retrying.',
      409,
      sourceCreated
    );
  }

  let guideCreated = false;
  if (!guide) {
    try {
      guide = await api.addEpgSource({
        name: TUNERR_SPORTS_EPG_NAME,
        url: urls.xmltv,
        iptvSourceId: source.id,
      });
      guideCreated = true;
    } catch {
      const refreshed = await api
        .getEpgSources()
        .catch(() => [] as SportarrEpgSource[]);
      guide = refreshed.find(
        (candidate) =>
          isSameUrl(candidate.url, urls.xmltv) &&
          candidate.iptvSourceId === source.id
      );
      if (guide) {
        // The create response may have been lost after Sportarr saved it.
      } else {
        throw new SportarrSportsFeedSetupError(
          'Sportarr added or reused the Tunerr playlist, but could not add its XMLTV guide. The playlist remains in Sportarr; correct the feed setup and retry.',
          502,
          true
        );
      }
    }
  }

  let sync: SportarrEpgSyncResult;
  try {
    sync = await api.syncEpgSource(guide.id);
  } catch {
    throw new SportarrSportsFeedSetupError(
      'The Tunerr playlist and guide are linked in Sportarr, but the guide sync did not complete. The setup is preserved; retry to sync again.',
      502,
      sourceCreated || guideCreated
    );
  }
  if (!sync.success) {
    throw new SportarrSportsFeedSetupError(
      'The Tunerr playlist and guide are linked in Sportarr, but Sportarr could not import the guide. The setup is preserved; check that Sportarr can reach the XMLTV URL, then retry.',
      502,
      sourceCreated || guideCreated
    );
  }

  return {
    sourceCreated,
    guideCreated,
    source: toSafeSource(source),
    guide: toSafeGuide(guide, guide.iptvSourceId === source.id),
    sync,
  };
};
