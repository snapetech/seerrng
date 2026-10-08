describe('Personal game library and household play', () => {
  const addSharedGame = (title: string) => {
    cy.visit('/games');
    cy.contains('button', 'Add a Game').click();
    cy.get('#manual-game-title').type(title);
    cy.get('[role="dialog"]').within(() => {
      cy.get('button[aria-label="I own this outside Steam"]').click();
      cy.get('button[aria-label="Share with household"]').click();
      cy.get('[data-testid="modal-ok-button"]').click();
    });
    cy.contains('h2.card-title', title).should('be.visible');
    cy.contains('Share with household').should('be.visible');
  };

  it('shares manually owned games and finds household overlap on desktop and mobile', () => {
    cy.viewport(1440, 1000);
    cy.loginAsAdmin();
    addSharedGame('Portal 2');
    cy.screenshot('game-library-my-games-desktop');

    cy.loginAsUser();
    addSharedGame('Portal 2');

    cy.loginAsAdmin();
    cy.visit('/games');
    cy.contains('button', 'Play Together').click();
    cy.contains('Portal 2').should('be.visible');
    cy.contains('2 people own this').should('be.visible');
    cy.get('button.app-filter-select-trigger[aria-label="Owner count"]')
      .should('be.visible')
      .and('contain.text', '2+ owners');
    cy.screenshot('game-library-play-together-desktop');

    cy.viewport(390, 844);
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(390);
    });
    cy.screenshot('game-library-play-together-mobile');
  });
});
