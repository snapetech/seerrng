# SeerrNG game library and household play integration journal

## Recovery identity

- Starting revision: `a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9` on `main`.
- Pre-edit recovery snapshot: `/tmp/seerrng-pre-game-20261004`.
- Original recovery stash: `3b4e8dfbf9dbc20b1fc444650c3243f9b37a4d5f`.
- Active integrated candidate: `/tmp/seerrng-reader-groupings`, branch
  `codex/reader-groupings-20261004`.
- Current candidate base: `06fbbce72260a08f36139af5dcd94dcda0bd481f`
  (`test: align book API key helper assertion` on current `origin/main`).
- Pre-all-dirty-consolidation recovery stash:
  `057219485a063805eea0aabf4f1a0ef652842e6c`.
- Forward-integration checkpoints retained:
  `527b16ec5367eeaf122705bc61d086bfdd9016ad` (Audiobookshelf/ChaptarrNG) and
  `d3344bed33786af95d5b4b4a3003e604aea8265c` (v3.50.0 release preparation).
- No task commit, push, tag, publication, or deployment has been created.
- Existing dirty reader delivery, per-user request-list, software-search, and
  request-count work is being preserved as separately attributable work.

## Forward integration

- Integrated the complete upstream `e9d2e50f2b446a70e01f5b16af8bc8265ed99b3e`
  Audiobookshelf/ChaptarrNG commit and the subsequent v3.50.0 release-prep
  commit. That checkpoint initially followed `origin/main` at `86eafa28f`; the
  consolidated candidate was later advanced to `06fbbce72`.
- The upstream settings and service work overlapped `readerDelivery` and Steam
  settings. Both `audiobookshelf` and `readerDelivery` settings accessors and
  route mounts are retained. Combined Request Status, Book Details, Settings
  Services, OpenAPI, and English messages were reviewed in the integrated diff.
- The original game implementation and earlier focused checks predate this
  forward merge; the final cumulative gate and production browser run cover the
  integrated tree.

## Scope and decisions

- Add a personal game library alongside software requests. Library progress,
  ownership, catalog links, Steam identity, and household sharing are distinct
  fields so importing ownership cannot overwrite a user's progress or privacy
  choice.
- Keep every entry private by default. Sharing requires confirmed ownership and
  an explicit per-title choice; shared results expose only those opted-in
  entries and the owner's chosen progress/store/platform/playtime details.
- Link Steam through session-bound OpenID 2.0. Verify the signed assertion and
  identity with Steam, keep the Web API key server-side, require public Steam
  Game Details for imports, and never ask the user for a Steam password.
- Treat a completed Steam response as the ownership source of truth for Steam
  entries. Preserve personal progress and manual ownership, clear unverified
  Steam ownership on unlink, and do not guess catalog matches during sync.
- Let users explicitly match an unmatched game to the software catalog. Group
  household overlap by catalog ID, then Steam app ID, then normalized title.
- Preserve the existing QuestarrNG/ROMarrNG request/acquisition flow. Show the
  user's current software request status in their own library, and link eligible
  titles into the existing request flow according to request permission.
- Use existing semantic appearance and layout roles from
  `src/styles/globals.css`; no shared stylesheet changes were required.

## Change record

- `server/entity/GameLibraryEntry.ts` and `GameLibraryAccount.ts`: personal
  progress/ownership/sharing state and a unique per-user Steam link.
- `server/migration/sqlite/1791020000000-CreateGameLibrary.ts` and
  `server/migration/postgres/1791020000000-CreateGameLibrary.ts`: persistent
  schema and indexes; SQLite migration behavior has a regression test.
- `server/api/software/steam.ts`: bounded Steam OpenID verification and owned
  game retrieval using the server-side key.
- `server/lib/gameLibrary.ts`: normalized serialization, successful sync,
  unlink cleanup, and explicit-share household aggregation.
- `server/routes/gameLibrary.ts`: authenticated private and shared reads,
  session-protected mutations, user-selected catalog matching, Steam link,
  sync, and unlink routes.
- `server/routes/index.ts` and `seerr-api.yml`: route mounting and documented
  request/response contracts.
- `server/lib/settings/index.ts`,
  `server/routes/settings/softwareAcquisition.ts`, and
  `src/components/Settings/SettingsSoftwareAcquisition.tsx`: administrator
  configuration with redacted Steam key reads and explicit key removal.
- `server/types/express-session.d.ts`: typed Steam link state stored on the
  browser session.
- `src/pages/games.tsx`, `src/components/GameLibrary/index.tsx`, and the
  sidebar/mobile menus: personal library, Steam sync controls, catalog/manual
  add, progress/ownership editing, private sharing controls, search/filtering,
  and household overlap view.
- `src/components/SoftwareCatalog/index.tsx`: private add-to-library action
  and catalog-to-library deep link.
- `src/i18n/locale/en.json`: extracted user-facing strings.
- `docs/using-seerr/game-library.md`, `docs/README.md`, and
  `release-notes/2026-10-04-game-library-and-household-play.md`: operator/user
  guidance and the structured user-facing release note.
- `server/api/software/steam.test.ts`, `server/lib/gameLibrary.test.ts`,
  `server/migration/sqlite/1791020000000-CreateGameLibrary.test.ts`,
  `server/routes/gameLibrary.test.ts`, and
  `src/components/GameLibrary/index.test.tsx`: provider-boundary, privacy,
  persistence, route/OpenAPI, and rendered household/library regression tests.

