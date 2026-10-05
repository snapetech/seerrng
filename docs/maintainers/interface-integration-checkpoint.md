# Interface Integration Checkpoint

This is the living evidence appendix for the forward-merge guide, not a release
approval or a complete site-audit claim. Read `AGENTS.md`, UI Style Standard and
UI Fix-It first. Preserve earlier accepted work while reviewing small batches.
Never infer human acceptance from test success or a journal's implementation note.

## Preservation and coverage map

| Work to preserve                                                       | Established owners and existing checks                                                                                                                                                                            | Review boundary                                                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request Status and request-modal layout, filters, actions, title roles | `globals.css`, Request components; `src/styles/buttonGeometry.test.mjs`, `requestLayout.test.mjs`, current-batch contract                                                                                         | Earlier work is in scope for the contribution; a Series-first batch does not remove it. Final accepted references and current narrow renders remain to be assembled. |
| Shared page titles/headings, typography and spacing                    | `page-title`, `page-heading`, card/table families; `buttonGeometry.test.mjs`, current-batch contract                                                                                                              | Preserve role owners and existing acceptance, not retired experimental values.                                                                                       |
| Aggregate loading/searching/mutation status                            | `page-title-row`, `page-status`, shared status/spinner; `buttonGeometry.test.mjs` and component tests                                                                                                             | Keep one real activity indicator; completion/unmount must clear contributions.                                                                                       |
| Poster dimensions, buttons, media slots and hover                      | `poster-layout`, poster frame/region/control roles; `buttonGeometry.test.mjs`, `iconOnlyButtons.test.mjs`                                                                                                         | Fixed browsing geometry is distinct from detail/credit posters. Trace all affected renderers.                                                                        |
| Series tree, quality, native controls and disclosure ordering          | Series components, shared selection/tree/ratings/disclosure owners; `seriesDetailsStyle.test.mjs`, native-action suites and reorder suites                                                                        | Selection and permissions remain functional contracts. Mocked drag tests do not prove physical drag/touch acceptance.                                                |
| Current Plex Collection repair                                         | `server/api/plexapi.ts`, native collection routes/client; `server/api/plexCollections.test.ts`, `src/styles/mediaServerCollectionsClient.test.mjs`, `mediaServerCollections.test.mjs`, `plexCollections.test.mjs` | Optional smart marker is accepted only with remaining exact identity checks. Remove only membership, never the collection.                                           |
| Mutable Watchlist/Collection state                                     | `server/middleware/apiResponseCache.ts`, native clients, `ServiceWorkerSetup/sw.ts`; cache/client/service-worker tests                                                                                            | Fresh initial/pre-write reads and confirmed desired state; local Seerr watchlist and Plex Watchlist remain distinct.                                                 |
| Dropdown opacity, overflow and ancestor framing                        | Shared dropdown/menu surface and detail-card open state; `seriesDetailsStyle.test.mjs`, `Common/Dropdown/playbackStyle.test.tsx`                                                                                  | Parsed source ownership is not rendered paint-order proof. Compare open and closed desktop/narrow states.                                                            |

The broader [Interface Preservation Inventory](interface-preservation-inventory.md)
has been reconciled against the journal and original chat. It covers the Request
page and shared roles, poster/browse prototypes, dropdown/mosaic cleanup, final
tree/table/workspace, ratings, ordering and native actions. It distinguishes
explicit acceptance, pending review, retired trials and opt-in references.
Neither document replaces the final three-way changed-file inventory. Rolled-back
successor changes must not be resurrected because an older log mentions them.

## Confirmed provider evidence before this batch

- Plex Collections: authorized Seerr Add, Remove and Add again with matching
  provider and Seerr membership readback. The test collection was retained for
  John's manual trial, not deleted. This was a bounded own-account verification.
- Plex Watchlist: the stale mismatch was reproduced; authorized removal of the
  reported series reduced membership by one and a fresh Plex reload confirmed
  absence. Adding it back restored membership and the Remove action. The item
  remains saved. This is live evidence, separate from mocks.
- Jellyfin/Emby native actions: mocked tests only; no live write pass claimed.
- Previous focused passes do not establish a full cumulative suite/build pass.
  Human visual acceptance and physical drag/touch review remain pending.

## Current bounded batch

Approved: improve portable instructions, regression checks and merge evidence;
repair only clear existing visual-rule violations in the Series/shared controls.
Not approved: broad backend/security repair, new design presets, NAS deployment,
GitHub push/PR or production-account tests as part of a visual audit.

The original public `dev`, `build`, validation and hook bindings remain intact.
Focused checks support iterative previews; finalization requires one complete
gate on the exact candidate. `pnpm build` runs validation then compilation, so
do not run another identical full validation immediately beforehand.

Known remaining visual debt: legacy Series/shared `@apply` and competing card
padding owners require a later bounded consumer audit. A long action-menu list
needs an approved bounded-viewport preset; do not invent dimensions here. This
batch does not establish that the page or application is Tailwind-free.

Current isolated focused batch: **117 tests passed**, zero failures, skips,
cancellations or todos. Suites: local-validation bindings/discovery/isolation,
buttonGeometry, iconOnlyButtons, requestLayout, Series style and saved-item
client. New negative fixtures reject competing clipping/surface/gap owners and
retired icon geometry; Watchlist Remove tests confirm explicit desired false
and fresh already-completed state. Two old icon assertions were superseded by
the documented shared-padding/native poster-role contract, not waived.

Isolation: separate candidate source, disposable `/tmp` config, Docker network
mode `none`, dependencies/store mounted read-only; no live config/DB mount.
Formatting and discovery plan passed. All 12 explicit files matched the mounted
source readback. Desktop/narrow menu inspection confirmed the shared black surface,
open content above its parent frame, keyboard access to the last option, and Escape
restoring normal clipping/layers/focus. Narrow tree headings still crowd; physical
drag/touch and final human visual acceptance remain pending.

The one full `pnpm build` attempt passed translations, current-batch and shared-
style validators, formatting, lint, server/client types and all 85 Vitest files
(395 tests). **Blocked:** during the native TypeScript lane, the network guard
failed after AvailabilitySync because of an unstubbed TMDB attempt. The related
test, implementation and guard match the pre-batch source. This is an unchanged
test-isolation failure, not proof of a production backend defect.

The isolated run was stopped after that required failure. Native TS is incomplete;
the cumulative native JS/tooling lanes and production compilation were not run.
No complete gate/build pass, exception or waived failure is claimed. No unrelated
backend/test repair was made in that attempt. Preserve the failed receipt
separately from focused passing evidence.

John subsequently authorized repairing that suite's test isolation with production
backend code untouched. The focused failure was reproduced with the guard enabled;
the test now mocks the actual retained TMDB client with typed season fixtures and
per-test restoration. Unexpected fixture IDs fail outside the production catch.
A new unavailable-enrichment case checks the exact lookup and preserved status.
All 18 focused tests pass, with no skips/cancellations/todos. This test-only repair
is not a production backend fix or a complete cumulative gate/build pass. The
final gate and human acceptance remain pending; unrelated failures still require
scoped direction before further repair.

The visual/client fixtures were also tightened: negative CSS/role fixtures must
fail with their intended diagnostics, wrong icon padding is checked without a
duplicate declaration, and Watchlist Remove rejects a valid response that still
reports saved membership. Recovery remains read-only. The six focused visual/
client/runner suites now pass **119 tests**, zero failures/skips/cancellations/
todos; the separate AvailabilitySync focused suite passes 18. Production backend,
network guard, package/hook bindings and lockfile remain unchanged. The complete
candidate is being verified separately; these focused receipts are not a waiver
or full-gate claim. Internal-only test hardening adds no user-facing feature.

