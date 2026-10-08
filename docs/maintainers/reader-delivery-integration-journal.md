# Grimmory and BookOrbit reader delivery integration journal

> **Current maintainer direction — October 7, 2026:** Pending human visual
> review recorded below is historical evidence, not a merge or release gate.
> Visual inspection can be recorded separately; user authorization and the
> applicable automated and functional checks still govern publication.

## Recovery identity

- Starting repository revision: `a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9`.
- The initial reader implementation was kept in the recovery snapshot/stash
  recorded in the game-library integration journal. It is now integrated into
  `/tmp/seerrng-reader-groupings` on top of current `origin/main`.
- The initial user work included external request-list sync settings, software
  routes, entity, and migrations; subsequent external-list files remain
  separately attributable in the combined candidate.

## Scope and decisions

- Keep Bookshelf as the acquisition and availability source.
- Integrate Grimmory and BookOrbit through their documented OPDS catalogs and
  Grimmory's documented Komga API. Do not copy either application's code or
  depend on server APIs that lack a stable published contract.
- Keep Grimmory as the default preferred app. When its address is empty, use a
  configured BookOrbit address for the book-page handoff without changing the
  saved preference.
- Media pages open the configured reader service's web library. E-reader
  clients get the generated OPDS address in Settings > Services > Reader Apps;
  comic clients get Grimmory's separate Komga address there. Grimmory's
  audiobook link opens its built-in library player.
- Book, comic, and magazine pages offer protected direct downloads for files
  attached to the signed-in user's available requests. Book downloads preserve
  the ebook/audiobook distinction, including combined requests; comic and
  magazine downloads list available issues. Request Status is filtered by the
  exact internal media ID and signed-in user, and download routes recheck
  requester and request-view permissions before each file stream. Downloads
  save through the browser on the current device; they do not push files to an
  e-reader or sync progress.
- Partial provider failures preserve any copies already resolved and report
  that lookup was incomplete instead of presenting the result as an empty
  library.
- The initial URL/handoff implementation stored only HTTP or HTTPS app
  addresses. The later managed-shelf phase below adds a separate SeerrNG
  administrator account for shelf operations and redacts its passwords from
  API responses. OPDS reader credentials, scan results, device state, reading
  progress, and annotations remain in the companion app.

## File record

- server/lib/settings/index.ts: added the reader-delivery type, empty URL
  defaults, Grimmory preference, settings field, and getter. This file also
  contains pre-existing external-request-list changes; those are user-owned.
- server/routes/settings/readerDelivery.ts: added admin-only settings
  retrieval and persistence, redacted account credentials, URL validation,
  normalization of pasted OPDS addresses, connection checks, rule previews,
  live shelf create/update/delete, and durable SeerrNG mapping state.
- server/routes/settings/readerDelivery.test.ts and
  server/api/readerDelivery.test.ts: cover secret redaction, access controls,
  provider-specific filters and payloads, preview/count states, empty-rule
  consent, upserts, BookOrbit visibility constraints, and managed deletion.
- server/entity/ReaderDeliveryGrouping.ts and the SQLite/Postgres
  `1791030000000-CreateReaderDeliveryGroupings` migrations: persist only the
  target-to-provider shelf mapping and operation status; reader files and
  catalog contents stay in the reader service.
- src/components/Common/ReaderGroupingAction.tsx and
  src/components/Settings/ReaderDeliverySettings.tsx: expose shelf preview,
  save, visibility/Kobo options, status/count, and removal to administrators.
- AuthorDetails, BookSeriesDetails, and ComicDetails: add the shelf action to
  relevant author and series pages.
- seerr-api.yml: documents the admin reader settings, connection test, managed
  shelf listing, preview, save, and delete contracts.
- server/routes/settings/index.ts: mounted the reader-delivery settings API.
- server/routes/service.ts: added the authenticated handoff summary, selecting
  the preferred configured app or falling back to the other app without
  changing preference.
- server/routes/request.ts and server/lib/requestStatus.ts: added exact
  media-ID filtering to Request Status for the book-page lookup.
- server/interfaces/api/requestInterfaces.ts: added the shared Request Status
  media-ID query and typed download asset response, including book-file format.
- seerr-api.yml: documented the Request Status mediaId query parameter, typed
  book-file format and partial download-lookup status, and the reader-service
  handoff endpoint. This file also has a separate user-owned
  external-request-list change.
- src/components/Settings/ReaderDeliverySettings.tsx: added Grimmory and
  BookOrbit address fields, generated OPDS addresses, copy fallback, preference
  selection, setup links, save and discard states, and shared-library guidance.
