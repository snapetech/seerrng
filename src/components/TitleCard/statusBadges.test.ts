import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus } from '@server/constants/media';
import {
  getTitleCardStatusBadges,
  getTitleCardStatusBadgeSlots,
} from './statusBadges';

describe('getTitleCardStatusBadges', () => {
  it('labels movie qualities in HD then 4K order', () => {
    assert.deepEqual(
      getTitleCardStatusBadges({
        mediaType: 'movie',
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.AVAILABLE,
      }),
      [
        {
          quality: 'HD',
          status: MediaStatus.AVAILABLE,
          inProgress: false,
        },
        {
          quality: '4K',
          status: MediaStatus.AVAILABLE,
          inProgress: false,
        },
      ]
    );
  });

  it('uses the same quality labels for series', () => {
    assert.deepEqual(
      getTitleCardStatusBadges({
        mediaType: 'tv',
        status: MediaStatus.PARTIALLY_AVAILABLE,
        status4k: MediaStatus.PROCESSING,
        inProgress4k: true,
      }),
      [
        {
          quality: 'HD',
          status: MediaStatus.PARTIALLY_AVAILABLE,
          inProgress: false,
        },
        {
          quality: '4K',
          status: MediaStatus.PROCESSING,
          inProgress: true,
        },
      ]
    );
  });

  it('labels available album qualities in MP3 then FLAC order', () => {
    assert.deepEqual(
      getTitleCardStatusBadges({
        mediaType: 'album',
        status: MediaStatus.AVAILABLE,
        availableQualities: ['FLAC', 'MP3'],
      }),
      [
        {
          quality: 'MP3',
          status: MediaStatus.AVAILABLE,
          inProgress: false,
        },
        {
          quality: 'FLAC',
          status: MediaStatus.AVAILABLE,
          inProgress: false,
        },
      ]
    );
  });

  it('preserves an aggregate album status when exact qualities are unavailable', () => {
    assert.deepEqual(
      getTitleCardStatusBadges({
        mediaType: 'album',
        status: MediaStatus.PROCESSING,
        inProgress: true,
      }),
      [
        {
          status: MediaStatus.PROCESSING,
          inProgress: true,
        },
      ]
    );
  });

  it('preserves format-specific pending and processing music statuses', () => {
    assert.deepEqual(
      getTitleCardStatusBadges({
        mediaType: 'album',
        qualityStatuses: [
          { quality: 'FLAC', status: MediaStatus.PENDING },
          { quality: 'MP3', status: MediaStatus.PROCESSING },
        ],
      }),
      [
        {
          quality: 'MP3',
          status: MediaStatus.PROCESSING,
          inProgress: false,
        },
        {
          quality: 'FLAC',
          status: MediaStatus.PENDING,
          inProgress: false,
        },
      ]
    );
  });

  it('keeps 4K and FLAC in the second row when the first row is empty', () => {
    for (const badge of [
      {
        quality: '4K' as const,
        status: MediaStatus.AVAILABLE,
        inProgress: false,
      },
      {
        quality: 'FLAC' as const,
        status: MediaStatus.PENDING,
        inProgress: false,
      },
    ]) {
      assert.deepEqual(getTitleCardStatusBadgeSlots([badge]), {
        primary: undefined,
        secondary: badge,
      });
    }
  });
});