## Subsequent isolated verification and input blockers

The repaired cumulative retry passed the preliminary validators, formatting,
lint, server/client types and all85 Vitest files/395 tests. AvailabilitySync
passed within the native TS lane. A different required after-hook then failed
following the Plex scanner suites: the guard caught an attempted request to a
fake Plex test host. That scanner source and guard are unchanged from the
preserved baseline. This is isolation evidence, not a production bug diagnosis.
The long run was stopped there; exit137 records the stop, separately from the
hook failure. Native TS remains partial; no production compilation was reached.
No scanner/guard repair or failure waiver was made.

The previously unrun native JavaScript lane was executed separately on the same
frozen candidate: all46 selected files ran,391 tests,357 passed,34 failed, zero
skips/todos/cancellations. This is a failing partial receipt, not a complete gate.
Failures include superseded source/utility assertions and unresolved contracts;
replace only clearly superseded assertions with equivalent role/behavior tests
and negative fixtures. Do not restore retired layouts or normalize uncertain
palette/ordering decisions merely to increase the pass count.

Full tooling inputs are also unavailable: the mounted app source contains only
the CI workflow, while tests read other chart/release/preview workflows and root
release fixtures. The bare Node/Alpine image lacks required native tools.
The earlier snapshot additionally omitted an existing Unraid template fixture;
that omission is corrected in future manifests, not inserted into the frozen
receipt. Establish complete authoritative pinned Git inputs and a suitable
disposable toolchain before another final run. Plan discovery is not proof of
fixture/tool availability. No borrowed fixtures, installed live tools or suite
exclusions convert these blockers into a pass.

## Bounded visual-contract follow-up

One established implementation violation was repaired: the single-option
Request icon's local16px utility is removed only after its real branch is
attached to the existing shared14px content-size owner. No new geometry or
palette was designed, and production backend code is unchanged.

Seven visual test files now follow the current Requests consumer, accepted
semantic table/gap owners and Series saved-order/controlled-disclosure behavior.
Superseded source/utility assertions were replaced with property/role/callback
coverage and diagnostic-specific negative fixtures. The affected nine-suite
execution (including shared button/icon checks) ran157 tests:153 passed, four
failed, no skips/todos/cancellations. Three failures were in the new icon checker:
it initially audited unrelated root palette aliases and mishandled PostCSS's
separate important flag. After correcting that checker, only its changed six
tests were rerun: all six pass. The other required Book ordering failure is
unchanged and unresolved; no full affected or cumulative pass is claimed.

Current-batch/shared-style validators and changed-component lint pass;
formatting passes. The actual PostCSS configuration compiles the shared CSS
with zero warnings. Palette/theme, Book-order and other unreconciled failures
remain recorded. The earlier frozen full/native-JS receipts are retained;
this follow-up has only focused evidence and still needs rendered/human review.
Repository/toolchain prerequisites and full gate/build remain blocked.

## Latest bounded preview checkpoint — October 2, 2026

This section supersedes earlier current-status descriptions above, not their
preserved diagnostic receipts. John limits further preview verification to the
Requests page, Series page, Discover's Recent Requests slider, and shared poster
styles across their consumers. A poster-role check does not authorize a whole-page
audit of each consumer. No broad backend repair or site-wide page sweep is approved.

The two inherited network-isolation failures also reproduce on untouched upstream
v3.44.1 and the subsequently tested main. They do not establish that the visual
changes introduced a production defect. Original tests and failed receipts are
backed up. John's exact-file/target temporary diagnostic deferrals are opt-in;
outbound requests remain blocked and strict default behavior remains intact.
Deferred required failures are not a passing release gate. Reconcile the original
tests and the maintainer's coverage before final contribution acceptance.

The retired CSS-representation assertions have been reconciled with the current
shared classes, variables and accepted semantic roles, retaining meaningful
behavioral safeguards and negative coverage. That source lane passed 410 tests
in 47 files, with no failures or skips. The previously completed component lane
passed 395 tests. These are separate receipts from an earlier exact source state,
not a complete cumulative pass for the final tree. The three broad native
receipt-recovery partitions were intentionally stopped when John narrowed scope;
their partial reports must not be counted as passing or restarted automatically.
Unrelated tooling findings remain documented rather than repaired or waived.

A subsequent narrow cleanup removes competing card-padding ownership: main media
cards retain the existing shared main-padding owner rather than also consuming
inset padding. The overwritten local padding utility and duplicate blur declarations
were removed. The shared poster layout retains positioning while the shell retains
only its independent stacking role. Current main/inset padding remains 8px;
browsing posters remain 169.2px wide with a 2:3 frame. No component, production
backend, dependency, live configuration or provider data changed in this cleanup.

Current focused receipts, executed once per final affected selection:

1. Seven card/poster owner and menu checks passed, including negative mutation
   checks (`mediaCardOwners.test.mjs` and the two selected menu contracts).
2. Thirteen native frontend poster badge/link and slider tests passed in three
   files: `TitleCard/statusBadges.test.ts`, `TitleCard/bookDetailQuery.test.ts`,
   and `utils/mediaSlider.test.ts`.
3. Nine native frontend Requests user-filter and Series availability-tone tests
   passed in `Requests/requestStatusQuery.test.ts` and
   `MediaDetails/AvailabilityValue.test.ts`.

Those 29 tests have zero failures, skips, cancellations or todos. Native runs used
isolated source/config, read-only dependencies, no network, strict network guards,
and no temporary network-deferral flag. Formatting passed. Published CSS/test
readback matched the tested files; the complete source comparison found no
unexpected component/backend changes or deletions.

Rendered review confirms Requests at 1440px and 390px, Series at the existing
desktop-sized viewport and 390px, and the request slider at 390px. Requests uses
36px/40px page-title typography above the breakpoint and 24px/28px below it;
cards retain 8px padding. Neither reviewed narrow page has page-wide horizontal
overflow. Poster positioning and frame dimensions remain intact. The desktop
collection-menu capture shows an opaque black surface extending beyond the main
card without clipping; Escape closes it. Request-slider Next moved the track by
one compact-card width, and Previous restored its disabled-at-start state.
The landscape request-summary cards are not portrait browsing posters.

Legacy compact request-card utilities and remaining shared `@apply` are explicitly
not a Tailwind-free claim. Loading/error/empty variants, every alternate theme,
physical drag/touch, and unaudited pages are not newly certified by these captures.
No live provider mutation was repeated during this visual cleanup. Detailed source
hashes, receipts, recovery files and screenshot locations are in the recovery
journal.

John explicitly accepted the visual test for this scoped cleanup on October 2,
2026, while on his phone, based on the previously proven CSS and absence of major
visual changes beyond utility/duplicate-owner cleanup. This is his approval of
the current bounded visual batch, not a claim that he newly inspected every
desktop/narrow screenshot or certified unreviewed themes, states or pages.
Earlier review gaps above remain recorded; this approval does not silently
certify physical drag/touch or other untested interactions.

The complete strict gate/build, GitHub checks and publication authorization
remain pending. Visual acceptance does not waive deferred required test failures
or authorize a PR. CI success must be matched to the actual shared-gate inventory,
not assumed to cover every local check.

## Finalization authority and latest accepted scope — October 3, 2026

John explicitly accepted the current preview and authorized final checks, a
contribution to `snapetech/seerrng`, monitoring relevant CI failures, deployment
of the tested preview build to his server, and bounded nightly cleanup. These
instructions supersede the earlier pending publication/deployment authority;
they do not waive a required failure or authorize unrelated backend repairs.