- src/components/Settings/SettingsServices.tsx: placed reader configuration
  after Bookshelf services.
- src/components/BookDetails/index.tsx, ComicDetails/index.tsx,
  MagazineDetails/index.tsx: connect page actions to the matching reader
  library and protected per-request download workflow.
- src/components/Common/ReaderDeliveryLink.tsx: opens the reader web library,
  and explains where to copy OPDS or Komga addresses for reader apps. Grimmory
  remains the default and audiobook player target; BookOrbit remains the
  configured fallback and its archive/PDF capability is described separately.
- src/components/Common/RequestDownloadAction.tsx: scopes Request Status to the
  current user, exact media ID and media type; supports one or many assets,
  partial lookup errors and a useful Request Status fallback. Combined book
  requests show only the selected ebook or audiobook format.
- server/lib/requestDownloadAssets.ts and seerr-api.yml: preserve file format
  metadata, retain successful assets when one combined-request Bookshelf lookup
  fails, and return an explicit partial-error indicator without provider paths
  or credentials.
- docs/using-seerr/reader-delivery.md and docs/README.md: added operator setup
  and troubleshooting guidance, device download steps, and indexed the guide.
- src/i18n/locale/en.json: extracted the new book-page and reader-settings
  messages. The extractor also captured labels from the separate external-list
  component already present in the working tree; that user-owned source was not
  changed here.
- release-notes/2026-10-04-reader-service-delivery.md: documented the OPDS and
  direct-download workflows in the user-facing release fragment.

No stylesheet changes were needed. Focused regression cases were added for
exact-media Request Status filtering, malformed media IDs, the Request Status
OpenAPI contract, and safe download-file resolution.

## Unrelated work preserved

The following existing or concurrent external-request-list changes were
authored independently of reader delivery (the single `mediaId` parameter
addition in the shared OpenAPI file is reader delivery work). They remain
separately attributable in the consolidated release candidate:

- server/routes/software.ts and server/routes/software.test.ts
- server/lib/settings/index.ts external-request-list job type and schedule
- server/job/schedule.ts
- server/routes/index.ts
- seerr-api.yml
- server/entity/ExternalRequestList.ts
- server/lib/externalRequestLists.ts
- server/lib/externalRequestLists.test.ts
- server/lib/settings/migrations/0021_add_external_request_list_sync_job.ts
- server/lib/settings/migrations/0021_add_external_request_list_sync_job.test.ts
- server/migration/postgres/1791010000000-CreateExternalRequestLists.ts
- server/migration/sqlite/1791010000000-CreateExternalRequestLists.ts
- server/migration/sqlite/1791010000000-CreateExternalRequestLists.test.ts
- server/routes/externalRequestLists.ts
- server/routes/externalRequestLists.test.ts
- src/components/UserProfile/UserSettings/UserGeneralSettings/index.tsx
- src/components/UserProfile/UserSettings/UserGeneralSettings/ExternalRequestLists.tsx
- the external-list message additions in src/i18n/locale/en.json were emitted
  by the shared catalogue extractor for that existing user-owned component.

The reader-grouping capability is now mounted and exposed in the admin UI. It
manages rule-based shelves only; it does not create reader-library entries or
copy, move, or delete reader files. Provider operations use bounded previews,
explicit opt-in for empty rules, a durable local mapping, and redacted service
credentials.

### Earlier grouping checkpoint — superseded

At an earlier integration checkpoint, `server/api/readerDelivery.ts`,
`ReaderDeliveryGrouping`, and the `1791030000000-CreateReaderDeliveryGroupings`
migrations existed but were not mounted by the reader-delivery routes. That
checkpoint correctly described them as internal groundwork at the time. The
live routes, settings controls, detail-page action, API contract, and focused
regression coverage described above supersede that implementation status.

## Verification and acceptance

- Source review: inspected the changed reader-delivery paths and their existing
  settings and Bookshelf owners, including the existing request-level download
  authorization and file resolution path.
- Runtime: Node.js 24.15.0 from the official Node archive with its published
  SHA-256 verified; pnpm 10.24.0 from the repository toolchain.
- Focused automated checks: Request Status exact-media/current-owner case
  passed (1/1); malformed media ID validation passed (1/1); reader settings and
  preferred-app fallback tests passed (3/3); Request Status OpenAPI tests passed
  (7/7); mapped-download asset tests passed (3/3), including the ebook/audiobook
  split for a combined request.
