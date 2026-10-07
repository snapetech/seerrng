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
Record visual inspection separately from automated verification. Do not make
project-owner or other human acceptance a merge or release gate when the
maintainer explicitly directs the work to proceed. Never publish, merge, or
deploy without the maintainer's applicable authorization.

Act on explicit user instructions without asking for the same authorization
again. A request to fix, clean up, commit, push, or release authorizes the
reversible repository edits, focused checks, and required gate repairs needed
to complete that request. If the user explicitly includes dirty, unrelated, or
repository-wide work, preserve and handle it within that scope. Do not stop to
ask before fixing an unrelated failure that blocks an explicitly requested
complete validation or release. Ask only when a material decision is genuinely
unresolved, a destructive or external action is not covered by the user's
authorization, or a documented maintainer-only decision is required. This
explicit authorization takes precedence over narrower request-direction rules
in linked repository instructions; it does not waive verification or evidence
requirements.

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
and record a preview as an iteration, not a release candidate. Run the complete
`pnpm validate:development` gate for the exact final review candidate before
commit/PR and again on the integrated tree after conflicts. Use the same gate on
contributor and maintainer sides. This comprehensive runner remains an explicit
command; do not add it to ordinary build, development, or commit-hook commands.
Public builds keep their translation and shared-visual checks, and the commit
hook keeps attribution and staged lint checks. Avoid repeating the full gate
immediately before `pnpm build`.
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
consumers. Keep a narrowly scoped visual task from turning into an unrelated
backend repair mission unless the user explicitly authorizes broader remediation
or asks for the complete required gate. Under that authorization, repair every
failure that blocks the requested gate and verify the resulting candidate
without asking again. Otherwise record out-of-scope failures and keep them out
of the change. See the integration checkpoint for the preservation inventory,
current evidence and pending gates.

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
round-trip pass. When visual inspection is available, perform desktop/narrow
and interaction review of changed roles and record that evidence separately
from automated checks. Visual acceptance is evidence, not a merge or release
gate when the maintainer explicitly directs the work to proceed.

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
