describe('Book discovery formats', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('separates Books and Audiobooks while preserving discovery filters', () => {
    cy.intercept('GET', '/api/v1/discover/books*', (request) => {
      request.alias =
        request.query.format === 'audiobook'
          ? 'discoverAudiobooks'
          : 'discoverBooks';
      request.reply({
        page: 1,
        totalPages: 1,
        totalResults: 1,
        results: [
          {
            id: 'OLFORMATBOOK',
            mediaType: 'book',
            title: 'Format-aware Book',
            author: 'Format Author',
            posterPath: '/images/seerr_poster_not_found.png',
          },
        ],
      });
    });

    cy.visit('/discover/books?subject=fantasy&sortBy=rating');
    cy.wait('@discoverBooks')
      .its('request.url')
      .should('include', 'format=ebook');
    cy.contains('[data-testid=page-header]', 'Books').should('be.visible');
    cy.get('[data-testid=book-format-tab-ebook]')
      .should('have.attr', 'aria-current', 'page')
      .and('contain', 'Books');

    cy.get('[data-testid=book-format-tab-audiobook]').should(
      'have.attr',
      'href',
      '/discover/audiobooks?subject=fantasy&sortBy=rating'
    );
    cy.get('[data-testid=book-format-tab-audiobook]').click();
    cy.location('pathname').should('eq', '/discover/audiobooks');
    cy.url({ timeout: 10000 })
      .should('include', 'subject=fantasy')
      .and('include', 'sortBy=rating');
    cy.wait('@discoverAudiobooks')
      .its('request.url')
      .should('include', 'format=audiobook');
    cy.contains('[data-testid=page-header]', 'Audiobooks').should('be.visible');
    cy.get('[data-testid=book-format-tab-audiobook]').should(
      'have.attr',
      'aria-current',
      'page'
    );
    cy.get('[data-testid=title-card]')
      .first()
      .find('[title=Audiobook]')
      .should('be.visible');
  });
});