- TypeScript: server and client type checks passed. Targeted ESLint and Prettier
  checks passed for the changed application and route files.
- UI batch: current-batch contract passed (557 files); shared-style reference
  audit inspected 386/386 components; its behavior checks passed (68/68).
- Translation catalogue: `i18n:check` passed after extracting the English
  messages from the current source tree.
- Whitespace: `git diff --check` passed.
- A first Vitest invocation included an unnecessary `--` separator and was
  interrupted after it failed to select the requested file. The correctly
  scoped Vitest command then completed successfully; the interrupted run is not
  counted as evidence.
- An intermediate OpenAPI run caught indentation that placed the new optional
  book-file format outside the download asset schema. The schema was corrected,
  and the final OpenAPI suite then passed (7/7).
- Full development validation, production build, full-repository lint, and
  release-note preview: not run.
- Rendered preview and human visual review: pending; no safe disposable preview
  instance was available. The source/style checks above do not prove that the
  rendered page works or looks correct.
- Grimmory, BookOrbit, and e-reader OPDS round trips: pending; no live reader
  service was configured or contacted.
- No change is staged, published, or deployed.

## Combined candidate update — October 4, 2026

- Forward-integrated upstream Audiobookshelf/ChaptarrNG and v3.50.0 release
  preparation. Reader settings and download actions were preserved across the
  shared Settings Services, Book Details, Request Status, request API, and
  OpenAPI files.
- Shared English catalog extraction also includes the independently preserved
  game-library and external-request-list strings.
- The cumulative development gate, production build and isolated rendered
  preview were pending in this historical candidate. Human visual acceptance
  was also recorded as pending, but is not a publication gate under current
  maintainer direction.
- The first integrated validation attempt stopped at formatting before test
  execution. Twenty-two candidate files were formatted; no test results were
  counted from that attempt.
- Grimmory, BookOrbit, OPDS, and live Bookshelf delivery round trips remain
  unverified; the implementation uses mocked/unit/provider-boundary evidence.

## Audiobook, comic, and magazine extension — October 4, 2026

This extension expands the existing ebook reader workflow. Grimmory supports
ebooks through OPDS, M4B/M4A/MP3 audiobooks through its player, and comics
through the Komga API. BookOrbit provides OPDS for ebooks, supported CBZ/CBR
comic archives, and PDFs. Magazine PDFs must be imported into either reader
library as ordinary PDF files. Neither service is documented here as a
magazine-specific catalog or as BookOrbit audiobook playback.

Book, comic, and magazine details now include format-aware protected download
actions when the signed-in user has an available request with a resolvable file.
These use existing service path mappings and Mylar's issue stream. Provider
errors are reported separately from no-copy results, and combined book requests
continue checking the second format when the first provider fails.

Current extension verification after the last source edits:

- Focused Vitest: 3 files, 16 tests passed (download actions, reader links,
  resolved path downloads and partial combined-request errors).
- Focused Node API tests: 3 files, 8 tests passed (reader settings validation
  and fallback, download response OpenAPI contract, and reader handoff route).
- Focused Request Status integration tests: 2 tests passed (exact media ID and
  requester filtering; malformed media ID rejection).
- Server and client TypeScript checks passed; focused ESLint passed; Prettier,
  translation catalogue and whitespace checks passed.
- Shared UI batch check passed: current-batch contract covers 561 files, shared
  style references inspect 390 components, button geometry 68/68 passed.
- The local validation plan was inspected: 95 Vitest, 376 native TypeScript,
  56 native JavaScript and 32 tooling files selected, with no declared platform
  exclusions. The complete cumulative gate has not run on an isolated reader
  candidate; the checkpoint records earlier unrelated cumulative failures and
  unavailable tool inputs that must be reconciled before a release claim.
- Rendered preview and human visual review remained pending at this point. The
  in-app browser and isolated workspace browser tools were not exposed in this
  session. No live Grimmory, BookOrbit, OPDS app, or e-reader round trip ran.
- The earlier instruction to keep external request-list and software catalog
  changes outside the reader-delivery candidate was superseded by the user's
  explicit direction to include all distinct dirty and unrelated work in the
  final release.

## All-dirty consolidation — October 4, 2026

The user explicitly directed that all distinct dirty and unrelated changes be
included. The candidate therefore keeps the following independently authored
work together while retaining its separate release notes and test coverage:

- Per-user external request lists, the Steam household game library, software
  catalog search fallback, request-count refresh, and the earlier game/reader
  features already present in this candidate.
