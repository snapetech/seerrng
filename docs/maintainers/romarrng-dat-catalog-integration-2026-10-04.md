# ROMarrNG DAT catalog integration

**Status:** Implemented and pushed for review; ROMarrNG `v0.14.0` is released.
SeerrNG validation and production build pass on the current `v3.49.0` mainline;
its pull request and release steps remain pending.

## Pinned source and release

- SeerrNG base: `origin/main` at `b84785a83` (`v3.49.0`).
- SeerrNG implementation commit: `e72f113e6` on
  `codex/romarrng-integration-20261004`.
- ROMarrNG base: `origin/main` at `503106f74070aa36ce6be62888382678e87aa933`.
- ROMarrNG integration commit: `1495853becee3df54215a1fa06f82510c1314b4d`
  (parent of the release preparation).
- ROMarrNG release: [`v0.14.0`](https://github.com/snapetech/ROMarrNG/releases/tag/v0.14.0),
  release workflow [37223240019](https://github.com/snapetech/ROMarrNG/actions/runs/37223240019)
  completed successfully. The main-push YunoHost sync workflow separately failed
  because its checkout path is outside the GitHub Actions workspace; this did not
  block the release.

## Implemented contract and interface

ROMarrNG publishes a bounded, authenticated DAT catalog using opaque stable
title keys. It groups variants by title and matched system, applies configured
preferred regions, supports system listing, paginated browse, search and detail,
and reports unmatched or ambiguous headers. Request identity, provider stages,
safe failure codes and status history are carried through SeerrNG's software
request model. Local provider paths and file assets stay out of status DTOs.

SeerrNG adds the ROMarrNG DAT source to software acquisition settings, exposes a
platform mapping preview with editable overrides, and shows DAT catalog results
by system and title with search. It omits filters the DAT contract cannot
support, explains when no DAT catalog is loaded, and displays truthful
provider-reported progress, stage, failure and status history. Existing IGDB
and QuestarrNG paths remain available.

The shared contract fixture is
`docs/SEERRNG-INTEGRATION.contract-v2.json`. User setup and behavior are
documented in `docs/using-seerr/software-acquisition.md`; the rendered SeerrNG
release note is available with `pnpm release-notes:preview --base origin/main
--head HEAD`.

## Verification evidence

The earlier candidate used Node `24.21.0` and pnpm `10.24.0`. Its complete gate
discovered 92 Vitest files, 373 native TypeScript files, 56 native JavaScript
files, and 32 tooling files, with zero platform exclusions. Translations,
current-batch contract (555 files), shared-style reference check (384
components), formatting, lint, server types, client route types, and client
types passed.

- Vitest: 92 files, 426 tests passed.
- Native TypeScript: 811 suites, 2,843 tests; 2,839 passed, four skipped, zero
  failed.
- Native JavaScript: 56 files selected; 484 tests, 483 passed and one failed.
- Tooling, run separately after the full gate stopped: 15 suites, 238 tests
  passed, zero failures or skips.
- ROMarrNG: `python -m pytest tests/ -q` passed with 2,205 tests, two skips and
  one deselection.
- Cypress software-acquisition integration spec: three tests passed in mocked
  desktop and narrow-layout review. No real provider account or live ROMarrNG
  instance was used.

The first full run stopped in the native JavaScript lane at
`src/styles/watchlistPreview.test.mjs:83`: the test expected the old literal AST
guard and did not cover the saved hide preference. The newer upstream
`v3.49.0` base includes a behavior-based update for the list and discovery
guards. The integration branch was rebased onto that release, and the focused
file now passes all four tests, including the permission/preference matrix.
This upstream change preserves and expands behavioral coverage; no production
hook behavior or validation rule was changed for this integration.

The previous full-run totals are historical and do not certify the rebased
candidate. A fresh full gate and production build are pending below.

## Visual review and publication gates

Local Cypress screenshots are ignored generated files and were not committed:

- Settings, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-settings-desktop.png` and `romarrng-settings-mobile.png`.
- DAT catalog, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-dat-catalog-desktop.png` and `romarrng-dat-catalog-mobile.png`.
- Request progress, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-request-progress-desktop.png` and `romarrng-request-progress-mobile.png`.

John accepted the six reviewed desktop and narrow-layout screenshots in this
session. The contribution guide requires the pull-request description and
accurate AI disclosure to be written by the contributor in their own words.
No SeerrNG pull request, merge, or release tag has been created.

## Rebased candidate verification

Validated on `origin/main` `b84785a83` with Node `24.21.0` and pnpm `10.24.0`.
The plan selected 92 Vitest files, 373 TypeScript files, 56 JavaScript files,
and 32 tooling files, with zero platform exclusions. Translation extraction,
the 555-file current-batch contract, the 384-component shared-style check,
formatting, lint, server types, client route types and client types all passed.

- Vitest: 92 files, 426 tests passed.
- Native TypeScript: 573 suites and 2,845 tests; 2,841 passed, four skipped,
  zero failed.
- Native JavaScript: 56 files, 484 tests passed, zero skipped or failed.
- Tooling: 15 suites, 238 tests passed, zero skipped or failed.
- Production `pnpm build`: passed. Next.js compiled successfully and generated
  all 112 static pages; the server TypeScript build also passed.
- Release-note preview: the software note says administrators can choose the
  ROMarrNG DAT catalog, browse matched systems and search titles; the action is
  to load DAT files in ROMarrNG.
- Mocked Cypress integration spec: three tests passed. No live SeerrNG or
  ROMarrNG provider was used.

No SeerrNG pull request, merge, or release tag has been created. The repository
contribution guide requires the contributor to write the PR description and
accurate AI disclosure in their own words. The branch is ready for that review
step; ROMarrNG `v0.14.0` is already published.
