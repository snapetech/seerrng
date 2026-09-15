describe('Books and Music discover parity', () => {
  const themePalettes = [
    'aurora',
    'ember',
    'lagoon',
    'orchid',
    'forest',
    'sapphire',
    'rosewood',
    'citrus',
    'arctic',
    'grape',
    'coral',
    'mint',
    'steel',
    'gold',
    'plum',
    'skyline',
    'moss',
    'flame',
    'violet',
    'ocean',
    'sietch-neon',
  ];

  const unrestrictedQuota = {
    movie: { used: 0, restricted: false },
    tv: { used: 0, restricted: false },
    music: { used: 0, restricted: false },
    book: { used: 0, restricted: false },
  };

  const serviceDetails = (serverName: string, path: string) => ({
    server: {
      id: 1,
      name: serverName,
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeMetadataProfileId: 1,
      activeDirectory: path,
      activeTags: [],
    },
    profiles: [{ id: 1, name: 'Default' }],
    metadataProfiles: [{ id: 1, name: 'Default' }],
    rootFolders: [{ id: 1, path, freeSpace: 1000000000 }],
    tags: [],
  });

  const assertStandardManageActions = () => {
    cy.get('[role="dialog"]').then(($dialog) => {
      const dialogWidth = $dialog[0].getBoundingClientRect().width;

      cy.get(
        '[data-testid="manage-advanced-actions"] .app-button, [data-testid="modal-cancel-button"]'
      )
        .should('have.length.greaterThan', 0)
        .each(($button) => {
          const bounds = $button[0].getBoundingClientRect();
          const styles = window.getComputedStyle($button[0]);

          expect($button).to.have.class('button-standard');
          expect(bounds.height).to.eq(30);
          expect(styles.fontSize).to.eq('12px');
          expect(bounds.width).to.be.lessThan(dialogWidth - 32);
        });
    });
  };

  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('opens the theme picker and persists document theme attributes', () => {
    cy.viewport(1400, 900);
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMoviesForTheme');

    cy.visit('/discover/movies', {
      onBeforeLoad(win) {
        win.localStorage.removeItem('seerr-theme-mode');
        win.localStorage.removeItem('seerr-theme-palette');
      },
    });
    cy.wait('@getMoviesForTheme');

    cy.get('button[aria-label="Theme picker"]').then(($themeButton) => {
      cy.get('[data-testid=user-menu]').then(($userButton) => {
        const themeBounds = $themeButton[0].getBoundingClientRect();
        const userBounds = $userButton[0].getBoundingClientRect();

        expect(themeBounds.right).to.be.lessThan(userBounds.left);
      });
    });

    cy.get('button[aria-label="Theme picker"]').click();
    cy.contains('button', 'Lagoon').click();
    cy.get('html').should('have.attr', 'data-theme-palette', 'lagoon');

    cy.get('button[aria-label="Theme picker"]').click();
    cy.contains('button', 'Dark mode').click();
    cy.get('html').should('have.attr', 'data-theme-mode', 'light');

    cy.get('[data-testid=user-menu]').click();
    cy.contains('a', 'Sign Out').should('be.visible');
  });

  it('gives every palette a unique light and dark theme pair', () => {
    const seenAccentPairs = new Set<string>();

    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });

    themePalettes.forEach((palette) => {
      cy.visit('/discover/movies', {
        onBeforeLoad(win) {
          win.localStorage.setItem('seerr-theme-palette', palette);
          win.localStorage.setItem('seerr-theme-mode', 'dark');
        },
      });
      cy.contains('[data-testid=page-header]', 'Movies').should('be.visible');
      cy.get('html')
        .should('have.attr', 'data-theme-palette', palette)
        .and('have.attr', 'data-theme-mode', 'dark');

      cy.get('html').then(($html) => {
        const styles = getComputedStyle($html[0]);
        const accentPair = `${styles
          .getPropertyValue('--color-indigo-600')
          .trim()}|${styles.getPropertyValue('--color-purple-600').trim()}`;
        const darkBackground = styles
          .getPropertyValue('--color-gray-900')
          .trim();

        expect(
          seenAccentPairs.has(accentPair),
          `${palette} accent pair is unique`
        ).to.eq(false);
        seenAccentPairs.add(accentPair);

        cy.visit('/discover/movies', {
          onBeforeLoad(win) {
            win.localStorage.setItem('seerr-theme-palette', palette);
            win.localStorage.setItem('seerr-theme-mode', 'light');
          },
        });
        cy.contains('[data-testid=page-header]', 'Movies').should('be.visible');
        cy.get('html')
          .should('have.attr', 'data-theme-palette', palette)
          .and('have.attr', 'data-theme-mode', 'light');

        cy.get('html').then(($lightHtml) => {
          const lightStyles = getComputedStyle($lightHtml[0]);
          const lightPair = `${lightStyles
            .getPropertyValue('--color-indigo-600')
            .trim()}|${lightStyles
            .getPropertyValue('--color-purple-600')
            .trim()}`;
          const lightBackground = lightStyles
            .getPropertyValue('--color-gray-900')
            .trim();

          expect(lightPair).to.eq(accentPair);
          expect(lightBackground).not.to.eq(darkBackground);
        });
      });
    });

    cy.then(() => {
      expect(seenAccentPairs.size).to.eq(themePalettes.length);
    });
  });

  it('matches the video discover toolbar shape for books and music', () => {
    cy.viewport(1400, 900);
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMovies');
    cy.visit('/discover/movies');
    cy.wait('@getMovies');
    cy.get('.sidebar')
      .filter(':visible')
      .first()
      .within(() => {
        cy.contains(/^Discover$/).should('be.visible');
        cy.contains(/^Video$/).should('not.exist');
      });
    cy.contains('[data-testid=page-header]', 'Movies').should('be.visible');
    cy.contains('Filters').should('be.visible');
    cy.contains('button', 'Clear Filters').should('be.visible');
    cy.contains('button', 'Popularity').should('be.visible');
    cy.contains('Release Date').should('be.visible');

    cy.intercept('GET', '/api/v1/discover/books*', {
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [
        {
          id: 'OL1W',
          mediaType: 'book',
          title: 'Parity Book',
          author: 'Parity Author',
          firstPublishYear: 2026,
          posterPath: 'https://covers.openlibrary.org/b/id/1-L.jpg',
        },
      ],
    }).as('getBooks');
    cy.visit('/discover/books');
    cy.wait('@getBooks');
    cy.contains('[data-testid=page-header]', 'Books').should('be.visible');
    cy.get('button[aria-label="Genres"]').should('be.visible');
    cy.contains('Filters').should('be.visible');
    cy.get('input[aria-label="Search Books"]')
      .should('be.visible')
      .type('left hand');
    cy.contains('button', 'Recommended').should('be.visible');

    cy.intercept('GET', '/api/v1/discover/music*', {
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          mediaType: 'album',
          title: 'Parity Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Parity Artist' }],
        },
      ],
    }).as('getMusic');
    cy.visit('/discover/music');
    cy.wait('@getMusic');
    cy.contains('[data-testid=page-header]', 'Music').should('be.visible');
    cy.contains('button', 'Release Date').should('be.visible').click();
    cy.contains('button', 'Release Date').click();
    cy.location('search').should('include', 'sortBy=release_date.');
    cy.contains('button', 'Clear Filters').click();
    cy.location('search').should('not.include', 'sortBy=');
    cy.contains('Filters').should('be.visible');
    cy.get('button[aria-label="Release Year"]').should('be.visible');
    cy.get('input[aria-label="Search Music"]')
      .should('be.visible')
      .type('kind of blue');
  });

  it('clears discover filters without leaking cross-medium params', () => {
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMovies');
    cy.visit('/discover/movies?genre=28');
    cy.wait('@getMovies');
    cy.contains('button', 'Release Date').click();
    cy.location('search').should('include', 'sortBy=release_date.desc');
    cy.contains('button', 'Clear Filters').click();
    cy.location('search').should('not.include', 'genre=');
    cy.location('search').should('not.include', 'sortBy=');

    cy.intercept('GET', '/api/v1/discover/tv*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getTv');
    cy.visit('/discover/tv?status=Returning%20Series');
    cy.wait('@getTv');
    cy.contains('button', 'First Air Date').click();
    cy.location('search').should('include', 'sortBy=first_air_date.desc');
    cy.contains('button', 'Clear Filters').click();
    cy.location('search').should('not.include', 'status=');
    cy.location('search').should('not.include', 'sortBy=');

    cy.intercept('GET', '/api/v1/discover/books*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getBooks');
    cy.visit(
      '/discover/books?subject=fantasy&firstPublishYear=2020&sortBy=newest'
    );
    cy.wait('@getBooks');
    cy.contains('button', 'Clear Filters').click();
    cy.location('search').should('not.include', 'subject=');
    cy.location('search').should('not.include', 'firstPublishYear=');

    cy.intercept('GET', '/api/v1/discover/music*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMusic');
    cy.visit(
      '/discover/music?primaryReleaseDateGte=2020-01-01&primaryReleaseDateLte=2020-12-31&sortBy=release_date.asc&genre=rock'
    );
    cy.wait('@getMusic');
    cy.contains('button', 'Clear Filters').click();
    cy.location('search').should('not.include', 'primaryReleaseDateGte=');
    cy.location('search').should('not.include', 'primaryReleaseDateLte=');
    cy.location('search').should('not.include', 'genre=');
  });

  it('opens book and music request modals with matching workflow controls', () => {
    cy.intercept('GET', '/api/v1/user/*/quota', unrestrictedQuota);

    cy.intercept('GET', '/api/v1/book/OLREQW', {
      id: 'OLREQW',
      mediaType: 'book',
      title: 'Requestable Book',
      author: 'Request Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/2-L.jpg',
      isbn13: '9780000000002',
      editionId: 'OLREQM',
      isbnCandidates: [
        {
          isbn: '9780000000002',
          title: 'Requestable Book',
          editionId: 'OLREQM',
          format: 'hardcover',
        },
      ],
      subjects: ['fiction'],
    }).as('getRequestBook');
    cy.intercept('GET', '/api/v1/service/readarr', [
      {
        id: 1,
        name: 'Bookshelf Ebooks',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/books',
        activeTags: [],
        serviceType: 'ebook',
      },
      {
        id: 2,
        name: 'Bookshelf Audio',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/audiobooks',
        activeTags: [],
        serviceType: 'audiobook',
      },
    ]);
    cy.intercept('GET', '/api/v1/service/readarr/1', {
      ...serviceDetails('Bookshelf Ebooks', '/books'),
      server: {
        ...serviceDetails('Bookshelf Ebooks', '/books').server,
        serviceType: 'ebook',
      },
    });
    cy.intercept('GET', '/api/v1/service/readarr/2', {
      ...serviceDetails('Bookshelf Audio', '/audiobooks'),
      server: {
        ...serviceDetails('Bookshelf Audio', '/audiobooks').server,
        id: 2,
        serviceType: 'audiobook',
      },
    });

    cy.visit('/book/OLREQW');
    cy.wait('@getRequestBook');
    cy.contains('[data-testid=media-title]', 'Requestable Book').should(
      'be.visible'
    );
    cy.get('[data-testid=format-request-option-ebook]').click();
    cy.contains('[data-testid=modal-title]', 'Request Book').should(
      'be.visible'
    );
    cy.contains('[data-testid=media-title]', 'Requestable Book').should(
      'be.visible'
    );
    cy.contains('legend', 'Format').should('be.visible');
    cy.get('[role=radiogroup][aria-label=Format]').within(() => {
      cy.get('[title=Book]')
        .closest('[role=radio]')
        .should('have.attr', 'aria-checked', 'true');
      cy.get('[title=Audiobook]')
        .closest('[role=radio]')
        .click()
        .should('have.attr', 'aria-checked', 'true');
    });
    cy.contains('[data-testid=modal-title]', 'Request Audiobook')
      .scrollIntoView()
      .should('be.visible');
    cy.contains('[role=radio]', 'Book + Audiobook')
      .click()
      .should('have.attr', 'aria-checked', 'true');
    cy.contains('[data-testid=modal-title]', 'Request Book + Audiobook')
      .scrollIntoView()
      .should('be.visible');
    cy.contains('label', 'Edition / ISBN').should('be.visible');
    cy.get('select[name=isbn]').should('be.visible');
    cy.contains('Automatic best match').should('be.visible');
    cy.contains('Advanced').should('be.visible');
    cy.get('[data-testid=modal-cancel-button]').click();

    cy.intercept('GET', '/api/v1/music/33333333-3333-3333-3333-333333333333', {
      id: '33333333-3333-3333-3333-333333333333',
      mbId: '33333333-3333-3333-3333-333333333333',
      mediaType: 'album',
      title: 'Requestable Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Request Artist',
      },
      tracks: [
        {
          position: 1,
          name: 'Track One',
          recordingMbid: 'track-1',
          length: 0,
          artists: [],
        },
      ],
    }).as('getRequestMusic');
    cy.intercept('GET', '/api/v1/service/lidarr', [
      {
        id: 1,
        name: 'Lidarr MP3',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/music',
        activeTags: [],
      },
    ]);
    cy.intercept('GET', '/api/v1/service/lidarr/1', {
      ...serviceDetails('Lidarr MP3', '/music'),
    });

    cy.visit('/music/33333333-3333-3333-3333-333333333333');
    cy.wait('@getRequestMusic');
    cy.contains('[data-testid=media-title]', 'Requestable Album').should(
      'be.visible'
    );
    cy.get('[data-testid=format-request-option-mp3]').click();
    cy.contains('[data-testid=modal-title]', 'Request Music').should(
      'be.visible'
    );
    cy.contains('[data-testid=media-title]', 'Requestable Album').should(
      'be.visible'
    );
    cy.get('[data-testid=modal-ok-button]').should('contain', 'Request');
    cy.get('[data-testid=modal-cancel-button]').should('contain', 'Cancel');
  });

  it('loads an author bibliography modal and submits a bulk book request summary', () => {
    cy.intercept('GET', '/api/v1/user/*/quota', unrestrictedQuota);
    cy.intercept('GET', '/api/v1/service/readarr', [
      {
        id: 1,
        name: 'Bookshelf Ebooks',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/books',
        activeTags: [],
        serviceType: 'ebook',
      },
      {
        id: 2,
        name: 'Bookshelf Audio',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/audiobooks',
        activeTags: [],
        serviceType: 'audiobook',
      },
    ]);
    cy.intercept('GET', '/api/v1/service/readarr/1', {
      ...serviceDetails('Bookshelf Ebooks', '/books'),
      server: {
        ...serviceDetails('Bookshelf Ebooks', '/books').server,
        serviceType: 'ebook',
      },
    });
    cy.intercept('GET', '/api/v1/service/readarr/2', {
      ...serviceDetails('Bookshelf Audio', '/audiobooks'),
      server: {
        ...serviceDetails('Bookshelf Audio', '/audiobooks').server,
        id: 2,
        serviceType: 'audiobook',
      },
    });
    const bulkAuthorWorks = [
      {
        id: 'OLBULK1W',
        mediaType: 'book',
        title: 'Requestable Work',
        author: 'Bulk Author',
        authorId: 'OLBULKA',
        firstPublishYear: 2020,
        posterPath: 'https://covers.openlibrary.org/b/id/12-L.jpg',
        isbn13: '9780000000012',
      },
      {
        id: 'OLBULK2W',
        mediaType: 'book',
        title: 'Already Requested Work',
        author: 'Bulk Author',
        authorId: 'OLBULKA',
        firstPublishYear: 2021,
        mediaInfo: {
          id: 1202,
          status: 2,
          requests: [{ id: 1, status: 1, bookFormat: 'ebook' }],
          watchlists: [],
          downloadStatus: [],
          audiobookDownloadStatus: [],
        },
      },
      {
        id: 'OLBULK3W',
        mediaType: 'book',
        title: 'Second Requestable Work',
        author: 'Bulk Author',
        authorId: 'OLBULKA',
        firstPublishYear: 2022,
      },
    ];
    const bulkAuthorPagination = {
      limit: 20,
      offset: 0,
      totalItems: 3,
      nextOffset: 3,
    };

    cy.intercept('GET', '/api/v1/author/OLBULKA', {
      id: 'OLBULKA',
      name: 'Bulk Author',
      biography: 'Author biography',
      works: bulkAuthorWorks,
      pagination: bulkAuthorPagination,
    }).as('getBulkAuthor');
    cy.intercept('GET', '/api/v1/author/OLBULKA/works*', {
      works: bulkAuthorWorks,
      pagination: bulkAuthorPagination,
    }).as('getBulkAuthorWorks');
    cy.intercept('POST', '/api/v1/request/bulk', {
      statusCode: 207,
      body: {
        created: [{ id: 201 }, { id: 202 }],
        skipped: [
          {
            mediaId: 'OLBULK2W',
            title: 'Already Requested Work',
            reason: 'Request for this book already exists.',
          },
        ],
        failed: [
          {
            mediaId: 'OLBULK3W',
            title: 'Second Requestable Work',
            reason: 'No default Bookshelf server configured.',
          },
        ],
      },
    }).as('bulkBookRequest');

    cy.visit('/author/OLBULKA');
    cy.wait('@getBulkAuthor');
    cy.contains('h1', 'Bulk Author').should('be.visible');
    cy.contains('button', 'Request Bibliography').click();
    cy.contains(
      '[data-testid=modal-title]',
      'Request Book Bibliography'
    ).should('be.visible');
    cy.contains('Requestable Work').should('be.visible');
    cy.contains('Already Requested Work').should('be.visible');
    cy.contains('button', 'Load More').should('not.exist');
    cy.get('[role="radiogroup"][aria-label="Format"] [role="radio"]')
      .should('have.length', 3)
      .filter('[aria-checked="true"]')
      .should('contain', 'Book');
    cy.get('[role="dialog"] table')
      .contains('td', 'Already Requested Work')
      .parents('tr')
      .contains('Requested')
      .should('be.visible');
    cy.get('[role="radiogroup"][aria-label="Format"]')
      .contains('[role="radio"]', 'Book + Audiobook')
      .click();
    cy.get('[role="dialog"] table')
      .contains('td', 'Already Requested Work')
      .parents('tr')
      .contains('Not Requested')
      .should('be.visible');
    cy.get('[role="radiogroup"][aria-label="Format"]')
      .contains('[role="radio"]', 'Audiobook')
      .click();
    cy.get('[data-testid=modal-ok-button]').should(
      'contain',
      'Request 3 Items as Audiobook'
    );
    cy.get('[data-testid=modal-ok-button]').click();
    cy.wait('@bulkBookRequest').then(({ request }) => {
      expect(request?.body.format).to.equal('audiobook');
      expect(request?.body.items).to.have.length(3);
    });
    cy.contains('2 created, 1 skipped, 1 failed.').should('be.visible');
    cy.contains('Second Requestable Work').should('be.visible');
    cy.contains('No default Bookshelf server configured.').should('be.visible');
  });

  it('defaults artist discography bulk requests to albums and switches release types', () => {
    cy.intercept('GET', '/api/v1/user/*/quota', unrestrictedQuota);
    cy.intercept('GET', '/api/v1/service/lidarr', [
      {
        id: 1,
        name: 'Lidarr',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/music',
        activeTags: [],
      },
    ]);
    cy.intercept('GET', '/api/v1/service/lidarr/1', {
      ...serviceDetails('Lidarr', '/music'),
    });
    cy.intercept('GET', '/api/v1/artist/bulk-artist*', (req) => {
      if (req.query.albumType === 'Single') {
        req.reply({
          artist: { name: 'Bulk Artist' },
          releaseGroups: [
            {
              id: 'single-one',
              mediaType: 'album',
              title: 'Single One',
              'primary-type': 'Single',
              'first-release-date': '2021-01-01',
              'artist-credit': [{ name: 'Bulk Artist' }],
            },
          ],
          typeCounts: { Album: 2, Single: 1 },
          pagination: {
            page: 1,
            pageSize: 50,
            totalItems: 1,
            totalPages: 1,
            albumType: 'Single',
          },
        });
        return;
      }

      if (req.query.albumType === 'Album' && req.query.page === '2') {
        req.reply({
          artist: { name: 'Bulk Artist', area: 'US' },
          releaseGroups: [
            {
              id: 'album-two',
              mediaType: 'album',
              title: 'Album Two',
              'primary-type': 'Album',
              'first-release-date': '2018-01-01',
              'artist-credit': [{ name: 'Bulk Artist' }],
            },
          ],
          typeCounts: { Album: 3, Single: 1 },
          pagination: {
            page: 2,
            pageSize: 50,
            totalItems: 3,
            totalPages: 2,
            albumType: 'Album',
          },
        });
        return;
      }

      req.reply({
        artist: { name: 'Bulk Artist', area: 'US' },
        releaseGroups: [
          {
            id: 'album-one',
            mediaType: 'album',
            title: 'Album One',
            'primary-type': 'Album',
            'first-release-date': '2020-01-01',
            'artist-credit': [{ name: 'Bulk Artist' }],
          },
          {
            id: 'album-owned',
            mediaType: 'album',
            title: 'Owned Album',
            'primary-type': 'Album',
            'first-release-date': '2019-01-01',
            'artist-credit': [{ name: 'Bulk Artist' }],
            mediaInfo: {
              id: 1302,
              status: 5,
              requests: [],
              watchlists: [],
              downloadStatus: [],
            },
          },
        ],
        typeCounts: { Album: 3, Single: 1 },
        pagination: {
          page: 1,
          pageSize: 50,
          totalItems: 3,
          totalPages: req.query.albumType === 'Album' ? 2 : 1,
          albumType: req.query.albumType as string,
        },
      });
    }).as('getBulkArtist');
    cy.intercept('POST', '/api/v1/request/bulk', {
      statusCode: 207,
      body: {
        created: [{ id: 301 }],
        skipped: [],
        failed: [],
      },
    }).as('bulkMusicRequest');

    cy.visit('/artist/bulk-artist');
    cy.wait('@getBulkArtist');
    cy.contains('h1', 'Bulk Artist').should('be.visible');
    cy.contains('button', 'Request Discography').click();
    cy.wait('@getBulkArtist').then((interception) => {
      expect(interception.request.query.albumType).to.eq('Album');
      expect(interception.response?.body.releaseGroups).to.have.length(2);
    });
    cy.wait('@getBulkArtist').then((interception) => {
      expect(interception.request.query.albumType).to.eq('Album');
      expect(interception.request.query.page).to.eq('2');
      expect(interception.response?.body.releaseGroups[0].id).to.eq(
        'album-two'
      );
    });
    cy.contains('[data-testid=modal-title]', 'Request Discography').should(
      'be.visible'
    );
    cy.contains('Album Two').should('be.visible');
    cy.contains('label', 'Release Type').find('select').select('Single');
    cy.wait('@getBulkArtist').then((interception) => {
      expect(interception.request.query.albumType).to.eq('Single');
      expect(interception.response?.body.releaseGroups[0].id).to.eq(
        'single-one'
      );
    });
  });

  it('keeps book and music service setup modals aligned with video services', () => {
    cy.intercept('GET', '/api/v1/settings/radarr', []);
    cy.intercept('GET', '/api/v1/settings/sonarr', []);
    cy.intercept('GET', '/api/v1/settings/lidarr', []);
    cy.intercept('GET', '/api/v1/settings/readarr', []);
    cy.intercept('GET', '/api/v1/overrideRule', []);

    cy.visit('/settings/services');

    cy.contains('h3', 'Radarr Settings').should('be.visible');
    cy.contains('h3', 'Lidarr Settings').scrollIntoView().should('be.visible');
    cy.contains('h3', 'Bookshelf Settings')
      .scrollIntoView()
      .should('be.visible');

    cy.contains('button', 'Add Lidarr Server').click();
    cy.contains('[data-testid=modal-title]', 'Add New Lidarr Server').should(
      'be.visible'
    );
    cy.contains('label', 'API Key')
      .scrollIntoView()
      .closest('.form-row')
      .contains('.settings-form-row-description', 'Find it in Lidarr')
      .should('be.visible');
    cy.contains('label', 'URL Base')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'If you set a URL Base in Lidarr'
      )
      .should('be.visible');
    cy.contains('label', 'External URL')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'For clickable links on media pages'
      )
      .should('be.visible');
    cy.contains('label', 'Enable Scan')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'Scan Lidarr for existing media'
      )
      .should('be.visible');
    cy.contains('label', 'Enable Automatic Search')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'Automatically trigger a search in Lidarr'
      )
      .should('be.visible');
    cy.get('select[name=activeMetadataProfileId]')
      .scrollIntoView()
      .should('be.visible');
    cy.get('[data-testid=modal-cancel-button]').click();

    cy.contains('button', 'Add Bookshelf Server').click();
    cy.contains('[data-testid=modal-title]', 'Add New Bookshelf Server').should(
      'be.visible'
    );
    cy.contains(
      'Bookshelf is the recommended book backend. Readarr-compatible servers, including Chaptarr, can also be used. For Chaptarr, set Book Format to match the configured root folder; Seerr sends that format explicitly on every request.'
    ).should('be.visible');
    cy.contains('label', 'Book Format').should('be.visible');
    cy.get('select[name=serviceType]').should('be.visible');
    cy.contains('label', 'API Key')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'Find it in Bookshelf or Readarr'
      )
      .should('be.visible');
    cy.contains('label', 'URL Base')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'If you set a URL Base in Bookshelf, Chaptarr, or Readarr'
      )
      .should('be.visible');
    cy.contains('label', 'External URL')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'For clickable links on media pages'
      )
      .should('be.visible');
    cy.contains('label', 'Enable Scan')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'Scan Bookshelf for existing books'
      )
      .should('be.visible');
    cy.contains('label', 'Enable Automatic Search')
      .scrollIntoView()
      .closest('.form-row')
      .contains(
        '.settings-form-row-description',
        'Automatically trigger a search in Bookshelf'
      )
      .should('be.visible');
    cy.get('select[name=activeMetadataProfileId]')
      .scrollIntoView()
      .should('be.visible');
  });

  it('uses medium-specific default service warnings for music and book formats', () => {
    cy.intercept('GET', '/api/v1/settings/radarr', []);
    cy.intercept('GET', '/api/v1/settings/sonarr', []);
    cy.intercept('GET', '/api/v1/settings/lidarr', [
      {
        id: 1,
        name: 'Lidarr',
        hostname: 'lidarr',
        port: 8686,
        useSsl: false,
        activeProfileName: 'Default',
        isDefault: false,
      },
    ]);
    cy.intercept('GET', '/api/v1/settings/readarr', [
      {
        id: 1,
        name: 'Bookshelf Ebooks',
        hostname: 'bookshelf',
        port: 8787,
        useSsl: false,
        activeProfileName: 'Default',
        isDefault: false,
        serviceType: 'ebook',
      },
      {
        id: 2,
        name: 'Bookshelf Audio',
        hostname: 'bookshelf',
        port: 8787,
        useSsl: false,
        activeProfileName: 'Default',
        isDefault: false,
        serviceType: 'audiobook',
      },
    ]);
    cy.intercept('GET', '/api/v1/overrideRule', []);

    cy.visit('/settings/services');

    cy.contains(
      'At least one Lidarr server must be marked as default in order for music requests to be processed.'
    )
      .scrollIntoView()
      .should('be.visible');
    cy.contains('series requests').should('not.exist');
    cy.contains(
      'At least one Bookshelf server must be marked as default in order for book requests to be processed.'
    )
      .scrollIntoView()
      .should('be.visible');
    cy.contains(
      'At least one Bookshelf server must be marked as default in order for audiobook requests to be processed.'
    )
      .scrollIntoView()
      .should('be.visible');
  });

  it('uses medium-appropriate issue choices for books and music', () => {
    cy.intercept('GET', '/api/v1/book/OLISSUEW', {
      id: 'OLISSUEW',
      mediaType: 'book',
      title: 'Issue Book',
      author: 'Issue Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/5-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9101,
        status: 5,
        requests: [],
        issues: [],
      },
    }).as('getIssueBook');

    cy.visit('/book/OLISSUEW');
    cy.wait('@getIssueBook');
    cy.contains('[data-testid=media-title]', 'Issue Book').should('be.visible');
    cy.get('button[aria-label="Report an Issue"]').click();
    cy.get('[role=dialog]').within(() => {
      cy.contains('[data-testid=modal-title]', 'Report an Issue').should(
        'be.visible'
      );
      cy.contains('Other').should('be.visible');
      cy.contains('Video').should('not.exist');
      cy.contains('Audio').should('not.exist');
      cy.contains('Subtitle').should('not.exist');
    });
    cy.get('[data-testid=modal-cancel-button]').click();

    cy.intercept('GET', '/api/v1/music/88888888-8888-8888-8888-888888888888', {
      id: '88888888-8888-8888-8888-888888888888',
      mbId: '88888888-8888-8888-8888-888888888888',
      mediaType: 'album',
      title: 'Issue Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '99999999-9999-9999-9999-999999999999',
        name: 'Issue Artist',
      },
      tracks: [],
      mediaInfo: {
        id: 9102,
        status: 5,
        requests: [],
        issues: [],
      },
    }).as('getIssueMusic');

    cy.visit('/music/88888888-8888-8888-8888-888888888888');
    cy.wait('@getIssueMusic');
    cy.contains('[data-testid=media-title]', 'Issue Album').should(
      'be.visible'
    );
    cy.get('button[aria-label="Report an Issue"]').click();
    cy.get('[role=dialog]').within(() => {
      cy.contains('[data-testid=modal-title]', 'Report an Issue').should(
        'be.visible'
      );
      cy.get('button[aria-label="Issue Type"]').click();
      cy.contains('[role=option]', 'Audio').should('be.visible');
      cy.contains('Other').should('be.visible');
      cy.contains('Video').should('not.exist');
      cy.contains('Subtitle').should('not.exist');
    });
  });

  it('confirms book and music blocklist actions with video-style modals', () => {
    cy.intercept('GET', '/api/v1/book/OLBLOCKW', {
      id: 'OLBLOCKW',
      mediaType: 'book',
      title: 'Blocklist Book',
      author: 'Block Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/7-L.jpg',
      isbnCandidates: [],
      subjects: [],
    }).as('getBlockBook');
    cy.intercept('POST', '/api/v1/blocklist', {}).as('postBlocklist');

    cy.visit('/book/OLBLOCKW');
    cy.wait('@getBlockBook');
    cy.contains('[data-testid=media-title]', 'Blocklist Book').should(
      'be.visible'
    );
    cy.get('button[aria-label="Add to Blocklist"]').click();
    cy.contains('Are you sure you want to blocklist this item?').should(
      'be.visible'
    );
    cy.get('[data-testid=modal-ok-button]').should('contain', 'Blocklist');
    cy.get('[data-testid=modal-cancel-button]').should('contain', 'Cancel');
    cy.get('[data-testid=modal-ok-button]').click();
    cy.wait('@postBlocklist').its('request.body').should('include', {
      externalId: 'OLBLOCKW',
      externalProvider: 'openlibrary',
      mediaType: 'book',
      title: 'Blocklist Book',
    });

    cy.intercept('GET', '/api/v1/music/abababab-abab-abab-abab-abababababab', {
      id: 'abababab-abab-abab-abab-abababababab',
      mbId: 'abababab-abab-abab-abab-abababababab',
      mediaType: 'album',
      title: 'Blocklist Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artistBackdrop: 'https://assets.example.test/music-backdrop.jpg',
      artist: {
        id: 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
        name: 'Block Artist',
      },
      tracks: [],
    }).as('getBlockMusic');

    cy.visit('/music/abababab-abab-abab-abab-abababababab');
    cy.wait('@getBlockMusic');
    cy.contains('[data-testid=media-title]', 'Blocklist Album').should(
      'be.visible'
    );
    cy.get('button[aria-label="Add to Blocklist"]').click();
    cy.contains('Are you sure you want to blocklist this item?').should(
      'be.visible'
    );
    cy.get('[data-testid=modal-ok-button]').should('contain', 'Blocklist');
    cy.get('[data-testid=modal-cancel-button]').click();
  });

  it('keeps permitted blocklist actions available for owned and in-flight media', () => {
    cy.intercept('GET', '/api/v1/book/OLAVAILABLEW', {
      id: 'OLAVAILABLEW',
      mediaType: 'book',
      title: 'Available Book',
      author: 'Available Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/9-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9111,
        status: 5,
        serviceId: 1,
        externalServiceId: 101,
        requests: [],
        issues: [],
      },
    }).as('getAvailableBook');

    cy.visit('/book/OLAVAILABLEW');
    cy.wait('@getAvailableBook');
    cy.contains('[data-testid=media-title]', 'Available Book').should(
      'be.visible'
    );
    cy.get('button[aria-label="Add to Blocklist"]')
      .should('be.visible')
      .and('not.be.disabled');

    cy.intercept('GET', '/api/v1/music/12121212-1212-1212-1212-121212121212', {
      id: '12121212-1212-1212-1212-121212121212',
      mbId: '12121212-1212-1212-1212-121212121212',
      mediaType: 'album',
      title: 'Processing Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '34343434-3434-3434-3434-343434343434',
        name: 'Processing Artist',
      },
      tracks: [],
      mediaInfo: {
        id: 9112,
        status: 3,
        requests: [],
        issues: [],
      },
    }).as('getProcessingMusic');

    cy.visit('/music/12121212-1212-1212-1212-121212121212');
    cy.wait('@getProcessingMusic');
    cy.contains('[data-testid=media-title]', 'Processing Album').should(
      'be.visible'
    );
    cy.get('button[aria-label="Add to Blocklist"]')
      .should('be.visible')
      .and('not.be.disabled');
  });

  it('honors hide available for music and dual-format books', () => {
    cy.request('POST', '/api/v1/settings/main', { hideAvailable: true });
    cy.request('/api/v1/settings/public')
      .its('body.hideAvailable')
      .should('eq', true);
    cy.intercept('GET', '/api/v1/settings/public').as('getPublicSettings');

    cy.intercept('GET', '/api/v1/discover/books*', {
      page: 1,
      totalPages: 1,
      totalResults: 4,
      results: [
        {
          id: 'OLFULLW',
          mediaType: 'book',
          title: 'Fully Owned Book',
          author: 'Owned Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 5,
            serviceId: 1,
            externalServiceId: 11,
            audiobookServiceId: 2,
            audiobookExternalServiceId: 22,
            requests: [],
          },
        },
        {
          id: 'OLEBOOKW',
          mediaType: 'book',
          title: 'Ebook Only Book',
          author: 'Missing Audio Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 5,
            serviceId: 1,
            externalServiceId: 11,
            audiobookServiceId: null,
            audiobookExternalServiceId: null,
            requests: [],
          },
        },
        {
          id: 'OLPENDINGAUDIOW',
          mediaType: 'book',
          title: 'Audio Already Requested Book',
          author: 'Queued Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 5,
            serviceId: 1,
            externalServiceId: 11,
            audiobookServiceId: null,
            audiobookExternalServiceId: null,
            requests: [{ status: 1, bookFormat: 'audiobook' }],
          },
        },
        {
          id: 'OLPARTIALW',
          mediaType: 'book',
          title: 'Partially Owned Book',
          author: 'Partial Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 4,
            serviceId: null,
            externalServiceId: null,
            audiobookServiceId: 2,
            audiobookExternalServiceId: 22,
            requests: [],
          },
        },
      ],
    }).as('getHideBooks');

    cy.visit('/discover/books');
    cy.wait('@getPublicSettings').then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body.hideAvailable).to.eq(true);
    });
    cy.reload(true);
    cy.wait('@getPublicSettings');
    cy.wait('@getHideBooks');
    cy.contains('[data-testid=title-card-title]', 'Ebook Only Book').should(
      'be.visible'
    );
    cy.contains(
      '[data-testid=title-card-title]',
      'Partially Owned Book'
    ).should('be.visible');
    cy.contains('Fully Owned Book').should('not.exist');
    cy.contains('Audio Already Requested Book').should('not.exist');

    cy.intercept('GET', '/api/v1/discover/music*', {
      page: 1,
      totalPages: 1,
      totalResults: 2,
      results: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          mediaType: 'album',
          title: 'Owned Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Owned Artist' }],
          mediaInfo: {
            status: 5,
          },
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          mediaType: 'album',
          title: 'Processing Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Processing Artist' }],
          mediaInfo: {
            status: 3,
          },
        },
      ],
    }).as('getHideMusic');

    cy.visit('/discover/music');
    cy.wait('@getHideMusic');
    cy.contains('[data-testid=title-card-title]', 'Processing Album').should(
      'be.visible'
    );
    cy.contains('Owned Album').should('not.exist');
    cy.request('POST', '/api/v1/settings/main', { hideAvailable: false });
  });

  it('honors hide blocklisted for books and music', () => {
    cy.request('POST', '/api/v1/settings/main', { hideBlocklisted: true });
    cy.request('/api/v1/settings/public')
      .its('body.hideBlocklisted')
      .should('eq', true);
    cy.intercept('GET', '/api/v1/settings/public').as('getPublicSettings');

    cy.intercept('GET', '/api/v1/discover/books*', {
      page: 1,
      totalPages: 1,
      totalResults: 2,
      results: [
        {
          id: 'OLBLOCKEDBOOKW',
          mediaType: 'book',
          title: 'Blocked Book',
          author: 'Blocked Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 6,
            requests: [],
          },
        },
        {
          id: 'OLVISIBLEBOOKW',
          mediaType: 'book',
          title: 'Visible Book',
          author: 'Visible Author',
          firstPublishYear: 2026,
          mediaInfo: {
            status: 1,
            requests: [],
          },
        },
      ],
    }).as('getBlocklistedBooks');

    cy.visit('/discover/books');
    cy.wait('@getPublicSettings').then(({ response }) => {
      expect(response?.statusCode).to.eq(200);
      expect(response?.body.hideBlocklisted).to.eq(true);
    });
    cy.reload(true);
    cy.wait('@getPublicSettings');
    cy.wait('@getBlocklistedBooks');
    cy.contains('[data-testid=title-card-title]', 'Visible Book').should(
      'be.visible'
    );
    cy.contains('Blocked Book').should('not.exist');

    cy.intercept('GET', '/api/v1/discover/music*', {
      page: 1,
      totalPages: 1,
      totalResults: 2,
      results: [
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          mediaType: 'album',
          title: 'Blocked Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Blocked Artist' }],
          mediaInfo: {
            status: 6,
          },
        },
        {
          id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          mediaType: 'album',
          title: 'Visible Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Visible Artist' }],
          mediaInfo: {
            status: 1,
          },
        },
      ],
    }).as('getBlocklistedMusic');

    cy.visit('/discover/music');
    cy.wait('@getBlocklistedMusic');
    cy.contains('[data-testid=title-card-title]', 'Visible Album').should(
      'be.visible'
    );
    cy.contains('Blocked Album').should('not.exist');
    cy.request('POST', '/api/v1/settings/main', { hideBlocklisted: false });
  });

  it('keeps request list media filters addressable for book and music queues', () => {
    cy.intercept('GET', '/api/v1/request*', (req) => {
      req.reply({
        pageInfo: { pages: 1, pageSize: 10, results: 0, page: 1 },
        results: [],
        serviceErrors: {
          radarr: [],
          sonarr: [],
          lidarr: [],
          readarr: [],
        },
      });
    }).as('getRequests');

    cy.visit('/users/1/requests?mediaType=book&filter=pending');
    cy.wait('@getRequests')
      .its('request.url')
      .should('include', 'mediaType=book')
      .and('include', 'filter=pending');
    cy.get('select[name=mediaType]').should('have.value', 'book');
    cy.get('select[name=filter]').should('have.value', 'pending');

    cy.get('select[name=mediaType]').select('music');
    cy.wait('@getRequests')
      .its('request.url')
      .should('include', 'mediaType=music');
    cy.location('search').should('include', 'mediaType=music');
  });

  it('only marks dual-format book requests partial when one format is missing', () => {
    const requestedBy = {
      id: 1,
      displayName: 'Admin',
      avatar: '/avatar.png',
    };
    const completeBothRequest = {
      id: 291,
      type: 'book',
      status: 2,
      is4k: false,
      bookFormat: 'both',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      requestedBy,
      modifiedBy: null,
      canRemove: true,
      profileName: 'Default',
      seasons: [],
      media: {
        id: 9291,
        mediaType: 'book',
        status: 5,
        status4k: 1,
        tmdbId: 0,
        serviceId: 1,
        externalServiceId: 101,
        audiobookServiceId: 2,
        audiobookExternalServiceId: 202,
        identifiers: [{ provider: 'openlibrary', value: 'OLBOTHW' }],
        requests: [],
        issues: [],
      },
    };
    const partialBothRequest = {
      ...completeBothRequest,
      id: 292,
      media: {
        ...completeBothRequest.media,
        id: 9292,
        audiobookServiceId: null,
        audiobookExternalServiceId: null,
        identifiers: [{ provider: 'openlibrary', value: 'OLPARTIALBOTHW' }],
      },
    };

    cy.intercept('GET', '/api/v1/request?*', {
      pageInfo: { pages: 1, pageSize: 10, results: 2, page: 1 },
      results: [completeBothRequest, partialBothRequest],
      serviceErrors: {
        radarr: [],
        sonarr: [],
        lidarr: [],
        readarr: [],
      },
    }).as('getBookRequests');
    cy.intercept('GET', '/api/v1/request/291', completeBothRequest);
    cy.intercept('GET', '/api/v1/request/292', partialBothRequest);
    cy.intercept('GET', '/api/v1/book/OLBOTHW', {
      id: 'OLBOTHW',
      mediaType: 'book',
      title: 'Complete Dual Book',
      author: 'Dual Author',
      firstPublishYear: 2026,
      isbnCandidates: [],
      subjects: [],
    });
    cy.intercept('GET', '/api/v1/book/OLPARTIALBOTHW', {
      id: 'OLPARTIALBOTHW',
      mediaType: 'book',
      title: 'Partial Dual Book',
      author: 'Partial Author',
      firstPublishYear: 2026,
      isbnCandidates: [],
      subjects: [],
    });

    cy.visit('/users/1/requests?mediaType=book&filter=approved');
    cy.wait('@getBookRequests');

    cy.contains('Complete Dual Book')
      .parents('.relative.flex.w-full.flex-col.justify-between')
      .first()
      .within(() => {
        cy.contains('Format').should('be.visible');
        cy.contains('Book + Audiobook').should('be.visible');
        cy.contains('Partial Bookshelf link').should('not.exist');
      });
    cy.contains('Partial Dual Book')
      .parents('.relative.flex.w-full.flex-col.justify-between')
      .first()
      .within(() => {
        cy.contains('Partial Bookshelf link').should('be.visible');
        cy.contains('Book').should('be.visible');
      });
  });

  it('removes only the linked side of a partial dual-format book request', () => {
    const requestedBy = {
      id: 1,
      displayName: 'Admin',
      avatar: '/avatar.png',
    };
    const partialBothRequest = {
      id: 293,
      type: 'book',
      status: 3,
      is4k: false,
      bookFormat: 'both',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      requestedBy,
      modifiedBy: null,
      canRemove: true,
      profileName: 'Default',
      seasons: [],
      media: {
        id: 9293,
        mediaType: 'book',
        status: 4,
        status4k: 1,
        tmdbId: 0,
        serviceId: 1,
        externalServiceId: 101,
        audiobookServiceId: null,
        audiobookExternalServiceId: null,
        identifiers: [{ provider: 'openlibrary', value: 'OLREMOVEPARTIALW' }],
        requests: [],
        issues: [],
      },
    };

    cy.intercept('GET', '/api/v1/request?*', {
      pageInfo: { pages: 1, pageSize: 10, results: 1, page: 1 },
      results: [partialBothRequest],
      serviceErrors: {
        radarr: [],
        sonarr: [],
        lidarr: [],
        readarr: [],
      },
    }).as('getBookRequests');
    cy.intercept('GET', '/api/v1/request/293', partialBothRequest);
    cy.intercept('GET', '/api/v1/book/OLREMOVEPARTIALW', {
      id: 'OLREMOVEPARTIALW',
      mediaType: 'book',
      title: 'Remove Partial Dual Book',
      author: 'Partial Author',
      firstPublishYear: 2026,
      isbnCandidates: [],
      subjects: [],
    });
    cy.intercept('DELETE', '/api/v1/media/9293/file*', {
      statusCode: 204,
    }).as('deleteBookFile');

    cy.visit('/users/1/requests?mediaType=book&filter=processing');
    cy.wait('@getBookRequests');
    cy.contains('Remove Partial Dual Book').should('be.visible');
    cy.contains('Partial Bookshelf link').should('be.visible');
    cy.contains('button', 'Remove from Bookshelf')
      .as('removeFromBookshelf')
      .click();
    cy.get('@removeFromBookshelf').click({ force: true });

    cy.wait('@deleteBookFile')
      .its('request.url')
      .should('include', 'format=ebook')
      .and('not.include', 'format=both');
  });

  it('deep-links failed book and music requests to their manage slideovers', () => {
    const requestedBy = {
      id: 1,
      displayName: 'Admin',
      avatar: '/avatar.png',
    };
    const failedBookRequest = {
      id: 301,
      type: 'book',
      status: 4,
      is4k: false,
      bookFormat: 'ebook',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      requestedBy,
      modifiedBy: null,
      canRemove: false,
      profileName: 'Default',
      seasons: [],
      media: {
        id: 9301,
        mediaType: 'book',
        status: 1,
        status4k: 1,
        tmdbId: 0,
        identifiers: [{ provider: 'openlibrary', value: 'OLFAILEDW' }],
        requests: [],
        issues: [],
      },
    };
    const failedMusicRequest = {
      id: 302,
      type: 'music',
      status: 4,
      is4k: false,
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      requestedBy,
      modifiedBy: null,
      canRemove: false,
      profileName: 'Default',
      seasons: [],
      media: {
        id: 9302,
        mediaType: 'music',
        status: 1,
        status4k: 1,
        tmdbId: 0,
        mbId: 'dededede-dede-dede-dede-dededededede',
        requests: [],
        issues: [],
      },
    };

    cy.intercept('GET', '/api/v1/request?*', {
      pageInfo: { pages: 1, pageSize: 10, results: 2, page: 1 },
      results: [failedBookRequest, failedMusicRequest],
      serviceErrors: {
        radarr: [],
        sonarr: [],
        lidarr: [],
        readarr: [],
      },
    }).as('getFailedRequests');
    cy.intercept('GET', '/api/v1/request/301', failedBookRequest);
    cy.intercept('GET', '/api/v1/request/302', failedMusicRequest);
    cy.intercept('GET', '/api/v1/book/OLFAILEDW', {
      id: 'OLFAILEDW',
      mediaType: 'book',
      title: 'Failed Book',
      author: 'Failed Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/8-L.jpg',
      isbnCandidates: [],
      subjects: [],
    });
    cy.intercept('GET', '/api/v1/music/dededede-dede-dede-dede-dededededede', {
      id: 'dededede-dede-dede-dede-dededededede',
      mbId: 'dededede-dede-dede-dede-dededededede',
      mediaType: 'album',
      title: 'Failed Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        name: 'Failed Artist',
      },
      tracks: [],
    });

    cy.visit('/users/1/requests?filter=failed&mediaType=all');
    cy.wait('@getFailedRequests');
    cy.contains('Failed Book')
      .parents('.relative.flex.w-full')
      .contains('.card-field', 'Status')
      .find('a')
      .should('have.attr', 'href', '/book/OLFAILEDW?manage=1&format=ebook');
    cy.contains('Failed Album')
      .parents('.relative.flex.w-full')
      .contains('.card-field', 'Status')
      .find('a')
      .should(
        'have.attr',
        'href',
        '/music/dededede-dede-dede-dede-dededededede?manage=1'
      );
  });

  it('shows book and music download status in manage slideovers', () => {
    const downloadStatus = {
      mediaType: 'book',
      externalId: 101,
      size: 100,
      sizeLeft: 40,
      status: 'downloading',
      timeLeft: '10:00',
      estimatedCompletionTime: '2026-05-16T12:00:00.000Z',
      title: 'Managed Book',
      downloadId: 'book-download',
    };

    cy.intercept('GET', '/api/v1/book/OLMANAGEW', {
      id: 'OLMANAGEW',
      mediaType: 'book',
      title: 'Managed Book',
      author: 'Manage Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/3-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9001,
        status: 3,
        serviceUrl: 'http://bookshelf.local/book/1',
        audiobookServiceUrl: 'http://bookshelf.local/audio/1',
        downloadStatus: [downloadStatus],
        audiobookDownloadStatus: [
          {
            ...downloadStatus,
            externalId: 102,
            title: 'Managed Book Audio',
            downloadId: 'audio-download',
          },
        ],
        requests: [],
        issues: [],
      },
    }).as('getManagedBook');

    cy.visit('/book/OLMANAGEW?manage=1');
    cy.wait('@getManagedBook');
    cy.get('[role="dialog"][aria-label="Manage Book"]').should('be.visible');
    cy.contains('Downloads').should('be.visible');
    cy.get('[title="Book"]').should('be.visible');
    cy.get('[title="Audiobook"]').should('be.visible');
    cy.contains('Open Book in Bookshelf').should('be.visible');
    assertStandardManageActions();
    cy.get('body').type('{esc}');

    cy.intercept('GET', '/api/v1/music/55555555-5555-5555-5555-555555555555', {
      id: '55555555-5555-5555-5555-555555555555',
      mbId: '55555555-5555-5555-5555-555555555555',
      mediaType: 'album',
      title: 'Managed Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '66666666-6666-6666-6666-666666666666',
        name: 'Manage Artist',
      },
      tracks: [],
      mediaInfo: {
        id: 9002,
        status: 3,
        serviceUrl: 'http://lidarr.local/album/1',
        downloadStatus: [
          {
            ...downloadStatus,
            mediaType: 'music',
            externalId: 201,
            title: 'Managed Album',
            downloadId: 'music-download',
          },
        ],
        requests: [],
        issues: [],
      },
    }).as('getManagedMusic');

    cy.visit('/music/55555555-5555-5555-5555-555555555555?manage=1');
    cy.wait('@getManagedMusic');
    cy.get('[role="dialog"][aria-label="Manage Music"]').should('be.visible');
    cy.contains('Downloads').should('be.visible');
    cy.contains('Managed Album').should('be.visible');
    cy.contains('Open in Lidarr').should('be.visible');
    assertStandardManageActions();
  });

  it('uses matching book service link labels on issue details', () => {
    const user = {
      id: 1,
      displayName: 'Admin',
      avatar: '/avatar.png',
    };

    cy.intercept('GET', '/api/v1/issue/501', {
      id: 501,
      issueType: 4,
      status: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      problemSeason: 0,
      problemEpisode: 0,
      createdBy: user,
      media: {
        id: 9501,
        mediaType: 'book',
        tmdbId: 0,
        serviceUrl: 'http://bookshelf.local/book/501',
        audiobookServiceUrl: 'http://bookshelf.local/audio/501',
        identifiers: [{ provider: 'openlibrary', value: 'OLISSUEDETAILW' }],
      },
      comments: [
        {
          id: 1,
          message: 'The wrong edition was imported.',
          createdAt: '2026-05-15T00:00:00.000Z',
          updatedAt: '2026-05-15T00:00:00.000Z',
          user,
        },
      ],
    }).as('getBookIssue');
    cy.intercept('GET', '/api/v1/book/OLISSUEDETAILW', {
      id: 'OLISSUEDETAILW',
      mediaType: 'book',
      title: 'Issue Detail Book',
      author: 'Issue Detail Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/11-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9501,
        status: 5,
        serviceUrl: 'http://bookshelf.local/book/501',
        audiobookServiceUrl: 'http://bookshelf.local/audio/501',
        requests: [],
        issues: [],
      },
    }).as('getBookIssueDetails');

    cy.visit('/issues/501');
    cy.wait('@getBookIssue');
    cy.wait('@getBookIssueDetails');
    cy.contains('Issue Detail Book').should('be.visible');
    cy.contains('Open Book in Bookshelf').should('be.visible');
    cy.contains('Open Audiobook in Bookshelf').should('be.visible');
    cy.contains('Open in Bookshelf (Book)').should('not.exist');
  });

  it('renders rich book and music cards from sparse watchlist rows', () => {
    cy.intercept('GET', '/api/v1/discover/watchlist*', {
      page: 1,
      totalPages: 1,
      totalResults: 2,
      results: [
        {
          id: 1,
          ratingKey: 'music-watchlist',
          mediaType: 'music',
          mbId: '99999999-9999-9999-9999-999999999999',
          title: 'Sparse Album',
        },
        {
          id: 2,
          ratingKey: 'book-watchlist',
          mediaType: 'book',
          externalId: 'OLWATCHW',
          title: 'Sparse Book',
        },
      ],
    }).as('getWatchlist');

    cy.intercept('GET', '/api/v1/music/99999999-9999-9999-9999-999999999999', {
      id: '99999999-9999-9999-9999-999999999999',
      mbId: '99999999-9999-9999-9999-999999999999',
      mediaType: 'album',
      title: 'Resolved Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      posterPath: 'https://coverartarchive.org/release-group/999/front',
      artist: {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'Resolved Artist',
      },
      tracks: [],
      mediaInfo: {
        id: 9201,
        status: 2,
        watchlists: [{}],
        downloadStatus: [],
        requests: [],
      },
    }).as('getWatchlistMusic');
    cy.intercept('GET', '/api/v1/book/OLWATCHW', {
      id: 'OLWATCHW',
      mediaType: 'book',
      title: 'Resolved Book',
      author: 'Resolved Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/6-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9202,
        status: 5,
        serviceId: 1,
        externalServiceId: 11,
        audiobookServiceId: null,
        audiobookExternalServiceId: null,
        watchlists: [{}],
        downloadStatus: [],
        audiobookDownloadStatus: [],
        requests: [],
      },
    }).as('getWatchlistBook');

    cy.visit('/discover/watchlist');
    cy.wait('@getWatchlist');
    cy.wait('@getWatchlistMusic');
    cy.wait('@getWatchlistBook');
    cy.get('[data-testid=title-card]').eq(0).trigger('mouseover');
    cy.contains('Resolved Album').should('be.visible');
    cy.contains('Resolved Artist').should('be.visible');
    cy.get('[data-testid=title-card]').eq(1).trigger('mouseover');
    cy.contains('Resolved Book').should('be.visible');
    cy.contains('Resolved Author').should('be.visible');
  });

  it('keeps the top search bar global across video, books, and music', () => {
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
    cy.intercept('GET', '/api/v1/search*', {
      page: 1,
      totalPages: 1,
      totalResults: 3,
      results: [
        {
          id: 501,
          mediaType: 'movie',
          title: 'Global Movie',
          releaseDate: '2026-01-01',
          posterPath: null,
          overview: 'Movie result',
        },
        {
          id: '77777777-7777-7777-7777-777777777777',
          mediaType: 'album',
          title: 'Global Album',
          'primary-type': 'Album',
          'first-release-date': '2026-02-01',
          'artist-credit': [{ name: 'Global Artist' }],
        },
        {
          id: 'OLGLOBALW',
          mediaType: 'book',
          title: 'Global Book',
          author: 'Global Author',
          firstPublishYear: 2026,
          posterPath: 'https://covers.openlibrary.org/b/id/4-L.jpg',
        },
      ],
    }).as('globalSearch');

    cy.visit('/discover/movies');
    cy.get('input#search_field').type('global');
    cy.wait('@globalSearch')
      .its('request.url')
      .should('include', 'query=global');
    cy.location('pathname').should('eq', '/search');
    cy.contains('[data-testid=title-card-title]', 'Global Movie').should(
      'be.visible'
    );
    cy.contains('[data-testid=title-card-title]', 'Global Album').should(
      'be.visible'
    );
    cy.get('[data-testid=title-card]').eq(2).trigger('mouseover');
    cy.contains('[data-testid=title-card-title]', 'Global Book').should(
      'be.visible'
    );
  });

  it('keeps the selected book format visible from search through the request action', () => {
    cy.intercept('GET', '/api/v1/search*', {
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [
        {
          id: 'OLPRIDEW',
          mediaType: 'book',
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          firstPublishYear: 1813,
          posterPath: null,
        },
      ],
    }).as('bookSearch');

    cy.visit('/search?query=pride%20and%20prejudice');
    cy.wait('@bookSearch');
    cy.contains('button', 'Audiobooks').click();
    cy.location('search')
      .should('include', 'type=book')
      .and('include', 'format=audiobook');

    cy.get('[data-testid=title-card]')
      .first()
      .within(() => {
        cy.contains('Audiobook').should('be.visible');
        cy.get('a[href*="format=audiobook"]').should('exist');
      });
    cy.get('[data-testid=title-card]').first().trigger('mouseover');
    cy.contains('button', 'Request Audiobook').should('be.visible');
  });
});
