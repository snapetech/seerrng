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

## Preview merge and validation — October 4, 2026

This section supersedes earlier descriptions of the current command bindings and
publication authority; historical receipts above remain unchanged. John selected
the accepted preview and authorized integration with Keith's current main,
scoped Fix-it repairs, source-specific engine validation, separate guarded
compilation, and a laptop preview on port 5071 with an independent copy of the
5070 configuration/database. The final preview is shown only after those checks
complete. John's visual review remains required before any PR.

The pinned upstream base is `a96fafa07c77a2d6d95badeb9f60c32a6b4a47c9`
(3.48.3). The exact accepted working-byte checkpoint is
`d9338138acf269a37018d2fedc7b7daa8dce2d2d`, whose common ancestor with upstream
is `e7305281797cd7527c3b1c0a83ff144218ad506a`. The three-way inventory contains
311 accepted paths and 361 upstream paths, 308 overlapping paths, and eight
manual conflicts. The accepted screen semantics are already present upstream;
MediaSlider retains its newer TMDB stale/error retry notice and poster fallback.
Testing instructions are reconciled to the reviewed engine, while actual public
package commands and hooks preserve their existing bindings.

The reviewed combined engine uses this integrated candidate's existing tests and
supplemental checks with fresh inventory, case ledger and source/environment
pins. The archived comprehensive runner is not an additional mandatory test run.
`pnpm build` runs translation/shared-visual guards and compilation separately.
The saved 3.48.1 engine receipt remains historical and cannot certify this source.
All iterative source, dependencies, evidence, caches, test and compile work remain
in Docker-managed Linux storage. The original accepted preview remains preserved.

Current evidence and the bounded Fix-it repair ledger are being recorded in the
owned Linux evidence volume. Final tests, compile, deployment health and visual
acceptance remain pending until their actual receipts are verified. No live
provider writes are authorized by this validation.

## Theme adoption and publication authority — October 4, 2026

John subsequently requested a one-time switch to SeerrNG for new installations
and existing accounts upgrading to this build or a later build containing this
migration. The stable migration adds an account palette default and clears old
active advanced-theme overrides once. After login, another supported palette
can be selected and saved to that account. Later logins and upgrades retain that
choice; the migration is not a per-version or per-login reset. Appearance mode
and unrelated account preferences are preserved.

John explicitly authorized submission to `snapetech/seerrng` after passing tests,
using his previously approved AI disclosure, and automatic follow-up repairs
for relevant PR failures. This supersedes the earlier pending preview-review
publication gate. It does not certify new physical drag/touch, browser/Cypress,
live-provider or PostgreSQL-service testing. The accepted visual decisions remain
his; no new whole-site visual acceptance is claimed.

The pre-theme integrated tree passed the full reviewed engine (3,994 passed,
four existing conditional PostgreSQL skips, zero failures; 555 files) in
344.227 seconds. Its separate guarded compilation completed in 117.572 seconds,
after 11.150 seconds of prebuild guards. Those are historical receipts for tree
`473af0fd9c7479c9e58c043115e285727691ccd7`, not proof for the theme amendment.
John explicitly waived another compile and requested tests only for the amended
source. A fresh source-bound engine run and static checks must establish that
amendment's actual result before publication. No production deployment or merge
of Keith's PR is authorized by this overnight finalization request.

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

## PR #162 forward integration — October 6, 2026

John Cronk's PR #162, “feat(ui): preserve accepted preview and adopt SeerrNG
theme once,” targeted `main` from `JohnCronk79/seerrng` branch
`integration/preview-v3483-20261004`. Its source head was
`8e7d81c6429830ce2143bd243977c3c8e220da81`; the fetched `main` head was
`b46ebfdc6c5e7d7f483f863523f179c1cb27735e`. A rebase produced widespread
historical snapshot conflicts, so the integration followed the maintainer
forward-merge workflow and preserved both published histories. The only
manual source conflict was this checkpoint: the PR's October 4 acceptance and
theme authorization entries were retained with the later `main` entries.
Integration commit: `8c341f4c1d38988b3de1f5775954cbca18e25596`.

The application change is limited to saved-theme migration and account
selection, the Watchlist success state, the documented movie `stale` route,
and corresponding tests and Cypress fixture updates. Existing source-specific
GitHub checks had passed on the PR's original head. Recovery refs preserve the
source and base tips as `recovery/pr162-source-pre-integration-20261006` and
`recovery/main-pre-pr162-20261006`. The work used the isolated worktree
`/tmp/seerrng-pr162-integration-20261006`; unrelated ROMarrNG changes in the
primary checkout were left untouched.

The pinned local toolchain was Node `v24.15.0` and pnpm `10.24.0`. A frozen
dependency install completed without changing the lockfile (SHA-256
`40cb5a6475750b19ec14a381df9ad13ec06b02fa37d9782240cb60da6c877830`). The
comprehensive `pnpm validate:development` run passed translation extraction,
the 569-file current-batch check, inspection of all 397 shared-style
components, formatting, lint, server and client type checks, and all 100
Vitest files (458 tests). The native TypeScript runner completed 2,919 tests:
2,913 passed, four PostgreSQL-only checks were skipped, and two tests in
untouched mainline files failed in this full run. The failures were
`Authenticated metadata resource boundaries` in `server/routes/index.test.ts`
(404 instead of the expected 429) and the hidden-account search case in
`server/routes/user.test.ts` (missing `results`). Both exact cases passed when
rerun alone through the native runner. The full Node JavaScript lane passed
493/493 on rerun after one non-reproducible failure in its first attempt.

