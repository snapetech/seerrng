import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  SportarrEpgSource,
  SportarrEpgSyncResult,
  SportarrIptvSource,
  SportarrIptvSourceTestResult,
} from '@server/api/servarr/sportarr';
import { defaultTunerrSettings } from '@server/lib/settings';

import {
  buildTunerrSportsFeedUrls,
  connectTunerrSportsFeeds,
  inspectSportarrSportsFeeds,
  normalizeSportarrTunerrBaseUrl,
  SportarrSportsFeedSetupError,
  type SportarrSportsFeedApi,
} from './sportarrIntegration';

class FakeSportarrSportsFeedApi implements SportarrSportsFeedApi {
  sources: SportarrIptvSource[] = [];
  guides: SportarrEpgSource[] = [];
  testResult: SportarrIptvSourceTestResult = {
    success: true,
    channelCount: 4,
  };
  syncResult: SportarrEpgSyncResult = {
    success: true,
    channelCount: 4,
    programCount: 12,
    mappedChannelCount: 4,
  };
  calls: string[] = [];

  async getIptvSources() {
    this.calls.push('get-sources');
    return this.sources;
  }

  async testIptvM3uSource(input: { name: string; url: string }) {
    this.calls.push(`test:${input.url}`);
    return this.testResult;
  }

  async addIptvM3uSource(input: { name: string; url: string }) {
    this.calls.push(`add-source:${input.url}`);
    const source: SportarrIptvSource = {
      id: 21,
      name: input.name,
      type: 'M3U',
      url: input.url,
      isActive: true,
      channelCount: 0,
    };
    this.sources.push(source);
    return source;
  }

  async getEpgSources() {
    this.calls.push('get-guides');
    return this.guides;
  }

  async addEpgSource(input: {
    name: string;
    url: string;
    iptvSourceId: number;
  }) {
    this.calls.push(`add-guide:${input.url}`);
    const guide: SportarrEpgSource = {
      id: 31,
      name: input.name,
      url: input.url,
      isActive: true,
      priority: 25,
      programCount: 0,
      iptvSourceId: input.iptvSourceId,
    };
    this.guides.push(guide);
    return guide;
  }

  async syncEpgSource(id: number) {
    this.calls.push(`sync:${id}`);
    return this.syncResult;
  }
}

const urls = {
  m3u: 'http://tunerr:5004/sports/live.m3u',
  xmltv: 'http://tunerr:5004/sports/guide.xml',
};

