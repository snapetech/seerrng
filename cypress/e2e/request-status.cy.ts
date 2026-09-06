describe('Request Status', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('opens on recent requests and lets users choose a history window', () => {
    cy.visit('/requests/status');

    cy.get('select[aria-label="Time frame"]')
      .should('be.visible')
      .and('have.value', '7d');
    cy.contains('button', 'Refresh').should('be.visible');

    cy.get('select[aria-label="Time frame"]').select('14d');
    cy.location('search').should('contain', 'timeFrame=14d');

    cy.get('select[aria-label="Time frame"]').select('all');
    cy.location('search').should('contain', 'timeFrame=all');

    cy.get('select[aria-label="Time frame"]').select('7d');
    cy.location('search').should('not.contain', 'timeFrame=');
  });
});
