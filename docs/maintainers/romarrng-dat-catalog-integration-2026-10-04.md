# ROMarrNG DAT catalog integration

**Status:** Implemented and pushed for review; SeerrNG finalization is pending.

## Pinned source and release

- SeerrNG base: `origin/main` at `a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9`.
- SeerrNG implementation commit: `0d16cc688ec591f470bb4315479e7e90cc800abe` on
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

The final candidate used Node `24.21.0` and pnpm `10.24.0`. The complete gate
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

The full `pnpm validate:development` command failed in the native JavaScript
lane at `src/styles/watchlistPreview.test.mjs:83`. That unchanged test expects
the AST expression `hideBlocklisted && !canManageBlocklist` in unchanged
`src/hooks/useDiscover.ts`; the current hook includes the existing
`settings.currentSettings.hideBlocklisted` option in its guard. Neither file is
part of this integration diff. The failure is outside the requested software
catalog scope. Repository instructions require maintainer direction before
expanding into unrelated repair, so no assertion, hook behavior, exclusion, or
gate was changed to conceal it.

No production build was run after this failure. Therefore this candidate does
not have a complete gate or build pass. The separate tooling run does not
replace the full gate.

## Visual review and publication gates

Local Cypress screenshots are ignored generated files and were not committed:

- Settings, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-settings-desktop.png` and `romarrng-settings-mobile.png`.
- DAT catalog, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-dat-catalog-desktop.png` and `romarrng-dat-catalog-mobile.png`.
- Request progress, desktop and narrow: `cypress/screenshots/software-acquisition-romarrng.cy.ts/romarrng-request-progress-desktop.png` and `romarrng-request-progress-mobile.png`.

Automated rendering is not human acceptance. John must review the six concrete
screens before a SeerrNG release tag. The contribution guide also requires John
to write the pull-request description and accurate AI disclosure in his own
words. No SeerrNG pull request, merge, or release tag has been created. After
the unrelated baseline test receives maintainer direction, rerun the exact full
gate, build the exact accepted candidate, and complete the human review before
release.