The accepted candidate now uses the newer upstream 3.46.1 main at
`e7305281797cd7527c3b1c0a83ff144218ad506a`. Later accepted work includes shared
blue pinnable catalog filters and titles, the yellow watchlist visibility action,
the reused Series request tree and adjacent Episode Queue, a single Series
request entry, six-role Overview disclosure/order, and native shared CSS cleanup
for active Series detail/request/browse controls. The latest focused receipts
are not the cumulative release gate. Remaining utility-dependent conditional
overlays, settings-specific controls, physical drag/touch, and unaudited pages
are not newly certified or claimed Tailwind-free.

Final independent review identified an API-contract mismatch: Overview expanded
the Series role set to six while the OpenAPI order schema still described five.
The schema must match the same six-role server owner before final validation,
including persisted user settings, request payloads and normalized responses.

Publication must also follow the current contribution guide's requirement that
John supplies his own-word PR description and accurate AI disclosure. Automated
code/testing evidence does not supply that human-authored publication input.
If that input is absent, preserve the contribution on a verified remote branch
and report publication as pending rather than misrepresent authorship.

## Required evidence at contributor finalization and maintainer integration

Fill these fields with observed facts; unknown means pending, never assumed.

1. Contributor remote/branch/commit; pinned maintainer target remote/branch/commit;
   actual common ancestor; integrated commit; exact tested commit/source digest.
   All commit IDs are pending until the actual authorized Git integration.
2. Pinned Node/pnpm identities, lockfile SHA-256, environment/platform, isolated
   source/config/dependency mounts and actual network boundary.
3. Three-way changed-file inventory and conflict ledger: owner, newer upstream
   behavior/security requirements, preserved interface rule, resolution and check.
   Do not wholesale restore an older backend, component or lockfile.
4. Discovery plan versus executed logs: test file inventory, test totals, failures,
   skips/todos, platform exclusions, lint/type/static/style results and build result.
   `pnpm test` is test partitions only; `test:ci` is Vitest-only. Browser/Cypress
   suites are separate. Linux is required for complete POSIX tooling coverage.
5. Desktop/narrow reference locations and human visual review evidence per
   page/state, including loading/error/empty, keyboard/focus/disabled, open menus and reorder.
   An automated screenshot or computed-style result is not human acceptance.
6. Live Plex evidence separately from mocked native coverage; safe prerequisites
   for unverified providers. Never copy credentials, runtime DBs or live config.
7. Explicit deferrals, unresolved failures and next gate. A failed required gate
   blocks finalization; report unrelated backend failures before expanding scope.
8. Recoverable refs/archive identity and checksums, final source readback, and
   applicable publication authority. Local preview publication is not PR approval.

The contributor and Keith's AI must use the same checked-in instructions and
gate, adapted to the newer target without discarding its valid security/backend
fixes. If the target advances, pin the new head and repeat invalidated checks.

## Expanded SeerrNG feature candidate — October 4, 2026

The current task supersedes the older bounded-scope publication status above
for this contribution: the user explicitly requested implementation of game
library and household play tracking, repair of the other existing dirty work,
the complete validation gate and build, commits, a push, and a release. The
older records remain historical evidence for their original source trees.

- Candidate: `/tmp/seerrng-reader-groupings`, branch
  `codex/reader-groupings-20261004`, initially based on
  `06fbbce72260a08f36139af5dcd94dcda0bd481f`. Final validation found that
  `origin/main` had advanced through the v3.51.0 release; the current candidate
  is now fast-forwarded through `f32232a58972e70e7d7862ef3199e3a33b662c50`.
  The candidate retains the Audiobookshelf/ChaptarrNG integration at
  `e9d2e50f2b446a70e01f5b16af8bc8265ed99b3e` in its ancestry.
- Recovery: source snapshot `/tmp/seerrng-pre-game-20261004`; original recovery
  stash `3b4e8dfbf9dbc20b1fc444650c3243f9b37a4d5f`; integration checkpoints
  `527b16ec5367eeaf122705bc61d086bfdd9016ad` and
  `d3344bed33786af95d5b4b4a3003e604aea8265c` remain available. No stash or
  recovery ref has been dropped.
- Current work includes private per-user game libraries, Steam account linking
  and import, progress and opt-in household sharing, the Play Together overlap
  view, and software-request links; Grimmory/BookOrbit delivery and managed
  reader shelves; per-user external request lists; software catalog fallback;
  and the request-count refresh repair. Earlier Request Status, shared heading,
  layout, poster, and control work in the integrated tree is retained.
- Reader shelf settings now use the shared `SettingsField` checkbox adapter;
  reader service settings, managed shelf API paths and response shapes are
  documented in `seerr-api.yml`. Mock-backed client/route coverage and migration
  coverage are included. No provider was contacted live.
- Latest completed UI batch evidence: current-batch contract 567 files passed;
  shared stylesheet audit inspected 395/395 components; button geometry 68/68
  passed. A focused reader provider/route run passed 17/17 before adding the
  remote-shelf recovery regression; that updated selection still needs to run.
  Server and client type checks passed before the latest checkbox-adapter edit;
  rerun on the final source.
- Before the current-main forward integration, the final-gate plan selected 97
  Vitest files, 384 native TypeScript files, 56 native JavaScript files and 32
  tooling files (569 total, zero declared platform exclusions). That inventory
  is historical; the integrated tree has a fresh plan below.
- Prerequisites were checked against the complete non-shallow Git checkout:
  Node.js 24.15.0, pnpm 10.24.0, Git 2.55.0, Python 3.14.7, SQLite 3.53.4,
  PostgreSQL client 18.6, installed dependencies, all 29 GitHub workflow files,
  and the selected deployment test fixtures. The frozen lockfile install already
  completed successfully in this isolated candidate.
- The exact final `pnpm validate:development` run, one production build, browser
  run, screenshots, release-note preview, commits and remote push are pending.
  human visual review of the new game and reader surfaces remains a release
  gate; previous visual acceptance applies only to its recorded older scope.
  A screenshot or passing build does not fulfill that human review.
- No task commit, push, tag, draft/published release, merge, or deployment has
  occurred. The user authorized pushing this work and cutting a release after
  its required verification/review gates.

## Complete dirty-worktree inclusion — October 4, 2026

The user reaffirmed that every distinct dirty and unrelated change must be
included. The candidate inventory covered all registered repository
worktrees, all dirty and staged paths, and saved worktree stashes. It now
contains the reader shelves, Grimmory/BookOrbit delivery, household game
library, external request lists, software catalog fallback, request-count
repair, donation-link update, Audiobookshelf scan hardening, request-edit
identity repair, and the discover OpenAPI regression test. Each feature remains
separately attributable in its release fragment and integration record.

The Audiobookshelf scan hardening was recovered from preserved stash
`d377f690ddda68b0d15bf4bb8ef9a246e51b31bc`. A complete candidate snapshot
before that consolidation remains as stash
`057219485a063805eea0aabf4f1a0ef652842e6c`; no source worktree or stash was
dropped. The original Cypress-prep, magazine, failed-download, Questarr-help,
and request-count changes had already reached the candidate, so their duplicate
dirty snapshots were not copied twice.

The unique added focused checks pass: Audiobookshelf scan helper/scanner/API
and discover contract **12/12 Node tests**; RequestBlock edit identity
**2/2 Vitest tests**; server/client TypeScript, focused ESLint, i18n and
formatting also pass. Full cumulative validation and a production build remain
pending on this expanded candidate. Rendered desktop/narrow review and John's
visual acceptance remain release gates.

## Current main integration and gate follow-up — October 4, 2026