describe('Tunerr sports feeds for Sportarr', () => {
  it('derives the event playlist and XMLTV URLs from the tuner settings', () => {
    assert.deepEqual(
      buildTunerrSportsFeedUrls({
        ...defaultTunerrSettings(),
        enabled: true,
        hostname: 'tunerr',
      }),
      urls
    );
  });

  it('uses a Sportarr-reachable base address and rejects unsafe URL parts', () => {
    assert.equal(
      normalizeSportarrTunerrBaseUrl('https://tunerr.local:5004/proxy/'),
      'https://tunerr.local:5004/proxy'
    );
    assert.deepEqual(
      buildTunerrSportsFeedUrls({
        ...defaultTunerrSettings(),
        hostname: 'tunerr',
        sportarrBaseUrl: 'https://tunerr.local:5004/proxy/',
      }),
      {
        m3u: 'https://tunerr.local:5004/proxy/sports/live.m3u',
        xmltv: 'https://tunerr.local:5004/proxy/sports/guide.xml',
      }
    );
    for (const value of [
      'ftp://tunerr.local',
      'http://user:pass@tunerr.local',
      'http://tunerr.local?token=secret',
      'http://tunerr.local/#fragment',
      'http://tunerr.local/a/../b',
    ]) {
      assert.equal(normalizeSportarrTunerrBaseUrl(value), undefined, value);
    }
  });

  it('tests, creates, links, and syncs the feeds in sequence', async () => {
    const api = new FakeSportarrSportsFeedApi();

    const result = await connectTunerrSportsFeeds(api, urls);

    assert.equal(result.sourceCreated, true);
    assert.equal(result.guideCreated, true);
    assert.equal(result.source?.id, 21);
    assert.equal(result.guide?.linkedToSource, true);
    assert.equal(result.sync.programCount, 12);
    assert.deepEqual(api.calls, [
      'get-sources',
      `test:${urls.m3u}`,
      `add-source:${urls.m3u}`,
      'get-guides',
      `add-guide:${urls.xmltv}`,
      'sync:31',
    ]);
  });

  it('does not create a Sportarr source when its own playlist test fails', async () => {
    const api = new FakeSportarrSportsFeedApi();
    api.testResult = { success: false, channelCount: 0 };

    await assert.rejects(
      connectTunerrSportsFeeds(api, urls),
      (error: unknown) =>
        error instanceof SportarrSportsFeedSetupError &&
        error.status === 502 &&
        !error.partial
    );
    assert.equal(api.sources.length, 0);
    assert.equal(api.guides.length, 0);
    assert.equal(api.calls.includes(`add-source:${urls.m3u}`), false);
  });

  it('reuses exact existing feeds on retries and syncs the guide again', async () => {
    const api = new FakeSportarrSportsFeedApi();
    api.sources.push({
      id: 21,
      name: 'Existing Tunerr playlist',
      type: 'M3U',
      url: urls.m3u,
      isActive: true,
      channelCount: 4,
    });
    api.guides.push({
      id: 31,
      name: 'Existing Tunerr guide',
      url: urls.xmltv,
      isActive: true,
      priority: 25,
      programCount: 12,
      iptvSourceId: 21,
    });

    const result = await connectTunerrSportsFeeds(api, urls);

    assert.equal(result.sourceCreated, false);
    assert.equal(result.guideCreated, false);
    assert.equal(api.calls.includes(`add-source:${urls.m3u}`), false);
    assert.equal(api.calls.includes(`add-guide:${urls.xmltv}`), false);
    assert.equal(api.calls.at(-1), 'sync:31');
  });

  it('does not rewrite an existing guide attached to another source', async () => {
    const api = new FakeSportarrSportsFeedApi();
    api.sources.push({
      id: 21,
      name: 'Tunerr playlist',
      type: 'M3U',
      url: urls.m3u,
      isActive: true,
      channelCount: 4,
    });
    api.guides.push({
      id: 32,
      name: 'Existing XMLTV',
      url: urls.xmltv,
      isActive: true,
      priority: 25,
      programCount: 12,
      iptvSourceId: 99,
    });

    await assert.rejects(
      connectTunerrSportsFeeds(api, urls),
      (error: unknown) =>
        error instanceof SportarrSportsFeedSetupError &&
        error.status === 409 &&
        error.partial === false
    );
    assert.equal(
      api.calls.some((call) => call.startsWith('add-guide:')),
      false
    );
    assert.equal(
      api.calls.some((call) => call.startsWith('sync:')),
      false
    );
  });

  it('preserves and explains a partial setup after XMLTV sync fails', async () => {
    const api = new FakeSportarrSportsFeedApi();
    api.syncResult = {
      success: false,
      channelCount: 0,
      programCount: 0,
      mappedChannelCount: 0,
    };

    await assert.rejects(
      connectTunerrSportsFeeds(api, urls),
      (error: unknown) =>
        error instanceof SportarrSportsFeedSetupError &&
        error.status === 502 &&
        error.partial &&
        error.message.includes('setup is preserved')
    );
    assert.equal(api.sources.length, 1);
    assert.equal(api.guides.length, 1);
  });

  it('reports status without exposing the configured feed URLs', async () => {
    const api = new FakeSportarrSportsFeedApi();
    api.sources.push({
      id: 21,
      name: 'Tunerr playlist',
      type: 'M3U',
      url: urls.m3u,
      isActive: true,
      channelCount: 4,
    });
    api.guides.push({
      id: 31,
      name: 'Tunerr guide',
      url: urls.xmltv,
      isActive: true,
      priority: 25,
      programCount: 12,
      iptvSourceId: 21,
    });

    const status = await inspectSportarrSportsFeeds(api, urls);

    assert.equal(status.linked, true);
    assert.equal(status.source?.channelCount, 4);
    assert.equal(status.guide?.programCount, 12);
    assert.equal(JSON.stringify(status).includes('tunerr:5004'), false);
  });
});
