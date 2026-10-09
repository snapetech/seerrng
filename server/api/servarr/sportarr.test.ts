import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { MAX_SERVARR_CONFIGURATION_RESULTS } from '@server/api/servarr/base';
import type { AxiosInstance } from 'axios';

import SportarrAPI from './sportarr';

const buildSportarr = () =>
  new SportarrAPI({ url: 'http://127.0.0.1:1867/api', apiKey: 'test-api-key' });

const getAxios = (api: SportarrAPI): AxiosInstance =>
  (api as unknown as { axios: AxiosInstance }).axios;

describe('Sportarr native API adapter', () => {
  afterEach(() => mock.restoreAll());

  it('uses authenticated native endpoints to search and list league data', async () => {
    const api = buildSportarr();
    const transport = getAxios(api);
    const get = mock.method(transport, 'get', async (url: string) => ({
      data: url.endsWith('/leagues/search/Premier%20League')
        ? [
            {
              idLeague: 'lg-000123',
              strLeague: 'Premier League',
              strSport: 'Soccer',
              strCountry: 'England',
              intFormedYear: '1992',
              strDescriptionEN: 'The English top division.',
              strPoster: 'https://sportarr.example/poster.jpg',
              apiKey: 'must-not-leak',
            },
          ]
        : [
            {
              id: 17,
              externalId: 'lg-000017',
              name: 'Local League',
              sport: 'Basketball',
              monitored: false,
              apiKey: 'must-not-leak',
            },
          ],
    }));

    const searchResults = await api.getLeaguesByTitle('Premier League');
    const library = await api.getLibraryLeagues();

    assert.equal(
      get.mock.calls[0].arguments[0],
      'http://127.0.0.1:1867/api/leagues/search/Premier%20League'
    );
    assert.equal(
      get.mock.calls[1].arguments[0],
      'http://127.0.0.1:1867/api/leagues'
    );
    assert.equal(searchResults[0].id, undefined);
    assert.equal(searchResults[0].externalId, 'lg-000123');
    assert.equal(searchResults[0].title, 'Premier League');
    assert.equal(searchResults[0].sport, 'Soccer');
    assert.equal(searchResults[0].country, 'England');
    assert.equal(searchResults[0].year, 1992);
    assert.equal(searchResults[0].overview, 'The English top division.');
    assert.deepEqual(searchResults[0].images, [
      { coverType: 'poster', url: 'https://sportarr.example/poster.jpg' },
    ]);
    assert.deepEqual(library[0], {
      id: 17,
      externalId: 'lg-000017',
      title: 'Local League',
      overview: '',
      sport: 'Basketball',
      monitored: false,
      images: [],
    });

    const defaults = transport.defaults.headers as unknown as {
      common?: Record<string, unknown>;
      'X-Api-Key'?: unknown;
    };
    assert.equal(
      defaults.common?.['X-Api-Key'] ?? defaults['X-Api-Key'],
      'test-api-key'
    );
  });

  it('never treats catalog IDs as installation-local library IDs', async () => {
    const api = buildSportarr();
    const get = mock.method(getAxios(api), 'get', async (url: string) => ({
      data: url.endsWith('/leagues')
        ? []
        : [
            {
              idLeague: 'lg-000123',
              strLeague: 'Premier League',
              strSport: 'Soccer',
              strCountry: 'England',
              strDescriptionEN: 'The English top division.',
              strPoster: 'https://sportarr.example/poster.jpg',
            },
          ],
    }));

    const league = await api.getLeagueByExternalId('lg-000123');

    assert.equal(league?.id, undefined);
    assert.equal(get.mock.calls.length, 2);
    assert.match(String(get.mock.calls[0].arguments[0]), /\/api\/leagues$/u);
    assert.match(
      String(get.mock.calls[1].arguments[0]),
      /\/api\/leagues\/all$/u
    );
    assert.equal(league?.externalId, 'lg-000123');
    assert.equal(league?.title, 'Premier League');
    assert.equal(league?.sport, 'Soccer');
  });

  it('adds a league through the native API and confirms its persisted library state', async () => {
    const api = buildSportarr();
    const transport = getAxios(api);
    const post = mock.method(transport, 'post', async () => ({ data: {} }));
    const get = mock.method(transport, 'get', async () => ({
      data: [
        {
          id: 42,
          externalId: 'lg-000042',
          name: 'National League',
          sport: 'Soccer',
          monitored: true,
        },
      ],
    }));

    const league = await api.addLeague(
      {
        externalId: 'lg-000042',
        title: 'National League',
        sport: 'Soccer',
        country: 'England',
        overview: 'A domestic competition.',
      },
      5
    );

    assert.equal(
      post.mock.calls[0].arguments[0],
      'http://127.0.0.1:1867/api/leagues'
    );
    assert.deepEqual(post.mock.calls[0].arguments[1], {
      externalId: 'lg-000042',
      name: 'National League',
      sport: 'Soccer',
      monitored: true,
      qualityProfileId: 5,
      country: 'England',
      description: 'A domestic competition.',
    });
    assert.equal(
      get.mock.calls[0].arguments[0],
      'http://127.0.0.1:1867/api/leagues'
    );
    assert.equal(league?.id, 42);
    assert.equal(league?.monitored, true);
  });

  it('pages events and omits provider file paths from the client response model', async () => {
    const api = buildSportarr();
    const get = mock.method(getAxios(api), 'get', async () => ({
      data: {
        page: 2,
        pageSize: 25,
        totalRecords: 30,
        totalPages: 2,
        records: [
          {
            id: 91,
            externalId: 'ev-000091',
            title: 'Final',
            sport: 'Soccer',
            season: '2026',
            eventDate: '2026-06-01T18:00:00Z',
            broadcastTimezone: 'Europe/London',
            monitored: true,
            hasFile: true,
            filePath: '/private/library/final.mkv',
            fileSize: 500,
            quality: '1080p',
            files: [
              {
                id: 101,
                filePath: '/private/library/final.mkv',
                size: 500,
                exists: true,
              },
            ],
          },
        ],
      },
    }));

    const result = await api.getLeagueEvents(12, 2, 25);

    assert.equal(
      get.mock.calls[0].arguments[0],
      'http://127.0.0.1:1867/api/leagues/12/events'
    );
    const requestOptions = get.mock.calls[0].arguments[1] as {
      params?: Record<string, unknown>;
    };
    assert.deepEqual(requestOptions.params, { page: 2, pageSize: 25 });
    assert.equal(result.records[0].id, 91);
    assert.equal(result.records[0].fileCount, 1);
    assert.equal('filePath' in result.records[0], false);
    assert.equal('files' in result.records[0], false);
  });

  it('uses authenticated Sportarr IPTV and XMLTV setup endpoints', async () => {
    const api = buildSportarr();
    const transport = getAxios(api);
    const get = mock.method(transport, 'get', async (url: string) => ({
      data: url.endsWith('/iptv/sources')
        ? [
            {
              id: 21,
              name: 'IPTV Tunerr Sports',
              type: 'M3U',
              url: 'http://tunerr:5004/sports/live.m3u',
              isActive: true,
              channelCount: 4,
            },
          ]
        : [
            {
              id: 31,
              name: 'IPTV Tunerr Sports Guide',
              url: 'http://tunerr:5004/sports/guide.xml',
              isActive: true,
              priority: 25,
              programCount: 12,
              iptvSourceId: 21,
            },
          ],
    }));
    const post = mock.method(
      transport,
      'post',
      async (url: string, body: unknown) => ({
        data: url.endsWith('/iptv/sources/test')
          ? { success: true, channelCount: 4 }
          : url.endsWith('/iptv/sources')
            ? {
                id: 21,
                name: 'IPTV Tunerr Sports',
                type: 'M3U',
                url: 'http://tunerr:5004/sports/live.m3u',
                isActive: true,
                channelCount: 0,
              }
            : url.endsWith('/epg/sources')
              ? {
                  id: 31,
                  name: 'IPTV Tunerr Sports Guide',
                  url: 'http://tunerr:5004/sports/guide.xml',
                  isActive: true,
                  priority: 25,
                  iptvSourceId: 21,
                }
              : {
                  success: true,
                  channelCount: 4,
                  programCount: 12,
                  mappedChannelCount: 4,
                },
        body,
      })
    );

    const sources = await api.getIptvSources();
    const tested = await api.testIptvM3uSource({
      name: 'IPTV Tunerr Sports',
      url: 'http://tunerr:5004/sports/live.m3u',
    });
    const addedSource = await api.addIptvM3uSource({
      name: 'IPTV Tunerr Sports',
      url: 'http://tunerr:5004/sports/live.m3u',
    });
    const guides = await api.getEpgSources();
    const addedGuide = await api.addEpgSource({
      name: 'IPTV Tunerr Sports Guide',
      url: 'http://tunerr:5004/sports/guide.xml',
      iptvSourceId: 21,
    });
    const sync = await api.syncEpgSource(31);

    assert.equal(sources[0].type, 'M3U');
    assert.equal(tested.success, true);
    assert.equal(addedSource.id, 21);
    assert.equal(guides[0].iptvSourceId, 21);
    assert.equal(addedGuide.id, 31);
    assert.deepEqual(sync, {
      success: true,
      channelCount: 4,
      programCount: 12,
      mappedChannelCount: 4,
    });
    assert.deepEqual(
      post.mock.calls.map((call) => call.arguments[0]),
      [
        'http://127.0.0.1:1867/api/iptv/sources/test',
        'http://127.0.0.1:1867/api/iptv/sources',
        'http://127.0.0.1:1867/api/epg/sources',
        'http://127.0.0.1:1867/api/epg/sources/31/sync',
      ]
    );
    assert.deepEqual(post.mock.calls[0].arguments[1], {
      name: 'IPTV Tunerr Sports',
      type: 'M3U',
      url: 'http://tunerr:5004/sports/live.m3u',
      maxStreams: 1,
    });
    assert.deepEqual(post.mock.calls[2].arguments[1], {
      name: 'IPTV Tunerr Sports Guide',
      url: 'http://tunerr:5004/sports/guide.xml',
      priority: 25,
      iptvSourceId: 21,
    });
    const defaults = transport.defaults.headers as unknown as {
      common?: Record<string, unknown>;
      'X-Api-Key'?: unknown;
    };
    assert.equal(
      defaults.common?.['X-Api-Key'] ?? defaults['X-Api-Key'],
      'test-api-key'
    );
    assert.equal(get.mock.callCount(), 2);
  });

  it('rejects malformed and oversized IPTV source responses', async () => {
    const api = buildSportarr();
    const get = mock.method(getAxios(api), 'get', async () => ({
      data: [
        {
          id: 21,
          name: 'Invalid source',
          type: 'M3U',
          url: 'http://tunerr:5004/sports/live.m3u',
          isActive: true,
          channelCount: -1,
        },
      ],
    }));

    await assert.rejects(api.getIptvSources(), /invalid IPTV source/iu);

    get.mock.mockImplementation(
      async () =>
        ({
          data: Array.from(
            { length: MAX_SERVARR_CONFIGURATION_RESULTS + 1 },
            () => ({})
          ),
        }) as never
    );
    await assert.rejects(api.getIptvSources(), /invalid IPTV source list/iu);
  });

  it('propagates Sportarr transport errors from feed setup calls', async () => {
    const api = buildSportarr();
    const failure = new Error('Sportarr transport unavailable');
    mock.method(getAxios(api), 'post', async () => {
      throw failure;
    });

    await assert.rejects(
      api.testIptvM3uSource({
        name: 'IPTV Tunerr Sports',
        url: 'http://tunerr:5004/sports/live.m3u',
      }),
      (error: unknown) => error === failure
    );
  });
});
