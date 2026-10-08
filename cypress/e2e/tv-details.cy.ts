describe('TV Details', () => {
  it('loads a tv details page', () => {
    cy.loginAsAdmin();
    // Try to load stranger things
    cy.visit('/tv/66732');

    cy.get('[data-testid=media-title]').should(
      'contain',
      'Stranger Things (2016)'
    );
  });

  it('opens one request screen and chooses HD or 4K inside it without submitting', () => {
    cy.loginAsAdmin();
    let submissions = 0;
    // The disposable runtime has no Sonarr services. Supply read-only HD/4K
    // destinations so this entry/quality test does not test missing setup.
    const sonarrServers = [false, true].map((is4k, index) => ({
      id: index + 1,
      name: is4k ? 'Test Sonarr 4K' : 'Test Sonarr HD',
      is4k,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: is4k ? '/tv-4k' : '/tv',
      activeTags: [],
    }));
    cy.intercept('GET', '/api/v1/service/sonarr', sonarrServers).as(
      'sonarrDestinations'
    );
    sonarrServers.forEach((server) => {
      cy.intercept('GET', `/api/v1/service/sonarr/${server.id}`, {
        server,
        profiles: [{ id: 1, name: server.is4k ? 'Ultra HD' : 'HD' }],
        rootFolders: [{ id: 1, path: server.activeDirectory }],
        languageProfiles: [],
        tags: [],
      });
    });
    cy.intercept('POST', '/api/v1/request*', (request) => {
      submissions += 1;
      request.reply({
        statusCode: 500,
        body: { error: 'Unexpected submission' },
      });
    });
    cy.intercept('GET', '/api/v1/settings/public', (request) => {
      request.continue((response) => {
        response.body.series4kEnabled = true;
      });
    });
    cy.intercept('GET', '/api/v1/tv/66732', (request) => {
      request.continue((response) => {
        // This entry test uses unrequested media, independently of saved requests.
        response.body.mediaInfo = null;
      });
    });
    cy.visit('/tv/66732');

    cy.wait('@sonarrDestinations').its('response.statusCode').should('eq', 200);

    cy.get('[data-testid=format-request-option-standard]').should('not.exist');
    cy.contains('button', /^Request$/)
      .filter(':visible')
      .should('be.enabled')
      .click();
    cy.get('[role="dialog"]')
      .should('be.visible')
      .within(() => {
        cy.get('[role="group"][aria-label="Quality"]')
          .contains('button', /^HD$/)
          .should('be.visible')
          .and('have.attr', 'aria-pressed', 'true');
        cy.get('[role="group"][aria-label="Quality"]')
          .contains('button', /^4K$/)
          .should('be.enabled')
          .click();
        cy.get('[role="group"][aria-label="Quality"]')
          .contains('button', /^4K$/)
          .should('have.attr', 'aria-pressed', 'true');
        cy.get('[role="group"][aria-label="Quality"]')
          .contains('button', /^HD$/)
          .click()
          .should('have.attr', 'aria-pressed', 'true');
      });
    cy.then(() =>
      expect(
        submissions,
        'screen entry and quality choices do not submit'
      ).to.eq(0)
    );
  });

  it('hides the playback quality selector when 4K is not configured', () => {
    cy.loginAsAdmin();
    cy.intercept('GET', '/api/v1/settings/public', (request) => {
      request.continue((response) => {
        response.body.series4kEnabled = false;
      });
    });
    cy.visit('/tv/66732');

    cy.get('[aria-label^="Quality:"]').should('not.exist');
  });

  it('shows seasons and expands episodes', () => {
    cy.loginAsAdmin();

    // A full visit obtains initial metadata through SSR, outside cy.intercept.
    // Record any client revalidation too, without assuming it will occur.
    cy.intercept('GET', '/api/v1/tv/66732', (request) => {
      request.continue((response) => {
        Cypress.log({
          name: 'client season summary',
          message: JSON.stringify({
            id: response.body.id,
            season: response.body.seasons?.find(
              (season: { seasonNumber: number }) => season.seasonNumber === 4
            ),
          }),
        });
      });
    }).as('seriesDetails');
    cy.intercept('GET', '/api/v1/tv/66732/season/*', (request) => {
      const seasonNumber = Number(
        new URL(request.url).pathname.split('/').pop()
      );
      const episodes =
        seasonNumber === 4
          ? Array.from({ length: 9 }, (_, index) => ({
              id: 900 + index,
              name: index === 8 ? 'Chapter Nine' : `Episode ${index + 1}`,
              airDate: null,
              episodeNumber: index + 1,
              overview: '',
              productionCode: '',
              seasonNumber,
              showId: 66732,
              voteAverage: 0,
              voteCount: 0,
            }))
          : [];
      const response = {
        airDate: '',
        id: 400 + seasonNumber,
        name: `Season ${seasonNumber}`,
        overview: '',
        seasonNumber,
        episodes,
        externalIds: {},
      };

      if (seasonNumber === 4) {
        request.alias = 'season4';
      }
      request.reply({ body: response });
    });
    cy.visit('/tv/66732');
    cy.get('script#__NEXT_DATA__')
      .invoke('text')
      .then((text) => {
        const details = JSON.parse(text).props.pageProps.tv;
        const season = details.seasons.find(
          (item: { seasonNumber: number }) => item.seasonNumber === 4
        );
        Cypress.log({
          name: 'SSR season summary',
          message: JSON.stringify({ id: details.id, season }),
        });
        expect(details.id, 'SSR canonical Stranger Things TMDB ID').to.eq(
          66732
        );
        expect(season, 'SSR advertises season 4').not.to.equal(undefined);
        expect(
          season.episodeCount,
          'SSR season 4 meets the current tree episodeCount > 0 eligibility filter'
        ).to.be.greaterThan(0);
      });
    cy.get('button[aria-controls="series-media-server-panel"]')
      .should('be.visible')
      .then(($button) => {
        if ($button.attr('aria-expanded') !== 'true') cy.wrap($button).click();
      });
    cy.get('#series-media-server-panel').should('be.visible');
    cy.get('#series-media-server-panel [data-selection-tree]').should('exist');
    cy.get('button[aria-label="Expand Season 04"]').should('be.visible');
    cy.wait('@season4').its('response.statusCode').should('eq', 200);

    cy.get('button[aria-label="Expand Season 04"]')
      .should('be.visible')
      .and('have.attr', 'aria-expanded', 'false')
      .scrollIntoView()
      .click();
    cy.get('button[aria-label="Collapse Season 04"]').should(
      'have.attr',
      'aria-expanded',
      'true'
    );

    cy.get('[data-tree-part="episodes"][aria-label="Season 04 Episodes"]')
      .should('be.visible')
      .contains('[data-tree-part="name"]', 'Chapter Nine')
      .scrollIntoView()
      .should('be.visible');
  });
});
