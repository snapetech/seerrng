const clickFirstTitleCardInSlider = (sliderTitle: string): void => {
  cy.contains('.slider-header', sliderTitle)
    .next('[data-testid=media-slider]')
    .find('[data-testid=title-card]')
    .first()
    .trigger('mouseover')
    .find('[data-testid=title-card-title]')
    .invoke('text')
    .then((text) => {
      cy.contains('.slider-header', sliderTitle)
        .next('[data-testid=media-slider]')
        .find('[data-testid=title-card]')
        .first()
        .click();
      cy.get('[data-testid=media-title]').should('contain', text);
    });
};

describe('Discover', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('loads a trending item', () => {
    cy.intercept('/api/v1/discover/trending*').as('getTrending');
    cy.visit('/');
    cy.wait('@getTrending');
    clickFirstTitleCardInSlider('Trending');
  });

  it('loads popular movies', () => {
    cy.intercept('/api/v1/discover/movies*').as('getPopularMovies');
    cy.visit('/');
    cy.wait('@getPopularMovies');
    clickFirstTitleCardInSlider('Popular Movies');
  });

  it('loads upcoming movies', () => {
    cy.intercept('/api/v1/discover/movies?page=1&primaryReleaseDateGte*').as(
      'getUpcomingMovies'
    );
    cy.visit('/');
    cy.wait('@getUpcomingMovies');
    clickFirstTitleCardInSlider('Upcoming Movies');
  });

  it('loads popular series', () => {
    cy.intercept('/api/v1/discover/tv*').as('getPopularTv');
    cy.visit('/');
    cy.wait('@getPopularTv');
    clickFirstTitleCardInSlider('Popular Series');
  });

  it('loads upcoming series', () => {
    cy.intercept('/api/v1/discover/tv?page=1&firstAirDateGte=*').as(
      'getUpcomingSeries'
    );
    cy.visit('/');
    cy.wait('@getUpcomingSeries');
    clickFirstTitleCardInSlider('Upcoming Series');
  });

  it('displays error for media with invalid TMDB ID', () => {
    cy.intercept('GET', '/api/v1/media?*', {
      pageInfo: { pages: 1, pageSize: 20, results: 1, page: 1 },
      results: [
        {
          downloadStatus: [],
          downloadStatus4k: [],
          id: 1922,
          mediaType: 'movie',
          tmdbId: 998814,
          tvdbId: null,
          imdbId: null,
          status: 5,
          status4k: 1,
          createdAt: '2022-08-18T18:11:13.000Z',
          updatedAt: '2022-08-18T19:56:41.000Z',
          lastSeasonChange: '2022-08-18T19:56:41.000Z',
          mediaAddedAt: '2022-08-18T19:56:41.000Z',
          serviceId: null,
          serviceId4k: null,
          externalServiceId: null,
          externalServiceId4k: null,
          externalServiceSlug: null,
          externalServiceSlug4k: null,
          ratingKey: null,
          ratingKey4k: null,
          seasons: [],
        },
      ],
    }).as('getMedia');

    cy.visit('/');
    cy.wait('@getMedia');
    cy.contains('.slider-header', 'Recently Added')
      .next('[data-testid=media-slider]')
      .find('[data-testid=title-card]')
      .first()
      .find('[data-testid=title-card-title]')
      .contains('Movie Not Found');
  });

  it('displays error for request with invalid TMDB ID', () => {
    cy.intercept('GET', '/api/v1/request?*', {
      pageInfo: { pages: 1, pageSize: 10, results: 1, page: 1 },
      results: [
        {
          id: 582,
          status: 1,
          createdAt: '2022-08-18T18:11:13.000Z',
          updatedAt: '2022-08-18T18:11:13.000Z',
          type: 'movie',
          is4k: false,
          serverId: null,
          profileId: null,
          rootFolder: null,
          languageProfileId: null,
          tags: null,
          media: {
            downloadStatus: [],
            downloadStatus4k: [],
            id: 1922,
            mediaType: 'movie',
            tmdbId: 998814,
            tvdbId: null,
            imdbId: null,
            status: 2,
            status4k: 1,
            createdAt: '2022-08-18T18:11:13.000Z',
            updatedAt: '2022-08-18T18:11:13.000Z',
            lastSeasonChange: '2022-08-18T18:11:13.000Z',
            mediaAddedAt: null,
            serviceId: null,
            serviceId4k: null,
            externalServiceId: null,
            externalServiceId4k: null,
            externalServiceSlug: null,
            externalServiceSlug4k: null,
            ratingKey: null,
            ratingKey4k: null,
          },
          seasons: [],
          modifiedBy: null,
          requestedBy: {
            permissions: 4194336,
            id: 18,
            email: 'friend@seerr.dev',
            plexUsername: null,
            username: '',
            recoveryLinkExpirationDate: null,
            userType: 2,
            avatar:
              'https://gravatar.com/avatar/c77fdc27cab83732b8623d2ea873d330?default=mm&size=200',
            movieQuotaLimit: null,
            movieQuotaDays: null,
            tvQuotaLimit: null,
            tvQuotaDays: null,
            createdAt: '2022-08-17T04:55:28.000Z',
            updatedAt: '2022-08-17T04:55:28.000Z',
            requestCount: 1,
            displayName: 'friend@seerr.dev',
          },
          seasonCount: 0,
        },
      ],
    }).as('getRequests');

    cy.visit('/');
    cy.wait('@getRequests');
    cy.contains('.slider-header', 'Recent Requests')
      .next('[data-testid=media-slider]')
      .find('[data-testid=request-card]')
      .first()
      .find('[data-testid=request-card-title]')
      .contains('Movie Not Found');
  });

  it('deep-links failed book and music request cards to manage slideovers', () => {
    const requestedBy = {
      permissions: 4194336,
      id: 18,
      email: 'friend@seerr.dev',
      plexUsername: null,
      username: '',
      recoveryLinkExpirationDate: null,
      userType: 2,
      avatar:
        'https://gravatar.com/avatar/c77fdc27cab83732b8623d2ea873d330?default=mm&size=200',
      movieQuotaLimit: null,
      movieQuotaDays: null,
      tvQuotaLimit: null,
      tvQuotaDays: null,
      createdAt: '2022-08-17T04:55:28.000Z',
      updatedAt: '2022-08-17T04:55:28.000Z',
      requestCount: 1,
      displayName: 'friend@seerr.dev',
    };

    cy.intercept('GET', '/api/v1/request?*', {
      pageInfo: { pages: 1, pageSize: 10, results: 2, page: 1 },
      results: [
        {
          id: 701,
          status: 4,
          createdAt: '2026-05-15T00:00:00.000Z',
          updatedAt: '2026-05-15T00:00:00.000Z',
          type: 'book',
          is4k: false,
          serverId: null,
          profileId: null,
          metadataProfileId: null,
          rootFolder: null,
          languageProfileId: null,
          tags: null,
          bookFormat: 'ebook',
          media: {
            downloadStatus: [],
            audiobookDownloadStatus: [],
            id: 9701,
            mediaType: 'book',
            tmdbId: 0,
            status: 1,
            status4k: 1,
            identifiers: [{ provider: 'openlibrary', value: 'OLCARDFAILEDW' }],
          },
          seasons: [],
          modifiedBy: null,
          requestedBy,
          seasonCount: 0,
        },
        {
          id: 702,
          status: 4,
          createdAt: '2026-05-15T00:00:00.000Z',
          updatedAt: '2026-05-15T00:00:00.000Z',
          type: 'music',
          is4k: false,
          serverId: null,
          profileId: null,
          metadataProfileId: null,
          rootFolder: null,
          languageProfileId: null,
          tags: null,
          media: {
            downloadStatus: [],
            id: 9702,
            mediaType: 'music',
            tmdbId: 0,
            mbId: '56565656-5656-5656-5656-565656565656',
            status: 1,
            status4k: 1,
          },
          seasons: [],
          modifiedBy: null,
          requestedBy,
          seasonCount: 0,
        },
      ],
      serviceErrors: {
        radarr: [],
        sonarr: [],
        lidarr: [],
        readarr: [],
      },
    }).as('getRequests');
    cy.intercept('GET', '/api/v1/book/OLCARDFAILEDW', {
      id: 'OLCARDFAILEDW',
      mediaType: 'book',
      title: 'Failed Card Book',
      author: 'Card Author',
      firstPublishYear: 2026,
      isbnCandidates: [],
      subjects: [],
    });
    cy.intercept('GET', '/api/v1/music/56565656-5656-5656-5656-565656565656', {
      id: '56565656-5656-5656-5656-565656565656',
      mbId: '56565656-5656-5656-5656-565656565656',
      mediaType: 'album',
      title: 'Failed Card Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '78787878-7878-7878-7878-787878787878',
        name: 'Card Artist',
      },
      tracks: [],
    });

    cy.visit('/');
    cy.wait('@getRequests');
    cy.contains('.slider-header', 'Recent Requests')
      .next('[data-testid=media-slider]')
      .contains('[data-testid=request-card]', 'Failed Card Book')
      .find('a[href="/book/OLCARDFAILEDW?manage=1"]')
      .should('contain', 'Failed');
    cy.contains('.slider-header', 'Recent Requests')
      .next('[data-testid=media-slider]')
      .contains('[data-testid=request-card]', 'Failed Card Album')
      .find('a[href="/music/56565656-5656-5656-5656-565656565656?manage=1"]')
      .should('contain', 'Failed');
  });

  it('loads plex watchlist', () => {
    cy.intercept('/api/v1/discover/watchlist', {
      fixture: 'watchlist.json',
    }).as('getWatchlist');
    // Wait for one of the watchlist movies to resolve
    cy.intercept('/api/v1/movie/361743').as('getTmdbMovie');

    cy.visit('/');

    cy.wait('@getWatchlist');

    const sliderHeader = cy.contains('.slider-header', 'Watchlist');

    sliderHeader.scrollIntoView();

    cy.wait('@getTmdbMovie');
    // Wait a little longer to make sure the movie component reloaded
    cy.wait(500);

    sliderHeader
      .next('[data-testid=media-slider]')
      .find('[data-testid=title-card]')
      .first()
      .trigger('mouseover')
      .find('[data-testid=title-card-title]')
      .invoke('text')
      .then((text) => {
        cy.contains('.slider-header', 'Watchlist')
          .next('[data-testid=media-slider]')
          .find('[data-testid=title-card]')
          .first()
          .click();
        cy.get('[data-testid=media-title]').should('contain', text);
      });
  });
});