The candidate initially started at `06fbbce72260a08f36139af5dcd94dcda0bd481f`
while `origin/main` had advanced to `f32232a58972e70e7d7862ef3199e3a33b662c50`
through the v3.51.0 release. The first complete validation run correctly failed
`scripts/check-changelog-tags.mjs` because the stale source lacked the v3.51.0
changelog section. It was not a candidate feature defect. Before integration,
the entire dirty and untracked candidate was saved in recovery stash
`55bb13aa1a5f5a988457919ed8a5433fab5519bf`; no recovery stash was dropped.

The branch fast-forwarded to current `origin/main`, then the saved changes were
restored with `git stash apply --index`. Two overlaps were resolved by retaining
both sides: `src/components/SoftwareCatalog/index.tsx` keeps upstream QuestarrNG
ownership and play-time estimates alongside the private My Games actions, and
`src/i18n/locale/en.json` keeps both upstream and game-library messages. The
release-tag check now covers all 141 SeerrNG tags. The fresh development plan
selects 99 Vitest files, 385 native TypeScript files, 56 native JavaScript files
and 32 tooling files (572 total), with zero declared platform exclusions.

The prior stale-source cumulative run completed all selected lanes but failed
one tooling test: `scripts/release-notes.test.mjs` could not find the 3.51.0
changelog section. This receipt is invalidated by the forward integration; the
complete gate must be rerun against this exact merged tree. The production build
has not run. The in-app browser control and isolated workspace controls are not
available in this session; rendered review is pending on an available local
browser path. Human visual review of the new game and reader surfaces
remains pending and is still required before release.

## UI correction and verification record — October 5, 2026

The first production screenshot review found that GameLibrary rendered a second
`main.page-layout` inside the shared application page shell. Removed the nested
shell so the page uses the shared content width and applies the fixed-search-bar
offset once. No global styles or unrelated page owners changed. The Cypress
flow now checks horizontal bounds at 1280px desktop and 390px mobile, with
element diagnostics on failure.

- The complete v3.51 integrated-tree gate passed before the page-shell and
  Cypress diagnostic correction: 99 Vitest files/452 tests; 385 Node TypeScript
  files/2,912 discovered (2,908 active); 56 Node JavaScript files/485 tests;
  and 32 tooling files/238 tests. Four PostgreSQL-only migration cases were
  skipped because PostgreSQL was not configured. The prior log is
  `/tmp/seerrng-game-library-validation-v351-integrated-20261004.log`; its pass
  is historical, not final-candidate evidence.
- Production builds passed both before and after the page-shell correction;
  the post-correction build log is
  `/tmp/seerrng-game-library-build-post-layout-fix-20261004.log`.
- Against the built candidate and disposable SQLite configuration, the game
  library Cypress flow passed 1/1 in Chromium at 1280px desktop and 390px
  mobile. The reader settings flow passed 1/1 in Chromium after it was rerun
  alone with the server lifecycle tied to its test command. These were mocked
  local-provider checks; no external provider was contacted.
- A combined multi-spec Cypress invocation passed the game flow but navigated
  the reader spec to the cached `/offline.html` fallback while the disposable
  server remained healthy. Both specs passed in separate fresh Chromium
  processes against the same build and database. This cross-spec service-worker
  behavior is recorded separately from product-provider integration.
- Final screenshot inspection found the new ownership/sharing captions were
  using browser-default black text. Added the scoped
  `.game-library-sharing-label` role in `src/styles/globals.css`, applied it in
  GameLibrary, and added a computed-color browser assertion. The first
  incremental build artifact did not include the new rule. A clean build from
  the exact source emitted it, and the browser assertion now verifies the
  rendered caption color.
- The rebuilt reader settings screenshot exposed cramped side-by-side service
  cards and narrow generated-address controls. Reader service and shelf cards
  now use one column; each generated address fills its row, with its copy action
  below it. The Cypress flow checks card order, address width, and action bounds
  at desktop and mobile sizes.
- A clean production build passed with the tracked source changes applied to a
  detached build worktree. It generated `/games`, `/settings/services`, and
  `/qa-request-edit`; CSS includes the game caption and reader layout roles.
  Log: `/tmp/seerrng-reader-settings-layout-build-20261005.log`.
- The Game Library browser flow passed **1/1** in Chromium 153 against that
  build at 1280×900 and 390×844 CSS viewports. It covers manual ownership,
  household sharing, Play Together, and horizontal bounds. The reader settings
  flow passed **1/1** at the same viewports, covering saved URLs, preference,
  generated links, service-card width, and non-overlapping copy actions. Logs:
  `/tmp/seerrng-final-ui-game-cypress-20261005.log` and
  `/tmp/seerrng-final-ui-reader-cypress-20261005.log`.
- Desktop and mobile review captures are at
  `/tmp/seerrng-game-library-final-review-20261005/` and
  `/tmp/seerrng-reader-settings-final-review-20261005/`. These are iteration
  captures, not a substitute for human review. The first exact-tree gate attempt
  stopped during formatting before any test lane, reporting ENOENT for
  temporary locale `.bak` paths. A subsequent isolated sequential
  `pnpm i18n:check` and `pnpm format:check` passed. The first output is preserved
  at `/tmp/seerrng-game-library-validation-format-failure-20261005.log`. The
  complete exact-tree `pnpm validate:development` run follows this ledger
  update before the UI-fix commit; its receipt is
  `/tmp/seerrng-game-library-validation-final-candidate-20261005.log`.
- Tests used a fresh disposable SQLite configuration and local providers only.
  No live Grimmory, BookOrbit, Steam, QuestarrNG, or ROMarrNG provider was
  contacted. Human visual review remains a release gate.

## Rebuilt candidate and rendered review — October 4, 2026 (Regina local)

The follow-up screenshot review found `GameLibrary` rendering a second
`main.page-layout` inside the shared application page shell. The page now uses
the shared shell once, preserving the fixed search-header offset without a
second page-width wrapper. The change stays within the GameLibrary consumer;
no shared CSS or unrelated page owners changed. The built server and app were
rebuilt after this correction.

- `pnpm build` passed on the corrected application source and generated the
  `/games`, `/settings/services`, and `/qa-request-edit` routes. Log:
  `/tmp/seerrng-production-build-final-20261005.log`.
- Game-library Cypress flow passed **1/1** after the rebuild at 1280×900 and
  390×844 CSS viewports. It exercises manual ownership, sharing and the
  household overlap view; visible bounds and document/body widths are checked.
- Reader settings Cypress flow passed **1/1** after the rebuild at 1280×900 and
  390×844 CSS viewports. It saves Grimmory and BookOrbit addresses, saves the
  preferred reader, verifies generated OPDS/Komga links, reloads to verify
  persistence, and checks page width.
- Cypress screenshot files are captured at 1280×720 desktop and 390×720 narrow
  in the available headless Electron runner despite the larger verified CSS
  viewport heights. The images were inspected at
  `/tmp/seerrng-rendered-review-20261005/`; they remain iteration evidence.
- Tests used the freshly seeded disposable SQLite database at
  `/tmp/seerrng-cypress-reader-groupings.vlwN0R`, with reader/provider calls
  limited to local app settings and media-service addresses constrained to
  loopback. No live Grimmory, BookOrbit, Steam, QuestarrNG, or ROMarrNG provider
  was contacted.
- The complete development gate passed after the application and Cypress
  corrections: current-batch contract 569 files; shared-style audit 397/397;
  formatting, lint and both TypeScript checks; Vitest 99 files/452 tests;
  Node TypeScript 385 files/2,912 tests (2,908 passed, four PostgreSQL-only
  skips); native JavaScript 56 files/485 tests; tooling 32 files/238 tests.
  Totals: 4,083 passed, zero failed, four skipped, and zero platform exclusions.
  Log: `/tmp/seerrng-validate-development-final-20261005.log`.
