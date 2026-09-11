describe('Plex audiobook library settings', () => {
  beforeEach(() => {
    cy.loginAsAdmin();

    cy.intercept('GET', '/api/v1/settings/plex', {
      body: {
        name: 'Plex',
        machineId: 'test-machine',
        ip: '192.0.2.10',
        port: 32400,
        useSsl: false,
        libraries: [
          {
            id: 'audiobooks',
            name: 'Audiobooks',
            enabled: true,
            type: 'music',
          },
        ],
      },
    }).as('plexSettings');
    cy.intercept('GET', '/api/v1/settings/tautulli', { body: {} });
    cy.intercept('GET', '/api/v1/settings/plex/sync', {
      body: { running: false, progress: 0, total: 0, libraries: [] },
    });
  });

  it('reclassifies a Plex Music library as Audiobooks', () => {
    cy.intercept(
      'PUT',
      '/api/v1/settings/plex/library/audiobooks/type',
      (request) => {
        expect(request.body).to.deep.equal({ type: 'book' });
        request.reply({
          body: [
            {
              id: 'audiobooks',
              name: 'Audiobooks',
              enabled: true,
              type: 'book',
            },
          ],
        });
      }
    ).as('reclassifyAudiobooks');

    cy.visit('/settings/plex');
    cy.get('button[aria-label="Reclassify as an Audiobooks library"]')
      .should('have.length', 1)
      .click();
    cy.wait('@reclassifyAudiobooks')
      .its('response.statusCode')
      .should('eq', 200);
  });
});
