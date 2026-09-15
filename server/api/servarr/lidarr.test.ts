import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import LidarrAPI from './lidarr';

type MockableLidarr = {
  get: (endpoint: string) => Promise<unknown>;
  request: () => Promise<{ data: unknown }>;
};

afterEach(() => {
  mock.restoreAll();
});

describe('Lidarr response normalization', () => {
  it('returns exact metadata profile records', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [
        null,
        { id: 'bad', name: 'Invalid' },
        {
          id: 1,
          name: 'Standard',
          apiKey: 'provider-secret',
          providerOnly: true,
        },
      ]
    );

    const profiles = await api.getMetadataProfiles();

    assert.deepStrictEqual(profiles, [{ id: 1, name: 'Standard' }]);
  });

  it('returns bounded album history records without unrelated response data', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'request',
      async () => ({
        data: {
          records: [
            null,
            { id: 'bad', albumId: 4 },
            {
              id: 7,
              albumId: 4,
              eventType: 'grabbed',
              date: '2026-09-10T09:42:53Z',
              downloadId: 'download-7',
              data: { apiKey: 'must-not-leak' },
            },
          ],
        },
      })
    );

    assert.deepStrictEqual(await api.getHistory(), [
      {
        id: 7,
        albumId: 4,
        eventType: 'grabbed',
        date: '2026-09-10T09:42:53Z',
        downloadId: 'download-7',
      },
    ]);
  });

  it('returns only valid track availability fields', async () => {
    const api = new LidarrAPI({
      url: 'http://localhost:8686/api/v1',
      apiKey: 'key',
    });
    mock.method(
      LidarrAPI.prototype as unknown as MockableLidarr,
      'get',
      async () => [
        null,
        { id: 'bad' },
        {
          id: 7,
          albumId: 4,
          title: 'Track',
          trackNumber: '1',
          absoluteTrackNumber: 1,
          mediumNumber: 1,
          hasFile: true,
          trackFileId: 9,
          foreignRecordingId: 'ABC-123',
          apiKey: 'must-not-leak',
        },
      ]
    );

    assert.deepStrictEqual(await api.getTracks({ albumId: 4 }), [
      {
        id: 7,
        albumId: 4,
        title: 'Track',
        trackNumber: '1',
        absoluteTrackNumber: 1,
        mediumNumber: 1,
        hasFile: true,
        trackFileId: 9,
        foreignRecordingId: 'abc-123',
      },
    ]);
  });
});
