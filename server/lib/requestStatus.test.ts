import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DownloadingItem } from './downloadtracker';
import { RequestStatusStage, getRequestStatus } from './requestStatus';

const date = new Date('2026-01-01T00:00:00.000Z');

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  status: MediaRequestStatus.APPROVED,
  type: MediaType.MOVIE,
  is4k: false,
  bookFormat: null,
  createdAt: date,
  updatedAt: date,
  requestedBy: { id: 2 },
  media: {
    id: 3,
    mediaType: MediaType.MOVIE,
    status: MediaStatus.PROCESSING,
    status4k: MediaStatus.UNKNOWN,
    serviceId: 10,
    externalServiceId: 20,
    serviceId4k: null,
    externalServiceId4k: null,
    audiobookServiceId: null,
    audiobookExternalServiceId: null,
    seasons: [],
  },
  seasons: [],
  ...overrides,
});

const download = (
  overrides: Partial<DownloadingItem> = {}
): DownloadingItem => ({
  mediaType: MediaType.MOVIE,
  externalId: 20,
  size: 1_000,
  sizeLeft: 250,
  status: 'downloading',
  timeLeft: '00:10:00',
  estimatedCompletionTime: new Date('2026-01-01T00:10:00.000Z'),
  title: 'Example',
  downloadId: 'download-1',
  ...overrides,
});

test('request lifecycle uses authoritative queue progress and never invents a percentage', () => {
  const awaitingDispatch = request({
    media: {
      ...request().media,
      serviceId: null,
      externalServiceId: null,
    },
  });
  assert.equal(
    getRequestStatus(request({ status: MediaRequestStatus.PENDING }), {
      dispatchPending: true,
    }).stage,
    RequestStatusStage.REQUESTED
  );
  assert.equal(
    getRequestStatus(awaitingDispatch, { dispatchPending: true }).stage,
    RequestStatusStage.APPROVED
  );
  assert.equal(
    getRequestStatus(awaitingDispatch, { dispatchPending: false }).stage,
    RequestStatusStage.SEARCHING
  );

  const downloading = getRequestStatus(request(), {
    downloads: [download()],
  });
  assert.equal(downloading.stage, RequestStatusStage.DOWNLOADING);
  assert.equal(downloading.percent, 75);
  assert.equal(downloading.size, 1_000);
  assert.equal(downloading.sizeLeft, 250);

  const unknownProgress = getRequestStatus(request(), {
    downloads: [download({ size: 0, sizeLeft: 0 })],
  });
  assert.equal(unknownProgress.stage, RequestStatusStage.DOWNLOADING);
  assert.equal(unknownProgress.percent, null);

  assert.equal(
    getRequestStatus(request(), {
      downloads: [download({ status: 'importPending' })],
    }).stage,
    RequestStatusStage.IMPORTING
  );
  assert.equal(
    getRequestStatus(request(), {
      downloads: [download({ status: 'failed' })],
    }).stage,
    RequestStatusStage.FAILED
  );
});

test('movie, series, music, ebook, audiobook, and mixed book requests share the same projection', () => {
  const movie = request({
    status: MediaRequestStatus.COMPLETED,
    media: {
      ...request().media,
      status: MediaStatus.AVAILABLE,
    },
  });
  assert.equal(getRequestStatus(movie).stage, RequestStatusStage.AVAILABLE);

  const tvMedia = {
    ...request().media,
    mediaType: MediaType.TV,
    status: MediaStatus.PARTIALLY_AVAILABLE,
    seasons: [
      {
        seasonNumber: 1,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
      },
      {
        seasonNumber: 2,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      },
    ],
  };
  const tv = request({
    type: MediaType.TV,
    media: tvMedia,
    seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
  });
  assert.equal(getRequestStatus(tv).stage, RequestStatusStage.LIBRARY);
  assert.equal(
    getRequestStatus({
      ...request({ type: MediaType.TV, seasons: tv.seasons }),
      media: {
        ...tvMedia,
        seasons: tvMedia.seasons.map((season) => ({
          ...season,
          status: MediaStatus.AVAILABLE,
        })),
      },
    }).stage,
    RequestStatusStage.AVAILABLE
  );

  const music = request({
    type: MediaType.MUSIC,
    media: {
      ...request().media,
      mediaType: MediaType.MUSIC,
      status: MediaStatus.AVAILABLE,
    },
  });
  assert.equal(getRequestStatus(music).stage, RequestStatusStage.AVAILABLE);

  const bookBase = {
    ...request().media,
    mediaType: MediaType.BOOK,
    status: MediaStatus.AVAILABLE,
    serviceId: 10,
    externalServiceId: 20,
    audiobookServiceId: 11,
    audiobookExternalServiceId: 21,
  };
  assert.equal(
    getRequestStatus(
      request({ type: MediaType.BOOK, media: bookBase, bookFormat: 'ebook' })
    ).stage,
    RequestStatusStage.AVAILABLE
  );
  assert.equal(
    getRequestStatus(
      request({
        type: MediaType.BOOK,
        media: bookBase,
        bookFormat: 'audiobook',
      })
    ).stage,
    RequestStatusStage.AVAILABLE
  );
  assert.equal(
    getRequestStatus(
      request({
        type: MediaType.BOOK,
        media: {
          ...bookBase,
          audiobookServiceId: null,
          audiobookExternalServiceId: null,
        },
        bookFormat: 'both',
      })
    ).stage,
    RequestStatusStage.LIBRARY
  );
});

test('request failures and declines remain visible as terminal attention states', () => {
  assert.equal(
    getRequestStatus(request({ status: MediaRequestStatus.FAILED })).stage,
    RequestStatusStage.FAILED
  );
  assert.equal(
    getRequestStatus(request({ status: MediaRequestStatus.DECLINED })).stage,
    RequestStatusStage.DECLINED
  );
  const deleted = getRequestStatus(
    request({
      media: { ...request().media, status: MediaStatus.DELETED },
    })
  );
  assert.equal(deleted.stage, RequestStatusStage.UNAVAILABLE);
  assert.equal(deleted.needsAttention, true);
});
