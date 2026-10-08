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
unknown. Distinguish implemented code, automated verification, visual inspection
evidence, and live integration verification. Give numbered review items. Do not
claim a build or source assertion proves the rendered interface works. Read and
follow `CONTRIBUTING.md`; preserve attribution and disclose AI assistance. Record
visual inspection separately from automated verification. Do not make
project-owner or other human acceptance a merge or release gate when the
maintainer explicitly directs the work to proceed. Never publish, merge, or
deploy without the maintainer's applicable authorization.

Act on explicit user instructions without asking for the same authorization
again. A request to commit, push, merge, or release authorizes that named action
and the strictly necessary routine checks and reversible repository changes. A
fix or cleanup request authorizes only its stated scope; it does not authorize
unrelated work, destructive history rewriting, live data/provider mutation, or a
policy bypass. If the user explicitly includes repository-wide work or a complete
gate, repair candidate-caused, in-scope, and required-gate failures that block it
without asking again. Ask only when a material decision is genuinely unresolved
or an action falls outside the user's authorization. Linked instructions do not
create a redundant approval gate, and explicit authorization does not waive their
verification, evidence, safety, or security requirements.

## Required development reading

Before UI implementation or UI merge conflict resolution, read these complete
files:

1. `docs/maintainers/ui-style-standard.md` — established asset appearance and
   interaction standards.
2. `docs/maintainers/ui-fix-it.md` — scope, audit, repair, verification, and
   evidence procedure. This complements the standard; it does not replace it.
3. For forward integration that includes UI or interface work,
   `docs/maintainers/ui-forward-merge-guide.md`.

Non-UI work does not trigger UI Fix-It. A complete validation gate does not by
itself authorize or require a whole-application UI audit. For validation-engine
usage, behavior, or changes, read the authoritative
`tools/validation-engine/README.md`.

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

During editing, run affected focused checks. Test discovery, scheduling, input
freshness, isolation, stage ownership, and result accounting belong to the
repository's bound validation engine, not a separate agent execution procedure.
Follow the applicable mode exactly as defined in the engine README. Inspect its
plan/inventory and report actual execution, counts, skips and exclusions
separately from discovery. Before a cumulative run, verify a complete pinned
repository/snapshot and the native tooling required by its current inventory. An
app source volume, Linux platform or discovery plan alone does not prove that
workflow/release fixtures and native tools are available.

Mode 1 is the active complete local validation path. Mode 2 is the active
complete GitHub-hosted validation path. Mode 3 production operation remains
dormant; its regression tests remain active only as test coverage, and Mode 3 is
not an accepted finalization path. Do not install, start, or connect Mode 3 to
package scripts, hooks, workflows, or application runtime without explicit
maintainer authorization.

When work changes UI or visual assets, use scoped page/asset batches, follow UI
Fix-It for the changed pages/roles and affected shared consumers, and record a
preview as iteration evidence rather than a release candidate. Non-UI work and a
complete engine gate do not trigger Fix-It or a whole-application visual audit.
Prose instructions are not executable tests.
Do not treat unrun suites as passing, or partial failure output as success.

For UI work, a page-by-page audit does not narrow the contribution's preservation
scope.
Retain accepted Request-page and shared title/heading, page-status/spinner,
button, poster and layout work alongside Series changes. Trace affected shared
consumers, but do not turn visual cleanup into an unrelated backend repair mission
unless the user explicitly authorizes broader remediation or asks for the complete
required gate. Under that authorization, repair every failure that blocks the
requested gate and verify the candidate without asking again. Otherwise, record
out-of-scope failures and keep them out of the change. For interface integration,
see the checkpoint for the preservation inventory, current evidence and pending
gates.

Checkpoint: `docs/maintainers/interface-integration-checkpoint.md`.

Fix failed rules at their source. Do not skip tests, weaken assertions, alter
standards, disable hooks, or add blanket exclusions to obtain a green result.
When an accepted design supersedes an old check, replace that check with an
equally meaningful current behavioral/role check and document the reason.
Candidate-caused and in-scope failures block finalization. An unrelated baseline
failure blocks only when the requested complete gate includes it; otherwise record
it without expanding scope. A maintainer may defer work, but a deferred required
failure is not a passing gate or permission to claim the final candidate complete.

Use the applicable complete engine mode to build and check the exact final
source with the pinned repository runtime and lockfile. During iteration, run
focused affected integration/e2e checks in disposable environments where
available. Outside the engine, collect only applicable live or visual evidence
that its plan does not own; do not add a second build/browser gate after a
passing complete mode. Never aim tests at live configuration, accounts, queues,
playlists, collections, watchlists, or databases. A mocked provider pass is not
a live round-trip pass. When visual inspection is available, inspect changed
roles at desktop and narrow widths and record that evidence separately from
automated checks. Visual inspection is evidence, not a merge or release gate
when the maintainer explicitly directs the work to proceed.

## Safe collaboration and records

Recommend a helper when an independent task can proceed while the user reviews
other work. Give each helper non-overlapping file ownership and the authoritative
source target; root reviews and verifies integration. Helpers do not independently
publish or mutate live services. Preserve a recoverable source checkpoint before
merging, and maintain a ledger of changes, decisions, checks, unresolved decisions,
unavailable evidence, and recovery identities. No credentials or runtime backups
belong in a PR.

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
