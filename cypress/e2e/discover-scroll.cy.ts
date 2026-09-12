const listItems = '.cards-vertical > li';
const targetIndex = 74;
const pageSize = 20;
const resultCount = 120;

const mockDiscovery = (tab: string, mediaType: string) => {
  const results = Array.from({ length: resultCount }, (_, index) => ({
    id: mediaType === 'book' ? `OLSCROLL${index + 1}W` : 900000 + index,
    mediaType,
    title: `Scroll ${mediaType} ${index + 1}`,
    name: `Scroll ${mediaType} ${index + 1}`,
    author: 'Scroll Author',
    overview: 'A deterministic discovery result for scroll restoration.',
    releaseDate: '2026-01-01',
    firstAirDate: '2026-01-01',
    firstPublishYear: 2026,
    posterPath: null,
  }));

  cy.intercept('GET', `/api/v1/discover/${tab}*`, (req) => {
    const page = Number(new URL(req.url).searchParams.get('page') ?? 1);
    req.reply({
      page,
      totalPages: resultCount / pageSize,
      totalResults: resultCount,
      results: results.slice((page - 1) * pageSize, page * pageSize),
    });
  }).as('discoveryPage');

  return results;
};

// Let Chromium paint the newly visited row so content-visibility has recorded
// its real size before we move farther down the list.
const paintVisitedRow = () =>
  cy.window().then(
    (win) =>
      new Cypress.Promise<void>((resolve) => {
        win.requestAnimationFrame(() => {
          win.requestAnimationFrame(() => resolve());
        });
      })
  );

const browseToTarget = () => {
  // Visit every row on the way down, as a person browsing does. Jumping
  // straight to the target leaves earlier rows at their estimated height
  // on both visits and misses the regression.
  for (let index = 4; index <= targetIndex; index += 5) {
    cy.get(listItems)
      .eq(index)
      .find('[data-testid=title-card]')
      .should('exist');
    cy.get(listItems)
      .eq(index)
      .scrollIntoView({ offset: { top: -300, left: 0 } });
    paintVisitedRow();
    cy.get(listItems)
      .eq(index)
      .should(($item) => {
        const bounds = $item[0].getBoundingClientRect();
        expect(bounds.top).to.be.at.least(0);
        expect(bounds.bottom).to.be.at.most(900);
        expect(bounds.height).to.be.closeTo(bounds.width * 1.5, 2);
      });
  }
};

describe('Discover Back navigation geometry', () => {
  beforeEach(() => {
    cy.viewport(1440, 900);
    cy.loginAsAdmin();
  });

  [
    { tab: 'movies', mediaType: 'movie' },
    { tab: 'tv', mediaType: 'tv' },
    { tab: 'books', mediaType: 'book' },
  ].forEach(({ tab, mediaType }) => {
    it(`returns to the same ${tab} card and viewport position after visiting details`, () => {
      const results = mockDiscovery(tab, mediaType);
      const target = results[targetIndex];
      const detailPath = `/${mediaType}/${target.id}`;
      // Book cards on /discover/books carry a `?format=` query param on their
      // detail link so the request modal defaults to the tab's format --
      // pathname-only checks (location, API intercepts) use detailPath, but
      // the rendered <a href> for books includes the query string.
      const detailHref =
        mediaType === 'book' ? `${detailPath}?format=ebook` : detailPath;
      let beforeTop = 0;
      let beforeOrder: string[] = [];

      cy.intercept('GET', `/api/v1${detailPath}/*`, {
        page: 1,
        totalPages: 1,
        totalResults: 0,
        results: [],
      });
      const details = {
        ...target,
        credits: { cast: [], crew: [] },
        productionCompanies: [],
        productionCountries: [],
        spokenLanguages: [],
        genres: [],
        keywords: [],
        relatedVideos: [],
        externalIds: {},
        releases: { results: [] },
        contentRatings: { results: [] },
        seasons: [],
        createdBy: [],
        episodeRunTime: [],
        networks: [],
        isbnCandidates: [],
        subjects: [],
        originalLanguage: 'en',
        status: 'Released',
      };
      cy.intercept('GET', `/api/v1${detailPath}`, details).as('details');
      if (mediaType !== 'book') {
        // Video detail pages also fetch on the server. Stub the Next data
        // response so the synthetic ID never depends on an upstream title.
        cy.intercept('GET', `**/_next/data/*${detailPath}.json*`, {
          pageProps: { [mediaType]: details },
          __N_SSP: true,
        });
      }

      cy.visit(`/discover/${tab}`);
      cy.wait('@discoveryPage');

      browseToTarget();

      cy.get(`${listItems} a[href="${detailHref}"]`).should('be.visible');
      cy.get(`${listItems} a`).then(($links) => {
        beforeOrder = $links
          .toArray()
          .map((link) => link.getAttribute('href') ?? '');
      });
      // Measure the outer li: the inner card can scale when hovered. Disable
      // Cypress's automatic click scrolling so the measurement is unchanged.
      cy.get(listItems)
        .eq(targetIndex)
        .then(($item) => {
          beforeTop = $item[0].getBoundingClientRect().top;
        });
      cy.get(`${listItems} a[href="${detailHref}"]`).click({
        scrollBehavior: false,
      });
      cy.wait('@details');
      cy.location('pathname').should('eq', detailPath);
      cy.get('[data-testid=media-title]').should('contain', target.title);

      cy.go('back');
      cy.location('pathname').should('eq', `/discover/${tab}`);
      cy.get(`${listItems} a`).should(($links) => {
        const afterOrder = $links
          .toArray()
          .map((link) => link.getAttribute('href') ?? '');
        expect(afterOrder.slice(0, beforeOrder.length)).to.deep.eq(beforeOrder);
      });
      // Do not scroll the target into view here: Back must restore it itself.
      cy.get(listItems)
        .eq(targetIndex)
        .should(($item) => {
          expect($item.find(`a[href="${detailHref}"]`)).to.have.length(1);
          expect($item[0].getBoundingClientRect().top).to.be.closeTo(
            beforeTop,
            2
          );
        });
    });
  });

  it('updates remembered offscreen row heights when the column count changes', () => {
    mockDiscovery('movies', 'movie');
    cy.visit('/discover/movies');
    cy.wait('@discoveryPage');
    browseToTarget();

    let previousColumns = 0;
    cy.get('.cards-vertical').then(($grid) => {
      previousColumns = getComputedStyle($grid[0]).gridTemplateColumns.split(
        ' '
      ).length;
    });

    [900, 1600].forEach((width) => {
      cy.viewport(width, 900);
      paintVisitedRow();
      cy.get('.cards-vertical')
        .should(($grid) => {
          const columns = getComputedStyle($grid[0]).gridTemplateColumns.split(
            ' '
          ).length;
          expect(columns).not.to.eq(previousColumns);
        })
        .then(($grid) => {
          previousColumns = getComputedStyle(
            $grid[0]
          ).gridTemplateColumns.split(' ').length;
        });
      // The first row was painted while browsing but is now far offscreen.
      // Its remembered height must not prevent it shrinking to the new width.
      // Reading only the outer li does not force its skipped content to render.
      cy.get(listItems)
        .first()
        .should(($item) => {
          const bounds = $item[0].getBoundingClientRect();
          expect(bounds.bottom).to.be.lessThan(0);
          expect(bounds.height).to.be.closeTo(bounds.width * 1.5, 2);
        });
    });
  });
});
