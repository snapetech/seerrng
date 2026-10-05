# Forward Integration of the Interface Work

This is an integration procedure, not permission to publish or a guarantee of
zero regression. Preserve both the maintainer's functional/security changes and
the contributor's accepted visual/interaction contract.

## Inputs and checkpoint

1. Fetch the authorized contributor branch and `snapetech/seerrng` main through
   authenticated Git. Resolve both to full commit IDs. Verify remotes, branch
   ownership, a clean integration checkout, and the actual common ancestor.
   Record the IDs before editing. Do not infer provenance from `package.json`.
2. The current approved laptop source reports version 3.46.1, based on upstream
   main `e7305281797cd7527c3b1c0a83ff144218ad506a`. The earlier `v3.44.1` tag resolves
   to `5b0859a8ba30380661033ea4c7d06c77be970032`; use this as a cross-check,
   not a substitute for the PR's real ancestry. During earlier preparation main was
   observed at `da85baa8461c183d785d4ca5df264ad0ba79f24c`. Fetch and pin the
   current target when integrating; that observation is not a permanent target.
3. Save recoverable refs/source and produce a three-way changed-file inventory.
   Do not overwrite a dirty checkout, discard contributor commits, or include
   live config/databases/secrets. Work in an isolated integration branch/worktree.
4. Read `AGENTS.md`, both UI documents, `CONTRIBUTING.md`, the PR's acceptance and
   verification record, and applicable task instructions completely. Inventory
   current gate/test coverage and known unresolved work before resolving conflicts.
5. Start the evidence record from
   [Interface Integration Checkpoint](interface-integration-checkpoint.md).
   The first review batch is not the complete PR scope: preserve Request-page
   work and the shared heading/status/button/poster/layout owners too. The
   checkpoint is a coverage map, not proof that its pending gates passed.

## Reconcile cumulative changes

1. Rebase the contribution onto the pinned target main as required by the
   contribution guide, or use the maintainer's explicitly approved equivalent
   integration workflow. Main already contains its intervening commits: do not
   cherry-pick all of them again. Do not rewrite someone else's published branch
   without authorization. Integrate coherent commits/batches with checkpoints.
2. Review each overlapping component, stylesheet role, API route, schema, entity,
   migration, test, package script, and instruction file semantically. Never use
   blanket `ours`/`theirs`, replace the newer lockfile with an older one, or restore
   a whole old component just to recover its appearance.
3. Keep target-side security/provider fixes and new capabilities. Adapt the
   contributor's semantic CSS/structure to those implementations. Preserve
   selection/provider/quality identity, account authority, disabled/error behavior,
   and new migration ordering for both SQLite and PostgreSQL. Never run migrations
   against production as a merge test.
4. Preserve the accepted appearance through its role owners: page/layout/status,
   card/table/list/poster/control families. Remove redundant overrides rather than
   adding compensating padding, transforms, utility strings, or new exceptions.
   Button placement is layout-owned, not a universal ordering rule. Record a
   genuine conflict requiring a new design instead of silently changing acceptance.
5. Keep the standard and fix-it documents separate and synchronized with source.
   Preserve all valid regression/security tests. Connect new suites to the shared
   gate. If a historic assertion encodes a superseded trial, document that fact
   and replace it with a current rule/behavior assertion with negative coverage.
   A check must detect the regression it claims to prevent.

## Apply the same acceptance procedure

Establish complete repository fixtures and native tool prerequisites using the
fix-it procedure before the cumulative run. An app-volume archive or bare Node
image is not a complete repository/toolchain receipt. Resolve missing fixtures
from the actual pinned Git inputs; never invent them, copy another release's
workflows or waive required checks. Retain the source manifest and tool versions.

1. Follow the fix-it audit against changed assets and their affected consumers,
   including effective CSS cascade, structural ownership, dynamic/secondary class
   props, hit areas, fixed headers versus scrollers, state, and narrow layouts.
   Read `tools/validation-engine/README.md` and the extracted setup instructions.
   Regenerate and review the source-specific inventory and invocation plan, then
   run the combined engine on the exact integrated candidate. Preserve an
   unchanged-source receipt, then run one guarded `pnpm build`. The current build
   runs translation/shared-visual guards and compilation; it does not run the
   engine. Do not repeat the archived comprehensive gate after engine acceptance.
   Any failed required check blocks finalization; do not bypass a hook or redefine
   success.
2. Retain validation and compilation results with the target's pinned
   runtime/dependencies. If validation and compilation are separate phases,
   retain an exact unchanged-source receipt before using `build:compile`;
   that internal command does not prove validation by itself.
   Preserve existing CI workflows/checks. Run applicable
   browser/integration tests in disposable config; record prerequisites that are
   unavailable. Never report a skipped suite as a pass or a mock as real-service
   verification. Native saved actions mutate only after an explicit user action.
3. Compare actual desktop and narrow renders with the accepted reference, including
   initial/refresh loading, empty/error/retry, selection/expansion, hover/focus,
   disabled actions, pins, drag cancellation/drop, and provider-specific controls.
   Existing UI tests reduce review effort; they do not establish pixel identity.
4. If main advances before finalization, fetch and pin the new head, reconcile the
   additional changes, and repeat the invalidated checks/review. Do not claim the
   previous build verifies code added afterward. Record the final exact target,
   contributor, integration, and tested commit IDs.
5. Summarize preserved features, resolutions, commands/results, unverified native
   paths, visual acceptance, and remaining scope. Obtain the required human review,
   use the project PR template and AI disclosure, add/preview release notes, and
   finalize only under the maintainer's publication/merge authority.

## Evidence and recovery

Keep the source checkpoint, changed-file inventory, acceptance reference, gate
inventory/results, and conflict-resolution ledger associated with the reviewed
commit. On a regression, reproduce it, repair its authoritative owner, extend a
role/behavior check, and update the standard/fix-it records. Recover from saved
refs or archives in an isolated checkout; never erase newer work to restore a
visual baseline. The shared gate enforces covered rules on both sides; uncovered
rules and live service behavior remain explicitly reviewable boundaries.

Complete the checkpoint's commit/runtime/conflict/evidence fields during the
real integration. Do not invent PR IDs, ancestry, acceptance or passing results.
Report unrelated failures before attempting an out-of-scope backend repair;
retain newer target fixes and defer the integration if a required gate fails.