The macOS tooling lane could not produce a reliable full pass. Its POSIX
fixtures assume Linux tools: BSD `base64` rejected GNU's `-w0` option, BSD
`stat` rejected `-c`, and the system Bash rejected the `{1,512}` regex bound.
Even with temporary GNU `base64` and Python aliases, 43 tooling tests still
failed on those macOS utility differences. No repository files were changed
to work around the host. Linux CI's tooling job remains required to establish
those results for the integrated head.

The guarded `pnpm build` completed successfully. Translation and current-batch
guards passed, the shared UI style suite passed 68/68, server and client
compilation succeeded, and Next.js generated all 113 static pages. The build
log is `/tmp/seerrng-pr162-build-20261006.log`; validation and lane logs are
under `/tmp/seerrng-pr162-*-20261006.log`. This integration did not run a new
whole-site visual review or live-provider round trip. The PR's documented
preview acceptance remains the visual evidence for its submitted scope.
Fresh Linux CI, including the bundle-budget check, and the PR's required
checks must pass before merging.

After the normal PR-branch push, fresh GitHub checks passed build, bundle
budget, lint, security, i18n, and external-link validation. Cypress exposed one
desktop login smoke failure: a long rotating backdrop title extended beyond
the viewport because the desktop `.page-title` rule permits visible overflow.
The login backdrop now clips that title with an ellipsis in
`src/styles/globals.css`, without changing page titles elsewhere. A fresh
production build passed, including all 68 shared-style tests and all 113
generated pages. The exact `cypress/e2e/public-smoke.cy.ts` file then passed
all four cases locally, including desktop and mobile login. GitHub checks must
rerun against this repair before merge.

## ReadMeABook Phase 7 forward integration — October 6, 2026

The requested source branch is `feat/ng-phase2-tunerr`. Its pre-Phase-7
checkpoint is `03d8d34cbcea3f1d50d239fcbd407d51e0301258`; the Phase 7 feature
commit is `92caf7ed56adcf209d55d536f0e17bf4a51a65a3`. The original common base
was `b46ebfdc6c5e7d7f483f863523f179c1cb27735e`. Before integration, current
`origin/main` had advanced to
`116e3a447364a2b528cad10d99391cb6ee19cb8c`. The original remote feature ref
still points to the pre-Phase-7 checkpoint; the local source branch includes
the Phase 7 commit.

Recovery refs are `recovery/ng-phase2-before-phase7-20261006` at the original
checkpoint and `recovery/ng-phase2-before-main-rebase-20261006` at the Phase 7
source commit. The rebased code candidate reached
`c7f2261dbe43711ba2b37d272afde5e3da19391a` on branch
`integration/ng-phase2-main-20261006`; this evidence is recorded in the next
documentation commit. The integration branch was created separately so
the published feature ref was not rewritten. `git rebase --rebase-merges
origin/main` replayed 23 commits without textual conflicts. The candidate
contains 183 changed files relative to current main (25,342 insertions and
3,099 deletions), including the earlier phases already present on the requested
branch as well as Phase 7. At the time of this checkpoint, no PR had been
opened and no merge had occurred.

The six file overlaps with current main were reviewed: `seerr-api.yml`,
`UserSettings.ts`, both user-settings route/test files, `en.json`, and
`globals.css`. The theme preference and theme-adoption route/tests from main are
preserved beside Phase 7's book-home preferences and routes. The English theme
save message and main's reduced-motion/title-overflow rules are retained. Main
already uses migration timestamp `1791080000000` for theme adoption, which
collided with Phase 7's original ReadMeABook migration timestamp. Phase 7's four
migrations were moved to `1791090000000` through `1791120000000` in both
providers. A regression test checks that these Phase 7 timestamps are unused in
both migration histories; the focused SQLite migration suite passes 2/2.
PostgreSQL migrations were not executed against a database.

The Phase 7 implementation adds the ReadMeABook audiobook search/request and
admin dashboard client, per-user Hardcover sync, configurable per-user
book/audiobook Discover sections, Swipe `full`/`rated`/`favorites` seed scopes,
and admin-created hashed, expiring, single-use login links. ReadMeABook keeps
its download and processing pipeline. The release-note preview passed with
`pnpm release-notes:preview --base origin/main --head HEAD`; it includes the
Phase 7 Bookshelf note and the other user-facing notes already on the branch.

Validation evidence before rebasing is mixed. The complete native TypeScript
rerun reported 3,021 tests: 3,013 passed, four were skipped, and four failed.
Each failure was an auth helper receiving 401 or 404 in discovery, request,
user, or the new book-home settings test. Every exact case passed when selected
alone. The full discovery file passed 124/124, the full user-route file passed
104/104, and a subsequent discovery/request sequence passed 315/315. A separate
four-file sequence had one different request-helper 401, so the cumulative
login instability has not been resolved or waived. The new ReadMeABook,
Hardcover, login-link, Swipe, and migration-focused tests passed in the full
native run or focused reruns. The latest
`pnpm validate:development --plan` selects 103 Vitest files, 409 native
TypeScript files, 58 native JavaScript files, and 31 tooling files, with zero
platform exclusions.

The complete required validation and one production build on the rebased
candidate remain pending. No ReadMeABook or Hardcover live-service round trip,
desktop/narrow visual review, or physical Swipe interaction review was done.
Those boundaries are not presented as automated passes. Finalization requires
a passing gate and build on the integrated candidate, then fresh GitHub checks
after its branch is pushed.