- The Chromium exploratory Cypress attempt timed out waiting for a page load and
  is not counted. The final built-app workflows passed separately under the
  repository's Cypress Electron runner. Human visual review remains a
  release gate.
- Release-note preview, commits, push, and release remain pending. Live Grimmory,
  BookOrbit, Steam, QuestarrNG, and ROMarrNG round trips remain unverified.

## All-dirty commits and forward rebase — October 4, 2026

Every inventoried dirty feature and unrelated change is represented in these
separate commits, retaining the existing recovery stashes:

- `f1b69beda9ac8400dae12183c32c547fc3191e40` reader delivery and managed shelves.
- `4d2e6572a232ddb41adc3b8fbdaca6442df240b6` private games, Steam, and catalog fallback.
- `88eefe3deace753d569284f102f7f00c7daa45b3` per-user external request lists.
- `884259ab5612fff76339d4fafe7e265a7b9bd141` Audiobookshelf scan hardening.
- `ecf3019630e9fe3fc9f3e9ffd6002226b4f3e6ad` request-edit identity repair.
- `14b3c6775dfa45df34ee6e607ebbaba1fb7b17b1` Ko-fi support link update.

All source commits passed the repository attribution and staged Prettier/ESLint
hooks. The first game commit attempt was stopped by ESLint; its seven findings
were fixed at source and the required hook then passed. No hook was bypassed.
The generated OpenAPI file and all integration records are included in the
documentation/API commit.

A fresh fetch advanced `origin/main` from
`f32232a58972e70e7d7862ef3199e3a33b662c50` to
`4665245f97a90d546a94eb25fdcd4c91104bfd7b`. Its sole change relative to the
candidate base is the YunoHost manifest update. The seven candidate commits
were rebased onto that target without conflicts; recovery ref
`recovery/all-dirty-before-main-4665245` preserves the original candidate tip.
The source commits after rebase are:

- `23e84d7aa462d6da6c5293fa8d84b2adfe11e282` reader delivery and shelves.
- `a393ab927550b5069078e24b67db2ca66c44e0cc` game library and catalog fallback.
- `b7b01cf89f8fb832fa8744a4ea63562775e65702` per-user request lists.
- `7cfac9071bbd30ce3ac2c947309649148117c769` Audiobookshelf scan hardening.
- `9e46eca5d3713ad5c40334da1e67c25f25a0c07a` request-edit identity repair.
- `b4bb494bada4f01a9334c7e8aa303c2fab28c521` Ko-fi support link update.

`pnpm validate:development --plan` on the rebased tree selected 99 Vitest
files, 385 native TypeScript files, 56 native JavaScript files, and 32 tooling
files, with zero declared platform exclusions. The prior full gate predates
the game source-level lint fixes and new main target; it is historical only.
The final integrated gate, production build, and rebuilt disposable browser
flows remain pending. No branch push, tag, or release has occurred. Live
Grimmory, BookOrbit, Steam, QuestarrNG, and ROMarrNG round trips remain
unverified; human visual review remains a release gate.

## Reader settings readability follow-up — October 5, 2026

After the integrated gate and production build, the reader settings browser
review identified cramped service cards and generated-address controls. The
follow-up is committed on top of `origin/main`
`4665245f97a90d546a94eb25fdcd4c91104bfd7b`. It gives each reader
service and shelf card a full-width row, places address copy actions below the
generated value, and adds desktop and mobile layout assertions to the reader
Cypress flow. The structured note is
`release-notes/2026-10-04-reader-settings-readability.md`.

A separate candidate's first validation attempt stopped at formatting before
any test lane because parallel locale checks removed temporary `.bak` files;
it is retained at
`/tmp/seerrng-game-library-validation-format-failure-20261005.log` and is not
counted. Its isolated sequential i18n and format checks passed, but they do not
replace the complete gate. The refreshed plan for this candidate selects 99
Vitest, 385 native TypeScript, 56 native JavaScript, and 32 tooling files, with
zero declared platform exclusions. The final gate, clean production build,
and rebuilt desktop/narrow browser flows remain pending on this follow-up.
Earlier build and screenshot evidence predates the reader layout change.
Provider round trips remain unverified, and human visual review is
still required before release.

## Final verification receipt — October 5, 2026

The full gate on the committed reader-layout source passed. Its inventory was
99 Vitest files/452 tests, 385 native TypeScript files/2,912 tests (2,908
passed and four PostgreSQL-only skips), 56 native JavaScript files/485 tests,
and 32 tooling files/238 tests. Totals: 4,083 passed, zero failed, four
skipped, and zero platform exclusions. The 569-file current-batch check and
397/397 shared-style inspection passed. Log:
`/tmp/seerrng-game-library-validation-final-candidate-20261005.log`.

The production build and separate Chromium 153 Cypress runs used the disposable
worktree `/tmp/seerrng-reader-settings-layout-build`, based at
`bace25a5e2146782a57a4268f0c60f6bcae461c3` with only the reader-layout source
changes unstaged. `cmp` verified that the three changed source/test files in
that worktree are byte-for-byte identical to commit
`752e6b651dc30cf57b7e00b5c6d3ae5a0ec1211a`; the remaining commit differences
are the release fragment and evidence documentation. The build generated
`/games`, `/settings/services`, and `/qa-request-edit`. Logs:
`/tmp/seerrng-reader-settings-layout-build-20261005.log`,
`/tmp/seerrng-final-ui-game-cypress-20261005.log`, and
`/tmp/seerrng-final-ui-reader-cypress-20261005.log`.

The game and reader workflows each passed **1/1** in their separate Chromium
153 headless runs, checking desktop and narrow layouts. Captures are in
`/tmp/seerrng-game-library-final-review-20261005/` and
`/tmp/seerrng-reader-settings-final-review-20261005/`; their rendered content
was inspected. The screenshots are iteration evidence, not a substitute for human review. Tests used disposable SQLite and local app endpoints only; no live
Grimmory, BookOrbit, Steam, QuestarrNG, or ROMarrNG provider was contacted.
Release-note preview and branch push remained pending at that checkpoint.
Human visual review status was pending; these entries are superseded by the
v3.52.1 publication below.

## v3.52.0 publication and CI repair — October 5, 2026

This entry supersedes the earlier pending-release status above. The integrated
feature candidate was released as `v3.52.0` from
`fb50d1f70fdbe44579d89386d70bc50e9f181063`; the GitHub release is published and
the release workflow's Discord announcement job succeeded. The release-note
preview and changelog-tag check passed. The complete development gate on that
integrated source passed 4,083 tests with four PostgreSQL-only skips and zero
platform exclusions. Its production build also passed. Existing desktop/narrow
game and reader browser flows passed 1/1 each; their rendered captures were
inspected earlier in this work. No live Grimmory, BookOrbit, Steam, QuestarrNG
or ROMarrNG provider round trip was performed. Visual review status was
pending in this historical record.

Post-publication GitHub checks exposed three separate results:

1. SeerrNG CI run `37258284100` failed the bundle budget at
   `.next/static/chunks/pages/_app-98ffa76db6165a35.js` (1027.1 KB against
   1024.0 KB). Its unit, i18n, security, and deployment jobs succeeded. A
   separate isolated candidate removes the eager English catalog from the
   shared app entry and has passed its complete `pnpm validate:development`
   gate on the `fb50d1f` base (receipt:
   `/tmp/seerrng-bundle-budget-validation-final3.log`). That candidate has not
   yet been integrated here; its production build and `pnpm bundle:check` are
   still pending.
