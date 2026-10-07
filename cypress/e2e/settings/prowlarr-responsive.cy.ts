const categoryMappings = {
  movie: [2000],
  tv: [5000],
  music: [3000],
  ebook: [7000],
  audiobook: [3030],
  comic: [7030],
  magazine: [7010],
  retro: [4050],
  modern: [4000],
  game: [4050],
};

const coverage = {
  configured: true,
  success: true,
  version: '2.5.5.5823',
  totalIndexers: 28,
  enabledSearchableIndexers: 27,
  categories: Object.fromEntries(
    Object.keys(categoryMappings).map((category) => [category, 1])
  ),
  categoryCatalog: [],
};

const diagnostics = Array.from({ length: 27 }, (_, index) => ({
  id: index + 1,
  name: index === 26 ? 'AnimeTosho (Usenet)' : `Indexer ${index + 1}`,
  layer: 'indexer-feed' as const,
  success: index !== 20,
  status: index === 20 ? 429 : 200,
  ...(index === 20 ? { error: 'Recently rate limited by the indexer.' } : {}),
}));

describe('Prowlarr settings on a short mobile screen', () => {
  beforeEach(() => {
    cy.viewport(390, 640);
    cy.loginAsAdmin();

    cy.intercept('GET', '**/api/v1/settings/**', (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/v1/settings/public') {
        request.continue();
      } else if (pathname === '/api/v1/settings/cache') {
        request.reply({
          apiCaches: [],
          imageCache: {
            tmdb: { imageCount: 0, size: 0 },
            avatar: { imageCount: 0, size: 0 },
          },
        });
      } else if (pathname === '/api/v1/settings/prowlarr') {
        request.alias = 'prowlarrSettings';
        request.reply({
          hostname: 'prowlarr.test',
          port: 9696,
          useSsl: false,
          baseUrl: '',
          apiKey: 'REDACTED',
          apiKeyConfigured: true,
          categoryMappings,
        });
      } else if (pathname === '/api/v1/settings/prowlarr/coverage') {
        request.reply(coverage);
      } else if (pathname === '/api/v1/settings/software-acquisition') {
        request.reply({
          romarr: {
            hostname: '',
            port: 6868,
            useSsl: false,
            baseUrl: '',
            apiKey: '',
            apiKeyConfigured: false,
          },
          questarr: {
            hostname: '',
            port: 3000,
            useSsl: false,
            baseUrl: '',
            apiKey: '',
            apiKeyConfigured: false,
          },
          emulationCatalogProvider: 'questarr',
          emulationSystemGroups: {},
        });
      } else if (pathname === '/api/v1/settings/reader-delivery') {
        request.reply({
          grimmoryUrl: '',
          grimmoryUsername: '',
          grimmoryPassword: '',
          bookorbitUrl: '',
          bookorbitUsername: '',
          bookorbitPassword: '',
          preferredProvider: 'grimmory',
        });
      } else if (pathname === '/api/v1/settings/reader-delivery/groupings') {
        request.reply([]);
      } else {
        request.reply([]);
      }
    });
    cy.intercept('GET', '/api/v1/overrideRule', { body: [] });
    cy.intercept('GET', '/api/v1/request/software/catalog/systems', {
      body: { results: [] },
    });
    cy.intercept('POST', '/api/v1/settings/prowlarr/test', {
      body: { ...coverage, diagnostics },
    }).as('testProwlarr');
    cy.intercept('PUT', '/api/v1/settings/prowlarr', {
      statusCode: 200,
      body: { success: true },
    }).as('saveProwlarr');
  });

  it('keeps save reachable after scrolling the long indexer report', () => {
    cy.visit('/settings/services');
    cy.wait('@prowlarrSettings').its('response.statusCode').should('eq', 200);
    cy.get('#prowlarr').should('be.visible');
    cy.contains('#prowlarr h3', 'Prowlarr indexers').scrollIntoView();
    cy.get('#prowlarr')
      .contains('button', 'Test connection and inspect coverage')
      .click();
    cy.wait('@testProwlarr');

    cy.get('[data-testid=prowlarr-diagnostics]').should('be.visible');
    cy.get('[data-testid=prowlarr-diagnostics]')
      .should(($region) => {
        expect(getComputedStyle($region[0]).maxHeight).to.equal('288px');
        expect($region[0].scrollHeight).to.be.greaterThan(
          $region[0].clientHeight
        );
      })
      .scrollTo('bottom');
    cy.get('[data-testid=prowlarr-diagnostics]')
      .contains('li', 'AnimeTosho (Usenet)')
      .should('be.visible');
    cy.get('[data-testid=prowlarr-actions]').scrollIntoView();
    cy.get('[data-testid=prowlarr-actions]').should('be.visible');
    cy.get('[data-testid=prowlarr-actions]')
      .contains('button', 'Save Prowlarr settings')
      .then(($button) => {
        const bounds = $button[0].getBoundingClientRect();
        expect(bounds.height).to.be.at.least(44);
        expect(bounds.top).to.be.at.least(0);
        expect(bounds.bottom).to.be.at.most(640);
      })
      .click();
    cy.wait('@saveProwlarr').its('response.statusCode').should('eq', 200);
  });
});
