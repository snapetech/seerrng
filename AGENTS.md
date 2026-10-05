# Agent Instructions — SeerrNG

## Existing communication contract

These rules apply to all model interfaces using this repository:

- Never praise questions or validate premises before answers.
- Correct mistaken premises directly; do not capitulate without new evidence.
- Assess numbers independently instead of anchoring on a supplied estimate.
- Use explicit confidence levels for claims, recommendations and estimates:
  `high`, `moderate`, `low`, or `unknown`.
- Do not add disclaimers, unsolicited ethics lectures, or formulaic hedges.
- Surface negative conclusions directly; optimize for accuracy, not approval.
- If you do not know, say so. Never fabricate.

## Communication and authority

Answer accurately, directly, and without invented evidence. Say when a result is
unknown. Distinguish implemented code, automated verification, human visual
acceptance, and live integration verification. Give numbered review items.
Do not claim a build or source assertion proves the rendered interface works.
Read and follow `CONTRIBUTING.md`; preserve attribution and disclose AI assistance.
Human review remains required. Never publish, merge, or deploy without the
maintainer's applicable authorization.

## Required development reading

Before implementation or merge conflict resolution, read these complete files:

1. `docs/maintainers/ui-style-standard.md` — established asset appearance and
   interaction standards.
2. `docs/maintainers/ui-fix-it.md` — scope, audit, repair, verification, and
   evidence procedure. This complements the standard; it does not replace it.
3. For forward integration, `docs/maintainers/ui-forward-merge-guide.md`.

Read applicable existing task/security/contribution instructions too. These
instructions supplement existing functional, security, migration, and release
requirements; a visual change never authorizes bypassing them. Keep this file a
router, not a second copy of the standards. Resolve conflicting decisions from
documented current acceptance, not a retired trial or whichever branch wins.

## Shared ownership

`src/styles/globals.css` owns reusable appearance and layout. Components select
descriptive semantic asset roles and independently named configuration variables.
Do not add Tailwind presentation OR structural utilities to migrated assets or
new UI; page/card/poster/table layout belongs to the same shared semantic system.
Do not copy values already owned by a role, invent utility-alias classes, use
fixed inline presentation, or restore retired owners. Runtime measurements may
use documented custom properties when static CSS cannot express the data.
Existing legacy consumers are unfinished audit work, not permission to add drift.
Keep application, poster, and filter control owners distinct while reusing tokens.

Change CSS, consumers, standards, and regression checks together. Trace all
rendered consumers affected by a shared change. Preserve existing permissions,
provider identity, selected quality, selection ordering, recovery, and user data.
Missing rules or conflicting approved appearances require a maintainer decision;
do not choose a new design merely to make a check pass.

## Required verification

Work in approved page/asset batches. During editing, run affected focused checks
and record a preview as an iteration, not a release candidate. Use the reviewed
combined test engine for the exact final candidate, with repository-owned tests
and supplemental checks discovered for that source revision. Use the same
source-specific scope on contributor and maintainer sides. The retired archived
comprehensive suite is not a second mandatory prebuild run. Compilation follows
passing tests and is a separate action; build guards remain required. Existing
public commands and commit hooks are not changed by these instructions. Inspect
their actual bindings and reconcile obsolete gate instructions explicitly before
integration; do not disable hooks or bypass a failure. Avoid repeating a complete
suite or production compile for an unchanged candidate merely because two stages
invoke it; report any still-required duplicate binding rather than hiding it.
Follow the fix-it audit too: prose instructions are not executable tests.
Inspect the plan/inventory for connected native/source/DOM/style suites; report
actual execution, counts, skips and exclusions separately from discovery.
Before the cumulative run, follow the fix-it prerequisite procedure: verify a
complete pinned repository/snapshot and the native tooling required by its tests.
An app source volume, Linux platform or discovery plan alone does not prove that
workflow/release fixtures and native tools are available.
Do not treat unrun suites as passing, or partial failure output as success.

A page-by-page audit does not narrow the contribution's preservation scope.
Retain accepted Request-page and shared title/heading, page-status/spinner,
button, poster and layout work alongside Series changes. Trace affected shared
consumers, but do not turn visual cleanup into an unrelated backend repair
mission. Record an unrelated failure, stop finalization, and request direction
before expanding implementation scope. See the integration checkpoint for the
preservation inventory, current evidence and pending gates.

Checkpoint: `docs/maintainers/interface-integration-checkpoint.md`.