2. Cypress run `37258284096` failed two settings assertions. The Lidarr help
   copy was present in the rendered modal, but its Cypress query was not scoped
   to that dialog and could select the background service form. The Prowlarr
   responsive spec returned an array for the new reader-settings API route,
   although the rendered settings component requires the object response shape.
   The specs now scope field-copy checks to the open dialog and return the
   reader-settings object plus an empty grouping list from the Prowlarr fixture.
   On the exact `v3.52.0` production build with a disposable seeded config, the
   affected run passed 27/27 discovery tests and 1/1 Prowlarr test, with no
   final failures, skips, or pending cases. The reader settings flow also
   passed 1/1. One discovery test needed a retry before passing; it remains
   recorded in `/tmp/seerrng-v352-cypress-repaired-focused.log`.
3. Chocolatey publish run `37263774763` built the package but received HTTP 403
   from `push.chocolatey.org`. The repository cannot establish package-owner
   authorization through a source change. This channel is not verified as
   published.

The Cypress repairs are test-harness changes only; the visible settings UI did
not change. They are recorded in
`cypress/e2e/library-discover-parity.cy.ts` and
`cypress/e2e/settings/prowlarr-responsive.cy.ts`. The follow-up Cypress checks
used `/tmp/seerrng-v352-prowlarr-isolated`, a disposable seeded test config.
The production server ran from the isolated build worktree
`/home/keith/.cache/seerrng-v352-cypress-repro` at the release commit; no live
service credentials or databases were used.

After publication, `origin/main` advanced to
`6d54a07bce12e222096a9ba5a34add8709bd39e8` for an internal YunoHost manifest
alignment. The Cypress repair is not yet integrated on that new main tip. Before
finalizing a follow-up candidate, preserve its source checkpoint, forward
integrate the latest main and any completed bundle repair, then rerun the exact
full development gate, production build, and affected browser flows. The
Chocolatey 403 and human visual review remain explicit release limitations.

## Post-release CI repairs — October 5, 2026

The repair candidate is now based on the current `origin/main` tip,
`6d54a07bce12e222096a9ba5a34add8709bd39e8`. It combines the English startup
bundle reduction from the separately validated candidate with both Cypress
harness fixes described above. The candidate bundle patch is present in
`src/pages/_app.tsx`, its focused regression is in
`src/components/ManageSlideOver/manageActions.test.mjs`, and the user-facing
performance note is `release-notes/initial-load-performance.md`. The Cypress
fixes are in `cypress/e2e/library-discover-parity.cy.ts` and
`cypress/e2e/settings/prowlarr-responsive.cy.ts`.

The bundle candidate's full development gate passed on its pre-integration
`fb50d1f` base (4,083 passed, four PostgreSQL-only skips, zero failures and
platform exclusions). The Cypress repair passed the 28 affected assertions and
the reader-delivery settings flow on the published `v3.52.0` build, with a
disposable seeded config. These are component evidence only; they do not replace
verification on this combined exact source tree. A preserved source bundle is
`/tmp/seerrng-reader-groupings-before-v352-forward-integration.bundle`; the
integrated candidate's final validation, build, bundle budget and complete
Cypress results will be appended here when available.

The Chocolatey publish 403 and human visual review remain
outstanding. No provider round trips against live services were attempted.

## Project-owner release authorization and v3.52.1 verification — October 5, 2026

The project owner directed removal of the individual-specific visual acceptance
gate. Human review remains required under CONTRIBUTING.md, but acceptance is not
assigned to any named reviewer. The project owner authorized the release
without a named person’s separate visual sign-off. This supersedes the earlier
pending release-gate statuses above.

SeerrNG v3.52.1 was published from tag `v3.52.1` at commit
`76632411a3f73d0ad4ea31cb10405496d7db474f`. Release workflow run
`37281708508` succeeded, including `Publish release` and `Announce release to
Discord`. The published release contains 23 assets and the curated English
startup-performance note.

The separate Chocolatey publish run `37291082662` failed. Chocolatey
publication is not verified; the other release publication and announcement
jobs succeeded.

The published release has no live Grimmory, BookOrbit, Steam, QuestarrNG, or
ROMarrNG round-trip claim. The broader Cypress run remains incomplete and is
not recorded as a pass; the prior run entered an unstubbed provider test and
made outbound requests. No further provider tests were run.
## Issue #159/#160 and Edit Request forward integration — October 5, 2026

This entry supersedes the earlier branch inventory and pending-gate statements
for the current task. The user requested fixes for issues #159 and #160, the
Edit Request control shown in the supplied screenshot, reproduction evidence,
integration and security review of all project-owned branches, and eventual
commit, push, release and issue closure. The user directed that all application
test and build work run on `kspls0`; none of this task's tests or builds ran on
`kspld0`.

The current fetched target is `origin/main`
`6d54a07bce12e222096a9ba5a34add8709bd39e8` (v3.52.0 YunoHost alignment).
Forward integration starts from validation snapshot
`1370d3bf2b359969fb46535650580f9bc07667c`, tree
`02339ebac6e8440c987622f2c7414706fa6bab34`, whose parents are the earlier
main merge `9e9a816c25c4a0045554e626a645e59d01e54b1e` and feature commit
`bace25a5e2146782a57a4268f0c60f6bcae461c3`. The final merge worktree is
`/tmp/seerrng-release-integration-159-160-forward-20261005`.

The ref audit found that `origin/codex/reader-groupings-20261004` tip
`fb50d1f70fdbe44579d89386d70bc50e9f181063` is already an ancestor of current
`origin/main`. The tips of `origin/codex/romarrng-integration-20261004`
(`48000359b75b2e4f4342ee669de8afb2e67fe429`),
`origin/feat/cross-platform-setup-assistance`
(`335abc75b9417dfa063f533df95a099ed1d5935a`),
`origin/fix/issues-159-160` (`ead182d582df7efa235c0139ca4492b912657f06`),
`origin/fix/request-count-badge-refresh`
(`5c2bdd3dd34c3b93225ae6295edd95f4c5b0ac25`), and `gitlab/main`
(`91724297ae9f65ef78047e59636363eef967ec29`) are ancestors of the r4 snapshot.
The two local pre-rebase refs remain recovery points. The 96 `pr-author/*` and
`upstream/*` refs are external contributor/upstream histories, not project
branches to merge into this fork.

Since the r4 snapshot, current main adds the reader-settings readability
follow-up and its Cypress assertions, reader visual-verification record, the
v3.52.0 release metadata, and the YunoHost version update (commits
`752e6b651dc30cf57b7e00b5c6d3ae5a0ec1211a`,
`532700b11958e5bd3a25a5a7dbd0810f1e3317f0`,
`fb50d1f70fdbe44579d89386d70bc50e9f181063`, and
`6d54a07bce12e222096a9ba5a34add8709bd39e8`). The three-way merge has applied
the source and release changes; its only content conflict was this checkpoint.
Resolution retains the newer main-side reader visual evidence and this task's
issue/branch evidence. The final merged source still needs its own full gate.

Headless Playwright ran on `kspls0` with `/api/v1` responses mocked and
non-local origins blocked. The original Edit Request setup had no
`request.media` relationship: its pencil click left only the management panel
open. The corrected `RequestBlock` receives typed provider identity from its
parent and mounts the editor from `showEditModal`; the same click opens the
“Pending Movie Request” dialog. Baseline/fixed desktop captures are
`/tmp/seerrng-edit-request-baseline-admin-20261004.png` and
`/tmp/seerrng-edit-request-fixed-admin-20261004.png`.

