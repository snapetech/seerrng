describe('General Settings', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  // Always restore the process-wide restart flag, even if the test aborts
  // before it can revert the setting itself.
  afterEach(() => {
    cy.request('POST', '/api/v1/settings/network', { trustProxy: false });
  });

  it('opens the settings page from the home page', () => {
    cy.visit('/');

    cy.get('[data-testid=sidebar-toggle]').click();
    cy.get('[data-testid=sidebar-menu-settings-mobile]').click();

    cy.contains('h3', 'General Settings').should('be.visible');
  });

  it('modifies setting that requires restart', () => {
    cy.intercept('POST', '/api/v1/settings/network').as('saveNetwork');
    cy.intercept('GET', '/api/v1/status?checkUpdateAvailable=false').as(
      'getStatus'
    );
    cy.visit('/settings/network');
    cy.wait('@getStatus');

    cy.get('button#trustProxy').scrollIntoView().should('be.visible').click();
    cy.get('[data-testid=settings-network-form]').submit();
    cy.wait('@saveNetwork').then(({ request, response }) => {
      expect(
        response?.statusCode,
        JSON.stringify({ request: request.body, response: response?.body })
      ).to.eq(200);
    });
    cy.wait('@getStatus');
    cy.get('[data-testid=modal-title]').should(
      'contain',
      'Server Restart Required'
    );

    cy.get('[data-testid=modal-ok-button]').click();
    cy.get('[data-testid=modal-root]').should('not.exist');

    cy.get('button#trustProxy').scrollIntoView().should('be.visible').click();
    cy.get('[data-testid=settings-network-form]').submit();
    cy.wait('@saveNetwork');
    cy.wait('@getStatus');
    cy.get('[data-testid=modal-title]').should('not.exist');
  });
});
