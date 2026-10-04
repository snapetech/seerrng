const platformMappings = {
  systems: [
    {
      slug: 'nes',
      name: 'Nintendo Entertainment System',
      automaticMatch: { id: 18, name: 'Nintendo Entertainment System' },
      selectedMatch: { id: 18, name: 'Nintendo Entertainment System' },
      status: 'automatic',
    },
    {
      slug: 'sega-cd',
      name: 'Sega CD',
      automaticMatch: null,
      selectedMatch: null,
      status: 'unmatched',
    },
    {
      slug: 'snes',
      name: 'Super Nintendo Entertainment System',
      automaticMatch: { id: 19, name: 'Super Nintendo Entertainment System' },
      selectedMatch: { id: 19, name: 'Super Nintendo Entertainment System' },
      status: 'automatic',
    },
  ],
  catalogPlatforms: [
    { id: 18, name: 'Nintendo Entertainment System' },
    { id: 19, name: 'Super Nintendo Entertainment System' },
    { id: 29, name: 'Sega CD' },
  ],
  unmatchedSystems: [{ slug: 'sega-cd', name: 'Sega CD' }],
  unmatchedCatalogPlatforms: [{ id: 29, name: 'Sega CD' }],
};

const softwareSettings = {
  romarr: {
    hostname: 'romarr.example.test',
    port: 6868,
    useSsl: false,
    baseUrl: '',
    apiKey: '',
    apiKeyConfigured: true,
  },
  questarr: {
    hostname: '',
    port: 3000,
    useSsl: false,
    baseUrl: '',
    apiKey: '',
    apiKeyConfigured: false,
  },
  emulationCatalogProvider: 'romarr-dat',
  emulationSystemGroups: { nes: 'retro', 'sega-cd': 'retro', snes: 'retro' },
  emulationPlatformMappings: {},
};

const catalogGame = {
  id: `dat-${'a'.repeat(64)}`,
  catalogProvider: 'dat',
  catalogId: `dat-${'a'.repeat(64)}`,
  title: 'Metroid',
  summary: 'Explore the original Metroid DAT entry.',
  coverUrl: '',
  releaseDate: '1986-08-06',
  platforms: ['Nintendo Entertainment System'],
  platformOptions: [{ key: 'nes', name: 'Nintendo Entertainment System' }],
  genres: [],
  emulationSystems: [
    {
      slug: 'nes',
      name: 'Nintendo Entertainment System',
      group: 'retro',
      catalogPlatformId: 18,
    },
  ],
  availability: 'missing',
};

const softwareRequest = {
  request: {
    id: 42,
    requestedBy: { id: 1, displayName: 'Admin', avatar: '' },
    category: 'retro',
    provider: 'romarr',
    status: 'downloading',
    title: 'Metroid',
    coverUrl: '',
    platform: { name: 'Nintendo Entertainment System' },
    catalogProvider: 'dat',
    catalogKey: catalogGame.catalogId,
    percent: 46.5,
    stage: 'verifying_archive',
    failureCode: null,
    actions: { cancel: true },
    createdAt: '2026-10-01T12:00:00.000Z',
  },
  status: 'downloading',
  message: null,
  assets: [],
};

