const associationGraph = {
  root: {
    mediaType: 'book',
    id: 'OLROOTW',
    title: 'Root Book',
  },
  edges: [
    {
      weight: 0.9,
      type: 'shared-person',
      reason: 'Also by Book Author',
      node: {
        id: 'OLRELATEDW',
        mediaType: 'book',
        title: 'Related Book',
        author: 'Book Author',
        authorId: 'OLAUTHOR',
        firstPublishYear: 2024,
        posterPath: 'https://covers.openlibrary.org/b/id/123-L.jpg',
      },
    },
    {
      weight: 0.8,
      type: 'shared-genre',
      reason: 'Shares Fantasy',
      node: {
        id: 'OLOTHERW',
        mediaType: 'book',
        title: 'Adjacent Book',
        author: 'Another Author',
        firstPublishYear: 2022,
        posterPath: 'https://covers.openlibrary.org/b/id/456-L.jpg',
      },
    },
  ],
};

const albumAssociationGraph = {
  root: {
    mediaType: 'album',
    id: 'ALBUMROOT',
    title: 'Root Album',
  },
  edges: [
    {
      weight: 0.9,
      type: 'similar',
      reason: 'Listeners also play this artist',
      node: {
        id: 'ARTISTRELATED',
        mediaType: 'artist',
        name: 'Related Artist',
        artistThumb: '/profile.png',
      },
    },
  ],
};

describe('Associations', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.intercept(
      'GET',
      '/api/v1/association/book/OLROOTW?includeWeak=true',
      associationGraph
    ).as('getAssociations');
    cy.intercept('GET', '/api/v1/association/book/OLRELATEDW*', {
      root: {
        mediaType: 'book',
        id: 'OLRELATEDW',
        title: 'Related Book',
      },
      edges: [
        {
          weight: 0.8,
          type: 'shared-person',
          reason: 'Also by Book Author',
          node: {
            id: 'OLROOTW',
            mediaType: 'book',
            title: 'Root Book',
            author: 'Book Author',
            posterPath: 'https://covers.openlibrary.org/b/id/789-L.jpg',
          },
        },
      ],
    }).as('precheckRelatedAssociations');
    cy.intercept(
      'GET',
      '/api/v1/association/book/OLRELATEDW?includeWeak=true',
      {
        root: {
          mediaType: 'book',
          id: 'OLRELATEDW',
          title: 'Related Book',
        },
        edges: [
          {
            weight: 0.8,
            type: 'shared-person',
            reason: 'Also by Book Author',
            node: {
              id: 'OLROOTW',
              mediaType: 'book',
              title: 'Root Book',
              author: 'Book Author',
              posterPath: 'https://covers.openlibrary.org/b/id/789-L.jpg',
            },
          },
        ],
      }
    ).as('getRelatedAssociations');
    cy.intercept('GET', '/api/v1/association/book/OLOTHERW*', {
      root: {
        mediaType: 'book',
        id: 'OLOTHERW',
        title: 'Adjacent Book',
      },
      edges: [],
    }).as('precheckEmptyAssociations');
    cy.intercept(
      'GET',
      '/api/v1/association/album/ALBUMROOT?includeWeak=true',
      albumAssociationGraph
    ).as('getAlbumAssociations');
    cy.intercept('GET', '/api/v1/association/artist/ARTISTRELATED*', {
      root: {
        mediaType: 'artist',
        id: 'ARTISTRELATED',
        title: 'Related Artist',
      },
      edges: [
        {
          weight: 0.9,
          type: 'similar',
          reason: 'Shared listeners',
          node: {
            id: 'ARTISTOTHER',
            mediaType: 'artist',
            name: 'Other Artist',
          },
        },
      ],
    }).as('getArtistAssociations');
  });

  it('shows same-author book associations in the wall view', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.contains('h1', 'Associations for Root Book').should('be.visible');
    cy.get('[data-testid=association-wall]').within(() => {
      cy.contains('Same author').should('be.visible');
      cy.contains('Related books').should('be.visible');
    });
    cy.get('a[href="/book/OLRELATEDW"]')
      .contains('Related Book')
      .and('be.visible');
  });

  it('renders association results as unclipped compact detail cards', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.get('[data-testid=association-wall]').within(() => {
      cy.get('a[href="/book/OLRELATEDW"]')
        .contains('Related Book')
        .closest('article')
        .should('be.visible')
        .and(($card) => {
          const rect = $card[0].getBoundingClientRect();
          expect(rect.width).to.be.greaterThan(250);
          expect(rect.height).to.be.greaterThan(100);
        })
        .within(() => {
          cy.contains('Book').should('be.visible');
          cy.contains('2024').should('be.visible');
          cy.contains('Also by Book Author').should('be.visible');
        });
    });
  });

  it('hides card badges when a title has no strong associations', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.get('[data-testid=association-wall]').within(() => {
      cy.get('a[href="/book/OLOTHERW"]')
        .contains('Adjacent Book')
        .closest('article')
        .within(() => {
          cy.get('[data-testid=association-badge]').should('not.exist');
        });
    });
  });

  it('renders the graph view with a legend and recenterable nodes', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.contains('button', 'Map').click();
    cy.get('[data-testid=association-graph]').should('be.visible');
    cy.get('[data-testid=association-graph-legend]').within(() => {
      cy.contains('Shared person').should('be.visible');
      cy.contains('Similar').should('be.visible');
      cy.contains('Weak connection').should('be.visible');
    });
    cy.contains('[data-testid=association-graph-node]', 'Related Book')
      .should('be.visible')
      .click({ force: true });
  });

  it('keeps the list view on mobile where the graph would be cramped', () => {
    cy.viewport('iphone-6');
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.contains('button', 'Map').should('not.exist');
    cy.get('[data-testid=association-wall]').should('be.visible');
  });

  it('uses music-specific association labels for album and artist flows', () => {
    cy.visit('/associations/album/ALBUMROOT');
    cy.wait('@getAlbumAssociations');

    cy.get('[data-testid=association-wall]').within(() => {
      cy.contains('Similar artists').should('be.visible');
      cy.contains('More like this').should('not.exist');
      cy.get('a[href="/artist/ARTISTRELATED"]')
        .contains('Related Artist')
        .should('be.visible')
        .closest('article')
        .within(() => {
          cy.contains('Listeners also play this artist').should('be.visible');
          cy.get('[data-testid=association-badge]').should('not.exist');
        });
    });
  });
});
