describe('Current batch layout standards', () => {
  const expectHeight = ($element: JQuery<HTMLElement>, height: number) => {
    expect($element[0].getBoundingClientRect().height).to.eq(height);
  };

  beforeEach(() => {
    cy.loginAsAdmin();
    cy.viewport(1000, 900);
  });

  it('renders Settings fields, help text, headings, selectors, and actions to the shared standard', () => {
    cy.visit('/settings/main');

    cy.get('.settings-main-card').should('be.visible');
    cy.get('.settings-page-content .heading, .settings-group-heading').each(
      ($heading) => {
        const styles = getComputedStyle($heading[0]);
        expect(styles.fontSize).to.eq('14px');
        expect(styles.color).to.eq('rgb(255, 255, 255)');
      }
    );

    cy.get('#cacheImages')
      .should('have.class', 'selection-circle')
      .then(($selector) => expectHeight($selector, 16));

    cy.get('label[for="cacheImages"]')
      .siblings('.settings-form-row-description')
      .then(($help) => {
        const helpBounds = $help[0].getBoundingClientRect();
        const rowBounds = $help.closest('.form-row')[0].getBoundingClientRect();
        const styles = getComputedStyle($help[0]);

        expect(styles.fontSize).to.eq('14px');
        expect(styles.textAlign).to.eq('left');
        expect(Math.abs(helpBounds.left - rowBounds.left)).to.be.lessThan(2);
        expect(Math.abs(helpBounds.right - rowBounds.right)).to.be.lessThan(2);
      });

    cy.get('label[for="discoverRegion"]')
      .parent('.form-row')
      .within(() => {
        cy.get('label').then(($label) => {
          cy.get('.settings-compatible-listbox-button').then(($control) => {
            expectHeight($control, 20);
            expect(
              Math.abs(
                $label[0].getBoundingClientRect().top -
                  $control[0].getBoundingClientRect().top
              )
            ).to.be.lessThan(2);
          });
        });
      });

    cy.get('.settings-compatible-listbox-button').each(($control) => {
      expectHeight($control, 20);
      expect(getComputedStyle($control[0]).backgroundColor).not.to.eq(
        'rgb(255, 255, 255)'
      );
    });

    cy.get('.settings-page-content .react-select__control').each(($control) => {
      expectHeight($control, 20);
      expect(getComputedStyle($control[0]).backgroundColor).not.to.eq(
        'rgb(255, 255, 255)'
      );
    });

    cy.get('#locale').then(($control) => {
      expectHeight($control, 20);
      expect(getComputedStyle($control[0]).backgroundColor).not.to.eq(
        'rgb(255, 255, 255)'
      );
    });

    cy.get('.settings-page-actions .app-button').each(($button) =>
      expectHeight($button, 30)
    );

    cy.get('.settings-page-actions').contains('button', 'Cancel').click();
    cy.location('pathname').should('eq', '/discover');
  });

  it('renders About values as ordinary text rather than code tags', () => {
    cy.visit('/settings/about');

    for (const label of ['Version', 'Data Directory', 'Time Zone']) {
      cy.contains('.app-list-label', label)
        .closest('.app-list-row')
        .within(() => {
          cy.get('code').should('not.exist');
          cy.get('.settings-plain-value')
            .should('be.visible')
            .then(($value) => {
              const styles = getComputedStyle($value[0]);
              expect(styles.backgroundColor).to.eq('rgba(0, 0, 0, 0)');
              expect(styles.fontFamily).not.to.contain('mono');
              expect(styles.paddingTop).to.eq('0px');
              expect(styles.paddingRight).to.eq('0px');
            });
        });
    }
  });

  it('renders the Users table without desktop overflow or oversized actions', () => {
    cy.visit('/users');

    cy.get('.user-list-table-scroll').then(($scroll) => {
      expect($scroll[0].scrollWidth).to.be.at.most($scroll[0].clientWidth + 1);
    });

    cy.get('.app-data-table-head').then(($head) => {
      expect(getComputedStyle($head[0]).backgroundColor).to.eq(
        'rgba(0, 0, 0, 0)'
      );
    });

    cy.get('[data-testid="user-list-row"] .app-button').each(($button) =>
      expectHeight($button, 30)
    );
    cy.get('.refreshed-card-surface > div:last-child .app-button').each(
      ($button) => expectHeight($button, 30)
    );
  });

  it('keeps the Users Settings heading and fields in one complete card', () => {
    cy.visit('/settings/users');

    cy.contains('.settings-group-card', 'User Settings')
      .should('contain', 'Login Methods')
      .and('contain', 'Default Permissions');
  });

  for (const route of [
    '/settings/plex',
    '/settings/services',
    '/settings/network',
    '/settings/jobs',
  ]) {
    it(`keeps legacy heading and body sections joined on ${route}`, () => {
      cy.visit(route);
      cy.get('.settings-page-content > .mb-6 + .section').each(($section) => {
        const headingBounds = $section.prev()[0].getBoundingClientRect();
        const sectionBounds = $section[0].getBoundingClientRect();

        expect(
          Math.abs(sectionBounds.top - headingBounds.bottom)
        ).to.be.lessThan(2);
        expect(getComputedStyle($section[0]).borderTopWidth).to.eq('0px');
      });
    });
  }
});