For #159, baseline profile settings had no external-list controls. The candidate
accepts and displays an IMDb watchlist and returns the mocked sync summary
“1 requested, 0 already requested, 0 not found, 0 failed.” For #160, a mocked
502 on the paged Prison Architect search produced the original catalog error;
the candidate falls back to the successful unpaged result. A separate route
regression confirms unrelated transport errors remain visible. Desktop and
390px captures are recorded as
`/tmp/seerrng-issue159-baseline-20261004.png`,
`/tmp/seerrng-issue159-fixed-20261004.png`,
`/tmp/seerrng-issue160-baseline-20261004.png`, and
`/tmp/seerrng-issue160-fixed-20261004.png`; corresponding narrow captures are
also retained. These are mock-backed UI reproductions, not provider round trips.

The issue-source security review retains HTTPS-only IMDb/Goodreads list URLs,
bounded list/body/timeout and scheduled batches, and the normal request
permission/approval flow for imported items. Related merged changes retain the
20,000-entry household-game cap and ownership checks, Steam-secret redaction,
admin-only reader settings, and software-search fallback only for the eligible
paged-search failure case. No live provider or user database was contacted.

The complete `pnpm validate:development` gate previously passed on kspls0 at r4
tree `02339ebac6e8440c987622f2c7414706fa6bab34`, after an earlier environment
attempt stopped because Helm was absent. Helm `v3.22.0+g144ca65` was installed
under `/tmp` on kspls0; its archive digest matched the official release digest
(`1e4ab49e429626cf6c6958d914248b78c9730803c2751b87627e171dc800e7bb`), and its
seven focused security checks passed. The successful full-gate log is
`/tmp/seerrng-validation-final-merged-20261004-gate-r4-helm-final.log` on
kspls0. Plan: 579 selected files, zero platform exclusions. Results: Vitest
461/461; native TypeScript 2,929 passed and four PostgreSQL-only skips; native
JavaScript 493/493; tooling 254/254; zero failures. This r4 receipt does not
validate the forward-merged tree.

The r6 plan was generated on kspls0 at
`/tmp/seerrng-validation-r6-plan-clean.json` (file SHA-256
`df38be86da22e489c835eaad8f38032f10bab74e1c0737b0bcad3bacc2ff0834`, structured
plan SHA-256 `7542d84891c54e9acec6a67f9eba66129f3e1efffc7fecac260c928070ffcaa8`,
inventory SHA-256
`a648afb986b24e5481f2e6e682c9cfe31422b70217e42dba696ee06be328d6d6`). It
selects 579 files across 12 steps with zero exclusions: 101 Vitest, 387 native
TypeScript, 58 native JavaScript, and 33 tooling-owned files. The `v3.52.0`
release-note preview succeeded at r6. Its initial attempt caught an edit to the
shipped game-library fragment; the published wording has been restored and the
later re-import behavior is documented separately.