Fix failed rules at their source. Do not skip tests, weaken assertions, alter
standards, disable hooks, or add blanket exclusions to obtain a green result.
When an accepted design supersedes an old check, replace that check with an
equally meaningful current behavioral/role check and document the reason.
Record genuine pre-existing failures and stop finalization until they are
resolved. A maintainer may defer work, but a deferred required failure is not a
passing gate or permission to claim the final candidate complete.

Build and check the exact final source, using the pinned repository runtime and
lockfile. Run affected integration/e2e checks in disposable environments where
available. Never aim tests at live configuration, accounts, queues, playlists,
collections, watchlists, or databases. A mocked provider pass is not a live
round-trip pass. Perform desktop/narrow and interaction review of changed
roles. Record human review evidence separately from automated checks;
acceptance may be provided by the project owner or an authorized reviewer.

## Test-engine maintenance for contributors and maintainers

Read `tools/validation-engine/README.md` and the extracted engine setup guide
before using the saved engine. This is a preserved reusable implementation and
reference packet, not an automatically installed package command. Extract outside
test discovery paths. Do not copy archived test files over the chosen source.

The engine runs the repository's existing test files through their compatible
runners; tests do not need rewriting into an engine-specific format. On every
preview change or upstream merge:

1. Identify changed behavior and all affected test owners, fixtures, mocks,
   selectors and shared contracts. Inspect workflow, package and runner discovery
   too; a test not used by GitHub can still be required local coverage.
2. Maintain affected tests and fixtures with the implementation. Preserve valid
   canonical GitHub assertions. When an approved behavior supersedes an obsolete
   local expectation, document the replacement and retain meaningful positive
   and negative coverage. Never change application styling or weaken a test merely
   to obtain a pass. Update the Fix-it guide for a proven reusable failure mode.
3. Refresh and review discovery, ownership, expected case identities, dependency
   impact mappings and source/lock/runtime/recipe pins for the actual candidate.
   Add newly introduced tests; remove duplicates only with proved equivalent
   coverage on our supplemental side. Do not reuse reference file counts, pass
   receipts or a previous revision's inventory as current acceptance.
4. Run focused affected checks during development. For final verification, queue
   independent files concurrently using detected effective CPU capacity and a
   sealed worker budget, dependency-aware priorities and staggered setup types.
   Preserve timing-sensitive/global-state barriers and per-file disposable
   fixtures. Share only proven immutable cached inputs, never mutable databases,
   mocks or test state. Unknown setup requirements keep the conservative path.
5. Queue genuine failures for an authorized agent or maintainer to diagnose and
   repair. The engine does not itself invent fixes. Coordinate conflicting writes
   per file, preserve unrelated edits, verify base/after hashes, then freeze a new
   candidate and rerun failed tests plus transitive affected checks. Retain green
   results only when complete input closures prove them unchanged; unknown impact
   requires broader verification. Record raw failures and actual retest receipts.
6. Compile the unchanged passing candidate once at the authorized build gate.
   Keep CSS/i18n/security/network guards and separate browser, CodeQL, platform,
   packaging and deployment gates visible. A test-engine pass is not the entire
   GitHub pipeline. Report files, cases, failures, skips, elapsed time, worker
   budget, repairs and remaining gates; visual approval occurs during development
   and review, not an exhaustive visual crawl before every compile.

The saved 3.48.1 reference packet does not establish acceptance of this preview or
a later merge. A version-specific compiler experiment is optional, not authority
to patch dependencies or transplant configuration into a different revision.

## Safe collaboration and records

Recommend a helper when an independent task can proceed while the user reviews
other work. Give each helper non-overlapping file ownership and the authoritative
source target; root reviews and verifies integration. Helpers do not independently
publish or mutate live services. Preserve a recoverable source checkpoint before
merging, and maintain a ledger of changes, decisions, checks, pending acceptance,
and recovery identities. No credentials or runtime backups belong in a PR.

## Release-note contract

Every user-facing feature, fix, security, operational, or documentation change
needs a new structured fragment under `release-notes/`, following
`release-notes/README.md`. Preserve shipped fragments and append-only release
history. Preview notes with `pnpm release-notes:preview --base <base> --head <head>`.
Internal-only work must explicitly select `release-note: none` under the existing
PR contract. Before declaring a release complete, verify notes reach the GitHub
release and announcement. Existing attribution and release-history checks remain
required; changing tag history also requires `node scripts/check-changelog-tags.mjs`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