- The donation-link change from `/tmp/codex-support-links/seerrng`, including
  its README/About updates and `release-notes/changed-donation-link.md`.
- The Audiobookshelf pagination/completeness hardening from preserved stash
  `d377f690ddda68b0d15bf4bb8ef9a246e51b31bc`, with a bounded item-ID set,
  per-page response checks, regression coverage, and
  `release-notes/2026-10-04-audiobookshelf-scan-bounds.md`.
- The request-edit identity fix from `/tmp/seerrng-release-integration`.
  `RequestBlock` now uses the parent detail identity when an API response omits
  `request.media`, while keeping movie, TV, book, music, comic, magazine and
  collection modal identities available. External-media detail pages provide
  their own identity as well. Its UI regression tests and dev-only QA route are
  retained, with the QA route returning 404 in production, and the fix has a
  structured release-note fragment.
- The independent discover OpenAPI response-contract regression test from
  `/tmp/seerrng-response-v2-pre`.

The Cypress database-preparation change, magazine ID-zero tests, failed-download
route tests, Questarr help-text assertion, and request-count work were already
present in the consolidated tree; duplicate source snapshots were not copied a
second time. Earlier reader-delivery and grouping snapshots are recovery states,
not separate newer patches. No source worktree or stash was dropped.

Recovery before merging the all-dirty inventory is preserved as stash
`057219485a063805eea0aabf4f1a0ef652842e6c`. The inventory and merge are
complete; full development validation, production build, rendered review,
commit, push, and release were pending at that checkpoint. Human visual
acceptance is not a separate merge or release gate.

Focused verification after the last request-edit and Audiobookshelf changes:

- `pnpm test:node` on Audiobookshelf scan helper/scanner/API tests and discover
  OpenAPI contract: **12 passed, 0 failed, 0 skipped**.
- Vitest `RequestBlock/index.test.tsx`: **2 passed, 0 failed**.
- Server and client TypeScript checks: **passed**.
- Focused ESLint, English message extraction/check, and Prettier after formatting:
  **passed**.
- The initial direct `node --import tsx --test` attempt used a loader absent from
  this repository and is not counted; the project-supported `pnpm test:node`
  runner then executed the affected Node suites successfully.

## Rebuilt rendered settings workflow — October 4, 2026 (Regina local)

The production app was rebuilt after the GameLibrary page-shell correction and
the Settings Services reader UI was reviewed from that build. Its final isolated
Cypress flow passed **1/1** at 1280×900 and 390×844 CSS viewports. It saved both
reader addresses and the BookOrbit preference, checked the generated Grimmory
OPDS and Komga links and BookOrbit OPDS link, reloaded to verify persistence,
and confirmed the reader shelves empty state. Screenshot captures at
`/tmp/seerrng-rendered-review-20261005/reader-delivery/` were inspected; headless
Electron saved them at 1280×720 and 390×720 even though the test verified the
larger CSS viewport heights.

The run used the disposable local SQLite configuration and reserved `.test`
reader addresses. It did not run the connection-test action or contact
Grimmory, BookOrbit, an OPDS client, or an e-reader. Provider round trips remain
unverified. The complete development gate passed: 99 Vitest files/452 tests;
385 Node TypeScript files/2,912 tests (2,908 passed and four PostgreSQL-only
skips); 56 native JavaScript files/485 tests; 32 tooling files/238 tests; 569
current-batch files; and 397/397 shared-style references. There were no
failures or platform exclusions. The final gate log is
`/tmp/seerrng-validate-development-final-20261005.log`. Human visual review
status was pending in this historical record.

## All-dirty commit and forward-integration checkpoint

- Reader delivery and managed groupings are committed as
  `f1b69beda9ac8400dae12183c32c547fc3191e40`. Grimmory remains the default;
  BookOrbit can be selected and is used as the configured fallback where
  Grimmory has no address.
- The game and external request-list changes remain separately attributable in
  their own commits and release fragments.
- The branch was rebased without conflicts onto `origin/main`
  `4665245f97a90d546a94eb25fdcd4c91104bfd7b`; its only intervening change is
  the YunoHost manifest. The source commit is now
  `23e84d7aa462d6da6c5293fa8d84b2adfe11e282`.
- Final integrated validation, production build, and disposable reader browser
  flow are pending; prior validation and screenshots do not cover that target.
- No live Grimmory, BookOrbit, OPDS, Komga, or Bookshelf round trip has been
  verified. Human visual review was pending in this historical record.