const mockIntegrationData = () => {
  cy.intercept('GET', '**/api/v1/settings/**', (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/v1/settings/public') {
      request.reply({
        softwareEnabled: true,
        romarrEnabled: true,
        enabledMediaCategories: { retro: true, modern: true, game: true },
      });
    } else if (pathname === '/api/v1/settings/cache') {
      request.reply({
        apiCaches: [],
        imageCache: {
          tmdb: { imageCount: 0, size: 0 },
          avatar: { imageCount: 0, size: 0 },
        },
      });
    } else if (pathname === '/api/v1/settings/software-acquisition') {
      request.reply(softwareSettings);
    } else if (pathname === '/api/v1/settings/prowlarr') {
      request.reply({
        hostname: '',
        port: 9696,
        useSsl: false,
        baseUrl: '',
        apiKey: '',
        apiKeyConfigured: false,
        categoryMappings: {},
      });
    } else {
      request.reply([]);
    }
  });

  cy.intercept('GET', '/api/v1/request/software/catalog/systems', {
    body: {
      catalogProvider: 'dat',
      catalogSystemSlugs: ['nes', 'snes'],
      unmatchedDatNames: ['ColecoVision'],
      results: [
        { slug: 'nes', name: 'Nintendo Entertainment System', group: 'retro' },
        { slug: 'sega-cd', name: 'Sega CD', group: 'retro' },
        {
          slug: 'snes',
          name: 'Super Nintendo Entertainment System',
          group: 'retro',
        },
      ],
    },
  });
  cy.intercept(
    'GET',
    '/api/v1/settings/software-acquisition/platform-mapping/preview',
    {
      body: platformMappings,
    }
  );
  cy.intercept('POST', '/api/v1/settings/software-acquisition/test/romarr', {
    body: {
      service: 'ROMarrNG',
      platformCount: 3,
      requestContractVersion: 2,
      capabilities: { catalog: false, datCatalog: true },
      datCatalogPlatformCount: 2,
      unmatchedDatNames: ['ColecoVision'],
    },
  });
  cy.intercept('PUT', '/api/v1/settings/software-acquisition', {
    body: { success: true },
  }).as('saveSoftwareSettings');
  cy.intercept('GET', '/api/v1/request/software/catalog/popular*', {
    body: { results: [catalogGame], nextOffset: null },
  });
  cy.intercept('GET', '/api/v1/request/software/catalog/search*', {
    body: { results: [catalogGame], nextCursor: null },
  }).as('datCatalogSearch');
  cy.intercept('GET', '/api/v1/user/*/quota', {
    body: { software: { limit: 5, remaining: 3 } },
  });
  cy.intercept('GET', '/api/v1/request/software/status*', {
    body: {
      results: [softwareRequest],
      pageInfo: { page: 1, pages: 1, pageSize: 20, results: 1 },
    },
  });
  cy.intercept('GET', '/api/v1/request/software/status/42', {
    body: {
      history: [
        {
          id: 1,
          status: 'downloading',
          message: null,
          percent: 46.5,
          providerStage: 'verifying_archive',
          failureCode: null,
          createdAt: '2026-10-01T12:00:00.000Z',
        },
      ],
    },
  });
};

describe('ROMarrNG software acquisition integration', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    mockIntegrationData();
  });

  it('previews platform matches and saves a manual override', () => {
    cy.viewport(1280, 720);
    cy.visit('/settings/services');
    cy.contains('h4', 'ROMarrNG to IGDB platform matching').scrollIntoView();
    cy.contains('button', 'Preview platform matches').click();
    cy.contains('dt', 'Sega CD').parent().contains('No automatic match');
    cy.contains('Systems without a match: 1').should('be.visible');
    cy.get('select[aria-label="Sega CD: ROMarrNG to IGDB platform matching"]')
      .select('29')
      .parent()
      .contains('Manual match · Sega CD');
    cy.contains('button', 'Save settings').click();
    cy.wait('@saveSoftwareSettings')
      .its('request.body.emulationPlatformMappings.sega-cd')
      .should('eq', 29);

    cy.get('button').contains('Test connection').first().click();
    cy.contains('DAT catalog ready for 2 systems').should('be.visible');
    cy.contains('ColecoVision').should('be.visible');
    cy.viewport(390, 720);
    cy.reload();
    cy.contains('h4', 'ROMarrNG to IGDB platform matching').scrollIntoView();
    cy.contains('button', 'Preview platform matches').click();
    cy.get(
      'select[aria-label="Nintendo Entertainment System: ROMarrNG to IGDB platform matching"]'
    )
      .should('be.visible')
      .select('');
    cy.contains('ColecoVision').should('be.visible');
  });

  it('searches the DAT catalog without IGDB-only filters', () => {
    cy.viewport(1280, 720);
    cy.visit('/software');
    cy.contains('DAT catalog').should('be.visible');
    cy.contains('Metroid').should('be.visible');
    cy.contains('Browse DAT titles').should('be.visible');
    cy.contains('label', 'Genre').should('not.exist');
    cy.contains('label', 'Release year').should('not.exist');
    cy.get('input[placeholder="Search software titles"]').type('Metroid');
    cy.contains('button', 'Search').click();
    cy.wait('@datCatalogSearch')
      .its('request.url')
      .should('include', 'q=Metroid');
    cy.contains('Metroid').should('be.visible');

    cy.viewport(390, 720);
    cy.reload();
    cy.contains('Metroid').should('be.visible');
  });

  it('shows provider-reported progress and stage on desktop and mobile widths', () => {
    cy.viewport(1280, 720);
    cy.visit('/requests?mediaType=retro');
    cy.contains('Software Requests').should('be.visible');
    cy.contains('46.5% downloaded').should('be.visible');
    cy.get('[role="progressbar"]').should('have.attr', 'aria-valuenow', '46.5');
    cy.contains('Stage: verifying archive').should('be.visible');
    cy.contains('button', 'History').click();
    cy.contains('Downloading · verifying archive · 47%').should('be.visible');

    cy.viewport(390, 720);
    cy.reload();
    cy.contains('46.5% downloaded').should('be.visible');
    cy.get('[role="progressbar"]').should('be.visible');
  });
});