## Preserved independent work

- Reader delivery: Grimmory/BookOrbit settings, page handoffs, protected
  request-file delivery, tests, documentation, and
  `release-notes/2026-10-04-reader-service-delivery.md`.
- Per-user external request lists: scheduled synchronization, privacy-scoped
  settings, migrations, API/routes, tests, and
  `release-notes/2026-10-04-per-user-request-lists.md`.
- Software catalog search fallback and its tests/documentation in
  `release-notes/2026-10-04-software-catalog-search-fallback.md`.
- Request-count refresh and its hook/test/release note in
  `release-notes/2026-10-04-request-count-refresh.md`.
- Shared files contain hunks for multiple features. They must be staged and
  reviewed as integrated files without dropping any of those changes.

## Verification ledger

- First integrated validation attempt stopped at formatting before executing
  any test lane. Prettier reported 22 candidate files; those files were formatted
  with the repository's pinned Prettier. This failed attempt is not a test pass.
- Steam API boundary, game-library helper, SQLite migration, game routes, and
  software settings/catalog focused Node tests: **57 passed, 0 failed**.
- Game-library rendered component regression checks: **2 passed, 0 failed**.
- Server TypeScript check: **passed**.
- Client TypeScript check: **passed after the request-count test's fetcher was
  made an ordinary typed async function**.
- English message extraction completed. Translation consistency and whitespace
  checks are recorded again on the final candidate.
- The merged-tree inventory was inspected with
  `pnpm validate:development --plan`: 97 Vitest, 383 native TypeScript, 56
  native JavaScript, and 32 tooling files selected (**568 total; 0 declared
  platform exclusions**). This is test discovery, not an executed pass.
- Required full `pnpm validate:development` gate: **not run**.
- Production `pnpm build`: **not run**.
- Release-note preview: **not run**.
- Desktop/narrow rendered browser review: **pending**.
- Human visual review: **pending in this historical checkpoint**.
- Steam/QuestarrNG/ROMarrNG live round trips: **not run**; provider behavior is
  covered by isolated tests, not live integration evidence.

## Delivery state

- Implementation and integration are still in progress.
- No task source is committed, pushed, tagged, or published at this point.
- This historical record treated human review as necessary under
  `CONTRIBUTING.md`. The project owner's October 7, 2026 direction removes
  separate human acceptance as a merge or release gate. The final contribution
  record must still disclose Codex use and the extent of assistance.

## Rebuilt rendered workflow — October 4, 2026 (Regina local)

The follow-up render found a nested `main.page-layout` inside the shared app
page shell. GameLibrary now uses the shared shell once. The production build
passed after this layout correction at
`/tmp/seerrng-production-build-final-20261005.log`.

The final isolated Cypress flow passed **1/1** against the rebuilt bundle.
Admin and demo each added a uniquely named manual game and explicitly shared
it; the Play Together view showed two owners. Desktop and mobile checks covered
1280×900 and 390×844 CSS viewports, with no page/body width overflow or visible
content past the usable edge. Screenshots at
`/tmp/seerrng-rendered-review-20261005/game-library/` were inspected. They are
captured at 1280×720 and 390×720 by headless Electron, so their physical height
does not reflect the tested CSS viewport height.

The app ran from the production build with a fresh disposable SQLite database.
The E2E flow exercises manual library and household-sharing behavior; it does
not test live Steam authentication or call Steam, QuestarrNG, or ROMarrNG.
Those provider round trips remain unverified. The complete development gate
passed: 99 Vitest files/452 tests; 385 Node TypeScript files/2,912 tests (2,908
passed and four PostgreSQL-only skips); 56 native JavaScript files/485 tests;
32 tooling files/238 tests; 569 current-batch files; and 397/397 shared-style
references. There were no failures or platform exclusions. The final gate log
is `/tmp/seerrng-validate-development-final-20261005.log`. Human visual
review was tracked separately from these automated results.

## All-dirty commit and forward-integration checkpoint

- Implementation is committed as `4d2e6572a232ddb41adc3b8fbdaca6442df240b6`.
  That commit also carries the related QuestarrNG catalog-search fallback and
  its separate release-note fragment.
- The required commit hook initially rejected this batch for seven ESLint
  findings. The Cypress assertion, shared-game aggregation state, migration
  type import, test-array types, and unused loading variable were corrected;
  the staged ESLint and formatting hook passed before the commit was created.
- The branch was rebased without conflicts onto `origin/main`
  `4665245f97a90d546a94eb25fdcd4c91104bfd7b`; its only intervening change is
  the YunoHost manifest. The source commit is now
  `a393ab927550b5069078e24b67db2ca66c44e0cc`.
- The rebase plan selects 99 Vitest, 385 native TypeScript, 56 native
  JavaScript, and 32 tooling files with zero declared platform exclusions.
  Final integrated validation, production build, and disposable browser flows
  remain pending. The prior rendered game flow predates the aggregation
  cleanup and must be rebuilt and rerun.
- Steam, QuestarrNG, and ROMarrNG live round trips remain unverified.
  Human visual review was not recorded as complete in this historical entry.