GitHub published v3.52.0 at `2026-10-05T04:29:44Z`. The release body confirms
that its existing notes and source include per-user IMDb/Goodreads importing
(issue #159) and the QuestarrNG unpaged search fallback (issue #160). Both issue
records are still open. R6 also changes scheduled list synchronization to
process bounded 100-list batches; that post-tag operational change now has its
own fragment, `2026-10-05-bounded-request-list-sync.md`. R6’s successful preview
predates that addition and must be repeated for the final source.

After this checkpoint and fragment update, regenerate the plan and release-note
preview, run the full `pnpm validate:development` gate on that exact tree on
kspls0, and then run its guarded production build. Issue comments, issue closure,
push and a new release remain pending. Human visual review of desktop and narrow layouts
remains a release gate; automated screenshots do not supply it. No live provider
round-trip is claimed.

The corrected r7 plan and release-note preview both succeeded on kspls0 before
this documentation-only update. Plan output was
`/tmp/seerrng-validation-r7-plan.json` (raw SHA-256
`815ca5deddcc7ba30c4a3e0fefa425a6427b7283db733150a094b441a5577977`, structured
plan SHA-256 `7542d84891c54e9acec6a67f9eba66129f3e1efffc7fecac260c928070ffcaa8`,
inventory SHA-256
`a648afb986b24e5481f2e6e682c9cfe31422b70217e42dba696ee06be328d6d6`). It
selected 579/579 test files in 12 steps, with zero platform exclusions. The
release preview (`/tmp/seerrng-validation-r7-release-preview.log`, SHA-256
`4243a0645fb6e766bcfabfedd6de43587e169f380146857fc30261861a5fa25c`) included
Setup Assistance, ROMarrNG DAT selection, bounded request-list synchronization,
one-time theme adoption, Edit Request from detail panels, and preservation of
game progress/privacy on re-import. This source-tree update requires a fresh
plan and preview for its new exact tree before the full gate.

## Forward-merge verification update — October 5, 2026

The r8 exact snapshot passed the fresh validation plan, release-note preview,
and complete `pnpm validate:development` gate on kspls0 before the supplementary
Cypress run. Its commit was `916361e70d392e6c1687a633063c10db2ad6e83d`, tree
`3667a7e38f48aee8eeb09b54903835b694de2120`, with zero platform exclusions.
The gate passed 461 Vitest tests, 2,929 active native TypeScript tests (four
PostgreSQL-only tests skipped), 493 native JavaScript tests, and 254 tooling
tests. Log: `/tmp/seerrng-validation-r8-full-gate.log` on kspls0. The same
snapshot's production build completed successfully under Node 24.21.0 and
pnpm 10.24.0; log: `/tmp/seerrng-validation-r8-build.log`.

Supplementary headless Cypress ran on kspls0 against that build, using a fresh
temporary SQLite directory and port 55155. The reader-delivery, ROMarrNG,
movie-details, and requests specs passed (13 tests). The game-library spec
failed because its page-global button selector matched both the intentional
per-game sharing control and the manual-add dialog control, which share the
same accessible label. The browser error was selector ambiguity, not a failed
game-library behavior assertion. The Cypress helper now scopes the ownership,
sharing, and save controls to the active dialog. This test correction changes
the validation candidate, so a fresh plan, release-note preview, complete
development gate, production build, and affected Cypress run are still
required on the exact updated tree on kspls0.

Baseline/fixed Playwright issue reproductions remain mock-backed evidence; the
captured r8 merge preserves their tested issue-source files. The new candidate
still needs human visual review of desktop and narrow layouts. Push, new release,
issue comments, and issue closure remain pending those release gates.

## Latest-main forward integration — October 5, 2026

While the r8 candidate was being verified, `origin/main` advanced from
`6d54a07bce12e222096a9ba5a34add8709bd39e8` to
`76632411a3f73d0ad4ea31cb10405496d7db474f` (`v3.52.1` release preparation).
That tip includes `1ab58bd863cf1927b4f15851b121f8471d173c64`, which removes the
large English catalog import from the shared app entry, retains message
fallbacks through `defineMessages`, and adds a focused regression check. Its
release fragment is `release-notes/initial-load-performance.md`. It also scopes
existing Cypress settings assertions to the active dialog and fixes the reader
settings fixture response in the Prowlarr responsive spec. Review found no
permission, identity, provider, or database changes in this upstream delta.
The changed Cypress helper preserves each prior field-and-description assertion;
it only makes the active dialog the query owner.

The new integration worktree is based on the fetched `origin/main` tip and
merges the r4 feature snapshot. Source changes auto-merged; the checkpoint was
the sole content conflict. Resolution preserves the complete current-main
release and CI history above plus this task's branch, security, and reproduction
evidence. The v3.52.1 Git tag points at the new main tip, but GitHub currently
lists that release as a draft; only v3.52.0 is published. No release status is
inferred from the existence of the tag.

The r9 validation correction scopes the game-library test controls and save
button to the active dialog after an isolated Cypress run exposed a global
selector matching both the per-game control and the manual-add control. The
first r10 release-note preview also caught the forward merge restoring post-tag
copy inside the published game-library fragment and dropping the two separate
follow-up fragments. The published fragment has been restored byte-for-byte
(SHA-256 `a28c52399baaab6df5c105535840c4f311153290705950a70fc1d5749777d010`),
and the later game-progress and bounded-sync behavior remains in its separate
append-only fragments. The corrected preview must be rerun against the exact
candidate. It must also receive a fresh validation plan, the complete
development gate, a guarded production build, bundle-budget check, and affected
disposable Cypress runs on `kspls0`. No production source was changed by these
test and note corrections. The final candidate must also be reviewed against
the documented product-owner release authorization; no separate John acceptance
is asserted here.

## Forward integration of preview PR #162 — October 5, 2026

PR #162 (`integration/preview-v3483-20261004`, head `8e7d81c6429830ce2143bd243977c3c8e220da81`) carries the previously accepted shared-interface work and one-time theme migration. Those application changes are already present in this broader candidate. Its distinct addition is validation-engine v1.1.0: worker capacity is based on effective logical CPU limits, with the documented operator policy and bounded explicit override. The engine uses fixed-argument Git reads and reads cgroup limits; no application authorization, provider, or database behavior changes in this addition.

The PR's latest GitHub CodeQL, Cypress, unit-test, build, documentation, and release-note checks passed. The forward merge retains the broader candidate's scoped dialog assertions and game/reader shared roles rather than replacing them with stale assertions from the older PR base. Conflicts in this checkpoint, the engine README, and inventory were resolved by preserving this task's newer source/evidence ledger and carrying forward the v1.1.0 archive metadata. The prior `validation-engine-20261004.tar.gz` archive remains as historical evidence; v1.1.0 is the current engine copy.

The current task explicitly authorizes merging the reviewed project-owned branches, pushing the integrated source, and cutting a release after the required gates. This supersedes older checkpoint statements that withheld merge or release authority. The documented release authorization applies; no deployment or new whole-site human visual acceptance is claimed.

The repository-owned branch inventory was checked against the fetched remote heads: `codex/reader-groupings-20261004` (`72ea49383c45`), `codex/romarrng-integration-20261004` (`48000359b75b`), `feat/cross-platform-setup-assistance` (`335abc75b941`), `fix/issues-159-160` (`ead182d582df`), and `fix/request-count-badge-refresh` (`5c2bdd3dd34c`). Their code is represented in this integrated source; the request-count branch is already an ancestor of current `main`. Open PR #162's head is `8e7d81c64298`; its theme/application changes and v1.1.0 validation-engine addition are integrated in this candidate. The release branch will record its head as an ancestry parent so GitHub can close the stale PR when the tree reaches `main`. `gitlab/main` (`91724297ae9f`) is an ancestor of current `main`, 138 commits behind, with no unique commits. The `pr-author/*` and `upstream/*` refs belong to external contributor/upstream remotes and are not project-owned merge targets.

The branch review found no new application permission or identity boundary in the validation-engine update. Existing feature boundaries remain: list imports follow normal user permissions, quota, and approval; software search falls back only for eligible paged-catalog failures; reader-service administration remains restricted; Steam credentials stay redacted; and setup/service identities remain explicit. URL/catalog inputs and list batches stay bounded. No live external-provider round trips were performed.

Two preliminary cumulative-gate attempts were stopped before completion when the integrated scope expanded to include the newly reviewed PR and this ledger correction. Their partial output is not counted as a pass. Before commit, PR, and release, run the complete gate on the exact integrated source on `kspls0`, followed by the production build, bundle check, affected disposable browser checks, and release-note preview. Record actual counts, skips, exclusions, source identity, and receipts with the release PR. This remains the required procedure after future source changes. No new whole-site human visual acceptance is claimed.

## Narrow game-library filter overflow repair — October 5, 2026

Forward integration also reviewed the newly fetched `origin/main` tip
`b46ebfdc6c5e7d7f483f863523f179c1cb27735e`. Its delta from the previously
checked `c1c66f6d3d0bf82b4474b042d5816f4f744d8acc` updates maintainer language
about human review and a source-contract test comment; it changes no application
runtime or security boundary. The project-owner release authorization and
published v3.52.1 evidence from that tip are retained above.

The first seven-spec disposable Cypress run on validation snapshot r14 exposed
one real narrow-layout defect: 44/45 tests passed, while the Play Together
mobile check measured a 439 px document width at a 390 px viewport. DOM
inspection showed the shared compact-select container was 326 px wide while its
non-shrinking long label and selected value needed 406 px. The repair is owned
by `src/styles/globals.css`: compact selects in application filter rows can now
shrink, and their labels ellipsize within the row. It does not change filter
values or game data. The release fragment is
`release-notes/2026-10-05-game-library-filter-overflow.md`.

On the repaired snapshot tree `030d770f84e3d7d80aaeb3140b73ac5dcfcf846c`,
Node 24.21.0 and pnpm 10.24.0 completed the frozen install, production build,
and bundle check. The build generated all 113 pages; `pnpm bundle:check` checked
305 JavaScript chunks (11.55 MB total; shared `_app` chunk 665.5 KB). The
release-note preview against `v3.52.1` passed and included the issue and game
filter notes.

The same tree then passed all seven affected Cypress specs on `kspls0`: **45/45
tests passed, zero failures, skips, or pending tests**. The exact previously
failing Play Together check passed at 390 px. The run used the disposable
SQLite config `/tmp/seerrng-validation-r15-e2e-config` and local app port 55156;
the existing service on port 5055 was left running and untouched. The inspected
after-fix capture is
`/tmp/seerrng-validation-final-merged-kspls0-20261005-r5/cypress/screenshots/game-library.cy.ts/game-library-play-together-mobile.png`.
The before-fix Cypress failure capture is
`/tmp/seerrng-r14-game-overflow.png`. No provider round trip was attempted.

Visual inspection of that after-fix capture found that the long English phrase
was still duplicated and truncated between the field label and selected value.
The final UI now labels the selector “Owner count” and its shared option “2+
owners”; the ellipsis rule remains as a fallback for longer translations. The
English catalogue was regenerated on `kspls0` with Node 24.21.0, and
`pnpm i18n:check` passed. On the final wording tree, the full development gate,
production build, and bundle check passed, but Cypress exposed a stale assertion
for the retired “Games with at least two owners” copy. The affected spec now
checks the selector’s current accessible name and selected “2+ owners” value;
this keeps the behavioral check while matching the accepted concise wording.
The complete gate, production build, bundle check, and affected Cypress suite
are rerun on the updated review candidate.

The complete development gate, guarded production build, bundle check, and
affected disposable browser checks for the final review candidate run on
`kspls0`. Their actual suite counts, skips, exclusions, and source identity are
reported separately from discovery in the pull request. No provider round trip
is claimed. The issue comments and closure for #159 and #160 already link the
published v3.52.0, which contains both fixes; this follow-up must not describe
them as newly fixed in v3.52.1 or this candidate.

## Shared-worktree security audit — October 5, 2026

The shared repository contains several dirty worktrees from earlier integration
and QA passes. The current candidate already contains the later integrated
reader, game-library, setup-assistant, request-count, and startup-bundle source;
older worktree copies were retained as recovery evidence rather than overlaid
on the newer implementations. The additional request-failure route tests from
the unfinished test worktree are carried into this candidate for permission,
ownership, provider-alias, and retry coverage.

The audit found that the temporary `/qa-request-edit` reproduction page was
tracked on `main` and had appeared in a prior production build. Its screenshot
evidence is already preserved, so the page is removed from the release source;
the `RequestBlock` tests continue to exercise requests whose `media` reference
is absent. A temporary auth diagnostic spec remains outside the candidate.
The final production build must confirm that `/qa-request-edit` is no longer
emitted.
