import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import OpenLibraryAPI from '@server/api/openlibrary';
import type { LidarrAlbumOptions } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import type {
  ReadarrBookLookupResult,
  ReadarrBookOptions,
} from '@server/api/servarr/readarr';
import ReadarrAPI from '@server/api/servarr/readarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import notificationManager from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';
import axios from 'axios';

async function getRequester() {
  return getRepository(User).findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });
}

async function createApprovedRequest(media: Media, requestedBy: User) {
  mock.method(MediaRequest, 'sendNotification', async () => undefined);

  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: media.mediaType,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy,
      is4k: false,
    })
  );

  request.status = MediaRequestStatus.APPROVED;
  request.media = media;
  request.requestedBy = requestedBy;

  return request;
}

const waitForAsyncDispatch = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const waitForSavedMedia = async (
  mediaId: number,
  predicate: (media: Media) => boolean
) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const media = await getRepository(Media).findOneByOrFail({ id: mediaId });
    if (predicate(media)) {
      return media;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return getRepository(Media).findOneByOrFail({ id: mediaId });
};

describe('MediaRequestSubscriber service dispatch', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    mock.restoreAll();
    const settings = getSettings();
    settings.radarr = [];
    settings.sonarr = [];
    settings.lidarr = [];
    settings.readarr = [];
  });

  it('sends approved movie requests to Radarr with the configured profile and root folder', async () => {
    const settings = getSettings();
    settings.radarr = [
      {
        id: 30,
        name: 'Radarr',
        hostname: 'radarr.local',
        port: 7878,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 5,
        activeProfileName: 'HD',
        activeDirectory: '/movies',
        minimumAvailability: 'released',
        tags: [12],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 550,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      id: 550,
      title: 'Fight Club',
      release_date: '1999-10-15',
    }));

    const originalCreate = axios.create;
    let addPayload: Record<string, unknown> | undefined;
    mock.method(axios, 'create', (config: { baseURL?: string }) => {
      if (config?.baseURL === 'https://api.themoviedb.org/3') {
        return originalCreate.call(axios, config);
      }

      return {
        interceptors: { request: { use: () => undefined } },
        get: async (endpoint: string) => {
          if (endpoint === '/movie/lookup') {
            return {
              data: [
                {
                  title: 'Fight Club',
                  tmdbId: 550,
                  year: 1999,
                  hasFile: false,
                  monitored: false,
                  tags: [],
                },
              ],
            };
          }

          throw new Error(`Unexpected GET ${endpoint}`);
        },
        post: async (endpoint: string, payload: Record<string, unknown>) => {
          assert.equal(endpoint, '/movie');
          addPayload = payload;

          return {
            data: {
              id: 77,
              title: 'Fight Club',
              titleSlug: 'fight-club-1999',
            },
          };
        },
      };
    });

    const request = await createApprovedRequest(media, requestedBy);

    await new MediaRequestSubscriber().sendToRadarr(request);
    await waitForAsyncDispatch(() => !!addPayload);

    assert.equal(addPayload?.tmdbId, 550);
    assert.equal(addPayload?.qualityProfileId, 5);
    assert.equal(addPayload?.profileId, 5);
    assert.equal(addPayload?.rootFolderPath, '/movies');
    assert.equal(addPayload?.minimumAvailability, 'released');
    assert.deepStrictEqual(addPayload?.addOptions, {
      searchForMovie: true,
    });
    assert.deepStrictEqual(addPayload?.tags, [12]);

    const savedMedia = await waitForSavedMedia(
      media.id,
      (media) => media.externalServiceId === 77
    );
    assert.equal(savedMedia.externalServiceId, 77);
    assert.equal(savedMedia.externalServiceSlug, 'fight-club-1999');
    assert.equal(savedMedia.serviceId, 30);
  });

  it('sends approved series requests to Sonarr with seasons and service routing', async () => {
    const settings = getSettings();
    settings.sonarr = [
      {
        id: 31,
        name: 'Sonarr',
        hostname: 'sonarr.local',
        port: 8989,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 6,
        activeProfileName: 'HD',
        activeLanguageProfileId: 1,
        activeDirectory: '/tv',
        tags: [14],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        seriesType: 'standard',
        animeSeriesType: 'anime',
        enableSeasonFolders: true,
        monitorNewItems: 'all',
        overrideRule: [],
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.TV,
        tmdbId: 1399,
        tvdbId: 121361,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    (
      mock.method as (
        object: object,
        methodName: string,
        implementation: () => Promise<unknown>
      ) => unknown
    )(ExternalAPI.prototype, 'get', async () => ({
      id: 1399,
      name: 'Game of Thrones',
      external_ids: { tvdb_id: 121361 },
      keywords: { results: [] },
    }));

    const originalCreate = axios.create;
    let addPayload: Record<string, unknown> | undefined;
    mock.method(axios, 'create', (config: { baseURL?: string }) => {
      if (config?.baseURL === 'https://api.themoviedb.org/3') {
        return originalCreate.call(axios, config);
      }

      return {
        interceptors: { request: { use: () => undefined } },
        get: async (endpoint: string) => {
          if (endpoint === '/series/lookup') {
            return {
              data: [
                {
                  title: 'Game of Thrones',
                  tvdbId: 121361,
                  seasons: [
                    { seasonNumber: 1, monitored: false },
                    { seasonNumber: 2, monitored: false },
                  ],
                  tags: [],
                },
              ],
            };
          }

          throw new Error(`Unexpected GET ${endpoint}`);
        },
        post: async (endpoint: string, payload: Record<string, unknown>) => {
          assert.equal(endpoint, '/series');
          addPayload = payload;

          return {
            data: {
              id: 88,
              title: 'Game of Thrones',
              titleSlug: 'game-of-thrones',
            },
          };
        },
      };
    });

    mock.method(MediaRequest, 'sendNotification', async () => undefined);
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.TV,
        status: MediaRequestStatus.APPROVED,
        media,
        requestedBy,
        is4k: false,
        seasons: [
          new SeasonRequest({
            seasonNumber: 1,
            status: MediaRequestStatus.APPROVED,
          }),
          new SeasonRequest({
            seasonNumber: 2,
            status: MediaRequestStatus.APPROVED,
          }),
        ],
      })
    );

    await new MediaRequestSubscriber().sendToSonarr(request);
    await waitForAsyncDispatch(() => !!addPayload);

    assert.equal(addPayload?.tvdbId, 121361);
    assert.equal(addPayload?.qualityProfileId, 6);
    assert.equal(addPayload?.languageProfileId, 1);
    assert.equal(addPayload?.rootFolderPath, '/tv');
    assert.equal(addPayload?.seasonFolder, true);
    assert.equal(addPayload?.seriesType, 'standard');
    assert.equal(addPayload?.monitorNewItems, 'all');
    assert.deepStrictEqual(addPayload?.addOptions, {
      ignoreEpisodesWithFiles: true,
      searchForMissingEpisodes: true,
    });
    assert.deepStrictEqual(addPayload?.seasons, [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ]);
    assert.deepStrictEqual(addPayload?.tags, [14]);

    const savedMedia = await waitForSavedMedia(
      media.id,
      (media) => media.externalServiceId === 88
    );
    assert.equal(savedMedia.externalServiceId, 88);
    assert.equal(savedMedia.externalServiceSlug, 'game-of-thrones');
    assert.equal(savedMedia.serviceId, 31);
  });

  it('sends approved music requests to Lidarr and completes the request', async () => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 10,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 7,
        activeProfileName: 'Lossless',
        activeMetadataProfileId: 8,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [3],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'release-group-id',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    const searchMock = mock.method(
      LidarrAPI.prototype,
      'searchAlbumByMusicBrainzId',
      async () =>
        [
          {
            id: 1,
            mbId: 'release-group-id',
            media_type: 'music',
            album: {
              title: 'Kind of Blue',
              disambiguation: '',
              overview: 'Album overview',
              artistId: 2,
              foreignAlbumId: 'release-group-id',
              duration: 2700,
              albumType: 'Album',
              mediumCount: 1,
              ratings: { votes: 1, value: 10 },
              releaseDate: '1959-08-17',
              genres: ['Jazz'],
              images: [],
              links: [],
              artist: {
                id: 2,
                status: 'continuing',
                ended: false,
                artistName: 'Miles Davis',
                foreignArtistId: 'artist-id',
                tadbId: 0,
                discogsId: 0,
                overview: 'Artist overview',
                artistType: 'Person',
                disambiguation: '',
                links: [],
                images: [],
                genres: ['Jazz'],
                cleanName: 'milesdavis',
                sortName: 'davis miles',
                tags: [],
                added: '2026-01-01T00:00:00Z',
                ratings: { votes: 1, value: 10 },
              },
            },
          },
        ] as unknown as Awaited<
          ReturnType<LidarrAPI['searchAlbumByMusicBrainzId']>
        >
    );
    let addPayload: LidarrAlbumOptions | undefined;
    mock.method(
      LidarrAPI.prototype,
      'addAlbum',
      async (payload: LidarrAlbumOptions) => {
        addPayload = payload;

        return {
          id: 44,
          titleSlug: 'kind-of-blue',
        } as Awaited<ReturnType<LidarrAPI['addAlbum']>>;
      }
    );

    await new MediaRequestSubscriber().sendToLidarr(request);

    assert.strictEqual(
      searchMock.mock.calls[0].arguments[0],
      'release-group-id'
    );
    assert.equal(addPayload?.profileId, 7);
    assert.equal(addPayload?.artist.metadataProfileId, 8);
    assert.equal(addPayload?.artist.rootFolderPath, '/music');
    assert.deepStrictEqual(addPayload?.artist.tags, [3]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.externalServiceId, 44);
    assert.equal(savedMedia.externalServiceSlug, 'kind-of-blue');
    assert.equal(savedMedia.serviceId, 10);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('preserves zero-valued Lidarr profile overrides during dispatch', async () => {
    const settings = getSettings();
    settings.lidarr = [
      {
        id: 0,
        name: 'Lidarr',
        hostname: 'lidarr.local',
        port: 8686,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 7,
        activeProfileName: 'Lossless',
        activeMetadataProfileId: 8,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/music',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'zero-profile-release-group',
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.serverId = 0;
    request.profileId = 0;
    request.metadataProfileId = 0;

    mock.method(LidarrAPI.prototype, 'searchAlbumByMusicBrainzId', async () => [
      {
        album: {
          title: 'Zero Profile Album',
          disambiguation: '',
          overview: 'Album overview',
          artistId: 2,
          foreignAlbumId: 'zero-profile-release-group',
          duration: 2700,
          albumType: 'Album',
          mediumCount: 1,
          ratings: { votes: 1, value: 10 },
          releaseDate: '2026-01-01',
          genres: ['Rock'],
          images: [],
          links: [],
          artist: {
            id: 2,
            status: 'continuing',
            ended: false,
            artistName: 'Zero Profile Artist',
            foreignArtistId: 'artist-id',
            tadbId: 0,
            discogsId: 0,
            overview: 'Artist overview',
            artistType: 'Group',
            disambiguation: '',
            links: [],
            images: [],
            genres: ['Rock'],
            cleanName: 'zeroprofileartist',
            sortName: 'zero profile artist',
            tags: [],
            added: '2026-01-01T00:00:00Z',
            ratings: { votes: 1, value: 10 },
          },
        },
      },
    ]);

    let addPayload: LidarrAlbumOptions | undefined;
    mock.method(
      LidarrAPI.prototype,
      'addAlbum',
      async (payload: LidarrAlbumOptions) => {
        addPayload = payload;

        return {
          id: 45,
          titleSlug: 'zero-profile-album',
        } as Awaited<ReturnType<LidarrAPI['addAlbum']>>;
      }
    );

    await new MediaRequestSubscriber().sendToLidarr(request);

    assert.equal(addPayload?.profileId, 0);
    assert.equal(addPayload?.artist.metadataProfileId, 0);
  });

  it('resolves approved book requests through ISBN before title and stores Readarr identifiers', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
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
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.serverId = 20;
    request.profileId = 0;
    request.metadataProfileId = 0;

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Left Hand of Darkness',
    }));

    const lookupTerms: string[] = [];
    mock.method(ReadarrAPI.prototype, 'lookupBook', async (term: string) => {
      lookupTerms.push(term);

      if (term === '9780441478125') {
        return [];
      }

      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });
    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;

        return {
          ...payload,
          id: 55,
          titleSlug: 'left-hand-darkness',
        };
      }
    );
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepStrictEqual(lookupTerms, [
      '9780441478125',
      'isbn:9780441478125',
    ]);
    assert.equal(addPayload?.qualityProfileId, 0);
    assert.equal(addPayload?.foreignBookId, 'readarr-work-id');
    assert.equal(addPayload?.metadataProfileId, 0);
    assert.equal(addPayload?.rootFolderPath, '/books');
    assert.deepStrictEqual(addPayload?.tags, [4]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.externalServiceId, 55);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness');
    assert.equal(savedMedia.serviceId, 20);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('expands Bookshelf lookup to OpenLibrary edition ISBNs when canonical lookup misses', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL27448W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780000000000',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL27448W',
      title: 'The Lord of the Rings',
      authors: [{ author: { key: '/authors/OL26320A' } }],
    }));
    mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => ({
      key: '/authors/OL26320A',
      name: 'J.R.R. Tolkien',
    }));
    mock.method(OpenLibraryAPI.prototype, 'getWorkEditions', async () => ({
      size: 1,
      entries: [
        {
          key: '/books/OL1M',
          title: 'The Lord of the Rings',
          isbn_13: ['9780007124015'],
        },
      ],
    }));

    const lookupTerms: string[] = [];
    mock.method(ReadarrAPI.prototype, 'lookupBook', async (term: string) => {
      lookupTerms.push(term);

      if (term !== 'isbn:9780007124015') {
        return [];
      }

      return [
        {
          title: 'The Lord of the Rings',
          foreignBookId: 'readarr-expanded-id',
          titleSlug: 'lord-of-the-rings',
          author: {
            foreignAuthorId: 'tolkien-author-id',
            authorName: 'J.R.R. Tolkien',
          },
          editions: [
            {
              foreignEditionId: 'expanded-edition-id',
              title: 'The Lord of the Rings',
              isbn13: '9780007124015',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });
    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;

        return {
          ...payload,
          id: 56,
          titleSlug: 'lord-of-the-rings',
        };
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepStrictEqual(lookupTerms, [
      '9780000000000',
      'isbn:9780000000000',
      'The Lord of the Rings',
      'The Lord of the Rings J.R.R. Tolkien',
      'J.R.R. Tolkien The Lord of the Rings',
      'isbn:9780007124015',
    ]);
    assert.equal(addPayload?.foreignBookId, 'readarr-expanded-id');

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('does not save Bookshelf identifiers already linked to another book media row', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: true,
          }),
        ],
      })
    );
    const otherMedia = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.UNKNOWN,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.READARR,
            value: 'readarr-work-id',
            canonical: true,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.serverId = 20;

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) =>
        ({
          ...payload,
          id: 55,
          titleSlug: 'left-hand-darkness',
        }) as Awaited<ReturnType<ReadarrAPI['addBook']>>
    );
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    const readarrIdentifiers = await getRepository(MediaIdentifier).find({
      where: {
        provider: MediaIdentifierProvider.READARR,
        value: 'readarr-work-id',
      },
      relations: { media: true },
    });

    assert.equal(readarrIdentifiers.length, 1);
    assert.equal(readarrIdentifiers[0].media.id, otherMedia.id);
  });

  it('fails book requests without posting incomplete Bookshelf metadata', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.OPENLIBRARY,
            value: 'OL46125W',
            canonical: true,
          }),
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780007115877',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL46125W',
      title: 'Foundation',
      authors: [{ author: { key: '/authors/OL34221A' } }],
    }));
    mock.method(OpenLibraryAPI.prototype, 'getAuthor', async () => ({
      key: '/authors/OL34221A',
      name: 'Isaac Asimov',
    }));
    mock.method(OpenLibraryAPI.prototype, 'getWorkEditions', async () => ({
      size: 1,
      entries: [
        {
          key: '/books/OL1M',
          title: 'Foundation',
          isbn_13: ['9780007115877'],
        },
      ],
    }));
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'Articles on Foundation Universe Books, Including',
        foreignBookId: '17897706',
        author: undefined,
        editions: undefined,
      },
    ]);
    const addBook = mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => ({
        ...payload,
        id: 999,
      })
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addBook.mock.callCount(), 0);
    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.FAILED);
  });

  it('hydrates Bookshelf softcover lookup records through author lookup before adding', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780547928227',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => [
      {
        title: 'The Hobbit, or There and Back Again',
        foreignBookId: '1540236',
        foreignEditionId: '5907',
        authorTitle: 'tolkien, j.r.r. The Hobbit, or There and Back Again',
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'lookupAuthor', async (term: string) => [
      {
        foreignAuthorId: term.toLocaleLowerCase().includes('tolkien')
          ? '656983'
          : '',
        authorName: 'J.R.R. Tolkien',
      },
    ]);

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;

        return {
          ...payload,
          id: 56,
          titleSlug: '1540236',
        };
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addPayload?.foreignBookId, '1540236');
    assert.equal(addPayload?.author?.foreignAuthorId, '656983');
    assert.equal(addPayload?.editions?.[0]?.foreignEditionId, '5907');
    assert.equal(addPayload?.editions?.[0]?.isbn13, '9780547928227');
    assert.equal(addPayload?.editions?.[0]?.monitored, true);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('retries transient Bookshelf lookup failures before dispatching a book request', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    await getRepository(MediaRequest).update(request.id, {
      status: MediaRequestStatus.APPROVED,
    });

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => undefined);

    let lookupAttempts = 0;
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      lookupAttempts += 1;

      if (lookupAttempts < 3) {
        throw new Error(
          '[Readarr] Failed to lookup book: Request failed with status code 503'
        );
      }

      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;

        return {
          ...payload,
          id: 55,
          titleSlug: 'left-hand-darkness',
        };
      }
    );
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(lookupAttempts, 3);
    assert.equal(addPayload?.foreignBookId, 'readarr-work-id');

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('retries Hardcover-backed Bookshelf rate-limit failures surfaced as internal server errors', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9788427249530',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    await getRepository(MediaRequest).update(request.id, {
      status: MediaRequestStatus.APPROVED,
    });

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => undefined);

    let lookupAttempts = 0;
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      lookupAttempts += 1;

      if (lookupAttempts < 3) {
        throw new Error(
          '[Readarr] Failed to lookup book: HTTP request failed: [500:InternalServerError] [GET] at [https://hardcover.bookinfo.pro/search?q=9788427249530] looking up: returned error 429'
        );
      }

      return [
        {
          title: 'Diary of a Wimpy Kid',
          foreignBookId: 'readarr-book-id',
          titleSlug: 'diary-of-a-wimpy-kid',
          author: {
            foreignAuthorId: 'jeff-kinney-author-id',
            authorName: 'Jeff Kinney',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'Diary of a Wimpy Kid',
              isbn13: '9788427249530',
              monitored: true,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => ({
        ...payload,
        id: 57,
        titleSlug: 'diary-of-a-wimpy-kid',
      })
    );
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(lookupAttempts, 3);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('keeps Hardcover rate-limited book requests approved instead of failing hard', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9788427249530',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    await getRepository(MediaRequest).update(request.id, {
      status: MediaRequestStatus.APPROVED,
    });

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => undefined);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      throw new Error(
        '[Readarr] Failed to lookup book: HTTP request failed: [500:InternalServerError] [GET] at [https://hardcover.bookinfo.pro/search?q=9788427249530] looking up: returned error 429'
      );
    });
    const sendNotification = mock.method(
      notificationManager,
      'sendNotification',
      () => undefined
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.APPROVED);
    assert.equal(sendNotification.mock.callCount(), 0);
  });

  it('honors Retry-After headers for rate-limited book request dispatch retries', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Bookshelf',
        hostname: 'bookshelf.local',
        port: 8787,
        apiKey: 'test-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Books',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/books',
        tags: [],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9788427249530',
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    await getRepository(MediaRequest).update(request.id, {
      status: MediaRequestStatus.APPROVED,
    });

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => undefined);
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      const axiosError = new Error(
        'Request failed with status code 429'
      ) as Error & {
        response: { headers: Record<string, string> };
      };
      axiosError.response = { headers: { 'retry-after': '2' } };

      throw new Error('[Readarr] Failed to lookup book: rate limited', {
        cause: axiosError,
      });
    });
    mock.method(notificationManager, 'sendNotification', () => undefined);

    await new MediaRequestSubscriber().sendToReadarr(request);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.APPROVED);
  });

  it('sends audiobook requests to the default audiobook Bookshelf server', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'audiobook';

    mock.method(OpenLibraryAPI.prototype, 'getWork', async () => ({
      key: '/works/OL45804W',
      title: 'The Left Hand of Darkness',
    }));
    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-audio-id',
          titleSlug: 'the-left-hand-of-darkness-audio',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'audio-edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;
        return {
          ...payload,
          id: 41,
          titleSlug: 'the-left-hand-of-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addPayload?.rootFolderPath, '/audiobooks');
    assert.equal(addPayload?.qualityProfileId, 31);
    assert.equal(addPayload?.metadataProfileId, 32);
    assert.deepEqual(addPayload?.tags, [9]);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
    assert.equal(
      savedMedia.audiobookExternalServiceSlug,
      'the-left-hand-of-darkness-audio'
    );
  });

  it('fails audiobook dispatch when the selected Bookshelf server is ebook-only', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'audiobook';
    request.serverId = 20;

    const lookupMock = mock.method(
      ReadarrAPI.prototype,
      'lookupBook',
      async () => [] as ReadarrBookLookupResult[]
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(lookupMock.mock.callCount(), 0);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.FAILED);
  });

  it('does not treat ebook availability as audiobook availability', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.AVAILABLE,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'ebook-slug',
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'audiobook';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-audio-id',
          titleSlug: 'left-hand-darkness-audio',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'audio-edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addPayload: ReadarrBookOptions | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayload = payload;
        return {
          ...payload,
          id: 41,
          titleSlug: 'left-hand-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.equal(addPayload?.rootFolderPath, '/audiobooks');

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
  });

  it('sends both-format book requests to ebook and audiobook Bookshelf servers', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    const addPayloads: ReadarrBookOptions[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayloads.push(payload);
        const isAudio = payload.rootFolderPath === '/audiobooks';

        return {
          ...payload,
          id: isAudio ? 41 : 40,
          titleSlug: isAudio
            ? 'left-hand-darkness-audio'
            : 'left-hand-darkness-ebook',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepEqual(
      addPayloads.map((payload) => ({
        rootFolderPath: payload.rootFolderPath,
        qualityProfileId: payload.qualityProfileId,
        metadataProfileId: payload.metadataProfileId,
        tags: payload.tags,
      })),
      [
        {
          rootFolderPath: '/ebooks',
          qualityProfileId: 11,
          metadataProfileId: 12,
          tags: [4],
        },
        {
          rootFolderPath: '/audiobooks',
          qualityProfileId: 31,
          metadataProfileId: 32,
          tags: [9],
        },
      ]
    );

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);
    assert.equal(
      savedMedia.audiobookExternalServiceSlug,
      'left-hand-darkness-audio'
    );
  });

  it('keeps the ebook service link when the audiobook half of a both request fails', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    let addCount = 0;
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addCount += 1;

        if (addCount === 2) {
          throw new Error('Audiobook backend unavailable');
        }

        return {
          ...payload,
          id: 40,
          titleSlug: 'left-hand-darkness-ebook',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, null);
    assert.equal(savedMedia.audiobookExternalServiceId, null);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.FAILED);
  });

  it('skips an existing ebook link when retrying a partial both-format book request', async () => {
    const settings = getSettings();
    settings.readarr = [
      {
        id: 20,
        name: 'Ebook Bookshelf',
        hostname: 'ebooks.local',
        port: 8787,
        apiKey: 'ebook-key',
        useSsl: false,
        activeProfileId: 11,
        activeProfileName: 'Ebooks',
        activeMetadataProfileId: 12,
        activeMetadataProfileName: 'Standard',
        activeDirectory: '/ebooks',
        tags: [4],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'ebook',
      },
      {
        id: 21,
        name: 'Audio Bookshelf',
        hostname: 'audio.local',
        port: 8787,
        apiKey: 'audio-key',
        useSsl: false,
        activeProfileId: 31,
        activeProfileName: 'Audiobooks',
        activeMetadataProfileId: 32,
        activeMetadataProfileName: 'Audio Standard',
        activeDirectory: '/audiobooks',
        tags: [9],
        is4k: false,
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        serviceType: 'audiobook',
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'left-hand-darkness-ebook',
        identifiers: [
          new MediaIdentifier({
            provider: MediaIdentifierProvider.ISBN,
            value: '9780441478125',
            canonical: false,
          }),
        ],
      })
    );
    const request = await createApprovedRequest(media, requestedBy);
    request.bookFormat = 'both';

    mock.method(ReadarrAPI.prototype, 'lookupBook', async () => {
      return [
        {
          title: 'The Left Hand of Darkness',
          foreignBookId: 'readarr-work-id',
          titleSlug: 'left-hand-darkness',
          author: {
            foreignAuthorId: 'le-guin-author-id',
            authorName: 'Ursula K. Le Guin',
          },
          editions: [
            {
              foreignEditionId: 'edition-id',
              title: 'The Left Hand of Darkness',
              isbn13: '9780441478125',
              monitored: false,
            },
          ],
        },
      ] as ReadarrBookLookupResult[];
    });

    const addPayloads: ReadarrBookOptions[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'addBook',
      async (payload: ReadarrBookOptions) => {
        addPayloads.push(payload);
        return {
          ...payload,
          id: 41,
          titleSlug: 'left-hand-darkness-audio',
        } as Awaited<ReturnType<ReadarrAPI['addBook']>>;
      }
    );

    await new MediaRequestSubscriber().sendToReadarr(request);

    assert.deepEqual(
      addPayloads.map((payload) => payload.rootFolderPath),
      ['/audiobooks']
    );

    const savedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(savedMedia.serviceId, 20);
    assert.equal(savedMedia.externalServiceId, 40);
    assert.equal(savedMedia.externalServiceSlug, 'left-hand-darkness-ebook');
    assert.equal(savedMedia.audiobookServiceId, 21);
    assert.equal(savedMedia.audiobookExternalServiceId, 41);

    const savedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(savedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('resets stale music processing status when the last request is declined', async () => {
    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MUSIC,
        tmdbId: 0,
        mbId: 'declined-release-group-id',
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MUSIC,
        status: MediaRequestStatus.DECLINED,
        media,
        requestedBy,
        is4k: false,
      })
    );

    await new MediaRequestSubscriber().updateParentStatus(request);

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.status, MediaStatus.UNKNOWN);
  });

  it('preserves book availability after declining the last missing-format request', async () => {
    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.BOOK,
        tmdbId: 0,
        status: MediaStatus.PROCESSING,
        status4k: MediaStatus.UNKNOWN,
        serviceId: 20,
        externalServiceId: 40,
        externalServiceSlug: 'ebook-slug',
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.BOOK,
        status: MediaRequestStatus.DECLINED,
        media,
        requestedBy,
        is4k: false,
        bookFormat: 'audiobook',
      })
    );

    await new MediaRequestSubscriber().updateParentStatus(request);

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.status, MediaStatus.AVAILABLE);
    assert.equal(updatedMedia.serviceId, 20);
    assert.equal(updatedMedia.externalServiceId, 40);
    assert.equal(updatedMedia.audiobookServiceId, null);
  });
});
