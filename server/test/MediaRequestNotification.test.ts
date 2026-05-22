import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import ListenBrainzAPI from '@server/api/listenbrainz';
import OpenLibraryAPI from '@server/api/openlibrary';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import notificationManager, { Notification } from '@server/lib/notifications';
import {
  getNotificationActionUrl,
  getNotificationMediaUrl,
  type NotificationPayload,
} from '@server/lib/notifications/agents/agent';

function createUser() {
  return new User({
    id: 2,
    email: 'friend@seerr.dev',
    username: 'friend',
    displayName: 'Friend',
  });
}

describe('MediaRequest.sendNotification', () => {
  it('sends music notifications with album metadata', async (t) => {
    const sendNotificationMock = mock.method(
      notificationManager,
      'sendNotification',
      () => undefined
    );
    const getAlbumMock = mock.method(
      ListenBrainzAPI.prototype,
      'getAlbum',
      async () =>
        ({
          release_group_mbid: 'release-group-id',
          release_group_metadata: {
            release_group: {
              name: 'Kind of Blue',
              date: '1959-08-17',
            },
            artist: {
              name: 'Miles Davis',
            },
          },
        }) as Awaited<ReturnType<ListenBrainzAPI['getAlbum']>>
    );
    t.after(() => {
      sendNotificationMock.mock.restore();
      getAlbumMock.mock.restore();
    });

    const media = new Media({
      mediaType: MediaType.MUSIC,
      tmdbId: 0,
      mbId: 'release-group-id',
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
    });
    const entity = new MediaRequest({
      type: MediaType.MUSIC,
      media,
      requestedBy: createUser(),
      status: MediaRequestStatus.APPROVED,
      is4k: false,
    });

    await MediaRequest.sendNotification(
      entity,
      media,
      Notification.MEDIA_APPROVED
    );

    assert.strictEqual(sendNotificationMock.mock.callCount(), 1);
    const [type, payload] = sendNotificationMock.mock.calls[0].arguments as [
      Notification,
      NotificationPayload,
    ];
    assert.strictEqual(type, Notification.MEDIA_APPROVED);
    assert.strictEqual(payload.event, 'Music Request Approved');
    assert.strictEqual(payload.mediaUrl, '/music/release-group-id');
    assert.strictEqual(payload.subject, 'Kind of Blue (1959)');
    assert.strictEqual(payload.message, 'Miles Davis');
    assert.deepStrictEqual(payload.extra, [
      {
        name: 'Artist',
        value: 'Miles Davis',
      },
    ]);
  });

  it('sends book notifications with Open Library metadata', async (t) => {
    const sendNotificationMock = mock.method(
      notificationManager,
      'sendNotification',
      () => undefined
    );
    const getWorkMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWork',
      async () =>
        ({
          key: '/works/OL45804W',
          title: 'The Left Hand of Darkness',
          first_publish_date: '1969',
          description: 'A classic science fiction novel.',
          covers: [1234],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWork']>>
    );
    const getWorkEditionsMock = mock.method(
      OpenLibraryAPI.prototype,
      'getWorkEditions',
      async () =>
        ({
          size: 1,
          entries: [
            {
              key: '/books/OL1M',
              isbn_13: ['9780441478125'],
            },
          ],
        }) as Awaited<ReturnType<OpenLibraryAPI['getWorkEditions']>>
    );
    t.after(() => {
      sendNotificationMock.mock.restore();
      getWorkMock.mock.restore();
      getWorkEditionsMock.mock.restore();
    });

    const media = new Media({
      id: 20,
      mediaType: MediaType.BOOK,
      tmdbId: 0,
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
      identifiers: [
        new MediaIdentifier({
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: 'OL45804W',
          canonical: true,
        }),
      ],
    });
    media.identifiers[0].media = media;
    const entity = new MediaRequest({
      type: MediaType.BOOK,
      media,
      requestedBy: createUser(),
      status: MediaRequestStatus.APPROVED,
      is4k: false,
    });

    await MediaRequest.sendNotification(
      entity,
      media,
      Notification.MEDIA_AVAILABLE
    );

    assert.strictEqual(sendNotificationMock.mock.callCount(), 1);
    const [type, payload] = sendNotificationMock.mock.calls[0].arguments as [
      Notification,
      NotificationPayload,
    ];
    assert.strictEqual(type, Notification.MEDIA_AVAILABLE);
    assert.strictEqual(payload.event, 'Book Now Available');
    assert.strictEqual(payload.mediaUrl, '/book/OL45804W');
    assert.strictEqual(payload.subject, 'The Left Hand of Darkness (1969)');
    assert.strictEqual(payload.message, 'A classic science fiction novel.');
    assert.strictEqual(
      payload.image,
      'https://covers.openlibrary.org/b/id/1234-L.jpg'
    );
    assert.deepStrictEqual(payload.extra, [
      {
        name: 'ISBN',
        value: '9780441478125',
      },
    ]);
  });
});

describe('notification media URLs', () => {
  it('uses MusicBrainz and Open Library routes for music and books', () => {
    const musicMedia = new Media({
      mediaType: MediaType.MUSIC,
      tmdbId: 0,
      mbId: 'release-group-id',
    });
    const bookMedia = new Media({
      mediaType: MediaType.BOOK,
      tmdbId: 0,
      identifiers: [
        new MediaIdentifier({
          provider: MediaIdentifierProvider.OPENLIBRARY,
          value: 'OL45804W',
          canonical: true,
        }),
      ],
    });

    assert.equal(
      getNotificationMediaUrl({ media: musicMedia }),
      '/music/release-group-id'
    );
    assert.equal(
      getNotificationMediaUrl({ media: bookMedia }),
      '/book/OL45804W'
    );
    assert.equal(
      getNotificationActionUrl({ media: bookMedia }, 'https://seerr.example'),
      'https://seerr.example/book/OL45804W'
    );
  });

  it('does not generate broken fallback URLs for unresolved books or music', () => {
    assert.equal(
      getNotificationMediaUrl({
        media: new Media({
          mediaType: MediaType.MUSIC,
          tmdbId: 0,
        }),
      }),
      undefined
    );
    assert.equal(
      getNotificationActionUrl(
        {
          media: new Media({
            mediaType: MediaType.BOOK,
            tmdbId: 0,
          }),
        },
        'https://seerr.example'
      ),
      undefined
    );
  });

  it('rejects unsafe explicit notification media URLs', () => {
    assert.equal(
      getNotificationMediaUrl({ mediaUrl: 'https://evil.example/movie/1' }),
      undefined
    );
    assert.equal(
      getNotificationMediaUrl({ mediaUrl: '//evil.example' }),
      undefined
    );
    assert.equal(
      getNotificationMediaUrl({ mediaUrl: '/movie/1\r\nX-Test: yes' }),
      undefined
    );
    assert.equal(
      getNotificationActionUrl(
        { mediaUrl: 'javascript:alert(1)' },
        'https://seerr.example'
      ),
      undefined
    );
  });
});
