import type { TunerrSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { Readable } from 'node:stream';

/**
 * Recording-rule features SeerrNG requires. Tunerr versions without them
 * ignore the exact-title and time-window fields, and their recorder does not
 * follow rules, so SeerrNG does not create recordings against them.
 */
export const REQUIRED_TUNERR_RULE_FEATURES = [
  'title_equals',
  'start_window',
  'rules_only_recorder',
] as const;

export interface TunerrRecordingRule {
  id: string;
  name: string;
  enabled: boolean;
  include_guide_numbers?: string[];
  include_channel_ids?: string[];
  title_contains?: string[];
  title_equals?: string[];
  start_after?: string;
  start_before?: string;
}

export interface TunerrRecordingRuleset {
  version?: number;
  updated_at?: string;
  rules: TunerrRecordingRule[];
  features?: string[];
}

export interface TunerrRuleHistoryMatch {
  rule_id: string;
  name?: string;
  active_count: number;
  completed_count: number;
  failed_count: number;
  published_count?: number;
  interrupted_count?: number;
}

export interface TunerrRuleHistory {
  generated_at?: string;
  matches: TunerrRuleHistoryMatch[];
}

export interface TunerrSportsEvent {
  id: string;
  dataset: string;
  league?: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status?: string;
}

export interface TunerrSportsEventChannel {
  source_guide_number?: string;
  source_channel_name?: string;
  source_programme?: string;
  starts_at?: string;
  match_confidence?: string;
}

export interface TunerrSportsReport {
  enabled?: boolean;
  events: {
    event: TunerrSportsEvent;
    matched: boolean;
    channels?: TunerrSportsEventChannel[];
  }[];
}

export class TunerrError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'connection' | 'protocol' | 'unsupported'
  ) {
    super(message);
    this.name = 'TunerrError';
  }
}

const REQUEST_CONFIG: AxiosRequestConfig = {
  timeout: 15_000,
  maxContentLength: 8 * 1024 * 1024,
  maxBodyLength: 256 * 1024,
  maxRedirects: 0,
  validateStatus: () => true,
};

export const MAX_GUIDE_BYTES = 256 * 1024 * 1024;

export default class TunerrAPI {
  constructor(private readonly settings: TunerrSettings) {}

  public deckUrl(path: string): string {
    return buildServiceUrl({
      useSsl: this.settings.useSsl,
      hostname: this.settings.hostname,
      port: this.settings.deckPort,
      urlBase: this.settings.baseUrl,
      path: `/api${path}`,
    });
  }

  public guideUrl(): string {
    return (
      this.settings.guideUrl.trim() ||
      buildServiceUrl({
        useSsl: this.settings.useSsl,
        hostname: this.settings.hostname,
        port: this.settings.tunerPort,
        path: '/guide.xml',
      })
    );
  }

  private auth() {
    return this.settings.username || this.settings.password
      ? { username: this.settings.username, password: this.settings.password }
      : undefined;
  }

  private check<T>(status: number, data: T, what: string): T {
    if (status === 401) {
      throw new TunerrError(
        'Tunerr rejected the deck username or password.',
        'auth'
      );
    }
    if (status === 403) {
      throw new TunerrError(
        'Tunerr refused the connection. Set IPTV_TUNERR_WEBUI_ALLOW_LAN=1 on Tunerr so the deck accepts SeerrNG.',
        'auth'
      );
    }
    if (status === 429) {
      throw new TunerrError(
        'Tunerr is temporarily blocking sign-in attempts.',
        'auth'
      );
    }
    if (status < 200 || status >= 300) {
      throw new TunerrError(
        `Tunerr ${what} returned HTTP ${status}.`,
        'protocol'
      );
    }
    return data;
  }

  private async get<T>(path: string, what: string): Promise<T> {
    const response = await axios.get<T>(this.deckUrl(path), {
      ...REQUEST_CONFIG,
      auth: this.auth(),
      headers: { Accept: 'application/json' },
    });
    return this.check(response.status, response.data, what);
  }

  public async getRules(): Promise<TunerrRecordingRuleset> {
    const data = await this.get<TunerrRecordingRuleset>(
      '/recordings/rules.json',
      'recording rules'
    );
    if (!data || !Array.isArray(data.rules)) {
      throw new TunerrError(
        'Tunerr returned invalid recording rules.',
        'protocol'
      );
    }
    return data;
  }

  public missingFeatures(ruleset: TunerrRecordingRuleset): string[] {
    const features = new Set(ruleset.features ?? []);
    return REQUIRED_TUNERR_RULE_FEATURES.filter(
      (feature) => !features.has(feature)
    );
  }

  private async postRules(body: Record<string, unknown>) {
    const response = await axios.post<TunerrRecordingRuleset>(
      this.deckUrl('/recordings/rules.json'),
      body,
      {
        ...REQUEST_CONFIG,
        auth: this.auth(),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    return this.check(response.status, response.data, 'recording rule update');
  }

  public upsertRule(rule: TunerrRecordingRule) {
    return this.postRules({ action: 'upsert', rule });
  }

  public deleteRule(ruleId: string) {
    return this.postRules({ action: 'delete', rule_id: ruleId });
  }

  public async getRuleHistory(): Promise<TunerrRuleHistory> {
    const data = await this.get<TunerrRuleHistory>(
      '/recordings/history.json',
      'recording history'
    );
    if (!data || !Array.isArray(data.matches)) {
      throw new TunerrError(
        'Tunerr returned invalid recording history.',
        'protocol'
      );
    }
    return data;
  }

  /** Tunerr's API-Sports schedule matched against its guide. */
  public async getSportsReport(): Promise<TunerrSportsReport> {
    const data = await this.get<TunerrSportsReport>(
      '/v1/sports/events',
      'sports events'
    );
    if (!data || !Array.isArray(data.events)) {
      throw new TunerrError(
        'Tunerr returned an invalid sports report.',
        'protocol'
      );
    }
    return data;
  }

  /** Streams the XMLTV guide. The caller must consume or destroy it. */
  public async openGuide(): Promise<Readable> {
    const response = await axios.get<Readable>(this.guideUrl(), {
      ...REQUEST_CONFIG,
      timeout: 120_000,
      maxContentLength: MAX_GUIDE_BYTES,
      responseType: 'stream',
      decompress: true,
    });
    if (response.status !== 200) {
      response.data.destroy();
      throw new TunerrError(
        response.status === 503
          ? 'Tunerr is still building its guide. Try again shortly.'
          : `Tunerr guide returned HTTP ${response.status}.`,
        'connection'
      );
    }
    return response.data;
  }
}
