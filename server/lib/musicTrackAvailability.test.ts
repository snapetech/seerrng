import type { LidarrSettings } from '@server/lib/settings';
import assert from 'node:assert/strict';
import test from 'node:test';
import { getMusicTrackAvailability } from './musicTrackAvailability';

const service = (id: number, name: string): LidarrSettings => ({
  id,
  name,
  hostname: 'lidarr.local',
  port: 8686 + id,
  apiKey: 'test-key',
  useSsl: false,
  activeProfileId: 1,
  activeProfileName: name,
  activeDirectory: '/music',
  tags: [],
  is4k: false,
  isDefault: id === 0,
  syncEnabled: true,
  preventSearch: false,
  tagRequests: false,
  overrideRule: [],
});

test('keeps selected MP3 and FLAC track availability independent', async () => {
  const firstRecordingId = 'afdd18a5-3fd8-4407-93e9-8445298aaf6f';
  const secondRecordingId = 'c24eb26a-04d6-4f09-9449-9bc334f78ede';
  const availability = await getMusicTrackAvailability(
    '2187D248-1A3B-35D0-A4EC-BEAD586FF547',
    [service(0, 'Lidarr-MP3'), service(1, 'Lidarr-FLAC')],
    async (_mbId, currentService) =>
      currentService.id === 0
        ? [firstRecordingId.toUpperCase(), firstRecordingId, secondRecordingId]
        : []
  );

  assert.deepStrictEqual(availability, {
    mp3: [firstRecordingId, secondRecordingId],
    flac: [],
  });
});

test('omits a quality when its Lidarr instance cannot be read', async () => {
  const availability = await getMusicTrackAvailability(
    '2187d248-1a3b-35d0-a4ec-bead586ff547',
    [service(0, 'MP3'), service(1, 'FLAC')],
    async (_mbId, currentService) => {
      if (currentService.id === 1) throw new Error('offline');
      return ['afdd18a5-3fd8-4407-93e9-8445298aaf6f'];
    }
  );

  assert.deepStrictEqual(availability, {
    mp3: ['afdd18a5-3fd8-4407-93e9-8445298aaf6f'],
  });
});
