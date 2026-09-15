import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import {
  getAvailableMusicQualities,
  getAvailableMusicServices,
  getMusicQualityStatuses,
} from '@server/lib/musicQualityAvailability';

test('music quality availability combines scanned and completed target copies', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      { status: MediaStatus.AVAILABLE, serviceId: 1 },
      [
        {
          serviceTargets: [
            {
              serviceType: 'lidarr',
              format: 'music',
              serverId: 2,
              status: MediaStatus.AVAILABLE,
            },
          ],
        },
      ],
      [
        { id: 1, name: 'Lidarr MP3', activeProfileName: 'MP3' },
        { id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' },
      ]
    ),
    [
      { serverId: 1, quality: 'MP3' },
      { serverId: 2, quality: 'FLAC' },
    ]
  );
});

test('music quality availability preserves every scanned Lidarr destination', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      {
        status: MediaStatus.AVAILABLE,
        serviceId: 2,
        availableMusicServiceIds: [0, 2],
      },
      [],
      [
        { id: 0, name: 'Lidarr MP3', activeProfileName: 'MP3' },
        { id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' },
      ]
    ),
    [
      { serverId: 0, quality: 'MP3' },
      { serverId: 2, quality: 'FLAC' },
    ]
  );
});

test('music quality labels are normalized and ordered for title cards', () => {
  assert.deepStrictEqual(
    getAvailableMusicQualities(
      {
        status: MediaStatus.AVAILABLE,
        availableMusicServiceIds: [7, 3],
      },
      [],
      [
        { id: 7, name: 'Lossless', activeProfileName: 'FLAC Lossless' },
        { id: 3, name: 'Portable', activeProfileName: 'MP3 320' },
      ]
    ),
    ['MP3', 'FLAC']
  );
});

test('an explicit empty scanned destination list does not revive the legacy service', () => {
  assert.deepStrictEqual(
    getAvailableMusicServices(
      {
        status: MediaStatus.AVAILABLE,
        serviceId: 1,
        availableMusicServiceIds: [],
      },
      [],
      [{ id: 1, name: 'Lidarr FLAC', activeProfileName: 'FLAC' }]
    ),
    []
  );
});

test('music poster statuses keep MP3 and FLAC in separate fixed slots', () => {
  assert.deepStrictEqual(
    getMusicQualityStatuses(
      { availableMusicServiceIds: [1] },
      [
        {
          status: MediaRequestStatus.PENDING,
          serviceTargets: [
            {
              serviceType: 'lidarr',
              format: 'music',
              serverId: 2,
              status: MediaStatus.PENDING,
            },
          ],
        },
      ],
      [
        { id: 1, name: 'Lidarr MP3', activeProfileName: 'MP3' },
        { id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' },
      ]
    ),
    [
      { quality: 'MP3', status: MediaStatus.AVAILABLE },
      { quality: 'FLAC', status: MediaStatus.PENDING },
    ]
  );
});

test('approved music targets display processing until they become available', () => {
  assert.deepStrictEqual(
    getMusicQualityStatuses(
      undefined,
      [
        {
          status: MediaRequestStatus.APPROVED,
          serviceTargets: [
            {
              serviceType: 'lidarr',
              format: 'music',
              serverId: 2,
            },
          ],
        },
      ],
      [{ id: 2, name: 'Lidarr FLAC', activeProfileName: 'FLAC' }]
    ),
    [{ quality: 'FLAC', status: MediaStatus.PROCESSING }]
  );
});
